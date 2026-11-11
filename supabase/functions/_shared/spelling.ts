/**
 * Spelling variants. A variant is another way to write an existing dictionary word (REE7A / REEHA),
 * not a separate word. Before a guess is scored it is resolved to its canonical spelling, and the
 * canonical guess is compared with the canonical answer, so tiles and the win check always compare
 * one spelling with one spelling.
 *
 * Everything here is lower case, like the rest of the guess pipeline.
 */

/** variant -> canonical word */
export type VariantMap = ReadonlyMap<string, string>

export interface VariantRow {
  variant: string
  canonical_word: string
}

export function toVariantMap(rows: readonly VariantRow[]): VariantMap {
  const map = new Map<string, string>()
  for (const r of rows) {
    const variant = String(r.variant).trim().toLowerCase()
    const canonical = String(r.canonical_word).trim().toLowerCase()
    if (variant && canonical && variant !== canonical) map.set(variant, canonical)
  }
  return map
}

export interface ResolvedTurn {
  /** What to score: the guess in its canonical spelling. */
  guess: string
  /** What to score against: the answer in its canonical spelling. */
  answer: string
  /** True when the player typed a registered variant (the canonical spelling is returned to them). */
  viaVariant: boolean
  /** A known guess is the answer, an approved word, or a registered variant. */
  known: boolean
}

/**
 * `approvedGuess`: the typed guess is itself an approved dictionary word, so it is canonical already
 * (the database guarantees a spelling is never both a word and a variant).
 */
export function resolveSpelling(guess: string, answer: string, variants: VariantMap, approvedGuess: boolean): ResolvedTurn {
  const canonicalAnswer = variants.get(answer) ?? answer

  let canonicalGuess = guess
  let viaVariant = false
  if (!approvedGuess) {
    const canonical = variants.get(guess)
    if (canonical !== undefined) {
      canonicalGuess = canonical
      viaVariant = true
    }
  }

  return {
    guess: canonicalGuess,
    answer: canonicalAnswer,
    viaVariant,
    known: approvedGuess || viaVariant || canonicalGuess === canonicalAnswer,
  }
}

/**
 * Registered variants, cached per function instance for a minute so scoring a guess costs no extra
 * database round trip. The table is small. A variant added in the admin starts working within the
 * cache lifetime. If a refresh fails, the last good copy is kept (or, with none yet, no variants:
 * the game keeps working with canonical words only and the failure is logged).
 */
export const VARIANT_CACHE_MS = 60_000

export function createVariantCache(
  load: () => Promise<readonly VariantRow[]>,
  now: () => number = Date.now,
  ttlMs: number = VARIANT_CACHE_MS,
) {
  let map: VariantMap = new Map()
  let loadedAt = Number.NEGATIVE_INFINITY
  let inflight: Promise<void> | null = null

  async function refresh() {
    try {
      map = toVariantMap(await load())
      loadedAt = now()
    } catch (err) {
      console.error('could not load spelling variants', err)
      // Do not hammer a failing database: try again after a short pause, keeping what we have.
      loadedAt = now() - ttlMs + 10_000
    }
  }

  return async function get(): Promise<VariantMap> {
    if (now() - loadedAt >= ttlMs) {
      inflight ??= refresh().finally(() => (inflight = null))
      await inflight
    }
    return map
  }
}
