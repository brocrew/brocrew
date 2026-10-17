import {
  HISTORY_WINDOW_MAX_EVENTS,
  type HistoryWindow,
  type PersistedEventInfo,
  type RuntimeEventMessage,
  type SessionRef,
  type SessionStatus,
  type TranscriptEvent,
} from '../../../shared/runtime-ipc'
import {
  applyEvent,
  createTranscript,
  everyCard,
  isAwaitingAnswer,
  markReopened,
  MAX_CARRIED_CHANGE_REPORTS,
  opensTurn,
  type ChangeLog,
  type SubAgentCard,
  type TranscriptState,
} from './transcript'

/**
 * Which slice of a conversation is in memory, and what moving that slice costs (054).
 *
 * ## The shape, and the one decision everything else follows from
 *
 * A conversation is a bounded, **contiguous** run of the ledger. It moves when the reader scrolls
 * back, and it is capped, so scrolling a long session end to end loads a bounded amount rather than
 * accumulating the whole thing — windowing that only ever grows is a leak with extra steps.
 *
 * When the window moves, the transcript is **re-folded from scratch** over the events now in it.
 * That is the decision. The obvious alternative — fold the older page separately and concatenate the
 * two item lists — is wrong in ways that do not announce themselves:
 *
 *  - `TranscriptState.seq` starts at zero in each fold, so both halves produce `assistant_1`,
 *    `tool_2`… Vue keys collide and `itemById` starts returning whichever it finds first.
 *  - `toolItems`, `requestItems`, `subAgentHomes` and `cardTools` map ids to ITEM ids. Merging two
 *    maps built over different item lists leaves entries pointing at items that are not there, and
 *    every lookup through them fails silently — a `tool_result` with nowhere to land, a decision
 *    that marks no card.
 *  - `status`, `ended`, `planId`, `thinkingId` are single values. One half says ended, the other
 *    says open, and the concatenation asserts both.
 *
 * Re-folding has none of those, because there is only ever ONE state and one `seq` space. 048 §3
 * ruled that this codebase keeps one exhaustive public fold; this uses that fold, unchanged, and is
 * windowing *around* it.
 *
 * The cost is real and is bounded by the window rather than by the session: `applyEvent` is
 * O(items) per event because `itemById` scans `state.items`, so a fold is quadratic in its own
 * length — measured at 21 ms for 100 turns, 172 ms for 400 and 2,646 ms for 1,600. A re-fold of a
 * page is tens of milliseconds and happens on a scroll gesture. A re-fold of a whole long session
 * would be seconds, which is the cost this window exists to stop paying in the first place.
 *
 * ## The live path is untouched while the window holds the newest event
 *
 * `atTail` is that condition. While it is true — which is every ordinary moment of a live session —
 * an arriving event is appended and folded incrementally, exactly as before 054. Nothing about
 * streaming, plan updates, sub-agent cards or permission cards changes.
 */

/**
 * The ceiling on events held in one window.
 *
 * Deliberately WIDER than the page the host sends ({@link HISTORY_WINDOW_MAX_EVENTS}), so a reader
 * who scrolls back one page does not immediately force a release: the window holds about two pages
 * and releases only when a third arrives. A cap equal to the page size would re-fold on every
 * gesture and drop the tail the moment anyone scrolled at all.
 */
export const WINDOW_MAX_EVENTS = HISTORY_WINDOW_MAX_EVENTS * 2

/**
 * How much is released at once when the cap is passed.
 *
 * Hysteresis, and it is load-bearing for the LIVE path. Releasing down to exactly the cap would
 * re-fold on every single event once a busy session reached it — a quadratic fold per delta, dozens
 * of times a second. Dropping a slab means one re-fold per slab.
 */
export const WINDOW_RELEASE_CHUNK = HISTORY_WINDOW_MAX_EVENTS / 2

export interface WindowState {
  /** The loaded slice of the ledger, in order. */
  entries: RuntimeEventMessage[]
  /** The ordinal `entries` begins at. What {@link earlierHistory} pages back from. */
  from: number
  /** Whether the ledger holds anything before {@link from}. */
  hasOlder: boolean
  /** Whether {@link from} is a turn boundary, or the event ceiling cut mid-turn. */
  turnAligned: boolean
  /**
   * Whether the window holds the newest recorded event.
   *
   * True is the ordinary state and the one the live path depends on. It goes false only when a
   * reader has paged back far enough that the cap released the newest events — at which point a
   * live event has nowhere in this window to land, and {@link liveDisposition} says so instead of
   * pretending otherwise.
   *
   * ⚠️ It is put back by {@link openAt} and by nothing else. That is deliberate — the only honest
   * way back to the tail is to re-read the newest page — but it also means a window that has left
   * the tail is STRANDED until something calls it. 054's review found exactly that: the transcript
   * froze for the life of the session, because the state existed and the escape did not.
   * `session-store.jumpToLatest` is that escape.
   *
   * ⛔ **And THIS field is what offers it** (313, friction log F3). This paragraph used to end
   * *"and {@link behind} is what tells the reader to take it"*, `TranscriptView` read that as
   * permission to gate the control on `behind`, and the two facts came apart: on an idle session
   * nothing arrives, `behind` is 0 for ever, and a window off the tail had no way back at all. One
   * backward gesture on a real 5,015-event conversation stranded eleven hours of it. **This is the
   * gate**, beside the reader's own scroll (UI-010).
   */
  atTail: boolean
  /**
   * How many live events arrived while the window was away from the tail.
   *
   * Counted, never dropped: the events are in the ledger regardless.
   *
   * ⛔ **Not whether the bar is there** (313) — {@link atTail} decides that — **and not what it says
   * either** (UI-010, F053). It counts EVENTS: every thinking and text delta, status and activity
   * event adds one, so the conversation's bar, which used to show it, read *"36 new messages"* and
   * climbed as an agent thought. ⚑ The bar says *Jump to latest*; this count is the event log's
   * (`EventStream`'s *"N newer events have arrived"*), which names it for what it is.
   */
  behind: number
}

