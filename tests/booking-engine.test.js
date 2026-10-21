'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const e = require('../api/_booking-engine');

const D = s => new Date(s + 'T00:00:00Z');
const H = 3600000;

// ── Birthdays ───────────────────────────────────────────────────────────
test('days until next birthday, same year and across the year boundary', () => {
  assert.equal(e.daysUntilNextBirthday(12, 25, D('2026-12-20')), 5);
  assert.equal(e.daysUntilNextBirthday(1, 5, D('2026-12-20')), 16);
  assert.equal(e.nextBirthday(1, 5, D('2026-12-20')).year, 2027);
  // Today counts as the next birthday, yesterday rolls to next year.
  assert.equal(e.daysUntilNextBirthday(10, 21, D('2026-10-21')), 0);
  assert.equal(e.daysUntilNextBirthday(10, 20, D('2026-10-21')), 364);
  // Time of day does not matter.
  assert.equal(e.daysUntilNextBirthday(10, 22, new Date('2026-10-21T23:30:00Z')), 1);
});

test('Feb 29 birthdays are celebrated on Feb 28 in common years', () => {
  const nb = e.nextBirthday(2, 29, D('2027-01-01'));
  assert.equal(e.isoDay(nb.date), '2027-02-28');
  assert.equal(nb.days, 58);
  const leap = e.nextBirthday(2, 29, D('2028-01-01'));
  assert.equal(e.isoDay(leap.date), '2028-02-29');
  assert.equal(leap.days, 59);
  // Just after Feb 28 in a common year → the next one is in the leap year.
  assert.equal(e.isoDay(e.nextBirthday(2, 29, D('2027-03-01')).date), '2028-02-29');
  assert.ok(e.validMonthDay(2, 29));
  assert.ok(!e.validMonthDay(2, 30));
  assert.ok(!e.validMonthDay(4, 31));
  assert.ok(!e.validMonthDay(13, 1));
});

test('birthday reminder window: 42–56 days, once per birthday year', () => {
  const today = D('2026-10-21');
  const row = { birth_month: 12, birth_day: 9, email: 'a@b.co', consent: true, unsubscribed: false };
  const due = e.birthdayReminderDue(row, today); // Dec 9 is 49 days out
  assert.equal(due.due, true);
  assert.equal(due.days, 49);
  assert.equal(due.year, 2026);
  assert.equal(e.birthdayReminderDue({ ...row, last_reminded_year: 2026 }, today).due, false);
  assert.equal(e.birthdayReminderDue({ ...row, last_reminded_year: 2025 }, today).due, true);
  assert.equal(e.birthdayReminderDue({ ...row, birth_day: 1 }, today).due, false); // Dec 1 is 41 days out
});

test('birthday window edges and exclusions', () => {
  const today = D('2026-10-21');
  const base = { email: 'a@b.co', consent: true, unsubscribed: false };
  const at = days => { const d = e.addDays(today, days); return { ...base, birth_month: d.getUTCMonth() + 1, birth_day: d.getUTCDate() }; };
  assert.equal(e.birthdayReminderDue(at(41), today).due, false);
  assert.equal(e.birthdayReminderDue(at(42), today).due, true);
  assert.equal(e.birthdayReminderDue(at(56), today).due, true);
  assert.equal(e.birthdayReminderDue(at(57), today).due, false);
  assert.equal(e.birthdayReminderDue({ ...at(49), unsubscribed: true }, today).due, false);
  assert.equal(e.birthdayReminderDue({ ...at(49), consent: false }, today).due, false);
  assert.equal(e.birthdayReminderDue({ ...at(49), email: null }, today).due, false);
  // Across New Year: a January birthday reminded in November belongs to next year.
  const nov = D('2026-11-20');
  const jan = e.birthdayReminderDue({ ...base, birth_month: 1, birth_day: 8 }, nov);
  assert.equal(jan.due, true);
  assert.equal(jan.year, 2027);
});

