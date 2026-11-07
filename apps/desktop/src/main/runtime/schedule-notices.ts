import type { NotStartedBecause } from '@brobot2/runtime'
import type { ScheduleLevel } from '../../shared/agent-state-contracts'
import { clockTimeFrom } from '../../shared/clock'
import type { ReceiptSchedulePlan, ScheduleNotice } from '../../shared/schedule-receipts'
import type { ToldNotice } from '../schedule-attempts-file'
import { aJobsMaking } from './schedule-evidence'

/**
 * ⚑ **D-029 · how much of a job's own words its conversation is told back**, in code points — the
 * first line of what it would have asked ({@link scheduleNoticesText}).
 */
const MISSED_JOB_WORDS = 80

/**
 * What this app itself has to tell a conversation about a job, beside the planner's notices: that
 * it cannot tell the job's time (`time-not-known`), that it has stopped starting the conversation
 * for the job (`not-started`), that the job has not been listed since its provider's
 * conversation was reset (`not-listed-since-a-reset`), or that it could not read enough of the
 * conversation's history to plan the job (`history-not-read-in-full`).
 */
export type AWordOfThisApps =
  'time-not-known' | 'not-started' | 'not-listed-since-a-reset' | 'history-not-read-in-full'

/** One notice about a job, with what the job was last listed as asking. */
export interface NoticeAboutAJob {
  readonly reason: ScheduleNotice['reason'] | AWordOfThisApps
  /** The minute the notice is about, or `null` where there is none to name. */
  readonly dueAt: number | null
  readonly prompt?: string
}

/** What each kind of notice says after the jobs it names: one job's words, then several jobs'. */
const NOTICE_SAYS: Readonly<Record<NoticeAboutAJob['reason'], readonly [string, string]>> = {
  'offline-time-passed': [
    'was due while this conversation was stopped. This app cannot tell whether it ran: check whether its work is still needed.',
    'were due while this conversation was stopped. This app cannot tell whether they ran: check whether their work is still needed.',
  ],
  'recurring-offline-interval': [
    'may have missed one or more runs while this conversation was stopped: check whether that work is still needed.',
    'may have missed one or more runs while this conversation was stopped: check whether that work is still needed.',
  ],
  'not-present': [
    'is no longer on your schedule. This app cannot tell whether it ran or was cancelled.',
    'are no longer on your schedule. This app cannot tell whether they ran or were cancelled.',
  ],
  'expired-on-resume': [
    'is older than the seven days a repeating job lasts, so it may no longer run: schedule it again if it is still needed.',
    'are older than the seven days a repeating job lasts, so they may no longer run: schedule them again if they are still needed.',
  ],
  'compaction-confirmed': [
    'was not brought back when this conversation started again: schedule it again if it is still needed.',
    'were not brought back when this conversation started again: schedule them again if they are still needed.',
  ],
  'time-not-known': [
    'runs at a time this app cannot tell, so once this conversation stops this app will not start it for that job. If you still need it then, cancel it and schedule it again.',
    'run at times this app cannot tell, so once this conversation stops this app will not start it for those jobs. If you still need them then, cancel them and schedule them again.',
  ],
  'not-started': [
    'has not shown on your schedule since this app last started, or tried to start, this conversation for it, so this app has stopped starting the conversation for that job. If you still need it, list your scheduled jobs, cancel it if it is still there, and schedule it again.',
    'have not shown on your schedule since this app last started, or tried to start, this conversation for them, so this app has stopped starting the conversation for those jobs. If you still need them, list your scheduled jobs, cancel those still there, and schedule them again.',
  ],
  'not-listed-since-a-reset': [
    'has not shown on your schedule since this conversation was cleared or reset, so this app is not starting the conversation for that job. It will again once the job shows on your schedule. If the job is gone and you still need it, schedule it again.',
    'have not shown on your schedule since this conversation was cleared or reset, so this app is not starting the conversation for those jobs. It will again once they show on your schedule. If they are gone and you still need them, schedule them again.',
  ],
  'history-not-read-in-full': [
    'is one this app is not starting this conversation for: it could not read enough of this conversation’s history to plan it. It will again once the job shows on your schedule.',
    'are ones this app is not starting this conversation for: it could not read enough of this conversation’s history to plan them. It will again once they show on your schedule.',
  ],
}

