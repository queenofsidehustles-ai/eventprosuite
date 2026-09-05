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

// This cron reads and updates OTHER people's bookings, which the anon key can
// never do — row-level security only lets a logged-in owner see their own rows,
// and gives anon no read or update at all. Running on the anon key is why this
// job has silently processed zero bookings on every run.
//
// The service-role key bypasses RLS. It lives only in Vercel's env (server
// side) and must never appear in browser code.
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

async function sendEmail({ to, clientName, bizName, eventDate, stripeLink, daysUntil, fromEmail }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no RESEND_API_KEY' };

  const formatted = new Date(eventDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
            This is a friendly reminder that your <strong>remaining balance is due</strong> before the event.
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

  // Simple auth: require a secret header or param so random people can't trigger it
  const secret = process.env.CRON_SECRET || 'pbh-cron';
  const provided = req.headers['x-cron-secret'] || req.query.secret;
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

  if (!Array.isArray(bookings)) {
    return res.status(500).json({ error: 'Could not fetch bookings', detail: bookings });
  }

  const results = [];

  for (const booking of bookings) {
    // Load owner profile to get business name + Stripe link
    const profiles = await supabaseGet(
      `profiles?id=eq.${booking.owner_id}&select=profile_data&limit=1`
    );
    const pd = (profiles[0] && profiles[0].profile_data) || {};
    const bizName = pd.businessName || 'Your Party Business';
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@partybizhub.com';

    // Pick the right Stripe link based on service price
    const price = parseFloat((booking.service_price || '0').replace(/[^0-9.]/g, '')) || 0;
    let stripeLink = '';
    if (price >= 1000) stripeLink = pd.stripe1000 || pd.stripe500 || '';
    else if (price >= 500) stripeLink = pd.stripe500 || pd.stripe250 || '';
    else if (price >= 250) stripeLink = pd.stripe250 || pd.stripe100 || '';
    else stripeLink = pd.stripe100 || '';

    const eventDate = new Date(booking.event_date);
    const daysUntil = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));

    const result = await sendEmail({
      to: booking.client_email,
      clientName: booking.client_name,
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
  const deposits = await runDepositHold(today);

  return res.json({
    processed: results.length,
    results,
    deposits
  });
};


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
  const apiKey = process.env.RESEND_API_KEY;
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
        from: process.env.RESEND_FROM_EMAIL || 'noreply@partybizhub.com',
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
