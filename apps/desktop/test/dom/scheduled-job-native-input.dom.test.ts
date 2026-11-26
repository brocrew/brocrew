import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ScheduleBar from '../../src/renderer/src/components/ScheduleBar.vue'
import { mount, unmountAll } from './harness'
import { SCHEDULE_NOW, scheduledJobSummaryFixture } from './scheduled-job-summary.fixture'
import { scheduledTimeWords } from '../../src/renderer/src/lib/scheduled-job-details'

afterEach(unmountAll)

describe('scheduled jobs use their shared input in the existing viewer', () => {
  it.each([undefined, '', 'Read every fictional recipe.\nKeep the final sentence.'])(
    'keeps the same input in the row and popup: %s',
    async (input) => {
      const registry = scheduledJobSummaryFixture()
      registry.jobs = [
        { ...registry.jobs[0]!, run: { kind: 'job', ...(input === undefined ? {} : { input }) } },
      ]
      const job = registry.jobs[0]!
      const expected = input ?? job.prompt!
      const m = mount(ScheduleBar, { registry })
      expect(m.q('schedule-asks-bakery').textContent).toContain(
        expected === '' ? 'Empty prompt' : expected.replace(/\s+/g, ' ').trim().slice(0, 50),
      )
      m.q('schedule-open-bakery').click()
      await nextTick()
      expect(document.querySelectorAll('[data-cy="scheduled-job-dialog"]')).toHaveLength(1)
      expect(document.querySelector('[data-cy="scheduled-job-prompt"]')?.textContent).toBe(expected)
      expect(job.nominalAt).toBe(SCHEDULE_NOW + 21 * 60_000)
      expect(scheduledTimeWords(job, SCHEDULE_NOW)).not.toBe('')
    },
  )
})
