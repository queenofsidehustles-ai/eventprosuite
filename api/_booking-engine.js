'use strict';
/**
 * Booking engine — shared logic for the daily cron (send-reminders.js) and
 * the public birthday sign-up (lead-capture.js).
 *
 * Underscore file, so Vercel does not count it as a serverless function.
 *
 * Everything in here is pure (no network, no env), so it can be unit-tested
 * directly: date maths, follow-up scheduling, eligibility rules and the HTML
 * of each email. All dates are handled as UTC calendar days — the cron runs at
 * 10:00 UTC and the columns involved are plain dates.
 */

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// ── Dates ────────────────────────────────────────────────────────────────

// Midnight UTC of the given instant's calendar day.
function utcDay(d) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

// 'YYYY-MM-DD' (or a longer ISO string) → midnight UTC, or null.
function parseDateOnly(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Rejects 2026-02-31 and friends, which Date would silently roll over.
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  return new Date(d.getTime() + n * DAY_MS);
}

function daysBetween(from, to) {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(month, year) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// A real month/day pair. Feb 29 is valid (checked against a leap year).
function validMonthDay(month, day) {
  const m = Number(month), d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(m, 2000);
}

// The date a birthday is celebrated in a given year. A Feb 29 birthday is
// celebrated on Feb 28 in common years; any other impossible day is clamped
// to the end of its month.
function birthdayInYear(month, day, year) {
  const d = Math.min(Number(day), daysInMonth(Number(month), year));
  return new Date(Date.UTC(year, Number(month) - 1, d));
}

// The next time this birthday comes round, counting today as "next".
// → { date, year, days }
function nextBirthday(month, day, today) {
  const t = utcDay(today);
  let year = t.getUTCFullYear();
  let date = birthdayInYear(month, day, year);
  if (date < t) { year += 1; date = birthdayInYear(month, day, year); }
  return { date, year, days: daysBetween(t, date) };
}

function daysUntilNextBirthday(month, day, today) {
  return nextBirthday(month, day, today).days;
}

// ── Birthday reminders ───────────────────────────────────────────────────
// Aim for 7 weeks out (49 days). The window is 42–56 days so a cron run that
// was missed for a few days still catches it; last_reminded_year makes sure
// it only goes once per birthday.
const BIRTHDAY_WINDOW = { min: 42, target: 49, max: 56 };

function birthdayReminderDue(row, today, win = BIRTHDAY_WINDOW) {
  if (!row || !validMonthDay(row.birth_month, row.birth_day)) return { due: false, reason: 'bad-date' };
  if (row.unsubscribed) return { due: false, reason: 'unsubscribed' };
  if (row.consent !== true) return { due: false, reason: 'no-consent' };
  if (!validEmail(row.email)) return { due: false, reason: 'no-email' };
  const nb = nextBirthday(row.birth_month, row.birth_day, today);
  if (nb.days < win.min || nb.days > win.max) return { due: false, reason: 'not-in-window', ...nb };
  if (Number(row.last_reminded_year) === nb.year) return { due: false, reason: 'already-sent', ...nb };
  return { due: true, ...nb };
}

// The birth months whose birthdays can fall inside the window, so the cron
// only loads the rows that could possibly be due.
function birthdayWindowMonths(today, win = BIRTHDAY_WINDOW) {
  const t = utcDay(today);
  const months = new Set();
  for (let i = win.min; i <= win.max; i++) months.add(addDays(t, i).getUTCMonth() + 1);
  // Feb 29 birthdays are celebrated on Feb 28 in common years — month 2 is
  // already covered whenever Feb 28 is in the window.
  return [...months].sort((a, b) => a - b);
}

// ── Quote follow-ups ─────────────────────────────────────────────────────
// #1 about a day after the quote was first sent, #2 at 3 days, #3 at 7 days.
const FOLLOWUP_DAYS = [1, 3, 7];
// The cron runs once a day at 10:00 UTC. A quote sent at 14:00 is 20 hours
// old at the next run; that counts as "a day". One sent at 09:00 waits for the
// following run.
const FOLLOWUP_SLACK_HOURS = 6;
// Never two messages to the same customer inside this gap (a follow-up right
// after she re-sent the quote by hand would read as a robot).
const FOLLOWUP_MIN_GAP_HOURS = 18;
// After this long the conversation has moved on — and it stops a first
// deploy from emailing every old quote in the database.
const FOLLOWUP_MAX_AGE_DAYS = 10;

function successfulSends(events) {
  return (Array.isArray(events) ? events : [])
    .filter(e => e && e.ok !== false && e.at && !isNaN(new Date(e.at)))
    .map(e => new Date(e.at))
    .sort((a, b) => a - b);
}

/**
 * Which follow-up (if any) is due now.
 *   sentAt          first successful send of the quote
 *   lastSendAt      most recent send (she may have re-sent it by hand)
 *   followupsSent   how many follow-ups have already gone (0–3)
 *   lastFollowupAt  when the last one went
 * → null, or { step, markAs }
 *   step    which message to send (1, 2 or 3)
 *   markAs  the new value for followups_sent
 *
 * If runs were missed and several steps are overdue at once, ONE message is
 * sent — the latest one due — and the skipped steps are counted as done, so
 * a customer never gets two follow-ups on consecutive days to "catch up".
 */
function nextFollowup({ sentAt, lastSendAt, followupsSent, lastFollowupAt, now }) {
  const sent = Math.max(0, Number(followupsSent) || 0);
  if (sent >= FOLLOWUP_DAYS.length || !sentAt) return null;
  const first = new Date(sentAt);
  const at = new Date(now);
  if (isNaN(first) || isNaN(at)) return null;
  const ageHours = (at - first) / HOUR_MS;
  if (ageHours > FOLLOWUP_MAX_AGE_DAYS * 24) return null;
  const dueCount = FOLLOWUP_DAYS.filter(d => ageHours >= d * 24 - FOLLOWUP_SLACK_HOURS).length;
  if (dueCount <= sent) return null;
  const recent = [lastSendAt, lastFollowupAt]
    .map(v => (v ? new Date(v) : null))
    .filter(v => v && !isNaN(v))
    .reduce((a, b) => (b > a ? b : a), first);
  if ((at - recent) / HOUR_MS < FOLLOWUP_MIN_GAP_HOURS) return null;
  return { step: dueCount, markAs: dueCount };
}

// Quote statuses that mean "sent, customer hasn't booked". Anything else
// (awaiting-deposit, deposit-paid, confirmed, complete, expired, and any
// future accepted/declined) stops the follow-ups.
const OPEN_QUOTE_STATUSES = [null, undefined, '', 'quote-sent'];
// A booking in any of these means the customer acted on the quote.
const BOOKED_STATUSES = ['awaiting-deposit', 'deposit-paid', 'confirmed', 'complete'];

/**
 * Why this quote should NOT get a follow-up, or null if it should be
 * considered (nextFollowup then decides whether one is due today).
 */
function quoteFollowupBlocker(quote, { today, bookedQuoteIds } = {}) {
  if (!quote) return 'missing';
  const qd = quote.quote_data || {};
  const status = quote.status == null ? null : String(quote.status).toLowerCase();
  if (!OPEN_QUOTE_STATUSES.includes(status)) return 'status-' + status;
  if (qd.acceptedAt || qd.acceptedBookingId) return 'accepted';
  if (qd.declinedAt || qd.declined) return 'declined';
  if (bookedQuoteIds && bookedQuoteIds.has(String(quote.id))) return 'booked';
  if (!validEmail(qd.clientEmail)) return 'no-email';
  const t = utcDay(today || new Date());
  const ev = parseDateOnly(quote.event_date || qd.eventDate);
  if (ev && ev < t) return 'event-past';
  const exp = parseDateOnly(qd.expiryDate);
  if (exp && exp < t) return 'quote-expired';
  if (!successfulSends(quote.send_events).length) return 'not-sent';
  return null;
}

// ── After-party ──────────────────────────────────────────────────────────
// The day after the event. Up to a week late if runs were missed; older
// parties are left alone so a first deploy doesn't thank people for parties
// from last spring.
const AFTER_PARTY_MAX_LAG_DAYS = 7;
const AFTER_PARTY_STATUSES = ['deposit-paid', 'confirmed', 'complete'];

function afterPartyDue(eventDate, today) {
  const ev = parseDateOnly(eventDate);
  if (!ev) return false;
  const since = daysBetween(ev, today);
  return since >= 1 && since <= AFTER_PARTY_MAX_LAG_DAYS;
}

// The window as two ISO dates for the database query.
function afterPartyRange(today) {
  const t = utcDay(today);
  return { from: isoDay(addDays(t, -AFTER_PARTY_MAX_LAG_DAYS)), to: isoDay(addDays(t, -1)) };
}

// ── Profile settings ─────────────────────────────────────────────────────
// Every automation is ON unless the owner has switched it off explicitly.
function automationOn(pd, key) {
  const a = pd && pd.automations;
  return !(a && typeof a === 'object' && a[key] === false);
}

// The OWNER'S own Twilio account. The platform's TWILIO_* env vars are never
// used for these automated texts.
function ownerTwilio(pd) {
  const t = pd && pd.twilio;
  if (!t || typeof t !== 'object') return null;
  const sid = String(t.sid || '').trim();
  const token = String(t.token || '').trim();
  const from = String(t.from || '').trim();
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

function brandOf(pd) {
  const p = pd || {};
  if (/^#[0-9a-fA-F]{6}$/.test(String(p.brandColor || ''))) return p.brandColor;
  if (/^#[0-9a-fA-F]{6}$/.test(String(p.brandPrimary || ''))) return p.brandPrimary;
  return '#6D28D9';
}

function bizNameOf(pd) {
  const p = pd || {};
  return String(p.businessName || p.bizName || '').trim() || 'Your party host';
}

function replyToOf(pd, ownerEmail) {
  const p = pd || {};
  return validEmail(p.contactEmail) || validEmail(p.bizEmail) || validEmail(ownerEmail) || undefined;
}

// ── Small shared helpers ─────────────────────────────────────────────────
function validEmail(value) {
  const v = String(value || '').trim();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : null;
}

// Twilio wants E.164. Same rule as send-quote-email.js.
function normalisePhone(raw) {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d.length >= 12 ? d : null;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return null;
}

// Display name on the shared verified sending address (see send-quote-email.js).
function senderFrom(bizName, fallbackFrom) {
  const addr = (/<([^>]+)>/.exec(fallbackFrom || '') || [null, fallbackFrom || ''])[1].trim();
  const clean = String(bizName || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/["<>,:;\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  if (!clean || !addr) return fallbackFrom;
  return clean + ' <' + addr + '>';
}

const esc = v => String(v == null ? '' : v)
  .replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function fmtLongDate(d) {
  const x = d instanceof Date ? d : parseDateOnly(d);
  if (!x || isNaN(x)) return '';
  return x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function siteUrl(base) {
  return String(base || 'https://partybizhub.com').replace(/\/+$/, '');
}

function quoteLink(base, quoteId) {
  return siteUrl(base) + '/view-quote.html?id=' + encodeURIComponent(quoteId);
}

function bookingLink(base, ownerId) {
  return siteUrl(base) + '/book.html?uid=' + encodeURIComponent(ownerId);
}

function unsubscribeLink(base, birthdayId) {
  return siteUrl(base) + '/api/lead-capture?kind=unsubscribe&id=' + encodeURIComponent(birthdayId);
}

// ── Email layout ─────────────────────────────────────────────────────────
// Same look as the deposit nudge: the owner's brand colour, her business
// name, one white card, one button. Tables for the mail clients that need them.
function layout({ brand, bizName, subtitle, body, button, footer }) {
  const btn = button
    ? `<table role="presentation" width="100%" style="margin:6px 0 18px"><tr><td align="center">
    <a href="${esc(button.href)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:800;font-size:15px">${esc(button.label)} &rarr;</a>
  </td></tr></table>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f2f8;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${brand};padding:26px 30px;text-align:center">
  <p style="margin:0;font-size:18px;font-weight:800;color:#fff">${esc(bizName)}</p>
  ${subtitle ? `<p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.85)">${esc(subtitle)}</p>` : ''}
</td></tr>
<tr><td style="padding:28px 30px;font-size:15px;line-height:1.7;color:#3a2a4a">
  ${body}
  ${btn}
  <p style="margin:0;font-size:14px;color:#3a2a4a">&mdash; ${esc(bizName)}</p>
</td></tr>
${footer ? `<tr><td style="padding:14px 30px;text-align:center;font-size:12px;line-height:1.6;color:#9a8fa6;border-top:1px solid #efeaf3">${footer}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

const P = html => `<p style="margin:0 0 16px">${html}</p>`;

/**
 * Quote follow-up email + text.
 *   step       1, 2 or 3
 *   dateOpen   true only when we checked her calendar has nothing booked
 *              that day — the "still open" line is never a guess.
 */
function quoteFollowupMessage({ step, bizName, brand, clientName, eventType, eventDate, link, dateOpen }) {
  const first = firstName(clientName);
  const when = fmtLongDate(eventDate);
  const what = eventType ? `your ${String(eventType).toLowerCase()}` : 'your party';
  const forWhat = what + (when ? ` on ${when}` : '');
  const holdQ = dateOpen && when
    ? `${esc(when)} is still open on my calendar &mdash; would you like me to hold it for you?`
    : '';

  let subject, subtitle, body, sms;
  if (step <= 1) {
    subject = `Your party quote from ${bizName}`;
    subtitle = 'Just checking in';
    body = P(`Hi ${esc(first)},`) +
      P(`I sent over your quote for ${esc(forWhat)} and wanted to make sure it reached you. Everything is on one page, and you can book right from it.`) +
      (holdQ ? P(holdQ) : '');
    sms = `Hi ${first}, it's ${bizName} — just making sure your party quote came through: ${link} Reply STOP to opt out.`;
  } else if (step === 2) {
    subject = `Any questions about your quote? — ${bizName}`;
    subtitle = 'Happy to help';
    body = P(`Hi ${esc(first)},`) +
      P(`Any questions about your quote for ${esc(forWhat)}? I'm happy to adjust anything so it fits your plans and budget &mdash; just reply to this email.`) +
      (holdQ ? P(holdQ) : '');
    sms = `Hi ${first}, it's ${bizName}. Any questions about your party quote? Happy to adjust anything: ${link} Reply STOP to opt out.`;
  } else {
    subject = `One last check-in about your quote — ${bizName}`;
    subtitle = 'Last note from me';
    body = P(`Hi ${esc(first)},`) +
      P(`This is my last note about your quote for ${esc(forWhat)}, so I don't crowd your inbox. If you'd still like to go ahead, everything is at the link below.`) +
      (holdQ ? P(holdQ) : '') +
      P(`And if your plans changed, no worries at all &mdash; thank you for thinking of us.`);
    sms = `Hi ${first}, it's ${bizName} — last check-in on your party quote. If you'd still like to book, it's here: ${link} Reply STOP to opt out.`;
  }

  const html = layout({
    brand, bizName, subtitle, body,
    button: { href: link, label: 'View my quote' },
    footer: `Not planning a party after all? Just reply &ldquo;no thanks&rdquo; and I'll stop checking in.`,
  });
  return { subject, html, sms };
}

/**
 * Thank-you after the party. Each extra is included only when the owner
 * has filled in the setting it needs.
 */
function afterPartyMessage({ bizName, brand, clientName, childName, reviewUrl, referralBonus, bookLink, optOutLink }) {
  const first = firstName(clientName);
  const child = String(childName || '').trim();
  const whose = child ? `${esc(child)}'s party` : 'your party';
  let body = P(`Hi ${esc(first)},`) +
    P(`Thank you for letting us be part of ${whose}! We hope it was everything you wanted.`);

  const review = /^https?:\/\//i.test(String(reviewUrl || '').trim()) ? String(reviewUrl).trim() : '';
  if (review) {
    body += P(`If you have a minute, a quick review helps a small business like ours more than you know.`) +
      `<table role="presentation" width="100%" style="margin:0 0 20px"><tr><td align="center">
    <a href="${esc(review)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:13px 30px;border-radius:10px;font-weight:800;font-size:15px">Leave a review &rarr;</a>
  </td></tr></table>`;
  }

  const bonus = String(referralBonus || '').trim();
  if (bonus) {
    body += `<p style="margin:0 0 16px;padding:14px 16px;background:#faf7fb;border-radius:10px">Share <strong>${esc(bizName)}</strong> with a friend &mdash; they get ${esc(bonus)}.</p>`;
  }

  body += P(`Want me to save next year's date? <a href="${esc(bookLink)}" style="color:${brand};font-weight:700">Pick a date here</a>.`);

  const footer = optOutLink
    ? `We'll send one friendly reminder before ${child ? esc(child) + "'s" : 'the'} next birthday. <a href="${esc(optOutLink)}" style="color:#9a8fa6">No thanks</a>`
    : '';

  return {
    subject: `Thank you from ${bizName}!`,
    html: layout({ brand, bizName, subtitle: 'Thank you for celebrating with us', body, footer }),
  };
}

function birthdayMessage({ bizName, brand, parentName, childName, birthdayDate, days, bookLink, unsubLink, source }) {
  const first = firstName(parentName);
  const child = String(childName || '').trim();
  const who = child || 'Your little one';
  const weeks = Math.round(days / 7);
  const when = fmtLongDate(birthdayDate);
  const again = source === 'booking' ? ' again' : '';
  const body = P(`Hi ${esc(first)},`) +
    P(`${esc(who)}'s birthday is about ${weeks} weeks away${when ? ` (${esc(when)})` : ''}. If you'd like us to plan the party${again}, you can pick a date and see the options here.`) +
    P(`Questions first? Just reply to this email.`);
  const why = source === 'booking'
    ? `You're getting this because you celebrated with ${esc(bizName)}.`
    : `You're getting this because you asked ${esc(bizName)} for a birthday reminder.`;
  return {
    subject: `${child || 'Your child'}'s birthday is coming up!`,
    html: layout({
      brand, bizName, subtitle: 'A birthday is coming up', body,
      button: { href: bookLink, label: 'Plan the party' },
      footer: `${why} <a href="${esc(unsubLink)}" style="color:#9a8fa6">Unsubscribe</a>`,
    }),
  };
}

// ── Birthday sign-up validation (lead-capture kind 'birthday') ──────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanText(v, max) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * → { ok: true, row } or { ok: false, error }
 * row is ready to insert (owner existence is checked separately).
 */
function validateBirthdaySignup(body) {
  const b = body || {};
  if (cleanText(b.website, 200)) return { ok: false, error: 'spam', silent: true };
  const ownerId = String(b.ownerId || '').trim();
  if (!UUID_RE.test(ownerId)) return { ok: false, error: 'Unknown business' };
  if (b.consent !== true && b.consent !== 'true' && b.consent !== 'on') {
    return { ok: false, error: 'Please tick the box to agree to birthday reminders' };
  }
  const email = validEmail(b.email);
  const phoneRaw = cleanText(b.phone, 40);
  const phoneDigits = String(phoneRaw || '').replace(/\D/g, '');
  const phone = phoneDigits.length >= 7 && phoneDigits.length <= 15 ? phoneRaw : null;
  if (b.email && !email) return { ok: false, error: 'That email address doesn\'t look right' };
  if (!email && !phone) return { ok: false, error: 'Please add an email or phone number' };
  const month = Number(b.birthMonth), day = Number(b.birthDay);
  if (!validMonthDay(month, day)) return { ok: false, error: 'Please choose a real birthday' };
  return {
    ok: true,
    row: {
      owner_id: ownerId,
      parent_name: cleanText(b.parentName, 120),
      email: email ? email.toLowerCase() : null,
      phone,
      child_name: cleanText(b.childName, 120),
      birth_month: month,
      birth_day: day,
      source: cleanText(b.source, 40) || 'website',
      consent: true,
      unsubscribed: false,
    },
  };
}

// Simple in-memory rate limiter. Serverless instances are short-lived and not
// shared, so this only slows down a burst from one place — which is the point.
function makeRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= limit) { hits.set(key, list); return false; }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

module.exports = {
  DAY_MS,
  utcDay, parseDateOnly, isoDay, addDays, daysBetween, isLeapYear, daysInMonth,
  validMonthDay, birthdayInYear, nextBirthday, daysUntilNextBirthday,
  BIRTHDAY_WINDOW, birthdayReminderDue, birthdayWindowMonths,
  FOLLOWUP_DAYS, FOLLOWUP_MAX_AGE_DAYS, FOLLOWUP_MIN_GAP_HOURS,
  successfulSends, nextFollowup, quoteFollowupBlocker, OPEN_QUOTE_STATUSES, BOOKED_STATUSES,
  AFTER_PARTY_STATUSES, AFTER_PARTY_MAX_LAG_DAYS, afterPartyDue, afterPartyRange,
  automationOn, ownerTwilio, brandOf, bizNameOf, replyToOf,
  validEmail, normalisePhone, senderFrom, esc, firstName, fmtLongDate,
  siteUrl, quoteLink, bookingLink, unsubscribeLink,
  quoteFollowupMessage, afterPartyMessage, birthdayMessage,
  validateBirthdaySignup, makeRateLimiter, UUID_RE,
};
