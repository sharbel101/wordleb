import { msUntilNextBeirutMidnight } from '../../supabase/functions/_shared/beirut'
import type { TileState } from '../../supabase/functions/_shared/evaluate'
import { GUESS_LENGTH } from './validateGuess'

export type { TileState }
export type GameStatus = 'playing' | 'won' | 'lost'

export const WORD_LENGTH = GUESS_LENGTH
export const MAX_ATTEMPTS = 6

/** The digit keys on the keyboard, with the Arabic letter each one stands for. */
export const ARABIZI_HINTS: Record<string, string> = { '2': 'ء', '3': 'ع', '5': 'خ', '7': 'ح', '8': 'غ' }
export const ARABIZI_DIGITS = Object.keys(ARABIZI_HINTS)

/** Characters the player can type: letters, plus the digits on the keyboard. */
export function isValidChar(ch: string): boolean {
  return /^[a-zA-Z]$/.test(ch) || ARABIZI_DIGITS.includes(ch)
}

/** Alphabet and length check only. The full rules live in `validateGuess`. */
export function isWellFormedGuess(guess: string): boolean {
  return [...guess].length === WORD_LENGTH && [...guess].every(isValidChar)
}

const RANK: Record<TileState, number> = { absent: 0, present: 1, correct: 2 }

/** Best known state for each key, from guesses and their server-scored results. */
export function getKeyStates(guesses: string[], results: TileState[][]): Record<string, TileState> {
  const keys: Record<string, TileState> = {}
  guesses.forEach((guess, row) => {
    results[row]?.forEach((state, i) => {
      const ch = guess[i]
      if (!keys[ch] || RANK[state] > RANK[keys[ch]]) keys[ch] = state
    })
  })
  return keys
}

export function msUntilNextPuzzle(now: Date = new Date()): number {
  return msUntilNextBeirutMidnight(now)
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

const SHARE_EMOJI: Record<TileState, string> = {
  correct: '🟩',
  present: '🟨',
  absent: '⬛',
}

/** Where shared results point, so anyone who sees one can play. */
export const SITE_URL = 'https://wordleb.com'

export function buildShareText(
  results: TileState[][],
  status: GameStatus,
  puzzleNumber: number,
): string {
  const score = status === 'won' ? `${results.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`
  const rows = results.map((row) => row.map((s) => SHARE_EMOJI[s]).join('')).join('\n')
  return `wordleb #${puzzleNumber} ${score}\n\n${rows}\n\n${SITE_URL}`
}

/** Screen-reader summary of a scored guess, e.g. "Guess 2: B absent, A present, ...". */
export function describeGuess(guess: string, result: TileState[], attempt: number): string {
  const letters = [...guess].map((ch, i) => `${ch.toUpperCase()} ${result[i]}`).join(', ')
  return `Guess ${attempt}: ${letters}.`
}
