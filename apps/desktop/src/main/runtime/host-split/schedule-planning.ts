import { errorMessage } from '../session-disclosures'
import {
  aWordOfThePlanners,
  dealtWith,
  type WordOwed,
  type AWordOfThisApps,
} from '../schedule-notices'
import type { NotStartedBecause } from '@brobot2/runtime'
import type { SessionStore } from '../../db/session-store'
import type { ScheduledRow, ScheduleLevel } from '../../../shared/agent-state-contracts'
import {
  eligibilityBounds,
  nextCronOccurrence,
  type CalendarSource,
} from '../../../shared/schedule-wake'
import { planReceiptSchedule, type ReceiptSchedulePlan } from '../../../shared/schedule-receipts'
import {
  planScheduleAdmission,
  type WakeAdmissionPlan,
} from '../../../shared/schedule-wake-admission'
import type { ConversationAttempts } from '../../schedule-attempts-file'
import {
  aConversationsScope,
  aJobsMaking,
  theJobOfAMaking,
  noticesWorthTelling,
  type ScheduleEvidence,
} from '../schedule-evidence'

/** One repeating run and the start owed before its nominal minute. */
export interface RunOwed {
  readonly job: string
  readonly making: string
  readonly runAt: number
  readonly startAt: number
  /** Consecutive starts left unanswered by the provider, including this one. */
  readonly unanswered: number
}

/** Starts, runs and notices derived from one conversation's current plan. */
export interface OwedToItsJobs {
  readonly admission: WakeAdmissionPlan
  readonly runs: readonly RunOwed[]
  readonly itsRuns: ReadonlyMap<string, number | undefined>
  readonly notStarted: ReadonlyMap<string, NotStartedBecause>
  readonly words: readonly WordOwed[]
}

export interface PlannedWake {
  readonly plan: ReceiptSchedulePlan
  readonly admission: WakeAdmissionPlan
  readonly runs: readonly RunOwed[]
  readonly words: readonly WordOwed[]
  /** The soonest requested start; null when no start is owed. */
  readonly startAt: number | null
  readonly level: ScheduleLevel
}

function itsRepeatingJobsOfKnownTime(plan: ReceiptSchedulePlan): {
  readonly job: string
  readonly making: string
  readonly schedule: string
  readonly state: ReceiptSchedulePlan['states'][number]
}[] {
  return plan.wake.plans.flatMap(({ job, result }) => {
    if (job.recurring !== true || result.kind !== 'known' || job.schedule === undefined) return []
    const state = plan.states.find((one) => one.generation.generation === job.evidence?.generation)
    if (state === undefined || state.age === 'expired') return []
    return [{ job: job.id, making: aJobsMaking(state.generation), schedule: job.schedule, state }]
  })
}

function theRunAfter(
  schedule: string,
  after: number,
  calendar: CalendarSource,
): number | undefined {
  const next = nextCronOccurrence(schedule, { after, inclusive: false, zone: 'UTC', calendar })
  return next.kind === 'known' ? next.nominalAt : undefined
}

const theJobsItWasToldOf = (kept: ConversationAttempts): ReadonlySet<string> =>
  new Set(kept.told.filter((one) => one.said).map((one) => one.of))

/** Allow home restoration before the provider reaches the job's minute. */
export const WAKE_LEAD_MS = 30_000

/** Scheduling evidence uses the existing wall-clock era; clock changes are not inferred. */
export const THE_ONE_CLOCK_ERA = 'wall'

const STARTS_WITH_NO_WORD_OF_A_JOB = 3

interface SchedulePlanningOperations {
  itsCalendar(): CalendarSource
  itsEvidence(conversation: string): ScheduleEvidence
  itsAttempts(conversation: string): ConversationAttempts
  keepItsAttempts(conversation: string, record: ConversationAttempts): void
  hasSlot(conversation: string): boolean
  startReservedFor(conversation: string): ConversationAttempts | undefined
  keptAttemptsFor(conversation: string): ConversationAttempts | undefined
}

/** Derive starts, runs and notices from the current evidence and original kept attempts. */
export class SchedulePlanning {
  constructor(
    private readonly deps: { store: Pick<SessionStore, 'lastStatusAt'> },
    private readonly ops: SchedulePlanningOperations,
  ) {}

