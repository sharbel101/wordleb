import { MAX_DIGITS, countDigits } from '../../supabase/functions/_shared/validate'

export const GUESS_LENGTH = 5

export type GuessCheck =
  | { valid: true; normalizedGuess: string }
  | { valid: false; normalizedGuess: string; error: string }

const MESSAGES = {
  length: 'Five characters, ya zalame!',
  characters: "These characters aren't supported.",
  repeating: "That's a lot of repeating letters.",
  notAWord: "That doesn't look like a word.",
  digits: `Use at most ${MAX_DIGITS} numbers.`,
  duplicate: 'You already tried this word.',
}

/** Letters that can carry a vowel sound. Y counts: in Arabizi it often stands in for "ee". */
const VOWELS = 'AEIOUY'
/** Two-letter spellings of a single Arabic sound; each counts as one consonant in a cluster. */
const DIGRAPHS = ['SH', 'KH', 'GH', 'TH', 'DH', 'CH']
/** This many consonant sounds in a row is not pronounceable in any Lebanese spelling we know. */
const MAX_CONSONANT_RUN = 3

/** Longest run of consecutive consonant sounds. Digits and vowels break a run; SH, KH... count once. */
function longestConsonantRun(guess: string): number {
  let longest = 0
  let run = 0
  for (let i = 0; i < guess.length; i++) {
    const ch = guess[i]
    const isConsonant = /[A-Z]/.test(ch) && !VOWELS.includes(ch)
    if (!isConsonant) {
      run = 0
      continue
    }
    if (DIGRAPHS.includes(guess.slice(i, i + 2))) i++
    run++
    longest = Math.max(longest, run)
  }
  return longest
}

/**
 * Light front-end filter for obvious slips and keyboard mashing. Whether a guess is a real
 * word is decided by the server's word list (and by what players actually type), never here,
 * so anything that merely looks unusual must pass: Arabizi has no single correct spelling.
 *
 * Rejects: wrong length, characters outside A-Z / 0-9, five identical characters, five vowels,
 * a guess already submitted this game, and three small extras that real words essentially never
 * trip: 3+ identical characters in a row, no vowel letter and no digit at all, and four or
 * more consonant sounds in a row.
 */
export function validateGuess(raw: string, previousGuesses: string[] = []): GuessCheck {
  // Trim the edges and uppercase a-z only. Nothing inside the guess is ever changed or removed.
  const guess = raw.trim().replace(/[a-z]/g, (c) => c.toUpperCase())
  const fail = (error: string): GuessCheck => ({ valid: false, normalizedGuess: guess, error })

  if ([...guess].length !== GUESS_LENGTH) return fail(MESSAGES.length)
  if (!/^[A-Z0-9]+$/.test(guess)) return fail(MESSAGES.characters)
  if (new Set(guess).size === 1) return fail(MESSAGES.repeating)
  if (/^[AEIOU]+$/.test(guess)) return fail(MESSAGES.notAWord)
  if (previousGuesses.some((g) => g.trim().toUpperCase() === guess)) return fail(MESSAGES.duplicate)

  // The tiny extra strictness.
  if (/(.)\1\1/.test(guess)) return fail(MESSAGES.repeating)
  if (countDigits(guess) > MAX_DIGITS) return fail(MESSAGES.digits)
  if (!/[AEIOUY0-9]/.test(guess)) return fail(MESSAGES.notAWord)
  if (longestConsonantRun(guess) > MAX_CONSONANT_RUN) return fail(MESSAGES.notAWord)

  return { valid: true, normalizedGuess: guess }
}
