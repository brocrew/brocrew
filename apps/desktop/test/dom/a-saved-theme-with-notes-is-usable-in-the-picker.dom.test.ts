import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemesSection from '../../src/renderer/src/components/ThemesSection.vue'
import type { ThemeReading, ThemeSnapshot, ThemesBridge } from '../../src/shared/theme-library'
import { mount, unmountAll } from './harness'

/**
 * A person's own theme that loads, with what the readability check now says about it: the picker
 * shows the note in the check's own words, and the theme can still be used.
 */

const NOTE =
  'Links on the page would be too faint: 3.9 to 1 against the page, and it needs at least 4.5 to 1. Change `content.accent`.'

afterEach(unmountAll)

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
        problems: [{ at: 'content.accent', says: NOTE }],
        reason: NOTE,
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
    set: vi.fn(async (id: string) => ({ outcome: 'ok' as const, active: id, previous: 'classic' })),
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

describe('a saved theme the readability check now has notes on', () => {
  it('shows the note in the check’s own words, and can still be used', async () => {
    const themes = bridge()
    const m = mount(ThemesSection, { themes }, { width: 900 })
    await settle()
    const card = m.host.querySelector<HTMLElement>('[data-theme-id="my-brocrew"]')!
    expect(card.classList.contains('refused')).toBe(false)
    expect(card.querySelector('[data-cy="theme-refused"]')).toBeNull()
    expect(card.querySelector('[data-cy="theme-notes"]')?.textContent?.trim()).toBe(NOTE)
    const use = card.querySelector<HTMLButtonElement>('[data-cy="theme-use"]')!
    expect(use.disabled).toBe(false)
    use.click()
    await settle()
    expect(themes.set).toHaveBeenCalledWith('my-brocrew')
  })
})
