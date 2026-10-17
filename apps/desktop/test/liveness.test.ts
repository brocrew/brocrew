import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
// Read-only reach into the runtime's internals: the stall window is not on the
// package's public surface, and the package is GO-locked, so this import exists
// purely to prove the host's copy has not drifted from it.
import { DEFAULT_STALL_TIMEOUT_MS } from '../../../packages/runtime/src/internal/stall-watchdog'
import {
  DEFAULT_SILENCE_WINDOW_MS,
  LivenessTracker,
  type LivenessTimers,
} from '../src/main/runtime/liveness'
import type { SessionLiveness } from '../src/shared/runtime-ipc'

/**
 * "Is the provider alive?" answered from the stream. The states have to be earned:
 * `silent` may only appear after real silence during real work, and must never
 * appear while the session is waiting on the user.
 */

/** A hand-cranked clock and timer, so silence is asserted rather than slept through. */
function harness(windowMs = 1000) {
  let clock = 1_000_000
  let pending: { fn: () => void; at: number } | null = null
  const timers: LivenessTimers = {
    setTimeout: (fn, ms) => {
      pending = { fn, at: clock + ms }
      return pending
    },
    clearTimeout: (handle) => {
      if (pending === handle) pending = null
    },
  }
  const changes: SessionLiveness[] = []
  const tracker = new LivenessTracker((liveness) => changes.push(liveness), {
    windowMs,
    now: () => clock,
    timers,
  })
  return {
    tracker,
    changes,
    get now() {
      return clock
    },
    /** Advance the clock; fire the window if it has come due. */
    advance(ms: number) {
      clock += ms
      if (pending && clock >= pending.at) {
        const due = pending
        pending = null
        due.fn()
      }
    },
    get armed() {
      return pending !== null
    },
  }
}

const working: RuntimeEvent = { type: 'status', state: 'working' }
const idle: RuntimeEvent = { type: 'status', state: 'idle' }
const delta: RuntimeEvent = { type: 'assistant_delta', text: 'x' }

