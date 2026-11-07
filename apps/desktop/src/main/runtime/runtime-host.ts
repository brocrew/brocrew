import type { RuntimeHostDeps } from './host-dependencies'
export type { RuntimeHostDeps } from './host-dependencies'
import { ConversationIdle } from './conversation-idle'
import { ModelCatalogues } from './model-catalogues'
import { filesLibraryForWindow, teamProfileGraphForWindow } from './window-reads'
import type {
  FactsAQueueCarries,
  Giving,
  ThePieceWrittenDown,
  ThePieceATurnCarries,
  OneMessageOfATurn,
  TurnFacts,
  InterruptOutcome,
  TheStopItsWordsAsked,
  AnswerWithItsStop,
  MessageNowOutcome,
  OutOfReach,
  TheDoorsReach,
  AProfileNames,
  NewBriefDelivery,
  Told,
} from './message-records'
export type {
  TurnFacts,
  InterruptOutcome,
  TheStopAMessageGot,
  TheStopItsWordsAsked,
  AnswerWithItsStop,
  MessageNowOutcome,
  OutOfReach,
  TheDoorsReach,
  AProfileNames,
  TellDelivery,
  NewBriefDelivery,
  Told,
} from './message-records'
import type { FindFilesAsked, FoundFiles } from './kept-file-search'
import { KeptFiles } from './kept-files'
import { WorkReads } from './work-reads'
import type {
  APieceItHolds,
  PieceBoard,
  PieceRecord,
  MadeByItsProfile,
  EndedPieceDetail,
  WhatAPieceIsToIt,
} from './work-records'
export type {
  APieceItHolds,
  RootOnTheBoard,
  PieceBoard,
  PieceRecord,
  MadeByItsProfile,
  EndedPieceDetail,
  WhatAPieceIsToIt,
} from './work-records'
import type {
  ProfileReport,
  ProfileReading,
  RulesOnARecord,
  WhoStartedIt,
  ConversationOnARecord,
  PieceOnARecord,
} from './agent-records'
export type {
  ProfileReport,
  ProfileReading,
  RulesOnARecord,
  WhoStartedIt,
  ConversationOnARecord,
  WhoGaveIt,
  PieceOnARecord,
} from './agent-records'
import {
  terminalFor,
  errorMessage,
  aSentence,
  theGoAheadWasNotSent,
  effectiveApprovalOf,
  approvalDisclosure,
  sessionDisclosures,
  settingsDisclosure,
  instructionsFor,
  describeApprovalMode,
  aRefusedLoginStoppedText,
  type BackgroundWorkEnded,
  type WhatAFailedTurnWasFor,
  type HeldGrant,
  type ProviderLimitDisclosure,
  type SessionEnding,
} from './session-disclosures'
export { aRefusedLoginStoppedText } from './session-disclosures'
export type { WhatAFailedTurnWasFor } from './session-disclosures'
import {
  aWordOfThePlanners,
  dealtWith,
  scheduleNoticesText,
  theSameIsSaid,
  whatItSaysIsNotStarted,
  type NoticeAboutAJob,
  type WordOwed,
  type AWordOfThisApps,
} from './schedule-notices'
export { scheduleNoticesText, type NoticeAboutAJob } from './schedule-notices'

import {
  agentsVisibleTo,
  archivedVisibleTo,
  type WhoseConversation,
  type AgentsListed,
  type VisibleConversation,
  type ArchivedListed,
  type PieceOnTheCard,
  type StoppedOnAPerson,
  type AgentCard,
} from './agent-directory'
export type {
  WhoseConversation,
  AgentsListed,
  ArchivedAgent,
  ArchivedListed,
  PieceOnTheCard,
  StoppedOnAPerson,
  AgentCard,
} from './agent-directory'
export { wordsOutsideTheText, wordsInTheText } from './kept-file-search'
export type { FindFilesAsked, FoundIn, FoundFile, FoundFiles, TextHolds } from './kept-file-search'
import {
  THE_APP_ITSELF,
  mayControl,
  mayClaim,
  mayHandBack,
  mayCommand,
  mayInterruptDownTheChain,
  mayAnswerAsAHuman,
  callerName,
  aPersonTypedIt,
  aPersonIsAsking,
  theSurfaceAsking,
  whoDidIt,
  agentCallerId,
  sessionSpeakingAs,
  type RuntimeEventSink,
  type CallerIdentity,
  type Caller,
} from './conversation-caller'
export {
  THE_APP_ITSELF,
  mayControl,
  mayClaim,
  mayHandBack,
  mayCommand,
  mayInterruptDownTheChain,
  mayAnswerAsAHuman,
  aPersonTypedIt,
  whoDidIt,
} from './conversation-caller'
export type { RuntimeEventSink, CallerIdentity, Caller } from './conversation-caller'
import type { ProviderHomesReprovision } from '../../shared/runtime-ipc'
import { providerKnowledge } from '../providers/knowledge-definitions'
import { legacyAccountRecordFormat, providerAuthPolicies } from '../providers/auth-definitions'
import type { IdentityFact, ProviderAuthPolicy } from '../providers/auth-policy'
import { providerDefinitions } from '../providers/definitions'
import {
  RejectedSessionLaunch,
  StoppedBeforeSend,
  withManagedPluginAttachments,
} from '@brobot2/runtime'
import type { FilesLibraryRequest, FilesLibraryResult } from '../../shared/files-library'
import type {
  TeamProfileGraphRequest,
  TeamProfileGraphResult,
} from '../../shared/team-profile-graph'
import {
  readPluginInstructions,
  pluginInstructionSection,
  PLUGINS_HEADING,
} from '../plugins/instructions'
import type { SkillsRequest, SkillsReply } from '../../shared/skills-window'
import type { PastWorkSearchResult } from '../../shared/past-work-search'
import type { RecentActivityReading } from '../../shared/recent-activity'
import { pathTail } from '../../shared/path-tail'
import {
  linkKindOf,
  deletedLink,
  parseLinkTarget,
  unavailableLink,
  type LinkResolution,
} from '../../shared/link-resolution'
import { LINK_TITLE_CHARS, conversationLink } from '../../shared/links'
import {
  WorkReconciler,
  WORK_RECONCILIATION_MS,
  currentIncident,
  type ReconciliationPiece,
} from './work-reconciliation'
import type {
  WorkRecoveryEvent,
  ReconciliationReceipt,
  WorkReconciliationEvent,
} from '../../shared/reconciliation-contracts'
import { indexWorkerReadings } from '../worker-readings'
import type { WorkerBindingReading } from '../../shared/worker-reading'
import { WORKER_OUTPUT_FAILURE } from '../worker-piece-folder'
import type { StartAttemptLine, StartAttemptOutcome } from '../start-attempts-log'
import {
  isMcpServerRequestEnding,
  mcpServerRequestsWaiting,
} from '../../shared/mcp-server-requests'
import {
  assignNormalWorker,
  bindNormalWorker,
  NormalWorkerLeases,
  releaseNormalAssignment,
  reserveNormalWorker,
  selectNormalWorker,
  type WorkerSelection,
} from '../normal-worker-pools'
import type {
  NormalWorkerAssignment,
  NormalWorkerBinding,
  NormalWorkerPool,
  WorkerBorn,
} from '../profile-execution-file'
import { RUNTIME_CHANGE_SUBJECTS, TURN_ATTRIBUTION_KEYS } from '../../shared/runtime-ipc'
import { originalMoveRequest, recordMovedRequest } from './move-request'
import { DO_IT_HERE, MOVE_IT, MOVE_WORDS, movedHereLine } from '../../shared/move-request'
import type {
  MoveOffer,
  MoveOrigin,
  MoveRequestAck,
  DecideMoveRequestInput,
} from '../../shared/move-contracts'
import {
  BUILT_IN_SKILLS_FAILURE,
  permittedInstalledSkillReminders,
} from '../../shared/built-in-skills'
import { randomBytes, randomUUID } from 'node:crypto'
import { returnedDocumentIndex } from '../resources/returned-document-index'
import type { ConversationProviderBlock } from '../../shared/runtime-ipc'
import type { AnsweredQuestion } from '../../shared/human-answer-contracts'
import { CurrentProviderLimitFacts, type CurrentFact } from './current-provider-limit-facts'
import type { SkillLaunchSelection } from '../skills/launch-selection'
import type { PreparedBuiltInSkills } from '../skills/prepare-built-in-skills'
import {
  holdsTheLines,
  withTheLinesKept,
  withTheLinesKeptIn,
  withTheLinesSent,
  type SavedMethodsLines,
} from '../saved-methods'
import type { TextPackRead } from '../skills/text-pack'
import type {
  AgentRuntime,
  AuthState,
  ContextReading,
  NotStartedBecause,
  PermissionDecision,
  ProviderCommandAnswer,
  ProviderUsageEvent,
  ReprovisionOutcome,
  RuntimeEvent,
  SessionHandle,
  SessionRef,
  TurnLimit,
  TurnProvenance,
  UserInputResponse,
  StartPhase,
  StartPhaseSink,
} from '@brobot2/runtime'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import {
  allProviderCapabilities,
  answerRefusalOf,
  askedOfTheChannel,
  isOfferedLabel,
  type UserInputQuestion,
  capabilitiesFor,
  childInputRefusal,
  type ChildThreadState,
  discoverExternalMcpTools,
  ExternalMcpDiscoveryError,
  type ExternalMcpReach,
  resolveReasoningEffort,
  SUPPORTED_PROVIDERS,
  TurnInProgress,
  ResumeError,
  PROVIDER_COMMAND_PREFIX,
  transientSetupFailureOf,
  didNotAnswerInTime,
  A_CHECK_NOT_ANSWERED_SAYS,
  signInNotCheckedInTime,
  folderAPersonMustFixOf,
  spawnNoWaitClearsOf,
  startRefusalOf,
  startFailureOf,
  untilCancelled,
  withDeadline,
  MAX_TOOL_TEXT,
  MAX_USAGE_WINDOWS,
  type AgentToolset,
  type LaunchSetting,
  type ProviderCommand,
} from '@brobot2/runtime'
import {
  providerDescriptor,
  providerRecord,
  providerSchema,
  type Provider,
  type ProviderConnection,
  type SessionStatus,
} from '@brobot2/shared'
import { assetUrl } from '../../shared/asset-url'
import { archivedInMemory, type ArchivedConversations } from '../archived-file'
import {
  type FileLeft,
  memoryNotesOf,
  providerFilesOf,
  removeFromHome,
} from '../conversation-files'
import type { TiedOutside, TreeDeleted } from '../db/conversation-tree'
import type {
  ArchiveOutcome,
  DeleteOutcome,
  DeletePart,
  DeleteVerdict,
} from '../../shared/conversation-archive'
import { resolveAssetRequest } from '../asset-protocol'

import { realPathOf } from '../read-text-file'
import { userProviderHomePath } from '../adopt/user-homes'

import { readBundleFile } from '../archive/read-bundle'
import { messageWithHandedPaths, recheckHandedPaths } from './handed-path'
import { whyALaunchWasRefused } from './launch-refusal'
import { ReopenQueue } from './reopen-queue'
import {
  OTHER_CONVERSATIONS_SHOWN,
  type InstructionContext,
  type TheBuildRunning,
  type OtherConversation,
  type OtherConversations,
} from './factory-text'
import { memoryNoteDir, noteNamesIn, notesThatAppeared } from './memory-notes'
import { readWorkflowOutput } from '../workflow-output'
import { readConfigFile } from '../config-file'
import { readInstructionSource } from '../instruction-source'
import {
  THIS_COMPUTER,
  openMessagePath,
  resolveMessagePaths,
  revealMessagePath,
} from '../message-paths'
import type { ProviderSignIn } from '../providers/auth-types'
import type { ProviderAuthOps } from '../providers/auth-operations'
import { aLoginRunsWithoutAKey } from './api-keys'
import type { GivenFolder, ProtectedPlaceNotice } from '../../shared/work-folders'
import { resourcesFromTheListing } from './process-listing'
import {
  agentName,
  NOTHING_TO_SEND,
  hasSomethingToSend,
  A_FIRST_MESSAGE_IS_STARTING_IT,
  HELD_ELSEWHERE,
  PROVIDER_NAME,
} from '../../shared/runtime-ipc'
import type {
  AgentIdentities,
  AgentIdentity,
  AgentIdentityName,
  IdentityCreator,
  CwdVerdict,
  NewAgent,
  ProviderSignInResult,
  RuntimeChangeMessage,
  AgentStateMoved,
  ProcessMemory,
} from '../../shared/runtime-ipc'
import type { ModelList, ReportedModel } from '../../shared/model-choice-contracts'
import type {
  InstructionProposedEvent,
  InstructionChangedEvent,
  InstructionSettledEvent,
  McpServerRequestedEvent,
  McpServerRequestForAPerson,
  McpServerRequestSettledEvent,
  TranscriptEvent,
} from '../../shared/conversation-events'
import type { CapabilityGrant } from '../../shared/capabilities'
import { DEFAULT_CAPABILITIES } from '../../shared/capabilities'
import {
  ABriefThatDidNotArrive,
  AGiveThatGaveNothing,
  AStartThatDidNotHappen,
  SessionStillStarting,
  SessionUnavailable,
  describeUnavailable,
  saidOfAReopen,
  unavailableContextOf,
  unavailableOf,
  whatAFolderRefused,
  type Unavailable,
} from './session-unavailable'
import { filesystemSpelling, folderIsGone } from './scratch-cwd'
import {
  admitAReplacement,
  admitGive,
  giveRequestSchema,
  labelsSaid,
  refuse,
  takeOnWorkRequestSchema,
  workRequestRefused,
  doneConditionSchema,
  workBriefSchema,
  theProviderAStartRunsOn,
} from './spawn-rails'
import {
  judgeAnAgentsChoice,
  refuseModel,
  type ListsAsLastRead,
  type ModelRefusal,
  type TheListAsked,
} from './model-rails'
import type {
  AdmittedSpawn,
  AStallAGiveNames,
  GiveAdmission,
  GiveFacts,
  GiveOutcome,
  GiveRequest,
  GivingConversation,
  HeldPiece,
  ServiceAtAGive,
  WhatItRunsOn,
} from './spawn-rails'
export type { GiveOutcome, SpawnRefusal } from './spawn-rails'
import { agentIdentityRowId, foldProfileName } from '../db/identity'
import { LinkAnswers, type ReadLinkAnswer } from './link-answers'
import type { Exchange, ReceivedInATurn, TranscriptTurn } from '../../shared/last-exchange'
import type { WhatARestartWouldStopIn } from '../../shared/updates'
import {
  anAddressOf,
  pieceCalled,
  pieceLine,
  pieceNumbersOf,
  RETITLE_SAID,
  theConversationCalled,
  theWorkAlone,
  type RetitleRail,
  type WorkClosedByAPerson,
  type WorkRetitled,
  type WorkTakenBackByAPerson,
  type WorkThatNamesIt,
} from '../../shared/piece-called'
import {
  MADE_FILES_LISTED,
  formOfName,
  type DocumentContent,
  type DocumentForm,
  type ResourceRole,
} from '../../shared/documents'
import {
  keepResource,
  readOfferedResource,
  refuseResource,
  resolveResource,
  resourceTitle,
  type OfferedFile,
  type ResourceRefusal,
} from '../resources/resources'

export function signInNotChecked(tooSlow: boolean): string {
  return tooSlow
    ? signInNotCheckedInTime(null)
    : `BroCrew could not ask about this sign-in, so it was not checked. ${A_CHECK_NOT_ANSWERED_SAYS} Check again.`
}

function externalMcpContext(
  store: SessionStore,
  provider: Provider,
  profileSlug: string | null,
): { externalMcp?: ExternalMcpReach } {
  if (capabilitiesFor(provider).externalMcpServers.state !== 'available') return {}
  if (profileSlug === null) return {}
  const servers = store.externalMcpServersFor(profileSlug)
  if (servers.length === 0) return {}
  return {
    externalMcp: {
      servers: servers.map((one) => ({ name: one.name, url: one.url })),
      reservedToolNames: TOOL_NAMES,
    },
  }
}

const SIGN_IN_CANCEL_TIMEOUT_MS = 3_000

function pendingSignIn(withdraw: () => void): ProviderSignIn {
  return {
    authUrl: '',
    completed: new Promise<never>(() => {}),
    cancel: async () => withdraw(),
  }
}

function signInKey(provider: Provider, profileId: string): string {
  return providerDescriptor(provider).signIn.portScope === 'machine'
    ? provider
    : `${provider}:${profileId}`
}

function oauthPortKey(provider: Provider, profileId: string): string {
  return `oauth:${signInKey(provider, profileId)}`
}

function credentialHomeKey(home: string): string {
  return `credential:${home}`
}

function profileSignInKey(provider: Provider, profileId: string): string {
  return `${provider}:${profileId}`
}

const CONTEXT_LOOKBACK_ROWS = 2_000

function signInHeldBy(provider: Provider, holder: string, asked: string): Error {
  if (holder === asked)
    return new Error(`a ${provider} sign-in is already in progress for this profile`)
  return new Error(
    `a ${provider} sign-in is already in progress for the profile "${holder}" — only one can run ` +
      `at a time, because ${provider} sends its browser redirect to one fixed port on this machine. ` +
      `Finish or cancel that one, then try again.`,
  )
}
import type { UserHomeDiscovery } from '../adopt/user-homes'
import {
  libraryChild,
  readLibrary,
  type LibraryPage,
  type LibraryQuery,
} from '../library/session-library'
import { deriveLedger, type DeriveOutcome } from '../archive/derive-ledger'
import type { ResolveImagePath } from '../archive/import-codex'
import {
  EmptyNativeTranscript,
  linesAsRows,
  nativeExportPath,
  nativeExportSupport,
  writeBundleExport,
  writeNativeExport,
  type SessionBundle,
} from '../archive/export-session'
import { isTheProvidersRecord, readLines } from '../archive/native-file'
import { readingATurn, type TurnAsked } from '../archive/turn-as-sent'
import type { TurnAsSent } from '../../shared/turn-as-sent'
import { writeReadingExport } from '../archive/write-reading'
import { createArchiveCoordinator } from '../archive/archive-coordinator'
import { createLaunchRegistry, type Launch } from './launch-registry'
import { claimResource, type ResourceClaim } from './held-resources'
import { joinLiveHosts, workRunningElsewhere, type LiveHost } from './live-hosts'
import { describeOutcome, importFromHome, type HomeConversation } from '../archive/import-from-home'
import {
  HISTORY_WINDOW_MAX_EVENTS,
  HISTORY_WINDOW_TURNS,
  providerName,
  type AdoptionReport,
  type ApiKeyChanged,
  type ApiKeyCheck,
  type ProviderResources,
  type ProvidersChangedMessage,
  type ProviderUsageReading,
  type UsageWindowSeen,
  type ProviderVersion,
  type KeptRuleRemoved,
  type KeptRules,
  type ProviderSetup,
  type ApiKeyStatus,
  type AnswerAck,
  type ProviderAnswerAck,
  type ApprovalModeDisclosure,
  type CreateSessionInput,
  type CreatedSession,
  type ProviderConfigInfo,
  READING_NOTE,
  READING_SUFFIX,
  type ExportAsked,
  type ExportedSession,
  type HistoryWindow,
  type ImportedBundle,
  type ImportedFromHome,
  type ImportedRecording,
  type LedgerStatus,
  type RebuiltLedger,
  type ProviderCapabilityMap,
  type AgentProviderSet,
  type ReleasedSession,
  type ResumedSession,
  type FirstMessageAnswer,
  type FirstMessageRefusal,
  type LaunchRefusal,
  type RuntimeEventMessage,
  type SessionLiveness,
  type SkippedSessionInfo,
  type QueuedMessageDisclosure,
  type QueueOutcome,
  type SessionHandover,
  type ChildSendResult,
  type ChildStateResult,
  type ChildWorkInput,
  type ChildWorkResult,
  type CommandTail,
  type ToolAnswer,
  type ResourceReading,
  type ResourceDrawing,
  type ResourceReveal,
  type FilesKept,
  type FilesKeptScope,
  type KeptFile,
  type WorkflowOutputResult,
  type InstructionSourceResult,
  type RevealResult,
  type MessagePath,
  type MessagePathAsk,
  type MessagePathTarget,
  type OpenMessagePathResult,
  type ConfigFileResult,
  type SessionPathTarget,
  type ResumableSessionInfo,
  type RunningState,
  type UnresumableSessionInfo,
  MAX_TURN_PARTS,
  theMessagesOf,
} from '../../shared/runtime-ipc'
import type {
  LeadInFront,
  TurnAuthorship,
  UserTurnEvent,
} from '../../shared/human-answer-contracts'
import type {
  SessionSettingChanged,
  WhatAPickBecame,
  ModelCatalogue,
} from '../../shared/model-choice-contracts'
import type { HandedPath } from '../../shared/attachment-contracts'
import type {
  MemoryLoadedEvent,
  MemoryNoteEvent,
  MessageSentEvent,
  ToolRefusedEvent,
  ReplyUndeliveredEvent,
  ReopenedEvent,
  LaunchedEvent,
  UserDecisionEvent,
  QueuedMessageEvent,
  UnqueuedMessageEvent,
  UserCommandEvent,
  StopUnansweredEvent,
  RestoredFromTheArchiveEvent,
  ReplacedByEvent,
  ReplacesEvent,
  MailboxKind,
} from '../../shared/conversation-events'
import type { SessionInstructions } from '../../shared/instruction-contracts'
import type {
  RequestEscalatedEvent,
  QuestionAskedEvent,
  RequestRoutedEvent,
  RequestInterruptedEvent,
  QuestionWithdrawnEvent,
  QuestionRecipientEndedEvent,
  QuestionEndedWithItsPieceEvent,
} from '../../shared/question-contracts'
import type {
  WorkRestartedEvent,
  WorkStallTold,
  WorkGivenEvent,
  WorkRepliedEvent,
  WorkTakenBackEvent,
  WorkRetitledEvent,
  WorkStatusSetEvent,
  WorkRebriefedEvent,
  WorkClosedEvent,
  WorkSentEvent,
  WorkInterruptedEvent,
} from '../../shared/task-contracts'
import { aPersonsOwnWords } from '../../shared/a-persons-own-words'
import {
  ROUTED_REQUEST_EVENT_TYPES,
  aRowADeliveryCanStart,
  ledgersSkippedOf,
  readOrSkip,
  skipTheLedger,
} from '../db/session-store'
import { rowsUnreadOnce } from '../db/rows-unread'
import {
  committedRowOf,
  type Committed,
  type CommittedRow,
  type WholeChange,
} from '../db/committed-changes'
import type {
  KeptFileRow,
  LeftRunning,
  LiveSessionRow,
  OpenTurn,
  TurnAsItEnded,
  RecordedSession,
  ResumableSession,
  ResourceRow,
  SessionStore,
  ThreadLeadRow,
  WaitingMessage,
  WorkRow,
} from '../db/session-store'
import type { RowsUnread } from '../db/rows-unread'
import { toWireEvent } from './event-wire'
import { AGENT_TOOL_SERVER, TOOL_NAMES, aWakeThatDidNotHappen, agentToolsFor } from './agent-tools'
import {
  collidingToolNames,
  externalMcpCollisionRefusal,
  externalMcpNameRefusal,
  externalMcpUrlRefusal,
  type ExternalMcpServerReach,
  type ExternalMcpServerRow,
} from '../../shared/external-mcp'
import type { RefusalFacts, ToolName, ToolRefusal } from './agent-tools'
import {
  MessagingRefused,
  admitReachAtAll,
  reachesWhatItDidNotStart,
  refuseOutOfReach,
  type MessageRefusal,
  type MessagingAct,
} from './message-rails'
import {
  aTurnOfSeveral,
  messageNamingItsSender,
  aTurnThatHasSaidNothing,
  provenanceOf,
  theStampOfSeveral,
  theQuestionsAStopEnded,
  theStopEnded,
  type AQuestionAStopEnded,
  THE_PERSON_AT_A_WINDOW,
  type ACallerWithAnId,
  type AStopAskedFor,
  type TurnOrigin,
  type WhereTheSenderStands,
} from './turn-origin'
import {
  itsQuestionsInOneWord,
  WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS,
  whatThisAppAddsToATurn,
  whoWaitsInOneWord,
  type AQuestionItHasOpen,
  type AHelperInTheTurn,
  type CurrentWorkInTheTurn,
  TURN_BLOCK_WORDS,
  type WhoWaitsOnIt,
} from './what-this-app-adds-to-a-turn'
import {
  EMPTY_TURN_BLOCK,
  TURN_HELPER_OWNERS,
  TURN_HELPER_PIECES,
  turnBlockChanges,
  type TurnBlockSnapshot,
} from './turn-block-changes'
import { WORK_STATE_WORD } from '../../shared/work-state-words'

import {
  ACommandTakesNoAttachments,
  ACompactionTakesNoInstructions,
  aPersonsCommand,
  aPersonsCompaction,
  mightBeAPersonsCommand,
} from './a-command-goes-as-typed'
import {
  AN_AGENT_THIS_APP_CANNOT_NAME,
  REPLY_LANDED,
  REPLY_SUMMARY_LIMIT,
  admitReply,
  aNoticeALaterFactRetracted,
  aQuestionNoticeALaterFactRetracted,
  messageNamingThePiece,
  refuseReply,
  replyText,
  replyUnkeptFileReason,
  resourcesSaid,
  theAskNamed,
  theStallAndItsAsk,
  theStoppedWork,
  undrivenWorkText,
  workAnswered,
  workUndriven,
  type WhatMadeItFalse,
  type ReplyOutcome,
  type ReplyRefusal,
} from './reply-rails'
import {
  TASK_IS_OPEN,
  openWorkOf,
  aStallItsGiverCanBeToldOf,
  givenByAConversation,
  ITS_OWNER_RUNNING_AGAIN_DRIVES_IT,
  composeWhatEachPieceIsWaitingOn,
  theWaitAConversationIsIn,
  whereTheWorkItHoldsStands,
  onePieceAsItStands,
  theAnswerItCarries,
  AN_ANSWER_HELD_THEN_LOST,
  NOTHING_IT_WAITS_ON,
  theDriveOfTheTurn,
  thePiecesTheTurnNames,
  PIECE_EVENT_TYPES,
} from '../../shared/tasks'
import type { AgentMessageKind, WaitOn } from '../../shared/task-contracts'
import type {
  ConversationWaiting,
  PieceAConversationGave,
  PieceRow,
  TaskOutcome,
  TaskStallCause,
  WhatAConversationIsWaitingOn,
  WhatEachConversationIsWaitingOn,
  WorkGivenOut,
} from '../../shared/task-contracts'
import {
  REQUEST_IS_OPEN,
  theChannelRefusalIn,
  aPersonOwesAnAnswerIn,
  aPersonsSince,
  openQuestionsByWork,
  permissionShaped,
  aWaitReads,
  type UnreadQuestion,
} from '../../shared/questions'
import type {
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
  QuestionRecipient,
  RaisedQuestion,
  RequestOnlyAPersonCanSettle,
  RequestState,
  RoutedRequest,
  ActionAsked,
  ActionFile,
  VisibleQuestion,
  WorkInHand,
} from '../../shared/question-contracts'
import { countedTogether } from '../../shared/workspace-reading'
import type { WhatNeedsAPerson, WorkspaceReading } from '../../shared/workspace-reading'
import { THE_APP_DID_IT } from '../../shared/who-did-it'
import type { LimitsDisplayAnswer } from '../../shared/limits-display'
import type { WorkSearchQuery, WorkSearchResult } from '../../shared/work-search'
import { WorkSearch } from './work-search'
import {
  completeCanonicalLimits,
  freshLimitsSnapshot,
  type LimitsWriterStamp,
} from '../db/fresh-limits-snapshot'
import {
  LIMITS_READ_BOUNDS,
  type LimitsReadInput,
  type LimitsReadResult,
} from '../db/limits-read-protocol'
import { PersonsQuestions } from './persons-questions'
import { sameWindowWriter, WindowRoutingReads } from '../db/window-routing-reads'
import { WindowIncidentReads } from '../db/window-incident-reads'
import type { WindowWriterStamp } from '../db/window-writer-stamp'
import {
  WINDOW_READ_BOUNDS,
  windowReadQuery,
  WindowReadUnavailable,
  type WindowReadQuery,
  type WindowReadResult,
} from '../db/window-read-protocol'
import { NOTICE_MEANS, type AppNotice } from '../../shared/app-notice'
import type {
  AgentInstructionsReading,
  InstructionAskWaiting,
  InstructionEnding,
  OwnInstructionsVersion,
  RulesAuthor,
} from '../../shared/own-instructions'
import { howTheRulesBegin, OWN_INSTRUCTIONS_CHARS } from '../../shared/own-instructions'
import {
  ownNotesWriteFits,
  OWN_NOTES_BASELINE_PROBLEM,
  OWN_NOTES_STALE_PROBLEM,
  OWN_NOTES_SAVE_PROBLEM,
  OWN_NOTES_WRITE_CALLER_PROBLEM,
  OWN_NOTES_READ_CALLER_PROBLEM,
  type OwnNotesWrite,
  type OwnNotesReading,
  type OwnNotesReceipt,
  type AgentOwnNotesReading,
} from '../../shared/own-notes'
import type {
  MethodBody,
  MethodLibrary,
  MethodDeleteSelection,
  MethodChangeResult,
  MethodHistoryResult,
} from '../../shared/saved-method-library'
import type {
  AgentMemoryAmended,
  AgentMemoryReading,
  MemoryAmendmentAsked,
  MemoryUndoAsked,
  MemoryCheckAsked,
  MemoryChecked,
} from '../../shared/agent-memory'
import { memoryChangeRefusal } from '../../shared/agent-memory'
import { readAgentMemory, readAgentMemoryPaged, type AgentMemoryInputs } from './agent-memory'
import {
  aLaunchRecordIn,
  oneMessageAsTheModelGotIt,
  whatItWasGiven,
  whatThisLaunchGave,
  type AnEarlierMessage,
} from './what-this-agent-was-given'
import { AGENT_MEMORY_NOTES_SHOWN } from './instructions'
import type {
  WhatALaunchGave,
  WhatTheModelGot,
  WhatThisAgentWasGiven,
} from '../../shared/what-this-agent-was-given'
import { takesAContextMessage, type SnapshotAnswer } from '../../shared/provider-snapshots'
import type {
  AgentRulesReading,
  AgentRulesReceipt,
  AgentRulesWrite,
  RulesBaseline,
} from '../../shared/agent-rules'
import type { LastReported, SpawnEdge, WhoCalledWhom, WorkEdge } from '../../shared/who-called-whom'
import {
  MAX_FOREST_CONVERSATIONS,
  type NamedConversation,
  type TheWholeForest,
} from '../../shared/the-whole-forest'
import type { ActedBy } from '../../shared/who-did-it'
import {
  foldProviderLimits,
  PROVIDER_WALL_LOOKBACK_MS,
  wallsFromUsage,
  type ProviderLimitAccountLife,
  type ProviderLimitSeen,
} from '../../shared/provider-limit'
import type { StalledWork } from '../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../shared/stopped-work'
import type { WorkIncident } from '../../shared/work-incidents'
import type { WaitingOnWhoWrote } from '../../shared/waiting-on-who-wrote'
import type { Coverage, PublicationEpoch } from '../../shared/data-version'
import type {
  ListingAnswer,
  ListingRefused,
  PublishedListing,
} from '../../shared/listing-published'
import {
  PERSONS_PARTS,
  PERSONS_ROW_KEY,
  type CountedRows,
  type PersonsPart,
  type PersonsQueue,
  type PersonsQueueAnswer,
  type PersonsQueueRefused,
} from '../../shared/persons-published'
import type { KeptReading, KeptUsage } from '../provider-usage-file'
import type { KnownAccount } from '../provider-accounts-file'
import {
  whatChangedBlock,
  HISTORICAL_LEADS_OPEN_WITH,
  LEADS_OPEN_WITH,
  leadRowsFrom,
  theLeadOwed,
  whatTheThreadHolds,
} from './codex-lead'
import { identityUse, whatHoldsIt } from '../../shared/agent-roster'
import type { AgentRemoved, IdentityUse, ItsProvider } from '../../shared/agent-roster'
import {
  STAND_IN_PROFILE,
  aChoiceIsInForce,
  judgeAgainstTheList,
  theEffortWhenNoneIsNamed,
  theEffortsOf,
  sameModel,
  theListedRow,
  theListsSpelling,
} from '../../shared/model-choice'
import type {
  AgentModelChoice,
  ModelAndEffort,
  ModelChoiceSaved,
  SelectedModel,
  WhereItCameFrom,
} from '../../shared/model-choice-contracts'
import {
  admitAnswer,
  A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION,
  NOT_A_PERSONS_TO_ANSWER_HERE,
  NO_SUCH_QUESTION_TO_ANSWER,
  admitAsk,
  answerText,
  aToDoAnsweredText,
  A_TO_DO_DONE,
  A_TO_DO_NOT_DONE,
  noPieceToAskAbout,
  questionKey,
  questionText,
  quotingTheQuestion,
  refuseQuestion,
  type AnAnswerOnItsWay,
  type AnAnswersOrigin,
  type WithdrawQuestionOutcome,
  type AskOutcome,
  type PassUpOutcome,
  type QuestionRefusal,
} from './question-rails'
import { admitInterrupt, refuseInterrupt } from './interrupt-rails'
import { distilSkipping } from './digest'
import { MAX_DIGEST_SPAN_MS, WINDOW_WAS_CHOSEN, type DigestReading } from '../../shared/digest'
import { newQueuedMessageId, queuedDisclosure } from './queued-message'
import {
  newAskedQuestionId,
  newInstructionAskId,
  newMcpServerRequestId,
  newResourceId,
  newWorkId,
} from '../db/ids'
import {
  MCP_SERVER_REQUESTS_IN_ALL,
  MCP_SERVER_REQUESTS_PER_CONVERSATION,
  MCP_SERVER_REQUEST_TOLD,
  theToolsItOffered,
  type McpServerRequestEnding,
  type McpServerRequestWaiting,
  type McpServerRequestWho,
} from '../../shared/mcp-server-requests'
import type { QueuedMessage } from './queued-message'
import { DEFAULT_PROFILE_ID, ProfileUnopenable, assertProfileMayBeCreated } from './provider-homes'
import { LivenessTracker } from './liveness'
import { BeingDoneTracker } from './being-done'
import type { ConversationAtWork, WhatIsBeingDone } from '../../shared/what-is-being-done'
import {
  agentStateOf,
  agentStateWords,
  backgroundWhat,
  NOTHING_IN_THE_BACKGROUND,
  NOTHING_SCHEDULED,
  scheduleHeld,
  somethingRunning,
} from '../../shared/agent-state'
import type {
  AgentState,
  BackgroundCommand,
  BackgroundLevel,
  ScheduledRow,
  ScheduleLevel,
} from '../../shared/agent-state-contracts'
import { clockTimeFrom } from '../../shared/clock'
import { theZoneReadNow, type LocalZone } from '../../shared/local-time'
import {
  eligibilityBounds,
  nextCronOccurrence,
  type CalendarSource,
} from '../../shared/schedule-wake'
import { planReceiptSchedule, type ReceiptSchedulePlan } from '../../shared/schedule-receipts'
import {
  planScheduleAdmission,
  recordScheduleAdmission,
  type WakeAdmissionPlan,
} from '../../shared/schedule-wake-admission'
import {
  MAX_ATTEMPTS_A_CONVERSATION,
  NO_ATTEMPTS_KEPT,
  type ConversationAttempts,
  type KeptAttempts,
  type ToldNotice,
} from '../schedule-attempts-file'
import {
  entryWithout,
  kindOf,
  NO_PROFILE_EXECUTION,
  readAgainstTheDatabase,
  reconcileProfileExecution,
  type ProfileExecution,
  type ProfileExecutionRead,
  type ProfileKind,
  type Reconciled,
} from '../profile-execution-file'
import {
  isFinal,
  newNoticeId,
  NO_CUTS_KEPT,
  withoutOldCuts,
  type CutKind,
  type CutRecord,
  type CutState,
  type KeptCuts,
  type NotContinuedBecause,
} from '../turns-the-app-cut-file'
import {
  aConversationsScope,
  aJobsMaking,
  theJobOfAMaking,
  hostCalendar,
  isScheduleEvidence,
  receiptStamp,
  RECEIPTS_LEVEL_SOURCE,
  heldUntil,
  noticesWorthTelling,
  ScheduleEvidence,
} from './schedule-evidence'

interface WhatTheGateDecided {
  readonly command: ReturnType<typeof aPersonsCommand>
}

interface WhatTheGateIsAsked {
  text: string
  attached: number
  from: TurnOrigin | null
  decided?: WhatTheGateDecided
}

const WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS: AgentMessageKind = 'note'

interface UnclaimedBase {
  readonly sessionId: string
  readonly since: number
  readonly commandedBy: string | null
}

export type UnclaimedSession =
  | (UnclaimedBase & {
      readonly running: false
    })
  | (UnclaimedBase & {
      readonly running: true
      readonly provider: Provider
      readonly cwd: string
      readonly waitingForAHuman: boolean
    })

const workFoldersIn = (folders: readonly string[]): { readonly workFolders?: readonly string[] } =>
  folders.length === 0 ? {} : { workFolders: folders }

const grantOf = (
  given: GivenFolder | null | undefined,
): { readonly grant?: string; readonly outputFolder?: string } => ({
  ...(given?.use === 'grant' ? { grant: given.folder } : {}),
  ...(given?.output === true ? { outputFolder: given.folder } : {}),
})

export function whoseWordsTheseAre(
  by: Caller,
  identityOf: (conversation: string) => string | null,
  facts: Pick<TurnFacts, 'report' | 'carriedFor' | 'appNotice' | 'answeredQuestion'> = {},
  says?: AgentMessageKind,
): TurnAuthorship {
  const { report, carriedFor, appNotice, answeredQuestion } = facts
  const wroteIt = carriedFor ?? sessionSpeakingAs(by) ?? undefined
  if (
    report === undefined &&
    wroteIt === undefined &&
    appNotice === undefined &&
    aPersonTypedIt(by)
  )
    return { humanInitiated: true }
  const named = wroteIt === undefined ? undefined : (identityOf(wroteIt) ?? undefined)
  return {
    attribution: 'app_authored',
    ...(report === undefined ? {} : { work: report }),
    ...(wroteIt === undefined ? {} : { relayedFrom: wroteIt }),
    ...(named === undefined ? {} : { relayedFromProfile: named }),
    ...(appNotice === undefined ? {} : { appNotice }),
    ...(answeredQuestion === undefined ? {} : { answeredQuestion }),
    ...(says === undefined || sessionSpeakingAs(by) === null ? {} : { says }),
  }
}

function theSenderItsAuthorshipNames(
  authorship: TurnAuthorship,
  carriesAPiece: boolean,
  aPersonIsAt: (conversation: string) => boolean,
): TurnOrigin | null {
  if (authorship.attribution === undefined) return THE_PERSON_AT_A_WINDOW
  if (authorship.relayedFrom === undefined) return null
  if (authorship.says === undefined && !carriesAPiece) return null
  return {
    who: 'a-caller-with-an-id',
    caller: authorship.relayedFrom,
    profile: authorship.relayedFromProfile ?? null,
    aPersonIsBehindIt: aPersonIsAt(authorship.relayedFrom),
  }
}

function aPersonsOwn(queued: QueuedMessage): boolean {
  return queued.origin?.who === 'a-person'
}

const ITS_PIECE_HAD_ENDED = {
  reason: 'abandoned',
  detail: 'the piece it carried had already ended',
} as const

function ownerName(ownerId: string | null): string {
  return ownerId ?? 'nobody — no surface asked for it'
}

function notedInBoth(own: RowsUnread, answer: RowsUnread): RowsUnread {
  return {
    in: (sessionId) => {
      const mine = own.in(sessionId)
      const theirs = answer.in(sessionId)
      return (ordinal) => {
        mine(ordinal)
        theirs(ordinal)
      }
    },
    get count() {
      return own.count
    },
    get ledgersSkipped() {
      return own.ledgersSkipped
    },
  }
}

type WindowReadMiss =
  | 'callers-full'
  | 'writer-moved'
  | 'writer-unsampled'
  | 'worker-read-failed'
  | 'worker-busy'
  | 'worker-gone'
  | 'worker-needs-restart'

class WindowReadMissed extends WindowReadUnavailable {
  constructor(
    readonly missed: WindowReadMiss,
    cause?: string,
  ) {
    super(missed === 'worker-needs-restart' ? 'restart' : 'unavailable', undefined, cause)
  }
}

function whyTheWorkerMissed(error: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted === true || !(error instanceof WindowReadUnavailable)) return error
  if (error.why === 'restart') return new WindowReadMissed('worker-needs-restart', error.message)
  if (error.why === 'busy') return new WindowReadMissed('worker-busy', error.message)
  return new WindowReadMissed(
    error.why === 'failed' ? 'worker-read-failed' : 'worker-gone',
    error.message,
  )
}

export interface WaitOnAsked {
  readonly agent?: string
  readonly person?: string
  readonly time?: string
  readonly event?: string
}

const A_WAIT_ENDS_WITHIN_MS = 30 * 24 * 60 * 60 * 1000

const A_FAILED_WINDOW_READ_WAITS_MS = 1_000
const A_FAILED_WINDOW_READ_WAITS_AT_MOST_MS = 30_000
const REMEMBERED_WINDOW_READ_MISSES: ReadonlySet<WindowReadMiss> = new Set<WindowReadMiss>([
  'worker-read-failed',
])

const COPY_SLICE_ROWS = { first: 200, least: 50, most: 2000 } as const
const COPY_SLICE_BYTES = 256 * 1024
const COPY_SLICE_TARGET_MS = 4
const COPY_BUSY_WAIT_MS = { least: 10, most: 1000 } as const
const SAY_COPY_PROGRESS_EVERY_MS = 60_000

const SAY_A_WINDOW_READ_MISS_EVERY_MS = 60_000

const INCIDENT_MAIN_READ_EVERY_MS = 30_000

function noPageBefore(next: number): HistoryWindow {
  return { entries: [], from: next, hasOlder: next > 0, turnAligned: true }
}

const NO_SURFACE: RuntimeEventSink = {
  ownerId: 'no surface asked for this session',
  aPersonIsBehindIt: false,
  alive: false,
  send() {},
  sendLiveness() {},
}

const CHECKING_A_FOLDER = 'checking-a-folder'

class ItsSignInMovedOn extends Error {}

class ServerNotReached extends Error {
  constructor(url: string, cause: unknown) {
    const kind = cause instanceof ExternalMcpDiscoveryError ? cause.kind : 'unreadable'
    const status = cause instanceof ExternalMcpDiscoveryError ? cause.status : null
    const words =
      kind === 'unreachable'
        ? `Couldn't reach the server at ${url}. Check that it's running and try again.`
        : kind === 'timeout'
          ? `The server at ${url} didn't answer in time. Nothing was registered.`
          : kind === 'refused'
            ? `The server at ${url} refused the MCP check${status === null ? '' : ` (HTTP ${status})`}. Nothing was registered.`
            : `Couldn't read the server's MCP reply at ${url}. Nothing was registered.`
    super(words)
  }
}

function theAddressOf(url: string): string {
  try {
    const at = new URL(url.trim())
    const host =
      at.hostname === 'localhost' || at.hostname === '[::1]' || /^127\./u.test(at.hostname)
        ? 'loopback'
        : at.hostname
    const port = at.port !== '' ? at.port : at.protocol === 'https:' ? '443' : '80'
    return `${at.protocol}//${host}:${port}${at.pathname}${at.search}`
  } catch {
    return url
  }
}

class ItsAskerIsStarting extends Error {}

class ItsRecordIsNotWritten extends Error {}

type ApprovalCommitted =
  | { readonly is: 'gone' }
  | { readonly is: 'starting' }
  | { readonly is: 'taken'; readonly why: string }
  | { readonly is: 'superseded' }
  | {
      readonly is: 'approved'
      readonly row: ExternalMcpServerRow
      readonly granted: readonly string[] | null
      readonly notGiven: readonly string[]
    }

type RequestSettled =
  | { readonly is: 'settled'; readonly as: McpServerRequestEnding; readonly told: boolean }
  | { readonly is: 'gone' }
  | { readonly is: 'starting' }

const A_DECISION_WAITS_FOR_A_START_MS = 5_000

const AN_ENDING_WAITS_OUT_STARTS = 3

type PassedUpCopies = readonly { readonly passer: string; readonly requestId: string }[]

type TheCopiesRefusal = Extract<
  ToolRefusal,
  'a-conversation-with-its-questions-is-starting' | 'its-questions-could-not-all-be-read'
>

const ANSWERED_FIRST: AnswerAck = {
  outcome: 'refused',
  reason: 'somebody answered that request first',
  stillOpen: false,
}

const ITS_ASKER_IS_STARTING: AnswerAck = {
  outcome: 'refused',
  reason:
    'the conversation that asked is starting right now, so nothing was decided. Press it again in a moment.',
  stillOpen: true,
}

const THE_ASKER_WAS_NOT_TOLD = 'BroCrew could not tell the conversation that asked.'

function takenDownSays(name: string): AnswerAck {
  return {
    outcome: 'refused',
    reason: `A server called “${name}” is already registered, so this request was taken down instead.`,
    stillOpen: false,
  }
}

const A_PERSON_DID_IT: ActedBy = { who: 'a-person' }

const TOLD_ABOUT_A_SERVER_REQUEST = { appNotice: 'an-mcp-server-request-decided' } as const

interface ItsToolsMoved {
  readonly reopened: string
  readonly notReopened: (because: 'its-background-work' | 'its-planning') => string
}

type WhatAReopenWaitsFor = 'its-turn' | 'a-person' | 'its-background-work' | 'its-planning'

const REOPEN_LOOP_GUARD_MS = 10 * 60_000

const A_REOPEN_WAITS_FOR: Readonly<
  Record<
    WhatAReopenWaitsFor | 'nothing' | 'a-person-to-reopen-it',
    { readonly reopens: string; readonly then?: string; readonly sooner?: string }
  >
> = {
  nothing: {
    reopens: 'This app is reopening it on the current one',
    then: ', and what is held for it goes in as it starts',
  },
  'a-person-to-reopen-it': {
    reopens: `This app reopened it on the current one moments ago, and it read as moved on again before it ever read as current, so this app does not reopen it again within ${String(REOPEN_LOOP_GUARD_MS / 60_000)} minutes of that reopen; until then, what is held for it waits for a person to reopen it`,
  },
  'its-turn': {
    reopens: 'This app reopens it on the current one once its turn ends',
    then: ', and what is held for it goes in then',
    sooner: 'A person can stop that turn and reopen it sooner.',
  },
  'a-person': {
    reopens:
      'This app reopens it on the current one once the question or permission it is waiting on is answered',
    then: ', and what is held for it goes in then',
  },
  'its-background-work': {
    reopens:
      'This app reopens it on the current one once the work it runs in the background has finished, since a reopen would stop that work',
    then: '; what is held for it goes in then',
    sooner: 'A person can reopen it sooner.',
  },
  'its-planning': {
    reopens:
      'This app reopens it on the current one once a person ends its planning, since a reopen would end that',
    then: '; what is held for it goes in then',
    sooner: 'A person can reopen it sooner.',
  },
}

const ASKS_SAID_CHARS = 80

const theSignInChanged = (provider: Provider): string =>
  `Its ${PROVIDER_NAME[provider]} sign-in changed after it started.`

const RESOURCE_SAMPLE_MS = 5_000

interface WordsLeftForAService {
  readonly by: Caller
  readonly says?: AgentMessageKind
  readonly attachments: readonly HandedPath[]
  readonly rebriefs?: { readonly piece: string; readonly label: string }
}

interface TheTurnOnAPiece {
  readonly life: HostedSession
  readonly turnsEnded: number
}

interface WhoseTurnItIs {
  readonly aPersons: boolean
  readonly names: readonly string[]
}

interface HostedSession {
  readonly currentProviderLimits: () => ProviderLimitDisclosure
  readonly id: string
  readonly provider: Provider
  grants?: readonly HeldGrant[]
  readonly instructions: SessionInstructions
  readonly builtInSkills?: PreparedBuiltInSkills
  readonly cwd: string
  readonly providerHome: string
  readonly profileId: string
  readonly createdApprovalMode: 'ask' | 'auto'
  lastAgentInfo: string
  lastReported: string
  readonly reportedBefore: ReportedModel | null
  lastDisclosures: string
  planAsRecorded: boolean
  readonly handle: SessionHandle
  readonly launch: Launch
  sink: RuntimeEventSink
  terminated: Promise<void> | null
  ordinal: number
  readonly liveFrom: number | null
  readonly lifeSince: number
  pump: Promise<void>
  closing: Promise<void> | null
  stopping: Promise<boolean> | null
  finalizing: Promise<void> | null
  recordingFailure: string | null
  recordingFailureReported: boolean
  staleEventReported: boolean
  commands: ProviderCommandAnswer | null
  askingForCommands: Promise<ProviderCommandAnswer> | null
  firstTurnLead: string | null
  firstTurnLeadIs: LeadInFront['is']
  leadJustHandedOver: LeadInFront | null
  readonly lifeLead: string | null
  readonly savedMethodsLines: SavedMethodsLines | null
  readonly launchGave: WhatALaunchGave | null
  wordsJustHandedOver: string | null
  wordsItWasHandedFor: readonly string[]
  latestContext: ContextReading | null
  readonly memoryNoteDir: string | null
  memoryNotes: ReadonlySet<string>
  turnOpened: boolean
  itsTurnDrives: string | null
  itsTurnIs: WhoseTurnItIs
  personalHandover: number
  personalWorkTurn: string | null
  aPersonsWordsOpenedIt: boolean
  moveRequestTurn: { id: string } | null
  moveRequestRowPending: boolean
  moveRequestHandoff: object | null
  turnsEnded: number
  aPersonLastWroteAt: number | null
  itsQuestionsAsLastSaid: { readonly said: string; readonly at: number } | null
  whoWaitedAsLastSaid: { readonly said: string; readonly at: number } | null
  pluginsAsLastSaid: string | null
  turnBlockSnapshot: TurnBlockSnapshot
  pendingTurnBlock: {
    plugins: string | null
    readonly next: TurnBlockSnapshot
    readonly words: string
    readonly questions: HostedSession['itsQuestionsAsLastSaid']
    readonly waiting: HostedSession['whoWaitedAsLastSaid']
  } | null
  sentOrdinal: number | null
  readonly liveness: LivenessTracker
  readonly beingDone: BeingDoneTracker
  background: BackgroundLevel
  scheduled: ScheduleLevel
  levelWritten: ScheduleLevel | null
  providerSpokeOfItsJobs: boolean
  readonly toolCallsNamed: Map<string, BackgroundCommand>
  mailbox: QueuedMessage[]
  toldAboutStall: Set<string>
  telling: Promise<void>
  flushing: Promise<void> | null
  holdingQueue: number
  cancelsThatStopNothing: Set<string>
  stopStillAsked: Promise<void> | null
  handingOver: readonly QueuedMessage[]
  diedOnAStaleSignIn?: true
  whatItsFailedTurnWasFor?: WhatAFailedTurnWasFor
  finishedSinceItsLastTurn: readonly BackgroundWorkEnded[]
  lastStopEnded: readonly string[]
  stopEndedUntold: string[]
  stopEndedSaid: number
  readonly askedSinceItsLastTurnEnded: Set<string>
  questionsAStopEndedUntold: AQuestionAStopEnded[]
  questionsAStopEndedSaid: number
  readonly whenATurnEnds: ((ended: readonly string[]) => void)[]
  itsWorkWasReadBeforeItsWords: boolean
  itsSignInMovedOn?: true
  itsCopyWasReplaced?: true
  itCarriedOnAfterARepair?: true
  itRetriedRejectedLogin?: true
  renewItsRejectedLogin?: true
  rejectedLoginToRenew?: object
  reopeningOnTheCurrentSignIn?: true
  itsToolsMoved?: readonly ItsToolsMoved[]
  reopeningForItsTools?: true
  reopenedForWhatWaited?: { readonly at: number; stopped: boolean; didNotHelp?: true }
  runsOnAnOlderLogin?: true
}

const ITS_PLACE_WAS_TAKEN =
  'The conversation that held it could never be reopened, and the one that took its place never held it.'

class ItsPlaceWasTaken extends Error {
  constructor(to: string, holder: string, label: string) {
    super(`${to} took the place of ${holder}, which holds ${label}`)
  }
}

function notTold(error: unknown): Told {
  let seen: unknown = error
  for (let depth = 0; depth < 8 && seen instanceof Error; depth += 1) {
    if (seen instanceof ItsPlaceWasTaken) {
      return { delivery: 'not-delivered', whyNotTold: ITS_PLACE_WAS_TAKEN }
    }
    seen = (seen as { cause?: unknown }).cause
  }
  return { delivery: 'not-delivered', whyNotTold: whyItWasNotDelivered(error) }
}

function deliveryOf(delivered: QueueOutcome | null): Told {
  return delivered === null
    ? { delivery: 'not-delivered', whyNotTold: ITS_PLACE_WAS_TAKEN }
    : { delivery: delivered.outcome === 'sent' ? 'sent' : 'held' }
}

export type TakeBackOutcome =
  | ({
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly owner: string
      readonly tookBackTheMessage: boolean
      readonly endedQuestions: number
      readonly askedItsTurnToStop: boolean
      readonly atAService: boolean
    } & Told)
  | { readonly ok: false; readonly refused: TakeBackRefused }

export type TakeBackRefused =
  | {
      readonly rail: Extract<ToolRefusal, 'not-a-piece-you-gave'>
      readonly itHoldsIt?: APieceItHolds
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-piece-was-already-answered'>
      readonly label: string
      readonly outcome: TaskOutcome | null
      readonly resources: readonly string[]
      readonly endedAt: number | null
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-piece-was-already-taken-back'>
      readonly label: string
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-piece-was-already-closed'>
      readonly label: string
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-work-is-being-sent'>
      readonly label: string
    }
  | {
      readonly rail: TheCopiesRefusal
      readonly label: string
      readonly unreadQuestion?: UnreadQuestion
    }
  | {
      readonly rail: Extract<ToolRefusal, 'that-conversation-has-not-started'>
      readonly label: string
    }

export const AN_IDENTITY_THIS_APP_CANNOT_NAME: WhoseConversation = {
  is: 'an-identity-this-app-cannot-name',
}

export function whoseConversationIs(
  profile: string | null,
  roster: readonly AgentIdentityName[] | null,
): WhoseConversation {
  if (profile === null) return AN_IDENTITY_THIS_APP_CANNOT_NAME
  return { is: 'an-identity-this-app-holds', profile, name: agentName(profile, roster) }
}

export function nameTheConversation(whose: WhoseConversation): string {
  return whose.is === 'an-identity-this-app-holds' ? whose.name : AN_AGENT_THIS_APP_CANNOT_NAME
}

function keptFileOf(kept: KeptFileRow, roster: readonly AgentIdentity[] | null): KeptFile {
  const { resource, addedByIdentity } = kept
  return {
    ...(kept.group === undefined ? {} : { group: kept.group }),
    ...(kept.mainResult === true ? { mainResult: true as const } : {}),
    resourceId: resource.resource,
    title: resource.title ?? resource.name,
    name: resource.name,
    form: formOfName(resource.name),
    bytes: resource.bytes,
    role: resource.role,
    keptAt: resource.createdAt,
    sha256: resource.sha256,
    addedBy:
      resource.addedBy === null
        ? null
        : {
            conversation: resource.addedBy,
            name: nameTheConversation(whoseConversationIs(addedByIdentity, roster)),
            identity: addedByIdentity,
          },
    piece: resource.piece,
    label: kept.label,
    pieceTitle: kept.pieceTitle,
  }
}

const A_TURN_THAT_DID_NOTHING_HOLDS: ReadonlySet<TranscriptEvent['type']> = new Set([
  'work_given',
  'status',
  'error',
  'turn',
  'provider_usage',
  'provider_limit_clear',
  'context_reading',
  'provider_commands',
  'tool_inventory',
  'session',
])

const WHAT_A_REOPEN_ADDS: ReadonlySet<TranscriptEvent['type']> = new Set([
  'status',
  'provider_usage',
  'provider_limit_clear',
  'context_reading',
  'provider_commands',
  'tool_inventory',
  'session',
  'reopened',
  'launched',
  'work_recovery',
])

function transcriptEventForDisplay(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'unknown') return event
  const provider = SUPPORTED_PROVIDERS.find((one) => one === event.provider)
  return provider === undefined
    ? event
    : (providerDefinitions[provider].transcripts.eventForDisplay?.(event) ?? event)
}

function transcriptMessageForDisplay(message: RuntimeEventMessage): RuntimeEventMessage {
  const event = transcriptEventForDisplay(message.event)
  return event === message.event ? message : { ...message, event }
}

function authPolicyForNotice(event: TranscriptEvent): ProviderAuthPolicy | undefined {
  if (event.type !== 'unknown') return undefined
  const provider = SUPPORTED_PROVIDERS.find((one) => one === event.provider)
  return provider === undefined ? undefined : providerAuthPolicies[provider]
}

function aRefusedGiveOnlyHeardHousekeeping(event: TranscriptEvent): boolean {
  return authPolicyForNotice(event)?.protocol.refusedGive(event) ?? false
}

function aGiveReopenOnlyHeardHousekeeping(event: TranscriptEvent): boolean {
  return SUPPORTED_PROVIDERS.some((provider) =>
    providerAuthPolicies[provider].protocol.reopenedGive(event),
  )
}

const THE_ROWS_A_REFUSED_TURN_IS_READ_IN = 400

interface RefusedInputReference {
  readonly opened: number
  readonly drives: string | null
  readonly piece: string | null
}

function handBackTheMainProcess(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export type CarriesOn = 'starting' | { readonly wakesAt: number } | null

export type RestoredByAnAgent =
  | {
      readonly is: 'restored'
      readonly conversations: readonly {
        readonly conversation: string
        readonly carriesOn: CarriesOn
      }[]
      readonly readAt: number
    }
  | { readonly is: 'no-such-agent' }
  | { readonly is: 'not-archived' }
  | { readonly is: 'being-set-aside'; readonly said: string }
  | { readonly is: 'could-not'; readonly said: string }

interface CardReads {
  readonly roster: readonly AgentIdentity[]
  readonly askingForRules: ReadonlySet<string>
  readonly asksUnread: number
  readonly nameOf?: (conversation: string) => string
}

interface ItsLedger {
  readonly routings: readonly RoutedRequest[]
  readonly raised: ReadonlyMap<string, RaisedQuestion>
}

type WorkOutOf = (id: string) => readonly PieceRow[]

const NO_PIECE_STOPPED: ReadonlySet<string> = new Set()

type ScheduleLevelsAtTheLaunch = ReturnType<SessionStore['newestScheduleLevels']>

interface OwedQuestion extends RoutedRequest {
  readonly piece: string | null
}

type OwedBy = (id: string) => readonly OwedQuestion[]

interface WhoOwesIt {
  readonly needsYou: boolean
  readonly askedOf: string | null
  readonly waitingOnTheAnswerOf: string | null
  readonly waitingOnTheAnswerSince: number | null
  readonly workIsWith: readonly string[]
  readonly waitingOnTheWorkOf: readonly string[]
  readonly waitingOnTheWorkSince: number | null
  readonly owedTo: readonly string[]
  readonly owesAnAnswerTo: readonly string[]
  readonly owesAnAnswerSince: number | null
}

function earliest(moments: readonly number[]): number | null {
  return moments.length === 0 ? null : Math.min(...moments)
}

const GRANTS_MAY_MOVE: ReadonlySet<TranscriptEvent['type']> = new Set<TranscriptEvent['type']>([
  'work_given',
  'work_replied',
  'work_taken_back',
  'work_closed',
  'message_unqueued',
])

const MOVES_A_LIVE_FACT: ReadonlySet<TranscriptEvent['type']> = new Set<TranscriptEvent['type']>([
  'status',
  'background_work',
  'scheduled_work',
  'instruction_proposed',
  'instruction_settled',
])

const MOVES_A_PIECE_THAT_WAITS_ON_WHO_WROTE: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([
  'user_turn',
  'turn',
  'message_queued',
  'message_unqueued',
  'work_replied',
  'work_status_set',
  'replaced_by',
])

const theSameLevel = (one: ScheduleLevel, other: ScheduleLevel): boolean =>
  one.dropped === other.dropped &&
  one.jobs.length === other.jobs.length &&
  one.jobs.every((job) => {
    const beside = other.jobs.find((held) => held.id === job.id)
    return (
      beside !== undefined &&
      beside.schedule === job.schedule &&
      beside.recurring === job.recurring &&
      beside.prompt === job.prompt &&
      beside.nominalAt === job.nominalAt &&
      beside.notStarted === job.notStarted
    )
  })

const MOVES_ITS_NAME: ReadonlySet<TranscriptEvent['type']> = new Set<TranscriptEvent['type']>([
  ...PIECE_EVENT_TYPES,
  'replaced_by',
])

const MOVES_WHAT_A_PERSON_IS_ASKED: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([
  ...ROUTED_REQUEST_EVENT_TYPES,
  ...PIECE_EVENT_TYPES,
  ...MOVES_A_PIECE_THAT_WAITS_ON_WHO_WROTE,
  'permission_request',
  'user_input_request',
  'instruction_proposed',
  'instruction_settled',
  'mcp_server_requested',
  'mcp_server_request_settled',
  'work_stall_told',
  'work_interrupted',
  'work_restarted',
  'status',
  'background_work',
  'scheduled_work',
])

const NAMES_WHAT_A_PERSON_IS_ASKED: ReadonlySet<string> = new Set(['agent_identity'])

const MOVES_ITS_GIVERS_WAIT: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>(['work_given', 'work_replied', 'work_taken_back', 'work_closed'])

function howItsWorkIsDrawn(composed: readonly PieceRow[]): ReadonlyMap<string, string> {
  return new Map(
    composed
      .filter((piece) => TASK_IS_OPEN[piece.state])
      .map((piece) => [piece.piece, asItIsDrawn(piece)] as const),
  )
}

function asItIsDrawn(piece: PieceRow): string {
  return piece.stalledBecause === null ? piece.state : `${piece.state} · ${piece.stalledBecause}`
}

export const CONVERSATIONS_ON_A_RECORD = 10

export const PIECES_ON_A_RECORD = 10

export const FILES_ON_A_RECORD = 5

export const RULES_BEGIN_CHARS = 200

export type AgentRecordReading =
  | { readonly is: 'no-agent-by-that-name' }
  | { readonly is: 'a-record'; readonly record: AgentRecord }

export interface AgentRecord {
  readonly agent: ProfileReport
  readonly rules: RulesOnARecord
  readonly conversations: readonly ConversationOnARecord[]
  readonly conversationsNotListed: number
  readonly pieces: readonly PieceOnARecord[]
  readonly piecesUnread: number
  readonly piecesNotListed: number
  readonly files: (MadeByItsProfile & { readonly is: 'listed' })['made']
  readonly filesNotListed: number
  readonly rowsUnread: number
  readonly ledgersSkipped?: number
  readonly readAt: number
}

interface SessionSlot {
  readonly id: string
  readonly provider: Provider | null
  ownerId: string | null
  ownerIsAPerson: boolean
  readonly bornWithoutASurface: boolean
  readonly aDeliveryStartedItWithNoWindow: boolean
  readonly replaces: string | null
  readonly startedFrom: string | null
  readonly profileId: string | null
  readonly commandedBy: string | null
  readonly spawnedBy: string | null
  readonly since: number
  readonly launchKey: string | null
  phase: SlotPhase
  readonly launch: Launch
  session: HostedSession | null
  readonly arrived: Promise<void>
  readonly settle: () => void
}

type SlotPhase = 'starting' | 'live' | 'closing'

interface TheWordsOfAQuestion {
  readonly move?: MoveOffer
  readonly action?: ActionAsked
  readonly asked: string
  readonly piece: string | null
  readonly parts: readonly string[]
  readonly prompt: string
}

type IntoItsLedger =
  | WorkReconciliationEvent
  | WorkRecoveryEvent
  | ReplyUndeliveredEvent
  | UserDecisionEvent
  | WorkTakenBackEvent
  | WorkRetitledEvent
  | WorkStatusSetEvent
  | WorkRebriefedEvent
  | WorkClosedEvent
  | WorkSentEvent
  | UnqueuedMessageEvent
  | QueuedMessageEvent
  | ReplacedByEvent
  | QuestionRecipientEndedEvent
  | QuestionEndedWithItsPieceEvent
  | RestoredFromTheArchiveEvent

interface TheHeldMessagesCarrying {
  readonly session: HostedSession | null
  readonly inTheMailbox: readonly QueuedMessage[]
  readonly handedOn: readonly QueuedMessage[]
  readonly waiting: readonly string[]
}

class ItStoppedUnderTheDelivery extends Error {
  constructor() {
    super('the conversation stopped before these words were handed over')
  }
}

class ItEndedBeforeItsNewBrief extends Error {
  constructor() {
    super('the piece had ended before its new brief reached the conversation holding it')
  }
}

class ServicesAreOff extends Error {
  constructor() {
    super(NO_SERVICE_STARTS_WHILE_OFF)
  }
}

type WhatAGiverHolds = Pick<HostedSession, 'mailbox' | 'handingOver'>

type WhereAReplyWent =
  | { readonly delivered: 'sent' | 'held'; readonly why: null }
  | { readonly delivered: 'kept' | 'not-delivered'; readonly why: string }

type WhereHeldWordsWait = 'its-mailbox' | 'its-ledger' | 'nowhere'

const REFUSALS_IN_THIS_APPS_OWN_WORDS: ReadonlySet<Unavailable> = new Set<Unavailable>([
  'shutting-down',
  'cancelled',
  'lost-its-place',
  'still-closing',
  'not-confirmed-stopped',
])

function whyItWasNotDelivered(error: unknown): string {
  const cause = error instanceof AStartThatDidNotHappen ? error.cause : error
  if (cause instanceof ServicesAreOff) return SERVICES_ARE_OFF_SO_IT_DID_NOT_START
  const reason = unavailableOf(cause)
  if (reason !== null) {
    return describeUnavailable(reason, { ...unavailableContextOf(cause), reopening: true })
  }
  const unwoken = aWakeThatDidNotHappen(cause)
  if (unwoken?.rail === 'that-conversation-could-not-be-woken-just-now') {
    return describeUnavailable('machine-ran-short', { reopening: true, shortage: unwoken.because })
  }
  if (unwoken?.what === 'program') {
    return 'This conversation did not start: this machine could not run its provider’s program — it may be missing or not runnable.'
  }
  if (unwoken?.what === 'folder') {
    return 'This conversation did not start: BroCrew could not make or write a folder it needs.'
  }
  if (unwoken?.what === 'gone-folder') {
    return 'This conversation did not start: the folder it ran in is no longer there.'
  }
  if (unwoken?.what === 'provider-refused') {
    return 'This conversation did not start: its provider refused to start it.'
  }
  if (unwoken?.provider !== undefined && unwoken.what === 'sign-in') {
    return `This conversation did not start: its ${PROVIDER_NAME[unwoken.provider]} sign-in could not be used.`
  }
  if (unwoken?.provider !== undefined && unwoken.what === 'settings') {
    return `This conversation did not start: the ${PROVIDER_NAME[unwoken.provider]} settings in its profile could not be used.`
  }
  if (unwoken?.rail === 'that-conversation-could-not-be-resumed') {
    return 'This conversation did not start: its provider could not bring it back — it may need signing in again, or may no longer have it.'
  }
  let seen: unknown = cause
  for (let depth = 0; depth < 8 && seen instanceof Error; depth += 1) {
    const refused = unavailableOf(seen)
    if (refused !== null) {
      if (!REFUSALS_IN_THIS_APPS_OWN_WORDS.has(refused)) break
      return describeUnavailable(refused, { ...unavailableContextOf(seen), reopening: true })
    }
    seen = (seen as { cause?: unknown }).cause
  }
  return 'This conversation could not be reached just now, for a reason BroCrew records only in its log.'
}

const ITS_RECORD_WOULD_NOT_TAKE_IT = 'BroCrew could not write it into that conversation’s record.'

function anAnswerKeptForItsStart(asker: string, why: string): string {
  return `The answer is recorded and kept for ${asker}: it goes to that conversation first when it next starts, or later if its provider’s usage limit holds then. It could not be started now — ${why}`
}

function aQuestionKey(askedBy: string, requestId: string): string {
  return `${askedBy}\u0000${requestId}`
}

interface Startable {
  readonly id: string
  readonly ownerId: null
  readonly commandedBy: string | null
  readonly parent: string | null
  readonly profileId: string | null
  readonly provider: Provider
}

function itCanNeverBeReopened(error: unknown): boolean {
  let seen: unknown = error
  for (let depth = 0; depth < 8 && seen instanceof Error; depth += 1) {
    if (seen instanceof ResumeError && seen.noSuchSession) return true
    if (unavailableOf(seen) === 'never-started') return true
    seen = (seen as { cause?: unknown }).cause
  }
  return false
}

function aMessageContinuesIt(row: RecordedSession, isAService: boolean): boolean {
  return (
    row.unresumableReason === null ||
    (row.neverStarted && aRowADeliveryCanStart(row) && !isAService)
  )
}

const A_SERVICE_IS_NEVER_REPLACED =
  'it is a service’s one conversation, so no other is started in its place'

const NOT_THE_ONLY_APP = 'Not changed: the app may be open twice.'

const NO_SERVICE_IS_MADE_WHILE_OFF = 'Not created: services are off.'

const NOT_STARTED_A_SERVICE = 'Not started: it’s a service.'

export const MAX_WAITS_WALKED = 256

const QUEUED_NEVER_TOLD = 'The piece was queued and had not reached it, so nothing was sent.'

const MAY_FREE_A_SERVICE: ReadonlySet<TranscriptEvent['type']> = new Set([
  'status',
  'turn',
  'work_given',
  'work_replied',
  'work_taken_back',
  'work_closed',
  'message_unqueued',
  'background_work',
  'scheduled_work',
])

const A_SERVICE_IT_MAY_BE =
  'This may be a service’s conversation, and which agents are services can’t be read, so ' +
  'nothing was deleted.'

const A_SERVICE_IT_STAYS = 'Not deleted: the services list could not be saved.'

const THEY_WAIT_FOR_SERVICES = 'It waits until services are on.'

const NO_SERVICE_STARTS_WHILE_OFF = 'services are off, so a service’s conversation is not started'

const SERVICES_ARE_OFF_SO_IT_DID_NOT_START =
  'Services are off, so a service’s conversation is not started.'

const NOT_REMOVED_UNREADABLE = 'Not removed: services list unreadable.'

const NOT_REMOVED_OPEN_TWICE = 'Not removed: the app may be open twice.'

const NOT_REMOVED_NOT_SAVED = 'Not removed: services list not saved.'

function whyNoSettingForItsNextStart(
  row: RecordedSession,
  replacedBy: ReadonlyMap<string, string>,
  isAService: boolean,
): string | null {
  if (
    replacedBy.has(row.sessionId) ||
    (row.neverStarted && aRowADeliveryCanStart(row) && !isAService)
  ) {
    return 'its next message starts a new conversation in its place, so a setting changed here would not reach it'
  }
  if (row.unresumableReason !== null) {
    return 'no message continues this conversation, so a setting changed here would not reach it'
  }
  return null
}

function onItsWayOut(slot: SessionSlot): boolean {
  if (slot.phase === 'closing') return true
  const session = slot.session
  return (
    session !== null &&
    (session.closing !== null ||
      session.finalizing !== null ||
      session.handle.isRetiring?.() === true)
  )
}

function stillStarting(slot: SessionSlot): boolean {
  return slot.session === null && !onItsWayOut(slot)
}

const TOOL_CALLS_REMEMBERED = 256

const DEFAULT_INTERRUPT_WAIT_MS = 2_000
const DEFAULT_CLOSE_DRAIN_TIMEOUT_MS = 5_000

const DEFAULT_REOPEN_LEADS_GRACE_MS = 1_000

const DEFAULT_DELIVERY_WAIT_MS = 15_000

const DEFAULT_COMMAND_LIST_WAIT_MS = 5_000

const WAKE_LEAD_MS = 30_000

const WAKE_BRIEF_HOLD_MS = 2 * 60_000

const THE_ONE_CLOCK_ERA = 'wall'

const SCHEDULES_HELD = 200

const WAKE_CHECK_MS = 60_000

const WAKE_RETRY_MAX_MS = 30 * 60_000

const ITS_JOBS_WENT_WITH_ITS_HISTORY =
  'this conversation could never be reopened, and the jobs these words were about went with its history'

const NEWER_WORDS_ABOUT_ITS_JOBS =
  'newer words about this conversation’s jobs took their place when this app started again'

const NEWER_WORDS_ABOUT_ITS_JOBS_NOW = 'newer words about this conversation’s jobs took their place'

const NEWER_WORDS_AFTER_THE_ARCHIVE =
  'newer words about this conversation’s jobs took their place when it came back from the archive'

const NEWER_WORDS_AFTER_A_DELETE =
  'newer words about this conversation’s jobs took their place when a delete stopped it'

const RESTART_WAKE_GAP_MS = 5_000

const WALLS_READ_FOR_MS = 5_000

const AFTER_THE_RESET_MS = 30_000

const LOOK_AT_THE_LIMIT_AGAIN_MS = 10 * 60_000

const RESTART_STOPPED_WITHIN_MS = 24 * 60 * 60_000

const NEWER_WORDS_ABOUT_WHAT_THE_RESTART_STOPPED =
  'newer words about the background work a restart stopped took their place when this app started again'

const ITS_REOPEN_ON_THE_NEW_LOGIN_FAILED =
  'this app could not reopen this conversation on the current login, so these words were not sent'

const ITS_START_AFTER_THE_RESTART_FAILED =
  'this app could not start this conversation again after the restart, so these words were not sent'

export function backgroundTheRestartStoppedText(
  stopped: readonly string[],
  endedAt: number,
  now: number,
): string {
  return (
    `The app restarted at ${clockTimeFrom(endedAt, now)} and stopped your background work: ` +
    `${theStoppedWork(stopped)}. Start it again if it’s still needed.`
  )
}

const A_CUT_TURN_IS_CONTINUED_WITHIN_MS = 60 * 60_000

const A_PROGRAM_IS_STARTED_AGAIN_AFTER_MS = 60_000

const A_LIMIT_IS_WAITED_FOR_AT_MOST_MS = 24 * 60 * 60_000

const AUTOMATIC_CONTINUATIONS_IN_A_ROW = 2

function continuationsInARow(before: CutRecord | undefined, aContinuation: boolean): number {
  if (!aContinuation) return 0
  return before?.state === 'sent' ? (before.inARow ?? 0) + 1 : 1
}

const LIMIT_WAKES_APART_MS = 2 * 60_000

const ACCOUNT_LOOK_EVERY_MS = 50

export function aTurnTheAppCutText(
  kind: CutKind,
  cutAt: number,
  now: number,
  provider: Provider,
): string {
  const at = clockTimeFrom(cutAt, now)
  const then = 'Check what already happened, then continue.'
  switch (kind) {
    case 'quit':
      return `The app restarted at ${at} during your turn. ${then}`
    case 'crash':
      return `The app stopped unexpectedly during your turn (last seen at ${at}). ${then}`
    case 'program':
      return `${providerDescriptor(provider).programName} stopped unexpectedly at ${at} during your turn. ${then}`
    case 'limit':
      return `Your turn stopped at ${at} when the usage limit was reached. The limit has reset. ${then}`
  }
}

function theTurnWasCut(kind: CutKind, turn: TurnAsItEnded, generation: number): boolean {
  if (turn.generation !== generation || turn.stopAsked) return false
  switch (kind) {
    case 'quit':
      return turn.ending === 'unknown' || (turn.ending === 'interrupted' && turn.theAppsWord)
    case 'crash':
      return turn.ending === 'unknown'
    case 'program':
      return (
        !turn.refused &&
        !turn.endedOnALimit &&
        (turn.ending === 'unknown' || (turn.ending === 'failed' && turn.theAppsWord))
      )
    case 'limit':
      return !turn.refused && turn.endedOnALimit
  }
}

const STARTS_WITH_NO_WORD_OF_A_JOB = 3

const AT_ONCE_START_GAPS = 4

interface RunOwed {
  readonly job: string
  readonly making: string
  readonly runAt: number
  readonly startAt: number
  readonly unanswered: number
}

interface OwedToItsJobs {
  readonly admission: WakeAdmissionPlan
  readonly runs: readonly RunOwed[]
  readonly itsRuns: ReadonlyMap<string, number | undefined>
  readonly notStarted: ReadonlyMap<string, NotStartedBecause>
  readonly words: readonly WordOwed[]
}

interface PlannedWake {
  readonly plan: ReceiptSchedulePlan
  readonly admission: WakeAdmissionPlan
  readonly runs: readonly RunOwed[]
  readonly words: readonly WordOwed[]
  readonly startAt: number | null
  readonly level: ScheduleLevel
}

function itsRepeatingJobsOfKnownTime(plan: ReceiptSchedulePlan): {
  readonly job: string
  readonly making: string
  readonly schedule: string
  readonly state: ReceiptSchedulePlan['states'][number]
}[] {
  return plan.wake.plans.flatMap(({ job, result }) => {
    if (job.recurring !== true || result.kind !== 'known' || job.schedule === undefined) return []
    const state = plan.states.find((one) => one.generation.generation === job.evidence?.generation)
    if (state === undefined || state.age === 'expired') return []
    return [{ job: job.id, making: aJobsMaking(state.generation), schedule: job.schedule, state }]
  })
}

function theRunAfter(
  schedule: string,
  after: number,
  calendar: CalendarSource,
): number | undefined {
  const next = nextCronOccurrence(schedule, { after, inclusive: false, zone: 'UTC', calendar })
  return next.kind === 'known' ? next.nominalAt : undefined
}

const NOTHING_DONE_FOR_ITS_JOBS: ConversationAttempts = {
  attempts: [],
  admittedAt: null,
  told: [],
  runs: {},
  notStartedSaid: {},
  at: 0,
}

const theJobsItWasToldOf = (kept: ConversationAttempts): ReadonlySet<string> =>
  new Set(kept.told.filter((one) => one.said).map((one) => one.of))

interface WakeUp {
  level: ScheduleLevel
  admission: WakeAdmissionPlan
  runs: readonly RunOwed[]
  holdFor: number | null
  startAt: number
  readonly forATimeAhead: boolean
  failed: number
  waitingForItsKey: Provider | null
  timer: ReturnType<typeof setTimeout> | null
  readonly lastLifeEnded: Promise<unknown>
}

interface OneLook {
  readonly sink: RuntimeEventSink
}

function livenessFor(
  session: HostedSession,
  disclosures = sessionDisclosures(session),
): SessionLiveness {
  return { ...session.liveness.current, ...disclosures }
}

const TURN_ENDINGS: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'idle',
  'ended',
  'errored',
])

const NO_INSTRUCTIONS: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

export type UpdateWorkOutcome =
  | ({
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly owner: string
      readonly title: string | null
      readonly status: string | null
      readonly rebriefed: boolean
      readonly definitionOfDone?: string | null
      readonly kept: readonly {
        readonly resource: string
        readonly name: string
        readonly role: ResourceRole
      }[]
      readonly closed: {
        readonly tookBackTheMessage: boolean
        readonly endedQuestions: number
      } | null
      readonly askedItsTurnToStop: boolean
      readonly atAService: boolean
    } & (Told<NewBriefDelivery> | { readonly delivery: null }))
  | {
      readonly ok: false
      readonly rail: Exclude<ToolRefusal, 'that-piece-has-ended' | TheCopiesRefusal>
      readonly detail: Readonly<Record<string, unknown>>
    }
  | {
      readonly ok: false
      readonly rail: TheCopiesRefusal
      readonly detail: {
        readonly piece: string
        readonly label: string
        readonly unreadQuestion?: UnreadQuestion
      }
    }
  | {
      readonly ok: false
      readonly rail: 'that-piece-has-ended'
      readonly detail: EndedPieceDetail
      readonly readAt: number
    }
  | { readonly ok: false; readonly resourceRefusal: ResourceRefusal }

export type TakeOnWorkOutcome =
  | {
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly title: string
      readonly root: string
      readonly notice: 'sent' | 'held' | 'not-delivered' | null
      readonly queued: boolean
    }
  | { readonly ok: false; readonly resourceRefusal: ResourceRefusal }
  | {
      readonly ok: false
      readonly rail: Extract<
        ToolRefusal,
        'malformed-request' | 'no-work-of-your-own' | 'work-record-unavailable'
      >
      readonly detail: Readonly<Record<string, unknown>>
    }

export type CreateAgentOutcome =
  | {
      readonly ok: true
      readonly identity: AgentIdentity
      readonly rules: OwnInstructionsVersion | null
      readonly defaultModel: AgentModelChoice | null
    }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type MayCreateAgents =
  | {
      readonly ok: true
      readonly creator: IdentityCreator
    }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type ProposeRulesOutcome =
  | { readonly ok: true; readonly wrote: 'a-request'; readonly askId: string }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type AgentOwnNotesOutcome<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type AgentRulesOutcome<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export type McpServerRequestOutcome =
  | { readonly ok: true; readonly requestId: string }
  | {
      readonly ok: false
      readonly rail: ToolRefusal
      readonly detail: Readonly<Record<string, unknown>>
    }

export interface McpServerAsked {
  readonly name: string
  readonly url: string
  readonly reaches: string
  readonly whoGetsIt: McpServerRequestWho
  readonly agents: readonly string[]
  readonly piece: string | null
}

function nameIsTaken(slug: string): string {
  return (
    `There is already an agent called ${foldProfileName(slug)}. An agent's name is its identity, ` +
    'so it cannot be reused — and names are compared without case, because a profile is its folder.'
  )
}

type HowItWasTakenBack =
  { readonly reason: 'cancelled' } | { readonly reason: 'retracted'; readonly detail: string }

function sayTheSweep(settled: number, skipped: RowsUnread, line: string): void {
  if (settled === 0 && skipped.ledgersSkipped === 0) return
  console.info(
    skipped.ledgersSkipped === 0
      ? line
      : `${line}; ${String(skipped.ledgersSkipped)} ledger(s) skipped`,
  )
}

const TURN_AS_SENT_PAGE = 2_000

const NO_LONGER_WAITING = 'the agent is no longer waiting for an answer to this'

type SetAsideFor = 'archive' | 'delete' | 'its-files'

const SET_ASIDE_FOR: Readonly<Record<SetAsideFor, string>> = {
  archive: ' is being archived',
  delete: ' is being deleted',
  'its-files': '’s transcript is being deleted',
}

interface BringingBack {
  readonly others: readonly string[]
  readonly archivedAt: ReadonlyMap<string, number>
  readonly saying: string
}

function tieInWords(how: TiedOutside['how'], here: string, other: string): string {
  switch (how) {
    case 'gave-it-work':
      return `${other} gave work to ${here}`
    case 'holds-work-it-gave':
      return `${other} holds work that ${here} gave it`
    case 'wrote-to-it':
      return `${other} wrote to ${here}`
    case 'asked-it':
      return `${other} asked ${here} a question`
    case 'added-files-to-its-work':
      return `${here} added files to ${other}’s work`
    case 'gave-it-a-piece-below':
      return `${other} holds work that hangs below ${here}’s`
  }
}

interface OwnedWait {
  readonly ownerId: string
  readonly launchKey: string | null
  released: boolean
  cancelled: boolean
  handedOver: boolean
  readonly stopped: Promise<void>
  readonly stop: () => void
}

export class RuntimeHost implements LiveHost {
  private readonly signIns = new Map<string, { profileId: string; signIn: ProviderSignIn }>()
  private readonly profilesBeingCreated: string[] = []
  private readonly ownedWaits = new Set<OwnedWait>()
  private readonly slots = new Map<string, SessionSlot>()
  private readonly launches = createLaunchRegistry()
  private readonly archives = createArchiveCoordinator()
  private readonly closeDrainTimeoutMs: number
  private readonly interruptWaitMs: number
  private readonly reopenLeadsGraceMs: number
  private readonly recordStartAttempt: ((line: StartAttemptLine) => void) | undefined
  private readonly monotonicNow: () => number
  private readonly deliveryWaitMs: number
  private readonly endingWaitMs: number
  private readonly commandListWaitMs: number
  private readonly afterALimitResetsMs: number
  private readonly lookAtTheLimitAgainMs: number
  private readonly conversationIdle: ConversationIdle
  private readonly startGapMs: number
  private readonly archived: ArchivedConversations
  private readonly workSearch: WorkSearch
  private readonly settingAside = new Map<string, SetAsideFor>()
  private readonly whatBringsItBack = new Map<string, string>()
  private readonly bringingBack = new Map<string, BringingBack>()
  private readonly deliveriesInFlight = new WeakMap<HostedSession, Set<Promise<void>>>()
  private readonly keptFiles: KeptFiles
  private readonly now: () => number
  private readonly modelCatalogues: ModelCatalogues

  private readonly building = new Map<string, number>()

  private readonly upSince: number

  private readonly startsInFlight = new Map<string, Promise<string>>()

  private readonly signInReopens: ReopenQueue
  private readonly signInStops = new Set<HostedSession>()
  private readonly signInRestarts = new WeakSet<HostedSession>()

  private readonly replacedBy = new Map<string, string>()

  private readonly statesToAsk = new Set<string>()

  private flushAsked = false

  private readonly filesToSay: { readonly piece: string; readonly resources: readonly string[] }[] =
    []

  private readonly stateSaid = new Map<string, string>()

  private readonly waitAsLastRead = new Map<string, ItsLedger>()

  private readonly workOutAsLastRead = new Map<string, readonly PieceRow[]>()

  private readonly contextAsLastRead = new Map<
    string,
    { readonly through: number; readonly context: LastReported['context'] }
  >()

  private readonly heldAsLastRead = new Map<string, ReadonlyMap<string, string>>()

  private readonly waitsOnTheAnswerOf = new Map<string, string>()

  private readonly waitsOnTheWorkOf = new Map<string, readonly string[]>()

  private readonly owesTheAnswersOf = new Map<string, readonly string[]>()

  private readonly owedAsLastRead = new Map<string, readonly OwedQuestion[]>()

  private routedTo: Map<string, Set<string>> | null = null
  private listingVersion = 0
  private listingKept:
    | {
        readonly at: number
        readonly resumable: ResumableSessionInfo[]
        readonly unresumable: UnresumableSessionInfo[]
        readonly complete: boolean
      }
    | undefined
  private readonly listingAnswersKept = new Map<
    string,
    { readonly at: number; readonly value: unknown }
  >()
  private personsVersion = 0
  private publicationEpoch: PublicationEpoch = { run: randomUUID(), n: 0 }
  private publicationSeq = 0
  private copySliceRows: number = COPY_SLICE_ROWS.first
  private copyBusyWait: number = COPY_BUSY_WAIT_MS.least
  private readonly copiesFilled = { visited: 0, matched: 0, saidAt: Number.NEGATIVE_INFINITY }
  private nextTimeBoundary = Number.POSITIVE_INFINITY
  private readonly personsKept = new Map<string, { readonly at: number; readonly value: unknown }>()
  private stopHearingCommits: () => void = () => undefined

  private rosterAsLastAnnounced: readonly AgentIdentity[] | null = null

  private readonly wakeUps = new Map<string, WakeUp>()

  private readonly wakingForItsJobs = new Set<string>()

  private readonly scheduleEvidence = new Map<string, ScheduleEvidence>()

  private attemptsKept: KeptAttempts = NO_ATTEMPTS_KEPT
  private keptProfileExecution: ProfileExecutionRead = {
    readable: true,
    kept: NO_PROFILE_EXECUTION,
  }
  private workerReadings: ReadonlyMap<string, WorkerBindingReading> = new Map()
  private readonly workerTerminals = new Map<string, string | null>()
  private get profileExecution(): ProfileExecutionRead {
    return this.keptProfileExecution
  }
  private set profileExecution(read: ProfileExecutionRead) {
    this.keptProfileExecution = read
    this.refreshWorkerReadings()
  }
  private refreshWorkerReadings(recheck = false): void {
    this.moveTheListing()
    if (recheck) this.workerTerminals.clear()
    const read = this.keptProfileExecution
    if (!read.readable) {
      this.workerTerminals.clear()
      this.workerReadings = new Map()
      return
    }
    const keptBirths = new Set<string>()
    this.workerReadings = indexWorkerReadings(read.kept, new Map(), (birth) => {
      keptBirths.add(birth)
      if (!this.workerTerminals.has(birth)) {
        let terminal: string | null
        try {
          terminal = this.completeWorkerTerminal(birth)
        } catch {
          terminal = null
        }
        this.workerTerminals.set(birth, terminal)
      }
      return this.workerTerminals.get(birth)!
    })
    for (const birth of this.workerTerminals.keys()) {
      if (!keptBirths.has(birth)) this.workerTerminals.delete(birth)
    }
  }
  private workerFields(conversation: string): { readonly worker?: WorkerBindingReading } {
    const worker = this.workerReadings.get(conversation)
    return worker === undefined || this.profileExecutionConflicts.includes(worker.identity)
      ? {}
      : { worker }
  }
  private profileExecutionConflicts: readonly string[] = []
  private readonly normalWorkerLeases = new NormalWorkerLeases()
  private reservingNormalWorker: {
    readonly conversation: string
    readonly fact: WorkerBorn
  } | null = null
  private readonly normalWorkerBirths = new Map<string, WorkerBorn>()

  private calendarRead: {
    readonly zone: LocalZone | null
    readonly calendar: CalendarSource
  } | null = null

  private readonly startComingAfterTheRestart = new Set<string>()
  private readonly aReopenIsBeingDecidedFor = new Map<string, number>()

  private readonly renewedForItsReopen = new Set<string>()
  private readonly reopenedOnAReplacedCopy = new Set<string>()
  private readonly answersOnTheirWay = new Set<string>()
  private readonly providerLimitFacts = new CurrentProviderLimitFacts()
  private readonly providerLimitLives = new Map<
    string,
    { readonly provider: Provider; readonly life: object }
  >()
  private providerLimitsPrepared = false
  private providerLimitsPublicationAsked = false
  private providerLimitsAllMoved = false
  private readonly providerLimitsMoved = new Set<string>()
  private readonly providerBlockSaid = new Map<string, string>()
  private providerLimitEpoch = 0
  private providerLimitsPreparationPending = false
  private providerLimitsOperation = 0
  private providerLimitExpiry: ReturnType<typeof setTimeout> | null = null
  private readonly providerLimitHistoryDeadlines = new WeakMap<object, number>()

  private wallsForTheHold: {
    readonly at: number
    readonly rows: readonly ProviderLimitSeen[]
  } | null = null
  private readonly theResets = new Map<
    Provider,
    { readonly at: number; readonly timer: ReturnType<typeof setTimeout> }
  >()
  private readonly signInChangedAt = new Map<Provider, number>()
  private readonly notStalledAtTheLaunch = new Set<string>()
  private readonly wakingForStoppedWork = new Set<string>()
  private restartWakes: Promise<void> = Promise.resolve()
  private workReconciler: WorkReconciler | undefined
  private reconciliationTimer: ReturnType<typeof setInterval> | undefined
  private lastPacedStart = Number.NEGATIVE_INFINITY
  private cutsKept: KeptCuts = NO_CUTS_KEPT
  private cutsAreReadable = true
  private readonly cutsThisLaunchContinues = new Set<string>()
  private readonly itsIdentity = new WeakMap<HostedSession, Promise<string | null>>()
  private readonly identityKnown = new WeakMap<HostedSession, string | null>()
  private readonly limitAccountLives = new Map<string, Map<number, string | null>>()
  private readonly cutStartedTheLife = new WeakSet<HostedSession>()
  private readonly lifeLaunched = new WeakMap<
    HostedSession,
    { readonly generation: number; readonly launched: number }
  >()
  private readonly aTurnWentIn = new WeakSet<HostedSession>()
  private readonly cutHoldsTheFirstBatch = new Set<string>()
  private readonly continuationLife = new Map<string, HostedSession>()
  private readonly aProgramStartsAgainAfterMs: number
  private readonly limitWakesApartMs: number
  private readonly limitLines = new Map<Provider, Promise<void>>()
  private readonly lastLimitWake = new Map<Provider, number>()
  private readonly limitWakesPlanned = new Set<string>()
  private readonly watchingTheCut = new Map<string, RuntimeEventSink>()
  private readonly itsStreamBroke = new WeakSet<HostedSession>()
  private readonly sparedAtTheLaunch = new Map<string, string>()
  private readonly wordsHeld = new Map<string, readonly ToldNotice[]>()
  private readonly lookingAtItsRecord = new Map<string, Map<string, OneLook>>()
  private readonly startsReserved = new Map<string, ConversationAttempts>()
  private readonly wakeUpsDue = new Map<string, WakeUp>()
  private aWakeUpHoldsATurn = false
  private readonly reopeningForWhatWaited = new Set<string>()
  private readonly reopeningForApprovedTools = new Set<string>()
  private readonly mcpServerRequestsBeingDecided = new Set<string>()
  private readonly usage = new Map<Provider, Map<string, KeptReading>>()
  private knownAccount: KnownAccount | null = null
  private knownAccounts: readonly KnownAccount[] = []
  private readonly usageReadOn = new Map<
    Provider,
    { readonly tag: string; readonly lifeSince: number }
  >()
  private readonly usageUnconfirmed = new Set<Provider>()
  private readonly windowsSeen = new Map<Provider, Map<string, UsageWindowSeen>>()
  private aWindowFirstSeenUnkept = false
  private resourcesMeasured: {
    readonly settledAt: number
    readonly answer: Readonly<Record<Provider, ProviderResources>>
  } | null = null
  private resourcesMeasuring: Promise<Readonly<Record<Provider, ProviderResources>>> | null = null

  private readonly startingForADeliveryWithNoWindow = new Set<string>()

  private reservingAReplacementWithNoWindow = false

  private reservingAReplacementFor: string | null = null

  private reservingAStartFrom: string | null = null

  private readonly arrivals = new Map<string, Promise<void>>()

  private readonly askAgainOnceItArrived = new Set<string>()

  private readonly providerFailedWith = new Map<string, string>()

  private readonly heldAtAStop = new Map<string, QueuedMessage[]>()

  private readonly servicesToAdvance = new Set<string>()

  private readonly servicesStarting = new Set<string>()

  private readonly servicesHeldBack = new Set<string>()

  private readonly piecesTheCutsWereOn = new Map<string, string>()

  private readonly stopsOnTheirWay = new Map<HostedSession, number>()

  private readonly servicesReadingAPair = new Set<string>()

  private readonly pairsReadForTheHead = new Map<
    string,
    { piece: string; life: HostedSession } & ({ pair: ModelAndEffort } | { failed: string })
  >()

  private readonly answeredInThisRun = new Map<string, 'answered' | 'rejected'>()

  private readonly firstMessagesInFlight = new Set<string>()

  get themes(): RuntimeHostDeps['themes'] {
    return this.deps.themes
  }

  private readonly personsQuestions: PersonsQuestions
  private readonly windowRoutingReads = new WindowRoutingReads()
  private readonly windowIncidentReads = new WindowIncidentReads(
    () => this.sampleWindowWriter({ kind: 'routes' }),
    () => this.deps.limitsWriterStamp?.() ?? null,
  )
  private readonly ledgerIdentity: object
  private windowReadCallers = 0
  private windowRoutesPending:
    { readonly stamp: WindowWriterStamp; readonly read: Promise<WindowReadResult> } | undefined
  private windowRoutesKept:
    { readonly stamp: WindowWriterStamp; readonly result: WindowReadResult } | undefined
  private windowIncidentsPending:
    { readonly stamp: WindowWriterStamp; readonly read: Promise<WindowReadResult> } | undefined
  private lastIncidentMainReadAt: number | undefined
  private readonly windowReadsFailed = new Map<
    'routes' | 'incidents',
    {
      readonly stamp: WindowWriterStamp
      readonly missed: WindowReadMissed
      readonly wait: number
      readonly until: number
    }
  >()
  private windowIncidentsKept:
    { readonly stamp: WindowWriterStamp; readonly result: WindowReadResult } | undefined
  private readonly windowReadMisses = new Map<
    WindowReadMiss,
    { readonly count: number; readonly saidAt: number }
  >()

  private readonly workReads: WorkReads

  constructor(private readonly deps: RuntimeHostDeps) {
    this.ledgerIdentity = deps.store
    this.deps = {
      ...deps,
      store: this.windowRoutingReads.store(this.windowIncidentReads.store(deps.store)),
    }
    this.workReads = new WorkReads({
      store: this.deps.store,
      oneWaitReadPerAnswer: (unread) => this.oneWaitReadPerAnswer(unread),
      theIdsItStandsFor: (sessionId) => this.theIdsItStandsFor(sessionId),
      withItsPlaceInTheQueue: (row) => this.withItsPlaceInTheQueue(row),
      pieceNamed: (spelled) => this.pieceNamed(spelled),
      ofOneIdentity: (one, other) => this.ofOneIdentity(one, other),
      childrenOnTheRecord: (piece, waiting, unread) =>
        this.childrenOnTheRecord(piece, waiting, unread),
      theExchangeShownWith: (piece) => this.theExchangeShownWith(piece),
      spawnEdge: (conversation) => this.spawnEdge(conversation),
      runningStateOf: (sessionId) => this.runningStateOf(sessionId),
      markedForAPerson: (edges) => this.markedForAPerson(edges),
      lastReportedOf: (conversations) => this.lastReportedOf(conversations),
    })
    this.signInReopens = new ReopenQueue(deps.mainThreadWork)
    if (deps.mainThreadWork !== undefined) {
      this.deliver = this.timedMethod('runtime provider event delivery', this.deliver)
      this.emit = this.timedMethod('runtime conversation event send', this.emit)
      this.publishStateIfChanged = this.timedMethod(
        'runtime liveness build and send',
        this.publishStateIfChanged,
      )
      this.sayWhatMoved = this.timedMethod('runtime state flush', this.sayWhatMoved)
      this.statesThatMoved = this.timedMethod('runtime state building', this.statesThatMoved)
      this.whatWasKept = this.timedMethod('runtime kept-file building', this.whatWasKept)
      this.noteASignInChange = this.timedMethod('runtime sign-in change', this.noteASignInChange)
      this.aReopenIsDecided = this.timedMethod(
        'runtime sign-in reopen completion',
        this.aReopenIsDecided,
      )
      this.reopenForWhatWaits = this.timedMethod(
        'runtime sign-in reopen scheduling',
        this.reopenForWhatWaits,
      )
      this.providersMoved = this.timedMethod(
        'runtime provider change delivery',
        this.providersMoved,
      )
      this.whatWaitedForTheSignInBeforeGoes = this.timedMethod(
        'runtime sign-in held-work release',
        this.whatWaitedForTheSignInBeforeGoes,
      )
      this.recordMemoryNotes = this.timedMethod('runtime memory-note scan', this.recordMemoryNotes)
    }

    this.archived = deps.archived ?? archivedInMemory()
    this.workSearch = new WorkSearch(this.deps, this.launches, this.archived)
    this.personsQuestions = new PersonsQuestions({
      store: this.deps.store,
      shown: (walk, conversationOf) => this.shown(walk, conversationOf),
      oneNamingPerAnswer: () => this.oneNamingPerAnswer(),
      onePieceReadPerAnswer: () => this.onePieceReadPerAnswer(),
      oneWorkReadPerAnswer: (pieces) => this.oneWorkReadPerAnswer(pieces),
      oneQuestionReadPerAnswer: () => this.oneQuestionReadPerAnswer(),
      cardIdentity: (askedBy) => {
        const slot = this.slots.get(askedBy)
        if (slot === undefined || slot.ownerId !== null || slot.session === null) return null
        return { provider: slot.session.provider, profileId: slot.session.profileId }
      },
    })
    this.closeDrainTimeoutMs = deps.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS
    this.interruptWaitMs = deps.interruptWaitMs ?? DEFAULT_INTERRUPT_WAIT_MS
    this.reopenLeadsGraceMs = deps.reopenLeadsGraceMs ?? DEFAULT_REOPEN_LEADS_GRACE_MS
    this.recordStartAttempt = deps.recordStartAttempt
    this.monotonicNow = deps.monotonicNow ?? (() => performance.now())
    this.deliveryWaitMs = deps.deliveryWaitMs ?? DEFAULT_DELIVERY_WAIT_MS
    this.endingWaitMs = deps.endingWaitMs ?? A_DECISION_WAITS_FOR_A_START_MS
    this.commandListWaitMs = deps.commandListWaitMs ?? DEFAULT_COMMAND_LIST_WAIT_MS
    this.afterALimitResetsMs = deps.afterALimitResetsMs ?? AFTER_THE_RESET_MS
    this.lookAtTheLimitAgainMs = deps.lookAtTheLimitAgainMs ?? LOOK_AT_THE_LIMIT_AGAIN_MS
    this.conversationIdle = new ConversationIdle(
      {
        closed: () => this.launches.closed,
        isStillIdle: (conversation) => {
          const state = this.stateOf(
            conversation,
            this.cardReads(),
            rowsUnreadOnce(),
            this.waitAsLastRead.get(conversation),
            this.workOutAsKept(this.oneWorkOutReadPerAnswer(rowsUnreadOnce())),
            this.owedAsKept(
              this.oneOwedReadPerAnswer(
                this.ledgerAsKept(this.oneLedgerReadPerAnswer(rowsUnreadOnce())),
              ),
            ),
          )
          return this.idleEnoughToStop(conversation, state)
        },
        close: (conversation) => this.close(conversation, THE_APP_ITSELF),
        errorMessage,
      },
      deps.idleStopAfterMs,
    )
    this.startGapMs = deps.startGapMs ?? RESTART_WAKE_GAP_MS
    this.aProgramStartsAgainAfterMs =
      deps.aProgramStartsAgainAfterMs ?? A_PROGRAM_IS_STARTED_AGAIN_AFTER_MS
    this.limitWakesApartMs = deps.limitWakesApartMs ?? LIMIT_WAKES_APART_MS
    this.now = deps.now ?? Date.now
    this.keptFiles = new KeptFiles(this.deps, {
      theIdsItStandsFor: (id) => this.theIdsItStandsFor(id),
      pieceNamed: (spelled) => this.pieceNamed(spelled),
      keptFileOf,
      now: () => this.now(),
      isClosed: () => this.launches.closed,
      theWorldMoved: (kind) => this.theWorldMoved(kind),
      handBackTheMainProcess,
    })
    this.modelCatalogues = new ModelCatalogues(
      this.deps.store,
      (provider) => this.profiles(provider),
      (provider, profileId) => this.askProviderForModels(provider, profileId),
      () => this.launches.closed,
      (conversation) => this.theProviderOfConversation(conversation),
      () => this.now(),
      () => this.theWorldMoved('agents'),
      errorMessage,
    )
    deps.limitsReader?.observeReads({
      before: () => ({
        epoch: this.providerLimitEpoch,
        stamp: deps.limitsWriterStamp?.() ?? null,
      }),
      completed: (input, result, token) => this.acceptWorkerProviderLimits(input, result, token),
      scopeChanged: (change) => {
        if (change.why === 'unavailable') return
        this.providerLimitFacts.retireHistory()
        this.publishProviderLimitFactsSoon()
      },
    })
    this.takeTheKeptUsage()
    this.takeTheKeptAttempts()
    this.takeTheProfileExecution()
    this.takeTheKeptCuts()
    this.takeTheKnownAccount()
    try {
      const now = this.now()
      let setAside = false
      for (const [provider, at] of deps.signInChanges?.read() ?? []) {
        if (at > now) {
          console.warn(
            `runtime host set aside the ${provider} sign-in change kept for ${new Date(at).toISOString()}, which is still ahead of this clock`,
          )
          setAside = true
          continue
        }
        this.signInChangedAt.set(provider, at)
      }
      if (setAside) {
        try {
          deps.signInChanges?.write(this.signInChangedAt)
        } catch (error) {
          console.warn(`runtime host could not keep the sign-in changes: ${errorMessage(error)}`)
        }
      }
    } catch (error) {
      console.warn(`runtime host could not read the sign-in changes kept: ${errorMessage(error)}`)
    }
    joinLiveHosts(this)
    const elsewhere = workRunningElsewhere(this)
    const launchedAt = this.now()
    if (elsewhere.size > 0) {
      console.info(
        `runtime host: ${elsewhere.size} session(s) are being run by another live host in this ` +
          `process and are left exactly as they are`,
      )
    }
    const orphans = this.deps.store.clearOrphanBuilds(elsewhere)
    if (orphans > 0) {
      console.info(
        `derived generations: cleared ${orphans} rebuild marker(s) left by a previous run`,
      )
    }
    const leftRunning = this.whatACrashLeftRunning(elsewhere)
    const stranded = this.deps.store.settleOrphanRuns(this.now(), elsewhere)
    if (stranded > 0) {
      console.info(`sessions: settled ${stranded} left mid-run by a previous run`)
    }
    const messagesSkipped = rowsUnreadOnce()
    const stillOpen = new Set([...elsewhere, ...this.deps.store.whatTheQuitClosed()])
    const waiting = this.deps.store.settleStrandedMessages(this.now(), stillOpen, messagesSkipped)
    sayTheSweep(
      waiting,
      messagesSkipped,
      `messages: settled ${waiting} left waiting to be sent by a previous run`,
    )
    const askedSkipped = rowsUnreadOnce()
    const asked = this.deps.store.settleStrandedRequests(this.now(), stillOpen, askedSkipped)
    sayTheSweep(
      asked,
      askedSkipped,
      `questions: settled ${asked} left waiting for an answer by a previous run`,
    )
    const undrivenSkipped = rowsUnreadOnce()
    const listening = this.deps.statesMoved !== undefined
    const levels = listening ? this.theScheduleLevelsAtTheLaunch() : null
    const wokenForAJob = this.whoAWakeUpWillStartForAJob(elsewhere, levels)
    for (const one of wokenForAJob) this.notStalledAtTheLaunch.add(one)
    const diedInTheBackground = new Set<string>()
    const continuing = listening
      ? this.theCutsToContinue(leftRunning, launchedAt)
      : new Set<string>()
    const undriven = this.deps.store.settleRestartedWork(
      this.now(),
      elsewhere,
      undrivenSkipped,
      wokenForAJob,
      diedInTheBackground,
      continuing,
    )
    sayTheSweep(
      undriven,
      undrivenSkipped,
      `pieces: ${undriven} conversation(s) held work a previous run did not finish`,
    )
    this.upSince = this.now()
    try {
      for (const one of this.deps.store.replacements()) this.replacedBy.set(one.replaced, one.by)
      this.refreshWorkerReadings()
    } catch (error) {
      console.warn(
        `runtime host could not read which conversations were replaced: ${errorMessage(error)}`,
      )
    }
    if (listening) {
      try {
        this.rosterAsLastAnnounced = this.deps.store.agentIdentities()
      } catch (error) {
        console.warn(`runtime host could not read who its agents are: ${errorMessage(error)}`)
      }
      this.armTheWakeUpsTheLedgerHolds(elsewhere, levels)
      this.wakeWhatTheRestartStopped([...diedInTheBackground], elsewhere, launchedAt)
      this.continueTheCutTurns(continuing, elsewhere)
    }
    if (this.servicesAreOn()) {
      try {
        for (const one of this.deps.store.servicesBorn()) {
          if (elsewhere.has(one.conversation)) continue
          this.aServiceMayTakeItsNext(one.conversation)
          this.startForWhatWaits(one.conversation)
        }
      } catch (error) {
        console.warn(
          `runtime host could not read which conversations serve: ${errorMessage(error)}`,
        )
      }
    }
    this.workReconciler = new WorkReconciler({
      pieces: (holders) => this.reconciliationReading(undefined, holders).rows,
      receiptsFor: (pieces) => this.reconciliationReceiptsFor(pieces),
      receipts: (piece) => {
        const work = this.deps.store.workById(piece)
        return work === null ? [] : this.deps.store.reconciliationReceipts(work.owner, piece)
      },
      keep: (owner, event) => this.keepReconciliation(owner, event),
      progress: (receipt) =>
        this.deps.store.reconciliationDelivery(receipt.target!, receipt.messageId!),
      deliver: (piece, receipt) => this.deliverReconciliation(piece, receipt),
      id: () => randomUUID(),
      now: () => this.now(),
    })
    void (deps.afterFirstWindowLoad ?? Promise.resolve()).then(() => {
      if (this.launches.closed) return
      this.reconciliationTimer = setInterval(() => this.reconcileWork(), WORK_RECONCILIATION_MS)
      this.reconciliationTimer.unref?.()
      setImmediate(() => this.reconcileWork())
    })
    this.stopHearingCommits = this.deps.store.onCommitted((change) => this.heardACommit(change))
  }

  private whoAWakeUpWillStartForAJob(
    elsewhere: ReadonlySet<string>,
    levels: ScheduleLevelsAtTheLaunch | null,
  ): ReadonlySet<string> {
    const woken = new Set<string>()
    if (levels === null) return woken
    try {
      const now = this.now()
      for (const { conversation, level } of levels) {
        if (elsewhere.has(conversation)) continue
        if (this.aStoppedConversation(conversation) === null) continue
        const planned = this.planItsWake(conversation, now, level)
        if (planned === null) continue
        if (planned.startAt !== null && planned.plan.notices.length === 0) {
          woken.add(conversation)
        }
      }
    } catch (error) {
      console.warn(`runtime host could not read which jobs it will wake: ${errorMessage(error)}`)
    }
    return woken
  }

  private wakeWhatTheRestartStopped(
    died: readonly string[],
    elsewhere: ReadonlySet<string>,
    launchedAt: number,
  ): void {
    let found: ReturnType<SessionStore['backgroundTheRestartStopped']>
    try {
      found = this.deps.store.backgroundTheRestartStopped(
        died,
        launchedAt,
        launchedAt - RESTART_STOPPED_WITHIN_MS,
      )
    } catch (error) {
      console.warn(
        `runtime host could not read what the restart stopped in the background: ${errorMessage(error)}`,
      )
      return
    }
    const now = this.now()
    for (const { conversation, stopped, endedAt } of found) {
      try {
        if (elsewhere.has(conversation) || this.startable(conversation) === null) continue
        if (this.archived.has(conversation)) continue
        this.letGoOfItsMissedJobs(
          conversation,
          NEWER_WORDS_ABOUT_WHAT_THE_RESTART_STOPPED,
          'background-work-a-restart-stopped',
        )
        this.holdUntilItStarts(
          conversation,
          backgroundTheRestartStoppedText(stopped, endedAt, now),
          { appNotice: 'background-work-a-restart-stopped' },
        )
        this.startComingAfterTheRestart.add(conversation)
        this.restartWakes = this.restartWakes.then(() => this.wakeForStoppedWork(conversation))
      } catch (error) {
        console.warn(
          `runtime host could not plan ${conversation}'s start after the restart: ${errorMessage(error)}`,
        )
      }
    }
  }

  private stallWhatItsJobWouldHaveDriven(conversation: string): void {
    if (!this.notStalledAtTheLaunch.delete(conversation)) return
    try {
      const held = this.deps.store
        .piecesOwnedBy(conversation)
        .filter((piece) => piece.state === 'working' && piece.inTheBackground !== undefined)
        .map((piece) => piece.piece)
      if (held.length === 0 || this.slots.has(conversation)) return
      this.deps.store.restartedWorkLate(conversation, held, this.now())
      this.tellWhoeverGaveTheWork(conversation)
    } catch (error) {
      console.warn(
        `runtime host could not say what ${conversation}'s dropped wake-up leaves undriven: ${errorMessage(error)}`,
      )
    }
  }

  private async wakeForStoppedWork(conversation: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.startGapMs)
      timer.unref?.()
    })
    if (!this.startComingAfterTheRestart.has(conversation)) return
    const itsCut = this.aCutToContinue(conversation) ? this.cutsKept.cuts[conversation] : undefined
    try {
      if (this.launches.closed) return
      const aCutGoesNow = itsCut !== undefined && itsCut.kind !== 'limit'
      if (this.keptStopped(conversation)) {
        if (aCutGoesNow) this.notContinued(conversation, 'kept-stopped')
        return
      }
      if (!this.servicesAreOn() && this.itIsAService(conversation)) {
        if (aCutGoesNow) this.notContinued(conversation, 'a-service')
        return
      }
      console.info(
        `runtime host: starting ${conversation} — the restart stopped its background work`,
      )
      const andItsCut = aCutGoesNow && this.moveTheCut(conversation, 'starting')
      if (andItsCut) this.cutHoldsTheFirstBatch.add(conversation)
      else if (aCutGoesNow) this.notContinued(conversation, 'start-failed')
      this.wakingForStoppedWork.add(conversation)
      try {
        await this.ensureRunning(conversation, null)
      } finally {
        this.wakingForStoppedWork.delete(conversation)
      }
      if (andItsCut && itsCut !== undefined) {
        await this.continueOnItsLife(conversation, true, itsCut.noticeId)
      }
    } catch (error) {
      this.releaseTheFirstBatch(conversation)
      const record = this.cutsKept.cuts[conversation]
      if (record?.state === 'starting' && record.noticeId === itsCut?.noticeId) {
        this.notContinued(
          conversation,
          this.keptStopped(conversation) ? 'kept-stopped' : 'start-failed',
        )
      }
      if (this.keptStopped(conversation)) return
      console.warn(
        `runtime host could not start ${conversation} after the restart stopped its background work: ${errorMessage(error)}`,
      )
      this.letGoOfItsMissedJobs(
        conversation,
        ITS_START_AFTER_THE_RESTART_FAILED,
        'background-work-a-restart-stopped',
      )
    } finally {
      this.lastPacedStart = performance.now()
      if (!this.aProgramsWakeComes(conversation, itsCut?.noticeId)) {
        this.startComingAfterTheRestart.delete(conversation)
        try {
          this.tellWhoeverGaveTheWork(conversation)
        } catch (error) {
          console.warn(
            `runtime host could not ask who gave ${conversation} its work: ${errorMessage(error)}`,
          )
        }
      }
    }
  }

  private takeTheKeptCuts(): void {
    const kept = this.deps.turnsTheAppCut
    if (kept === undefined) return
    try {
      this.cutsKept = withoutOldCuts(kept.read(), this.now())
      this.cutsAreReadable = true
    } catch (error) {
      this.cutsAreReadable = false
      console.warn(`runtime host could not read the turns it cut: ${errorMessage(error)}`)
    }
  }

  private keepTheCuts(next: KeptCuts): boolean {
    const kept = this.deps.turnsTheAppCut
    if (kept === undefined) return false
    try {
      kept.write(next)
      this.cutsKept = next
      return true
    } catch (error) {
      console.warn(`runtime host could not keep the turns it cut: ${errorMessage(error)}`)
      return false
    }
  }

  private moveTheCut(conversation: string, state: CutState): boolean {
    const record = this.cutsKept.cuts[conversation]
    if (record === undefined) return false
    return this.keepTheCuts({
      ...this.cutsKept,
      cuts: { ...this.cutsKept.cuts, [conversation]: { ...record, state, at: this.now() } },
    })
  }

  private aCutToContinue(conversation: string): boolean {
    return (
      this.cutsThisLaunchContinues.has(conversation) &&
      this.cutsKept.cuts[conversation]?.state === 'pending'
    )
  }

  private whatACrashLeftRunning(elsewhere: ReadonlySet<string>): readonly LeftRunning[] {
    if (this.deps.turnsTheAppCut === undefined) return []
    try {
      return this.deps.store.whatACrashLeftRunning(elsewhere)
    } catch (error) {
      console.warn(`runtime host could not read what a crash left running: ${errorMessage(error)}`)
      return []
    }
  }

  private keepTheTurnsTheQuitCuts(closing: readonly HostedSession[]): void {
    if (this.deps.turnsTheAppCut === undefined) return
    try {
      const now = this.now()
      const cuts: Record<string, CutRecord> = { ...this.cutsKept.cuts }
      let found = false
      for (const session of closing) {
        if (session.handle.status() !== 'working' || session.stopStillAsked !== null) continue
        const turn = this.deps.store.theOpenTurn(session.id)
        if (turn === null || turn.blocked) continue
        const asItStands = this.deps.store.howATurnEnded(session.id, turn.id)
        cuts[session.id] = {
          turn: turn.id,
          generation: turn.generation,
          kind: 'quit',
          cutAt: now,
          inARow: continuationsInARow(cuts[session.id], asItStands?.aContinuation === true),
          provider: session.provider,
          profile: session.profileId,
          expected: this.identityKnown.get(session) ?? null,
          noticeId: newNoticeId(),
          aPersonStartedIt: session.aPersonsWordsOpenedIt,
          state: 'pending',
          at: now,
        }
        found = true
      }
      if (found) this.keepTheCuts({ ...this.cutsKept, cuts })
    } catch (error) {
      console.warn(`runtime host could not keep the turns its quit cuts: ${errorMessage(error)}`)
    }
  }

  private theCutsToContinue(leftRunning: readonly LeftRunning[], launchedAt: number): Set<string> {
    const continuing = new Set<string>()
    if (this.deps.turnsTheAppCut === undefined) return continuing
    try {
      const now = this.now()
      const cuts: Record<string, CutRecord> = { ...this.cutsKept.cuts }
      const piecesOn = new Map<string, string>()
      const end = (conversation: string, why: NotContinuedBecause): void => {
        const record = cuts[conversation]
        if (record !== undefined) cuts[conversation] = { ...record, state: { ended: why }, at: now }
      }
      for (const [conversation, record] of Object.entries(cuts)) {
        if (record.state === 'starting') end(conversation, 'start-uncertain')
        else if (record.state === 'queued') {
          const became = this.deps.store.whatBecameOfAMessage(conversation, record.noticeId)
          if (became === 'sent') cuts[conversation] = { ...record, state: 'sent', at: now }
          else end(conversation, became === 'absent' ? 'never-queued' : 'handover-uncertain')
        }
      }
      for (const left of leftRunning) {
        if (left.turn === null) continue
        const blocked = left.turn.blocked || left.status === 'waiting_permission'
        if (cuts[left.sessionId]?.turn === left.turn.id) {
          if (blocked) end(left.sessionId, 'blocked')
          continue
        }
        const recorded = this.deps.store.find(left.sessionId)
        if (recorded === null) continue
        const life = this.cutsKept.lives[left.sessionId]
        const asItStands = this.deps.store.howATurnEnded(left.sessionId, left.turn.id)
        cuts[left.sessionId] = {
          turn: left.turn.id,
          generation: left.turn.generation,
          kind: 'crash',
          cutAt: left.lastAt ?? left.turn.openedAt,
          inARow: continuationsInARow(cuts[left.sessionId], asItStands?.aContinuation === true),
          provider: recorded.provider,
          profile: recorded.profileId ?? DEFAULT_PROFILE_ID,
          expected:
            life !== undefined &&
            this.deps.store.aLifeOpenedTheTurn(left.sessionId, left.turn.id, life)
              ? life.identity
              : null,
          noticeId: newNoticeId(),
          aPersonStartedIt: false,
          state: blocked ? { ended: 'blocked' } : 'pending',
          at: now,
        }
      }
      for (const [conversation, record] of Object.entries(cuts)) {
        if (record.state !== 'pending') continue
        const since = record.kind === 'limit' ? (record.resetsAt ?? record.cutAt) : record.cutAt
        if (launchedAt - since > A_CUT_TURN_IS_CONTINUED_WITHIN_MS) {
          end(conversation, 'too-old')
          continue
        }
        const turn = this.deps.store.howATurnEnded(conversation, record.turn)
        if (turn === null || !theTurnWasCut(record.kind, turn, record.generation)) {
          end(conversation, 'not-cut')
          continue
        }
        if (this.deps.store.theNewestTurn(conversation) !== record.turn) {
          end(conversation, 'overtaken')
          continue
        }
        if ((record.inARow ?? 0) >= AUTOMATIC_CONTINUATIONS_IN_A_ROW) {
          end(conversation, 'continued-twice')
          continue
        }
        if (record.expected === null) {
          end(conversation, 'account-not-known')
          continue
        }
        const service = this.theServicesPieceToGoOnWith(conversation, turn.piecesItNamed)
        if (service === false) {
          end(conversation, 'a-service')
          continue
        }
        if (service !== null) piecesOn.set(conversation, service)
        cuts[conversation] = { ...record, aPersonStartedIt: turn.aPersonStartedIt }
        continuing.add(conversation)
      }
      if (!this.keepTheCuts({ ...this.cutsKept, cuts })) return new Set()
      for (const conversation of continuing) {
        this.cutsThisLaunchContinues.add(conversation)
        const spared = cuts[conversation]?.noticeId
        if (spared !== undefined) this.sparedAtTheLaunch.set(conversation, spared)
      }
      for (const [conversation, piece] of piecesOn)
        this.piecesTheCutsWereOn.set(conversation, piece)
    } catch (error) {
      console.warn(`runtime host could not read the turns it cut: ${errorMessage(error)}`)
      return new Set()
    }
    return continuing
  }

  private continueTheCutTurns(
    continuing: ReadonlySet<string>,
    elsewhere: ReadonlySet<string>,
  ): void {
    const order = [...continuing]
      .flatMap((conversation) => {
        const record = this.cutsKept.cuts[conversation]
        return record === undefined ? [] : [{ conversation, record }]
      })
      .sort(
        (a, b) =>
          Number(b.record.aPersonStartedIt) - Number(a.record.aPersonStartedIt) ||
          b.record.cutAt - a.record.cutAt,
      )
    const limits = new Set<Provider>()
    for (const { conversation, record } of order) {
      try {
        if (elsewhere.has(conversation)) this.notContinued(conversation, 'elsewhere')
        else if (this.startable(conversation) === null) {
          this.notContinued(conversation, 'not-startable')
        } else if (this.archived.has(conversation) || this.keptStopped(conversation)) {
          this.notContinued(conversation, 'kept-stopped')
        } else if (record.kind === 'limit') {
          limits.add(record.provider)
        } else if (!this.startComingAfterTheRestart.has(conversation)) {
          this.startComingAfterTheRestart.add(conversation)
          const { noticeId } = record
          this.restartWakes = this.restartWakes.then(() =>
            this.wakeForACutTurn(conversation, noticeId),
          )
        }
      } catch (error) {
        console.warn(
          `runtime host could not plan the continuation of ${conversation}'s cut turn: ${errorMessage(error)}`,
        )
      }
    }
    for (const provider of limits) this.wakeTheLimitsCuts(provider)
  }

  private async wakeForACutTurn(conversation: string, noticeId: string): Promise<void> {
    const wait = this.lastPacedStart + AT_ONCE_START_GAPS * this.startGapMs - performance.now()
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait)
        timer.unref?.()
      })
    }
    if (!this.startComingAfterTheRestart.has(conversation)) return
    try {
      if (this.cutsKept.cuts[conversation]?.noticeId === noticeId) {
        await this.startForTheCut(conversation, noticeId)
      }
    } finally {
      this.lastPacedStart = performance.now()
      if (!this.aProgramsWakeComes(conversation, noticeId)) {
        this.startComingAfterTheRestart.delete(conversation)
        try {
          this.tellWhoeverGaveTheWork(conversation)
        } catch (error) {
          console.warn(
            `runtime host could not ask who gave ${conversation} its work: ${errorMessage(error)}`,
          )
        }
      }
    }
  }

  private async startForTheCut(conversation: string, noticeId: string): Promise<void> {
    const watching = this.watchingTheCut.get(conversation)
    this.watchingTheCut.delete(conversation)
    if (!this.aCutToContinue(conversation)) return
    if (this.cutsKept.cuts[conversation]?.noticeId !== noticeId) return
    try {
      if (this.launches.closed) return
      if (this.keptStopped(conversation)) {
        this.notContinued(conversation, 'kept-stopped')
        return
      }
      if (!this.servicesAreOn() && this.itIsAService(conversation)) {
        this.notContinued(conversation, 'a-service')
        return
      }
      const record = this.cutsKept.cuts[conversation]
      if (record !== undefined && !this.theCutStillStands(conversation, record)) {
        this.notContinued(conversation, 'not-cut')
        return
      }
      if (this.deps.store.theNewestTurn(conversation) !== this.cutsKept.cuts[conversation]?.turn) {
        this.notContinued(conversation, 'overtaken')
        return
      }
      let owned = false
      const slot = this.slots.get(conversation)
      const beingStarted =
        this.startsInFlight.has(conversation) ||
        (slot !== undefined && slot.session === null && !onItsWayOut(slot))
      if (!this.runsNow(conversation) && !beingStarted) {
        if (!this.moveTheCut(conversation, 'starting')) {
          this.notContinued(conversation, 'start-failed')
          return
        }
        owned = true
        this.cutHoldsTheFirstBatch.add(conversation)
        console.info(`runtime host: starting ${conversation} — its turn was cut`)
        this.wakingForStoppedWork.add(conversation)
        try {
          await this.ensureRunning(conversation, watching?.alive === true ? watching : null)
        } finally {
          this.wakingForStoppedWork.delete(conversation)
        }
      } else {
        await this.startsInFlight.get(conversation)?.catch(() => undefined)
        if (slot !== undefined && slot.session === null && !onItsWayOut(slot)) await slot.arrived
      }
      await this.continueOnItsLife(conversation, owned, noticeId)
    } catch (error) {
      this.releaseTheFirstBatch(conversation)
      if (this.cutsKept.cuts[conversation]?.noticeId !== noticeId) return
      if (this.keptStopped(conversation)) this.notContinued(conversation, 'kept-stopped')
      else {
        console.warn(
          `runtime host could not start ${conversation} to continue its cut turn: ${errorMessage(error)}`,
        )
        this.notContinued(conversation, 'start-failed')
      }
    }
  }

  private async continueOnItsLife(
    conversation: string,
    owned: boolean,
    noticeId: string,
  ): Promise<void> {
    const session = this.slots.get(conversation)?.session ?? null
    let why: NotContinuedBecause | null = null
    try {
      const was = this.cutsKept.cuts[conversation]
      if (
        !this.cutsThisLaunchContinues.has(conversation) ||
        was?.noticeId !== noticeId ||
        (was.state !== 'pending' && was.state !== 'starting')
      ) {
        return
      }
      if (session === null) {
        why = 'start-failed'
        return
      }
      const identity = await this.identityOf(session)
      const record = this.cutsKept.cuts[conversation]
      if (record === undefined || record.noticeId !== noticeId || isFinal(record.state)) return
      const idKind = (id: string): string => id.slice(0, id.lastIndexOf(':'))
      const comparable =
        record.expected !== null &&
        identity !== null &&
        idKind(record.expected) === idKind(identity)
      const another = comparable && identity !== record.expected
      if (another) this.endTheCutsOf(record.provider, record.profile, conversation)
      if (this.slots.get(conversation)?.session !== session || this.keptStopped(conversation)) {
        why = 'stopped'
      } else if (
        !this.freshForTheContinuation(session) ||
        this.deps.store.theNewestTurn(conversation) !== record.turn ||
        !this.stillOnThePieceItWasCutOn(conversation)
      ) {
        why = 'overtaken'
      } else if (!comparable) why = 'account-not-known'
      else if (another) why = 'not-same-account'
      else if (this.theCutHasAged(record)) why = 'reset-too-far'
      else if (this.itsLimitHolds(record, session.provider)) why = 'limited'
      else if (!this.moveTheCut(conversation, 'queued')) why = 'never-queued'
      else {
        this.continuationLife.set(conversation, session)
        if (owned) this.cutStartedTheLife.add(session)
        this.holdUntilItStarts(
          conversation,
          aTurnTheAppCutText(record.kind, record.cutAt, this.now(), record.provider),
          { appNotice: 'a-turn-the-app-cut' },
          undefined,
          (where) => {
            if (where !== 'nowhere') return
            this.continuationLife.delete(conversation)
            this.notContinued(conversation, 'never-queued')
          },
          record.noticeId,
        )
      }
    } catch (error) {
      console.warn(
        `runtime host could not continue ${conversation}'s cut turn: ${errorMessage(error)}`,
      )
      why ??= 'start-failed'
    } finally {
      this.releaseTheFirstBatch(conversation)
      if (why !== null) {
        if (owned && session !== null && this.anIdleLifeNobodyNeeds(session)) {
          await this.close(conversation, THE_APP_ITSELF).catch((error: unknown) => {
            console.warn(
              `runtime host could not stop ${conversation} again: ${errorMessage(error)}`,
            )
          })
        }
        if (this.cutsKept.cuts[conversation]?.noticeId === noticeId) {
          this.notContinued(conversation, why)
        }
      }
    }
  }

  private releaseTheFirstBatch(conversation: string): void {
    if (!this.cutHoldsTheFirstBatch.delete(conversation)) return
    const session = this.slots.get(conversation)?.session
    if (session === undefined || session === null) return
    try {
      this.flushQueued(session)
    } catch (error) {
      console.warn(`runtime host could not send what ${conversation} held: ${errorMessage(error)}`)
    }
  }

  private freshForTheContinuation(session: HostedSession): boolean {
    const slot = this.slots.get(session.id)
    return (
      slot !== undefined &&
      !this.arrivals.has(session.id) &&
      slot.session === session &&
      !onItsWayOut(slot) &&
      !this.aTurnWentIn.has(session) &&
      session.handle.status() === 'idle' &&
      session.flushing === null &&
      session.handingOver.length === 0 &&
      session.stopStillAsked === null &&
      session.holdingQueue === 0 &&
      session.mailbox.every((queued) => queued.authorship.appNotice !== undefined)
    )
  }

  private anIdleLifeNobodyNeeds(session: HostedSession): boolean {
    const planning = session.handle.settings.planMode
    const keptBusy =
      somethingRunning(session.background) ||
      scheduleHeld(session.scheduled) ||
      planning.effective ||
      planning.requested
    return (
      this.slots.get(session.id)?.session === session &&
      this.freshForTheContinuation(session) &&
      session.mailbox.length === 0 &&
      !this.somethingIsOnItsWayTo(session) &&
      !this.arrivals.has(session.id) &&
      !keptBusy
    )
  }

  private endTheCutsOf(provider: Provider, profile: string, except: string): void {
    for (const [conversation, record] of Object.entries(this.cutsKept.cuts)) {
      if (conversation === except || record.state !== 'pending') continue
      if (record.provider !== provider || record.profile !== profile) continue
      this.notContinued(conversation, 'not-same-account-cohort')
    }
  }

  private notContinued(conversation: string, why: NotContinuedBecause): void {
    try {
      const record = this.cutsKept.cuts[conversation]
      if (record === undefined || isFinal(record.state)) return
      this.moveTheCut(conversation, { ended: why })
      console.info(`runtime host: ${conversation}'s cut turn is not continued (${why})`)
      if (why === 'elsewhere') return
      this.whatTheCutLeftStalls(conversation)
    } catch (error) {
      console.warn(
        `runtime host could not settle ${conversation}'s cut turn: ${errorMessage(error)}`,
      )
    }
  }

  private whatTheCutLeftStalls(conversation: string): void {
    const spared = this.sparedAtTheLaunch.get(conversation)
    this.sparedAtTheLaunch.delete(conversation)
    if (spared !== undefined && spared === this.cutsKept.cuts[conversation]?.noticeId) {
      this.stallWhatACutLeft(conversation)
    } else this.tellWhoeverGaveTheWork(conversation)
  }

  private aProgramsWakeComes(conversation: string, noticeId: string | undefined): boolean {
    const record = this.cutsKept.cuts[conversation]
    return (
      record !== undefined &&
      record.noticeId !== noticeId &&
      record.kind === 'program' &&
      record.state === 'pending'
    )
  }

  private stallWhatACutLeft(conversation: string): void {
    if (this.slots.has(conversation)) return
    const forItsJob = this.notStalledAtTheLaunch.has(conversation)
    const aService = this.theServiceOf(conversation) !== null
    const itsPiece = this.piecesTheCutsWereOn.get(conversation)
    const held = this.deps.store
      .piecesOwnedBy(conversation)
      .filter(
        (piece) =>
          (piece.state === 'working' ||
            piece.state === 'waiting' ||
            piece.parkedOver === 'working') &&
          !(forItsJob && piece.inTheBackground !== undefined) &&
          (!aService || piece.piece === itsPiece),
      )
      .map((piece) => piece.piece)
    if (held.length === 0) return
    this.deps.store.restartedWorkLate(conversation, held, this.now())
    this.tellWhoeverGaveTheWork(conversation)
  }

  private stopALifeOnlyTheCutNeeded(session: HostedSession): void {
    if (!this.cutStartedTheLife.has(session)) return
    const timer = setTimeout(() => {
      if (!this.anIdleLifeNobodyNeeds(session)) return
      void this.close(session.id, THE_APP_ITSELF).then(
        () => {
          try {
            this.whatTheCutLeftStalls(session.id)
          } catch (error) {
            console.warn(
              `runtime host could not stall what ${session.id}'s cut left: ${errorMessage(error)}`,
            )
          }
        },
        (error: unknown) => {
          console.warn(`runtime host could not stop ${session.id} again: ${errorMessage(error)}`)
        },
      )
    }, 0)
    timer.unref?.()
  }

  private theContinuationWasSent(session: HostedSession, noticeId: string): void {
    const record = this.cutsKept.cuts[session.id]
    if (record?.noticeId !== noticeId) return
    if (this.continuationLife.get(session.id) === session) this.continuationLife.delete(session.id)
    if (record.state === 'queued') this.moveTheCut(session.id, 'sent')
  }

  private aLimitMayStillHold(
    provider: Provider,
    account: string | null = null,
    captured?: LedgerWalk<ProviderLimitSeen>,
  ): boolean {
    try {
      const now = this.now()
      const walk =
        captured ??
        this.deps.store.providerLimitsSeen(now, this.signInChangedAt, this.limitAccountSnapshot())
      if (walk.rowsUnread > 0) return true
      return walk.rows.some(
        (wall) =>
          wall.provider === provider &&
          (account === null || wall.account === undefined || wall.account === account) &&
          wall.standing === 'stopped' &&
          (wall.resetsAt === null || wall.resetsAt > now),
      )
    } catch (error) {
      console.warn(`runtime host could not read ${provider}'s limits: ${errorMessage(error)}`)
      return true
    }
  }

  private itsLimitHolds(record: CutRecord, provider: Provider): boolean {
    return record.kind === 'program' || record.kind === 'limit'
      ? this.aLimitMayStillHold(provider, record.expected)
      : this.theResetItWaitsFor(provider, record.expected) !== null
  }

  private theCutHasAged(record: CutRecord): boolean {
    return record.kind === 'limit' && this.now() - record.cutAt > A_LIMIT_IS_WAITED_FOR_AT_MOST_MS
  }

  private letGoOfAContinuationNotForThisLife(session: HostedSession): void {
    for (const notice of [...session.mailbox]) {
      if (notice.authorship.appNotice !== 'a-turn-the-app-cut') continue
      const why = this.whyAContinuationNoLongerGoes(session, notice)
      if (why === null) continue
      this.takeQueued(session, notice)
      this.publishOurs(session, {
        type: 'message_unqueued',
        messageId: notice.id,
        reason: 'abandoned',
        text: notice.text,
        ...notice.authorship,
      })
      this.publishStateIfChanged(session)
      this.aContinuationLetGo(session.id, notice.id, why)
      if (why === 'limited' || why === 'reset-too-far') this.stopALifeOnlyTheCutNeeded(session)
      else if (!this.stillOnThePieceItWasCutOn(session.id)) this.stopALifeOnlyTheCutNeeded(session)
    }
  }

  private whyAContinuationNoLongerGoes(
    session: HostedSession,
    notice: QueuedMessage,
  ): NotContinuedBecause | null {
    if (this.continuationLife.get(session.id) !== session) return 'stopped'
    const record = this.cutsKept.cuts[session.id]
    if (record === undefined || record.noticeId !== notice.id || record.state !== 'queued') {
      return 'stopped'
    }
    try {
      const itsProviderIsBusy = session.handle.status() !== 'idle'
      if (
        this.aTurnWentIn.has(session) ||
        itsProviderIsBusy ||
        this.deps.store.theNewestTurn(session.id) !== record.turn ||
        !this.stillOnThePieceItWasCutOn(session.id)
      ) {
        return 'overtaken'
      }
      if (this.theCutHasAged(record)) return 'reset-too-far'
      return this.itsLimitHolds(record, session.provider) ? 'limited' : null
    } catch (error) {
      console.warn(
        `runtime host could not ask ${session.id}'s continuation: ${errorMessage(error)}`,
      )
      return 'overtaken'
    }
  }

  private aContinuationLetGo(
    conversation: string,
    noticeId: string,
    why: NotContinuedBecause,
  ): void {
    const record = this.cutsKept.cuts[conversation]
    if (record?.noticeId !== noticeId) return
    this.continuationLife.delete(conversation)
    if (isFinal(record.state)) return
    this.moveTheCut(conversation, { ended: why })
    console.info(`runtime host: ${conversation}'s cut turn is not continued (${why})`)
  }

  private theOpenTurnOf(session: HostedSession): OpenTurn | null {
    try {
      return this.deps.store.theOpenTurn(session.id)
    } catch (error) {
      console.warn(`runtime host could not read ${session.id}'s open turn: ${errorMessage(error)}`)
      return null
    }
  }

  private theServicesPieceToGoOnWith(
    conversation: string,
    piecesItNamed: readonly string[],
  ): string | false | null {
    const service = this.theServiceOf(conversation)
    if (service === null) return null
    const on =
      service === 'unknown' || !this.servicesAreOn() ? null : this.thePieceItIsOn(conversation)
    if (on === null || piecesItNamed.some((one) => one !== on.piece)) return false
    return on.piece
  }

  private keepWhatItsProgramCut(session: HostedSession): void {
    if (this.deps.turnsTheAppCut === undefined || this.launches.closed) return
    const conversation = session.id
    try {
      const slot = this.slots.get(conversation)
      if (slot === undefined || slot.session !== session || onItsWayOut(slot)) return
      if (session.stopStillAsked !== null || session.diedOnAStaleSignIn === true) return
      if (this.keptStopped(conversation)) return
      const turn = this.theOpenTurnOf(session)
      if (turn === null) return
      const asItStands = this.deps.store.howATurnEnded(conversation, turn.id)
      if (asItStands === null || asItStands.stopAsked) return
      const service = this.theServicesPieceToGoOnWith(conversation, asItStands.piecesItNamed)
      const expected = this.identityKnown.get(session) ?? null
      const inARow = continuationsInARow(this.cutsKept.cuts[conversation], asItStands.aContinuation)
      const why: NotContinuedBecause | null = turn.blocked
        ? 'blocked'
        : inARow >= AUTOMATIC_CONTINUATIONS_IN_A_ROW
          ? 'continued-twice'
          : service === false
            ? 'a-service'
            : expected === null
              ? 'account-not-known'
              : null
      const now = this.now()
      const record: CutRecord = {
        turn: turn.id,
        generation: turn.generation,
        kind: 'program',
        cutAt: now,
        inARow,
        provider: session.provider,
        profile: session.profileId,
        expected,
        noticeId: newNoticeId(),
        aPersonStartedIt: asItStands.aPersonStartedIt,
        state: why === null ? 'pending' : { ended: why },
        at: now,
      }
      if (
        !this.keepTheCuts({
          ...this.cutsKept,
          cuts: { ...this.cutsKept.cuts, [conversation]: record },
        })
      ) {
        return
      }
      if (why !== null) {
        console.info(`runtime host: ${conversation}'s cut turn is not continued (${why})`)
        return
      }
      this.cutsThisLaunchContinues.add(conversation)
      if (typeof service === 'string') this.piecesTheCutsWereOn.set(conversation, service)
      this.startComingAfterTheRestart.add(conversation)
      const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null
      if (watching === null) this.watchingTheCut.delete(conversation)
      else this.watchingTheCut.set(conversation, watching)
      const timer = setTimeout(() => {
        this.restartWakes = this.restartWakes.then(() =>
          this.wakeForACutTurn(conversation, record.noticeId),
        )
      }, this.aProgramStartsAgainAfterMs)
      timer.unref?.()
    } catch (error) {
      console.warn(
        `runtime host could not keep ${conversation}'s turn its program cut: ${errorMessage(error)}`,
      )
    }
  }

  private keepWhatALimitCut(session: HostedSession, turn: OpenTurn, limit: TurnLimit): void {
    if (this.deps.turnsTheAppCut === undefined || this.launches.closed) return
    const conversation = session.id
    try {
      const slot = this.slots.get(conversation)
      if (slot === undefined || slot.session !== session || onItsWayOut(slot)) return
      if (this.keptStopped(conversation)) return
      const asItEnded = this.deps.store.howATurnEnded(conversation, turn.id)
      if (asItEnded === null || asItEnded.stopAsked || asItEnded.refused) return
      const now = this.now()
      const inARow = continuationsInARow(this.cutsKept.cuts[conversation], asItEnded.aContinuation)
      const service = this.theServicesPieceToGoOnWith(conversation, asItEnded.piecesItNamed)
      const expected = this.identityKnown.get(session) ?? null
      const why: NotContinuedBecause | null = turn.blocked
        ? 'blocked'
        : limit.resetsAt === undefined
          ? 'no-reset'
          : limit.creditsRequired === true
            ? 'credits-required'
            : limit.resetsAt - now > A_LIMIT_IS_WAITED_FOR_AT_MOST_MS
              ? 'reset-too-far'
              : inARow >= AUTOMATIC_CONTINUATIONS_IN_A_ROW
                ? 'continued-twice'
                : service === false
                  ? 'a-service'
                  : expected === null
                    ? 'account-not-known'
                    : null
      const record: CutRecord = {
        turn: turn.id,
        generation: turn.generation,
        kind: 'limit',
        cutAt: now,
        ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
        inARow,
        provider: session.provider,
        profile: session.profileId,
        expected,
        noticeId: newNoticeId(),
        aPersonStartedIt: asItEnded.aPersonStartedIt,
        state: why === null ? 'pending' : { ended: why },
        at: now,
      }
      if (
        !this.keepTheCuts({
          ...this.cutsKept,
          cuts: { ...this.cutsKept.cuts, [conversation]: record },
        })
      ) {
        return
      }
      if (why !== null || limit.resetsAt === undefined) {
        console.info(
          `runtime host: ${conversation}'s cut turn is not continued (${why ?? 'no-reset'})`,
        )
        return
      }
      this.aTurnWentIn.delete(session)
      this.watchingTheCut.delete(conversation)
      this.cutsThisLaunchContinues.add(conversation)
      if (typeof service === 'string') this.piecesTheCutsWereOn.set(conversation, service)
      this.goAtTheReset(session.provider, limit.resetsAt)
    } catch (error) {
      console.warn(
        `runtime host could not keep ${conversation}'s turn its usage limit cut: ${errorMessage(error)}`,
      )
    }
  }

  private aPersonEndedItsWait(conversation: string): void {
    const record = this.cutsKept.cuts[conversation]
    if (record?.kind === 'limit' && record.state === 'pending') {
      this.notContinued(conversation, 'stopped')
    }
  }

  private theLimitsCutsOf(provider: Provider): readonly string[] {
    return Object.entries(this.cutsKept.cuts)
      .filter(
        ([conversation, record]) =>
          record.kind === 'limit' &&
          record.provider === provider &&
          record.state === 'pending' &&
          this.cutsThisLaunchContinues.has(conversation),
      )
      .sort(
        ([, a], [, b]) =>
          Number(b.aPersonStartedIt) - Number(a.aPersonStartedIt) || b.cutAt - a.cutAt,
      )
      .map(([conversation]) => conversation)
  }

  private wakeTheLimitsCuts(provider: Provider): void {
    try {
      if (this.launches.closed) return
      const waiting = this.theLimitsCutsOf(provider)
      if (waiting.length === 0) return
      const now = this.now()
      let walk: LedgerWalk<ProviderLimitSeen> | undefined
      try {
        const epoch = this.providerLimitEpoch
        walk = this.deps.store.providerLimitsSeen(
          now,
          this.signInChangedAt,
          this.limitAccountSnapshot(),
        )
        this.wallsForTheHold = { at: now, rows: walk.rows }
        this.prepareProviderLimitFacts(walk, now, epoch)
      } catch (error) {
        this.wallsForTheHold = null
        this.invalidateProviderLimitFacts()
        console.warn(`runtime host could not read the providers' limits: ${errorMessage(error)}`)
      }
      let soonest: number | null = null
      const due: string[] = []
      for (const conversation of waiting) {
        const record = this.cutsKept.cuts[conversation]
        if (record === undefined) continue
        const standing =
          walk === undefined ? null : this.theResetItWaitsFor(provider, record.expected)
        const mayStillHold =
          walk === undefined || this.aLimitMayStillHold(provider, record.expected, walk)
        const reset = Math.max(record.resetsAt ?? 0, standing ?? 0)
        if (now - record.cutAt > A_LIMIT_IS_WAITED_FOR_AT_MOST_MS) {
          this.notContinued(conversation, 'reset-too-far')
        } else if (reset > now || mayStillHold) {
          const at = reset > now ? reset : now + this.lookAtTheLimitAgainMs
          soonest = soonest === null ? at : Math.min(soonest, at)
        } else due.push(conversation)
      }
      if (soonest !== null) this.goAtTheReset(provider, soonest)
      for (const conversation of due) {
        if (this.limitWakesPlanned.has(conversation)) continue
        const noticeId = this.cutsKept.cuts[conversation]?.noticeId
        if (noticeId === undefined) continue
        this.limitWakesPlanned.add(conversation)
        const line = this.limitLines.get(provider) ?? Promise.resolve()
        this.limitLines.set(
          provider,
          line.then(() => this.wakeForALimitsCut(provider, conversation, noticeId)),
        )
      }
    } catch (error) {
      console.warn(
        `runtime host could not continue the turns ${provider}'s usage limit cut: ${errorMessage(error)}`,
      )
    }
  }

  private async wakeForALimitsCut(
    provider: Provider,
    conversation: string,
    noticeId: string,
  ): Promise<void> {
    const last = this.lastLimitWake.get(provider)
    const wait = last === undefined ? 0 : last + this.limitWakesApartMs - performance.now()
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait)
        timer.unref?.()
      })
    }
    this.limitWakesPlanned.delete(conversation)
    const record = this.cutsKept.cuts[conversation]
    if (record?.kind !== 'limit' || record.noticeId !== noticeId) {
      if (record?.kind === 'limit') this.wakeTheLimitsCuts(provider)
      return
    }
    if (!this.aCutToContinue(conversation) || this.launches.closed) return
    try {
      if (this.theCutHasAged(record)) {
        this.notContinued(conversation, 'reset-too-far')
        return
      }
      if (
        this.aLimitMayStillHold(provider, record.expected) ||
        (record.resetsAt ?? 0) > this.now()
      ) {
        this.wakeTheLimitsCuts(provider)
        return
      }
      await this.startForTheCut(conversation, noticeId)
      const after = this.cutsKept.cuts[conversation]
      if (after?.noticeId === noticeId && (after.state === 'queued' || after.state === 'sent')) {
        this.lastLimitWake.set(provider, performance.now())
      }
    } catch (error) {
      console.warn(
        `runtime host could not continue ${conversation}'s turn its usage limit cut: ${errorMessage(error)}`,
      )
    } finally {
      try {
        this.tellWhoeverGaveTheWork(conversation)
      } catch (error) {
        console.warn(
          `runtime host could not ask who gave ${conversation} its work: ${errorMessage(error)}`,
        )
      }
    }
  }

  private theCutStillStands(conversation: string, record: CutRecord): boolean {
    if (record.kind !== 'program' && record.kind !== 'limit') return true
    const turn = this.deps.store.howATurnEnded(conversation, record.turn)
    return turn !== null && theTurnWasCut(record.kind, turn, record.generation)
  }

  private identityOf(session: HostedSession): Promise<string | null> {
    let asked = this.itsIdentity.get(session)
    if (asked === undefined) {
      asked = this.learnItsIdentity(session)
      this.itsIdentity.set(session, asked)
    }
    return asked
  }

  private async learnItsIdentity(session: HostedSession): Promise<string | null> {
    let identity: string | null
    try {
      const policy = providerAuthPolicies[session.provider].identity
      let fact = policy.launch(session.handle)
      const ended = (): boolean => {
        const status = session.handle.status()
        return status === 'ended' || status === 'errored'
      }
      while (fact === undefined && policy.waitsForAccount && !ended()) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ACCOUNT_LOOK_EVERY_MS)
          timer.unref?.()
        })
        fact = policy.launch(session.handle)
      }
      identity = this.identityFromFacts(session.provider, fact)
    } catch (error) {
      console.warn(`runtime host could not tell ${session.id}'s account: ${errorMessage(error)}`)
      identity = null
    }
    this.identityKnown.set(session, identity)
    this.recordLimitAccount(session)
    if (identity !== null) this.keepItsLife(session, identity)
    return identity
  }

  private identityFromFacts(provider: Provider, fact: IdentityFact | undefined): string | null {
    if (fact == null) return null
    if (fact.kind === 'account') {
      const known = this.accountRecordFor(fact.account)
      return known === null ? null : `${provider}:account:${known.id}`
    }
    return `${provider}:${fact.launchOnly === true ? 'launch-credential' : 'sign-in'}:${fact.tag}`
  }

  private recordedAccountFor(said: {
    email: string
    organization?: string
  }): KnownAccount | null | undefined {
    const matches = this.knownAccounts.filter(
      (one) => one.email === said.email && one.organization === said.organization,
    )
    if (new Set(matches.map((one) => one.id)).size > 1) return null
    const known = matches[0]
    if (
      known !== undefined &&
      this.knownAccounts.some(
        (one) =>
          one.id === known.id &&
          (one.email !== known.email || one.organization !== known.organization),
      )
    )
      return null
    return known
  }

  private accountRecordFor(said: { email: string; organization?: string }): KnownAccount | null {
    const known = this.recordedAccountFor(said)
    if (known === null) return null
    if (known !== undefined) {
      this.keepTheAccount(known)
      return known
    }
    const learned: KnownAccount = {
      id: randomBytes(16).toString('hex'),
      email: said.email,
      ...(said.organization === undefined ? {} : { organization: said.organization }),
    }
    return this.keepTheAccount(learned) ? learned : null
  }

  private forgetTheirCuts(gone: ReadonlySet<string>): void {
    for (const id of gone) this.limitAccountLives.delete(id)
    const left = <T>(rows: Readonly<Record<string, T>>): Record<string, T> =>
      Object.fromEntries(Object.entries(rows).filter(([id]) => !gone.has(id)))
    const cuts = left(this.cutsKept.cuts)
    const lives = left(this.cutsKept.lives)
    if (
      Object.keys(cuts).length === Object.keys(this.cutsKept.cuts).length &&
      Object.keys(lives).length === Object.keys(this.cutsKept.lives).length
    ) {
      return
    }
    const next = { ...this.cutsKept, cuts, lives }
    if (!this.keepTheCuts(next)) this.cutsKept = next
  }

  private noteItsLaunchedRow(session: HostedSession, ordinal: number): void {
    if (this.deps.turnsTheAppCut === undefined || this.lifeLaunched.has(session)) return
    try {
      const generation = this.deps.store.theActiveGeneration(session.id)
      this.lifeLaunched.set(session, { generation, launched: ordinal })
    } catch (error) {
      console.warn(`runtime host could not place ${session.id}'s launch: ${errorMessage(error)}`)
      return
    }
    const identity = this.identityKnown.get(session)
    if (identity !== undefined && identity !== null) this.keepItsLife(session, identity)
  }

  private keepItsLife(session: HostedSession, identity: string): void {
    const slot = this.slots.get(session.id)
    if (slot === undefined || slot.session !== session || onItsWayOut(slot)) return
    const begins = this.lifeLaunched.get(session)
    if (begins === undefined) return
    const was = this.cutsKept.lives[session.id]
    if (
      was?.generation === begins.generation &&
      was.launched === begins.launched &&
      was.identity === identity
    ) {
      return
    }
    this.keepTheCuts({
      ...this.cutsKept,
      lives: {
        ...this.cutsKept.lives,
        [session.id]: { since: session.lifeSince, identity, ...begins },
      },
    })
  }

  workInFlight(): Iterable<string> {
    return [
      ...new Set([...this.slots.keys(), ...this.building.keys(), ...this.launches.subjects()]),
    ]
  }

  get ledger(): object {
    return this.ledgerIdentity
  }

  private async whileBuilding<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    this.building.set(sessionId, (this.building.get(sessionId) ?? 0) + 1)
    try {
      return await run()
    } finally {
      const left = (this.building.get(sessionId) ?? 1) - 1
      if (left > 0) this.building.set(sessionId, left)
      else this.building.delete(sessionId)
    }
  }

  get sessionIds(): string[] {
    return [...this.slots.values()].filter((slot) => slot.session !== null).map((slot) => slot.id)
  }

  private reserve(
    id: string,
    held: {
      readonly ownerId: string | null
      readonly ownerIsAPerson: boolean
      readonly commandedBy: string | null
      readonly spawnedBy: string | null
      readonly provider?: Provider
      readonly profileId: string | null
      readonly anAgentAskedForIt: boolean
    },
    launchKey: string | null,
  ): SessionSlot {
    const { ownerId, ownerIsAPerson, commandedBy, spawnedBy, profileId, anAgentAskedForIt } = held
    if (this.launches.closed) {
      throw new SessionUnavailable(
        'shutting-down',
        `BroCrew is shutting down, so session ${id} was not started`,
      )
    }
    const existing = this.slots.get(id)
    if (existing !== undefined) {
      if (onItsWayOut(existing)) {
        throw new SessionUnavailable(
          'still-closing',
          `session ${id} is still closing — it could not be reopened yet`,
        )
      }
      if (existing.session === null) {
        const openingForMs = this.now() - existing.since
        throw new SessionUnavailable(
          'still-opening',
          `session ${id} is still opening — reserved ${openingForMs}ms ago by ` +
            `${ownerName(existing.ownerId)}, and its provider has not arrived`,
          { openingForMs },
        )
      }
      throw new SessionUnavailable(
        existing.ownerId === null
          ? 'held-by-nobody'
          : existing.ownerId === ownerId
            ? 'already-open'
            : 'already-open-elsewhere',
        `session is already open: ${id} (held for ${ownerName(existing.ownerId)}, asked for by ` +
          `${ownerName(ownerId)})`,
      )
    }
    if (workRunningElsewhere(this).has(id)) {
      throw new SessionUnavailable(
        'run-by-another-host',
        `session ${id} is being run by another RuntimeHost in this process (asked for by ` +
          `${ownerName(ownerId)})`,
      )
    }
    const unconfirmed = this.launches.refuse(id)
    if (unconfirmed !== null) {
      throw new SessionUnavailable(
        'not-confirmed-stopped',
        `session ${id} cannot be reopened: ${unconfirmed}`,
      )
    }
    let settle: () => void = () => {}
    const arrived = new Promise<void>((resolve) => {
      settle = resolve
    })
    const slot: SessionSlot = {
      id,
      provider: held.provider ?? this.deps.store.recordedOne(id)?.provider ?? null,
      ownerId,
      ownerIsAPerson,
      bornWithoutASurface: ownerId === null || anAgentAskedForIt,
      aDeliveryStartedItWithNoWindow:
        ownerId === null &&
        (this.startingForADeliveryWithNoWindow.has(id) || this.reservingAReplacementWithNoWindow),
      replaces: this.reservingAReplacementFor,
      startedFrom: this.reservingAStartFrom,
      commandedBy,
      spawnedBy,
      profileId,
      since: this.now(),
      launchKey,
      phase: 'starting',
      launch: this.launches.open(`session ${id}`, id),
      session: null,
      arrived,
      settle,
    }
    this.slots.set(id, slot)
    if (slot.provider !== null && profileId !== null)
      this.rememberHomeLaunch(slot.provider, profileId, slot.launch)
    this.stateMayHaveMoved(id)
    return slot
  }

  private abandon(slot: SessionSlot): void {
    if (slot.session !== null || this.slots.get(slot.id) !== slot) return
    this.slots.delete(slot.id)
    this.waitAsLastRead.delete(slot.id)
    this.workOutAsLastRead.delete(slot.id)
    this.owedAsLastRead.delete(slot.id)
    this.stateMayHaveMoved(slot.id)
  }

  private theWorldMoved(what: RuntimeChangeMessage['what']): void {
    this.linkAnswers.invalidate()
    this.moveTheListing()
    this.moveThePersons()
    if (what === 'agents') this.namesMayHaveMoved()
    try {
      this.deps.announce?.(
        what === 'persons' || what === 'conversations'
          ? { what, published: { epoch: this.publicationEpoch, seq: this.publicationSeq } }
          : { what },
      )
    } catch (error) {
      console.warn(`runtime host could not announce that ${what} moved: ${errorMessage(error)}`)
    }
  }

  private stateMayHaveMoved(conversation: string): void {
    this.linkAnswers.invalidate()
    this.moveTheListing()
    this.moveThePersons()
    this.aServiceMayTakeItsNext(conversation)
    if (this.deps.statesMoved === undefined) return
    this.conversationIdle.cancel(conversation)
    this.statesToAsk.add(conversation)
    this.askTheFlush()
  }

  private filesWereKept(piece: string, kept: readonly { readonly resource: string }[]): void {
    if (this.deps.statesMoved === undefined || kept.length === 0) return
    this.filesToSay.push({ piece, resources: kept.map((one) => one.resource) })
    this.askTheFlush()
  }

  private askTheFlush(): void {
    if (this.flushAsked) return
    this.flushAsked = true
    setImmediate(() => this.sayWhatMoved())
  }

  private itsNameMayHaveMoved(conversation: string): void {
    for (const [asker, owes] of this.waitsOnTheAnswerOf) {
      if (owes === conversation) this.stateMayHaveMoved(asker)
    }
    for (const [giver, holders] of this.waitsOnTheWorkOf) {
      if (holders.includes(conversation)) this.stateMayHaveMoved(giver)
    }
    for (const [answerer, askers] of this.owesTheAnswersOf) {
      if (
        askers.some(
          (asker) => asker === conversation || this.theOneInItsPlace(asker) === conversation,
        )
      ) {
        this.stateMayHaveMoved(answerer)
      }
    }
  }

  private namesMayHaveMoved(): void {
    if (this.deps.statesMoved === undefined) return
    try {
      const roster = this.deps.store.agentIdentities()
      const before = this.rosterAsLastAnnounced
      const renamed = (conversation: string): boolean => {
        if (before === null) return true
        const profile = this.profileOf(conversation)
        const called = (names: readonly AgentIdentity[]): string =>
          nameTheConversation(whoseConversationIs(profile, names))
        return called(before) !== called(roster)
      }
      for (const [asker, owes] of this.waitsOnTheAnswerOf) {
        if (renamed(owes)) this.stateMayHaveMoved(asker)
      }
      for (const [giver, holders] of this.waitsOnTheWorkOf) {
        if (holders.some(renamed)) this.stateMayHaveMoved(giver)
      }
      for (const [answerer, askers] of this.owesTheAnswersOf) {
        if (askers.some((asker) => renamed(this.theOneInItsPlace(asker)))) {
          this.stateMayHaveMoved(answerer)
        }
      }
      this.rosterAsLastAnnounced = roster
    } catch (error) {
      console.warn(`runtime host could not tell whose name moved: ${errorMessage(error)}`)
    }
  }

  private heardACommit(change: Committed): void {
    try {
      if (change.resync) {
        const { run, n } = this.publicationEpoch
        this.publicationEpoch = { run, n: n + 1, reason: 'resync' }
        this.moveTheListing()
        this.everyKeptReadingIsStale()
        return
      }
      if (
        change.rows.length > 0 ||
        change.whole.size > 0 ||
        change.kept.length > 0 ||
        change.visibleTables.size > 0
      )
        this.moveTheListing()
      for (const row of change.rows) this.aRowWasWritten(row.session, row)
      if (
        change.whole.size > 0 ||
        change.stagedRemovedSeen.size > 0 ||
        [...change.visibleTables].some((table) => NAMES_WHAT_A_PERSON_IS_ASKED.has(table)) ||
        change.rows.some(
          (row) =>
            MOVES_WHAT_A_PERSON_IS_ASKED.has(row.rowType) &&
            (row.rowType !== 'status' || aWaitReads(row.rowType, row.state)),
        )
      )
        this.theWorldMoved('persons')
      const kept = new Map<string, { resource: string }[]>()
      for (const { piece, resource } of change.kept) {
        const resources = kept.get(piece)
        if (resources === undefined) kept.set(piece, [{ resource }])
        else resources.push({ resource })
      }
      for (const [piece, resources] of kept) this.filesWereKept(piece, resources)
      for (const [session, why] of change.whole) this.aWholeLedgerChanged(session, why)
    } catch (error) {
      console.warn(`runtime host could not follow a committed change: ${errorMessage(error)}`)
    }
  }

  private markWhatWasNotRecorded(
    session: HostedSession,
    ordinal: number,
    event: TranscriptEvent,
  ): void {
    if (session.recordingFailure === null) return
    this.aRowWasWritten(session.id, committedRowOf(session.id, 0, ordinal, event))
  }

  private aWholeLedgerChanged(session: string, why: WholeChange): void {
    if (why === 'listing') return
    if (why !== 'deleted') {
      this.waitAsLastRead.delete(session)
      this.owedAsLastRead.delete(session)
      this.contextAsLastRead.delete(session)
      this.stateMayHaveMoved(session)
    }
    this.itsNameMayHaveMoved(session)
    for (const [giver, holders] of this.waitsOnTheWorkOf) {
      if (holders.includes(session)) this.theWorkItGaveMoved(giver)
    }
    for (const [answerer, askers] of this.owesTheAnswersOf) {
      if (askers.includes(session)) this.theAnswersItOwesMoved(answerer)
    }
    if (why !== 'imported') return
    this.routedTo = null
    for (const [conversation, slot] of this.slots) {
      if (slot.session !== null) this.theAnswersItOwesMoved(conversation)
    }
  }

  private everyKeptReadingIsStale(): void {
    this.waitAsLastRead.clear()
    this.workOutAsLastRead.clear()
    this.owedAsLastRead.clear()
    this.contextAsLastRead.clear()
    this.heldAsLastRead.clear()
    this.routedTo = null
    for (const [conversation, slot] of this.slots) {
      if (slot.session !== null) this.stateMayHaveMoved(conversation)
    }
    for (const what of RUNTIME_CHANGE_SUBJECTS) this.theWorldMoved(what)
  }

  private aRowWasWritten(conversation: string, event: CommittedRow): void {
    const type = event.rowType
    if (
      type === 'work_replied' ||
      type === 'work_closed' ||
      type === 'work_taken_back' ||
      type === 'request_resolved' ||
      type === 'question_withdrawn' ||
      type === 'request_interrupted' ||
      type === 'question_recipient_ended'
    )
      queueMicrotask(() => this.reconcileWork(new Set([conversation])))
    if (MAY_FREE_A_SERVICE.has(type)) this.aServiceMayTakeItsNext(conversation)
    if (GRANTS_MAY_MOVE.has(type)) {
      const live = this.slots.get(conversation)?.session ?? null
      if (live !== null) {
        live.grants = undefined
        queueMicrotask(() => this.publishStateIfChanged(live))
      }
    }
    if (aWaitReads(type, event.state)) {
      this.waitAsLastRead.delete(conversation)
      this.stateMayHaveMoved(conversation)
      this.aCardMayHaveEnded(conversation)
    } else if (MOVES_A_LIVE_FACT.has(type) || MOVES_A_PIECE_THAT_WAITS_ON_WHO_WROTE.has(type)) {
      this.stateMayHaveMoved(conversation)
    }
    if (MOVES_ITS_NAME.has(type)) this.itsNameMayHaveMoved(conversation)
    if (type === 'request_routed' && event.parent !== undefined && event.to !== undefined) {
      if (this.routedTo !== null && event.to !== 'a-person') {
        const askers = this.routedTo.get(event.parent)
        if (askers === undefined) this.routedTo.set(event.parent, new Set([conversation]))
        else askers.add(conversation)
      }
      if (event.to !== 'a-person') this.theAnswersItOwesMoved(this.theOneInItsPlace(event.parent))
    }
    if (aWaitReads(type, event.state) || type === 'status') {
      for (const [answerer, askers] of this.owesTheAnswersOf) {
        if (askers.includes(conversation)) this.theAnswersItOwesMoved(answerer)
      }
    }
    if (MOVES_ITS_GIVERS_WAIT.has(type) && event.piece !== undefined)
      this.itsGiversWaitMayHaveMoved(event.piece)
    if (type === 'replaced_by' && event.replacedBy !== undefined) {
      this.refreshWorkerReadings(true)
      this.theWorkItGaveMoved(conversation)
      this.theWorkItGaveMoved(event.replacedBy)
      this.theAnswersItOwesMoved(conversation)
      this.theAnswersItOwesMoved(event.replacedBy)
    }
  }

  private theAnswersItOwesMoved(conversation: string): void {
    this.owedAsLastRead.delete(conversation)
    this.stateMayHaveMoved(conversation)
  }

  private itsGiversWaitMayHaveMoved(piece: string): void {
    try {
      const giver = this.deps.store.workById(piece)?.givenBy ?? null
      if (giver !== null) this.theWorkItGaveMoved(this.theOneInItsPlace(giver))
    } catch (error) {
      console.warn(`runtime host could not tell who gave ${piece}: ${errorMessage(error)}`)
    }
  }

  private theWorkItGaveMoved(conversation: string): void {
    this.workOutAsLastRead.delete(conversation)
    this.stateMayHaveMoved(conversation)
  }

  private sayWhatMoved(): void {
    this.deps.store.checkCommitted()
    this.flushAsked = false
    const asked = [...this.statesToAsk]
    this.statesToAsk.clear()
    const keptOn = this.filesToSay.splice(0)
    const say = this.deps.statesMoved
    if (say === undefined || this.launches.closed) return
    const moved = this.statesThatMoved(asked)
    const kept = this.whatWasKept(keptOn)
    if (moved.length === 0 && kept.length === 0) return
    const published = { epoch: this.publicationEpoch, seq: ++this.publicationSeq }
    try {
      say({ moved, kept, published })
    } catch (error) {
      console.warn(`runtime host could not tell the windows what moved: ${errorMessage(error)}`)
    }
  }

  private statesThatMoved(asked: readonly string[]): readonly AgentStateMoved[] {
    if (asked.length === 0) return []
    let reads: CardReads
    try {
      reads = this.cardReads()
    } catch (error) {
      console.warn(`runtime host could not say what its agents are doing: ${errorMessage(error)}`)
      return []
    }
    const unread = rowsUnreadOnce()
    const read = this.oneLedgerReadPerAnswer(unread)
    const workOut = this.workOutAsKept(this.oneWorkOutReadPerAnswer(unread))
    const owed = this.owedAsKept(this.oneOwedReadPerAnswer(this.ledgerAsKept(read)))
    const moved: AgentStateMoved[] = []
    for (const conversation of asked) {
      try {
        const runs = this.slots.has(conversation)
        const ledger =
          (runs ? this.waitAsLastRead.get(conversation) : undefined) ?? read(conversation)
        if (runs) this.waitAsLastRead.set(conversation, ledger)
        const state = this.stateOf(conversation, reads, unread, ledger, workOut, owed)
        if (this.idleEnoughToStop(conversation, state))
          this.conversationIdle.countTheIdleMinutes(conversation)
        const limits = this.providerBlockDisclosure(conversation)
        const said = JSON.stringify({ state, ...limits })
        if (this.stateSaid.get(conversation) === said) continue
        this.stateSaid.set(conversation, said)
        this.providerBlockSaid.set(conversation, JSON.stringify(limits))
        moved.push({ conversation, state, ...limits })
      } catch (error) {
        console.warn(
          `runtime host could not say what ${conversation} is doing: ${errorMessage(error)}`,
        )
      }
    }
    return moved
  }

  private workOutAsKept(read: WorkOutOf): WorkOutOf {
    return (id) => {
      const runs = this.slots.has(id)
      const workOut = (runs ? this.workOutAsLastRead.get(id) : undefined) ?? read(id)
      if (runs) this.workOutAsLastRead.set(id, workOut)
      return workOut
    }
  }

  private owedAsKept(read: OwedBy): OwedBy {
    return (id) => {
      const runs = this.slots.has(id)
      const owed = (runs ? this.owedAsLastRead.get(id) : undefined) ?? read(id)
      if (runs) this.owedAsLastRead.set(id, owed)
      return owed
    }
  }

  private whatWasKept(
    keptOn: readonly { readonly piece: string; readonly resources: readonly string[] }[],
  ): readonly KeptFile[] {
    if (keptOn.length === 0) return []
    let roster: readonly AgentIdentity[]
    try {
      roster = this.deps.store.agentIdentities()
    } catch (error) {
      console.warn(`runtime host could not say which files were kept: ${errorMessage(error)}`)
      return []
    }
    return keptOn.flatMap(({ piece, resources }) => {
      try {
        return this.deps.store
          .filesKept({ scope: 'piece', piece })
          .filter((row) => resources.includes(row.resource.resource))
          .map((row) => keptFileOf(row, roster))
      } catch (error) {
        console.warn(
          `runtime host could not say which files were kept on ${piece}: ${errorMessage(error)}`,
        )
        return []
      }
    })
  }

  private theScheduleLevelsAtTheLaunch(): ScheduleLevelsAtTheLaunch | null {
    try {
      return this.deps.store.newestScheduleLevels()
    } catch (error) {
      console.warn(
        `runtime host could not read what its conversations have scheduled: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private takeTheProfileExecution(): void {
    this.workerTerminals.clear()
    const kept = this.deps.profileExecution
    if (kept === undefined) return
    let read: ProfileExecutionRead
    try {
      read = kept.read()
    } catch (error) {
      read = { readable: false, why: errorMessage(error) }
    }
    let settled: Reconciled
    try {
      const servicesBorn = this.deps.store.servicesBorn()
      const workersBorn = this.deps.store.workersBorn()
      read = readAgainstTheDatabase(read, servicesBorn, workersBorn)
      if (!read.readable) {
        this.profileExecution = read
        console.warn(`runtime host could not read how its profiles run their work: ${read.why}`)
        return
      }
      const identities = new Map(this.deps.store.agentIdentities().map((one) => [one.id, one]))
      settled = reconcileProfileExecution(read.kept, {
        identityCreatedAt: (identity) => identities.get(identity)?.createdAt ?? null,
        hasConversation: (conversation) => this.deps.store.recordedOne(conversation) !== null,
        servicesBorn,
        workersBorn,
        assignmentWasAccepted: (worker, assignment) =>
          this.normalAssignmentAccepted(worker.conversation, assignment),
        workerMatches: (fact) => this.workerMatchesItsRow(fact, identities.get(fact.identity)),
        legacyPrimaryMatches: (fact) =>
          fact.number === 1 && this.workerMatchesItsRow(fact, identities.get(fact.identity)),
      })
    } catch (error) {
      this.profileExecution = {
        readable: false,
        why: `it could not be settled (${errorMessage(error)})`,
      }
      console.warn(
        `runtime host could not settle how its profiles run their work: ${errorMessage(error)}`,
      )
      return
    }
    if (!kept.owned) {
      this.profileExecution = read
      this.profileExecutionConflicts = [...new Set([...settled.conflicts, ...settled.moved])]
      this.moveTheListing()
      return
    }
    this.profileExecution = { readable: true, kept: settled.kept }
    this.profileExecutionConflicts = settled.conflicts
    this.moveTheListing()
    if (!settled.changed) return
    try {
      kept.write(settled.kept)
    } catch (error) {
      console.warn(
        `runtime host could not keep how its profiles run their work: ${errorMessage(error)}`,
      )
    }
  }

  private normalAssignmentAccepted(
    conversation: string,
    assignment: NormalWorkerAssignment,
  ): boolean {
    const piece = this.deps.store.workById(assignment.piece)
    return (
      piece !== null &&
      piece.givenBy === assignment.giver &&
      this.deps.store.workerLineage(conversation).includes(piece.owner)
    )
  }

  private workerMatchesItsRow(fact: WorkerBorn, identity: AgentIdentity | undefined): boolean {
    const row = this.deps.store.recordedOne(fact.conversation)
    const parent = this.deps.store.parentOf(fact.conversation)
    return (
      row !== null &&
      row.profileId !== null &&
      parent !== null &&
      identity !== undefined &&
      identity.createdAt === fact.identityCreatedAt &&
      foldProfileName(row.profileId) === identity.slug &&
      this.deps.store.workerGiverContains(fact.giver, parent)
    )
  }

  profileKindOf(profile: string): ProfileKind | 'unknown' {
    const folded = foldProfileName(profile)
    const identity = this.deps.store.agentIdentities().find((one) => one.slug === folded)
    if (identity === undefined) return this.profileExecution.readable ? 'normal' : 'unknown'
    return kindOf(
      this.profileExecution,
      this.profileExecutionConflicts,
      identity.id,
      identity.createdAt,
    )
  }

  private theServiceOf(conversation: string): string | 'unknown' | null {
    const read = this.profileExecution
    if (read.readable) {
      for (const [identity, entry] of Object.entries(read.kept.profiles)) {
        if (entry.serviceConversation === conversation || entry.reserved === conversation) {
          return identity
        }
      }
    }
    const { store } = this.deps
    const rootless =
      store.recordedOne(conversation) !== null &&
      store.parentOf(conversation) === null &&
      store.rootOf(conversation) === null
    return rootless ? 'unknown' : null
  }

  private keepTheProfileEntry(
    identity: string,
    entry: ProfileExecution | null,
    must: boolean,
  ): void {
    const read = this.profileExecution
    if (!read.readable) throw new Error(`which agents are services can’t be read: ${read.why}`)
    if (this.deps.profileExecution?.owned !== true) throw new Error(NOT_THE_ONLY_APP)
    const profiles = { ...read.kept.profiles }
    if (entry === null) delete profiles[identity]
    else profiles[identity] = entry
    const kept = { ...read.kept, profiles }
    try {
      this.deps.profileExecution?.write(kept)
    } catch (error) {
      if (must) throw error
      console.warn(
        `runtime host could not keep how its profiles run their work: ${errorMessage(error)}`,
      )
    }
    this.profileExecution = { readable: true, kept }
  }

  private theServiceAgent(
    profile: string,
  ):
    | { readonly is: 'normal' | 'unknown'; readonly why?: string }
    | { readonly is: 'service'; readonly identity: string; readonly conversation: string | null } {
    const folded = foldProfileName(profile)
    const identity = this.deps.store.agentIdentities().find((one) => one.slug === folded)
    if (identity === undefined) return { is: 'normal' }
    const born = (): boolean =>
      this.deps.store.servicesBorn().some((one) => one.identity === identity.id)
    const read = this.profileExecution
    if (!read.readable) return { is: born() ? 'unknown' : 'normal', why: read.why }
    const kind = kindOf(read, this.profileExecutionConflicts, identity.id, identity.createdAt)
    if (kind === 'unknown') return { is: born() ? 'unknown' : 'normal' }
    if (kind === 'normal') return { is: 'normal' }
    const entry = read.kept.profiles[identity.id]
    if (entry?.reserved !== undefined) return { is: 'unknown' }
    return {
      is: 'service',
      identity: identity.id,
      conversation: entry?.serviceConversation ?? null,
    }
  }

  private isAServicesAgent(profile: string): boolean {
    return this.theServiceAgent(profile).is !== 'normal'
  }

  private theServiceAtAGive(giver: string, profile: string): ServiceAtAGive {
    const agent = this.theServiceAgent(profile)
    if (agent.is !== 'service') return agent
    if (!this.servicesAreOn() || this.deps.profileExecution?.owned !== true) {
      return { is: 'off' }
    }
    const { conversation } = agent
    const givers = this.theIdsItStandsFor(giver)
    return {
      is: 'service',
      conversation,
      isTheGiver: conversation !== null && givers.includes(conversation),
      waitsOnTheGiver: conversation === null ? 'no' : this.itWaitsOn(conversation, givers),
      provider:
        conversation === null
          ? (this.itsProvider(profile).provider ??
            this.deps.store.modelChoiceOf(profile)?.provider ??
            null)
          : this.theProviderOfConversation(conversation),
    }
  }

  private itWaitsOn(
    conversation: string,
    givers: readonly string[],
  ): 'yes' | 'no' | 'unknown' | 'unread' {
    const unread = rowsUnreadOnce()
    const orUnread = <Answer>(answer: Answer): Answer | 'unread' =>
      unread.count > 0 || unread.ledgersSkipped > 0 ? 'unread' : answer
    const seen = new Set<string>()
    const next = [conversation]
    while (next.length > 0) {
      const one = next.pop() as string
      if (seen.has(one)) continue
      if (seen.size >= MAX_WAITS_WALKED) return orUnread('unknown')
      seen.add(one)
      const gave = this.theIdsItStandsFor(one).flatMap((id) =>
        this.deps.store.piecesGivenBy(id, unread),
      )
      for (const piece of gave) {
        if (!TASK_IS_OPEN[piece.state]) continue
        const holder = this.theOneInItsPlace(piece.owner)
        if (givers.includes(holder) || givers.includes(piece.owner)) return 'yes'
        next.push(holder)
      }
    }
    return orUnread('no')
  }

  private recordTheServiceConversation(profile: string, provider: Provider): string {
    const agent = this.theServiceAgent(profile)
    if (agent.is !== 'service' || agent.conversation !== null) {
      throw new Error(`${foldProfileName(profile)} is not a service without a conversation`)
    }
    if (!this.servicesAreOn()) throw new ServicesAreOff()
    const read = this.profileExecution
    const entry = read.readable ? read.kept.profiles[agent.identity] : undefined
    if (entry === undefined) throw new Error(`${foldProfileName(profile)} is not a service`)
    const id = this.deps.newSessionId()
    const itsName = foldProfileName(profile)
    const pair = this.modelCatalogues.theSelectedPairIfNamed(provider, itsName)
    const cwd = this.deps.resolveCwd(id, undefined)
    this.keepTheProfileEntry(agent.identity, { ...entry, reserved: id }, true)
    try {
      this.deps.store.create({
        id,
        provider,
        cwd,
        approvalMode: this.deps.store.defaultApprovalMode(),
        profileId: itsName,
        ...(pair === null ? {} : { model: pair.model }),
        ...(pair?.effort == null ? {} : { reasoningEffort: pair.effort }),
        service: true,
      })
    } catch (error) {
      this.keepTheProfileEntry(agent.identity, entry, false)
      throw error
    }
    this.keepTheProfileEntry(agent.identity, { ...entry, serviceConversation: id }, false)
    this.theWorldMoved('conversations')
    this.theWorldMoved('agents')
    return id
  }

  private acceptAtTheService(
    service: string,
    giving: ThePieceWrittenDown,
    messageId: string,
    pairAsked: ModelAndEffort | null,
  ): void {
    const slot = this.slots.get(service)
    if (slot !== undefined && slot.session === null && !onItsWayOut(slot)) {
      throw new Error(`${service} is still starting, so ${giving.label} was not written`)
    }
    const session = slot?.session ?? null
    if (session !== null) {
      if (!this.recordTheGive(session, giving, messageId, pairAsked)) {
        throw new Error(`${giving.label} could not be written for ${service}`)
      }
      return
    }
    const event: WorkGivenEvent = {
      type: 'work_given',
      piece: giving.piece,
      label: giving.label,
      parent: giving.parent,
      givenBy: giving.giver,
      title: giving.title,
      brief: giving.brief,
      definitionOfDone: giving.definitionOfDone,
      messageId,
      ...(giving.givenFolder === null ? {} : { givenFolder: giving.givenFolder }),
      ...(pairAsked === null ? {} : { asked: pairAsked }),
    }
    const ordinal = this.deps.store.nextOrdinal(service)
    const at = this.now()
    this.deps.store.recordGive(
      {
        piece: giving.piece,
        parent: giving.parent,
        number: giving.number,
        owner: service,
        givenBy: giving.giver,
        title: giving.title,
        brief: giving.brief,
        folder: giving.folder,
        inputs: giving.inputs,
      },
      ordinal,
      event,
      at,
    )
    this.showTheWindowsLookingAt(service, { sessionId: service, ordinal, at, event })
    this.theWorldMoved('work')
  }

  private aServiceMayTakeItsNext(conversation: string): void {
    if (!this.servicesAreOn() || this.servicesToAdvance.has(conversation)) return
    this.servicesToAdvance.add(conversation)
    queueMicrotask(() => {
      this.servicesToAdvance.delete(conversation)
      try {
        this.advanceTheService(conversation)
      } catch (error) {
        console.warn(
          `runtime host could not hand ${conversation} its next piece: ${errorMessage(error)}`,
        )
      }
    })
  }

  private advanceTheService(conversation: string): void {
    if (!this.servicesAreOn() || this.deps.profileExecution?.owned !== true) return
    if (this.launches.closed) return
    const service = this.theServiceOf(conversation)
    if (service === null || service === 'unknown') return
    if (
      this.servicesStarting.has(conversation) ||
      this.servicesHeldBack.has(conversation) ||
      this.servicesReadingAPair.has(conversation)
    ) {
      return
    }
    const read = this.pairsReadForTheHead.get(conversation)
    this.pairsReadForTheHead.delete(conversation)
    const queue = this.theQueueOf(conversation)
    if (queue === null || queue.blocking.length > 0) return
    const slot = this.slots.get(conversation)
    const session = slot?.session ?? null
    const held = this.deps.store
      .messagesWaitingIn(conversation)
      .find((one) => one.piece !== undefined && one.rebrief !== true)
    if (held !== undefined) {
      if (slot === undefined && !this.startsInFlight.has(conversation)) {
        this.startTheServiceFor(conversation, held.messageId)
      }
      return
    }
    const head = queue.waiting[0]
    if (head === undefined || head.messageId === null) return
    if (slot !== undefined && (session === null || !this.freeForItsNextPiece(session))) return
    let pair = head.asked ?? this.theServicesOwnPair(conversation)
    let unread: string | null = null
    if (
      pair === null &&
      session !== null &&
      this.deps.store.whatItRunsOn(conversation)?.aPersonChoseItAt == null
    ) {
      if (read === undefined || read.life !== session || read.piece !== head.piece) {
        this.readTheHeadsPair(session, head.piece)
        return
      }
      if ('failed' in read) unread = read.failed
      else pair = read.pair
    }
    const by: Caller = head.giver === null ? THE_APP_ITSELF : { ownerId: agentCallerId(head.giver) }
    const from = this.originOf(by)
    const brief: QueuedMessage = {
      id: head.messageId,
      kind: 'work',
      text: head.brief,
      since: this.now(),
      attachments: [],
      authorship: whoseWordsTheseAre(by, this.profileOf),
      piece: head.piece,
      label: head.label,
      ...(from === null ? {} : { origin: from }),
    }
    const row: QueuedMessageEvent = {
      type: 'message_queued',
      messageId: brief.id,
      kind: 'work',
      text: brief.text,
      ...brief.authorship,
      piece: head.piece,
      label: head.label,
    }
    if (session !== null) {
      session.mailbox.push(brief)
      this.publishOurs(session, row)
      if (session.recordingFailure !== null) {
        const at = session.mailbox.indexOf(brief)
        if (at >= 0) session.mailbox.splice(at, 1)
        this.publishStateIfChanged(session)
        return
      }
      if (unread !== null) {
        if (!this.endTheServicesBriefUnsent(conversation, brief.id, unread)) {
          this.servicesHeldBack.add(conversation)
        }
        return
      }
      if (pair !== null) this.switchedFor(conversation, pair)
      this.publishStateIfChanged(session)
      this.flushQueued(session)
    } else {
      if (!this.appendIntoItsLedger(conversation, { ...row, forItsNextStart: true })) {
        this.servicesHeldBack.add(conversation)
        return
      }
      this.heldAtAStop.set(conversation, [...(this.heldAtAStop.get(conversation) ?? []), brief])
      if (pair !== null) this.switchedFor(conversation, pair)
      else if (this.deps.store.whatItRunsOn(conversation)?.aPersonChoseItAt == null) {
        this.thePairSetOn(conversation, null)
      }
      this.startTheServiceFor(conversation, brief.id)
    }
    this.theWorldMoved('work')
  }

  private readTheHeadsPair(life: HostedSession, piece: string): void {
    const conversation = life.id
    const agent = this.deps.store.identityOf(conversation)?.profileSlug ?? null
    this.servicesReadingAPair.add(conversation)
    void this.theSelectedModel(life.provider, agent, agent ?? DEFAULT_PROFILE_ID, {})
      .then(
        (own) => {
          this.pairsReadForTheHead.set(conversation, { piece, life, pair: own })
        },
        (error: unknown) => {
          console.warn(
            `runtime host could not read the pair ${conversation} starts on: ${errorMessage(error)}`,
          )
          this.pairsReadForTheHead.set(conversation, { piece, life, failed: errorMessage(error) })
        },
      )
      .finally(() => {
        this.servicesReadingAPair.delete(conversation)
        this.aServiceMayTakeItsNext(conversation)
      })
  }

  private endTheServicesBriefUnsent(conversation: string, messageId: string, why: string): boolean {
    const session = this.slots.get(conversation)?.session ?? null
    if (session !== null) {
      const queued = session.mailbox.find((one) => one.id === messageId)
      if (queued === undefined) return true
      this.takeQueued(session, queued)
      this.publishOurs(session, {
        type: 'message_unqueued',
        messageId,
        reason: 'abandoned',
        detail: why,
        text: queued.text,
        ...queued.authorship,
      })
      this.publishStateIfChanged(session)
      if (session.recordingFailure !== null) return false
    } else {
      const still = this.deps.store
        .messagesWaitingIn(conversation)
        .find((one) => one.messageId === messageId)
      if (still === undefined) return true
      const ended = this.appendIntoItsLedger(conversation, {
        type: 'message_unqueued',
        messageId,
        reason: 'abandoned',
        detail: why,
        text: still.text,
        ...still.authorship,
      })
      if (!ended) return false
      const left = (this.heldAtAStop.get(conversation) ?? []).filter((one) => one.id !== messageId)
      if (left.length > 0) this.heldAtAStop.set(conversation, left)
      else this.heldAtAStop.delete(conversation)
    }
    this.theWorldMoved('work')
    this.tellWhoeverGaveTheWork(conversation)
    return true
  }

  private theServicesOwnPair(conversation: string): ModelAndEffort | null {
    const agent = this.deps.store.identityOf(conversation)
    const provider = this.theProviderOfConversation(conversation)
    if (agent === null || provider === null) return null
    return this.modelCatalogues.theSelectedPairIfNamed(provider, agent.profileSlug)
  }

  private theServiceStartAGiveMeets(input: unknown): Promise<void> | null {
    if (!this.servicesAreOn()) return null
    const named =
      typeof input === 'object' && input !== null ? (input as { profile?: unknown }).profile : null
    if (typeof named !== 'string') return null
    const agent = this.theServiceAgent(named)
    if (agent.is !== 'service' || agent.conversation === null) return null
    const slot = this.slots.get(agent.conversation)
    return slot !== undefined && slot.session === null && !onItsWayOut(slot) ? slot.arrived : null
  }

  private theQueueOf(
    conversation: string,
  ): { readonly blocking: readonly PieceRow[]; readonly waiting: readonly PieceRow[] } | null {
    const unread = rowsUnreadOnce()
    const open = this.deps.store
      .piecesOwnedBy(conversation, unread)
      .filter((one) => TASK_IS_OPEN[one.state])
    if (unread.count > 0 || unread.ledgersSkipped > 0) return null
    return {
      blocking: open.filter((one) => one.state !== 'waiting'),
      waiting: open.filter((one) => one.state === 'waiting'),
    }
  }

  private thePieceItIsOn(service: string): PieceRow | null {
    const blocking = this.theQueueOf(service)?.blocking
    return blocking?.length === 1 ? (blocking[0] ?? null) : null
  }

  private thePieceItIsOnFor(service: string, by: Caller): PieceRow | null {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null || speaking === service) return null
    const kind = this.theServiceOf(service)
    if (kind === null || kind === 'unknown') return null
    const piece = this.thePieceItIsOn(service)
    const giver = piece?.giver ?? null
    return giver !== null && this.theIdsItStandsFor(speaking).includes(giver) ? piece : null
  }

  private itGaveItToAService(row: WorkRow, by: Caller): boolean {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null || row.givenBy === null) return false
    const kind = this.theServiceOf(row.owner)
    return (
      kind !== null && kind !== 'unknown' && this.theIdsItStandsFor(speaking).includes(row.givenBy)
    )
  }

  private itsCallerMessagesAService(
    service: string,
    by: Caller,
    says: AgentMessageKind | null,
  ): boolean {
    if (this.thePieceItIsOnFor(service, by) === null) return false
    if (says !== null) this.assertMayReach('message', service, by)
    return true
  }

  private itWaitsQueuedThere(row: WorkRow): boolean {
    if (!this.itIsAService(row.owner)) return false
    return this.deps.store
      .piecesOwnedBy(row.owner)
      .some((one) => one.piece === row.piece && this.queuedAtAService(one))
  }

  private stillOnThePieceItWasCutOn(conversation: string): boolean {
    const piece = this.piecesTheCutsWereOn.get(conversation)
    return piece === undefined || this.thePieceItIsOn(conversation)?.piece === piece
  }

  private workThatNames(conversation: string, unread?: RowsUnread): WorkThatNamesIt | null {
    if (this.theServiceOf(conversation) !== null) return null
    return this.deps.store.workThatNames(conversation, unread)
  }

  private servicesAreOn(): boolean {
    const read = this.profileExecution
    return !read.readable || read.kept.servicesOff !== true
  }

  private startForWhatWaits(service: string): void {
    if (!this.servicesAreOn() || this.deps.profileExecution?.owned !== true) return
    if (this.slots.has(service) || this.startsInFlight.has(service)) return
    if (this.launches.closed || this.keptStopped(service)) return
    if (this.startComingAfterTheRestart.has(service) || this.aCutToContinue(service)) return
    if (this.wakeUps.has(service)) return
    try {
      const kind = this.theServiceOf(service)
      if (kind === null || kind === 'unknown') return
      if (this.theQueueOf(service)?.blocking.length !== 1) return
      if (this.deps.store.messagesWaitingIn(service).length === 0) return
    } catch (error) {
      console.warn(`runtime host could not read what waits for ${service}: ${errorMessage(error)}`)
      return
    }
    this.ensureRunning(service, null).catch((error: unknown) => {
      console.warn(`runtime host did not start ${service} for what waits: ${errorMessage(error)}`)
    })
  }

  private servicesHoldItsStartBack(sessionId: string, window: RuntimeEventSink | null): boolean {
    if (window !== null || this.servicesAreOn() || !this.itIsAService(sessionId)) return false
    return !this.anAppOwnedReopenOf(sessionId)
  }

  private servicesHoldWhatItHeld(sessionId: string): boolean {
    if (this.servicesAreOn() || !this.itIsAService(sessionId)) return false
    if (this.anAppOwnedReopenOf(sessionId)) return false
    return !(this.heldAtAStop.get(sessionId) ?? []).some(aPersonsOwn)
  }

  private anAppOwnedReopenOf(sessionId: string): boolean {
    return (
      this.reopeningForWhatWaited.has(sessionId) || this.reopeningForApprovedTools.has(sessionId)
    )
  }

  private servicesHoldItBack(sessionId: string, by: Caller): boolean {
    if (this.servicesAreOn() || aPersonIsAsking(by)) return false
    return this.itIsAService(this.theOneInItsPlace(sessionId))
  }

  private async leaveForTheServicesStart(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[],
    kind: MailboxKind,
    facts: FactsAQueueCarries,
    says: AgentMessageKind,
  ): Promise<QueueOutcome> {
    const to = this.theOneInItsPlace(sessionId)
    await this.refuseBeforeAStart(to, text, by, attachments, says)
    const from = this.originOf(by)
    const toProfile = from?.who === 'a-caller-with-an-id' ? this.profileOf(to) : null
    const kept = await this.keptUntilItStarts(to, text, facts, kind, { by, says, attachments })
    if (kept.outcome === 'queued') {
      this.noteTheSending(
        from,
        { id: to },
        says,
        'queued',
        facts.aboutPiece ?? null,
        kept.messageId,
        toProfile,
        text,
        this.theReceiverOf(to, facts),
      )
    }
    return kept
  }

  private theReceiverOf(
    to: string,
    facts: Pick<TurnFacts, 'messageAct' | 'addressedAs'>,
  ): { readonly messageAct?: string; readonly addressedAs?: string; readonly toLabel?: string } {
    let toLabel: string | undefined
    try {
      const named = this.nameByItsWork(to)
      if (named.length > 0 && named.length <= REPLY_SUMMARY_LIMIT) toLabel = named
    } catch {
      // Delivery does not depend on this optional display name.
    }
    const { messageAct, addressedAs } = facts
    return {
      ...(messageAct === undefined ? {} : { messageAct }),
      ...(addressedAs === undefined || addressedAs.length === 0 || addressedAs.length > 200
        ? {}
        : { addressedAs }),
      ...(toLabel === undefined ? {} : { toLabel }),
    }
  }

  private keptUntilItStarts(
    to: string,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind,
    left?: WordsLeftForAService,
  ): Promise<QueueOutcome> {
    return new Promise<QueueOutcome>((kept, failed) => {
      this.holdUntilItStarts(
        to,
        text,
        facts,
        kind,
        (where, id) => {
          if (where === 'nowhere' || id === undefined) {
            failed(new Error('the words could not be kept for its next start'))
          } else kept({ outcome: 'queued', messageId: id })
        },
        undefined,
        left,
      )
    })
  }

  private itIsAService(conversation: string): boolean {
    return this.theServiceOf(conversation) !== null
  }

  private theReachOfACallersWords(
    sessionId: string,
    queued: Pick<QueuedMessage, 'origin' | 'piece' | 'rebrief'>,
  ): 'reaches' | 'outlived' | 'unknown' | null {
    const from = queued.origin
    if (from?.who !== 'a-caller-with-an-id') return null
    try {
      const kind = this.theServiceOf(sessionId)
      if (kind === null) return null
      if (kind === 'unknown' && !this.profileExecution.readable) return 'unknown'
      const queue = this.theQueueOf(sessionId)
      if (queue === null) return 'unknown'
      const { piece } = queued
      if (piece !== undefined && queued.rebrief !== true) {
        if (queue.waiting.some((one) => one.piece === piece)) return 'reaches'
      }
      const by = { ownerId: agentCallerId(from.caller) }
      return this.thePieceItIsOnFor(sessionId, by) === null ? 'outlived' : 'reaches'
    } catch (error) {
      console.warn(`runtime host could not read whom ${sessionId} is on: ${errorMessage(error)}`)
      return 'unknown'
    }
  }

  private aCallersWordsWaitForItsQueue(session: HostedSession): boolean {
    return session.mailbox.some(
      (queued) => this.theReachOfACallersWords(session.id, queued) === 'unknown',
    )
  }

  private aBriefWaitsForServices(session: HostedSession): boolean {
    if (this.servicesAreOn()) return false
    return session.mailbox.some((queued) => this.aServiceBrief(session, queued))
  }

  private onAnotherCallersPiece(service: string, by: Caller): boolean {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) return false
    const kind = this.theServiceOf(service)
    if (kind === null || kind === 'unknown' || this.thePieceItIsOn(service) === null) return false
    if (this.thePieceItIsOnFor(service, by) !== null) return false
    const ids = this.theIdsItStandsFor(speaking)
    return (this.theQueueOf(service)?.waiting ?? []).some(
      (one) => one.giver !== null && ids.includes(one.giver),
    )
  }

  private freeForItsNextPiece(session: HostedSession): boolean {
    return (
      !this.startsInFlight.has(session.id) &&
      !this.stopsOnTheirWay.has(session) &&
      session.recordingFailure === null &&
      !this.itStoppedUnder(session) &&
      session.flushing === null &&
      session.handle.status() === 'idle' &&
      session.mailbox.length === 0 &&
      session.holdingQueue === 0 &&
      !this.arrivals.has(session.id) &&
      !this.somethingIsOnItsWayTo(session) &&
      !somethingRunning(session.background) &&
      !scheduleHeld(session.scheduled)
    )
  }

  private startTheServiceFor(conversation: string, messageId: string): void {
    if (this.servicesStarting.has(conversation)) return
    this.servicesStarting.add(conversation)
    void this.ensureRunning(conversation, null).then(
      () => {
        this.servicesStarting.delete(conversation)
        this.aServiceMayTakeItsNext(conversation)
      },
      (error: unknown) => {
        console.warn(
          `runtime host could not start ${conversation} for its next piece: ${errorMessage(error)}`,
        )
        if (this.launches.closed || this.slots.get(conversation)?.session != null) {
          this.servicesStarting.delete(conversation)
          return
        }
        if (!this.endTheServicesBriefUnsent(conversation, messageId, errorMessage(error))) {
          this.servicesHeldBack.add(conversation)
        }
        this.servicesStarting.delete(conversation)
      },
    )
  }

  private aServiceBrief(session: HostedSession, queued: QueuedMessage): boolean {
    if (queued.kind !== 'work' || queued.piece === undefined || queued.rebrief === true) {
      return false
    }
    if (this.theServiceOf(session.id) === null) return false
    return this.deps.store
      .piecesOwnedBy(session.id)
      .some((one) => one.piece === queued.piece && one.messageId === queued.id)
  }

  private queuedAhead(piece: string, owner: string): number | null {
    if (this.theServiceOf(owner) === null) return null
    const open = this.deps.store
      .piecesOwnedBy(owner, rowsUnreadOnce())
      .filter((one) => TASK_IS_OPEN[one.state])
    const at = open.findIndex((one) => one.piece === piece)
    return at < 0 ? null : at
  }

  private withItsPlaceInTheQueue(
    row: PieceRow,
    bounded?: {
      readonly pieces: readonly PieceRow[]
      readonly waits: (id: string) => WhatAConversationIsWaitingOn
    },
  ): PieceRow {
    if (row.messageId === null || row.briefHandedOver === true || !TASK_IS_OPEN[row.state]) {
      return row
    }
    if (this.theServiceOf(row.owner) === null) return row
    const open = bounded?.pieces.filter((one) => TASK_IS_OPEN[one.state])
    const queued =
      bounded === undefined
        ? this.theQueueOf(row.owner)?.waiting.find((one) => one.piece === row.piece)
        : open?.find((one) => one.state === 'waiting' && one.piece === row.piece)
    if (queued === undefined) return row
    const active =
      bounded === undefined
        ? []
        : composeWhatEachPieceIsWaitingOn(
            (open ?? []).filter((one) => one.state !== 'waiting'),
            bounded.waits,
          )
    const stalledAt =
      bounded === undefined
        ? this.whenItsActivePieceStalled(row.owner)
        : active.length === 1 && active[0]?.state === 'stalled'
          ? active[0].stalledAt
          : null
    return {
      ...queued,
      queuedBehind:
        bounded === undefined
          ? (this.queuedAhead(row.piece, row.owner) ?? 0)
          : Math.max(0, open?.findIndex((one) => one.piece === row.piece) ?? 0),
      ...(stalledAt === null ? {} : { queueStalledAt: stalledAt }),
      ...(this.servicesAreOn() ? {} : { queueWaitsForServices: true as const }),
    }
  }

  private theExchangeShownWith(piece: PieceRow): Exchange {
    if (this.theServiceOf(piece.owner) !== null) {
      const active = this.theQueueOf(piece.owner)?.blocking
      if (active?.length !== 1 || active[0]?.piece !== piece.piece) {
        return { received: null, answer: null }
      }
    }
    return this.deps.store.lastExchange(piece.owner)
  }

  private whenItsActivePieceStalled(service: string): number | null {
    const unread = rowsUnreadOnce()
    const active = composeWhatEachPieceIsWaitingOn(
      this.deps.store
        .piecesOwnedBy(service, unread)
        .filter((one) => TASK_IS_OPEN[one.state] && one.state !== 'waiting'),
      this.oneWaitReadPerAnswer(unread),
    )
    if (unread.count > 0 || unread.ledgersSkipped > 0 || active.length !== 1) return null
    return active[0]?.state === 'stalled' ? active[0].stalledAt : null
  }

  private queuedAtAService(piece: PieceRow): boolean {
    return piece.state === 'waiting' && this.theServiceOf(piece.owner) !== null
  }

  private theServiceConversationIs(
    identity: string,
    conversation: string,
    now: 'going' | 'gone' | 'kept',
  ): void {
    const read = this.profileExecution
    const entry = read.readable ? read.kept.profiles[identity] : undefined
    if (entry?.serviceConversation !== conversation) {
      if (now === 'going') throw new Error('this is not the conversation kept as the service’s')
      return
    }
    if (
      now === 'going' &&
      (this.profileExecutionConflicts.includes(identity) || entry.reserved !== undefined)
    ) {
      throw new Error('what is kept about this service is unsettled')
    }
    if (now === 'going') {
      this.keepTheProfileEntry(identity, { ...entry, removing: conversation }, true)
    } else if (now === 'gone') {
      const { identityCreatedAt } = entry
      this.keepTheProfileEntry(identity, { kind: 'service', identityCreatedAt }, false)
    } else {
      this.keepTheProfileEntry(identity, entryWithout(entry, 'removing'), false)
    }
  }

  private normalPoolsInTree(
    tree: readonly string[],
  ): readonly { identity: string; giver: string }[] {
    const read = this.profileExecution
    if (!read.readable) throw new Error('worker ownership is unreadable')
    const selected = new Set(tree)
    const affected: { identity: string; giver: string }[] = []
    const lineages = new Map<string, readonly string[]>()
    let left = 8192
    const lineage = (id: string): readonly string[] => {
      const known = lineages.get(id)
      if (known !== undefined) return known
      const ids = this.deps.store.workerLineage(id)
      left -= ids.length
      if (left < 0) throw new Error('worker ownership exceeds its reading bound')
      lineages.set(id, ids)
      return ids
    }
    for (const [identity, entry] of Object.entries(read.kept.profiles)) {
      for (const pool of entry.workerPools ?? []) {
        const ids = [...lineage(pool.giver)]
        for (const worker of pool.workers) {
          const { phase: bindingPhase } = worker
          if (
            bindingPhase === 'reserved' &&
            this.deps.store.recordedOne(worker.conversation) === null
          ) {
            if (this.slots.has(worker.conversation) || this.startsInFlight.has(worker.conversation))
              throw new Error('a worker is still starting')
            continue
          }
          ids.push(...lineage(worker.conversation))
        }
        if (!ids.some((id) => selected.has(id))) continue
        if (ids.some((id) => !selected.has(id))) {
          throw new Error(
            'This conversation shares workers with another conversation. Archive it instead.',
          )
        }
        if (this.profileExecutionConflicts.includes(identity) || pool.removing === true) {
          throw new Error('worker ownership is unsettled')
        }
        affected.push({ identity, giver: pool.giver })
      }
    }
    return affected
  }

  private markNormalPoolsRemoving(pools: readonly { identity: string; giver: string }[]): void {
    if (pools.length === 0) return
    const read = this.profileExecution
    if (!read.readable || this.deps.profileExecution?.owned !== true)
      throw new Error('worker ownership cannot be written')
    const profiles = { ...read.kept.profiles }
    for (const { identity, giver } of pools) {
      const entry = profiles[identity]
      if (entry === undefined) throw new Error('worker ownership changed')
      const pool = entry.workerPools?.find((one) => one.giver === giver)
      if (pool === undefined || pool.removing === true) throw new Error('worker ownership changed')
      profiles[identity] = {
        ...entry,
        workerPools: entry.workerPools!.map((one) =>
          one.giver === giver ? { ...one, removing: true } : one,
        ),
      }
    }
    const kept = { ...read.kept, profiles }
    this.deps.profileExecution.write(kept)
    this.profileExecution = { readable: true, kept }
  }

  private retireTheEntryOf(identity: string): ProfileExecution | null {
    const read = this.profileExecution
    if (!read.readable) {
      console.warn(
        `runtime host did not remove ${identity}, since the services list can’t be read (${read.why})`,
      )
      throw new Error(NOT_REMOVED_UNREADABLE)
    }
    const entry = read.kept.profiles[identity]
    if (entry === undefined) return null
    if (this.deps.profileExecution?.owned !== true) throw new Error(NOT_REMOVED_OPEN_TWICE)
    try {
      this.keepTheProfileEntry(identity, { ...entry, retired: true }, true)
    } catch (error) {
      console.warn(`runtime host did not remove ${identity}: ${errorMessage(error)}`)
      throw new Error(NOT_REMOVED_NOT_SAVED, { cause: error })
    }
    return entry
  }

  private settleTheRetiredEntryOf(identity: string, was: ProfileExecution): void {
    try {
      const stays = this.deps.store.agentIdentities().some((one) => one.id === identity)
      this.keepTheProfileEntry(identity, stays ? was : null, false)
    } catch (error) {
      console.warn(`runtime host could not settle ${identity}’s kept entry: ${errorMessage(error)}`)
    }
  }

  private takeTheKeptAttempts(): void {
    const kept = this.deps.scheduleAttempts
    if (kept === undefined) return
    try {
      this.attemptsKept = kept.read()
    } catch (error) {
      console.warn(
        `runtime host could not read what it had done about scheduled jobs: ${errorMessage(error)}`,
      )
    }
  }

  private itsAttempts(conversation: string): ConversationAttempts {
    return this.attemptsKept.conversations[conversation] ?? NOTHING_DONE_FOR_ITS_JOBS
  }

  private withItsAttempts(conversation: string, record: ConversationAttempts): KeptAttempts {
    return {
      conversations: {
        ...this.attemptsKept.conversations,
        [conversation]: { ...record, told: record.told.slice(-MAX_ATTEMPTS_A_CONVERSATION) },
      },
    }
  }

  private keepItsAttempts(conversation: string, record: ConversationAttempts): void {
    this.attemptsKept = this.withItsAttempts(conversation, record)
    try {
      this.deps.scheduleAttempts?.write(this.attemptsKept)
    } catch (error) {
      console.warn(
        `runtime host could not keep what it did about ${conversation}'s jobs: ${errorMessage(error)}`,
      )
    }
  }

  private reserveItsStart(
    conversation: string,
    planned: PlannedWake,
    now: number,
    before: ConversationAttempts = this.startsReserved.get(conversation) ??
      this.itsAttempts(conversation),
  ): void {
    const runs = { ...before.runs }
    for (const run of planned.runs) {
      if (run.startAt > now) continue
      runs[run.making] = { runAt: run.runAt, startedAt: now, unanswered: run.unanswered }
    }
    const record: ConversationAttempts = {
      ...before,
      attempts: recordScheduleAdmission(planned.admission, now),
      admittedAt: now,
      runs,
      at: now,
    }
    const next = this.withItsAttempts(conversation, record)
    try {
      this.deps.scheduleAttempts?.write(next)
    } catch (error) {
      throw new Error(
        `what this start is made for cannot be kept, so it is not made: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    this.attemptsKept = next
    this.startsReserved.set(conversation, before)
  }

  private letGoOfItsReservation(conversation: string): void {
    const before = this.startsReserved.get(conversation)
    if (before === undefined) return
    this.startsReserved.delete(conversation)
    const next = this.withItsAttempts(conversation, { ...before, at: this.now() })
    try {
      this.deps.scheduleAttempts?.write(next)
      this.attemptsKept = next
    } catch (error) {
      console.warn(
        `runtime host could not put back the start it reserved for ${conversation}, so it stays ` +
          `kept as made: ${errorMessage(error)}`,
      )
    }
  }

  private forgetTheirAttempts(conversations: readonly string[]): void {
    const kept = Object.entries(this.attemptsKept.conversations)
    const left = kept.filter(([id]) => !conversations.includes(id))
    if (left.length === kept.length) return
    this.attemptsKept = { conversations: Object.fromEntries(left) }
    try {
      this.deps.scheduleAttempts?.write(this.attemptsKept)
    } catch (error) {
      console.warn(
        `runtime host could not forget what it did about deleted conversations' jobs: ${errorMessage(error)}`,
      )
    }
  }

  private itsCalendar(): CalendarSource {
    const zone = theZoneReadNow()
    if (this.calendarRead === null || this.calendarRead.zone !== zone) {
      this.calendarRead = { zone, calendar: hostCalendar(zone) }
    }
    return this.calendarRead.calendar
  }

  private itsEvidence(conversation: string): ScheduleEvidence {
    const held = this.scheduleEvidence.get(conversation)
    if (held !== undefined) {
      this.scheduleEvidence.delete(conversation)
      this.scheduleEvidence.set(conversation, held)
      return held
    }
    const evidence = new ScheduleEvidence(conversation, () => THE_ONE_CLOCK_ERA)
    const read = this.deps.store.scheduleEvidenceRows(conversation)
    for (const row of read.rows) evidence.add(row)
    const unmarked = this.attemptsKept.conversations[conversation]?.resetUnmarkedAt
    if (unmarked !== undefined) evidence.itsProviderWasResetAt(unmarked)
    if (read.cut) {
      evidence.itsHistoryIsCut()
      console.info(
        `runtime host: ${conversation} holds more scheduling history than is read — a job made ` +
          'before the rows read is known only from where it is still listed',
      )
    }
    this.scheduleEvidence.set(conversation, evidence)
    if (this.scheduleEvidence.size > SCHEDULES_HELD) {
      const oldest = this.scheduleEvidence.keys().next().value
      if (oldest !== undefined) this.scheduleEvidence.delete(oldest)
    }
    return evidence
  }

  private aScheduleRowWasKept(
    conversation: string,
    ordinal: number,
    event: { readonly type: string },
    at: number,
  ): void {
    const evidence = this.scheduleEvidence.get(conversation)
    if (evidence === undefined || !isScheduleEvidence(event.type, event)) return
    evidence.add({ ordinal, at, rowType: event.type, payload: event })
  }

  private planItsSchedule(conversation: string, now: number): ReceiptSchedulePlan | null {
    try {
      const calendar = this.itsCalendar()
      return planReceiptSchedule(
        this.itsEvidence(conversation).on(calendar),
        aConversationsScope(conversation),
        {
          now,
          wakeLeadMs: WAKE_LEAD_MS,
          calendar,
          clockEra: THE_ONE_CLOCK_ERA,
          clockContinuous: true,
          noticeDelivery: {
            acceptedIds: this.itsAttempts(conversation).told.map((one) => one.id),
            mailbox: [],
          },
        },
      )
    } catch (error) {
      console.warn(
        `runtime host could not plan what ${conversation} has scheduled: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private theLevelItPlans(
    conversation: string,
    plan: ReceiptSchedulePlan,
    now: number,
    itsRuns: ReadonlyMap<string, number | undefined> = new Map(),
    notStarted: ReadonlyMap<string, NotStartedBecause> = new Map(),
  ): ScheduleLevel {
    const evidence = this.itsEvidence(conversation)
    const calendar = this.itsCalendar()
    return {
      jobs: plan.currentListing.jobs.map(({ job }): ScheduledRow => {
        const state = plan.states.find(
          (one) => one.generation.generation === job.evidence?.generation,
        )
        const nominalAt =
          state === undefined
            ? undefined
            : itsRuns.has(job.id)
              ? itsRuns.get(job.id)
              : job.recurring === true
                ? state.age === 'expired'
                  ? undefined
                  : (state.nextNominalAt ??
                    (state.generation.creation === undefined || job.schedule === undefined
                      ? undefined
                      : theRunAfter(job.schedule, now, calendar)))
                : state.display.label === 'scheduled'
                  ? state.pendingNominalAt
                  : undefined
        const { prompt } = evidence.askedBy(job.id)
        const why = notStarted.get(job.id)
        return {
          id: job.id,
          ...(job.schedule === undefined ? {} : { schedule: job.schedule }),
          ...(job.recurring === undefined ? {} : { recurring: job.recurring }),
          ...(prompt === undefined ? {} : { prompt }),
          ...(nominalAt === undefined ? {} : { nominalAt }),
          ...(why === undefined ? {} : { notStarted: why }),
        }
      }),
      dropped: plan.currentListing.dropped,
    }
  }

  private settleWhatItSaw(conversation: string, plan: ReceiptSchedulePlan, now: number): boolean {
    if (plan.notices.length === 0) return false
    try {
      const before = this.itsAttempts(conversation)
      const calendar = this.itsCalendar()
      const { settle } = noticesWorthTelling(
        this.itsEvidence(conversation).on(calendar),
        plan,
        theJobsItWasToldOf(before),
        calendar,
        now,
      )
      if (settle.length === 0) return false
      this.keepItsAttempts(conversation, {
        ...before,
        told: [
          ...before.told,
          ...settle.map((notice) => dealtWith(aWordOfThePlanners(plan, notice), false)),
        ],
        at: now,
      })
      return true
    } catch (error) {
      console.warn(
        `runtime host could not settle what ${conversation} saw of its jobs: ${errorMessage(error)}`,
      )
      return false
    }
  }

  private planItsWake(
    conversation: string,
    now: number,
    lastKnown: ScheduleLevel | undefined = this.wakeUps.get(conversation)?.level,
  ): PlannedWake | null {
    try {
      const evidence = this.itsEvidence(conversation)
      if (evidence.itsLifeIsOpen && !this.slots.has(conversation)) {
        evidence.itsLifeEndedUnseen(this.deps.store.lastStatusAt(conversation) ?? now)
      }
    } catch (error) {
      console.warn(
        `runtime host could not read when ${conversation} last ran: ${errorMessage(error)}`,
      )
    }
    let plan = this.planItsSchedule(conversation, now)
    if (plan === null) return null
    const evidence = this.itsEvidence(conversation)
    if (evidence.historyIsCut && !evidence.readALevel) {
      return this.itsHistoryWasNotReadInFull(conversation, plan, lastKnown)
    }
    if (this.settleWhatItSaw(conversation, plan, now)) {
      plan = this.planItsSchedule(conversation, now)
      if (plan === null) return null
    }
    this.forgetJobsItsPlanNoLongerNames(conversation, plan, now)
    const owed = this.whatItsJobsAreOwed(conversation, plan, now)
    const itsPlan = plan
    const soonest = Math.min(
      owed.admission.startAt ?? Number.POSITIVE_INFINITY,
      ...owed.runs.map((run) => run.startAt),
    )
    return {
      plan,
      admission: owed.admission,
      runs: owed.runs,
      words: [...plan.notices.map((notice) => aWordOfThePlanners(itsPlan, notice)), ...owed.words],
      startAt: Number.isFinite(soonest) ? soonest : null,
      level: this.theLevelItPlans(conversation, plan, now, owed.itsRuns, owed.notStarted),
    }
  }

  private itsHistoryWasNotReadInFull(
    conversation: string,
    plan: ReceiptSchedulePlan,
    lastKnown: ScheduleLevel | undefined,
  ): PlannedWake {
    const kept = this.itsAttempts(conversation)
    const told = new Set(kept.told.map((one) => one.id))
    const jobs = (lastKnown?.jobs ?? []).map((job): ScheduledRow => {
      const untimed: ScheduledRow = { ...job, notStarted: 'history-not-read-in-full' }
      delete (untimed as { nominalAt?: number }).nominalAt
      return untimed
    })
    const words = jobs.flatMap((job): WordOwed[] => {
      const of = JSON.stringify(['listed', job.id, null])
      const id = JSON.stringify(['history-not-read-in-full', of])
      return told.has(id)
        ? []
        : [
            {
              id,
              of,
              job: job.id,
              reason: 'history-not-read-in-full',
              dueAt: null,
              ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
            },
          ]
    })
    if (lastKnown === undefined) {
      console.warn(
        `runtime host: ${conversation}'s history was read only in part and holds no level, and no ` +
          'level of it is known: nothing is planned for its jobs',
      )
    }
    return {
      plan,
      admission: { state: kept.attempts, requests: [], startAt: null },
      runs: [],
      words,
      startAt: null,
      level: { jobs, dropped: lastKnown?.dropped ?? 0 },
    }
  }

  private whatItsJobsAreOwed(
    conversation: string,
    plan: ReceiptSchedulePlan,
    now: number,
  ): OwedToItsJobs {
    const evidence = this.itsEvidence(conversation)
    const kept = this.startsReserved.get(conversation) ?? this.itsAttempts(conversation)
    const calendar = this.itsCalendar()
    const told = new Set(this.itsAttempts(conversation).told.map((one) => one.id))
    const notStarted = new Map<string, NotStartedBecause>()
    const words: WordOwed[] = []
    const say = (reason: AWordOfThisApps, job: string, making: string, about: string): void => {
      const id = JSON.stringify([reason, making, about])
      if (!told.has(id)) words.push({ id, of: making, job, reason, dueAt: null })
    }
    const unheard = new Set<string>()
    for (const { job } of plan.wake.plans) {
      const made = plan.states.find(
        (one) => one.generation.generation === job.evidence?.generation,
      )?.generation
      if (made === undefined || evidence.heardOfSinceItsReset(made)) continue
      unheard.add(job.id)
      notStarted.set(job.id, 'no-word-since-a-reset')
      say('not-listed-since-a-reset', job.id, aJobsMaking(made), evidence.itsReset ?? 'reset')
    }
    const timed = itsRepeatingJobsOfKnownTime(plan).flatMap((one) => {
      if (unheard.has(one.job)) return []
      const next = one.state.nextNominalAt ?? theRunAfter(one.schedule, now, calendar)
      return next === undefined ? [] : [{ ...one, next }]
    })
    const runs = timed.flatMap(({ job, making, schedule, state, next }): RunOwed[] => {
      const { generation } = state
      const listed =
        generation.lastPresence?.kind === 'listing' && generation.presence === 'present'
          ? generation.lastPresence.observedAt
          : undefined
      const last = kept.runs[making]
      const owedFor = (runAt: number | undefined, unanswered: number): RunOwed[] =>
        runAt === undefined
          ? []
          : [{ job, making, runAt, startAt: Math.max(now, runAt - WAKE_LEAD_MS), unanswered }]
      if (last === undefined) return owedFor(next, 1)
      const runAt = last.runAt < next ? next : theRunAfter(schedule, last.runAt, calendar)
      if (listed !== undefined && listed >= last.startedAt) return owedFor(runAt, 1)
      const latest =
        eligibilityBounds(last.runAt, true, calendar.read(last.runAt)?.minute ?? 0)
          ?.latestEligibleAt ?? last.runAt
      if (
        evidence.wasRunningThrough(last.runAt, latest, now) ||
        last.unanswered >= STARTS_WITH_NO_WORD_OF_A_JOB
      ) {
        notStarted.set(job, 'no-word-from-its-provider')
        say('not-started', job, making, String(last.runAt))
        return []
      }
      return owedFor(runAt, last.unanswered + 1)
    })
    const admittedAt = kept.admittedAt
    const broughtBack = new Set(
      admittedAt === null
        ? []
        : plan.wake.plans.flatMap(({ job, result }) => {
            const listed = plan.states.find(
              (one) => one.generation.generation === job.evidence?.generation,
            )?.generation
            return result.kind === 'known' &&
              result.nominalAt > now &&
              listed?.lastPresence?.kind === 'listing' &&
              listed.presence === 'present' &&
              listed.lastPresence.observedAt >= admittedAt
              ? [JSON.stringify(['job', job.id])]
              : []
          }),
    )
    const lostItsMaking = new Set<string>()
    if (evidence.historyIsCut) {
      const made = new Set([
        ...[...Object.keys(kept.runs), ...kept.told.map((one) => one.of)].flatMap((making) => {
          const its = theJobOfAMaking(making)
          return its?.made === true ? [its.job] : []
        }),
        ...kept.attempts.flatMap((one) => {
          if (!one.attempted) return []
          try {
            const key: unknown = JSON.parse(one.key)
            return Array.isArray(key) && key[0] === 'job' && typeof key[1] === 'string'
              ? [key[1]]
              : []
          } catch {
            return []
          }
        }),
      ])
      for (const { job } of plan.wake.plans) {
        const known = plan.states.find(
          (one) => one.generation.generation === job.evidence?.generation,
        )?.generation
        if (known?.creation === undefined && made.has(job.id)) lostItsMaking.add(job.id)
      }
    }
    for (const job of lostItsMaking) {
      notStarted.set(job, 'history-not-read-in-full')
      say('history-not-read-in-full', job, JSON.stringify(['listed', job, null]), 'cut')
    }
    const each = new Set([...timed.map(({ job }) => job), ...unheard, ...lostItsMaking])
    const admission = planScheduleAdmission(
      { ...plan.wake, plans: plan.wake.plans.filter(({ job }) => !each.has(job.id)) },
      kept.attempts.filter((one) => !broughtBack.has(one.key)),
      {
        zone: calendar.identity,
        wakeLeadMs: WAKE_LEAD_MS,
        calendarIdentity: calendar.identity,
        calendarVersion: calendar.version,
        clockEra: THE_ONE_CLOCK_ERA,
      },
    )
    const asked = new Set(admission.requests.map((one) => one.key))
    for (const { job, result } of plan.wake.plans) {
      if (
        unheard.has(job.id) ||
        lostItsMaking.has(job.id) ||
        timed.some((one) => one.job === job.id)
      ) {
        continue
      }
      const made = plan.states.find(
        (one) => one.generation.generation === job.evidence?.generation,
      )?.generation
      if (made === undefined) continue
      const making = aJobsMaking(made)
      const isAsked = asked.has(JSON.stringify(['job', job.id]))
      if (result.kind !== 'known') {
        say('time-not-known', job.id, making, 'once')
        if (!isAsked) notStarted.set(job.id, 'time-not-known')
      } else if (!isAsked && result.nominalAt > now) {
        notStarted.set(job.id, 'no-word-from-its-provider')
        say('not-started', job.id, making, String(result.nominalAt))
      }
    }
    const itsRuns = new Map<string, number | undefined>()
    for (const job of unheard) itsRuns.set(job, undefined)
    for (const { job } of timed) itsRuns.set(job, undefined)
    for (const run of runs) itsRuns.set(run.job, run.runAt)
    return { admission, runs, itsRuns, notStarted, words }
  }

  private forgetJobsItsPlanNoLongerNames(
    conversation: string,
    plan: ReceiptSchedulePlan,
    now: number,
  ): void {
    const kept = this.attemptsKept.conversations[conversation]
    if (kept === undefined) return
    if (this.itsEvidence(conversation).historyIsCut) return
    const named = new Set(plan.states.map((one) => one.generation.jobId))
    const stillNamed = (making: string): boolean => named.has(theJobOfAMaking(making)?.job ?? '')
    const told = kept.told.filter((one) => stillNamed(one.of))
    const runs = Object.entries(kept.runs).filter(([making]) => stillNamed(making))
    if (told.length === kept.told.length && runs.length === Object.keys(kept.runs).length) return
    this.keepItsAttempts(conversation, { ...kept, told, runs: Object.fromEntries(runs), at: now })
  }

  private armTheWakeUpsTheLedgerHolds(
    elsewhere: ReadonlySet<string>,
    levels: ScheduleLevelsAtTheLaunch | null,
  ): void {
    if (levels === null) return
    for (const { conversation, level, notStartedSaid } of levels) {
      if (elsewhere.has(conversation)) continue
      try {
        this.armItsWakeUp(
          conversation,
          Promise.resolve(),
          NEWER_WORDS_ABOUT_ITS_JOBS,
          level,
          notStartedSaid ?? {},
        )
      } catch (error) {
        console.warn(`runtime host could not arm ${conversation}'s wake-up: ${errorMessage(error)}`)
      }
    }
  }

  placeTheWakeUpsAgain(): void {
    const now = this.now()
    for (const [conversation, wakeUp] of [...this.wakeUps]) {
      if (wakeUp.failed === 0 && wakeUp.startAt > now) {
        try {
          this.armItsWakeUp(conversation, wakeUp.lastLifeEnded)
        } catch (error) {
          console.warn(
            `runtime host could not arm ${conversation}'s wake-up: ${errorMessage(error)}`,
          )
        }
      }
      this.stateMayHaveMoved(conversation)
    }
    for (const [conversation, slot] of this.slots) {
      const session = slot.session
      if (session === null || session === undefined || !scheduleHeld(session.scheduled)) continue
      try {
        const said = this.sayWhatIsScheduled(session, now, null)
        if (said !== null && session.sink.alive) this.emit(session, said)
      } catch (error) {
        console.warn(
          `runtime host could not read ${conversation}'s jobs in the new zone: ${errorMessage(error)}`,
        )
      }
      this.stateMayHaveMoved(conversation)
    }
  }

  private armItsWakeUpAtItsStop(session: HostedSession): void {
    if (this.launches.closed) return
    if (!scheduleHeld(session.scheduled) && !this.scheduleEvidence.has(session.id)) return
    try {
      this.armItsWakeUp(
        session.id,
        Promise.resolve(session.terminated),
        undefined,
        session.scheduled,
      )
    } catch (error) {
      console.warn(`runtime host could not arm ${session.id}'s wake-up: ${errorMessage(error)}`)
    }
  }

  private armItsWakeUp(
    conversation: string,
    lastLifeEnded: Promise<unknown>,
    earlierWordsEndBecause: string = NEWER_WORDS_ABOUT_ITS_JOBS_NOW,
    lastKnown: ScheduleLevel | undefined = this.wakeUps.get(conversation)?.level,
    itsLedgerSays: Readonly<Record<string, NotStartedBecause>> | undefined = undefined,
  ): void {
    this.forgetItsWakeUp(conversation)
    if (this.deps.statesMoved === undefined || this.launches.closed) return
    if (this.keptStopped(conversation)) return
    if (this.startable(conversation) === null) return
    const now = this.now()
    const planned = this.planItsWake(conversation, now, lastKnown)
    if (planned === null) return
    const { plan, admission, runs, words, startAt, level } = planned
    this.tellItOfItsJobs(conversation, words, now, earlierWordsEndBecause)
    if (words.length > 0) {
      this.wordsHeld.set(
        conversation,
        words.map((word) => dealtWith(word, true)),
      )
    }
    this.sayWhatItIsNotStartedFor(conversation, level, now, itsLedgerSays)
    if (startAt === null) return
    const wakeUp: WakeUp = {
      level,
      admission,
      runs,
      holdFor: heldUntil(plan, this.itsCalendar(), now, WAKE_LEAD_MS, WAKE_BRIEF_HOLD_MS),
      startAt,
      forATimeAhead: startAt > now,
      failed: 0,
      waitingForItsKey: null,
      timer: null,
      lastLifeEnded,
    }
    this.wakeUps.set(conversation, wakeUp)
    this.setItsWakeUpTimer(conversation, wakeUp, startAt - now)
  }

  private tellItOfItsJobs(
    conversation: string,
    words: readonly WordOwed[],
    now: number,
    earlierWordsEndBecause: string | null,
  ): void {
    if (words.length === 0) return
    const evidence = this.itsEvidence(conversation)
    const about = words.map((word): NoticeAboutAJob => {
      const prompt =
        word.prompt ?? (word.job === undefined ? undefined : evidence.askedBy(word.job).prompt)
      return { reason: word.reason, dueAt: word.dueAt, ...(prompt === undefined ? {} : { prompt }) }
    })
    const text = scheduleNoticesText(about, now)
    if (this.holdsTheseWordsOfItsJobs(conversation, text)) return
    if (earlierWordsEndBecause !== null) {
      this.letGoOfItsMissedJobs(conversation, earlierWordsEndBecause)
    }
    this.holdUntilItStarts(conversation, text, { appNotice: 'a-scheduled-job-that-will-not-run' })
  }

  private holdsTheseWordsOfItsJobs(conversation: string, text: string): boolean {
    try {
      return this.deps.store
        .messagesWaitingIn(conversation)
        .some(
          (row) =>
            row.authorship.appNotice === 'a-scheduled-job-that-will-not-run' && row.text === text,
        )
    } catch (error) {
      console.warn(
        `runtime host could not read what waited for ${conversation}: ${errorMessage(error)}`,
      )
      return false
    }
  }

  private judgeItsWakeUpAgain(conversation: string): boolean {
    const wakeUp = this.wakeUps.get(conversation)
    if (wakeUp === undefined) return true
    try {
      const now = this.now()
      const planned = this.planItsWake(conversation, now)
      if (planned === null) return false
      const held = this.wordsHeld.get(conversation) ?? []
      const heldIds = new Set(held.map((one) => one.id))
      const fresh = planned.words.filter((one) => !heldIds.has(one.id))
      this.tellItOfItsJobs(conversation, fresh, now, null)
      if (fresh.length > 0) {
        this.wordsHeld.set(conversation, [...held, ...fresh.map((word) => dealtWith(word, true))])
      }
      wakeUp.level = planned.level
      wakeUp.admission = planned.admission
      wakeUp.runs = planned.runs
      wakeUp.holdFor = heldUntil(
        planned.plan,
        this.itsCalendar(),
        now,
        WAKE_LEAD_MS,
        WAKE_BRIEF_HOLD_MS,
      )
      const asksNow = planned.startAt !== null && planned.startAt <= now
      if (asksNow && this.startsReserved.has(conversation)) {
        this.reserveItsStart(conversation, planned, now)
      }
      return asksNow
    } catch (error) {
      console.warn(
        `runtime host could not judge ${conversation}'s wake-up again: ${errorMessage(error)}`,
      )
      return false
    }
  }

  private itsStartWasMade(conversation: string, wakeUp: WakeUp | undefined): void {
    try {
      const reserved = this.startsReserved.delete(conversation)
      if (wakeUp === undefined || reserved) return
      const now = this.now()
      const before = this.itsAttempts(conversation)
      const runs = { ...before.runs }
      for (const run of wakeUp?.runs ?? []) {
        if (run.startAt > now) continue
        runs[run.making] = { runAt: run.runAt, startedAt: now, unanswered: run.unanswered - 1 }
      }
      this.keepItsAttempts(conversation, {
        ...before,
        ...(wakeUp === undefined
          ? {}
          : { attempts: recordScheduleAdmission(wakeUp.admission, now), admittedAt: now }),
        runs,
        at: now,
      })
    } catch (error) {
      console.warn(
        `runtime host could not note ${conversation}'s start for its jobs: ${errorMessage(error)}`,
      )
    }
  }

  private theWordsAboutItsJobsWereSent(conversation: string): void {
    try {
      const words = this.wordsHeld.get(conversation) ?? []
      this.wordsHeld.delete(conversation)
      if (words.length === 0) return
      const before = this.itsAttempts(conversation)
      const known = new Set(before.told.map((one) => one.id))
      const told = [...before.told, ...words.filter((one) => !known.has(one.id))]
      this.keepItsAttempts(conversation, { ...before, told, at: this.now() })
    } catch (error) {
      console.warn(
        `runtime host could not note that ${conversation} was told of its jobs: ${errorMessage(error)}`,
      )
    }
  }

  private setItsWakeUpTimer(conversation: string, wakeUp: WakeUp, wait: number): void {
    const timer = setTimeout(
      () => this.itsTimeCame(conversation, wakeUp),
      Math.min(Math.max(wait, 0), WAKE_CHECK_MS),
    )
    if (typeof timer.unref === 'function') timer.unref()
    wakeUp.timer = timer
  }

  private itsSavedKeyCannotBeRead(provider: Provider): boolean {
    try {
      return this.deps.apiKeys?.status(provider).readState === 'unreadable'
    } catch {
      return false
    }
  }

  private waitForItsKey(
    conversation: string,
    wakeUp: WakeUp,
    provider: Provider,
    error: unknown,
  ): void {
    if (wakeUp.timer !== null) clearTimeout(wakeUp.timer)
    wakeUp.timer = null
    wakeUp.waitingForItsKey = provider
    console.warn(
      `runtime host: ${conversation}'s start for its scheduled jobs waits until its saved ` +
        `${provider} key is saved again or removed` +
        (error === null ? '' : `: ${errorMessage(error)}`),
    )
  }

  private letTheWakeUpsWaitingForItsKeyGo(provider: Provider): void {
    for (const [conversation, wakeUp] of this.wakeUps) {
      if (wakeUp.waitingForItsKey !== provider) continue
      wakeUp.waitingForItsKey = null
      wakeUp.failed = 0
      wakeUp.startAt = this.now()
      this.setItsWakeUpTimer(conversation, wakeUp, 0)
    }
  }

  private forgetItsWakeUp(conversation: string): void {
    const wakeUp = this.wakeUps.get(conversation)
    if (wakeUp === undefined) return
    if (wakeUp.timer !== null) clearTimeout(wakeUp.timer)
    this.wakeUps.delete(conversation)
    if (this.wakeUpsDue.get(conversation) === wakeUp) this.wakeUpsDue.delete(conversation)
  }

  private itsTimeCame(conversation: string, wakeUp: WakeUp): void {
    wakeUp.timer = null
    if (this.launches.closed || this.wakeUps.get(conversation) !== wakeUp) return
    const wait = wakeUp.startAt - this.now()
    if (wait > 0) {
      this.setItsWakeUpTimer(conversation, wakeUp, wait)
      return
    }
    this.wakeUpsDue.set(conversation, wakeUp)
    this.takeATurnInTheLine()
  }

  private theNextWakeUpDue(): [string, WakeUp] | undefined {
    return [...this.wakeUpsDue].sort(
      ([, a], [, b]) => Number(b.forATimeAhead) - Number(a.forATimeAhead) || a.startAt - b.startAt,
    )[0]
  }

  private takeATurnInTheLine(): void {
    if (this.aWakeUpHoldsATurn || this.wakeUpsDue.size === 0) return
    this.aWakeUpHoldsATurn = true
    this.restartWakes = this.restartWakes
      .then(async () => {
        let next = this.theNextWakeUpDue()
        while (next !== undefined) {
          const gaps = next[1].forATimeAhead ? 1 : AT_ONCE_START_GAPS
          const wait = this.lastPacedStart + gaps * this.startGapMs - performance.now()
          if (wait <= 0) break
          const pause = Math.min(wait, this.startGapMs)
          await new Promise<void>((resolve) => {
            const gap = setTimeout(resolve, pause)
            gap.unref?.()
          })
          next = this.theNextWakeUpDue()
        }
        if (next === undefined) return
        const [conversation, wakeUp] = next
        this.wakeUpsDue.delete(conversation)
        if (this.launches.closed || this.wakeUps.get(conversation) !== wakeUp) return
        await this.wakeItUp(conversation, wakeUp)
        this.lastPacedStart = performance.now()
      })
      .catch((error: unknown) => {
        console.warn(
          `runtime host could not start a conversation for its scheduled jobs: ${errorMessage(error)}`,
        )
      })
      .finally(() => {
        this.aWakeUpHoldsATurn = false
        this.takeATurnInTheLine()
      })
  }

  private async wakeItUp(conversation: string, wakeUp: WakeUp): Promise<void> {
    if (this.launches.closed || this.wakeUps.get(conversation) !== wakeUp) return
    try {
      if (this.slots.has(conversation) || this.startsInFlight.has(conversation)) {
        this.setItsWakeUpTimer(conversation, wakeUp, WAKE_CHECK_MS)
        return
      }
      if (!this.servicesAreOn() && this.itIsAService(conversation)) {
        this.setItsWakeUpTimer(conversation, wakeUp, WAKE_CHECK_MS)
        return
      }
      const startable = this.startable(conversation)
      if (startable === null) {
        this.forgetItsWakeUp(conversation)
        this.stateMayHaveMoved(conversation)
        return
      }
      const until = this.theResetItWaitsFor(
        startable.provider,
        this.limitAccountOf(conversation, this.now()),
      )
      if (until !== null) {
        this.setItsWakeUpTimer(conversation, wakeUp, until - this.now() + this.afterALimitResetsMs)
        return
      }
      if (this.itsSavedKeyCannotBeRead(startable.provider)) {
        this.waitForItsKey(conversation, wakeUp, startable.provider, null)
        return
      }
      await settledWithin(wakeUp.lastLifeEnded, this.closeDrainTimeoutMs)
      if (this.launches.closed || this.wakeUps.get(conversation) !== wakeUp) return
      if (this.slots.has(conversation) || this.startsInFlight.has(conversation)) {
        this.setItsWakeUpTimer(conversation, wakeUp, WAKE_CHECK_MS)
        return
      }
      const now = this.now()
      const planned = this.planItsWake(conversation, now)
      if (planned === null) throw new Error('its scheduled jobs could not be planned')
      if (planned.startAt === null) {
        this.forgetItsWakeUp(conversation)
        this.stateMayHaveMoved(conversation)
        return
      }
      if (planned.startAt > now) {
        this.armItsWakeUp(conversation, wakeUp.lastLifeEnded, undefined, wakeUp.level)
        this.stateMayHaveMoved(conversation)
        return
      }
      wakeUp.admission = planned.admission
      wakeUp.runs = planned.runs
      this.reserveItsStart(conversation, planned, now)
      console.info(`runtime host: starting ${conversation} for its scheduled jobs`)
      this.wakingForItsJobs.add(conversation)
      try {
        await this.ensureRunning(conversation, null)
      } finally {
        this.wakingForItsJobs.delete(conversation)
      }
    } catch (error) {
      this.letGoOfItsReservation(conversation)
      this.itsStartFailed(conversation, wakeUp, error)
    }
  }

  private itsStartFailed(conversation: string, wakeUp: WakeUp, error: unknown): void {
    if (this.launches.closed || this.wakeUps.get(conversation) !== wakeUp) {
      console.warn(
        `runtime host could not start ${conversation} for its scheduled jobs: ${errorMessage(error)}`,
      )
      return
    }
    if (itCanNeverBeReopened(error)) {
      console.warn(
        `runtime host: ${conversation} can never be reopened, so nothing starts it for its ` +
          `scheduled jobs: ${errorMessage(error)}`,
      )
      this.forgetItsWakeUp(conversation)
      this.letGoOfItsMissedJobs(conversation, ITS_JOBS_WENT_WITH_ITS_HISTORY)
      this.wordsHeld.delete(conversation)
      this.stallWhatItsJobWouldHaveDriven(conversation)
      this.stateMayHaveMoved(conversation)
      return
    }
    if (!scheduleHeld(wakeUp.level)) {
      console.warn(
        `runtime host could not start ${conversation} to tell it of its scheduled jobs — the ` +
          `words go at its next start: ${errorMessage(error)}`,
      )
      this.forgetItsWakeUp(conversation)
      this.stateMayHaveMoved(conversation)
      return
    }
    const provider = this.startable(conversation)?.provider
    if (provider !== undefined && this.itsSavedKeyCannotBeRead(provider)) {
      this.waitForItsKey(conversation, wakeUp, provider, error)
      return
    }
    wakeUp.failed += 1
    const wait = Math.min(WAKE_CHECK_MS * 2 ** (wakeUp.failed - 1), WAKE_RETRY_MAX_MS)
    wakeUp.startAt = this.now() + wait
    console.warn(
      `runtime host could not start ${conversation} for its scheduled jobs, and tries again in ` +
        `${wait}ms: ${errorMessage(error)}`,
    )
    this.setItsWakeUpTimer(conversation, wakeUp, wait)
  }

  private letGoOfItsMissedJobs(
    conversation: string,
    why: string,
    notice: AppNotice = 'a-scheduled-job-that-will-not-run',
  ): void {
    let open: readonly WaitingMessage[]
    try {
      open = this.deps.store.messagesWaitingIn(conversation)
    } catch (error) {
      console.warn(
        `runtime host could not read what waited for ${conversation}: ${errorMessage(error)}`,
      )
      return
    }
    const ended = new Set<string>()
    for (const row of open) {
      if (row.authorship.appNotice !== notice) continue
      this.appendIntoItsLedger(conversation, {
        type: 'message_unqueued',
        messageId: row.messageId,
        reason: 'abandoned',
        detail: why,
        text: row.text,
        ...row.authorship,
      })
      ended.add(row.messageId)
    }
    if (ended.size === 0) return
    const left = (this.heldAtAStop.get(conversation) ?? []).filter((one) => !ended.has(one.id))
    if (left.length > 0) this.heldAtAStop.set(conversation, left)
    else this.heldAtAStop.delete(conversation)
    this.theWorldMoved('work')
  }

  private letGoOfJobsItNeverRestored(session: HostedSession, until: number): void {
    const timer = setTimeout(
      () => {
        const slot = this.slots.get(session.id)
        if (this.launches.closed || slot?.session !== session || onItsWayOut(slot)) return
        if (session.providerSpokeOfItsJobs) return
        if (until > this.now()) {
          this.letGoOfJobsItNeverRestored(session, until)
          return
        }
        console.info(
          `runtime host: ${session.id}'s provider has said nothing of the jobs it was started for ` +
            'since they were due — it holds none of them now',
        )
        session.scheduled = NOTHING_SCHEDULED
        this.stateMayHaveMoved(session.id)
      },
      Math.min(Math.max(until - this.now(), 0), WAKE_CHECK_MS),
    )
    if (typeof timer.unref === 'function') timer.unref()
  }

  private announceTheWorkItHolds(sessionId: string): void {
    let itHoldsWork = true
    try {
      itHoldsWork = this.deps.store.openPiecesOf(sessionId).length > 0
    } catch (error) {
      console.warn(`runtime host could not read ${sessionId}'s work: ${errorMessage(error)}`)
    }
    if (itHoldsWork) this.theWorldMoved('work')
  }

  private whyNotOurs(slot: SessionSlot): string | null {
    if (this.slots.get(slot.id) !== slot)
      return 'lost its reservation while its provider was starting'
    if (onItsWayOut(slot)) return 'was closed while its provider was still starting'
    return null
  }

  private async handBack(slot: SessionSlot, handle: SessionHandle): Promise<void> {
    this.abandon(slot)
    const closing = (async () => handle.close())().catch((error: unknown) => {
      const home = this.homeLaunches.get(slot.launch)
      if (home !== undefined) home.uncertain = true
      console.warn(
        `runtime session ${slot.id} failed to close while starting: ${errorMessage(error)}`,
      )
    })
    this.launches.finish(slot.launch, this.terminationOf(handle, closing, slot.launch))
    if (!(await settledWithin(closing, this.closeDrainTimeoutMs))) {
      console.warn(
        `runtime session ${slot.id}: the provider arrived after the session was closed and did not ` +
          `stop within ${this.closeDrainTimeoutMs}ms — a provider process may still be running`,
      )
    }
  }

  private async awaitLaunch(
    slot: SessionSlot,
    opening: { readonly provider: Provider; readonly kind: 'fresh' | 'resume' },
    launch: (startPhases: StartPhaseSink) => Promise<SessionHandle>,
  ): Promise<SessionHandle> {
    if (this.deps.beforeProviderLaunch) {
      await this.deps.beforeProviderLaunch()
      if (slot.launch.signal.aborted || this.slots.get(slot.id) !== slot || onItsWayOut(slot))
        throw new SessionUnavailable(
          'cancelled',
          'The launch was cancelled while cleanup finished.',
        )
    }
    const timing = this.timeTheLaunch(slot.id, opening)
    try {
      const handle = await this.startedAfterARefusedCopy(
        opening.provider,
        slot.profileId,
        () => launch(timing.phase),
        () => !this.launches.closed && this.slots.get(slot.id) === slot && !onItsWayOut(slot),
      )
      timing.end('ready')
      return handle
    } catch (error) {
      const terminated = this.rejectedConnectionTermination(error, slot.launch)
      if (terminated !== undefined) this.launches.finish(slot.launch, terminated)
      timing.end(slot.launch.signal.aborted ? 'cancelled' : 'failed')
      if (!slot.launch.signal.aborted) throw error
      throw new SessionUnavailable(
        this.launches.closed ? 'shutting-down' : 'cancelled',
        `session ${slot.id} was stopped while its provider was starting: ${errorMessage(error)}`,
      )
    }
  }

  private timeTheLaunch(
    session: string,
    opening: { readonly provider: Provider; readonly kind: 'fresh' | 'resume' },
  ): { readonly phase: StartPhaseSink; readonly end: (outcome: StartAttemptOutcome) => void } {
    const write = this.recordStartAttempt
    const of = {
      v: 1 as const,
      attempt: `att_${randomUUID()}`,
      session,
      provider: opening.provider,
      opening: opening.kind,
    }
    const began = this.monotonicNow()
    const phases: Partial<Record<StartPhase, number>> = {}
    let lastPhase: StartPhase | null = null
    let responseBytes: number | null = null
    let ended = false
    const written = (line: StartAttemptLine): void => {
      if (write === undefined) return
      try {
        write(line)
      } catch (error) {
        console.warn(`runtime host could not write a launch's timing: ${errorMessage(error)}`)
      }
    }
    written({ ...of, stage: 'began', at: new Date(this.now()).toISOString() })
    return {
      phase: (phase, detail) => {
        phases[phase] = Math.round(this.monotonicNow() - began)
        lastPhase = phase
        if (detail?.bytes !== undefined) responseBytes = detail.bytes
      },
      end: (outcome) => {
        if (ended) return
        ended = true
        written({
          ...of,
          stage: 'ended',
          at: new Date(this.now()).toISOString(),
          outcome,
          elapsedMs: Math.round(this.monotonicNow() - began),
          phases: { ...phases },
          lastPhase,
          responseBytes,
        })
      },
    }
  }

  async cancelLaunch(launchKey: string, ownerId: string): Promise<boolean> {
    const slot = [...this.slots.values()].find(
      (candidate) =>
        candidate.launchKey === launchKey &&
        candidate.ownerId === ownerId &&
        candidate.session === null &&
        !onItsWayOut(candidate),
    )
    if (slot === undefined) {
      const waiting = [...this.ownedWaits].find(
        (one) =>
          one.launchKey === launchKey &&
          one.ownerId === ownerId &&
          !one.released &&
          !one.cancelled &&
          !one.handedOver,
      )
      if (waiting === undefined) return false
      waiting.cancelled = true
      waiting.stop()
      return true
    }
    await this.close(slot.id, THE_APP_ITSELF)
    return true
  }

  async createSession(
    input: CreateSessionInput,
    sink: RuntimeEventSink | null,
    commandedBy: CallerIdentity | null = null,
    spawn: AdmittedSpawn | null = null,
  ): Promise<CreatedSession> {
    if (this.isAServicesAgent(input.profileId ?? DEFAULT_PROFILE_ID)) {
      throw new Error(NOT_STARTED_A_SERVICE)
    }
    if (spawn !== null && commandedBy !== null) {
      throw new Error('a spawn carries its own commanding caller; do not pass a second one')
    }
    const commander = spawn === null ? commandedBy : spawn.commandedBy
    const worker = this.reservingNormalWorker
    if (
      worker !== null &&
      (spawn === null ||
        (spawn.parentSessionId !== worker.fact.giver &&
          !this.deps.store.workerGiverContains(worker.fact.giver, spawn.parentSessionId)) ||
        foldProfileName(input.profileId ?? DEFAULT_PROFILE_ID) !==
          this.deps.store.agentIdentities().find((one) => one.id === worker.fact.identity)?.slug)
    ) {
      throw new Error('worker reservation does not match the admitted start')
    }
    const id = worker?.conversation ?? this.deps.newSessionId()
    const slot = this.refusalsTranslated(() =>
      this.reserve(
        id,
        {
          ownerId: sink?.ownerId ?? null,
          ownerIsAPerson: sink?.aPersonIsBehindIt ?? false,
          commandedBy: commander?.ownerId ?? null,
          spawnedBy: spawn?.parentSessionId ?? null,
          anAgentAskedForIt: spawn !== null,
          profileId: input.profileId ?? DEFAULT_PROFILE_ID,
          provider: input.provider,
        },
        input.launchKey ?? null,
      ),
    )
    if (spawn !== null) this.saveItsProvider(input.profileId ?? DEFAULT_PROFILE_ID, input.provider)
    try {
      return await this.startSession(slot, input, sink ?? NO_SURFACE, spawn)
    } catch (error) {
      this.abandon(slot)
      this.launches.finish(slot.launch)
      throw this.refusalTranslated(this.aRefusalAPersonReads(error, id))
    } finally {
      slot.settle()
    }
  }

  private aShortageAsARefusal(error: unknown, id: string, reopening = false): unknown {
    const shortage = transientSetupFailureOf(error)
    if (shortage === null) return error
    return new SessionUnavailable(
      'machine-ran-short',
      `session ${id} was not ${reopening ? 'reopened' : 'started'}: this machine ran short ` +
        `(${shortage}): ${errorMessage(error)}`,
      { shortage, ...(reopening ? { reopening: true as const } : {}) },
      { cause: error },
    )
  }

  private aRefusalAPersonReads(failed: unknown, id: string, reopening = false): unknown {
    const error = this.aFailedStartAsARefusal(failed, id, reopening)
    const said = this.aFolderAsARefusal(
      this.aShortageAsARefusal(error, id, reopening),
      id,
      reopening,
    )
    return reopening ? saidOfAReopen(said) : said
  }

  private aFailedStartAsARefusal(error: unknown, id: string, reopening = false): unknown {
    const refused = startRefusalOf(error)
    if (refused === null && startFailureOf(error) === null) return error
    return new SessionUnavailable(
      refused === null ? 'its-provider-could-not-be-started' : 'its-provider-refused-it',
      `session ${id} was not ${reopening ? 'reopened' : 'started'}: ${errorMessage(error)}`,
      {
        ...(refused === null || refused.said === null ? {} : { providerSaid: refused.said }),
        ...(reopening ? { reopening: true as const } : {}),
      },
      { cause: error },
    )
  }

  private aFolderAsARefusal(error: unknown, id: string, reopening = false): unknown {
    const folder = folderAPersonMustFixOf(error)
    if (folder === null) return error
    return new SessionUnavailable(
      'its-folder-could-not-be-made',
      `session ${id} was not ${reopening ? 'reopened' : 'started'}: a folder it needs could not be ` +
        `made or written (${folder.code}): ${errorMessage(error)}`,
      { folder, ...(reopening ? { reopening: true as const } : {}) },
      { cause: error },
    )
  }

  private aFolderThatIsGoneAsARefusal(error: unknown, cwd: string, id: string): unknown {
    if (spawnNoWaitClearsOf(error) !== 'ENOENT' || !folderIsGone(cwd)) return error
    return new SessionUnavailable(
      'its-folder-is-gone',
      `session ${id} was not reopened: the folder it ran in is gone (${cwd}): ${errorMessage(error)}`,
      { folder: { code: 'ENOENT', path: cwd, syscall: null }, reopening: true },
      { cause: error },
    )
  }

  private howAFailureReads(error: unknown, readsTranscripts = false): string {
    const shortage = transientSetupFailureOf(error)
    if (shortage === null) {
      const folder = folderAPersonMustFixOf(error, !readsTranscripts)
      if (folder === null) return errorMessage(error)
      const { failed, fix } = whatAFolderRefused(folder)
      return fix === null ? `BroCrew ${failed}` : `BroCrew ${failed}. ${fix}`
    }
    return shortage === 'EMFILE'
      ? 'BroCrew had too many files open'
      : 'this machine ran short of open files, processes or memory'
  }

  private runningAs(sessionId: string): GivingConversation | null {
    const session = this.slots.get(sessionId)?.session
    if (session === null || session === undefined) return null
    return {
      sessionId,
      profileId: session.profileId,
      provider: session.provider,
      cwd: session.cwd,
      approvalMode: effectiveApprovalOf(session),
    }
  }

  agentsVisibleTo(by: Caller, me: string | null): AgentsListed {
    return agentsVisibleTo(this.conversationsVisibleTo(by, me), me, this.archived)
  }

  archivedVisibleTo(by: Caller, me: string | null): ArchivedListed {
    return archivedVisibleTo(this.conversationsVisibleTo(by, me), this.archived, () => this.now())
  }

  whenItWasArchived(id: string): number | null {
    return this.archived.archivedAt(this.theOneInItsPlace(id))
  }

  private conversationsVisibleTo(by: Caller, me: string | null): readonly VisibleConversation[] {
    const reads = this.cardReads()
    return [
      ...[...this.slots.values()]
        .filter((slot) => this.withinMessagingReach(slot.id, by, me))
        .map((slot) => ({
          id: slot.id,
          at: this.deps.store.recordedOne(slot.id)?.updatedAt ?? this.now(),
          card: () => this.cardFor(slot, reads),
        })),
      ...this.everythingStartable()
        .filter(({ startable }) => this.withinMessagingReach(startable.id, by, me))
        .map(({ startable, at }) => ({
          id: startable.id,
          at,
          card: () => this.stoppedCard(startable, reads),
        })),
    ].sort((one, other) => (one.id === me ? -1 : other.id === me ? 1 : other.at - one.at))
  }

  whatOpenedItsLastTurn(
    id: string,
    me: string | null,
  ): { readonly took: ReceivedInATurn | null; readonly readAt: number } {
    const target = this.theOneInItsPlace(id)
    const mayRead = me !== null && (target === me || this.mayReadTheTranscriptOf(target, me))
    return {
      took: mayRead ? this.deps.store.whatOpenedTheLastEndedTurn(target) : null,
      readAt: this.now(),
    }
  }

  agentCard(id: string, by: Caller, me: string | null): AgentCard | null {
    const sessionId = this.theOneInItsPlace(id)
    const slot = this.slots.get(sessionId)
    if (slot === undefined) return this.stoppedCardFor(sessionId, by, me)
    if (!this.withinMessagingReach(sessionId, by, me)) return null
    return this.cardFor(slot, this.cardReads())
  }

  withinMessagingReach(sessionId: string, by: Caller, me: string | null = null): boolean {
    const target = this.slots.get(sessionId) ?? this.startable(sessionId)
    if (target === undefined || target === null) return false
    if (target.id === me) return true
    if (mayCommand(this.commandedNow(target), by)) return true
    const speaking = sessionSpeakingAs(by)
    if (speaking === null || speaking === sessionId) return false
    const mine = this.deps.store.identityOf(speaking)
    if (mine === null) return false
    const allowed = this.deps.store.capabilitiesOf(mine.profileSlug)
    if (allowed === null) return false
    return reachesWhatItDidNotStart(allowed.canMessage) && this.theServiceOf(sessionId) === null
  }

  whyItIsOutOfReach(
    id: string,
    by: Caller,
    me: string | null,
    forAMessage = false,
  ): OutOfReach | null {
    const sessionId = this.theOneInItsPlace(id)
    if (this.withinMessagingReach(sessionId, by, me)) return null
    if (forAMessage && this.thePieceItIsOnFor(sessionId, by) !== null) return null
    if (!this.slots.has(sessionId)) {
      const row = this.deps.store.recordedOne(sessionId)
      if (row === null) return { is: 'no-such-agent' }
      if (!aRowADeliveryCanStart(row)) return { is: 'takes-no-messages' }
    }
    const speaking = sessionSpeakingAs(by)
    const mine = speaking === null ? null : this.deps.store.identityOf(speaking)
    const refusal = refuseOutOfReach(
      mine === null ? null : this.deps.store.capabilitiesOf(mine.profileSlug),
    )
    return {
      is: 'outside-its-reach',
      refusal: { ...refusal, detail: { ...refusal.detail, agent: sessionId } },
    }
  }

  theConversationAddressed(
    address: string,
    by: Caller,
    me: string | null,
    reach: TheDoorsReach,
  ): string {
    const row = this.deps.store.workByLabel(address)
    if (row === null) return address
    const owner = row.owner
    const admitted =
      reach === 'answering' ||
      this.whyItIsOutOfReach(owner, by, me) === null ||
      ((reach === 'messaging' || reach === 'interrupting') && this.itGaveItToAService(row, by)) ||
      (reach === 'interrupting' && this.mayInterrupt(this.theOneInItsPlace(owner), by)) ||
      (reach === 'reading' && me !== null && this.mayReadTheTranscriptOf(owner, me))
    return admitted ? owner : address
  }

  theConversationAProfileNames(
    address: string,
    by: Caller,
    me: string | null,
    forAMessage = false,
  ): AProfileNames {
    if (this.slots.has(address) || this.deps.store.recordedOne(address) !== null) return null
    const named = [
      ...new Set(
        this.deps.store
          .conversationsOf(address)
          .map((one) => this.theOneInItsPlace(one.conversation)),
      ),
    ].filter((one) => this.whyItIsOutOfReach(one, by, me, forAMessage) === null)
    if (named.length === 0) return null
    if (named.length === 1) return { is: 'one', conversation: named[0]! }
    return {
      is: 'several',
      profile: foldProfileName(address),
      labels: named.map((one) => this.addressOf(one)),
    }
  }

  navigationProfileForConversation(conversation: string): string | null {
    return this.deps.store.identityOf(conversation)?.profileSlug ?? null
  }

  navigationIdentity(profile: string): { readonly id: string; readonly name: string } | null {
    const identity = this.deps.store
      .agentIdentities()
      .find((one) => one.slug === foldProfileName(profile))
    return identity === undefined
      ? null
      : { id: identity.id, name: identity.displayName ?? identity.slug }
  }

  profilesVisibleTo(): ProfileReading {
    const read = this.profileExecution
    const conflicts = this.profileExecutionConflicts
    return {
      profiles: this.deps.store.agentIdentities().map((one): ProfileReport => {
        const chosen = this.deps.store.modelChoiceOf(one.slug)
        const runsOn = this.itsProvider(one.slug).provider
        return {
          profile: one.slug,
          displayName: one.displayName,
          provider: runsOn,
          defaultModel:
            chosen !== null && aChoiceIsInForce(chosen, runsOn)
              ? { provider: chosen.provider, model: chosen.model, effort: chosen.effort }
              : null,
          ...(kindOf(read, conflicts, one.id, one.createdAt) === 'service'
            ? { isAService: true as const }
            : {}),
        }
      }),
      usage: this.providerUsage(),
      windowsSeen: this.usageWindowsSeen(),
      readAt: this.now(),
    }
  }

  agentRecord(profile: string, by: Caller, me: string | null): AgentRecordReading {
    const slug = foldProfileName(profile)
    const agent = this.profilesVisibleTo().profiles.find((one) => one.profile === slug)
    if (agent === undefined) return { is: 'no-agent-by-that-name' }
    const itself = me === null ? [] : this.theIdsItStandsFor(me)
    const unread = rowsUnreadOnce()
    const inReach = this.deps.store
      .conversationsOf(agent.profile)
      .filter((one) => this.withinMessagingReach(this.theOneInItsPlace(one.conversation), by, me))
    const shown = inReach.slice(0, CONVERSATIONS_ON_A_RECORD)
    const agentsNamed = new Map<string, string>()
    const agentOf = (conversation: string): string => {
      const known = agentsNamed.get(conversation)
      if (known !== undefined) return known
      const name = this.whatToCallTheConversation(conversation)
      agentsNamed.set(conversation, name)
      return name
    }
    const conversations = shown.map((one): ConversationOnARecord => {
      const archivedAt = this.archived.archivedAt(one.conversation)
      return {
        conversation: one.conversation,
        named: this.workThatNames(one.conversation, unread),
        startedBy: this.whoStartedIt(one, itself, agentOf, unread),
        startedAt: one.startedAt,
        lastChangedAt: one.lastActiveAt,
        inItsPlace: this.whoStandsInItsPlace(one.conversation, unread),
        ...(archivedAt === null ? {} : { archivedAt }),
      }
    })
    const held = this.deps.store.newestPiecesHeldIn(
      inReach.map((one) => one.conversation),
      PIECES_ON_A_RECORD,
      unread,
    )
    const pieces = held.rows.map((piece): PieceOnARecord => ({
      held: piece,
      givenBy:
        piece.giver === null
          ? { is: 'a-person' }
          : itself.includes(piece.giver)
            ? { is: 'you' }
            : {
                is: 'an-agent',
                conversation: piece.giver,
                called: this.calledUnder(piece.giver, piece.piece, agentOf(piece.giver)).called,
              },
    }))
    const made = this.madeFilesOf(agent.profile, FILES_ON_A_RECORD)
    const rules: RulesOnARecord =
      inReach.length === 0 && !this.itsGrantReachesWhatItDidNotStart(by)
        ? { is: 'not-told' }
        : ((line) => (line === null ? { is: 'none' } : { is: 'they-begin', line }))(
            howTheRulesBegin(this.deps.store.configuredLayerFor(agent.profile), RULES_BEGIN_CHARS),
          )
    return {
      is: 'a-record',
      record: {
        agent,
        rules,
        conversations,
        conversationsNotListed: inReach.length - shown.length,
        pieces,
        piecesUnread: held.newest - held.rows.length,
        piecesNotListed: held.total - held.newest,
        files: made.made,
        filesNotListed: made.more,
        rowsUnread: unread.count,
        ...ledgersSkippedOf(unread.ledgersSkipped),
        readAt: this.now(),
      },
    }
  }

  private whoStandsInItsPlace(
    conversation: string,
    unread: RowsUnread,
  ): ConversationOnARecord['inItsPlace'] {
    if (!this.replacedBy.has(conversation)) return null
    const standing = this.theOneInItsPlace(conversation)
    if (standing === conversation || this.replacedBy.has(standing)) return null
    return { conversation: standing, named: this.workThatNames(standing, unread) }
  }

  private whoStartedIt(
    one: { readonly conversation: string; readonly parent: string | null },
    itself: readonly string[],
    agentOf: (conversation: string) => string,
    unread: RowsUnread,
  ): WhoStartedIt {
    const starter = one.parent
    if (starter === null) return { is: 'a-person' }
    if (itself.includes(starter)) return { is: 'you' }
    const from = this.thePieceItWasStartedFrom(one.conversation, starter, unread)
    return {
      is: 'an-agent',
      conversation: starter,
      called:
        from === null ? agentOf(starter) : this.calledUnder(starter, from, agentOf(starter)).called,
    }
  }

  private thePieceItWasStartedFrom(
    conversation: string,
    starter: string,
    unread?: RowsUnread,
  ): string | null {
    const startedWith = this.deps.store.pieceItWasStartedWith(conversation, unread)
    return (
      (startedWith === null ? null : this.deps.store.pieceOfItsChainHeldBy(startedWith, starter)) ??
      this.deps.store.rootOf(starter)?.piece ??
      null
    )
  }

  private theStarterCalled(
    starter: string,
    conversation: string | null,
    startedFrom: string | null,
    agent: string = this.whatToCallTheConversation(starter),
  ): string {
    const from =
      startedFrom ??
      (conversation === null
        ? (this.deps.store.rootOf(starter)?.piece ?? null)
        : this.thePieceItWasStartedFrom(conversation, starter))
    return from === null ? agent : this.calledUnder(starter, from, agent).called
  }

  private theStarterOnACard(
    starter: string | null,
    conversation: string,
    reads: CardReads,
  ): string | null {
    if (starter === null) return null
    const agent = nameTheConversation(whoseConversationIs(this.profileOf(starter), reads.roster))
    return this.theStarterCalled(starter, conversation, null, agent)
  }

  private itsGrantReachesWhatItDidNotStart(by: Caller): boolean {
    const speaking = sessionSpeakingAs(by)
    const mine = speaking === null ? null : this.deps.store.identityOf(speaking)
    const allowed = mine === null ? null : this.deps.store.capabilitiesOf(mine.profileSlug)
    return allowed !== null && reachesWhatItDidNotStart(allowed.canMessage)
  }

  pieceBoard(sessionId: string): PieceBoard {
    return this.workReads.pieceBoard(sessionId)
  }

  pieceRecord(sessionId: string, spelled: string): PieceRecord {
    return this.workReads.pieceRecord(sessionId, spelled)
  }

  madeByItsProfile(sessionId: string): MadeByItsProfile {
    const profile = this.profileOf(sessionId)
    if (profile === null) return { is: 'no-profile' }
    return this.madeFilesOf(profile, MADE_FILES_LISTED)
  }

  private madeFilesOf(
    profile: string,
    limit: number,
  ): MadeByItsProfile & { readonly is: 'listed' } {
    const found = this.deps.store.madeBy(profile, limit)
    const made = found.rows.map((one) => ({
      resource: one.resource,
      label: one.label,
      title: one.pieceTitle,
    }))
    return { is: 'listed', made, more: found.total - made.length }
  }

  findKeptFiles(asAgent: string, asked: FindFilesAsked): Promise<FoundFiles> {
    return this.keptFiles.findKeptFiles(asAgent, asked)
  }

  private childrenOnTheRecord(
    piece: string,
    waiting: (id: string) => WhatAConversationIsWaitingOn,
    unread: RowsUnread,
  ): readonly PieceRow[] {
    const owned = new Map<string, readonly PieceRow[]>()
    return this.deps.store.childrenOf(piece).flatMap((child) => {
      let folded = owned.get(child.owner)
      if (folded === undefined) {
        folded = composeWhatEachPieceIsWaitingOn(
          this.deps.store.piecesOwnedBy(child.owner, unread),
          waiting,
        )
        owned.set(child.owner, folded)
      }
      const one = folded.find((row) => row.piece === child.piece)
      return one === undefined ? [] : [one]
    })
  }

  async takeBackPiece(input: { readonly piece: string }, by: Caller): Promise<TakeBackOutcome> {
    const asking = sessionSpeakingAs(by)
    const waiting = this.untilTheCopiesCanBeEnded(
      asking !== null
        ? this.thePieceItsGiverEnds(input.piece, asking)
        : this.aPersonMayTakeItBack(input.piece, by)
          ? this.pieceNamed(input.piece)
          : null,
    )
    if (waiting !== null) await waiting
    const asAgent = sessionSpeakingAs(by)
    const notYours: TakeBackOutcome = { ok: false, refused: { rail: 'not-a-piece-you-gave' } }
    if (asAgent === null && !this.aPersonMayTakeItBack(input.piece, by)) return notYours
    const row = this.pieceNamed(input.piece)
    if (
      row === null ||
      row.givenBy === null ||
      (asAgent !== null && !this.theIdsItStandsFor(asAgent).includes(row.givenBy))
    ) {
      const itHoldsIt = row !== null && row.owner === asAgent ? this.thePieceItHolds(row) : null
      if (itHoldsIt !== null) {
        return { ok: false, refused: { rail: 'not-a-piece-you-gave', itHoldsIt } }
      }
      return notYours
    }
    const piece = this.deps.store.piecesOwnedBy(row.owner).find((one) => one.piece === row.piece)
    if (piece === undefined || !givenByAConversation(piece)) return notYours
    if (!TASK_IS_OPEN[piece.state]) {
      if (piece.state === 'withdrawn') {
        return {
          ok: false,
          refused: { rail: 'that-piece-was-already-taken-back', label: piece.label },
        }
      }
      if (piece.state === 'closed') {
        return { ok: false, refused: { rail: 'that-piece-was-already-closed', label: piece.label } }
      }
      return {
        ok: false,
        refused: {
          rail: 'that-piece-was-already-answered',
          label: piece.label,
          outcome: piece.outcome,
          resources: piece.resources,
          endedAt: piece.endedAt,
        },
      }
    }
    const queued = this.queuedAtAService(piece)
    const stands = queued
      ? this.whereTheQueuedPieceStands(piece)
      : this.whereItsHolderStands(piece, by)
    if (!stands.ok) {
      return stands.because === 'out-of-its-reach'
        ? notYours
        : { ok: false, refused: { rail: stands.because, label: piece.label } }
    }
    const { session } = stands.held
    const itsTurn = queued ? null : this.theTurnOnThePieceItIsOn(piece, session)
    const copies = this.theCopiesToEnd(piece.owner, piece.piece)
    if (!copies.ok)
      return { ok: false, refused: { rail: copies.because, label: piece.label, ...copies.detail } }
    const tookBackTheMessage = this.takeBackTheHeldMessages(piece, stands.held)
    const endedQuestions =
      openQuestionsByWork(
        this.deps.store.routedRequestsOf(piece.owner),
        this.deps.store.questionsRaisedIn(piece.owner),
      ).get(piece.piece)?.length ?? 0
    const takenBack: WorkTakenBackEvent = {
      type: 'work_taken_back',
      piece: piece.piece,
      by: asAgent,
    }
    this.endThePiece(piece.owner, takenBack, 'work-withdrawn', copies.copies)
    this.takeBackWhatALaterFactMadeFalse(piece, 'withdrawn')
    this.theWorldMoved('work')
    if (session !== null) this.publishStateIfChanged(session)
    const taken = {
      ok: true as const,
      piece: piece.piece,
      label: piece.label,
      owner: piece.owner,
      tookBackTheMessage,
      endedQuestions,
      atAService: this.itIsAService(piece.owner),
      ...(await this.tellItsOwnerItWasTakenBack(piece, asAgent)),
    }
    const notice = asAgent === null ? 'a-piece-a-person-took-back' : 'a-piece-taken-back'
    const theStop = {
      askedItsTurnToStop:
        itsTurn !== null && this.itsNoticeAsksItsTurnToStop(piece, notice, by, itsTurn),
    }
    if (asAgent === null) void this.tellItsGiverAPersonEndedIt(piece, 'took back')
    return { ...taken, ...theStop }
  }

  async takeBackForAPerson(spelled: string, by: Caller): Promise<WorkTakenBackByAPerson> {
    const taken = await this.takeBackPiece({ piece: spelled }, by)
    if (taken.ok) {
      return {
        ok: true,
        piece: taken.piece,
        label: taken.label,
        askedItsTurnToStop: taken.askedItsTurnToStop,
      }
    }
    const { rail } = taken.refused
    if (
      rail === 'that-conversation-has-not-started' ||
      rail === 'that-work-is-being-sent' ||
      rail === 'a-conversation-with-its-questions-is-starting' ||
      rail === 'its-questions-could-not-all-be-read'
    ) {
      return { ok: false, rail }
    }
    const row = this.pieceNamed(spelled)
    const atANormalHolder =
      row !== null && row.givenBy !== null && this.theServiceOf(row.owner) === null
    return {
      ok: false,
      rail: atANormalHolder ? 'not-a-stopped-piece' : 'not-a-piece-a-service-is-on',
    }
  }

  async closeForAPerson(spelled: string, by: Caller): Promise<WorkClosedByAPerson> {
    const notStopped = { ok: false, rail: 'not-a-stopped-piece' } as const
    if (!this.aPersonMayCloseIt(spelled, by)) return notStopped
    const waiting = this.untilTheCopiesCanBeEnded(this.pieceNamed(spelled))
    if (waiting !== null) {
      await waiting
      if (!this.aPersonMayCloseIt(spelled, by)) return notStopped
    }
    const row = this.pieceNamed(spelled)
    if (row === null) return notStopped
    const piece = this.deps.store.piecesOwnedBy(row.owner).find((one) => one.piece === row.piece)
    if (piece === undefined || !TASK_IS_OPEN[piece.state]) return notStopped
    const queued = this.queuedAtAService(piece)
    const stands = queued
      ? this.whereTheQueuedPieceStands(piece)
      : this.whereItsHolderStands(piece, by, (one, caller) => this.aPersonMayCloseIt(one, caller))
    if (!stands.ok) {
      return {
        ok: false,
        rail: stands.because === 'out-of-its-reach' ? 'not-a-stopped-piece' : stands.because,
      }
    }
    const itsTurn = queued ? null : this.theTurnOnThePieceItIsOn(piece, stands.held.session)
    const copies = this.theCopiesToEnd(piece.owner, piece.piece)
    if (!copies.ok) return { ok: false, rail: copies.because }
    this.endThePiece(
      piece.owner,
      { type: 'work_closed', piece: piece.piece, by: null },
      'work-closed',
      copies.copies,
      true,
    )
    this.takeBackTheHeldMessages(piece, stands.held)
    if (givenByAConversation(piece)) this.takeBackWhatALaterFactMadeFalse(piece, 'closed')
    this.theWorldMoved('work')
    const live = this.slots.get(piece.owner)?.session ?? null
    if (live !== null) this.publishStateIfChanged(live)
    if (!queued) await this.tellItsOwnerItWasClosed(piece, null)
    const askedItsTurnToStop =
      itsTurn !== null &&
      this.itsNoticeAsksItsTurnToStop(piece, 'a-piece-a-person-closed', by, itsTurn)
    void this.tellItsGiverAPersonEndedIt(piece, 'closed')
    return { ok: true, piece: piece.piece, label: piece.label, askedItsTurnToStop }
  }

  private aPersonMayCloseIt(spelled: string, by: Caller): boolean {
    if (whoDidIt(by).who !== 'a-person') return false
    const row = this.pieceNamed(spelled)
    if (row === null || row.parent === null) return false
    if (row.givenBy !== null && this.itsHolderStoppedWith(row)) return true
    return this.itIsAStoppedIncident(row)
  }

  private itIsAStoppedIncident(row: WorkRow): boolean {
    const [read] = this.reconciliationReading(row.piece).rows
    return read?.disposition === 'unresolved' && read.issue?.kind === 'stopped'
  }

  private aPersonMayTakeItBack(spelled: string, by: Caller): boolean {
    if (whoDidIt(by).who !== 'a-person') return false
    const row = this.pieceNamed(spelled)
    if (row === null || row.givenBy === null) return false
    if (this.itsHolderStoppedWith(row)) return true
    return this.aPersonMayTakeBack(row.owner, row.piece, row.givenBy)
  }

  private aPersonMayTakeBack(
    owner: string,
    piece: string,
    givenBy: string | null,
    onAt: (owner: string) => string | null = (one) => this.thePieceAServiceIsOn(one),
  ): boolean {
    if (!this.servicesAreOn() || givenBy === null) return false
    return onAt(owner) === piece
  }

  private thePieceAServiceIsOn(owner: string): string | null {
    const service = this.theServiceOf(owner)
    if (service === null || service === 'unknown') return null
    return this.thePieceItIsOn(owner)?.piece ?? null
  }

  private markedForAPerson(edges: LedgerWalk<WorkEdge>): LedgerWalk<WorkEdge> {
    if (!this.servicesAreOn()) return edges
    const read = new Map<string, string | null>()
    const onAt = (owner: string): string | null => {
      if (!read.has(owner)) read.set(owner, this.thePieceAServiceIsOn(owner))
      return read.get(owner) ?? null
    }
    return {
      ...edges,
      rows: edges.rows.map((edge) =>
        this.aPersonMayTakeBack(edge.to, edge.piece, edge.from, onAt)
          ? { ...edge, aPersonMayTakeItBack: true as const }
          : edge,
      ),
    }
  }

  private itsHolderStoppedWith(row: Pick<PieceRow, 'owner' | 'piece'>): boolean {
    const held = this.deps.store.piecesOwnedBy(row.owner).find((one) => one.piece === row.piece)
    if (held === undefined) return false
    return this.theWorkThatStopped([held], this.oneWaitReadPerAnswer()).length > 0
  }

  private async tellItsGiverAPersonEndedIt(
    piece: PieceRow,
    act: 'took back' | 'closed',
  ): Promise<void> {
    if (piece.giver === null) return
    const giver = this.theOneInItsPlace(piece.giver)
    const text = `A person ${act} ${pieceLine(piece.label, piece.title)}. It is no longer owed: do not wait for its answer.`
    const facts = {
      appNotice:
        act === 'closed' ? 'a-piece-it-gave-a-person-closed' : 'a-piece-it-gave-a-person-took-back',
      aboutPiece: { piece: piece.piece, label: piece.label },
    } as const
    try {
      await this.queueMessage(
        giver,
        text,
        THE_APP_ITSELF,
        [],
        'notice',
        facts,
        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
      )
    } catch (error) {
      console.warn(
        `runtime host could not tell ${giver} that a person ${act} ${piece.label}: ${errorMessage(error)}`,
      )
      try {
        this.holdUntilItStarts(giver, text, facts)
      } catch (again) {
        console.warn(
          `runtime host could not keep for ${giver} that a person ${act} ${piece.label}: ${errorMessage(again)}`,
        )
      }
    }
  }

  private theTurnOnThePieceItIsOn(
    piece: PieceRow,
    session: HostedSession | null,
  ): TheTurnOnAPiece | null {
    if (session === null || !this.itIsAService(piece.owner)) return null
    if (this.theServiceOf(piece.owner) === 'unknown') return null
    if (this.thePieceItIsOn(piece.owner)?.piece !== piece.piece) return null
    if (!this.itsTurnIsThePieces(session, piece)) return null
    const status = session.handle.status()
    const runs =
      status === 'working' ||
      status === 'waiting_permission' ||
      session.turnOpened ||
      session.flushing !== null ||
      session.handingOver.length > 0
    return runs ? { life: session, turnsEnded: session.turnsEnded } : null
  }

  private itsTurnIsThePieces(session: HostedSession, piece: PieceRow): boolean {
    const whose = session.itsTurnIs
    return !whose.aPersons && whose.names.every((one) => one === piece.piece)
  }

  private aTurnIsHandedOver(
    session: HostedSession,
    whose: WhoseTurnItIs,
    askedForTheStop: boolean,
    nothingRuns: boolean = session.handle.status() === 'idle',
  ): WhoseTurnItIs {
    session.personalHandover++
    session.personalWorkTurn = null
    const before = session.itsTurnIs
    const names = [...new Set([...before.names, ...whose.names])]
    session.itsTurnIs = !nothingRuns
      ? { aPersons: before.aPersons || whose.aPersons, names }
      : askedForTheStop
        ? { aPersons: whose.aPersons, names }
        : whose
    return before
  }

  private itsNoticeAsksItsTurnToStop(
    piece: PieceRow,
    notice: AppNotice,
    by: Caller,
    itsTurn: TheTurnOnAPiece,
  ): boolean {
    const session = itsTurn.life
    if (this.slots.get(piece.owner)?.session !== session) return false
    if (session.turnsEnded !== itsTurn.turnsEnded || !this.itsTurnIsThePieces(session, piece)) {
      return false
    }
    const held = session.mailbox.find(
      (one) => one.authorship.appNotice === notice && one.drives === piece.piece,
    )
    if (held === undefined) return false
    const asked = this.stopTheTurnItWaitsBehind(session, held, by, true).stop
    if (asked !== 'asked' && asked !== 'already-asked') return false
    session.handle.endEverythingTheTurnStarted?.()
    return true
  }

  private itsNextPieceWaitsForTheStop(session: HostedSession, stop: Promise<void>): void {
    try {
      if (!this.itIsAService(session.id)) return
    } catch (error) {
      console.warn(
        `runtime host could not ask whether ${session.id} is a service: ${errorMessage(error)}`,
      )
    }
    this.stopsOnTheirWay.set(session, (this.stopsOnTheirWay.get(session) ?? 0) + 1)
    void settledWithin(stop, this.interruptWaitMs).then(() => {
      const left = (this.stopsOnTheirWay.get(session) ?? 1) - 1
      if (left > 0) this.stopsOnTheirWay.set(session, left)
      else this.stopsOnTheirWay.delete(session)
      this.aServiceMayTakeItsNext(session.id)
    })
  }

  private thePieceItHolds(row: WorkRow): APieceItHolds | null {
    if (row.parent === null) return { is: 'its-root', label: row.label }
    const held = this.deps.store.piecesOwnedBy(row.owner).find((one) => one.piece === row.piece)
    if (held === undefined) return null
    const { ended } = onePieceAsItStands(held)
    if (ended === undefined) return { is: 'open', label: held.label }
    return {
      is: 'ended',
      label: held.label,
      state: ended,
      ...(held.endedAt === null ? {} : { at: held.endedAt }),
      ...(held.endedBy === null || held.endedBy === held.owner
        ? {}
        : { called: this.whatToCallTheConversation(held.endedBy) }),
      readAt: this.now(),
    }
  }

  private async tellItsOwnerItWasTakenBack(piece: PieceRow, giver: string | null): Promise<Told> {
    if (this.queuedAtAService(piece)) {
      return { delivery: 'not-delivered', whyNotTold: QUEUED_NEVER_TOLD }
    }
    const text = [
      giver === null
        ? `A person took back ${pieceLine(piece.label, piece.title)}. Stop working on it and do not reply_to_parent about it.`
        : `${this.whatToCallTheConversation(giver)} took back ${pieceLine(piece.label, piece.title)}. Stop working on it and do not reply_to_parent about it.`,
      ...this.itsOpenPiecesAreStillYours(piece),
    ].join(' ')
    try {
      if (giver === null) {
        return deliveryOf(
          await this.anAppNoticeToItsHolder(piece, text, 'a-piece-a-person-took-back'),
        )
      }
      return deliveryOf(await this.anAppNoticeToItsHolder(piece, text, 'a-piece-taken-back'))
    } catch (error) {
      console.warn(
        `runtime host could not tell ${piece.owner} that ${piece.label} was taken back: ${errorMessage(error)}`,
      )
      return notTold(error)
    }
  }

  private async tellItsOwnerItWasClosed(piece: PieceRow, giver: string | null): Promise<Told> {
    const text = [
      `${giver === null ? 'A person' : this.whatToCallTheConversation(giver)} closed ${pieceLine(piece.label, piece.title)}: its reply is no longer owed. Stop working on it and do not reply_to_parent about it.`,
      ...this.itsOpenPiecesAreStillYours(piece),
    ].join(' ')
    try {
      return deliveryOf(
        await this.anAppNoticeToItsHolder(
          piece,
          text,
          giver === null ? 'a-piece-a-person-closed' : 'a-piece-closed',
        ),
      )
    } catch (error) {
      console.warn(
        `runtime host could not tell ${piece.owner} that ${piece.label} was closed: ${errorMessage(error)}`,
      )
      return notTold(error)
    }
  }

  private async tellItsOwnerOfItsInputs(
    piece: Pick<PieceRow, 'piece' | 'label' | 'owner'> & { readonly title: string | null },
    giver: string,
    inputs: readonly { readonly resource: string; readonly name: string }[],
  ): Promise<Told> {
    const text = `${this.whatToCallTheConversation(giver)} added files to ${pieceLine(piece.label, piece.title)}. ${resourcesSaid('Its new inputs', inputs)}`
    try {
      return deliveryOf(await this.anAppNoticeToItsHolder(piece, text, 'inputs-added-to-a-piece'))
    } catch (error) {
      console.warn(
        `runtime host could not tell ${piece.owner} of the new inputs of ${piece.label}: ${errorMessage(error)}`,
      )
      return notTold(error)
    }
  }

  private async tellItsOwnerItsNewBrief(
    piece: PieceAConversationGave,
    brief: string,
    by: Caller,
    withItsGive: boolean,
  ): Promise<Told<NewBriefDelivery>> {
    const rebriefing = {
      ...(piece.definitionOfDone == null ? {} : { definitionOfDone: piece.definitionOfDone }),
      piece: piece.piece,
      label: piece.label,
      title: piece.title,
      ...grantOf(piece.givenFolder),
    }
    const atTheHolder = (
      to: string,
      onAStop?: (to: string) => Promise<QueueOutcome>,
    ): Promise<QueueOutcome> => {
      if (withItsGive) return this.whereTheGiveItRidesStands(to, piece)
      if (this.itHasEnded(to, piece.piece)) return Promise.reject(new ItEndedBeforeItsNewBrief())
      return this.queueAs(
        to,
        brief,
        by,
        [],
        'work',
        { rebriefing },
        null,
        'as-it-finds-it',
        onAStop,
      )
    }
    const whileServicesAreOff = (): Promise<QueueOutcome> => {
      if (withItsGive) return this.whereTheGiveItRidesStands(piece.owner, piece)
      if (this.itHasEnded(piece.owner, piece.piece)) {
        return Promise.reject(new ItEndedBeforeItsNewBrief())
      }
      return this.keptUntilItStarts(piece.owner, brief, {}, 'work', {
        by,
        attachments: [],
        rebriefs: { piece: piece.piece, label: piece.label },
      })
    }
    try {
      const delivered = await this.toItsHolderAlone(
        piece,
        brief,
        by,
        null,
        atTheHolder,
        whileServicesAreOff,
      )
      if (delivered === null) return deliveryOf(null)
      if (delivered.outcome === 'sent') {
        this.takeBackWhatALaterFactMadeFalse(piece, 'rebriefed')
        return { delivery: 'sent' }
      }
      if (withItsGive) return { delivery: 'with-its-give' }
      return { delivery: this.itHasEnded(piece.owner, piece.piece) ? 'after-it-ended' : 'held' }
    } catch (error) {
      if (error instanceof ItEndedBeforeItsNewBrief) return { delivery: 'after-it-ended' }
      console.warn(
        `runtime host could not hand ${piece.owner} the new brief of ${piece.label}: ${errorMessage(error)}`,
      )
      return notTold(error)
    }
  }

  private itHasEnded(holder: string, piece: string): boolean {
    try {
      const row = this.deps.store.piecesOwnedBy(holder).find((one) => one.piece === piece)
      return row !== undefined && !TASK_IS_OPEN[row.state]
    } catch (error) {
      console.warn(
        `runtime host could not ask whether ${piece} of ${holder} has ended: ${errorMessage(error)}`,
      )
      return false
    }
  }

  private async whereTheGiveItRidesStands(holder: string, piece: PieceRow): Promise<QueueOutcome> {
    const session = this.slots.get(holder)?.session ?? null
    if (session !== null) {
      const giveUpAt = Date.now() + this.deliveryWaitMs
      while (this.somethingIsOnItsWayTo(session) && Date.now() < giveUpAt) {
        await this.theWorkOnItsWayTo(session, giveUpAt)
      }
    }
    if (this.itHasEnded(holder, piece.piece)) throw new ItEndedBeforeItsNewBrief()
    const give = piece.messageId
    if (give !== null && this.itsGiveStillWaits(piece)) {
      return { outcome: 'queued', messageId: give }
    }
    const now = this.deps.store.piecesOwnedBy(holder).find((one) => one.piece === piece.piece)
    if (now?.stalledBecause === 'message_never_sent') {
      throw new Error(`the give of ${piece.label} ended without being sent`)
    }
    return { outcome: 'sent' }
  }

  private anAppNoticeToItsHolder(
    piece: Pick<PieceRow, 'piece' | 'owner' | 'label'>,
    text: string,
    appNotice: AppNotice,
  ): Promise<QueueOutcome | null> {
    const facts = { appNotice, aboutPiece: { piece: piece.piece, label: piece.label } }
    return this.toItsHolderAlone(
      piece,
      text,
      THE_APP_ITSELF,
      WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
      (to, onAStop) =>
        this.queueAs(
          to,
          text,
          THE_APP_ITSELF,
          [],
          'notice',
          facts,
          WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
          'as-it-finds-it',
          onAStop,
        ),
      () => this.keptUntilItStarts(piece.owner, text, facts, 'notice'),
    )
  }

  private async toItsHolderAlone(
    piece: Pick<PieceRow, 'owner' | 'label'>,
    text: string,
    by: Caller,
    says: AgentMessageKind | null,
    atTheHolder: (
      holder: string,
      onAStop?: (to: string) => Promise<QueueOutcome>,
    ) => Promise<QueueOutcome>,
    whileServicesAreOff?: () => Promise<QueueOutcome>,
  ): Promise<QueueOutcome | null> {
    const holder = piece.owner
    if (this.theOneInItsPlace(holder) !== holder) return null
    const deliver = (
      to: string,
      onAStop?: (to: string) => Promise<QueueOutcome>,
    ): Promise<QueueOutcome> =>
      to === holder
        ? atTheHolder(to, onAStop)
        : Promise.reject(new ItsPlaceWasTaken(to, holder, piece.label))
    if (this.takesADeliveryNow(holder)) return deliver(holder, (to) => deliver(to))
    if (whileServicesAreOff !== undefined && this.servicesHoldItBack(holder, by)) {
      return whileServicesAreOff()
    }
    return this.deliverWhenItRuns(holder, text, by, [], says, deliver)
  }

  private itsOpenPiecesAreStillYours(piece: PieceRow): readonly string[] {
    const stillOpen = openWorkOf(
      this.childrenOnTheRecord(piece.piece, this.oneWaitReadPerAnswer(), rowsUnreadOnce()),
    ).map((child) => child.label)
    return stillOpen.length === 0
      ? []
      : [
          `Its open pieces ${stillOpen.join(', ')} are still yours: take each back with withdraw_task, or close it with update_work, if it is no longer needed.`,
        ]
  }

  private whereItsHolderStands(
    piece: PieceRow,
    by: Caller,
    aPersonMayEndIt: (spelled: string, by: Caller) => boolean = (spelled, caller) =>
      this.aPersonMayTakeItBack(spelled, caller),
  ):
    | { readonly ok: true; readonly held: TheHeldMessagesCarrying }
    | {
        readonly ok: false
        readonly because:
          | 'out-of-its-reach'
          | Extract<ToolRefusal, 'that-conversation-has-not-started' | 'that-work-is-being-sent'>
      } {
    const slot = this.slots.get(piece.owner)
    const target = slot ?? this.aStoppedConversation(piece.owner)
    if (
      target === undefined ||
      target === null ||
      (!mayCommand(this.commandedNow(target), by) &&
        this.thePieceItIsOnFor(piece.owner, by)?.piece !== piece.piece &&
        !aPersonMayEndIt(piece.piece, by))
    ) {
      return { ok: false, because: 'out-of-its-reach' }
    }
    if (slot !== undefined && slot.session === null) {
      return {
        ok: false,
        because: onItsWayOut(slot) ? 'out-of-its-reach' : 'that-conversation-has-not-started',
      }
    }
    const held = this.theHeldMessagesCarrying(piece, slot)
    if (held.inTheMailbox.length > 0 && held.session?.flushing != null) {
      return { ok: false, because: 'that-work-is-being-sent' }
    }
    return { ok: true, held }
  }

  private whereTheQueuedPieceStands(piece: PieceRow):
    | { readonly ok: true; readonly held: TheHeldMessagesCarrying }
    | {
        readonly ok: false
        readonly because: Extract<
          ToolRefusal,
          'that-conversation-has-not-started' | 'that-work-is-being-sent'
        >
      } {
    const slot = this.slots.get(piece.owner)
    const held = this.theHeldMessagesCarrying(piece, slot)
    if (held.inTheMailbox.length + held.handedOn.length + held.waiting.length === 0) {
      return { ok: true, held }
    }
    if (slot !== undefined && slot.session === null && !onItsWayOut(slot)) {
      return { ok: false, because: 'that-conversation-has-not-started' }
    }
    if (held.inTheMailbox.length > 0 && held.session?.flushing != null) {
      return { ok: false, because: 'that-work-is-being-sent' }
    }
    return { ok: true, held }
  }

  private theHeldMessagesCarrying(
    piece: PieceRow,
    slot: SessionSlot | undefined,
  ): TheHeldMessagesCarrying {
    const carries = (one: { readonly piece?: string }): boolean => one.piece === piece.piece
    const session = slot?.session ?? null
    if (slot !== undefined && session !== null) {
      const inTheMailbox = session.mailbox.filter(carries)
      const handedOn = onItsWayOut(slot)
        ? (this.heldAtAStop.get(slot.id) ?? []).filter(
            (one) => carries(one) && !inTheMailbox.some((held) => held.id === one.id),
          )
        : []
      return { session, inTheMailbox, handedOn, waiting: [] }
    }
    const waiting = new Set(
      (this.heldAtAStop.get(piece.owner) ?? []).filter(carries).map((one) => one.id),
    )
    try {
      for (const row of this.deps.store.messagesWaitingIn(piece.owner)) {
        if (carries(row)) waiting.add(row.messageId)
      }
    } catch (error) {
      console.warn(
        `runtime host could not read what waits for ${piece.owner}'s next start: ${errorMessage(error)}`,
      )
    }
    return { session: null, inTheMailbox: [], handedOn: [], waiting: [...waiting] }
  }

  private itsGiveStillWaits(piece: PieceRow): boolean {
    const id = piece.messageId
    if (id === null) return false
    if (this.queuedAtAService(piece)) return true
    const session = this.slots.get(piece.owner)?.session ?? null
    const inTheMailbox = session?.mailbox.find((one) => one.id === id)
    if (inTheMailbox !== undefined) return session?.handingOver.includes(inTheMailbox) !== true
    if ((this.heldAtAStop.get(piece.owner) ?? []).some((one) => one.id === id)) return true
    if (session !== null) return false
    try {
      return this.deps.store.messagesWaitingIn(piece.owner).some((one) => one.messageId === id)
    } catch (error) {
      console.warn(
        `runtime host could not read what waits for ${piece.owner}: ${errorMessage(error)}`,
      )
      return false
    }
  }

  private takeBackTheHeldMessages(piece: PieceRow, held: TheHeldMessagesCarrying): boolean {
    const { session } = held
    if (session !== null) {
      for (const one of held.handedOn) this.whatWaitsForItsStart(piece.owner, one.id)
      const taken = [...held.inTheMailbox, ...held.handedOn]
      for (const one of taken) this.takeQueuedBack(session, one)
      return taken.length > 0
    }
    let took = false
    for (const id of held.waiting) {
      const waiting = this.whatWaitsForItsStart(piece.owner, id)
      if (waiting === undefined) continue
      this.writeIntoItsLedger(piece.owner, {
        type: 'message_unqueued',
        messageId: waiting.id,
        reason: 'cancelled',
        text: waiting.text,
        ...(waiting.attachments.length === 0 ? {} : { attachments: [...waiting.attachments] }),
        ...waiting.authorship,
      })
      took = true
    }
    return took
  }

  private whatWaitsForItsStart(sessionId: string, messageId: string): QueuedMessage | undefined {
    const handedOn = this.heldAtAStop.get(sessionId)
    const held = handedOn?.find((one) => one.id === messageId)
    if (handedOn !== undefined && held !== undefined) {
      handedOn.splice(handedOn.indexOf(held), 1)
      if (handedOn.length === 0) this.heldAtAStop.delete(sessionId)
      return held
    }
    try {
      const row = this.deps.store
        .messagesWaitingIn(sessionId)
        .find((one) => one.messageId === messageId)
      return row === undefined ? undefined : this.rebuiltFromItsRow(row)
    } catch (error) {
      console.warn(
        `runtime host could not read what waits for ${sessionId}'s next start: ${errorMessage(error)}`,
      )
      return undefined
    }
  }

  private takeQueuedBack(
    session: HostedSession,
    queued: QueuedMessage,
    why: HowItWasTakenBack = { reason: 'cancelled' },
  ): void {
    this.takeQueued(session, queued)
    this.publishOurs(session, {
      type: 'message_unqueued',
      messageId: queued.id,
      reason: why.reason,
      ...(why.reason === 'retracted' ? { detail: why.detail } : {}),
      text: queued.text,
      ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),
      ...queued.authorship,
    })
    this.theWorldMoved('work')
    if (queued.piece !== undefined) this.itsGiversWaitMayHaveMoved(queued.piece)
  }

  maySaveMemory(sessionId: string): boolean {
    const profile = this.profileOf(sessionId)
    const capabilities =
      profile === null ? null : (this.deps.store.capabilitiesOf(profile) ?? DEFAULT_CAPABILITIES)
    return capabilities === null ? false : true
  }

  async replyToParent(
    input: {
      piece: string
      outcome: TaskOutcome
      summary: string
      savedMethod?: string
      resourcePaths: readonly string[]
      resultDocument?: string
      needsUserAction: boolean
    },
    by: Caller,
  ): Promise<ReplyOutcome> {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) {
      return { ok: false, refusal: refuseReply('no-piece-by-that-name', { piece: input.piece }) }
    }
    const itsPiece = this.pieceNamed(input.piece)
    const itsDocumentIsListed =
      input.resultDocument === undefined ||
      returnedDocumentIndex(
        this.deps.store.recordedOne(speaking)?.cwd ?? null,
        input.resourcePaths,
        input.resultDocument,
      ) >= 0
    const waiting = this.untilTheCopiesCanBeEnded(
      itsPiece?.owner === speaking && itsDocumentIsListed ? itsPiece : null,
    )
    if (waiting !== null) await waiting
    const row = this.pieceNamed(input.piece)
    const itsOwn = row !== null && row.owner === speaking
    const piece = itsOwn
      ? this.deps.store.piecesOwnedBy(speaking).find((one) => one.piece === row.piece)
      : undefined
    const refusal = admitReply(
      input.piece,
      piece,
      itsOwn && row.parent === null,
      input.summary,
      (conversation) => this.whatToCallTheConversation(conversation),
    )
    if (refusal !== null) return { ok: false, refusal }
    if (piece === undefined) throw new Error('a reply was admitted against no piece (393)')

    let resultIndex = -1
    if (input.resultDocument !== undefined) {
      resultIndex = returnedDocumentIndex(
        this.deps.store.recordedOne(speaking)?.cwd ?? null,
        input.resourcePaths,
        input.resultDocument,
      )
      if (resultIndex < 0)
        return {
          ok: false,
          refusal: refuseReply('result-document-not-returned', {
            path: input.resultDocument,
            resultDocumentProblem: 'not-listed',
          }),
        }
    }
    const copies = this.theCopiesToEnd(speaking, piece.piece)
    if (!copies.ok) {
      return {
        ok: false,
        refusal: refuseReply(copies.because, {
          piece: input.piece,
          label: piece.label,
          ...copies.detail,
        }),
      }
    }
    const kept = this.keptFor(speaking, input.resourcePaths, (files) => {
      if (resultIndex < 0) return null
      const form = files[resultIndex]?.form
      return form === 'markdown' || form === 'page'
        ? null
        : refuseReply('result-document-not-returned', {
            path: input.resultDocument,
            resultDocumentProblem: 'not-document',
          })
    })
    if (!kept.ok) {
      return {
        ok: false,
        refusal:
          kept.refusal.rail === 'resource-not-a-form-this-app-keeps'
            ? {
                ...kept.refusal,
                reason: replyUnkeptFileReason(kept.refusal.detail.path),
              }
            : kept.refusal,
      }
    }
    if (resultIndex < 0) {
      const documents = kept.files.flatMap((file, index) =>
        file.form === 'markdown' || file.form === 'page' ? [index] : [],
      )
      if (documents.length === 1) resultIndex = documents[0]!
    }

    const session = this.requireToCommand(speaking, THE_APP_ITSELF)
    const aNewBriefWaited = [...session.mailbox, ...(this.heldAtAStop.get(session.id) ?? [])].some(
      (one) => one.piece === piece.piece && one.rebrief === true,
    )
    const ordinal = this.takeLedgerOrdinal(session)
    const at = this.now()
    const repliedWith = (rows: readonly ResourceRow[]): WorkRepliedEvent => ({
      type: 'work_replied',
      piece: piece.piece,
      outcome: input.outcome,
      summary: input.summary,
      ...(input.savedMethod === undefined ? {} : { savedMethod: input.savedMethod }),
      resources: rows.map((one) => one.resource),
      ...(rows[resultIndex] === undefined ? {} : { resultDocument: rows[resultIndex]!.resource }),
      ...(input.needsUserAction ? { needsUserAction: true as const } : {}),
    })
    let resources: readonly ResourceRow[] = []
    let passedUp: () => void = () => undefined
    this.record(session, () => {
      const committed = this.deps.store.atomically(() => {
        const rows = kept.files.map((file) =>
          this.deps.store.addResource(
            {
              piece: piece.piece,
              role: 'made',
              title: file.title,
              summary: null,
              name: file.name,
              sha256: file.sha256,
              bytes: file.bytes.length,
              addedBy: speaking,
            },
            at,
          ),
        )
        this.deps.store.append(session.id, ordinal, repliedWith(rows), at)
        return {
          rows,
          passedUp: this.endTheCopies(copies.copies, 'work-replied'),
        }
      })
      resources = committed.rows
      passedUp = committed.passedUp
    })
    this.rememberLedgerOrdinal(session, ordinal)
    const replied = repliedWith(resources)
    this.emitOurs(session, { sessionId: session.id, ordinal, at, event: replied })
    passedUp()
    this.theWorldMoved('work')
    if (!givenByAConversation(piece)) {
      return {
        ok: true,
        piece: piece.piece,
        label: piece.label,
        resources: resources.map((one) => one.resource),
        ...(replied.resultDocument === undefined ? {} : { resultDocument: replied.resultDocument }),
        delivered: null,
      }
    }
    const { delivered, why } = await this.deliverReply(
      piece,
      input,
      resources,
      session,
      aNewBriefWaited,
    )
    if (REPLY_LANDED[delivered]) this.takeBackWhatALaterFactMadeFalse(piece, 'answered')
    const to = this.theOneInItsPlace(piece.giver)
    let giver: string
    try {
      giver = this.whatToCallTheConversation(to)
    } catch (error) {
      console.warn(
        `runtime host could not name ${to} for the reply to ${piece.label}: ${errorMessage(error)}`,
      )
      giver = AN_AGENT_THIS_APP_CANNOT_NAME
    }
    const waits = why === null && delivered === 'held' ? this.whyWhatIsHeldWaits(to) : null
    return {
      ok: true,
      piece: piece.piece,
      label: piece.label,
      resources: resources.map((one) => one.resource),
      ...(replied.resultDocument === undefined ? {} : { resultDocument: replied.resultDocument }),
      giver,
      tookItsPlace: to !== piece.giver,
      ...(why !== null
        ? { delivered, why }
        : delivered === 'held' && waits !== null
          ? { delivered, why: waits }
          : { delivered }),
    }
  }

  private keptFor<T extends ReplyRefusal = never>(
    conversation: string,
    spelled: readonly string[],
    admitFiles?: (files: readonly OfferedFile[]) => T | null,
  ):
    | { readonly ok: true; readonly files: readonly (OfferedFile & { readonly title: string })[] }
    | { readonly ok: false; readonly refusal: ResourceRefusal | T } {
    if (spelled.length === 0) return { ok: true, files: [] }
    const root = this.deps.resourcesRoot?.()
    if (root === undefined) {
      return { ok: false, refusal: refuseResource('resource-store-unavailable') }
    }
    const folder = this.deps.store.recordedOne(conversation)?.cwd ?? null
    const files: OfferedFile[] = []
    for (const path of spelled) {
      if (folder === null) {
        return { ok: false, refusal: refuseResource('resource-unreadable', { path }) }
      }
      const placed = resolveResource(folder, path)
      if (!placed.ok) return placed
      const read = readOfferedResource(placed.realPath, path)
      if (!read.ok) return read
      files.push(read)
    }
    const refused = admitFiles?.(files)
    if (refused != null) return { ok: false, refusal: refused }
    for (const [index, file] of files.entries()) {
      const kept = keepResource(root, file)
      if (!kept.ok) {
        return {
          ok: false,
          refusal: refuseResource('resource-could-not-be-kept', {
            problem: kept.problem,
            path: spelled[index],
          }),
        }
      }
    }
    return { ok: true, files: files.map((file) => ({ ...file, title: resourceTitle(file) })) }
  }

  titleTheOlderFiles(): Promise<{ titled: number; retitled: number }> {
    return this.keptFiles.titleTheOlderFiles()
  }

  private async deliverReply(
    piece: PieceAConversationGave,
    input: { outcome: TaskOutcome; summary: string; needsUserAction: boolean },
    resources: readonly ResourceRow[],
    replier: HostedSession,
    aNewBriefWaited: boolean,
  ): Promise<WhereAReplyWent> {
    const attempt = await this.deliverReplyTo(piece, input, resources, aNewBriefWaited)
    if (!REPLY_LANDED[attempt.delivered]) {
      this.publishOurs(replier, {
        type: 'reply_undelivered',
        piece: piece.piece,
        parent: piece.giver,
        because: attempt.delivered,
        ...(attempt.why === null ? {} : { detail: attempt.why }),
      })
    }
    return attempt
  }

  private async deliverReplyTo(
    piece: PieceAConversationGave,
    input: { outcome: TaskOutcome; summary: string; needsUserAction: boolean },
    resources: readonly ResourceRow[],
    aNewBriefWaited: boolean,
  ): Promise<WhereAReplyWent> {
    let words: { readonly text: string; readonly facts: FactsAQueueCarries } | null = null
    try {
      words = {
        text: replyText(
          piece,
          this.whatToCallTheConversation(piece.owner),
          input,
          resources,
          aNewBriefWaited,
        ),
        facts: {
          report: workAnswered(
            piece,
            input,
            resources.map((one) => one.resource),
          ),
          carriedFor: piece.owner,
        },
      }
      const outcome = await this.queueMessage(
        piece.giver,
        words.text,
        THE_APP_ITSELF,
        [],
        'work',
        words.facts,
      )
      return { delivered: outcome.outcome === 'sent' ? 'sent' : 'held', why: null }
    } catch (error) {
      console.warn(
        `runtime host could not deliver the reply to ${piece.label}: ${errorMessage(error)}`,
      )
      if (words === null) return { delivered: 'not-delivered', why: whyItWasNotDelivered(error) }
      const where = await this.keptForItsNextStart(
        this.theOneInItsPlace(piece.giver),
        words.text,
        words.facts,
      )
      if (where === 'its-mailbox') return { delivered: 'held', why: null }
      if (where === 'its-ledger') return { delivered: 'kept', why: whyItWasNotDelivered(error) }
      return { delivered: 'not-delivered', why: ITS_RECORD_WOULD_NOT_TAKE_IT }
    }
  }

  private keptForItsNextStart(
    giver: string,
    text: string,
    facts: FactsAQueueCarries,
  ): Promise<WhereHeldWordsWait> {
    return new Promise((resolve) => {
      try {
        this.holdUntilItStarts(giver, text, facts, 'work', resolve)
      } catch (error) {
        console.warn(`runtime host could not hold the reply for ${giver}: ${errorMessage(error)}`)
        resolve('nowhere')
      }
    })
  }

  private recordAnAnswerItsGiverNeverGot(giver: HostedSession, ending: UnqueuedMessageEvent): void {
    const answer = theAnswerItCarries(ending)
    if (answer === null) return
    this.writeIntoItsLedger(answer.owner, {
      type: 'reply_undelivered',
      piece: answer.piece,
      parent: giver.id,
      because: AN_ANSWER_HELD_THEN_LOST,
    })
  }

  private writeIntoItsLedger(sessionId: string, row: IntoItsLedger, landed?: () => void): void {
    const slot = this.slots.get(sessionId)
    if (slot?.session != null) {
      this.publishOurs(slot.session, row)
      landed?.()
      return
    }
    if (slot !== undefined) {
      void slot.arrived.then(() => {
        const neverRegistered = this.slots.get(sessionId) === slot && slot.session === null
        if (neverRegistered) {
          this.appendIntoItsLedger(sessionId, row)
          landed?.()
        } else this.writeIntoItsLedger(sessionId, row, landed)
      })
      return
    }
    this.appendIntoItsLedger(sessionId, row)
    landed?.()
  }

  private holdUntilItStarts(
    sessionId: string,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind = 'notice',
    kept?: (where: WhereHeldWordsWait, id?: string) => void,
    id?: string,
    left?: WordsLeftForAService,
  ): void {
    const slot = this.slots.get(sessionId)
    const session = slot?.session ?? null
    if (slot !== undefined && session === null && !onItsWayOut(slot)) {
      void slot.arrived.then(() => {
        try {
          const neverRegistered = this.slots.get(sessionId) === slot && slot.session === null
          if (!neverRegistered) this.holdUntilItStarts(sessionId, text, facts, kind, kept, id, left)
          else this.holdForTheNextStart(sessionId, null, text, facts, kind, kept, id, left)
        } catch (error) {
          console.warn(
            `runtime host could not hold words for ${sessionId}'s start: ${errorMessage(error)}`,
          )
          kept?.('nowhere')
        }
      })
      return
    }
    this.holdForTheNextStart(sessionId, session, text, facts, kind, kept, id, left)
  }

  private wordsThisAppHolds(
    sessionId: string,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind,
    id?: string,
    left?: WordsLeftForAService,
  ): { readonly held: QueuedMessage; readonly row: QueuedMessageEvent } {
    const drives = this.thePieceTheseWordsDrive(sessionId, facts)
    const from = left === undefined ? null : this.originOf(left.by)
    const itNames =
      from?.who === 'a-caller-with-an-id' || facts.appNotice === 'a-work-wait-needs-attention'
        ? (facts.aboutPiece?.piece ?? null)
        : null
    const rebriefs =
      left?.rebriefs === undefined ? {} : { ...left.rebriefs, rebrief: true as const }
    const held: QueuedMessage = {
      id: id ?? newQueuedMessageId(),
      kind,
      text,
      since: this.now(),
      attachments: left?.attachments ?? [],
      authorship: whoseWordsTheseAre(
        left?.by ?? THE_APP_ITSELF,
        this.profileOf,
        facts,
        left === undefined ? WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS : left.says,
      ),
      ...rebriefs,
      ...(drives === null ? {} : { drives }),
      ...(from === null ? {} : { origin: from }),
      ...(facts.asks === undefined ? {} : { asks: facts.asks }),
      ...(itNames === null ? {} : { about: itNames }),
    }
    const row: QueuedMessageEvent = {
      type: 'message_queued',
      messageId: held.id,
      kind,
      text,
      ...(held.attachments.length > 0 ? { attachments: [...held.attachments] } : {}),
      ...held.authorship,
      ...rebriefs,
      ...(drives === null ? {} : { drives }),
      ...(itNames === null ? {} : { about: itNames }),
      ...(held.asks === undefined ? {} : { asks: held.asks }),
    }
    return { held, row }
  }

  private holdForTheNextStart(
    sessionId: string,
    session: HostedSession | null,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind,
    kept?: (where: WhereHeldWordsWait, id?: string) => void,
    id?: string,
    left?: WordsLeftForAService,
  ): void {
    const { held, row } = this.wordsThisAppHolds(sessionId, text, facts, kind, id, left)
    if (session !== null && session.finalizing === null) {
      session.mailbox.push(held)
      this.publishOurs(session, row)
      this.publishStateIfChanged(session)
      this.flushQueued(session)
      this.theWorldMoved('work')
      kept?.('its-mailbox', held.id)
      return
    }
    let down: boolean
    if (session !== null) {
      this.publishOurs(session, row)
      down = session.recordingFailure === null
    } else down = this.appendIntoItsLedger(sessionId, { ...row, forItsNextStart: true })
    if (!this.launches.closed) {
      this.heldAtAStop.set(sessionId, [...(this.heldAtAStop.get(sessionId) ?? []), held])
    }
    this.theWorldMoved('work')
    kept?.(down ? 'its-ledger' : 'nowhere', held.id)
  }

  private appendIntoItsLedger(sessionId: string, row: IntoItsLedger): boolean {
    return this.writeWhileNothingRunsIt(sessionId, row)
  }

  private writeWhileNothingRunsIt(sessionId: string, row: TranscriptEvent): boolean {
    let written: RuntimeEventMessage | null = null
    try {
      const ordinal = this.deps.store.nextOrdinal(sessionId)
      const at = this.now()
      this.deps.store.append(sessionId, ordinal, row, at)
      written = { sessionId, ordinal, at, event: row }
    } catch (error) {
      console.warn(
        `runtime host could not write ${row.type} into ${sessionId}'s record: ${errorMessage(error)}`,
      )
    }
    if (written !== null) this.showTheWindowsLookingAt(sessionId, written)
    return written !== null
  }

  private showTheWindowsLookingAt(sessionId: string, message: RuntimeEventMessage): void {
    const looking = this.lookingAtItsRecord.get(sessionId)
    if (looking === undefined) return
    for (const [owner, { sink }] of looking) {
      if (!sink.alive) {
        looking.delete(owner)
        continue
      }
      try {
        sink.send(transcriptMessageForDisplay(message))
      } catch (error) {
        console.warn(
          `runtime host could not show ${sessionId}'s new row to a window: ${errorMessage(error)}`,
        )
      }
    }
    if (looking.size === 0) this.lookingAtItsRecord.delete(sessionId)
  }

  private routeRequest(
    session: HostedSession,
    event: RuntimeEvent,
    wire: RuntimeEvent,
  ): RuntimeEventMessage | null {
    if (wire.type !== event.type) return null
    const verdict = askedOfTheChannel(event)
    if (verdict === null) return null
    const parent = this.whoItsQuestionsGoTo(session.id)
    if (parent === null) {
      return this.recordOurs(session, {
        type: 'request_routed',
        requestId: verdict.id,
        to: 'a-person',
        ...(verdict.travels ? {} : { because: verdict.because }),
      })
    }
    if (!verdict.travels) {
      return this.recordOurs(session, {
        type: 'request_routed',
        requestId: verdict.id,
        to: 'a-person',
        because: verdict.because,
        parent,
      })
    }
    const routed = this.recordOurs(session, {
      type: 'request_routed',
      requestId: verdict.id,
      to: 'the-parent',
      parent,
    })
    void this.deliverQuestion(session.id, parent, verdict)
    return routed
  }

  private async deliverQuestion(
    asked: string,
    parent: string,
    verdict: {
      id: string
      prompt: string
      questions: readonly UserInputQuestion[]
      context?: string | null
      label?: string | null
      piece?: string | null
    },
  ): Promise<void> {
    const piece = verdict.piece ?? null
    const label = verdict.label ?? null
    const about = {
      asks: { asker: asked, requestId: verdict.id },
      ...(piece === null || label === null ? {} : { aboutPiece: { piece, label } }),
    }
    try {
      await this.queueMessage(
        parent,
        questionText(this.calledUnder(asked, piece), verdict),
        THE_APP_ITSELF,
        [],
        'question',
        { carriedFor: asked, ...about },
      )
    } catch (error) {
      console.warn(
        `runtime host could not deliver ${asked}'s question ${verdict.id} to ${parent}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  withdrawQuestion(input: { requestId: string }, by: Caller): WithdrawQuestionOutcome {
    const refused: WithdrawQuestionOutcome = {
      ok: false,
      refusal: refuseQuestion('no-open-question-you-asked-by-that-name', {
        question: input.requestId,
      }),
    }
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) return refused
    const session = this.slots.get(speaking)?.session ?? null
    if (session === null) return refused
    const rows = this.deps.store
      .routedRequestsOf(speaking)
      .filter((one) => one.requestId === input.requestId)
    const open = rows.some((one) => REQUEST_IS_OPEN[one.state])
    const asked = this.deps.store.questionsRaisedIn(speaking).get(input.requestId)
    const ended = open || asked?.raisedBy !== 'this-app' ? undefined : rows.at(-1)
    if (ended !== undefined && !REQUEST_IS_OPEN[ended.state]) {
      return {
        ok: false,
        refusal: refuseQuestion('no-open-question-you-asked-by-that-name', {
          question: input.requestId,
          state: ended.state,
          ...(ended.endedAt === null ? {} : { at: ended.endedAt }),
          ...(ended.state === 'answered' || ended.state === 'rejected'
            ? { itsAnswer: this.whereItsAnswerIs(session, input.requestId) }
            : {}),
        }),
      }
    }
    if (!open || asked?.raisedBy !== 'this-app') return refused
    this.publishOurs(session, { type: 'question_withdrawn', requestId: input.requestId })
    this.theWorldMoved('work')
    return { ok: true, question: input.requestId }
  }

  private whereAnAnswerCameFrom(
    asker: string,
    requestId: string,
    answerer: string,
  ): AnAnswersOrigin | null {
    for (const [passedUp, words] of this.deps.store.questionsRaisedIn(answerer)) {
      if (words.passedUpFrom !== requestId) continue
      const decided = this.deps.store.theDecisionOn(answerer, passedUp)
      if (decided?.outcome === 'answered' && decided.by?.who === 'a-person') {
        return 'a-person-answered-it-where-it-was-passed-up'
      }
    }
    const routed = this.deps.store
      .routedRequestsOf(asker)
      .filter((one) => one.requestId === requestId)
      .at(-1)
    return routed?.went.is === 'the-person-the-asker-named' ? 'asked-of-a-person' : null
  }

  private whereAnAnswerCameFromSaid(
    asker: string,
    requestId: string,
    answerer: string,
  ): AnAnswersOrigin | null {
    try {
      return this.whereAnAnswerCameFrom(asker, requestId, answerer)
    } catch (error) {
      console.warn(
        `runtime host could not read where the answer to ${requestId} came from: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private whereItsAnswerIs(session: HostedSession, requestId: string): AnAnswerOnItsWay {
    const quoting = quotingTheQuestion(requestId)
    const held =
      session.mailbox.some((one) => one.text.includes(quoting)) ||
      this.answersOnTheirWay.has(questionKey(session.id, requestId))
    if (!held) return 'already-sent'
    if (
      this.theResetItWaitsFor(session.provider, this.limitAccountOf(session.id, this.now())) !==
      null
    )
      return 'held-until-the-limit-resets'
    return session.stopStillAsked === null
      ? 'held-until-this-turn-ends'
      : 'held-and-this-turn-is-stopping'
  }

  private theWordsOf(askedBy: string, requestId: string): TheWordsOfAQuestion | undefined {
    const asked = this.deps.store.questionsRaisedIn(askedBy).get(requestId)
    if (asked?.raisedBy !== 'this-app') return undefined
    return {
      asked: askedBy,
      ...(asked.move === undefined ? {} : { move: asked.move }),
      ...(asked.action === undefined ? {} : { action: asked.action }),
      piece: asked.piece,
      parts: asked.questions.map((one) => one.id),
      prompt: asked.prompt,
    }
  }

  private async deliverAnswer(
    held: {
      readonly asked: string
      readonly piece: string | null
      readonly prompt: string
      readonly action?: ActionAsked
    },
    requestId: string,
    answeredBy: string | null,
    answers: readonly { readonly part: string; readonly answer: readonly string[] }[] | null,
    said: string | null = null,
    window: RuntimeEventSink | null = null,
    stopAs: Caller | null = null,
  ): Promise<{
    readonly kept: string | null
    readonly stop: TheStopItsWordsAsked | null
    readonly held: boolean
  }> {
    const nothingToStop = stopAs === null ? null : ({ stop: 'not-needed', askedOf: null } as const)
    const label = held.piece === null ? null : (this.deps.store.workById(held.piece)?.label ?? null)
    const answerer = answeredBy === null ? null : this.nameByItsWorkUnder(answeredBy, held.piece)
    const aToDo =
      held.action === undefined || answers === null
        ? null
        : aToDoAnsweredText(answerer, { id: requestId, prompt: held.prompt, label }, answers)
    const text =
      aToDo ??
      answerText(
        answerer,
        { id: requestId, prompt: held.prompt, label },
        answers,
        said,
        answeredBy === null || answers === null
          ? null
          : this.whereAnAnswerCameFromSaid(held.asked, requestId, answeredBy),
      )
    const answerOnly = said ?? answers?.map((part) => part.answer.join(', ')).join('\n') ?? ''
    const answeredQuestion: AnsweredQuestion = {
      requestId,
      answeredBy,
      answer: answerOnly.slice(0, headOf(answerOnly, REPLY_SUMMARY_LIMIT)),
      ...(said === null ? {} : { cannotAnswer: true }),
      ...(answerOnly.length > REPLY_SUMMARY_LIMIT ? { clipped: true } : {}),
    }
    const whose: FactsAQueueCarries =
      answeredBy === null
        ? { appNotice: 'an-answer-to-a-question' as const, answeredQuestion }
        : { carriedFor: answeredBy, answeredQuestion }
    const facts: FactsAQueueCarries =
      held.piece === null || label === null
        ? whose
        : { ...whose, aboutPiece: { piece: held.piece, label } }
    const asker = this.theOneInItsPlace(held.asked)
    if (this.takesADeliveryNow(asker)) {
      let delivery: QueueOutcome
      const onItsWay = questionKey(asker, requestId)
      this.answersOnTheirWay.add(onItsWay)
      try {
        this.aPersonsWindowTakesIt(asker, window)
        delivery = await this.queueMessage(asker, text, THE_APP_ITSELF, [], 'notice', facts)
      } catch (error) {
        console.warn(
          `runtime host could not deliver the answer to ${requestId} into ${asker}: ${errorMessage(error)}`,
        )
        const heldAs: { id?: string } = {}
        this.holdUntilItStarts(asker, text, facts, undefined, (_where, id) => {
          heldAs.id = id
        })
        return {
          kept: this.runsNow(asker) ? null : this.anAnswerKept(asker, error, held.piece),
          ...(await this.withWhatItsStopLeft(
            this.theStopForAHeldAnswer(asker, heldAs.id ?? null, stopAs),
          )),
        }
      } finally {
        this.answersOnTheirWay.delete(onItsWay)
      }
      if (delivery.outcome === 'queued') {
        return {
          kept: null,
          ...(await this.withWhatItsStopLeft(
            this.theStopForAHeldAnswer(asker, delivery.messageId, stopAs),
          )),
        }
      }
      return { kept: null, stop: nothingToStop, held: false }
    }
    this.noteWhatBringsItBack(asker, () => 'its question was answered')
    const heldAs: { id?: string } = {}
    this.holdUntilItStarts(asker, text, facts, undefined, (_where, id) => {
      heldAs.id = id
    })
    try {
      await this.ensureRunning(asker, window)
      return {
        kept: null,
        ...(await this.withWhatItsStopLeft(
          this.theStopForAHeldAnswer(asker, heldAs.id ?? null, stopAs),
        )),
      }
    } catch (error) {
      console.warn(
        `runtime host could not start ${asker} for the answer to ${requestId}: ${errorMessage(error)}`,
      )
      return {
        kept: this.anAnswerKept(asker, error, held.piece),
        stop: nothingToStop,
        held: false,
      }
    } finally {
      this.whatBringsItBack.delete(asker)
    }
  }

  private anAnswerKept(asker: string, error: unknown, piece: string | null): string {
    let name = 'the conversation that asked'
    try {
      name = this.nameByItsWorkUnder(asker, piece)
    } catch {
      // An unread name leaves the generic conversation name in the answer.
    }
    return anAnswerKeptForItsStart(name, whyItWasNotDelivered(error))
  }

  private prepareMoveOffer(
    session: HostedSession,
    moveTo: string,
    by: Caller,
  ): { ok: true; move: MoveOffer } | { ok: false; refusal: ReturnType<typeof refuseQuestion> } {
    const previous = this.deps.store.latestMoveOffer?.(session.id)
    if (
      previous !== null &&
      previous !== undefined &&
      this.deps.store
        .routedRequestsOf(session.id)
        .some((one) => one.requestId === previous.requestId && REQUEST_IS_OPEN[one.state])
    )
      return { ok: false, refusal: refuseQuestion('move-offer-not-available') }
    if (
      session.moveRequestTurn === null &&
      session.moveRequestRowPending &&
      session.recordingFailure === null
    ) {
      return { ok: false, refusal: refuseQuestion('move-offer-is-held') }
    }
    const original = this.deps.store.atomically(() => {
      const current = session.moveRequestTurn
      if (current === null) return null
      const message = originalMoveRequest(this.deps.store, session.id, current.id)
      return message === null ? null : { message, id: current.id }
    })
    const destination = this.theConversationAddressed(moveTo, by, session.id, 'messaging')
    if (original === null || destination === session.id) {
      return { ok: false, refusal: refuseQuestion('move-offer-not-available') }
    }
    if (
      this.deps.store.recordedOne(destination) === null ||
      this.theOneInItsPlace(destination) !== destination
    ) {
      return { ok: false, refusal: refuseQuestion('move-offer-not-available') }
    }
    if (this.archived.has(destination) || !this.withinMessagingReach(destination, by, session.id)) {
      return { ok: false, refusal: refuseQuestion('move-offer-needs-a-person') }
    }
    if (this.settingAside.has(destination)) {
      return { ok: false, refusal: refuseQuestion('move-offer-needs-a-person') }
    }
    return {
      ok: true,
      move: {
        destination,
        destinationName: this.nameByItsWork(destination),
        sourceTurnId: original.id,
      },
    }
  }

  async raiseAQuestion(
    input: {
      moveTo?: string
      piece: string | null
      question: string
      options: readonly string[]
      who: QuestionRecipient
      agent: string | null
      action?: ActionAsked
    },
    by: Caller,
  ): Promise<AskOutcome> {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) {
      return { ok: false, refusal: noPieceToAskAbout(input.piece ?? '', []) }
    }
    const named = input.agent ?? ''
    const agent = named === '' ? '' : this.theOneInItsPlace(named)
    if (input.who === 'an-agent') {
      if (agent === '' || agent === speaking || !this.withinMessagingReach(agent, by, speaking)) {
        return {
          ok: false,
          refusal: refuseQuestion('no-agent-you-can-ask-by-that-name', { agent: named }),
        }
      }
    }
    const held = this.heldBy(speaking)
    const received = held.filter((one) => one.received)
    const aboutWork = input.who !== 'an-agent' && input.moveTo === undefined
    const piece =
      input.piece !== null
        ? (held.find((one) => one.piece === input.piece || one.label === input.piece) ?? null)
        : aboutWork && received.length === 1
          ? (received[0] ?? null)
          : null
    if (piece !== null && !piece.received && this.itIsAService(speaking)) {
      const said = received.map((one) => one.label)
      return { ok: false, refusal: noPieceToAskAbout(input.piece ?? '', said) }
    }
    if (input.piece !== null || aboutWork) {
      const refusal = admitAsk(
        piece,
        input.piece ?? '',
        received.map((one) => one.label),
      )
      if (refusal !== null) return { ok: false, refusal }
    }
    const went: QuestionRecipient =
      input.who === 'the-parent' && piece !== null && piece.giver === null ? 'a-person' : input.who
    const answerer =
      input.who === 'an-agent'
        ? agent
        : piece === null || piece.giver === null
          ? null
          : this.theOneInItsPlace(piece.giver)
    const session = this.slots.get(speaking)?.session ?? null
    if (session === null) {
      return { ok: false, refusal: noPieceToAskAbout(input.piece ?? '', []) }
    }
    let move: MoveOffer | undefined
    if (input.moveTo !== undefined) {
      if (input.who !== 'a-person' || input.agent !== null)
        return { ok: false, refusal: refuseQuestion('move-offer-not-available') }
      const prepared = this.prepareMoveOffer(session, input.moveTo, by)
      if (!prepared.ok) return prepared
      move = prepared.move
    }
    const requestId = newAskedQuestionId()
    const questions: readonly UserInputQuestion[] = [
      {
        id: 'answer',
        prompt: input.question,
        options: (move === undefined ? input.options : [MOVE_IT, DO_IT_HERE]).map((label) => ({
          label,
        })),
        ...(move === undefined && input.options.length > 0 ? { allowOther: true } : {}),
      },
    ]
    this.publishOurs(session, {
      type: 'question_asked',
      ...(move === undefined ? {} : { move }),
      ...(input.action === undefined ? {} : { action: input.action }),
      requestId,
      ...(piece === null ? {} : { piece: piece.piece, label: piece.label }),
      prompt: input.question,
      questions,
    })
    session.askedSinceItsLastTurnEnded.add(requestId)
    this.publishOurs(session, {
      type: 'request_routed',
      requestId,
      to: went,
      ...(answerer === null ? {} : { parent: answerer }),
    })
    if (answerer !== null && (went === 'the-parent' || went === 'an-agent')) {
      void this.deliverQuestion(speaking, answerer, {
        id: requestId,
        prompt: input.question,
        questions,
        ...(piece === null ? {} : { piece: piece.piece, label: piece.label }),
      })
    }
    this.theWorldMoved('work')
    return {
      ok: true,
      question: requestId,
      went,
      aboutItsRoot: piece !== null && piece.root,
    }
  }

  async requestAnAction(
    input: {
      readonly piece: string | null
      readonly action: string
      readonly files: readonly string[]
    },
    by: Caller,
  ): Promise<AskOutcome | { readonly ok: false; readonly resourceRefusal: ResourceRefusal }> {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) {
      return { ok: false, refusal: noPieceToAskAbout(input.piece ?? '', []) }
    }
    const held = this.heldBy(speaking)
    const received = held.filter((one) => one.received)
    const spelled = input.piece
    const piece =
      spelled === null
        ? received.length === 1
          ? (received[0] ?? null)
          : null
        : (held.find((one) => [one.piece, one.label].includes(spelled)) ?? null)
    const refusal = admitAsk(
      piece,
      input.piece ?? '',
      received.map((one) => one.label),
    )
    if (refusal !== null || piece === null) {
      return { ok: false, refusal: refusal ?? noPieceToAskAbout(input.piece ?? '', []) }
    }
    const kept = this.keptFor(speaking, input.files)
    if (!kept.ok) return { ok: false, resourceRefusal: kept.refusal }
    const at = this.now()
    const rows = this.deps.store.atomically(() =>
      kept.files.map((file) =>
        this.deps.store.addResource(
          {
            piece: piece.piece,
            role: 'made',
            title: file.title,
            summary: null,
            name: file.name,
            sha256: file.sha256,
            bytes: file.bytes.length,
            addedBy: speaking,
          },
          at,
        ),
      ),
    )
    const files: readonly ActionFile[] = rows.map((one) => ({
      resource: one.resource,
      name: one.name,
    }))
    return this.raiseAQuestion(
      {
        piece: piece.piece,
        question: input.action,
        options: [A_TO_DO_DONE, A_TO_DO_NOT_DONE],
        who: 'a-person',
        agent: null,
        action: { files },
      },
      by,
    )
  }

  async answerAction(
    sessionId: string,
    requestId: string,
    done: boolean,
    note: string | null,
    by: Caller,
  ): Promise<AnswerAck> {
    const asked = this.theWordsOf(sessionId, requestId)
    if (asked?.action === undefined) {
      return { outcome: 'refused', reason: NO_SUCH_QUESTION_TO_ANSWER, stillOpen: false }
    }
    const said = note?.trim() ?? ''
    return this.aPersonAnswersAQuestionThisAppAsked(
      sessionId,
      requestId,
      asked,
      {
        kind: 'answer',
        answers: {
          answer: done ? A_TO_DO_DONE : A_TO_DO_NOT_DONE,
          ...(said === '' ? {} : { note: said }),
        },
      },
      by,
    )
  }

  private endThePiece(
    owner: string,
    row: WorkTakenBackEvent | WorkClosedEvent,
    ending: QuestionEndedWithItsPieceEvent['ending'],
    copies: PassedUpCopies,
    requireDurable = false,
  ): void {
    const slot = this.slots.get(owner)
    if (slot !== undefined && slot.session === null) {
      if (requireDurable)
        throw new Error('The conversation is still starting. Try again in a moment.')
      if (copies.length > 0) throw new Error(`${row.piece} ended while ${owner} was starting`)
      this.writeIntoItsLedger(owner, row)
      return
    }
    const session = slot?.session ?? null
    let thenShow: () => void = () => undefined
    const write = (): void => {
      thenShow = this.deps.store.atomically(() => {
        const itsRow = this.appendInTheTransaction(owner, row)
        const theirs = this.endTheCopies(copies, ending)
        return () => {
          itsRow()
          theirs()
        }
      })
    }
    if (requireDurable) {
      write()
      thenShow()
      return
    }
    if (session === null) {
      try {
        write()
      } catch (error) {
        console.warn(
          `runtime host could not write ${row.type} into ${owner}'s record: ${errorMessage(error)}`,
        )
      }
    } else {
      this.record(session, write)
      if (session.recordingFailure !== null) {
        this.publishOurs(session, row)
        return
      }
    }
    thenShow()
  }

  private appendInTheTransaction(conversation: string, event: IntoItsLedger): () => void {
    const slot = this.slots.get(conversation)
    const session = slot?.session ?? null
    if (slot !== undefined && session === null) {
      throw new Error(`${conversation} is starting, so ${event.type} cannot be written into it now`)
    }
    const next = this.deps.store.nextOrdinal(conversation)
    const ordinal = session === null ? next : Math.max(session.ordinal, next)
    const at = this.now()
    this.deps.store.append(conversation, ordinal, event, at)
    const message: RuntimeEventMessage = { sessionId: conversation, ordinal, at, event }
    return () => {
      if (session !== null) session.ordinal = Math.max(session.ordinal, ordinal + 1)
      try {
        if (session === null) this.showTheWindowsLookingAt(conversation, message)
        else this.emitOurs(session, message)
      } catch (error) {
        console.warn(
          `runtime host wrote ${event.type} into ${conversation}'s record and could not show it: ${errorMessage(error)}`,
        )
      }
    }
  }

  private thePieceItsGiverEnds(piece: string, giver: string): WorkRow | null {
    const row = this.pieceNamed(piece)
    return row?.givenBy != null && this.theIdsItStandsFor(giver).includes(row.givenBy) ? row : null
  }

  private untilTheCopiesCanBeEnded(row: WorkRow | null): Promise<void> | null {
    const starting = this.theStartsAnEndingWaitsFor(row)
    if (row === null || starting.length === 0) return null
    return this.waitOutTheStarts(row, starting)
  }

  private async waitOutTheStarts(row: WorkRow, startingNow: readonly SessionSlot[]): Promise<void> {
    let starting = startingNow
    for (let round = 0; round < AN_ENDING_WAITS_OUT_STARTS && starting.length > 0; round++) {
      const landed = Promise.all(starting.map((slot) => slot.arrived))
      if (!(await settledWithin(landed, this.endingWaitMs))) return
      starting = this.theStartsAnEndingWaitsFor(row)
    }
  }

  private theStartsAnEndingWaitsFor(row: WorkRow | null): readonly SessionSlot[] {
    if (row === null) return []
    const folded = this.deps.store.piecesOwnedBy(row.owner).find((one) => one.piece === row.piece)
    if (folded === undefined || !TASK_IS_OPEN[folded.state]) return []
    const copies = this.whatWasPassedUpAbout(row.owner, row.piece)
    return copies.ok ? this.theStartsUnderWay(copies.copies) : []
  }

  private theStartsUnderWay(copies: PassedUpCopies, owner?: string): readonly SessionSlot[] {
    const conversations = new Set(copies.map((one) => one.passer))
    if (owner !== undefined && copies.length > 0) conversations.add(owner)
    return [...conversations].flatMap((conversation) => {
      const slot = this.slots.get(conversation)
      return slot !== undefined && slot.session === null ? [slot] : []
    })
  }

  private theCopiesToEnd(
    owner: string,
    piece: string,
  ):
    | { readonly ok: true; readonly copies: PassedUpCopies }
    | {
        readonly ok: false
        readonly because: TheCopiesRefusal
        readonly detail?: { readonly unreadQuestion: UnreadQuestion }
      } {
    const read = this.whatWasPassedUpAbout(owner, piece)
    if (!read.ok)
      return {
        ok: false,
        because: 'its-questions-could-not-all-be-read',
        detail: { unreadQuestion: read.unreadQuestion },
      }
    if (this.theStartsUnderWay(read.copies, owner).length > 0) {
      return { ok: false, because: 'a-conversation-with-its-questions-is-starting' }
    }
    return read
  }

  private whatWasPassedUpAbout(
    owner: string,
    piece: string,
  ):
    | { readonly ok: true; readonly copies: PassedUpCopies }
    | { readonly ok: false; readonly unreadQuestion: UnreadQuestion } {
    let reading: { ledger: string; question?: string } = { ledger: owner }
    let failure: UnreadQuestion | undefined
    const counted = rowsUnreadOnce()
    const unread: RowsUnread = {
      in: (ledger) => (row, cause) => {
        counted.in(ledger)(row, cause)
        failure ??= {
          ledger,
          ...(typeof row === 'number' ? { row } : {}),
          cause: cause ?? 'the question record could not be decoded',
        }
      },
      get count() {
        return counted.count
      },
      get ledgersSkipped() {
        return counted.ledgersSkipped
      },
    }
    const questions = this.oneQuestionReadPerAnswer(unread)
    const raisedIn = (ledger: string): ReadonlyMap<string, RaisedQuestion> => {
      reading = { ledger }
      return questions(ledger)
    }
    const routings = new Map<string, readonly RoutedRequest[]>()
    const routedIn = (conversation: string): readonly RoutedRequest[] => {
      const kept = routings.get(conversation)
      if (kept !== undefined) return kept
      if (reading.ledger !== conversation) reading = { ledger: conversation }
      const read = this.deps.store.routedRequestsOf(conversation, unread)
      routings.set(conversation, read)
      return read
    }
    const copies: { readonly passer: string; readonly requestId: string }[] = []
    try {
      const toFollow = [...raisedIn(owner)]
        .filter(([, words]) => words.piece === piece)
        .map(([requestId]) => ({ askedBy: owner, requestId }))
      const followed = new Set<string>()
      for (let asked = toFollow.shift(); asked !== undefined; asked = toFollow.shift()) {
        const key = aQuestionKey(asked.askedBy, asked.requestId)
        if (followed.has(key)) continue
        followed.add(key)
        reading = { ledger: asked.askedBy, question: asked.requestId }
        const parent =
          routedIn(asked.askedBy)
            .filter((one) => one.requestId === asked.requestId)
            .at(-1)?.parent ?? null
        const passers = new Set([
          ...(parent === null ? [] : this.theIdsItStandsFor(this.theOneInItsPlace(parent))),
          ...this.deps.store.conversationsHoldingACopyOf(asked.requestId),
        ])
        for (const passer of passers) {
          for (const [passedUp, words] of raisedIn(passer)) {
            if (words.passedUpFrom !== asked.requestId) continue
            reading = { ledger: passer, question: passedUp }
            const open = routedIn(passer).some(
              (one) => one.requestId === passedUp && REQUEST_IS_OPEN[one.state],
            )
            if (open) copies.push({ passer, requestId: passedUp })
            toFollow.push({ askedBy: passer, requestId: passedUp })
          }
        }
      }
    } catch (error) {
      failure ??= { ...reading, cause: errorMessage(error) }
    }
    return failure === undefined ? { ok: true, copies } : { ok: false, unreadQuestion: failure }
  }

  private endTheCopies(
    copies: PassedUpCopies,
    ending: QuestionEndedWithItsPieceEvent['ending'],
  ): () => void {
    const written = copies.map(({ passer, requestId }) =>
      this.appendInTheTransaction(passer, {
        type: 'question_ended_with_its_piece',
        requestId,
        ending,
      }),
    )
    return () => {
      for (const show of written) show()
    }
  }

  async passQuestionUp(
    input: {
      requestId: string
      who: Exclude<QuestionRecipient, 'an-agent'>
      context: string | null
      askedBy?: string | null
    },
    by: Caller,
  ): Promise<PassUpOutcome> {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) {
      return { ok: false, refusal: refuseQuestion('no-question-by-that-name') }
    }
    const named = this.theQuestionNamed(speaking, input.requestId, input.askedBy ?? null)
    if (named.is === 'refused') return { ok: false, refusal: named.refusal }
    const request = named.request
    const refusal = admitAnswer(request)
    if (refusal !== null) return { ok: false, refusal }
    if (request === undefined) throw new Error('a pass-up was admitted against no request (611)')
    if (request.went.is === 'the-agent-the-asker-named') {
      return {
        ok: false,
        refusal: refuseQuestion('a-question-asked-of-you-by-name-is-yours', {
          question: request.requestId,
        }),
      }
    }
    const session = this.slots.get(speaking)?.session ?? null
    if (session === null) {
      return { ok: false, refusal: refuseQuestion('no-question-by-that-name') }
    }
    const parent = this.whoItsQuestionsGoTo(speaking, request)
    if (input.who === 'the-parent' && parent === null) {
      return {
        ok: false,
        refusal: refuseQuestion('nobody-to-pass-it-up-to', { question: input.requestId }),
      }
    }
    const raised = this.deps.store.questionsRaisedIn(request.askedBy).get(request.requestId) ?? null
    if (raised === null) {
      return {
        ok: false,
        refusal: refuseQuestion('this-app-does-not-hold-those-words', {
          question: input.requestId,
        }),
      }
    }
    const requestId = newAskedQuestionId()
    this.publishOurs(session, {
      type: 'question_asked',
      requestId,
      passedUpFrom: request.requestId,
      prompt: raised.prompt,
      ...(input.context === null || input.context === '' ? {} : { context: input.context }),
      questions: raised.questions,
    })
    session.askedSinceItsLastTurnEnded.add(requestId)
    this.publishOurs(session, {
      type: 'request_routed',
      requestId,
      to: input.who,
      ...(parent === null ? {} : { parent }),
    })
    if (input.who === 'the-parent' && parent !== null) {
      void this.deliverQuestion(speaking, parent, {
        id: requestId,
        prompt: raised.prompt,
        questions: raised.questions,
        context: input.context,
      })
    }
    this.theWorldMoved('work')
    return {
      ok: true,
      question: requestId,
      carried: { question: request.requestId, askedBy: request.askedBy, piece: raised.piece },
    }
  }

  private tellWhoeverGaveTheWork(holder: string): void {
    try {
      const composed = this.whatItHolds(holder)
      this.sayWhenItsWorkMoved(holder, composed)
      for (const piece of composed) this.tellIfNobodyHasYet(piece)
    } catch (error) {
      console.warn(
        `runtime host could not report undriven work in ${holder}: ${errorMessage(error)}`,
      )
    }
  }

  private sayWhenItsWorkMoved(holder: string, composed: readonly PieceRow[]): void {
    const now = howItsWorkIsDrawn(composed)
    const before = this.heldAsLastRead.get(holder)
    this.heldAsLastRead.set(holder, now)
    const moved =
      before === undefined
        ? now.size > 0
        : composed.some((piece) => {
            const drawn = now.get(piece.piece)
            if (drawn === undefined) return false
            const was = before.get(piece.piece)
            return was === undefined
              ? piece.state !== 'working' && piece.state !== 'waiting'
              : was !== drawn
          })
    if (moved) this.theWorldMoved('work')
  }

  private sayWhetherALevelMovedItsWork(
    session: HostedSession,
    event: Extract<RuntimeEvent, { type: 'background_work' | 'scheduled_work' }>,
  ): void {
    if (capabilitiesFor(session.provider).backgroundWake.state !== 'available') return
    const ended = event.type === 'background_work' ? event.ended?.id : undefined
    const running = session.background.running.filter((one) => one.id !== ended)
    if (running.length > 0 || session.scheduled.jobs.length > 0) return
    try {
      this.sayWhenItsWorkMoved(session.id, this.whatItHolds(session.id))
    } catch (error) {
      console.warn(
        `runtime host could not read what ${session.id} holds as its background moved: ${errorMessage(error)}`,
      )
    }
  }

  private takeWhatItHolds(holder: string): void {
    try {
      this.heldAsLastRead.set(holder, howItsWorkIsDrawn(this.whatItHolds(holder)))
    } catch (error) {
      console.warn(
        `runtime host could not read what ${holder} holds as it started: ${errorMessage(error)}`,
      )
    }
  }

  private whatItHolds(holder: string): readonly PieceRow[] {
    return composeWhatEachPieceIsWaitingOn(
      this.deps.store.piecesOwnedBy(holder),
      this.oneWaitReadPerAnswer(),
    )
  }

  private tellAboutWorkItGaveOut(session: HostedSession): void {
    try {
      for (const piece of composeWhatEachPieceIsWaitingOn(
        this.theIdsItStandsFor(session.id).flatMap((id) => this.deps.store.piecesGivenBy(id)),
        this.oneWaitReadPerAnswer(),
      )) {
        this.tellIfNobodyHasYet(piece)
      }
    } catch (error) {
      console.warn(
        `runtime host could not report work given out by ${session.id}: ${errorMessage(error)}`,
      )
    }
  }

  private tellIfNobodyHasYet(piece: PieceRow): void {
    if (!aStallItsGiverCanBeToldOf(piece)) return
    if (piece.stalledBecause === 'turn_ended') return
    if (this.startComingAfterTheRestart.has(piece.owner)) return
    if (this.aReopenIsBeingDecidedFor.has(piece.owner)) return
    if (this.launches.closed && piece.stalledBecause === 'background_stopped') return
    if (this.aDeliveryIsAboutToDriveIt(piece)) return
    const slot = this.slots.get(this.theOneInItsPlace(piece.giver))
    const parent = slot?.phase === 'live' ? slot.session : null
    if (parent === null) {
      if (slot === undefined) this.startTheGiverFor(piece)
      return
    }
    if (parent.toldAboutStall.has(piece.piece)) return
    parent.toldAboutStall.add(piece.piece)
    const cause = piece.stalledBecause
    parent.telling = parent.telling.then(() => this.tellOneParent(parent, piece, cause))
  }

  private theRestartEnded(conversation: string, cause: TaskStallCause): boolean {
    if (cause === 'app_restarted') return true
    if (cause !== 'background_stopped') return false
    try {
      return this.deps.store.whatTheQuitClosed().includes(conversation)
    } catch {
      return false
    }
  }

  private aDeliveryIsAboutToDriveIt(piece: PieceRow): boolean {
    if (!aStallItsGiverCanBeToldOf(piece)) return false
    const cause = piece.stalledBecause
    if (!ITS_OWNER_RUNNING_AGAIN_DRIVES_IT[cause]) return false
    const holder = piece.owner
    if (!this.runsNow(holder)) return false
    const arriving = this.arrivals.has(holder)
    const session = this.slots.get(holder)?.session ?? null
    if (session !== null && session.holdingQueue > 0) return true
    const mayGoBack = piece.aTurnMayGoBackToIt === true
    if (mayGoBack && session !== null && this.aTurnRunsIn(session)) return true
    if (arriving) {
      this.askAgainOnceItArrived.add(holder)
      return true
    }
    const wordsMayGoBack = mayGoBack && session?.itsSignInMovedOn !== true
    let automaticWordsWait = false
    for (const held of session?.mailbox ?? []) {
      const drives = held.piece ?? held.drives
      if (
        !wordsMayGoBack &&
        held.interrupting === undefined &&
        drives !== undefined &&
        drives !== piece.piece
      ) {
        continue
      }
      if (aPersonsOwn(held)) return true
      automaticWordsWait = true
    }
    return (
      automaticWordsWait &&
      (session === null ||
        this.theResetItWaitsFor(
          session.provider,
          this.limitAccountOf(session.id, session.lifeSince),
        ) === null)
    )
  }

  private startTheGiverFor(
    piece: PieceAConversationGave & { readonly stalledBecause: TaskStallCause },
  ): void {
    if (this.launches.closed || piece.stalledBecause === 'app_restarted') return
    if (piece.stalledAt === null || piece.stalledAt < this.upSince) return
    const giver = this.theOneInItsPlace(piece.giver)
    if (this.startable(giver) === null) return
    if (this.keptStopped(giver)) return
    if (this.deps.store.workReportedTo(giver).has(piece.piece)) return
    this.ensureRunning(giver, null).catch((error: unknown) => {
      console.warn(
        `runtime host could not start ${giver} to tell it about ${piece.piece}: ${errorMessage(error)}`,
      )
    })
  }

  private async tellOneParent(
    parent: HostedSession,
    piece: PieceAConversationGave,
    cause: TaskStallCause,
  ): Promise<void> {
    try {
      const held = await this.queueMessage(
        parent.id,
        undrivenWorkText(
          piece,
          cause,
          this.theExchangeShownWith(piece),
          this.whatToCallTheConversation(piece.owner),
          theAskNamed(
            piece.stalledBy,
            (conversation) => this.nameByItsWorkUnder(conversation, piece.piece),
            parent.id,
          ),
          (who) => this.nameByItsWorkUnder(who.conversation, who.about ?? null),
          this.mayReadTheTranscriptOf(piece.owner, parent.id),
          this.theRestartEnded(piece.owner, cause),
          this.whatStillRunsIn(piece.owner),
          this.slots.get(piece.owner)?.session?.lastStopEnded ?? [],
        ),
        THE_APP_ITSELF,
        [],
        'notice',
        { report: workUndriven(piece, cause) },
      )
      this.publishOurs(parent, {
        type: 'work_stall_told',
        piece: piece.piece,
        cause,
        how: 'pushed',
        ...(held.outcome === 'queued' ? { messageId: held.messageId } : {}),
      })
    } catch (error) {
      console.warn(
        `runtime host could not tell ${parent.id} that ${piece.piece} is undriven: ${errorMessage(
          error,
        )}`,
      )
    }
  }

  private takeBackWhatALaterFactMadeFalse(
    piece: PieceAConversationGave,
    fact: WhatMadeItFalse,
  ): void {
    const slot = this.slots.get(piece.giver)
    const parent = slot?.phase === 'live' ? slot.session : null
    if (parent === null) {
      this.takeBackWhatWaitsForTheGiversStart(piece, fact, slot?.session ?? null)
      return
    }
    parent.telling = parent.telling.then(() => {
      try {
        const unread = this.theNoticesItWillStillRead(parent, piece.piece)
        if (unread.length === 0) return
        const detail = aNoticeALaterFactRetracted(fact, this.whatToCallTheConversation(piece.owner))
        for (const one of unread) this.takeQueuedBack(parent, one, { reason: 'retracted', detail })
        this.publishStateIfChanged(parent)
      } catch (error) {
        console.warn(
          `runtime host could not take back what ${parent.id} was told about ${piece.piece}: ${errorMessage(
            error,
          )}`,
        )
      }
    })
  }

  private takeBackWhatWaitsForTheGiversStart(
    piece: PieceAConversationGave,
    fact: WhatMadeItFalse,
    stopping: HostedSession | null,
  ): void {
    const giver = piece.giver
    try {
      const handedOn = this.heldAtAStop.get(giver) ?? []
      const unread = this.theNoticesItWillStillRead(
        {
          mailbox: [...(stopping?.mailbox ?? []), ...handedOn],
          handingOver: stopping?.handingOver ?? [],
        },
        piece.piece,
      )
      if (unread.length === 0) return
      const detail = aNoticeALaterFactRetracted(fact, this.whatToCallTheConversation(piece.owner))
      for (const one of unread) {
        if (stopping !== null && stopping.mailbox.includes(one)) {
          this.takeQueuedBack(stopping, one, { reason: 'retracted', detail })
          continue
        }
        if (this.whatWaitsForItsStart(giver, one.id) === undefined) continue
        this.writeIntoItsLedger(giver, {
          type: 'message_unqueued',
          messageId: one.id,
          reason: 'retracted',
          detail,
          text: one.text,
          ...(one.attachments.length > 0 ? { attachments: [...one.attachments] } : {}),
          ...one.authorship,
        })
      }
      this.theWorldMoved('work')
    } catch (error) {
      console.warn(
        `runtime host could not take back what ${giver} was told about ${piece.piece}: ${errorMessage(
          error,
        )}`,
      )
    }
  }

  private theNoticesItWillStillRead(parent: WhatAGiverHolds, piece: string): QueuedMessage[] {
    return parent.mailbox.filter(
      (one) =>
        !parent.handingOver.includes(one) &&
        one.kind === 'notice' &&
        (one.authorship.work?.piece === piece ||
          (one.authorship.appNotice === 'a-work-wait-needs-attention' && one.about === piece)),
    )
  }

  takeBackWhatItsQuestionMadeFalse(
    input: { readonly agent: string; readonly piece: string },
    by: Caller,
  ): void {
    const asking = sessionSpeakingAs(by)
    if (asking === null) return
    const piece = this.deps.store
      .piecesOwnedBy(input.agent)
      .find((one) => one.piece === input.piece && one.giver === asking)
    if (piece === undefined || !givenByAConversation(piece) || !TASK_IS_OPEN[piece.state]) return
    this.takeBackWhatALaterFactMadeFalse(piece, 'asked-about-it')
  }

  private moveTheListing(): void {
    this.listingVersion++
    this.publicationSeq++
  }

  private moveThePersons(): void {
    this.personsVersion++
    this.publicationSeq++
  }

  currentEpoch(): PublicationEpoch {
    this.deps.store.checkCommitted()
    return this.publicationEpoch
  }

  private forAPerson<T>(name: string, compose: () => T, complete?: (value: T) => boolean): T {
    return this.keptUntilItMoves(
      this.personsKept,
      () => this.personsVersion,
      name,
      compose,
      complete,
    )
  }

  private atTheListing<T>(name: string, compose: () => T, complete?: (value: T) => boolean): T {
    return this.keptUntilItMoves(
      this.listingAnswersKept,
      () => this.listingVersion,
      name,
      compose,
      complete,
    )
  }

  private keptUntilItMoves<T>(
    kept: Map<string, { readonly at: number; readonly value: unknown }>,
    version: () => number,
    name: string,
    compose: () => T,
    complete: (value: T) => boolean = everyRowWasRead,
  ): T {
    this.deps.store.checkCommitted()
    const one = kept.get(name)
    if (one !== undefined && one.at === version()) return one.value as T
    const at = version()
    const value = compose()
    if (version() === at && complete(value)) kept.set(name, { at, value })
    else kept.delete(name)
    return value
  }

  private instructionAsksNow(): readonly InstructionAskWaiting[] {
    return this.instructionAsksCounted().rows
  }

  private instructionAsksCounted(): CountedRows<InstructionAskWaiting> {
    return this.forAPerson('instructionAsksWaiting', () => {
      const unread = rowsUnreadOnce()
      const rows = this.deps.store.instructionAsksWaiting(unread)
      return { rows, rowsUnread: unread.count }
    })
  }

  private mcpServerRequestsNow(): ReturnType<SessionStore['mcpServerRequestsWaiting']> {
    return this.mcpServerRequestsCounted().rows
  }

  private mcpServerRequestsCounted(): CountedRows<McpServerRequestWaiting> {
    return this.forAPerson('mcpServerRequestsWaiting', () => {
      const unread = rowsUnreadOnce()
      const rows = this.deps.store.mcpServerRequestsWaiting(unread)
      return { rows, rowsUnread: unread.count }
    })
  }

  async readForWindow<T>(answer: () => T): Promise<T> {
    if (this.deps.windowReader === undefined) {
      this.deps.store.checkCommitted()
      return answer()
    }
    if (this.launches.closed) throw new WindowReadUnavailable()
    const compose = (result: WindowReadResult): T => {
      if (result.kind !== 'routes') throw new WindowReadMissed('worker-gone')
      return this.windowRoutingReads.run(result, answer)
    }
    if (this.windowReadCallers >= WINDOW_READ_BOUNDS.callers) {
      try {
        return await this.freshWindowQuery({ kind: 'routes' }, compose, undefined, true)
      } catch (error) {
        if (!(error instanceof WindowReadMissed) || this.launches.closed) throw error
        return this.answeredOnTheMainThread(error.missed, answer)
      }
    }
    this.windowReadCallers++
    let missed: WindowReadMiss
    try {
      return await this.freshWindowQuery({ kind: 'routes' }, compose)
    } catch (error) {
      if (!(error instanceof WindowReadMissed) || this.launches.closed) throw error
      missed = error.missed
    } finally {
      this.windowReadCallers--
    }
    return this.answeredOnTheMainThread(missed, answer)
  }

  private answeredOnTheMainThread<T>(missed: WindowReadMiss, answer: () => T): T {
    this.deps.store.checkCommitted()
    const at = this.now()
    const before = this.windowReadMisses.get(missed)
    const count = (before?.count ?? 0) + 1
    const say = before === undefined || at - before.saidAt >= SAY_A_WINDOW_READ_MISS_EVERY_MS
    this.windowReadMisses.set(missed, { count, saidAt: say ? at : (before?.saidAt ?? at) })
    if (say) {
      console.warn(`window read answered on the main thread: ${missed} (${count} since launch)`)
    }
    const work = this.deps.mainThreadWork
    return work === undefined
      ? answer()
      : work.timed('runtime window read on the main thread', answer)
  }

  private sampleWindowWriter(query: WindowReadQuery): WindowWriterStamp | null {
    if (query.kind !== 'incidents' && this.deps.windowWriterStamp !== undefined)
      return this.deps.windowWriterStamp(query)
    const stamp = this.deps.limitsWriterStamp?.() ?? null
    return stamp === null
      ? null
      : {
          writer: stamp.writer,
          watcher: 0,
          revision: stamp.totalChanges,
          dataVersion: stamp.dataVersion,
          at: stamp.at,
        }
  }

  private async freshWindowQuery<T>(
    query: WindowReadQuery,
    compose: (result: WindowReadResult) => T,
    signal?: AbortSignal,
    joinOnly = false,
  ): Promise<T> {
    const reader = this.deps.windowReader
    if (reader === undefined) throw new WindowReadMissed('worker-gone')
    for (let attempt = 0; attempt < (joinOnly ? 1 : 2); attempt++) {
      if (this.launches.closed) throw new WindowReadUnavailable()
      if (signal?.aborted === true) throw new WindowReadUnavailable()
      const before = this.sampleWindowWriter(query)
      if (before === null) {
        this.windowRoutesKept = undefined
        this.windowIncidentsKept = undefined
        throw new WindowReadMissed('writer-unsampled')
      }
      const reusable = query.kind === 'routes' || query.kind === 'incidents'
      const kept = query.kind === 'incidents' ? this.windowIncidentsKept : this.windowRoutesKept
      if (reusable && kept !== undefined && sameWindowWriter(kept.stamp, before)) {
        this.deps.store.checkCommitted()
        return compose(kept.result)
      }
      const kind = query.kind === 'incidents' ? 'incidents' : 'routes'
      const failed = reusable ? this.windowReadsFailed.get(kind) : undefined
      if (
        failed !== undefined &&
        sameWindowWriter(failed.stamp, before) &&
        this.now() < failed.until
      )
        throw failed.missed
      let pending: Promise<WindowReadResult>
      let origin = before
      if (reusable) {
        const key = query.kind === 'incidents' ? 'windowIncidentsPending' : 'windowRoutesPending'
        let shared = this[key]
        if (shared === undefined && joinOnly) throw new WindowReadMissed('callers-full')
        if (shared === undefined) {
          shared = { stamp: before, read: reader.read(query) }
          this[key] = shared
          const owned = shared
          void owned.read.then(
            () => this.windowReadsFailed.delete(kind),
            (error: unknown) => this.rememberAFailedWindowRead(kind, owned.stamp, error),
          )
          void owned.read
            .finally(() => {
              if (this[key] === owned) this[key] = undefined
            })
            .catch(() => {})
        }
        pending = shared.read
        origin = shared.stamp
      } else pending = reader.read(query, signal)
      let result: WindowReadResult
      try {
        result = await this.waitForWindowRead(pending, signal)
      } catch (error) {
        throw whyTheWorkerMissed(error, signal)
      }
      if (this.launches.closed) throw new WindowReadUnavailable()
      const after = this.sampleWindowWriter(query)
      if (sameWindowWriter(origin, before) && sameWindowWriter(origin, after)) {
        if (query.kind === 'routes') this.windowRoutesKept = { stamp: after!, result }
        if (query.kind === 'incidents') this.windowIncidentsKept = { stamp: after!, result }
        this.deps.store.checkCommitted()
        return compose(result)
      }
    }
    throw new WindowReadMissed('writer-moved')
  }

  private rememberAFailedWindowRead(
    kind: 'routes' | 'incidents',
    stamp: WindowWriterStamp,
    error: unknown,
  ): void {
    const missed = whyTheWorkerMissed(error, undefined)
    if (!(missed instanceof WindowReadMissed) || !REMEMBERED_WINDOW_READ_MISSES.has(missed.missed))
      return
    const before = this.windowReadsFailed.get(kind)
    const wait =
      before !== undefined && sameWindowWriter(before.stamp, stamp)
        ? Math.min(before.wait * 2, A_FAILED_WINDOW_READ_WAITS_AT_MOST_MS)
        : A_FAILED_WINDOW_READ_WAITS_MS
    this.windowReadsFailed.set(kind, {
      stamp,
      missed,
      wait,
      until: this.now() + wait,
    })
  }

  private waitForWindowRead(
    read: Promise<WindowReadResult>,
    signal?: AbortSignal,
  ): Promise<WindowReadResult> {
    if (signal === undefined) return read
    return new Promise((resolve, reject) => {
      const cleanUp = () => signal.removeEventListener('abort', aborted)
      const aborted = () => {
        cleanUp()
        reject(new WindowReadUnavailable())
      }
      signal.addEventListener('abort', aborted, { once: true })
      void read.then(
        (result) => {
          cleanUp()
          resolve(result)
        },
        (error: unknown) => {
          cleanUp()
          reject(error)
        },
      )
      if (signal.aborted) aborted()
    })
  }

  private withinTheLeadsGrace(
    read: Promise<readonly ThreadLeadRow[] | null>,
  ): Promise<readonly ThreadLeadRow[] | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), this.reopenLeadsGraceMs)
      if (typeof timer.unref === 'function') timer.unref()
      void read.then(
        (rows) => {
          clearTimeout(timer)
          resolve(rows)
        },
        () => {
          clearTimeout(timer)
          resolve(null)
        },
      )
    })
  }

  private async readThreadLeads(
    sessionId: string,
    before: number,
    signal?: AbortSignal,
  ): Promise<readonly ThreadLeadRow[] | null> {
    if (this.deps.windowReader === undefined) {
      return (
        this.deps.store.threadLeadRows?.(
          sessionId,
          LEADS_OPEN_WITH,
          before,
          HISTORICAL_LEADS_OPEN_WITH,
        ) ?? null
      )
    }
    return this.freshWindowQuery(
      {
        kind: 'leads',
        sessionId,
        before,
        opening: LEADS_OPEN_WITH,
        historicalOpening: HISTORICAL_LEADS_OPEN_WITH,
      },
      (result) => {
        if (result.kind !== 'leads') throw new WindowReadUnavailable()
        return result.rows
      },
      signal,
    )
  }

  questionsForAPerson(): LedgerWalk<PersonsQuestion> {
    return this.forAPerson('questionsForAPerson', () => this.personsQuestions.questionsForAPerson())
  }

  decisionsForAPerson(): LedgerWalk<PersonsDecision> {
    return this.forAPerson('decisionsForAPerson', () => this.personsQuestions.decisionsForAPerson())
  }

  private prepareInitialProviderLimitFacts(): void {
    if (
      this.providerLimitsPrepared ||
      this.providerLimitsPreparationPending ||
      this.launches.closed
    )
      return
    if (this.deps.limitsReader === undefined) return
    this.providerLimitsPreparationPending = true
    void this.readLimitsDisplay().finally(() => {
      this.providerLimitsPreparationPending = false
    })
  }

  private acceptWorkerProviderLimits(
    input: LimitsReadInput,
    result: LimitsReadResult,
    token: unknown,
  ): void {
    const scope = this.deps.limitsReader?.scope
    if (
      this.launches.closed ||
      scope === undefined ||
      input.operation !== result.operation ||
      input.databaseEpoch !== scope.databaseEpoch ||
      input.signInEpoch !== scope.signInEpoch ||
      result.databaseEpoch !== scope.databaseEpoch ||
      result.signInEpoch !== scope.signInEpoch ||
      result.operation <= this.providerLimitsOperation
    )
      return
    this.providerLimitsOperation = result.operation
    if (!completeCanonicalLimits(result)) return
    const now = this.now()
    if (
      !Number.isFinite(now) ||
      result.snapshotPinStartedAt > result.evaluatedAt ||
      result.evaluatedAt > result.readFinishedAt ||
      result.readFinishedAt > now
    )
      return
    const retired = this.providerLimitFacts.retireUnsupportedHistory(
      result.canonical,
      result.snapshotPinStartedAt,
      result.evaluatedAt,
    )
    if (retired) {
      this.armProviderLimitExpiry()
      this.publishProviderLimitFactsSoon()
    }
    const proof = token as
      { readonly epoch: number; readonly stamp: LimitsWriterStamp | null } | undefined
    if (proof === undefined || proof.epoch !== this.providerLimitEpoch) return
    const after = this.deps.limitsWriterStamp?.() ?? null
    if (!freshLimitsSnapshot(input, result, proof.stamp, after)) return
    this.prepareProviderLimitFacts(result.canonical, result.evaluatedAt, proof.epoch)
  }

  private prepareProviderLimitFacts(
    walk: LedgerWalk<ProviderLimitSeen>,
    at: number,
    epoch: number,
    confirmedThrough?: number,
  ): void {
    if (epoch !== this.providerLimitEpoch || this.launches.closed) return
    this.providerLimitsPrepared = true
    const changed = this.providerLimitFacts.prepare(
      walk,
      at,
      confirmedThrough ?? (() => this.now()),
    )
    this.armProviderLimitExpiry()
    if (changed) this.publishProviderLimitFactsSoon()
  }

  private invalidateProviderLimitFacts(): void {
    this.providerLimitEpoch++
    this.providerLimitFacts.invalidate()
    this.armProviderLimitExpiry()
    this.publishProviderLimitFactsSoon()
  }

  private armProviderLimitExpiry(): void {
    if (this.providerLimitExpiry !== null) clearTimeout(this.providerLimitExpiry)
    this.providerLimitExpiry = null
    if (this.launches.closed) return
    const now = this.now()
    const elapsed = performance.now()
    if (!Number.isFinite(now) || !Number.isFinite(elapsed)) {
      this.providerLimitFacts.retireHistory()
      return
    }
    const histories = this.providerLimitFacts.historyExpirations().map((history) => {
      let due = this.providerLimitHistoryDeadlines.get(history.value)
      if (due === undefined) {
        due = elapsed + Math.max(0, history.at - now)
        this.providerLimitHistoryDeadlines.set(history.value, due)
      }
      return { ...history, due }
    })
    const at = this.providerLimitFacts.nextChange(now)
    const delay = Math.min(
      at === null ? Infinity : at - now,
      ...histories.map((history) => Math.max(0, history.due - elapsed)),
      2_147_483_647,
    )
    if (at === null && histories.length === 0) return
    const timer = setTimeout(() => {
      if (this.providerLimitExpiry !== timer) return
      this.providerLimitExpiry = null
      const finished = performance.now()
      for (const history of histories) {
        if (!Number.isFinite(finished) || finished >= history.due) history.retire()
      }
      this.providerLimitFacts.expire(this.now())
      this.publishProviderLimitFactsSoon()
      this.armProviderLimitExpiry()
    }, delay)
    this.providerLimitExpiry = timer
    this.providerLimitExpiry.unref?.()
  }

  private providerBlockDisclosure(
    conversation: string,
    provider = this.providerLimitLives.get(conversation)?.provider,
  ): Pick<SessionLiveness, 'providerBlock' | 'providerBlockStatus' | 'providerBlockLastKnown'> {
    const slot = this.slots.get(conversation)
    const session = slot?.session ?? null
    const life =
      session === null || !this.isCurrentLife(session) || onItsWayOut(slot!)
        ? null
        : (this.providerLimitLives.get(conversation)?.life ?? null)
    const active =
      this.startsInFlight.has(conversation) ||
      this.arrivals.has(conversation) ||
      (slot !== undefined &&
        !onItsWayOut(slot) &&
        (session === null ||
          session.handle.status() === 'working' ||
          session.handle.status() === 'waiting_permission'))
    const fact: CurrentFact<ConversationProviderBlock> =
      provider === undefined
        ? { status: 'current', value: null }
        : !active && session?.recordingFailure !== null && session?.recordingFailure !== undefined
          ? this.providerLimitFacts.hasStoppedEpisode(conversation, life, provider)
            ? { status: 'unavailable' }
            : { status: 'current', value: null }
          : this.providerLimitFacts.block(
              conversation,
              life,
              provider,
              active,
              life !== null && session!.mailbox.some((one) => !aPersonsOwn(one)),
              this.now(),
            )
    const history =
      provider === undefined ||
      session === null ||
      !this.isCurrentLife(session) ||
      onItsWayOut(slot!)
        ? null
        : this.providerLimitFacts.lastKnown(conversation, life, provider, active, this.now())
    return fact.status === 'unavailable'
      ? { providerBlockStatus: 'unavailable', providerBlockLastKnown: history }
      : {
          providerBlockStatus: 'current',
          providerBlock: fact.value,
          providerBlockLastKnown: history,
        }
  }

  private providerLimitDisclosures(
    session: HostedSession,
    queued = queuedDisclosure(session.mailbox),
  ): ProviderLimitDisclosure {
    const now = this.now()
    const origins = new Map(session.mailbox.map((message) => [message.id, aPersonsOwn(message)]))
    const current = this.isCurrentLife(session) && !onItsWayOut(this.slots.get(session.id)!)
    return {
      ...(current
        ? this.providerBlockDisclosure(session.id, session.provider)
        : {
            providerBlockStatus: 'current' as const,
            providerBlock: null,
            providerBlockLastKnown: null,
          }),
      queued: queued.map((row) => {
        const person = origins.get(row.id)
        const fact =
          !current || person === undefined
            ? ({ status: 'unavailable' } as const)
            : this.providerLimitFacts.hold(
                session.provider,
                person,
                now,
                this.limitAccountOf(session.id, now),
              )
        return fact.status === 'unavailable'
          ? { ...row, holdReasonStatus: 'unavailable' as const }
          : { ...row, holdReasonStatus: 'current' as const, holdReason: fact.value }
      }),
    }
  }

  private publishProviderLimitFactsSoon(conversation?: string): void {
    this.moveTheListing()
    if (conversation === undefined) this.providerLimitsAllMoved = true
    else this.providerLimitsMoved.add(conversation)
    if (this.providerLimitsPublicationAsked || this.launches.closed) return
    this.providerLimitsPublicationAsked = true
    setImmediate(() => {
      this.providerLimitsPublicationAsked = false
      const changed = this.providerLimitsAllMoved
        ? [...this.providerLimitLives.keys()]
        : [...this.providerLimitsMoved]
      this.providerLimitsAllMoved = false
      this.providerLimitsMoved.clear()
      if (this.launches.closed) return
      for (const conversation of changed) {
        if (
          this.providerBlockSaid.get(conversation) !==
          JSON.stringify(this.providerBlockDisclosure(conversation))
        )
          this.stateMayHaveMoved(conversation)
        const session = this.slots.get(conversation)?.session ?? null
        if (session === null) continue
        try {
          this.publishStateIfChanged(session)
        } catch (error) {
          console.warn(
            `runtime host could not publish the providers' limits: ${errorMessage(error)}`,
          )
        }
      }
    })
  }

  limitsForAPerson(): LedgerWalk<ProviderLimitSeen> {
    const now = this.now()
    const epoch = this.providerLimitEpoch
    let walk: LedgerWalk<ProviderLimitSeen>
    try {
      walk = this.deps.store.providerLimitsSeen(
        now,
        this.signInChangedAt,
        this.limitAccountSnapshot(),
      )
    } catch (error) {
      this.invalidateProviderLimitFacts()
      throw error
    }
    this.prepareProviderLimitFacts(walk, now, epoch)
    const near = wallsFromUsage(this.usageThatCounts(), walk.rows, now)
    return near.length === 0
      ? walk
      : { ...walk, rows: foldProviderLimits([...walk.rows, ...near], [], now) }
  }

  async readLimitsForWindow(): Promise<LedgerWalk<ProviderLimitSeen>> {
    if (this.deps.limitsReader === undefined) return this.limitsForAPerson()
    const result = await this.readWorkerLimits()
    if (this.launches.closed) throw new WindowReadUnavailable()
    return result.display
  }

  private async readWorkerLimits(): Promise<LimitsReadResult> {
    const reader = this.deps.limitsReader
    if (reader === undefined || this.launches.closed) throw new WindowReadUnavailable()
    const usage = this.usageThatCounts()
    const capturedUsage = (provider: Provider) =>
      usage[provider].map(({ window, usedPercent, resetsAt, at }) => ({
        window,
        usedPercent,
        resetsAt,
        at,
      }))
    return reader.read({
      capturedAt: this.now(),
      signInChangedAt: Object.fromEntries(this.signInChangedAt),
      accountLives: this.limitAccountSnapshot(),
      usage: providerRecord(capturedUsage),
    })
  }

  async readLimitsDisplay(): Promise<LimitsDisplayAnswer> {
    const reader = this.deps.limitsReader
    const unavailable = (): LimitsDisplayAnswer => ({
      is: 'unavailable',
      ...(reader?.scope ?? { databaseEpoch: 0, signInEpoch: 0 }),
    })
    if (reader === undefined || this.launches.closed) return unavailable()
    try {
      const result = await this.readWorkerLimits()
      if (this.launches.closed) return unavailable()
      return {
        is: 'read',
        reading: {
          operation: result.operation,
          databaseEpoch: result.databaseEpoch,
          signInEpoch: result.signInEpoch,
          pinStartedAt: result.snapshotPinStartedAt,
          pinFinishedAt: result.snapshotPinnedAt,
          evaluatedAt: result.evaluatedAt,
          usageAt: result.inputCapturedAt,
          finishedAt: result.readFinishedAt,
          walked: result.display,
        },
      }
    } catch {
      return unavailable()
    }
  }

  instructionAsksForAPerson(): readonly InstructionAskWaiting[] {
    return this.forAPerson('instructionAsksForAPerson', () =>
      this.instructionAsksForAPersonComposed(),
    )
  }

  private instructionAsksForAPersonComposed(): readonly InstructionAskWaiting[] {
    return this.instructionAsksNow()
  }

  mcpServerRequestsForAPerson(): readonly McpServerRequestForAPerson[] {
    return this.forAPerson('mcpServerRequestsForAPerson', () =>
      this.mcpServerRequestsForAPersonComposed(),
    )
  }

  private mcpServerRequestsForAPersonComposed(): readonly McpServerRequestForAPerson[] {
    return this.mcpServerRequestsNow().map((one) => ({
      ...one,
      askerCalled: this.whatToCallTheConversation(this.theOneInItsPlace(one.conversation)),
    }))
  }

  stalledWorkForAPerson(): LedgerWalk<StalledWork> {
    return this.forAPerson('stalledWorkForAPerson', () => this.stalledWorkForAPersonComposed())
  }

  private stalledWorkForAPersonComposed(): LedgerWalk<StalledWork> {
    const called = new Map<string, string>()
    const whatToCall = (conversation: string): string => {
      const held = called.get(conversation)
      if (held !== undefined) return held
      const word = this.whatToCallTheConversation(conversation)
      called.set(conversation, word)
      return word
    }
    const byItsWork = new Map<string, string>()
    const nameByItsWork = (conversation: string, piece: string): string => {
      const key = `${conversation}\u0000${piece}`
      const held = byItsWork.get(key)
      if (held !== undefined) return held
      const word = this.nameByItsWorkUnder(conversation, piece)
      byItsWork.set(key, word)
      return word
    }
    const unread = rowsUnreadOnce()
    const walked = this.shown(
      this.deps.store.stalledWorkNobodyWasToldAbout(unread),
      (row) => row.owner,
    )
    return {
      walk: walked.walk,
      ledgers: walked.ledgers,
      rowsUnread: walked.rowsUnread,
      rows: walked.rows.flatMap((piece) => {
        if (!aStallItsGiverCanBeToldOf(piece)) return []
        if (piece.stalledBecause === 'turn_ended') return []
        return [
          {
            piece: piece.piece,
            label: piece.label,
            title: piece.title,
            owner: piece.owner,
            ownerName: whatToCall(piece.owner),
            giver: piece.giver,
            giverName: whatToCall(piece.giver),
            because: piece.stalledBecause,
            askedToStop:
              piece.stalledBy === null
                ? null
                : {
                    by: piece.stalledBy.by,
                    asker: piece.stalledBy.asker,
                    askerName:
                      piece.stalledBy.asker === null
                        ? null
                        : nameByItsWork(piece.stalledBy.asker, piece.piece),
                  },
            stalledAt: piece.stalledAt,
          },
        ]
      }),
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  stoppedWorkForAPerson(): LedgerWalk<StoppedWorkForAPerson> {
    return this.forAPerson('stoppedWorkForAPerson', () => this.stoppedWorkForAPersonComposed())
  }

  private stoppedWorkForAPersonComposed(): LedgerWalk<StoppedWorkForAPerson> {
    const names = new Map<string, string>()
    const nameOf = (conversation: string): string => {
      const known = names.get(conversation)
      if (known !== undefined) return known
      const word = this.whatToCallTheConversation(conversation)
      names.set(conversation, word)
      return word
    }
    const unread = rowsUnreadOnce()
    const found = this.shown(
      this.deps.store.stalledWorkItsGiverWasToldAbout(unread),
      (row) => row.owner,
    )
    const rows = found.rows.flatMap((row) => {
      if (!aStallItsGiverCanBeToldOf(row) || row.stalledAt === null) return []
      if (!this.itsHolderIsStopped(row.owner, unread)) return []
      const { piece, label, title, owner, giver, stalledAt } = row
      const holderName = nameOf(owner)
      const giverName = nameOf(giver)
      return [{ piece, label, title, holder: owner, holderName, giver, giverName, at: stalledAt }]
    })
    return {
      walk: found.walk,
      ledgers: found.ledgers,
      rowsUnread: unread.count,
      rows,
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  private reconciliationReading(
    onlyPiece?: string,
    holders?: ReadonlySet<string>,
    boundary?: { next: number },
  ) {
    const unread = rowsUnreadOnce()
    const rows: (ReconciliationPiece & {
      work: WorkRow
      title: string | null
      validWait: boolean
      recoveryIncident?: Pick<WorkIncident, 'kind' | 'since' | 'recovery'> | null
    })[] = []
    const named = onlyPiece === undefined ? null : this.deps.store.workById(onlyPiece)
    const owners =
      onlyPiece === undefined
        ? (holders ?? new Set(this.deps.store.reconciliationOwners()))
        : new Set(named === null ? [] : [named.owner])
    const all =
      onlyPiece === undefined
        ? this.deps.store.reconciliationWork(owners, unread)
        : named === null
          ? []
          : [named]
    const grouped = new Map<string, WorkRow[]>()
    for (const row of all) {
      const own = grouped.get(row.owner) ?? []
      own.push(row)
      grouped.set(row.owner, own)
    }
    const elsewhere = workRunningElsewhere(this)
    const driven = new Map<string, readonly string[]>()
    const logins = new Map<string, WorkRecoveryEvent | null>()
    for (const owner of owners) {
      if (!grouped.has(owner)) continue
      const local = rowsUnreadOnce()
      const note = (ordinal: Parameters<ReturnType<typeof local.in>>[0]) => {
        local.in(owner)(ordinal)
        unread.in(owner)(ordinal)
      }
      try {
        const counting = {
          in: (id: string) => (ordinal: Parameters<typeof note>[0]) => {
            local.in(id)(ordinal)
            unread.in(id)(ordinal)
          },
          get count() {
            return local.count
          },
          get ledgersSkipped() {
            return local.ledgersSkipped
          },
        }
        const outstanding = this.oneWaitReadPerAnswer(counting)(owner)
        const held = new Map(
          composeWhatEachPieceIsWaitingOn(
            this.deps.store.openPiecesOf(owner, counting),
            () => outstanding,
          ).map((one) => [one.piece, one]),
        )
        const drivingNow = !this.nothingIsOnItsWayTo(owner, counting)
        let stoppedByPerson: boolean | undefined
        for (const work of grouped.get(owner) ?? []) {
          const folded = held.get(work.piece)
          const completeRoot =
            work.parent === null ? this.deps.store.turnBlockRootLines(work.piece) : null
          const root = completeRoot === null ? null : this.deps.store.rootLines(work.piece)
          const line = root?.statusLine ?? folded?.statusLine ?? null
          const watched = new Set<string>()
          const waitProblem =
            line?.waiting === true && line.on !== undefined
              ? this.reconciliationWaitProblem(work, line.on, line.by, watched, boundary)
              : null
          const one: ReconciliationPiece & {
            work: WorkRow
            title: string | null
            validWait: boolean
            recoveryIncident?: Pick<WorkIncident, 'kind' | 'since' | 'recovery'> | null
          } = {
            work,
            piece: work.piece,
            label: work.label,
            holder: owner,
            giver: work.givenBy,
            stalledBy: folded?.stalledBy ?? null,
            title: root?.title ?? folded?.title ?? work.title,
            disposition: 'unknown',
            issue: null,
            validWait: false,
            ...(watched.size === 0 ? {} : { waitsFor: [...watched] }),
          }
          if (work.parent === null ? root === null : folded === undefined) note('the-whole-ledger')
          if (
            local.count !== 0 ||
            local.ledgersSkipped !== 0 ||
            elsewhere.has(owner) ||
            (work.parent === null ? root === null : folded === undefined)
          ) {
            rows.push(one)
            continue
          }
          if (folded !== undefined && !TASK_IS_OPEN[folded.state]) {
            rows.push({ ...one, disposition: 'ended' })
            continue
          }
          if (
            folded?.state === 'stalled' &&
            line?.waiting !== true &&
            work.givenBy !== null &&
            (folded.stalledBecause === 'turn_ended'
              ? this.deps.store.legacyOrdinaryStallWasReported(owner, work.piece, work.givenBy)
              : this.deps.store.workReportedTo(work.givenBy).has(work.piece))
          ) {
            rows.push(one)
            continue
          }
          if (
            outstanding.aPerson ||
            outstanding.answers.has(work.piece) ||
            outstanding.childrenOpen.has(work.piece) ||
            (folded?.state.startsWith('waiting-on-') && folded.state !== 'waiting-on-purpose')
          ) {
            rows.push({ ...one, disposition: 'waiting', validWait: true })
            continue
          }
          let issue: ReconciliationPiece['issue'] = null
          if (line?.waiting === true) {
            if (line.on === undefined) issue = { kind: 'wait-needs-classification', since: line.at }
            else {
              const problem = waitProblem
              if (problem === null) {
                rows.push({ ...one, disposition: 'waiting', validWait: true })
                continue
              }
              issue = {
                kind: problem,
                since: line.at,
                ...(line.on.kind === 'time' ? { due: true as const } : {}),
              }
            }
          } else if (folded?.state.startsWith('waiting-on-')) {
            rows.push({ ...one, disposition: 'waiting', validWait: true })
            continue
          } else if (
            folded?.stalledBecause != null &&
            folded.stalledAt !== null &&
            (work.givenBy === null ||
              folded.stalledBecause === 'message_never_sent' ||
              folded.stalledBecause === 'turn_ended')
          ) {
            issue = {
              kind:
                folded.stalledBecause === 'message_never_sent' ? 'notice-not-delivered' : 'stopped',
              cause: folded.stalledBecause,
              since: folded.stalledAt,
            }
          }
          if (issue !== null && line?.waiting === true && line.revision !== undefined)
            issue = {
              ...issue,
              waitKey: `${owner}:${this.deps.store.theActiveGeneration(owner)}:${line.revision}`,
            }
          const recovery = this.recoveryForPiece(work, driven, logins)
          const recovering = recovery?.kind === 'recovery-pending'
          if (recovery !== null && !recovering)
            issue = {
              kind: recovery.kind,
              since: recovery.since,
              ...(folded?.stalledBecause == null ? {} : { cause: folded.stalledBecause }),
            }
          const driving =
            recovering ||
            this.aReopenIsBeingDecidedFor.has(owner) ||
            this.reopeningForWhatWaited.has(owner) ||
            this.slots.get(owner)?.session?.reopeningOnTheCurrentSignIn === true ||
            drivingNow
          rows.push({
            ...one,
            issue,
            recoveryIncident: recovery,
            ...(issue !== null && (stoppedByPerson ??= this.reconciliationStoppedByPerson(owner))
              ? { stoppedByPerson: true }
              : {}),
            disposition:
              local.count !== 0 || local.ledgersSkipped !== 0
                ? 'unknown'
                : driving
                  ? 'working'
                  : issue === null
                    ? 'waiting'
                    : 'unresolved',
          })
        }
      } catch (error) {
        skipTheLedger(owner, error, note)
      }
    }
    const neededNames = new Set<string>()
    for (const row of rows) {
      if (row.disposition === 'ended' || row.disposition === 'unknown') continue
      neededNames.add(row.holder)
      if (row.giver !== null) neededNames.add(row.giver)
      if (row.stalledBy?.asker != null) neededNames.add(row.stalledBy.asker)
    }
    let names: ReadonlyMap<string, string> | undefined
    const nameOf = (conversation: string): string => {
      names ??= new Map(
        this.deps.store
          .reconciliationNames([...neededNames])
          .map((row) => [row.conversation, agentName(row.slug, [row])]),
      )
      return names.get(conversation) ?? AN_AGENT_THIS_APP_CANNOT_NAME
    }
    return {
      rows: rows.map((row) => ({ ...row, nameOf })),
      walk: 'every-conversation-that-holds-work' as const,
      ledgers: owners.size,
      rowsUnread: unread.count,
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  private reconciliationWaitProblem(
    work: WorkRow,
    on: WaitOn,
    by?: string | null,
    watched?: Set<string>,
    boundary?: { next: number },
  ): 'wait-target-ended' | 'wait-target-missing' | null {
    if (on.kind === 'time') {
      const now = this.now()
      if (on.at <= now) return 'wait-target-ended'
      if (boundary !== undefined) boundary.next = Math.min(boundary.next, on.at)
      return null
    }
    if (on.kind === 'agent' && 'piece' in on) {
      const target = this.deps.store.workById(on.piece)
      if (target === null) return 'wait-target-missing'
      watched?.add(target.owner)
      if (target.parent === null) return null
      const unread = rowsUnreadOnce()
      const piece = this.deps.store
        .piecesOwnedBy(target.owner, unread)
        .find((one) => one.piece === target.piece)
      if (unread.count !== 0 || unread.ledgersSkipped !== 0)
        throw new Error('a wait target could not be read')
      return piece === undefined
        ? 'wait-target-missing'
        : TASK_IS_OPEN[piece.state]
          ? null
          : 'wait-target-ended'
    }
    if (on.kind === 'person' || (on.kind === 'agent' && 'request' in on)) {
      const unread = rowsUnreadOnce()
      const ids = new Set([
        work.owner,
        ...(work.givenBy === null ? [] : [work.givenBy]),
        ...(by == null ? [] : [by]),
      ])
      const requests = [...ids]
        .flatMap((id) => this.theIdsItStandsFor(id))
        .flatMap((id) => this.deps.store.routedRequestsOf(id, unread))
      if (unread.count !== 0 || unread.ledgersSkipped !== 0)
        throw new Error('a wait request could not be read')
      const request = requests.find((one) => one.requestId === on.request)
      if (request === undefined) return 'wait-target-missing'
      for (const id of new Set([
        request.askedBy,
        ...(request.parent === null ? [] : [request.parent]),
      ]))
        for (const actual of this.theIdsItStandsFor(id)) watched?.add(actual)
      if ((on.kind === 'person') !== (request.went.to === 'a-person')) return 'wait-target-missing'
      return REQUEST_IS_OPEN[request.state] ? null : 'wait-target-ended'
    }
    if (on.kind === 'event') {
      const session = this.slots.get(work.owner)?.session ?? null
      if ('background' in on)
        return session?.background.running.some((one) => one.id === on.background)
          ? null
          : 'wait-target-missing'
      return (session?.scheduled ?? this.wakeUps.get(work.owner)?.level)?.jobs.some(
        (one) => one.id === on.job,
      )
        ? null
        : 'wait-target-missing'
    }
    return 'wait-target-missing'
  }

  private reconciliationMayWake(target: string): boolean {
    if (
      this.launches.closed ||
      this.keptStopped(target) ||
      workRunningElsewhere(this).has(target) ||
      (!this.servicesAreOn() && this.itIsAService(target))
    )
      return false
    if (this.deps.store.recordedOne(target) === null) return false
    return !this.reconciliationStoppedByPerson(target)
  }

  private reconciliationStoppedByPerson(target: string): boolean {
    const unread = rowsUnreadOnce()
    const stop = this.deps.store.lastAskToStop(target, unread)
    if (unread.count !== 0 || unread.ledgersSkipped !== 0)
      throw new Error('the last Stop could not be read')
    return (
      stop?.by === 'a-person' && (this.deps.store.whenAPersonLastWrote(target) ?? -1) <= stop.at
    )
  }

  private keepReconciliation(owner: string, event: WorkReconciliationEvent): boolean {
    try {
      const slot = this.slots.get(owner)
      if (slot !== undefined && slot.session === null) return false
      this.writeIntoItsLedger(owner, event)
      return this.deps.store
        .reconciliationReceipts(owner, event.piece)
        .some(
          (one) =>
            one.incident === event.incident &&
            one.step === event.step &&
            one.outcome === event.outcome,
        )
    } catch (error) {
      console.warn(`runtime host could not record a work reminder: ${errorMessage(error)}`)
      return false
    }
  }

  private reconciliationWords(piece: ReconciliationPiece, receipt: ReconciliationReceipt): string {
    const descriptions: Partial<Record<WorkIncident['kind'], string>> = {
      'wait-needs-classification': 'its wait names nothing that ends it',
      'wait-target-ended': 'what it waited on has ended',
      'wait-target-missing': 'what it waited on is no longer available',
      'notice-not-delivered': 'its notice could not be delivered',
      'recovery-failed': 'its recovery failed',
      'recovery-declined': 'its recovery was declined',
    }
    const cause =
      receipt.cause === undefined
        ? (descriptions[receipt.kind] ?? 'its work needs attention')
        : theStallAndItsAsk(
            receipt.cause,
            theAskNamed(
              piece.stalledBy ?? null,
              (id) => piece.nameOf?.(id) ?? AN_AGENT_THIS_APP_CANNOT_NAME,
              receipt.target ?? piece.holder,
            ),
          )
    if (receipt.step === 'giver')
      return `${piece.label} still needs attention: ${piece.nameOf?.(piece.holder) ?? AN_AGENT_THIS_APP_CANNOT_NAME} didn't settle it after a reminder (${cause}). Follow it up with them, or close it and give it again.`
    if (receipt.due === true)
      return `${piece.label}: the time it was waiting for has come. Carry on with it, or say what it waits on now with update_work (on).`
    if (receipt.cause === 'turn_ended')
      return `${piece.label} needs attention: ${cause}. If your last message already gave the finished result, hand it back now with reply_to_parent and don't repeat it. A question asked in chat is not tracked. Use ask_question for a question, request_action for an action the person must take, or update_work with on to record what it waits on. Otherwise carry on with it or finish it.`
    return `${piece.label} needs attention: ${cause}. If your last message already gave the finished result, hand it back now with reply_to_parent and don't repeat it. Carry on with it, finish it, or say what it waits on with update_work (on).`
  }

  private async deliverReconciliation(
    piece: ReconciliationPiece,
    receipt: ReconciliationReceipt,
  ): Promise<boolean> {
    if (
      receipt.step === 'holder' &&
      (receipt.kind === 'recovery-failed' || receipt.kind === 'recovery-declined')
    )
      return false
    if (
      receipt.step === 'holder' &&
      receipt.kind === 'notice-not-delivered' &&
      this.itIsAService(piece.holder)
    )
      return false
    const target = receipt.target
    if (
      target === undefined ||
      receipt.messageId === undefined ||
      !this.reconciliationMayWake(target)
    )
      return false
    const current = this.reconciliationReading(piece.piece).rows.find(
      (one) => one.piece === piece.piece,
    )
    if (current === undefined || ['waiting', 'ended', 'unknown'].includes(current.disposition))
      return false
    const kept = await new Promise<boolean>((resolve) =>
      this.holdUntilItStarts(
        target,
        this.reconciliationWords(piece, receipt),
        {
          appNotice: 'a-work-wait-needs-attention',
          aboutPiece: { piece: piece.piece, label: piece.label },
        },
        'notice',
        (where) => resolve(where !== 'nowhere'),
        receipt.messageId,
      ),
    )
    if (!kept) return false
    if (this.runsNow(target) && !this.startsInFlight.has(target)) return true
    const wake = this.restartWakes.then(async () => {
      const wait = this.lastPacedStart + AT_ONCE_START_GAPS * this.startGapMs - performance.now()
      if (wait > 0)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, wait)
          timer.unref?.()
        })
      if (!this.reconciliationMayWake(target)) return false
      if (!this.reconciliationNoticeStillGoes(target, receipt.messageId!, piece.piece)) return false
      this.wakingForStoppedWork.add(target)
      try {
        await this.ensureRunning(target, null)
        return true
      } finally {
        this.wakingForStoppedWork.delete(target)
        this.lastPacedStart = performance.now()
      }
    })
    this.restartWakes = wake.then(
      () => undefined,
      () => undefined,
    )
    let accepted = false
    try {
      accepted = await wake
    } catch {
      // A failed wake leaves the existing delivery check to decide this attempt.
    }
    if (!accepted) {
      const progress = this.deps.store.reconciliationDelivery(target, receipt.messageId)
      if (progress === 'running' || progress === 'turn-ended') return true
      this.retractReconciliationNotice(target, receipt.messageId)
    }
    return accepted
  }

  private retractReconciliationNotice(target: string, messageId: string): void {
    const session = this.slots.get(target)?.session ?? null
    const queued = session?.mailbox.find((one) => one.id === messageId)
    const detail = NOTICE_MEANS['a-work-wait-needs-attention']
    if (session !== null && queued !== undefined) {
      this.takeQueuedBack(session, queued, { reason: 'retracted', detail })
      return
    }
    const waiting = this.deps.store
      .messagesWaitingIn(target)
      .find((one) => one.messageId === messageId)
    if (waiting === undefined) return
    this.writeIntoItsLedger(target, {
      type: 'message_unqueued',
      messageId,
      reason: 'retracted',
      text: waiting.text,
      detail,
      ...waiting.authorship,
    })
    const left = (this.heldAtAStop.get(target) ?? []).filter((one) => one.id !== messageId)
    if (left.length === 0) this.heldAtAStop.delete(target)
    else this.heldAtAStop.set(target, left)
  }

  private reconciliationNoticeStillGoes(
    target: string,
    messageId: string,
    piece?: string,
  ): boolean {
    try {
      if (piece === undefined || !this.reconciliationMayWake(target)) return false
      const work = this.deps.store.workById(piece)
      if (work === null) return false
      const active = currentIncident(this.deps.store.reconciliationReceipts(work.owner, piece)).at(
        -1,
      )
      if (
        active === undefined ||
        active.target !== target ||
        active.messageId !== messageId ||
        (active.step !== 'holder' && active.step !== 'giver')
      )
        return false
      const current = this.reconciliationReading(piece).rows.find((one) => one.piece === piece)
      if (current?.issue?.waitKey !== undefined && current.issue.waitKey !== active.waitKey)
        return false
      return current !== undefined && !['waiting', 'ended', 'unknown'].includes(current.disposition)
    } catch {
      return false
    }
  }

  private dropObsoleteReconciliationNotices(session: HostedSession): void {
    for (const queued of [...session.mailbox]) {
      if (queued.authorship.appNotice !== 'a-work-wait-needs-attention') continue
      if (!this.reconciliationNoticeStillGoes(session.id, queued.id, queued.about))
        this.takeQueuedBack(session, queued, {
          reason: 'retracted',
          detail:
            this.whyItNoLongerGoes(session.id, queued)?.detail ??
            NOTICE_MEANS['a-work-wait-needs-attention'],
        })
    }
  }

  private reconcileWork(holders?: ReadonlySet<string>): void {
    if (this.launches.closed) return
    void this.workReconciler
      ?.run(holders)
      .catch((error) =>
        console.warn(`runtime host could not reconcile work: ${errorMessage(error)}`),
      )
  }

  private recoveryForPiece(
    work: WorkRow,
    driven: Map<string, readonly string[]>,
    logins: Map<string, WorkRecoveryEvent | null>,
  ): Pick<WorkIncident, 'kind' | 'since' | 'recovery'> | null {
    const piecesOn = (turn: string) => {
      const key = `${work.owner}:${turn}`
      let pieces = driven.get(key)
      if (pieces === undefined) {
        pieces = this.deps.store.reconciliationDrivenByTurn(work.owner, turn)
        driven.set(key, pieces)
      }
      return pieces
    }
    const cut = this.cutsAreReadable ? this.cutsKept.cuts[work.owner] : undefined
    if (
      cut !== undefined &&
      cut.state !== 'sent' &&
      this.deps.store.theNewestTurn(work.owner) === cut.turn &&
      piecesOn(cut.turn).includes(work.piece)
    ) {
      const failed =
        typeof cut.state === 'object' &&
        ['start-failed', 'start-uncertain', 'never-queued', 'handover-uncertain'].includes(
          cut.state.ended,
        )
      return {
        since: cut.cutAt,
        kind:
          typeof cut.state === 'string'
            ? 'recovery-pending'
            : failed
              ? 'recovery-failed'
              : 'recovery-declined',
        recovery: {
          because:
            cut.kind === 'limit'
              ? 'usage-limit'
              : cut.kind === 'program'
                ? 'program'
                : 'app-restart',
          resumesAt: cut.kind === 'limit' ? (cut.resetsAt ?? null) : null,
        },
      }
    }
    if (!logins.has(work.owner))
      logins.set(work.owner, this.deps.store.reconciliationRecovery(work.owner))
    const login = logins.get(work.owner) ?? null
    if (
      login === null ||
      login.phase === 'sent' ||
      !login.pieces.includes(work.piece) ||
      this.deps.store.theNewestTurn(work.owner) !== login.turn
    )
      return null
    const pending =
      this.aReopenIsBeingDecidedFor.has(work.owner) || this.reopeningForWhatWaited.has(work.owner)
    return {
      since: login.since,
      kind:
        login.phase === 'pending'
          ? pending
            ? 'recovery-pending'
            : 'recovery-failed'
          : login.phase === 'failed'
            ? 'recovery-failed'
            : 'recovery-declined',
      recovery: { because: 'sign-in', resumesAt: null },
    }
  }

  private reconciliationReceiptsFor(
    pieces: readonly ReconciliationPiece[],
  ): ReadonlyMap<string, readonly ReconciliationReceipt[]> {
    const rows = new Map<string, readonly ReconciliationReceipt[]>()
    for (const piece of pieces) {
      try {
        rows.set(piece.piece, this.deps.store.reconciliationReceipts(piece.holder, piece.piece))
      } catch {
        // An unread receipt supplies no authority to advance this piece.
      }
    }
    return rows
  }

  workIncidentsForAPerson(): LedgerWalk<WorkIncident> {
    return this.windowIncidentReads.run(() => this.readWorkIncidentsForAPerson())
  }

  async workIncidentsForWindow(): Promise<LedgerWalk<WorkIncident>> {
    return this.incidentsForWindow(
      () => this.readWorkIncidentsForAPerson(),
      () => this.workIncidentsForAPerson(),
    )
  }

  private async incidentsForWindow<T>(
    compose: () => T,
    onMain: () => T = () => this.windowIncidentReads.run(compose),
  ): Promise<T> {
    if (this.launches.closed) throw new WindowReadUnavailable()
    if (this.deps.windowReader === undefined) return onMain()
    if (
      this.windowReadCallers >= WINDOW_READ_BOUNDS.callers ||
      this.windowIncidentsPending !== undefined
    )
      throw new WindowReadUnavailable('busy')
    this.windowReadCallers++
    let missed: WindowReadMiss
    try {
      return await this.freshWindowQuery({ kind: 'incidents' }, (result) => {
        if (result.kind !== 'incidents') throw new WindowReadMissed('worker-gone')
        return this.windowIncidentReads.run(compose, result)
      })
    } catch (error) {
      if (!(error instanceof WindowReadMissed) || this.launches.closed) throw error
      if (error.missed === 'worker-busy') throw error
      missed = error.missed
    } finally {
      this.windowReadCallers--
    }
    const at = performance.now()
    if (
      this.lastIncidentMainReadAt !== undefined &&
      at - this.lastIncidentMainReadAt < INCIDENT_MAIN_READ_EVERY_MS
    )
      throw new WindowReadUnavailable()
    this.lastIncidentMainReadAt = at
    return this.answeredOnTheMainThread(missed, onMain)
  }

  async personsQueue(): Promise<PersonsQueueAnswer> {
    try {
      let incidents: StampedIncidents | null
      try {
        incidents = await this.incidentsForWindow(() => this.stampedIncidents())
      } catch (error) {
        if (this.launches.closed) throw error
        incidents = null
      }
      return await this.readForWindow(() => this.personsQueueAssembled(incidents))
    } catch (error) {
      return this.personsQueueRefused(errorMessage(error))
    }
  }

  async listConversations(): Promise<ListingAnswer> {
    try {
      return await this.readForWindow((): PublishedListing => {
        const { resumable, unresumable, complete } = this.theListing()
        const seq = this.publicationSeq
        return {
          resumable,
          unresumable,
          published: {
            epoch: this.publicationEpoch,
            seq,
            covers: complete
              ? { population: 'listing', complete: true }
              : {
                  population: 'listing',
                  complete: false,
                  ids: [...resumable, ...unresumable].map((row) => row.sessionId),
                },
          },
        }
      })
    } catch (error) {
      return this.listingRefused(errorMessage(error))
    }
  }

  listingRefused(because: string): ListingRefused {
    return {
      refused: because,
      published: { epoch: this.publicationEpoch, seq: this.publicationSeq },
    }
  }

  personsQueueRefused(because: string): PersonsQueueRefused {
    return {
      refused: because,
      published: { epoch: this.publicationEpoch, seq: this.publicationSeq },
    }
  }

  private stampedIncidents(): StampedIncidents {
    this.deps.store.checkCommitted()
    this.aTimeBoundaryPassed()
    const seq = this.publicationSeq
    const holders = new Set<string>()
    const boundary = { next: Number.POSITIVE_INFINITY }
    const walk = this.readWorkIncidentsForAPerson(holders, boundary)
    this.nextTimeBoundary = Math.min(this.nextTimeBoundary, boundary.next)
    return { walk, seq, validUntil: boundary.next, holders, live: this.incidentsLiveFacts(holders) }
  }

  private aTimeBoundaryPassed(): void {
    if (this.now() < this.nextTimeBoundary) return
    this.nextTimeBoundary = Number.POSITIVE_INFINITY
    this.moveThePersons()
  }

  private personsQueueAssembled(incidents: StampedIncidents | null): PersonsQueueAnswer {
    const part = <T>(read: () => T): T | null => {
      try {
        return read()
      } catch (error) {
        console.warn(
          `runtime host could not read part of the person's queue: ${errorMessage(error)}`,
        )
        return null
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      this.deps.store.checkCommitted()
      this.aTimeBoundaryPassed()
      const seq = this.publicationSeq
      const parts: Omit<PersonsQueue, 'published'> = {
        questions: part(() => this.questionsForAPerson()),
        decisions: part(() => this.decisionsForAPerson()),
        instructionAsks: part(() => this.instructionAsksCounted()),
        mcpServerRequests: part(() => ({
          rows: this.mcpServerRequestsForAPerson(),
          rowsUnread: this.mcpServerRequestsCounted().rowsUnread,
        })),
        stalled: part(() => this.stalledWorkForAPerson()),
        stopped: part(() => this.stoppedWorkForAPerson()),
        waitingOnWhoWrote: part(() => this.waitingOnWhoWroteForAPerson()),
        incidents:
          incidents !== null &&
          incidents.seq === seq &&
          this.now() < incidents.validUntil &&
          this.incidentsLiveFacts(incidents.holders) === incidents.live
            ? incidents.walk
            : null,
      }
      if (this.publicationSeq !== seq) continue
      return {
        ...parts,
        published: { epoch: this.publicationEpoch, seq, covers: personsCoverage(parts) },
      }
    }
    return this.personsQueueRefused('The queue changed while it was read.')
  }

  private incidentsLiveFacts(holders: ReadonlySet<string>): string {
    const elsewhere = workRunningElsewhere(this)
    return JSON.stringify(
      [...holders].sort().map((holder) => {
        const slot = this.slots.get(holder)
        const session = slot?.session ?? null
        return [
          holder,
          elsewhere.has(holder),
          this.aReopenIsBeingDecidedFor.has(holder),
          this.reopeningForWhatWaited.has(holder),
          this.startsInFlight.has(holder),
          this.arrivals.has(holder),
          this.heldAtAStop.get(holder)?.length ?? 0,
          slot === undefined
            ? null
            : session === null
              ? 'starting'
              : [
                  session.reopeningOnTheCurrentSignIn === true,
                  session.handle.status(),
                  session.mailbox.length,
                  session.background.running.map((one) => one.id),
                  session.scheduled?.jobs.map((one) => one.id) ?? null,
                ],
          this.wakeUps.get(holder)?.level?.jobs.map((one) => one.id) ?? null,
          this.cutsAreReadable ? (this.cutsKept.cuts[holder] ?? null) : 'unreadable',
          this.archived.has(holder),
        ]
      }),
    )
  }

  private readWorkIncidentsForAPerson(
    holders?: Set<string>,
    boundary?: { next: number },
  ): LedgerWalk<WorkIncident> {
    const reading = this.reconciliationReading(undefined, undefined, boundary)
    for (const piece of reading.rows) holders?.add(piece.holder)
    const rows: WorkIncident[] = []
    const receiptsUnread = new Set<string>()
    const receipts = this.reconciliationReceiptsFor(
      reading.rows.filter((one) => one.disposition !== 'unknown'),
    )
    for (const piece of reading.rows) {
      if (piece.disposition === 'ended' || piece.disposition === 'unknown' || piece.validWait)
        continue
      try {
        const recovering = piece.recoveryIncident ?? null
        if (piece.disposition === 'working' && recovering === null) continue
        if (piece.disposition === 'waiting') continue
        const own = receipts.get(piece.piece)
        if (own === undefined) {
          receiptsUnread.add(piece.holder)
          continue
        }
        const episode = currentIncident(own)
        const last = episode.at(-1)
        if (last?.step !== 'person') continue
        if (piece.issue?.waitKey !== undefined && last.waitKey !== piece.issue.waitKey) continue
        const told: { holder?: number; giver?: number } = {}
        for (const receipt of episode) {
          if (receipt.outcome !== 'delivered') continue
          if (receipt.step === 'holder' || receipt.step === 'giver') told[receipt.step] = receipt.at
        }
        rows.push({
          piece: piece.piece,
          label: piece.label,
          title: piece.title,
          holder: piece.holder,
          holderName: this.whatToCallTheConversation(piece.holder),
          giver: piece.giver,
          giverName: piece.giver === null ? null : this.whatToCallTheConversation(piece.giver),
          kind:
            recovering?.kind ??
            (last.kind === 'stopped'
              ? 'stopped'
              : episode.some((one) => one.outcome === 'failed')
                ? 'notice-not-delivered'
                : last.kind),
          ...(recovering?.recovery === undefined ? {} : { recovery: recovering.recovery }),
          since: last.since,
          ...(last.cause === undefined ? {} : { cause: last.cause }),
          ...(Object.keys(told).length === 0 ? {} : { told }),
        })
      } catch {
        receiptsUnread.add(piece.holder)
      }
    }
    return this.shown(
      {
        ...reading,
        rowsUnread: reading.rowsUnread + receiptsUnread.size,
        rows: rows.sort((a, b) => a.since - b.since || a.piece.localeCompare(b.piece)),
      },
      (one) => one.holder,
    )
  }

  waitingOnWhoWroteForAPerson(): LedgerWalk<WaitingOnWhoWrote> {
    return this.forAPerson('waitingOnWhoWroteForAPerson', () =>
      this.waitingOnWhoWroteForAPersonComposed(),
    )
  }

  private waitingOnWhoWroteForAPersonComposed(): LedgerWalk<WaitingOnWhoWrote> {
    const holders = new Map<string, string>()
    const theHolder = (conversation: string): string => {
      const known = holders.get(conversation)
      if (known !== undefined) return known
      const word = this.whatToCallTheConversation(conversation)
      holders.set(conversation, word)
      return word
    }
    const unread = rowsUnreadOnce()
    const walked = this.shown(this.deps.store.piecesWaitingOnWhoWrote(unread), (row) => row.owner)
    return {
      walk: walked.walk,
      ledgers: walked.ledgers,
      rowsUnread: walked.rowsUnread,
      rows: walked.rows.map((waiting) => ({
        piece: waiting.piece,
        label: waiting.label,
        title: waiting.title,
        owner: waiting.owner,
        ownerName: theHolder(waiting.owner),
        answeredAt: waiting.answeredAPersonAt,
      })),
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  workGivenBy(sessionId: string): LedgerWalk<WorkGivenOut> {
    return this.workReads.workGivenBy(sessionId)
  }

  whoCalledWhom(sessionId: string): WhoCalledWhom {
    return this.workReads.whoCalledWhom(sessionId)
  }

  private lastReportedOf(conversations: Iterable<string>): Record<string, LastReported> {
    const reported: Record<string, LastReported> = {}
    for (const conversation of conversations) {
      const runsOn = this.deps.store.whatItRunsOn(conversation)
      if (runsOn === null) continue
      reported[conversation] = {
        ...(runsOn.reportedModel !== null
          ? { model: runsOn.reportedModel, modelFrom: 'its-provider' as const }
          : runsOn.model !== null
            ? { model: runsOn.model, modelFrom: 'its-setting' as const }
            : { model: null, modelFrom: null }),
        ...(runsOn.reportedEffort !== null
          ? { effort: runsOn.reportedEffort, effortFrom: 'its-provider' as const }
          : runsOn.reasoningEffort !== null
            ? { effort: runsOn.reasoningEffort, effortFrom: 'its-setting' as const }
            : { effort: null, effortFrom: null }),
        context: this.lastContextOf(conversation),
      }
    }
    return reported
  }

  async recordWhatTheOlderOnesRan(): Promise<{ recorded: number; noRecordLeft: number }> {
    let recorded = 0
    let noRecordLeft = 0
    await handBackTheMainProcess()
    for (const one of this.deps.store.recorded()) {
      if (this.launches.closed) break
      const readEarlierModel = providerDefinitions[one.provider].transcripts.readEarlierModel
      if (readEarlierModel === undefined || one.adoptedAt !== null) continue
      const runsOn = this.deps.store.whatItRunsOn(one.sessionId)
      if (runsOn === null || runsOn.reportedModel !== null || runsOn.model !== null) continue
      const row = this.deps.store.find(one.sessionId)
      if (row === null || this.slots.has(one.sessionId)) continue
      const model = ((): string | null => {
        try {
          const home = this.providerHomeFor(row)
          const found = this.deps.nativeTranscriptPath(one.provider, home, row.ref)
          return found !== null ? readEarlierModel(home, found) : null
        } catch {
          return null
        }
      })()
      if (model === null) noRecordLeft += 1
      else {
        this.deps.store.setReportedModel(one.sessionId, model, runsOn.reportedEffort)
        recorded += 1
      }
      await handBackTheMainProcess()
    }
    if (recorded > 0 && !this.launches.closed) this.theWorldMoved('conversations')
    return { recorded, noRecordLeft }
  }

  private lastContextOf(conversation: string): LastReported['context'] {
    const through = this.deps.store.nextOrdinal(conversation)
    const kept = this.contextAsLastRead.get(conversation)
    if (kept !== undefined && kept.through === through) return kept.context
    const floor = Math.max(0, through - CONTEXT_LOOKBACK_ROWS)
    const since =
      kept !== undefined && kept.through < through && kept.through >= floor ? kept : null
    const row =
      this.deps.store.newestOfType?.(
        conversation,
        'context_reading',
        Number.MAX_SAFE_INTEGER,
        since?.through ?? floor,
      ) ?? null
    const context =
      row?.event.type === 'context_reading'
        ? { reading: row.event.reading, at: row.at }
        : (since?.context ?? null)
    this.contextAsLastRead.set(conversation, { through, context })
    return context
  }

  private shown<Row>(walk: LedgerWalk<Row>, conversationOf: (row: Row) => string): LedgerWalk<Row> {
    return { ...walk, rows: walk.rows.filter((row) => !this.archived.has(conversationOf(row))) }
  }

  readWorkspace(): WorkspaceReading {
    return this.forAPerson(
      'readWorkspace',
      () => this.readWorkspaceComposed(),
      (reading) => reading.needsYou.counted === 'in-full',
    )
  }

  private readWorkspaceComposed(): WorkspaceReading {
    const needsAPerson: Readonly<
      Record<WhatNeedsAPerson, LedgerWalk<unknown> | readonly unknown[]>
    > = {
      'a-question': this.shown(this.deps.store.questionsAPersonMustAnswer(), (row) => row.askedBy),
      'a-decision': this.shown(this.deps.store.decisionsAwaitingAPerson(), (row) => row.askedBy),
      'an-instruction-ask': this.instructionAsksNow(),
      'a-server-request': this.mcpServerRequestsNow(),
      'a-reply': this.shown(this.deps.store.piecesWaitingOnWhoWrote(), (row) => row.owner),
    }
    return {
      needsYou: countedTogether(Object.values(needsAPerson)),
      readAt: Date.now(),
    }
  }

  whatARestartWouldStop(): readonly WhatARestartWouldStopIn[] {
    const stopped: WhatARestartWouldStopIn[] = []
    const conversations = new Set([
      ...this.slots.keys(),
      ...this.startsInFlight.keys(),
      ...this.arrivals.keys(),
    ])
    for (const conversation of conversations) {
      const slot = this.slots.get(conversation)
      const session = slot?.session ?? null
      const status = session?.handle.status() ?? null
      const row: WhatARestartWouldStopIn = {
        conversation,
        name: this.whatToCallTheConversation(conversation),
        turnRunning:
          this.startsInFlight.has(conversation) ||
          this.arrivals.has(conversation) ||
          (slot !== undefined && session === null) ||
          status === 'working' ||
          (session !== null &&
            (session.turnOpened || session.flushing !== null || session.handingOver.length > 0)),
        waitingOnAPerson: status === 'waiting_permission',
        heldMessages: session?.mailbox.length ?? 0,
        inTheBackground: session?.background.running.length ?? 0,
      }
      if (
        row.turnRunning ||
        row.waitingOnAPerson ||
        row.heldMessages > 0 ||
        row.inTheBackground > 0
      ) {
        stopped.push(row)
      }
    }
    return stopped
  }

  whatIsBeingDone(): WhatIsBeingDone {
    const conversations = [...this.slots.entries()].flatMap(
      ([conversation, slot]): ConversationAtWork[] => {
        if (this.runningStateOf(conversation) === 'not-running') return []
        const session = slot.session
        if (session === null) return []
        return [
          {
            conversation,
            identity: session.profileId,
            ...session.beingDone.current,
            context: session.latestContext,
          },
        ]
      },
    )
    return { conversations, readAt: Date.now() }
  }

  whatEachConversationIsWaitingOn(): WhatEachConversationIsWaitingOn {
    return this.atTheListing('whatEachConversationIsWaitingOn', () =>
      this.whatEachConversationIsWaitingOnComposed(),
    )
  }

  private whatEachConversationIsWaitingOnComposed(): WhatEachConversationIsWaitingOn {
    const unread = rowsUnreadOnce()
    const ledger = this.oneLedgerReadPerAnswer(unread)
    const workOut = this.oneWorkOutReadPerAnswer(unread)
    const waiting = this.oneWaitReadPerAnswer(unread, ledger, workOut)
    const reads = this.cardReads()
    const conversations = [...this.slots.entries()].flatMap(
      ([conversation, slot]): ConversationWaiting[] => {
        if (this.runningStateOf(conversation) === 'not-running') return []
        const session = slot.session
        if (session === null) return []
        const unreadable: ConversationWaiting = {
          conversation,
          identity: session.profileId,
          waiting: null,
          work: null,
          needsYou: false,
          waitingOnTheAnswerOf: null,
          waitingOnTheWorkOf: [],
        }
        return readOrSkip(conversation, unread.in(conversation), [unreadable], () => [
          {
            conversation,
            ...this.whatItIsOwed(
              conversation,
              reads,
              unread,
              ledger(conversation),
              workOut,
              waiting,
            ),
            identity: session.profileId,
            waiting: theWaitAConversationIsIn(waiting(conversation)),
            work: whereTheWorkItHoldsStands(
              composeWhatEachPieceIsWaitingOn(
                this.deps.store.piecesOwnedBy(conversation, unread),
                waiting,
              ),
              this.deps.store.rootOf(conversation) !== null,
            ),
          },
        ])
      },
    )
    return {
      conversations,
      readAt: Date.now(),
      rowsUnread: unread.count + reads.asksUnread,
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  theWholeForest(): TheWholeForest {
    return this.atTheListing(
      'theWholeForest',
      () => this.theWholeForestComposed(),
      (forest) => everyRowWasRead(forest.nodes),
    )
  }

  private theWholeForestComposed(): TheWholeForest {
    const archived = [...this.archived.ids()]
    const walked = this.deps.store.everyPlacedConversation(MAX_FOREST_CONVERSATIONS, archived)
    const drawn = new Set(
      walked.rows.flatMap((row) => (row.node === 'a-conversation' ? [row.conversation] : [])),
    )
    const named = (conversation: string): NamedConversation =>
      drawn.has(conversation)
        ? { is: 'a-conversation', conversation }
        : { is: 'a-conversation-this-reading-did-not-draw', conversation }
    const theEndOf = (conversation: string): string | null => {
      const now = this.theOneInItsPlace(conversation)
      return now === conversation || this.replacedBy.has(now) ? null : now
    }
    const standsInFor = new Map<string, NamedConversation[]>()
    for (const old of this.replacedBy.keys()) {
      const now = theEndOf(old)
      if (now !== null) standsInFor.set(now, [...(standsInFor.get(now) ?? []), named(old)])
    }
    const inItsPlace = (conversation: string): NamedConversation | null => {
      const now = theEndOf(conversation)
      return now === null ? null : named(now)
    }
    return {
      nodes: {
        walk: walked.walk,
        ledgers: walked.ledgers,
        rowsUnread: walked.rowsUnread,
        ...ledgersSkippedOf(walked.ledgersSkipped),
        rows: walked.rows.map((row) =>
          row.node === 'a-task'
            ? row
            : {
                ...row,
                running: this.runningStateOf(row.conversation),
                standsInFor: standsInFor.get(row.conversation) ?? [],
                inItsPlace: inItsPlace(row.conversation),
              },
        ),
      },
      conversations: this.deps.store.placedConversations(archived),
      heldByNoAgent: this.deps.store.conversationsHeldByNoAgent(),
      readAt: Date.now(),
    }
  }

  private spawnEdge(conversation: string): SpawnEdge {
    const binding = this.deps.store.conversationBinding(conversation)
    return {
      conversation,
      identity: binding?.identity ?? null,
      provider: binding?.provider ?? null,
      running: this.runningStateOf(conversation),
    }
  }

  private processMemoryRead: Promise<ProcessMemory> | null = null

  processMemory(): Promise<ProcessMemory> {
    return (this.processMemoryRead ??= this.measureProcessMemory().finally(() => {
      this.processMemoryRead = null
    }))
  }

  whoseAgentsAre(pids: readonly number[]): ReadonlyMap<number, string> {
    const wanted = new Set(pids)
    const named = new Map<number, string>()
    for (const [conversation, slot] of this.slots) {
      const pid = slot.session?.handle.providerPid
      if (pid === undefined || !wanted.has(pid)) continue
      try {
        named.set(pid, this.nameByItsWork(conversation))
      } catch (error) {
        console.warn(`runtime host could not name ${conversation}: ${errorMessage(error)}`)
      }
    }
    return named
  }

  private async measureProcessMemory(): Promise<ProcessMemory> {
    const whose = new Map<number, string>()
    for (const [conversation, slot] of this.slots) {
      if (this.runningStateOf(conversation) === 'not-running') continue
      const pid = slot.session?.handle.providerPid
      if (pid !== undefined) whose.set(pid, conversation)
    }
    const read = this.deps.readProcessMemory
    if (read === undefined || whose.size === 0) return { conversations: [] }
    let bytesOf: ReadonlyMap<number, number>
    try {
      bytesOf = await read([...whose.keys()])
    } catch (error) {
      console.warn(`runtime host could not read its conversations' memory: ${errorMessage(error)}`)
      return { conversations: [], unmeasured: errorMessage(error) }
    }
    return {
      conversations: [...whose].flatMap(([pid, conversation]) => {
        const bytes = bytesOf.get(pid)
        return bytes === undefined ? [] : [{ conversation, bytes }]
      }),
    }
  }

  providerProcessesInFlight(): boolean {
    return (
      this.slots.size > 0 ||
      this.startsInFlight.size > 0 ||
      this.launches.size > 0 ||
      this.aReopenIsBeingDecidedFor.size > 0
    )
  }

  async recentActivity(input: { from: number; to: number }): Promise<RecentActivityReading> {
    const reader = this.deps.windowReader
    if (reader === undefined || this.launches.closed) throw new WindowReadUnavailable()
    const query = windowReadQuery.parse({ kind: 'activity', ...input })
    const result = await reader.read(query)
    if (result.kind !== 'activity' || this.launches.closed) throw new WindowReadUnavailable()
    const answer = {
      window: result.window,
      read: result.read,
      lines: result.lines,
      capped: result.capped,
    }
    const [cleared, imports] = await Promise.allSettled([
      this.deps.transcriptsCleared?.(input.from, input.to) ?? Promise.resolve([]),
      this.deps.skillImports?.(input.from, input.to) ?? Promise.resolve([]),
    ])
    if (this.launches.closed) throw new WindowReadUnavailable()
    return {
      ...answer,
      ...(cleared.status === 'fulfilled' && cleared.value.length
        ? { transcriptsCleared: cleared.value }
        : {}),
      ...(imports.status === 'fulfilled' && imports.value.length
        ? { skillImports: imports.value }
        : {}),
      read: {
        ...answer.read,
        rowsUnread:
          answer.read.rowsUnread +
          Number(cleared.status === 'rejected') +
          Number(imports.status === 'rejected'),
      },
    }
  }

  digest(from: number, to: number): DigestReading {
    if (!(to > from) || to - from > MAX_DIGEST_SPAN_MS) {
      throw new Error(
        `a digest window must end after it starts and span at most ` +
          `${String(MAX_DIGEST_SPAN_MS)} ms: ${String(from)}..${String(to)}`,
      )
    }
    const identities = this.deps.store.agentIdentities()
    const name = this.oneNamingPerAnswer(() => identities)
    const started = performance.now()
    const { read, distilled } = distilSkipping(this.deps.store.digestWindow(from, to), name)
    return {
      window: { from, to },
      limit: { says: WINDOW_WAS_CHOSEN },
      digest: {
        sessions: new Set(read.rows.map((row) => row.sessionId)).size,
        read: {
          walk: read.walk,
          ledgers: read.ledgers,
          rowsUnread: read.rowsUnread,
          ...ledgersSkippedOf(read.ledgersSkipped),
        },
        lines: distilled.lines,
        gaps: distilled.gaps,
        fanOut: distilled.fanOut,
      },
      heldByNoAgent: this.deps.store.conversationsHeldByNoAgent(),
      cost: { totalMs: +(performance.now() - started).toFixed(2) },
    }
  }

  private onePieceReadPerAnswer(): (id: string) => readonly PieceRow[] {
    const held = new Map<string, readonly PieceRow[]>()
    return (id: string): readonly PieceRow[] => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const rows = this.deps.store.piecesOwnedBy(id)
      held.set(id, rows)
      return rows
    }
  }

  private oneQuestionReadPerAnswer(
    unread?: RowsUnread,
  ): (id: string) => ReadonlyMap<string, RaisedQuestion> {
    const held = new Map<string, ReadonlyMap<string, RaisedQuestion>>()
    return (id: string): ReadonlyMap<string, RaisedQuestion> => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const raised = this.deps.store.questionsRaisedIn(id, unread)
      held.set(id, raised)
      return raised
    }
  }

  private oneWaitReadPerAnswer(
    unread?: RowsUnread,
    ledger: (id: string) => ItsLedger = this.oneLedgerReadPerAnswer(unread),
    workOut: WorkOutOf = this.oneWorkOutReadPerAnswer(unread),
  ): (id: string) => WhatAConversationIsWaitingOn {
    const held = new Map<string, WhatAConversationIsWaitingOn>()
    const read = (id: string): WhatAConversationIsWaitingOn => {
      const { routings, raised } = ledger(id)
      const outstanding: WhatAConversationIsWaitingOn = {
        answers: new Set(openQuestionsByWork(routings, raised).keys()),
        aPerson: aPersonOwesAnAnswerIn(routings),
        childrenOpen: new Set(workOut(id).map((one) => one.parent)),
      }
      return outstanding
    }
    return (id: string): WhatAConversationIsWaitingOn => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const outstanding = readOrSkip(id, unread?.in(id), NOTHING_IT_WAITS_ON, () => read(id))
      held.set(id, outstanding)
      return outstanding
    }
  }

  private oneLedgerReadPerAnswer(unread?: RowsUnread): (id: string) => ItsLedger {
    const held = new Map<string, ItsLedger>()
    return (id: string): ItsLedger => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const read: ItsLedger = {
        routings: this.deps.store.routedRequestsOf(id, unread),
        raised: this.deps.store.questionsRaisedIn(id, unread),
      }
      held.set(id, read)
      return read
    }
  }

  private askersWhoRoutedTo(parent: string): ReadonlySet<string> {
    if (this.routedTo === null) {
      const seeded = new Map<string, Set<string>>()
      for (const { asker, parent: to } of this.deps.store.whoRoutedToWhom()) {
        let askers = seeded.get(to)
        if (askers === undefined) seeded.set(to, (askers = new Set()))
        askers.add(asker)
      }
      this.routedTo = seeded
    }
    return this.routedTo.get(parent) ?? new Set()
  }

  private oneOwedReadPerAnswer(ledgerOf: (id: string) => ItsLedger): OwedBy {
    const held = new Map<string, readonly OwedQuestion[]>()
    return (id) => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const ids = this.theIdsItStandsFor(id)
      const askers = new Set(ids.flatMap((one) => [...this.askersWhoRoutedTo(one)]))
      const latest = new Map<string, OwedQuestion>()
      for (const asker of askers) {
        const { routings, raised } = ledgerOf(asker)
        const slot = this.slots.get(asker)
        const parked =
          slot !== undefined &&
          !onItsWayOut(slot) &&
          slot.session?.handle.status() === 'waiting_permission'
        for (const one of routings) {
          if (one.parent === null || !ids.includes(one.parent)) continue
          if (raised.get(one.requestId)?.raisedBy !== 'this-app' && !parked) continue
          const asked = questionKey(one.askedBy, one.requestId)
          latest.delete(asked)
          latest.set(asked, { ...one, piece: raised.get(one.requestId)?.piece ?? null })
        }
      }
      const read = [...latest.values()]
        .filter(
          (one) =>
            REQUEST_IS_OPEN[one.state] &&
            one.escalatedAt === null &&
            (one.went.is === 'the-parent' || one.went.is === 'the-agent-the-asker-named'),
        )
        .sort((left, right) => left.at - right.at)
      held.set(id, read)
      return read
    }
  }

  private ledgerAsKept(read: (id: string) => ItsLedger): (id: string) => ItsLedger {
    return (id) => (this.slots.has(id) ? this.waitAsLastRead.get(id) : undefined) ?? read(id)
  }

  private oneWorkOutReadPerAnswer(unread?: RowsUnread): WorkOutOf {
    const held = new Map<string, readonly PieceRow[]>()
    return (id) => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const read = this.theIdsItStandsFor(id)
        .flatMap((one) => this.deps.store.piecesGivenBy(one, unread))
        .filter((one) => TASK_IS_OPEN[one.state])
        .sort((left, right) => left.givenAt - right.givenAt)
      held.set(id, read)
      return read
    }
  }

  private oneWorkReadPerAnswer(
    pieces: (id: string) => readonly PieceRow[] = this.onePieceReadPerAnswer(),
  ): (id: string) => readonly WorkInHand[] {
    const held = new Map<string, readonly WorkInHand[]>()
    return (id: string): readonly WorkInHand[] => {
      const mine = held.get(id)
      if (mine !== undefined) return mine
      const root = this.deps.store.rootOf(id)
      const open = [...(root === null ? [] : [{ label: root.label }]), ...openWorkOf(pieces(id))]
      held.set(id, open)
      return open
    }
  }

  private oneNamingPerAnswer(
    identities: () => readonly AgentIdentity[] = this.oneRosterPerAnswer(),
  ): (id: string) => string {
    const named = new Map<string, string>()
    return (id: string): string => {
      const held = named.get(id)
      if (held !== undefined) return held
      const word = this.nameForAPerson(id, identities)
      named.set(id, word)
      return word
    }
  }

  private oneRosterPerAnswer(): () => readonly AgentIdentity[] {
    let roster: readonly AgentIdentity[] | null = null
    return () => (roster ??= this.deps.store.agentIdentities())
  }

  private nameForAPerson(sessionId: string, identities: () => readonly AgentIdentity[]): string {
    const profile = this.profileOf(sessionId)
    if (profile === null) return this.folderOf(sessionId)
    return agentName(profile, identities())
  }

  private folderOf(sessionId: string): string {
    const cwd = this.deps.store.recordedOne(sessionId)?.cwd ?? ''
    const base = pathTail(cwd)
    return base === '' ? sessionId : base
  }

  whatToCallTheConversation(conversation: string): string {
    return nameTheConversation(
      whoseConversationIs(this.profileOf(conversation), this.deps.store.agentIdentities()),
    )
  }

  nameByItsWork(conversation: string): string {
    if (this.itIsAService(conversation)) {
      return `${this.whatToCallTheConversation(conversation)} (a service)`
    }
    return theConversationCalled(
      this.whatToCallTheConversation(conversation),
      this.deps.store.workThatNames(conversation),
    )
  }

  addressOf(conversation: string): string {
    return anAddressOf(this.workThatNames(conversation), conversation)
  }

  nameByItsWorkUnder(conversation: string, piece: string | null): string {
    return this.calledUnder(conversation, piece).called
  }

  addressOfUnder(conversation: string, piece: string | null): string {
    return this.calledUnder(conversation, piece).address
  }

  private calledUnder(
    conversation: string,
    piece: string | null,
    agent: string = this.whatToCallTheConversation(conversation),
  ): { readonly called: string; readonly address: string } {
    if (this.itIsAService(conversation)) {
      return { called: `${agent} (a service)`, address: conversation }
    }
    const named = theWorkAlone(this.theWorkThatNamesUnder(conversation, piece))
    return {
      called: theConversationCalled(agent, named),
      address: anAddressOf(named, conversation),
    }
  }

  private theWorkThatNamesUnder(
    conversation: string,
    piece: string | null,
  ): WorkThatNamesIt | null {
    if (piece !== null && this.itIsAService(conversation)) return null
    return piece === null
      ? this.workThatNames(conversation)
      : this.deps.store.workThatNamesUnder(conversation, piece)
  }

  questionsVisibleTo(sessionId: string, unread?: RowsUnread): readonly RoutedRequest[] {
    return this.questionsRoutedToWhatItStandsFor(sessionId, unread)
  }

  private questionsRoutedToWhatItStandsFor(
    sessionId: string,
    unread?: RowsUnread,
  ): readonly RoutedRequest[] {
    const ids = this.theIdsItStandsFor(sessionId)
    if (ids.length === 1) return this.deps.store.questionsRoutedTo(sessionId, unread)
    return ids
      .flatMap((id) => this.deps.store.questionsRoutedTo(id, unread))
      .sort((left, right) => left.at - right.at)
  }

  questionsWaitingOn(sessionId: string, unread?: RowsUnread): readonly VisibleQuestion[] {
    const latest = new Map<string, RoutedRequest>()
    for (const one of this.questionsVisibleTo(sessionId, unread)) {
      const key = questionKey(one.askedBy, one.requestId)
      latest.delete(key)
      latest.set(key, one)
    }
    const rows = [...latest.values()]
    const raised = this.oneQuestionReadPerAnswer(unread)
    const askers = new Map<string, { readonly called: string; readonly address: string }>()
    const askerOf = (
      conversation: string,
      piece: string | null,
    ): { readonly called: string; readonly address: string } => {
      const key = `${conversation}\u0000${piece ?? ''}`
      const held = askers.get(key)
      if (held !== undefined) return held
      const asker = this.calledUnder(conversation, piece)
      askers.set(key, asker)
      return asker
    }
    return rows.map((request) => {
      if (request.went.is === 'the-person-the-channel-left-it-with') {
        return { request, words: null, askerCalled: askerOf(request.askedBy, null).called }
      }
      const read = readOrSkip(request.askedBy, unread?.in(request.askedBy), null, () => {
        const asked = raised(request.askedBy).get(request.requestId)
        if (asked === undefined) return null
        const asker = askerOf(request.askedBy, asked.piece)
        return {
          request,
          words: questionText(asker, { ...asked, id: request.requestId }),
          askerCalled: asker.called,
        }
      })
      return read ?? { request, words: null, askerCalled: askerOf(request.askedBy, null).called }
    })
  }

  questionsListedFor(sessionId: string): {
    readonly questions: readonly VisibleQuestion[]
    readonly rowsUnread: number
    readonly ledgersSkipped?: number
  } {
    const unread = rowsUnreadOnce()
    const questions = this.questionsWaitingOn(sessionId, unread)
    return { questions, rowsUnread: unread.count, ...ledgersSkippedOf(unread.ledgersSkipped) }
  }

  private theQuestionNamed(
    speaking: string,
    questionId: string,
    askedBy: string | null,
  ):
    | { readonly is: 'found'; readonly request: RoutedRequest | undefined }
    | { readonly is: 'refused'; readonly refusal: QuestionRefusal } {
    const underTheId = this.questionsRoutedToWhatItStandsFor(speaking).filter(
      (one) => one.requestId === questionId,
    )
    const askers = [...new Set(underTheId.map((one) => one.askedBy))]
    if (askedBy !== null) {
      const theirs = underTheId.filter((one) => one.askedBy === askedBy)
      if (theirs.length > 0 || askers.length === 0) {
        return { is: 'found', request: theirs[theirs.length - 1] }
      }
      return {
        is: 'refused',
        refusal: refuseQuestion('that-conversation-did-not-ask-that', {
          question: questionId,
          askers,
        }),
      }
    }
    if (askers.length > 1 && !this.oneKindOfPersonsRequest(underTheId, askers)) {
      return {
        is: 'refused',
        refusal: refuseQuestion('more-than-one-question-has-that-id', {
          question: questionId,
          askers,
        }),
      }
    }
    return { is: 'found', request: underTheId[underTheId.length - 1] }
  }

  private oneKindOfPersonsRequest(
    underTheId: readonly RoutedRequest[],
    askers: readonly string[],
  ): boolean {
    const kinds = new Set(
      askers.map((asker) => {
        const theirs = underTheId.filter((one) => one.askedBy === asker)
        const last = theirs[theirs.length - 1]
        return last?.went.is === 'the-person-the-channel-left-it-with'
          ? theChannelRefusalIn(last)
          : null
      }),
    )
    return kinds.size === 1 && !kinds.has(null)
  }

  async answerQuestion(
    input: {
      questionId: string
      answers: readonly { part: string; answer: readonly string[] }[]
      askedBy?: string | null
      cannot?: string | null
      interrupt?: boolean
    },
    by: Caller,
  ): Promise<AnswerWithItsStop> {
    const speaking = sessionSpeakingAs(by)
    const stopAs = input.interrupt === true ? by : null
    if (speaking === null) {
      return {
        ok: false,
        refusal: refuseQuestion('no-question-by-that-name', { question: input.questionId }),
      }
    }
    const named = this.theQuestionNamed(speaking, input.questionId, input.askedBy ?? null)
    if (named.is === 'refused') return { ok: false, refusal: named.refusal }
    const request = named.request
    const answeredAlready =
      request === undefined
        ? undefined
        : this.answeredInThisRun.get(aQuestionKey(request.askedBy, request.requestId))
    if (request !== undefined && answeredAlready !== undefined) {
      return {
        ok: false,
        refusal: refuseQuestion('question-has-already-ended', {
          question: request.requestId,
          state: answeredAlready,
        }),
      }
    }
    const refusal = admitAnswer(request)
    if (refusal !== null) return { ok: false, refusal }
    if (request === undefined) throw new Error('an answer was admitted against no request (394)')
    const words = this.theWordsOf(request.askedBy, request.requestId)
    const session = this.slots.get(request.askedBy)?.session ?? null
    if (words === undefined && session === null) {
      return {
        ok: false,
        refusal: refuseQuestion('the-conversation-that-asked-has-gone', {
          question: request.requestId,
        }),
      }
    }
    const cannot = input.cannot ?? null
    if (cannot !== null && cannot.length > REPLY_SUMMARY_LIMIT) {
      return {
        ok: false,
        refusal: refuseQuestion('answer-too-long', {
          question: request.requestId,
          argument: 'cannot_answer',
          limit: REPLY_SUMMARY_LIMIT,
          was: cannot.length,
        }),
      }
    }
    if (cannot !== null) {
      if (words === undefined) {
        if (session === null)
          throw new Error('a provider request was declined with nothing running')
        try {
          await session.handle.respondUserInput(request.requestId, {
            kind: 'reject',
            reason: cannot,
          })
        } catch (error) {
          const said = error instanceof Error ? error.message : String(error)
          const refused = answerRefusalOf(error)
          if (refused === null) throw error
          return {
            ok: false,
            refusal:
              refused === 'not-pending'
                ? refuseQuestion('question-has-already-ended', {
                    question: request.requestId,
                    said,
                  })
                : refuseQuestion('that-answer-cannot-be-sent', {
                    question: request.requestId,
                    said,
                  }),
          }
        }
      }
      if (words === undefined) {
        this.writeIntoItsLedger(request.askedBy, {
          type: 'user_decision',
          requestId: request.requestId,
          outcome: 'rejected',
          by: whoDidIt(by),
        })
      } else {
        this.decideAQuestionThisAppAsked(request.askedBy, request.requestId, 'rejected', by)
      }
      const told =
        words === undefined
          ? Promise.resolve({ kept: null, stop: null, held: false })
          : this.deliverAnswer(words, request.requestId, speaking, null, cannot, null, stopAs)
      this.theWorldMoved('work')
      const { kept, stop, held } = await told
      return {
        ok: true,
        question: request.requestId,
        asked: request.askedBy,
        piece: words?.piece ?? null,
        notAsked: [],
        ...(kept === null ? {} : { kept }),
        ...(stop === null ? {} : { stop }),
        ...(held ? { held } : {}),
      }
    }
    if (words !== undefined) {
      const given = new Set(input.answers.map((one) => one.part))
      const missing = words.parts.filter((part) => !given.has(part))
      if (missing.length > 0) {
        return {
          ok: false,
          refusal: refuseQuestion('that-answer-cannot-be-sent', {
            question: request.requestId,
            said: `no answer was given for ${missing.join(', ')}`,
          }),
        }
      }
    }
    const measured = oneAgentsAnswer(
      input.answers,
      () => this.deps.store.questionsRaisedIn(request.askedBy).get(request.requestId)?.questions,
    )
    if (measured.units > REPLY_SUMMARY_LIMIT) {
      return {
        ok: false,
        refusal: refuseQuestion('answer-too-long', {
          question: request.requestId,
          argument: 'answers',
          limit: REPLY_SUMMARY_LIMIT,
          was: measured.units,
        }),
      }
    }
    const answers: Record<string, string[]> = Object.create(null)
    for (const one of measured.answers) answers[one.part] = [...one.answer]
    const held = words
    if (held !== undefined) {
      this.decideAQuestionThisAppAsked(request.askedBy, request.requestId, 'answered', by)
      const said = measured.answers.map((one) => ({ part: one.part, answer: [...one.answer] }))
      const told = this.deliverAnswer(held, request.requestId, speaking, said, null, null, stopAs)
      this.theWorldMoved('work')
      const { kept, stop, held: behindItsTurn } = await told
      return {
        ok: true,
        question: request.requestId,
        asked: request.askedBy,
        piece: held.piece,
        notAsked: measured.notAsked,
        ...(kept === null ? {} : { kept }),
        ...(stop === null ? {} : { stop }),
        ...(behindItsTurn ? { held: behindItsTurn } : {}),
      }
    }
    if (session === null) throw new Error('a provider request was answered with nothing running')
    try {
      await session.handle.respondUserInput(request.requestId, { kind: 'answer', answers })
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      const refused = answerRefusalOf(error)
      if (refused === null) throw error
      return {
        ok: false,
        refusal:
          refused === 'not-pending'
            ? refuseQuestion('question-has-already-ended', { question: request.requestId, said })
            : refuseQuestion('that-answer-cannot-be-sent', { question: request.requestId, said }),
      }
    }
    this.publishOurs(session, {
      type: 'user_decision',
      requestId: request.requestId,
      outcome: 'answered',
      by: whoDidIt(by),
    })
    this.theWorldMoved('work')
    return {
      ok: true,
      question: request.requestId,
      asked: request.askedBy,
      piece: null,
      notAsked: measured.notAsked,
    }
  }

  readResource(
    resourceId: string,
  ):
    | { ok: true; resource: ResourceRow; form: DocumentForm; content: DocumentContent }
    | { ok: false; refusal: ResourceRefusal } {
    return this.keptFiles.readResource(resourceId)
  }

  readResourceForAPerson(resourceId: string): ResourceReading {
    return this.keptFiles.readResourceForAPerson(resourceId)
  }

  drawResourceForAPerson(resourceId: string): ResourceDrawing {
    return this.keptFiles.drawResourceForAPerson(resourceId)
  }

  revealResource(resourceId: string): ResourceReveal {
    return this.keptFiles.revealResource(resourceId)
  }

  filesKept(asked: FilesKeptScope): FilesKept {
    return this.keptFiles.filesKept(asked)
  }

  filesKeptForWindow(conversation: string): Promise<FilesKept> {
    return this.keptFiles.filesKeptForWindow(conversation)
  }

  filesLibraryForWindow(
    request: FilesLibraryRequest,
    sink: RuntimeEventSink,
  ): Promise<FilesLibraryResult> {
    try {
      return filesLibraryForWindow(request, sink, {
        libraries: this.deps.filesLibraries,
        revision: () => this.deps.filesLibraryRevision?.(),
        closed: () => this.launches.closed,
        givers: (conversation) => this.theIdsItStandsFor(conversation),
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  teamProfileGraphForWindow(
    request: TeamProfileGraphRequest,
    sink: RuntimeEventSink,
  ): Promise<TeamProfileGraphResult> {
    try {
      return teamProfileGraphForWindow(request, sink, {
        graphs: this.deps.teamProfileGraphs,
        revision: () => this.deps.teamProfileGraphRevision?.(),
        closed: () => this.launches.closed,
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  async closeTeamProfileGraphWindow(owner: string): Promise<void> {
    await this.deps.teamProfileGraphs?.closeWindow(owner)
  }

  async closeFilesLibraryWindow(owner: string): Promise<void> {
    await this.deps.filesLibraries?.closeWindow(owner)
  }

  searchWork(asAgent: string, input: WorkSearchQuery): Promise<WorkSearchResult> {
    return this.workSearch.searchWork(asAgent, input)
  }

  searchPastWork(asAgent: string, words: string): Promise<PastWorkSearchResult> {
    return this.workSearch.searchPastWork(asAgent, words)
  }

  private settleTheNoticesFor(session: HostedSession): void {
    try {
      for (const piece of composeWhatEachPieceIsWaitingOn(
        this.deps.store.piecesOwnedBy(session.id),
        this.oneWaitReadPerAnswer(),
      )) {
        if (aStallItsGiverCanBeToldOf(piece)) this.tellIfNobodyHasYet(piece)
      }
    } catch (error) {
      console.warn(
        `runtime host could not settle the notices for ${session.id}: ${errorMessage(error)}`,
      )
    }
  }

  private cardReads(): CardReads {
    const asks = this.instructionAsksCounted()
    return {
      roster: this.deps.store.agentIdentities(),
      askingForRules: new Set(asks.rows.map((waiting) => waiting.conversation)),
      asksUnread: asks.rowsUnread,
    }
  }

  private stateOf(
    sessionId: string,
    reads: CardReads,
    unread: RowsUnread,
    ledger?: ItsLedger,
    workOut?: WorkOutOf,
    owedBy?: OwedBy,
  ): AgentState {
    const slot = this.slots.get(sessionId)
    const going = slot !== undefined && onItsWayOut(slot)
    const session = going ? null : (slot?.session ?? null)
    const status = session?.handle.status() ?? null
    const owed = this.whoOwesIt(sessionId, reads, unread, ledger, workOut, owedBy)
    if (owed.askedOf === null) this.waitsOnTheAnswerOf.delete(sessionId)
    else this.waitsOnTheAnswerOf.set(sessionId, owed.askedOf)
    if (owed.workIsWith.length === 0) this.waitsOnTheWorkOf.delete(sessionId)
    else this.waitsOnTheWorkOf.set(sessionId, owed.workIsWith)
    if (owed.owedTo.length === 0) this.owesTheAnswersOf.delete(sessionId)
    else this.owesTheAnswersOf.set(sessionId, owed.owedTo)
    return agentStateOf(
      {
        needsYou: owed.needsYou,
        active:
          this.startsInFlight.has(sessionId) ||
          this.arrivals.has(sessionId) ||
          (slot !== undefined && !going && (slot.session === null || status === 'working')),
        waitingOnTheAnswerOf: owed.waitingOnTheAnswerOf,
        waitingOnTheAnswerSince: owed.waitingOnTheAnswerSince,
        owesAnAnswerTo: owed.owesAnAnswerTo,
        owesAnAnswerSince: owed.owesAnAnswerSince,
        background: session?.background ?? NOTHING_IN_THE_BACKGROUND,
        scheduled:
          slot?.session?.scheduled ?? this.wakeUps.get(sessionId)?.level ?? NOTHING_SCHEDULED,
        waitingOnTheWorkOf: owed.waitingOnTheWorkOf,
        waitingOnTheWorkSince: owed.waitingOnTheWorkSince,
      },
      this.now(),
    )
  }

  private whoOwesIt(
    sessionId: string,
    reads: CardReads,
    unread: RowsUnread,
    { routings, raised }: ItsLedger = this.oneLedgerReadPerAnswer(unread)(sessionId),
    workOut: WorkOutOf = this.oneWorkOutReadPerAnswer(unread),
    owed: OwedBy = this.owedAsKept(
      this.oneOwedReadPerAnswer(this.ledgerAsKept(this.oneLedgerReadPerAnswer(rowsUnreadOnce()))),
    ),
    stopped: ReadonlySet<string> = NO_PIECE_STOPPED,
  ): WhoOwesIt {
    const slot = this.slots.get(sessionId)
    const going = slot !== undefined && onItsWayOut(slot)
    const status = going ? null : (slot?.session?.handle.status() ?? null)
    const standing = routings.filter(
      (one) =>
        REQUEST_IS_OPEN[one.state] &&
        (raised.get(one.requestId)?.raisedBy === 'this-app' || status === 'waiting_permission'),
    )
    const theirs = standing.find((one) => one.went.to !== 'a-person' && one.parent !== null)
    const askedOf =
      theirs?.parent === undefined || theirs.parent === null
        ? null
        : this.theOneInItsPlace(theirs.parent)
    const itStandsForItself = this.theOneInItsPlace(sessionId) === sessionId
    const gaveOut = itStandsForItself ? workOut(sessionId) : []
    const stillWith = gaveOut.filter((one) => !stopped.has(one.piece))
    const workIsWith = [...new Set(stillWith.map((one) => one.owner))]
    const owedNow = itStandsForItself ? owed(sessionId) : []
    const owedTo = [...new Set(owedNow.map((one) => one.askedBy))]
    const askedUnder = new Map<string, string | null>()
    for (const one of owedNow) {
      const asker = this.theOneInItsPlace(one.askedBy)
      if (!askedUnder.has(asker)) askedUnder.set(asker, one.piece)
    }
    const called = (conversation: string, named: WorkThatNamesIt | null): string =>
      theConversationCalled(
        reads.nameOf?.(conversation) ??
          nameTheConversation(whoseConversationIs(this.profileOf(conversation), reads.roster)),
        theWorkAlone(named),
      )
    return {
      needsYou:
        aPersonOwesAnAnswerIn(standing) ||
        reads.askingForRules.has(sessionId) ||
        (status === 'waiting_permission' && theirs === undefined) ||
        this.aPieceItHoldsWaitsOnWhoWrote(sessionId, unread, { routings, raised }, workOut),
      askedOf,
      waitingOnTheAnswerOf:
        askedOf === null || theirs === undefined
          ? null
          : called(
              askedOf,
              this.theWorkThatNamesUnder(askedOf, raised.get(theirs.requestId)?.piece ?? null),
            ),
      waitingOnTheAnswerSince: askedOf === null || theirs === undefined ? null : theirs.at,
      workIsWith,
      waitingOnTheWorkSince: earliest(stillWith.map((one) => one.givenAt)),
      waitingOnTheWorkOf: workIsWith.map((holder) =>
        called(
          holder,
          this.theWorkThatNamesUnder(
            holder,
            stillWith.find((one) => one.owner === holder)?.piece ?? null,
          ),
        ),
      ),
      owedTo,
      owesAnAnswerTo: [...askedUnder].map(([asker, piece]) =>
        called(asker, this.theWorkThatNamesUnder(asker, piece)),
      ),
      owesAnAnswerSince: earliest(owedNow.map((one) => one.at)),
    }
  }

  private aPieceItHoldsWaitsOnWhoWrote(
    sessionId: string,
    unread: RowsUnread,
    itsLedger: ItsLedger,
    workOut: WorkOutOf,
  ): boolean {
    const waits = this.deps.store.piecesWaitingOnWhoWroteIn(sessionId, unread)
    if (waits.length === 0) return false
    return composeWhatEachPieceIsWaitingOn(
      waits,
      this.oneWaitReadPerAnswer(unread, () => itsLedger, workOut),
    ).some((piece) => piece.state === 'waiting-on-the-person-who-wrote')
  }

  private whatItIsOwed(
    sessionId: string,
    reads: CardReads,
    unread: RowsUnread,
    ledger: ItsLedger,
    workOut: WorkOutOf,
    waiting: (id: string) => WhatAConversationIsWaitingOn,
  ): Pick<
    ConversationWaiting,
    | 'needsYou'
    | 'waitingOnTheAnswerOf'
    | 'waitingOnTheAnswerSince'
    | 'waitingOnTheWorkOf'
    | 'waitingOnTheWorkSince'
    | 'stoppedWork'
  > {
    const stopped =
      this.theOneInItsPlace(sessionId) === sessionId
        ? this.theWorkThatStopped(workOut(sessionId), waiting, unread)
        : []
    const owed = this.whoOwesIt(
      sessionId,
      reads,
      unread,
      ledger,
      workOut,
      () => [],
      new Set(stopped.map((one) => one.piece)),
    )
    return {
      needsYou: owed.needsYou,
      waitingOnTheAnswerOf: owed.waitingOnTheAnswerOf,
      waitingOnTheAnswerSince: owed.waitingOnTheAnswerSince,
      waitingOnTheWorkOf: owed.waitingOnTheWorkOf,
      waitingOnTheWorkSince: owed.waitingOnTheWorkSince,
      stoppedWork: stopped.map((one) => ({
        piece: one.piece,
        label: one.label,
        holder: nameTheConversation(whoseConversationIs(this.profileOf(one.owner), reads.roster)),
        holderConversation: one.owner,
        at: one.at,
      })),
    }
  }

  private theWorkThatStopped(
    given: readonly PieceRow[],
    waiting: (id: string) => WhatAConversationIsWaitingOn,
    answer?: RowsUnread,
  ): readonly (PieceRow & { readonly at: number })[] {
    const stalled = given.filter((piece) => piece.state === 'stalled')
    if (stalled.length === 0) return []
    return composeWhatEachPieceIsWaitingOn(stalled, waiting).flatMap((piece) =>
      piece.state === 'stalled' &&
      piece.stalledAt !== null &&
      this.itsHolderIsStopped(piece.owner, answer)
        ? [{ ...piece, at: piece.stalledAt }]
        : [],
    )
  }

  private itsHolderIsStopped(holder: string, answer?: RowsUnread): boolean {
    return this.theServiceOf(holder) === null && this.nothingIsOnItsWayTo(holder, answer)
  }

  private nothingIsOnItsWayTo(holder: string, answer?: RowsUnread): boolean {
    if (this.startsInFlight.has(holder) || this.arrivals.has(holder)) return false
    if ((this.heldAtAStop.get(holder)?.length ?? 0) > 0) return false
    const slot = this.slots.get(holder)
    if (slot !== undefined) {
      const session = slot.session
      if (session === null) return false
      return session.handle.status() !== 'working' && session.mailbox.length === 0
    }
    const own = rowsUnreadOnce()
    const unread = answer === undefined ? own : notedInBoth(own, answer)
    try {
      const waiting = this.deps.store.messagesWaitingIn(holder, unread)
      return waiting.length === 0 && own.count === 0 && own.ledgersSkipped === 0
    } catch (error) {
      skipTheLedger(holder, error, unread.in(holder))
      return false
    }
  }

  private stoppedCardFor(sessionId: string, by: Caller, me: string | null): AgentCard | null {
    const stopped = this.startable(sessionId)
    if (stopped === null || !this.withinMessagingReach(sessionId, by, me)) return null
    return this.stoppedCard(stopped, this.cardReads())
  }

  private stoppedCard(stopped: Startable, reads: CardReads): AgentCard {
    const unread = rowsUnreadOnce()
    const ledger = this.oneLedgerReadPerAnswer(unread)
    const workOut = this.oneWorkOutReadPerAnswer(rowsUnreadOnce())
    return {
      agent: stopped.id,
      ...this.workerFields(stopped.id),
      whose: whoseConversationIs(stopped.profileId, reads.roster),
      provider: stopped.provider,
      state: this.stateOf(stopped.id, reads, unread, ledger(stopped.id), workOut),
      stoppedOnAPerson: null,
      spawnedBy: stopped.parent,
      parent: stopped.parent,
      named: this.workThatNames(stopped.id, unread),
      parentCalled: this.theStarterOnACard(stopped.parent, stopped.id, reads),
      lastEndedTurn: this.deps.store.lastEndedTurn(stopped.id, unread),
      lastAskToStop: this.deps.store.lastAskToStop(stopped.id, unread),
      pieces: this.piecesOnTheCard(stopped.id, unread, ledger, workOut),
      runsOn: this.whatACardSaysItRunsOn(stopped.id),
      rowsUnread: unread.count,
      ledgersSkipped: unread.ledgersSkipped,
    }
  }

  private cardFor(slot: SessionSlot, reads: CardReads): AgentCard {
    const session = slot.session
    const parent = this.deps.store.parentOf(slot.id)
    const unread = rowsUnreadOnce()
    const ledger = this.oneLedgerReadPerAnswer(unread)
    const workOut = this.oneWorkOutReadPerAnswer(rowsUnreadOnce())
    return {
      agent: slot.id,
      ...this.workerFields(slot.id),
      whose: whoseConversationIs(slot.profileId ?? session?.profileId ?? null, reads.roster),
      provider: slot.provider ?? session?.provider ?? null,
      state: this.stateOf(slot.id, reads, unread, ledger(slot.id), workOut),
      stoppedOnAPerson: this.whatItIsStoppedOn(slot.id, ledger(slot.id)),
      spawnedBy: slot.spawnedBy,
      parent,
      named: this.workThatNames(slot.id, unread),
      parentCalled: this.theStarterOnACard(parent, slot.id, reads),
      lastEndedTurn: this.deps.store.lastEndedTurn(slot.id, unread),
      lastAskToStop: this.deps.store.lastAskToStop(slot.id, unread),
      pieces: this.piecesOnTheCard(slot.id, unread, ledger, workOut),
      runsOn: this.whatACardSaysItRunsOn(slot.id),
      rowsUnread: unread.count,
      ledgersSkipped: unread.ledgersSkipped,
    }
  }

  private whatACardSaysItRunsOn(conversation: string): AgentCard['runsOn'] {
    const running = this.slots.get(conversation)?.session ?? null
    const info = running?.handle.agentInfo
    const kept = this.deps.store.whatItRunsOn(conversation)
    const reported =
      info?.model !== undefined
        ? {
            model: info.model,
            effort: info.reasoningEffortReported === true ? (info.reasoningEffort ?? null) : null,
          }
        : kept?.reportedModel != null
          ? { model: kept.reportedModel, effort: kept.reportedEffort }
          : null
    return { selected: this.thePairItRunsOn(conversation), reported }
  }

  private piecesOnTheCard(
    sessionId: string,
    unread: RowsUnread,
    ledger: (id: string) => ItsLedger,
    workOut: WorkOutOf,
  ): readonly PieceOnTheCard[] {
    const root = this.deps.store.rootOf(sessionId)
    const open = composeWhatEachPieceIsWaitingOn(
      this.deps.store.openPiecesOf(sessionId, unread),
      this.oneWaitReadPerAnswer(unread, ledger, workOut),
    )
    return [
      ...(root === null
        ? []
        : [
            {
              piece: root.piece,
              label: root.label,
              title: this.deps.store.rootLines(root.piece).title,
              state: null,
            },
          ]),
      ...open.map((one) => ({
        piece: one.piece,
        label: one.label,
        title: one.title,
        state: one.state,
      })),
    ]
  }

  private async startSession(
    slot: SessionSlot,
    input: CreateSessionInput,
    sink: RuntimeEventSink,
    spawn: AdmittedSpawn | null,
  ): Promise<CreatedSession> {
    const profileId = input.profileId ?? DEFAULT_PROFILE_ID
    const namedBefore = this.profiles()
    this.refusalsTranslated(() =>
      assertProfileMayBeCreated(profileId, [...namedBefore, ...this.profilesBeingCreated]),
    )
    this.profilesBeingCreated.push(profileId)
    try {
      return await this.startSessionInProfile(slot, input, sink, profileId, namedBefore, spawn)
    } finally {
      const at = this.profilesBeingCreated.indexOf(profileId)
      if (at !== -1) this.profilesBeingCreated.splice(at, 1)
    }
  }

  private theBuildRunning(): TheBuildRunning | null {
    try {
      return this.deps.whichBuild?.() ?? null
    } catch (error) {
      console.warn(`runtime host could not read which build is running: ${errorMessage(error)}`)
      return null
    }
  }

  private instructionContext(
    profileId: string | null,
    cwd: string,
    parentSessionId: string | null,
    conversation: string | null,
    replaces: string | null = null,
    startedFrom: string | null = null,
  ): InstructionContext {
    const profileSlug = profileId === null ? null : foldProfileName(profileId)
    const notes = profileSlug === null ? null : this.deps.store.currentOwnNotesOf(profileSlug)
    return {
      profileSlug,
      displayName:
        profileSlug === null
          ? null
          : (this.deps.store.agentIdentities().find((one) => one.slug === profileSlug)
              ?.displayName ?? null),
      cwd,
      startedBy:
        parentSessionId === null
          ? null
          : this.theStarterCalled(parentSessionId, conversation, startedFrom),
      depth: parentSessionId === null ? 0 : this.deps.store.ancestorsOf(parentSessionId).length + 1,
      root:
        parentSessionId !== null
          ? null
          : conversation === null
            ? 'not-yet-numbered'
            : (this.deps.store.rootOf(conversation)?.label ?? 'not-yet-numbered'),
      capabilities:
        profileSlug === null
          ? null
          : (this.deps.store.capabilitiesOf(profileSlug) ?? DEFAULT_CAPABILITIES),
      spawningEnabled: this.deps.store.spawnPolicy().spawningEnabled,
      ...(profileSlug !== null &&
      this.servicesAreOn() &&
      this.theServiceAgent(profileSlug).is === 'service'
        ? { isAService: true as const }
        : {}),
      configured: profileSlug === null ? null : this.deps.store.configuredLayerFor(profileSlug),
      ownNotes:
        profileSlug === null
          ? null
          : { version: notes?.current?.version ?? 0, text: notes?.current?.text ?? '' },
      plugins: readPluginInstructions(this.deps.plugins),
      build: this.theBuildRunning(),
      others:
        profileSlug === null
          ? { shown: [], more: 0 }
          : this.otherConversationsOf(
              profileSlug,
              conversation !== null
                ? this.theIdsItStandsFor(conversation)
                : replaces === null
                  ? []
                  : this.theIdsItStandsFor(replaces),
            ),
    }
  }

  private otherConversationsOf(profileSlug: string, itself: readonly string[]): OtherConversations {
    const others = this.deps.store
      .conversationsOf(profileSlug)
      .filter((one) => !itself.includes(one.conversation) && !this.replacedBy.has(one.conversation))
    const unread = rowsUnreadOnce()
    const shown = others.slice(0, OTHER_CONVERSATIONS_SHOWN).map((one): OtherConversation => {
      const named = this.workThatNames(one.conversation, unread)
      return {
        label: named?.label ?? one.conversation,
        title: named?.title || 'Untitled conversation',
        lastActiveAt: one.lastActiveAt,
      }
    })
    return { shown, more: others.length - shown.length }
  }

  private async prepareAHome(
    provider: Provider,
    profileId: string,
    sessionId?: string,
  ): Promise<{ readonly home: string; readonly loginRenewed: boolean }> {
    const barrier = this.homeCopyBarriers.get(profileSignInKey(provider, profileId))
    const launch = sessionId === undefined ? undefined : this.slots.get(sessionId)?.launch
    if (barrier !== undefined) {
      if (launch !== undefined) this.homeCopyWaitingLaunches.add(launch)
      void this.copyHomeWhenIdle(provider, profileId)
      try {
        await barrier.ready
      } finally {
        if (launch !== undefined) this.homeCopyWaitingLaunches.delete(launch)
      }
    }
    await this.homeCopyJobs.get(profileSignInKey(provider, profileId))
    const renewedForIt = sessionId !== undefined && this.renewedForItsReopen.delete(sessionId)
    const prepare = (): Promise<string> =>
      untilCancelled(
        Promise.resolve().then(() => this.deps.prepareProviderHome(provider, profileId)),
        launch?.signal,
        'preparing the conversation',
      )
    const renewal = this.deps.loginRenewal?.(provider)
    if (renewal === undefined || this.aKeyIsSaved(provider)) {
      return { home: await prepare(), loginRenewed: renewedForIt }
    }
    const prepared = await renewal.prepare(prepare, () =>
      this.withProviderLaunch(renewal.launchLabel, renewal.renew),
    )
    return { home: prepared.home, loginRenewed: renewedForIt || prepared.loginRenewed }
  }

  private async theSkillsForALaunch(
    slot: SessionSlot,
    provider: Provider,
    providerHome: string,
    profileId: string | null,
    pack: TextPackRead | undefined,
  ): Promise<PreparedBuiltInSkills | undefined> {
    if (!this.deps.prepareBuiltInSkills) return undefined
    const permissions = () => {
      const grants =
        profileId === null
          ? null
          : (this.deps.store.capabilitiesOf(foldProfileName(profileId)) ?? DEFAULT_CAPABILITIES)
      return {
        canCreateAgents: grants?.canCreateAgents === 'any',
        isCoordinator: profileId === DEFAULT_PROFILE_ID,
      }
    }
    const sharedRoot = await this.deps.sharedSkillsRoot?.()
    if (sharedRoot) await this.deps.prepareSharedSkills?.()
    const selected = permissions()
    let selection: SkillLaunchSelection | undefined
    try {
      selection = this.deps.readSelectedSkills?.(
        profileId === null ? null : foldProfileName(profileId),
        selected,
      )
    } catch (cause) {
      throw new Error(`${BUILT_IN_SKILLS_FAILURE} ${String(cause)}`, { cause })
    }
    const isCurrent = () => {
      const current = permissions()
      const grantsRemain = selection
        ? selection.skills.every(
            (skill) =>
              skill.requirement === null ||
              current.canCreateAgents ||
              (skill.requirement === 'create-agents-or-coordinator' && current.isCoordinator),
          )
        : !selected.canCreateAgents || current.canCreateAgents
      return (
        this.whyNotOurs(slot) === null &&
        !slot.launch.signal.aborted &&
        grantsRemain &&
        (selection?.isCurrent() ?? true)
      )
    }
    const installed = await this.deps.prepareBuiltInSkills({
      provider,
      providerHome,
      ...(selection ? { selection } : {}),
      ...selected,
      isCurrent,
      inUseUntil: slot.launch.settled,
      ...(pack ? { pack } : {}),
    })
    if (!isCurrent())
      throw new Error('The skill launch was cancelled or its profile is no longer available.')
    return sharedRoot ? { ...installed, sharedRoot } : installed
  }

  private aKeyIsSaved(provider: Provider): boolean {
    try {
      return this.deps.apiKeys?.status(provider).set === true
    } catch {
      return true
    }
  }

  private assertConnectionUnchanged(provider: Provider, revision: number | undefined): void {
    if (revision !== undefined && this.deps.connectionRevision?.(provider) !== revision)
      throw new Error('The selected connection changed during preparation')
  }

  private runtimeWithPlugins(
    runtime: AgentRuntime,
    provider: Provider,
    profileId: string | null,
  ): AgentRuntime {
    try {
      if (!this.deps.pluginAttachments) return runtime
      return withManagedPluginAttachments(
        runtime,
        this.deps.pluginAttachments.agent([
          AGENT_TOOL_SERVER,
          ...(externalMcpContext(this.deps.store, provider, profileId).externalMcp?.servers.map(
            (one) => one.name,
          ) ?? []),
        ]),
      )
    } catch {
      return runtime
    }
  }

  private async startSessionInProfile(
    slot: SessionSlot,
    input: CreateSessionInput,
    sink: RuntimeEventSink,
    profileId: string,
    namedBefore: readonly string[],
    spawn: AdmittedSpawn | null,
    recorded = false,
  ): Promise<CreatedSession> {
    const id = slot.id
    const cwd = this.deps.resolveCwd(id, input.cwd)
    const connectionId = recorded
      ? this.deps.connectionFor?.(input.provider, this.deps.store.connectionOf(id))
      : this.deps.connectionFor?.(input.provider)
    const connectionRevision = this.deps.connectionRevision?.(input.provider)
    const { home: providerHome, loginRenewed } = await this.prepareAHome(
      input.provider,
      profileId,
      id,
    )
    this.assertConnectionUnchanged(input.provider, connectionRevision)
    const appeared = this.profiles().filter(
      (named) => named !== profileId && !namedBefore.includes(named),
    )
    this.refusalsTranslated(() => assertProfileMayBeCreated(profileId, appeared))
    const rawRuntime =
      connectionId === undefined
        ? this.deps.createRuntime(input.provider)
        : this.deps.createRuntime(input.provider, connectionId)
    const runtime = this.runtimeWithPlugins(rawRuntime, input.provider, profileId)
    const selected = await this.theSelectedModel(input.provider, profileId, profileId, {
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.reasoningEffort === undefined ? {} : { effort: input.reasoningEffort }),
    })
    const model = selected.model
    const reasoningEffort = selected.effort ?? undefined
    const approvalMode = input.approvalMode === 'auto' ? 'auto' : 'ask'
    const pack = this.deps.readTextPack?.()
    const builtInSkills = await this.theSkillsForALaunch(
      slot,
      input.provider,
      providerHome,
      profileId,
      pack,
    )
    const instructions = this.deps.readInstructions?.(
      input.provider,
      cwd,
      providerHome,
      this.instructionContext(
        profileId,
        cwd,
        spawn?.parentSessionId ?? null,
        null,
        slot.replaces,
        slot.startedFrom,
      ),
      pack,
    )
    const systemHint = instructions?.systemHint
    const planMode = input.planMode
    const ultracode = input.ultracode
    const agentTools = this.agentToolsForSession(id)
    const handle = await this.awaitLaunch(
      slot,
      { provider: input.provider, kind: 'fresh' },
      (startPhases) => {
        if (builtInSkills && !builtInSkills.isCurrent()) throw new Error(BUILT_IN_SKILLS_FAILURE)
        this.assertConnectionUnchanged(input.provider, connectionRevision)
        return runtime.start({
          startPhases,
          cwd,
          providerHome,
          ...(builtInSkills
            ? {
                builtInSkills: builtInSkills.context,
                ...(builtInSkills.sharedRoot
                  ? {
                      sharedSkillsRoot: builtInSkills.sharedRoot,
                      sharedSkillsGeneration: this.deps.sharedSkillsGeneration,
                      beforeSkillDiscovery: this.deps.beforeSkillDiscovery,
                    }
                  : {}),
              }
            : {}),
          approvalMode,
          signal: slot.launch.signal,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          model,
          ...(planMode ? { planMode } : {}),
          ...(systemHint ? { systemHint } : {}),
          ...(ultracode ? { ultracode } : {}),
          agentTools,
          ...externalMcpContext(this.deps.store, input.provider, profileId),
          ...workFoldersIn(this.theWorkFoldersALaunchCarries(id)),
        })
      },
    )

    const refused = this.whyNotOurs(slot)
    if (refused !== null) {
      await this.handBack(slot, handle)
      throw new SessionUnavailable('lost-its-place', `session ${id} ${refused}`)
    }

    if (builtInSkills && !builtInSkills.isCurrent()) {
      await this.handBack(slot, handle)
      throw new Error(BUILT_IN_SKILLS_FAILURE)
    }
    const launchGave = this.whatALaunchGave(
      input.provider,
      id,
      agentTools,
      handle.instructionSources ?? [],
      instructions,
      () =>
        this.instructionContext(
          profileId,
          cwd,
          spawn?.parentSessionId ?? null,
          null,
          slot.replaces,
          slot.startedFrom,
        ),
      handle.launchSettings,
      builtInSkills,
    )
    const session = this.register(slot, {
      id,
      provider: input.provider,
      cwd,
      providerHome,
      profileId,
      launchGave,
      createdApprovalMode: approvalMode,
      handle,
      sink,
      startingOrdinal: recorded
        ? this.deps.store.nextOrdinal(id)
        : this.normalWorkerBirths.has(id)
          ? 1
          : 0,
      continuesARecording: recorded,
      instructions: instructions?.instructions,
      ...(builtInSkills ? { builtInSkills } : {}),
      ...(instructions?.firstTurnLead === undefined
        ? {}
        : { firstTurnLead: instructions.firstTurnLead }),
      ...(instructions?.savedMethodsLines === undefined
        ? {}
        : { savedMethodsLines: instructions.savedMethodsLines }),
      onRegistered: (registered) => {
        this.record(registered, () => {
          if (recorded) {
            const launched = this.deps.store.firstLaunchOf({
              id,
              ...(handle.connectionId === undefined ? {} : { connectionId: handle.connectionId }),
              model,
              ...(reasoningEffort ? { reasoningEffort } : {}),
              ...(planMode !== undefined ? { planMode } : {}),
              ...(handle.launchedAs ? { launchedAs: handle.launchedAs } : {}),
            })
            if (!launched) throw new Error(`${id} was launched before, or is not recorded`)
            return
          }
          this.deps.store.create({
            id,
            provider: input.provider,
            ...(handle.connectionId === undefined ? {} : { connectionId: handle.connectionId }),
            cwd,
            approvalMode,
            profileId,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            model,
            ...(planMode !== undefined ? { planMode } : {}),
            ...(spawn === null ? {} : { parentSessionId: spawn.parentSessionId }),
            ...(this.normalWorkerBirths.has(id)
              ? {
                  worker: (() => {
                    const fact = this.normalWorkerBirths.get(id)!
                    return {
                      identity: fact.identity,
                      identityCreatedAt: fact.identityCreatedAt,
                      giver: fact.giver,
                      number: fact.number,
                    }
                  })(),
                }
              : {}),
            ...(handle.launchedAs ? { launchedAs: handle.launchedAs } : {}),
          })
        })
        if (instructions?.memoryLoaded) this.publishOurs(registered, instructions.memoryLoaded)
        this.publishOurs(registered, {
          type: 'launched',
          ...this.renewalNotice(registered.provider, loginRenewed),
        })
        if (recorded) this.putBackWhatWaitedForThisStart(registered)
      },
    })

    return {
      sessionId: id,
      provider: session.provider,
      cwd,
      providerHome,
      profileId,
      ref: handle.ref,
      config: this.deps.readProviderConfig(session.provider, providerHome),
      instructions: instructionsFor(session),
      ...approvalDisclosure(session),
      planNeedsGoAhead: handle.planNeedsGoAhead,
      settings: settingsDisclosure(session),
      queued: [],
      liveness: livenessFor(session),
      ...this.providerBlockDisclosure(session.id, session.provider),
      hasACommander: slot.commandedBy !== null,
      startedWithoutAWindow: slot.bornWithoutASurface,
      mayHandItBack: mayHandBack(slot, sink),
    }
  }

  async setApprovalMode(
    sessionId: string,
    mode: 'ask' | 'auto',
    by: Caller,
  ): Promise<ApprovalModeDisclosure> {
    const recorded = this.aSettingForItsNextStart(sessionId, by)
    if (recorded !== null) {
      this.deps.store.setApprovalMode(sessionId, mode)
      return {
        approvalMode: mode,
        pendingApprovalMode: null,
        approvalNote: describeApprovalMode(recorded.provider, mode),
        blanketGrants: [],
      }
    }
    const session = this.require(sessionId, by)
    await session.handle.setApprovalMode(mode)
    this.record(session, () => this.deps.store.setApprovalMode(sessionId, mode))
    if (session.sink.alive) this.reportRecordingFailure(session)
    this.publishStateIfChanged(session)
    return approvalDisclosure(session)
  }

  async setSessionSetting(
    sessionId: string,
    change:
      | { kind: 'model'; model: string | undefined }
      | { kind: 'reasoningEffort'; effort: string | undefined }
      | { kind: 'planMode'; on: boolean },
    by: Caller,
  ): Promise<SessionSettingChanged> {
    if (change.kind !== 'planMode' && this.aSettingForItsNextStart(sessionId, by) === null) {
      this.require(sessionId, by)
    }
    const { named, list } =
      change.kind === 'planMode'
        ? { named: change, list: null }
        : await this.theSettingNamed(sessionId, change)
    const recorded = this.aSettingForItsNextStart(sessionId, by)
    if (recorded !== null) {
      if (named.kind === 'planMode') {
        throw new Error('planning is chosen once this conversation has taken its next message')
      }
      if (named.kind === 'model') this.deps.store.setModel(sessionId, named.model)
      if (named.kind === 'reasoningEffort' || named.effort !== undefined) {
        this.deps.store.setReasoningEffort(sessionId, named.effort ?? null)
      }
      this.deps.store.aPersonSetItsModelOrEffort(sessionId, this.now())
      const row = this.deps.store.findLive(sessionId)
      const pair = row?.model == null ? null : { model: row.model, effort: row.reasoningEffort }
      return {
        settings: {
          model: row?.model ?? null,
          pendingModel: null,
          reasoningEffort: resolveReasoningEffort(row ?? undefined) ?? null,
          pendingReasoningEffort: null,
          planMode: false,
          pendingPlanMode: null,
          ...this.whatWasReported(sessionId),
        },
        thePick:
          list === null
            ? null
            : this.aPersonPickedItFor(recorded.provider, recorded.profileId, pair, list),
      }
    }
    const session = this.require(sessionId, by)
    switch (named.kind) {
      case 'model':
        await session.handle.setModel(named.model)
        if (named.effort !== undefined) {
          await session.handle.setReasoningEffort(named.effort ?? undefined)
          this.record(session, () =>
            this.deps.store.setReasoningEffort(sessionId, named.effort ?? null),
          )
        }
        this.record(session, () => this.deps.store.setModel(sessionId, named.model))
        this.record(session, () =>
          this.deps.store.aPersonSetItsModelOrEffort(sessionId, this.now()),
        )
        break
      case 'reasoningEffort':
        await session.handle.setReasoningEffort(named.effort ?? undefined)
        this.record(session, () => this.deps.store.setReasoningEffort(sessionId, named.effort))
        this.record(session, () =>
          this.deps.store.aPersonSetItsModelOrEffort(sessionId, this.now()),
        )
        break
      case 'planMode':
        if (!named.on) {
          throw new Error(
            'stopping plan mode is the go-ahead — send it with a message rather than as a setting',
          )
        }
        await session.handle.setPlanMode(true)
        this.record(session, () => this.deps.store.startPlanMode(sessionId, this.now()))
        session.planAsRecorded = true
        this.stateMayHaveMoved(sessionId)
        break
    }
    const { model, reasoningEffort } = session.handle.settings
    const thePick =
      list === null
        ? null
        : this.aPersonPickedItFor(
            session.provider,
            session.profileId,
            model.requested === undefined
              ? null
              : { model: model.requested, effort: reasoningEffort.requested ?? null },
            list,
          )
    if (session.sink.alive) this.reportRecordingFailure(session)
    this.publishStateIfChanged(session)
    return { settings: settingsDisclosure(session), thePick }
  }

  private async theSettingNamed(
    sessionId: string,
    change:
      | { kind: 'model'; model: string | undefined }
      | { kind: 'reasoningEffort'; effort: string | undefined },
  ): Promise<{
    readonly named:
      | { kind: 'model'; model: string; effort?: string | null }
      | { kind: 'reasoningEffort'; effort: string | null }
    readonly list: TheListAsked
  }> {
    const live = this.slots.get(sessionId)?.session ?? null
    const row = live === null ? this.deps.store.recordedOne(sessionId) : null
    const provider = live?.provider ?? row?.provider
    if (provider === undefined) throw new Error('there is no record of this conversation here')
    const list = await this.modelCatalogues.theListFor(
      provider,
      live?.profileId ?? row?.profileId ?? DEFAULT_PROFILE_ID,
    )
    if (change.kind === 'reasoningEffort' && change.effort !== undefined) {
      return { named: { kind: 'reasoningEffort', effort: change.effort }, list }
    }
    const said = (model: string, effort: string | null | undefined): string | null => {
      if (effort !== undefined) return effort
      throw new Error(
        list.notAsked === null
          ? `${PROVIDER_NAME[provider]} names no default effort “${model}” offers, so nothing was changed: choose an effort by name`
          : `${PROVIDER_NAME[provider]} could not be asked which efforts “${model}” offers, so nothing was changed: choose an effort by name`,
      )
    }
    const effortOf = (model: string): string | null =>
      said(model, this.modelCatalogues.theEffortOfAModelNamedAlone(list, provider, model))
    const runs = this.thePairItRunsOn(sessionId)
    if (change.kind === 'reasoningEffort') {
      return {
        named: { kind: 'reasoningEffort', effort: runs === null ? null : effortOf(runs.model) },
        list,
      }
    }
    const model =
      change.model ??
      this.modelCatalogues.theProvidersDefaultIn(list, provider, runs?.effort ?? undefined)?.model
    if (model === undefined) {
      throw new Error(
        list.notAsked === null
          ? `${PROVIDER_NAME[provider]} names no default model and effort, so nothing was changed: choose a model by name`
          : `${PROVIDER_NAME[provider]} could not be asked which model is its default, so nothing was changed: choose a model by name`,
      )
    }
    const itsRow = theListedRow(list.rows, model)
    const effort = runs?.effort ?? null
    const follows =
      itsRow === undefined || (list.notAsked !== null && itsRow.addedBy === 'a-person')
        ? (effort ?? effortOf(model))
        : effort !== null && theEffortsOf(itsRow).includes(effort)
          ? effort
          : said(model, theEffortWhenNoneIsNamed(itsRow, list.rows))
    return {
      named:
        follows === effort ? { kind: 'model', model } : { kind: 'model', model, effort: follows },
      list,
    }
  }

  private aPersonPickedItFor(
    provider: Provider,
    profileSlug: string | null,
    pair: ModelAndEffort | null,
    list: TheListAsked,
  ): WhatAPickBecame {
    const alone = (
      because: Extract<WhatAPickBecame, { itsAgentsDefault: false }>['because'],
    ): WhatAPickBecame => ({ itsAgentsDefault: false, theLastPick: false, because })
    if (pair === null) return alone('no-model-is-named')
    if (list.notAsked !== null) return alone('the-list-could-not-be-read')
    const row = theListedRow(list.rows, pair.model)
    if (row === undefined || judgeAgainstTheList(list.rows, pair) !== null) {
      return alone('the-list-does-not-hold-it')
    }
    const listed = { ...pair, model: theListsSpelling(row, pair.model) }
    const inForce =
      profileSlug !== null &&
      aChoiceIsInForce({ provider, ...listed }, this.itsProvider(profileSlug).provider)
    const itsAgentsDefault =
      inForce && this.deps.store.setModelChoice(profileSlug, { provider, ...listed })
    this.deps.store.aPersonPicked(provider, listed, this.now())
    this.theWorldMoved('agents')
    if (itsAgentsDefault) return { itsAgentsDefault: true, theLastPick: true }
    return {
      itsAgentsDefault: false,
      theLastPick: true,
      because:
        inForce || profileSlug === null
          ? 'it-names-no-agent'
          : 'its-agent-runs-on-another-provider',
    }
  }

  private whatWasReported(sessionId: string): { reported?: ReportedModel } {
    const runs = this.deps.store.whatItRunsOn(sessionId)
    return runs?.reportedModel == null
      ? {}
      : {
          reported: {
            model: runs.reportedModel,
            ...(runs.reportedEffort === null ? {} : { effort: runs.reportedEffort }),
          },
        }
  }

  private aSettingForItsNextStart(sessionId: string, by: Caller): RecordedSession | null {
    if (this.slots.has(sessionId)) return null
    const row = this.deps.store.recordedOne(sessionId)
    if (row === null) throw new Error('there is no record of this conversation here')
    if (!aPersonIsAsking(by)) {
      throw new Error('only a person changes how another conversation will start')
    }
    const refused = whyNoSettingForItsNextStart(
      row,
      this.replacedBy,
      this.theServiceOf(sessionId) !== null,
    )
    if (refused !== null) throw new Error(refused)
    return row
  }

  async endPlanMode(sessionId: string, by: Caller, text?: string): Promise<void> {
    const session = this.require(sessionId, by)
    const status = session.handle.status()
    if (text === undefined ? status === 'ended' || status === 'errored' : status !== 'idle') {
      const why = status === 'ended' || status === 'errored' ? 'over' : 'still working'
      const what = text === undefined ? 'leave planning' : 'start work on the plan'
      throw new Error(`cannot ${what}: this conversation is ${why}`)
    }
    if (text !== undefined) {
      await this.assertCanTakeTurn(session, 'send', { text, attached: 0, from: null })
    }
    await session.handle.setPlanMode(false)
    this.record(session, () => this.deps.store.endPlanMode(sessionId, this.now()))
    session.planAsRecorded = false
    this.stateMayHaveMoved(sessionId)
    if (session.sink.alive) this.reportRecordingFailure(session)
    this.publishStateIfChanged(session)
    if (text === undefined) {
      void this.copyHomeWhenIdle(session.provider, session.profileId)
      this.reopenForWhatWaits(session)
      return
    }
    const moveHandoff = this.beginMoveHandoff(session, false)
    try {
      session.wordsJustHandedOver = text
      session.wordsItWasHandedFor = [text]
      session.leadJustHandedOver = null
      session.handle.setWorkFolders(this.theWorkFoldersFor(session, []))
      this.aTurnIsHandedOver(session, { aPersons: true, names: [] }, false)
      await this.sendTheAppsWords(session, text)
    } catch (error) {
      if (error instanceof TurnInProgress) {
        try {
          await this.queueAs(
            sessionId,
            text,
            THE_APP_ITSELF,
            [],
            'work',
            {},
            WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
            'after-a-lost-race',
          )
        } catch (refused) {
          throw theGoAheadWasNotSent(refused)
        }
        return
      }
      throw theGoAheadWasNotSent(error)
    }
    this.publishStateIfChanged(session)
    this.publishOurs(
      session,
      { type: 'user_turn', text, attribution: 'app_authored' },
      undefined,
      moveHandoff,
    )
  }

  private sendTheAppsWords(session: HostedSession, text: string): Promise<void> {
    return session.handle.send(text, this.stampFor(null, []))
  }

  refreshConfig(sessionId: string, by: Caller): ProviderConfigInfo {
    const session = this.require(sessionId, by)
    return this.deps.readProviderConfig(session.provider, session.providerHome)
  }

  private beginMoveHandoff(session: HostedSession, person: boolean): object {
    const handoff = {}
    session.moveRequestHandoff = handoff
    session.moveRequestTurn = null
    session.moveRequestRowPending = person
    return handoff
  }

  private handToProvider(
    session: HostedSession,
    text: string,
    handed: readonly HandedPath[],
    handing: ThePieceATurnCarries | null,
    drives: string | null,
    about: string | null,
    from: TurnOrigin | null,
    authorship: Pick<
      UserTurnEvent,
      'attribution' | 'work' | 'relayedFrom' | 'appNotice' | 'movedFrom'
    >,
    decided?: WhatTheGateDecided,
    interrupting?: AStopAskedFor,
  ): Promise<void> {
    session.aPersonsWordsOpenedIt = from?.who === 'a-person'
    const whose: WhoseTurnItIs = {
      aPersons: aPersonsOwnWords(authorship),
      names: thePiecesTheTurnNames([
        {
          ...(handing === null ? {} : { piece: handing.piece }),
          ...(drives === null ? {} : { drives }),
        },
      ]),
    }
    const askedForTheStop = interrupting !== undefined
    session.wordsJustHandedOver = null
    session.wordsItWasHandedFor = [text]
    session.leadJustHandedOver = null
    if (session.handle.compact !== undefined && aPersonsCompaction(text, from) !== null) {
      this.aTurnIsHandedOver(session, whose, askedForTheStop)
      return session.handle.compact()
    }
    const command =
      decided !== undefined
        ? decided.command
        : aPersonsCommand(text, from, session.commands, PROVIDER_COMMAND_PREFIX[session.provider])
    if (command !== null) {
      if (handed.length > 0) throw new ACommandTakesNoAttachments(command.word, command.listed)
      session.wordsJustHandedOver = text
      session.handle.setWorkFolders(this.theWorkFoldersFor(session, []))
      const kept = this.aTurnIsHandedOver(session, whose, askedForTheStop)
      try {
        return session.handle.send(text, this.stampFor(from, handed))
      } catch (error) {
        session.itsTurnIs = kept
        throw error
      }
    }
    const framed = messageNamingThePiece(
      messageNamingItsSender(
        messageWithHandedPaths(this.withWhereItWasMovedFrom(text, authorship.movedFrom), handed),
        from,
        (sender) => this.whereTheSenderStands(sender, session.id, handing, drives, about),
        interrupting,
      ),
      handing,
    )
    const owedLead = session.firstTurnLead
    const owedLeadIs = session.firstTurnLeadIs
    const words = this.withWhatThisLifeOwes(session, framed, drives ?? handing?.piece ?? null)
    session.handle.setWorkFolders(
      this.theWorkFoldersFor(session, handing === null ? [] : [handing]),
    )
    const kept = this.aTurnIsHandedOver(session, whose, askedForTheStop)
    try {
      return this.keepLeadWhenUnsent(session, owedLead, owedLeadIs, () =>
        session.handle.send(words, this.stampFor(from, handed)),
      )
    } catch (error) {
      session.itsTurnIs = kept
      throw error
    }
  }

  private withWhereItWasMovedFrom(text: string, movedFrom: MoveOrigin | undefined): string {
    if (movedFrom === undefined) return text
    let title = movedFrom.name
    try {
      const named = this.workThatNames(movedFrom.sessionId)
      if (named !== null) title = pieceLine(named.label, named.title)
    } catch (error) {
      console.warn(
        `runtime host could not read what names ${movedFrom.sessionId}, so a request moved from it names it as the move did: ${errorMessage(error)}`,
      )
    }
    const line = movedHereLine(conversationLink(movedFrom.sessionId, title))
    return text.trim() === '' ? line : `${line}\n\n${text}`
  }

  private handTogetherToProvider(
    session: HostedSession,
    messages: readonly OneMessageOfATurn[],
  ): Promise<void> {
    session.aPersonsWordsOpenedIt = messages.some(({ queued }) => queued.origin?.who === 'a-person')
    session.wordsItWasHandedFor = messages.map(({ words }) => words)
    session.leadJustHandedOver = null
    const soFar = aTurnThatHasSaidNothing()
    const turn = aTurnOfSeveral(
      messages.map(({ queued, words, handed, handing }) => ({
        words: messageNamingThePiece(
          messageNamingItsSender(
            messageWithHandedPaths(words, handed.paths),
            queued.origin ?? null,
            (sender) =>
              this.whereTheSenderStands(
                sender,
                session.id,
                handing,
                queued.drives ?? null,
                queued.about ?? null,
              ),
            queued.interrupting,
            soFar,
          ),
          handing,
        ),
        theAppWroteIt: queued.origin === undefined,
      })),
    )
    session.handle.setWorkFolders(
      this.theWorkFoldersFor(
        session,
        messages.flatMap(({ handing }) => (handing === null ? [] : [handing])),
      ),
    )
    const namedPieces = new Set(
      messages.map(({ queued, handing }) => queued.drives ?? handing?.piece ?? null),
    )
    const currentPiece = namedPieces.size === 1 ? [...namedPieces][0]! : null
    const nothingRuns = session.handle.status() === 'idle'
    const owedLead = session.firstTurnLead
    const owedLeadIs = session.firstTurnLeadIs
    const words = this.withWhatThisLifeOwes(session, turn, currentPiece)
    const sent = this.keepLeadWhenUnsent(session, owedLead, owedLeadIs, () =>
      session.handle.send(words, this.stampForATurnOf(messages)),
    )
    this.aTurnIsHandedOver(
      session,
      {
        aPersons: messages.some(({ queued }) => aPersonsOwnWords(queued.authorship)),
        names: thePiecesTheTurnNames(messages.map(({ queued }) => queued)),
      },
      messages.some(({ queued }) => queued.interrupting !== undefined),
      nothingRuns,
    )
    return sent
  }

  private stampForATurnOf(messages: readonly OneMessageOfATurn[]): TurnProvenance | undefined {
    return theStampOfSeveral(
      messages.map(({ queued, handed }) => this.stampFor(queued.origin ?? null, handed.paths)),
    )
  }

  private async theLeadsItsThreadHolds(
    sessionId: string,
    provider: Provider,
    recorded: boolean,
    ordinal: number,
  ): Promise<ReturnType<typeof whatTheThreadHolds>['carried'] | null> {
    const rows = this.deps.store.threadLeadRows
    if (
      providerDescriptor(provider).contextPlacement === 'system-prompt' ||
      !recorded ||
      rows === undefined
    )
      return null
    try {
      const read = await this.readThreadLeads(sessionId, ordinal + 1)
      return read === null ? null : whatTheThreadHolds(leadRowsFrom(read), ordinal + 1).carried
    } catch (error) {
      console.warn(
        `runtime host could not read what thread ${sessionId} holds: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private theLeadAReopenOwes(
    sessionId: string,
    provider: Provider,
    launchGave: WhatALaunchGave | null,
    reopenedThreadLeads: readonly ThreadLeadRow[] | null,
    lines?: SavedMethodsLines,
  ): { leadOwed?: { readonly text: string; readonly is: LeadInFront['is'] } | null } {
    const composed = launchGave?.thisConversation ?? null
    const rows = this.deps.store.threadLeadRows
    if (
      providerDescriptor(provider).contextPlacement === 'system-prompt' ||
      composed === null ||
      rows === undefined
    )
      return {}
    try {
      if (reopenedThreadLeads === null) return {}
      const held = whatTheThreadHolds(leadRowsFrom(reopenedThreadLeads), Infinity)
      const owed = theLeadOwed(held, composed)
      return {
        leadOwed: owed === null ? null : { ...owed, text: withTheLinesSent(owed.text, lines) },
      }
    } catch (error) {
      console.warn(
        `runtime host could not read what thread ${sessionId} holds: ${errorMessage(error)}`,
      )
      return {}
    }
  }

  private withWhatThisLifeOwes(
    session: HostedSession,
    said: string,
    currentPiece: string | null = null,
  ): string {
    const plugins = pluginInstructionSection(readPluginInstructions(this.deps.plugins))
    const refresh =
      plugins !== null &&
      plugins !== session.pluginsAsLastSaid &&
      !session.firstTurnLead?.includes(plugins)
        ? `\n\n${whatChangedBlock([plugins])}`
        : ''
    const words = `${this.withWhatThisLifeStillOwes(session, said)}${refresh}\n\n${this.whatThisAppAddsAtItsEnd(session, currentPiece)}`
    session.wordsJustHandedOver = words
    if (session.pendingTurnBlock !== null)
      session.pendingTurnBlock = {
        ...session.pendingTurnBlock,
        words,
        plugins: plugins ?? session.pluginsAsLastSaid,
      }
    return words
  }

  private whatThisAppAddsAtItsEnd(session: HostedSession, currentPiece: string | null): string {
    const now = this.now()
    const aPersonStartedIt = session.aPersonsWordsOpenedIt
    const due = (
      inOneWord: string,
      before: { readonly said: string; readonly at: number } | null,
    ): boolean =>
      aPersonStartedIt ||
      before === null ||
      before.said !== inOneWord ||
      now - before.at > WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS
    const facts = this.factsForTheTurnBlock(session, currentPiece)
    const changed = turnBlockChanges(
      { ...facts, person: aPersonStartedIt, now },
      session.turnBlockSnapshot,
    )
    const previousQuestions = session.itsQuestionsAsLastSaid
    const previousWaiting = session.whoWaitedAsLastSaid
    let questions = facts.questions
    if (questions !== null) {
      const inOneWord = itsQuestionsInOneWord(questions)
      if (due(inOneWord, session.itsQuestionsAsLastSaid)) {
        session.itsQuestionsAsLastSaid = { said: inOneWord, at: now }
      } else questions = null
    }
    let waiting = this.whoWaitsOnItAtHand(session)
    if (waiting !== null && waiting.givers.length + waiting.askers.length === 0) {
      session.whoWaitedAsLastSaid = null
    } else if (waiting !== null) {
      const inOneWord = whoWaitsInOneWord(waiting)
      if (due(inOneWord, session.whoWaitedAsLastSaid)) {
        session.whoWaitedAsLastSaid = { said: inOneWord, at: now }
      } else waiting = null
    }
    session.pendingTurnBlock = {
      plugins: session.pluginsAsLastSaid,
      next: changed.next,
      words: '',
      questions: session.itsQuestionsAsLastSaid,
      waiting: session.whoWaitedAsLastSaid,
    }
    session.itsQuestionsAsLastSaid = previousQuestions
    session.whoWaitedAsLastSaid = previousWaiting
    const added = whatThisAppAddsToATurn({
      now,
      aPersonStartedIt,
      thePersonLastWroteAt: session.aPersonLastWroteAt,
      questions,
      waiting,
      extra: changed.extra,
    })
    const sharedRoot = session.builtInSkills?.sharedRoot
    const context = sharedRoot
      ? `${added}\nShared skills: ${sharedRoot}. Add or edit a skill there; every agent sees it from its next turn.`
      : added
    if (
      !session.builtInSkills ||
      !providerKnowledge[session.provider].skills.needsReminders(() =>
        session.handle.builtInSkillsConfirmed?.(),
      )
    )
      return context
    const grants =
      this.deps.store.capabilitiesOf(foldProfileName(session.profileId)) ?? DEFAULT_CAPABILITIES
    const reminders = permittedInstalledSkillReminders(
      session.builtInSkills.reminder,
      grants.canCreateAgents === 'any',
      session.profileId === DEFAULT_PROFILE_ID,
    )
    return reminders === '' ? context : `${context}\n${reminders}`
  }

  private factsForTheTurnBlock(
    session: HostedSession,
    currentPiece: string | null,
  ): {
    readonly helpers: readonly AHelperInTheTurn[] | null
    readonly questions: readonly AQuestionItHasOpen[] | null
    readonly personWait: string | null
    readonly nobodyWaiting: boolean
    readonly replyQuestionTurn: string | null
    readonly current: CurrentWorkInTheTurn
  } {
    const unread = rowsUnreadOnce()
    const owners = new Set<string>([session.id])
    const held = new Map<string, readonly PieceRow[]>()
    const ledgers = new Map<string, ItsLedger>()
    let candidatesRead = 0
    const admit = (id: string): void => {
      if (!owners.has(id) && owners.size > TURN_HELPER_OWNERS)
        throw new Error('turn helper owner bound')
      owners.add(id)
    }
    const pieces = (id: string): readonly PieceRow[] => {
      admit(id)
      let rows = held.get(id)
      if (rows === undefined) {
        rows = this.deps.store.turnBlockPiecesOwnedBy(id, unread)
        held.set(id, rows)
      }
      return rows
    }
    const ledger = (id: string): ItsLedger => {
      admit(id)
      let read = ledgers.get(id)
      if (read === undefined) {
        read = {
          routings: this.deps.store.routedRequestsOf(id, unread),
          raised: this.deps.store.questionsRaisedIn(id, unread),
        }
        ledgers.set(id, read)
      }
      return read
    }
    const given = new Map<string, readonly PieceRow[]>()
    const workOut = (id: string): readonly PieceRow[] => {
      const before = given.get(id)
      if (before !== undefined) return before
      const rows: PieceRow[] = []
      const givers = this.theIdsItStandsFor(id)
      if (givers.length > TURN_HELPER_OWNERS) throw new Error('turn giver bound')
      for (const giver of givers) {
        let after: string | null = null
        for (;;) {
          const candidates = this.deps.store.turnBlockCandidates(
            giver,
            TURN_HELPER_PIECES + 1,
            after,
          )
          if (candidates === null) throw new Error('turn has no ledger')
          const page = candidates.slice(0, TURN_HELPER_PIECES)
          for (const candidate of page) {
            const row = pieces(candidate.owner).find(
              (one) => one.piece === candidate.piece && one.giver === giver,
            )
            if (row === undefined) throw new Error('turn candidate was not read')
            if (
              !TASK_IS_OPEN[row.state] &&
              session.turnBlockSnapshot?.awaitingEnd.has(row.piece) !== true &&
              !(session.turnBlockSnapshot?.at != null && row.givenAt > session.turnBlockSnapshot.at)
            )
              continue
            candidatesRead += 1
            if (candidatesRead > TURN_HELPER_PIECES) throw new Error('turn helper piece bound')
            rows.push(row)
          }
          if (candidates.length <= TURN_HELPER_PIECES) break
          const last = page.at(-1)!.piece
          if (last === after) throw new Error('turn helper candidate page did not advance')
          after = last
        }
      }
      given.set(id, rows)
      return rows
    }
    const helperNames = new Map<string, string>()
    let current: CurrentWorkInTheTurn = { kind: 'unavailable' }
    let questions: readonly AQuestionItHasOpen[] | null = null
    let personWait: string | null = null
    let nobodyWaiting = false
    let replyQuestionTurn: string | null = null
    try {
      if (this.deps.store.turnBlockCandidates(session.id, 0) === null)
        throw new Error('turn has no ledger')
      const root = this.deps.store.rootOf(session.id)
      if (root !== null) {
        const lines = this.deps.store.turnBlockRootLines(root.piece)
        if (lines !== null)
          current = {
            kind: 'piece',
            label: root.label,
            title: lines.title,
            status: lines.statusLine?.text ?? null,
          }
      }
      const mine = pieces(session.id)
      if (root === null) {
        const open = mine.filter((row) => TASK_IS_OPEN[row.state])
        const selected =
          open.find((row) => row.piece === currentPiece) ??
          (open.length === 1 ? open[0] : undefined)
        current =
          selected === undefined
            ? open.length === 0
              ? { kind: 'none' }
              : {
                  kind: 'ambiguous',
                  labels: open.slice(0, 5).map((row) => row.label),
                  more: Math.max(0, open.length - 5),
                }
            : {
                kind: 'piece',
                label: selected.label,
                title: selected.title,
                status: selected.statusLine?.text ?? null,
              }
      }
      const ownLedger = ledger(session.id)
      const instructions = this.deps.store.instructionAsksWaitingIn(session.id, unread)
      if (instructions === null) throw new Error('turn instruction waits unavailable')
      if (unread.count > 0 || unread.ledgersSkipped > 0) throw new Error('turn facts incomplete')
      const personRequests = ownLedger.routings.filter(
        (row) => row.went.to === 'a-person' && REQUEST_IS_OPEN[row.state],
      )
      questions = personRequests.flatMap((row) => {
        const raised = ownLedger.raised.get(row.requestId)
        return raised?.raisedBy === 'this-app'
          ? [{ id: row.requestId, askedAt: row.at, prompt: raised.prompt }]
          : []
      })
      const waits = this.oneWaitReadPerAnswer(unread, ledger, (id) =>
        workOut(id).filter((row) => TASK_IS_OPEN[row.state]),
      )
      const raw = workOut(session.id)
      const rawStates = new Map(raw.map((row) => [row.piece, row.state]))
      const helpers = composeWhatEachPieceIsWaitingOn(raw, waits).map((row) =>
        this.withItsPlaceInTheQueue(row, { pieces: pieces(row.owner), waits }),
      )
      const personPieces = [...composeWhatEachPieceIsWaitingOn(mine, waits), ...helpers].filter(
        (row) =>
          TASK_IS_OPEN[row.state] &&
          (row.state === 'waiting-on-a-person' ||
            row.state === 'waiting-on-the-person-who-wrote' ||
            row.needsUserAction === true),
      )
      if (unread.count > 0 || unread.ledgersSkipped > 0)
        throw new Error('turn wait facts incomplete')
      const helperRules: string[] = []
      for (const owner of new Set(
        helpers.filter((row) => TASK_IS_OPEN[row.state]).map((row) => row.owner),
      )) {
        const rules = this.deps.store.instructionAsksWaitingIn(owner, unread)
        if (rules === null) throw new Error('helper instruction waits unavailable')
        helperRules.push(...rules.map((row) => `${owner}:${row.asked.askId}`))
      }
      if (unread.count > 0 || unread.ledgersSkipped > 0)
        throw new Error('turn rule facts incomplete')
      const waitKeys = [
        ...personRequests.map((row) => row.requestId),
        ...instructions.map((row) => row.asked.askId),
        ...helperRules,
        ...personPieces.map((row) => row.piece),
      ].sort()
      personWait = JSON.stringify(waitKeys)
      nobodyWaiting = waitKeys.length === 0
      if (nobodyWaiting) {
        try {
          replyQuestionTurn = this.deps.store.replyQuestionWithoutARequest(session.id)
        } catch {
          // An unread reply supplies no hint about the independently known queue.
        }
      }
      return {
        helpers: helpers
          .filter(
            (row) =>
              TASK_IS_OPEN[row.state] ||
              session.turnBlockSnapshot?.awaitingEnd.has(row.piece) === true ||
              (session.turnBlockSnapshot?.at != null && row.givenAt > session.turnBlockSnapshot.at),
          )
          .map((row) => {
            const open = TASK_IS_OPEN[row.state]
            let name = helperNames.get(row.owner)
            if (name === undefined) {
              if (
                !this.withinMessagingReach(
                  this.theOneInItsPlace(row.owner),
                  { ownerId: agentCallerId(session.id) },
                  session.id,
                )
              )
                throw new Error('helper name is outside card reach')
              name = this.whatToCallTheConversation(row.owner)
              helperNames.set(row.owner, name)
            }
            if (!Object.hasOwn(WORK_STATE_WORD, row.state)) throw new Error('unknown helper state')
            const state =
              row.outcome != null
                ? TURN_BLOCK_WORDS.ended(row.outcome)
                : row.state === 'waiting-on-the-person-who-wrote'
                  ? TURN_BLOCK_WORDS.waitingOnThePerson
                  : WORK_STATE_WORD[row.state]
            return {
              piece: row.piece,
              label: row.label,
              name,
              state,
              givenAt: row.givenAt,
              changedAt:
                row.state === rawStates.get(row.piece) ? (row.lastRecordedChangeAt ?? null) : null,
              open,
              urgent:
                open &&
                (row.state === 'stalled' ||
                  row.state === 'waiting-on-a-person' ||
                  row.state === 'waiting-on-the-person-who-wrote' ||
                  row.needsUserAction === true ||
                  row.queueStalledAt != null),
              revision: JSON.stringify([
                row.owner,
                name,
                row.state,
                row.outcome,
                row.queuedBehind,
                row.queueStalledAt,
                row.statusLine,
                row.lastRecordedChangeAt,
                row.needsUserAction,
              ]),
            }
          }),
        questions,
        personWait,
        nobodyWaiting,
        replyQuestionTurn,
        current,
      }
    } catch (error) {
      console.warn(`turn block facts unavailable for ${session.id}: ${errorMessage(error)}`)
      return {
        helpers: null,
        questions,
        personWait,
        nobodyWaiting,
        replyQuestionTurn,
        current,
      }
    }
  }

  private whoWaitsOnItAtHand(session: HostedSession): WhoWaitsOnIt | null {
    try {
      const pieces = this.deps.store.piecesAtHand(session.id)
      if (pieces === null) return null
      const latest = new Map<string, RoutedRequest>()
      for (const id of this.theIdsItStandsFor(session.id)) {
        const routed = this.deps.store.questionsRoutedToAtHand(id)
        if (routed === null) return null
        for (const request of routed) {
          const itsKey = questionKey(request.askedBy, request.requestId)
          latest.delete(itsKey)
          latest.set(itsKey, request)
        }
      }
      return {
        givers: pieces.flatMap((piece) =>
          TASK_IS_OPEN[piece.state] && piece.giver !== null
            ? [
                {
                  who: this.calledByItsChain(piece.giver, piece.piece),
                  work: `${piece.label} · ${piece.title}`,
                },
              ]
            : [],
        ),
        askers: [...latest.values()].flatMap((request) =>
          REQUEST_IS_OPEN[request.state] && request.went.to !== 'a-person'
            ? [
                {
                  who: this.whatToCallTheConversation(request.askedBy),
                  id: request.requestId,
                  askedAt: request.at,
                },
              ]
            : [],
        ),
      }
    } catch (error) {
      console.warn(`runtime host could not read who waits on ${session.id}: ${errorMessage(error)}`)
      return null
    }
  }

  private calledByItsChain(conversation: string, piece: string): string {
    return theConversationCalled(
      this.whatToCallTheConversation(conversation),
      theWorkAlone(this.deps.store.workOnItsChainThatNames(conversation, piece)),
    )
  }

  private whenAPersonLastWroteIn(sessionId: string): number | null {
    try {
      return this.deps.store.whenAPersonLastWrote(sessionId)
    } catch (error) {
      console.warn(
        `runtime host could not read when a person last wrote in ${sessionId}: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private theWordsHandedOverFor(
    session: HostedSession,
    words: readonly string[],
  ): { sent?: string } {
    const sent = session.wordsJustHandedOver
    const framed = session.wordsItWasHandedFor
    if (sent === null || framed.length !== words.length) return {}
    return framed.every((one, at) => one === words[at]) ? { sent } : {}
  }

  private keepLeadWhenUnsent(
    session: HostedSession,
    lead: string | null,
    is: LeadInFront['is'],
    send: () => Promise<void>,
  ): Promise<void> {
    const consumed = session.leadJustHandedOver
    const restore = (error: unknown) => {
      if (
        error instanceof StoppedBeforeSend &&
        this.slots.get(session.id)?.session === session &&
        lead !== null &&
        session.firstTurnLead === null &&
        session.leadJustHandedOver === consumed
      ) {
        session.firstTurnLead = lead
        session.firstTurnLeadIs = is
        session.leadJustHandedOver = null
      }
    }
    try {
      const sent = send()
      void sent.catch(restore)
      return sent
    } catch (error) {
      restore(error)
      throw error
    }
  }

  private withWhatThisLifeStillOwes(session: HostedSession, said: string): string {
    const words = this.withWhatItsLastStopEnded(session, said)
    const lead = session.firstTurnLead
    if (lead === null) return words
    session.firstTurnLead = null
    session.leadJustHandedOver = {
      is: session.firstTurnLeadIs,
      chars: withTheLinesKept(lead, session.savedMethodsLines).length,
    }
    return `${lead}\n\n${words}`
  }

  private takeWhatItsStopEnded(
    session: HostedSession,
    event: Extract<RuntimeEvent, { type: 'turn' }>,
  ): void {
    const ended = (event.endedCommands ?? []).map(
      (id) => session.toolCallsNamed.get(id)?.text ?? id,
    )
    session.lastStopEnded = ended
    if (event.state !== 'failed' || event.wordOf !== 'this-app') {
      session.stopEndedUntold.splice(0, session.stopEndedSaid)
      session.questionsAStopEndedUntold.splice(0, session.questionsAStopEndedSaid)
    }
    session.stopEndedSaid = 0
    session.questionsAStopEndedSaid = 0
    session.askedSinceItsLastTurnEnded.clear()
    session.stopEndedUntold.push(...ended)
    for (const waiting of session.whenATurnEnds.splice(0)) waiting(ended)
  }

  private withWhatItsLastStopEnded(session: HostedSession, said: string): string {
    const words = this.withTheQuestionsAStopEnded(session, said)
    const names = session.stopEndedUntold
    session.stopEndedSaid = names.length
    if (names.length === 0) return words
    return `${theStopEnded(theStoppedWork(names), names.length)}\n\n${words}`
  }

  private withTheQuestionsAStopEnded(session: HostedSession, words: string): string {
    const ended = session.questionsAStopEndedUntold
    session.questionsAStopEndedSaid = ended.length
    return ended.length === 0 ? words : `${theQuestionsAStopEnded(ended)}\n\n${words}`
  }

  private theQuestionsTheStopOfItsLastTurnEnded(sessionId: string): AQuestionAStopEnded[] {
    try {
      const last = this.deps.store.lastEndedTurn(sessionId)
      if (last === null) return []
      if (last.how !== 'it-was-stopped' && last.how !== 'it-was-stopped-and-it-faulted') return []
      const ended = this.deps.store.requestsItsLastEndedTurnInterrupted(sessionId)
      if (ended.length === 0) return []
      const openNow = new Set(
        this.deps.store
          .routedRequestsOf(sessionId)
          .filter((request) => REQUEST_IS_OPEN[request.state])
          .map((request) => request.requestId),
      )
      const raised = this.deps.store.questionsRaisedIn(sessionId)
      return ended.flatMap((requestId): AQuestionAStopEnded[] => {
        if (openNow.has(requestId)) return []
        const asked = raised.get(requestId)
        return asked?.raisedBy === 'this-app' ? [{ id: requestId, prompt: asked.prompt }] : []
      })
    } catch (error) {
      console.warn(
        `runtime host could not read which questions the stop of ${sessionId}'s last turn ended: ${errorMessage(error)}`,
      )
      return []
    }
  }

  private whereTheSenderStands(
    sender: ACallerWithAnId,
    receiver: string,
    handing: ThePieceATurnCarries | null,
    drives: string | null,
    names: string | null,
  ): WhereTheSenderStands {
    const giver = new Set(this.theIdsItStandsFor(sender.caller))
    const gave = this.deps.store
      .piecesOwnedBy(receiver)
      .filter((one) => one.giver !== null && giver.has(one.giver) && one.piece !== handing?.piece)
    const open = gave.filter((one) => TASK_IS_OPEN[one.state])
    const handedUnder = handing === null ? null : pieceNumbersOf(handing.label)
    const about =
      handedUnder !== null && handedUnder.length > 1
        ? (this.deps.store.workByLabel(pieceCalled(handedUnder.slice(0, -1)))?.piece ?? null)
        : (drives ?? open.at(-1)?.piece ?? null)
    return {
      name:
        sender.profile === null
          ? null
          : agentName(sender.profile, this.deps.store.agentIdentities()),
      handsYou:
        handing === null ? null : { label: handing.label, title: handing.title, as: handing.as },
      openWorkItGaveYou: open.map((one) => one.label),
      gaveYouWorkThatIsClosed: open.length < gave.length,
      named: this.theWorkThatNamesUnder(sender.caller, about),
      about: names === null ? null : this.onePieceAsItStandsNow(names),
    }
  }

  private onePieceAsItStandsNow(piece: string): WorkThatNamesIt | null {
    let row: WorkRow | null = null
    try {
      row = this.deps.store.workById(piece)
      if (row === null) return null
      if (row.parent === null) {
        return { label: row.label, title: this.deps.store.rootLines(row.piece).title }
      }
      const owner = row.owner
      const folded = this.deps.store.piecesOwnedBy(owner).find((one) => one.piece === piece)
      return folded === undefined
        ? { label: row.label, title: row.title }
        : onePieceAsItStands(folded)
    } catch (error) {
      console.warn(`runtime host could not read how ${piece} stands: ${errorMessage(error)}`)
      return row === null ? null : { label: row.label, title: row.title }
    }
  }

  private stampFor(
    origin: TurnOrigin | null,
    handed: readonly HandedPath[],
  ): TurnProvenance | undefined {
    return provenanceOf(
      origin,
      (profile) => agentName(profile, this.deps.store.agentIdentities()),
      handed,
    )
  }

  send(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[] = [],
    facts: FactsAQueueCarries = {},
  ): Promise<void> {
    let now: boolean
    try {
      now = this.takesADeliveryNow(sessionId)
      if (now) this.aPersonsWindowTakesIt(sessionId, theSurfaceAsking(by))
    } catch (error) {
      return Promise.reject(error)
    }
    const send = (to: string): Promise<void> =>
      this.sendAs(to, text, by, attachments, { facts, ifItLosesTheRace: 'hold-it' })
    if (now) {
      return this.sendAs(sessionId, text, by, attachments, {
        facts,
        ifItLosesTheRace: 'hold-it',
        onAStop: 'start-it-again',
      })
    }
    return this.deliverWhenItRuns(
      sessionId,
      text,
      by,
      attachments,
      WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
      send,
    )
  }

  private async sendAs(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[],
    how: (
      | { readonly facts: FactsAQueueCarries; readonly ifItLosesTheRace: 'hold-it' }
      | {
          readonly facts: TurnFacts
          readonly ifItLosesTheRace: 'pass-it-on'
          readonly says: AgentMessageKind | null
        }
    ) & {
      readonly onAStop?: 'start-it-again'
    },
  ): Promise<void> {
    const { facts } = how
    const session = this.requireToMessage(sessionId, by)
    if (how.ifItLosesTheRace !== 'pass-it-on' || how.says !== null) {
      this.assertMayReach('message', sessionId, by)
    }
    let handed: Awaited<ReturnType<typeof recheckHandedPaths>>
    try {
      await this.assertCanTakeTurn(session, 'send', {
        text,
        attached: attachments.length,
        from: this.originOf(by),
      })
      handed = await recheckHandedPaths(attachments, session.cwd)
    } catch (error) {
      if (
        how.onAStop === 'start-it-again' &&
        !(error instanceof StoppedBeforeSend) &&
        this.itStoppedUnder(session)
      ) {
        return this.aDeliveryAStopCaught(sessionId, text, by, attachments, how)
      }
      if (
        how.ifItLosesTheRace === 'hold-it' &&
        aPersonIsAsking(by) &&
        this.aReopenCarriesIt(error, by, session)
      ) {
        await this.queueAs(
          sessionId,
          text,
          by,
          attachments,
          'work',
          how.facts,
          WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
          'after-a-lost-race',
        )
        return
      }
      throw error
    }
    if ('refusal' in handed) throw new Error(handed.refusal)
    const declared = how.ifItLosesTheRace === 'pass-it-on' ? (how.says ?? undefined) : undefined
    const handing = this.thePieceItCarries(facts)
    const drives = this.thePieceTheseWordsDrive(sessionId, facts)
    const turn: UserTurnEvent = {
      type: 'user_turn',
      text,
      ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),
      ...whoseWordsTheseAre(by, this.profileOf, facts, declared),
      ...(handing === null ? {} : { piece: handing.piece, label: handing.label }),
      ...(drives === null ? {} : { drives }),
    }
    const about =
      this.originOf(by)?.who === 'a-caller-with-an-id' ? (facts.aboutPiece?.piece ?? null) : null
    if (
      aPersonIsAsking(by) &&
      sessionSpeakingAs(by) === null &&
      TURN_ATTRIBUTION_KEYS.every((key) => turn[key] === undefined)
    )
      this.declineMoveOffersFromText(session.id, by)
    const moveHandoff = this.beginMoveHandoff(
      session,
      TURN_ATTRIBUTION_KEYS.every((key) => key === 'movedFrom' || turn[key] === undefined),
    )
    const personalWorkTurnBefore = session.personalWorkTurn
    const personalHandover = session.personalHandover + 1
    try {
      if (this.aCallersWordsNoLongerGoStraightIn(sessionId, by)) throw new TurnInProgress()
      await this.handToProvider(
        session,
        text,
        handed.paths,
        handing,
        drives,
        about,
        this.originOf(by),
        turn,
      )
    } catch (error) {
      if (error instanceof TurnInProgress && session.personalHandover === personalHandover)
        session.personalWorkTurn = personalWorkTurnBefore
      if (session.moveRequestHandoff === moveHandoff) session.moveRequestRowPending = false
      if (
        how.onAStop === 'start-it-again' &&
        !(error instanceof TurnInProgress) &&
        !(error instanceof StoppedBeforeSend) &&
        this.itStoppedUnder(session)
      ) {
        return this.aDeliveryAStopCaught(sessionId, text, by, attachments, how)
      }
      if (how.ifItLosesTheRace === 'pass-it-on' || !(error instanceof TurnInProgress)) throw error
      const again = (to: string): Promise<QueueOutcome> =>
        this.queueAs(
          to,
          text,
          by,
          attachments,
          'work',
          how.facts,
          WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
          'as-it-finds-it',
        )
      await this.queueAs(
        sessionId,
        text,
        by,
        attachments,
        'work',
        how.facts,
        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
        'after-a-lost-race',
        how.onAStop === undefined ? undefined : again,
      )
      return
    }
    this.publishStateIfChanged(session)
    this.publishOurs(session, turn, undefined, moveHandoff, personalHandover)
  }

  private thePieceItCarries(facts: TurnFacts): ThePieceATurnCarries | null {
    const { giving, rebriefing } = facts
    if (giving !== undefined) {
      const { piece, label, title, inputs, definitionOfDone } = giving
      return {
        piece,
        label,
        title,
        definitionOfDone,
        as: 'given',
        inputs,
        ...grantOf(giving.givenFolder),
      }
    }
    if (rebriefing === undefined) return null
    return { ...rebriefing, as: 'rebriefed', inputs: this.theInputsOf(rebriefing.piece) }
  }

  private thePieceTheseWordsDrive(recipient: string, facts: TurnFacts): string | null {
    if (facts.giving !== undefined || facts.rebriefing !== undefined) return null
    const named = facts.report?.piece ?? facts.aboutPiece?.piece ?? null
    if (named === null) return null
    return this.deps.store.pieceOfItsChainHeldBy(named, recipient) ?? named
  }

  private theInputsOf(
    piece: string,
  ): readonly { readonly resource: string; readonly name: string }[] {
    return this.deps.store
      .resourcesOf(piece)
      .filter((one) => one.role === 'input')
      .map((one) => ({ resource: one.resource, name: one.name }))
  }

  private itStoppedUnder(session: HostedSession): boolean {
    if (
      session.closing !== null ||
      session.finalizing !== null ||
      session.handle.isRetiring?.() === true
    )
      return true
    const status = session.handle.status()
    return (
      status === 'ended' || status === 'errored' || this.slots.get(session.id)?.session !== session
    )
  }

  private aDeliveryAStopCaught(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[],
    how:
      | { readonly facts: FactsAQueueCarries; readonly ifItLosesTheRace: 'hold-it' }
      | { readonly ifItLosesTheRace: 'pass-it-on' },
  ): Promise<void> {
    if (how.ifItLosesTheRace === 'pass-it-on')
      return Promise.reject(new ItStoppedUnderTheDelivery())
    return this.deliverWhenItRuns(
      sessionId,
      text,
      by,
      attachments,
      WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
      (to) =>
        this.sendAs(to, text, by, attachments, {
          facts: how.facts,
          ifItLosesTheRace: 'hold-it',
        }),
    )
  }

  noteRefusal(sessionId: string, tool: ToolName, refused: RefusalFacts): void {
    const slot = this.slots.get(sessionId)
    const session = slot?.phase === 'live' ? slot.session : null
    if (session === null) {
      console.warn(
        `runtime host cannot record that ${tool} was refused (${refused.rail}) for ${sessionId}: ` +
          'that conversation is not live in this host',
      )
      return
    }
    this.publishOurs(session, {
      type: 'tool_refused',
      tool,
      rail: refused.rail,
      permanence: refused.permanence,
      retryable: refused.retryable,
      remedy: refused.remedy,
      ...(refused.told === undefined ? {} : { told: refused.told }),
    })
  }

  private publishOurs(
    session: HostedSession,
    event:
      | WorkReconciliationEvent
      | WorkRecoveryEvent
      | MessageSentEvent
      | UserTurnEvent
      | UserDecisionEvent
      | QueuedMessageEvent
      | UnqueuedMessageEvent
      | UserCommandEvent
      | MemoryNoteEvent
      | MemoryLoadedEvent
      | WorkRepliedEvent
      | WorkTakenBackEvent
      | WorkRetitledEvent
      | WorkStatusSetEvent
      | WorkRebriefedEvent
      | WorkClosedEvent
      | WorkSentEvent
      | RequestRoutedEvent
      | QuestionAskedEvent
      | InstructionProposedEvent
      | InstructionChangedEvent
      | InstructionSettledEvent
      | McpServerRequestedEvent
      | WorkInterruptedEvent
      | StopUnansweredEvent
      | RequestInterruptedEvent
      | QuestionWithdrawnEvent
      | RequestEscalatedEvent
      | WorkStallTold
      | ToolRefusedEvent
      | ReplyUndeliveredEvent
      | ReopenedEvent
      | LaunchedEvent
      | ReplacesEvent
      | ReplacedByEvent
      | QuestionRecipientEndedEvent
      | QuestionEndedWithItsPieceEvent
      | RestoredFromTheArchiveEvent,
    at?: number,
    moveHandoff?: object,
    personalHandover?: number,
  ): void {
    if (event.type === 'user_turn') {
      this.aTurnWentIn.add(session)
      session.memoryNotes = noteNamesIn(session.memoryNoteDir) ?? session.memoryNotes
      session.turnOpened = true
      const drives = theDriveOfTheTurn(theMessagesOf(event))
      session.itsTurnDrives =
        event.askedForTheStop === true && session.itsTurnDrives !== drives ? null : drives
      session.aPersonsWordsOpenedIt = theMessagesOf(event).some(aPersonsOwnWords)
      if (session.aPersonsWordsOpenedIt) session.aPersonLastWroteAt = this.now()
    }
    if (event.type === 'user_turn') {
      const { sent } = this.theWordsHandedOverFor(
        session,
        theMessagesOf(event).map((one) => one.text),
      )
      if (sent !== undefined && session.pendingTurnBlock?.words === sent) {
        session.pluginsAsLastSaid = session.pendingTurnBlock.plugins
        session.turnBlockSnapshot = session.pendingTurnBlock.next
        session.itsQuestionsAsLastSaid = session.pendingTurnBlock.questions
        session.whoWaitedAsLastSaid = session.pendingTurnBlock.waiting
        session.pendingTurnBlock = null
      }
      if (sent !== undefined && event.sent === undefined) {
        const kept = withTheLinesKept(sent, session.savedMethodsLines)
        event.sent = kept
        const lead = session.leadJustHandedOver
        if (
          lead !== null &&
          lead.chars <= kept.length &&
          kept.startsWith(LEADS_OPEN_WITH) &&
          event.lead === undefined
        ) {
          event.lead = lead
        }
      }
      session.wordsJustHandedOver = null
      session.wordsItWasHandedFor = []
      session.leadJustHandedOver = null
    }
    if (event.type === 'launched' && session.launchGave !== null) event.given = session.launchGave
    const written = this.recordOurs(session, event, at)
    const committedTurn = written.event
    if (
      committedTurn.type === 'user_turn' &&
      personalHandover === session.personalHandover &&
      session.recordingFailure === null
    ) {
      const parts = theMessagesOf(committedTurn)
      if (
        parts.some((part) =>
          TURN_ATTRIBUTION_KEYS.every((key) => key === 'movedFrom' || part[key] === undefined),
        )
      ) {
        session.personalWorkTurn = this.deps.store.theOpenTurn(session.id)?.id ?? null
      }
    }
    if (moveHandoff !== undefined && session.moveRequestHandoff === moveHandoff) {
      session.moveRequestTurn = null
      session.moveRequestRowPending = false
      const turn = this.deps.store.theOpenTurn(session.id)
      if (
        committedTurn.type === 'user_turn' &&
        session.recordingFailure === null &&
        turn !== null &&
        committedTurn.parts === undefined &&
        TURN_ATTRIBUTION_KEYS.every(
          (key) => key === 'movedFrom' || committedTurn[key] === undefined,
        )
      ) {
        session.moveRequestTurn = { id: turn.id }
      }
    }
    this.emitOurs(session, written)

    if (event.type === 'user_turn' && session.itsWorkWasReadBeforeItsWords) {
      session.itsWorkWasReadBeforeItsWords = false
      try {
        this.sayWhenItsWorkMoved(session.id, this.whatItHolds(session.id))
      } catch (error) {
        console.warn(
          `runtime host could not read what ${session.id} holds as its words landed: ${errorMessage(error)}`,
        )
      }
    }
    if (event.type === 'message_unqueued' && event.reason !== 'sent') {
      this.recordAnAnswerItsGiverNeverGot(session, event)
      queueMicrotask(() => this.askOnceTheQueueLeftItUndriven(session))
    }
  }

  private askOnceTheQueueLeftItUndriven(session: HostedSession): void {
    const slot = this.slots.get(session.id)
    if (slot === undefined || slot.session !== session || onItsWayOut(slot)) return
    this.tellWhoeverGaveTheWork(session.id)
  }

  private recordOurs(
    session: HostedSession,
    event:
      | WorkReconciliationEvent
      | WorkRecoveryEvent
      | MessageSentEvent
      | UserTurnEvent
      | UserDecisionEvent
      | QueuedMessageEvent
      | UnqueuedMessageEvent
      | UserCommandEvent
      | MemoryNoteEvent
      | MemoryLoadedEvent
      | WorkRepliedEvent
      | WorkTakenBackEvent
      | WorkRetitledEvent
      | WorkStatusSetEvent
      | WorkRebriefedEvent
      | WorkClosedEvent
      | WorkSentEvent
      | RequestRoutedEvent
      | QuestionAskedEvent
      | InstructionProposedEvent
      | InstructionChangedEvent
      | InstructionSettledEvent
      | McpServerRequestedEvent
      | WorkInterruptedEvent
      | StopUnansweredEvent
      | RequestInterruptedEvent
      | QuestionWithdrawnEvent
      | RequestEscalatedEvent
      | WorkRestartedEvent
      | WorkStallTold
      | ToolRefusedEvent
      | ReplyUndeliveredEvent
      | ReopenedEvent
      | LaunchedEvent
      | ReplacesEvent
      | ReplacedByEvent
      | QuestionRecipientEndedEvent
      | QuestionEndedWithItsPieceEvent
      | RestoredFromTheArchiveEvent
      | Extract<RuntimeEvent, { type: 'scheduled_work' }>,
    stamped?: number,
  ): RuntimeEventMessage {
    const ordinal = this.takeLedgerOrdinal(session)
    const at = stamped ?? this.now()
    this.record(session, () => this.deps.store.append(session.id, ordinal, event, at))
    this.markWhatWasNotRecorded(session, ordinal, event)
    this.rememberLedgerOrdinal(session, ordinal)
    if (session.recordingFailure === null) this.aScheduleRowWasKept(session.id, ordinal, event, at)
    if (event.type === 'launched' && session.recordingFailure === null) {
      this.noteItsLaunchedRow(session, ordinal)
    }
    return { sessionId: session.id, ordinal, at, event }
  }

  private emitOurs(session: HostedSession, message: RuntimeEventMessage): void {
    if (!session.sink.alive) return
    this.emit(session, message)
    this.reportRecordingFailure(session)
  }

  private emit(session: HostedSession, message: RuntimeEventMessage): void {
    if (session.sentOrdinal !== null && message.ordinal < session.sentOrdinal) {
      console.error(
        `runtime session ${session.id}: ordinal ${message.ordinal} went out after ` +
          `${session.sentOrdinal} — something published from inside another event's window, and ` +
          'this conversation will report it as arriving out of order',
      )
    }
    session.sentOrdinal = Math.max(session.sentOrdinal ?? message.ordinal, message.ordinal)
    session.sink.send(transcriptMessageForDisplay(message))
  }

  async sendInterrupting(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[] = [],
  ): Promise<void> {
    if (!this.runsNow(sessionId) && theSurfaceAsking(by) !== null) {
      return this.send(sessionId, text, by, attachments)
    }
    const session = this.requireToCommand(sessionId, by)
    this.assertMayReach('message', sessionId, by)
    session.holdingQueue += 1
    try {
      let decided: WhatTheGateDecided
      let itsSignInMoved = false
      try {
        decided = await this.assertCanTakeTurn(session, 'send', {
          text,
          attached: attachments.length,
          from: this.originOf(by),
        })
      } catch (error) {
        if (!aPersonIsAsking(by) || !this.aReopenCarriesIt(error, by, session)) throw error
        decided = await this.whatTheseWordsAre(session, {
          text,
          attached: attachments.length,
          from: this.originOf(by),
        })
        itsSignInMoved = true
      }
      const chosen = await recheckHandedPaths(attachments, session.cwd)
      if ('refusal' in chosen) throw new Error(chosen.refusal)
      this.noteUserCommand(sessionId, 'interrupted_to_send', by)
      await this.runSendInterrupting(session, text, attachments, by, decided, itsSignInMoved)
    } finally {
      session.holdingQueue -= 1
      this.stateMayHaveMoved(session.id)
      this.flushQueued(session)
      if (session.holdingQueue === 0) this.tellWhoeverGaveTheWork(session.id)
    }
  }

  private async runSendInterrupting(
    session: HostedSession,
    text: string,
    attachments: readonly HandedPath[],
    by: Caller,
    decided: WhatTheGateDecided,
    itsSignInMoved: boolean,
  ): Promise<void> {
    if (session.handle.status() !== 'idle') {
      const asked = this.askTheWorkToStop(session, by)
      this.sayWhenTheStopGoesUnanswered(session, asked, by)
      asked.catch((error: unknown) => {
        console.warn(`runtime session ${session.id} failed to interrupt: ${errorMessage(error)}`)
      })
      await this.untilIdleOrStopped(session)
      if (this.itStoppedUnder(session)) return this.send(session.id, text, by, attachments)
    }
    if (this.itJoinsWhatWaits(session, text, this.originOf(by))) {
      await this.queueAs(
        session.id,
        text,
        by,
        attachments,
        'work',
        {},
        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
        'with-what-waits',
      )
      return
    }
    if (itsSignInMoved) {
      await this.queueAs(
        session.id,
        text,
        by,
        attachments,
        'work',
        {},
        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
        'after-a-lost-race',
      )
      return
    }
    try {
      await this.assertCanTakeTurn(session, 'send', {
        text,
        attached: attachments.length,
        from: this.originOf(by),
        decided,
      })
    } catch (error) {
      if (!aPersonIsAsking(by) || !this.aReopenCarriesIt(error, by, session)) throw error
      await this.queueAs(
        session.id,
        text,
        by,
        attachments,
        'work',
        {},
        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
        'after-a-lost-race',
      )
      return
    }
    const handed = await recheckHandedPaths(attachments, session.cwd)
    if ('refusal' in handed) throw new Error(handed.refusal)
    const turn: UserTurnEvent = {
      type: 'user_turn',
      text,
      ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),
      ...whoseWordsTheseAre(by, this.profileOf),
    }
    if (
      aPersonIsAsking(by) &&
      sessionSpeakingAs(by) === null &&
      TURN_ATTRIBUTION_KEYS.every((key) => turn[key] === undefined)
    )
      this.declineMoveOffersFromText(session.id, by)
    const moveHandoff = this.beginMoveHandoff(
      session,
      TURN_ATTRIBUTION_KEYS.every((key) => key === 'movedFrom' || turn[key] === undefined),
    )
    const personalWorkTurnBefore = session.personalWorkTurn
    const personalHandover = session.personalHandover + 1
    try {
      await this.handToProvider(
        session,
        text,
        handed.paths,
        null,
        null,
        null,
        this.originOf(by),
        turn,
        decided,
      )
    } catch (error) {
      if (error instanceof TurnInProgress && session.personalHandover === personalHandover)
        session.personalWorkTurn = personalWorkTurnBefore
      if (session.moveRequestHandoff === moveHandoff) session.moveRequestRowPending = false
      if (!(error instanceof TurnInProgress)) throw error
      await this.queueAs(
        session.id,
        text,
        by,
        attachments,
        'work',
        {},
        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
        'after-a-lost-race',
      )
      return
    }
    this.publishStateIfChanged(session)
    this.publishOurs(session, turn, undefined, moveHandoff, personalHandover)
  }

  queueMessage(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[] = [],
    kind: MailboxKind = 'work',
    facts: FactsAQueueCarries = {},
    says: AgentMessageKind = WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,
  ): Promise<QueueOutcome> {
    let now: boolean
    let heldForServices: boolean
    try {
      now = this.takesADeliveryNow(sessionId)
      heldForServices = !now && this.servicesHoldItBack(sessionId, by)
    } catch (error) {
      return Promise.reject(error)
    }
    const deliver = (to: string): Promise<QueueOutcome> =>
      this.queueAs(to, text, by, attachments, kind, facts, says, 'as-it-finds-it')
    if (heldForServices) {
      return this.leaveForTheServicesStart(sessionId, text, by, attachments, kind, facts, says)
    }
    if (now) {
      return this.queueAs(
        sessionId,
        text,
        by,
        attachments,
        kind,
        facts,
        says,
        'as-it-finds-it',
        deliver,
      )
    }
    return this.deliverWhenItRuns(sessionId, text, by, attachments, says, deliver)
  }

  async messageAgentNow(
    sessionId: string,
    text: string,
    by: Caller,
    says: AgentMessageKind,
    facts: FactsAQueueCarries = {},
  ): Promise<MessageNowOutcome> {
    if (!this.mayInterrupt(this.theOneInItsPlace(sessionId), by)) {
      return { ok: false, refusal: 'not-below-you' }
    }
    const delivery = await this.queueMessage(sessionId, text, by, [], 'work', facts, says)
    if (delivery.outcome === 'sent')
      return { ok: true, delivery, stop: 'not-needed', askedOf: null }
    const { stop } = await this.withWhatItsStopLeft({
      stop: this.stopForTheMessageHeldAs(delivery.messageId, by),
    })
    return {
      ok: true,
      delivery,
      stop: stop.stop,
      askedOf: stop.askedOf,
      ...(stop.ended === undefined ? {} : { ended: stop.ended }),
      ...(stop.stillRunning === undefined ? {} : { stillRunning: stop.stillRunning }),
      ...(stop.provider === undefined ? {} : { provider: stop.provider }),
    }
  }

  private stopForTheMessageHeldAs(messageId: string, by: Caller): TheStopItsWordsAsked {
    for (const { session } of this.slots.values()) {
      const waiting = session?.mailbox.find((held) => held.id === messageId)
      if (session !== null && waiting !== undefined) {
        const reach = this.theReachOfACallersWords(session.id, waiting)
        if (reach === 'outlived') return { stop: 'not-below-you', askedOf: null }
        if (reach === 'unknown') return { stop: 'could-not-be-asked', askedOf: null }
        return this.stopTheTurnItWaitsBehind(session, waiting, by)
      }
    }
    return { stop: 'not-needed', askedOf: null }
  }

  private stopForAnAnswer(asker: string, messageId: string, by: Caller): TheStopItsWordsAsked {
    try {
      if (!this.mayInterrupt(asker, by)) return { stop: 'not-below-you', askedOf: null }
    } catch (error) {
      console.warn(`runtime host could not tell who may stop ${asker}: ${errorMessage(error)}`)
      return { stop: 'could-not-be-asked', askedOf: null }
    }
    if (this.aPersonsTurnHolds(messageId)) {
      return { stop: 'a-person-started-its-turn', askedOf: null }
    }
    return this.stopForTheMessageHeldAs(messageId, by)
  }

  private aPersonsTurnHolds(messageId: string): boolean {
    for (const { session } of this.slots.values()) {
      if (session === null || !session.mailbox.some((held) => held.id === messageId)) continue
      if (!session.itsTurnIs.aPersons) return false
      const status = session.handle.status()
      return status === 'working' || status === 'waiting_permission' || session.turnOpened
    }
    return false
  }

  private heldBehindATurn(messageId: string): boolean {
    for (const { session } of this.slots.values()) {
      const waiting = session?.mailbox.find((held) => held.id === messageId)
      if (session === null || waiting === undefined) continue
      if (session.handingOver.includes(waiting)) return false
      return this.aTurnRunsIn(session)
    }
    return false
  }

  private aTurnRunsIn(session: HostedSession): boolean {
    const status = session.handle.status()
    if (status === 'ended' || status === 'errored') return false
    return status !== 'idle' || session.turnOpened
  }

  private theStopForAHeldAnswer(
    asker: string,
    messageId: string | null,
    stopAs: Caller | null,
  ): { readonly stop: TheStopItsWordsAsked | null; readonly held: boolean } {
    const held = messageId !== null && this.heldBehindATurn(messageId)
    if (stopAs === null) return { stop: null, held }
    if (messageId === null || !held || this.whyItWaitsForItsSignIn(asker) !== null) {
      return { stop: { stop: 'not-needed', askedOf: null }, held }
    }
    return { stop: this.stopForAnAnswer(asker, messageId, stopAs), held }
  }

  private stopTheTurnItWaitsBehind(
    session: HostedSession,
    waiting: QueuedMessage,
    by: Caller,
    itsOwnQuestionGoes = false,
  ): TheStopItsWordsAsked {
    const nothingToStop = { stop: 'not-needed', askedOf: null } as const
    const couldNot = { stop: 'could-not-be-asked', askedOf: null } as const
    const slot = this.slots.get(session.id)
    if (slot === undefined || onItsWayOut(slot)) return nothingToStop
    const status = session.handle.status()
    if (status === 'ended' || status === 'errored') return nothingToStop
    if (status === 'idle' && !session.turnOpened) return nothingToStop
    if (session.handingOver.includes(waiting)) return nothingToStop
    if (session.holdingQueue > 0) return { stop: 'a-person-is-replacing-its-turn', askedOf: null }
    if (session.stopStillAsked !== null && status !== 'waiting_permission') {
      return { stop: 'already-asked', askedOf: null }
    }
    let askedOf: string | null = null
    try {
      if (status === 'waiting_permission') {
        askedOf = this.whoOwesIt(
          session.id,
          this.cardReads(),
          rowsUnreadOnce(),
          undefined,
          () => [],
          () => [],
        ).askedOf
      }
    } catch (error) {
      console.warn(
        `runtime session ${session.id}: whose answer it waits on could not be read: ${errorMessage(error)}`,
      )
      return couldNot
    }
    const asking = sessionSpeakingAs(by)
    const itsOwn =
      itsOwnQuestionGoes &&
      (whoDidIt(by).who === 'a-person' ||
        (askedOf !== null && asking !== null && this.theIdsItStandsFor(asking).includes(askedOf)))
    const refusal = itsOwn ? null : admitInterrupt(session.id, status, askedOf)
    if (refusal !== null) {
      if (refusal.rail === 'a-person-is-being-asked') {
        return { stop: 'a-person-is-being-asked', askedOf: null }
      }
      if (refusal.rail === 'it-is-waiting-on-an-answer') {
        return { stop: 'it-is-waiting-on-an-answer', askedOf }
      }
      return couldNot
    }
    waiting.interrupting = { askedBy: this.originOf(by) }
    const ending = this.whatTheStopOfItsTurnEnds(session, this.interruptWaitMs)
    let stopRequest: Promise<void>
    try {
      stopRequest = this.askTheWorkToStop(session, by, true)
    } catch (error) {
      delete waiting.interrupting
      console.warn(
        `runtime session ${session.id} could not be asked to make way: ${errorMessage(error)}`,
      )
      return couldNot
    }
    stopRequest.catch((error: unknown) => {
      delete waiting.interrupting
      console.warn(
        `runtime session ${session.id} could not be asked to make way: ${errorMessage(error)}`,
      )
    })
    try {
      this.sayWhenTheStopGoesUnanswered(session, stopRequest, by)
    } catch (error) {
      console.warn(`runtime session ${session.id}: its stop is not watched: ${errorMessage(error)}`)
    }
    return { stop: 'asked', askedOf: null, stopped: session.id, provider: session.provider, ending }
  }

  private async withWhatItsStopLeft<T extends { readonly stop: TheStopItsWordsAsked | null }>(
    asked: T,
  ): Promise<T> {
    if (asked.stop === null) return asked
    const { ending, stopped, ...said } = asked.stop
    const ended = ending === undefined ? undefined : await ending
    if (ended === undefined || stopped === undefined) return { ...asked, stop: said }
    return { ...asked, stop: { ...said, ended, stillRunning: this.whatStillRunsIn(stopped) } }
  }

  private takesADeliveryNow(sessionId: string): boolean {
    return !this.arrivals.has(sessionId) && this.runsNow(sessionId)
  }

  private runsNow(sessionId: string): boolean {
    const slot = this.slots.get(sessionId)
    if (slot === undefined || slot.session === null || onItsWayOut(slot)) return false
    const status = slot.session.handle.status()
    return status !== 'ended' && status !== 'errored'
  }

  private grantsOf(conversation: string): readonly HeldGrant[] {
    try {
      return this.deps.store.openPiecesOf(conversation).flatMap((row) =>
        row.givenFolder?.use === 'grant' && row.giver !== null
          ? [
              {
                folder: row.givenFolder.folder,
                reaches: filesystemSpelling(row.givenFolder.folder),
                piece: row.piece,
                label: row.label,
                givenBy: row.giver,
                delivered: row.briefHandedOver === true,
              },
            ]
          : [],
      )
    } catch (error) {
      console.warn(
        `runtime host could not read the folders ${conversation} was granted: ${errorMessage(error)}`,
      )
      return []
    }
  }

  private theWorkFoldersFor(
    session: HostedSession,
    carrying: readonly ThePieceATurnCarries[],
  ): string[] {
    session.grants = this.grantsOf(session.id)
    const carried = new Set(carrying.map(({ piece }) => piece))
    const folders = [
      ...session.grants
        .filter((grant) => grant.delivered || carried.has(grant.piece))
        .map((grant) => grant.reaches),
      ...carrying.flatMap(({ grant }) => (grant === undefined ? [] : [filesystemSpelling(grant)])),
    ]
    return [...new Set(folders)]
  }

  private theWorkFoldersALaunchCarries(conversation: string): string[] {
    const folders = this.grantsOf(conversation)
      .filter((grant) => grant.delivered)
      .map((grant) => grant.reaches)
    return [...new Set(folders)]
  }

  private whatAGrantReaches(conversation: string): 'writes' | 'reads' | 'already' {
    const row = this.deps.store.find(conversation)
    if (row?.approvalMode === 'auto') return 'already'
    return row === null ? 'reads' : providerDescriptor(row.provider).approval.grantReach
  }

  private theFolderItGave(
    asked: string | undefined,
    goes: Extract<GiveAdmission, { ok: true }>['goes'],
  ): GivenFolder | null {
    if (asked === undefined || asked.trim() === '') return null
    const given =
      goes.to !== 'a-new-conversation'
        ? goes.grant === null
          ? null
          : { folder: goes.grant, use: 'grant' as const }
        : { folder: goes.start.cwd, use: 'working-folder' as const }
    if (given === null) return null
    const notice = this.aProtectedPlaceFor(given.folder)
    return notice === null ? given : { ...given, notice }
  }

  private aProtectedPlaceFor(folder: string): ProtectedPlaceNotice | null {
    const placeOf = this.deps.protectedPlaceOf
    if (placeOf === undefined) return null
    try {
      return placeOf(folder)
    } catch (error) {
      console.warn(
        `runtime host could not compare ${folder} with the places it names: ${errorMessage(error)}`,
      )
      return { kind: 'could-not-check' }
    }
  }

  private createFromGive(start: AdmittedSpawn, startsOn: ModelAndEffort | null) {
    return this.createSession(
      {
        provider: start.provider,
        cwd: start.cwd,
        approvalMode: start.approvalMode,
        profileId: start.profileId,
        ...(startsOn === null ? {} : { model: startsOn.model }),
        ...(startsOn?.effort == null ? {} : { reasoningEffort: startsOn.effort }),
      },
      null,
      null,
      start,
    )
  }

  async giveWork(input: unknown, by: Caller): Promise<GiveOutcome> {
    const speaking = sessionSpeakingAs(by)
    const asking =
      by === THE_APP_ITSELF || speaking === null
        ? null
        : this.theListAGiveChoosesFrom(input, speaking)
    const choosing = asking === null ? null : await asking
    for (let waited = 0; waited < 3; waited += 1) {
      const starting = this.theServiceStartAGiveMeets(input)
      if (starting === null) break
      await withDeadline(starting, this.deliveryWaitMs, 'a service starting').catch(() => {})
    }
    const giver = speaking === null ? null : this.runningAs(speaking)
    if (by === THE_APP_ITSELF || giver === null) {
      return { ok: false, refusal: refuse('no-piece-to-give-from') }
    }
    let admission = admitGive(
      input,
      by,
      this.giveFacts(by, giver, choosing?.theNamedModels ?? null, choosing?.list.rows ?? []),
    )
    if (!admission.ok) return admission
    let { asked, under, goes } = admission
    let chosen = this.theChoiceOfAGive(asked, goes, choosing)
    if (chosen !== null && !chosen.ok) return { ok: false, refusal: chosen.refusal }
    const kept = this.keptFor(admission.giver, asked.inputs ?? [])
    if (!kept.ok) return { ok: false, refusal: kept.refusal }
    const piece = newWorkId()
    let outputFolder: string | null = null
    if (asked.parallel === true && (asked.folder === undefined || asked.folder.trim() === '')) {
      if (this.deps.makeWorkerPieceFolder === undefined) throw new Error(WORKER_OUTPUT_FAILURE)
      try {
        outputFolder = this.deps.makeWorkerPieceFolder(piece)
      } catch {
        throw new Error(WORKER_OUTPUT_FAILURE)
      }
      admission = admitGive(
        { ...asked, folder: outputFolder },
        by,
        this.giveFacts(by, giver, choosing?.theNamedModels ?? null, choosing?.list.rows ?? []),
      )
      if (!admission.ok) return admission
      ;({ asked, under, goes } = admission)
      chosen = this.theChoiceOfAGive(asked, goes, choosing)
      if (chosen !== null && !chosen.ok) return { ok: false, refusal: chosen.refusal }
    }
    const choice = chosen?.chosen ?? null
    if (goes.to === 'a-new-conversation' && goes.creating !== null) {
      const created = this.deps.store.createAgentIdentity(
        { slug: goes.creating.slug, displayName: null, provider: goes.start.provider },
        goes.creating.by,
      )
      if (created === null) {
        throw new Error(`${goes.creating.slug} was admitted as a new agent and already exists`)
      }
      this.theWorldMoved('agents')
    }
    const number = this.deps.store.numberUnder(under.piece)
    const giving: Giving = {
      piece,
      parent: under.piece,
      number,
      label: `${under.label}.${String(number)}`,
      giver: admission.giver,
      title: asked.title,
      brief: asked.brief,
      definitionOfDone: asked.definition_of_done,
      folder: asked.folder ?? null,
      givenFolder: (() => {
        const folder = this.theFolderItGave(asked.folder, goes)
        return folder === null || outputFolder === null
          ? folder
          : { ...folder, output: true as const }
      })(),
      inputs: kept.files.map((file) => ({
        resource: newResourceId(),
        title: file.title,
        name: file.name,
        sha256: file.sha256,
        bytes: file.bytes.length,
      })),
    }
    const inputs = giving.inputs.map(({ resource, name }) => ({ resource, name }))
    const normal = goes.to === 'a-service' ? null : this.prepareNormalGive(asked, giving, goes)
    try {
      const gaveNothing = (error: unknown): never => {
        throw this.deps.store.workById(giving.piece) === null
          ? new AGiveThatGaveNothing(giving.label, error)
          : error
      }
      let reached: string | null = null
      const applied: { how: WhatItRunsOn['how'] } = { how: 'unchanged' }
      const named = { model: asked.model !== undefined, effort: asked.effort !== undefined }
      const deliver = (
        to: string,
        onAStop?: (to: string) => Promise<QueueOutcome>,
      ): Promise<QueueOutcome> => {
        reached = to
        let switchedFrom: ModelAndEffort | null | undefined
        if (goes.to === 'the-one-it-has' && choice !== null && applied.how !== 'switched') {
          if (this.theProviderOfConversation(to) !== choosing?.provider) {
            applied.how = 'another-provider'
          } else {
            const was = this.thePairItRunsOn(to)
            applied.how = this.switchedFor(to, choice)
            if (applied.how === 'switched') switchedFrom = was
          }
        }
        const queued = this.queueAs(
          to,
          asked.brief,
          by,
          [],
          'work',
          { giving },
          null,
          'as-it-finds-it',
          onAStop,
        )
        if (switchedFrom === undefined || choice === null) return queued
        const wrote = choice
        const was = switchedFrom
        return queued.catch((error: unknown) => {
          this.switchedBack(to, wrote, was)
          applied.how = 'unchanged'
          throw error
        })
      }
      if (goes.to === 'a-service') {
        let service: string
        try {
          if (goes.conversation !== null) service = goes.conversation
          else if (goes.provider === null) throw new Error(`${goes.profileId} has no provider`)
          else service = this.recordTheServiceConversation(goes.profileId, goes.provider)
          this.acceptAtTheService(service, giving, newQueuedMessageId(), choice)
        } catch (error) {
          return gaveNothing(error)
        }
        this.noteWhatItGave(giving.giver, { ...giving, as: 'given', to: service })
        const queueStalledAt = this.whenItsActivePieceStalled(service)
        const judged = this.theProviderOfConversation(service) ?? giver.provider
        return {
          ok: true,
          piece: giving.piece,
          label: giving.label,
          owner: service,
          found: service,
          profile: asked.profile,
          delivery: 'held',
          runsOn: {
            ...this.whatItRunsOnNow(service, judged, 'unchanged', null, named),
            ...(choice === null
              ? {}
              : { model: choice.model, effort: choice.effort, effortReported: false }),
          },
          startedIn: null,
          givenFolder: giving.givenFolder,
          folderNotGranted: goes.notGranted,
          grantReach: null,
          inputs,
          queuedBehind: this.queuedAhead(giving.piece, service) ?? 0,
          ...(queueStalledAt === null ? {} : { queueStalledAt }),
        }
      }
      if (goes.to === 'the-one-it-has') {
        let delivered: QueueOutcome
        try {
          delivered = await this.theBriefTo(goes.conversation, asked.brief, by, deliver)
        } catch (error) {
          return gaveNothing(error)
        }
        const owner = this.deps.store.workById(giving.piece)?.owner ?? reached ?? goes.conversation
        const judged = this.theProviderOfConversation(goes.conversation) ?? giver.provider
        this.noteWhatItGave(giving.giver, { ...giving, as: 'given', to: owner })
        const stalled = this.stallsIn(owner, giving.giver).filter(
          (one) => one.label !== giving.label,
        )
        return {
          ok: true,
          piece: giving.piece,
          label: giving.label,
          owner,
          found: goes.conversation,
          profile: asked.profile,
          ...(asked.parallel === true ? this.workerFields(owner) : {}),
          delivery: delivered.outcome === 'sent' ? 'sent' : 'held',
          runsOn: this.whatItRunsOnNow(owner, judged, applied.how, null, named),
          startedIn: null,
          givenFolder: giving.givenFolder,
          folderNotGranted: goes.notGranted,
          grantReach: goes.grant === null ? null : this.whatAGrantReaches(owner),
          inputs,
          ...(stalled.length === 0 ? {} : { stalled }),
        }
      }
      const { start } = goes
      const startedOnDefault =
        asked.provider === undefined &&
        asked.model === undefined &&
        this.itsProvider(asked.profile).provider === start.provider
      const resolved = this.modelCatalogues.theSelectedPairIfNamed(start.provider, start.profileId)
      const startsOn: ModelAndEffort | null = choice ?? (resolved?.effort == null ? null : resolved)
      const from: WhereItCameFrom = named.model
        ? 'named'
        : (resolved?.from ?? 'the-providers-default')
      this.reservingAStartFrom = giving.parent
      this.reservingNormalWorker =
        normal?.fact === null || normal === null
          ? null
          : { conversation: normal.conversation, fact: normal.fact }
      const starting = this.createFromGive(start, startsOn)
      this.reservingAStartFrom = null
      this.reservingNormalWorker = null
      let sessionId: string
      try {
        ;({ sessionId } = await starting)
      } catch (error) {
        return gaveNothing(error)
      }
      if (normal !== null) {
        try {
          this.completeNormalBirth(normal)
        } catch (error) {
          await this.close(sessionId, THE_APP_ITSELF)
          return gaveNothing(error)
        }
      }
      let delivered: QueueOutcome
      try {
        delivered = await this.theBriefTo(sessionId, asked.brief, by, deliver)
      } catch (error) {
        return gaveNothing(error)
      }
      const owner = this.deps.store.workById(giving.piece)?.owner ?? reached ?? sessionId
      this.noteWhatItGave(giving.giver, { ...giving, as: 'given', to: owner })
      return {
        ok: true,
        piece: giving.piece,
        label: giving.label,
        owner,
        found: sessionId,
        profile: asked.profile,
        ...(asked.parallel === true ? this.workerFields(owner) : {}),
        delivery: delivered.outcome === 'sent' ? 'sent' : 'held',
        runsOn: this.whatItRunsOnNow(owner, start.provider, 'started', from, named),
        startedIn: start.cwd,
        ...(startedOnDefault ? { startedOnDefault: true as const } : {}),
        givenFolder: giving.givenFolder,
        folderNotGranted: null,
        grantReach: null,
        inputs,
      }
    } finally {
      this.finishNormalGive(normal, giving)
    }
  }

  private theListAGiveChoosesFrom(
    input: unknown,
    speaking: string,
  ): Promise<{
    readonly provider: Provider
    readonly list: TheListAsked
    readonly theNamedModels: Provider | null
  } | null> | null {
    const giving = this.runningAs(speaking)
    const parsed = giveRequestSchema.safeParse(input)
    if (giving === null || !parsed.success) return null
    const asked = parsed.data
    const service = asked.new === true ? null : this.theServiceAtAGive(speaking, asked.profile)
    const fixed = service?.is === 'service' ? service.provider : null
    const serviceConflict =
      asked.provider !== undefined && fixed !== null && asked.provider !== fixed
    if (asked.model === undefined && asked.effort === undefined && !serviceConflict) return null
    const known = this.deps.store.capabilitiesOf(asked.profile) !== null
    const resolved =
      fixed ?? theProviderAStartRunsOn(asked, known, giving, this.whatAStartsProviderReads, null)
    const legacy = resolved === null ? this.helperAs(speaking, asked.profile) : null
    const preferred = resolved ?? (legacy === null ? null : this.theProviderOfConversation(legacy))
    const listFor = (provider: Provider) => {
      const found =
        fixed !== null && service?.is === 'service'
          ? service.conversation
          : this.helperAs(speaking, asked.profile, provider)
      const home =
        found === null
          ? known
            ? asked.profile
            : STAND_IN_PROFILE
          : (this.profileOf(found) ?? STAND_IN_PROFILE)
      return this.modelCatalogues.theListFor(provider, home)
    }
    return (async () => {
      const first = preferred === null ? null : await listFor(preferred)
      if (
        asked.provider !== undefined ||
        asked.model === undefined ||
        (first !== null && theListedRow(first.rows, asked.model) !== undefined)
      ) {
        return preferred === null || first === null
          ? null
          : { provider: preferred, list: first, theNamedModels: null }
      }
      const theNamedModels = await this.modelCatalogues.theProviderWhoseListAloneHolds(asked.model)
      const provider =
        fixed ??
        theProviderAStartRunsOn(
          asked,
          known,
          giving,
          this.whatAStartsProviderReads,
          theNamedModels,
        ) ??
        preferred
      if (provider === null) return null
      return {
        provider,
        list: provider === preferred && first !== null ? first : await listFor(provider),
        theNamedModels,
      }
    })()
  }

  private itsProvider(profileSlug: string): ItsProvider {
    return this.modelCatalogues.itsProvider(profileSlug)
  }

  private saveItsProvider(profileSlug: string, starting: Provider): void {
    try {
      const its = this.itsProvider(profileSlug)
      if (its.from === 'saved' || its.from === 'its-conversations-differ') return
      this.deps.store.saveProviderIfNoneIsSaved(profileSlug, its.provider ?? starting)
    } catch (error) {
      console.warn(`runtime host could not keep ${profileSlug}'s provider: ${errorMessage(error)}`)
    }
  }

  private theProviderOfConversation(conversation: string): Provider | null {
    return (
      this.slots.get(conversation)?.session?.provider ??
      this.slots.get(conversation)?.provider ??
      this.deps.store.recordedOne(conversation)?.provider ??
      null
    )
  }

  private stallsIn(conversation: string, giver: string): readonly AStallAGiveNames[] {
    const fromIt = new Set<string | null>(this.theIdsItStandsFor(giver))
    return composeWhatEachPieceIsWaitingOn(
      this.deps.store.openPiecesOf(conversation),
      this.oneWaitReadPerAnswer(),
    ).flatMap((one) =>
      fromIt.has(one.giver) && one.state === 'stalled' && one.stalledBecause !== null
        ? [{ label: one.label, cause: one.stalledBecause }]
        : [],
    )
  }

  private readonly whatAStartsProviderReads: Pick<GiveFacts, 'modelChoiceOf' | 'itsProvider'> = {
    modelChoiceOf: (profileSlug) => this.deps.store.modelChoiceOf(profileSlug),
    itsProvider: (profileSlug) => this.itsProvider(profileSlug),
  }

  private thePairItRunsOn(conversation: string): ModelAndEffort | null {
    const running = this.slots.get(conversation)?.session ?? null
    if (running !== null) {
      const { model, reasoningEffort } = running.handle.settings
      return model.requested === undefined
        ? null
        : { model: model.requested, effort: reasoningEffort.requested ?? null }
    }
    const row = this.deps.store.findLive(conversation)
    return row?.model == null ? null : { model: row.model, effort: row.reasoningEffort }
  }

  private theChoiceOfAGive(
    asked: GiveRequest,
    goes: Extract<GiveAdmission, { ok: true }>['goes'],
    choosing: { readonly provider: Provider; readonly list: TheListAsked } | null,
  ): ReturnType<typeof judgeAnAgentsChoice> | null {
    if (choosing === null) return null
    const at:
      | { readonly made: { readonly provider: Provider; readonly profile: string } }
      | { readonly existing: string } =
      goes.to === 'a-new-conversation'
        ? { made: { provider: goes.start.provider, profile: goes.start.profileId } }
        : goes.to === 'a-service' && goes.conversation === null
          ? { made: { provider: goes.provider ?? choosing.provider, profile: goes.profileId } }
          : { existing: goes.conversation ?? '' }
    const provider =
      'made' in at
        ? at.made.provider
        : (this.theProviderOfConversation(at.existing) ?? choosing.provider)
    if (provider !== choosing.provider) {
      return {
        ok: false,
        refusal: refuseModel('the-provider-moved-meanwhile', { door: 'give', provider }),
      }
    }
    const otherwise =
      'made' in at
        ? (this.modelCatalogues.theSelectedPairIfNamed(provider, at.made.profile) ??
          this.modelCatalogues.theProvidersDefaultIn(choosing.list, provider, asked.effort))
        : (this.thePairItRunsOn(at.existing) ??
          this.modelCatalogues.theSelectedPairIfNamed(provider, this.profileOf(at.existing)) ??
          this.modelCatalogues.theProvidersDefaultIn(choosing.list, provider, asked.effort))
    return judgeAnAgentsChoice(
      {
        ...(asked.model === undefined ? {} : { model: asked.model }),
        ...(asked.effort === undefined ? {} : { effort: asked.effort }),
      },
      provider,
      choosing.list,
      otherwise === null ? null : { model: otherwise.model, effort: otherwise.effort },
      'give',
    )
  }

  private switchedFor(conversation: string, choice: ModelAndEffort): WhatItRunsOn['how'] {
    const now = this.thePairItRunsOn(conversation)
    if (now !== null && sameModel(now.model, choice.model) && now.effort === choice.effort) {
      return 'unchanged'
    }
    if (this.deps.store.whatItRunsOn(conversation)?.aPersonChoseItAt != null) {
      return 'a-person-chose-it'
    }
    this.thePairSetOn(conversation, choice)
    return 'switched'
  }

  private switchedBack(
    conversation: string,
    wrote: ModelAndEffort,
    was: ModelAndEffort | null,
  ): void {
    const now = this.thePairItRunsOn(conversation)
    if (now === null || now.model !== wrote.model || now.effort !== wrote.effort) return
    this.thePairSetOn(conversation, was)
  }

  private thePairSetOn(conversation: string, pair: ModelAndEffort | null): void {
    const running = this.slots.get(conversation)?.session ?? null
    if (running === null) {
      this.deps.store.setModel(conversation, pair?.model ?? null)
      this.deps.store.setReasoningEffort(conversation, pair?.effort ?? null)
      return
    }
    if (pair === null) return
    void running.handle.setModel(pair.model).catch((error: unknown) => {
      console.warn(`give_work: ${conversation} did not take the model: ${errorMessage(error)}`)
    })
    void running.handle.setReasoningEffort(pair.effort ?? undefined).catch((error: unknown) => {
      console.warn(`give_work: ${conversation} did not take the effort: ${errorMessage(error)}`)
    })
    this.record(running, () => this.deps.store.setModel(conversation, pair.model))
    this.record(running, () => this.deps.store.setReasoningEffort(conversation, pair.effort))
  }

  private whatItRunsOnNow(
    conversation: string,
    judged: Provider,
    how: WhatItRunsOn['how'],
    from: WhereItCameFrom | null,
    named: WhatItRunsOn['named'],
  ): WhatItRunsOn {
    const { selected, reported } = this.whatACardSaysItRunsOn(conversation)
    return {
      provider: this.theProviderOfConversation(conversation) ?? judged,
      model: selected?.model ?? null,
      effort: selected?.effort ?? null,
      effortReported:
        selected?.effort != null && reported !== null && reported.effort === selected.effort,
      how,
      from,
      named,
    }
  }

  async takeOnWork(input: unknown, by: Caller): Promise<TakeOnWorkOutcome> {
    const parsed = takeOnWorkRequestSchema.safeParse(input)
    const malformed = (problems: readonly string[]): TakeOnWorkOutcome => ({
      ok: false,
      rail: 'malformed-request',
      detail: { problems },
    })
    if (!parsed.success) {
      return {
        ok: false,
        rail: 'malformed-request',
        detail: workRequestRefused(
          parsed.error.issues,
          input,
          Object.keys(takeOnWorkRequestSchema.shape),
        ),
      }
    }
    const asked = parsed.data
    const speaking = sessionSpeakingAs(by)
    const session = speaking === null ? null : (this.slots.get(speaking)?.session ?? null)
    if (
      session === null ||
      session.personalWorkTurn === null ||
      (session.handle.status() !== 'working' && session.handle.status() !== 'waiting_permission')
    )
      return { ok: false, rail: 'no-work-of-your-own', detail: {} }
    let parent: WorkRow | null
    let giver: string | null
    try {
      const opening = this.deps.store.recordedTurnOpening(session.id, session.personalWorkTurn)
      if (
        opening === null ||
        !theMessagesOf(opening).some((part) =>
          TURN_ATTRIBUTION_KEYS.every((key) => key === 'movedFrom' || part[key] === undefined),
        )
      )
        return { ok: false, rail: 'no-work-of-your-own', detail: {} }
      const unread = rowsUnreadOnce()
      const owned = this.deps.store.piecesOwnedBy(session.id, unread)
      if (unread.count > 0 || unread.ledgersSkipped > 0) throw new Error('unread work')
      const root = this.deps.store.rootOf(session.id)
      if (asked.piece !== undefined) {
        parent = this.pieceNamed(asked.piece)
        if (parent === null || parent.owner !== session.id)
          return malformed(['That parent is not work you hold.'])
      } else if (this.itIsAService(session.id)) {
        const active = owned.filter(
          (piece) => TASK_IS_OPEN[piece.state] && !this.queuedAtAService(piece),
        )
        if (active.length > 1)
          return malformed(['Your current work is unclear. Name the parent in piece.'])
        parent = active.length === 1 ? this.deps.store.workById(active[0]!.piece) : root
      } else if (root !== null && this.theParentInItsPlace(session.id) === null) parent = root
      else {
        const personParts = theMessagesOf(opening).filter((part) =>
          TURN_ATTRIBUTION_KEYS.every((key) => key === 'movedFrom' || part[key] === undefined),
        )
        const driven = new Set(personParts.flatMap((part) => part.drives ?? part.piece ?? []))
        const explicit =
          driven.size === 1
            ? owned.find((piece) => driven.has(piece.piece) && piece.briefHandedOver === true)
            : undefined
        const open = owned.filter(
          (piece) => TASK_IS_OPEN[piece.state] && piece.briefHandedOver === true,
        )
        const given = open.filter((piece) => piece.giver !== null)
        if (explicit !== undefined) parent = this.deps.store.workById(explicit.piece)
        else if (given.length > 1)
          return malformed([
            `Say which of your pieces this is for (${labelsSaid(given.map((piece) => piece.label))}): name it in piece.`,
          ])
        else if (given.length === 1) parent = this.deps.store.workById(given[0]!.piece)
        else if (root !== null) parent = root
        else if (open.length > 1)
          return malformed(['Your current work is unclear. Name the parent in piece.'])
        else parent = open.length === 1 ? this.deps.store.workById(open[0]!.piece) : null
      }
      giver =
        parent !== null && parent.parent !== null
          ? parent.givenBy
          : this.itIsAService(session.id)
            ? null
            : this.theParentInItsPlace(session.id)
    } catch {
      return { ok: false, rail: 'work-record-unavailable', detail: {} }
    }
    const kept = this.keptFor(session.id, asked.inputs ?? [])
    if (!kept.ok) return { ok: false, resourceRefusal: kept.refusal }
    const queued = this.itIsAService(session.id)
    if (session.recordingFailure !== null) throw new Error('personal work is not being recorded')
    const recorded = this.deps.store.atomically(() => {
      parent ??= this.deps.store.ensurePersonalRoot(session.id, this.now())
      const number = this.deps.store.numberUnder(parent.piece)
      const taking: ThePieceWrittenDown = {
        piece: newWorkId(),
        parent: parent.piece,
        number,
        label: `${parent.label}.${String(number)}`,
        giver: null,
        title: asked.title,
        brief: asked.brief,
        definitionOfDone: asked.definition_of_done,
        folder: null,
        givenFolder: null,
        inputs: kept.files.map((file) => ({
          resource: newResourceId(),
          title: file.title,
          name: file.name,
          sha256: file.sha256,
          bytes: file.bytes.length,
        })),
      }
      const messageId = queued ? newQueuedMessageId() : null
      const event: WorkGivenEvent = {
        type: 'work_given',
        piece: taking.piece,
        label: taking.label,
        parent: taking.parent,
        givenBy: taking.giver,
        title: taking.title,
        brief: taking.brief,
        definitionOfDone: taking.definitionOfDone,
        ...(messageId === null ? {} : { messageId }),
      }
      const ordinal = Math.max(session.ordinal, this.deps.store.nextOrdinal(session.id))
      const at = this.now()
      this.deps.store.recordGive(
        {
          piece: taking.piece,
          parent: taking.parent,
          number: taking.number,
          owner: session.id,
          givenBy: taking.giver,
          title: taking.title,
          brief: taking.brief,
          folder: null,
          inputs: taking.inputs,
        },
        ordinal,
        event,
        at,
      )
      return { taking, entry: { sessionId: session.id, ordinal, at, event } }
    })
    const { taking, entry } = recorded
    session.ordinal = Math.max(session.ordinal, entry.ordinal + 1)
    this.emitOurs(session, entry)
    this.theWorldMoved('work')
    let notice: 'sent' | 'held' | 'not-delivered' | null = null
    if (giver !== null) {
      try {
        const delivery = await this.queueMessage(
          this.theOneInItsPlace(giver),
          `The person gave ${this.whatToCallTheConversation(session.id)} new work: ${taking.title}.`,
          THE_APP_ITSELF,
          [],
          'notice',
          { appNotice: 'a-person-gave-new-work' },
          'note',
        )
        notice = delivery.outcome === 'sent' ? 'sent' : 'held'
      } catch {
        notice = 'not-delivered'
      }
    }
    if (queued) this.aServiceMayTakeItsNext(session.id)
    return {
      ok: true,
      piece: taking.piece,
      label: taking.label,
      title: taking.title,
      root: parent!.label,
      notice,
      queued,
    }
  }

  private async theBriefTo(
    conversation: string,
    brief: string,
    by: Caller,
    deliver: (to: string, onAStop?: (to: string) => Promise<QueueOutcome>) => Promise<QueueOutcome>,
  ): Promise<QueueOutcome> {
    try {
      if (this.takesADeliveryNow(conversation)) {
        return await deliver(conversation, (to) => deliver(to))
      }
      return await this.deliverWhenItRuns(conversation, brief, by, [], null, deliver)
    } catch (error) {
      const vanished =
        !(error instanceof AStartThatDidNotHappen) &&
        this.slots.get(conversation) === undefined &&
        this.deps.store.recordedOne(conversation) === null
      throw new ABriefThatDidNotArrive(
        conversation,
        vanished
          ? new AStartThatDidNotHappen(
              new SessionUnavailable('not-recorded', `no resumable session: ${conversation}`),
            )
          : error,
      )
    }
  }

  private giveFacts(
    by: Caller,
    giving: GivingConversation,
    theNamedModels: Provider | null,
    models: readonly { readonly id: string }[],
  ): GiveFacts {
    return {
      giver: () => giving,
      held: (giver) => this.heldBy(giver),
      drivenByTheTurn: () => {
        const session = this.slots.get(giving.sessionId)?.session ?? null
        return session !== null && session.turnOpened ? session.itsTurnDrives : null
      },
      isAHelper: () => this.theParentInItsPlace(giving.sessionId) !== null,
      mayGiveWork: () => this.mayReachAtAll('assign', by),
      depthOf: (piece) => this.deps.store.depthOf(piece),
      capabilitiesOf: (profileSlug) => this.deps.store.capabilitiesOf(profileSlug),
      helperAs: (giver, profileSlug, provider) => this.helperAs(giver, profileSlug, provider),
      workerAt: (giver, profileSlug, parallel, provider) => {
        const selected = this.normalWorkerAt(giver, profileSlug, parallel, provider)
        if (selected.is === 'legacy') return { is: 'legacy' }
        if (selected.is === 'full') return selected
        if (selected.is !== 'known') return { is: 'unknown' }
        return {
          is: 'known',
          conversation:
            selected.selection.kind === 'existing'
              ? this.currentNormalWorker(selected.selection.worker)
              : null,
        }
      },
      serviceAt: (giver, profileSlug) => this.theServiceAtAGive(giver, profileSlug),
      spawningEnabled: () => this.deps.store.spawnPolicy().spawningEnabled,
      mayCreateAgents: () => {
        const may = this.mayCreateAgents(giving.sessionId)
        return may.ok ? may.creator : null
      },
      itsProvider: (profileSlug) => this.itsProvider(profileSlug),
      theNamedModelsProvider: () => theNamedModels,
      serviceModels: () => models.map(({ id }) => id),
      modelChoiceOf: (profileSlug) => this.deps.store.modelChoiceOf(profileSlug),
      checkFolder: (path) => this.checkCwd(path),
    }
  }

  private prepareNormalGive(
    asked: GiveRequest,
    giving: Giving,
    goes: Exclude<Extract<GiveAdmission, { ok: true }>['goes'], { to: 'a-service' }>,
  ): {
    identity: string
    createdAt: number
    poolGiver: string
    conversation: string
    number: number
    fact: WorkerBorn | null
    release: () => void
  } | null {
    const provider =
      goes.to === 'a-new-conversation'
        ? goes.start.provider
        : (this.theProviderOfConversation(goes.conversation) ?? undefined)
    const selected = this.normalWorkerAt(
      giving.giver,
      asked.profile,
      asked.parallel === true,
      provider,
    )
    if (selected.is !== 'known') {
      if (asked.parallel !== true) return null
      throw new Error('No work was given because the worker could not be recorded.')
    }
    if (asked.parallel !== true && goes.to === 'the-one-it-has') return null
    let entry = selected.entry
    const pool = selected.pool
    if (pool !== null && !(entry.workerPools ?? []).includes(pool)) {
      entry = { ...entry, workerPools: [...(entry.workerPools ?? []), pool] }
    }
    const selection = selected.selection
    if (selection.kind !== 'existing' && selection.kind !== 'start') {
      throw new Error('No work was given because the worker could not be recorded.')
    }
    const newborn = selection.kind === 'start'
    const conversation = newborn ? this.deps.newSessionId() : selection.worker.conversation
    const number = newborn ? selection.number : selection.worker.number
    if (
      (goes.to === 'the-one-it-has' &&
        (selection.kind !== 'existing' ||
          this.currentNormalWorker(selection.worker) !== goes.conversation)) ||
      (goes.to === 'a-new-conversation' && !newborn)
    ) {
      throw new Error('No work was given because the worker could not be recorded.')
    }
    const release = this.normalWorkerLeases.take(conversation)
    if (release === null)
      throw new Error('No work was given because the worker could not be recorded.')
    try {
      if (newborn) {
        const reserved = reserveNormalWorker(entry, selected.poolGiver, number, conversation)
        if (reserved === null)
          throw new Error('No work was given because the worker could not be recorded.')
        entry = reserved
      }
      const assigned = assignNormalWorker(entry, selected.poolGiver, conversation, {
        piece: giving.piece,
        giver: giving.giver,
      })
      if (assigned === null)
        throw new Error('No work was given because the worker could not be recorded.')
      this.keepTheProfileEntry(selected.identity.id, assigned, true)
    } catch (error) {
      release()
      throw error
    }
    const fact = newborn
      ? {
          conversation,
          identity: selected.identity.id,
          identityCreatedAt: selected.identity.createdAt,
          giver: selected.poolGiver,
          number,
        }
      : null
    if (fact !== null) this.normalWorkerBirths.set(conversation, fact)
    return {
      identity: selected.identity.id,
      createdAt: selected.identity.createdAt,
      poolGiver: selected.poolGiver,
      conversation,
      number,
      fact,
      release,
    }
  }

  private completeNormalBirth(
    normal: NonNullable<ReturnType<RuntimeHost['prepareNormalGive']>>,
  ): void {
    if (normal.fact === null) return
    const born = this.deps.store
      .workersBorn()
      .filter((one) => one.conversation === normal.conversation)
    const session = this.slots.get(normal.conversation)?.session
    if (
      born.length !== 1 ||
      born[0]!.identity !== normal.identity ||
      born[0]!.number !== normal.number ||
      born[0]!.giver !== normal.poolGiver ||
      session === undefined ||
      session === null ||
      session.recordingFailure !== null
    ) {
      throw new Error('No work was given because the worker could not be recorded.')
    }
    const read = this.profileExecution
    const entry = read.readable ? read.kept.profiles[normal.identity] : undefined
    const bound =
      entry === undefined
        ? null
        : bindNormalWorker(entry, normal.poolGiver, normal.number, normal.conversation)
    if (bound === null)
      throw new Error('No work was given because the worker could not be recorded.')
    this.keepTheProfileEntry(normal.identity, bound, true)
  }

  private finishNormalGive(
    normal: ReturnType<RuntimeHost['prepareNormalGive']>,
    giving: Giving,
  ): void {
    if (normal === null) return
    normal.release()
    this.normalWorkerBirths.delete(normal.conversation)
    try {
      const read = this.profileExecution
      const entry = read.readable ? read.kept.profiles[normal.identity] : undefined
      if (entry === undefined || entry.identityCreatedAt !== normal.createdAt) return
      if (
        this.normalAssignmentAccepted(normal.conversation, {
          piece: giving.piece,
          giver: giving.giver,
        })
      ) {
        this.keepTheProfileEntry(
          normal.identity,
          releaseNormalAssignment(entry, normal.poolGiver, normal.conversation, giving.piece),
          true,
        )
      } else if (
        normal.fact !== null &&
        this.deps.store.recordedOne(normal.conversation) === null &&
        !this.slots.has(normal.conversation)
      ) {
        this.takeTheProfileExecution()
      }
    } catch (error) {
      console.warn(`worker assignment remains held: ${errorMessage(error)}`)
    }
  }

  private completeWorkerTerminal(birth: string): string {
    const terminal = this.deps.store.workerInItsPlace(birth)
    for (const known of [birth, terminal]) {
      if (this.replacedBy.has(known) && this.theOneInItsPlace(known) !== terminal) {
        throw new Error('worker ownership is unreadable')
      }
    }
    return terminal
  }

  private currentNormalWorker(worker: NormalWorkerBinding): string {
    const { phase: bindingPhase } = worker
    if (bindingPhase === 'reserved' && this.deps.store.recordedOne(worker.conversation) === null) {
      const slot = this.slots.get(worker.conversation)
      const fact = this.normalWorkerBirths.get(worker.conversation)
      if (slot === undefined || onItsWayOut(slot) || fact?.number !== worker.number) {
        throw new Error('the worker reservation no longer owns a start')
      }
      return worker.conversation
    }
    return this.completeWorkerTerminal(worker.conversation)
  }

  private normalWorkerLineage(worker: NormalWorkerBinding): readonly string[] {
    const current = this.currentNormalWorker(worker)
    return this.deps.store.recordedOne(worker.conversation) === null
      ? [current]
      : this.deps.store.workerLineage(worker.conversation)
  }

  private normalWorkerAt(
    giver: string,
    profile: string,
    parallel: boolean,
    provider?: Provider,
  ):
    | { readonly is: 'legacy' | 'unknown' }
    | { readonly is: 'full'; readonly noProvider?: true }
    | {
        readonly is: 'known'
        readonly identity: AgentIdentity
        readonly entry: ProfileExecution
        readonly pool: NormalWorkerPool | null
        readonly selection: WorkerSelection
        readonly poolGiver: string
      } {
    try {
      const read = this.profileExecution
      if (parallel && (!read.readable || this.deps.profileExecution?.owned !== true))
        return { is: 'unknown' }
      const roster = this.deps.store.agentIdentities()
      const identity = roster.find((one) => one.slug === foldProfileName(profile))
      if (identity === undefined) return { is: 'legacy' }
      const kind = kindOf(read, this.profileExecutionConflicts, identity.id, identity.createdAt)
      if (kind === 'unknown') {
        if (
          !parallel &&
          !(read.readable && (read.kept.profiles[identity.id]?.workerPools?.length ?? 0) > 0) &&
          !this.deps.store.workersBorn().some((worker) => worker.identity === identity.id)
        ) {
          return { is: 'legacy' }
        }
        return { is: 'unknown' }
      }
      if (kind === 'service') return { is: 'legacy' }
      const saved = read.readable ? read.kept.profiles[identity.id] : undefined
      const entry: ProfileExecution =
        saved?.identityCreatedAt === identity.createdAt
          ? saved
          : { kind: 'normal', identityCreatedAt: identity.createdAt }
      const pools = (entry.workerPools ?? []).filter((pool) =>
        this.deps.store.workerGiverContains(pool.giver, giver),
      )
      if (pools.length > 1) return { is: 'unknown' }
      let pool = pools[0] ?? null
      if (pool?.removing === true) return { is: 'unknown' }
      if (pool === null && !parallel) return { is: 'legacy' }
      let poolGiver = pool?.giver ?? giver
      if (pool === null) {
        const legacy = this.legacyHelperAs(giver, profile)
        if (legacy !== null) {
          const parent =
            this.deps.store.parentOf(legacy) ?? this.slots.get(legacy)?.spawnedBy ?? null
          if (parent === null || !this.deps.store.workerGiverContains(parent, giver))
            return { is: 'unknown' }
          poolGiver = parent
          pool = {
            giver: parent,
            nextNumber: 2,
            workers: [
              {
                number: 1,
                conversation: legacy,
                phase: this.deps.store.recordedOne(legacy) === null ? 'reserved' : 'bound',
              },
            ],
          }
        }
      }
      const providers = new Map<string, Provider | null>()
      for (const worker of pool?.workers ?? []) {
        providers.set(
          worker.conversation,
          this.theProviderOfConversation(this.currentNormalWorker(worker)),
        )
      }
      if (!parallel && provider !== undefined && pool !== null) {
        const bound = pool.workers.flatMap((worker) => [
          worker.conversation,
          ...this.normalWorkerLineage(worker),
        ])
        if (this.legacyHelperAs(giver, profile, provider, bound) !== null) return { is: 'legacy' }
      }
      const budget = { rowsLeft: 8192, bytesLeft: 8 * 1024 * 1024 }
      const snapshots = new Map<string, ReturnType<SessionStore['workerLedger']>>()
      const snapshot = (id: string): ReturnType<SessionStore['workerLedger']> => {
        if (snapshots.has(id)) return snapshots.get(id)!
        const read = this.deps.store.workerLedger(id, budget)
        snapshots.set(id, read)
        return read
      }
      const selection = selectNormalWorker(
        pool,
        parallel,
        (conversation) => this.freeForNormalWork(conversation, roster, snapshot),
        (conversation) => this.normalWorkerLeases.has(conversation),
        (conversation) => provider === undefined || providers.get(conversation) === provider,
      )
      if (selection.kind === 'unknown') return { is: 'unknown' }
      if (selection.kind === 'full') {
        const noProvider =
          provider !== undefined &&
          !pool?.workers.some((one) => providers.get(one.conversation) === provider)
        return { is: 'full', ...(noProvider ? { noProvider: true as const } : {}) }
      }
      return { is: 'known', identity, entry, pool, selection, poolGiver }
    } catch {
      return { is: 'unknown' }
    }
  }

  private helperAs(giver: string, profile: string, provider?: Provider): string | null {
    const selected = this.normalWorkerAt(giver, profile, false, provider)
    if (selected.is === 'legacy') {
      const identity = this.deps.store
        .agentIdentities()
        .find((one) => one.slug === foldProfileName(profile))
      const read = this.profileExecution
      const pools =
        identity === undefined || !read.readable
          ? []
          : (read.kept.profiles[identity.id]?.workerPools ?? [])
      const bound = pools
        .filter((pool) => this.deps.store.workerGiverContains(pool.giver, giver))
        .flatMap((pool) =>
          pool.workers.flatMap((worker) => [
            worker.conversation,
            ...this.normalWorkerLineage(worker),
          ]),
        )
      return this.legacyHelperAs(giver, profile, provider, bound)
    }
    if (selected.is !== 'known' || selected.selection.kind !== 'existing') return null
    return this.currentNormalWorker(selected.selection.worker)
  }

  private freeForNormalWork(
    birth: string,
    roster: readonly AgentIdentity[],
    snapshot: (id: string) => ReturnType<SessionStore['workerLedger']>,
  ): boolean {
    try {
      if (!this.cutsAreReadable) return false
      const lineage = this.deps.store.workerLineage(birth)
      if (lineage.length === 0 || lineage.length > 64) return false
      const conversation = lineage.at(-1)!
      if (
        this.archived.has(conversation) ||
        this.settingAside.has(conversation) ||
        this.startsInFlight.has(conversation) ||
        this.firstMessagesInFlight.has(conversation) ||
        this.arrivals.has(conversation)
      )
        return false
      for (const id of lineage) {
        const cut = this.cutsKept.cuts[id]
        if (cut !== undefined && !isFinal(cut.state)) return false
      }
      if (
        [...this.slots.values()].some(
          (one) =>
            one.replaces !== null &&
            lineage.includes(one.replaces) &&
            (one.session === null || onItsWayOut(one)),
        )
      )
        return false
      const slot = this.slots.get(conversation)
      if (slot !== undefined && (slot.session === null || onItsWayOut(slot))) return false
      const session = slot?.session ?? null
      if (
        session !== null &&
        (session.recordingFailure !== null ||
          session.turnOpened ||
          session.stopping !== null ||
          session.stopStillAsked !== null ||
          session.flushing !== null ||
          session.handingOver.length > 0 ||
          session.mailbox.length > 0 ||
          session.holdingQueue !== 0 ||
          this.somethingIsOnItsWayTo(session) ||
          this.stopsOnTheirWay.has(session) ||
          this.itStoppedUnder(session) ||
          session.handle.status() !== 'idle' ||
          session.handle.settings.planMode.effective ||
          session.handle.settings.planMode.requested ||
          somethingRunning(session.background) ||
          scheduleHeld(session.scheduled))
      )
        return false
      const row = this.deps.store.recordedOne(conversation)
      if (row === null) return false
      const stopped = session === null ? this.deps.store.find(conversation) : null
      if (
        session === null &&
        (stopped === null || (stopped.planMode === true && stopped.planEndedAt === null))
      )
        return false
      const unread = rowsUnreadOnce()
      for (const id of lineage) {
        const ledger = snapshot(id)
        if (ledger === null) return false
        const rules = this.deps.store.instructionAsksWaitingIn(id, unread)
        if (rules === null || rules.length > 0) return false
        const proposals = ledger.filter(
          (row) =>
            row.event.type === 'mcp_server_requested' ||
            row.event.type === 'mcp_server_request_settled',
        )
        if (
          proposals.some(({ event }) => {
            if (
              !('requestId' in event) ||
              typeof event.requestId !== 'string' ||
              event.requestId.length === 0
            )
              return true
            if (event.type === 'mcp_server_request_settled')
              return !isMcpServerRequestEnding(event.ending)
            return (
              event.type !== 'mcp_server_requested' ||
              typeof event.name !== 'string' ||
              typeof event.url !== 'string' ||
              typeof event.reaches !== 'string' ||
              typeof event.requestedBy !== 'string' ||
              (event.whoGetsIt !== 'everyone' &&
                (event.whoGetsIt !== 'only-these-agents' ||
                  !Array.isArray(event.agents) ||
                  event.agents.some((agent) => typeof agent !== 'string')))
            )
          })
        )
          return false
        if (
          mcpServerRequestsWaiting(
            proposals.map((row) => ({
              conversation: id,
              at: row.at,
              event: row.event as McpServerRequestedEvent | McpServerRequestSettledEvent,
            })),
          ).length > 0
        )
          return false
        const children = this.deps.store.turnBlockCandidates(id, 257)
        if (children === null || children.length > 256) return false
        const owners = [...new Set(children.map((child) => child.owner))]
        if (owners.length > 32 || owners.some((owner) => snapshot(owner) === null)) return false
        if (
          this.deps.store
            .turnBlockPiecesOwnedBy(id, unread)
            .some((piece) => TASK_IS_OPEN[piece.state]) ||
          this.deps.store.piecesGivenBy(id, unread).some((piece) => TASK_IS_OPEN[piece.state]) ||
          this.deps.store
            .routedRequestsOf(id, unread)
            .some((request) => REQUEST_IS_OPEN[request.state]) ||
          this.deps.store.messagesWaitingIn(id, unread, 4096).length > 0
        )
          return false
      }
      const targets = this.deps.store.workerQuestionTargets()
      if (targets === null) return false
      const askers = [
        ...new Set(
          targets
            .filter((target) => lineage.includes(target.recipient))
            .map((target) => target.asker),
        ),
      ]
      if (askers.length > 32) return false
      for (const asker of askers) {
        if (snapshot(asker) === null) return false
        const open = this.deps.store.routedRequestsOf(asker, unread)
        if (
          open.some(
            (request) =>
              REQUEST_IS_OPEN[request.state] &&
              request.parent !== null &&
              lineage.includes(request.parent),
          )
        )
          return false
      }
      const ledgers = this.oneLedgerReadPerAnswer(unread)
      const state = this.stateOf(
        conversation,
        { roster, askingForRules: new Set(), asksUnread: 0 },
        unread,
        ledgers(conversation),
        this.oneWorkOutReadPerAnswer(unread),
        this.oneOwedReadPerAnswer(ledgers),
      )
      return state.is === 'idle' && unread.count === 0 && unread.ledgersSkipped === 0
    } catch {
      return false
    }
  }

  private legacyHelperAs(
    giver: string,
    profileSlug: string,
    provider?: Provider,
    except: readonly string[] = [],
  ): string | null {
    const wanted = foldProfileName(profileSlug)
    const parents = this.theIdsItStandsFor(giver)
    const theirs = new Set(parents)
    const excluded = new Set(except)
    const reserved = [...this.slots.values()].find((slot) => {
      if (excluded.has(slot.id)) return false
      if (slot.spawnedBy === null || !theirs.has(slot.spawnedBy)) return false
      if (provider !== undefined && slot.provider !== provider) return false
      const identity = slot.profileId ?? slot.session?.profileId ?? null
      return identity !== null && foldProfileName(identity) === wanted
    })
    const found =
      reserved?.id ?? this.deps.store.newestChildAs(parents, profileSlug, provider, except)
    return found === null ? null : this.theOneInItsPlace(found)
  }

  private heldBy(conversation: string): readonly HeldPiece[] {
    const root = this.deps.store.rootOf(conversation)
    return [
      ...(root === null
        ? []
        : [{ piece: root.piece, label: root.label, giver: null, root: true, received: true }]),
      ...this.deps.store.openPiecesOf(conversation).map((one) => ({
        piece: one.piece,
        label: one.label,
        giver: one.giver,
        root: false,
        received: !this.itsGiveStillWaits(one),
      })),
    ]
  }

  pieceNamed(spelled: string): WorkRow | null {
    return this.deps.store.workByLabel(spelled) ?? this.deps.store.workById(spelled)
  }

  whatAPieceIsTo(sender: string, agent: string, spelled: string): WhatAPieceIsToIt {
    const row = this.pieceNamed(spelled)
    if (row === null) return { is: 'none' }
    if (row.givenBy !== null && this.theIdsItStandsFor(sender).includes(row.givenBy)) {
      return {
        is:
          this.theOneInItsPlace(row.owner) === this.theOneInItsPlace(agent)
            ? this.itWaitsQueuedThere(row)
              ? 'queued-there'
              : 'given-to-it'
            : 'given-to-another',
        piece: row.piece,
        label: row.label,
      }
    }
    if (this.heldBy(sender).some((one) => one.piece === row.piece)) {
      return { is: row.parent === null ? 'its-root' : 'held', piece: row.piece, label: row.label }
    }
    if (row.owner === sender) {
      return { is: 'held-and-ended', piece: row.piece, label: row.label }
    }
    return { is: 'none' }
  }

  private whatAWaitIsOn(
    asked: WaitOnAsked,
    row: WorkRow,
    caller: string,
  ): { readonly ok: true; readonly on: WaitOn } | { readonly ok: false; readonly problem: string } {
    const no = (problem: string) => ({ ok: false as const, problem })
    const itsRequest = (id: string): RoutedRequest | null => {
      for (const one of new Set([
        ...this.theIdsItStandsFor(caller),
        ...this.theIdsItStandsFor(row.owner),
      ])) {
        const found = this.deps.store.routedRequestsOf(one).find((each) => each.requestId === id)
        if (found !== undefined) return found
      }
      return null
    }
    if (asked.agent !== undefined) {
      const found = this.pieceNamed(asked.agent)
      const named =
        found !== null &&
        (this.mayNameThePiece(found, caller) || this.mayNameThePiece(found, row.owner))
          ? found
          : null
      if (named !== null) {
        if (named.piece === row.piece)
          return no('on.agent names this piece: a piece cannot wait on itself')
        const folded =
          named.parent === null
            ? null
            : this.deps.store.piecesOwnedBy(named.owner).find((one) => one.piece === named.piece)
        if (folded !== null && (folded === undefined || !TASK_IS_OPEN[folded.state])) {
          return no(
            `on.agent names ${named.label}, which has ended: say what the piece waits on now`,
          )
        }
        if (this.theOneInItsPlace(named.owner) === this.theOneInItsPlace(row.owner)) {
          return no(
            `on.agent names ${named.label}, which this piece's holder holds too: an agent cannot wait on itself. Name what ${named.label} waits on instead, or set the status without on`,
          )
        }
        return { ok: true, on: { kind: 'agent', piece: named.piece, label: named.label } }
      }
      const request = itsRequest(asked.agent)
      if (request === null) {
        return no(
          `on.agent names no open piece and no question you asked: name a piece by its label, or ask with ask_question and name the question's id`,
        )
      }
      if (request.went.to === 'a-person') {
        return no(`on.agent names a question that waits on a person: name it as on.person`)
      }
      if (!REQUEST_IS_OPEN[request.state]) {
        return no(
          `on.agent names a question that is no longer open: say what the piece waits on now`,
        )
      }
      return { ok: true, on: { kind: 'agent', request: request.requestId } }
    }
    if (asked.person !== undefined) {
      const request = itsRequest(asked.person)
      if (request === null) {
        return no(
          'on.person names no question you asked: a question in your reply is not a request, so ask with ask_question(who_answers: a-person), or ask them to do something with request_action, first and name its id',
        )
      }
      if (request.went.to !== 'a-person') {
        return no(`on.person names a question that waits on an agent: name it as on.agent`)
      }
      if (!REQUEST_IS_OPEN[request.state]) {
        return no(
          `on.person names a question that is no longer open: say what the piece waits on now`,
        )
      }
      return { ok: true, on: { kind: 'person', request: request.requestId } }
    }
    if (asked.time !== undefined) {
      const at = Date.parse(asked.time)
      const now = this.now()
      if (!/^\d{4}-\d{2}-\d{2}T/.test(asked.time) || Number.isNaN(at)) {
        return no('on.time must be a date and time, such as 2026-10-15T09:00:00Z')
      }
      if (at <= now) return no('on.time is not ahead: name a time that is still to come')
      if (at > now + A_WAIT_ENDS_WITHIN_MS) {
        return no('on.time is more than 30 days ahead: name a time within 30 days')
      }
      return { ok: true, on: { kind: 'time', at } }
    }
    const event = asked.event
    if (event === undefined) return no('on must name agent, person, time or event')
    const session = this.slots.get(row.owner)?.session ?? null
    const background = session?.background ?? NOTHING_IN_THE_BACKGROUND
    const scheduled = session?.scheduled ?? this.wakeUps.get(row.owner)?.level ?? NOTHING_SCHEDULED
    if (background.running.some((one) => one.id === event)) {
      return { ok: true, on: { kind: 'event', background: event } }
    }
    if (scheduled.jobs.some((one) => one.id === event)) {
      return { ok: true, on: { kind: 'event', job: event } }
    }
    return no(
      'on.event names no scheduled job or background task running in the conversation holding the piece: name one of its ids',
    )
  }

  private mayNameThePiece(row: WorkRow, sessionId: string): boolean {
    const giver = row.givenBy
    if (row.owner === sessionId) return true
    if (giver !== null && this.theIdsItStandsFor(sessionId).includes(giver)) return true
    const heldOrGivenBy = giver === null ? [row.owner] : [row.owner, giver]
    return heldOrGivenBy.some((one) => this.ofOneIdentity(one, sessionId))
  }

  async updateWork(
    input: {
      readonly piece: string | null
      readonly title: string | null
      readonly status: string | null
      readonly on: WaitOnAsked | null
      readonly brief: string | null
      readonly definitionOfDone?: string | null
      readonly close: boolean
      readonly resources: readonly string[]
    },
    by: Caller,
  ): Promise<UpdateWorkOutcome> {
    const invalid = (problems: readonly string[]): UpdateWorkOutcome => ({
      ok: false,
      rail: 'malformed-request',
      detail: { problems },
    })
    if (input.brief !== null) {
      const read = workBriefSchema.safeParse(input.brief)
      if (!read.success) return invalid(read.error.issues.map((issue) => issue.message))
    }
    if (input.definitionOfDone != null) {
      const read = doneConditionSchema.safeParse(input.definitionOfDone)
      if (!read.success) return invalid(read.error.issues.map((issue) => issue.message))
    }
    if (input.close && (input.brief !== null || input.definitionOfDone != null))
      return invalid([
        input.brief !== null
          ? 'close and brief contradict each other: a piece you close is given no new brief'
          : "close and definition_of_done can't go together: a closed piece takes no new done condition.",
      ])
    const caller = sessionSpeakingAs(by)
    const waiting =
      input.close && input.piece !== null && caller !== null
        ? this.untilTheCopiesCanBeEnded(this.thePieceItsGiverEnds(input.piece, caller))
        : null
    if (waiting !== null) await waiting
    const refused = (
      rail: Exclude<ToolRefusal, 'that-piece-has-ended' | TheCopiesRefusal>,
      detail: Readonly<Record<string, unknown>> = {},
    ): UpdateWorkOutcome => ({ ok: false, rail, detail })
    const notFound = refused('no-piece-by-that-name', {
      ...(input.piece === null ? {} : { piece: input.piece }),
    })
    if (caller === null) return notFound
    let row: WorkRow | null
    if (input.piece !== null) {
      row = this.pieceNamed(input.piece)
    } else {
      const held = this.heldBy(caller).filter((one) => one.received)
      if (held.length !== 1 || held[0] === undefined) {
        return refused('malformed-request', {
          problems: [
            held.length === 0
              ? 'piece is required: you hold no piece it could mean'
              : `piece is required: you hold more than one (${held.map((one) => one.label).join(', ')})`,
          ],
        })
      }
      row = this.deps.store.workById(held[0].piece)
    }
    if (row === null) return notFound
    const itsGiver = row.givenBy !== null && this.theIdsItStandsFor(caller).includes(row.givenBy)
    const itsOwner = row.owner === caller
    const root = row.parent === null
    if (root ? !itsOwner : !itsGiver && !itsOwner) return notFound
    const named = { piece: row.piece, label: row.label }
    const condition = input.definitionOfDone ?? null
    const revises = input.brief !== null || condition !== null
    const rebriefs = input.brief !== null
    const keeps = input.resources.length > 0
    if (root && (rebriefs || input.close)) return refused('that-is-your-own-work', named)
    const aTitleOnlyItsGiverGives = input.title !== null && !itsGiver && row.givenBy !== null
    const aRootOrNothingButATitle =
      root || (input.status === null && !revises && !input.close && !keeps)
    const folded =
      aRootOrNothingButATitle && !aTitleOnlyItsGiverGives
        ? undefined
        : this.deps.store.piecesOwnedBy(row.owner).find((one) => one.piece === row.piece)
    if (folded !== undefined && !TASK_IS_OPEN[folded.state]) {
      const endedBy = folded.endedBy
      return {
        ok: false,
        rail: 'that-piece-has-ended',
        detail: {
          ...named,
          state: folded.state,
          ...(folded.endedAt === null ? {} : { at: folded.endedAt }),
          ...(endedBy === null
            ? {}
            : this.theIdsItStandsFor(caller).includes(endedBy)
              ? { endedByYou: true as const }
              : { called: this.whatToCallTheConversation(endedBy) }),
          yoursToRetitle: itsGiver || row.givenBy === null,
        },
        readAt: this.now(),
      }
    }
    if (aTitleOnlyItsGiverGives) {
      return refused('the-giver-names-a-piece', named)
    }
    if (
      (revises && !itsGiver && !(itsOwner && row.givenBy === null)) ||
      (input.close && !itsGiver)
    ) {
      return refused('the-giver-briefs-and-closes-a-piece', named)
    }
    let waitsOn: WaitOn | null = null
    if (input.on !== null) {
      const read = this.whatAWaitIsOn(input.on, row, caller)
      if (!read.ok) return refused('malformed-request', { problems: [read.problem] })
      waitsOn = read.on
    }
    if (!root && (revises || input.close) && folded === undefined) return notFound
    const withItsGive = rebriefs && folded !== undefined && this.itsGiveStillWaits(folded)
    const queued = folded !== undefined && this.queuedAtAService(folded)
    const owning = this.slots.get(row.owner)
    if (withItsGive && owning !== undefined && owning.session === null) {
      return onItsWayOut(owning) ? notFound : refused('that-conversation-has-not-started', named)
    }
    let held: TheHeldMessagesCarrying | null = null
    let itsTurn: TheTurnOnAPiece | null = null
    if (input.close && folded !== undefined && queued) {
      const stands = this.whereTheQueuedPieceStands(folded)
      if (!stands.ok) return refused(stands.because, named)
      held = stands.held
    } else if (input.close && folded !== undefined) {
      const stands = this.whereItsHolderStands(folded, by)
      if (!stands.ok) {
        return stands.because === 'out-of-its-reach' ? notFound : refused(stands.because, named)
      }
      held = stands.held
      itsTurn = this.theTurnOnThePieceItIsOn(folded, stands.held.session)
    }
    const copies =
      input.close && held !== null
        ? this.theCopiesToEnd(row.owner, row.piece)
        : ({ ok: true, copies: [] } as const)
    if (!copies.ok)
      return { ok: false, rail: copies.because, detail: { ...named, ...copies.detail } }
    const kept = this.keptFor(caller, input.resources)
    if (!kept.ok) return { ok: false, resourceRefusal: kept.refusal }

    if (input.title !== null) {
      this.writeIntoItsLedger(row.owner, {
        type: 'work_retitled',
        piece: row.piece,
        title: input.title,
        by: caller,
      })
    }
    if (input.status !== null) {
      this.writeIntoItsLedger(row.owner, {
        type: 'work_status_set',
        piece: row.piece,
        line: input.status,
        by: caller,
        ...(waitsOn === null ? {} : { waiting: true, on: waitsOn }),
      })
    }
    const role: ResourceRole = itsGiver ? 'input' : 'made'
    const at = this.now()
    const rows =
      kept.files.length === 0
        ? []
        : this.deps.store.atomically(() =>
            kept.files.map((file) =>
              this.deps.store.addResource(
                {
                  piece: named.piece,
                  role,
                  title: file.title,
                  summary: null,
                  name: file.name,
                  sha256: file.sha256,
                  bytes: file.bytes.length,
                  addedBy: caller,
                },
                at,
              ),
            ),
          )
    if (revises) {
      this.writeIntoItsLedger(row.owner, {
        type: 'work_rebriefed',
        piece: row.piece,
        ...(input.brief === null ? {} : { brief: input.brief }),
        ...(condition === null ? {} : { definitionOfDone: condition }),
        by: caller,
        ...(withItsGive && folded?.messageId != null ? { messageId: folded.messageId } : {}),
      })
    }
    let closed: { readonly tookBackTheMessage: boolean; readonly endedQuestions: number } | null =
      null
    if (held !== null && folded !== undefined && givenByAConversation(folded)) {
      const endedQuestions =
        openQuestionsByWork(
          this.deps.store.routedRequestsOf(row.owner),
          this.deps.store.questionsRaisedIn(row.owner),
        ).get(row.piece)?.length ?? 0
      this.endThePiece(
        row.owner,
        { type: 'work_closed', piece: row.piece, by: caller },
        'work-closed',
        copies.copies,
      )
      const tookBackTheMessage = this.takeBackTheHeldMessages(folded, held)
      this.takeBackWhatALaterFactMadeFalse(folded, 'closed')
      closed = { tookBackTheMessage, endedQuestions }
    }
    if (input.on !== null) this.reconcileWork(new Set([row.owner]))
    this.theWorldMoved('work')
    const live = this.slots.get(row.owner)?.session ?? null
    if (live !== null) this.publishStateIfChanged(live)

    const title = input.title ?? folded?.title ?? row.title
    let told: Told<NewBriefDelivery> | null = null
    if (input.brief !== null && folded !== undefined && givenByAConversation(folded)) {
      const rebriefed = {
        ...folded,
        title: input.title ?? folded.title,
        ...(condition === null ? {} : { definitionOfDone: condition }),
      }
      this.noteWhatItGave(caller, {
        piece: folded.piece,
        label: folded.label,
        as: 'rebriefed',
        to: folded.owner,
        title: rebriefed.title,
        brief: input.brief,
      })
      told = queued
        ? { delivery: 'with-its-give' }
        : await this.tellItsOwnerItsNewBrief(rebriefed, input.brief, by, withItsGive)
    } else if (closed !== null && folded !== undefined) {
      told = queued
        ? { delivery: 'not-delivered', whyNotTold: QUEUED_NEVER_TOLD }
        : await this.tellItsOwnerItWasClosed(
            { ...folded, title: input.title ?? folded.title },
            caller,
          )
    } else if (role === 'input' && rows.length > 0) {
      told = queued
        ? { delivery: 'not-delivered', whyNotTold: QUEUED_NEVER_TOLD }
        : await this.tellItsOwnerOfItsInputs(
            { piece: row.piece, label: row.label, title, owner: row.owner },
            caller,
            rows,
          )
    }
    return {
      ok: true,
      piece: row.piece,
      label: row.label,
      owner: row.owner,
      title: input.title,
      status: input.status,
      rebriefed: input.brief !== null,
      definitionOfDone: condition,
      kept: rows.map((one) => ({ resource: one.resource, name: one.name, role })),
      closed,
      askedItsTurnToStop:
        closed !== null &&
        itsTurn !== null &&
        folded !== undefined &&
        this.itsNoticeAsksItsTurnToStop(folded, 'a-piece-closed', by, itsTurn),
      atAService: closed !== null && this.itIsAService(row.owner),
      ...(told ?? { delivery: null }),
    }
  }

  retitleForAPerson(spelled: string, title: string): WorkRetitled {
    const refused = (rail: RetitleRail): WorkRetitled => ({
      ok: false,
      rail,
      reason: RETITLE_SAID[rail],
    })
    const trimmed = title.trim()
    if (trimmed === '') return refused('a-title-is-one-line')
    const row = this.pieceNamed(spelled)
    if (row === null) return refused('no-piece-by-that-name')
    if (row.givenBy !== null) return refused('a-conversation-names-that-piece')
    this.writeIntoItsLedger(
      row.owner,
      { type: 'work_retitled', piece: row.piece, title: trimmed, by: null },
      () => this.theWorldMoved('work'),
    )
    return { ok: true, piece: row.piece, label: row.label, title: trimmed }
  }

  private deliverWhenItRuns<T>(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[],
    says: AgentMessageKind | null,
    deliver: (to: string) => Promise<T>,
  ): Promise<T> {
    const onArrival = (async () => {
      const arriving = this.theOneInItsPlace(sessionId)
      if (!this.runsNow(arriving)) {
        await this.refuseBeforeAStart(arriving, text, by, attachments, says)
      }
    })()
    const inLine = this.afterWhatArrivedFirst(sessionId, async () => {
      await onArrival
      const to = this.theOneInItsPlace(sessionId)
      if (this.runsNow(to)) {
        this.aPersonsWindowTakesIt(to, theSurfaceAsking(by))
        return deliver(to)
      }
      await this.refuseBeforeAStart(to, text, by, attachments, says)
      const waker = sessionSpeakingAs(by)
      this.noteWhatBringsItBack(to, () => {
        const who =
          waker !== null
            ? this.whatToCallTheConversation(waker)
            : theSurfaceAsking(by) !== null
              ? 'you'
              : 'This app'
        return `${who} ${says === null ? 'gave it work' : 'wrote to it'}`
      })
      let ran: string
      try {
        ran = await this.ensureRunning(to, theSurfaceAsking(by))
      } catch (error) {
        throw waker === null ? error : new AStartThatDidNotHappen(error)
      } finally {
        this.whatBringsItBack.delete(to)
      }
      return deliver(ran)
    })
    return onArrival.then(
      () => inLine,
      (refused: unknown) => {
        void inLine.catch(() => undefined)
        throw refused
      },
    )
  }

  private theOneInItsPlace(sessionId: string): string {
    let now = sessionId
    for (let hops = 0; hops < 64; hops += 1) {
      const next = this.replacedBy.get(now)
      if (next === undefined) return now
      now = next
    }
    return now
  }

  tookItsPlace(sessionId: string): string | null {
    const now = this.theOneInItsPlace(sessionId)
    return now === sessionId ? null : now
  }

  private theIdsItStandsFor(sessionId: string): readonly string[] {
    return [sessionId, ...this.theOnesItTookThePlaceOf(sessionId)]
  }

  private theOnesItTookThePlaceOf(sessionId: string): readonly string[] {
    return [...this.replacedBy.keys()].filter(
      (old) => old !== sessionId && this.theOneInItsPlace(old) === sessionId,
    )
  }

  private commandedNow(target: {
    readonly ownerId: string | null
    readonly commandedBy: string | null
  }): { readonly ownerId: string | null; readonly commandedBy: string | null } {
    const commander =
      target.commandedBy === null ? null : sessionSpeakingAs({ ownerId: target.commandedBy })
    if (commander === null) return target
    const now = this.theOneInItsPlace(commander)
    return now === commander ? target : { ownerId: target.ownerId, commandedBy: agentCallerId(now) }
  }

  private theParentInItsPlace(sessionId: string): string | null {
    const parent = this.deps.store.parentOf(sessionId)
    return parent === null ? null : this.theOneInItsPlace(parent)
  }

  private whoItsQuestionsGoTo(
    sessionId: string,
    carrying?: { readonly askedBy: string; readonly requestId: string },
  ): string | null {
    if (!this.itIsAService(sessionId)) return this.theParentInItsPlace(sessionId)
    const on = this.thePieceItIsOn(sessionId)
    if (on === null || on.giver === null) return null
    if (carrying !== undefined && this.thePieceItWasAskedUnder(sessionId, carrying) !== on.piece) {
      return null
    }
    return this.theOneInItsPlace(on.giver)
  }

  private thePieceItWasAskedUnder(
    service: string,
    carrying: { readonly askedBy: string; readonly requestId: string },
  ): string | null {
    const { store } = this.deps
    const seen = new Set<string>()
    let asked = carrying
    while (!seen.has(`${asked.askedBy}:${asked.requestId}`)) {
      seen.add(`${asked.askedBy}:${asked.requestId}`)
      const raised = store.questionsRaisedIn(asked.askedBy).get(asked.requestId)
      if (raised !== undefined && raised.piece !== null) {
        return store.pieceOfItsChainHeldBy(raised.piece, service)
      }
      if (raised === undefined || raised.passedUpFrom === null) {
        const asker = asked.askedBy
        const routed = store.whereItWasRouted(asker, asked.requestId)
        if (routed === null) return null
        const unread = rowsUnreadOnce()
        const heldThen = store
          .piecesOwnedBefore(asker, routed, unread)
          .filter((one) => TASK_IS_OPEN[one.state])
        if (unread.count > 0) return null
        const under = new Set(
          heldThen.flatMap((one) => store.pieceOfItsChainHeldBy(one.piece, service) ?? []),
        )
        return under.size === 1 ? ([...under][0] ?? null) : null
      }
      const from = raised.passedUpFrom
      const reached = this.questionsRoutedToWhatItStandsFor(asked.askedBy).filter(
        (one) => one.requestId === from,
      )
      const next = reached.at(-1)
      if (next === undefined || reached.some((one) => one.askedBy !== next.askedBy)) return null
      asked = next
    }
    return null
  }

  private afterWhatArrivedFirst<T>(sessionId: string, deliver: () => Promise<T>): Promise<T> {
    const ahead = this.arrivals.get(sessionId) ?? Promise.resolve()
    const mine = ahead.then(deliver)
    const settled = mine.then(
      () => undefined,
      () => undefined,
    )
    this.arrivals.set(sessionId, settled)
    this.stateMayHaveMoved(sessionId)
    void settled.then(() => {
      if (this.arrivals.get(sessionId) !== settled) return
      this.arrivals.delete(sessionId)
      this.stateMayHaveMoved(sessionId)
      if (this.askAgainOnceItArrived.delete(sessionId)) this.tellWhoeverGaveTheWork(sessionId)
    })
    return mine
  }

  private async refuseBeforeAStart(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[],
    says: AgentMessageKind | null,
  ): Promise<void> {
    const me = sessionSpeakingAs(by)
    if (me !== null) {
      if (this.itsCallerMessagesAService(sessionId, by, says)) return
      if (!this.withinMessagingReach(sessionId, by, me)) {
        throw new Error(`unknown session: ${sessionId}`)
      }
      if (says !== null) this.assertMayReach('message', sessionId, by)
      return
    }
    const slot = this.slots.get(sessionId)
    const row = this.deps.store.recordedOne(sessionId)
    if (slot !== undefined) {
      if (by !== THE_APP_ITSELF) this.assertMayMessage(slot, by)
    } else if (row === null || this.startable(sessionId) === null) {
      throw new Error(`unknown session: ${sessionId}`)
    } else if (theSurfaceAsking(by) === null && !this.withinMessagingReach(sessionId, by)) {
      throw new Error(`unknown session: ${sessionId}`)
    }
    if (theSurfaceAsking(by) === null) return
    if (!hasSomethingToSend(text, attachments.length)) throw new Error(NOTHING_TO_SEND)
    const cwd = slot?.session?.cwd ?? row?.cwd ?? null
    if (cwd === null) return
    const handed = await recheckHandedPaths(attachments, cwd)
    if ('refusal' in handed) throw new Error(handed.refusal)
  }

  private ensureRunning(sessionId: string, window: RuntimeEventSink | null): Promise<string> {
    const inFlight = this.startsInFlight.get(sessionId)
    if (inFlight === undefined && this.runsNow(sessionId)) {
      this.aPersonsWindowTakesIt(sessionId, window)
      return Promise.resolve(sessionId)
    }
    let heldBack: boolean
    try {
      heldBack = inFlight === undefined && this.servicesHoldItsStartBack(sessionId, window)
    } catch (error) {
      return Promise.reject(error)
    }
    if (heldBack) return Promise.reject(new ServicesAreOff())
    if (inFlight !== undefined) {
      this.wakingForItsJobs.delete(sessionId)
      this.wakingForStoppedWork.delete(sessionId)
    }
    const started = inFlight ?? this.startForADelivery(sessionId, window)
    if (inFlight === undefined) {
      this.startsInFlight.set(sessionId, started)
      this.stateMayHaveMoved(sessionId)
      const done = (): void => {
        if (this.startsInFlight.get(sessionId) !== started) return
        this.startsInFlight.delete(sessionId)
        this.stateMayHaveMoved(sessionId)
      }
      void started.then(done, done)
    }
    return started.then((ran) => {
      this.aPersonsWindowTakesIt(ran, window)
      return ran
    })
  }

  private async startForADelivery(
    sessionId: string,
    window: RuntimeEventSink | null,
  ): Promise<string> {
    if (this.replacedBy.has(sessionId)) {
      return this.replaceWhatCanNeverBeReopened(sessionId, window)
    }
    let slot = this.slots.get(sessionId)
    while (slot !== undefined && !this.runsNow(sessionId)) {
      if (slot.session === null && !onItsWayOut(slot)) await slot.arrived
      else await this.whenItHasStopped(slot)
      const now = this.slots.get(sessionId)
      if (now === slot && onItsWayOut(slot)) break
      slot = now
    }
    if (this.runsNow(sessionId)) return sessionId
    const headless = window === null && !this.startingForADeliveryWithNoWindow.has(sessionId)
    if (headless) this.startingForADeliveryWithNoWindow.add(sessionId)
    try {
      if (this.aServiceThatNeverStarted(sessionId)) {
        await this.startTheRecordedService(sessionId, window)
      } else await this.resumeSession(sessionId, window, null, undefined, 'not-read')
      return sessionId
    } catch (error) {
      const raced = this.slots.get(sessionId)
      if (raced !== undefined && raced.session === null && !onItsWayOut(raced)) await raced.arrived
      if (this.runsNow(sessionId)) return sessionId
      if (
        itCanNeverBeReopened(error) &&
        !this.wakingForItsJobs.has(sessionId) &&
        !this.wakingForStoppedWork.has(sessionId)
      ) {
        return await this.replaceWhatCanNeverBeReopened(sessionId, window)
      }
      throw error
    } finally {
      if (headless) this.startingForADeliveryWithNoWindow.delete(sessionId)
    }
  }

  private aServiceThatNeverStarted(conversation: string): boolean {
    if (this.theServiceOf(conversation) === null) return false
    const row = this.deps.store.recordedOne(conversation)
    return row !== null && row.neverStarted && aRowADeliveryCanStart(row)
  }

  private async startTheRecordedService(
    conversation: string,
    window: RuntimeEventSink | null,
  ): Promise<void> {
    const recorded = this.deps.store.recordedOne(conversation)
    const row = this.deps.store.findLive(conversation)
    if (recorded === null || row === null) throw new Error(`unknown session: ${conversation}`)
    if (this.deps.store.aLaunchWentUnnamed(conversation)) {
      throw new Error(`${conversation}'s first launch was cut before its provider named it`)
    }
    const profileId = row.profileId ?? DEFAULT_PROFILE_ID
    const slot = this.refusalsTranslated(() =>
      this.reserve(
        conversation,
        {
          ownerId: window?.ownerId ?? null,
          ownerIsAPerson: window?.aPersonIsBehindIt ?? false,
          commandedBy: null,
          spawnedBy: null,
          anAgentAskedForIt: false,
          profileId,
        },
        null,
      ),
    )
    try {
      await this.startSessionInProfile(
        slot,
        {
          provider: recorded.provider,
          cwd: recorded.cwd,
          approvalMode: row.approvalMode ?? 'ask',
          profileId,
          ...(row.model === null ? {} : { model: row.model }),
          ...(row.reasoningEffort === null ? {} : { reasoningEffort: row.reasoningEffort }),
        },
        window ?? NO_SURFACE,
        profileId,
        this.profiles(),
        null,
        true,
      )
    } catch (error) {
      this.abandon(slot)
      this.launches.finish(slot.launch)
      throw this.refusalTranslated(this.aRefusalAPersonReads(error, conversation))
    } finally {
      slot.settle()
    }
  }

  private async replaceWhatCanNeverBeReopened(
    old: string,
    window: RuntimeEventSink | null,
  ): Promise<string> {
    if (this.replacedBy.has(old)) {
      const ran = await this.ensureRunning(this.theOneInItsPlace(old), window)
      const running = this.slots.get(ran)?.session ?? null
      if (running !== null) this.handWhatItHeldTo(old, running)
      return ran
    }
    if (this.theServiceOf(old) !== null) {
      throw new SessionUnavailable(
        'cannot-be-reopened',
        `service conversation ${old} can never be reopened, and none is started in its place`,
        { refusal: A_SERVICE_IS_NEVER_REPLACED },
      )
    }
    const row = this.deps.store.recordedOne(old)
    if (row === null) throw new Error(`unknown session: ${old}`)
    const identity = this.deps.store.identityOf(old)
    const profileId = identity?.profileSlug ?? row.profileId ?? DEFAULT_PROFILE_ID
    const provider = this.itsProvider(profileId).provider ?? row.provider
    const approvalMode = this.deps.store.find(old)?.approvalMode ?? 'ask'
    const recorded = this.deps.store.parentOf(old)
    const parent = recorded === null ? null : this.theOneInItsPlace(recorded)
    const spawn =
      parent === null
        ? null
        : admitAReplacement({
            parentSessionId: parent,
            profileId,
            provider,
            cwd: row.cwd,
            approvalMode,
            commandedBy: { ownerId: agentCallerId(parent) },
          })
    const itRan = this.deps.store.whatItRunsOn(old)
    const named = provider === row.provider && itRan?.model != null ? itRan : null
    this.reservingAReplacementWithNoWindow = window === null
    this.reservingAReplacementFor = old
    const creating = this.createSession(
      {
        provider,
        cwd: row.cwd,
        approvalMode,
        profileId,
        ...(named?.model == null ? {} : { model: named.model }),
        ...(named?.reasoningEffort == null ? {} : { reasoningEffort: named.reasoningEffort }),
      },
      window,
      null,
      spawn,
    )
    this.reservingAReplacementWithNoWindow = false
    this.reservingAReplacementFor = null
    const { sessionId } = await creating
    if (named?.aPersonChoseItAt != null) {
      this.deps.store.aPersonSetItsModelOrEffort(sessionId, named.aPersonChoseItAt)
    }
    this.replacedBy.set(old, sessionId)
    this.forgetItsWakeUp(old)
    this.appendIntoItsLedger(old, { type: 'replaced_by', sessionId })
    this.refreshWorkerReadings(true)
    const next = this.slots.get(sessionId)?.session ?? null
    if (next !== null) {
      this.publishOurs(next, { type: 'replaces', sessionId: old })
      if (this.reopeningForWhatWaited.delete(old)) {
        next.reopenedForWhatWaited = { at: this.now(), stopped: false }
      }
      this.handWhatItHeldTo(old, next)
    }
    console.info(
      `runtime host: ${old} could never be reopened, so ${sessionId} took its place (${profileId})`,
    )
    this.theWorldMoved('conversations')
    this.theWorldMoved('agents')
    this.announceTheWorkItHolds(old)
    this.tellWhoeverGaveTheWork(old)
    return sessionId
  }

  private handWhatItHeldTo(old: string, next: HostedSession): void {
    const inThisRun = new Map((this.heldAtAStop.get(old) ?? []).map((one) => [one.id, one]))
    this.heldAtAStop.delete(old)
    let open: readonly WaitingMessage[]
    try {
      open = this.deps.store.messagesWaitingIn(old)
    } catch (error) {
      console.warn(`runtime host could not read what waited for ${old}: ${errorMessage(error)}`)
      open = []
    }
    let moved = 0
    for (const row of open) {
      const queued = inThisRun.get(row.messageId) ?? this.rebuiltFromItsRow(row)
      const work = queued.piece !== undefined
      const itsJobs = queued.authorship.appNotice === 'a-scheduled-job-that-will-not-run'
      this.appendIntoItsLedger(old, {
        type: 'message_unqueued',
        messageId: queued.id,
        reason: 'abandoned',
        detail: work
          ? `this conversation could never be reopened, and the piece this message carried (${queued.label ?? queued.piece}) was not sent to the conversation that took its place: it is its giver's to give again or take back`
          : itsJobs
            ? ITS_JOBS_WENT_WITH_ITS_HISTORY
            : 'this conversation could never be reopened, so it went to the conversation that took its place',
        text: queued.text,
        ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),
        ...queued.authorship,
      })
      if (work || itsJobs) continue
      const held: QueuedMessage = { ...queued, id: newQueuedMessageId(), since: this.now() }
      delete held.interrupting
      next.mailbox.push(held)
      this.publishOurs(next, {
        type: 'message_queued',
        messageId: held.id,
        kind: held.kind,
        text: held.text,
        ...(held.attachments.length > 0 ? { attachments: [...held.attachments] } : {}),
        ...held.authorship,
        ...(held.drives === undefined ? {} : { drives: held.drives }),
        ...(held.about === undefined ? {} : { about: held.about }),
      })
      moved += 1
    }
    if (moved === 0) return
    this.publishStateIfChanged(next)
    this.flushQueued(next)
    this.theWorldMoved('work')
  }

  private async whenItHasStopped(slot: SessionSlot): Promise<void> {
    const session = slot.session
    if (session !== null && session.closing === null && session.finalizing === null) {
      await settledWithin(session.pump, this.closeDrainTimeoutMs)
    }
    await this.settleTeardown(slot.id)
  }

  private aPersonsWindowTakesIt(
    sessionId: string,
    window: RuntimeEventSink | null,
  ): ResumedSession | null {
    if (window === null || !this.aPersonsWindowMayTakeIt(sessionId, window)) return null
    return this.attachHeldSession(sessionId, window, 'claim')
  }

  private aPersonsWindowMayTakeIt(sessionId: string, window: RuntimeEventSink): boolean {
    if (!window.aPersonIsBehindIt) return false
    const slot = this.slots.get(sessionId)
    if (slot === undefined || slot.ownerId !== null) return false
    if (!slot.aDeliveryStartedItWithNoWindow) return false
    if (slot.spawnedBy !== null || slot.commandedBy !== null) return false
    const row = this.deps.store.recordedOne(sessionId)
    return row !== null && aRowADeliveryCanStart(row)
  }

  private async queueAs(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[],
    kind: MailboxKind,
    facts: TurnFacts,
    says: AgentMessageKind | null,
    mode: 'as-it-finds-it' | 'after-a-lost-race' | 'with-what-waits',
    onAStop?: (to: string) => Promise<QueueOutcome>,
  ): Promise<QueueOutcome> {
    const startItAgain = (again: (to: string) => Promise<QueueOutcome>): Promise<QueueOutcome> =>
      this.deliverWhenItRuns(sessionId, text, by, attachments, says, again)
    const session = this.requireToMessage(sessionId, by, () => {
      if (says !== null) this.assertMayReach('message', sessionId, by)
    })
    let itsSignInMovedOn = false
    try {
      await this.assertCanTakeTurn(session, 'queue', {
        text,
        attached: attachments.length,
        from: this.originOf(by),
      })
    } catch (error) {
      if (onAStop !== undefined && this.itStoppedUnder(session)) return startItAgain(onAStop)
      if (!this.aReopenCarriesIt(error, by, session)) throw error
      itsSignInMovedOn = true
    }
    const from = this.originOf(by)
    const handed = await recheckHandedPaths(attachments, session.cwd)
    if ('refusal' in handed) throw new Error(handed.refusal)
    const giveUpAt = Date.now() + this.deliveryWaitMs
    while (this.somethingIsOnItsWayTo(session) && Date.now() < giveUpAt) {
      await this.theWorkOnItsWayTo(session, giveUpAt)
    }
    let itsQuestionIsOver = false
    if (facts.asks !== undefined) {
      try {
        itsQuestionIsOver =
          this.howItsQuestionEnded(facts.asks.asker, facts.asks.requestId) !== null
      } catch (error) {
        console.warn(
          `runtime host could not ask whether ${facts.asks.requestId} still waits: ${errorMessage(error)}`,
        )
      }
    }
    const idle =
      !itsSignInMovedOn &&
      !itsQuestionIsOver &&
      this.itTakesAMessageStraightIn(session, mode) &&
      !this.itWaitsForItsLimit(session, from?.who === 'a-person')
    const giving = facts.giving ?? null
    const carried = facts.giving ?? facts.rebriefing ?? null
    const theRebriefMark = facts.rebriefing === undefined ? {} : { rebrief: true as const }
    const toProfile =
      from?.who === 'a-caller-with-an-id' && says !== null ? this.profileOf(session.id) : null
    const receiver =
      from?.who === 'a-caller-with-an-id' && says !== null
        ? this.theReceiverOf(session.id, facts)
        : {}
    if (idle) {
      const onItsWay = giving === null ? null : this.workSetsOffTo(session)
      try {
        await this.sendAs(sessionId, text, by, attachments, {
          facts,
          ifItLosesTheRace: 'pass-it-on',
          says,
          ...(onAStop === undefined ? {} : { onAStop: 'start-it-again' as const }),
        })
      } catch (error) {
        if (error instanceof ItStoppedUnderTheDelivery && onAStop !== undefined) {
          onItsWay?.arrived()
          return startItAgain(onAStop)
        }
        if (!(error instanceof TurnInProgress) && !this.aReopenCarriesIt(error, by, session)) {
          throw error
        }
        onItsWay?.arrived()
        return this.queueAs(
          sessionId,
          text,
          by,
          attachments,
          kind,
          facts,
          says,
          'after-a-lost-race',
          onAStop,
        )
      } finally {
        onItsWay?.arrived()
      }
      if (giving !== null) this.recordTheGive(session, giving, null)
      if (says !== null) {
        this.noteTheSending(
          from,
          session,
          says,
          'sent',
          facts.aboutPiece ?? null,
          null,
          toProfile,
          text,
          receiver,
        )
      }
      return { outcome: 'sent' }
    }
    if (onAStop !== undefined && this.itStoppedUnder(session)) return startItAgain(onAStop)
    this.assertAcceptsMessages(session, 'queue')
    const id = newQueuedMessageId()
    const drives = this.thePieceTheseWordsDrive(session.id, facts)
    const about =
      from?.who === 'a-caller-with-an-id' || facts.appNotice === 'a-work-wait-needs-attention'
        ? (facts.aboutPiece?.piece ?? null)
        : null
    const held: QueuedMessage = {
      id,
      kind,
      text,
      since: this.now(),
      attachments: handed.paths,
      authorship: whoseWordsTheseAre(by, this.profileOf, facts, says ?? undefined),
      ...(carried === null
        ? {}
        : { piece: carried.piece, label: carried.label, ...theRebriefMark }),
      ...(drives === null ? {} : { drives }),
      ...(from === null ? {} : { origin: from }),
      ...(facts.asks === undefined ? {} : { asks: facts.asks }),
      ...(about === null ? {} : { about }),
    }
    session.mailbox.push(held)
    if (TURN_ATTRIBUTION_KEYS.every((key) => held.authorship[key] === undefined))
      this.declineMoveOffersFromText(session.id, by)
    this.publishOurs(session, {
      type: 'message_queued',
      messageId: id,
      kind,
      text,
      ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),
      ...held.authorship,
      ...(carried === null
        ? {}
        : { piece: carried.piece, label: carried.label, ...theRebriefMark }),
      ...(drives === null ? {} : { drives }),
      ...(about === null ? {} : { about }),
      ...(held.asks === undefined ? {} : { asks: held.asks }),
    })
    if (giving !== null) this.recordTheGive(session, giving, id)
    if (says !== null) {
      this.noteTheSending(
        from,
        session,
        says,
        'queued',
        facts.aboutPiece ?? null,
        id,
        toProfile,
        text,
        receiver,
      )
    }
    this.publishStateIfChanged(session)
    if (itsSignInMovedOn) this.reopenForWhatWaits(session)
    else this.flushQueued(session)
    return { outcome: 'queued', messageId: id }
  }

  private recordTheGive(
    session: HostedSession,
    piece: ThePieceWrittenDown,
    messageId: string | null,
    pairAsked: ModelAndEffort | null = null,
  ): boolean {
    const ordinal = this.takeLedgerOrdinal(session)
    const at = this.now()
    const event: WorkGivenEvent = {
      type: 'work_given',
      piece: piece.piece,
      label: piece.label,
      parent: piece.parent,
      givenBy: piece.giver,
      title: piece.title,
      brief: piece.brief,
      definitionOfDone: piece.definitionOfDone,
      ...(messageId === null ? {} : { messageId }),
      ...(piece.givenFolder === null ? {} : { givenFolder: piece.givenFolder }),
      ...(pairAsked === null ? {} : { asked: pairAsked }),
    }
    this.record(session, () =>
      this.deps.store.recordGive(
        {
          piece: piece.piece,
          parent: piece.parent,
          number: piece.number,
          owner: session.id,
          givenBy: piece.giver,
          title: piece.title,
          brief: piece.brief,
          folder: piece.folder,
          inputs: piece.inputs,
        },
        ordinal,
        event,
        at,
      ),
    )
    this.rememberLedgerOrdinal(session, ordinal)
    if (session.recordingFailure !== null) {
      console.warn(
        `runtime session ${session.id} holds ${piece.label}, and no piece was written: this session is not being recorded`,
      )
      return false
    }
    this.emitOurs(session, { sessionId: session.id, ordinal, at, event })
    this.theWorldMoved('work')
    return true
  }

  private noteWhatItGave(
    giver: string,
    sent: Omit<WorkSentEvent, 'type' | 'givenFolder'> & {
      readonly givenFolder?: GivenFolder | null
    },
  ): void {
    this.writeIntoItsLedger(giver, {
      type: 'work_sent',
      piece: sent.piece,
      label: sent.label,
      as: sent.as,
      to: sent.to,
      title: sent.title,
      brief: sent.brief,
      ...(sent.givenFolder == null ? {} : { givenFolder: sent.givenFolder }),
    })
  }

  private noteTheSending(
    origin: TurnOrigin | null,
    target: Pick<HostedSession, 'id'>,
    kind: AgentMessageKind,
    delivery: 'sent' | 'queued',
    about: { readonly piece: string; readonly label: string } | null,
    messageId: string | null,
    toProfile: string | null,
    words: string,
    receiver: {
      readonly messageAct?: string
      readonly addressedAs?: string
      readonly toLabel?: string
    },
  ): void {
    if (origin?.who !== 'a-caller-with-an-id') return
    const slot = this.slots.get(origin.caller)
    const sender = slot?.phase === 'live' ? slot.session : null
    if (slot === undefined || sender === null) return
    this.publishOurs(sender, {
      type: 'message_sent',
      ...receiver,
      to: target.id,
      toProfile,
      kind,
      delivery,
      ...(messageId === null ? {} : { messageId }),
      ...(about === null ? {} : { piece: about.piece, label: about.label }),
      onBehalfOfAPerson: slot.ownerIsAPerson,
      text: words.slice(0, headOf(words, REPLY_SUMMARY_LIMIT)),
      ...(words.length > REPLY_SUMMARY_LIMIT ? { clipped: true as const } : {}),
    })
  }

  private readonly profileOf = (conversation: string): string | null =>
    this.deps.store.identityOf(conversation)?.profileSlug ?? null

  private originOf(by: Caller): TurnOrigin | null {
    if (by === THE_APP_ITSELF) return null
    if (aPersonTypedIt(by)) return THE_PERSON_AT_A_WINDOW
    const conversation = sessionSpeakingAs(by)
    if (conversation === null)
      return {
        who: 'a-caller-with-an-id',
        caller: by.ownerId,
        profile: null,
        aPersonIsBehindIt: false,
      }
    return {
      who: 'a-caller-with-an-id',
      caller: conversation,
      profile: this.deps.store.identityOf(conversation)?.profileSlug ?? null,
      aPersonIsBehindIt: this.slots.get(conversation)?.ownerIsAPerson ?? false,
    }
  }

  async cancelQueuedMessage(sessionId: string, messageId: string, by: Caller): Promise<void> {
    const session = this.requireToCommand(sessionId, by)
    const slot = this.slots.get(sessionId)
    const handedOn =
      slot !== undefined && onItsWayOut(slot) ? (this.heldAtAStop.get(sessionId) ?? []) : []
    const holding = [...session.mailbox, ...handedOn]
    const queued = holding.find((one) => one.id === messageId)
    if (queued === undefined && holding.length > 0) {
      throw new Error(
        `that is not a message this conversation is holding — it is holding ${holding
          .map((one) => one.id)
          .join(', ')}`,
      )
    }
    const inTheMailbox = queued !== undefined && session.mailbox.includes(queued)
    if (session.flushing && (queued === undefined || inTheMailbox)) {
      throw new Error('too late to cancel: that message is already being sent')
    }
    if (!queued) throw new Error('there is no queued message to cancel')
    if (queued.kind === 'notice') {
      throw new Error(
        'that is not a message to cancel: this app put it there to report something that ' +
          'happened, and taking it back would leave this conversation never told',
      )
    }
    if (!inTheMailbox) this.whatWaitsForItsStart(sessionId, queued.id)
    this.takeQueuedBack(session, queued)
    this.publishStateIfChanged(session)
  }

  async takeBackAndStop(sessionId: string, messageId: string, by: Caller): Promise<void> {
    await this.cancelQueuedMessage(sessionId, messageId, by)
    this.noteUserCommand(sessionId, 'interrupted', by)
    await this.interrupt(sessionId, by)
  }

  private assertAcceptsMessages(session: HostedSession, verb: 'send' | 'queue'): void {
    if (
      session.closing !== null ||
      session.finalizing !== null ||
      session.handle.isRetiring?.() === true
    ) {
      throw new Error(`cannot ${verb}: session ${session.id} is still closing`)
    }
    const status = session.handle.status()
    if (status === 'ended' || status === 'errored') {
      throw new Error(`cannot ${verb}: this conversation is over`)
    }
  }

  private async assertCanTakeTurn(
    session: HostedSession,
    verb: 'send' | 'queue',
    content: WhatTheGateIsAsked,
  ): Promise<WhatTheGateDecided> {
    if (!hasSomethingToSend(content.text, content.attached)) throw new Error(NOTHING_TO_SEND)
    this.assertAcceptsMessages(session, verb)
    await this.assertSignInCurrent(session, verb)
    return this.whatTheseWordsAre(session, content)
  }

  private async whatTheseWordsAre(
    session: HostedSession,
    content: WhatTheGateIsAsked,
  ): Promise<WhatTheGateDecided> {
    if (session.handle.compact !== undefined) {
      const compaction = aPersonsCompaction(content.text, content.from)
      if (compaction !== null) {
        if (content.attached > 0) throw new ACommandTakesNoAttachments(compaction.word, true)
        if (compaction.instructions !== null) {
          throw new ACompactionTakesNoInstructions(session.provider)
        }
        return { command: null }
      }
    }
    if (content.decided !== undefined) return content.decided
    const prefix = PROVIDER_COMMAND_PREFIX[session.provider]
    if (!mightBeAPersonsCommand(content.text, content.from, prefix)) return { command: null }
    const heard = await this.theCommandsItAnswersTo(session)
    const command = aPersonsCommand(content.text, content.from, heard, prefix)
    if (command !== null && content.attached > 0) {
      throw new ACommandTakesNoAttachments(command.word, command.listed)
    }
    return { command }
  }

  private theCommandsItAnswersTo(session: HostedSession): Promise<ProviderCommandAnswer | null> {
    if (session.commands !== null) return Promise.resolve(session.commands)
    session.askingForCommands ??= this.askForTheCommands(session)
    return withDeadline(
      session.askingForCommands,
      this.commandListWaitMs,
      'the provider’s command list',
    ).then(
      (heard) => session.commands ?? heard,
      () => null,
    )
  }

  private askForTheCommands(session: HostedSession): Promise<ProviderCommandAnswer> {
    return Promise.resolve()
      .then(
        () =>
          session.handle.providerCommands?.() ??
          Promise.reject(new Error('this adapter cannot say which commands it answers to')),
      )
      .then(
        (heard) => {
          session.commands ??= heard
          return heard
        },
        (error: unknown) => {
          session.askingForCommands = null
          return Promise.reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
  }

  private async assertSignInCurrent(session: HostedSession, verb: 'send' | 'queue'): Promise<void> {
    if ((await session.handle.checkSignIn?.()) !== true) {
      delete session.reopenedForWhatWaited
      return
    }
    if (session.itsSignInMovedOn !== true) {
      this.providersMoved({ what: 'login', provider: session.provider })
      const { provider } = session
      const reopened = session.reopenedForWhatWaited
      if (reopened !== undefined && this.now() - reopened.at < REOPEN_LOOP_GUARD_MS) {
        reopened.didNotHelp = true
      } else if (this.noteASignInChange(provider, session.lifeSince, session.profileId)) {
        queueMicrotask(() => this.whatWaitedForTheSignInBeforeGoes(provider))
      }
    }
    session.itsSignInMovedOn = true
    this.publishStateIfChanged(session)
    throw new ItsSignInMovedOn(
      `cannot ${verb}: this conversation is holding the ${PROVIDER_NAME[session.provider]} ` +
        `sign-in it started with, and ${providerDescriptor(session.provider).signIn.changeWords}. Nothing has been sent.`,
    )
  }

  private holdsQueued(session: HostedSession, queued: QueuedMessage): boolean {
    return session.mailbox.includes(queued)
  }

  private takeQueued(session: HostedSession, queued: QueuedMessage): boolean {
    const index = session.mailbox.indexOf(queued)
    if (index === -1) return false
    session.mailbox.splice(index, 1)
    return true
  }

  private workSetsOffTo(session: HostedSession): { arrived: () => void } {
    let release = (): void => {}
    const onItsWay = new Promise<void>((resolve) => {
      release = resolve
    })
    const inFlight = this.deliveriesInFlight.get(session) ?? new Set<Promise<void>>()
    inFlight.add(onItsWay)
    this.deliveriesInFlight.set(session, inFlight)
    let arrived = false
    return {
      arrived: () => {
        if (arrived) return
        arrived = true
        inFlight.delete(onItsWay)
        release()
        this.stateMayHaveMoved(session.id)
      },
    }
  }

  private somethingIsOnItsWayTo(session: HostedSession): boolean {
    return (this.deliveriesInFlight.get(session)?.size ?? 0) > 0 || session.flushing !== null
  }

  private idleEnoughToStop(conversation: string, state: AgentState): boolean {
    if (
      state.is === 'active' ||
      this.startsInFlight.has(conversation) ||
      this.arrivals.has(conversation)
    ) {
      return false
    }
    const slot = this.slots.get(conversation)
    if (slot === undefined || slot.session === null || onItsWayOut(slot)) return false
    const session = slot.session
    const planning = session.handle.settings.planMode
    return (
      !somethingRunning(session.background) &&
      !scheduleHeld(session.scheduled) &&
      session.handle.status() === 'idle' &&
      session.mailbox.length === 0 &&
      !this.somethingIsOnItsWayTo(session) &&
      session.holdingQueue === 0 &&
      !planning.effective &&
      !planning.requested
    )
  }

  private async theWorkOnItsWayTo(session: HostedSession, giveUpAt: number): Promise<void> {
    const onItsWay: Promise<unknown>[] = [...(this.deliveriesInFlight.get(session) ?? [])]
    if (session.flushing !== null) onItsWay.push(session.flushing)
    const left = giveUpAt - Date.now()
    if (onItsWay.length === 0 || left <= 0) return
    await withDeadline(Promise.allSettled(onItsWay), left, 'work on its way').catch(() => {
      console.warn(
        `runtime session ${session.id} waited ${this.deliveryWaitMs}ms for work on its way and decided anyway`,
      )
    })
  }

  private itTakesAMessageStraightIn(
    session: HostedSession,
    mode: 'as-it-finds-it' | 'after-a-lost-race' | 'with-what-waits',
  ): boolean {
    return mode === 'as-it-finds-it' && session.handle.status() === 'idle' && !session.holdingQueue
  }

  private flushQueued(session: HostedSession): void {
    if (this.homeCopies.get(session.provider)?.get(session.profileId)?.state === 'pending') {
      void this.copyHomeWhenIdle(session.provider, session.profileId)
      if (this.homeCopyJobs.has(profileSignInKey(session.provider, session.profileId))) return
    }
    if (
      (session.itsToolsMoved !== undefined || session.reopeningForItsTools === true) &&
      this.reopenWhenItsToolsMoved(session)
    ) {
      return
    }
    if (session.mailbox.length === 0 || session.flushing) return
    this.dropObsoleteReconciliationNotices(session)
    this.letGoOfAContinuationNotForThisLife(session)
    if (session.mailbox.length === 0) return
    if (this.cutHoldsTheFirstBatch.has(session.id) && !session.mailbox.some(aPersonsOwn)) return
    const atItsLimit = this.itWaitsForItsLimit(session, false)
    if (session.holdingQueue) return
    if (session.handle.status() !== 'idle') return
    const itsQueueIsUnread =
      this.aCallersWordsWaitForItsQueue(session) || this.aBriefWaitsForServices(session)
    if (atItsLimit && !session.mailbox.some(aPersonsOwn)) {
      this.reopenForWhatWaits(session)
      return
    }
    session.flushing = this.runFlush(session, atItsLimit || itsQueueIsUnread).then(
      (endedWhatItTookWithoutATurn) => {
        session.flushing = null
        this.stateMayHaveMoved(session.id)
        if (endedWhatItTookWithoutATurn) this.flushQueued(session)
        else this.reopenForWhatWaits(session)
      },
      (error: unknown) => {
        session.flushing = null
        this.stateMayHaveMoved(session.id)
        throw error
      },
    )
  }

  private endAHeldCommandThatCarriesFiles(
    session: HostedSession,
    queued: QueuedMessage,
    said: string,
  ): void {
    this.takeQueued(session, queued)
    this.publishOurs(session, {
      type: 'message_unqueued',
      messageId: queued.id,
      reason: 'abandoned',
      text: queued.text,
      detail: said,
      ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),
      ...queued.authorship,
    })
    this.publishStateIfChanged(session)
  }

  private goesAlone(session: HostedSession, text: string, from: TurnOrigin | null): boolean {
    return (
      mightBeAPersonsCommand(text, from, PROVIDER_COMMAND_PREFIX[session.provider]) ||
      (session.handle.compact !== undefined && aPersonsCompaction(text, from) !== null)
    )
  }

  private recordLimitAccount(session: HostedSession): void {
    let identity: string | null
    try {
      const known = this.identityKnown.get(session)
      if (known != null) identity = known
      else
        identity = this.identityFromFacts(
          session.provider,
          providerAuthPolicies[session.provider].identity.limit(session.handle),
        )
    } catch {
      identity = null
    }
    const lives = this.limitAccountLives.get(session.id) ?? new Map<number, string | null>()
    if (
      lives.has(session.lifeSince) &&
      (lives.get(session.lifeSince) === identity ||
        (lives.get(session.lifeSince) !== null && identity === null))
    )
      return
    lives.set(session.lifeSince, identity)
    const floor = session.lifeSince - PROVIDER_WALL_LOOKBACK_MS
    const previous = Math.max(-Infinity, ...[...lives.keys()].filter((since) => since < floor))
    for (const since of lives.keys()) if (since < previous) lives.delete(since)
    this.limitAccountLives.set(session.id, lives)
    const life = this.providerLimitLives.get(session.id)?.life
    if (life !== undefined) this.providerLimitFacts.bindAccount(session.id, life, identity)
    this.wallsForTheHold = null
    this.invalidateProviderLimitFacts()
  }

  private limitAccountSnapshot(): ProviderLimitAccountLife[] | undefined {
    const lives = new Map<string, ProviderLimitAccountLife>()
    const keep = (sessionId: string, since: number, account: string | null) =>
      lives.set(JSON.stringify([sessionId, since]), { sessionId, since, account })
    for (const [sessionId, life] of Object.entries(this.cutsKept.lives))
      keep(sessionId, life.since, life.identity)
    for (const [sessionId, history] of this.limitAccountLives)
      for (const [since, account] of history) keep(sessionId, since, account)
    if (lives.size > LIMITS_READ_BOUNDS.rows) return undefined
    return [...lives.values()]
  }

  private limitAccountOf(conversation: string, at: number): string | null {
    let latest = -Infinity
    let identity: string | null = null
    for (const [since, account] of this.limitAccountLives.get(conversation) ?? []) {
      if (since <= at && since > latest) {
        latest = since
        identity = account
      }
    }
    if (latest !== -Infinity) return identity
    const kept = this.cutsKept.lives[conversation]
    return kept !== undefined && at >= kept.since ? kept.identity : null
  }

  private theResetItWaitsFor(provider: Provider, account: string | null = null): number | null {
    const now = this.now()
    if (this.wallsForTheHold === null || now - this.wallsForTheHold.at > WALLS_READ_FOR_MS) {
      try {
        const epoch = this.providerLimitEpoch
        const walk = this.deps.store.providerLimitsSeen(
          now,
          this.signInChangedAt,
          this.limitAccountSnapshot(),
        )
        this.wallsForTheHold = { at: now, rows: walk.rows }
        this.prepareProviderLimitFacts(walk, now, epoch)
      } catch (error) {
        this.invalidateProviderLimitFacts()
        console.warn(`runtime host could not read the providers' limits: ${errorMessage(error)}`)
        return null
      }
    }
    let until: number | null = null
    let providerUntil: number | null = null
    for (const wall of this.wallsForTheHold.rows) {
      if (wall.provider !== provider || wall.standing !== 'stopped') continue
      if (wall.resetsAt === null || wall.resetsAt <= now) continue
      if (providerUntil === null || wall.resetsAt > providerUntil) providerUntil = wall.resetsAt
      if (account !== null && wall.account !== undefined && wall.account !== account) continue
      if (until === null || wall.resetsAt > until) until = wall.resetsAt
    }
    if (this.providerLimitFacts.gate(provider, providerUntil, now))
      this.publishProviderLimitFactsSoon()
    this.armProviderLimitExpiry()
    return until
  }

  private itWaitsForItsLimit(session: HostedSession, aPersonsOwn: boolean): boolean {
    if (aPersonsOwn) return false
    const until = this.theResetItWaitsFor(
      session.provider,
      this.limitAccountOf(session.id, this.now()),
    )
    if (until === null) return false
    this.goAtTheReset(session.provider, until)
    return true
  }

  private goAtTheReset(provider: Provider, until: number): void {
    const now = this.now()
    const at = now + Math.min(until - now + this.afterALimitResetsMs, this.lookAtTheLimitAgainMs)
    const set = this.theResets.get(provider)
    if (set !== undefined && set.at <= at) return
    if (set !== undefined) clearTimeout(set.timer)
    const timer = setTimeout(
      () => {
        this.theResets.delete(provider)
        this.wallsForTheHold = null
        this.invalidateProviderLimitFacts()
        this.letWhatWaitsGo(provider)
        this.wakeTheLimitsCuts(provider)
        void this.noticeAMovedSignIn(provider)
      },
      Math.max(0, at - now),
    )
    timer.unref?.()
    this.theResets.set(provider, { at, timer })
  }

  private lookAtTheLimitAgain(provider: Provider): void {
    this.wallsForTheHold = null
    this.invalidateProviderLimitFacts()
    if (this.theResetItWaitsFor(provider) === null) {
      const set = this.theResets.get(provider)
      if (set !== undefined) clearTimeout(set.timer)
      this.theResets.delete(provider)
    }
    this.letWhatWaitsGo(provider)
    this.wakeTheLimitsCuts(provider)
  }

  private aSignInChanged(provider: Provider, lifeSince: number, profileId?: string): void {
    if (this.noteASignInChange(provider, lifeSince, profileId)) {
      this.whatWaitedForTheSignInBeforeGoes(provider)
    }
  }

  private noteASignInChange(provider: Provider, lifeSince: number, profileId?: string): boolean {
    this.deps.limitsReader?.signInChanged()
    const itsProfile = providerDescriptor(provider).signIn.profileScoped ? profileId : undefined
    const olderLogins = new Set<string>()
    for (const { session } of this.slots.values()) {
      if (
        session?.provider === provider &&
        session.lifeSince <= lifeSince &&
        (itsProfile === undefined || session.profileId === itsProfile)
      ) {
        session.runsOnAnOlderLogin = true
        const tag = session.handle.signInTag?.() ?? null
        if (tag !== null) olderLogins.add(tag)
      }
    }
    for (const { session } of this.slots.values()) {
      if (
        session?.provider === provider &&
        (itsProfile === undefined || session.profileId === itsProfile) &&
        olderLogins.has(session.handle.signInTag?.() ?? '')
      ) {
        session.runsOnAnOlderLogin = true
      }
    }
    const changed = [...this.slots.values()].flatMap(({ session }) =>
      session?.provider === provider &&
      session.runsOnAnOlderLogin === true &&
      (itsProfile === undefined || session.profileId === itsProfile)
        ? [session.id]
        : [],
    )
    this.providerLimitEpoch++
    this.providerLimitFacts.signInChanged(changed)
    this.publishProviderLimitFactsSoon()
    if (providerDescriptor(provider).signIn.profileScoped) return false
    const noted = this.signInChangedAt.get(provider)
    if (noted !== undefined && lifeSince < noted) return false
    this.signInChangedAt.set(provider, this.now())
    this.doubtTheUsage(provider)
    this.wallsForTheHold = null
    this.invalidateProviderLimitFacts()
    try {
      this.deps.signInChanges?.write(this.signInChangedAt)
    } catch (error) {
      console.warn(`runtime host could not keep the sign-in change: ${errorMessage(error)}`)
    }
    return true
  }

  private whatWaitedForTheSignInBeforeGoes(provider: Provider): void {
    if (this.theResets.has(provider)) this.lookAtTheLimitAgain(provider)
  }

  private async noticeAMovedSignIn(provider: Provider): Promise<void> {
    if (this.launches.closed) return
    const noted = this.signInChangedAt.get(provider)
    let oldest: HostedSession | null = null
    for (const slot of this.slots.values()) {
      const session = slot.session
      if (session === null || session.provider !== provider) continue
      if (session.itsSignInMovedOn === true || session.handle.checkSignIn === undefined) continue
      if (noted !== undefined && session.lifeSince < noted) continue
      if (oldest === null || session.lifeSince < oldest.lifeSince) oldest = session
    }
    if (oldest === null) return
    try {
      await this.assertSignInCurrent(oldest, 'send')
    } catch (error) {
      if (error instanceof ItsSignInMovedOn) this.reopenForWhatWaits(oldest)
      else console.warn(`runtime host could not ask ${oldest.id}'s sign-in: ${errorMessage(error)}`)
    }
  }

  private letWhatWaitsGo(provider: Provider): void {
    if (this.launches.closed) return
    for (const slot of this.slots.values()) {
      const session = slot.session
      if (session !== null && session.provider === provider) this.flushQueued(session)
    }
  }

  private whyItWaitsForItsLimit(sessionId: string, behindAPerson = false): string | null {
    const session = this.slots.get(this.theOneInItsPlace(sessionId))?.session ?? null
    if (session === null || session.mailbox.every(aPersonsOwn)) return null
    const limit = this.whatItsLimitHolds(
      session.provider,
      false,
      this.limitAccountOf(session.id, this.now()),
    )
    const status = session.handle.status()
    const aTurn =
      status === 'working' || status === 'waiting_permission' || session.holdingQueue > 0
    return limit === null || !aTurn || behindAPerson
      ? limit
      : `${limit} It also waits for the turn this conversation is running to end.`
  }

  private whatItsLimitHolds(
    provider: Provider,
    afterAReopen = false,
    account: string | null = null,
  ): string | null {
    const until = this.theResetItWaitsFor(provider, account)
    if (until === null) return null
    const name = PROVIDER_NAME[provider]
    const minutes = Math.max(1, Math.ceil(this.lookAtTheLimitAgainMs / 60_000))
    const look = `within ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`
    const at = clockTimeFrom(until, this.now())
    const turn = `${look} when a ${name} conversation here completes a turn`
    if (afterAReopen) {
      return `After the reopen, what is held for it waits for ${name}’s usage limit too: until the limit resets, at ${at}, or sooner — at once when ${name} says that limit has cleared, and ${turn}.`
    }
    const sooner = providerDescriptor(provider).limitClearsOnSignInChange
      ? `It goes sooner if ${name} takes work again first: at once when ${name} says that limit has cleared, or when this app finds this computer’s ${name} sign-in changed under a ${name} conversation running here that started on the sign-in before — which it asks at least every ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} while something waits; and ${turn}. If the change was only a renewal of the same sign-in, which reads the same, or the new sign-in has reached a limit too, it may be sent while that limit holds, and that turn is refused.`
      : `It goes sooner if ${name} takes work again first: ${turn}.`
    return `${name}’s usage limit is reached, so it waits until the limit resets, at ${at}. ${sooner}`
  }

  private theTurnItTakes(session: HostedSession, onlyAPersons = false): readonly QueuedMessage[] {
    const taking: QueuedMessage[] = []
    for (const queued of session.mailbox) {
      if (onlyAPersons && !aPersonsOwn(queued)) continue
      if (
        this.goesAlone(session, queued.text, queued.origin ?? null) ||
        this.aServiceBrief(session, queued) ||
        queued.authorship.movedFrom !== undefined
      ) {
        return taking.length === 0 ? [queued] : taking
      }
      taking.push(queued)
      if (taking.length === MAX_TURN_PARTS) break
    }
    return taking
  }

  private itJoinsWhatWaits(session: HostedSession, text: string, from: TurnOrigin | null): boolean {
    return (
      session.flushing === null &&
      session.mailbox.length > 0 &&
      session.mailbox.length < MAX_TURN_PARTS &&
      !this.goesAlone(session, text, from) &&
      !session.mailbox.some(
        (queued) =>
          this.goesAlone(session, queued.text, queued.origin ?? null) ||
          this.aServiceBrief(session, queued) ||
          queued.authorship.movedFrom !== undefined,
      )
    )
  }

  private endItUnsent(
    session: HostedSession,
    queued: QueuedMessage,
    why: { readonly reason: 'retracted' | 'abandoned'; readonly detail: string },
  ): void {
    this.takeQueued(session, queued)
    this.publishOurs(session, {
      type: 'message_unqueued',
      messageId: queued.id,
      ...why,
      text: queued.text,
      ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),
      ...queued.authorship,
    })
    this.theWorldMoved('work')
    this.publishStateIfChanged(session)
  }

  private aCallersWordsNoLongerGoStraightIn(sessionId: string, by: Caller): boolean {
    const from = this.originOf(by)
    if (from === null) return false
    const reach = this.theReachOfACallersWords(sessionId, { origin: from })
    return reach === 'outlived' || reach === 'unknown'
  }

  private aCallersWordsGoNow(session: HostedSession, queued: QueuedMessage): boolean {
    const reach = this.theReachOfACallersWords(session.id, queued)
    if (reach === null || reach === 'reaches') return true
    if (reach === 'outlived') this.endItUnsent(session, queued, ITS_PIECE_HAD_ENDED)
    return false
  }

  private async readyToGo(
    session: HostedSession,
    queued: QueuedMessage,
  ): Promise<{ readonly paths: HandedPath[] } | null> {
    const itNoLongerGoes =
      queued.piece === undefined &&
      queued.asks === undefined &&
      queued.origin?.who !== 'a-caller-with-an-id'
        ? null
        : this.whyItNoLongerGoes(session.id, queued)
    if (itNoLongerGoes !== null) {
      this.endItUnsent(session, queued, itNoLongerGoes)
      return null
    }
    const handed = await recheckHandedPaths(queued.attachments, session.cwd)
    if (!this.holdsQueued(session, queued)) return null
    if ('refusal' in handed) {
      this.takeQueued(session, queued)
      this.publishOurs(session, {
        type: 'message_unqueued',
        messageId: queued.id,
        reason: 'abandoned',
        text: queued.text,
        detail: handed.refusal,
        ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),
        ...queued.authorship,
      })
      this.publishStateIfChanged(session)
      return null
    }
    return handed
  }

  private async runFlush(session: HostedSession, onlyAPersons = false): Promise<boolean> {
    const took = this.theTurnItTakes(session, onlyAPersons)
    if (took.length === 0) return false
    const checked = await Promise.all(took.map((queued) => this.readyToGo(session, queued)))
    let going = took.flatMap((queued, at) => {
      const handed = checked[at] ?? null
      return handed !== null && this.holdsQueued(session, queued) ? [{ queued, handed }] : []
    })
    if (going.length === 0) return true
    let sending: readonly OneMessageOfATurn[] = []
    const personalWorkTurnBefore = session.personalWorkTurn
    let personalHandover: number | undefined
    let moveHandoff: object | undefined
    try {
      const [only] = going
      await this.assertCanTakeTurn(session, 'send', {
        text: going.map(({ queued }) => queued.text).join('\n\n'),
        attached: going.reduce((all, { handed }) => all + handed.paths.length, 0),
        from: going.length === 1 && only !== undefined ? (only.queued.origin ?? null) : null,
      })
      this.dropObsoleteReconciliationNotices(session)
      this.letGoOfAContinuationNotForThisLife(session)
      going = going.filter(({ queued }) => this.holdsQueued(session, queued))
      if (going.length === 0) return true
      const someWait = going.some(
        ({ queued }) => this.theReachOfACallersWords(session.id, queued) === 'unknown',
      )
      going = going.filter(
        ({ queued }) =>
          this.aCallersWordsGoNow(session, queued) && (!someWait || aPersonsOwn(queued)),
      )
      if (going.length === 0) return true
      if (!this.servicesAreOn()) {
        going = going.filter(({ queued }) => !this.aServiceBrief(session, queued))
        if (going.length === 0) return true
      }
      const pieces = going.some(({ queued }) => queued.piece !== undefined)
        ? this.deps.store.piecesOwnedBy(session.id)
        : []
      sending = going.map(({ queued, handed }) => {
        const now =
          queued.piece === undefined ? undefined : pieces.find((one) => one.piece === queued.piece)
        let words = queued.text
        if (now !== undefined && queued.rebrief !== true) words = now.brief
        const handing: ThePieceATurnCarries | null =
          queued.piece === undefined || queued.label === undefined
            ? null
            : {
                piece: queued.piece,
                label: queued.label,
                title: now?.title ?? this.deps.store.workById(queued.piece)?.title ?? null,
                definitionOfDone: now?.definitionOfDone ?? undefined,
                as: queued.rebrief === true ? 'rebriefed' : 'given',
                inputs: this.theInputsOf(queued.piece),
                ...grantOf(now?.givenFolder),
              }
        return { queued, words, handed, handing }
      })
      session.handingOver = sending.map(({ queued }) => queued)
      try {
        for (const { queued, handed } of sending) {
          if (queued.authorship.movedFrom === undefined) continue
          const { authorship } = queued
          const event: UnqueuedMessageEvent = {
            type: 'message_unqueued',
            messageId: queued.id,
            reason: 'handover',
            text: queued.text,
            ...authorship,
            ...(handed.paths.length === 0 ? {} : { attachments: handed.paths }),
          }
          if (session.recordingFailure !== null) throw new Error(MOVE_WORDS.notRecorded)
          const entry = this.deps.store.atomically(() => {
            const ordinal = Math.max(session.ordinal, this.deps.store.nextOrdinal(session.id))
            const at = this.now()
            this.deps.store.append(session.id, ordinal, event, at)
            return { sessionId: session.id, ordinal, at, event }
          })
          queued.moveHandoverStarted = true
          session.ordinal = Math.max(session.ordinal, entry.ordinal + 1)
          this.emitOurs(session, entry)
        }
        const [one] = sending
        personalHandover = session.personalHandover + 1
        moveHandoff = this.beginMoveHandoff(
          session,
          sending.length === 1 &&
            one !== undefined &&
            TURN_ATTRIBUTION_KEYS.every(
              (key) => key === 'movedFrom' || one.queued.authorship[key] === undefined,
            ),
        )
        if (sending.length === 1 && one !== undefined) {
          await this.handToProvider(
            session,
            one.words,
            one.handed.paths,
            one.handing,
            one.queued.drives ?? null,
            one.queued.about ?? null,
            one.queued.origin ?? null,
            one.queued.authorship,
            undefined,
            one.queued.interrupting,
          )
        } else await this.handTogetherToProvider(session, sending)
      } finally {
        session.handingOver = []
      }
    } catch (error) {
      if (error instanceof TurnInProgress && session.personalHandover === personalHandover)
        session.personalWorkTurn = personalWorkTurnBefore
      if (session.moveRequestHandoff === moveHandoff) session.moveRequestRowPending = false
      for (const { queued } of sending) {
        if (queued.moveHandoverStarted) this.takeQueued(session, queued)
      }
      const still = going.filter(({ queued }) => this.holdsQueued(session, queued))
      const [command] = still
      if (error instanceof ACommandTakesNoAttachments && command !== undefined) {
        this.endAHeldCommandThatCarriesFiles(session, command.queued, error.message)
        return true
      }
      return false
    }
    const went = sending.filter(({ queued }) => this.holdsQueued(session, queued))
    const [alone] = went
    if (alone === undefined) {
      console.warn(
        `runtime session ${session.id}: what a turn took from the queue was handed over as the conversation ended — ` +
          'each message is recorded as abandoned, which is the ending the reader gets',
      )
      return false
    }
    for (const { queued } of went) {
      this.takeQueued(session, queued)
      if (queued.moveHandoverStarted) continue
      this.publishOurs(session, {
        type: 'message_unqueued',
        messageId: queued.id,
        reason: 'sent',
        text: queued.text,
      })
    }
    if (
      went.some(({ queued }) => queued.authorship.appNotice === 'a-scheduled-job-that-will-not-run')
    ) {
      this.theWordsAboutItsJobsWereSent(session.id)
    }
    for (const { queued } of went) {
      if (queued.authorship.appNotice === 'a-turn-the-app-cut') {
        this.theContinuationWasSent(session, queued.id)
      }
    }
    this.theWorldMoved('work')
    this.publishStateIfChanged(session)
    const askedForTheStop = went.some((one) => one.queued.interrupting !== undefined)
    if (went.length > 1) {
      this.publishOurs(
        session,
        {
          type: 'user_turn',
          humanInitiated: went.some((one) => one.queued.authorship.humanInitiated === true),
          text: went.map(({ words }) => words).join('\n\n'),
          parts: went.map((one) => ({
            text: one.words,
            ...(one.handed.paths.length > 0 ? { attachments: one.handed.paths } : {}),
            ...one.queued.authorship,
            ...(one.queued.piece === undefined || one.queued.label === undefined
              ? {}
              : { piece: one.queued.piece, label: one.queued.label }),
            ...(one.queued.drives === undefined ? {} : { drives: one.queued.drives }),
          })),
          ...(askedForTheStop ? { askedForTheStop } : {}),
        },
        undefined,
        moveHandoff,
        personalHandover,
      )
      return false
    }
    const { queued, words, handed } = alone
    this.publishOurs(
      session,
      {
        type: 'user_turn',
        text: words,
        ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),
        ...queued.authorship,
        ...(queued.piece === undefined || queued.label === undefined
          ? {}
          : { piece: queued.piece, label: queued.label }),
        ...(queued.drives === undefined ? {} : { drives: queued.drives }),
        ...(askedForTheStop ? { askedForTheStop } : {}),
      },
      undefined,
      moveHandoff,
      personalHandover,
    )
    return false
  }

  private handOnWhatItHeld(session: HostedSession): void {
    for (const toolsMoved of session.itsToolsMoved ?? []) {
      const { held, row } = this.wordsThisAppHolds(
        session.id,
        toolsMoved.reopened,
        TOLD_ABOUT_A_SERVER_REQUEST,
        'notice',
      )
      session.mailbox.push(held)
      this.publishOurs(session, row)
    }
    delete session.itsToolsMoved
    const held = session.mailbox.splice(0, session.mailbox.length)
    const waiting: QueuedMessage[] = []
    for (const queued of held) {
      if (queued.moveHandoverStarted) continue
      const cut = session.handingOver.includes(queued)
      const aContinuation = queued.authorship.appNotice === 'a-turn-the-app-cut'
      if (!cut && !aContinuation) {
        delete queued.interrupting
        waiting.push(queued)
        continue
      }
      if (aContinuation) {
        this.aContinuationLetGo(session.id, queued.id, cut ? 'handover-uncertain' : 'stopped')
      }
      this.publishOurs(session, {
        type: 'message_unqueued',
        messageId: queued.id,
        reason: 'abandoned',
        text: queued.text,
        ...(cut
          ? {
              detail:
                'the conversation stopped while this message was already being sent, so it may ' +
                'have reached the agent — nothing can come back either way',
            }
          : {}),
        ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),
        ...queued.authorship,
      })
    }
    if (waiting.length > 0 && !this.launches.closed) {
      this.heldAtAStop.set(session.id, [...(this.heldAtAStop.get(session.id) ?? []), ...waiting])
    }
    if (held.length > 0) this.theWorldMoved('work')
  }

  private putBackWhatWaitedForThisStart(session: HostedSession): void {
    const handedOn = this.heldAtAStop.get(session.id) ?? []
    this.heldAtAStop.delete(session.id)
    try {
      const waiting = this.whatWaitedForThisStart(session, handedOn)
      if (waiting.length === 0) return
      session.mailbox.unshift(...waiting)
      this.publishStateIfChanged(session)
      this.flushQueued(session)
    } catch (error) {
      console.warn(
        `runtime host could not put back what waited for ${session.id}: ${errorMessage(error)}`,
      )
    }
  }

  private whatWaitedForThisStart(
    session: HostedSession,
    handedOn: readonly QueuedMessage[],
  ): QueuedMessage[] {
    let open: readonly WaitingMessage[]
    try {
      open = this.deps.store.messagesWaitingIn(session.id)
    } catch (error) {
      console.warn(
        `runtime host could not read what waits for ${session.id}'s start: ${errorMessage(error)}`,
      )
      return [...handedOn]
    }
    const inThisRun = new Map(handedOn.map((one) => [one.id, one]))
    const waiting: QueuedMessage[] = []
    for (const row of open) {
      const queued = inThisRun.get(row.messageId) ?? this.rebuiltFromItsRow(row)
      const gone = this.whyItNoLongerGoes(session.id, queued)
      if (gone === null) {
        waiting.push(queued)
        continue
      }
      this.publishOurs(session, {
        type: 'message_unqueued',
        messageId: queued.id,
        ...gone,
        text: queued.text,
        ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),
        ...queued.authorship,
      })
      this.theWorldMoved('work')
    }
    return waiting
  }

  private whyItNoLongerGoes(
    sessionId: string,
    queued: QueuedMessage,
  ): { readonly reason: 'retracted' | 'abandoned'; readonly detail: string } | null {
    try {
      if (queued.piece !== undefined) {
        const piece = this.deps.store
          .piecesOwnedBy(sessionId)
          .find((one) => one.piece === queued.piece)
        if (piece === undefined || TASK_IS_OPEN[piece.state]) return null
        return ITS_PIECE_HAD_ENDED
      }
      if (this.theReachOfACallersWords(sessionId, queued) === 'outlived') return ITS_PIECE_HAD_ENDED
      if (queued.kind === 'question' && queued.asks !== undefined) {
        const { asker, requestId } = queued.asks
        const ended = this.howItsQuestionEnded(asker, requestId)
        if (ended === null) return null
        return {
          reason: 'retracted',
          detail: aQuestionNoticeALaterFactRetracted(ended, this.whatToCallTheConversation(asker)),
        }
      }
      const report = queued.kind === 'notice' ? queued.authorship.work : undefined
      if (report !== undefined && !TASK_IS_OPEN[report.state]) return null
      const about =
        queued.authorship.appNotice === 'a-work-wait-needs-attention' ? queued.about : undefined
      const holder =
        report?.owner ?? (about === undefined ? undefined : this.deps.store.workById(about)?.owner)
      if (holder === undefined) return null
      const piece = this.deps.store
        .piecesOwnedBy(holder)
        .find((one) => one.piece === (report?.piece ?? about))
      if (
        piece === undefined ||
        (piece.state !== 'answered' && piece.state !== 'withdrawn' && piece.state !== 'closed')
      ) {
        return null
      }
      return {
        reason: 'retracted',
        detail: aNoticeALaterFactRetracted(piece.state, this.whatToCallTheConversation(holder)),
      }
    } catch (error) {
      console.warn(
        `runtime host could not ask whether ${queued.id} is still true: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private howItsQuestionEnded(
    asker: string,
    requestId: string,
  ): Exclude<RequestState, 'open'> | null {
    const answered = this.answeredInThisRun.get(aQuestionKey(asker, requestId))
    if (answered !== undefined) return answered
    const request = [...this.deps.store.routedRequestsOf(asker)]
      .reverse()
      .find((one) => one.requestId === requestId)
    if (request === undefined || REQUEST_IS_OPEN[request.state] || request.state === 'open') {
      return null
    }
    return request.state
  }

  private rebuiltFromItsRow(row: WaitingMessage): QueuedMessage {
    const origin = theSenderItsAuthorshipNames(
      row.authorship,
      row.piece !== undefined,
      (caller) => this.slots.get(caller)?.ownerIsAPerson ?? false,
    )
    return {
      id: row.messageId,
      kind: row.kind,
      text: row.text,
      since: row.at,
      attachments: row.attachments,
      authorship: row.authorship,
      ...(row.piece === undefined ? {} : { piece: row.piece }),
      ...(row.label === undefined ? {} : { label: row.label }),
      ...(row.rebrief === undefined ? {} : { rebrief: row.rebrief }),
      ...(row.drives === undefined ? {} : { drives: row.drives }),
      ...(row.about === undefined ? {} : { about: row.about }),
      ...(row.asks === undefined ? {} : { asks: row.asks }),
      ...(origin === null ? {} : { origin }),
    }
  }

  private async untilIdleOrStopped(session: HostedSession): Promise<void> {
    while (session.handle.status() !== 'idle' && !this.itStoppedUnder(session)) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  private refusalOf(sessionId: string, requestId: string, error: unknown): AnswerAck | null {
    const refusal = answerRefusalOf(error)
    if (refusal === null) return null
    console.warn(
      `runtime session ${sessionId}: answering ${requestId} was refused (${refusal}): ${errorMessage(error)}`,
    )
    if (refusal === 'not-usable' || refusal === 'not-kept') {
      return {
        outcome: 'refused',
        reason:
          refusal === 'not-kept'
            ? '“always” could not be kept, so nothing was sent — this request is still waiting'
            : 'that answer cannot be sent: every question needs one that says something',
        stillOpen: true,
      }
    }
    return {
      outcome: 'refused',
      reason:
        refusal === 'not-pending'
          ? NO_LONGER_WAITING
          : 'that is not one of the responses this request offers',
      stillOpen: false,
    }
  }

  async respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
    by: Caller,
  ): Promise<ProviderAnswerAck> {
    const over = this.aPersonsAnswerComesTooLate(sessionId, requestId, by)
    if (over !== null) return over
    const session = this.requireToAnswer(sessionId, by, requestId)
    return await this.answerTheProvider(
      session,
      requestId,
      () => session.handle.respondPermission(requestId, decision),
      () => this.aPermissionWasTaken(session, requestId, decision, by),
    )
  }

  private aPermissionWasTaken(
    session: HostedSession,
    requestId: string,
    decision: PermissionDecision,
    by: Caller,
  ): void {
    this.recordPlanPhase(session)
    this.publishStateIfChanged(session)
    const stopsNothing =
      decision.outcome === 'cancel' && session.cancelsThatStopNothing.has(requestId)
    session.cancelsThatStopNothing.delete(requestId)
    this.publishOurs(session, {
      type: 'user_decision',
      requestId,
      outcome: decision.outcome,
      by: whoDidIt(by),
      ...(stopsNothing ? { stopsNothing: true as const } : {}),
    })
    this.theWorldMoved('work')
  }

  private readonly linkAnswers = new LinkAnswers(
    () => this.sampleWindowWriter({ kind: 'routes' }),
    () => this.deps.limitsWriterStamp?.() ?? null,
    () => this.now(),
  )

  resolveLink(target: string): LinkResolution {
    const parsed = parseLinkTarget(target)
    if (parsed === null) return unavailableLink(linkKindOf(target))
    return this.linkAnswers.read(target, () => this.readLink(parsed))
  }

  private readLink(parsed: NonNullable<ReturnType<typeof parseLinkTarget>>): ReadLinkAnswer {
    try {
      if (parsed.kind === 'agent') {
        const identity = this.deps.store.agentIdentityNameById(parsed.id)
        if (identity === null) return { answer: deletedLink('agent') }
        return {
          answer: {
            state: 'available',
            kind: 'agent',
            title: Array.from(identity.displayName ?? identity.slug)
              .slice(0, LINK_TITLE_CHARS)
              .join(''),
            status: null,
            opens: { identityId: identity.id },
          },
        }
      }
      if (parsed.kind === 'piece' && 'label' in parsed && pieceNumbersOf(parsed.label) === null)
        return { answer: unavailableLink('piece') }
      const piece =
        parsed.kind === 'piece'
          ? 'label' in parsed
            ? this.deps.store.workByLabel(parsed.label)
            : this.deps.store.workById(parsed.id)
          : null
      if (parsed.kind === 'piece' && piece === null) return { answer: deletedLink('piece') }
      const sessionId = parsed.kind === 'conversation' ? parsed.id : piece!.owner
      if (this.settingAside.has(sessionId)) return { answer: unavailableLink(parsed.kind) }
      if (this.deps.store.recordedOne(sessionId) === null)
        return {
          answer:
            parsed.kind === 'conversation'
              ? deletedLink(parsed.kind)
              : unavailableLink(parsed.kind),
        }
      const names = new Map<string, string>()
      const nameOf = (conversation: string): string => {
        const held = names.get(conversation)
        if (held !== undefined) return held
        const profile = this.profileOf(conversation)
        const identity =
          profile === null
            ? null
            : this.deps.store.agentIdentityNameById(agentIdentityRowId(profile))
        const name = nameTheConversation(
          whoseConversationIs(profile, identity === null ? [] : [identity]),
        )
        names.set(conversation, name)
        return name
      }
      const unread = rowsUnreadOnce()
      const asks = this.deps.store.instructionAsksWaitingIn(sessionId, rowsUnreadOnce())
      if (asks === null) throw new Error('instruction asks unavailable')
      const state = this.stateOf(
        sessionId,
        {
          roster: [],
          nameOf,
          askingForRules: new Set(asks.map((one) => one.conversation)),
          asksUnread: 0,
        },
        unread,
      )
      const named = this.workThatNames(sessionId, unread)
      if (unread.count !== 0 || unread.ledgersSkipped !== 0)
        return { answer: unavailableLink(parsed.kind), cacheable: false }
      return {
        answer: {
          state: this.archived.has(sessionId) ? 'archived' : 'available',
          kind: parsed.kind,
          title: Array.from(named?.title ?? nameOf(sessionId))
            .slice(0, LINK_TITLE_CHARS)
            .join(''),
          status: agentStateWords(state),
          opens: { sessionId },
        },
        state,
      }
    } catch {
      return { answer: unavailableLink(parsed.kind), cacheable: false }
    }
  }

  private moveDestinationAvailable(sessionId: string): boolean {
    return (
      this.deps.store.recordedOne(sessionId) !== null &&
      !this.archived.has(sessionId) &&
      !this.settingAside.has(sessionId) &&
      this.theOneInItsPlace(sessionId) === sessionId
    )
  }

  private declineMoveOffersFromText(sessionId: string, by: Caller): void {
    if (!aPersonIsAsking(by) || sessionSpeakingAs(by) !== null) return
    const offered = this.deps.store.latestMoveOffer?.(sessionId)
    if (offered === null || offered === undefined) return
    const request = this.deps.store
      .routedRequestsOf(sessionId)
      .find((one) => one.requestId === offered.requestId)
    if (request === undefined || !REQUEST_IS_OPEN[request.state]) return
    this.writeIntoItsLedger(sessionId, {
      type: 'user_decision',
      requestId: request.requestId,
      outcome: 'rejected',
      by: whoDidIt(by),
    })
    this.theWorldMoved('work')
  }

  async decideMoveRequest(input: DecideMoveRequestInput, by: Caller): Promise<MoveRequestAck> {
    if (!aPersonIsAsking(by) || sessionSpeakingAs(by) !== null)
      return { outcome: 'refused', reason: MOVE_WORDS.personOnly }
    const sourceRecord = this.deps.store.recordedOne(input.sessionId)
    if (sourceRecord === null || sourceRecord.restoredFromBundle || sourceRecord.foundInUserHome)
      return { outcome: 'refused', reason: MOVE_WORDS.noOriginal }
    const asked = this.theWordsOf(input.sessionId, input.requestId)
    if (asked?.move === undefined) return { outcome: 'refused', reason: MOVE_WORDS.ended }
    const request = this.deps.store
      .routedRequestsOf(input.sessionId)
      .find((one) => one.requestId === input.requestId)
    if (request === undefined || aPersonsSince(request) === null)
      return { outcome: 'refused', reason: MOVE_WORDS.personOnly }
    const previous = this.deps.store.theDecisionOn(input.sessionId, input.requestId)
    if (previous?.by?.who === 'a-person' && previous.movedTo !== undefined)
      return { outcome: 'moved', ...previous.movedTo }
    if (!REQUEST_IS_OPEN[request.state]) return { outcome: 'refused', reason: MOVE_WORDS.ended }
    if (input.decision === 'here') {
      const response = await this.respondUserInput(
        input.sessionId,
        input.requestId,
        { kind: 'answer', answers: { answer: DO_IT_HERE } },
        by,
      )
      return response.outcome === 'taken'
        ? { outcome: 'here' }
        : { outcome: 'refused', reason: 'reason' in response ? response.reason : MOVE_WORDS.ended }
    }
    if (input.decision !== 'move') return { outcome: 'refused', reason: MOVE_WORDS.ended }
    const offer = asked.move
    if (offer.destination === input.sessionId)
      return { outcome: 'refused', reason: MOVE_WORDS.hereAlready }
    if (
      !this.moveDestinationAvailable(offer.destination) ||
      !this.withinMessagingReach(
        offer.destination,
        { ownerId: agentCallerId(input.sessionId) },
        input.sessionId,
      )
    )
      return { outcome: 'refused', reason: MOVE_WORDS.unavailable }
    const original = originalMoveRequest(
      this.deps.store,
      input.sessionId,
      offer.sourceTurnId ?? offer.sourceOrdinal,
    )
    if (original === null) return { outcome: 'refused', reason: MOVE_WORDS.noOriginal }
    if (this.runsNow(offer.destination)) {
      try {
        this.aPersonsWindowTakesIt(offer.destination, theSurfaceAsking(by))
        const targetSession = this.requireToMessage(offer.destination, by)
        await this.assertCanTakeTurn(targetSession, 'queue', {
          text: original.event.text,
          attached: original.event.attachments?.length ?? 0,
          from: this.originOf(by),
        })
      } catch (error) {
        return { outcome: 'refused', reason: errorMessage(error) }
      }
    }
    const target = this.deps.store.recordedOne(offer.destination)!
    const handed = await recheckHandedPaths(original.event.attachments ?? [], target.cwd)
    if ('refusal' in handed) return { outcome: 'refused', reason: handed.refusal }
    if (
      !this.moveDestinationAvailable(offer.destination) ||
      !this.withinMessagingReach(
        offer.destination,
        { ownerId: agentCallerId(input.sessionId) },
        input.sessionId,
      )
    )
      return { outcome: 'refused', reason: MOVE_WORDS.unavailable }
    if (this.runsNow(offer.destination)) {
      try {
        this.requireToMessage(offer.destination, by)
      } catch (error) {
        return { outcome: 'refused', reason: errorMessage(error) }
      }
    }
    let recorded: ReturnType<typeof recordMovedRequest>
    try {
      const unread = rowsUnreadOnce()
      const named = this.workThatNames(offer.destination, unread)
      if (unread.count !== 0 || unread.ledgersSkipped !== 0) throw new Error(MOVE_WORDS.notRecorded)
      recorded = recordMovedRequest(
        this.deps.store,
        input.sessionId,
        input.requestId,
        offer,
        this.nameByItsWork(input.sessionId),
        handed.paths,
        whoDidIt(by),
        this.now(),
        !this.runsNow(offer.destination),
        named?.title ?? this.whatToCallTheConversation(offer.destination),
      )
    } catch {
      return { outcome: 'refused', reason: MOVE_WORDS.notRecorded }
    }
    for (const entry of recorded.entries) {
      const session = this.slots.get(entry.sessionId)?.session
      if (session != null) session.ordinal = Math.max(session.ordinal, entry.ordinal + 1)
      if (session != null) this.emitOurs(session, entry)
      else this.showTheWindowsLookingAt(entry.sessionId, entry)
    }
    if (recorded.queued !== null) {
      const queued = recorded.queued
      const session = this.slots.get(offer.destination)?.session
      if (session != null) {
        if (!session.mailbox.some((one) => one.id === queued.messageId))
          session.mailbox.push({
            id: queued.messageId!,
            kind: 'work',
            text: queued.text,
            attachments: queued.attachments ?? [],
            since: this.now(),
            authorship: { movedFrom: queued.movedFrom },
            origin: THE_PERSON_AT_A_WINDOW,
          })
        this.publishStateIfChanged(session)
        this.flushQueued(session)
      } else {
        void this.deliverWhenItRuns(
          offer.destination,
          original.event.text,
          by,
          handed.paths,
          null,
          async (to) => {
            if (to !== offer.destination) throw new Error(MOVE_WORDS.unavailable)
            const running = this.slots.get(to)?.session
            if (running != null) this.flushQueued(running)
          },
        ).catch((error: unknown) =>
          console.warn(`A moved request is waiting to send: ${errorMessage(error)}`),
        )
      }
    }
    this.theWorldMoved('work')
    return { outcome: 'moved', ...recorded.receipt }
  }

  async respondUserInput(
    sessionId: string,
    requestId: string,
    response: UserInputResponse,
    by: Caller,
  ): Promise<ProviderAnswerAck> {
    const asked = this.theWordsOf(sessionId, requestId)
    if (asked !== undefined) {
      return await this.aPersonAnswersAQuestionThisAppAsked(
        sessionId,
        requestId,
        asked,
        response,
        by,
      )
    }
    const over = this.aPersonsAnswerComesTooLate(sessionId, requestId, by)
    if (over !== null) return over
    const session = this.requireToAnswer(sessionId, by, requestId)
    return await this.answerTheProvider(
      session,
      requestId,
      () => session.handle.respondUserInput(requestId, response),
      () => this.aQuestionWasTaken(session, requestId, response, by),
    )
  }

  private async aPersonAnswersAQuestionThisAppAsked(
    askedBy: string,
    requestId: string,
    asked: TheWordsOfAQuestion,
    response: UserInputResponse,
    by: Caller,
  ): Promise<AnswerAck> {
    if (asked.move !== undefined) response = { kind: 'answer', answers: { answer: DO_IT_HERE } }
    const request = [...this.deps.store.routedRequestsOf(askedBy)]
      .reverse()
      .find((one) => one.requestId === requestId)
    if (request === undefined) {
      return { outcome: 'refused', reason: NO_SUCH_QUESTION_TO_ANSWER, stillOpen: false }
    }
    const slot = this.slots.get(askedBy)
    const aPersons = aPersonsSince(request) !== null
    const inTheirWindow =
      slot !== undefined &&
      ((aPersonTypedIt(by) && (by as RuntimeEventSink).aPersonIsBehindIt === true) ||
        mayAnswerAsAHuman(slot, by))
    if (!aPersonIsAsking(by) || (!aPersons && !inTheirWindow)) {
      return {
        outcome: 'refused',
        reason: NOT_A_PERSONS_TO_ANSWER_HERE,
        stillOpen: REQUEST_IS_OPEN[request.state],
      }
    }
    const answeredAlready = this.answeredInThisRun.get(aQuestionKey(askedBy, requestId))
    if (answeredAlready !== undefined) {
      return {
        outcome: 'refused',
        reason: A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION[answeredAlready],
        stillOpen: false,
      }
    }
    if (admitAnswer(request) !== null) {
      return {
        outcome: 'refused',
        reason:
          request.state === 'open'
            ? NO_SUCH_QUESTION_TO_ANSWER
            : A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION[request.state],
        stillOpen: false,
      }
    }
    const parts = new Set(response.kind === 'answer' ? Object.keys(response.answers) : asked.parts)
    const missing = asked.parts.filter((part) => !parts.has(part))
    if (response.kind === 'answer' && missing.length > 0) {
      return {
        outcome: 'refused',
        reason: `no answer was given for ${missing.join(', ')}`,
        stillOpen: true,
      }
    }
    this.decideAQuestionThisAppAsked(
      askedBy,
      requestId,
      response.kind === 'answer' ? 'answered' : 'rejected',
      by,
    )
    const said =
      response.kind === 'answer'
        ? Object.entries(response.answers).map(([part, answer]) => ({
            part,
            answer: typeof answer === 'string' ? [answer] : [...answer],
          }))
        : null
    const delivered = this.deliverAnswer(asked, requestId, null, said, null, theSurfaceAsking(by))
    this.theWorldMoved('work')
    const { kept } = await delivered
    return kept === null ? { outcome: 'taken' } : { outcome: 'taken', reason: kept }
  }

  private decideAQuestionThisAppAsked(
    askedBy: string,
    requestId: string,
    outcome: 'answered' | 'rejected',
    by: Caller,
  ): void {
    const key = aQuestionKey(askedBy, requestId)
    this.answeredInThisRun.set(key, outcome)
    this.writeIntoItsLedger(
      askedBy,
      { type: 'user_decision', requestId, outcome, by: whoDidIt(by) },
      () => {
        if (this.answeredInThisRun.get(key) === outcome) this.answeredInThisRun.delete(key)
      },
    )
  }

  private aQuestionWasTaken(
    session: HostedSession,
    requestId: string,
    response: UserInputResponse,
    by: Caller,
  ): void {
    this.recordPlanPhase(session)
    this.publishOurs(session, {
      type: 'user_decision',
      requestId,
      outcome: response.kind === 'answer' ? 'answered' : 'rejected',
      by: whoDidIt(by),
    })
    this.theWorldMoved('work')
  }

  private answerTheProvider(
    session: HostedSession,
    requestId: string,
    answer: () => Promise<void>,
    taken: () => void,
  ): Promise<ProviderAnswerAck> {
    let answering: Promise<void>
    try {
      answering = answer()
    } catch (error) {
      answering = Promise.reject(error)
    }
    return new Promise<ProviderAnswerAck>((resolve, reject) => {
      let released = false
      const bound = setTimeout(() => {
        released = true
        resolve({ outcome: 'unacknowledged', waitedMs: this.interruptWaitMs })
      }, this.interruptWaitMs)
      answering
        .then(
          () => {
            clearTimeout(bound)
            if (!released || this.isCurrentLife(session)) taken()
            resolve({ outcome: 'taken' })
          },
          (error: unknown) => {
            clearTimeout(bound)
            if (released) throw error
            const refused = this.refusalOf(session.id, requestId, error)
            if (refused === null) throw error
            resolve(refused)
          },
        )
        .catch((error: unknown) => {
          if (!released) {
            reject(error)
            return
          }
          console.warn(
            `runtime session ${session.id}: answering ${requestId} did not complete after the host stopped waiting: ${errorMessage(error)}`,
          )
        })
    })
  }

  private recordPlanPhase(session: HostedSession, reportNow = true): void {
    const { effective, requested } = session.handle.settings.planMode
    if (effective !== requested) return
    if (effective === session.planAsRecorded) return
    session.planAsRecorded = effective
    this.record(session, () =>
      effective
        ? this.deps.store.startPlanMode(session.id, this.now())
        : this.deps.store.endPlanMode(session.id, this.now()),
    )
    if (reportNow && session.sink.alive) this.reportRecordingFailure(session)
    this.publishStateIfChanged(session)
  }

  async interrupt(sessionId: string, by: Caller): Promise<void> {
    const session = this.requireToCommand(sessionId, by)
    const stillAsked = session.stopStillAsked
    if (stillAsked !== null && session.handle.status() !== 'waiting_permission') {
      session.handle.endEverythingTheTurnStarted?.()
      await settledWithin(stillAsked, this.interruptWaitMs)
      return
    }
    const stopping = this.askTheWorkToStop(session, by)
    session.handle.endEverythingTheTurnStarted?.()
    this.sayWhenTheStopGoesUnanswered(session, stopping, by)
    stopping.catch((error: unknown) => {
      console.warn(`runtime session ${session.id} failed to interrupt: ${errorMessage(error)}`)
    })
    if (await settledWithin(stopping, this.interruptWaitMs)) await stopping
  }

  private sayWhenTheStopGoesUnanswered(
    session: HostedSession,
    stopping: Promise<void>,
    by: Caller,
  ): void {
    this.itsNextPieceWaitsForTheStop(session, stopping)
    const asker = whoDidIt(by)
    if (asker.who === 'the-app-itself') return
    const whose = {
      ...this.theIdentityThatAsked(asker),
      by: asker.who,
      ...(asker.who === 'an-agent' ? { agent: asker.agent } : {}),
    }
    session.stopStillAsked = stopping
    const answered = (): void => {
      if (session.stopStillAsked === stopping) session.stopStillAsked = null
    }
    stopping.then(answered, answered)
    void settledWithin(stopping, this.interruptWaitMs).then(() => {
      if (session.stopStillAsked !== stopping || !this.isCurrentLife(session)) return
      this.publishOurs(session, {
        type: 'stop_unanswered',
        waitedMs: this.interruptWaitMs,
        ...whose,
      })
    })
  }

  private askTheWorkToStop(
    session: HostedSession,
    by: Caller,
    keepsWhatThisAppAsked = false,
  ): Promise<void> {
    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null
    this.recordTheAsk(session, by)
    const leftOpen = raised === null ? this.itsOwnQuestionsAStopLeavesOpen(session) : null
    for (const request of this.deps.store.routedRequestsOf(session.id)) {
      if (!REQUEST_IS_OPEN[request.state]) continue
      if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue
      if (leftOpen?.has(request.requestId) === true) continue
      this.publishOurs(session, { type: 'request_interrupted', requestId: request.requestId })
    }
    return session.handle.interrupt()
  }

  private itsOwnQuestionsAStopLeavesOpen(session: HostedSession): ReadonlySet<string> {
    const left = new Set<string>()
    const open = this.deps.store
      .routedRequestsOf(session.id)
      .filter((request) => REQUEST_IS_OPEN[request.state])
    if (open.length === 0) return left
    const itsOwn = this.deps.store.questionsRaisedIn(session.id)
    for (const request of open) {
      const asked = itsOwn.get(request.requestId)
      if (asked?.raisedBy !== 'this-app') continue
      if (session.askedSinceItsLastTurnEnded.has(request.requestId)) {
        session.questionsAStopEndedUntold.push({ id: request.requestId, prompt: asked.prompt })
      } else left.add(request.requestId)
    }
    return left
  }

  private recordTheAsk(session: HostedSession, by: Caller): void {
    const actor = whoDidIt(by)
    if (actor.who === 'the-app-itself') return
    const ask: WorkInterruptedEvent = {
      type: 'work_interrupted',
      by: actor.who,
      ...(actor.who === 'an-agent' ? { agent: actor.agent } : {}),
      ...this.theIdentityThatAsked(actor),
    }
    this.publishOurs(session, ask)
  }

  private theIdentityThatAsked(actor: ActedBy): { agentProfile?: string } {
    if (actor.who !== 'an-agent') return {}
    const itsIdentity = this.deps.store.identityOf(actor.agent)
    return itsIdentity === null ? {} : { agentProfile: itsIdentity.profileSlug }
  }

  async interruptAgent(id: string, by: Caller): Promise<InterruptOutcome> {
    const sessionId = this.theOneInItsPlace(id)
    const slot = this.slots.get(sessionId)
    if (slot === undefined && this.deps.store.recordedOne(sessionId) === null) {
      return { ok: false, refusal: 'no-such-agent' }
    }
    if (this.onAnotherCallersPiece(sessionId, by)) {
      return {
        ok: false,
        refusal: refuseInterrupt('that-service-is-on-another-callers-piece', { agent: sessionId }),
      }
    }
    if (!this.mayInterrupt(sessionId, by)) {
      return { ok: false, refusal: refuseInterrupt('not-below-you', { agent: sessionId }) }
    }
    if (slot === undefined || onItsWayOut(slot)) return this.nothingToInterrupt(sessionId)
    const session = slot.session
    const status = session === null ? null : session.handle.status()
    if (status === 'ended' || status === 'errored') return this.nothingToInterrupt(sessionId)
    if (
      session !== null &&
      status === 'idle' &&
      !session.turnOpened &&
      session.flushing === null &&
      session.handingOver.length === 0
    ) {
      return this.nothingToInterrupt(sessionId)
    }
    const askedOf =
      status === 'waiting_permission'
        ? this.whoOwesIt(
            sessionId,
            this.cardReads(),
            rowsUnreadOnce(),
            undefined,
            () => [],
            () => [],
          ).askedOf
        : null
    const refusal = admitInterrupt(sessionId, status, askedOf)
    if (refusal !== null) return { ok: false, refusal }
    if (session === null)
      return {
        ok: false,
        refusal: refuseInterrupt('that-conversation-has-not-started', { agent: sessionId }),
      }
    const itsEnding = this.whatTheStopOfItsTurnEnds(session, this.interruptWaitMs)
    const asked = this.askTheWorkToStop(session, by)
    session.handle.endEverythingTheTurnStarted?.()
    this.sayWhenTheStopGoesUnanswered(session, asked, by)
    asked.catch((error: unknown) => {
      console.warn(`runtime session ${sessionId} failed to interrupt: ${errorMessage(error)}`)
    })
    await settledWithin(asked, this.interruptWaitMs)
    const ended = await itsEnding
    const unread = rowsUnreadOnce()
    return {
      ok: true,
      agent: sessionId,
      asked: true,
      state: this.stateOf(sessionId, this.cardReads(), unread),
      ...(ended === undefined ? {} : { ended }),
      stillRunning: this.whatStillRunsIn(sessionId),
    }
  }

  private whatTheStopOfItsTurnEnds(
    session: HostedSession,
    withinMs: number,
  ): Promise<readonly string[] | undefined> {
    const status = session.handle.status()
    if (status !== 'working' && status !== 'waiting_permission') return Promise.resolve(undefined)
    return new Promise((resolve) => {
      const itEnded = (ended: readonly string[]): void => {
        clearTimeout(timer)
        resolve(ended)
      }
      const timer = setTimeout(() => {
        const at = session.whenATurnEnds.indexOf(itEnded)
        if (at >= 0) session.whenATurnEnds.splice(at, 1)
        resolve(undefined)
      }, withinMs)
      session.whenATurnEnds.push(itEnded)
    })
  }

  private mayInterrupt(sessionId: string, by: Caller): boolean {
    if (this.thePieceItIsOnFor(sessionId, by) !== null) return true
    const target = this.slots.get(sessionId) ?? this.startable(sessionId)
    return (
      (target !== undefined && target !== null && mayCommand(this.commandedNow(target), by)) ||
      mayInterruptDownTheChain(
        by,
        this.ancestorsAsItWillRun(sessionId).map((above) => this.theOneInItsPlace(above)),
      )
    )
  }

  private nothingToInterrupt(sessionId: string): InterruptOutcome {
    return {
      ok: true,
      agent: sessionId,
      asked: false,
      state: this.stateOf(sessionId, this.cardReads(), rowsUnreadOnce()),
      stillRunning: this.whatStillRunsIn(sessionId),
    }
  }

  private whatStillRunsIn(sessionId: string): string[] {
    const slot = this.slots.get(sessionId)
    if (slot === undefined || onItsWayOut(slot)) return []
    return (slot.session?.background.running ?? []).map((row) => backgroundWhat(row).text)
  }

  async stopBackgroundWork(sessionId: string, id: string, by: Caller): Promise<boolean> {
    const { handle } = this.require(sessionId, by)
    if (handle.stopBackgroundWork === undefined) return false
    return await handle.stopBackgroundWork(id)
  }

  noteUserCommand(
    sessionId: string,
    command: UserCommandEvent['command'],
    by: Caller,
    target?: string,
  ): void {
    const slot = this.slots.get(sessionId)
    if (slot && !aPersonTypedIt(by) && !mayControl(slot, by)) return
    const session = slot?.session
    if (!session) return
    this.publishOurs(session, { type: 'user_command', command, ...(target ? { target } : {}) })
  }

  private readonly keyRefusedForBilling = new Map<
    Provider,
    { readonly setAt: number; readonly at: number }
  >()
  private readonly keyChanges = new Map<Provider, number>()
  private readonly rejectedMachineLogins = new Map<Provider, object>()
  private readonly manualAuthChecks = new Map<string, Promise<AuthState>>()

  apiKeyStatus(provider: Provider): ApiKeyStatus {
    const status = this.deps.apiKeys?.status(provider) ?? {
      provider,
      set: false,
      setAt: null,
      inUse: false,
    }
    const refused = this.keyRefusedForBilling.get(provider)
    if (refused === undefined || !status.set || status.setAt !== refused.setAt) return status
    return {
      ...status,
      refusedForBilling: { at: refused.at, aLoginRunsWithoutIt: aLoginRunsWithoutAKey(provider) },
    }
  }

  private noteWhatATurnSaysOfTheKey(
    session: HostedSession,
    event: Extract<RuntimeEvent, { type: 'turn' }>,
  ): void {
    const provider = session.provider
    const refusedNow = event.state === 'failed' && event.billingRefused === true
    const worked = event.state === 'completed' && this.keyRefusedForBilling.has(provider)
    if (!(refusedNow && event.onAKey === true) && !worked) return
    const status = this.deps.apiKeys?.status(provider)
    if (status === undefined || !status.set || status.setAt === null) return
    if (session.lifeSince < status.setAt || this.readsAnOlderLogin(session)) return
    if (refusedNow) this.noteTheKeyRefusedForBilling(provider, status.setAt)
    else this.letGoOfTheKeysRefusal(provider)
  }

  private noteTheKeyRefusedForBilling(provider: Provider, setAt: number): void {
    const held = this.keyRefusedForBilling.get(provider)
    this.keyRefusedForBilling.set(provider, { setAt, at: this.now() })
    if (held?.setAt !== setAt) this.providersMoved({ what: 'key', provider })
  }

  private letGoOfTheKeysRefusal(provider: Provider): void {
    if (this.keyRefusedForBilling.delete(provider)) this.providersMoved({ what: 'key', provider })
  }

  async setApiKey(provider: Provider, key: string): Promise<ApiKeyChanged> {
    const keys = this.deps.apiKeys
    if (!keys) {
      return {
        ...this.apiKeyStatus(provider),
        refused: 'This build of BroCrew cannot keep an API key.',
      }
    }
    const refused = await keys.set(provider, key)
    if (refused !== null) return { ...this.apiKeyStatus(provider), refused }
    this.keyChanges.set(provider, (this.keyChanges.get(provider) ?? 0) + 1)
    this.keyRefusedForBilling.delete(provider)
    const notice = await this.bringTheKeyToItsHomes(provider)
    this.providerLoginChanged(provider)
    this.letTheWakeUpsWaitingForItsKeyGo(provider)
    return notice === null ? keys.status(provider) : { ...keys.status(provider), notice }
  }

  async removeApiKey(provider: Provider): Promise<ApiKeyChanged> {
    const keys = this.deps.apiKeys
    if (!keys) return this.apiKeyStatus(provider)
    keys.remove(provider)
    this.keyChanges.set(provider, (this.keyChanges.get(provider) ?? 0) + 1)
    this.keyRefusedForBilling.delete(provider)
    const notice = await this.bringTheKeyToItsHomes(provider)
    this.providerLoginChanged(provider)
    this.letTheWakeUpsWaitingForItsKeyGo(provider)
    return notice === null ? keys.status(provider) : { ...keys.status(provider), notice }
  }

  async checkApiKey(provider: Provider): Promise<ApiKeyCheck> {
    const keys = this.deps.apiKeys
    const ask = this.deps.askTheProvider
    if (!keys || !ask)
      return { ok: false, reason: 'This build of BroCrew cannot check an API key.' }
    const card = providerDescriptor(provider).displayName
    const change = this.keyChanges.get(provider)
    const revision = keys.revision?.(provider)
    const setAt = keys.status(provider).setAt
    let key: string | null
    try {
      key = await keys.read(provider)
    } catch (error) {
      return { ok: false, reason: errorMessage(error) }
    }
    if (key === null) {
      return {
        ok: false,
        reason: `No API key is saved for ${card}. Save one under “API key” on the ${card} card first.`,
      }
    }
    const moved = await this.bringTheKeyToItsHomes(provider)
    if (moved !== null) return { ok: false, reason: moved }
    const said = await ask(provider, key)
    if (
      this.keyChanges.get(provider) !== change ||
      keys.revision?.(provider) !== revision ||
      keys.status(provider).setAt !== setAt
    )
      return said
    if (!said.ok && said.cannotPay === true && setAt !== null) {
      this.noteTheKeyRefusedForBilling(provider, setAt)
    }
    if (said.ok && said.answeredARequest === true) this.letGoOfTheKeysRefusal(provider)
    return said
  }

  async providerVersions(): Promise<Readonly<Record<Provider, ProviderVersion>>> {
    const ask = this.deps.providerVersions
    const unsaid = (reason: string): Readonly<Record<Provider, ProviderVersion>> =>
      providerRecord(() => ({ version: null, reason }))
    if (ask === undefined)
      return unsaid('This build of BroCrew cannot say which versions its providers run.')
    let launch: Launch | null = null
    try {
      launch = this.launches.open('provider version probe')
      const owned = launch
      const work = this.deps.beforeProviderLaunch
        ? this.deps.beforeProviderLaunch().then(() => {
            owned.signal.throwIfAborted()
            return ask()
          })
        : ask()
      this.launches.finish(launch, work)
      return await work
    } catch (error) {
      if (launch !== null) this.launches.finish(launch)
      console.warn(`runtime host could not read the providers' versions: ${errorMessage(error)}`)
      return unsaid(
        'BroCrew could not read the providers’ versions just now; try again in a moment.',
      )
    }
  }

  async keptRules(): Promise<KeptRules> {
    return (await this.deps.keptRules?.()) ?? providerRecord(() => [])
  }

  removeKeptRule(input: { provider: Provider; file: string; kept: string }): KeptRuleRemoved {
    const remove = this.deps.removeKeptRule
    if (remove === undefined) {
      return { removed: false, why: 'This build of BroCrew cannot remove a kept rule.' }
    }
    try {
      return remove(input)
    } catch (error) {
      return { removed: false, why: errorMessage(error) }
    }
  }

  providerSetup(): Readonly<Record<Provider, ProviderSetup | null>> {
    return providerRecord((provider) =>
      providerAuthPolicies[provider].setup(
        process.platform,
        () => this.deps.programFound?.[provider]?.() ?? null,
      ),
    )
  }

  private renewalNotice(provider: Provider, renewed: boolean): { readonly loginRenewed?: string } {
    const text = providerAuthPolicies[provider].renewedNotice
    return renewed && text !== null ? { loginRenewed: text } : {}
  }

  providerUsage(): Readonly<Record<Provider, readonly ProviderUsageReading[]>> {
    const held = this.usageAsHeld()
    const shown = (provider: Provider): readonly ProviderUsageReading[] =>
      held[provider].map(({ window, usedPercent, resetsAt, at }) => ({
        window,
        usedPercent,
        resetsAt,
        at,
        ...(this.usageUnconfirmed.has(provider) ? { unconfirmed: true as const } : {}),
      }))
    return providerRecord(shown)
  }

  private usageAsHeld(): Record<Provider, readonly KeptReading[]> {
    return providerRecord((provider) => [...(this.usage.get(provider)?.values() ?? [])])
  }

  private usageThatCounts(): Record<Provider, readonly ProviderUsageReading[]> {
    const held = this.usageAsHeld()
    return providerRecord((provider) => (this.usageUnconfirmed.has(provider) ? [] : held[provider]))
  }

  providerResources(): Promise<Readonly<Record<Provider, ProviderResources>>> {
    if (this.resourcesMeasuring !== null) return this.resourcesMeasuring
    const last = this.resourcesMeasured
    const age = last === null ? Number.POSITIVE_INFINITY : this.now() - last.settledAt
    if (last !== null && age >= 0 && age < RESOURCE_SAMPLE_MS) return Promise.resolve(last.answer)
    const measuring = this.measureTheResources()
      .then((answer) => {
        this.resourcesMeasured = { settledAt: this.now(), answer }
        return answer
      })
      .finally(() => {
        this.resourcesMeasuring = null
      })
    this.resourcesMeasuring = measuring
    return measuring
  }

  private async measureTheResources(): Promise<Readonly<Record<Provider, ProviderResources>>> {
    const roots: Record<Provider, number[]> = providerRecord(() => [])
    for (const { session } of this.slots.values()) {
      const pid = session?.handle.providerPid
      if (session !== null && session !== undefined && pid !== undefined) {
        roots[session.provider].push(pid)
      }
    }
    const unmeasured = (reason: string): Readonly<Record<Provider, ProviderResources>> => {
      const at = this.now()
      return providerRecord((provider) => ({
        running: roots[provider].length,
        at,
        rssBytes: null,
        cpuPercent: null,
        reason,
      }))
    }
    const list = this.deps.listProcesses
    if (list === undefined) return unmeasured('This build of BroCrew cannot measure its processes.')
    try {
      const rows = await list()
      return resourcesFromTheListing(rows, roots, this.now())
    } catch (error) {
      console.warn(`runtime host could not list this computer's processes: ${errorMessage(error)}`)
      return unmeasured(errorMessage(error))
    }
  }

  private takeTheUsage(session: HostedSession, event: ProviderUsageEvent): void {
    const { provider } = session
    const named = this.accountOf(session)
    const by = {
      signIn: session.handle.signInTag?.() ?? null,
      account: named?.id ?? null,
      lifeSince: session.lifeSince,
    }
    const at = this.now()
    let moved = false
    const heldOn = this.usageReadOn.get(provider)
    const heldAccount = this.oneAccountHeld(provider)
    const onAnotherSignIn =
      by.account !== null && heldAccount !== undefined
        ? by.account !== heldAccount
        : by.signIn === null || heldOn?.tag !== by.signIn
    if (this.usageUnconfirmed.delete(provider)) {
      if (onAnotherSignIn) this.usage.delete(provider)
      moved = true
    } else if (
      onAnotherSignIn &&
      by.signIn !== null &&
      heldOn !== undefined &&
      !providerDescriptor(provider).signIn.profileScoped
    ) {
      if (by.lifeSince < heldOn.lifeSince) return
      if (this.usage.delete(provider)) moved = true
    }
    if (named?.learned !== undefined) this.keepTheAccount(named.learned)
    const tagMoved = (by.signIn ?? undefined) !== heldOn?.tag
    if (by.signIn === null) this.usageReadOn.delete(provider)
    else {
      this.usageReadOn.set(provider, {
        tag: by.signIn,
        lifeSince:
          heldOn?.tag === by.signIn ? Math.max(heldOn.lifeSince, by.lifeSince) : by.lifeSince,
      })
    }
    const sameSignIn = onAnotherSignIn ? undefined : heldAccount
    const held = this.usage.get(provider) ?? new Map<string, KeptReading>()
    for (const reading of event.readings) {
      const found = held.get(reading.window)
      if (found === undefined && held.size >= MAX_USAGE_WINDOWS) continue
      const before =
        found?.account === undefined || by.account === null || found.account === by.account
          ? found
          : undefined
      const usedPercent = reading.usedPercent ?? before?.usedPercent ?? null
      const resetsAt = reading.resetsAt ?? before?.resetsAt ?? null
      const account =
        by.account ?? (by.signIn === null ? undefined : (before?.account ?? sameSignIn))
      if (
        found?.usedPercent !== usedPercent ||
        found.resetsAt !== resetsAt ||
        found.account !== account
      ) {
        moved = true
      }
      held.set(reading.window, {
        window: reading.window,
        usedPercent,
        resetsAt,
        at,
        ...(account === undefined ? {} : { account }),
      })
    }
    this.usage.set(provider, held)
    if (moved || (tagMoved && !providerDescriptor(provider).signIn.profileScoped))
      this.keepTheUsage()
    if (moved) this.providersMoved({ what: 'usage', provider })
  }

  private noteTheWindowsSeen(provider: Provider, event: ProviderUsageEvent): void {
    const at = this.now()
    const seen = this.windowsSeen.get(provider) ?? new Map<string, UsageWindowSeen>()
    let firstSeen = false
    for (const { window } of event.readings) {
      const was = seen.get(window)
      if (was !== undefined) {
        seen.set(window, { window, first: Math.min(was.first, at), last: Math.max(was.last, at) })
        continue
      }
      if (seen.size >= MAX_USAGE_WINDOWS) {
        const oldest = [...seen.values()].reduce((one, other) =>
          other.last < one.last ? other : one,
        )
        seen.delete(oldest.window)
      }
      seen.set(window, { window, first: at, last: at })
      firstSeen = true
    }
    this.windowsSeen.set(provider, seen)
    if (firstSeen) this.aWindowFirstSeenUnkept = true
  }

  private keepAWindowFirstSeen(): void {
    if (this.aWindowFirstSeenUnkept) this.keepTheUsage()
  }

  private accountOf(session: HostedSession): { id: string; learned?: KnownAccount } | null {
    const fact = providerAuthPolicies[session.provider].identity.limit(session.handle)
    if (fact === null) return null
    if (fact.kind === 'tag') return { id: fact.tag }
    const frozen = this.identityKnown.get(session)
    const prefix = `${session.provider}:account:`
    if (frozen?.startsWith(prefix)) return { id: frozen.slice(prefix.length) }
    const said = fact.account
    const known = this.recordedAccountFor(said)
    if (known === null) return null
    if (known !== undefined) return { id: known.id, learned: known }
    const learned: KnownAccount = {
      id: randomBytes(16).toString('hex'),
      email: said.email,
      ...(said.organization === undefined ? {} : { organization: said.organization }),
    }
    return { id: learned.id, learned }
  }

  private oneAccountHeld(provider: Provider): string | undefined {
    const accounts = new Set([...(this.usage.get(provider)?.values() ?? [])].map((r) => r.account))
    const [only] = accounts
    return accounts.size === 1 ? only : undefined
  }

  private takeTheKnownAccount(): void {
    const kept = this.deps.accountsKept
    if (kept === undefined) return
    try {
      const record = kept.read()
      this.knownAccount = legacyAccountRecordFormat.accountIn(record)
      this.knownAccounts = legacyAccountRecordFormat.accountsIn(record)
    } catch (error) {
      console.warn(
        `runtime host could not read the account usage was read on: ${errorMessage(error)}`,
      )
    }
  }

  private keepTheAccount(account: KnownAccount): boolean {
    try {
      const record = legacyAccountRecordFormat.forAccount(account, this.knownAccounts)
      if (this.deps.accountsKept === undefined) return false
      this.deps.accountsKept.write(record)
      this.knownAccount = account
      this.knownAccounts = legacyAccountRecordFormat.accountsIn(record)
      return true
    } catch (error) {
      console.warn(`runtime host could not keep the account record: ${errorMessage(error)}`)
      return false
    }
  }

  usageWindowsSeen(): Readonly<Record<Provider, readonly UsageWindowSeen[]>> {
    return providerRecord((provider) => [...(this.windowsSeen.get(provider)?.values() ?? [])])
  }

  private takeTheKeptUsage(): void {
    const kept = this.deps.usageKept
    if (kept === undefined) return
    let read: KeptUsage
    try {
      read = kept.read()
    } catch (error) {
      console.warn(`runtime host could not read the kept usage readings: ${errorMessage(error)}`)
      return
    }
    for (const provider of SUPPORTED_PROVIDERS) {
      const held = new Map<string, KeptReading>()
      for (const reading of read.readings[provider] ?? []) {
        if (held.size >= MAX_USAGE_WINDOWS) break
        held.set(reading.window, reading)
      }
      if (held.size > 0) this.usage.set(provider, held)
      if (held.size > 0) this.usageUnconfirmed.add(provider)
      const readOn = read.readOn?.[provider]
      if (held.size > 0 && readOn !== undefined) {
        this.usageReadOn.set(provider, { tag: readOn, lifeSince: 0 })
      }
      const seen = new Map<string, UsageWindowSeen>()
      for (const window of read.seen[provider] ?? []) {
        if (seen.size >= MAX_USAGE_WINDOWS) break
        seen.set(window.window, window)
      }
      if (seen.size > 0) this.windowsSeen.set(provider, seen)
    }
  }

  private keepTheUsage(): void {
    this.aWindowFirstSeenUnkept = false
    const kept = this.deps.usageKept
    if (kept === undefined) return
    try {
      kept.write({
        readings: this.usageAsHeld(),
        seen: this.usageWindowsSeen(),
        ...(this.usageReadOn.size === 0
          ? {}
          : { readOn: Object.fromEntries([...this.usageReadOn].map(([p, on]) => [p, on.tag])) }),
      })
    } catch (error) {
      console.warn(`runtime host could not keep the usage readings: ${errorMessage(error)}`)
    }
  }

  private providerLoginChanged(provider: Provider, profileId?: string): void {
    this.deps.limitsReader?.signInChanged()
    this.providerLimitFacts.retireHistory()
    this.publishProviderLimitFactsSoon()
    for (const { session } of this.slots.values()) {
      if (
        session !== null &&
        session !== undefined &&
        session.provider === provider &&
        (profileId === undefined || session.profileId === profileId)
      ) {
        session.runsOnAnOlderLogin = true
      }
    }
    this.forgetTheUsage(provider)
    this.providersMoved({ what: 'login', provider })
  }

  providerSetupCompleted(provider: Provider, kind: 'install' | 'signIn' = 'signIn'): void {
    if (kind === 'signIn') this.rejectedMachineLogins.delete(provider)
    this.modelCatalogues.forgetProviderModels(provider)
    this.providerLoginChanged(provider)
  }

  private readsAnOlderLogin(session: HostedSession): boolean {
    return session.runsOnAnOlderLogin === true || session.itsSignInMovedOn === true
  }

  private doubtTheUsage(provider: Provider): void {
    const held = this.oneAccountHeld(provider)
    if (held === undefined || held !== this.knownAccount?.id) {
      this.forgetTheUsage(provider)
      return
    }
    if (this.usageUnconfirmed.has(provider)) return
    this.usageUnconfirmed.add(provider)
    this.providersMoved({ what: 'usage', provider })
  }

  private forgetTheUsage(provider: Provider): void {
    this.usageUnconfirmed.delete(provider)
    this.usageReadOn.delete(provider)
    if (!this.usage.delete(provider)) return
    this.keepTheUsage()
    this.providersMoved({ what: 'usage', provider })
  }

  private providersMoved(message: ProvidersChangedMessage): void {
    try {
      this.deps.providersMoved?.(message)
    } catch (error) {
      console.warn(
        `runtime host could not tell the windows a provider fact moved: ${errorMessage(error)}`,
      )
    }
  }

  private async withProviderLaunch<T>(what: string, run: () => T | Promise<T>): Promise<T> {
    const launch = this.launches.open(what)
    const work = (async () => {
      if (this.deps.beforeProviderLaunch) await this.deps.beforeProviderLaunch()
      launch.signal.throwIfAborted()
      return await run()
    })()
    this.launches.finish(launch, work)
    return await work
  }

  private async bringTheKeyToItsHomes(provider: Provider): Promise<string | null> {
    const ops = this.deps.providerAuth
    if (!ops) return null
    try {
      return await this.withProviderLaunch(`${provider} API-key synchronization`, () =>
        ops.bringTheKeyToItsHomes(provider),
      )
    } catch (error) {
      console.warn(
        `runtime host could not bring ${provider}'s homes in line with its API key: ${errorMessage(error)}`,
      )
      return 'BroCrew could not tell the provider about the key yet; it will at its next launch.'
    }
  }

  checkProviderAuth(provider: Provider, profileId: string, probe = false): Promise<AuthState> {
    if (!probe) return this.runProviderAuthCheck(provider, profileId, false)
    const key = `${provider}:${profileId}`
    const held = this.manualAuthChecks.get(key)
    if (held !== undefined) return held
    const work = this.runProviderAuthCheck(provider, profileId, true).finally(() => {
      if (this.manualAuthChecks.get(key) === work) this.manualAuthChecks.delete(key)
    })
    this.manualAuthChecks.set(key, work)
    return work
  }

  private async runProviderAuthCheck(
    provider: Provider,
    profileId: string,
    probe: boolean,
  ): Promise<AuthState> {
    const ops = this.deps.providerAuth
    if (!ops) return { state: 'unknown', reason: 'this app build cannot check provider sign-ins' }
    let launch: Launch
    try {
      let copying: Promise<void> | undefined
      while ((copying = this.homeCopyJobs.get(profileSignInKey(provider, profileId))) !== undefined)
        await copying
      launch = this.launches.open(`${provider} sign-in check`)
      this.rememberHomeLaunch(provider, profileId, launch)
    } catch {
      return { state: 'unknown', reason: 'BroCrew is shutting down, so it did not ask.' }
    }
    if (this.deps.beforeProviderLaunch) {
      try {
        await this.deps.beforeProviderLaunch()
        launch.signal.throwIfAborted()
      } catch (error) {
        this.launches.finish(launch)
        return {
          state: 'unknown',
          reason: signInNotChecked(didNotAnswerInTime(error)),
          ...this.logAuthDiagnostic('check', provider, error),
        }
      }
    }
    const rejected = this.rejectedMachineLogins.get(provider)
    const work = Promise.resolve().then(() => {
      if (launch.signal.aborted)
        return { state: 'unknown' as const, reason: 'The sign-in check was cancelled.' }
      return probe
        ? (ops.probe?.(provider, profileId, launch.signal) ?? {
            state: 'unknown' as const,
            reason: 'This app build cannot probe this sign-in.',
          })
        : ops.check(provider, profileId, launch.signal)
    })
    this.launches.finish(launch, work)
    try {
      const result = await work
      if (launch.signal.aborted || this.launches.closed)
        return { state: 'unknown', reason: 'The sign-in check was cancelled.' }
      if (result.state !== 'usable' || result.login === 'api-key' || this.aKeyIsSaved(provider))
        return result
      if (probe && this.rejectedMachineLogins.get(provider) === rejected) {
        this.rejectedMachineLogins.delete(provider)
        this.providersMoved({ what: 'login', provider })
      }
      return this.rejectedMachineLogins.has(provider)
        ? {
            state: 'stale',
            reason:
              'Claude refused the current sign-in. Sign in again, or check it with Claude Code.',
          }
        : result
    } catch (error) {
      this.launches.cancel(launch)
      if (error instanceof ProfileUnopenable) return { state: 'unknown', reason: error.message }
      return {
        state: 'unknown',
        reason: signInNotChecked(didNotAnswerInTime(error)),
        ...this.logAuthDiagnostic('check', provider, error),
      }
    }
  }

  private readonly homeCopies = new Map<
    Provider,
    Map<string, ProviderHomesReprovision['profiles'][number]>
  >()
  private readonly homeCopyJobs = new Map<string, Promise<void>>()
  private readonly homeCopyRestarts = new Map<string, Promise<void>>()
  private readonly homeCopyBarriers = new Map<string, { ready: Promise<void>; release(): void }>()
  private readonly homeLaunches = new Map<
    Launch,
    { provider: Provider; profileId: string; uncertain?: boolean }
  >()
  private readonly homeCopyWaitingLaunches = new Set<Launch>()

  private rememberHomeLaunch(provider: Provider, profileId: string, launch: Launch): void {
    this.homeLaunches.set(launch, { provider, profileId })
    void launch.settled.then(() => {
      if (this.homeLaunches.get(launch)?.uncertain !== true) this.homeLaunches.delete(launch)
      this.homeCopyWaitingLaunches.delete(launch)
      void this.copyHomeWhenIdle(provider, profileId)
    })
  }

  private releaseHomeCopyBarrier(provider: Provider, profileId: string): void {
    const key = profileSignInKey(provider, profileId)
    this.homeCopyBarriers.get(key)?.release()
    this.homeCopyBarriers.delete(key)
  }

  async reprovisionProviderHomes(
    provider: Provider,
    statusOnly = false,
  ): Promise<ProviderHomesReprovision> {
    if (providerDescriptor(provider).credential !== 'profile-or-key')
      throw new Error('This provider does not keep a separate sign-in for each agent.')
    let rows = this.homeCopies.get(provider)
    const restartActive = [...this.homeCopyRestarts.keys()].some((key) =>
      key.startsWith(`${provider}:`),
    )
    if (
      !statusOnly &&
      !restartActive &&
      ![...(rows?.values() ?? [])].some((one) => one.state === 'pending')
    ) {
      rows = new Map(
        this.profiles(provider).map((profileId) => [
          profileId,
          { profileId, state: 'pending' as const },
        ]),
      )
      this.homeCopies.set(provider, rows)
      for (const profileId of rows.keys()) {
        let release!: () => void
        const ready = new Promise<void>((resolve) => {
          release = resolve
        })
        this.homeCopyBarriers.set(profileSignInKey(provider, profileId), { ready, release })
      }
      for (const profileId of rows.keys()) await this.copyHomeWhenIdle(provider, profileId)
    }
    const profiles = [...(rows?.values() ?? [])]
    return {
      replaced: profiles.filter((one) => one.state === 'replaced').length,
      pending: profiles.filter((one) => one.state === 'pending').length,
      skipped: profiles.filter((one) => one.state === 'skipped').length,
      failed: profiles.filter((one) => one.state === 'failed').length,
      profiles,
    }
  }

  private copyHomeWhenIdle(provider: Provider, profileId: string): Promise<void> {
    const rows = this.homeCopies.get(provider)
    const key = profileSignInKey(provider, profileId)
    const current = this.homeCopyRestarts.get(key)
    if (current) return current
    if (rows?.get(profileId)?.state !== 'pending') return Promise.resolve()
    const copying = this.homeCopyJobs.get(key)
    if (copying) return copying
    try {
      if (this.deps.apiKeys?.status(provider).set === true) {
        rows.set(profileId, { profileId, state: 'skipped', reason: 'api-key' })
        this.releaseHomeCopyBarrier(provider, profileId)
        return Promise.resolve()
      }
    } catch {
      rows.set(profileId, { profileId, state: 'skipped', reason: 'key-status-unavailable' })
      this.releaseHomeCopyBarrier(provider, profileId)
      return Promise.resolve()
    }
    const stopFailed = () =>
      [...this.homeLaunches.values()].some(
        (home) =>
          home.provider === provider && home.profileId === profileId && home.uncertain === true,
      )
    if (stopFailed()) {
      rows.set(profileId, { profileId, state: 'failed', reason: 'stop-failed' })
      this.releaseHomeCopyBarrier(provider, profileId)
      return Promise.resolve()
    }
    const slots = [...this.slots.values()].filter(
      (slot) =>
        slot.provider === provider &&
        slot.profileId === profileId &&
        !this.homeCopyWaitingLaunches.has(slot.launch),
    )
    if (
      [...this.homeLaunches].some(
        ([launch, home]) =>
          home.provider === provider &&
          home.profileId === profileId &&
          !this.homeCopyWaitingLaunches.has(launch) &&
          !slots.some((slot) => slot.launch === launch),
      )
    )
      return Promise.resolve()
    if (
      slots.some(
        (slot) =>
          slot.session === null ||
          onItsWayOut(slot) ||
          this.aTurnRunsIn(slot.session) ||
          this.whatAReopenWaitsFor(slot.session) !== null,
      )
    )
      return Promise.resolve()
    const sessions = slots.flatMap((slot) => (slot.session === null ? [] : [slot.session]))
    for (const session of sessions) this.signInStops.add(session)
    let copied: ProviderHomesReprovision['profiles'][number] | undefined
    let confirmedStopped = false
    const job = Promise.resolve().then(async () => {
      try {
        await Promise.all(sessions.map((session) => this.close(session.id, THE_APP_ITSELF)))
        await Promise.all(sessions.map((session) => session.terminated))
        if (stopFailed()) throw new Error('Provider cleanup could not be confirmed')
        confirmedStopped = true
        const keyStatus = (): boolean => this.deps.apiKeys?.status(provider).set === true
        if (keyStatus()) {
          copied = { profileId, state: 'skipped', reason: 'api-key' }
          return
        }
        const outcome = await this.reprovisionProviderAuth(provider, profileId)
        copied =
          outcome === 'replaced'
            ? { profileId, state: 'replaced' }
            : { profileId, state: 'skipped', reason: 'unchanged' }
      } catch {
        copied = {
          profileId,
          state: 'failed',
          reason: confirmedStopped ? 'copy-failed' : 'stop-failed',
        }
      } finally {
        this.homeCopyJobs.delete(key)
        this.releaseHomeCopyBarrier(provider, profileId)
      }
    })
    this.homeCopyJobs.set(key, job)
    const restarting = job
      .then(async () => {
        for (const session of sessions) {
          this.signInStops.delete(session)
          if (!confirmedStopped || this.launches.closed || this.keptStopped(session.id)) continue
          const alreadyStarting = this.slots.get(session.id)
          if (alreadyStarting !== undefined) {
            await alreadyStarting.arrived
            if (this.slots.get(session.id)?.session == null)
              copied = { profileId, state: 'failed', reason: 'restart-failed' }
            continue
          }
          const watching =
            session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null
          try {
            await this.resumeSession(session.id, watching, null, undefined, 'not-read')
          } catch {
            const raced = this.slots.get(session.id)
            if (raced !== undefined) await raced.arrived
            if (this.slots.get(session.id)?.session == null)
              copied = { profileId, state: 'failed', reason: 'restart-failed' }
          }
        }
        if (rows.get(profileId)?.state === 'pending' && copied !== undefined)
          rows.set(profileId, copied)
      })
      .finally(() => this.homeCopyRestarts.delete(key))
    this.homeCopyRestarts.set(key, restarting)
    return restarting
  }

  async reprovisionProviderAuth(
    provider: Provider,
    profileId: string,
  ): Promise<ReprovisionOutcome> {
    try {
      return await this.recopy(provider, profileId)
    } catch (error) {
      const shortage = transientSetupFailureOf(error)
      if (shortage === null) throw error
      console.warn(`runtime host did not re-copy a sign-in: ${errorMessage(error)}`)
      throw new Error(
        shortage === 'EMFILE'
          ? 'Your machine sign-in was not copied: BroCrew had too many files open. Quit and reopen BroCrew, then copy it again.'
          : 'Your machine sign-in was not copied: this machine ran short of open files, processes or memory. Close an app you are not using, or quit and reopen BroCrew, then copy it again.',
        { cause: error },
      )
    } finally {
      this.providerLoginChanged(provider, profileId)
    }
  }

  private async startedAfterARefusedCopy(
    provider: Provider,
    profileId: string | null,
    launch: () => Promise<SessionHandle>,
    stillWanted: () => boolean,
  ): Promise<SessionHandle> {
    try {
      return await launch()
    } catch (refused) {
      const copy = this.theCopyRefused(provider, refused)
      if (profileId === null || copy === null || !stillWanted()) throw refused
      if (!(await this.replaceARefusedCopy(provider, profileId, 'at a start', copy, stillWanted))) {
        throw refused
      }
      if (!stillWanted()) throw refused
      return await launch()
    }
  }

  private sayingARefusedCopyIsReplaced(session: HostedSession, event: RuntimeEvent): RuntimeEvent {
    return event.type === 'error' &&
      event.cause === 'auth' &&
      event.onAKey !== true &&
      this.deps.providerAuth !== undefined &&
      !this.aKeyIsSaved(session.provider) &&
      providerAuthPolicies[session.provider].copy.same(
        session.handle.signInCopyAtLaunch?.(),
        this.theCopyHeldNow(session),
      )
      ? { ...event, replacesRefusedSignIn: true }
      : event
  }

  private theCopyRefused(provider: Provider, error: unknown): unknown | null {
    const copy = providerAuthPolicies[provider].copy.refused(error)
    return copy !== null && this.deps.providerAuth !== undefined && !this.aKeyIsSaved(provider)
      ? copy
      : null
  }

  private theCopyHeldNow(session: HostedSession): unknown | null {
    const ops = this.deps.providerAuth
    const copy = providerAuthPolicies[session.provider].copy
    if (copy.read === undefined || !ops) return null
    try {
      return copy.read(ops.credentialHome(session.provider, session.profileId))
    } catch {
      return null
    }
  }

  private async replaceARefusedCopy(
    provider: Provider,
    profileId: string,
    refused: 'at a start' | 'in a turn',
    copy: unknown,
    stillWanted: () => boolean,
  ): Promise<boolean> {
    const ops = this.deps.providerAuth
    if (!ops || this.aKeyIsSaved(provider)) return false
    let credential: ResourceClaim
    try {
      credential = this.claimCredentialHome(
        ops,
        provider,
        profileId,
        'a refused copy’s replacement',
      )
    } catch {
      return false
    }
    try {
      const from = await ops.replaceARefusedCopy(provider, profileId, copy, stillWanted)
      if (from === 'not-tried') return false
      console.warn(
        `runtime host replaced profile ${profileId}'s ${providerDescriptor(provider).displayName} sign-in, which ${providerDescriptor(provider).displayName} refused ${refused}, with ${from === 'the-computers' ? "this computer's" : "BroBot's own"}, refreshed later`,
      )
      return true
    } catch (error) {
      console.warn(
        `runtime host did not replace profile ${profileId}'s refused ${providerDescriptor(provider).displayName} sign-in: ${errorMessage(error)}`,
      )
      return false
    } finally {
      credential.release()
      this.forgetModels(provider, profileId)
    }
  }

  private async recopy(provider: Provider, profileId: string): Promise<ReprovisionOutcome> {
    const ops = this.deps.providerAuth
    if (!ops) throw new Error('this app build cannot re-copy provider sign-ins')
    const credential = this.claimCredentialHome(ops, provider, profileId, 'a re-copy')
    try {
      return await ops.reprovision(provider, profileId)
    } finally {
      credential.release()
      this.forgetModels(provider, profileId)
    }
  }

  private claimCredentialHome(
    ops: ProviderAuthOps,
    provider: Provider,
    profileId: string,
    gesture: string,
  ): ResourceClaim {
    const home = ops.credentialHome(provider, profileId)
    const claimed = claimResource(credentialHomeKey(home), gesture)
    if (!claimed.ok) {
      throw new Error(
        `this profile's ${provider} sign-in is already being changed — ${claimed.holder} is in ` +
          `progress — so ${gesture} was not started. Wait for that to finish and try again.`,
      )
    }
    return claimed.claim
  }

  async signInProvider(provider: Provider, profileId: string): Promise<ProviderSignInResult> {
    const ops = this.deps.providerAuth
    if (!ops) throw new Error('this app build cannot start provider sign-ins')
    const key = signInKey(provider, profileId)
    const port = claimResource(oauthPortKey(provider, profileId), profileId)
    if (!port.ok) throw signInHeldBy(provider, port.holder, profileId)
    let credential: ResourceClaim
    try {
      credential = this.claimCredentialHome(ops, provider, profileId, 'a sign-in')
    } catch (error) {
      port.claim.release()
      throw error
    }
    try {
      return await this.runSignIn(ops, provider, profileId, key, port.claim, credential)
    } finally {
      port.claim.release()
      credential.release()
      this.providerLoginChanged(provider, profileId)
    }
  }

  private async runSignIn(
    ops: ProviderAuthOps,
    provider: Provider,
    profileId: string,
    key: string,
    port: ResourceClaim,
    credential: ResourceClaim,
  ): Promise<ProviderSignInResult> {
    const launch = this.launches.open(`${provider} sign-in`)
    this.signIns.set(key, {
      profileId,
      signIn: pendingSignIn(() => this.launches.cancel(launch)),
    })

    let signIn: ProviderSignIn
    try {
      if (this.deps.beforeProviderLaunch) {
        await this.deps.beforeProviderLaunch()
        launch.signal.throwIfAborted()
      }
      signIn = await ops.signIn(provider, profileId, launch.signal)
    } catch (error) {
      this.signIns.delete(key)
      this.launches.finish(launch)
      throw error
    }
    if (launch.signal.aborted) {
      this.signIns.delete(key)
      this.forgetModels(provider, profileId)
      const { teardown, bounded } = this.startCancel(signIn, launch)
      port.release(teardown)
      credential.release(teardown)
      await bounded
      return { success: false, detail: 'canceled', state: { state: 'unknown', reason: 'canceled' } }
    }
    this.signIns.set(key, { profileId, signIn })
    try {
      void this.deps.openExternal?.(signIn.authUrl).catch(() => {})
      const outcome = await signIn.completed
      return {
        success: outcome.success,
        ...(outcome.error ? { detail: outcome.error } : {}),
        state: outcome.state,
      }
    } finally {
      this.signIns.delete(key)
      this.forgetModels(provider, profileId)
      const { teardown, bounded } = this.startCancel(signIn, launch)
      port.release(teardown)
      credential.release(teardown)
      await bounded
    }
  }

  async cancelProviderSignIn(provider: Provider, profileId: string): Promise<void> {
    const held = this.signIns.get(signInKey(provider, profileId))
    if (!held || held.profileId !== profileId) return
    await this.boundedCancel(held.signIn)
  }

  private async boundedCancel(signIn: ProviderSignIn, launch?: Launch): Promise<void> {
    await this.startCancel(signIn, launch).bounded
  }

  private startCancel(
    signIn: ProviderSignIn,
    launch?: Launch,
  ): { teardown: Promise<unknown>; bounded: Promise<void> } {
    const teardown = signIn.cancel()
    teardown.catch(() => {})
    if (launch) this.launches.finish(launch, teardown)
    return {
      teardown,
      bounded: withDeadline(teardown, SIGN_IN_CANCEL_TIMEOUT_MS, 'sign-in cancel').then(
        () => {},
        () => {},
      ),
    }
  }

  private logAuthDiagnostic(
    verb: string,
    provider: Provider,
    error: unknown,
  ): Record<never, never> {
    console.warn(
      `provider sign-in ${verb} failed for ${provider}:`,
      error instanceof Error ? error.message : String(error),
    )
    return {}
  }

  close(sessionId: string, by: Caller): Promise<void> {
    const slot = this.slots.get(sessionId)
    if (!slot) return Promise.resolve()
    this.assertMayControl(slot, by)
    if (aPersonIsAsking(by)) this.aPersonEndedItsWait(sessionId)
    if (slot.session === null) {
      slot.phase = 'closing'
      this.stateMayHaveMoved(sessionId)
      this.theWorldMoved('conversations')
      this.launches.cancel(slot.launch)
      return this.awaitArrival(slot)
    }
    slot.phase = 'closing'
    this.stateMayHaveMoved(sessionId)
    this.theWorldMoved('conversations')
    return (slot.session.closing ??= this.tearDown(slot.session))
  }

  private async awaitArrival(slot: SessionSlot): Promise<void> {
    if (await settledWithin(slot.arrived, this.closeDrainTimeoutMs)) return
    console.warn(
      `runtime session ${slot.id}: its provider was still starting after ${this.closeDrainTimeoutMs}ms — ` +
        'carrying on without it, so a provider process may still be starting. It will be stopped ' +
        'rather than registered whenever it arrives.',
    )
  }

  private async settleTeardown(sessionId: string): Promise<void> {
    const slot = this.slots.get(sessionId)
    if (slot !== undefined && !(await this.itsTeardownEnded(slot))) return
    const now = this.slots.get(sessionId)
    await this.launches.gone(
      sessionId,
      now !== undefined && !onItsWayOut(now) ? now.launch : undefined,
    )
  }

  private async itsTeardownEnded(slot: SessionSlot): Promise<boolean> {
    if (slot.session === null) {
      if (!onItsWayOut(slot)) return false
      await slot.arrived
      return true
    }
    const teardown = slot.session.closing ?? slot.session.finalizing
    if (teardown === null) return false
    await teardown.catch(() => undefined)
    return true
  }

  private async tearDown(session: HostedSession): Promise<void> {
    const stopped = await this.stopProvider(session)
    const drained = await settledWithin(session.pump, this.closeDrainTimeoutMs)
    if (!drained) {
      console.warn(
        `runtime session ${session.id} did not drain within ${this.closeDrainTimeoutMs}ms` +
          (stopped ? '' : ' — because the provider above it never stopped, not on its own account'),
      )
    }
    await this.finalize(session, drained ? 'closed' : 'close-timeout')
  }

  private stopProvider(session: HostedSession): Promise<boolean> {
    return (session.stopping ??= this.doStopProvider(session))
  }

  private async doStopProvider(session: HostedSession): Promise<boolean> {
    const closing = (async () => session.handle.close())().catch((error: unknown) => {
      const home = this.homeLaunches.get(session.launch)
      if (home !== undefined) home.uncertain = true
      console.warn(`runtime session ${session.id} failed to close: ${errorMessage(error)}`)
    })
    session.terminated = this.terminationOf(session.handle, closing, session.launch)
    if (await settledWithin(session.terminated, this.closeDrainTimeoutMs)) return true
    console.warn(
      `runtime session ${session.id}: the provider did not confirm it stopped within ` +
        `${this.closeDrainTimeoutMs}ms — letting go of the handle anyway, so a provider process may ` +
        'still be running',
    )
    return false
  }

  private terminationOf(
    handle: SessionHandle,
    teardown: Promise<void>,
    launch?: Launch,
  ): Promise<void> {
    const exit = handle.awaitProcessExit?.()
    exit?.catch(() => {
      const home = launch === undefined ? undefined : this.homeLaunches.get(launch)
      if (home !== undefined) home.uncertain = true
    })
    if (exit === undefined) return teardown
    return Promise.all([teardown, exit]).then(() => undefined)
  }

  private rejectedConnectionTermination(error: unknown, launch: Launch): Promise<void> | undefined {
    if (!(error instanceof RejectedSessionLaunch)) return undefined
    return error.terminated.catch((cause: unknown) => {
      const home = this.homeLaunches.get(launch)
      if (home !== undefined) home.uncertain = true
      throw cause
    })
  }
  private finalize(session: HostedSession, ending: SessionEnding): Promise<void> {
    this.stateMayHaveMoved(session.id)
    return (session.finalizing ??= this.runFinalize(session, ending))
  }

  private async runFinalize(session: HostedSession, ending: SessionEnding): Promise<void> {
    this.handOnWhatItHeld(session)

    let stopped = false
    try {
      stopped = await this.stopProvider(session)
    } catch (error) {
      console.warn(
        `runtime session ${session.id}: stopping the provider threw: ${errorMessage(error)}`,
      )
    }

    this.record(session, () => {
      const abandoned = this.deps.store.terminate(
        session.id,
        terminalFor(ending),
        stopped ? 'ended' : 'unknown',
        this.now(),
      )
      if (abandoned) {
        console.warn(`runtime session ${session.id}: a turn was still open (${ending})`)
      }
    })

    this.settleTheNoticesFor(session)

    try {
      session.liveness.stop()
    } catch (error) {
      console.warn(`runtime session ${session.id}: stopping liveness threw: ${errorMessage(error)}`)
    }
    this.slots.delete(session.id)
    void Promise.resolve(session.terminated).then(
      () => this.copyHomeWhenIdle(session.provider, session.profileId),
      () => undefined,
    )
    this.waitAsLastRead.delete(session.id)
    this.workOutAsLastRead.delete(session.id)
    this.owedAsLastRead.delete(session.id)
    this.stateMayHaveMoved(session.id)
    this.theWorldMoved('conversations')
    this.announceTheWorkItHolds(session.id)
    this.launches.finish(session.launch, session.terminated ?? undefined)
    void Promise.resolve(session.terminated).then(
      () => {
        if (
          this.heldAtAStop
            .get(session.id)
            ?.some(
              (queued) => queued.authorship.appNotice !== 'a-scheduled-job-that-will-not-run',
            ) &&
          !this.signInStops.has(session) &&
          session.diedOnAStaleSignIn !== true
        ) {
          const start = (): Promise<void> => this.startForWhatItHeld(session)
          return this.signInRestarts.has(session) ? this.signInReopens.run(start) : start()
        }
      },
      () => undefined,
    )
    this.armItsWakeUpAtItsStop(session)
  }

  private async startForWhatItHeld(session: HostedSession): Promise<void> {
    const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null
    await this.startToSendWhatItHeld(session.id, watching)
  }

  private async startToSendWhatItHeld(
    sessionId: string,
    watching: RuntimeEventSink | null,
  ): Promise<void> {
    try {
      if (!this.heldAtAStop.has(sessionId) || this.launches.closed) return
      if (this.keptStopped(sessionId)) return
      if (this.servicesHoldWhatItHeld(sessionId)) return
      await this.ensureRunning(sessionId, watching)
    } catch (error) {
      console.warn(
        `runtime host could not start ${sessionId} for the messages it held: ${errorMessage(error)}`,
      )
    } finally {
      this.reopeningForWhatWaited.delete(sessionId)
      this.reopeningForApprovedTools.delete(sessionId)
    }
  }

  private keptStopped(sessionId: string): boolean {
    return this.archived.has(sessionId) || this.settingAside.has(sessionId)
  }

  async archiveConversation(sessionId: string): Promise<ArchiveOutcome> {
    if (this.deps.store.recordedOne(sessionId) === null) {
      return { done: false, refusal: 'There is no conversation by that name to archive.' }
    }
    const tree = this.deps.store.conversationTree(sessionId)
    if (tree.some((conversation) => this.settingAside.has(conversation))) {
      return { done: false, refusal: 'This conversation is already being archived or deleted.' }
    }
    try {
      this.archived.add(tree, this.now())
      this.moveTheListing()
      this.moveThePersons()
    } catch (error) {
      return { done: false, refusal: errorMessage(error) }
    }
    this.linkAnswers.invalidate()
    for (const conversation of tree) {
      this.bringingBack.delete(conversation)
      this.settingAside.set(conversation, 'archive')
    }
    try {
      await this.stopTheTree(tree)
      await Promise.allSettled(
        tree.flatMap((conversation) => this.startsInFlight.get(conversation) ?? []),
      )
    } finally {
      this.linkAnswers.invalidate()
      for (const conversation of tree) this.settingAside.delete(conversation)
    }
    this.theWorldMoved('conversations')
    return { done: true, conversations: tree }
  }

  restoreConversation(sessionId: string): ArchiveOutcome {
    return this.restoreFromTheArchive(sessionId, null)
  }

  private restoreFromTheArchive(sessionId: string, saying: string | null): ArchiveOutcome {
    if (this.deps.store.recordedOne(sessionId) === null) {
      return { done: false, refusal: 'There is no conversation by that name to restore.' }
    }
    const archived = this.theArchivedTreeOf(sessionId)
    if (archived.length === 0) {
      return { done: false, refusal: 'Neither this conversation nor any below it is archived.' }
    }
    const setAside = archived.flatMap((conversation) => this.settingAside.get(conversation) ?? [])
    if (setAside[0] !== undefined) {
      return {
        done: false,
        refusal: `This conversation${SET_ASIDE_FOR[setAside[0]]} now. Restore it once that is done.`,
      }
    }
    try {
      this.archived.remove(archived)
      this.moveTheListing()
      this.moveThePersons()
    } catch (error) {
      return { done: false, refusal: errorMessage(error) }
    }
    if (saying !== null) {
      for (const conversation of archived) {
        try {
          this.writeIntoItsLedger(conversation, { type: 'restored_from_archive', saying })
        } catch (error) {
          console.warn(
            `runtime host could not say in ${conversation} who restored it: ${errorMessage(error)}`,
          )
        }
      }
    }
    this.carryOnAfterTheStop(archived, NEWER_WORDS_AFTER_THE_ARCHIVE)
    this.theWorldMoved('conversations')
    return { done: true, conversations: archived }
  }

  restoreAsAnAgent(address: string, by: Caller, me: string): RestoredByAnAgent {
    const named = this.deps.store.workByLabel(address)?.owner ?? address
    const sessionId = this.theOneInItsPlace(named)
    if (this.deps.store.recordedOne(sessionId) === null) return { is: 'no-such-agent' }
    const archived = this.theArchivedTreeOf(sessionId)
    if (archived.length === 0) {
      return this.withinMessagingReach(sessionId, by, me)
        ? { is: 'not-archived' }
        : { is: 'no-such-agent' }
    }
    const beingSetAside = archived.some((conversation) => this.settingAside.has(conversation))
    const restored = this.restoreFromTheArchive(
      sessionId,
      `Brought back from the archive: ${this.whatToCallTheConversation(me)} restored it.`,
    )
    if (!restored.done) {
      return { is: beingSetAside ? 'being-set-aside' : 'could-not', said: restored.refusal }
    }
    const now = this.now()
    return {
      is: 'restored',
      conversations: restored.conversations.map((conversation) => ({
        conversation,
        carriesOn: this.howItCarriesOn(conversation, now),
      })),
      readAt: now,
    }
  }

  private howItCarriesOn(conversation: string, now: number): CarriesOn {
    const wakeUp = this.wakeUps.get(conversation)
    if (
      this.startsInFlight.has(conversation) ||
      this.slots.has(conversation) ||
      (wakeUp !== undefined && wakeUp.startAt <= now)
    ) {
      return 'starting'
    }
    return wakeUp === undefined ? null : { wakesAt: wakeUp.startAt }
  }

  private bringBackFromTheArchive(
    sessionId: string,
    sink: RuntimeEventSink | null,
  ): BringingBack | null {
    if (!this.archived.has(sessionId)) return null
    const archived = this.theArchivedTreeOf(sessionId)
    const archivedAt = new Map(
      archived.map((conversation) => [conversation, this.archived.archivedAt(conversation) ?? 0]),
    )
    this.archived.remove(archived)
    this.moveTheListing()
    this.moveThePersons()
    const cause =
      this.whatBringsItBack.get(sessionId) ?? (sink === null ? 'it was started' : 'you opened it')
    this.whatBringsItBack.delete(sessionId)
    const back: BringingBack = {
      others: archived.filter((conversation) => conversation !== sessionId),
      archivedAt,
      saying: `Brought back from the archive: ${cause}.`,
    }
    this.bringingBack.set(sessionId, back)
    this.theWorldMoved('conversations')
    return back
  }

  private putBackWhatAFailedStartBroughtBack(sessionId: string, back: BringingBack): void {
    if (this.bringingBack.get(sessionId) !== back) return
    this.bringingBack.delete(sessionId)
    try {
      for (const [conversation, at] of back.archivedAt) this.archived.add([conversation], at)
      this.moveTheListing()
      this.moveThePersons()
    } catch (error) {
      console.warn(
        `runtime host could not put ${sessionId} back in the archive after its start failed: ${errorMessage(error)}`,
      )
    }
    this.theWorldMoved('conversations')
  }

  private noteWhatBringsItBack(sessionId: string, cause: () => string): void {
    if (this.archived.has(sessionId)) this.whatBringsItBack.set(sessionId, cause())
  }

  private theArchivedTreeOf(sessionId: string): string[] {
    let top = sessionId
    for (
      let parent = this.deps.store.parentOf(top);
      parent !== null && this.archived.has(parent);
      parent = this.deps.store.parentOf(parent)
    ) {
      top = parent
    }
    return this.deps.store
      .conversationTree(top)
      .filter((conversation) => this.archived.has(conversation))
  }

  private carryOnAfterTheStop(
    conversations: readonly string[],
    earlierWordsEndBecause: string,
  ): void {
    for (const conversation of conversations) {
      try {
        this.armItsWakeUp(conversation, Promise.resolve(), earlierWordsEndBecause)
      } catch (error) {
        console.warn(`runtime host could not arm ${conversation}'s wake-up: ${errorMessage(error)}`)
      }
    }
    for (const conversation of conversations) void this.startToSendWhatItHeld(conversation, null)
  }

  private async stopTheTree(tree: readonly string[]): Promise<void> {
    const stops = tree.map((conversation) => {
      this.forgetItsWakeUp(conversation)
      let stop: Promise<void>
      try {
        stop = this.close(conversation, THE_APP_ITSELF)
      } catch (error) {
        stop = Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
      return stop.catch((error: unknown) => {
        console.warn(`runtime host could not stop ${conversation}: ${errorMessage(error)}`)
      })
    })
    await Promise.all(stops)
  }

  deleteVerdict(sessionId: string): DeleteVerdict {
    const refused = (refusal: string): DeleteVerdict => ({ ok: false, refusal })
    if (this.deps.store.recordedOne(sessionId) === null) {
      return refused('There is no conversation by that name to delete.')
    }
    const name = (conversation: string): string => this.whatToCallTheConversation(conversation)
    if (this.deps.store.parentOf(sessionId) !== null) {
      let top = sessionId
      for (let parent = this.deps.store.parentOf(top); parent !== null;) {
        top = parent
        parent = this.deps.store.parentOf(top)
      }
      return refused(
        `${name(sessionId)} was started as a helper, so it is deleted only with ${name(top)}, the ` +
          `conversation at the top of its tree: delete ${name(top)}, or archive this one.`,
      )
    }
    const tree = this.deps.store.conversationTree(sessionId)
    const [tie] = this.deps.store.whatTiesTheTreeOutside(tree)
    if (tie !== undefined) {
      const here =
        tie.conversation === sessionId ? name(sessionId) : `its helper ${name(tie.conversation)}`
      const other = name(tie.with)
      return refused(
        `${name(sessionId)} can’t be deleted: ${tieInWords(tie.how, here, other)}, and those ` +
          `records are ${other}’s as much as its own. Archive ${name(sessionId)} instead; that ` +
          'keeps everything.',
      )
    }
    const parts: DeletePart[] = []
    const helpers = tree
      .slice(1)
      .map((conversation) => ({ conversation, name: name(conversation) }))
    parts.push({
      id: 'records',
      kind: 'records',
      conversation: sessionId,
      says:
        `Its messages, pieces of work and the files kept for them, and its questions` +
        (helpers.length === 0
          ? '.'
          : `, with the same of the ${String(helpers.length)} helper${
              helpers.length === 1 ? '' : 's'
            } below it: ${helpers.map((helper) => helper.name).join(', ')}.`),
      paths: [],
      bytes: null,
    })
    const stays = ['Copies of what it sent to other conversations stay in theirs.']
    const cannot = [
      'The recovery copies in the data folder still hold its records until newer copies replace ' +
        'them; restoring one would bring those records back, but not the files a delete removes. ' +
        'A delete doesn’t remove them: each is a copy of all your conversations, so removing one ' +
        'would take every other conversation’s recovery point with it.',
    ]
    const providers = new Set<Provider>()
    for (const conversation of tree) {
      const row = this.deps.store.recordedOne(conversation)
      if (row === null) continue
      providers.add(row.provider)
      if (row.foundInUserHome) {
        stays.push(
          `${name(conversation)}’s transcript in your own ${PROVIDER_NAME[row.provider]} folder: ` +
            'BroCrew never changes your own folders.',
        )
        continue
      }
      const home = this.deps.providerHomePath(row.provider, row.profileId ?? DEFAULT_PROFILE_ID)
      const sessions = this.deps.store.providerSessionsOf(conversation)
      const files = providerFilesOf(row.provider, home, sessions)
      if (files.length > 0) {
        parts.push({
          id: `files:${conversation}`,
          kind: 'provider-files',
          conversation,
          says:
            `${name(conversation)}’s transcript and what ${PROVIDER_NAME[row.provider]} kept for it ` +
            `in its agent’s folder (${String(files.length)} item${files.length === 1 ? '' : 's'}).`,
          paths: files.map((file) => file.path),
          bytes: files.reduce((total, file) => total + file.bytes, 0),
        })
      }
      for (const note of memoryNotesOf(row.provider, home, sessions)) {
        parts.push({
          id: `note:${note.path}`,
          kind: 'memory-note',
          conversation,
          says:
            `A memory note ${name(conversation)} wrote: “${note.name}”` +
            (note.description === null ? '.' : ` — ${note.description}`),
          paths: [note.path],
          bytes: note.bytes,
        })
      }
    }
    for (const provider of providerSchema.options) {
      if (!providers.has(provider)) continue
      cannot.push(...providerDefinitions[provider].transcripts.whatDeletionLeaves())
    }
    if (parts.some((part) => part.kind === 'provider-files')) {
      stays.push(
        'A transcript you keep while deleting the records is found again as a conversation the ' +
          'next time BroCrew checks its agents’ folders.',
      )
    }
    const ends = [
      ...tree.flatMap((conversation) =>
        this.slots.has(conversation)
          ? [
              `${name(conversation)} is running: it is stopped first if the records or its ` +
                'transcript are ticked.',
            ]
          : [],
      ),
      ...this.questionsOthersAskedOf(sessionId).map(
        ({ asker }) => `The question ${name(asker)} asked it ends unanswered.`,
      ),
    ]
    return {
      ok: true,
      conversation: sessionId,
      name: name(sessionId),
      helpers,
      parts,
      ends,
      stays,
      cannot,
    }
  }

  async deleteConversation(sessionId: string, ticked: readonly string[]): Promise<DeleteOutcome> {
    const listed = this.deleteVerdict(sessionId)
    if (!listed.ok) return { done: false, refusal: listed.refusal }
    if (ticked.length === 0) {
      return { done: false, refusal: 'Nothing was ticked, so nothing was deleted.' }
    }
    const service = ticked.includes('records') ? this.theServiceOf(listed.conversation) : null
    if (service === 'unknown') return { done: false, refusal: A_SERVICE_IT_MAY_BE }
    const changed: DeleteOutcome = {
      done: false,
      refusal: 'What this conversation holds changed since the list was read: read it again.',
    }
    if (!ticked.every((id) => listed.parts.some((part) => part.id === id))) return changed
    const tree = [listed.conversation, ...listed.helpers.map(({ conversation }) => conversation)]
    if (ticked.includes('records')) {
      try {
        this.normalPoolsInTree(tree)
      } catch (error) {
        return {
          done: false,
          refusal:
            errorMessage(error) ===
            'This conversation shares workers with another conversation. Archive it instead.'
              ? errorMessage(error)
              : 'Nothing was deleted: this app could not record which workers it was removing.',
        }
      }
    }
    if (tree.some((conversation) => this.settingAside.has(conversation))) {
      return { done: false, refusal: 'This conversation is already being archived or deleted.' }
    }
    const stopping = ticked.includes('records')
      ? tree
      : tree.filter((conversation) => ticked.includes(`files:${conversation}`))
    const settingAsideFor: SetAsideFor = ticked.includes('records') ? 'delete' : 'its-files'
    this.linkAnswers.invalidate()
    for (const conversation of stopping) this.settingAside.set(conversation, settingAsideFor)
    let recordsDeleted = false
    let normalPoolsMarked = false
    try {
      await this.stopTheTree(stopping)
      await Promise.allSettled(
        stopping.flatMap((conversation) => this.startsInFlight.get(conversation) ?? []),
      )
      const running = stopping.find((conversation) => this.slots.has(conversation))
      if (running !== undefined) {
        return {
          done: false,
          refusal:
            `${this.whatToCallTheConversation(running)} didn’t stop in time, so nothing was ` +
            'deleted. Try again in a moment.',
        }
      }
      const verdict = this.deleteVerdict(sessionId)
      if (!verdict.ok) return { done: false, refusal: verdict.refusal }
      const parts = new Map(verdict.parts.map((part) => [part.id, part]))
      const now = [verdict.conversation, ...verdict.helpers.map(({ conversation }) => conversation)]
      if (ticked.some((id) => !parts.has(id)) || now.join('\n') !== tree.join('\n')) return changed
      if (ticked.includes('records')) {
        try {
          const pools = this.normalPoolsInTree(tree)
          this.markNormalPoolsRemoving(pools)
          normalPoolsMarked = pools.length > 0
        } catch (error) {
          console.warn(`runtime host could not mark workers as going: ${errorMessage(error)}`)
          return {
            done: false,
            refusal:
              'Nothing was deleted: this app could not record which workers it was removing.',
          }
        }
      }
      if (service !== null) {
        try {
          this.theServiceConversationIs(service, sessionId, 'going')
        } catch (error) {
          console.warn(`runtime host could not mark ${sessionId} as going: ${errorMessage(error)}`)
          return { done: false, refusal: A_SERVICE_IT_STAYS }
        }
      }
      const removed: string[] = []
      const left: FileLeft[] = []
      for (const id of ticked) {
        const part = parts.get(id)
        if (part === undefined || part.kind === 'records') continue
        const row = this.deps.store.recordedOne(part.conversation)
        if (row === null) continue
        const home = this.deps.providerHomePath(row.provider, row.profileId ?? DEFAULT_PROFILE_ID)
        const leftHere = await removeFromHome(home, part.paths)
        left.push(...leftHere)
        if (leftHere.length === 0) removed.push(id)
      }
      if (!ticked.includes('records')) return { done: true, removed, left, recordsKept: null }
      if (left.length > 0) {
        if (service !== null) this.theServiceConversationIs(service, sessionId, 'kept')
        return {
          done: true,
          removed,
          left,
          recordsKept:
            'Its records are kept, so what was left can still be found and deleted: close what ' +
            'has it open, then delete again.',
        }
      }
      const questions = this.questionsOthersAskedOf(sessionId)
      let deleted: TreeDeleted
      try {
        deleted = this.deps.store.deleteTheTree(tree)
      } catch (error) {
        if (service !== null) this.theServiceConversationIs(service, sessionId, 'kept')
        console.warn(`runtime host could not delete ${sessionId}'s records: ${errorMessage(error)}`)
        return {
          done: true,
          removed,
          left,
          recordsKept:
            'BroCrew couldn’t delete its records, so they are as they were; something may have ' +
            'been added to this conversation since the list was read. Delete again to try once more.',
        }
      }
      recordsDeleted = true
      this.theWorldMoved('conversations')
      this.theWorldMoved('work')
      if (service !== null) this.theServiceConversationIs(service, sessionId, 'gone')
      if (normalPoolsMarked) this.takeTheProfileExecution()
      this.forgetTheConversations(tree)
      removed.push('records')
      this.endTheQuestions(sessionId, questions)
      const root = this.deps.resourcesRoot?.() ?? null
      if (root !== null) {
        for (const { sha256, name } of deleted.filesNoOneNames) {
          left.push(...(await removeFromHome(root, [join(root, sha256, name)])))
        }
      }
      try {
        this.archived.remove(tree)
        this.moveTheListing()
        this.moveThePersons()
      } catch (error) {
        console.warn(
          `runtime host could not take deleted conversations out of the archive: ${errorMessage(error)}`,
        )
      }
      return { done: true, removed, left, recordsKept: null }
    } finally {
      this.linkAnswers.invalidate()
      if (normalPoolsMarked && !recordsDeleted) this.takeTheProfileExecution()
      for (const conversation of stopping) this.settingAside.delete(conversation)
      if (!recordsDeleted) this.carryOnAfterTheStop(stopping, NEWER_WORDS_AFTER_A_DELETE)
    }
  }

  private questionsOthersAskedOf(
    sessionId: string,
  ): readonly { readonly asker: string; readonly requestId: string }[] {
    const tree = new Set(this.deps.store.conversationTree(sessionId))
    const open: { asker: string; requestId: string }[] = []
    for (const request of this.deps.store.questionsRoutedTo(sessionId)) {
      if (!REQUEST_IS_OPEN[request.state] || tree.has(request.askedBy)) continue
      if (request.went.is !== 'the-agent-the-asker-named' && request.went.is !== 'the-parent') {
        continue
      }
      const asked = this.deps.store.questionsRaisedIn(request.askedBy).get(request.requestId)
      if (asked?.raisedBy !== 'this-app') continue
      open.push({ asker: request.askedBy, requestId: request.requestId })
    }
    return open
  }

  private endTheQuestions(
    recipient: string,
    questions: readonly { readonly asker: string; readonly requestId: string }[],
  ): void {
    for (const { asker, requestId } of questions) {
      try {
        this.writeIntoItsLedger(asker, { type: 'question_recipient_ended', requestId, recipient })
      } catch (error) {
        console.warn(
          `runtime host could not end ${asker}'s question ${requestId}: ${errorMessage(error)}`,
        )
      }
    }
  }

  private forgetTheConversations(ids: readonly string[]): void {
    const gone = new Set(ids)
    const keptByConversation: readonly { delete(id: string): boolean }[] = [
      this.statesToAsk,
      this.stateSaid,
      this.waitAsLastRead,
      this.workOutAsLastRead,
      this.contextAsLastRead,
      this.heldAsLastRead,
      this.waitsOnTheAnswerOf,
      this.waitsOnTheWorkOf,
      this.owesTheAnswersOf,
      this.owedAsLastRead,
      this.heldAtAStop,
      this.providerFailedWith,
      this.replacedBy,
      this.whatBringsItBack,
      this.bringingBack,
      this.startComingAfterTheRestart,
      this.notStalledAtTheLaunch,
      this.wakingForItsJobs,
      this.wakingForStoppedWork,
      this.cutsThisLaunchContinues,
      this.sparedAtTheLaunch,
      this.watchingTheCut,
      this.limitWakesPlanned,
      this.cutHoldsTheFirstBatch,
      this.continuationLife,
      this.aReopenIsBeingDecidedFor,
      this.renewedForItsReopen,
      this.reopenedOnAReplacedCopy,
      this.reopeningForWhatWaited,
      this.startingForADeliveryWithNoWindow,
      this.askAgainOnceItArrived,
      this.arrivals,
      this.scheduleEvidence,
      this.wordsHeld,
      this.startsReserved,
      this.lookingAtItsRecord,
    ]
    this.forgetTheirAttempts(ids)
    this.forgetTheirCuts(gone)
    this.invalidateProviderLimitFacts()
    for (const id of ids) {
      this.providerLimitFacts.forget(id)
      this.providerLimitLives.delete(id)
      this.moveTheListing()
      this.providerBlockSaid.delete(id)
      this.forgetItsWakeUp(id)
      this.conversationIdle.cancel(id)
      for (const kept of keptByConversation) kept.delete(id)
      this.routedTo?.delete(id)
    }
    for (const [old, now] of this.replacedBy) if (gone.has(now)) this.replacedBy.delete(old)
    this.refreshWorkerReadings()
    for (const askers of this.routedTo?.values() ?? []) for (const id of ids) askers.delete(id)
    for (const session of this.signInStops)
      if (gone.has(session.id)) this.signInStops.delete(session)
  }

  resumableSessions(): ResumableSessionInfo[] {
    return this.theListing().resumable
  }

  private theListing(): NonNullable<RuntimeHost['listingKept']> {
    this.deps.store.checkCommitted()
    this.prepareInitialProviderLimitFacts()
    const kept = this.listingKept
    if (kept !== undefined && kept.at === this.listingVersion) return kept
    const at = this.listingVersion
    const { unread, asksUnread, stateOf, itsWork } = this.oneReadPerListing()
    const halves = {
      resumable: this.resumableHalf(stateOf, itsWork),
      unresumable: this.unresumableHalf(stateOf, itsWork),
    }
    const complete = unread.count === 0 && unread.ledgersSkipped === 0 && asksUnread === 0
    const composed = { at, ...halves, complete }
    this.listingKept = this.listingVersion === at && complete ? composed : undefined
    return composed
  }

  private resumableHalf(
    stateOf: ReturnType<RuntimeHost['oneReadPerListing']>['stateOf'],
    itsWork: ReturnType<RuntimeHost['oneReadPerListing']>['itsWork'],
  ): ResumableSessionInfo[] {
    const shown = this.deps.store
      .resumable()
      .filter(({ sessionId }) => !this.archived.has(sessionId))
    return shown.map(({ reportedModel, reportedEffort, ...session }) => ({
      ...session,
      ...(reportedModel === null
        ? {}
        : {
            reported: {
              model: reportedModel,
              ...(reportedEffort === null ? {} : { effort: reportedEffort }),
            },
          }),
      child: libraryChild(session.child ?? undefined),
      running: this.runningStateOf(session.sessionId),
      ...this.workerFields(session.sessionId),
      state: stateOf(session.sessionId),
      ...this.providerBlockDisclosure(session.sessionId, session.provider),
      ...itsWork(session.sessionId),
    }))
  }

  private whatTheListSaysOfItsWork(
    conversation: string,
    waiting: (id: string) => WhatAConversationIsWaitingOn,
  ): Pick<ResumableSessionInfo, 'named' | 'waitingOnPurpose'> {
    if (this.theServiceOf(conversation) !== null) return { named: null }
    const { named, waitingOnPurpose } = this.deps.store.workThatNamesAndItsWait(conversation)
    if (waitingOnPurpose === null) return { named }
    const [piece] = composeWhatEachPieceIsWaitingOn([waitingOnPurpose], waiting)
    const line = waitingOnPurpose.statusLine
    if (piece?.state !== waitingOnPurpose.state || line === null) return { named }
    return {
      named,
      waitingOnPurpose: {
        label: waitingOnPurpose.label,
        status: line.text.slice(0, headOf(line.text, REPLY_SUMMARY_LIMIT)),
        ...(line.on === undefined ? {} : { on: line.on }),
        ...this.theAgentAWaitIsOn(line.on, conversation, line.by),
      },
    }
  }

  private theAgentAWaitIsOn(
    on: WaitOn | undefined,
    holder: string,
    setBy: string,
  ): { readonly agentName?: string } {
    if (on?.kind !== 'agent') return {}
    const theQuestion = (request: string): string | null => {
      for (const one of new Set([
        ...this.theIdsItStandsFor(holder),
        ...this.theIdsItStandsFor(setBy),
      ])) {
        const found = this.deps.store
          .routedRequestsOf(one)
          .find((each) => each.requestId === request)
        if (found !== undefined) return found.parent
      }
      return null
    }
    const answerer =
      'piece' in on ? (this.deps.store.workById(on.piece)?.owner ?? null) : theQuestion(on.request)
    return answerer === null ? {} : { agentName: this.whatToCallTheConversation(answerer) }
  }

  private oneReadPerListing(): {
    readonly unread: RowsUnread
    readonly asksUnread: number
    readonly stateOf: (sessionId: string) => AgentState
    readonly itsWork: (
      sessionId: string,
    ) => Pick<ResumableSessionInfo, 'named' | 'waitingOnPurpose'>
  } {
    const reads = this.cardReads()
    const unread = rowsUnreadOnce()
    const ledger = this.oneLedgerReadPerAnswer(unread)
    const owed = this.oneOwedReadPerAnswer(this.ledgerAsKept(ledger))
    const workOut = this.oneWorkOutReadPerAnswer(unread)
    const waiting = this.oneWaitReadPerAnswer(unread, ledger, workOut)
    return {
      unread,
      asksUnread: reads.asksUnread,
      stateOf: (sessionId) => {
        this.stateSaid.delete(sessionId)
        return this.stateOf(sessionId, reads, unread, ledger(sessionId), workOut, owed)
      },
      itsWork: (sessionId) => this.whatTheListSaysOfItsWork(sessionId, waiting),
    }
  }

  private runningStateOf(sessionId: string): RunningState {
    const slot = this.slots.get(sessionId)
    if (slot === undefined) return 'not-running'
    const session = slot.session
    if (session === null) return 'not-running'
    if (onItsWayOut(slot)) {
      return 'not-running'
    }
    return slot.ownerId === null ? 'unwatched' : 'in-a-window'
  }

  unresumableSessions(): UnresumableSessionInfo[] {
    return this.theListing().unresumable
  }

  private unresumableHalf(
    stateOf: ReturnType<RuntimeHost['oneReadPerListing']>['stateOf'],
    itsWork: ReturnType<RuntimeHost['oneReadPerListing']>['itsWork'],
  ): UnresumableSessionInfo[] {
    const shown = this.deps.store
      .unresumable()
      .filter(({ sessionId }) => !this.archived.has(sessionId))
    return shown.map((row) => ({
      ...row,
      running: this.runningStateOf(row.sessionId),
      ...this.workerFields(row.sessionId),
      state: stateOf(row.sessionId),
      ...this.providerBlockDisclosure(row.sessionId, row.provider),
      ...itsWork(row.sessionId),
    }))
  }

  async adoptSessions(): Promise<AdoptionReport> {
    const { found, skipped } = this.deps.discoverSessions()
    let adopted = 0
    let alreadyKnown = 0
    let descentsLearned = 0
    let named = 0

    const live = new Set(
      [...this.slots.values()]
        .flatMap((slot) => (slot.session === null ? [] : [slot.session]))
        .flatMap((session) => [
          `${session.provider}\u0000${session.handle.ref?.sessionId ?? ''}`,
          `${session.provider}\u0000cwd:${session.cwd}`,
        ]),
    )

    for (const session of found) {
      const known = this.deps.store.findByProviderRef(session.provider, session.sessionId)
      if (known !== null) {
        if (
          this.runningStateOf(known) === 'not-running' &&
          this.deps.store.nameItsLaunch(known, {
            provider: session.provider,
            sessionId: session.sessionId,
            cwd: session.cwd,
            rotation: 0,
          })
        )
          named++
        if (this.deps.store.refreshAdopted(known, session.updatedAt, session.child))
          descentsLearned++
        alreadyKnown++
        continue
      }
      if (
        live.has(`${session.provider}\u0000${session.sessionId}`) ||
        live.has(`${session.provider}\u0000cwd:${session.cwd}`)
      ) {
        alreadyKnown++
        continue
      }
      const id = this.deps.newSessionId()
      this.deps.store.adopt({
        id,
        provider: session.provider,
        sessionId: session.sessionId,
        cwd: session.cwd,
        profileId: session.profileId,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        ...(session.child ? { child: session.child } : {}),
      })
      if (session.child) descentsLearned++
      adopted++
    }

    if (adopted > 0 || named > 0) this.theWorldMoved('conversations')

    const imported = await this.importAll(skipped)
    return {
      found: found.length,
      adopted,
      alreadyKnown,
      imported,
      descentsLearned,
      named,
      skipped,
    }
  }

  private async importAll(skipped: SkippedSessionInfo[]): Promise<number> {
    if (this.archives.backgroundClosed) return 0
    return this.archives.background((cancelled) => this.runImportAll(skipped, cancelled))
  }

  private async runImportAll(
    skipped: SkippedSessionInfo[],
    cancelled: () => boolean,
  ): Promise<number> {
    let imported = 0

    for (const session of this.deps.store.resumable()) {
      if (cancelled()) break
      if (this.slots.has(session.sessionId)) continue
      try {
        const outcome = await this.importOne(session, cancelled)
        if (outcome === 'imported') imported++
        if (outcome === 'stopped') {
          skipped.push({
            provider: session.provider,
            path: session.sessionId,
            reason: 'its transcript was not read: the app is shutting down',
          })
          break
        }
        if (outcome === 'nothing-readable') {
          skipped.push({
            provider: session.provider,
            path: session.sessionId,
            reason: 'its provider file holds no readable conversation',
          })
        }
      } catch (error) {
        console.warn(
          `runtime session ${session.sessionId} could not be imported: ${errorMessage(error)}`,
        )
        skipped.push({
          provider: session.provider,
          path: session.sessionId,
          reason: `could not be imported: ${this.howAFailureReads(error, true)}`,
        })
      }
    }

    return imported
  }

  private async importOne(
    session: ResumableSession,
    cancelled: () => boolean,
  ): Promise<DeriveOutcome> {
    const providerHome = this.deps.providerHomePath(
      session.provider,
      session.profileId ?? DEFAULT_PROFILE_ID,
    )
    const path = this.deps.nativeTranscriptPath(session.provider, providerHome, session.ref)
    if (path === null) return 'skipped'
    return await this.importTranscript(session.sessionId, session.provider, path, cancelled)
  }

  async importRecordedSession(sessionId: string): Promise<ImportedRecording> {
    const session = this.deps.store.find(sessionId)
    if (session === null)
      return { outcome: 'unknown-session', readable: false, note: 'There is no such conversation.' }
    const readable = (): boolean => this.deps.store.ledgerStatus(sessionId).present
    if (session.adoptedAt !== null && session.profileId === null)
      return {
        outcome: 'user-home',
        readable: readable(),
        note:
          `This conversation is in ${providerName(session.provider)}'s own folder. ` +
          'Import it from the Library, which is the surface that reads those.',
      }
    if (this.archives.backgroundClosed)
      return {
        outcome: 'refused',
        readable: readable(),
        note: 'The app is shutting down, so nothing was started. The provider file is not going anywhere.',
      }

    let failure: string | null = null
    const outcome: ImportedRecording['outcome'] = await this.archives.background(
      async (cancelled) => {
        if (this.slots.has(sessionId) || workRunningElsewhere(this).has(sessionId)) return 'in-use'
        try {
          return await this.whileBuilding(sessionId, () => this.importOne(session, cancelled))
        } catch (error) {
          console.warn(`runtime session ${sessionId} could not be imported: ${errorMessage(error)}`)
          failure = `it could not be imported: ${this.howAFailureReads(error, true)}`
          return 'failed'
        }
      },
    )
    const present = readable()
    if (outcome !== 'in-use' && outcome !== 'skipped') this.theWorldMoved('conversations')
    return { outcome, readable: present, note: failure ?? recordingNote(outcome, present) }
  }

  private async importTranscript(
    sessionId: string,
    provider: Provider,
    path: string,
    cancelled: () => boolean,
  ): Promise<DeriveOutcome> {
    const row = this.deps.store.find(sessionId)
    const resolveImage =
      row === null ? undefined : this.imageResolver(provider, row.ref.sessionId, homeProfileOf(row))
    return this.whileBuilding(sessionId, () =>
      deriveLedger(
        this.deps.store,
        sessionId,
        provider,
        (from, maxLines) => readLines(path, from, maxLines),
        {
          fallbackAt: row?.createdAt ?? this.now(),
          cancelled,
          rebuild: false,
          ...(resolveImage ? { resolveImage } : {}),
        },
      ),
    )
  }

  fillQuestionCopies(): void {
    if (this.archives.backgroundClosed) return
    void this.archives
      .background(async (cancelled) => {
        if (cancelled()) return
        const began = performance.now()
        const slice = this.deps.store.fillQuestionCopies(this.copySliceRows, COPY_SLICE_BYTES)
        const took = performance.now() - began
        this.copiesFilled.visited += slice.visited
        this.copiesFilled.matched += slice.matched
        if (slice.state === 'filled') {
          this.copySliceRows = Math.max(
            COPY_SLICE_ROWS.least,
            Math.min(
              COPY_SLICE_ROWS.most,
              took > COPY_SLICE_TARGET_MS
                ? Math.floor(this.copySliceRows / 2)
                : this.copySliceRows * 2,
            ),
          )
          this.copyBusyWait = COPY_BUSY_WAIT_MS.least
          this.sayHowTheCopiesStand()
          this.nextCopySlice(0)
        } else if (slice.state === 'busy') {
          this.nextCopySlice(this.copyBusyWait)
          this.copyBusyWait = Math.min(COPY_BUSY_WAIT_MS.most, this.copyBusyWait * 2)
        }
      })
      .catch((error: unknown) => {
        console.warn(`runtime host could not fill question copies: ${errorMessage(error)}`)
      })
  }

  private nextCopySlice(afterMs: number): void {
    const timer = setTimeout(() => this.fillQuestionCopies(), afterMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  private sayHowTheCopiesStand(): void {
    const at = this.now()
    if (at - this.copiesFilled.saidAt < SAY_COPY_PROGRESS_EVERY_MS) return
    this.copiesFilled.saidAt = at
    console.warn(
      `question copies still filling: ${String(this.copiesFilled.visited)} rows visited, ${String(this.copiesFilled.matched)} copies written`,
    )
  }

  stopSweeping(): void {
    this.archives.rejectNewBackgroundWork()
  }

  drainArchiveWork(): Promise<void> {
    return this.archives.drain()
  }

  async listLibrary(query: LibraryQuery = {}): Promise<LibraryPage> {
    return readLibrary(
      {
        recorded: () => this.deps.store.recorded(),
        userHomeSessions: this.deps.userHomeSessions ?? (() => ({ found: [], skipped: [] })),
        indexedDescriptions: this.deps.indexedDescriptions ?? (() => Promise.resolve(new Map())),
        archivedAt: (recordId) => this.archived.archivedAt(recordId),
      },
      query,
    )
  }

  async importUserHomeSession(
    provider: Provider,
    providerSessionId: string,
  ): Promise<ImportedFromHome> {
    const found = (this.deps.userHomeSessions?.().found ?? []).find(
      (entry) => entry.provider === provider && entry.sessionId === providerSessionId,
    )

    if (!found) {
      return {
        outcome: 'missing',
        sessionId: this.deps.store.findByProviderRef(provider, providerSessionId),
        readable: false,
        note: `It is no longer in ${providerName(provider)}'s own folder, so there is nothing left to import.`,
      }
    }
    const source = toHomeConversation(found)

    const outcome = this.archives.backgroundClosed
      ? 'stopped'
      : await this.archives.background((cancelled) =>
          importFromHome(
            {
              store: this.deps.store,
              newSessionId: () => this.deps.newSessionId(),
              lines: (path) => (from, maxLines) => readLines(path, from, maxLines),
              resolveImage: this.imageResolver(source.provider, source.sessionId, source.profileId),
            },
            source,
            cancelled,
          ).catch((error: unknown) => {
            console.warn(
              `runtime ${provider} conversation ${providerSessionId} could not be imported: ${errorMessage(error)}`,
            )
            return 'unreadable' as const
          }),
        )

    const sessionId = this.deps.store.findByProviderRef(provider, providerSessionId)
    if (sessionId !== null) this.theWorldMoved('conversations')
    return {
      outcome,
      sessionId,
      readable: sessionId !== null && this.deps.store.ledgerStatus(sessionId).present,
      note: describeOutcome(outcome),
    }
  }

  async rebuildLedger(sessionId: string): Promise<RebuiltLedger> {
    const row = this.deps.store.recordedOne(sessionId)
    if (row === null) return { outcome: 'unknown-session', status: null }
    if (this.slots.has(sessionId) || workRunningElsewhere(this).has(sessionId)) {
      return { outcome: 'in-use', status: this.status(sessionId) }
    }
    const before = this.status(sessionId)
    if (before.present && before.derived === null) {
      return { outcome: 'recorded', status: before }
    }
    if (this.archives.backgroundClosed) {
      return { outcome: 'refused', status: this.status(sessionId) }
    }
    const withRef = this.deps.store.find(sessionId)
    const path =
      withRef === null
        ? null
        : this.deps.nativeTranscriptPath(row.provider, this.providerHomeFor(withRef), withRef.ref)
    if (path === null) return { outcome: 'gone', status: before }
    const resolveImage =
      row.providerSessionId === null
        ? undefined
        : this.imageResolver(row.provider, row.providerSessionId, homeProfileOf(row))
    const outcome = await this.whileBuilding(sessionId, () =>
      this.archives.background((cancelled) =>
        deriveLedger(
          this.deps.store,
          sessionId,
          row.provider,
          (from, maxLines) => readLines(path, from, maxLines),
          {
            fallbackAt: row.createdAt,
            cancelled,
            rebuild: true,
            ...(resolveImage ? { resolveImage } : {}),
          },
        ),
      ),
    )
    if (outcome === 'imported' || outcome === 'superseded') this.theWorldMoved('work')
    if (outcome !== 'skipped') this.theWorldMoved('conversations')
    return { outcome, status: this.status(sessionId) }
  }

  status(sessionId: string): LedgerStatus {
    return this.deps.store.ledgerStatus(sessionId)
  }

  private imageResolver(
    provider: Provider,
    threadId: string,
    profileId: string | null,
  ): ResolveImagePath | undefined {
    return providerDefinitions[provider].transcripts.imageResolver?.(
      threadId,
      () => (profileId === null ? null : this.deps.providerHomePath(provider, profileId)),
      (candidate) => {
        const asset = resolveAssetRequest(assetUrl(candidate))
        return asset?.path ?? null
      },
    )
  }

  readWorkflowOutput(sessionId: string, taskId: string): WorkflowOutputResult {
    const unread = rowsUnreadOnce()
    const path = this.deps.store.workflowOutputPath(sessionId, taskId, unread)
    if (path === null) return { ok: false, reason: 'no-output', rowsUnread: unread.count }
    const read = readWorkflowOutput(path)
    if (typeof read === 'string') return { ok: false, reason: read, rowsUnread: unread.count }
    return { ok: true, ...read, rowsUnread: unread.count }
  }

  readInstructionSource(sessionId: string, index: number): InstructionSourceResult {
    const session = this.slots.get(sessionId)?.session
    if (!session) return { ok: false, reason: 'no-source' }
    return readInstructionSource(session.handle.instructionSources ?? [], index)
  }

  revealPath(sessionId: string, target: SessionPathTarget): RevealResult {
    const session = this.slots.get(sessionId)?.session ?? this.endedPlacesOf(sessionId)
    if (!session) return { ok: false, reason: 'no-path' }
    const path = ((): string | null => {
      switch (target.of) {
        case 'cwd':
          return session.cwd
        case 'home':
          return session.providerHome
        case 'config-file':
          return (
            this.deps
              .readProviderConfig(session.provider, session.providerHome)
              .files.find((file) => file.name === target.name)?.path ?? null
          )
        case 'instruction-source':
          return session.handle?.instructionSources?.[target.index] ?? null
      }
    })()
    if (path === null || path === '') return { ok: false, reason: 'no-path' }
    if (!realPathOf(path).ok) return { ok: false, reason: 'gone' }
    this.deps.revealPath?.(path)
    return { ok: true, path }
  }

  private messageFolderOf(sessionId: string | null): string | null {
    if (sessionId === null) return null
    const where = this.slots.get(sessionId)?.session ?? this.endedPlacesOf(sessionId)
    return where?.cwd || null
  }

  resolveMessagePaths(ask: MessagePathAsk): Promise<MessagePath[]> {
    return resolveMessagePaths(
      ask.texts,
      this.messageFolderOf(ask.sessionId),
      this.deps.messagePathPlace ?? THIS_COMPUTER,
      { mayOpen: true },
    )
  }

  openMessagePath(target: MessagePathTarget): Promise<OpenMessagePathResult> {
    return openMessagePath(
      target.text,
      this.messageFolderOf(target.sessionId),
      this.deps.messagePathPlace ?? THIS_COMPUTER,
      { open: this.deps.openPath, reveal: this.deps.revealPath },
    )
  }

  revealMessagePath(target: MessagePathTarget): Promise<RevealResult> {
    return revealMessagePath(
      target.text,
      this.messageFolderOf(target.sessionId),
      this.deps.messagePathPlace ?? THIS_COMPUTER,
      this.deps.revealPath,
    )
  }

  private endedPlacesOf(
    sessionId: string,
  ): { provider: Provider; cwd: string; providerHome: string; handle?: undefined } | null {
    const row = this.deps.store.find(sessionId)
    if (row === null) return null
    return { provider: row.provider, cwd: row.cwd, providerHome: this.providerHomeFor(row) }
  }

  readConfigFile(sessionId: string, name: string): ConfigFileResult {
    const live = this.slots.get(sessionId)?.session
    if (live) {
      return readConfigFile(
        this.deps.readProviderConfig(live.provider, live.providerHome).files,
        name,
      )
    }
    const row = this.deps.store.find(sessionId)
    if (row === null) return { ok: false, reason: 'no-path' }
    const home = this.providerHomeFor(row)
    return readConfigFile(this.deps.readProviderConfig(row.provider, home).files, name)
  }

  readCommandOutput(sessionId: string, toolCallId: string): CommandTail | null {
    const session = this.slots.get(sessionId)?.session
    return session?.handle.commandOutput?.(toolCallId) ?? null
  }

  readToolAnswer(sessionId: string, toolCallId: string): ToolAnswer | null {
    const session = this.slots.get(sessionId)?.session
    return session?.handle.toolAnswer?.(toolCallId) ?? null
  }

  async turnAsSent(sessionId: string, ordinal: number): Promise<TurnAsSent> {
    try {
      return await this.readTurnAsSent(sessionId, ordinal)
    } catch (error) {
      return { found: false, why: `The provider’s record could not be read: ${String(error)}` }
    }
  }

  private async readTurnAsSent(sessionId: string, ordinal: number): Promise<TurnAsSent> {
    const row = this.deps.store.find(sessionId)
    if (row === null) {
      return {
        found: false,
        why: 'This conversation has no record with its provider yet, or is not in this app.',
      }
    }
    const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

    interface Turn {
      readonly ordinal: number
      readonly key: { readonly by: TurnAsked['by']; readonly text: string } | null
      readonly words: string
      life: string | null
      settled: boolean
    }
    const turns: Turn[] = []
    let life: string | null = null
    let named = false
    let target: Turn | null = null
    const settle = (into: string | null, untilNamed = false): void => {
      for (const turn of turns) {
        if (turn.settled) continue
        if (untilNamed && !named && turn.key?.by === 'its-own-record') continue
        turn.life = into
        turn.settled = true
      }
    }
    walk: for (let from = 0; ;) {
      const page = this.deps.store.eventsFrom(sessionId, from, TURN_AS_SENT_PAGE)
      if (page.length === 0) break
      for (const entry of page) {
        const event = entry.event
        if (
          (event.type === 'session' && event.state !== 'ended') ||
          event.type === 'conversation_reset'
        ) {
          life = event.ref.sessionId
          named = true
          settle(life)
        } else if (event.type === 'turn' || event.type === 'launched') {
          settle(life, true)
        } else if (event.type === 'user_turn' && target === null) {
          const stored: unknown = event.sent
          const turn: Turn = {
            ordinal: entry.ordinal,
            key:
              typeof stored === 'string'
                ? { by: 'handed-over', text: stored }
                : event.attribution === 'provider_transcript'
                  ? { by: 'its-own-record', text: event.text }
                  : null,
            words: event.text,
            life,
            settled: false,
          }
          turns.push(turn)
          if (entry.ordinal === ordinal) target = turn
        }
        if (target?.settled === true && (target.life !== null || named)) break walk
        if (target === null && entry.ordinal >= ordinal) break walk
      }
      from = (page.at(-1)?.ordinal ?? from) + 1
      await yieldNow()
    }
    if (target === null) return { found: false, why: 'There is no message at that place.' }
    settle(life)
    if (target.life === null && named) {
      return { found: false, why: 'This message reached no provider conversation.' }
    }
    const { key } = target
    if (key === null) {
      return {
        found: false,
        why:
          providerDefinitions[row.provider].transcripts.noModelMessageReason?.(target.words) ??
          'This app kept no copy of the text it handed over for this message — it was sent before this app kept one, or keeping it failed — so it cannot be matched exactly in the provider’s own record.',
      }
    }
    const of = target
    const before = turns.filter((turn) => turn.ordinal < of.ordinal && turn.life === of.life)
    if (before.some((turn) => turn.key === null && turn.words === of.words)) {
      return {
        found: false,
        why: 'An earlier message of this conversation had the same words and no copy of what was handed over with it, so which of the two this one is cannot be told.',
      }
    }
    const asked: TurnAsked = {
      ...key,
      life: of.life,
      before: before.flatMap((turn) =>
        turn.key !== null && turn.key.text === key.text ? [turn.key.by] : [],
      ),
    }

    const home = this.providerHomeFor(row)
    const ref = of.life === null ? row.ref : { ...row.ref, sessionId: of.life }
    let path: string | null
    try {
      const found = this.deps.nativeTranscriptPath(row.provider, home, ref)
      path = found !== null && isTheProvidersRecord(row.provider, home, found) ? found : null
    } catch {
      path = null
    }
    const gone: TurnAsSent = {
      found: false,
      why: 'The provider’s own record of this message is gone, and the app kept no copy of it.',
    }
    if (path === null) return gone
    try {
      const reading = readingATurn(row.provider, asked, {
        hasAContextMessage: (model) =>
          takesAContextMessage(this.deps.providerSnapshot?.(row.provider, model)),
      })
      for (let offset = 0; ;) {
        const chunk = readLines(path, offset, TURN_AS_SENT_PAGE)
        const done = chunk.lines.some((line) => reading.line(line) === 'done')
        if (done || chunk.done) break
        offset = chunk.offset
        await yieldNow()
      }
      return reading.answer()
    } catch {
      return gone
    }
  }

  private providerHomeFor(
    session: Pick<ResumableSession, 'adoptedAt' | 'profileId' | 'provider'>,
  ): string {
    if (session.adoptedAt !== null && session.profileId === null) {
      return userProviderHomePath(session.provider)
    }
    return this.deps.providerHomePath(session.provider, session.profileId ?? DEFAULT_PROFILE_ID)
  }

  private childCandidates(
    sessionId: string,
    input: ChildWorkInput,
    unread?: RowsUnread,
  ): { agents: string[]; taskId: string | null } | null {
    if (input.part === 'transcript') {
      const taskId = this.deps.store.workflowAgentTask(sessionId, input.agentId, unread)
      if (taskId !== null) return { agents: [input.agentId], taskId }
      return this.deps.store.reportedSubAgent(sessionId, input.agentId, unread)
        ? { agents: [input.agentId], taskId: null }
        : null
    }
    const agents = this.deps.store.workflowAgentIds(sessionId, input.taskId, unread)
    return agents.length === 0 ? null : { agents, taskId: input.taskId }
  }

  private childChannel(
    sessionId: string,
    agentId: string,
    by: Caller,
  ):
    | { handle: Required<Pick<SessionHandle, 'childState' | 'childInput'>> }
    | { reason: 'unknown-agent' | 'unsupported' | 'not-live' } {
    const slot = this.slots.get(sessionId)
    if (slot) this.assertMayControl(slot, by)
    const session = this.deps.store.find(sessionId)
    if (session === null) return { reason: 'unknown-agent' }
    if (this.childCandidates(sessionId, { part: 'transcript', agentId }) === null) {
      return { reason: 'unknown-agent' }
    }
    if (capabilitiesFor(session.provider).childInput.state !== 'available') {
      return { reason: 'unsupported' }
    }
    if (!slot || slot.session === null) return { reason: 'not-live' }
    const { handle } = slot.session
    const { childState, childInput } = handle
    if (childState === undefined || childInput === undefined) return { reason: 'unsupported' }
    return {
      handle: {
        childState: (id) => childState.call(handle, id),
        childInput: (id, text) => childInput.call(handle, id, text),
      },
    }
  }

  async readChildState(sessionId: string, agentId: string, by: Caller): Promise<ChildStateResult> {
    const channel = this.childChannel(sessionId, agentId, by)
    if ('reason' in channel) return { ok: false, reason: channel.reason }
    try {
      return { ok: true, state: await channel.handle.childState(agentId) }
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
  }

  async sendToChild(
    sessionId: string,
    agentId: string,
    text: string,
    by: Caller,
  ): Promise<ChildSendResult> {
    const channel = this.childChannel(sessionId, agentId, by)
    if ('reason' in channel) return { ok: false, reason: channel.reason }
    let state: ChildThreadState
    try {
      state = await channel.handle.childState(agentId)
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
    const refusal = childInputRefusal(state)
    if (refusal !== null) return { ok: false, reason: refusal, state }
    try {
      const sent = await channel.handle.childInput(agentId, text)
      return sent.ok
        ? { ok: true, turnId: sent.turnId }
        : { ok: false, reason: sent.reason, state: sent.state }
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
  }

  readChildWork(sessionId: string, input: ChildWorkInput): ChildWorkResult {
    const unread = rowsUnreadOnce()
    return { ...this.childWorkRead(sessionId, input, unread), rowsUnread: unread.count }
  }

  private childWorkRead(
    sessionId: string,
    input: ChildWorkInput,
    unread: RowsUnread,
  ): ChildWorkResult {
    const session = this.deps.store.find(sessionId)
    if (session === null || session.ref === null) return { ok: false, reason: 'unknown-agent' }
    const found = this.childCandidates(sessionId, input, unread)
    if (found === null) return { ok: false, reason: 'unknown-agent' }

    return providerDefinitions[session.provider].transcripts.readChild({
      ref: session.ref,
      updatedAt: session.updatedAt,
      part: input.part,
      agents: found.agents,
      taskId: found.taskId,
      home: () => this.providerHomeFor(session),
      pathForChild: (home, ref) => this.deps.nativeTranscriptPath(session.provider, home, ref),
    })
  }

  earlierHistory(sessionId: string, before: number, turns?: number): HistoryWindow {
    return this.historyWindow(sessionId, { before, ...(turns === undefined ? {} : { turns }) })
  }

  latestHistory(sessionId: string): HistoryWindow {
    return this.historyWindow(sessionId, {})
  }

  private historyWindow(
    sessionId: string,
    options: { before?: number; turns?: number },
  ): HistoryWindow {
    const window = this.deps.store.turnWindow(sessionId, {
      turns: options.turns ?? HISTORY_WINDOW_TURNS,
      maxEvents: HISTORY_WINDOW_MAX_EVENTS,
      ...(options.before === undefined ? {} : { before: options.before }),
    })
    const first = window.entries[0]
    const last = window.entries.at(-1)
    const humanFinals =
      first === undefined || last === undefined
        ? new Map()
        : this.deps.store.humanFinalsInWindow(sessionId, first.ordinal, last.ordinal)
    return {
      entries: window.entries.map((entry) => ({
        ordinal: entry.ordinal,
        at: entry.at,
        event: transcriptEventForDisplay(entry.event),
        ...(entry.event.type === 'assistant_message'
          ? { humanFinal: humanFinals.get(entry.ordinal) ?? null }
          : {}),
      })),
      from: window.from,
      hasOlder: window.hasOlder,
      turnAligned: window.turnAligned,
      ...(options.before === undefined
        ? { humanAnswers: this.deps.store.latestHumanAnswers(sessionId) }
        : {}),
      ...(window.toolsInForce === undefined
        ? {}
        : {
            toolsInForce: {
              ordinal: window.toolsInForce.ordinal,
              at: window.toolsInForce.at,
              event: window.toolsInForce.event,
            },
          }),
    }
  }

  capabilities(): ProviderCapabilityMap {
    return allProviderCapabilities()
  }

  providerConnections(): readonly ProviderConnection[] {
    return (this.deps.listConnections?.() ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      name: row.name,
      authMethod: row.authMethod,
      credentialSource: row.credentialSource,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      contractVersion: row.contractVersion,
    }))
  }

  profiles(provider?: Provider): string[] {
    return this.deps.listProfiles?.(provider) ?? [DEFAULT_PROFILE_ID]
  }

  checkCwd(path: string): CwdVerdict {
    if (path.trim() === '') return { ok: true, path: '' }
    try {
      return { ok: true, path: this.deps.resolveCwd(CHECKING_A_FOLDER, path) }
    } catch (error) {
      return { ok: false, reason: errorMessage(error) }
    }
  }

  createAgent(said: NewAgent): AgentIdentity {
    if (said.asAService === true && !this.servicesAreOn()) {
      throw new Error(NO_SERVICE_IS_MADE_WHILE_OFF)
    }
    const created = this.deps.store.createAgentIdentity(said, { by: 'a-person' })
    if (created === null) throw new Error(nameIsTaken(said.slug))
    if (said.asAService === true) this.keepItAsAService(created)
    this.theWorldMoved('agents')
    return created
  }

  private keepItAsAService(created: AgentIdentity): void {
    try {
      this.keepTheProfileEntry(
        created.id,
        { kind: 'service', identityCreatedAt: created.createdAt },
        true,
      )
    } catch (error) {
      try {
        const removed = this.removeAgent(created.slug)
        if (!removed.ok)
          console.warn(`runtime host did not take back ${created.slug}: ${removed.rail}`)
      } catch (again) {
        console.warn(`runtime host did not take back ${created.slug}: ${errorMessage(again)}`)
      }
      throw error
    }
  }

  createAgentFor(
    me: string,
    said: NewAgent,
    by: Caller,
    itsOwnRules: string | null,
    itsDefault: AgentModelChoice | null,
  ): CreateAgentOutcome {
    if (said.asAService === true && !this.servicesAreOn()) {
      return { ok: false, rail: 'services-are-off-so-none-is-made', detail: {} }
    }
    const may = this.mayCreateAgents(me)
    if (!may.ok) return may
    const provider = said.provider ?? itsDefault?.provider ?? this.theProviderOfConversation(me)
    const created = this.deps.store.createAgentIdentity({ ...said, provider }, may.creator)
    if (created === null) {
      return { ok: false, rail: 'agent-name-taken', detail: { agent: foldProfileName(said.slug) } }
    }
    if (said.asAService === true) this.keepItAsAService(created)
    const rulesAuthor = this.rulesAuthor(me, by)
    const rules =
      itsOwnRules === null
        ? null
        : this.deps.store.writeOwnInstructions(
            {
              profileSlug: created.slug,
              text: itsOwnRules,
              whoWroteIt: 'its-creator',
              ...(rulesAuthor === null ? {} : { author: rulesAuthor }),
              by: whoDidIt(by),
              conversation: me,
              said: null,
              broughtBack: null,
            },
            this.now(),
          )
    if (itsDefault !== null) this.deps.store.setModelChoice(created.slug, itsDefault)
    this.theWorldMoved('agents')
    return {
      ok: true,
      identity: created,
      rules,
      defaultModel: this.deps.store.modelChoiceOf(created.slug),
    }
  }

  mayCreateAgents(me: string): MayCreateAgents {
    if (!this.deps.store.spawnPolicy().spawningEnabled) {
      return { ok: false, rail: 'spawning-disabled', detail: {} }
    }
    const caller = this.runningAs(me)
    const allowed = caller === null ? null : this.deps.store.capabilitiesOf(caller.profileId)
    if (allowed === null || caller === null || allowed.canCreateAgents === 'none') {
      return {
        ok: false,
        rail: 'may-not-create-agents',
        detail: { you: caller?.profileId ?? null },
      }
    }
    return { ok: true, creator: { by: 'an-agent', agent: foldProfileName(caller.profileId) } }
  }

  mayReachAtAll(act: MessagingAct, by: Caller): MessageRefusal | null {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) return null
    const mine = this.deps.store.identityOf(speaking)
    return admitReachAtAll(
      act,
      mine === null ? null : this.deps.store.capabilitiesOf(mine.profileSlug),
    )
  }

  private agentToolsForSession(sessionId: string): AgentToolset {
    const slot = this.slots.get(sessionId)
    const recorded = slot === undefined ? this.deps.store.recordedOne(sessionId) : null
    const profileId = slot?.profileId ?? recorded?.profileId ?? null
    const offersDirectRulesWrite =
      profileId !== null &&
      foldProfileName(profileId) === DEFAULT_PROFILE_ID &&
      (slot === undefined || slot.spawnedBy === null) &&
      this.deps.store.parentOf(sessionId) === null
    return agentToolsFor(this, sessionId, this.theListsAsLastRead(), offersDirectRulesWrite)
  }

  private rulesAuthor(me: string, by: Caller): RulesAuthor | null {
    if (sessionSpeakingAs(by) !== me) return null
    const caller = this.runningAs(me)
    const identity = this.deps.store.identityOf(me)
    if (
      caller === null ||
      identity === null ||
      foldProfileName(caller.profileId) !== identity.profileSlug
    )
      return null
    const named = this.deps.store.agentIdentityNameById(agentIdentityRowId(identity.profileSlug))
    if (named === null) return null
    return { profile: named.slug, name: agentName(named.slug, [named]) }
  }

  readOwnNotes(
    me: string,
    about: string | undefined,
    by: Caller,
  ): AgentOwnNotesOutcome<AgentOwnNotesReading> {
    const author = this.rulesAuthor(me, by)
    if (author === null || (about !== undefined && typeof about !== 'string'))
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_READ_CALLER_PROBLEM] },
      }
    const profile = about === undefined ? author.profile : foldProfileName(about)
    const page = this.deps.store.currentOwnNotesOf(profile)
    if (page === null) return { ok: false, rail: 'no-such-agent', detail: { agent: profile } }
    const current = page.current
    return {
      ok: true,
      result: {
        profile: page.profile,
        version: current?.version ?? 0,
        text: current?.text ?? '',
        author: current?.author ?? null,
        reason: current?.reason ?? null,
      },
    }
  }

  writeOwnNotes(
    me: string,
    said: OwnNotesWrite,
    by: Caller,
  ): AgentOwnNotesOutcome<OwnNotesReceipt> {
    const author = this.rulesAuthor(me, by)
    if (author === null)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_WRITE_CALLER_PROBLEM] },
      }
    if (!ownNotesWriteFits(said))
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_BASELINE_PROBLEM] },
      }
    const page = this.deps.store.currentOwnNotesOf(author.profile)
    if (page === null || (page.current?.version ?? 0) !== said.expectedVersion)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_STALE_PROBLEM] },
      }
    const written = this.deps.store.writeOwnNotes(
      author.profile,
      said,
      { who: 'an-agent', agent: me },
      this.now(),
    )
    if (written === null)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_SAVE_PROBLEM] },
      }
    this.theWorldMoved('agents')
    return {
      ok: true,
      result: {
        profile: author.profile,
        conversation: me,
        version: written.version,
        previousVersion: said.expectedVersion,
        author: written.author,
      },
    }
  }

  agentOwnNotes(profile: string): OwnNotesReading | null {
    return this.deps.store.ownNotesOf(foldProfileName(profile))
  }

  agentOwnNotesUnread(profile: string) {
    return this.deps.store.ownNotesUnread(foldProfileName(profile))
  }

  saveOwnNotes(profile: string, said: OwnNotesWrite, by: Caller): OwnNotesReading | null {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person' || !ownNotesWriteFits(said)) return null
    const page = this.deps.store.currentOwnNotesOf(profile)
    if (page === null || (page.current?.version ?? 0) !== said.expectedVersion) return null
    const written = this.deps.store.writeOwnNotes(profile, said, actor, this.now())
    if (written === null) return null
    this.theWorldMoved('agents')
    return this.agentOwnNotes(profile)
  }

  undoOwnNotes(profile: string, expectedVersion: number, by: Caller): OwnNotesReading | null {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      return null
    const current = this.deps.store.currentOwnNotesOf(profile)?.current
    if (current == null || current.version !== expectedVersion) return null
    const written = this.deps.store.undoOwnNotes(profile, { expectedVersion }, actor, this.now())
    if (written === null) return null
    this.theWorldMoved('agents')
    return this.agentOwnNotes(profile)
  }

  markOwnNotesSeen(profile: string, throughVersion: number, by: Caller): boolean {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person') return false
    const before = this.deps.store.ownNotesUnread(profile).seenThrough
    const marked = this.deps.store.markOwnNotesSeen(profile, throughVersion, actor)
    if (marked && this.deps.store.ownNotesUnread(profile).seenThrough > before)
      this.theWorldMoved('agents')
    return marked
  }

  proposeAgentRules(
    me: string,
    said: {
      readonly about: string
      readonly text: string
      readonly why: string
      readonly relaying: boolean
      readonly expectedVersion?: number
    },
    by: Caller,
  ): ProposeRulesOutcome {
    const author = this.rulesAuthor(me, by)
    if (author === null) return { ok: false, rail: 'may-not-write-rules', detail: { you: null } }
    if (said.relaying)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['already_agreed is not supported; leave it out'] },
      }
    if (
      typeof said.text !== 'string' ||
      said.text.length > OWN_INSTRUCTIONS_CHARS ||
      typeof said.why !== 'string' ||
      said.why.trim() === '' ||
      said.why.length > OWN_INSTRUCTIONS_CHARS
    )
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['rules and why must fit the size limit, and why must say why'] },
      }
    const about = foldProfileName(said.about)
    if (this.deps.store.capabilitiesOf(about) === null)
      return {
        ok: false,
        rail: 'no-such-agent',
        detail: { agent: about },
      }
    const session = this.slots.get(me)?.session ?? null
    if (session === null)
      return { ok: false, rail: 'may-not-write-rules', detail: { you: author.profile } }
    const basedOnVersion = this.deps.store.ownInstructionsOf(about).versions[0]?.version ?? 0
    if (!Number.isSafeInteger(said.expectedVersion) || said.expectedVersion !== basedOnVersion)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: {
          problems: ['the current rule version is required; read the rules again before proposing'],
        },
      }
    const askId = newInstructionAskId()
    this.publishOurs(session, {
      type: 'instruction_proposed',
      askId,
      ask: 'propose',
      about,
      proposedBy: author.profile,
      author,
      basedOnVersion,
      text: said.text,
      why: said.why.trim(),
    })
    return { ok: true, wrote: 'a-request', askId }
  }

  readAgentRules(me: string, about: string, by: Caller): AgentRulesOutcome<AgentRulesReading> {
    if (this.rulesAuthor(me, by) === null)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: null },
      }
    const profile = foldProfileName(about)
    if (this.deps.store.capabilitiesOf(profile) === null)
      return {
        ok: false,
        rail: 'no-such-agent',
        detail: { agent: profile },
      }
    const newest = this.deps.store.ownInstructionsOf(profile).versions[0]
    return {
      ok: true,
      result: {
        profile,
        version: newest?.version ?? 0,
        text: newest?.text ?? '',
        whoWroteIt: newest?.whoWroteIt ?? null,
        ...(newest?.author === undefined ? {} : { author: newest.author }),
        reason: newest?.said ?? null,
      },
    }
  }

  writeAgentRules(
    me: string,
    said: AgentRulesWrite,
    by: Caller,
  ): AgentRulesOutcome<AgentRulesReceipt> {
    const author = this.rulesAuthor(me, by)
    if (author === null || author.profile !== DEFAULT_PROFILE_ID)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: author?.profile ?? null },
      }
    const slot = this.slots.get(me)
    if (slot === undefined || slot.spawnedBy !== null || this.deps.store.parentOf(me) !== null)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: author.profile, helper: true },
      }
    const profile = foldProfileName(said.about)
    if (profile === DEFAULT_PROFILE_ID)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: author.profile, self: true },
      }
    if (this.deps.store.capabilitiesOf(profile) === null)
      return {
        ok: false,
        rail: 'no-such-agent',
        detail: { agent: profile },
      }
    if (
      !Number.isSafeInteger(said.expectedVersion) ||
      said.expectedVersion < 0 ||
      typeof said.text !== 'string' ||
      said.text.length > OWN_INSTRUCTIONS_CHARS ||
      typeof said.why !== 'string' ||
      said.why.trim() === '' ||
      said.why.length > OWN_INSTRUCTIONS_CHARS
    )
      return {
        ok: false,
        rail: 'malformed-request',
        detail: {
          problems: [
            'read the current rules, provide their version, and say why within the size limit',
          ],
        },
      }
    const previous = this.deps.store.ownInstructionsOf(profile).versions[0]
    if ((previous?.version ?? 0) !== said.expectedVersion)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['the rules changed; read them again before replacing them'] },
      }
    const written = this.deps.store.writeOwnInstructions(
      {
        profileSlug: profile,
        text: said.text,
        whoWroteIt: 'an-agent-direct',
        author,
        by: whoDidIt(by),
        conversation: me,
        said: said.why.trim(),
        broughtBack: null,
        expectedVersion: said.expectedVersion,
      },
      this.now(),
    )
    if (written === null)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['the rules changed; read them again before replacing them'] },
      }
    const receipt: AgentRulesReceipt = {
      profile,
      conversation: me,
      version: written.version,
      previousVersion: previous?.version ?? 0,
      author,
      replacedPersonVersion:
        previous?.whoWroteIt === 'a-person' || previous?.whoWroteIt === 'an-agents-proposal'
          ? previous.version
          : null,
    }
    this.supersedeInstructionAsks(profile, whoDidIt(by))
    const session = this.slots.get(me)?.session ?? null
    if (session !== null) this.publishOurs(session, { type: 'instruction_changed', ...receipt })
    this.theWorldMoved('agents')
    return { ok: true, result: receipt }
  }

  requestMcpServer(me: string, said: McpServerAsked): McpServerRequestOutcome {
    const no = (
      rail: ToolRefusal,
      detail: Readonly<Record<string, unknown>>,
    ): McpServerRequestOutcome => ({ ok: false, rail, detail })
    const caller = this.runningAs(me)
    const session = this.slots.get(me)?.session ?? null
    if (caller === null || session === null) {
      return no('malformed-request', {
        problems: ['this conversation is not running in this app, so nothing was asked'],
      })
    }
    const name = foldProfileName(said.name.trim())
    const url = new URL(said.url.trim()).href
    const registered = this.deps.store
      .externalMcpServers()
      .find((server) => server.name === name || theAddressOf(server.url) === theAddressOf(url))
    if (registered !== undefined) {
      return no('server-already-registered', {
        name: registered.name,
        ...(registered.name === name ? {} : { address: url }),
      })
    }
    const waiting = this.deps.store.mcpServerRequestsWaiting()
    const sameName = waiting.find((one) => one.requested.name === name)
    if (sameName !== undefined) {
      return no('server-already-asked-for', {
        name,
        request: sameName.requested.requestId,
        yours: sameName.conversation === me,
      })
    }
    const fromHere = waiting.filter((one) => one.conversation === me).length
    if (fromHere >= MCP_SERVER_REQUESTS_PER_CONVERSATION) {
      return no('too-many-server-requests', { waiting: fromHere, from: 'this-conversation' })
    }
    if (waiting.length >= MCP_SERVER_REQUESTS_IN_ALL) {
      return no('too-many-server-requests', { waiting: waiting.length, from: 'every-conversation' })
    }
    const agents = [...new Set(said.agents.map((one) => foldProfileName(one)))]
    const unknown = agents.filter((one) => this.deps.store.capabilitiesOf(one) === null)
    if (unknown.length > 0) return no('no-agent-by-that-name', { agents: unknown })
    let piece: { readonly piece: string; readonly label: string } | null = null
    if (said.piece !== null) {
      const named = said.piece
      const held = this.heldBy(me).find((one) => one.label === named || one.piece === named)
      if (held === undefined) {
        return no('malformed-request', {
          problems: [`piece names no piece of work you hold: ${named}`],
        })
      }
      piece = { piece: held.piece, label: held.label }
    }
    const notKept =
      'this conversation is no longer being recorded, so the request was not kept and nothing was asked'
    if (session.recordingFailure !== null) throw new Error(notKept)
    const requestId = newMcpServerRequestId()
    this.publishOurs(session, {
      type: 'mcp_server_requested',
      requestId,
      name,
      url,
      reaches: said.reaches,
      whoGetsIt: said.whoGetsIt,
      ...(said.whoGetsIt === 'only-these-agents' ? { agents } : {}),
      requestedBy: foldProfileName(caller.profileId),
      ...(piece === null ? {} : piece),
    })
    if (session.recordingFailure !== null) throw new Error(notKept)
    return { ok: true, requestId }
  }

  private launchesByIdentity(
    only: (slot: SessionSlot) => boolean = () => true,
  ): ReadonlySet<string> {
    const launching = new Set<string>()
    for (const slot of this.slots.values()) {
      if (slot.profileId === null) continue
      if (!only(slot)) continue
      launching.add(foldProfileName(slot.profileId))
    }
    return launching
  }

  private identityUseNow(identities: readonly AgentIdentity[]): readonly IdentityUse[] {
    return identityUse(
      identities,
      this.deps.store.conversationsPerIdentity(),
      this.launchesByIdentity(),
      this.launchesByIdentity(stillStarting),
    ).map((use) => ({
      ...use,
      ...this.memoryHolding(use.slug),
      ...(this.deps.store.hasPendingMethodChange(use.slug)
        ? { hasUnfinishedMethodChange: true }
        : {}),
    }))
  }

  private memoryHolding(slug: string): {
    hasUnfinishedMemoryChange?: true
    isChangingMemory?: true
  } {
    if (this.deps.memoryKnowledge?.busy(slug)) return { isChangingMemory: true }
    return this.deps.store.hasPendingMemoryAmendment(slug) || this.deps.memoryKnowledge?.held(slug)
      ? { hasUnfinishedMemoryChange: true }
      : {}
  }

  agentKnowledgeChanged(): void {
    this.theWorldMoved('agents')
  }

  async skillsForAPerson(request: SkillsRequest): Promise<SkillsReply> {
    if (!this.deps.skillsForAPerson) return { operation: 'refused', reason: 'source-unavailable' }
    return this.deps.skillsForAPerson(request)
  }

  agentIdentities(): AgentIdentities {
    const identities = this.deps.store.agentIdentities()
    const withRows = new Set(identities.map((identity) => identity.slug))
    return {
      identities,
      use: this.identityUseNow(identities),
      foldersWithoutARow: this.profiles()
        .filter((folder) => !withRows.has(foldProfileName(folder)))
        .sort(),
      spawningEnabled: this.deps.store.spawnPolicy().spawningEnabled,
      ...(this.servicesAreOn() ? { servicesOn: true as const } : {}),
      ...this.theServicesAmong(identities),
      defaultApprovalMode: this.deps.store.defaultApprovalMode(),
      defaultApprovalModeChosen: this.deps.store.defaultApprovalModeChosen(),
      externalMcpServers: this.deps.store.externalMcpServers(),
    }
  }

  setCapabilities(
    profileSlug: string,
    grant: CapabilityGrant,
    externalMcpServerIds?: readonly string[],
  ): AgentIdentity | null {
    if (!this.deps.store.setCapabilities(profileSlug, grant, externalMcpServerIds)) return null
    this.theWorldMoved('agents')
    const folded = foldProfileName(profileSlug)
    return this.deps.store.agentIdentities().find(({ slug }) => slug === folded) ?? null
  }

  async registerExternalMcpServer(said: {
    name: string
    url: string
    reach: ExternalMcpServerReach
  }): Promise<ExternalMcpServerRow> {
    const name = said.name.trim()
    const url = said.url.trim()
    await this.whatAServerOffers(name, url)
    const row = this.deps.store.registerExternalMcpServer({ name, url, reach: said.reach })
    if (row === null) {
      throw new Error(
        `There is already a server called ${foldProfileName(name)}. ` +
          `Remove it first, or register this one under another name.`,
      )
    }
    this.takeDownTheRequestsFor(row.name)
    return row
  }

  private takeDownTheRequestsFor(name: string): void {
    let waiting: readonly McpServerRequestWaiting[]
    try {
      waiting = this.deps.store.mcpServerRequestsWaiting()
    } catch (error) {
      console.warn(
        `runtime host registered ${name} but could not read the requests it takes down: ${errorMessage(error)}`,
      )
      return
    }
    for (const one of waiting) {
      if (foldProfileName(one.requested.name) !== foldProfileName(name)) continue
      const { requestId } = one.requested
      const told = MCP_SERVER_REQUEST_TOLD.superseded(requestId, name)
      const couldNot = (error: unknown): void => {
        console.warn(
          `runtime host registered ${name} but could not take down request ${requestId}: ${errorMessage(error)}`,
        )
      }
      try {
        if (this.settleNow(one, 'superseded', A_PERSON_DID_IT, {}, told).is !== 'starting') continue
      } catch (error) {
        couldNot(error)
        continue
      }
      void this.untilItsAskerHasArrived(one.conversation)
        .then((arrived) => {
          if (!arrived) {
            couldNot('the conversation that asked is still starting')
            return
          }
          if (this.itsNameIsRegistered(name))
            this.settleNow(one, 'superseded', A_PERSON_DID_IT, {}, told)
        })
        .catch(couldNot)
    }
  }

  private async whatAServerOffers(name: string, url: string): Promise<readonly string[]> {
    const badName = externalMcpNameRefusal(name, AGENT_TOOL_SERVER)
    if (badName !== null) throw new Error(badName)
    const badUrl = externalMcpUrlRefusal(url)
    if (badUrl !== null) throw new Error(badUrl)
    let offered: readonly string[]
    try {
      offered = await discoverExternalMcpTools(url)
    } catch (error) {
      throw new ServerNotReached(url, error)
    }
    const colliding = collidingToolNames(offered, TOOL_NAMES)
    if (colliding.length > 0) {
      throw new Error(externalMcpCollisionRefusal(foldProfileName(name), colliding))
    }
    return offered
  }

  async decideMcpServerRequest(
    requestId: string,
    approve: boolean,
    by: Caller,
  ): Promise<AnswerAck> {
    const waiting = this.mcpServerRequestWaiting(requestId)
    if (waiting === null) return this.noLongerWaiting(requestId)
    if (this.mcpServerRequestsBeingDecided.has(requestId)) {
      return {
        outcome: 'refused',
        reason: 'that request is being decided right now, so this press did nothing',
        stillOpen: true,
      }
    }
    const asked = waiting.requested
    const actor = whoDidIt(by)
    this.mcpServerRequestsBeingDecided.add(requestId)
    try {
      if (!approve) {
        return await this.endARequest(
          waiting,
          'refused',
          actor,
          {},
          MCP_SERVER_REQUEST_TOLD.refused(requestId, asked.name, asked.url),
          { outcome: 'taken', reason: 'Refused. Nothing was registered.' },
        )
      }
      const couldNotRegister = (why: string): Promise<AnswerAck> =>
        this.endARequest(
          waiting,
          'could-not-register',
          actor,
          { why },
          MCP_SERVER_REQUEST_TOLD.couldNotRegister(requestId, asked.name, why),
          { outcome: 'refused', reason: `Could not register: ${why}`, stillOpen: false },
        )
      const takenFirst = await this.ifItsNameIsTaken(waiting)
      if (takenFirst !== null) return takenFirst
      let offered: readonly string[]
      try {
        offered = await this.whatAServerOffers(asked.name, asked.url)
      } catch (error) {
        if (error instanceof ServerNotReached) {
          const endedMeanwhile = this.endedOrTakenDownNow(waiting)
          if (endedMeanwhile !== null) return endedMeanwhile
          return {
            outcome: 'refused',
            reason: error.message,
            stillOpen: true,
          }
        }
        return await couldNotRegister(errorMessage(error))
      }
      if (!(await this.untilItsAskerHasArrived(waiting.conversation))) return ITS_ASKER_IS_STARTING
      const done = this.commitAnApproval(waiting, offered, actor)
      if (done.is === 'gone') return ANSWERED_FIRST
      if (done.is === 'starting') return ITS_ASKER_IS_STARTING
      if (done.is === 'taken') {
        return this.answerAnEnding(
          this.settleNow(
            waiting,
            'could-not-register',
            actor,
            { why: done.why },
            MCP_SERVER_REQUEST_TOLD.couldNotRegister(requestId, asked.name, done.why),
          ),
          { outcome: 'refused', reason: `Could not register: ${done.why}`, stillOpen: false },
          asked.name,
        )
      }
      if (done.is === 'superseded') {
        return this.answerAnEnding(
          this.settleNow(
            waiting,
            'superseded',
            A_PERSON_DID_IT,
            {},
            MCP_SERVER_REQUEST_TOLD.superseded(requestId, asked.name),
          ),
          takenDownSays(asked.name),
          asked.name,
        )
      }
      return this.answerAnApproval(waiting, done, offered)
    } catch (error) {
      if (error instanceof ItsRecordIsNotWritten) {
        return {
          outcome: 'refused',
          reason: `BroCrew can no longer write the record of the conversation that asked, so nothing was decided: ${error.message}. Stop that conversation, then decide this again.`,
          stillOpen: true,
        }
      }
      return {
        outcome: 'refused',
        reason: `BroCrew could not record that decision, so nothing changed: ${errorMessage(error)}. ${approve ? 'Press it again, or refuse it.' : 'Press it again.'}`,
        stillOpen: true,
      }
    } finally {
      this.mcpServerRequestsBeingDecided.delete(requestId)
    }
  }

  private noLongerWaiting(requestId: string): AnswerAck {
    return this.deps.store.mcpServerRequestWasMade(requestId)
      ? ANSWERED_FIRST
      : {
          outcome: 'refused',
          reason: 'there is no request waiting by that name, so nothing was registered',
          stillOpen: false,
        }
  }

  private endedOrTakenDownNow(waiting: McpServerRequestWaiting): AnswerAck | null {
    const { requestId, name } = waiting.requested
    if (!this.stillWaiting(requestId)) return this.noLongerWaiting(requestId)
    if (!this.itsNameIsRegistered(name)) return null
    return this.answerAnEnding(
      this.settleNow(
        waiting,
        'superseded',
        A_PERSON_DID_IT,
        {},
        MCP_SERVER_REQUEST_TOLD.superseded(requestId, name),
      ),
      takenDownSays(name),
      name,
    )
  }

  private async ifItsNameIsTaken(waiting: McpServerRequestWaiting): Promise<AnswerAck | null> {
    if (!this.itsNameIsRegistered(waiting.requested.name)) return null
    if (!(await this.untilItsAskerHasArrived(waiting.conversation))) return ITS_ASKER_IS_STARTING
    return this.endedOrTakenDownNow(waiting)
  }

  private answerAnApproval(
    waiting: McpServerRequestWaiting,
    done: Extract<ApprovalCommitted, { is: 'approved' }>,
    offered: readonly string[],
  ): AnswerAck {
    try {
      this.theWorldMoved('agents')
    } catch (error) {
      console.warn(`runtime host could not announce ${done.row.name}: ${errorMessage(error)}`)
    }
    let told = false
    try {
      told = this.tellTheAskerItWasApproved(waiting, done.row, offered, done.granted)
    } catch (error) {
      console.warn(
        `runtime host registered ${done.row.name} but could not tell the conversation that asked: ${errorMessage(error)}`,
      )
    }
    const registered = `Registered. It offers: ${theToolsItOffered(offered)}.`
    const notGiven =
      done.notGiven.length === 0
        ? ''
        : ` ${done.notGiven.join(', ')} no longer ${done.notGiven.length === 1 ? 'exists' : 'exist'}, so it was not given to them.`
    return {
      outcome: 'taken',
      reason: `${registered}${notGiven}${told ? '' : ` ${THE_ASKER_WAS_NOT_TOLD}`}`,
    }
  }

  private async endARequest(
    waiting: McpServerRequestWaiting,
    ending: Exclude<McpServerRequestEnding, 'approved'>,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'why'>,
    told: string,
    says: AnswerAck,
  ): Promise<AnswerAck> {
    return this.answerAnEnding(
      await this.settleARequest(waiting, ending, by, said, told),
      says,
      waiting.requested.name,
    )
  }

  private answerAnEnding(ended: RequestSettled, says: AnswerAck, name: string): AnswerAck {
    if (ended.is === 'starting') return ITS_ASKER_IS_STARTING
    if (ended.is === 'gone') return ANSWERED_FIRST
    const answer = ended.as === 'superseded' ? takenDownSays(name) : says
    if (ended.told) return answer
    return { ...answer, reason: `${answer.reason ?? ''} ${THE_ASKER_WAS_NOT_TOLD}`.trim() }
  }

  private commitAnApproval(
    waiting: McpServerRequestWaiting,
    offered: readonly string[],
    by: ActedBy,
  ): ApprovalCommitted {
    const asked = waiting.requested
    const reach: ExternalMcpServerReach = asked.whoGetsIt === 'everyone' ? 'everyone' : 'restricted'
    let after: (() => void) | null = null
    let done: ApprovalCommitted
    try {
      done = this.deps.store.atomically((): ApprovalCommitted => {
        if (!this.stillWaiting(asked.requestId)) return { is: 'gone' }
        const there = this.deps.store
          .externalMcpServers()
          .find((one) => theAddressOf(one.url) === theAddressOf(asked.url))
        if (there !== undefined && foldProfileName(there.name) !== foldProfileName(asked.name)) {
          return {
            is: 'taken',
            why: `a server at ${asked.url} is already registered, as “${there.name}”`,
          }
        }
        const row = this.deps.store.registerExternalMcpServer({
          name: asked.name,
          url: asked.url,
          reach,
        })
        if (row === null) return { is: 'superseded' }
        const grants =
          reach === 'everyone'
            ? null
            : this.deps.store.grantExternalMcpServer(row.name, asked.agents ?? [])
        if (reach !== 'everyone' && grants === null)
          throw new Error(`${row.name} is not registered`)
        const notGiven = grants?.missing ?? []
        const appended = this.appendTheSettledRow(
          waiting.conversation,
          asked.requestId,
          'approved',
          by,
          {
            offered,
            ...(notGiven.length === 0 ? {} : { notGiven }),
          },
        )
        if (appended === 'starting') throw new ItsAskerIsStarting()
        after = appended
        return { is: 'approved', row, granted: grants?.granted ?? null, notGiven }
      })
    } catch (error) {
      if (error instanceof ItsAskerIsStarting) return { is: 'starting' }
      throw error
    }
    if (done.is === 'approved') this.onceItIsSettled(asked.requestId, after)
    return done
  }

  private stillWaiting(requestId: string): boolean {
    return this.deps.store
      .mcpServerRequestsWaiting()
      .some((one) => one.requested.requestId === requestId)
  }

  private mcpServerRequestWaiting(requestId: string): McpServerRequestWaiting | null {
    return (
      this.deps.store
        .mcpServerRequestsWaiting()
        .find((one) => one.requested.requestId === requestId) ?? null
    )
  }

  private async untilItsAskerHasArrived(conversation: string): Promise<boolean> {
    for (let waited = 0; waited < 3; waited += 1) {
      const slot = this.slots.get(conversation)
      if (slot === undefined || slot.session !== null) return true
      if (!(await settledWithin(slot.arrived, A_DECISION_WAITS_FOR_A_START_MS))) return false
    }
    const slot = this.slots.get(conversation)
    return slot === undefined || slot.session !== null
  }

  private async settleARequest(
    waiting: McpServerRequestWaiting,
    ending: Exclude<McpServerRequestEnding, 'approved'>,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'why'>,
    told: string,
  ): Promise<RequestSettled> {
    if (!(await this.untilItsAskerHasArrived(waiting.conversation))) return { is: 'starting' }
    return this.settleNow(waiting, ending, by, said, told)
  }

  private settleNow(
    waiting: McpServerRequestWaiting,
    ending: Exclude<McpServerRequestEnding, 'approved'>,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'why'>,
    told: string,
  ): RequestSettled {
    const { requestId, name } = waiting.requested
    let after: (() => void) | null = null
    const written = { as: ending }
    const settled = this.deps.store.atomically((): 'settled' | 'gone' | 'starting' => {
      if (!this.stillWaiting(requestId)) return 'gone'
      const takenDown = ending !== 'superseded' && this.itsNameIsRegistered(name)
      written.as = takenDown ? 'superseded' : ending
      const appended = takenDown
        ? this.appendTheSettledRow(
            waiting.conversation,
            requestId,
            'superseded',
            A_PERSON_DID_IT,
            {},
          )
        : this.appendTheSettledRow(waiting.conversation, requestId, ending, by, said)
      if (appended === 'starting') return 'starting'
      after = appended
      return 'settled'
    })
    if (settled !== 'settled') return { is: settled }
    this.onceItIsSettled(requestId, after)
    const words = written.as === ending ? told : MCP_SERVER_REQUEST_TOLD.superseded(requestId, name)
    return { is: 'settled', as: written.as, told: this.tellTheAsker(waiting.conversation, words) }
  }

  private itsNameIsRegistered(name: string): boolean {
    const folded = foldProfileName(name)
    return this.deps.store.externalMcpServers().some((one) => foldProfileName(one.name) === folded)
  }

  private onceItIsSettled(requestId: string, after: (() => void) | null): void {
    try {
      after?.()
    } catch (error) {
      console.warn(
        `runtime host settled MCP server request ${requestId} but could not show it: ${errorMessage(error)}`,
      )
    }
  }

  private appendTheSettledRow(
    conversation: string,
    requestId: string,
    ending: McpServerRequestEnding,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'offered' | 'notGiven' | 'why'>,
  ): (() => void) | 'starting' {
    const slot = this.slots.get(conversation)
    const session = slot?.session ?? null
    if (slot !== undefined && session === null) return 'starting'
    if (session !== null && session.recordingFailure !== null) {
      throw new ItsRecordIsNotWritten(session.recordingFailure)
    }
    const event: McpServerRequestSettledEvent = {
      type: 'mcp_server_request_settled',
      requestId,
      ending,
      by,
      ...said,
    }
    const next = this.deps.store.nextOrdinal(conversation)
    const ordinal = session === null ? next : Math.max(session.ordinal, next)
    const at = this.now()
    this.deps.store.append(conversation, ordinal, event, at)
    const message: RuntimeEventMessage = { sessionId: conversation, ordinal, at, event }
    return () => {
      if (session === null) {
        this.showTheWindowsLookingAt(conversation, message)
        this.stateMayHaveMoved(conversation)
        return
      }
      session.ordinal = Math.max(session.ordinal, ordinal + 1)
      this.emitOurs(session, message)
    }
  }

  private tellTheAsker(conversation: string, text: string): boolean {
    let asker = conversation
    try {
      asker = this.theOneInItsPlace(conversation)
      const kept = { nowhere: false }
      this.holdUntilItStarts(asker, text, TOLD_ABOUT_A_SERVER_REQUEST, 'notice', (where) => {
        if (where === 'nowhere') kept.nowhere = true
      })
      if (kept.nowhere) return false
    } catch (error) {
      console.warn(
        `runtime host could not tell ${asker} how its MCP server request ended: ${errorMessage(error)}`,
      )
      return false
    }
    const notStarted = (error: unknown): void => {
      console.warn(
        `runtime host could not start ${asker} to tell it how its MCP server request ended: ${errorMessage(error)}`,
      )
    }
    try {
      if (!this.keptStopped(asker) && !this.runsNow(asker)) {
        void this.ensureRunning(asker, null).catch(notStarted)
      }
    } catch (error) {
      notStarted(error)
    }
    return true
  }

  private tellTheAskerItWasApproved(
    waiting: McpServerRequestWaiting,
    row: ExternalMcpServerRow,
    offered: readonly string[],
    granted: readonly string[] | null,
  ): boolean {
    const { requestId } = waiting.requested
    const forWhom = granted === null ? 'every agent' : granted.join(', ') || 'no agent'
    const asker = this.theOneInItsPlace(waiting.conversation)
    const profile = this.deps.store.recordedOne(asker)?.profileId ?? null
    const itsProfileGetsIt =
      profile !== null &&
      this.deps.store.externalMcpServersFor(profile).some((server) => server.name === row.name)
    if (!itsProfileGetsIt) {
      return this.tellTheAsker(
        asker,
        MCP_SERVER_REQUEST_TOLD.approvedNotHere(requestId, row.name, forWhom),
      )
    }
    return this.reopenForItsTools(asker, {
      reopened: MCP_SERVER_REQUEST_TOLD.approvedAndReopened(
        requestId,
        row.name,
        row.url,
        forWhom,
        offered,
      ),
      notReopened: (because) =>
        MCP_SERVER_REQUEST_TOLD.approvedNotReopened(
          requestId,
          row.name,
          row.url,
          forWhom,
          offered,
          because,
        ),
    })
  }

  private reopenForItsTools(conversation: string, told: ItsToolsMoved): boolean {
    const starting = this.slots.get(conversation)
    if (starting !== undefined && starting.session === null && !onItsWayOut(starting)) {
      const again = (): void => {
        try {
          const neverRegistered =
            this.slots.get(conversation) === starting && starting.session === null
          if (neverRegistered) this.tellTheAsker(conversation, told.reopened)
          else this.reopenForItsTools(conversation, told)
        } catch (error) {
          console.warn(
            `runtime host could not reopen ${conversation} with its new tools: ${errorMessage(error)}`,
          )
        }
      }
      void starting.arrived.then(again, again)
      return true
    }
    const session = this.slots.get(conversation)?.session ?? null
    if (session === null || !this.runsNow(conversation) || this.keptStopped(conversation)) {
      return this.tellTheAsker(conversation, told.reopened)
    }
    session.itsToolsMoved = [...(session.itsToolsMoved ?? []), told]
    this.reopenWhenItsToolsMoved(session)
    return true
  }

  private reopenWhenItsToolsMoved(session: HostedSession): boolean {
    if (session.reopeningForItsTools === true) return true
    const told = session.itsToolsMoved
    if (told === undefined) return false
    if (
      this.launches.closed ||
      this.itStoppedUnder(session) ||
      session.reopeningOnTheCurrentSignIn === true
    ) {
      delete session.itsToolsMoved
      for (const one of told) {
        this.holdUntilItStarts(session.id, one.reopened, TOLD_ABOUT_A_SERVER_REQUEST)
      }
      return false
    }
    const cutTurnWaits =
      this.cutHoldsTheFirstBatch.has(session.id) ||
      this.continuationLife.get(session.id) === session
    const waits = cutTurnWaits
      ? 'its-turn'
      : (this.whatAReopenWaitsFor(session) ?? (this.aCardIsOpenIn(session) ? 'a-person' : null))
    if (waits === 'its-turn' || waits === 'a-person') return false
    if (waits !== null) {
      delete session.itsToolsMoved
      for (const one of told) this.tellTheAsker(session.id, one.notReopened(waits))
      return false
    }
    let closing: Promise<void>
    try {
      closing = this.close(session.id, THE_APP_ITSELF)
    } catch (error) {
      console.warn(
        `runtime host could not stop ${session.id} to reopen it with its new tools: ${errorMessage(error)}`,
      )
      return false
    }
    delete session.itsToolsMoved
    session.reopeningForItsTools = true
    this.reopeningForApprovedTools.add(session.id)
    for (const one of told) {
      this.holdUntilItStarts(session.id, one.reopened, TOLD_ABOUT_A_SERVER_REQUEST)
    }
    console.info(
      `runtime host: reopening ${session.id} so an MCP server a person approved reaches it`,
    )
    void closing.catch((error: unknown) => {
      this.reopeningForApprovedTools.delete(session.id)
      console.warn(
        `runtime host could not stop ${session.id} to reopen it with its new tools: ${errorMessage(error)}`,
      )
    })
    return true
  }

  private aCardIsOpenIn(session: HostedSession): boolean {
    const unread = rowsUnreadOnce()
    try {
      const open = this.deps.store
        .routedRequestsOf(session.id, unread)
        .filter((one) => REQUEST_IS_OPEN[one.state] && one.at >= session.lifeSince)
      if (open.length > 0) {
        const asked = this.deps.store.questionsRaisedIn(session.id, unread)
        if (open.some((one) => asked.get(one.requestId)?.raisedBy !== 'this-app')) return true
      }
      return unread.count > 0 || unread.ledgersSkipped > 0
    } catch (error) {
      console.warn(
        `runtime host could not read ${session.id}'s open cards, so its reopen waits: ${errorMessage(error)}`,
      )
      return true
    }
  }

  private aCardMayHaveEnded(conversation: string): void {
    const live = this.slots.get(conversation)?.session ?? null
    if (live === null || live.itsToolsMoved === undefined) return
    queueMicrotask(() => {
      try {
        this.reopenWhenItsToolsMoved(live)
      } catch (error) {
        console.warn(
          `runtime host could not reopen ${conversation} with its new tools: ${errorMessage(error)}`,
        )
      }
    })
  }

  removeExternalMcpServer(serverId: string): boolean {
    return this.deps.store.removeExternalMcpServer(serverId)
  }

  setAgentProvider(profileSlug: string, provider: Provider | null): AgentProviderSet | null {
    return this.modelCatalogues.setAgentProvider(profileSlug, provider)
  }

  setAgentModelAndEffort(
    profileSlug: string,
    choice: AgentModelChoice | null,
  ): Promise<ModelChoiceSaved> {
    return this.modelCatalogues.setAgentModelAndEffort(profileSlug, choice)
  }

  agentModelAndEffort(profileSlug: string): AgentModelChoice | null {
    return this.modelCatalogues.agentModelAndEffort(profileSlug)
  }

  modelList(provider: Provider, profileId: string = DEFAULT_PROFILE_ID): Promise<ModelList> {
    return this.modelCatalogues.modelList(provider, profileId)
  }

  addHandAddedModel(provider: Provider, model: string): readonly string[] {
    return this.modelCatalogues.addHandAddedModel(provider, model)
  }

  aPersonPicked(provider: Provider, profileId: string, pair: ModelAndEffort): Promise<void> {
    return this.modelCatalogues.aPersonPicked(provider, profileId, pair)
  }

  deleteHandAddedModel(provider: Provider, model: string): readonly string[] {
    return this.modelCatalogues.deleteHandAddedModel(provider, model)
  }

  judgeTheDefaultItNames(
    me: string,
    named: Provider | null,
    asked: { readonly model?: string; readonly effort?: string },
  ): Promise<
    | { readonly ok: true; readonly chosen: AgentModelChoice }
    | { readonly ok: false; readonly refusal: ModelRefusal }
  > {
    return this.modelCatalogues.judgeTheDefaultItNames(me, named, asked)
  }

  private theListsAsLastRead(): ListsAsLastRead {
    return this.modelCatalogues.theListsAsLastRead()
  }

  private theSelectedModel(
    provider: Provider,
    profileSlug: string | null,
    askIn: string,
    named: { readonly model?: string; readonly effort?: string },
  ): Promise<SelectedModel> {
    return this.modelCatalogues.theSelectedModel(provider, profileSlug, askIn, named)
  }

  private recordWhatItReportsRunning(session: HostedSession): void {
    const model = session.handle.agentInfo?.model ?? null
    if (model === null) return
    const info = session.handle.agentInfo
    const effort = info?.reasoningEffortReported === true ? (info.reasoningEffort ?? null) : null
    const key = `${model}\u0000${effort ?? ''}`
    if (session.lastReported === key) return
    const firstOfThisLife = session.lastReported === ''
    session.lastReported = key
    this.record(session, () => {
      const onRecord =
        effort === null &&
        firstOfThisLife &&
        providerDefinitions[session.provider].transcripts.keepEarlierReportedEffort()
          ? this.deps.store.whatItRunsOn(session.id)
          : null
      const kept = onRecord?.reportedModel === model ? onRecord.reportedEffort : null
      this.deps.store.setReportedModel(session.id, model, effort ?? kept)
    })
  }

  setAgentDisplayName(profileSlug: string, displayName: string | null): AgentIdentity | null {
    if (!this.deps.store.setAgentDisplayName(profileSlug, displayName)) return null
    this.theWorldMoved('agents')
    const folded = foldProfileName(profileSlug)
    return this.deps.store.agentIdentities().find(({ slug }) => slug === folded) ?? null
  }

  agentInstructions(profileSlug: string): AgentInstructionsReading {
    const about = foldProfileName(profileSlug)
    return {
      own: this.deps.store.ownInstructionsOf(profileSlug),
      waiting: this.deps.store.instructionAsksWaiting().filter((one) => one.asked.about === about),
      readAt: this.now(),
    }
  }

  agentMemory(profileSlug: string): AgentMemoryReading {
    const profileId = foldProfileName(profileSlug)
    const read = readAgentMemory(this.memoryInputs(profileId))
    return {
      profileId,
      stores: read.stores,
      amendments: this.deps.store.memoryAmendmentsOf(profileId),
      ...(this.deps.memoryKnowledge?.busy(profileId) ? { changing: true as const } : {}),
      ...(this.memoryHolding(profileId).hasUnfinishedMemoryChange
        ? { needsChecking: true as const }
        : {}),
      readAt: read.readAt,
    }
  }

  agentMemoryPage(profileSlug: string, offset: number, limit: number): AgentMemoryReading {
    const profileId = foldProfileName(profileSlug)
    const read = readAgentMemoryPaged(this.memoryInputs(profileId), { offset, limit })
    return {
      profileId,
      stores: read.stores,
      amendments: this.deps.store.memoryAmendmentsOf(profileId),
      ...(this.deps.memoryKnowledge?.busy(profileId) ? { changing: true as const } : {}),
      ...(this.memoryHolding(profileId).hasUnfinishedMemoryChange
        ? { needsChecking: true as const }
        : {}),
      readAt: read.readAt,
    }
  }

  private whatALaunchGave(
    provider: Provider,
    sessionId: string,
    toolset: AgentToolset,
    reportedByTheProvider: readonly string[],
    read: ReturnType<NonNullable<RuntimeHostDeps['readInstructions']>> | undefined,
    contextIfUnsaid: () => InstructionContext,
    launchSettings?: readonly LaunchSetting[],
    builtInSkills?: PreparedBuiltInSkills,
  ): WhatALaunchGave | null {
    if (read === undefined) return null
    try {
      const context = read.context ?? contextIfUnsaid()
      return whatThisLaunchGave({
        provider,
        build: context.build ?? null,
        instructions: read.instructions,
        profileFile: read.profileFile ?? null,
        ownInstructionsVersion: this.theVersionRenderedIn(context),
        ownNotesVersion: context.ownNotes?.version ?? null,
        reportedByTheProvider,
        toolset,
        ...(launchSettings === undefined ? {} : { launchSettings }),
        ...(read.textPack === undefined ? {} : { textPack: read.textPack }),
        ...(read.savedMethods === undefined ? {} : { savedMethods: read.savedMethods }),
        ...(builtInSkills
          ? {
              builtInSkills: {
                version: builtInSkills.version,
                ...(builtInSkills.catalogueRevision === undefined
                  ? {}
                  : { catalogueRevision: builtInSkills.catalogueRevision }),
                ...(builtInSkills.versions ? { versions: builtInSkills.versions } : {}),
                reminder: builtInSkills.reminder,
                listed: builtInSkills.context.skills.map((skill) => ({
                  ...skill,
                  descriptionMayBeCut: false,
                  scope: providerKnowledge[provider].skills.builtInScope,
                })),
              },
            }
          : {}),
      })
    } catch (error) {
      console.warn(
        `runtime host could not keep what launch ${sessionId} gave: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private commandsListedSinceItsLaunch(
    sessionId: string,
    launchedAt: number,
  ): {
    readonly commands: readonly ProviderCommand[]
    readonly at: number
    readonly dropped: number
  } | null {
    const row = this.deps.store.newestOfType?.(
      sessionId,
      'provider_commands',
      undefined,
      launchedAt,
    )
    return row?.event.type === 'provider_commands'
      ? { commands: row.event.commands, at: row.at, dropped: row.event.dropped ?? 0 }
      : null
  }

  private whereItStandsNow(sessionId: string): {
    readonly approval: 'ask' | 'auto' | null
    readonly planning: boolean | null
  } {
    const row = this.deps.store.find(sessionId)
    if (row === null) return { approval: null, planning: null }
    return {
      approval: row.approvalMode,
      planning: row.planMode === null ? null : row.planMode && row.planEndedAt === null,
    }
  }

  private theVersionRenderedIn(context: InstructionContext): number | null {
    if (context.profileSlug === null) return null
    const rendered = context.configured?.trim() ?? ''
    const versions = this.deps.store.ownInstructionsOf(context.profileSlug).versions
    if (rendered === '') {
      const newest = versions[0]
      return newest !== undefined && newest.text.trim() === '' ? newest.version : null
    }
    return versions.find((one) => one.text.trim() === rendered)?.version ?? null
  }

  private composesInItsOwnHome(providerHome: string): boolean {
    const root = this.deps.providerHomesRoot?.()
    if (root === undefined) return true
    const inside = relative(resolvePath(root), resolvePath(providerHome))
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
  }

  async whatThisAgentWasGiven(sessionId: string): Promise<WhatThisAgentWasGiven> {
    const live = this.slots.get(sessionId)?.session ?? null
    const row = this.deps.store.recordedOne(sessionId)
    if (row === null) {
      throw this.refusalTranslated(
        new SessionUnavailable('not-recorded', `session ${sessionId} has no record`),
        'read what an agent was given',
      )
    }
    const provider = row.provider
    const profileSlug = row.profileId === null ? null : foldProfileName(row.profileId)
    const providerHome = live?.providerHome ?? this.providerHomeFor(row)
    const imported = row.restoredFromBundle || row.foundInUserHome
    const launchedRow = this.deps.store.newestOfType?.(sessionId, 'launched') ?? null
    const stored = launchedRow?.event.type === 'launched' ? launchedRow.event.given : undefined
    const kept = imported
      ? null
      : (live?.launchGave ?? (stored === undefined ? null : aLaunchRecordIn(stored)))
    const running = live !== null
    const build = this.theBuildRunning()
    let record = kept
    let launch: WhatThisAgentWasGiven['launch']
    if (record !== null) {
      launch = {
        recorded: true,
        at: launchedRow?.at ?? live?.lifeSince ?? this.now(),
        build: record.build,
        thisBuild: record.build !== null && build !== null && record.build.commit === build.commit,
        running,
      }
    } else {
      const context = this.instructionContext(
        row.profileId,
        row.cwd,
        this.deps.store.parentOf(sessionId),
        sessionId,
      )
      const read = this.composesInItsOwnHome(providerHome)
        ? this.deps.readInstructions?.(provider, row.cwd, providerHome, context)
        : undefined
      record = this.whatALaunchGave(
        provider,
        sessionId,
        this.agentToolsForSession(sessionId),
        providerKnowledge[provider].instructions.given.nativeFiles(row.cwd),
        read,
        () => context,
      )
      launch = {
        recorded: false,
        why: imported
          ? 'before-this-build'
          : launchedRow === null
            ? row.adoptedAt !== null
              ? 'before-this-build'
              : 'never-launched'
            : running || stored !== undefined
              ? 'not-kept'
              : 'before-this-build',
        running,
      }
    }
    const versions = (await this.providerVersions())[provider]
    const toolInventory = this.deps.store.newestOfType?.(sessionId, 'tool_inventory') ?? null
    const published =
      toolInventory?.event.type === 'tool_inventory'
        ? (toolInventory.event.published?.tools ?? null)
        : null
    const publishedAt = published === null ? null : (toolInventory?.at ?? null)
    let started =
      providerDescriptor(provider).contextPlacement === 'first-message' ? toolInventory : null
    while (started?.event.type === 'tool_inventory' && started.event.source === 'thread/resume') {
      started = this.deps.store.newestOfType?.(sessionId, 'tool_inventory', started.ordinal) ?? null
    }
    const startedWith =
      started?.event.type === 'tool_inventory'
        ? (started.event.declared?.instructions ?? null)
        : null
    const declaredWith =
      startedWith !== null && startedWith.length < MAX_TOOL_TEXT ? startedWith : null
    const contextRow =
      live === null ? (this.deps.store.newestOfType?.(sessionId, 'context_reading') ?? null) : null
    const context =
      live !== null
        ? live.latestContext
        : contextRow?.event.type === 'context_reading'
          ? contextRow.event.reading
          : null
    return whatItWasGiven({
      sessionId,
      provider,
      profileId: row.profileId,
      launch,
      record: record ?? {
        build: null,
        placement: providerDescriptor(provider).contextPlacement,
        profileFile: null,
        ownInstructionsVersion: null,
        thisConversation: null,
        files: [],
        memory: [],
        tools: { server: '', count: 0, sha256: '' },
      },
      own: profileSlug === null ? null : this.deps.store.ownInstructionsOf(profileSlug),
      toolset: this.agentToolsForSession(sessionId),
      published,
      publishedAt,
      declaredWith,
      standsNow: this.whereItStandsNow(sessionId),
      listedCommands: this.commandsListedSinceItsLaunch(sessionId, launchedRow?.ordinal ?? 0),
      externalServers: (
        externalMcpContext(this.deps.store, provider, row.profileId).externalMcp?.servers ?? []
      ).map((one) => one.name),
      memory:
        profileSlug === null
          ? { stores: [], readAt: this.now() }
          : readAgentMemoryPaged(this.memoryInputs(profileSlug), {
              offset: 0,
              limit: AGENT_MEMORY_NOTES_SHOWN,
            }),
      providerVersion: versions.version,
      snapshot: this.snapshotForWhatItRunsOn(sessionId, provider),
      context,
      now: Date.now(),
    })
  }

  private snapshotForWhatItRunsOn(
    sessionId: string,
    provider: Provider,
  ): { readonly model: string | null; readonly answer: SnapshotAnswer } | null {
    if (this.deps.providerSnapshot === undefined) return null
    const runs = this.deps.store.whatItRunsOn(sessionId)
    const named = [runs?.reportedModel, runs?.model].filter(
      (one, at, all): one is string =>
        typeof one === 'string' && one !== '' && all.indexOf(one) === at,
    )
    let first: { readonly model: string | null; readonly answer: SnapshotAnswer } | null = null
    for (const model of named.length === 0 ? [null] : named) {
      const answer = this.deps.providerSnapshot(provider, model)
      if (answer.found) return { model, answer }
      if (first === null) first = { model, answer }
    }
    return first
  }

  async whatTheModelGot(sessionId: string, ordinal: number): Promise<WhatTheModelGot> {
    const store = this.deps.store
    const row = store.recordedOne(sessionId)
    if (row === null) {
      throw this.refusalTranslated(
        new SessionUnavailable('not-recorded', `session ${sessionId} has no record`),
        'read what the model got',
      )
    }
    const there = store.eventsFrom(sessionId, ordinal, 1)[0]
    if (there?.ordinal !== ordinal) {
      throw new Error('There is no row at that place in this conversation’s record.')
    }
    const message =
      there.event.type === 'user_turn'
        ? there
        : (store.newestOfType?.(sessionId, 'user_turn', ordinal) ?? null)
    if (message?.event.type !== 'user_turn') {
      throw new Error('No message was handed to the model at or before that place.')
    }
    const launched = store.newestOfType?.(sessionId, 'launched', message.ordinal) ?? null
    const before =
      launched === null
        ? null
        : (store.newestOfType?.(sessionId, 'user_turn', message.ordinal) ?? null)
    const stored = launched?.event.type === 'launched' ? launched.event.given : undefined
    const record =
      row.restoredFromBundle || row.foundInUserHome || stored === undefined
        ? null
        : aLaunchRecordIn(stored)
    const kept =
      row.restoredFromBundle || row.foundInUserHome
        ? 'imported'
        : stored === undefined
          ? 'none'
          : record === null
            ? 'unreadable'
            : 'recorded'
    const earlierInThisLaunch = function* (): Generator<AnEarlierMessage> {
      if (launched === null) return
      for (let one = before; one !== null && one.ordinal > launched.ordinal;) {
        const older = store.newestOfType?.(sessionId, 'user_turn', one.ordinal) ?? null
        yield {
          ordinal: one.ordinal,
          sent: one.event.type === 'user_turn' ? one.event.sent : undefined,
          first: older === null || older.ordinal < launched.ordinal,
        }
        one = older
      }
    }
    return oneMessageAsTheModelGotIt({
      sessionId,
      provider: row.provider,
      message: { ordinal: message.ordinal, at: message.at, event: message.event },
      launch:
        launched === null ? null : { ordinal: launched.ordinal, at: launched.at, kept, record },
      firstOfItsLaunch:
        launched === null ? null : before === null || before.ordinal < launched.ordinal,
      earlierInThisLaunch,
      leadsInThisThread: await this.theLeadsItsThreadHolds(
        sessionId,
        row.provider,
        record !== null,
        message.ordinal,
      ),
      providersRecord: await this.turnAsSent(sessionId, message.ordinal),
    })
  }

  private memoryInputs(profileId: string): AgentMemoryInputs {
    return {
      profileId,
      homeOf: (provider) => this.deps.providerHomePath(provider, profileId),
      homesRoot: this.deps.providerHomesRoot?.() ?? null,
    }
  }

  async amendAgentMemory(
    command: MemoryAmendmentAsked,
    by: Caller,
  ): Promise<AgentMemoryAmended | null> {
    if (whoDidIt(by).who !== 'a-person' || this.closing || !this.deps.memoryKnowledge) return null
    const profileId = foldProfileName(command.profileId)
    if (this.deps.store.agentIdentities().every(({ slug }) => slug !== profileId)) return null
    const result = await this.deps.memoryKnowledge?.amend(
      {
        profile: profileId,
        provider: command.provider,
        entry: command.entry,
        act: command.act,
        text: command.text,
        confirmed: command.confirmed,
      },
      whoDidIt(by),
    )
    if (this.closing) return null
    const reading = this.agentMemory(profileId)
    return result?.ok && result.amendment
      ? { done: true, amendment: result.amendment, reading }
      : {
          done: false,
          refused: memoryChangeRefusal(result?.ok === false ? result.reason : undefined),
          ...(result?.ok === false && result.cause ? { cause: result.cause } : {}),
          reading,
        }
  }

  async undoAgentMemory(command: MemoryUndoAsked, by: Caller): Promise<AgentMemoryAmended | null> {
    if (whoDidIt(by).who !== 'a-person' || this.closing || !this.deps.memoryKnowledge) return null
    const profileId = foldProfileName(command.profileId)
    if (this.deps.store.agentIdentities().every(({ slug }) => slug !== profileId)) return null
    const result = await this.deps.memoryKnowledge?.undo(
      profileId,
      command.sourceId,
      command.confirmed,
      whoDidIt(by),
    )
    if (this.closing) return null
    const reading = this.agentMemory(profileId)
    return result?.ok && result.amendment
      ? { done: true, amendment: result.amendment, reading }
      : {
          done: false,
          refused: memoryChangeRefusal(result?.ok === false ? result.reason : undefined),
          ...(result?.ok === false && result.cause ? { cause: result.cause } : {}),
          reading,
        }
  }

  async checkInterruptedMemory(
    command: MemoryCheckAsked,
    by: Caller,
  ): Promise<MemoryChecked | null> {
    if (whoDidIt(by).who !== 'a-person' || this.closing || !this.deps.memoryKnowledge) return null
    const profileId = foldProfileName(command.profileId)
    if (this.deps.store.agentIdentities().every(({ slug }) => slug !== profileId)) return null
    const result = await this.deps.memoryKnowledge?.checkInterrupted(
      profileId,
      command.confirmed,
      whoDidIt(by),
    )
    if (this.closing) return null
    const reading = this.agentMemory(profileId)
    return result?.ok
      ? { done: true, reading }
      : {
          done: false,
          refused: memoryChangeRefusal(result?.ok === false ? result.reason : undefined),
          ...(result?.ok === false && result.cause ? { cause: result.cause } : {}),
          reading,
        }
  }

  instructAgent(
    profileSlug: string,
    text: string,
    broughtBack: number | undefined,
    by: Caller,
    baseline?: RulesBaseline,
  ): AgentInstructionsReading | null {
    if (whoDidIt(by).who !== 'a-person') return null
    const current = this.deps.store.ownInstructionsOf(profileSlug).versions[0]
    const expected = baseline ?? {
      expectedVersion: current?.version ?? 0,
    }
    const written = this.deps.store.writeOwnInstructions(
      {
        profileSlug,
        text,
        expectedVersion: expected.expectedVersion,
        whoWroteIt: 'a-person',
        by: whoDidIt(by),
        conversation: null,
        said: null,
        broughtBack: broughtBack ?? null,
      },
      this.now(),
    )
    if (written === null) return null
    this.supersedeInstructionAsks(profileSlug, whoDidIt(by))
    this.theWorldMoved('agents')
    return this.agentInstructions(profileSlug)
  }

  decideInstruction(askId: string, approve: boolean, by: Caller): AnswerAck {
    if (whoDidIt(by).who !== 'a-person')
      return {
        outcome: 'refused',
        reason: 'only a person can decide this request',
        stillOpen: true,
      }
    const waiting = this.deps.store
      .instructionAsksWaiting()
      .find((one) => one.asked.askId === askId)
    if (waiting === undefined) {
      return {
        outcome: 'refused',
        reason: 'there is no request waiting by that name, so nothing was written',
        stillOpen: false,
      }
    }
    const actor = whoDidIt(by)
    if (approve) {
      if (
        waiting.asked.basedOnVersion === undefined ||
        (this.deps.store.ownInstructionsOf(waiting.asked.about).versions[0]?.version ?? 0) !==
          waiting.asked.basedOnVersion
      ) {
        this.endInstructionAsk(askId, 'superseded', THE_APP_DID_IT)
        return {
          outcome: 'refused',
          reason:
            'the rules changed or this request has no recorded baseline; ask for a new proposal',
          stillOpen: false,
        }
      }
      const written = this.deps.store.writeOwnInstructions(
        {
          profileSlug: waiting.asked.about,
          text: waiting.asked.text,
          whoWroteIt: 'an-agents-proposal',
          expectedVersion: waiting.asked.basedOnVersion,
          ...(waiting.asked.author === undefined ? {} : { author: waiting.asked.author }),
          by: actor,
          conversation: waiting.conversation,
          said: waiting.asked.why,
          broughtBack: null,
        },
        this.now(),
      )
      if (written === null) {
        this.endInstructionAsk(askId, 'refused', THE_APP_DID_IT)
        return {
          outcome: 'refused',
          reason:
            'the agent or its rules changed, so nothing was written and the request has been taken down',
          stillOpen: false,
        }
      }
      this.supersedeInstructionAsks(waiting.asked.about, actor, askId)
      this.theWorldMoved('agents')
    }
    if (!this.endInstructionAsk(askId, approve ? 'approved' : 'refused', actor)) {
      return {
        outcome: 'refused',
        reason: 'somebody answered that request first',
        stillOpen: false,
      }
    }
    return { outcome: 'taken' }
  }

  private supersedeInstructionAsks(profile: string, by: ActedBy, except?: string): void {
    for (const waiting of this.deps.store.instructionAsksWaiting()) {
      if (waiting.asked.about === foldProfileName(profile) && waiting.asked.askId !== except) {
        this.endInstructionAsk(waiting.asked.askId, 'superseded', by)
      }
    }
  }

  agentMethods(profile: string, offset: number, limit: number, by: Caller): MethodLibrary | null {
    if (whoDidIt(by).who !== 'a-person') return null
    return this.deps.savedMethods?.list(foldProfileName(profile), offset, limit) ?? null
  }

  agentMethodBody(profile: string, key: string, by: Caller): MethodBody | null {
    if (whoDidIt(by).who !== 'a-person') return null
    return this.deps.savedMethods?.body(foldProfileName(profile), key) ?? null
  }

  agentMethodChanges(
    profile: string,
    offset: number,
    limit: number,
    by: Caller,
  ): MethodHistoryResult {
    if (whoDidIt(by).who !== 'a-person') return { ok: false, reason: 'person-required' }
    return (
      this.deps.savedMethods?.history(foldProfileName(profile), offset, limit) ?? {
        ok: false,
        reason: 'source-unavailable',
      }
    )
  }

  async removeAgentMethod(
    profile: string,
    selection: MethodDeleteSelection,
    by: Caller,
  ): Promise<MethodChangeResult> {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person') return { ok: false, reason: 'person-required' }
    return (
      this.deps.savedMethods?.remove(foldProfileName(profile), selection, actor) ?? {
        ok: false,
        reason: 'source-unavailable',
      }
    )
  }

  async undoAgentMethod(
    profile: string,
    changeId: string,
    by: Caller,
  ): Promise<MethodChangeResult> {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person') return { ok: false, reason: 'person-required' }
    return (
      this.deps.savedMethods?.undo(foldProfileName(profile), changeId, actor) ?? {
        ok: false,
        reason: 'source-unavailable',
      }
    )
  }

  async checkInterruptedAgentMethods(
    profile: string,
    confirmed: boolean,
    by: Caller,
  ): Promise<MethodChangeResult> {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person') return { ok: false, reason: 'person-required' }
    return (
      this.deps.savedMethods?.checkInterrupted(foldProfileName(profile), confirmed, actor) ?? {
        ok: false,
        reason: 'source-unavailable',
      }
    )
  }

  agentRulesUnread(profile: string) {
    return this.deps.store.instructionUnread(profile)
  }

  undoAgentRules(
    profile: string,
    expectedVersion: number,
    by: Caller,
  ): AgentInstructionsReading | null {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person') return null
    const written = this.deps.store.undoOwnInstructions(profile, expectedVersion, actor, this.now())
    if (written === null) return null
    this.supersedeInstructionAsks(profile, actor)
    this.theWorldMoved('agents')
    return this.agentInstructions(profile)
  }

  markAgentRulesSeen(profile: string, throughVersion: number, by: Caller): boolean {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person') return false
    const marked = this.deps.store.markInstructionsSeen(profile, throughVersion, actor)
    if (marked) this.theWorldMoved('agents')
    return marked
  }

  private endInstructionAsk(askId: string, ending: InstructionEnding, by: ActedBy): boolean {
    const waiting = this.deps.store
      .instructionAsksWaiting()
      .find((one) => one.asked.askId === askId)
    if (waiting === undefined) return false
    const slot = this.slots.get(waiting.conversation)
    const session = slot?.session ?? null
    if (session === null) {
      return this.deps.store.settleInstructionAsk(askId, ending, by, this.now())
    }
    this.publishOurs(session, { type: 'instruction_settled', askId, ending, by })
    return true
  }

  removeAgent(profileSlug: string): AgentRemoved {
    const folded = foldProfileName(profileSlug)
    const identities = this.deps.store.agentIdentities()
    const mine = this.identityUseNow(identities).find((use) => use.slug === folded)
    if (mine === undefined) return { ok: false, rail: 'no-such-agent' }
    const held = whatHoldsIt(mine)
    if (held.length > 0) return { ok: false, rail: 'it-is-still-held', held }
    const identity = identities.find((one) => one.slug === folded)?.id
    const was = identity === undefined ? null : this.retireTheEntryOf(identity)
    try {
      if (!this.deps.store.removeAgentIdentity(folded)) {
        if (this.deps.store.hasPendingMemoryAmendment(folded))
          return { ok: false, rail: 'it-is-still-held', held: ['unfinished-memory-change'] }
        if (this.deps.store.hasPendingMethodChange(folded))
          return { ok: false, rail: 'it-is-still-held', held: ['unfinished-method-change'] }
        return { ok: false, rail: 'no-such-agent' }
      }
    } finally {
      if (identity !== undefined && was !== null) this.settleTheRetiredEntryOf(identity, was)
    }
    this.theWorldMoved('agents')
    return { ok: true, slug: folded }
  }

  setSpawningEnabled(enabled: boolean): { spawningEnabled: boolean } {
    this.deps.store.setSpawningEnabled(enabled)
    return this.deps.store.spawnPolicy()
  }

  private theServicesAmong(identities: readonly AgentIdentity[]): { services?: readonly string[] } {
    const read = this.profileExecution
    if (!read.readable) return {}
    const conflicts = this.profileExecutionConflicts
    const services = identities
      .filter((one) => kindOf(read, conflicts, one.id, one.createdAt) === 'service')
      .map((one) => one.slug)
    return services.length === 0 ? {} : { services }
  }

  setServicesOn(on: boolean): { servicesOn: boolean } {
    const read = this.profileExecution
    if (!read.readable) throw new Error(`which agents are services can’t be read: ${read.why}`)
    const kept = this.deps.profileExecution
    if (kept?.owned !== true) throw new Error(NOT_THE_ONLY_APP)
    const { profiles } = read.kept
    const next = on ? { profiles } : { servicesOff: true as const, profiles }
    kept.write(next)
    this.profileExecution = { readable: true, kept: next }
    this.theWorldMoved('agents')
    this.theWorldMoved('work')
    if (on) {
      try {
        for (const one of this.deps.store.servicesBorn()) {
          this.aServiceMayTakeItsNext(one.conversation)
          this.startForWhatWaits(one.conversation)
          const running = this.slots.get(one.conversation)?.session ?? null
          if (running !== null) this.flushQueued(running)
        }
      } catch (error) {
        console.warn(`runtime host could not set the services going: ${errorMessage(error)}`)
      }
    }
    return { servicesOn: this.servicesAreOn() }
  }

  setDefaultApprovalMode(mode: 'ask' | 'auto'): { defaultApprovalMode: 'ask' | 'auto' } {
    this.deps.store.setDefaultApprovalMode(mode)
    return { defaultApprovalMode: this.deps.store.defaultApprovalMode() }
  }

  providerModels(profileId: string, provider: Provider): Promise<ModelCatalogue> {
    return this.modelCatalogues.providerModels(profileId, provider)
  }

  private forgetModels(provider: Provider, profileId: string): void {
    return this.modelCatalogues.forgetModels(provider, profileId)
  }

  private async askProviderForModels(
    provider: Provider,
    profileId: string,
  ): Promise<ModelCatalogue> {
    if (this.launches.closed) return { ok: false, reason: 'closing' }
    let providerHome: string
    let connectionId: string | undefined
    let connectionRevision: number | undefined
    try {
      connectionId = this.deps.connectionFor?.(provider)
      connectionRevision = this.deps.connectionRevision?.(provider)
      const preparation = this.launches.open(`${provider} model home preparation`)
      try {
        if (this.deps.beforeProviderLaunch) await this.deps.beforeProviderLaunch()
        preparation.signal.throwIfAborted()
        providerHome = await this.deps.prepareProviderHome(provider, profileId)
        this.assertConnectionUnchanged(provider, connectionRevision)
      } finally {
        this.launches.finish(preparation)
      }
    } catch (error) {
      if (this.launches.closed) return { ok: false, reason: 'closing' }
      if (didNotAnswerInTime(error)) return this.aListReadTooSlowly(provider, error)
      console.warn(`model list for ${provider} unavailable: ${errorMessage(error)}`)
      return { ok: false, reason: 'refused', detail: this.howAFailureReads(error) }
    }
    let launch: Launch | null = null
    try {
      let copying: Promise<void> | undefined
      while ((copying = this.homeCopyJobs.get(profileSignInKey(provider, profileId))) !== undefined)
        await copying
      launch = this.launches.open(`${provider} model probe`)
      this.rememberHomeLaunch(provider, profileId, launch)
      if (this.deps.beforeProviderLaunch) {
        await this.deps.beforeProviderLaunch()
        launch.signal.throwIfAborted()
      }
      this.assertConnectionUnchanged(provider, connectionRevision)
      const runtime =
        connectionId === undefined
          ? this.deps.createRuntime(provider)
          : this.deps.createRuntime(provider, connectionId)
      const listing = runtime.listModels({ providerHome, signal: launch.signal })
      this.launches.finish(launch, listing)
      return { ok: true, models: await listing }
    } catch (error) {
      if (launch === null) return { ok: false, reason: 'closing' }
      this.launches.finish(launch)
      const detail = errorMessage(error)
      console.warn(`model list for ${provider} unavailable: ${detail}`)
      if (!launch.signal.aborted && didNotAnswerInTime(error)) {
        return this.aListReadTooSlowly(provider, error)
      }
      if (launch.signal.aborted) return { ok: false, reason: 'closing' }
      return { ok: false, reason: 'refused', detail: this.howAFailureReads(error) }
    }
  }

  private aListReadTooSlowly(
    provider: Provider,
    error: unknown,
  ): Exclude<ModelCatalogue, { ok: true }> {
    console.warn(`model list for ${provider} not read in time: ${errorMessage(error)}`)
    return { ok: false, reason: 'refused', detail: this.howAFailureReads(error), tooSlow: true }
  }

  async exportSession(said: ExportAsked): Promise<ExportedSession> {
    const { sessionId } = said
    const kind = said.exportKind
    const targetDir = this.deps.exportDirectory()
    if (this.deps.store.recordedOne(sessionId) === null) {
      throw new Error(`no recorded session: ${sessionId}`)
    }

    if (said.exportKind === 'reading') {
      const outcome = await writeReadingExport(
        join(targetDir, `${sessionId}${READING_SUFFIX}`),
        said.body,
      )
      if (!outcome.ok) throw new Error(outcome.reason)
      return {
        kind,
        path: outcome.written.path,
        frames: 0,
        ledgerEntries: 0,
        resumable: false,
        note: READING_NOTE,
      }
    }

    const row = this.deps.store.find(sessionId)
    if (!row) {
      throw new Error(
        'this conversation has no provider id BroCrew can read, so it cannot be written out as a ' +
          (kind === 'native' ? 'provider file' : 'bundle'),
      )
    }

    const path = this.deps.nativeTranscriptPath(row.provider, this.providerHomeFor(row), row.ref)
    if (path === null) {
      throw new Error(
        `${providerName(row.provider)}'s file for this conversation is gone, so there is nothing to export.`,
      )
    }
    const support = nativeExportSupport(row.provider)
    const meta = {
      sessionId,
      provider: row.provider,
      ref: row.ref,
      cwd: row.cwd,
      profileId: row.profileId,
      status: row.status,
      adoptedAt: row.adoptedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
    const frames = linesAsRows(path)

    if (kind === 'bundle') {
      const written = await writeBundleExport(join(targetDir, `${sessionId}.brobot-session.json`), {
        meta,
        format: support.format,
        frames,
        ledger: (from, limit) => this.deps.store.eventsFrom(sessionId, from, limit),
      })
      return {
        kind,
        path: written.path,
        frames: written.frames,
        ledgerEntries: written.ledgerEntries,
        resumable: false,
        note: 'A self-contained copy — the provider frames and our ledger, with no home or database behind it.',
      }
    }

    const written = await writeNativeExport(
      nativeExportPath(row.provider, targetDir, row.ref, row.createdAt, path),
      frames,
    ).catch((error: unknown) => {
      if (error instanceof EmptyNativeTranscript) {
        throw new Error(
          `${providerName(row.provider)}'s file for this conversation is empty, so there is nothing to export.`,
        )
      }
      throw error
    })
    return { kind, path: written.path, frames: written.frames, ledgerEntries: 0, ...support }
  }

  importBundleFile(path: string): ImportedBundle {
    const read = readBundleFile(path)
    if (!read.ok) return { ok: false, reason: read.reason }
    const existing = this.deps.store.findByProviderRef(
      read.bundle.meta.provider,
      read.bundle.meta.ref.sessionId,
    )
    const behind = existing === null ? undefined : this.bundleAheadOf(existing, read.bundle)
    try {
      const { sessionId } = this.importBundle(read.bundle)
      return {
        ok: true,
        sessionId,
        already: existing !== null,
        ...(behind === undefined ? {} : { behind }),
        provider: read.bundle.meta.provider,
        cwd: read.bundle.meta.cwd,
        events: read.bundle.ledger.length,
      }
    } catch (error) {
      return { ok: false, reason: errorMessage(error) }
    }
  }

  private bundleAheadOf(
    sessionId: string,
    bundle: SessionBundle,
  ): { held: number; inFile: number; heldAt: number | null; fileAt: number } | undefined {
    const held = this.deps.store.nextOrdinal(sessionId)
    const inFile = bundle.ledger.reduce((reach, entry) => Math.max(reach, entry.ordinal + 1), 0)
    if (inFile <= held) return undefined
    return {
      held,
      inFile,
      heldAt: this.deps.store.recordedOne(sessionId)?.updatedAt ?? null,
      fileAt: bundle.meta.updatedAt,
    }
  }

  importBundle(bundle: SessionBundle, profileId?: string): { sessionId: string } {
    if (bundle.bundleVersion !== 1 && bundle.bundleVersion !== 2) {
      throw new Error(`unreadable bundle version: ${String(bundle.bundleVersion)}`)
    }
    const existing = this.deps.store.findByProviderRef(
      bundle.meta.provider,
      bundle.meta.ref.sessionId,
    )
    if (existing !== null) return { sessionId: existing }

    const id = this.deps.newSessionId()
    this.deps.store.importSnapshot({
      session: {
        id,
        provider: bundle.meta.provider,
        sessionId: bundle.meta.ref.sessionId,
        cwd: bundle.meta.cwd,
        profileId:
          profileId ??
          (bundle.meta.profileId === undefined ? DEFAULT_PROFILE_ID : bundle.meta.profileId),
        createdAt: bundle.meta.createdAt,
        updatedAt: bundle.meta.updatedAt,
        rotation: bundle.meta.ref.rotation,
      },
      derivedThrough: bundle.raw.frames.length,
      ledger: bundle.ledger.map((entry) => ({
        ordinal: entry.ordinal,
        event: entry.event,
        at: entry.at ?? bundle.meta.updatedAt,
      })),
    })
    this.theWorldMoved('conversations')
    return { sessionId: id }
  }

  async startAndSend(
    sessionId: string,
    text: string,
    sink: RuntimeEventSink,
    attachments: readonly HandedPath[] = [],
    launchKey: string | null = null,
  ): Promise<FirstMessageAnswer> {
    const notSent = (
      refusedBy: FirstMessageRefusal,
      said: string,
      cause?: unknown,
      then: { launch?: LaunchRefusal | null; running?: ResumedSession | null } = {},
    ): FirstMessageAnswer => {
      console.warn(
        `runtime host did not send ${sessionId} a person's message (${refusedBy}): ${said}`,
        ...(cause === undefined ? [] : [cause]),
      )
      return {
        notSent: {
          refusedBy,
          said,
          launch: then.launch ?? null,
          running: then.running ?? null,
        },
      }
    }
    if (this.firstMessagesInFlight.has(sessionId)) {
      return notSent('already-starting', A_FIRST_MESSAGE_IS_STARTING_IT)
    }
    this.firstMessagesInFlight.add(sessionId)
    const at = this.theOneInItsPlace(sessionId)
    try {
      if (!hasSomethingToSend(text, attachments.length)) {
        return notSent('before-the-start', NOTHING_TO_SEND)
      }
      const cwd = this.slots.get(at)?.session?.cwd ?? this.deps.store.recordedOne(at)?.cwd ?? null
      if (cwd !== null) {
        const handed = await recheckHandedPaths(attachments, cwd)
        if ('refusal' in handed) return notSent('before-the-start', handed.refusal)
      }
      return await this.afterWhatArrivedFirst(at, async (): Promise<FirstMessageAnswer> => {
        const inFlight = this.startsInFlight.get(at)
        if (inFlight !== undefined) {
          try {
            await inFlight
          } catch {
            // The ordinary reopen below reports the launch failure.
          }
        }
        const slot = this.slots.get(at)
        if (slot?.session != null && !onItsWayOut(slot) && !mayControl(slot, sink)) {
          const session = slot.session
          try {
            await this.sendAs(at, text, sink, attachments, {
              facts: {},
              ifItLosesTheRace: 'hold-it',
            })
            return { sent: this.recordedHandover(at, sink) }
          } catch (error) {
            const current = this.slots.get(at)
            const stillHere =
              current === slot &&
              current.session === session &&
              !onItsWayOut(current) &&
              session.handle.status() !== 'ended'
            return notSent('after-the-start', aSentence(errorMessage(error)), error, {
              running: stillHere
                ? { ...this.recordedHandover(at, sink), liveness: livenessFor(session) }
                : null,
            })
          }
        }
        const running =
          this.attachHeldSession(at, sink, 'attach') ?? this.attachHeldSession(at, sink, 'claim')
        let resumed: ResumedSession
        if (running !== null) resumed = running
        else {
          try {
            resumed = await this.reopenForAPerson(at, sink, launchKey)
          } catch (error) {
            return notSent('the-start', errorMessage(error), error, {
              launch: whyALaunchWasRefused(error),
            })
          }
        }
        return this.sendTheFirstMessage(
          resumed.sessionId,
          text,
          sink,
          attachments,
          resumed,
          notSent,
        )
      })
    } finally {
      this.firstMessagesInFlight.delete(sessionId)
    }
  }

  private async sendTheFirstMessage(
    sessionId: string,
    text: string,
    sink: RuntimeEventSink,
    attachments: readonly HandedPath[],
    resumed: ResumedSession,
    notSent: (
      refusedBy: FirstMessageRefusal,
      said: string,
      cause?: unknown,
      then?: { launch?: LaunchRefusal | null; running?: ResumedSession | null },
    ) => FirstMessageAnswer,
  ): Promise<FirstMessageAnswer> {
    const started = this.slots.get(sessionId)
    try {
      await this.sendAs(sessionId, text, sink, attachments, {
        facts: {},
        ifItLosesTheRace: 'hold-it',
      })
    } catch (error) {
      if (resumed.handover !== 'attached') {
        await this.undoAStartNoMessageReached(sessionId, started)
      }
      const slot = this.slots.get(sessionId)
      const stillHere =
        slot !== undefined &&
        slot === started &&
        slot.session !== null &&
        !onItsWayOut(slot) &&
        slot.ownerId === sink.ownerId
      const failedWith = this.providerFailedWith.get(sessionId)
      const why =
        failedWith === undefined ? errorMessage(error) : `Your message did not go in: ${failedWith}`
      const running = stillHere ? (slot?.session ?? null) : null
      return notSent('after-the-start', aSentence(why), error, {
        running: running === null ? null : { ...resumed, liveness: livenessFor(running) },
      })
    }
    return { sent: resumed }
  }

  async reopenForAPerson(
    sessionId: string,
    sink: RuntimeEventSink,
    launchKey: string | null,
  ): Promise<ResumedSession> {
    const at = this.theOneInItsPlace(sessionId)
    const inFlight = this.startsInFlight.get(at)
    if (inFlight !== undefined) {
      this.wakingForItsJobs.delete(at)
      const ran = await inFlight
      return (
        this.aPersonsWindowTakesIt(ran, sink) ?? (await this.resumeSession(ran, sink, launchKey))
      )
    }
    const start = this.aPersonsStart(at, sink, launchKey)
    const joined = start.then((resumed) => resumed.sessionId)
    this.startsInFlight.set(at, joined)
    this.stateMayHaveMoved(at)
    const done = (): void => {
      if (this.startsInFlight.get(at) !== joined) return
      this.startsInFlight.delete(at)
      this.stateMayHaveMoved(at)
    }
    void joined.then(done, done)
    return start
  }

  private async aPersonsStart(
    sessionId: string,
    sink: RuntimeEventSink,
    launchKey: string | null,
  ): Promise<ResumedSession> {
    try {
      return await this.resumeSession(sessionId, sink, launchKey)
    } catch (error) {
      if (!itCanNeverBeReopened(error)) throw error
      const row = this.deps.store.recordedOne(sessionId)
      if (row === null || !aRowADeliveryCanStart(row)) throw error
      const took = await this.replaceWhatCanNeverBeReopened(sessionId, sink)
      return (
        this.aPersonsWindowTakesIt(took, sink) ?? (await this.resumeSession(took, sink, launchKey))
      )
    }
  }

  private async undoAStartNoMessageReached(
    sessionId: string,
    started: SessionSlot | undefined,
  ): Promise<void> {
    const slot = this.slots.get(sessionId)
    if (slot === undefined || slot !== started || slot.session === null || onItsWayOut(slot)) return
    const session = slot.session
    if (
      session.handle.status() !== 'idle' ||
      session.mailbox.length > 0 ||
      session.flushing !== null
    )
      return
    try {
      await this.close(sessionId, THE_APP_ITSELF)
    } catch (error) {
      console.warn(
        `runtime host could not stop ${sessionId}, started for a message that was refused: ${errorMessage(
          error,
        )}`,
      )
    }
  }

  async resumeSession(
    sessionId: string,
    sink: RuntimeEventSink | null,
    launchKey: string | null = null,
    because: ReopenedEvent['because'] = undefined,
    page: 'handed-on' | 'not-read' = 'handed-on',
  ): Promise<ResumedSession> {
    let broughtBack: BringingBack | null = null
    const waiting = sink === null ? null : this.beginOwnedWait(sink.ownerId, launchKey)
    try {
      await this.untilTheOwnerStopsIt(this.settleTeardown(sessionId), waiting, sessionId)
      if (waiting !== null) {
        this.refuseIfTheOwnerStoppedIt(waiting, sessionId)
        waiting.handedOver = true
      }
      if (sink !== null) {
        const held =
          this.attachHeldSession(sessionId, sink, 'attach') ??
          this.aPersonsWindowTakesIt(sessionId, sink)
        if (held !== null) return held
      }
      const settingAside = this.settingAside.get(sessionId)
      if (settingAside !== undefined) {
        throw new Error(
          `This conversation${SET_ASIDE_FOR[settingAside]}, so it was not started.` +
            (settingAside === 'archive'
              ? ' Send it again once that is done: whatever is sent to it brings it back.'
              : settingAside === 'its-files'
                ? ' Send it again in a moment.'
                : ''),
        )
      }
      broughtBack = this.bringBackFromTheArchive(sessionId, sink)
      if (!this.judgeItsWakeUpAgain(sessionId) && this.wakingForItsJobs.has(sessionId)) {
        throw new Error(
          'The plan of this conversation’s scheduled jobs asks no start now, so it was not started.',
        )
      }
      const parent = this.deps.store.parentOf(sessionId)
      const slot = this.refusalsTranslated(
        () =>
          this.reserve(
            sessionId,
            {
              ownerId: sink?.ownerId ?? null,
              ownerIsAPerson: sink?.aPersonIsBehindIt ?? false,
              commandedBy: parent === null ? null : agentCallerId(parent),
              spawnedBy: parent,
              anAgentAskedForIt: parent !== null,
              profileId: this.deps.store.find(sessionId)?.profileId ?? null,
            },
            launchKey,
          ),
        true,
      )
      try {
        return await this.reopenSession(slot, sink ?? NO_SURFACE, because, page)
      } catch (error) {
        this.abandon(slot)
        this.launches.finish(slot.launch)
        throw this.refusalTranslated(this.aRefusalAPersonReads(error, sessionId, true))
      } finally {
        slot.settle()
      }
    } finally {
      if (waiting !== null) this.ownedWaits.delete(waiting)
      if (broughtBack !== null) this.putBackWhatAFailedStartBroughtBack(sessionId, broughtBack)
    }
  }

  private beginOwnedWait(ownerId: string, launchKey: string | null = null): OwnedWait {
    let stop: () => void = () => {}
    const stopped = new Promise<void>((resolve) => {
      stop = resolve
    })
    const waiting: OwnedWait = {
      ownerId,
      launchKey,
      released: false,
      cancelled: false,
      handedOver: false,
      stopped,
      stop,
    }
    this.ownedWaits.add(waiting)
    return waiting
  }

  private async untilTheOwnerStopsIt(
    work: Promise<void>,
    waiting: OwnedWait | null,
    sessionId: string,
  ): Promise<void> {
    if (waiting === null) return work
    const stoppedFirst = await Promise.race([
      work.then(() => false),
      waiting.stopped.then(() => true),
    ])
    if (stoppedFirst) this.refuseIfTheOwnerStoppedIt(waiting, sessionId)
  }

  private refuseIfTheOwnerStoppedIt(waiting: OwnedWait, sessionId: string): void {
    if (waiting.cancelled) {
      throw this.refusalTranslated(
        new SessionUnavailable(
          'cancelled',
          `session ${sessionId}'s reopen was cancelled while its last session was being put away`,
        ),
      )
    }
    this.refusalsTranslated(() => this.assertSurfaceIsStillThere(waiting, sessionId))
  }

  private assertSurfaceIsStillThere(
    waiting: { readonly ownerId: string; released: boolean },
    sessionId: string,
  ): void {
    if (!waiting.released) return
    throw new SessionUnavailable(
      'surface-gone',
      `session ${sessionId} was not reopened: ${waiting.ownerId} was released while the reopen ` +
        'was waiting for a teardown, so the document that asked for it no longer exists',
    )
  }

  private refusalTranslated(error: unknown, refused = 'open a session'): unknown {
    const reason = unavailableOf(error)
    if (reason === null) return error
    console.warn(`runtime host refused to ${refused}: ${errorMessage(error)}`)
    return new Error(describeUnavailable(reason, unavailableContextOf(error)), { cause: error })
  }

  private refusalsTranslated<T>(run: () => T, reopening = false): T {
    try {
      return run()
    } catch (error) {
      throw this.refusalTranslated(reopening ? saidOfAReopen(error) : error)
    }
  }

  private async reopenSession(
    slot: SessionSlot,
    sink: RuntimeEventSink,
    because?: ReopenedEvent['because'],
    page: 'handed-on' | 'not-read' = 'handed-on',
  ): Promise<ResumedSession> {
    const sessionId = slot.id
    const row = this.deps.store.find(sessionId)
    if (!row) {
      const recorded = this.deps.store.recordedOne(sessionId)
      if (recorded === null) {
        throw new SessionUnavailable('not-recorded', `no resumable session: ${sessionId}`)
      }
      throw new SessionUnavailable(
        recorded.neverStarted && aRowADeliveryCanStart(recorded)
          ? 'never-started'
          : 'cannot-be-reopened',
        `session ${sessionId} has no ref resume can use: ${recorded.unresumableReason ?? 'no reason recorded'}`,
        { refusal: recorded.unresumableReason ?? undefined },
      )
    }

    if (row.homeRefusal) {
      throw new SessionUnavailable(
        row.restoredFromBundle ? 'restored-elsewhere' : 'read-only',
        `session ${sessionId} is ${row.homeRefusal} — it can be read and exported, but not reopened`,
      )
    }
    if (row.resumeRefusal) {
      throw new SessionUnavailable(
        'no-input-end',
        `session ${sessionId} is ${row.resumeRefusal} — it can be read and exported, not reopened`,
      )
    }
    const profileId = row.profileId ?? DEFAULT_PROFILE_ID
    const connectionId = this.deps.connectionFor?.(
      row.provider,
      this.deps.store.connectionOf(sessionId),
    )
    const connectionRevision = this.deps.connectionRevision?.(row.provider)
    const { home: providerHome, loginRenewed } = await this.prepareAHome(
      row.provider,
      profileId,
      sessionId,
    )
    this.assertConnectionUnchanged(row.provider, connectionRevision)
    const approvalMode = row.approvalMode ?? 'ask'
    this.deps.store.closeOpenTurn(sessionId, 'unknown', this.now())
    const startingOrdinal = this.deps.store.nextOrdinal(sessionId)
    const history =
      page === 'not-read' ? noPageBefore(startingOrdinal) : this.historyWindow(sessionId, {})

    const recordedEffort = resolveReasoningEffort(row)
    const recordedModel = row.model ?? undefined
    const rawRuntime =
      connectionId === undefined
        ? this.deps.createRuntime(row.provider)
        : this.deps.createRuntime(row.provider, connectionId)
    const runtime = this.runtimeWithPlugins(rawRuntime, row.provider, row.profileId)
    const selected = await this.theSelectedModel(row.provider, row.profileId, profileId, {
      ...(recordedModel === undefined ? {} : { model: recordedModel }),
      ...(recordedEffort === undefined ? {} : { effort: recordedEffort }),
    })
    const model = selected.model
    const reasoningEffort = selected.effort ?? undefined
    const planMode = row.planMode ?? undefined
    const planModeEnded = planMode === true
    const leftAtTheReopen = planMode === true && row.planEndedAt === null
    const pack = this.deps.readTextPack?.()
    const builtInSkills = await this.theSkillsForALaunch(
      slot,
      row.provider,
      providerHome,
      row.profileId,
      pack,
    )
    const instructions = this.deps.readInstructions?.(
      row.provider,
      row.cwd,
      providerHome,
      this.instructionContext(row.profileId, row.cwd, slot.spawnedBy, sessionId),
      pack,
    )
    const agentTools = this.agentToolsForSession(sessionId)
    let leadsRead: Promise<readonly ThreadLeadRow[] | null> = Promise.resolve(null)
    const leadsDone = new AbortController()
    if (this.whyNotOurs(slot) !== null)
      throw new SessionUnavailable('lost-its-place', `session ${sessionId} lost its place`)
    const handle = await this.awaitLaunch(
      slot,
      { provider: row.provider, kind: 'resume' },
      async (startPhases) => {
        if (slot.launch.signal.aborted || this.whyNotOurs(slot) !== null)
          throw new SessionUnavailable('lost-its-place', `session ${sessionId} lost its place`)
        if (
          providerDescriptor(row.provider).contextPlacement === 'first-message' &&
          instructions?.firstTurnLead !== undefined
        ) {
          leadsRead = this.readThreadLeads(
            sessionId,
            Number.MAX_SAFE_INTEGER,
            AbortSignal.any([slot.launch.signal, leadsDone.signal]),
          ).catch(() => null)
        }
        if (builtInSkills && !builtInSkills.isCurrent()) throw new Error(BUILT_IN_SKILLS_FAILURE)
        this.assertConnectionUnchanged(row.provider, connectionRevision)
        return runtime.resume(row.ref, {
          startPhases,
          providerHome,
          ...(builtInSkills
            ? {
                builtInSkills: builtInSkills.context,
                ...(builtInSkills.sharedRoot
                  ? {
                      sharedSkillsRoot: builtInSkills.sharedRoot,
                      sharedSkillsGeneration: this.deps.sharedSkillsGeneration,
                      beforeSkillDiscovery: this.deps.beforeSkillDiscovery,
                    }
                  : {}),
              }
            : {}),
          approvalMode,
          signal: slot.launch.signal,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          model,
          ...(planMode ? { planMode } : {}),
          ...(planModeEnded ? { planModeEnded } : {}),
          ...(instructions?.systemHint ? { systemHint: instructions.systemHint } : {}),
          agentTools,
          ...externalMcpContext(this.deps.store, row.provider, row.profileId),
          ...workFoldersIn(this.theWorkFoldersALaunchCarries(sessionId)),
        })
      },
    ).catch((error: unknown) => {
      leadsDone.abort()
      throw this.aFolderThatIsGoneAsARefusal(error, row.ref.cwd, sessionId)
    })
    const reopenedThreadLeads = await this.withinTheLeadsGrace(leadsRead)
    leadsDone.abort()

    const refused = this.whyNotOurs(slot)
    if (refused !== null) {
      await this.handBack(slot, handle)
      throw new SessionUnavailable('lost-its-place', `session ${sessionId} ${refused}`)
    }

    if (builtInSkills && !builtInSkills.isCurrent()) {
      await this.handBack(slot, handle)
      throw new Error(BUILT_IN_SKILLS_FAILURE)
    }
    const launchGave = this.whatALaunchGave(
      row.provider,
      sessionId,
      agentTools,
      handle.instructionSources ?? [],
      instructions,
      () => this.instructionContext(row.profileId, row.cwd, slot.spawnedBy, sessionId),
      handle.launchSettings,
      builtInSkills,
    )
    const session = this.register(slot, {
      id: sessionId,
      provider: row.provider,
      cwd: row.cwd,
      providerHome,
      profileId,
      launchGave,
      createdApprovalMode: approvalMode,
      handle,
      sink,
      startingOrdinal,
      continuesARecording: true,
      instructions: instructions?.instructions,
      ...(builtInSkills ? { builtInSkills } : {}),
      ...(instructions?.firstTurnLead === undefined
        ? {}
        : {
            firstTurnLead: instructions.firstTurnLead,
            ...this.theLeadAReopenOwes(
              sessionId,
              row.provider,
              launchGave,
              reopenedThreadLeads,
              instructions.savedMethodsLines,
            ),
          }),
      ...(instructions?.savedMethodsLines === undefined
        ? {}
        : { savedMethodsLines: instructions.savedMethodsLines }),
    })
    this.record(session, () => this.deps.store.reopened(sessionId, this.now()))
    if (leftAtTheReopen)
      this.record(session, () => this.deps.store.endPlanMode(sessionId, this.now()))
    const answeredWhatWaited = this.reopeningForWhatWaited.delete(sessionId)
    const why = because ?? (answeredWhatWaited ? 'the-sign-in-moved-on' : undefined)
    const back = this.bringingBack.get(sessionId)
    this.bringingBack.delete(sessionId)
    if (back !== undefined) this.carryOnAfterTheStop(back.others, NEWER_WORDS_AFTER_THE_ARCHIVE)
    const broughtBack = back?.saying
    const onAReplacedCopy = this.reopenedOnAReplacedCopy.delete(sessionId)
    this.publishOurs(session, {
      type: 'reopened',
      ...(why === undefined ? {} : { because: why }),
      ...(onAReplacedCopy && why === 'the-sign-in-was-renewed' ? { itsCopyWasReplaced: true } : {}),
      ...(broughtBack === undefined ? {} : { broughtBack }),
    })
    if (why === 'the-sign-in-moved-on') {
      session.reopenedForWhatWaited = { at: this.now(), stopped: false }
    }
    this.publishOurs(session, {
      type: 'launched',
      ...this.renewalNotice(session.provider, loginRenewed),
    })
    this.putBackWhatWaitedForThisStart(session)
    if (model !== recordedModel) {
      this.record(session, () => this.deps.store.setModel(sessionId, model))
    }
    if ((reasoningEffort ?? null) !== (recordedEffort ?? null)) {
      this.record(session, () =>
        this.deps.store.setReasoningEffort(sessionId, reasoningEffort ?? null),
      )
    }

    return this.discloseReopened(session, row, {
      history,
      handover: 'resumed',
      liveFrom: null,
      asHandedOver: null,
      queued: [],
      hasACommander: slot.commandedBy !== null,
      startedWithoutAWindow: slot.bornWithoutASurface,
      mayHandItBack: mayHandBack(slot, sink),
    })
  }

  private discloseReopened(
    session: HostedSession,
    row: LiveSessionRow,
    options: {
      history: HistoryWindow
      queued: readonly QueuedMessageDisclosure[]
      handover: SessionHandover
      liveFrom: number | null
      asHandedOver: Pick<ConversationAtWork, 'status' | 'told'> | null
      hasACommander: boolean
      startedWithoutAWindow: boolean
      mayHandItBack: boolean
    },
  ): ResumedSession {
    return {
      sessionId: session.id,
      provider: session.provider,
      cwd: session.cwd,
      providerHome: session.providerHome,
      profileId: row.profileId ?? DEFAULT_PROFILE_ID,
      ref: session.handle.ref ?? row.ref,
      config: this.deps.readProviderConfig(session.provider, session.providerHome),
      instructions: instructionsFor(session),
      ...approvalDisclosure(session),
      planNeedsGoAhead: session.handle.planNeedsGoAhead,
      settings: settingsDisclosure(session),
      queued: this.providerLimitDisclosures(session, options.queued).queued,
      ...(row.approvalMode === null
        ? {
            approvalNote: `${describeApprovalMode(session.provider, session.createdApprovalMode)} — chosen now; how this session originally ran was never recorded`,
          }
        : {}),
      liveness: livenessFor(session),
      ...this.providerBlockDisclosure(session.id, session.provider),
      history: options.history,
      handover: options.handover,
      ...(options.liveFrom === null ? {} : { liveFrom: options.liveFrom }),
      ...(options.asHandedOver === null ? {} : { asHandedOver: options.asHandedOver }),
      hasACommander: options.hasACommander,
      startedWithoutAWindow: options.startedWithoutAWindow,
      mayHandItBack: options.mayHandItBack,
    }
  }

  private attachHeldSession(
    sessionId: string,
    sink: RuntimeEventSink,
    how: 'attach' | 'claim',
  ): ResumedSession | null {
    const slot = this.slots.get(sessionId)
    if (slot === undefined) return null
    const session = slot.session
    if (session === null) return null
    if (onItsWayOut(slot)) {
      return null
    }
    if (!(how === 'claim' ? mayClaim(slot) : mayControl(slot, sink))) return null
    const row = this.deps.store.findLive(sessionId)
    if (!row) return null

    const history = this.historyWindow(sessionId, {})
    const { status, told } = session.beingDone.current
    if (how === 'claim') {
      slot.ownerId = sink.ownerId
      slot.ownerIsAPerson = sink.aPersonIsBehindIt
      this.theWorldMoved('conversations')
    }
    session.sink = sink
    session.lastDisclosures = ''
    return this.discloseReopened(session, row, {
      history,
      handover: 'attached',
      liveFrom: session.liveFrom,
      asHandedOver: { status, told },
      queued: this.providerLimitDisclosures(session).queued,
      hasACommander: slot.commandedBy !== null,
      startedWithoutAWindow: slot.bornWithoutASurface,
      mayHandItBack: mayHandBack(slot, sink),
    })
  }

  attachOpenSessions(sink: RuntimeEventSink): ResumedSession[] {
    const attached: ResumedSession[] = []
    for (const slot of this.slots.values()) {
      if (!mayControl(slot, sink)) continue
      const session = this.attachHeldSession(slot.id, sink, 'attach')
      if (session !== null) attached.push(session)
    }
    return attached
  }

  async look(sessionId: string, sink: RuntimeEventSink, claim: boolean): Promise<ResumedSession> {
    this.deps.store.checkCommitted()
    const thisLook = this.startLooking(sessionId, sink)
    const slot = this.slots.get(sessionId)
    if (slot !== undefined && slot.session !== null && !onItsWayOut(slot)) {
      const session = slot.session
      const status = session.handle.status()
      if (status === 'ended' || status === 'errored') {
        await settledWithin(session.pump, this.closeDrainTimeoutMs)
        await settledWithin(this.settleTeardown(sessionId), this.closeDrainTimeoutMs * 2)
      } else {
        const handed = mayControl(slot, sink)
          ? this.attachHeldSession(sessionId, sink, 'attach')
          : claim
            ? this.attachHeldSession(sessionId, sink, 'claim')
            : null
        if (handed !== null) {
          this.stopThisLook(sessionId, thisLook)
          return handed
        }
      }
    }
    try {
      return this.recordedHandover(sessionId, sink)
    } catch (error) {
      this.stopThisLook(sessionId, thisLook)
      throw error
    }
  }

  private startLooking(sessionId: string, sink: RuntimeEventSink): OneLook {
    const look: OneLook = { sink }
    const looking = this.lookingAtItsRecord.get(sessionId) ?? new Map<string, OneLook>()
    looking.set(sink.ownerId, look)
    this.lookingAtItsRecord.set(sessionId, looking)
    return look
  }

  private stopThisLook(sessionId: string, look: OneLook): void {
    const looking = this.lookingAtItsRecord.get(sessionId)
    if (looking?.get(look.sink.ownerId) !== look) return
    looking.delete(look.sink.ownerId)
    if (looking.size === 0) this.lookingAtItsRecord.delete(sessionId)
  }

  stopLooking(sessionId: string, ownerId: string): void {
    const looking = this.lookingAtItsRecord.get(sessionId)
    if (looking === undefined) return
    looking.delete(ownerId)
    if (looking.size === 0) this.lookingAtItsRecord.delete(sessionId)
  }

  private recordedHandover(sessionId: string, sink: RuntimeEventSink): ResumedSession {
    const row = this.deps.store.recordedOne(sessionId)
    if (row === null) {
      throw this.refusalTranslated(
        new SessionUnavailable(
          'not-recorded',
          `session ${sessionId} was not opened: no record of it`,
        ),
        'open a conversation',
      )
    }
    const launch = this.deps.store.findLive(sessionId)
    const slot = this.slots.get(sessionId)
    const running = slot !== undefined && slot.session !== null && !onItsWayOut(slot)
    const heldElsewhere = running && slot.ownerId !== null && !mayControl(slot, sink)
    const parent = this.deps.store.parentOf(sessionId)
    const providerHome = this.providerHomeFor(row)
    const recordedMode = launch?.approvalMode ?? null
    const approvalMode = recordedMode ?? 'ask'
    const described = describeApprovalMode(row.provider, approvalMode)
    const instructions = this.composesInItsOwnHome(providerHome)
      ? this.deps.readInstructions?.(
          row.provider,
          row.cwd,
          providerHome,
          this.instructionContext(row.profileId, row.cwd, parent, sessionId),
        )
      : undefined
    const ranAsNobody = row.restoredFromBundle ? 'bundle' : row.foundInUserHome ? 'user-home' : null
    this.prepareInitialProviderLimitFacts()
    return {
      sessionId,
      provider: row.provider,
      ...this.providerBlockDisclosure(sessionId, row.provider),
      cwd: row.cwd,
      providerHome,
      profileId: row.profileId ?? DEFAULT_PROFILE_ID,
      ...(ranAsNobody === null ? {} : { ranAsNobody }),
      ref: launch?.ref ?? null,
      config: this.deps.readProviderConfig(row.provider, providerHome),
      instructions: instructions?.instructions ?? NO_INSTRUCTIONS,
      approvalMode,
      pendingApprovalMode: null,
      approvalNote:
        recordedMode === null
          ? `${described} — never recorded for this conversation; its next start takes this`
          : described,
      blanketGrants: [],
      planNeedsGoAhead: false,
      settings: {
        model: launch?.model ?? null,
        pendingModel: null,
        reasoningEffort: resolveReasoningEffort(launch ?? undefined) ?? null,
        pendingReasoningEffort: null,
        planMode: false,
        pendingPlanMode: null,
      },
      queued: [],
      liveness: { state: 'ended', since: row.updatedAt },
      history: this.historyWindow(sessionId, {}),
      handover: 'recorded',
      ...(running ? {} : { liveFrom: this.deps.store.nextOrdinal(sessionId) }),
      hasACommander: parent !== null,
      startedWithoutAWindow: parent !== null,
      mayHandItBack: false,
      cannotTakeAMessage:
        heldElsewhere && !sink.aPersonIsBehindIt
          ? HELD_ELSEWHERE
          : aMessageContinuesIt(row, this.theServiceOf(sessionId) !== null)
            ? null
            : describeUnavailable('cannot-be-reopened', {
                refusal: row.unresumableReason ?? undefined,
              }),
      settingsFixed:
        slot !== undefined ||
        whyNoSettingForItsNextStart(row, this.replacedBy, this.theServiceOf(sessionId) !== null) !==
          null,
    }
  }

  claimSession(sessionId: string, sink: RuntimeEventSink): ResumedSession {
    const claimed = this.attachHeldSession(sessionId, sink, 'claim')
    if (claimed !== null) return claimed
    throw this.refusalTranslated(this.whyNotClaimed(sessionId, sink), 'take over a conversation')
  }

  private whyNotClaimed(sessionId: string, sink: RuntimeEventSink): SessionUnavailable {
    const slot = this.slots.get(sessionId)
    if (slot === undefined) {
      return new SessionUnavailable(
        'not-running',
        `session ${sessionId} was not taken over: this host is not running it`,
      )
    }
    if (onItsWayOut(slot)) {
      return new SessionUnavailable(
        'still-closing',
        `session ${sessionId} was not taken over: it is on its way out`,
      )
    }
    const session = slot.session
    if (session === null) {
      const openingForMs = this.now() - slot.since
      return new SessionUnavailable(
        'still-opening',
        `session ${sessionId} was not taken over: reserved ${openingForMs}ms ago and its ` +
          'provider has not arrived',
        { openingForMs },
      )
    }
    if (slot.ownerId !== null) {
      return new SessionUnavailable(
        slot.ownerId === sink.ownerId ? 'already-open' : 'already-open-elsewhere',
        `session ${sessionId} was not taken over: it is held for ${ownerName(slot.ownerId)}, and ` +
          `${sink.ownerId} asked to take it over`,
      )
    }
    return new SessionUnavailable(
      'not-recorded',
      `session ${sessionId} was not taken over: it is running and has no recorded row`,
    )
  }

  releaseSession(sessionId: string, by: CallerIdentity): ReleasedSession {
    const slot = this.slots.get(sessionId)
    const session = slot?.session ?? null
    if (slot === undefined || session === null) {
      throw this.refusalTranslated(
        new SessionUnavailable(
          'not-running',
          `session ${sessionId} was not handed back: this host is not running it`,
        ),
        'hand a conversation back',
      )
    }
    if (onItsWayOut(slot)) {
      throw this.refusalTranslated(
        new SessionUnavailable(
          'still-closing',
          `session ${sessionId} was not handed back: it is on its way out`,
        ),
        'hand a conversation back',
      )
    }
    if (!mayControl(slot, by))
      throw this.refusalTranslated(
        new SessionUnavailable(
          slot.ownerId === null ? 'held-by-nobody' : 'not-yours',
          `session ${slot.id} is held for ${ownerName(slot.ownerId)}, and ${callerName(by)} asked to hand it back`,
        ),
        'act on a session',
      )
    if (!mayHandBack(slot, by)) {
      throw this.refusalTranslated(
        new SessionUnavailable(
          'started-here',
          `session ${sessionId} was not handed back: ${by.ownerId} started it, so there is no ` +
            'prior owner to return it to',
        ),
        'hand a conversation back',
      )
    }
    this.release(slot)
    return {
      sessionId,
      running: this.runningStateOf(sessionId),
      waitingForAHuman: session.handle.status() === 'waiting_permission',
    }
  }

  unclaimedSessions(): UnclaimedSession[] {
    const unclaimed: UnclaimedSession[] = []
    for (const slot of this.slots.values()) {
      if (slot.ownerId !== null) continue
      const session = slot.session
      if (session === null) {
        unclaimed.push({
          sessionId: slot.id,
          since: slot.since,
          commandedBy: slot.commandedBy,
          running: false,
        })
        continue
      }
      unclaimed.push({
        sessionId: slot.id,
        since: slot.since,
        commandedBy: slot.commandedBy,
        running: true,
        provider: session.provider,
        cwd: session.cwd,
        waitingForAHuman: session.handle.status() === 'waiting_permission',
      })
    }
    return unclaimed
  }

  private release(slot: SessionSlot): void {
    slot.ownerId = null
    slot.ownerIsAPerson = false
    this.theWorldMoved('conversations')
    const session = slot.session
    if (session === null) return
    session.sink = NO_SURFACE
    session.lastDisclosures = ''
  }

  private register(
    slot: SessionSlot,
    options: {
      id: string
      provider: Provider
      cwd: string
      providerHome: string
      profileId: string
      createdApprovalMode: 'ask' | 'auto'
      handle: SessionHandle
      sink: RuntimeEventSink
      startingOrdinal: number
      continuesARecording: boolean
      instructions?: SessionInstructions
      builtInSkills?: PreparedBuiltInSkills
      firstTurnLead?: string
      leadOwed?: { readonly text: string; readonly is: LeadInFront['is'] } | null
      savedMethodsLines?: SavedMethodsLines
      launchGave?: WhatALaunchGave | null
      onRegistered?: (session: HostedSession) => void
    },
  ): HostedSession {
    const { id, provider, handle, sink } = options
    const noteDir = memoryNoteDir(provider, options.providerHome)
    const alreadyTold = this.deps.store.workReportedTo(id)
    this.providerFailedWith.delete(id)
    const wakeUp = this.wakeUps.get(id)
    const woken = wakeUp?.level ?? null
    const session: HostedSession = {
      currentProviderLimits: () => this.providerLimitDisclosures(session),
      id,
      provider,
      cwd: options.cwd,
      providerHome: options.providerHome,
      profileId: options.profileId,
      instructions: options.instructions ?? NO_INSTRUCTIONS,
      ...(options.builtInSkills ? { builtInSkills: options.builtInSkills } : {}),
      createdApprovalMode: options.createdApprovalMode,
      lastAgentInfo: '',
      lastReported: '',
      reportedBefore: this.whatWasReported(id).reported ?? null,
      lastDisclosures: '',
      planAsRecorded: handle.settings.planMode.effective,
      handle,
      launch: slot.launch,
      sink,
      ordinal: options.startingOrdinal,
      liveFrom: options.continuesARecording ? options.startingOrdinal : null,
      lifeSince: slot.since,
      pump: Promise.resolve(),
      closing: null,
      stopping: null,
      terminated: null,
      finalizing: null,
      recordingFailure: null,
      recordingFailureReported: false,
      staleEventReported: false,
      commands: null,
      askingForCommands: null,
      firstTurnLead:
        options.leadOwed === undefined
          ? (options.firstTurnLead ?? null)
          : (options.leadOwed?.text ?? null),
      firstTurnLeadIs: options.leadOwed?.is ?? 'whole',
      leadJustHandedOver: null,
      lifeLead: options.firstTurnLead ?? null,
      savedMethodsLines: options.savedMethodsLines ?? null,
      launchGave: options.launchGave ?? null,
      wordsJustHandedOver: null,
      wordsItWasHandedFor: [],
      latestContext: null,
      memoryNoteDir: noteDir,
      memoryNotes: noteNamesIn(noteDir) ?? new Set<string>(),
      turnOpened: false,
      itsTurnDrives: null,
      itsTurnIs: { aPersons: false, names: [] },
      personalHandover: 0,
      personalWorkTurn: null,
      aPersonsWordsOpenedIt: false,
      turnsEnded: 0,
      moveRequestTurn: null,
      moveRequestRowPending: false,
      moveRequestHandoff: null,
      aPersonLastWroteAt: options.continuesARecording ? this.whenAPersonLastWroteIn(id) : null,
      itsQuestionsAsLastSaid: null,
      whoWaitedAsLastSaid: null,
      pluginsAsLastSaid: (() => {
        if (
          options.continuesARecording &&
          providerDescriptor(provider).contextPlacement === 'first-message'
        )
          return null
        const composed = options.instructions?.thisConversation
        const span = composed?.spans.find((span) => span.heading === PLUGINS_HEADING)
        return composed && span ? composed.text.slice(span.start, span.end).trimEnd() : null
      })(),
      turnBlockSnapshot: EMPTY_TURN_BLOCK,
      pendingTurnBlock: null,
      finishedSinceItsLastTurn: [],
      lastStopEnded: [],
      stopEndedUntold: [],
      stopEndedSaid: 0,
      askedSinceItsLastTurnEnded: new Set<string>(),
      questionsAStopEndedUntold: options.continuesARecording
        ? this.theQuestionsTheStopOfItsLastTurnEnded(id)
        : [],
      questionsAStopEndedSaid: 0,
      whenATurnEnds: [],
      itsWorkWasReadBeforeItsWords: false,
      sentOrdinal: null,
      mailbox: [],
      toldAboutStall: new Set(alreadyTold),
      telling: Promise.resolve(),
      flushing: null,
      holdingQueue: 0,
      cancelsThatStopNothing: new Set(),
      stopStillAsked: null,
      handingOver: [],
      liveness: new LivenessTracker(() => {
        if (session.sink.alive) {
          session.sink.sendLiveness({ sessionId: id, liveness: livenessFor(session) })
        }
      }, this.deps.liveness),
      beingDone: new BeingDoneTracker(this.now()),
      background: NOTHING_IN_THE_BACKGROUND,
      scheduled: woken ?? NOTHING_SCHEDULED,
      levelWritten: null,
      providerSpokeOfItsJobs: false,
      toolCallsNamed: new Map(),
    }
    if (this.slots.get(id) !== slot) {
      throw new SessionUnavailable(
        'lost-its-place',
        `session ${id} lost its reservation while its provider was starting`,
      )
    }
    this.rememberLedgerOrdinal(session, session.ordinal - 1)
    slot.session = session
    slot.phase = 'live'
    if (this.deps.turnsTheAppCut !== undefined) void this.identityOf(session)
    const life = {}
    this.providerLimitLives.set(id, { provider, life })
    this.moveTheListing()
    this.providerLimitFacts.begin(
      id,
      life,
      provider,
      !options.continuesARecording,
      this.limitAccountOf(id, session.lifeSince),
    )
    this.recordLimitAccount(session)
    this.forgetItsWakeUp(id)
    this.itsStartWasMade(id, wakeUp)
    if (wakeUp !== undefined && wakeUp.holdFor !== null) {
      this.letGoOfJobsItNeverRestored(session, wakeUp.holdFor)
    }
    this.stateMayHaveMoved(id)
    options.onRegistered?.(session)
    this.theWorldMoved('conversations')
    this.theWorldMoved('agents')
    this.takeWhatItHolds(id)
    session.pump = this.pumpEvents(session)
    this.tellAboutWorkItGaveOut(session)
    return session
  }

  private record(session: HostedSession, write: () => void): void {
    if (session.recordingFailure !== null) return
    try {
      write()
    } catch (error) {
      session.recordingFailure = errorMessage(error)
      console.error(`runtime session ${session.id} is no longer being recorded:`, error)
    }
  }

  private readonly observedLedgerWrites = new WeakMap<HostedSession, object>()

  private takeLedgerOrdinal(session: HostedSession): number {
    let ordinal = session.ordinal
    const stamp = this.deps.store.lastOrdinalWrite(session.id)
    if (this.observedLedgerWrites.get(session) !== stamp) {
      this.record(session, () => {
        ordinal = Math.max(ordinal, this.deps.store.nextOrdinal(session.id))
      })
      if (stamp !== undefined) this.observedLedgerWrites.set(session, stamp)
    }
    session.ordinal = ordinal + 1
    return ordinal
  }

  private rememberLedgerOrdinal(session: HostedSession, ordinal: number): void {
    const stamp = this.deps.store.lastOrdinalWrite(session.id)
    if (session.recordingFailure === null && stamp?.ordinal === ordinal)
      this.observedLedgerWrites.set(session, stamp)
  }

  private reportRecordingFailure(session: HostedSession): void {
    if (session.recordingFailure === null || session.recordingFailureReported) return
    session.recordingFailureReported = true
    this.emit(session, {
      sessionId: session.id,
      ordinal: session.ordinal++,
      at: this.now(),
      event: {
        type: 'error',
        message: `this session is no longer being recorded, so it will not be resumable: ${session.recordingFailure}`,
        fatal: false,
      },
    })
  }

  async closeSessionsForOwner(ownerId: string): Promise<void> {
    for (const waiting of this.ownedWaits) {
      if (waiting.ownerId !== ownerId) continue
      waiting.released = true
      waiting.stop()
    }
    for (const sessionId of [...this.lookingAtItsRecord.keys()]) {
      this.stopLooking(sessionId, ownerId)
    }
    const owned: SessionSlot[] = []
    for (const slot of this.slots.values()) {
      if (slot.ownerId !== ownerId) continue
      if (slot.session === null) {
        owned.push(slot)
        continue
      }
      if (slot.bornWithoutASurface) this.release(slot)
      else owned.push(slot)
    }
    await Promise.all(owned.map((slot) => this.close(slot.id, THE_APP_ITSELF)))
  }

  get closing(): boolean {
    return this.launches.closed
  }

  recordOpenForQuit(): void {
    if (this.quitRecorded) return
    this.quitRecorded = true
    const closing = this.whatTheQuitCloses()
    this.keepTheTurnsTheQuitCuts(closing)
    this.recordWhatTheQuitClosed(closing)
    this.keepTheUsage()
    this.launches.closeAdmission()
  }

  private quitRecorded = false

  async closeAll(): Promise<void> {
    this.recordOpenForQuit()
    this.stopHearingCommits()
    const memoryClosed = this.deps.memoryKnowledge?.close() ?? Promise.resolve()
    this.deps.store.closePastWorkSearch?.()
    this.deps.closeSharedSkills?.()
    this.windowIncidentReads.invalidate()
    this.windowRoutesKept = undefined
    this.windowIncidentsKept = undefined
    this.workReconciler?.close()
    clearInterval(this.reconciliationTimer)
    this.launches.closeAdmission()
    const limitsClosed = this.deps.limitsReader?.close() ?? Promise.resolve()
    const workSearchClosed = this.deps.workSearchReader?.close() ?? Promise.resolve()
    const pastWorkSearchClosed = this.deps.pastWorkSearchReader?.close() ?? Promise.resolve()
    const windowReadsClosed = this.deps.windowReader?.close() ?? Promise.resolve()
    const filesLibrariesClosed = this.deps.filesLibraries?.close() ?? Promise.resolve()
    const teamProfileGraphsClosed = this.deps.teamProfileGraphs?.close() ?? Promise.resolve()
    if (this.providerLimitExpiry !== null) clearTimeout(this.providerLimitExpiry)
    this.providerLimitExpiry = null
    this.providerLimitFacts.invalidate()
    this.signInReopens.close()
    const signIns = [...this.signIns.values()]
    this.signIns.clear()
    await Promise.all(signIns.map(({ signIn }) => this.boundedCancel(signIn)))
    for (const conversation of [...this.wakeUps.keys()]) this.forgetItsWakeUp(conversation)
    for (const { timer } of this.theResets.values()) clearTimeout(timer)
    this.theResets.clear()
    const terminated = settledWithin(this.launches.pending(), this.closeDrainTimeoutMs * 2)
    let confirmed: boolean
    try {
      ;[, confirmed] = await Promise.all([
        Promise.all([...this.slots.keys()].map((id) => this.close(id, THE_APP_ITSELF))),
        terminated,
        limitsClosed,
        workSearchClosed,
        pastWorkSearchClosed,
        windowReadsClosed,
        filesLibrariesClosed,
        teamProfileGraphsClosed,
        memoryClosed,
      ])
    } finally {
      await Promise.allSettled([memoryClosed, teamProfileGraphsClosed])
    }
    const outstanding = this.launches.size
    if (!confirmed && outstanding > 0) {
      console.warn(
        `runtime host: ${outstanding} provider launch(es) had not confirmed termination within ` +
          `${this.closeDrainTimeoutMs * 2}ms — a provider process may still be running`,
      )
    }
  }

  private whatTheQuitCloses(): readonly HostedSession[] {
    return [...this.slots.values()].flatMap((slot) => {
      const session = slot.session
      if (session === null) return []
      if (onItsWayOut(slot)) return []
      const status = session.handle.status()
      if (status === 'errored') return []
      if (status === 'ended') return []
      return [session]
    })
  }

  private recordWhatTheQuitClosed(closing: readonly HostedSession[]): void {
    const closed = closing.map((session) => session.id)
    if (closed.length === 0) return
    try {
      this.deps.store.closedByTheQuit(closed, this.now())
    } catch (error) {
      console.warn(
        `runtime host could not record the ${closed.length} conversation(s) this quit closed — ` +
          `they will come back closed rather than open: ${errorMessage(error)}`,
      )
    }
  }

  private startable(sessionId: string): Startable | null {
    if (this.replacedBy.has(sessionId)) return null
    return this.aStoppedConversation(sessionId)
  }

  private aStoppedConversation(sessionId: string): Startable | null {
    if (this.slots.has(sessionId)) return null
    const row = this.deps.store.recordedOne(sessionId)
    if (row === null || !aRowADeliveryCanStart(row)) return null
    const parent = this.deps.store.parentOf(sessionId)
    return {
      id: sessionId,
      ownerId: null,
      commandedBy: parent === null ? null : agentCallerId(parent),
      parent,
      profileId: row.profileId,
      provider: row.provider,
    }
  }

  private everythingStartable(): { readonly startable: Startable; readonly at: number }[] {
    return this.deps.store.recorded().flatMap((row) => {
      const startable = this.startable(row.sessionId)
      return startable === null ? [] : [{ startable, at: row.updatedAt }]
    })
  }

  private require(sessionId: string, by: Caller): HostedSession {
    return this.sessionFor(sessionId, (slot) => this.assertMayControl(slot, by))
  }

  private requireToCommand(sessionId: string, by: Caller): HostedSession {
    return this.sessionFor(sessionId, (slot) => this.assertMayCommand(slot, by))
  }

  private requireToMessage(
    sessionId: string,
    by: Caller,
    walls: (receiver: SessionSlot) => void = () => {},
  ): HostedSession {
    return this.sessionFor(sessionId, (slot) => {
      this.assertMayMessage(slot, by)
      walls(slot)
    })
  }

  private assertMayReach(
    act: Exclude<MessagingAct, 'assign'>,
    sessionId: string,
    by: Caller,
  ): void {
    const speaking = sessionSpeakingAs(by)
    if (speaking === null) return
    const refusal = this.mayReachAtAll(act, by)
    if (refusal === null) return
    console.warn(
      `runtime host refused to ${act} ${sessionId}: ${speaking} is refused by ${refusal.rail}`,
    )
    throw new MessagingRefused({ ...refusal, detail: { ...refusal.detail, agent: sessionId } })
  }

  readTranscript(
    target: string,
    reader: string,
    read: { readonly back: number; readonly search: string | null },
  ):
    | { readonly ok: false; readonly refusal: 'not-a-conversation-below-you' }
    | {
        readonly ok: true
        readonly name: string
        readonly lastExchange: Exchange
        readonly turns: readonly TranscriptTurn[]
        readonly older: boolean
      } {
    if (!this.mayReadTheTranscriptOf(target, reader)) {
      return { ok: false, refusal: 'not-a-conversation-below-you' }
    }
    return {
      ok: true,
      name: this.whatToCallTheConversation(target),
      lastExchange: this.deps.store.lastExchange(target),
      ...this.deps.store.transcript(target, read),
    }
  }

  mayReadTheTranscriptOf(target: string, reader: string): boolean {
    return (
      target !== reader &&
      (this.ancestorsAsItWillRun(target).includes(reader) || this.ofOneIdentity(target, reader))
    )
  }

  private ofOneIdentity(one: string, other: string): boolean {
    const profile = this.profileOf(one)
    return profile !== null && profile === this.profileOf(other)
  }

  private ancestorsAsItWillRun(sessionId: string): readonly string[] {
    const recorded = this.deps.store.ancestorsOf(sessionId)
    if (recorded.length > 0) return recorded
    const slot = this.slots.get(sessionId)
    if (slot === undefined || slot.session !== null) return recorded
    const parent = slot.spawnedBy
    if (parent === null) return recorded
    return [parent, ...this.ancestorsAsItWillRun(parent)]
  }

  private requireToAnswer(sessionId: string, by: Caller, requestId: string): HostedSession {
    return this.sessionFor(sessionId, (slot) => this.assertMayAnswer(slot, by, requestId))
  }

  private sessionFor(sessionId: string, gate: (slot: SessionSlot) => void): HostedSession {
    const slot = this.slots.get(sessionId)
    if (!slot) throw new Error(`unknown session: ${sessionId}`)
    gate(slot)
    if (slot.session === null)
      throw new SessionStillStarting(`session is still starting: ${sessionId}`, onItsWayOut(slot))
    return slot.session
  }

  private assertMayControl(slot: SessionSlot, by: Caller): void {
    if (
      (aPersonTypedIt(by) && (by as RuntimeEventSink).aPersonIsBehindIt === true) ||
      mayControl(slot, by)
    )
      return
    throw this.refusalTranslated(
      new SessionUnavailable(
        slot.ownerId === null ? 'held-by-nobody' : 'not-yours',
        `session ${slot.id} is held for ${ownerName(slot.ownerId)}, and ${callerName(by)} asked to control it`,
      ),
      'act on a session',
    )
  }

  private assertMayCommand(slot: SessionSlot, by: Caller): void {
    if (mayCommand(this.commandedNow(slot), by)) return
    this.assertMayControl(slot, by)
  }

  private assertMayMessage(slot: SessionSlot, by: Caller): void {
    if (this.withinMessagingReach(slot.id, by)) return
    if (this.thePieceItIsOnFor(slot.id, by) !== null) return
    this.assertMayControl(slot, by)
  }

  private assertMayAnswer(slot: SessionSlot, by: Caller, requestId: string): void {
    if (
      (aPersonTypedIt(by) && (by as RuntimeEventSink).aPersonIsBehindIt === true) ||
      this.aPersonAnswersWhereNobodyHolds(slot, requestId, by)
    )
      return
    if (mayAnswerAsAHuman(slot, by)) return
    if (!mayCommand(this.commandedNow(slot), by)) this.assertMayControl(slot, by)
    throw this.refusalTranslated(
      new SessionUnavailable(
        'a-person-must-answer',
        `session ${slot.id} is held for ${ownerName(slot.ownerId)}, and ${callerName(by)} asked ` +
          'to answer for a person',
      ),
      'answer for a person',
    )
  }

  private aPersonAnswersWhereNobodyHolds(
    slot: SessionSlot,
    requestId: string,
    by: Caller,
  ): boolean {
    const request = this.aPersonsRequestNobodyHolds(slot, requestId, by)
    return request !== undefined && REQUEST_IS_OPEN[request.state]
  }

  private aPersonsAnswerComesTooLate(
    sessionId: string,
    requestId: string,
    by: Caller,
  ): ProviderAnswerAck | null {
    const slot = this.slots.get(sessionId)
    const request =
      slot === undefined ? undefined : this.aPersonsRequestNobodyHolds(slot, requestId, by)
    if (request === undefined || REQUEST_IS_OPEN[request.state]) return null
    return { outcome: 'refused', reason: NO_LONGER_WAITING, stillOpen: false }
  }

  private aPersonsRequestNobodyHolds(
    slot: SessionSlot,
    requestId: string,
    by: Caller,
  ): RequestOnlyAPersonCanSettle | undefined {
    if (slot.ownerId !== null || !aPersonTypedIt(by)) return undefined
    if (mayCommand(this.commandedNow(slot), by)) return undefined
    return permissionShaped(this.deps.store.routedRequestsOf(slot.id))
      .filter((request) => request.requestId === requestId)
      .at(-1)
  }

  private async pumpEvents(session: HostedSession): Promise<void> {
    let ending: SessionEnding = 'stream-ended'
    try {
      for await (const event of session.handle.events()) {
        if (!this.isCurrentLife(session)) {
          this.noteStaleEvent(session)
          break
        }
        this.deliver(session, event)
      }
    } catch (error) {
      ending = 'stream-failed'
      this.itsStreamBroke.add(session)
      this.deliver(session, {
        type: 'error',
        message: `event stream failed: ${errorMessage(error)}`,
        fatal: true,
      })
    } finally {
      void this.finalize(session, ending).then(() => this.reopenOnARenewedSignIn(session))
    }
  }

  private whatItsTurnWasFor(session: HostedSession): WhatAFailedTurnWasFor {
    return {
      words: session.turnOpened,
      finished: session.finishedSinceItsLastTurn,
      stillRunning: session.background.running.map(
        (row) => row.description ?? row.command?.text ?? row.id,
      ),
      at: this.now(),
    }
  }

  private async endOnAMovedSignIn(
    session: HostedSession,
    wasFor: WhatAFailedTurnWasFor,
    refusedCopy: unknown | null,
  ): Promise<void> {
    let moved: boolean
    try {
      moved = !this.launches.closed && (await session.handle.checkSignIn?.()) === true
    } catch {
      moved = false
    }
    const stillItsLife = (): boolean => {
      const now = this.slots.get(session.id)
      return (
        !this.launches.closed &&
        session.diedOnAStaleSignIn !== true &&
        this.isCurrentLife(session) &&
        now !== undefined &&
        !onItsWayOut(now)
      )
    }
    const replaced =
      !moved &&
      refusedCopy !== null &&
      stillItsLife() &&
      (await this.replaceARefusedCopy(
        session.provider,
        session.profileId,
        'in a turn',
        refusedCopy,
        stillItsLife,
      ))
    const slot = this.slots.get(session.id)
    if (
      (!moved && !replaced) ||
      this.launches.closed ||
      session.diedOnAStaleSignIn === true ||
      !this.isCurrentLife(session) ||
      slot === undefined ||
      onItsWayOut(slot)
    ) {
      this.aReopenIsDecided(session.id)
      return
    }
    if (moved) {
      session.itsSignInMovedOn = true
      this.publishStateIfChanged(session)
    } else {
      session.itsCopyWasReplaced = true
    }
    session.diedOnAStaleSignIn = true
    session.whatItsFailedTurnWasFor = wasFor
    try {
      await this.timedReopen('runtime sign-in reopen close', () =>
        this.close(session.id, THE_APP_ITSELF),
      )
    } catch (error) {
      delete session.diedOnAStaleSignIn
      this.aReopenIsDecided(session.id)
      console.warn(
        `runtime host could not end ${session.id} on its moved sign-in: ${errorMessage(error)}`,
      )
    }
  }

  private aReopenIsDecided(sessionId: string): void {
    if (!this.aReopenIsBeingDecidedFor.has(sessionId)) return
    const deciding = (this.aReopenIsBeingDecidedFor.get(sessionId) ?? 1) - 1
    if (deciding > 0) this.aReopenIsBeingDecidedFor.set(sessionId, deciding)
    else this.aReopenIsBeingDecidedFor.delete(sessionId)
    this.tellWhoeverGaveTheWork(sessionId)
  }

  private timedMethod<Args extends unknown[], Result>(
    phase: string,
    method: (...args: Args) => Result,
  ): (...args: Args) => Result {
    return (...args) => this.deps.mainThreadWork!.timed(phase, () => method.apply(this, args))
  }

  private timedReopen<T>(
    phase:
      | 'runtime sign-in reopen close'
      | 'runtime sign-in held resume'
      | 'runtime sign-in renewed resume',
    work: () => T,
  ): T {
    return this.deps.mainThreadWork === undefined
      ? work()
      : this.deps.mainThreadWork.timed(phase, work)
  }

  private async reopenOnARenewedSignIn(session: HostedSession): Promise<void> {
    if (session.diedOnAStaleSignIn !== true) return
    await session.launch.settled
    return this.signInReopens.run(() => this.doReopenOnARenewedSignIn(session))
  }

  private whatACarryOnWouldAnswer(
    life: HostedSession,
    onlyAGive = false,
  ): RefusedInputReference | null {
    const sessionId = life.id
    if (life.recordingFailure !== null) return null
    try {
      const opened = this.deps.store.newestOfType?.(sessionId, 'user_turn') ?? null
      if (opened === null || opened.event.type !== 'user_turn') return null
      if (onlyAGive && 'parts' in opened.event) return null
      const first = opened.ordinal + 1
      const expected = this.deps.store.nextOrdinal(sessionId) - first
      if (expected < 1 || expected > THE_ROWS_A_REFUSED_TURN_IS_READ_IN) return null
      const since = this.deps.store.eventsFrom(sessionId, first, THE_ROWS_A_REFUSED_TURN_IS_READ_IN)
      if (since.length !== expected || since.some((row, at) => row.ordinal !== first + at)) {
        return null
      }
      const ended = since.findIndex((row) => row.event.type === 'turn')
      const end = since[ended]?.event
      if (end?.type !== 'turn' || end.state !== 'failed' || end.loginRefused !== true) return null
      if (
        since
          .slice(0, ended)
          .some(
            ({ event }) =>
              !A_TURN_THAT_DID_NOTHING_HOLDS.has(event.type) &&
              !(onlyAGive && aRefusedGiveOnlyHeardHousekeeping(event)),
          )
      ) {
        return null
      }
      if (
        since
          .slice(ended + 1)
          .some(
            ({ event }) =>
              !WHAT_A_REOPEN_ADDS.has(event.type) &&
              !(onlyAGive && aGiveReopenOnlyHeardHousekeeping(event)),
          )
      )
        return null
      const parts = theMessagesOf(opened.event)
      const drives = theDriveOfTheTurn(parts)
      if (!onlyAGive) return { opened: opened.ordinal, drives, piece: null }
      const part = parts[0]
      if (parts.length !== 1 || part?.piece === undefined || part.relayedFrom === undefined) {
        return null
      }
      if (part.attribution !== 'app_authored' || drives !== part.piece) return null
      const work = this.deps.store.workById(part.piece)
      const given = this.deps.store.newestOfType?.(sessionId, 'work_given') ?? null
      if (
        work === null ||
        work.owner !== sessionId ||
        work.givenBy !== part.relayedFrom ||
        given?.event.type !== 'work_given' ||
        given.event.piece !== part.piece ||
        given.event.givenBy !== part.relayedFrom ||
        given.event.label !== part.label ||
        given.event.brief !== part.text ||
        work.label !== part.label
      )
        return null
      if (given.ordinal >= first) {
        if (!since.slice(0, ended).some((row) => row.ordinal === given.ordinal)) return null
      } else {
        const count = opened.ordinal - given.ordinal
        if (count < 1 || count > THE_ROWS_A_REFUSED_TURN_IS_READ_IN) return null
        const before = this.deps.store.eventsFrom(sessionId, given.ordinal, count)
        if (
          before.length !== count ||
          before.some((row, at) => row.ordinal !== given.ordinal + at)
        ) {
          return null
        }
        if (
          before.some(({ event }) => {
            if (event.type === 'user_turn') {
              return theMessagesOf(event).some(
                (one) => one.piece === part.piece || one.drives === part.piece,
              )
            }
            return (
              'piece' in event &&
              event.piece === part.piece &&
              event.type !== 'work_given' &&
              event.type !== 'message_queued'
            )
          })
        )
          return null
      }
      return { opened: opened.ordinal, drives, piece: part.piece }
    } catch (error) {
      console.warn(
        `runtime host could not read ${sessionId}'s refused turn: ${errorMessage(error)}`,
      )
      return null
    }
  }

  private async carryOnAfterARepair(
    sessionId: string,
    decided: RefusedInputReference,
    continuation?: { readonly text: string; readonly ref: SessionRef },
  ): Promise<void> {
    const itMay = (): HostedSession | null => {
      const slot = this.slots.get(sessionId)
      const session = slot?.session ?? null
      if (slot === undefined || session === null || onItsWayOut(slot)) return null
      if (this.launches.closed || this.keptStopped(sessionId)) return null
      if (session.handle.status() !== 'idle') return null
      if (continuation === undefined && session.handle.carryOn === undefined) return null
      if (continuation !== undefined) {
        const ref = session.handle.ref ?? this.deps.store.findLive(sessionId)?.ref
        if (
          ref?.provider !== continuation.ref.provider ||
          ref.sessionId !== continuation.ref.sessionId ||
          ref.cwd !== continuation.ref.cwd ||
          ref.rotation !== continuation.ref.rotation
        )
          return null
      }
      if (session.mailbox.length > 0 || session.holdingQueue > 0) return null
      if (this.somethingIsOnItsWayTo(session)) return null
      if (this.itWaitsForItsLimit(session, false)) return null
      const current = this.whatACarryOnWouldAnswer(session, decided.piece !== null)
      if (
        current?.opened !== decided.opened ||
        current.drives !== decided.drives ||
        current.piece !== decided.piece
      )
        return null
      return session
    }
    const before = itMay()
    if (before === null) return
    try {
      this.assertAcceptsMessages(before, 'send')
      await this.assertSignInCurrent(before, 'send')
    } catch (error) {
      console.warn(`runtime host did not carry ${sessionId} on: ${errorMessage(error)}`)
      return
    }
    const session = itMay()
    if (session !== before) return
    const turn: UserTurnEvent = {
      type: 'user_turn',
      text: continuation?.text ?? '',
      attribution: 'app_authored',
      ...(continuation === undefined
        ? { carriesOn: true as const }
        : { appNotice: 'a-turn-continued-after-sign-in' as const }),
      ...(decided.piece === null ? {} : { carriedOnAfterAccountChange: true as const }),
      ...(decided.drives === null ? {} : { drives: decided.drives }),
    }
    try {
      session.wordsJustHandedOver = null
      session.wordsItWasHandedFor = []
      session.leadJustHandedOver = null
      session.handle.setWorkFolders(this.theWorkFoldersFor(session, []))
      session.itCarriedOnAfterARepair = true
      if (continuation !== undefined) session.itRetriedRejectedLogin = true
      this.aTurnIsHandedOver(
        session,
        { aPersons: aPersonsOwnWords(turn), names: thePiecesTheTurnNames([turn]) },
        false,
      )
      if (continuation === undefined) await session.handle.carryOn!()
      else await this.sendTheAppsWords(session, continuation.text)
    } catch (error) {
      console.warn(`runtime host did not carry ${sessionId} on: ${errorMessage(error)}`)
      return
    }
    this.publishStateIfChanged(session)
    this.publishOurs(session, turn)
  }

  private async doReopenOnARenewedSignIn(session: HostedSession): Promise<void> {
    if (session.diedOnAStaleSignIn !== true) return
    if (!this.aReopenIsBeingDecidedFor.has(session.id)) return
    let recovery: WorkRecoveryEvent | null = null
    try {
      const turn = this.deps.store.theNewestTurn(session.id)
      if (turn !== null) {
        recovery = {
          type: 'work_recovery',
          turn,
          since: this.aReopenIsBeingDecidedFor.get(session.id)!,
          pieces: this.deps.store.reconciliationDrivenByTurn(session.id, turn),
          phase: 'pending',
        }
        this.writeIntoItsLedger(session.id, recovery)
      }
    } catch (error) {
      console.warn(`runtime host could not record its sign-in recovery: ${errorMessage(error)}`)
    }
    let held = false
    const carried = this.heldAtAStop.has(session.id)
    let attempted = false
    try {
      if (this.launches.closed || this.keptStopped(session.id)) return
      const renewal = this.deps.loginRenewal?.(session.provider)
      const rejected = session.renewItsRejectedLogin === true
      const movedBeforeRenewal = rejected && (await session.handle.checkSignIn?.()) === true
      const renew = rejected ? renewal?.renewRejected : renewal?.renew
      const renewed =
        !movedBeforeRenewal &&
        renewal !== undefined &&
        renew !== undefined &&
        !this.aKeyIsSaved(session.provider) &&
        (await this.withProviderLaunch(renewal.launchLabel, renew)) === 'renewed'
      if (
        this.launches.closed ||
        this.keptStopped(session.id) ||
        !this.aReopenIsBeingDecidedFor.has(session.id) ||
        (rejected && this.aKeyIsSaved(session.provider))
      )
        return
      if (session.itsCopyWasReplaced !== true) {
        if ((await session.handle.checkSignIn?.()) !== true) return
        if (
          rejected &&
          this.rejectedMachineLogins.get(session.provider) === session.rejectedLoginToRenew
        ) {
          this.rejectedMachineLogins.delete(session.provider)
          this.providersMoved({ what: 'login', provider: session.provider })
        }
        this.aSignInChanged(session.provider, session.lifeSince, session.profileId)
      }
      if (!this.aReopenIsBeingDecidedFor.has(session.id)) return
      const wasFor = session.whatItsFailedTurnWasFor
      if (wasFor !== undefined && !wasFor.words) {
        this.holdUntilItStarts(
          session.id,
          aRefusedLoginStoppedText(wasFor, this.now(), session.provider),
          {
            appNotice: 'a-turn-a-refused-login-stopped',
          },
        )
        held = true
      }
      if (this.slots.has(session.id)) return
      if (this.keptStopped(session.id)) return
      const continuationText = rejected ? renewal?.rejectedTurnContinuation : undefined
      const failedRef = session.handle.ref
      const recordedRef = this.deps.store.findLive(session.id)?.ref
      const sameFailedThread =
        failedRef !== null &&
        recordedRef?.provider === failedRef.provider &&
        recordedRef.sessionId === failedRef.sessionId &&
        recordedRef.cwd === failedRef.cwd &&
        recordedRef.rotation === failedRef.rotation
      const carryOn =
        (!rejected || (continuationText !== undefined && sameFailedThread)) &&
        session.itCarriedOnAfterARepair !== true &&
        wasFor?.words === true &&
        (session.itsCopyWasReplaced === true ||
          rejected ||
          (providerAuthPolicies[session.provider].copy.carriesAcceptedAfterAccountChange &&
            session.itsSignInMovedOn === true))
          ? this.whatACarryOnWouldAnswer(session, !rejected && session.itsCopyWasReplaced !== true)
          : null
      const watching = session.sink.alive && session.sink.aPersonIsBehindIt ? session.sink : null
      if (renewed) this.renewedForItsReopen.add(session.id)
      if (session.itsCopyWasReplaced === true) this.reopenedOnAReplacedCopy.add(session.id)
      try {
        attempted = true
        await this.timedReopen('runtime sign-in renewed resume', () =>
          this.resumeSession(session.id, watching, null, 'the-sign-in-was-renewed', 'not-read'),
        )
      } finally {
        this.renewedForItsReopen.delete(session.id)
        this.reopenedOnAReplacedCopy.delete(session.id)
      }
      if (carryOn !== null)
        await this.carryOnAfterARepair(
          session.id,
          carryOn,
          continuationText !== undefined && failedRef !== null
            ? { text: continuationText, ref: failedRef }
            : undefined,
        )
    } catch (error) {
      const raced = this.slots.get(session.id)
      if (raced !== undefined && raced.session === null && !onItsWayOut(raced)) {
        await raced.arrived
      }
      if (!this.runsNow(session.id)) {
        console.warn(
          `runtime host could not reopen ${session.id} on the renewed sign-in: ${errorMessage(error)}`,
        )
      }
    } finally {
      if (!attempted && carried && !this.launches.closed && !this.slots.has(session.id)) {
        await this.timedReopen('runtime sign-in held resume', () =>
          this.startForWhatItHeld(session),
        )
      }
      if (held && !this.slots.has(session.id) && !this.keptStopped(session.id)) {
        this.letGoOfItsMissedJobs(
          session.id,
          ITS_REOPEN_ON_THE_NEW_LOGIN_FAILED,
          'a-turn-a-refused-login-stopped',
        )
      }
      const decided = (): void => {
        if (recovery !== null) {
          try {
            this.writeIntoItsLedger(session.id, {
              ...recovery,
              phase: this.runsNow(session.id) ? 'sent' : attempted ? 'failed' : 'declined',
            })
          } catch (error) {
            console.warn(
              `runtime host could not record its sign-in recovery: ${errorMessage(error)}`,
            )
          }
        }
        this.aReopenIsDecided(session.id)
        this.reconcileWork(new Set([session.id]))
      }
      const starting = this.slots.get(session.id)
      if (starting !== undefined && starting.session === null && !onItsWayOut(starting)) {
        void starting.arrived.then(decided, decided)
      } else decided()
    }
  }

  private aReopenCarriesIt(error: unknown, by: Caller, session: HostedSession): boolean {
    if (!(error instanceof ItsSignInMovedOn)) return false
    return !aPersonIsAsking(by) || !this.itsReopenDidNotHelp(session)
  }

  private whatAReopenWaitsFor(session: HostedSession): WhatAReopenWaitsFor | null {
    const status = session.handle.status()
    if (status === 'waiting_permission') return 'a-person'
    if (
      status !== 'idle' ||
      session.holdingQueue > 0 ||
      session.handingOver.length > 0 ||
      this.somethingIsOnItsWayTo(session)
    ) {
      return 'its-turn'
    }
    if (somethingRunning(session.background)) return 'its-background-work'
    if (session.handle.settings.planMode.requested) return 'its-planning'
    return null
  }

  private reopenForWhatWaits(session: HostedSession): void {
    if (session.itsSignInMovedOn !== true || !this.aReopenIsOwedFor(session)) return
    if (session.reopeningOnTheCurrentSignIn === true || this.launches.closed) return
    if (this.itsReopenDidNotHelp(session)) {
      if (session.reopenedForWhatWaited?.stopped === false) {
        session.reopenedForWhatWaited.stopped = true
        console.warn(
          `runtime host: ${session.id} was reopened on the current ${PROVIDER_NAME[session.provider]} sign-in for what waited, ` +
            'and its sign-in read as moved on again before it had read as current — it is left for ' +
            'a person to reopen',
        )
      }
      return
    }
    if (this.itStoppedUnder(session) || this.whatAReopenWaitsFor(session) !== null) return
    session.reopeningOnTheCurrentSignIn = true
    this.signInRestarts.add(session)
    this.reopeningForWhatWaited.add(session.id)
    console.info(
      `runtime host: ${session.id} holds a ${PROVIDER_NAME[session.provider]} sign-in that has moved on — reopening ` +
        'it on the current one for what is held for it',
    )
    void this.signInReopens.run(async () => {
      try {
        if (
          !this.isCurrentLife(session) ||
          !this.aReopenIsOwedFor(session) ||
          this.itStoppedUnder(session) ||
          this.whatAReopenWaitsFor(session) !== null
        )
          return
        this.signInStops.add(session)
        await this.timedReopen('runtime sign-in reopen close', () =>
          this.close(session.id, THE_APP_ITSELF),
        )
        const stopped = Promise.resolve(session.terminated)
        if (await settledWithin(stopped, this.closeDrainTimeoutMs)) {
          await this.timedReopen('runtime sign-in held resume', () =>
            this.startForWhatItHeld(session),
          )
        } else {
          void stopped.then(() =>
            this.signInReopens.run(() =>
              this.timedReopen('runtime sign-in held resume', () =>
                this.startForWhatItHeld(session),
              ),
            ),
          )
        }
      } catch (error) {
        this.reopeningForWhatWaited.delete(session.id)
        console.warn(
          `runtime host could not stop ${session.id} to reopen it on the current sign-in: ${errorMessage(
            error,
          )}`,
        )
      } finally {
        this.signInStops.delete(session)
        delete session.reopeningOnTheCurrentSignIn
        if (this.isCurrentLife(session) || !this.heldAtAStop.has(session.id)) {
          this.reopeningForWhatWaited.delete(session.id)
        }
      }
    })
  }

  private aReopenIsOwedFor(session: HostedSession): boolean {
    return session.mailbox.length > 0
  }

  private itsReopenDidNotHelp(session: HostedSession): boolean {
    const reopened = session.reopenedForWhatWaited
    return reopened?.didNotHelp === true && this.now() - reopened.at < REOPEN_LOOP_GUARD_MS
  }

  private whyItWaitsForItsSignIn(sessionId: string): string | null {
    const session = this.slots.get(this.theOneInItsPlace(sessionId))?.session ?? null
    if (session === null || session.itsSignInMovedOn !== true) return null
    const limit = this.whatItsLimitHolds(
      session.provider,
      true,
      this.limitAccountOf(session.id, this.now()),
    )
    const reopens = (waitsFor: keyof typeof A_REOPEN_WAITS_FOR): string => {
      const { reopens: when, then, sooner } = A_REOPEN_WAITS_FOR[waitsFor]
      const first = limit === null ? `${when}${then ?? ''}.` : `${when}.`
      const said = [theSignInChanged(session.provider), first]
      if (sooner !== undefined) said.push(sooner)
      if (limit !== null) said.push(limit)
      return said.join(' ')
    }
    if (session.reopeningOnTheCurrentSignIn === true) return reopens('nothing')
    if (this.launches.closed || this.itStoppedUnder(session) || !this.aReopenIsOwedFor(session)) {
      return null
    }
    const waitsFor = this.itsReopenDidNotHelp(session)
      ? 'a-person-to-reopen-it'
      : (this.whatAReopenWaitsFor(session) ?? 'nothing')
    return reopens(waitsFor)
  }

  whyWhatIsHeldWaits(sessionId: string, itsStopIsSaid = false): string | null {
    return (
      this.whyItWaitsForServices(sessionId) ??
      this.whyItWaitsForItsSignIn(sessionId) ??
      this.whyItWaitsForAPerson(sessionId, itsStopIsSaid) ??
      this.whyItWaitsForItsLimit(sessionId)
    )
  }

  private whyItWaitsForServices(sessionId: string): string | null {
    const id = this.theOneInItsPlace(sessionId)
    if (this.servicesAreOn()) return null
    try {
      const slot = this.slots.get(id)
      const starting = slot !== undefined && slot.session === null && !onItsWayOut(slot)
      if (starting || this.runsNow(id) || !this.itIsAService(id)) return null
      return this.deps.store.messagesWaitingIn(id).length > 0 ? THEY_WAIT_FOR_SERVICES : null
    } catch (error) {
      console.warn(`runtime host could not read what waits for ${id}: ${errorMessage(error)}`)
      return null
    }
  }

  answersHeldFor(sessionId: string): ReadonlySet<string> {
    const session = this.slots.get(this.theOneInItsPlace(sessionId))?.session ?? null
    return new Set(
      (session?.mailbox ?? []).flatMap((held) => {
        const answer = theAnswerItCarries(held.authorship)
        return answer === null ? [] : [answer.piece]
      }),
    )
  }

  private whyItWaitsForAPerson(sessionId: string, itsStopIsSaid: boolean): string | null {
    const id = this.theOneInItsPlace(sessionId)
    const session = this.slots.get(id)?.session ?? null
    if (session === null || session.mailbox.every(aPersonsOwn)) return null
    const stopped = this.whatItIsStoppedOn(id)
    if (stopped === null) return null
    const limit = this.whyItWaitsForItsLimit(sessionId, true)
    if (itsStopIsSaid) return limit
    const stop =
      `Its turn is stopped until a person answers ${stopped.asks}, asked at ` +
      `${clockTimeFrom(stopped.since, stopped.readAt)}, under Waiting on you: nothing sent to it ` +
      'goes in until then.'
    return limit === null ? stop : `${stop} ${limit}`
  }

  private whatItIsStoppedOn(sessionId: string, ledger?: ItsLedger): StoppedOnAPerson | null {
    const slot = this.slots.get(sessionId)
    if (slot === undefined || onItsWayOut(slot)) return null
    if (slot.session?.handle.status() !== 'waiting_permission') return null
    const { routings, raised } = ledger ?? this.oneLedgerReadPerAnswer(rowsUnreadOnce())(sessionId)
    const parking = routings.filter(
      (one) => REQUEST_IS_OPEN[one.state] && raised.get(one.requestId)?.raisedBy !== 'this-app',
    )
    if (parking.some((one) => one.went.to !== 'a-person')) return null
    const newest = parking.at(-1)
    if (newest === undefined) return null
    return {
      asks: this.whatTheRequestAsks(sessionId, newest.requestId),
      since: newest.at,
      readAt: this.now(),
    }
  }

  private whatTheRequestAsks(sessionId: string, requestId: string): string {
    const oneLine = (text: string): string => {
      const line = text.split('\n')[0]?.trim() ?? ''
      return line.length > ASKS_SAID_CHARS
        ? `${line.slice(0, headOf(line, ASKS_SAID_CHARS - 1))}…`
        : line
    }
    const asked = this.deps.store.newestOfType?.(sessionId, 'permission_request')?.event
    if (asked?.type === 'permission_request' && asked.id === requestId) {
      const what = oneLine(asked.summary ?? asked.detail)
      return what === '' || what === asked.action
        ? `its request to use ${asked.action}`
        : `its request to use ${asked.action} (${what})`
    }
    const question = this.deps.store.newestOfType?.(sessionId, 'user_input_request')?.event
    if (question?.type === 'user_input_request' && question.id === requestId) {
      const what = oneLine(question.prompt)
      return what === '' ? 'its question' : `its question “${what}”`
    }
    return 'what it asked'
  }

  private publishAgentInfoIfChanged(session: HostedSession): void {
    const next = JSON.stringify(session.handle.agentInfo ?? {})
    if (next === session.lastAgentInfo) return
    session.lastAgentInfo = next
    if (!session.sink.alive) return
    session.sink.sendLiveness({ sessionId: session.id, liveness: livenessFor(session) })
  }

  private publishStateIfChanged(session: HostedSession): void {
    session.grants ??= this.grantsOf(session.id)
    const disclosures = sessionDisclosures(session)
    const next = JSON.stringify(disclosures)
    if (next === session.lastDisclosures) return
    session.lastDisclosures = next
    if (!session.sink.alive) return
    session.sink.sendLiveness({
      sessionId: session.id,
      liveness: livenessFor(session, disclosures),
    })
  }

  private isCurrentLife(session: HostedSession): boolean {
    return session.finalizing === null && this.slots.get(session.id)?.session === session
  }

  private noteStaleEvent(session: HostedSession): void {
    if (session.staleEventReported) return
    session.staleEventReported = true
    console.warn(
      `runtime session ${session.id}: an event arrived after this life was finalized — ` +
        'dropping it rather than writing it into the conversation that holds the id now',
    )
  }

  private sayWhatIsScheduled(
    session: HostedSession,
    at: number,
    stated: ScheduleLevel | null,
  ): RuntimeEventMessage | null {
    if (stated !== null) session.levelWritten = stated
    const plan = session.recordingFailure === null ? this.planItsSchedule(session.id, at) : null
    const partOnly =
      plan !== null &&
      this.itsEvidence(session.id).historyIsCut &&
      !this.itsEvidence(session.id).readALevel
    if (plan === null || !plan.currentListing.publishable || partOnly) {
      if (stated !== null) session.scheduled = stated
      return null
    }
    this.settleWhatItSaw(session.id, plan, at)
    const { notStarted } = this.whatItsJobsAreOwed(session.id, plan, at)
    const level = this.theLevelItPlans(session.id, plan, at, undefined, notStarted)
    session.scheduled = level
    if (session.levelWritten !== null && theSameLevel(level, session.levelWritten)) {
      this.noteWhatItsNewestLevelSays(session.id, session.levelWritten, at)
      return null
    }
    session.levelWritten = level
    this.noteWhatItsNewestLevelSays(session.id, level, at)
    return this.recordOurs(session, {
      type: 'scheduled_work',
      jobs: [...level.jobs],
      ...(level.dropped > 0 ? { dropped: level.dropped } : {}),
      source: RECEIPTS_LEVEL_SOURCE,
    })
  }

  private markItsProvidersReset(session: HostedSession, at: number): RuntimeEventMessage[] {
    if (!scheduleHeld(session.scheduled) && !this.scheduleEvidence.has(session.id)) return []
    let marked: RuntimeEventMessage | null = null
    try {
      this.scheduleEvidence.get(session.id)?.itsProviderWasReset()
      marked = this.recordOurs(session, {
        type: 'scheduled_work',
        reset: true,
        source: RECEIPTS_LEVEL_SOURCE,
      })
    } catch (error) {
      console.warn(
        `runtime host could not mark ${session.id}'s reset for its jobs: ${errorMessage(error)}`,
      )
    }
    if (marked === null || session.recordingFailure !== null) {
      const kept = this.itsAttempts(session.id)
      this.keepItsAttempts(session.id, { ...kept, resetUnmarkedAt: at, at })
      return []
    }
    let level: RuntimeEventMessage | null = null
    try {
      level = this.sayWhatIsScheduled(session, at, null)
    } catch (error) {
      console.warn(
        `runtime host could not say ${session.id}'s jobs after its reset: ${errorMessage(error)}`,
      )
    }
    return [marked, level].filter((row): row is RuntimeEventMessage => row !== null)
  }

  private noteWhatItsNewestLevelSays(
    conversation: string,
    level: ScheduleLevel,
    now: number,
  ): void {
    try {
      const said = whatItSaysIsNotStarted(level)
      const kept = this.itsAttempts(conversation)
      if (theSameIsSaid(said, kept.notStartedSaid)) return
      this.keepItsAttempts(conversation, { ...kept, notStartedSaid: said, at: now })
    } catch (error) {
      console.warn(
        `runtime host could not note what ${conversation}'s level says of its jobs: ${errorMessage(error)}`,
      )
    }
  }

  private sayWhatItIsNotStartedFor(
    conversation: string,
    level: ScheduleLevel,
    now: number,
    itsLedgerSays: Readonly<Record<string, NotStartedBecause>> | undefined = undefined,
  ): void {
    try {
      const said = whatItSaysIsNotStarted(level)
      const kept = this.itsAttempts(conversation)
      if (theSameIsSaid(said, kept.notStartedSaid)) return
      if (itsLedgerSays !== undefined && theSameIsSaid(said, itsLedgerSays)) {
        this.keepItsAttempts(conversation, { ...kept, notStartedSaid: said, at: now })
        return
      }
      const written = this.writeWhileNothingRunsIt(conversation, {
        type: 'scheduled_work',
        jobs: [...level.jobs],
        ...(level.dropped > 0 ? { dropped: level.dropped } : {}),
        source: RECEIPTS_LEVEL_SOURCE,
      })
      if (written) this.keepItsAttempts(conversation, { ...kept, notStartedSaid: said, at: now })
    } catch (error) {
      console.warn(
        `runtime host could not say what ${conversation} is not started for: ${errorMessage(error)}`,
      )
    }
  }

  private takeTheLevels(session: HostedSession, event: RuntimeEvent): void {
    if (event.type === 'tool_call' && event.summary !== '') {
      session.toolCallsNamed.set(event.id, { name: event.name, text: event.summary })
      if (session.toolCallsNamed.size > TOOL_CALLS_REMEMBERED) {
        const oldest = session.toolCallsNamed.keys().next().value
        if (oldest !== undefined) session.toolCallsNamed.delete(oldest)
      }
    }
    if (event.type === 'background_work' && event.running !== undefined) {
      const previous = session.background.running
      session.background = {
        running: event.running.map((row) => {
          const command =
            (row.toolCallId === undefined
              ? undefined
              : session.toolCallsNamed.get(row.toolCallId)) ??
            previous.find((one) => one.id === row.id)?.command
          return command === undefined ? { ...row } : { ...row, command }
        }),
        dropped: event.dropped ?? 0,
      }
    }
  }

  private withoutTheIndexLines(session: HostedSession, event: RuntimeEvent): RuntimeEvent {
    const lines = session.savedMethodsLines
    if (lines === null || !holdsTheLines(event, lines)) return event
    return withTheLinesKeptIn(event, lines) as RuntimeEvent
  }

  private deliver(session: HostedSession, given: RuntimeEvent): void {
    if (!this.isCurrentLife(session)) {
      this.noteStaleEvent(session)
      return
    }
    if (given.type === 'session' || given.type === 'error' || given.type === 'turn')
      this.recordLimitAccount(session)
    const event = this.withoutTheIndexLines(
      session,
      this.sayingARefusedCopyIsReplaced(session, given),
    )
    session.liveness.observe(event)
    if (event.type === 'unknown' && event.passing === true) return
    if (event.type === 'provider_turn') {
      session.personalHandover++
      session.personalWorkTurn = null
      this.aTurnWentIn.add(session)
    }
    if (event.type === 'turn') this.takeWhatItsStopEnded(session, event)
    if (event.type === 'turn') this.noteWhatATurnSaysOfTheKey(session, event)
    if (
      event.type === 'scheduled_work' &&
      (event.jobs !== undefined ||
        event.receipt?.tool === 'CronCreate' ||
        event.receipt?.tool === 'CronDelete')
    ) {
      session.providerSpokeOfItsJobs = true
    }
    if (event.type === 'provider_usage') {
      this.noteTheWindowsSeen(session.provider, event)
      if (!this.readsAnOlderLogin(session)) this.takeTheUsage(session, event)
      this.keepAWindowFirstSeen()
      return
    }
    if (event.type === 'turn' && event.state === 'completed' && session.itRetriedRejectedLogin) {
      delete session.itRetriedRejectedLogin
      delete session.itCarriedOnAfterARepair
    }
    if (
      event.type === 'turn' &&
      event.loginRefused === true &&
      session.itRetriedRejectedLogin !== true &&
      event.onAKey !== true &&
      session.diedOnAStaleSignIn !== true &&
      session.handle.checkSignIn !== undefined
    ) {
      this.aReopenIsBeingDecidedFor.set(
        session.id,
        (this.aReopenIsBeingDecidedFor.get(session.id) ?? 0) + 1,
      )
      const now = this.theCopyHeldNow(session)
      void this.endOnAMovedSignIn(
        session,
        this.whatItsTurnWasFor(session),
        providerAuthPolicies[session.provider].copy.same(session.handle.signInCopyAtLaunch?.(), now)
          ? now
          : null,
      )
    }
    if (
      event.type === 'error' &&
      event.cause === 'auth' &&
      event.onAKey !== true &&
      providerAuthPolicies[session.provider].remembersRejectedMachineLogin &&
      !this.readsAnOlderLogin(session) &&
      !this.aKeyIsSaved(session.provider)
    ) {
      this.rejectedMachineLogins.set(session.provider, {})
      this.providersMoved({ what: 'login', provider: session.provider })
    }
    if (event.type === 'error' && event.fatal) {
      const canRenewRejected =
        (event.cause === 'auth_stale' || event.cause === 'auth') &&
        event.onAKey !== true &&
        !this.aKeyIsSaved(session.provider) &&
        session.itRetriedRejectedLogin !== true &&
        session.diedOnAStaleSignIn !== true &&
        this.deps.loginRenewal?.(session.provider)?.renewRejected !== undefined
      if (
        (event.cause === 'auth_stale' && session.itRetriedRejectedLogin !== true) ||
        canRenewRejected
      ) {
        if (canRenewRejected) {
          session.renewItsRejectedLogin = true
          session.rejectedLoginToRenew = this.rejectedMachineLogins.get(session.provider)
        }
        session.diedOnAStaleSignIn = true
        session.whatItsFailedTurnWasFor = this.whatItsTurnWasFor(session)
        this.aReopenIsBeingDecidedFor.set(
          session.id,
          (this.aReopenIsBeingDecidedFor.get(session.id) ?? 0) + 1,
        )
      }
    }
    if (event.type === 'background_work' && event.ended !== undefined) {
      const ended = event.ended
      const earlier = session.finishedSinceItsLastTurn.some((one) => one.id === ended.id)
      session.finishedSinceItsLastTurn = earlier
        ? session.finishedSinceItsLastTurn.map((one) =>
            one.id === ended.id ? { ...one, ...ended } : one,
          )
        : [...session.finishedSinceItsLastTurn, ended]
    }
    if (event.type === 'error' && event.fatal && !this.providerFailedWith.has(session.id)) {
      this.providerFailedWith.set(session.id, event.message)
    }
    if (
      event.type === 'error' &&
      event.fatal &&
      event.cause !== 'auth_stale' &&
      event.cause !== 'auth' &&
      event.billingRefused !== true &&
      event.endedByItsAdapter !== true &&
      !this.itsStreamBroke.has(session)
    ) {
      this.keepWhatItsProgramCut(session)
    }
    if (event.type === 'provider_commands') {
      session.commands = {
        commands: event.commands,
        prefix: event.prefix,
        ...(event.dropped === undefined ? {} : { dropped: event.dropped }),
      }
    }
    if (event.type === 'context_reading') session.latestContext = event.reading
    if (
      event.type === 'compaction' &&
      event.after === undefined &&
      event.parentToolCallId === undefined
    ) {
      session.latestContext = { kind: 'unknown' }
    }
    if (event.type === 'permission_request' && event.cancelStopsNothing === true) {
      session.cancelsThatStopNothing.add(event.id)
    }
    if (event.type === 'request_resolved') session.cancelsThatStopNothing.delete(event.id)
    if (event.type === 'turn') session.stopStillAsked = null
    if (event.type === 'turn') session.cancelsThatStopNothing.clear()
    if (event.type === 'error' || event.type === 'provider_limit_clear' || event.type === 'turn') {
      this.wallsForTheHold = null
      this.invalidateProviderLimitFacts()
    }
    if (event.type === 'provider_limit_clear') {
      const provider = session.provider
      if (this.theResets.has(provider)) queueMicrotask(() => this.lookAtTheLimitAgain(provider))
    }
    if (
      event.type === 'compaction' ||
      (event.type === 'turn' && event.state === 'failed' && event.wordOf === 'this-app')
    ) {
      session.pluginsAsLastSaid = null
      session.firstTurnLead = session.lifeLead
      session.firstTurnLeadIs = 'whole'
    }
    const at = this.now()
    const wire = toWireEvent(
      session.provider,
      event.type === 'scheduled_work' && event.receipt !== undefined
        ? { ...event, receipt: { ...event.receipt, stamp: receiptStamp(this.itsCalendar()) } }
        : event,
    )
    this.takeTheLevels(session, event)
    session.beingDone.observe(event, at)
    const cutByALimit =
      event.type === 'turn' && event.state === 'failed' && event.limit !== undefined
        ? this.theOpenTurnOf(session)
        : null
    const ordinal = this.takeLedgerOrdinal(session)
    this.record(session, () => this.deps.store.append(session.id, ordinal, wire, at))
    this.markWhatWasNotRecorded(session, ordinal, wire)
    this.rememberLedgerOrdinal(session, ordinal)
    if (session.recordingFailure === null) this.aScheduleRowWasKept(session.id, ordinal, wire, at)
    if (cutByALimit !== null && event.type === 'turn' && event.limit !== undefined) {
      this.keepWhatALimitCut(session, cutByALimit, event.limit)
    }
    const life = this.providerLimitLives.get(session.id)?.life
    if (life !== undefined && !this.readsAnOlderLogin(session)) {
      if (this.providerLimitFacts.observe(session.id, life, session.provider, event, at))
        this.publishProviderLimitFactsSoon(session.id)
    }
    this.recordPlanPhase(session, false)

    const note =
      event.type === 'status' && TURN_ENDINGS.has(event.state)
        ? this.recordMemoryNotes(session)
        : null
    const listing =
      wire.type === 'scheduled_work'
        ? this.sayWhatIsScheduled(
            session,
            at,
            wire.jobs === undefined ? null : { jobs: wire.jobs, dropped: wire.dropped ?? 0 },
          )
        : null
    const reset = event.type === 'conversation_reset' ? this.markItsProvidersReset(session, at) : []
    if (event.type === 'status' && TURN_ENDINGS.has(event.state)) {
      session.turnsEnded += 1
      session.aPersonsWordsOpenedIt = false
      session.finishedSinceItsLastTurn = []
      session.itsWorkWasReadBeforeItsWords = false
    }

    if (event.type === 'turn' || event.type === 'status') {
      this.tellWhoeverGaveTheWork(session.id)
      if (event.type === 'turn' || (event.type === 'status' && TURN_ENDINGS.has(event.state)))
        this.reconcileWork(new Set([session.id]))
    }
    if (event.type === 'status' && event.state === 'working' && !session.turnOpened) {
      session.itsWorkWasReadBeforeItsWords = true
    }
    if (
      event.type === 'background_work' ||
      (event.type === 'scheduled_work' && event.jobs !== undefined)
    ) {
      this.sayWhetherALevelMovedItsWork(session, event)
    }

    const routed = this.routeRequest(session, event, wire)
    this.recordWhatItReportsRunning(session)

    if (session.sink.alive) {
      this.emit(session, { sessionId: session.id, ordinal, at, event: wire })
      if (listing !== null) this.emit(session, listing)
      for (const row of reset) this.emit(session, row)
      if (note !== null) this.emit(session, note)
      this.reportRecordingFailure(session)
      this.publishAgentInfoIfChanged(session)
      if (routed !== null) this.emit(session, routed)
    }
    if (event.type === 'status' && event.state === 'idle') this.flushQueued(session)
    if (event.type === 'background_work') {
      void this.copyHomeWhenIdle(session.provider, session.profileId)
      this.reopenForWhatWaits(session)
    }
  }

  private recordMemoryNotes(session: HostedSession): RuntimeEventMessage | null {
    const { event, names } = notesThatAppeared(session.memoryNoteDir, session.memoryNotes)
    session.memoryNotes = names
    if (!session.turnOpened) return null
    session.turnOpened = false
    return event === null ? null : this.recordOurs(session, event)
  }
}

function recordingNote(outcome: ImportedRecording['outcome'], readable: boolean): string {
  switch (outcome) {
    case 'imported':
      return 'Its prior messages are here now.'
    case 'skipped':
      return readable
        ? 'Its messages were already here — nothing more to import.'
        : "There is nothing of this conversation in its profile's folder to import."
    case 'nothing-readable':
      return 'Its provider file holds no readable conversation.'
    case 'still-writing':
      return 'Its file is still being written. Try importing it again when it has finished.'
    case 'stopped':
      return 'The app is shutting down. Its messages will be read from its file next time.'
    case 'failed':
      return 'It could not be imported.'
    case 'superseded':
      return 'Something else imported it at the same moment. Its messages are here — from that pass, not this one.'
    case 'in-use':
      return 'It is open right now, and what it is saying is already being recorded.'
    case 'unknown-session':
    case 'refused':
    case 'user-home':
      return 'It could not be imported.'
    default: {
      const unreached: never = outcome
      return unreached
    }
  }
}

function headOf(text: string, limit: number): number {
  if (text.length <= limit) return limit
  const before = text.charCodeAt(limit - 1)
  return before >= 0xd800 && before <= 0xdbff ? limit - 1 : limit
}

function oneAgentsAnswer(
  given: readonly { readonly part: string; readonly answer: readonly string[] }[],
  asked: () => readonly UserInputQuestion[] | undefined,
): {
  readonly answers: readonly { readonly part: string; readonly answer: readonly string[] }[]
  readonly notAsked: readonly string[]
  readonly units: number
} {
  const known = asked()
  const questionOf = (part: string): UserInputQuestion | undefined =>
    known?.find((candidate) => candidate.id === part)
  const delivered =
    known === undefined ? given : given.filter((one) => questionOf(one.part) !== undefined)
  const notAsked = given.filter((one) => !delivered.includes(one)).map((one) => one.part)
  const isItsOwn = (part: string, said: string): boolean => {
    if (said.trim() === '') return false
    const question = questionOf(part)
    return question === undefined || !isOfferedLabel(question, said)
  }
  const units = delivered
    .flatMap((one) => one.answer.filter((said) => isItsOwn(one.part, said)))
    .reduce((total, said) => total + said.length, 0)
  const answers = delivered.map((one) => ({
    part: one.part,
    answer: one.answer.map((said) => (said.trim() === '' ? '' : said)),
  }))
  return { answers, notAsked, units }
}

function homeProfileOf(row: { profileId: string | null; adoptedAt: number | null }): string | null {
  if (row.adoptedAt !== null && row.profileId === null) return null
  return row.profileId ?? DEFAULT_PROFILE_ID
}

function toHomeConversation(session: UserHomeDiscovery['found'][number]): HomeConversation {
  return {
    provider: session.provider,
    sessionId: session.sessionId,
    cwd: session.cwd,
    path: session.path,
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    profileId: session.profileId,
    ...(session.child ? { child: session.child } : {}),
  }
}

interface StampedIncidents {
  readonly walk: LedgerWalk<WorkIncident>
  readonly seq: number
  readonly validUntil: number
  readonly holders: ReadonlySet<string>
  readonly live: string
}

function personsCoverage(parts: Omit<PersonsQueue, 'published'>): Record<PersonsPart, Coverage> {
  const covers = {} as Record<PersonsPart, Coverage>
  for (const part of PERSONS_PARTS) {
    const value = parts[part]
    const key = PERSONS_ROW_KEY[part] as (row: unknown) => string
    covers[part] =
      value === null
        ? { population: 'persons', scope: part, complete: false, ids: [] }
        : everyRowWasRead(value)
          ? { population: 'persons', scope: part, complete: true }
          : {
              population: 'persons',
              scope: part,
              complete: false,
              ids: (value.rows as readonly unknown[]).map(key),
            }
  }
  return covers
}

function everyRowWasRead(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  const walk = value as { rowsUnread?: unknown; ledgersSkipped?: unknown }
  return (
    (typeof walk.rowsUnread !== 'number' || walk.rowsUnread === 0) &&
    (typeof walk.ledgersSkipped !== 'number' || walk.ledgersSkipped === 0)
  )
}

async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([promise.then(() => true).catch(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}
