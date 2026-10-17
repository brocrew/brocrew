import { afterEach, describe, expect, it } from 'vitest'
import './harness'
import { parseColour, type Rgba } from '../../src/shared/themes/colour'
import { themeCss } from '../../src/shared/themes/css'
import type { Theme } from '../../src/shared/themes/theme'
import { DEFAULT_SEEDS } from '../../src/shared/themes/contrast'
import { deriveZone, frameStatus, type ZoneSeeds } from '../../src/shared/themes/derive'

/**
 * The theme check computes a derived theme's colours in TypeScript (`deriveZone`); the window
 * works them out in CSS. This mounts the real stylesheet in Chromium, sets `data-theme`, and reads
 * back what each zone actually resolves to, so the check measures what the window paints.
 *
 * The theme is `defined` as its theme file has it, applied the way the app applies any theme: its
 * settings written by `themeCss` onto `:root[data-theme='defined']`.
 *
 * ⚑ A resolved `color-mix()` is serialised as `oklab(…)`, so each colour is painted onto a 1×1
 * canvas and read back as sRGB bytes, the form the screen shows.
 */

/** The `defined` theme file, as it ships in resources/themes/defined/theme.json. */
const DEFINED = {
  format: 1,
  id: 'defined',
  name: 'Defined',
  frame: { ink: '#e3e8f4', paper: '#182135', accent: '#a7b7ff' },
  content: { ink: '#1b2238', paper: '#ffffff', accent: '#4f46e5' },
  shared: { page: 7, line: 16, tint: 10, shadow: { strength: 9 }, borderWidth: 1, radius: 12 },
} as unknown as Theme

/** Applies `defined` as the app does: its stylesheet in the head and its id on the root. */
function applyDefined(): void {
  const style = document.createElement('style')
  style.id = 'theme-under-test'
  style.textContent = themeCss(DEFINED)
  document.head.append(style)
  document.documentElement.setAttribute('data-theme', 'defined')
}

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

/** The sRGB bytes a token resolves to inside `scope`. */
function painted(scope: Element, token: string): [number, number, number] {
  const el = document.createElement('i')
  el.style.color = `var(${token})`
  scope.append(el)
  const computed = getComputedStyle(el).color
  el.remove()
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0]!, d[1]!, d[2]!]
}

const bytes = (c: Rgba): [number, number, number] => [
  Math.round(c.r),
  Math.round(c.g),
  Math.round(c.b),
]
const near = (a: [number, number, number], b: [number, number, number]): boolean =>
  a.every((x, i) => Math.abs(x - b[i]!) <= 2)

function seeds(zone: 'frame' | 'content'): ZoneSeeds {
  const d = DEFAULT_SEEDS[zone]
  return {
    ink: parseColour(d.ink)!,
    paper: parseColour(d.paper)!,
    accent: parseColour(d.accent)!,
    page: DEFAULT_SEEDS.page,
    line: DEFAULT_SEEDS.line,
    tint: DEFAULT_SEEDS.tint,
    shadow: DEFAULT_SEEDS.shadow,
  }
}

/** The opaque colours the check measures; the translucent ones depend on what is under them. */
const OPAQUE = [
  'panel',
  'panel-2',
  'panel-3',
  'line',
  'line-strong',
  'text',
  'text-soft',
  'muted',
  'faint',
  'accent-text',
  'accent-fill',
  'accent-fill-weak',
  'accent-fill-strong',
  'accent-border',
  'accent-border-weak',
  'focus-ring-color',
] as const

function lightScope(): HTMLElement {
  const light = document.createElement('div')
  light.setAttribute('data-chat-theme', 'light')
  document.body.append(light)
  return light
}

afterEach(() => {
  document.getElementById('theme-under-test')?.remove()
  document.documentElement.removeAttribute('data-theme')
  document.body.replaceChildren()
})

