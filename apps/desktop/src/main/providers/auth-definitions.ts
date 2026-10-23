import type { Provider } from '@brobot2/shared'
import type { ProviderAuthPolicy } from './auth-policy'
import { authPolicy as claude } from './claude/auth-policy'
import { authPolicy as codex } from './codex/auth-policy'

/** Authentication policies are separate from transcript and knowledge import closures. */
export const providerAuthPolicies: Readonly<Record<Provider, ProviderAuthPolicy>> = {
  claude,
  codex,
}
