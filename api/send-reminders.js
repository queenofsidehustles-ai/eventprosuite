// A pasted environment value can carry a trailing newline that survives
// invisibly and then fails authentication with an error blaming the key.
const env = name => String(process.env[name] || '').trim();
/**
 * send-reminders.js
 * Called daily by Vercel Cron (see vercel.json).
 * Finds bookings where:
 *   - status is 'deposit-paid' or 'confirmed'
 *   - event_date is exactly 7 or 14 days from today
 *   - a balance reminder hasn't been sent yet
 * Sends a balance-due email to the client via Resend.
 */

const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const engine = require('./_booking-engine');

// This cron reads and updates OTHER people's bookings, which the anon key can
// never do — row-level security only lets a logged-in owner see their own rows,
// and gives anon no read or update at all. Running on the anon key is why this
// job has silently processed zero bookings on every run.
//
// The service-role key bypasses RLS. It lives only in Vercel's env (server
// side) and must never appear in browser code.
const SUPA_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

async function supabaseGet(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }
  });
  return res.json();
}

async function supabasePatch(table, id, body) {
  return fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
}

async function sendEmail({ to, clientName, bizName, eventDate, stripeLink, daysUntil, fromEmail, balanceDue }) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) return { ok: false, reason: 'no RESEND_API_KEY' };

  const formatted = new Date(eventDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  // "due before the event" told the customer nothing she could act on, and
  // disagreed with the contract, which used to say the event date. Both now
  // come from the same rule, so this states the date the owner actually set.
  // A reminder can land after that date — the cron fires 14 and 7 days out
  // whatever the terms are — so an overdue balance says so rather than
  // cheerfully calling itself upcoming.
  const dueDate = balanceDue ? new Date(balanceDue + 'T00:00:00') : null;
  const dueFmt = dueDate && !isNaN(dueDate)
    ? dueDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : '';
  const overdue = dueDate && !isNaN(dueDate) && dueDate < new Date(new Date().toDateString());
  const dueSentence = !dueFmt
    ? 'your <strong>remaining balance is due</strong> before the event'
    : overdue
    ? `your <strong>remaining balance was due on ${dueFmt}</strong>`
    : `your <strong>remaining balance is due by ${dueFmt}</strong>`;

  const payLine = stripeLink
    ? `<p style="margin:18px 0"><a href="${stripeLink}" style="background:#6D28D9;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Pay My Balance Now →</a></p>`
    : '<p style="color:#6C6473;font-size:14px">Please contact us to arrange your final payment.</p>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail || 'noreply@partybizhub.com',
      to: [to],
      subject: `Reminder: Balance due for your party on ${formatted}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#1F1A24">
          <h2 style="font-size:22px;margin-bottom:8px">Hi ${clientName}! 🎉</h2>
          <p style="color:#6C6473;font-size:15px;line-height:1.6">
            Your party with <strong>${bizName}</strong> is coming up in <strong>${daysUntil} days</strong>
            on <strong>${formatted}</strong>. We can't wait to make it amazing!
          </p>
          <p style="font-size:15px;line-height:1.6;margin-top:16px">
            This is a friendly reminder that ${dueSentence}.
            Please use the button below to complete your payment:
          </p>
          ${payLine}
          <p style="font-size:13px;color:#6C6473;margin-top:24px;line-height:1.6">
            Questions? Just reply to this email or reach out directly. We're here to help make your celebration perfect.
          </p>
          <p style="font-size:13px;color:#6C6473">— The ${bizName} Team</p>
        </div>
      `
    })
  });
  return { ok: res.ok, status: res.status };
}

