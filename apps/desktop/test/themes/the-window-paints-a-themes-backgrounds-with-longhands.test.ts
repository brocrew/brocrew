import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FILL_LONGHANDS } from '../../src/shared/themes/css'

const RENDERER = join(__dirname, '../../src/renderer/src')
const TOKENS = readFileSync(join(RENDERER, 'assets/tokens.css'), 'utf8')

const COMPONENTS = new Map(
  readdirSync(join(RENDERER, 'components'))
    .filter((n) => n.endsWith('.vue'))
    .map((n) => [n, readFileSync(join(RENDERER, 'components', n), 'utf8')]),
)

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

const BASES: Record<string, string[]> = { 'conversation-bg': ['SessionDrawer.vue'] }

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

function rulesReading(css: string, slot?: string): { selectors: string[]; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((rule) => slot === undefined || rule[2]!.includes(`var(--${slot}-color,`))
    .map((rule) => ({ selectors: rule[1]!.split(',').map((part) => part.trim()), body: rule[2]! }))
}

const CLASSES = readFileSync(join(RENDERER, 'assets/classes.css'), 'utf8')
const SHARED_GROUNDS: Record<string, string> = {
  'ConversationPane.vue': 'conversation-pane',
  'NewConversation.vue': 'conversation-pane',
  'ProvidersScreen.vue': 'providers-surface',
  'ReadingPane.vue': 'reading-pane',
  'RecentActivity.vue': 'activity-surface',
  'RecoveryApp.vue': 'recovery',
  'SessionLibrary.vue': 'library',
  'ToolsRegister.vue': 'tools-surface',
  'WaitingOnYou.vue': 'waiting-surface',
}
const STYLE_IMPORTS = {
  main: readFileSync(join(RENDERER, 'main.ts'), 'utf8'),
  recovery: readFileSync(join(RENDERER, 'recovery.ts'), 'utf8'),
  base: readFileSync(join(RENDERER, 'assets/base.css'), 'utf8'),
}
function effectiveSource(
  name: string,
  source: string,
  shared = CLASSES,
  imports = STYLE_IMPORTS,
): string {
  const root = SHARED_GROUNDS[name]
  if (!root) {
    const template = /<template>([\s\S]*?)<\/template>/.exec(source)?.[1] ?? ''
    const optedIn = [...template.matchAll(/\bclass="([^"]*)"/g)].some((attribute) =>
      attribute[1]!.split(/\s+/).includes('bb-conversation-ground'),
    )
    expect(optedIn, `${name} is an unlisted shared-ground consumer`).toBe(false)
    return source
  }
  const compound = `.${root}.bb-conversation-ground`
  for (const entry of [imports.main, imports.recovery])
    expect(entry).toContain("import './assets/base.css'")
  expect(imports.base).toContain("@import './classes.css';")
  const tokensAt = imports.base.indexOf("@import './tokens.css';")
  const classesAt = imports.base.indexOf("@import './classes.css';")
  expect(tokensAt).toBeGreaterThan(-1)
  expect(classesAt).toBeGreaterThan(tokensAt)
  const rules = rulesReading(shared)
  const matching = (selector: string): string[] =>
    rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body)
  const template = /<template>([\s\S]*?)<\/template>/.exec(source)?.[1] ?? ''
  const hooks: Record<string, string> = {
    'ConversationPane.vue': 'conversation-pane',
    'NewConversation.vue': 'new-conversation-surface',
    'ProvidersScreen.vue': 'providers-screen',
    'ReadingPane.vue': 'reading-pane',
    'RecentActivity.vue': 'recent-activity',
    'RecoveryApp.vue': 'recovery',
    'SessionLibrary.vue': 'session-library',
    'ToolsRegister.vue': 'tools-register',
    'WaitingOnYou.vue': 'waiting-on-you',
  }
  const optsIn = [...template.matchAll(/<(?:main|section)\b[^>]*>/g)].some((element) => {
    const names = /\bclass="([^"]*)"/.exec(element[0])?.[1]?.split(/\s+/) ?? []
    return (
      names.includes(root) &&
      names.includes('bb-conversation-ground') &&
      element[0].includes(`data-cy="${hooks[name]}"`)
    )
  })
  expect(optsIn, `${name} opts its ground root into ${compound}`).toBe(true)
  const grounds = matching(compound)
  expect(grounds, `${name} has one shared ground rule`).toHaveLength(1)
  const resets = matching(`${compound} > *`)
  expect(resets, `${name} resets direct children`).toHaveLength(1)
  expect(resets[0]).toMatch(/image-rendering:\s*auto;/)
  const fallbacks: Record<string, string> = {
    color: 'var(--chat-bg)',
    image: 'var(--paper-wash)',
    position: '0% 0%',
    repeat: 'repeat',
    size: 'auto',
    rendering: 'auto',
  }
  for (const longhand of FILL_LONGHANDS) {
    expect(grounds[0], `${name} preserves ${longhand} fallback`).toContain(
      `${PROPERTY[longhand]}: var(--conversation-bg-${longhand}, ${fallbacks[longhand]});`,
    )
  }
  expect(grounds[0]).toContain('color: var(--text);')
  return source + `\n${compound} {${grounds[0]}}`
}

