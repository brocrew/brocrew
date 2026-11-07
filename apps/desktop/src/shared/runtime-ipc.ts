import type { DecideMoveRequestInput, MoveRequestAck } from './move-contracts'
import type {
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
} from './question-contracts'
import type { AgentModelChoice, ModelChoiceSaved } from './model-choice-contracts'
import type { WaitOn, WhatEachConversationIsWaitingOn, WorkGivenOut } from './task-contracts'
import type { AgentState } from './agent-state-contracts'
import type { SessionInstructions } from './instruction-contracts'
import type {
  ModelList,
  ReportedModel,
  SessionSettingChanged,
  SessionSettingsDisclosure,
} from './model-choice-contracts'
import type {
  MailboxKind,
  McpServerRequestForAPerson,
  PersistedEventInfo,
  TranscriptEvent,
} from './conversation-events'
import type { TurnAuthorship, UserTurnEvent, UserTurnPart } from './human-answer-contracts'
import type { HandedPath, PastedImage } from './attachment-contracts'
import type { ListingAnswer } from './listing-published'
import type { PersonsQueueAnswer } from './persons-published'
import type { PublicationEpoch } from './data-version'
import type {
  MethodLibrary,
  MethodBody,
  MethodDeleteSelection,
  MethodChangeResult,
  MethodHistoryResult,
} from './saved-method-library'
import type { SkillsRequest, SkillsReply } from './skills-window'
import type { LinkResolution } from './link-resolution'
import { pathTail } from './path-tail'
export type { LinkResolution } from './link-resolution'

import type { WorkerBindingReading } from './worker-reading'

import type { ProviderLimitSeen } from './provider-limit'
import type { LimitsDisplayAnswer, LimitsDisplayChanged } from './limits-display'
import type { StalledWork } from './stalled-work'
import type { StoppedWorkForAPerson } from './stopped-work'
import type { WorkIncident } from './work-incidents'
import type { WaitingOnWhoWrote } from './waiting-on-who-wrote'
import type { AgentRemoved, IdentityUse } from './agent-roster'
import type { ArchiveOutcome, DeleteOutcome, DeleteVerdict } from './conversation-archive'

import type { DigestReading } from './digest'
import type { RecentActivityReading } from './recent-activity'
import type { WhoCalledWhom } from './who-called-whom'
import type { WorkspaceReading } from './workspace-reading'
import type { WorkFolderGrant } from './work-folders'
import type { ConversationAtWork, WhatIsBeingDone } from './what-is-being-done'
import type { WhatTheModelGot, WhatThisAgentWasGiven } from './what-this-agent-was-given'
import type { DocumentForm, DrawnAs, ResourceRole } from './documents'
import type { RulesBaseline } from './agent-rules'
import type { InstructionUnread } from './own-instructions'
import type { OwnNotesReading, OwnNotesWrite, OwnNotesUnread } from './own-notes'
import type { TheWholeForest } from './the-whole-forest'
import type { AgentInstructionsReading, InstructionAskWaiting } from './own-instructions'
import type {
  AgentMemoryAmended,
  AgentMemoryReading,
  MemoryAmendmentAsked,
  MemoryUndoAsked,
  MemoryCheckAsked,
  MemoryChecked,
} from './agent-memory'
import type {
  RetitleRail,
  WorkClosedByAPerson,
  WorkRetitled,
  WorkTakenBackByAPerson,
  WorkThatNamesIt,
} from './piece-called'
import type {
  AuthState,
  BackgroundWork,
  BackgroundWorkEnding,
  CapabilityState,
  CapabilityStatus,
  ChildThreadState,
  CommandTail,
  ContextReading,
  DeclaredTool,
  DeclaredToolset,
  EffortChoice,
  FileChange,
  MemoryRecallEntry,
  ModelChoice,
  PermissionDecision,
  ProviderCapabilities,
  ProviderCommand,
  ProviderSetup,
  ProviderCommandSet,
  PublishedInventory,
  PublishedServer,
  ReasoningEffort,
  ReprovisionOutcome,
  RuntimeEvent,
  ScheduledJob,
  SessionRef,
  ToolAnswer,
  ToolAnswerPart,
  ToolNaming,
  ToolParameter,
  UnknownCategory,
  UserInputQuestion,
  UserInputResponse,
  WorkflowAgent,
  WorkflowPhase,
} from '@brobot2/runtime'
import {
  DEFAULT_IDENTITY_PROVIDER,
  providerDescriptor,
  providerRecord,
} from '@brobot2/shared/providers'
import type { Provider, ProviderConnection, SessionStatus, TurnEnding } from '@brobot2/shared'

import type { CapabilityGrant, CapabilityOrigins, ProfileCapabilities } from './capabilities'
import type { ExternalMcpServerReach, ExternalMcpServerRow } from './external-mcp'

export const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const PATH_SEGMENT_MAX_LENGTH = 64
export function isPathSegment(value: string): boolean {
  return value.length <= PATH_SEGMENT_MAX_LENGTH && PATH_SEGMENT_PATTERN.test(value)
}

export const PATH_SEGMENT_RULE = `letters, digits, dot, dash or underscore (max ${PATH_SEGMENT_MAX_LENGTH})`

export function profileAlreadyNamed(name: string, existing: readonly string[]): string | null {
  if (existing.includes(name)) return name
  const folded = name.toLowerCase()
  return existing.find((id) => id.toLowerCase() === folded) ?? null
}

export function alreadyStagedAs(path: string, staged: readonly string[]): string | null {
  return profileAlreadyNamed(path, staged)
}

export function sameFileDifferentCase(staged: string): string {
  return (
    `that is already attached as ${staged} — the two spellings differ only in case, and on some ` +
    'volumes they are one file; detach it first if you meant a different one'
  )
}

export function foldProfileName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

export const DEFAULT_PROFILE_ID = 'brobot'

export const IDENTITY_ORIGINS = ['a-person', 'this-app', 'an-agent'] as const

export type IdentityOrigin = (typeof IDENTITY_ORIGINS)[number]

export type IdentityCreator =
  | { readonly by: 'a-person' }
  | { readonly by: 'this-app' }
  | { readonly by: 'an-agent'; readonly agent: string }

export type AgentIdentityName = Pick<AgentIdentity, 'id' | 'slug' | 'displayName'>

export interface AgentIdentity {
  readonly id: string
  readonly slug: string
  readonly displayName: string | null
  readonly createdAt: number
  readonly createdBy: IdentityCreator | null
  readonly capabilities: ProfileCapabilities
  readonly chosen: CapabilityOrigins
  readonly provider: Provider | null
  readonly externalMcpServerIds: readonly string[]
}

export interface NewAgent {
  readonly slug: string
  readonly displayName: string | null
  readonly provider: Provider | null
  readonly asAService?: true
}

export interface AgentIdentities {
  readonly identities: readonly AgentIdentity[]
  readonly foldersWithoutARow: readonly string[]
  readonly use: readonly IdentityUse[]
  readonly spawningEnabled: boolean
  readonly servicesOn?: true
  readonly services?: readonly string[]
  readonly defaultApprovalModeChosen?: boolean
  readonly defaultApprovalMode: 'ask' | 'auto'
  readonly externalMcpServers: readonly ExternalMcpServerRow[]
}

export const DEFAULT_PROFILE_LABEL = 'BroBot'

export function profileLabel(id: string | null): string {
  return id === null || id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_LABEL : id
}

export function agentName(
  profileId: string | null,
  identities: readonly AgentIdentityName[] | null,
): string {
  const slug = foldProfileName(profileId ?? DEFAULT_PROFILE_ID)
  const named = identities?.find((identity) => identity.slug === slug)?.displayName
  return named ?? profileLabel(slug)
}

export const SEEDED_PROVIDERS: readonly {
  readonly slug: string
  readonly provider: Provider
  readonly why: string
}[] = [
  {
    slug: DEFAULT_PROFILE_ID,
    provider: DEFAULT_IDENTITY_PROVIDER,
    why:
      'A first-run convenience so this identity opens on something rather than on the app-wide ' +
      'fallback, which every other identity already follows. It says nothing about which program ' +
      'suits which work: that is chosen per conversation, and one control changes it for good.',
  },
]

export function seededProviderFor(profileSlug: string): Provider | null {
  const folded = foldProfileName(profileSlug)
  return SEEDED_PROVIDERS.find((seed) => seed.slug === folded)?.provider ?? null
}

export const PROVIDER_NAME: Record<Provider, string> = providerRecord(
  (provider) => providerDescriptor(provider).displayName,
)

export function providerName(provider: Provider): string {
  return PROVIDER_NAME[provider]
}