export function createWindow(): WindowState {
  return { entries: [], from: 0, hasOlder: false, turnAligned: true, atTail: true, behind: 0 }
}

/**
 * A window over the events a READING window has just let go of (064).
 *
 * Its `atTail` is true, and that is not a contradiction: these are the newest events in the ledger,
 * so a live event does belong at the end of them. What is off the tail is the thing the reader is
 * looking at, and this exists precisely so that the two can be different — see `SessionRecord.tail`.
 *
 * It is bounded by the same {@link appendLive} the reading window uses, so an excursion into
 * history cannot make the control fold grow without limit while the reader is away.
 */
export function tailWindow(entries: RuntimeEventMessage[]): WindowState {
  return {
    entries,
    from: entries[0]?.ordinal ?? 0,
    // It was cut out of a longer window, so there is definitely something before it — and it was
    // cut at whatever event the cap fell on, which is not a turn boundary.
    hasOlder: true,
    turnAligned: false,
    atTail: true,
    behind: 0,
  }
}

/**
 * What a release is not allowed to forget (068 finding 4).
 *
 * ## The defect this exists for
 *
 * 064 gave the session two projections out of one fold, and 068 agreed that was the right structure.
 * What it faulted was what a release rebuilds *from*: both release paths re-folded only the events
 * the window still HELD, through a {@link foldWindow} that starts at `idle`, `ref:null`,
 * `ended:false` with an empty request index. So the moment a bounded window let go of a slab,
 * everything the released events had established was reset — 061 finding 5 again, through a
 * different door. 068, verbatim: *"After enough events in one turn, a pre-cutoff `working` status,
 * ref, plan, running sub-agent, or open request disappears. The composer can become idle or
 * unfrozen and call the wrong bridge operation."*
 *
 * ⚠️ **Worse than it reads**, because 063 made user-input cards reachable in launched-auto: a card
 * that leaves effective state because a reader scrolled is a card an *unattended* session is still
 * waiting on, and nothing would ever answer it.
 *
 * ## What is carried, and why exactly this much
 *
 * Two kinds of fact survive the events that established them:
 *
 *  - **Lifecycle** — `status`, `ref`, `ended`, `activity`. Single values, last-write-wins, and none
 *    of them names an item. Carried as state: the retained suffix simply overwrites whatever it
 *    restates, so carrying a value the suffix also carries costs nothing and changes nothing.
 *  - **Requests still awaiting an answer** — carried as their own EVENTS, replayed through
 *    {@link applyEvent} at the head of the fold. That is the difference that matters: a card is an
 *    item, and rebuilding it by re-folding the event that opened it means the one exhaustive fold
 *    builds it, in the new id space, with `requestItems` pointing at it correctly. There is no
 *    second event switch (048 §3), and the card's identity — `itemKey`, the provider's request id —
 *    is unchanged, so the draft, the disclosure and the already-sent guard 061 finding 8 protects
 *    all still find it.
 *
 *  - **The sub-agents this fold is holding** (137) — carried as their own EVENTS for exactly the
 *    reason requests are, and see {@link subAgentCarry} for the defect that put them here. An agent
 *    is not a pointer into the released items: `agentId` and the dispatching tool-use id are the
 *    PROVIDER's identifiers, and they mean the same thing in the next fold as in this one.
 *
 * ## What is deliberately NOT carried
 *
 * `seq`, `streamingId`, `provisionalId`, `thinkingId`, `planId`, `toolItems`, `subAgentHomes`,
 * `cardTools` and `echoedAnswers` all name items or rows that were just released. Carrying them
 * would be worse than dropping them: `seq` restarts at zero in a fresh fold, so a carried `tool_3`
 * would eventually point at a DIFFERENT item that the new fold happened to number the same, and
 * every lookup through it would silently hit the wrong row. Dropping them is the behaviour
 * `liveDisposition`'s own doc already describes as honest — an event that names a released item does
 * nothing, and the ledger still holds both, so scrolling back re-folds a range that contains them.
 *
 * ⚠️ **A carried card's BODY goes with them**, and that is the same line rather than an exception to
 * it: the rows in it were built out of the released events, and keeping them would make one card
 * grow without bound across every release for as long as its agent lived — a leak inside the
 * mechanism that exists to stop leaks. The card comes back as its heading, and the retained suffix
 * fills it again.
 *
 * The line is therefore: a fact about the SESSION is carried, a pointer into the released items is
 * not.
 */
