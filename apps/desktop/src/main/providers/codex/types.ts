import type { CodexKeyChange, CodexKeyOutcome } from '@brobot2/runtime'
/**
 * 🔒 **The person's Codex API key, and the login that puts it in a profile home** — the key comes
 * from `api-keys.ts`; the login is Codex's own (`changeCodexKeyInHome`), so Codex keeps the key in
 * its own `auth.json` in that home (`0600`), as it keeps a ChatGPT login.
 */
export interface CodexKeySeam {
  /** The key and when it was saved, or `null`. Throws when a saved key cannot be read. */
  current():
    | { readonly key: string; readonly setAt: number }
    | null
    | Promise<{ readonly key: string; readonly setAt: number } | null>
  /** Presence alone never needs to decrypt a key. */
  isSaved?(): boolean
  change(providerHome: string, change: CodexKeyChange): Promise<CodexKeyOutcome>
}

export type { ProviderSignIn as CodexSignIn } from '../auth-types'
