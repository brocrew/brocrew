import type { PersonsQueueAnswer } from '../../../shared/persons-published'
import type { MoveRequestAck } from '../../../shared/move-contracts'
import type {
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
} from '../../../shared/question-contracts'
import type { McpServerRequestForAPerson } from '../../../shared/conversation-events'
import type { WhatEachConversationIsWaitingOn, WorkGivenOut } from '../../../shared/task-contracts'
import type { WhatAPickBecame } from '../../../shared/model-choice-contracts'
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { ComputedRef, Ref } from 'vue'
import type { WhoCalledWhom } from '../../../shared/who-called-whom'
import type { ProviderLimitSeen } from '../../../shared/provider-limit'
import type { LimitsDisplayAnswer } from '../../../shared/limits-display'
import type { StalledWork } from '../../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../../shared/stopped-work'
import type { WorkIncident } from '../../../shared/work-incidents'
import type { WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
import type { InstructionAskWaiting } from '../../../shared/own-instructions'
import type { RecentActivityReading } from '../../../shared/recent-activity'
import type { WorkspaceReading } from '../../../shared/workspace-reading'
import type { WhatIsBeingDone } from '../../../shared/what-is-being-done'
import type {
  ForestReading,
  ForestListed,
  ForestNodesPage,
  ForestScope,
} from '../../../shared/the-whole-forest'
import type {
  AnswerAck,
  CreateSessionInput,
  PermissionDecision,
  ReleasedSession,
  SetSessionSettingInput,
  UserInputResponse,
  ChildWorkInput,
  ChildSendResult,
  ChildStateResult,
  CommandTail,
  ToolAnswer,
  ChildWorkResult,
  ResourceDrawing,
  ResourceReading,
  ResourceReveal,
  WorkflowOutputResult,
  InstructionSourceResult,
  RevealResult,
  ConfigFileResult,
  SessionPathTarget,
  LaunchRefusal,
  FirstMessageNotSent,
  ProcessMemory,
  RuntimeStatesMessage,
} from '../../../shared/runtime-ipc'
import type { ProviderBlockStore } from './provider-limit-facts'
import type { SessionRecord } from './session-record'

/**
 * ⚑ **D-017b · what a person's message from a conversation's view came to, in THIS window**: the
 * host's answer (`FirstMessageAnswer`), with the conversation it handed over already adopted.
 * ⚑ `openHere` is read off this window's own record after the adoption, never off the answer's row.
 *
 *  - `sent: true` — the words went.
 *  - `sent: false` — the host's refusal, whole. `openHere` is true when the conversation is running
 *    in this window all the same (`FirstMessageNotSent.running`), and the refusal is said beside it.
 *
 * ⚑ **D-017 · R10 — `tookItsPlace`**: the conversation the start handed over instead, when this one's
 * history could never be reopened and a new conversation of the same agent replaced it for this
 * window. `openHere` is then about that one, and it is the one the person is shown.
 */
export type FirstMessageCameTo =
  | { readonly sent: true; readonly openHere: boolean; readonly tookItsPlace?: string }
  | {
      readonly sent: false
      readonly refusal: FirstMessageNotSent['notSent']
      readonly openHere: boolean
      readonly tookItsPlace?: string
    }

/**
 * ⚑ **D-017b · how a conversation came to be drawn** — {@link SessionStore.look}'s question.
 * `press` is a person opening it, which takes one running with no window for this window; `again` is
 * this window looking once more because the world moved, which takes nothing.
 */
export type LookedBy = 'press' | 'again'

/** ⚑ **718 · which door a new conversation was started from** — see {@link SessionStore.create}. */
export type LaunchDoor = 'front-door' | 'sheet'
/**
 * The requested send behavior: ordinary send, interrupt-and-send or queue.
 *
 * A named intent rather than a boolean or an inference from status, because the whole point of the
 * dispatch is that this is the USER's choice: an enum forces every call site to say which of the
 * three it means, and makes a fourth one impossible to add silently.
 */
export type SendIntent =
  /** The session is idle: send it as an ordinary turn. */
  | 'now'
  /**
   * Ask what is running to stop, and take this instead (045). ⚠️ **How the running turn closes
   * depends on the provider** (709, R43): on Codex in Codex's own word — `interrupted` when it
   * honours the ask, `completed` if it finished first; on Claude in this app's `interrupted`, forced
   * once the ask's receipt is in or its 2 s bound runs out (`forceEnd`, 074; `709` F-1).
   */
  | 'interrupt'
  /**
   * Let the running turn finish, then send this — with whatever else waits, in one turn (D-027); a
   * command goes on its own.
   */
  | 'queue'

/** Readonly outer fields; nested transcript and card-draft objects keep their existing contracts. */
export type SessionSnapshot = Readonly<SessionRecord>

export interface SessionStore {
  readonly providerBlocks: ProviderBlockStore
  hearProviderStates(message: RuntimeStatesMessage): void
  /**
   * ⚑ **D-017b · the conversations this window is fed the events of, oldest first** — every record
   * with `meta` that is not `recorded`.
   */
  readonly live: ComputedRef<readonly SessionSnapshot[]>
  /** One session by id, or null. */
  get(sessionId: string): SessionSnapshot | null
  /** Whether this id is live here — the guard that replaces the host's error. */
  isLive(sessionId: string): boolean
  /**
   * Why STARTING one failed — the launcher's own error, and nobody else's (100).
   *
   * ⚠️ It used to carry reopen failures too, and that is how one refusal came to be rendered twice:
   * `RuntimeScreen.reopen` copied this value onto the row that was pressed, and the launcher went on
   * showing it as a banner at the same time — *"session is already open: sess_53d78fdf…"*, inline
   * under the row AND across the New-conversation page. One ref with two owners; the fix is two
   * refs with one owner each, not a second reader that remembers to clear the first.
   */
  readonly launchError: Readonly<Ref<string | null>>
  /**
   * 🔴 **725 · `716` F-1 — the WORD main refused the launcher's last start with**
   * (`LAUNCH_REFUSALS`), beside {@link launchError}'s sentence, or `null` when it gave none: a start
   * main could not name a reason for (still a rejection), one refused before main's own door, or no
   * refusal at all. ⚑ Written with {@link launchError} and cleared with it; the launcher reads it to
   * decide whether its own sign-in check could say anything the refusal did not.
   */
  readonly launchRefusal: Readonly<Ref<LaunchRefusal | null>>
  /** Why REOPENING one failed. Belongs to the gesture that asked — see {@link launchError}. */
  readonly resumeError: Readonly<Ref<string | null>>
  /** ⚑ **D-017b · why OPENING one failed** — {@link look}'s own, for its reason: one ref, one owner. */
  readonly lookError: Readonly<Ref<string | null>>
  /**
   * 🔴 **718 · why starting one from the StartAsAgent SHEET failed** — that sheet's own error, by
   * {@link launchError}'s rule: one ref, one owner (`710` F-9, and see {@link PLACED_LAUNCH}).
   */
  readonly placedError: Readonly<Ref<string | null>>
  /** Report the front door's failure after its conversation was started. */
  noteLaunchFailure(sentence: string): void
  /**
   * Whether THIS gesture's launch is in flight — `sessionId` for a reopen, omitted for the new
   * conversation.
   *
   * ⚠️ **Per gesture, not shared, and 102's review is why.** It was one flag every launch set on the
   * way in and cleared on the way out, on the stated grounds that *"'something is opening' is true
   * of both and drives the same disabling"*. That was survivable while it drove a spinner. It is not
   * survivable now that it drives a CONTROL: the rail sits beside the launcher, so reopening a
   * recorded conversation put the launcher into `busy`, which now renders a Cancel — a Cancel that
   * looked up the new-conversation launch, found none, and did nothing. A stop button that does
   * nothing is the exact defect this surface's `interruptible: false` existed to prevent, and the
   * fix for it would have reintroduced it one press away.
   *
   * Two launches at once are ordinary rather than exotic: a reopen disables no other row, and the
   * launcher is mounted throughout. So the question a surface asks has to name which launch it
   * means, and a shared answer cannot be made to mean that.
   */
  isLaunching(sessionId?: string): boolean
  /** ⚑ **718 · whether the SHEET's launch is in flight** — {@link isLaunching}'s question, for {@link PLACED_LAUNCH}. */
  isPlacing(): boolean

  /**
   * Start a new conversation. ⚑ **718 · `door` names which surface pressed it** — the front door's
   * launch reports into {@link launchError} and is {@link isLaunching}'s; the sheet's into
   * {@link placedError} and is {@link isPlacing}'s.
   */
  create(
    input: CreateSessionInput,
    door?: LaunchDoor,
    /** ⚑ **718** — the refusal of THIS launch, handed to the caller that asked (see `forLaunch`). */
    refused?: (sentence: string) => void,
  ): Promise<string | null>
  resume(sessionId: string): Promise<string | null>
  /**
   * ⚑ **D-017b · draw one conversation in this window, and start nothing** (`bridge.look`) — the door
   * every press that opens a conversation goes through. One this window is fed already is answered
   * at once; any other is handed over by the host — attached, taken (a `press` of one running with no
   * window), or `recorded`: drawn from its ledger, in the same full view, until a message continues
   * it. ⚑ Resolves to the id it is drawn under, or `null` with {@link lookError} saying why.
   */
  look(sessionId: string, by?: LookedBy): Promise<string | null>
  /**
   * ⚑ **D-017b · let go of a recorded conversation nobody is looking at** — the record is deleted
   * when it is `recorded`, nothing hands it over and no command for it is out; a live one is kept.
   * ⚑ And the store may ask about it again ({@link askAboutUnknown}'s one-ask bound is lifted): the
   * host may start it for this window later, and its events must find their way to a record.
   */
  forget(sessionId: string): void
  /**
   * ⚑ **D-017b · a person's message from a recorded conversation's view, and the start it causes, in
   * ONE act** (`bridge.startAndSend`): the words go and it runs here, or they did not and nothing it
   * started is left running — unless the host kept it running and handed it over, which is adopted
   * here like a reopen, with the host's sentence on its record.
   *
   * ⚑ **A launch like {@link resume}'s**, under the conversation's own id: the composer's Stop reaches
   * it ({@link cancelLaunch}), and the start's events are held until the page they follow is replayed.
   * ⛔ **The attachments cross as {@link overTheWire}'s copy** (`735` F-5), never the composer's own
   * array — a `Proxy` over staged paths fails the clone.
   *
   * Resolves to what it came to here, or `null` when there was no answer to read: a rejection (the
   * wire's own refusals, the quit's door). ⚑ Every refusal's sentence is written on the conversation's
   * own record, where the composer draws it — swallowed only for a Cancel.
   */
  startAndSend(
    sessionId: string,
    text: string,
    attachments: readonly HandedPath[],
  ): Promise<FirstMessageCameTo | null>
  /**
   * **Stop waiting for a launch that has not answered** (102) — the launcher's Cancel, and the
   * reopen row's.
   *
   * `sessionId` names a reopen; omitted, it means the front door's new conversation, which has no
   * id yet (the sheet's, the other id-less launch, has {@link cancelPlaced} since `718`). Both are looked up in {@link inFlight}, which is the store's own record of what
   * it named each gesture, because a create's session id does not exist until the launch is over.
   *
   * ⚠️ **It does not report an error, and that is deliberate.** The launch it stops ends — a reopen
   * rejects (the signal contract), and since `725` a start from either door comes back as main's
   * answer with the word `cancelled` — and a red sentence about a thing the user asked for would be
   * the app arguing with them. {@link cancelled} is what remembers to swallow the rejection, and
   * the word swallows the answer (`forLaunch`).
   *
   * Resolves to whether there was anything to cancel: `false` means the launch had already
   * finished, which is a race the press cannot avoid.
   */
  cancelLaunch(sessionId?: string): Promise<boolean>
  /** ⚑ **718 · the sheet's Cancel** — {@link cancelLaunch} for {@link PLACED_LAUNCH}, and nothing else. */
  cancelPlaced(): Promise<boolean>
  /**
   * **Ask the host what it is still running for this window, and take it back** (100).
   *
   * Everything above is memory of what THIS store did. A store that has just been built — because
   * the window loaded, or because Vite's HMR disposed the last one — has no such memory, and until
   * now had no way to acquire any: the host held a live conversation, the rail said *"Nothing
   * running"*, and Reopen answered `session is already open`.
   *
   * Also reconcile when events arrive for an unknown session, at most once per session. A host can acquire conversations after store construction; the initial attach alone would leave them invisible until reload.
   *
   * Returns the ids taken back, so a caller (and a test) can tell "the host had nothing" from
   * "the host had something and we now have it".
   */
  attachOpen(): Promise<string[]>
  /**
   * **Take over a running conversation nobody owns** (336), by id.
   *
   * Resolves to whether this call is what adopted it — `false` means a hand-over for the same
   * session was already in flight and got there first, which is 100's race and not a failure.
   * Rejects with the host's own sentence when the claim is refused.
   */
  claim(sessionId: string): Promise<boolean>
  /**
   * 🔴 **Hand a running conversation back to nobody** (523), by id — {@link claim} undone.
   *
   * ⛔ **It resolves to what the HOST reported, not to `void`.** See `ReleasedSession`: the word in
   * it is `RuntimeHost.runningStateOf` read after the write, and it is what the caller says on
   * screen. ⚠️ Rejects with the host's own sentence when the release is refused — *"you started this
   * one"*, *"that belongs to another window"* — for the same reason {@link claim} does: somebody
   * pressed something.
   */
  release(sessionId: string): Promise<ReleasedSession>
  /**
   * 🔴 **What has been escalated to a PERSON, across every conversation this database holds**
   * (401, criterion 11) — not just the ones this window is running.
   *
   * ⛔ **`null` is *the read did not answer*, and it is not `[]`.** Empty means nothing is overdue,
   * which is the ordinary state and the one a surface may say *"nothing"* about; a refusal means
   * this window does not know, and a caller that folded the two would draw an all-clear out of a
   * failed IPC call. ⚑ `086`'s rule on the one read where the wrong default is a false all-clear.
   *
   * ⚠️ **A read that names no conversation, and one this store does not keep.** The answer is a
   * snapshot of a fold over the whole ledger; nothing pushes it and nothing invalidates it, so the
   * caller owns both the cadence and the last answer — see `persons-queue.ts`.
   */
  questionsForAPerson(): Promise<LedgerWalk<PersonsQuestion> | null>
  /** One publication with independent coverage for every queue part. */
  personsQueue(): Promise<PersonsQueueAnswer | null>
  /**
   * 🔴 **What only a person may settle** (403) — every open routed request that never travelled,
   * across every conversation this database holds.
   *
   * ⛔ **`null` is *the read did not answer*, for {@link questionsForAPerson}'s reason exactly.**
   * The two populations are drawn by one surface and the false all-clear is the same sentence.
   */
  decisionsForAPerson(): Promise<LedgerWalk<PersonsDecision> | null>
  /**
   * 🔴 **Which providers have walled** (533) — every limit still standing, across every
   * conversation this database holds, already folded to one row per provider and window.
   *
   * ⛔ **`null` is *the read did not answer*, for {@link questionsForAPerson}'s reason with the
   * sign flipped.** Its three neighbours refuse `[]` because empty would claim a person owes
   * nothing; this refuses it because empty would claim **every provider is still working** — and a
   * person acting on that is a person who plans his afternoon around agents that are not going to
   * run.
   */
  limitsForAPerson(): Promise<LedgerWalk<ProviderLimitSeen> | null>
  readLimitsDisplay(): Promise<LimitsDisplayAnswer | null>
  /**
   * 🔴 **Work that has stopped with nobody left to tell** (557) — the recipient of last resort.
   *
   * ⛔ **`null` is *the read did not answer*, and the all-clear it refuses is the sharpest of the
   * five.** An empty list says *every piece of work that stopped has reached somebody*; a dropped
   * call that answered `[]` would draw exactly the silence `555` §3.1 measured, with the app now
   * asserting it.
   */
  stalledWorkForAPerson(): Promise<LedgerWalk<StalledWork> | null>
  /**
   * Work whose holder stopped with it, its giver told: to look at or hand back. `null` is the read
   * did not answer: empty would claim no helper has stopped.
   */
  stoppedWorkForAPerson(): Promise<LedgerWalk<StoppedWorkForAPerson> | null>
  /**
   * Open work no other list shows: a wait that names nothing, a piece that stopped, a recovery.
   * `null` is the read did not answer: empty would claim nothing needs a look.
   */
  workIncidentsForAPerson(): Promise<LedgerWalk<WorkIncident> | null>
  /**
   * 🔴 **F097 · the work whose agent answered a person and waits on their next words.** ⛔ **`null`
   * is *the read did not answer***, for {@link questionsForAPerson}'s reason exactly: empty would
   * claim no agent is waiting on a person's reply.
   */
  waitingOnWhoWroteForAPerson(): Promise<LedgerWalk<WaitingOnWhoWrote> | null>
  /**
   * ⚑ **D-017 · R19 — every ask against an identity's instructions that nobody has answered**,
   * whichever conversation made it. ⛔ **`null` is *the read did not answer***, for
   * {@link questionsForAPerson}'s reason exactly: empty would claim a person owes nothing here.
   */
  instructionAsksForAPerson(): Promise<readonly InstructionAskWaiting[] | null>
  /**
   * Every agent's request to register an MCP server that waits on a person. `null` is the read did
   * not answer, never no request.
   */
  mcpServerRequestsForAPerson(): Promise<readonly McpServerRequestForAPerson[] | null>
  /**
   * 🔴 **How much is open and how much needs a person, as of ONE stated moment** (571, over
   * `567`'s read) — see {@link WorkspaceReading}, which carries the whole argument.
   *
   * ⛔ **`null` is *the read did not answer*, and it is NOT a reading whose scopes are all
   * uncounted.** Those are two different absences and `567` separated them in the shape: a scope
   * that came back uncounted is omitted from a reading that still has a {@link
   * WorkspaceReading.readAt}, while a read that did not come back at all produces no reading —
   * *"so the previous one stands entire, timestamp included"*. ⚑ The caller keeps its last good
   * answer for that reason, exactly as its `…ForAPerson` neighbours above do.
   *
   * ⚠️ **The refusal may not be `{ counted: 'not-at-all' }`**, which is the tempting default and
   * would be a lie in the shape of honesty: it dates a scope this window never measured with a
   * `readAt` it did not earn.
   */
  readWorkspace(): Promise<WorkspaceReading | null>
  /**
   * 🔴 **What each conversation this app is running was last told it is DOING** (575) — see
   * {@link WhatIsBeingDone}, which carries the whole argument.
   *
   * ⛔ **`null` is *the read did not answer*, and it is NOT an empty population.** Those are the
   * two absences this read can produce and collapsing them would be the worst one available: an
   * empty `conversations` list on a real reading means *this app is running nothing*, and a caller
   * that manufactured one out of a dropped call would tell a person their agents had all stopped.
   * ⚑ The caller keeps its last good answer with its own {@link WhatIsBeingDone.readAt}, exactly
   * as {@link readWorkspace} above does.
   */
  whatIsBeingDone(): Promise<WhatIsBeingDone | null>
  /**
   * 🔴 **What each conversation this app is running is WAITING ON** (621, `HO-095` §5.1) — see
   * {@link WhatEachConversationIsWaitingOn}.
   *
   * ⛔ **`null` is *the read did not answer*, and it is NOT an empty population** — the read above
   * carries the whole argument and it holds here with a sharper consequence: an empty
   * `conversations` list is a REAL answer meaning *nothing is waiting anywhere*, and a caller that
   * manufactured one out of a dropped call would quietly tell a person every agent had stopped
   * waiting on them.
   */
  whatEachConversationIsWaitingOn(): Promise<WhatEachConversationIsWaitingOn | null>
  forestReading(scope: ForestScope): Promise<ForestReading | null>
  forestNodes(
    reading: ForestListed,
    conversations: readonly string[],
  ): Promise<ForestNodesPage | null>
  /**
   * 🔴 **D-018 · the memory each running conversation's process holds** — see
   * {@link ProcessMemory}, for a person's agent card.
   *
   * ⛔ **`null` is *the call itself did not answer*** (a refusal during a quit), and the caller
   * draws no figure for it rather than keeping the last one: a figure is a live process's, and a
   * kept one could belong to a process that has since stopped. ⚑ A listing main could not make is
   * an answer, not `null`: it carries `unmeasured`.
   */
  processMemory(): Promise<ProcessMemory | null>
  /**
   * What agents finished, started, stopped or failed in `[from, to)`, one line per piece, over
   * every conversation an agent of this app holds. `null` is the read did not answer, which is
   * not an empty window: a dropped call must not be able to say nothing happened.
   */
  recentActivity(from: number, to: number): Promise<RecentActivityReading | null>
  /**
   * 🔴 **The work one conversation gave out** (508) — the read the right panel could not make.
   *
   * ⛔ **`null` is *the read did not answer*, and it is the FIFTH read in this store with that
   * shape.** ⚠️ Empty here is a sentence too — *this conversation has handed nobody work* — and it
   * is one a person acts on, so a dropped IPC call may not be able to say it. ⚑ The walk word
   * carries the two other empties (`no-ledger`, and a parent who has given work only into ledgers
   * whose rows this build cannot read); `null` is the one the wire cannot carry.
   */
  workGivenBy(sessionId: string): Promise<LedgerWalk<WorkGivenOut> | null>
  /**
   * 🔴 **Who called whom, for one conversation** (547, over `543`'s read) — the band on the first
   * drawer tab.
   *
   * ⛔ **`null` is *the read did not answer*, and it is the SIXTH read in this store with that
   * shape.** ⚠️ Every empty this answer can carry is already a sentence of its own — the three
   * walks each name what they covered, and `no-such-conversation` is *this app holds no
   * conversation by that id* — so a dropped IPC call may not be allowed to borrow one of them and
   * draw *nothing was spawned from here* (`452` §5.1, one noun over).
   *
   * ⚑ **One call and not three, which is the whole reason `543` built an aggregate**: `540` ruled
   * that a single `readAt` is honest only over one atomic read, and three calls from here would put
   * three clocks on one band.
   */
  whoCalledWhom(sessionId: string): Promise<WhoCalledWhom | null>
  /**
   * Send a message, saying WHICH of the three things that means (077).
   *
   * Defaulted to `'now'` so the one caller that is not a composer — the first message of a brand-new
   * conversation — reads as it did before; there is no turn to interrupt or wait behind on a session
   * that has not started one.
   *
   * ⚠️ **Resolves to whether the message GOT THROUGH, and the caller must act on it** (077). The
   * composer clears the box the moment it emits, so a send that is then refused — during teardown,
   * into an ended conversation, or behind a message already waiting — would take the user's text
   * with it. 077 added two of those refusals, which turns a rare loss into a reachable one, and
   * *"a silently dropped message is the worst outcome"* is the dispatch's own words.
   *
   * `false` means the text is the caller's problem again; the session's `error` says why.
   */
  send(
    sessionId: string,
    text: string,
    intent?: SendIntent,
    /** ⛔ Paths handed with this message (216 §2) — carried down whichever branch the intent picks. */
    attachments?: readonly HandedPath[],
  ): Promise<boolean>
  /** Hold this until the running turn ends (077). `false` if it was refused — see {@link send}. */
  queueMessage(sessionId: string, text: string): Promise<boolean>
  /**
   * Take the queued message back before it goes (077) — **naming which one** (354).
   *
   * ⚑ **700 · `688` H1 — the id is the PRESSED ROW's own** (`QueuedItem.messageId`, the name minted
   * where the message was accepted), not the head of `meta.queued`: a conversation can hold two since
   * `394`, and the go-ahead's take-back must take back the go-ahead. ⛔ A row that is no longer held
   * is refused by the host — *"there is no queued message to cancel"* when nothing waits, *"that is
   * not a message this conversation is holding"* when something else does, *"too late to cancel"*
   * mid-flush — which is the whole point of it having a name: a stale row takes back nothing rather
   * than the wrong message.
   */
  cancelQueuedMessage(sessionId: string, messageId: string): Promise<void>
  /** Take a held message back and stop the turn, as one host call, so its words never go. */
  takeBackAndStop(sessionId: string, messageId: string): Promise<void>
  /**
   * Answers the words an answer came back with, as {@link respondUserInput} does — and, like it,
   * asks the host even when this window holds no record of the conversation: a person may answer a
   * request in one no window holds.
   */
  respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<string | null>
  /**
   * ⚑ **D-017 · R6 — the host is asked even when this window holds no record of the asker**: a
   * question this app asked is found in its asker's ledger, whatever state the asker is in.
   * Answers the sentence for an answer that did not land — the host's own words, or why it never
   * left this window — or `null` when it was taken, so a row with no card to carry it can say it.
   * ⚑ **D-017 · R1** — and the host's sentence for one it took but could not deliver yet: the
   * conversation that asked could not be started, and the answer is kept for its next start.
   */
  decideMoveRequest(
    sessionId: string,
    requestId: string,
    decision: 'move' | 'here',
  ): Promise<MoveRequestAck>
  respondUserInput(
    sessionId: string,
    requestId: string,
    response: UserInputResponse,
  ): Promise<string | null>
  /**
   * A person's answer to a to-do: done, or can't, with an optional note. Answers the host's ack and
   * rejects as the bridge does. A refusal that leaves the to-do closed settles its card here, on both
   * folds, in the host's words; a taken answer, a refusal that leaves it open and a thrown call leave
   * the card as it is. The host is asked even when this window holds no record of the conversation.
   */
  answerAction(
    sessionId: string,
    requestId: string,
    done: boolean,
    note: string,
  ): Promise<AnswerAck>
  interrupt(sessionId: string): Promise<void>
  /**
   * Stop ONE piece of background work, leaving the conversation running (248).
   *
   * ⛔ **`true` means the request went out, never that the work died** — the ending arrives as a
   * `background_work.ended` carrying `stopped`, which is `Query.stopTask`'s own promise and the
   * distinction `233`/`240` spent two dispatches on.
   *
   * ⚠️ **`false` on a button that was offered means it had already finished.** The button is gated
   * on {@link SessionLiveness.canStopBackgroundWork}, so the other reading of `false` — *"this
   * adapter cannot stop anything"* — cannot be what a pressed button hit. `247` §3: *"`false` is a
   * real answer, not an error."*
   */
  stopBackgroundWork(sessionId: string, id: string): Promise<boolean>
  /**
   * What one running command has printed so far (300) — polled while its card is open.
   *
   * ⛔ **`null` is one sentence, not four.** It covers *"the adapter does not stream"*, *"this is a
   * recording"*, *"the buffer was evicted"* and *"the bridge threw"*, and the card says the same
   * thing for all of them: this app is not holding it. Distinguishing them would be telling a person
   * about our bookkeeping rather than about their command — `067`'s ruling on a missing image path.
   */
  readCommandOutput(sessionId: string, toolCallId: string): Promise<CommandTail | null>
  /**
   * The whole of what one tool answered (462) — read ONCE, when a person opens the panel.
   *
   * ⛔ **`null` is one sentence here too**, and it covers one more state than the read above it: a
   * REPLAYED conversation has no handle at all, so nothing is held for any of its rows. ⚑ That one
   * is the hole this read exists inside rather than a corner of it, and the panel names it — see
   * `lib/tool-answer.ts`, where each silence gets its own words.
   */
  readToolAnswer(sessionId: string, toolCallId: string): Promise<ToolAnswer | null>
  /**
   * Stop this conversation's provider. Resolves to whether the HOST agreed (147) — a refused close
   * leaves a session that is still running, and a caller that goes on to do something with the
   * conversation has to be able to tell. The sentence is on the record either way; the boolean is
   * for control flow, not for reporting.
   */
  close(sessionId: string): Promise<boolean>
  /**
   * Load the page of conversation before the one on screen (054).
   *
   * Resolves when the window has been updated, which is what lets the view restore the reader's
   * scroll position against the height it added. Failures land on the session's `error` like any
   * other command — a fetch that could not happen must not leave the control saying "loading".
   */
  loadOlder(sessionId: string): Promise<void>
  /**
   * Go back to the newest page after scrolling far enough to release the tail (054).
   *
   * The escape from a window that has left the end of the ledger. Without it a reader who paged
   * back three times sat in front of a frozen transcript for the life of the session, because live
   * events had nowhere in the window to land and nothing put the window back — which is what 054's
   * review found.
   */
  jumpToLatest(sessionId: string): Promise<void>
  /**
   * Read a workflow run's output file (108), or the word saying why not.
   *
   * ⚠️ **No path parameter, here or anywhere on this side of the boundary.** The run is named; the
   * main process resolves the path from the ledger it wrote. See `main/workflow-output.ts`.
   *
   * Failure returns the honest refusal rather than throwing: this is opened by a click on a footer,
   * and a viewer that says "the output file could not be read" is a better answer than an exception
   * nobody catches.
   */
  readWorkflowOutput(sessionId: string, taskId: string): Promise<WorkflowOutputResult>
  /**
   * Read one instruction file this session's provider reported (356 §2), so it can open on the
   * app's own paper.
   *
   * ⚠️ **A POSITION in the provider's list, not a path** — the list is the provider's and the main
   * process holds it; naming a row by where it sits in the list the panel drew is the only address
   * that cannot become an arbitrary-file read. See `main/instruction-source.ts`.
   */
  readInstructionSource(sessionId: string, index: number): Promise<InstructionSourceResult>
  /**
   * 🔴 **510 · one resource, by the id a work report names** (a document until D-016).
   *
   * ⛔ **No `sessionId`, and its absence is the point**: the id is a primary key in main's own
   * `work_resource` table, so the answer is the same whichever conversation is on screen — and a
   * recording's transcript can open one exactly as a live conversation can, which is the dead
   * button `108`'s review found on that very pane.
   *
   * ⚠️ **Failure is a refusal and never a throw**, its two neighbours' rule: four reasons, each
   * of which says something true, and a viewer that prints one beats an exception nobody catches.
   */
  readResource(resourceId: string): Promise<ResourceReading>
  /**
   * 🔴 **D-032 · a kept picture or PDF's bytes, to draw**, by the same id and for the same reason
   * it takes no `sessionId`. ⚑ Asked once when a person opens the file, never on a timer.
   * ⚠️ Failure is a refusal and never a throw, as {@link readResource}'s.
   */
  drawResource(resourceId: string): Promise<ResourceDrawing>
  /**
   * 🔴 **D-032 · show a kept file in Finder**, by its id: no path reaches the window. A refusal and
   * never a throw.
   */
  revealResource(resourceId: string): Promise<ResourceReveal>
  /**
   * Show one of this session's paths in the file manager (356 §1).
   *
   * ⛔ **A target, not a path**, for the reason above. Failure returns the refusal rather than
   * throwing: this is a button on a panel, and *"there is nothing at that path any more"* is a
   * sentence a person can act on.
   */
  revealPath(sessionId: string, target: SessionPathTarget): Promise<RevealResult>
  /**
   * 🔴 **733 · one config file of this session's home, read now** — the Info panel's Open (`731`
   * F-2). By the name the config gave it; see `main/config-file.ts`.
   */
  readConfigFile(sessionId: string, name: string): Promise<ConfigFileResult>
  /**
   * Read what one sub-agent did (112) — its transcript, its run's journal, or the script.
   *
   * Same rule as above and one more: the agent is named, and the main process checks that name
   * against the ledger before it looks at a directory. See `main/child-work.ts`.
   */
  readChildWork(sessionId: string, what: ChildWorkInput): Promise<ChildWorkResult>
  /**
   * What one child is doing right now (296) — polled while its viewer is open.
   *
   * Same rule again: the agent is named and the main process checks it against the ledger. ⚠️ Unlike
   * the read above, this one needs the session to be LIVE, and says `not-live` when it is not
   * rather than pretending the child is unreachable.
   */
  readChildState(sessionId: string, agentId: string): Promise<ChildStateResult>
  /** Say something to one child (296) — refused while that child is working. */
  sendToChild(sessionId: string, agentId: string, text: string): Promise<ChildSendResult>
  refreshConfig(sessionId: string): Promise<void>
  compact(sessionId: string): Promise<void>
  /**
   * Start or stop prompting for consequential actions, from this session's next turn (034).
   *
   * The record is patched from what the HOST says afterwards, never from the mode that was asked
   * for — the whole point of the delay is that those two are different for a while, and a UI that
   * optimistically showed the requested mode would be showing exactly the wrong one.
   */
  setApprovalMode(sessionId: string, mode: 'ask' | 'auto'): Promise<void>
  /** Stop proposing and send the go-ahead, in one command (060). */
  /** `text` absent = leave planning without approving; present = the go-ahead (085). */
  endPlanMode(sessionId: string, text?: string): Promise<void>
  /**
   * Change the model, the effort, or plan mode mid-conversation (076).
   *
   * ⚠️ **The record is patched from what the HOST says, never from what was asked for** — the same
   * rule `setApprovalMode` follows and for the same reason: the change lands on the NEXT turn, so
   * for a while the running value and the requested one genuinely differ, and a store that
   * optimistically wrote the requested one would be showing the value the session is not using.
   */
  /**
   * ⚑ **D-048 · answers what the pick became beyond this conversation** (`WhatAPickBecame`): the
   * agent's default and the last pick, or why not — `null` for plan mode, `undefined` where the
   * command was refused or not asked.
   */
  setSessionSetting(
    sessionId: string,
    body: SetSessionSettingInput['body'],
  ): Promise<WhatAPickBecame | null | undefined>
  /** Stop listening. The window is going away, or a test is finished. */
  dispose(): void
}