test('window months cover every date in the window', () => {
  assert.deepEqual(e.birthdayWindowMonths(D('2026-10-21')), [12]);
  assert.deepEqual(e.birthdayWindowMonths(D('2026-11-20')), [1]);
  assert.deepEqual(e.birthdayWindowMonths(D('2026-11-10')), [1, 12]);
});

// ── Quote follow-ups ────────────────────────────────────────────────────
test('follow-up schedule: 1, 3 and 7 days, then stop', () => {
  const sentAt = new Date('2026-10-01T14:00:00Z');
  const at = h => new Date(sentAt.getTime() + h * H);
  // Next morning's run (20h later) counts as a day.
  assert.deepEqual(e.nextFollowup({ sentAt, followupsSent: 0, now: at(20) }), { step: 1, markAs: 1 });
  // Too soon.
  assert.equal(e.nextFollowup({ sentAt, followupsSent: 0, now: at(10) }), null);
  // #1 done; #2 waits for day 3.
  assert.equal(e.nextFollowup({ sentAt, followupsSent: 1, lastFollowupAt: at(20), now: at(44) }), null);
  assert.deepEqual(e.nextFollowup({ sentAt, followupsSent: 1, lastFollowupAt: at(20), now: at(68) }), { step: 2, markAs: 2 });
  assert.deepEqual(e.nextFollowup({ sentAt, followupsSent: 2, lastFollowupAt: at(68), now: at(164) }), { step: 3, markAs: 3 });
  assert.equal(e.nextFollowup({ sentAt, followupsSent: 3, lastFollowupAt: at(164), now: at(200) }), null);
});

test('missed runs send one follow-up, not a burst', () => {
  const sentAt = new Date('2026-10-01T14:00:00Z');
  const now = new Date(sentAt.getTime() + 8 * 24 * H);
  assert.deepEqual(e.nextFollowup({ sentAt, followupsSent: 0, now }), { step: 3, markAs: 3 });
  // Too old altogether — a first deploy does not email last month's quotes.
  assert.equal(e.nextFollowup({ sentAt, followupsSent: 0, now: new Date(sentAt.getTime() + 11 * 24 * H) }), null);
});

test('no follow-up right after she re-sent the quote herself', () => {
  const sentAt = new Date('2026-10-01T14:00:00Z');
  const resent = new Date(sentAt.getTime() + 60 * H);
  const now = new Date(sentAt.getTime() + 68 * H);
  assert.equal(e.nextFollowup({ sentAt, lastSendAt: resent, followupsSent: 1, now }), null);
  assert.ok(e.nextFollowup({ sentAt, lastSendAt: resent, followupsSent: 1, now: new Date(resent.getTime() + 20 * H) }));
});

test('successfulSends ignores failures and bad entries', () => {
  const s = e.successfulSends([
    { at: '2026-10-02T10:00:00Z', channel: 'email', ok: true },
    { at: '2026-10-01T10:00:00Z', channel: 'email', ok: false },
    { at: 'nope', ok: true }, null,
    { at: '2026-10-01T12:00:00Z', channel: 'link', ok: true },
  ]);
  assert.deepEqual(s.map(d => d.toISOString()), ['2026-10-01T12:00:00.000Z', '2026-10-02T10:00:00.000Z']);
  assert.deepEqual(e.successfulSends(undefined), []);
});

