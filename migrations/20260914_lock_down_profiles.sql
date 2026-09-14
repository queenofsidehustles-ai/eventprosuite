-- Party Biz Hub — stop publishing every owner's profile to the internet
--
-- THE PROBLEM
-- `profiles: anon can read` is `for select to anon using (true)`: no condition,
-- every row. A stranger with the publishable key — which ships in the page
-- source — can read all 26 profiles in one request. That exposes each owner's
-- name, login email, phone, what they've paid for, their Stripe customer id,
-- their complete package pricing, and two actual secrets: `zernioKey` (an
-- sk-gl- API key) and `stripeConnectState` (the anti-forgery token for the
-- Stripe Connect handshake).
--
-- It is written that way because five public pages — the quote page, booking
-- page, published websites, storefronts and the booking API — genuinely need a
-- business's name, logo and brand colour without anyone logging in.
--
-- THE FIX
-- Same pattern already used for quotes (`get_public_quote`): keep the table
-- private and expose one curated, security-definer function. Callers must know
-- a specific owner id, so nothing can be enumerated in bulk, and the secrets
-- are never in the returned payload at all.
--
-- ROLLOUT — run STEP 1 on its own first.
--   STEP 1 is additive. It creates the functions and changes nothing about
--          existing access, so it cannot break a live booking page.
--   Then deploy the application changes and click through a real published
--          site, a booking page, a storefront and a live quote.
--   STEP 2 is the switch that actually closes the hole. Run it only once
--          STEP 1 is deployed and verified. Rollback is at the bottom.


-- ══════════════════════════════════════════════════════════════════════
-- STEP 1 — APPLIED to production 2026-09-14. Additive only.
-- Verified: get_public_profile returns 27 public fields and withholds
-- zernioKey, stripeConnectAccountId, stripeConnectState, packages,
-- addonLibrary, taxRate/taxMode/currency, and the email, has_* and
-- stripe_customer_id columns.
-- ══════════════════════════════════════════════════════════════════════

-- The allowlist. Anything not named here is never returned to the public,
-- so a new secret added to profile_data later is private by default rather
-- than public by accident.
create or replace function public.public_profile_fields()
returns text[]
language sql
immutable
as $$
  select array[
    -- identity and branding
    'businessName','bizName','ownerName','ownerBio','bio','tagline','nicheLabel',
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
    'stripe100','stripe250','stripe500','stripe1000','stripeLinks','stripeConnectReady',
    'taxLabel','termsText','shopTemplate'
  ];
$$;

-- Deliberately NOT public, for the record: zernioKey, stripeConnectAccountId,
-- stripeConnectState, stripeConnectStateExpires, packages, addonLibrary,
-- autoContract, automation, smsEnabled, taxRate, taxMode, currency — plus the
-- columns email, has_paid, has_kpps_access, has_crm_access,
-- has_printables_access, stripe_customer_id and library_tier.

create or replace function public.get_public_profile(p_id uuid)
returns table (id uuid, full_name text, store_slug text, profile_data jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.full_name,
    p.store_slug,
    coalesce(
      (select jsonb_object_agg(e.key, e.value)
         from jsonb_each(coalesce(p.profile_data, '{}'::jsonb)) as e
        where e.key = any (public.public_profile_fields())),
      '{}'::jsonb
    )
  from public.profiles p
  where p.id = p_id;
$$;

-- Storefronts are addressed by slug, so the slug has to resolve to an id
-- without handing over the row behind it.
create or replace function public.get_public_profile_by_slug(p_slug text)
returns table (id uuid, full_name text, store_slug text, profile_data jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select g.*
  from public.profiles p
  cross join lateral public.get_public_profile(p.id) g
  where p.store_slug = p_slug
  limit 1;
$$;

revoke all on function public.get_public_profile(uuid) from public;
revoke all on function public.get_public_profile_by_slug(text) from public;
revoke all on function public.public_profile_fields() from public;
grant execute on function public.get_public_profile(uuid)        to anon, authenticated;
grant execute on function public.get_public_profile_by_slug(text) to anon, authenticated;
grant execute on function public.public_profile_fields()          to anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- STEP 2 — the switch. Run ONLY after STEP 1 is deployed and verified.
-- Uncomment the two statements below, then run this file again.
-- ══════════════════════════════════════════════════════════════════════

-- drop policy if exists "profiles: anon can read" on public.profiles;
-- revoke select on public.profiles from anon;

-- After STEP 2, an owner still has full access to her own row through the
-- existing "profiles: owner can do all" policy, and the server keeps its
-- service-role access. Only the anonymous blanket read goes away.


-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK — if a public page breaks, this restores the old behaviour
-- instantly. Safe to run at any time.
-- ══════════════════════════════════════════════════════════════════════

-- create policy "profiles: anon can read" on public.profiles
--   for select to anon using (true);
-- grant select on public.profiles to anon;
