-- Rolls back supabase/suggestions-hardening.sql. Restores the public INSERT policy as it was
-- (word 1-30 characters, meaning 1-300 characters). Deletes no data.
alter table public.suggestions drop constraint if exists suggestions_word_rules;
alter table public.words drop constraint if exists words_max_two_digits;
alter table public.word_variants drop constraint if exists word_variants_max_two_digits;
drop index if exists public.suggestions_word_unique;
grant all on table public.suggestions to anon, authenticated;
drop policy if exists "Anyone can submit suggestions" on public.suggestions;
create policy "Anyone can submit suggestions" on public.suggestions
  for insert to anon, authenticated
  with check (char_length(word) between 1 and 30 and char_length(meaning) between 1 and 300);
-- (check_word_variant keeps the stricter digit rule; re-run supabase/word-variants.sql to restore the old body.)
