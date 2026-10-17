import type { Ref } from 'vue'
import { usePersistentToggle } from './usePersistentToggle'

/**
 * ⚑ **W4.13 · the window's one debug-mode switch** — a window preference, kept in `localStorage`
 * like the window's other preferences, so it holds across restarts and windows. Off by default.
 */
let shared: Ref<boolean> | null = null

export function useDebugMode(): Ref<boolean> {
  shared ??= usePersistentToggle('brobot2.debugMode', false)
  return shared
}

// Hot reload re-evaluates this module: the next caller reads the stored value afresh.
import.meta.hot?.dispose(() => {
  shared = null
})
