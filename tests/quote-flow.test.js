'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.html');
const view = read('view-quote.html');
const profile = read('profile.html');
const api = read('api/send-quote-email.js');

// An inquiry carries every useful contact field into the quote and keeps its
// source id so customer acceptance advances one CRM record instead of adding
// a duplicate booking.
assert.match(app, /b\.client_phone[\s\S]{0,100}clientPhone/);
assert.match(app, /sourceBookingId:\s*_sourceBookingId/);
assert.match(view, /kind:'accept-quote'/);
assert.match(api, /String\(linkedId \|\| ''\) !== String\(sourceBookingId\)/);
assert.match(api, /status:\s*'awaiting-deposit'/);

// Website deposit settings inform the recommendation, but only an exact
// fixed-price Stripe link can be shown to a customer.
assert.match(app, /booking_data/);
assert.match(app, /depositRecommendation/);
assert.match(view, /Never fall back to a different/);
assert.doesNotMatch(view, /if\(amt <= 150\)/);

// Text-only quotes are valid, and email accidentally pasted into the phone
// setting is blocked before profile data is saved.
assert.match(api, /\(!clientEmail && !clientPhone\)/);
assert.match(api, /if \(!clientEmail\)/);
assert.match(profile, /contactPhone\.includes\('@'\)/);

// Package promises become per-quote checklists. Website inclusions are on by
// default, researched suggestions are off, and only checked rows reach the
// customer-facing quote.
assert.match(app, /COMMON_INCLUSIONS/);
assert.match(app, /BEAR_HUG_PACKAGE_INCLUSIONS/);
assert.match(app, /data-q-inc/);
assert.match(app, /source:'suggested'/);
assert.match(app, /packageNameMatchScore/);
assert.match(app, /savedInclusions\.length \? savedInclusions : fallbackInclusions/);
assert.match(app, /cleanPackageDisplayName/);
assert.match(app, /Personalized party T-shirt/);
assert.match(app, /invoice-side-stack/);
assert.match(app, /id="eventTheme"/);
assert.match(app, /eventTheme:\s*\$\('eventTheme'\)/);
assert.match(app, /class="proposal-item"/);
assert.match(app, /data-q-line-total/);
assert.match(app, /What this proposal includes/);
assert.doesNotMatch(app, /<strong>Qty<\/strong><strong>Unit<\/strong>/);
assert.match(view, /it\.inclusions\.filter/);
assert.match(view, /cleanPackageName/);
assert.match(view, /Theme \/ customization/);

// Optional upgrades are chosen by the owner per quote, stay outside the base
// proposal, and are only added after the customer actively selects them.
assert.match(app, /function defaultAddonLibrary/);
assert.match(app, /addonLibrary:\s*defaultAddonLibrary/);
assert.match(app, /quoteAddons:\s*\[\]/);
assert.match(app, /addOns:\s*state\.quoteAddons/);
assert.match(app, /data-addon-toggle/);
assert.match(app, /Save add-on library/);
assert.match(view, /data-customer-addon/);
assert.match(view, /Selected add-ons/);
assert.match(view, /const refreshPricing/);
assert.match(view, /selectedAddOns:currentPricing\.selectedAddOns/);
assert.match(api, /Never trust prices sent by the public browser/);
assert.match(api, /offered\.find\(addon => String\(addon\.id\)/);
assert.match(api, /source\.pricingType === 'per_guest'/);
assert.match(api, /customerSelectedAddOns:\s*acceptedAddOns/);
assert.match(api, /total_amount:\s*finalGrand/);

// All inline browser scripts must still parse.
for (const html of [app, view, profile]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean);
  scripts.forEach(source => new Function(source));
}
new Function(api);

console.log('quote flow tests passed');
