import type { TileState } from './logic'
import { apiHeaders, endpointsFor } from './endpoints'
import { deviceInfo, flushReports, recordFailure, type FailureReport } from './errorLog'
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

/**
 * Up to three tries per call. Unstable mobile connections often hang or drop a request without
 * failing cleanly, so each try has its own deadline and a short pause before the next. With the
 * same-origin proxy on, the second try goes straight to Supabase (in case the proxy or its route is
 * the problem), and the third returns to the proxy. Retrying is safe: a guess is scored from the
 * signed state token, so sending it twice gives the same answer.
 */
const TRIES = [
  { timeoutMs: 10_000, waitMs: 0 },
  { timeoutMs: 8_000, waitMs: 300 },
  { timeoutMs: 8_000, waitMs: 1_200 },
]

/** Exposed so tests can skip the pauses. */
export const tuning = { pauseScale: 1 }

type Failure = { reason: FailureReport['reason']; status: number | null; message?: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function post<T>(fn: string, body: unknown = {}): Promise<T> {
  const ep = endpointsFor(fn)
  if (!ep) throw new ApiError('config', 'Supabase is not configured.')

  const payload = JSON.stringify(body)
  const order = ep.proxy ? [ep.proxy, ep.direct, ep.proxy] : [ep.direct, ep.direct, ep.direct]
  let last: Failure | null = null
  let failures = 0

  for (let i = 0; i < TRIES.length; i++) {
    const { timeoutMs, waitMs } = TRIES[i]
    const target = order[i]
    if (waitMs) await sleep(waitMs * tuning.pauseScale)

    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let failure: Failure | null = null
    let result: { data: unknown; ok: boolean } | null = null
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: apiHeaders(ep.key),
        body: payload,
        signal: controller.signal,
      })
      const data = await res.json().catch(() => null)
      if (res.status >= 500) failure = { reason: 'http_5xx', status: res.status, message: data?.message }
      else if (data === null) failure = { reason: 'bad_response', status: res.status }
      else result = { data, ok: res.ok }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      failure = { reason: aborted ? 'timeout' : 'fetch_failed', status: null }
    } finally {
      clearTimeout(timer)
    }
    const ms = Date.now() - startedAt
    const device = deviceInfo()

    if (!failure) {
      if (failures > 0) {
        recordFailure({ fn, reason: 'recovered', status: null, ms, via: target.via, attempt: i + 1, outcome: 'recovered', ...device })
      }
      void flushReports()
      const { data, ok } = result!
      if (!ok) {
        const err = data as { error?: string; message?: string }
        throw new ApiError(KNOWN_ERRORS[err?.error ?? ''] ?? 'server', err?.message)
      }
      return data as T
    }

    // Offline is the player's own state, not a server problem: nothing to retry or report.
    if (!device.online && failure.reason === 'fetch_failed') failure = { ...failure, reason: 'offline' }
    last = failure
    failures++
    const final = i === TRIES.length - 1 || failure.reason === 'offline'
    if (failure.reason !== 'offline') {
      recordFailure({ fn, reason: failure.reason, status: failure.status, ms, via: target.via, attempt: i + 1, outcome: final ? 'failed' : 'retry', ...device })
    }
    if (final) break
  }

  if (last?.reason === 'http_5xx' || last?.reason === 'bad_response') throw new ApiError('server', last.message)
  throw new ApiError('network', 'Could not reach the server.')
}

export async function getDailyPuzzle(): Promise<Puzzle> {
  const data = await post<{ puzzle_date: string; puzzle_number: number }>('get-daily-puzzle')
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
      /** Set when the player typed a registered spelling variant: the canonical spelling that was scored. */
      canonical: string | null
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
        canonical?: string
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
    canonical: typeof data.canonical === 'string' ? data.canonical.toLowerCase() : null,
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
