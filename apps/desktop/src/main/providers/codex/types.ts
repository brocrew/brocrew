import type { CodexKeyOutcome } from '@brobot2/runtime/codex'
/** Read the saved key for process-local launch auth and clear a legacy key login from a home. */
export interface CodexKeySeam {
  /** The key and when it was saved, or `null`. Throws when a saved key cannot be read. */
  current():
    | { readonly key: string; readonly setAt: number }
    | null
    | Promise<{ readonly key: string; readonly setAt: number } | null>
  /** Presence alone never needs to decrypt a key. */
  isSaved?(): boolean
  change(providerHome: string): Promise<CodexKeyOutcome>
}

export type { ProviderSignIn as CodexSignIn } from '../auth-types'
