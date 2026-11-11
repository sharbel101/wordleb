import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Runs the REAL migration (supabase/word-variants.sql) in an in-process Postgres, against stand-ins
 * for the existing tables (same constraints as production), so every database rule is tested without
 * touching Supabase.
 */
const MIGRATION = readFileSync(new URL('../supabase/word-variants.sql', import.meta.url), 'utf8')

const FIXTURE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase hands new tables and functions in public to these roles by default; mirror that so the
  -- migration's explicit REVOKEs are what is being tested.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create table public.words (
    word text primary key,
    meaning text not null,
    approved boolean not null default true,
    constraint valid_word_format check (word = upper(word) and word ~ '^[A-Z0-9]{5}$')
  );
  create table public.daily_puzzles (
    id bigint generated always as identity primary key,
    puzzle_date date not null unique,
    word text not null
  );
  create table public.suggestions (id bigint generated always as identity primary key, word text not null);
`

const SEED = `
  insert into public.words (word, meaning) values
    ('REE7A', 'smell'), ('BADDI', 'I want'), ('HAMRA', 'red'), ('SA7EN', 'plate');
  insert into public.daily_puzzles (puzzle_date, word) values ('2026-11-20', 'FARED');
`

let db: PGlite

async function fails(sql: string): Promise<string> {
  try {
    await db.exec(sql)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error(`expected this to fail: ${sql}`)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(FIXTURE)
  await db.exec(MIGRATION)
  // The migration must be safe to run twice.
  await db.exec(MIGRATION)
})

afterAll(() => db.close())

beforeEach(async () => {
  await db.exec('delete from public.word_variants; delete from public.words; delete from public.daily_puzzles;')
  await db.exec(SEED)
})

describe('word length', () => {
  it('accepts a five-character variant of a five-character word', async () => {
    await db.exec(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'REEHA')`)
    const r = await db.query<{ n: number }>('select count(*)::int n from public.word_variants')
    expect(r.rows[0].n).toBe(1)
  })

  it('rejects a four-character variant such as RIHA', async () => {
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'RIHA')`)).toMatch(/exactly 5 characters.*has 4/)
  })

  it('rejects a six-character variant', async () => {
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'REEHAA')`)).toMatch(/exactly 5 characters.*has 6/)
  })

  it('rejects characters outside A-Z and 0-9', async () => {
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'REE-A')`)).toMatch(/exactly 5 characters/)
  })

  it('keeps the existing rule that canonical words are exactly five characters', async () => {
    await fails(`insert into public.words (word, meaning) values ('RIHA', 'smell')`)
    await fails(`insert into public.words (word, meaning) values ('REEH7A', 'smell')`)
  })
})

describe('normalisation', () => {
  it('stores variants trimmed and upper case', async () => {
    await db.exec(`insert into public.word_variants (canonical_word, variant) values ('  ree7a ', '  reeha  ')`)
    const r = await db.query<{ canonical_word: string; variant: string }>('select canonical_word, variant from public.word_variants')
    expect(r.rows).toEqual([{ canonical_word: 'REE7A', variant: 'REEHA' }])
  })
})

describe('mapping rules', () => {
  it('rejects a duplicate variant', async () => {
    await db.exec(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'REEHA')`)
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'reeha')`)).toMatch(/already registered as a variant of "REE7A"/)
  })

  it('does not let one variant map to two canonical words', async () => {
    await db.exec(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'REEHA')`)
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('BADDI', 'REEHA')`)).toMatch(/already a variant of "REE7A"/)
  })

  it('rejects a variant that is another canonical dictionary word', async () => {
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'BADDI')`)).toMatch(/already a dictionary word of its own/)
  })

  it('rejects a canonical word registered as its own variant', async () => {
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'ree7a')`)).toMatch(/own variant/)
  })

  it('rejects a variant for a word that is not in the dictionary', async () => {
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('NOPEE', 'NOPEA')`)).toMatch(/not in the dictionary/)
  })

  it('rejects a spelling that is already scheduled as a daily answer', async () => {
    expect(await fails(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'FARED')`)).toMatch(/scheduled as a daily puzzle answer/)
  })

  it('rejects an unknown variant type', async () => {
    await fails(`insert into public.word_variants (canonical_word, variant, variant_type) values ('REE7A', 'REEHA', 'whatever')`)
  })

  it('stops a word being added to the dictionary when it is already a registered variant', async () => {
    await db.exec(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'REEHA')`)
    expect(await fails(`insert into public.words (word, meaning) values ('REEHA', 'smell')`)).toMatch(/already registered as a spelling variant/)
  })

  it('does not disturb existing words: approving or editing them still works', async () => {
    await db.exec(`update public.words set approved = false where word = 'REE7A'; update public.words set approved = true where word = 'REE7A';`)
    await db.exec(`insert into public.words (word, meaning) values ('NEWWD', 'ok')`)
  })

  it('removes variants together with their word, and nothing else', async () => {
    await db.exec(`insert into public.word_variants (canonical_word, variant) values ('REE7A', 'REEHA'), ('BADDI', 'BADDE')`)
    await db.exec(`delete from public.words where word = 'REE7A'`)
    const r = await db.query<{ variant: string }>('select variant from public.word_variants')
    expect(r.rows).toEqual([{ variant: 'BADDE' }])
  })
})

