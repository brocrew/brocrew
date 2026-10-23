import type { TranscriptPolicy, DiscoveryPolicy } from './transcript-policy'
import type {
  AgentRuntime,
  AuthState,
  CodexCopyIdentity,
  CodexCopySource,
  ReprovisionOutcome,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { CodexSignIn } from './codex/types'

/** Directory preparation is independent of a provider's credential services. */
export type ProvisionHome = (managedRoot: string, home: string) => void | Promise<void>

/** Pure state paths and profile admission, bound once without creating a folder. */
export interface ProviderHomePaths {
  readonly managedRoot: string
  readonly defaultProfile: string
  homeOf(profileId: string): string
  profiles(): string[]
  assertMayOpen(profileId: string): void
}

/** Operations on one provider's bound paths, with no provider selection at the call site. */
export interface HomeAuthOperations {
  credentialHome(profileId: string): string
  check(profileId: string, signal?: AbortSignal): Promise<AuthState>
  reprovision(profileId: string): ReprovisionOutcome | Promise<ReprovisionOutcome>
  signIn(profileId: string, signal?: AbortSignal): Promise<CodexSignIn>
  bringTheKeyToItsHomes(): Promise<string | null>
  replaceARefusedCopy(
    profileId: string,
    refused: CodexCopyIdentity,
    stillWanted: () => boolean,
  ): Promise<CodexCopySource | 'not-tried'>
}

/**
 * The provider chooses preparation; its credential services are bound separately from state paths.
 * Today state folders also establish profile existence. A later shared-login strategy must retain
 * those folders, or first provide a profile registry. Existing conversations keep their paths.
 */
export interface ProviderHomeStrategy {
  prepare(profileId: string): Promise<string>
}

export interface ProviderModule {
  readonly transcripts: TranscriptPolicy
  readonly discovery: DiscoveryPolicy
  readonly instructions: import('./knowledge-policy').InstructionPolicy
  readonly memory: import('./memory-policy').MemoryPolicy
  readonly snapshot: import('./snapshot-policy').SnapshotPolicy
  readonly skills: import('./skill-policy').SkillPolicy
  /** A fresh runtime for this launch; the program is resolved only when called. */
  createRuntime(): AgentRuntime
  readonly home: ProviderHomeStrategy
  readonly auth: HomeAuthOperations
}
export type ProviderModules = Readonly<Record<Provider, ProviderModule>>
