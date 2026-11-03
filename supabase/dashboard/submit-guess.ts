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

// ---- _shared/evaluate.ts ----
type TileState = 'correct' | 'present' | 'absent'

/** Standard Wordle scoring, with correct handling of repeated letters. */
function evaluateGuess(guess: string, answer: string): TileState[] {
  const result: TileState[] = Array(guess.length).fill('absent')
  const remaining: Record<string, number> = {}

  // Pass 1: exact matches. Unmatched answer letters become available for pass 2.
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) result[i] = 'correct'
    else remaining[answer[i]] = (remaining[answer[i]] ?? 0) + 1
  }
  // Pass 2: right letter, wrong place, limited by how many are left in the answer.
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'correct') continue
    if (remaining[guess[i]] > 0) {
      result[i] = 'present'
      remaining[guess[i]]--
    }
  }
  return result
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

// ---- _shared/token.ts ----
/**
 * Signed game state. The browser only ever holds an opaque token; it cannot edit the
 * guess history inside it without invalidating the HMAC signature, so it cannot claim
 * to have made guesses it never made (which would unlock the answer reveal).
 */
interface GameState {
  /** Puzzle date (Asia/Beirut) this state belongs to. */
  d: string
  /** Guesses already scored by the server, oldest first. */
  g: string[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bytes = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(bytes, (c) => c.charCodeAt(0))
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function issueToken(state: GameState, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(state)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/** Returns the state if the token is genuine and well-formed, otherwise null. */
async function readToken(token: unknown, secret: string): Promise<GameState | null> {
  if (typeof token !== 'string' || token.length > 2000) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    // `verify` compares signatures in constant time.
    const genuine = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(parts[1]),
      encoder.encode(parts[0]),
    )
    if (!genuine) return null
    const state = JSON.parse(decoder.decode(fromBase64Url(parts[0])))
    const wellFormed =
      typeof state?.d === 'string' &&
      Array.isArray(state.g) &&
      state.g.length <= 6 &&
      state.g.every((g: unknown) => typeof g === 'string')
    return wellFormed ? { d: state.d, g: state.g } : null
  } catch {
    return null
  }
}

// ---- _shared/turn.ts ----



type TurnOutcome =
  | { error: 'game_over' }
  | { result: TileState[]; attempt: number; won: boolean; lost: boolean }

/**
 * Plays one guess. `previous` must come from a verified token (or be empty for the
 * first guess), never from a client-supplied list: the attempt number decides when
 * the answer is revealed, so it has to be trustworthy.
 */
function playTurn(guess: string, answer: string, previous: string[]): TurnOutcome {
  if (previous.length >= MAX_ATTEMPTS || previous.includes(answer)) return { error: 'game_over' }

  const attempt = previous.length + 1
  const won = guess === answer
  return {
    result: evaluateGuess(guess, answer),
    attempt,
    won,
    lost: !won && attempt >= MAX_ATTEMPTS,
  }
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

// ---- submit-guess ----






const ENFORCE_WORD_LIST = Deno.env.get('ENFORCE_WORD_LIST') === 'true'

// Scores one guess against today's answer. The answer and its details are only
// returned once the game is over (solved, or the final attempt was used).
//
// Attempt counting is tamper-proof: each response carries a signed `state_token`
// holding the guesses already scored, and the next request must send it back. The
// client's own list of earlier guesses is never trusted.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    // Fail closed: without a signing secret we cannot count attempts safely.
    const secret = Deno.env.get('GAME_TOKEN_SECRET')
    if (!secret) {
      console.error('GAME_TOKEN_SECRET is not set')
      return json({ error: 'server_error' }, 500)
    }

    const body = await req.json().catch(() => null)
    const guess = normalizeGuess(body?.guess)
    if (!isValidGuessFormat(guess)) {
      return json({ error: 'bad_format', message: 'A guess is exactly 5 valid characters.' }, 400)
    }

    const today = getBeirutDate()
    // Today's puzzle by default. A past puzzle is served only when the client explicitly asks for
    // it with `archive: true`; otherwise a stale date still means "the puzzle changed", as before.
    let puzzleDate = today
    if (typeof body?.puzzle_date === 'string' && body.puzzle_date !== today) {
      if (body.archive !== true || !isPastPuzzleDate(body.puzzle_date, today)) {
        return json({ error: 'puzzle_changed', puzzle_date: today }, 409)
      }
      puzzleDate = body.puzzle_date
    }

    // No token means "first guess of the day". A token that is forged, edited or from
    // another day is refused outright.
    let previous: string[] = []
    if (body?.state_token !== undefined && body?.state_token !== null) {
      const state = await readToken(body.state_token, secret)
      if (!state || state.d !== puzzleDate) {
        return json({ error: 'bad_state', message: 'Your game session is no longer valid.' }, 400)
      }
      previous = state.g
    }

    const db = adminClient()
    // The puzzle and the "is this an approved word?" lookup are independent, so run them together.
    const [puzzleResult, knownResult] = await Promise.all([
      db.from('daily_puzzles').select('word').eq('puzzle_date', puzzleDate).maybeSingle(),
      db.from('words').select('word').ilike('word', guess).eq('approved', true).limit(1),
    ])
    if (puzzleResult.error) throw puzzleResult.error
    const puzzle = puzzleResult.data
    if (!puzzle) return json({ error: 'no_puzzle', puzzle_date: puzzleDate }, 404)

    const answer = String(puzzle.word).trim().toLowerCase()

    // A guess is "known" if it is the answer or an approved word. If the words lookup itself fails
    // we do not know, so the game carries on and nothing is flagged or logged.
    const lookupFailed = !!knownResult.error
    if (lookupFailed) console.error('words lookup failed', knownResult.error?.message)
    const known = guess === answer || lookupFailed || (knownResult.data?.length ?? 0) > 0

    // Word-list enforcement: OFF while the dictionary is still being built from play. Turn it on
    // later with the secret ENFORCE_WORD_LIST=true (the answer itself is always accepted).
    if (ENFORCE_WORD_LIST && !known) {
      return json({ valid: false, reason: 'not_in_list' })
    }

    const turn = playTurn(guess, answer, previous)
    if ('error' in turn) {
      return json({ error: 'game_over', message: 'This puzzle is already finished.' }, 400)
    }

    const response: Record<string, unknown> = {
      valid: true,
      result: turn.result,
      attempt: turn.attempt,
      won: turn.won,
      lost: turn.lost,
      // false = not in the dictionary yet, so the game can offer to suggest it.
      known,
    }

    if (turn.won || turn.lost) {
      const { data: details, error: detailsError } = await db
        .from('words')
        .select('word, meaning, arabic_spelling, example_sentence, translation')
        .ilike('word', answer)
        .limit(1)
        .maybeSingle()
      if (detailsError) throw detailsError
      response.answer = {
        word: answer,
        meaning: details?.meaning ?? null,
        arabic_spelling: details?.arabic_spelling ?? null,
        example_sentence: details?.example_sentence ?? null,
        translation: details?.translation ?? null,
      }

      // Count this finished game once per player per day for the community stats. The attempt
      // number comes from the signed token, so it cannot be faked. This must never break the
      // game, so a failure (e.g. the table is not created yet) is only logged. Replays of past
      // puzzles are not counted: the community numbers are for the day itself.
      if (puzzleDate === today && isValidPlayerId(body?.player_id)) {
        const { error: recordError } = await db
          .from('daily_results')
          .upsert(
            { puzzle_date: puzzleDate, player_id: body.player_id, attempts: turn.won ? turn.attempt : 0 },
            { onConflict: 'puzzle_date,player_id', ignoreDuplicates: true },
          )
        if (recordError) console.error('could not record result', recordError.message)
      }
    } else {
      // The next guess must present this token; only the server can produce it.
      response.state_token = await issueToken({ d: puzzleDate, g: [...previous, guess] }, secret)
    }

    // Remember which unknown words players try, so popular ones can be reviewed and approved.
    // Anonymous (one random id per browser) and done after the response, so it adds no delay.
    if (!known && isValidPlayerId(body?.player_id)) {
      await runInBackground(
        Promise.resolve(
          db
            .from('guess_log')
            .upsert({ word: guess, player_id: body.player_id }, { onConflict: 'word,player_id', ignoreDuplicates: true }),
        ).then(({ error }) => {
          if (error) console.error('could not log guess', error.message)
        }),
      )
    }

    return json(response)
  } catch (err) {
    console.error('submit-guess failed', err)
    return json({ error: 'server_error' }, 500)
  }
})