describe('LivenessTracker', () => {
  it('starts live', () => {
    expect(harness().tracker.current.state).toBe('live')
  })

  it('reports silent once a working turn goes quiet for the window', () => {
    const h = harness(1000)
    h.tracker.observe(working)

    h.advance(999)
    expect(h.tracker.current.state).toBe('live')

    h.advance(1)
    expect(h.tracker.current.state).toBe('silent')
    expect(h.tracker.current.detail).toMatch(/no activity for 1s/)
    expect(h.changes.at(-1)?.state).toBe('silent')
  })

  it('dates the silence from when the provider went quiet, not from when we noticed', () => {
    // Otherwise the indicator reads "silent 0s" at the exact moment it starts
    // mattering, when the true answer is a whole window.
    const h = harness(1000)
    const startedWorkingAt = h.now
    h.tracker.observe(working)
    h.advance(1000)

    expect(h.tracker.current.state).toBe('silent')
    expect(h.tracker.current.since).toBe(startedWorkingAt)
    expect(h.now - h.tracker.current.since).toBe(1000)
  })

  it('measures silence, not duration — a busy turn never trips it', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    for (let i = 0; i < 10; i += 1) {
      h.advance(900)
      h.tracker.observe(delta)
    }
    expect(h.tracker.current.state).toBe('live')
  })

  it('clears back to live when activity resumes, and can go silent again', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.advance(1000)
    expect(h.tracker.current.state).toBe('silent')

    h.tracker.observe(delta)
    expect(h.tracker.current.state).toBe('live')

    h.advance(1000)
    expect(h.tracker.current.state).toBe('silent')
    expect(h.changes.map((c) => c.state)).toEqual(['silent', 'live', 'silent'])
  })

  it('never reads a card waiting on the user as silent', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.tracker.observe({ type: 'status', state: 'waiting_permission' })

    h.advance(60_000)
    expect(h.tracker.current.state).toBe('live')
    expect(h.armed).toBe(false)
  })

  it('stops watching once the turn goes idle', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.tracker.observe(idle)

    h.advance(60_000)
    expect(h.tracker.current.state).toBe('live')
  })

  it('ends on a closed session and freezes there', () => {
    const h = harness(1000)
    h.tracker.observe({ type: 'status', state: 'ended' })
    expect(h.tracker.current.state).toBe('ended')

    h.tracker.observe(delta)
    h.advance(60_000)
    expect(h.tracker.current.state).toBe('ended')
  })

  it('errors on a fatal error, keeping its reason, and freezes there', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.tracker.observe({ type: 'error', message: 'the provider child died', fatal: true })

    expect(h.tracker.current).toMatchObject({
      state: 'errored',
      detail: 'the provider child died',
    })
    h.tracker.observe(delta)
    expect(h.tracker.current.state).toBe('errored')
  })

  it('⚠️ a fatal error with a CAUSE hands the header no words of its own (110)', () => {
    // `detail` is rendered under the session header. Before 110 every `cause`-bearing error was
    // non-fatal, so this line could only ever show a plain diagnostic; a credential refusal is now
    // fatal AND carries the provider's verbatim sentence on `message`, which would have printed
    // *"Failed to authenticate. API Error: 401 OAuth access token has been revoked."* under the
    // header — in the provider's words, beside a transcript notice written not to use them.
    const h = harness(1000)
    h.tracker.observe(working)
    h.tracker.observe({
      type: 'error',
      message: 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
      fatal: true,
      cause: 'auth_stale',
    })

    expect(h.tracker.current.state).toBe('errored')
    expect(h.tracker.current.detail).toBeUndefined()
    // …and the paired positive is the test above: a fatal error with NO cause still keeps its
    // reason, so this is about the cause and not about fatal errors losing their diagnostics.
  })

  it('is unmoved by a non-fatal error — a retry notice is not a death', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.tracker.observe({ type: 'error', message: 'retrying after 429', fatal: false })
    expect(h.tracker.current.state).toBe('live')
  })

  it('only reports real changes — the renderer is not woken to be told the same thing', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.tracker.observe(delta)
    h.tracker.observe(delta)
    expect(h.changes).toEqual([])
  })

  it('stops its timer when the session is gone', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.tracker.stop()
    expect(h.armed).toBe(false)
  })

  it('uses the same silence window as the runtime stall watchdog', () => {
    // Two windows describing one reality: the header would say "silent" while the
    // transcript stayed quiet (or the reverse) if these ever diverged.
    expect(DEFAULT_SILENCE_WINDOW_MS).toBe(DEFAULT_STALL_TIMEOUT_MS)
  })

  /**
   * **122 §3 · What two minutes of silence is allowed to say — and to offer.**
   *
   * The dispatch's ruling and mine agree on the first half: ⛔ **the timer must never synthesise a
   * terminal.** A `status: idle` invented on a timeout is a state the provider never reported, and
   * 039/086 forbid it — the tracker's whole design is that it *watches* and closes nothing.
   *
   * ⚠️ **The second half is where it was wrong, and the fix is upstream of this file.** The
   * sentence below ends *"you can interrupt"*, and in the one state where a user most needed it
   * that was FALSE: `ClaudeSessionHandle.interrupt()` returns immediately when no turn is open, so
   * on a session stranded at `working` with no turn the offer did nothing. 122 does not add a new
   * offer or a new word — it removes the state, by making `working` derivable only from a turn the
   * machine actually holds. The notice now appears only where its offer works.
   */
  it('says what the provider did, offers what actually works, and closes nothing (122 §3)', () => {
    const h = harness(1000)
    h.tracker.observe(working)
    h.advance(1000)

    // ⛔ **The wording, pinned.** Every clause is a hedge the app can defend: it reports the
    // measured silence, names three causes without picking one (039's "the provider stopped
    // saying"), and offers the one control that ends it.
    expect(h.tracker.current.detail).toBe(
      'no activity for 1s — the provider may be busy, rate-limited, or stalled; you can interrupt',
    )
    // ⛔ **And it is a report, not a terminal.** `silent` is not in the frozen set, so the session
    // is still live, still interruptible, and one event away from reading `live` again.
    expect(h.tracker.current.state).toBe('silent')
    h.tracker.observe(delta)
    expect(h.tracker.current.state).toBe('live')
  })

  it('is never armed by a session that is not driving a turn (122)', () => {
    // ⚠️ **What this does and does NOT prove, corrected in review.** It pins the tracker's arming
    // RULE — `working` and nothing else — which is what made a phantom `working` cost a 120s stall
    // notice about a provider nobody was asking anything of. It does **not** fail if 122 is
    // reverted, and a reviewer measured that: restoring the old unconditional `working` leaves this
    // file 5/5 green, because the phantom is emitted upstream and never reaches this class. The
    // consequence itself is pinned where it happens — `stranded-turn.test.ts`'s *"every `working`
    // it publishes is one it can retract"*, which does go red on the revert. This is the guard on
    // the other half: that the rule the fix relies on stays true.
    //
    // ⚑ **123 widened what arms it, and did not touch the rule.** `working` now also covers a burst
    // the provider started by itself, so a background run that wakes the agent and then goes quiet
    // raises the same notice — and the notice's *"you can interrupt"* is finally true there, because
    // `SessionMachine.forceEnd` can end a burst. What still may not arm it is a session doing
    // nothing, which is exactly what the loop below feeds it.
    const h = harness(1000)
    for (const event of [idle, { type: 'activity', phase: 'waiting' } as RuntimeEvent, delta]) {
      h.tracker.observe(event)
    }
    // ⚠️ **Asserted BEFORE the clock moves, and the mutation check is why.** Advancing first lets
    // the window fire, and the callback re-checks `working` on its way out — so a tracker that HAD
    // armed wrongly still reads `armed === false` afterwards and the assertion passes over the
    // defect. The question is whether it armed at all.
    expect(h.armed).toBe(false)
    h.advance(10_000)
    expect(h.tracker.current.state).toBe('live')
    // …and the paired positive, or this passes over a tracker that never arms at all.
    h.tracker.observe(working)
    expect(h.armed).toBe(true)
    h.advance(1000)
    expect(h.tracker.current.state).toBe('silent')
  })
})

