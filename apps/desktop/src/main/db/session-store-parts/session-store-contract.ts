import type { AppNotice } from '../../../shared/app-notice'
import { type LedgerWindowQuery, type LedgerWindow } from '../../database/sqlite/ledger/history'
import {
  type ResumableSession,
  type LiveSessionRow,
  type UnresumableSession,
  type RecordedSession,
  type RecordedPageInput,
} from '../session-catalogue-read'
import type { DigestRow, PersistedEvent } from '../ledger-row-types'
import type { WorkLedgerRead, WorkRow } from '../work-ledger-read'
import type { AncestryContext } from '../work-ancestry-reader'
import { type RowsUnread } from '../rows-unread'
import type {
  HolderReconciliationReceipt,
  ReconciliationReceipt,
  WorkRecoveryEvent,
} from '../../../shared/reconciliation-contracts'
import type {
  LedgerWalk,
  ProviderRequestEvent,
  RaisedQuestion,
  RequestOnlyAPersonCanSettle,
  RoutedRequest,
} from '../../../shared/question-contracts'
import type { TranscriptEvent } from '../../../shared/conversation-events'
import type { MoveReceipt } from '../../../shared/move-contracts'
import type { AgentModelChoice, ModelAndEffort } from '../../../shared/model-choice-contracts'
import type { OwnInstructionsCommit } from '../agent-knowledge-history'
import type { ThreadLeadRow } from '../thread-lead-reader'
import type {
  HumanAnswers,
  HumanFinalContext,
  UserTurnEvent,
} from '../../../shared/human-answer-contracts'
import type {
  PieceRow,
  PieceWaitingOnWhoWrote,
  StatusLine,
  WorkGivenEvent,
  WorkGivenOut,
} from '../../../shared/task-contracts'
import {
  type ConversationTitle,
  type ConversationTitleHistory,
  type ConversationTitleHistoryCursor,
  type ConversationTitledEvent,
} from '../../../shared/conversation-title'
import type { ScheduleLevel } from '../../../shared/agent-state-contracts'
import { type OwnNotesStore } from '../own-notes'
import {
  type MethodChangeIntent,
  type MethodChangeRecord,
  type MethodFileState,
} from '../method-changes'
import { type Committed } from '../committed-changes'
import type {
  PastWorkSearchResult,
  PastWorkAfter,
  PastWorkSource,
  PastWorkTranscriptScope,
} from '../../../shared/past-work-search'
import type { WorkerBorn } from '../../profile-execution-file'
import type { ServiceBorn } from '../../profile-execution-file'
import { type parseSessionRef, type NotStartedBecause } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import {
  type ExternalMcpServerReach,
  type ExternalMcpServerRow,
} from '../../../shared/external-mcp'
import { type WorkEdge } from '../../../shared/who-called-whom'
import type { ProviderLimitAccountLife, ProviderLimitSeen } from '../../../shared/provider-limit'
import type { IdentityHistory, StartedOn } from '../../../shared/agent-roster'
import type { ChildDescent } from '../../adopt/discover-sessions'
import type {
  AgentIdentity,
  AgentIdentityName,
  IdentityCreator,
  NewAgent,
  LedgerStatus,
} from '../../../shared/runtime-ipc'
import { type ProviderSessionOf, type TiedOutside, type TreeDeleted } from '../conversation-tree'
import { type ForestStore } from '../forest-store'
import { type QuestionCopySlice } from '../question-copies'
import { type LedgerWriteStamp } from '../ledger-write-stamp'
import { type OpenTurn, type LeftRunning, type TurnAsItEnded } from '../turn-evidence-read'
import { type WorkThatNamesIt } from '../../../shared/piece-called'
import { type AskToStop, type LastEndedTurn } from '../../../shared/how-work-stopped'
import {
  type Exchange,
  type ReceivedInATurn,
  type TaskRecordExchange,
  type TranscriptRead,
  type TranscriptTurn,
} from '../../../shared/last-exchange'
import { type ActedBy } from '../../../shared/who-did-it'
import {
  type MemoryAmendment,
  type MemoryAmendmentWrite,
  type MemoryObservation,
} from '../../../shared/agent-memory'
import {
  type InstructionAskWaiting,
  type InstructionEnding,
  type InstructionUnread,
  type OwnInstructions,
  type OwnInstructionsVersion,
  type OwnInstructionsWrite,
} from '../../../shared/own-instructions'
import { type McpServerRequestWaiting } from '../../../shared/mcp-server-requests'
import type {
  SpawnedConversation,
  ConversationBinding,
  ResourceRow,
  ResourcePosition,
  KeptFileRow,
  KeptFilesAsked,
  KeptFilesPaged,
  KeptFilesFrom,
  GivenPiece,
  NewSessionRecord,
  WaitingMessage,
  AdoptedSessionRecord,
  SessionSnapshot,
  PieceHeld,
  WindowOpenWork,
  ScheduleEvidenceRead,
  QueuedPromptProgress,
  ProviderFailureNoticeProgress,
  ProviderFailureEpisode,
  ProviderFailureEvidence,
  RecordedTurn,
  TurnEndReason,
} from './session-store-rows'