  planItsSchedule(conversation: string, now: number): ReceiptSchedulePlan | null {
    try {
      const calendar = this.ops.itsCalendar()
      return planReceiptSchedule(
        this.ops.itsEvidence(conversation).on(calendar),
        aConversationsScope(conversation),
        {
          now,
          wakeLeadMs: WAKE_LEAD_MS,
          calendar,
          clockEra: THE_ONE_CLOCK_ERA,
          clockContinuous: true,
          noticeDelivery: {
            acceptedIds: this.ops.itsAttempts(conversation).told.map((one) => one.id),
            mailbox: [],
          },
        },
      )
    } catch (error) {
      console.warn(
        `runtime host could not plan what ${conversation} has scheduled: ${errorMessage(error)}`,
      )
      return null
    }
  }

  theLevelItPlans(
    conversation: string,
    plan: ReceiptSchedulePlan,
    now: number,

    itsRuns: ReadonlyMap<string, number | undefined> = new Map(),

    notStarted: ReadonlyMap<string, NotStartedBecause> = new Map(),
  ): ScheduleLevel {
    const evidence = this.ops.itsEvidence(conversation)
    const calendar = this.ops.itsCalendar()
    return {
      jobs: plan.currentListing.jobs.map(({ job }): ScheduledRow => {
        const state = plan.states.find(
          (one) => one.generation.generation === job.evidence?.generation,
        )
        const nominalAt =
          state === undefined
            ? undefined
            : itsRuns.has(job.id)
              ? itsRuns.get(job.id)
              : job.recurring === true
                ? state.age === 'expired'
                  ? undefined
                  : (state.nextNominalAt ??
                    (state.generation.creation === undefined || job.schedule === undefined
                      ? undefined
                      : theRunAfter(job.schedule, now, calendar)))
                : state.display.label === 'scheduled'
                  ? state.pendingNominalAt
                  : undefined
        const { prompt } = evidence.askedBy(job.id)
        const why = notStarted.get(job.id)
        return {
          id: job.id,
          ...(job.schedule === undefined ? {} : { schedule: job.schedule }),
          ...(job.recurring === undefined ? {} : { recurring: job.recurring }),
          ...(prompt === undefined ? {} : { prompt }),
          ...(nominalAt === undefined ? {} : { nominalAt }),
          ...(why === undefined ? {} : { notStarted: why }),
        }
      }),
      dropped: plan.currentListing.dropped,
    }
  }

  settleWhatItSaw(conversation: string, plan: ReceiptSchedulePlan, now: number): boolean {
    if (plan.notices.length === 0) return false
    try {
      const before = this.ops.itsAttempts(conversation)
      const calendar = this.ops.itsCalendar()
      const { settle } = noticesWorthTelling(
        this.ops.itsEvidence(conversation).on(calendar),
        plan,
        theJobsItWasToldOf(before),
        calendar,
        now,
      )
      if (settle.length === 0) return false
      this.ops.keepItsAttempts(conversation, {
        ...before,
        told: [
          ...before.told,
          ...settle.map((notice) => dealtWith(aWordOfThePlanners(plan, notice), false)),
        ],
        at: now,
      })
      return true
    } catch (error) {
      console.warn(
        `runtime host could not settle what ${conversation} saw of its jobs: ${errorMessage(error)}`,
      )
      return false
    }
  }

  planItsWake(
    conversation: string,
    now: number,

    lastKnown: ScheduleLevel | undefined,
  ): PlannedWake | null {
    try {
      const evidence = this.ops.itsEvidence(conversation)
      if (evidence.itsLifeIsOpen && !this.ops.hasSlot(conversation)) {
        evidence.itsLifeEndedUnseen(this.deps.store.lastStatusAt(conversation) ?? now)
      }
    } catch (error) {
      console.warn(
        `runtime host could not read when ${conversation} last ran: ${errorMessage(error)}`,
      )
    }
    let plan = this.planItsSchedule(conversation, now)
    if (plan === null) return null
    const evidence = this.ops.itsEvidence(conversation)
    // Partial history without a provider listing cannot establish which jobs remain.
    if (evidence.historyIsCut && !evidence.readALevel) {
      return this.itsHistoryWasNotReadInFull(conversation, plan, lastKnown)
    }
    // Settle notices the provider already saw, then plan again without them.
    if (this.settleWhatItSaw(conversation, plan, now)) {
      plan = this.planItsSchedule(conversation, now)
      if (plan === null) return null
    }
    this.forgetJobsItsPlanNoLongerNames(conversation, plan, now)
    const owed = this.whatItsJobsAreOwed(conversation, plan, now)
    const itsPlan = plan
    const soonest = Math.min(
      owed.admission.startAt ?? Number.POSITIVE_INFINITY,
      ...owed.runs.map((run) => run.startAt),
    )
    return {
      plan,
      admission: owed.admission,
      runs: owed.runs,
      words: [...plan.notices.map((notice) => aWordOfThePlanners(itsPlan, notice)), ...owed.words],
      startAt: Number.isFinite(soonest) ? soonest : null,
      level: this.theLevelItPlans(conversation, plan, now, owed.itsRuns, owed.notStarted),
    }
  }

