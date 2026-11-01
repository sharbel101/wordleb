import { describe, expect, it } from 'vitest'
import { validateGuess } from '../src/game/validateGuess'

describe('validateGuess: rejected', () => {
  it.each([
    ['AAAAA', 'identical characters'],
    ['BBBBB', 'identical characters'],
    ['22222', 'identical digits'],
    ['AEIOU', 'all vowels'],
    ['AAAAE', 'all vowels'],
    ['UOIEA', 'all vowels, any order'],
    ['ABCD', 'too short'],
    ['ABCDEFG', 'too long'],
    ['', 'empty'],
    ['HA@IB', 'invalid character'],
    ['HA IB', 'internal space'],
    ['HÁBIB', 'accented letter'],
    ['حبيبي', 'Arabic script'],
    ['HA😀IB', 'emoji'],
  ])('%s (%s)', (guess) => {
    const res = validateGuess(guess)
    expect(res.valid).toBe(false)
    if (!res.valid) expect(res.error.length).toBeGreaterThan(0)
  })

  it('gives a distinct, friendly message for each rule', () => {
    const error = (g: string, prev: string[] = []) => {
      const r = validateGuess(g, prev)
      return r.valid ? null : r.error
    }
    expect(error('ABCD')).toBe('Five characters, ya zalame!')
    expect(error('HA@IB')).toBe("These characters aren't supported.")
    expect(error('AAAAA')).toBe("That's a lot of repeating letters.")
    expect(error('AEIOU')).toBe("That doesn't look like a word.")
    expect(error('KIFAK', ['kifak'])).toBe('You already tried this word.')
  })

  it('rejects a guess already submitted this game, whatever its case', () => {
    expect(validateGuess('KIFAK', ['YALLA', 'KIFAK']).valid).toBe(false)
    expect(validateGuess('kifak', ['KIFAK']).valid).toBe(false)
    expect(validateGuess('KIFAK', ['kifak']).valid).toBe(false)
    expect(validateGuess('KIFAK', ['YALLA']).valid).toBe(true)
    expect(validateGuess('KIFAK').valid).toBe(true)
  })
})

describe('validateGuess: passes basic filtering', () => {
  it.each(['KIFAK', '7ABIB', '5ALAS', '3AJ2A', '2AHWE', 'YA3NE', 'SHWAY', 'KTEER'])('%s', (guess) => {
    expect(validateGuess(guess)).toEqual({ valid: true, normalizedGuess: guess })
  })

  it('lets unusual-looking combinations through: it is not a linguistic filter', () => {
    for (const guess of [
      'BCDRT', // no vowels
      'XQZTP', // odd letters
      '23578', // all digits
      '222AB', // run of digits
      'AAAAB', // repeated letters
      'AABBB',
      'ABCCC',
      '77712', // mostly digits
      'EERIE', // mostly vowels
      'ZZXQK',
      'HABIB',
      'AAEEX', // vowels plus one consonant
      '12345', // digits the keyboard does not offer
    ]) {
      expect(validateGuess(guess).valid, guess).toBe(true)
    }
  })
})

describe('validateGuess: normalization', () => {
  it('uppercases and trims, and reports the normalized guess', () => {
    expect(validateGuess('  kifak ')).toEqual({ valid: true, normalizedGuess: 'KIFAK' })
    expect(validateGuess('7abib')).toEqual({ valid: true, normalizedGuess: '7ABIB' })
  })

  it('reports the normalized guess even when rejecting', () => {
    expect(validateGuess('aaaaa')).toMatchObject({ valid: false, normalizedGuess: 'AAAAA' })
  })

  it('never edits the inside of a guess to make it valid', () => {
    expect(validateGuess('ha bib').valid).toBe(false)
    expect(validateGuess('ha@ib').valid).toBe(false)
  })
})
