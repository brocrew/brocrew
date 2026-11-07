import type { DecideMoveRequestInput, MoveRequestAck } from '../shared/move-contracts'
import type { LedgerWalk, PersonsDecision, PersonsQuestion } from '../shared/question-contracts'
import type { WhatEachConversationIsWaitingOn, WorkGivenOut } from '../shared/task-contracts'
import type { McpServerRequestForAPerson } from '../shared/conversation-events'
import type { HandedPath } from '../shared/attachment-contracts'
import type { SessionSettingChanged } from '../shared/model-choice-contracts'
import type { ListingAnswer } from '../shared/listing-published'
import type { PublicationEpoch } from '../shared/data-version'
import type { PersonsQueueAnswer } from '../shared/persons-published'
import { providerSetupBridge } from './provider-setup'
import type { RulesBaseline } from '../shared/agent-rules'
import type { OwnNotesWrite } from '../shared/own-notes'
import {
  RECOVERY_RETENTION_CHANNELS,
  type RetainedRecoveryCopy,
} from '../shared/recovery-retention'
import { pluginsBridge } from './plugins'
import { storageBridge } from './storage'
import { voiceBridge } from './voice'
import type { SkillsRequest, SkillsReply } from '../shared/skills-window'
import {
  TRANSCRIPT_RETENTION_CHANNELS,
  type TranscriptRetention,
} from '../shared/transcript-retention'
import { ATTENTION_SIGNALS_CHANNEL, type AttentionSignal } from '../shared/attention-signals'
import { DOCK_LABEL_CHANNELS, type DockLabel, type DockLabelChange } from '../shared/dock-label'
import {
  APP_NAVIGATE_CHANNEL,
  isNavigationDirection,
  type NavigationDirection,
} from '../shared/app-navigation'
import type { LinkResolution } from '../shared/link-resolution'

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { themesBridge } from './themes'
import { themeBeforePaint } from './theme-before-paint'
import {
  WINDOW_CONTROL_CHANNEL,
  type WindowControl,
  type WindowControlEffect,
} from '../shared/window-controls'
import type { AppInfo, ProviderConnection } from '@brobot2/shared'
import {
  UPDATES_CHANNELS,
  type UpdatesSettingsChange,
  type UpdatesSnapshot,
} from '../shared/updates'
import {
  WORKSPACES_CHANNELS,
  type NewWorkspace,
  type WorkspaceChanged,
  type WorkspaceDeleted,
  type WorkspaceDeleteVerdict,
  type WorkspaceFolderVerdict,
  type WorkspaceOpened,
  type WorkspaceRename,
  type WorkspaceRow,
} from '../shared/workspaces'
import {
  PROVIDER_SNAPSHOTS_CHANNELS,
  type SnapshotAnswer,
  type SnapshotCatalogue,
} from '../shared/provider-snapshots'
import type { CapabilityGrant } from '../shared/capabilities'
import {
  PAGE_RECEIPT_KIND,
  type PagePerformanceReport,
  type PageReportAnswer,
} from '../shared/page-performance'
import type { ExternalMcpServerReach, ExternalMcpServerRow } from '../shared/external-mcp'

import type { ProviderLimitSeen } from '../shared/provider-limit'
import {
  LIMITS_DISPLAY_CHANGED_CHANNEL,
  type LimitsDisplayAnswer,
  type LimitsDisplayChanged,
} from '../shared/limits-display'
import type { StalledWork } from '../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../shared/stopped-work'
import type { WorkIncident } from '../shared/work-incidents'
import type { WaitingOnWhoWrote } from '../shared/waiting-on-who-wrote'
import type { WhoCalledWhom } from '../shared/who-called-whom'
import type { WorkspaceReading } from '../shared/workspace-reading'
import type { WhatIsBeingDone } from '../shared/what-is-being-done'

import type { TheWholeForest } from '../shared/the-whole-forest'
import type { DigestReading } from '../shared/digest'
import type { RecentActivityReading } from '../shared/recent-activity'
import { LAST_DRAFT_SAVE_CHANNEL, type SavedDrafts } from '../shared/saved-drafts'
import { LOCAL_ZONE_MOVED_CHANNEL, type LocalZone } from '../shared/local-time'
import {
  APP_CLOSING_CHANNEL,
  PROVIDERS_CHANGED_CHANNEL,
  RUNTIME_CHANGED_CHANNEL,
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  RUNTIME_LIVENESS_CHANNEL,
  RUNTIME_STATES_CHANNEL,
  type AdoptionReport,
  type ProvidersChangedMessage,
  type RuntimeStatesMessage,
  type ProcessMemory,
  type AnswerAck,
  type ApprovalModeDisclosure,
  type AuthState,
  type RuntimeChangeMessage,
  type ProviderAnswerAck,
  type ProviderProfileInput,
  type CheckProviderAuthInput,
  type ProviderSignInResult,
  type ReprovisionOutcome,
  type ProviderHomesReprovision,
  type CreateSessionInput,
  type ExportAsked,
  type ExportedSession,
  type EarlierHistoryInput,
  type HistoryWindow,
  type ChildWorkInput,
  type ChildSendResult,
  type ChildStateResult,
  type ChildWorkResult,
  type ResourceReading,
  type ResourceDrawing,
  type ResourceReveal,
  type FilesKept,
  type FilesKeptScope,
  type WorkflowOutputResult,
  type InstructionSourceResult,
  type RevealResult,
  type MessagePath,
  type MessagePathAsk,
  type MessagePathTarget,
  type OpenMessagePathResult,
  type ConfigFileResult,
  type SessionPathTarget,
  type CommandTail,
  type ToolAnswer,
  type ChosenAttachment,
  type DroppedPathVerdict,
  type ImportedBundle,
  type ImportedFromHome,
  type ImportedRecording,
  type RebuiltLedger,
  type LibraryPage,
  type LibraryQuery,
  type Provider,
  type ProviderCapabilityMap,
  type ProviderConfigInfo,
  type RespondPermissionInput,
  type ResumableSessionInfo,
  type ReleasedSession,
  type ResumedSession,
  type LookInput,
  type ResumeInput,
  type StartAndSendInput,
  type FirstMessageAnswer,
  type LaunchInput,
  type RespondUserInputInput,
  type AnswerActionInput,
  type RuntimeBridge,
  type RuntimeCommand,
  type RuntimeCommandKind,
  type RuntimeCommandResult,
  type RuntimeEventMessage,
  type SendInput,
  type CancelQueuedMessageInput,
  type QueueOutcome,
  type SessionLivenessMessage,
  type SessionInput,
  type StopBackgroundWorkInput,
  type EndPlanModeInput,
  type ChosenCwd,
  type SetApprovalModeInput,
  type SetSessionSettingInput,
  type UnresumableSessionInfo,
  type CwdVerdict,
  type AgentIdentities,
  type AgentIdentity,
  type NewAgent,
} from '../shared/runtime-ipc'
import type { InstructionAskWaiting } from '../shared/own-instructions'
import type {
  MemoryAmendmentAsked,
  MemoryUndoAsked,
  MemoryCheckAsked,
} from '../shared/agent-memory'

/**
 * Minimal typed IPC bridge. contextIsolation is on, so contextBridge is what
 * isolates the renderer from Node and the full ipcRenderer — the renderer only
 * sees this small `api` surface on `window`. We also freeze it preload-side.
 *
 * The preload deliberately holds no logic: it names channels, shapes commands, and
 * hands the renderer the event payload **only** — never the `IpcRendererEvent`,
 * which carries a privileged `sender`. Validation lives in the main process, which
 * is both the trust boundary and the only side that may hold the runtime's zod
 * schemas: this preload is sandboxed and cannot `require` a bare dependency.
 */

