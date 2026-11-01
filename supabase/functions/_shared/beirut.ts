export const PUZZLE_TIME_ZONE = 'Asia/Beirut'

/** Puzzle #1 is this date (UTC midnight used purely as a day counter). */
const LAUNCH_DATE = '2026-01-01'

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PUZZLE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export interface BeirutParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function getBeirutParts(now: Date = new Date()): BeirutParts {
  const parts: Record<string, number> = {}
  for (const p of formatter.formatToParts(now)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  }
}

/** Current calendar date in Beirut as YYYY-MM-DD. */
export function getBeirutDate(now: Date = new Date()): string {
  const { year, month, day } = getBeirutParts(now)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Milliseconds until the next Beirut midnight, when the puzzle changes. */
export function msUntilNextBeirutMidnight(now: Date = new Date()): number {
  const { hour, minute, second } = getBeirutParts(now)
  const elapsed = (hour * 3600 + minute * 60 + second) * 1000 + now.getUTCMilliseconds()
  return Math.max(0, 86_400_000 - elapsed)
}

export function puzzleNumberFor(dateKey: string): number {
  const day = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((day(dateKey) - day(LAUNCH_DATE)) / 86_400_000) + 1
}