/**
 * 🔴 **What a conversation is told of its scheduled jobs when this app starts it** — a plain
 * sentence for each kind of notice, each job by the minute the notice is about and the first line
 * of what it would have asked; ⛔ no id. The time carries its day when that day is not today
 * ({@link clockTimeFrom}).
 *
 * ⛔ **It says only what is known**: that a job's time passed while nothing could run it, that it
 * is no longer listed, or that this app does not start the conversation for it. ⚠️ Never that a
 * job did not run: nothing public says which turn a job began.
 */
export function scheduleNoticesText(notices: readonly NoticeAboutAJob[], now: number): string {
  const said: string[] = []
  for (const reason of Object.keys(NOTICE_SAYS) as NoticeAboutAJob['reason'][]) {
    const about = notices.filter((one) => one.reason === reason)
    if (about.length === 0) continue
    const [one, several] = NOTICE_SAYS[reason]
    said.push(`${yourJobs(about, now)} ${about.length === 1 ? one : several}`)
  }
  return said.join(' ')
}

/** ⚑ {@link scheduleNoticesText}'s subject: *Your scheduled job for 12:51 (“check the deploy”)*. */
function yourJobs(missed: readonly NoticeAboutAJob[], now: number): string {
  const named = missed.flatMap(({ prompt, dueAt }) => {
    const when = dueAt === null ? '' : clockTimeFrom(dueAt, now)
    const line = (prompt ?? '').split(/\r\n|\r|\n/)[0]?.trim() ?? ''
    const points = [...line]
    const asked =
      points.length > MISSED_JOB_WORDS ? `${points.slice(0, MISSED_JOB_WORDS).join('')}…` : line
    const name = [when === '' ? '' : `for ${when}`, asked === '' ? '' : `(“${asked}”)`]
      .filter((part) => part !== '')
      .join(' ')
    return name === '' ? [] : [name]
  })
  const last = named.pop()
  const all =
    last === undefined ? '' : named.length === 0 ? last : `${named.join(', ')} and ${last}`
  const subject = missed.length === 1 ? 'Your scheduled job' : 'Your scheduled jobs'
  return all === '' ? subject : `${subject} ${all}`
}

/** A word owed to a conversation about one of its jobs: a notice of the planner's, or this app's own. */
export interface WordOwed {
  readonly id: string
  /** The job's making ({@link aJobsMaking}); the planner's own name where the plan names no job. */
  readonly of: string
  /** The job's id, where the plan names it: what it asked is looked up by it. */
  readonly job: string | undefined
  readonly reason: NoticeAboutAJob['reason']
  readonly dueAt: number | null
  /** What the job asked, where it is known other than from its evidence. */
  readonly prompt?: string
}

/** One of the planner's notices, as a word owed to the conversation. */
export function aWordOfThePlanners(plan: ReceiptSchedulePlan, notice: ScheduleNotice): WordOwed {
  const made = plan.states.find(
    (one) => one.generation.generation === notice.generation,
  )?.generation
  return {
    id: notice.id,
    of: made === undefined ? notice.generation : aJobsMaking(made),
    job: made?.jobId,
    reason: notice.reason,
    dueAt: notice.dueAt,
  }
}

/** A word as kept once dealt with: told at a start (`said`), or settled with no word. */
export const dealtWith = (word: WordOwed, said: boolean): ToldNotice => ({
  id: word.id,
  of: word.of,
  said,
})

/** What a level says this app does not start its conversation for, by job id. */
export function whatItSaysIsNotStarted(level: ScheduleLevel): Record<string, NotStartedBecause> {
  const said: Record<string, NotStartedBecause> = {}
  for (const job of level.jobs) if (job.notStarted !== undefined) said[job.id] = job.notStarted
  return said
}

export const theSameIsSaid = (
  one: Readonly<Record<string, NotStartedBecause>>,
  other: Readonly<Record<string, NotStartedBecause>>,
): boolean =>
  Object.keys(one).length === Object.keys(other).length &&
  Object.entries(one).every(([job, why]) => other[job] === why)
