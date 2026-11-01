import { adminClient, json, preflight } from '../_shared/http.ts'
import { createRateLimiter, validateSuggestion } from '../_shared/validate.ts'

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
