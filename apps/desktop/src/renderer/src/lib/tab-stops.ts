/** The elements a person can usually Tab to. Callers may add stops of their own. */
export const TAB_STOPS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Whether the element is laid out: `display: none` on it or an ancestor takes it off the cycle. */
export const isLaidOut = (el: HTMLElement): boolean => el.offsetParent !== null

/**
 * The tab stops inside `root`, in document order: the elements matching `selector` that `reachable`
 * accepts. The focused element always stays, so a cycle can find where it starts from.
 */
export function tabStopsIn(
  root: HTMLElement | null,
  selector: string,
  reachable: (el: HTMLElement) => boolean,
): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => el === document.activeElement || reachable(el),
  )
}
