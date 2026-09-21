const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-pbh-internal');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    ownerUID,
    clientName, clientEmail, clientPhone,
    eventDate, eventTime, eventAddress,
    serviceName, servicePrice,
    numKids, duration,
    bizName, bizEmail, bizPhone,
    depositUpfront, depositAmountPaid,
    // Days before the event that the balance falls due, already resolved by
    // the caller from the business default and any per-quote override.
    balanceDueDays,
  } = req.body || {};

  if (!ownerUID || !clientEmail || !eventDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
  const SUPA_KEY = 'sb_publishable_DFQoTRoat37YdIzPHzbZsQ_rAcubQH8';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  const internal = SERVICE_KEY && req.headers?.['x-pbh-internal'] === SERVICE_KEY;
  if (!internal) {
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Please sign in again' });
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + token },
    });
    const authUser = authRes.ok ? await authRes.json().catch(() => null) : null;
    if (!authUser || authUser.id !== ownerUID) {
      return res.status(403).json({ error: 'Not authorized for this business' });
    }
  }
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Party Biz Hub <support@partybizhub.com>';

  const adminKey = SERVICE_KEY || SUPA_KEY;
  const adminHeaders = {
    apikey: adminKey,
    Authorization: 'Bearer ' + adminKey,
    'Content-Type': 'application/json',
  };

  try {
    const existingRes = await fetch(
      `${SUPA_URL}/rest/v1/contracts?user_id=eq.${encodeURIComponent(ownerUID)}` +
      `&client_email=eq.${encodeURIComponent(clientEmail)}` +
      `&event_date=eq.${encodeURIComponent(eventDate)}&select=id&limit=1`,
      { headers: adminHeaders }
    );
    const existing = await existingRes.json().catch(() => []);
    if (existingRes.ok && Array.isArray(existing) && existing[0]) {
      return res.json({ success: true, existing: true, email_sent: false });
    }
  } catch (_) {}

  const signToken = crypto.randomUUID();
  const signingUrl = `https://app.partybizhub.com/sign-contract.html?t=${signToken}`;

  // Build service description
  const parts = [serviceName || 'Party Services'];
  if (numKids) parts.push(`${numKids} kids`);
  if (duration) parts.push(duration);
  const eventServices = parts.join(' · ');

  // Payment amounts
  const totalPrice = parseFloat((servicePrice || '0').toString().replace(/[^0-9.]/g, '')) || 0;
  const paidDeposit = parseFloat(String(depositAmountPaid || '0').replace(/[^0-9.]/g, '')) || 0;
  const depositAmt = paidDeposit > 0
    ? Math.min(paidDeposit, totalPrice || paidDeposit)
    : (depositUpfront && totalPrice > 0 ? Math.round(totalPrice * 0.5 * 100) / 100 : 0);

  // Due dates
  const today = new Date().toISOString().split('T')[0];
  const depositDue = today;
  // Was hard-coded to the event date, which contradicted the quote the
  // customer had already agreed to. Falls back to the event date only when the
  // business has not set a rule, so nothing changes for anyone who hasn't.
  const balance = balanceDueDate(eventDate, { balanceDueDays }, null) || eventDate;
  const balanceWhen = balance === eventDate
    ? 'on the event date'
    : 'by ' + new Date(balance + 'T00:00:00').toLocaleDateString('en-US',
        { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Standard kids party clauses
  const clauses = {
    paymentText: depositAmt > 0 && totalPrice > 0 && depositAmt >= totalPrice - 0.005
      ? `Payment of $${totalPrice.toFixed(2)} has been received in full. Nothing further is due.`
      : depositAmt > 0
      ? `A deposit of $${depositAmt.toFixed(2)} has been paid to reserve your event date. The remaining balance of $${Math.max(totalPrice - depositAmt, 0).toFixed(2)} is due ${balanceWhen}.`
      : `Full payment of $${totalPrice.toFixed(2)} is due ${balanceWhen}. We accept cash, Zelle, CashApp, and credit/debit card.`,
    depositText: 'Deposits are non-refundable. If you need to reschedule, please contact us at least 14 days before your event and your deposit will be applied to a future booking within 12 months.',
    cancellationText: 'Cancellations made 14+ days before the event receive a full refund minus the deposit. Cancellations made fewer than 14 days before the event forfeit the deposit. Cancellations within 72 hours of the event forfeit all payments made.',
    liabilityText: 'Client agrees to provide a safe, accessible setup area. Service Provider is not liable for injuries resulting from rough play, improper use of equipment, or hazardous venue conditions. Client assumes full responsibility for the behavior and safety of all guests.',
    weatherText: 'For outdoor events, please have a backup indoor space available. Service Provider reserves the right to modify setup for safety in extreme weather. Cancellations due to severe weather (hurricane, tornado warning) may be rescheduled at no penalty with 2+ hours notice.',
  };

  // Insert contract via Supabase REST API
  const contractPayload = {
    // Contract Center scopes records by user_id. Using owner_id here meant
    // automated contracts could be emailed but never appear in the owner's
    // saved contract list.
    user_id: ownerUID,
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
    status: 'Sent to Client',
    sign_token: signToken,
    created_at: new Date().toISOString(),
  };

  // Try to save contract to DB — non-fatal if table doesn't exist yet
  try {
    const insertRes = await fetch(`${SUPA_URL}/rest/v1/contracts`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Prefer': 'return=minimal' },
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
      ${depositAmt > 0 ? `<p><strong>Deposit Paid:</strong> $${depositAmt.toFixed(2)}</p>` : ''}
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
