import type {
  ThemeReading,
  ThemeRow,
  ThemeSnapshot,
  ThemesBridge,
} from '../../src/shared/theme-library'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import brocrew from '../../resources/themes/brocrew/theme.json'
import defined from '../../resources/themes/defined/theme.json'
import synthwave from '../../resources/themes/synthwave/theme.json'
import brocrewCrew from '../../resources/themes/brocrew/assets/crew.png?url'
import brocrewNetwork from '../../resources/themes/brocrew/assets/network.png?url'
import brocrewNetworkLight from '../../resources/themes/brocrew/assets/network-light.png?url'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'

/**
 * Fake data for the Themes section: the built-in themes a person can choose, one theme of the
 * person's own, and one that can't be used. BroCrew ships only as a base, so it isn't listed.
 * The built-ins are the real files; their pictures are served by the host, which a scene
 * doesn't have, so they paint their colours only.
 */
const DEFINED = defined as unknown as Theme
const BUILT_IN: Record<string, Theme> = {
  defined: DEFINED,
  brocrew: resolveTheme(brocrew as unknown as Theme, DEFINED),
  synthwave: resolveTheme(synthwave as unknown as Theme, DEFINED),
}
const MINE: Theme = resolveTheme(
  {
    format: 1,
    id: 'sea-glass',
    name: 'Sea glass',
    extends: 'defined',
    frame: { ink: '#eafaf7', paper: '#0f3b3a', accent: '#5fe3c8' },
    content: { ink: '#123432', paper: '#f6fbfa', accent: '#0f8f7c' },
    rail: { background: { color: '#0f3b3a' } },
  },
  DEFINED,
)

const ROWS: ThemeRow[] = [
  { id: 'classic', name: 'Classic', source: 'built-in', status: 'ok' },
  { id: 'defined', name: 'Defined', source: 'built-in', status: 'ok' },
  { id: 'synthwave', name: 'Synthwave', source: 'built-in', status: 'ok' },
  { id: 'sea-glass', name: 'Sea glass', source: 'mine', status: 'ok' },
  {
    id: 'half-done',
    name: 'half-done',
    source: 'mine',
    status: 'refused',
    reason:
      'Text in the conversation would be too faint: 2.1 to 1 against its background, and it needs at least 4.5 to 1. Darken `content.ink` or lighten `content.paper`.',
  },
]

/** Puts a themes bridge on the fake window, with `active` in use. */
export function themesBridge(active = 'synthwave'): void {
  const snapshot = async (): Promise<ThemeSnapshot> => ({ active, requested: active, themes: ROWS })
  const read = async (id = active): Promise<ThemeReading> => ({
    active,
    theme: id === 'sea-glass' ? MINE : (BUILT_IN[id] ?? null),
    version: null,
    assetVersions: {},
  })
  const done = async () => ({
    outcome: 'refused' as const,
    rail: 'theme-unknown' as const,
    problems: [],
  })
  const themes: ThemesBridge = {
    list: snapshot,
    read,
    set: done,
    duplicate: done,
    delete: done,
    openFolder: async () => ({ outcome: 'ok' }),
    onChanged: () => () => {},
  }
  window.api = { ...(window.api ?? {}), themes } as typeof window.api
}

const PICTURES: Record<string, string> = {
  '@brocrew/assets/network.png': brocrewNetwork,
  '@brocrew/assets/network-light.png': brocrewNetworkLight,
  '@brocrew/assets/crew.png': brocrewCrew,
  'assets/network.png': brocrewNetwork,
  'assets/network-light.png': brocrewNetworkLight,
  'assets/crew.png': brocrewCrew,
}

/**
 * Puts one of the shipped themes on the page, its pictures served by the scene's own server
 * instead of the host's theme scheme.
 */
export function wearTheme(id: 'defined' | 'brocrew' | 'synthwave'): void {
  const result = applyTheme(BUILT_IN[id]!, { assetUrl: (path) => PICTURES[path] ?? '' })
  if (!result.ok) throw new Error(result.error)
}
