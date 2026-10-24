import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import DocumentBody from '../../src/renderer/src/components/DocumentBody.vue'
import DiffBody from '../../src/renderer/src/components/DiffBody.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { wearTheme } from '../../look/fixtures/themes'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { contrastRatio, over, type Rgba } from '../../src/shared/themes/colour'
import type { ModelList, Provider } from '../../src/shared/runtime-ipc'
import DEFINED from '../../resources/themes/defined/theme.json'
import { mount, unmountAll } from './harness'
import { see } from './what-is-painted-under'

const THEMES = ['classic', 'defined', 'crew-night', 'light-frame-dark-content'] as const
type Look = (typeof THEMES)[number]
const PROVIDERS = THEMES.flatMap((theme) =>
  (['claude', 'codex'] as const).map((provider) => [theme, provider] as const),
)

function wear(theme: Look): void {
  if (theme === 'classic') applyTheme(null)
  else if (theme !== 'light-frame-dark-content') wearTheme(theme)
  else
    applyTheme(
      resolveTheme(
        {
          format: 1,
          id: theme,
          name: 'Light frame, dark content',
          frame: { ink: '#151515', paper: '#ffffff', accent: '#334499' },
          content: { ink: '#fff4ff', paper: '#241036', accent: '#e8a0ff', scheme: 'dark' },
          status: { waiting: '#ffe8a0', success: '#a0ffd0', danger: '#ffa0b0', auto: '#ffc090' },
        },
        DEFINED as Theme,
      ),
    )
}

function under(el: Element): Rgba {
  const layers: Rgba[] = []
  for (let node: Element | null = el; node; node = node.parentElement) {
    const fill = see(getComputedStyle(node).backgroundColor)
    layers.push(fill)
    if (fill.a === 1) break
  }
  let result: Rgba = { r: 255, g: 255, b: 255, a: 1 }
  for (const layer of layers.reverse()) result = { ...over(layer, result), a: 1 }
  return result
}

function reading(el: Element) {
  const style = getComputedStyle(el)
  const ink = see(style.color)
  const fill = under(el)
  return {
    text: el.textContent?.trim() ?? '',
    ink: style.color,
    fill,
    ratio: contrastRatio({ ...over(ink, fill), a: 1 }, fill),
  }
}

function readable(el: Element): void {
  const result = reading(el)
  expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(4.5)
}

