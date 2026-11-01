import { describe, expect, it } from 'vitest'
import {
  getBeirutDate,
  getBeirutParts,
  msUntilNextBeirutMidnight,
  puzzleNumberFor,
} from '../supabase/functions/_shared/beirut'

describe('Beirut date', () => {
  it('uses UTC+2 in winter, so late UTC evening is already the next day', () => {
    expect(getBeirutDate(new Date('2026-01-10T22:30:00Z'))).toBe('2026-01-11')
    expect(getBeirutDate(new Date('2026-01-10T21:59:59Z'))).toBe('2026-01-10')
  })

  it('uses UTC+3 in summer (daylight saving)', () => {
    expect(getBeirutDate(new Date('2026-07-10T20:59:59Z'))).toBe('2026-07-10')
    expect(getBeirutDate(new Date('2026-07-10T21:00:00Z'))).toBe('2026-07-11')
  })

  it('reads the hour in Beirut time with a 24-hour clock', () => {
    expect(getBeirutParts(new Date('2026-01-10T22:00:00Z')).hour).toBe(0)
    expect(getBeirutParts(new Date('2026-01-10T10:15:30Z'))).toMatchObject({ hour: 12, minute: 15, second: 30 })
  })

  it('counts down to the next Beirut midnight', () => {
    // 21:59:00 UTC in winter = 23:59:00 Beirut
    expect(msUntilNextBeirutMidnight(new Date('2026-01-10T21:59:00Z'))).toBe(60_000)
    // 22:00:00 UTC = 00:00:00 Beirut: a full day to go
    expect(msUntilNextBeirutMidnight(new Date('2026-01-10T22:00:00Z'))).toBe(86_400_000)
  })
})

describe('puzzleNumberFor', () => {
  it('starts at 1 on launch day and increments daily', () => {
    expect(puzzleNumberFor('2026-01-01')).toBe(1)
    expect(puzzleNumberFor('2026-01-02')).toBe(2)
    expect(puzzleNumberFor('2026-11-01')).toBe(305)
  })
})
