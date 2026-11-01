export type TileState = 'correct' | 'present' | 'absent'

/** Standard Wordle scoring, with correct handling of repeated letters. */
export function evaluateGuess(guess: string, answer: string): TileState[] {
  const result: TileState[] = Array(guess.length).fill('absent')
  const remaining: Record<string, number> = {}

  // Pass 1: exact matches. Unmatched answer letters become available for pass 2.
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) result[i] = 'correct'
    else remaining[answer[i]] = (remaining[answer[i]] ?? 0) + 1
  }
  // Pass 2: right letter, wrong place, limited by how many are left in the answer.
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'correct') continue
    if (remaining[guess[i]] > 0) {
      result[i] = 'present'
      remaining[guess[i]]--
    }
  }
  return result
}
