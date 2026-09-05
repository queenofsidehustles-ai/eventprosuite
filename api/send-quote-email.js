/**
 * Customer-facing emails.
 *
 * Two jobs share this one route on purpose: Vercel's Hobby plan allows 12
 * serverless functions and /api is already at 12. A separate
 * send-booking-confirmation.js made 13, which built fine but was refused at
 * "Deploying outputs...". Adding a new /api/*.js file will break the deploy
 * the same way — fold new email types in here instead.
 *
 *   (default)                  the quote email, with a link to the quote page
 *   kind: booking-confirmation  sent the moment someone books:
 *       mode 'received'   website booking — starting prices only, so it
 *                         promises no total, just a quote within 24 hours
 *       mode 'pencilled'  booked off an agreed quote — deposit link and an
 *                         explicit "the date isn't held until you pay"
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  if ((req.body || {}).kind === 'booking-confirmation') {
    return sendBookingConfirmation(req, res, RESEND_KEY, FROM_EMAIL);
  }

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
    const emailOK = emailRes.ok;
    const emailNote = emailOK ? null : 'Email delivery failed: ' + (body.message || emailRes.status);

    // Each channel reports separately. One vague "couldn't send" would hide the
    // case that actually matters — the email silently not going while the text
    // did, which looks like success to the customer and like nothing to her.
    const sms = await maybeTextQuote(req.body || {});

    if (!emailOK && !sms.attempted) {
      return res.status(200).json({ sent: false, note: emailNote });
    }
    return res.json({
      sent: emailOK, note: emailNote,
      texted: sms.sent, textNote: sms.note, textAttempted: sms.attempted,
    });
  } catch (e) {
    return res.status(200).json({ sent: false, note: 'Email error: ' + e.message });
  }
};


// ── Text the quote ──────────────────────────────────────────────────────
// Email is the right place for a price and a list of what's included, but it
// is also the thing that quietly lands in spam with the customer none the
// wiser. A text is short, arrives, and carries the same link.
//
// Party Biz Hub is multi-tenant and the Twilio account is the OWNER's, so
// texts are only sent for businesses explicitly switched on
// (profile_data.smsEnabled). Otherwise every tenant would be texting from her
// number, on her bill, with the TCPA liability landing on her.
async function maybeTextQuote(b) {
  const off = { attempted: false, sent: false, note: null };
  if (!b.alsoText) return off;

  const SID   = process.env.TWILIO_ACCOUNT_SID || '';
  const TOKEN = process.env.TWILIO_AUTH_TOKEN  || '';
  const FROM  = process.env.TWILIO_PHONE       || '';
  if (!SID || !TOKEN || !FROM) {
    return { attempted: true, sent: false,
             note: 'Texting is not set up yet — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE in Vercel.' };
  }

  const to = normalisePhone(b.clientPhone);
  if (!to) {
    return { attempted: true, sent: false, note: 'No usable phone number on this quote.' };
  }

  const first = (b.clientName || 'there').trim().split(/\s+/)[0] || 'there';
  const biz   = b.bizName || 'us';
  const price = b.grand != null
    ? '$' + parseFloat(b.grand).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';

  // Kept short on purpose: one segment where possible, and the link last so
  // it stays tappable in every messaging app.
  const body =
    `Hi ${first}, it's ${biz} — here's your quote` +
    (b.eventType ? ` for the ${String(b.eventType).toLowerCase()}` : '') +
    (price ? `: ${price}` : '') +
    `. Everything included, and you can book right here: ${b.quoteLink}` +
    ` Reply STOP to opt out.`;

  try {
    const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: FROM, Body: body }).toString(),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 21610 is Twilio's "this number replied STOP". Say that plainly rather
      // than as an error code — it is a choice the customer made, not a fault.
      const note = d.code === 21610
        ? 'Not sent — this number has asked us to stop texting.'
        : 'The text did not send: ' + (d.message || `Twilio ${r.status}`);
      return { attempted: true, sent: false, note };
    }
    return { attempted: true, sent: true, note: null };
  } catch (e) {
    return { attempted: true, sent: false, note: 'The text did not send: ' + e.message };
  }
}

// Twilio wants E.164. Accept whatever she typed on the phone.
function normalisePhone(raw) {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d.length >= 12 ? d : null;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return null;
}


// ── Booking confirmation ────────────────────────────────────────────────
// Was api/send-booking-confirmation.js; merged here to stay inside the
// Hobby plan's 12-function limit. Behaviour is unchanged.
async function sendBookingConfirmation(req, res, RESEND_KEY, FROM_EMAIL) {
  const {
    mode = 'received',
    clientEmail, clientName,
    bizName, bizEmail, bizPhone, brandColor,
    serviceName, eventDate, eventTime, eventAddress,
    total, depositAmount, balance,
    depositLink, depositDueAt, paymentTerms,
  } = req.body || {};

  if (!clientEmail) return res.status(400).json({ error: 'clientEmail is required' });
  if (!RESEND_KEY) {
    return res.status(200).json({ sent: false, note: 'Add RESEND_API_KEY to Vercel env vars to send emails automatically.' });
  }

  const brand = /^#[0-9a-fA-F]{6}$/.test(brandColor || '') ? brandColor : '#6D28D9';
  const first = (clientName || 'there').trim().split(/\s+/)[0] || 'there';
  const biz   = bizName || 'your party host';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = n => '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const niceDate = d => {
    if (!d) return '';
    const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d);
    return isNaN(dt) ? '' : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  const niceDeadline = d => {
    if (!d) return '';
    const dt = new Date(d);
    return isNaN(dt) ? '' : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      + ' at ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const rows = [
    serviceName  && ['Service', serviceName],
    eventDate    && ['Date', niceDate(eventDate)],
    eventTime    && ['Time', eventTime],
    eventAddress && ['Location', eventAddress],
  ].filter(Boolean);

  const detailTable = rows.length ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="background:#f7f5fb;border-radius:12px;margin:0 0 22px">
      ${rows.map(([k, v]) => `
      <tr>
        <td style="padding:10px 18px;font-size:13px;color:#8a7a96;white-space:nowrap">${esc(k)}</td>
        <td style="padding:10px 18px;font-size:14px;color:#1a1020;font-weight:600;text-align:right">${esc(v)}</td>
      </tr>`).join('')}
    </table>` : '';

  let heading, intro, actionBlock, subject;

  if (mode === 'pencilled') {
    subject = `Your date is pencilled in — ${biz}`;
    heading = 'Your date is pencilled in';
    intro = `Thanks ${esc(first)} — we've got your booking. One last step to lock it in.`;

    const deadline = niceDeadline(depositDueAt);
    actionBlock = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
             style="background:#fff8e6;border:1px solid #f5d97a;border-radius:12px;margin:0 0 22px">
        <tr><td style="padding:18px 20px">
          <p style="margin:0 0 8px;font-size:15px;font-weight:800;color:#7a5a00">
            Your date isn't held yet
          </p>
          <p style="margin:0;font-size:14px;line-height:1.65;color:#78350f">
            We hold ${eventDate ? niceDate(eventDate) : 'your date'} for you until
            <strong>${deadline ? esc(deadline) : '48 hours from now'}</strong>.
            If the ${depositAmount ? money(depositAmount) + ' ' : ''}deposit isn't paid by then,
            the date goes back on our calendar for someone else.
          </p>
        </td></tr>
      </table>

      ${depositLink ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px">
        <tr><td align="center">
          <a href="${esc(depositLink)}"
             style="display:inline-block;background:${esc(brand)};color:#fff;text-decoration:none;
                    padding:15px 40px;border-radius:10px;font-weight:800;font-size:16px">
            Pay ${depositAmount ? money(depositAmount) : 'my'} deposit &rarr;
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 20px;font-size:12px;color:#9b89a8;text-align:center;line-height:1.6">
        Button not working? Copy this link:<br>${esc(depositLink)}
      </p>`
      : `
      <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#3a2a4a">
        We'll send your deposit instructions in a separate message shortly.
      </p>`}

      ${(total || balance) ? `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
             style="border-top:1px solid #ece5f4;margin:0 0 8px">
        ${total ? `<tr>
          <td style="padding:9px 0;font-size:13px;color:#8a7a96">Total</td>
          <td style="padding:9px 0;font-size:13px;color:#1a1020;text-align:right;font-weight:700">${money(total)}</td>
        </tr>` : ''}
        ${depositAmount ? `<tr>
          <td style="padding:9px 0;font-size:13px;color:#8a7a96">Deposit to hold your date</td>
          <td style="padding:9px 0;font-size:13px;color:${esc(brand)};text-align:right;font-weight:800">${money(depositAmount)}</td>
        </tr>` : ''}
        ${balance ? `<tr>
          <td style="padding:9px 0;font-size:13px;color:#8a7a96">Due ${esc(paymentTerms || 'before your event')}</td>
          <td style="padding:9px 0;font-size:13px;color:#1a1020;text-align:right;font-weight:700">${money(balance)}</td>
        </tr>` : ''}
      </table>` : ''}
    `;
  } else {
    subject = `We got your booking request — ${biz}`;
    heading = 'We got your request!';
    intro = `Thanks ${esc(first)} — your booking request is in. Here's what happens next.`;
    actionBlock = `
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
             style="background:#f5f0ff;border-radius:12px;margin:0 0 22px">
        <tr><td style="padding:18px 20px">
          <p style="margin:0;font-size:14px;line-height:1.75;color:#3a2a4a">
            We'll review the details and get back to you <strong>within 24 hours</strong>
            with your final quote — including travel and any extras — plus a link to
            confirm your date and pay the deposit.
          </p>
        </td></tr>
      </table>
      <p style="margin:0 0 22px;font-size:13px;line-height:1.7;color:#8a7a96">
        Nothing is booked and no payment is due yet. Your date isn't held until
        the deposit is paid.
      </p>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f2f8;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
             style="max-width:540px;background:#fff;border-radius:16px;overflow:hidden">

        <tr><td style="background:${esc(brand)};padding:30px 32px;text-align:center">
          <p style="margin:0;font-size:19px;font-weight:800;color:#fff">${esc(biz)}</p>
          <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.85)">${esc(heading)}</p>
        </td></tr>

        <tr><td style="padding:30px 32px">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#3a2a4a">${intro}</p>
          ${detailTable}
          ${actionBlock}
          <p style="margin:0;font-size:14px;line-height:1.7;color:#3a2a4a">
            Questions? Just reply to this email${bizPhone ? ` or call ${esc(bizPhone)}` : ''} and we'll help.
          </p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #eee;text-align:center">
          <p style="margin:0;font-size:12px;color:#a094ab">
            ${esc(biz)}${bizEmail ? ` &middot; ${esc(bizEmail)}` : ''}
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: clientEmail,
        reply_to: bizEmail || undefined,
        subject,
        html,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(200).json({ sent: false, note: 'Email delivery failed: ' + (body.message || r.status) });
    return res.json({ sent: true, mode });
  } catch (e) {
    return res.status(200).json({ sent: false, note: 'Email error: ' + e.message });
  }
}
