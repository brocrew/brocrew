import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, MAX_SCHEDULE_HISTORY_WALKED } from '../src/main/db/session-store'
import {
  aConversationsScope,
  aJobsMaking,
  heldUntil,
  noticesWorthTelling,
  RECEIPTS_LEVEL_SOURCE,
  ScheduleEvidence,
  scheduleEvidenceOf,
  theJobOfAMaking,
  type ScheduleEvidenceRow,
} from '../src/main/runtime/schedule-evidence'
import { planReceiptSchedule } from '../src/shared/schedule-receipts'
import { createIntlCalendar, eligibilityBounds } from '../src/shared/schedule-wake'

/**
 * **A conversation's schedule is planned from the receipts and levels in its own ledger.** Rows in
 * the shapes the app appends (a `launched` row, a receipt on a `scheduled_work` row, the provider's
 * level at a turn's end, a life's `ended` status) go through the adapter into the planner, and the
 * plan is what a stopped conversation's start and the listing are decided by.
 */

const CONVERSATION = 'sess_sched'
const UTC = createIntlCalendar('UTC')
const STAMP = { calendar: UTC.identity, version: UTC.version }
const MINUTE = 60_000
/** 2026-10-07 10:00:00 UTC. */
const T0 = Date.UTC(2026, 9, 7, 10, 0)
const ONE_ERA = (): string => 'wall-1'

let ordinal = 0
const row = (at: number, type: string, payload: unknown): ScheduleEvidenceRow => ({
  ordinal: ++ordinal,
  at,
  rowType: type,
  payload,
})
const launched = (at: number) => row(at, 'launched', { type: 'launched' })
const ended = (at: number) => row(at, 'status', { type: 'status', state: 'ended' })
const level = (at: number, jobs: object[], dropped = 0) =>
  row(at, 'scheduled_work', {
    type: 'scheduled_work',
    jobs,
    ...(dropped > 0 ? { dropped } : {}),
    source: 'hook/Stop',
  })
const receipt = (at: number, value: object) =>
  row(at, 'scheduled_work', { type: 'scheduled_work', receipt: value, source: 'hook/PostToolUse' })
const created = (
  at: number,
  toolUseId: string,
  id: string,
  cron: string,
  recurring: boolean,
  extra: object = { calledAt: at - 3, stamp: STAMP },
) =>
  receipt(at, {
    tool: 'CronCreate',
    toolUseId,
    answeredAt: at,
    input: { cron, recurring },
    result: { id, recurring },
    ...extra,
  })
const deleted = (at: number, toolUseId: string, asked: string, answered?: string) =>
  receipt(at, {
    tool: 'CronDelete',
    toolUseId,
    calledAt: at - 2,
    answeredAt: at,
    stamp: STAMP,
    input: { id: asked },
    ...(answered === undefined ? {} : { result: { id: answered } }),
  })

function planned(rows: readonly ScheduleEvidenceRow[], now: number) {
  const ledger = scheduleEvidenceOf(CONVERSATION, rows, ONE_ERA, UTC)
  return planReceiptSchedule(ledger, aConversationsScope(CONVERSATION), {
    now,
    wakeLeadMs: 30_000,
    calendar: UTC,
    clockEra: 'wall-1',
    clockContinuous: true,
    noticeDelivery: { acceptedIds: [], mailbox: [] },
  })
}