function providerPossessives(conjunction: 'and' | 'or'): string {
  const names = (Object.keys(PROVIDER_NAME) as Provider[]).map((p) => `${PROVIDER_NAME[p]}'s`)
  const last = names[names.length - 1] ?? ''
  return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} ${conjunction} ${last}`
}

export const ALL_PROVIDER_FOLDERS = `${providerPossessives('and')} own folders`

export const A_PROVIDER_FOLDER = `${providerPossessives('or')} own folder`

export const YOLO_LABEL = 'YOLO'

export const PROVIDER_HAS_NOT_REPORTED = '…'

export const RUNTIME_COMMAND_CHANNEL = 'runtime:command'

export const RUNTIME_EVENT_CHANNEL = 'runtime:event'

export const APP_CLOSING_CHANNEL = 'app:closing'

export const RUNTIME_LIVENESS_CHANNEL = 'runtime:liveness'

export const RUNTIME_CHANGED_CHANNEL = 'runtime:changed'

export interface ApiKeyStatus {
  readonly provider: Provider
  readonly set: boolean
  readonly setAt: number | null
  readonly inUse: boolean
  readonly readState?: 'not-checked' | 'unreadable'
  readonly unreadableReason?: string
  readonly refusedForBilling?: {
    readonly at: number
    readonly aLoginRunsWithoutIt: boolean
  }
  readonly aCheckSpendsAToken?: true
}

export type ApiKeyChanged = ApiKeyStatus & {
  readonly refused?: string
  readonly notice?: string
}

export type ApiKeyCheck =
  | { readonly ok: true; readonly answeredARequest?: true }
  | { readonly ok: false; readonly reason: string; readonly cannotPay?: true }

export interface KeptRule {
  readonly kept: string
  readonly rule:
    | {
        readonly kind: 'tool'
        readonly tool: string
        readonly content?: string
        readonly server?: string
      }
    | { readonly kind: 'command-prefix'; readonly prefix: string[] }
}

export interface KeptRulesFile {
  readonly file: string
  readonly rules: readonly KeptRule[]
  readonly unreadable?: string
  readonly notEditedHere?: string
}

export type KeptRules = Readonly<Record<Provider, readonly KeptRulesFile[]>>

export type KeptRuleRemoved =
  { readonly removed: true } | { readonly removed: false; readonly why: string }

export type ProviderVersion =
  | { readonly version: string; readonly program: ProviderProgram }
  | { readonly version: null; readonly reason: string; readonly program?: ProviderProgram }

export type ProviderProgramFrom =
  | 'given'
  | 'development-checkout'
  | 'native-installer'
  | 'homebrew'
  | 'winget'
  | 'npm'
  | 'path'
  | 'carried'

export type ProviderProgramStanding =
  'tested' | 'older-than-tested' | 'newer-than-tested' | 'missing' | 'unreadable'

export const A_STANDING_WARNS: Readonly<Record<ProviderProgramStanding, boolean>> = {
  tested: false,
  'newer-than-tested': false,
  'older-than-tested': true,
  missing: true,
  unreadable: true,
}

export const A_STANDING_IN_A_WORD: Readonly<Record<ProviderProgramStanding, string>> = {
  tested: 'Tested version',
  'newer-than-tested': 'Newer version',
  'older-than-tested': 'Older than tested',
  missing: 'Not found',
  unreadable: 'Version unavailable',
}

export interface ProviderProgramCopy {
  readonly from: ProviderProgramFrom
  readonly path: string
  readonly version: string | null
  readonly said: string
}

export interface ProviderProgramUpdate {
  readonly command: string
}

export interface ProviderProgram {
  readonly standing: ProviderProgramStanding
  readonly from: ProviderProgramFrom | null
  readonly path: string | null
  readonly version: string | null
  readonly tested: { readonly oldest: string; readonly newest: string } | null
  readonly said: string
  readonly help: { readonly label: string; readonly url: string } | null
  readonly update: ProviderProgramUpdate | null
  readonly others: readonly ProviderProgramCopy[]
  readonly updatedFrom: string | null
}

export interface ProviderUsageReading {
  readonly window: string
  readonly usedPercent: number | null
  readonly resetsAt: number | null
  readonly at: number
  readonly unconfirmed?: true
}

export interface UsageWindowSeen {
  readonly window: string
  readonly first: number
  readonly last: number
}

export type ProviderResources = {
  readonly running: number
  readonly at: number
} & (
  | { readonly rssBytes: number; readonly cpuPercent: number }
  | { readonly rssBytes: null; readonly cpuPercent: null; readonly reason: string }
)

export interface ProvidersChangedMessage {
  readonly what: 'login' | 'usage' | 'key'
  readonly provider: Provider
}

export const PROVIDERS_CHANGED_CHANNEL = 'runtime:providers-changed'

export const RUNTIME_CHANGE_SUBJECTS = ['conversations', 'agents', 'work', 'persons'] as const

export type RuntimeChangeSubject = (typeof RUNTIME_CHANGE_SUBJECTS)[number]

export interface RuntimeChangeMessage {
  readonly what: RuntimeChangeSubject
  readonly published?: { readonly epoch: PublicationEpoch; readonly seq: number }
}

export const RUNTIME_STATES_CHANNEL = 'runtime:states'

export interface ConversationProviderBlock {
  readonly provider: Provider
  readonly resetsAt: number | null
}

export interface LastKnownProviderBlock extends ConversationProviderBlock {
  readonly asOf: number
}

export interface ProviderLimitHoldReason extends ConversationProviderBlock {
  readonly is: 'provider-limit'
}

export interface AgentStateMoved {
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  readonly conversation: string
  readonly state: AgentState
}

export interface RuntimeStatesMessage {
  readonly moved: readonly AgentStateMoved[]
  readonly kept: readonly KeptFile[]
  readonly published?: { readonly epoch: PublicationEpoch; readonly seq: number }
}

export interface ProcessMemory {
  readonly conversations: readonly { readonly conversation: string; readonly bytes: number }[]
  readonly unmeasured?: string
}

export type LivenessState = 'live' | 'silent' | 'ended' | 'errored'

export interface SessionLiveness {
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  state: LivenessState
  since: number
  detail?: string
  thinking?: true
  agent?: { label: string; value: string }[]
  approval?: ApprovalModeDisclosure
  plan?: PlanGoAheadDisclosure
  settings?: SessionSettingsDisclosure
  queued?: readonly QueuedMessageDisclosure[]
  signInSuperseded?: boolean
  canStopBackgroundWork?: boolean
  canReadCommandOutput?: boolean
  canReadToolAnswer?: boolean
  workFolders?: readonly WorkFolderGrant[]
}

export interface PlanGoAheadDisclosure {
  planNeedsGoAhead: boolean
}

export interface SessionLivenessMessage {
  sessionId: string
  liveness: SessionLiveness
}

export type WorkflowOutputResult = (
  | { ok: true; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-output' | 'gone' | 'not-readable' | 'unreadable' }
) &
  LedgerRowsUnread

export interface LedgerRowsUnread {
  readonly rowsUnread?: number
}

export type ResourceReading =
  | {
      ok: true
      resourceId: string
      name: string
      form: DocumentForm
      text: string | null
      bytes: number
    }
  | { ok: false; reason: 'no-such-resource' | 'no-store' | 'unreadable' | 'changed' }

export type ResourceDrawing =
  | {
      ok: true
      resourceId: string
      name: string
      drawnAs: DrawnAs
      bytes: Uint8Array<ArrayBuffer>
    }
  | {
      ok: false
      reason:
        | 'no-such-resource'
        | 'no-store'
        | 'unreadable'
        | 'changed'
        | 'not-a-picture-or-pdf'
        | 'not-what-its-name-says'
    }
  | { ok: false; reason: 'too-large'; bytes: number; mostBytes: number }
  | { ok: false; reason: 'too-many-pixels'; width: number; height: number; mostPixels: number }

export type ResourceReveal =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'no-such-resource' | 'no-store' | 'gone' | 'unreadable' }

export type FilesKeptScope =
  | { scope: 'tree'; conversation: string; withAdded?: true }
  | { scope: 'conversation'; conversation: string }
  | { scope: 'piece'; piece: string }

export interface KeptFile {
  readonly group?: import('./work-file-groups').WorkFileGroup
  readonly mainResult?: true
  readonly resourceId: string
  readonly title: string
  readonly name: string
  readonly form: DocumentForm | null
  readonly bytes: number
  readonly role: ResourceRole
  readonly keptAt: number
  readonly sha256: string
  readonly addedBy: {
    readonly conversation: string
    readonly name: string
    readonly identity: string | null
  } | null
  readonly piece: string
  readonly label: string
  readonly pieceTitle: string | null
}

export type FilesKept =
  | { ok: true; files: readonly KeptFile[]; added?: readonly KeptFile[] }
  | {
      ok: false
      reason:
        | Extract<LedgerWalkKind, 'no-such-conversation'>
        | Extract<RetitleRail, 'no-piece-by-that-name'>
    }

export type InstructionSourceResult =
  | { ok: true; path: string; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-source' | 'gone' | 'not-readable' | 'unreadable' }

export type SessionPathTarget =
  | { of: 'cwd' }
  | { of: 'home' }
  | { of: 'config-file'; name: string }
  | { of: 'instruction-source'; index: number }

export type RevealResult = { ok: true; path: string } | { ok: false; reason: 'no-path' | 'gone' }

export const MAX_MESSAGE_PATHS = 50
export const MAX_MESSAGE_PATH_LENGTH = 1024

export interface MessagePathAsk {
  readonly sessionId: string | null
  readonly texts: readonly string[]
}

export type MessagePath =
  | { readonly text: string; readonly found: false }
  | {
      readonly text: string
      readonly found: true
      readonly absolute: string
      readonly name: string
      readonly kind: 'file' | 'folder'
      readonly opens: boolean
    }

export interface MessagePathTarget {
  readonly sessionId: string | null
  readonly text: string
}

export type OpenMessagePathResult =
  { ok: true; did: 'opened' | 'shown' } | { ok: false; reason: 'gone' | 'no-path' | 'failed' }

export type ConfigFileResult =
  | { ok: true; path: string; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-path' | 'gone' | 'not-readable' | 'unreadable' }

export type ChildWorkPart = 'transcript' | 'journal' | 'script'

export type ChildWorkInput =
  { part: 'transcript'; agentId: string } | { part: 'journal' | 'script'; taskId: string }

export type ChildTalkRefusal =
  | 'unknown-agent'
  | 'unsupported'
  | 'not-live'
  | 'unreachable'
  | 'working'
  | 'not-accepting'
  | 'unloaded'
  | 'error'

export type ChildStateResult =
  | { ok: true; state: ChildThreadState }
  | { ok: false; reason: 'unknown-agent' | 'unsupported' | 'not-live' | 'unreachable' }

export type ChildSendResult =
  | { ok: true; turnId: string | null }
  | { ok: false; reason: ChildTalkRefusal; state?: ChildThreadState }

export type ChildWorkResult = (
  | {
      ok: true
      part: ChildWorkPart
      name: string
      runId: string | null
      taskId: string | null
      title?: string
      parentToolCallId?: string
      text: string
      truncated: boolean
      bytes: number
      entries?: TranscriptEvent[]
      unreadable?: number
      thinkingBlocks?: number
    }
  | {
      ok: false
      reason: 'unknown-agent' | 'unsupported' | 'gone' | 'not-readable' | 'unreadable'
    }
) &
  LedgerRowsUnread

export interface ProviderConfigFile {
  name: string
  path: string
  exists: boolean
  note: string
}

export interface ProviderConfigInfo {
  home: string
  homeEnv: string
  model: string
  authNote: string | null
  files: ProviderConfigFile[]
}

export const RUNNING_STATES = ['not-running', 'unwatched', 'in-a-window'] as const

export type RunningState = (typeof RUNNING_STATES)[number]

export interface PieceWaitingOnPurpose {
  readonly label: string
  readonly status: string
  readonly on?: WaitOn
  readonly agentName?: string
}

export interface ResumableSessionInfo {
  readonly worker?: WorkerBindingReading
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  sessionId: string
  provider: Provider
  ref: SessionRef
  cwd: string
  status: SessionStatus
  running: RunningState
  state: AgentState
  named: WorkThatNamesIt | null
  readonly waitingOnPurpose?: PieceWaitingOnPurpose
  approvalMode: 'ask' | 'auto' | null
  profileId: string | null
  reasoningEffort: string | null
  model: string | null
  reported?: ReportedModel
  planMode: boolean | null
  adoptedAt: number | null
  hasTranscript: boolean
  lastEnding: TurnEnding | null
  child: LibraryChild | null
  resumeRefusal: string | null
  updatedAt: number
}

export interface UnresumableSessionInfo {
  readonly worker?: WorkerBindingReading
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  sessionId: string
  provider: Provider
  cwd: string
  status: SessionStatus
  running: RunningState
  state: AgentState
  named: WorkThatNamesIt | null
  readonly waitingOnPurpose?: PieceWaitingOnPurpose
  profileId: string | null
  adoptedAt: number | null
  updatedAt: number
  hasTranscript: boolean
  foundInUserHome: boolean
  restoredFromBundle: boolean
  lastEnding: TurnEnding | null
  reason: string
}

export type ExportKind = 'native' | 'bundle' | 'reading'

export const READING_SUFFIX = '.md'

export const READING_NOTE =
  'A readable copy of this conversation, as BroCrew showed it. It is for reading, not for resuming.'

export const MAX_READING_BYTES = 32 * 1024 * 1024

export type ExportAsked =
  | { readonly sessionId: string; readonly exportKind: 'native' | 'bundle' }
  | { readonly sessionId: string; readonly exportKind: 'reading'; readonly body: string }

export interface ExportedSession {
  kind: ExportKind
  path: string
  frames: number
  ledgerEntries: number
  resumable: boolean
  note: string
}

export const BUNDLE_SUFFIX = '.brobot-session.json'

export type ImportedBundle =
  | {
      ok: true
      sessionId: string
      already: boolean
      behind?: {
        held: number
        inFile: number
        heldAt: number | null
        fileAt: number
      }
      provider: Provider
      cwd: string
      events: number
    }
  | { ok: false; reason: string }

export interface SkippedSessionInfo {
  provider: Provider
  path: string
  reason: string
}

export interface AdoptionReport {
  found: number
  adopted: number
  alreadyKnown: number
  imported: number
  descentsLearned: number
  named: number
  skipped: SkippedSessionInfo[]
}

export type DerivedState = 'current' | 'stale' | 'rebuilding' | 'failed'

export interface LedgerStatus {
  present: boolean
  derived: DerivedState | null
  derivedThrough: number
  normalizerVersion: number
  failure: string | null
}

export interface RebuiltLedger {
  outcome:
    | 'imported'
    | 'nothing-readable'
    | 'still-writing'
    | 'skipped'
    | 'stopped'
    | 'failed'
    | 'unknown-session'
    | 'in-use'
    | 'gone'
    | 'recorded'
    | 'refused'
    | 'superseded'
  status: LedgerStatus | null
}

export const LIBRARY_ORIGINS = ['ours', 'user-home', 'restored'] as const
export type LibraryOrigin = (typeof LIBRARY_ORIGINS)[number]

export interface LibraryEntry {
  id: string
  provider: Provider
  providerSessionId: string | null
  recordId: string | null
  cwd: string
  title: string
  preview: string
  createdAt: number
  updatedAt: number
  bytes: number | null
  origin: LibraryOrigin
  onDisk: boolean
  readable: boolean
  derived: DerivedState | null
  lastEnding: TurnEnding | null
  unresumableReason: string | null
  child: LibraryChild | null
  profileId?: string
  archivedAt?: number
}

export interface LibraryChild {
  parentSessionId: string | null
  depth: number | null
  nickname: string | null
  role: string | null
}

export interface LibraryCounts {
  total: number
  ours: number
  userHome: number
  restored: number
  imported: number
  notImported: number
  onlyHere: number
  providers: LibraryProviderCount[]
}

export interface LibraryProviderCount {
  provider: Provider
  total: number
}

export interface LibraryPage {
  entries: LibraryEntry[]
  matched: number
  counts: LibraryCounts
  skipped: SkippedSessionInfo[]
  skippedTotal: number
}

export interface LibraryQuery {
  query?: string
  recordId?: string
  filters?: LibraryFilters
  limit?: number
  offset?: number
}

export const LIBRARY_KINDS = ['top', 'sub'] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

export const LIBRARY_ARCHIVED = ['only', 'left-out'] as const
export type LibraryArchived = (typeof LIBRARY_ARCHIVED)[number]

export interface LibraryFilters {
  provider?: Provider
  origin?: LibraryOrigin
  kind?: LibraryKind
  notImported?: boolean
  unresumable?: boolean
  behind?: boolean
  offDisk?: boolean
  unreadable?: boolean
  archived?: LibraryArchived
}

export interface ImportedFromHome {
  outcome:
    | 'imported'
    | 'up-to-date'
    | 'nothing-readable'
    | 'still-writing'
    | 'stopped'
    | 'unreadable'
    | 'missing'
  sessionId: string | null
  readable: boolean
  note: string
}

export interface ImportedRecording {
  outcome:
    | 'imported'
    | 'skipped'
    | 'nothing-readable'
    | 'still-writing'
    | 'stopped'
    | 'failed'
    | 'superseded'
    | 'unknown-session'
    | 'in-use'
    | 'refused'
    | 'user-home'
  readable: boolean
  note: string
}

export interface CreatedSession {
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
  sessionId: string
  provider: Provider
  cwd: string
  providerHome: string
  profileId: string
  ref: SessionRef | null
  config: ProviderConfigInfo
  instructions: SessionInstructions
  approvalMode: ApprovalModeDisclosure['approvalMode']
  pendingApprovalMode: ApprovalModeDisclosure['pendingApprovalMode']
  approvalNote: ApprovalModeDisclosure['approvalNote']
  blanketGrants: ApprovalModeDisclosure['blanketGrants']
  planNeedsGoAhead: PlanGoAheadDisclosure['planNeedsGoAhead']
  settings: SessionSettingsDisclosure
  queued: readonly QueuedMessageDisclosure[]
  liveness: SessionLiveness
  hasACommander: boolean
  startedWithoutAWindow: boolean
  mayHandItBack: boolean
  cannotTakeAMessage?: string | null
  settingsFixed?: boolean
  ranAsNobody?: 'user-home' | 'bundle'
}

export const LAUNCH_REFUSALS = [
  'sign-in',
  'program',
  'folder',
  'machine',
  'cancelled',
  'launch',
] as const

export type LaunchRefusal = (typeof LAUNCH_REFUSALS)[number]

export interface RefusedLaunch {
  readonly refused: {
    readonly reason: LaunchRefusal
    readonly said: string
  }
}

export interface ApprovalModeDisclosure {
  approvalMode: 'ask' | 'auto'
  pendingApprovalMode: 'ask' | 'auto' | null
  approvalNote: string
  blanketGrants: string[]
}

export interface QueuedMessageDisclosure {
  readonly holdReason?: ProviderLimitHoldReason | null
  readonly holdReasonStatus?: 'current' | 'unavailable'
  kind: MailboxKind
  id: string
  text: string
  since: number
  attribution?: UserTurnEvent['attribution']
}

export const TURN_AUTHORSHIP_KEYS = [
  'humanInitiated',
  'attribution',
  'work',
  'relayedFrom',
  'relayedFromProfile',
  'appNotice',
  'says',
  'answeredQuestion',
  'movedFrom',
] as const satisfies readonly (keyof TurnAuthorship)[]

export const TURN_ATTRIBUTION_KEYS = TURN_AUTHORSHIP_KEYS.filter((key) => key !== 'humanInitiated')

export const TURN_AUTHORSHIP_KEYS_ARE_EXHAUSTIVE: [
  Exclude<keyof TurnAuthorship, (typeof TURN_AUTHORSHIP_KEYS)[number]>,
] extends [never]
  ? true
  : never = true

export const MAX_TURN_PARTS = 64

export const USER_TURN_PART_KEYS = [
  'text',
  'attachments',
  ...TURN_AUTHORSHIP_KEYS,
  'piece',
  'label',
  'drives',
] as const satisfies readonly (keyof UserTurnPart)[]

export const USER_TURN_PART_KEYS_ARE_EXHAUSTIVE: [
  Exclude<keyof UserTurnPart, (typeof USER_TURN_PART_KEYS)[number]>,
] extends [never]
  ? true
  : never = true

export function theMessagesOf(turn: UserTurnEvent): readonly UserTurnPart[] {
  const parts: unknown = turn.parts
  if (parts === undefined) return [turn]
  if (!Array.isArray(parts)) return []
  const read: unknown[] = parts
  return read
    .slice(0, MAX_TURN_PARTS)
    .filter(
      (one): one is UserTurnPart =>
        typeof one === 'object' &&
        one !== null &&
        typeof (one as { text?: unknown }).text === 'string',
    )
}

export const MEMORY_NOTE_TEXT_CAP = 4 * 1024

export const MEMORY_NOTES_PER_EVENT = 20

export type AgentProviderSet = AgentIdentity & {
  readonly modelChoiceCleared: AgentModelChoice | null
}

export const HISTORY_WINDOW_TURNS = 12
export const HISTORY_WINDOW_MAX_EVENTS = 2_500

export interface HistoryWindow {
  humanAnswers?: import('./human-answer-contracts').HumanAnswers
  entries: PersistedEventInfo[]
  from: number
  hasOlder: boolean
  turnAligned: boolean
  toolsInForce?: PersistedEventInfo
}

export interface ResumedSession extends CreatedSession {
  history: HistoryWindow
  handover: SessionHandover
  readonly liveFrom?: number
  readonly asHandedOver?: Pick<ConversationAtWork, 'status' | 'told'>
}

export type SessionHandover = 'resumed' | 'attached' | 'recorded'

export interface ReleasedSession {
  readonly sessionId: string
  readonly running: RunningState
  readonly waitingForAHuman: boolean
}

export interface RuntimeEventMessage {
  humanFinal?: import('./human-answer-contracts').HumanFinalContext | null
  sessionId: string
  ordinal: number
  at: number
  event: TranscriptEvent
}

export interface CreateSessionInput {
  provider: Provider
  cwd?: string
  profileId?: string
  approvalMode?: 'ask' | 'auto'
  reasoningEffort?: ReasoningEffort
  model?: string
  planMode?: boolean
  ultracode?: boolean
  launchKey?: string
}

export interface LaunchInput {
  launchKey: string
}

export type ResumeInput = SessionInput & Partial<LaunchInput>

export interface LookInput extends SessionInput {
  claim?: boolean
}

export type StartAndSendInput = SendInput & Partial<LaunchInput>

export const FIRST_MESSAGE_REFUSALS = [
  'already-starting',
  'held-elsewhere',
  'before-the-start',
  'the-start',
  'after-the-start',
] as const

export type FirstMessageRefusal = (typeof FIRST_MESSAGE_REFUSALS)[number]

export interface FirstMessageSent {
  readonly sent: ResumedSession
}

export interface FirstMessageNotSent {
  readonly notSent: {
    readonly refusedBy: FirstMessageRefusal
    readonly said: string
    readonly launch: LaunchRefusal | null
    readonly running: ResumedSession | null
  }
}

export type FirstMessageAnswer = FirstMessageSent | FirstMessageNotSent

export const HELD_ELSEWHERE =
  'This conversation is already open in another window. Switch to that window to carry on with it.'

export const A_FIRST_MESSAGE_IS_STARTING_IT =
  'Nothing was sent: the message before it has not gone in yet. Send it again in a moment.'

export type { ReasoningEffort }

export function pastedImageLabel(image: PastedImage | undefined): string {
  if (image === undefined) return 'an image you pasted'
  const kb = Math.max(1, Math.round(image.bytes / 1024))
  return `an image you pasted · ${image.width} × ${image.height} · ${kb} KB`
}

export const MAX_HANDED_PATHS = 10

export interface SendInput {
  sessionId: string
  text: string
  attachments?: HandedPath[]
}

export function hasSomethingToSend(text: string, attached: number): boolean {
  return text.trim() !== '' || attached > 0
}

export const NOTHING_TO_SEND =
  'that message has no words and nothing attached, so there is nothing to send'

export function nothingToSendYet(canAttach: boolean): string {
  return canAttach ? 'Type a message, or attach a file, to send' : 'Type a message to send'
}

export const LIBRARY_QUERY_MAX = 200

export const MAX_PATH_CHARS = 4096

export const AGENT_DISPLAY_NAME_CHARS = 200

export function hasControlCharacter(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- the control characters ARE the subject
  return /[\u0000-\u001F\u007F]/.test(value)
}

export const CONTROL_CHARACTER_IN_PATH =
  'that name contains a character BroCrew cannot hand over safely (a line break or a control ' +
  'character) — attach the folder it is in instead'

const REORDERING_CLASS = '[\\u2028\\u2029\\u200E\\u200F\\u061C\\u202A-\\u202E\\u2066-\\u2069]'
const REORDERING = new RegExp(REORDERING_CLASS)
const REORDERING_ALL = new RegExp(REORDERING_CLASS, 'g')

export function hasReorderingCharacter(value: string): boolean {
  return REORDERING.test(value)
}

export function quotedLiteral(value: string): string {
  return JSON.stringify(value).replace(
    REORDERING_ALL,
    (char) => `\\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  )
}

