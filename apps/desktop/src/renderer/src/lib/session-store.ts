import { createLiveSessionRecords } from './live-session-records'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import { computed, reactive, ref, type Ref } from 'vue'
import { activityOf } from '../../../shared/what-is-being-done'
import type {
  ResumedSession,
  LaunchRefusal,
  RuntimeEventMessage,
} from '../../../shared/runtime-ipc'
import { markReopened } from './transcript'
import { createProviderBlockStore } from './provider-limit-facts'
import {
  acceptEvent,
  acceptLiveness,
  adoptSession,
  foldHeldEvents,
  openWindow,
  readableError,
  type SessionPhase,
  type SessionRecord,
} from './session-record'
import type { SessionStore } from './session-store-contract'
import { createSessionCommands, type SessionCommands } from './session-store-commands'
import { createPersonReads } from './session-store-person-reads'
import { createSessionControls } from './session-store-session-controls'
import { createSessionReads } from './session-store-session-reads'
import { createTurnControls } from './session-store-turn-controls'
import { overTheWire } from './session-store-wire'

export type {
  FirstMessageCameTo,
  LaunchDoor,
  LookedBy,
  SendIntent,
  SessionSnapshot,
  SessionStore,
} from './session-store-contract'
export {
  A_COMMAND_HAS_NOT_ANSWERED,
  A_COMMAND_IS_WAITED_ON_MS,
  answerNeverLeftThisWindow,
  overTheWire,
} from './session-store-wire'

/**
 * Open sessions for this window; the active selection belongs to the view.
 * Switching views changes the rendered record without calling the host.
 * The injected bridge lets tests cover routing, buffering and ordinal continuity
 * without a window, DOM or provider.
 */

/**
 * A launch with no session id to key it by (102): the new conversation from the front door — and
 * since `718` there are two, the StartAsAgent sheet's being {@link PLACED_LAUNCH}.
 *
 * A reopen is keyed by the id it is reopening; a create has none until the launch it wants to be
 * able to cancel has already finished, so this stands in for it. It is a key in a private map, not
 * an id — nothing outside this module ever sees it.
 */
const NEW_LAUNCH = 'new-conversation'

const PLACED_LAUNCH = 'placed-conversation'

/**
 * 🔴 **725 · `716` F-1 — a start main refused WITH a word, thrown back into the one catch every
 * launch goes through** ({@link SessionStore.create}'s `forLaunch`).
 *
 * ⚑ **The store asks for the answer** (`answerARefusal: true`) so the word can reach the launcher,
 * and then turns it back into a rejection here, so everything `forLaunch` does with one — which ref
 * it writes, whether it is still the gesture's current launch, the caller's own `refused`, a Cancel
 * swallowed — does exactly what it did with the rejection. ⚑ Its `message` is the answer's `said`,
 * which main sends as the sentence a rejection would have carried, byte for byte, and
 * `readableError` leaves a message with no Electron wrapper as it is.
 */
class AnsweredRefusal extends Error {
  constructor(
    readonly reason: LaunchRefusal,
    said: string,
  ) {
    super(said)
  }
}