module.exports = async function handler(req, res) {
  // Allow manual trigger via GET; Vercel cron also uses GET
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Only Vercel Cron may run this. When CRON_SECRET is set in Vercel's
  // environment, Vercel sends it automatically as "Authorization: Bearer <secret>".
  // The secret never appears in the code or in vercel.json.
  const secret = env('CRON_SECRET');
  if (!secret) {
    console.error('send-reminders: CRON_SECRET is not set in Vercel, so reminders are paused.');
    return res.status(500).json({ error: 'Reminders are not configured' });
  }
  const auth = String(req.headers['authorization'] || '');
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.headers['x-cron-secret'] || '').trim();
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  if (!SUPA_KEY) {
    return res.status(500).json({
      error: 'SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel → Settings → ' +
             'Environment Variables (Supabase → Project Settings → API → service_role). ' +
             'Without it this job cannot read bookings and silently does nothing.'
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const in7  = new Date(today); in7.setDate(today.getDate() + 7);
  const in14 = new Date(today); in14.setDate(today.getDate() + 14);

  const fmt = d => d.toISOString().split('T')[0];

  // Fetch bookings due in 7 or 14 days that haven't had a reminder sent
  const bookings = await supabaseGet(
    `bookings?event_date=in.(${fmt(in7)},${fmt(in14)})&status=in.(deposit-paid,confirmed)&reminder_sent=is.null&select=*`
  );

  // A failure here used to end the whole run. It is now recorded and the
  // other sections still run.
  const balanceError = Array.isArray(bookings) ? null : { error: 'Could not fetch bookings', detail: bookings };

  const results = [];

  for (const booking of (Array.isArray(bookings) ? bookings : [])) {
    // Load owner profile to get business name + Stripe link
    const profiles = await supabaseGet(
      `profiles?id=eq.${booking.owner_id}&select=profile_data&limit=1`
    );
    const pd = (profiles[0] && profiles[0].profile_data) || {};
    const bizName = pd.businessName || 'Your Party Business';
    const fromEmail = env('RESEND_FROM_EMAIL') || 'noreply@partybizhub.com';

    // Pick the right Stripe link based on service price
    const price = parseFloat((booking.service_price || '0').replace(/[^0-9.]/g, '')) || 0;
    let stripeLink = '';
    if (price >= 1000) stripeLink = pd.stripe1000 || pd.stripe500 || '';
    else if (price >= 500) stripeLink = pd.stripe500 || pd.stripe250 || '';
    else if (price >= 250) stripeLink = pd.stripe250 || pd.stripe100 || '';
    else stripeLink = pd.stripe100 || '';

    const eventDate = new Date(booking.event_date);
    const daysUntil = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));

    // The terms the customer agreed to on her quote, falling back to the
    // business default — the same resolution the contract used.
    let reminderQuote = {};
    if (booking.quote_id) {
      const rows = await supabaseGet(
        `saved_quotes?id=eq.${booking.quote_id}&select=quote_data&limit=1`
      ).catch(() => []);
      reminderQuote = (Array.isArray(rows) && rows[0] && rows[0].quote_data) || {};
    }

    const result = await sendEmail({
      to: booking.client_email,
      clientName: booking.client_name,
      balanceDue: balanceDueDate(booking.event_date, pd, reminderQuote),
      bizName,
      eventDate: booking.event_date,
      stripeLink,
      daysUntil,
      fromEmail
    });

    // Mark reminder sent so we don't double-send
    if (result.ok) {
      await supabasePatch('bookings', booking.id, { reminder_sent: new Date().toISOString() });
    }

    results.push({ booking_id: booking.id, client: booking.client_email, daysUntil, emailSent: result.ok });
  }

  // ── Deposit hold: nudge at 24h, release at 48h ──────────────────────
  // A booking made from a quote page is 'awaiting-deposit' with a
  // deposit_due_at 48 hours out. The customer was told plainly that the date
  // is not held until the deposit lands, so releasing it here is not a
  // surprise — but we always nudge first.
  // Every section below runs on its own: one throwing (or its migration not
  // being run yet) must never stop the others.
  const isolated = async (name, fn) => {
    try { return await fn(); }
    catch (e) {
      console.error(`send-reminders: ${name} failed:`, e);
      return { error: String((e && e.message) || e) };
    }
  };
  const deposits = await isolated('deposit hold', () => runDepositHold(today));

  // ── Bundled Hub access: warn, then close ───────────────────────────
  const hubAccess = await isolated('hub access', async () => await runHubAccessExpiry(today));

  // ── Booking engine: follow-ups, thank-yous, birthdays ──────────────
  // All three are safe to run several times a day: each send is recorded
  // (and carries a Resend idempotency key) so it is never picked up twice.
  const now = new Date();
  const quoteFollowups = await isolated('quote follow-ups', () => runQuoteFollowups(now));
  const afterParty = await isolated('after-party', () => runAfterParty(now));
  const birthdays = await isolated('birthday reminders', () => runBirthdayReminders(now));

  return res.json({
    processed: results.length,
    ...(balanceError ? { balanceError } : {}),
    results,
    deposits,
    hubAccess,
    quoteFollowups,
    afterParty,
    birthdays
  });
};


// ══════════════════════════════════════════════════════════════════════
// BOOKING ENGINE
// The rules (timing, eligibility, wording) live in ./_booking-engine.js and
// are unit-tested there. This part only reads, sends and records.
// ══════════════════════════════════════════════════════════════════════

const SITE_URL = () => engine.siteUrl(env('PUBLIC_SITE_URL') || 'https://partybizhub.com');
const BE_FROM = () => env('RESEND_FROM_EMAIL') || 'Party Biz Hub <support@partybizhub.com>';

