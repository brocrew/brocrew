import type { Theme, ThemeProblem } from './themes/theme'

export const THEMES_CHANNELS = {
  list: 'themes:list',
  read: 'themes:read',
  set: 'themes:set',
  duplicate: 'themes:duplicate',
  delete: 'themes:delete',
  openFolder: 'themes:open-folder',
  changed: 'themes:changed',
} as const

export type ThemeSource = 'built-in' | 'mine'
export type ThemeRail =
  'theme-invalid' | 'theme-is-built-in' | 'theme-exists' | 'theme-unknown' | 'theme-too-large'

export interface ThemeRefused {
  readonly outcome: 'refused'
  readonly rail: ThemeRail
  readonly problems: readonly ThemeProblem[]
}

export interface ThemeRow {
  readonly id: string
  readonly name: string
  readonly source: ThemeSource
  readonly status: 'ok' | 'refused'
  readonly reason?: string
  readonly problems?: readonly ThemeProblem[]
  readonly version?: string
}

export interface ThemeSnapshot {
  readonly active: string
  readonly requested: string | null
  readonly themes: readonly ThemeRow[]
  readonly reason?: string
}

export interface ThemeReading {
  readonly active: string
  readonly theme: Theme | null
  readonly version: string | null
  readonly assetVersions: Readonly<Record<string, string>>
  readonly reason?: string
}

export interface ThemeSet {
  readonly outcome: 'ok'
  readonly active: string
  readonly previous: string
}

export interface ThemeSaved {
  readonly outcome: 'ok'
  readonly id: string
  readonly version: string
  readonly active: string
  readonly warnings: readonly string[]
}

export interface ThemeDeleted {
  readonly outcome: 'ok'
  readonly id: string
  readonly active: string
}

export interface ThemeAssetInput {
  readonly name: string
  readonly path?: string
  readonly base64?: string
}

export interface ThemeSaveInput {
  readonly theme: unknown
  readonly assets?: readonly ThemeAssetInput[]
  readonly activate?: boolean
  readonly replace?: boolean
}

export interface ThemeChanged extends ThemeSnapshot {
  readonly previous?: string
  readonly actor?: string
}

export interface ThemesBridge {
  list(): Promise<ThemeSnapshot>
  read(id?: string): Promise<ThemeReading | ThemeRefused>
  set(id: string): Promise<ThemeSet | ThemeRefused>
  duplicate(id: string, name: string): Promise<ThemeSaved | ThemeRefused>
  delete(id: string): Promise<ThemeDeleted | ThemeRefused>
  openFolder(): Promise<{ readonly outcome: 'ok' } | ThemeRefused>
  onChanged(listener: (snapshot: ThemeChanged) => void): () => void
}
