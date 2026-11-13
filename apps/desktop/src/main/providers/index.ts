/// <reference types="electron-vite/node" />

import { CLAUDE_LAUNCH_SETTING_KEYS } from '@brobot2/runtime/claude'
import { CODEX_LAUNCH_SETTING_KEYS } from '@brobot2/runtime/codex'

import {
  providerRecord,
  providerValue,
  PROVIDER_DESCRIPTORS,
  type Provider,
  type ProviderDescriptor,
} from '@brobot2/shared'
import { createClaudeModule, type ClaudeModuleSeams } from './claude'
import { createCodexModule, type CodexModuleSeams } from './codex'
import { claudeDesktopInputs, type ClaudeDesktopSeams } from './claude/desktop'
import { codexDesktopInputs, type CodexDesktopSeams } from './codex/desktop'
import type { DesktopProviderContext } from './desktop-context'
import { orderedProgramVersions } from './program-policy'
import type { ProviderAuthOps } from './auth-operations'
import type {
  HomeAuthOperations,
  ProviderHomeStrategy,
  ProviderHomePaths,
  ProviderModules,
  ProviderConnectionOperations,
} from './module'

export type { ProviderModule, ProviderModules } from './module'

/** Declared registration facts only; listing never constructs or probes a provider. */
export function providerCatalogue(): readonly ProviderDescriptor[] {
  return PROVIDER_DESCRIPTORS
}

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
  connectionsFor?: (provider: Provider) => ProviderConnectionOperations,
): ProviderModules {
  const modules: ProviderModules = {
    claude: createClaudeModule(pathsFor('claude'), seams.claude),
    codex: createCodexModule(pathsFor('codex'), seams.codex),
  }
  if (!connectionsFor) return modules
  return providerRecord((provider) => ({
    ...modules[provider],
    connections: connectionsFor(provider),
  }))
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

/** Keep optional program lookups bound without reading them during desktop composition. */
export function providerProgramPathsFromModules(
  modules: ProviderModules,
): Readonly<Record<Provider, (() => string | null) | undefined>> {
  return providerRecord((provider) => {
    const service = modules[provider].program
    return service?.installedPath?.bind(service)
  })
}

/** Use the caches already bound by each provider; legacy runtime-only modules have no versions. */
export function providerVersionsFromModules(
  modules: ProviderModules,
): ReturnType<typeof orderedProgramVersions> {
  return orderedProgramVersions(
    providerRecord((provider) => {
      const service = modules[provider].program
      return service?.version?.bind(service)
    }),
  )
}

import { workspaceInstructionFile as claudeWorkspaceFile } from './claude/layout.mjs'
import { workspaceInstructionFile as codexWorkspaceFile } from './codex/layout.mjs'
import type { ProviderDefinition } from './transcript-policy'
import { transcripts as claudeTranscripts } from './claude/transcripts'
import { transcripts as codexTranscripts } from './codex/transcripts'
import { discovery as claudeDiscovery } from './claude/discovery'
import { discovery as codexDiscovery } from './codex/discovery'
export const providerDefinitions: Readonly<Record<Provider, ProviderDefinition>> = {
  claude: {
    transcripts: claudeTranscripts,
    discovery: claudeDiscovery,
    workspaceInstructionFile: claudeWorkspaceFile,
    ...claudeMetadata,
  },
  codex: {
    transcripts: codexTranscripts,
    discovery: codexDiscovery,
    workspaceInstructionFile: codexWorkspaceFile,
    ...codexMetadata,
  },
}

import type { KeptRulePolicy } from './kept-rule-policy'
import { keptRules as claudeKeptRules } from './claude/kept-rules'
import { keptRules as codexKeptRules } from './codex/kept-rules'
import type { InstructionPolicy } from './knowledge-policy'
import type { MemoryPolicy } from './memory-policy'
import type { SnapshotPolicy } from './snapshot-policy'
import { snapshot as claudeSnapshot } from './claude/snapshot'
import { snapshot as codexSnapshot } from './codex/snapshot'
import type { SkillPolicy } from './skill-policy'
import { skills as claudeSkills } from './claude/skills'
import { skills as codexSkills } from './codex/skills'
import { instructions as claudeInstructions } from './claude/instructions'
import { instructions as codexInstructions } from './codex/instructions'
import { memory as claudeMemory } from './claude/memory'
import { memory as codexMemory } from './codex/memory'

export interface ProviderKnowledge {
  readonly instructions: InstructionPolicy
  readonly memory: MemoryPolicy
  readonly snapshot: SnapshotPolicy
  readonly keptRules: KeptRulePolicy
  readonly skills: SkillPolicy
}
/** Instruction and memory readers supplied by each registered adapter. */
export const providerKnowledge: Readonly<Record<Provider, ProviderKnowledge>> = {
  claude: {
    instructions: claudeInstructions,
    memory: claudeMemory,
    snapshot: claudeSnapshot,
    skills: claudeSkills,
    keptRules: claudeKeptRules,
  },
  codex: {
    instructions: codexInstructions,
    memory: codexMemory,
    snapshot: codexSnapshot,
    skills: codexSkills,
    keptRules: codexKeptRules,
  },
}
/** Legacy recorded keys stay readable independently of the selected provider. */
export const legacyLaunchSettingKeys = [...CLAUDE_LAUNCH_SETTING_KEYS, ...CODEX_LAUNCH_SETTING_KEYS]

/** The two reminder fields and their order belong to the fixed legacy catalogue format. */
export const legacySkillReminderFormats = [
  codexSkills.legacyReminder,
  claudeSkills.legacyReminder,
] as const

import { refusalWords as claudeRefusalWords } from './claude/refusal-words'
import { refusalWords as codexRefusalWords } from './codex/refusal-words'
import type { ProviderAuthPolicy } from './auth-policy'
import { authPolicy as claudeAuthPolicy } from './claude/auth-policy'
import { authPolicy as codexAuthPolicy } from './codex/auth-policy'

/** Native authentication policies supplied by each registered adapter. */
export const providerAuthPolicies: Readonly<Record<Provider, ProviderAuthPolicy>> = {
  claude: claudeAuthPolicy,
  codex: codexAuthPolicy,
}

// Existing public keys retain their exact refusal formats, including legacy unsupported combinations.
export const legacyStartRefusalWords = {
  'claude-sign-in': claudeRefusalWords['sign-in'],
  'codex-sign-in': codexRefusalWords['sign-in'],
  'no-sign-in-to-copy': codexRefusalWords['no-sign-in-to-copy'],
  'codex-settings': codexRefusalWords.settings,
} as const

import { ClaudeSetupService, type ClaudeSetupDependencies } from './claude/setup-service'
import { findClaudeProgramHere, LOOK_FOR_THE_INSTALLED_ONE } from './claude/program'
import type { SetupServices } from '../provider-setup/service'
import type { ProviderVersion } from '../../shared/runtime-ipc'
import type { ClaudeProgram } from './claude/program'
import type { CodexProgram } from './codex/program'
import { claudeVersionReader } from './claude/program-versions'
import { codexVersionReader } from './codex/program-versions'

export function providerVersionsReader(
  codexProgram: () => CodexProgram,
  claudeProgram: () => ClaudeProgram,
): () => Promise<Readonly<Record<Provider, ProviderVersion>>> {
  return orderedProgramVersions({
    claude: claudeVersionReader(claudeProgram),
    codex: codexVersionReader(codexProgram),
  })
}

/** Setup uses the official installed-program lookup, including in a development checkout. */
export function providerSetupServices(
  deps: Omit<ClaudeSetupDependencies, 'findProgram'>,
): SetupServices {
  return {
    claude: new ClaudeSetupService({
      ...deps,
      findProgram: () =>
        findClaudeProgramHere({ isPackaged: true, given: LOOK_FOR_THE_INSTALLED_ONE }).path,
    }),
  }
}

import { metadata as claudeMetadata } from './claude/registration'
import { metadata as codexMetadata } from './codex/registration'

export {
  legacyAccountRecordFormat,
  providerAccountsFile,
  readKeptAccounts,
  writeKeptAccounts,
  type KnownAccount,
  type KeptAccounts,
} from './claude/account-record'
export { theCheapestModel } from './claude/api-key'
export { legacySharedSkillProvider } from './codex/skills'
export { recordedNativeRead as historicalInstructionReads } from './codex/given'
export { recordedProfileMemory as historicalProfileMemory } from './claude/given'
export { recordedScheduleReceiptProvider } from './claude/transcripts'
export { workspaceInstructionNames } from './workspace-layout.mjs'

export async function startSettingsLocator() {
  const { default: start } = await import('./claude/local-settings-locator.worker?nodeWorker')
  return start({})
}

import type { AgentRuntime, AuthHealth } from '@brobot2/runtime'
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

export interface ProviderRuntimeSeams {
  managedProviderHomesRoot?: string
  codexCommand: () => string

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

export { isRecordedAccountTag } from './codex/registration'
