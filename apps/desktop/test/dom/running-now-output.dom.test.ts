import { mapWorkflowEvents } from '../panel-run.fixture'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import RunningNowCard from '../../src/renderer/src/components/RunningNowCard.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { META, mount, paneProps, record, unmountAll } from './harness'
import { applyTheme, THEME_STYLE_ID } from '../../src/renderer/src/lib/apply-theme'
import { wearTheme } from '../../look/fixtures/themes'
import { drawnReady } from './drawn'

afterEach(unmountAll)
const tick = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await nextTick()
}

it('uses the short missing-output line for an agent reader miss', async () => {
  const m = mount(
    ConversationPane,
    paneProps({
      record: record([
        { type: 'sub_agent', agentId: 'map-reader', phase: 'started', title: 'Read the map' },
      ]),
      drawerOpen: true,
      onReadChildWork: async () => ({ ok: false, reason: 'gone' }),
    }),
    { width: 1400, height: 900 },
  )
  m.q('panel-row').click()
  await tick()
  expect(m.host.textContent).toContain('Output not available')
  expect(m.all('child-work-viewer')).toHaveLength(0)
})

it('opens the same workflow and input from the conversation and panel without reading its output file', async () => {
  const read = vi.fn(async () => ({ ok: false as const, reason: 'gone' as const }))
  const events = mapWorkflowEvents()
  const last = events.at(-1)!
  if (last.type !== 'workflow_run') throw new Error('Missing workflow fixture')
  const workflow = {
    ...last,
    run: {
      kind: 'workflow' as const,
      input: 'Review the map for three walkers.',
      progress: 'Checking the footpath',
    },
  }
  const session = ref(record([...events.slice(0, -1), workflow]))
  const Host = defineComponent({
    setup: () => () =>
      h(
        ConversationPane,
        paneProps({ record: session.value, drawerOpen: true, onReadWorkflowOutput: read }),
      ),
  })
  const m = mount(Host, {}, { width: 1400, height: 900 })
  expect(m.all('workflow-entry')).toHaveLength(1)
  m.q('workflow-head').click()
  await tick()
  expect(m.q('run-input').textContent).toContain('Review the map for three walkers.')
  m.q('panel-row').click()
  await tick()
  expect(m.all('workflow-entry')).toHaveLength(2)
  expect(m.all('run-input')).toHaveLength(2)
  expect(m.all('run-state')).toHaveLength(2)
  for (const state of m.all('run-state'))
    expect(state.textContent).toContain('Checking the footpath')
  for (const input of m.all('run-input'))
    expect(input.textContent).toContain('Review the map for three walkers.')
  expect(read).not.toHaveBeenCalled()
  expect(m.all('workflow-output-viewer')).toHaveLength(0)
  m.q('close-overlay').click()
  await tick()
  applyEvent(session.value.transcript, {
    ...workflow,
    outcome: 'completed',
    run: { kind: 'workflow', result: 'Map review complete' },
  })
  await tick()
  expect(m.q('running-now-rows').querySelectorAll('[data-cy=panel-row]')).toHaveLength(0)
  m.q('past-runs-open').click()
  await tick()
  expect(m.q('past-runs-dialog').textContent).toContain('Map review complete')
  m.q('panel-row').click()
  await tick()
  expect(m.all('workflow-entry')).toHaveLength(2)
  for (const state of m.all('run-state')) {
    expect(state.textContent).toContain('Map review complete')
    expect(state.textContent).not.toContain('Checking the footpath')
  }
  for (const input of m.all('run-input'))
    expect(input.textContent).toContain('Review the map for three walkers.')
  expect(read).not.toHaveBeenCalled()
})

function workflowCall(canRead: boolean, linked: boolean) {
  const events = mapWorkflowEvents()
  const last = events.at(-1)!
  if (last.type !== 'workflow_run') throw new Error('Missing workflow fixture')
  const workflow = {
    ...last,
    run: { kind: 'workflow' as const, input: 'Review the map for three walkers.' },
  }
  const r = record([
    events[0]!,
    { type: 'tool_result', id: 'workflow-call', ok: true, summary: 'Workflow started.' },
    ...(linked ? [workflow] : []),
  ])
  if (canRead) r.meta = { ...META, liveness: { ...META.liveness, canReadToolAnswer: true } }
  return { session: ref(r), workflow }
}

