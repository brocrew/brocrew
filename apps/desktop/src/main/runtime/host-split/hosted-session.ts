import { WorkAncestryRead } from '../work-ancestry'
import type { ProviderFailureEpisode } from '../../db/session-store'
import {
  sessionDisclosures,
  type BackgroundWorkEnded,
  type WhatAFailedTurnWasFor,
  type HeldGrant,
  type ProviderLimitDisclosure,
} from '../session-disclosures'
import { type RuntimeEventSink, type Caller } from '../conversation-caller'
import type { PreparedBuiltInSkills } from '../../skills/prepare-built-in-skills'
import type { ContextReading, ProviderCommandAnswer, SessionHandle } from '@brobot2/runtime'
import { type Provider, type SessionStatus } from '@brobot2/shared'
import type { ReportedModel } from '../../../shared/model-choice-contracts'
import { type Launch } from '../launch-registry'
import { type SessionLiveness } from '../../../shared/runtime-ipc'
import type { LeadInFront } from '../../../shared/human-answer-contracts'
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { KeptPromptStart, SessionInstructions } from '../../../shared/instruction-contracts'
import type { SessionStore } from '../../db/session-store'
import { type AQuestionAStopEnded } from '../turn-origin'
import { type TurnBlockSnapshot } from '../turn-block-changes'
import type { AgentMessageKind } from '../../../shared/task-contracts'
import type { WhatALaunchGave } from '../../../shared/what-this-agent-was-given'
import { type ExplicitStopNotice } from '../stop-turn'
import { type CompactionRequest } from '../compact-conversation'
import type { QueuedMessage } from '../queued-message'
import { LivenessTracker } from '../liveness'
import { BeingDoneTracker } from '../being-done'
import type {
  BackgroundCommand,
  BackgroundLevel,
  ScheduleLevel,
} from '../../../shared/agent-state-contracts'

/** The words for a conversation reopened so an MCP server a person approved reaches it. */
interface ItsToolsMoved {
  /** When it is reopened for the server. */
  readonly reopened: string
  /** When background work or planning a reopen would end keeps it from being reopened now. */
  readonly notReopened: (because: 'its-background-work' | 'its-planning') => string
}

/** The sender and files of a message recorded before the recipient starts. */
interface WordsForTheNextStart {
  readonly by: Caller
  /** What the caller said they are; absent for a new brief, which names its piece. */
  readonly says?: AgentMessageKind
  readonly attachments: readonly HandedPath[]
  /** A new brief: the piece it names again, which its next start's flush reads the brief of. */
  readonly rebriefs?: { readonly piece: string; readonly label: string }
}

type RecordedProviderFailure = Exclude<ProviderFailureEpisode, string>

interface ProviderFailureRecipient {
  readonly pieces: Map<string, string>
  readonly questions: Set<string>
}

/** A service's turn working on a piece: the life it runs in, and how many of its turns had ended. */
interface TheTurnOnAPiece {
  readonly life: HostedSession
  readonly turnsEnded: number
}

/**
 * Whose a turn is, as the words handed over for it say: whether a person wrote any of them, and
 * every piece they name ({@link thePiecesTheTurnNames}).
 */
interface WhoseTurnItIs {
  readonly aPersons: boolean
  readonly names: readonly string[]
}

interface ProviderHandover {
  readonly accepted: Promise<void>
  noteInputRecorded?(): void
}

