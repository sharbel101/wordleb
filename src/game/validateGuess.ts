export const GUESS_LENGTH = 5

export type GuessCheck =
  | { valid: true; normalizedGuess: string }
  | { valid: false; normalizedGuess: string; error: string }

const MESSAGES = {
  length: 'Five characters, ya zalame!',
  characters: "These characters aren't supported.",
  identical: "That's a lot of repeating letters.",
  allVowels: "That doesn't look like a word.",
  duplicate: 'You already tried this word.',
}

/**
 * Deliberately minimal. This only stops obvious slips and mashing; whether a guess
 * is a real word is decided by the server's word list, never here. Unusual-looking
 * spellings must pass, because Arabizi has no single correct spelling.
 *
 * Rejects only: wrong length, characters outside A-Z / 0-9, five identical
 * characters, five vowels, and a guess already submitted this game.
 */
export function validateGuess(raw: string, previousGuesses: string[] = []): GuessCheck {
  // Trim the edges and uppercase a-z only. Nothing inside the guess is ever changed or removed.
  const guess = raw.trim().replace(/[a-z]/g, (c) => c.toUpperCase())
  const fail = (error: string): GuessCheck => ({ valid: false, normalizedGuess: guess, error })

  if ([...guess].length !== GUESS_LENGTH) return fail(MESSAGES.length)
  if (!/^[A-Z0-9]+$/.test(guess)) return fail(MESSAGES.characters)
  if (new Set(guess).size === 1) return fail(MESSAGES.identical)
  if (/^[AEIOU]+$/.test(guess)) return fail(MESSAGES.allVowels)
  if (previousGuesses.some((g) => g.trim().toUpperCase() === guess)) return fail(MESSAGES.duplicate)

  return { valid: true, normalizedGuess: guess }
}