export interface FoldCarry {
  status: SessionStatus
  ref: SessionRef | null
  ended: boolean
  activity: TranscriptState['activity']
  /**
   * The opening event of every card still waiting on the user, with the time it happened.
   *
   * Empty whenever `ended` is true, by construction rather than by a guard here: `markTerminal`
   * settles every pending card with a note, and a settled card is not awaiting an answer.
   */
  requests: {
    event: TranscriptEvent
    at?: number
    /**
     * ⚑ **D-017 · R19 — where this app routed the card**, as the `request_routed` row said it: the
     * mark *Waiting on you* and the one state read (`PermissionItem.routed`, `routedTo`) lives on
     * the item, and the released run held the row that set it. ⚠️ Absent where nothing routed it.
     */
    routed?: TranscriptEvent
  }[]
  /**
   * How full the context window is (087) — carried for the same reason `activity` is.
   *
   * ⚠️ **Review finding 4.** A reading is not an item: the meter absorbs the usage stream so it
   * never becomes transcript rows, which means the events that would restate it are exactly the
   * ones a slab release throws away. Without this the gauge fell back to `{kind:'unknown'}` every
   * time a long conversation rolled its window — the ONE case where a context meter is worth
   * having — and stayed blank until the provider next spoke. "No reading yet" is an honest thing to
   * say about a fresh session and a lie about a session that has been running for an hour.
   */
  meter: TranscriptState['meter']
  /**
   * ⛔ **What is still running in the background (248)** — carried for exactly the reason
   * {@link meter} is.
   *
   * The level is not an item: `background_work` absorbs the registry stream so it never becomes
   * transcript rows, which means the events that would restate it are precisely the ones a slab
   * release throws away. Without this a long conversation that rolls its window would forget a
   * command still running — in the one case where knowing is worth most, because a conversation long
   * enough to roll is one you have stopped watching.
   *
   * ⚠️ **It cannot break the rule a carry has to keep** (*"a carry may not change what a fold of the
   * same events would produce"*): every level frame REPLACES the set outright, so a suffix that
   * states the level wins over this by construction, and a suffix that does not state it would have
   * produced an empty registry that is false rather than merely silent.
   *
   * ⛔ **One exception since 251, and it is stated rather than left to be discovered.** A carried row
   * brings the COMMAND `withCommand` resolved for it, and a suffix that restates the level keeps that
   * command when the `tool_call` it came from is no longer in the retained events. So a fold seeded
   * with this carry really can produce a registry a cold fold of the same suffix would not — the row
   * is identical except that it is NAMED. That is the whole point (`carryForward` keeps the registry
   * and not the items, so long-running work outlives its own call), and it is the safe direction: the
   * membership, the ids and the `dropped` count are untouched, and the difference is a label this app
   * genuinely saw rather than one it invented.
   */
  background: TranscriptState['background']
  /**
   * ⛔ **What this conversation has promised to do LATER (258)** — carried for the reason
   * {@link background} is, and with a longer reach than either neighbour.
   *
   * ⚠️ **The level is stated at TURN END and nowhere else.** `background_work` is republished
   * whenever the running set changes and again at every `system/init`; a schedule is republished
   * once per turn, so the events a slab release throws away can be the only ones that ever stated
   * it — and the next restatement is a whole turn away rather than a frame away. A conversation long
   * enough to roll its window is one you have stopped watching, which is exactly when *"something
   * will wake this at 2 a.m."* is worth most.
   *
   * ⚑ **It keeps the rule a carry has to keep.** Every frame that states the level REPLACES it, so a
   * suffix that states it wins over this by construction; a suffix that does not state it would have
   * produced an empty registry that is false rather than merely silent. ⚠️ And unlike
   * {@link background}, there is no exception: no field of a job is resolved against the items, so a
   * carried row is byte-for-byte the row the provider sent.
   */
  schedule: TranscriptState['schedule']
  /**
   * ⛔ **What the running agent will answer to (279)** — carried for the reason its two neighbours
   * are, and with a reach longer than either.
   *
   * ⚠️ **This level is stated ONCE.** `background_work` is republished whenever the running set
   * changes and again at every `system/init`; a schedule is republished once per turn. The command
   * list is published at session start and then only if the provider changes its mind — so for a
   * conversation long enough to roll its window, the events a release throws away are very often the
   * ONLY ones that ever stated it, and there is no next restatement to wait for. Without this carry
   * the palette's band would vanish from exactly the long conversations a person is most likely to
   * be hunting through it.
   *
   * ⚑ **It keeps the rule a carry has to keep** (*"a carry may not change what a fold of the same
   * events would produce"*): a frame that states the level REPLACES it, so a suffix that states it
   * wins by construction, and a suffix that does not state it would have produced `set: null` —
   * *"nobody has told us"* — which is false rather than merely silent about a session that was told.
   * ⚠️ And as with {@link schedule} there is no exception: nothing in a row is resolved against the
   * items, so a carried list is byte-for-byte the list the provider sent.
   */
  commands: TranscriptState['commands']
  /**
   * 🔴 **What tools this conversation has (358)** — carried for exactly the reason
   * {@link background} is, and with one hazard of its own.
   *
   * The inventory is not an item: `tool_inventory` absorbs into a registry and never becomes a
   * transcript row, so the events that would restate it are precisely the ones a slab release
   * throws away. ⛔ **And on Claude it is restated only when the ANSWER MOVES**, at a `system/init`
   * whose payload differs from the last — so a conversation that opened, published once and did not
   * change its inventory since will never restate it. Without this line one long enough to roll its
   * window would fall back to *"BroBot has not been told what this conversation has"* about a
   * conversation it launched a whole toolset into, and stay there for the rest of the session.
   *
   * ⚠️ **`FoldCarry` is hand-written**, so nothing in the typechecker would have said this field
   * was missing. It is here because a registry was traced, not because a gate found it.
   */
  tools: TranscriptState['tools']
  /**
   * ⛔ **What the agent has done to the working TREE** (299 §2, from 297 finding 5) — carried for
   * the reason {@link meter}, {@link background}, {@link schedule} and {@link commands} are, and it
   * was the one member of that family a release silently zeroed.
   *
   * `transcript.ts` says of the change log, verbatim: *"Not items, and for the same reason the
   * context meter is not one (087)."* So the events that would restate it are precisely the ones a
   * slab release throws away — and without this a conversation that rolled its window came back
   * with `{reports: [], turn: 0}`, which is **two false statements on one gesture**: the drawer's
   * file count VANISHES from the tab strip mid-conversation (`tabCount` returns null for zero
   * rows), and the pane draws what `changes-tab.dom.test.ts` pins as *"nothing changed — a faceless
   * dashed ring, and NOT a zero"* about a conversation that demonstrably modified a file.
   *
   * ⛔ **It directly contradicted the other bound on the same state.** `MAX_HELD_DIFF_REPORTS`
   * releases diff BODIES only, *"because [the rows] are what the collapsed pane draws"*, and marks
   * `released` so a row can say the diff is no longer held. The window release dropped the rows
   * themselves, with no marker and no sentence.
   *
   * ⚠️ **The reports carried are the ones the retained events will NOT rebuild, decided by ordinal.**
   * That distinction is the whole difficulty, and it is why this member arrives with
   * `ChangeReport.ordinal` rather than on its own: the state a carry is computed from covers a
   * SUPERSET of what is about to be re-folded — in `prependOlder` it is a strict subset of the
   * retained run, so *every* report would be rebuilt — and carrying by length or by count would
   * double them. See {@link carryChanges}.
   */
  changes: TranscriptState['changes']
  /**
   * One `sub_agent` event per card this fold is holding that the retained events cannot restate.
   *
   * Replayed at the head of the next fold, exactly as {@link requests} are, so the ONE public fold
   * builds the card in the new id space with `subAgentHomes` pointing at it correctly.
   */
  subAgents: TranscriptEvent[]
  /**
   * 🔴 **730 · R83 — an ask to stop the provider has not answered**, for `activity`'s reason: it is
   * state and not an item, and the row that set it can be in the released prefix while its turn
   * still runs — the Stop control would forget that a press joins it.
   */
  stopUnanswered: TranscriptState['stopUnanswered']
  /**
   * 🔴 **D-001 · the carried cards a turn left live because the host still holds them** — see
   * {@link TranscriptState.heldPastTheirTurn}. ⚠️ Replaying a card's opening event rebuilds the
   * card and not this fact, so without it a released `turn` row would leave the card live and no
   * later status able to settle it.
   */
  heldPastTheirTurn: string[]
}

