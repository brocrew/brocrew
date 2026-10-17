import { describe, expect, it, vi } from 'vitest'
import { plateWord, standingWord, stateHere } from '../src/renderer/src/lib/agent-state'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
// ⚑ **D-017 · R11 — the derivation is `shared/agent-state.ts`'s now**, words and details included,
// so `main`'s `list_agents` says what the window draws; the rail and the plate still word it here.
import {
  IN_THE_BACKGROUND,
  inTheBackground,
  nextWake,
  type BackgroundLevel,
  type ScheduledRow,
} from '../src/shared/agent-state'
import { clockTime } from '../src/shared/clock'

/**
 * # 🔴 F023 · one state everywhere the agent appears
 *
 * ⚑ **BroBot's finding, through the PM**: an agent with a scheduled job read *scheduled* in the left
 * rail's row but *idle* on its plate in the right panel, and nothing said when or what. ⚑ **Asked
 * for**: *"scheduled · 04:53"* for a scheduled wake-up, *"running in the background · <command>"*
 * for a background command — the SAME words on the rail and the plate.
 *
 * | § | subject | ⚑ control |
 * |---|---|---|
 * | 2 | the soonest known wake across jobs, and what a registry left running | nothing scheduled, nothing running, no time known |
 * | 3 | the rail's word and the plate's word are one word, with the details | without details, the stems |
 *
 * ⚑ **D-017 · R11 — a one-shot is timed from when it was first LISTED**, not from now
 * (`ScheduledRow.listedSince`): a repeater is marked `recurring`, and the one-shot carries the
 * moment the turn that made it ended — here {@link AT}, the time it was set.
 */

/** A fixed local fixture moment: 28 Sept 2026, 04:40. */
const AT = new Date(2026, 8, 28, 4, 40).getTime()
const local = (month: number, day: number, hour: number, minute: number): number =>
  new Date(2026, month - 1, day, hour, minute).getTime()

const jobs = (
  ...rows: { schedule?: string; recurring?: boolean; nominalAt?: number }[]
): ScheduledRow[] => rows.map((row, index) => ({ id: `job_${index}`, ...row }))

const running = (...rows: { id: string; description?: string }[]): BackgroundLevel => ({
  running: rows,
  dropped: 0,
})

/**
 * The window's one state for an idle conversation it holds from its first event, with the schedule
 * given — ⚑ the LEVEL decides the arm (`stateHere`), not the facet.
 *
 * ⚑ **D-029 · `closed` ends it AFTER the level, through the fold's own door** (`session` →
 * `markTerminal`) — the door that set 258 §2's `sleeping` flag, gone with the asleep ruling.
 *
 * ⚑ **D-036 · nobody holds work it gave out** — `stateHere`'s fourth argument (`whoseWorkIn`'s
 * names) is empty, and the facets carry no wait, so the schedule alone decides.
 */
function idleWith(schedule: ScheduledRow[], closed = false) {
  const record = createSessionRecord('sess_f023')
  record.control.schedule = { jobs: schedule, dropped: 0, left: [] }
  if (closed) {
    applyEvent(record.control, {
      type: 'session',
      state: 'ended',
      ref: { provider: 'claude', sessionId: 'th_f023', cwd: '/work', rotation: 0 },
    } as TranscriptEvent)
  }
  return stateHere(record, { doing: 'idle' }, null, [])
}

describe('§2 · the registries, as one detail each', () => {
  it('🔴 the soonest wake across the jobs, and the first thing running with how many more', () => {
    expect(
      nextWake(
        jobs(
          { schedule: '0 3 * * *', recurring: true, nominalAt: local(9, 29, 3, 0) },
          { schedule: '45 4 28 9 *', recurring: false, nominalAt: local(9, 28, 4, 45) },
          {},
        ),
        AT,
      ),
    ).toBe(local(9, 28, 4, 45))
    // ⛔ No time is worked out from an expression: a job with no known minute promises none, and
    // neither does one whose minute has passed.
    expect(nextWake(jobs({ schedule: '0 3 * * *', recurring: true }), AT)).toBeNull()
    expect(
      nextWake(jobs({ schedule: '30 4 28 9 *', recurring: false, nominalAt: AT - 600_000 }), AT),
    ).toBeNull()
    expect(
      inTheBackground(
        running({ id: 'b1', description: 'npm test' }, { id: 'b2', description: 'x' }),
      ),
    ).toBe('npm test +1')
    expect(inTheBackground(running({ id: 'b1', description: 'npm test' }))).toBe('npm test')
  })

  it('⛔ THE CONTROL — nothing scheduled, nothing running: no detail', () => {
    expect(nextWake([], AT)).toBeNull()
    expect(inTheBackground(running())).toBeNull()
    // ⚑ The window's one state, over nothing scheduled and nothing running: plain idle, no detail.
    expect(idleWith([])).toEqual({ is: 'idle' })
    // ⚑ The pairing, so the control is about the LEVEL: the same record holding one job promises
    // its time. ⚑ **D-029 moved the other half** — 258 §2 read a CLOSED conversation's job `idle`
    // here (*"asleep"*: nothing fires until its next message); this app now starts a stopped
    // conversation in time for its jobs, so the close changes nothing its state says, time
    // included (`05` rule 5: whether a process runs is never an input).
    vi.useFakeTimers()
    vi.setSystemTime(AT)
    try {
      const daily = jobs({
        schedule: '0 3 * * *',
        recurring: true,
        nominalAt: local(9, 29, 3, 0),
      })
      expect(idleWith(daily)).toEqual({ is: 'scheduled', dueAt: local(9, 29, 3, 0) })
      expect(idleWith(daily, true)).toEqual(idleWith(daily))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('§3 · the rail and the plate say one word', () => {
  it('🔴 scheduled · <time> and running in the background · <command>, on both', () => {
    const wakesAt = local(9, 28, 4, 53)
    const scheduled = { doing: 'idle' as const, scheduled: true }
    const wakes = { is: 'scheduled' as const, dueAt: wakesAt }
    expect(standingWord(scheduled, wakes)).toBe(`scheduled · ${clockTime(wakesAt)}`)
    expect(plateWord(scheduled, wakes)).toBe(standingWord(scheduled, wakes))
    const detached = { doing: 'idle' as const, detached: true }
    const runs = { is: 'in-the-background' as const, what: 'npm test' }
    expect(standingWord(detached, runs)).toBe(`${IN_THE_BACKGROUND} · npm test`)
    expect(plateWord(detached, runs)).toBe(standingWord(detached, runs))
  })

  it('⚑ THE CONTROL — without details, the stems; and a detail never leaks onto another state', () => {
    expect(standingWord({ doing: 'idle', scheduled: true })).toBe('scheduled')
    expect(standingWord({ doing: 'idle', detached: true })).toBe(IN_THE_BACKGROUND)
    // ⚑ An idle agent handed a wake-up time is still idle: the details only say more about the two
    // states they belong to.
    expect(standingWord({ doing: 'idle' }, { is: 'scheduled', dueAt: AT })).toBe('idle')
    expect(standingWord({ doing: 'idle' }, { is: 'in-the-background', what: 'npm test' })).toBe(
      'idle',
    )
    // …and one state's detail never lands on the other's word.
    expect(standingWord({ doing: 'idle', detached: true }, { is: 'scheduled', dueAt: AT })).toBe(
      IN_THE_BACKGROUND,
    )
  })
})