// One profile read per owner per run.
function profileLoader() {
  const cache = new Map();
  return async ownerId => {
    if (cache.has(ownerId)) return cache.get(ownerId);
    const rows = await supabaseGet(
      `profiles?id=eq.${encodeURIComponent(ownerId)}&select=id,email,profile_data&limit=1`
    );
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const value = row ? { email: row.email, pd: { ...(row.profile_data || {}) } } : null;
    // Twilio creds live in private_settings (owner-only), never in profile_data,
    // which other signed-in users can read.
    if (value) {
      delete value.pd.twilio;
      try {
        const sec = await supabaseGet(
          `private_settings?owner_id=eq.${encodeURIComponent(ownerId)}&select=twilio&limit=1`
        );
        if (Array.isArray(sec) && sec[0] && sec[0].twilio) value.pd.twilio = sec[0].twilio;
      } catch (_) { /* table not created yet: texting simply stays off */ }
    }
    cache.set(ownerId, value);
    return value;
  };
}

async function beSendEmail({ to, pd, ownerEmail, subject, html, idempotencyKey, unsubscribe }) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) return { ok: false, note: 'no RESEND_API_KEY' };
  const payload = {
    from: engine.senderFrom(engine.bizNameOf(pd), BE_FROM()),
    to,
    reply_to: engine.replyToOf(pd, ownerEmail),
    subject,
    html,
  };
  if (unsubscribe) {
    // Lets Gmail/Apple Mail show their own one-click "Unsubscribe" button.
    payload.headers = {
      'List-Unsubscribe': `<${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        // Resend drops a repeat of the same key within 24 hours, so two cron
        // runs on the same day can never double-send.
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return { ok: false, note: d.message || `Resend ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, note: e.message };
  }
}

// A text through the OWNER'S Twilio account — never the platform's env vars.
// Only ever called when she has saved her own credentials.
async function beSendOwnerText(creds, toRaw, body) {
  const to = engine.normalisePhone(toRaw);
  if (!to) return { ok: false, note: 'no usable phone' };
  try {
    const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString('base64');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: creds.from, Body: body }).toString(),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return { ok: false, note: d.code === 21610 ? 'recipient opted out' : (d.message || `Twilio ${r.status}`) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, note: e.message };
  }
}

async function beFetchJSON(path, options) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      ...(options && options.headers),
    },
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}


// ── 1. Quote follow-ups ──────────────────────────────────────────────────
// A quote that went out and heard nothing back gets up to three short,
// friendly check-ins: ~1 day, 3 days and 7 days after it was first sent.
// Stops the moment the customer books, the quote expires, the event date
// passes, or the owner switches automations.quoteFollowups off.
async function runQuoteFollowups(now) {
  const out = { checked: 0, sent: [], texted: 0, skipped: {}, errors: [] };
  const today = engine.utcDay(now);
  const skip = reason => { out.skipped[reason] = (out.skipped[reason] || 0) + 1; };

  // Bounded so the query stays small: nothing older than this can still be
  // inside the follow-up window.
  const since = new Date(now.getTime() - 60 * engine.DAY_MS).toISOString();
  const quotes = await supabaseGet(
    `saved_quotes?or=(status.is.null,status.eq.quote-sent)&followups_sent=lt.${engine.FOLLOWUP_DAYS.length}` +
    `&created_at=gte.${since}` +
    `&select=id,user_id,client_name,event_date,event_type,status,quote_data,send_events,followups_sent,last_followup_at` +
    `&order=created_at.asc&limit=1000`
  );
  if (!Array.isArray(quotes)) return { error: 'could not fetch quotes (has migrations/20261021_booking_engine.sql been run?)', detail: quotes };
  out.checked = quotes.length;

  // Quotes the customer has already acted on.
  const booked = new Set();
  const ids = quotes.map(q => q.id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await supabaseGet(
      `bookings?quote_id=in.(${chunk.join(',')})&status=in.(${engine.BOOKED_STATUSES.join(',')})&select=quote_id`
    );
    if (!Array.isArray(rows)) throw new Error('could not check bookings for these quotes');
    rows.forEach(r => r.quote_id && booked.add(String(r.quote_id)));
  }

  const loadProfile = profileLoader();
  for (const q of quotes) {
    try {
      const blocker = engine.quoteFollowupBlocker(q, { today, bookedQuoteIds: booked });
      if (blocker) { skip(blocker); continue; }

      const sends = engine.successfulSends(q.send_events);
      const due = engine.nextFollowup({
        sentAt: sends[0], lastSendAt: sends[sends.length - 1],
        followupsSent: q.followups_sent, lastFollowupAt: q.last_followup_at, now,
      });
      if (!due) { skip('not-due'); continue; }

      const owner = await loadProfile(q.user_id);
      if (!owner) { skip('no-owner'); continue; }
      const pd = owner.pd;
      if (!engine.automationOn(pd, 'quoteFollowups')) { skip('switched-off'); continue; }

      const qd = q.quote_data || {};
      const eventDate = q.event_date || qd.eventDate || null;

      // "Your date is still open" is only said when it is true: nothing
      // held or booked on her calendar that day.
      let dateOpen = false;
      if (engine.parseDateOnly(eventDate)) {
        const clash = await supabaseGet(
          `bookings?owner_id=eq.${encodeURIComponent(q.user_id)}&event_date=eq.${String(eventDate).slice(0, 10)}` +
          `&status=in.(awaiting-deposit,deposit-paid,confirmed)&select=id&limit=1`
        );
        dateOpen = Array.isArray(clash) && clash.length === 0;
      }

      const bizName = engine.bizNameOf(pd);
      const link = engine.quoteLink(SITE_URL(), q.id);
      const msg = engine.quoteFollowupMessage({
        step: due.step, bizName, brand: engine.brandOf(pd),
        clientName: qd.clientName || q.client_name, eventType: qd.eventType || q.event_type,
        eventDate, link, dateOpen,
      });

      const sent = await beSendEmail({
        to: engine.validEmail(qd.clientEmail), pd, ownerEmail: owner.email,
        subject: msg.subject, html: msg.html,
        idempotencyKey: `quote-followup/${q.id}/${due.step}`,
      });
      if (!sent.ok) { out.errors.push({ quote_id: q.id, step: due.step, note: sent.note }); continue; }

      const patch = await supabasePatch('saved_quotes', q.id, {
        followups_sent: due.markAs,
        last_followup_at: new Date().toISOString(),
      });
      if (!patch.ok) out.errors.push({ quote_id: q.id, step: due.step, note: 'sent but not recorded' });

      // Text too, through HER Twilio, when she has connected it.
      const creds = engine.ownerTwilio(pd);
      if (creds && qd.clientPhone) {
        const t = await beSendOwnerText(creds, qd.clientPhone, msg.sms);
        if (t.ok) out.texted++;
        else out.errors.push({ quote_id: q.id, step: due.step, text: t.note });
      }
      out.sent.push({ quote_id: q.id, step: due.step });
    } catch (e) {
      out.errors.push({ quote_id: q.id, note: e.message });
    }
  }
  return out;
}


