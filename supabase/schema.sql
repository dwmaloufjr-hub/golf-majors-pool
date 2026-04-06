-- 2026 Majors Golf Auction Pool - Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

-- Users (extends Supabase auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text not null,
  created_at timestamptz default now()
);

-- Tournaments
create table public.tournaments (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  start_date date not null,
  draft_deadline timestamptz,
  sub_deadline timestamptz,
  status text not null default 'upcoming' check (status in ('upcoming', 'in_progress', 'completed')),
  created_at timestamptz default now()
);

-- Players (pricing locked at Masters odds)
create table public.players (
  id uuid primary key default uuid_generate_v4(),
  dg_id integer unique not null,
  name text not null,
  price integer not null,
  created_at timestamptz default now()
);

-- Rosters (draft picks and subs)
create table public.rosters (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  is_sub boolean default false,
  tournament_id uuid references public.tournaments(id) on delete cascade,
  created_at timestamptz default now()
);

-- Tournament Players (field + results per tournament)
create table public.tournament_players (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  in_field boolean default true,
  cut_made boolean,
  finish_position integer,
  total_points decimal default 0,
  unique (tournament_id, player_id)
);

-- Hole-by-hole Scores
create table public.scores (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  round integer not null check (round between 1 and 4),
  hole integer not null check (hole between 1 and 18),
  score_vs_par integer not null,
  points decimal not null default 0,
  created_at timestamptz default now(),
  unique (tournament_id, player_id, round, hole)
);

-- ============================================
-- INDEXES
-- ============================================

create index idx_rosters_user on public.rosters(user_id);
create index idx_rosters_player on public.rosters(player_id);
create index idx_tournament_players_tournament on public.tournament_players(tournament_id);
create index idx_tournament_players_player on public.tournament_players(player_id);
create index idx_scores_tournament_player on public.scores(tournament_id, player_id);
create index idx_scores_round on public.scores(tournament_id, player_id, round);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

alter table public.users enable row level security;
alter table public.tournaments enable row level security;
alter table public.players enable row level security;
alter table public.rosters enable row level security;
alter table public.tournament_players enable row level security;
alter table public.scores enable row level security;

-- Users: can read all, can update own
create policy "Users are viewable by everyone" on public.users for select using (true);
create policy "Users can update own record" on public.users for update using (auth.uid() = id);
create policy "Users can insert own record" on public.users for insert with check (auth.uid() = id);

-- Tournaments: readable by all, admin-only write (via service key)
create policy "Tournaments are viewable by everyone" on public.tournaments for select using (true);

-- Players: readable by all, admin-only write (via service key)
create policy "Players are viewable by everyone" on public.players for select using (true);

-- Rosters: users can read all (after draft deadline), can manage own
create policy "Rosters are viewable by everyone" on public.rosters for select using (true);
create policy "Users can insert own roster" on public.rosters for insert with check (auth.uid() = user_id);
create policy "Users can update own roster" on public.rosters for update using (auth.uid() = user_id);
create policy "Users can delete own roster" on public.rosters for delete using (auth.uid() = user_id);

-- Tournament Players: readable by all
create policy "Tournament players viewable by everyone" on public.tournament_players for select using (true);

-- Scores: readable by all
create policy "Scores are viewable by everyone" on public.scores for select using (true);

-- ============================================
-- SEED TOURNAMENTS
-- ============================================

insert into public.tournaments (name, start_date, draft_deadline, sub_deadline, status) values
  ('Masters', '2026-04-09', '2026-04-09 12:00:00+00', '2026-04-08 12:00:00+00', 'upcoming'),
  ('PGA Championship', '2026-05-14', null, '2026-05-13 12:00:00+00', 'upcoming'),
  ('U.S. Open', '2026-06-18', null, '2026-06-17 12:00:00+00', 'upcoming'),
  ('Open Championship', '2026-07-16', null, '2026-07-15 12:00:00+00', 'upcoming');
