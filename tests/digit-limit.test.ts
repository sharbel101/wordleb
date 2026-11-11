import { describe, expect, it } from 'vitest'
import { isWellFormedGuess } from '../src/game/logic'
import { validateGuess } from '../src/game/validateGuess'
import { MAX_DIGITS, countDigits, guessFormatProblem, isValidGuessFormat, normalizeGuess, validateSuggestion } from '../supabase/functions/_shared/validate'

/** What the server does with a raw request value: trim, lower-case, then check the format. */
const serverVerdict = (raw: string) => guessFormatProblem(normalizeGuess(raw))

describe('a word has at most two numbers (server, authoritative)', () => {
  it('accepts words with none, one or two numbers', () => {
    for (const w of ['ABCDE', 'REE7A', '7AMRA', 'BA2RA', '3OTLE', '23ABC', 'A2B3C', 'SA5R8']) {
      expect(serverVerdict(w), w).toBeNull()
    }
  })

  it('rejects three or more numbers, with a specific reason', () => {
    for (const w of ['B235A', '23578', '2A3B5', '7777A', '222AB']) {
      expect(serverVerdict(w), w).toBe('digits')
    }
  })

  it('cannot be got around with letter case or whitespace', () => {
    expect(serverVerdict('  b235a  ')).toBe('digits')
    expect(serverVerdict('B235A')).toBe('digits')
    expect(serverVerdict('\tb2a35\n')).toBe('digits')
    expect(serverVerdict('b 2a3')).toBe('characters') // inner space: not five valid characters
  })

  it('cannot be got around with look-alike digits', () => {
    expect(serverVerdict('٢٣٥ab')).toBe('characters') // Arabic-Indic digits
    expect(serverVerdict('２３５ab')).toBe('characters') // full-width digits
  })

  it('still enforces the five-character alphabet first', () => {
    expect(serverVerdict('abcd')).toBe('characters')
    expect(serverVerdict('abcdef')).toBe('characters')
    expect(serverVerdict('ab-de')).toBe('characters')
    expect(isValidGuessFormat(undefined)).toBe(false)
    expect(isValidGuessFormat(12345)).toBe(false)
  })

  it('never swaps letters and numbers for each other', () => {
    expect(normalizeGuess('7AMRA')).toBe('7amra')
    expect(normalizeGuess('HAMRA')).toBe('hamra')
    expect(normalizeGuess('2ar3a')).toBe('2ar3a')
  })

  it('counts digits', () => {
    expect(countDigits('b2a3c')).toBe(2)
    expect(countDigits('abcde')).toBe(0)
    expect(MAX_DIGITS).toBe(2)
  })
})

describe('suggestions follow the same rule', () => {
  it('rejects a suggestion with three numbers and says why', () => {
    const r = validateSuggestion({ word: 'b235a' })
    expect(r).toEqual({ ok: false, message: 'A word can have at most 2 numbers.' })
  })

  it('still accepts a normal word and trims/lower-cases it', () => {
    expect(validateSuggestion({ word: '  7AMRA ' })).toMatchObject({ ok: true, value: { word: '7amra' } })
  })
})

describe('the browser gives immediate feedback (it is not the only check)', () => {
  it('refuses a third number on submit', () => {
    expect(validateGuess('b235a')).toMatchObject({ valid: false, error: 'Use at most 2 numbers.' })
    expect(validateGuess('23578')).toMatchObject({ valid: false })
  })

  it('accepts one or two numbers', () => {
    expect(validateGuess('ree7a')).toMatchObject({ valid: true })
    expect(validateGuess('2ar3a')).toMatchObject({ valid: true })
  })

  it('the suggestion form uses the same limit', () => {
    expect(isWellFormedGuess('2ar3a')).toBe(true)
    expect(isWellFormedGuess('b235a')).toBe(false)
  })
})
