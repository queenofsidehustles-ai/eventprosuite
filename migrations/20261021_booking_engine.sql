-- ═══════════════════════════════════════════════════════════════
-- Booking engine: quote follow-ups, after-party thank-yous and
-- birthday reminders (all run from api/send-reminders.js, daily).
-- ═══════════════════════════════════════════════════════════════
--
-- Safe to run more than once. Run in Supabase → SQL Editor → New query → Run.
--
-- birthday_list is owner-only under RLS. Public sign-up forms never write to
-- it directly: they POST to /api/lead-capture (kind 'birthday'), which checks
-- consent, rate-limits and inserts with the service key. So there are
-- deliberately NO anon policies here.

create extension if not exists pgcrypto;

-- ── 1. The birthday list ──────────────────────────────────────
create table if not exists public.birthday_list (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,
  parent_name        text,
  email              text,
  phone              text,
  child_name         text,
  birth_month        smallint not null check (birth_month between 1 and 12),
  birth_day          smallint not null check (birth_day between 1 and 31),
  source             text,
  consent            boolean not null default false,
  unsubscribed       boolean not null default false,
  last_reminded_year smallint,
  created_at         timestamptz not null default now()
);

create index if not exists birthday_list_owner_idx on public.birthday_list (owner_id);
-- The daily cron looks rows up by month.
create index if not exists birthday_list_month_idx on public.birthday_list (birth_month)
  where unsubscribed = false and consent = true;

alter table public.birthday_list enable row level security;

drop policy if exists "birthday_list: owner select" on public.birthday_list;
drop policy if exists "birthday_list: owner insert" on public.birthday_list;
drop policy if exists "birthday_list: owner update" on public.birthday_list;
drop policy if exists "birthday_list: owner delete" on public.birthday_list;

create policy "birthday_list: owner select" on public.birthday_list
  for select to authenticated using (owner_id = auth.uid());
create policy "birthday_list: owner insert" on public.birthday_list
  for insert to authenticated with check (owner_id = auth.uid());
create policy "birthday_list: owner update" on public.birthday_list
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "birthday_list: owner delete" on public.birthday_list
  for delete to authenticated using (owner_id = auth.uid());

-- ── 2. Quote follow-up tracking ───────────────────────────────
alter table public.saved_quotes
  add column if not exists followups_sent smallint not null default 0;
alter table public.saved_quotes
  add column if not exists last_followup_at timestamptz;

-- ── 3. After-party thank-you tracking ─────────────────────────
alter table public.bookings
  add column if not exists after_party_sent timestamptz;

-- ── 4. Private settings (her own Twilio keys) ─────────────────
-- Kept out of profiles.profile_data, which other signed-in users can read.
create table if not exists public.private_settings (
  owner_id   uuid primary key references auth.users(id) on delete cascade,
  twilio     jsonb,
  updated_at timestamptz not null default now()
);
alter table public.private_settings enable row level security;
revoke all on public.private_settings from anon;
drop policy if exists "private_settings: owner all" on public.private_settings;
create policy "private_settings: owner all" on public.private_settings
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ── Verify ────────────────────────────────────────────────────
--   select count(*) from public.birthday_list;
--   select id, followups_sent, last_followup_at from public.saved_quotes order by created_at desc limit 5;
--   select id, event_date, after_party_sent from public.bookings order by event_date desc limit 5;
