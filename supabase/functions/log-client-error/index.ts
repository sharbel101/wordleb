import { adminClient, json, preflight } from '../_shared/http.ts'
import { createRateLimiter, validateClientErrors } from '../_shared/validate.ts'

// Best-effort per-IP limit (per function instance), plus a global hourly cap read from the table.
// The IP is used only for this in-memory counter and is never stored.
const allowIp = createRateLimiter(30, 10 * 60 * 1000)
const GLOBAL_HOURLY_CAP = 3000

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
    if (!allowIp(clientIp(req))) return json({ error: 'rate_limited' }, 429)

    const check = validateClientErrors(await req.json().catch(() => null))
    if (!check.ok) return json({ error: 'invalid' }, 400)

    const db = adminClient()
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error: countError } = await db
      .from('client_errors')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since)
    if (countError) throw countError
    if ((count ?? 0) >= GLOBAL_HOURLY_CAP) return json({ error: 'rate_limited' }, 429)

    const { error } = await db.from('client_errors').insert(check.events)
    if (error) throw error
    return json({ ok: true })
  } catch (err) {
    console.error('log-client-error failed', err)
    return json({ error: 'server_error' }, 500)
  }
})
