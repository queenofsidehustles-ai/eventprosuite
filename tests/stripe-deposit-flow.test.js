'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Readable } = require('stream');
const quoteHandler = require('../api/send-quote-email.js');
const purchaseHandler = require('../api/send-purchase-email.js');

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
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${raw}`).digest('hex');
  const req = Readable.from([raw]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': `t=${timestamp},v1=${signature}` };
  return req;
}

(async () => {
  const previous = {
    fetch: global.fetch,
    service: process.env.SUPABASE_SERVICE_KEY,
    role: process.env.SUPABASE_SERVICE_ROLE_KEY,
    stripe: process.env.STRIPE_SECRET_KEY,
    connectWebhook: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
    kppsWebhook: process.env.KPPS_STRIPE_WEBHOOK_SECRET,
  };

  try {
    process.env.SUPABASE_SERVICE_KEY = 'service-test';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_platform';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
    delete process.env.KPPS_STRIPE_WEBHOOK_SECRET;

    let stripeCheckoutCall;
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/bookings?')) return { ok: true, json: async () => [{
        id: 'booking-1', owner_id: 'owner-1', client_name: 'Ava Client',
        client_email: 'ava@example.com', event_date: '2026-10-31',
        service_name: 'Sleepover party', service_price: '600',
        status: 'awaiting-deposit', quote_id: 'quote-1',
      }] };
      if (target.includes('/saved_quotes?')) return { ok: true, json: async () => [{
        id: 'quote-1', quote_data: { selectedDepositTier: 250 },
      }] };
      if (target.includes('/profiles?')) return { ok: true, json: async () => [{
        id: 'owner-1', profile_data: {
          depositProfile: 'connected', stripeConnectReady: true,
          stripeConnectAccountId: 'acct_student', currency: 'USD',
        },
      }] };
      if (target === 'https://api.stripe.com/v1/checkout/sessions') {
        stripeCheckoutCall = { options };
        return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/test' }) };
      }
      throw new Error('Unexpected fetch: ' + target);
    };

    const checkoutRes = response();
    await quoteHandler({
      method: 'POST', headers: {}, body: {
        kind: 'create-deposit-checkout', bookingId: 'booking-1',
        quoteId: 'quote-1', clientEmail: 'ava@example.com',
      },
    }, checkoutRes);
    assert.equal(checkoutRes.statusCode, 200);
    assert.equal(checkoutRes.body.automatic, true);
    assert.equal(checkoutRes.body.depositAmount, 250);
    assert.equal(stripeCheckoutCall.options.headers['Stripe-Account'], 'acct_student');
    const checkoutBody = new URLSearchParams(stripeCheckoutCall.options.body);
    assert.equal(checkoutBody.get('line_items[0][price_data][unit_amount]'), '25000');
    assert.equal(checkoutBody.get('metadata[booking_id]'), 'booking-1');
    assert.equal(checkoutBody.get('metadata[kind]'), 'booking_deposit');

    const patches = [];
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/bookings?') && options.method !== 'PATCH') return { ok: true, json: async () => [{
        id: 'booking-1', owner_id: 'owner-1', client_name: 'Ava Client',
        client_email: 'ava@example.com', event_date: '2026-10-31',
        service_name: 'Sleepover party', service_price: '600', status: 'awaiting-deposit',
      }] };
      if (target.includes('/profiles?')) return { ok: true, json: async () => [{
        id: 'owner-1', profile_data: { stripeConnectAccountId: 'acct_student', autoContract: true },
      }] };
      if (target.includes('/contracts?')) return { ok: true, json: async () => [{ id: 'contract-existing' }] };
      if (options.method === 'PATCH') {
        patches.push({ target, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({}) };
      }
      throw new Error('Unexpected fetch: ' + target);
    };

    const event = {
      id: 'evt_deposit_1', type: 'checkout.session.completed', account: 'acct_student',
      data: { object: {
        id: 'cs_1', payment_status: 'paid', amount_total: 25000,
        client_reference_id: 'booking-1',
        metadata: {
          kind: 'booking_deposit', booking_id: 'booking-1', owner_id: 'owner-1',
          quote_id: 'quote-1', deposit_amount_cents: '25000',
        },
      } },
    };
    const wrongEndpointRes = response();
    await purchaseHandler(webhookRequest(event, process.env.STRIPE_WEBHOOK_SECRET), wrongEndpointRes);
    assert.equal(wrongEndpointRes.statusCode, 400);
    assert.match(wrongEndpointRes.body.error, /Connect webhook/);

    const webhookRes = response();
    await purchaseHandler(webhookRequest(event, process.env.STRIPE_CONNECT_WEBHOOK_SECRET), webhookRes);
    assert.equal(webhookRes.statusCode, 200);
    assert.equal(webhookRes.body.status, 'deposit-paid');
    assert.equal(webhookRes.body.contractExisting, true);
    const bookingPatch = patches.find(call => call.target.includes('/bookings?'));
    assert.equal(bookingPatch.body.status, 'deposit-paid');
    assert.equal(bookingPatch.body.deposit_due_at, null);

    console.log('Stripe deposit flow tests passed');
  } finally {
    global.fetch = previous.fetch;
    for (const [name, value] of [
      ['SUPABASE_SERVICE_KEY', previous.service],
      ['SUPABASE_SERVICE_ROLE_KEY', previous.role],
      ['STRIPE_SECRET_KEY', previous.stripe],
      ['STRIPE_CONNECT_WEBHOOK_SECRET', previous.connectWebhook],
      ['STRIPE_WEBHOOK_SECRET', previous.webhook],
      ['KPPS_STRIPE_WEBHOOK_SECRET', previous.kppsWebhook],
    ]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
