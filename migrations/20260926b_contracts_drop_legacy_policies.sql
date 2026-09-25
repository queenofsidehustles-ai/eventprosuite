-- ═══════════════════════════════════════════════════════════════
-- STILL LEAKING: an older policy is overriding the new ones
-- ═══════════════════════════════════════════════════════════════
--
-- 20260926_lock_down_contracts.sql turned RLS on and added owner-only
-- policies, and the table is STILL readable by the public anon key:
--
--   curl "$SUPA/rest/v1/contracts?select=id" -H "apikey: <public key>"
--   content-range: 0-0/10
--
-- Because Postgres policies are OR'd together. Adding a strict policy does
-- not remove a permissive one — any single policy that matches grants the
-- row. This table already had a policy allowing anyone to read, and the
-- first migration only dropped the four names it was about to create, so
-- that older one survived and still allows everything.
--
-- This drops EVERY policy on the table by looking them up, rather than
-- guessing names, then recreates only the owner-only four. The names it
-- removed are printed so there is a record of what was there.
--
-- Run in Supabase → SQL Editor → New query → Run, and send back the NOTICE
-- lines it prints.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  pol record;
  dropped int := 0;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'contracts'
  loop
    raise notice 'dropping contracts policy: %', pol.policyname;
    execute format('drop policy if exists %I on public.contracts', pol.policyname);
    dropped := dropped + 1;
  end loop;
  raise notice 'dropped % polic(y/ies) on public.contracts', dropped;
end $$;

alter table public.contracts enable row level security;

-- The owner, and only the owner. The signing page does not need a policy:
-- get_contract_for_signing and sign_contract_with_token are security
-- definer, so they run past RLS with the signing token as the only key.
create policy contracts_owner_select on public.contracts
  for select using (auth.uid() = user_id);
create policy contracts_owner_insert on public.contracts
  for insert with check (auth.uid() = user_id);
create policy contracts_owner_update on public.contracts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy contracts_owner_delete on public.contracts
  for delete using (auth.uid() = user_id);

-- ── Verify, in this same editor ───────────────────────────────
-- Should list exactly the four contracts_owner_* policies and nothing else:
--
--   select policyname, cmd, roles, qual
--     from pg_policies where tablename = 'contracts';
--
-- And anonymously, this must now return no rows at all:
--   curl "$SUPA/rest/v1/contracts?select=id" -H "apikey: <anon key>"