/**
 * The cards a release must not take with it, as the events that would rebuild them (137).
 *
 * ## The defect, which 136 measured and no test in this file could see
 *
 * A child's words are routed onto its card by the DISPATCHING tool-use id, and when no card carries
 * that id the message is kept as a loose top-level row that remembers whose it is — 131's fallback,
 * so a card arriving late can take it back. ⛔ **That fallback is not stable across a window
 * release.** The card's birth is an event like any other, so a turn long enough to overflow the
 * window can drop it while the child's prose is still in the retained suffix. The fresh fold then
 * finds no card, takes the fallback, and draws the child's answer as top-level assistant prose —
 * the child speaking in the parent's voice, which is the whole thing 127 and 128 exist to prevent.
 * Deterministic, and reachable twice over: the live cap at 5,000 events releasing 1,250, and a
 * 2,500-event history page cut between the birth and the words.
 *
 * ⚑ **135's `origin` does not repair it.** That field says a card was never announced; this is a
 * card that WAS announced, to a fold that no longer exists.
 *
 * ## Which cards, and why the set is bounded
 *
 * Two kinds, and neither is "all of them":
 *
 *  - **Still running.** The session has these agents right now, and a running agent that vanished
 *    from the transcript because a slab was released would reappear, finished, when its ending
 *    landed. Bounded by concurrent dispatches, and `endsOpenSubAgents` closes every one of them at
 *    the end of the turn — ⚠️ except, since 695, an agent the provider still lists as running in
 *    the BACKGROUND, which its own ending or the session's close ends instead.
 *  - **Named by the retained suffix** — an event that carries this agent's id, or the dispatching
 *    call any of its rows would be routed by. These are precisely the cards whose absence produces
 *    the defect above, and the set is bounded by the suffix rather than by the session's history.
 *
 * ⛔ **A card whose BIRTH is still in the suffix is not carried, and {@link FoldCarry.requests}'
 * `restated` filter is the same idea for the same reason.** The first version of this carried them
 * anyway — merging is safe where duplicating an item is not — and review measured what that cost:
 * `placeCard` puts the carried card at the head of `items`, the suffix's own `started` then MERGES
 * instead of placing, and the card is stuck above messages that came before it. Three reproductions,
 * including the live release this exists for. The rule the mistake violated is the one that makes a
 * re-fold safe at all: **a carry may not change what a fold of the same events would produce.** A
 * suffix that still announces the agent produces the card by itself, in the right place, so the
 * carry stays out of its way. A `progress` frame is NOT a birth and does not exempt it — that frame
 * carries neither the dispatch id nor the title, and a card rebuilt from one has lost its name.
 */
function subAgentCarry(
  state: TranscriptState,
  retained: readonly RuntimeEventMessage[],
): TranscriptEvent[] {
  const agents = new Set<string>()
  const calls = new Set<string>()
  const born = new Set<string>()
  for (const { event } of retained) {
    if (event.type === 'sub_agent') {
      agents.add(event.agentId)
      if (event.phase === 'started') born.add(event.agentId)
    }
    if (
      (event.type === 'sub_agent' ||
        event.type === 'assistant_message' ||
        event.type === 'tool_call' ||
        event.type === 'tool_result') &&
      event.parentToolCallId !== undefined
    ) {
      calls.add(event.parentToolCallId)
    }
  }
  const wanted = (card: SubAgentCard): boolean =>
    !born.has(card.agentId) &&
    (card.running ||
      agents.has(card.agentId) ||
      (card.parentToolCallId !== undefined && calls.has(card.parentToolCallId)))
  return everyCard(state).filter(wanted).map(asSubAgentEvent)
}

/**
 * A card, said back as the event that would build it.
 *
 * `phase` is `progress` for a card still running rather than `started`: this is a RESTATEMENT of an
 * agent already announced, not a second birth, and `progress` is the phase the provider itself uses
 * to say the same thing. Every other field is copied only when the card has it, because absent means
 * "not reported" everywhere else in this fold and a carry is not the place to start meaning
 * something else by it.
 *
 * ⚠️ **No body.** See {@link FoldCarry} — the rows were built from the released events, and the card
 * is rebuilt as a heading the retained suffix fills.
 *
 * ⛔ **And no SUMMARY, which is the one field that is not inert.** Everything else here is merged
 * and forgotten; `summary` is a TRIGGER — `foldEvent` runs `dropEchoedProse` the moment it is set,
 * and every later owned message is measured against it. Restating it at the head of a fold moves the
 * card's ending EARLIER than it happened, so prose the child spoke before its ending is read as an
 * echo of it and spliced out. Review measured that on this file's own fixtures: a card that folded
 * to `[says:S, Bash]` in one window folded to `[Bash]` across a release, which is 136 §3 sequence
 * two — *"the displayed sentence is effectively moved from before the work"* — reintroduced by the
 * carry. The answer was built out of a released event exactly as the body was, and it goes with it;
 * a suffix that still carries the ending restates it for itself.
 *
 * ⚑ **This is also what keeps {@link TranscriptState.echoedAnswers} honestly uncarried**: with no
 * summary on the rebuilt card there is no removal for the fresh fold to make twice.
 */
