import type { TimedScheduledJob } from '../../src/renderer/src/lib/scheduled-job-details'
import type { ScheduleRegistry } from '../../src/renderer/src/lib/transcript'

export const SCHEDULE_NOW = Date.UTC(2026, 9, 8, 12, 0)
export const SCHEDULE_PROMPT =
  'Check the fictional bakery’s build.\nReport "ready" when the checks pass.\n' +
  'Keep the recipe notes intact and report the last failed check. '.repeat(10) +
  '\nThe final sentence must remain available.'

export function scheduledJobSummaryFixture(): ScheduleRegistry {
  const jobs: TimedScheduledJob[] = [
    {
      id: 'bakery',
      schedule: '21 12 8 10 *',
      recurring: false,
      nominalAt: SCHEDULE_NOW + 21 * 60_000,
      prompt: SCHEDULE_PROMPT,
    },
    {
      id: 'recipes',
      schedule: '*/5 * * * *',
      recurring: true,
      prompt:
        'Check the fictional recipe list.\nReport missing ingredients without changing the list.',
    },
    { id: 'new-job', schedule: '45 12 8 10 *', recurring: false },
  ]
  return { jobs, dropped: 0, left: [] }
}

export function scheduledJobStartReasonsFixture(): ScheduleRegistry {
  const jobs: TimedScheduledJob[] = [
    {
      id: 'listed-recipes',
      schedule: '*/5 * * * *',
      recurring: true,
      prompt: 'Read the fictional recipe list.',
      notStarted: 'time-not-known',
    },
    {
      id: 'unlisted-bakery',
      schedule: '21 12 8 10 *',
      recurring: false,
      nominalAt: SCHEDULE_NOW + 21 * 60_000,
      prompt: SCHEDULE_PROMPT,
      notStarted: 'no-word-from-its-provider',
    },
    {
      id: 'reset-pantry',
      schedule: '*/5 * * * *',
      recurring: true,
      nominalAt: SCHEDULE_NOW + 5 * 60_000,
      prompt: 'Check the fictional pantry.',
      notStarted: 'no-word-since-a-reset',
    },
    {
      id: 'history-bakery',
      schedule: '*/10 * * * *',
      recurring: true,
      prompt: 'Read the fictional bakery ledger.',
      notStarted: 'history-not-read-in-full',
    },
    {
      id: 'ordinary',
      schedule: '45 12 8 10 *',
      recurring: false,
      prompt: 'Check the fictional pantry.',
    },
  ]
  return { jobs, dropped: 0, left: [] }
}