function mountCall(
  session: ReturnType<typeof workflowCall>['session'],
  onReadToolAnswer?: () => Promise<null>,
) {
  const Host = defineComponent({
    setup: () => () =>
      h(ConversationPane, paneProps({ record: session.value, drawerOpen: true, onReadToolAnswer })),
  })
  const m = mount(Host, {}, { width: 1400, height: 900 })
  const door = (): HTMLElement => m.host.querySelector<HTMLElement>('[data-cy^=tool-answer-open-]')!
  async function opensTheWorkflowSheet(open: () => void | Promise<void>): Promise<void> {
    await open()
    await tick()
    const sheet = m.q('close-overlay').closest('.sheet-shell')!
    expect(sheet.textContent).toContain('Workflow')
    expect(sheet.querySelectorAll('[data-cy=workflow-entry]')).toHaveLength(1)
    expect(sheet.querySelector('[data-cy=run-input]')?.textContent).toContain(
      'Review the map for three walkers.',
    )
    expect(m.all('tool-answer-viewer')).toHaveLength(0)
    m.q('close-overlay').click()
    await tick()
  }
  return { m, door, opensTheWorkflowSheet }
}

it('opens a workflow call from the conversation into the one workflow view Running now and Past runs open', async () => {
  const { session, workflow } = workflowCall(true, false)
  let answered: (value: null) => void = () => {}
  const readAnswer = vi.fn(() => new Promise<null>((resolve) => (answered = resolve)))
  const { m, door, opensTheWorkflowSheet } = mountCall(session, readAnswer)
  await tick()
  // Before its run links, the call is an ordinary tool call in a run of calls; a run that links
  // while its answer is read still opens as the workflow.
  m.q('tool-run-toggle').click()
  await tick()
  expect(door().textContent?.trim()).toBe('Show the whole answer')
  await opensTheWorkflowSheet(async () => {
    door().click()
    await tick()
    expect(readAnswer).toHaveBeenCalledTimes(1)
    applyEvent(session.value.transcript, workflow)
    await tick()
    answered(null)
  })
  m.host.querySelector<HTMLElement>('[data-cy^=tool-toggle-]')!.click()
  await tick()
  expect(door().textContent?.trim()).toBe('Open the workflow')
  await opensTheWorkflowSheet(() => door().click())
  await opensTheWorkflowSheet(() => m.q('panel-row').click())
  applyEvent(session.value.transcript, {
    ...workflow,
    outcome: 'completed',
    run: { kind: 'workflow', result: 'Map review complete' },
  })
  await tick()
  await opensTheWorkflowSheet(async () => {
    m.q('past-runs-open').click()
    await tick()
    m.q('past-runs-dialog').querySelector<HTMLElement>('[data-cy=panel-row]')!.click()
  })
  await opensTheWorkflowSheet(() => door().click())
  expect(readAnswer).toHaveBeenCalledTimes(1)
})

it('opens a linked workflow call where tool answers cannot be read', async () => {
  const { session } = workflowCall(false, true)
  const { m, door, opensTheWorkflowSheet } = mountCall(session)
  await tick()
  m.host.querySelector<HTMLElement>('[data-cy^=tool-toggle-]')!.click()
  await tick()
  expect(door().textContent?.trim()).toBe('Open the workflow')
  await opensTheWorkflowSheet(() => door().click())
})

