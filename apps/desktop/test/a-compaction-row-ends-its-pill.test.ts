import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { BeingDoneTracker } from '../src/main/runtime/being-done'
import { sessionDoing, type SessionFacetInput } from '../src/renderer/src/lib/agent-state'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'

/**
 * # ⚑ 717 · a compaction row ENDS a `compacting` pill — in both folds
 *
 * ⚑ **`713` F-3, wired by `717`**: Codex raises `activity: compacting` when its `contextCompaction`
 * item OPENS, and says nothing more until the item closes into the `compaction` row. 🔴 **`717`'s
 * review, round 1**: inside a turn that goes on working after the compaction, nothing ended the pill
 * — no `turn`, no changed `status`, and Codex has no `requesting` to replace it the way Claude's
 * `waiting` does — so the plate kept saying *compacting context* under a row that says it is over.
 *
 * ⚑ **So the row ends it**, in the renderer's fold (`transcript.ts`) and in main's
 * (`being-done.ts`, whose every rule is the renderer's read from the same events). ⛔ Only
 * `compacting`: a row does not end a `thinking` or a `tool` that is still running.
 */

const facets = (state: ReturnType<typeof createTranscript>): SessionFacetInput => ({
  phase: 'open',
  status: 'working',
  activity: state.activity,
  streaming: false,
  liveness: 'live',
})

/** Codex's compaction inside an ordinary turn, as the adapter publishes it since 717. */
const opens: RuntimeEvent = { type: 'activity', phase: 'compacting' }
const closes: RuntimeEvent = {
  type: 'compaction',
  compactionId: 'cc_1',
  source: 'contextCompaction',
}

describe('717 · a compaction row ends a `compacting` pill', () => {
  it('🔴 the renderer’s fold: the pill goes with the row, and the turn is still working', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'status', state: 'working' })
    applyEvent(state, opens)
    expect(sessionDoing(facets(state))).toBe('compacting')
    applyEvent(state, closes)
    expect(state.activity).toBeNull()
    expect(sessionDoing(facets(state)), 'still working, no longer compacting').toBe('working')
    expect(state.items.filter((item) => item.kind === 'compaction')).toHaveLength(1)
  })

  it('⚑ …and the control: a row does not end a `thinking` that is still going on', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'activity', phase: 'thinking' })
    applyEvent(state, closes)
    expect(state.activity).toEqual({ phase: 'thinking' })
  })

  it('🔴 main’s fold: `BeingDoneTracker` reads the same rule from the same events', () => {
    const tracker = new BeingDoneTracker(0)
    tracker.observe({ type: 'status', state: 'working' }, 1)
    tracker.observe(opens, 2)
    expect(tracker.current.told).toEqual({ said: 'an-activity', phase: 'compacting', detail: null })
    tracker.observe(closes, 3)
    expect(tracker.current.told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
    expect(tracker.current.since).toBe(3)
  })

  it('⚑ …and its control: a `thinking` phase outlives the row there too', () => {
    const tracker = new BeingDoneTracker(0)
    tracker.observe({ type: 'activity', phase: 'thinking' }, 1)
    tracker.observe(closes, 2)
    expect(tracker.current.told).toEqual({ said: 'an-activity', phase: 'thinking', detail: null })
  })
})
