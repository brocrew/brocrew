import { describe, expect, it } from 'vitest'
import {
  reconcileScheduleReport,
  whatAStartBringsBack,
  type ScheduleLevel,
} from '../src/shared/schedule-wake'
import {
  enqueueScheduleStart,
  finishScheduleStart,
  planScheduleAdmission,
  recordScheduleAdmission,
  takeScheduleStart,
  type WakeAttemptState,
  type WakeStartQueue,
} from '../src/shared/schedule-wake-admission'

const now = Date.parse('2026-10-07T10:00:00Z')
const context = { zone: 'UTC', wakeLeadMs: 30_000 }
const unknown: ScheduleLevel = {
  jobs: [{ id: 'unknown', schedule: '0 11 * * *', recurring: false }],
  dropped: 0,
}
const future: ScheduleLevel = {
  jobs: [
    {
      id: 'future',
      schedule: '0 11 * * *',
      recurring: false,
      evidence: { originalNominalAt: now + 60 * 60_000 },
    },
  ],
  dropped: 0,
}
function admission(level: ScheduleLevel, state: WakeAttemptState = [], at = now, timing = context) {
  const result = whatAStartBringsBack(level, null, at, timing.wakeLeadMs, null, {
    zone: timing.zone,
  })
  return { result, plan: planScheduleAdmission(result, state, timing) }
}

describe('caller-owned reconciliation attempts', () => {
  it.each([
    ['missing original occurrence', unknown],
    ['missing schedule or recurrence', { jobs: [{ id: 'missing' }], dropped: 0 }],
    [
      'unsupported:numeric cron subset only',
      { jobs: [{ id: 'unsupported', recurring: false, schedule: '0 0 L * *' }], dropped: 0 },
    ],
    [
      'empty calendar constraint',
      { jobs: [{ id: 'impossible', recurring: false, schedule: '0 0 31 2 *' }], dropped: 0 },
    ],
  ] as const)('permits one attempt for unchanged %s across stop and re-arm', (reason, level) => {
    const first = admission(level)
    expect(first.plan.startAt).toBe(now)
    expect(first.result.plans[0]!.result).toMatchObject({ reason })
    const attempted = recordScheduleAdmission(first.plan, now)
    for (const at of [now + 1, now + 60_000, now + 10 * 60_000]) {
      const restated = reconcileScheduleReport(first.result.kept, { jobs: [...level.jobs] })
      const rearmed = admission(restated, attempted, at)
      expect(rearmed.plan.startAt).toBeNull()
      expect(rearmed.result.kept).toEqual(level)
      expect(rearmed.result.plans[0]!.result).toMatchObject({ reason })
    }
  })
  it('retains a shortfall while allowing one attempt per changed count', () => {
    const first = admission({ jobs: [], dropped: 2 })
    const attempted = recordScheduleAdmission(first.plan, now)
    const repeated = admission(first.result.kept, attempted, now + 60_000)
    expect(repeated.plan.startAt).toBeNull()
    expect(repeated.result.kept.dropped).toBe(2)
    const changed = admission({ jobs: [], dropped: 3 }, attempted, now + 60_000)
    expect(changed.plan.startAt).toBe(now + 60_000)
    expect(
      admission(changed.result.kept, recordScheduleAdmission(changed.plan, now + 60_000)).plan
        .startAt,
    ).toBeNull()
  })
  it('a material change permits a fresh attempt without reattempting unchanged records', () => {
    const level = { jobs: [{ id: 'a' }, { id: 'b' }], dropped: 0 }
    const first = admission(level)
    const attempted = recordScheduleAdmission(first.plan, now)
    const changed = admission(
      { ...level, jobs: [{ id: 'a', schedule: '0 12 * * *' }, { id: 'b' }] },
      attempted,
    )
    expect(changed.plan.startAt).toBe(now)
    expect(changed.plan.requests.map((request) => request.key)).toEqual([
      JSON.stringify(['job', 'a']),
    ])
    const retry = admission(
      changed.result.kept,
      recordScheduleAdmission(changed.plan, now),
      now + 1,
    )
    expect(retry.plan.startAt).toBeNull()
    expect(retry.result.kept.jobs).toHaveLength(2)
  })
  it('reordering or unrelated level changes do not reset a job attempt', () => {
    const level = { jobs: [{ id: 'a' }, { id: 'b' }], dropped: 0 }
    const first = admission(level)
    const attempted = recordScheduleAdmission(first.plan, now)
    const reordered = admission({ ...level, jobs: [...level.jobs].reverse() }, attempted, now + 1)
    expect(reordered.plan.startAt).toBeNull()
    const shortfall = admission({ ...level, dropped: 1 }, reordered.plan.state)
    expect(shortfall.plan.requests.map((request) => request.key)).toEqual(['shortfall'])
  })
  it('planning and blocked admission do not consume an attempt or mutate caller state', () => {
    const first = admission(unknown)
    const before = structuredClone(first.plan.state)
    expect(admission(unknown, first.plan.state, now + 1).plan.startAt).toBe(now + 1)
    expect(recordScheduleAdmission(first.plan, now - 1)).toEqual(first.plan.state)
    expect(recordScheduleAdmission(first.plan, NaN)).toEqual(first.plan.state)
    const accepted = recordScheduleAdmission(first.plan, now)
    expect(accepted[0]!.attempted).toBe(true)
    expect(first.plan.state).toEqual(before)
  })
  it('keeps the next established future wake after attempting an unknown record', () => {
    const level = { jobs: [...unknown.jobs, ...future.jobs], dropped: 0 }
    const first = admission(level)
    const attempted = recordScheduleAdmission(first.plan, now)
    expect(
      attempted.find((record) => record.key === JSON.stringify(['job', 'future']))?.attempted,
    ).toBe(false)
    const next = admission(first.result.kept, attempted, now + 1)
    expect(next.plan.startAt).toBe(now + 58 * 60_000)
  })
  it('does not repeat an already-due retained occurrence after a successful admission', () => {
    const level = {
      jobs: [
        {
          id: 'repeat',
          schedule: '0 * * * *',
          recurring: true,
          evidence: { createdAt: now - 2 * 60 * 60_000 },
        },
      ],
      dropped: 0,
    }
    const first = admission(level)
    expect(first.result.plans[0]!.result.kind).toBe('known')
    expect(first.plan.startAt).toBe(now)
    expect(
      admission(first.result.kept, recordScheduleAdmission(first.plan, now), now + 60_000).plan
        .startAt,
    ).toBeNull()
  })
  it('clock passage across a one-shot cutoff cannot reset an admitted record', () => {
    const first = admission(future)
    const attempted = recordScheduleAdmission(first.plan, first.plan.startAt!)
    const rearmed = admission(future, attempted, now + 61 * 60_000)
    expect(rearmed.result.plans[0]!.result.kind).toBe('unknown')
    expect(rearmed.plan.startAt).toBeNull()
  })
  it('a zone or supplied lead change can permit one recalculated attempt', () => {
    const first = admission(unknown)
    const attempted = recordScheduleAdmission(first.plan, now)
    for (const timing of [
      { ...context, zone: 'America/New_York' },
      { ...context, wakeLeadMs: 60_000 },
    ]) {
      const changed = admission(unknown, attempted, now, timing)
      expect(changed.plan.startAt).toBe(now)
      expect(
        admission(unknown, recordScheduleAdmission(changed.plan, now), now + 1, timing).plan
          .startAt,
      ).toBeNull()
    }
  })
  it('authoritative removal then a new record does not inherit an old attempt', () => {
    const first = admission(unknown)
    const attempted = recordScheduleAdmission(first.plan, now)
    const removed = admission({ jobs: [], dropped: 0 }, attempted)
    expect(removed.plan.state).toEqual([])
    expect(admission(unknown, removed.plan.state).plan.startAt).toBe(now)
  })
})

