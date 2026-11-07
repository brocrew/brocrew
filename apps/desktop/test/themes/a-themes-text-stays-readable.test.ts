import { describe, expect, it } from 'vitest'
import { colourCss, contrastRatio, mixOklab, parseColour } from '../../src/shared/themes/colour'
import { DERIVATION, deriveZone, mixSrgb } from '../../src/shared/themes/derive'
import { validateTheme } from '../../src/shared/themes/validate'
import { contextFor } from './fixtures'

const c = (s: string) => parseColour(s)!

describe('the colour maths is the engine’s', () => {
  it('reads every form a theme may write', () => {
    expect(colourCss(c('#abc'))).toBe('#aabbcc')
    expect(colourCss(c('#aabbcc80'))).toBe('#aabbcc80')
    expect(colourCss(c('rgb(10, 20, 30)'))).toBe('#0a141e')
    expect(colourCss(c('rgba(10 20 30 / 0.5)'))).toBe('#0a141e80')
    expect(colourCss(c('hsl(120 100% 25%)'))).toBe('#008000')
    expect(colourCss(c('oklch(62.8% 0.2577 29.23)'))).toBe('#ff0000')
    expect(c('transparent').a).toBe(0)
    for (const bad of [
      'red',
      'var(--x)',
      'color-mix(in oklab, red, blue)',
      '#ggg',
      'rgb(1 2)',
      'url(x)',
      '',
    ])
      expect(parseColour(bad), bad).toBeNull()
  })

  it('mixes in oklab as color-mix does: half black, half white is #636363', () => {
    expect(colourCss(mixOklab(c('#000'), 50, c('#fff')))).toBe('#636363')
  })

  it('mixes premultiplied, so a transparent side lends no hue', () => {
    expect(colourCss(mixSrgb(c('#ff0000'), 50, c('transparent')))).toBe('#ff000080')
    expect(colourCss(mixOklab(c('#ff0000'), 50, c('transparent')))).toBe('#ff000080')
  })

  it('measures contrast as WCAG does', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 5)
    expect(contrastRatio(c('#777'), c('#fff'))).toBeCloseTo(4.48, 2)
  })

  it('derives every semantic colour of a zone from its seeds', () => {
    const zone = deriveZone({
      ink: c('#1b2238'),
      paper: c('#ffffff'),
      accent: c('#4f46e5'),
      page: 7,
      line: 16,
      tint: 10,
      shadow: 9,
    })
    expect(Object.keys(zone).sort()).toEqual(Object.keys(DERIVATION).sort())
    expect(colourCss(zone.text)).toBe('#1b2238')
    expect(colourCss(zone.panel)).toBe('#ffffff')
    expect(zone['selection-bg'].a).toBeCloseTo(0.22, 2)
  })
})

describe('valid colours do not veto a theme', () => {
  it.each([
    { content: { ink: '#ffffff', paper: '#ffffff', accent: '#ffffff' } },
    { frame: { ink: '#182135', paper: '#182135' } },
    { titlebar: { background: '#f0f0f0', ink: '#ffffff' } },
  ])('accepts low-contrast settings %j', (settings) => {
    expect(
      validateTheme(
        { format: 1, id: 'mine', name: 'Mine', extends: 'defined', ...settings },
        contextFor(),
      ),
    ).toMatchObject({ ok: true })
  })
})
