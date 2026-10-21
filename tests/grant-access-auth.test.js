const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'send-purchase-email.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'grant-access.html'), 'utf8');

test('grant-access requires a signed-in admin before doing anything', () => {
  const i = src.indexOf("body.action === 'grant-access'");
  const block = src.slice(i, i + 600);
  assert.match(block, /getUser\(req\)/);
  assert.match(block, /status\(401\)/);
  assert.ok(block.indexOf('status(401)') < block.indexOf('handleGrantAccess'));
});

test('grant-access page sends the admin session token', () => {
  assert.match(page, /Authorization: 'Bearer ' \+ \(await hubToken\(\)\)/);
});

test('unauthenticated grant-access request is refused', async () => {
  const handler = require('../api/send-purchase-email.js');
  const { Readable } = require('stream');
  const req = Readable.from([Buffer.from(JSON.stringify({ action: 'grant-access', email: 'x@example.com', accessType: 'kpps' }))]);
  req.method = 'POST'; req.headers = {};
  let status = 200, payload;
  const res = { setHeader() {}, status(c) { status = c; return this; }, json(b) { payload = b; return this; }, end() { return this; } };
  await handler(req, res);
  assert.equal(status, 401);
  assert.ok(!payload.loginUrl);
});
