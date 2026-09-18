'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.html');
const viewQuote = read('view-quote.html');
const migration = read('migrations/20260918_quote_viewed_at.sql');

// ── The link must be reachable when the client HAS an email ─────────────
// shareQuote() only fell back to copying the link when there was neither an
// email nor a phone on file. With an email present the button emailed and
// there was no way to get the link at all — which is exactly the case that
// matters, because the reason to send a link is that the email went to spam.
assert.match(app, /id="copyQuoteLinkBtn"/);
assert.match(app, /if \(t\.id === 'copyQuoteLinkBtn'\) \{ copyQuoteLink\(\); return; \}/);

// Enabled purely by having saved, never by which contact details exist.
const enableCopy = /function enableCopyLinkButton\(\) \{[\s\S]*?\n\}/.exec(app);
assert.ok(enableCopy, 'enableCopyLinkButton missing');
assert.doesNotMatch(enableCopy[0], /clientEmail|clientPhone/);
// Both paths to a saved quote — a fresh save and a reopened one — enable it.
assert.match(app, /enableCopyLinkButton\(\);\n  const shareBtn = \$\('shareQuoteBtn'\);/);
assert.match(app, /function enableShareButton\(\) \{\n  enableCopyLinkButton\(\);/);

// ── One link builder, so email and text can never disagree ──────────────
assert.match(app, /function quoteLinkFor\(id\)/);
assert.match(app, /return base \+ 'view-quote\.html\?id=' \+ id;/);
assert.match(app, /const link = quoteLinkFor\(_lastSavedQuoteId\);/);

// ── A quote already sent can be re-shared without rebuilding it ─────────
assert.match(app, /onclick="copySavedQuoteLink\('\$\{q\.id\}'\)"/);
assert.match(app, /_savedQuotesCache = data \|\| \[\];/);

// ── The message, actually executed ──────────────────────────────────────
const grab = name => {
  const m = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}').exec(app);
  assert.ok(m, name + ' not found in app.html');
  return m[0];
};
const sandbox = new Function(
  grab('fmtLongDate') + grab('quoteTextMessage') + grab('quoteOpenedLabel') +
  'return { quoteTextMessage, quoteOpenedLabel };'
)();

const msg = sandbox.quoteTextMessage({
  clientName: 'Sarah', bizName: 'Party Magic', eventType: 'Princess Party',
  eventTheme: 'Frozen', eventDate: '2026-03-14', expiryDate: '2026-03-01',
  grand: 1250, link: 'https://example.com/view-quote.html?id=abc'
});
// Addressed, priced, and tappable: the three things that decide whether a
// pasted text gets opened.
assert.match(msg, /^Hi Sarah!/);
assert.match(msg, /Party Magic/);
assert.match(msg, /\$1,250\.00/);
assert.match(msg, /Valid until March 1, 2026\./);
// The link sits alone on its line so phones linkify it.
assert.ok(msg.split('\n').includes('https://example.com/view-quote.html?id=abc'));
// Blank lines survive. A text message with none of them is a wall of words
// nobody reads, and a filter over a fixed list silently ate them once.
assert.match(msg, /^Hi Sarah!\n\nYour party quote/);
assert.match(msg, /Total: \$1,250\.00\n\nView & approve here:/);
assert.match(msg, /\n\nValid until/);
// A date-only string must not slip back a day west of UTC.
assert.match(msg, /March 14, 2026/);

// Missing details collapse instead of leaving "undefined" or stray separators.
const bare = sandbox.quoteTextMessage({ grand: 0, link: 'https://x/y' });
assert.doesNotMatch(bare, /undefined|null|NaN/);
assert.doesNotMatch(bare, /·\s*$/m);
assert.match(bare, /^Hi there!\n\nYour party quote/);

// ── "Has she opened it yet?" ────────────────────────────────────────────
assert.equal(sandbox.quoteOpenedLabel({ viewed_at: null }), ' · ○ Not opened yet');
assert.match(sandbox.quoteOpenedLabel({ viewed_at: '2026-03-02T15:04:00Z' }), /Opened /);
// Before the migration runs the column is absent — which is not evidence that
// the customer ignored the quote, so it must not claim that.
assert.equal(sandbox.quoteOpenedLabel({ client_name: 'Sarah' }), '');

// The stamp is written by the public page, and never blocks rendering.
assert.match(viewQuote, /sb\.rpc\('mark_quote_viewed',\{quote_id:id\}\)/);
assert.match(viewQuote, /\.catch\(\(\)=>\{\}\);/);

// ── The migration keeps the table locked down ───────────────────────────
// Same shape as get_public_quote: anon can stamp one known UUID, not read or
// write anything else.
assert.match(migration, /add column if not exists viewed_at timestamptz/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = public/);
assert.match(migration, /grant execute on function public\.mark_quote_viewed\(uuid\) to anon, authenticated/);
// First open only, so it answers "did it reach her" rather than "last refresh".
assert.match(migration, /and viewed_at is null/);

console.log('copy quote link tests passed');
