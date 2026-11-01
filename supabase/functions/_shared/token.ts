/**
 * Signed game state. The browser only ever holds an opaque token; it cannot edit the
 * guess history inside it without invalidating the HMAC signature, so it cannot claim
 * to have made guesses it never made (which would unlock the answer reveal).
 */
export interface GameState {
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

export async function issueToken(state: GameState, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(state)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/** Returns the state if the token is genuine and well-formed, otherwise null. */
export async function readToken(token: unknown, secret: string): Promise<GameState | null> {
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
