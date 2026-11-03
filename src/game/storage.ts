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

function usable(saved: SavedGame | null | undefined, dateKey: string): saved is SavedGame {
  if (!saved || saved.dateKey !== dateKey) return false
  if (!Array.isArray(saved.guesses) || !Array.isArray(saved.results)) return false
  if (saved.guesses.length !== saved.results.length) return false
  // A game in progress is only resumable with the server's proof of its guesses.
  return !(saved.status === 'playing' && saved.guesses.length > 0 && !saved.stateToken)
}

export function loadGame(dateKey: string): SavedGame | null {
  const saved = read<SavedGame>(GAME_KEY)
  return usable(saved, dateKey) ? saved : null
}

export function saveGame(game: SavedGame) {
  write(GAME_KEY, game)
}

const ARCHIVE_KEY = 'wordleb:archive'

/** Replays of past puzzles, one entry per date, kept apart from today's game. */
function readArchive(): Record<string, SavedGame> {
  const saved = read<Record<string, SavedGame>>(ARCHIVE_KEY)
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
}

/** A past puzzle's local progress. A game saved on the day itself lives in the main slot, so look there too. */
export function loadPastGame(dateKey: string): SavedGame | null {
  const saved = readArchive()[dateKey]
  return usable(saved, dateKey) ? saved : loadGame(dateKey)
}

export function savePastGame(game: SavedGame) {
  write(ARCHIVE_KEY, { ...readArchive(), [game.dateKey]: game })
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

const PLAYER_KEY = 'wordleb:player'
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
let cachedPlayerId: string | null = null

function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * A random id made in this browser and kept in localStorage. It identifies nobody (there are no
 * accounts); the server only uses it so one browser is counted once per day in the community stats.
 */
export function getPlayerId(): string {
  if (cachedPlayerId) return cachedPlayerId
  const saved = read<string>(PLAYER_KEY)
  cachedPlayerId = typeof saved === 'string' && UUID_RE.test(saved) ? saved : newUuid()
  write(PLAYER_KEY, cachedPlayerId)
  return cachedPlayerId
}