describe('the evidence a ledger holds', () => {
  it('🔴 a one-shot created with its bracket has a known time, and a stopped conversation is woken just before it', () => {
    const plan = planned(
      [
        launched(T0),
        created(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '30 10 7 10 *', false),
        level(T0 + 2 * MINUTE, [{ id: 'a1b2c3d4', schedule: '30 10 7 10 *', recurring: false }]),
        ended(T0 + 3 * MINUTE),
      ],
      T0 + 5 * MINUTE,
    )
    const [state] = plan.states
    expect(state?.pendingNominalAt).toBe(Date.UTC(2026, 9, 7, 10, 30))
    expect(state?.display).toMatchObject({ label: 'scheduled', time: expect.any(String) })
    expect(state?.result.kind).toBe('known')
    // Woken before the minute, never after it.
    expect(plan.wake.startAt).toBeLessThan(Date.UTC(2026, 9, 7, 10, 30))
    expect(plan.wake.startAt).toBeGreaterThan(T0 + 5 * MINUTE)
    expect(plan.currentListing).toMatchObject({ publishable: true, count: 1 })
  })

  it('⛔ a job known only from a level has no time: one guarded start, now', () => {
    const now = T0 + 5 * MINUTE
    const plan = planned(
      [
        launched(T0),
        level(T0 + 2 * MINUTE, [{ id: 'feed0001', schedule: '*/5 * * * *', recurring: true }]),
        ended(T0 + 3 * MINUTE),
      ],
      now,
    )
    expect(plan.states[0]?.display.label).toBe('time-unknown')
    expect(plan.states[0]?.result.kind).toBe('unknown')
    expect(plan.wake.startAt).toBe(now)
  })

  it('⛔ a receipt with no bracket, or none kept with its calendar, gives no time', () => {
    for (const extra of [{ stamp: STAMP }, { calledAt: T0 + MINUTE - 3 }]) {
      const plan = planned(
        [launched(T0), created(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '30 10 7 10 *', false, extra)],
        T0 + 5 * MINUTE,
      )
      expect(plan.states[0]?.result.kind, JSON.stringify(extra)).toBe('unknown')
      expect(plan.states[0]?.pendingNominalAt).toBeUndefined()
    }
  })

  it('⛔ a bracket that crosses a clock jump is no bracket', () => {
    const at = T0 + MINUTE
    const ledger = scheduleEvidenceOf(
      CONVERSATION,
      [launched(T0), created(at, 'toolu_1', 'a1b2c3d4', '30 10 7 10 *', false)],
      (moment) => (moment < at ? 'wall-1' : 'wall-2'),
      UTC,
    )
    const plan = planReceiptSchedule(ledger, aConversationsScope(CONVERSATION), {
      now: T0 + 5 * MINUTE,
      wakeLeadMs: 30_000,
      calendar: UTC,
      clockEra: 'wall-2',
      clockContinuous: true,
      noticeDelivery: { acceptedIds: [], mailbox: [] },
    })
    expect(plan.states[0]?.result.kind).toBe('unknown')
  })

  it('🔴 a confirmed cancellation leaves the listing in the same turn; the other job stays', () => {
    const rows = [
      launched(T0),
      created(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '*/5 * * * *', true),
      created(T0 + 2 * MINUTE, 'toolu_2', 'feed0001', '0 9 * * *', true),
    ]
    expect(planned(rows, T0 + 3 * MINUTE).currentListing.count).toBe(2)
    const after = planned(
      [...rows, deleted(T0 + 4 * MINUTE, 'toolu_3', 'a1b2c3d4', 'a1b2c3d4')],
      T0 + 5 * MINUTE,
    )
    expect(after.currentListing.count).toBe(1)
    expect(after.currentListing.jobs.map((one) => one.job.id)).toEqual(['feed0001'])
  })

  it('⛔ a cancellation with no answer, or of an id never created, cancels nothing', () => {
    const rows = [launched(T0), created(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '*/5 * * * *', true)]
    const unanswered = planned(
      [...rows, deleted(T0 + 2 * MINUTE, 'toolu_2', 'a1b2c3d4')],
      T0 + 3 * MINUTE,
    )
    expect(unanswered.currentListing.jobs).toMatchObject([
      { job: { id: 'a1b2c3d4' }, cancellationLabel: 'cancellation not confirmed' },
    ])
    const stranger = planned(
      [...rows, deleted(T0 + 2 * MINUTE, 'toolu_2', 'cafe0000', 'cafe0000')],
      T0 + 3 * MINUTE,
    )
    expect(stranger.currentListing.jobs.map((one) => one.job.id)).toEqual(['a1b2c3d4'])
  })

  it('⚑ a level the app wrote is not evidence; the provider’s complete level is', () => {
    const rows = [
      launched(T0),
      created(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '*/5 * * * *', true),
      row(T0 + 2 * MINUTE, 'scheduled_work', {
        type: 'scheduled_work',
        jobs: [],
        source: RECEIPTS_LEVEL_SOURCE,
      }),
    ]
    expect(planned(rows, T0 + 3 * MINUTE).currentListing.count).toBe(1)
    expect(
      planned([...rows, level(T0 + 4 * MINUTE, [])], T0 + 5 * MINUTE).currentListing.count,
    ).toBe(0)
  })

  it('⛔ a sub-agent’s call is not its parent’s job', () => {
    const plan = planned(
      [
        launched(T0),
        created(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '*/5 * * * *', true, {
          calledAt: T0 + MINUTE - 3,
          stamp: STAMP,
          childId: 'a1755ad0b5cc0a876',
        }),
      ],
      T0 + 3 * MINUTE,
    )
    expect(plan.currentListing.count).toBe(0)
  })

  it('⚑ the same rows give the same evidence, in any order they were read', () => {
    const rows = [
      launched(T0),
      created(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '30 10 7 10 *', false),
      ended(T0 + 3 * MINUTE),
    ]
    expect(scheduleEvidenceOf(CONVERSATION, [...rows].reverse(), ONE_ERA, UTC)).toEqual(
      scheduleEvidenceOf(CONVERSATION, rows, ONE_ERA, UTC),
    )
  })
})

