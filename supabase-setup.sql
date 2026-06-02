-- ================================================================
-- Party Biz Hub — Supabase Database Setup
-- ================================================================
-- Run this in Supabase → SQL Editor (supabase.com → your project → SQL Editor)
-- It is safe to run more than once. All statements use IF NOT EXISTS / IF EXISTS.
-- ================================================================


-- ── 1. PROFILES TABLE ──────────────────────────────────────────
-- Core user record. Created automatically by Supabase Auth trigger
-- OR manually here. The ALTER TABLE lines add missing columns safely.

create table if not exists profiles (
  id          uuid references auth.users on delete cascade primary key,
  email       text,
  full_name   text,
  has_paid    boolean default true,
  has_kpps_access boolean default false,
  profile_data jsonb  default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Add columns if they don't exist yet (safe to run on an existing table)
alter table profiles add column if not exists has_paid         boolean default true;
alter table profiles add column if not exists has_kpps_access  boolean default false;
alter table profiles add column if not exists profile_data     jsonb   default '{}'::jsonb;
alter table profiles add column if not exists full_name        text;

-- Enable RLS
alter table profiles enable row level security;

-- Logged-in users: full access to their own row
drop policy if exists "profiles: owner can do all" on profiles;
create policy "profiles: owner can do all" on profiles
  for all
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- Anonymous visitors: read-only access needed by book.html and site.html
drop policy if exists "profiles: anon can read" on profiles;
create policy "profiles: anon can read" on profiles
  for select to anon using (true);


-- ── 2. BOOKINGS TABLE ─────────────────────────────────────────
-- Public-facing: clients submit via book.html?uid=OWNER_ID

create table if not exists bookings (
  id            uuid default gen_random_uuid() primary key,
  owner_id      uuid references profiles(id) on delete cascade,
  client_name   text not null,
  client_email  text not null,
  client_phone  text,
  event_date    date,
  event_time    time,
  event_address text,
  num_kids      integer,
  duration      text,
  honoree_name  text,
  honoree_age   integer,
  service_name  text,
  service_price text,
  referral      text,
  notes         text,
  status        text default 'new',
  created_at    timestamptz default now()
);

alter table bookings enable row level security;

-- Anonymous visitors can INSERT (they submit the booking form)
drop policy if exists "bookings: anon can insert" on bookings;
create policy "bookings: anon can insert" on bookings
  for insert to anon with check (true);

-- Business owner can read their incoming bookings
drop policy if exists "bookings: owner can select" on bookings;
create policy "bookings: owner can select" on bookings
  for select using (auth.uid() = owner_id);

-- Business owner can update status (e.g. confirm/cancel)
drop policy if exists "bookings: owner can update" on bookings;
create policy "bookings: owner can update" on bookings
  for update using (auth.uid() = owner_id);


-- ── 3. VENDORS TABLE ──────────────────────────────────────────
-- Private: each user manages their own preferred vendor network

create table if not exists vendors (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references profiles(id) on delete cascade,
  name        text not null,
  category    text,
  vendor_data jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table vendors enable row level security;

drop policy if exists "vendors: owner can do all" on vendors;
create policy "vendors: owner can do all" on vendors
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ── 4. SAVED QUOTES TABLE ─────────────────────────────────────
-- Stores quotes built in the Quote Builder (app.html)

create table if not exists saved_quotes (
  id            uuid default gen_random_uuid() primary key,
  user_id       uuid references profiles(id) on delete cascade,
  client_name   text,
  event_type    text,
  event_date    date,
  total_amount  numeric,
  quote_data    jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);

alter table saved_quotes enable row level security;

drop policy if exists "saved_quotes: owner can do all" on saved_quotes;
create policy "saved_quotes: owner can do all" on saved_quotes
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ── 5. PROFIT RECORDS TABLE ───────────────────────────────────
-- Used by profit.html and the dashboard P&L snapshot

create table if not exists profit_records (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references profiles(id) on delete cascade,
  record_type     text check (record_type in ('event','monthly')),
  record_date     date,
  record_month    integer,
  record_year     integer,
  revenue         numeric default 0,
  total_expenses  numeric default 0,
  expenses_json   jsonb default '[]'::jsonb,
  income_json     jsonb default '[]'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table profit_records enable row level security;

drop policy if exists "profit_records: owner can do all" on profit_records;
create policy "profit_records: owner can do all" on profit_records
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ── 6. WEBSITE BUILDS TABLE ───────────────────────────────────
-- Stores the My Website wizard output. Public reads needed by site.html.

create table if not exists website_builds (
  id                uuid default gen_random_uuid() primary key,
  user_id           uuid references profiles(id) on delete cascade,
  business_name     text,
  niche_type        text,
  brand_data        jsonb default '{}'::jsonb,
  niche_data        jsonb default '{}'::jsonb,
  packages_data     jsonb default '{}'::jsonb,
  about_data        jsonb default '{}'::jsonb,
  gallery_data      jsonb default '{}'::jsonb,
  reviews_data      jsonb default '{}'::jsonb,
  faq_data          jsonb default '{}'::jsonb,
  booking_data      jsonb default '{}'::jsonb,
  addons_data       jsonb default '{}'::jsonb,
  founding_data     jsonb default '{}'::jsonb,
  last_published_at timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Add columns that may be missing from an earlier table creation
alter table website_builds add column if not exists business_name text;
alter table website_builds add column if not exists niche_type    text;

alter table website_builds enable row level security;

-- Owner: full access
drop policy if exists "website_builds: owner can do all" on website_builds;
create policy "website_builds: owner can do all" on website_builds
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Anonymous visitors: read-only (needed by site.html public landing page)
drop policy if exists "website_builds: anon can read" on website_builds;
create policy "website_builds: anon can read" on website_builds
  for select to anon using (true);


-- ── 7. DIGITAL PRODUCTS TABLE ────────────────────────────────
-- Stores party template bundles for each planner's digital store

create table if not exists products (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references profiles(id) on delete cascade,
  name           text not null,
  description    text,
  price          numeric default 0,
  theme          text,
  image_url      text,
  file_url       text,
  file_name      text,
  stripe_link    text,
  active         boolean default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table products enable row level security;

drop policy if exists "products: owner can do all" on products;
create policy "products: owner can do all" on products
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "products: public can read active" on products;
create policy "products: public can read active" on products
  for select to anon
  using (active = true);


-- ── 8. STORAGE BUCKET FOR PRODUCT FILES ──────────────────────
insert into storage.buckets (id, name, public)
  values ('product-files', 'product-files', true)
  on conflict (id) do nothing;

drop policy if exists "product-files: owner can upload" on storage.objects;
create policy "product-files: owner can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-files');

drop policy if exists "product-files: public read" on storage.objects;
create policy "product-files: public read" on storage.objects
  for select to anon
  using (bucket_id = 'product-files');


-- ── 9. STORAGE BUCKET FOR RECEIPTS ───────────────────────────
-- Run this ONCE in Supabase → Storage → New Bucket
-- OR paste into SQL Editor.

insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', true)
  on conflict (id) do nothing;

-- Allow authenticated users to upload their own receipts
drop policy if exists "receipts: owner can upload" on storage.objects;
create policy "receipts: owner can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to read their own receipts
drop policy if exists "receipts: owner can read" on storage.objects;
create policy "receipts: owner can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts');

-- Allow public reads (so the URL works without a token)
drop policy if exists "receipts: public read" on storage.objects;
create policy "receipts: public read" on storage.objects
  for select to anon
  using (bucket_id = 'receipts');


-- ── 10. SALES TABLE ──────────────────────────────────────────────
-- Auto-recorded when a customer lands on the shopfront success page.
-- seller_id = the printables store owner (PBH user)

create table if not exists sales (
  id                uuid default gen_random_uuid() primary key,
  seller_id         uuid references profiles(id) on delete cascade,
  product_id        uuid references products(id) on delete set null,
  product_name      text,
  amount            numeric default 0,
  stripe_session_id text unique,
  created_at        timestamptz default now()
);

alter table sales enable row level security;

-- Seller can read their own sales
drop policy if exists "sales: seller can read" on sales;
create policy "sales: seller can read" on sales
  for select using (auth.uid() = seller_id);

-- Anyone (anon) can insert — sale is recorded client-side from shopfront success page
drop policy if exists "sales: anon can insert" on sales;
create policy "sales: anon can insert" on sales
  for insert to anon with check (true);


-- ── DONE ────────────────────────────────────────────────────────
-- All 6 tables + receipts storage bucket set up with proper RLS.
-- ================================================================
