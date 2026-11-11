import { defineComponent, h, nextTick, provide, shallowRef } from 'vue'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemesSection from '../../src/renderer/src/components/ThemesSection.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import type {
  ThemeChanged,
  ThemeReading,
  ThemeSnapshot,
  ThemesBridge,
} from '../../src/shared/theme-library'
import type { Theme } from '../../src/shared/themes/theme'
import { mount, unmountAll } from './harness'

/**
 * The Themes section in a real engine, fed by a bridge that answers like the host: its cards, what
 * each one offers, and previews that show their own theme whatever the window wears.
 */

const ZEN: Theme = {
  format: 1,
  id: 'zen',
  name: 'Zen',
  frame: { paper: '#17213a' },
}
const MINE: Theme = {
  format: 1,
  id: 'mine',
  name: 'Mine',
  frame: { paper: '#008080' },
}

function fakeBridge(active = 'classic') {
  const listeners: ((c: ThemeChanged) => void)[] = []
  const snapshot = (): ThemeSnapshot => ({
    active,
    requested: active,
    themes: [
      { id: 'classic', name: 'Classic', source: 'built-in', status: 'ok' },
      { id: 'zen', name: 'Zen', source: 'built-in', status: 'ok' },
      { id: 'mine', name: 'Mine', source: 'mine', status: 'ok' },
      {
        id: 'broken',
        name: 'broken',
        source: 'mine',
        status: 'refused',
        reason: 'The theme file is not valid JSON.',
      },
    ],
  })
  const reading = (id: string): ThemeReading => ({
    active,
    theme: id === 'zen' ? ZEN : id === 'mine' ? MINE : null,
    version: null,
    assetVersions: {},
  })
  const themes: ThemesBridge = {
    list: vi.fn(async () => snapshot()),
    read: vi.fn(async (id?: string) => reading(id ?? active)),
    set: vi.fn(async (id: string) => {
      const previous = active
      active = id
      listeners.forEach((l) => l({ ...snapshot(), previous }))
      return { outcome: 'ok' as const, active, previous }
    }),
    duplicate: vi.fn(async (id: string) => ({
      outcome: 'ok' as const,
      id: `${id}-copy`,
      version: 'v',
      active,
      warnings: [],
    })),
    delete: vi.fn(async (id: string) => ({ outcome: 'ok' as const, id, active })),
    openFolder: vi.fn(async () => ({ outcome: 'ok' as const })),
    onChanged: (listener) => {
      listeners.push(listener)
      return () => void listeners.splice(listeners.indexOf(listener), 1)
    },
  }
  return themes
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((done) => setTimeout(done, 0))
    await nextTick()
  }
  // IntersectionObserver delivers visible cards after layout.
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((done) => requestAnimationFrame(() => done()))
    await nextTick()
  }
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

