-- ═══════════════════════════════════════════════════════════════
-- "Has she opened it yet?"
-- ═══════════════════════════════════════════════════════════════
--
-- A quote sent by text has no delivery receipt. Without this, an owner
-- cannot tell "she hasn't looked yet" from "she looked and is thinking",
-- which are two completely different follow-up messages.
--
-- viewed_at records the FIRST time the customer opened the link. It is
-- never overwritten, so it answers "did this reach her at all" rather
-- than "when did she last refresh".
--
-- Run once in Supabase → SQL Editor → New query → Run.
-- ═══════════════════════════════════════════════════════════════

alter table public.saved_quotes
  add column if not exists viewed_at timestamptz;

-- The customer is anonymous, and saved_quotes is owner-only under RLS, so
-- the stamp has to be written by a security-definer function — the same
-- shape as get_public_quote(). It takes a UUID the caller must already
-- know, touches exactly one row, and writes exactly one column.
create or replace function public.mark_quote_viewed(quote_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.saved_quotes
     set viewed_at = now()
   where id = quote_id
     and viewed_at is null;
$$;

revoke all on function public.mark_quote_viewed(uuid) from public;
grant execute on function public.mark_quote_viewed(uuid) to anon, authenticated;

-- ── Verify ────────────────────────────────────────────────────
-- Open one of your own quote links in a private window, then:
--
--   select client_name, viewed_at from public.saved_quotes
--    where viewed_at is not null order by viewed_at desc;
