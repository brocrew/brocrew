import { describe, expect, it } from 'vitest'
import {
  RAN_IT,
  theStampMovedNothing,
  whatTheCliDid,
  type CommandArmEvidence,
} from '../smoke/command-as-typed-evidence'

/**
 * 🔴 **708 · the verdict `probe:claude-command-as-typed` asserts**, with each answer planted — so the
 * probe's reading of the CLI cannot drift while the probe itself is outside `ci`.
 *
 * ⚑ The planted frames are the ones the probe MEASURED on CLI 2.1.281 (its own docblock's table).
 */

const CLEAR_RAN: CommandArmEvidence = {
  command: '/clear',
  framesAfterFirst: ['conversation_reset', 'system/init', 'result/success'],
  wordsReachedAModel: false,
  secondEnded: true,
}
const COMPACT_RAN: CommandArmEvidence = {
  command: '/compact',
  framesAfterFirst: [
    'system/status',
    'system/status',
    'system/init',
    'system/compact_boundary',
    'user',
    'user',
    'result/success',
  ],
  wordsReachedAModel: false,
  secondEnded: true,
}
const AS_WORDS: CommandArmEvidence = {
  command: '/clear',
  framesAfterFirst: ['system/init', 'assistant', 'result/success'],
  wordsReachedAModel: true,
  secondEnded: true,
}

describe('708 · what the CLI did with a command', () => {
  it('⚑ the frame it emits when it RAN one, per command', () => {
    expect(RAN_IT).toEqual({
      '/clear': 'conversation_reset',
      '/compact': 'system/compact_boundary',
    })
  })

  it('🔴 its own frame and no words to a model → ran it; words and no frame → words', () => {
    expect(whatTheCliDid(CLEAR_RAN)).toBe('ran-it')
    expect(whatTheCliDid(COMPACT_RAN)).toBe('ran-it')
    expect(whatTheCliDid(AS_WORDS)).toBe('words')
    expect(whatTheCliDid({ ...AS_WORDS, command: '/compact' })).toBe('words')
  })

  it('⛔ the OTHER command’s frame is not this one’s — a reset does not prove a compaction', () => {
    expect(whatTheCliDid({ ...CLEAR_RAN, command: '/compact' })).toBe('not-performed')
  })

  it('⛔ both, neither, or a turn that never ended → NOT PERFORMED, never a pass', () => {
    expect(whatTheCliDid({ ...CLEAR_RAN, wordsReachedAModel: true })).toBe('not-performed')
    expect(whatTheCliDid({ ...AS_WORDS, wordsReachedAModel: false })).toBe('not-performed')
    expect(whatTheCliDid({ ...CLEAR_RAN, secondEnded: false })).toBe('not-performed')
  })

  it('⚑ the stamp moved nothing only when the frames AND the words agree', () => {
    expect(theStampMovedNothing(COMPACT_RAN, { ...COMPACT_RAN })).toBe(true)
    expect(theStampMovedNothing(COMPACT_RAN, { ...COMPACT_RAN, wordsReachedAModel: true })).toBe(
      false,
    )
    expect(
      theStampMovedNothing(COMPACT_RAN, {
        ...COMPACT_RAN,
        framesAfterFirst: COMPACT_RAN.framesAfterFirst.slice(1),
      }),
    ).toBe(false)
  })
})
