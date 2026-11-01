import type { Page, Route } from '@playwright/test'
import { getBeirutDate, puzzleNumberFor } from '../supabase/functions/_shared/beirut'
import { issueToken, readToken } from '../supabase/functions/_shared/token'
import { shapeCommunityStats } from '../supabase/functions/_shared/community'
import { playTurn } from '../supabase/functions/_shared/turn'
import { isValidPlayerId } from '../supabase/functions/_shared/validate'

const BASE = 'https://mock.supabase.test'
const TEST_SECRET = 'e2e-only-secret'

export interface MockState {
  puzzleMode: 'ok' | 'missing' | 'down' | 'offline'
  guessMode: 'ok' | 'down' | 'offline'
  date: string
  number: number
  answer: string
  words: Set<string>
  /** Every request the app made, for asserting that nothing extra was sent. */
  requests: { fn: string; body: Record<string, unknown> }[]
  guessDelayMs: number
  statsMode: 'ok' | 'down'
  /** true = unknown words are rejected (word list enforced); false = accepted and logged, like production today. */
  enforce: boolean
  /** word -> anonymous player ids that tried it while it was not in the dictionary. Share one Map to simulate several phones. */
  unknownLog: Map<string, Set<string>>
  /** Finished games across all players: key `date|playerId` -> guesses taken (0 = missed). Share one Map between pages to simulate several phones. */
  community: Map<string, number>
}

export const ANSWER_DETAILS = {
  meaning: 'Bread',
  arabic_spelling: 'خبز',
  example_sentence: 'Jib el 5obez.',
  translation: 'Bring the bread.',
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
}

/** Wrong-but-valid words that pass both the local validator and the mock dictionary. */
export const WRONG_WORDS = ['yalla', 'kifak', 'ba7ar', 'shams', 'habib', 'eerie']

/**
 * Stands in for the three Edge Functions with the same behaviour as the real ones
 * (it reuses the real scoring code), so the whole app can be exercised offline.
 */
export async function mockSupabase(page: Page, overrides: Partial<MockState> = {}): Promise<MockState> {
  const date = getBeirutDate()
  const state: MockState = {
    puzzleMode: 'ok',
    guessMode: 'ok',
    date,
    number: puzzleNumberFor(date),
    answer: '5obez',
    words: new Set(['5obez', 'kteer', 'yalla', 'kifak', 'ba7ar', 'shams', 'habib', 'eerie', '7elou']),
    requests: [],
    guessDelayMs: 0,
    statsMode: 'ok',
    enforce: true,
    unknownLog: new Map(),
    community: new Map(),
    ...overrides,
  }

  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

  await page.route(`${BASE}/functions/v1/*`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })

    const fn = new URL(request.url()).pathname.split('/').pop()!
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    state.requests.push({ fn, body })

    if (fn === 'get-daily-puzzle') {
      if (state.puzzleMode === 'offline') return route.abort('connectionfailed')
      if (state.puzzleMode === 'down') return json(route, 500, { error: 'server_error' })
      if (state.puzzleMode === 'missing') return json(route, 404, { error: 'no_puzzle' })
      return json(route, 200, { puzzle_date: state.date, puzzle_number: state.number, word_length: 5 })
    }

    if (fn === 'submit-guess') {
      if (state.guessDelayMs) await new Promise((r) => setTimeout(r, state.guessDelayMs))
      if (state.guessMode === 'offline') return route.abort('connectionfailed')
      if (state.guessMode === 'down') return json(route, 500, { error: 'server_error' })

      const guess = String(body.guess)
      if (body.puzzle_date && body.puzzle_date !== state.date) {
        return json(route, 409, { error: 'puzzle_changed', puzzle_date: state.date })
      }
      // Same rule as the real function: history comes only from a genuine signed token.
      let previous: string[] = []
      if (body.state_token) {
        const saved = await readToken(body.state_token, TEST_SECRET)
        if (!saved || saved.d !== state.date) return json(route, 400, { error: 'bad_state' })
        previous = saved.g
      }
      const known = guess === state.answer || state.words.has(guess)
      if (!known && state.enforce) return json(route, 200, { valid: false })
      if (!known && isValidPlayerId(body.player_id)) {
        const players = state.unknownLog.get(guess) ?? new Set<string>()
        players.add(String(body.player_id))
        state.unknownLog.set(guess, players)
      }

      const turn = playTurn(guess, state.answer, previous)
      if ('error' in turn) return json(route, 400, { error: 'game_over' })
      const res: Record<string, unknown> = { valid: true, ...turn, known }
      if (turn.won || turn.lost) {
        res.answer = { word: state.answer, ...ANSWER_DETAILS }
        // Same rule as the real function: one result per player per day, the first one wins.
        const key = `${state.date}|${body.player_id}`
        if (isValidPlayerId(body.player_id) && !state.community.has(key)) {
          state.community.set(key, turn.won ? turn.attempt : 0)
        }
      }
      else res.state_token = await issueToken({ d: state.date, g: [...previous, guess] }, TEST_SECRET)
      return json(route, 200, res)
    }

    if (fn === 'get-community-stats') {
      if (state.statsMode === 'down') return json(route, 500, { error: 'server_error' })
      const rows = [0, 1, 2, 3, 4, 5, 6].map((attempts) => {
        const mine = [...state.community].filter(([, a]) => a === attempts)
        return {
          attempts,
          players_today: mine.filter(([k]) => k.startsWith(state.date + '|')).length,
          players_all_time: mine.length,
        }
      })
      return json(route, 200, shapeCommunityStats(state.date, rows))
    }

    return json(route, 404, { error: 'unknown' })
  })

  return state
}

/** Skip the first-visit help modal. */
export async function skipHelp(page: Page) {
  await page.addInitScript(() => localStorage.setItem('wordleb:seen-help', '1'))
}

export async function typeWord(page: Page, word: string) {
  await page.keyboard.type(word)
}

export async function guess(page: Page, word: string) {
  await page.keyboard.type(word)
  await page.keyboard.press('Enter')
}

/** Opens the app and waits until the board is interactive (or an error panel appears). */
export async function openGame(page: Page) {
  await page.goto('/')
  await page.locator('.board-wrap:not(.loading), [role=alert]').first().waitFor()
}
