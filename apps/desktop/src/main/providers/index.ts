import type { AgentRuntime } from '@brobot2/runtime'
import { providerRecord, type Provider } from '@brobot2/shared'
import {
  claudeAuth,
  claudeRuntime,
  createClaudeModule,
  prepareClaudeHome,
  type ClaudeAuthSeams,
  type ClaudeHomeSeams,
  type ClaudeRuntimeSeams,
} from './claude'
import {
  codexAuth,
  codexRuntime,
  createCodexModule,
  prepareCodexHome,
  type CodexAuthSeams,
  type CodexHomeSeams,
  type CodexRuntimeSeams,
} from './codex'
import type {
  HomeAuthOperations,
  ProviderAuthOps,
  ProviderHomePaths,
  ProviderHomeSeams,
  ProviderHomeStrategy,
  ProviderModule,
  ProviderModuleInputs,
  ProviderModules,
  ProviderRuntimeSeams,
} from './module'

export { prepareOnTheLogin } from './claude'
export { bringTheCodexKeyTo } from './codex'
export type { ProviderModule, ProviderModules } from './module'

type AuthInputs = ProviderModuleInputs['auth']

// Compatibility inputs stay at this boundary; implementations receive only their own services.
const runtimeForClaude = (seams: ProviderRuntimeSeams): ClaudeRuntimeSeams => ({
  program: seams.claudeProgram,
  programFound: seams.claudeProgramFound,
  managedRoot: seams.managedProviderHomesRoot,
  key: seams.apiKey === undefined ? undefined : () => seams.apiKey?.('claude') ?? null,
})
const homeForClaude = (seams: ProviderHomeSeams): ClaudeHomeSeams => ({
  provisionHome: seams.provisionHome,
  health: seams.claudeAuthHealth,
  key: seams.apiKey === undefined ? undefined : () => seams.apiKey?.('claude') ?? null,
  programFound: seams.claudeProgramFound,
})
const authForClaude = (seams: AuthInputs): ClaudeAuthSeams => ({
  key: seams.apiKey === undefined ? undefined : () => seams.apiKey?.('claude') ?? null,
  keyStatus: seams.keyStatus === undefined ? undefined : () => seams.keyStatus!('claude'),
  programFound: seams.claudeProgramFound,
})
const runtimeForCodex = (seams: ProviderRuntimeSeams): CodexRuntimeSeams => ({
  command: seams.codexCommand,
})
const homeForCodex = (seams: ProviderHomeSeams): CodexHomeSeams => ({
  provisionHome: seams.provisionHome,
  provisionCodexAuth: seams.provisionCodexAuth,
  machineAuthPath: seams.machineCodexAuthPath,
  key: seams.codexKey,
})
const authForCodex = (seams: AuthInputs): CodexAuthSeams => ({
  command: seams.codexCommand,
  machineAuthPath: seams.machineCodexAuthPath,
  key: seams.codexKey,
})

interface Registration {
  runtime(seams: ProviderRuntimeSeams): () => AgentRuntime
  home(paths: ProviderHomePaths, seams: ProviderHomeSeams): ProviderHomeStrategy
  auth(paths: ProviderHomePaths, seams: AuthInputs): HomeAuthOperations
  bind(paths: ProviderHomePaths, seams: ProviderModuleInputs): ProviderModule
}

/** Registration creates no runtime, home, process or credential read. */
const registrations: Readonly<Record<Provider, Registration>> = {
  claude: {
    runtime: (seams) => {
      const own = runtimeForClaude(seams)
      return () => claudeRuntime(own)
    },
    home: (paths, seams) => {
      const own = homeForClaude(seams)
      return { prepare: (profileId) => prepareClaudeHome(paths, profileId, own) }
    },
    auth: (paths, seams) => claudeAuth(paths, authForClaude(seams)),
    bind: (paths, seams) =>
      createClaudeModule(paths, {
        runtime: runtimeForClaude(seams.runtime),
        home: homeForClaude(seams.home),
        auth: authForClaude(seams.auth),
      }),
  },
  codex: {
    runtime: (seams) => {
      const own = runtimeForCodex(seams)
      return () => codexRuntime(own)
    },
    home: (paths, seams) => {
      const own = homeForCodex(seams)
      return { prepare: (profileId) => prepareCodexHome(paths, profileId, own) }
    },
    auth: (paths, seams) => codexAuth(paths, authForCodex(seams)),
    bind: (paths, seams) =>
      createCodexModule(paths, {
        runtime: runtimeForCodex(seams.runtime),
        home: homeForCodex(seams.home),
        auth: authForCodex(seams.auth),
      }),
  },
}

/** Bind once in the composition root, in the shared registry's fixed order. */
export function createProviderModules(
  pathsFor: (provider: Provider) => ProviderHomePaths,
  seams: ProviderModuleInputs,
): ProviderModules {
  return providerRecord((provider) => registrations[provider].bind(pathsFor(provider), seams))
}

export function runtimeFactoryFor(
  provider: Provider,
  seams: ProviderRuntimeSeams,
): () => AgentRuntime {
  return registrations[provider].runtime(seams)
}

export function homeStrategyFor(
  provider: Provider,
  paths: ProviderHomePaths,
  seams: ProviderHomeSeams,
): ProviderHomeStrategy {
  return registrations[provider].home(paths, seams)
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

export function legacyAuthOperations(
  pathsFor: (provider: Provider) => ProviderHomePaths,
  seams: AuthInputs,
): ProviderAuthOps {
  return forwardAuth(
    providerRecord((provider) => registrations[provider].auth(pathsFor(provider), seams)),
  )
}

export function providerAuthFromModules(modules: ProviderModules): ProviderAuthOps {
  return forwardAuth(providerRecord((provider) => modules[provider].auth))
}