export interface SessionStore extends OwnNotesStore, WorkLedgerRead, ForestStore {
  /**
   * Indexed candidate pages; the caller folds owners within its turn-block budget. `ended` is true
   * when the owner's active ledger already holds the piece's reply, close or withdrawal, so the
   * caller need not fold that owner to learn it ended.
   */
  turnBlockCandidates(
    giver: string,
    limit: number,
    after?: string | null,
  ): readonly { readonly piece: string; readonly owner: string; readonly ended?: boolean }[] | null
  instructionAsksWaitingIn(
    conversation: string,
    unread: RowsUnread,
  ): readonly InstructionAskWaiting[] | null
  /** The last completed person reply ended in '?' and opened no person request. */
  replyQuestionWithoutARequest(conversation: string): string | null
  /** Whether the writer has no retained native cursor from one of this store's iterator reads. */
  canReadFreshSnapshot?(): boolean
  create(record: NewSessionRecord): void
  /** A recorded binding only; reading an older row never chooses or writes a default. */
  connectionOf(sessionId: string): string | null
  firstLaunchOf(
    record: Pick<
      NewSessionRecord,
      'id' | 'model' | 'reasoningEffort' | 'planMode' | 'launchedAs' | 'connectionId'
    >,
  ): boolean
  aLaunchWentUnnamed(sessionId: string): boolean
  adopt(record: AdoptedSessionRecord): void
  identityOf(sessionId: string): {
    profileSlug: string
  } | null
  /** One identity, or null when no agent has that name. */
  agentIdentityOf(profileSlug: string): AgentIdentity | null
  agentIdentities(): readonly AgentIdentity[]
  agentIdentityPage(
    after: string,
    limit: number,
  ): {
    readonly identities: readonly Pick<AgentIdentity, 'id' | 'slug' | 'displayName' | 'createdAt'>[]
    readonly count: number
  }
  /** The naming columns of one identity. */
  agentIdentityNameById(id: string): AgentIdentityName | null
  reconciliationNames(
    conversations: readonly string[],
  ): readonly (AgentIdentityName & { conversation: string })[]
  createAgentIdentity(
    said: NewAgent,
    broughtIntoBeingBy: IdentityCreator | null,
  ): AgentIdentity | null
  providerOf(profileSlug: string): Provider | null
  startedOnOf(profileSlug: string): StartedOn
  saveProviderIfNoneIsSaved(profileSlug: string, provider: Provider): boolean
  /** Replace the external MCP servers one identity is associated with; false: no such identity. */
  setExternalMcpServers(profileSlug: string, externalMcpServerIds: readonly string[]): boolean
  ownInstructionsOf(profileSlug: string): OwnInstructions
  currentOwnInstructionsOf?(profileSlug: string): OwnInstructionsVersion | null
  readCurrentAgentRules(
    profileSlug: string,
  ): Promise<{ current: OwnInstructionsVersion | null } | null>
  configuredLayerFor(profileSlug: string): string | null
  writeOwnInstructions(said: OwnInstructionsWrite, at: number): OwnInstructionsVersion | null
  writeDirectAgentRules(
    said: OwnInstructionsWrite,
    at: number,
    afterCommit: (commit: OwnInstructionsCommit) => void,
  ): Promise<OwnInstructionsCommit | null>
  undoOwnInstructions(
    profileSlug: string,
    expectedVersion: number,
    by: ActedBy,
    at: number,
  ): OwnInstructionsVersion | null
  instructionUnread(profileSlug: string): InstructionUnread
  beginMethodChange(
    profileSlug: string,
    said: MethodChangeIntent,
    by: ActedBy,
    at: number,
  ): MethodChangeRecord | null
  settleMethodChange(
    profileSlug: string,
    id: string,
    outcome: 'done' | 'partial',
    actual: readonly MethodFileState[],
    by: ActedBy,
  ): boolean
  hasPendingMethodChange(profileSlug: string): boolean
  methodChange(profileSlug: string, id: string): MethodChangeRecord | null
  methodChanges(profileSlug: string, offset?: number, limit?: number): readonly MethodChangeRecord[]
  markInstructionsSeen(profileSlug: string, version: number, by: ActedBy): boolean
  memoryAmendmentsOf(profileSlug: string): readonly MemoryAmendment[]
  writeMemoryAmendment(said: MemoryAmendmentWrite, at: number): MemoryAmendment | null
  beginMemoryAmendment(said: MemoryAmendmentWrite, at: number): MemoryAmendment | null
  settleMemoryAmendment(
    profileSlug: string,
    id: string,
    actual: MemoryObservation,
    by: ActedBy,
  ): boolean
  hasPendingMemoryAmendment(profileSlug: string): boolean
  memoryAmendment(profileSlug: string, id: string): MemoryAmendment | null
  instructionAsksWaiting(unread?: RowsUnread): readonly InstructionAskWaiting[]
  instructionAskersAmong(owners: readonly string[], unread: RowsUnread): readonly string[]
  settleInstructionAsk(askId: string, ending: InstructionEnding, by: ActedBy, at: number): boolean
  /** Every MCP server request no ending names yet, oldest first, across every conversation. */
  mcpServerRequestsWaiting(unread?: RowsUnread): readonly McpServerRequestWaiting[]
  /** Whether a request by this id was ever made, waiting or settled. */
  mcpServerRequestWasMade(requestId: string): boolean
  grantExternalMcpServer(
    serverName: string,
    profileSlugs: readonly string[],
  ): { readonly granted: readonly string[]; readonly missing: readonly string[] } | null
  externalMcpServers(): readonly ExternalMcpServerRow[]
  registerExternalMcpServer(said: {
    name: string
    url: string
    reach: ExternalMcpServerReach
  }): ExternalMcpServerRow | null
  removeExternalMcpServer(serverId: string): boolean
  externalMcpServersFor(profileSlug: string): readonly ExternalMcpServerRow[]
  setAgentProvider(profileSlug: string, provider: Provider | null): boolean
  setAgentDisplayName(profileSlug: string, displayName: string | null): boolean
  renameAgentDisplayName(
    profileSlug: string,
    displayName: string | null,
  ): Promise<AgentIdentity | null>
  modelChoiceOf(profileSlug: string): AgentModelChoice | null
  setModelChoice(profileSlug: string, choice: AgentModelChoice | null): boolean
  handAddedModels(provider: Provider): readonly string[]
  addHandAddedModel(provider: Provider, model: string, at: number): readonly string[]
  deleteHandAddedModel(provider: Provider, model: string, at: number): readonly string[]
  lastPicked(provider: Provider): ModelAndEffort | null
  hasSealedApiKey(provider: Provider): boolean
  forgetSealedApiKey(provider: Provider): void
  aPersonPicked(provider: Provider, pair: ModelAndEffort, at: number): void
  conversationsPerIdentity(): readonly IdentityHistory[]
  removeAgentIdentity(profileSlug: string): boolean
  defaultApprovalModeChosen(): boolean
  defaultApprovalMode(): 'ask' | 'auto'
  setDefaultApprovalMode(mode: 'ask' | 'auto'): void
  parentOf(sessionId: string): string | null
  refreshAdopted(sessionId: string, updatedAt: number, child?: ChildDescent): boolean
  learnDescent(sessionId: string, child?: ChildDescent): boolean
  setApprovalMode(sessionId: string, mode: 'ask' | 'auto'): void
  setModel(sessionId: string, model: string | null): void
  setReasoningEffort(sessionId: string, effort: string | null): void
  aPersonSetItsModelOrEffort(sessionId: string, at: number): void
  setReportedModel(sessionId: string, model: string | null, effort: string | null): void
  whatItRunsOn(sessionId: string): {
    readonly model: string | null
    readonly reasoningEffort: string | null
    /** When a person last changed its model or effort, or null — `R31c`'s stamp. */
    readonly aPersonChoseItAt: number | null
    readonly reportedModel: string | null
    readonly reportedEffort: string | null
  } | null
  endPlanMode(sessionId: string, at: number): void
  startPlanMode(sessionId: string, at: number): void
  findByProviderRef(provider: Provider, sessionId: string): string | null
  nameItsLaunch(sessionId: string, ref: ReturnType<typeof parseSessionRef>): boolean
  append(sessionId: string, ordinal: number, event: TranscriptEvent, at: number): void
  /**
   * Sets a conversation's title: one `titled` entry in its own ledger, at `ordinal`. Throws, writing
   * nothing, unless the title is one line of 1 to 200 characters. Inside `atomically`, it commits or
   * rolls back with the rest of that write.
   */
  titleConversation(
    conversation: string,
    ordinal: number,
    titled: ConversationTitledEvent,
    at: number,
  ): void
  /** The newest title set on a conversation in its current history, or `null` when none was. */
  conversationTitle(conversation: string, unread?: RowsUnread): ConversationTitle | null
  conversationTitleHistory(
    conversation: string,
    before?: ConversationTitleHistoryCursor,
  ): ConversationTitleHistory
  appendMany(
    sessionId: string,
    entries: { ordinal: number; event: TranscriptEvent; at: number }[],
  ): void
  atomically<T>(work: () => T): T
  onCommitted(listener: (change: Committed) => void): () => void
  /** Asks whether another connection has committed since the last look; one resync if so. */
  checkCommitted(): void
  /** Sessions with a ref to resume from, most recently touched first. */
  resumable(): ResumableSession[]
  /** The recorded sessions that cannot be reopened, each with the reason it cannot. */
  unresumable(): UnresumableSession[]
  recorded(): RecordedSession[]
  recordedPage(input: RecordedPageInput): RecordedSession[]
  recordedOne(sessionId: string): RecordedSession | null
  searchPastWork(
    caller: string,
    words: string,
    profile?: string,
    cursor?: string,
    transcript?: PastWorkTranscriptScope,
  ): PastWorkSearchResult
  closePastWorkSearch(): void
  pastWorkSearchSource(
    caller: string,
    profile?: string,
    after?: PastWorkAfter,
    recent?: PastWorkSource['recent'],
  ): PastWorkSource | null
  replacements(): readonly { readonly replaced: string; readonly by: string }[]
  newestScheduleLevels(owners?: ReadonlySet<string>): readonly {
    readonly conversation: string
    readonly level: ScheduleLevel
    readonly compactedAt: number | null
    readonly notStartedSaid?: Readonly<Record<string, NotStartedBecause>>
  }[]
  newestScheduleLevel(
    sessionId: string,
  ): ReturnType<SessionStore['newestScheduleLevels']>[number] | null
  scheduleEvidenceRows(sessionId: string): ScheduleEvidenceRead
  lastStatusAt(sessionId: string): number | null
  find(sessionId: string): ResumableSession | null
  findLive(sessionId: string): LiveSessionRow | null
  /** One session's ledger in order: the transcript a reopened chat is rebuilt from. */
  workflowOutputPath(sessionId: string, taskId: string, unread?: RowsUnread): string | null
  workflowAgentTask(sessionId: string, agentId: string, unread?: RowsUnread): string | null
  workflowAgentIds(sessionId: string, taskId: string, unread?: RowsUnread): string[]
  reportedSubAgent(sessionId: string, agentId: string, unread?: RowsUnread): boolean
  events(sessionId: string): PersistedEvent[]
  eventsFrom(sessionId: string, fromOrdinal: number, limit: number): PersistedEvent[]
  newestOfType?(
    sessionId: string,
    type: TranscriptEvent['type'],
    before?: number,
    from?: number,
  ): PersistedEvent | null
  threadLeadRows?(
    sessionId: string,
    leadsOpenWith: string,
    before?: number,
    historicalLeadsOpenWith?: string,
    /** Inclusive ordinal floor for pages; omitted: the whole history before the upper bound. */
    fromOrdinal?: number,
  ): readonly ThreadLeadRow[]
  ancestryContext(
    sessionId: string,
    page: readonly PersistedEvent[],
    through: number,
    budget: number,
  ): AncestryContext
  turnWindow(sessionId: string, options: LedgerWindowQuery): LedgerWindow
  /** Bounded indexed context, independent of how many app turns follow the human turn. */
  latestHumanAnswers(sessionId: string): HumanAnswers
  humanFinalsInWindow(
    sessionId: string,
    from: number,
    through: number,
  ): ReadonlyMap<number, HumanFinalContext>
  ledgerStatus(sessionId: string): LedgerStatus
  beginGeneration(sessionId: string): number
  clearOrphanBuilds(running: ReadonlySet<string>, owners?: ReadonlySet<string>): number
  settleOrphanRuns(at: number, running: ReadonlySet<string>, owners?: ReadonlySet<string>): number
  whatACrashLeftRunning(running: ReadonlySet<string>): readonly LeftRunning[]
  recordedTurnOpening(sessionId: string, turnId: string): UserTurnEvent | null
  recordedTurnMessage(
    sessionId: string,
    turnId: string,
  ): (PersistedEvent & { event: UserTurnEvent }) | null
  ensurePersonalRoot(sessionId: string, at: number): WorkRow
  theOpenTurn(sessionId: string): OpenTurn | null
  theNewestTurn(sessionId: string): string | null
  aLifeOpenedTheTurn(
    sessionId: string,
    turnId: string,
    life: { readonly generation: number; readonly launched: number },
  ): boolean
  howATurnEnded(sessionId: string, turnId: string): TurnAsItEnded | null
  piecesOwnedBefore(owner: string, ordinal: number, unread?: RowsUnread): readonly PieceRow[]
  whatBecameOfAMessage(
    sessionId: string,
    messageId: string,
    keepRestartedBrief?: boolean,
  ): 'sent' | 'ended' | 'waiting' | 'absent'
  startupRepairOwners(phase?: 'builds' | 'runs' | 'requests' | 'work'): readonly string[]
  settleStrandedMessagesInSteps(
    at: number,
    running: ReadonlySet<string>,
    unread?: RowsUnread,
    owners?: ReadonlySet<string>,
  ): Generator<() => void, number>
  settleStrandedMessages(
    at: number,
    running: ReadonlySet<string>,
    unread?: RowsUnread,
    owners?: ReadonlySet<string>,
  ): number
  messagesWaitingIn(
    sessionId: string,
    unread?: RowsUnread,
    maximumRows?: number,
  ): readonly WaitingMessage[]
  settleStrandedRequests(
    at: number,
    running: ReadonlySet<string>,
    unread?: RowsUnread,
    owners?: ReadonlySet<string>,
  ): number
  stalledWorkNobodyWasToldAbout(
    unread?: RowsUnread,
    noOpenPieces?: (owner: string) => boolean,
    work?: WindowOpenWork,
  ): LedgerWalk<PieceRow>
  stalledWorkItsGiverWasToldAbout(
    unread?: RowsUnread,
    noOpenPieces?: (owner: string) => boolean,
    work?: WindowOpenWork,
  ): LedgerWalk<PieceRow>
  stalledWorkAPersonGave(unread?: RowsUnread): LedgerWalk<PieceRow>
  piecesWaitingOnWhoWrote(
    unread?: RowsUnread,
    work?: WindowOpenWork,
  ): LedgerWalk<PieceWaitingOnWhoWrote>
  piecesWaitingOnWhoWroteIn(owner: string, unread?: RowsUnread): readonly PieceWaitingOnWhoWrote[]
  providerLimitsSeen(
    now: number,
    signInChangedAt?: ReadonlyMap<Provider, number>,
    accountLives?: readonly ProviderLimitAccountLife[],
  ): LedgerWalk<ProviderLimitSeen>
  readAheadProviderWalls(now: number, budgetMs: number): boolean
  settleRestartedWork(
    at: number,
    running: ReadonlySet<string>,
    unread?: RowsUnread,
    wokenForAJob?: ReadonlySet<string>,
    diedInTheBackground?: Set<string>,
    continuing?: ReadonlySet<string>,
    owners?: ReadonlySet<string>,
  ): number
  questionsAPersonMustAnswer(unread?: RowsUnread): LedgerWalk<RoutedRequest>
  decisionsAwaitingAPerson(unread?: RowsUnread): LedgerWalk<RequestOnlyAPersonCanSettle>

