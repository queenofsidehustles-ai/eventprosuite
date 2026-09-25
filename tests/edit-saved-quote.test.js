'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.html');

// ── No quote data in an HTML attribute, ever ────────────────────────────
// The whole quote was JSON.stringify'd into the Load button's onclick, with
// apostrophes "escaped" as \' — which HTML does not honour. The attribute is
// delimited by single quotes, so the FIRST apostrophe in the data ended it and
// truncated the handler mid-string into a syntax error. Any quote for a client
// called O'Brien, themed "Stormy's Bear Fashion Show", or noting "Children's
// styling table" had a dead Load button that opened an empty form.
assert.doesNotMatch(app, /onclick='loadQuote\(/);
assert.doesNotMatch(app, /JSON\.stringify\(q\.quote_data\)/);
assert.match(app, /onclick="loadSavedQuote\('\$\{q\.id\}'\)"/);
assert.match(app, /function loadSavedQuote\(id\)/);

// Demonstrate the class of bug, so nobody reintroduces it: an apostrophe in
// the data must not be able to close the attribute.
const rowMarkup = /\$\('savedQuotesBody'\)\.innerHTML = quotes\.map\(q => `([\s\S]*?)`\)\.join\(''\);/.exec(app);
assert.ok(rowMarkup, 'the saved-quote row markup moved');
const interpolations = rowMarkup[1].match(/\$\{[^}]*\}/g) || [];
interpolations.forEach(bit => {
  // Every value dropped into the row is either escaped, a formatted number, a
  // bare id, or one of the label helpers — never raw quote data.
  const safe = /escapeHtml\(|money\(|toLocaleDateString\(|quoteSendLabel\(|quoteOpenedLabel\(|^\$\{q\.id\}$/.test(bit);
  assert.ok(safe, 'unescaped value in the saved-quote row: ' + bit);
});

// ── Editing a sent quote changes the link she already sent ──────────────
// A saved quote has a link that may be sat in a customer's text messages.
// Filing a second quote on every edit would leave that customer reading the
// old one for ever.
assert.match(app, /async function saveQuote\(opts\)/);
assert.match(app, /const editingId = \(opts && opts\.asNew\) \? null : _lastSavedQuoteId;/);
assert.match(app, /\.update\(changes\)\.eq\('id', editingId\)\.eq\('user_id', currentUser\.id\)/);
// created_at must not be rewritten: it is the same quote, edited.
assert.match(app, /const \{ created_at, \.\.\.changes \} = payload;/);
// A row deleted on another device must not lose the edit in front of her.
assert.match(app, /if \(!editingId \|\| error\) \{\n\s+\(\{ data, error \} = await sb\.from\('saved_quotes'\)\.insert\(payload\)/);
// The other case — an old quote as a starting point for a different customer.
assert.match(app, /id="saveAsNewBtn"/);
assert.match(app, /if \(t\.id === 'saveAsNewBtn'\) \{ await saveQuote\(\{ asNew: true \}\); return; \}/);

// ── And she can tell which of the two she is about to do ────────────────
assert.match(app, /function markEditingSavedQuote\(editing\)/);
const marker = /function markEditingSavedQuote\(editing\) \{[\s\S]*?\n\}/.exec(app)[0];
assert.match(marker, /Update Quote/);
assert.match(marker, /Save Quote/);
// Every route into an existing quote flips it: the list, and a ?quote= link.
assert.equal((app.match(/markEditingSavedQuote\(true\)/g) || []).length, 3);
assert.match(app, /Quote updated — the link you already sent now shows this/);

// Reopening also re-enables sending, so an untouched quote can go straight out.
const loader = /function loadSavedQuote\(id\) \{[\s\S]*?\n\}/.exec(app)[0];
assert.match(loader, /_lastSavedQuoteId = q\.id;/);
assert.match(loader, /enableShareButton\(\);/);
// Read from the list already in memory, not refetched into an attribute.
assert.match(loader, /_savedQuotesCache \|\| \[\]/);

// ── And there is a way to reach the list at all ─────────────────────────
// The "My saved quotes" modal and its loader had been in app.html all along
// with NOTHING calling openQuotesModal — the menu that held the link was gone
// from the markup. Every saved quote was unreachable from the one page that
// lists them, which is why a quote already sent could not be found or edited.
assert.match(app, /id="openQuotesBtn"/);
assert.match(app, /if \(t\.id === 'openQuotesBtn'\) \{ await openQuotesModal\(\); return; \}/);
// Reachable from the sidebar too, since that is where someone looks first.
const nav = read('nav.js');
assert.match(nav, /href: 'app\.html\?quotes=1'[^}]*label: 'My Quotes'/);
// …which means the builder has to honour that link on arrival.
assert.match(app, /if \(params\.get\('quotes'\)\) \{ openQuotesModal\(\); return; \}/);

console.log('edit saved quote tests passed');
