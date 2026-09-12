const crypto = require('crypto');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Body parsing is disabled below so Stripe signatures can be verified against
  // the exact bytes Stripe sent. Parse non-webhook JSON requests ourselves.
  const rawBody = await readRawBody(req);

  if (req.headers['stripe-signature']) {
    return handleStripeWebhook(res, rawBody, req.headers['stripe-signature']);
  }

  let body = {};
  try {
    body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
  } catch (_) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  if (body.action === 'generate-copy') return handleGenerateCopy(res, body);
  if (body.action === 'grant-access') return handleGrantAccess(res, body);
  return handleSendEmail(res, body);
};

module.exports.config = { api: { bodyParser: false } };

async function handleStripeWebhook(res, rawBody, sigHeader) {
  // Keep the original account connected while allowing KPPS purchases from its
  // dedicated Stripe account. Each Stripe account issues its own endpoint secret.
  const STRIPE_SECRETS = [
    process.env.STRIPE_WEBHOOK_SECRET || '',
    process.env.KPPS_STRIPE_WEBHOOK_SECRET || '',
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '',
  ].filter(Boolean);
  const SUPABASE_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  // Default to the VERIFIED partybizhub.com sender so emails work even if the env
  // var is unset/misnamed. onboarding@resend.dev is Resend's sandbox and only
  // delivers to the account owner — never use it for real customer email.
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Party Biz Hub <support@partybizhub.com>';

  // Never accept an unsigned/unverified Stripe event. These are endpoint signing
  // secrets (whsec_...), not Stripe API secret keys.
  if (STRIPE_SECRETS.length === 0) {
    console.error('No Stripe webhook signing secret is configured');
    return res.status(500).json({ error: 'Webhook is not configured' });
  }

  let reqStripeSecret = '';
  try {
    const parts = sigHeader.split(',');
    const ts = (parts.find(p => p.startsWith('t=')) || '').slice(2);
    const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp) || signatures.length === 0) {
      return res.status(400).json({ error: 'Invalid signature header' });
    }

    // Reject replayed events outside Stripe's standard five-minute tolerance.
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
      return res.status(400).json({ error: 'Expired signature' });
    }

    const valid = STRIPE_SECRETS.some(secret => {
      const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest();
      const matches = signatures.some(candidate => {
        if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
        const received = Buffer.from(candidate, 'hex');
        return received.length === expected.length && crypto.timingSafeEqual(expected, received);
      });
      if (matches) reqStripeSecret = secret;
      return matches;
    });
    if (!valid) return res.status(400).json({ error: 'Invalid signature' });
  } catch (_) {
    return res.status(400).json({ error: 'Signature check failed' });
  }

  let event;
  try { event = JSON.parse(rawBody.toString()); } catch (_) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  const eventId = event.id || 'unknown-event';

  // Subscription canceled or ended → revoke the CRM key so access stops
  if (event.type === 'customer.subscription.deleted' && !event.account) {
    const sub = event.data?.object || {};
    const customerId = sub.customer;
    if (customerId && SUPABASE_SERVICE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?stripe_customer_id=eq.${customerId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey': SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ has_crm_access: false }),
        });
      } catch (_) {}
    }
    return res.json({ received: true, note: 'Subscription canceled — CRM access revoked' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true });
  }

  const session = event.data?.object || {};

  // A party client's deposit belongs to one of our students, not to Party Biz
  // Hub. Connected-account Checkout Sessions carry the booking identity in
  // metadata, and Connect events identify the student's Stripe account at the
  // top level. Handle these before classifying Party Biz Hub product sales.
  if (event.type === 'checkout.session.completed' && session.metadata?.kind === 'booking_deposit') {
    if (!process.env.STRIPE_CONNECT_WEBHOOK_SECRET || reqStripeSecret !== process.env.STRIPE_CONNECT_WEBHOOK_SECRET) {
      return res.status(400).json({ error: 'Deposit event did not come through the Connect webhook' });
    }
    return handleBookingDeposit(res, event, session, {
      SUPABASE_URL, SUPABASE_SERVICE_KEY, eventId,
    });
  }

  // Classify the purchase type
  const amountTotal = session.amount_total || 0;
  // amount_subtotal = the LIST price BEFORE any coupon/discount. Matching on this
  // means a KPPS sale still delivers even when a coupon lowers what they actually pay.
  const amountSubtotal = session.amount_subtotal || amountTotal;
  const sessionMode = session.mode || 'payment';
  // Optional explicit tag on the checkout / payment link (most reliable when set)
  const metaProduct = (session.metadata && session.metadata.product || '').toLowerCase();

  // Party Biz Hub CRM — a RECURRING subscription (the only subscription product is the $27/mo plan)
  const isCRMSub = sessionMode === 'subscription';

  // KPPS one-time purchases — unlock the full system for life.
  // Check the pre-discount subtotal first so COUPON / discounted purchases still deliver.
  const KPPS_AMOUNTS = { 19700: true, 40000: true, 49700: true }; // current $197 offer + legacy purchases
  const isKPPS = !isCRMSub && (metaProduct === 'kpps' || !!KPPS_AMOUNTS[amountSubtotal] || !!KPPS_AMOUNTS[amountTotal]);

  // Party Printables — one-time $97 (unlimited template library)
  const PPP_TIER_MAP = { 9700: 'founding' };
  const assignedTier = isKPPS
    ? 'founding'
    : (isCRMSub ? null : (PPP_TIER_MAP[amountSubtotal] || PPP_TIER_MAP[amountTotal] || null));

  if (!isCRMSub && !isKPPS && !assignedTier) {
    return res.json({ received: true, note: `Not a recognized purchase — skipped (subtotal=${amountSubtotal}, total=${amountTotal})` });
  }

  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const customerName = session.customer_details?.name || '';

  if (!customerEmail) {
    console.error('KPPS delivery failed: checkout session has no customer email', { eventId, sessionId: session.id });
    return res.status(422).json({ received: false, error: 'Checkout session has no customer email', eventId });
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error('KPPS delivery failed: SUPABASE_SERVICE_KEY is not configured', { eventId });
    return res.status(500).json({ received: false, error: 'Customer access service is not configured', eventId });
  }

  const adminHeaders = {
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'apikey': SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  // Create or find Supabase user
  let userId = null;
  try {
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email: customerEmail, email_confirm: true, user_metadata: { full_name: customerName } }),
    });
    const created = await createRes.json();
    if (created.id) {
      userId = created.id;
    } else {
      // The user may already exist, or creation may have failed for another
      // recoverable reason. Always try the authoritative lookup before failing.
      const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(customerEmail)}`, { headers: adminHeaders });
      const list = await listRes.json();
      userId = list?.users?.[0]?.id || null;
    }
  } catch (_) {}

  if (!userId) {
    console.error('KPPS delivery failed: could not create or find Supabase user', { eventId, customerEmail });
    return res.status(502).json({ received: false, error: 'Could not create or find customer account', eventId });
  }

  // Set profile access — CRM sub gets the CRM key; KPPS unlocks everything; printables gets the store
  const profilePayload = {
    id: userId, email: customerEmail, full_name: customerName, has_paid: true,
  };
  if (isCRMSub) {
    // Monthly Party Biz Hub subscriber — full CRM (incl. website), NOT the printables store
    profilePayload.has_crm_access = true;
    if (session.customer) profilePayload.stripe_customer_id = session.customer;
  } else {
    // Printables buyer or KPPS member — both get the printables library
    profilePayload.has_printables_access = true;
    profilePayload.library_tier = assignedTier;
    if (isKPPS) {
      profilePayload.has_kpps_access = true;
      // KPPS includes the Party Biz Hub business tools for the first year.
      profilePayload.has_crm_access = true;
    }
  }

  let profileWritten = false;
  let profileError = null;
  try {
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(profilePayload),
    });
    if (profileRes.ok) {
      profileWritten = true;
    } else {
      const profileErr = await profileRes.json().catch(() => ({}));
      profileError = profileErr.message || profileErr.hint || profileErr.details || `HTTP ${profileRes.status}`;
      console.error('Profile upsert failed:', profileErr);
      // Fallback: PATCH the existing row directly and verify the result.
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...adminHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(profilePayload),
      });
      if (patchRes.ok) {
        profileWritten = true;
        profileError = null;
      } else {
        const patchErr = await patchRes.json().catch(() => ({}));
        profileError = patchErr.message || patchErr.hint || patchErr.details || `HTTP ${patchRes.status}`;
      }
    }
  } catch (e) {
    profileError = e.message;
  }

  if (!profileWritten) {
    console.error('KPPS delivery failed: customer profile access was not written', { eventId, userId, profileError });
    return res.status(502).json({ received: false, error: 'Customer access could not be granted', eventId, userId });
  }

  // Generate magic login link — KPPS & CRM subscribers go to dashboard, PPP goes to welcome guide
  const redirectPage = (isKPPS || isCRMSub) ? 'dashboard.html' : 'welcome.html';
  let loginUrl = '';
  try {
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ type: 'magiclink', email: customerEmail, options: { redirect_to: `https://app.partybizhub.com/${redirectPage}` } }),
    });
    const linkData = await linkRes.json();
    if (linkRes.ok && linkData.action_link) loginUrl = linkData.action_link;
  } catch (e) {
    console.error('Magic-link generation exception:', e.message);
  }

  if (!loginUrl) {
    console.error('KPPS delivery failed: Party Biz Hub magic link was not generated', { eventId, userId });
    return res.status(502).json({ received: false, error: 'Customer login link could not be generated', eventId, userId });
  }

  // Send welcome email — different copy for KPPS vs PPP
  if (RESEND_KEY) {
    const firstName = (customerName || '').split(' ')[0] || 'there';
    const emailStyles = `body{font-family:Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:0}.wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}.top{padding:28px 32px 24px;color:#fff;text-align:center}.top h1{margin:0 0 6px;font-size:1.35rem;font-weight:800}.top p{margin:0;font-size:.88rem;opacity:.85}.body{padding:28px 32px}.body p{color:#333;line-height:1.7;font-size:.92rem;margin:0 0 14px}.btn{display:block;color:#fff;text-decoration:none;text-align:center;padding:16px 24px;border-radius:12px;font-weight:800;font-size:1rem;margin:24px 0}.steps{background:#f5f0ff;border-radius:10px;padding:16px 20px;margin:16px 0}.steps p{font-weight:700;color:#4C1D95;margin:0 0 8px;font-size:.88rem}.steps ol{margin:0;padding-left:18px;color:#333;font-size:.84rem;line-height:1.8}.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}`;

    let subject, html;
    const SKOOL_LINK = 'https://www.skool.com/queen-of-side-hustles-academy-5720/about';
    if (isCRMSub) {
      subject = 'Welcome to Party Biz Hub — your subscription is active! 🎉';
      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${emailStyles}</style></head><body>
<div class="wrap">
<div class="top" style="background:linear-gradient(135deg,#4C1D95,#6D28D9,#D115AE)">
  <h1>You're in! Welcome to Party Biz Hub</h1>
  <p>Your $27/month membership is active</p>
</div>
<div class="body">
<p>Hi ${firstName},</p>
<p>Your Party Biz Hub subscription is live — you now have the full toolkit: quote builder, contracts, profit calculator, event checklist, vendors, your own website, and the AI Content Studio. Click below to log in and get started:</p>
<a href="${loginUrl}" class="btn" style="background:linear-gradient(135deg,#D115AE,#7559D4)">Log In to Party Biz Hub →</a>
<div class="steps">
<p>Here is what to do first:</p>
<ol>
<li>Click the button above to access your dashboard</li>
<li>Set up your Business Profile (name, logo, colors)</li>
<li>Build your first quote or website page</li>
<li>Generate your first social post in the Content Studio</li>
</ol>
</div>
<p style="font-size:.82rem;color:#888">If the button does not work, copy this link:<br/><a href="${loginUrl}" style="color:#7559D4;word-break:break-all">${loginUrl}</a><br/><br/>Link expired? Request a new one at <a href="https://app.partybizhub.com/login.html" style="color:#7559D4">app.partybizhub.com/login.html</a></p>
</div>
<div class="footer">Questions? Email <a href="mailto:support@partybizhub.com" style="color:#7559D4">support@partybizhub.com</a> — we respond within 24 hours.</div>
</div></body></html>`;
    } else if (isKPPS) {
      subject = 'You\'re in! Your Kids Party Profit System™ access is ready';
      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${emailStyles}
.skool-btn{display:block;background:linear-gradient(135deg,#1a0040,#4C1D95);color:#fff;text-decoration:none;text-align:center;padding:16px 24px;border-radius:12px;font-weight:800;font-size:1rem;margin:24px 0}
.pbh-box{background:#f5f0ff;border-radius:12px;padding:16px 20px;margin:16px 0;border:1.5px solid rgba(76,29,149,.15)}
.pbh-box p{font-weight:700;color:#4C1D95;margin:0 0 8px;font-size:.88rem}
.pbh-link{display:block;background:linear-gradient(135deg,#D115AE,#7559D4);color:#fff;text-decoration:none;text-align:center;padding:12px 20px;border-radius:10px;font-weight:700;font-size:.9rem;margin-top:10px}
</style></head><body>
<div class="wrap">
<div class="top" style="background:linear-gradient(135deg,#1a0040,#4C1D95,#7B2A8F)">
  <h1>Welcome to the Family! 🎉</h1>
  <p>Kids Party Profit System™ — your access is confirmed</p>
</div>
<div class="body">
<p>Hi ${firstName},</p>
<p>You are officially in! Here is everything you have access to and exactly how to get started:</p>
<p style="font-weight:700;color:#1a0040;font-size:.95rem">Step 1 — Join your Skool community (your course lives here)</p>
<a href="${SKOOL_LINK}" class="skool-btn">Join the Kids Party Profit System™ Community →</a>
<p style="font-size:.82rem;color:#888;margin-top:-10px">This is where your training, resources, and community are. Click above to join.</p>
<div class="pbh-box">
<p>Step 2 — Log in to Party Biz Hub (your business tools)</p>
<p style="font-size:.83rem;color:#333;font-weight:400;margin:0 0 4px">Party Biz Hub is your all-in-one business dashboard — digital store, quote builder, contracts, profit calculator, and more. Your first year is included with KPPS.</p>
<a href="${loginUrl}" class="pbh-link">Log In to Party Biz Hub →</a>
<p style="font-size:.78rem;color:#888;margin-top:8px;margin-bottom:0">Link expired? Go to <a href="https://app.partybizhub.com/login.html" style="color:#7559D4">app.partybizhub.com/login.html</a> to request a new one.</p>
</div>
<p style="font-size:.82rem;color:#888">If the Party Biz Hub button does not work, copy this link:<br/><a href="${loginUrl}" style="color:#7559D4;word-break:break-all">${loginUrl}</a></p>
</div>
<div class="footer">Questions? Email <a href="mailto:support@partybizhub.com" style="color:#7559D4">support@partybizhub.com</a> — we respond within 24 hours.</div>
</div></body></html>`;
    } else {
      subject = 'Your Party Profit Printables access is ready!';
      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${emailStyles}</style></head><body>
<div class="wrap">
<div class="top" style="background:linear-gradient(135deg,#4C1D95,#6D28D9,#D115AE)">
  <h1>You're in! Welcome to Party Profit Printables</h1>
  <p>Your account is ready — let's get your store set up</p>
</div>
<div class="body">
<p>Hi ${firstName},</p>
<p>You now have access to <strong>Party Profit Printables</strong> on Party Biz Hub. Click the button below to log in and set up your store:</p>
<a href="${loginUrl}" class="btn" style="background:linear-gradient(135deg,#D115AE,#7559D4)">Log In to My Store →</a>
<div class="steps">
<p>Here is what to do first:</p>
<ol>
<li>Click the button above to access your account</li>
<li>Set your store name and payment link</li>
<li>Pick your store design (colors and style)</li>
<li>Add templates from the library</li>
<li>Share your store link and start selling!</li>
</ol>
</div>
<p style="font-size:.82rem;color:#888">If the button does not work, copy this link:<br/><a href="${loginUrl}" style="color:#7559D4;word-break:break-all">${loginUrl}</a><br/><br/>Link expired? Request a new one at <a href="https://app.partybizhub.com/login.html" style="color:#7559D4">app.partybizhub.com/login.html</a></p>
</div>
<div class="footer">Questions? Email <a href="mailto:support@partybizhub.com" style="color:#7559D4">support@partybizhub.com</a> — we respond within 24 hours.</div>
</div></body></html>`;
    }

    let emailSent = false;
    let emailError = null;
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
          // Stripe retries failed webhooks. This prevents a retry or manual replay
          // from sending the same welcome email more than once within 24 hours.
          'Idempotency-Key': `purchase-delivery/${eventId}`,
        },
        body: JSON.stringify({ from: FROM_EMAIL, to: customerEmail, subject, html }),
      });
      const emailData = await emailRes.json().catch(() => ({}));
      if (emailRes.ok) {
        emailSent = true;
      } else {
        emailError = emailData.message || emailData.error || `Resend HTTP ${emailRes.status}`;
      }
    } catch (e) {
      emailError = e.message;
    }

    if (!emailSent) {
      console.error('KPPS delivery failed: Resend did not accept the welcome email', { eventId, userId, emailError });
      return res.status(502).json({
        received: false,
        error: 'Welcome email could not be sent',
        eventId,
        userId,
        tier: assignedTier,
        emailSent: false,
        emailError,
      });
    }

    return res.json({ received: true, eventId, userId, tier: assignedTier, profileWritten, emailSent: true });
  }

  console.error('KPPS delivery failed: RESEND_API_KEY is not configured', { eventId, userId });
  return res.status(500).json({
    received: false,
    error: 'Welcome email service is not configured',
    eventId,
    userId,
    tier: assignedTier,
    profileWritten,
    emailSent: false,
  });
}

async function handleBookingDeposit(res, event, session, config) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, eventId } = config;
  const bookingId = session.metadata?.booking_id || session.client_reference_id || '';
  const ownerId = session.metadata?.owner_id || '';
  const quoteId = session.metadata?.quote_id || '';
  const connectedAccount = event.account || '';
  if (!bookingId || !ownerId || !connectedAccount) {
    return res.status(422).json({ received: false, error: 'Deposit event is missing its booking identity', eventId });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ received: false, error: 'Deposit automation is not configured', eventId });
  }
  const headers = {
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    apikey: SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}` +
      `&owner_id=eq.${encodeURIComponent(ownerId)}&select=*&limit=1`, { headers }
    );
    const bookings = await bookingRes.json().catch(() => []);
    const booking = Array.isArray(bookings) ? bookings[0] : null;
    if (!bookingRes.ok || !booking) {
      return res.status(404).json({ received: false, error: 'Matching booking was not found', eventId });
    }

    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(ownerId)}` +
      '&select=id,profile_data&limit=1', { headers }
    );
    const profiles = await profileRes.json().catch(() => []);
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    const pd = profile?.profile_data || {};
    if (!profileRes.ok || !profile || pd.stripeConnectAccountId !== connectedAccount) {
      return res.status(403).json({ received: false, error: 'Stripe account does not match this business', eventId });
    }

    const expectedCents = Number(session.metadata?.deposit_amount_cents || session.amount_total || 0);
    if (session.payment_status !== 'paid' || Number(session.amount_total || 0) !== expectedCents || expectedCents <= 0) {
      return res.status(409).json({ received: false, error: 'Deposit payment is not complete', eventId });
    }

    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}` +
      `&owner_id=eq.${encodeURIComponent(ownerId)}`,
      {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'deposit-paid', deposit_due_at: null, deposit_reminder_sent: null }),
      }
    );
    if (!updateRes.ok) throw new Error('Booking payment status could not be updated');

    if (quoteId) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/saved_quotes?id=eq.${encodeURIComponent(quoteId)}` +
        `&user_id=eq.${encodeURIComponent(ownerId)}`,
        {
          method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'deposit-paid' }),
        }
      ).catch(() => {});
    }

    let contractSent = false;
    let contractExisting = false;
    if (pd.autoContract !== false && booking.client_email && booking.event_date) {
      const existingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/contracts?user_id=eq.${encodeURIComponent(ownerId)}` +
        `&client_email=eq.${encodeURIComponent(booking.client_email)}` +
        `&event_date=eq.${encodeURIComponent(booking.event_date)}&select=id&limit=1`, { headers }
      );
      const existing = await existingRes.json().catch(() => []);
      contractExisting = existingRes.ok && Array.isArray(existing) && existing.length > 0;
      if (!contractExisting) {
        const contractRes = await fetch('https://partybizhub.com/api/auto-contract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-pbh-internal': SUPABASE_SERVICE_KEY,
          },
          body: JSON.stringify({
            ownerUID: ownerId,
            clientName: booking.client_name, clientEmail: booking.client_email,
            clientPhone: booking.client_phone, eventDate: booking.event_date,
            eventTime: booking.event_time, eventAddress: booking.event_address,
            serviceName: booking.service_name, servicePrice: booking.service_price,
            numKids: booking.num_kids, duration: booking.duration,
            bizName: pd.bizName || pd.businessName || '',
            bizEmail: pd.contactEmail || pd.bizEmail || '',
            bizPhone: pd.contactPhone || pd.bizPhone || '',
            depositAmountPaid: expectedCents / 100,
          }),
        });
        const contract = await contractRes.json().catch(() => ({}));
        contractSent = contractRes.ok && contract.email_sent === true;
        if (!contractRes.ok) console.error('Automatic contract failed after deposit', { eventId, bookingId, error: contract.error });
      }
    }

    return res.json({
      received: true, eventId, bookingId, status: 'deposit-paid',
      contractSent, contractExisting,
    });
  } catch (e) {
    console.error('Deposit automation failed', { eventId, bookingId, error: e.message });
    return res.status(500).json({ received: false, error: e.message, eventId, bookingId });
  }
}

