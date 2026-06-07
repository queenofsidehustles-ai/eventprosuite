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

  // Stripe webhook — needs raw body for signature verification
  if (req.headers['stripe-signature']) {
    const rawBody = await readRawBody(req);
    return handleStripeWebhook(res, rawBody, req.headers['stripe-signature']);
  }

  const body = req.body || {};
  if (body.action === 'generate-copy') return handleGenerateCopy(res, body);
  if (body.action === 'grant-access') return handleGrantAccess(res, body);
  return handleSendEmail(res, body);
};

module.exports.config = { api: { bodyParser: true } };

async function handleStripeWebhook(res, rawBody, sigHeader) {
  const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
  const SUPABASE_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  // Verify Stripe signature
  if (STRIPE_SECRET) {
    try {
      const parts = sigHeader.split(',');
      const ts = (parts.find(p => p.startsWith('t=')) || '').slice(2);
      const sig = (parts.find(p => p.startsWith('v1=')) || '').slice(3);
      const expected = crypto.createHmac('sha256', STRIPE_SECRET).update(`${ts}.${rawBody}`).digest('hex');
      const valid = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
      if (!valid) return res.status(400).json({ error: 'Invalid signature' });
    } catch (_) {
      return res.status(400).json({ error: 'Signature check failed' });
    }
  }

  let event;
  try { event = JSON.parse(rawBody.toString()); } catch (_) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true });
  }

  const session = event.data?.object || {};

  // Classify the purchase type by amount
  const amountTotal = session.amount_total || 0;
  const sessionMode = session.mode || 'payment';

  // KPPS purchases — unlock full system
  const KPPS_AMOUNTS = { 40000: true, 49700: true }; // $400 upgrade or $497 full price
  const isKPPS = !!KPPS_AMOUNTS[amountTotal];

  // PPP tier map — template library access level
  const PPP_TIER_MAP = {
    9700: sessionMode === 'payment' ? 'founding' : 'unlimited',
    2700: 'tier1',
    4700: 'tier2',
    6700: 'tier3',
  };
  const assignedTier = isKPPS ? 'founding' : PPP_TIER_MAP[amountTotal];

  if (!assignedTier) {
    return res.json({ received: true, note: 'Not a recognized purchase — skipped' });
  }

  const customerEmail = session.customer_details?.email || session.customer_email || '';
  const customerName = session.customer_details?.name || '';

  if (!customerEmail || !SUPABASE_SERVICE_KEY) {
    return res.json({ received: true, note: 'Missing email or service key' });
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
    } else if (created.msg && created.msg.includes('already')) {
      // User exists — find them
      const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(customerEmail)}`, { headers: adminHeaders });
      const list = await listRes.json();
      userId = list?.users?.[0]?.id || null;
    }
  } catch (_) {}

  if (!userId) return res.json({ received: true, note: 'Could not create or find user' });

  // Set profile access — KPPS unlocks everything; PPP unlocks printables only
  const profilePayload = {
    id: userId, email: customerEmail, full_name: customerName,
    has_paid: true, has_printables_access: true, library_tier: assignedTier,
  };
  if (isKPPS) profilePayload.has_kpps_access = true;

  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...adminHeaders, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(profilePayload),
  }).catch(() => {});

  // Generate magic login link — KPPS goes to dashboard, PPP goes to welcome guide
  const redirectPage = isKPPS ? 'dashboard.html' : 'welcome.html';
  let loginUrl = `https://app.partybizhub.com/${redirectPage}`;
  try {
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ type: 'magiclink', email: customerEmail, options: { redirect_to: `https://app.partybizhub.com/${redirectPage}` } }),
    });
    const linkData = await linkRes.json();
    if (linkData.action_link) loginUrl = linkData.action_link;
  } catch (_) {}

  // Send welcome email — different copy for KPPS vs PPP
  if (RESEND_KEY) {
    const firstName = (customerName || '').split(' ')[0] || 'there';
    const emailStyles = `body{font-family:Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:0}.wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}.top{padding:28px 32px 24px;color:#fff;text-align:center}.top h1{margin:0 0 6px;font-size:1.35rem;font-weight:800}.top p{margin:0;font-size:.88rem;opacity:.85}.body{padding:28px 32px}.body p{color:#333;line-height:1.7;font-size:.92rem;margin:0 0 14px}.btn{display:block;color:#fff;text-decoration:none;text-align:center;padding:16px 24px;border-radius:12px;font-weight:800;font-size:1rem;margin:24px 0}.steps{background:#f5f0ff;border-radius:10px;padding:16px 20px;margin:16px 0}.steps p{font-weight:700;color:#4C1D95;margin:0 0 8px;font-size:.88rem}.steps ol{margin:0;padding-left:18px;color:#333;font-size:.84rem;line-height:1.8}.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}`;

    let subject, html;
    const SKOOL_LINK = 'https://www.skool.com/queen-of-side-hustles-academy-5720/about';
    if (isKPPS) {
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
<p style="font-size:.83rem;color:#333;font-weight:400;margin:0 0 4px">Party Biz Hub is your all-in-one business dashboard — digital store, quote builder, contracts, profit calculator, and more. It is included with your KPPS membership.</p>
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

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: customerEmail, subject, html }),
    }).catch(() => {});
  }

  return res.json({ received: true });
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
        model: 'anthropic/claude-3.5-haiku',
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
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  const { email, accessType, customerName } = body; // accessType: 'ppp' | 'kpps' | 'both'
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
    } else if (created.msg && created.msg.includes('already')) {
      const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers: adminHeaders });
      const list = await listRes.json();
      userId = list?.users?.[0]?.id || null;
    }
  } catch (_) {}

  if (!userId) return res.status(400).json({ error: 'Could not find or create user' });

  // Build profile payload based on access type
  const isKPPS = accessType === 'kpps' || accessType === 'both';
  const isPPP  = accessType === 'ppp'  || accessType === 'both' || isKPPS;
  const profilePayload = {
    id: userId, email, has_paid: true, library_tier: 'founding',
    ...(isPPP  && { has_printables_access: true }),
    ...(isKPPS && { has_kpps_access: true }),
  };
  if (customerName) profilePayload.full_name = customerName;

  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...adminHeaders, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(profilePayload),
  }).catch(() => {});

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
    const steps = isKPPS
      ? ['Click the button above to log into your dashboard','Explore your digital store, quote builder, contracts, and more','Check out the Party Profit Printables™ template library','Use the Quick Start guide inside your store to get set up','Reach out to support@partybizhub.com with any questions']
      : ['Click the button above to access your account','Set your store name and payment link','Pick your store design','Add templates from the library','Share your store link and start selling!'];
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Inter,Arial,sans-serif;background:#f5f5f7;margin:0;padding:0}.wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}.top{background:linear-gradient(135deg,${isKPPS?'#1a0040,#4C1D95,#7B2A8F':'#4C1D95,#6D28D9,#D115AE'});padding:28px 32px 24px;color:#fff;text-align:center}.top h1{margin:0 0 6px;font-size:1.35rem;font-weight:800}.top p{margin:0;font-size:.88rem;opacity:.85}.body{padding:28px 32px}.body p{color:#333;line-height:1.7;font-size:.92rem;margin:0 0 14px}.btn{display:block;background:linear-gradient(135deg,${isKPPS?'#4C1D95,#7B2A8F':'#D115AE,#7559D4'});color:#fff;text-decoration:none;text-align:center;padding:16px 24px;border-radius:12px;font-weight:800;font-size:1rem;margin:24px 0}.steps{background:#f5f0ff;border-radius:10px;padding:16px 20px;margin:16px 0}.steps p{font-weight:700;color:#4C1D95;margin:0 0 8px;font-size:.88rem}.steps ol{margin:0;padding-left:18px;color:#333;font-size:.84rem;line-height:1.8}.footer{padding:16px 32px;text-align:center;font-size:.78rem;color:#999;border-top:1px solid #eee}</style></head><body>
<div class="wrap"><div class="top"><h1>Your access is ready!</h1><p>${accessLabel}</p></div>
<div class="body"><p>Hi ${firstName},</p><p>Your access to <strong>${accessLabel}</strong> has been set up. Click below to log in:</p>
<a href="${loginUrl}" class="btn">Log In Now →</a>
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
    return res.json({ success: true, loginUrl, emailSent, emailError: emailError || null });
  }

  return res.json({ success: true, loginUrl, emailSent: false, emailError: 'RESEND_API_KEY not set in Vercel env vars' });
}

async function handleSendEmail(res, body) {
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
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