describe('the name a making of a job is kept under', () => {
  const makingsOf = (rows: readonly ScheduleEvidenceRow[]): string[] =>
    plannedWith(rows, T0 + 30 * MINUTE).plan.states.map((one) => aJobsMaking(one.generation))

  it('⛔ no two makings read alike: not ids that join to the same string, nor one call id used in two lives', () => {
    // Joined with a colon, `a:b` made by `c` and `a` made by `b:c` would both read `a:b:c`.
    const joined = makingsOf([
      launched(T0),
      created(T0 + MINUTE, 'c', 'a:b', '30 10 7 10 *', false),
      created(T0 + 2 * MINUTE, 'b:c', 'a', '31 10 7 10 *', false),
    ])
    expect(new Set(joined).size).toBe(2)

    // The same call id, in two lives: two makings, by the row each result was kept in.
    const twoLives = makingsOf([
      launched(T0),
      created(T0 + MINUTE, 'toolu_same', 'same-job', '30 10 7 10 *', false),
      ended(T0 + 2 * MINUTE),
      launched(T0 + 3 * MINUTE),
      created(T0 + 4 * MINUTE, 'toolu_same', 'same-job', '31 10 7 10 *', false),
    ])
    expect(new Set(twoLives).size).toBe(2)
  })

  it('⚑ a rebuild from fewer rows — an older life no longer read — names a making as before', () => {
    const later = created(T0 + 4 * MINUTE, 'toolu_2', 'later-job', '31 10 7 10 *', false)
    const secondLife = launched(T0 + 3 * MINUTE)
    const whole = makingsOf([
      launched(T0),
      created(T0 + MINUTE, 'toolu_1', 'first-job', '30 10 7 10 *', false),
      ended(T0 + 2 * MINUTE),
      secondLife,
      later,
    ])
    const fewer = makingsOf([secondLife, later])
    expect(fewer).toHaveLength(1)
    expect(whole).toContain(fewer[0])
  })

  it('⚑ the same rows name a making the same way, and a job only listed is named apart from one made', () => {
    const rows = [...madeAndListed()]
    expect(makingsOf(rows)).toEqual(makingsOf(rows))
    const [made] = makingsOf(rows)
    const [listed] = makingsOf([launched(T0), level(T0 + MINUTE, [ONE_SHOT])])
    expect(made).not.toBe(listed)
    expect(theJobOfAMaking(listed ?? '')).toEqual({ job: ONE_SHOT.id, made: false })
    expect(theJobOfAMaking('not a making')).toBeUndefined()
  })
})

