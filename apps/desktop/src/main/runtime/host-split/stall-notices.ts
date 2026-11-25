import { errorMessage } from '../session-disclosures'
import type {
  PieceRow,
  TaskStallCause,
  PieceAConversationGave,
  WhatAConversationIsWaitingOn,
  WorkStallTold,
} from '../../../shared/task-contracts'
import { howItsWorkIsDrawn } from '../state-publication-inputs'
import type { HostedSession } from './hosted-session'
import { type RuntimeEvent, capabilitiesFor } from '@brobot2/runtime'
import {
  composeWhatEachPieceIsWaitingOn,
  aStallItsGiverCanBeToldOf,
  // ⚑ **D-017 · R1 — the stalls a turn on their holder drives** — see `aDeliveryIsAboutToDriveIt`.
  ITS_OWNER_RUNNING_AGAIN_DRIVES_IT,
} from '../../../shared/tasks'
import { aPersonsOwn } from './whose-words'
import { undrivenWorkText, theAskNamed, workUndriven } from '../reply-rails'
import { THE_APP_ITSELF, type RuntimeEventSink, type Caller } from '../conversation-caller'
import type { SessionSlot } from './session-slot'
import type { HandedPath } from '../../../shared/attachment-contracts'
import type { MailboxKind } from '../../../shared/conversation-events'
import type { FactsAQueueCarries } from '../message-records'
import type { QueueOutcome, RuntimeChangeMessage } from '../../../shared/runtime-ipc'
import type { Startable } from './deliveries'
import type { Exchange } from '../../../shared/last-exchange'
import type { Provider } from '@brobot2/shared'
import type { SessionStore } from '../../db/session-store'

/** What StallNotices reaches in RuntimeHost, each read only when called. */
interface StallNoticesHost {
  aReopenIsBeingDecidedFor(): ReadonlyMap<string, number>
  arrivals(): ReadonlyMap<string, Promise<void>>
  askAgainOnceItArrived(): Set<string>
  heldAsLastRead(): Map<string, ReadonlyMap<string, string>>
  launches(): { readonly closed: boolean }
  slots(): ReadonlyMap<string, SessionSlot>
  startComingAfterTheRestart(): ReadonlySet<string>
  upSince(): number
  repairingStartup(): boolean
  aTurnRunsIn(session: HostedSession): boolean
  ensureRunning(sessionId: string, window: RuntimeEventSink | null): Promise<string>
  keptStopped(sessionId: string): boolean
  limitAccountOf(conversation: string, at: number): string | null
  mayReadTheTranscriptOf(target: string): boolean
  nameByItsWork(conversation: string): string
  nameByItsWorkUnder(conversation: string, piece: string | null): string
  oneWaitReadPerAnswer(): (id: string) => WhatAConversationIsWaitingOn
  piecesCoveredByProviderFailureNotice(holder: string): ReadonlySet<string>
  publishOurs(session: HostedSession, event: WorkStallTold): void
  queueMessage(
    sessionId: string,
    text: string,
    by: Caller,
    attachments: readonly HandedPath[],
    kind: MailboxKind,
    facts: FactsAQueueCarries,
  ): Promise<QueueOutcome>
  runsNow(sessionId: string): boolean
  startable(sessionId: string): Startable | null
  theExchangeShownWith(piece: PieceRow): Exchange
  theIdsItStandsFor(sessionId: string): readonly string[]
  theOneInItsPlace(sessionId: string): string
  theResetItWaitsFor(provider: Provider, account: string | null): number | null
  theWorldMoved(what: RuntimeChangeMessage['what']): void
  whatStillRunsIn(sessionId: string): string[]
  whatToCallTheConversation(conversation: string): string
}

type StallNoticesDeps = {
  readonly store: Pick<
    SessionStore,
    'piecesGivenBy' | 'piecesOwnedBy' | 'whatTheQuitClosed' | 'workReportedTo'
  >
}

/** Telling a giver its work stalled or moved, and the windows when a piece a conversation holds moved. */
export class StallNotices {
  constructor(
    private readonly readDeps: () => StallNoticesDeps,
    private readonly host: StallNoticesHost,
  ) {}

  /** RuntimeHost's wrapped deps, read when used: the leaf is built before RuntimeHost wraps them. */
  private get deps(): StallNoticesDeps {
    return this.readDeps()
  }

