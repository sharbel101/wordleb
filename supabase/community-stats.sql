-- Community statistics for WordleB. Run once in the Supabase SQL editor.
-- It only ADDS one table and one function; it does not touch words, daily_puzzles or suggestions.
--
-- One row per finished game: which day, an anonymous random player id (generated in the
-- player's browser, not linked to any account or personal data), and how many guesses it took
-- (0 = did not solve). The primary key means each player is counted once per day.

create table if not exists public.daily_results (
  puzzle_date date        not null,
  player_id   uuid        not null,
  attempts    smallint    not null check (attempts between 0 and 6),
  created_at  timestamptz not null default now(),
  primary key (puzzle_date, player_id)
);

-- Locked down like your other tables: row level security on and no policies, so the public
-- (anon) key can neither read nor write it. Only the Edge Functions (service role) can.
alter table public.daily_results enable row level security;
revoke all on table public.daily_results from anon, authenticated;

-- Totals per result (0..6) for one day and for all days. Used by the get-community-stats function.
create or replace function public.community_stats(p_date date)
returns table (attempts smallint, players_today bigint, players_all_time bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.attempts,
    count(r.player_id) filter (where r.puzzle_date = p_date),
    count(r.player_id)
  from (select generate_series(0, 6)::smallint as attempts) n
  left join public.daily_results r on r.attempts = n.attempts
  group by n.attempts
  order by n.attempts;
$$;

-- Not callable through the public API; only the service role (Edge Functions) may run it.
revoke all on function public.community_stats(date) from public, anon, authenticated;
grant execute on function public.community_stats(date) to service_role;

-- Check: should return seven rows (0 to 6), all zeros until games are finished.
select * from public.community_stats(current_date);
