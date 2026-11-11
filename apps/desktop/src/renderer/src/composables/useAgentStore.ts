import type { AgentStore } from '../lib/agent-store'
import { agentStoreForClient, forgetClientAgentStores } from '../client-provider/agent-store'
import { useClientApi } from '../client-provider/injection'

/**
 * The window's one agent store, supplied through its stable client.
 *
 * A singleton, because two stores would be two answers to *"may `pm` spawn `worker`"* on one
 * screen, and the rail's switch and the sheet would disagree the moment either
 * wrote. Distinct injected clients keep separate stores; surfaces in the same window share one.
 *
 * ⚠️ **Nothing is loaded here** — a store built at import time would put an IPC call on every module
 * graph that touches it. The surfaces that need the list ask for it.
 */
export function useAgentStore(): AgentStore {
  return agentStoreForClient(useClientApi())
}

// Hot reload re-evaluates this module and forgets the store. Explicit, so the next caller gets an
// empty list rather than a stale one.
import.meta.hot?.dispose(() => {
  forgetClientAgentStores()
})
