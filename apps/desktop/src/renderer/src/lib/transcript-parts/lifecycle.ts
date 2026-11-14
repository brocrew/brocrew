import type { TranscriptItem } from '../transcript-message-contracts'
import type {
  PermissionOutcome,
  DetachedWork,
  PlanItem,
  PermissionItem,
  RoutedAway,
  UserInputItem,
} from '../transcript-tool-contracts'
import type { ScheduleRegistry, ChangeLog, TranscriptState } from '../transcript-state-contracts'
import type { TranscriptEvent } from '../../../../shared/conversation-events'
import type { BackgroundRow, ScheduledRow } from '../../../../shared/agent-state-contracts'
import type { BackgroundWork, RuntimeEvent, ScheduledJob } from '../../../../shared/runtime-ipc'
import { clockTime, clockTimeFrom } from '../../../../shared/clock'
import { scheduleLine } from '../scheduled-work'
import type { ActedBy } from '../../../../shared/who-did-it'
import { endMessageRun } from '../message-receipts'
import { itemById } from './items'
import { questionSent } from './messages'
import { everyToolRow, toolRowFor, everyCard } from './cards'

/**
 * The most change reports a window release will carry forward.
 *
 * ⛔ **The carry is what makes this a bound rather than an accident.** Before 299 a release dropped
 * the change log entirely, so the rows were bounded by the window and the badge was WRONG; carrying
 * them makes the badge right and makes the list grow for the life of the session instead. A report
 * is a few hundred bytes ({@link MAX_HELD_DIFF_REPORTS} has already taken the diff bodies off every
 * one older than twenty), so 400 is well under a megabyte and far above what any conversation
 * measured on this machine has produced — and the surplus is COUNTED, into {@link ChangeLog.dropped}.
 */
export const MAX_CARRIED_CHANGE_REPORTS = 400

/**
 * How many reports keep their diff bodies.
 *
 * ⚠️ **The 054 hazard, bounded from the other end.** 054 measured the transcript fold going
 * quadratic — 2,646 ms and ~1 GB at 1,600 turns — and 092 named this pane *"that hazard with file
 * contents attached."* A per-report ceiling alone does not bound a conversation: 171 turns × a
 * 256 KiB report is 43 MB of diff text nobody asked to see. So only the most recent reports keep
 * their bodies; older ones keep every row and lose the text.
 *
 * That costs almost nothing in practice, because rows fold by path and later wins: an older report's
 * bodies are usually already superseded. A row whose body has been released stops being expandable
 * and says why — it does not silently render an empty diff.
 */
export const MAX_HELD_DIFF_REPORTS = 20

export function createTranscript(): TranscriptState {
  return {
    workAncestry: {
      after: -1,
      agents: new Map(),
      tools: new Map(),
      dispatches: new Map(),
      missing: [],
      truncated: false,
    },
    humanAnswers: { latest: null, active: null },
    items: [],
    status: 'idle',
    ref: null,
    ended: false,
    seq: 0,
    streamingId: null,
    provisionalId: null,
    activity: null,
    thinkingId: null,
    planId: null,
    toolItems: {},
    subAgentHomes: {},
    subAgentCards: new Map(),
    cardTools: {},
    echoedAnswers: {},
    pending: { permissions: 0, questions: 0 },
    requestItems: new Map(),
    piecesGiven: new Map(),
    pieceGivers: new Map(),
    briefsAwaitingTheirTitle: new Map(),
    outgoingAhead: [],
    turnErrorRows: [],
    renewedLine: null,
    refusalsAwaitingReceipt: [],
    meter: { reading: { kind: 'unknown' }, source: null, at: null },
    changes: { reports: [], turn: 0, seq: 0, dropped: 0 },
    workflows: {},
    lastError: null,
    background: { running: [], dropped: 0 },
    // ⚠️ **An empty list here is NOT "nothing is scheduled", and no surface may read it as one.**
    // The level is stated at turn end, so a conversation that has never ended a turn has never been
    // TOLD — and a Codex conversation can never be told at all (`253` checked four layers: no
    // thread-scoped scheduled job in the protocol, no `ClientRequest` method, and a schedule
    // vocabulary that cannot express *"every 2 minutes"*). What keeps the two apart is that nothing
    // draws a sentence from emptiness: an absent bar is not a claim, which is `248`'s own line.
    schedule: { jobs: [], dropped: 0, left: [] },
    // ⛔ **`null`, and it is the one initial value in this function that is not an empty collection**
    // (279 §2). Every other registry starts empty because empty is what it means; this one starts
    // *"nobody has told us"*, which is a different fact from *"this agent has no commands"* and is
    // rendered differently. A `[]` here would make a session that has not started look like an agent
    // with nothing to offer — the exact thing §2 forbids.
    commands: { set: null, dropped: 0 },
    // ⛔ **`null` for the reason above and for one more** (358). This registry's `null` is the FIRST
    // of three states rather than of two — the second, *"this provider publishes no inventory"*,
    // lives inside the set as `published: null` and is a thing only an adapter may say. Starting
    // here at `{ set: { declared: null, published: null } }` would put that sentence on screen for
    // every session before any adapter had said it.
    tools: { set: null, dropped: 0, at: null },
    stopUnanswered: null,
    heldPastTheirTurn: new Set(),
  }
}

/**
 * Drop the diff text from every report but the most recent {@link MAX_HELD_DIFF_REPORTS} (096 §4).
 *
 * The rows survive in full — path, status, counts — because they are what the collapsed pane draws
 * and they cost a few hundred bytes each. Only the bodies go, and `released` records that they did,
 * so a row can say *"the diff for this file is no longer held"* instead of expanding onto nothing.
 */
