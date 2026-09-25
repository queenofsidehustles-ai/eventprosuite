-- ═══════════════════════════════════════════════════════════════
-- URGENT: every contract was readable by anyone
-- ═══════════════════════════════════════════════════════════════
--
-- public.contracts had no row-level security. The anon key is printed in the
-- source of every page on partybizhub.com, so this returned every contract
-- belonging to every business on the platform:
--
--   curl "$SUPA/rest/v1/contracts?select=*" -H "apikey: <the public key>"
--
-- That is client names, email addresses, phone numbers, event addresses,
-- prices and signature images — for all of them. profiles and saved_quotes
-- were locked down in September; contracts were missed.
--
-- The signing page is public and must keep working, so it stops reading the
-- table directly and goes through two security-definer functions that take
-- the signing token. The token is a random UUID, so a contract is reachable
-- by whoever holds its link and by nobody else — the same shape as
-- get_public_quote.
--
-- Run this in Supabase → SQL Editor → New query → Run. Run it BEFORE
-- deploying, or the signing page will break: it is the deploy that switches
-- sign-contract.html over to these functions, and direct reads stop working
-- the moment RLS is on.
-- ═══════════════════════════════════════════════════════════════

alter table public.contracts enable row level security;

-- ── The owner, and only the owner ─────────────────────────────
drop policy if exists contracts_owner_select on public.contracts;
drop policy if exists contracts_owner_insert on public.contracts;
drop policy if exists contracts_owner_update on public.contracts;
drop policy if exists contracts_owner_delete on public.contracts;

create policy contracts_owner_select on public.contracts
  for select using (auth.uid() = user_id);
create policy contracts_owner_insert on public.contracts
  for insert with check (auth.uid() = user_id);
create policy contracts_owner_update on public.contracts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy contracts_owner_delete on public.contracts
  for delete using (auth.uid() = user_id);

-- Note: api/auto-contract.js writes with the service-role key, which bypasses
-- RLS, so automatic contracts keep being created.

-- ── One contract, for whoever holds its signing link ──────────
create or replace function public.get_contract_for_signing(p_token text)
returns setof public.contracts
language sql
stable
security definer
set search_path = public
as $$
  select * from public.contracts
   where p_token is not null and sign_token::text = p_token
   limit 1;
$$;

revoke all on function public.get_contract_for_signing(text) from public;
grant execute on function public.get_contract_for_signing(text) to anon, authenticated;

-- ── And a way for that person to sign it ──────────────────────
-- Only ever writes the customer's signature, and only onto a contract that
-- has not been signed yet, so a leaked link cannot overwrite a signature or
-- touch a price. The owner's counter-signature is not reachable from here.
create or replace function public.sign_contract_with_token(p_token text, p_signature jsonb)
returns setof public.contracts
language sql
volatile
security definer
set search_path = public
as $$
  update public.contracts
     set client_signature = p_signature,
         signed_at        = now(),
         status           = case when vendor_signature is not null
                                 then 'Fully Signed' else 'Client Signed' end
   where sign_token::text = p_token
     and client_signature is null
     and p_signature is not null
  returning *;
$$;

revoke all on function public.sign_contract_with_token(text, jsonb) from public;
grant execute on function public.sign_contract_with_token(text, jsonb) to anon, authenticated;

-- ── When the contract actually went out ───────────────────────
-- "Sent to Client" was set whether or not the email left the building, so
-- there was no way to tell a contract that reached the customer from one
-- that silently failed.
alter table public.contracts
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error   text;

-- ── Verify ────────────────────────────────────────────────────
-- 1. As an anonymous visitor this must now return NOTHING:
--      curl "$SUPA/rest/v1/contracts?select=id" -H "apikey: <anon key>"
-- 2. Signed in as the owner, Contract Center must still list every contract.
-- 3. A signing link must still open.
