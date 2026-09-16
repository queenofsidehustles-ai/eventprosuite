'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const api = read('api/send-quote-email.js');
const app = read('app.html');

// ── The customer sees the business, not the platform ────────────────────
// Everything sends over the one domain verified with Resend, but the display
// name is ours to set — and that is what an inbox actually shows.
assert.match(api, /function senderFrom\(bizName, fallbackFrom\)/);
assert.match(api, /from: senderFrom\(bizName, FROM_EMAIL\)/);
// Every customer-facing email: the quote, the booking confirmation, and a
// printable delivered after purchase. All three come from the business the
// customer bought from, not from the platform.
assert.equal((api.match(/from: senderFrom\(/g) || []).length, 3);
assert.match(api, /from: senderFrom\(shop, FROM_EMAIL\)/);
// The "you just got booked" alert goes TO the owner and stays branded as the
// Hub, because that is what it is.
assert.match(api, /just booked[\s\S]{0,200}/);

const ctx = {}; vm.createContext(ctx);
const fn = /function senderFrom\(bizName, fallbackFrom\) \{[\s\S]*?\n\}/.exec(api);
assert.ok(fn, 'senderFrom is missing');
vm.runInContext(fn[0] + '\nthis.f = senderFrom;', ctx);
const f = ctx.f;

const FROM = 'Party Biz Hub <support@partybizhub.com>';
assert.equal(f('Bear Hug Events', FROM), 'Bear Hug Events <support@partybizhub.com>');
// A bare address still works as the fallback source.
assert.equal(f('Bear Hug Events', 'support@partybizhub.com'), 'Bear Hug Events <support@partybizhub.com>');
// No business name means no change.
assert.equal(f('', FROM), FROM);
assert.equal(f(null, FROM), FROM);

// A display name goes into a mail header, so a newline must never survive —
// that is how a second header gets injected into someone else's email.
// The newline goes, and so does the colon that would have made it a header.
assert.equal(f('Bear Hug\r\nBcc: victim@example.com', FROM),
  'Bear Hug Bcc victim@example.com <support@partybizhub.com>');
assert.doesNotMatch(f('Bear Hug\r\nBcc: x@y.com', FROM), /[\r\n]/);
// Characters that would break the "Name <address>" form are dropped.
assert.equal(f('Bear "Hug" <Events>', FROM), 'Bear Hug Events <support@partybizhub.com>');
// And an absurdly long name cannot run away with the header.
assert.ok(f('B'.repeat(500), FROM).length < 100);

// ── The quote email wears her colours ───────────────────────────────────
// Party Biz Hub purple was hardcoded into a message from one business to
// their own customer.
assert.match(api, /const brand = \/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(String\(brandColor \|\| ''\)\)/);
assert.match(api, /background:\$\{brand\};padding:28px 32px/);
assert.match(api, /\.btn\{display:block;background:\$\{brand\}/);
assert.doesNotMatch(api, /linear-gradient\(135deg,#4C1D95,#6D28D9\)/);
// The Quote Builder has to actually send it.
assert.match(app, /brandColor: \$\('brandColor'\)\.value/);

// ── Customer-supplied values are escaped into the HTML ──────────────────
// A client name or event type carrying markup should render as text.
assert.match(api, /<h1>\$\{esc\(bizName\)/);
assert.match(api, /<p>Hi \$\{esc\(clientFirst\)\},<\/p>/);
assert.match(api, /\$\{esc\(eventType\)\}/);

console.log('email branding tests passed');
