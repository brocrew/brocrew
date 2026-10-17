import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, reactive } from 'vue'
import AgentCard from '../../src/renderer/src/components/AgentCard.vue'
import { createTranscript } from '../../src/renderer/src/lib/transcript'
import { sessionPanel } from '../../src/renderer/src/lib/session-panel'
import ScheduleBar from '../../src/renderer/src/components/ScheduleBar.vue'
import { useModalDepth } from '../../src/renderer/src/components/OverlayHost.vue'
import { clockTimeFrom } from '../../src/shared/clock'
import { readLocalTimeFrom } from '../../src/shared/local-time'
import type { ScheduleRegistry } from '../../src/renderer/src/lib/transcript'
import type { TimedScheduledJob } from '../../src/renderer/src/lib/scheduled-job-details'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { assertDrawn, drawnReady, lineCount } from './drawn'
import { mount, unmountAll } from './harness'
import {
  SCHEDULE_NOW,
  SCHEDULE_PROMPT,
  scheduledJobSummaryFixture,
  scheduledJobStartReasonsFixture,
} from './scheduled-job-summary.fixture'

const originalViewport = { width: window.innerWidth, height: window.innerHeight }

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(SCHEDULE_NOW)
  readLocalTimeFrom(() => ({ before: 0, changes: [], rule: null }))
  useSpawnSafety().forget()
})

afterEach(async () => {
  unmountAll()
  vi.useRealTimers()
  readLocalTimeFrom(() => null)
  vi.restoreAllMocks()
  await page.viewport(originalViewport.width, originalViewport.height)
})

