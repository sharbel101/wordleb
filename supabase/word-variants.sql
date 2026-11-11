-- Spelling variants for WordleB.  >>> REVIEW BEFORE RUNNING <<<  (nothing here is applied yet)
--
-- A variant is another way to WRITE an existing dictionary word (REE7A / REEHA). It is not a
-- separate word: the server resolves a guessed variant to its canonical word, then scores that.
--
-- What this script does (all additive; no table, column, row or constraint is dropped or rewritten):
--   1. CREATE TABLE public.word_variants  (new, empty)
--   2. Two guard triggers: one on word_variants (normalise + validate), one on words (stop a word
--      from being added if it is already a registered variant). The words trigger only READS
--      word_variants; existing words rows are never touched.
--   3. Admin functions in the same style as approve_word(): callable by the service role only
--      (SQL editor / Edge Functions), never by the public API key.
--   4. RLS on, no policies, privileges revoked from anon and authenticated, like guess_log.
--
-- Safe to re-run (every statement is idempotent). To undo: supabase/word-variants-rollback.sql.

-- 1. Table ------------------------------------------------------------------------------------
create table if not exists public.word_variants (
  id             bigint generated always as identity primary key,
  canonical_word text        not null references public.words (word) on update cascade on delete cascade,
  variant        text        not null,
  variant_type   text        not null default 'other',
  created_at     timestamptz not null default now(),

  -- Same format rule as words.valid_word_format: exactly 5 characters, upper case, A-Z / 0-9.
  constraint word_variants_variant_format check (variant = upper(variant) and variant ~ '^[A-Z0-9]{5}$'),
  constraint word_variants_type_check
    check (variant_type in ('number_letter', 'vowel', 'regional', 'transliteration', 'other')),
  -- A canonical word is never registered as its own variant.
  constraint word_variants_not_self check (variant <> canonical_word),
  -- One spelling maps to exactly one canonical word, and cannot be registered twice.
  -- (This unique constraint is also the index that guess resolution looks variants up with.)
  constraint word_variants_variant_key unique (variant)
);

-- Lists the variants of a word (admin screens, cascades).
create index if not exists word_variants_canonical_idx on public.word_variants (canonical_word);

-- 2. Locked down like guess_log: RLS on, no policies, no public privileges ---------------------
alter table public.word_variants enable row level security;
revoke all on table public.word_variants from anon, authenticated;

-- 3. Validation (single source of truth for the trigger AND the admin dry-run) -----------------
-- Returns a list of human-readable problems; an empty list means the pair is acceptable.
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

create or replace function public.word_variants_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  problems text[];
begin
  new.canonical_word := upper(btrim(new.canonical_word));
  new.variant := upper(btrim(new.variant));
  problems := public.check_word_variant(new.canonical_word, new.variant, case when tg_op = 'UPDATE' then old.id end);
  if coalesce(array_length(problems, 1), 0) > 0 then
    raise exception '%', array_to_string(problems, ' ') using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists word_variants_guard_trg on public.word_variants;
create trigger word_variants_guard_trg
  before insert or update on public.word_variants
  for each row execute function public.word_variants_guard();

-- A word cannot be added to the dictionary if it is already a registered spelling variant.
-- (Reads word_variants only; existing words rows are not changed.)
create or replace function public.words_not_a_variant_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.word_variants where variant = upper(new.word)) then
    raise exception 'The word "%" is already registered as a spelling variant of another word. Delete that variant first.', new.word
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists words_not_a_variant_trg on public.words;
create trigger words_not_a_variant_trg
  before insert or update of word on public.words
  for each row execute function public.words_not_a_variant_guard();

-- 4. Admin functions (service role only, like approve_word) ------------------------------------
-- Dry run: select public.check_word_variant('REE7A', 'REEHA');   -> {} means "OK to add"
-- Add:     select public.add_word_variant('REE7A', 'REEHA', 'transliteration');
-- Edit:    select public.update_word_variant('REEHA', p_new_type => 'regional');
-- Delete:  select public.delete_word_variant('REEHA');
-- View:    select * from public.list_word_variants();   (or list_word_variants('REE7A'))

create or replace function public.add_word_variant(p_canonical text, p_variant text, p_type text default 'other')
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.word_variants (canonical_word, variant, variant_type)
  values (p_canonical, p_variant, coalesce(p_type, 'other'))
  returning id;
$$;

create or replace function public.update_word_variant(p_variant text, p_new_variant text default null, p_new_type text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.word_variants
     set variant = coalesce(p_new_variant, variant),
         variant_type = coalesce(p_new_type, variant_type)
   where variant = upper(btrim(p_variant));
  if not found then
    raise exception 'No variant "%" is registered.', p_variant using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.delete_word_variant(p_variant text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.word_variants where variant = upper(btrim(p_variant));
  if not found then
    raise exception 'No variant "%" is registered.', p_variant using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.list_word_variants(p_canonical text default null)
returns table (canonical_word text, variant text, variant_type text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.canonical_word, v.variant, v.variant_type, v.created_at
  from public.word_variants v
  where p_canonical is null or v.canonical_word = upper(btrim(p_canonical))
  order by v.canonical_word, v.variant;
$$;

-- Only the service role (and the table owner) may run any of these; never the public API key.
revoke all on function public.check_word_variant(text, text, bigint) from public, anon, authenticated;
revoke all on function public.word_variants_guard() from public, anon, authenticated;
revoke all on function public.words_not_a_variant_guard() from public, anon, authenticated;
revoke all on function public.add_word_variant(text, text, text) from public, anon, authenticated;
revoke all on function public.update_word_variant(text, text, text) from public, anon, authenticated;
revoke all on function public.delete_word_variant(text) from public, anon, authenticated;
revoke all on function public.list_word_variants(text) from public, anon, authenticated;
grant execute on function public.check_word_variant(text, text, bigint) to service_role;
grant execute on function public.add_word_variant(text, text, text) to service_role;
grant execute on function public.update_word_variant(text, text, text) to service_role;
grant execute on function public.delete_word_variant(text) to service_role;
grant execute on function public.list_word_variants(text) to service_role;

-- No variants are created automatically. After you review the audit, register the ones you approve,
-- for example (NOT run by this script):
--   select public.add_word_variant('REE7A', 'REEHA', 'number_letter');
--   select public.add_word_variant('BADDI', 'BADDE', 'vowel');
