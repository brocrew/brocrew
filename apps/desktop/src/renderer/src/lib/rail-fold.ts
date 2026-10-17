/**
 * Whether the left menu is collapsed to its icons. Below {@link RAIL_NARROW_BELOW} wide the window
 * collapses it by itself; a press opens it again until the window widens, and that is not
 * remembered. At that width and up, it follows the choice a person made, remembered on this
 * computer.
 */
export const RAIL_NARROW_BELOW = 1280

/** The collapsed menu's width, mirrored from `tokens.css` (`--rail-w-collapsed`). */
export const RAIL_W_COLLAPSED = 64

export interface RailFoldState {
  /** The window is narrower than {@link RAIL_NARROW_BELOW}. */
  readonly narrow: boolean
  /** The remembered choice, for a wide window. */
  readonly chosenCollapsed: boolean
  /** A press opened it while the window is narrow. */
  readonly openedWhileNarrow: boolean
}

export function railCollapsed(state: RailFoldState): boolean {
  return state.narrow ? !state.openedWhileNarrow : state.chosenCollapsed
}

/** The words on the toggle, which say what a press does. */
export const COLLAPSE_THE_MENU = 'Collapse the menu'
export const EXPAND_THE_MENU = 'Expand the menu'