export function releaseOldDiffBodies(log: ChangeLog): void {
  for (let index = 0; index < log.reports.length - MAX_HELD_DIFF_REPORTS; index += 1) {
    const report = log.reports[index]!
    if (report.released) continue
    report.changes = report.changes.map((change) => {
      const { diff, ...rest } = change
      void diff
      return rest
    })
    report.released = true
  }
}

/**
 * The session is open again — the transcript we just replayed ends with it closing, and that
 * ending describes the session we resumed FROM, not the one now running.
 *
 * Called by the resume flow rather than driven off a `session:'resumed'` event, because the fact
 * is ours to state: the host has just handed back a live handle. Waiting for the provider to
 * announce itself would leave the composer shut for as long as it stayed quiet — and shut forever
 * if it never said anything at all.
 */
export function markReopened(state: TranscriptState): void {
  state.humanAnswers.active = null
  state.ended = false
  state.status = 'idle'
  // ⚠️ **The cards belong to the session we resumed FROM** (085 review, and the same call
  // `markReadOnly` has always made for the same reason). A ledger that ends mid-turn — the app was
  // quit, or died, while a question was on screen — has no `turn` or `session:'ended'` event to
  // settle it, so the replay rebuilds that card with its buttons live. Pressing one reaches a NEW
  // adapter that has never heard of the id and refuses. Nothing in the transcript was wrong about
  // the past; what was wrong was offering to act on it.
  settlePending(state, 'settled when this conversation was last open')
  // A recording can end mid-stream; without this the next turn's deltas would be appended to
  // the assistant block that was open when the app quit.
  closeStreaming(state)
  state.provisionalId = null
  // Everything the LAST turn was in the middle of doing (027). A ledger that ends mid-turn — the
  // app was quit while a tool ran — has no `turn` event to close it, so the replay leaves the pill
  // saying "running Bash" and a thinking block pulsing, about a process that died with the last
  // session. Both are claims about NOW, and the only true one on reopen is that nothing is running.
  state.activity = null
  const thinking = itemById(state, state.thinkingId ?? undefined)
  if (thinking?.kind === 'thinking') thinking.streaming = false
  state.thinkingId = null
  // The replayed checklist stands as the last state that turn recorded — it is history now, and a
  // NEW turn's plan must open its own block rather than overwrite what we just replayed (028).
  state.planId = null
  stopRunningSubAgents(state) // whatever it was doing died with the last session (029)
  stopOpenToolCalls(state) // and so did whatever it had running (074)
  stopDetachedWork(state) // …and so did what it had deliberately left running (248)
  state.stopUnanswered = null // …and so did any ask to stop it (730, R83): a new life asks afresh
  // ⛔ **The schedule did NOT die with it** (258 §2): its jobs stand until the new process restates
  // the level — ⚠️ though a resume does not bring back every one ({@link ScheduleRegistry.jobs}).
}

/**
 * This transcript is a RECORDING and nothing in it can be acted on (047).
 *
 * The read-only view folds the same events through the same `applyEvent` as a live conversation, so
 * what comes out the other side is identical — including a permission card left unanswered because
 * the app quit mid-request, which renders with its Allow and Deny buttons intact. Those buttons
 * would emit into a view with nothing wired behind them: a control that looks live, does nothing
 * when pressed, and gives no reason. Offering an action that cannot work is worse than not offering
 * it, which is the same rule that keeps a Resume button off these rows.
 *
 * It settles them with a note instead — the same mechanism a session ending uses, so a card that
 * stopped being answerable says so, in a sentence, wherever it happened.
 *
 * `ended` is deliberately NOT set. A recording is not a conversation that ended; some of these
 * genuinely never did, and the composer that flag governs is not mounted here at all.
 */
export function markReadOnly(state: TranscriptState, reason: string): void {
  closeStreaming(state)
  // ⚑ This is a RECORDING, so there is no host holding anything and no listener behind the button;
  // that is the whole reason this function settles at all (622).
  settlePending(state, reason)
  // Whatever the last turn was in the middle of doing died with the session that was doing it. The
  // same claim `markReopened` corrects, for the same reason: a pulsing "running Bash" in a
  // transcript being READ is a statement about now, and it is false.
  state.activity = null
  const thinking = itemById(state, state.thinkingId ?? undefined)
  if (thinking?.kind === 'thinking') thinking.streaming = false
  state.thinkingId = null
  stopRunningSubAgents(state)
  stopOpenToolCalls(state)
  stopDetachedWork(state) // a recording's background work is as dead as everything else in it (248)
  // ⚠️ Its schedule is left as the recording ends: no start reaches a recording, and `ReadingPane`
  // draws `TranscriptView` alone — no bar, no word — so nothing on screen promises its jobs.
  // A checklist frozen mid-step is the same false claim wearing different clothes: `PlanEntry`
  // animates an `active` step, so a recording of a session that died on step 2 of 5 sits there
  // pulsing under a "Read-only" banner. The step did not finish, so it goes back to `pending` —
  // which is what it was, and is the only one of the three that is still true.
  for (const item of state.items) {
    if (item.kind !== 'plan') continue
    for (const step of item.steps) if (step.status === 'active') step.status = 'pending'
  }
  // Both nulled for the same reason `markReopened` nulls them: they point INTO items, and a state
  // that is handed one more event would use them to overwrite what was just replayed —
  // `dropProvisional` splicing out the last streamed block, a `plan_update` clobbering the
  // checklist. Nothing feeds this state today; the asymmetry with `markReopened` is the trap.
  state.provisionalId = null
  state.planId = null
}

