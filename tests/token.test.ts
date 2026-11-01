import { describe, expect, it } from 'vitest'
import { issueToken, readToken } from '../supabase/functions/_shared/token'
import { playTurn } from '../supabase/functions/_shared/turn'

const TEST_HMAC_KEY = 'unit-test-secret'
const state = { d: '2026-11-01', g: ['yalla', 'kifak'] }

describe('signed game token', () => {
  it('round-trips a genuine state', async () => {
    const token = await issueToken(state, TEST_HMAC_KEY)
    expect(await readToken(token, TEST_HMAC_KEY)).toEqual(state)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await issueToken(state, TEST_HMAC_KEY)
    expect(await readToken(token, 'another-secret')).toBeNull()
  })

  it('rejects an edited payload (the attack: claim more guesses than were made)', async () => {
    const token = await issueToken({ d: '2026-11-01', g: ['yalla'] }, TEST_HMAC_KEY)
    const forgedPayload = btoa(JSON.stringify({ d: '2026-11-01', g: ['a', 'b', 'c', 'd', 'e'] }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
    const forged = `${forgedPayload}.${token.split('.')[1]}`
    expect(await readToken(forged, TEST_HMAC_KEY)).toBeNull()
  })

  it('rejects a flipped signature byte', async () => {
    const token = await issueToken(state, TEST_HMAC_KEY)
    const [payload, sig] = token.split('.')
    const flipped = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1)
    expect(await readToken(`${payload}.${flipped}`, TEST_HMAC_KEY)).toBeNull()
  })

  it.each([undefined, null, '', 'abc', 'a.b.c', '.', 'x.', '.x', 42, {}, 'a'.repeat(3000)])(
    'rejects malformed input %s',
    async (bad) => {
      expect(await readToken(bad, TEST_HMAC_KEY)).toBeNull()
    },
  )

  it('rejects a correctly signed token whose payload has the wrong shape', async () => {
    const odd = await issueToken({ d: '2026-11-01', g: [1, 2] as unknown as string[] }, TEST_HMAC_KEY)
    expect(await readToken(odd, TEST_HMAC_KEY)).toBeNull()
    const long = await issueToken({ d: '2026-11-01', g: Array(7).fill('yalla') }, TEST_HMAC_KEY)
    expect(await readToken(long, TEST_HMAC_KEY)).toBeNull()
  })

  it('contains no answer, only guesses the player already made', async () => {
    const token = await issueToken({ d: '2026-11-01', g: ['yalla'] }, TEST_HMAC_KEY)
    expect(atob(token.split('.')[0].replaceAll('-', '+').replaceAll('_', '/'))).toBe('{"d":"2026-11-01","g":["yalla"]}')
  })
})

describe('playTurn: when the answer may be revealed', () => {
  it('a first guess (no token) is attempt 1 and never ends the game on a miss', () => {
    // This is the old exploit: with no verified history, the server now assumes attempt 1.
    expect(playTurn('zzzzz', '5obez', [])).toMatchObject({ attempt: 1, won: false, lost: false })
  })

  it('only a verified history of five guesses makes a sixth miss a loss', () => {
    const five = ['a1', 'b2', 'c3', 'd4', 'e5']
    expect(playTurn('zzzzz', '5obez', five)).toMatchObject({ attempt: 6, won: false, lost: true })
    expect(playTurn('zzzzz', '5obez', five.slice(0, 4))).toMatchObject({ attempt: 5, lost: false })
  })

  it('a correct guess wins on any attempt', () => {
    expect(playTurn('5obez', '5obez', [])).toMatchObject({ attempt: 1, won: true, lost: false })
    expect(playTurn('5obez', '5obez', ['a', 'b', 'c', 'd', 'e'])).toMatchObject({ attempt: 6, won: true })
  })

  it('refuses to continue a finished game', () => {
    expect(playTurn('zzzzz', '5obez', ['yalla', '5obez'])).toEqual({ error: 'game_over' })
    expect(playTurn('zzzzz', '5obez', Array(6).fill('yalla'))).toEqual({ error: 'game_over' })
  })

  it('scores letters with the shared algorithm', () => {
    const turn = playTurn('eerie', 'kteer', [])
    expect('result' in turn && turn.result).toEqual(['present', 'present', 'present', 'absent', 'absent'])
  })
})