export type QueueOutcome =
  { readonly outcome: 'queued'; readonly messageId: string } | { readonly outcome: 'sent' }

export type AnswerAck =
  | {
      readonly outcome: 'taken'
      readonly reason?: string
    }
  | {
      readonly outcome: 'refused'
      readonly reason: string
      readonly stillOpen: boolean
    }

export type ProviderAnswerAck = AnswerAck | AnswerUnacknowledged

export interface AnswerUnacknowledged {
  readonly outcome: 'unacknowledged'
  readonly waitedMs: number
}

export interface SetApprovalModeInput {
  sessionId: string
  mode: 'ask' | 'auto'
}

export interface EndPlanModeInput {
  sessionId: string
  text?: string
}

export interface SetSessionSettingInput {
  sessionId: string
  body:
    | { kind: 'model'; value?: string }
    | { kind: 'reasoningEffort'; value?: string }
    | { kind: 'planMode'; on: true }
}

export type ChosenCwd = { path: string; refusal?: string } | null

export type ChosenAttachment = { handed: HandedPath } | { refusal: string } | null

export type DroppedPathVerdict = { handed: HandedPath } | { refusal: string }

export const NO_IMAGE_ON_CLIPBOARD =
  'there is no picture on the clipboard — copy an image, or drop a file in'

