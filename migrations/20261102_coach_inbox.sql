-- ═══════════════════════════════════════════════════════════════
-- Coach inbox: private 1-to-1 messages between a student and Monica
-- (inbox.html). Each student has one thread. Only that student and
-- the coach accounts can read it. Other students never see it.
-- ═══════════════════════════════════════════════════════════════
--
-- Run AFTER migrations/20261022_community.sql (it reuses
-- is_community_admin() and is_community_member()).
-- Safe to run more than once. Supabase → SQL Editor → New query → Run.

create extension if not exists pgcrypto;

-- ── 1. Table ─────────────────────────────────────────────────
-- student_id names the thread. sender_id is the student or a coach account.
create table if not exists public.coach_messages (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references auth.users(id) on delete cascade,
  sender_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists coach_messages_thread_idx on public.coach_messages (student_id, created_at);
create index if not exists coach_messages_unread_idx on public.coach_messages (student_id) where read_at is null;

-- ── 2. Guard rail ────────────────────────────────────────────
-- The server sets the time and starts every message unread. A student can
-- only write into her own thread, as herself.
create or replace function public.coach_messages_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  new.read_at    := null;
  if new.sender_id is distinct from auth.uid() then
    raise exception 'You can only send messages as yourself' using errcode = '42501';
  end if;
  if not public.is_community_admin() and new.student_id is distinct from auth.uid() then
    raise exception 'You can only write in your own conversation' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists coach_messages_guard on public.coach_messages;
create trigger coach_messages_guard
  before insert on public.coach_messages
  for each row execute function public.coach_messages_guard();

-- ── 3. Row level security ────────────────────────────────────
-- Read and send only. No update or delete from the browser: read receipts go
-- through coach_inbox_mark_read() below, so nobody can rewrite a message.
alter table public.coach_messages enable row level security;

revoke all on public.coach_messages from anon;
revoke all on public.coach_messages from authenticated;
grant select, insert on public.coach_messages to authenticated;

drop policy if exists "coach_messages: read own thread" on public.coach_messages;
drop policy if exists "coach_messages: send"            on public.coach_messages;

create policy "coach_messages: read own thread" on public.coach_messages
  for select to authenticated
  using (
    public.is_community_admin()
    or (student_id = auth.uid() and public.is_community_member())
  );

create policy "coach_messages: send" on public.coach_messages
  for insert to authenticated
  with check (
    public.is_community_member()
    and sender_id = auth.uid()
    and (student_id = auth.uid() or public.is_community_admin())
  );

-- ── 4. Read receipts ─────────────────────────────────────────
-- Marks the other side's messages in one thread as read. A student can only
-- mark her own thread; the coach can mark any thread.
create or replace function public.coach_inbox_mark_read(p_student uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  if not (public.is_community_admin() or (p_student = auth.uid() and public.is_community_member())) then
    return 0;
  end if;
  update public.coach_messages
     set read_at = now()
   where student_id = p_student
     and sender_id <> auth.uid()
     and read_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Unread count for the signed-in person: a student's unread replies from
-- Monica, or (for the coach) every unread student message.
create or replace function public.coach_inbox_unread()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_community_admin() then
      (select count(*)::int from public.coach_messages m where m.read_at is null and m.sender_id = m.student_id)
    when public.is_community_member() then
      (select count(*)::int from public.coach_messages m where m.student_id = auth.uid() and m.read_at is null and m.sender_id <> auth.uid())
    else 0
  end;
$$;

-- ── 5. Conversation list for the coach ───────────────────────
-- One row per student who has a thread, newest first. Coach only.
create or replace function public.coach_inbox_threads()
returns table (
  student_id uuid, name text, business text, email text,
  last_body text, last_at timestamptz, last_from_student boolean, unread integer
)
language sql
stable
security definer
set search_path = public
as $$
  with last as (
    select distinct on (m.student_id) m.student_id, m.body, m.created_at, (m.sender_id = m.student_id) as from_student
      from public.coach_messages m
     order by m.student_id, m.created_at desc
  ), unread as (
    select m.student_id, count(*)::int as n
      from public.coach_messages m
     where m.read_at is null and m.sender_id = m.student_id
     group by m.student_id
  )
  select
    l.student_id,
    nullif(split_part(btrim(coalesce(nullif(btrim(p.full_name), ''), p.profile_data ->> 'ownerName', '')), ' ', 1), ''),
    nullif(btrim(coalesce(p.profile_data ->> 'businessName', '')), ''),
    coalesce(u.email, p.email),
    left(l.body, 160),
    l.created_at,
    l.from_student,
    coalesce(un.n, 0)
  from last l
  left join public.profiles p on p.id = l.student_id
  left join auth.users u on u.id = l.student_id
  left join unread un on un.student_id = l.student_id
  where public.is_community_admin()
  order by l.created_at desc
  limit 500;
$$;

revoke all on function public.coach_inbox_mark_read(uuid) from public, anon;
revoke all on function public.coach_inbox_unread()        from public, anon;
revoke all on function public.coach_inbox_threads()       from public, anon;
grant execute on function public.coach_inbox_mark_read(uuid) to authenticated;
grant execute on function public.coach_inbox_unread()        to authenticated;
grant execute on function public.coach_inbox_threads()       to authenticated;

-- ── Verify ────────────────────────────────────────────────────
--   select relrowsecurity from pg_class where relname = 'coach_messages';           -- true
--   select policyname, cmd from pg_policies where tablename = 'coach_messages';     -- read + send
--   select has_table_privilege('anon', 'public.coach_messages', 'select');          -- false
-- Signed in as a student, inbox.html shows "Message Monica". Signed in as
-- Monica, it shows every conversation.
-- Rollback (deletes every private message):
--   drop table if exists public.coach_messages cascade;
--   drop function if exists public.coach_inbox_mark_read(uuid), public.coach_inbox_unread(), public.coach_inbox_threads();
