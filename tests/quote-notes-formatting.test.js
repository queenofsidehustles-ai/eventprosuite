'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.html');
const view = read('view-quote.html');

// ── Notes are a list, not a paragraph ───────────────────────────────────
// Both sides rendered the notes as one escaped blob, and HTML collapses line
// breaks — so a carefully listed set of event details arrived as a single
// run-on sentence with every item jammed end to end.
assert.doesNotMatch(app, /<div>\$\{escapeHtml\(\$\('eventNotes'\)\.value/);
assert.doesNotMatch(view, /<p>\$\{esc\(qd\.eventNotes\)\}<\/p>/);
assert.match(app, /function notesToHtml\(text\)/);
assert.match(view, /function notesHtml\(text\)/);

// ── And they get the width to be readable ───────────────────────────────
// They used to sit in the narrow left cell beside the totals, which turned a
// long list into a tall ribbon that spilled down a second page.
assert.match(app, /\$\{notesBlock\(\$\('eventNotes'\)\.value\)\}/);
assert.match(app, /\.notes-card\.notes-full\{margin-top:16px\}/);
// The totals keep their column rather than stretching into the space left.
assert.match(app, /\.invoice-side\{display:flex;justify-content:flex-end/);
assert.match(app, /\.invoice-side-stack\{[^}]*width:340px;max-width:100%\}/);
// An empty notes box on a quote with no notes is noise, so it is omitted.
assert.match(app, /if \(!String\(text \|\| ''\)\.trim\(\)\) return '';/);

// ── Behaviour, run on both copies ───────────────────────────────────────
// view-quote.html indents its copy, so the close brace is matched with its
// leading whitespace rather than assumed to sit at column zero.
const build = (src, fnName, escBody) => {
  const body = new RegExp('function ' + fnName + '\\([\\s\\S]*?\\n\\s*\\}').exec(src);
  assert.ok(body, fnName + ' not found');
  return new Function(escBody + '\n' + body[0] + '\nreturn ' + fnName + ';')();
};
const ownerEsc = /const escapeHtml = [^\n]*/.exec(app);
assert.ok(ownerEsc, 'escapeHtml is missing from app.html');
const owner = build(app, 'notesToHtml', ownerEsc[0]);
const customer = build(view, 'notesHtml',
  'const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[m]));');

[['owner', owner], ['customer', customer]].forEach(([who, fn]) => {
  const many = fn('One teddy bear each\nSeating for 10\nDelivery and setup');
  assert.match(many, /<ul/, who + ': several lines must become a list');
  assert.equal((many.match(/<li>/g) || []).length, 3, who + ': one bullet per line');
  // One bullet on its own reads as a mistake.
  assert.doesNotMatch(fn('Delivery and setup included'), /<ul/, who + ': a single line stays prose');
  // Double-spaced typing must not leave empty bullets.
  assert.equal((fn('Seating for 10\n\n\nSetup included').match(/<li>/g) || []).length, 2, who + ': blank lines dropped');
  // Notes already typed as a list must not end up double-bulleted.
  assert.match(fn('- Seating for 10\n- Setup included'), /<li>Seating for 10<\/li>/, who + ': leading dashes stripped');
  assert.match(fn('• Seating\n• Setup'), /<li>Seating<\/li>/, who + ': leading bullets stripped');
  // Windows line endings arrive from pasted text.
  assert.equal((fn('Seating for 10\r\nSetup included').match(/<li>/g) || []).length, 2, who + ': CRLF handled');
  assert.doesNotMatch(fn('Seating\r\nSetup'), /\r/, who + ': no stray carriage returns');
  // Notes are typed by hand and land in HTML.
  assert.match(fn('<script>alert(1)</script>\nSecond line'), /&lt;script&gt;/, who + ': notes are escaped');
  assert.doesNotMatch(fn('<script>alert(1)</script>\nSecond line'), /<script>/, who + ': notes are escaped');
});

// Nothing to show is handled differently on each side on purpose: the owner's
// preview says so, the customer's is simply left out.
assert.match(owner(''), /No additional notes added/);
assert.equal(customer(''), '');

console.log('quote notes formatting tests passed');
