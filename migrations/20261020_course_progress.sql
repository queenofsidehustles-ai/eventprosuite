-- Your 14-Day Launch: one row per student per day.
create table if not exists public.course_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          smallint not null check (day between 0 and 30),
  checklist    jsonb not null default '[]'::jsonb,
  notes        jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.course_progress enable row level security;
create policy "course_progress: owner read"   on public.course_progress for select to authenticated using (user_id = auth.uid());
create policy "course_progress: owner insert" on public.course_progress for insert to authenticated with check (user_id = auth.uid());
create policy "course_progress: owner update" on public.course_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Monica can see every student's progress (for the "who's stuck" report).
create policy "course_progress: admin read"   on public.course_progress for select to authenticated using ((auth.jwt() ->> 'email') = 'ggkidsspa@gmail.com');