interface HostedSession {
  readonly workAncestry: WorkAncestryRead
  workAncestryAfter: number
  ancestrySeed?: {
    from: number
    through: number
    context: ReturnType<SessionStore['ancestryContext']>
  }
  readonly currentProviderLimits: () => ProviderLimitDisclosure
  readonly id: string
  readonly provider: Provider
  /**
   * 🔴 **W4.189 · the grants its open pieces hold, as last read** ({@link RuntimeHost.grantsOf}) —
   * `undefined` until read, and again once a row that gives or ends one of its pieces is written
   * ({@link GRANTS_MAY_MOVE}). ⚑ What a window is shown; ⛔ never what a turn carries, which is read
   * afresh at its handover ({@link RuntimeHost.theWorkFoldersFor}).
   */
  grants?: readonly HeldGrant[]
  /**
   * **What this session was launched with** (158) — recorded here because it is a fact about the
   * LAUNCH, not about the files as they are now.
   *
   * ⚠️ Read once, at start or at resume, and never refreshed. Re-reading it for a disclosure would
   * show today's `CLAUDE.md` beside a conversation the model is having with the one it was given,
   * which is the same lie in the other direction. The provider's own half is not stored: it comes
   * off the handle at disclosure time, where it is always current.
   */
  readonly instructions: SessionInstructions
  readonly builtInSkills?: PreparedBuiltInSkills
  readonly cwd: string
  readonly providerHome: string
  /**
   * ⚑ **The identity this session is RUNNING as** (341) — the profile slug, resolved once at launch
   * and never re-derived.
   *
   * ⚠️ **Not parsed back out of {@link providerHome}.** The path is built FROM this, and a reader
   * that took it apart again would be a second answer to *"which profile"* — free to disagree the
   * day the derivation changes, which is 149's shape.
   */
  readonly profileId: string
  /**
   * What this session was CREATED with (078). Kept only as provenance: since 034 the user can
   * change the mode mid-conversation, so the live answer is `handle.approval` and this field must
   * never be used to describe what the session is doing now.
   */
  readonly createdApprovalMode: 'ask' | 'auto'
  /** The last agent descriptor pushed, so a reroute publishes once and a repeat does not (081). */
  lastAgentInfo: string
  /** ⚑ **D-042 · R5** — the last report kept on its row (`recordWhatItReportsRunning`). */
  lastReported: string
  /**
   * ⚑ **D-042 · R5 — what its row held as last reported when this life began**, or `null` — what
   * the open conversation's settings say until the provider speaks in this life
   * (`settingsDisclosure`), as the rail and its card already say it.
   */
  readonly reportedBefore: ReportedModel | null
  /** The same dedupe for the approval disclosure, which moves when a turn adopts a change (034). */
  lastDisclosures: string
  /**
   * 🔴 **740 · R99 (`736` F-8) — the plan phase the LEDGER holds for this life**: planning (`true`)
   * or not. Seeded from the handle at registration, which the launch built from the row (a start's
   * `planMode`, a resume's `plan_mode`/`plan_ended_at` pair), and moved only by the doors that write
   * the row — {@link RuntimeHost.recordPlanPhase} and the two a person's plan control goes through.
   * ⚑ It is what {@link RuntimeHost.recordPlanPhase} compares the handle against, so a plan the
   * ADAPTER settles with no card — the model's own `EnterPlanMode` — is written down once.
   */
  planAsRecorded: boolean
  readonly handle: SessionHandle
  /**
   * The launch that produced this session's provider, still owned (070).
   *
   * ⚠️ **Not finished when the handle arrives.** A launch owns the PROCESS, and the process is alive
   * for exactly as long as the session is — so it is given back in {@link RuntimeHost.runFinalize},
   * with the termination promise, and not a moment earlier. Registering used to be treated as the
   * end of the launch, which is how a stop that timed out could free the id for a resume while the
   * first provider was still running (068 finding 2).
   */
  readonly launch: Launch
  /**
   * Where this session's events go — **no longer `readonly`** (100).
   *
   * It was bound once in {@link RuntimeHost.register} and never reassigned, which was correct while
   * a session could only ever be handed to the surface that started it. Attaching a live session
   * back to a surface that lost it ({@link RuntimeHost.attachHeldSession}) is the same session
   * meeting a new sink, and the sink that asked is the one that should be written to.
   *
   * ⚠️ **Every reader must go through `session.sink`, not through a captured local.** The liveness
   * callback below used to close over `register`'s `sink` argument, so a rebind here would have
   * moved the events and left the liveness line publishing to the sink that no longer wanted it —
   * silent, and visible only as a header that stopped updating.
   */
  sink: RuntimeEventSink
  /**
   * The provider stop, UNBOUNDED — the fact, as opposed to {@link stopping}, which is how long we
   * were prepared to wait for it (070). Null until the first stop begins.
   *
   * The pair is the point: a quit must not hang on one wedged adapter, and it also must not conclude
   * from its own impatience that the process is gone. `stopping` releases the waiter; this releases
   * the ownership.
   *
   * ⛔ **And until 233 this field did not hold what this comment says, for Claude** (229 H1). The
   * promise assigned here was `handle.close()`, whose Claude implementation awaits
   * `withTimeout(query.return(), 5 s)` over an SDK `performCleanup()` that itself races
   * `transport.waitForExit()` against 2 000 ms — every layer of which always resolves. So the fact
   * and the bound were **one promise**, and this comment's own distinction had no code behind it:
   * `runFinalize` read timely settlement as *stopped*, 222's
   * `stopped ? 'ended' : 'unknown'` could never reach `unknown`, `launches.finish` freed the id and
   * `closeAll()` had nothing to warn about — while the SDK's transport had SIGTERM scheduled 2 s out
   * and SIGKILL 5 s after that, both `unref`'d. A reopen in that window starts a second writer
   * against a live process.
   *
   * ⚑ **What is assigned now is `Promise.all([the teardown, the process exit])`**, where the second
   * is {@link SessionHandle.awaitProcessExit} — a promise that settles only on a kernel-delivered
   * `'exit'` for a child this app spawned, or never. Both halves, because {@link Launch.settled}
   * promises *"this launch is over AND everything it created is confirmed down"*, and the teardown
   * is the first half of that sentence.
   *
   * ⚠️ **An adapter with no such fact still assigns the teardown alone** — the pre-233 behaviour,
   * kept deliberately rather than upgraded by assumption. It is weaker, and it is supposed to look
   * weaker; see {@link RuntimeHost.doStopProvider}.
   */
  terminated: Promise<void> | null
  /** Per-session sequence number stamped on every forwarded event. */
  ordinal: number
  /**
   * 🔴 **The ordinal this LIFE began at, when it follows an earlier one in this ledger** (653) —
   * `null` for a conversation whose first life this is.
   *
   * ⛔ **{@link ordinal} starts here and then MOVES, which is why this field exists.** A reopen
   * seeds the counter with `nextOrdinal` and the first event of the new life takes it, so by the
   * time anybody hands the conversation over the start is gone. ⚑ A hand-over whose window reaches
   * back past this point is showing two lives, and the renderer can only tell where one ends and
   * the other begins if it is told. ⚠️ Until `673` the ledger wrote no row at the seam
   * (`closeOpenTurn` and `reopenTx` touch columns, and Claude's own `session: resumed` waits for
   * the first turn); since then the host's `reopened` is the first row of every reopened life, AT
   * this ordinal. ⚑ The field still carries the seam — a renderer that looked for the row would be
   * a second answer to one question, and `653` crosses the number.
   *
   * ⚠️ **Fixed at {@link RuntimeHost.register} and never written again**, like the slot's birth
   * facts: a life does not move its own start.
   */
  readonly liveFrom: number | null
  /**
   * ⚑ **When this life began, epoch ms** — its slot's reservation ({@link HostedSession.launch}'s
   * moment): the sign-in it holds is the Mac's of then. ⚑ So a life that began before this app last
   * saw its provider's sign-in change reports that same change, not a new one
   * ({@link RuntimeHost.aSignInChanged}).
   */
  readonly lifeSince: number
  /** Resolves when the event stream has ended. See {@link RuntimeHost.finalize} for what follows. */
  pump: Promise<void>
  /** The single teardown every concurrent closer joins; null until the first one starts. */
  closing: Promise<void> | null
  /**
   * The single provider stop every path joins — the host's own, not the adapter's (051). Resolves
   * to whether it stopped within the bound.
   */
  stopping: Promise<boolean> | null
  /** The single finalization every path joins; null until the first one starts (051). */
  finalizing: Promise<void> | null
  /**
   * ⚠️ **Set once a fenced pump has dropped something** (293 §3) — so the fact reaches a log and a
   * stuck iterator still yielding into a finalized life does not produce one warning per event. It
   * is a diagnostic and nothing reads it: see {@link RuntimeHost.isCurrentLife} for the fence.
   */
  staleEventReported: boolean
  /**
   * 🔴 **708 · the commands this life's provider answers to, as it last said — or `null`** (`R42`).
   *
   * ⚑ **Written by the provider, never by this app**: the `provider_commands` level {@link
   * RuntimeHost.deliver} sees, which REPLACES (`279`), or the answer to {@link
   * RuntimeHost.theCommandsItAnswersTo}'s ask. ⛔ **Per LIFE, because a `HostedSession` is one**: a
   * reopened conversation is a new child, which publishes its own list, and a list the last child
   * published says nothing about what this one will run.
   *
   * ⚠️ **`null` is *"nobody has told us"*, never *"no commands"*** — the palette's own distinction
   * (`provider-commands.ts`). {@link RuntimeHost.handToProvider} reads `null` as `R42`'s
   * *"the list cannot be had"*.
   */
  commands: ProviderCommandAnswer | null
  /**
   * ⚑ **708 · the ask for {@link commands} this life has in flight, or `null`** — see
   * `RuntimeHost.theCommandsItAnswersTo`. Kept after a success; forgotten after a failure.
   */
  askingForCommands: Promise<ProviderCommandAnswer> | null
  /**
   * 🔴 **D-024 · R1 — what this life's first turn carries in front of its words, until a turn has**
   * — or `null`: nothing is owed, or it went. ⚑ **On Codex, this conversation's own text**
   * (`SessionLaunchRead.firstTurnLead`): a Codex thread keeps the developer text it STARTED with —
   * a resume's never reaches the model — and a mode switch overrides that, so the conversation's
   * own facts ride the first message of every life, where neither reaches them. ⛔ **Per LIFE**, {@link commands}' reason: each launch composes its
   * own, as it stood then. ⚑ Taken by {@link RuntimeHost.withWhatThisLifeOwes}, at the first turn
   * {@link RuntimeHost.handToProvider} hands over as words — every caller's turn and every held
   * message. ⚠️ A person's command (`R42`) and a go-ahead sent straight (BroBot's own sentence,
   * 414) go without it and leave it owed to the next.
   *
   * 🔴 **D-039 · owed AGAIN where the model may no longer hold it** ({@link lifeLead}): after a
   * compaction, which rewrites the history it rode in, and after a turn this app ended as `failed`
   * (`wordOf: 'this-app'`: its provider never began it, or died under it) — see
   * `RuntimeHost.deliver`. ⚑ On Codex the tools' instructions ride it alone — its catalogue cannot
   * hold them — so a life that lost it would run on without them. ⚠️ A send the adapter refuses
   * before it begins a turn still takes it unless the adapter proves top-level StoppedBeforeSend;
   * that exact handover restores its consumed lead through sendOrdinaryInput.
   */
  firstTurnLead: string | null
  explicitCompaction?: CompactionRequest
  compactionWhenIdle?: CompactionRequest
  /** Notices that ride its next ordinary input instead of driving their own turn. */
  readonly noticesForItsNextInput: QueuedMessage[]
  /**
   * ⚑ **W4.179 — what {@link firstTurnLead} is**: the whole of this conversation's text, or only the
   * sections that changed since its Codex thread got it (`codex-lead.ts`).
   */
  firstTurnLeadIs: LeadInFront['is']

