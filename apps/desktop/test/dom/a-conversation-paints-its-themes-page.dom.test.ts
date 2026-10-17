import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { parseColour } from '../../src/shared/themes/colour'
import { DEFAULT_SEEDS } from '../../src/shared/themes/contrast'
import { deriveZone } from '../../src/shared/themes/derive'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import BROCREW from '../../resources/themes/brocrew/theme.json'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import SYNTHWAVE from '../../resources/themes/synthwave/theme.json'
import { mount, paneProps, unmountAll } from './harness'

/**
 * A conversation under a theme paints that theme's page: the colour worked out from its content
 * ink, paper and page depth, flat. Classic alone draws its network over the page. A theme that
 * sets a conversation background of its own paints it there.
 */

/** The shipped base, read as the app's own host reads it. */
const BASE = (() => {
  const base = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!base.ok) throw new Error(JSON.stringify(base.problems))
  return base.theme
})()

/**
 * A shipped theme, resolved over its base. Its pictures are read and checked with the files they
 * come from in `the-themes-the-app-ships-are-valid.test.ts`; a page here has no folder to read.
 */
function shipped(file: unknown): Theme {
  const theme = file as Theme
  return theme.extends ? resolveTheme(theme, BASE) : theme
}

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

/** The sRGB bytes a computed colour paints. */
function bytes(computed: string): [number, number, number] {
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0]!, d[1]!, d[2]!]
}

const near = (a: [number, number, number], b: [number, number, number]): boolean =>
  a.every((x, i) => Math.abs(x - b[i]!) <= 2)

/** The page the theme check measures for `theme`: its content seeds, through the derivation. */
function page(theme: Theme): [number, number, number] {
  const c = { ...DEFAULT_SEEDS.content, ...theme.content }
  const p = deriveZone({
    ink: parseColour(c.ink)!,
    paper: parseColour(c.paper)!,
    accent: parseColour(c.accent)!,
    page: theme.shared?.page ?? DEFAULT_SEEDS.page,
    line: theme.shared?.line ?? DEFAULT_SEEDS.line,
    tint: theme.shared?.tint ?? DEFAULT_SEEDS.tint,
    shadow: theme.shared?.shadow?.strength ?? DEFAULT_SEEDS.shadow,
  })['paper-bg']
  return [Math.round(p.r), Math.round(p.g), Math.round(p.b)]
}

/** The conversation's own surface, mounted, and what it paints. */
function conversation(): { color: [number, number, number]; image: string } {
  const m = mount(ConversationPane, paneProps(), { width: 900, height: 600 })
  const style = getComputedStyle(m.host.querySelector('.conversation-pane')!)
  const out = { color: bytes(style.backgroundColor), image: style.backgroundImage }
  m.unmount()
  return out
}

/** A token as the frame paints it. */
function frame(token: string): [number, number, number] {
  const el = document.createElement('i')
  el.style.color = `var(${token})`
  document.body.append(el)
  const computed = getComputedStyle(el).color
  el.remove()
  return bytes(computed)
}

afterEach(() => {
  applyTheme(null)
  unmountAll()
})

const THEMES = {
  defined: shipped(DEFINED_FILE),
  brocrew: shipped(BROCREW),
  synthwave: shipped(SYNTHWAVE),
}

describe('a conversation paints its theme’s page', () => {
  it('⚑ classic: its own page, with its network drawn over it', () => {
    const { image } = conversation()
    expect(image).toMatch(/^url\("data:image\/svg\+xml/)
  })

  it('defined: the page the check measures, flat', () => {
    applyTheme(THEMES.defined)
    const { color, image } = conversation()
    expect(color, `${color} vs ${page(THEMES.defined)}`).toSatisfy((c: [number, number, number]) =>
      near(c, page(THEMES.defined)),
    )
    expect(image).toBe('none')
  })

  it.each(['brocrew', 'synthwave'] as const)('%s: its own conversation background', (id) => {
    const theme = THEMES[id]
    applyTheme(theme)
    const { color, image } = conversation()
    const own = theme.conversation?.background
    expect(own?.color, `${id} sets a conversation colour`).toBeDefined()
    expect(color).toEqual(bytes(own!.color!))
    expect(image).not.toBe('none')
  })

  it.each(Object.keys(THEMES))(
    '%s: the title bar, the left menu and the window fall back to its frame paper',
    (id) => {
      const theme = THEMES[id as keyof typeof THEMES]
      applyTheme(theme)
      const paper = bytes(theme.frame?.paper ?? DEFAULT_SEEDS.frame.paper)
      for (const token of ['--titlebar-bg', '--rail-bg', '--rail', '--app-bg']) {
        expect(frame(token), token).toEqual(paper)
      }
    },
  )

  it('a theme’s conversation background paints on the mounted pane, read as the app reads it', () => {
    const read = validateTheme(
      {
        format: 1,
        id: 'warm-page',
        name: 'Warm page',
        extends: 'defined',
        conversation: {
          background: {
            color: '#fbfaf7',
            layers: [{ pattern: { kind: 'dots', color: '#e8e4da', size: 16 } }],
          },
        },
      },
      { assets: new Map(), builtIns: new Map([['defined', THEMES.defined]]) },
    )
    if (!read.ok) throw new Error(JSON.stringify(read.problems))
    applyTheme(resolveTheme(read.theme, THEMES.defined))
    const { color, image } = conversation()
    expect(color).toEqual([0xfb, 0xfa, 0xf7])
    expect(image).toMatch(
      /^radial-gradient\(circle, rgb\(232, 228, 218\) 1px, (transparent|rgba\(0, 0, 0, 0\)) 1\.5px\)$/,
    )
  })
})