describe('a reset of its provider’s conversation', () => {
  /** This app's own mark of one, as its host writes it. */
  const reset = (at: number): ScheduleEvidenceRow =>
    row(at, 'scheduled_work', {
      type: 'scheduled_work',
      reset: true,
      source: RECEIPTS_LEVEL_SOURCE,
    })

  it('⚑ a job from before it is heard of again only once its provider lists it, or it is made, after', () => {
    const before = [...madeAndListed(), reset(T0 + 3 * MINUTE)]
    const unheard = plannedWith(before, T0 + 5 * MINUTE)
    const made = unheard.plan.states[0]?.generation
    if (made === undefined) throw new Error('the plan names the job')
    // ⛔ The mark is no observation: the job is still planned, with the time its receipt gives…
    expect(unheard.plan.wake.plans.map(({ job, result }) => [job.id, result.kind])).toEqual([
      [ONE_SHOT.id, 'known'],
    ])
    // …but nothing has been heard of it since.
    expect(unheard.evidence.heardOfSinceItsReset(made)).toBe(false)
    expect(unheard.evidence.itsReset).toBeDefined()

    // Its provider lists it after the reset: heard of, and its time is as known as before.
    const listed = plannedWith([...before, level(T0 + 4 * MINUTE, [ONE_SHOT])], T0 + 5 * MINUTE)
    const again = listed.plan.states[0]?.generation
    if (again === undefined) throw new Error('the plan names the job')
    expect(listed.evidence.heardOfSinceItsReset(again)).toBe(true)
    expect(listed.plan.wake.plans.map(({ result }) => result.kind)).toEqual(['known'])

    // One made after the reset is heard of from its making.
    const later = plannedWith(
      [...before, created(T0 + 4 * MINUTE, 'toolu_2', 'later-job', '45 10 7 10 *', false)],
      T0 + 5 * MINUTE,
    )
    expect(
      later.plan.states.map((one) => [
        one.generation.jobId,
        later.evidence.heardOfSinceItsReset(one.generation),
      ]),
    ).toEqual([
      [ONE_SHOT.id, false],
      ['later-job', true],
    ])
  })

  it('⛔ a reset whose mark could not be written fences by its moment, and one fenced at once fences what was taken before it', () => {
    const { evidence, plan } = plannedWith(madeAndListed(), T0 + 5 * MINUTE)
    const made = plan.states[0]?.generation
    if (made === undefined) throw new Error('the plan names the job')
    evidence.itsProviderWasResetAt(T0 + 3 * MINUTE)
    expect(evidence.heardOfSinceItsReset(made)).toBe(false)
    // A listing after that moment is heard of.
    const listedAfter = plannedWith(
      [...madeAndListed(), level(T0 + 4 * MINUTE, [ONE_SHOT])],
      T0 + 5 * MINUTE,
    )
    listedAfter.evidence.itsProviderWasResetAt(T0 + 3 * MINUTE)
    const again = listedAfter.plan.states[0]?.generation
    if (again === undefined) throw new Error('the plan names the job')
    expect(listedAfter.evidence.heardOfSinceItsReset(again)).toBe(true)

    // Fenced at once, with no row: what was taken before is not heard of since.
    const now = plannedWith(madeAndListed(), T0 + 5 * MINUTE)
    now.evidence.itsProviderWasReset()
    const before = now.plan.states[0]?.generation
    if (before === undefined) throw new Error('the plan names the job')
    expect(now.evidence.heardOfSinceItsReset(before)).toBe(false)
  })

  it('⚑ with no reset read, every job has been heard of', () => {
    const { evidence, plan } = plannedWith(madeAndListed(), T0 + 5 * MINUTE)
    const made = plan.states[0]?.generation
    if (made === undefined) throw new Error('the plan names the job')
    expect(evidence.itsReset).toBeUndefined()
    expect(evidence.heardOfSinceItsReset(made)).toBe(true)
  })
})

describe('a history whose older rows were not read', () => {
  it('⚑ a cancellation confirms only a job the rows still hold; one they do not hold names nothing', () => {
    // The making of both jobs is older than the rows read: one is still listed, one is not.
    const plan = planned(
      [
        launched(T0),
        level(T0 + MINUTE, [{ id: 'listed-1', schedule: '0 3 * * *', recurring: true }]),
        deleted(T0 + 2 * MINUTE, 'toolu_d1', 'listed-1', 'listed-1'),
        deleted(T0 + 3 * MINUTE, 'toolu_d2', 'never-seen', 'never-seen'),
      ],
      T0 + 5 * MINUTE,
    )
    expect(plan.states.map((one) => [one.generation.jobId, one.generation.presence])).toEqual([
      ['listed-1', 'cancelled'],
    ])
    expect(plan.currentListing.jobs).toEqual([])
    expect(plan.notices).toEqual([])
  })

  it('⚑ a job known only from where it is listed has no time, whatever its expression says', () => {
    const plan = planned(
      [
        launched(T0),
        level(T0 + MINUTE, [{ id: 'listed-1', schedule: '0 3 * * *', recurring: true }]),
      ],
      T0 + 5 * MINUTE,
    )
    expect(plan.wake.plans.map(({ job, result }) => [job.id, result.kind])).toEqual([
      ['listed-1', 'unknown'],
    ])
    expect(plan.states[0]?.nextNominalAt).toBeUndefined()
    expect(plan.states[0]?.pendingNominalAt).toBeUndefined()
  })
})

/** The plan of these rows at `now`, with the evidence it was made from. */
function plannedWith(rows: readonly ScheduleEvidenceRow[], now: number, told: string[] = []) {
  const evidence = new ScheduleEvidence(CONVERSATION, ONE_ERA)
  for (const one of rows) evidence.add(one)
  const ledger = evidence.on(UTC)
  const plan = planReceiptSchedule(ledger, aConversationsScope(CONVERSATION), {
    now,
    wakeLeadMs: 30_000,
    calendar: UTC,
    clockEra: 'wall-1',
    clockContinuous: true,
    noticeDelivery: { acceptedIds: told, mailbox: [] },
  })
  return { evidence, ledger, plan }
}

