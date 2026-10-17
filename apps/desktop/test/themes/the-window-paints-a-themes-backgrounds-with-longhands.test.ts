import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FILL_LONGHANDS } from '../../src/shared/themes/css'

/**
 * A theme's background is written as longhands, and the window paints it with longhands: each
 * place that paints a background slot sets `background-color`, `-image`, `-position`, `-repeat` and
 * `-size` and `image-rendering` from the slot's own custom properties, never the `background`
 * shorthand, which a picture over a colour would make invalid. With no theme, each falls back to
 * what the app painted before.
 */

const RENDERER = join(__dirname, '../../src/renderer/src')
const TOKENS = readFileSync(join(RENDERER, 'assets/tokens.css'), 'utf8')

/** Every component's source, by file name. */
const COMPONENTS = new Map(
  readdirSync(join(RENDERER, 'components'))
    .filter((n) => n.endsWith('.vue'))
    .map((n) => [n, readFileSync(join(RENDERER, 'components', n), 'utf8')]),
)

/** The background slots the window paints, and where. */
const SLOTS: Record<string, string[]> = {
  'window-bg': ['RuntimeScreen.vue'],
  'rail-bg': ['SideRail.vue', 'ThemesSection.vue'],
  'rail-edge': ['SideRail.vue'],
  'brand-mark': ['SideRail.vue'],
  'titlebar-bg': ['AppTitleBar.vue', 'ThemesSection.vue'],
  'conversation-bg': [
    'ConversationPane.vue',
    'NewConversation.vue',
    'ProvidersScreen.vue',
    'ReadingPane.vue',
    'RecentActivity.vue',
    'RecoveryApp.vue',
    'SettingsScreen.vue',
    'SessionLibrary.vue',
    'ThemesSection.vue',
    'ToolsRegister.vue',
    'WaitingOnYou.vue',
  ],
  'composer-surround': ['PromptComposer.vue'],
  'drawer-panel-bg': ['SessionDrawer.vue'],
  'drawer-tabs-bg': ['SessionDrawer.vue'],
}

/**
 * Where a slot's colour is only the opaque base under another surface, read as a background layer
 * and never painted: the floating right-hand panel stands on the conversation's colour.
 */
const BASES: Record<string, string[]> = { 'conversation-bg': ['SessionDrawer.vue'] }

/**
 * Where a slot is painted a second time, as layers over an opaque base: the floating right-hand
 * panel, whose theme colour may let what is under it through.
 */
const LAYERED: Record<string, Record<string, number>> = {
  'drawer-panel-bg': { 'SessionDrawer.vue': 1 },
}

const PROPERTY: Record<(typeof FILL_LONGHANDS)[number], string> = {
  color: 'background-color',
  image: 'background-image',
  position: 'background-position',
  repeat: 'background-repeat',
  size: 'background-size',
  rendering: 'image-rendering',
}

/** The body of every rule in `css` that reads `--<slot>-color`. */
function rulesReading(css: string, slot: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(/\{([^{}]*)\}/g)) {
    if (m[1]!.includes(`var(--${slot}-color,`)) out.push(m[1]!)
  }
  return out
}

describe('the window paints a theme’s backgrounds with longhands', () => {
  it.each(Object.entries(SLOTS))('--%s', (slot, files) => {
    const bases = BASES[slot] ?? []
    const found = [...COMPONENTS].filter(([, src]) => src.includes(`var(--${slot}-color,`))
    expect(found.map(([n]) => n).sort()).toEqual([...files, ...bases].sort())
    for (const [name, src] of found) {
      const rules = rulesReading(src, slot)
      expect(rules.length, name).toBeGreaterThan(0)
      if (bases.includes(name)) {
        // A base: the slot's colour as one layer, its picture never read.
        expect(src, name).not.toContain(`var(--${slot}-image,`)
        for (const rule of rules)
          expect(rule, name).toMatch(
            new RegExp(`linear-gradient\\(\\s*var\\(--${slot}-color, transparent\\),`),
          )
        continue
      }
      // The rule that paints the slot reads every longhand, and has no shorthand to undo them.
      const painting = rules.filter((r) => r.includes(`var(--${slot}-image,`))
      const own = painting.filter((r) => r.includes(`background-color: var(--${slot}-color,`))
      expect(own, `${name} paints --${slot} in one rule`).toHaveLength(1)
      for (const longhand of FILL_LONGHANDS) {
        expect(own[0], `${name}: ${PROPERTY[longhand]}`).toMatch(
          new RegExp(`${PROPERTY[longhand]}: var\\(--${slot}-${longhand},`),
        )
      }
      expect(own[0], name).not.toMatch(/(^|[\s;])background:/)
      // A rule that lays the slot over a base: its picture first, its colour as the layer under
      // it, each other longhand's first value from the slot, and still no shorthand.
      const layered = painting.filter((r) => !own.includes(r))
      expect(layered.length, `${name} lays --${slot} over a base`).toBe(LAYERED[slot]?.[name] ?? 0)
      for (const rule of layered) {
        expect(rule, name).toMatch(
          new RegExp(
            `background-image:\\s*var\\(--${slot}-image, none\\),\\s*linear-gradient\\(\\s*var\\(--${slot}-color,`,
          ),
        )
        for (const longhand of ['position', 'repeat', 'size'] as const)
          expect(rule, `${name}: ${PROPERTY[longhand]}`).toMatch(
            new RegExp(`${PROPERTY[longhand]}:\\s*var\\(--${slot}-${longhand},`),
          )
        expect(rule, name).not.toMatch(/(^|[\s;])background:/)
      }
    }
  })

  it('every longhand a component reads is unset on the root until a theme sets it', () => {
    for (const slot of Object.keys(SLOTS)) {
      for (const longhand of FILL_LONGHANDS) {
        expect(TOKENS, `--${slot}-${longhand}`).toMatch(
          new RegExp(`^  --${slot}-${longhand}: initial;$`, 'm'),
        )
      }
    }
  })

  it('the rail’s longhand defaults are the same drawing as classic’s `--rail-bg`', () => {
    const decl = (name: string): string => {
      const m = new RegExp(`^  ${name}:\\s*([^;]+);`, 'm').exec(TOKENS)
      expect(m, `${name} is not declared`).not.toBeNull()
      return m![1]!.replace(/\s+/g, ' ').trim()
    }
    const network = /url\("[^"]+"\)/.exec(decl('--rail-bg'))![0]
    const gradient = /linear-gradient\(.*\)$/.exec(decl('--rail-bg'))![0]
    expect(decl('--rail-bg')).toBe(`${network} 0 0 / 280px 330px, ${gradient}`)
    expect(decl('--rail-art')).toBe(`${network}, ${gradient}`)
    expect(decl('--rail-art-position')).toBe('0 0, 0% 0%')
    expect(decl('--rail-art-size')).toBe('280px 330px, auto')
  })
})