function asSubAgentEvent(card: SubAgentCard): TranscriptEvent {
  return {
    type: 'sub_agent',
    agentId: card.agentId,
    phase: card.running ? 'progress' : 'ended',
    ...(card.idKind !== undefined ? { idKind: card.idKind } : {}),
    ...(card.parentToolCallId !== undefined ? { parentToolCallId: card.parentToolCallId } : {}),
    ...(card.origin !== undefined ? { origin: card.origin } : {}),
    ...(card.kind !== undefined ? { kind: card.kind } : {}),
    ...(card.title !== undefined ? { title: card.title } : {}),
    ...(card.lastTool !== undefined ? { lastTool: card.lastTool } : {}),
    ...(card.usage !== undefined ? { usage: { ...card.usage } } : {}),
    ...(card.outcome !== undefined ? { outcome: card.outcome } : {}),
  }
}

/**
 * Take from `state` the facts the events in `retained` can no longer say (068 finding 4).
 *
 * `retained` is not just informational. A release leaves the outgoing state covering a SUPERSET of
 * what is being re-folded — in the live path `appendLive` has already pushed the arriving event into
 * the window — so a request that is still in the retained run would be carried AND re-folded, giving
 * two items with one `itemKey` and a rendered list quietly missing a row. Anything the suffix
 * restates for itself is therefore left to the suffix.
 */
export function carryForward(
  state: TranscriptState,
  retained: readonly RuntimeEventMessage[],
): FoldCarry {
  const restated = new Set<string>()
  for (const { event } of retained) {
    if (event.type === 'permission_request' || event.type === 'user_input_request') {
      restated.add(event.id)
    }
  }
  const requests: FoldCarry['requests'] = []
  for (const item of state.items) {
    if (item.kind !== 'permission' && item.kind !== 'userInput') continue
    if (!isAwaitingAnswer(item)) continue
    if (restated.has(item.request.id)) continue
    requests.push({
      event: item.request,
      ...(item.at !== undefined ? { at: item.at } : {}),
      // ⚑ **D-017 · R19** — the routing, as the row it came from, so the card comes back routed.
      // ⚠️ `the-parent` stands for both conversation arms: the fold reads only whether it went to a
      // person, and which conversation owes it.
      ...(item.routed === true
        ? {
            routed: {
              type: 'request_routed' as const,
              requestId: item.request.id,
              ...(item.routedTo === undefined
                ? { to: 'a-person' as const }
                : { to: 'the-parent' as const, parent: item.routedTo }),
            },
          }
        : {}),
    })
  }
  return {
    status: state.status,
    ref: state.ref,
    ended: state.ended,
    // Copied, not aliased: `activity` is replaced wholesale by the fold, but the outgoing state is
    // still reachable for the length of this call and a shared object is a way for two folds to
    // disagree later for no reason.
    activity: state.activity === null ? null : { ...state.activity },
    // Copied for the reason `activity` is copied one line up: the outgoing state stays reachable
    // for the length of this call, and a shared object is a way for two folds to disagree later.
    meter: { ...state.meter, reading: { ...state.meter.reading } },
    // Copied one level deeper for the reason the two above are copied, and the rows with it: the
    // registry is REPLACED wholesale by the next level frame, so a shared array is a way for two
    // folds to disagree later for no reason.
    background: { running: [...state.background.running], dropped: state.background.dropped },
    // Copied one level deep for the reason the three above are copied: the outgoing state stays
    // reachable for the length of this call, and a shared array is a way for two folds to disagree
    // later for no reason. The JOBS themselves are the provider's own frozen rows and are shared.
    schedule: {
      jobs: [...state.schedule.jobs],
      dropped: state.schedule.dropped,
      left: [...state.schedule.left],
    },
    // Copied one level deep for the reason the four above are copied. ⚠️ The SET is copied too, and
    // not only the wrapper: it holds the array the band draws, and a shared array is a way for two
    // folds to disagree later for no reason. `null` stays `null` — *"nobody has told us"* is not a
    // thing to copy, and manufacturing an empty set here would be the very lie the registry's own
    // doc forbids.
    commands: {
      set:
        state.commands.set === null
          ? null
          : { commands: [...state.commands.set.commands], prefix: state.commands.set.prefix },
      dropped: state.commands.dropped,
    },
    // Copied one level deep for the reason the five above are copied, and one level deeper again
    // inside the set — it holds the arrays the sheet draws. ⛔ **`null` stays `null` at BOTH levels**:
    // the outer one is *"nobody has told us"* and the inner one is *"this provider publishes no
    // inventory"*, and manufacturing an empty object for either would be the lie the registry's own
    // doc forbids, told about two different things.
    tools: {
      set:
        state.tools.set === null
          ? null
          : {
              naming: { ...state.tools.set.naming },
              declared:
                state.tools.set.declared === null
                  ? null
                  : {
                      server: state.tools.set.declared.server,
                      ...(state.tools.set.declared.instructions === undefined
                        ? {}
                        : { instructions: state.tools.set.declared.instructions }),
                      tools: state.tools.set.declared.tools.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters.map((parameter) => ({ ...parameter })),
                      })),
                    },
              published:
                state.tools.set.published === null
                  ? null
                  : {
                      tools: [...state.tools.set.published.tools],
                      servers: state.tools.set.published.servers.map((server) => ({ ...server })),
                    },
            },
      dropped: state.tools.dropped,
      // ⛔ **The moment travels with the set** (444 relay 1). ⚑ **This line is a compile error
      // when it is missing, and only because `ToolRegistry.at` was made REQUIRED for that
      // reason** — the docblock above says nothing in the typechecker would have caught a missing
      // field on this hand-built object, and an OPTIONAL moment would have proved it right by
      // dying here at the first window release with nothing red. ⚠️ The conversations long enough
      // to release a window are exactly the ones whose inventory is oldest.
      at: state.tools.at,
    },
    requests,
    changes: carryChanges(state.changes, retained),
    subAgents: subAgentCarry(state, retained),
    stopUnanswered: state.stopUnanswered,
    heldPastTheirTurn: [...state.heldPastTheirTurn],
  }
}