describe('caller-paced serial start queue', () => {
  it('many unknown conversations at app start admit one start at a time', () => {
    const conversations = Array.from({ length: 100 }, (_, index) => `synthetic-${index}`)
    let queue: WakeStartQueue = { pending: [], active: null, notBefore: now }
    for (const conversation of conversations) {
      expect(admission(unknown).plan.startAt).toBe(now)
      queue = enqueueScheduleStart(queue, conversation)
    }
    const first = takeScheduleStart(queue, now)
    expect(first.conversation).toBe(conversations[0])
    for (let index = 0; index < 100; index++)
      expect(takeScheduleStart(first.queue, now).conversation).toBeNull()
    const released = finishScheduleStart(first.queue, first.conversation!, now + 500)
    expect(takeScheduleStart(released, now).conversation).toBeNull()
    const second = takeScheduleStart(released, now + 500)
    expect(second.conversation).toBe(conversations[1])
    expect(second.queue.pending).toHaveLength(98)
    expect(queue.pending).toHaveLength(100)
  })
  it('deduplicates pending and active conversations and honors matching completion', () => {
    const empty: WakeStartQueue = { pending: [], active: null, notBefore: now }
    const queued = enqueueScheduleStart(empty, 'a')
    expect(enqueueScheduleStart(queued, 'a')).toBe(queued)
    const active = takeScheduleStart(queued, now).queue
    expect(enqueueScheduleStart(active, 'a')).toBe(active)
    expect(finishScheduleStart(active, 'other', now)).toBe(active)
    expect(finishScheduleStart(active, 'a', NaN)).toBe(active)
    expect(takeScheduleStart(queued, now - 1).conversation).toBeNull()
    expect(takeScheduleStart(queued, NaN).conversation).toBeNull()
    expect(takeScheduleStart(empty, now).conversation).toBeNull()
  })
  it('a queued conversation retains its attempt until the host actually admits it', () => {
    const first = admission(unknown)
    const queue: WakeStartQueue = { pending: ['unknown'], active: 'other', notBefore: now }
    expect(takeScheduleStart(queue, now).conversation).toBeNull()
    const rechecked = admission(first.result.kept, first.plan.state, now + 1)
    expect(rechecked.plan.startAt).toBe(now + 1)
    const accepted = recordScheduleAdmission(rechecked.plan, now + 1)
    expect(admission(first.result.kept, accepted, now + 2).plan.startAt).toBeNull()
  })
})
