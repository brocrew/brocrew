import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import { contrast, luminance, mount, unmountAll, type Rgba } from './harness'

/**
 * The window's frame under a theme is the frame paper the theme check measures its text on: the
 * title bar and the left menu paint it, plain, and their text reads on it. Classic keeps its own
 * navy and its drawn network.
 */

/** A frame light enough that a frame left navy would hide its dark text. */
const PARCHMENT = {
  format: 1,
  id: 'parchment',
  name: 'Parchment',
  extends: 'defined',
  frame: { ink: '#2b2118', paper: '#f4ecd8', accent: '#8a4b14' },
}

/** `file`, read as the app's own host reads it and resolved over the shipped `defined`. */
function read(file: unknown): Theme {
  const base = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!base.ok) throw new Error(JSON.stringify(base.problems))
  const builtIns = new Map([['defined', base.theme]])
  const theme = validateTheme(file, { assets: new Map(), builtIns })
  if (!theme.ok) throw new Error(JSON.stringify(theme.problems))
  return resolveTheme(theme.theme, base.theme)
}

const INFO = {
  name: 'BroBot2',
  version: '0.0.0',
  build: { id: 'e76e7c6', commit: 'e76e7c6dead', dirty: false },
  db: { migrationsApplied: 24 },
} as never

type RailApi = {
  runtime: { listResumable: () => Promise<never[]>; listUnresumable: () => Promise<never[]> }
}
const stubbed = (): { api?: RailApi } => window as unknown as { api?: RailApi }

/** The mounted title bar and left menu, and what each one paints. */
async function frame(): Promise<{ bar: Element; rail: Element }> {
  stubbed().api = {
    runtime: { listResumable: async () => [], listUnresumable: async () => [] },
  }
  const bar = mount(AppTitleBar, { info: INFO, error: null }, { width: 1180, height: 32 })
  const rail = mount(SideRail, { open: [], activeId: null, place: null }, { width: 251.68 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return { bar: bar.host.querySelector('.titlebar')!, rail: rail.host.querySelector('.rail')! }
}

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

/** The sRGB colour a computed colour paints, whatever space the engine reports it in. */
const colour = (value: string): Rgba => {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0]!, d[1]!, d[2]!, 1]
}
const background = (el: Element): Rgba => colour(getComputedStyle(el).backgroundColor)
const ink = (el: Element): Rgba => colour(getComputedStyle(el).color)

afterEach(() => {
  applyTheme(null)
  delete stubbed().api
  unmountAll()
})

describe('the window’s frame paints its theme’s frame paper', () => {
  it('a light frame: the title bar and the left menu are its paper, plain, and their text reads', async () => {
    applyTheme(read(PARCHMENT))
    const { bar, rail } = await frame()
    const paper = colour(PARCHMENT.frame.paper)
    expect(background(bar)).toEqual(paper)
    expect(background(rail)).toEqual(paper)
    expect(getComputedStyle(bar).backgroundImage).toBe('none')
    expect(getComputedStyle(rail).backgroundImage).toBe('none')
    const texts: [string, Element][] = [
      ['the window title', bar.querySelector('.window-title strong')!],
      ['the brand name', rail.querySelector('.brand-copy strong')!],
      ['the brand line', rail.querySelector('.brand-copy span')!],
    ]
    for (const [what, el] of texts) {
      expect(el, what).not.toBeNull()
      expect(contrast(ink(el), paper), what).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('⛔ Classic: its own navy title bar, and its rail with the network drawn', async () => {
    const { bar, rail } = await frame()
    expect(luminance(background(bar))).toBeLessThan(0.05)
    expect(luminance(background(rail))).toBeLessThan(0.05)
    expect(getComputedStyle(rail).backgroundImage).toMatch(/url\("data:image\/svg\+xml/)
  })
})
