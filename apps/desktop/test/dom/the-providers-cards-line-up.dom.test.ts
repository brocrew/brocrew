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

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const WIDTHS = [1180, 760] as const
const CY: Readonly<Record<ProviderPart, string>> = {
  login: 'provider-status',
  key: 'provider-key',
  version: 'provider-version',
  usage: 'provider-usage',
  resources: 'provider-resources',
  models: 'provider-models',
}
function forgetFolds(): void {
  for (const part of PROVIDER_PARTS) localStorage.removeItem(partKey(part))
  localStorage.removeItem('brobot2.providers.open.kept-rules')
}
beforeEach(forgetFolds)
afterEach(async () => {
  unmountAll()
  forgetFolds()
  Reflect.deleteProperty(window, 'api')
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})
async function screen(width: number, versions?: unknown, height = 900): Promise<Mounted> {
  await page.viewport(width, height)
  providersBridge()
  if (versions !== undefined)
    (window.api.runtime as { providerVersions: unknown }).providerVersions = async () => versions
  const m = mount(
    SettingsScreen,
    { capabilities: null, warnings: null, clock: Date.now() },
    { width, height },
  )
  await new Promise((done) => setTimeout(done, 80))
  await nextTick()
  await drawnReady()
  return m
}
function row(m: Mounted, provider: string): HTMLButtonElement {
  const found = m.host.querySelector<HTMLButtonElement>(
    `[data-cy="provider-row"][data-provider="${provider}"]`,
  )
  expect(found).not.toBeNull()
  return found!
}
async function close(m: Mounted): Promise<void> {
  m.q('provider-drawer').querySelector<HTMLButtonElement>('.drawer-close')!.click()
  await nextTick()
  await drawnReady()
}
async function open(m: Mounted, provider: string): Promise<HTMLElement> {
  if (m.all('provider-drawer').length) await close(m)
  row(m, provider).click()
  await nextTick()
  await drawnReady()
  const found = m
    .q('provider-drawer')
    .querySelector<HTMLElement>(`[data-cy="provider-card"][data-provider="${provider}"]`)
  expect(found).not.toBeNull()
  return found!
}
async function partOf(m: Mounted, provider: string, part: ProviderPart) {
  const section = (await open(m, provider)).querySelector<HTMLElement>(`[data-cy="${CY[part]}"]`)!
  const press = section.querySelector<HTMLButtonElement>('h3 button.fold')!
  const body = document.getElementById(press.getAttribute('aria-controls') ?? '')
  return { section, press, body }
}
const shown = (el: HTMLElement | null): boolean => {
  if (el === null || getComputedStyle(el).display === 'none') return false
  if (getComputedStyle(el).display !== 'contents') return el.getClientRects().length > 0
  return [...el.children].some((child) => child.getClientRects().length > 0)
}

describe('the Providers rows fit and the selected drawer reuses every part', () => {
  it.each(WIDTHS)('at %ipx rows share an edge without horizontal overflow', async (width) => {
    const m = await screen(width)
    const rows = m.all('provider-row')
    expect(rows).toHaveLength(2)
    const bounds = rows.map((el) => el.getBoundingClientRect())
    expect(bounds[0]!.left).toBeCloseTo(bounds[1]!.left, 1)
    expect(bounds[0]!.right).toBeCloseTo(bounds[1]!.right, 1)
    expect(bounds[0]!.right).toBeLessThanOrEqual(m.host.getBoundingClientRect().right)
    expect(m.q('providers-screen').scrollWidth).toBeLessThanOrEqual(
      m.q('providers-screen').clientWidth,
    )
    expect(m.all('provider-card')).toHaveLength(0)
    for (const provider of ['claude', 'codex']) {
      const card = await open(m, provider)
      expect(m.all('provider-card')).toHaveLength(1)
      for (const part of PROVIDER_PARTS)
        expect(card.querySelector(`[data-cy="${CY[part]}"]`)).not.toBeNull()
      expect(m.q('provider-drawer').getBoundingClientRect().right).toBeLessThanOrEqual(
        m.host.getBoundingClientRect().right,
      )
    }
  })
  it.each(['claude', 'codex'])(
    'setup for %s does not stretch the background rows',
    async (provider) => {
      const m = await screen(WIDTHS[0])
      const other = provider === 'claude' ? 'codex' : 'claude'
      const height = row(m, other).getBoundingClientRect().height
      await open(m, provider)
      m.q('provider-options').click()
      await nextTick()
      m.q('provider-set-up').click()
      await nextTick()
      await drawnReady()
      assertDrawn(
        m.q('provider-inline-setup').querySelector<HTMLElement>('h3')!,
        'setup heading',
        m.host,
      )
      expect(row(m, other).getBoundingClientRect().height).toBeCloseTo(height, 0)
      expect(m.all('provider-card')).toHaveLength(1)
    },
  )
  it('the page’s own words end above rows even when the page must scroll', async () => {
    const m = await screen(WIDTHS[0], undefined, 220)
    const scroller = m.host.querySelector<HTMLElement>('.page')!
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    const first = row(m, 'claude').getBoundingClientRect().top
    for (const words of m.host.querySelectorAll<HTMLElement>('.page-head p'))
      expect(words.getBoundingClientRect().bottom).toBeLessThanOrEqual(first)
  })
})