describe('admin functions', () => {
  it('dry-runs a pair and lists the problems before saving', async () => {
    const ok = await db.query<{ p: string[] }>(`select public.check_word_variant('REE7A', 'REEHA') p`)
    expect(ok.rows[0].p).toEqual([])
    const bad = await db.query<{ p: string[] }>(`select public.check_word_variant('REE7A', 'RIHA') p`)
    expect(bad.rows[0].p[0]).toMatch(/exactly 5 characters/)
  })

  it('adds, lists, edits and deletes a variant', async () => {
    await db.exec(`select public.add_word_variant('ree7a', 'reeha', 'transliteration')`)
    let list = await db.query<{ canonical_word: string; variant: string; variant_type: string }>(`select * from public.list_word_variants('REE7A')`)
    expect(list.rows.map((r) => [r.canonical_word, r.variant, r.variant_type])).toEqual([['REE7A', 'REEHA', 'transliteration']])

    await db.exec(`select public.update_word_variant('REEHA', p_new_type => 'regional')`)
    list = await db.query(`select * from public.list_word_variants()`)
    expect(list.rows[0].variant_type).toBe('regional')

    await db.exec(`select public.update_word_variant('REEHA', p_new_variant => 'RE7HA')`)
    list = await db.query(`select * from public.list_word_variants()`)
    expect(list.rows[0].variant).toBe('RE7HA')

    await db.exec(`select public.delete_word_variant('re7ha')`)
    list = await db.query(`select * from public.list_word_variants()`)
    expect(list.rows).toEqual([])
  })

  it('refuses an edit that would break a rule, and a delete of something that is not there', async () => {
    await db.exec(`select public.add_word_variant('REE7A', 'REEHA')`)
    await db.exec(`select public.add_word_variant('BADDI', 'BADDE')`)
    expect(await fails(`select public.update_word_variant('BADDE', p_new_variant => 'REEHA')`)).toMatch(/already a variant of "REE7A"/)
    expect(await fails(`select public.update_word_variant('BADDE', p_new_variant => 'BAD')`)).toMatch(/exactly 5 characters/)
    expect(await fails(`select public.delete_word_variant('ZZZZZ')`)).toMatch(/No variant/)
  })
})

describe('security', () => {
  it('has row level security on and no policies', async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'word_variants'`)
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const policies = await db.query(`select 1 from pg_policies where tablename = 'word_variants'`)
    expect(policies.rows).toHaveLength(0)
  })

  it('gives the public API roles no access to the table or the admin functions', async () => {
    await db.exec(`select public.add_word_variant('REE7A', 'REEHA')`)
    for (const role of ['anon', 'authenticated']) {
      expect(await fails(`set role ${role}; select * from public.word_variants;`)).toMatch(/permission denied/)
      await db.exec('reset role')
      expect(await fails(`set role ${role}; insert into public.word_variants (canonical_word, variant) values ('BADDI', 'BADDE');`)).toMatch(/permission denied/)
      await db.exec('reset role')
      expect(await fails(`set role ${role}; delete from public.word_variants;`)).toMatch(/permission denied/)
      await db.exec('reset role')
      expect(await fails(`set role ${role}; select public.add_word_variant('BADDI', 'BADDE');`)).toMatch(/permission denied/)
      await db.exec('reset role')
      expect(await fails(`set role ${role}; select * from public.list_word_variants();`)).toMatch(/permission denied/)
      await db.exec('reset role')
    }
  })

  it('lets the service role (the Edge Functions) read the mapping', async () => {
    await db.exec(`select public.add_word_variant('REE7A', 'REEHA')`)
    await db.exec(`set role service_role`)
    const r = await db.query<{ variant: string }>('select variant from public.word_variants')
    await db.exec('reset role')
    expect(r.rows).toEqual([{ variant: 'REEHA' }])
  })
})
