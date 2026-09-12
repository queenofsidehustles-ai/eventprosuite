'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const builder = read('mywebsite.html');
const site = read('site.html');
const booking = read('book.html');

// Draft autosaves preserve the last live snapshot. Publishing replaces it.
assert.match(builder, /_publishedSnapshot:currentBuild&&currentBuild\.booking_data/);
assert.match(builder, /function createPublishedSnapshot\(\)/);
assert.match(builder, /booking_data:bookingData,last_published_at:ts/);
assert.match(builder, /website and booking page are synced and live/);

// The public site reads that snapshot, while the builder preview receives a
// separate draft payload and therefore still previews unsaved-to-live work.
assert.match(site, /Public sites use the last/);
assert.match(site, /_publishedSnapshot/);
assert.match(builder, /build:currentBuild/);
assert.match(builder, /site\.html\?preview=1/);

// Package buttons carry the exact package name into the booking form, which
// selects it and advances directly to event details.
assert.match(site, /function packageBookURL\(base,pkg\)/);
assert.match(site, /service='\+encodeURIComponent/);
assert.match(site, /packageBookURL\(d\.bookURL,pkg\)/);
assert.match(booking, /requestedService = params\.get\('service'\)/);
assert.match(booking, /requestedServiceApplied=true/);
assert.match(booking, /if\(currentStep===1\)goTo\(2\)/);

// Published customer-facing identity is shared without replacing automation,
// payment, or unrelated back-office settings.
assert.match(builder, /const original=\(existing&&existing\.profile_data\)\|\|\{\}/);
assert.match(builder, /\.\.\.original,[\s\S]*businessName:[\s\S]*bookingServices/);

for (const html of [builder, site, booking]) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(Boolean);
  scripts.forEach(source => new Function(source));
}

console.log('website and booking sync tests passed');
