import type { MemoryAmendmentAsked, MemoryCheckAsked, MemoryUndoAsked } from '../agent-memory'
import type { RulesBaseline } from '../agent-rules'
import type { CapabilityGrant } from '../capabilities'
import type { ExternalMcpServerReach } from '../external-mcp'
import type { DecideMoveRequestInput } from '../move-contracts'
import type { OwnNotesWrite } from '../own-notes'
import type { ResolveProviderLaunchInput } from '../provider-launch'
import type { MethodDeleteSelection } from '../saved-method-library'
import type { SkillsRequest } from '../skills-window'
import type { ForestScope } from '../the-whole-forest'
import type { NewAgent } from './identity'
import type { ExportKind, LibraryQuery } from './library'
import type { CheckProviderAuthInput, ProviderProfileInput } from './providers'
import type {
  ChildWorkInput,
  FilesKeptScope,
  MessagePathAsk,
  MessagePathTarget,
  SessionPathTarget,
} from './resources'
import type {
  AnswerActionInput,
  CancelQueuedMessageInput,
  CreateSessionInput,
  EarlierHistoryInput,
  EndPlanModeInput,
  LaunchInput,
  LookInput,
  RespondPermissionInput,
  RespondUserInputInput,
  ResumeInput,
  SendInput,
  SessionInput,
  SetApprovalModeInput,
  SetSessionSettingInput,
  StartAndSendInput,
  StopBackgroundWorkInput,
} from './sessions'
import type { Provider } from '@brobot2/shared'

