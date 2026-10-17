import { describe, expect, it } from 'vitest'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor } from './fixtures'

/**
 * A theme's solid accent style fills primary buttons with the accent and writes their text in the
 * zone's paper. The readability check measures that pair in both zones; the shadow style changes no
 * text's background, so it never changes what the check says.
 */

const APP = { ...contextFor(), readsHeld: false }

/** A theme over `defined` with `own` settings. */
const theme = (own: Record<string, unknown>) => ({
  format: 1,
  id: 'solid',
  name: 'Solid',
  extends: 'defined',
  ...own,
})

/** Accents that pass every check as tinted, but are too light behind the paper's text. */
const LIGHT_ACCENTS = {
  content: { ink: '#1b2238', paper: '#ffffff', accent: '#2f9e44' },
  frame: { ink: '#e3e8f4', paper: '#182135', accent: '#5c6bc0' },
  tokens: {
    frame: { 'accent-text': '#c5cbff' },
    content: { 'accent-text': '#1f6b2e', 'paper-link': '#1f6b2e', 'focus-ring-color': '#1f6b2e' },
  },
}

describe('a solid button keeps its text readable', () => {
  it('the shipped base passes as solid in both zones', () => {
    expect(validateTheme(theme({ shared: { accentStyle: 'solid' } }), APP)).toMatchObject({
      ok: true,
    })
  })

  it('⚑ as tinted, only the content’s always-solid controls refuse them: the control for the refusals below', () => {
    // The content draws segmented tabs, send buttons and running chips solid whatever the style;
    // the left menu draws a solid fill only under the solid style.
    const read = validateTheme(theme(LIGHT_ACCENTS), APP)
    expect(read.ok ? [] : read.problems.map((p) => p.at)).toEqual(['content.accent'])
    if (!read.ok)
      expect(read.problems[0]!.says).toMatch(/^Text on solid buttons would be too faint/)
  })

  it('⛔ …and are refused as solid, in each zone, in the approved words', () => {
    const read = validateTheme(theme({ ...LIGHT_ACCENTS, shared: { accentStyle: 'solid' } }), APP)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.problems.map((p) => p.at).sort()).toEqual(['content.accent', 'frame.accent'])
    const says = Object.fromEntries(read.problems.map((p) => [p.at, p.says]))
    expect(says['content.accent']).toMatch(
      /^Text on solid buttons would be too faint: [\d.]+ to 1 against a solid button, and it needs at least 4\.5 to 1\. Change `content\.accent`\.$/,
    )
    expect(says['frame.accent']).toMatch(
      /^Text on solid buttons in the left menu would be too faint: [\d.]+ to 1 against a solid button, and it needs at least 4\.5 to 1\. Change `frame\.accent`\.$/,
    )
  })
})

describe('a shadow style changes nothing the readability check says', () => {
  /** What the check says: accepted, or the problems it found. */
  const verdict = (own: Record<string, unknown>) => {
    const read = validateTheme(theme(own), APP)
    return read.ok ? 'accepted' : read.problems
  }

  it.each(['soft', 'hard', 'glow'])('%s', (style) => {
    const shadow = (s: string) => ({ shared: { shadow: { style: s, color: '#ff71ce' } } })
    expect(verdict(shadow(style))).toBe('accepted')
    const faint = (s: string) => ({ content: { ink: '#9aa0b0' }, shared: { shadow: { style: s } } })
    expect(verdict(faint(style))).not.toBe('accepted')
    expect(verdict(faint(style))).toEqual(verdict(faint('soft')))
  })
})
