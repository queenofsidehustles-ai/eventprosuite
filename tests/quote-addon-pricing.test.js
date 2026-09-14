'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.html');
const view = read('view-quote.html');
const api = read('api/send-quote-email.js');
const contractApi = read('api/send-contract-email.js');

// ── Keepsakes are quoted as one line, not per head ──────────────────────
// Pajamas and shirts priced per guest put "$30 per guest" on an invoice for
// something most hosts sell as a single item. They ship as a flat total now.
[
  ['addon-pajamas', 240],
  ['addon-shirts', 120],
  ['addon-robes', 200],
  ['addon-sleep-masks', 96],
  ['addon-pillowcases', 144],
  ['addon-loot-bags', 120],
].forEach(([id, price]) => {
  const row = new RegExp(`\\{ id:'${id}',[^}]*\\}`).exec(app);
  assert.ok(row, `${id} missing from the default add-on library`);
  assert.match(row[0], /pricingType:'flat'/, `${id} should default to a flat total`);
  assert.match(row[0], new RegExp(`price:\\s*${price}\\b`), `${id} should be priced for the group`);
  assert.match(row[0], /coverage:8/, `${id} should carry an editable guest count`);
  // The count is a field, not prose — editing it must not leave stale text.
  assert.doesNotMatch(row[0], /covers up to 8/i, `${id} should not hard-code the count in its description`);
});

// An extra guest genuinely is per head, so those two keep per-guest pricing.
['addon-extra-sleepover-guest', 'addon-extra-party-child'].forEach(id => {
  const row = new RegExp(`\\{ id:'${id}',[^}]*\\}`).exec(app);
  assert.ok(row, `${id} missing from the default add-on library`);
  assert.match(row[0], /pricingType:'per_guest'/, `${id} should stay per guest`);
});

// Both choices remain available on every row — the point is the default, not
// removing per-guest pricing.
assert.match(app, /<option value="per_guest"/);
assert.match(app, /<option value="flat"/);
assert.match(view, /perUnit\?' \/ '\+unit:''/);

// ── The one-time correction never overwrites real pricing ───────────────
const context = { module: {}, exports: {} };
vm.createContext(context);
const defaults = /const KEEPSAKE_FLAT_DEFAULTS = \{[\s\S]*?\n\};/.exec(app);
const fn = /function applyKeepsakeFlatDefaults\(list\) \{[\s\S]*?\n\}/.exec(app);
assert.ok(defaults && fn, 'the keepsake correction is missing from app.html');
vm.runInContext(`${defaults[0]}\n${fn[0]}\nthis.apply = applyKeepsakeFlatDefaults;`, context);
const apply = context.apply;

// An untouched old default is corrected.
const untouched = apply([{ id: 'addon-pajamas', price: 30, pricingType: 'per_guest', description: 'old' }]);
assert.equal(untouched.changed, true);
assert.equal(untouched.list[0].pricingType, 'flat');
assert.equal(untouched.list[0].price, 240);

// A price the owner typed herself is left exactly as she set it.
const ownPrice = apply([{ id: 'addon-pajamas', price: 45, pricingType: 'per_guest', description: 'mine' }]);
assert.equal(ownPrice.changed, false);
assert.equal(ownPrice.list[0].price, 45);
assert.equal(ownPrice.list[0].pricingType, 'per_guest');
assert.equal(ownPrice.list[0].description, 'mine');

// Anything already on a flat total, and anything outside the keepsake set, is
// untouched.
assert.equal(apply([{ id: 'addon-pajamas', price: 240, pricingType: 'flat' }]).changed, false);
assert.equal(apply([{ id: 'addon-extra-party-child', price: 30, pricingType: 'per_guest' }]).changed, false);
assert.equal(apply([{ id: 'addon-custom-1', price: 30, pricingType: 'per_guest' }]).changed, false);
assert.equal(apply(null).changed, false);

// The marker is what makes it one-time: an owner who switches an item back to
// per guest must not have it flipped again on her next visit.
assert.match(app, /pd\.addonDefaultsFlatV2 === true/);
assert.match(app, /addonDefaultsFlatV2: true/);
assert.match(app, /persistAddonDefaultsOnce\(\)/);

// ── Quote email actually leaves the building ────────────────────────────
// onboarding@resend.dev is Resend's shared sandbox sender and may only email
// the Resend account owner, so every client address was rejected and the
// Quote Builder fell back to a mailto: window that errors.
// (the address still appears in a comment explaining the bug — what matters
// is that it is no longer the fallback the code actually sends from)
assert.doesNotMatch(api, /\|\| 'onboarding@resend\.dev'/);
assert.doesNotMatch(contractApi, /\|\| 'onboarding@resend\.dev'/);
assert.match(api, /RESEND_FROM_EMAIL \|\| 'Party Biz Hub <support@partybizhub\.com>'/);
assert.match(contractApi, /RESEND_FROM_EMAIL \|\| 'Party Biz Hub <support@partybizhub\.com>'/);

// A client hitting reply reaches the planner, not Party Biz Hub — and a typo
// in her profile must not take the whole send down with it.
assert.match(api, /reply_to: validEmail\(bizEmail\) \|\| undefined/);
assert.match(app, /bizEmail: ownerReplyEmail\(\)/);

// The failure an owner sees names the knob she has to turn.
assert.match(api, /explainEmailFailure/);
assert.match(api, /not verified in Resend yet/);
assert.match(api, /RESEND_API_KEY in your Vercel/);