describe('the window paints a theme’s backgrounds with longhands', () => {
  it.each(Object.entries(SLOTS))('--%s', (slot, files) => {
    const bases = BASES[slot] ?? []
    const sources = [...COMPONENTS].map(
      ([name, source]) => [name, effectiveSource(name, source)] as const,
    )
    const found = sources.filter(([, src]) => src.includes(`var(--${slot}-color,`))
    if (slot === 'conversation-bg') {
      expect(Object.keys(SHARED_GROUNDS)).toHaveLength(9)
      expect(files).toHaveLength(11)
      expect(bases).toEqual(['SessionDrawer.vue'])
      for (const entry of ['main.ts', 'recovery.ts']) {
        expect(readFileSync(join(RENDERER, entry), 'utf8')).toContain("import './assets/base.css'")
      }
      expect(readFileSync(join(RENDERER, 'assets/base.css'), 'utf8')).toContain(
        "@import './classes.css';",
      )
      const original = COMPONENTS.get('NewConversation.vue')!
      expect(() => effectiveSource('UnlistedGround.vue', original)).toThrow()
      expect(() =>
        effectiveSource(
          'NewConversation.vue',
          original,
          CLASSES.replaceAll(
            '.conversation-pane.bb-conversation-ground',
            '.missing-ground.bb-conversation-ground',
          ),
        ),
      ).toThrow()
      expect(() =>
        effectiveSource(
          'NewConversation.vue',
          original,
          CLASSES.replace(
            'var(--conversation-bg-color, var(--chat-bg))',
            'var(--conversation-bg-color, transparent)',
          ),
        ),
      ).toThrow()
      expect(() =>
        effectiveSource(
          'NewConversation.vue',
          original,
          CLASSES.replace(
            '.waiting-surface.bb-conversation-ground > * {\n  image-rendering: auto;',
            '.waiting-surface.bb-conversation-ground > * {\n  image-rendering: pixelated;',
          ),
        ),
      ).toThrow()
      for (const key of ['main', 'recovery'] as const) {
        expect(() =>
          effectiveSource('NewConversation.vue', original, CLASSES, {
            ...STYLE_IMPORTS,
            [key]: STYLE_IMPORTS[key].replace("import './assets/base.css'", ''),
          }),
        ).toThrow()
      }
      expect(() =>
        effectiveSource('NewConversation.vue', original, CLASSES, {
          ...STYLE_IMPORTS,
          base: STYLE_IMPORTS.base.replace("@import './classes.css';", ''),
        }),
      ).toThrow()
      expect(original).toContain('conversation-pane bb-conversation-ground')
      expect(() =>
        effectiveSource('NewConversation.vue', original.replace('bb-conversation-ground', '')),
      ).toThrow()
      expect(() =>
        effectiveSource(
          'NewConversation.vue',
          original,
          CLASSES.replace('background-image: var(--conversation-bg-image, var(--paper-wash));', ''),
        ),
      ).toThrow()
      expect(() =>
        effectiveSource(
          'NewConversation.vue',
          original,
          CLASSES.replace(
            'background-color: var(--conversation-bg-color, var(--chat-bg));',
            'background-color: var(--wrong-slot-color, var(--chat-bg));',
          ),
        ),
      ).toThrow()
      expect(() =>
        effectiveSource(
          'NewConversation.vue',
          original,
          CLASSES.replace(
            'background-color: var(--conversation-bg-color, var(--chat-bg));',
            'background: var(--conversation-bg-color, var(--chat-bg));',
          ),
        ),
      ).toThrow()
    }
    expect(found.map(([n]) => n).sort()).toEqual([...files, ...bases].sort())
    for (const [name, src] of found) {
      const rules = rulesReading(src, slot).map((rule) => rule.body)
      expect(rules.length, name).toBeGreaterThan(0)
      if (bases.includes(name)) {
        expect(src, name).not.toContain(`var(--${slot}-image,`)
        for (const rule of rules)
          expect(rule, name).toMatch(
            new RegExp(`linear-gradient\\(\\s*var\\(--${slot}-color, transparent\\),`),
          )
        continue
      }
      const painting = rules.filter((r) => r.includes(`var(--${slot}-image,`))
      const own = painting.filter((r) => r.includes(`background-color: var(--${slot}-color,`))
      expect(own, `${name} paints --${slot} in one rule`).toHaveLength(1)
      for (const longhand of FILL_LONGHANDS) {
        expect(own[0], `${name}: ${PROPERTY[longhand]}`).toMatch(
          new RegExp(`${PROPERTY[longhand]}: var\\(--${slot}-${longhand},`),
        )
      }
      if (
        slot === 'conversation-bg' &&
        ['SettingsScreen.vue', 'ThemesSection.vue'].includes(name)
      ) {
        const localFallbacks: Record<string, string> = {
          color:
            name === 'ThemesSection.vue' ? 'var(--preview-page, var(--chat-bg))' : 'var(--chat-bg)',
          image: name === 'ThemesSection.vue' ? 'none' : 'var(--paper-wash)',
          position: '0% 0%',
          repeat: 'repeat',
          size: 'auto',
          rendering: 'auto',
        }
        for (const longhand of FILL_LONGHANDS) {
          expect(own[0], `${name} local ${longhand} fallback`).toContain(
            `${PROPERTY[longhand]}: var(--conversation-bg-${longhand}, ${localFallbacks[longhand]});`,
          )
        }
      }
      expect(own[0], name).not.toMatch(/(^|[\s;])background:/)
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
