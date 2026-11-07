import type { WorkspacePluginAttachments } from '../plugins/attachments'
import type { FilesLibraryWindows } from '../db/files-library-windows'
import type { TeamProfileGraphWindows } from '../db/team-profile-graph-windows'
import type { PluginInstructionSource } from '../plugins/instructions'
import type { SkillsWindow } from '../../shared/skills-window'
import type { PastWorkSearchReader } from '../db/past-work-search-reader'
import type { TranscriptsCleared } from '../../shared/transcript-retention'
import type { SkillImportNotice } from '../../shared/recent-activity'
import type { StartAttemptLine } from '../start-attempts-log'
import type { ThemeStore } from '../themes/store'
import type { MainThreadWork } from '../stall-watch'
import type { SkillLaunchSelection } from '../skills/launch-selection'
import type { SkillGrants } from '../../shared/skills-catalogue'
import type { PreparedBuiltInSkills } from '../skills/prepare-built-in-skills'
import type { SavedMethodsUse } from '../../shared/saved-methods'
import type { SavedMethodsLines } from '../saved-methods'
import type { TextPackUse } from '../../shared/text-pack'
import type { TextPackRead } from '../skills/text-pack'
import type { AgentRuntime, SessionRef } from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ArchivedConversations } from '../archived-file'
import type { InstructionContext, TheBuildRunning } from './factory-text'
import type { MessagePathPlace } from '../message-paths'
import type { LoginRenewalOperations } from '../providers/auth-types'
import type { ProviderAuthOps } from '../providers/auth-operations'
import type { ApiKeys } from './api-keys'
import type { ProtectedPlaceNotice } from '../../shared/work-folders'
import type { SignInChanges } from '../sign-in-changes'
import type { ListedProcess } from './process-listing'
import type {
  RuntimeChangeMessage,
  RuntimeStatesMessage,
  ApiKeyCheck,
  KeptRuleRemoved,
  KeptRules,
  ProviderConfigInfo,
  ProviderVersion,
  ProvidersChangedMessage,
} from '../../shared/runtime-ipc'
import type { MemoryLoadedEvent } from '../../shared/conversation-events'
import type { SessionInstructions } from '../../shared/instruction-contracts'
import type { Discovery, ProviderDescription } from '../adopt/discover-sessions'
import type { UserHomeDiscovery } from '../adopt/user-homes'
import type { SessionStore } from '../db/session-store'
import type { LimitsReaderLifetime } from '../db/limits-reader-lifetime'
import type { WorkSearchReader } from '../db/work-search-reader'
import type { LimitsWriterStamp } from '../db/fresh-limits-snapshot'
import type { WindowWriterStamp } from '../db/window-writer-stamp'
import type { WindowReadQuery, WindowStoreReader } from '../db/window-read-protocol'
import type { SavedMethodService } from '../saved-method-service'
import type { MemoryService } from './agent-memory'
import type { LaunchProfileFile } from './what-this-agent-was-given'
import type { SnapshotAnswer } from '../../shared/provider-snapshots'
import type { KeptUsage } from '../provider-usage-file'
import type { KeptAccounts } from '../provider-accounts-file'
import type { LivenessOptions } from './liveness'
import type { KeptAttempts } from '../schedule-attempts-file'
import type { KeptProfileExecution, ProfileExecutionRead } from '../profile-execution-file'
import type { KeptCuts } from '../turns-the-app-cut-file'

export interface RuntimeHostDeps {
  prepareSharedSkills?: () => Promise<void>
  beforeSkillDiscovery?: () => Promise<void>
  sharedSkillsRoot?: () => Promise<string>
  sharedSkillsGeneration?: () => number
  closeSharedSkills?: () => void
  skillsForAPerson?: SkillsWindow
  savedMethods?: SavedMethodService
  transcriptsCleared?: (from: number, to: number) => Promise<readonly TranscriptsCleared[]>
  skillImports?: (from: number, to: number) => Promise<readonly SkillImportNotice[]>