// ── 2. After the party ───────────────────────────────────────────────────
// The day after the event: thank you, a review link (if she has one), her
// referral offer (if she has one), and an invitation to save next year's
// date. The child goes on her birthday list for next year's reminder.
async function runAfterParty(now) {
  const out = { checked: 0, sent: [], addedToBirthdayList: 0, skipped: {}, errors: [] };
  const today = engine.utcDay(now);
  const skip = reason => { out.skipped[reason] = (out.skipped[reason] || 0) + 1; };
  const range = engine.afterPartyRange(today);

  const bookings = await supabaseGet(
    `bookings?status=in.(${engine.AFTER_PARTY_STATUSES.join(',')})&after_party_sent=is.null` +
    `&event_date=gte.${range.from}&event_date=lte.${range.to}&select=*&limit=500`
  );
  if (!Array.isArray(bookings)) return { error: 'could not fetch bookings (has migrations/20261021_booking_engine.sql been run?)', detail: bookings };
  out.checked = bookings.length;

  const loadProfile = profileLoader();
  for (const b of bookings) {
    try {
      if (!engine.afterPartyDue(b.event_date, today)) { skip('not-due'); continue; }
      const owner = await loadProfile(b.owner_id);
      if (!owner) { skip('no-owner'); continue; }
      const pd = owner.pd;
      // Switched off: left unmarked, so turning it back on within the week
      // still thanks this customer.
      if (!engine.automationOn(pd, 'afterParty')) { skip('switched-off'); continue; }

      const email = engine.validEmail(b.client_email);
      if (!email) {
        // Nothing to send and nobody to remind — record it so it is not
        // looked at again every day.
        await supabasePatch('bookings', b.id, { after_party_sent: new Date().toISOString() });
        skip('no-email');
        continue;
      }

      // Birthday list first, so the thank-you can carry a "no thanks" link
      // for next year's reminder.
      let birthdayId = null;
      try {
        birthdayId = await addBookingToBirthdayList(b, email);
        if (birthdayId && birthdayId.added) out.addedToBirthdayList++;
        birthdayId = birthdayId && birthdayId.id;
      } catch (e) {
        out.errors.push({ booking_id: b.id, birthday: e.message });
      }

      const bizName = engine.bizNameOf(pd);
      const site = SITE_URL();
      const msg = engine.afterPartyMessage({
        bizName, brand: engine.brandOf(pd),
        clientName: b.client_name, childName: b.honoree_name,
        reviewUrl: pd.googleReviewUrl, referralBonus: pd.referralBonus,
        bookLink: engine.bookingLink(site, b.owner_id),
        optOutLink: birthdayId && engine.automationOn(pd, 'birthdayReminders')
          ? engine.unsubscribeLink(site, birthdayId) : null,
      });
      const sent = await beSendEmail({
        to: email, pd, ownerEmail: owner.email,
        subject: msg.subject, html: msg.html,
        idempotencyKey: `after-party/${b.id}`,
      });
      if (!sent.ok) { out.errors.push({ booking_id: b.id, note: sent.note }); continue; }

      const patch = await supabasePatch('bookings', b.id, { after_party_sent: new Date().toISOString() });
      if (!patch.ok) out.errors.push({ booking_id: b.id, note: 'sent but not recorded' });
      out.sent.push({ booking_id: b.id });
    } catch (e) {
      out.errors.push({ booking_id: b.id, note: e.message });
    }
  }
  return out;
}

