import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import type { SessionStatus } from '@brobot2/shared'
import { BeingDoneTracker } from '../src/main/runtime/being-done'
import { NOTHING_RIGHT_NOW } from '../src/shared/what-is-being-done'

/**
 * # ⚑ A card is not a turn boundary — and its answer counts as activity
 *
 * Landing coverage for the approval-is-activity fix. A card opening, or the last one settling,
 * moves the status between `working` and `waiting_permission`, and that is no turn boundary: the
 * tracker keeps what the conversation was doing across it, and the move back to `working` restarts
 * `since` — an approval, a denial or an answer counts as activity. ⛔ Every OTHER change of status
 * still clears the phase, and a repeated one still clears nothing.
 */

const status = (state: SessionStatus): RuntimeEvent => ({ type: 'status', state })
const tool = (name: string): RuntimeEvent => ({ type: 'activity', phase: 'tool', detail: name })
const BASH = { said: 'an-activity', phase: 'tool', detail: 'Bash' } as const

/** A conversation at work on a Bash call: working at 2, the call at 3. */
function atWork(): BeingDoneTracker {
  const tracker = new BeingDoneTracker(1)
  tracker.observe(status('working'), 2)
  tracker.observe(tool('Bash'), 3)
  return tracker
}

describe('a card between working and waiting_permission', () => {
  it('🔴 the card opening keeps what it was doing and moves nothing; its answer keeps it and restarts the clock', () => {
    const tracker = atWork()
    expect(tracker.current.told).toEqual(BASH)
    expect(tracker.current.since).toBe(3)

    tracker.observe(status('waiting_permission'), 4)
    expect(tracker.current.status).toBe('waiting_permission')
    expect(tracker.current.told, 'a card cleared what it was doing').toEqual(BASH)
    expect(tracker.current.since, 'a card opening is not activity').toBe(3)

    tracker.observe(status('working'), 5)
    expect(tracker.current.status).toBe('working')
    expect(tracker.current.told, 'an answered card cleared what it was doing').toEqual(BASH)
    expect(tracker.current.since, 'an answer counts as activity').toBe(5)
  })

  it('⚑ every answer restarts the clock, not only the first', () => {
    const tracker = atWork()
    for (const [wait, back] of [
      [10, 11],
      [20, 25],
    ] as const) {
      tracker.observe(status('waiting_permission'), wait)
      tracker.observe(status('working'), back)
      expect(tracker.current.since).toBe(back)
      expect(tracker.current.told).toEqual(BASH)
    }
  })

  it('⚑ a card with nothing being done: it stays nothing, and the answer still restarts the clock', () => {
    const tracker = new BeingDoneTracker(1)
    tracker.observe(status('working'), 2)
    tracker.observe(status('waiting_permission'), 3)
    expect(tracker.current.told).toEqual(NOTHING_RIGHT_NOW)
    tracker.observe(status('working'), 4)
    expect(tracker.current.told).toEqual(NOTHING_RIGHT_NOW)
    expect(tracker.current.since).toBe(4)
  })

  it('⛔ a repeated status is still no boundary and no activity: it moves no clock', () => {
    const tracker = atWork()
    tracker.observe(status('waiting_permission'), 4)
    tracker.observe(status('waiting_permission'), 6)
    expect(tracker.current.since).toBe(3)
    tracker.observe(status('working'), 7)
    tracker.observe(status('working'), 9)
    expect(tracker.current.since).toBe(7)
  })
})

describe('what is still a turn boundary', () => {
  it('🔴 idle → waiting_permission clears the phase: it is not a card between turns’ work', () => {
    const tracker = new BeingDoneTracker(1)
    tracker.observe(tool('Bash'), 2)
    expect(tracker.current.told).toEqual(BASH)
    tracker.observe(status('waiting_permission'), 3)
    expect(tracker.current.told).toEqual(NOTHING_RIGHT_NOW)
  })

  it('🔴 waiting_permission → idle clears the phase, and a later working does not bring it back', () => {
    const tracker = atWork()
    tracker.observe(status('waiting_permission'), 4)
    tracker.observe(status('idle'), 5)
    expect(tracker.current.told).toEqual(NOTHING_RIGHT_NOW)
    tracker.observe(status('working'), 6)
    expect(tracker.current.told).toEqual(NOTHING_RIGHT_NOW)
  })

  it('⛔ working → idle still clears it, and a turn row ends what a card kept', () => {
    const idle = atWork()
    idle.observe(status('idle'), 4)
    expect(idle.current.told).toEqual(NOTHING_RIGHT_NOW)

    const turned = atWork()
    turned.observe(status('waiting_permission'), 4)
    turned.observe({ type: 'turn', state: 'interrupted' }, 5)
    expect(turned.current.told).toEqual(NOTHING_RIGHT_NOW)
  })
})