  leadJustHandedOver: LeadInFront | null

  readonly lifeLead: string | null

  readonly launchGave: WhatALaunchGave | null
  readonly promptStart?: KeptPromptStart

  wordsJustHandedOver: string | null
  /**
   * ⚑ **F093 · R2 — whose words {@link wordsJustHandedOver} framed**: the words of each message the
   * last hand-over carried, so a turn's row takes that text only when its own words are exactly these.
   */
  wordsItWasHandedFor: readonly string[]
  /** ⚑ **F093 · how full its context is: the latest `context_reading` of this life**, or `null`. */
  latestContext: ContextReading | null
  /**
   * 🔴 **Where this session's asked-for memory notes land, or `null` when nothing is watched** (318).
   *
   * ⚠️ **Derived once, at registration**, because it cannot change: the provider home is fixed at
   * launch and the layout is a constant of the provider. `null` is the ordinary state for a provider
   * that reports its own memory writes — see `memory-notes.ts` for why that is a ruling.
   */
  readonly memoryNoteDir: string | null
  /**
   * The note names in that store as of the last look — the snapshot the next turn diffs against.
   *
   * ⛔ **Re-taken at the START of every turn**, not only at the end of one. A profile is the
   * shared-memory boundary (085), so a note another session in this profile wrote between turns is
   * not this turn's; snapshotting on the way in is what confines the window in which it could be
   * mistaken for one to the turn itself.
   */
  memoryNotes: ReadonlySet<string>
  /**
   * ⛔ **Whether a turn THIS APP sent is open** — the guard on the memory-note claim (318).
   *
   * Set by the `user_turn` every turn of ours opens with, cleared by the ending that publishes the
   * observation. Without it the row's sentence would be false on any ending that arrives with no
   * turn before it, because the window it names would start at registration.
   */
  turnOpened: boolean
  /**
   * 🔴 **D-022 · R4 — what the turn of ours that is open drives**, off the `user_turn` that opened
   * it ({@link theDriveOfTheTurn}): the one piece it names or drives, or `null` — it names none, and
   * drives every open piece, or (D-027) the messages it delivered drive different pieces. ⛔ Read
   * only while {@link turnOpened}: a turn its provider began by itself (a wake) has no row of ours,
   * and drives nothing a give can be hung under.
   */
  itsTurnDrives: string | null
  /**
   * Whose the turn it runs is, as the words handed over for it say ({@link
   * RuntimeHost.aTurnIsHandedOver}): written as they are handed over, and never by the turn's row,
   * which can land after the next words are. A turn its provider began by itself is read as the
   * one before it.
   */
  itsTurnIs: WhoseTurnItIs
  /** New handovers and provider-started turns invalidate older personal anchors. */
  personalHandover: number
  /** The committed turn whose recorded parts contain the person's request. */
  personalWorkTurn: string | null
  /**
   * Whether a person's own words opened the turn that runs — a message or a command a window sent,
   * their plan go-ahead, or their answer carried to it: from whose the words are when they are
   * handed over, then off the `user_turn` that opened it; cleared when a turn ends.
   */
  aPersonsWordsOpenedIt: boolean
  /** The exact committed pure person turn; absent during a provider handoff. */
  moveRequestTurn: { id: string } | null
  moveRequestRowPending: boolean
  moveRequestHandoff: object | null
  /**
   * How many of this life's turns have ended: a turn read as running is still the one running while
   * this count holds.
   */
  turnsEnded: number
  questionWakeDue?: { readonly at: number; readonly completed: boolean }
  /**
   * ⚑ **When a person last wrote in it**, as far as this life knows: noted as a turn their own
   * words opened is recorded, and read off its ledger as a life that continues a recording begins
   * (`SessionStore.whenAPersonLastWrote`). `null` is *not that this app knows of*.
   */
  aPersonLastWroteAt: number | null
  turnBlockSnapshot: TurnBlockSnapshot
  pendingTurnBlock: {
    readonly next: TurnBlockSnapshot
    readonly words: string
  } | null
  /**
   * 🔴 **The highest ordinal this session has actually PUT ON THE WIRE**, or null before the first
   * one (320).
   *
   * ⚠️ **Not `ordinal - 1`, and the difference is the whole point.** `ordinal` is what has been
   * HANDED OUT; this is what has been SENT, and 320 is the dispatch that found out they are not the
   * same sequence. It exists so {@link RuntimeHost.emit} can say so when they diverge.
   */
  sentOrdinal: number | null
  /** Derives live / silent / ended / errored from this session's own stream. */
  readonly liveness: LivenessTracker
  /**
   * 🔴 **Derives what this app has been TOLD it is doing, from the same stream** (575) — see
   * {@link BeingDoneTracker}, which carries the whole argument.
   *
   * ⛔ **Beside the line above and not folded into it.** Liveness answers *is it still producing*
   * and this answers *and what is it producing* — `509`'s own split, one question further on — and
   * the two have different lifetimes: liveness FREEZES at a terminal state and this one does not
   * need to, because a conversation that is over leaves the slot map and leaves this read with it.
   */
  readonly beingDone: BeingDoneTracker
  /**
   * ⚑ **D-017 · R11 — what it left running in the background, as its provider last stated the
   * LEVEL** — `background_work.running` REPLACES it (`248`: a missed bookend must not wedge a stale
   * indicator), and an event that carries only an ending leaves it alone. ⚑ Each row carries the
   * command of the tool call that started it, when {@link toolCallsNamed} still holds that call.
   * ⚠️ It lives in the process and goes with it: a conversation this app is not running has none.
   */
  background: BackgroundLevel
  /**
   * ⚑ **D-017 · R11 — what it has scheduled, as its provider last stated the LEVEL**
   * (`scheduled_work.jobs`, the same REPLACE rule). ⚠️ In the process too: a stop takes its jobs
   * with it, and they fire only once something starts it again — ⚑ D-029: its wake-up does
   * ({@link RuntimeHost.armItsWakeUp}), and a start begins from what its plan lists until the
   * provider states the level itself — or until those jobs are past their time with no word from
   * it ({@link RuntimeHost.letGoOfJobsItNeverRestored}). ⚑ Read from the receipts of its scheduling
   * calls and its provider's levels ({@link RuntimeHost.sayWhatIsScheduled}): a job leaves it when
   * its cancellation is confirmed, in the turn that cancelled it, and each job carries its next
   * minute where that is known ({@link ScheduledRow.nominalAt}).
   */
  scheduled: ScheduleLevel
  /**
   * The newest level this life wrote into its ledger — its provider's, or this app's — or `null`
   * before any: this app writes a level of its own only when it says something else.
   */
  levelWritten: ScheduleLevel | null
  /**
   * Whether its provider has said anything of its jobs in this life — a level, or the receipt of
   * a call that made or cancelled one — so what it holds is no longer only what its start was
   * seeded with ({@link RuntimeHost.letGoOfJobsItNeverRestored}).
   */
  providerSpokeOfItsJobs: boolean
  /**
   * ⚑ **D-017 · R11 — the last tool calls this life made, by id: the tool's name and its summary**,
   * so a background row names the command its card names (`251`). ⚠️ The first level frame of a
   * piece of work carries no `toolCallId` (`248` §5), so its row says the provider's description
   * for one frame. ⛔ **Bounded** ({@link TOOL_CALLS_REMEMBERED}): a long conversation makes tens of
   * thousands of calls, and only the ones a level can name matter.
   */
  readonly toolCallsNamed: Map<string, BackgroundCommand>
  /**
   * The message waiting for the running turn to end (077), or null.
   *
   * ⚠️ **The queue is OURS, and holding it here rather than pushing it at the provider is the whole
   * design.** ⛔ **277 re-measured both halves of the reason at today's pins and ONE OF THEM IS NO
   * LONGER TRUE.** The design is unchanged and the ruling was re-affirmed; what moved is the
   * evidence, and a stale measurement left standing as a design's justification is the failure this
   * project keeps finding in its own comments. Replay: `pnpm run probe:steer`.
   *
   *  - **Claude** takes it into the SDK's own queue, where it runs as its own turn after the current
   *    one — which is the right behaviour. ⚑ **And since `0.3.218` it CAN be taken back.**
   *    `Query.cancelAsyncMessage(uuid)` is in the shipped bundle and **not** on the public `Query`
   *    interface in `sdk.d.ts` — undeclared API, so reading it there was never going to find it.
   *    277 §E called it against a genuinely in-flight turn: a uuid-stamped message pushed mid-turn
   *    answered `true` and **never ran**, while an identical uncancelled message in the same session
   *    **did** run. ⚠️ The second round is not decoration — without it *"the cancelled one did not
   *    run"* is a claim a probe that noticed neither would also make. `interrupt()` now returns a
   *    receipt that NAMES the queued uuid (`still_queued: ["…"]`) and the message it named went on
   *    to run, exactly as the receipt promises. ⛔ **077 measured `still_queued: []` and concluded
   *    "a message pushed there is gone". Both are stale.**
   *  - **Codex** has `turn/steer`, and it is a different thing again: 277 §B measured the message
   *    landing INSIDE the running turn — the same turn id handed back, the prompt arriving as a
   *    `userMessage` item under that turn id (carrying our `clientUserMessageId` as `clientId`, so
   *    it is attributable), answered after the in-flight reply, turn closing `completed`. Two
   *    prompts, one turn, which 045's one-prompt-per-turn row cannot say.
   *    ⚠️ **And it is SLOWER than this app's own interrupt-and-send.** The steer resolved at 7.4 s
   *    and the prompt did not enter the turn until 15.7 s — it waits for the in-flight assistant
   *    message to COMPLETE. Against the same command at the same moment, the two primitives
   *    {@link RuntimeHost.sendInterrupting} composes closed the turn in **4 ms** (`turn/interrupt`
   *    → `turn/completed`) and had the replacement turn open **207 ms** later. ⛔ Measured on the
   *    adapter, not on this method: `sendInterrupting` adds its own gate and a bounded wait for
   *    idle on top, so 207 ms is the floor rather than the figure a user sees.
   *    ⚠️ There is no `turn/unsteer` anywhere in the pinned union — `steer` appears in exactly three
   *    generated files (`TurnSteerParams`, `TurnSteerResponse`, `NonSteerableTurnKind`) and none of
   *    them is a withdrawal. Once it resolves it cannot be recalled.
   *
   * Held here it is cancellable, persistable, and identical on both providers, and the message
   * reaches the provider by the ordinary `send` path — in a turn of ours — at a moment we choose.
   *
   * ⚑ **277's ruling, with the table behind it in the response doc: keep this, build no steer.**
   * Against the queue and against {@link RuntimeHost.sendInterrupting}, `turn/steer` ties or loses
   * on every axis measured — it is slower, it cannot be withdrawn, it does not survive a restart, it
   * exists on one provider, the `turn` table cannot record it, and it closes the turn `completed`
   * over a tool call that was killed. The one thing it does that neither of ours does is avoid an
   * `interrupted` bracket in the transcript, and that bracket is TRUE.
   *
   * 🔴 **A MAILBOX since `394`, and since D-010 it holds as many as are sent.**
   *
   * ⛔ **Ordered, and ledger order is delivery order.** A new entry goes on the end; 🔴 **D-027 ·
   * a turn's end sends everything held, oldest first, as ONE turn** — up to a person's command,
   * which goes alone ({@link RuntimeHost.theTurnItTakes}). ⚠️ The one-`work`-entry rule criterion 13
   * wrote is gone: a second piece of WORK is refused by the open-work rail instead, because the
   * first opened its task when it was held.
   *
   * ⚑ **Appended by a hold, put back in front by a start, and taken from by whoever ends a
   * message** — the flush after its handover, a take-back, a teardown that empties it — and read by
   * {@link holdsQueued}, which is what makes an ending decidable by whoever gets there first.
   */
  mailbox: QueuedMessage[]
  /**
   * 🔴 **Which pieces THIS conversation has already been told are not being driven** (400 as tasks,
   * corrected by 404) — see {@link RuntimeHost.tellIfNobodyHasYet}.
   *
   * ⛔ **It belongs to the PARENT and it is seeded from the parent's OWN ledger**
   * ({@link SessionStore.workReportedTo}) at registration. `400` kept it on the conversation the
   * work was given to and seeded it from that conversation's task rows, which reads *carried into
   * this slot* as *already told* — and those are opposites for {@link TaskStallCause.app_restarted},
   * whose row is written at a launch with nothing running. ⚑ The durable answer is
   * {@link WorkStallTold}; this is a per-slot cache of it so the push does not read a ledger on every
   * provider event. ⚠️ **A notice this app takes back unread because a later fact made it false
   * stays in both** — the ledger's receipt stands (the giver's own question or new brief told it,
   * R69; a closed piece is owed nothing) — so the cache and the ledger agree by construction.
   *
   * ⚠️ **A piece goes in before the push is awaited, and nothing is ever taken out of it.** *Told
   * once per piece*, by ruling (D-016c) and not because a piece stalls only once: `derivePieces`
   * puts a stalled piece back to `working` when a turn of its owner's drives it (`drivenAgain`,
   * D-005; per piece since D-016 · commit 6) or a message carrying it goes out, and a later drive
   * can stall it again — that second episode tells nobody. Nor does a moved cause (`400`), and a stop or a start moves no piece and tells nobody
   * (`05`).
   */
  toldAboutStall: Set<string>
  /**
   * 🔴 **The notices owed to this conversation, one after another** (404).
   *
   * ⛔ **Two notices delivered concurrently RACE, and it was measured rather than reasoned about.**
   * `queueMessage` sends when `handle.status()` reads `idle` and holds otherwise; two calls started
   * in one tick both read `idle`, both call `send`, and the provider refuses the second —
   * *"cannot send: session is not active or a turn is in progress"*. ⚠️ **A launch is exactly where
   * that happens**: one conversation can owe a parent several notices at once, and `settleStranded-
   * Messages` and `settleRestartedWork` between them stall every open task of a crashed child.
   *
   * ⚑ **A chain rather than a lock**, {@link pump}'s shape one subject over: each delivery is
   * appended to the last, and no step rejects — `tellOneParent` and the retractions each catch
   * their own failures — so the chain cannot break.
   */
  telling: Promise<void>
  /**
   * The in-flight flush, so a second `idle` cannot start a second send of the same message.
   *
   * Needed because {@link RuntimeHost.deliver} is synchronous and the send it triggers is not: two
   * `status: idle` events arriving before the first send resolved would both see a non-empty
   * {@link mailbox} and both send its head.
   */
  flushing: Promise<void> | null
  /**
   * How many interrupt-and-send presses are driving a turn that the queue must not jump ahead of
   * (077) — held while it is above zero.
   *
   * 🔴 **720 · `709` F-7 — a COUNT, and it was a boolean.** ⛔ A second press while the first was
   * still running raised it again (it was already up), and the first press's `finally` lowered it
   * UNDER the second — so the next `idle` let the queued message jump the second press's words,
   * `670`'s defect one press later. ⚑ Each press raises it by one and lowers it by one; the readers
   * ask whether it is non-zero, as they asked whether it was up.
   *
   * Set only by {@link RuntimeHost.sendInterrupting}, whose own `interrupt()` produces the very
   * `status: idle` the flush listens for — so without this the message the user was replacing would
   * be sent first, and the replacement second.
   *
   * ⚑ **670 · and it holds ARRIVALS too**, not only the flush: `queueAs` reads a latched
   * conversation as busy, so a reply or a `message_agent` landing between the interrupt and the
   * replacement's handover is held behind the replacement instead of taking the turn from it.
   */
  holdingQueue: number
  /**
   * 🔴 **723 · R81 — the permission cards whose Cancel asks no turn to stop**, by request id: those
   * raised with `cancelStopsNothing` (since `736`, R97, every Codex elicitation card, and Claude's
   * server form since `728`; from `723` until then only a Codex frame that named no turn), noted
   * by {@link RuntimeHost.deliver}.
   *
   * ⚑ **Read by {@link RuntimeHost.respondPermission}, the one writer of a person's cancel**, so the
   * row it writes says the press asked nothing — {@link UserDecisionEvent.stopsNothing} — and no
   * fold reads it as an ask (R81: *"the host records no ask"*). ⛔ The host does not look a card up
   * at answer time, and the handle's answer carries nothing back, so this is where the fact waits.
   * An id leaves when its card is answered.
   */
  cancelsThatStopNothing: Set<string>
  /**
   * 🔴 **723 · R83 — an ask to stop the provider has not answered yet**, or `null`.
   *
   * ⚑ The ruling (`720` F-F): *"When Codex does not acknowledge a Stop within the bound, the
   * conversation says so in words … and a second press does not queue a second ask behind the
   * first."* ⚑ Set by the host doors that ask — a person's Stop, interrupt-and-send,
   * `interrupt_agent`, and a stop asked for held words to be read now — to the ask each made (the
   * newest wins), and cleared when that ask is answered or the turn it was about ENDS, whichever
   * comes first: after either there is nothing left for a stop to be waiting on. ⛔ **A person's
   * Stop and a stop for held words JOIN it**; interrupt-and-send and `interrupt_agent` keep their own
   * waits and ask again, as `709` F-7 pins (`723`'s response). ⚠️ A card's Cancel asks from inside
   * the adapter and neither sets nor reads it (`723`'s response).
   */
  stopStillAsked: Promise<void> | null
  /**
   * ⛔ **The queued messages that are ON THEIR WAY TO THE PROVIDER right now** — empty the rest of
   * the time (234 §1, from the adversarial pass over this dispatch's own diff). ⚑ **D-027 · a turn's
   * worth**: everything a flush hands over as one turn.
   *
   * ⚠️ **`flushing` is not this fact and the first version of `handOnWhatItHeld` read it as if it
   * were.** `flushing` is set before {@link RuntimeHost.runFlush}'s FIRST await and spans two
   * suspensions that precede the handover — the path re-check (`lstat`/`realpath`/`stat` per
   * attachment) and the turn gate (a Keychain subprocess). A stream that ended in either window
   * therefore published *"it may have reached the agent"* about a message that provably never
   * reached `handle.send`, and that sentence was the ONLY ending the reader got.
   *
   * ⚑ **Set immediately before the handover and cleared in its `finally`**, so the window it names
   * is exactly the window in which the answer is genuinely unknown. On both shipping adapters that
   * window is one statement wide; the point is that the claim is made where the claim is true.
   */
  handingOver: readonly QueuedMessage[]
  /**
   * 🔴 **D-004 · R101 — this child died because the sign-in it was launched with was revoked**
   * (`cause: 'auth_stale'`, fatal). Set by {@link RuntimeHost.deliver}, read once the teardown is
   * done by {@link RuntimeHost.reopenOnARenewedSignIn}.
   */
  diedOnAStaleSignIn?: true
  /**
   * 🔴 **F076 — what the turn a refused login ended was for** — taken as the fatal error arrives,
   * before that turn's ending clears what opened it ({@link turnOpened}): read by
   * {@link RuntimeHost.reopenOnARenewedSignIn}, which tells the reopened conversation about it.
   */
  whatItsFailedTurnWasFor?: WhatAFailedTurnWasFor
  /**
   * ⚑ **F076 — the background work its provider said had finished since its last turn ended**,
   * each ending as the provider stated it — what a turn the provider starts by itself (a wake) is
   * for. ⚑ Emptied as a turn ends.
   */
  finishedSinceItsLastTurn: readonly BackgroundWorkEnded[]
  /**
   * ⚑ **F084 — what the stop of its last turn ended**, named, as that turn's ending said
   * (`endedCommands`): what the giver's notice names when a stop stalled the piece. ⚑ Replaced at
   * every turn ending, so a later stop that ended nothing never names an earlier stop's.
   */
  lastStopEnded: readonly string[]
  /**
   * ⚑ **F084 — what stops ended that the conversation has not been told yet** — said in front of its
   * next turn that takes words ({@link RuntimeHost.withWhatThisLifeOwes}). ⚑ Kept past a turn that
   * took no words of ours (a person's command), and taken off only when the turn that said them
   * ends — 🔴 **D-039's reason**: not one this app ended `failed`, whose provider may never have
   * begun it ({@link stopEndedSaid}). ⚠️ As with {@link firstTurnLead}: a send the adapter refuses
   * after they were composed into it, and that a person's command beat to the turn, loses them when
   * that command's turn ends.
   */
  stopEndedUntold: string[]
  /** ⚑ **F084** — how many of {@link stopEndedUntold} the last words handed over said. */
  stopEndedSaid: number
  explicitStopNotice: ExplicitStopNotice | null
  explicitStopSaid: ExplicitStopNotice | null
  /**
   * ⚑ **Its own questions that stops ended, which it has not been told of yet** — said in front of
   * its next turn that takes words and taken off as {@link stopEndedUntold} is. ⚑ A life that
   * continues a recording begins with what the stop of its last turn ended
   * ({@link RuntimeHost.theQuestionsTheStopOfItsLastTurnEnded}).
   */
  questionsAStopEndedUntold: AQuestionAStopEnded[]
  /** How many of {@link questionsAStopEndedUntold} the last words handed over said. */
  questionsAStopEndedSaid: number
  /**
   * ⚑ **F084 — who waits for this life's next turn ending**, each handed what that ending says its
   * stop ended: `interrupt_agent`'s answer, read once the stopped turn has ended.
   */
  readonly whenATurnEnds: ((ended: readonly string[]) => void)[]
  /**
   * ⚑ **What it holds was read at its turn's `working` status, before the words of a turn of ours
   * landed** — on Claude a turn's `working` lands before its `user_turn` at every turn (`099`), and
   * for as long as it takes to apply a model, effort or mode change; the read there finds every open
   * piece driven until the words name one (`derivePieces`). On Codex the words land first. ⚑ So its
   * `user_turn` compares again ({@link RuntimeHost.publishOurs}); ⚑ cleared there, and at the turn's
   * end (a turn its provider began by itself has no words of ours).
   */
  itsWorkWasReadBeforeItsWords: boolean
  /**
   * ⚑ **This life's turn gate found that the machine's Claude sign-in moved on from the one it was
   * launched with** — set by {@link RuntimeHost.assertSignInCurrent} as it refuses, and never
   * cleared: the child cannot take another turn on what it holds. ⚑ What is held for it waits for
   * {@link RuntimeHost.reopenForWhatWaits}.
   */
  itsSignInMovedOn?: true
  /** Codex refused this life's copy of its sign-in, and a fresh copy of the same account replaced it. */
  itsCopyWasReplaced?: true
  /** A refused copy is considered for replacement only after this server has exited. */
  copyToReplaceAfterExit?: { refused: unknown; replacement: Promise<boolean> | undefined }
  /** This life's one turn was a carrying on after a repaired sign-in: its refusal is never carried on again. */
  itCarriedOnAfterARepair?: true
  /** This rejected turn may request one provider-owned renewal and safe carry-on. */
  itRetriedRejectedLogin?: true
  renewItsRejectedLogin?: true
  rejectedLoginToRenew?: object
  /**
   * ⚑ **This app is closing it to start it again on the current sign-in, for what is held for it**
   * ({@link RuntimeHost.reopenForWhatWaits}) — once per life; the start it asks for says why
   * ({@link ReopenedEvent.because}).
   */
  reopeningOnTheCurrentSignIn?: true
  /**
   * A person approved an MCP server this conversation asked for and its own profile now gets, and
   * this app reopens it so the server's tools reach it, once its turn and any card it waits on are
   * done ({@link RuntimeHost.reopenWhenItsToolsMoved}). The words that tell it so, one for each
   * server approved meanwhile.
   */
  itsToolsMoved?: readonly ItsToolsMoved[]
  /** This app is closing it to start it again with the tools a person approved. */
  reopeningForItsTools?: true
  /**
   * ⚑ **This life is one {@link RuntimeHost.reopenForWhatWaits} started — or the conversation that
   * took the place of one it could not reopen — and its sign-in has not yet read as current**:
   * dropped the first time its turn gate finds it current. ⛔ **The loop guard**: such a life found
   * holding a sign-in that moved on too, within {@link REOPEN_LOOP_GUARD_MS} of its start, is not
   * reopened again by this app within that window (`didNotHelp`) — a launch that reads as moved the
   * moment it starts is no sign-in a second reopen fixes — and what is held waits for a person's
   * Reopen. ⚑ Found later than that, it is a renewal of its own. 🔴 **W4.172 · decided as it is
   * found** ({@link RuntimeHost.assertSignInCurrent}) — not when a reopen is next asked, which at a
   * limit can be long after — ⛔ **and never noted as a change of sign-in**: what it reads is the
   * launch read differently, and noting it would end every limit, again at each reopen. ⚑ `stopped`:
   * the log has said so.
   */
  reopenedForWhatWaited?: { readonly at: number; stopped: boolean; didNotHelp?: true }
  /**
   * ⚑ **What its provider runs on changed after this life launched**
   * ({@link RuntimeHost.providerLoginChanged}, and F096 {@link RuntimeHost.aSignInChanged}) — it
   * keeps what it started with, so the usage it reads is an older login's and is not kept for the
   * Providers screen.
   */
  runsOnAnOlderLogin?: true
}

