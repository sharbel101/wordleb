/**
 * Days that get a small celebration when the puzzle is solved: confetti and a greeting.
 * Keyed by puzzle date (YYYY-MM-DD, Asia/Beirut), the same date the server uses for the puzzle.
 * To add one, add a line here; nothing else needs to change.
 */
export interface Celebration {
  message: string
}

const CELEBRATIONS: Readonly<Record<string, Celebration>> = {
  '2026-11-23': { message: 'Happy Independence Day!' },
}

export function celebrationFor(puzzleDate: string | null | undefined): Celebration | null {
  return (puzzleDate && CELEBRATIONS[puzzleDate]) || null
}
