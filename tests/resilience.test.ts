import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDailyPuzzle, submitGuess, tuning } from '../src/game/api'
import { browserFamily, flushReports, recordFailure, reporting } from '../src/game/errorLog'
import { MAX_REPORTS_PER_BATCH, validateClientErrors } from '../supabase/functions/_shared/validate'

const PLAYER = '0b8f3a52-5c1e-4d6a-9f27-3e1a7c9d4b10'
const OK = { puzzle_date: '2026-11-04', puzzle_number: 308 }

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function memoryStorage() {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  })
  return m
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  tuning.pauseScale = 0
  reporting.enabled = false
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  tuning.pauseScale = 1
})

describe('retries', () => {
  it('recovers from one dropped request', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new TypeError('dropped')).mockResolvedValue(res(200, OK))
    vi.stubGlobal('fetch', fetchFn)
    await expect(getDailyPuzzle()).resolves.toEqual({ puzzleDate: '2026-11-04', puzzleNumber: 308 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('retries guesses too, since scoring is idempotent', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(res(503, { message: 'busy' })).mockResolvedValue(res(200, { valid: false }))
    vi.stubGlobal('fetch', fetchFn)
    await expect(submitGuess({ guess: 'yalla', stateToken: null, puzzleDate: '2026-11-04', playerId: PLAYER })).resolves.toEqual({ valid: false })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('gives up after three tries and reports a network error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('down'))
    vi.stubGlobal('fetch', fetchFn)
    await expect(getDailyPuzzle()).rejects.toMatchObject({ kind: 'network' })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('reports a server that keeps failing as a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500, { error: 'server_error' })))
    await expect(getDailyPuzzle()).rejects.toMatchObject({ kind: 'server' })
  })

  it('does not retry answers the server meant (rate limit, bad input)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(429, { error: 'rate_limited', message: 'slow down' }))
    vi.stubGlobal('fetch', fetchFn)
    await expect(getDailyPuzzle()).rejects.toMatchObject({ kind: 'rate_limited' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false, userAgent: '' })
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchFn)
    await expect(getDailyPuzzle()).rejects.toMatchObject({ kind: 'network' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('same-origin proxy', () => {
  beforeEach(() => vi.stubEnv('VITE_API_PROXY', '1'))

  it('goes through /api first', async () => {
    const fetchFn = vi.fn().mockResolvedValue(res(200, OK))
    vi.stubGlobal('fetch', fetchFn)
    await getDailyPuzzle()
    expect(fetchFn.mock.calls[0][0]).toBe('/api/get-daily-puzzle')
  })

  it('falls back to Supabase directly when the proxy is broken', async () => {
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/')) return res(502, null)
      return res(200, OK)
    })
    vi.stubGlobal('fetch', fetchFn)
    await expect(getDailyPuzzle()).resolves.toMatchObject({ puzzleNumber: 308 })
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(['/api/get-daily-puzzle', 'https://example.supabase.co/functions/v1/get-daily-puzzle'])
  })

  it('treats an HTML page from a missing /api rule as a failure and falls back', async () => {
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/')) return { ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('not json')) }
      return res(200, OK)
    })
    vi.stubGlobal('fetch', fetchFn)
    await expect(getDailyPuzzle()).resolves.toMatchObject({ puzzleNumber: 308 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('connection-problem log', () => {
  it('reports each failed try and a recovery marker, with no identifying data, then clears the queue', async () => {
    const store = memoryStorage()
    reporting.enabled = true
    let sent: { events: Record<string, unknown>[] } | null = null
    let attempts = 0
    const fetchFn = vi.fn().mockImplementation(async (url: string, init: { body: string }) => {
      if (url.includes('log-client-error')) {
        sent = JSON.parse(init.body)
        return res(200, { ok: true })
      }
      return ++attempts === 1 ? Promise.reject(new TypeError('dropped')) : res(200, OK)
    })
    vi.stubGlobal('fetch', fetchFn)
    await getDailyPuzzle()

    await vi.waitFor(() => expect(sent).not.toBeNull())
    expect(sent!.events.map((e) => `${e.reason}/${e.outcome}`)).toEqual(['fetch_failed/retry', 'recovered/recovered'])
    expect(Object.keys(sent!.events[0]).sort()).toEqual(['attempt', 'browser', 'fn', 'ms', 'net', 'online', 'outcome', 'reason', 'status', 'via'])
    await vi.waitFor(() => expect(store.has('wordleb:errlog')).toBe(false))
  })

  it('does nothing when reporting is off', () => {
    const store = memoryStorage()
    recordFailure({ fn: 'submit-guess', reason: 'timeout', status: null, ms: 10000, via: 'direct', attempt: 1, outcome: 'retry', online: true, net: null, browser: 'chrome' })
    expect(store.size).toBe(0)
  })

  it('sends the queue once and empties it; keeps it when the server cannot be reached', async () => {
    const store = memoryStorage()
    reporting.enabled = true
    recordFailure({ fn: 'submit-guess', reason: 'timeout', status: null, ms: 10000, via: 'direct', attempt: 1, outcome: 'failed', online: true, net: '3g', browser: 'safari' })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await flushReports()
    expect(JSON.parse(store.get('wordleb:errlog')!)).toHaveLength(1)
  })

  it('names the in-app browsers that often misbehave', () => {
    expect(browserFamily('Mozilla/5.0 (iPhone) AppleWebKit Mobile Instagram 300.0')).toBe('instagram')
    expect(browserFamily('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537 SamsungBrowser/25')).toBe('samsung')
    expect(browserFamily('Mozilla/5.0 (iPhone) Version/17 Mobile Safari/604')).toBe('safari')
    expect(browserFamily('Mozilla/5.0 Chrome/130 Safari/537')).toBe('chrome')
  })
})

describe('validateClientErrors', () => {
  const good = { fn: 'submit-guess', reason: 'timeout', status: null, ms: 10001, via: 'proxy', attempt: 1, outcome: 'retry', online: true, net: '3g', browser: 'chrome' }

  it('accepts a well-formed batch and keeps only the known fields', () => {
    const r = validateClientErrors({ events: [{ ...good, player_id: 'x', note: 'hello' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.events[0]).toEqual({ fn: 'submit-guess', reason: 'timeout', status: null, duration_ms: 10001, via: 'proxy', attempt: 1, outcome: 'retry', online: true, net: '3g', browser: 'chrome' })
  })

  it('rejects unknown functions, reasons and malformed batches', () => {
    expect(validateClientErrors({ events: [{ ...good, fn: 'drop table' }] }).ok).toBe(false)
    expect(validateClientErrors({ events: [{ ...good, reason: 'because' }] }).ok).toBe(false)
    expect(validateClientErrors({ events: [] }).ok).toBe(false)
    expect(validateClientErrors({ events: 'x' }).ok).toBe(false)
    expect(validateClientErrors(null).ok).toBe(false)
    expect(validateClientErrors({ events: Array(MAX_REPORTS_PER_BATCH + 1).fill(good) }).ok).toBe(false)
  })

  it('clamps numbers and falls back for unknown browsers', () => {
    const r = validateClientErrors({ events: [{ ...good, ms: 9e9, attempt: 99, status: 99999, browser: '<script>', net: 'wifi' }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.events[0]).toMatchObject({ duration_ms: 120000, attempt: 5, status: 599, browser: 'other', net: null })
  })
})
