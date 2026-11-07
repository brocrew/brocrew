import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemesSection from '../../src/renderer/src/components/ThemesSection.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { validateTheme } from '../../src/shared/themes/validate'
import type { ThemeReading, ThemeSnapshot, ThemesBridge } from '../../src/shared/theme-library'
import { mount, unmountAll } from './harness'

afterEach(() => {
  applyTheme(null)
  unmountAll()
})

const FILE = {
  format: 1,
  id: 'my-brocrew',
  name: 'My BroCrew',
  content: { ink: '#ffffff', paper: '#ffffff', accent: '#ffffff' },
}

function bridge(): ThemesBridge {
  const snapshot = (): ThemeSnapshot => ({
    active: 'classic',
    requested: 'classic',
    themes: [
      { id: 'classic', name: 'Classic', source: 'built-in', status: 'ok' },
      {
        id: 'my-brocrew',
        name: 'My BroCrew',
        source: 'mine',
        status: 'ok',
      },
    ],
  })
  const reading = (id: string): ThemeReading => ({
    active: 'classic',
    theme: id === 'my-brocrew' ? { format: 1, id, name: 'My BroCrew' } : null,
    version: null,
    assetVersions: {},
  })
  return {
    list: vi.fn(async () => snapshot()),
    read: vi.fn(async (id?: string) => reading(id ?? 'classic')),
    set: vi.fn(async (id: string) => {
      const result = validateTheme(FILE, { assets: new Map(), builtIns: new Map() })
      if (!result.ok) throw new Error(JSON.stringify(result.problems))
      expect(applyTheme(result.theme)).toEqual({ ok: true, id })
      return { outcome: 'ok' as const, active: id, previous: 'classic' }
    }),
    duplicate: vi.fn(),
    delete: vi.fn(),
    openFolder: vi.fn(),
    onChanged: () => () => undefined,
  } as unknown as ThemesBridge
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await nextTick()
  await new Promise((done) => setTimeout(done, 0))
}

describe('a low-contrast saved theme', () => {
  it('can be selected and painted without a contrast note', async () => {
    const themes = bridge()
    const m = mount(ThemesSection, { themes }, { width: 900 })
    await settle()
    const card = m.host.querySelector<HTMLElement>('[data-theme-id="my-brocrew"]')!
    expect(card.classList.contains('refused')).toBe(false)
    expect(card.querySelector('[data-cy="theme-refused"]')).toBeNull()
    expect(card.querySelector('[data-cy="theme-notes"]')).toBeNull()
    const use = card.querySelector<HTMLButtonElement>('[data-cy="theme-use"]')!
    expect(use.disabled).toBe(false)
    use.click()
    await settle()
    expect(themes.set).toHaveBeenCalledWith('my-brocrew')
    expect(document.documentElement.getAttribute('data-theme')).toBe('my-brocrew')
    expect(document.getElementById('brobot-theme')?.textContent).toContain(
      '--content-ink: #ffffff;',
    )
  })
})
