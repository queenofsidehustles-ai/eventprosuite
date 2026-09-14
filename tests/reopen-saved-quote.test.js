'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.html');
const dash = read('dashboard.html');

// ── Opening a saved quote must actually open it ─────────────────────────
// The dashboard sent client/event/date as loose query parameters. The Quote
// Builder reads only `booking`, so those were dropped on the floor and the
// form came up blank — no client name, no line items, nothing. Bookings
// worked; saved quotes did not, which is a difference no user can see.
assert.match(dash, /app\.html\?quote=' \+ encodeURIComponent\(q\.id\)/);
assert.doesNotMatch(dash, /params\.set\('client', q\.client_name\)/);

assert.match(app, /async function prefillFromSavedQuote\(\)/);
assert.match(app, /new URLSearchParams\(location\.search\)\.get\('quote'\)/);
// Loaded whole from storage, not rebuilt from a few fields.
assert.match(app, /loadQuote\(data\.quote_data \|\| \{\}\)/);
// Scoped to the signed-in owner, so a quote id cannot be used to read someone
// else's quote.
assert.match(app, /\.eq\('id', quoteId\)\.eq\('user_id', currentUser\.id\)/);

// ── A reopened quote can be sent without saving again ───────────────────
// It already exists, so requiring another save before the send button works
// would be a trap.
assert.match(app, /_lastSavedQuoteId = data\.id;/);
assert.match(app, /function enableShareButton\(\)/);
assert.match(app, /enableShareButton\(\);/);
// The button offers the same choices as a freshly saved quote.
const enable = /function enableShareButton\(\) \{[\s\S]*?\n\}/.exec(app);
assert.ok(enable);
['Email \\+ Text to Client', 'Text to Client', 'Email to Client', 'Copy Link']
  .forEach(label => assert.match(enable[0], new RegExp(label)));
// And it stays linked to the inquiry it answered.
assert.match(app, /if \(\(data\.quote_data \|\| \{\}\)\.sourceBookingId\) _sourceBookingId/);

// ── An old link still does something useful ─────────────────────────────
// Links already sent or bookmarked carry the old parameters; they should
// prefill what they can rather than opening an empty form.
assert.match(app, /if \(!params\.get\('booking'\) && !params\.get\('quote'\)\)/);
assert.match(app, /params\.get\('client'\)/);

console.log('reopen saved quote tests passed');
