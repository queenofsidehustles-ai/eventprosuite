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

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(Boolean);

scripts.forEach(source => new Function(source));

console.log('ready-made website flow tests passed');
