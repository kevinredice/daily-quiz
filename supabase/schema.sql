-- Daily Quiz schema
-- Run this in the Supabase SQL editor after creating a project.
-- All tables RLS-enabled and scoped per user.

-- === topics ===
create table public.topics (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null,
  context text not null,
  tags text[] default '{}',
  status text not null default 'active',
  times_quizzed int not null default 0,
  correct_count int not null default 0,
  incorrect_count int not null default 0,
  recent_results boolean[] default '{}',
  created_at timestamptz not null default now(),
  last_quizzed_at timestamptz,
  dormant_since timestamptz,
  primary key (id, user_id)
);

alter table public.topics enable row level security;

create policy "topics_select_own" on public.topics
  for select using (auth.uid() = user_id);
create policy "topics_insert_own" on public.topics
  for insert with check (auth.uid() = user_id);
create policy "topics_update_own" on public.topics
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "topics_delete_own" on public.topics
  for delete using (auth.uid() = user_id);

-- === quizzes ===
create table public.quizzes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,         -- YYYY-MM-DD, local calendar date
  questions jsonb not null,   -- full question objects
  responses jsonb default '{}',
  score int,
  completed_at timestamptz
);

create index quizzes_user_date on public.quizzes(user_id, date);

alter table public.quizzes enable row level security;

create policy "quizzes_select_own" on public.quizzes
  for select using (auth.uid() = user_id);
create policy "quizzes_insert_own" on public.quizzes
  for insert with check (auth.uid() = user_id);
create policy "quizzes_update_own" on public.quizzes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "quizzes_delete_own" on public.quizzes
  for delete using (auth.uid() = user_id);

-- === settings ===
create table public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_key text default '',
  last_streak_date text,
  current_streak int default 0,
  longest_streak int default 0
);

alter table public.settings enable row level security;

create policy "settings_select_own" on public.settings
  for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.settings
  for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
