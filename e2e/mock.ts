import type { Page, Route } from '@playwright/test'
import { getBeirutDate, puzzleNumberFor } from '../supabase/functions/_shared/beirut'
import { issueToken, readToken } from '../supabase/functions/_shared/token'
import { playTurn } from '../supabase/functions/_shared/turn'

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
      if (guess !== state.answer && !state.words.has(guess)) return json(route, 200, { valid: false })

      const turn = playTurn(guess, state.answer, previous)
      if ('error' in turn) return json(route, 400, { error: 'game_over' })
      const res: Record<string, unknown> = { valid: true, ...turn }
      if (turn.won || turn.lost) res.answer = { word: state.answer, ...ANSWER_DETAILS }
      else res.state_token = await issueToken({ d: state.date, g: [...previous, guess] }, TEST_SECRET)
      return json(route, 200, res)
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
