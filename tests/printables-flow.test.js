'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const nav = read('nav.js');
const store = read('store.html');
const downloads = read('downloads.html');

// ── One product, one menu item ──────────────────────────────────────────
// It was "My Downloads" under Start Here and "Party Profit Printables" under
// Market & Sell — two entries in two sections, the same fifteen templates
// behind both.
assert.doesNotMatch(nav, /downloads\.html/);
assert.doesNotMatch(nav, /label: 'Party Profit Printables'/);
assert.match(nav, /label: 'Party Printables'/);
// It sits in Start Here, because for a $67 buyer it is the whole product.
const startHere = /\{ section: 'Start Here' \}[\s\S]*?\{ section: 'Build & Book'/.exec(nav);
assert.ok(startHere, 'the Start Here section is missing');
assert.match(startHere[0], /Party Printables/);

// Old links must not break — they are in sent emails and bookmarks.
assert.match(downloads, /store\.html#templates/);
assert.match(downloads, /location\.replace\('store\.html#templates'\)/);
['dashboard.html', 'welcome.html'].forEach(page => {
  assert.doesNotMatch(read(page), /href='downloads\.html'/, `${page} should point at the new home`);
});

// ── The tabs follow the order of the work ───────────────────────────────
const tabBar = /<div class="store-tabs">[\s\S]*?<\/div>/.exec(store);
assert.ok(tabBar, 'the tab bar is missing');
['Start here', 'Templates', 'My Shop', 'Sales'].forEach(label =>
  assert.match(tabBar[0], new RegExp(label), `the ${label} tab is missing`));
// A tab that navigates to another page is not a tab.
assert.doesNotMatch(tabBar[0], /window\.location\.href/);

// ── Clicking My Shop used to throw ──────────────────────────────────────
// switchTab('mystore') builds the id "tabMystore", but the button was
// "tabMyStore", so the lookup returned null and the tab never changed.
assert.match(store, /id="tabMystore"/);
assert.doesNotMatch(store, /id="tabMyStore"/);
// And a missing element no longer stops the page dead.
const sw = /function switchTab\(name\)\{[\s\S]*?\n\}/.exec(store);
assert.ok(sw);
assert.match(sw[0], /if\(btn\)btn\.classList\.add\('active'\)/);
assert.match(sw[0], /if\(panel\)panel\.classList\.add\('active'\)/);

// ── Progress reflects reality, not ticked boxes ─────────────────────────
// A shop with products in it reads as done whether or not anyone ticked
// anything, so the checklist cannot drift from the truth.
assert.match(store, /function setupStepState\(\)/);
assert.match(store, /const hasProduct=Array\.isArray\(products\)&&products\.length>0;/);
assert.match(store, /const hasPayment=!!\(currentProfileData\.paymentLink\|\|currentProfileData\.stripeConnectReady===true\);/);
// Only the two steps with no trace in the database are remembered as flags.
assert.match(store, /printablesSetup/);
assert.match(store, /\(st\.key==='downloaded'\|\|st\.key==='shared'\)&&!st\.done/);
// Adding a product ticks its step without anyone saying so.
assert.match(store, /renderProducts\(\);\n  \/\/ Adding a product ticks step 3[\s\S]{0,80}renderSetupSteps\(\);/);

// Getting the files comes first — that is what makes an Etsy listing possible,
// which is the fastest route to a first sale.
const steps = /function setupStepState\(\)\{[\s\S]*?\n\}/.exec(store)[0];
assert.ok(steps.indexOf("key:'downloaded'") < steps.indexOf("key:'shop'"));
assert.ok(steps.indexOf("key:'product'") < steps.indexOf("key:'payment'"));
assert.ok(steps.indexOf("key:'shared'") > steps.indexOf("key:'payment'"));

// ── The wall must not deny people what they bought ──────────────────────
// It only shows to someone owning neither product, but it was worded as though
// the storefront were a paid extra — which reads as a bait-and-switch to a $67
// buyer who already has it.
assert.doesNotMatch(store, /Digital Store is a/);
assert.doesNotMatch(store, /Pro feature/);
assert.doesNotMatch(store, /partybizcoach\.com/);
assert.match(store, /Get Party Printables — \$67/);

console.log('printables flow tests passed');