export const MAX_PASTED_IMAGE_BYTES = 32 * 1024 * 1024

export function pastedImageTooBig(bytes: number): string {
  const mb = (value: number): string => `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`
  return (
    `that picture is ${mb(bytes)} and BroCrew writes at most ${mb(MAX_PASTED_IMAGE_BYTES)} — ` +
    'save it somewhere yourself and attach the file'
  )
}

export function onlyOnePastedImage(extra: number): string {
  return `only one picture can come off the clipboard at a time — ${extra} more ${
    extra === 1 ? 'was' : 'were'
  } not added`
}

export function noRoomForPastedImage(): string {
  return (
    `one message can carry ${MAX_HANDED_PATHS} attachments — the picture was not added, and ` +
    'nothing was written'
  )
}

export const MAX_PASTED_IMAGE_PIXELS = 40_000_000

export function pastedImageTooManyPixels(width: number, height: number): string {
  const mp = (value: number): string => `${Math.round((value / 1_000_000) * 10) / 10} megapixels`
  return (
    `that picture is ${width} × ${height} — ${mp(width * height)}, and BroCrew re-encodes at most ` +
    `${mp(MAX_PASTED_IMAGE_PIXELS)} — save it somewhere yourself and attach the file`
  )
}

const PASTED_IMAGE_NAME = /^pasted-[0-9a-f]{32}\.png$/

