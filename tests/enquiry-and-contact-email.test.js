'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const api = read('api/send-quote-email.js');
const profile = read('profile.html');

// ── A website enquiry reaches the owner ─────────────────────────────────
// It saved silently before: the customer got a confirmation and the owner
// found out only by opening the dashboard.
assert.match(api, /async function notifyOwnerOfEnquiry/);
assert.match(api, /await notifyOwnerOfEnquiry\(/);
// Replying to the alert reaches the customer who enquired.
assert.match(api, /reply_to: validEmail\(payload\.client_email\)/);
// Stripe-style retries and double submits must not spam the owner.
assert.match(api, /'Idempotency-Key': `enquiry\/\$\{bookingId \|\| payload\.client_email\}`/);
// It must be honest about what this is — a lead, not a booking.
assert.match(api, /Nothing is booked and no price has been agreed/);

// A lead already saved must never be reported as failed because an email
// bounced, so the notification is wrapped and swallowed.
const call = /try \{\s*await notifyOwnerOfEnquiry\(\{[\s\S]*?\} catch \(e\) \{[\s\S]*?\}/.exec(api);
assert.ok(call, 'the enquiry notification must be wrapped in try/catch');
assert.match(call[0], /console\.warn/);
// And it is sent before the success response, because a serverless function
// can be frozen the moment it responds.
const insertIdx = api.indexOf('await notifyOwnerOfEnquiry');
const respondIdx = api.indexOf("return res.status(201).json({ received: true");
assert.ok(insertIdx > 0 && respondIdx > insertIdx, 'notify must run before the 201 response');

// ── The business email can finally be set ───────────────────────────────
// contactEmail is read on the public site, the booking form, the quote page
// and as the reply-to on every customer email — and no screen in the app
// could write it, so it silently fell back to the login address everywhere.
assert.match(profile, /id="contactEmail"/);
assert.match(profile, /\$\('contactEmail'\)\)\$\('contactEmail'\)\.value=pd\.contactEmail\|\|pd\.bizEmail\|\|''/);
assert.match(profile, /\n      contactEmail,\n/);
// A typo here would break replies on every quote, so it is validated.
assert.match(profile, /That business email does not look right/);
// Blank stays allowed — the login address is a sane fallback.
assert.match(profile, /if\(contactEmail&&!/);
// The existing guard against an email typed into the phone box still stands.
assert.match(profile, /contactPhone\.includes\('@'\)/);

console.log('enquiry notification and contact email tests passed');