beforeEach(async () => {
  await page.viewport(1180, 900)
  providersBridge()
})
afterEach(() => {
  unmountAll()
  applyTheme(null)
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

function catalogue(provider: Provider): ModelList {
  return {
    provider,
    notAsked: null,
    standIn: null,
    startsOn: { model: 'recommended', effort: null, from: 'the-providers-default' },
    lastPicked: null,
    models: [
      {
        id: 'recommended',
        label: 'Recommended',
        resolvesTo: 'listed-model',
        isDefault: true,
        efforts: [],
        addedBy: 'the-provider',
      },
      { id: 'own-model', label: 'Own model', efforts: [], addedBy: 'a-person' },
    ],
  }
}

async function card(theme: Look, provider: Provider) {
  wear(theme)
  let finishDelete: (() => void) | undefined
  const remove = vi.fn(
    () => new Promise<readonly string[]>((resolve) => (finishDelete = () => resolve([]))),
  )
  const lists = createModelLists(() => ({
    modelList: async () => catalogue(provider),
    addHandAddedModel: async ({ model }) => ['own-model', model],
    deleteHandAddedModel: remove,
  }))
  await lists.read(provider)
  const fixture = defineComponent({
    setup: () => () =>
      h('section', { 'data-chat-theme': 'light' }, [
        h(ProviderCard, {
          provider,
          capabilities: null,
          limit: null,
          limitsRead: true,
          clock: Date.now(),
          version: null,
          readings: [],
          resources: null,
          resourcesPaused: true,
          resourcesError: null,
          loginMoved: 0,
          lists,
          open: {
            login: false,
            key: false,
            version: false,
            usage: false,
            resources: false,
            models: true,
          },
        }),
      ]),
  })
  const view = mount(fixture, {}, { width: 1100, height: 850 })
  await vi.waitFor(() => expect(view.all('provider-model-row')).toHaveLength(2))
  return { view, remove, finishDelete: () => finishDelete?.() }
}

it.each(PROVIDERS)(
  '%s %s: model names, aliases and tags remain readable',
  async (theme, provider) => {
    const { view } = await card(theme, provider)
    const rows = view.all('provider-model-row')
    expect(rows.every((row) => row.tagName === 'LI' && row.getAttribute('role') === null)).toBe(
      true,
    )
    expect(rows[0]!.textContent).toContain('default')
    expect(rows[0]!.textContent).toContain('listed-model')
    expect(rows[1]!.textContent).toContain('added by you')
    const texts = [...view.q('provider-model-rows').querySelectorAll('.model-name, .tag')]
    expect(texts).toHaveLength(5)
    console.info('model-colours', JSON.stringify({ theme, provider, readings: texts.map(reading) }))
    for (const text of texts) readable(text)
    if (theme === 'classic')
      expect(getComputedStyle(rows[0]!).backgroundColor).toBe('rgb(243, 242, 238)')
    view.unmount()
  },
)

it.each(PROVIDERS)(
  '%s %s: delete and add controls retain hover, keyboard focus and pending states',
  async (theme, provider) => {
    const { view, remove, finishDelete } = await card(theme, provider)
    const button = view.q('provider-model-delete') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    const cursor = getComputedStyle(button).cursor
    readable(button)
    await userEvent.hover(button)
    readable(button)
    const beforeFocus = getComputedStyle(button).outlineStyle
    button.focus()
    await userEvent.keyboard('{Tab}')
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(button)
    expect(button.matches(':focus-visible')).toBe(true)
    const focused = getComputedStyle(button)
    expect(focused.outlineStyle).toBe('solid')
    expect(parseFloat(focused.outlineWidth)).toBeGreaterThan(0)
    console.info(
      'delete-states',
      JSON.stringify({
        theme,
        provider,
        beforeFocus,
        outline: focused.outlineColor,
        width: focused.outlineWidth,
        normal: reading(button),
      }),
    )
    await userEvent.click(button)
    expect(remove).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(true)
    expect(getComputedStyle(button).cursor).toBe(cursor)
    expect(Number(getComputedStyle(button).opacity)).toBe(0.45)
    button.click()
    expect(remove).toHaveBeenCalledOnce()
    finishDelete()
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    await userEvent.click(view.q('provider-model-add-open'))
    const input = view.q('provider-model-add-name') as HTMLInputElement
    const add = input.form!.querySelector<HTMLButtonElement>('[type="submit"]')!
    expect(add.disabled).toBe(true)
    await userEvent.fill(input, 'another-model')
    expect(add.disabled).toBe(false)
    readable(input)
    readable(add)
  },
)

it.each(THEMES)(
  '%s: document and diff toolbar labels follow their content paper in either host zone',
  async (theme) => {
    wear(theme)
    const fixture = defineComponent({
      setup: () => () =>
        h(
          'div',
          {},
          ['frame', 'content'].map((zone) =>
            h('section', zone === 'content' ? { 'data-chat-theme': 'light' } : {}, [
              h(DocumentBody, { source: '# Sample document', filename: `${zone}.md` }),
              h(DiffBody, { source: '@@ -1 +1 @@\n-before\n+after', filename: `${zone}.ts` }),
            ]),
          ),
        ),
    })
    const view = mount(fixture, {}, { width: 1100, height: 850 })
    const labels = [...view.host.querySelectorAll('.doc-toolbar .lbl, .diff-bar .lbl')]
    expect(labels).toHaveLength(4)
    console.info(
      'toolbar-colours',
      JSON.stringify({
        theme,
        labels: labels.map(reading),
        controls: [...view.host.querySelectorAll('.seg')].map(reading),
      }),
    )
    for (const label of labels) readable(label)
    const controls = [...view.host.querySelectorAll<HTMLButtonElement>('.seg')]
    expect(controls).toHaveLength(8)
    for (const button of controls) {
      readable(button)
      await userEvent.hover(button)
      readable(button)
    }
    for (const button of view.all('doc-view-raw')) await userEvent.click(button)
    for (const button of view.all('diff-view-split')) await userEvent.click(button)
    expect(view.host.querySelectorAll('.seg.on')).toHaveLength(4)
    for (const button of controls) readable(button)
    if (theme === 'classic')
      for (const toolbar of view.host.querySelectorAll('.doc-toolbar, .diff-bar'))
        expect(getComputedStyle(toolbar).backgroundColor).toBe('rgb(243, 242, 238)')
  },
)