if (process.isMainFrame) themeBeforePaint(ipcRenderer)

/**
 * Send one command; it answers what `RuntimeCommandResults` says that command answers, the
 * same map main's dispatch is checked against, so a reply typed one way on one side and another way
 * on the other does not typecheck. The one cast is the wire's own: `invoke` answers `any`.
 */
function command<K extends RuntimeCommandKind>(
  payload: Extract<RuntimeCommand, { kind: K }> & { kind: K },
): Promise<RuntimeCommandResult<K>> {
  return ipcRenderer.invoke(RUNTIME_COMMAND_CHANNEL, payload) as Promise<RuntimeCommandResult<K>>
}

const runtime: RuntimeBridge = Object.freeze({
  skills: (request: SkillsRequest): Promise<SkillsReply> => command({ kind: 'skills', request }),
  // 🔴 **716 · one verb, two answers** — an input that asks for its refusal ANSWERED
  // (`answerARefusal`, `710` F-7) is handed over whole, and the bridge's signature types what comes
  // back. ⚑ Still the literal this preload builds, around a primitive it did not.
  createSession: ((input: CreateSessionInput & { readonly answerARefusal?: true }) =>
    command({ kind: 'createSession', ...input })) as RuntimeBridge['createSession'],

  send: (input: SendInput): Promise<void> => command({ kind: 'send', ...input }),
  sendInterrupting: (input: SendInput): Promise<void> =>
    command({ kind: 'sendInterrupting', ...input }),
  queueMessage: (input: SendInput): Promise<QueueOutcome> =>
    command({ kind: 'queueMessage', ...input }),
  cancelQueuedMessage: (input: CancelQueuedMessageInput): Promise<void> =>
    command({ kind: 'cancelQueuedMessage', ...input }),
  takeBackAndStop: (input: CancelQueuedMessageInput): Promise<void> =>
    command({ kind: 'takeBackAndStop', ...input }),

  respondPermission: (input: RespondPermissionInput): Promise<ProviderAnswerAck> =>
    command({ kind: 'respondPermission', ...input }),

  resolveLink: (target: string): Promise<LinkResolution> =>
    command({ kind: 'resolveLink', target }),
  decideMoveRequest: (input: DecideMoveRequestInput): Promise<MoveRequestAck> =>
    command({ kind: 'decideMoveRequest', ...input }),
  respondUserInput: (input: RespondUserInputInput): Promise<ProviderAnswerAck> =>
    command({ kind: 'respondUserInput', ...input }),
  /** A person's answer to a to-do an agent asked of them. */
  answerAction: (input: AnswerActionInput): Promise<AnswerAck> =>
    command({ kind: 'answerAction', ...input }),

  interrupt: (input: SessionInput): Promise<void> => command({ kind: 'interrupt', ...input }),

  stopBackgroundWork: (input: StopBackgroundWorkInput): Promise<boolean> =>
    command({ kind: 'stopBackgroundWork', ...input }),

  close: (input: SessionInput): Promise<void> => command({ kind: 'close', ...input }),

  refreshConfig: (input: SessionInput): Promise<ProviderConfigInfo> =>
    command({ kind: 'refreshConfig', ...input }),

  setApprovalMode: (input: SetApprovalModeInput): Promise<ApprovalModeDisclosure> =>
    command({ kind: 'setApprovalMode', ...input }),
  endPlanMode: (input: EndPlanModeInput): Promise<void> =>
    command({ kind: 'endPlanMode', ...input }),
  setSessionSetting: (input: SetSessionSettingInput): Promise<SessionSettingChanged> =>
    command({ kind: 'setSessionSetting', ...input }),

  listResumable: (): Promise<ResumableSessionInfo[]> => command({ kind: 'listResumable' }),
  listUnresumable: (): Promise<UnresumableSessionInfo[]> => command({ kind: 'listUnresumable' }),
  adoptSessions: (): Promise<AdoptionReport> => command({ kind: 'adoptSessions' }),
  // 633 · ⚑ `{ kind, ...input }` like every verb beside it, and the payload is primitives — a slug,
  // a kind word, and for one kind a STRING the renderer composed. ⛔ **`body` is the largest thing
  // this app puts on the wire**, and it is still a primitive: `the-bridge-that-clones-nothing.test.ts`
  // files it as `plain-by-construction` on both halves of `363`'s question.
  exportSession: (input: ExportAsked): Promise<ExportedSession> =>
    command({ kind: 'exportSession', ...input }),
  /** ⛔ The other half of the loop (214 §1) — a bundle brought back, or the reason it was not. */
  importBundleFile: (input: { path: string }): Promise<ImportedBundle> =>
    command({ kind: 'importBundleFile', ...input }),

  resume: (input: ResumeInput): Promise<ResumedSession> => command({ kind: 'resume', ...input }),
  /** ⚑ **D-017b** — draw one conversation in this window, whether or not anything runs it; starts nothing. */
  look: (input: LookInput): Promise<ResumedSession> => command({ kind: 'look', ...input }),
  stopLooking: (input: SessionInput): Promise<void> => command({ kind: 'stopLooking', ...input }),
  /** ⚑ **D-017b** — a person's message from a conversation's view and the start it causes, in one act. */
  startAndSend: (input: StartAndSendInput): Promise<FirstMessageAnswer> =>
    command({ kind: 'startAndSend', ...input }),
  cancelLaunch: (input: LaunchInput): Promise<boolean> =>
    command({ kind: 'cancelLaunch', ...input }),
  attachOpen: (): Promise<ResumedSession[]> => command({ kind: 'attachOpen' }),
  /** Take over a conversation nobody owns (336) — the other side of a session created with no window. */
  claim: (input: SessionInput): Promise<ResumedSession> => command({ kind: 'claim', ...input }),
  /** Hand a conversation back to nobody (523) — the inverse of the claim above. */
  release: (input: SessionInput): Promise<ReleasedSession> =>
    command({ kind: 'release', ...input }),
  /**
   * What a PERSON has been left holding (398, criterion 11) — every routed question a deadline has
   * already escalated, with the chain that says who is waiting on whom.
   *
   * ⚠️ **A read that names no conversation.** Answering one is unchanged and is still
   * `respondUserInput` on the child, where the card is.
   */
  questionsForAPerson: (): Promise<LedgerWalk<PersonsQuestion>> =>
    command({ kind: 'questionsForAPerson' }),
  /**
   * What only a person may settle (403) — every open routed request that never travelled, with
   * the one hop that names the conversation frozen on it.
   *
   * ⚠️ **The second reader, not a widening of the first.** A question that escalated and a request
   * that was never anybody else's to answer are two populations with two guarantees.
   */
  decisionsForAPerson: (): Promise<LedgerWalk<PersonsDecision>> =>
    command({ kind: 'decisionsForAPerson' }),
  /**
   * Which providers have walled, and when work comes back (533) — every limit still standing,
   * folded to one row per provider and window before it crosses.
   *
   * ⚠️ **The THIRD reader of the one look, and the only one that is not a thing a person owes.**
   * A wall ends when the provider says so — its clock, or its next answer (`586`) — never when a
   * person presses anything; what this carries is the difference between an agent that stopped and
   * an agent that is stuck.
   */
  limitsForAPerson: (): Promise<LedgerWalk<ProviderLimitSeen>> =>
    command({ kind: 'limitsForAPerson' }),
  readLimitsDisplay: (): Promise<LimitsDisplayAnswer> => command({ kind: 'readLimitsDisplay' }),
  onLimitsDisplayChanged: (listener: (message: LimitsDisplayChanged) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: LimitsDisplayChanged): void =>
      listener(message)
    ipcRenderer.on(LIMITS_DISPLAY_CHANGED_CHANNEL, handler)
    return () => ipcRenderer.removeListener(LIMITS_DISPLAY_CHANGED_CHANNEL, handler)
  },
  /**
   * ⚠️ **The FOURTH reader of the one look, and the second that is not a thing a person owes an
   * answer to** (557). ⛔ It carries what nothing else can reach: work that stopped while the
   * conversation that gave it out was not running, which `555` §3.1 measured is told to nobody.
   */
  stalledWorkForAPerson: (): Promise<LedgerWalk<StalledWork>> =>
    command({ kind: 'stalledWorkForAPerson' }),
  /** This run's publisher, which every stamped answer and notice names. */
  currentEpoch: (): Promise<PublicationEpoch> => command({ kind: 'currentEpoch' }),
  /** The person's queue as one stamped publication: eight parts, each with its own coverage. */
  personsQueue: (): Promise<PersonsQueueAnswer> => command({ kind: 'personsQueue' }),
  /** Both halves of the listing as one stamped publication. */
  listConversations: (): Promise<ListingAnswer> => command({ kind: 'listConversations' }),
  /** Work whose holder stopped with it, its giver told: to look at or hand back. */
  stoppedWorkForAPerson: (): Promise<LedgerWalk<StoppedWorkForAPerson>> =>
    command({ kind: 'stoppedWorkForAPerson' }),
  /** The open pieces no other list shows a person, with what is wrong with each. */
  workIncidentsForAPerson: (): Promise<LedgerWalk<WorkIncident>> =>
    command({ kind: 'workIncidentsForAPerson' }),
  /**
   * ⚑ **F097 · the work whose agent answered a person and waits on their next words** — owed by a
   * person, so *Waiting on you* lists it and the rail's badge counts it.
   */
  waitingOnWhoWroteForAPerson: (): Promise<LedgerWalk<WaitingOnWhoWrote>> =>
    command({ kind: 'waitingOnWhoWroteForAPerson' }),
  /**
   * ⚑ **D-017 · R19 — every ask against an identity's instructions nobody has answered**, whichever
   * conversation made it: *Waiting on you* reads it here, never from the conversations it holds.
   */
  instructionAsksForAPerson: (): Promise<readonly InstructionAskWaiting[]> =>
    command({ kind: 'instructionAsksForAPerson' }),
  /** Every agent's request to register an MCP server that waits on a person. */
  mcpServerRequestsForAPerson: (): Promise<readonly McpServerRequestForAPerson[]> =>
    command({ kind: 'mcpServerRequestsForAPerson' }),
  /**
   * The work this conversation gave out (508) — every piece, wherever it went, with the walk that
   * says how many ledgers were read and how many rows could not be.
   *
   * ⛔ **The field is spelled, not spread** — `plain-by-construction` is a property of THIS line:
   * the call site writes the outer literal and the one field it did not build is a string.
   */
  workGivenBy: (input: { sessionId: string }): Promise<LedgerWalk<WorkGivenOut>> =>
    command({
      kind: 'workGivenBy',
      sessionId: input.sessionId,
    }),
  /**
   * Who called whom, for one conversation (543) — who started it, what it started, and what work
   * passed between them, in ids that name CONVERSATIONS.
   *
   * ⛔ **The field is spelled, not spread** — `plain-by-construction` is a property of THIS line:
   * the call site writes the outer literal and the one field it did not build is a string.
   */
  whoCalledWhom: (input: { sessionId: string }): Promise<WhoCalledWhom> =>
    command({
      kind: 'whoCalledWhom',
      sessionId: input.sessionId,
    }),
  /**
   * Two counts and one moment (567) — how much is open and how much needs a person, as of one
   * stated moment.
   *
   * ⛔ **`nothing` on `HOW_EACH_VERB_IS_BUILT`, and the literal is the whole payload**: there is no
   * field for a call site to build or hand over, so there is nothing here a reactive value could
   * ride in on.
   */
  readWorkspace: (): Promise<WorkspaceReading> => command({ kind: 'readWorkspace' }),
  /**
   * What each conversation this app is running was last told it is doing (575) — the whole live
   * population, as of one stated moment.
   *
   * ⛔ **`nothing` on `HOW_EACH_VERB_IS_BUILT`, for the line above's reason and one more**: a set
   * of agents would have been an ARRAY, which is a payload to clone and a bound somebody owes, and
   * the answer is the whole population precisely so no caller has to name one.
   */
  whatIsBeingDone: (): Promise<WhatIsBeingDone> => command({ kind: 'whatIsBeingDone' }),
  /**
   * 🔴 **What each conversation this app is running is WAITING ON** (621) — the whole population,
   * as of one stated moment.
   *
   * ⛔ **`nothing` on `HOW_EACH_VERB_IS_BUILT`, for the line above's reasons exactly**: no fields
   * at all, so there is no payload to clone and no array a caller could make unbounded.
   */
  whatEachConversationIsWaitingOn: (): Promise<WhatEachConversationIsWaitingOn> =>
    command({
      kind: 'whatEachConversationIsWaitingOn',
    }),
  /**
   * 🔴 **The whole forest, from the person down** (637) — every conversation this app placed, where
   * each one hangs, and the work each one holds.
   *
   * ⛔ **`nothing` on `HOW_EACH_VERB_IS_BUILT`, for the two lines above's reasons exactly**: no
   * fields at all, so there is no payload to clone and no array a caller could make unbounded.
   */
  theWholeForest: (): Promise<TheWholeForest> => command({ kind: 'theWholeForest' }),
  /**
   * 🔴 **D-018 · the memory each running conversation's provider process holds** — for a person's
   * agent card, and never an agent's.
   *
   * ⛔ **`nothing` on `HOW_EACH_VERB_IS_BUILT`, for the lines above's reasons exactly**: no fields
   * at all, so there is no payload to clone and no pid a caller could name.
   */
  processMemory: (): Promise<ProcessMemory> => command({ kind: 'processMemory' }),
  /**
   * What the ledger recorded inside a window a person chose (438) — one reading over every
   * conversation an agent of this app holds, every line carrying whether the engine watched it or an
   * agent said it.
   */
  recentActivity: (input: { from: number; to: number }): Promise<RecentActivityReading> =>
    command({
      kind: 'recentActivity',
      from: input.from,
      to: input.to,
    }),
  digest: (from: number, to: number): Promise<DigestReading> =>
    command({ kind: 'digest', from, to }),

  listLibrary: (input: LibraryQuery): Promise<LibraryPage> =>
    command({ kind: 'listLibrary', ...input }),
  /** Fill in one recorded conversation's prior messages from its own provider file (119). */
  importRecordedSession: (input: SessionInput): Promise<ImportedRecording> =>
    command({ kind: 'importRecordedSession', ...input }),
  importUserHomeSession: (input: {
    provider: Provider
    providerSessionId: string
  }): Promise<ImportedFromHome> => command({ kind: 'importUserHomeSession', ...input }),
  rebuildLedger: (input: SessionInput): Promise<RebuiltLedger> =>
    command({ kind: 'rebuildLedger', ...input }),

  readWorkflowOutput: (input: SessionInput & { taskId: string }): Promise<WorkflowOutputResult> =>
    command({ kind: 'readWorkflowOutput', ...input }),
  // 356. One file the provider reported, read on request so it can open on the app's own paper.
  readInstructionSource: (
    input: SessionInput & { index: number },
  ): Promise<InstructionSourceResult> => command({ kind: 'readInstructionSource', ...input }),
  // 356. Reveal a path in the file manager. ⛔ The renderer names the row; main holds the string.
  revealPath: (input: SessionInput & { target: SessionPathTarget }): Promise<RevealResult> =>
    command({ kind: 'revealPath', ...input }),
  // 733. One config file, read on request so it can open on the app's own paper — by its NAME.
  readConfigFile: (input: SessionInput & { name: string }): Promise<ConfigFileResult> =>
    command({ kind: 'readConfigFile', ...input }),
  readCommandOutput: (input: SessionInput & { toolCallId: string }): Promise<CommandTail | null> =>
    command({ kind: 'readCommandOutput', ...input }),
  readToolAnswer: (input: SessionInput & { toolCallId: string }): Promise<ToolAnswer | null> =>
    command({ kind: 'readToolAnswer', ...input }),
  // 510. One resource, for the person whose row names it (D-016). ⛔ No session and no path — the
  // renderer hands back the id it drew, and main finds the file inside `resourcesRoot`.
  readResource: (input: { resourceId: string }): Promise<ResourceReading> =>
    command({ kind: 'readResource', ...input }),
  // D-032. A kept picture or PDF, and the same file shown in Finder — by the id alone, which is all
  // their strict schemas take.
  drawResource: (input: { resourceId: string }): Promise<ResourceDrawing> =>
    command({ kind: 'drawResource', resourceId: input.resourceId }),
  revealResource: (input: { resourceId: string }): Promise<ResourceReveal> =>
    command({ kind: 'revealResource', resourceId: input.resourceId }),
  // Paths a message wrote, named by their text: main resolves, opens or shows them.
  resolveMessagePaths: (input: MessagePathAsk): Promise<MessagePath[]> =>
    command({
      kind: 'resolveMessagePaths',
      sessionId: input.sessionId,
      texts: [...input.texts],
    }),
  openMessagePath: (input: MessagePathTarget): Promise<OpenMessagePathResult> =>
    command({
      kind: 'openMessagePath',
      sessionId: input.sessionId,
      text: input.text,
    }),
  revealMessagePath: (input: MessagePathTarget): Promise<RevealResult> =>
    command({
      kind: 'revealMessagePath',
      sessionId: input.sessionId,
      text: input.text,
    }),
  // D-026. The files kept in one scope, for a person — a tree, one conversation or one piece.
  filesKept: (input: FilesKeptScope): Promise<FilesKept> =>
    command({ kind: 'filesKept', ...input }),
  filesLibrary: (request: import('../shared/files-library').FilesLibraryRequest) =>
    command({ kind: 'filesLibrary', request }),
  teamProfileGraph: (request: import('../shared/team-profile-graph').TeamProfileGraphRequest) =>
    command({ kind: 'teamProfileGraph', request }),
  searchWork: (input: {
    conversation: string
    query: import('../shared/work-search').WorkSearchQuery
  }) => command({ kind: 'searchWork', ...input }),
  readChildWork: (input: SessionInput & ChildWorkInput): Promise<ChildWorkResult> =>
    command({ kind: 'readChildWork', ...input }),
  readChildState: (input: SessionInput & { agentId: string }): Promise<ChildStateResult> =>
    command({ kind: 'readChildState', ...input }),
  sendToChild: (
    input: SessionInput & { agentId: string; text: string },
  ): Promise<ChildSendResult> => command({ kind: 'sendToChild', ...input }),
  earlierHistory: (input: EarlierHistoryInput): Promise<HistoryWindow> =>
    command({ kind: 'earlierHistory', ...input }),
  latestHistory: (input: SessionInput): Promise<HistoryWindow> =>
    command({ kind: 'latestHistory', ...input }),
  capabilities: (): Promise<ProviderCapabilityMap> => command({ kind: 'capabilities' }),
  providerConnections: (): Promise<readonly ProviderConnection[]> =>
    command({ kind: 'providerConnections' }),
  // Which profiles exist (167) — the launcher's menu. Re-asked after a launch, because starting a
  // session in a name that was typed is what brings that profile into existence.
  profiles: (): Promise<string[]> => command({ kind: 'profiles' }),
  // Would the launch accept this folder (203). The typed half of 076 §3's picker — `chooseCwd`
  // answers for a folder that was CHOSEN, and until now nothing answered for one that was typed.
  checkCwd: (path: string): Promise<CwdVerdict> => command({ kind: 'checkCwd', path }),
  // ⚑ **`plain-by-construction` on both halves** (419, and 363's two questions): this wrapper builds
  // the outer literal itself, and every field it did NOT build — the slug, the display name and the
  // provider — is a `string | null`. ⛔ A fourth field of some other shape would make it
  // `handed-over`, and `the-bridge-that-clones-nothing.test.ts` is where somebody has to say so.
  createAgent: (input: NewAgent): Promise<AgentIdentity> =>
    command({ kind: 'createAgent', ...input }),
  // ⚑ **The capability door** (355). A person's read and a person's two writes; the main side
  // refuses all three unless the channel they arrived on declares a person behind it (349).
  agentIdentities: (): Promise<AgentIdentities> => command({ kind: 'agentIdentities' }),
  // 433 · ⚑ `{ kind, ...input }` like every configuration verb beside it, and the payload is two
  // primitives — a slug and a word or null — so `the-bridge-that-clones-nothing.test.ts` files it
  // as `plain-by-construction` on both halves of `363`'s question.
  setAgentProvider: (input: { profileId: string; provider: Provider | null }) =>
    command({ kind: 'setAgentProvider', ...input }),
  // 558 · ⚑ `{ kind, ...input }` and the payload is two primitives — a slug and a string or null —
  // so it is `plain-by-construction` on both halves of `363`'s question, exactly as its neighbour
  // above is.
  setAgentDisplayName: (input: { profileId: string; displayName: string | null }) =>
    command({ kind: 'setAgentDisplayName', ...input }),
  // D-016 · commit 7 · R4 · ⚑ `{ kind, ...input }` and two primitives — a label or id and a title —
  // so it is `plain-by-construction` on both halves of `363`'s question, as its neighbour above is.
  retitleWork: (input: { piece: string; title: string }) =>
    command({ kind: 'retitleWork', ...input }),
  takeBackWork: (input: { piece: string }) => command({ kind: 'takeBackWork', ...input }),
  closeWork: (input: { piece: string }) => command({ kind: 'closeWork', ...input }),
  // 677 · ⚑ `{ kind, ...input }` and the payload is four primitives — a slug, a provider word or null,
  // and two strings or null — so it is `plain-by-construction` on both halves of `363`'s question,
  // exactly as `setAgentProvider` above is. ⚠️ Flat on purpose: a nested `choice` object here would
  // be a field this call site did not build, and the door would become `handed-over`.
  setAgentModelAndEffort: (input: {
    profileId: string
    provider: Provider | null
    model: string | null
    effort: string | null
  }) => command({ kind: 'setAgentModelAndEffort', ...input }),
  // 677 · ⚑ One primitive, built here — `agentInstructions`' shape.
  agentModelAndEffort: (input: { profileId: string }) =>
    command({ kind: 'agentModelAndEffort', ...input }),
  // ⚑ **D-042 · the model list's three doors** — each payload built here, so
  // `plain-by-construction` on both halves: each spreads its primitives (`{ kind, ...input }`).
  modelList: (input: { provider: Provider; profileId?: string }) =>
    command({ kind: 'modelList', ...input }),
  addHandAddedModel: (input: { provider: Provider; model: string }) =>
    command({ kind: 'addHandAddedModel', ...input }),
  deleteHandAddedModel: (input: { provider: Provider; model: string }) =>
    command({ kind: 'deleteHandAddedModel', ...input }),
  apiKeyStatus: (input: { provider: Provider }) => command({ kind: 'apiKeyStatus', ...input }),
  setApiKey: (input: { provider: Provider; key: string }) =>
    command({ kind: 'setApiKey', ...input }),
  removeApiKey: (input: { provider: Provider }) => command({ kind: 'removeApiKey', ...input }),
  checkApiKey: (input: { provider: Provider }) => command({ kind: 'checkApiKey', ...input }),
  providerVersions: () => command({ kind: 'providerVersions' }),
  keptRules: () => command({ kind: 'keptRules' }),
  removeKeptRule: (input: { provider: Provider; file: string; kept: string }) =>
    command({
      kind: 'removeKeptRule',
      provider: input.provider,
      file: input.file,
      kept: input.kept,
    }),
  providerSetup: () => command({ kind: 'providerSetup' }),
  providerUsage: () => command({ kind: 'providerUsage' }),
  providerResources: () => command({ kind: 'providerResources' }),
  // 558 · ⚑ One primitive, built here. The ANSWER is a union with a `held` array in one arm, and
  // that is on the way back — which `the-bridge-that-clones-nothing.test.ts` does not ask about,
  // because its question is who builds what goes THROUGH the door.
  removeAgent: (input: { profileId: string }) => command({ kind: 'removeAgent', ...input }),
  // One primitive each, built here; the answers carry arrays, on the way back.
  archiveConversation: (input: { sessionId: string }) =>
    command({ kind: 'archiveConversation', ...input }),
  restoreConversation: (input: { sessionId: string }) =>
    command({ kind: 'restoreConversation', ...input }),
  checkDeleteConversation: (input: { sessionId: string }) =>
    command({ kind: 'checkDeleteConversation', ...input }),
  // The ticked ids are copied into a plain array here, so nothing but strings crosses the door.
  deleteConversation: (input: { sessionId: string; parts: string[] }) =>
    command({
      kind: 'deleteConversation',
      sessionId: input.sessionId,
      parts: [...input.parts],
    }),
  // 582 · ⚑ `{ kind, ...input }` and the payload is three primitives — a slug, a string and an
  // optional number — so it is `plain-by-construction` on both halves of `363`'s question, exactly
  // as `setAgentDisplayName` above is.
  instructAgent: (input: {
    profileId: string
    text: string
    broughtBack?: number
    baseline?: RulesBaseline
  }) => command({ kind: 'instructAgent', ...input }),
  // 582 · ⚑ One primitive, built here. The ANSWER carries arrays, and that is on the way back —
  // which `the-bridge-that-clones-nothing.test.ts` does not ask about, for `removeAgent`'s reason.
  agentInstructions: (input: { profileId: string }) =>
    command({ kind: 'agentInstructions', ...input }),
  agentMethods: (input: Parameters<RuntimeBridge['agentMethods']>[0]) =>
    command({
      kind: 'agentMethods',
      profileId: input.profileId,
      offset: input.offset,
      limit: input.limit,
    }),
  agentMethodBody: (input: Parameters<RuntimeBridge['agentMethodBody']>[0]) =>
    command({
      kind: 'agentMethodBody',
      profileId: input.profileId,
      key: input.key,
    }),
  agentMethodChanges: (input: Parameters<RuntimeBridge['agentMethodChanges']>[0]) =>
    command({
      kind: 'agentMethodChanges',
      profileId: input.profileId,
      offset: input.offset,
      limit: input.limit,
    }),
  removeAgentMethod: (input: Parameters<RuntimeBridge['removeAgentMethod']>[0]) =>
    command({
      kind: 'removeAgentMethod',
      profileId: input.profileId,
      selection: {
        confirmed: input.selection.confirmed,
        key: input.selection.key,
      },
    }),
  undoAgentMethod: (input: Parameters<RuntimeBridge['undoAgentMethod']>[0]) =>
    command({
      kind: 'undoAgentMethod',
      profileId: input.profileId,
      changeId: input.changeId,
    }),
  checkInterruptedAgentMethods: (
    input: Parameters<RuntimeBridge['checkInterruptedAgentMethods']>[0],
  ) =>
    command({
      kind: 'checkInterruptedAgentMethods',
      profileId: input.profileId,
      confirmed: input.confirmed,
    }),
  agentOwnNotes: (input: { profileId: string }) => command({ kind: 'agentOwnNotes', ...input }),
  agentOwnNotesUnread: (input: { profileId: string }) =>
    command({ kind: 'agentOwnNotesUnread', ...input }),
  saveOwnNotes: (input: { profileId: string } & OwnNotesWrite) =>
    command({ kind: 'saveOwnNotes', ...input }),
  undoOwnNotes: (input: { profileId: string; expectedVersion: number }) =>
    command({ kind: 'undoOwnNotes', ...input }),
  markOwnNotesSeen: (input: { profileId: string; throughVersion: number }) =>
    command({ kind: 'markOwnNotesSeen', ...input }),
  agentRulesUnread: (input: { profileId: string }) =>
    command({ kind: 'agentRulesUnread', ...input }),
  undoAgentRules: (input: { profileId: string; expectedVersion: number }) =>
    command({ kind: 'undoAgentRules', ...input }),
  markAgentRulesSeen: (input: { profileId: string; throughVersion: number }) =>
    command({ kind: 'markAgentRulesSeen', ...input }),
  // 625 · ⚑ One primitive, built here. The ANSWER carries arrays, and that is on the way back —
  // which `the-bridge-that-clones-nothing.test.ts` does not ask about, for `removeAgent`'s reason.
  agentMemory: (input: { profileId: string; offset?: number; limit?: number }) =>
    command({ kind: 'agentMemory', ...input }),
  // F093 · ⚑ One primitive, built here, like `look`; the answer carries arrays, on the way back.
  whatThisAgentWasGiven: (sessionId: string) =>
    command({ kind: 'whatThisAgentWasGiven', sessionId }),
  // F093 · C9 d · ⚑ One primitive and a number, built here; the answer carries arrays, on the way back.
  whatTheModelGot: (sessionId: string, ordinal: number) =>
    command({ kind: 'whatTheModelGot', sessionId, ordinal }),
  // 625 · ⚑ `{ kind, ...input }` like every configuration verb beside it, and the payload is four
  // primitives — a slug, a provider word, an entry string and an act word, plus the text — so
  // `the-bridge-that-clones-nothing.test.ts` files it as `plain-by-construction` on both halves of
  // `363`'s question. ⛔ **`entry` is a STRING this app produced and it is never opened**: main
  // looks it up in a store it re-derives, so nothing reactive and nothing of the renderer's reaches
  // a filesystem call.
  amendAgentMemory: (input: MemoryAmendmentAsked) =>
    command({
      kind: 'amendAgentMemory',
      profileId: input.profileId,
      provider: input.provider,
      entry: input.entry,
      act: input.act,
      text: input.text,
      confirmed: input.confirmed,
    }),
  undoAgentMemory: (input: MemoryUndoAsked) =>
    command({
      kind: 'undoAgentMemory',
      profileId: input.profileId,
      sourceId: input.sourceId,
      confirmed: input.confirmed,
    }),
  checkInterruptedMemory: (input: MemoryCheckAsked) =>
    command({
      kind: 'checkInterruptedMemory',
      profileId: input.profileId,
      confirmed: input.confirmed,
    }),
  // 582 · ⚑ Two primitives, built here.
  decideInstruction: (input: { askId: string; approve: boolean }) =>
    command({ kind: 'decideInstruction', ...input }),
  decideMcpServerRequest: (input: { requestId: string; approve: boolean }) =>
    command({ kind: 'decideMcpServerRequest', ...input }),
  setCapabilities: (input: {
    profileId: string
    grant: CapabilityGrant
    externalMcpServerIds: readonly string[]
  }): Promise<AgentIdentity | null> => command({ kind: 'setCapabilities', ...input }),
  // ⚑ **516 · the registry's two writes** (HO-040 §4.2). `{ kind, ...input }` like every
  // configuration verb beside them, and both payloads are strings — so
  // `the-bridge-that-clones-nothing.test.ts` files them as `plain-by-construction` on both halves of
  // `363`'s question. ⛔ The door refuses either unless the channel declares a person behind it.
  registerExternalMcpServer: (input: {
    name: string
    url: string
    /** ⚑ **524 · a literal out of a closed vocabulary** — still a primitive, so `363`'s answer holds. */
    reach: ExternalMcpServerReach
  }): Promise<ExternalMcpServerRow> => command({ kind: 'registerExternalMcpServer', ...input }),
  removeExternalMcpServer: (input: { serverId: string }): Promise<boolean> =>
    command({ kind: 'removeExternalMcpServer', ...input }),
  setSpawningEnabled: (input: { enabled: boolean }): Promise<{ spawningEnabled: boolean }> =>
    command({ kind: 'setSpawningEnabled', ...input }),
  setServicesOn: (input: { on: boolean }): Promise<{ servicesOn: boolean }> =>
    command({ kind: 'setServicesOn', ...input }),
  setDefaultApprovalMode: (input: {
    mode: 'ask' | 'auto'
  }): Promise<{ defaultApprovalMode: 'ask' | 'auto' }> =>
    command({ kind: 'setDefaultApprovalMode', ...input }),

  onLiveness: (listener: (message: SessionLivenessMessage) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, message: SessionLivenessMessage): void =>
      listener(message)
    ipcRenderer.on(RUNTIME_LIVENESS_CHANNEL, forward)
    return () => {
      ipcRenderer.off(RUNTIME_LIVENESS_CHANNEL, forward)
    }
  },

  checkProviderAuth: (input: CheckProviderAuthInput): Promise<AuthState> =>
    command({ kind: 'checkProviderAuth', ...input }),
  reprovisionProviderHomes: (input: {
    provider: Provider
    statusOnly?: boolean
  }): Promise<ProviderHomesReprovision> => command({ kind: 'reprovisionProviderHomes', ...input }),
  reprovisionProviderAuth: (input: ProviderProfileInput): Promise<ReprovisionOutcome> =>
    command({ kind: 'reprovisionProviderAuth', ...input }),
  signInProvider: (input: ProviderProfileInput): Promise<ProviderSignInResult> =>
    command({ kind: 'signInProvider', ...input }),
  cancelProviderSignIn: (input: ProviderProfileInput): Promise<void> =>
    command({ kind: 'cancelProviderSignIn', ...input }),

  onEvent: (listener: (message: RuntimeEventMessage) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, message: RuntimeEventMessage): void =>
      listener(message)
    ipcRenderer.on(RUNTIME_EVENT_CHANNEL, forward)
    return () => {
      ipcRenderer.off(RUNTIME_EVENT_CHANNEL, forward)
    }
  },

  /**
   * 🔴 **Something this window lists has moved** (534) — see {@link RUNTIME_CHANGED_CHANNEL}.
   *
   * ⚠️ **The forwarder drops the `IpcRendererEvent` like every other one here**: it carries a
   * privileged `sender` and the renderer is never handed one. ⛔ **And the message is passed
   * through rather than validated**, which is `onEvent`'s and `onLiveness`' shape: main is the only
   * sender on this channel, and a preload that re-derived the vocabulary would be a second place it
   * is written down. The renderer's subscriber refuses a subject it does not know — see
   * `renderer/src/lib/the-world-moved.ts`.
   */
  onChanged: (listener: (message: RuntimeChangeMessage) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, message: RuntimeChangeMessage): void =>
      listener(message)
    ipcRenderer.on(RUNTIME_CHANGED_CHANNEL, forward)
    return () => {
      ipcRenderer.off(RUNTIME_CHANGED_CHANNEL, forward)
    }
  },

  /**
   * ⚑ **A provider's login or usage moved** — see {@link PROVIDERS_CHANGED_CHANNEL}. ⚑ `onChanged`'s
   * forwarder, for its reasons.
   */
  onProvidersChanged: (listener: (message: ProvidersChangedMessage) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, message: ProvidersChangedMessage): void =>
      listener(message)
    ipcRenderer.on(PROVIDERS_CHANGED_CHANNEL, forward)
    return () => {
      ipcRenderer.off(PROVIDERS_CHANGED_CHANNEL, forward)
    }
  },

  /**
   * 🔴 **D-019 · what an agent is doing moved, and, D-026, which files were kept** — see
   * {@link RUNTIME_STATES_CHANNEL}. ⚑ `onChanged`'s forwarder, for its reasons: the
   * `IpcRendererEvent` is dropped, and the message is passed through rather than validated, because
   * main is the only sender on this channel.
   */
  onStates: (listener: (message: RuntimeStatesMessage) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, message: RuntimeStatesMessage): void =>
      listener(message)
    ipcRenderer.on(RUNTIME_STATES_CHANNEL, forward)
    return () => {
      ipcRenderer.off(RUNTIME_STATES_CHANNEL, forward)
    }
  },
})

