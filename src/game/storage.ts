import { MAX_ATTEMPTS, type GameStatus, type TileState } from './logic'
import type { AnswerInfo, Puzzle } from './types'

const GAME_KEY = 'wordleb:game'
const STATS_KEY = 'wordleb:stats'

/** In-progress or finished game for one puzzle date. Never holds an unrevealed answer. */
export interface SavedGame {
  dateKey: string
  guesses: string[]
  results: TileState[][]
  status: GameStatus
  answer: AnswerInfo | null
  /** Server-signed proof of the guesses scored so far; sent back with the next guess. */
  stateToken: string | null
}

export interface Stats {
  played: number
  wins: number
  currentStreak: number
  maxStreak: number
  /** Index 0 = solved in 1 guess ... index 5 = solved in 6. */
  distribution: number[]
  lastPlayed: string | null
}

export const EMPTY_STATS: Stats = {
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  distribution: Array(MAX_ATTEMPTS).fill(0),
  lastPlayed: null,
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode, quota): the game still works */
  }
}

export function loadGame(dateKey: string): SavedGame | null {
  const saved = read<SavedGame>(GAME_KEY)
  if (
    !saved ||
    saved.dateKey !== dateKey ||
    !Array.isArray(saved.guesses) ||
    !Array.isArray(saved.results) ||
    saved.guesses.length !== saved.results.length ||
    // A game in progress is only resumable with the server's proof of its guesses.
    (saved.status === 'playing' && saved.guesses.length > 0 && !saved.stateToken)
  ) {
    return null
  }
  return saved
}

export function saveGame(game: SavedGame) {
  write(GAME_KEY, game)
}

export function loadStats(): Stats {
  const saved = read<Stats>(STATS_KEY)
  if (!saved || !Array.isArray(saved.distribution)) return EMPTY_STATS
  return { ...EMPTY_STATS, ...saved }
}

function dayBefore(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** Records a finished puzzle and returns the updated stats. Idempotent per date. */
export function recordResult(dateKey: string, won: boolean, attempts: number): Stats {
  const stats = loadStats()
  if (stats.lastPlayed === dateKey) return stats

  const continues = stats.lastPlayed === dayBefore(dateKey)
  const currentStreak = won ? (continues ? stats.currentStreak : 0) + 1 : 0
  const distribution = [...stats.distribution]
  if (won) distribution[attempts - 1] += 1

  const next: Stats = {
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    distribution,
    lastPlayed: dateKey,
  }
  write(STATS_KEY, next)
  return next
}

const PUZZLE_KEY = 'wordleb:puzzle'

/**
 * Today's puzzle metadata (date and number only, never the answer) so reloads
 * during the same Beirut day skip a network round trip.
 */
export function loadCachedPuzzle(dateKey: string): Puzzle | null {
  const cached = read<Puzzle>(PUZZLE_KEY)
  return cached && cached.puzzleDate === dateKey && typeof cached.puzzleNumber === 'number' ? cached : null
}

export function saveCachedPuzzle(puzzle: Puzzle) {
  write(PUZZLE_KEY, puzzle)
}

export function clearCachedPuzzle() {
  try {
    localStorage.removeItem(PUZZLE_KEY)
  } catch {
    /* ignore */
  }
}
