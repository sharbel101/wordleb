import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeGuess } from '../src/game/logic'
import { shareResult } from '../src/game/share'
import { clearCachedPuzzle, loadCachedPuzzle, saveCachedPuzzle } from '../src/game/storage'

const env = (overrides: Record<string, unknown> = {}) => ({
  nav: { share: vi.fn().mockResolvedValue(undefined), clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
  isTouch: false,
  legacyCopy: vi.fn().mockReturnValue(false),
  ...overrides,
})

describe('shareResult', () => {
  it('copies to the clipboard on desktop', async () => {
    const e = env()
    expect(await shareResult('grid', e as never)).toBe('copied')
    expect(e.nav.clipboard.writeText).toHaveBeenCalledWith('grid')
    expect(e.nav.share).not.toHaveBeenCalled()
  })

  it('uses the native share sheet on touch devices', async () => {
    const e = env({ isTouch: true })
    expect(await shareResult('grid', e as never)).toBe('shared')
    expect(e.nav.share).toHaveBeenCalledWith({ text: 'grid' })
    expect(e.nav.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('treats dismissing the share sheet as a non-event, not an error or a copy', async () => {
    const e = env({ isTouch: true })
    e.nav.share.mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    expect(await shareResult('grid', e as never)).toBe('cancelled')
    expect(e.nav.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard when native sharing fails', async () => {
    const e = env({ isTouch: true })
    e.nav.share.mockRejectedValue(new Error('not allowed'))
    expect(await shareResult('grid', e as never)).toBe('copied')
  })

  it('falls back to legacy copy, then reports failure', async () => {
    const e = env()
    e.nav.clipboard.writeText.mockRejectedValue(new Error('denied'))
    e.legacyCopy.mockReturnValue(true)
    expect(await shareResult('grid', e as never)).toBe('copied')
    e.legacyCopy.mockReturnValue(false)
    expect(await shareResult('grid', e as never)).toBe('failed')
  })
})

describe('puzzle cache', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('only serves the cache for the matching day and can be cleared', () => {
    saveCachedPuzzle({ puzzleDate: '2026-11-01', puzzleNumber: 305 })
    expect(loadCachedPuzzle('2026-11-01')).toEqual({ puzzleDate: '2026-11-01', puzzleNumber: 305 })
    expect(loadCachedPuzzle('2026-11-02')).toBeNull()
    clearCachedPuzzle()
    expect(loadCachedPuzzle('2026-11-01')).toBeNull()
  })

  it('never stores anything that looks like an answer', () => {
    saveCachedPuzzle({ puzzleDate: '2026-11-01', puzzleNumber: 305 })
    expect(Object.keys(JSON.parse(localStorage.getItem('wordleb:puzzle')!))).toEqual(['puzzleDate', 'puzzleNumber'])
  })
})

describe('describeGuess', () => {
  it('describes each letter for screen readers', () => {
    expect(describeGuess('kifak', ['correct', 'absent', 'present', 'absent', 'absent'], 2)).toBe(
      'Guess 2: K correct, I absent, F present, A absent, K absent.',
    )
  })
})
