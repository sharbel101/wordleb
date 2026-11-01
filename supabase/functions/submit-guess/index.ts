import { getBeirutDate } from '../_shared/beirut.ts'
import { adminClient, json, preflight } from '../_shared/http.ts'
import { issueToken, readToken } from '../_shared/token.ts'
import { playTurn } from '../_shared/turn.ts'
import { isValidGuessFormat, normalizeGuess } from '../_shared/validate.ts'

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
    if (typeof body?.puzzle_date === 'string' && body.puzzle_date !== today) {
      return json({ error: 'puzzle_changed', puzzle_date: today }, 409)
    }

    // No token means "first guess of the day". A token that is forged, edited or from
    // another day is refused outright.
    let previous: string[] = []
    if (body?.state_token !== undefined && body?.state_token !== null) {
      const state = await readToken(body.state_token, secret)
      if (!state || state.d !== today) {
        return json({ error: 'bad_state', message: 'Your game session is no longer valid.' }, 400)
      }
      previous = state.g
    }

    const db = adminClient()
    const { data: puzzle, error: puzzleError } = await db
      .from('daily_puzzles')
      .select('word')
      .eq('puzzle_date', today)
      .maybeSingle()
    if (puzzleError) throw puzzleError
    if (!puzzle) return json({ error: 'no_puzzle', puzzle_date: today }, 404)

    const answer = String(puzzle.word).trim().toLowerCase()

    // Word-list check: OFF until the `words` table is filled. Any well-formed 5-character
    // guess is scored. Turn it on later with the secret ENFORCE_WORD_LIST=true, after which
    // guesses must be approved dictionary words (the answer itself is always accepted).
    if (ENFORCE_WORD_LIST && guess !== answer) {
      const { data: known, error: wordError } = await db
        .from('words')
        .select('word')
        .ilike('word', guess)
        .eq('approved', true)
        .limit(1)
      if (wordError) throw wordError
      if (!known || known.length === 0) {
        return json({ valid: false, reason: 'not_in_list' })
      }
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
    } else {
      // The next guess must present this token; only the server can produce it.
      response.state_token = await issueToken({ d: today, g: [...previous, guess] }, secret)
    }

    return json(response)
  } catch (err) {
    console.error('submit-guess failed', err)
    return json({ error: 'server_error' }, 500)
  }
})
