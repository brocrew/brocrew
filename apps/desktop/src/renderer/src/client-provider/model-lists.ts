import { createModelLists, type ModelLists } from '../lib/model-lists'
import type { ClientProviderApi } from '../../../shared/client-provider-api'

let shared = new WeakMap<ClientProviderApi, ModelLists>()

export function modelListsForClient(api: ClientProviderApi): ModelLists {
  let lists = shared.get(api)
  if (!lists) {
    lists = createModelLists(() => api)
    shared.set(api, lists)
  }
  return lists
}

export function forgetClientModelLists(): void {
  shared = new WeakMap<ClientProviderApi, ModelLists>()
}