export function createSessionStore(bridge: ClientSessionApi): SessionStore {
  const records = createLiveSessionRecords(bridge)
  const { sessions, slot } = records
  const providerBlocks = createProviderBlockStore()
  const approvalChoices: SessionCommands['approvalChoices'] = new Map()
  const launchError = ref<string | null>(null)
  const launchRefusal = ref<LaunchRefusal | null>(null)
  const resumeError = ref<string | null>(null)
  const lookError = ref<string | null>(null)
  const placedError = ref<string | null>(null)
  /**
   * What this window called each launch it is waiting on (102), keyed by the gesture that made it.
   *
   * `NEW_LAUNCH` for the new-conversation launcher, whose session id does not exist yet,
   * `PLACED_LAUNCH` for the StartAsAgent sheet's (`718`), and the session id for a reopen.
   *
   * ⚠️ **Reactive, because it is now the answer to "is this one launching?"** — see
   * {@link SessionStore.isLaunching}. A plain `Map` would leave a surface rendering a stale busy
   * state, which on the launcher is a stop button that outlives the thing it stops.
   */
  const inFlight = reactive(new Map<string, string>())
  /** The keys this window cancelled, so the rejection they cause is not reported as a failure. */
  const cancelled = new Set<string>()
  let launchCounter = 0
  /**
   * A name for one launch, unique within this window — which is all it has to be: the host scopes
   * every lookup by the owner as well, so two windows counting from one cannot collide.
   *
   * A counter rather than `crypto.randomUUID`, because the value has no security property to carry
   * and a counter is the same value in a test as in the app.
   */
  const nextLaunchKey = (): string => `launch-${++launchCounter}`

  /**
   * Fold a handed-over conversation's past into the record its live events will land in.
   *
   * Shared by `resume`, `attachOpen` and `claim` (100, 336) — the ways a window is handed a
   * conversation it is not already showing. What they do NOT share is where the epoch falls: see
   * {@link adoptHandover}.
   *
   * 🔴 **653 · the epoch is crossed INSIDE the replay when it falls inside the page.** An attached
   * conversation whose running life was itself a reopen hands over a window holding BOTH lives, and
   * {@link markReopened} belongs between them: after the previous life's ending, before anything the
   * current one has said. ⚑ It is `foldWindow`'s crossing — *"the first event whose ordinal reaches
   * the epoch"* — done on the incremental path, which is the only path adoption takes, so the state
   * a person sees now is the state every later re-fold will rebuild rather than one it corrects.
   *
   * A WINDOW of the ledger since 054, not all of it. The ordinal check inside `acceptEvent` would
   * report a gap on the first replayed event — the window starts partway through — so the record is
   * told where the page begins before it is fed. That is not the check being weakened: it still
   * holds across every event from here on, which is the seam it was written for.
   */
  function replayInto(record: SessionRecord, handed: ResumedSession): void {
    openWindow(record, handed.history)
    // ⛔ Nulled once spent, so the crossing happens exactly once — and `null` from the start is a
    // hand-over with no earlier life in it, which replays exactly as it always did.
    let epoch = record.liveFrom
    // ⚠️ **673 · `>=` is `foldWindow`'s rule and is kept, but it cannot be seen alone today**: the
    // row AT the epoch is the host's `reopened`, which draws nothing, so crossing one row late
    // still lands before the provider's first row. ⛔ Any seam row that moves or goes makes it
    // load-bearing again, silently — `653 M9` flips it with the epoch taken past that row.
    for (const past of handed.history.entries) {
      if (epoch !== null && past.ordinal >= epoch) {
        markReopened(record.control)
        epoch = null
      }
      // The recorded time, not the moment of the hand-over: a conversation shows when it actually
      // happened (Slice 2 · 001).
      acceptEvent(record, {
        sessionId: handed.sessionId,
        ordinal: past.ordinal,
        at: past.at,
        event: past.event,
        ...(past.workAncestry === undefined ? {} : { workAncestry: past.workAncestry }),
        ...(past.ancestryContext === undefined ? {} : { ancestryContext: past.ancestryContext }),
        ...(past.humanFinal === undefined ? {} : { humanFinal: past.humanFinal }),
        ...(past.errorFacts === undefined ? {} : { errorFacts: past.errorFacts }),
      })
    }
    // ⚑ A page that stops short of the epoch is all previous life, so it is crossed at the end —
    // `foldWindow`'s own rule, and what `resume` does below by hand. ⚠️ **673 · no page a claim is
    // handed stops short today** — the host's `reopened` sits AT the epoch — so this line is kept
    // for the same reason as the `>=` above, and `653 M8` removes it with the epoch taken past
    // that row.
    if (epoch !== null) markReopened(record.control)
  }

  /**
   * **Take a conversation the host has handed over — and apply only the corrections it needs** (100).
   *
   * The ONE path for both ways of being handed one. It used to be two, and the second one was
   * wrong: `attachOpen` correctly skipped the reopen corrections and `resume` — the Reopen button
   * itself, the gesture this whole dispatch is about — applied them unconditionally, including when
   * the host had silently attached a session that never stopped. Found in review.
   *
   * ⚠️ **`handover` comes from the HOST, because the renderer cannot tell by looking.** Both answers
   * are a `ResumedSession` with a history window; only the host knows whether it spawned a provider
   * or handed back the one already running.
   *
   * Returns whether this call is what adopted the record, so `attachOpen` can report what it took.
   */
  function adoptHandover(
    record: SessionRecord,
    handed: ResumedSession,
    providerReadAt: number,
  ): boolean {
    providerBlocks.acceptSession(handed, providerReadAt)
    // ⚠️ **Somebody else got there first** (found in review). The reconciliation runs on its own the
    // moment a store is built, and a click can be in the air at the same time — so two hand-overs
    // for one session can both be in flight, and the second must not fold the same events again.
    // Read HERE rather than before the round trip, because the answer can change while it is out.
    //
    // `meta`, not `isLive`: a record exists from the moment an EVENT arrives for it — `slot()` is
    // called by the bridge listener to hold events that beat the host's answer — and such a record
    // has no `meta`, which is why the `live` computed excludes it. Skipping on its mere existence
    // would drop exactly the busiest conversations.
    //
    // A retained record in phase `recorded` is not an already-adopted live session. Let resume replay it, set its epoch, call {@link markReopened} and open it again. Checking `meta` alone would report success while leaving the newly resumed conversation hidden.
    //
    // ⚠️ **It is not the sign-in remedy's bug.** Any close-then-reopen inside one window took this
    // path; the amber button is simply the first thing that does both in one gesture, so it is where
    // a nine-commit-old hole finally surfaced.
    //
    // ⚑ **And 100's race is still closed by this line.** Two hand-overs in flight for one session
    // still cannot both fold: adoption sets `phase = 'open'` synchronously, before the second one's
    // await resolves, so the second still sees an adopted, un-ended record and stops here. What is
    // no longer conflated is "adopted in the life that is running" with "adopted in a life that
    // ended". `openWindow` has cleared the previous life's entries since 064 — its own note says
    // this record is the one a CLOSED session left behind — so the fold below is a fresh page, not a
    // second copy of one.
    if (record.meta !== null && record.phase !== 'recorded') return false
    // ⚑ **D-017b · a conversation drawn from its ledger** — no life is handed over, so none of the
    // corrections a live hand-over makes: the page is replayed, and what the life it records left
    // open is settled at the host's epoch when nothing runs it ({@link ResumedSession.liveFrom}).
    // ⛔ Events this window was sent past the page are not folded into it: they say this window is
    // fed the conversation now, so it is looked at again ({@link settleHeld}), and the host hands it
    // over live.
    if (handed.handover === 'recorded') {
      record.liveFrom = handed.liveFrom ?? null
      record.phase = 'recorded'
      replayInto(record, handed)
      record.meta = handed
      record.earlyLiveness = null
      return true
    }
    // A WINDOW of the ledger since 054, not all of it. The ordinal check inside `acceptEvent` would
    // report a gap on the first replayed event — the window starts partway through — so the record
    // is told where the page begins before it is fed. That is not the check being weakened: it
    // still holds across every event from here on, which is the seam it was written for.
    // 🔴 **653 · the epoch, assigned on EVERY adoption and before the replay that crosses it.**
    // ⚑ For `attached` it is whatever the host says — present only when the running life was itself
    // a reopen, so the page may hold the life before it — and `null` otherwise. ⛔ Assigned even
    // when it is `null`: a record reused from an earlier life in this window would otherwise keep
    // that life's epoch, and every re-fold would cross it. `resumed` sets its own below, once the
    // page has told it where the previous life ends.
    record.liveFrom = handed.handover === 'attached' ? (handed.liveFrom ?? null) : null
    replayInto(record, handed)
    if (handed.handover === 'resumed') {
      // ⚠️ **The epoch, recorded before the correction rather than instead of it (064).** Everything
      // replayed above describes the session we resumed FROM; the next event to arrive is the first
      // of the life that starts now, and `nextOrdinal` is already pointing at it. Written down
      // because a re-fold rebuilds this state from those same raw events, and a correction applied
      // once is a correction the first prepend, release or jump throws away — 061 finding 5.
      record.liveFrom = record.nextOrdinal
      // The replay ends with the session closing; it is open again, and the composer has to know
      // that before any live event arrives. Applied to the CONTROL projection, which is what the
      // composer reads — and which is the same object as the transcript here, because a session
      // that has just been handed its newest page is at its own tail.
      markReopened(record.control)
    }
    // …and for `attached`, NEITHER of those AT THE END. Both say "everything before this point
    // describes a previous life", and an attached session's RUNNING life never stopped:
    // `markReopened` settles the pending cards, clears the activity, stops the running sub-agents and
    // closes the open tool calls — every one of which would be a false statement about a
    // conversation that is running right now. ⛔ **653 · but "no previous life" was one word too
    // wide.** The running life may itself have been a reopen — a window that pressed Reopen and whose
    // store was then rebuilt without a navigation (HMR), or a conversation woken with no window and
    // then claimed — and then the page holds
    // the life before it, ending in `session: ended`. That life DID stop, so the correction is true
    // of it; `replayInto` applies it at the host's epoch and not a line later, so a card the running
    // life has raised since is left exactly as it is.
    // ⚑ **And `attached` takes what the host knew of it as of the page's last row**
    // ({@link ResumedSession.asHandedOver}): the page can begin after the status that opened the
    // running turn, and after the row that set its activity, and folded on its own it then reads
    // `idle` while the turn runs. ⚑ The status always. The activity wherever the host holds one,
    // because a page that begins after a sub-agent's card takes that sub-agent's calls for the
    // conversation's own, and the page's otherwise. On the control projection, which is the
    // transcript here too, and a release carries both from there.
    if (handed.handover === 'attached' && handed.asHandedOver !== undefined) {
      record.control.status = handed.asHandedOver.status
      const activity = activityOf(handed.asHandedOver.told)
      if (activity !== null) record.control.activity = activity
    }
    record.phase = 'open'
    adoptSession(record, handed)
    records.seed(record)
    // ⚑ The life it took ended in what was held for it while the hand-over was on its way — a
    // reopen on the current sign-in, say: the life that runs now is asked for.
    if (phaseOf(record) === 'recorded') void store.look(record.sessionId, 'again')
    return true
  }

  /**
   * ⚑ **D-017b · what a hand-over leaves held, once every hand-over for the record has let go** —
   * folded into a record this window is fed ({@link foldHeldEvents}); for a RECORDED one, only kept
   * when it reaches past the page, and then the record is looked at again: this window is being sent
   * the conversation's events, so the host hands it over live.
   *
   * ⛔ **One look again, never a chain of them.** A look that settles here passes `mayLookAgain`
   * false — it failed, or it was itself the look again — and what it held is dropped instead: the
   * ledger keeps every event, and the next look reads them. Without the bound, a host that refuses
   * the look is asked again the moment it answers, for as long as the window stays open.
   */
  function settleHeld(record: SessionRecord, mayLookAgain = true): void {
    if (record.phase !== 'recorded') {
      const wasOpen = record.phase === 'open'
      foldHeldEvents(record)
      if (wasOpen && phaseOf(record) === 'recorded' && mayLookAgain) {
        void store.look(record.sessionId, 'again')
      }
      letGoIfLeft(record.sessionId)
      return
    }
    // Rows of the running life a page of it was drawn from, held while the page was on its way:
    // the ones that continue it are folded in order ({@link followARowItDoesNotHold}).
    if (record.liveFrom === null) {
      const held = record.earlyEvents
      record.earlyEvents = []
      for (const message of held) {
        if (message.notHeldHere === true && message.ordinal === record.nextOrdinal) {
          acceptEvent(record, message)
        } else if (message.ordinal >= record.nextOrdinal) record.earlyEvents.push(message)
      }
    }
    record.earlyEvents = mayLookAgain
      ? record.earlyEvents.filter((held) => held.ordinal >= record.nextOrdinal)
      : []
    if (record.earlyEvents.length > 0) void store.look(record.sessionId, 'again')
    letGoIfLeft(record.sessionId)
  }

  /**
   * The recorded conversations the screen left while a hand-over or a command for them was still
   * out: let go once that settles, unless the screen shows them again first ({@link SessionStore.keep}).
   */
  const leftWhileBusy = new Set<string>()

  function letGoIfLeft(sessionId: string): void {
    if (leftWhileBusy.delete(sessionId)) store.forget(sessionId)
  }

  /**
   * A row of a running conversation this window does not hold, sent because the window draws it
   * from its ledger. Onto a page of that running life it is folded as a live view folds it, so the
   * view follows the turn and keeps the older history it loaded; past any other page, the page is
   * read again. While a hand-over is in the air it is held for the page on its way
   * ({@link settleHeld}).
   */
  function followARowItDoesNotHold(record: SessionRecord, message: RuntimeEventMessage): void {
    if (record.handover > 0) {
      record.earlyEvents.push(message)
      return
    }
    if (record.meta === null || record.phase !== 'recorded') return
    if (message.ordinal < record.nextOrdinal) return
    if (record.liveFrom === null && message.ordinal === record.nextOrdinal) {
      acceptEvent(record, message)
    } else void store.look(record.sessionId, 'again')
  }

  /**
   * **Ask the host what it is running for this window, and take back what it names** (100).
   *
   * A function rather than only a method, because it now has two callers: the one that runs when a
   * store is built, and {@link askAboutUnknown} below.
   *
   * Failures are deliberately NOT put in `launchError`: nobody pressed anything. A window that
   * cannot reach the host has bigger problems than this reconciliation, and a red banner on arrival
   * about a button the user never touched is noise.
   */
  async function takeBackOpenSessions(): Promise<string[]> {
    const providerReadAt = providerBlocks.beginRead()
    const attached = await bridge.attachOpen().catch((cause: unknown) => {
      console.warn('could not ask the host which sessions it is running:', cause)
      return []
    })
    const taken: string[] = []
    for (const session of attached) {
      // 🔴 **737 review · never a conversation this window is being HANDED** — its own hand-over
      // adopts it (`resume`, `claim`, `startAndSend`). ⛔ An ask about ANOTHER session landed here
      // mid-hand-over and adopted it early, and after an undone start that left an ENDED record for
      // a conversation still open — the state `askAboutUnknown`'s own guard was written against.
      if ((sessions.get(session.sessionId)?.handover ?? 0) > 0) continue
      // ⚠️ **Per session, not per batch** (review sweep). Reconciliation is the one call here that
      // acts on several conversations at once, and without this a single one that failed to fold
      // would abandon every session after it in the list — and, since nothing awaits this method,
      // do it as an unhandled rejection nobody sees. One bad conversation costs itself.
      try {
        if (adoptHandover(slot(session.sessionId), session, providerReadAt))
          taken.push(session.sessionId)
      } catch (cause) {
        console.warn(`could not take back session ${session.sessionId}:`, cause)
      }
    }
    return taken
  }

  /**
   * Which sessions this store has already asked the host to describe — **at most one round trip per
   * session, ever**.
   *
   * The bound is the whole design. Events for an unknown session arrive at streaming rate, and one
   * `attachOpen` per event would be a request storm carrying every open conversation's history
   * window with it. The host's answer is definitive — *these are the sessions you own that are
   * running* — so a session it does not name is one this window does not own, and asking again
   * would not change that.
   */
  const askedAbout = new Set<string>()

  /**
   * ⛔ **The renderer holds this session's events and cannot show it — so ASK** (172).
   *
   * Sessions can start through the IPC bridge outside this store. Their events then enter `earlyEvents` with no `adoptSession` reader, so an unknown-session event must trigger reconciliation rather than rely solely on startup's `attachOpen`.
   *
   * ⚠️ **This is not a poll.** The trigger is the one piece of evidence that cannot be wrong — an
   * event for a conversation this window is receiving and cannot draw. The profile had nothing to do
   * with it, and the fix is deliberately not about profiles: any live session whose description this
   * store missed is now one round trip from the rail instead of unreachable until the next reload.
   *
   * ⚠️ **A `create` in flight is not excluded, and does not need to be.** Its events can legitimately
   * arrive before the launch resolves, so this may cost one extra round trip on such a launch — and
   * the double-adoption it would otherwise cause is already refused by {@link adoptHandover}'s first
   * line, which is 100's race and predates this.
   */
  function askAboutUnknown(sessionId: string): void {
    // 🔴 **737 · not while this window is being HANDED it** (242 §3's rule, which the listener's
    // `meta` check kept only for a record reused from an earlier life). ⛔ A record this window never
    // held has no `meta` while its hand-over is in the air — a reopen from the library, and since
    // `737` every first message to a conversation the quit left open, whose hand-over spans the
    // first send (`startAndSend`) — so its first event asked the host, which handed the slot back
    // mid-call: measured, one `attachOpen` in every such first message, and after an undone start
    // an ENDED record left in the store for a conversation still open. ⚑ Not marked asked, so an
    // event after a hand-over that did not happen still asks.
    if ((sessions.get(sessionId)?.handover ?? 0) > 0) return
    if (askedAbout.has(sessionId)) return
    askedAbout.add(sessionId)
    void takeBackOpenSessions()
  }

  /** ⚑ A record's phase, read fresh — after a fold that may have moved it. */
  const phaseOf = (record: SessionRecord): SessionPhase => record.phase

  const unsubscribeEvents = bridge.onEvent((message) => {
    const record = sessions.get(message.sessionId)
    records.hearEvent(message)
    if (message.notHeldHere === true) {
      if (record !== undefined) followARowItDoesNotHold(record, message)
      return
    }
    // A session we have never heard of is still recorded rather than dropped: it is ours the
    // moment the host answers, and the events before that answer are part of the conversation.
    //
    // 🔴 **…and a session whose HAND-OVER is in the air is the same case, which is 242 §3** (from
    // 239). `record?.meta` alone said "this record can take events" about a reopened conversation —
    // whose `meta` belongs to the life that ended — so the new life's opening events were folded
    // into a transcript `replayInto` was about to clear, and the page that replaced them ends
    // before them. ⚠️ **Measured: three per Codex reopen, dropped, and the fourth reported as
    // *"event stream gap"* in the middle of the conversation.** Held here, they are folded after
    // the replay by {@link foldHeldEvents}, whose `ordinal < nextOrdinal` skip is what keeps an
    // event that is ALSO in the page from being folded twice.
    if (record?.meta && record.handover === 0 && record.phase !== 'recorded') {
      acceptEvent(record, message)
      // ⚑ **D-017b · its fold just ended** — it stopped — so it is looked at again, and the view
      // takes the host's description of a conversation nothing runs here (the hand-back, the
      // grants and the settings of the life that ended are that life's). ⚠️ Read through
      // {@link phaseOf}: `acceptEvent` is what moved it, which the narrowing above cannot see.
      if (phaseOf(record) === 'recorded') void store.look(message.sessionId, 'again')
    } else if (record?.meta && record.handover === 0) {
      // 🔴 **D-004 · R101, D-017b — a RECORDED conversation this window is sent events for**: the
      // host started it for this window (a renewed sign-in, an answer or a message from here), so it
      // is looked at again and handed over live. ⛔ Never folded into the recorded page, and never a
      // start: a look starts nothing.
      record.earlyEvents.push(message)
      void store.look(message.sessionId, 'again')
    } else {
      slot(message.sessionId).earlyEvents.push(message)
      // ⚠️ **Not while we are already being told what this session is.** `askAboutUnknown` exists
      // for a session nobody ever described (172); a hand-over in flight IS that description, and
      // asking again would spend a round trip to be told what is already on its way.
      if (!record?.meta) askAboutUnknown(message.sessionId)
    }
  })

  const unsubscribeLiveness = bridge.onLiveness((message) => {
    providerBlocks.accept(message.sessionId, message.liveness)
    const record = slot(message.sessionId)
    const choice = approvalChoices.get(message.sessionId)
    if (choice && message.liveness.approval)
      choice.nativePending = message.liveness.approval.pendingApprovalMode
    acceptLiveness(record, message.liveness)
    if (choice && record.meta)
      record.meta = {
        ...record.meta,
        pendingApprovalMode:
          choice.requested === record.meta.approvalMode ? null : choice.requested,
      }
  })

  const {
    forSession,
    forSessionSaying,
    noteFailure,
    markSent,
    sendAnswer,
    noteAnswer,
    commandsOutFor,
    dispose: disposeCommands,
  } = createSessionCommands(sessions, letGoIfLeft)

  /**
   * Run a command that has no session yet, reporting where the gesture that made it can show it.
   *
   * `into` is which of the three error refs this gesture owns (100; the sheet's since `718`). All
   * three are cleared on every attempt, not just the caller's own: a stale banner beside a fresh
   * inline failure is the same "one refusal in two places" read a moment later.
   *
   * 🔴 **718 · a refusal belongs to the launch that was refused** (`718`'s review). ⛔ `into` is
   * written only while this is still the gesture's CURRENT launch: a second launch under the same
   * gesture — a sheet closed while its start ran, and another sheet started — would otherwise have
   * the first one's refusal drawn beside the second one's own spinner. ⚑ `refused` hands the
   * sentence to the caller that asked, current or not, so a superseded launch is still SAID by its
   * own caller rather than written onto someone else's surface or swallowed.
   *
   * 🔴 **725 · `716` F-1 — and the word, where main gave one** ({@link AnsweredRefusal}): written
   * beside the launcher's sentence, for the launcher's current launch only, and cleared with the
   * three error refs. ⚑ A start main answered `cancelled` is a Cancel, and is swallowed like one.
   */
  async function forLaunch<T>(
    into: Ref<string | null>,
    gesture: string,
    action: (launchKey: string) => Promise<T>,
    refused?: (sentence: string) => void,
  ): Promise<T | undefined> {
    const key = nextLaunchKey()
    inFlight.set(gesture, key)
    launchError.value = null
    resumeError.value = null
    placedError.value = null
    launchRefusal.value = null
    try {
      return await action(key)
    } catch (cause) {
      const answered = cause instanceof AnsweredRefusal ? cause.reason : null
      if (answered === 'cancelled') return undefined
      // ⚠️ **A launch the user cancelled did not fail** (102). Aborting is how a cancel reaches the
      // provider, so the command it aborts ends — a reopen by rejecting, a start (since `725`) by
      // main's answer `cancelled`, swallowed just above — and reporting either would put a red
      // sentence under a button whose whole meaning was "stop". The host still says what happened,
      // in the log and in the sentence it hands back; this is the one reader that knows the answer
      // was asked for.
      if (!cancelled.has(key)) {
        const said = readableError(cause)
        if (gesture === NEW_LAUNCH && inFlight.get(gesture) === key) launchRefusal.value = answered
        if (inFlight.get(gesture) === key) into.value = said
        refused?.(said)
      }
      return undefined
    } finally {
      cancelled.delete(key)
      if (inFlight.get(gesture) === key) inFlight.delete(gesture)
    }
  }

  /**
   * **Stop waiting for one gesture's launch** — {@link SessionStore.cancelLaunch}'s body, shared since
   * `718` with the sheet's Cancel ({@link PLACED_LAUNCH}) so the two cannot come apart.
   */
  async function cancelGesture(gesture: string): Promise<boolean> {
    const key = inFlight.get(gesture)
    // Nothing in flight under that name: the launch finished between the press and this call, or
    // there never was one. Either way there is nothing to stop and nothing to say about it.
    if (key === undefined) return false
    // Marked BEFORE the ask, not after: the host's abort reaches the adapter within this await,
    // so the rejection `forLaunch` is about to catch can land before this call returns.
    cancelled.add(key)
    try {
      const stopped = await bridge.cancelLaunch({ launchKey: key })
      // ⚠️ **Nothing was stopped, so nothing may be swallowed** (review). The host answers `false`
      // when the launch was already over — which is exactly the race where it ended for a REAL
      // reason a moment before the press. Leaving the mark on would suppress that reason's
      // sentence and leave the user with a launcher that quietly stopped spinning, believing
      // their Cancel had done it.
      if (!stopped) cancelled.delete(key)
      return stopped
    } catch (cause) {
      // The cancel itself failed to be delivered — so the launch is still running and its own
      // rejection (if any) is a real one again. Un-marking is what keeps the error honest.
      cancelled.delete(key)
      console.warn('could not stop this launch:', cause)
      return false
    }
  }

  const commands: SessionCommands = {
    bridge,
    sessions,
    approvalChoices,
    forSession,
    forSessionSaying,
    noteFailure,
    markSent,
    sendAnswer,
    noteAnswer,
  }
  const store: SessionStore = {
    providerBlocks,
    hearProviderStates(message) {
      providerBlocks.acceptMany(message.moved)
      records.hearMoved(message)
    },
    live: computed(() =>
      [...sessions.values()].filter(
        (record) => record.phase !== 'recorded' && record.meta !== null,
      ),
    ),

    get: (sessionId) => sessions.get(sessionId) ?? null,

    isLive: (sessionId) => {
      const record = sessions.get(sessionId)
      // ⚠️ **ADOPTED and not recorded — the same two clauses `live` above filters on** (100, review).
      // A record exists from the moment an EVENT arrives for it: `slot()` is called by the bridge
      // listener to hold events that beat the host's answer, and `createSessionRecord` starts such a
      // record at `opening` — so existing is not being fed.
      return record !== undefined && record.phase !== 'recorded' && record.meta !== null
    },

    launchError,
    launchRefusal,
    resumeError,
    lookError,
    placedError,

    noteLaunchFailure(sentence) {
      launchError.value = sentence
    },

    isLaunching: (sessionId) => inFlight.has(sessionId ?? NEW_LAUNCH),
    isPlacing: () => inFlight.has(PLACED_LAUNCH),

    async create(input, door = 'front-door', refused) {
      const providerReadAt = providerBlocks.beginRead()
      const created = await forLaunch(
        door === 'sheet' ? placedError : launchError,
        door === 'sheet' ? PLACED_LAUNCH : NEW_LAUNCH,
        // 🔴 **725 · `716` F-1 — asked for the refusal's WORD**, and thrown back as a rejection
        // ({@link AnsweredRefusal}) so both doors' refusals take the path they always took.
        async (launchKey) => {
          const answer = await bridge.createSession({ ...input, launchKey, answerARefusal: true })
          if ('refused' in answer) {
            throw new AnsweredRefusal(answer.refused.reason, answer.refused.said)
          }
          return answer
        },
        refused,
      )
      if (!created) return null
      providerBlocks.acceptSession(created, providerReadAt)
      const record = slot(created.sessionId)
      adoptSession(record, created)
      records.seed(record)
      return created.sessionId
    },

    /**
     * Reopen a recorded session. The history is folded through the SAME record the live events
     * will land in, before it is adopted — which is what keeps the ordinals continuous across
     * the seam, and why this cannot be expressed as "build the transcript, then attach it".
     */
    async resume(sessionId) {
      // Already ours: asking again would turn "you are already looking at this" into an error.
      if (this.isLive(sessionId)) {
        // ⚠️ Cleared on the way out (review finding 9). This return skips `forLaunch`, which is what
        // clears the errors on every other attempt — so a row that failed to reopen once kept its
        // sentence under it for the rest of the session, including after a later press worked.
        resumeError.value = null
        return sessionId
      }
      const record = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      void records.read()
      // ⛔ **Hold this session's live events until the page they belong AFTER has been replayed**
      // (242 §3). See {@link SessionRecord.handover}: the host's pump starts at `register`, which is
      // before this round trip returns, so the new life's first events are already on the wire.
      record.handover += 1
      try {
        const resumed = await forLaunch(resumeError, sessionId, (launchKey) =>
          bridge.resume({ sessionId, launchKey }),
        )
        if (!resumed) {
          // Nothing was opened, so leave no half-session behind for the list to show. ⚠️ This is
          // also what acceptance 6 asks about (102): a CANCELLED reopen takes the same exit as a
          // refused one, so the record a buffered event may have created goes with it and nothing is
          // left half-attached. `meta === null` is the same "never adopted" test `isLive` uses.
          if (record.meta === null) sessions.delete(sessionId)
          return null
        }
        // ⚑ **D-017 · R10 — the host may hand back the conversation that took this one's place** — one
        // whose history could never be reopened, replaced for this window — and it is adopted as
        // itself, under its own id, which is what this answers with.
        const opened = resumed.sessionId
        const into = opened === sessionId ? record : slot(opened)
        adoptHandover(into, resumed, providerReadAt)
        if (opened !== sessionId && record.meta === null) sessions.delete(sessionId)
        // ⛔ **The claim needs a source (039, 149)**: the id answers *"can this window show it"*, and
        // a record no map holds cannot be shown — a refused reopen beside this one deletes the
        // never-adopted record this one then adopts. ⚑ **D-017b · a record that stopped again as it
        // was handed over is shown**, recorded: the next message continues it.
        return sessions.get(opened) === into ? opened : null
      } finally {
        // ⛔ **However this ended** (242 §3). The flag blinds the listener while it is up, so every
        // exit has to lower it — including the one nothing else covers: `adoptHandover` throwing,
        // which would otherwise leave this conversation receiving events it silently holds forever.
        record.handover -= 1
        // ⚑ **…and nothing is left held.** `adoptSession` drains on the ordinary path, so this is a
        // no-op there; what it covers is a reopen the host REFUSED (an adopted, recorded record
        // stays in the list, and its events would sit in a buffer whose only other reader runs on
        // success) and a hand-over somebody else adopted first, which never reaches `adoptSession`
        // at all. ⚠️ Skipped for the record that was DELETED just above — folding into an object no
        // map holds is work nobody can see, and would report a gap against a discarded life.
        if (record.handover === 0 && sessions.get(sessionId) === record) settleHeld(record)
      }
    },

    async look(sessionId, by = 'press') {
      // Already fed here: nothing to ask, and asking would hand the same life over twice.
      if (this.isLive(sessionId)) {
        lookError.value = null
        return sessionId
      }
      const holding = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      // ⛔ **`resume`'s bracket** (242 §3): events are held while the page they follow is read.
      holding.handover += 1
      lookError.value = null
      let looked = false
      try {
        const handed = await bridge.look({ sessionId, claim: by === 'press' })
        const into = handed.sessionId === sessionId ? holding : slot(handed.sessionId)
        adoptHandover(into, handed, providerReadAt)
        looked = true
        // ⛔ As `resume` answers (039, 149): an id this window cannot show is not an answer.
        return sessions.get(handed.sessionId) === into ? handed.sessionId : null
      } catch (cause) {
        // ⚠️ As `resume` does for a hand-over that did not happen: a record this call made up for a
        // conversation it does not hold is not left behind — unless another look for it is still on
        // its way, which adopts it or lets it go in its turn.
        if (holding.meta === null && holding.handover === 1) sessions.delete(sessionId)
        lookError.value = readableError(cause)
        return null
      } finally {
        holding.handover -= 1
        if (holding.handover === 0 && sessions.get(sessionId) === holding) {
          settleHeld(holding, looked && by === 'press')
        }
      }
    },

    forget(sessionId) {
      const record = sessions.get(sessionId)
      if (record === undefined) return
      // ⚑ Being handed over, or a command for it still out: let go once that settles.
      if (record.handover > 0 || commandsOutFor(record) > 0) {
        leftWhileBusy.add(sessionId)
        return
      }
      if (record.phase !== 'recorded') return
      sessions.delete(sessionId)
      // ⚑ **The one-ask bound is about a record this store HOLDS** — with the record gone, an event
      // for it later (the host started it for this window: an answer, a renewed sign-in) asks again
      // and is adopted, rather than piling up in a record nothing describes.
      askedAbout.delete(sessionId)
      // ⚑ …and the host stops showing this window the rows it writes while nothing runs it.
      void bridge.stopLooking({ sessionId }).catch((cause: unknown) => {
        console.warn(`could not tell the host this window stopped looking at ${sessionId}:`, cause)
      })
    },

    keep(sessionId) {
      leftWhileBusy.delete(sessionId)
    },

    async startAndSend(sessionId, text, attachments) {
      // ⚑ **`resume`'s bracket** (242 §3): the start's events and the first turn's reach the window
      // BEFORE the answer, exactly as a reopen's do, so they are held until the page is replayed.
      const starting = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      // ⚑ **D-017b · the last refusal said beside the box is the last message's**, not this one's.
      starting.error = null
      starting.handover += 1
      try {
        const answer = await forLaunch(resumeError, sessionId, (launchKey) =>
          bridge.startAndSend({
            sessionId,
            text,
            ...(attachments.length === 0 ? {} : { attachments: overTheWire(attachments) }),
            launchKey,
          }),
        )
        if (answer === undefined) {
          if (starting.meta === null) sessions.delete(sessionId)
          // ⚑ **D-017b · the refusal is said where the words were typed**: the conversation's own
          // record, which the composer draws beside the box it gave them back to.
          else if (resumeError.value !== null) starting.error = resumeError.value
          return null
        }
        // ⚑ **D-017 · R10 — the conversation it went to**: this one, or the one that took its place
        // when its history could never be reopened — adopted under its own id.
        const tookItsPlace = (handed: ResumedSession): string | null =>
          handed.sessionId === sessionId ? null : handed.sessionId
        // ⚑ The words went: the start is handed over as a reopen is. ⛔ They are not sent again.
        if ('sent' in answer) {
          const went = tookItsPlace(answer.sent)
          adoptHandover(went === null ? starting : slot(went), answer.sent, providerReadAt)
          if (went !== null && starting.meta === null) sessions.delete(sessionId)
          return {
            sent: true,
            openHere: this.isLive(went ?? sessionId),
            ...(went === null ? {} : { tookItsPlace: went }),
          }
        }
        const refusal = answer.notSent
        // ⚑ **A Cancel is not a refusal**: the person asked for it, and a red sentence under the box
        // would be the app arguing with them.
        const said = refusal.launch === 'cancelled' ? null : refusal.said
        // ⚑ **`735` F-1 — it runs here all the same, and is handed over**: adopted as a reopen, and the
        // host's sentence is said beside IT, where its composer gets the words back.
        if (refusal.running !== null) {
          const went = tookItsPlace(refusal.running)
          const running = went === null ? starting : slot(went)
          adoptHandover(running, refusal.running, providerReadAt)
          if (this.isLive(went ?? sessionId)) {
            running.error = said
            return {
              sent: false,
              refusal,
              openHere: true,
              ...(went === null ? {} : { tookItsPlace: went }),
            }
          }
        }
        // ⚑ Nothing it started runs here: no half-record is left for the list to show, and the one
        // on screen says why the words came back.
        if (starting.meta === null) sessions.delete(sessionId)
        else starting.error = said
        return { sent: false, refusal, openHere: false }
      } finally {
        starting.handover -= 1
        if (starting.handover === 0 && sessions.get(sessionId) === starting) settleHeld(starting)
      }
    },

    cancelLaunch: (sessionId) => cancelGesture(sessionId ?? NEW_LAUNCH),
    cancelPlaced: () => cancelGesture(PLACED_LAUNCH),

    /**
     * Take back every session the host is still running for this window (100).
     *
     * ⚠️ **No longer the only caller of {@link takeBackOpenSessions}** (172): an event for a session
     * this store has no record for now asks the same question, once. See {@link askAboutUnknown}.
     */
    attachOpen: takeBackOpenSessions,

    /**
     * 🔴 **Take over a conversation nobody owns** (336 §2.2) — the renderer half of the door.
     *
     * ⛔ **Not part of {@link takeBackOpenSessions}, and the host refuses to let it be.** That
     * reconciliation runs unasked on every store build; a claim is a gesture by id that somebody
     * makes on purpose, and the host answers a parameterless attach with only what this surface
     * ALREADY owns. So the two cannot be one call even if this store wanted them to be.
     *
     * ⚑ **Folded through {@link adoptHandover} like every other hand-over**, so a claimed
     * conversation gets exactly the corrections an attached one gets — which is none of the resume
     * ones for the life that is running, because that life never stopped. ⛔ **653 · and the resume
     * ones for the life BEFORE it, when there was one**: a conversation woken with no window has a
     * previous life on this page, and the host says where it ends (`ResumedSession.liveFrom`) so
     * {@link replayInto} corrects that life and not a line of this one. ⚠️ It also means the events
     * that beat this answer are already held in `earlyEvents` and are folded after the replay, with
     * the `ordinal < nextOrdinal` skip keeping the overlap from being folded twice. That seam is the
     * one `303` measured lossless.
     *
     * ⛔ **The refusal is not swallowed**, unlike `attachOpen`'s. Somebody pressed something here,
     * so the sentence the host wrote is the caller's to show.
     */
    async claim(sessionId: string): Promise<boolean> {
      // 🔴 **653 · the SAME bracket `resume` has (242 §3), which the claim never got.** Until the
      // answer lands, events for this conversation are HELD rather than folded — and that only
      // matters for a record this window already holds from an earlier life: its `meta` is set, so
      // without the count the listener folds the woken life's first events into the ended record
      // that `adoptHandover` is about to clear, and a card raised in that gap is never drawn. ⚑ A
      // conversation woken with no window and taken over by the window that watched it end is
      // exactly that record.
      // ⚠️ `holding`, not `record`: `resume`'s bracket is spelled with `record`, and a line-for-line
      // copy would make three of `242`'s anchors on it match twice.
      const holding = slot(sessionId)
      const providerReadAt = providerBlocks.beginRead()
      holding.handover += 1
      try {
        const handed = await bridge.claim({ sessionId })
        return adoptHandover(slot(handed.sessionId), handed, providerReadAt)
      } catch (error) {
        // ⚠️ As `resume` does for a hand-over that did not happen: a record this call made up for
        // a conversation it does not hold is not left behind to be asked about.
        if (holding.meta === null) sessions.delete(sessionId)
        throw error
      } finally {
        holding.handover -= 1
        if (holding.handover === 0 && sessions.get(sessionId) === holding) settleHeld(holding)
      }
    },

    /**
     * 🔴 **Give a conversation back** (523 §Q1) — the inverse of {@link claim} above.
     *
     * ⚑ **D-017b · the record stays, and is looked at again**: this window is no longer fed its
     * events, so it becomes `recorded` and the host describes it as one this window does not hold —
     * the view a person was reading stays where it is, and a press or a message takes it back. ⛔ Not
     * drawn as ended: `421`'s whole subject is that a live conversation must never be.
     *
     * ⚠️ **After the host agrees, never before.** A refused release leaves a conversation this window
     * really does still own, and dropping the record first would take the pane away from a person who
     * still has the conversation — the mirror of the close path's *"marking it ended here would hide
     * a live conversation behind an error message."*
     *
     * ⛔ **The refusal is not swallowed**, for {@link claim}'s reason: a press was made.
     */
    async release(sessionId) {
      const released = await bridge.release({ sessionId })
      // ⚑ **Keyed by the HOST's id**, like the claim one line up — the answer names the conversation
      // that moved, and trusting the id we sent would mark the wrong record if they ever differed.
      const record = sessions.get(released.sessionId)
      if (record !== undefined) {
        record.phase = 'recorded'
        void store.look(released.sessionId, 'again')
      }
      // ⚑ **And it may be asked about again** — {@link forget}'s reason: this window no longer holds
      // it, and the host may start it for this window later.
      askedAbout.delete(released.sessionId)
      return released
    },

    ...createPersonReads(bridge),
    ...createTurnControls(commands),
    ...createSessionReads(commands),
    ...createSessionControls(commands),
    dispose() {
      records.dispose()
      approvalChoices.clear()
      providerBlocks.dispose()
      unsubscribeEvents()
      unsubscribeLiveness()
      disposeCommands()
      sessions.clear()
    },
  }
  void records.read()
  return store
}
