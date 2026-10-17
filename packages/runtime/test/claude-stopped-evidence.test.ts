import { describe, expect, it } from 'vitest'
import { stoppedWordVerdict, type StopSeen } from '../smoke/claude-stopped-evidence'

/**
 * # ⚑ 709 · `probe:claude-stopped-word`'s verdict, pinned from `ci`
 *
 * ⛔ The live probe is not in `pnpm run ci`; what it CONCLUDES is (`pin-a-live-only-instrument-from-a-
 * cheap-gate`). The planted arms are 709's measured run (CLI 2.1.281): each verdict beside the one
 * fact that moves it.
 */

/**
 * The four arms as `709` measured them — Claude's word, and the product's beside it. ⚑ On both
 * Stops the product's forced ending (`074`) came before Claude's result; the Cancel's was read.
 */
function measured(): StopSeen[] {
  return [
    {
      arm: 'finishes',
      result: { subtype: 'success', terminalReason: 'completed' },
      productWords: ['completed'],
      productErrors: 0,
      openAtStop: null,
      endedBeforeClaudesResult: false,
    },
    {
      arm: 'stopped-streaming',
      result: { subtype: 'error_during_execution', terminalReason: 'aborted_streaming' },
      productWords: ['interrupted'],
      productErrors: 0,
      openAtStop: true,
      endedBeforeClaudesResult: true,
    },
    {
      arm: 'stopped-in-tool',
      result: { subtype: 'error_during_execution', terminalReason: 'aborted_tools' },
      productWords: ['interrupted'],
      productErrors: 0,
      openAtStop: true,
      endedBeforeClaudesResult: true,
    },
    {
      arm: 'cancelled-card',
      result: { subtype: 'error_during_execution', terminalReason: 'aborted_tools' },
      productWords: ['interrupted'],
      productErrors: 0,
      openAtStop: true,
      endedBeforeClaudesResult: false,
    },
  ]
}

const withArm = (arm: string, change: Partial<StopSeen>): StopSeen[] =>
  measured().map((one) => (one.arm === arm ? { ...one, ...change } : one))

describe('709 · does the product record Claude’s own word for a stopped turn?', () => {
  it('⚑ the-providers-word — 709’s measured run, naming the arms READ apart from those ended first', () => {
    expect(stoppedWordVerdict(measured())).toEqual({
      verdict: 'the-providers-word',
      read: ['finishes', 'cancelled-card'],
      endedFirst: ['stopped-streaming', 'stopped-in-tool'],
    })
  })

  it('⛔ not-performed — a Stop asked of a turn already over, which a CLI bump would read as `moved`', () => {
    // ⚑ The sleeper refused, the turn completed inside the pause, and `interrupt()` did nothing.
    const completed: Partial<StopSeen> = {
      result: { subtype: 'success', terminalReason: 'completed' },
      productWords: ['completed'],
    }
    const turns = withArm('stopped-in-tool', { ...completed, openAtStop: false })
    expect(stoppedWordVerdict(turns)).toEqual({
      verdict: 'not-performed',
      because: 'stopped-in-tool was no longer running at its stop',
    })
    // ⚑ **CONTROL, one fact over** — the same completed turn with the premise HELD: a stop asked of a
    // running turn that Claude then closed `completed` is a CLI bump, and reads `moved`.
    expect(
      stoppedWordVerdict(withArm('stopped-in-tool', { ...completed, openAtStop: true })),
    ).toEqual({
      verdict: 'moved',
      because: 'stopped-in-tool: completed, not aborted_tools',
    })
    // ⛔ …and a premise nobody measured is not a pass either: not-performed, on another arm.
    expect(stoppedWordVerdict(withArm('cancelled-card', { openAtStop: null }))).toMatchObject({
      verdict: 'not-performed',
    })
  })

  it('⛔ not-performed — every stopped arm ended first, so no stop was read off Claude’s result', () => {
    expect(
      stoppedWordVerdict(withArm('cancelled-card', { endedBeforeClaudesResult: true })),
    ).toEqual({
      verdict: 'not-performed',
      because: 'no stopped arm’s word was read off Claude’s result — each was ended first',
    })
  })

  it('🔴 misread — a Cancel drawn as a FAULT (`failed` with an error: the relabel removed and the reason unread)', () => {
    const turns = withArm('cancelled-card', { productWords: ['failed'], productErrors: 1 })
    expect(stoppedWordVerdict(turns)).toEqual({
      verdict: 'misread',
      arms: ['cancelled-card: failed with 1 error(s)'],
    })
  })

  it('🔴 misread — a word right, but an error beside it, is still a fault drawn', () => {
    expect(stoppedWordVerdict(withArm('cancelled-card', { productErrors: 1 }))).toMatchObject({
      verdict: 'misread',
    })
  })

  it('🔴 misread — a finished turn renamed `interrupted`', () => {
    expect(
      stoppedWordVerdict(withArm('finishes', { productWords: ['interrupted'] })),
    ).toMatchObject({ verdict: 'misread' })
  })

  it('🔴 moved — a CLI bump: a Cancel no longer closes `aborted_tools`', () => {
    const turns = withArm('cancelled-card', {
      result: { subtype: 'error_during_execution', terminalReason: 'user_cancelled' },
    })
    expect(stoppedWordVerdict(turns)).toEqual({
      verdict: 'moved',
      because: 'cancelled-card: user_cancelled, not aborted_tools',
    })
  })

  it('🔴 moved — a stop that carries NO terminal_reason at all', () => {
    const turns = withArm('stopped-streaming', {
      result: { subtype: 'error_during_execution', terminalReason: null },
    })
    expect(stoppedWordVerdict(turns)).toMatchObject({ verdict: 'moved' })
  })

  it('⛔ not-performed — an arm missing, a result missing, a product word missing', () => {
    expect(stoppedWordVerdict(measured().slice(1))).toMatchObject({ verdict: 'not-performed' })
    expect(stoppedWordVerdict(withArm('stopped-in-tool', { result: null }))).toMatchObject({
      verdict: 'not-performed',
    })
    expect(stoppedWordVerdict(withArm('finishes', { productWords: [] }))).toMatchObject({
      verdict: 'not-performed',
    })
  })
})
