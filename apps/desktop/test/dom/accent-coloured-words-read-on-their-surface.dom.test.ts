import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { page, userEvent } from 'vitest/browser'
import { settle, windowStage } from '../../look/fixtures/window'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { contrastRatio, mixSrgb, over, type Rgba } from '../../src/shared/themes/colour'
import { resolveTheme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import DocumentBody from '../../src/renderer/src/components/DocumentBody.vue'
import { theList } from '../../src/shared/model-choice'
import { META, mount, paneProps, record, unmountAll, type Mounted } from './harness'
import { givenAnswer } from './what-this-agent-was-given.fixture'
import { readsAt } from './what-is-painted-under'

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

function painted(computed: string): Rgba {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return { r: d[0]!, g: d[1]!, b: d[2]!, a: 1 }
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
  delete (window as { api?: unknown }).api
})

function lightAccent(): void {
  const read = validateTheme(
    {
      format: 1,
      id: 'light-accent',
      name: 'Light accent',
      extends: 'defined',
      content: { accent: '#4c6ef5' },
      // A page as white as the cards: the workflow's washes over it leave the links readable.
      shared: { page: 0 },
      // Its solid controls, white on the accent, take a darker fill of their own.
      tokens: { content: { 'accent-solid-bg': '#3b5bdb' } },
    },
    { assets: new Map(), builtIns: new Map([['defined', BASE]]) },
  )
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  applyTheme(resolveTheme(read.theme, BASE))
}