describe('the same part-fold preferences apply in each provider drawer', () => {
  it('the first visit keeps Version and Models folded and the other parts open', async () => {
    const m = await screen(WIDTHS[0])
    for (const provider of ['claude', 'codex']) {
      const card = await open(m, provider)
      for (const part of PROVIDER_PARTS) {
        const section = card.querySelector<HTMLElement>(`[data-cy="${CY[part]}"]`)!
        const press = section.querySelector<HTMLButtonElement>('h3 button.fold')!
        const body = document.getElementById(press.getAttribute('aria-controls') ?? '')
        expect(body).not.toBeNull()
        expect(body!.closest(`[data-cy="${CY[part]}"]`)).not.toBeNull()
        expect(press.getAttribute('aria-expanded')).toBe(String(OPEN_AT_FIRST[part]))
        expect(shown(body), `${provider} ${part}`).toBe(OPEN_AT_FIRST[part])
      }
      expect(shown(card.querySelector('[data-cy="provider-version"] .bb-chip'))).toBe(true)
    }
  })
  it('a folded part stays folded for the other provider and the next visit', async () => {
    const m = await screen(WIDTHS[0])
    ;(await partOf(m, 'claude', 'usage')).press.click()
    await nextTick()
    const codex = await partOf(m, 'codex', 'usage')
    expect(codex.press.getAttribute('aria-expanded')).toBe('false')
    expect(shown(codex.body)).toBe(false)
    ;(await partOf(m, 'codex', 'version')).press.click()
    await nextTick()
    expect(shown((await partOf(m, 'claude', 'version')).body)).toBe(true)
    unmountAll()
    const again = await screen(WIDTHS[0])
    expect((await partOf(again, 'claude', 'usage')).press.getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect((await partOf(again, 'codex', 'version')).press.getAttribute('aria-expanded')).toBe(
      'true',
    )
  })
  it('a heading remains a keyboard-reachable button named by its word', async () => {
    const m = await screen(WIDTHS[0])
    const { press } = await partOf(m, 'codex', 'models')
    expect(press.tagName).toBe('BUTTON')
    expect(press.type).toBe('button')
    expect(press.tabIndex).toBe(0)
    expect(press.textContent?.trim()).toBe('Models')
    press.focus()
    expect(document.activeElement).toBe(press)
  })
  it('a folded part with a new warning still opens itself', async () => {
    providersBridge()
    const read = await window.api.runtime.providerVersions()
    const older = {
      ...read,
      claude: {
        ...read.claude,
        program: { ...read.claude.program!, standing: 'older-than-tested' },
      },
    }
    const m = await screen(WIDTHS[0], older)
    const warned = await partOf(m, 'claude', 'version')
    expect(warned.press.getAttribute('aria-expanded')).toBe('true')
    expect(shown(warned.body)).toBe(true)
    unmountAll()
    forgetFolds()
    const quiet = await screen(WIDTHS[0])
    expect((await partOf(quiet, 'claude', 'version')).press.getAttribute('aria-expanded')).toBe(
      'false',
    )
  })
  it('Kept rules folds under its heading and is remembered', async () => {
    const m = await screen(WIDTHS[0])
    await open(m, 'codex')
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
    await open(again, 'codex')
    expect(again.q('kept-rules-fold').getAttribute('aria-expanded')).toBe('false')
  })
  it('the drawer uses the real card’s bodies without its old frame', async () => {
    const m = await screen(WIDTHS[0])
    const card = await open(m, 'claude')
    expect(card.classList.contains('frameless')).toBe(true)
    expect(getComputedStyle(card).borderTopWidth).toBe('0px')
    expect(getComputedStyle(card).boxShadow).toBe('none')
    expect(card.querySelector('.card-head')).toBeNull()
  })
})
