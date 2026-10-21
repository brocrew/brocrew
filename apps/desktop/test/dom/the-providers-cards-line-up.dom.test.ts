import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import {
  OPEN_AT_FIRST,
  PROVIDER_PARTS,
  partKey,
  type ProviderPart,
} from '../../src/renderer/src/lib/provider-parts'
import { providersBridge } from '../../look/fixtures/providers'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * The Providers screen draws one card per provider side by side, and the same part starts at the
 * same height in every card, whatever the parts above it hold. Measured with the look scene's own
 * data, where Claude's version part says more than Codex's and Claude reads two usage windows to
 * Codex's one.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const RAIL_W = 251.68
/** The screen beside the rail at the app's floor, and a wider window. */
const WIDTHS = [1180 - RAIL_W, 1440 - RAIL_W] as const
/** Each part's hook, in the order the card draws them. */
const CY: Readonly<Record<ProviderPart, string>> = {
  login: 'provider-status',
  key: 'provider-key',
  version: 'provider-version',
  usage: 'provider-usage',
  resources: 'provider-resources',
  models: 'provider-models',
}
const PARTS = PROVIDER_PARTS.map((part) => CY[part])

/** Every part's remembered state goes, so each test starts from the first-time defaults. */
function forgetFolds(): void {
  for (const part of PROVIDER_PARTS) localStorage.removeItem(partKey(part))
}

beforeEach(forgetFolds)

