'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sql = read('migrations/20260914_lock_down_profiles.sql');

// ── The allowlist is the contract ───────────────────────────────────────
const listBlock = /create or replace function public\.public_profile_fields[\s\S]*?\$\$;/.exec(sql);
assert.ok(listBlock, 'the public field allowlist is missing');
const allowed = new Set([...listBlock[0].matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]));
assert.ok(allowed.size > 20, 'the allowlist looks suspiciously short');

// Nothing sensitive may ever be in it. These are the fields that made the open
// policy a real problem: an API key, the Stripe Connect handshake token, the
// connected account id, and each owner's internal pricing.
['zernioKey', 'stripeConnectAccountId', 'stripeConnectState', 'stripeConnectStateExpires',
 'packages', 'addonLibrary', 'taxRate', 'taxMode', 'smsEnabled', 'autoContract']
  .forEach(field => assert.ok(!allowed.has(field), `${field} must never be publicly exposed`));

// ── Every field a public page actually reads must be allowlisted ────────
// This is the check that stops a locked-down profile from silently breaking a
// live booking page: if someone adds pd.newThing to a public page and forgets
// the migration, this fails here instead of on a customer's phone.
// Each public page holds profile_data in a differently named variable, so the
// scan is told which one rather than guessing — a loose match picks up DOM
// objects and the website-builder data and drowns the real signal.
const PUBLIC_PAGES = [
  { file: 'view-quote.html', varName: 'pd' },
  { file: 'site.html', varName: 'pd' },
  { file: 'book.html', varName: 'profileData' },
  { file: 'api/_profile-compat.js', varName: 'profileData' },
  // shopfront names it `d` inside init(), which also collides with DOM
  // variables elsewhere, so only that function is scanned.
  { file: 'shopfront.html', varName: 'd', within: /async function init\(\)\{[\s\S]*?\nasync function /},
];
// Properties of the row wrapper or of a DOM node, not profile_data keys.
const NOT_PROFILE_DATA = new Set([
  'profile_data', 'full_name', 'id', 'store_slug',
  'classList', 'length', 'forEach', 'map', 'filter', 'value', 'style', 'dataset',
]);

const missing = [];
PUBLIC_PAGES.forEach(({ file, varName, within }) => {
  let src = read(file);
  if (within) {
    const scoped = within.exec(src);
    assert.ok(scoped, `could not scope the scan in ${file}`);
    src = scoped[0];
  }
  const re = new RegExp('\\b' + varName + '\\.([a-zA-Z_][a-zA-Z0-9_]*)', 'g');
  const used = new Set([...src.matchAll(re)].map(m => m[1]));
  used.forEach(field => {
    if (NOT_PROFILE_DATA.has(field)) return;
    if (!allowed.has(field)) missing.push(`${file}: ${varName}.${field}`);
  });
});
assert.deepEqual(missing, [], 'public pages read profile fields the allowlist does not expose:\n  ' + missing.join('\n  '));

// ── The rollout must stay staged ────────────────────────────────────────
// Step 2 is the only destructive statement in the file. It stays commented out
// so running the migration cannot close public access before the application
// changes are deployed and verified.
const step2 = /-- drop policy if exists "profiles: anon can read"/.test(sql);
assert.ok(step2, 'step 2 should be present as a commented-out statement');
assert.doesNotMatch(sql, /^\s*drop policy if exists "profiles: anon can read"/m,
  'step 2 must stay commented out until the application changes are live');
assert.match(sql, /^-- create policy "profiles: anon can read"/m, 'a rollback must be documented');

// ── Public pages go through the function, with a fallback ───────────────
assert.match(read('view-quote.html'), /rpc\('get_public_profile'/);
assert.match(read('site.html'), /rpc\('get_public_profile'/);
assert.match(read('shopfront.html'), /rpc\('get_public_profile_by_slug'/);
assert.match(read('api/get-profile.js'), /rpc\/get_public_profile/);

// Each keeps a direct read as a fallback, so deploying before the migration
// runs cannot take a booking page down.
assert.match(read('view-quote.html'), /from\('profiles'\)\.select/);
assert.match(read('shopfront.html'), /from\('profiles'\)\.select/);
assert.match(read('api/get-profile.js'), /rest\/v1\/profiles\?id=eq\./);

console.log('public profile exposure tests passed');