/**
 * ⚑ **D-017 · R11 — how many of a life's tool calls it keeps the words of**, for a background row to
 * name its command ({@link HostedSession.toolCallsNamed}). ⚠️ A command started more calls ago than
 * this says the provider's description instead.
 */
const TOOL_CALLS_REMEMBERED = 256

/**
 * **What a session's liveness IS on the wire** (149) — the tracker's state plus everything
 * {@link sessionDisclosures} adds to it. One projection, for every way a surface can be told.
 *
 * ⛔ **There were four spellings of this and two of them were short, which is 148 H5.** The live
 * publications merged the disclosures in; the two hand-over paths passed `session.liveness.current`
 * bare. So a renderer that reloaded — HMR, `cmd+R`, a window that lost its list — was handed a
 * liveness with no `signInSuperseded` in it, read absent as false, and lost the amber bar while the
 * handle's latch was still true and every message still refused. The remedy became invisible on the
 * exact gesture a user makes when something looks stuck.
 *
 * ⚠️ **And the tracker's own callback was the third spelling, missing `queued`.** It called
 * `sessionDisclosures({provider, handle})` — without the session — and the parameter is optional, so
 * it published `queued: []` on every silence transition. `acceptLiveness` folds a non-undefined
 * `queued` straight onto `meta`, so a message waiting behind a long turn had its banner and its
 * Cancel taken away by the very silence that made the wait worth watching. Found while fixing the
 * other two; the shape is identical and so is the fix.
 *
 * The rule that replaces the four: nothing outside this function decides what a liveness contains.
 *
 * ⚠️ **`disclosures` is a parameter so {@link publishStateIfChanged} can key and publish from ONE
 * read.** Its own note is why: the dedupe key and the message must be the same object, or the key can
 * come to describe something other than what was sent. Every other caller lets it default.
 */