it('draws the same checklist component inside Running now and the conversation', async () => {
  const session = ref(
    record([
      {
        type: 'plan_update',
        steps: [
          { text: 'Read the map', status: 'done' },
          { text: 'Check the footpath', status: 'active' },
        ],
        run: { kind: 'checklist', input: 'Check the route', progress: 'Checking the footpath' },
      },
    ]),
  )
  const Host = defineComponent({
    setup: () => () => h(ConversationPane, paneProps({ record: session.value, drawerOpen: true })),
  })
  const m = mount(Host, {}, { width: 1400, height: 900 })
  await tick()
  expect(m.all('plan-entry')).toHaveLength(2)
  const panel = m.q('panel-agents')
  expect(panel.querySelectorAll('[data-cy=plan-entry]')).toHaveLength(1)
  expect(panel.querySelector('[data-cy=panel-todo]')?.textContent).toContain('Check the footpath')
  m.q('checklist-open').click()
  await tick()
  const detail = m.q('close-overlay').closest('.sheet-shell')!
  expect(detail.querySelector('[data-cy=run-input]')?.textContent).toContain('Check the route')
  expect(detail.querySelector('[data-cy=run-state]')?.textContent).toContain(
    'Checking the footpath',
  )
  m.q('close-overlay').click()
  await tick()
  const checklist = m.q('panel-todo')
  const fold = checklist.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  expect(fold.querySelector('use')?.getAttribute('href')).toBe('#i-chevron')
  expect(fold.getAttribute('aria-expanded')).toBe('true')
  fold.click()
  await tick()
  expect(fold.getAttribute('aria-expanded')).toBe('false')
  expect(checklist.querySelector<HTMLElement>('.body')?.style.display).toBe('none')
  expect(m.all('plan-entry')).toHaveLength(2)
  applyEvent(session.value.transcript, {
    type: 'plan_update',
    steps: [
      { text: 'Read the map', status: 'done' },
      { text: 'Check the footpath', status: 'done' },
    ],
    run: { kind: 'checklist', result: 'Route checked' },
  })
  await tick()
  expect(m.all('panel-todo')).toHaveLength(0)
  expect(m.all('plan-entry')).toHaveLength(1)
  m.q('past-runs-open').click()
  await tick()
  expect(m.q('past-runs-dialog').textContent).toContain('Route checked')
  m.q('panel-row').click()
  await tick()
  expect(m.all('plan-entry')).toHaveLength(2)
  for (const plan of m.all('plan-entry')) {
    expect(plan.textContent).toContain('Check the footpath')
    expect(plan.getAttribute('data-done')).toBe('2')
    expect(plan.querySelector('[data-cy=run-input]')?.textContent).toContain('Check the route')
    expect(plan.querySelector('[data-cy=run-state]')?.textContent).toContain('Route checked')
    expect(plan.querySelector('[data-cy=run-state]')?.textContent).not.toContain(
      'Checking the footpath',
    )
  }
})

it('does not put a late missing output into the next conversation', async () => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'started',
    title: 'Read the map',
  })
  let finish!: (opened: boolean) => void
  const conversation = ref('first')
  const Host = defineComponent({
    setup: () => () =>
      h(RunningNowCard, {
        state,
        conversation: conversation.value,
        onOpenRun: () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          }),
      }),
  })
  const m = mount(Host, {}, { width: 760, height: 900 })
  m.q('panel-row').click()
  await tick()
  conversation.value = 'second'
  await tick()
  finish(false)
  await tick()
  expect(m.host.textContent).not.toContain('Output not available')
  m.q('past-runs-open').click()
  await tick()
  expect(m.q('past-runs-dialog').textContent).toContain('Past runs')
})

