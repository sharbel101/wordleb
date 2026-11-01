import { getBeirutDate, puzzleNumberFor } from '../_shared/beirut.ts'
import { adminClient, json, preflight } from '../_shared/http.ts'
import { WORD_LENGTH } from '../_shared/validate.ts'

// Returns which puzzle is live today (Asia/Beirut). Never returns the answer.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  try {
    const puzzleDate = getBeirutDate()
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
