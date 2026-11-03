import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildShareText, formatCountdown, getKeyStates, isWellFormedGuess } from '../src/game/logic'
import { loadGame, loadPastGame, loadStats, recordResult, saveGame, savePastGame } from '../src/game/storage'

function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
}

describe('getKeyStates', () => {
  it('keeps the best state seen for each key', () => {
    const states = getKeyStates(
      ['yalla', 'ba7ar'],
      [
        ['absent', 'present', 'absent', 'absent', 'absent'],
        ['absent', 'correct', 'absent', 'absent', 'absent'],
      ],
    )
    expect(states.a).toBe('correct')
    expect(states.y).toBe('absent')
    expect(states.l).toBe('absent')
    expect(states.b).toBe('absent')
  })
})

describe('formatting helpers', () => {
  it('formats countdowns', () => {
    expect(formatCountdown(0)).toBe('00:00:00')
    expect(formatCountdown(3_661_000)).toBe('01:01:01')
    expect(formatCountdown(-5)).toBe('00:00:00')
  })

  it('checks guess format', () => {
    expect(isWellFormedGuess('5obez')).toBe(true)
    expect(isWellFormedGuess('5obe')).toBe(false)
    expect(isWellFormedGuess('5obe!')).toBe(false)
  })

  it('builds share text without revealing letters', () => {
    const text = buildShareText(
      [
        ['absent', 'present', 'absent', 'absent', 'absent'],
        ['correct', 'correct', 'correct', 'correct', 'correct'],
      ],
      'won',
      305,
    )
    expect(text).toBe('wordleb #305 2/6\n\n⬛🟨⬛⬛⬛\n🟩🟩🟩🟩🟩\n\nhttps://wordleb.com')
    const lost = buildShareText([['absent', 'absent', 'absent', 'absent', 'absent']], 'lost', 7)
    expect(lost).toContain('X/6')
    expect(lost.split('\n').at(-1)).toBe('https://wordleb.com') // the link is always the last line
    expect(lost.startsWith('wordleb #7')).toBe(true) // lowercase, one word
  })
})

describe('local persistence', () => {
  beforeEach(stubLocalStorage)

  it('restores only the game saved for the same puzzle date', () => {
    saveGame({ dateKey: '2026-11-01', guesses: ['yalla'], results: [['absent', 'absent', 'absent', 'absent', 'absent']], status: 'playing', answer: null, stateToken: 'tok.sig' })
    expect(loadGame('2026-11-01')?.guesses).toEqual(['yalla'])
    expect(loadGame('2026-11-02')).toBeNull()
  })

  it('will not resume an in-progress game that has no server proof of its guesses', () => {
    saveGame({ dateKey: '2026-11-01', guesses: ['yalla'], results: [['absent', 'absent', 'absent', 'absent', 'absent']], status: 'playing', answer: null, stateToken: null })
    expect(loadGame('2026-11-01')).toBeNull()
    // A finished game legitimately has no token and must still restore.
    saveGame({ dateKey: '2026-11-01', guesses: ['5obez'], results: [['correct', 'correct', 'correct', 'correct', 'correct']], status: 'won', answer: { word: '5obez', meaning: null, arabic: null, example: null, translation: null }, stateToken: null })
    expect(loadGame('2026-11-01')?.status).toBe('won')
  })

  it('keeps replays of past days apart from today, one per date', () => {
    const lost = { guesses: ['yalla'], results: [['absent', 'absent', 'absent', 'absent', 'absent']] as const, status: 'lost' as const, answer: null, stateToken: null }
    saveGame({ dateKey: '2026-11-04', guesses: [], results: [], status: 'playing', answer: null, stateToken: null })
    savePastGame({ dateKey: '2026-11-02', ...lost, results: [[...lost.results[0]]] })
    savePastGame({ dateKey: '2026-11-03', ...lost, results: [[...lost.results[0]]], status: 'playing', stateToken: 'tok.sig' })
    expect(loadPastGame('2026-11-02')?.status).toBe('lost')
    expect(loadPastGame('2026-11-03')?.status).toBe('playing')
    expect(loadPastGame('2026-11-01')).toBeNull()
    expect(loadGame('2026-11-04')?.guesses).toEqual([]) // today's slot is untouched
    expect(loadGame('2026-11-02')).toBeNull()
  })

  it('finds a past day that was played live and still sits in the main slot', () => {
    saveGame({ dateKey: '2026-11-03', guesses: ['5obez'], results: [['correct', 'correct', 'correct', 'correct', 'correct']], status: 'won', answer: null, stateToken: null })
    expect(loadPastGame('2026-11-03')?.status).toBe('won')
  })

  it('ignores corrupted saves', () => {
    saveGame({ dateKey: '2026-11-01', guesses: ['yalla'], results: [], status: 'playing', answer: null, stateToken: 'tok.sig' })
    expect(loadGame('2026-11-01')).toBeNull()
  })

  it('tracks wins, streaks and the guess distribution', () => {
    recordResult('2026-11-01', true, 3)
    recordResult('2026-11-02', true, 4)
    let stats = recordResult('2026-11-03', false, 6)
    expect(stats).toMatchObject({ played: 3, wins: 2, currentStreak: 0, maxStreak: 2 })
    expect(stats.distribution).toEqual([0, 0, 1, 1, 0, 0])

    stats = recordResult('2026-11-05', true, 2) // skipped a day: streak restarts at 1
    expect(stats.currentStreak).toBe(1)
    expect(loadStats().maxStreak).toBe(2)
  })

  it('does not double count the same puzzle', () => {
    recordResult('2026-11-01', true, 3)
    expect(recordResult('2026-11-01', true, 3).played).toBe(1)
  })

  it('continues a streak across a month boundary', () => {
    recordResult('2026-10-31', true, 3)
    expect(recordResult('2026-11-01', true, 3).currentStreak).toBe(2)
  })
})
