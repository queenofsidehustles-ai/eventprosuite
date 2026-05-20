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
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtcXdvZGR3enBmbm1wanR3aWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mzk2ODksImV4cCI6MjA5MjExNTY4OX0.pHh7BI25YYlMDqN2FmBsKCrHpvgi7zb3IUizMDUr2K4';

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

  return res.json({ processed: results.length, results });
};
