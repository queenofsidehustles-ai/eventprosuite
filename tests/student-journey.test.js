'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const dashboard = read('dashboard.html');
const profile = read('profile.html');
const store = read('store.html');
const shopfront = read('shopfront.html');

// Dashboard reads the pieces needed to guide both service and printable
// students without writing to any existing records.
assert.match(dashboard, /productsRes/);
assert.match(dashboard, /hasPrintables/);
assert.match(dashboard, /storeSlug: currentStoreSlug/);
assert.match(dashboard, /aria-valuemax',String\(progress\.total\)/);

// Payment help lands on the actual payment section and describes the current
// deposit-to-contract workflow accurately.
assert.match(profile, /id="paymentSetup"/);
assert.match(profile, /focus'\)==='payments'/);
assert.match(profile, /contract is emailed after you mark the customer's deposit paid/);

// One click from the library creates a private, paid draft and opens it for
// review. Existing products are never migrated or rewritten.
assert.match(store, /price:9\.99/);
assert.match(store, /active:false/);
assert.match(store, /if\(product\?\.id\)openModal\(product\.id\)/);
assert.match(store, /currentProfileData\.brandColor/);
assert.match(store, /requestedTab/);

// The public store inherits the shared logo and brand color as fallbacks.
assert.match(shopfront, /d\.logoUrl\|\|d\.logoDataURL/);
assert.match(shopfront, /primary:d\.brandColor\|\|''/);

for (const html of [dashboard, profile, store, shopfront]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean);
  scripts.forEach(source => new Function(source));
}

console.log('student journey tests passed');
