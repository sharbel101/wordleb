import { describe, expect, it } from 'vitest'
import { evaluateGuess } from '../supabase/functions/_shared/evaluate'

const c = 'correct'
const p = 'present'
const a = 'absent'

describe('evaluateGuess', () => {
  it('marks an exact match all correct', () => {
    expect(evaluateGuess('yalla', 'yalla')).toEqual([c, c, c, c, c])
  })

  it('marks letters not in the word absent', () => {
    expect(evaluateGuess('qqqqq', 'yalla')).toEqual([a, a, a, a, a])
  })

  it('marks right letter in wrong place present', () => {
    expect(evaluateGuess('ayyyy', 'yalla')).toEqual([p, p, a, a, a])
  })

  it('limits yellows to the number of that letter left in the answer', () => {
    // abide has a single e: only the first guessed e is yellow.
    expect(evaluateGuess('speed', 'abide')).toEqual([a, a, p, a, p])
    // kteer has two e's: both guessed e's in front are yellow, the third is not.
    expect(evaluateGuess('eerie', 'kteer')).toEqual([p, p, p, a, a])
  })

  it('lets exact matches claim a letter before misplaced duplicates', () => {
    // answer has one l, at position 4: the guessed l's in front must stay grey.
    expect(evaluateGuess('lolol', 'ba7ol')).toEqual([a, a, a, c, c])
    // answer has one l at position 2: the first guessed l is yellow, the second grey.
    expect(evaluateGuess('llxxx', 'axlxx')).toEqual([p, a, p, c, c])
  })

  it('treats Arabizi digits like letters', () => {
    expect(evaluateGuess('5obez', '5obez')).toEqual([c, c, c, c, c])
    expect(evaluateGuess('7elou', '5obez')).toEqual([a, p, a, p, a])
  })
})