export function pastedImageName(digest: string): string {
  return `pasted-${digest.slice(0, 32)}.png`
}

export function isPastedImage(path: string): boolean {
  return isPastedImageName(pathTail(path))
}

export function isPastedImageName(name: string): boolean {
  return PASTED_IMAGE_NAME.test(name)
}

export type CwdVerdict = { ok: true; path: string } | { ok: false; reason: string }

export interface RespondPermissionInput {
  sessionId: string
  requestId: string
  decision: PermissionDecision
}

export interface RespondUserInputInput {
  sessionId: string
  requestId: string
  response: UserInputResponse
}

export interface AnswerActionInput {
  sessionId: string
  request: string
  done: boolean
  note?: string
}

export interface SessionInput {
  sessionId: string
}

export interface CancelQueuedMessageInput {
  sessionId: string
  messageId: string
}

export interface StopBackgroundWorkInput {
  sessionId: string
  id: string
}

export type RuntimeCommand =
  | { kind: 'skills'; request: SkillsRequest }
  | { kind: 'resolveLink'; target: string }
  | ({ kind: 'createSession' } & CreateSessionInput & { readonly answerARefusal?: true })
  | ({ kind: 'send' } & SendInput)
  | ({ kind: 'sendInterrupting' } & SendInput)
  | ({ kind: 'queueMessage' } & SendInput)
  | ({ kind: 'cancelQueuedMessage' } & CancelQueuedMessageInput)
  | ({ kind: 'takeBackAndStop' } & CancelQueuedMessageInput)
  | ({ kind: 'respondPermission' } & RespondPermissionInput)
  | ({ kind: 'respondUserInput' } & RespondUserInputInput)
  | ({ kind: 'answerAction' } & AnswerActionInput)
  | ({ kind: 'decideMoveRequest' } & DecideMoveRequestInput)
  | ({ kind: 'interrupt' } & SessionInput)
  | ({ kind: 'stopBackgroundWork' } & StopBackgroundWorkInput)
  | ({ kind: 'close' } & SessionInput)
  | ({ kind: 'refreshConfig' } & SessionInput)
  | ({ kind: 'setApprovalMode' } & SetApprovalModeInput)
  | ({ kind: 'setSessionSetting' } & SetSessionSettingInput)
  | ({ kind: 'endPlanMode' } & EndPlanModeInput)
  | { kind: 'listResumable' }
  | { kind: 'listUnresumable' }
  | { kind: 'adoptSessions' }
  | {
      kind: 'exportSession'
      sessionId: string
      exportKind: ExportKind
      readingBody?: string
    }
  | { kind: 'importBundleFile'; path: string }
  | ({ kind: 'resume' } & ResumeInput)
  | ({ kind: 'look' } & LookInput)
  | ({ kind: 'stopLooking' } & SessionInput)
  | ({ kind: 'startAndSend' } & StartAndSendInput)
  | ({ kind: 'cancelLaunch' } & LaunchInput)
  | { kind: 'attachOpen' }
  | ({ kind: 'claim' } & SessionInput)
  | ({ kind: 'release' } & SessionInput)
  | { kind: 'questionsForAPerson' }
  | { kind: 'decisionsForAPerson' }
  | { kind: 'limitsForAPerson' }
  | { kind: 'readLimitsDisplay' }
  | { kind: 'instructionAsksForAPerson' }
  | { kind: 'mcpServerRequestsForAPerson' }
  | { kind: 'stalledWorkForAPerson' }
  | { kind: 'stoppedWorkForAPerson' }
  | { kind: 'currentEpoch' }
  | { kind: 'personsQueue' }
  | { kind: 'listConversations' }
  | { kind: 'workIncidentsForAPerson' }
  | { kind: 'waitingOnWhoWroteForAPerson' }
  | { kind: 'digest'; from: number; to: number }
  | { kind: 'recentActivity'; from: number; to: number }
  | { kind: 'workGivenBy'; sessionId: string }
  | { kind: 'whoCalledWhom'; sessionId: string }
  | { kind: 'readWorkspace' }
  | { kind: 'whatIsBeingDone' }
  | { kind: 'whatEachConversationIsWaitingOn' }
  | { kind: 'theWholeForest' }
  | { kind: 'processMemory' }
  | ({ kind: 'listLibrary' } & LibraryQuery)
  | ({ kind: 'importRecordedSession' } & SessionInput)
  | { kind: 'importUserHomeSession'; provider: Provider; providerSessionId: string }
  | { kind: 'rebuildLedger'; sessionId: string }
  | ({ kind: 'readWorkflowOutput' } & SessionInput & { taskId: string })
  | ({ kind: 'readInstructionSource' } & SessionInput & { index: number })
  | ({ kind: 'revealPath' } & SessionInput & { target: SessionPathTarget })
  | ({ kind: 'readConfigFile' } & SessionInput & { name: string })
  | ({ kind: 'readCommandOutput' } & SessionInput & { toolCallId: string })
  | ({ kind: 'readToolAnswer' } & SessionInput & { toolCallId: string })
  | { kind: 'readResource'; resourceId: string }
  | { kind: 'drawResource'; resourceId: string }
  | { kind: 'revealResource'; resourceId: string }
  | ({ kind: 'resolveMessagePaths' } & MessagePathAsk)
  | ({ kind: 'openMessagePath' } & MessagePathTarget)
  | ({ kind: 'revealMessagePath' } & MessagePathTarget)
  | ({ kind: 'filesKept' } & FilesKeptScope)
  | { kind: 'filesLibrary'; request: import('./files-library').FilesLibraryRequest }
  | { kind: 'teamProfileGraph'; request: import('./team-profile-graph').TeamProfileGraphRequest }
  | { kind: 'searchWork'; conversation: string; query: import('./work-search').WorkSearchQuery }
  | ({ kind: 'readChildWork' } & SessionInput & ChildWorkInput)
  | ({ kind: 'readChildState' } & SessionInput & { agentId: string })
  | ({ kind: 'sendToChild' } & SessionInput & { agentId: string; text: string })
  | ({ kind: 'earlierHistory' } & EarlierHistoryInput)
  | ({ kind: 'latestHistory' } & SessionInput)
  | { kind: 'capabilities' }
  | { kind: 'providerConnections' }
  | ({ kind: 'modelList' } & ProviderProfileInput)
  | { kind: 'addHandAddedModel'; provider: Provider; model: string }
  | { kind: 'deleteHandAddedModel'; provider: Provider; model: string }
  | { kind: 'apiKeyStatus'; provider: Provider }
  | { kind: 'setApiKey'; provider: Provider; key: string }
  | { kind: 'removeApiKey'; provider: Provider }
  | { kind: 'checkApiKey'; provider: Provider }
  | { kind: 'providerVersions' }
  | { kind: 'keptRules' }
  | { kind: 'removeKeptRule'; provider: Provider; file: string; kept: string }
  | { kind: 'providerSetup' }
  | { kind: 'providerUsage' }
  | { kind: 'providerResources' }
  | { kind: 'profiles' }
  | ({ kind: 'checkProviderAuth' } & CheckProviderAuthInput)
  | ({ kind: 'reprovisionProviderAuth' } & ProviderProfileInput)
  | { kind: 'reprovisionProviderHomes'; provider: Provider; statusOnly?: boolean }
  | ({ kind: 'signInProvider' } & ProviderProfileInput)
  | ({ kind: 'cancelProviderSignIn' } & ProviderProfileInput)
  | { kind: 'checkCwd'; path: string }
  | { kind: 'agentIdentities' }
  | {
      kind: 'setCapabilities'
      profileId: string
      grant: CapabilityGrant
      externalMcpServerIds: readonly string[]
    }
  | {
      kind: 'registerExternalMcpServer'
      name: string
      url: string
      reach: ExternalMcpServerReach
    }
  | { kind: 'removeExternalMcpServer'; serverId: string }
  | { kind: 'setAgentProvider'; profileId: string; provider: Provider | null }
  | { kind: 'setAgentDisplayName'; profileId: string; displayName: string | null }
  | { kind: 'retitleWork'; piece: string; title: string }
  | { kind: 'takeBackWork'; piece: string }
  | { kind: 'closeWork'; piece: string }
  | {
      kind: 'setAgentModelAndEffort'
      profileId: string
      provider: Provider | null
      model: string | null
      effort: string | null
    }
  | { kind: 'agentModelAndEffort'; profileId: string }
  | {
      kind: 'instructAgent'
      profileId: string
      baseline?: RulesBaseline
      text: string
      broughtBack?: number
    }
  | { kind: 'agentInstructions'; profileId: string }
  | { kind: 'agentMethods'; profileId: string; offset?: number; limit?: number }
  | { kind: 'agentMethodBody'; profileId: string; key: string }
  | { kind: 'agentMethodChanges'; profileId: string; offset?: number; limit?: number }
  | { kind: 'removeAgentMethod'; profileId: string; selection: MethodDeleteSelection }
  | { kind: 'undoAgentMethod'; profileId: string; changeId: string }
  | { kind: 'checkInterruptedAgentMethods'; profileId: string; confirmed: boolean }
  | { kind: 'agentOwnNotes'; profileId: string }
  | { kind: 'agentOwnNotesUnread'; profileId: string }
  | ({ kind: 'saveOwnNotes'; profileId: string } & OwnNotesWrite)
  | { kind: 'undoOwnNotes'; profileId: string; expectedVersion: number }
  | { kind: 'markOwnNotesSeen'; profileId: string; throughVersion: number }
  | { kind: 'agentRulesUnread'; profileId: string }
  | { kind: 'undoAgentRules'; profileId: string; expectedVersion: number }
  | { kind: 'markAgentRulesSeen'; profileId: string; throughVersion: number }
  | { kind: 'agentMemory'; profileId: string; offset?: number; limit?: number }
  | { kind: 'whatThisAgentWasGiven'; sessionId: string }
  | { kind: 'whatTheModelGot'; sessionId: string; ordinal: number }
  | ({ kind: 'amendAgentMemory' } & MemoryAmendmentAsked)
  | ({ kind: 'undoAgentMemory' } & MemoryUndoAsked)
  | ({ kind: 'checkInterruptedMemory' } & MemoryCheckAsked)
  | { kind: 'decideInstruction'; askId: string; approve: boolean }
  | { kind: 'decideMcpServerRequest'; requestId: string; approve: boolean }
  | { kind: 'removeAgent'; profileId: string }
  | { kind: 'archiveConversation'; sessionId: string }
  | { kind: 'restoreConversation'; sessionId: string }
  | { kind: 'checkDeleteConversation'; sessionId: string }
  | { kind: 'deleteConversation'; sessionId: string; parts: string[] }
  | ({ kind: 'createAgent' } & NewAgent)
  | { kind: 'setSpawningEnabled'; enabled: boolean }
  | { kind: 'setServicesOn'; on: boolean }
  | { kind: 'setDefaultApprovalMode'; mode: 'ask' | 'auto' }