const HALF_PAST = Date.UTC(2026, 9, 7, 10, 30)
const ONE_SHOT = { id: 'a1b2c3d4', schedule: '30 10 7 10 *', recurring: false }
const madeAndListed = (): ScheduleEvidenceRow[] => [
  launched(T0),
  created(T0 + MINUTE, 'toolu_1', ONE_SHOT.id, ONE_SHOT.schedule, false),
  level(T0 + 2 * MINUTE, [ONE_SHOT]),
]

describe('which notices are worth a turn', () => {
  const sorted = (rows: readonly ScheduleEvidenceRow[], now: number, toldOf: string[] = []) => {
    const { ledger, plan } = plannedWith(rows, now)
    const { tell, settle } = noticesWorthTelling(ledger, plan, new Set(toldOf), UTC, now)
    return {
      tell: tell.map((one) => one.reason),
      settle: settle.map((one) => one.reason),
    }
  }

  it('⚑ a job that left the listing in the life that made it needs no word', () => {
    expect(sorted([...madeAndListed(), level(T0 + 3 * MINUTE, [])], T0 + 5 * MINUTE)).toMatchObject(
      { tell: [], settle: ['not-present'] },
    )
  })

  it('🔴 a job a start did not bring back, before its time, is told', () => {
    const rows = [
      ...madeAndListed(),
      ended(T0 + 3 * MINUTE),
      launched(T0 + 5 * MINUTE),
      level(T0 + 6 * MINUTE, []),
    ]
    const first = sorted(rows, T0 + 7 * MINUTE)
    expect(first).toMatchObject({ tell: ['not-present'], settle: [] })
    // ⚑ …unless it has already been told something of that job, as that call made it.
    const { plan } = plannedWith(rows, T0 + 7 * MINUTE)
    const made = plan.states.find((one) => one.generation.jobId === ONE_SHOT.id)?.generation
    if (made === undefined) throw new Error('the plan names the job')
    expect(theJobOfAMaking(aJobsMaking(made))).toEqual({ job: ONE_SHOT.id, made: true })
    expect(sorted(rows, T0 + 7 * MINUTE, [aJobsMaking(made)])).toMatchObject({
      tell: [],
      settle: ['not-present'],
    })
    // ⛔ What was told of another making under the same id settles nothing.
    const onlyListed = JSON.stringify(['listed', ONE_SHOT.id, null])
    expect(theJobOfAMaking(onlyListed)).toEqual({ job: ONE_SHOT.id, made: false })
    expect(sorted(rows, T0 + 7 * MINUTE, [onlyListed])).toMatchObject({
      tell: ['not-present'],
      settle: [],
    })
  })

  it('⚑ a job whose minute came in the life that then left it out needs no word', () => {
    const rows = [
      ...madeAndListed(),
      ended(T0 + 3 * MINUTE),
      launched(T0 + 20 * MINUTE),
      level(HALF_PAST + MINUTE, []),
    ]
    expect(sorted(rows, HALF_PAST + 2 * MINUTE)).toMatchObject({
      tell: [],
      settle: ['not-present'],
    })
  })

  it('🔴 a one-shot whose minute passed while it was stopped is told', () => {
    expect(
      sorted([...madeAndListed(), ended(T0 + 3 * MINUTE)], HALF_PAST + 10 * MINUTE),
    ).toMatchObject({ tell: ['offline-time-passed'], settle: [] })
  })
})