  readonly themes?: Pick<ThemeStore, 'refresh' | 'snapshot' | 'raw' | 'save' | 'set'>
  mainThreadWork?: Pick<MainThreadWork, 'start' | 'timed'>
  createRuntime(provider: Provider, connectionId?: string): AgentRuntime
  connectionFor?(provider: Provider, recordedConnection?: string | null): string
  connectionRevision?(provider: Provider): number
  listConnections?(): readonly ProviderConnection[]
  prepareProviderHome(
    provider: Provider,
    profileId: string,
    signal?: AbortSignal,
  ): string | Promise<string>
  beforeProviderLaunch?: () => Promise<void>
  readSelectedSkills?: (profileId: string | null, grants: SkillGrants) => SkillLaunchSelection
  prepareBuiltInSkills?: (input: {
    provider: Provider
    providerHome: string
    canCreateAgents: boolean
    isCoordinator: boolean
    isCurrent: () => boolean
    inUseUntil?: Promise<void>
    selection?: Pick<SkillLaunchSelection, 'revision' | 'skills'>
    pack?: TextPackRead
  }) => Promise<PreparedBuiltInSkills>
  readTextPack?: () => TextPackRead
  loginRenewal?: (provider: Provider) => LoginRenewalOperations | undefined
  programFound?: Readonly<Partial<Record<Provider, () => string | null>>>
  providerHomePath(provider: Provider, profileId: string): string
  listProfiles?(provider?: Provider): string[]
  providerHomesRoot?(): string
  memoryKnowledge?: MemoryService
  providerAuth?: ProviderAuthOps
  apiKeys?: Pick<ApiKeys, 'status' | 'remove'> & {
    onReadStateChanged?(listener: (provider: Provider) => void): () => void
    revision?(provider: Provider): number
    set(provider: Provider, key: string): string | null | Promise<string | null>
    read(provider: Provider): string | null | Promise<string | null>
  }
  askTheProvider?(provider: Provider, key: string): Promise<ApiKeyCheck>
  providerVersions?(): Promise<Readonly<Record<Provider, ProviderVersion>>>
  keptRules?(): Promise<KeptRules>
  removeKeptRule?(input: { provider: Provider; file: string; kept: string }): KeptRuleRemoved
  listProcesses?(): Promise<readonly ListedProcess[]>
  usageKept?: {
    read(): KeptUsage
    write(usage: KeptUsage): void
  }
  scheduleAttempts?: {
    read(): KeptAttempts
    write(kept: KeptAttempts): void
  }
  profileExecution?: {
    read(): ProfileExecutionRead
    write(kept: KeptProfileExecution): void
    readonly owned: boolean
  }
  turnsTheAppCut?: {
    read(): KeptCuts
    write(kept: KeptCuts): void
  }
  accountsKept?: {
    read(): KeptAccounts
    write(accounts: KeptAccounts): void
  }
  providersMoved?(message: ProvidersChangedMessage): void
  openExternal?(url: string): Promise<void>
  revealPath?(path: string): void
  openPath?(path: string): Promise<string>
  messagePathPlace?: MessagePathPlace
  resourcesRoot?(): string
  makeWorkerPieceFolder?(piece: string): string
  whichBuild?(): TheBuildRunning
  resolveCwd(sessionId: string, requested: string | undefined): string
  exportDirectory(): string
  newSessionId(): string
  discoverSessions(): Discovery
  nativeTranscriptPath(provider: Provider, providerHome: string, ref: SessionRef): string | null
  userHomeSessions?: () => UserHomeDiscovery
  indexedDescriptions?: () => Promise<Map<string, ProviderDescription>>
  readProviderConfig(provider: Provider, providerHome: string): ProviderConfigInfo
  store: SessionStore
  limitsReader?: LimitsReaderLifetime
  afterFirstWindowLoad?: Promise<void>
  windowReader?: WindowStoreReader
  filesLibraries?: FilesLibraryWindows
  filesLibraryRevision?: () => string | null
  teamProfileGraphs?: TeamProfileGraphWindows
  teamProfileGraphRevision?: () => string | null
  windowWriterStamp?: (query: WindowReadQuery) => WindowWriterStamp | null
  workSearchReader?: WorkSearchReader
  pastWorkSearchReader?: Pick<PastWorkSearchReader, 'read' | 'close'>
  limitsWriterStamp?: () => LimitsWriterStamp | null
  plugins?: PluginInstructionSource
  pluginAttachments?: Pick<WorkspacePluginAttachments, 'agent'>
  readInstructions?: (
    provider: Provider,
    cwd: string,
    providerHome: string,
    context: InstructionContext,
    pack?: TextPackRead,
  ) => {
    instructions: SessionInstructions
    systemHint: string | undefined
    memoryLoaded?: MemoryLoadedEvent | null
    firstTurnLead?: string
    profileFile?: LaunchProfileFile | null
    textPack?: TextPackUse
    savedMethods?: SavedMethodsUse
    savedMethodsLines?: SavedMethodsLines
    context?: InstructionContext
  }
  providerSnapshot?(provider: Provider, model: string | null): SnapshotAnswer
  now?: () => number
  closeDrainTimeoutMs?: number
  interruptWaitMs?: number
  reopenLeadsGraceMs?: number
  recordStartAttempt?: (line: StartAttemptLine) => void
  monotonicNow?: () => number
  deliveryWaitMs?: number
  endingWaitMs?: number
  commandListWaitMs?: number
  afterALimitResetsMs?: number
  lookAtTheLimitAgainMs?: number
  signInChanges?: SignInChanges
  archived?: ArchivedConversations
  protectedPlaceOf?: (folder: string) => ProtectedPlaceNotice | null
  idleStopAfterMs?: number
  startGapMs?: number
  aProgramStartsAgainAfterMs?: number
  limitWakesApartMs?: number
  liveness?: LivenessOptions
  announce?: (change: RuntimeChangeMessage) => void
  statesMoved?: (message: RuntimeStatesMessage) => void
  readProcessMemory?: (pids: readonly number[]) => Promise<ReadonlyMap<number, number>>
}
