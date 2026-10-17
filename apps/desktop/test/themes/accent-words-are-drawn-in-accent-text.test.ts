import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Words in the accent colour are drawn in --accent-text, the accent worked out for text, which the
 * readability check measures at 4.5:1. The raw --accent colours only marks: icons, arrows and the
 * like, held to 3:1 as the focus ring is. Words in the second accent are drawn in --accent-2-text
 * the same way, and the raw --accent-2 colours no words.
 */

const COMPONENTS = join(__dirname, '../../src/renderer/src/components')

/** A `color` declaration whose value is the raw `name`, however it is spelled. */
const rawColour = (name: string): RegExp =>
  new RegExp(
    String.raw`(?:^|[;{\s])color\s*:\s*var\(\s*` +
      name +
      String.raw`\s*(?:,[^;]*)?\)\s*(?:!important\s*)?(?:;|$)`,
    'i',
  )

const RAW_ACCENT = rawColour('--accent')
const RAW_ACCENT_2 = rawColour('--accent-2')

/**
 * Every selector, one per entry of each selector list, whose rule colours with the raw accent.
 * Comments are dropped, a selector list is split at its top-level commas, and whitespace inside a
 * selector is folded to one space.
 */
function rawAccentSelectors(css: string, raw: RegExp = RAW_ACCENT): string[] {
  const out: string[] = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!raw.test(m[2]!)) continue
    let depth = 0
    let part = ''
    for (const ch of m[1]!) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        out.push(part)
        part = ''
      } else part += ch
    }
    out.push(part)
  }
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s !== '')
}

const ASSETS = join(__dirname, '../../src/renderer/src/assets')

/** Every selector colouring with `raw` in the components and the shared stylesheets, as `File: selector`. */
function inComponents(raw: RegExp = RAW_ACCENT): string[] {
  const out: string[] = []
  for (const name of ['base.css', 'classes.css']) {
    const css = readFileSync(join(ASSETS, name), 'utf8')
    for (const selector of rawAccentSelectors(css, raw)) out.push(`${name}: ${selector}`)
  }
  for (const name of readdirSync(COMPONENTS).filter((n) => n.endsWith('.vue'))) {
    const src = readFileSync(join(COMPONENTS, name), 'utf8')
    const at = src.indexOf('<style')
    if (at === -1) continue
    const css = src.slice(src.indexOf('>', at) + 1)
    for (const selector of rawAccentSelectors(css, raw)) out.push(`${name}: ${selector}`)
  }
  return out.sort()
}

/** Every mark the raw accent may colour: each renders an icon and no words. */
const MARKS = [
  'AgentCard.vue: .said-icon',
  'AgentCard.vue: .task-count.active .icon',
  'AgentCard.vue: .workspace-control',
  'AgentSectionsSheet.vue: .glyph-icon',
  'CardCompactDoor.vue: .compact-press',
  'CardSection.vue: .icon.accent',
  'KeptRules.vue: .kept-icon',
  'MemoryLoadedEntry.vue: .ml-link .arrow',
  'MemoryNoteEntry.vue: .mn-link .arrow',
  'ProvidersScreen.vue: .debug-icon',
  'ProvidersScreen.vue: .page-icon',
  'SessionContext.vue: .hist-row .jump .arrow',
  'SessionPanel.vue: .came-up',
  'SettingsScreen.vue: .setting-icon',
  'SettingsScreen.vue: .settings-icon',
  'TaskList.vue: .ticon',
  'ThemesSection.vue: .themes-icon',
]

describe('accent-coloured words', () => {
  it('⛔ only marks take the raw accent; every word takes the accent text', () => {
    expect(inComponents()).toEqual([...MARKS].sort())
  })

  it('⛔ no word takes the raw second accent; every one takes its text form', () => {
    expect(inComponents(RAW_ACCENT_2)).toEqual([])
  })

  describe('the guard reads every way a rule can be written', () => {
    it('⛔ a selector over several lines', () => {
      expect(
        rawAccentSelectors('.card\n  .word-label,\n.other {\n  color: var(--accent);\n}'),
      ).toEqual(['.card .word-label', '.other'])
    })

    it('⛔ a word grouped before an allowed mark', () => {
      expect(rawAccentSelectors('.word, .said-icon { color: var(--accent); }')).toEqual([
        '.word',
        '.said-icon',
      ])
    })

    it('⛔ another spelling of the declaration', () => {
      for (const decl of [
        'COLOR:VAR( --accent );',
        'color: var(--accent, #c2410c);',
        'color : var( --accent ) !important;',
        'color:var(--accent)!important;',
        'color: var(--accent)',
      ]) {
        expect(rawAccentSelectors(`.word { ${decl} }`), decl).toEqual(['.word'])
      }
    })

    it('⛔ the second accent, written every way', () => {
      expect(
        rawAccentSelectors(
          '.card\n  .word-label,\n.other {\n  color: var(--accent-2);\n}',
          RAW_ACCENT_2,
        ),
      ).toEqual(['.card .word-label', '.other'])
      expect(rawAccentSelectors('.word, .dot { color: var(--accent-2); }', RAW_ACCENT_2)).toEqual([
        '.word',
        '.dot',
      ])
      for (const decl of [
        'COLOR:VAR( --accent-2 );',
        'color: var(--accent-2, #7953b9);',
        'color : var( --accent-2 ) !important;',
        'color:var(--accent-2)!important;',
        'color: var(--accent-2)',
      ]) {
        expect(rawAccentSelectors(`.word { ${decl} }`, RAW_ACCENT_2), decl).toEqual(['.word'])
      }
    })

    it('⚑ and the second accent’s text form, fills and borders are left alone, and apart from the first', () => {
      for (const decl of [
        'color: var(--accent-2-text);',
        'background: var(--accent-2);',
        'border-color: var(--accent-2);',
        'color: var(--accent);',
      ]) {
        expect(rawAccentSelectors(`.word { ${decl} }`, RAW_ACCENT_2), decl).toEqual([])
      }
      expect(rawAccentSelectors('.word { color: var(--accent-2); }')).toEqual([])
    })

    it('⚑ and leaves the accent text, fills and borders alone', () => {
      for (const decl of [
        'color: var(--accent-text);',
        'background-color: var(--accent);',
        'border-color: var(--accent);',
      ]) {
        expect(rawAccentSelectors(`.word { ${decl} }`), decl).toEqual([])
      }
    })
  })
})
