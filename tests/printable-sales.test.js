'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const api = read('api/send-quote-email.js');
const shop = read('shopfront.html');
const store = read('store.html');

// ── A printables shop can take money on its own Stripe ──────────────────
// The storefront predated Connect and only understood a pasted payment link —
// one link, one price, and a step nothing told students they had to do. Two of
// four live shops were showing every customer a "Coming Soon" button.
assert.match(api, /async function createProductCheckout\(req, res\)/);
assert.match(api, /'metadata\[kind\]': 'printable_purchase'/);
assert.match(shop, /kind:'create-product-checkout'/);
assert.match(shop, /window\.shopConnectReady = d\.stripeConnectReady === true;/);
// The card must not say "Coming Soon" over a shop that can in fact sell.
assert.match(shop, /if\(p\.price>0 && \(effectiveLink\|\|window\.shopConnectReady===true\)\)/);
// Pasted links keep working, so shops already selling that way are untouched.
assert.match(shop, /\}else if\(effectiveLink\)\{/);

// ── The shopper cannot name their own price ─────────────────────────────
const checkout = /async function createProductCheckout\(req, res\) \{[\s\S]*?\n\}/.exec(api);
assert.ok(checkout, 'createProductCheckout is missing');
assert.match(checkout[0], /const price = Math\.round\(\(Number\(product\.price\) \|\| 0\) \* 100\);/);
// Price and seller come from the database, never from the request body.
assert.doesNotMatch(checkout[0], /req\.body[\s\S]{0,40}price/);
// A product that is not on sale cannot be bought.
assert.match(checkout[0], /product\.active !== true/);
// And a shop that has not connected cannot take money by accident.
assert.match(checkout[0], /pd\.stripeConnectReady !== true/);

// ── Delivery only after Stripe says it was paid ─────────────────────────
// It used to happen because the browser arrived at a success URL, so anyone
// who typed that URL got the file and a sale was recorded against the seller.
assert.match(api, /async function completeProductPurchase\(req, res\)/);
const complete = /async function completeProductPurchase\(req, res\) \{[\s\S]*?\n\}/.exec(api);
assert.ok(complete);
assert.match(complete[0], /session\.payment_status !== 'paid'/);
// One payment must not be replayed to collect a different product's file.
assert.match(complete[0], /String\(session\.metadata\?\.product_id \|\| ''\) !== String\(product\.id\)/);
// A refresh, a back button or a second tab must not record the sale twice.
assert.match(complete[0], /sales\?stripe_session_id=eq\./);
// The buyer's address comes from the verified Stripe session, not the page.
assert.match(complete[0], /session\.customer_details\?\.email \|\| session\.customer_email/);
assert.match(shop, /kind:'complete-product-purchase'/);
assert.match(shop, /Confirming your payment…/);
// If confirmation fails after a real charge, the buyer is told what to do.
assert.match(shop, /If you were charged, contact the seller/);

// ── The owner finds out before their customers do ───────────────────────
assert.match(store, /const canTakeMoney=!!\(currentProfileData\.stripeConnectReady===true\|\|currentProfileData\.paymentLink\);/);
assert.match(store, /Nobody can buy from your shop yet/);
// Only warn when there is actually something on sale.
assert.match(store, /\(!canTakeMoney&&liveCount\)/);

console.log('printable sales tests passed');
