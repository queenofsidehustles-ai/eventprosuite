module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  const {
    clientEmail, clientName, bizName,
    eventType, eventDate, grand,
    quoteLink, expiryDate,
  } = req.body || {};

  if (!clientEmail || !quoteLink) {
    return res.status(400).json({ error: 'clientEmail and quoteLink are required' });
  }
  if (!RESEND_KEY) {
    return res.status(200).json({ sent: false, note: 'Add RESEND_API_KEY to Vercel env vars to send emails automatically.' });
  }

  const clientFirst = (clientName || 'there').split(' ')[0];
  const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const fmtAmt = n => '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formattedDate = fmtDate(eventDate);
  const formattedExpiry = expiryDate ? new Date(expiryDate + 'T00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

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
.total{font-size:1.5rem;font-weight:800;color:#4C1D95;text-align:center;margin:12px 0 4px}
.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}
</style></head>
<body>
<div class="wrap">
  <div class="top">
    <h1>${bizName || 'Your Party Quote'} 🎉</h1>
    <p>Your personalized event quote is ready to review</p>
  </div>
  <div class="body">
    <p>Hi ${clientFirst},</p>
    <p>Your party quote from <strong>${bizName || 'us'}</strong> is ready! Review everything below and click the button to book your deposit.</p>
    <div class="detail">
      ${eventType ? `<p><strong>Event:</strong> ${eventType}</p>` : ''}
      ${formattedDate ? `<p><strong>Event Date:</strong> ${formattedDate}</p>` : ''}
      ${formattedExpiry ? `<p><strong>Quote expires:</strong> ${formattedExpiry}</p>` : ''}
    </div>
    ${grand ? `<div class="total">${fmtAmt(grand)}</div><p style="text-align:center;font-size:.82rem;color:#888;margin-top:0">Total package price</p>` : ''}
    <a href="${quoteLink}" class="btn">🎀 View My Full Quote</a>
    <p style="font-size:.82rem;color:#888">If the button doesn't work, copy this link into your browser:<br>${quoteLink}</p>
  </div>
  <div class="footer">Questions? Reply to this email and we'll get back to you right away.</div>
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
        subject: `🎉 Your party quote from ${bizName || 'us'}${eventType ? ' — ' + eventType : ''}`,
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