  /**
   * 🔴 **Tell whoever gave this work that nothing is driving it** (400, HO-018 §2.1 ·
   * criterion 4).
   *
   * ## ⛔ A PUSH, and the fold is what decides there is anything to push
   *
   * ⚠️ **HO-018: *"a turn that ends with the task still open is an observation, not a guess — mark
   * it `stalled` immediately, no timer, and push it to the parent."*** ⛔ The marking is
   * {@link derivePieces}, from the ledger, and it happens whether or not this method ever runs — so a
   * missed notice costs a message and never a fact. ⚑ **The push is what this adds**, and it goes to
   * {@link PieceRow.giver}: the conversation that gave the work, read off the row rather than
   * looked up, so a parent that has since been rotated or ended is simply not there to tell.
   *
   * ## ⚠️ Once per task, and the bound is honest
   *
   * ⛔ **{@link HostedSession.toldAboutStall} is a de-duplicator and nothing is ever taken out of
   * it.** *Told once per task* is a ruling (D-016c), not a property of the fold: a stalled task goes
   * back to `working` when a turn of its owner's drives it (`drivenAgain`, D-005; per piece since
   * D-016 · commit 6) or a message carrying it goes out, and a later drive can stall it again — and
   * that second episode tells nobody. ⚑ The set is
   * per-slot and in memory on purpose: it is not a record of anything, and the durable answer is the
   * row.
   *
   * ⚠️ **What a parent is therefore NOT told**: that the cause moved. A task stalled by a turn's own
   * ending and then interrupted keeps the first observation on the row and sends no second message —
   * a notice whose frequency tracked how chatty a child is would not be a fact about the work.
   * ⚑ **Nor that its holder stopped or started** (D-016c, `05`): a stop and a start move no piece, so
   * there is nothing to tell and nothing to set right — *once per piece* has no exception.
   *
   * ## 🔴 WHERE this is called STOPPED being the rule about which causes reach a parent (404)
   *
   * ⛔ **This hangs off the PUMP — a provider's own `turn` and `status` — and until `404` nothing
   * else asked the question at all.** `400` wrote the placement down as the rule, with this list:
   *
   *  - **`turn_ended` and `turn_interrupted`** arrive here, live, with the parent's slot in place.
   *  - **`app_restarted`** is written by `SessionStore.settleRestartedWork` at construction, when by
   *    definition nothing is running. There is no pump and no parent.
   *  - **`message_never_sent`** is written by {@link handOnWhatItHeld} (a handover a stop cut) and by
   *    `runFlush` through {@link publishOurs}, which is not the pump.
   *
   * ⚠️ **Two of those readings are wrong and both were measured** (`404`):
   *
   *  - ⛔ **The app closing a session DOES reach this method.** `close()` runs `handle.close()`, the
   *    adapter's `turn: interrupted` and `status: ended` come back up the stream, and `deliver`
   *    calls this on both — so a parent that is still live IS asked. `404` measured it refused, not
   *    skipped: the parent is mid-turn on the notice the interruption just produced, and
   *    `queueMessage` answered *cannot send: session is not active or a turn is in progress*.
   *    ⚑ **Since `657` that arm is a lost race and is HELD** (`queueAs`, `after-a-lost-race`), so the
   *    second notice goes out as the parent's next turn; only the *not active* half of that text
   *    still refuses.
   *  - ⛔ **`app_restarted` was not the only cause that never arrived.** `turn_ended` reaches nobody
   *    either when the parent's own conversation was closed at the moment its child's turn ended —
   *    the cause is not what decides, the parent's slot is.
   *
   * ⚑ **So the placement is no longer the rule.** {@link tellAboutWorkItGaveOut} asks the same
   * question whenever a parent becomes reachable and {@link settleTheNoticesFor} asks it as a
   * conversation ends; what a cause decides now is only the sentence, and the decision about who is
   * owed a message is {@link tellIfNobodyHasYet}'s alone.
   *
   * ⚠️ **A table restating that list was written and then removed.** It was keyed by the vocabulary
   * and read exactly right, and no mutation could kill it: every entry it would have refused is
   * already unreachable from here, so the guard carried no rule — `a-line-no-mutation-can-kill-is-
   * not-carrying-its-rule`, found by its own row surviving.
   *
   * ## 🔴 It cannot be refused, and that is why it is a third mailbox kind
   *
   * ⛔ **`'notice'`, never `'work'`** — see {@link MAILBOX_KINDS}. A parent that is busy holding a
   * work message would refuse this one under criterion 13's singleton, and the parent would never be
   * told: the criterion failing silently, exactly when the parent has the most going on. ⚠️ And
   * never `'question'` either: nothing is blocked on the answer and there is no request id to quote.
   *
   * ## ⚠️ What it does NOT do
   *
   * ⛔ **It does not decide anything about the work.** HO-018's principle is that the parent decides
   * — wait, interrupt, re-assign or end — and this method has no opinion; it delivers a sentence
   * about what was observed. ⚑ **And it never throws**: it runs from the event pump, so a delivery
   * failure escaping here would take out the stream for every session.
   *
   * 🔴 **D-033 · its one read decides the windows' push too** — every window hears, once, when a
   * piece it holds moved ({@link sayWhenItsWorkMoved}).
   */
  tellWhoeverGaveTheWork(
    /** ⚑ **702 · the conversation HOLDING the work, by id** — this method only ever reads the id. */
    holder: string,
  ): void {
    try {
      // 🔴 **603/609 · the COMPOSED rows ({@link whatItHolds}), so a worker waiting on an answer, on
      // a person or on a worker of its own is not reported as having said nothing.**
      // ⛔ {@link aStallItsGiverCanBeToldOf} answers `false` for a {@link TaskWait} row because
      // {@link composeWhatEachPieceIsWaitingOn} clears the cause with the state, so this reader needs
      // no second condition — which is what makes the rule one derivation rather than two.
      const composed = this.whatItHolds(holder)
      this.sayWhenItsWorkMoved(holder, composed)
      for (const piece of composed) this.tellIfNobodyHasYet(piece)
    } catch (error) {
      // Reporting stalled work must not stop the provider stream.
      console.warn(
        `runtime host could not report undriven work in ${holder}: ${errorMessage(error)}`,
      )
    }
  }

