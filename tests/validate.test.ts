import { describe, expect, it } from 'vitest'
import {
  createRateLimiter,
  isValidGuessFormat,
  normalizeGuess,
  validateSuggestion,
} from '../supabase/functions/_shared/validate'

describe('guess format', () => {
  it('accepts five Arabizi characters', () => {
    expect(isValidGuessFormat('yalla')).toBe(true)
    expect(isValidGuessFormat('5obez')).toBe(true)
    expect(isValidGuessFormat('ba7ar')).toBe(true)
  })

  it.each(['yall', 'yallah', 'YALLA', 'ya11a', 'ya-la', 'ياللا', '', 12345, null])('rejects %s', (v) => {
    expect(isValidGuessFormat(v)).toBe(false)
  })

  it('normalizes case and whitespace', () => {
    expect(normalizeGuess('  YaLLa ')).toBe('yalla')
    expect(normalizeGuess(undefined)).toBe('')
  })
})

describe('validateSuggestion', () => {
  const base = { word: 'Yalla', meaning: "Let's go", arabic_spelling: 'يلا', example_sentence: 'Yalla, bye!' }

  it('accepts and normalizes a full suggestion', () => {
    expect(validateSuggestion(base)).toEqual({
      ok: true,
      value: { word: 'yalla', meaning: "Let's go", arabic_spelling: 'يلا', example_sentence: 'Yalla, bye!' },
    })
  })

  it('turns empty optional fields into null', () => {
    const res = validateSuggestion({ ...base, arabic_spelling: ' ', example_sentence: '' })
    expect(res).toMatchObject({ ok: true, value: { arabic_spelling: null, example_sentence: null } })
  })

  it('rejects a bad word, a missing meaning and non-Arabic script', () => {
    expect(validateSuggestion({ ...base, word: 'abc' }).ok).toBe(false)
    expect(validateSuggestion({ ...base, meaning: ' ' }).ok).toBe(false)
    expect(validateSuggestion({ ...base, arabic_spelling: 'yalla' }).ok).toBe(false)
    expect(validateSuggestion({ ...base, example_sentence: 'x'.repeat(201) }).ok).toBe(false)
    expect(validateSuggestion(null).ok).toBe(false)
  })
})

describe('createRateLimiter', () => {
  it('allows up to the limit inside the window, then blocks', () => {
    const allow = createRateLimiter(2, 1000)
    expect(allow('ip', 0)).toBe(true)
    expect(allow('ip', 100)).toBe(true)
    expect(allow('ip', 200)).toBe(false)
    expect(allow('other', 200)).toBe(true)
  })

  it('allows again once the window has passed', () => {
    const allow = createRateLimiter(1, 1000)
    expect(allow('ip', 0)).toBe(true)
    expect(allow('ip', 500)).toBe(false)
    expect(allow('ip', 1001)).toBe(true)
  })
})