// Adds the booked child to the owner's birthday list, once.
//
// consent is TRUE here because this is an existing customer the business has
// just served — the reminder is a relevant follow-up to that relationship,
// not a cold list sign-up. It is still honest about it: the thank-you email
// says a reminder will come and carries a "no thanks" link, and every
// birthday email has a one-click unsubscribe.
//
// The birthday itself is approximated from the party date (parties are
// usually held close to the birthday); bookings hold no better information.
// For a "save next year's date" reminder the party date is what matters anyway.
async function addBookingToBirthdayList(b, email) {
  const ev = engine.parseDateOnly(b.event_date);
  if (!ev) return null;
  const lower = email.toLowerCase();
  const child = String(b.honoree_name || '').trim();

  const existing = await supabaseGet(
    `birthday_list?owner_id=eq.${encodeURIComponent(b.owner_id)}&email=eq.${encodeURIComponent(lower)}` +
    `&select=id,child_name`
  );
  if (!Array.isArray(existing)) throw new Error('could not read birthday list');
  const same = existing.find(r => String(r.child_name || '').trim().toLowerCase() === child.toLowerCase());
  if (same) return { id: same.id, added: false };

  const ins = await beFetchJSON('birthday_list', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_id: b.owner_id,
      parent_name: b.client_name || null,
      email: lower,
      phone: b.client_phone || null,
      child_name: child || null,
      birth_month: ev.getUTCMonth() + 1,
      birth_day: ev.getUTCDate(),
      source: 'booking',
      consent: true,
    }),
  });
  if (!ins.ok || !Array.isArray(ins.body) || !ins.body[0]) throw new Error('could not add to birthday list');
  return { id: ins.body[0].id, added: true };
}


// ── 3. Birthday reminders ────────────────────────────────────────────────
// About 7 weeks before a child's birthday (any run 42–56 days out, once per
// birthday): "{Child}'s birthday is coming up!" with her booking link and a
// one-click unsubscribe.
async function runBirthdayReminders(now) {
  const out = { checked: 0, sent: [], skipped: {}, errors: [] };
  const today = engine.utcDay(now);
  const skip = reason => { out.skipped[reason] = (out.skipped[reason] || 0) + 1; };
  const months = engine.birthdayWindowMonths(today);

  const rows = await supabaseGet(
    `birthday_list?unsubscribed=is.false&consent=is.true&email=not.is.null` +
    `&birth_month=in.(${months.join(',')})&select=*&limit=2000`
  );
  if (!Array.isArray(rows)) return { error: 'could not fetch birthday list (has migrations/20261021_booking_engine.sql been run?)', detail: rows };
  out.checked = rows.length;

  const loadProfile = profileLoader();
  for (const row of rows) {
    try {
      const due = engine.birthdayReminderDue(row, today);
      if (!due.due) { skip(due.reason); continue; }

      const owner = await loadProfile(row.owner_id);
      if (!owner) { skip('no-owner'); continue; }
      const pd = owner.pd;
      if (!engine.automationOn(pd, 'birthdayReminders')) { skip('switched-off'); continue; }

      // Already booked an upcoming party with her? Then don't ask.
      const upcoming = await supabaseGet(
        `bookings?owner_id=eq.${encodeURIComponent(row.owner_id)}&client_email=ilike.${encodeURIComponent(row.email)}` +
        `&event_date=gte.${engine.isoDay(today)}&status=in.(awaiting-deposit,deposit-paid,confirmed)&select=id&limit=1`
      );
      if (Array.isArray(upcoming) && upcoming.length) {
        await supabasePatch('birthday_list', row.id, { last_reminded_year: due.year });
        skip('already-booked');
        continue;
      }

      const site = SITE_URL();
      const unsub = engine.unsubscribeLink(site, row.id);
      const msg = engine.birthdayMessage({
        bizName: engine.bizNameOf(pd), brand: engine.brandOf(pd),
        parentName: row.parent_name, childName: row.child_name,
        birthdayDate: due.date, days: due.days,
        bookLink: engine.bookingLink(site, row.owner_id),
        unsubLink: unsub, source: row.source,
      });
      const sent = await beSendEmail({
        to: row.email, pd, ownerEmail: owner.email,
        subject: msg.subject, html: msg.html,
        idempotencyKey: `birthday/${row.id}/${due.year}`,
        unsubscribe: unsub,
      });
      if (!sent.ok) { out.errors.push({ id: row.id, note: sent.note }); continue; }

      const patch = await supabasePatch('birthday_list', row.id, { last_reminded_year: due.year });
      if (!patch.ok) out.errors.push({ id: row.id, note: 'sent but not recorded' });
      out.sent.push({ id: row.id, days: due.days });
    } catch (e) {
      out.errors.push({ id: row.id, note: e.message });
    }
  }
  return out;
}


