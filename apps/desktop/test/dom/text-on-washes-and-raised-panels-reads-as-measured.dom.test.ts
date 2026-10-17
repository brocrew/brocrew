import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import WorkflowEntry from '../../src/renderer/src/components/WorkflowEntry.vue'
import type { WorkflowRunCard } from '../../src/renderer/src/lib/transcript'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { contrastRatio, over, type Rgba } from '../../src/shared/themes/colour'
import { theList } from '../../src/shared/model-choice'
import { resolveTheme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import { META, mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * Text on the content's washes and raised panels, as the window draws it: the sign-in bar on the
 * waiting colour's wash, the model picker on `panel-3`, and a workflow's block on an ink wash. Each
 * theme here is refused by the readability check, and the window draws the pair it refuses.
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

/** The contrast of an element's text against what its background shows. */
const readsAt = (el: Element): number =>
  contrastRatio({ ...see(getComputedStyle(el).color), a: 1 }, shownUnder(el))

/** `own` over Defined: refused by the check at `at`, in a sentence starting `what`, then worn. */
function wearRefused(own: Record<string, unknown>, at: string, what: string): void {
  const file = { format: 1, id: 'washes', name: 'Washes', extends: 'defined', ...own }
  const read = validateTheme(file, { assets: new Map(), builtIns: new Map([['defined', BASE]]) })
  expect(read.ok).toBe(false)
  if (read.ok) return
  expect(read.problems).toContainEqual(
    expect.objectContaining({ at, says: expect.stringMatching(new RegExp(`^${what} would be`)) }),
  )
  applyTheme(resolveTheme(file as never, BASE))
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
  delete (window as { api?: unknown }).api
})

const FLAT = { page: 0, tint: 0 }
const WHITE_PANELS = { 'panel-2': '#ffffff', 'panel-3': '#ffffff' }

describe('text on the content’s washes and raised panels', () => {
  it('the sign-in bar: its button’s accent text under the pointer, on the waiting colour’s wash', async () => {
    wearRefused(
      {
        shared: FLAT,
        content: { accent: '#c9d2ff' },
        status: { waiting: '#3d2600' },
        tokens: {
          content: {
            'accent-text': '#6c6c6c',
            'paper-link': '#6c6c6c',
            'focus-ring-color': '#3d4fd6',
            'accent-solid-bg': '#3d4fd6',
            ...WHITE_PANELS,
          },
        },
      },
      'content.accent',
      'Links on the page',
    )
    const r = record([{ type: 'assistant_message', text: 'hello' } as never])
    r.meta = { ...META, liveness: { ...META.liveness, signInSuperseded: true } } as never
    const m = mount(ConversationPane as Component, paneProps({ record: r }), {
      width: 900,
      height: 700,
    })
    await settle()
    const bar = m.host.querySelector<HTMLElement>('[data-cy="sign-in-superseded"]')
    expect(bar, 'the sign-in bar is drawn').not.toBeNull()
    expect(readsAt(bar!.querySelector('.sign-in-bar-note')!)).toBeGreaterThanOrEqual(4.5)
    const button = bar!.querySelector<HTMLElement>('.sign-in-bar-button')!
    await userEvent.hover(button)
    expect(readsAt(button)).toBeLessThan(4.5)
  })

  it('the model picker: its accent words on panel-3', async () => {
    wearRefused(
      {
        shared: FLAT,
        content: { accent: '#c9d2ff' },
        tokens: {
          content: {
            'accent-text': '#6c6c6c',
            'paper-link': '#6c6c6c',
            'focus-ring-color': '#3d4fd6',
            'accent-solid-bg': '#3d4fd6',
          },
        },
      },
      'content.accent',
      'Links on cards',
    )
    const m = mountPickablePane()
    await settle()
    m.host.querySelector<HTMLElement>('[data-cy="card-run-model"]')!.click()
    await settle()
    const panel = document.querySelector<HTMLElement>('[data-cy="model-picker-panel"]:popover-open')
    expect(panel, 'the picker is open').not.toBeNull()
    const words = panel!.querySelector<HTMLElement>('.foot .take, .add-open')
    expect(words, 'the picker offers its accent words').not.toBeNull()
    expect(readsAt(words!)).toBeLessThan(4.5)
  })

  it('a workflow’s block: an agent’s link on the ink wash, and an open button’s second wash over it', async () => {
    wearRefused(
      { shared: FLAT, tokens: { content: { 'text-soft': '#6e7283', ...WHITE_PANELS } } },
      'content.ink',
      'Text on the page',
    )
    const card: WorkflowRunCard = {
      taskId: 'wq1demo',
      toolUseId: 'toolu_wf',
      name: 'demo-panel',
      description: 'Three drafters, then a judge',
      phases: [{ index: 1, title: 'Draft' }],
      agents: [{ agentId: 'a1', label: 'drafter:one', phaseIndex: 1, state: 'done' }],
      usage: { tokens: 30982, toolCalls: 4, ms: 20985 },
      running: false,
      outcome: 'completed',
    } as WorkflowRunCard
    const Page = defineComponent({
      setup: () => () =>
        h(
          'section',
          {
            'data-chat-theme': 'light',
            style:
              'width:720px;padding:16px;background:var(--conversation-bg-color, var(--chat-bg))',
          },
          [h(WorkflowEntry as never, { run: card, canOpenChild: true })],
        ),
    })
    const m = mount(Page, {}, { width: 760, height: 600 })
    await nextTick()
    m.host.querySelector<HTMLElement>('[data-cy="workflow-head"]')!.click()
    await settle()
    m.host.querySelector<HTMLElement>('[data-cy="workflow-phase-head-1"]')!.click()
    await settle()
    const agent = m.host.querySelector<HTMLElement>('[data-cy="workflow-agent-label"]')
    expect(agent, 'the agent’s link is drawn').not.toBeNull()
    expect(readsAt(agent!)).toBeLessThan(4.5)
    // Under the pointer an open button lays the second wash over the block's, as the check stacks it.
    const open = m.host.querySelector<HTMLElement>('[data-cy="workflow-open-journal"]')
    expect(open, 'the journal opens from the block').not.toBeNull()
    await userEvent.hover(open!)
    const wash = (n: 2 | 3): Rgba => {
      const probe = document.createElement('i')
      probe.style.backgroundColor = `var(--wash-${n})`
      open!.append(probe)
      const value = see(getComputedStyle(probe).backgroundColor)
      probe.remove()
      return value
    }
    expect(see(getComputedStyle(open!).backgroundColor)).toEqual(wash(3))
    expect(see(getComputedStyle(open!.closest('.workflow')!).backgroundColor)).toEqual(wash(2))
  })
})

/** The conversation pane with its Agent panel open, for a conversation whose model can be changed. */
function mountPickablePane(): Mounted {
  ;(window as { api?: unknown }).api = {
    runtime: {
      modelList: async ({ provider }: { provider: string }) => ({
        provider,
        notAsked: null,
        standIn: null,
        models: theList(
          [
            {
              id: 'opus',
              label: 'Opus',
              efforts: [{ id: 'high', label: 'high' }],
              defaultEffort: 'high',
              isDefault: true,
            },
          ],
          [],
        ),
        lastPicked: null,
        startsOn: null,
      }),
    },
  }
  const r = record([{ type: 'assistant_message', text: 'hello' } as never])
  r.meta = { ...META, settings: { ...META.settings, model: 'opus', reasoningEffort: 'high' } }
  return mount(
    ConversationPane as Component,
    {
      ...paneProps({ record: r, drawerOpen: true, drawerTab: 'open' }),
      pickModel: async () => ({ itsAgentsDefault: true, theLastPick: true }),
    },
    { width: 1200, height: 900 },
  )
}
