module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    ownerUID,
    clientName, clientEmail, clientPhone,
    eventDate, eventTime, eventAddress,
    serviceName, servicePrice,
    numKids, duration,
    bizName, bizEmail, bizPhone,
    depositUpfront,
  } = req.body || {};

  if (!ownerUID || !clientEmail || !eventDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRtcXdvZGR3enBmbm1wanR3aWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mzk2ODksImV4cCI6MjA5MjExNTY4OX0.pHh7BI25YYlMDqN2FmBsKCrHpvgi7zb3IUizMDUr2K4';
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  const signToken = crypto.randomUUID();
  const signingUrl = `https://eventprosuite.vercel.app/sign-contract.html?t=${signToken}`;

  // Build service description
  const parts = [serviceName || 'Party Services'];
  if (numKids) parts.push(`${numKids} kids`);
  if (duration) parts.push(duration);
  const eventServices = parts.join(' · ');

  // Payment amounts
  const totalPrice = parseFloat((servicePrice || '0').toString().replace(/[^0-9.]/g, '')) || 0;
  const depositAmt = depositUpfront && totalPrice > 0 ? Math.round(totalPrice * 0.5 * 100) / 100 : 0;

  // Due dates
  const today = new Date().toISOString().split('T')[0];
  const depositDue = today;
  const balance = eventDate;

  // Standard kids party clauses
  const clauses = {
    paymentText: depositAmt > 0
      ? `A deposit of $${depositAmt.toFixed(2)} (50% of the total) is due upon signing to reserve your event date. The remaining balance of $${(totalPrice - depositAmt).toFixed(2)} is due on the event date.`
      : `Full payment of $${totalPrice.toFixed(2)} is due on the event date. We accept cash, Zelle, CashApp, and credit/debit card.`,
    depositText: 'Deposits are non-refundable. If you need to reschedule, please contact us at least 14 days before your event and your deposit will be applied to a future booking within 12 months.',
    cancellationText: 'Cancellations made 14+ days before the event receive a full refund minus the deposit. Cancellations made fewer than 14 days before the event forfeit the deposit. Cancellations within 72 hours of the event forfeit all payments made.',
    liabilityText: 'Client agrees to provide a safe, accessible setup area. Service Provider is not liable for injuries resulting from rough play, improper use of equipment, or hazardous venue conditions. Client assumes full responsibility for the behavior and safety of all guests.',
    weatherText: 'For outdoor events, please have a backup indoor space available. Service Provider reserves the right to modify setup for safety in extreme weather. Cancellations due to severe weather (hurricane, tornado warning) may be rescheduled at no penalty with 2+ hours notice.',
  };

  // Insert contract via Supabase REST API
  const contractPayload = {
    owner_id: ownerUID,
    biz_name: bizName || '',
    biz_email: bizEmail || '',
    biz_phone: bizPhone || '',
    client_name: clientName || '',
    client_email: clientEmail,
    client_phone: clientPhone || '',
    event_date: eventDate,
    event_time: eventTime || '',
    event_venue: eventAddress || '',
    event_services: eventServices,
    total_price: totalPrice || null,
    deposit_amount: depositAmt || null,
    deposit_due: depositAmt > 0 ? depositDue : null,
    balance_due: balance,
    clauses,
    contract_type: 'service_agreement',
    status: 'pending',
    sign_token: signToken,
    created_at: new Date().toISOString(),
  };

  // Try to save contract to DB — non-fatal if table doesn't exist yet
  try {
    const insertRes = await fetch(`${SUPA_URL}/rest/v1/contracts`, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(contractPayload),
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.warn('Contract DB insert skipped:', errText.slice(0, 200));
    }
  } catch (e) {
    console.warn('Contract DB error (non-fatal):', e.message);
  }

  // Send signing email via Resend (non-fatal if no key)
  let emailSent = false;
  if (RESEND_KEY && clientEmail) {
    const clientFirst = (clientName || 'there').split(' ')[0];
    const formattedDate = new Date(eventDate + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:0}
.wrap{max-width:540px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.top{background:linear-gradient(135deg,#4C1D95,#6D28D9);padding:28px 32px;color:#fff;text-align:center}
.top h1{margin:0;font-size:1.3rem;font-weight:800;letter-spacing:-.02em}
.top p{margin:6px 0 0;font-size:.88rem;opacity:.82}
.body{padding:28px 32px}
.body p{color:#333;line-height:1.7;font-size:.95rem;margin:0 0 16px}
.btn{display:block;background:linear-gradient(135deg,#4C1D95,#6D28D9);color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700;font-size:1rem;margin:24px 0}
.detail{background:#f5f0fb;border-radius:10px;padding:14px 18px;margin-bottom:20px}
.detail p{margin:3px 0;font-size:.88rem;color:#4C1D95}
.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}
</style></head>
<body>
<div class="wrap">
  <div class="top">
    <h1>${bizName || 'Your Event Contract'}</h1>
    <p>Please review and sign your event agreement</p>
  </div>
  <div class="body">
    <p>Hi ${clientFirst},</p>
    <p>Thank you for booking with <strong>${bizName || 'us'}</strong>! Your event is confirmed — we just need your signature to make it official.</p>
    <div class="detail">
      <p><strong>Event Date:</strong> ${formattedDate}</p>
      ${eventTime ? `<p><strong>Time:</strong> ${eventTime}</p>` : ''}
      ${eventAddress ? `<p><strong>Location:</strong> ${eventAddress}</p>` : ''}
      <p><strong>Services:</strong> ${eventServices}</p>
      ${totalPrice > 0 ? `<p><strong>Total:</strong> $${totalPrice.toFixed(2)}</p>` : ''}
      ${depositAmt > 0 ? `<p><strong>Deposit Due:</strong> $${depositAmt.toFixed(2)}</p>` : ''}
    </div>
    <p>Click the button below to review your contract and sign digitally. It only takes about 2 minutes!</p>
    <a href="${signingUrl}" class="btn">✍️ Review & Sign My Contract</a>
    <p style="font-size:.82rem;color:#888">If the button doesn't work, copy this link into your browser:<br>${signingUrl}</p>
  </div>
  <div class="footer">Questions? Reply to this email or contact ${bizEmail || bizName || 'us'} directly${bizPhone ? ' at ' + bizPhone : ''}.</div>
</div>
</body></html>`;

    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: clientEmail,
          subject: `✍️ Please sign your contract — ${bizName || 'Event Services'} on ${formattedDate}`,
          html,
        }),
      });
      emailSent = emailRes.ok;
    } catch (_) { /* non-fatal */ }
  }

  return res.json({
    success: true,
    signing_url: signingUrl,
    email_sent: emailSent,
    note: emailSent ? null : (RESEND_KEY ? 'Email delivery may have failed.' : 'Add RESEND_API_KEY to Vercel env vars to enable email sending.'),
  });
};
