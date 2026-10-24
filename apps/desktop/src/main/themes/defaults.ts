import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import type { Theme } from '../../shared/themes/theme'
import { DATABASE_FILE } from '../recovery/layout'
import { saysAbsent } from './state'

/** The default look: what a new workspace starts in, and what "Default look" gives. */
export const DEFAULT_THEME_ID = 'crew-night'
/**
 * The look a workspace keeps when it already held data before Crew Night became the default and
 * never chose a theme: classic, the appearance it has always had.
 */
export const EXISTING_INSTALL_THEME_ID = 'classic'
export const CLASSIC_THEME: Theme = { format: 1, id: 'classic', name: 'Classic' }
export const DEFAULT_THEME_BACKGROUND = '#182135'
export const BUILT_IN_THEME_IDS = [
  'classic',
  'defined',
  'brocrew',
  'sober',
  'synthwave',
  'crew-night',
  'cartoon',
  'kids',
  'luxury',
  'beach',
  'valentine',
  'paper',
  'notebook',
  'zen',
] as const
/**
 * Built-ins the app ships only as a base a saved theme may extend: not listed, and not chosen.
 * BroCrew's colours are the default look; a theme duplicated from its sample still loads.
 */
export const HIDDEN_BASE_THEME_IDS: readonly string[] = ['brocrew']

/**
 * The look a workspace with no saved choice starts in. A workspace whose database is already there
 * when the themes are first read held data before this version, so it keeps classic; one the
 * system says has no database yet is new, and starts in Crew Night. A database that can't be looked
 * at is taken to be there. The store writes the answer down once as the workspace's choice.
 */
export function startingThemeFor(
  userData: string,
  look: (path: string) => unknown = lstatSync,
): string {
  try {
    look(join(userData, DATABASE_FILE))
    return EXISTING_INSTALL_THEME_ID
  } catch (error) {
    return saysAbsent(error) ? DEFAULT_THEME_ID : EXISTING_INSTALL_THEME_ID
  }
}

/** The theme store's defaults for a workspace: the default look, and the look it starts in. */
export function themeDefaultsFor(userData: string): {
  readonly defaultTheme: string
  readonly startingTheme: string
} {
  return { defaultTheme: DEFAULT_THEME_ID, startingTheme: startingThemeFor(userData) }
}