const api = Object.freeze({
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  /** The page's own freeze report, for the stall log; main says what it did with it. */
  recordPagePerformance: (report: PagePerformanceReport): Promise<PageReportAnswer> =>
    ipcRenderer.invoke(RUNTIME_COMMAND_CHANNEL, {
      kind: PAGE_RECEIPT_KIND,
      version: 1,
      sequence: report.sequence,
      visibility: report.visibility,
      samples: report.samples.map((one) => ({
        kind: one.kind,
        startMs: one.startMs,
        durationMs: one.durationMs,
        count: one.count,
        surface: one.surface,
        component: one.component,
        attribution: one.attribution,
        input: one.input,
        conversation: one.conversation,
        loadedItems: one.loadedItems,
        fileCount: one.fileCount,
        contextUsed: one.contextUsed,
      })),
      health:
        report.health === null
          ? null
          : {
              observing: report.health.observing,
              entries: report.health.entries,
              probes: report.health.probes,
            },
      dropped: report.dropped,
    }) as Promise<PageReportAnswer>,
  /**
   * 🔴 **744 · R100 — the drafts the last run left** in the app's own userData, each for its own
   * slot; a conversation that no longer exists is already dropped, and a path that is gone is marked
   * `missing`. Asked once, before the window draws. ⛔ `null` when the file is there and cannot be
   * read — and then nothing may be saved over it.
   */
  savedDrafts: (): Promise<SavedDrafts | null> =>
    ipcRenderer.invoke('app:saved-drafts') as Promise<SavedDrafts | null>,
  /**
   * 🔴 **744 · R100 — keep the whole draft book** — written to the app's own userData and nowhere
   * else. ⚠️ **One argument the renderer built from primitives**: a Vue proxy cannot cross this
   * bridge, which is why `kept-drafts.ts` copies every field out before it calls this.
   */
  saveDrafts: (saved: SavedDrafts): Promise<void> =>
    ipcRenderer.invoke('app:save-drafts', saved) as Promise<void>,
  /**
   * 🔴 **744 · the quit has closed the conversations and asks for the book once more** — see
   * {@link LAST_DRAFT_SAVE_CHANNEL}. ⚠️ No payload reaches the listener, like `onClosing`.
   */
  onLastDraftSave: (listener: () => void): (() => void) => {
    const forward = (): void => listener()
    ipcRenderer.on(LAST_DRAFT_SAVE_CHANNEL, forward)
    return () => {
      ipcRenderer.off(LAST_DRAFT_SAVE_CHANNEL, forward)
    }
  },
  /**
   * 🔴 **D-031 · the Mac's own time zone**, read by main off the file the Mac's clock reads, so the
   * window says a time as the menu bar does. Asked once, before the window draws. ⚑ `null` when
   * main could not read it: the window then says times in its own zone data, as main does.
   */
  localZone: (): Promise<LocalZone | null> =>
    ipcRenderer.invoke('app:local-zone') as Promise<LocalZone | null>,
  /**
   * 🔴 **D-031 · the Mac's time zone moved** — see {@link LOCAL_ZONE_MOVED_CHANNEL}. ⚑ `onStates`'
   * forwarder, for its reasons: the `IpcRendererEvent` is dropped, and the zone is passed through
   * rather than validated, because main is the only sender on this channel.
   */
  onLocalZone: (listener: (zone: LocalZone) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, zone: LocalZone): void => listener(zone)
    ipcRenderer.on(LOCAL_ZONE_MOVED_CHANNEL, forward)
    return () => {
      ipcRenderer.off(LOCAL_ZONE_MOVED_CHANNEL, forward)
    }
  },
  /** Open the native folder picker for a new conversation's cwd (076). */
  chooseCwd: (): Promise<ChosenCwd> => ipcRenderer.invoke('app:choose-cwd') as Promise<ChosenCwd>,
  /**
   * ⛔ **Open the native picker on a file or folder to hand the agent** (216 §2).
   *
   * `cwd` decides only whether the message will say the path is outside this conversation's working
   * directory — a caption, not a permission; `send` re-classifies against the session's real cwd.
   */
  chooseAttachment: (input: { cwd?: string } = {}): Promise<ChosenAttachment> =>
    ipcRenderer.invoke('app:choose-attachment', input) as Promise<ChosenAttachment>,
  /**
   * Re-decide the `outside` caption for paths already chosen, against a folder that has since
   * changed (217 §2). No dialog — the launcher's folder can move after a file is attached to it.
   *
   * ⚠️ **Captions only, and one answer per entry.** A path that cannot be classified keeps the
   * caption it had rather than disappearing — `send` is where a refusal belongs, by name, at the
   * moment it matters, and it can only refuse what is still in the list.
   */
  classifyAttachments: (input: { handed: HandedPath[]; cwd?: string }): Promise<HandedPath[]> =>
    ipcRenderer.invoke('app:classify-attachments', input) as Promise<HandedPath[]>,
  /**
   * ⛔ **Where a DROPPED file's path comes from** (218 §2) — and the only place it can come from.
   *
   * ⚠️ **`File.path` does not exist.** Electron removed it; the replacement is `webUtils`, which
   * lives in the PRELOAD and nowhere else. The window is `contextIsolation: true`, `sandbox: true`,
   * `nodeIntegration: false` (`main/index.ts`), so the renderer cannot reach `webUtils` itself — the
   * `File` has to cross this bridge to be turned into a path.
   *
   * ⚑ **That constraint is a gift.** `216`'s rule is that BroBot never opens the file, and the only
   * API available here RESOLVES A PATH rather than handing over bytes. The rule that was a
   * discipline in `216` is the path of least resistance in `218`: there is no `.text()` to
   * accidentally call, because the `File` never reaches anything that could call it.
   *
   * ⛔ **`''` is a real answer, not a failure.** Dragged text, a URL from a browser, an image from a
   * web page, a file on a remote volume — each produces a `File`-shaped thing with no path on this
   * machine, and `getPathForFile` says so by returning empty. ⚠️ The caller must REFUSE that with a
   * reason (`106`/`118`/`169`), not silently drop it; `PromptComposer` does.
   *
   * The `try` is for the other shape of the same answer: `getPathForFile` throws on something that
   * is not a `File` at all, and a throw across the bridge would surface as an unhandled rejection
   * rather than as a sentence. Both mean *"there is no path here"*.
   */
  pathForDroppedFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  /**
   * ⛔ **Classify paths nobody picked from a dialog** (218 §2) — the drop's half of the picker.
   *
   * ⚑ **The SAME classifier `app:choose-attachment` uses**, which is the whole of acceptance 7: the
   * dialog and the drop are two GESTURES that end in one rule. A drop that classified itself in the
   * renderer would be a second opinion about what a path is, and `197` spent a dispatch on exactly
   * that with two of them.
   *
   * ⚠️ **Refusals here, unlike {@link classifyAttachments}'s captions.** A drop is a gesture somebody
   * is waiting on, so *"there is nothing at that path"* belongs on screen now; the caption pass is a
   * re-check of something already chosen and stays silent.
   */
  handDroppedPaths: (input: { paths: string[]; cwd?: string }): Promise<DroppedPathVerdict[]> =>
    ipcRenderer.invoke('app:hand-dropped-paths', input) as Promise<DroppedPathVerdict[]>,
  /**
   * ⛔ **Write the clipboard's picture down and classify it, like any other path** (254 §2).
   *
   * ⚠️ **No bytes cross this bridge, in either direction.** The renderer knows only that a paste
   * carried an entry with no path on this machine; main reads the clipboard itself and answers with
   * a verdict — the same `{ handed } | { refusal }` a drop gets, from the same classifier.
   * ⚑ **That asymmetry is the rule, not an accident**: a pasted `File` is a byte source one
   * `.arrayBuffer()` away, and `no-byte-authority.test.ts` censuses this file for exactly that call.
   *
   * ⚠️ **One picture per invocation**, because `clipboard.readImage()` is one answer. The composer
   * says so out loud when a paste arrived with more than one pathless entry.
   */
  pasteImage: (input: { cwd?: string } = {}): Promise<DroppedPathVerdict> =>
    ipcRenderer.invoke('app:paste-image', input) as Promise<DroppedPathVerdict>,
  /**
   * Open the native file picker on a session bundle (214 §1), or null when it was cancelled.
   *
   * ⚑ **The same shape as `chooseCwd` and for the same reason** (076 §3): the picker is a
   * convenience over a field a person can also type into — a bundle that arrives by email is a path
   * you paste. Main owns the dialog and defaults it to the app's own exports directory, so the file
   * you just wrote is the first thing you see.
   */
  chooseBundle: (): Promise<string | null> =>
    ipcRenderer.invoke('app:choose-bundle') as Promise<string | null>,
  onNavigate: (listener: (direction: NavigationDirection) => void): (() => void) => {
    const forward = (_event: IpcRendererEvent, direction: unknown): void => {
      if (isNavigationDirection(direction)) listener(direction)
    }
    ipcRenderer.on(APP_NAVIGATE_CHANNEL, forward)
    return () => {
      ipcRenderer.off(APP_NAVIGATE_CHANNEL, forward)
    }
  },
  /**
   * 🔴 **The app is closing** (271 §2). See {@link APP_CLOSING_CHANNEL} for why it has a channel of
   * its own and why it is never withdrawn.
   *
   * ⚠️ **No payload reaches the listener**, like every other forwarder here: the `IpcRendererEvent`
   * carries a privileged `sender` and the renderer is never handed one.
   */
  onClosing: (listener: () => void): (() => void) => {
    const forward = (): void => listener()
    ipcRenderer.on(APP_CLOSING_CHANNEL, forward)
    return () => {
      ipcRenderer.off(APP_CLOSING_CHANNEL, forward)
    }
  },
  /**
   * 🔴 **Close, minimise, zoom — the window's own three controls** (385 §1).
   *
   * ⛔ **The window is `frame: false` now**, so these are not a convenience: they are the only
   * pointing gesture that closes this app. See `main/window-controls.ts` for the vocabulary, for
   * why the verbs are Electron's spelling, and for why the main side answers from the SENDER's
   * window rather than from a captured one.
   *
   * ⚠️ **One argument and it is a string from a closed set** — the whole payload, built here, no
   * field of it made by anybody else. Main refuses anything outside {@link WINDOW_CONTROLS} rather
   * than doing the nearest thing.
   */
  windowControl: (control: WindowControl): Promise<WindowControlEffect> =>
    ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL, control) as Promise<WindowControlEffect>,
  attentionSignals: (signal: AttentionSignal): Promise<void> =>
    ipcRenderer.invoke(ATTENTION_SIGNALS_CHANNEL, signal),
  recoveryRetention: Object.freeze({
    read: (): Promise<RetainedRecoveryCopy | null> =>
      ipcRenderer.invoke(RECOVERY_RETENTION_CHANNELS.read) as Promise<RetainedRecoveryCopy | null>,
    deleteNow: (id: string): Promise<void> =>
      ipcRenderer.invoke(RECOVERY_RETENTION_CHANNELS.delete, id),
  }),
  transcriptRetention: Object.freeze({
    read: (): Promise<TranscriptRetention> =>
      ipcRenderer.invoke(TRANSCRIPT_RETENTION_CHANNELS.read) as Promise<TranscriptRetention>,
    set: (period: TranscriptRetention): Promise<TranscriptRetention> =>
      ipcRenderer.invoke(TRANSCRIPT_RETENTION_CHANNELS.set, period) as Promise<TranscriptRetention>,
  }),
  dockLabel: Object.freeze({
    read: (): Promise<DockLabel> =>
      ipcRenderer.invoke(DOCK_LABEL_CHANNELS.read) as Promise<DockLabel>,
    set: (change: DockLabelChange): Promise<DockLabel> =>
      ipcRenderer.invoke(DOCK_LABEL_CHANNELS.set, change) as Promise<DockLabel>,
  }),
  runtime,
  themes: themesBridge(ipcRenderer),
  providerSetup: providerSetupBridge(ipcRenderer),
  plugins: pluginsBridge(ipcRenderer),
  storage: storageBridge(ipcRenderer),
  voice: voiceBridge(ipcRenderer, process.platform),
  /**
   * 🔴 **W4.109 · B1 — updates** (`main/updates.ts` decides; every call answers the new snapshot).
   * ⚑ `onChanged` is told every move: a check, a download's progress, a restart that waits.
   */
  updates: Object.freeze({
    read: (): Promise<UpdatesSnapshot> =>
      ipcRenderer.invoke(UPDATES_CHANNELS.read) as Promise<UpdatesSnapshot>,
    checkNow: (): Promise<UpdatesSnapshot> =>
      ipcRenderer.invoke(UPDATES_CHANNELS.checkNow) as Promise<UpdatesSnapshot>,
    set: (change: UpdatesSettingsChange): Promise<UpdatesSnapshot> =>
      ipcRenderer.invoke(UPDATES_CHANNELS.set, change) as Promise<UpdatesSnapshot>,
    download: (): Promise<UpdatesSnapshot> =>
      ipcRenderer.invoke(UPDATES_CHANNELS.download) as Promise<UpdatesSnapshot>,
    restartWhenQuiet: (): Promise<UpdatesSnapshot> =>
      ipcRenderer.invoke(UPDATES_CHANNELS.restartWhenQuiet) as Promise<UpdatesSnapshot>,
    cancelRestart: (): Promise<UpdatesSnapshot> =>
      ipcRenderer.invoke(UPDATES_CHANNELS.cancelRestart) as Promise<UpdatesSnapshot>,
    onChanged: (listener: (snapshot: UpdatesSnapshot) => void): (() => void) => {
      const forward = (_event: IpcRendererEvent, snapshot: UpdatesSnapshot): void =>
        listener(snapshot)
      ipcRenderer.on(UPDATES_CHANNELS.changed, forward)
      return () => {
        ipcRenderer.off(UPDATES_CHANNELS.changed, forward)
      }
    },
  }),
  /**
   * 🔴 **W4.131 · A2 — workspaces** (`main/workspaces.ts` decides): list them, open one, make one,
   * rename one, take one off the list — and, W4.151, delete one (`main/delete-workspace.ts`). ⛔ None
   * of this chooses where THIS window runs.
   */
  workspaces: Object.freeze({
    list: (): Promise<WorkspaceRow[]> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.list) as Promise<WorkspaceRow[]>,
    open: (path: string): Promise<WorkspaceOpened> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.open, path) as Promise<WorkspaceOpened>,
    create: (input: NewWorkspace): Promise<WorkspaceOpened> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.create, input) as Promise<WorkspaceOpened>,
    rename: (input: WorkspaceRename): Promise<WorkspaceChanged> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.rename, input) as Promise<WorkspaceChanged>,
    remove: (path: string): Promise<WorkspaceChanged> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.remove, path) as Promise<WorkspaceChanged>,
    checkFolder: (path: string, toMake = false): Promise<WorkspaceFolderVerdict | null> =>
      ipcRenderer.invoke(
        WORKSPACES_CHANNELS.checkFolder,
        path,
        toMake,
      ) as Promise<WorkspaceFolderVerdict | null>,
    folderFor: (name: string): Promise<string> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.folderFor, name) as Promise<string>,
    chooseFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.chooseFolder) as Promise<string | null>,
    checkDelete: (path: string): Promise<WorkspaceDeleteVerdict> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.checkDelete, path) as Promise<WorkspaceDeleteVerdict>,
    delete: (path: string): Promise<WorkspaceDeleted> =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.delete, path) as Promise<WorkspaceDeleted>,
  }),
  /**
   * 🔴 **W4.164 · F093 R3 — what a bundled provider puts in front of its model on its own**, as this
   * build captured it: by provider and the conversation's model (`null` for the default).
   */
  providerSnapshots: Object.freeze({
    list: (): Promise<SnapshotCatalogue[]> =>
      ipcRenderer.invoke(PROVIDER_SNAPSHOTS_CHANNELS.list) as Promise<SnapshotCatalogue[]>,
    forModel: (provider: Provider, model: string | null): Promise<SnapshotAnswer> =>
      ipcRenderer.invoke(
        PROVIDER_SNAPSHOTS_CHANNELS.forModel,
        provider,
        model,
      ) as Promise<SnapshotAnswer>,
  }),
})

contextBridge.exposeInMainWorld('api', api)

export type BrobotApi = typeof api
