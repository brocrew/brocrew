import { describe, expect, it } from 'vitest'
import { colourCss, mixSrgb, parseColour } from '../../src/shared/themes/colour'

/** What a colour reaches CSS as, or null when it is not one a theme may write. */
const css = (text: string): string | null => {
  const c = parseColour(text)
  return c === null ? null : colourCss(c)
}

describe('a colour is read only in the forms a theme may write', () => {
  it('refuses an rgb() whose channels are not numbers, or are angles', () => {
    expect(css('rgb(red 0 0)')).toBeNull()
    expect(css('rgb(1e999 0 0)')).toBeNull()
    expect(css('rgb(10deg 0 0)')).toBeNull()
  })

  it('refuses a second slash, and an alpha after other than three channels', () => {
    expect(css('rgb(1 2 3 / 50% / 50%)')).toBeNull()
    expect(css('rgb(1 2 / 50%)')).toBeNull()
    expect(css('rgb(1 2 3 4 5)')).toBeNull()
  })

  it('refuses an alpha that is an angle or not a number', () => {
    expect(css('rgb(1 2 3 / 10deg)')).toBeNull()
    expect(css('rgb(1 2 3 / half)')).toBeNull()
    expect(css('hsl(0 100% 50% / 1deg)')).toBeNull()
    expect(css('oklch(0.5 0.1 30 / 1deg)')).toBeNull()
  })

  it('reads rgb() channels written as percentages of 255', () => {
    expect(css('rgb(100% 0% 50%)')).toBe('#ff0080')
    expect(css('rgb(100%, 0%, 50%, 50%)')).toBe('#ff008080')
  })

  it('refuses an hsl() with too few parts, a percentage hue or an angle for saturation or lightness', () => {
    expect(css('hsl(0 100%)')).toBeNull()
    expect(css('hsl(10% 50% 50%)')).toBeNull()
    expect(css('hsl(0 50deg 50%)')).toBeNull()
    expect(css('hsl(0 50% 50deg)')).toBeNull()
  })

  it('reads hsl() at any hue and lightness, as CSS does', () => {
    expect(css('hsl(0 100% 50%)')).toBe('#ff0000')
    // Lighter than half: the lighter formula, blending towards white.
    expect(css('hsl(0 100% 75%)')).toBe('#ff8080')
    // A hue past two thirds of the circle wraps its red channel back round.
    expect(css('hsl(300 100% 50%)')).toBe('#ff00ff')
    // A hue whose green channel falls on the falling ramp between a half and two thirds.
    expect(css('hsl(204 100% 50%)')).toBe('#0099ff')
  })

  it('refuses an oklch() with too few parts, an angle for lightness or chroma, or a percentage hue', () => {
    expect(css('oklch(0.5 0.1)')).toBeNull()
    expect(css('oklch(50deg 0.1 30)')).toBeNull()
    expect(css('oklch(0.5 1deg 30)')).toBeNull()
    expect(css('oklch(0.5 0.1 30%)')).toBeNull()
  })

  it('reads oklch() percentages as CSS does: lightness of 1, chroma of 0.4', () => {
    expect(css('oklch(70% 100% 30)')).toBe(css('oklch(0.7 0.4 30)'))
    expect(css('oklch(50% 0% 0)')).toBe(css('oklch(0.5 0 0)'))
  })

  it('mixes two transparent colours in sRGB to transparent, lending no hue', () => {
    const clear = { r: 255, g: 0, b: 0, a: 0 }
    expect(mixSrgb(clear, 50, { r: 0, g: 0, b: 255, a: 0 })).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })
})