  itsHistoryWasNotReadInFull(
    conversation: string,
    plan: ReceiptSchedulePlan,
    lastKnown: ScheduleLevel | undefined,
  ): PlannedWake {
    const kept = this.ops.itsAttempts(conversation)
    const told = new Set(kept.told.map((one) => one.id))
    const jobs = (lastKnown?.jobs ?? []).map((job): ScheduledRow => {
      const untimed: ScheduledRow = { ...job, notStarted: 'history-not-read-in-full' }
      delete (untimed as { nominalAt?: number }).nominalAt
      return untimed
    })
    const words = jobs.flatMap((job): WordOwed[] => {
      const of = JSON.stringify(['listed', job.id, null])
      const id = JSON.stringify(['history-not-read-in-full', of])
      return told.has(id)
        ? []
        : [
            {
              id,
              of,
              job: job.id,
              reason: 'history-not-read-in-full',
              dueAt: null,
              ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
            },
          ]
    })
    if (lastKnown === undefined) {
      console.warn(
        `runtime host: ${conversation}'s history was read only in part and holds no level, and no ` +
          'level of it is known: nothing is planned for its jobs',
      )
    }
    return {
      plan,
      admission: { state: kept.attempts, requests: [], startAt: null },
      runs: [],
      words,
      startAt: null,
      level: { jobs, dropped: lastKnown?.dropped ?? 0 },
    }
  }

