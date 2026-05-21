module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  const {
    clientEmail, clientName, bizName, bizEmail, bizPhone,
    eventDate, eventTime, eventAddress, eventServices,
    totalPrice, depositAmount, signingUrl,
  } = req.body || {};

  if (!clientEmail || !signingUrl) {
    return res.status(400).json({ error: 'clientEmail and signingUrl are required' });
  }
  if (!RESEND_KEY) {
    return res.status(200).json({ sent: false, note: 'Add RESEND_API_KEY to Vercel env vars to enable email sending.' });
  }

  const clientFirst = (clientName || 'there').split(' ')[0];
  const formattedDate = eventDate
    ? new Date(eventDate + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const total = parseFloat(String(totalPrice || '0').replace(/[^0-9.]/g, '')) || 0;
  const deposit = parseFloat(String(depositAmount || '0').replace(/[^0-9.]/g, '')) || 0;

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
      ${formattedDate ? `<p><strong>Event Date:</strong> ${formattedDate}</p>` : ''}
      ${eventTime ? `<p><strong>Time:</strong> ${eventTime}</p>` : ''}
      ${eventAddress ? `<p><strong>Location:</strong> ${eventAddress}</p>` : ''}
      ${eventServices ? `<p><strong>Services:</strong> ${eventServices}</p>` : ''}
      ${total > 0 ? `<p><strong>Total:</strong> $${total.toFixed(2)}</p>` : ''}
      ${deposit > 0 ? `<p><strong>Deposit Due:</strong> $${deposit.toFixed(2)}</p>` : ''}
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
        subject: `✍️ Please sign your contract — ${bizName || 'Event Services'}${formattedDate ? ' on ' + formattedDate : ''}`,
        html,
      }),
    });
    const body = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok) {
      return res.status(200).json({ sent: false, note: 'Email delivery failed: ' + (body.message || emailRes.status) });
    }
    return res.json({ sent: true });
  } catch (e) {
    return res.status(200).json({ sent: false, note: 'Email error: ' + e.message });
  }
};
