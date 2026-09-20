'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const quoteHandler = require('../api/send-quote-email.js');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const api = read('api/send-quote-email.js');
const purchase = read('api/send-purchase-email.js');
const contract = read('api/auto-contract.js');
const view = read('view-quote.html');

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

const OWNER = {
  depositProfile: 'connected', stripeConnectReady: true,
  stripeConnectAccountId: 'acct_student', currency: 'USD',
};

// ── Never pin the payment methods in code ───────────────────────────────
// Naming payment_method_types switches the session out of dynamic payment
// methods, which would freeze all 23 businesses onto one hard-coded list and
// make every new method a deploy. Each owner's Stripe dashboard decides.
// Matched as a parameter key, not as the word — the code explains itself in a
// comment that names it.
assert.doesNotMatch(api, /['"]payment_method_types/);

// Afterpay is the one that costs something: Checkout hides it unless a
// shipping address is collected, because that is how it reads the country.
assert.match(api, /shipping_address_collection\[allowed_countries\]\[0\]': country/);
// …and only when Afterpay is actually on, so businesses without it keep the
// shorter checkout. The address step is shown to card payers too.
assert.match(api, /const wantsAfterpay = \(await enabledBnplMethods\(pd\.stripeConnectAccountId\)\)\.includes\('afterpay_clearpay'\);/);

(async () => {
  const previous = { fetch: global.fetch, service: process.env.SUPABASE_SERVICE_KEY,
    stripe: process.env.STRIPE_SECRET_KEY, pk: process.env.STRIPE_PUBLISHABLE_KEY };
  try {
    process.env.SUPABASE_SERVICE_KEY = 'service-test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_platform';

    let checkoutCall = null;
    let configCall = null;
    const baseFetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/bookings?')) return { ok: true, json: async () => [{
        id: 'booking-1', owner_id: 'owner-1', client_email: 'ava@example.com',
        event_date: '2026-10-31', service_name: 'Sleepover party',
        service_price: '795', status: 'awaiting-deposit', quote_id: 'quote-1',
      }] };
      if (target.includes('/saved_quotes?')) return { ok: true, json: async () => [{
        id: 'quote-1', user_id: 'owner-1', total_amount: 795,
        quote_data: { selectedDepositTier: 397.5 },
      }] };
      if (target.includes('/profiles?')) return { ok: true, json: async () => [{
        id: 'owner-1', profile_data: OWNER,
      }] };
      if (target === 'https://api.stripe.com/v1/checkout/sessions') {
        checkoutCall = new URLSearchParams(options.body);
        return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/x' }) };
      }
      if (target.includes('/v1/payment_method_configurations')) {
        configCall = options;
        return { ok: true, json: async () => ({ data: [{
          id: 'pmc_1', active: true, is_default: true,
          klarna:            { available: true,  display_preference: { value: 'on' } },
          affirm:            { available: true,  display_preference: { value: 'on' } },
          // Enabled in the dashboard but not available to this account — the
          // customer would never see it, so the quote must not promise it.
          afterpay_clearpay: { available: false, display_preference: { value: 'on' } },
        }] }) };
      }
      throw new Error('Unexpected fetch: ' + target);
    };
    global.fetch = baseFetch;

    // ── Deposit stays the default ─────────────────────────────────────────
    const dep = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'create-deposit-checkout', bookingId: 'booking-1',
      quoteId: 'quote-1', clientEmail: 'ava@example.com',
    } }, dep);
    assert.equal(dep.statusCode, 200);
    assert.equal(dep.body.payMode, 'deposit');
    assert.equal(dep.body.amount, 397.5);
    assert.equal(checkoutCall.get('line_items[0][price_data][unit_amount]'), '39750');
    assert.equal(checkoutCall.get('metadata[pay_mode]'), 'deposit');
    // This owner has Afterpay unavailable, so the extra address step is not
    // imposed on their customers.
    assert.equal(checkoutCall.get('shipping_address_collection[allowed_countries][0]'), null);

    // ── Pay in full charges the whole quote ───────────────────────────────
    const full = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'create-deposit-checkout', bookingId: 'booking-1',
      quoteId: 'quote-1', clientEmail: 'ava@example.com', payMode: 'full',
    } }, full);
    assert.equal(full.body.payMode, 'full');
    assert.equal(full.body.amount, 795);
    assert.equal(checkoutCall.get('line_items[0][price_data][unit_amount]'), '79500');
    assert.equal(checkoutCall.get('metadata[pay_mode]'), 'full');
    // The webhook validates the payment against this, so it must be the amount
    // actually being charged, not the deposit it would otherwise have been.
    assert.equal(checkoutCall.get('metadata[deposit_amount_cents]'), '79500');
    assert.match(checkoutCall.get('line_items[0][price_data][product_data][name]'), /paid in full/);

    // ── With Afterpay live, the address is collected ──────────────────────
    const withAfterpay = async (url, options = {}) => {
      if (String(url).includes('/v1/payment_method_configurations')) {
        return { ok: true, json: async () => ({ data: [{
          id: 'pmc_1', active: true, is_default: true,
          afterpay_clearpay: { available: true, display_preference: { value: 'on' } },
        }] }) };
      }
      return baseFetch(url, options);
    };
    global.fetch = withAfterpay;
    const ap = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'create-deposit-checkout', bookingId: 'booking-1',
      quoteId: 'quote-1', clientEmail: 'ava@example.com',
    } }, ap);
    assert.equal(ap.statusCode, 200);
    assert.equal(checkoutCall.get('shipping_address_collection[allowed_countries][0]'), 'US');
    global.fetch = baseFetch;
    // Still the existing kind, so the verified deposit webhook keeps handling it.
    assert.equal(checkoutCall.get('metadata[kind]'), 'booking_deposit');

    // ── An invented amount is not on the menu ─────────────────────────────
    // Anything that is not 'full' is the deposit. A request cannot name a price.
    const sneaky = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'create-deposit-checkout', bookingId: 'booking-1', quoteId: 'quote-1',
      clientEmail: 'ava@example.com', payMode: 'full ', amount: 1, cents: 1, total: 1,
    } }, sneaky);
    assert.equal(sneaky.body.payMode, 'deposit');
    assert.equal(checkoutCall.get('line_items[0][price_data][unit_amount]'), '39750');

    // ── What the quote page is allowed to advertise ───────────────────────
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_platform';
    const opts = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'quote-payment-options', quoteId: 'quote-1',
    } }, opts);
    assert.equal(opts.statusCode, 200);
    // Only what this account can actually take.
    assert.deepEqual(opts.body.methods, ['klarna', 'affirm']);
    assert.equal(opts.body.publishableKey, 'pk_test_platform');
    assert.equal(opts.body.currency, 'USD');
    // Read from the connected account, not the platform.
    assert.equal(configCall.headers['Stripe-Account'], 'acct_student');
    // The account id must never travel to the browser — it is kept off the
    // public profile on purpose, and this route must not be the leak.
    assert.doesNotMatch(JSON.stringify(opts.body), /acct_/);
    assert.ok(!('stripeConnectAccountId' in opts.body));

    // ── Missing key degrades quietly, never breaks the quote ──────────────
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const nokey = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'quote-payment-options', quoteId: 'quote-1',
    } }, nokey);
    assert.equal(nokey.statusCode, 200);
    assert.deepEqual(nokey.body.methods, []);

    // A Stripe outage must not take the quote page down with it.
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_platform';
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/v1/payment_method_configurations')) throw new Error('Stripe down');
      return baseFetch(url, options);
    };
    const broke = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'quote-payment-options', quoteId: 'quote-1',
    } }, broke);
    assert.equal(broke.statusCode, 200);
    assert.deepEqual(broke.body.methods, []);

    // ── Paid in full must not sit in the chase-the-balance list ───────────
    assert.match(purchase, /const paidInFull = session\.metadata\?\.pay_mode === 'full';/);
    assert.match(purchase, /const paidStatus = paidInFull \? 'confirmed' : 'deposit-paid';/);
    assert.doesNotMatch(purchase, /status: 'deposit-paid', deposit_due_at/);
    // And the contract must not bill her for a $0.00 balance.
    assert.match(contract, /has been received in full\. Nothing further is due\./);

    // ── The quote page ────────────────────────────────────────────────────
    // The choice only appears where a full-amount checkout can actually be
    // built; the fixed payment-link fallback has one link, for the deposit.
    assert.match(view, /pd\.depositProfile==='connected'&&pd\.stripeConnectReady===true\?`/);
    assert.match(view, /payMode:selectedPayMode/);
    // Instalment figures follow the add-ons, or they quote a price nobody pays.
    assert.match(view, /if\(updatePayPlanAmount\)updatePayPlanAmount\(payingFull\?current\.grand:current\.depAmt\)/);
    // Stripe renders the lender's terms; we never compute them ourselves.
    assert.match(view, /elements\.create\('paymentMethodMessaging'/);
    // Checked against the code with its comments removed: the page explains
    // this rule in a comment that quotes the very wording it must not print.
    const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(viewCode, /interest-free|instalments of|installments of/i);
    // Dividing a total into instalments ourselves is the mistake this prevents.
    assert.doesNotMatch(viewCode, /(grand|depAmt|amount)\s*\/\s*4\b/);

    console.log('pay over time tests passed');
  } finally {
    global.fetch = previous.fetch;
    process.env.SUPABASE_SERVICE_KEY = previous.service;
    process.env.STRIPE_SECRET_KEY = previous.stripe;
    if (previous.pk === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = previous.pk;
  }
})().catch(e => { console.error(e); process.exit(1); });