// ── THE YEAR THAT WAS PROMISED ──────────────────────────────────────────
// KPPS is sold as "Party Biz Hub included for one year, then $27/month". The
// purchase sets crm_access_expires_at twelve months out; this closes the year
// when it arrives, and — more importantly — warns them well before it does.
//
// Nobody should discover this by finding their quote builder gone. They are
// told at 30 days, 7 days and on the last day, every message carrying the
// price and a link to continue.
async function runHubAccessExpiry(today) {
  const out = { warned: [], closed: [], errors: [] };
  const FROM_EMAIL = env('RESEND_FROM_EMAIL') || 'Party Biz Hub <support@partybizhub.com>';
  const RESEND_KEY = env('RESEND_API_KEY');

  const dayISO = offset => {
    const d = new Date(today); d.setDate(today.getDate() + offset);
    return d.toISOString().split('T')[0];
  };

  // ── Warnings at 30, 7 and 1 days out.
  for (const days of [30, 7, 1]) {
    const target = dayISO(days);
    const rows = await supabaseGet(
      `profiles?has_crm_access=is.true&crm_access_expires_at=gte.${target}T00:00:00Z` +
      `&crm_access_expires_at=lt.${target}T23:59:59Z&select=id,email,full_name,profile_data,crm_access_expires_at`
    );
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      const pd = row.profile_data || {};
      // A reminder already sent for this milestone must not go again — the
      // cron runs daily and a repeated "your access ends in 7 days" is worse
      // than none at all.
      const sent = Array.isArray(pd.hubExpiryRemindersSent) ? pd.hubExpiryRemindersSent : [];
      if (sent.includes(days)) continue;

      const to = validEmail(pd.contactEmail) || validEmail(pd.bizEmail) || validEmail(row.email);
      if (!to) continue;

      const ok = await sendHubExpiryEmail({
        RESEND_KEY, FROM_EMAIL, to, days,
        name: pd.businessName || row.full_name || 'there',
        endsOn: row.crm_access_expires_at,
      });
      if (!ok) { out.errors.push({ id: row.id, days }); continue; }

      await supabasePatch('profiles', row.id, {
        profile_data: { ...pd, hubExpiryRemindersSent: [...sent, days] },
      });
      out.warned.push({ id: row.id, days });
    }
  }

  // ── The year is up. KPPS training access is untouched; only the bundled
  //    Hub tools close, which is exactly what was sold.
  const nowISO = new Date().toISOString();
  const lapsed = await supabaseGet(
    `profiles?has_crm_access=is.true&crm_access_expires_at=lt.${nowISO}&select=id,email,profile_data`
  );
  if (Array.isArray(lapsed)) {
    for (const row of lapsed) {
      const r = await supabasePatch('profiles', row.id, { has_crm_access: false });
      if (r && r.ok) out.closed.push(row.id);
      else out.errors.push({ id: row.id, step: 'close' });
    }
  }

  return out;
}

function validEmail(value) {
  const v = String(value || '').trim();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : null;
}

