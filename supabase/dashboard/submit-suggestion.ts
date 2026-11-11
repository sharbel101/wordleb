import { createClient } from 'npm:@supabase/supabase-js@2'

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

function isValidGuessFormat(value: unknown): value is string {
  return typeof value === 'string' && WORD_RE.test(value)
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

  if (!isValidGuessFormat(word)) {
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

// ---- submit-suggestion ----



// Best-effort per-IP limit (per function instance) ...
const allowIp = createRateLimiter(3, 10 * 60 * 1000)
// ... backed by a global cap, counted from the suggestions table itself.
const GLOBAL_HOURLY_CAP = 100

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    if (!allowIp(clientIp(req))) {
      return json({ error: 'rate_limited', message: 'Too many suggestions. Please try again in a few minutes.' }, 429)
    }

    const check = validateSuggestion(await req.json().catch(() => null))
    if (!check.ok) return json({ error: 'invalid', message: check.message }, 400)
    const suggestion = check.value

    const db = adminClient()

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error: countError } = await db
      .from('suggestions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since)
    if (countError) throw countError
    if ((count ?? 0) >= GLOBAL_HOURLY_CAP) {
      return json({ error: 'rate_limited', message: 'We are getting lots of suggestions right now. Please try again later.' }, 429)
    }

    const { data: existing, error: existingError } = await db
      .from('words')
      .select('word')
      .ilike('word', suggestion.word)
      .limit(1)
    if (existingError) throw existingError
    if (existing && existing.length > 0) {
      return json({ error: 'already_exists', message: 'We already have that word.' }, 409)
    }

    const { data: pending, error: pendingError } = await db
      .from('suggestions')
      .select('id')
      .ilike('word', suggestion.word)
      .limit(1)
    if (pendingError) throw pendingError
    if (pending && pending.length > 0) {
      return json({ error: 'already_suggested', message: 'Someone already suggested that word.' }, 409)
    }

    const { error: insertError } = await db.from('suggestions').insert(suggestion)
    if (insertError) throw insertError

    return json({ ok: true })
  } catch (err) {
    console.error('submit-suggestion failed', err)
    return json({ error: 'server_error' }, 500)
  }
})

