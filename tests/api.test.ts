import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getCommunityStats, getDailyPuzzle, getPastPuzzles, submitGuess, submitSuggestion } from '../src/game/api'

const PLAYER = '0b8f3a52-5c1e-4d6a-9f27-3e1a7c9d4b10'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('past puzzles', () => {
  it('asks for the list and maps it, newest first', async () => {
    const fetchFn = mockFetch(200, { today: '2026-11-04', puzzles: [{ puzzle_date: '2026-11-03', puzzle_number: 307 }, { puzzle_date: '2026-11-02', puzzle_number: 306 }] })
    await expect(getPastPuzzles()).resolves.toEqual([
      { puzzleDate: '2026-11-03', puzzleNumber: 307 },
      { puzzleDate: '2026-11-02', puzzleNumber: 306 },
    ])
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ list: true })
  })

  it('marks a replay with archive: true, and leaves the flag off for today', async () => {
    const fetchFn = mockFetch(200, { valid: false })
    await submitGuess({ guess: 'yalla', stateToken: null, puzzleDate: '2026-11-02', archive: true, playerId: PLAYER })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toMatchObject({ puzzle_date: '2026-11-02', archive: true })
    await submitGuess({ guess: 'yalla', stateToken: null, puzzleDate: '2026-11-04', playerId: PLAYER })
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).not.toHaveProperty('archive')
  })
})

describe('api client', () => {
  it('calls the edge function with the anon key and maps the puzzle', async () => {
    const fetchFn = mockFetch(200, { puzzle_date: '2026-11-01', puzzle_number: 305, word_length: 5 })
    await expect(getDailyPuzzle()).resolves.toEqual({ puzzleDate: '2026-11-01', puzzleNumber: 305 })

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://example.supabase.co/functions/v1/get-daily-puzzle')
    expect(init.headers.Authorization).toBe('Bearer anon-key')
  })

  it('reports a missing puzzle', async () => {
    mockFetch(404, { error: 'no_puzzle' })
    await expect(getDailyPuzzle()).rejects.toMatchObject({ kind: 'no_puzzle' })
  })

  it('reports network failures and missing config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(getDailyPuzzle()).rejects.toMatchObject({ kind: 'network' })

    vi.stubEnv('VITE_SUPABASE_URL', '')
    await expect(getDailyPuzzle()).rejects.toBeInstanceOf(ApiError)
    await expect(getDailyPuzzle()).rejects.toMatchObject({ kind: 'config' })
  })

  it('maps a scored guess, including the answer on game end', async () => {
    const fetchFn = mockFetch(200, {
      valid: true,
      result: ['correct', 'correct', 'correct', 'correct', 'correct'],
      won: true,
      lost: false,
      attempt: 2,
      answer: { word: '5obez', meaning: 'Bread', arabic_spelling: 'خبز', example_sentence: null, translation: null },
    })
    const res = await submitGuess({ guess: '5obez', stateToken: 'tok.sig', puzzleDate: '2026-11-01', playerId: PLAYER })
    expect(res).toMatchObject({ valid: true, won: true, answer: { word: '5obez', arabic: 'خبز', meaning: 'Bread' } })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
      guess: '5obez',
      state_token: 'tok.sig',
      puzzle_date: '2026-11-01',
      player_id: PLAYER,
    })
  })

  it('returns the next state token, and omits it when the game ends', async () => {
    mockFetch(200, { valid: true, result: ['absent', 'absent', 'absent', 'absent', 'absent'], won: false, lost: false, state_token: 'next.tok' })
    const res = await submitGuess({ guess: 'yalla', stateToken: null, puzzleDate: 'd', playerId: PLAYER })
    expect(res).toMatchObject({ valid: true, stateToken: 'next.tok' })

    mockFetch(200, { valid: true, result: ['correct', 'correct', 'correct', 'correct', 'correct'], won: true, lost: false, answer: { word: '5obez', meaning: null, arabic_spelling: null, example_sentence: null, translation: null } })
    expect(await submitGuess({ guess: '5obez', stateToken: 'next.tok', puzzleDate: 'd', playerId: PLAYER })).toMatchObject({ stateToken: null })
  })

  it('never sends a client-claimed guess history, and omits the token on the first guess', async () => {
    const fetchFn = mockFetch(200, { valid: false })
    await submitGuess({ guess: 'yalla', stateToken: null, puzzleDate: 'd', playerId: PLAYER })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body).toEqual({ guess: 'yalla', puzzle_date: 'd', player_id: PLAYER })
    expect(body).not.toHaveProperty('previous_guesses')
  })

  it('reports a rejected session', async () => {
    mockFetch(400, { error: 'bad_state' })
    await expect(submitGuess({ guess: 'yalla', stateToken: 'forged.tok', puzzleDate: 'd', playerId: PLAYER })).rejects.toMatchObject({ kind: 'bad_state' })
  })

  it('reports a word that is not in the list', async () => {
    mockFetch(200, { valid: false, reason: 'not_in_list' })
    await expect(submitGuess({ guess: 'qqqqq', stateToken: null, puzzleDate: 'd', playerId: PLAYER })).resolves.toEqual({ valid: false })
  })

  it('signals a day rollover', async () => {
    mockFetch(409, { error: 'puzzle_changed' })
    await expect(submitGuess({ guess: 'yalla', stateToken: null, puzzleDate: 'old', playerId: PLAYER })).rejects.toMatchObject({
      kind: 'puzzle_changed',
    })
  })

  it('maps the community stats response', async () => {
    const bucket = { solved: [2, 1, 0, 0, 0, 0], missed: 1, players: 4 }
    const fetchFn = mockFetch(200, { puzzle_date: '2026-11-01', today: bucket, all_time: { ...bucket, players: 9 } })
    await expect(getCommunityStats()).resolves.toEqual({ today: bucket, allTime: { ...bucket, players: 9 } })
    expect(fetchFn.mock.calls[0][0]).toBe('https://example.supabase.co/functions/v1/get-community-stats')
  })

  it('reports community stats being unavailable', async () => {
    mockFetch(500, { error: 'server_error' })
    await expect(getCommunityStats()).rejects.toMatchObject({ kind: 'server' })
  })

  it('surfaces suggestion errors with the server message', async () => {
    mockFetch(429, { error: 'rate_limited', message: 'Slow down' })
    const err = await submitSuggestion({ word: 'yalla' }).catch((e) => e)
    expect(err).toMatchObject({ kind: 'rate_limited', message: 'Slow down' })
  })
})
