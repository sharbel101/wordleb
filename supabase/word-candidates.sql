-- "Grow the word list from play" for WordleB. Run once in the Supabase SQL editor.
-- It only ADDS one table and two functions; words, daily_puzzles and suggestions are untouched
-- (it only reads `words` to know which guesses are already approved).
--
-- How it works: every time a player guesses a word that is NOT an approved word, submit-guess
-- records "this anonymous player tried this word" here. Words that several different players
-- tried float to the top of word_candidates(), and approve_word() adds one to your dictionary.

create table if not exists public.guess_log (
  word       text        not null check (word ~ '^[a-z0-9]{5}$'),
  player_id  uuid        not null,
  first_seen timestamptz not null default now(),
  primary key (word, player_id)
);

-- Locked down like your other tables: row level security on and no policies, so the public (anon)
-- key can neither read nor write it. Only the Edge Functions (service role) can.
alter table public.guess_log enable row level security;
revoke all on table public.guess_log from anon, authenticated;

-- Words that at least p_min_players different players tried and that are not in `words` yet
-- (approved or not). Most popular first.
create or replace function public.word_candidates(p_min_players int default 3)
returns table (word text, players bigint, last_seen timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select g.word, count(*) as players, max(g.first_seen) as last_seen
  from public.guess_log g
  where not exists (select 1 from public.words w where lower(w.word) = g.word)
  group by g.word
  having count(*) >= p_min_players
  order by count(*) desc, max(g.first_seen) desc
  limit 200;
$$;

-- Adds a word to the dictionary as approved (or approves it if it is already there).
-- Meaning and Arabic spelling are optional; they only matter when a word becomes a daily answer.
create or replace function public.approve_word(
  p_word text,
  p_meaning text default null,
  p_arabic text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.words (word, meaning, arabic_spelling, approved)
  select lower(p_word), p_meaning, p_arabic, true
  where not exists (select 1 from public.words where lower(word) = lower(p_word));

  update public.words set approved = true where lower(word) = lower(p_word);
$$;

revoke all on function public.word_candidates(int) from public, anon, authenticated;
revoke all on function public.approve_word(text, text, text) from public, anon, authenticated;
grant execute on function public.word_candidates(int) to service_role;
grant execute on function public.approve_word(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Everyday use (run these in the SQL editor, which has the needed permissions):
--
--   -- See what players are trying (3+ different players), most popular first:
--   select * from public.word_candidates(3);
--
--   -- Approve one, optionally with a meaning and Arabic spelling:
--   select public.approve_word('mnaqo', 'a meaning', 'مناقو');
--
--   -- Approve every candidate that 5+ players tried (review the list first!):
--   select public.approve_word(word) from public.word_candidates(5);
--
--   -- Tidy up: forget log rows for words that are now in the dictionary:
--   delete from public.guess_log where word in (select lower(word) from public.words);
-- ---------------------------------------------------------------------------

-- Check: should run without error and return no rows yet.
select * from public.word_candidates(3);
