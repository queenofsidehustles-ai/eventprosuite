'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.html');
const dash = read('dashboard.html');
const migration = read('migrations/20260925_quote_send_log.sql');

// ── "Send Quote" must never throw the quote away ────────────────────────
// Every link into the Quote Builder was built from the row's STATUS alone:
// 'inquiry' meant app.html?booking=<id>. But the status modal lets any row be
// set to "Inquiry — just asking around", including a saved quote, and a quote
// id is not a booking id — so the builder looked it up in bookings, found
// nothing, and answered a button called Send Quote by starting a blank form.
assert.match(dash, /function quoteBuilderHref\(q\)/);
assert.match(dash, /const key = q\._source === 'booking' \? 'booking' : 'quote';/);
// No link may be built from the status any more. Checked against the code with
// its comments stripped, since the fix is explained in a comment that quotes
// the very form it removes.
const dashCode = dash.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const builderLinks = dashCode.match(/app\.html\?(booking|quote)=/g) || [];
assert.equal(builderLinks.length, 0,
  'a Quote Builder link is still hard-coded: ' + builderLinks.join(', '));
// Including the ones that used to be, on both surfaces.
assert.match(dash, /'inquiry': \{ priority: 1, label: 'Send Quote →'[^}]*href: quoteBuilderHref\(q\) \}/);
assert.match(dash, /'expired': \{ priority: 2[^}]*href: quoteBuilderHref\(q\) \}/);
assert.match(dash, /'inquiry':\s+\{label:'Send Quote →', href:quoteBuilderHref\(q\)\}/);
assert.match(dash, /'expired':\s+\{label:'Send Quote →', href:quoteBuilderHref\(q\)\}/);
// prep.html takes a real booking id and is not part of this.
assert.match(dash, /prep\.html\?booking=\$\{encodedId\}/);

// ── And the builder survives a link that is wrong anyway ────────────────
// Old bookmarks and already-sent links still carry the previous form, so the
// builder tries the other table before giving up.
assert.match(app, /async function prefillFromSavedQuote\(explicitId\)/);
assert.match(app, /async function prefillFromBooking\(bookingId, opts\)/);
assert.match(app, /if \(await prefillFromBooking\(quoteId, \{ silent: true \}\)\) return true;/);
assert.match(app, /if \(await prefillFromSavedQuote\(bookingId\)\) return true;/);
// The silent guess must not report anything, or one lookup produces two
// contradictory toasts — and it must stop rather than bounce back.
const booking = /async function prefillFromBooking\(bookingId, opts\)[\s\S]*?\n\}/.exec(app);
assert.ok(booking);
assert.match(booking[0], /if \(silent\) return false;/);
assert.ok(booking[0].indexOf('if (silent) return false;') <
          booking[0].indexOf('prefillFromSavedQuote(bookingId)'),
  'the silent guard must come first, or a failed lookup can recurse');

// ── Sending is written down ─────────────────────────────────────────────
// The result lived in a toast for a few seconds and nowhere else, so an hour
// later the only way to know was to send it again and watch.
assert.match(app, /async function recordSendEvent\(quoteId, event\)/);
assert.match(migration, /add column if not exists send_events jsonb not null default '\[\]'::jsonb/);

// Every channel, and every failure, not just the happy path.
assert.match(app, /channel:'email', ok:!!d\.sent/);
assert.match(app, /channel:'text',  ok:!!d\.texted/);
assert.match(app, /note:d\.sent  \?null:\(d\.note    \|\|'unknown'\)/);
// A network failure used to report nothing at all.
assert.match(app, /note: 'Could not reach the server'/);
// Copying the link is a real send — it is the one that works when email does
// not — and both copy buttons record it.
assert.equal((app.match(/channel: 'link', ok \}\)\);/g) || []).length, 2);
// Scoped to the owner's own row on both the read and the write.
const recorder = /async function recordSendEvent\(quoteId, event\)[\s\S]*?\n\}/.exec(app);
assert.equal((recorder[0].match(/\.eq\('user_id', currentUser\.id\)/g) || []).length, 2);
// Recording must never break sending, and must not grow without limit.
assert.match(recorder[0], /catch \(e\) \{/);
assert.match(recorder[0], /\.slice\(-20\)/);

// ── And it shows up where she looks ─────────────────────────────────────
assert.match(app, /\$\{quoteSendLabel\(q\)\}\$\{quoteOpenedLabel\(q\)\}/);

const label = new Function(
  /function quoteSendLabel\(q\) \{[\s\S]*?\n\}/.exec(app)[0] + 'return quoteSendLabel;'
)();
// Before the migration runs the column is absent, which is not the same as
// "never sent" — so it claims nothing.
assert.equal(label({ client_name: 'April' }), '');
assert.match(label({ send_events: [] }), /Not sent yet/);
assert.match(label({ send_events: [{ at: '2026-09-25T16:14:00Z', channel: 'email', ok: true }] }), /Emailed/);
assert.match(label({ send_events: [{ at: '2026-09-25T16:14:00Z', channel: 'link', ok: true }] }), /Link copied/);
// The failure is the entry that matters most, and it says why.
const failed = label({ send_events: [{ at: '2026-09-25T16:14:00Z', channel: 'email', ok: false, note: 'domain not verified' }] });
assert.match(failed, /failed/);
assert.match(failed, /domain not verified/);
// The latest attempt wins, so a retry that worked reads as sent.
assert.match(label({ send_events: [
  { at: '2026-09-25T16:00:00Z', channel: 'email', ok: false, note: 'bounced' },
  { at: '2026-09-25T16:20:00Z', channel: 'text',  ok: true },
] }), /Texted/);

console.log('quote send tracking tests passed');
