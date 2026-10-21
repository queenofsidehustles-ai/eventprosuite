-- ═══════════════════════════════════════════════════════════════
-- Community: the Kids Party Profit System student community
-- (community.html). Replaces the Skool group.
-- ═══════════════════════════════════════════════════════════════
--
-- Safe to run more than once. Run in Supabase → SQL Editor → New query → Run.
--
-- Who can see it: members only. A member is a profile with
-- has_kpps_access = true, plus Monica's two admin emails. Nothing here is
-- readable by anon (logged-out visitors), and members never read the
-- profiles table directly for author names: community_authors() returns
-- only first name, business name and an admin flag.

create extension if not exists pgcrypto;

-- ── 1. Who is a member, who is an admin ──────────────────────
create or replace function public.is_community_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in ('ggkidsspa@gmail.com', 'hello@bearhug.events');
$$;

create or replace function public.is_community_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_community_admin()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.has_kpps_access = true)
  );
$$;

revoke all on function public.is_community_admin()  from public, anon;
revoke all on function public.is_community_member() from public, anon;
grant execute on function public.is_community_admin()  to authenticated;
grant execute on function public.is_community_member() to authenticated;

-- ── 2. Tables ────────────────────────────────────────────────
create table if not exists public.community_posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  space       text not null check (space in ('announcements','introductions','checkins','questions','wins')),
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  -- Only photos uploaded to this project's public 'community' bucket.
  image_url   text check (image_url is null or image_url like 'https://dmqwoddwzpfnmpjtwiee.supabase.co/storage/v1/object/public/community/%'),
  launch_day  smallint check (launch_day is null or launch_day between 0 and 14),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table if not exists public.community_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.community_posts(id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 3000),
  created_at  timestamptz not null default now()
);