/** Stop attributing deltas to the open assistant item (a turn ended, or a message replaced it). */
export function closeStreaming(state: TranscriptState): void {
  const open = itemById(state, state.streamingId ?? undefined)
  if (open?.kind === 'assistant') open.streaming = false
  state.streamingId = null
}

/**
 * Remove the unconfirmed streamed block, if any (068). Only ever called when an authoritative
 * message is about to render the same run of text, so nothing the user relies on is lost — the
 * alternative is showing that text twice.
 */
export function dropProvisional(state: TranscriptState): void {
  const id = state.provisionalId
  state.provisionalId = null
  if (!id) return
  const index = state.items.findIndex((item) => item.id === id)
  if (index >= 0) state.items.splice(index, 1)
}

/**
 * ⚑ **D-017b · what a card its stop settled says** — one sentence for every stop: whether it was a
 * close, a quit or a failure is a fact about a process, and the card's reader is told only that the
 * question is not waiting any more (`05` rule 5).
 */
export const NOTHING_WAITS_FOR_THIS_ANSWER = 'nothing waits for this answer any more'

/**
 * The session reached a terminal state. Both signals that can announce it are
 * handled — `session:'ended'` and the lifecycle `status` — because a session that
 * never got a validated provider ref has no honest ref to announce and is closed
 * with `status:'ended'` alone. Whichever arrives first wins; the other is a no-op.
 */
export function markTerminal(state: TranscriptState, reason: string): void {
  state.humanAnswers.active = null
  if (state.ended) return
  state.ended = true
  closeStreaming(state)
  // ⚑ The SESSION is over, so nothing holds a request past it.
  settlePending(state, reason)
  // A sub-agent cannot outlive the SESSION either (029, found by 037).
  //
  // Three of the four endings already said this — `turn`, `markReopened`, `markReadOnly` — and this
  // one did not, because in the ordinary case a turn ends before the session does and has already
  // swept them. The case that is not ordinary is a session closed or fatally errored MID-turn:
  // there is no `turn` event, so every card sat there claiming to be running, forever, about a
  // process that died with the session. The transcript could get away with that because a spinner
  // is easy to miss in a long thread; the panel cannot, because listing it is the whole feature.
  stopRunningSubAgents(state)
  // A tool call cannot outlive the session either — same boundary, same reason (074). A session
  // closed or fatally errored MID-CALL has no `tool_result` coming, because there is nothing left to
  // send one.
  stopOpenToolCalls(state)
  // ⛔ **And neither can work that was deliberately left running** (248). This is the boundary where
  // the two sweeps differ: a detached command survives its TURN by definition, and dies with the CLI
  // child that owns it — which is what this event says has happened.
  stopDetachedWork(state)
  // ⛔ **…but the SCHEDULE outlives this** (258 §2): the jobs stand, and this app starts the
  // conversation again in time for those its provider brings back (D-029) — see
  // {@link ScheduleRegistry.jobs}.
}

/**
 * ⛔ **Whether the HOST is still holding a request on the far side of this ending** (D-001, `738`
 * P-1).
 *
 * ⚑ It is asked as a fact about the ledger rather than as a flag, because every caller knows the
 * answer for certain and {@link settlePending}'s branch is the only place the consequence is
 * spelled out: an adapter safe-rejects its pending requests at a Stop and a teardown, but a
 * provider can keep one past an ordinary turn end — see {@link TranscriptState.heldPastTheirTurn}.
 */
type TheRequests = 'still-held' | 'released'

/**
 * The adapters safe-reject every still-pending request as part of teardown, so the
 * cards must stop offering buttons that would now fail — and say why, rather than
 * silently going quiet.
 *
 * ⚠️ **Except a request the provider keeps past its turn**, and {@link TheRequests} is the caller's
 * answer for it.
 */
export function settlePending(
  state: TranscriptState,
  reason: string,
  requests: TheRequests = 'released',
): void {
  // ⚑ **D-001 · the set names what the LAST ending spared**, so every settle starts it afresh.
  state.heldPastTheirTurn.clear()
  for (const item of state.items) {
    if (item.kind === 'permission' && item.outcome === null && item.note === null) {
      holdOrSettle(state, item, reason, requests)
    }
    if (item.kind === 'userInput' && item.answered === null && item.note === null) {
      holdOrSettle(state, item, reason, requests)
    }
  }
  // Everything that was waiting has just stopped waiting, so the counts are zero — but written as a
  // recount rather than as `= 0`, so this stays right if a future settle ever spares one.
  recountPending(state)
}

/**
 * 🔴 **D-001 · a request the host still holds is left live, and named** — see
 * {@link TranscriptState.heldPastTheirTurn}.
 */
function holdOrSettle(
  state: TranscriptState,
  item: PermissionItem | UserInputItem,
  reason: string,
  requests: TheRequests,
): void {
  if (requests === 'still-held') state.heldPastTheirTurn.add(item.request.id)
  else item.note = reason
}

/**
 * 🔴 **D-001 · what a card that outlived its turn says once nothing holds it any more.**
 *
 * ⚑ Reached when the status leaves `waiting_permission` with the card neither answered nor
 * withdrawn: a Stop declined it (both adapters' `interrupt()` settles every open card), or the
 * provider let go of the call. ⚠️ A person's answer can land a moment after that status; its
 * `user_decision` clears this note ({@link markPermissionAnswered}), so the answer still wins.
 */
export const HELD_REQUEST_LET_GO = 'settled when the agent stopped waiting for it'

