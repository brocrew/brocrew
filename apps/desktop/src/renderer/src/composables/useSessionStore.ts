import { createSessionStore, type SessionStore } from '../lib/session-store'

/**
 * The window's one store, over the real bridge.
 *
 * A singleton because the bridge hands every session's events to every listener: a second store
 * would fold each event twice and the ordinal check would report a gap on every one of them.
 *
 * This file exists only to bind {@link createSessionStore} to `window`. Everything the store
 * actually does lives in `lib/session-store.ts`, which knows nothing about a window and is driven
 * directly by tests.
 */
let shared: SessionStore | null = null

/**
 * ⚠️ **A NEW store starts by asking the host what it is already running** (100).
 *
 * Keep one store for what this window started. Recreating it loses the renderer's live-conversation memory while main still holds the provider, making the rail look empty and reopening conflict with the existing session.
 *
 * Measured on his instance: 373 modules carrying Vite hot-update timestamps, the last of them six
 * minutes before he pressed the button, and a document that had never navigated.
 *
 * Not awaited, deliberately: nothing renders differently for waiting, the sessions arrive through
 * the same path a resume's do, and making the first `useSessionStore()` asynchronous would push the
 * change into every caller for no gain. `attachOpen` swallows its own failure.
 */
export function useSessionStore(): SessionStore {
  if (shared === null) {
    shared = createSessionStore(window.api.runtime)
    void shared.attachOpen()
  }
  return shared
}

// Hot reload re-evaluates this module and forgets the store, while the old one keeps listening:
// every event would then be folded twice and every ordinal check would report a gap. Dev-only,
// and invisible in production — but it would look exactly like a bug in the code being edited.
//
// ⚠️ **It also forgets every OPEN session, and that half was never dev-only in its consequences**
// (100): the host kept the slot. The dispose stays — two stores folding the same stream is a real
// defect — and what changed is that the store built after it reconciles instead of starting blind.
import.meta.hot?.dispose(() => {
  shared?.dispose()
  shared = null
})
