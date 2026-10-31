export { providerDefinitions } from './definitions'
export { providerAuthPolicies } from './auth-definitions'
import { providerRecord, type Provider } from '@brobot2/shared'
import { createClaudeModule, type ClaudeModuleSeams } from './claude'
import { createCodexModule, type CodexModuleSeams } from './codex'
import { claudeDesktopInputs, type ClaudeDesktopSeams } from './claude/desktop'
import { codexDesktopInputs, type CodexDesktopSeams } from './codex/desktop'
import type { DesktopProviderContext } from './desktop-context'
import { orderedProgramVersions } from './program-policy'
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

/** Register native bindings once; providers keep all program/key/renewal decisions. */
export function desktopProviderInputs(
  context: DesktopProviderContext,
  seams: { readonly claude?: ClaudeDesktopSeams; readonly codex?: CodexDesktopSeams } = {},
): ProviderModuleInputs {
  return {
    claude: claudeDesktopInputs(context, seams.claude),
    codex: codexDesktopInputs(context, seams.codex),
  }
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
    loginRenewal: (provider) => auth[provider].renewal,
    credentialHome: (provider, profileId) => auth[provider].credentialHome(profileId),
    check: (provider, profileId, signal) => auth[provider].check(profileId, signal),
    probe: (provider, profileId, signal) =>
      auth[provider].probe?.(profileId, signal) ?? auth[provider].check(profileId, signal),
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

/** Use the caches already bound by each provider; legacy runtime-only modules have no versions. */
export function providerVersionsFromModules(
  modules: ProviderModules,
): ReturnType<typeof orderedProgramVersions> {
  return orderedProgramVersions(
    providerRecord((provider) => {
      const service = modules[provider].program
      if (service === undefined) throw new Error('Provider program services were not bound')
      return service.version
    }),
  )
}