/** 🔴 **D-001 · settle the cards a turn left live**, once the status says nothing holds them. */
export function letGoOfHeldRequests(state: TranscriptState): void {
  if (state.heldPastTheirTurn.size === 0) return
  for (const requestId of state.heldPastTheirTurn) {
    const item = itemById(state, state.requestItems.get(requestId))
    if (item?.kind === 'permission' && item.outcome === null && item.note === null) {
      item.note = HELD_REQUEST_LET_GO
    }
    if (item?.kind === 'userInput' && item.answered === null && item.note === null) {
      item.note = HELD_REQUEST_LET_GO
    }
  }
  state.heldPastTheirTurn.clear()
  recountPending(state)
}

/**
 * How a turn's ending is said to someone reading the card it killed (085).
 *
 * Three states, three words, and `completed` is deliberately not one of them: "settled when the
 * turn completed" reads as though completing were the thing that answered the question. It ended,
 * and the question ended with it. `interrupted` gets the passive because the alternative — "the
 * turn interrupted" — makes the turn the actor, and the reader is usually the one who stopped it.
 */
export const TURN_END_WORD = {
  completed: 'ended',
  failed: 'failed',
  interrupted: 'was interrupted',
} as const satisfies Record<'completed' | 'failed' | 'interrupted', string>

/**
 * 🔴 **725 · R71 — an ending THIS APP wrote, said as its own word** (`709` F-1, ruled by the PM):
 * *"a stop the app forces is recorded as the app's act (`wordOf: 'this-app'`), never as the
 * provider's."*
 *
 * ⚑ **What the mark means, from its docblock** (`events.ts`): the machine's own three endings —
 * `forceEnd` (a Claude Stop after its receipt, a Close the provider did not answer first), `failTurn`, and a fatal error's
 * terminal — and nothing a provider said. `forceEnd` ends the turn AHEAD of the provider and absorbs
 * its later word unread, so on such a row the provider's own ending is in no row at all.
 *
 * ⚑ **The receipt keeps its words and gains a clause** — *"turn interrupted — this app's word, not
 * the provider's"* — so the state is still read first and the two cannot be read as two events.
 * ⛔ **It names nobody who ASKED** (a Stop's ask is its own row above, `ASKED_TO_STOP`; a Close
 * writes none) and ⛔ **claims nothing about what the provider did.**
 *
 * ⛔ **An UNMARKED ending gains nothing, and is not said to be the provider's.** Rows written before
 * `720` carry no mark whoever wrote them, and nothing is backfilled (`HO-029` §2.2) — so *no mark*
 * is a provider's word only from `720` on, and the notice stays as it always read.
 */
export const THE_APPS_OWN_WORD = 'this app’s word, not the provider’s'

/**
 * Recount {@link TranscriptState.pending} from the requests this fold knows about (099).
 *
 * ⚠️ **A full recount, deliberately, and it is what makes the field safe.** The alternative is
 * `pending.permissions--` at each of the seven places an item can stop awaiting — the two request
 * arms, the three `mark*` helpers, `request_resolved` and `settlePending` — and a counter nudged in
 * seven places is one an eighth path silently breaks. Recomputing cannot drift: it reads the same
 * `isAwaitingAnswer` the panel does, over the same items, and gets the same answer by construction.
 *
 * It is O(requests × items) and that is fine, because it runs only when a request CHANGES STATE.
 * Across every conversation this app has recorded, that has happened 33 times. What it buys is that
 * READING the answer — which the rail does for every open conversation on every render — costs
 * nothing and touches no field that a streaming delta mutates.
 */
export function recountPending(state: TranscriptState): void {
  let permissions = 0
  let questions = 0
  // ⚑ **D-017 · R19 — and which of them went to another conversation**, in the same walk.
  let routedAway: RoutedAway | undefined
  for (const itemId of state.requestItems.values()) {
    const item = itemById(state, itemId)
    if (item === undefined || !isAwaitingAnswer(item)) continue
    if (item.kind === 'permission') permissions++
    else questions++
    if ((item.kind === 'permission' || item.kind === 'userInput') && item.routedTo !== undefined) {
      routedAway ??= { permissions: 0, questions: 0, to: item.routedTo }
      if (item.kind === 'permission') routedAway.permissions++
      else routedAway.questions++
    }
  }
  if (routedAway === undefined) delete state.routedAway
  else state.routedAway = routedAway
  state.pending = { permissions, questions }
}

/**
 * Record the decision this app sent for a permission card.
 *
 * ⚑ **503 · and who sent it.** `by` is assigned whether or not the row names anybody, which is
 * {@link whoCancelledIt}'s own rule one subject over: the field then says exactly what the ledger
 * says, and a card cannot inherit an actor from an earlier fold of the same request.
 */
export function markPermissionAnswered(
  state: TranscriptState,
  requestId: string,
  outcome: PermissionOutcome,
  by?: ActedBy,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'permission') {
    item.outcome = outcome
    item.note = null
    item.refused = null
    item.by = by
  }
  recountPending(state)
}

/** Record the answer this app sent for a user-input card. ⚑ **503 · and who sent it** — see
 *  {@link markPermissionAnswered}. */
export function markUserInputAnswered(
  state: TranscriptState,
  requestId: string,
  answered: 'answered' | 'rejected',
  by?: ActedBy,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'userInput') {
    item.answered = answered
    item.note = null
    item.refused = null
    item.by = by
  }
  recountPending(state)
}

