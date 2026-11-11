/**
 * Where the browser sends API calls.
 *
 * In production the game talks to its own address (wordleb.com/api/...), which Netlify forwards to
 * Supabase. That avoids a second DNS lookup, TLS handshake and CORS preflight, and keeps working for
 * players whose network throttles or blocks supabase.co. The direct Supabase address stays as the
 * fallback, so a problem with the forwarding never takes the game down.
 */
export interface Endpoint {
  via: 'proxy' | 'direct'
  url: string
}

export function apiConfig(): { base: string; key: string } | null {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  return base && key ? { base, key } : null
}

export function proxyEnabled(): boolean {
  return import.meta.env.VITE_API_PROXY === '1'
}

export function endpointsFor(fn: string): { direct: Endpoint; proxy: Endpoint | null; key: string } | null {
  const cfg = apiConfig()
  if (!cfg) return null
  return {
    key: cfg.key,
    direct: { via: 'direct', url: `${cfg.base}/functions/v1/${fn}` },
    proxy: proxyEnabled() ? { via: 'proxy', url: `/api/${fn}` } : null,
  }
}

export function apiHeaders(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }
}