  whatItsJobsAreOwed(conversation: string, plan: ReceiptSchedulePlan, now: number): OwedToItsJobs {
    const evidence = this.ops.itsEvidence(conversation)
    // An in-flight start is planned against the record from before its reservation.
    const kept = this.ops.startReservedFor(conversation) ?? this.ops.itsAttempts(conversation)
    const calendar = this.ops.itsCalendar()
    const told = new Set(this.ops.itsAttempts(conversation).told.map((one) => one.id))
    const notStarted = new Map<string, NotStartedBecause>()
    const words: WordOwed[] = []
    const say = (reason: AWordOfThisApps, job: string, making: string, about: string): void => {
      const id = JSON.stringify([reason, making, about])
      if (!told.has(id)) words.push({ id, of: making, job, reason, dueAt: null })
    }
    const unheard = new Set<string>()
    for (const { job } of plan.wake.plans) {
      const made = plan.states.find(
        (one) => one.generation.generation === job.evidence?.generation,
      )?.generation
      if (made === undefined || evidence.heardOfSinceItsReset(made)) continue
      unheard.add(job.id)
      notStarted.set(job.id, 'no-word-since-a-reset')
      say('not-listed-since-a-reset', job.id, aJobsMaking(made), evidence.itsReset ?? 'reset')
    }
    const timed = itsRepeatingJobsOfKnownTime(plan).flatMap((one) => {
      if (unheard.has(one.job)) return []
      const next = one.state.nextNominalAt ?? theRunAfter(one.schedule, now, calendar)
      return next === undefined ? [] : [{ ...one, next }]
    })
    const runs = timed.flatMap(({ job, making, schedule, state, next }): RunOwed[] => {
      const { generation } = state
      const listed =
        generation.lastPresence?.kind === 'listing' && generation.presence === 'present'
          ? generation.lastPresence.observedAt
          : undefined
      const last = kept.runs[making]
      const owedFor = (runAt: number | undefined, unanswered: number): RunOwed[] =>
        runAt === undefined
          ? []
          : [{ job, making, runAt, startAt: Math.max(now, runAt - WAKE_LEAD_MS), unanswered }]
      if (last === undefined) return owedFor(next, 1)
      const runAt = last.runAt < next ? next : theRunAfter(schedule, last.runAt, calendar)
      if (listed !== undefined && listed >= last.startedAt) return owedFor(runAt, 1)
      const latest =
        eligibilityBounds(last.runAt, true, calendar.read(last.runAt)?.minute ?? 0)
          ?.latestEligibleAt ?? last.runAt
      if (
        evidence.wasRunningThrough(last.runAt, latest, now) ||
        last.unanswered >= STARTS_WITH_NO_WORD_OF_A_JOB
      ) {
        notStarted.set(job, 'no-word-from-its-provider')
        say('not-started', job, making, String(last.runAt))
        return []
      }
      return owedFor(runAt, last.unanswered + 1)
    })
    const admittedAt = kept.admittedAt
    const broughtBack = new Set(
      admittedAt === null
        ? []
        : plan.wake.plans.flatMap(({ job, result }) => {
            const listed = plan.states.find(
              (one) => one.generation.generation === job.evidence?.generation,
            )?.generation
            return result.kind === 'known' &&
              result.nominalAt > now &&
              listed?.lastPresence?.kind === 'listing' &&
              listed.presence === 'present' &&
              listed.lastPresence.observedAt >= admittedAt
              ? [JSON.stringify(['job', job.id])]
              : []
          }),
    )
    const lostItsMaking = new Set<string>()
    if (evidence.historyIsCut) {
      const made = new Set([
        ...[...Object.keys(kept.runs), ...kept.told.map((one) => one.of)].flatMap((making) => {
          const its = theJobOfAMaking(making)
          return its?.made === true ? [its.job] : []
        }),
        ...kept.attempts.flatMap((one) => {
          if (!one.attempted) return []
          try {
            const key: unknown = JSON.parse(one.key)
            return Array.isArray(key) && key[0] === 'job' && typeof key[1] === 'string'
              ? [key[1]]
              : []
          } catch {
            return []
          }
        }),
      ])
      for (const { job } of plan.wake.plans) {
        const known = plan.states.find(
          (one) => one.generation.generation === job.evidence?.generation,
        )?.generation
        if (known?.creation === undefined && made.has(job.id)) lostItsMaking.add(job.id)
      }
    }
    for (const job of lostItsMaking) {
      notStarted.set(job, 'history-not-read-in-full')
      say('history-not-read-in-full', job, JSON.stringify(['listed', job, null]), 'cut')
    }
    const each = new Set([...timed.map(({ job }) => job), ...unheard, ...lostItsMaking])
    const admission = planScheduleAdmission(
      { ...plan.wake, plans: plan.wake.plans.filter(({ job }) => !each.has(job.id)) },
      kept.attempts.filter((one) => !broughtBack.has(one.key)),
      {
        zone: calendar.identity,
        wakeLeadMs: WAKE_LEAD_MS,
        calendarIdentity: calendar.identity,
        calendarVersion: calendar.version,
        clockEra: THE_ONE_CLOCK_ERA,
      },
    )
    const asked = new Set(admission.requests.map((one) => one.key))
    for (const { job, result } of plan.wake.plans) {
      if (
        unheard.has(job.id) ||
        lostItsMaking.has(job.id) ||
        timed.some((one) => one.job === job.id)
      ) {
        continue
      }
      const made = plan.states.find(
        (one) => one.generation.generation === job.evidence?.generation,
      )?.generation
      if (made === undefined) continue
      const making = aJobsMaking(made)
      const isAsked = asked.has(JSON.stringify(['job', job.id]))
      if (result.kind !== 'known') {
        say('time-not-known', job.id, making, 'once')
        if (!isAsked) notStarted.set(job.id, 'time-not-known')
      } else if (!isAsked && result.nominalAt > now) {
        notStarted.set(job.id, 'no-word-from-its-provider')
        say('not-started', job.id, making, String(result.nominalAt))
      }
    }
    const itsRuns = new Map<string, number | undefined>()
    for (const job of unheard) itsRuns.set(job, undefined)
    for (const { job } of timed) itsRuns.set(job, undefined)
    for (const run of runs) itsRuns.set(run.job, run.runAt)
    return { admission, runs, itsRuns, notStarted, words }
  }

  forgetJobsItsPlanNoLongerNames(
    conversation: string,
    plan: ReceiptSchedulePlan,
    now: number,
  ): void {
    const kept = this.ops.keptAttemptsFor(conversation)
    if (kept === undefined) return
    // Partial history cannot prove a job is gone.
    if (this.ops.itsEvidence(conversation).historyIsCut) return
    const named = new Set(plan.states.map((one) => one.generation.jobId))
    const stillNamed = (making: string): boolean => named.has(theJobOfAMaking(making)?.job ?? '')
    const told = kept.told.filter((one) => stillNamed(one.of))
    const runs = Object.entries(kept.runs).filter(([making]) => stillNamed(making))
    if (told.length === kept.told.length && runs.length === Object.keys(kept.runs).length) return
    this.ops.keepItsAttempts(conversation, {
      ...kept,
      told,
      runs: Object.fromEntries(runs),
      at: now,
    })
  }
}