test('quote follow-up eligibility', () => {
  const today = D('2026-10-21');
  const q = {
    id: 'q1', status: 'quote-sent', event_date: '2026-11-15',
    quote_data: { clientEmail: 'mum@example.com', expiryDate: '2026-11-01' },
    send_events: [{ at: '2026-10-20T14:00:00Z', ok: true, channel: 'email' }],
  };
  assert.equal(e.quoteFollowupBlocker(q, { today, bookedQuoteIds: new Set() }), null);
  assert.equal(e.quoteFollowupBlocker({ ...q, status: null }, { today }), null);
  assert.equal(e.quoteFollowupBlocker(q, { today, bookedQuoteIds: new Set(['q1']) }), 'booked');
  assert.equal(e.quoteFollowupBlocker({ ...q, status: 'awaiting-deposit' }, { today }), 'status-awaiting-deposit');
  assert.equal(e.quoteFollowupBlocker({ ...q, status: 'expired' }, { today }), 'status-expired');
  assert.equal(e.quoteFollowupBlocker({ ...q, quote_data: { ...q.quote_data, acceptedAt: 'x' } }, { today }), 'accepted');
  assert.equal(e.quoteFollowupBlocker({ ...q, event_date: '2026-10-20' }, { today }), 'event-past');
  assert.equal(e.quoteFollowupBlocker({ ...q, quote_data: { ...q.quote_data, expiryDate: '2026-10-20' } }, { today }), 'quote-expired');
  assert.equal(e.quoteFollowupBlocker({ ...q, quote_data: { clientEmail: '' } }, { today }), 'no-email');
  assert.equal(e.quoteFollowupBlocker({ ...q, send_events: [] }, { today }), 'not-sent');
  assert.equal(e.quoteFollowupBlocker({ ...q, send_events: [{ at: '2026-10-20T14:00:00Z', ok: false }] }, { today }), 'not-sent');
});

// ── After-party ─────────────────────────────────────────────────────────
test('after-party: from the day after the event, up to a week late', () => {
  const today = D('2026-10-21');
  assert.equal(e.afterPartyDue('2026-10-21', today), false);
  assert.equal(e.afterPartyDue('2026-10-20', today), true);
  assert.equal(e.afterPartyDue('2026-10-14', today), true);
  assert.equal(e.afterPartyDue('2026-10-13', today), false);
  assert.equal(e.afterPartyDue('2026-10-25', today), false);
  assert.equal(e.afterPartyDue(null, today), false);
  assert.deepEqual(e.afterPartyRange(today), { from: '2026-10-14', to: '2026-10-20' });
});

// ── Settings ────────────────────────────────────────────────────────────
test('automations default on; Twilio only from her own saved credentials', () => {
  assert.equal(e.automationOn({}, 'afterParty'), true);
  assert.equal(e.automationOn({ automations: { afterParty: true } }, 'afterParty'), true);
  assert.equal(e.automationOn({ automations: { afterParty: false } }, 'afterParty'), false);
  assert.equal(e.automationOn({ automations: { afterParty: false } }, 'quoteFollowups'), true);
  assert.equal(e.ownerTwilio({}), null);
  assert.equal(e.ownerTwilio({ twilio: { sid: 'AC1', token: '', from: '+1' } }), null);
  assert.deepEqual(e.ownerTwilio({ twilio: { sid: ' AC1 ', token: 't', from: '+15551234567' } }),
    { sid: 'AC1', token: 't', from: '+15551234567' });
});