export interface EarlierHistoryInput {
  sessionId: string
  before: number
  turns?: number
}

export type RuntimeCommandKind = RuntimeCommand['kind']

export interface RuntimeCommandResults {
  skills: SkillsReply
  createSession: CreatedSession | RefusedLaunch
  send: void
  sendInterrupting: void
  queueMessage: QueueOutcome
  cancelQueuedMessage: void
  takeBackAndStop: void
  respondPermission: ProviderAnswerAck
  respondUserInput: ProviderAnswerAck
  resolveLink: LinkResolution
  answerAction: AnswerAck
  decideMoveRequest: MoveRequestAck
  interrupt: void
  stopBackgroundWork: boolean
  close: void
  refreshConfig: ProviderConfigInfo
  setApprovalMode: ApprovalModeDisclosure
  setSessionSetting: SessionSettingChanged
  endPlanMode: void
  listResumable: ResumableSessionInfo[]
  listUnresumable: UnresumableSessionInfo[]
  adoptSessions: AdoptionReport
  exportSession: ExportedSession
  importBundleFile: ImportedBundle
  resume: ResumedSession
  look: ResumedSession
  stopLooking: void
  startAndSend: FirstMessageAnswer
  cancelLaunch: boolean
  attachOpen: ResumedSession[]
  claim: ResumedSession
  release: ReleasedSession
  questionsForAPerson: LedgerWalk<PersonsQuestion>
  decisionsForAPerson: LedgerWalk<PersonsDecision>
  limitsForAPerson: LedgerWalk<ProviderLimitSeen>
  readLimitsDisplay: LimitsDisplayAnswer
  instructionAsksForAPerson: readonly InstructionAskWaiting[]
  mcpServerRequestsForAPerson: readonly McpServerRequestForAPerson[]
  stalledWorkForAPerson: LedgerWalk<StalledWork>
  currentEpoch: PublicationEpoch
  personsQueue: PersonsQueueAnswer
  listConversations: ListingAnswer
  stoppedWorkForAPerson: LedgerWalk<StoppedWorkForAPerson>
  workIncidentsForAPerson: LedgerWalk<WorkIncident>
  waitingOnWhoWroteForAPerson: LedgerWalk<WaitingOnWhoWrote>
  digest: DigestReading
  recentActivity: RecentActivityReading
  workGivenBy: LedgerWalk<WorkGivenOut>
  whoCalledWhom: WhoCalledWhom
  readWorkspace: WorkspaceReading
  whatIsBeingDone: WhatIsBeingDone
  whatEachConversationIsWaitingOn: WhatEachConversationIsWaitingOn
  theWholeForest: TheWholeForest
  processMemory: ProcessMemory
  listLibrary: LibraryPage
  importRecordedSession: ImportedRecording
  importUserHomeSession: ImportedFromHome
  rebuildLedger: RebuiltLedger
  readWorkflowOutput: WorkflowOutputResult
  readInstructionSource: InstructionSourceResult
  readResource: ResourceReading
  drawResource: ResourceDrawing
  revealResource: ResourceReveal
  filesKept: FilesKept
  filesLibrary: import('./files-library').FilesLibraryResult
  teamProfileGraph: import('./team-profile-graph').TeamProfileGraphResult
  searchWork: import('./work-search').WorkSearchResult
  revealPath: RevealResult
  resolveMessagePaths: MessagePath[]
  openMessagePath: OpenMessagePathResult
  revealMessagePath: RevealResult
  readConfigFile: ConfigFileResult
  readCommandOutput: CommandTail | null
  readToolAnswer: ToolAnswer | null
  readChildWork: ChildWorkResult
  readChildState: ChildStateResult
  sendToChild: ChildSendResult
  earlierHistory: HistoryWindow
  latestHistory: HistoryWindow
  capabilities: ProviderCapabilityMap
  providerConnections: readonly ProviderConnection[]
  profiles: string[]
  checkCwd: CwdVerdict
  createAgent: AgentIdentity
  agentIdentities: AgentIdentities
  setCapabilities: AgentIdentity | null
  registerExternalMcpServer: ExternalMcpServerRow
  removeExternalMcpServer: boolean
  setAgentProvider: AgentProviderSet | null
  setAgentDisplayName: AgentIdentity | null
  retitleWork: WorkRetitled
  takeBackWork: WorkTakenBackByAPerson
  closeWork: WorkClosedByAPerson
  setAgentModelAndEffort: ModelChoiceSaved
  agentModelAndEffort: AgentModelChoice | null
  modelList: ModelList
  addHandAddedModel: readonly string[]
  deleteHandAddedModel: readonly string[]
  apiKeyStatus: ApiKeyStatus
  setApiKey: ApiKeyChanged
  removeApiKey: ApiKeyChanged
  checkApiKey: ApiKeyCheck
  providerVersions: Readonly<Record<Provider, ProviderVersion>>
  keptRules: KeptRules
  removeKeptRule: KeptRuleRemoved
  providerSetup: Readonly<Record<Provider, ProviderSetup | null>>
  providerUsage: Readonly<Record<Provider, readonly ProviderUsageReading[]>>
  providerResources: Readonly<Record<Provider, ProviderResources>>
  instructAgent: AgentInstructionsReading | null
  agentInstructions: AgentInstructionsReading
  agentMethods: MethodLibrary | null
  agentMethodBody: MethodBody | null
  agentMethodChanges: MethodHistoryResult
  removeAgentMethod: MethodChangeResult
  undoAgentMethod: MethodChangeResult
  checkInterruptedAgentMethods: MethodChangeResult
  agentOwnNotes: OwnNotesReading | null
  agentOwnNotesUnread: OwnNotesUnread
  saveOwnNotes: OwnNotesReading | null
  undoOwnNotes: OwnNotesReading | null
  markOwnNotesSeen: boolean
  agentRulesUnread: InstructionUnread
  undoAgentRules: AgentInstructionsReading | null
  markAgentRulesSeen: boolean
  agentMemory: AgentMemoryReading
  whatThisAgentWasGiven: WhatThisAgentWasGiven
  whatTheModelGot: WhatTheModelGot
  amendAgentMemory: AgentMemoryAmended | null
  undoAgentMemory: AgentMemoryAmended | null
  checkInterruptedMemory: MemoryChecked | null
  decideInstruction: AnswerAck
  decideMcpServerRequest: AnswerAck
  removeAgent: AgentRemoved
  archiveConversation: ArchiveOutcome
  restoreConversation: ArchiveOutcome
  checkDeleteConversation: DeleteVerdict
  deleteConversation: DeleteOutcome
  setSpawningEnabled: { spawningEnabled: boolean }
  setServicesOn: { servicesOn: boolean }
  setDefaultApprovalMode: { defaultApprovalMode: 'ask' | 'auto' }
  checkProviderAuth: AuthState
  reprovisionProviderAuth: ReprovisionOutcome
  reprovisionProviderHomes: ProviderHomesReprovision
  signInProvider: ProviderSignInResult
  cancelProviderSignIn: void
}

