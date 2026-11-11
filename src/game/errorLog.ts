import { apiHeaders, endpointsFor } from './endpoints'

/**
 * Connection-problem log. When a request to the server fails, a small anonymous record is kept on
 * the device and sent once the connection works again (a player who cannot reach the server cannot
 * report it at that moment). It holds no player id, no address and no free text: only which call
 * failed, why, how long it took, and rough device info.
 */
export interface FailureReport {
  fn: string
  reason: 'timeout' | 'fetch_failed' | 'offline' | 'http_5xx' | 'http_4xx' | 'bad_response' | 'recovered'
  status: number | null
  ms: number
  via: 'proxy' | 'direct'
  attempt: number
  outcome: 'retry' | 'failed' | 'recovered'
  online: boolean
  net: string | null
  browser: string
}

const QUEUE_KEY = 'wordleb:errlog'
const MAX_QUEUE = 20
const FLUSH_TIMEOUT_MS = 8000
const MIN_FLUSH_GAP_MS = 30_000

/** Off in development and unit tests so they never send anything. */
export const reporting = { enabled: import.meta.env.PROD as boolean }

export function browserFamily(ua: string): string {
  if (/Instagram/i.test(ua)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook'
  if (/WhatsApp/i.test(ua)) return 'whatsapp'
  if (/SamsungBrowser/i.test(ua)) return 'samsung'
  if (/Edg\//i.test(ua)) return 'edge'
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox'
  if (/Chrome|CriOS/i.test(ua)) return 'chrome'
  if (/Safari/i.test(ua)) return 'safari'
  return 'other'
}

export function deviceInfo(): { online: boolean; net: string | null; browser: string } {
  const nav = typeof navigator === 'undefined' ? null : navigator
  const conn = (nav as (Navigator & { connection?: { effectiveType?: string } }) | null)?.connection
  return {
    online: nav?.onLine !== false,
    net: conn?.effectiveType ?? null,
    browser: browserFamily(nav?.userAgent ?? ''),
  }
}

function readQueue(): FailureReport[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(q: FailureReport[]) {
  try {
    if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)))
    else localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* storage unavailable: reports are best effort */
  }
}

export function recordFailure(report: FailureReport): void {
  if (!reporting.enabled) return
  writeQueue([...readQueue(), report])
}

let flushing = false
let lastFlush = 0

/** Sends queued reports. Never throws and never records its own failures (no feedback loop). */
export async function flushReports(): Promise<void> {
  if (!reporting.enabled || flushing) return
  const batch = readQueue().slice(0, MAX_QUEUE)
  if (!batch.length) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (Date.now() - lastFlush < MIN_FLUSH_GAP_MS) return
  const ep = endpointsFor('log-client-error')
  if (!ep) return

  flushing = true
  lastFlush = Date.now()
  try {
    for (const target of [ep.proxy, ep.direct]) {
      if (!target) continue
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS)
      try {
        const res = await fetch(target.url, {
          method: 'POST',
          headers: apiHeaders(ep.key),
          body: JSON.stringify({ events: batch }),
          signal: controller.signal,
        })
        // Accepted, or rejected as malformed/over the cap: either way do not resend the same batch.
        if (res.ok || res.status === 400 || res.status === 429) {
          writeQueue(readQueue().slice(batch.length))
          return
        }
      } catch {
        /* try the next route */
      } finally {
        clearTimeout(timer)
      }
    }
  } finally {
    flushing = false
  }
}
