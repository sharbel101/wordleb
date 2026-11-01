export interface Puzzle {
  puzzleDate: string
  puzzleNumber: number
}

/** Revealed only once a game has ended. */
export interface AnswerInfo {
  word: string
  meaning: string | null
  arabic: string | null
  example: string | null
  translation: string | null
}
