import type { ThemeRail, ThemeRow } from '../../shared/theme-library'

export const THEME_TOOL_NAMES = ['list_themes', 'save_theme', 'set_theme'] as const
export type ThemeToolName = (typeof THEME_TOOL_NAMES)[number]

export const THEME_TOOL_DESCRIPTIONS = {
  list_themes:
    "List this app's themes and the theme this workspace uses. Name an id to read its settings, or set catalogue to true to read the accepted settings and limits. Tokens are listed per zone: frame (the title bar and left rail) and content (the conversation and its panels). Some tokens can be set only in content. Use this only when the person asks for a look.",
  save_theme:
    'Save a theme for this app. Supply its settings and any pictures or fonts as files or base64. Tokens are listed per zone: frame (the title bar and left rail) and content (the conversation and its panels). Some tokens can be set only in content. Set replace to true to replace a saved theme, and activate to true to use it in this workspace. Built-in themes need a new id. Use this only when the person asks for a look.',
  set_theme:
    "Use a theme in this workspace's window. Name an id from list_themes. The person can undo the change. Use this only when the person asks for a look.",
} as const

export const THEME_TOOL_REASONS: Readonly<Record<ThemeRail, string>> = {
  'theme-invalid': 'The theme cannot be used. The problems below say what to fix.',
  'theme-is-built-in': 'A built-in theme cannot be replaced. Save it under a new id.',
  'theme-exists': 'That theme already exists. Set replace to true to replace it.',
  'theme-unknown':
    'That theme is not available. Call list_themes to see the themes this app can use.',
  'theme-too-large': 'The theme is over the file or size limit. Use fewer or smaller files.',
}

export const activeThemeSaid = (id: string): string => `Active theme: ${id}.`
export const savedThemeSaid = (id: string, version: string, active: string): string =>
  `Saved ${id}, version ${version}. ${activeThemeSaid(active)}`
export const setThemeSaid = (active: string, previous: string): string =>
  `${activeThemeSaid(active)} Previous theme: ${previous}.`
export const themeRowSaid = (row: ThemeRow): string =>
  `${row.id} · ${row.name} · ${row.source} · ${row.status}${row.reason ? ` · ${row.reason}` : ''}`
