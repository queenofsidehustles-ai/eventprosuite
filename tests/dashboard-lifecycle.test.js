'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const dashboard = read('dashboard.html');
const prep = read('prep.html');
const autoContract = read('api/auto-contract.js');

// The dashboard now turns saved records into a clear next-step queue and a
// single customer journey, without changing existing student records.
assert.match(dashboard, /id="nextList"/);
assert.match(dashboard, /function renderNextActions\(\)/);
assert.match(dashboard, /function renderLifecycle\(q\)/);
assert.match(dashboard, /id="modalTimeline"/);
assert.match(dashboard, /linkedQuoteIds/);
assert.match(dashboard, /filter\(q => !linkedQuoteIds\.has/);

// Event Prep receives booking details as a reviewable draft. It does not save
// until the student chooses a template and taps Save.
assert.match(prep, /function openBookingDraft\(\)/);
assert.match(prep, /\.eq\('owner_id',currentUser\.id\)/);
assert.match(prep, /booking_id:b\.id/);
assert.match(prep, /Nothing is written until/);

// Automated contracts must use the same owner field and status vocabulary as
// Contract Center, otherwise the email can send while the record stays hidden.
assert.match(autoContract, /user_id:\s*ownerUID/);
assert.doesNotMatch(autoContract, /owner_id:\s*ownerUID/);
assert.match(autoContract, /status:\s*'Sent to Client'/);

for (const html of [dashboard, prep]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean);
  scripts.forEach(source => new Function(source));
}
new Function(autoContract);

console.log('dashboard lifecycle tests passed');
