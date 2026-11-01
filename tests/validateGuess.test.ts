import { describe, expect, it } from 'vitest'
import { validateGuess } from '../src/game/validateGuess'

const error = (guess: string, previous: string[] = []) => {
  const r = validateGuess(guess, previous)
  return r.valid ? null : r.error
}

describe('validateGuess: always rejected', () => {
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
    expect(validateGuess(guess).valid).toBe(false)
  })

  it('gives a distinct, friendly message for each basic rule', () => {
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

describe('validateGuess: the small extra strictness', () => {
  it.each(['AAAAB', 'AABBB', 'ABCCC', 'HAAAB', 'B2222', '777AB', 'KTEEE'])(
    'rejects three or more identical characters in a row: %s',
    (guess) => {
      expect(error(guess)).toBe("That's a lot of repeating letters.")
    },
  )

  it.each(['BCDRT', 'XQZTP', 'KRSTN', 'ZZXQK', 'PLNTS'])('rejects no vowel letter and no digit: %s', (guess) => {
    expect(error(guess)).toBe("That doesn't look like a word.")
  })

  it.each(['SBRTA', 'ASTRK', 'MNBTK', 'ABCDF', 'KRSTA', 'BRDNY'])('rejects four consonants in a row: %s', (guess) => {
    expect(error(guess)).toBe("That doesn't look like a word.")
  })

  it('counts SH, KH, GH, TH, DH and CH as one sound, so they do not trigger the cluster rule', () => {
    for (const guess of ['SHRKA', 'AKHBR', 'MAGHR', 'ASHKR', 'DHRBA']) expect(validateGuess(guess).valid, guess).toBe(true)
  })

  it('lets digits and vowels break up clusters, and treats Y as a vowel', () => {
    for (const guess of ['BNT7M', 'M3LM7', '3M7KL', 'MNYKH', 'KHBZ2', 'SHWAY']) {
      expect(validateGuess(guess).valid, guess).toBe(true)
    }
  })

  it('allows doubled letters', () => {
    for (const guess of ['HABIB', 'MAMMA', 'KTEER', 'YALLA', 'TAAAB'.replace('AAA', 'AA') + 'X']) {
      expect(validateGuess(guess).valid, guess).toBe(true)
    }
  })
})

describe('validateGuess: genuine Lebanese Arabizi still passes', () => {
  it.each([
    'KIFAK', '7ABIB', '5ALAS', '3AJ2A', '2AHWE', 'YA3NE', 'SHWAY', 'KTEER', 'BA7AR', 'SHAMS', 'YALLA',
    'MNIH2', '5OBEZ', '7ELOU', 'ZGHIR', 'BA3ED', 'SA7EN', 'TAYYB', 'LEISH', 'HAYDA', 'MARRA', 'WALLA',
  ])('%s', (guess) => {
    expect(validateGuess(guess)).toEqual({ valid: true, normalizedGuess: guess })
  })

  it('does not judge digit-heavy or odd-looking words', () => {
    for (const guess of ['23578', '12345', '77812', 'EERIE', 'AAEEX']) {
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