/**
 * The change log a fold of `retained` cannot rebuild (299 §2, from 297 finding 5).
 *
 * ## ⛔ Why this is not `{...log}`
 *
 * `carryForward`'s own header states the hazard for requests: *"a release leaves the outgoing state
 * covering a SUPERSET of what is being re-folded… anything the suffix restates for itself is left
 * to the suffix."* For the change log that is not a corner case, it is the ordinary one. In
 * `prependOlder` the retained run is the older page PLUS the whole window the carry was folded
 * from, so **every** report in it would be produced again — copying the log wholesale would double
 * every row on every page back.
 *
 * ⚑ **The ordinal is what makes the question answerable.** A report knows which ledger event built
 * it; `retained[0].ordinal` is where the re-fold begins; everything older is a report no event in
 * the suffix will produce. A report with no ordinal is left behind — that is what happened to every
 * report before this dispatch, so an unstamped fold keeps the behaviour it already had rather than
 * being given a guess.
 *
 * ## ⚠️ And the TURN base, which is not the same question
 *
 * `log.turn` counts user messages, and the re-fold counts the suffix's own again — so carrying the
 * total would count every retained turn twice and put old rows inside *This turn*. What is carried
 * is the turns opened BEFORE the suffix: the total, less the ones the suffix will re-open. See
 * {@link opensTurn}, which is the one statement of that rule.
 */
function carryChanges(log: ChangeLog, retained: readonly RuntimeEventMessage[]): ChangeLog {
  const from = retained[0]?.ordinal
  const older =
    from === undefined
      ? log.reports.filter((report) => report.ordinal !== undefined)
      : log.reports.filter((report) => report.ordinal !== undefined && report.ordinal < from)
  // Newest first out of the cap: what a reader is asked about is what just happened, and the oldest
  // reports are also the ones whose bodies were released longest ago. Counted, never silent.
  const kept = older.slice(-MAX_CARRIED_CHANGE_REPORTS)
  let reopened = 0
  for (const { event } of retained) if (opensTurn(event)) reopened += 1
  return {
    // Copied one level deep for the reason `background`, `schedule` and `commands` are copied above:
    // the outgoing state stays reachable for the length of this call, and a shared array is a way
    // for two folds to disagree later. The REPORTS themselves are shared — they are frozen records
    // of an observation, and `releaseOldDiffBodies` only ever removes text from them.
    reports: [...kept],
    turn: Math.max(0, log.turn - reopened),
    // ⚠️ **Carried, and it must be.** Ids are `changes_<seq>` and a fresh fold restarts the counter
    // at zero, so a carried `changes_3` and a newly built `changes_3` would be two different reports
    // with one id — and `ChangeRow.bodyReportId` points at reports by exactly that string.
    seq: log.seq,
    dropped: log.dropped + (older.length - kept.length),
  }
}

/**
 * Fold a window's events into a fresh transcript, through the one public fold.
 *
 * ## `liveFrom` — the resume epoch, applied INSIDE the fold (064, 061 finding 5)
 *
 * A reopened session's ledger ends with the session it was resumed FROM closing. Fold those events
 * and the state comes out `ended`, because `markTerminal` is sticky and nothing in a raw replay
 * un-sticks it. `session-store.resume` corrected that once, on the transcript it had just built, by
 * calling {@link markReopened} — and every re-fold after that quietly threw the correction away.
 * Paging back, releasing a slab or jumping to the tail on a running conversation put "Ended" in the
 * header and shut the composer. That is 061's *"the first prepend, release, or jump can resurrect
 * the old terminal event and label a genuinely live session 'Ended'"*, exactly.
 *
 * So the epoch is not an overlay applied afterwards — it is a point in the fold. `liveFrom` is the
 * ordinal the session's CURRENT life begins at, and {@link markReopened} is applied when the fold
 * crosses it: after everything that describes the previous life, before anything that describes
 * this one. Applying it at the END instead would erase a genuine ending that happened AFTER the
 * resume, which is a live session mislabelled the other way round.
 *
 * A window that stops short of the epoch is entirely history, so the crossing happens at the end —
 * which is precisely what `resume` used to do by hand, now with one caller instead of every caller.
 * `null` means this session was never reopened and there is no previous life to leave behind.
 *
 * ## `toolsInForce` — the inventory where the window begins (D-035)
 *
 * The host's `tool_inventory` row in force at the first entry ({@link HistoryWindow.toolsInForce}),
 * folded ahead of the entries, so a give, a reply, a question or a request taken on is drawn as a
 * card on a page that begins after the provider stated its tools. ⚑ **After the carry**: where the
 * ledger has such a row it is the ledger's own answer for the first entry, where a carry's registry
 * is the outgoing fold's newest, and the window's own rows bring it up to that by its end. ⚠️ Where
 * it has none, a carry's registry stands at the head as it did before. ⛔ Passed only by a caller
 * that has just set the window's start from a page — a release moves the start with no page to say
 * what was in force there, and its carry stands.
 */
