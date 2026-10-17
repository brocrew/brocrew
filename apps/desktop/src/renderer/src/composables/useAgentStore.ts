import { createAgentStore, type AgentStore } from '../lib/agent-store'

/**
 * The window's one agent store, over the real bridge (355).
 *
 * A singleton, because two stores would be two answers to *"may `pm` spawn `worker`"* on one
 * screen, and the rail's switch and the sheet would disagree the moment either
 * wrote. This file exists only to bind {@link createAgentStore} to `window`; everything it does
 * lives in `lib/agent-store.ts`, which knows nothing about a window.
 *
 * ⚠️ **Nothing is loaded here** — a store built at import time would put an IPC call on every module
 * graph that touches it. The surfaces that need the list ask for it.
 */
let shared: AgentStore | null = null

export function useAgentStore(): AgentStore {
  shared ??= createAgentStore(window.api.runtime)
  return shared
}

// Hot reload re-evaluates this module and forgets the store. Explicit, so the next caller gets an
// empty list rather than a stale one.
import.meta.hot?.dispose(() => {
  shared = null
})