/**
 * A response the host refused for a request that is GONE — already answered, unknown id, session
 * gone. The card stops being actionable.
 *
 * ⚠️ **It used to say *"or a fault nobody could classify"* and that clause is now unreachable**
 * (473, from `469` F2). An unclassified fault arrives at `noteAnswer` as `!ok` with no
 * {@link AnswerAck} at all, and this window cannot know from that whether the request was consumed
 * — so it goes to {@link markAnswerRefused} and the card stays live. ⛔ **Only a host that ANSWERED,
 * saying the request is gone, reaches this one.**
 */
export function markRequestFailed(
  state: TranscriptState,
  requestId: string,
  message: string,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'permission' || item?.kind === 'userInput') {
    item.note = message
    item.refused = null
  }
  // ⚑ **UI-009 · a question this conversation asked has no card of that kind** — its own card says
  // the host's words, and offers no answer again.
  const asked = questionSent(state, requestId)
  if (asked !== null) {
    asked.note = message
    delete asked.refused
  }
  recountPending(state)
}

/**
 * A response the host refused for a request that is **still pending** (146).
 *
 * The mirror of {@link markRequestFailed}, and deliberately the same shape so the two are read as
 * one decision with two outcomes rather than as a rule and an exception. See
 * {@link UserInputItem.refused}: this writes the sentence and changes nothing else, so the card
 * keeps its buttons, the panel keeps counting it and the composer stays frozen on a question that
 * really is still waiting.
 */
export function markAnswerRefused(
  state: TranscriptState,
  requestId: string,
  message: string,
): void {
  const item = itemById(state, state.requestItems.get(requestId))
  if (item?.kind === 'permission' || item?.kind === 'userInput') item.refused = message
  // ⚑ **UI-009 · and on a question this conversation asked**, which stays answerable.
  const asked = questionSent(state, requestId)
  if (asked !== null) asked.refused = message
  recountPending(state)
}

/* --- derived views of the fold (037) ------------------------------------------------------
 *
 * Everything below reads the state and decides nothing. They are exported so that a second
 * surface — the session panel — can be a PROJECTION of this fold rather than a parallel listener
 * on the same events. A second store would answer the same question twice and eventually give two
 * answers, which is worse than not answering it at all.
 */

/**
 * Whether this item is still waiting on the user, as opposed to settled by any of the four things
 * that can settle one: our own decision, the provider withdrawing it, teardown, or a refusal.
 *
 * Exported because two places need exactly this answer and must never disagree. The composer
 * freezes while something is unanswered and says so instead of accepting a message that answers
 * nothing; the panel lists precisely those items. Written twice, the two copies drift the first
 * time a fifth way to settle a card is added and only one of them learns about it.
 */
export function isAwaitingAnswer(item: TranscriptItem): boolean {
  if (item.kind === 'permission') return item.outcome === null && item.note === null
  if (item.kind === 'userInput') return item.answered === null && item.note === null
  return false
}

/**
 * What a list should key this item on — and for a CARD it is deliberately not `item.id` (064,
 * 061 finding 8).
 *
 * `item.id` is `${kind}_${seq}`, and `seq` restarts at zero in every fold. A re-fold therefore
 * renumbers everything; a list keyed on it sees rows it has never seen before, so it destroys the
 * components and builds new ones. For a message that is invisible. For a card it is what 061
 * measured: *"remounts existing interactive cards, discards typed answers, resets disclosure, and
 * can make an already-submitted permission decision clickable again."*
 *
 * A card has a name a re-fold cannot change — the provider's own request id, the same string the
 * decision goes back on. Everything else keeps its position, because for everything else position
 * IS the identity: an assistant block has no name of its own, and inventing one would be identity
 * theatre.
 *
 * Exported and living here rather than inside the component for the same reason
 * {@link isAwaitingAnswer} is: it is a rule about the fold, and a rule written inside a `.vue` file
 * is a rule that can only be tested by rendering one.
 */
export function itemKey(item: TranscriptItem): string {
  // The KIND is in the key as well as the id. Both adapters already refuse to reuse a request id
  // across the two kinds — Codex detects it as a collision, Claude routes one tool call to exactly
  // one broker — so this is hardening rather than a fix. It costs nothing and it means a provider
  // that ever did reuse one produces two distinct rows rather than two rows with the same key,
  // which is a rendered list quietly missing an entry.
  if (item.kind === 'permission' || item.kind === 'userInput') {
    return `request:${item.kind}:${item.request.id}`
  }
  return item.id
}

/**
 * ⛔ **Whether folding this event OPENS a turn** — the axis {@link ChangeLog.turn} counts (299 §2).
 *
 * ⚠️ **Stated once because a second consumer needed it, and pinned because saying it twice is how
 * two statements of one rule drift** (238). `carryForward` has to know how many turns the events it
 * is about to re-fold will open, so that a carried report's turn number means the same thing on
 * both sides of a window release — a base that was one out would put an old row inside *This turn*.
 *
 * ⚑ **`changes.test.ts` walks every event type in the schema and asserts this agrees with the fold
 * itself**, so the rule cannot be true here and different there.
 */
export function opensTurn(event: TranscriptEvent): boolean {
  return event.type === 'user_turn'
}

/**
 * Nothing is running any more (029). A sub-agent card left mid-flight — the turn ended, or the app
 * was quit and the ledger replayed — must stop saying "running" about a process that is gone
 * (⚠️ 695: at a TURN, `sparing` names the agents that are NOT gone — see the loop's own note). It is
 * NOT given an outcome: "we were never told how it went" is a different fact from "it succeeded",
 * and only the provider gets to state the second one.
 *
 * 📌 **This is belt-and-braces since 075, and worth knowing which brace is which.** The adapters now
 * emit the missing ending into the STREAM at the same boundary
 * (`packages/runtime/src/internal/open-sub-agents.ts`), so an ordinary replay arrives here with the
 * cards already closed and this sweep finds nothing to do. It stays because it answers a question
 * the stream cannot: a ledger written before 075, or by anything that is not one of our adapters,
 * still has cards with no ending in it — and this is what makes those read honestly.
 *
 * ⚠️ It is also why 072 §5.1 mis-stated the defect. This line meant the UI was always right, so the
 * lie lived only in the record; a grep of `packages/runtime` and `apps/desktop` that missed it
 * concluded the card *"stays open forever — in the UI"*, and it never did.
 */