  /**
   * 🔴 **D-033 · a piece a conversation holds moved without a verb — every window hears that the
   * work moved** — at once, and once per change, as it does for the verbs that move a piece
   * ({@link theWorldMoved}): a turn's end stalls it, or leaves it waiting on the person who asked; a
   * turn drives it again; a card its provider raises or settles makes it wait on a person, or not.
   *
   * ⚑ **What a window draws of each open piece**: its COMPOSED state
   * ({@link composeWhatEachPieceIsWaitingOn}) and, for a stall, its cause ({@link howItsWorkIsDrawn})
   * — compared with the last read of that conversation ({@link heldAsLastRead}). ⚑ So a stall a wait
   * already covers says nothing, and nor does a row that moved no piece. ⛔ A piece that ended is the
   * verb's that ended it, and is not counted here; ⚑ a piece first seen as its give opened it —
   * `working`, or `waiting` while its brief is held — is the give's, which announced.
   *
   * ⚑ **Off the read its stall notice already takes** — {@link tellWhoeverGaveTheWork}'s, after every
   * `turn` and `status` row and at this host's own moments that stall or drive work outside one —
   * and two of its own, each once per moment and never per row of a stream: as a conversation starts
   * ({@link takeWhatItHolds}, which says nothing), and at the one background level that can stall
   * held work ({@link sayWhetherALevelMovedItsWork}).
   *
   * ⚠️ **What it says more than once**: a verb's move, said again by the next read of its holder; a
   * conversation's ending, by its teardown too; a held message's flush, before the turn it starts;
   * and a conversation this app run never started — read first by a replacement or a late stall —
   * which cannot know what a window last read, and says so whenever it holds open work.
   *
   * ⚠️ **What it does not see at once**: a card a person owes that opens or closes while another is
   * already open writes no `status` row, so the next row of that conversation says it. ⚑ **A turn's
   * start**: on Codex its words land before its provider's first `status` ({@link handToProvider}),
   * so the read there sees the drive they name. On Claude the `status` comes first at every turn
   * (`099`), and for as long as the turn applies a model, effort or mode change; the read there finds
   * every open piece driven until the words name one (`derivePieces`). ⚑ So the words' own row
   * compares again ({@link HostedSession.itsWorkWasReadBeforeItsWords}), and says what moved back.
   */
  sayWhenItsWorkMoved(holder: string, composed: readonly PieceRow[]): void {
    const now = howItsWorkIsDrawn(composed)
    const before = this.host.heldAsLastRead().get(holder)
    this.host.heldAsLastRead().set(holder, now)
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
    if (moved) this.host.theWorldMoved('work')
  }