// ── Emails ──────────────────────────────────────────────────────────────
test('emails: honest wording, escaping, unsubscribe on every birthday email', () => {
  const f = e.quoteFollowupMessage({ step: 2, bizName: 'Bear Hug', brand: '#123456', clientName: 'April <b>Jones',
    eventType: 'Spa Party', eventDate: '2026-11-15', link: 'https://x/view-quote.html?id=1', dateOpen: true });
  assert.match(f.html, /would you like me to hold it for you\?/);
  assert.doesNotMatch(f.html, /<b>Jones/);
  assert.match(f.sms, /Reply STOP/);
  const closed = e.quoteFollowupMessage({ step: 1, bizName: 'B', brand: '#123456', clientName: 'A',
    eventDate: '2026-11-15', link: 'L', dateOpen: false });
  assert.doesNotMatch(closed.html, /hold it/);

  const after = e.afterPartyMessage({ bizName: 'B', brand: '#123456', clientName: 'A', childName: 'Mia',
    reviewUrl: '', referralBonus: '', bookLink: 'https://x/book.html?uid=o', optOutLink: null });
  assert.doesNotMatch(after.html, /review/i);
  assert.doesNotMatch(after.html, /they get/);
  assert.match(after.html, /save next year's date/);
  const after2 = e.afterPartyMessage({ bizName: 'B', brand: '#123456', clientName: 'A', childName: 'Mia',
    reviewUrl: 'https://g.page/r/abc', referralBonus: '$25 off', bookLink: 'L', optOutLink: 'U' });
  assert.match(after2.html, /g\.page\/r\/abc/);
  assert.match(after2.html, /Share <strong>B<\/strong> with a friend &mdash; they get \$25 off/);

  const bday = e.birthdayMessage({ bizName: 'B', brand: '#123456', parentName: 'A', childName: 'Mia',
    birthdayDate: D('2026-12-09'), days: 49, bookLink: 'https://x/book.html?uid=o',
    unsubLink: e.unsubscribeLink('https://x', 'abc'), source: 'website' });
  assert.equal(bday.subject, "Mia's birthday is coming up!");
  assert.match(bday.html, /https:\/\/x\/api\/lead-capture\?kind=unsubscribe&amp;id=abc/);
  assert.match(bday.html, /book\.html\?uid=o/);
});

// ── Birthday sign-up validation ─────────────────────────────────────────
test('birthday sign-up validation', () => {
  const ok = { ownerId: '11111111-2222-4333-8444-555555555555', email: 'Mum@Example.com', consent: true,
    birthMonth: 2, birthDay: 29, childName: ' Mia ', parentName: 'April' };
  const v = e.validateBirthdaySignup(ok);
  assert.equal(v.ok, true);
  assert.equal(v.row.email, 'mum@example.com');
  assert.equal(v.row.child_name, 'Mia');
  assert.equal(v.row.consent, true);
  assert.equal(v.row.source, 'website');
  assert.equal(e.validateBirthdaySignup({ ...ok, consent: false }).ok, false);
  assert.equal(e.validateBirthdaySignup({ ...ok, email: '', phone: '' }).ok, false);
  assert.equal(e.validateBirthdaySignup({ ...ok, email: '', phone: '(407) 555-1234' }).ok, true);
  assert.equal(e.validateBirthdaySignup({ ...ok, birthMonth: 2, birthDay: 30 }).ok, false);
  assert.equal(e.validateBirthdaySignup({ ...ok, ownerId: 'nope' }).ok, false);
  const bot = e.validateBirthdaySignup({ ...ok, website: 'http://spam' });
  assert.equal(bot.ok, false);
  assert.equal(bot.silent, true);
});

test('rate limiter', () => {
  const allow = e.makeRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(allow('k', 0), true);
  assert.equal(allow('k', 10), true);
  assert.equal(allow('k', 20), false);
  assert.equal(allow('other', 20), true);
  assert.equal(allow('k', 1500), true);
});

// ── Wiring ──────────────────────────────────────────────────────────────
test('cron and routes are wired, and no new function was added', () => {
  const read = n => fs.readFileSync(path.join(__dirname, '..', n), 'utf8');
  const cron = read('api/send-reminders.js');
  assert.match(cron, /require\('\.\/_booking-engine'\)/);
  for (const fn of ['runQuoteFollowups', 'runAfterParty', 'runBirthdayReminders']) {
    assert.match(cron, new RegExp(`isolated\\('[^']+', \\(\\) => ${fn}\\(now\\)\\)`));
  }
  // Texts only through the owner's own Twilio — never the platform env vars.
  const engineSrc = cron.slice(cron.indexOf('BOOKING ENGINE'));
  assert.doesNotMatch(engineSrc, /TWILIO_/);
  const lead = read('api/lead-capture.js');
  assert.match(lead, /kind === 'birthday'/);
  assert.match(lead, /kind === 'unsubscribe'/);
  const sql = read('migrations/20261021_booking_engine.sql');
  assert.match(sql, /create table if not exists public\.birthday_list/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /add column if not exists followups_sent/);
  assert.match(sql, /add column if not exists after_party_sent/);
  const routes = fs.readdirSync(path.join(__dirname, '..', 'api')).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(routes.length <= 12, `Vercel allows 12 functions; found ${routes.length}`);
});
