import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import { wearTheme } from './themes'

const BASE = (() => {
  const read = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  return read.theme
})()

const WHITE = { waiting: '#ffffff', success: '#ffffff', danger: '#ffffff', auto: '#ffffff' }

/** Themes the check accepts, each near its limits on the surfaces this piece measures. */
const HOSTILE: Record<string, Record<string, unknown>> = {
  'see-through-dark': {
    frame: { ink: '#ffffff', paper: '#000000', accent: '#ffffff' },
    content: { ink: '#ffffff', paper: '#000000', accent: '#4c6ef5', scheme: 'dark' },
    shared: { page: 0, tint: 0 },
    status: WHITE,
    tokens: {
      content: { panel: '#00000000', 'accent-text': '#b0b0b0', 'accent-2-text': '#b0b0b0' },
    },
    conversation: { background: { color: '#111111' } },
    drawer: { background: { color: '#00000000' }, card: { fill: '#00000000' } },
  },
  'light-second-accent': { content: { accent2: '#7a64c0' } },
  'light-accent': {
    shared: { page: 0 },
    content: { accent: '#4c6ef5' },
    tokens: { content: { 'accent-solid-bg': '#3b5bdb' } },
  },
  'light-frame': {
    frame: { ink: '#1b2238', paper: '#ffffff', accent: '#4338ca' },
    shared: { tint: 14 },
  },
}

/** Each hostile theme as the check reads it. */
const ACCEPTED = new Map<string, Theme>(
  Object.entries(HOSTILE).map(([id, own]) => {
    const file = { format: 1, id, name: id, extends: 'defined', ...own }
    const read = validateTheme(file, { assets: new Map(), builtIns: new Map([['defined', BASE]]) })
    if (!read.ok) throw new Error(`${id} is refused: ${JSON.stringify(read.problems)}`)
    return [id, resolveTheme(read.theme, BASE)]
  }),
)

const SHIPPED = ['classic', 'defined', 'brocrew', 'synthwave'] as const
export type ThemeName = (typeof SHIPPED)[number] | string

export function wearReadabilityTheme(theme: ThemeName): void {
  const own = ACCEPTED.get(theme)
  if (own) applyTheme(own)
  else if (theme === 'classic') applyTheme(null)
  else wearTheme(theme as 'defined' | 'brocrew' | 'synthwave')
}

export const READABILITY_THEMES = [...SHIPPED, ...ACCEPTED.keys()]
