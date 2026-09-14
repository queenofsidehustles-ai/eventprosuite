'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dash = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

// ── Newest first, across both sources ───────────────────────────────────
// The list is two queries glued together: every booking, then every
// standalone quote. Each half arrives newest-first, but the join was not
// sorted — so a quote saved a minute ago sat below bookings from months back,
// and past the row cap disappeared entirely. That is what "I created it but
// I can't find it" looks like.
assert.match(dash, /\.sort\(\(a, b\) => new Date\(b\.created_at \|\| 0\) - new Date\(a\.created_at \|\| 0\)\)/);

// Prove the ordering rather than just matching the source.
const ctx = {}; vm.createContext(ctx);
vm.runInContext(`
  this.merge = (incoming, quotes) => [...incoming, ...quotes]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
`, ctx);
const merged = ctx.merge(
  [{ id: 'old-booking', created_at: '2026-01-05T10:00:00Z' },
   { id: 'older-booking', created_at: '2025-11-01T10:00:00Z' }],
  [{ id: 'new-quote', created_at: '2026-09-14T18:00:00Z' }]
);
assert.equal(merged[0].id, 'new-quote', 'the newest row must come first whichever source it came from');
assert.equal(merged[2].id, 'older-booking');
// A row with no timestamp sinks rather than jumping the queue.
const withNull = ctx.merge([{ id: 'undated' }], [{ id: 'dated', created_at: '2026-09-14T18:00:00Z' }]);
assert.equal(withNull[0].id, 'dated');

// ── Nothing is silently dropped ─────────────────────────────────────────
// Cutting the list at a fixed number with no indication is how a real booking
// becomes invisible without anyone knowing it happened.
assert.match(dash, /const SHOWN = 25;/);
assert.match(dash, /const hidden = Math\.max\(allQuotes\.length - SHOWN, 0\);/);
assert.match(dash, /older \$\{hidden === 1 \? 'one is' : 'ones are'\} not listed/);

console.log('dashboard ordering tests passed');
