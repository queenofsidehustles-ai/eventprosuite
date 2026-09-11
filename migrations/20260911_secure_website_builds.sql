-- Party Biz Hub Phase Zero security migration
--
-- Rollout requirement for the existing production project:
-- 1. Count current website_builds rows and export them before running this file.
-- 2. Confirm one existing student can save a draft while authenticated.
-- 3. Confirm a public visitor can read a published site but not an unpublished draft.
-- 4. Keep the transaction uncommitted until those checks pass in a staging copy.

begin;

alter table public.website_builds enable row level security;

drop policy if exists "website_builds: owner can do all" on public.website_builds;
drop policy if exists "website_builds: public can read published" on public.website_builds;
drop policy if exists "website_builds: anon can read" on public.website_builds;

create policy "website_builds: owner can do all"
on public.website_builds
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "website_builds: public can read published"
on public.website_builds
for select
to anon, authenticated
using (last_published_at is not null);

grant select on public.website_builds to anon;
grant select, insert, update, delete on public.website_builds to authenticated;

commit;
