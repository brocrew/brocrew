import { refusalWords as claudeRefusalWords } from './claude/refusal-words'
import { refusalWords as codexRefusalWords } from './codex/refusal-words'
import type { Provider } from '@brobot2/shared'
import type { ProviderAuthPolicy } from './auth-policy'
import { authPolicy as claude } from './claude/auth-policy'
import { authPolicy as codex } from './codex/auth-policy'

/** Authentication policies are separate from transcript and knowledge import closures. */
export const providerAuthPolicies: Readonly<Record<Provider, ProviderAuthPolicy>> = {
  claude,
  codex,
}

export {
  legacyAccountRecordFormat,
  AN_ACCOUNT_ID,
  providerAccountsFile,
  readKeptAccounts,
  writeKeptAccounts,
  type KnownAccount,
  type KeptAccounts,
} from './claude/account-record'

export { theCheapestModel } from './claude/api-key'

// Existing public keys retain their exact refusal formats, including legacy unsupported combinations.
export const legacyStartRefusalWords = {
  'claude-sign-in': claudeRefusalWords['sign-in'],
  'codex-sign-in': codexRefusalWords['sign-in'],
  'no-sign-in-to-copy': codexRefusalWords['no-sign-in-to-copy'],
  'codex-settings': codexRefusalWords.settings,
} as const