export function stopRunningSubAgents(state: TranscriptState, sparing?: ReadonlySet<string>): void {
  // EVERY card, at every depth (035 review). This walked `cardsOf` — one level — which was the whole
  // truth until an agent's agent could nest inside a card's own tool entry. Adding a level without
  // widening this sweep left exactly the thing 029 wrote it to prevent: a grandchild still claiming
  // to be running, forever, about a process that ended with the turn.
  //
  // 🔴 **695 · …except an agent the provider still lists as running in the BACKGROUND**, which the
  // turn's own sweep passes as `sparing`. A backgrounded agent outlives its turn by definition, and
  // since `695` declared `perTaskStopAffordance` it outlives a Stop too — so marking its card ended
  // here drew *"finished"* over an agent the bar beside it still offers to stop. The session
  // boundaries pass nothing: the child's exit takes every task with it.
  for (const card of everyCard(state)) {
    if (sparing?.has(card.agentId) === true) continue
    card.running = false
  }
}

/**
 * The same claim, one component over: a tool row that never got its result (074, from 069 §2.3).
 *
 * `ToolEntry` reads `running` off the ABSENCE of a result, so a `Bash` the app was quit in the
 * middle of replays with its accent dot lit and the words "running…" beside it — about a process
 * that died with the session that started it. `markReopened` and `markReadOnly` already correct
 * exactly this claim for the activity pill, the thinking block, the plan's active step and every
 * sub-agent card, and their comments state the rule they were following: *"a pulsing 'running Bash'
 * in a transcript being READ is a statement about now, and it is false."* The tool row is the one
 * they name and the one they never swept.
 *
 * ⚠️ **It does not invent a result**, which is the whole reason this is a separate field rather than
 * a synthetic `{ ok: false }`. `stopRunningSubAgents` refuses the same shortcut for the same reason:
 * *"we were not told how it went"* is a different fact from "it failed", and only the provider gets
 * to state the second one. `unfinished` says the first and nothing more — and a real `tool_result`
 * arriving late still lands, because the fold writes `result` without ever consulting this flag.
 */
export function stopOpenToolCalls(state: TranscriptState, sparing?: ReadonlySet<string>): void {
  // The conversation's own rows AND every child's, at every depth — a sub-agent's `Bash` is exactly
  // as dead as its parent's.
  //
  // ⛔ **Detached work is deliberately NOT swept here, and that is 248's own near-miss.** This
  // function is not only the session-death sweep: `case 'turn'` calls it at the end of EVERY turn,
  // which is precisely the boundary background work is defined to outlive. Marking it here would
  // have emptied the registry and flipped every card to *"did not finish"* at the exact instant
  // `245`'s window opens — the defect this task exists to end, inverted. See
  // {@link stopDetachedWork}, which the three session boundaries call and the turn does not.
  for (const row of everyToolRow(state)) {
    if (!row.result) row.unfinished = true
  }
  // ⛔ **658 · a messaging row that landed ahead of its call does not outlive the run that wrote
  // it** — see {@link TranscriptState.outgoingAhead}.
  state.outgoingAhead = []
  endMessageRun(state)
  // ⚑ **685 · …and neither does a refusal waiting for its receipt** — see
  // {@link TranscriptState.refusalsAwaitingReceipt}.
  state.refusalsAwaitingReceipt = []
  // A workflow whose session died is exactly as dead (108, on 074's rule). Its own tool row is
  // already marked above, but the tree draws its head from the RUN — so without this a reopened
  // conversation shows a blue running dot and a live phase, indefinitely, about agents that stopped
  // when the app did. `outcome` is deliberately left absent: none arrived, and inventing one here is
  // the failure the flag exists to avoid.
  //
  // 🔴 **D-003 · `738` P-3 — …except a run the provider still lists as running in the BACKGROUND**,
  // which the turn's own sweep passes as `sparing` (`stopRunningSubAgents`' rule since `695`). A
  // workflow outlives the turn that launched it; marking it here drew *"did not finish"* with its
  // agents not live, while the bar beside it listed it running, until the next progress frame
  // revived it (0.5–10 s, `smoke:ui` 57). The session boundaries pass nothing.
  for (const run of Object.values(state.workflows)) {
    if (!run.running) continue
    if (sparing?.has(run.taskId) === true) continue
    run.running = false
    run.unfinished = true
  }
}

/**
 * **Work that was left running cannot outlive the CONVERSATION either** (248, on 074's rule).
 *
 * ⛔ **A separate sweep from {@link stopOpenToolCalls}, and the separation is the whole point.** That
 * one is called by `case 'turn'` as well as by the three session boundaries, because a tool call
 * cannot outlive its turn. Detached work is defined by outliving exactly that — `247` measured a
 * command running for 26 seconds past the turn that started it — so hanging this on the same
 * function marked every card *"did not finish"* and emptied the registry at the instant `245`'s
 * window opens. Five independent readers of this diff found it before it shipped; the regression is
 * pinned in `background-work.test.ts` (*"a turn ending changes nothing"*).
 *
 * ⚠️ **It does not invent an outcome.** `unfinished` says only that no ending will ever arrive,
 * which is what turns a false *"still running"* into a true *"did not finish"* — and it is the one
 * sweep whose subject HAS a result, so `stopOpenToolCalls`'s own loop skips it by construction.
 *
 * ⚑ **`247` made the level self-correcting for a REPLAY** (`system/init` emits `running: []`). A
 * conversation that is closed, read-only, or reopened from a ledger never reaches an `init`, and
 * this is that door.
 */
