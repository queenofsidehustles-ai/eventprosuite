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
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

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
    clientEmail, clientPhone, clientName, bizName,
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
    const selected = parseFloat(quote.quote_data?.selectedDepositTier);
    const deposit = Math.min(Number.isFinite(selected) && selected > 0 ? selected : total * 0.5, total);
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
  const { quoteId, sourceBookingId, booking = {} } = req.body || {};
  if (!quoteId || !sourceBookingId) {
    return res.status(400).json({ error: 'quoteId and sourceBookingId are required' });
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
      '&select=id,user_id,quote_data&limit=1',
      { headers }
    );
    const quotes = await quoteRes.json().catch(() => []);
    const quote = Array.isArray(quotes) ? quotes[0] : null;
    const linkedId = quote && quote.quote_data && quote.quote_data.sourceBookingId;
    if (!quoteRes.ok || !quote || String(linkedId || '') !== String(sourceBookingId)) {
      return res.status(403).json({ error: 'This quote is not linked to that inquiry' });
    }

    const patch = {
      client_name: booking.client_name || '',
      client_email: booking.client_email || '',
      client_phone: booking.client_phone || '',
      event_date: booking.event_date || null,
      event_time: booking.event_time || null,
      event_address: booking.event_address || '',
      service_name: booking.service_name || 'Quoted package',
      service_price: booking.service_price || '',
      notes: booking.notes || null,
      status: 'awaiting-deposit',
      deposit_due_at: booking.deposit_due_at || null,
      deposit_reminder_sent: null,
      quote_id: quoteId,
    };
    const updateRes = await fetch(
      `${SUPA_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(sourceBookingId)}` +
      `&owner_id=eq.${encodeURIComponent(quote.user_id)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      }
    );
    const updated = await updateRes.json().catch(() => []);
    if (!updateRes.ok || !Array.isArray(updated) || !updated.length) {
      return res.status(409).json({ error: 'The original inquiry could not be updated' });
    }
    return res.json({ saved: true, bookingId: sourceBookingId });
  } catch (e) {
    console.error('Quote acceptance failed:', e);
    return res.status(500).json({ error: 'Could not accept this quote' });
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
