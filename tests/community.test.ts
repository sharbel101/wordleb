import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shapeCommunityStats } from '../supabase/functions/_shared/community'
import { isValidPlayerId } from '../supabase/functions/_shared/validate'

describe('shapeCommunityStats', () => {
  it('turns the SQL rows into per-guess counts, today and all time', () => {
    const rows = [
      { attempts: 0, players_today: 1, players_all_time: 4 },
      { attempts: 1, players_today: 2, players_all_time: 5 },
      { attempts: 2, players_today: 0, players_all_time: 3 },
      { attempts: 3, players_today: 4, players_all_time: 9 },
    ]
    expect(shapeCommunityStats('2026-11-01', rows)).toEqual({
      puzzle_date: '2026-11-01',
      today: { solved: [2, 0, 4, 0, 0, 0], missed: 1, players: 7 },
      all_time: { solved: [5, 3, 9, 0, 0, 0], missed: 4, players: 21 },
    })
  })

  it("reports the friend scenario: two players solved it on the first guess", () => {
    const rows = [{ attempts: 1, players_today: 2, players_all_time: 2 }]
    expect(shapeCommunityStats('2026-11-01', rows).today.solved[0]).toBe(2)
  })

  it('treats missing rows and null as zero, and reads bigint strings', () => {
    expect(shapeCommunityStats('d', null).today).toEqual({ solved: [0, 0, 0, 0, 0, 0], missed: 0, players: 0 })
    const rows = [{ attempts: '2', players_today: '3', players_all_time: '10' }]
    const shaped = shapeCommunityStats('d', rows)
    expect(shaped.today.solved[1]).toBe(3)
    expect(shaped.all_time.players).toBe(10)
  })

  it('ignores rows outside 0..6', () => {
    const rows = [{ attempts: 9, players_today: 5, players_all_time: 5 }, { attempts: -1, players_today: 5, players_all_time: 5 }]
    expect(shapeCommunityStats('d', rows).all_time.players).toBe(0)
  })

  it('exposes only counts, never ids, answers or guesses', () => {
    const shaped = shapeCommunityStats('d', [{ attempts: 1, players_today: 1, players_all_time: 1 }])
    expect(Object.keys(shaped).sort()).toEqual(['all_time', 'puzzle_date', 'today'])
    expect(Object.keys(shaped.today).sort()).toEqual(['missed', 'players', 'solved'])
  })
})

describe('isValidPlayerId', () => {
  it('accepts a UUID and rejects anything else', () => {
    expect(isValidPlayerId('0b8f3a52-5c1e-4d6a-9f27-3e1a7c9d4b10')).toBe(true)
    expect(isValidPlayerId('0B8F3A52-5C1E-4D6A-9F27-3E1A7C9D4B10')).toBe(true)
    for (const bad of ['', 'abc', 'zzzzzzzz-5c1e-4d6a-9f27-3e1a7c9d4b10', "0b8f3a52-5c1e-4d6a-9f27-3e1a7c9d4b10'; drop table x;--", 12345, null, undefined]) {
      expect(isValidPlayerId(bad), String(bad)).toBe(false)
    }
  })
})

describe('getPlayerId (anonymous, per browser)', () => {
  let store: Map<string, string>
  beforeEach(() => {
    vi.resetModules()
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('creates a valid UUID once and keeps returning the same one', async () => {
    const { getPlayerId } = await import('../src/game/storage')
    const first = getPlayerId()
    expect(isValidPlayerId(first)).toBe(true)
    expect(getPlayerId()).toBe(first)
    expect(JSON.parse(store.get('wordleb:player')!)).toBe(first)
  })

  it('reuses the id after a reload (a fresh module reads it back)', async () => {
    const first = (await import('../src/game/storage')).getPlayerId()
    vi.resetModules()
    expect((await import('../src/game/storage')).getPlayerId()).toBe(first)
  })

  it('replaces a corrupted saved id', async () => {
    store.set('wordleb:player', JSON.stringify('not-a-uuid'))
    const { getPlayerId } = await import('../src/game/storage')
    expect(isValidPlayerId(getPlayerId())).toBe(true)
  })

  it('still works when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    const { getPlayerId } = await import('../src/game/storage')
    const id = getPlayerId()
    expect(isValidPlayerId(id)).toBe(true)
    expect(getPlayerId()).toBe(id)
  })
})
