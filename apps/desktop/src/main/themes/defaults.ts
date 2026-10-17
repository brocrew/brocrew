import type { Theme } from '../../shared/themes/theme'

// Classic preserves the existing appearance as the default theme.
export const DEFAULT_THEME_ID = 'classic'
export const CLASSIC_THEME: Theme = { format: 1, id: 'classic', name: 'Classic' }
export const DEFAULT_THEME_BACKGROUND = '#182135'
export const BUILT_IN_THEME_IDS = [
  'classic',
  'defined',
  'brocrew',
  'sober',
  'synthwave',
  'cartoon',
  'kids',
  'luxury',
  'beach',
  'valentine',
  'win95',
  'e-ink',
  'notebook',
  'dbz',
  'zen',
  'mario',
] as const
/**
 * Built-ins the app ships only as a base a saved theme may extend: not listed, and not chosen.
 * BroCrew's colours are the default look; a theme duplicated from its sample still loads.
 */
export const HIDDEN_BASE_THEME_IDS: readonly string[] = ['brocrew']
