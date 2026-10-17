import { describe, expect, it } from 'vitest'
import type { RuntimeEventMessage, ScheduledJob, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'

/**
 * # 🔴 F035's window half — a job the last level took off and the next puts back keeps its first listing
 *
 * A level may take a job off and the next list it again. Listed again from the later row's moment,
 * a one-shot whose minute has passed would be promised a year away. `ScheduleRegistry.left` keeps
 * the rows the last level took off, with their first listing, and `listedSinceOf` looks there after
 * the level before (`9c566be7`).
 *
 * - It reaches back ONE level only: a job two levels gone is listed afresh.
 * - A frame that states no level is not a level, and moves nothing.
 * - `left` travels across a slab release with the rest of the registry (`transcript-window.ts`).
 *
 * Pure folds, as `scheduled-work.test.ts` drives the registry.
 */

const local = (hours: number, minutes: number, date = 28): number =>
  new Date(2026, 8, date, hours, minutes).getTime()

/** Noon: the level that first lists the one-shot. */
const LISTED = local(12, 0)
/** 14:45:05 — its minute came, and the host took it off its own level. */
const DROPPED = local(14, 45) + 5_000
/** 14:46 — the provider's Stop restates it: it had not fired. */
const PUT_BACK = local(14, 46)

const ONE_SHOT: ScheduledJob = {
  id: 'job-a',
  schedule: '45 14 28 9 *',
  recurring: false,
  prompt: 'check the deploy',
}
const NIGHTLY: ScheduledJob = {
  id: 'nightly',
  schedule: '0 3 * * *',
  recurring: true,
  prompt: 'tidy up',
}

const APP = 'this app, as the provider began a turn after a one-shot came due'

const level = (jobs: ScheduledJob[], source = 'hook/Stop'): TranscriptEvent => ({
  type: 'scheduled_work',
  jobs,
  source,
})
const putBack = (jobs: ScheduledJob[]): TranscriptEvent => level(jobs)
/** A frame that states no level at all — `jobs` absent, which is not `[]`. */
const NO_LEVEL: TranscriptEvent = { type: 'scheduled_work', source: 'hook/Stop' }

function fold(...steps: [TranscriptEvent, number][]): TranscriptState {
  const state = createTranscript()
  for (const [event, at] of steps) applyEvent(state, event, at)
  return state
}

const sinceOf = (state: TranscriptState, id: string): number | undefined =>
  state.schedule.jobs.find((job) => job.id === id)?.listedSince

describe('F035 · a job the last level took off, put back by the next', () => {
  it('🔴 keeps its FIRST listing, not the restate row’s moment', () => {
    const state = fold(
      [level([ONE_SHOT, NIGHTLY]), LISTED],
      [level([NIGHTLY], APP), DROPPED],
      [putBack([ONE_SHOT, NIGHTLY]), PUT_BACK],
    )
    expect(state.schedule.jobs.map((job) => job.id)).toEqual(['job-a', 'nightly'])
    expect(sinceOf(state, 'job-a')).toBe(LISTED)
    expect(sinceOf(state, 'job-a')).not.toBe(PUT_BACK)
    // ⚑ The job that never left keeps its own listing too, through `jobs` as before.
    expect(sinceOf(state, 'nightly')).toBe(LISTED)
  })

  it('🔴 `left` holds the rows the last level took off, with their listing — and only those', () => {
    const state = fold([level([ONE_SHOT, NIGHTLY]), LISTED])
    expect(state.schedule.left).toEqual([])
    applyEvent(state, level([NIGHTLY], APP), DROPPED)
    expect(state.schedule.left).toEqual([{ ...ONE_SHOT, listedSince: LISTED }])
    // ⛔ The job still listed is not in it.
    expect(state.schedule.left.some((job) => job.id === 'nightly')).toBe(false)
    // …and once it is put back, nothing was taken off by that level.
    applyEvent(state, putBack([ONE_SHOT, NIGHTLY]), PUT_BACK)
    expect(state.schedule.left).toEqual([])
  })

  it('⛔ reaches back ONE level only: a job dropped two levels ago is listed afresh', () => {
    const later = local(15, 30)
    const state = fold(
      [level([ONE_SHOT, NIGHTLY]), LISTED],
      [level([NIGHTLY], APP), DROPPED],
      // The provider's own Stop agrees it is gone — a second level without it.
      [level([NIGHTLY]), PUT_BACK],
      [level([ONE_SHOT, NIGHTLY]), later],
    )
    // ⚑ …so a job back after two levels is read as a new listing; the one-level reach spares only
    // the drop and its correction.
    expect(sinceOf(state, 'job-a')).toBe(later)
  })

  it('⚑ a frame that states no level is not a level: the job put back after it still keeps its listing', () => {
    const state = fold(
      [level([ONE_SHOT, NIGHTLY]), LISTED],
      [level([NIGHTLY], APP), DROPPED],
      [NO_LEVEL, local(14, 45) + 30_000],
      [putBack([ONE_SHOT, NIGHTLY]), PUT_BACK],
    )
    expect(sinceOf(state, 'job-a')).toBe(LISTED)
  })

  it('⛔ paired control: a job never listed before is listed from its own row’s moment', () => {
    const state = fold(
      [level([NIGHTLY]), LISTED],
      [level([NIGHTLY], APP), DROPPED],
      [level([ONE_SHOT, NIGHTLY]), PUT_BACK],
    )
    expect(sinceOf(state, 'job-a')).toBe(PUT_BACK)
  })
})

describe('F035 · `left` is carried across a slab release', () => {
  const message = (ordinal: number, at: number, event: TranscriptEvent): RuntimeEventMessage => ({
    sessionId: 'sess_f035w',
    ordinal,
    at,
    event,
  })
  const before: RuntimeEventMessage[] = [
    message(1, LISTED, level([ONE_SHOT, NIGHTLY])),
    message(2, DROPPED, level([NIGHTLY], APP)),
  ]
  const after: RuntimeEventMessage[] = [message(3, PUT_BACK, putBack([ONE_SHOT, NIGHTLY]))]

  it('🔴 a job put back in the retained suffix keeps the listing the released slab saw', () => {
    const held = foldWindow(before)
    // ⚑ The premise: the released slab ends with the job taken off.
    expect(held.schedule.left.map((job) => job.id)).toEqual(['job-a'])
    const carried = foldWindow(after, null, carryForward(held, []))
    expect(carried.schedule.jobs.find((job) => job.id === 'job-a')?.listedSince).toBe(LISTED)
  })

  it('⛔ paired control: the same suffix folded cold lists it from the restate row', () => {
    const cold = foldWindow(after)
    expect(cold.schedule.jobs.find((job) => job.id === 'job-a')?.listedSince).toBe(PUT_BACK)
  })

  it('⚠️ the carried `left` is COPIED, not aliased', () => {
    const held = foldWindow(before)
    const carry = carryForward(held, [])
    expect(carry.schedule.left).not.toBe(held.schedule.left)
    expect(carry.schedule.left).toEqual(held.schedule.left)
    expect(carry.schedule.left).toHaveLength(1)
  })
})