function stopDetachedWork(state: TranscriptState): void {
  for (const row of everyToolRow(state)) {
    if (row.background && row.background.outcome === undefined) row.background.unfinished = true
  }
  // The registry is a claim about NOW, and the only true one here is that nothing of ours is
  // running. `dropped` goes with it: it describes a level that no longer stands.
  state.background = { running: [], dropped: 0 }
}

/**
 * ⛔ **What a receipt says about detachment**, or `undefined` when it says nothing — which is the
 * ordinary case and the answer for every foreground call (248).
 *
 * ⚠️ **Read from `backgrounded` and from nothing else.** Two other readings were available and both
 * are traps `247` §3 named:
 *
 *  - **The receipt's wording.** *"Command running in background with ID: …"* is the provider's
 *    sentence; it has already changed shape across pins, and the sub-agent door says something
 *    different again (*"Async agent launched successfully"*). The flag beside it is derived from the
 *    level set, which is a fact.
 *  - ⛔ **The presence of `backgroundId`.** Codex attaches a `processId` to **every** PTY-backed
 *    command, foreground included. A card gated on having an id would put "still running" on
 *    finished commands and a stop button beside them — the false-settled card's mirror image, and on
 *    an adapter that implements no stop at all.
 */
export function detachment(
  event: Extract<RuntimeEvent, { type: 'tool_result' }>,
): DetachedWork | undefined {
  if (event.backgrounded !== true) return undefined
  // An empty object is the honest shape for "detached, and the provider named no stop key": the
  // presence of `background` is the flag, and `id` is what a stop control needs to exist.
  return event.backgroundId === undefined ? {} : { id: event.backgroundId }
}

/**
 * 🔴 **F081 · frames a provider sends as housekeeping, by the label the row was stored with** —
 * folded as the quiet lifecycle frame whatever category the row carries, so the rows recorded
 * before the normalizer gave them a quiet category (F035's `command_lifecycle`, before 2026-10-03
 * 15:28; Claude's `vcs_state_changed`, a checkout's commit or branch; its `ping` keepalive, stored as
 * an incomplete stream frame) draw nothing outside debug mode, as new ones do. ⚑ No row in the database changes.
 */
export const QUIET_BY_ITS_LABEL: ReadonlySet<string> = new Set([
  'command_lifecycle',
  'vcs_state_changed',
  // ⚑ Claude's `{"type":"ping"}` stream keepalive, once stored as a malformed frame (W1, F081).
  'ping (incomplete)',
])

/**
 * 🔴 **F035 — the line a turn the host names a scheduled job for draws**: *"Woken by its scheduled
 * job (14:45): check the deploy"*, with the day too when the turn began on another one. ⛔ The prompt
 * is the model's own and may come from a page it read, so it goes through the schedule bar's own
 * guard ({@link scheduleLine}): quoted when it holds a line break or a reordering character, and
 * clipped where the bar clips it.
 */
export function wokenWords(
  job: NonNullable<Extract<TranscriptEvent, { type: 'provider_turn' }>['oneShotCameDue']>,
  at: number | undefined,
): string {
  const due = at === undefined ? clockTime(job.dueAt) : clockTimeFrom(job.dueAt, at)
  const woken = due === '' ? 'Woken by its scheduled job' : `Woken by its scheduled job (${due})`
  const asks = scheduleLine({
    id: job.id,
    ...(job.prompt === undefined ? {} : { prompt: job.prompt }),
  }).asks
  if (asks === undefined) return woken
  return `${woken}: ${asks.text}${asks.cut > 0 ? '…' : ''}`
}

/**
 * ⚑ **D-017 · R11 — one scheduled job, with the moment this fold first saw it listed** — carried from
 * the level before while the id stays listed, or from the rows it took off (F035,
 * {@link ScheduleRegistry.left}), else the frame's own moment. ⛔ A copy, never the
 * event's own object: `carryForward` hands the registry to the next fold.
 *
 * ⚠️ **Not *when it was made*** — the level has no history in it (`253`) — but the level is stated at
 * the end of the turn that made the job, so it is the moment the provider first SAID the job exists,
 * and `shared/agent-state.ts`'s `nextWake` reads a one-shot's time from it. Absent only when the
 * frame carries no moment, and then no one-shot's time is promised.
 */
export function listedSinceOf(
  before: ScheduleRegistry,
  job: ScheduledJob,
  at: number | undefined,
): ScheduledRow {
  const listed = (one: ScheduledRow): boolean => one.id === job.id
  const since = (before.jobs.find(listed) ?? before.left.find(listed))?.listedSince ?? at
  return since === undefined ? { ...job } : { ...job, listedSince: since }
}