export function foldWindow(
  entries: readonly RuntimeEventMessage[],
  liveFrom: number | null = null,
  carry: FoldCarry | null = null,
  toolsInForce: PersistedEventInfo | null = null,
): TranscriptState {
  const state = createTranscript()
  // Nulled once spent, so the crossing happens exactly once however many events are on either
  // side of it — and `null` from the start is a session that was never reopened.
  let epoch = liveFrom
  if (carry !== null) {
    state.status = carry.status
    state.ref = carry.ref
    state.ended = carry.ended
    state.activity = carry.activity
    state.meter = carry.meter
    state.background = carry.background
    state.schedule = carry.schedule
    state.commands = carry.commands
    state.tools = carry.tools
    state.changes = carry.changes
    state.stopUnanswered = carry.stopUnanswered
    // ⚠️ **And the epoch may already have been spent, in the events this carry stands for.**
    // `markReopened` is what leaves the previous life behind, and applying it a second time would
    // clear a `working` status or a genuine post-resume ENDING that the prefix established — the
    // mirror of the bug 064 fixed, on a resumed session, which is exactly where this path is hardest
    // to reason about. The crossing is at the first event whose ordinal reaches the epoch, so the
    // prefix crossed it precisely when the epoch falls before the first event still here.
    //
    // **Nothing retained means the carry is the whole answer**, and it is already epoch-correct:
    // every carry comes out of a fold that either crossed the epoch or applied `markReopened` at its
    // end, so there is no third state for an empty run to be in. Found by 073's own review, which
    // reached it through a prepend of an EMPTY page on a session whose window had not been filled
    // yet — reachable, and it clears a live `working` status for nothing.
    const first = entries[0]
    if (epoch !== null && (first === undefined || first.ordinal > epoch)) epoch = null
  }
  // ⚑ **D-035** — see the docblock. Neither side of the epoch: `markReopened` leaves the tools alone.
  if (toolsInForce !== null) {
    applyEvent(state, toolsInForce.event, toolsInForce.at, toolsInForce.ordinal)
  }
  /**
   * The ITEMS the carry stands for — the cards, and the cards still waiting on the user.
   *
   * ⛔ **Placed on the CURRENT side of the epoch, never before it, and review found out what the
   * other order costs.** {@link markReopened} exists to leave the previous life behind, and it does
   * that by SWEEPING items: `stopRunningSubAgents` stops every card and `settlePending` settles
   * every open request. A resumed session's window still holds the replayed previous life, so the
   * crossing is ahead of the first entry — and a carry applied before it had its live cards stopped
   * and its open cards settled by a correction meant for a life they were never part of. A stopped
   * card cannot be revived, either: the `sub_agent` merge branch only ever CLEARS `running`.
   * Measured A/B on the real path — carried, a running child came back finished; not carried, it did
   * not — so it was 137's own regression rather than something older.
   *
   * Idempotent because the crossing is, and called at all three exits for the same reason
   * {@link markReopened} is: a window that stops short of the epoch crosses it at the end.
   */
  let placed = false
  const placeCarried = (): void => {
    if (carry === null || placed) return
    placed = true
    // The cards FIRST, so a retained event that names one finds it — which is the whole point of
    // carrying them. They land at top level, because the row that dispatched them was released with
    // everything else; `rehome` and `adoptOrphans` put them back the moment the suffix supplies it.
    for (const card of carry.subAgents) applyEvent(state, card)
    for (const request of carry.requests) {
      applyEvent(state, request.event, request.at)
      if (request.routed !== undefined) applyEvent(state, request.routed, request.at)
    }
    // ⚑ **D-001 · on the current side of the epoch, with the cards it names** — `markReopened`
    // settles every open card, so a set restored before it would name cards it had just settled.
    for (const requestId of carry.heldPastTheirTurn) state.heldPastTheirTurn.add(requestId)
  }
  if (epoch === null) placeCarried()
  for (const message of entries) {
    if (epoch !== null && message.ordinal >= epoch) {
      markReopened(state)
      epoch = null
      placeCarried()
    }
    // ⚑ **The ordinal goes in** (299 §2) — this is the one loop that has it, and everything that
    // has to survive a re-fold is stamped from here. See `transcript.ts`'s `Placed`.
    applyEvent(state, message.event, message.at, message.ordinal)
  }
  if (epoch !== null) {
    markReopened(state)
    placeCarried()
  }
  return state
}

/**
 * Load the first page of a conversation. Replaces whatever was there.
 *
 * `atTail` is true because the host's first page always ends at the newest recorded event — every
 * hand-over (`resume`, `attachOpen`, `look`) windows backwards from the end.
 */
export function openAt(window: WindowState, page: HistoryWindow, sessionId: string): void {
  window.entries = page.entries.map((entry) => ({
    sessionId,
    ordinal: entry.ordinal,
    at: entry.at,
    event: entry.event,
  }))
  window.from = page.from
  window.hasOlder = page.hasOlder
  window.turnAligned = page.turnAligned
  window.atTail = true
  window.behind = 0
}

/**
 * Put an older page in front of what is already loaded, releasing from the NEWEST end if the result
 * would be over the cap.
 *
 * Releasing from the newest end rather than the oldest is the only direction that makes sense here:
 * the reader is moving backwards, so the events they are about to look at are the ones just loaded.
 * It is also what can take the window off the tail, which is the whole reason {@link atTail} exists.
 *
 * Returns whether anything was released, so the caller can say so rather than let content vanish —
 * and the released events THEMSELVES, because they are the live tail this window has just stopped
 * holding. Something else has to go on folding them or the session's control state stops moving
 * with it (064); see `session-record.ts`. Handing them back rather than letting the slice drop them
 * on the floor is what makes that possible without re-reading a page we already had.
 */
export function prependPage(
  window: WindowState,
  page: HistoryWindow,
  sessionId: string,
): { released: number; tail: RuntimeEventMessage[] } {
  const older = page.entries.map((entry) => ({
    sessionId,
    ordinal: entry.ordinal,
    at: entry.at,
    event: entry.event,
  }))
  window.entries = [...older, ...window.entries]
  window.from = page.from
  window.hasOlder = page.hasOlder
  window.turnAligned = page.turnAligned

  let released = 0
  let tail: RuntimeEventMessage[] = []
  if (window.entries.length > WINDOW_MAX_EVENTS) {
    // Down to the cap, then a slab further, so the next page does not immediately release again.
    const keep = Math.max(older.length, WINDOW_MAX_EVENTS - WINDOW_RELEASE_CHUNK)
    released = window.entries.length - keep
    tail = window.entries.slice(keep)
    window.entries = window.entries.slice(0, keep)
    // Whatever was released included the newest event, so this window no longer holds the end of
    // the ledger. `behind` restarts from zero: it counts events that arrive from NOW, and the ones
    // just released are not new — they are already in the ledger and come back on a jump.
    if (released > 0) {
      window.atTail = false
      window.behind = 0
    }
  }
  return { released, tail }
}

