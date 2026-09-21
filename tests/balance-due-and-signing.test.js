'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const quoteHandler = require('../api/send-quote-email.js');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const api        = read('api/send-quote-email.js');
const contractJs = read('api/auto-contract.js');
const purchase   = read('api/send-purchase-email.js');
const reminders  = read('api/send-reminders.js');
const view       = read('view-quote.html');
const profile    = read('profile.html');
const app        = read('app.html');
const center     = read('contract.html');
const sign       = read('sign-contract.html');
const migration  = read('migrations/20260921_balance_due_and_signing.sql');

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

// ── The rule itself, executed ───────────────────────────────────────────
// Lifted from the server copy, which is the one that writes contracts.
const ctx = {}; vm.createContext(ctx);
const grab = name => {
  const m = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}').exec(contractJs);
  assert.ok(m, name + ' missing from auto-contract.js');
  return m[0];
};
vm.runInContext(
  grab('balanceDueDaysFrom') + grab('balanceDuePhrase') + grab('balanceDueDate') +
  'this.days = balanceDueDaysFrom; this.phrase = balanceDuePhrase; this.date = balanceDueDate;',
  ctx
);

// A quote overrides the business default — the whole point, since terms differ
// per client.
assert.equal(ctx.days({ balanceDueDays: 7 }, { balanceDueDays: 2 }), 2);
assert.equal(ctx.days({ balanceDueDays: 7 }, {}), 7);
assert.equal(ctx.days({ balanceDueDays: 7 }, { balanceDueDays: null }), 7);

// 0 means "on the day" and must survive every check that would read it as
// "not set" — the bug this kind of setting always has.
assert.equal(ctx.days({ balanceDueDays: 0 }, null), 0);
assert.equal(ctx.days({}, { balanceDueDays: 0 }), 0);
assert.equal(ctx.phrase({ balanceDueDays: 0 }, null), 'on the day of your event');
assert.equal(ctx.date('2026-10-11', { balanceDueDays: 0 }, null), '2026-10-11');

// Nonsense is ignored rather than turned into a date.
[{ balanceDueDays: -3 }, { balanceDueDays: 'soon' }, { balanceDueDays: 9999 }]
  .forEach(pd => assert.equal(ctx.days(pd, null), null));

// A business that never opened the setting reads exactly as it did before.
assert.equal(ctx.phrase({}, {}), 'before your event');
assert.equal(ctx.phrase({ paymentTerms: '10 days before' }, {}), '10 days before');
assert.equal(ctx.date('2026-10-11', {}, {}), null);

// The dates, including across a month boundary.
assert.equal(ctx.date('2026-10-11', { balanceDueDays: 2 }, null), '2026-10-09');
assert.equal(ctx.date('2026-10-11', { balanceDueDays: 7 }, null), '2026-10-04');
assert.equal(ctx.date('2026-10-01', { balanceDueDays: 7 }, null), '2026-09-24');
assert.equal(ctx.date('2026-03-01', { balanceDueDays: 30 }, null), '2026-01-30');
assert.equal(ctx.phrase({ balanceDueDays: 2 }, null), '48 hours before your event');
assert.equal(ctx.phrase({ balanceDueDays: 21 }, null), '3 weeks before your event');
assert.equal(ctx.phrase({ balanceDueDays: 10 }, null), '10 days before your event');

// ── One rule, every surface ─────────────────────────────────────────────
// The quote said "before your event", the contract said "on the event date",
// and the reminders said something else again. Nothing may say it on its own
// authority any more.
assert.doesNotMatch(contractJs, /const balance = eventDate;/);
assert.match(contractJs, /const balance = balanceDueDate\(eventDate, \{ balanceDueDays \}, null\) \|\| eventDate;/);
assert.doesNotMatch(view, /pd\.paymentTerms/);
assert.match(view, /balanceDuePhrase\(pd, qd\)/);
// Both paths that build a contract resolve it the same way.
assert.match(purchase, /balanceDueDays: balanceDueDaysFrom\(pd, quoteData\)/);
assert.match(read('dashboard.html'), /balanceDueDays: balanceDueDaysFor\(pd, b\)/);
// And the reminder states the date instead of "before the event".
assert.match(reminders, /balanceDue: balanceDueDate\(booking\.event_date, pd, reminderQuote\)/);
assert.match(reminders, /remaining balance was due on/);

// ── Somewhere to actually set it ────────────────────────────────────────
// The field the quote used to read, paymentTerms, had no input anywhere, so it
// could only ever be the vague default.
assert.match(profile, /<select id="balanceDueDays">/);
assert.match(profile, /balanceDueDays:Number\(\$\('balanceDueDays'\)\.value\)/);
assert.match(profile, /if\(pd\.balanceDueDays!==undefined&&pd\.balanceDueDays!==null\)/);
assert.match(app, /<select id="balanceDueDays">/);
// Blank means "use my default", and must not collapse to 0 = day-of.
assert.match(app, /\$\('balanceDueDays'\)\.value !== ''\s*\n?\s*\? Number\(\$\('balanceDueDays'\)\.value\) : null/);
assert.match(app, /\(data\.balanceDueDays === null \|\| data\.balanceDueDays === undefined\) \? '' : String\(data\.balanceDueDays\)/);
// The public quote page can only read allowlisted fields.
assert.match(migration, /'balanceDueDays'/);

