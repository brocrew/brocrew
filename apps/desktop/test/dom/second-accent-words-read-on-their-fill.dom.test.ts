import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component } from 'vue'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import SubAgentEntry from '../../src/renderer/src/components/SubAgentEntry.vue'
import WorkflowEntry from '../../src/renderer/src/components/WorkflowEntry.vue'
import type { WorkflowRunCard } from '../../src/renderer/src/lib/transcript'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { contrastRatio, over, type Rgba } from '../../src/shared/themes/colour'
import { resolveTheme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import type { LibraryEntry, LibraryPage } from '../../src/shared/runtime-ipc'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import { openAChildsWork, stackingWindow } from './a-window-with-a-workflow-and-nested-agents'
import { mount, unmountAll } from './harness'

/**
 * Words in the second accent, as the window draws them: each in the second accent's text form, on
 * the fill the readability check measures it on — the weak tint behind an active filter, the page
 * under the library's count and its Clear all, a workflow's and a sub-agent's ink wash, the
 * workflow head's second wash under the pointer, and the child-work viewer's panel.
 */

const BASE = (() => {
  const read = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  return read.theme
})()

/**
 * A light second accent. Its text form reads 5.0:1 on a white page, and 4.4:1 on a workflow's head
 * under the pointer, its second wash over the first.
 */
const THEME = {
  format: 1,
  id: 'light-second-accent',
  name: 'Light second accent',
  extends: 'defined',
  shared: { page: 0 },
  content: { accent2: '#8676d8' },
}

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

/** A computed colour as sRGB with its alpha, read from its numbers where it is see-through. */
function see(computed: string): Rgba {
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(computed)
  if (srgb) {
    const [r, g, b] = [srgb[1], srgb[2], srgb[3]].map((v) => Number(v) * 255)
    return { r: r!, g: g!, b: b!, a: srgb[4] === undefined ? 1 : Number(srgb[4]) }
  }
  const rgb = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(computed)
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number)
    return { r: r!, g: g!, b: b!, a: rgb[4] === undefined ? 1 : Number(rgb[4]) }
  }
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = 'rgb(0 0 0 / 0)'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! / 255 }
}

/** What `css` computes to where `at` is, as a background. */
function token(at: Element, css: string): Rgba {
  const probe = document.createElement('i')
  probe.style.backgroundColor = css
  at.append(probe)
  const value = see(getComputedStyle(probe).backgroundColor)
  probe.remove()
  return value
}

/** The colour an element's background shows: its own, over each ancestor's, down to an opaque one. */
function shownUnder(el: Element): Rgba {
  const layers: Rgba[] = []
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = see(getComputedStyle(e).backgroundColor)
    if (c.a > 0) layers.push(c)
    if (c.a >= 1) break
  }
  let shown = layers.pop() ?? { r: 255, g: 255, b: 255, a: 1 }
  for (const layer of layers.reverse()) shown = { ...over(layer, shown), a: 1 }
  return shown
}

/**
 * `words` are drawn in the second accent's text form, on `fill` painted with `css`: the fill the
 * readability check measures them on. Returns how they read there.
 */
function expectOn(what: string, words: Element | null, fill: Element, css: string): number {
  expect(words, `${what} is drawn`).not.toBeNull()
  expect(see(getComputedStyle(words!).color), `${what} in the text form`).toEqual(
    token(words!, 'var(--accent-2-text)'),
  )
  expect(see(getComputedStyle(fill).backgroundColor), `${what}: its fill`).toEqual(token(fill, css))
  return contrastRatio({ ...see(getComputedStyle(words!).color), a: 1 }, shownUnder(words!))
}

const settle = async (ms = 80): Promise<void> => {
  await new Promise((done) => setTimeout(done, ms))
  await nextTick()
  await nextTick()
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
  delete (window as { api?: unknown }).api
})

/** A light scope with the conversation's background, as the pane draws one. */
const inPage = (child: Component, props: Record<string, unknown>): Component =>
  defineComponent({
    setup: () => () =>
      h(
        'section',
        {
          'data-chat-theme': 'light',
          class: 'page',
          style: 'padding:16px;background:var(--conversation-bg-color, var(--chat-bg))',
        },
        [h(child as never, props)],
      ),
  })

