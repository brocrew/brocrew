import { afterEach, describe, expect, it } from 'vitest'
import { windowStage, settle } from '../../look/fixtures/window'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * A theme's per-component settings reach the real window: the left menu, its rows, the title bar
 * and the conversation are mounted as the app draws them, and each paints what the theme set. The
 * theme is read as the app reads it, so a setting still held would refuse it.
 */

/** `file`, read as the app's own host reads it and resolved over the shipped `defined`. */
function read(file: Record<string, unknown>): Theme {
  const base = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!base.ok) throw new Error(JSON.stringify(base.problems))
  const builtIns = new Map([['defined', base.theme]])
  const theme = validateTheme(
    { format: 1, id: 'dressed', name: 'Dressed', extends: 'defined', ...file },
    { assets: new Map(), builtIns },
  )
  if (!theme.ok) throw new Error(JSON.stringify(theme.problems))
  return resolveTheme(theme.theme, base.theme)
}

/** The whole window, mounted at the app's floor width. */
async function dressed(file: Record<string, unknown> | null): Promise<Mounted> {
  applyTheme(file ? read(file) : null)
  const m = mount(windowStage({ titleBar: true }), {}, { width: 1180, height: 800 })
  await settle()
  return m
}

const style = (m: Mounted, selector: string, pseudo?: string): CSSStyleDeclaration => {
  const el = m.host.querySelector(selector)
  expect(el, `${selector} is not drawn`).not.toBeNull()
  return getComputedStyle(el!, pseudo)
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
})

