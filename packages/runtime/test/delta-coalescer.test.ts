import { describe, expect, it, vi } from 'vitest'
import { DeltaCoalescer } from '../src/internal/delta-coalescer'
import type { RuntimeEvent } from '../src/index'

/** A coalescer whose windows never auto-fire, so flushes are driven only by feed(). */
function manualCoalescer(): { out: RuntimeEvent[]; dc: DeltaCoalescer } {
  const out: RuntimeEvent[] = []
  return { out, dc: new DeltaCoalescer((e) => out.push(e), 1_000_000, 1_000_000) }
}

describe('DeltaCoalescer (007 P2-3)', () => {
  it('coalesces many deltas and flushes them BEFORE the authoritative message, order preserved', () => {
    const { out, dc } = manualCoalescer()
    for (const t of ['a', 'b', 'c']) dc.feed({ type: 'assistant_delta', text: t })
    expect(out).toEqual([]) // buffered, nothing emitted yet
    dc.feed({ type: 'assistant_message', text: 'abc' })
    expect(out).toEqual([
      { type: 'assistant_delta', text: 'abc' }, // one coalesced delta, before the message
      { type: 'assistant_message', text: 'abc' },
    ])
  })

  it('flushes buffered deltas BEFORE a terminal turn event', () => {
    const { out, dc } = manualCoalescer()
    dc.feed({ type: 'assistant_delta', text: 'hel' })
    dc.feed({ type: 'assistant_delta', text: 'lo' })
    dc.feed({ type: 'turn', state: 'completed' })
    expect(out).toEqual([
      { type: 'assistant_delta', text: 'hello' },
      { type: 'turn', state: 'completed' },
    ])
  })

  it('flushes on the size window (maxChars) with no following event', () => {
    const out: RuntimeEvent[] = []
    const dc = new DeltaCoalescer((e) => out.push(e), 1_000_000, 5) // maxChars = 5
    dc.feed({ type: 'assistant_delta', text: 'abcde' })
    expect(out).toEqual([{ type: 'assistant_delta', text: 'abcde' }])
  })

  it('flushes on the time window (windowMs)', () => {
    vi.useFakeTimers()
    try {
      const out: RuntimeEvent[] = []
      const dc = new DeltaCoalescer((e) => out.push(e), 30, 1_000_000)
      dc.feed({ type: 'assistant_delta', text: 'x' })
      expect(out).toEqual([]) // buffered, timer pending
      vi.advanceTimersByTime(30)
      expect(out).toEqual([{ type: 'assistant_delta', text: 'x' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes non-delta events through unchanged when nothing is buffered', () => {
    const { out, dc } = manualCoalescer()
    dc.feed({ type: 'status', state: 'working' })
    dc.feed({ type: 'assistant_message', text: 'hi' })
    expect(out).toEqual([
      { type: 'status', state: 'working' },
      { type: 'assistant_message', text: 'hi' },
    ])
  })
})
