export const WORD_LENGTH = 5
export const MAX_ATTEMPTS = 6

/** Lebanese Arabizi: Latin letters plus the digits used for Arabic sounds. */
const WORD_RE = /^[a-z235-9]{5}$/
const ARABIC_RE = /^[؀-ۿݐ-ݿ\s]+$/
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u001F\u007F]/g

export function isValidGuessFormat(value: unknown): value is string {
  return typeof value === 'string' && WORD_RE.test(value)
}

export function normalizeGuess(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export interface SuggestionInput {
  word: string
  meaning: string
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

  if (!isValidGuessFormat(word)) {
    return { ok: false, message: 'The word must be exactly 5 characters: letters a-z or the digits 2, 3, 5, 6, 7, 8, 9.' }
  }
  if (meaning.length < 2 || meaning.length > 200) {
    return { ok: false, message: 'Please add a meaning (2 to 200 characters).' }
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
      meaning,
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
