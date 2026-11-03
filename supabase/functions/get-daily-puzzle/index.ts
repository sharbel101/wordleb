import { getBeirutDate, puzzleNumberFor } from '../_shared/beirut.ts'
import { adminClient, json, preflight } from '../_shared/http.ts'
import { WORD_LENGTH } from '../_shared/validate.ts'

// Returns which puzzle is live today (Asia/Beirut), or the list of past puzzles. Never returns an answer.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  try {
    const puzzleDate = getBeirutDate()

    // `{ list: true }` returns the dates of past puzzles (never today's, never any word) so the
    // game can offer them for replay.
    const body = await req.json().catch(() => null)
    if (body?.list === true) {
      const { data: past, error: listError } = await adminClient()
        .from('daily_puzzles')
        .select('puzzle_date')
        .lt('puzzle_date', puzzleDate)
        .order('puzzle_date', { ascending: false })
        .limit(120)
      if (listError) throw listError
      return json({
        today: puzzleDate,
        puzzles: (past ?? []).map((r) => ({
          puzzle_date: r.puzzle_date,
          puzzle_number: puzzleNumberFor(r.puzzle_date),
        })),
      })
    }

    const { data, error } = await adminClient()
      .from('daily_puzzles')
      .select('puzzle_date')
      .eq('puzzle_date', puzzleDate)
      .maybeSingle()

    if (error) throw error
    if (!data) return json({ error: 'no_puzzle', puzzle_date: puzzleDate }, 404)

    return json({
      puzzle_date: puzzleDate,
      puzzle_number: puzzleNumberFor(puzzleDate),
      word_length: WORD_LENGTH,
    })
  } catch (err) {
    console.error('get-daily-puzzle failed', err)
    return json({ error: 'server_error' }, 500)
  }
})
