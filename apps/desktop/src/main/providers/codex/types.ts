import type { CodexKeyChange, CodexKeyOutcome } from '@brobot2/runtime'
export interface CodexKeySeam {
  /** The key and when it was saved, or `null`. Throws when a saved key cannot be read. */
  current():
    | { readonly key: string; readonly setAt: number }
    | null
    | Promise<{ readonly key: string; readonly setAt: number } | null>
  /** Presence alone never needs to decrypt a key. */
  isSaved?(): boolean
  change(
    providerHome: string,
    change: CodexKeyChange,
    signal?: AbortSignal,
  ): Promise<CodexKeyOutcome>
}

export type { ProviderSignIn as CodexSignIn } from '../auth-types'