describe('accent-coloured words read on their surface', () => {
  it('a light accent: the files card’s “+N more” draws the accent’s text form, at 4.5:1 or more', async () => {
    const read = validateTheme(
      {
        format: 1,
        id: 'light-accent',
        name: 'Light accent',
        extends: 'defined',
        content: { accent: '#4c6ef5' },
        // A page as white as the cards: the workflow's washes over it leave the links readable.
        shared: { page: 0 },
        // Its solid controls, white on the accent, take a darker fill of their own.
        tokens: { content: { 'accent-solid-bg': '#3b5bdb' } },
      },
      { assets: new Map(), builtIns: new Map([['defined', BASE]]) },
    )
    if (!read.ok) throw new Error(JSON.stringify(read.problems))
    applyTheme(resolveTheme(read.theme, BASE))
    const m = mount(windowStage({ titleBar: true }), {}, { width: 1180, height: 800 })
    await settle()
    const link = m.host.querySelector('.card-section .files-all')
    expect(link, 'the files card offers the rest of its files').not.toBeNull()
    const card = painted(getComputedStyle(link!.closest('.card-section')!).backgroundColor)
    const ink = painted(getComputedStyle(link!).color)
    const raw = painted('#4c6ef5')
    expect(contrastRatio(raw, card)).toBeLessThan(4.5)
    expect(ink).not.toEqual(raw)
    expect(contrastRatio(ink, card)).toBeGreaterThanOrEqual(4.5)
  })

  it('the same accent: a join line, on the strong tint, reads at 4.5:1 or more', async () => {
    lightAccent()
    ;(window as { api?: unknown }).api = {
      runtime: { whatThisAgentWasGiven: vi.fn(async () => givenAnswer()) },
    }
    const m = mount(
      AgentInputPopup as never,
      {
        sessionId: 'sess_1',
        provider: 'claude',
        who: 'Ada',
        profile: 'designer',
        state: record([]).transcript,
        startLoaded: true,
      },
      { width: 1000, height: 800 },
    )
    // The popup opens in the overlay's light scope, as the app shows it.
    m.host.setAttribute('data-chat-theme', 'light')
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 4; i += 1) await nextTick()
      await new Promise((done) => setTimeout(done, 0))
    }
    await settle()
    // A join line sits between the parts of a tab; look through the tabs for one.
    let join = m.host.querySelector('.join:not(.inner)')
    for (let tab = 0; join === null && tab < 6; tab += 1) {
      const press = m.host.querySelector<HTMLElement>(`[data-cy="input-tab-${tab}"]`)
      if (!press) continue
      press.click()
      await settle()
      join = m.host.querySelector('.join:not(.inner)')
    }
    expect(join, 'what the agent receives draws a join line').not.toBeNull()
    const fill = painted(getComputedStyle(join!).backgroundColor)
    const ink = painted(getComputedStyle(join!).color)
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(4.5)
  })

  it('the new-conversation button under the pointer: its words read on the tint the check measures', async () => {
    const own = {
      format: 1,
      id: 'light-frame',
      name: 'Light frame',
      extends: 'defined',
      frame: { ink: '#1b2238', paper: '#ffffff', accent: '#7048e8' },
      content: { accent: '#4338ca' },
      shared: { tint: 22 },
    }
    const read = validateTheme(own, {
      assets: new Map(),
      builtIns: new Map([['defined', BASE]]),
    })
    expect(read.ok).toBe(true)
    applyTheme(resolveTheme(own as never, BASE))
    ;(window as { api?: unknown }).api = {
      runtime: { listResumable: async () => [], listUnresumable: async () => [] },
    }
    const m = mount(
      SideRail,
      { open: [], activeId: null, place: null },
      { width: 251.68, height: 600 },
    )
    await nextTick()
    const button = m.host.querySelector<HTMLElement>('.new-conversation-button')
    expect(button, 'the menu offers a new conversation').not.toBeNull()
    const rest = contrastRatio(
      painted(getComputedStyle(button!).color),
      painted(getComputedStyle(button!).backgroundColor),
    )
    await userEvent.hover(button!)
    const hovered = contrastRatio(
      painted(getComputedStyle(button!).color),
      painted(getComputedStyle(button!).backgroundColor),
    )
    expect(rest).toBeGreaterThanOrEqual(4.5)
    expect(hovered).toBeLessThan(4.5)
  })

  it('a light accent with no tint: the right-hand panel’s accent words on the accent’s mixes', async () => {
    const own = {
      format: 1,
      id: 'no-tint',
      name: 'No tint',
      extends: 'defined',
      content: { accent: '#7582df' },
      shared: { page: 0, tint: 0 },
    }
    const read = validateTheme(own, {
      assets: new Map(),
      builtIns: new Map([['defined', BASE]]),
    })
    expect(read.ok).toBe(true)
    applyTheme(resolveTheme(own as never, BASE))
    const window_ = mount(windowStage({ titleBar: true }), {}, { width: 1180, height: 800 })
    await settle()
    const press = window_.host.querySelector<HTMLButtonElement>('[data-cy="card-run-compact"]')
    expect(press?.disabled, 'compacting is offered').toBe(false)
    press!.click()
    await settle()
    const tag = window_.host.querySelector<HTMLElement>('.file-tile-tag')
    const door = window_.host.querySelector<HTMLElement>('.door-compact')
    expect(tag, 'a file’s tag is drawn').not.toBeNull()
    expect(door, 'the compact door is open').not.toBeNull()
    expectOnMix('a file’s tag', tag!, tag!, 12)
    expectOnMix('the compact door', door!, door!, 10)
    window_.unmount()
    // The effort is a button where the model can be changed; under the pointer it sits on the 8% mix.
    const pane = mountPickablePane()
    await settleLong()
    const effort = pane.host.querySelector<HTMLElement>('[data-cy="card-run-effort"]')
    expect(effort?.tagName, 'the effort can be changed').toBe('BUTTON')
    await userEvent.hover(effort!)
    expectOnMix('the effort, under the pointer', effort!, effort!.querySelector('.run-value')!, 8)
  })

  it('a see-through panel: a file’s tag on its mix reads as drawn over the dark card under it', async () => {
    const own = {
      format: 1,
      id: 'see-through',
      name: 'See-through',
      extends: 'defined',
      content: { ink: '#ffffff', paper: '#000000', accent: '#4c6ef5', scheme: 'dark' },
      status: { waiting: '#ffd27a', success: '#7dffc8', danger: '#ffb3bd', auto: '#ffcf9e' },
      tokens: { content: { panel: '#00000000', 'accent-text': '#7c7c7c' } },
      drawer: { card: { fill: '#111111' } },
    }
    const read = validateTheme(own, {
      assets: new Map(),
      builtIns: new Map([['defined', BASE]]),
    })
    expect(read.ok).toBe(true)
    applyTheme(resolveTheme(own as never, BASE))
    const m = mount(windowStage({ titleBar: true }), {}, { width: 1180, height: 800 })
    await settle()
    const tag = m.host.querySelector<HTMLElement>('.file-tile-tag')
    expect(tag, 'a file’s tag is drawn').not.toBeNull()
    const card = shownUnder(tag!.closest('.card-section')!)
    expect(card).toEqual({ r: 0x11, g: 0x11, b: 0x11, a: 1 })
    const ink = painted(getComputedStyle(tag!).color)
    expect(contrastRatio(ink, shownUnder(tag!))).toBeLessThan(4.5)
  })

  it('a document’s link, at its own share of the accent, on the document’s paper', async () => {
    const own = {
      format: 1,
      id: 'grey-on-black',
      name: 'Grey on black',
      extends: 'defined',
      content: { ink: '#ffffff', paper: '#000000', accent: '#5c5c5c' },
      shared: { page: 0, tint: 0 },
      status: { waiting: '#ffffff', success: '#ffffff', danger: '#ffffff', auto: '#ffffff' },
    }
    const read = validateTheme(own, {
      assets: new Map(),
      builtIns: new Map([['defined', BASE]]),
    })
    expect(read.ok).toBe(true)
    applyTheme(resolveTheme(own as never, BASE))
    const m = mount(
      DocumentBody,
      { source: 'Read [the guide](https://example.com) first.' },
      { width: 600, height: 400 },
    )
    m.host.setAttribute('data-chat-theme', 'light')
    await nextTick()
    const link = m.host.querySelector<HTMLElement>('.md-doc a')
    expect(link, 'the document draws its link').not.toBeNull()
    const ink = painted(getComputedStyle(link!).color)
    const paper = painted(getComputedStyle(link!.closest('.doc-paper')!).backgroundColor)
    expect(contrastRatio(ink, paper)).toBeLessThan(4.5)
  })

  it('a see-through right-hand panel: a file’s tag over what is under the panel, docked and floating', async () => {
    const own = (
      accentText: string,
      more: Record<string, string> = {},
      conversation = '#111111',
    ) => ({
      format: 1,
      id: 'see-through-panel',
      name: 'See-through panel',
      extends: 'defined',
      frame: { ink: '#ffffff', paper: '#000000', accent: '#ffffff' },
      content: { ink: '#ffffff', paper: '#000000', accent: '#4c6ef5' },
      shared: { page: 0, tint: 0 },
      status: { waiting: '#ffffff', success: '#ffffff', danger: '#ffffff', auto: '#ffffff' },
      tokens: { content: { panel: '#00000000', 'accent-text': accentText, ...more } },
      conversation: { background: { color: conversation } },
      drawer: { background: { color: '#00000000' }, card: { fill: '#00000000' } },
    })
    const glass = own('#999999', { 'paper-bg': '#333333', 'paper-link': '#ffffff' }, '#11111100')
    const context = { assets: new Map(), builtIns: new Map([['defined', BASE]]) }
    const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
    const tagAt = async (theme: object, width: number): Promise<number> => {
      applyTheme(resolveTheme(theme as never, BASE))
      await page.viewport(width, 800)
      const m = mount(windowStage({ titleBar: true }), {}, { width, height: 800 })
      await settle()
      const fit = width < 1000 ? 'overlay' : 'docked'
      expect(
        m.host.querySelector(`.session-drawer.fit-${fit}`),
        `the panel is ${fit}`,
      ).not.toBeNull()
      const tag = m.host.querySelector<HTMLElement>('.file-tile-tag')
      expect(tag, 'a file’s tag is drawn').not.toBeNull()
      tag!.scrollIntoView({ block: 'center' })
      const reading = await readsAt(tag!)
      m.unmount()
      expect(reading.is, 'the tag is read').toBe('read')
      return reading.is === 'read' ? reading.ratio : NaN
    }
    try {
      for (const theme of [own('#868686'), own('#8e8e8e'), glass])
        expect(validateTheme(theme, context).ok).toBe(true)
      expect(await tagAt(own('#868686'), 1180)).toBeLessThan(4.5)
      expect(await tagAt(own('#8e8e8e'), 1180)).toBeGreaterThanOrEqual(4.5)
      expect(await tagAt(own('#8e8e8e'), 760)).toBeGreaterThanOrEqual(4.5)
      expect(await tagAt(glass, 1180)).toBeGreaterThanOrEqual(4.5)
      expect(await tagAt(glass, 760)).toBeLessThan(4.5)
    } finally {
      await page.viewport(ORIGINAL.width, ORIGINAL.height)
    }
  })
})

