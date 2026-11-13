import type { AgentIdentity } from '../agent-identity-contracts'
import type { AgentMemoryAmended, AgentMemoryReading, MemoryChecked } from '../agent-memory'
import type { AgentRemoved } from '../agent-roster'
import type { ArchiveOutcome, DeleteOutcome, DeleteVerdict } from '../conversation-archive'
import type { McpServerRequestForAPerson } from '../conversation-events'
import type {
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../conversation-listing-contracts'
import type { PublicationEpoch } from '../data-version'
import type { DigestReading } from '../digest'
import type { ExternalMcpServerRow } from '../external-mcp'
import type { LimitsDisplayAnswer } from '../limits-display'
import type { LinkResolution } from '../link-resolution'
import type { ListingAnswer } from '../listing-published'
import type {
  AgentModelChoice,
  ModelChoiceSaved,
  ModelList,
  SessionSettingChanged,
} from '../model-choice-contracts'
import type { MoveRequestAck } from '../move-contracts'
import type {
  AgentInstructionsReading,
  InstructionAskWaiting,
  InstructionUnread,
} from '../own-instructions'
import type { OwnNotesReading, OwnNotesUnread } from '../own-notes'
import type { PersonsQueueAnswer } from '../persons-published'
import type { WorkClosedByAPerson, WorkRetitled, WorkTakenBackByAPerson } from '../piece-called'
import type { ProviderLaunchChoices, ResolvedProviderLaunch } from '../provider-launch'
import type { ProviderLimitSeen } from '../provider-limit'
import type { LedgerWalk, PersonsDecision, PersonsQuestion } from '../question-contracts'
import type { RecentActivityReading } from '../recent-activity'
import type {
  MethodBody,
  MethodChangeResult,
  MethodHistoryResult,
  MethodLibrary,
} from '../saved-method-library'
import type { SkillsReply } from '../skills-window'
import type { StalledWork } from '../stalled-work'
import type { StoppedWorkForAPerson } from '../stopped-work'
import type { WhatEachConversationIsWaitingOn, WorkGivenOut } from '../task-contracts'
import type { ForestNodesPage, ForestReading } from '../the-whole-forest'
import type { WaitingOnWhoWrote } from '../waiting-on-who-wrote'
import type { WhatIsBeingDone } from '../what-is-being-done'
import type { WhatTheModelGot, WhatThisAgentWasGiven } from '../what-this-agent-was-given'
import type { WhoCalledWhom } from '../who-called-whom'
import type { WorkIncident } from '../work-incidents'
import type { WorkspaceReading } from '../workspace-reading'
import type { RuntimeCommandKind } from './commands'
import type { AgentIdentities } from './identity'
import type {
  AdoptionReport,
  ExportedSession,
  ImportedBundle,
  ImportedFromHome,
  ImportedRecording,
  LibraryPage,
  RebuiltLedger,
} from './library'
import type {
  ApiKeyChanged,
  ApiKeyStatus,
  KeptRuleRemoved,
  KeptRules,
  ProviderCapabilityMap,
  ProviderConfigInfo,
  ProviderHomesReprovision,
  ProviderResources,
  ProviderSignInResult,
  ProviderUsageReading,
} from './providers'
import type {
  ChildSendResult,
  ChildStateResult,
  ChildWorkResult,
  ConfigFileResult,
  FilesKept,
  InstructionSourceResult,
  MessagePath,
  OpenMessagePathResult,
  ResourceDrawing,
  ResourceReading,
  ResourceReveal,
  RevealResult,
  WorkflowOutputResult,
} from './resources'
import type {
  AgentProviderSet,
  AnswerAck,
  ApprovalModeDisclosure,
  CreatedSession,
  CwdVerdict,
  FirstMessageAnswer,
  HistoryWindow,
  ProcessMemory,
  ProviderAnswerAck,
  QueueOutcome,
  RefusedLaunch,
  ReleasedSession,
  ResumedSession,
} from './sessions'
import type {
  AuthState,
  CommandTail,
  ProviderSetup,
  ReprovisionOutcome,
  ToolAnswer,
} from '@brobot2/runtime'
import type { ApiKeyCheck, ProviderVersion } from '@brobot2/runtime/provider-module'
import type { Provider, ProviderConnection, ProviderDescriptor } from '@brobot2/shared'

/** What each command resolves to. The rest are acknowledgements. */
export interface RuntimeCommandResults {
  skills: SkillsReply
  /** ⚑ **716** · {@link RefusedLaunch} only when the command asked for one (`answerARefusal`). */
  createSession: CreatedSession | RefusedLaunch
  send: void
  /**
   * Ask whatever is running to stop, then send once it has ended — the "do this instead" path
   * (074). ⚠️ Since R43 (`709`) the provider may finish the turn first; the words go either way
   * (`739`, `737` F-7) — unless the turn has not ended within the host's bounded wait (the ask's,
   * then `waitForIdle`'s), when the send is refused and the words come back.
   */
  sendInterrupting: void
  /**
   * Hold this message until the running turn ends, then send it (077) — the "finish that first"
   * path, and the other half of the choice {@link sendInterrupting} makes.
   *
   * Resolves once the message is QUEUED, never once it is sent: the send happens when the turn ends,
   * which is not a moment this call can wait for. What it resolves to says which of the two actually
   * happened, because a turn can end between the keypress and this command arriving — see
   * {@link QueueOutcome}.
   */
  queueMessage: QueueOutcome
  /** Take a queued message back before it goes (077). */
  cancelQueuedMessage: void
  /** Take a held message back and stop the turn; refused, in the cancel's words, before any stop. */
  takeBackAndStop: void
  /**
   * Whether the decision was taken — and if not, whether the card is still answerable (146) — or
   * that the provider has not taken it within the host's bound (`742`).
   */
  respondPermission: ProviderAnswerAck
  /**
   * Whether the answer was taken — and if not, whether the card is still answerable (146) — or
   * that the provider has not taken it within the host's bound (`742`).
   */
  respondUserInput: ProviderAnswerAck
  resolveLink: LinkResolution
  answerAction: AnswerAck
  decideMoveRequest: MoveRequestAck
  interrupt: void
  /**
   * ⛔ **The request was ACCEPTED, not that the work died** (248, on `247`/`233`/`240`'s rule).
   *
   * `Query.stopTask`'s own doc promises only *"a `task_notification` with status 'stopped' will be
   * emitted"* — so the RECEIPT is that notification arriving as a `background_work.ended`, and this
   * resolving is the request going out. `233` and `240` spent two dispatches on exactly this
   * distinction, and a `void` that read as *"it is stopped"* would be the third.
   *
   * ⚠️ **`false` where the adapter cannot say.** Codex implements no stop; a session whose handle has
   * no such method answers `false` here rather than rejecting, because *"there is nothing of yours I
   * can stop"* is an answer and not a failure. The button is gated on the same fact, so this is the
   * race's backstop rather than its front door.
   */
  stopBackgroundWork: boolean
  close: void
  /** A fresh read of the home — the snapshot taken at creation goes stale the moment a file changes. */
  refreshConfig: ProviderConfigInfo
  /** The disclosure AFTER the change — which will still say `ask` if a turn is in flight (034). */
  setApprovalMode: ApprovalModeDisclosure
  /** The settings AFTER the change, and what a model or an effort became beyond it (D-048). */
  setSessionSetting: SessionSettingChanged
  /**
   * Nothing — the state change rides the liveness channel (060), because a second window watching
   * the same conversation has no command result to learn it from and the two must not disagree
   * about whether the plan has been released.
   */
  endPlanMode: void
  /** Every recorded session with a ref to resume from. */
  listResumable: ResumableSessionInfo[]
  listUnresumable: UnresumableSessionInfo[]
  adoptSessions: AdoptionReport
  exportSession: ExportedSession
  /** ⛔ The other half of the loop (214 §1) — a bundle brought back, or the reason it was not. */
  importBundleFile: ImportedBundle
  /** The reopened session, with the transcript it had before. */
  resume: ResumedSession
  /** ⚑ **D-017b** · a conversation drawn in this window — attached, taken, or from its ledger. */
  look: ResumedSession
  /** ⚑ This window is no longer shown the rows of a conversation it looked at. */
  stopLooking: void
  /** ⚑ **D-017b** · a person's message and the start it causes — every refusal the HOST makes is answered; the wire's own still reject. */
  startAndSend: FirstMessageAnswer
  /**
   * Whether there was a launch to stop (102) — and, when true, that its provider is confirmed down
   * or its id is still being refused. `false` means the launch was already over, which is a race
   * the press cannot avoid rather than a failure.
   */
  cancelLaunch: boolean
  /**
   * Every still-running session this surface owns, in the SAME shape a reopen returns (100).
   *
   * Deliberately not a lighter "here are some ids" — the caller asking this has nothing to look
   * them up with, and a two-step answer would leave a window in which a session could go away
   * between being named and being handed over.
   */
  attachOpen: ResumedSession[]
  /**
   * The conversation this surface has just taken over, in the SAME shape a reopen returns (336).
   *
   * ⚠️ **`handover` is `attached`, not `resumed`, and the value is load-bearing**: nothing stopped,
   * so the corrections a reopen applies — settling pending cards, clearing activity, stopping
   * sub-agents, closing open tool calls — would every one of them be false about a conversation
   * that has been running the whole time.
   *
   * ⚠️ **653 · "the whole time" is this life's, and a claimed conversation can have had another.**
   * One woken with no window (`652`) has a previous life in the window this hands over, and the
   * corrections ARE true of that one — so the claim says where this life began
   * (`ResumedSession.liveFrom`) and the renderer applies them there and nowhere later.
   */
  claim: ResumedSession
  /**
   * 🔴 **What the room says about the conversation that was just handed back** (523).
   *
   * ⛔ **Not `void`, and standing rule 18 is the whole reason.** *A surface may not report an act as
   * done until the act is RECORDED.* A `void` promise would let the pane draw *handed back* from the
   * absence of a throw; this makes it draw the word the host computed AFTER the write, off the same
   * slot map the room reads — so an implementation that cleared no owner reports `in-a-window` and
   * the surface says what actually happened rather than what it asked for.
   */
  release: ReleasedSession
  /**
   * ⚑ **Every open question a deadline has already escalated**, oldest escalation first — see
   * {@link PersonsQuestion}.
   *
   * ⛔ **A {@link LedgerWalk} since `453`, and `rows: []` is no longer the whole answer.** Empty
   * with `every-conversation-that-routed` is *nothing is overdue*; empty with `no-ledger` is *this
   * app has no database*. ⚠️ Those were the same bytes and a surface drew the first sentence over
   * both.
   */
  questionsForAPerson: LedgerWalk<PersonsQuestion>
  /**
   * ⚑ **Every open request that never travelled**, oldest routing first — see
   * {@link PersonsDecision}. ⛔ A {@link LedgerWalk} since `453`, for
   * {@link questionsForAPerson}'s reason.
   */
  decisionsForAPerson: LedgerWalk<PersonsDecision>
  /**
   * ⚑ **Every provider wall still standing, strongest first** — see {@link ProviderLimitSeen}.
   * ⛔ Already folded to one row per provider and window: the window draws what it is handed and
   * decides nothing about what counts as one wall.
   */
  limitsForAPerson: LedgerWalk<ProviderLimitSeen>
  readLimitsDisplay: LimitsDisplayAnswer
  /** ⚑ **D-017 · R19 — every instruction ask nobody has answered, oldest first.** */
  instructionAsksForAPerson: readonly InstructionAskWaiting[]
  mcpServerRequestsForAPerson: readonly McpServerRequestForAPerson[]
  /**
   * ⚑ **Every piece of work that has stopped with nobody left to tell, oldest first** — see
   * {@link StalledWork}. ⛔ Already narrowed to the rows no agent can be told about: the window
   * draws what it is handed and decides nothing about who was told.
   */
  stalledWorkForAPerson: LedgerWalk<StalledWork>
  currentEpoch: PublicationEpoch
  personsQueue: PersonsQueueAnswer
  listConversations: ListingAnswer
  stoppedWorkForAPerson: LedgerWalk<StoppedWorkForAPerson>
  workIncidentsForAPerson: LedgerWalk<WorkIncident>
  /**
   * ⚑ **F097 · every piece of work waiting on the person who wrote to its holder, oldest first** —
   * see {@link WaitingOnWhoWrote}. ⛔ Already the fold's own wait: the window draws what it is handed.
   */
  waitingOnWhoWroteForAPerson: LedgerWalk<WaitingOnWhoWrote>
  /**
   * ⚑ **One reading for one window**, with the window echoed back and the standing limit of any
   * window beside it — see {@link DigestReading}.
   */
  digest: DigestReading
  recentActivity: RecentActivityReading
  workGivenBy: LedgerWalk<WorkGivenOut>
  whoCalledWhom: WhoCalledWhom
  /** Two counts and one moment (567) — see {@link WorkspaceReading}. */
  readWorkspace: WorkspaceReading
  /** What each running conversation was last told it is doing (575) — see {@link WhatIsBeingDone}. */
  whatIsBeingDone: WhatIsBeingDone
  /**
   * What each running conversation is waiting on (621) — see
   * {@link WhatEachConversationIsWaitingOn}.
   */
  whatEachConversationIsWaitingOn: WhatEachConversationIsWaitingOn
  forestReading: ForestReading
  forestNodes: ForestNodesPage
  /** The memory each running conversation's process holds (D-018) — see {@link ProcessMemory}. */
  processMemory: ProcessMemory
  /** One page of the library: our sessions and the user's own, merged (047). */
  listLibrary: LibraryPage
  /** What filling in one recorded conversation's prior messages did (119) — every ending named. */
  importRecordedSession: ImportedRecording
  /** What importing one conversation out of a provider home did — every ending named. */
  importUserHomeSession: ImportedFromHome
  /** What rebuilding one conversation from its provider's file did (065) — every ending named. */
  rebuildLedger: RebuiltLedger
  /**
   * The file a dynamic workflow wrote (108), or a WORD saying why not.
   *
   * ⚠️ **The refusals are values rather than a null**, because their four causes are four different
   * sentences to a reader — see `main/workflow-output.ts`. `gone` in particular is ordinary: these
   * files live under the OS temp directory, so an old conversation's output is usually reaped.
   */
  readWorkflowOutput: WorkflowOutputResult
  /**
   * One provider-reported instruction file, read at the moment somebody asked (356 §2).
   *
   * ⚠️ **This is BroBot's read, now — not the provider's read at launch**, and the panel that draws
   * it must say so. The bytes on disk today are not necessarily the bytes the model was handed.
   */
  readInstructionSource: InstructionSourceResult
  /**
   * 🔴 **One resource, on the app's own paper** (510, as a document), or a word saying why not.
   *
   * ⚠️ **The refusals are values rather than a null**, for {@link readWorkflowOutput}'s reason:
   * each cause is its own sentence to a reader, and `changed` in particular is one a person can act
   * on — the hash is re-checked on every read, so *the file is not what was kept* is a fact rather
   * than a failure.
   */
  readResource: ResourceReading
  /** 🔴 **D-032 · a kept picture or PDF's bytes and the type to draw them as**, or why not. */
  drawResource: ResourceDrawing
  /** 🔴 **D-032 · a kept file shown in Finder by its id**, or why not. */
  revealResource: ResourceReveal
  /** 🔴 **D-026 · the files kept in one scope**, or the word for a scope that names nothing. */
  filesKept: FilesKept
  filesLibrary: import('../files-library').FilesLibraryResult
  teamProfileGraph: import('../team-profile-graph').TeamProfileGraphResult
  searchWork: import('../work-search').WorkSearchResult
  /** Where one of this session's paths is, shown in the file manager (356 §1). */
  revealPath: RevealResult
  resolveMessagePaths: MessagePath[]
  openMessagePath: OpenMessagePathResult
  revealMessagePath: RevealResult
  readConfigFile: ConfigFileResult
  /**
   * What one running command has printed so far (300), or `null`.
   *
   * ⛔ **`null` and an empty `text` are different facts** — see `CommandTail`. `null` means this app
   * is holding nothing for that call: the adapter does not stream, the session is a recording, or
   * the buffer was evicted. An empty `text` means it is running and has printed nothing yet. `074`'s
   * rule, and the card draws two different sentences from it.
   */
  readCommandOutput: CommandTail | null
  /**
   * The whole of what one tool answered (462), or `null`.
   *
   * ⛔ **`null` and an answer with no PARTS are different facts** — see `ToolAnswer`. `null` means
   * this app is holding nothing for that call: the conversation is a replay with no handle, the
   * receipt was a kind this adapter does not hold, or the ceiling evicted it. An empty `parts` means
   * the receipt arrived and carried no words. `074`'s rule, and the panel draws a different sentence
   * for each.
   */
  readToolAnswer: ToolAnswer | null
  /**
   * What one sub-agent actually did (112), or a WORD saying why not.
   *
   * The child's own transcript, the run's journal of return values, or the script that fanned it
   * out — read from the parent session's own sidecar directory. Read-only by construction: there is
   * no command that writes anything to a child, and none that resumes one.
   */
  readChildWork: ChildWorkResult
  /**
   * What the provider says about one child right now (296) — is it working, and will it listen.
   *
   * ⚠️ **A separate command from the read above and from the send below, and that is 295's finding
   * applied to our own wire.** The defect this dispatch was written about is one provider method
   * that means two things depending on state; three verbs that each mean one thing is the answer to
   * it, not an accident of layering.
   */
  readChildState: ChildStateResult
  /**
   * Offer a message to a child (296) — the first command in this app that writes to one.
   *
   * ⛔ **`ok: false` here is the ordinary case, not the error case.** A child that is still working
   * refuses, and that refusal is a fact the composer draws rather than an exception it catches.
   */
  sendToChild: ChildSendResult
  /** The page before the one the caller holds. Same shape, so paging is one loop, not two. */
  earlierHistory: HistoryWindow
  /** The NEWEST page — what "jump to latest" reads after scrolling back released the tail. */
  latestHistory: HistoryWindow
  /** What each provider can do, as the adapters declare it (039). */
  capabilities: ProviderCapabilityMap
  providerCatalogue: readonly ProviderDescriptor[]
  providerConnections: readonly ProviderConnection[]
  /**
   * Every profile that exists, {@link DEFAULT_PROFILE_ID} first (167).
   *
   * ⚠️ **Never empty.** A fresh install has no `provider-homes` directory at all, and the honest
   * answer there is still `['default']` — BroBot is a profile you can start a conversation in before
   * anything has been written for it, because `prepareProviderHome` creates the home on first use.
   */
  profiles: string[]
  /**
   * Whether a launch would accept this folder (203, from 195 H4).
   *
   * ⚠️ **`ok: true` with an empty `path` is the BLANK answer** — the workspace default, which is
   * what the field's placeholder promises — and it is a different fact from a resolved directory.
   */
  checkCwd: CwdVerdict
  /**
   * ⚑ **The identity that now exists, read back out of the row** (419) — the same shape
   * `agentIdentities` returns one of, so the surface that lists them and the surface that makes one
   * meet one type. ⛔ A collision THROWS and never resolves to null: there is no useful *there was
   * no such identity to create*.
   */
  createAgent: AgentIdentity
  /** Every identity a grant could name, plus the folders that are not one, plus the switch (355). */
  agentIdentities: AgentIdentities
  /**
   * The identity as it now stands, or **null when there was no row to write to** (355).
   *
   * ⛔ **Null is criterion 12 and is not an error.** A person naming an identity nothing has ever
   * run as is asking to configure something that does not exist; the honest answer is *there is
   * nothing here*, not a new durable agent with an empty memory and its own provider home.
   */
  setCapabilities: AgentIdentity | null
  /**
   * ⚑ **The registry row that now exists** (516) — read back out of the database, `createAgent`'s
   * shape one table over.
   *
   * ⛔ **There is no null arm**: every refusal this verb can meet is a REFUSAL carrying a sentence —
   * a reserved name, a name with `__` in it, a non-loopback URL, a server that could not be asked,
   * a collision with one of BroBot2's own tool names, or a name already taken — and a null would
   * throw the sentence away, which is the half of criterion 11 that matters.
   */
  registerExternalMcpServer: ExternalMcpServerRow
  /**
   * ⚑ **Whether there was a row to remove** (516). `false` is *it was already gone* and is not an
   * error — a person pressing Remove twice has asked for a state that already holds.
   */
  removeExternalMcpServer: boolean
  /**
   * The identity as it now stands, or **null when there was no row to write to** (433) —
   * {@link RuntimeCommandResults.setCapabilities}' rule, and criterion 12 for its reason.
   *
   * ⚑ **Read back rather than echoed**, which is 339's shape: a surface draws what the database now
   * says, so a fold that refused an unreadable word is visible instead of assumed away.
   *
   * 🔴 **682 · and it SAYS when it cleared a model choice** — see {@link AgentProviderSet}.
   */
  setAgentProvider: AgentProviderSet | null
  /**
   * The identity as it now stands, or **null when there was no row to write to** (558) —
   * {@link RuntimeCommandResults.setAgentProvider}'s rule one column over, and criterion 12 for its
   * reason.
   *
   * ⚑ **Read back rather than echoed**: the store folds a blank to `null`, so a surface draws what
   * the column now says rather than what was typed.
   */
  setAgentDisplayName: AgentIdentity | null
  /**
   * ⚑ **D-016 · commit 7 · R4 — the piece as it now stands, or the rail that refused the rename** —
   * see {@link WorkRetitled}. ⛔ Every refusal the HOST makes is a value with its sentence;
   * `requireAPerson` still throws (a caller no person is behind).
   */
  retitleWork: WorkRetitled
  /** The piece a person took back, or the rail that refused it ({@link WorkTakenBackByAPerson}). */
  takeBackWork: WorkTakenBackByAPerson
  /** The piece a person closed, or the rail that refused it ({@link WorkClosedByAPerson}). */
  closeWork: WorkClosedByAPerson
  /**
   * ⚑ **The choice as it now stands, read back — or the rail that refused it** (677).
   *
   * ⛔ **Every refusal the HOST makes is a VALUE with its sentence**, `AgentRemoved`'s shape: an
   * unlisted model or a provider that could not be asked is a person's ordinary state, not a broken
   * app. ⚠️ **Two refusals THROW, before the host is reached**: the wire's own schema (a model or an
   * effort with no provider beside it — a bug in the caller, not a person's state) and
   * `requireAPerson` (a caller no person is behind).
   */
  setAgentModelAndEffort: ModelChoiceSaved
  /** This identity's default model and effort, or `null` — it has none, or no such identity. */
  agentModelAndEffort: AgentModelChoice | null
  /** ⚑ **D-042 · R3** — {@link ModelList}. */
  modelList: ModelList
  providerLaunchChoices: ProviderLaunchChoices
  resolveProviderLaunch: ResolvedProviderLaunch
  /** ⚑ **D-042 · R3** — the provider's hand-added models after the add. */
  addHandAddedModel: readonly string[]
  /** ⚑ **D-042 · R3** — the provider's hand-added models after the delete. */
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
  /**
   * ⛔ **The identity's instructions as they NOW stand, or `null` when there was no row to write
   * to** — {@link RuntimeCommandResults.setAgentDisplayName}'s rule one door over, and criterion 12
   * for its reason.
   *
   * ⚑ **Read back rather than echoed**, so a surface draws the version the database allocated
   * rather than the one a caller assumed.
   */
  instructAgent: AgentInstructionsReading | null
  /** ⚑ **Never null** — an identity with no row and one with no rules both answer an empty history. */
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
  /**
   * ⚑ **Never null** — `agentInstructions`' own contract one line up, for its reason: an identity
   * with no row and one that has never run both answer stores nobody has written to.
   *
   * ⛔ **And never a bare empty list**: every store carries one of `MEMORY_STORE_STATE`, so *never
   * ran here* and *ran and wrote nothing* are different answers on the wire.
   */
  agentMemory: AgentMemoryReading
  /** 🔴 **F093** — the agent-input popup's one read. */
  whatThisAgentWasGiven: WhatThisAgentWasGiven
  /** 🔴 **F093 · C9 d** — one message as the model got it. */
  whatTheModelGot: WhatTheModelGot
  /**
   * 🔴 **What the act did AND the store as it now stands, or `null` when the identity had no row**
   * — `instructAgent`'s own criterion-12 shape, with one arm more.
   *
   * ⛔ **Read back rather than echoed**, so a surface draws the store as it is after the act rather
   * than the one a caller assumed. ⚠️ **A REFUSED amendment answers a reading too**, not an error
   * and not a throw: the entry it names carries `amendable` and the store carries its state, so the
   * surface that asked can show a person what is actually there. ⚑ `425`'s rule — the refusal
   * carries its remedy, and `REFUSAL_MEANS` is where each remedy is written once.
   */
  amendAgentMemory: AgentMemoryAmended | null
  undoAgentMemory: AgentMemoryAmended | null
  checkInterruptedMemory: MemoryChecked | null
  /** ⛔ **`AnswerAck`**, as the answer verbs answer. */
  decideInstruction: AnswerAck
  decideMcpServerRequest: AnswerAck
  /**
   * 🔴 **What the removal did, or what still holds it** (558).
   *
   * ⛔ **A payload rather than a `boolean`, and `removeExternalMcpServer` is the precedent it
   * departs from deliberately.** That verb has one way to fail — *already gone* — which `false`
   * says completely. This one has four, and a person pressing a control is owed which: `425`'s
   * rule that a refusal carries its remedy, where the remedy is *end those conversations* or *edit
   * the grant that names it*.
   */
  removeAgent: AgentRemoved
  archiveConversation: ArchiveOutcome
  restoreConversation: ArchiveOutcome
  checkDeleteConversation: DeleteVerdict
  deleteConversation: DeleteOutcome
  /** The switch as it now stands, read back rather than assumed from what was asked. */
  setSpawningEnabled: { spawningEnabled: boolean }
  /** Whether services are on now, read back rather than assumed from what was asked. */
  setServicesOn: { servicesOn: boolean }
  /**
   * The default as it now stands, read back rather than assumed from what was asked — the same
   * rule as the switch above, and load-bearing for the same reason: the store answers `'ask'` for
   * a write it could not make, and a surface drawing the request would say yolo over a row that
   * says nothing.
   */
  setDefaultApprovalMode: { defaultApprovalMode: 'ask' | 'auto' }
  /** Whether this profile's credential can still run a turn (098). */
  checkProviderAuth: AuthState
  /** Whether the re-copy actually changed anything — `unchanged` when the bytes already matched. */
  reprovisionProviderAuth: ReprovisionOutcome
  reprovisionProviderHomes: ProviderHomesReprovision
  /** How the sign-in ended, INCLUDING what the credential looks like afterwards. */
  signInProvider: ProviderSignInResult
  /** Nothing — cancelling is an acknowledgement, and cancelling nothing is still success. */
  cancelProviderSignIn: void
}

export type RuntimeCommandResult<K extends RuntimeCommandKind> = RuntimeCommandResults[K]
