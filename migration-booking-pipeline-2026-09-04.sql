-- ═══════════════════════════════════════════════════════════════
-- Booking pipeline: move status into the database
-- ═══════════════════════════════════════════════════════════════
--
-- Until now the dashboard kept every booking's status in the browser
-- (localStorage key `pbh_statuses`). It was never written to the database.
-- Three things broke as a result:
--
--   1. Statuses vanished when you opened the Hub on another device.
--   2. Clearing browser data wiped the whole pipeline.
--   3. The daily reminder cron (api/send-reminders.js) looks for bookings
--      with status 'deposit-paid' or 'confirmed'. Nothing ever wrote those
--      values, so it has never sent a single email, for any business.
--
-- This migration gives status a real home and adds the columns the
-- deposit-hold flow needs.
--
-- Safe to re-run. Run in Supabase -> SQL Editor.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. New columns ────────────────────────────────────────────

-- When the deposit hold lapses. Set when a customer books from a quote
-- page; null for website inquiries that haven't been quoted yet.
alter table public.bookings
  add column if not exists deposit_due_at timestamptz;

-- Stamped when the 24-hour "your date isn't held yet" nudge goes out,
-- so the cron never sends it twice.
alter table public.bookings
  add column if not exists deposit_reminder_sent timestamptz;

-- Which quote this booking came from, so the CRM can show the two together.
alter table public.bookings
  add column if not exists quote_id uuid;

-- Quotes need a status too — the dashboard lists quotes and bookings in one
-- pipeline, and quotes were defaulting to 'quote-sent' purely in the browser.
alter table public.saved_quotes
  add column if not exists status text default 'quote-sent';


-- ── 2. Normalise existing rows ────────────────────────────────
-- Bookings were inserted with status 'new'. In the dashboard's language a
-- brand-new booking that hasn't been quoted is an 'inquiry'.

update public.bookings
   set status = 'inquiry'
 where status is null or status = 'new';

update public.saved_quotes
   set status = 'quote-sent'
 where status is null;


-- ── 3. The status vocabulary ──────────────────────────────────
--   inquiry           website booking, not yet quoted
--   quote-sent        quote sent, customer hasn't booked
--   awaiting-deposit  picked a date, deposit not yet paid  <-- new
--   deposit-paid      deposit received, date is held
--   confirmed         booking confirmed
--   complete          event done
--   expired           deposit hold lapsed, date released   <-- new

alter table public.bookings  drop constraint if exists bookings_status_check;
alter table public.bookings
  add constraint bookings_status_check check (status in (
    'inquiry','quote-sent','awaiting-deposit',
    'deposit-paid','confirmed','complete','expired'
  ));

alter table public.saved_quotes drop constraint if exists saved_quotes_status_check;
alter table public.saved_quotes
  add constraint saved_quotes_status_check check (status in (
    'inquiry','quote-sent','awaiting-deposit',
    'deposit-paid','confirmed','complete','expired'
  ));


-- ── 4. Let a booking customer set their own status on booking ──
-- Anonymous visitors already INSERT bookings. They insert with
-- 'awaiting-deposit' when booking from a quote page, and 'inquiry' from the
-- website form. The existing insert policy allows this; no change needed.
-- Anonymous visitors still cannot read or update anyone's bookings.


-- ── 5. Speed up the daily cron ────────────────────────────────
create index if not exists bookings_status_idx        on public.bookings (status);
create index if not exists bookings_deposit_due_idx   on public.bookings (deposit_due_at)
  where deposit_due_at is not null;


-- ── Verify ────────────────────────────────────────────────────
-- select status, count(*) from public.bookings group by status order by 2 desc;