  /**
   * 🔴 **D-033 · a background level moved: what work held on it may have stalled** (D-013) — when
   * nothing it waited on is left running or scheduled, its fold stalls it at that row, and a turn
   * driving another piece may be running meanwhile, which reads nothing until it ends.
   *
   * ⚑ **Read only at the row that can do it**, the fold's own test (`backgroundMoved`): on a
   * provider whose background wakes it — no other holds work for the background — and only when this
   * row leaves nothing running and nothing scheduled ({@link takeTheLevels} has applied its level; an
   * ending names its one row). ⛔ Every other level row moves no piece and reads nothing. ⛔ **It
   * never throws** — it runs from the pump.
   */
  sayWhetherALevelMovedItsWork(
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

  /**
   * 🔴 **D-033 · what a conversation holds as it starts, taken as windows have drawn it** — so the
   * first row of this life is compared with that ({@link sayWhenItsWorkMoved}), and says nothing
   * unless the work moved. ⛔ Announces nothing itself. ⚠️ **It never throws** — it runs inside a
   * registration; a read that fails leaves the last one, or none.
   */
  takeWhatItHolds(holder: string): void {
    try {
      this.host.heldAsLastRead().set(holder, howItsWorkIsDrawn(this.whatItHolds(holder)))
    } catch (error) {
      console.warn(
        `runtime host could not read what ${holder} holds as it started: ${errorMessage(error)}`,
      )
    }
  }

  /**
   * ⚑ **D-033 · the pieces a conversation holds, COMPOSED** — the one read behind its stall notice
   * ({@link tellWhoeverGaveTheWork}) and behind what every window hears of them
   * ({@link sayWhenItsWorkMoved}).
   *
   * ⚠️ **676 · F1 — no `RowsUnread` here, on purpose**: a push has no payload to carry a count in, and
   * a torn row it meets is warned where it is skipped — see {@link oneWaitReadPerAnswer}.
   */
  whatItHolds(holder: string): readonly PieceRow[] {
    return composeWhatEachPieceIsWaitingOn(
      this.deps.store.piecesOwnedBy(holder),
      this.host.oneWaitReadPerAnswer(),
    )
  }

  /**
   * 🔴 **The same obligation asked from the OTHER end of the edge** (404, HO-018 §2.1 ·
   * criterion 4) — *is there work THIS conversation gave out that nothing is driving?*
   *
   * ## ⛔ Why a second trigger exists at all, measured
   *
   * ⚠️ **{@link tellWhoeverGaveTheWork} hangs off a provider's own events**, and `402` measured what
   * that costs: F6, row 15 — `1 inbound row on the pm; "is not being worked on" ABSENT` — beside a
   * row 14 that PASSED with `1 work_restarted` and the task `stalled` `because: app_restarted`.
   * 🔴 **A conversation that is not running pumps nothing, and a restart is exactly the moment
   * nothing is running**, so criterion 14's own cause could never reach a parent.
   *
   * ⛔ **The repair is not a call the launch forgot to make.** At construction there is no slot for
   * anybody: `settleRestartedWork` writes into ledgers, and `queueMessage` needs a live conversation
   * to put words into. ⚑ **So the trigger is the moment that changes** — a parent becoming
   * reachable — and this runs from {@link register}, once, for every conversation this host takes
   * up, whether a person opened it or an agent spawned it.
   *
   * ## ⚠️ It is not a poll, a clock or a surface, and each of those is a rule
   *
   * ⛔ **No timer.** HO-018 §2.2 withdrew criterion 5 and `400` deleted the assertions that served
   * it; a push driven by a clock would put back exactly what was retracted. ⚑ This fires on an
   * event — a session registering — and never on an interval.
   *
   * ⛔ **No surface.** A spawned parent registers with {@link NO_SURFACE} and `alive: false`, and
   * this line sits nowhere near a sink gate: `396` §2.1's rule is that a gate answering *is anybody
   * looking?* must not decide whether work happens.
   *
   * ⛔ **Not a reader.** `list_tasks` already computes the same fact on demand; what this adds is
   * that the parent is TOLD, which is HO-018 §2.1's whole amendment.
   */
  tellAboutWorkItGaveOut(session: HostedSession): void {
    try {
      // 🔴 **603 · composed, for {@link tellWhoeverGaveTheWork}'s reason** — a parent coming up
      // must not be handed a notice about a child that is waiting on IT.
      // ⚠️ **676 · F1 — no `RowsUnread` here, on purpose**: a push has no payload to carry a count
      // in, and a torn row it meets is warned where it is skipped — see {@link oneWaitReadPerAnswer}.
      // ⚑ **D-017 · R10 — and what the ones it took the place of gave** ({@link theIdsItStandsFor}):
      // their work is this conversation's to be told about.
      for (const piece of composeWhatEachPieceIsWaitingOn(
        this.host.theIdsItStandsFor(session.id).flatMap((id) => this.deps.store.piecesGivenBy(id)),
        this.host.oneWaitReadPerAnswer(),
      )) {
        this.tellIfNobodyHasYet(piece)
      }
    } catch (error) {
      // ⛔ **Never out through {@link register}**, whose caller is a launch or a resume: a database
      // that cannot be read must not cost the conversation itself.
      console.warn(
        `runtime host could not report work given out by ${session.id}: ${errorMessage(error)}`,
      )
    }
  }

  /**
   * 🔴 **One task, one decision: is a parent owed a notice about this, and has it had one?** (404).
   *
   * ⛔ **The de-duplicator lives on the PARENT and is seeded from the PARENT's ledger** — see
   * {@link HostedSession.toldAboutStall}. `400` kept it on the conversation the work was given TO
   * and seeded it from that conversation's own task rows, which reads *carried into this slot* as
   * *already told*; for {@link TaskStallCause.app_restarted} the two are opposites, because the row
   * is written at a launch when nobody could have been told anything.
   *
   * ⚑ **D-017 · R1 — a parent this host is not running is STARTED**, when the ledger says it is owed
   * the notice ({@link startTheGiverFor}): its start asks again ({@link tellAboutWorkItGaveOut}) and
   * tells it. ⚠️ Not while the app quits, and never from the launch sweep: a giver a quit or a crash
   * left is told at its next start. ⚠️ A slot that is `closing` is a conversation being torn down,
   * and a notice queued into it would be handed on by the same teardown — so it is skipped, and its
   * next start tells it.
   *
   * ⚠️ **The id goes in BEFORE the delivery is awaited**, which is what stops a second trigger
   * landing in the gap and sending the same notice twice. ⛔ **It is not taken out again when the
   * delivery fails.** ⚑ Nothing durable is written on that path, so the receipt is absent and the
   * NEXT registration — whose set is seeded from the ledger — is owed the notice again; what a
   * failure costs is the rest of this app run, and never the fact.
   *
   * ⛔ **D-016 · commit 6 · never about a piece a person gave**, whatever stalled it
   * ({@link aStallItsGiverCanBeToldOf}): there is no conversation to tell, and the person who asked
   * reads its row.
   */
  private tellIfNobodyHasYet(piece: PieceRow): void {
    if (!aStallItsGiverCanBeToldOf(piece)) return
    // A quiet turn first gives its holder a chance to settle the work.
    if (piece.stalledBecause === 'turn_ended') return
    if (
      piece.providerTurnFailure !== undefined &&
      this.host.piecesCoveredByProviderFailureNotice(piece.owner).has(piece.piece)
    )
      return
    // 🔴 **Nothing about work whose owner the restart's wake is about to start** — that start drives
    // it ({@link wakingForStoppedWork}); its end asks again. ⚑ **Nor, during a quit, about work the
    // quit's own stop took the background from**: the next launch decides, and wakes its owner.
    if (this.host.startComingAfterTheRestart().has(piece.owner)) return
    // ⚑ **F076 — nor about work whose owner a refused login just stopped**, until its reopen is
    // decided: then it is asked again ({@link reopenOnARenewedSignIn}).
    if (this.host.aReopenIsBeingDecidedFor().has(piece.owner)) return
    if (this.host.launches().closed && piece.stalledBecause === 'background_stopped') return
    // ⚑ **D-017 · R1 — nothing about work a delivery is about to drive** — see
    // {@link aDeliveryIsAboutToDriveIt}.
    if (this.aDeliveryIsAboutToDriveIt(piece)) return
    // ⚑ **D-017 · R10 — a giver that could never be reopened is told in the one in its place.**
    const slot = this.host.slots().get(this.host.theOneInItsPlace(piece.giver))
    const parent = slot?.phase === 'live' ? slot.session : null
    if (parent === null) {
      if (slot === undefined) this.startTheGiverFor(piece)
      return
    }
    // ⛔ **Told once per piece** ({@link HostedSession.toldAboutStall}): a moved cause, a stop and a
    // start tell nothing (D-016c).
    if (parent.toldAboutStall.has(piece.piece)) return
    parent.toldAboutStall.add(piece.piece)
    // ⛔ **Behind whatever this parent is already being told**, and never beside it — see
    // {@link HostedSession.telling}.
    const cause = piece.stalledBecause
    parent.telling = parent.telling.then(() => this.tellOneParent(parent, piece, cause))
  }

  /**
   * ⚑ **Whether the app's restart is what ended this conversation** — the launch's own sweep
   * (`app_restarted`), or a quit that closed it and nothing has reopened since
   * (`SessionStore.whatTheQuitClosed`). ⚠️ A crash leaves no stamp; its stall is the sweep's.
   */
  private theRestartEnded(conversation: string, cause: TaskStallCause): boolean {
    if (cause === 'app_restarted') return true
    if (cause !== 'background_stopped') return false
    try {
      return this.deps.store.whatTheQuitClosed().includes(conversation)
    } catch {
      return false
    }
  }

  /**
   * ⚑ **D-017 · R1 — is this stalled work about to be driven by the delivery its holder was started
   * for?** A holder that RUNS again, with words waiting to go into it — put back first at its start
   * ({@link putBackWhatWaitedForThisStart}: held work, an answer, a message a stop handed on) or
   * waiting in its {@link arrivals} — takes a turn on them as they land, and that turn drives work
   * its turn or its restart stalled ({@link ITS_OWNER_RUNNING_AGAIN_DRIVES_IT}). ⛔ So a notice about
   * it now — *"…is not being worked on"* — is false a moment after it is read, and nothing takes it
   * back: none is pushed. ⚑ The next row that can move the work asks again — the turn's own, a held
   * message ending unsent ({@link askOnceTheQueueLeftItUndriven}), or the arrivals draining
   * ({@link askAgainOnceItArrived}). ⚠️ Never for a holder on its way out: what it holds waits for a
   * start nothing has asked for yet ({@link handOnWhatItHeld}).
   *
   * 🔴 **D-016 · commit 6 · R4 — words waiting drive THIS piece only when they name it or name none**
   * (`derivePieces`' per-piece drive): a held message about another piece drives this one nothing,
   * and a notice about it is true. ⚠️ **A delivery still arriving is not asked which piece it
   * names** — the arrivals line carries no facts — so it defers the notice, and the drain asks again
   * ({@link askAgainOnceItArrived}): a delay, never a false notice. ⚑ **Words a stop was asked for
   * drive every piece here**: the turn they open carries on with what that stop cut
   * ({@link UserTurnEvent.askedForTheStop}). ⚑ **And for work an interrupt cut that the turn it made
   * room for may still go back to** ({@link PieceRow.aTurnMayGoBackToIt}), so does whatever waits,
   * and so does that turn while it runs (F075) — the notice is asked again at its end, and said if
   * the work is still left; ⚑ and a person's words about to replace the turn drive it too.
   */
  private aDeliveryIsAboutToDriveIt(piece: PieceRow): boolean {
    if (!aStallItsGiverCanBeToldOf(piece)) return false
    const cause = piece.stalledBecause
    if (!ITS_OWNER_RUNNING_AGAIN_DRIVES_IT[cause]) return false
    const holder = piece.owner
    if (!this.host.runsNow(holder)) return false
    const arriving = this.host.arrivals().has(holder)
    const session = this.host.slots().get(holder)?.session ?? null
    if (session !== null && session.holdingQueue > 0) return true
    const mayGoBack = piece.aTurnMayGoBackToIt === true
    if (mayGoBack && session !== null && this.host.aTurnRunsIn(session)) return true
    if (arriving) {
      this.host.askAgainOnceItArrived().add(holder)
      return true
    }
    // Words waiting for a new sign-in do not continue the interrupted work in this life.
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
    // Only eligible automatic words depend on the provider's current reset.
    return (
      automaticWordsWait &&
      (session === null ||
        this.host.theResetItWaitsFor(
          session.provider,
          this.host.limitAccountOf(session.id, session.lifeSince),
        ) === null)
    )
  }

  /**
   * ⚑ **D-017 · R1 — start a giver this app is not running, when its ledger holds no receipt for
   * this work** ({@link SessionStore.workReportedTo}, the set its slot is seeded from). Its
   * registration tells it ({@link tellAboutWorkItGaveOut}). ⚠️ Only for a stall in this run — never
   * while the app quits, never one an earlier run left, and never one the launch wrote
   * (`app_restarted`): the launch starts nobody, so that giver is told at its next start.
   */
  private startTheGiverFor(
    piece: PieceAConversationGave & { readonly stalledBecause: TaskStallCause },
  ): void {
    if (this.host.launches().closed || piece.stalledBecause === 'app_restarted') return
    if (piece.stalledAt === null || piece.stalledAt < this.host.upSince()) return
    if (this.host.repairingStartup()) return
    // ⚑ **D-017 · R10** — the giver as it stands now: the one in its place, when it was replaced.
    const giver = this.host.theOneInItsPlace(piece.giver)
    if (this.host.startable(giver) === null) return
    // An archived giver is told when something brings it back.
    if (this.host.keptStopped(giver)) return
    if (this.deps.store.workReportedTo(giver).has(piece.piece)) return
    this.host.ensureRunning(giver, null).catch((error: unknown) => {
      console.warn(
        `runtime host could not start ${giver} to tell it about ${piece.piece}: ${errorMessage(error)}`,
      )
    })
  }

  /**
   * ⚑ **Put the notice into the conversation that gave the work** (400) —
   * {@link deliverQuestion}'s shape, one subject over, and through the same door for the same
   * reason: work, replies, questions and this all arrive in a conversation as a `user_turn`.
   *
   * ⚑ **D-017 · R1 — a parent this host is not running is started first** ({@link
   * startTheGiverFor}); its registration comes back here. The row is durable and `list_tasks` is the
   * door, which is what makes the push an addition rather than the only copy.
   *
   * ⚠️ **Called as {@link THE_APP_ITSELF}**, so the notice lands as this app's words and never as a
   * message an agent sent — and, since D-016, no message is work at all: a piece is given with
   * `give_work`.
   */
  private async tellOneParent(
    parent: HostedSession,
    piece: PieceAConversationGave,
    cause: TaskStallCause,
  ): Promise<void> {
    try {
      const held = await this.host.queueMessage(
        parent.id,
        // 🔴 **614 · the ledger read, here and not inside the composer** (`HO-088` §5.2) —
        // `reply-rails.ts` has no store and must not grow one.
        //
        // ⛔ **By {@link PieceRow.owner}**, the conversation the sentence is already about, and
        // never by the slot map: a child this host is not running still has a ledger, and the two
        // triggers reach this line from opposite ends of the edge — {@link tellWhoeverGaveTheWork}
        // from the CHILD's own pump and {@link tellAboutWorkItGaveOut} from the PARENT registering.
        //
        // ⚠️ **One query per notice, and a notice is sent at most once per piece** —
        // {@link HostedSession.toldAboutStall}, never by a child's turns. It is indexed on
        // `events.turn_id` and narrowed by the same sub-select `lastEndedTurn` uses, so it costs what
        // that read costs.
        // ⚑ **624 · the NAME is read here too, beside the ledger read, and for its reason** —
        // see {@link whatToCallTheConversation}. ⛔ `reply-rails.ts` has no store and must not
        // grow one, which is the boundary `614` stated when it put the words read on this line.
        undrivenWorkText(
          piece,
          cause,
          // 🔴 **D-012 · the last exchange, previewed** — in place of `614`'s 4 KB quote.
          this.host.theExchangeShownWith(piece),
          this.host.whatToCallTheConversation(piece.owner),
          // 🔴 **724 · `720` F-C — and whoever ASKED is named too** — ⚑ unless it is the parent
          // reading this (`729`, R90): then it is said as its own act. ⚑ **D-016 · commit 7 · R3 —
          // by the piece it owns**: no piece in the sentence names the asker — ⚑ F033 · its piece
          // on the chain of the one whose turn it stopped.
          theAskNamed(
            piece.stalledBy,
            (conversation) => this.host.nameByItsWorkUnder(conversation, piece.piece),
            // 🔴 **729 · R90 — the parent this is written to READS it**, so an ask it made itself is
            // said as its own act — `parent.id`, the conversation the words go to.
            parent.id,
          ),
          (who) => this.host.nameByItsWork(who.conversation),
          // ⚑ **D-012** — `read_transcript` is named only to a parent it would admit.
          this.host.mayReadTheTranscriptOf(piece.owner),
          // ⚑ Whether the app's restart ended that conversation: the launch's own sweep, or a quit's
          // stamp, which a reopen clears.
          this.theRestartEnded(piece.owner, cause),
          // ⚑ F084 · what it still has running in the background — on a provider whose background
          // work never wakes it, the piece stalls at its turn's end whatever still runs.
          this.host.whatStillRunsIn(piece.owner),
          // ⚑ F084 · and what the stop of its last stopped turn ended.
          this.host.slots().get(piece.owner)?.session?.lastStopEnded ?? [],
        ),
        THE_APP_ITSELF,
        [],
        'notice',
        // ⚑ **The same facts for the other half of what comes back** (406) — see
        // {@link workUndriven}. A notice and a reply are one surface to a reader: both are *what
        // happened to work this conversation gave out*, and only one of them had a row.
        { report: workUndriven(piece, cause) },
      )
      // 🔴 **The receipt, and it is written only when the delivery was accepted** (404) — see
      // {@link WorkStallTold}. ⛔ A `throw` above leaves no row, so the next launch asks again
      // rather than inheriting a claim that this conversation was told something it never heard.
      //
      // ⚠️ **The held message is NAMED when there was one.** `queueMessage` either sends or holds,
      // and a held notice can still be abandoned by a quit or by the next launch; naming it is what
      // lets `SessionStore.workReportedTo` withdraw the receipt instead of standing on it.
      this.host.publishOurs(parent, {
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

  /**
   * 🔴 **The one cause the APP writes as a conversation stops, settled then** (404, criterion 4).
   *
   * ⛔ **{@link TaskStallCause.message_never_sent} — {@link handOnWhatItHeld}'s cut handover — never
   * reaches the pump**, so a parent that is live right now would otherwise learn about it at its
   * next registration or not at all. ⚑ Every piece this
   * conversation was given is asked about once, here, after the terminal is recorded — and its giver
   * is told as the pump tells it ({@link tellIfNobodyHasYet}). ⚑ **D-017 · no stop is anybody's own
   * act any more** (`end_agent` is gone), so there is no receipt to write in place of the telling.
   */
  settleTheNoticesFor(session: HostedSession): void {
    try {
      // ⚑ **603 · composed here too.** ⚠️ A question the worker had raised is ended by the same
      // teardown, so the two readings agree by the time this runs and the composition costs a read
      // that almost always answers empty. ⛔ It is here for the case where they do NOT: `close()`
      // writes the endings in one stretch, and a reader that composed at three of four sites would
      // be the exception-at-one-depth this dispatch exists to remove.
      // ⚠️ **676 · F1 — no `RowsUnread` here, on purpose**: a push has no payload to carry a count
      // in, and a torn row it meets is warned where it is skipped — see {@link oneWaitReadPerAnswer}.
      for (const piece of composeWhatEachPieceIsWaitingOn(
        this.deps.store.piecesOwnedBy(session.id),
        this.host.oneWaitReadPerAnswer(),
      )) {
        if (aStallItsGiverCanBeToldOf(piece)) this.tellIfNobodyHasYet(piece)
      }
    } catch (error) {
      // ⛔ **Never out through the finalizer**, which has to reach the slot's own release. ⚠️ **What a failure here costs is named rather than swallowed**: a push not made is
      // owed again at the parent's next registration.
      console.warn(
        `runtime host could not settle the notices for ${session.id}: ${errorMessage(error)}`,
      )
    }
  }
}