/**
 * 🔴 **One level row, with the command it is running** — see {@link BackgroundRegistry} (251 §2).
 *
 * ⚠️ **`toolRowFor` rather than `state.toolItems`, and a sub-agent's own `Bash` is why.** `248` §5
 * measured that a dispatched agent joins the level set, and nothing stops that child backgrounding a
 * command of its own — one level down, on a card row that is deliberately not in the top-level
 * index. A lookup that only knew the conversation would have shown the description for exactly the
 * rows hardest to identify from it.
 *
 * ⚠️ **The FIRST frame of a piece of work resolves nothing, and that is measured, not a race we
 * lost.** `background_tasks_changed` is emitted before `task_started`, and `task_started` is what
 * carries `tool_use_id` into the binding `snapshot()` reads — so the first level payload has no
 * `toolCallId` on its rows at all. `248` §5's own capture has the two frames in the same millisecond.
 * The row shows the provider's description for that one frame and the command from the next.
 *
 * ⛔ **The previous answer is the second source, and it is what survives a slab release.** After a
 * release the items are rebuilt from the retained suffix while the registry is CARRIED, so the call
 * that started long-running work can genuinely be gone from the fold while the work runs on. Without
 * this the next level frame would take the command back off a row that had not changed.
 */
export function withCommand(state: TranscriptState, row: BackgroundWork): BackgroundRow {
  const call = row.toolCallId === undefined ? undefined : toolRowFor(state, row.toolCallId)
  // ⚠️ `summary` is `z.string()` with no minimum, so an empty one is a shape the wire allows. It
  // falls through to the description rather than being carried as a command with nothing in it —
  // `backgroundWhat` would have to reject it a second time, and two places deciding one thing is how
  // they stop agreeing.
  const command =
    call !== undefined && call.summary !== ''
      ? { name: call.name, text: call.summary }
      : state.background.running.find((previous) => previous.id === row.id)?.command
  return command === undefined ? { ...row } : { ...row, command }
}

/**
 * # 🔴 **The LEVEL says this call's work is still going, so its card must stop saying it did not
 * finish** (287 §1, finding 1 — `280`'s fix-first).
 *
 * ## ⛔ The screen said both things at once, on every ordinary Codex command
 *
 * Codex's detachment stream is `tool_call` → `turn/completed` → `background_work.running`, and there
 * is **no `item/completed` and no `tool_result`, ever** — measured on the live wire by `275`, watched
 * for 30 seconds after the process had been killed. So the turn ends first, {@link stopOpenToolCalls}
 * finds a tool row with no result and marks it `unfinished`, and the level that arrives next updated
 * {@link TranscriptState.background} and nothing else. The bar then said **still running**, with a
 * working Stop; the card beside it said **did not finish**, whose sentence is *"the conversation
 * running it is gone, so nothing will ever report how it ended"*. Both about one live process.
 *
 * ⚠️ **Claude never took this path**, which is why nothing caught it: its `tool_result.backgrounded`
 * seeds `row.background` before the turn sweep can run, and every desktop test used that
 * Claude-shaped receipt.
 *
 * ## ⚑ What this states, and what it refuses to
 *
 * It writes the work's IDENTITY onto the card — the provider's own stop key — and clears the
 * *"we stopped watching"* flag that the level contradicts. It invents **no result and no outcome**:
 * `247`'s rule that `ok` was never wrong holds unchanged, and a card whose ending really has arrived
 * is left exactly as it is, because {@link DetachedWork.outcome} is a fact the provider stated and a
 * level is only ever a claim about now. That ordering is `backgroundState`'s own precedence, applied
 * one layer up so the two cannot disagree.
 *
 * ⚑ **Every card this seeds has a route to its own ending, and that is structural rather than
 * hopeful.** The row is only taken when it carries a `toolCallId`, and `endingsBetween` builds the
 * ending from that same field on that same row — so a card that can be marked running can always be
 * found again when the work leaves the level. The remaining door, for a conversation that closes
 * before either, is {@link stopDetachedWork}, unchanged.
 *
 * ## ⛔ Why this is not the `backgroundId` trap {@link detachment} refuses
 *
 * That rule — *"never from having a `backgroundId`"* — exists because Codex attaches a `processId` to
 * **every** PTY-backed command, foreground included, so a card gated on the id would put *"still
 * running"* on finished ones. ⚠️ **This is gated on the LEVEL, which is a different fact**: the level
 * is read at a turn boundary and nowhere else, so a row in it is by definition work that outlived its
 * turn. ⛔ **Which makes finding 2 the load-bearing half of this dispatch and not a separate ticket**
 * — a stale `turn/completed` that lists a foreground command would now poison that command's card as
 * well as the bar, so the two fixes ship together or neither does.
 */
export function markLevelRunning(state: TranscriptState, running: readonly BackgroundRow[]): void {
  for (const item of running) {
    if (item.toolCallId === undefined) continue
    const call = toolRowFor(state, item.toolCallId)
    // ⚠️ **A row with nowhere to land is the ordinary case, not a miss.** The call may be behind a
    // released slab (`carryForward` keeps the registry and not the items), or the level may name work
    // this conversation's fold has never seen. The bar still shows it; there is simply no card here.
    if (call === undefined || call.background?.outcome !== undefined) continue
    const detached: DetachedWork = { ...call.background, id: item.id }
    delete detached.unfinished
    call.background = detached
  }
}

/**
 * Set an optional field, or REMOVE it when the event no longer carries one (028). Plain assignment
 * would leave `note: undefined` on the item, which reads as present-but-empty to anything doing a
 * key check — and Codex's `explanation` really does go from absent to set within one plan, so the
 * reverse direction has to work too.
 */
export function setOptional<K extends 'note'>(
  item: PlanItem,
  key: K,
  value: string | undefined,
): void {
  if (value === undefined) delete item[key]
  else item[key] = value
}

/** The counter value an item was created with, read back out of its id. */
export function itemSeq(id: string): number {
  return Number(id.slice(id.lastIndexOf('_') + 1))
}
