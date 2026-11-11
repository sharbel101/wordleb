-- Rolls back supabase/word-variants.sql. Removes ONLY objects that script created.
-- words, daily_puzzles, suggestions and every other table are untouched. Dropping word_variants
-- deletes the variant mappings you registered (take a copy first: select * from public.word_variants;).
-- Deploy the previous submit-guess function first (or it will simply see no variants: it tolerates a
-- missing table and carries on with canonical words only).

drop trigger if exists words_not_a_variant_trg on public.words;
drop trigger if exists word_variants_guard_trg on public.word_variants;

drop function if exists public.add_word_variant(text, text, text);
drop function if exists public.update_word_variant(text, text, text);
drop function if exists public.delete_word_variant(text);
drop function if exists public.list_word_variants(text);
drop function if exists public.word_variants_guard();
drop function if exists public.words_not_a_variant_guard();
drop function if exists public.check_word_variant(text, text, bigint);

drop table if exists public.word_variants;
