import type { AgentIdentity } from '../agent-identity-contracts'
import type {
  AgentMemoryAmended,
  AgentMemoryReading,
  MemoryAmendmentAsked,
  MemoryCheckAsked,
  MemoryChecked,
  MemoryUndoAsked,
} from '../agent-memory'
import type { AgentRemoved } from '../agent-roster'
import type { RulesBaseline } from '../agent-rules'
import type { CapabilityGrant } from '../capabilities'
import type { ArchiveOutcome, DeleteOutcome, DeleteVerdict } from '../conversation-archive'
import type { McpServerRequestForAPerson } from '../conversation-events'
import type {
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../conversation-listing-contracts'
import type { PublicationEpoch } from '../data-version'
import type { DigestReading } from '../digest'
import type { ExternalMcpServerReach, ExternalMcpServerRow } from '../external-mcp'
import type { LimitsDisplayAnswer, LimitsDisplayChanged } from '../limits-display'
import type { LinkResolution } from '../link-resolution'
import type { ListingAnswer } from '../listing-published'
import type {
  AgentModelChoice,
  ModelChoiceSaved,
  ModelList,
  SessionSettingChanged,
} from '../model-choice-contracts'
import type { DecideMoveRequestInput, MoveRequestAck } from '../move-contracts'
import type {
  AgentInstructionsReading,
  InstructionAskWaiting,
  InstructionUnread,
} from '../own-instructions'
import type { OwnNotesReading, OwnNotesUnread, OwnNotesWrite } from '../own-notes'
import type { PersonsQueueAnswer } from '../persons-published'
import type { WorkClosedByAPerson, WorkRetitled, WorkTakenBackByAPerson } from '../piece-called'
import type {
  ProviderLaunchChoices,
  ResolveProviderLaunchInput,
  ResolvedProviderLaunch,
} from '../provider-launch'
import type { ProviderLimitSeen } from '../provider-limit'
import type { LedgerWalk, PersonsDecision, PersonsQuestion } from '../question-contracts'
import type { RecentActivityReading } from '../recent-activity'
import type { RuntimeChangeMessage } from './change-notices'
import type {
  MethodBody,
  MethodChangeResult,
  MethodDeleteSelection,
  MethodHistoryResult,
  MethodLibrary,
} from '../saved-method-library'
import type { SkillsReply, SkillsRequest } from '../skills-window'
import type { StalledWork } from '../stalled-work'
import type { StoppedWorkForAPerson } from '../stopped-work'
import type { WhatEachConversationIsWaitingOn, WorkGivenOut } from '../task-contracts'
import type { ForestListed, ForestNodesPage, ForestReading, ForestScope } from '../the-whole-forest'
import type { WaitingOnWhoWrote } from '../waiting-on-who-wrote'
import type { WhatIsBeingDone } from '../what-is-being-done'
import type { WhatTheModelGot, WhatThisAgentWasGiven } from '../what-this-agent-was-given'
import type { WhoCalledWhom } from '../who-called-whom'
import type { WorkIncident } from '../work-incidents'
import type { WorkspaceReading } from '../workspace-reading'
import type { AgentIdentities, NewAgent } from './identity'
import type {
  AdoptionReport,
  ExportAsked,
  ExportedSession,
  ImportedBundle,
  ImportedFromHome,
  ImportedRecording,
  LibraryPage,
  LibraryQuery,
  RebuiltLedger,
} from './library'
import type {
  ApiKeyChanged,
  ApiKeyStatus,
  CheckProviderAuthInput,
  KeptRuleRemoved,
  KeptRules,
  ProviderCapabilityMap,
  ProviderConfigInfo,
  ProviderHomesReprovision,
  ProviderProfileInput,
  ProviderResources,
  ProviderSignInResult,
  ProviderUsageReading,
  ProvidersChangedMessage,
} from './providers'
import type {
  ChildSendResult,
  ChildStateResult,
  ChildWorkInput,
  ChildWorkResult,
  ConfigFileResult,
  FilesKept,
  FilesKeptScope,
  InstructionSourceResult,
  MessagePath,
  MessagePathAsk,
  MessagePathTarget,
  OpenMessagePathResult,
  ResourceDrawing,
  ResourceReading,
  ResourceReveal,
  RevealResult,
  SessionPathTarget,
  WorkflowOutputResult,
} from './resources'
import type {
  AgentProviderSet,
  AnswerAck,
  AnswerActionInput,
  ApprovalModeDisclosure,
  CancelQueuedMessageInput,
  CreateSessionInput,
  CreatedSession,
  CwdVerdict,
  EarlierHistoryInput,
  EndPlanModeInput,
  FirstMessageAnswer,
  HistoryWindow,
  LaunchInput,
  LookInput,
  ProcessMemory,
  ProviderAnswerAck,
  QueueOutcome,
  RefusedLaunch,
  ReleasedSession,
  RespondPermissionInput,
  RespondUserInputInput,
  ResumeInput,
  ResumedSession,
  RuntimeEventMessage,
  RuntimeStatesMessage,
  SendInput,
  SessionInput,
  SessionLivenessMessage,
  SetApprovalModeInput,
  SetSessionSettingInput,
  StartAndSendInput,
  StopBackgroundWorkInput,
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

/**
 * The API the preload exposes on `window.api.runtime`. Commands are promises that
 * reject with the host's message when the command is invalid or the session is
 * gone; `onEvent` returns its own unsubscribe.
 */
export interface RuntimeBridge {
  providerLaunchChoices(input: ProviderProfileInput): Promise<ProviderLaunchChoices>
  resolveProviderLaunch(input: ResolveProviderLaunchInput): Promise<ResolvedProviderLaunch>
  skills(request: SkillsRequest): Promise<SkillsReply>
  /**
   * 🔴 **716 · `710` F-7 — a refusal ANSWERED, with its word, when the input asks**
   * (`answerARefusal: true`, {@link RefusedLaunch}); every other call is typed and answered as it was.
   *
   * ⚠️ **One generic signature, not two overloads**: a call that matches no overload is reported
   * WHOLE (*"no overload matches this call"*), and `scripts/lib/page-ipc-census.mjs` reads a smoke's
   * bad key or value property by property — two overloads blinded it to every `createSession` a
   * smoke page makes (found by its planted control).
   */
  createSession<Asked extends true | undefined = undefined>(
    input: CreateSessionInput & { readonly answerARefusal?: Asked },
  ): Promise<Asked extends true ? CreatedSession | RefusedLaunch : CreatedSession>
  send(input: SendInput): Promise<void>
  /**
   * Send even while a turn is running: asks it to stop first, then sends once it has ended (074;
   * R43 — it may finish first, `739`).
   */
  sendInterrupting(input: SendInput): Promise<void>
  /** Hold this until the running turn ends, then send it (077). */
  queueMessage(input: SendInput): Promise<QueueOutcome>
  /** Take the queued message back before it goes (077), naming which one (354). */
  cancelQueuedMessage(input: CancelQueuedMessageInput): Promise<void>
  /** Take a held message back and stop the turn, as one press, so its words never go. */
  takeBackAndStop(input: CancelQueuedMessageInput): Promise<void>
  respondPermission(input: RespondPermissionInput): Promise<ProviderAnswerAck>
  respondUserInput(input: RespondUserInputInput): Promise<ProviderAnswerAck>
  resolveLink(target: string): Promise<LinkResolution>
  /** A person answers a to-do an agent asked of them: Done or Can't do it, with a note. */
  answerAction(input: AnswerActionInput): Promise<AnswerAck>
  decideMoveRequest(input: DecideMoveRequestInput): Promise<MoveRequestAck>
  interrupt(input: SessionInput): Promise<void>
  /**
   * Stop ONE piece of background work, leaving the conversation alone (248).
   *
   * ⚠️ **Not `interrupt` with an argument, and the difference is the whole point.** `interrupt` ends
   * the TURN; this ends one detached command and nothing else — `245` ranked *"Stop one running
   * task"* separately from *"interrupt the whole turn"* precisely because the app only had the
   * second. Resolves to whether the request went out; the ending arrives as an event.
   */
  stopBackgroundWork(input: StopBackgroundWorkInput): Promise<boolean>
  close(input: SessionInput): Promise<void>
  refreshConfig(input: SessionInput): Promise<ProviderConfigInfo>
  /** Stop proposing, start doing — and say so to the agent, in one step (060). */
  endPlanMode(input: EndPlanModeInput): Promise<void>
  /** Start or stop prompting, from this session's next turn (034). */
  setApprovalMode(input: SetApprovalModeInput): Promise<ApprovalModeDisclosure>
  setSessionSetting(input: SetSessionSettingInput): Promise<SessionSettingChanged>
  listResumable(): Promise<ResumableSessionInfo[]>
  listUnresumable(): Promise<UnresumableSessionInfo[]>
  adoptSessions(): Promise<AdoptionReport>
  exportSession(input: ExportAsked): Promise<ExportedSession>
  /**
   * ⛔ **Bring a bundle back** (214 §1). `path` is a file the person chose — typed, or picked with
   * {@link RendererApi.chooseBundle} — and the refusal comes back as a value with a sentence in it.
   */
  importBundleFile(input: { path: string }): Promise<ImportedBundle>
  resume(input: ResumeInput): Promise<ResumedSession>
  /**
   * ⚑ **D-017b · draw one conversation in this window, whether or not anything runs it — and start
   * nothing.** ⚑ One this window holds running is handed back (`attached`); one running with no
   * window is taken for it when `claim` says a person pressed (`attached`); anything else is drawn
   * from its ledger (`recorded`), with {@link CreatedSession.cannotTakeAMessage} saying when a
   * message from here cannot continue it. ⚠️ Rejects only for an id this app holds no record of.
   */
  look(input: LookInput): Promise<ResumedSession>
  /**
   * ⚑ **This window no longer has the conversation open**: the rows this app writes while nothing
   * runs it stop coming here, until this window looks at it again. ⚑ Changes nothing for another
   * window, for a conversation this window runs, or for one it never looked at.
   */
  stopLooking(input: SessionInput): Promise<void>
  /**
   * ⚑ **D-017b · a person's message from a conversation's full view, in one act with the start it
   * causes**: the words go and it runs in this window, or they did not and nothing it started is left
   * running — unless something else had reached it first, and then it is handed over
   * ({@link FirstMessageNotSent.running}). ⚑ Events of the start arrive before this resolves, as a
   * reopen's do. ⚠️ A malformed command and the quit's door still reject ({@link FIRST_MESSAGE_REFUSALS}).
   */
  startAndSend(input: StartAndSendInput): Promise<FirstMessageAnswer>
  /**
   * Stop a launch this window is still waiting on (102) — the mechanism behind the launcher's Cancel.
   *
   * Resolves when the provider is confirmed down (or its id is being refused because it is not),
   * which is why it is worth awaiting: the answer means something happened, not that something was
   * asked for.
   */
  cancelLaunch(input: LaunchInput): Promise<boolean>
  /**
   * Reconcile with the host: every session it is still running for this window (100).
   *
   * The renderer's list of open conversations is its own memory of what it started; this is the
   * only question that can correct it. Called when a window's store is built.
   */
  attachOpen(): Promise<ResumedSession[]>
  /**
   * Take over a running conversation that nobody owns (336), and receive it exactly as a re-attach
   * delivers one: the newest page of its history, and then its live events.
   *
   * ⛔ **Rejects rather than answering null.** A claim is a gesture somebody made, and 100's rule is
   * that a refused gesture is TOLD which refusal it is — *"nobody is running that"*, *"it is still
   * opening"*, *"another window has it"* — instead of being handed a value that means all three.
   */
  claim(input: SessionInput): Promise<ResumedSession>
  /**
   * Hand a conversation back to nobody (523) — the inverse of {@link RuntimeBridge.claim}, and the
   * only release that is not a window dying.
   *
   * ⛔ **Rejects rather than answering null**, for {@link RuntimeBridge.claim}'s reason exactly: a
   * refused gesture is TOLD which refusal it is — *"you started this one"*, *"that belongs to
   * another window"*, *"nobody is holding it"* — instead of a value that means all three.
   *
   * ⚠️ **This member is the one a new verb is most likely to be missing**, and the paragraph under
   * {@link RuntimeBridge.questionsForAPerson} says why: there is no census over this interface, so a
   * verb can land in the union, the zod row, the quit ruling, the host and the preload and still be
   * a type error at `window.api.runtime`. `401` measured exactly that.
   */
  release(input: SessionInput): Promise<ReleasedSession>
  /**
   * 🔴 **What a PERSON has been left holding** (398, criterion 11) — every open routed question
   * that is a person's to answer, with the chain that says who is waiting on whom.
   *
   * ⚠️ **612 · it said *"a deadline has already escalated"*** (HO-088 §3.1). ⛔ **No deadline
   * escalates anything.** A row is here because its asker addressed it to a person (`611`), because
   * a parent passed it up, or — for a ledger written before `612` — because a deadline once did.
   *
   * ⛔ **The member `398` built everywhere but here** (401). The command, the zod row, the quit
   * ruling, the host method and the preload binding all landed at `87222b1`; this interface did
   * not, so `window.api.runtime.questionsForAPerson()` was a type error and the datum stopped at
   * the preload. ⚠️ **There is no census over this interface's members** — the three exhaustive
   * tables are keyed by `RuntimeCommandKind`, which the verb already joined — so nothing went red
   * over the gap and nothing would have.
   *
   * ⚠️ **A poll, and it has to be.** Nothing pushes it: the row is written into the ASKER's
   * ledger, a spawned child is owned by no window so its sink is a discard, and the renderer's fold
   * draws nothing for `request_routed` at all. See `persons-queue.ts`.
   *
   * ⚑ **612 · the three facts are unchanged and their SUBJECT moved** — it was `request_escalated`
   * until `HO-088` §3.1 removed the only thing that wrote one.
   */
  questionsForAPerson(): Promise<LedgerWalk<PersonsQuestion>>
  /**
   * 🔴 **What a person has been left holding that nobody else may touch** (403) — every open
   * routed request refused entry to the question channel, with the one hop that says who is frozen.
   *
   * ⛔ **A poll, and for `questionsForAPerson`'s reasons plus one of its own.** Nothing pushes
   * this either: the routing row is written into the CHILD's ledger, a spawned child is owned by
   * no window so its sink is a discard, and — unlike an escalation — there is not even a deadline
   * that fires. ⚑ The row is a person's from the instant it is written.
   *
   * ⚠️ **It never answers and it never claims.** A person answers on the card, through
   * `respondUserInput`, after `claim` if nobody holds the conversation. See `persons-queue.ts`.
   */
  decisionsForAPerson(): Promise<LedgerWalk<PersonsDecision>>
  /**
   * 🔴 **Which providers have stopped taking work, or are about to** (533).
   *
   * ⛔ **A poll, and for its three siblings' reason plus a sharper one.** The row is a non-fatal
   * `error` published into ONE conversation's ledger: a person in another conversation, or on
   * Home, is told by nothing at all — and `533` §0 is two measured runs in which nobody was told.
   *
   * ⚠️ **It never acts, and there is nothing here to act on.** A wall ends when the PROVIDER
   * says so — its clock, or its next answer (`586`, `HO-080` §1) — never when a person presses
   * anything; what this buys is the difference between *an agent that stopped* and *an agent that
   * is stuck*.
   */
  limitsForAPerson(): Promise<LedgerWalk<ProviderLimitSeen>>
  readLimitsDisplay(): Promise<LimitsDisplayAnswer>
  onLimitsDisplayChanged(listener: (message: LimitsDisplayChanged) => void): () => void
  /**
   * ⚑ **D-017 · R19 — every instruction ask nobody has answered, whichever conversation made it** —
   * a poll, for its siblings' reason: the row is in the asker's ledger, and no window need hold it.
   */
  instructionAsksForAPerson(): Promise<readonly InstructionAskWaiting[]>
  /** Every agent's request to register an MCP server that waits on a person, oldest first. */
  mcpServerRequestsForAPerson(): Promise<readonly McpServerRequestForAPerson[]>
  /**
   * 🔴 **What has stopped with nobody left to tell** (557).
   *
   * ⛔ **A poll, and for its four siblings' reason plus the one that made it necessary.** The push
   * that exists writes into a LIVE conversation's mailbox; a giver this app is not running has no
   * mailbox, and HO-018 §2.2 left no sweep to catch it later. ⚠️ **So the only thing that can ask
   * on a person's behalf is a window**, and this is it asking.
   *
   * ⚑ **It never acts.** HO-018's principle is that the parent decides — wait, interrupt,
   * re-assign or end — and a person reading this goes to the conversation holding the work.
   */
  stalledWorkForAPerson(): Promise<LedgerWalk<StalledWork>>
  /** This run's publisher, which every stamped answer and notice names. */
  currentEpoch(): Promise<PublicationEpoch>
  /** The person's queue as one stamped publication: eight parts, each with its own coverage. */
  personsQueue(): Promise<PersonsQueueAnswer>
  /** Both halves of the listing as one stamped publication. */
  listConversations(): Promise<ListingAnswer>
  stoppedWorkForAPerson(): Promise<LedgerWalk<StoppedWorkForAPerson>>
  /** The open pieces no other list shows a person, with what is wrong with each. */
  workIncidentsForAPerson(): Promise<LedgerWalk<WorkIncident>>
  /**
   * 🔴 **F097 · the work whose agent answered a person and waits on their next words** — a poll,
   * for its siblings' reason: the wait is folded from the holder's ledger, and no window need hold
   * it. ⚑ **It never acts**: a person reading it goes to the conversation holding the work.
   */
  waitingOnWhoWroteForAPerson(): Promise<LedgerWalk<WaitingOnWhoWrote>>
  digest(from: number, to: number): Promise<DigestReading>
  recentActivity(input: { from: number; to: number }): Promise<RecentActivityReading>
  /**
   * 🔴 **The work this conversation gave out** (508) — {@link WorkGivenOut}, walked.
   *
   * ⛔ **Declared HERE and not only on the command union**, which is the line `401` measured the
   * cost of forgetting: *"The command, the zod row, the quit ruling, the host method and the
   * preload binding all landed … this interface did not, so `window.api.runtime.questionsForAPerson()`
   * was a type error and the datum stopped at the preload."* ⚠️ **There is still no census over
   * this interface's members**, so nothing but this line stands between the read and that gap.
   */
  workGivenBy(input: { sessionId: string }): Promise<LedgerWalk<WorkGivenOut>>
  /**
   * 🔴 **Who called whom, for one conversation** (543) — see {@link WhoCalledWhom}.
   *
   * ⛔ **Declared HERE and not only on the command union**, for the reason the method above it
   * states: `401` measured what forgetting this line costs, and there is still no census over this
   * interface's members.
   *
   * ⚠️ **No renderer calls it yet, and that is the dispatch boundary rather than an oversight.**
   * `540` §8 puts the typed door in main/shared/IPC and the panel in the renderer; the panel is
   * slice 2 and goes to a UI seat. ⛔ A door that answers and a surface that draws are two
   * dispatches, and the door is the one with the missing facts in it.
   */
  whoCalledWhom(input: { sessionId: string }): Promise<WhoCalledWhom>
  /**
   * 🔴 **Two counts and one moment** (567) — see {@link WorkspaceReading}.
   *
   * ⚠️ **No renderer calls it yet, and that is the dispatch boundary rather than an oversight** —
   * {@link whoCalledWhom}'s note exactly. ⛔ `564` §7 puts the aggregate in main/shared/IPC and the
   * Home line in a later slice: *"Home can ship only after this exists."* ⚑ Its brief's §6.6 says
   * so in as many words — *a read with no reader is fine here and is what `564` ordered.*
   */
  readWorkspace(): Promise<WorkspaceReading>
  /**
   * 🔴 **What each running conversation was last told it is doing** (575) — see
   * {@link WhatIsBeingDone}.
   *
   * ⚑ **`588` gave it its first renderer reader and `593` its second** — `RuntimeScreen`'s
   * `readTheRoom` for a project band, `readWhoIsWorking` for the Team page. ⚠️ **This said *no
   * renderer calls it yet* until `593` swept it, and it was already false at `588`** — the two
   * surfaces `575`'s brief §6 put out of scope, in as many words (*"Any screen. Two are coming and
   * the PO is designing them; a fold in a component would be built twice."*), both arrived.
   * ⚑ What was never deferred is the fold itself —
   * `whatAPlateCanDraw` is in `what-is-being-done.ts` rather than in either component, for `468`'s
   * reason: a derivation written inside an SFC is reachable by no mutation row.
   */
  whatIsBeingDone(): Promise<WhatIsBeingDone>
  /**
   * 🔴 **What each running conversation is WAITING ON** (621, `HO-095` §5.1 · `EXT-014` §5) — see
   * {@link WhatEachConversationIsWaitingOn}.
   *
   * ⛔ **A poll, because nothing pushes and that is measured.** A wait moves when a ledger
   * somewhere else is written — a child's reply, a person's decision — and the giver's own stream
   * carries none of it; `RuntimeScreen.readTheWork` is already a poll for exactly that reason.
   *
   * ⚠️ **Where a window draws it is the renderer's**, and the surfaces `HO-095` §5.1 names are
   * the header, the avatar and the rail row. ⚑ `waiting-on-a-worker` asks NOBODY for anything, so
   * it is not a `Needing` and must not become the `waiting` standing. ⛔ **D-036 · its words are not
   * the renderer's**: they are the one state's *waiting on <name>*, the host names who holds the
   * work on each row (`ConversationWaiting.waitingOnTheWorkOf`), and the window only draws them.
   */
  whatEachConversationIsWaitingOn(): Promise<WhatEachConversationIsWaitingOn>
  /**
   * One forest reading, its counts, members, context and first page — see {@link ForestReading}.
   * It moves when a conversation is created, spawned or updated and when work is given or closed,
   * so a surface drawing an age beside a DOING word draws {@link WhatIsBeingDone}'s stamp.
   *
   * Join it to its two neighbours on the conversation id and never on the identity slug:
   * {@link ConversationAtWork.identity} is the launcher's raw spelling and
   * `ForestConversation.identity` is the identity's folded one, and the two can differ on an
   * identity a person first launched with a capital letter — see that field, where the measurement
   * is.
   */
  forestReading(scope: ForestScope): Promise<ForestReading>
  /**
   * A later page of a reading's nodes: at most `FOREST_PAGE` of its `unfolded` conversations — see
   * {@link ForestNodesPage}.
   */
  forestNodes(reading: ForestListed, conversations: readonly string[]): Promise<ForestNodesPage>
  /**
   * 🔴 **D-018 · the memory each running conversation's provider process holds** — see
   * {@link ProcessMemory}. ⚑ Read by main off the pids its adapters hold, one `ps` for all of
   * them, each time it is asked; a card draws its own conversation's figure, and nothing when it is
   * absent.
   */
  processMemory(): Promise<ProcessMemory>
  /** The library (047): our sessions and the user's own provider homes, merged and searchable. */
  listLibrary(input: LibraryQuery): Promise<LibraryPage>
  /**
   * Fill in one RECORDED conversation's prior messages from the home this app provisioned (119).
   *
   * ⚠️ **Not {@link importUserHomeSession} with a different argument.** That one gives a file in the
   * user's own home a row here and takes the PROVIDER's id; this one takes ours, because the row
   * already exists and what is missing is its messages.
   */
  importRecordedSession(input: { sessionId: string }): Promise<ImportedRecording>
  /** Import one conversation out of a provider home. */
  importUserHomeSession(input: {
    provider: Provider
    providerSessionId: string
  }): Promise<ImportedFromHome>
  /**
   * Rebuild one conversation's transcript from its provider's file (065) — what a `stale` row
   * offers. The file is read again and our reading of it replaced.
   */
  rebuildLedger(input: { sessionId: string }): Promise<RebuiltLedger>
  /**
   * Read the output file of one recorded workflow run (108).
   *
   * ⚠️ **There is deliberately no `path` parameter.** The run is named; the path is looked up in the
   * ledger this app wrote. A channel taking a path would be an arbitrary-file reader, which is
   * exactly what `main/asset-protocol.ts` refuses to become.
   */
  readWorkflowOutput(input: SessionInput & { taskId: string }): Promise<WorkflowOutputResult>
  /**
   * Read one file this session's provider said it loaded (356 §2), so it can open on the same paper
   * every other document in this app opens on.
   *
   * ⚠️ **There is deliberately no `path` parameter**, for `readWorkflowOutput`'s reason and one
   * more: the list is the provider's, so the only honest way to name a row is by its position in
   * the list the provider gave — the same list the panel drew.
   */
  readInstructionSource(input: SessionInput & { index: number }): Promise<InstructionSourceResult>
  /**
   * 🔴 **510 · a resource by its id, for a person** (a document until D-016). ⚠️ **There is
   * deliberately no `sessionId`**: the id names a row in this app's own table and the answer does
   * not depend on which conversation is on screen — so a recording's transcript can open one exactly
   * as a live conversation can, which is the dead-button `108`'s review found on that very pane.
   */
  readResource(input: { resourceId: string }): Promise<ResourceReading>
  /**
   * 🔴 **D-032 · a kept picture or PDF, for a person to see** — its bytes, checked against the hash
   * it was kept with, and the type to draw them as. ⛔ What the window may do with them is
   * {@link ResourceDrawing}'s to say. ⚑ Asked when a person opens the file, and never on a timer.
   */
  drawResource(input: { resourceId: string }): Promise<ResourceDrawing>
  /**
   * 🔴 **D-032 · a kept file, shown in Finder by its id** — the file where this app keeps it, in its
   * folder, and nothing launched. ⛔ No path either way: see {@link ResourceReveal}.
   */
  revealResource(input: { resourceId: string }): Promise<ResourceReveal>
  /** What each path-like text in one message names now. One call per message, never on a poll. */
  resolveMessagePaths(input: MessagePathAsk): Promise<MessagePath[]>
  /** Opens a document on the allowlist in its default app, else shows the path in the file manager. */
  openMessagePath(input: MessagePathTarget): Promise<OpenMessagePathResult>
  /** Shows the path in the file manager; never opens it. */
  revealMessagePath(input: MessagePathTarget): Promise<RevealResult>
  /**
   * 🔴 **D-026 · the files kept in one scope** — see {@link FilesKept}.
   *
   * ⛔ **Declared HERE and not only on the command union**, for the reason {@link workGivenBy}
   * states: `401` measured what forgetting this line costs, and there is still no census over this
   * interface's members. ⚠️ **No renderer calls it yet** — {@link whoCalledWhom}'s note: the door
   * and the surfaces that draw it are two dispatches, and the surfaces are UI-002's.
   */
  filesKept(input: FilesKeptScope): Promise<FilesKept>
  filesLibrary(
    request: import('../files-library').FilesLibraryRequest,
  ): Promise<import('../files-library').FilesLibraryResult>
  teamProfileGraph(
    request: import('../team-profile-graph').TeamProfileGraphRequest,
  ): Promise<import('../team-profile-graph').TeamProfileGraphResult>
  searchWork(input: {
    conversation: string
    query: import('../work-search').WorkSearchQuery
  }): Promise<import('../work-search').WorkSearchResult>
  /**
   * Reveal one of this session's paths in the file manager.
   *
   * ⚑ **Finder: the file on screen in its folder, and nothing launched.** The panel's OTHER
   * affordance, *Open*, reads a file onto the app's own paper — {@link readInstructionSource}, and
   * since `733` {@link readConfigFile}. 🔴 This said *"Reveal, never open"*, and the reason was the
   * `auth.json` the panel names; that file opens on the app's paper now, like any other (R92).
   */
  revealPath(input: SessionInput & { target: SessionPathTarget }): Promise<RevealResult>
  /**
   * 🔴 **733 · one config file this session's home holds, read on request** — the Info panel's Open
   * (`731` F-2, R92). ⚠️ **By NAME, the one {@link ProviderConfigFile} gave it**: the readable set is
   * the files this session's provider config declares, and main looks the path up. `auth.json`
   * included — see {@link ConfigFileResult}.
   */
  readConfigFile(input: SessionInput & { name: string }): Promise<ConfigFileResult>
  /**
   * Read output printed by a running command.
   *
   * ⚠️ **Called repeatedly while a card showing a running command is open**, on the same shape and
   * for the same reason `readChildState` is: what it asks about is exactly the thing that changes
   * with nobody doing anything. ⚑ **It costs a buffer read and nothing else** — no provider round
   * trip, no filesystem — which is what makes a poll honest here rather than the *"unnecessary
   * request"* `275` §1 warns about.
   */
  readCommandOutput(input: SessionInput & { toolCallId: string }): Promise<CommandTail | null>
  /**
   * The whole of what one tool answered (462) — the read behind *"show me what it actually said"*.
   *
   * ⚠️ **Called ONCE, when a person opens the panel, and deliberately not polled.** `readCommandOutput`
   * one method up is polled because what it asks about changes while nobody does anything; a receipt
   * does not change after it lands. ⛔ A second read a second later would be asking a settled
   * question — `275` §1's *"an unnecessary request to a provider is a new failure mode"* with no
   * provider in it, which is still a request nobody needed.
   */
  readToolAnswer(input: SessionInput & { toolCallId: string }): Promise<ToolAnswer | null>
  /**
   * Read what one sub-agent did (112) — its transcript, its run's journal, or the script.
   *
   * ⚠️ **No `path` parameter, for the same reason**, and one more besides: the directory is derived
   * from the session's own provider home, so the agent id is the only thing the renderer supplies
   * and it must be an agent this app's ledger recorded.
   */
  readChildWork(input: SessionInput & ChildWorkInput): Promise<ChildWorkResult>
  /**
   * Ask what one child is doing (296) — the read the viewer's composer draws itself from.
   *
   * ⚠️ **Called repeatedly while a child viewer is open**, because a child's state is exactly the
   * thing that changes without anybody doing anything. The same `agentId` rule as above: the ledger
   * is the allowlist and the renderer supplies nothing that reaches a provider or a disk.
   */
  readChildState(input: SessionInput & { agentId: string }): Promise<ChildStateResult>
  /**
   * Say something to one child (296).
   *
   * ⛔ **Refused while the child is working**, and refused in the main process rather than only in
   * the button — see `packages/runtime/src/child-conversation.ts` for what the provider does when
   * this is sent anyway.
   */
  sendToChild(input: SessionInput & { agentId: string; text: string }): Promise<ChildSendResult>
  /**
   * The page of conversation before the one already held (054) — what scrolling back calls.
   *
   * The SAME call for a live session and a recording, because the question is about the ledger and
   * the ledger does not care whether anything is running. Passing `before` rather than a page index
   * is what keeps it correct while a live session appends underneath the reader.
   */
  earlierHistory(input: EarlierHistoryInput): Promise<HistoryWindow>
  /**
   * The NEWEST page of a session's ledger — what "jump to latest" reads (054).
   *
   * It exists because scrolling far enough back RELEASES the newest events, and a window that has
   * let go of the tail cannot fold the live stream any more. Without a way back, a reader who
   * scrolled too far would sit in front of a frozen transcript for the life of the session; the
   * review found exactly that, and this is the escape.
   *
   * ⚑ Asked of any conversation on screen, whether or not anything runs it (D-017b).
   */
  latestHistory(input: SessionInput): Promise<HistoryWindow>
  /**
   * What each provider can do (039) — the answer to every "should this control be here?".
   *
   * Takes no session on purpose: the launcher asks before one exists, and a session's answer is
   * this map indexed by its provider. Never branch on the provider instead of asking.
   */
  capabilities(): Promise<ProviderCapabilityMap>
  /** Registered descriptor facts in declaration order, without probing a provider. */
  providerCatalogue(): Promise<readonly ProviderDescriptor[]>
  /** Existing connection metadata only; no credential, home preparation or provider probe. */
  providerConnections(): Promise<readonly ProviderConnection[]>
  /**
   * 🔴 **D-042 · R3 — the one list a person picks from** ({@link ModelList}): one provider's rows and
   * the person's own, the last pick, and what a new conversation starts on.
   */
  modelList(input: { provider: Provider; profileId?: string }): Promise<ModelList>
  /** ⚑ **D-042 · R3** — add a model to a provider's list by hand; answers the hand-added models. */
  addHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  /** ⚑ **D-042 · R3** — take a hand-added model off the list; answers the hand-added models. */
  deleteHandAddedModel(input: { provider: Provider; model: string }): Promise<readonly string[]>
  /** 🔒 Where a provider's API key stands — never the key. */
  apiKeyStatus(input: { provider: Provider }): Promise<ApiKeyStatus>
  /**
   * 🔒 Keep a provider's API key, replacing any before it; answers where it stands now, and
   * `refused` — words to act on, never the key — when it was not kept.
   */
  setApiKey(input: { provider: Provider; key: string }): Promise<ApiKeyChanged>
  /** 🔒 Stop using a provider's API key; answers where it stands now. */
  removeApiKey(input: { provider: Provider }): Promise<ApiKeyChanged>
  /** 🔒 Ask the provider whether it accepts the key that is set — only when a person asks. */
  checkApiKey(input: { provider: Provider }): Promise<ApiKeyCheck>
  /** ⚑ Each provider's program as this install bundles it ({@link ProviderVersion}). */
  providerVersions(): Promise<Readonly<Record<Provider, ProviderVersion>>>
  /** Every rule an *Always allow* kept beyond its conversation, file by file. */
  keptRules(): Promise<KeptRules>
  /** 🔒 Remove one kept rule from its file — only one the list above holds, and only on a person's press. */
  removeKeptRule(input: {
    provider: Provider
    file: string
    kept: string
  }): Promise<KeptRuleRemoved>
  /**
   * How a person puts each provider's own login on this computer: its tool, the installer and
   * sign-in command for this platform, and which platform that is. `null` for a provider that signs
   * in inside this app and needs nothing installed.
   */
  providerSetup(): Promise<Readonly<Record<Provider, ProviderSetup | null>>>
  /**
   * ⚑ Each provider's newest usage reading per metered window ({@link ProviderUsageReading}); an
   * empty list is no reading yet. ⚑ {@link onProvidersChanged} says when a new one lands.
   */
  providerUsage(): Promise<Readonly<Record<Provider, readonly ProviderUsageReading[]>>>
  /**
   * ⚑ What the agent processes this app started use, per provider ({@link ProviderResources}) —
   * measured when asked, at most every five seconds: a screen that draws it asks while it is open.
   */
  providerResources(): Promise<Readonly<Record<Provider, ProviderResources>>>
  /**
   * ⚑ A provider's login or usage moved ({@link ProvidersChangedMessage}). Returns the
   * unsubscribe.
   */
  onProvidersChanged(listener: (message: ProvidersChangedMessage) => void): () => void
  /**
   * **Which profiles exist** (167) — read off the homes this app has laid down, never a registry.
   *
   * There is no profile ENTITY anywhere in this app: a profile is a directory under the managed
   * root, created on first use. So this is a directory listing with the default one guaranteed in
   * it, and it is what the launcher's menu is built from.
   *
   * ⚠️ **Ask again after starting a session in a new profile.** The home is created by the launch,
   * so a name typed into the launcher is not in this answer until it has been used once — see
   * `RuntimeScreen.start`, which re-reads for exactly that reason.
   */
  profiles(): Promise<string[]>
  /**
   * **Would the launch accept this folder** (203, from 195 H4) — the typed half of 076 §3's picker.
   *
   * {@link ChosenCwd} answers for a folder that was CHOSEN; nothing answered for one that was
   * TYPED, so `cwdRefusal` was cleared on every keystroke and `launchBlocked` never weighed the
   * folder at all. A blank path answers `ok` with an empty `path`: blank means the workspace
   * default, and there is no resolved directory to show for a folder nobody named.
   */
  checkCwd(path: string): Promise<CwdVerdict>
  /**
   * ⚑ **Bring an identity into existence** (419) — see the command's own note for why a person's
   * door and an agent's tool are two doors rather than one with a caller check.
   *
   * ⛔ **Rejects on a slug that is taken, in any spelling**, because `Worker` and `worker` are one
   * identity (238) and a creation that adopted the existing row would hand somebody an agent they
   * did not make.
   */
  createAgent(input: NewAgent): Promise<AgentIdentity>
  /**
   * Every agent identity there is, with its capabilities and the kill switch (355).
   *
   * ⚠️ **No project, since 369.** An identity is global; the project slug this took was never a
   * choice a caller made, only a constant a refusal enforced.
   */
  agentIdentities(): Promise<AgentIdentities>
  /**
   * Set one identity's capabilities (355). Null when that identity has no row — see
   * {@link RuntimeCommandResults.setCapabilities}.
   */
  setCapabilities(input: {
    profileId: string
    grant: CapabilityGrant
    /** ⚑ **516 · the COMPLETE set**, saved in one transaction with the grant beside it. */
    externalMcpServerIds: readonly string[]
  }): Promise<AgentIdentity | null>
  /**
   * 🔴 **Register one external MCP server** (516) — a person's verb, on no toolset.
   *
   * ⛔ **Rejects with a sentence** for a reserved or unusable name, a URL that is not
   * credential-free loopback, a server that could not be asked what it offers, a server publishing
   * one of BroBot2's own tool names, or a name already taken.
   */
  registerExternalMcpServer(input: {
    name: string
    url: string
    reach: ExternalMcpServerReach
  }): Promise<ExternalMcpServerRow>
  /** Remove one registered server and every grant naming it (516). `false` is *already gone*. */
  removeExternalMcpServer(input: { serverId: string }): Promise<boolean>
  /**
   * Say which provider this identity's NEXT conversation starts on (433), or `null` to hand it back
   * to the app's fallback. Null answer when that identity has no row — see
   * {@link RuntimeCommandResults.setAgentProvider}.
   *
   * ⛔ **Nothing running moves**, and the surface offering it has to say so: a conversation takes
   * its provider at launch and keeps it, so this is a choice about the next one.
   */
  setAgentProvider(input: {
    profileId: string
    provider: Provider | null
  }): Promise<AgentProviderSet | null>
  /**
   * Correct what this identity is called (558), or `null` to say nobody has named it. Null answer
   * when that identity has no row — see {@link RuntimeCommandResults.setAgentDisplayName}.
   *
   * ⛔ **Every surface moves**, and that is the difference from the provider beside it: `agentName`
   * is what every list, header and work row draws an identity by, so a rename is announced on
   * `runtime:changed`'s `agents` subject.
   */
  setAgentDisplayName(input: {
    profileId: string
    displayName: string | null
  }): Promise<AgentIdentity | null>
  /**
   * Rename a piece a person gave — a root, or work its owner took on for them (D-016 · commit 7 ·
   * R4) — by its label or its id. See {@link RuntimeCommandResults.retitleWork}.
   *
   * ⛔ **Every surface moves**: a rename is announced on `runtime:changed`'s `work` subject, and every
   * list that names the conversation reads the newest title. Nobody is told.
   */
  retitleWork(input: { piece: string; title: string }): Promise<WorkRetitled>
  /**
   * Take back the piece a service is on, as a person (see {@link RuntimeCommandResults.takeBackWork}).
   */
  takeBackWork(input: { piece: string }): Promise<WorkTakenBackByAPerson>
  /** Close stopped work, as a person (see {@link RuntimeCommandResults.closeWork}). */
  closeWork(input: { piece: string }): Promise<WorkClosedByAPerson>
  /**
   * Set this identity's default model and effort — what its new conversations start on (677; D-042
   * · R2) — or clear it with `provider: null`. See {@link RuntimeCommandResults.setAgentModelAndEffort}.
   *
   * ⛔ **A conversation already open keeps its own** — `whatAModelChoiceReaches` is that sentence,
   * rendered from the default.
   */
  setAgentModelAndEffort(input: {
    profileId: string
    provider: Provider | null
    model: string | null
    effort: string | null
  }): Promise<ModelChoiceSaved>
  /** The default `setAgentModelAndEffort` wrote, or `null` (677). */
  agentModelAndEffort(input: { profileId: string }): Promise<AgentModelChoice | null>
  /**
   * Append one version of this identity's own instructions (582) — the `configured` layer's writer.
   * Null answer when that identity has no row.
   *
   * ⛔ **Nothing running moves**, and the surface offering it has to say so: a bundle is composed
   * at launch, so this reaches the NEXT conversation this agent runs — `TAKES_EFFECT_AT_THE_NEXT_LAUNCH`
   * is where that sentence lives, once.
   */
  instructAgent(input: {
    profileId: string
    baseline?: RulesBaseline
    text: string
    broughtBack?: number
  }): Promise<AgentInstructionsReading | null>
  /** Every version this identity has been given, and every ask waiting against it (582). */
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
  /**
   * What this identity has written down, under every provider, RIGHT NOW (625, `EXT-015` §1) —
   * and every amendment a person has made to it.
   *
   * ⛔ **No conversation is needed and none is consulted.** The Team page's door.
   *
   * ⚑ **F093 · paged with `offset` or `limit`** — see the command.
   */
  agentMemory(input: {
    profileId: string
    offset?: number
    limit?: number
  }): Promise<AgentMemoryReading>
  /**
   * 🔴 **F093 · everything this conversation's agent was given, as its last launch sent it** — its
   * instruction files with origin and sections, its own instructions' version, BroBot's tools in
   * full, its memory read now and paged, and every size.
   */
  whatThisAgentWasGiven(sessionId: string): Promise<WhatThisAgentWasGiven>
  /**
   * 🔴 **F093 · C9 d — one message as the model got it**: BroBot's parts in the order the model read
   * them, each where it sat, and the provider's own record of the turn. `ordinal` is the message's
   * place in the conversation's record; any row's place answers for the message at or before it.
   */
  whatTheModelGot(sessionId: string, ordinal: number): Promise<WhatTheModelGot>
  /**
   * Remove or correct one entry in this identity's memory (625, `EXT-015` §3.2) — and answer with
   * the store as it now stands. Null when that identity has no row.
   *
   * ⛔ **A running conversation does not move.** `readSessionInstructions` takes a conversation's
   * copy at its launch, so this reaches the agent from its NEXT conversation — `EXT-015` §2.1, and
   * the same promise `instructAgent` above makes.
   */
  amendAgentMemory(input: MemoryAmendmentAsked): Promise<AgentMemoryAmended | null>
  undoAgentMemory(input: MemoryUndoAsked): Promise<AgentMemoryAmended | null>
  checkInterruptedMemory(input: MemoryCheckAsked): Promise<MemoryChecked | null>
  /** Approve or refuse one ask an agent made against an identity's instructions (582). */
  decideInstruction(input: { askId: string; approve: boolean }): Promise<AnswerAck>
  /** Approve or refuse one agent's request to register an MCP server. */
  decideMcpServerRequest(input: { requestId: string; approve: boolean }): Promise<AnswerAck>
  /**
   * Remove an identity nothing runs (558) — and say what still holds it.
   *
   * ⛔ **Its folder under `provider-homes/` is not touched.** See `AGENT_REMOVAL_MEANS`, which is
   * the sentence a surface draws BEFORE the press.
   */
  removeAgent(input: { profileId: string }): Promise<AgentRemoved>
  /** Archive a conversation and the helpers below it: stopped, kept, and out of the person's lists. */
  archiveConversation(input: { sessionId: string }): Promise<ArchiveOutcome>
  /** Bring an archived conversation and its archived helpers back to the person's lists. */
  restoreConversation(input: { sessionId: string }): Promise<ArchiveOutcome>
  /** What deleting a conversation would remove, each part for the person to tick. */
  checkDeleteConversation(input: { sessionId: string }): Promise<DeleteVerdict>
  /** Delete the ticked parts of a conversation, and nothing else. */
  deleteConversation(input: { sessionId: string; parts: string[] }): Promise<DeleteOutcome>
  /** Throw the global spawning switch (355), and answer with where it now stands. */
  setSpawningEnabled(input: { enabled: boolean }): Promise<{ spawningEnabled: boolean }>
  /** Turn services on or off in this workspace, and answer with where they now stand. */
  setServicesOn(input: { on: boolean }): Promise<{ servicesOn: boolean }>
  /**
   * Set the mode a person's next conversation begins in (500), and answer with where it now stands.
   *
   * ⛔ **Nothing running moves**, and the surface offering it has to say so: a conversation takes
   * its approval mode at launch, so this is a choice about the next one — and about every one after
   * that, which is the half `setAgentProvider`'s neighbour sentence does not have to carry.
   */
  setDefaultApprovalMode(input: {
    mode: 'ask' | 'auto'
  }): Promise<{ defaultApprovalMode: 'ask' | 'auto' }>
  /**
   * Whether a profile's credential can still run a turn (098) — asked of the provider, never
   * inferred from an error sentence. Free and local for Codex; a Keychain read for Claude.
   */
  checkProviderAuth(input: CheckProviderAuthInput): Promise<AuthState>
  /**
   * Re-copy the machine credential into this profile, replacing what is there.
   *
   * ⚠️ The surface offering this **must** say that it does not end the sharing: the copy and the
   * machine credential hold one rotating refresh token between them, so the next refresh by either
   * side breaks the other again. {@link RuntimeBridge.signInProvider} is the one that ends it.
   */
  reprovisionProviderAuth(input: ProviderProfileInput): Promise<ReprovisionOutcome>
  /** Re-copy this install’s profile homes, preserving keys and running tasks; reopen idle sessions. */
  reprovisionProviderHomes(input: {
    provider: Provider
    statusOnly?: boolean
  }): Promise<ProviderHomesReprovision>
  /**
   * Sign this profile into its own account. **Resolves when the browser flow settles**, which may
   * be minutes — render a Cancel beside it and call {@link RuntimeBridge.cancelProviderSignIn}.
   */
  signInProvider(input: ProviderProfileInput): Promise<ProviderSignInResult>
  /** Withdraw an in-flight sign-in. Safe when there is none. */
  cancelProviderSignIn(input: ProviderProfileInput): Promise<void>
  onEvent(listener: (message: RuntimeEventMessage) => void): () => void
  onLiveness(listener: (message: SessionLivenessMessage) => void): () => void
  /**
   * 🔴 **Something this window LISTS has moved — ask again** (534). See
   * {@link RUNTIME_CHANGED_CHANNEL} for the hole it closes and why it is an invalidation.
   *
   * ⚠️ **Beside `onEvent` and `onLiveness` rather than on `window.api`**, where `onClosing` lives:
   * the subject is the runtime's own state, and a subscriber that had to reach past `runtime` for
   * it would be the one fact about a conversation that is not on this bridge.
   *
   * Returns the unsubscribe, like its two neighbours.
   */
  onChanged(listener: (message: RuntimeChangeMessage) => void): () => void
  /**
   * 🔴 **D-019 · what an agent is doing moved — here is what it is doing now**, and, D-026, which
   * files were kept. See {@link RUNTIME_STATES_CHANNEL} for why it carries the answer where
   * {@link onChanged} does not.
   *
   * Returns the unsubscribe, like its neighbours.
   */
  onStates(listener: (message: RuntimeStatesMessage) => void): () => void
}