describe('words in the second accent, on their fills', () => {
  it('the check refuses the theme, at the second accent', () => {
    const read = validateTheme(THEME, {
      assets: new Map(),
      builtIns: new Map([['defined', BASE]]),
    })
    expect(read.ok).toBe(false)
    if (read.ok) return
    // Exactly one refusal: the second accent's words on the page, where the library draws them.
    expect(read.problems).toEqual([
      expect.objectContaining({
        at: 'content.accent2',
        says: expect.stringMatching(
          /^Links on the page would be too faint: 4\.3 to 1 against the page,/,
        ),
      }),
    ])
  })

  it('the library: an active filter on the weak tint, its count and Clear all on the page', async () => {
    applyTheme(resolveTheme(THEME as never, BASE))
    const entries: LibraryEntry[] = [0, 1].map((i) => ({
      id: `sample::${i}`,
      provider: 'codex',
      providerSessionId: `thread-${i}`,
      recordId: `record-${i}`,
      cwd: '/work/sample-site',
      title: `Sample ${i}`,
      preview: 'A sample conversation.',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      bytes: 1024,
      origin: 'user-home',
      onDisk: true,
      readable: true,
      derived: 'current',
      lastEnding: 'completed',
      unresumableReason: 'Read here only.',
      child: null,
    }))
    const page: LibraryPage = {
      entries,
      matched: entries.length,
      counts: {
        total: 2,
        ours: 0,
        userHome: 2,
        restored: 0,
        imported: 2,
        notImported: 0,
        onlyHere: 0,
        providers: [
          { provider: 'claude', total: 1 },
          { provider: 'codex', total: 2 },
        ],
      },
      skipped: [],
      skippedTotal: 0,
    }
    ;(window as { api?: unknown }).api = {
      runtime: {
        listLibrary: async () => page,
        listResumable: async () => [],
        listUnresumable: async () => [],
      },
    }
    const m = mount(SessionLibrary, {}, { width: 1100, height: 800 })
    await settle()
    const select = m.host.querySelector<HTMLSelectElement>('[data-cy="library-facet-provider"]')!
    select.value = 'codex'
    select.dispatchEvent(new Event('change'))
    await settle(300)
    const facet = select.closest('.facet.on')
    expect(facet, 'the provider filter is on').not.toBeNull()
    expectOn('the filter’s name', facet!.querySelector('.k'), facet!, 'var(--info-bg)')
    expectOn('the filter’s choice', select, facet!, 'var(--info-bg)')
    const library = m.host.querySelector('.library')!
    const count = m.host.querySelector('[data-cy="library-filter-count"] strong')
    expectOn('the count', count, library, 'var(--conversation-bg-color, var(--chat-bg))')
    const clear = m.host.querySelector<HTMLElement>('[data-cy="library-clear-all"]')
    expectOn('Clear all', clear, library, 'var(--conversation-bg-color, var(--chat-bg))')
    await userEvent.hover(clear!)
    await settle(300)
    expectOn('Clear all, pointed at', clear, clear!, 'var(--info-bg)')
  })

  it('a workflow: its phase on the wash, and under the pointer on the head’s second wash', async () => {
    applyTheme(resolveTheme(THEME as never, BASE))
    const card = {
      taskId: 'wq1demo',
      toolUseId: 'toolu_wf',
      name: 'demo-panel',
      description: 'Three drafters, then a judge',
      phases: [
        { index: 1, title: 'Draft' },
        { index: 2, title: 'Judge' },
      ],
      agents: [
        { agentId: 'a1', label: 'drafter:one', phaseIndex: 1, state: 'running' },
        { agentId: 'a2', label: 'drafter:two', phaseIndex: 1, state: 'queued' },
      ],
      usage: { tokens: 1000, toolCalls: 1, ms: 2000 },
      running: true,
    } as WorkflowRunCard
    const m = mount(
      inPage(WorkflowEntry, { run: card, canOpenChild: true }),
      {},
      {
        width: 760,
        height: 600,
      },
    )
    await settle()
    const block = m.host.querySelector('.workflow')!
    expectOn(
      'the phase',
      m.host.querySelector('[data-cy="workflow-phase-of"]'),
      block,
      'var(--wash-2)',
    )
    m.host.querySelector<HTMLElement>('[data-cy="workflow-head"]')!.click()
    await settle()
    const phase = m.host.querySelector<HTMLElement>('[data-cy="workflow-phase-head-1"]')
    if (phase?.getAttribute('aria-expanded') !== 'true') phase?.click()
    await settle()
    expectOn(
      'awaiting a slot',
      m.host.querySelector('[data-cy="workflow-queued"]'),
      block,
      'var(--wash-2)',
    )
    const head = m.host.querySelector<HTMLElement>('[data-cy="workflow-head"]')!
    await userEvent.hover(head)
    await settle(300)
    // The worst of its fills, its head's second wash over the first: the pair the check refuses.
    const pointedAt = expectOn(
      'the phase, pointed at',
      m.host.querySelector('[data-cy="workflow-phase-of"]'),
      head,
      'var(--wash-3)',
    )
    expect(pointedAt).toBeLessThan(4.5)
  })

  it('a sub-agent: the whole answer, on its wash', async () => {
    applyTheme(resolveTheme(THEME as never, BASE))
    const m = mount(
      inPage(SubAgentEntry, {
        card: {
          agentId: 'agent-1',
          running: false,
          outcome: 'completed',
          body: [
            {
              kind: 'tool',
              callId: 'toolu_child',
              name: 'Bash',
              summary: 'ls -la',
              result: { summary: 'total 48', ok: true },
            },
          ],
        },
        placement: 'transcript',
        canReadAnswer: true,
      }),
      {},
      { width: 760, height: 600 },
    )
    await settle()
    m.host.querySelector<HTMLElement>('[data-cy="subagent-head"]')!.click()
    await settle()
    const ask = m.host.querySelector('[data-cy="subagent-tool-answer-toolu_child"]')
    expectOn('the whole answer', ask, m.host.querySelector('.subagent')!, 'var(--wash-2)')
  })

  it('the child-work viewer: its part, on its panel in the overlay, over the overlay’s wash', async () => {
    applyTheme(resolveTheme(THEME as never, BASE))
    const m = await stackingWindow()
    await openAChildsWork(m)
    const part = document.querySelector('[data-cy="child-work-part"]')
    expect(
      part?.closest('[data-cy="overlay-host"]'),
      'the viewer opens in the overlay',
    ).toBeTruthy()
    expectOn('the part', part, part!.closest('.child-work')!, 'var(--drawer-solid)')
    // What is painted under it includes the overlay's wash: the panel is see-through only when the
    // theme makes it so, and then the wash shows.
    expect(
      see(getComputedStyle(part!.closest('[data-cy="overlay-host"]')!).backgroundColor).a,
    ).toBeGreaterThan(0)
  })
})