describe('a job that left the listing long ago is old news', () => {
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR
  // A one-shot a month ahead: its minute never comes in these cases.
  const AHEAD = { id: 'f4r4h3ad', schedule: '30 10 7 11 *', recurring: false }
  const sorted = (rows: readonly ScheduleEvidenceRow[], now: number) => {
    const { ledger, plan } = plannedWith(rows, now)
    const { tell, settle } = noticesWorthTelling(ledger, plan, new Set(), UTC, now)
    return { tell: tell.map((one) => one.reason), settle: settle.map((one) => one.reason) }
  }
  const TOLD = { tell: ['not-present'], settle: [] }
  const SILENT = { tell: [], settle: ['not-present'] }
  const made = (): ScheduleEvidenceRow[] => [
    launched(T0),
    created(T0 + MINUTE, 'toolu_1', AHEAD.id, AHEAD.schedule, false),
    level(T0 + 2 * MINUTE, [AHEAD]),
    ended(T0 + 3 * MINUTE),
  ]
  /** A life that began at `at`, listed these jobs a minute later, and ended a minute after that. */
  const aLife = (at: number, jobs: (typeof AHEAD)[] = []): ScheduleEvidenceRow[] => [
    launched(at),
    level(at + MINUTE, jobs),
    ended(at + 2 * MINUTE),
  ]
  /** When the life begun at `at` listed its jobs. */
  const listedIn = (at: number): number => at + MINUTE

  it('🔴 a job a start did not bring back after three days closed is told: its age is that of the listing that left it out', () => {
    const rows = [...made(), ...aLife(T0 + 3 * DAY)]
    expect(sorted(rows, T0 + 3 * DAY + 5 * MINUTE)).toEqual(TOLD)
  })

  it('🔴 …and told however long the app is then closed, and at the stop of the next life', () => {
    const left = T0 + HOUR
    const rows = [...made(), ...aLife(left)]
    // ⚑ Nothing has run since: no plan was made that could have told it.
    expect(sorted(rows, left + 3 * DAY)).toEqual(TOLD)
    // ⚑ The first life since is the one whose stop first plans for it.
    expect(sorted([...rows, ...aLife(left + 3 * DAY)], left + 3 * DAY + 5 * MINUTE)).toEqual(TOLD)
    // …however long that life ran.
    expect(sorted([...rows, ...aLife(left + 3 * DAY)], left + 9 * DAY)).toEqual(TOLD)
  })

  it('⚑ left over a day ago, with the conversation started twice since, it needs no word', () => {
    const left = T0 + HOUR
    const rows = [...made(), ...aLife(left), ...aLife(left + 2 * HOUR), ...aLife(left + 4 * HOUR)]
    expect(sorted(rows, listedIn(left) + DAY + MINUTE)).toEqual(SILENT)
    expect(sorted(rows, listedIn(left) + 8 * DAY)).toEqual(SILENT)
  })

  it('⚑ the boundary: at twenty-four hours it is told, a millisecond over it is not', () => {
    const left = T0 + HOUR
    const rows = [...made(), ...aLife(left), ...aLife(left + 2 * HOUR), ...aLife(left + 4 * HOUR)]
    expect(sorted(rows, listedIn(left) + DAY - 1)).toEqual(TOLD)
    expect(sorted(rows, listedIn(left) + DAY)).toEqual(TOLD)
    expect(sorted(rows, listedIn(left) + DAY + 1)).toEqual(SILENT)
  })

  it('⚑ its age is not that of the newest listing to leave it out', () => {
    const left = T0 + HOUR
    const rows = [...made(), ...aLife(left), ...aLife(left + 2 * DAY), ...aLife(left + 3 * DAY)]
    // The newest listing without it is four minutes old.
    expect(sorted(rows, left + 3 * DAY + 5 * MINUTE)).toEqual(SILENT)
  })

  it('⚑ a job that came back and left again is as old as its last leaving', () => {
    const back = T0 + 2 * DAY
    const left = T0 + 5 * DAY
    const rows = [
      ...made(),
      ...aLife(T0 + HOUR),
      ...aLife(back, [AHEAD]),
      ...aLife(left),
      ...aLife(left + HOUR),
      ...aLife(left + 2 * HOUR),
    ]
    expect(sorted(rows, left + 3 * HOUR)).toEqual(TOLD)
    expect(sorted(rows, listedIn(left) + DAY + 1)).toEqual(SILENT)
  })

  it('🔴 a one-shot whose minute passed while it was stopped is told at any age', () => {
    const rows = [
      ...madeAndListed(),
      ended(T0 + 3 * MINUTE),
      ...aLife(HALF_PAST + HOUR),
      ...aLife(HALF_PAST + 2 * HOUR),
      ...aLife(HALF_PAST + 3 * HOUR),
    ]
    expect(sorted(rows, HALF_PAST + 9 * DAY)).toEqual(TOLD)
    // ⚑ The control: the same one-shot, left out before its minute, is old news by then.
    const before = [
      ...madeAndListed(),
      ended(T0 + 3 * MINUTE),
      ...aLife(T0 + 5 * MINUTE),
      ...aLife(HALF_PAST + 2 * HOUR),
      ...aLife(HALF_PAST + 3 * HOUR),
    ]
    expect(sorted(before, HALF_PAST + 9 * DAY)).toEqual(SILENT)
  })
})

