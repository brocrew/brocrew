import { describe, expect, it } from 'vitest'
import type { ThemeChanged, ThemeRow } from '../../src/shared/theme-library'
import { createOverlayStore } from '../../src/renderer/src/lib/overlay-store'
import { themeChangeNotices } from '../../src/renderer/src/lib/theme-change-notice'

const rows: ThemeRow[] = [
  { id: 'classic', name: 'Classic', source: 'built-in', status: 'ok' },
  { id: 'zen', name: 'Zen', source: 'built-in', status: 'ok' },
  { id: 'retro-desktop', name: 'Retro Desktop', source: 'built-in', status: 'ok' },
]
const change = (over: Partial<ThemeChanged>): ThemeChanged => ({
  active: 'retro-desktop',
  requested: 'retro-desktop',
  themes: rows,
  previous: 'zen',
  actor: 'Research',
  ...over,
})

describe('an agent’s theme change is explained, with no button', () => {
  it('says who changed it and to what; a person’s change says nothing', () => {
    const overlays = createOverlayStore(() => undefined)
    const notice = themeChangeNotices(overlays)
    notice(change({ actor: undefined }))
    expect(overlays.toasts.value).toEqual([])
    notice(change({}))
    expect(overlays.toasts.value).toEqual([
      { id: expect.any(Number), text: 'Research changed the theme to Retro Desktop.' },
    ])
  })

  it('a newer change closes the notice of an older one', () => {
    const overlays = createOverlayStore(() => undefined)
    const notice = themeChangeNotices(overlays)
    notice(change({}))
    notice(change({ active: 'zen', previous: 'retro-desktop', actor: undefined }))
    expect(overlays.toasts.value).toEqual([])
    notice(change({}))
    notice(change({ active: 'classic', previous: 'retro-desktop', actor: 'Design' }))
    expect(overlays.toasts.value.map((t) => t.text)).toEqual([
      'Design changed the theme to Classic.',
    ])
  })
})