function shownUnder(el: Element): Rgba {
  const layers: Rgba[] = []
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = see(getComputedStyle(e).backgroundColor)
    if (c.a > 0) layers.push(c)
    if (c.a >= 1) break
  }
  let shown = layers.pop() ?? { r: 255, g: 255, b: 255, a: 1 }
  for (const layer of layers.reverse()) shown = { ...over(layer, shown), a: 1 }
  return { r: Math.round(shown.r), g: Math.round(shown.g), b: Math.round(shown.b), a: 1 }
}

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

function expectOnMix(what: string, box: HTMLElement, words: HTMLElement, share: number): void {
  const ink = painted(getComputedStyle(words).color)
  const fill = painted(getComputedStyle(box).backgroundColor)
  const accent = painted(resolved(box, 'var(--accent)'))
  const panel = painted(resolved(box, 'var(--panel)'))
  expect(fill, `${what}: the ${share}% mix`).toSatisfy((c: Rgba) =>
    near(c, mixSrgb(accent, share, panel)),
  )
  expect(contrastRatio(ink, fill), what).toBeLessThan(4.5)
}

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

async function settleLong(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}

function resolved(at: HTMLElement, css: string): string {
  const probe = document.createElement('i')
  probe.style.color = css
  at.append(probe)
  const out = getComputedStyle(probe).color
  probe.remove()
  return out
}

function near(a: Rgba, b: Rgba): boolean {
  return Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1
}
