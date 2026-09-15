'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROUTES = ['api/send-quote-email.js', 'api/send-purchase-email.js',
                'api/send-reminders.js', 'api/send-contract-email.js'];

// ── A pasted secret must survive its own whitespace ─────────────────────
// Environment values arrive by copy and paste, and a trailing newline rides
// along invisibly. The resulting failure blames the key itself, which sends
// anyone debugging it to check the wrong thing — a pasted Stripe Connect
// client id spent several rounds looking like a wrong id when the only
// problem was a "\n" on the end.
ROUTES.forEach(file => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(src, /const env = name => String\(process\.env\[name\] \|\| ''\)\.trim\(\);/,
    `${file} should read env values through the trimming helper`);
  // No credential or identifier may still be read raw.
  const raw = src.match(/process\.env\.(STRIPE_[A-Z_]+|RESEND_[A-Z_]+|SUPABASE_[A-Z_]+|TWILIO_[A-Z_]+|CRON_SECRET|KPPS_[A-Z_]+|PBH_[A-Z_]+)/g) || [];
  assert.deepEqual(raw, [], `${file} still reads these without trimming: ${raw.join(', ')}`);
});

// The helper behaves.
const ctx = {}; vm.createContext(ctx);
vm.runInContext(`
  this.process = { env: {} };
  this.make = (envObj) => { const process = { env: envObj };
    const env = name => String(process.env[name] || '').trim();
    return env; };
`, ctx);
const env = ctx.make({
  CLEAN: 'ca_abc123',
  NEWLINE: 'ca_abc123\n',
  SPACES: '  ca_abc123  ',
  CRLF: 'ca_abc123\r\n',
  EMPTY: '',
});
assert.equal(env('CLEAN'), 'ca_abc123');
assert.equal(env('NEWLINE'), 'ca_abc123', 'a trailing newline must not reach Stripe');
assert.equal(env('SPACES'), 'ca_abc123');
assert.equal(env('CRLF'), 'ca_abc123');
assert.equal(env('EMPTY'), '');
assert.equal(env('MISSING'), '');

console.log('env trimming tests passed');
