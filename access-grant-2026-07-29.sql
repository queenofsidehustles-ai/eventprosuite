-- ============================================================
-- Party Biz Hub — CRM access grant (2026-07-29)
-- Run this in Supabase → SQL Editor BEFORE deploying the CRM lock
-- to app/assistant/content/contract/prep/profit/vendors.
-- Safe to run more than once.
--
-- Context: the lock redirects anyone without has_crm_access or
-- has_kpps_access to store.html. An audit on 2026-07-29 found 7
-- accounts that would have been redirected. All 7 are approved to
-- keep access.
--
-- We grant has_crm_access (not has_kpps_access) on purpose:
--   has_crm_access  → unlocks exactly the CRM tools + website builder
--   has_kpps_access → ALSO unlocks KPPS-tier content in dashboard.html
--                     and store.html (the isPPPOnly checks)
-- Granting has_kpps_access here would hand out course/store tiers
-- these accounts may not have bought.
-- ============================================================

-- 1) Grant CRM access to the 7 approved accounts
update profiles
set has_crm_access = true
where lower(email) in (
  'crownluxury11@gmail.com',
  'crownluxurytravel11@gmail.com',      -- Dazzle and Shine Maids
  'caringforyou19@gmail.com',           -- Monica Lewis
  'yaamansallc@gmail.com',              -- FAITH GROUP HOME
  'nyawlewis72@gmail.com',              -- Glitz and Glam Kids Mobile Spa
  'prideacademicsolutions@gmail.com',
  'kymberlijoiner09@gmail.com'          -- note: NOT kymberlifelton19@gmail.com
);

-- ============================================================
-- 2) VERIFY — this SELECT must return ZERO rows before you deploy.
--    Any row returned is an account that will be bounced to store.html.
-- ============================================================
select email,
       coalesce(has_kpps_access,false)       as kpps,
       coalesce(has_crm_access,false)        as crm,
       coalesce(has_printables_access,false) as printables
from profiles
where coalesce(has_kpps_access,false) = false
  and coalesce(has_crm_access,false)  = false
order by email;

-- ============================================================
-- To grant access to someone later:
--    update profiles set has_crm_access = true
--    where lower(email) = 'their@email.com';
--
-- To revoke:
--    update profiles set has_crm_access = false
--    where lower(email) = 'their@email.com';
-- ============================================================
