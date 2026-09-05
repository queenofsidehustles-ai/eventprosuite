/**
 * send-booking-confirmation.js
 *
 * The email a customer gets the moment they book. Two modes:
 *
 *   mode: 'received'   Website booking. They picked from starting prices
 *                      ("$700+"), so we promise nothing about the total —
 *                      just "we've got it, we'll confirm within 24 hours".
 *
 *   mode: 'pencilled'  They booked off a quote we sent, so the price is
 *                      already agreed. Their date is held provisionally and
 *                      the deposit link is right there. The email is explicit
 *                      that the date is NOT held until the deposit is paid.
 *
 * Never fails the booking — the caller ignores the result. A booking that
 * saved but didn't email is recoverable; the reverse is not.
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

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
};