describe('a derived theme paints what the theme check measures', () => {
  it.each(['frame', 'content'] as const)('the %s zone, in `defined`', (zone) => {
    applyDefined()
    const scope = zone === 'frame' ? document.body : lightScope()
    const expected = deriveZone(seeds(zone))
    const off = OPAQUE.filter(
      (name) => !near(painted(scope, `--${name}`), bytes(expected[name])),
    ).map((name) => `--${name}: ${painted(scope, `--${name}`)} vs ${bytes(expected[name])}`)
    expect(off).toEqual([])
  })

  it('the page behind the cards is the content’s, in both zones', () => {
    applyDefined()
    const expected = bytes(deriveZone(seeds('content'))['paper-bg'])
    expect(painted(document.body, '--paper-bg')).toSatisfy((c: [number, number, number]) =>
      near(c, expected),
    )
    expect(painted(lightScope(), '--chat-bg')).toSatisfy((c: [number, number, number]) =>
      near(c, expected),
    )
  })

  it('a status colour on the frame is frameStatus() of the content’s', () => {
    applyDefined()
    const ink = parseColour(DEFAULT_SEEDS.frame.ink)!
    for (const [token, seed] of [
      ['--waiting', '#784f10'],
      ['--success', '#05725a'],
      ['--danger', '#ac3d49'],
      ['--auto', '#9a510d'],
    ] as const) {
      const expected = bytes(frameStatus(parseColour(seed)!, ink))
      const got = painted(document.body, token)
      expect(near(got, expected), `${token}: ${got} vs ${expected}`).toBe(true)
      // …and the content keeps the setting itself.
      expect(painted(lightScope(), token)).toEqual(bytes(parseColour(seed)!))
    }
  })

  it('a theme’s own setting reaches the light scope from its root block', () => {
    const style = document.createElement('style')
    style.textContent = ":root[data-theme='test-teal'] { --content-accent: #0f766e; }"
    document.head.append(style)
    document.documentElement.setAttribute('data-theme', 'test-teal')
    expect(painted(lightScope(), '--accent')).toEqual([15, 118, 110])
    style.remove()
  })

  it('⛔ without a data-theme, and with `classic`, the hand-picked colours stay', () => {
    for (const theme of [null, 'classic']) {
      if (theme) document.documentElement.setAttribute('data-theme', theme)
      expect(painted(lightScope(), '--muted')).toEqual([0x54, 0x58, 0x77])
      expect(painted(document.body, '--muted')).toEqual([0xb7, 0xbb, 0xe6])
      expect(painted(document.body, '--waiting')).toEqual([0xff, 0xc8, 0x57])
    }
  })

  /** The picture a surface in `scope` draws from `--paper-wash`, as the engine computes it. */
  const wash = (scope: Element): string => {
    const el = document.createElement('i')
    el.style.backgroundImage = 'var(--paper-wash)'
    scope.append(el)
    const image = getComputedStyle(el).backgroundImage
    el.remove()
    return image
  }

  it('⛔ a derived theme paints no inherited wash; Classic keeps its network', () => {
    // The theme check measures a theme's page as its flat paper, so nothing of Classic's may be
    // drawn over it: a theme that wants a pattern sets a background of its own, which is measured.
    expect(wash(lightScope())).toContain('url(')
    document.documentElement.setAttribute('data-theme', 'classic')
    expect(wash(lightScope())).toContain('url(')
    applyDefined()
    expect(wash(lightScope())).toBe('none')
  })

  /** Each text role's size in px, as the window resolves it on the root. */
  const sizes = (): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const role of ['caption', 'small', 'body', 'reading', 'heading', 'title', 'display']) {
      const el = document.createElement('i')
      el.style.fontSize = `var(--type-${role})`
      document.body.append(el)
      out[role] = parseFloat(getComputedStyle(el).fontSize)
      el.remove()
    }
    return out
  }

  it('the default type scale is classic’s, unchanged', () => {
    applyDefined()
    expect(sizes()).toEqual({
      caption: 12,
      small: 13,
      body: 14,
      reading: 15,
      heading: 18,
      title: 22,
      display: 28,
    })
  })

  it('⛔ 12px × 1.35 would draw a 10px caption; the window holds it at the 12px floor', () => {
    const style = document.createElement('style')
    style.id = 'theme-under-test'
    style.textContent = ":root[data-theme='tiny'] { --type-base: 12px; --type-ratio: 1.35; }"
    document.head.append(style)
    document.documentElement.setAttribute('data-theme', 'tiny')
    const s = sizes()
    expect(s.caption).toBe(12)
    expect(s.small).toBe(12)
    expect(Math.min(...Object.values(s))).toBe(12)
    // The large roles still grow by the ratio: 12 × 1.35 = 16.2 → 16px.
    expect(s.heading).toBe(16)
  })
})
