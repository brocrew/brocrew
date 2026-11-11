import type { ClientApi } from '../../../shared/client-api'
import { createAgentStore, type AgentStore } from '../lib/agent-store'

let shared = new WeakMap<ClientApi, AgentStore>()

export function agentStoreForClient(api: ClientApi): AgentStore {
  let store = shared.get(api)
  if (!store) {
    const agents = api.agents
    if (!agents) throw new Error('The client does not provide agent reads and intents')
    store = createAgentStore(agents)
    shared.set(api, store)
  }
  return store
}

export function forgetClientAgentStores(): void {
  shared = new WeakMap<ClientApi, AgentStore>()
}
