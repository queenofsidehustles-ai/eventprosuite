-- ═══════════════════════════════════════════════════════════════
-- "When is the rest due?" and "did she sign?"
-- ═══════════════════════════════════════════════════════════════
--
-- Two things this fixes.
--
-- 1. Nobody could say when the final payment was due. The quote page said
--    "before your event", the contract said "on the event date", and the
--    reminder emails said "before the event" — three different promises to
--    the same customer, none of them settable. The field the quote read,
--    paymentTerms, had no input anywhere in the app.
--
--    balanceDueDays is now the one rule: whole days BEFORE the event, where
--    0 means on the day. It is set per business and overridable per quote, so
--    "48 hours for this client, a week for that one" is expressible.
--
--    It has to be readable by the public quote page, so it joins the
--    allowlist. It is a number of days — it says nothing about the customer
--    or the money, and it is already printed on her quote.
--
-- 2. Signing told the customer "the vendor has also been notified" while
--    notifying nobody. owner_notified_at records that the email went, so
--    reloading the signed page cannot send it twice.
--
-- Run once in Supabase → SQL Editor → New query → Run.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Let the quote page read the rule ───────────────────────
-- Restated whole rather than patched, because this function IS the contract
-- for what a logged-out visitor may see. Adding 'balanceDueDays' to the end.
create or replace function public.public_profile_fields()
returns text[]
language sql
immutable
as $$
  select array[
    -- who they are
    'bizName','businessName','fullName','tagline','bio','about',
    'logo','logoUrl','logoDataURL',
    'brandColor','brandPrimary','brandColors','brandDark','brandLight',
    -- where they work
    'city','bizCity','location','bookingArea',
    -- how a customer reaches them
    'contactEmail','contactPhone','bizEmail','bizPhone',
    'instagram','facebook','tiktok',
    'socialInstagram','socialFacebook','socialTiktok','socialYoutube','socialCustom',
    -- what a customer can book and how they pay for it
    'bookingServices','depositUpfront','depositProfile','paymentTerms','paymentLink',
    'balanceDueDays',
    'stripe100','stripe250','stripe500','stripe1000','stripeLinks','stripeConnectReady',
    'taxLabel','termsText','shopTemplate'
  ];
$$;

-- ── 2. Remember that the owner was told ───────────────────────
alter table public.contracts
  add column if not exists owner_notified_at timestamptz;

-- ── 3. Correct the contracts that were mislabelled ────────────
-- A customer signing an automatic contract set the status to 'Vendor Signed',
-- because the code picked the label from whether the VENDOR had signed and
-- automatic contracts carry no vendor signature. So every contract a customer
-- signed says the wrong party signed it, and Contract Center — which looks for
-- exactly 'Fully Signed' — showed none of them as signed at all.
--
-- 'Client Signed' is what those rows actually are: signed by the customer,
-- awaiting the owner's counter-signature.
update public.contracts
   set status = 'Client Signed'
 where status = 'Vendor Signed'
   and client_signature is not null
   and vendor_signature is null;

-- ── Verify ────────────────────────────────────────────────────
--   select 'balanceDueDays' = any(public.public_profile_fields()) as allowlisted;
--   select status, count(*) from public.contracts group by status;