async function handleGenerateCopy(res, body) {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
  const { name, theme } = body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!OPENROUTER_KEY) return res.status(200).json({ error: 'OPENROUTER_API_KEY not set in Vercel env vars' });

  const prompt = `You are helping a party printables business owner. Write copy for a digital template pack.

Template name: "${name}"
Theme: "${theme || 'General party'}"

Write TWO things:
1. DESCRIPTION: 2 sentences for party planners. Mention it is a complete bundle and name 4-5 specific printable types (chip bags, water bottle labels, cupcake toppers, etc).
2. INSTRUCTIONS: Exactly 5 short steps for a customer to customize and use this Canva template pack from a ZIP file.

Return ONLY this JSON with a string array for instructions:
{"description":"your description","instructions":["Step 1","Step 2","Step 3","Step 4","Step 5"]}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENROUTER_KEY,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://partybizhub.com',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      }),
    });
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (_) {
      // Replace raw newlines/tabs inside the JSON string then retry
      parsed = JSON.parse(jsonMatch[0].replace(/\r?\n|\t/g, ' '));
    }

    const instructions = Array.isArray(parsed.instructions)
      ? parsed.instructions.join('\n')
      : String(parsed.instructions || '');

    return res.json({ description: parsed.description || '', instructions });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleGrantAccess(res, body) {
  const SUPABASE_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  // Default to the VERIFIED partybizhub.com sender so emails work even if the env
  // var is unset/misnamed. onboarding@resend.dev is Resend's sandbox and only
  // delivers to the account owner — never use it for real customer email.
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Party Biz Hub <support@partybizhub.com>';

  const { email, accessType, customerName } = body; // accessType: 'ppp' | 'kpps' | 'both' | 'crm'
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Service key not configured' });

  const adminHeaders = {
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'apikey': SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  // Find or create Supabase user
  let userId = null;
  try {
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: customerName || '' } }),
    });
    const created = await createRes.json();
    if (created.id) {
      userId = created.id;
    } else {
      // User already exists or creation failed — always look them up
      const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers: adminHeaders });
      const list = await listRes.json();
      userId = list?.users?.[0]?.id || null;
    }
  } catch (_) {}

  if (!userId) return res.status(400).json({ error: 'Could not find or create user' });

  // Build profile payload based on access type
  const isKPPS = accessType === 'kpps' || accessType === 'both';
  // 'crm' unlocks the CRM tools + website builder ONLY. It deliberately does not
  // set has_kpps_access, which would also flip the isPPPOnly checks in
  // dashboard.html / store.html and hand over KPPS course + store tiers.
  const isCRM  = accessType === 'crm'  || isKPPS;
  const isPPP  = accessType === 'ppp'  || accessType === 'both' || isKPPS;
  const profilePayload = {
    id: userId, email, has_paid: true, library_tier: 'founding',
    ...(isPPP  && { has_printables_access: true }),
    ...(isKPPS && { has_kpps_access: true }),
    ...(isCRM  && { has_crm_access: true }),
  };
  if (customerName) profilePayload.full_name = customerName;

  // Upsert profile — POST with on_conflict, then PATCH as fallback
  let profileWritten = false;
  let profileError = null;
  try {
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(profilePayload),
    });
    if (upsertRes.ok) {
      profileWritten = true;
    } else {
      const errBody = await upsertRes.json().catch(() => ({}));
      profileError = errBody.message || errBody.hint || errBody.details || `HTTP ${upsertRes.status}`;
      // Fallback: PATCH the existing row
      const patchPayload = { has_paid: true, library_tier: 'founding', email };
      if (isPPP)  patchPayload.has_printables_access = true;
      if (isKPPS) patchPayload.has_kpps_access = true;
      if (isCRM)  patchPayload.has_crm_access = true;
      if (customerName) patchPayload.full_name = customerName;
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...adminHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(patchPayload),
      });
      if (patchRes.ok) { profileWritten = true; profileError = null; }
      else {
        const patchErr = await patchRes.json().catch(() => ({}));
        profileError = patchErr.message || patchErr.hint || `PATCH HTTP ${patchRes.status}`;
      }
    }
  } catch (e) {
    profileError = e.message;
  }

  // Generate magic login link
  const redirectPage = isKPPS ? 'dashboard.html' : 'welcome.html';
  let loginUrl = `https://app.partybizhub.com/${redirectPage}`;
  try {
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ type: 'magiclink', email, options: { redirect_to: `https://app.partybizhub.com/${redirectPage}` } }),
    });
    const linkData = await linkRes.json();
    if (linkData.action_link) loginUrl = linkData.action_link;
  } catch (_) {}

  // Send welcome email
  if (RESEND_KEY) {
    const firstName = (customerName || '').split(' ')[0] || 'there';
    const accessLabel = isKPPS ? 'Kids Party Profit System™ (full access)' : 'Party Profit Printables™';
    const SKOOL_LINK = 'https://www.skool.com/queen-of-side-hustles-academy-5720/about';
    const steps = isKPPS
      ? ['Join your Skool community using the button above — your course & training live there','Log into Party Biz Hub for your business tools (store, quote builder, contracts, printables)','Use the Quick Start guide inside your dashboard to get set up','Reach out to support@partybizhub.com with any questions']
      : ['Click the button above to access your account','Set your store name and payment link','Pick your store design','Add templates from the library','Share your store link and start selling!'];
    // KPPS buyers also get their Skool community link — the course lives there
    const skoolBlock = isKPPS
      ? `<p style="font-weight:700;color:#1a0040;font-size:.95rem;margin:0 0 4px">Step 1 — Join your Kids Party Profit System™ community (your course lives here)</p>
<a href="${SKOOL_LINK}" class="btn" style="background:linear-gradient(135deg,#1a0040,#4C1D95)">Join the Skool Community →</a>
<p style="font-weight:700;color:#4C1D95;font-size:.95rem;margin:0 0 4px">Step 2 — Log into Party Biz Hub (your business tools)</p>`
      : '';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:0}.wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}.top{background:linear-gradient(135deg,${isKPPS?'#1a0040,#4C1D95,#7B2A8F':'#4C1D95,#6D28D9,#D115AE'});padding:28px 32px 24px;color:#fff;text-align:center}.top h1{margin:0 0 6px;font-size:1.35rem;font-weight:800}.top p{margin:0;font-size:.88rem;opacity:.85}.body{padding:28px 32px}.body p{color:#333;line-height:1.7;font-size:.92rem;margin:0 0 14px}.btn{display:block;background:linear-gradient(135deg,${isKPPS?'#4C1D95,#7B2A8F':'#D115AE,#7559D4'});color:#fff;text-decoration:none;text-align:center;padding:16px 24px;border-radius:12px;font-weight:800;font-size:1rem;margin:24px 0}.steps{background:#f5f0ff;border-radius:10px;padding:16px 20px;margin:16px 0}.steps p{font-weight:700;color:#4C1D95;margin:0 0 8px;font-size:.88rem}.steps ol{margin:0;padding-left:18px;color:#333;font-size:.84rem;line-height:1.8}.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}</style></head><body>
<div class="wrap"><div class="top"><h1>Your access is ready!</h1><p>${accessLabel}</p></div>
<div class="body"><p>Hi ${firstName},</p><p>Your access to <strong>${accessLabel}</strong> has been set up. Here is how to get started:</p>
${skoolBlock}
<a href="${loginUrl}" class="btn">Log In to Party Biz Hub →</a>
<div class="steps"><p>Here is what to do first:</p><ol>${steps.map(s=>`<li>${s}</li>`).join('')}</ol></div>
<p style="font-size:.82rem;color:#888">If the button does not work, copy this link:<br/><a href="${loginUrl}" style="color:#7559D4;word-break:break-all">${loginUrl}</a></p>
</div><div class="footer">Questions? Email <a href="mailto:support@partybizhub.com" style="color:#7559D4">support@partybizhub.com</a> — we respond within 24 hours.</div>
</div></body></html>`;

    let emailSent = false, emailError = '';
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: email, subject: `Your ${accessLabel} access is ready!`, html }),
      });
      const emailData = await emailRes.json().catch(() => ({}));
      if (emailRes.ok) emailSent = true;
      else emailError = emailData.message || emailData.error || `Resend HTTP ${emailRes.status}`;
    } catch (e) { emailError = e.message; }
    return res.json({ success: true, loginUrl, profileWritten, profileError: profileError || null, emailSent, emailError: emailError || null });
  }

  return res.json({ success: true, loginUrl, profileWritten, profileError: profileError || null, emailSent: false, emailError: 'RESEND_API_KEY not set in Vercel env vars' });
}

async function handleSendEmail(res, body) {
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  // Default to the VERIFIED partybizhub.com sender so emails work even if the env
  // var is unset/misnamed. onboarding@resend.dev is Resend's sandbox and only
  // delivers to the account owner — never use it for real customer email.
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Party Biz Hub <support@partybizhub.com>';
  const { customerEmail, customerName, productName, downloadUrl, instructions, sellerName } = body;

  if (!customerEmail || !downloadUrl) {
    return res.status(400).json({ error: 'customerEmail and downloadUrl are required' });
  }
  if (!RESEND_KEY) {
    return res.status(200).json({ sent: false, note: 'Add RESEND_API_KEY to Vercel env vars to send emails automatically.' });
  }

  const firstName = (customerName || '').split(' ')[0] || 'there';
  const instructionRows = instructions
    ? instructions.split('\n').filter(l => l.trim()).map(l => `<li style="margin-bottom:6px">${l.trim()}</li>`).join('')
    : '';
  const instructionBlock = instructionRows
    ? `<div style="background:#f5f0fb;border-radius:10px;padding:16px 20px;margin:20px 0">
        <p style="font-weight:700;color:#7559D4;margin:0 0 10px;font-size:.88rem">Your step-by-step instructions:</p>
        <ol style="margin:0;padding-left:20px;color:#333;font-size:.85rem;line-height:1.8">${instructionRows}</ol>
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:0}
.wrap{max-width:540px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.top{background:linear-gradient(135deg,#D115AE,#7559D4);padding:28px 32px;color:#fff;text-align:center}
.top h1{margin:0;font-size:1.25rem;font-weight:800;letter-spacing:-.02em}
.top p{margin:6px 0 0;font-size:.88rem;opacity:.82}
.body{padding:28px 32px}
.body p{color:#333;line-height:1.7;font-size:.92rem;margin:0 0 14px}
.btn{display:block;background:linear-gradient(135deg,#D115AE,#7559D4);color:#fff;text-decoration:none;text-align:center;padding:14px 24px;border-radius:10px;font-weight:700;font-size:1rem;margin:24px 0}
.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}
</style></head>
<body>
<div class="wrap">
  <div class="top">
    <h1>Your Download is Ready!</h1>
    <p>${productName ? productName + ' from ' : ''}${sellerName || 'Party Biz Hub'}</p>
  </div>
  <div class="body">
    <p>Hi ${firstName},</p>
    <p>Thank you for your purchase! Your printable is ready to download and customize in Canva.</p>
    <a href="${downloadUrl}" class="btn">Download Your Printable</a>
    ${instructionBlock}
    <p style="font-size:.82rem;color:#888">If the button does not work, copy this link:<br><a href="${downloadUrl}" style="color:#7559D4;word-break:break-all">${downloadUrl}</a></p>
  </div>
  <div class="footer">Questions? Reply to this email and we will help right away.</div>
</div>
</body></html>`;

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: customerEmail,
        subject: 'Your download: ' + (productName || 'Party Printable'),
        html,
      }),
    });
    const result = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok) return res.status(200).json({ sent: false, note: 'Email failed: ' + (result.message || emailRes.status) });
    return res.json({ sent: true });
  } catch (e) {
    return res.status(200).json({ sent: false, note: 'Email error: ' + e.message });
  }
}
