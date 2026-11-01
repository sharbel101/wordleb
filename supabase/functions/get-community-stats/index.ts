import { getBeirutDate } from '../_shared/beirut.ts'
import { shapeCommunityStats } from '../_shared/community.ts'
import { adminClient, json, preflight } from '../_shared/http.ts'

// Public, anonymous totals: how many players solved today's puzzle in 1, 2, ... 6 guesses
// (and how many missed), for today and for all days. No answers and no player ids leave here.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  try {
    const today = getBeirutDate()
    const { data, error } = await adminClient().rpc('community_stats', { p_date: today })
    if (error) throw error
    return json(shapeCommunityStats(today, data))
  } catch (err) {
    console.error('get-community-stats failed', err)
    return json({ error: 'server_error' }, 500)
  }
})
