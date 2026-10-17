import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { contrastRatio, type Rgba } from '../../src/shared/themes/colour'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import { mount, unmountAll } from './harness'

/**
 * A light title bar with a dark ink: every word the bar draws — its title, its usage line, a build
 * that isn't clean and an error — is drawn in colours worked out from that ink, so a theme the
 * check accepts reads in the window.
 */

const BASE = (() => {
  const read = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  return read.theme
})()

/** `own`, read as the app reads it. */
function read(own: Record<string, unknown>): Theme {
  const theme = validateTheme(
    { format: 1, id: 'light-bar', name: 'Light bar', extends: 'defined', ...own },
    { assets: new Map(), builtIns: new Map([['defined', BASE]]) },
  )
  if (!theme.ok) throw new Error(JSON.stringify(theme.problems))
  return resolveTheme(theme.theme, BASE)
}

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

/** The sRGB colour a computed colour paints. */
function painted(computed: string): Rgba {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return { r: d[0]!, g: d[1]!, b: d[2]!, a: 1 }
}

const INFO = {
  name: 'BroBot2',
  version: '0.0.0',
  build: { id: 'e76e7c6', commit: 'e76e7c6dead', dirty: true },
  db: { migrationsApplied: 24 },
} as never

afterEach(() => {
  applyTheme(null)
  unmountAll()
})

describe('a light title bar with a dark ink', () => {
  it('draws every word it holds readable on its background', async () => {
    applyTheme(read({ titlebar: { background: '#e3e8f4', ink: '#182135' } }))
    const m = mount(
      AppTitleBar,
      { info: INFO, error: 'The fictional database could not be opened.' },
      { width: 1180, height: 32 },
    )
    await nextTick()
    const bar = painted(getComputedStyle(m.host.querySelector('.titlebar')!).backgroundColor)
    const words: [string, string][] = [
      ['the title', '.window-title strong'],
      ['the usage line', '.title-usage'],
      ['a build that isn’t clean', '.sync-detail.build-dirty'],
      ['an error', '.sync-detail.danger'],
    ]
    for (const [what, selector] of words) {
      const el = m.host.querySelector(selector)
      expect(el, `${what} is drawn`).not.toBeNull()
      const ink = painted(getComputedStyle(el!).color)
      expect(contrastRatio(ink, bar), what).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the title bar’s usage line without a title-bar ink', () => {
  it('follows a frame text colour set by hand', async () => {
    applyTheme(read({ tokens: { frame: { text: '#ffd27a' } } }))
    const m = mount(AppTitleBar, { info: INFO, error: null }, { width: 1180, height: 32 })
    await nextTick()
    const usage = m.host.querySelector('.title-usage')
    expect(usage).not.toBeNull()
    expect(painted(getComputedStyle(usage!).color)).toEqual({ r: 255, g: 210, b: 122, a: 1 })
  })
})

describe('a light title bar without an ink, under a frame text set by hand', () => {
  it('draws its usage line in that text, as the check measures it', async () => {
    applyTheme(
      read({
        frame: { ink: '#2a3550', paper: '#e3e8f4', accent: '#3b45b8' },
        titlebar: { background: '#e3e8f4' },
        tokens: { frame: { text: '#182135' } },
      }),
    )
    const m = mount(AppTitleBar, { info: INFO, error: null }, { width: 1180, height: 32 })
    await nextTick()
    const bar = painted(getComputedStyle(m.host.querySelector('.titlebar')!).backgroundColor)
    const usage = painted(getComputedStyle(m.host.querySelector('.title-usage')!).color)
    expect(usage).toEqual({ r: 0x18, g: 0x21, b: 0x35, a: 1 })
    expect(contrastRatio(usage, bar)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the last recipes from review, drawn', () => {
  it('a black frame with white text set by hand: the usage line is white', async () => {
    applyTheme(
      read({
        frame: { ink: '#000000', paper: '#000000', accent: '#ffffff' },
        tokens: {
          frame: {
            text: '#ffffff',
            'text-soft': '#ffffff',
            muted: '#ffffff',
            faint: '#ffffff',
            waiting: '#ffffff',
            success: '#ffffff',
            danger: '#ffffff',
            auto: '#ffffff',
          },
        },
        titlebar: { background: '#000000' },
      }),
    )
    const m = mount(AppTitleBar, { info: INFO, error: null }, { width: 1180, height: 32 })
    await nextTick()
    const usage = painted(getComputedStyle(m.host.querySelector('.title-usage')!).color)
    expect(usage).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })
})

describe('the title bar without a theme', () => {
  it('still marks a build that isn’t clean in the waiting colour', async () => {
    const m = mount(AppTitleBar, { info: INFO, error: null }, { width: 1180, height: 32 })
    await nextTick()
    const bar = m.host.querySelector('.titlebar')!
    const probe = document.createElement('i')
    probe.style.color = 'var(--waiting)'
    bar.append(probe)
    const waiting = painted(getComputedStyle(probe).color)
    probe.remove()
    const dirty = m.host.querySelector('.sync-detail.build-dirty')
    expect(dirty, 'the unclean build is marked').not.toBeNull()
    expect(painted(getComputedStyle(dirty!).color)).toEqual(waiting)
  })
})
