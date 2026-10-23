import type { AgentRuntime, AuthHealth } from '@brobot2/runtime'
import { providerRecord, providerValue, type Provider } from '@brobot2/shared'
import {
  claudeModuleFactory,
  type ClaudeAuthSeams,
  type ClaudeHomeSeams,
  type ClaudeRuntimeSeams,
} from './claude'
import {
  codexModuleFactory,
  type CodexAuthSeams,
  type CodexHomeSeams,
  type CodexRuntimeSeams,
} from './codex'
import type { CodexKeySeam } from './codex/types'
import type { HomeAuthOperations, ProviderHomePaths, ProviderHomeStrategy } from './module'

/**
 * The credential seams, defaulted to the real ones. They are injectable so tests —
 * and `pnpm run ci` — never read the machine Keychain or the personal `~/.codex`.
 */
export interface ProviderHomeSeams {
  provisionHome?: (managedRoot: string, providerHome: string) => void | Promise<void>
  provisionCodexAuth?: (providerHome: string) => void | Promise<void>
  /** Where this computer keeps its own Codex sign-in; `~/.codex/auth.json` when not given. */
  machineCodexAuthPath?: () => string
  claudeAuthHealth?: () => AuthHealth | Promise<AuthHealth>
  /** The API key a person entered for a provider, or null — see `api-keys.ts`. */
  apiKey?: (provider: Provider) => string | null | Promise<string | null>
  /** 🔒 The person's Codex key, and Codex's own login with it — see {@link CodexKeySeam}. */
  codexKey?: CodexKeySeam
  /** {@link ProviderRuntimeSeams.claudeProgramFound}. */
  claudeProgramFound?: () => string | null
}

/**
 * What the composition root must supply to build a runtime. `codexCommand` is the absolute path
 * of the codex executable the app ships (014) — REQUIRED, so no caller can fall back to the bare
 * `codex` PATH lookup that only ever worked on a developer's shell. It is a thunk, resolved per
 * launch inside `createSession`'s error path: a missing binary becomes the actionable command
 * error the surface shows, not a raw `spawn ENOENT` — and never at startup, where nothing could
 * display it. Claude launches never invoke it.
 */
export interface ProviderRuntimeSeams {
  managedProviderHomesRoot?: string
  codexCommand: () => string
  /**
   * The absolute path of the person's Claude Code (`claude-program.ts`). Called at every Claude
   * launch, so a program installed, moved or removed is seen by the next one; it throws the error a
   * person reads when there is none. Codex launches never call it.
   */
  claudeProgram: () => string
  /**
   * The API key a person entered for a provider, or null — see `api-keys.ts`. Read on every launch;
   * absent in tests and for a library caller, which then run on the machine login.
   */
  apiKey?: (provider: Provider) => string | null | Promise<string | null>
  /** 🔒 The person's Codex key, and Codex's own login with it — see {@link CodexKeySeam}. */
  codexKey?: CodexKeySeam
  keyStatus?: (provider: Provider) => { set: boolean; unreadableReason?: string }
  /** Where this computer keeps its own Codex sign-in; `~/.codex/auth.json` when not given. */
  machineCodexAuthPath?: () => string
  /**
   * The person's own Claude Code by its full path, or `null` when none is installed: what a sentence
   * tells them to run to sign in. Never a copy this app's own checkout carries. Absent: `null`.
   */
  claudeProgramFound?: () => string | null
}

export type { ProviderAuthOps } from './auth-operations'

type AuthInputs = Omit<ProviderRuntimeSeams, 'claudeProgram'>

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

/** Legacy facade adapters use the same factories as the bound production modules. */
export function runtimeFactoryFor(
  provider: Provider,
  seams: ProviderRuntimeSeams,
): () => AgentRuntime {
  return providerValue(provider, {
    claude: () => claudeModuleFactory.runtime(runtimeForClaude(seams)),
    codex: () => codexModuleFactory.runtime(runtimeForCodex(seams)),
  })()
}
export function homeStrategyFor(
  provider: Provider,
  paths: ProviderHomePaths,
  seams: ProviderHomeSeams,
): ProviderHomeStrategy {
  return providerValue(provider, {
    claude: () => claudeModuleFactory.home(paths, homeForClaude(seams)),
    codex: () => codexModuleFactory.home(paths, homeForCodex(seams)),
  })()
}
export function legacyAuthOperations(
  pathsFor: (provider: Provider) => ProviderHomePaths,
  seams: AuthInputs,
): Readonly<Record<Provider, HomeAuthOperations>> {
  return providerRecord((provider) =>
    providerValue(provider, {
      claude: () => claudeModuleFactory.auth(pathsFor(provider), authForClaude(seams)),
      codex: () => codexModuleFactory.auth(pathsFor(provider), authForCodex(seams)),
    })(),
  )
}
