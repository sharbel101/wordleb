export interface CommunityBucket {
  /** Index 0 = solved in 1 guess ... index 5 = solved in 6. */
  solved: number[]
  /** Finished the game without solving it. */
  missed: number
  /** Everyone who finished: solved plus missed. */
  players: number
}

export interface CommunityStats {
  puzzle_date: string
  today: CommunityBucket
  all_time: CommunityBucket
}

interface Row {
  attempts: number | string
  players_today: number | string
  players_all_time: number | string
}

function bucket(counts: number[]): CommunityBucket {
  const solved = counts.slice(1, 7)
  const missed = counts[0]
  return { solved, missed, players: solved.reduce((a, b) => a + b, 0) + missed }
}

/**
 * Turns the rows returned by the `community_stats` SQL function (attempts 0..6, with
 * 0 meaning "did not solve") into the shape the browser uses. Missing rows count as zero;
 * Postgres returns bigint counts, which can arrive as strings.
 */
export function shapeCommunityStats(puzzleDate: string, rows: Row[] | null): CommunityStats {
  const today = Array(7).fill(0)
  const allTime = Array(7).fill(0)
  for (const row of rows ?? []) {
    const index = Number(row.attempts)
    if (!Number.isInteger(index) || index < 0 || index > 6) continue
    today[index] = Number(row.players_today) || 0
    allTime[index] = Number(row.players_all_time) || 0
  }
  return { puzzle_date: puzzleDate, today: bucket(today), all_time: bucket(allTime) }
}