async function sendHubExpiryEmail({ RESEND_KEY, FROM_EMAIL, to, days, name, endsOn }) {
  if (!RESEND_KEY) return false;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const when = (() => {
    const d = new Date(endsOn);
    return isNaN(d) ? 'soon' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  })();
  const headline = days === 1 ? 'Your included Hub year ends tomorrow'
    : days === 7 ? 'One week left of your included Hub year'
    : 'Your included Hub year ends in 30 days';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#F5F3F7;font-family:Inter,Arial,sans-serif">
<div style="max-width:540px;margin:28px auto;background:#fff;border-radius:16px;overflow:hidden">
  <div style="background:#4C1D95;padding:24px 30px;color:#fff">
    <h1 style="margin:0;font-size:1.25rem;font-weight:800">${esc(headline)}</h1>
  </div>
  <div style="padding:26px 30px;color:#2F1E3B;font-size:.95rem;line-height:1.7">
    <p style="margin:0 0 16px">Hi ${esc(name)},</p>
    <p style="margin:0 0 16px">
      Your Kids Party Profit System purchase included a full year of Party Biz Hub —
      quotes, contracts, bookings, your website and the rest. That year ends on
      <strong>${esc(when)}</strong>.
    </p>
    <p style="margin:0 0 16px">
      To keep your quotes, contracts and bookings exactly where they are, continue for
      <strong>$27/month</strong>. Nothing moves and nothing is lost — your account carries straight on.
    </p>
    <p style="margin:0 0 20px;padding:14px 16px;background:#FAF7FB;border-radius:10px;font-size:.88rem">
      Your <strong>KPPS training, playbooks and templates stay yours for life</strong>.
      This is only about the Hub software.
    </p>
    <a href="https://www.partybizhub.com/#pricing" style="display:block;background:#4C1D95;color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700">Keep my Hub for $27/month &rarr;</a>
    <p style="margin:18px 0 0;font-size:.82rem;color:#8A7A96">
      Do nothing and the Hub tools simply close on ${esc(when)}. Your data is kept, so you can pick up again any time.
    </p>
  </div>
</div>
</body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
        'Idempotency-Key': `hub-expiry/${days}/${to}`,
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject: headline, html }),
    });
    return r.ok;
  } catch (e) {
    console.error('Hub expiry email failed:', e);
    return false;
  }
}


async function runDepositHold(today) {
  const nowISO = new Date().toISOString();

  const pending = await supabaseGet(
    `bookings?status=eq.awaiting-deposit&deposit_due_at=not.is.null&select=*`
  );
  if (!Array.isArray(pending)) return { error: 'could not fetch pending deposits', detail: pending };

  const nudged = [];
  const released = [];

  for (const b of pending) {
    const due = new Date(b.deposit_due_at);
    if (isNaN(due)) continue;

    // Past the deadline. Nobody loses a date without a warning first — if the
    // nudge never went out (cron outage, deploy gap, booking made between
    // runs), send it now and give them a fresh 24 hours instead of releasing.
    if (due <= new Date()) {
      if (!b.deposit_reminder_sent) {
        const profiles = await supabaseGet(`profiles?id=eq.${b.owner_id}&select=profile_data&limit=1`);
        const pd = (profiles[0] && profiles[0].profile_data) || {};
        const newDue = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const sent = await sendDepositNudge(b, pd, newDue);
        await supabasePatch('bookings', b.id, {
          deposit_due_at: newDue.toISOString(),
          deposit_reminder_sent: sent ? nowISO : null,
        });
        nudged.push({ booking_id: b.id, client: b.client_email, note: 'grace period — never warned' });
        continue;
      }
      await supabasePatch('bookings', b.id, { status: 'expired' });
      released.push({ booking_id: b.id, client: b.client_email });
      continue;
    }

    // Inside the final 24 hours and not yet nudged.
    const hoursLeft = (due - new Date()) / (1000 * 60 * 60);
    if (hoursLeft <= 24 && !b.deposit_reminder_sent) {
      const profiles = await supabaseGet(`profiles?id=eq.${b.owner_id}&select=profile_data&limit=1`);
      const pd = (profiles[0] && profiles[0].profile_data) || {};
      const sent = await sendDepositNudge(b, pd, due);
      if (sent) {
        await supabasePatch('bookings', b.id, { deposit_reminder_sent: nowISO });
        nudged.push({ booking_id: b.id, client: b.client_email });
      }
    }
  }

  return { checked: pending.length, nudged, released };
}


async function sendDepositNudge(booking, pd, due) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey || !booking.client_email) return false;

  const bizName = pd.bizName || pd.businessName || 'Your Party Business';
  const brand = /^#[0-9a-fA-F]{6}$/.test(pd.brandPrimary || '') ? pd.brandPrimary
              : /^#[0-9a-fA-F]{6}$/.test(pd.brandColor || '')   ? pd.brandColor
              : '#6D28D9';
  const first = (booking.client_name || 'there').trim().split(/\s+/)[0];

  const price = parseFloat(String(booking.service_price || '0').replace(/[^0-9.]/g, '')) || 0;
  let link = '';
  if (price >= 1000) link = pd.stripe1000 || pd.stripe500 || '';
  else if (price >= 500) link = pd.stripe500 || pd.stripe250 || '';
  else if (price >= 250) link = pd.stripe250 || pd.stripe100 || '';
  else link = pd.stripe100 || '';

  const when = new Date(booking.event_date + 'T00:00:00');
  const eventTxt = isNaN(when) ? 'your event'
    : when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const dueTxt = due.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    + ' at ' + due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f2f8;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${brand};padding:26px 30px;text-align:center">
  <p style="margin:0;font-size:18px;font-weight:800;color:#fff">${bizName}</p>
  <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.85)">Your date is still on hold</p>
