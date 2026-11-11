import { createClient } from 'npm:@supabase/supabase-js@2'

// ---- _shared/beirut.ts ----
const PUZZLE_TIME_ZONE = 'Asia/Beirut'

/** Puzzle #1 is this date (UTC midnight used purely as a day counter). */
const LAUNCH_DATE = '2026-01-01'

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PUZZLE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

interface BeirutParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getBeirutParts(now: Date = new Date()): BeirutParts {
  const parts: Record<string, number> = {}
  for (const p of formatter.formatToParts(now)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

/** Current calendar date in Beirut as YYYY-MM-DD. */
function getBeirutDate(now: Date = new Date()): string {
  const { year, month, day } = getBeirutParts(now)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Milliseconds until the next Beirut midnight, when the puzzle changes. */
function msUntilNextBeirutMidnight(now: Date = new Date()): number {
  const { hour, minute, second } = getBeirutParts(now)
  const elapsed = (hour * 3600 + minute * 60 + second) * 1000 + now.getUTCMilliseconds()
  return Math.max(0, 86_400_000 - elapsed)
}

function puzzleNumberFor(dateKey: string): number {
  const day = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((day(dateKey) - day(LAUNCH_DATE)) / 86_400_000) + 1
}

// ---- _shared/http.ts ----


const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function preflight(): Response {
  return new Response('ok', { headers: corsHeaders })
}

/**
 * Service-role client. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
 * into every Edge Function by Supabase; the key never reaches the browser.
 */
function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Lets slow, non-essential work (like logging) finish after the response has been sent, so it never
 * delays the player. Supabase Edge Functions provide EdgeRuntime.waitUntil; if it is missing
 * (e.g. when run locally) the work is simply awaited. Failures are logged, never thrown.
 */
async function runInBackground(work: Promise<unknown>): Promise<void> {
  const guarded = work.catch((err) => console.error('background task failed', err))
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(guarded)
  else await guarded
}

// ---- _shared/validate.ts ----
const WORD_LENGTH = 5
const MAX_ATTEMPTS = 6

/** Lebanese Arabizi: Latin letters plus the digits used for Arabic sounds. */
const WORD_RE = /^[a-z235-9]{5}$/
const ARABIC_RE = /^[؀-ۿݐ-ݿ\s]+$/
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/g

/** A word may carry at most this many digits (Arabizi uses a digit for a sound, not for whole words). */
const MAX_DIGITS = 2

function countDigits(value: string): number {
  return (value.match(/[0-9]/g) ?? []).length
}

/**
 * Why a (normalised) guess is not well formed, or null when it is. 'characters' = wrong length or an
 * unsupported character; 'digits' = more than MAX_DIGITS numbers. Nothing is ever substituted: a 7 is
 * never turned into an H, or the other way round.
 */
function guessFormatProblem(value: unknown): 'characters' | 'digits' | null {
  if (typeof value !== 'string' || !WORD_RE.test(value)) return 'characters'
  return countDigits(value) > MAX_DIGITS ? 'digits' : null
}

const GUESS_FORMAT_MESSAGES = {
  characters: 'A guess is exactly 5 valid characters.',
  digits: `A word can have at most ${MAX_DIGITS} numbers.`,
} as const

function isValidGuessFormat(value: unknown): value is string {
  return guessFormatProblem(value) === null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date (YYYY-MM-DD) that is strictly before `today`: the only dates the archive may serve. */
function isPastPuzzleDate(value: unknown, today: string): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value < today
}

const PLAYER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An anonymous random id made in the player's browser (a UUID). Never an account or personal data. */
function isValidPlayerId(value: unknown): value is string {
  return typeof value === 'string' && PLAYER_ID_RE.test(value)
}

function normalizeGuess(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

interface SuggestionInput {
  word: string
  meaning: string | null
  arabic_spelling: string | null
  example_sentence: string | null
}

type SuggestionCheck =
  | { ok: true; value: SuggestionInput }
  | { ok: false; message: string }

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim() : ''
}

function validateSuggestion(input: unknown): SuggestionCheck {
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
function createRateLimiter(limit: number, windowMs: number) {
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

const REPORTED_FUNCTIONS = ['get-daily-puzzle', 'submit-guess', 'submit-suggestion', 'get-community-stats'] as const
const REPORT_REASONS = ['timeout', 'fetch_failed', 'offline', 'http_5xx', 'http_4xx', 'bad_response', 'recovered'] as const
const REPORT_OUTCOMES = ['retry', 'failed', 'recovered'] as const
const REPORT_BROWSERS = ['chrome', 'safari', 'firefox', 'edge', 'samsung', 'instagram', 'facebook', 'whatsapp', 'other'] as const
const REPORT_NETS = ['slow-2g', '2g', '3g', '4g'] as const
const MAX_REPORTS_PER_BATCH = 20

interface ClientErrorEvent {
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

function validateClientErrors(
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

// ---- get-daily-puzzle ----




// Returns which puzzle is live today (Asia/Beirut), or the list of past puzzles. Never returns an answer.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  try {
    const puzzleDate = getBeirutDate()

    // `{ list: true }` returns the dates of past puzzles (never today's, never any word) so the
    // game can offer them for replay.
    const body = await req.json().catch(() => null)
    if (body?.list === true) {
      const { data: past, error: listError } = await adminClient()
        .from('daily_puzzles')
        .select('puzzle_date')
        .lt('puzzle_date', puzzleDate)
        .order('puzzle_date', { ascending: false })
        .limit(120)
      if (listError) throw listError
      return json({
        today: puzzleDate,
        puzzles: (past ?? []).map((r) => ({
          puzzle_date: r.puzzle_date,
          puzzle_number: puzzleNumberFor(r.puzzle_date),
        })),
      })
    }

    const { data, error } = await adminClient()
      .from('daily_puzzles')
      .select('puzzle_date')
      .eq('puzzle_date', puzzleDate)
      .maybeSingle()

    if (error) throw error
    if (!data) return json({ error: 'no_puzzle', puzzle_date: puzzleDate }, 404)

    return json({
      puzzle_date: puzzleDate,
      puzzle_number: puzzleNumberFor(puzzleDate),
      word_length: WORD_LENGTH,
    })
  } catch (err) {
    console.error('get-daily-puzzle failed', err)
    return json({ error: 'server_error' }, 500)
  }
})

