-- ============================================================
-- Blip's Big Adventure — high score leaderboard
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query
-- -> paste this whole file -> Run.
--
-- Design:
--   * `high_scores` holds ONE row per player name (their best score
--     only), not a full history of every run.
--   * Row Level Security is enabled with only a public SELECT policy,
--     so anyone can read the leaderboard but nobody can write to the
--     table directly with the anon key.
--   * All writes go through the `submit_high_score` function, which
--     is SECURITY DEFINER (runs with elevated rights) and only ever
--     raises a player's stored score — it never lowers it. The anon
--     key is granted EXECUTE on this function only, not table access.
-- ============================================================

create table if not exists public.high_scores (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(trim(name)) between 1 and 20),
  score       integer not null check (score >= 0 and score <= 500),
  updated_at  timestamptz not null default now(),
  constraint high_scores_name_unique unique (name)
);

create index if not exists high_scores_score_idx on public.high_scores (score desc);

alter table public.high_scores enable row level security;

-- Anyone (the game's anon key) can read the leaderboard.
drop policy if exists "Public read access" on public.high_scores;
create policy "Public read access"
  on public.high_scores
  for select
  using (true);

-- No insert/update/delete policies are defined on purpose — all writes
-- must go through submit_high_score() below.

create or replace function public.submit_high_score(p_name text, p_score integer)
returns table (name text, score integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_name is null or char_length(trim(p_name)) < 1 or char_length(trim(p_name)) > 20 then
    raise exception 'invalid name';
  end if;
  if p_score is null or p_score < 0 or p_score > 500 then
    raise exception 'invalid score';
  end if;

  insert into public.high_scores as h (name, score)
  values (trim(p_name), p_score)
  on conflict (name) do update
    set score = excluded.score,
        updated_at = now()
    where excluded.score > h.score;

  return query
    select h.name, h.score from public.high_scores h where h.name = trim(p_name);
end;
$$;

-- Let the anon (public, unauthenticated) role call the function, but
-- keep direct table writes locked down.
grant execute on function public.submit_high_score(text, integer) to anon;
grant execute on function public.submit_high_score(text, integer) to authenticated;