create table if not exists public.community_reactions (
  post_id     uuid not null references public.community_posts(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_posts_feed_idx     on public.community_posts (pinned desc, created_at desc);
create index if not exists community_posts_space_idx    on public.community_posts (space, pinned desc, created_at desc);
create index if not exists community_posts_author_idx   on public.community_posts (author_id);
create index if not exists community_comments_post_idx  on public.community_comments (post_id, created_at);
create index if not exists community_reactions_user_idx on public.community_reactions (user_id);

-- ── 3. Guard rails the policies can't express on their own ───
-- Only an admin may pin, post in Announcements, or move a post there.
-- Nobody can hand a post or comment to someone else.
create or replace function public.community_posts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_community_admin() then
    if tg_op = 'UPDATE' then
      new.author_id  := old.author_id;
      new.created_at := old.created_at;
      new.updated_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.pinned then raise exception 'Only the coach can pin posts' using errcode = '42501'; end if;
    if new.space = 'announcements' then raise exception 'Only the coach can post announcements' using errcode = '42501'; end if;
    new.created_at := now();
    new.updated_at := null;
  else
    if new.pinned is distinct from old.pinned then raise exception 'Only the coach can pin posts' using errcode = '42501'; end if;
    if new.space is distinct from old.space and new.space = 'announcements' then
      raise exception 'Only the coach can post announcements' using errcode = '42501';
    end if;
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists community_posts_guard on public.community_posts;
create trigger community_posts_guard
  before insert or update on public.community_posts
  for each row execute function public.community_posts_guard();

create or replace function public.community_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.author_id  := old.author_id;
    new.post_id    := old.post_id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists community_comments_guard on public.community_comments;
create trigger community_comments_guard
  before insert or update on public.community_comments
  for each row execute function public.community_comments_guard();

-- ── 4. Row level security ────────────────────────────────────
alter table public.community_posts     enable row level security;
alter table public.community_comments  enable row level security;
alter table public.community_reactions enable row level security;

revoke all on public.community_posts     from anon;
revoke all on public.community_comments  from anon;
revoke all on public.community_reactions from anon;
grant select, insert, update, delete on public.community_posts     to authenticated;
grant select, insert, update, delete on public.community_comments  to authenticated;
grant select, insert, delete         on public.community_reactions to authenticated;

-- Posts
drop policy if exists "community_posts: members read"   on public.community_posts;
drop policy if exists "community_posts: members post"   on public.community_posts;
drop policy if exists "community_posts: edit own"       on public.community_posts;
drop policy if exists "community_posts: delete own"     on public.community_posts;

create policy "community_posts: members read" on public.community_posts
  for select to authenticated
  using (public.is_community_member());

create policy "community_posts: members post" on public.community_posts
  for insert to authenticated
  with check (
    public.is_community_member()
    and author_id = auth.uid()
    and (space <> 'announcements' or public.is_community_admin())
    and (pinned = false or public.is_community_admin())
  );

create policy "community_posts: edit own" on public.community_posts
  for update to authenticated
  using ((author_id = auth.uid() and public.is_community_member()) or public.is_community_admin())
  with check ((author_id = auth.uid() and public.is_community_member()) or public.is_community_admin());

create policy "community_posts: delete own" on public.community_posts
  for delete to authenticated
  using ((author_id = auth.uid() and public.is_community_member()) or public.is_community_admin());

-- Comments
drop policy if exists "community_comments: members read" on public.community_comments;
drop policy if exists "community_comments: members post" on public.community_comments;
drop policy if exists "community_comments: edit own"     on public.community_comments;
drop policy if exists "community_comments: delete own"   on public.community_comments;

create policy "community_comments: members read" on public.community_comments
  for select to authenticated
  using (public.is_community_member());

create policy "community_comments: members post" on public.community_comments
  for insert to authenticated
  with check (public.is_community_member() and author_id = auth.uid());

create policy "community_comments: edit own" on public.community_comments
  for update to authenticated
  using ((author_id = auth.uid() and public.is_community_member()) or public.is_community_admin())
  with check ((author_id = auth.uid() and public.is_community_member()) or public.is_community_admin());

create policy "community_comments: delete own" on public.community_comments
  for delete to authenticated
  using ((author_id = auth.uid() and public.is_community_member()) or public.is_community_admin());

-- Reactions (one heart per member per post)
drop policy if exists "community_reactions: members read" on public.community_reactions;
drop policy if exists "community_reactions: add own"      on public.community_reactions;
drop policy if exists "community_reactions: remove own"   on public.community_reactions;

create policy "community_reactions: members read" on public.community_reactions
  for select to authenticated
  using (public.is_community_member());

create policy "community_reactions: add own" on public.community_reactions
  for insert to authenticated
  with check (public.is_community_member() and user_id = auth.uid());

create policy "community_reactions: remove own" on public.community_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ── 5. Author names for the feed ─────────────────────────────
-- First name, business name and an admin flag. Nothing else, members only.
create or replace function public.community_authors(ids uuid[])
returns table (id uuid, name text, business text, is_admin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    nullif(split_part(btrim(coalesce(nullif(btrim(p.full_name), ''), p.profile_data ->> 'ownerName', '')), ' ', 1), '') as name,
    nullif(btrim(coalesce(p.profile_data ->> 'businessName', '')), '') as business,
    lower(coalesce(u.email, '')) in ('ggkidsspa@gmail.com', 'hello@bearhug.events') as is_admin
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_community_member()
    and p.id = any (ids[1:200]);
$$;

revoke all on function public.community_authors(uuid[]) from public, anon;
grant execute on function public.community_authors(uuid[]) to authenticated;

-- ── 6. Photos: public bucket 'community' ─────────────────────
-- Public read (the bucket is public, so no select policy is needed and the
-- bucket can't be listed). Members upload only into a folder named after
-- their own user id, and can delete only their own files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "community photos: members upload own folder" on storage.objects;
drop policy if exists "community photos: delete own"                on storage.objects;

create policy "community photos: members upload own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'community'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_community_member()
  );

create policy "community photos: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'community'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Verify ────────────────────────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('community_posts','community_comments','community_reactions');   -- all true
--   select policyname, tablename, cmd from pg_policies
--    where tablename like 'community_%' or policyname like 'community photos%' order by 2, 1;
--   select id, public, file_size_limit from storage.buckets where id = 'community';      -- public = true
--   select has_table_privilege('anon', 'public.community_posts', 'select');             -- false
--   select count(*) from public.community_posts;
-- Signed in as a student in the app, community.html should load the feed.
-- Rollback (deletes every post, comment and heart):
--   drop table if exists public.community_reactions, public.community_comments, public.community_posts cascade;
