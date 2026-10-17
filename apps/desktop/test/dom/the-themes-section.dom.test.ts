import { nextTick } from 'vue'
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
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
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
