const crypto = require('crypto');

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  // Must be an address on a domain verified in Resend. The old fallback,
  // onboarding@resend.dev, is Resend's shared sandbox sender and may only
  // email the Resend account owner, so quotes to real clients were rejected.
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Party Biz Hub <support@partybizhub.com>';

  if ((req.body || {}).kind === 'accept-quote') {
    return acceptQuote(req, res);
  }
  if ((req.body || {}).kind === 'booking-confirmation') {
    return sendBookingConfirmation(req, res, RESEND_KEY, FROM_EMAIL);
  }
  if ((req.body || {}).kind === 'website-booking') {
    return createWebsiteBooking(req, res);
  }
  if ((req.body || {}).kind === 'stripe-connect-config') {
    return res.json({
      enabled: Boolean(
        process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_CONNECT_CLIENT_ID &&
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET
      ),
    });
  }
  if ((req.body || {}).kind === 'stripe-connect-start') {
    return startStripeConnect(req, res);
  }
  if ((req.body || {}).kind === 'stripe-connect-complete') {
    return completeStripeConnect(req, res);
  }
  if ((req.body || {}).kind === 'stripe-connect-status') {
    return stripeConnectStatus(req, res);
  }
  if ((req.body || {}).kind === 'create-deposit-checkout') {
    return createDepositCheckout(req, res);
  }

  const {
    clientEmail, clientPhone, clientName, bizName, bizEmail, brandColor,
    eventType, eventDate, grand,
    quoteLink, expiryDate,
  } = req.body || {};

  if (!quoteLink || (!clientEmail && !clientPhone)) {
    return res.status(400).json({ error: 'quoteLink and a client email or phone are required' });
  }
  if (!RESEND_KEY) {
    const sms = await maybeTextQuote(req.body || {});
    return res.status(200).json({
      sent: false,
      note: clientEmail ? 'Add RESEND_API_KEY to Vercel env vars to send emails automatically.' : null,
      texted: sms.sent, textNote: sms.note, textAttempted: sms.attempted,
    });
  }
  if (!clientEmail) {
    const sms = await maybeTextQuote(req.body || {});
    return res.status(200).json({
      sent: false, note: null,
      texted: sms.sent, textNote: sms.note, textAttempted: sms.attempted,
    });
  }

  const clientFirst = (clientName || 'there').split(' ')[0];
  const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const fmtAmt = n => '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formattedDate = fmtDate(eventDate);
  const formattedExpiry = expiryDate ? new Date(expiryDate + 'T00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

  // This is one business emailing their own customer. Party Biz Hub's purple
  // has no business being on it.
  const brand = /^#[0-9a-fA-F]{6}$/.test(String(brandColor || '')) ? brandColor : '#6D28D9';
  const brandSoft = brand + '14';   // 8-digit hex is unreliable in email, so it
  const esc = v => String(v == null ? '' : v)   // is only used where a fallback
    .replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:0}
.wrap{max-width:540px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.top{background:${brand};padding:28px 32px;color:#fff;text-align:center}
.top h1{margin:0;font-size:1.3rem;font-weight:800;letter-spacing:-.02em}
.top p{margin:6px 0 0;font-size:.88rem;opacity:.82}
.body{padding:28px 32px}
.body p{color:#333;line-height:1.7;font-size:.95rem;margin:0 0 16px}
.btn{display:block;background:${brand};color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700;font-size:1rem;margin:24px 0}
.detail{background:#FAFAFC;border-left:3px solid ${brand};border-radius:10px;padding:14px 18px;margin-bottom:20px}
.detail p{margin:3px 0;font-size:.88rem;color:#333}
.total{font-size:1.5rem;font-weight:800;color:${brand};text-align:center;margin:12px 0 4px}
.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}
</style></head>
<body>
<div class="wrap">
  <div class="top">
    <h1>${esc(bizName) || 'Your Party Quote'} 🎉</h1>
    <p>Your personalized event quote is ready to review</p>
  </div>
  <div class="body">
    <p>Hi ${esc(clientFirst)},</p>
    <p>Your party quote from <strong>${esc(bizName) || 'us'}</strong> is ready! Review everything below and click the button to book your deposit.</p>
    <div class="detail">
      ${eventType ? `<p><strong>Event:</strong> ${esc(eventType)}</p>` : ''}
      ${formattedDate ? `<p><strong>Event Date:</strong> ${formattedDate}</p>` : ''}
      ${formattedExpiry ? `<p><strong>Quote expires:</strong> ${formattedExpiry}</p>` : ''}
    </div>
    ${grand ? `<div class="total">${fmtAmt(grand)}</div><p style="text-align:center;font-size:.82rem;color:#888;margin-top:0">Total package price</p>` : ''}
    <a href="${quoteLink}" class="btn">🎀 View My Full Quote</a>
    <p style="font-size:.82rem;color:#888">If the button doesn't work, copy this link into your browser:<br>${quoteLink}</p>
  </div>
  <div class="footer">${esc(bizName) || 'We'} &middot; Questions? Just reply to this email.</div>
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
        from: senderFrom(bizName, FROM_EMAIL),
        to: clientEmail,
        reply_to: validEmail(bizEmail) || undefined,
        subject: `🎉 Your party quote from ${bizName || 'us'}${eventType ? ' — ' + eventType : ''}`,
        html,
      }),
    });
    const body = await emailRes.json().catch(() => ({}));
    const emailOK = emailRes.ok;
    const emailNote = emailOK ? null : explainEmailFailure(emailRes.status, body, FROM_EMAIL);

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


