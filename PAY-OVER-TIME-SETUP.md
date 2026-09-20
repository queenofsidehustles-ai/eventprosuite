# Turning on Klarna, Affirm and Afterpay

The code is done. These are the three steps only you can do, in order.
Nothing here needs a deploy.

---

## 1. Enable the methods in Stripe — per business

Payments run as **direct charges on each business's own Stripe account**, so
each owner turns these on in *their* dashboard. You cannot do it for them from
the Party Biz Hub account.

For Bear Hugs Events (and tell each of the other owners to do the same):

1. Log in at `dashboard.stripe.com` **as that business**.
2. **Settings → Payment methods.**
3. Turn on **Klarna**, **Affirm**, and **Afterpay / Cash App Afterpay**.
4. Accept each provider's terms. Some sit at "pending" for a short review
   before they go live — you want a green **Active**.

That is all that is required for the options to appear at checkout. The
checkout deliberately does not list payment methods in code, so whatever is
active in the dashboard is what customers see, and a new method never needs a
code change.

## 2. Add one environment variable — for the figures on the quote

This is only for the "or 4 payments of $198.75" line on the quote page. Skip it
and everything else still works; the line simply does not appear.

1. `dashboard.stripe.com` → **Developers → API keys** (the **Party Biz Hub
   platform** account, not a business account).
2. Copy the **Publishable key** — it starts with `pk_live_`. This one is safe
   in a browser; do not use the secret key.
3. Vercel → **eventprosuite → Settings → Environment Variables**.
4. Add `STRIPE_PUBLISHABLE_KEY` = that key, for **Production**.
5. **Redeploy** — environment variables only reach the running site on a new
   deployment.

## 3. Check it on a real quote

Open one of your own quote links and look for:

- the two payment choices — deposit, or pay in full
- Stripe's instalment line under them (only after step 2)
- Klarna / Affirm / Afterpay on the Stripe page after clicking through

---

## What changed, and the parts worth knowing

**A customer can now pay the whole quote, not just the deposit.** That is the
version of buy-now-pay-later that actually helps: financing a deposit leaves
her owing a balance she still has to find later. Either way you are paid in
full, up front — the provider carries the instalments, not you.

**A quote paid in full is marked `confirmed`, not `deposit-paid`,** so it does
not sit in your list of people to chase for a balance, and the automatic
contract says "received in full. Nothing further is due" instead of billing her
for $0.00.

**Afterpay adds an address step to your checkout.** Stripe will not show
Afterpay unless a shipping address is collected — that is how it reads the
customer's country. So that step is only added for businesses that actually
have Afterpay switched on; everyone else keeps the shorter checkout. For you it
is not wasted: it is where the teepees get delivered.

**The quote only advertises what that business has really enabled.** The list
is read from the owner's Stripe account at the moment the quote is opened.
Promising Klarna on a quote whose checkout does not offer it is worse than
saying nothing, so if the check fails for any reason the page stays silent and
the quote books exactly as before.

**The instalment figures come from Stripe, never from us.** The terms belong to
Klarna, Affirm and Afterpay, vary by shopper and amount, and change without
notice. Stripe's messaging element renders them so the quote cannot advertise
credit terms nobody agreed to.

## One thing to decide with your eyes open

Pay-over-time costs more than a card. Stripe advertises a promotional rate on
Klarna and Affirm for an introductory period, after which standard buy-now-pay-
later pricing applies — higher than the 2.9% + 30¢ you are used to. Check what
your account is actually charged at stripe.com/pricing/local-payment-methods
before you push these hard, and weigh it against the bookings that only happen
because someone could spread the cost.
