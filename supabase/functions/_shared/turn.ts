import { evaluateGuess, type TileState } from './evaluate.ts'
import { MAX_ATTEMPTS } from './validate.ts'

export type TurnOutcome =
  | { error: 'game_over' }
  | { result: TileState[]; attempt: number; won: boolean; lost: boolean }

/**
 * Plays one guess. `previous` must come from a verified token (or be empty for the
 * first guess), never from a client-supplied list: the attempt number decides when
 * the answer is revealed, so it has to be trustworthy.
 */
export function playTurn(guess: string, answer: string, previous: string[]): TurnOutcome {
  if (previous.length >= MAX_ATTEMPTS || previous.includes(answer)) return { error: 'game_over' }

  const attempt = previous.length + 1
  const won = guess === answer
  return {
    result: evaluateGuess(guess, answer),
    attempt,
    won,
    lost: !won && attempt >= MAX_ATTEMPTS,
  }
}