// ── WHO THE EMAIL APPEARS TO BE FROM ────────────────────────────────────
// Every tenant sends over the one domain verified with Resend, because a
// student cannot send as their own Gmail — the receiving server would reject
// it or bin it as spoofing. But the DISPLAY NAME is ours to set, and that is
// what people actually read in an inbox. So a Bear Hug quote arrives from
// "Bear Hug Events", not "Party Biz Hub", with reply-to pointing at their real
// address.
//
// The name lands in a mail header, so anything that could open a second header
// — newlines, carriage returns — is stripped rather than escaped. Quotes,
// commas, colons and angle brackets go too, since they break the
// "Name <address>" form.
function senderFrom(bizName, fallbackFrom) {
  const addr = (/<([^>]+)>/.exec(fallbackFrom || '') || [null, fallbackFrom || ''])[1].trim();
  const clean = String(bizName || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/["<>,:;\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  if (!clean || !addr) return fallbackFrom;
  return clean + ' <' + addr + '>';
}


// ── SLIDING DEPOSIT SCALE ───────────────────────────────────────────────
// The owner can require more up front the closer an event is. The rungs are
// frozen onto the quote when it is sent, so changing the policy afterwards
// cannot alter a number a customer has already been shown.
//
// This is the authoritative copy: the Quote Builder and the customer's page
// each run the same rule for display, but what actually gets charged is
// decided here. Returns null when no sliding policy applies, leaving the
// original flat-amount behaviour untouched.
function slidingDepositPct(policy, eventDate) {
  if (!policy || !Array.isArray(policy.ladder) || !policy.ladder.length) return null;
  if (!eventDate) return null;
  const ev = new Date(String(eventDate).length <= 10 ? eventDate + 'T00:00' : eventDate);
  if (isNaN(ev)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((ev - today) / 86400000);
  const rungs = policy.ladder
    .filter(r => r && Number(r.withinDays) >= 1 && Number(r.pct) > 0 && Number(r.pct) <= 100)
    .sort((a, b) => Number(a.withinDays) - Number(b.withinDays));
  const rung = rungs.find(r => days <= Number(r.withinDays));
  if (rung) return Number(rung.pct);
  const base = Number(policy.basePct);
  return (base > 0 && base <= 100) ? base : null;
}

// A syntactically sane address, or null. Resend rejects the whole send on a
// malformed reply_to, so a typo in a profile must never cost the quote email.
function validEmail(value) {
  const v = String(value || '').trim();
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : null;
}

// Resend's own message is written for developers. Owners need to know which
// knob to turn, so the two failures that actually happen get named.
function explainEmailFailure(status, body, fromEmail) {
  const detail = (body && (body.message || body.error)) || ('HTTP ' + status);
  const text = String(detail).toLowerCase();
  if (status === 403 || text.includes('only send testing emails')) {
    return 'The sending address ' + fromEmail + ' is not verified in Resend yet, so it can only email the account owner. '
         + 'Verify the domain in Resend, then set RESEND_FROM_EMAIL in Vercel.';
  }
  if (status === 401 || text.includes('api key')) {
    return 'Resend rejected the API key. Check RESEND_API_KEY in your Vercel environment variables.';
  }
  if (status === 429) {
    return 'Resend is rate limiting right now. Wait a moment and send again.';
  }
  return 'Email delivery failed: ' + detail;
}

const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';

function serviceConfig() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  return {
    key,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
  };
}

// Public websites use this server-side bridge instead of embedding a Supabase
// key in their HTML. The owner is still explicit, but we verify that the
// business exists and accept only the small set of fields needed for an
// inquiry. This keeps a rotated browser key from silently breaking bookings.
async function createWebsiteBooking(req, res) {
  const body = req.body || {};
  if (body.companyWebsite) return res.status(200).json({ received: true }); // honeypot

  const clean = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
  const ownerId = clean(body.ownerId, 36);
  const clientName = clean(body.clientName, 140);
  const clientEmail = clean(body.clientEmail, 254).toLowerCase();
  const eventDate = clean(body.eventDate, 10);
  const serviceName = clean(body.serviceName || 'Website booking', 220);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
    return res.status(400).json({ error: 'A valid business booking ID is required' });
  }
  if (!clientName || !/^\S+@\S+\.\S+$/.test(clientEmail) || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return res.status(400).json({ error: 'Name, email, and preferred event date are required' });
  }

  const { key, headers } = serviceConfig();
  if (!key) return res.status(500).json({ error: 'Secure booking delivery is not configured' });

  try {
    const ownerRes = await fetch(
      `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`,
      { headers }
    );
    const owners = await ownerRes.json().catch(() => []);
    if (!ownerRes.ok || !Array.isArray(owners) || !owners[0]) {
      return res.status(404).json({ error: 'The selected business booking page is unavailable' });
    }

    const integerOrNull = value => {
      const number = Number.parseInt(value, 10);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    const price = Number.parseFloat(String(body.servicePrice == null ? '' : body.servicePrice).replace(/[^0-9.]/g, ''));
    const eventTime = clean(body.eventTime, 8);
    const payload = {
      owner_id: ownerId,
      client_name: clientName,
      client_email: clientEmail,
      client_phone: clean(body.clientPhone, 40) || null,
      event_date: eventDate,
      event_time: /^\d{2}:\d{2}(:\d{2})?$/.test(eventTime) ? eventTime : null,
      event_address: clean(body.eventAddress, 300) || null,
      num_kids: integerOrNull(body.numKids),
      honoree_name: clean(body.honoreeName, 140) || null,
      honoree_age: integerOrNull(body.honoreeAge),
      service_name: serviceName,
      service_price: Number.isFinite(price) ? price : null,
      notes: clean(body.notes, 4000) || null,
      status: 'inquiry',
    };

    const insertRes = await fetch(`${SUPA_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const inserted = await insertRes.json().catch(() => []);
    if (!insertRes.ok) {
      console.error('Website booking insert failed', insertRes.status, inserted);
      return res.status(502).json({ error: 'The booking request could not be delivered' });
    }
    // A lead that nobody is told about is a lead lost. Until now this saved
    // silently and the owner found out only if she happened to open the
    // dashboard. The enquiry is already safe in the database, so a failure to
    // email must never turn a saved lead into an error for the customer.
    try {
      await notifyOwnerOfEnquiry({
        ownerId, headers, payload,
        bookingId: inserted?.[0]?.id || null,
        host: (req.headers && req.headers.host) || 'www.partybizhub.com',
      });
    } catch (e) {
      console.warn('Enquiry saved but the owner could not be notified:', e);
    }

    return res.status(201).json({ received: true, bookingId: inserted?.[0]?.id || null });
  } catch (error) {
    console.error('Website booking bridge failed', error);
    return res.status(502).json({ error: 'The booking request could not be delivered' });
  }
}

async function authenticatedUser(req) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { key } = serviceConfig();
  if (!key) return null;
  const r = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { apikey: key, Authorization: 'Bearer ' + token },
  });
  return r.ok ? r.json() : null;
}

async function getOwnerProfile(ownerId) {
  const { key, headers } = serviceConfig();
  if (!key) throw new Error('Secure profile access is not configured');
  const r = await fetch(
    `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=id,email,profile_data&limit=1`,
    { headers }
  );
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || !rows[0]) throw new Error('Business profile was not found');
  return rows[0];
}

async function saveOwnerProfileData(ownerId, profileData) {
  const { headers } = serviceConfig();
  const r = await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ profile_data: profileData, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('Business profile could not be updated');
}

async function stripeFormRequest(path, values, connectedAccount) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('Stripe Connect is not configured');
  const headers = {
    Authorization: 'Basic ' + Buffer.from(secret + ':').toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (connectedAccount) headers['Stripe-Account'] = connectedAccount;
  const r = await fetch('https://api.stripe.com' + path, {
    method: 'POST', headers, body: new URLSearchParams(values).toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || 'Stripe request failed');
  return data;
}

async function stripeOAuthToken(code) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('Stripe Connect is not configured');
  const r = await fetch('https://connect.stripe.com/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(secret + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || 'Stripe connection failed');
  return data;
}

async function stripeGet(path, connectedAccount) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('Stripe Connect is not configured');
  const headers = { Authorization: 'Basic ' + Buffer.from(secret + ':').toString('base64') };
  if (connectedAccount) headers['Stripe-Account'] = connectedAccount;
  const r = await fetch('https://api.stripe.com' + path, { headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || 'Stripe request failed');
  return data;
}

async function startStripeConnect(req, res) {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in again' });
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID || '';
  if (!clientId || !process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Stripe Connect needs to be enabled by Party Biz Hub first' });
  }
  try {
    const profile = await getOwnerProfile(user.id);
    const pd = profile.profile_data || {};
    const state = crypto.randomBytes(24).toString('hex');
    await saveOwnerProfileData(user.id, {
      ...pd,
      stripeConnectState: state,
      stripeConnectStateExpires: Date.now() + 10 * 60 * 1000,
    });
    const redirectUri = 'https://partybizhub.com/profile.html?focus=payments&stripe=return';
    const params = new URLSearchParams({
      response_type: 'code', client_id: clientId, scope: 'read_write', state,
      redirect_uri: redirectUri,
      'stripe_user[email]': user.email || profile.email || '',
      'stripe_user[business_name]': pd.businessName || pd.bizName || '',
      'stripe_user[product_description]': 'Kids party and event services',
      'stripe_user[url]': `https://partybizhub.com/site.html?uid=${encodeURIComponent(user.id)}`,
    });
    return res.json({ url: 'https://connect.stripe.com/oauth/authorize?' + params.toString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function completeStripeConnect(req, res) {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in again' });
  const { code, state } = req.body || {};
  if (!code || !state) return res.status(400).json({ error: 'Stripe did not return a complete connection' });
  try {
    const profile = await getOwnerProfile(user.id);
    const pd = profile.profile_data || {};
    if (state !== pd.stripeConnectState || Number(pd.stripeConnectStateExpires || 0) < Date.now()) {
      return res.status(403).json({ error: 'This Stripe connection expired. Please start again.' });
    }
    const oauth = await stripeOAuthToken(code);
    const accountId = oauth.stripe_user_id;
    if (!/^acct_/.test(accountId || '')) throw new Error('Stripe account connection was not returned');
    const account = await stripeGet('/v1/accounts/' + encodeURIComponent(accountId));
    const next = { ...pd };
    delete next.stripeConnectState;
    delete next.stripeConnectStateExpires;
    next.stripeConnectAccountId = accountId;
    next.stripeConnectReady = account.charges_enabled === true && account.details_submitted === true;
    next.depositProfile = next.stripeConnectReady ? 'connected' : (next.depositProfile || 'default');
    await saveOwnerProfileData(user.id, next);
    return res.json({ connected: true, ready: next.stripeConnectReady, accountId });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

async function stripeConnectStatus(req, res) {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in again' });
  try {
    const profile = await getOwnerProfile(user.id);
    const pd = profile.profile_data || {};
    if (!pd.stripeConnectAccountId) return res.json({ connected: false, ready: false });
    const account = await stripeGet('/v1/accounts/' + encodeURIComponent(pd.stripeConnectAccountId));
    const ready = account.charges_enabled === true && account.details_submitted === true;
    if (pd.stripeConnectReady !== ready) {
      await saveOwnerProfileData(user.id, { ...pd, stripeConnectReady: ready });
    }
    return res.json({ connected: true, ready, accountId: pd.stripeConnectAccountId });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

async function createDepositCheckout(req, res) {
  const { bookingId, quoteId, clientEmail } = req.body || {};
  if (!bookingId || !quoteId || !clientEmail) {
    return res.status(400).json({ error: 'Booking, quote, and email are required' });
  }
  const { key, headers } = serviceConfig();
  if (!key) return res.status(500).json({ error: 'Secure checkout is not configured' });
  try {
    const bookingRes = await fetch(
      `${SUPA_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}` +
      `&quote_id=eq.${encodeURIComponent(quoteId)}&client_email=eq.${encodeURIComponent(clientEmail)}` +
      '&select=id,owner_id,client_name,client_email,event_date,service_name,service_price,status,quote_id&limit=1',
      { headers }
    );
    const bookings = await bookingRes.json().catch(() => []);
    const booking = Array.isArray(bookings) ? bookings[0] : null;
    if (!bookingRes.ok || !booking || booking.status !== 'awaiting-deposit') {
      return res.status(409).json({ error: 'This booking is not waiting for a deposit' });
    }
    const quoteRes = await fetch(
      `${SUPA_URL}/rest/v1/saved_quotes?id=eq.${encodeURIComponent(quoteId)}` +
      `&user_id=eq.${encodeURIComponent(booking.owner_id)}&select=id,quote_data&limit=1`, { headers }
    );
    const quotes = await quoteRes.json().catch(() => []);
    const quote = Array.isArray(quotes) ? quotes[0] : null;
    if (!quoteRes.ok || !quote) return res.status(409).json({ error: 'The matching quote was not found' });
    const total = parseFloat(String(booking.service_price || '0').replace(/[^0-9.]/g, '')) || 0;
    // The amount charged is worked out here, from the policy frozen onto the
    // quote and the event date on the booking — never from anything the
    // browser sent. A sliding scale that only existed client-side would be a
    // number the customer could edit before paying.
    const slidingPct = slidingDepositPct(quote.quote_data?.depositPolicy, booking.event_date);
    const selected = parseFloat(quote.quote_data?.selectedDepositTier);
    const deposit = slidingPct != null
      ? Math.min(Math.round(total * slidingPct) / 100, total)
      : Math.min(Number.isFinite(selected) && selected > 0 ? selected : total * 0.5, total);
    const cents = Math.round(deposit * 100);
    if (cents < 50) return res.status(409).json({ error: 'The deposit amount is too low for card checkout' });

    const profile = await getOwnerProfile(booking.owner_id);
    const pd = profile.profile_data || {};
    if (!pd.stripeConnectAccountId || pd.stripeConnectReady !== true || pd.depositProfile !== 'connected') {
      return res.status(409).json({ error: 'Automatic Stripe deposits are not connected for this business' });
    }
    const currency = /^[a-z]{3}$/i.test(pd.currency || '') ? pd.currency.toLowerCase() : 'usd';
    const success = `https://partybizhub.com/view-quote.html?id=${encodeURIComponent(quoteId)}&deposit=success`;
    const cancel = `https://partybizhub.com/view-quote.html?id=${encodeURIComponent(quoteId)}&deposit=cancelled`;
    const session = await stripeFormRequest('/v1/checkout/sessions', {
      mode: 'payment',
      customer_email: booking.client_email,
      client_reference_id: booking.id,
      success_url: success,
      cancel_url: cancel,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': String(cents),
      'line_items[0][price_data][product_data][name]': `Deposit for ${booking.service_name || 'party booking'}`,
      'metadata[kind]': 'booking_deposit',
      'metadata[booking_id]': booking.id,
      'metadata[owner_id]': booking.owner_id,
      'metadata[quote_id]': quoteId,
      'metadata[deposit_amount_cents]': String(cents),
      'payment_intent_data[metadata][kind]': 'booking_deposit',
      'payment_intent_data[metadata][booking_id]': booking.id,
      'payment_intent_data[metadata][owner_id]': booking.owner_id,
    }, pd.stripeConnectAccountId);
    return res.json({ url: session.url, automatic: true, depositAmount: deposit });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}


// Advance the original inquiry when a customer accepts a quote. This route
// uses the server-side key because the public quote page should not have broad
// update permission on every owner's bookings table. The quote must explicitly
// point at the same source booking before anything is changed.
async function acceptQuote(req, res) {
  const { quoteId, sourceBookingId, selectedAddOns = [], booking = {} } = req.body || {};
  if (!quoteId) {
    return res.status(400).json({ error: 'quoteId is required' });
  }

  const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!SERVICE_KEY) {
    return res.status(500).json({ error: 'Secure booking updates are not configured' });
  }
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    const quoteRes = await fetch(
      `${SUPA_URL}/rest/v1/saved_quotes?id=eq.${encodeURIComponent(quoteId)}` +
      '&select=id,user_id,total_amount,quote_data&limit=1',
      { headers }
    );
    const quotes = await quoteRes.json().catch(() => []);
    const quote = Array.isArray(quotes) ? quotes[0] : null;
    if (!quoteRes.ok || !quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    const quoteData = quote.quote_data || {};
    const linkedId = quoteData.sourceBookingId || null;
    if (sourceBookingId && String(linkedId || '') !== String(sourceBookingId)) {
      return res.status(403).json({ error: 'This quote is not linked to that inquiry' });
    }

    // Never trust prices sent by the public browser. Match requested ids back
    // to the add-ons the owner saved on this exact quote, then recalculate.
    const offered = Array.isArray(quoteData.addOns) ? quoteData.addOns : [];
    const requested = Array.isArray(selectedAddOns) ? selectedAddOns : [];
    const acceptedAddOns = [];
    requested.slice(0, 50).forEach(row => {
      const source = offered.find(addon => String(addon.id) === String(row && row.id));
      if (!source) return;
      const price = Math.max(0, Number(source.price) || 0);
      const perUnit = source.pricingType === 'per_guest' || source.pricingType === 'per_item';
      const quantity = perUnit
        ? Math.max(1, Math.min(100, Math.floor(Number(row.quantity) || 1))) : 1;
      const coverage = Math.max(0, Math.min(999, Math.floor(Number(source.coverage) || 0)));
      acceptedAddOns.push({
        id: source.id, name: String(source.name || 'Optional add-on').slice(0, 160),
        description: String(source.description || '').slice(0, 500),
        pricingType: ['flat','per_guest','per_item','starting_at'].includes(source.pricingType) ? source.pricingType : 'flat',
        price, quantity, coverage, total: Math.round(price * quantity * 100) / 100,
      });
    });
    const baseGrand = Math.max(0, Number(quoteData.baseGrand != null ? quoteData.baseGrand : quoteData.grand != null ? quoteData.grand : quote.total_amount) || 0);
    const addOnTotal = Math.round(acceptedAddOns.reduce((sum, addon) => sum + addon.total, 0) * 100) / 100;
    const finalGrand = Math.round((baseGrand + addOnTotal) * 100) / 100;
    const addOnLine = addon => {
      const unit = addon.pricingType === 'per_item' ? 'item' : 'guest';
      if (addon.quantity > 1) return `• ${addon.name} × ${addon.quantity} ${unit}s — $${addon.total.toFixed(2)}`;
      if (addon.pricingType === 'flat' && addon.coverage) return `• ${addon.name} (covers up to ${addon.coverage}) — $${addon.total.toFixed(2)}`;
      return `• ${addon.name} — $${addon.total.toFixed(2)}`;
    };
    const addOnNotes = acceptedAddOns.length
      ? '\n\nSelected add-ons:\n' + acceptedAddOns.map(addOnLine).join('\n')
      : '';

    const patch = {
      client_name: booking.client_name || '',
      client_email: booking.client_email || '',
      client_phone: booking.client_phone || '',
      event_date: booking.event_date || null,
      event_time: booking.event_time || null,
      event_address: booking.event_address || '',
      service_name: booking.service_name || 'Quoted package',
      service_price: String(finalGrand),
      notes: ((booking.notes || '') + addOnNotes).trim() || null,
      status: 'awaiting-deposit',
      deposit_due_at: booking.deposit_due_at || null,
      deposit_reminder_sent: null,
      quote_id: quoteId,
    };
    let bookingId = linkedId || booking.id || crypto.randomUUID();
    let saveRes;
    if (linkedId) {
      saveRes = await fetch(
        `${SUPA_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(linkedId)}` +
        `&owner_id=eq.${encodeURIComponent(quote.user_id)}`,
        { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch) }
      );
    } else {
      saveRes = await fetch(`${SUPA_URL}/rest/v1/bookings`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ id: bookingId, owner_id: quote.user_id, created_at: booking.created_at || new Date().toISOString(), ...patch })
      });
    }
    const savedBooking = await saveRes.json().catch(() => []);
    if (!saveRes.ok || !Array.isArray(savedBooking) || !savedBooking.length) {
      return res.status(409).json({ error: linkedId ? 'The original inquiry could not be updated' : 'The booking could not be created' });
    }

    const acceptedQuoteData = {
      ...quoteData, baseGrand, addOnTotal, customerSelectedAddOns: acceptedAddOns,
      grand: finalGrand, acceptedAt: new Date().toISOString(), acceptedBookingId: bookingId,
    };
    const quoteUpdate = await fetch(`${SUPA_URL}/rest/v1/saved_quotes?id=eq.${encodeURIComponent(quoteId)}&user_id=eq.${encodeURIComponent(quote.user_id)}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ total_amount: finalGrand, quote_data: acceptedQuoteData }),
    });
    if (!quoteUpdate.ok) console.warn('Booking saved but quote total could not be updated');

    // The booking is already safe in the database. Telling the owner is the
    // part that was missing, and it must never be able to undo that — so a
    // failure here is logged and swallowed, never returned as an error.
    try {
      await notifyOwnerOfBooking({
        ownerId: quote.user_id, headers, booking: patch, addOns: acceptedAddOns,
        baseGrand, addOnTotal, grand: finalGrand, bookingId,
        host: (req.headers && req.headers.host) || 'www.partybizhub.com',
      });
    } catch (e) {
      console.warn('Booking saved but the owner could not be notified:', e);
    }

    return res.json({ saved: true, bookingId, baseGrand, addOnTotal, grand: finalGrand, selectedAddOns: acceptedAddOns });
  } catch (e) {
    console.error('Quote acceptance failed:', e);
    return res.status(500).json({ error: 'Could not accept this quote' });
  }
}



// ── "You have a new enquiry" ────────────────────────────────────────────
// Someone filling in a booking form is a stranger who might book. Quote
// acceptances already email the owner; this closes the same gap one step
// earlier in the funnel, where the lead is coldest and speed matters most.
async function notifyOwnerOfEnquiry({ ownerId, headers, payload, bookingId, host }) {
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  if (!RESEND_KEY) return;
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Party Biz Hub <support@partybizhub.com>';

  const ownerRes = await fetch(
    `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=email,profile_data&limit=1`,
    { headers }
  );
  const owners = await ownerRes.json().catch(() => []);
  const owner = Array.isArray(owners) ? owners[0] : null;
  if (!owner) return;

  const pd = owner.profile_data || {};
  // The account address is the dependable one — there is currently no field in
  // the app for a separate business address, so it is usually all there is.
  const to = validEmail(pd.contactEmail) || validEmail(pd.bizEmail) || validEmail(owner.email);
  if (!to) return;

  const brand = /^#[0-9a-fA-F]{6}$/.test(String(pd.brandColor || '')) ? pd.brandColor : '#6D28D9';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const fmtDate = d => {
    if (!d) return 'Not given';
    const parsed = new Date(String(d).length <= 10 ? d + 'T00:00' : d);
    return isNaN(parsed) ? String(d) : parsed.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  const row = (label, value) => value
    ? `<tr><td style="padding:6px 14px 6px 0;color:#8A7A96;font-size:13px;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;color:#2F1E3B;font-size:13px;font-weight:600">${esc(value)}</td></tr>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#F5F3F7;font-family:Inter,Arial,sans-serif">
<div style="max-width:560px;margin:28px auto;background:#fff;border-radius:16px;overflow:hidden">
  <div style="background:${esc(brand)};padding:26px 30px;color:#fff">
    <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.85">New enquiry</div>
    <h1 style="margin:6px 0 0;font-size:1.3rem;font-weight:800">${esc(payload.client_name || 'Someone')} asked about a party</h1>
  </div>
  <div style="padding:26px 30px">
    <p style="margin:0 0 18px;color:#4A3B55;font-size:.95rem;line-height:1.65">
      They filled in your booking form. Nothing is booked and no price has been agreed —
      this is a lead waiting on a quote from you.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      ${row('Wants', payload.service_name)}
      ${row('Date', fmtDate(payload.event_date))}
      ${row('Time', payload.event_time)}
      ${row('Where', payload.event_address)}
      ${row('Guests', payload.num_kids)}
      ${row('For', payload.honoree_name)}
      ${row('Email', payload.client_email)}
      ${row('Phone', payload.client_phone)}
    </table>
    ${payload.notes ? `<p style="margin:0 0 18px;padding:14px 16px;background:#FAF7FB;border-radius:10px;color:#4A3B55;font-size:.88rem;line-height:1.6;white-space:pre-line"><strong>What they said:</strong>\n${esc(payload.notes)}</p>` : ''}
    <a href="https://${esc(host)}/dashboard.html" style="display:block;background:${esc(brand)};color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700;font-size:.98rem">Send them a quote &rarr;</a>
  </div>
  <div style="padding:14px 30px;text-align:center;font-size:.76rem;color:#A99EB3;border-top:1px solid #EFEAF3">
    ${bookingId ? 'Reference ' + esc(String(bookingId).slice(0, 8).toUpperCase()) + ' &middot; ' : ''}Party Biz Hub
  </div>
</div>
</body></html>`;

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': `enquiry/${bookingId || payload.client_email}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      reply_to: validEmail(payload.client_email) || undefined,
      subject: `New enquiry from ${payload.client_name || 'a customer'} — ${fmtDate(payload.event_date)}`,
      html,
    }),
  });
  if (!sendRes.ok) {
    const detail = await sendRes.json().catch(() => ({}));
    console.warn('Enquiry notification not delivered:', detail.message || sendRes.status);
  }
}

// ── "You just got booked" ───────────────────────────────────────────────
// The customer has always received a confirmation the moment they accept a
// quote. The owner received nothing — she found out by remembering to open
// the dashboard. With a date held on a 48-hour deposit clock, that is the one
// message that genuinely has to arrive, so it is sent here, on the same
// request that saved the booking.
async function notifyOwnerOfBooking({ ownerId, headers, booking, addOns, baseGrand, addOnTotal, grand, bookingId, host }) {
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  if (!RESEND_KEY) return;
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Party Biz Hub <support@partybizhub.com>';

  const ownerRes = await fetch(
    `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}&select=email,profile_data&limit=1`,
    { headers }
  );
  const owners = await ownerRes.json().catch(() => []);
  const owner = Array.isArray(owners) ? owners[0] : null;
  if (!owner) return;

  const pd = owner.profile_data || {};
  // The account address is the reliable one; a contact address is only used
  // when she has actually set one.
  const to = validEmail(pd.contactEmail) || validEmail(pd.bizEmail) || validEmail(owner.email);
  if (!to) return;

  const brand = /^#[0-9a-fA-F]{6}$/.test(String(pd.brandColor || '')) ? pd.brandColor : '#6D28D9';
  const money = n => '$' + parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const fmtDate = d => {
    if (!d) return 'Date to confirm';
    const parsed = new Date(String(d).length <= 10 ? d + 'T00:00' : d);
    return isNaN(parsed) ? String(d) : parsed.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  const dueText = booking.deposit_due_at
    ? new Date(booking.deposit_due_at).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const row = (label, value) => value
    ? `<tr><td style="padding:6px 14px 6px 0;color:#8A7A96;font-size:13px;white-space:nowrap">${esc(label)}</td><td style="padding:6px 0;color:#2F1E3B;font-size:13px;font-weight:600">${esc(value)}</td></tr>`
    : '';

  const addOnRows = (addOns || []).map(a => {
    const unit = a.pricingType === 'per_item' ? 'item' : 'guest';
    const detail = a.quantity > 1 ? ` × ${a.quantity} ${unit}s`
      : (a.pricingType === 'flat' && a.coverage ? ` (covers up to ${a.coverage})` : '');
    return `<tr><td style="padding:5px 0;color:#2F1E3B;font-size:13px">${esc(a.name)}${esc(detail)}</td>`
         + `<td style="padding:5px 0;text-align:right;color:#2F1E3B;font-size:13px;font-weight:700">${money(a.total)}</td></tr>`;
  }).join('');

  const dashboard = `https://${host}/dashboard.html`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F7;font-family:Inter,Arial,sans-serif">
<div style="max-width:560px;margin:28px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)">
  <div style="background:${esc(brand)};padding:26px 30px;color:#fff">
    <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.8">New booking</div>
    <h1 style="margin:6px 0 0;font-size:1.35rem;font-weight:800">${esc(booking.client_name || 'A customer')} accepted your quote 🎉</h1>
  </div>
  <div style="padding:26px 30px">
    <p style="margin:0 0 18px;color:#4A3B55;font-size:.95rem;line-height:1.65">
      They picked a date and it is pencilled in.
      ${dueText ? `The deposit is due by <strong>${esc(dueText)}</strong> — after that the date goes back on your calendar automatically.` : 'The deposit has not arrived yet, so the date is not locked.'}
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      ${row('Event', booking.service_name)}
      ${row('Date', fmtDate(booking.event_date))}
      ${row('Time', booking.event_time)}
      ${row('Where', booking.event_address)}
      ${row('Email', booking.client_email)}
      ${row('Phone', booking.client_phone)}
    </table>
    ${addOnRows ? `<div style="background:#FAF7FB;border-radius:12px;padding:14px 18px;margin-bottom:18px">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8A7A96;font-weight:700;margin-bottom:8px">Add-ons they chose</div>
      <table style="width:100%;border-collapse:collapse">${addOnRows}</table>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #E6DCEF;font-size:13px;color:#8A7A96">
        Quote ${money(baseGrand)} + add-ons ${money(addOnTotal)}
      </div>
    </div>` : ''}
    <div style="background:#FAF7FB;border-radius:12px;padding:16px 18px;text-align:center;margin-bottom:20px">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8A7A96;font-weight:700">Booked total</div>
      <div style="font-size:1.7rem;font-weight:800;color:${esc(brand)};margin-top:4px">${money(grand)}</div>
    </div>
    ${booking.notes ? `<p style="margin:0 0 18px;color:#4A3B55;font-size:.88rem;line-height:1.6;white-space:pre-line"><strong>Their notes:</strong>\n${esc(booking.notes)}</p>` : ''}
    <a href="${esc(dashboard)}" style="display:block;background:${esc(brand)};color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700;font-size:.98rem">Open your dashboard &rarr;</a>
  </div>
  <div style="padding:14px 30px;text-align:center;font-size:.76rem;color:#A99EB3;border-top:1px solid #EFEAF3">
    Reference ${esc(String(bookingId).slice(0, 8).toUpperCase())} · Party Biz Hub
  </div>
</div>
</body></html>`;

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      reply_to: validEmail(booking.client_email) || undefined,
      subject: `🎉 ${booking.client_name || 'A customer'} just booked — ${fmtDate(booking.event_date)}`,
      html,
    }),
  });
  if (!sendRes.ok) {
    const detail = await sendRes.json().catch(() => ({}));
    console.warn('Owner booking notification not delivered:', detail.message || sendRes.status);
  }
}

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
        from: senderFrom(bizName, FROM_EMAIL),
        to: clientEmail,
        reply_to: validEmail(bizEmail) || undefined,
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
