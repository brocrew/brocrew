import { clockTimeFrom } from '../../../shared/clock'
import { sameLocalDay } from '../../../shared/local-time'
import {
  hasControlCharacter,
  hasReorderingCharacter,
  quotedLiteral,
  type ScheduledJob,
} from '../../../shared/runtime-ipc'

export type TimedScheduledJob = ScheduledJob

// Draft compact tag; complete reasons remain in the accessible name and popup.
export const SCHEDULE_NOT_STARTED_TAG = 'not started'

// Draft words for the app's conversation-start policy; the job itself stays listed.
export function scheduledNotStartedWords(
  job: TimedScheduledJob,
): { short: string; detail: string } | null {
  const continuation =
    'The job stays listed. A conversation that is open still runs its jobs. Writing to the conversation starts it.'
  const afterListing =
    'Automatic starts come back once its provider lists this job again, while the job is within its lifetime and the conversation is not archived.'
  switch (job.notStarted) {
    case 'time-not-known':
      return {
        short: 'Not started automatically: time unknown',
        detail: `${continuation} Ask the agent to cancel this job and schedule it again to restore automatic starts. The app cannot tell this job's run time, so it does not automatically start a stopped conversation for it.`,
      }
    case 'no-word-from-its-provider':
      return {
        short: 'No longer started automatically: no update',
        detail: `${continuation} ${afterListing} The app no longer starts the stopped conversation automatically for this job because its provider has not listed it since this app last started the conversation for it.`,
      }
    case 'no-word-since-a-reset':
      return {
        short: 'Not started automatically: no update since reset',
        detail: `${continuation} ${afterListing} The app does not start a stopped conversation automatically for this job because its provider has not listed it since the provider’s conversation was cleared or reset.`,
      }
    case 'history-not-read-in-full':
      return {
        short: 'Not started automatically: history incomplete',
        detail: `${continuation} ${afterListing} The app could not read enough of this conversation’s scheduling history to plan automatic starts. It keeps the last known job listed without a known run time.`,
      }
    default:
      return null
  }
}

export function scheduledTimeWords(job: TimedScheduledJob, now: number): string {
  return job.nominalAt === undefined ? '' : comingTimeWords(job.nominalAt, now)
}

/** A time still to come, as a job's line says it: "today at 12:17", or its date and time. */
export function comingTimeWords(at: number, now: number): string {
  if (at <= now) return ''
  const time = clockTimeFrom(at, now)
  return time === '' ? '' : sameLocalDay(at, now) ? `today at ${time}` : time
}

export function scheduledRecordedTimeWords(job: TimedScheduledJob, now: number): string {
  const at = job.nominalAt
  if (at === undefined) return ''
  const time = clockTimeFrom(at, now)
  if (time === '') return ''
  if (at <= now) return `Reported time: ${time}${at < now ? ' (passed)' : ''}`
  return scheduledTimeWords(job, now)
}

// Preserve decoded newlines and quotes. Other controls remain visible rather than changing the page.
export function scheduledPromptText(prompt: string | undefined): string | null {
  if (prompt === undefined) return null
  let shown = ''
  for (const char of prompt.replace(/\r\n/g, '\n')) {
    if (char === '\u2028' || char === '\u2029') {
      shown += `\\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`
      continue
    }
    shown +=
      char !== '\n' && char !== '\t' && (hasControlCharacter(char) || hasReorderingCharacter(char))
        ? quotedLiteral(char).slice(1, -1)
        : char
  }
  return shown
}

export function scheduledPromptPreview(prompt: string | undefined): string {
  const text = scheduledPromptText(prompt)
  if (text === null) return 'Prompt not supplied yet'
  if (text === '') return 'Empty prompt'
  if (text.trim() === '') return 'Whitespace-only prompt'
  const line = text.replace(/\s+/g, ' ').trim()
  const points = [...line]
  return points.length > 100 ? `${points.slice(0, 100).join('')}…` : line
}
