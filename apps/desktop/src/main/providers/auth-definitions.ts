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
