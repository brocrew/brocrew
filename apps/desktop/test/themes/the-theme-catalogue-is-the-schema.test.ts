import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { themeCatalogue } from '../../src/shared/themes/catalogue'
import { HELD_SETTINGS, overridableIn } from '../../src/shared/themes/schema'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor } from './fixtures'

describe('the catalogue an agent reads', () => {
  const catalogue = themeCatalogue()

  it('lists every setting the window paints, with its type and purpose', () => {
    const paths = catalogue.settings.map((s) => s.path)
    for (const path of [
      'frame.ink',
      'content.accent2',
      'shared.shadow.strength',
      'shared.textBase',
      'kinds',
      'tokens',
      'localOnly',
    ]) {
      expect(paths).toContain(path)
    }
    for (const s of catalogue.settings) {
      expect(s.type, s.path).not.toBe('')
      expect(s.says, s.path).not.toBe('')
    }
  })

  it('says a number’s bounds and a choice’s values', () => {
    const by = Object.fromEntries(catalogue.settings.map((s) => [s.path, s.type]))
    expect(by['shared.borderWidth']).toBe('number from 1px to 2px, whole')
    expect(by['content.scheme']).toBe('one of "light", "dark"')
    expect(by['shared.fonts.body']).toBe('list of 1–4 installed font names')
  })

  it('⛔ leaves out every setting the window doesn’t paint yet, and the effects grammar only they use', () => {
    const paths = catalogue.settings.map((s) => s.path)
    for (const held of HELD_SETTINGS) {
      expect(
        paths.filter((p) => p === held || p.startsWith(`${held}.`)),
        held,
      ).toEqual([])
    }
    expect(catalogue).not.toHaveProperty('effects')
    expect(catalogue).not.toHaveProperty('sprites')
  })

  it('describes the background grammar, which the window’s background takes', () => {
    const by = Object.fromEntries(catalogue.settings.map((s) => [s.path, s.type]))
    expect(by['window.background']).toBe('background (see `background`)')
    expect(catalogue.background).toMatch(/^A background is a colour/)
  })

  it('is plain data an agent tool can send as JSON', () => {
    expect(JSON.parse(JSON.stringify(catalogue))).toEqual(catalogue)
  })
})

describe('every colour token a theme may set by hand is a token the window declares', () => {
  const tokens = readFileSync(join(__dirname, '../../src/renderer/src/assets/tokens.css'), 'utf8')
  it.each([...overridableIn('content')])('--%s', (name) => {
    expect(tokens).toMatch(new RegExp(`^\\s*--${name}\\s*:`, 'm'))
  })
})

describe('tokens only the content draws are offered for the content only', () => {
  it('the catalogue lists it under the content, not the frame', () => {
    const { tokens } = themeCatalogue()
    for (const name of ['accent-2-text', 'accent-solid-bg']) {
      expect(tokens.content).toContain(name)
      expect(tokens.frame).not.toContain(name)
    }
    for (const name of tokens.frame) expect(tokens.content).toContain(name)
  })

  it('⛔ the solid fill set under the frame is refused as no theme setting', () => {
    const read = validateTheme(
      {
        format: 1,
        id: 'frame-solid',
        name: 'Frame solid',
        extends: 'defined',
        tokens: { frame: { 'accent-solid-bg': '#cf4719' } },
      },
      { ...contextFor(), readsHeld: false },
    )
    expect(read.ok ? [] : read.problems.map((p) => p.at)).toEqual(['tokens.frame.accent-solid-bg'])
    if (!read.ok)
      expect(read.problems[0]!.says).toMatch(
        /^`tokens\.frame\.accent-solid-bg` isn’t a theme setting\./,
      )
  })

  it('⛔ set under the frame, it is refused as no theme setting', () => {
    const read = validateTheme(
      {
        format: 1,
        id: 'frame-token',
        name: 'Frame token',
        extends: 'defined',
        tokens: { frame: { 'accent-2-text': '#565bb5' } },
      },
      { ...contextFor(), readsHeld: false },
    )
    expect(read.ok ? [] : read.problems).toEqual([
      {
        at: 'tokens.frame.accent-2-text',
        says: '`tokens.frame.accent-2-text` isn’t a theme setting. Did you mean `tokens.frame.accent-text`?',
      },
    ])
  })
})
