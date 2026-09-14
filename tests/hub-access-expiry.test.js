'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const webhook = read('api/send-purchase-email.js');
const cron = read('api/send-reminders.js');
const sql = read('migrations/20260914_hub_access_expiry.sql');

// ── The year the sales page promises actually gets set ──────────────────
// KPPS is sold as "Party Biz Hub included for one year, then $27/month". The
// purchase previously set has_crm_access = true with nothing to end it, so
// every buyer had $27/month permanently.
assert.match(webhook, /crm_access_expires_at/);
const kppsBranch = /if \(isKPPS\) \{[\s\S]*?\n    \}/.exec(webhook);
assert.ok(kppsBranch, 'the KPPS grant branch is missing');
assert.match(kppsBranch[0], /setFullYear\(oneYear\.getFullYear\(\) \+ 1\)/);
assert.match(kppsBranch[0], /profilePayload\.crm_access_expires_at/);
// Training access is genuinely for life — only the bundled software ends.
assert.match(kppsBranch[0], /has_kpps_access = true/);

// ── Nobody finds out by discovering their quote builder gone ────────────
assert.match(cron, /async function runHubAccessExpiry/);
assert.match(cron, /await runHubAccessExpiry\(today\)/);
assert.match(cron, /for \(const days of \[30, 7, 1\]\)/);
// The cron runs daily, so a milestone already sent must not send again.
assert.match(cron, /hubExpiryRemindersSent/);
assert.match(cron, /if \(sent\.includes\(days\)\) continue;/);
// Every warning names the price and says the training is unaffected.
assert.match(cron, /\$27\/month/);
assert.match(cron, /stay yours for life/);
// Only the bundled Hub flag is switched off; KPPS access is never touched.
const closeBlock = /const lapsed = await supabaseGet\([\s\S]*?\n  \}/.exec(cron);
assert.ok(closeBlock, 'the lapse-closing block is missing');
assert.match(closeBlock[0], /has_crm_access: false/);
assert.doesNotMatch(closeBlock[0], /has_kpps_access/);

// ── Existing members are not cut off by running the migration ───────────
assert.match(sql, /add column if not exists crm_access_expires_at timestamptz/);
// NULL must keep meaning "no expiry", so monthly subscribers and everyone who
// already bought are unaffected until a date is deliberately set.
assert.match(sql, /NULL\s+= no expiry/);
// The backfill is real but must stay commented until she chooses to run it.
assert.doesNotMatch(sql, /^\s*update public\.profiles\s*$/m);
assert.match(sql, /^-- update public\.profiles/m);
assert.match(sql, /^-- ROLLBACK/m);

// ── The page gates honour the date without waiting for the nightly job ──
const GATED = ['contract.html', 'assistant.html', 'content.html', 'profit.html', 'prep.html', 'vendors.html'];
GATED.forEach(page => {
  const src = read(page);
  assert.match(src, /crm_access_expires_at/, `${page} should check the expiry date`);
  // A gate that checks a column it never fetched would silently never expire.
  assert.match(src, /select\('has_paid,has_crm_access,has_kpps_access,has_printables_access,crm_access_expires_at/,
    `${page} must fetch crm_access_expires_at`);
  // The existing crm-OR-kpps shape stays, so a legacy profile missing one flag
  // is not newly locked out — git history shows that lock catching 7 real
  // accounts once already.
  assert.match(src, /has_crm_access!==true\s*&&\s*p\.has_kpps_access!==true/,
    `${page} should keep its original access test`);
});
const app = read('app.html');
assert.match(app, /const hubExpired = profile && profile\.crm_access_expires_at/);
assert.match(app, /\|\| hubExpired\)\)/);

// ── The dead countdowns stay dead ───────────────────────────────────────
// Both landing pages counted down to June dates and rendered "CLOSED" and
// "Founders pricing has ended" above working buy buttons.
const landing = read('index.html');
const join = read('join.html');
assert.doesNotMatch(landing, /June 6/);
assert.doesNotMatch(landing, /countdown-bar/);
assert.doesNotMatch(landing, /Founders pricing has ended/);
assert.doesNotMatch(join, /June 18/);
assert.doesNotMatch(join, /updateCountdown/);
assert.doesNotMatch(join, /Founding Member Pricing Closes In/);
// The real benefit — a rate locked once you join — survives.
assert.match(landing, /stays locked for as long as you're a member/);

console.log('hub access expiry tests passed');