export type ProviderCapabilityMap = Record<Provider, ProviderCapabilities>

export interface CheckProviderAuthInput extends ProviderProfileInput {
  probe?: boolean
}

export interface ProviderHomesReprovision {
  readonly replaced: number
  readonly pending: number
  readonly skipped: number
  readonly failed: number
  readonly profiles: readonly (
    | { readonly profileId: string; readonly state: 'replaced' | 'pending' }
    | {
        readonly profileId: string
        readonly state: 'skipped'
        readonly reason: 'api-key' | 'key-status-unavailable' | 'unchanged'
      }
    | {
        readonly profileId: string
        readonly state: 'failed'
        readonly reason: 'copy-failed' | 'restart-failed' | 'stop-failed'
      }
  )[]
}

export interface ProviderProfileInput {
  provider: Provider
  profileId?: string
}

export interface ProviderSignInResult {
  success: boolean
  detail?: string
  state: AuthState
}

export type RuntimeCommandResult<K extends RuntimeCommandKind> = RuntimeCommandResults[K]

export interface RuntimeBridge {
  skills(request: SkillsRequest): Promise<SkillsReply>
  createSession<Asked extends true | undefined = undefined>(
    input: CreateSessionInput & { readonly answerARefusal?: Asked },
  ): Promise<Asked extends true ? CreatedSession | RefusedLaunch : CreatedSession>
  send(input: SendInput): Promise<void>
  sendInterrupting(input: SendInput): Promise<void>
  queueMessage(input: SendInput): Promise<QueueOutcome>
  cancelQueuedMessage(input: CancelQueuedMessageInput): Promise<void>
  takeBackAndStop(input: CancelQueuedMessageInput): Promise<void>
  respondPermission(input: RespondPermissionInput): Promise<ProviderAnswerAck>
  respondUserInput(input: RespondUserInputInput): Promise<ProviderAnswerAck>
  resolveLink(target: string): Promise<LinkResolution>
  answerAction(input: AnswerActionInput): Promise<AnswerAck>
  decideMoveRequest(input: DecideMoveRequestInput): Promise<MoveRequestAck>
  interrupt(input: SessionInput): Promise<void>
  stopBackgroundWork(input: StopBackgroundWorkInput): Promise<boolean>
  close(input: SessionInput): Promise<void>
  refreshConfig(input: SessionInput): Promise<ProviderConfigInfo>
  endPlanMode(input: EndPlanModeInput): Promise<void>
  setApprovalMode(input: SetApprovalModeInput): Promise<ApprovalModeDisclosure>
  setSessionSetting(input: SetSessionSettingInput): Promise<SessionSettingChanged>
  listResumable(): Promise<ResumableSessionInfo[]>
  listUnresumable(): Promise<UnresumableSessionInfo[]>
  adoptSessions(): Promise<AdoptionReport>
  exportSession(input: ExportAsked): Promise<ExportedSession>
  importBundleFile(input: { path: string }): Promise<ImportedBundle>
  resume(input: ResumeInput): Promise<ResumedSession>
  look(input: LookInput): Promise<ResumedSession>
  stopLooking(input: SessionInput): Promise<void>
  startAndSend(input: StartAndSendInput): Promise<FirstMessageAnswer>
  cancelLaunch(input: LaunchInput): Promise<boolean>
  attachOpen(): Promise<ResumedSession[]>
  claim(input: SessionInput): Promise<ResumedSession>
  release(input: SessionInput): Promise<ReleasedSession>
  questionsForAPerson(): Promise<LedgerWalk<PersonsQuestion>>
  decisionsForAPerson(): Promise<LedgerWalk<PersonsDecision>>
  limitsForAPerson(): Promise<LedgerWalk<ProviderLimitSeen>>
  readLimitsDisplay(): Promise<LimitsDisplayAnswer>
  onLimitsDisplayChanged(listener: (message: LimitsDisplayChanged) => void): () => void
  instructionAsksForAPerson(): Promise<readonly InstructionAskWaiting[]>
  mcpServerRequestsForAPerson(): Promise<readonly McpServerRequestForAPerson[]>
  stalledWorkForAPerson(): Promise<LedgerWalk<StalledWork>>
  currentEpoch(): Promise<PublicationEpoch>
  personsQueue(): Promise<PersonsQueueAnswer>
  listConversations(): Promise<ListingAnswer>
  stoppedWorkForAPerson(): Promise<LedgerWalk<StoppedWorkForAPerson>>
  workIncidentsForAPerson(): Promise<LedgerWalk<WorkIncident>>
  waitingOnWhoWroteForAPerson(): Promise<LedgerWalk<WaitingOnWhoWrote>>
  digest(from: number, to: number): Promise<DigestReading>
  recentActivity(input: { from: number; to: number }): Promise<RecentActivityReading>
  workGivenBy(input: { sessionId: string }): Promise<LedgerWalk<WorkGivenOut>>
  whoCalledWhom(input: { sessionId: string }): Promise<WhoCalledWhom>
  readWorkspace(): Promise<WorkspaceReading>
  whatIsBeingDone(): Promise<WhatIsBeingDone>
  whatEachConversationIsWaitingOn(): Promise<WhatEachConversationIsWaitingOn>
  theWholeForest(): Promise<TheWholeForest>
  processMemory(): Promise<ProcessMemory>
  listLibrary(input: LibraryQuery): Promise<LibraryPage>
  importRecordedSession(input: { sessionId: string }): Promise<ImportedRecording>
  importUserHomeSession(input: {
    provider: Provider
    providerSessionId: string
  }): Promise<ImportedFromHome>
  rebuildLedger(input: { sessionId: string }): Promise<RebuiltLedger>
  readWorkflowOutput(input: SessionInput & { taskId: string }): Promise<WorkflowOutputResult>
  readInstructionSource(input: SessionInput & { index: number }): Promise<InstructionSourceResult>
  readResource(input: { resourceId: string }): Promise<ResourceReading>
  drawResource(input: { resourceId: string }): Promise<ResourceDrawing>
  revealResource(input: { resourceId: string }): Promise<ResourceReveal>
  resolveMessagePaths(input: MessagePathAsk): Promise<MessagePath[]>
  openMessagePath(input: MessagePathTarget): Promise<OpenMessagePathResult>
  revealMessagePath(input: MessagePathTarget): Promise<RevealResult>
  filesKept(input: FilesKeptScope): Promise<FilesKept>
  filesLibrary(
    request: import('./files-library').FilesLibraryRequest,
  ): Promise<import('./files-library').FilesLibraryResult>
  teamProfileGraph(
    request: import('./team-profile-graph').TeamProfileGraphRequest,
  ): Promise<import('./team-profile-graph').TeamProfileGraphResult>
  searchWork(input: {
    conversation: string
    query: import('./work-search').WorkSearchQuery
  }): Promise<import('./work-search').WorkSearchResult>
  revealPath(input: SessionInput & { target: SessionPathTarget }): Promise<RevealResult>
  readConfigFile(input: SessionInput & { name: string }): Promise<ConfigFileResult>
  readCommandOutput(input: SessionInput & { toolCallId: string }): Promise<CommandTail | null>
  readToolAnswer(input: SessionInput & { toolCallId: string }): Promise<ToolAnswer | null>
  readChildWork(input: SessionInput & ChildWorkInput): Promise<ChildWorkResult>
  readChildState(input: SessionInput & { agentId: string }): Promise<ChildStateResult>
  sendToChild(input: SessionInput & { agentId: string; text: string }): Promise<ChildSendResult>
  earlierHistory(input: EarlierHistoryInput): Promise<HistoryWindow>
  latestHistory(input: SessionInput): Promise<HistoryWindow>
  capabilities(): Promise<ProviderCapabilityMap>
  providerConnections(): Promise<readonly ProviderConnection[]>
  modelList(input: { provider: Provider; profileId?: string }): Promise<ModelList>
  addHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  deleteHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  apiKeyStatus(input: { provider: Provider }): Promise<ApiKeyStatus>
  setApiKey(input: { provider: Provider; key: string }): Promise<ApiKeyChanged>
  removeApiKey(input: { provider: Provider }): Promise<ApiKeyChanged>
  checkApiKey(input: { provider: Provider }): Promise<ApiKeyCheck>
  providerVersions(): Promise<Readonly<Record<Provider, ProviderVersion>>>
  keptRules(): Promise<KeptRules>
  removeKeptRule(input: {
    provider: Provider
    file: string
    kept: string
  }): Promise<KeptRuleRemoved>
  providerSetup(): Promise<Readonly<Record<Provider, ProviderSetup | null>>>
  providerUsage(): Promise<Readonly<Record<Provider, readonly ProviderUsageReading[]>>>
  providerResources(): Promise<Readonly<Record<Provider, ProviderResources>>>
  onProvidersChanged(listener: (message: ProvidersChangedMessage) => void): () => void
  profiles(): Promise<string[]>
  checkCwd(path: string): Promise<CwdVerdict>
  createAgent(input: NewAgent): Promise<AgentIdentity>
  agentIdentities(): Promise<AgentIdentities>
  setCapabilities(input: {
    profileId: string
    grant: CapabilityGrant
    externalMcpServerIds: readonly string[]
  }): Promise<AgentIdentity | null>
  registerExternalMcpServer(input: {
    name: string
    url: string
    reach: ExternalMcpServerReach
  }): Promise<ExternalMcpServerRow>
  removeExternalMcpServer(input: { serverId: string }): Promise<boolean>
  setAgentProvider(input: {
    profileId: string
    provider: Provider | null
  }): Promise<AgentProviderSet | null>
  setAgentDisplayName(input: {
    profileId: string
    displayName: string | null
  }): Promise<AgentIdentity | null>
  retitleWork(input: { piece: string; title: string }): Promise<WorkRetitled>
  takeBackWork(input: { piece: string }): Promise<WorkTakenBackByAPerson>
  closeWork(input: { piece: string }): Promise<WorkClosedByAPerson>
  setAgentModelAndEffort(input: {
    profileId: string
    provider: Provider | null
    model: string | null
    effort: string | null
  }): Promise<ModelChoiceSaved>
  agentModelAndEffort(input: { profileId: string }): Promise<AgentModelChoice | null>
  instructAgent(input: {
    profileId: string
    baseline?: RulesBaseline
    text: string
    broughtBack?: number
  }): Promise<AgentInstructionsReading | null>
  agentInstructions(input: { profileId: string }): Promise<AgentInstructionsReading>
  agentMethods(input: {
    profileId: string
    offset?: number
    limit?: number
  }): Promise<MethodLibrary | null>
  agentMethodBody(input: { profileId: string; key: string }): Promise<MethodBody | null>
  agentMethodChanges(input: {
    profileId: string
    offset?: number
    limit?: number
  }): Promise<MethodHistoryResult>
  removeAgentMethod(input: {
    profileId: string
    selection: MethodDeleteSelection
  }): Promise<MethodChangeResult>
  undoAgentMethod(input: { profileId: string; changeId: string }): Promise<MethodChangeResult>
  checkInterruptedAgentMethods(input: {
    profileId: string
    confirmed: boolean
  }): Promise<MethodChangeResult>
  agentOwnNotes(input: { profileId: string }): Promise<OwnNotesReading | null>
  agentOwnNotesUnread(input: { profileId: string }): Promise<OwnNotesUnread>
  saveOwnNotes(input: { profileId: string } & OwnNotesWrite): Promise<OwnNotesReading | null>
  undoOwnNotes(input: {
    profileId: string
    expectedVersion: number
  }): Promise<OwnNotesReading | null>
  markOwnNotesSeen(input: { profileId: string; throughVersion: number }): Promise<boolean>
  agentRulesUnread(input: { profileId: string }): Promise<InstructionUnread>
  undoAgentRules(input: {
    profileId: string
    expectedVersion: number
  }): Promise<AgentInstructionsReading | null>
  markAgentRulesSeen(input: { profileId: string; throughVersion: number }): Promise<boolean>
  agentMemory(input: {
    profileId: string
    offset?: number
    limit?: number
  }): Promise<AgentMemoryReading>
  whatThisAgentWasGiven(sessionId: string): Promise<WhatThisAgentWasGiven>
  whatTheModelGot(sessionId: string, ordinal: number): Promise<WhatTheModelGot>
  amendAgentMemory(input: MemoryAmendmentAsked): Promise<AgentMemoryAmended | null>
  undoAgentMemory(input: MemoryUndoAsked): Promise<AgentMemoryAmended | null>
  checkInterruptedMemory(input: MemoryCheckAsked): Promise<MemoryChecked | null>
  decideInstruction(input: { askId: string; approve: boolean }): Promise<AnswerAck>
  decideMcpServerRequest(input: { requestId: string; approve: boolean }): Promise<AnswerAck>
  removeAgent(input: { profileId: string }): Promise<AgentRemoved>
  archiveConversation(input: { sessionId: string }): Promise<ArchiveOutcome>
  restoreConversation(input: { sessionId: string }): Promise<ArchiveOutcome>
  checkDeleteConversation(input: { sessionId: string }): Promise<DeleteVerdict>
  deleteConversation(input: { sessionId: string; parts: string[] }): Promise<DeleteOutcome>
  setSpawningEnabled(input: { enabled: boolean }): Promise<{ spawningEnabled: boolean }>
  setServicesOn(input: { on: boolean }): Promise<{ servicesOn: boolean }>
  setDefaultApprovalMode(input: {
    mode: 'ask' | 'auto'
  }): Promise<{ defaultApprovalMode: 'ask' | 'auto' }>
  checkProviderAuth(input: CheckProviderAuthInput): Promise<AuthState>
  reprovisionProviderAuth(input: ProviderProfileInput): Promise<ReprovisionOutcome>
  reprovisionProviderHomes(input: {
    provider: Provider
    statusOnly?: boolean
  }): Promise<ProviderHomesReprovision>
  signInProvider(input: ProviderProfileInput): Promise<ProviderSignInResult>
  cancelProviderSignIn(input: ProviderProfileInput): Promise<void>
  onEvent(listener: (message: RuntimeEventMessage) => void): () => void
  onLiveness(listener: (message: SessionLivenessMessage) => void): () => void
  onChanged(listener: (message: RuntimeChangeMessage) => void): () => void
  onStates(listener: (message: RuntimeStatesMessage) => void): () => void
}

export type {
  AuthState,
  BackgroundWork,
  BackgroundWorkEnding,
  CapabilityState,
  CapabilityStatus,
  ContextReading,
  ProviderCommand,
  ProviderCommandSet,
  DeclaredTool,
  DeclaredToolset,
  PublishedInventory,
  PublishedServer,
  ToolNaming,
  ToolParameter,
  ChildThreadState,
  CommandTail,
  ToolAnswer,
  ToolAnswerPart,
  EffortChoice,
  FileChange,
  MemoryRecallEntry,
  ModelChoice,
  PermissionDecision,
  ProviderCapabilities,
  ProviderSetup,
  ReprovisionOutcome,
  RuntimeEvent,
  ScheduledJob,
  SessionRef,
  SessionStatus,
  TurnEnding,
  UnknownCategory,
  UserInputQuestion,
  UserInputResponse,
  WorkflowAgent,
  WorkflowPhase,
}
export type { Provider }
