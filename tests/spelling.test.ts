import { describe, expect, it, vi } from 'vitest'
import { evaluateGuess } from '../supabase/functions/_shared/evaluate'
import { createVariantCache, resolveSpelling, toVariantMap } from '../supabase/functions/_shared/spelling'
import { playTurn } from '../supabase/functions/_shared/turn'
import { isValidGuessFormat, normalizeGuess } from '../supabase/functions/_shared/validate'

const variants = toVariantMap([
  { variant: 'REEHA', canonical_word: 'REE7A' },
  { variant: 'BADDE', canonical_word: 'BADDI' },
])

/** One guess exactly as submit-guess handles it, without the database. */
function play(typed: string, rawAnswer: string, previous: string[] = [], approved: string[] = ['ree7a', 'baddi', 'hamra']) {
  const guess = normalizeGuess(typed)
  if (!isValidGuessFormat(guess)) return { valid: false as const }
  const s = resolveSpelling(guess, rawAnswer, variants, approved.includes(guess))
  const turn = playTurn(s.guess, s.answer, previous)
  return { valid: true as const, spelling: s, turn }
}

describe('five-character rule', () => {
  it('accepts five characters and rejects four or six', () => {
    expect(isValidGuessFormat(normalizeGuess('REE7A'))).toBe(true)
    expect(isValidGuessFormat(normalizeGuess('REEHA'))).toBe(true)
    expect(isValidGuessFormat(normalizeGuess('RIHA'))).toBe(false)
    expect(isValidGuessFormat(normalizeGuess('REEHAA'))).toBe(false)
  })

  it('handles lower case and surrounding whitespace', () => {
    expect(play('  reeha ', 'ree7a')).toMatchObject({ valid: true, spelling: { guess: 'ree7a', viaVariant: true } })
  })

  it('rejects RIHA outright, before any dictionary lookup', () => {
    expect(play('RIHA', 'ree7a')).toEqual({ valid: false })
  })
})

describe('resolution', () => {
  it('keeps a canonical spelling as it is', () => {
    expect(resolveSpelling('ree7a', 'ree7a', variants, true)).toMatchObject({ guess: 'ree7a', viaVariant: false, known: true })
  })

  it('resolves a registered variant to its canonical word', () => {
    expect(resolveSpelling('reeha', 'baddi', variants, false)).toEqual({ guess: 'ree7a', answer: 'baddi', viaVariant: true, known: true })
  })

  it('leaves an unknown word alone and marks it unknown', () => {
    expect(resolveSpelling('zzzzz', 'ree7a', variants, false)).toEqual({ guess: 'zzzzz', answer: 'ree7a', viaVariant: false, known: false })
  })

  it('resolves an answer that was stored in a variant spelling to its canonical word', () => {
    expect(resolveSpelling('ree7a', 'reeha', variants, true)).toMatchObject({ guess: 'ree7a', answer: 'ree7a' })
  })

  it('maps case-insensitively and ignores a self-mapping or blank rows', () => {
    const map = toVariantMap([
      { variant: ' Reeha ', canonical_word: 'ree7a' },
      { variant: 'same1', canonical_word: 'SAME1' },
      { variant: '', canonical_word: 'ree7a' },
    ])
    expect([...map]).toEqual([['reeha', 'ree7a']])
  })
})