// ── The guest/item count is editable, and the price style is free ───────
// "Covers 8" was a hard-coded assumption. It is now a field on every add-on,
// beside a price that can be a total, per guest, or per item.
assert.match(app, /data-addon-coverage=/);
assert.match(app, /<option value="per_item"/);
assert.match(app, /newAddonCoverage/);
assert.match(app, /addonCoverageLabel/);
assert.match(app, /addonBuilderHint/);

const ctx2 = {}; vm.createContext(ctx2);
const helpers = [
  /function addonCoverage\(addon\) \{[\s\S]*?\n\}/,
  /function addonUsesCoverage\(addon\) \{[\s\S]*?\n\}/,
  /function addonUnitWord\(addon, n\) \{[\s\S]*?\n\}/,
  /function addonPriceLabel\(addon\) \{[\s\S]*?\n\}/,
  /function addonCoverageLabel\(addon\) \{[\s\S]*?\n\}/,
].map(re => { const m = re.exec(app); assert.ok(m, 're failed: ' + re); return m[0]; }).join('\n');
// money() reads the currency picker out of the DOM, so it is stubbed to the
// same shape the page produces.
const moneyStub = "const money = v => '$' + Number(v || 0).toFixed(2);\n";
vm.runInContext(moneyStub + helpers + '\nthis.label = addonPriceLabel; this.scope = addonCoverageLabel; this.cov = addonCoverage;', ctx2);

// A count outside 1–999, or none at all, simply means "not specified".
assert.equal(ctx2.cov({ coverage: 6 }), 6);
assert.equal(ctx2.cov({ coverage: 0 }), 0);
assert.equal(ctx2.cov({}), 0);
assert.equal(ctx2.cov({ coverage: -4 }), 0);
assert.equal(ctx2.cov({ coverage: 5000 }), 0);
assert.equal(ctx2.cov({ coverage: '10' }), 10);

// Each pricing style says the right thing.
assert.equal(ctx2.label({ price: 240, pricingType: 'flat' }), '$240.00 total');
assert.equal(ctx2.label({ price: 30, pricingType: 'per_guest' }), '$30.00 per guest');
assert.equal(ctx2.label({ price: 15, pricingType: 'per_item' }), '$15.00 per item');
assert.equal(ctx2.label({ price: 75, pricingType: 'starting_at' }), 'Starting at $75.00');

// Whatever count she types is what the customer reads — 6, 5 and 10 all work.
assert.equal(ctx2.scope({ price: 180, pricingType: 'flat', coverage: 6 }), 'Covers up to 6 guests');
assert.equal(ctx2.scope({ price: 150, pricingType: 'flat', coverage: 5 }), 'Covers up to 5 guests');
assert.equal(ctx2.scope({ price: 300, pricingType: 'flat', coverage: 10 }), 'Covers up to 10 guests');
assert.equal(ctx2.scope({ price: 30, pricingType: 'flat', coverage: 1 }), 'Covers up to 1 guest');
assert.equal(ctx2.scope({ price: 15, pricingType: 'per_item', coverage: 8 }), 'Priced for 8 items — adjustable');
// A "from" price has no fixed scope, so no count is claimed.
assert.equal(ctx2.scope({ price: 75, pricingType: 'starting_at', coverage: 8 }), '');
assert.equal(ctx2.scope({ price: 240, pricingType: 'flat' }), '');

// The customer's page starts on the count she set, and per-item is priced by
// quantity exactly like per-guest.
assert.match(view, /addonCoverage\(addon\)/);
assert.match(view, /addonScopeLine/);
assert.match(view, /pricingType==='per_item'/);
assert.match(view, /const startQty=prior\?Math\.max\(1,Number\(prior\.quantity\)\|\|1\):\(covers\|\|1\)/);
assert.match(api, /'flat','per_guest','per_item','starting_at'/);
assert.match(api, /source\.pricingType === 'per_guest' \|\| source\.pricingType === 'per_item'/);

// ── The owner hears about her own booking ───────────────────────────────
// The customer always got a confirmation; the owner got nothing and had to
// remember to open the dashboard.
assert.match(api, /async function notifyOwnerOfBooking/);
assert.match(api, /await notifyOwnerOfBooking\(/);
assert.match(api, /just booked/);
// Her account address is the dependable one; a contact address only wins when
// she actually set one.
assert.match(api, /validEmail\(pd\.contactEmail\) \|\| validEmail\(pd\.bizEmail\) \|\| validEmail\(owner\.email\)/);
// Replying to the alert reaches the customer.
assert.match(api, /reply_to: validEmail\(booking\.client_email\)/);
// A booking that saved must never be reported as failed because an email
// bounced, so the notification is wrapped and swallowed.
const notifyCall = /try \{\s*await notifyOwnerOfBooking\(\{[\s\S]*?\} catch \(e\) \{[\s\S]*?\}/.exec(api);
assert.ok(notifyCall, 'the owner notification must be wrapped in try/catch');
assert.match(notifyCall[0], /console\.warn/);
// Email clients drop 8-digit hex alpha and flexbox; neither may creep back in.
const ownerEmail = /async function notifyOwnerOfBooking[\s\S]*?\n\}\n/.exec(api)[0];
assert.doesNotMatch(ownerEmail, /display:flex/);
assert.doesNotMatch(ownerEmail, /\$\{esc\(brand\)\}0F/);

console.log('quote add-on pricing, coverage and owner-notification tests passed');