describe('the left menu wears its theme', () => {
  const RAIL = {
    rail: {
      background: {
        color: '#2a1440',
        layers: [
          {
            gradient: {
              type: 'linear',
              angle: 180,
              stops: [
                { color: '#2a1440', at: 0 },
                { color: '#3b1c5a', at: 100 },
              ],
            },
          },
        ],
      },
      edge: '#ff71ce',
      item: { active: { fill: '#4a2470', ink: '#ffffff' } },
    },
  }

  it('its background, its edge strip and its open row', async () => {
    const m = await dressed(RAIL)
    const rail = style(m, '.rail')
    expect(rail.backgroundColor).toBe('rgb(42, 20, 64)')
    expect(rail.backgroundImage).toBe('linear-gradient(rgb(42, 20, 64) 0%, rgb(59, 28, 90) 100%)')
    const edge = style(m, '.rail', '::after')
    expect(edge.backgroundColor).toBe('rgb(255, 113, 206)')
    expect(edge.width).toBe('8px')
    expect(edge.pointerEvents).toBe('none')
    const open = style(m, '.rail-item.active')
    expect(open.backgroundColor).toBe('rgb(74, 36, 112)')
    expect(open.color).toBe('rgb(255, 255, 255)')
  })

  it('⛔ without a theme: classic’s drawing, no strip, and the open row as before', async () => {
    const m = await dressed(null)
    const rail = style(m, '.rail')
    expect(rail.backgroundImage).toMatch(/^url\("data:image\/svg\+xml.*linear-gradient/)
    expect(style(m, '.rail', '::after').backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style(m, '.rail', '::after').backgroundImage).toBe('none')
  })
})

describe('the title bar wears its theme', () => {
  const BAR = {
    titlebar: { background: '#2b2118', ink: '#f4ecd8', inkGlow: '#ff8a5c' },
  }

  it('its background, its text and the glow behind it', async () => {
    const m = await dressed(BAR)
    const bar = style(m, '.titlebar')
    expect(bar.backgroundColor).toBe('rgb(43, 33, 24)')
    expect(bar.backgroundImage).toBe('none')
    expect(bar.textShadow).toBe('rgb(255, 138, 92) 0px 0px 6px')
    for (const text of ['.window-title', '.window-title strong', '.sync-state']) {
      expect(style(m, text).color, text).toBe('rgb(244, 236, 216)')
    }
  })

  it('⛔ without a theme: no glow, and its text in the app’s own colours', async () => {
    const m = await dressed(null)
    expect(style(m, '.titlebar').textShadow).toBe('none')
    expect(style(m, '.window-title strong').color).not.toBe('rgb(244, 236, 216)')
  })
})

describe('the logo tile wears its theme', () => {
  const MARK = {
    brand: {
      mark: {
        color: '#ff71ce',
        layers: [
          {
            gradient: {
              type: 'linear',
              angle: 145,
              stops: [
                { color: '#ff71ce', at: 0 },
                { color: '#01cdfe', at: 100 },
              ],
            },
          },
        ],
      },
      markInk: '#120a26',
      markEdge: '#01cdfe',
    },
  }

  it('its tile, its edge, and the mark drawn in the theme’s ink', async () => {
    const m = await dressed(MARK)
    const tile = style(m, '.brand-mark')
    expect(tile.backgroundColor).toBe('rgb(255, 113, 206)')
    expect(tile.backgroundImage).toBe(
      'linear-gradient(145deg, rgb(255, 113, 206) 0%, rgb(1, 205, 254) 100%)',
    )
    expect(tile.borderTopColor).toBe('rgb(1, 205, 254)')
    expect(style(m, '.crew-mark').visibility).toBe('hidden')
    const ink = style(m, '.brand-mark', '::after')
    expect(ink.backgroundColor).toBe('rgb(18, 10, 38)')
    // The app's own mark, as the picture the ink shows through.
    expect(ink.maskImage).toMatch(/^url\("data:image\/svg\+xml/)
  })

  it('a transparent ink leaves only the theme’s picture', async () => {
    const m = await dressed({ brand: { mark: '#14173a', markInk: 'transparent' } })
    expect(style(m, '.crew-mark').visibility).toBe('hidden')
    expect(style(m, '.brand-mark', '::after').backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('⛔ without a theme: the app’s own mark, on a clear tile', async () => {
    const m = await dressed(null)
    expect(style(m, '.crew-mark').visibility).toBe('visible')
    expect(style(m, '.brand-mark', '::after').backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style(m, '.brand-mark').backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style(m, '.brand-mark').backgroundImage).toBe('none')
  })
})

describe('titles and the brand wear their theme’s type', () => {
  const TYPE = {
    type: {
      display: { weight: 600, style: 'italic', letterSpacing: 0.02 },
      brand: { weight: 500, letterSpacing: 0.04 },
    },
  }

  /** A letter spacing in px, as `em` of the element's own size. */
  const em = (s: CSSStyleDeclaration, by: number): string =>
    `${Math.round(parseFloat(s.fontSize) * by * 100) / 100}px`

  it('the conversation’s title and the name beside the logo', async () => {
    const m = await dressed(TYPE)
    const title = style(m, 'h1')
    expect(title.fontStyle).toBe('italic')
    expect(title.fontWeight).toBe('600')
    expect(title.letterSpacing).toBe(em(title, 0.02))
    const brand = style(m, '.brand-copy strong')
    expect(brand.fontStyle).toBe('normal')
    expect(brand.fontWeight).toBe('500')
    expect(brand.letterSpacing).toBe(em(brand, 0.04))
  })

  it('⛔ without a theme: upright, at the app’s own weights', async () => {
    const m = await dressed(null)
    expect(style(m, 'h1').fontStyle).toBe('normal')
    expect(style(m, 'h1').fontWeight).not.toBe('600')
    expect(style(m, '.brand-copy strong').fontWeight).not.toBe('500')
  })
})

describe('the typing field and the right-hand panel wear their theme', () => {
  const PARTS = {
    composer: {
      surround: '#efe6d2',
      field: { fill: '#fffaf0', ink: '#2b2118', line: '#8a4b14' },
    },
    drawer: {
      background: '#f4ecd8',
      tabs: '#e8dcc0',
      card: { fill: '#fffaf0', ink: '#2b2118', line: '#c9b48a' },
    },
  }

  it('the band, the field and its text; the panel, its tabs and its cards', async () => {
    const m = await dressed(PARTS)
    expect(style(m, '.composer-wrap').backgroundColor).toBe('rgb(239, 230, 210)')
    const field = style(m, '.composer')
    expect(field.backgroundColor).toBe('rgb(255, 250, 240)')
    expect(field.borderTopColor).toBe('rgb(138, 75, 20)')
    expect(style(m, '.composer textarea').color).toBe('rgb(43, 33, 24)')
    expect(style(m, '.session-drawer').backgroundColor).toBe('rgb(244, 236, 216)')
    expect(style(m, '.drawer-tabs').backgroundColor).toBe('rgb(232, 220, 192)')
    const card = style(m, '.card-section')
    expect(card.backgroundColor).toBe('rgb(255, 250, 240)')
    expect(card.borderTopColor).toBe('rgb(201, 180, 138)')
    expect(card.color).toBe('rgb(43, 33, 24)')
    // The card's own heading and count are in its ink too.
    // The card's own headings, accent ones included, and its counts are in its ink too.
    const own = m.host.querySelectorAll('.card-section .title, .card-section .count')
    expect(own.length).toBeGreaterThan(1)
    for (const el of own) expect(getComputedStyle(el).color).toBe('rgb(43, 33, 24)')
    // What the card holds is in its ink too: every text inside it that reads the zone's text,
    // like what a person types to filter its files.
    const card0 = m.host.querySelector('.card-section')!
    expect(getComputedStyle(card0).getPropertyValue('--text').trim()).toBe('#2b2118')
    const held = m.host.querySelectorAll(
      '.card-section .tile-name, .card-section .files-filter input',
    )
    expect(held.length).toBeGreaterThan(0)
    for (const el of held) expect(getComputedStyle(el).color).toBe('rgb(43, 33, 24)')
  })

  it('⛔ without a theme: each keeps the app’s own colours', async () => {
    const m = await dressed(null)
    expect(style(m, '.composer').backgroundColor).not.toBe('rgb(255, 250, 240)')
    expect(style(m, '.card-section').backgroundColor).not.toBe('rgb(255, 250, 240)')
    expect(style(m, '.drawer-tabs').backgroundColor).not.toBe('rgb(232, 220, 192)')
  })
})

describe('shadows and primary buttons wear their theme’s style', () => {
  it('a glow is drawn around a card, in the shadow colour', async () => {
    const m = await dressed({ shared: { shadow: { style: 'glow', color: '#ff71ce' } } })
    const shadow = style(m, '.composer').boxShadow
    expect(shadow).toMatch(/ 0px 0px 12px 0px$/)
    // The shadow colour, mixed toward transparent: pink, not black.
    expect(shadow).toMatch(/^color\(srgb 1 0\.44\d* 0\.80\d* \/ [\d.]+\)/)
  })

  it('a hard shadow is offset, with no blur', async () => {
    const m = await dressed({ shared: { shadow: { style: 'hard' } } })
    expect(style(m, '.composer').boxShadow).toMatch(/ 2px 2px 0px 0px$/)
  })

  it('a solid primary button is filled with the accent, its text in the paper', async () => {
    const m = await dressed({ shared: { accentStyle: 'solid' } })
    const button = document.createElement('button')
    button.className = 'bb-button bb-button--primary'
    const light = m.host.querySelector('[data-chat-theme="light"]')!
    light.append(button)
    const s = getComputedStyle(button)
    expect(s.backgroundColor).toBe('rgb(79, 70, 229)')
    expect(s.color).toBe('rgb(255, 255, 255)')
    button.remove()
  })
})

describe('controls, pictures and movement wear their theme', () => {
  /** A shared control, placed in the conversation. */
  const control = (m: Mounted, className: string): HTMLElement => {
    const el = document.createElement(className === 'bb-input' ? 'input' : 'button')
    el.className = className
    m.host.querySelector('[data-chat-theme="light"]')!.append(el)
    return el
  }

  it('bevelled buttons and fields, in the theme’s edge colours', async () => {
    const m = await dressed({
      controls: { style: 'bevel', bevel: { light: '#ffffff', dark: '#808080' } },
    })
    expect(getComputedStyle(control(m, 'bb-button')).boxShadow).toBe(
      'rgb(255, 255, 255) 1px 1px 0px 0px inset, rgb(128, 128, 128) -1px -1px 0px 0px inset',
    )
    expect(getComputedStyle(control(m, 'bb-input')).boxShadow).toBe(
      'rgb(128, 128, 128) 1px 1px 0px 0px inset, rgb(255, 255, 255) -1px -1px 0px 0px inset',
    )
  })

  it('pictures in grey, and no fades or slides', async () => {
    const m = await dressed({ pictures: { tone: 'grey' }, motion: { transitions: 'none' } })
    expect(style(m, '.crew-mark').filter).toBe('grayscale(1)')
    const moving = control(m, 'bb-button')
    moving.style.transition = 'opacity 200ms'
    expect(getComputedStyle(moving).transitionProperty).toBe('none')
  })

  it('⛔ without a theme: flat controls, pictures in colour, movement as the app has it', async () => {
    const m = await dressed(null)
    expect(getComputedStyle(control(m, 'bb-button')).boxShadow).toBe('none')
    expect(style(m, '.crew-mark').filter).toBe('none')
    const moving = control(m, 'bb-button')
    moving.style.transition = 'opacity 200ms'
    expect(getComputedStyle(moving).transitionProperty).toBe('opacity')
  })
})

describe('the page behind the window', () => {
  it('is the frame’s paper under a theme, with no glow, and the app’s own without one', async () => {
    const paint = (): string => {
      const el = document.createElement('div')
      el.style.background = 'var(--bg-glow), var(--bg)'
      document.body.append(el)
      const out = `${getComputedStyle(el).backgroundColor} ${getComputedStyle(el).backgroundImage}`
      el.remove()
      return out
    }
    applyTheme(read({ frame: { ink: '#2b2118', paper: '#f4ecd8', accent: '#8a4b14' } }))
    expect(paint()).toBe('rgb(244, 236, 216) none, none')
    applyTheme(null)
    expect(paint()).toBe('rgb(20, 23, 58) none, none')
  })
})
