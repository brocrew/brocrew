export { providerDefinitions } from './definitions'
export { providerAuthPolicies } from './auth-definitions'
import { providerRecord, type Provider } from '@brobot2/shared'
import { createClaudeModule, type ClaudeModuleSeams } from './claude'
import { createCodexModule, type CodexModuleSeams } from './codex'
import type { ProviderAuthOps } from './compat'
import type { HomeAuthOperations, ProviderHomePaths, ProviderModules } from './module'

export { prepareOnTheLogin } from './claude'
export { bringTheCodexKeyTo } from './codex'
export type { ProviderModule, ProviderModules } from './module'

/** Only the registration point knows each provider's construction inputs. */
export interface ProviderModuleInputs {
  readonly claude: ClaudeModuleSeams
  readonly codex: CodexModuleSeams
}

/** Bind once; no runtime construction, program lookup, home or credential work happens here. */
export function createProviderModules(
  pathsFor: (provider: Provider) => ProviderHomePaths,
  seams: ProviderModuleInputs,
): ProviderModules {
  return {
    claude: createClaudeModule(pathsFor('claude'), seams.claude),
    codex: createCodexModule(pathsFor('codex'), seams.codex),
  }
}

function forwardAuth(auth: Readonly<Record<Provider, HomeAuthOperations>>): ProviderAuthOps {
  return {
    credentialHome: (provider, profileId) => auth[provider].credentialHome(profileId),
    check: (provider, profileId, signal) => auth[provider].check(profileId, signal),
    reprovision: (provider, profileId) => auth[provider].reprovision(profileId),
    signIn: (provider, profileId, signal) => auth[provider].signIn(profileId, signal),
    replaceARefusedCopy: (provider, profileId, refused, stillWanted) =>
      auth[provider].replaceARefusedCopy(profileId, refused, stillWanted),
    bringTheKeyToItsHomes: (provider) => auth[provider].bringTheKeyToItsHomes(),
  }
}

/** Adapt already bound operations to the host's existing provider-keyed API. */
export function providerAuthFromHomes(
  auth: Readonly<Record<Provider, HomeAuthOperations>>,
): ProviderAuthOps {
  return forwardAuth(auth)
}
export function providerAuthFromModules(modules: ProviderModules): ProviderAuthOps {
  return forwardAuth(providerRecord((provider) => modules[provider].auth))
}

export { providerKnowledge } from './knowledge-definitions'
