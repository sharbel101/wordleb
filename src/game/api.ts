import type { TileState } from './logic'
import type { AnswerInfo, Puzzle } from './types'

export type ApiErrorKind =
  | 'config'
  | 'network'
  | 'no_puzzle'
  | 'puzzle_changed'
  | 'rate_limited'
  | 'already_exists'
  | 'already_suggested'
  | 'invalid'
  | 'bad_state'
  | 'server'

export class ApiError extends Error {
  kind: ApiErrorKind
  constructor(kind: ApiErrorKind, message?: string) {
    super(message ?? kind)
    this.kind = kind
  }
}

const REQUEST_TIMEOUT_MS = 10_000

const KNOWN_ERRORS: Record<string, ApiErrorKind> = {
  no_puzzle: 'no_puzzle',
  puzzle_changed: 'puzzle_changed',
  rate_limited: 'rate_limited',
  already_exists: 'already_exists',
  already_suggested: 'already_suggested',
  invalid: 'invalid',
  bad_format: 'invalid',
  bad_state: 'bad_state',
}

async function post<T>(fn: string, body: unknown = {}): Promise<T> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!base || !key) throw new ApiError('config', 'Supabase is not configured.')

  // Unstable mobile connections can hang rather than fail: give up after a while.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${base}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError('network', 'Could not reach the server.')
  } finally {
    clearTimeout(timer)
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(KNOWN_ERRORS[data?.error] ?? 'server', data?.message)
  }
  return data as T
}

export async function getDailyPuzzle(): Promise<Puzzle> {
  const call = () => post<{ puzzle_date: string; puzzle_number: number }>('get-daily-puzzle')
  let data
  try {
    data = await call()
  } catch (err) {
    // One quick retry smooths over a dropped packet; real outages still surface.
    if (!(err instanceof ApiError) || err.kind !== 'network') throw err
    data = await call()
  }
  return { puzzleDate: data.puzzle_date, puzzleNumber: data.puzzle_number }
}

/** Dates of past puzzles that can be replayed, newest first. Never includes today or any word. */
export async function getPastPuzzles(): Promise<Puzzle[]> {
  const data = await post<{ puzzles: { puzzle_date: string; puzzle_number: number }[] }>('get-daily-puzzle', { list: true })
  return data.puzzles.map((p) => ({ puzzleDate: p.puzzle_date, puzzleNumber: p.puzzle_number }))
}

interface RawAnswer {
  word: string
  meaning: string | null
  arabic_spelling: string | null
  example_sentence: string | null
  translation: string | null
}

export type GuessResponse =
  | { valid: false }
  | {
      valid: true
      result: TileState[]
      won: boolean
      lost: boolean
      answer: AnswerInfo | null
      /** False when the word is not in the approved word list yet (the guess still counted). */
      known: boolean
      /** Present while the game continues; must be sent back with the next guess. */
      stateToken: string | null
    }

/**
 * `stateToken` is the opaque, server-signed record of the guesses already scored
 * (null for the first guess of the day). The server ignores any history the client
 * claims to have, so the attempt count cannot be faked.
 */
export async function submitGuess(args: {
  guess: string
  stateToken: string | null
  puzzleDate: string
  /** True when replaying a past puzzle instead of today's. */
  archive?: boolean
  /** Anonymous random id, used only so each player is counted once in the community stats. */
  playerId: string
}): Promise<GuessResponse> {
  const data = await post<
    | { valid: false }
    | {
        valid: true
        result: TileState[]
        won: boolean
        lost: boolean
        known?: boolean
        answer?: RawAnswer
        state_token?: string
      }
  >('submit-guess', {
    guess: args.guess,
    ...(args.stateToken ? { state_token: args.stateToken } : {}),
    puzzle_date: args.puzzleDate,
    ...(args.archive ? { archive: true } : {}),
    player_id: args.playerId,
  })
  if (!data.valid) return { valid: false }
  return {
    valid: true,
    result: data.result,
    won: data.won,
    lost: data.lost,
    // An older server version does not send this; assume known so nobody gets a pointless prompt.
    known: data.known !== false,
    stateToken: data.state_token ?? null,
    answer: data.answer
      ? {
          word: data.answer.word,
          meaning: data.answer.meaning,
          arabic: data.answer.arabic_spelling,
          example: data.answer.example_sentence,
          translation: data.answer.translation,
        }
      : null,
  }
}

export interface SuggestionFields {
  word: string
}

export async function submitSuggestion(fields: SuggestionFields): Promise<void> {
  await post('submit-suggestion', { word: fields.word })
}

export interface CommunityBucket {
  /** Index 0 = solved in 1 guess ... index 5 = solved in 6. */
  solved: number[]
  missed: number
  /** Everyone who finished: solved plus missed. */
  players: number
}

export interface CommunityStats {
  today: CommunityBucket
  allTime: CommunityBucket
}

/** Anonymous totals across all players: how many solved in 1, 2, ... 6 guesses. */
export async function getCommunityStats(): Promise<CommunityStats> {
  const data = await post<{ today: CommunityBucket; all_time: CommunityBucket }>('get-community-stats')
  return { today: data.today, allTime: data.all_time }
}