async function settled(): Promise<void> {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

const listing = (jobs: TimedScheduledJob[], dropped = 0): ScheduleRegistry => ({
  jobs,
  dropped,
  left: [],
})

function popup(cy: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-cy="${cy}"]`)
  expect(element, `missing popup element ${cy}`).not.toBeNull()
  return element!
}

describe('scheduled jobs open their full available prompt', () => {
  it.each([
    { viewportWidth: 1180, viewportHeight: 840, cardWidth: 320 },
    { viewportWidth: 1440, viewportHeight: 1000, cardWidth: 400 },
  ])(
    'the $cardWidth-pixel card opens a full-window popup at the supported $viewportWidth-pixel viewport',
    async ({ viewportWidth, viewportHeight, cardWidth }) => {
      await page.viewport(viewportWidth, viewportHeight)
      const m = mount(
        defineComponent({
          setup: () => () =>
            h(
              'div',
              { style: { containerType: 'inline-size', overflow: 'hidden', height: '200px' } },
              h(ScheduleBar, { registry: scheduledJobSummaryFixture() }),
            ),
        }),
        {},
        { width: cardWidth, height: 200 },
      )
      m.q('schedule-open-bakery').click()
      await settled()
      const overlay = popup('overlay-host')
      expect(m.host.contains(overlay)).toBe(false)
      const box = overlay.getBoundingClientRect()
      expect(box.left).toBe(0)
      expect(box.top).toBe(0)
      expect(box.width).toBeCloseTo(window.innerWidth, 0)
      expect(box.height).toBeCloseTo(window.innerHeight, 0)
      expect(popup('scheduled-job-prompt').textContent).toBe(SCHEDULE_PROMPT)
      const dialog = popup('scheduled-job-dialog').getBoundingClientRect()
      expect(dialog.left).toBeGreaterThanOrEqual(220)
      expect(dialog.right).toBeLessThanOrEqual(viewportWidth - 220)
      expect(dialog.height).toBeGreaterThan(0)
      expect(dialog.height).toBeLessThanOrEqual(viewportHeight)
    },
  )

  it.each([320, 400])(
    'the actual %i-pixel Agent panel keeps the complete first line, tag and distinguishing prompt on two lines',
    async (width) => {
      const state = createTranscript()
      state.schedule = scheduledJobStartReasonsFixture()
      const m = mount(
        defineComponent({
          setup: () => () =>
            h(
              'section',
              { style: 'width:100%;height:100%' },
              h(AgentCard, {
                state,
                panel: sessionPanel(state),
                canOpen: false,
                mode: 'normal',
                who: 'Bakery',
                tasks: [],
                agentState: { is: 'idle' },
              }),
            ),
        }),
        {},
        { width, height: 1000 },
      )
      await settled()
      const fold = m.q('schedule-fold')
      if (fold.getAttribute('aria-expanded') === 'false') fold.click()
      await drawnReady()
      for (const [id, prefix] of [
        ['listed-recipes', 'Read the fictional recipe'],
        ['unlisted-bakery', 'Check the fictional bakery'],
        ['reset-pantry', 'Check the fictional pantry'],
        ['history-bakery', 'Read the fictional bakery ledger'],
        ['ordinary', 'Check the fictional pantry'],
      ] as const) {
        const opener = m.q(`schedule-open-${id}`)
        const first = opener.querySelector<HTMLElement>('.sch-when')!
        const preview = m.q(`schedule-asks-${id}`)
        expect(preview.textContent?.startsWith(prefix), id).toBe(true)
        for (const part of Array.from(
          first.querySelectorAll<HTMLElement>('code, .sch-time, .sch-repeat'),
        )) {
          assertDrawn(part, `${id} first-line ${part.textContent}`, m.host)
          expect(lineCount(part), id).toBe(1)
          expect(part.getBoundingClientRect().bottom, id).toBeLessThan(
            preview.getBoundingClientRect().top,
          )
        }
        expect(lineCount(preview), id).toBe(1)
        expect(opener.getBoundingClientRect().height, id).toBeLessThan(42)
        // Check the distinguishing characters before the ellipsis, not only the whole element's box.
        const node = preview.firstChild!
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, prefix.length)
        const ink = range.getBoundingClientRect()
        const box = preview.getBoundingClientRect()
        expect(ink.left, id).toBeGreaterThanOrEqual(box.left - 0.5)
        expect(ink.right, id).toBeLessThanOrEqual(
          box.right - parseFloat(getComputedStyle(preview).fontSize),
        )
        expect(ink.top, id).toBeGreaterThanOrEqual(box.top - 0.5)
        expect(ink.bottom, id).toBeLessThanOrEqual(box.bottom + 0.5)
        if (id !== 'ordinary') {
          const tag = m.q(`schedule-not-started-${id}`)
          expect(tag.textContent).toBe('not started')
          expect(first.contains(tag)).toBe(true)
          expect(preview.contains(tag)).toBe(false)
          assertDrawn(tag, `${id} not-started tag`, m.host)
        } else expect(opener.querySelector('[data-cy^="schedule-not-started-"]')).toBeNull()
      }
      // With no host nominalAt, an expression stays verbatim; its date is never parsed into a time.
      expect(m.q('schedule-when-ordinary').textContent).toBe('45 12 8 10 *')
      expect(m.host.querySelector('[data-cy="schedule-next-ordinary"]')).toBeNull()
    },
  )

  it('three long jobs stay at two lines each; the popup preserves every available line and quote', async () => {
    const m = mount(
      ScheduleBar,
      { registry: scheduledJobSummaryFixture() },
      { width: 320, height: 800 },
    )
    await drawnReady()
    expect(m.q('schedule-head').textContent).toBe('3 jobs are scheduled')
    for (const id of ['bakery', 'recipes', 'new-job']) {
      const opener = m.q(`schedule-open-${id}`)
      expect(opener.getAttribute('aria-haspopup')).toBe('dialog')
      expect(lineCount(opener.querySelector<HTMLElement>('.sch-time, code')!)).toBe(1)
      expect(lineCount(m.q(`schedule-asks-${id}`))).toBe(1)
      expect(opener.getBoundingClientRect().height).toBeLessThan(42)
    }
    expect(document.querySelector('[data-cy="scheduled-job-dialog"]')).toBeNull()
    m.q('schedule-open-bakery').click()
    await settled()
    expect(
      page.getByRole('dialog', { name: 'Scheduled job' }).element().getAttribute('aria-modal'),
    ).toBe('true')
    expect(popup('scheduled-job-prompt').textContent).toBe(SCHEDULE_PROMPT)
    expect(getComputedStyle(popup('scheduled-job-prompt')).whiteSpace).toBe('pre-wrap')
    expect(popup('scheduled-job-expression').textContent).toBe('21 12 8 10 *')
    expect(popup('scheduled-job-copy-note').textContent).toContain(
      'may already have been shortened',
    )
    assertDrawn(popup('scheduled-job-prompt'), 'the available prompt', popup('overlay-host'))
  })

  it('Enter opens, Tab stays in the popup, Escape closes and returns focus to the same job', async () => {
    const m = mount(
      ScheduleBar,
      { registry: scheduledJobSummaryFixture() },
      { width: 400, height: 800 },
    )
    const opener = m.q('schedule-open-recipes')
    opener.focus()
    await userEvent.keyboard('{Enter}')
    await settled()
    const overlay = popup('overlay-host')
    expect(overlay.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Tab}')
    expect(overlay.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    await settled()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    opener.click()
    await settled()
    popup('close-scheduled-job').click()
    await settled()
    expect(document.activeElement).toBe(opener)
  })

  it('a newly made job without a prompt and an id-only job both open an honest empty reading', async () => {
    const m = mount(
      ScheduleBar,
      {
        registry: listing(
          [{ id: 'new', schedule: '45 12 8 10 *', recurring: false }, { id: 'bare' }],
          2,
        ),
      },
      { width: 400, height: 800 },
    )
    expect(m.q('schedule-head').textContent).toBe('4 jobs are scheduled')
    expect(m.q('schedule-dropped').textContent).toContain('2 of them are not listed')
    m.q('schedule-open-new').click()
    await settled()
    expect(popup('scheduled-job-missing-prompt').textContent).toContain('has not supplied')
    expect(document.querySelector('[data-cy="scheduled-job-prompt"]')).toBeNull()
    popup('close-scheduled-job').click()
    await settled()
    m.q('schedule-open-bare').click()
    await settled()
    expect(popup('scheduled-job-id').textContent?.trim()).toBe('bare')
    expect(popup('scheduled-job-missing-prompt').textContent).toContain('has not supplied')
  })

  it('time words require the host moment; tomorrow gets its day and a raw expression invents no time', async () => {
    const today = SCHEDULE_NOW + 21 * 60_000
    const tomorrow = today + 86_400_000
    const m = mount(
      ScheduleBar,
      {
        registry: listing([
          { id: 'today', nominalAt: today, recurring: false },
          { id: 'tomorrow', nominalAt: tomorrow, recurring: true },
          { id: 'unknown', schedule: '21 12 8 10 *' },
          { id: 'past', nominalAt: SCHEDULE_NOW - 60_000, schedule: '59 11 8 10 *' },
        ]),
      },
      { width: 400, height: 800 },
    )
    expect(m.q('schedule-next-today').textContent).toBe(
      `today at ${clockTimeFrom(today, SCHEDULE_NOW)}`,
    )
    expect(m.q('schedule-repeat-today').textContent).toBe('once')
    expect(m.q('schedule-next-tomorrow').textContent).toBe(clockTimeFrom(tomorrow, SCHEDULE_NOW))
    expect(m.q('schedule-repeat-tomorrow').textContent).toBe('repeats')
    for (const id of ['unknown', 'past'])
      expect(m.host.querySelector(`[data-cy="schedule-next-${id}"]`)).toBeNull()
    expect(m.q('schedule-when-unknown').textContent).toBe('21 12 8 10 *')
    expect(m.host.querySelector('[data-cy="schedule-repeat-unknown"]')).toBeNull()
    m.q('schedule-open-past').click()
    await settled()
    expect(popup('scheduled-job-time').textContent?.trim()).toBe(
      `Reported time: ${clockTimeFrom(SCHEDULE_NOW - 60_000, SCHEDULE_NOW)} (passed)`,
    )
    expect(popup('scheduled-job-expression').textContent).toBe('59 11 8 10 *')
  })

  it('jobs at the same time have distinct accessible names that include their visible previews', async () => {
    const at = SCHEDULE_NOW + 21 * 60_000
    const m = mount(
      ScheduleBar,
      {
        registry: listing([
          { id: 'recipes', nominalAt: at, recurring: false, prompt: 'Read the recipe list' },
          { id: 'oven', nominalAt: at, recurring: false, prompt: 'Check the oven' },
        ]),
      },
      { width: 320, height: 800 },
    )
    const first = `Open scheduled job: today at ${clockTimeFrom(at, SCHEDULE_NOW)} · once. Read the recipe list`
    const second = `Open scheduled job: today at ${clockTimeFrom(at, SCHEDULE_NOW)} · once. Check the oven`
    expect(page.getByRole('button', { name: first, exact: true }).element()).toBe(
      m.q('schedule-open-recipes'),
    )
    expect(page.getByRole('button', { name: second, exact: true }).element()).toBe(
      m.q('schedule-open-oven'),
    )
    expect(m.q('schedule-asks-recipes').textContent).toBe('Read the recipe list')
    expect(m.q('schedule-asks-oven').textContent).toBe('Check the oven')
    m.q('schedule-open-recipes').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe('Read the recipe list')
    popup('close-scheduled-job').click()
    await settled()
    m.q('schedule-open-oven').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe('Check the oven')
  })

  it('jobs with the same expression have distinct names and open their respective prompts', async () => {
    const expression = '*/5 * * * *'
    const m = mount(
      ScheduleBar,
      {
        registry: listing([
          { id: 'flour', schedule: expression, recurring: true, prompt: 'Check the flour' },
          { id: 'yeast', schedule: expression, recurring: true, prompt: 'Check the yeast' },
        ]),
      },
      { width: 320, height: 800 },
    )
    for (const [id, prompt] of [
      ['flour', 'Check the flour'],
      ['yeast', 'Check the yeast'],
    ] as const) {
      expect(
        page
          .getByRole('button', {
            name: `Open scheduled job: ${expression} · repeats. ${prompt}`,
            exact: true,
          })
          .element(),
      ).toBe(m.q(`schedule-open-${id}`))
      m.q(`schedule-open-${id}`).click()
      await settled()
      expect(popup('scheduled-job-prompt').textContent).toBe(prompt)
      popup('close-scheduled-job').click()
      await settled()
    }
  })

  it.each([
    {
      reason: 'time-not-known' as const,
      short: 'Not started automatically: time unknown',
      recovery:
        'Ask the agent to cancel this job and schedule it again to restore automatic starts.',
      explanation:
        "The app cannot tell this job's run time, so it does not automatically start a stopped conversation for it.",
    },
    {
      reason: 'no-word-from-its-provider' as const,
      short: 'No longer started automatically: no update',
      recovery:
        'Automatic starts come back once its provider lists this job again, while the job is within its lifetime and the conversation is not archived.',
      explanation:
        'The app no longer starts the stopped conversation automatically for this job because its provider has not listed it since this app last started the conversation for it.',
    },
    {
      reason: 'history-not-read-in-full' as const,
      short: 'Not started automatically: history incomplete',
      recovery:
        'Automatic starts come back once its provider lists this job again, while the job is within its lifetime and the conversation is not archived.',
      explanation:
        'The app could not read enough of this conversation’s scheduling history to plan automatic starts. It keeps the last known job listed without a known run time.',
    },
    {
      reason: 'no-word-since-a-reset' as const,
      short: 'Not started automatically: no update since reset',
      recovery:
        'Automatic starts come back once its provider lists this job again, while the job is within its lifetime and the conversation is not archived.',
      explanation:
        'The app does not start a stopped conversation automatically for this job because its provider has not listed it since the provider’s conversation was cleared or reset.',
    },
  ])(
    'the $reason fact marks only its listed job and explains the conversation-start policy',
    async ({ reason, short, recovery, explanation }) => {
      const prompt = 'Read the fictional recipe list.'
      const at = reason === 'no-word-since-a-reset' ? SCHEDULE_NOW + 5 * 60_000 : undefined
      const when = at === undefined ? '*/5 * * * *' : `today at ${clockTimeFrom(at, SCHEDULE_NOW)}`
      const m = mount(
        ScheduleBar,
        {
          registry: listing([
            {
              id: 'marked',
              schedule: '*/5 * * * *',
              recurring: true,
              prompt,
              notStarted: reason,
              nominalAt: at,
            },
            {
              id: 'ordinary',
              schedule: '*/5 * * * *',
              recurring: true,
              prompt: 'Check the pantry.',
            },
          ]),
        },
        { width: 320, height: 800 },
      )
      expect(m.q('schedule-head').textContent).toBe('2 jobs are scheduled')
      expect(m.q('schedule-not-started-marked').textContent).toBe('not started')
      expect(m.q('schedule-asks-marked').textContent).toBe(prompt)
      expect(m.q('schedule-asks-marked').title).toContain(explanation)
      const actions =
        'The job stays listed. A conversation that is open still runs its jobs. Writing to the conversation starts it.'
      expect(m.q('schedule-open-marked').getAttribute('aria-label')).toBe(
        `Open scheduled job: ${when} · repeats. ${short}. ${prompt} ${actions} ${recovery} ${explanation}`,
      )
      if (at !== undefined) expect(m.q('schedule-next-marked').textContent).toBe(when)
      expect(m.host.querySelector('[data-cy="schedule-not-started-ordinary"]')).toBeNull()
      expect(m.q('schedule-asks-ordinary').textContent).toBe('Check the pantry.')
      await drawnReady()
      expect(lineCount(m.q('schedule-asks-marked'))).toBe(1)
      expect(m.q('schedule-open-marked').getBoundingClientRect().height).toBeLessThan(42)
      m.q('schedule-open-marked').click()
      await settled()
      expect(popup('scheduled-job-not-started').textContent).toContain(explanation)
      expect(popup('scheduled-job-not-started').textContent).toBe(
        `${actions} ${recovery} ${explanation}`,
      )
      expect(popup('scheduled-job-not-started').textContent).not.toMatch(/after \d+ starts/)
      if (reason === 'time-not-known') {
        expect(popup('scheduled-job-not-started').textContent).not.toContain(
          'once its provider lists',
        )
      } else {
        expect(popup('scheduled-job-not-started').textContent).not.toContain('cancel this job')
      }
      expect(popup('scheduled-job-prompt').textContent).toBe(prompt)
      expect(popup('scheduled-job-expression').textContent).toBe('*/5 * * * *')
      if (at !== undefined)
        expect(popup('scheduled-job-time').textContent?.trim()).toBe(`${when} · repeats`)
      expect(popup('scheduled-job-dialog').querySelectorAll('button')).toHaveLength(1)
    },
  )

  it('a host change or clear of the optional start reason keeps the listed job and its opened prompt', async () => {
    const job = reactive<{
      id: string
      prompt: string
      notStarted?: TimedScheduledJob['notStarted']
    }>({
      id: 'retained',
      prompt: 'Read the recipe list.',
      notStarted: 'time-not-known',
    })
    const state = reactive({ registry: listing([job]) })
    const m = mount(
      defineComponent({ setup: () => () => h(ScheduleBar, { registry: state.registry }) }),
      {},
      { width: 400, height: 800 },
    )
    m.q('schedule-open-retained').click()
    await settled()
    const overlay = popup('overlay-host')
    job.notStarted = 'no-word-from-its-provider'
    await settled()
    expect(m.q('schedule-not-started-retained').textContent).toBe('not started')
    expect(m.q('schedule-open-retained').getAttribute('aria-label')).toContain(
      'No longer started automatically: no update',
    )
    expect(popup('scheduled-job-not-started').textContent).toContain(
      'since this app last started the conversation for it',
    )
    job.notStarted = 'no-word-since-a-reset'
    await settled()
    expect(m.q('schedule-not-started-retained').textContent).toBe('not started')
    expect(m.q('schedule-open-retained').getAttribute('aria-label')).toContain(
      'Not started automatically: no update since reset',
    )
    expect(popup('overlay-host')).toBe(overlay)
    expect(popup('scheduled-job-not-started').textContent).toContain(
      'since the provider’s conversation was cleared or reset',
    )
    expect(popup('scheduled-job-not-started').textContent).toContain(
      'once its provider lists this job again',
    )
    job.notStarted = 'history-not-read-in-full'
    await settled()
    expect(m.q('schedule-not-started-retained').textContent).toBe('not started')
    expect(m.q('schedule-open-retained').getAttribute('aria-label')).toContain(
      'Not started automatically: history incomplete',
    )
    expect(popup('overlay-host')).toBe(overlay)
    expect(popup('scheduled-job-not-started').textContent).toContain('without a known run time')
    delete job.notStarted
    await settled()
    expect(m.host.querySelector('[data-cy="schedule-not-started-retained"]')).toBeNull()
    expect(document.querySelector('[data-cy="scheduled-job-not-started"]')).toBeNull()
    expect(m.q('schedule-asks-retained').textContent).toBe('Read the recipe list.')
    expect(m.q('schedule-open-retained').getAttribute('aria-label')).toBe(
      'Open scheduled job: Scheduled job. Read the recipe list.',
    )
    expect(m.q('schedule-head').textContent).toBe('1 job is scheduled')
    expect(popup('overlay-host')).toBe(overlay)
    expect(popup('scheduled-job-prompt').textContent).toBe('Read the recipe list.')
  })

  it('a new provider copy with the unknown-time reason still needs cancellation and scheduling again', async () => {
    const state = reactive({
      registry: listing([
        {
          id: 'unknown',
          schedule: '*/5 * * * *',
          prompt: 'First provider copy',
          notStarted: 'time-not-known',
        },
      ]),
    })
    const m = mount(
      defineComponent({ setup: () => () => h(ScheduleBar, { registry: state.registry }) }),
      {},
      { width: 400, height: 800 },
    )
    m.q('schedule-open-unknown').click()
    await settled()
    const overlay = popup('overlay-host')
    state.registry.jobs.splice(0, 1, {
      id: 'unknown',
      schedule: '*/5 * * * *',
      prompt: 'New provider copy',
      notStarted: 'time-not-known',
    })
    await settled()
    expect(m.q('schedule-not-started-unknown').textContent).toBe('not started')
    expect(m.q('schedule-open-unknown').getAttribute('aria-label')).toContain(
      'Not started automatically: time unknown',
    )
    expect(popup('overlay-host')).toBe(overlay)
    expect(popup('scheduled-job-prompt').textContent).toBe('New provider copy')
    expect(popup('scheduled-job-not-started').textContent).toContain(
      'cancel this job and schedule it again',
    )
    expect(popup('scheduled-job-not-started').textContent).not.toContain('once its provider lists')
  })

  it('supplied empty, whitespace and control-only prompts are distinct from an absent field', async () => {
    const cases = [
      {
        id: 'empty',
        prompt: '',
        shown: '',
        preview: 'Empty prompt',
        annotation: 'The supplied prompt is empty.',
      },
      {
        id: 'spaces',
        prompt: '  \n\t',
        shown: '  \n\t',
        preview: 'Whitespace-only prompt',
        annotation: 'The supplied prompt contains only whitespace.',
      },
      { id: 'cr', prompt: '\r', shown: '\\r', preview: '\\r', annotation: null },
      { id: 'separator', prompt: '\u2028', shown: '\\u2028', preview: '\\u2028', annotation: null },
      { id: 'control', prompt: '\u000b', shown: '\\u000b', preview: '\\u000b', annotation: null },
    ]
    const m = mount(
      ScheduleBar,
      { registry: listing([...cases, { id: 'absent' }]) },
      { width: 400, height: 800 },
    )
    for (const one of cases) {
      expect(m.q(`schedule-asks-${one.id}`).textContent).toBe(one.preview)
      m.q(`schedule-open-${one.id}`).click()
      await settled()
      expect(popup('scheduled-job-prompt').textContent).toBe(one.shown)
      expect(document.querySelector('[data-cy="scheduled-job-missing-prompt"]')).toBeNull()
      if (one.annotation === null)
        expect(document.querySelector('[data-cy="scheduled-job-blank-prompt"]')).toBeNull()
      else expect(popup('scheduled-job-blank-prompt').textContent?.trim()).toBe(one.annotation)
      popup('close-scheduled-job').click()
      await settled()
    }
    m.q('schedule-open-absent').click()
    await settled()
    expect(popup('scheduled-job-missing-prompt').textContent).toContain('has not supplied')
    expect(document.querySelector('[data-cy="scheduled-job-prompt"]')).toBeNull()
  })

  it('an oversized available copy has no obsolete preview count and opens to the actual full copy', async () => {
    const prompt = 'x'.repeat(1_200)
    const m = mount(
      ScheduleBar,
      { registry: listing([{ id: 'large', prompt }]) },
      { width: 320, height: 800 },
    )
    expect(m.q('schedule-asks-large').textContent).toBe(`${'x'.repeat(100)}…`)
    expect(m.host.querySelector('[data-cy="schedule-asks-cut-large"]')).toBeNull()
    m.q('schedule-open-large').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe(prompt)
    expect(popup('scheduled-job-long-copy').textContent).toContain('shown here in full')
    popup('close-scheduled-job').click()
    await settled()
    m.unmount()
    const normal = mount(
      ScheduleBar,
      { registry: listing([{ id: 'normal', prompt: 'Read the recipe list' }]) },
      { width: 320, height: 800 },
    )
    normal.q('schedule-open-normal').click()
    await settled()
    expect(document.querySelector('[data-cy="scheduled-job-long-copy"]')).toBeNull()
    expect(popup('scheduled-job-prompt').textContent).toBe('Read the recipe list')
  })

  it('literal backslash-n stays literal, real newlines stay real, and direction controls remain visible', async () => {
    const prompt = 'Literal \\n and "quotes".\nActual line\tindent\u202eend'
    const m = mount(
      ScheduleBar,
      { registry: listing([{ id: 'safe', prompt }]) },
      { width: 400, height: 800 },
    )
    m.q('schedule-open-safe').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe(
      'Literal \\n and "quotes".\nActual line\tindent\\u202eend',
    )
    expect(popup('scheduled-job-prompt').textContent).not.toContain('\u202e')
  })

  it('a provider-shortened copy keeps its marker in the popup and claims no missing text was recovered', async () => {
    const prompt = `${'Recipe '.repeat(100)}… [+400 chars]`
    const m = mount(
      ScheduleBar,
      { registry: listing([{ id: 'cut', prompt }]) },
      { width: 400, height: 800 },
    )
    m.q('schedule-open-cut').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe(prompt)
    expect(popup('scheduled-job-copy-note').textContent).toContain(
      'may already have been shortened',
    )
  })

  it('switching listings closes the old popup; the replacement still opens its own full prompt', async () => {
    const state = reactive({ registry: listing([{ id: 'same', prompt: 'First conversation' }]) })
    const m = mount(
      defineComponent({ setup: () => () => h(ScheduleBar, { registry: state.registry }) }),
      {},
      { width: 400, height: 800 },
    )
    m.q('schedule-open-same').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe('First conversation')
    state.registry = listing([{ id: 'same', prompt: 'Second conversation' }])
    await settled()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    m.q('schedule-open-same').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe('Second conversation')
  })

  it('a deleted job and an empty level stay closed when the same ids return until another press', async () => {
    const depth = useModalDepth()
    const before = depth.value
    const state = reactive({
      registry: listing([
        { id: 'first', prompt: 'First job' },
        { id: 'second', prompt: 'Second job' },
      ]),
    })
    const m = mount(
      defineComponent({ setup: () => () => h(ScheduleBar, { registry: state.registry }) }),
      {},
      { width: 400, height: 800 },
    )
    m.q('schedule-open-first').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe('First job')
    expect(depth.value).toBe(before + 1)
    state.registry.jobs.splice(0, 1)
    await settled()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    expect(depth.value).toBe(before)
    expect(m.q('schedule-head').textContent).toBe('1 job is scheduled')
    const remaining = m.q('schedule-open-second')
    remaining.focus()
    state.registry.jobs.push({ id: 'first', prompt: 'Returned first job' })
    await settled()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    expect(depth.value).toBe(before)
    expect(document.activeElement).toBe(remaining)
    expect(m.q('schedule-head').textContent).toBe('2 jobs are scheduled')
    m.q('schedule-open-second').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe('Second job')
    state.registry.jobs.splice(0)
    await settled()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    expect(depth.value).toBe(before)
    expect(m.host.querySelector('[data-cy="schedule-bar"]')).toBeNull()
    state.registry.jobs.push({ id: 'second', prompt: 'Returned second job' })
    await settled()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    expect(depth.value).toBe(before)
    const returned = m.q('schedule-open-second')
    returned.focus()
    expect(document.activeElement).toBe(returned)
    returned.click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe('Returned second job')
    expect(depth.value).toBe(before + 1)
  })

  it('an update to a retained selected job keeps the popup open with its current prompt', async () => {
    const job = reactive({ id: 'retained', prompt: 'First copy' })
    const state = reactive({ registry: listing([job]) })
    const m = mount(
      defineComponent({ setup: () => () => h(ScheduleBar, { registry: state.registry }) }),
      {},
      { width: 400, height: 800 },
    )
    m.q('schedule-open-retained').click()
    await settled()
    const overlay = popup('overlay-host')
    job.prompt = 'Updated copy'
    await settled()
    expect(popup('overlay-host')).toBe(overlay)
    expect(popup('scheduled-job-prompt').textContent).toBe('Updated copy')
    state.registry.jobs.splice(0, 1, { id: 'retained', prompt: 'Replacement copy' })
    await settled()
    expect(popup('overlay-host')).toBe(overlay)
    expect(popup('scheduled-job-prompt').textContent).toBe('Replacement copy')
  })

  it('a folded block closes its popup and unmount removes the popup layer', async () => {
    const m = mount(
      ScheduleBar,
      { registry: scheduledJobSummaryFixture(), fold: 'scheduled-popup-fold-control' },
      { width: 400, height: 800 },
    )
    // The block starts folded: it is opened, and drawn open, before a job is pressed.
    if (m.q('schedule-fold').getAttribute('aria-expanded') === 'false') m.q('schedule-fold').click()
    await settled()
    m.q('schedule-open-bakery').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe(SCHEDULE_PROMPT)
    m.q('schedule-fold').click()
    await settled()
    expect(m.q('schedule-fold').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    m.q('schedule-fold').click()
    await settled()
    m.q('schedule-open-bakery').click()
    await settled()
    expect(popup('scheduled-job-prompt').textContent).toBe(SCHEDULE_PROMPT)
    m.unmount()
    await settled()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
  })

  it('the minute rollover retracts the next-time wording, retains the reported moment and stops its clock on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const before = vi.getTimerCount()
    const at = SCHEDULE_NOW + 60_000
    const m = mount(
      ScheduleBar,
      {
        registry: listing([
          { id: 'clock', nominalAt: at, schedule: '1 12 8 10 *', prompt: 'Check the clock' },
        ]),
      },
      { width: 400, height: 800 },
    )
    expect(m.q('schedule-next-clock').textContent).toBe(
      `today at ${clockTimeFrom(at, SCHEDULE_NOW)}`,
    )
    m.q('schedule-open-clock').click()
    await nextTick()
    await nextTick()
    vi.mocked(Date.now).mockReturnValue(SCHEDULE_NOW + 120_000)
    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(m.host.querySelector('[data-cy="schedule-next-clock"]')).toBeNull()
    expect(m.q('schedule-when-clock').textContent).toBe('1 12 8 10 *')
    expect(popup('scheduled-job-time').textContent?.trim()).toBe(
      `Reported time: ${clockTimeFrom(at, SCHEDULE_NOW + 120_000)} (passed)`,
    )
    m.unmount()
    expect(document.querySelector('[data-cy="overlay-host"]')).toBeNull()
    expect(vi.getTimerCount()).toBe(before)
  })
})