  numberUnder(parent: string): number
  recordGive(given: GivenPiece, ordinal: number, event: WorkGivenEvent, at: number): void
  /** Every saved work row, including roots, for incident reconciliation. */
  reconciliationOwners(includeProviderFailureNotices?: boolean): readonly string[]
  reconciliationWork(holders?: ReadonlySet<string>, unread?: RowsUnread): readonly WorkRow[]
  reconciliationReceiptsForOwner(owner: string): readonly HolderReconciliationReceipt[]
  reconciliationRecovery(owner: string): WorkRecoveryEvent | null
  reconciliationDrivenByTurn(owner: string, turn: string): readonly string[]
  reconciliationPieces(
    owner: string,
    unread?: RowsUnread,
  ): {
    readonly pieces: readonly PieceRow[]
    readonly newestTurn: string | null
    readonly driven: readonly string[] | null
  }
  reconciliationReceipts(owner: string, piece: string): readonly ReconciliationReceipt[]
  queuedPromptProgress(
    target: string,
    messageId: string,
    appNotice: AppNotice,
  ): QueuedPromptProgress
  providerFailureNoticeProgress(target: string, messageId: string): ProviderFailureNoticeProgress
  reconciliationDelivery(
    target: string,
    messageId: string,
  ): 'pending' | 'running' | 'turn-ended' | 'not-delivered'
  /** Canonical labels and current titles, with one retitle walk per owner. */
  activityWorkNames(
    pieces: readonly string[],
  ): ReadonlyMap<string, { readonly label: string; readonly title: string | null } | null>
  workByLabel(label: string): WorkRow | null
  /**
   * The first task recorded in this conversation, in the order tasks were stored (never by clock
   * time), root or not, ended or open; `null` while it has none. Its label is the conversation's
   * address, and it never changes.
   */
  firstTaskOf(conversation: string): { readonly piece: string; readonly label: string } | null
  defaultConversationTitle(conversation: string, includeOpening?: boolean): string | null
  /** The root this conversation owns, or `null`: a conversation another one started owns none. */
  rootOf(conversation: string): WorkRow | null
  /**
   * The conversations a person started, whichever agent runs them: each owns a root, no other
   * conversation started it, and it is no service.
   */
  startedByAPerson(): ReadonlySet<string>
  serviceBorn(conversation: string): boolean
  servicesBorn(): readonly ServiceBorn[]
  /** Bounded indexed birth evidence; malformed or oversized evidence throws. */
  workersBorn(): readonly WorkerBorn[]
  /** Complete, bounded replacement evidence for the giver of a worker binding. */
  workerGiverContains(giver: string, conversation: string): boolean
  /** The current worker, from a complete bounded replacement chain. */
  workerInItsPlace(conversation: string): string
  workerLineage(conversation: string): readonly string[]
  rootLines(root: string): { readonly title: string | null; readonly statusLine: StatusLine | null }
  workThatNames(conversation: string, unread?: RowsUnread): WorkThatNamesIt | null
  workThatNamesAndItsWait(
    conversation: string,
    unread?: RowsUnread,
    folded?: readonly PieceRow[],
  ): {
    readonly named: WorkThatNamesIt | null
    readonly waitingOnPurpose: PieceRow | null
  }
  workThatNamesUnder(
    conversation: string,
    /** The piece the sentence is about, by id. */
    piece: string,
    unread?: RowsUnread,
  ): WorkThatNamesIt | null
  workOnItsChainThatNames(conversation: string, piece: string): WorkThatNamesIt | null
  /** The rows given under one piece, by number — rows, not folded. */
  childrenOf(piece: string, after?: number, limit?: number): readonly WorkRow[]
  countChildrenAfter(piece: string, after: number): number
  pieceOfItsChainHeldBy(piece: string, owner: string): string | null
  turnBlockPiecesOwnedBy(owner: string, unread?: RowsUnread): readonly PieceRow[]
  openPiecesOf(owner: string, unread?: RowsUnread): readonly PieceRow[]
  conversationsOf(profileSlug: string): readonly {
    readonly conversation: string
    readonly parent: string | null
    readonly startedAt: number
    readonly lastActiveAt: number
  }[]
  /**
   * The most recently active conversations of `recipientProfile` that hold work given from the
   * giver's profile (or, for a giver with no profile, from the giver itself), newest first: at most
   * `limit`, and whether there are more. Each carries the title of its latest task.
   */
  recentConversationsGivenFrom(
    giver: string,
    recipientProfile: string,
    limit: number,
  ): {
    readonly rows: readonly { readonly conversation: string; readonly title: string | null }[]
    readonly more: boolean
  }
  newestPiecesHeldIn(
    conversations: readonly string[],
    limit: number,
    unread?: RowsUnread,
  ): {
    /** The newest it could read, newest given first. */
    readonly rows: readonly PieceHeld[]
    /** How many of the newest `work` named — `rows`, and those it could not read. */
    readonly newest: number
    /** How many those conversations hold in all. */
    readonly total: number
  }
  pieceItWasStartedWith(conversation: string, unread?: RowsUnread): string | null
  addResource(
    input: Omit<ResourceRow, 'resource' | 'createdAt' | 'title'> & { readonly title: string },
    at: number,
  ): ResourceRow
  /** The resources kept for one piece, oldest first. */
  resourcesOf(
    piece: string,
    after?: ResourcePosition | null,
    limit?: number,
  ): readonly ResourceRow[]
  countResourcesAfter(piece: string, after: ResourcePosition | null): number
  filesKept(asked: KeptFilesAsked): readonly KeptFileRow[]
  /** Both opening lists, named in one pass over their union. */
  filesKeptTogether(asked: Extract<KeptFilesAsked, { scope: 'tree' }>): {
    readonly tree: readonly KeptFileRow[]
    readonly added: readonly KeptFileRow[]
  }
  madeBy(
    profileSlug: string,
    limit: number,
  ): { readonly rows: readonly KeptFileRow[]; readonly total: number }
  keptFilesNewestFirst(
    asked: KeptFilesPaged,
    page: KeptFilesFrom,
  ): {
    readonly rows: readonly KeptFileRow[]
    readonly through: string | null
  }
  keptFilesBefore(asked: KeptFilesPaged, olderThan: string, cap: number): number
  /** One resource by its id, or `null`. */
  resource(id: string): ResourceRow | null
  untitledResources(limit: number): readonly ResourceRow[]
  titleResource(id: string, title: string): boolean
  titledResources(
    after: number,
    limit: number,
    keptBefore: number,
  ): readonly { readonly at: number; readonly row: ResourceRow }[]
  retitleResource(id: string, was: string, title: string): boolean
  digestWindow(from: number, to: number): LedgerWalk<DigestRow>
  /** The same vocabulary, materialized only inside this exact window and never cached. */
  activityWindow(from: number, to: number): LedgerWalk<DigestRow>
  conversationsHeldByNoAgent(): number
  piecesGivenBy(sessionId: string, unread?: RowsUnread): readonly PieceRow[]
  workGivenOutBy(sessionId: string): LedgerWalk<WorkGivenOut>
  spawnedBy(sessionId: string): LedgerWalk<SpawnedConversation>
  /** A conversation and every conversation below it (`conversation-tree.ts`): itself first. */
  conversationTree(root: string): string[]
  /** What ties a tree's conversations to conversations outside it (`conversation-tree.ts`). */
  whatTiesTheTreeOutside(tree: readonly string[]): TiedOutside[]
  /** Every provider session a conversation had, by the ids its provider's files are named by. */
  providerSessionsOf(conversation: string): ProviderSessionOf[]
  /** Deletes every row of a tree's conversations, in one transaction (`conversation-tree.ts`). */
  deleteTheTree(tree: readonly string[]): TreeDeleted
  conversationBinding(sessionId: string): ConversationBinding | null
  workThisOneGaveOut(sessionId: string): LedgerWalk<WorkEdge>
  workThisOneWasGiven(sessionId: string): LedgerWalk<WorkEdge>
  workReportedTo(sessionId: string): ReadonlySet<string>
  /** A pre-upgrade ordinary stall covered by a standing notice in its giver lineage. */
  legacyOrdinaryStallWasReported(owner: string, piece: string, giver: string): boolean
  routedRequestsOf(sessionId: string, unread?: RowsUnread): readonly RoutedRequest[]
  questionsRoutedTo(parentSessionId: string, unread?: RowsUnread): readonly RoutedRequest[]
  whoRoutedToWhom(): readonly { readonly asker: string; readonly parent: string }[]
  conversationsHoldingACopyOf(requestId: string): readonly string[]
  fillQuestionCopies(rows: number, bytes: number): QuestionCopySlice
  generationOf?(sessionId: string): number
  latestMoveOffer?(
    sessionId: string,
  ): import('../../../shared/question-contracts').QuestionAskedEvent | null
  theDecisionOn(
    sessionId: string,
    requestId: string,
  ): {
    readonly outcome: string
    readonly by: ActedBy | null
    readonly movedTo?: MoveReceipt
  } | null
  theRequestRouted(sessionId: string, requestId: string): ProviderRequestEvent | null
  questionsRaisedIn(sessionId: string, unread?: RowsUnread): ReadonlyMap<string, RaisedQuestion>
  questionStatesIn(
    sessionId: string,
    unread?: RowsUnread,
  ): ReadonlyMap<string, Pick<RaisedQuestion, 'piece' | 'raisedBy'>>
  routedRequestsAtHand(sessionId: string): readonly RoutedRequest[] | null
  questionsRaisedAtHand(sessionId: string): ReadonlyMap<string, RaisedQuestion> | null
  piecesAtHand(owner: string): readonly PieceRow[] | null
  questionsRoutedToAtHand(parentSessionId: string): readonly RoutedRequest[] | null
  whenAPersonLastWrote(sessionId: string): number | null
  requestsItsLastEndedTurnInterrupted(sessionId: string): readonly string[]
  lastEndedTurn(sessionId: string, unread?: RowsUnread): LastEndedTurn | null
  providerFailureEpisode(
    sessionId: string,
    unread?: RowsUnread,
    evidence?: ProviderFailureEvidence,
  ): ProviderFailureEpisode
  lastExchange(sessionId: string): Exchange
  lastExchangeForTaskRecord(sessionId: string): TaskRecordExchange
  whatOpenedTheLastEndedTurn(sessionId: string): ReceivedInATurn | null
  transcript(
    sessionId: string,
    read: TranscriptRead,
  ): {
    readonly turns: readonly TranscriptTurn[]
    readonly older: boolean
    readonly matched: number
  }
  lastAskToStop(
    sessionId: string,
    unread?: RowsUnread,
    source?: 'work_interrupted',
  ): AskToStop | null
  lastExplicitStopRequest(
    sessionId: string,
  ): { readonly asker: string; readonly reason: string } | null
  appendGeneration(
    sessionId: string,
    generation: number,
    entries: { ordinal: number; event: TranscriptEvent; at: number }[],
  ): void
  promoteGeneration(
    sessionId: string,
    generation: number,
    through: { normalizerVersion: number; derivedThrough: number },
  ): boolean
  abandonGeneration(sessionId: string, generation: number, failure: string | null): void
  discardGeneration(sessionId: string, generation: number, limit: number): number
  deadGenerations(sessionId: string): number[]
  turns(sessionId: string): RecordedTurn[]
  closeOpenTurn(sessionId: string, reason: TurnEndReason, at: number): boolean
  reopened(sessionId: string, at: number): boolean
  closedByTheQuit(sessionIds: readonly string[], at: number): void
  whatTheQuitClosed(): readonly string[]
  whatTheNewestQuitClosed(notBefore: number): readonly string[]
  restartedWorkLate(conversation: string, pieces: readonly string[], at: number): void
  backgroundTheRestartStopped(
    alsoTheseDied: readonly string[],
    before: number,
    notBefore: number,
    owners?: ReadonlySet<string>,
    quitClosed?: readonly string[],
  ): readonly { conversation: string; stopped: readonly string[]; endedAt: number }[]
  terminate(
    sessionId: string,
    status: 'ended' | 'errored',
    reason: TurnEndReason,
    at: number,
  ): boolean
  importSnapshot(snapshot: SessionSnapshot): void
  sourceSessionIds(sessionId: string): readonly string[]
  sessionForSourceId(sourceId: string): string | null
  acceptedAskHandoff(
    sessionId: string,
    generation: number,
    afterOrdinal: number,
    attempt: string,
  ): PersistedEvent | null
  associateBundleSource(
    sessionId: string,
    sourceIds: readonly string[],
    ledger: SessionSnapshot['ledger'],
  ): void
  nextOrdinal(sessionId: string): number
  lastOrdinalWrite(sessionId: string): LedgerWriteStamp | undefined
}
