import type { AgentRuntime } from './runtime'
import type { AuthState } from './auth-state'
import type { ReprovisionOutcome } from './internal/auth'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { LoginRenewalOperations, ProviderSignIn, SignInCopySource } from './provider-auth'
import type { ProviderAuthPolicy } from './provider-auth-policy'
import type { ProviderProgramOperations } from './provider-program'
import type {
  ProviderHostValues,
  TranscriptPolicy,
  DiscoveryPolicy,
  InstructionPolicy,
  MemoryPolicy,
  SnapshotPolicy,
  SkillPolicy,
  KeptRulePolicy,
} from './provider-policies'

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
  readonly renewal?: LoginRenewalOperations
  probe?(profileId: string, signal?: AbortSignal): Promise<AuthState>
  credentialHome(profileId: string): string
  check(profileId: string, signal?: AbortSignal): Promise<AuthState>
  reprovision(profileId: string): ReprovisionOutcome | Promise<ReprovisionOutcome>
  signIn(profileId: string, signal?: AbortSignal): Promise<ProviderSignIn>
  replaceARefusedCopy(
    profileId: string,
    refused: unknown,
    stillWanted: () => boolean,
  ): Promise<SignInCopySource | 'not-tried'>
}

/**
 * The provider chooses preparation; its credential services are bound separately from state paths.
 * Today state folders also establish profile existence. A later shared-login strategy must retain
 * those folders, or first provide a profile registry. Existing conversations keep their paths.
 */
export interface ProviderHomeStrategy {
  prepare(profileId: string): Promise<string>
}

/** Bound selection operations; adapters own the connection value and its native protocol. */
export interface ProviderConnectionOperations<Connection = ProviderConnection> {
  list(): readonly Connection[]
  resolve(connectionId?: string | null): Connection
}

export interface PreparedProviderLaunch {
  readonly home: string
  readonly runtime: AgentRuntime
}

export interface ProviderModule<H extends ProviderHostValues, Connection = ProviderConnection> {
  readonly program?: ProviderProgramOperations
  readonly authPolicy: ProviderAuthPolicy
  readonly transcripts: TranscriptPolicy<H>
  readonly discovery: DiscoveryPolicy<H>
  readonly instructions: InstructionPolicy<H>
  readonly memory: MemoryPolicy<H>
  readonly snapshot: SnapshotPolicy<H>
  readonly skills: SkillPolicy<H>
  readonly keptRules: KeptRulePolicy
  /** A fresh runtime for this launch; the program is resolved only when called. */
  createRuntime(): AgentRuntime
  prepareLaunch(profileId: string, connection?: Connection): Promise<PreparedProviderLaunch>
  /** Bound by the desktop composition; legacy runtime-only constructions may omit it. */
  readonly connections?: ProviderConnectionOperations<Connection>
  readonly home: ProviderHomeStrategy
  readonly auth: HomeAuthOperations
}
export type ProviderModules<H extends ProviderHostValues> = Readonly<
  Record<Provider, ProviderModule<H>>
>

export type {
  ProviderVersion,
  ProviderProgram,
  ProviderProgramFrom,
  ProviderProgramStanding,
  ProviderProgramCopy,
  ProviderProgramUpdate,
  ProviderProgramOperations,
} from './provider-program'
export type * from './provider-auth'
export type * from './provider-auth-policy'
export type * from './provider-policies'
