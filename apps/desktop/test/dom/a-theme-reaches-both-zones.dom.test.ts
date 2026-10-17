import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, THEME_STYLE_ID } from '../../src/renderer/src/lib/apply-theme'
import type { Theme } from '../../src/shared/themes/theme'
import { unmountAll } from './harness'

/**
 * What a theme resolves to in a real cascade, beside tokens.css: its seeds on the root reach the
 * light zone unchanged, its hand-tuned content colours win there and only there, a background is
 * painted from longhands, and switching or taking it off leaves nothing behind.
 */

const VALENTINE: Theme = {
  format: 1,
  id: 'valentine',
  name: 'Valentine',
  frame: { ink: '#fff2f5', paper: '#3d0a1a', accent: '#ff8fab' },
  content: { ink: '#3a1020', paper: '#fffafb', accent: '#d6336c' },
  brand: { mark: { color: '#c2185b' } },
  tokens: { frame: { muted: '#ffc9d6' }, content: { muted: '#6e3a4c' } },
}
const ZEN: Theme = {
  format: 1,
  id: 'zen',
  name: 'Zen',
  frame: { ink: '#f3eee2', paper: '#17213a', accent: '#f0a090' },
  controls: { style: 'bevel' },
}

const boxes: HTMLElement[] = []
afterEach(() => {
  applyTheme(null)
  while (boxes.length) boxes.pop()!.remove()
  unmountAll()
})

/** A frame element and a light-zone element inside it, as the window nests them. */
function zones(): { frame: HTMLElement; light: HTMLElement; mark: HTMLElement } {
  const frame = document.createElement('div')
  const light = document.createElement('div')
  light.setAttribute('data-chat-theme', 'light')
  const mark = document.createElement('div')
  mark.style.backgroundColor = 'var(--brand-mark-color, rgb(1, 2, 3))'
  mark.style.backgroundImage = 'var(--brand-mark-image, none)'
  frame.append(light, mark)
  document.body.append(frame)
  boxes.push(frame)
  return { frame, light, mark }
}

const prop = (el: Element, name: string): string =>
  getComputedStyle(el).getPropertyValue(name).trim()

describe('a theme in a real cascade', () => {
  it('its seeds reach the light zone unchanged; its content colours win only there', () => {
    applyTheme(VALENTINE)
    const { frame, light } = zones()
    expect(prop(light, '--content-ink')).toBe('#3a1020')
    expect(prop(light, '--frame-paper')).toBe('#3d0a1a')
    expect(prop(frame, '--muted')).toBe('#ffc9d6')
    expect(prop(light, '--muted')).toBe('#6e3a4c')
  })

  it('a background painted from longhands takes the theme’s colour, with no picture', () => {
    applyTheme(VALENTINE)
    const { mark } = zones()
    expect(getComputedStyle(mark).backgroundColor).toBe('rgb(194, 24, 91)')
    expect(getComputedStyle(mark).backgroundImage).toBe('none')
  })

  it('switching replaces the stylesheet and the keyword attributes; off removes both', () => {
    applyTheme(VALENTINE)
    applyTheme(ZEN)
    const { frame, light, mark } = zones()
    expect(document.querySelectorAll(`#${THEME_STYLE_ID}`)).toHaveLength(1)
    expect(document.documentElement.dataset.theme).toBe('zen')
    expect(document.documentElement.dataset.controls).toBe('bevel')
    expect(prop(light, '--content-ink')).not.toBe('#3a1020')
    expect(prop(frame, '--muted')).not.toBe('#ffc9d6')
    applyTheme(null)
    expect(document.getElementById(THEME_STYLE_ID)).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.hasAttribute('data-controls')).toBe(false)
    expect(getComputedStyle(mark).backgroundColor).toBe('rgb(1, 2, 3)')
  })
})
