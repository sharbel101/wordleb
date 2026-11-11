import { getBeirutDate } from '../_shared/beirut.ts'
import { adminClient, json, preflight, runInBackground } from '../_shared/http.ts'
import { createVariantCache, resolveSpelling } from '../_shared/spelling.ts'
import { issueToken, readToken } from '../_shared/token.ts'
import { playTurn } from '../_shared/turn.ts'
import { GUESS_FORMAT_MESSAGES, guessFormatProblem, isPastPuzzleDate, isValidPlayerId, normalizeGuess } from '../_shared/validate.ts'

const ENFORCE_WORD_LIST = Deno.env.get('ENFORCE_WORD_LIST') === 'true'

// Registered spelling variants (REEHA -> REE7A), kept in memory for a minute. Server-side only: the
// mapping is never sent to the browser, which only ever learns the canonical spelling of its own guess.
const getVariants = createVariantCache(async () => {
  const { data, error } = await adminClient().from('word_variants').select('variant, canonical_word').limit(5000)
  if (error) throw error
  return data ?? []
})

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
    // Authoritative format check (the browser repeats it only for instant feedback). It runs on the
    // trimmed, lower-cased guess, so letter case and surrounding spaces cannot get around it.
    const formatProblem = guessFormatProblem(guess)
    if (formatProblem) return json({ error: 'bad_format', message: GUESS_FORMAT_MESSAGES[formatProblem] }, 400)

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
    const [puzzleResult, knownResult, variants] = await Promise.all([
      db.from('daily_puzzles').select('word').eq('puzzle_date', puzzleDate).maybeSingle(),
      db.from('words').select('word').ilike('word', guess).eq('approved', true).limit(1),
      getVariants(),
    ])
    if (puzzleResult.error) throw puzzleResult.error
    const puzzle = puzzleResult.data
    if (!puzzle) return json({ error: 'no_puzzle', puzzle_date: puzzleDate }, 404)

    const rawAnswer = String(puzzle.word).trim().toLowerCase()

    // A guess is "known" if it is the answer, an approved word or a registered spelling variant. If
    // the words lookup itself fails we do not know, so the game carries on and nothing is flagged or
    // logged.
    const lookupFailed = !!knownResult.error
    if (lookupFailed) console.error('words lookup failed', knownResult.error?.message)
    const approvedGuess = (knownResult.data?.length ?? 0) > 0

    // A variant is another spelling of a dictionary word, not a word of its own: resolve both sides
    // to their canonical spelling, then score and compare canonical against canonical.
    const spelling = resolveSpelling(guess, rawAnswer, variants, approvedGuess)
    const answer = spelling.answer
    const known = spelling.known || lookupFailed

    // Word-list enforcement: OFF while the dictionary is still being built from play. Turn it on
    // later with the secret ENFORCE_WORD_LIST=true (the answer itself is always accepted).
    if (ENFORCE_WORD_LIST && !known) {
      return json({ valid: false, reason: 'not_in_list' })
    }

    const turn = playTurn(spelling.guess, answer, previous)
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
    // Only when the player typed a variant: the canonical spelling that was scored, so the board shows
    // the word the tiles describe.
    if (spelling.viaVariant) response.canonical = spelling.guess

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
      response.state_token = await issueToken({ d: puzzleDate, g: [...previous, spelling.guess] }, secret)
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
