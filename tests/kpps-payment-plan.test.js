'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const purchaseHandler = require('../api/send-purchase-email.js');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const api = read('api/send-purchase-email.js');

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}
function webhookRequest(event, secret) {
  const raw = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  const req = Readable.from([raw]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': `t=${timestamp},v1=${signature}` };
  return req;
}

// ── The plan must be recognised without metadata ────────────────────────
// Stripe's Dashboard has no metadata field when you build a payment link, so
// a link made the only way the Dashboard allows arrives carrying nothing. An
// untagged subscription used to mean "the monthly Hub plan", which would have
// handed Hub access to someone paying $69 towards the Kids Party Profit
// System — and never the thing she actually bought.
assert.match(api, /const KPPS_PLAN_CENTS = parseInt\(env\('KPPS_PLAN_AMOUNT_CENTS'\) \|\| '6900', 10\);/);
assert.match(api, /const looksLikeKppsPlan = sessionMode === 'subscription'/);
assert.match(api, /!taggedPrintables && !looksLikeKppsPlan\)/);
assert.match(api, /looksLikeKppsPlan \|\|\n\s+KPPS_AMOUNTS\.has/);
// The same figure closes the plan, so the two halves cannot disagree: the
// delivery check and instalmentPlanSize must both read it from one env var
// with the same default. (Counted in code only — the comments name it too.)
const apiCode = api.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert.equal((apiCode.match(/env\('KPPS_PLAN_AMOUNT_CENTS'\) \|\| '6900'/g) || []).length, 2,
  'the plan amount must be read the same way in both places');

// ── Stripe's own payment limit is not an error ──────────────────────────
// "Limit the number of payments" ends the subscription itself, so ours finds
// it already over. That is belt-and-braces working, not a failure.
assert.match(api, /let alreadyOver = sub\.status === 'canceled' \|\| sub\.status === 'incomplete_expired';/);
assert.match(api, /no such subscription\|already cancell\?ed\|resource_missing/);

(async () => {
  const previous = {
    fetch: global.fetch,
    service: process.env.SUPABASE_SERVICE_KEY,
    stripe: process.env.STRIPE_SECRET_KEY,
    hook: process.env.STRIPE_WEBHOOK_SECRET,
    resend: process.env.RESEND_API_KEY,
  };
  try {
    process.env.SUPABASE_SERVICE_KEY = 'service-test';
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform';
    // Delivery refuses to report success without a way to email the buyer
    // their login link, which is correct — so the test supplies one.
    process.env.RESEND_API_KEY = 're_test';
    delete process.env.KPPS_PLAN_AMOUNT_CENTS;

    // Enough of Supabase to let delivery run: the buyer's auth user is
    // created, then the profile row is patched with what they bought. Those
    // patches are the thing under test.
    const patches = [];
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/auth/v1/admin/users')) {
        return { ok: true, json: async () => ({ id: 'user-1', email: 'buyer@example.com' }) };
      }
      if (target.includes('/auth/v1/admin/generate_link')) {
        return { ok: true, json: async () => ({ action_link: 'https://example.com/login' }) };
      }
      if (target.includes('/rest/v1/profiles')) {
        if (options.method === 'PATCH' || options.method === 'POST') {
          patches.push(JSON.parse(options.body || '{}'));
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => [{ id: 'user-1', email: 'buyer@example.com' }] };
      }
      if (target.includes('api.resend.com')) return { ok: true, json: async () => ({ id: 'em' }) };
      if (target.includes('supabase.co')) {
        if (options.method === 'PATCH' || options.method === 'POST') {
          patches.push(JSON.parse(options.body || '{}'));
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => ({}) };
    };

    // A $69 instalment, with no metadata at all — exactly what the Dashboard
    // produces. It must be treated as KPPS, never as the Hub subscription.
    const planSession = {
      id: 'evt_plan', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_plan', mode: 'subscription', amount_total: 6900, amount_subtotal: 6900,
        metadata: {}, customer_details: { email: 'buyer@example.com', name: 'A Buyer' },
      } },
    };
    const res1 = response();
    await purchaseHandler(webhookRequest(planSession, 'whsec_platform'), res1);
    assert.equal(res1.statusCode, 200);
    const granted = patches.filter(p => p && ('has_kpps_access' in p || 'has_crm_access' in p));
    assert.ok(granted.length, 'nothing was granted for the plan payment');
    assert.ok(granted.some(p => p.has_kpps_access === true), 'the plan must grant KPPS access');
    assert.ok(!granted.some(p => p.has_crm_access === true && p.has_kpps_access !== true),
      'the plan must not be delivered as the monthly Hub subscription');

    // A genuine Hub subscription at a different price is still the Hub.
    patches.length = 0;
    const hubSession = {
      id: 'evt_hub', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_hub', mode: 'subscription', amount_total: 2700, amount_subtotal: 2700,
        metadata: {}, customer_details: { email: 'hub@example.com', name: 'Hub Buyer' },
      } },
    };
    const res2 = response();
    await purchaseHandler(webhookRequest(hubSession, 'whsec_platform'), res2);
    assert.equal(res2.statusCode, 200);
    assert.ok(patches.some(p => p && p.has_crm_access === true),
      'a $27 subscription must still be the Hub plan');
    assert.ok(!patches.some(p => p && p.has_kpps_access === true),
      'the Hub plan must not hand out KPPS');

    console.log('kpps payment plan tests passed');
  } finally {
    global.fetch = previous.fetch;
    process.env.SUPABASE_SERVICE_KEY = previous.service;
    process.env.STRIPE_SECRET_KEY = previous.stripe;
    process.env.STRIPE_WEBHOOK_SECRET = previous.hook;
    if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.resend;
  }
})().catch(e => { console.error(e); process.exit(1); });
