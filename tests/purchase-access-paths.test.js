'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const webhook = read('api/send-purchase-email.js');
const success = read('success.html');
const login = read('login.html');

// ── Access is granted by the server, never by the browser ───────────────
// Entitlements are written with the service-role key, which the
// protect_profile_entitlements trigger exempts. That is what makes it safe to
// run secure-profile-entitlements.sql: a paying customer's access does not
// depend on a browser write the database is about to start ignoring.
assert.match(webhook, /SUPABASE_SERVICE_KEY/);
assert.match(webhook, /profilePayload\.has_kpps_access = true/);
assert.match(webhook, /profilePayload\.has_crm_access = true/);
assert.match(webhook, /profilePayload\.has_printables_access = true/);

// Every purchase shape the webhook recognises must still reach that grant.
// A tagged product beats the subscription default. Without this a KPPS
// payment plan billed as monthly instalments would grant Hub access instead of
// KPPS, and the buyer would never get what they paid for.
assert.match(webhook, /const isCRMSub = taggedCRM \|\| \(sessionMode === 'subscription' && !taggedKpps && !taggedPrintables\)/);
assert.match(webhook, /const taggedKpps\s+= metaProduct === 'kpps'/);
assert.match(webhook, /metaProduct === 'kpps'/);
// Recognition prefers a metadata tag, then an env-var amount, then the
// built-in list — so changing a price cannot silently stop granting access.
assert.match(webhook, /metaProduct === 'printables' \|\| metaProduct === 'ppp'/);
assert.match(webhook, /KPPS_PRICE_CENTS/);
assert.match(webhook, /PRINTABLES_PRICE_CENTS/);
// Historical prices stay listed so a past purchase can still be replayed.
assert.match(webhook, /KPPS_AMOUNTS = new Set\(\[19700, 40000, 49700/);
assert.match(webhook, /PPP_AMOUNTS = new Set\(\[6700, 7900, 9700/);

// ── Instalment plans must stop, and must not cost the buyer their access ──
// Stripe has no built-in "charge 3 times then stop", so the count is enforced
// here. Without it a payment plan bills the customer forever.
assert.match(webhook, /async function handleInstalmentInvoice/);
assert.match(webhook, /invoice\.paid' \|\| event\.type === 'invoice\.payment_succeeded'/);
assert.match(webhook, /paidCount < planSize/);
assert.match(webhook, /subscriptions\/'[\s\S]{0,160}method: 'DELETE'/);
// An ordinary monthly Hub subscription must never be cancelled by this path.
assert.match(webhook, /if \(!planSize\) return res\.json\(\{ received: true \}\)/);

// A plan ending because it was PAID OFF must not revoke access — that would
// punish the customer who completed every payment.
assert.match(webhook, /isInstalmentPlanSubscription\(sub\)/);
assert.match(webhook, /Instalment plan completed — access kept/);
assert.match(webhook, /customerHasLifetimeAccess/);
assert.match(webhook, /KPPS member — CRM access not revoked/);
// If that lookup fails, keep access rather than risk revoking a paid member's.
const lifetime = /async function customerHasLifetimeAccess[\s\S]*?\n\}/.exec(webhook);
assert.ok(lifetime, 'the lifetime-access guard is missing');
assert.match(lifetime[0], /catch \(_\) \{[\s\S]*?return true;/);

// The printables sales page must not quote a stale price anywhere.
const join = read('join.html');
assert.doesNotMatch(join, /\$97/);
assert.match(join, /\$67/);

// The subscription price shown to a customer must match what they were
// charged — the landing page and Stripe link are $27.
const success2 = read('success.html');
assert.match(success2, /\$27\/month founder rate/);
assert.doesNotMatch(success2, /\$29\/month/);
assert.doesNotMatch(read('mywebsite.html'), /\$29\/mo Hub rate/);

// ── A purchase that grants nothing must not be silent ───────────────────
// Recognition is by amount, so a price change or an untagged new product falls
// through. Returning 200 shows Stripe a green tick, so without an alert the
// first sign of trouble is an angry customer.
const skip = /if \(!isCRMSub && !isKPPS && !assignedTier\) \{[\s\S]*?\n  \}/.exec(webhook);
assert.ok(skip, 'the unrecognised-purchase branch is missing');
assert.match(skip[0], /console\.error\('PURCHASE NOT RECOGNISED/);
assert.match(skip[0], /alertOwnerOfSkippedPurchase/);
assert.match(webhook, /async function alertOwnerOfSkippedPurchase/);
// One alert per Stripe event, since Stripe retries webhooks.
assert.match(webhook, /'Idempotency-Key': `purchase-skipped\/\$\{eventId\}`/);
// The alert has to say how to stop it recurring, not just that it happened.
assert.match(webhook, /add <code>product<\/code> metadata/);

// ── Signup confirms access instead of assuming it ───────────────────────
// login.html hard-gates on has_paid, so a success screen shown before the
// entitlement actually lands sends the customer straight into
// "No active subscription found".
assert.match(login, /if \(!profile\?\.has_paid\)/);
assert.match(success, /async function waitForFounderAccess/);
assert.match(success, /const confirmed = await waitForFounderAccess\(userId\)/);
assert.match(success, /has_paid === true \|\| data\.has_crm_access === true/);
// The done screen is now behind that confirmation.
const done = /const confirmed = await waitForFounderAccess[\s\S]*?doneSection'\)\.style\.display = 'block'/.exec(success);
assert.ok(done, 'the done screen should only show once access is confirmed');
assert.match(done[0], /if \(!confirmed\)/);

console.log('purchase access path tests passed');
