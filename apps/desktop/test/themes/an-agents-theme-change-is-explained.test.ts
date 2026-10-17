import { describe, expect, it } from 'vitest'
import type { ThemeChanged, ThemeRow } from '../../src/shared/theme-library'
import { createOverlayStore } from '../../src/renderer/src/lib/overlay-store'
import { themeChangeNotices } from '../../src/renderer/src/lib/theme-change-notice'

const rows: ThemeRow[] = [
  { id: 'classic', name: 'Classic', source: 'built-in', status: 'ok' },
  { id: 'zen', name: 'Zen', source: 'built-in', status: 'ok' },
  { id: 'win95', name: 'Windows 95', source: 'built-in', status: 'ok' },
]
const change = (over: Partial<ThemeChanged>): ThemeChanged => ({
  active: 'win95',
  requested: 'win95',
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
      { id: expect.any(Number), text: 'Research changed the theme to Windows 95.' },
    ])
  })

  it('a newer change closes the notice of an older one', () => {
    const overlays = createOverlayStore(() => undefined)
    const notice = themeChangeNotices(overlays)
    notice(change({}))
    notice(change({ active: 'zen', previous: 'win95', actor: undefined }))
    expect(overlays.toasts.value).toEqual([])
    notice(change({}))
    notice(change({ active: 'classic', previous: 'win95', actor: 'Design' }))
    expect(overlays.toasts.value.map((t) => t.text)).toEqual([
      'Design changed the theme to Classic.',
    ])
  })
})