describe('a silence after reasoning is said as thinking (F145)', () => {
  it('reads "Still thinking (2 min)." after reasoning, and today\'s words after anything else', () => {
    const after = (last: RuntimeEvent): string | undefined => {
      const h = harness(120_000)
      h.tracker.observe(working)
      h.tracker.observe(last)
      h.advance(121_000)
      return h.tracker.current.detail
    }
    expect(after({ type: 'thinking', phase: 'delta', text: 'weighing it' })).toBe(
      'Still thinking (2 min).',
    )
    expect(after({ type: 'assistant_delta', text: 'hi' })).toMatch(/^no activity for 120s/)
  })

  it('says the silence followed reasoning as a fact, and only then', () => {
    const after = (last: RuntimeEvent): true | undefined => {
      const h = harness(120_000)
      h.tracker.observe(working)
      h.tracker.observe(last)
      h.advance(121_000)
      return h.tracker.current.thinking
    }
    expect(after({ type: 'thinking', phase: 'delta', text: 'weighing it' })).toBe(true)
    expect(after({ type: 'assistant_delta', text: 'hi' })).toBeUndefined()
  })

  it("the runtime's own thinking notice keeps the header silent and still thinking, at 120 s and 240 s", () => {
    const h = harness(120_000)
    h.tracker.observe(working)
    h.tracker.observe({ type: 'thinking', phase: 'delta', text: 'weighing it' })
    h.advance(120_000)
    // The runtime's watchdog reports the same silence; it is not proof of life.
    h.tracker.observe({
      type: 'error',
      fatal: false,
      message: 'Still thinking (2 min).',
      stall: true,
      thinking: true,
    })
    expect(h.tracker.current).toMatchObject({ state: 'silent', detail: 'Still thinking (2 min).' })
    const since = h.tracker.current.since
    h.advance(120_000)
    expect(h.tracker.current).toEqual({
      state: 'silent',
      since,
      detail: 'Still thinking (2 min).',
      thinking: true,
    })

    // Real progress brings it back to live, and a silence after words reads as today.
    h.tracker.observe({ type: 'assistant_delta', text: 'hi' })
    expect(h.tracker.current.state).toBe('live')
    h.advance(121_000)
    expect(h.tracker.current.detail).toMatch(/^no activity for 120s/)
  })

  it("a provider's own non-fatal error is still proof of life", () => {
    const h = harness(120_000)
    h.tracker.observe(working)
    h.tracker.observe({ type: 'thinking', phase: 'delta', text: 'weighing it' })
    h.advance(121_000)
    expect(h.tracker.current.state).toBe('silent')
    h.tracker.observe({ type: 'error', fatal: false, message: 'Overloaded, retrying.' })
    expect(h.tracker.current.state).toBe('live')
    h.advance(121_000)
    expect(h.tracker.current.detail).toMatch(/^no activity for 120s/)
  })
})