// ── The signature is no longer a dead end ───────────────────────────────
// The label named the wrong party: automatic contracts carry no vendor
// signature, so a customer signing one filed it as 'Vendor Signed', and
// Contract Center looked for exactly 'Fully Signed' and found nothing.
assert.doesNotMatch(sign, /vendor_signature\?'Fully Signed':'Vendor Signed'/);
assert.match(sign, /vendor_signature\?'Fully Signed':'Client Signed'/);
assert.match(center, /SIGNED_STATUSES=\['Fully Signed','Client Signed','Vendor Signed'\]/);
assert.doesNotMatch(center, /status==='Fully Signed'\|\|/);
// Rows already written with the wrong label are corrected.
assert.match(migration, /set status = 'Client Signed'/);
assert.match(migration, /where status = 'Vendor Signed'/);
// The banner no longer tells a customer both parties signed when one did.
assert.match(sign, /if\(!c\.vendor_signature\)\{/);
// And the promise that the vendor was notified is kept.
assert.match(sign, /kind:'contract-signed',signToken:contract\.sign_token/);
assert.match(migration, /add column if not exists owner_notified_at timestamptz/);

(async () => {
  const previous = { fetch: global.fetch, service: process.env.SUPABASE_SERVICE_KEY,
    resend: process.env.RESEND_API_KEY };
  try {
    process.env.SUPABASE_SERVICE_KEY = 'service-test';
    process.env.RESEND_API_KEY = 're_test';

    let notifiedAt = null;
    let sent = null;
    const signedRow = {
      id: 'c1', user_id: 'owner-1', client_name: 'Mahaila <script>', client_email: 'm@example.com',
      event_date: '2026-10-11', total_price: '795', deposit_amount: '397.50',
      balance_due: '2026-10-04', status: 'Client Signed',
      client_signature: 'typed:Mahaila', signed_at: '2026-09-21T10:00:00Z',
    };
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/contracts?sign_token=')) {
        return { ok: true, json: async () => [{ ...signedRow, owner_notified_at: notifiedAt }] };
      }
      if (target.includes('/contracts?id=') && options.method === 'PATCH') {
        // The claim only succeeds while owner_notified_at is still null.
        if (notifiedAt) return { ok: true, json: async () => [] };
        notifiedAt = JSON.parse(options.body).owner_notified_at;
        return { ok: true, json: async () => [{ id: 'c1' }] };
      }
      if (target.includes('/profiles?')) return { ok: true, json: async () => [{
        id: 'owner-1', email: 'fallback@example.com',
        profile_data: { bizName: 'Bear Hugs Events', contactEmail: 'owner@example.com' },
      }] };
      if (target === 'https://api.resend.com/emails') {
        sent = JSON.parse(options.body);
        return { ok: true, json: async () => ({ id: 'email-1' }) };
      }
      throw new Error('Unexpected fetch: ' + target);
    };

    const first = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'contract-signed', signToken: 'tok-1',
    } }, first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.notified, true);
    assert.equal(sent.to, 'owner@example.com');
    assert.match(sent.subject, /signed the contract/);
    // Everything in the email comes off the contract row, and a client name is
    // typed into a form, so it lands escaped rather than as markup.
    assert.match(sent.html, /Mahaila &lt;script&gt;/);
    assert.doesNotMatch(sent.html, /<script>/);
    // The figures the owner needs to see at a glance.
    assert.match(sent.html, /\$795\.00/);
    assert.match(sent.html, /\$397\.50/);
    assert.match(sent.html, /October 4, 2026/);

    // Reloading the signed page must not send a second email.
    sent = null;
    const again = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'contract-signed', signToken: 'tok-1',
    } }, again);
    assert.equal(again.body.notified, false);
    assert.equal(sent, null);

    // An unsigned contract cannot be used to make us send mail.
    notifiedAt = null;
    signedRow.client_signature = null;
    const unsigned = response();
    await quoteHandler({ method: 'POST', headers: {}, body: {
      kind: 'contract-signed', signToken: 'tok-1',
    } }, unsigned);
    assert.equal(unsigned.statusCode, 409);
    assert.equal(sent, null);

    console.log('balance due and signing tests passed');
  } finally {
    global.fetch = previous.fetch;
    process.env.SUPABASE_SERVICE_KEY = previous.service;
    if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.resend;
  }
})().catch(e => { console.error(e); process.exit(1); });