describe('a life the app died under', () => {
  it('🔴 has no row for its end: taken as ended when its provider last spoke, a job whose minute passed since is told', () => {
    const { evidence } = plannedWith(madeAndListed(), T0 + 3 * MINUTE)
    expect(evidence.itsLifeIsOpen).toBe(true)
    // ⚑ The control: with no end known, nothing says it was stopped at half past.
    expect(plannedWith(madeAndListed(), HALF_PAST + 10 * MINUTE).plan.notices).toEqual([])

    evidence.itsLifeEndedUnseen(T0 + 3 * MINUTE)
    expect(evidence.itsLifeIsOpen).toBe(false)
    const plan = planReceiptSchedule(evidence.on(UTC), aConversationsScope(CONVERSATION), {
      now: HALF_PAST + 10 * MINUTE,
      wakeLeadMs: 30_000,
      calendar: UTC,
      clockEra: 'wall-1',
      clockContinuous: true,
      noticeDelivery: { acceptedIds: [], mailbox: [] },
    })
    expect(plan.notices.map((one) => one.reason)).toEqual(['offline-time-passed'])
    // Said twice, it is one ending.
    evidence.itsLifeEndedUnseen(T0 + 4 * MINUTE)
    expect(evidence.on(UTC).observations.filter((row) => row.kind === 'lifecycle')).toHaveLength(2)
  })

  it('⚑ the next life’s beginning ends it, at that moment and no earlier', () => {
    const rows = [...madeAndListed(), launched(HALF_PAST + 5 * MINUTE)]
    const { evidence, plan } = plannedWith(rows, HALF_PAST + 10 * MINUTE)
    // Nothing says it was stopped at half past: no word that its minute passed while stopped.
    expect(plan.notices).toEqual([])
    expect(evidence.itsLifeIsOpen).toBe(true)
  })
})

describe('until when a life started for its jobs holds them', () => {
  const LEAD = 30_000
  const BRIEF = 120_000
  const held = (rows: readonly ScheduleEvidenceRow[], now: number): number | null =>
    heldUntil(plannedWith(rows, now).plan, UTC, now, LEAD, BRIEF)

  it('🔴 a one-shot until its minute and the lead; one already past, briefly', () => {
    const rows = [...madeAndListed(), ended(T0 + 3 * MINUTE)]
    expect(held(rows, T0 + 5 * MINUTE)).toBe(HALF_PAST + LEAD)
    expect(held(rows, HALF_PAST + MINUTE)).toBe(HALF_PAST + MINUTE + BRIEF)
  })

  it('🔴 a repeating job until its next time and how late that may be, whether or not it has a receipt', () => {
    const daily = { id: 'feed0001', schedule: '0 3 * * *', recurring: true }
    const next = Date.UTC(2026, 9, 8, 3, 0)
    const latest = eligibilityBounds(next, true, 0)!.latestEligibleAt
    expect(latest).toBeGreaterThanOrEqual(next)
    const made = [
      launched(T0),
      created(T0 + MINUTE, 'toolu_1', daily.id, daily.schedule, true),
      level(T0 + 2 * MINUTE, [daily]),
      ended(T0 + 3 * MINUTE),
    ]
    expect(held(made, T0 + 5 * MINUTE)).toBe(latest + LEAD)
    const listedOnly = [launched(T0), level(T0 + 2 * MINUTE, [daily]), ended(T0 + 3 * MINUTE)]
    expect(held(listedOnly, T0 + 5 * MINUTE)).toBe(latest + LEAD)
  })

  it('⛔ a job this app cannot place, or rows the level could not list: until its provider states a level', () => {
    const unread = { id: 'feed0002', schedule: 'every tuesday', recurring: true }
    expect(
      held([launched(T0), level(T0 + MINUTE, [unread]), ended(T0 + 2 * MINUTE)], T0 + 5 * MINUTE),
    ).toBeNull()
    const unsaid = { id: 'feed0003', schedule: '0 3 * * *' }
    expect(
      held([launched(T0), level(T0 + MINUTE, [unsaid]), ended(T0 + 2 * MINUTE)], T0 + 5 * MINUTE),
    ).toBeNull()
    expect(
      held(
        [launched(T0), level(T0 + MINUTE, [ONE_SHOT], 2), ended(T0 + 2 * MINUTE)],
        T0 + 5 * MINUTE,
      ),
    ).toBeNull()
  })

  it('⚑ nothing listed, nothing held', () => {
    expect(held([launched(T0), ended(T0 + MINUTE)], T0 + 5 * MINUTE)).toBe(T0 + 5 * MINUTE)
  })
})