describe('the Themes section', () => {
  it('shows a card per theme, marks the one in use, and offers only what each can do', async () => {
    const m = mount(ThemesSection, { themes: fakeBridge('zen') }, { width: 900 })
    await settle()
    const card = (id: string) => m.host.querySelector<HTMLElement>(`[data-theme-id="${id}"]`)!
    expect(m.all('theme-card').map((c) => c.dataset.themeId)).toEqual([
      'classic',
      'zen',
      'mine',
      'broken',
    ])
    expect(card('zen').querySelector('[data-cy="theme-in-use"]')).not.toBeNull()
    expect(card('zen').querySelector('[data-cy="theme-use"]')).toBeNull()
    expect(card('classic').querySelector('[data-cy="theme-delete"]')).toBeNull()
    expect(card('mine').querySelector('[data-cy="theme-delete"]')).not.toBeNull()
    expect(card('broken').querySelector<HTMLButtonElement>('[data-cy="theme-use"]')!.disabled).toBe(
      true,
    )
    expect(card('broken').querySelector('[data-cy="theme-refused"]')!.textContent).toContain(
      'The theme file is not valid JSON.',
    )
  })

  it('Use switches, and the section follows the change', async () => {
    const themes = fakeBridge('classic')
    const m = mount(ThemesSection, { themes }, { width: 900 })
    await settle()
    m.host.querySelector<HTMLElement>('[data-theme-id="mine"] [data-cy="theme-use"]')!.click()
    await settle()
    expect(themes.set).toHaveBeenCalledWith('mine')
    expect(m.host.querySelector('[data-theme-id="mine"] [data-cy="theme-in-use"]')).not.toBeNull()
  })

  it('a preview shows its own theme, not the one the window wears', async () => {
    applyTheme({ format: 1, id: 'retro-desktop', name: 'W', frame: { paper: '#c0c0c0' } })
    const m = mount(ThemesSection, { themes: fakeBridge('classic') }, { width: 900 })
    await settle()
    const rail = (id: string) =>
      getComputedStyle(m.host.querySelector(`[data-theme-id="${id}"] .mini-rail`)!).backgroundColor
    expect(rail('zen')).toBe('rgb(23, 33, 58)')
    expect(rail('mine')).toBe('rgb(0, 128, 128)')
    expect(rail('classic')).not.toBe('rgb(192, 192, 192)')
  })

  it('previews are pictures: they take no pointer and are hidden from a reader', async () => {
    const m = mount(ThemesSection, { themes: fakeBridge() }, { width: 900 })
    await settle()
    for (const mini of m.host.querySelectorAll<HTMLElement>('.mini')) {
      expect(getComputedStyle(mini).pointerEvents).toBe('none')
      expect(mini.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('its preview stylesheet leaves with it', async () => {
    const m = mount(ThemesSection, { themes: fakeBridge() }, { width: 900 })
    await settle()
    expect(document.querySelectorAll('style[data-theme-previews]')).toHaveLength(1)
    m.unmount()
    expect(document.querySelectorAll('style[data-theme-previews]')).toHaveLength(0)
  })
})


function injectedThemes(initial?: ThemesBridge, explicit?: ThemesBridge) {
  let current = initial
  const prop = shallowRef(explicit)
  const raw = vi.fn((): never => { throw new Error('Raw theme bridge must stay unused') })
  Reflect.set(window, 'api', { themes: { list: raw, read: raw, set: raw, duplicate: raw,
    delete: raw, openFolder: raw, onChanged: raw } })
  const supplier = vi.fn(() => current)
  const client = createDesktopProviderApi(
    raw, () => undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, supplier,
  )
  expect(supplier).not.toHaveBeenCalled()
  const owner = defineComponent({ setup() {
    provide(CLIENT_PROVIDERS, client)
    return () => h(ThemesSection, { themes: prop.value })
  } })
  const m = mount(owner, {}, { width: 900 })
  return { m, prop, raw, supplier, replace: (next?: ThemesBridge) => { current = next } }
}

describe('injected Themes capability', () => {
  it('reads and sends all card actions through the ancestor with receivers intact', async () => {
    const themes = fakeBridge()
    const { m, raw } = injectedThemes(themes)
    await settle()
    expect(vi.mocked(themes.list).mock.contexts[0]).toBe(themes)
    expect(themes.read).toHaveBeenCalledWith('zen', { refresh: false })
    const button = (cy: string) => m.host.querySelector<HTMLElement>(`[data-theme-id="mine"] [data-cy="${cy}"]`)!
    button('theme-use').click()
    await settle()
    button('theme-duplicate').click()
    await settle()
    button('theme-delete').click()
    await settle()
    m.q('themes-open-folder').click()
    await settle()
    expect(themes.set).toHaveBeenCalledWith('mine')
    expect(themes.duplicate).toHaveBeenCalledWith('mine', expect.any(String))
    expect(themes.delete).toHaveBeenCalledWith('mine')
    expect(themes.openFolder).toHaveBeenCalledTimes(1)
    for (const method of [themes.set, themes.duplicate, themes.delete, themes.openFolder])
      expect(vi.mocked(method).mock.contexts[0]).toBe(themes)
    expect(raw).not.toHaveBeenCalled()
  })

  it('uses live explicit props first and returns to the current injected capability on removal', async () => {
    const injected = fakeBridge()
    const first = fakeBridge('zen')
    const second = fakeBridge('mine')
    const { m, prop, supplier, replace, raw } = injectedThemes(injected, first)
    await settle()
    expect(supplier).not.toHaveBeenCalled()
    prop.value = second
    await settle()
    m.q('themes-open-folder').click()
    await settle()
    expect(second.openFolder).toHaveBeenCalledTimes(1)
    expect(first.openFolder).not.toHaveBeenCalled()
    expect(supplier).not.toHaveBeenCalled()
    const replacement = fakeBridge('zen')
    replace(replacement)
    prop.value = undefined
    await settle()
    m.q('themes-open-folder').click()
    await settle()
    expect(replacement.openFolder).toHaveBeenCalledTimes(1)
    expect(replacement.list).toHaveBeenCalledTimes(1)
    expect(injected.list).not.toHaveBeenCalled()
    expect(raw).not.toHaveBeenCalled()
  })

  it('keeps absent injected themes absent, including the existing loading state', async () => {
    const { m, raw } = injectedThemes()
    await settle()
    expect(m.all('themes-loading')).toHaveLength(1)
    expect(m.all('theme-card')).toHaveLength(0)
    m.q('themes-open-folder').click()
    await settle()
    expect(m.all('themes-loading')).toHaveLength(1)
    expect(m.all('themes-refused')).toHaveLength(0)
    expect(raw).not.toHaveBeenCalled()
  })

  it('preserves action refusal words and list errors from the injected bridge', async () => {
    const themes = fakeBridge()
    const { m, raw } = injectedThemes(themes)
    await settle()
    vi.mocked(themes.openFolder).mockRejectedValueOnce(new Error('Folder could not open'))
    m.q('themes-open-folder').click()
    await settle()
    expect(m.q('themes-refused').textContent).toBe('Folder could not open')
    vi.mocked(themes.list).mockRejectedValueOnce(new Error('Theme list could not be read'))
    m.q('themes-open-folder').click()
    await settle()
    expect(m.q('themes-unread').textContent).toBe('Theme list could not be read')
    expect(raw).not.toHaveBeenCalled()
  })

  it('lets a late injected list go without rebuilding styles or starting previews', async () => {
    const themes = fakeBridge()
    let finish!: (snapshot: ThemeSnapshot) => void
    vi.mocked(themes.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { m, raw } = injectedThemes(themes)
    m.unmount()
    finish({ active: 'classic', requested: 'classic', themes: [] })
    await settle()
    expect(themes.read).not.toHaveBeenCalled()
    expect(document.querySelectorAll('style[data-theme-previews]')).toHaveLength(0)
    expect(raw).not.toHaveBeenCalled()
  })

  it('retains the default desktop theme capability when no ancestor overrides it', async () => {
    const themes = fakeBridge()
    Reflect.set(window, 'api', { themes })
    const m = mount(ThemesSection, {}, { width: 900 })
    await settle()
    expect(themes.list).toHaveBeenCalledTimes(1)
    m.q('themes-open-folder').click()
    await settle()
    expect(themes.openFolder).toHaveBeenCalledTimes(1)
  })
})
