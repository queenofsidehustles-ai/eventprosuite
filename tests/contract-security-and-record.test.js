'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const sign = read('sign-contract.html');
const center = read('contract.html');
const auto = read('api/auto-contract.js');
const migration = read('migrations/20260926_lock_down_contracts.sql');

// ── contracts must not be readable by the public anon key ───────────────
// public.contracts had no row-level security at all. The anon key is printed
// in the source of every page, so a single request returned every contract on
// the platform: client names, emails, phones, event addresses, prices and
// signature images, for all 23 businesses. profiles and saved_quotes were
// locked down in September; this table was missed.
assert.match(migration, /alter table public\.contracts enable row level security;/);
['select', 'insert', 'update', 'delete'].forEach(action => {
  assert.match(migration, new RegExp('create policy contracts_owner_' + action, 'i'),
    'missing owner-only policy for ' + action);
});
assert.match(migration, /for select using \(auth\.uid\(\) = user_id\)/);
assert.match(migration, /with check \(auth\.uid\(\) = user_id\)/);

// ── …but the public signing page must keep working ──────────────────────
// It read and wrote the table directly, which is why it worked at all. Both
// now go through security-definer functions keyed on the random signing token.
assert.doesNotMatch(sign, /from\('contracts'\)/);
assert.match(sign, /sb\.rpc\('get_contract_for_signing',\{p_token:token\}\)/);
assert.match(sign, /sb\.rpc\('sign_contract_with_token'/);
assert.match(migration, /create or replace function public\.get_contract_for_signing\(p_token text\)/);
assert.match(migration, /security definer/);
assert.match(migration, /grant execute on function public\.get_contract_for_signing\(text\) to anon, authenticated/);
// One contract at a time, and only the one whose token the caller already has.
assert.match(migration, /where p_token is not null and sign_token::text = p_token/);
assert.match(migration, /limit 1/);

// A leaked link must not be able to overwrite a signature or touch a price.
const signFn = /create or replace function public\.sign_contract_with_token[\s\S]*?\$\$;/.exec(migration);
assert.ok(signFn, 'the signing function is missing');
assert.match(signFn[0], /and client_signature is null/);
assert.doesNotMatch(signFn[0], /total_price|deposit_amount|clauses|vendor_signature\s*=/);
// The status is decided server-side, not sent by the browser.
assert.match(signFn[0], /then 'Fully Signed' else 'Client Signed'/);
assert.doesNotMatch(sign, /status:'(Fully|Client) Signed'/);

// ── "When was the contract sent?" must have an answer ───────────────────
// status was set to 'Sent to Client' whether or not the email left, so a
// silent failure looked exactly like a delivered contract.
assert.match(migration, /add column if not exists email_sent_at timestamptz/);
assert.match(migration, /add column if not exists email_error   text/);
assert.match(auto, /email_sent_at: emailSent \? new Date\(\)\.toISOString\(\) : null/);
assert.match(auto, /email_error: emailSent \? null : \(emailError \|\| 'Unknown email failure'\)/);
// A contract whose email never went is not "Sent to Client".
assert.match(auto, /status: emailSent \? 'Sent to Client' : 'Draft'/);
// Recording requires the row's id, which the insert now returns.
assert.match(auto, /Prefer': 'return=representation'/);
assert.match(auto, /contractId = \(Array\.isArray\(rows\) \? rows\[0\] : rows\)\?\.id \|\| null/);
// And it must never undo a contract that was created and emailed.
const recorder = /if \(contractId\) \{[\s\S]*?\n  \}/.exec(auto);
assert.ok(recorder);
assert.match(recorder[0], /catch \(e\) \{/);

// Every reason an email does not go is named, not left blank.
['Email is not configured', 'No client email on the booking', 'Resend returned ']
  .forEach(reason => assert.ok(auto.includes(reason), 'unexplained email failure: ' + reason));

// ── And she can see it on the page ──────────────────────────────────────
assert.match(center, /const whenLine=c=>/);
assert.match(center, /\$\{sentLine\}\$\{signedNote\}\$\{resendLink\}/);
const when = /const whenLine=c=>\{[\s\S]*?\n  \};/.exec(center)[0];
assert.match(when, /c\.email_error/);
assert.match(when, /c\.email_sent_at/);
assert.match(when, /c\.signed_at/);
// A failure message comes from an email provider, and lands in HTML.
assert.match(when, /replace\(\/<\/g,'&lt;'\)/);
// Rows written before these columns existed must not be described either way.
assert.match(when, /return bits\.length\?/);

console.log('contract security and record tests passed');
