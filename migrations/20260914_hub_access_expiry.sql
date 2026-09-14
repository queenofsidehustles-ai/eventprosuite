-- Party Biz Hub — make the "included for one year" promise real
--
-- THE PROBLEM
-- partybusinesscoach.com sells KPPS as "$197 one-time · Lifetime training
-- access · Party Biz Hub included for one year", and says plainly: "You get it
-- bundled for a full year, then $27/month for as long as your membership
-- remains active."
--
-- The code never implemented the year. api/send-purchase-email.js sets
-- has_crm_access = true on a KPPS purchase and nothing ever revokes it, so
-- every KPPS buyer has the Hub free, permanently. At $27/month that is $324 of
-- subscription given away in year one and growing every year after.
--
-- This is not clawing anything back. It is delivering exactly what the sales
-- page already promises.
--
-- HOW IT WORKS
-- crm_access_expires_at is the date Hub access ends.
--   NULL  = no expiry. Monthly subscribers live here: they keep access while
--           they are subscribed, and cancelling revokes it the usual way.
--   a date = KPPS members. Set to twelve months from purchase.
--
-- The daily reminder cron warns them at 30, 7 and 1 days, then switches
-- has_crm_access off once the date passes. Their KPPS training access is
-- untouched — that really is for life.

alter table public.profiles
  add column if not exists crm_access_expires_at timestamptz;

comment on column public.profiles.crm_access_expires_at is
  'When bundled Party Biz Hub access ends. NULL means no expiry (monthly subscribers). KPPS purchases get purchase date + 12 months.';

-- Finding who is due to lapse runs daily, so it should not scan the table.
create index if not exists profiles_crm_access_expires_at_idx
  on public.profiles (crm_access_expires_at)
  where crm_access_expires_at is not null;


-- ══════════════════════════════════════════════════════════════════════
-- EXISTING MEMBERS — read this before running it
-- ══════════════════════════════════════════════════════════════════════
-- Everyone who already bought KPPS currently has no expiry date, so nothing
-- changes for them until you set one. That is deliberate: nobody should lose
-- access overnight because of a migration.
--
-- The block below gives every current KPPS member a fresh twelve months from
-- today. It is the generous reading — several of them are already past a year,
-- and cutting them off without warning would be a bad way to find that out.
-- They will get the 30-day warning email like everyone else.
--
-- Uncomment and run it when you have decided that is what you want.

-- update public.profiles
--    set crm_access_expires_at = now() + interval '12 months'
--  where has_kpps_access = true
--    and crm_access_expires_at is null;


-- ROLLBACK — clears every expiry date, restoring permanent access.
-- update public.profiles set crm_access_expires_at = null;
