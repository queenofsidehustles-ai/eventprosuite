'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'mywebsite.html'), 'utf8');

assert.match(html, /Customize more/);
assert.match(html, /Publish My Website/);
assert.match(html, /function publishWebsite\(\)/);
assert.match(html, /last_published_at:ts/);
assert.match(html, /const required=\['packages','booking'\]/);
assert.doesNotMatch(html, /const required=\['niche','packages','about','booking'\]/);
assert.match(html, /function packagesForBookingPage\(\)/);
assert.match(html, /await syncPublishedWebsiteToBookingPage\(\)/);
assert.match(html, /function createPublishedSnapshot\(\)/);
assert.match(html, /_publishedSnapshot:snapshot/);
assert.match(html, /profile_data:profileData/);
assert.match(html, /phone\.includes\('@'\)/);
assert.match(html, /Check the booking inquiry email address/);
assert.match(html, /Professional setup and safety check/);
assert.match(html, /Custom color styling/);

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(Boolean);

scripts.forEach(source => new Function(source));

console.log('ready-made website flow tests passed');
