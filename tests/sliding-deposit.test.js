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
assert.match(app, /const pct = depositPercentFor\(policy, \$\('eventDate'\)/);
assert.match(view, /const slidingDepositPct = \(policy, eventDate\) =>/);
assert.match(view, /slidingDepositPct\(qd\.depositPolicy, q\.event_date \|\| qd\.eventDate\)/);

// The policy is frozen onto the quote, so changing settings later cannot move
// a number the customer has already been shown.
assert.match(app, /depositPolicy: depositPolicyFrom\(ownerBuildRow && ownerBuildRow\.booking_data\)/);

// ── The owner can set the windows and the percentages ───────────────────
assert.match(site, /id="bookingDepositSliding"/);
assert.match(site, /function collectDepositLadder\(\)/);
assert.match(site, /depositSliding:\$\('bookingDepositSliding'\)/);
assert.match(site, /depositLadder:collectDepositLadder\(\)/);
// A half-filled row must not save as a 0% deposit.
const collect = /function collectDepositLadder\(\)\{[\s\S]*?\n\}/.exec(site);
assert.ok(collect);
assert.match(collect[0], /if\(!Number\.isFinite\(pct\)\|\|pct<1\|\|pct>100\) continue;/);

console.log('sliding deposit tests passed');
