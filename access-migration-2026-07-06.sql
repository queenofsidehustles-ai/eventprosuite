-- ============================================================
-- Party Biz Hub — Access keys migration (2026-07-06)
-- Run this in Supabase → SQL Editor BEFORE deploying the new lock.
-- Safe to run more than once.
-- ============================================================

-- 1) Add the new access columns
alter table profiles add column if not exists has_crm_access     boolean default false;
alter table profiles add column if not exists stripe_customer_id text;

-- 2) Give the existing $27/mo subscriber the CRM key (so she is NOT locked out)
update profiles set has_crm_access = true
  where lower(email) = 'kymberlifelton19@gmail.com';

-- 3) Give the Party Printables VIP full lifetime access (comped, like a KPPS student)
update profiles set has_kpps_access = true, has_printables_access = true
  where lower(email) = 'muldrowlatrice@gmail.com';

-- 4) Make sure the admin account keeps full access
update profiles set has_kpps_access = true
  where lower(email) = 'ggkidsspa@gmail.com';

-- ============================================================
-- SAFETY CHECK — run this SELECT and eyeball the results.
-- It lists everyone who will be treated as "printables-only"
-- (they will be blocked from the CRM tools). Make sure NO real
-- KPPS student or full-access person is in this list. If someone
-- is, give them access with:
--    update profiles set has_kpps_access = true where lower(email) = 'their@email.com';
-- ============================================================
-- select email, has_kpps_access, has_crm_access, has_printables_access, library_tier
-- from profiles
-- where coalesce(has_printables_access,false) = true
--   and coalesce(has_kpps_access,false)       = false
--   and coalesce(has_crm_access,false)        = false
-- order by email;
