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

// ---- _shared/community.ts ----
interface CommunityBucket {
  /** Index 0 = solved in 1 guess ... index 5 = solved in 6. */
  solved: number[]
  /** Finished the game without solving it. */
  missed: number
  /** Everyone who finished: solved plus missed. */
  players: number
}

interface CommunityStats {
  puzzle_date: string
  today: CommunityBucket
  all_time: CommunityBucket
}

interface Row {
  attempts: number | string
  players_today: number | string
  players_all_time: number | string
}

function bucket(counts: number[]): CommunityBucket {
  const solved = counts.slice(1, 7)
  const missed = counts[0]
  return { solved, missed, players: solved.reduce((a, b) => a + b, 0) + missed }
}

/**
 * Turns the rows returned by the `community_stats` SQL function (attempts 0..6, with
 * 0 meaning "did not solve") into the shape the browser uses. Missing rows count as zero;
 * Postgres returns bigint counts, which can arrive as strings.
 */
function shapeCommunityStats(puzzleDate: string, rows: Row[] | null): CommunityStats {
  const today = Array(7).fill(0)
  const allTime = Array(7).fill(0)
  for (const row of rows ?? []) {
    const index = Number(row.attempts)
    if (!Number.isInteger(index) || index < 0 || index > 6) continue
    today[index] = Number(row.players_today) || 0
    allTime[index] = Number(row.players_all_time) || 0
  }
  return { puzzle_date: puzzleDate, today: bucket(today), all_time: bucket(allTime) }
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

// ---- get-community-stats ----




// Public, anonymous totals: how many players solved today's puzzle in 1, 2, ... 6 guesses
// (and how many missed), for today and for all days. No answers and no player ids leave here.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  try {
    const today = getBeirutDate()
    const { data, error } = await adminClient().rpc('community_stats', { p_date: today })
    if (error) throw error
    return json(shapeCommunityStats(today, data))
  } catch (err) {
    console.error('get-community-stats failed', err)
    return json({ error: 'server_error' }, 500)
  }
})

