export const WORD_LENGTH = 5
export const MAX_ATTEMPTS = 6

/** Lebanese Arabizi: Latin letters plus the digits used for Arabic sounds. */
const WORD_RE = /^[a-z235-9]{5}$/
const ARABIC_RE = /^[؀-ۿݐ-ݿ\s]+$/
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/g

/** A word may carry at most this many digits (Arabizi uses a digit for a sound, not for whole words). */
export const MAX_DIGITS = 2

export function countDigits(value: string): number {
  return (value.match(/[0-9]/g) ?? []).length
}

/**
 * Why a (normalised) guess is not well formed, or null when it is. 'characters' = wrong length or an
 * unsupported character; 'digits' = more than MAX_DIGITS numbers. Nothing is ever substituted: a 7 is
 * never turned into an H, or the other way round.
 */
export function guessFormatProblem(value: unknown): 'characters' | 'digits' | null {
  if (typeof value !== 'string' || !WORD_RE.test(value)) return 'characters'
  return countDigits(value) > MAX_DIGITS ? 'digits' : null
}

export const GUESS_FORMAT_MESSAGES = {
  characters: 'A guess is exactly 5 valid characters.',
  digits: `A word can have at most ${MAX_DIGITS} numbers.`,
} as const

export function isValidGuessFormat(value: unknown): value is string {
  return guessFormatProblem(value) === null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date (YYYY-MM-DD) that is strictly before `today`: the only dates the archive may serve. */
export function isPastPuzzleDate(value: unknown, today: string): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value < today
}

const PLAYER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An anonymous random id made in the player's browser (a UUID). Never an account or personal data. */
export function isValidPlayerId(value: unknown): value is string {
  return typeof value === 'string' && PLAYER_ID_RE.test(value)
}

export function normalizeGuess(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export interface SuggestionInput {
  word: string
  meaning: string | null
  arabic_spelling: string | null
  example_sentence: string | null
}

export type SuggestionCheck =
  | { ok: true; value: SuggestionInput }
  | { ok: false; message: string }

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim() : ''
}

export function validateSuggestion(input: unknown): SuggestionCheck {
  const body = (input ?? {}) as Record<string, unknown>
  const word = normalizeGuess(body.word)
  const meaning = cleanText(body.meaning)
  const arabic = cleanText(body.arabic_spelling)
  const example = cleanText(body.example_sentence)

  const problem = guessFormatProblem(word)
  if (problem === 'digits') return { ok: false, message: GUESS_FORMAT_MESSAGES.digits }
  if (problem) {
    return { ok: false, message: 'The word must be exactly 5 characters: letters a-z or the digits 2, 3, 5, 7, 8.' }
  }
  if (meaning.length > 200) {
    return { ok: false, message: 'The meaning is too long (200 characters max).' }
  }
  if (arabic && (arabic.length > 40 || !ARABIC_RE.test(arabic))) {
    return { ok: false, message: 'The Arabic spelling must use Arabic letters only (up to 40 characters).' }
  }
  if (example.length > 200) {
    return { ok: false, message: 'The example sentence is too long (200 characters max).' }
  }

  return {
    ok: true,
    value: {
      word,
      meaning: meaning || null,
      arabic_spelling: arabic || null,
      example_sentence: example || null,
    },
  }
}

/** Sliding-window limiter. In-memory, so it is per function instance: best effort. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return function allow(key: string, now: number = Date.now()): boolean {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= limit) {
      hits.set(key, recent)
      return false
    }
    recent.push(now)
    hits.set(key, recent)
    // Keep the map from growing without bound.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k)
    }
    return true
  }
}

// ---- Client error reports ----------------------------------------------------------------------
// The browser reports requests that failed so connection problems can be diagnosed. Nothing
// identifying is accepted: no player id, no IP (never read), no free text. Every field is
// checked against a fixed list or clamped, so the table can only ever hold these shapes.

export const REPORTED_FUNCTIONS = ['get-daily-puzzle', 'submit-guess', 'submit-suggestion', 'get-community-stats'] as const
export const REPORT_REASONS = ['timeout', 'fetch_failed', 'offline', 'http_5xx', 'http_4xx', 'bad_response', 'recovered'] as const
export const REPORT_OUTCOMES = ['retry', 'failed', 'recovered'] as const
export const REPORT_BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'instagram', 'facebook', 'whatsapp', 'other'] as const
export const REPORT_NETS = ['slow-2g', '2g', '3g', '4g'] as const
export const MAX_REPORTS_PER_BATCH = 20

export interface ClientErrorEvent {
  fn: string
  reason: string
  status: number | null
  duration_ms: number
  via: 'proxy' | 'direct'
  attempt: number
  outcome: string
  online: boolean
  net: string | null
  browser: string
}

function oneOf(list: readonly string[], v: unknown): string | null {
  return typeof v === 'string' && list.includes(v) ? v : null
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(max, Math.max(min, Math.round(v)))
}

export function validateClientErrors(
  body: unknown,
): { ok: true; events: ClientErrorEvent[] } | { ok: false } {
  const raw = (body as { events?: unknown } | null)?.events
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_REPORTS_PER_BATCH) return { ok: false }

  const events: ClientErrorEvent[] = []
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') return { ok: false }
    const fn = oneOf(REPORTED_FUNCTIONS, e.fn)
    const reason = oneOf(REPORT_REASONS, e.reason)
    const outcome = oneOf(REPORT_OUTCOMES, e.outcome)
    const via = e.via === 'proxy' || e.via === 'direct' ? e.via : null
    const attempt = clampInt(e.attempt, 1, 5)
    const duration = clampInt(e.ms, 0, 120_000)
    if (!fn || !reason || !outcome || !via || attempt === null || duration === null) return { ok: false }
    events.push({
      fn,
      reason,
      status: clampInt(e.status, 0, 599),
      duration_ms: duration,
      via,
      attempt,
      outcome,
      online: e.online !== false,
      net: oneOf(REPORT_NETS, e.net),
      browser: oneOf(REPORT_BROWSERS, e.browser) ?? 'other',
    })
  }
  return { ok: true, events }
}
