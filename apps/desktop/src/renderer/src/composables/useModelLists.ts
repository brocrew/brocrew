import type { ModelLists } from '../lib/model-lists'
import { modelListsForClient, forgetClientModelLists } from '../client-provider/model-lists'
import type { ClientProviderApi } from '../../../shared/client-provider-api'
import { useClientProviders } from '../client-provider/injection'

/**
 * ⚑ **UI-012 · the window's one holder of the model lists**, over the real bridge — a singleton for
 * `useAgentStore`'s reason: two holders would be two answers to *"what can Claude run"* on one
 * screen. ⚠️ The bridge is reached only when a list is READ, so building it touches no `window`.
 */
export function useModelLists(api: ClientProviderApi = useClientProviders()): ModelLists {
  return modelListsForClient(api)
}

// Hot reload re-evaluates this module: the next caller gets an empty holder, not a stale one.
import.meta.hot?.dispose(() => {
  forgetClientModelLists()
})
