import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import {
  isReasoning,
  StallWatchdog,
  stallNotice,
  type WatchdogTimers,
} from '../src/internal/stall-watchdog'

/** A hand-driven clock: the watchdog is about time, so tests must control it, not sleep through it. */
function fakeTimers() {
  let seq = 0
  const pending = new Map<number, () => void>()
  const timers: WatchdogTimers = {
    setTimeout: (fn) => {
      const id = ++seq
      pending.set(id, fn)
      return id
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number)
    },
  }
  return {
    timers,
    fire: () => [...pending.values()].forEach((fn) => fn()),
    size: () => pending.size,
  }
}

describe('StallWatchdog (074)', () => {
  it('reports once when the window elapses with no activity', () => {
    const { timers, fire } = fakeTimers()
    const stalls: number[] = []
    const w = new StallWatchdog((ms) => stalls.push(ms), 120_000, timers)
    w.notice()
    fire()
    expect(stalls).toEqual([120_000])
  })

  it('does NOT report while activity keeps arriving — it measures silence, not duration', () => {
    // A legitimately long turn that keeps emitting must never be flagged.
    const { timers, fire, size } = fakeTimers()
    const stalls: number[] = []
    const w = new StallWatchdog((ms) => stalls.push(ms), 120_000, timers)
    for (let i = 0; i < 10; i++) w.notice() // each event restarts the window
    expect(size()).toBe(1) // the previous timer is cleared, never stacked
    expect(stalls).toEqual([])
    fire() // only once the stream finally goes quiet
    expect(stalls).toHaveLength(1)
  })

  it('reports only ONCE per stall — a repeating notice would be noise', () => {
    const { timers, fire } = fakeTimers()
    const stalls: number[] = []
    const w = new StallWatchdog((ms) => stalls.push(ms), 1000, timers)
    w.notice()
    fire()
    fire()
    expect(stalls).toHaveLength(1)
  })

  it('stop() disarms, and is idempotent', () => {
    const { timers, fire, size } = fakeTimers()
    const stalls: number[] = []
    const w = new StallWatchdog((ms) => stalls.push(ms), 1000, timers)
    w.notice()
    expect(w.armed).toBe(true)
    w.stop()
    w.stop()
    expect(w.armed).toBe(false)
    expect(size()).toBe(0)
    fire()
    expect(stalls).toEqual([])
  })

  it('re-arms after a stall once activity resumes', () => {
    const { timers, fire } = fakeTimers()
    const stalls: number[] = []
    const w = new StallWatchdog((ms) => stalls.push(ms), 1000, timers)
    w.notice()
    fire()
    w.notice() // the provider came back
    fire() // …and went quiet again
    expect(stalls).toHaveLength(2)
  })
})

describe('a silence after reasoning is said as thinking (F145)', () => {
  it("says whole minutes since the last reasoning, and keeps today's words otherwise", () => {
    expect(stallNotice(120_000, true)).toBe('Still thinking (2 min).')
    expect(stallNotice(179_999, true)).toBe('Still thinking (2 min).')
    expect(stallNotice(180_000, true)).toBe('Still thinking (3 min).')
    expect(stallNotice(300_000, true)).toBe('Still thinking (5 min).')
    expect(stallNotice(120_000, false)).toBe(
      'still working — no activity for 120s. The provider may be busy, rate-limited, or stalled; you can interrupt.',
    )
  })

  it('hands the stall whether the last progress was reasoning', () => {
    const { timers, fire } = fakeTimers()
    const stalls: [number, boolean][] = []
    const w = new StallWatchdog(
      (ms, afterReasoning) => stalls.push([ms, afterReasoning]),
      300_000,
      timers,
    )
    w.notice(true)
    fire()
    w.notice(true)
    w.notice(false)
    fire()
    expect(stalls).toEqual([
      [300_000, true],
      [300_000, false],
    ])
  })

  it("counts each provider's reasoning, and nothing else", () => {
    const reasoning: RuntimeEvent[] = [
      { type: 'thinking', phase: 'delta', text: 'weighing it' },
      { type: 'activity', phase: 'thinking' },
      { type: 'unknown', provider: 'claude', category: 'reasoning', raw: {} } as RuntimeEvent,
      { type: 'unknown', provider: 'codex', category: 'reasoning', raw: {} } as RuntimeEvent,
    ]
    const other: RuntimeEvent[] = [
      { type: 'assistant_delta', text: 'hi' },
      { type: 'activity', phase: 'tool' },
      { type: 'unknown', provider: 'claude', category: 'lifecycle', raw: {} } as RuntimeEvent,
    ]
    expect(reasoning.map(isReasoning)).toEqual([true, true, true, true])
    expect(other.map(isReasoning)).toEqual([false, false, false])
  })
})
