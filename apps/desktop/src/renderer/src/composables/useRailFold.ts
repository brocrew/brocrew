import { computed, effectScope, ref, type ComputedRef } from 'vue'
import { RAIL_NARROW_BELOW, railCollapsed } from '../lib/rail-fold'
import { usePersistentToggle } from './usePersistentToggle'

export interface RailFold {
  readonly collapsed: ComputedRef<boolean>
  /** A person pressed the toggle: remembered when the window is wide, until it widens when narrow. */
  toggle(): void
}

let made: RailFold | null = null

/**
 * The window's one left-menu fold, shared by the screen that sizes the menu's column and the menu
 * that draws the toggle. Made once, outside any component, so no unmount stops its saving or its
 * width listener.
 */
export function useRailFold(): RailFold {
  if (made !== null) return made
  made = effectScope(true).run(() => {
    const chosenCollapsed = usePersistentToggle('brobot2.railCollapsed', false)
    const query =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(`(max-width: ${String(RAIL_NARROW_BELOW - 0.02)}px)`)
        : null
    const narrow = ref(query?.matches ?? false)
    const openedWhileNarrow = ref(false)
    query?.addEventListener('change', (event) => {
      narrow.value = event.matches
      if (!event.matches) openedWhileNarrow.value = false
    })
    const collapsed = computed(() =>
      railCollapsed({
        narrow: narrow.value,
        chosenCollapsed: chosenCollapsed.value,
        openedWhileNarrow: openedWhileNarrow.value,
      }),
    )
    return {
      collapsed,
      toggle() {
        if (narrow.value) openedWhileNarrow.value = !openedWhileNarrow.value
        else chosenCollapsed.value = !chosenCollapsed.value
      },
    }
  })!
  return made
}