</td></tr>
<tr><td style="padding:28px 30px">
  <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#3a2a4a">
    Hi ${first}, just a quick reminder — we're holding <strong>${eventTxt}</strong> for you,
    but the deposit hasn't come through yet.
  </p>
  <table role="presentation" width="100%" style="background:#fff8e6;border:1px solid #f5d97a;border-radius:12px;margin:0 0 20px">
    <tr><td style="padding:16px 18px">
      <p style="margin:0;font-size:14px;line-height:1.65;color:#78350f">
        We can hold your date until <strong>${dueTxt}</strong>. After that it goes
        back on our calendar for someone else.
      </p>
    </td></tr>
  </table>
  ${link ? `<table role="presentation" width="100%" style="margin:0 0 18px"><tr><td align="center">
    <a href="${link}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:800;font-size:15px">Pay my deposit &rarr;</a>
  </td></tr></table>` : ''}
  <p style="margin:0;font-size:14px;line-height:1.7;color:#3a2a4a">
    Already paid? Ignore this — and reply if anything looks wrong.
  </p>
</td></tr>
</table></td></tr></table></body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env('RESEND_FROM_EMAIL') || 'noreply@partybizhub.com',
        to: booking.client_email,
        reply_to: pd.bizEmail || pd.contactEmail || undefined,
        subject: `Your date is still on hold — ${bizName}`,
        html,
      }),
    });
    return r.ok;
  } catch (e) {
    console.error('Deposit nudge failed:', e.message);
    return false;
  }
}


/* When the remaining balance is due.
   ─────────────────────────────────────────────────────────────────────
   One number, `balanceDueDays`: whole days BEFORE the event, 0 meaning on
   the day itself. The quote may override the business default, because the
   terms genuinely differ per client — 48 hours for one, a week for another.

   This replaces three separate sentences that disagreed: the quote page said
   "before your event", the contract said "on the event date", and the
   reminder emails said "before the event". Everything now says the same
   thing, and states the actual date wherever there is one to state.

   Mirrored in the browser and on the server on purpose — the same reason
   slidingDepositPct is. The server's copy is the one that writes contracts;
   the browser's only describes them. */
function balanceDueDaysFrom(profileData, quoteData) {
  const pick = value => {
    // Number(null) is 0, and 0 is a real answer here ("on the day of your
    // event"), so emptiness must be rejected BEFORE the numeric check.
    // Otherwise a quote saved as "use my default" — which stores null —
    // silently resolves to day-of, which is the common case.
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 365 ? Math.round(n) : null;
  };
  const override = pick((quoteData || {}).balanceDueDays);
  if (override !== null) return override;
  return pick((profileData || {}).balanceDueDays);
}

// The phrase a customer reads. Falls back to whatever legacy paymentTerms
// text an owner already had, and then to the old vague wording, so a business
// that has never opened the new setting reads exactly as it did before.
function balanceDuePhrase(profileData, quoteData) {
  const days = balanceDueDaysFrom(profileData, quoteData);
  if (days === null) return (profileData || {}).paymentTerms || 'before your event';
  if (days === 0) return 'on the day of your event';
  if (days === 1) return '24 hours before your event';
  if (days === 2) return '48 hours before your event';
  if (days === 7) return '1 week before your event';
  if (days === 14) return '2 weeks before your event';
  if (days % 7 === 0) return (days / 7) + ' weeks before your event';
  return days + ' days before your event';
}

// The actual calendar date, when the event date is known. Returned as
// YYYY-MM-DD so it can go straight into a date column.
function balanceDueDate(eventDate, profileData, quoteData) {
  const days = balanceDueDaysFrom(profileData, quoteData);
  if (days === null || !eventDate) return null;
  const ev = new Date(String(eventDate).length <= 10 ? eventDate + 'T00:00:00' : eventDate);
  if (isNaN(ev)) return null;
  ev.setDate(ev.getDate() - days);
  const pad = n => String(n).padStart(2, '0');
  return ev.getFullYear() + '-' + pad(ev.getMonth() + 1) + '-' + pad(ev.getDate());
}
