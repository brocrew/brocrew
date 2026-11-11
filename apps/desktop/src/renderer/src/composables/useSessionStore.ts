import { inject, onScopeDispose, provide, type InjectionKey } from 'vue'
import { useClientApi } from '../client-provider/injection'
import { createSessionStore, type SessionStore } from '../lib/session-store'

const SESSION_STORE: InjectionKey<SessionStore> = Symbol('session store')

/** RuntimeScreen owns the store; its descendants share the same session streams. */
export function useSessionStore(): SessionStore {
  const inherited = inject(SESSION_STORE, null)
  if (inherited) return inherited

  const sessions = useClientApi().sessions
  if (!sessions) throw new Error('The client does not provide session reads and intents')
  const store = createSessionStore(sessions)
  provide(SESSION_STORE, store)
  onScopeDispose(() => store.dispose())
  // Reconcile live conversations after mounting or hot reload. attachOpen owns read failures.
  void store.attachOpen()
  return store
}