function livenessFor(
  session: HostedSession,
  disclosures = sessionDisclosures(session),
): SessionLiveness {
  return { ...session.liveness.current, ...disclosures }
}

/**
 * **A session that was told nothing extra.** The one value that means "we appended nothing", so a
 * host with no reader and a launch that found no files disclose the same thing — and the UI, which
 * renders nothing for an empty list, cannot tell them apart because there is nothing to tell.
 */
/**
 * ⛔ **Every status that ENDS a turn** (318) — the boundary the memory-note observation is keyed on.
 *
 * ⚠️ **Three, not one, and `session-store.ts` already knew that.** Its `appendTx` closes the open
 * turn row on `turn` and on `status` of `ended`/`errored`, because a child that dies mid-turn never
 * publishes an `idle` at all. An observation keyed on `idle` alone is an observation that is lost
 * exactly when something went wrong — and, for this one, lost permanently, since the next turn
 * retakes the snapshot it would have been measured against.
 *
 * ⚑ **`waiting_permission` and `working` are deliberately not here**: they are a turn continuing.
 */
const TURN_ENDINGS: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'idle',
  'ended',
  'errored',
])

const NO_INSTRUCTIONS: SessionInstructions = {
  injected: [],
  // 165: no agent memory either. ⚠️ **An empty LIST since 317**, and still never `undefined` — the
  // renderer normalises whatever it is handed precisely because an older shape with the field
  // missing, or holding 165's single object, would otherwise have rendered an empty block.
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  // ⛔ **`false` because we do not know, and that is the SAFE direction of the flag** (319 §2.1).
  // Every other field here means *"we appended nothing"*; this one means *"say nothing about where a
  // recall would show up"*. A host with no reader has no provider answer either, and `true` would
  // put a promise on the panel for a session nobody measured — which is exactly the shape `308` was
  // dispatched for. See the field: `false` is only a MEASURED fact where a reader set it.
  recallsReported: false,
  // ⛔ **`false` for its neighbour's reason** (330 §4): a host with no reader has no provider answer,
  // and the flag's job is to decide whether the panel says an extra sentence at all.
  writesReported: false,
  // ⛔ **`null` because nothing was appended, which is the same statement every field above
  // makes** (442). A host with no instruction reader composed nothing, and `null` is *"we appended
  // nothing"* rather than *"we did not say"* — there is no third value here and none is wanted:
  // the empty `injected` beside it is the same fact from the other side.
  composed: null,
}

export {
  type HostedSession,
  type ItsToolsMoved,
  livenessFor,
  NO_INSTRUCTIONS,
  type ProviderFailureRecipient,
  type ProviderHandover,
  type RecordedProviderFailure,
  type TheTurnOnAPiece,
  TOOL_CALLS_REMEMBERED,
  TURN_ENDINGS,
  type WhoseTurnItIs,
  type WordsForTheNextStart,
}
