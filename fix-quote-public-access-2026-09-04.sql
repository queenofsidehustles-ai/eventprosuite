-- ═══════════════════════════════════════════════════════════════
-- FIX: customers could never open their quote link
-- ═══════════════════════════════════════════════════════════════
--
-- saved_quotes RLS is owner-only:
--     using (auth.uid() = user_id)
--
-- view-quote.html is a PUBLIC page. The customer is not logged in, so
-- auth.uid() is null, so no row ever matches, so every customer who
-- clicked a quote link saw "Quote not found".
--
-- We do NOT fix this by opening saved_quotes to anon — that would let
-- anyone list every quote belonging to all 23 Party Biz Hub businesses
-- (client names, emails, prices).
--
-- Instead: one security-definer function that returns exactly ONE quote,
-- and only when the caller already knows its UUID. UUIDs aren't guessable,
-- so a quote is readable by whoever has the link and nobody else.
-- The table itself stays locked down.
--
-- Run this once in Supabase → SQL Editor → New query → Run.
-- ═══════════════════════════════════════════════════════════════

-- NOTE: `returns setof public.saved_quotes` inherits the table's real column
-- types instead of restating them. Production has drifted from the types in
-- supabase-setup.sql (event_date is text there, date in the setup file), and a
-- hand-written column list fails with 42P13 return-type-mismatch. This form
-- cannot drift.
create or replace function public.get_public_quote(quote_id uuid)
returns setof public.saved_quotes
language sql
stable
security definer
set search_path = public
as $$
  select * from public.saved_quotes where id = quote_id limit 1;
$$;

-- Only reachable through the function, and only one row at a time.
revoke all on function public.get_public_quote(uuid) from public;
grant execute on function public.get_public_quote(uuid) to anon, authenticated;


-- ── Verify ────────────────────────────────────────────────────
-- Paste a real quote id from your My Quotes tab and run this.
-- Before the fix: 0 rows. After: 1 row.
--
--   select * from public.get_public_quote('PASTE-QUOTE-ID-HERE');
