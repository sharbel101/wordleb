-- Suggestion + dictionary hardening for WordleB.  >>> PREPARED, NOT APPLIED. Review first. <<<
--
-- Why: today anyone holding the public (anon) API key can INSERT straight into public.suggestions
-- through Supabase's REST endpoint ("Anyone can submit suggestions" policy), skipping every rule in the
-- submit-suggestion Edge Function (five characters, at most two numbers, already-in-dictionary check).
-- The function uses the service role, so it does not need that policy.
--
-- What this does (additive or tightening only; no row is deleted or changed):
--   1. Drops the public INSERT policy on suggestions and removes the public roles' table privileges.
--   2. One suggestion row per normalised word (unique index on upper(btrim(word))).
--      Verified against the live data: 562 rows, 562 distinct words, so the index can be created.
--   3. CHECK on suggestions.word: 5 characters A-Z/0-9, at most 2 digits (all 562 rows already comply).
--   4. CHECK on words.word and word_variants.variant: at most 2 digits (all existing rows comply).
--   5. check_word_variant() also reports "more than 2 numbers", so the admin dry run says so.
-- Safe to re-run. Rollback: supabase/suggestions-hardening-rollback.sql

-- 1. Only the Edge Function (service role) writes suggestions.
drop policy if exists "Anyone can submit suggestions" on public.suggestions;
revoke all on table public.suggestions from anon, authenticated;

-- 2. No duplicate suggestion records for the same word, however it was capitalised.
create unique index if not exists suggestions_word_unique on public.suggestions (upper(btrim(word)));

-- 3 & 4. A word has at most two numbers.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suggestions_word_rules') then
    alter table public.suggestions add constraint suggestions_word_rules
      check (btrim(word) ~ '^[A-Za-z0-9]{5}$' and length(regexp_replace(word, '[^0-9]', '', 'g')) <= 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_max_two_digits') then
    alter table public.words add constraint words_max_two_digits
      check (length(regexp_replace(word, '[^0-9]', '', 'g')) <= 2);
  end if;
  if to_regclass('public.word_variants') is not null
     and not exists (select 1 from pg_constraint where conname = 'word_variants_max_two_digits') then
    alter table public.word_variants add constraint word_variants_max_two_digits
      check (length(regexp_replace(variant, '[^0-9]', '', 'g')) <= 2);
  end if;
end $$;

-- 5. Admin dry run / guard: same function as word-variants.sql plus the digit rule.
create or replace function public.check_word_variant(p_canonical text, p_variant text, p_ignore_id bigint default null)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text := upper(btrim(coalesce(p_canonical, '')));
  v text := upper(btrim(coalesce(p_variant, '')));
  problems text[] := '{}';
  owner text;
begin
  if c !~ '^[A-Z0-9]{5}$' then
    problems := problems || format('The canonical word "%s" must be exactly 5 characters (A-Z or digits); it has %s.', c, length(c));
  elsif not exists (select 1 from public.words where word = c) then
    problems := problems || format('"%s" is not in the dictionary (words table), so it cannot have variants.', c);
  end if;

  if v !~ '^[A-Z0-9]{5}$' then
    problems := problems || format('The variant "%s" must be exactly 5 characters (A-Z or digits); it has %s.', v, length(v));
  else
    if length(regexp_replace(v, '[^0-9]', '', 'g')) > 2 then
      problems := problems || format('The variant "%s" has more than 2 numbers; a word can have at most 2.', v);
    end if;
    if v = c then
      problems := problems || 'A word cannot be registered as its own variant.';
    end if;
    if v <> c and exists (select 1 from public.words where word = v) then
      problems := problems || format('"%s" is already a dictionary word of its own, so it cannot also be a variant.', v);
    end if;
    select canonical_word into owner from public.word_variants
      where variant = v and (p_ignore_id is null or id <> p_ignore_id) limit 1;
    if found then
      problems := problems || case when owner = c
        then format('"%s" is already registered as a variant of "%s".', v, c)
        else format('"%s" is already a variant of "%s"; one spelling can map to only one word.', v, owner) end;
    end if;
    if exists (select 1 from public.daily_puzzles where upper(btrim(word)) = v) then
      problems := problems || format('"%s" is scheduled as a daily puzzle answer, so it cannot be a variant.', v);
    end if;
  end if;
  return problems;
end;
$$;
revoke all on function public.check_word_variant(text, text, bigint) from public, anon, authenticated;
grant execute on function public.check_word_variant(text, text, bigint) to service_role;
