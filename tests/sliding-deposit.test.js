'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const api = read('api/send-quote-email.js');
const app = read('app.html');
const view = read('view-quote.html');
const site = read('mywebsite.html');

// ── The server decides what gets charged ────────────────────────────────
// A sliding scale computed only in the browser is a number the customer could
// edit before paying.
assert.match(api, /function slidingDepositPct\(policy, eventDate\)/);
const checkout = /const total = parseFloat\(String\(booking\.service_price[\s\S]*?const cents = Math\.round\(deposit \* 100\);/.exec(api);
assert.ok(checkout, 'the deposit calculation is missing');
assert.match(checkout[0], /slidingDepositPct\(quote\.quote_data\?\.depositPolicy, booking\.event_date\)/);
// It reads the policy off the quote and the date off the booking — both
// server-side records, neither supplied by the request.
assert.doesNotMatch(checkout[0], /req\.body/);
// The deposit can never exceed the total.
assert.match(checkout[0], /Math\.min\(Math\.round\(total \* slidingPct\) \/ 100, total\)/);

// ── The rule itself ─────────────────────────────────────────────────────
const ctx = {}; vm.createContext(ctx);
const fn = /function slidingDepositPct\(policy, eventDate\) \{[\s\S]*?\n\}/.exec(api);
vm.runInContext(fn[0] + '\nthis.pct = slidingDepositPct;', ctx);
const pct = ctx.pct;

const policy = { basePct: 25, ladder: [
  { withinDays: 14, pct: 100 },
  { withinDays: 30, pct: 75 },
  { withinDays: 60, pct: 50 },
]};
const inDays = n => {
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

// The tightest matching rung wins, not the first one that fits loosely.
assert.equal(pct(policy, inDays(5)), 100);
assert.equal(pct(policy, inDays(14)), 100);   // boundary is inclusive
assert.equal(pct(policy, inDays(15)), 75);
assert.equal(pct(policy, inDays(30)), 75);
assert.equal(pct(policy, inDays(45)), 50);
assert.equal(pct(policy, inDays(60)), 50);
// Beyond every rung falls back to the flat percent.
assert.equal(pct(policy, inDays(200)), 25);
// A date already past is as urgent as it gets.
assert.equal(pct(policy, inDays(-3)), 100);

// ── Nothing changes for anyone who has not switched it on ───────────────
// This is the safety property: an owner with no ladder, a quote saved before
// the feature existed, or a booking with no date all keep the old behaviour.
assert.equal(pct(null, inDays(5)), null);
assert.equal(pct({ basePct: 50, ladder: [] }, inDays(5)), null);
assert.equal(pct(policy, null), null);
assert.equal(pct(policy, 'not-a-date'), null);
// Nonsense rungs are ignored rather than charging 0%.
assert.equal(pct({ basePct: 50, ladder: [{ withinDays: 30, pct: 0 }] }, inDays(5)), 50);
assert.equal(pct({ basePct: 50, ladder: [{ withinDays: 30, pct: 250 }] }, inDays(5)), 50);

// ── All three surfaces run the same rule ────────────────────────────────
assert.match(app, /function depositPercentFor\(policy, eventDate\)/);

// ── The policy belongs to the business, not to the website builder ──────
// It used to be read only from website_builds.booking_data, so an owner who
// brought their own website had nowhere to set it and silently got 50%.
assert.match(app, /function depositPolicyFrom\(profileData, bookingData\)/);
assert.match(app, /depositPolicyFrom\(currentProfile && currentProfile\.profile_data, ownerBuildRow && ownerBuildRow\.booking_data\)/);
const profileHtml = read('profile.html');
assert.match(profileHtml, /id="depositPct"/);
assert.match(profileHtml, /id="balanceDays"/);
assert.match(profileHtml, /id="depositSliding"/);
assert.match(profileHtml, /depositLadder:collectDepositLadder\(\)/);
// The builder's value is still read as a fallback, so nobody who set it there
// loses it — but nothing is written back to that row.
assert.match(profileHtml, /currentBuildBookingData/);
assert.match(profileHtml, /from\('website_builds'\)\.select\('booking_data'\)/);

// Profile wins over builder, and a profile percent with sliding off is
// respected rather than inheriting the builder's ladder.
const ctxP = {}; vm.createContext(ctxP);
const fn2 = /function depositPolicyFrom\(profileData, bookingData\) \{[\s\S]*?\n\}/.exec(app);
assert.ok(fn2, 'depositPolicyFrom is missing');
vm.runInContext(fn2[0] + '\nthis.f = depositPolicyFrom;', ctxP);
const build = { depositPct: 25, depositSliding: true, depositLadder: [{ withinDays: 30, pct: 90 }] };
assert.equal(ctxP.f({ depositPct: 60 }, build).basePct, 60, 'the profile percent must win');
// Arrays from the sandbox have a different prototype, so compare length.
assert.equal(ctxP.f({ depositPct: 60 }, build).ladder.length, 0, 'a profile percent must not inherit the builder ladder');
assert.equal(ctxP.f({}, build).basePct, 25, 'with nothing on the profile, the builder value still applies');
assert.equal(ctxP.f({}, build).ladder.length, 1);
assert.equal(ctxP.f({}, {}).basePct, 50, 'and 50% remains the final fallback');
assert.match(app, /const pct = depositPercentFor\(policy, \$\('eventDate'\)/);
assert.match(view, /const slidingDepositPct = \(policy, eventDate\) =>/);
assert.match(view, /slidingDepositPct\(qd\.depositPolicy, q\.event_date \|\| qd\.eventDate\)/);

// The policy is frozen onto the quote, so changing settings later cannot move
// a number the customer has already been shown.
assert.match(app, /depositPolicy: depositPolicyFrom\(currentProfile && currentProfile\.profile_data, ownerBuildRow && ownerBuildRow\.booking_data\)/);

// ── The owner can set the windows and the percentages ───────────────────
assert.match(site, /id="bookingDepositSliding"/);
assert.match(site, /function collectDepositLadder\(\)/);
assert.match(site, /depositSliding:\$\('bookingDepositSliding'\)/);
assert.match(site, /depositLadder:collectDepositLadder\(\)/);
// A half-filled row must not save as a 0% deposit.
const collect = /function collectDepositLadder\(\)\{[\s\S]*?\n\}/.exec(site);
assert.ok(collect);
assert.match(collect[0], /if\(!Number\.isFinite\(pct\)\|\|pct<1\|\|pct>100\) continue;/);


// ── A connected Stripe charges the exact percentage ─────────────────────
// The four fixed tiers exist only because a payment link is for a set price.
// Once an exact charge is possible there is nothing to round to, and snapping
// anyway turned a 50% deposit on $795 into $500 — $102.50 more than quoted.
assert.match(app, /const canChargeExact = pd\.depositProfile === 'connected' && pd\.stripeConnectReady === true;/);
assert.match(app, /return \{ pct, target, tier: target, exact: true, canChargeExact: true/);
// The exact figure becomes the amount carried on the quote, which is what the
// customer page and the checkout endpoint both read.
assert.match(app, /state\.selectedDepositTier = recommendation\.target;/);
// And the tier buttons stop offering a choice that no longer exists.
assert.match(app, /Your connected Stripe charges exactly that/);

const rec = /function depositRecommendation\(total\) \{[\s\S]*?\n\}/.exec(app);
assert.ok(rec, 'depositRecommendation is missing');
// Owners still on fixed links must keep snapping — they cannot charge $397.50.
assert.match(rec[0], /const configured = depositOptions\.filter\(v => links\[v\]\);/);
assert.match(rec[0], /canChargeExact: false/);
// Connected-but-not-ready must not claim exact charging.
assert.match(rec[0], /pd\.stripeConnectReady === true/);

console.log('sliding deposit tests passed');
