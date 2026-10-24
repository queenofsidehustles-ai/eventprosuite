'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webhook = fs.readFileSync(path.join(__dirname, '..', 'api/send-purchase-email.js'), 'utf8');

// Every KPPS sale lands in the MailerLite "KPPS Buyers" group, which the
// Friday business report counts. Only KPPS, only after delivery succeeded.
assert.match(webhook, /if \(isKPPS\) await addKppsBuyerToMailerLite\(/);
const successReturn = webhook.indexOf('if (isKPPS) await addKppsBuyerToMailerLite(');
const deliveredReturn = webhook.indexOf('emailSent: true });', successReturn);
assert.ok(successReturn > 0 && deliveredReturn > successReturn, 'buyer is added right before the delivered response');
assert.match(webhook, /KPPS_BUYERS_GROUP_ID'\) \|\| '184402963087754776'/);

// A MailerLite failure must never fail the Stripe webhook.
const fn = webhook.slice(webhook.indexOf('async function addKppsBuyerToMailerLite'));
const body = fn.slice(0, fn.indexOf('\n}\n'));
assert.match(body, /try \{/);
assert.match(body, /catch \(e\)/);
assert.doesNotMatch(body, /\bres\./, 'helper never touches the webhook response');

// The $297 price that starts 1 Nov 2026 is recognised as KPPS without an env var.
assert.match(webhook, /KPPS_AMOUNTS = new Set\(\[19700, 40000, 49700, 29700,/);

console.log('kpps-buyers-mailerlite: ok');