it('keeps the checklist inside Running now, inset like its other content, in each look', async () => {
  const session = record([
    {
      type: 'plan_update',
      steps: [
        { text: 'Read the map', status: 'done' },
        { text: 'Check the footpath', status: 'active' },
      ],
      run: { kind: 'checklist', input: 'Check the route', progress: 'Checking the footpath' },
    },
    { type: 'sub_agent', agentId: 'map-reader', phase: 'started', title: 'Read the map' },
  ])
  const folds = ['brobot2.cardRunningNowFolded', 'brobot2.cardChecklistFolded']
  const savedFolds = folds.map((key) => localStorage.getItem(key))
  const root = document.documentElement
  const savedAttributes = [...root.attributes].map(({ name, value }) => [name, value] as const)
  const savedThemeCss = document.getElementById(THEME_STYLE_ID)?.textContent ?? null
  const viewport = { width: innerWidth, height: innerHeight }
  const text = (el: Element): DOMRect => {
    const box = el.getBoundingClientRect()
    const own = getComputedStyle(el)
    const left = box.left + parseFloat(own.borderLeftWidth) + parseFloat(own.paddingLeft)
    const top = box.top + parseFloat(own.borderTopWidth) + parseFloat(own.paddingTop)
    const right = box.right - parseFloat(own.borderRightWidth) - parseFloat(own.paddingRight)
    const bottom = box.bottom - parseFloat(own.borderBottomWidth) - parseFloat(own.paddingBottom)
    return new DOMRect(left, top, right - left, bottom - top)
  }
  try {
    for (const key of folds) localStorage.removeItem(key)
    await page.viewport(1440, 900)
    for (const look of ['crew-night', 'defined', 'synthwave'] as const) {
      wearTheme(look)
      const m = mount(ConversationPane, paneProps({ record: session, drawerOpen: true }), {
        width: 1400,
        height: 900,
      })
      await tick()
      await drawnReady()
      const panel = m.q('panel-agents')
      const checklist = m.q('panel-todo')
      const rows = m.q('running-now-rows')
      expect(panel.contains(checklist), look).toBe(true)
      const box = panel.getBoundingClientRect()
      const style = getComputedStyle(panel)
      const content = {
        left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
        bottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
      }
      const steps = [...checklist.querySelectorAll('.step .text')]
      expect(steps, look).toHaveLength(2)
      const title = (el: Element) => el.querySelector(':scope > .head .title')!
      const stepParts = steps.map((step, i): [string, Element] => [`step ${i + 1}`, step])
      const inside: [string, Element][] = [
        ['checklist', checklist],
        ['checklist title', title(checklist)],
        ...stepParts,
      ]
      for (const [name, el] of inside) {
        const drawn = el === checklist ? el.getBoundingClientRect() : text(el)
        expect(drawn.width * drawn.height, `${look} ${name} drawn`).toBeGreaterThan(0)
        expect(drawn.left, `${look} ${name} left`).toBeGreaterThanOrEqual(content.left - 0.5)
        expect(drawn.right, `${look} ${name} right`).toBeLessThanOrEqual(content.right + 0.5)
        expect(drawn.top, `${look} ${name} top`).toBeGreaterThanOrEqual(content.top - 0.5)
        expect(drawn.bottom, `${look} ${name} bottom`).toBeLessThanOrEqual(content.bottom + 0.5)
      }
      const own = checklist.getBoundingClientRect()
      expect(own.left, `${look} checklist left`).toBeCloseTo(content.left)
      expect(own.right, `${look} checklist right`).toBeCloseTo(content.right)
      expect(rows.getBoundingClientRect().left, `${look} rows left`).toBeCloseTo(own.left)
      expect(rows.getBoundingClientRect().right, `${look} rows right`).toBeCloseTo(own.right)
      const boxes: [string, Element][] = [
        ['checklist head', checklist.querySelector(':scope > .head')!],
        ['steps', checklist.querySelector('.steps')!],
        ...[...checklist.querySelectorAll('.step')].map((step, i): [string, Element] => [
          `step row ${i + 1}`,
          step,
        ]),
      ]
      for (const [name, el] of boxes)
        expect(text(el).left, `${look} ${name} inset`).toBeCloseTo(content.left)
      // The step mark, header icon and row icon differ by a pixel; spacing steps are 2px or more.
      const inset = text(title(panel)).left
      const aligned: [string, Element][] = [['checklist title', title(checklist)], ...stepParts]
      for (const [name, el] of aligned)
        expect(Math.abs(text(el).left - inset), `${look} ${name} text inset`).toBeLessThanOrEqual(1)
      if (import.meta.env.VITE_RUNNING_SECTION_CAPTURE)
        await page.screenshot({
          element: panel,
          path: `${import.meta.env.VITE_RUNNING_SECTION_CAPTURE}/checklist-${look}.png`,
        })
      m.unmount()
    }
  } finally {
    folds.forEach((key, i) => {
      const value = savedFolds[i]
      if (value == null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    })
    applyTheme(null)
    for (const { name } of [...root.attributes]) root.removeAttribute(name)
    for (const [name, value] of savedAttributes) root.setAttribute(name, value)
    if (savedThemeCss !== null) {
      const tag = document.createElement('style')
      tag.id = THEME_STYLE_ID
      tag.textContent = savedThemeCss
      document.head.append(tag)
    }
    await page.viewport(viewport.width, viewport.height)
  }
})
