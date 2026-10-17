import { createModelLists, type ModelLists } from '../lib/model-lists'

/**
 * ⚑ **UI-012 · the window's one holder of the model lists**, over the real bridge — a singleton for
 * `useAgentStore`'s reason: two holders would be two answers to *"what can Claude run"* on one
 * screen. ⚠️ The bridge is reached only when a list is READ, so building it touches no `window`.
 */
let shared: ModelLists | null = null

export function useModelLists(): ModelLists {
  shared ??= createModelLists(() => window.api.runtime)
  return shared
}

// Hot reload re-evaluates this module: the next caller gets an empty holder, not a stale one.
import.meta.hot?.dispose(() => {
  shared = null
})