/** The renderer→main command union — the wire shape `runtimeCommandSchema` validates. */
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
  /**
   * 🔴 **633 · one door for *write this conversation out*, and one kind of it carries a BODY.**
   *
   * ⛔ **`readingBody` is Markdown the RENDERER composed from `TranscriptItem[]`** — the fold the
   * screen is made of — and it is present only for `exportKind: 'reading'`. ⚑ For that kind the
   * host writes bytes and composes nothing; for the other two it reads the provider's file and
   * this field is absent. `HO-095` §4 is why: a second fold in main would be a second source of
   * truth about one conversation.
   *
   * ## ⚠️ It is an OPTIONAL field and not a second union member, and that is a limitation rather
   * than a preference
   *
   * ⛔ **`runtimeCommandSchema` is a `z.discriminatedUnion('kind', …)`**, so two members sharing
   * `kind: 'exportSession'` cannot be told apart by it — the parse picks one and the inferred type
   * loses the other. 🔴 **So the pairing lives in TWO places instead of in the shape**: the zod
   * member refines it (a `reading` without a body, or a body without `reading`, is refused at the
   * boundary), and {@link RuntimeHost.exportSession} refuses it again. ⚑ **{@link ExportAsked} —
   * what a CALLER hands the bridge — IS discriminated**, because nothing parses it and the type
   * can say it there.
   *
   * ⚠️ **Bounded at the wire by {@link MAX_READING_BYTES}**, and the refusal names the size.
   */
  | {
      kind: 'exportSession'
      sessionId: string
      exportKind: ExportKind
      readingBody?: string
    }
  | { kind: 'importBundleFile'; path: string }
  | ({ kind: 'resume' } & ResumeInput)
  | ({ kind: 'look' } & LookInput)
  /**
   * ⚑ **This window no longer has the conversation open** — see {@link RuntimeBridge.stopLooking}.
   */
  | ({ kind: 'stopLooking' } & SessionInput)
  | ({ kind: 'startAndSend' } & StartAndSendInput)
  /**
   * **Stop a launch that has not answered yet** (102) — a create or a reopen, named by the window
   * that started it. A no-op answer (`false`) when there is nothing to cancel, because the launch
   * may have completed between the press and this arriving, and that race has to be survivable.
   */
  | ({ kind: 'cancelLaunch' } & LaunchInput)
  /**
   * **What the host is holding for this window right now** (100).
   *
   * Parameterless, on the same principle `capabilities` follows: asking about one
   * session would mean naming one, and the whole point is that the asker has just discovered it
   * does not know which sessions exist. The answer is every session the host holds for THIS
   * surface, already attached — see `RuntimeHost.attachOpenSessions`.
   */
  | { kind: 'attachOpen' }
  /**
   * 🔴 **Take over a conversation nobody owns** (336 §2.2).
   *
   * ⛔ **Named, unlike `attachOpen`, and that is the difference between the two.** `attachOpen` asks
   * *"what is already mine"* and can therefore be parameterless and automatic; this one says *"make
   * this one mine"*, so it must carry the id and must be asked for on purpose. A parameterless
   * version would hand the first window that reloaded every session nobody had claimed.
   *
   * ⚠️ **It cannot take a conversation from another window.** The host's rule is that a claim is
   * legal only where there is no owner at all; a session held for anybody — this surface included —
   * is refused with a sentence saying which. See `RuntimeHost.claimSession`.
   *
   * ⚑ **Nothing in the app sends this yet, and that is the shape of the dispatch that added it.**
   * The door has two sides: a session that exists without a renderer, and a renderer that can take
   * it over. The callers that will create one — an MCP tool, a dispatch — arrive with the rails,
   * deliberately together, so the rails cannot be optional once.
   */
  | ({ kind: 'claim' } & SessionInput)
  /**
   * 🔴 **Give a conversation back to nobody, on purpose** (523 — `519` item 3, HO-045 §1).
   *
   * ⛔ **The inverse of `claim` above and NOT a small `close`.** A close stops the provider child,
   * waits for its termination witness and terminalizes the row; this changes who is watching and
   * nothing else. ⚠️ The conversation keeps running, keeps its commander, keeps its approval mode
   * and keeps its ledger — `RuntimeHost.releaseSession` writes `ownerId` and the sink and touches no
   * store at all.
   *
   * ⚑ **Refused unless the caller OWNS it and it was `CreatedSession.startedWithoutAWindow`.** A
   * stranger gets `not-yours`, the same sentence every other gesture on somebody else's conversation
   * gets; the owner of a conversation this window STARTED gets `started-here`, because there is no
   * prior owner to return it to and closing the window would end it either way.
   */
  | ({ kind: 'release' } & SessionInput)
  /**
   * 🔴 **What is waiting on a person, with the chain that explains why** (398, criterion 11).
   *
   * ⛔ **No arguments, and there is nothing it could take.** A person is not inside one family, so
   * there is no id that would narrow this without turning *"what is waiting on ME"* into *"what is
   * waiting under that conversation"* — which is {@link RuntimeHost.questionsWaitingOn}, a parent's
   * question, already answered by a tool.
   *
   * ⚠️ **It reads and it rules nothing.** Answering is still `respondUserInput` on the child, where
   * the card actually is; this says what a person has been left holding, which is the half that did
   * not exist. ⛔ Nothing is claimed, nothing is taken over, and calling it twice costs two reads.
   */
  | { kind: 'questionsForAPerson' }
  /**
   * 🔴 **What only a person may settle, and never travelled to anybody** (403, from `402` F1).
   *
   * ⛔ **A second verb rather than an argument to the one above**, because the two carry different
   * guarantees. {@link questionsForAPerson} is *a question a parent failed to answer in time*, and
   * criterion 10's negative rides on its being unable to return a permission. This is *a request
   * no parent was ever allowed to be asked*. ⚑ Widening the first would have widened every
   * question its predicate answers; see `RuntimeHost.decisionsForAPerson`.
   *
   * ⚠️ **No arguments, for the same reason as above**: a person is not inside one family.
   */
  | { kind: 'decisionsForAPerson' }
  /**
   * 🔴 **Which providers have walled, and when work comes back** (533, HO-052 §4).
   *
   * ⛔ **A FOURTH verb in the one look, and the first that is not a thing a person owes.** Two real
   * runs, two days, both providers: each hit a weekly limit and the only record was a non-fatal
   * `error` row in a transcript nobody was reading. ⚑ The PO ruled it belongs where everything else
   * that needs him belongs — so it arrives on the same poll and is drawn by the same surfaces, and
   * it is carried BESIDE the queue's rows rather than as one, because a wall cannot be answered.
   *
   * ⚠️ **No arguments, for its three siblings' reason and one of its own**: a limit is a fact about
   * a PROVIDER's account, not about a conversation and not about a project. ⛔ Not even the
   * instant — `RuntimeHost.limitsForAPerson` reads the host's clock, so a window cannot keep a wall
   * standing by being wrong about the time.
   */
  | { kind: 'limitsForAPerson' }
  | { kind: 'readLimitsDisplay' }
  /**
   * ⚑ **D-017 · R19 — every ask an agent made against an identity's instructions that nobody has
   * answered, across every conversation** — the one thing *Waiting on you* owes a person that the
   * reads beside it do not carry. ⚠️ No arguments, for its siblings' reason: a person is not inside
   * one conversation, and what a window holds decides nothing here.
   */
  | { kind: 'instructionAsksForAPerson' }
  /** Every agent's request to register an MCP server that waits on a person, oldest first. */
  | { kind: 'mcpServerRequestsForAPerson' }
  /**
   * 🔴 **Work that has stopped with nobody left to tell** (557, HO-018 §2.1 · criterion 4).
   *
   * ⛔ **A FIFTH verb in the one look, and the second that is not a thing a person owes an answer
   * to.** `555` §3.1 measured that HO-062 §2's *the task stalls and the parent is told* holds only
   * while the giver is LIVE in the host — and HO-018 §2.2 removed the timeout, so a giver never
   * relaunched was told by nothing. ⚑ This is the recipient of last resort, and it is a READ:
   * nothing here decides that work has failed.
   *
   * ⚠️ **No arguments, for its four siblings' reason**: a person is not inside one family, so the
   * walk is every conversation this app has ever given work to. ⛔ Not the instant either — the
   * rows carry {@link StalledWork.stalledAt} and the window words the age against its own clock,
   * exactly as it does for a question's.
   */
  | { kind: 'stalledWorkForAPerson' }
  /**
   * Work a conversation gave whose holder has stopped with it, its giver told: what *Waiting on
   * you* draws to look at or hand back ({@link StoppedWorkForAPerson}). ⚑ No arguments, for its
   * siblings' reason: a person is not inside one family.
   */
  | { kind: 'stoppedWorkForAPerson' }
  /** This run's publisher, which every stamped answer and notice names. No arguments. */
  | { kind: 'currentEpoch' }
  /** The person's queue as one stamped publication ({@link PersonsQueueAnswer}). No arguments. */
  | { kind: 'personsQueue' }
  /** Both halves of the listing as one stamped publication ({@link ListingAnswer}). No arguments. */
  | { kind: 'listConversations' }
  /**
   * The open pieces no other list shows a person, with what is wrong with each
   * ({@link WorkIncident}). ⚑ No arguments, for its siblings' reason.
   */
  | { kind: 'workIncidentsForAPerson' }
  /**
   * 🔴 **F097 · the work whose agent answered a person, and waits on their next words** — a piece a
   * conversation gave whose holder's latest turn a person's own words opened and that ended with it
   * open. ⚑ Owed by a person, so *Waiting on you* draws it and the rail's badge counts it.
   *
   * ⚠️ **No arguments, for its siblings' reason**: a person is not inside one family, so the walk is
   * every conversation this app has ever given work to. ⛔ Not the instant either — the rows carry
   * {@link WaitingOnWhoWrote.answeredAt} and the window words the age against its own clock.
   */
  | { kind: 'waitingOnWhoWroteForAPerson' }
  /**
   * 🔴 **The digest: what every placed conversation's ledger recorded inside a window a person
   * chose** (438, HO-025 §2 criterion 16).
   *
   * ⛔ **`from` and `to` are REQUIRED and there is no default.** A digest whose window the app
   * picked silently would be making the one claim `430` measured that this app cannot make — it
   * found no durable per-person last-view marker anywhere in the schema, the IPC surface or the
   * renderer, so *"while you were away"* is not answerable and *"a window you chose"* is.
   *
   * ⚠️ **Half-open `[from, to)`**, so two adjacent windows cannot both contain a row stamped on
   * the boundary.
   *
   * ⚑ **It reads and it rules nothing** — {@link questionsForAPerson}'s note, one surface over.
   * Every act a digest line might invite is somewhere else, and this dispatch moved none of them.
   */
  | { kind: 'digest'; from: number; to: number }
  | { kind: 'recentActivity'; from: number; to: number }
  /**
   * 🔴 **The work one conversation GAVE OUT** (508) — see {@link WorkGivenOut}.
   *
   * ⛔ **It names the GIVER and nothing else.** The answer is the set of work that conversation
   * handed out, wherever it went, so a holder here would narrow the question rather than argue
   * it.
   *
   * ⚠️ **No window, no page and no limit** (HO-025 §2): a list a person reads to find out what they handed out is a list of
   * obligations and not a summary. ⛔ A page here would make *"that is all I gave out"* a claim
   * about a page.
   *
   * ⚑ **It reads and it rules nothing, and it offers no act.** `withdraw_task` is an AGENT's door
   * onto this work and stays one; the window surface fed by this read draws no control at all.
   * ⛔ Never a root: a root is given by a person and holds no row here (D-016 · R1).
   */
  | { kind: 'workGivenBy'; sessionId: string }
  /**
   * 🔴 **Who called whom, for ONE conversation** (543, `540` §7 slice 1) — see
   * {@link WhoCalledWhom}, which carries the whole argument.
   *
   * ⛔ **One command and not four, and that is what makes {@link WhoCalledWhom.readAt} honest.**
   * `540` MI-19 ruled the condition rather than the answer: *"One timestamp is honest only if the
   * host performs one atomic/defined aggregate read and records the common completion point."*
   * ⚠️ Four round trips on four clocks could not have one, and per-scope times would have been the
   * only truthful alternative.
   *
   * ⚑ **`sessionId` and nothing else.** No depth, no page, no limit and no filter: the answer is the
   * DIRECT edges of one conversation, which is the whole of slice 1, and a bound nobody has
   * measured is how a walk becomes a hang (`SessionStore.depthOf`'s own CTE is bounded at 64 for
   * exactly that reason).
   *
   * ⛔ **It reads and it offers no act.** Nothing here opens, claims or switches a window —
   * `gestureOf` correctly offers no gesture for `open-in-another-window`, and this read carries the
   * raw {@link RunningState} so that answer stays REACHABLE rather than collapsed.
   */
  | { kind: 'whoCalledWhom'; sessionId: string }
  /**
   * 🔴 **Two counts and one moment** (567, `564`'s second slice) — see {@link WorkspaceReading},
   * which carries the whole argument.
   *
   * ⛔ **One command and not four, and that is what makes {@link WorkspaceReading.readAt} honest.**
   * `564`'s warning is the reason it exists: *"a renderer sum would race the separate reads."*
   *
   * ⚑ **`readWorkspace` and not v2.10's `refreshWorkspace`.** The name is load-bearing: v2.10's
   * own third honesty rule is *"Delivering a refresh intent, resolving its callback or repainting
   * the page never produces a newer reading"*, and a verb named *refresh* is an invitation to
   * stamp the intent instead of the measurement.
   *
   * ⚑ **No arguments at all.** No window and no page: the answer is about the whole workspace, so
   * any field here would narrow the question rather than ask it.
   *
   * ⛔ **It reads and it offers no act**, and it is on the window wire and on no toolset.
   */
  | { kind: 'readWorkspace' }
  /**
   * 🔴 **What each conversation this app is running was last told it is DOING** (575,
   * `HO-063` §3) — see {@link WhatIsBeingDone}, which carries the whole argument.
   *
   * ⛔ **No arguments at all, and here that is a ruling rather than {@link readWorkspace}'s
   * economy.** The answer is the WHOLE population this app is running, because a complete reading
   * is what makes *this app is running nothing for that identity* a sound inference — a set the
   * caller named would bound the answer by the question it happened to ask, and *"nothing is
   * running in this project"* is the one sentence a roster must never say by accident (`452` §5.1).
   * ⚑ The two questions the two surfaces ask are `byConversation` and `byIdentity`, both in the
   * shared module, so neither component writes the selection a second time.
   *
   * ⛔ **It reads and it offers no act**, and it is on the window wire and on no toolset — which
   * matters more here than for a count: this says what every OTHER conversation in the app is
   * doing, and that is not a fact this app hands to a conversation.
   */
  | { kind: 'whatIsBeingDone' }
  /**
   * 🔴 **What each conversation this app is running is WAITING ON** (621, `HO-095` §5.1) — see
   * {@link WhatEachConversationIsWaitingOn}.
   *
   * ⛔ **No arguments at all, and it is {@link whatIsBeingDone}'s ruling rather than an economy.**
   * The answer is the whole population, because a complete reading is what makes *this
   * conversation is waiting on nothing* readable at all; a set the caller named would bound the
   * answer by the question it happened to ask.
   *
   * ⚑ **Its own verb and not a field on the neighbouring one**, because that read promises *"No
   * store read of any kind"* and this one takes three narrow ledger reads per conversation. ⚠️ A
   * caller that wants both takes them in one `Promise.all` and stamps its own instant (`588`).
   *
   * ⛔ **It reads and it offers no act**, on the window wire and on no toolset — it says what every
   * OTHER conversation in the app is waiting on, which is not a fact this app hands to a
   * conversation.
   */
  | { kind: 'whatEachConversationIsWaitingOn' }
  /**
   * One forest reading: the workspace in one window, or the whole top-level tree holding a
   * conversation — see {@link ForestReading}. A read that offers no act, on the window wire only.
   */
  | { kind: 'forestReading'; scope: ForestScope }
  /**
   * A later page of a forest reading's nodes — see {@link ForestNodesPage}. `drawn` is every
   * conversation the reading lists, so the page names parents and givers as the reading does.
   */
  | { kind: 'forestNodes'; drawn: string[]; conversations: string[] }
  /**
   * 🔴 **D-018 · the memory each running conversation's provider process holds** — see
   * {@link ProcessMemory}.
   *
   * ⛔ **No arguments at all, and it is {@link whatIsBeingDone}'s ruling**: the answer is the whole
   * running population, and the pids are the ones main's adapters hold — a pid on the wire would be
   * a renderer naming a process for main to read.
   *
   * ⛔ **It reads and it offers no act**, on the window wire and on no toolset — what a process
   * costs is a person's fact, and never one an agent reads (`05` rule 5).
   */
  | { kind: 'processMemory' }
  | ({ kind: 'listLibrary' } & LibraryQuery)
  | ({ kind: 'importRecordedSession' } & SessionInput)
  | { kind: 'importUserHomeSession'; provider: Provider; providerSessionId: string }
  | { kind: 'rebuildLedger'; sessionId: string }
  | ({ kind: 'readWorkflowOutput' } & SessionInput & { taskId: string })
  // 356. Keyed on an INDEX into the list this session's provider reported, never on a path — see
  // `main/instruction-source.ts` for why provenance alone is not the whole confinement.
  | ({ kind: 'readInstructionSource' } & SessionInput & { index: number })
  // 356. The one gesture that leaves the app: it shows a path in the file manager and launches
  // nothing. (Reading a config file onto the app's own paper is `readConfigFile`, below — `733`.)
  | ({ kind: 'revealPath' } & SessionInput & { target: SessionPathTarget })
  // 733. The config file's NAME, as `ProviderConfigFile` gave it — the row, never a path.
  | ({ kind: 'readConfigFile' } & SessionInput & { name: string })
  // 300. Keyed on the TOOL CALL, which is the handle `300` §1 asks for — measured to be the same
  // string the provider puts on its own output deltas. Never a pid and never a process id: this
  // reads a buffer the adapter filled, and touches neither the wire nor the disk.
  | ({ kind: 'readCommandOutput' } & SessionInput & { toolCallId: string })
  // 462. The same key as the read above it and for the same reason: the TOOL CALL's own id, which
  // is the string the transcript row already carries. ⛔ Nothing here is a path, a pid or an index —
  // it reads a bounded hold the adapter filled off its own stream, so a guessed string reaches
  // nothing rather than reaching something it should not.
  | ({ kind: 'readToolAnswer' } & SessionInput & { toolCallId: string })
  // 🔴 **510 · one resource, for the person whose row names it** (a document until D-016). ⛔ **No
  // `SessionInput`, and its absence is the design**: a resource id is a primary key in this app's
  // own table, not a thing a conversation owns, and a session here would be a narrowing of the
  // question rather than an argument to it. ⚠️ The AGENT's door stays `read_document`; this one is a
  // window's (HO-005, *"the human is unrestricted"*), and both read under this app's own resources
  // folder and re-check the hash. ⛔ No path, as with every read above: what the two doors differ
  // in is the vocabulary each answers in.
  | { kind: 'readResource'; resourceId: string }
  // 🔴 **D-032 · a kept picture or PDF, for the person who opened it**, and the same file shown in
  // Finder — both by its id, as the read above, on the window wire and on no toolset. ⛔ No path:
  // main finds the file from its row and holds it inside its resources folder.
  | { kind: 'drawResource'; resourceId: string }
  | { kind: 'revealResource'; resourceId: string }
  // Paths a message wrote: resolved, opened if they are documents, or shown. Main resolves the text
  // on every call; the renderer never hands it a path to open.
  | ({ kind: 'resolveMessagePaths' } & MessagePathAsk)
  | ({ kind: 'openMessagePath' } & MessagePathTarget)
  | ({ kind: 'revealMessagePath' } & MessagePathTarget)
  /**
   * 🔴 **D-026 · R1 — the files kept in one scope, for a person** — see {@link FilesKept}.
   *
   * ⚑ **One door, three ways** ({@link FilesKeptScope}): a conversation's tree, one conversation,
   * or one piece. ⛔ **It reads and it offers no act** — on the window wire and on no toolset, as
   * `whoCalledWhom` is. ⚠️ **No page and no limit**, `workGivenBy`'s argument: a list a person reads
   * to find a file is not a summary.
   */
  | ({ kind: 'filesKept' } & FilesKeptScope)
  | { kind: 'filesLibrary'; request: import('../files-library').FilesLibraryRequest }
  | { kind: 'teamProfileGraph'; request: import('../team-profile-graph').TeamProfileGraphRequest }
  | { kind: 'searchWork'; conversation: string; query: import('../work-search').WorkSearchQuery }
  // 112. Keyed on the AGENT even for the journal and the script, because the run id those two are
  // filed under is the one thing the provider does not put on the wire — see `main/child-work.ts`.
  | ({ kind: 'readChildWork' } & SessionInput & ChildWorkInput)
  // 296. Keyed on the same `agentId` the transcript read is, and gated by the same ledger allowlist
  // — a child this session never reported is not a child this app will ask about or speak to.
  | ({ kind: 'readChildState' } & SessionInput & { agentId: string })
  | ({ kind: 'sendToChild' } & SessionInput & { agentId: string; text: string })
  | ({ kind: 'earlierHistory' } & EarlierHistoryInput)
  | ({ kind: 'latestHistory' } & SessionInput)
  | { kind: 'capabilities' }
  | { kind: 'providerCatalogue' }
  | { kind: 'providerConnections' }
  /**
   * 🔴 **D-042 · R3 — the one list a person picks from**, for one provider and one agent
   * ({@link ModelList}). ⚑ `profileId` absent is BroBot's own.
   */
  | ({ kind: 'modelList' } & ProviderProfileInput)
  | ({ kind: 'providerLaunchChoices' } & ProviderProfileInput)
  | ({ kind: 'resolveProviderLaunch' } & ResolveProviderLaunchInput)
  /**
   * ⚑ **D-042 · R3 — a person adds a model to a provider's list by hand.** ⛔ Never checked when added:
   * no test call, nothing spent. A provider that refuses it says so at the call that names it.
   */
  | { kind: 'addHandAddedModel'; provider: Provider; model: string }
  /** ⚑ **D-042 · R3 — a person takes a model they added off the list.** */
  | { kind: 'deleteHandAddedModel'; provider: Provider; model: string }
  /** 🔒 **Where a provider's API key stands** ({@link ApiKeyStatus}) — never the key. */
  | { kind: 'apiKeyStatus'; provider: Provider }
  /**
   * 🔒 **A person keeps an API key for a provider**, replacing any before it. The one time a key
   * crosses the wire, and only this way: nothing ever sends one back.
   */
  | { kind: 'setApiKey'; provider: Provider; key: string }
  /** 🔒 **A person stops using a provider's API key**; the provider runs on its login again. */
  | { kind: 'removeApiKey'; provider: Provider }
  /** 🔒 **A person asks the provider whether it accepts the key that is set** ({@link ApiKeyCheck}). */
  | { kind: 'checkApiKey'; provider: Provider }
  /** ⚑ **Each provider's program as this install bundles it** ({@link ProviderVersion}). */
  | { kind: 'providerVersions' }
  /** Every rule an *Always allow* kept beyond its conversation, file by file ({@link KeptRules}). */
  | { kind: 'keptRules' }
  /** 🔒 **A person removes one kept rule** from the file it is kept in ({@link KeptRuleRemoved}). */
  | { kind: 'removeKeptRule'; provider: Provider; file: string; kept: string }
  /** How a person puts each provider's own login on this computer ({@link ProviderSetup}). */
  | { kind: 'providerSetup' }
  /** ⚑ **Each provider's newest usage reading, per metered window** ({@link ProviderUsageReading}). */
  | { kind: 'providerUsage' }
  /**
   * ⚑ **What the agent processes this app started use, per provider** ({@link ProviderResources}) —
   * measured when asked, at most every five seconds; nothing is measured while nobody asks.
   */
  | { kind: 'providerResources' }
  /**
   * **Which profiles exist** (167). Parameterless for `capabilities`' reason: the
   * launcher asks before a session exists, and there is nothing to ask ABOUT — the answer is every
   * profile this app has laid a home down for, plus the default one, which is offered whether or not
   * anything is on disk yet.
   */
  | { kind: 'profiles' }
  // 098 — the credential a profile runs on. Keyed by profile, because a credential belongs to a
  // provider home and "is Codex signed in?" therefore has one answer per profile, not one answer.
  | ({ kind: 'checkProviderAuth' } & CheckProviderAuthInput)
  | ({ kind: 'reprovisionProviderAuth' } & ProviderProfileInput)
  | { kind: 'reprovisionProviderHomes'; provider: Provider; statusOnly?: boolean }
  | ({ kind: 'signInProvider' } & ProviderProfileInput)
  | ({ kind: 'cancelProviderSignIn' } & ProviderProfileInput)
  /**
   * **Would the launch accept this folder** (203, from 195 H4) — the typed half of 076 §3's picker.
   *
   * ⛔ **Answered by asking the launch itself**, not by a second copy of the rule: `RuntimeHost`
   * runs the very `resolveCwd` a `createSession` would run. 076 §3 already refused a second
   * statement of this rule — *"two statements of one rule, the friendlier one drifting, and the
   * drift landing in a security check"* — and the same argument applies one layer up.
   *
   * ⚠️ **Advisory, and the host stays the authority.** A folder can be deleted between the answer
   * and the press, so this is what stops the app OFFERING a gesture it knows cannot work; it is not
   * what makes the launch safe. That is the ordering fix in `startSession`.
   */
  | { kind: 'checkCwd'; path: string }
  /**
   * 🔴 **Every agent identity, with what it may do** (355, HO-008 §3 · P0b).
   *
   * ⚑ **The read half of the door `341` deliberately left out.** It listed the reasons: *"an agent
   * can only ever be spawned into an identity a person has already brought into being"*, with the
   * grant arriving through a configuration door that did not exist. This is that door's threshold —
   * and it is a PERSON's door, refused for anything the window sink does not declare a person
   * behind (349).
   */
  | { kind: 'agentIdentities' }
  /**
   * 🔴 **Grant, narrow, or hand a capability back to the default** (355).
   *
   * ⛔ **Every field, always, each either a value or `null`** — {@link CapabilityGrant}, and 339's
   * `.nullable()` ruling is why. A payload that omitted a field would be indistinguishable from one
   * clearing it, and the difference is whether a row that has chosen NOTHING keeps following the
   * ruled default. `null` is the person saying *use the default*; the store writes NULL.
   *
   * ⚠️ **It cannot create an identity, and that refusal is the store's** (criterion 12). A slug with
   * no row answers `null` — *there is nothing here to configure* — rather than minting one.
   */
  | {
      kind: 'setCapabilities'
      profileId: string
      grant: CapabilityGrant
      /**
       * 🔴 **516 · every RESTRICTED server this identity is granted, COMPLETE** (`507` §5, narrowed by 524).
       *
       * ⛔ **Required, and never optional.** An omitted key and an empty list would be
       * indistinguishable, and the difference is *this caller does not know about external servers*
       * versus *this person unticked every box* — 339's `.nullable()` ruling, arriving on a field
       * whose *nobody has chosen* state does not exist because row presence IS the grant.
       *
       * ⛔ **It rides on this command rather than a verb of its own** so the capability columns and
       * the grants commit in ONE transaction: the sheet has one Save button, and two commands behind
       * one press can half-succeed. ⚠️ **It is NOT part of {@link CapabilityGrant}** — `507` §5:
       * server ids *"are a related capability grant with a different relational shape"*, and a set
       * of rows in another table cannot go into a `Record<CapabilityKey, …>`.
       *
       * ⚑ **An id naming no registered row writes nothing**, which is the foreign key rather than a
       * check — a sheet left open while another window removed a server must not fail its save.
       */
      externalMcpServerIds: readonly string[]
    }
  /**
   * 🔴 **Register one external MCP server, globally** (516, HO-040 §4.2) — a PERSON's verb, on no
   * toolset.
   *
   * ⛔ **Registration decides who it is for, and the default is EVERYONE** (524, `HO-048` §1).
   * HO-040 §4.2 had split the act in two — register, then grant per identity — and the PO withdrew
   * that default: *"an argument about one agent that does not exist yet, applied to every agent that
   * does."* ⚑ So `reach` rides on this command, and `setCapabilities`' `externalMcpServerIds` is
   * what reaches a server somebody deliberately restricted.
   *
   * ## 🔴 It is the REFUSAL RAIL, and the refusal is not a validation error
   *
   * ⛔ **The host asks the server what it offers and refuses the WHOLE server** if any raw tool name
   * is one of ours (HO-040 §4.3, `HO-042` §2). ⚠️ So this verb makes a network call to an address a
   * person typed — bounded, loopback-only, and the only outbound request any command on this wire
   * makes. ⚑ Every refusal carries a sentence naming what to do about it (`425`).
   *
   * ⚠️ **There is deliberately no save verb.** The URL is immutable (`HO-042` §6) — *"a mutable URL
   * would let one global row silently retarget every identity that already trusted it"* — so
   * changing an address is remove-and-add, which cascades the grants away and makes a person grant
   * the new target deliberately.
   */
  | {
      kind: 'registerExternalMcpServer'
      name: string
      url: string
      /**
       * 🔴 **524 · who the server is for, chosen once at registration** (`HO-048` §1).
       *
       * ⛔ **Required on the wire and not optional-with-a-default.** An absent field would put the
       * ruling in the schema as well as on the form, which is two spellings of one rule (`169` §1) —
       * and the half that drifts is the one that decides who reaches a tool server. ⚑ The zod row
       * spells the two words and nothing else; a payload that names a third is refused whole, which
       * is the boundary's job rather than the fold's.
       */
      reach: ExternalMcpServerReach
    }
  /**
   * 🔴 **Remove one registered server, and every grant naming it** (516).
   *
   * ⛔ **The cascade is the schema's**, and {@link EXTERNAL_MCP_REMOVAL_MEANS} is the sentence a
   * person reads BEFORE the press rather than the toast they read after it.
   *
   * ⚠️ **Nothing running moves.** A conversation's servers are fixed by the query it was started
   * with (`307`), so this reaches the next launch — which the sheet says, beside the grants.
   */
  | { kind: 'removeExternalMcpServer'; serverId: string }
  /**
   * 🔴 **Which provider this identity's NEXT conversation starts on** (433, HO-024 §2.1/§2.2) — the
   * verb that makes *"changeable"* true, and a PERSON's door.
   *
   * ## ⛔ It is not a capability, and it is deliberately not on {@link CapabilityGrant}
   *
   * ⚠️ **A capability is something an identity may DO and a rail reads.** No rail reads `provider`:
   * it grants nothing, refuses nothing, and `419` §3 put it on its own column for that reason —
   * which is why `agent_identity.provider` had exactly ONE writer before this verb, and why folding
   * it into `CAPABILITY_COLUMNS` would make the capability writer answer two questions. ⛔ **So it
   * is its own verb, with its own payload, saved by its own gesture** — and the sheet's Save still
   * sends a whole {@link CapabilityGrant} and nothing else.
   *
   * ## 🔴 It reaches no conversation, running or recorded
   *
   * ⛔ **HO-024 §2.1 reverts HO-023 §3 and restores HO-022 §3:** provider is a property of the
   * SESSION, with a per-identity default. *"The identity carries a default; a session takes it at
   * launch; once started it is fixed."* ⚑ `417` measured the mechanism — `provider` is the one
   * REQUIRED field of `CreateSessionInput`, no `UPDATE provider_session` sets it, and
   * `createRuntime` returns a different class per provider — and `427` measured that the column is
   * READ at a launch. ⚠️ **The case that reverted the ruling is *the same identity on Codex in one
   * project and Claude in another*, so a write here that moved a live conversation would delete
   * it.** `a-front-door-that-asks-nothing.test.ts` §1 is the census that keeps that true.
   *
   * ⚠️ **`null` is *use the app's fallback*, and it is the gesture that makes the choice
   * reversible** — the capability sheet's `Use the default`, one column over. A person who cleared
   * a choice has said something different from a person who chose the fallback's value, and the
   * column can hold both.
   *
   * ⛔ **It cannot create an identity**, which is `setCapabilities`' refusal and criterion 12: a
   * slug with no row answers `null`.
   */
  | { kind: 'setAgentProvider'; profileId: string; provider: Provider | null }
  /**
   * 🔴 **Correct what an identity is CALLED** (558, `HO-063` gap 2) — the rename, and the second
   * statement in this app's life that writes `display_name`.
   *
   * ⛔ **It is the unlock for gap 2 rather than the whole of it.** `538` declined to make BroBot
   * invent a display name on two measurements; this retires the second — *"there is no rename, so
   * an invented word would be permanent and uncorrectable"* — and leaves the first, which is that
   * `create_agent`'s own published sentence makes an omission the model ANSWERING. ⚑ **Whether the
   * app should invent one is still that first measurement's question.**
   *
   * ⚠️ **`null` is *nobody has named this identity*, written back into the column**, which is the
   * gesture that makes a name reversible — {@link RuntimeCommand} `setAgentProvider`'s own shape
   * one field over. A blank string folds to it main-side.
   *
   * ⛔ **It cannot create an identity**, which is criterion 12 through a third configuration door:
   * a slug with no row answers `null`.
   */
  | { kind: 'setAgentDisplayName'; profileId: string; displayName: string | null }
  /**
   * 🔴 **D-016 · commit 7 · R4 — a person renames a piece a person gave**: a root, or work its owner
   * took on for them. It writes `work_retitled` with `by: null` into the owner's ledger; the newest
   * title wins everywhere, and nobody is told. ⛔ A piece a conversation gave is that conversation's
   * to name: refused.
   *
   * ⚑ `piece` is its label (`W1`) or its id; `title` is what the person typed, trimmed main-side.
   */
  | { kind: 'retitleWork'; piece: string; title: string }
  /**
   * A person takes back the piece a service is on, by its label or its id: the service is told to
   * stop working on it and its turn on it is asked to stop, the conversation that gave it is told
   * it is no longer owed, and the service goes on to its next piece. ⛔ Any other piece: refused.
   */
  | { kind: 'takeBackWork'; piece: string }
  /**
   * A person closes stopped work, by its label or its id: a piece a conversation gave whose holder
   * stopped with it, or a `stopped` work incident. It ends at `closed`, as its giver's close ends it:
   * its holder is told to stop, and the conversation that gave it, if any, that it is no longer owed.
   * ⛔ Any other piece: refused.
   */
  | { kind: 'closeWork'; piece: string }
  /**
   * 🔴 **Set this identity's DEFAULT model and effort — what its new conversations start on** (677;
   * D-042 · R2) — or clear it with `provider: null`.
   *
   * ⚑ **Validated against the list** before anything is written — `shared/model-choice.ts`'
   * `judgeAgainstTheList`, which a control can ask before the press.
   *
   * ⚑ **Flat, and every field a primitive** — `provider` names the provider the model and the effort
   * belong to; `null` for all three clears the default. ⛔ **D-042 · a provider needs a model**: a
   * default is a model and the effort it runs at, so `provider` with no `model` — or a model or an
   * effort with no provider — is refused at the wire's schema. ⚠️ `effort` `null` is the model's own
   * default effort, named by the door.
   *
   * ⛔ **It cannot create an identity**: a slug with no row answers `no-such-agent`, criterion 12
   * through a fifth configuration door.
   */
  | {
      kind: 'setAgentModelAndEffort'
      profileId: string
      provider: Provider | null
      model: string | null
      effort: string | null
    }
  /**
   * ⚑ **Read the default {@link RuntimeCommand} `setAgentModelAndEffort` wrote** (677) — `null` when
   * it has none, and when there is no such identity (`providerOf`'s collapse, one column over).
   *
   * ⚠️ **Its own verb and not a field on `AgentIdentity`**: that row is hand-built, whole, in dozens
   * of test fixtures — most of them under `test/dom`, which is the frontend seat's — and a required
   * field would be a change to every one of them from a seat that may not touch them.
   */
  | { kind: 'agentModelAndEffort'; profileId: string }
  /**
   * 🔴 **Write one identity's OWN INSTRUCTIONS — the `configured` layer's person-shaped feeder**
   * (582, `HO-009` §2.2, `HO-063` gap 4).
   *
   * ⛔ **It APPENDS a version and never replaces one.** `HO-009` §1.2 makes *what the rule used to
   * be* the safety property of this whole layer, so there is no edit verb on this wire and there
   * must not be — see `identity_instruction`.
   *
   * ⚑ **`text: ''` is a real save** and means *take them away*: it writes a version carrying no
   * rules, which is a dated, attributed act, where deleting the row would be the one thing the
   * ruling forbids.
   *
   * ⚠️ **`broughtBack` is what makes a REVERT a first-class act rather than a re-typed save.** It
   * names the version whose text this one carries, the schema CHECKs that it is earlier, and the
   * surface renders it. ⛔ **It is a claim about TEXT and about nothing else** — standing rule 11:
   * a revert restores rules and never re-grants a capability, a role or a name.
   *
   * ⛔ **It cannot create an identity**: a slug with no row answers `null`, which is criterion 12
   * through a fourth configuration door.
   */
  | {
      kind: 'instructAgent'
      profileId: string
      baseline?: RulesBaseline
      text: string
      /** The version this one brings back, or absent for new text. */
      broughtBack?: number
    }
  /**
   * 🔴 **Read one identity's own instructions, and every ask waiting against them** (582).
   *
   * ⛔ **ONE command for both, because a surface that read them separately could draw a history
   * that had moved since the asks it is showing beside it.** ⚑ The two are read in one call and a
   * person sees one moment.
   */
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
  /**
   * 🔴 **625 · read one identity's MEMORY, with no conversation open** (`EXT-015` §1).
   *
   * ⛔ **A second read rather than a field on `agentInstructions`**, and the reason is on this
   * wire rather than in the popup: {@link RuntimeCommand} `instructAgent` answers an
   * `AgentInstructionsReading` too, so folding a memory store into that type would make every rule
   * a person saves walk two provider homes. ⚑ `shared/agent-memory.ts` argues it in full.
   *
   * ⚠️ **It is LIVE, and that is the whole point.** `SessionInstructions.agentMemory` is what a
   * conversation was given at its launch; this is what is in the store when the popup opens —
   * `EXT-015` §0's *"only as of that conversation's launch"* is the defect it closes.
   *
   * ⚑ **F093 · C8 b — paged, when `offset` or `limit` is given**: each store's fixed files on the
   * first page, then its topic files or notes from `offset`, at most `limit` (100), with each
   * store's `total` and `nextOffset`. Without either, the first twenty, as before.
   */
  | { kind: 'agentMemory'; profileId: string; offset?: number; limit?: number }
  /**
   * 🔴 **F093 · everything a conversation's agent was given, as its last launch sent it** — the
   * agent-input popup's one read ({@link WhatThisAgentWasGiven}).
   */
  | { kind: 'whatThisAgentWasGiven'; sessionId: string }
  /**
   * 🔴 **F093 · C9 d — one message as the model got it** ({@link WhatTheModelGot}): the message at
   * that ledger place, or the one handed to the model at or before it.
   */
  | { kind: 'whatTheModelGot'; sessionId: string; ordinal: number }
  /**
   * 🔴 **625 · a PERSON removes or corrects one entry in an agent's memory** (`EXT-015` §3.2).
   *
   * ⛔ **`entry` is the path THIS APP produced in the reading, and it is never opened.** The main
   * side re-derives the store, looks this string up in what came back, and opens its OWN path —
   * the house ruling that the renderer never supplies a path, enforced by making the caller's
   * string an identifier rather than an argument to `join`.
   *
   * ⚑ **`act` and `text` rather than a nullable text**, because removing and correcting are
   * different acts and the record says which. ⚠️ `text` is ignored for `removed`; the zod schema
   * is where that is spelled, and `AMENDMENT_MEANS` is where the two words are argued.
   */
  | ({ kind: 'amendAgentMemory' } & MemoryAmendmentAsked)
  | ({ kind: 'undoAgentMemory' } & MemoryUndoAsked)
  | ({ kind: 'checkInterruptedMemory' } & MemoryCheckAsked)
  /**
   * 🔴 **A person approves or refuses what an agent asked against an identity's instructions**
   * (582, `HO-009` §2.2: *"A proposal is a card; approval writes it."*).
   *
   * ⛔ **Approval is the ONLY thing that writes a version**, and this door is the only way to reach
   * it. ⚠️ **There is deliberately no tool that
   * can end an ask**, which is `441`'s own structural negative one subject over.
   */
  | { kind: 'decideInstruction'; askId: string; approve: boolean }
  /**
   * A person approves or refuses one agent's request to register an MCP server. It carries only the
   * request's id: what is registered is read from the request itself. No tool can reach it.
   */
  | { kind: 'decideMcpServerRequest'; requestId: string; approve: boolean }
  /**
   * 🔴 **Remove an identity nothing runs** (558, `HO-063` gap 1) — the only verb in this app that
   * deletes a row a person can see.
   *
   * ⛔ **It refuses far more often than it succeeds, and the refusal is the feature.** FIVE things
   * hold an identity here and only two of them are foreign keys — a grant is a JSON list with no key
   * on it, a seed is a code constant, and a launch in flight has written no row at all; see
   * {@link RuntimeCommandResults.removeAgent} and `whatHoldsIt`.
   *
   * ⚠️ **It reaches no toolset and never will.** An agent that could remove an identity could
   * remove the one holding the grant that refuses it — which is `noPersonBehindIt`'s sentence
   * exactly: *changes what agents are allowed to do*.
   */
  | { kind: 'removeAgent'; profileId: string }
  /**
   * Archive a conversation and the helpers below it, or bring them back. A person's alone: it
   * changes what the person's lists show, and an agent tool reaches neither.
   */
  | { kind: 'archiveConversation'; sessionId: string }
  | { kind: 'restoreConversation'; sessionId: string }
  /** What deleting a conversation would remove, for the person to tick, read before a delete. */
  | { kind: 'checkDeleteConversation'; sessionId: string }
  /** Delete the parts of a conversation the person ticked, by the ids the check gave them. */
  | { kind: 'deleteConversation'; sessionId: string; parts: string[] }
  /**
   * 🔴 **Bring an identity into existence** (419, HO-023 §2.4 / §3) — a PERSON's door, and the verb
   * `417` left the app without when it deleted `+ New profile…`.
   *
   * ## ⛔ Why it is not `create_agent` with a different caller
   *
   * ⚠️ **HO-020 §4 licences two doors and this dispatch built both rather than deriving one from the
   * other.** The tool is gated — a capability, a kill switch, a refusal a model can read — because
   * an AGENT minting rows is an act this app bounds. ⛔ **No capability applies here.** HO-005:
   * *"BroBot is global; the human is unrestricted"*, and a person pressing a button in their own app
   * is not an identity holding a grant. ⚑ What the two DO share is the row they write and the
   * collision that refuses them, which is one store method with one transaction in it.
   *
   * ⚠️ **It creates a name and nothing else.** No project, no provider home, no capabilities, no
   * cwd — `RuntimeHost.createAgent` says what each of those would have cost, and §2 of this
   * dispatch's brief is about the one that would have been most expensive to get wrong.
   *
   * ⛔ **618 · and the AGENT's door no longer matches this sentence** (`HO-078` §4). `create_agent`
   * takes the new identity's own standing rules and writes the first version of them; this door
   * does not, and a person writes them on the identity's own sheet instead. ⚑ **Said here rather
   * than left to be inferred** — standing rule 8.2: a claim scoped to itself owes what the other
   * surface does, or a reader takes this paragraph for a fact about creation.
   */
  | ({ kind: 'createAgent' } & NewAgent)
  /**
   * 🔴 **The global kill switch** (341, HO-005 criterion 7) — one row, app-wide, and the one control
   * §1 of `355` asked to be *"reachable fast"*.
   *
   * ⚠️ **Nothing running is stopped.** It is a rail on CREATING conversations: `admitGive` asks it
   * only of a give that would start one — after the piece, the grant, the depth and the lookup,
   * once the lookup has found no conversation to give it to (D-016 ruling 12).
   */
  | { kind: 'setSpawningEnabled'; enabled: boolean }
  /**
   * Turn services on or off in this workspace: a person's choice, and off until they make it.
   * ⚑ Off stops nothing that runs: it holds back new work for services.
   */
  | { kind: 'setServicesOn'; on: boolean }
  /**
   * 🔴 **The mode every conversation a person starts begins in** (500, HO-036 §3.1) — *"a person
   * sets their approval mode once, and every conversation they start begins there."*
   *
   * ⛔ **It sets a DEFAULT and touches nothing that exists.** No conversation changes, running or
   * ended; `setApprovalMode` is the door that moves a live one and it applies from that
   * conversation's next message. ⚠️ This one is read at the next launch a PERSON makes, by the
   * renderer, and by nothing else — **the mode of a conversation a give starts is decided by
   * `admitGive`, and never here.** ⚑ What `admitGive` decides is `HO-036` §2's and is not this
   * dispatch's to state; what this sentence claims is only the negative, and
   * `the-setting-he-should-only-make-once.test.ts` §3 is where it is asserted.
   */
  | { kind: 'setDefaultApprovalMode'; mode: 'ask' | 'auto' }

export type RuntimeCommandKind = RuntimeCommand['kind']
