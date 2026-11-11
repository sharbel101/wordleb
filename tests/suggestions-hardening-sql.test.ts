import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/** Runs the prepared hardening migration (on top of the applied variants migration) in an in-process Postgres. */
const read = (f: string) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8')

const FIXTURE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.words (word text primary key, meaning text not null, approved boolean not null default true,
    constraint valid_word_format check (word = upper(word) and word ~ '^[A-Z0-9]{5}$'));
  create table public.daily_puzzles (id bigint generated always as identity primary key, puzzle_date date not null unique, word text not null);
  create table public.suggestions (id bigint generated always as identity primary key, word text not null, meaning text,
    arabic_spelling text, example_sentence text, created_at timestamptz default now());
  alter table public.suggestions enable row level security;
  create policy "Anyone can submit suggestions" on public.suggestions for insert to anon, authenticated
    with check (char_length(word) between 1 and 30 and char_length(meaning) between 1 and 300);
`
let db: PGlite
const fails = async (sql: string) => {
  try {
    await db.exec(sql)
  } catch (e) {
    return (e as Error).message
  }
  throw new Error(`expected to fail: ${sql}`)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(FIXTURE)
  await db.exec(read('word-variants.sql'))
  await db.exec(`insert into public.words (word, meaning) values ('REE7A','smell'),('2AR3A','x'); insert into public.suggestions (word) values ('habla'),('7amra')`)
  await db.exec(read('suggestions-hardening.sql'))
  await db.exec(read('suggestions-hardening.sql')) // idempotent
})
afterAll(() => db.close())
beforeEach(() => db.exec('delete from public.word_variants'))

describe('suggestions hardening', () => {
  it('keeps every existing suggestion', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int n from public.suggestions')
    expect(r.rows[0].n).toBe(2)
  })

  it('removes the public way in: no policy, no privileges', async () => {
    expect((await db.query(`select 1 from pg_policies where tablename='suggestions'`)).rows).toHaveLength(0)
    for (const role of ['anon', 'authenticated']) {
      expect(await fails(`set role ${role}; insert into public.suggestions (word, meaning) values ('abcde','x');`)).toMatch(/permission denied/)
      await db.exec('reset role')
    }
  })

  it('still lets the Edge Function (service role) insert', async () => {
    await db.exec(`set role service_role; insert into public.suggestions (word) values ('kalbe'); reset role;`)
  })

  it('allows one record per word, whatever its capitalisation or spacing', async () => {
    expect(await fails(`insert into public.suggestions (word) values ('HABLA')`)).toMatch(/duplicate key|unique/)
    expect(await fails(`insert into public.suggestions (word) values (' habla ')`)).toMatch(/duplicate key|unique|violates check/)
  })

  it('enforces five characters and at most two numbers in the database itself', async () => {
    expect(await fails(`insert into public.suggestions (word) values ('abcd')`)).toMatch(/suggestions_word_rules/)
    expect(await fails(`insert into public.suggestions (word) values ('abcdef')`)).toMatch(/suggestions_word_rules/)
    expect(await fails(`insert into public.suggestions (word) values ('b235a')`)).toMatch(/suggestions_word_rules/)
    await db.exec(`insert into public.suggestions (word) values ('b23ca'), ('abcde')`)
  })

  it('applies the two-number limit to dictionary words and variants too', async () => {
    expect(await fails(`insert into public.words (word, meaning) values ('B235A','x')`)).toMatch(/words_max_two_digits/)
    await db.exec(`insert into public.words (word, meaning) values ('B23CA','x')`)
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A','R2E35')`)).toMatch(/more than 2 numbers|max_two_digits/)
  })

  it('tells the admin about the limit in the dry run', async () => {
    const r = await db.query<{ p: string[] }>(`select public.check_word_variant('REE7A','R2E35') p`)
    expect(r.rows[0].p.join(' ')).toMatch(/more than 2 numbers/)
    expect((await db.query<{ p: string[] }>(`select public.check_word_variant('REE7A','REEHA') p`)).rows[0].p).toEqual([])
  })

  it('the rollback undoes it without touching data', async () => {
    await db.exec(read('suggestions-hardening-rollback.sql'))
    await db.exec(`insert into public.suggestions (word) values ('B235A')`) // allowed again
    expect((await db.query(`select 1 from pg_policies where tablename='suggestions'`)).rows).toHaveLength(1)
    await db.exec(`delete from public.suggestions where word = 'B235A'`)
  })
})
