'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'book.html'), 'utf8');

assert.match(html, /Request received! 🎉/);
assert.match(html, /This is a request, not a confirmed booking/);
assert.match(html, /Your date is not reserved/);
assert.match(html, /🎊 Submit Request/);
assert.match(html, /Questions\? Email/);
assert.match(html, /rawPhone\.includes\('@'\)/);
assert.doesNotMatch(html, /You're booked!/);
assert.doesNotMatch(html, /contract is being prepared/i);
assert.doesNotMatch(html, /id="contractNotice"/);

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(Boolean);

scripts.forEach(source => new Function(source));

console.log('booking confirmation tests passed');
