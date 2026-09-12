'use strict';

const assert = require('node:assert/strict');
const handler = require('../api/send-quote-email.js');

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

(async () => {
  const previousRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousService = process.env.SUPABASE_SERVICE_KEY;
  const previousResend = process.env.RESEND_API_KEY;
  const previousFetch = global.fetch;

  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.RESEND_API_KEY;

    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/saved_quotes?')) {
        return { ok: true, json: async () => [{
          id: 'quote-1', user_id: 'owner-1', quote_data: { sourceBookingId: 'booking-1' }
        }] };
      }
      if (String(url).includes('/bookings?')) {
        return { ok: true, json: async () => [{ id: 'booking-1' }] };
      }
      throw new Error('Unexpected fetch: ' + url);
    };

    const acceptRes = response();
    await handler({
      method: 'POST',
      body: {
        kind: 'accept-quote', quoteId: 'quote-1', sourceBookingId: 'booking-1',
        booking: {
          client_name: 'Test Client', client_email: 'test@example.com',
          event_date: '2026-10-31', service_price: '325',
          deposit_due_at: '2026-10-01T00:00:00.000Z'
        }
      }
    }, acceptRes);
    assert.equal(acceptRes.statusCode, 200);
    assert.equal(acceptRes.body.saved, true);
    const patchCall = calls.find(call => call.options.method === 'PATCH');
    assert.ok(patchCall, 'expected the original booking to be patched');
    const patch = JSON.parse(patchCall.options.body);
    assert.equal(patch.status, 'awaiting-deposit');
    assert.equal(patch.quote_id, 'quote-1');

    global.fetch = async () => { throw new Error('Text-only quote should not need email fetch'); };
    const textRes = response();
    await handler({
      method: 'POST',
      body: {
        clientPhone: '4075550100', alsoText: true,
        clientName: 'Test Client', quoteLink: 'https://example.com/quote'
      }
    }, textRes);
    assert.equal(textRes.statusCode, 200);
    assert.equal(textRes.body.sent, false);
    assert.equal(textRes.body.textAttempted, true);

    console.log('send quote email tests passed');
  } finally {
    if (previousRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousRole;
    if (previousService === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousService;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    global.fetch = previousFetch;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
