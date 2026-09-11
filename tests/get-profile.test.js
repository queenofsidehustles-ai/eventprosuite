'use strict';

const assert = require('node:assert/strict');

const responses = [
  {
    ok: true,
    status: 200,
    json: async () => [{ id: 'student-1', profile_data: { automation: { reminders: true } } }]
  },
  {
    ok: true,
    status: 200,
    json: async () => [{
      brand_data: { businessName: 'Six Star Sleepovers', customPrimary: '#7B3F9E' },
      packages_data: [{ name: 'Sleepover for Six', price: '495', duration: '12 hours', included: '6 tents\nBedding' }],
      booking_data: { area: 'Orlando' },
      last_published_at: '2026-09-11T12:00:00.000Z'
    }]
  }
];

const requestedUrls = [];
global.fetch = async url => {
  requestedUrls.push(String(url));
  return responses.shift();
};

const handler = require('../api/get-profile');

function responseHarness() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

(async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { uid: 'student-1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profile_data.businessName, 'Six Star Sleepovers');
  assert.equal(res.body.profile_data.bookingServices[0].name, 'Sleepover for Six');
  assert.deepEqual(res.body.profile_data.automation, { reminders: true });
  assert.equal(Object.hasOwn(res.body, 'brand_data'), false);
  assert.match(requestedUrls[1], /last_published_at=not\.is\.null/);
  console.log('get-profile compatibility test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
