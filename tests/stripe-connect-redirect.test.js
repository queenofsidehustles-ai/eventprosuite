'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'send-quote-email.js'), 'utf8');

// ── The return URL has to match where the student started ───────────────
// Stripe matches the redirect URI exactly, and the site answers on both
// partybizhub.com and www.partybizhub.com. A hard-coded host sent anyone who
// started on the other one back to a different ORIGIN — where their sign-in
// does not exist, since browser storage is per-origin — so they would return
// from Stripe apparently logged out.
assert.match(api, /const ALLOWED_RETURN_ORIGINS = \[/);
assert.match(api, /const redirectUri = origin \+ '\/profile\.html\?focus=payments&stripe=return'/);
// The business URL handed to Stripe follows the same origin.
assert.match(api, /'stripe_user\[url\]': `\$\{origin\}\/site\.html/);
// No host is hard-coded into the redirect any more.
assert.doesNotMatch(api, /const redirectUri = 'https:\/\/partybizhub\.com/);

// ── An arbitrary origin must never be reflected into Stripe ─────────────
const block = /const ALLOWED_RETURN_ORIGINS = \[[\s\S]*?const redirectUri = origin \+ [^;]+;/.exec(api);
assert.ok(block, 'the origin selection block is missing');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(`this.pick = (headers) => { const req = { headers }; ${block[0]} return redirectUri; };`, ctx);
const pick = ctx.pick;

assert.equal(pick({ origin: 'https://www.partybizhub.com' }),
  'https://www.partybizhub.com/profile.html?focus=payments&stripe=return');
assert.equal(pick({ origin: 'https://partybizhub.com' }),
  'https://partybizhub.com/profile.html?focus=payments&stripe=return');
// Anything not on the list falls back to the canonical host rather than being
// echoed back — an attacker-supplied Origin header must not steer the return.
assert.equal(pick({ origin: 'https://evil.example.com' }),
  'https://www.partybizhub.com/profile.html?focus=payments&stripe=return');
assert.equal(pick({}),
  'https://www.partybizhub.com/profile.html?focus=payments&stripe=return');
// A lookalike host must not sneak through on a prefix match.
assert.equal(pick({ origin: 'https://partybizhub.com.evil.example' }),
  'https://www.partybizhub.com/profile.html?focus=payments&stripe=return');

console.log('stripe connect redirect tests passed');