describe('game behaviour', () => {
  it('wins with the canonical spelling', () => {
    expect(play('REE7A', 'ree7a').turn).toMatchObject({ won: true, result: Array(5).fill('correct') })
  })

  it('wins with a registered variant of the answer, scored as the canonical word', () => {
    const r = play('REEHA', 'ree7a')
    expect(r.turn).toMatchObject({ won: true, attempt: 1, result: Array(5).fill('correct') })
    expect(r.spelling?.guess).toBe('ree7a') // what the board shows
  })

  it('wins when the answer is the variant spelling and the player types the canonical one', () => {
    expect(play('REE7A', 'reeha').turn).toMatchObject({ won: true })
  })

  it('accepts a variant of another word as a normal, losing guess', () => {
    const r = play('BADDE', 'ree7a')
    expect(r.spelling).toMatchObject({ guess: 'baddi', known: true })
    expect(r.turn).toMatchObject({ won: false, lost: false, attempt: 1 })
    expect(r.turn).toEqual(expect.objectContaining({ result: evaluateGuess('baddi', 'ree7a') }))
  })

  it('scores tiles for the canonical guess, so a variant spelling cannot mislead', () => {
    // Typed REEHA, but the H must not be graded against the answer as if it were a letter on its own.
    const r = play('REEHA', 'ree7a', [], [])
    expect(r.turn).toMatchObject({ result: ['correct', 'correct', 'correct', 'correct', 'correct'] })
    const other = play('REEHA', 'hamra', [], [])
    expect(other.turn).toMatchObject({ result: evaluateGuess('ree7a', 'hamra') })
  })

  it('keeps the duplicate-letter handling', () => {
    expect(evaluateGuess('baddi', 'badda')).toEqual(['correct', 'correct', 'correct', 'correct', 'absent'])
    expect(evaluateGuess('dadad', 'abdda')).toEqual(['present', 'present', 'correct', 'present', 'absent'])
  })

  it('keeps six guesses: the sixth wrong guess loses, and a won game cannot continue', () => {
    const wrong = ['hamra', 'baddi', 'sa7en', 'zzzzz', 'yyyyy']
    expect(play('baddi', 'ree7a', wrong).turn).toMatchObject({ attempt: 6, lost: true, won: false })
    expect(play('baddi', 'ree7a', [...wrong, 'x1x1x']).turn).toEqual({ error: 'game_over' })
    expect(play('baddi', 'ree7a', ['ree7a']).turn).toEqual({ error: 'game_over' })
  })

  it('stores the canonical guess in game history, so a won variant ends the game', () => {
    const first = play('REEHA', 'ree7a')
    expect(first.valid && first.spelling.guess).toBe('ree7a')
    expect(play('hamra', 'ree7a', ['ree7a']).turn).toEqual({ error: 'game_over' })
  })
})

describe('what the server tells the player', () => {
  it('exposes neither the answer nor the mapping of other words', () => {
    const r = play('BADDE', 'ree7a')
    const asJson = JSON.stringify({ result: r.valid && 'result' in r.turn ? r.turn.result : null, canonical: r.valid ? r.spelling.guess : null })
    expect(asJson).not.toContain('ree7a')
    expect(asJson).not.toContain('reeha')
  })
})

describe('variant cache', () => {
  it('loads once, serves from memory, and refreshes after the lifetime', async () => {
    let t = 0
    const load = vi.fn().mockResolvedValue([{ variant: 'REEHA', canonical_word: 'REE7A' }])
    const get = createVariantCache(load, () => t, 60_000)
    expect((await get()).get('reeha')).toBe('ree7a')
    await get()
    expect(load).toHaveBeenCalledTimes(1)
    t = 61_000
    await get()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good mapping when a refresh fails, and never throws into the game', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let t = 0
    const load = vi.fn().mockResolvedValueOnce([{ variant: 'REEHA', canonical_word: 'REE7A' }]).mockRejectedValue(new Error('db down'))
    const get = createVariantCache(load, () => t, 60_000)
    await get()
    t = 61_000
    expect((await get()).get('reeha')).toBe('ree7a')
  })

  it('works with no variants at all when the table cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const get = createVariantCache(() => Promise.reject(new Error('relation does not exist')))
    expect((await get()).size).toBe(0)
  })

  it('shares one load between simultaneous guesses', async () => {
    const load = vi.fn().mockResolvedValue([])
    const get = createVariantCache(load)
    await Promise.all([get(), get(), get()])
    expect(load).toHaveBeenCalledTimes(1)
  })
})