afterEach(async () => {
  unmountAll()
  forgetFolds()
  Reflect.deleteProperty(window, 'api')
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

async function screen(width: number, versions?: unknown): Promise<Mounted> {
  await page.viewport(width, 900)
  providersBridge()
  if (versions !== undefined) {
    ;(window.api.runtime as { providerVersions: unknown }).providerVersions = async () => versions
  }
  const m = mount(
    SettingsScreen,
    { capabilities: null, warnings: null, clock: Date.now() },
    { width, height: 900 },
  )
  await new Promise((done) => setTimeout(done, 80))
  await nextTick()
  await drawnReady()
  return m
}

function card(m: Mounted, provider: string): HTMLElement {
  const found = m.host.querySelector<HTMLElement>(
    `[data-cy="provider-card"][data-provider="${provider}"]`,
  )
  expect(found, `no ${provider} card`).not.toBeNull()
  return found!
}

const topOf = (el: HTMLElement): number => el.getBoundingClientRect().top

describe('the providers’ cards line up part by part', () => {
  it.each(WIDTHS)('🔴 at %ipx every part starts level in both cards', async (width) => {
    const m = await screen(width)
    const claude = card(m, 'claude')
    const codex = card(m, 'codex')
    // ⚑ The premise: side by side, and the parts above really differ in height.
    expect(topOf(claude)).toBeCloseTo(topOf(codex), 0)
    expect(claude.querySelector('[data-cy="provider-version-help"]')).not.toBeNull()
    expect(codex.querySelector('[data-cy="provider-version-help"]')).toBeNull()
    expect(claude.querySelectorAll('[data-cy="provider-usage-reading"]')).toHaveLength(2)
    expect(codex.querySelectorAll('[data-cy="provider-usage-reading"]')).toHaveLength(1)

    for (const part of PARTS) {
      const mine = claude.querySelector<HTMLElement>(`[data-cy="${part}"]`)!
      const theirs = codex.querySelector<HTMLElement>(`[data-cy="${part}"]`)!
      expect(Math.abs(topOf(mine) - topOf(theirs)), `${part} at ${width}px`).toBeLessThan(0.5)
    }
    // …and the cards end level too.
    expect(claude.getBoundingClientRect().bottom).toBeCloseTo(
      codex.getBoundingClientRect().bottom,
      0,
    )
  })

  it.each(['claude', 'codex'])(
    'keeps the other card compact while setting up %s',
    async (provider) => {
      const m = await screen(WIDTHS[0])
      const other = provider === 'claude' ? 'codex' : 'claude'
      const folded = ['login', 'key'] as const
      const heights = folded.map(
        (part) => partOf(m, other, part).section.getBoundingClientRect().height,
      )
      card(m, provider).querySelector<HTMLButtonElement>('[data-cy="provider-set-up"]')!.click()
      await nextTick()
      await drawnReady()
      const setup = card(m, provider).querySelector<HTMLElement>(
        '[data-cy="provider-inline-setup"]',
      )!
      assertDrawn(setup.querySelector<HTMLElement>('h3')!, 'setup heading', m.host)
      for (const [index, part] of folded.entries()) {
        const { section, press, body } = partOf(m, other, part)
        expect(press.getAttribute('aria-expanded')).toBe('false')
        expect(shown(body)).toBe(false)
        expect(section.getBoundingClientRect().height).toBeCloseTo(heights[index]!, 0)
        assertDrawn(press, `${other} ${part}`, m.host)
      }
      expect(topOf(partOf(m, other, 'key').section)).toBeCloseTo(
        partOf(m, other, 'login').section.getBoundingClientRect().bottom,
        0,
      )
      setup.querySelector<HTMLButtonElement>('.setup-heading button')!.click()
      await nextTick()
      for (const part of PARTS) {
        expect(
          topOf(card(m, provider).querySelector<HTMLElement>(`[data-cy="${part}"]`)!),
        ).toBeCloseTo(topOf(card(m, other).querySelector<HTMLElement>(`[data-cy="${part}"]`)!), 0)
      }
    },
  )

  it('⛔ the page’s own words end above the cards, on a page taller than the window', async () => {
    const m = await screen(WIDTHS[0])
    const head = m.host.querySelector<HTMLElement>('.page-head')!
    const words = [...head.querySelectorAll<HTMLElement>('p')]
    expect(words.length).toBeGreaterThan(0)
    // ⚑ The premise: the page scrolls, which is when the heading used to be squeezed.
    const scroller = m.host.querySelector<HTMLElement>('.page')!
    expect(scroller.lastElementChild!.getBoundingClientRect().bottom).toBeGreaterThan(
      scroller.getBoundingClientRect().bottom,
    )
    const cardsTop = topOf(card(m, 'claude'))
    for (const p of words) expect(p.getBoundingClientRect().bottom).toBeLessThanOrEqual(cardsTop)
  })
})

/* ------------------------------------------------------------------ the parts fold */

/** A part's heading button and its body, in one card. */
function partOf(m: Mounted, provider: string, part: ProviderPart) {
  const section = card(m, provider).querySelector<HTMLElement>(`[data-cy="${CY[part]}"]`)!
  const press = section.querySelector<HTMLButtonElement>('h3 button.fold')!
  const body = document.getElementById(press.getAttribute('aria-controls') ?? '')
  return { section, press, body }
}

/**
 * Whether an element is drawn. ⚠️ A part's body is `display: contents` and has no box of its own,
 * so it is drawn when it is not `none` and its children draw.
 */
const shown = (el: HTMLElement | null): boolean => {
  if (el === null || getComputedStyle(el).display === 'none') return false
  if (getComputedStyle(el).display !== 'contents') return el.getClientRects().length > 0
  return [...el.children].some((child) => child.getClientRects().length > 0)
}

describe('each part folds, in every card at once, and is remembered', () => {
  it('🔴 the first time, Version and Models are folded and the rest open, in both cards', async () => {
    const m = await screen(WIDTHS[0])
    for (const provider of ['claude', 'codex']) {
      for (const part of PROVIDER_PARTS) {
        const { press, body } = partOf(m, provider, part)
        expect(press, `${provider} ${part}: no heading button`).not.toBeNull()
        expect(body, `${provider} ${part}: the button names no body`).not.toBeNull()
        expect(body!.closest(`[data-cy="${CY[part]}"]`)).not.toBeNull()
        expect(press.getAttribute('aria-expanded')).toBe(String(OPEN_AT_FIRST[part]))
        expect(shown(body), `${provider} ${part}`).toBe(OPEN_AT_FIRST[part])
      }
    }
    // ⚑ A folded part keeps its heading, and Version its chip.
    const version = partOf(m, 'claude', 'version').section
    expect(version.querySelector('h3')!.textContent).toContain('Version')
    expect(shown(version.querySelector<HTMLElement>('.bb-chip'))).toBe(true)
  })

  it('⛔ one press folds that part in both cards, the cards stay level, and it is remembered', async () => {
    const m = await screen(WIDTHS[0])
    partOf(m, 'claude', 'usage').press.click()
    await nextTick()
    for (const provider of ['claude', 'codex']) {
      const { press, body } = partOf(m, provider, 'usage')
      expect(press.getAttribute('aria-expanded')).toBe('false')
      expect(shown(body)).toBe(false)
    }
    for (const part of PARTS) {
      const mine = card(m, 'claude').querySelector<HTMLElement>(`[data-cy="${part}"]`)!
      const theirs = card(m, 'codex').querySelector<HTMLElement>(`[data-cy="${part}"]`)!
      expect(Math.abs(topOf(mine) - topOf(theirs)), part).toBeLessThan(0.5)
    }
    // ⚑ Opened again from the other card.
    partOf(m, 'codex', 'version').press.click()
    await nextTick()
    expect(shown(partOf(m, 'claude', 'version').body)).toBe(true)

    // ⚑ The next visit draws what was left.
    unmountAll()
    const again = await screen(WIDTHS[0])
    expect(partOf(again, 'claude', 'usage').press.getAttribute('aria-expanded')).toBe('false')
    expect(partOf(again, 'codex', 'version').press.getAttribute('aria-expanded')).toBe('true')
  })

  it('⚑ a heading is a button a key reaches, named by its word', async () => {
    const m = await screen(WIDTHS[0])
    const { press } = partOf(m, 'codex', 'models')
    expect(press.tagName).toBe('BUTTON')
    expect(press.type).toBe('button')
    expect(press.tabIndex).toBe(0)
    expect(press.textContent?.trim()).toBe('Models')
    press.focus()
    expect(document.activeElement).toBe(press)
  })

  it('🔴 a part with something wrong to say opens itself, though it was folded', async () => {
    // ⚑ Version starts folded; Claude's program is older than the versions BroBot was tested with.
    const read = (await (async () => {
      providersBridge()
      return window.api.runtime.providerVersions()
    })()) as unknown as Record<string, { program: Record<string, unknown> }>
    const older = {
      ...read,
      claude: {
        ...read['claude'],
        program: { ...read['claude']!.program, standing: 'older-than-tested' },
      },
    }
    const m = await screen(WIDTHS[0], older)
    expect(partOf(m, 'claude', 'version').press.getAttribute('aria-expanded')).toBe('true')
    expect(shown(partOf(m, 'claude', 'version').body)).toBe(true)
    // ⚑ The control: with nothing wrong, the same part stays folded.
    unmountAll()
    forgetFolds()
    const quiet = await screen(WIDTHS[0])
    expect(partOf(quiet, 'claude', 'version').press.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the page’s own sections fold too, and a card has a row per part', () => {
  it('🔴 Kept rules folds under its heading, and is remembered', async () => {
    localStorage.removeItem('brobot2.providers.open.kept-rules')
    const m = await screen(WIDTHS[0])
    const press = m.q('kept-rules-fold') as HTMLButtonElement
    const body = document.getElementById(press.getAttribute('aria-controls') ?? '')
    expect(press.textContent?.trim()).toBe('Kept rules')
    expect(press.getAttribute('aria-expanded')).toBe('true')
    expect(shown(body)).toBe(true)
    expect(m.q('kept-rules').textContent).toContain('None kept.')

    press.click()
    await nextTick()
    expect(press.getAttribute('aria-expanded')).toBe('false')
    expect(shown(body)).toBe(false)
    expect(shown(m.q('kept-rules-provider'))).toBe(false)

    unmountAll()
    const again = await screen(WIDTHS[0])
    expect(again.q('kept-rules-fold').getAttribute('aria-expanded')).toBe('false')
    localStorage.removeItem('brobot2.providers.open.kept-rules')
  })

  it('⚑ a card spans one row for its top and one per part', async () => {
    const m = await screen(WIDTHS[0])
    expect(getComputedStyle(card(m, 'claude')).gridRowStart).toBe(
      `span ${String(PROVIDER_PARTS.length + 1)}`,
    )
  })
})
