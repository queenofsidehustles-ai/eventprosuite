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
-- The program launched in April 2026, so as of September 2026 no member is
-- anywhere near a year old. That means the honest backfill is simply the year
-- each of them actually bought: twelve months from the day their profile was
-- created, which the purchase webhook writes at checkout.
--
-- Nobody is cut short by this — the earliest dates land around April 2027 —
-- and everyone still gets the 30-day warning email first.
--
-- Uncomment and run it when you are ready.

-- update public.profiles
--    set crm_access_expires_at = created_at + interval '12 months'
--  where has_kpps_access = true
--    and crm_access_expires_at is null;

-- To see what it would do before running it, this changes nothing:
-- select email, created_at, created_at + interval '12 months' as hub_year_ends
--   from public.profiles
--  where has_kpps_access = true and crm_access_expires_at is null
--  order by created_at;


-- ROLLBACK — clears every expiry date, restoring permanent access.
-- update public.profiles set crm_access_expires_at = null;
