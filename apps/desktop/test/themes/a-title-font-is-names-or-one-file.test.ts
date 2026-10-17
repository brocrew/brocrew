import { describe, expect, it } from 'vitest'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor } from './fixtures'

/**
 * A title or brand font, as the catalogue says: one to four installed font names, or exactly one
 * font file from the theme's folder. Two files, or a file with names beside it, are refused.
 */

const APP = { ...contextFor(), readsHeld: false }

describe('a title or brand font is installed names or one font file', () => {
  const FILES = {
    'assets/fonts/a.woff2': { type: 'woff2' as const, bytes: 20_000 },
    'assets/fonts/b.woff2': { type: 'woff2' as const, bytes: 20_000 },
  }
  const read = (font: string[]) =>
    validateTheme(
      { format: 1, id: 'fonts', name: 'Fonts', extends: 'defined', type: { display: { font } } },
      { ...APP, assets: new Map(Object.entries(FILES)) },
    )
  const SAYS = '`type.display.font`: use 1–4 installed font names, or one font file.'

  it('⛔ two font files are refused', () => {
    expect(read(['assets/fonts/a.woff2', 'assets/fonts/b.woff2'])).toEqual({
      ok: false,
      problems: [{ at: 'type.display.font', says: SAYS }],
    })
  })

  it('⛔ a font file with a name beside it is refused', () => {
    expect(read(['assets/fonts/a.woff2', 'Avenir Next'])).toEqual({
      ok: false,
      problems: [{ at: 'type.display.font', says: SAYS }],
    })
  })

  it('one font file is accepted', () => {
    expect(read(['assets/fonts/a.woff2'])).toMatchObject({ ok: true })
  })

  it('one to four installed names are accepted', () => {
    expect(read(['Avenir Next', 'Avenir', 'Inter', 'sans-serif'])).toMatchObject({ ok: true })
  })
})