describe('the rows the store hands the evidence', () => {
  const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

  it('🔴 levels, receipts, launches and life endings, oldest first, through the fold’s index; nothing else', () => {
    const directory = mkdtempSync(join(tmpdir(), 'brobot-schedule-evidence-'))
    const db = openDatabase(':memory:')
    try {
      applyMigrations(db, migrations)
      const store = createSessionStore(db, () => 1)
      for (const id of [CONVERSATION, 'sess_other']) {
        store.create({
          id,
          provider: 'claude',
          cwd: directory,
          approvalMode: 'ask',
          profileId: 'a',
        })
      }
      let next = 0
      const put = (
        session: string,
        type: string,
        payload: object | string,
        at: number,
        generation = 0,
      ) => {
        next += 1
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `fixture-${String(next)}`,
          session,
          generation,
          next,
          type,
          typeof payload === 'string' ? payload : JSON.stringify(payload),
          at,
        )
      }
      put(CONVERSATION, 'launched', { type: 'launched' }, 10)
      put(CONVERSATION, 'status', { type: 'status', state: 'working' }, 11)
      put(CONVERSATION, 'assistant_message', { type: 'assistant_message', text: 'hello' }, 12)
      put(
        CONVERSATION,
        'scheduled_work',
        { type: 'scheduled_work', receipt: { tool: 'CronCreate' }, source: 'hook/PostToolUse' },
        13,
      )
      // ⚑ The receipt of a call that neither makes nor cancels a job is left out.
      put(
        CONVERSATION,
        'scheduled_work',
        { type: 'scheduled_work', receipt: { tool: 'CronList' }, source: 'hook/PostToolUse' },
        13,
      )
      put(CONVERSATION, 'scheduled_work', '{ torn', 14)
      put(CONVERSATION, 'status', { type: 'status', state: 'ended' }, 15)
      // ⚑ A level this app wrote is derived from the rest, and is left out.
      put(
        CONVERSATION,
        'scheduled_work',
        { type: 'scheduled_work', jobs: [], source: RECEIPTS_LEVEL_SOURCE },
        16,
      )
      // A level an earlier generation holds is read too, in the order of its moment.
      put(
        CONVERSATION,
        'scheduled_work',
        { type: 'scheduled_work', jobs: [], source: 'hook/Stop' },
        9,
        1,
      )
      put('sess_other', 'launched', { type: 'launched' }, 10)

      const read = store.scheduleEvidenceRows(CONVERSATION)
      expect(read.rows.map((one) => [one.at, one.rowType])).toEqual([
        [9, 'scheduled_work'],
        [10, 'launched'],
        [13, 'scheduled_work'],
        [15, 'status'],
      ])
      expect(read.cut).toBe(false)
      expect(store.scheduleEvidenceRows('sess_nobody')).toEqual({ rows: [], cut: false })

      // ⚑ A row two generations hold is given once, as the newer of them holds it.
      for (const [generation, id] of [
        [0, 'as-first-read'],
        [1, 'as-read-again'],
      ] as const) {
        db.prepare(
          `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
           VALUES (?, ?, ?, 500, 'scheduled_work', ?, 20)`,
        ).run(
          `twice-${String(generation)}`,
          CONVERSATION,
          generation,
          JSON.stringify({ type: 'scheduled_work', jobs: [{ id }], source: 'hook/Stop' }),
        )
      }
      const twice = store.scheduleEvidenceRows(CONVERSATION).rows.filter((one) => one.at === 20)
      expect(twice).toHaveLength(1)
      expect(twice[0]?.payload).toMatchObject({ jobs: [{ id: 'as-read-again' }] })

      // ⛔ Bounded: a million later rows of this conversation, half of them of the kinds the folds
      // read. Only its newest are looked at — the job's making, now far past the bound, is not
      // among them — and the read says its history is cut.
      db.exec(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1000000)
        INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
        SELECT 'later-'||n, '${CONVERSATION}', 1, 1000+n,
               CASE n % 2 WHEN 0 THEN 'status' ELSE 'tool_result' END,
               '{"type":"status","state":"working"}', 100+n FROM seq`)
      const walked: string[] = []
      db.function('json_valid', { deterministic: true }, (text: unknown) => {
        walked.push(String(text))
        return 1
      })
      const cut = store.scheduleEvidenceRows(CONVERSATION)
      expect(cut.cut).toBe(true)
      expect(cut.rows).toEqual([])
      // …and it looked at no more than one row past its bound, in one statement, whatever the
      // conversation holds: every row it walked was a status row here, and each was checked once.
      expect(walked.length).toBeGreaterThan(0)
      expect(walked.length).toBeLessThanOrEqual(MAX_SCHEDULE_HISTORY_WALKED + 1)
    } finally {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
