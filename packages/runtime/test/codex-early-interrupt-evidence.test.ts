import { describe, expect, it } from 'vitest'
import {
  earlyInterruptVerdict,
  refusedAsNotRunning,
  renamed,
  type TurnSeen,
} from '../smoke/early-interrupt-evidence'

/**
 * # ⚑ 704 · `probe:codex-early-interrupt`'s verdict, held to planted turns
 *
 * ⛔ The live probe is not in `pnpm run ci`, so the part of it that DECIDES is pinned here — a rig
 * whose reading drifted would print a confident answer from turns it misread
 * (`pin-a-live-only-instrument-from-a-cheap-gate`). Each verdict beside the one fact that moves it.
 * The shapes are the ones the probe measured: on `main` every early interrupt was refused
 * (`-32600 "no active turn to interrupt"`) and Codex completed the turn; on 704 a second one, sent
 * at `turn/started`, was taken.
 */

const REFUSED = '{"code":-32600,"message":"no active turn to interrupt"}'
/** ⚑ The second word, measured on 704's fix run: the turn before still held Codex's active slot. */
const STILL_THE_LAST =
  '{"code":-32600,"message":"expected active turn id 01a0d4be-0190-7c02-8131-048ea2fbea14 but found 01a0d4bd-ff84-7063-8b96-20f827696f56"}'
const none: TurnSeen = {
  arm: 'none',
  turn: 'n1',
  askedAt: null,
  interrupts: [],
  startedAt: 9,
  providerStatus: 'completed',
  productWord: 'completed',
}
const late: TurnSeen = {
  arm: 'late',
  turn: 'l1',
  askedAt: 314,
  interrupts: [{ sentAt: 314, answer: 'ok' }],
  startedAt: 6,
  providerStatus: 'interrupted',
  productWord: 'interrupted',
}
/** ⚑ 704's shape: refused at the bind, taken at `turn/started`, and Codex's word is `interrupted`. */
const early = (turn: string, over: Partial<TurnSeen> = {}): TurnSeen => ({
  arm: 'early',
  turn,
  askedAt: 1,
  interrupts: [
    { sentAt: 1, answer: REFUSED },
    { sentAt: 6, answer: 'ok' },
  ],
  startedAt: 6,
  providerStatus: 'interrupted',
  productWord: 'interrupted',
  ...over,
})

describe('704 · the early-interrupt verdict', () => {
  it('⚑ honoured — every early turn interrupted in Codex’s word, asked inside the window', () => {
    expect(earlyInterruptVerdict([none, late, early('e1'), early('e2')])).toEqual({
      verdict: 'honoured',
    })
  })

  it('🔴 lost — main’s shape: the one interrupt refused, and Codex COMPLETED the turn', () => {
    const mains = early('e2', {
      interrupts: [{ sentAt: 12, answer: REFUSED }],
      startedAt: 36,
      providerStatus: 'completed',
    })
    expect(earlyInterruptVerdict([none, late, early('e1'), mains])).toEqual({
      verdict: 'lost',
      turns: ['e2'],
    })
  })

  it('⛔ not performed — Codex refused no early interrupt as not running: the window was not hit', () => {
    // ⚑ A first interrupt Codex TOOK — the turn was already running — measures nothing about the window.
    const running = early('e1', { interrupts: [{ sentAt: 20, answer: 'ok' }] })
    expect(refusedAsNotRunning(running)).toBe(false)
    expect(earlyInterruptVerdict([none, late, running]).verdict).toBe('not-performed')
    // ⚑ The control: the same turn, its first interrupt refused as not running — in either word.
    expect(refusedAsNotRunning(early('e1'))).toBe(true)
    const stillTheLast = early('e2', {
      interrupts: [
        { sentAt: 1, answer: STILL_THE_LAST },
        { sentAt: 6, answer: 'ok' },
      ],
    })
    expect(refusedAsNotRunning(stillTheLast)).toBe(true)
    expect(earlyInterruptVerdict([none, late, stillTheLast])).toEqual({ verdict: 'honoured' })
    // ⛔ Another error is not Codex saying the turn was not running.
    const otherwise = early('e1', {
      interrupts: [{ sentAt: 1, answer: '{"code":-32603,"message":"internal error"}' }],
    })
    expect(refusedAsNotRunning(otherwise)).toBe(false)
  })

  it('⛔ not performed — a control that failed makes the subject unreadable', () => {
    const notCompleted = { ...none, providerStatus: 'interrupted' }
    expect(earlyInterruptVerdict([notCompleted, late, early('e1')]).verdict).toBe('not-performed')
    const notInterrupted = { ...late, providerStatus: 'completed' }
    expect(earlyInterruptVerdict([none, notInterrupted, early('e1')]).verdict).toBe('not-performed')
    expect(earlyInterruptVerdict([late, early('e1')]).verdict).toBe('not-performed')
    expect(earlyInterruptVerdict([none, early('e1')]).verdict).toBe('not-performed')
  })

  it('⛔ not performed — an early turn Codex never ended, or ended some third way', () => {
    const silent = early('e1', { providerStatus: null })
    expect(earlyInterruptVerdict([none, late, silent])).toEqual({
      verdict: 'not-performed',
      because: 'Codex reported no ending for e1',
    })
    const failed = early('e1', { providerStatus: 'failed' })
    expect(earlyInterruptVerdict([none, late, failed]).verdict).toBe('not-performed')
    expect(earlyInterruptVerdict([none, late]).verdict).toBe('not-performed')
  })
})

/**
 * 🔴 **709 · R43 — the product's word, checked against Codex's.** ⚑ The shapes the probe measured:
 * on `main`'s adapter before `704`, the early turns read `completed` in Codex's word and
 * `interrupted` in the product's (the latch's rename); with `709` both words are Codex's.
 */
describe('709 · R43 — the product records Codex’s word', () => {
  it('⚑ [] — every turn’s product word is Codex’s (709, both with 704’s adapter and without it)', () => {
    expect(renamed([none, late, early('e1'), early('e2')])).toEqual([])
    const lostButTruthful = early('e1', { providerStatus: 'completed', productWord: 'completed' })
    expect(renamed([none, late, lostButTruthful])).toEqual([])
  })

  it('🔴 renamed — main’s shape before 709: Codex COMPLETED it, the product said `interrupted`', () => {
    const relabelled = early('e1', { providerStatus: 'completed', productWord: 'interrupted' })
    expect(renamed([none, late, relabelled])).toEqual(['e1: Codex completed, product interrupted'])
  })

  it('⛔ a turn missing either word is not a disagreement here — the probe asserts the premise', () => {
    expect(
      renamed([early('e1', { productWord: null }), early('e2', { providerStatus: null })]),
    ).toEqual([])
  })
})