/**
 * What to do with a live event, given where the window is.
 *
 * `'fold'` — the window holds the tail, so this event belongs at the end of it. The caller appends
 * and folds incrementally, which is the pre-054 live path unchanged.
 *
 * `'behind'` — the window has been scrolled away from the tail. The event is NOT folded here, and
 * nothing is lost by that: it is in the ledger, and re-reading the newest page reconstructs it
 * correctly along with everything else. Silently folding it would append an item at the bottom of a
 * window that ends somewhere else entirely, leaving a conversation with an invisible gap in it.
 *
 * ## What happens when an event targets a RELEASED item
 *
 * This is the case worth being explicit about, because it is the one that can look like a bug.
 * A `user_decision`, `tool_result` or `request_resolved` addresses an item by id. If the
 * `permission_request` it answers was released, the fold finds nothing and does nothing — every one
 * of those paths is already written as "mark it if it is there" (`markPermissionAnswered`,
 * `foldEvent`'s `tool_result` branch), because a transcript has always been allowed to be missing
 * the thing an event refers to.
 *
 * What makes that HONEST rather than a silent loss is that the window is a view of a ledger that
 * still holds everything. The decision is recorded; scrolling back re-folds a range that contains
 * both the request and its answer, and the card comes back answered. The failure a naive
 * implementation would have — a card frozen as unanswered forever because the answer arrived while
 * it was released — cannot happen here, because nothing is remembered across a re-fold.
 */
export function liveDisposition(window: WindowState): 'fold' | 'behind' {
  return window.atTail ? 'fold' : 'behind'
}

/**
 * How close to the top counts as "the reader wants what came before".
 *
 * Generous relative to the 40px the follow-the-bottom threshold uses, because the two are asking
 * opposite questions. That one asks "are they still watching the end", where being wrong costs one
 * jump. This asks "should we fetch", where being wrong LATE costs a reader who has hit the top and
 * is looking at nothing while a request they cannot see is in flight.
 */
export const LOAD_OLDER_THRESHOLD_PX = 400

/** A scroll container, reduced to the three numbers this arithmetic needs. */
export interface ScrollView {
  scrollTop: number
  scrollHeight: number
}

/** Whether `view` is near enough to the top that the page before it should be fetched. */
export function shouldLoadOlder(
  view: Pick<ScrollView, 'scrollTop'>,
  thresholdPx = LOAD_OLDER_THRESHOLD_PX,
): boolean {
  return view.scrollTop <= thresholdPx
}

/**
 * Where `scrollTop` has to move so the reader keeps looking at the same content after older
 * messages are inserted ABOVE it.
 *
 * A browser preserves `scrollTop`, not position: content inserted above pushes everything down by
 * exactly the height it added, so a reader who was looking at message 400 is suddenly looking at
 * message 250. Adding the height difference back cancels it out.
 *
 * Pure, and separated from anything that touches an element, because it is the part that can be
 * WRONG and the test environment here is Node with Vue's SSR renderer — there is no layout, so
 * `scrollHeight` is always zero and a DOM-level assertion about scroll stability would pass no
 * matter what this returned. The arithmetic is the thing worth pinning, so the arithmetic is a
 * function.
 *
 * Clamped at zero: a shrink cannot push the view above the top of its own content.
 */
export function anchorAfterPrepend(before: ScrollView, afterScrollHeight: number): number {
  return Math.max(0, before.scrollTop + (afterScrollHeight - before.scrollHeight))
}

/**
 * Where `scrollTop` has to move when a row the reader can see has MOVED by a known distance
 * (299 §2, from 297 finding 4).
 *
 * ⛔ **The difference between this and {@link anchorAfterPrepend} is what the input MEANS.** That
 * one takes a total height and infers the insertion from how the total changed — which is only the
 * insertion when nothing was deleted in the same patch, and `prependPage` deletes from the bottom
 * on every page back after the first. This one is told how far a surviving row moved, which is the
 * inserted height above it whatever happened below.
 *
 * Clamped at zero for the same reason: a shrink cannot push the view above the top of its content.
 * Pure, and separated from anything that touches an element, because the test environment for this
 * package is Node with Vue's SSR renderer — there is no layout, so a DOM-level assertion here would
 * pass no matter what it returned. What measures the DOM lives in `useOlderHistory`, and
 * `test/dom/older-history.dom.test.ts` drives that in real Chromium.
 */
export function anchorAfterShift(scrollTop: number, movedBy: number): number {
  return Math.max(0, scrollTop + movedBy)
}

/**
 * Append a live event to a window that holds the tail, releasing from the OLDEST end if the result
 * would be over the cap.
 *
 * Returns whether a release happened — which is the caller's signal that the incremental fold is no
 * longer valid and the transcript has to be rebuilt. That is the one place a live event pays for a
 * re-fold, and {@link WINDOW_RELEASE_CHUNK} is what makes it rare rather than per-event.
 */
export function appendLive(
  window: WindowState,
  message: RuntimeEventMessage,
): { released: number } {
  window.entries.push(message)
  if (window.entries.length <= WINDOW_MAX_EVENTS) return { released: 0 }

  const released = window.entries.length - (WINDOW_MAX_EVENTS - WINDOW_RELEASE_CHUNK)
  window.entries = window.entries.slice(released)
  // The window now starts later in the ledger, and there is definitely something before it.
  window.from = window.entries[0]?.ordinal ?? window.from
  window.hasOlder = true
  // A slab cut at an arbitrary event is not a turn boundary, and claiming it was would put a
  // "conversation starts here" reading on what is really a release.
  window.turnAligned = false
  return { released }
}
