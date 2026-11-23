import { describe, expect, it } from 'vitest'
import { celebrationFor } from '../src/game/celebrations'

describe('celebrations', () => {
  it('greets on Independence Day puzzle', () => {
    expect(celebrationFor('2026-11-23')).toEqual({ message: 'Happy Independence Day!' })
  })

  it('does nothing on an ordinary day or with no date', () => {
    expect(celebrationFor('2026-11-24')).toBeNull()
    expect(celebrationFor('')).toBeNull()
    expect(celebrationFor(null)).toBeNull()
    expect(celebrationFor(undefined)).toBeNull()
  })
})
