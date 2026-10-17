/**
 * The notice an agent's theme change raises, so a change nobody on screen asked for is explained:
 * "{agent} changed the theme to {name}." Going back is the person's own choice, in the Themes
 * section or View › Default look. A newer change closes the notice of an older one, whoever made it.
 */
import type { ThemeChanged } from '../../../shared/theme-library'
import type { OverlayStore } from './overlay-store'
import { THEME_WORDS } from './theme-words'

/** Handles every change the window applied: closes the last notice, and raises one for an agent's. */
export function themeChangeNotices(
  overlays: Pick<OverlayStore, 'notify' | 'dismiss'>,
): (change: ThemeChanged) => void {
  let shown: number | undefined
  return (change) => {
    if (shown !== undefined) overlays.dismiss(shown)
    shown = undefined
    if (change.actor === undefined || change.previous === change.active) return
    const name = change.themes.find((row) => row.id === change.active)?.name ?? change.active
    shown = overlays.notify(THEME_WORDS.changedBy(change.actor, name))
  }
}
