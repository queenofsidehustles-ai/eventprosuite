// /api/lead-capture
//
// Several jobs share this route because Vercel's plan allows only 12
// serverless functions and /api is already at 12. Routed by `kind`:
//
//   (default)            POST — Party Biz Hub quiz lead: MailerLite + results email
//   kind: 'birthday'     POST — a parent signs up for a birthday reminder on a
//                        student's site. Inserted with the service key after
//                        validation; nothing else happens (no owner email).
//   kind: 'unsubscribe'  GET (or one-click POST) ?kind=unsubscribe&id=<birthday_list id>
//                        — stops birthday reminders, returns a small HTML page.
const engine = require('./_booking-engine');

const env = name => String(process.env[name] || '').trim();
const SUPA_URL = 'https://dmqwoddwzpfnmpjtwiee.supabase.co';
const serviceKey = () => env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY');

// Per instance only — enough to blunt a burst of junk from one place.
const perIpOwner = engine.makeRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 });
const perIp = engine.makeRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 });

function parseBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b.trim()) {
    try { return JSON.parse(b); } catch (_) {
      // A one-click unsubscribe POST arrives form-encoded.
      return Object.fromEntries(new URLSearchParams(b));
    }
  }
  return {};
}

function clientIp(req) {
  const h = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  return String(h).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async (req, res) => {
  const query = req.query || {};
  const body = req.method === 'POST' ? parseBody(req) : {};
  const kind = String(query.kind || body.kind || '').toLowerCase();

  if (kind === 'unsubscribe') return unsubscribe(req, res, query.id || body.id);
  if (kind === 'birthday') {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    return birthdaySignup(req, res, body);
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const {
    name, email, score, tier,
    recommendedPrice, currentEstimate, gap, serviceType,
    pbh_source,
  } = req.body || {};

  if (!email || !name) return res.status(400).json({ ok: false, error: 'Name and email required' });

  const MAILER_LITE_KEY = process.env.MAILER_LITE_API_KEY || '';
  const RESEND_KEY      = process.env.RESEND_API_KEY || '';
  const FROM_EMAIL      = process.env.RESEND_FROM_EMAIL || 'hello@partybizhub.com';

  const errors = [];

  // ── 1. ADD TO MAILERLITE ──────────────────────────────────────────────
  if (MAILER_LITE_KEY) {
    try {
      const mlRes = await fetch('https://connect.mailerlite.com/api/subscribers', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${MAILER_LITE_KEY}`,
          'Accept':        'application/json',
        },
        body: JSON.stringify({
          email,
          fields: {
            name,
            last_name: '',
            pbh_score:    String(score),
            pbh_tier:     tier,
            pbh_price:    String(recommendedPrice),
            pbh_service:  serviceType,
            pbh_source:   pbh_source || 'direct',
          },
          groups: process.env.MAILER_LITE_GROUP_ID ? [process.env.MAILER_LITE_GROUP_ID] : [],
          status: 'active',
        }),
      });
      if (!mlRes.ok) {
        const body = await mlRes.json().catch(() => ({}));
        errors.push('MailerLite: ' + (body.message || mlRes.status));
      }
    } catch (e) {
      errors.push('MailerLite: ' + e.message);
    }
  }

  // ── 2. SEND RESULTS EMAIL VIA RESEND ─────────────────────────────────
  if (RESEND_KEY) {
    const monthly4  = (recommendedPrice * 4).toLocaleString();
    const monthly8  = (recommendedPrice * 8).toLocaleString();
    const gapMonthly = (gap * 4).toLocaleString();

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#F5F3FF;color:#1A1020;-webkit-font-smoothing:antialiased}
.wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.header{background:linear-gradient(135deg,#4C1D95,#6D28D9);padding:36px 32px;text-align:center}
.header img{height:36px;margin-bottom:16px;display:block;margin:0 auto 16px}
.header h1{color:#fff;font-size:22px;font-weight:800;line-height:1.3;letter-spacing:-.02em}
.header p{color:rgba(255,255,255,.75);font-size:14px;margin-top:8px}
.body{padding:32px}
.score-badge{background:#F3EEFF;border-radius:16px;padding:20px 24px;text-align:center;margin-bottom:24px}
.score-badge .num{font-size:48px;font-weight:900;color:#6D28D9;line-height:1}
.score-badge .label{font-size:14px;color:#6B5B73;margin-top:4px}
.score-badge .tier{font-size:16px;font-weight:800;color:#4C1D95;margin-top:6px}
.price-box{background:linear-gradient(135deg,#4C1D95,#6D28D9);border-radius:16px;padding:24px;color:#fff;margin-bottom:16px}
.price-box .lbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:4px}
.price-box .amount{font-size:42px;font-weight:900;letter-spacing:-.04em;line-height:1}
.price-box .unit{font-size:13px;color:rgba(255,255,255,.65);margin-top:4px}
.warn-box{background:#FFF8E1;border:2px solid #F5D87A;border-radius:14px;padding:18px 20px;margin-bottom:16px}
.warn-box h4{font-size:14px;font-weight:800;color:#92400E;margin-bottom:4px}
.warn-box p{font-size:13px;color:#A16207;line-height:1.6}
.warn-box .big{font-size:20px;font-weight:900;color:#92400E}
.monthly{background:#F9F5FF;border-radius:14px;padding:18px;display:flex;justify-content:space-around;margin-bottom:24px;text-align:center}
.monthly .stat .n{font-size:22px;font-weight:900;color:#6D28D9}
.monthly .stat .l{font-size:11px;color:#6B5B73;margin-top:2px}
.section-title{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9575A6;margin-bottom:14px}
.action-item{display:flex;gap:12px;align-items:flex-start;margin-bottom:14px;padding:14px;background:#FAFAFA;border-radius:12px}
.action-num{width:26px;height:26px;background:#6D28D9;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;margin-top:1px}
.action-item h4{font-size:14px;font-weight:700;margin-bottom:3px}
.action-item p{font-size:13px;color:#6B5B73;line-height:1.5}
.cta-box{text-align:center;margin-top:28px;padding-top:24px;border-top:1px solid #EDE5F5}
.cta-box p{font-size:14px;color:#6B5B73;margin-bottom:16px;line-height:1.6}
.cta-btn{display:inline-block;background:linear-gradient(135deg,#8B5CF6,#4C1D95);color:#fff;font-size:15px;font-weight:800;padding:15px 36px;border-radius:14px;text-decoration:none;letter-spacing:-.01em}
.footer{padding:20px 32px;text-align:center;font-size:12px;color:#9575A6;border-top:1px solid #EDE5F5}
.footer a{color:#6D28D9;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Your Party Business Results, ${name}! 🎉</h1>
    <p>Here's your personalized score + pricing breakdown</p>
  </div>
  <div class="body">

    <div class="score-badge">
      <div class="num">${score}<span style="font-size:22px;opacity:.5">/10</span></div>
      <div class="label">Your Party Business Score</div>
      <div class="tier">${tier}</div>
    </div>

    <div class="price-box">
      <div class="lbl">Your Recommended Price Per Event</div>
      <div class="amount">$${recommendedPrice.toLocaleString()}</div>
      <div class="unit">${serviceType}</div>
    </div>

    <div class="warn-box">
      <h4>You might currently be charging: <span class="big">$${currentEstimate.toLocaleString()}</span></h4>
      <p>That's <strong>$${gap.toLocaleString()} left on the table</strong> every single event — and <strong>$${gapMonthly}/month</strong> if you're booking just 4 events.</p>
    </div>

    <div class="monthly">
      <div class="stat"><div class="n">$${monthly4}</div><div class="l">4 events/mo</div></div>
      <div class="stat"><div class="n">$${monthly8}</div><div class="l">8 events/mo</div></div>
    </div>

    <p class="section-title">Your 3-Step Action Plan</p>

    <div class="action-item">
      <div class="action-num">1</div>
      <div>
        <h4>Set your price — today</h4>
        <p>Update your booking page or social bio with your new rate. Don't apologize for it. Your price is your value.</p>
      </div>
    </div>
    <div class="action-item">
      <div class="action-num">2</div>
      <div>
        <h4>Add a contract + deposit requirement</h4>
        <p>These two things will cut no-shows by 80% and make you look like a serious business — not a side hustle.</p>
      </div>
    </div>
    <div class="action-item">
      <div class="action-num">3</div>
      <div>
        <h4>Send a branded quote before every event</h4>
        <p>A professional quote builds trust, confirms the details, and gets you paid faster. Party Biz Hub does this in 30 seconds.</p>
      </div>
    </div>

    <div class="cta-box">
      <p>Party Biz Hub gives you quotes, contracts, a booking page, and AI-powered content — all in one place, starting at $27/month.</p>
      <a class="cta-btn" href="https://app.partybizhub.com/login.html">Start Your Free Account →</a>
    </div>
  </div>
  <div class="footer">
    You're receiving this because you took the Party Biz Hub Quiz.<br/>
    <a href="https://partybizhub.com">partybizhub.com</a> · Built by Coach Monica
  </div>
</div>
</body>
</html>`;

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
        body: JSON.stringify({
          from:    `Party Biz Hub <${FROM_EMAIL}>`,
          to:      email,
          subject: `${name}, your Party Biz Hub score is ${score}/10 🎉`,
          html,
        }),
      });
    } catch (e) {
      errors.push('Resend: ' + e.message);
    }
  }

  return res.status(200).json({ ok: true, errors: errors.length ? errors : undefined });
};


// ── Birthday sign-up ────────────────────────────────────────────────────
async function birthdaySignup(req, res, body) {
  const check = engine.validateBirthdaySignup(body);
  // A filled honeypot gets a normal-looking success so the bot moves on.
  if (!check.ok && check.silent) return res.status(200).json({ ok: true });
  if (!check.ok) return res.status(400).json({ ok: false, error: check.error });
  const row = check.row;

  const ip = clientIp(req);
  if (!perIp(ip) || !perIpOwner(ip + '|' + row.owner_id)) {
    return res.status(429).json({ ok: false, error: 'Too many sign-ups — please try again a little later' });
  }

  const KEY = serviceKey();
  if (!KEY) return res.status(500).json({ ok: false, error: 'Sign-ups are not configured yet' });
  const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

  try {
    const ownerRes = await fetch(
      `${SUPA_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(row.owner_id)}&select=id&limit=1`, { headers }
    );
    const owners = await ownerRes.json().catch(() => []);
    if (!ownerRes.ok || !Array.isArray(owners) || !owners.length) {
      return res.status(404).json({ ok: false, error: 'Unknown business' });
    }

    // The same family signing up twice is one reminder, not two.
    if (row.email) {
      const dupRes = await fetch(
        `${SUPA_URL}/rest/v1/birthday_list?owner_id=eq.${encodeURIComponent(row.owner_id)}` +
        `&email=eq.${encodeURIComponent(row.email)}&birth_month=eq.${row.birth_month}&birth_day=eq.${row.birth_day}` +
        `&select=id,child_name,unsubscribed`, { headers }
      );
      const dups = await dupRes.json().catch(() => []);
      const same = Array.isArray(dups) && dups.find(d =>
        String(d.child_name || '').toLowerCase() === String(row.child_name || '').toLowerCase());
      if (same) {
        // Signing up again is a fresh yes, so it undoes an earlier unsubscribe.
        if (same.unsubscribed) {
          await fetch(`${SUPA_URL}/rest/v1/birthday_list?id=eq.${encodeURIComponent(same.id)}`, {
            method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ unsubscribed: false, consent: true }),
          });
        }
        return res.status(200).json({ ok: true });
      }
    }

    const ins = await fetch(`${SUPA_URL}/rest/v1/birthday_list`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row),
    });
    if (!ins.ok) {
      console.error('Birthday sign-up insert failed:', ins.status, await ins.text().catch(() => ''));
      return res.status(500).json({ ok: false, error: 'Could not save right now — please try again' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Birthday sign-up failed:', e);
    return res.status(500).json({ ok: false, error: 'Could not save right now — please try again' });
  }
}

// ── Unsubscribe ─────────────────────────────────────────────────────────
function unsubPage(title, message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${engine.esc(title)}</title></head>
<body style="margin:0;background:#f4f2f8;font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;color:#3a2a4a">
<div style="max-width:440px;margin:64px auto;padding:0 16px">
  <div style="background:#fff;border-radius:16px;padding:32px 28px;text-align:center">
    <h1 style="margin:0 0 10px;font-size:22px">${engine.esc(title)}</h1>
    <p style="margin:0;font-size:15px;line-height:1.7">${engine.esc(message)}</p>
  </div>
</div></body></html>`;
}

async function unsubscribe(req, res, id) {
  const send = (status, title, message) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(status).send(unsubPage(title, message));
  };
  if (!engine.UUID_RE.test(String(id || ''))) {
    return send(400, 'Link not recognised', 'This unsubscribe link looks incomplete. Reply to the email and we will take you off the list.');
  }
  const KEY = serviceKey();
  if (!KEY) return send(500, 'Something went wrong', 'Please reply to the email and we will take you off the list.');
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/birthday_list?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ unsubscribed: true }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return send(200, "You're unsubscribed", "You won't get any more birthday reminders from us. Thank you for celebrating with us!");
  } catch (e) {
    console.error('Unsubscribe failed:', e);
    return send(500, 'Something went wrong', 'Please try the link again, or reply to the email and we will take you off the list.');
  }
}
