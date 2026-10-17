import type { SessionStatus } from '@brobot2/shared'
import type { RuntimeEvent, TurnLimit } from '../events'
import type { SessionRef } from '../session-ref'
import { TURN_REFUSED, TurnInProgress } from '../turn-in-progress'

/**
 * The single session/turn state machine shared by Fake + both adapters (008,
 * fixing 007 P1-3). It is the sole authority on lifecycle ordering:
 *
 *  - `status:'working'` is emitted for every accepted turn **that nothing is waiting on the user
 *    for**. A turn accepted while a card is open stays on `waiting_permission` — which is what the
 *    session is doing — and reaches `working` when the card is answered (122; before it, the
 *    adapter's lease published `working` there and disarmed the stall watchdog under an open card).
 *  - a non-interrupted terminal `turn` is **immediately** followed by `status:'idle'` — **unless a
 *    card is still open**, in which case the session stays `waiting_permission` and the `idle`
 *    arrives when that card is answered. 122 measured what the alternative costs: see
 *    {@link takeTurn}.
 *  - a recoverable turn failure is ordered `error → turn:'failed' → status:'idle'`
 *    (the 004 contract's deliberate failure-ordering amendment).
 *  - interrupt/cancel state is **per turn** (a second/overlapping send cannot clear or
 *    misclassify another turn). 🔴 **709 · R43: it no longer classifies the PROVIDER's
 *    terminal.** A turn the provider completed is `completed`, even when an interrupt was asked;
 *    the ask is recorded beside it by whoever asked (`work_interrupted`, a `cancel`
 *    `user_decision`). It still decides the word of two endings this machine writes itself —
 *    {@link SessionMachine.failTurn} and `terminalizeErrored` say `interrupted` only after an ask;
 *    {@link SessionMachine.forceEnd} sets it itself and always says `interrupted`. 🔴 **720 · R71:
 *    those three endings are marked `wordOf: 'this-app'`** — the ledger says whose word it holds,
 *    and a provider's own word is never marked.
 *  - after a terminal session (`closed`) or `errored`, the machine is **frozen**:
 *    late provider signals cannot mutate lifecycle state.
 *
 * Content events (deltas, messages, tool calls/results, permission/user-input
 * requests, informational non-fatal errors) are NOT owned here — the handles emit
 * those directly. This machine owns `session`, `turn`, and **every** `status`.
 *
 * ## 122 · `status` is DERIVED here, and it has one writer
 *
 * Keep session status derived through one machine. Independent adapter wait leases and persisted last-event status can leave working latched after the activity ended. The stored column derives from the turn table, and the event stream must follow the same lifecycle.
 *
 * The cost, measured from the live ledger of `sess_6b4380fa` (12 Aug 00:33):
 *
 * ```
 * 302  turn completed  ← the foreground turn really did end; the Workflow it launched runs on
 * 303  status idle
 * …    ~230 events of real main-agent work with NO user_turn and NO turn open (116's finding)
 * 548  status waiting_permission   ← the lease, with no turn behind it
 * 552  user_decision   rejected
 * 553  status working              ← the lease again: a `working` this machine cannot retract
 * 556-569  the model's full reply, then the provider's own `result` — which
 *          completeTurn() DROPPED, because `this.turn` was already null.
 * ```
 *
 * From 553 the session was `working` to every consumer that reads the stream, with nothing left
 * that could ever say `idle`. ⚠️ The refusals are the HOST's, not this class's — `RuntimeHost`
 * gates `send` on `handle.status() === 'idle'` and flushes the queue on the `idle` EVENT — while
 * this machine would happily have accepted another turn. What this class owns is that the `idle`
 * could never be published. `interrupt()` was no help either: it returns immediately when no turn
 * is open, so the Stop button on screen did nothing. The one message he typed afterwards had no way
 * out of the app at all.
 *
 * ⚑ **So the wait count lives HERE now, and every `status` is computed from the same three facts —
 * the session state, whether a turn is open, and whether anything is waiting on the user.** A
 * caller cannot assert a status any more; it can only change one of those facts. The class that
 * used to own the count (`WaitLease`, 063) is gone: its counting rules are {@link beginWait} /
 * {@link endWait} / {@link abandonWait}, unchanged, one layer down.
 *
 * ## 123 · a terminal belongs to the work that EARNED it
 *
 * 122 fixed what a dropped terminal COST. It did not fix where terminals go, and that is one defect
 * with two faces: this class used to attribute every provider terminal to whatever turn happened to
 * be open at that instant.
 *
 * Interrupt-and-send must preserve lifecycle ordering observed at the turn boundary:
 *
 * ```
 * 410  turn interrupted   ← 074's forced terminal: the user pressed Stop
 * 411  status idle
 * 412  status working
 * 413  user_turn          "make it a small plan."      ← the replacement turn opens
 * 414  error              "turn failed: error_during_execution"   ← +15ms: the INTERRUPTED turn's
 * 415  turn failed        ← …own result, landing on the turn that had just started
 * 416  status idle
 * 418+ every bit of the replacement's real work, streaming outside any turn
 * ```
 *
 * Two out of two. The user sees a red failure for a message that was answered perfectly well, the
 * ledger records the wrong ending on the wrong turn, and the work that follows belongs to no turn at
 * all.
 *
 * ⚑ **So the machine now knows about three kinds of provider work, and each ends with exactly one
 * terminal:** a turn it holds, an {@link noteProviderWork unbidden} burst nobody asked for, and one
 * it {@link forceEnd ended itself} and is still owed a terminal for. {@link completeTurn} pays them
 * in that order.
 */
export type SessionState = 'unstarted' | 'starting' | 'active' | 'closing' | 'closed' | 'errored'

/** How the PROVIDER says a turn ended — recorded as it is said since 709 (R43). */
export type TurnOutcome = 'completed' | 'failed' | 'interrupted'

/**
 * ⚑ **F076** — what a provider said about the login: that it refused the one this session was
 * launched with (Claude's fatal error, Codex's failed turn), and whether that login was an API key.
 */
export interface RefusedLoginSaid {
  readonly loginRefused?: true
  readonly onAKey?: true
  /**
   * On a failed turn only: the provider would not bill the account the session runs on. It ends
   * no session; {@link onAKey} beside it says the account is the saved key's.
   */
  readonly billingRefused?: true
}

interface TrackedTurn {
  readonly id: number
  interruptRequested: boolean
  /**
   * This turn opened while the provider still owed a terminal for work we had ended ourselves, so
   * the FIRST terminal it sees is not its own (123). See {@link SessionMachine.forceEnd}.
   *
   * ⚑ **Carried on the turn rather than on the machine, so it can protect exactly one turn.**
   *
   * ⚠️ **It is NOT "bounded by construction", which is what this comment said first** (corrected in
   * review, which reproduced the difference). Between {@link SessionMachine.forceEnd} and the next
   * {@link SessionMachine.beginTurn} the debt sits on the machine for unbounded wall-clock time —
   * ten minutes, if that is how long the user waits — and it is handed to whichever turn opens next.
   * What actually bounds it is {@link SessionMachine.noteProviderWork}: the first content the turn
   * produces retires it, because content is proof the provider has moved on to this turn's work.
   * The honest sentence is *"it cannot survive the next turn's first content event"* — ⚠️ other
   * than a `tool_result`, which since D-002 is read as the stopped work's receipt, and other than a
   * sub-agent's content, which since D-040 is not the main agent's ({@link isProviderWork}).
   */
  absorbsForeignTerminal: boolean
  /**
   * 🔴 **F080 — this turn opened while a burst its provider started was running.** The CLI folds
   * the message into the loop it is running, so this turn IS that one: the store keeps the burst's
   * row open for it, and every ending of it is marked `startedBy`, as the burst's would have been.
   */
  readonly joinedABurst: boolean
  /**
   * ⚑ **F084 — the commands a stop of this turn ended**, by tool call id
   * ({@link SessionMachine.noteWhatTheStopEnded}): what its ending says, in `endedCommands`.
   */
  readonly endedCommands: string[]
}

/**
 * ⚑ **F080** — the marks a turn's ending carries: `startedBy` when it joined a burst. ⚑ **F084** —
 * and the commands its stop ended, when it ended any.
 */
function endingMarksOf(turn: TrackedTurn | null): {
  readonly startedBy?: 'the-provider'
  readonly endedCommands?: string[]
} {
  return {
    ...(turn?.joinedABurst === true ? { startedBy: 'the-provider' as const } : {}),
    ...(turn !== null && turn.endedCommands.length > 0
      ? { endedCommands: [...turn.endedCommands] }
      : {}),
  }
}

export class SessionMachine {
  private _state: SessionState = 'unstarted'
  private turn: TrackedTurn | null = null
  private turnCounter = 0
  private waits = 0
  /**
   * The provider is producing content with no turn of ours behind it (123). See
   * {@link noteProviderWork}.
   */
  private unbidden = false
  /**
   * ⚑ **F080 — a stop was asked of the {@link unbidden} burst**, the latch a turn keeps in
   * `interruptRequested`: a fault that ends the burst before the stop lands says `interrupted`.
   */
  private stopAskedOfTheBurst = false
  /**
   * ⚑ **F084 — the commands a stop of the {@link unbidden} burst ended** — a turn the provider
   * started by itself has no {@link TrackedTurn} to hold them. Said on the burst's ending
   * ({@link say}), or taken by the turn that joins it ({@link beginTurn}).
   */
  private readonly burstEndedCommands: string[] = []
  /** ⚑ **F076** — this session ended because its provider refused the login it was launched with. */
  private endedOnARefusedLogin = false
  /** ⚑ …and that login was an API key a person saved (`onAKey`, see `events.ts`). */
  private endedOnARefusedKey = false
  /**
   * We ended a piece of provider work OURSELVES (074's forced terminal) and the provider still owes
   * it a terminal, with nothing open yet to charge it to.
   *
   * ⚠️ **Attribution only — it never publishes anything.** It is handed to the next turn that opens
   * ({@link beginTurn}) or retired by the terminal itself ({@link completeTurn}); it is never held
   * across two turns.
   */
  private foreignTerminal = false
  /** The last `status` actually emitted — so a derivation that has not changed says nothing. */
  private published: SessionStatus | null = null

  /**
   * True while this machine is delivering an event of its own — see {@link say}.
   *
   * ⛔ **The whole of a P0 review finding lives on this flag.** It is not a micro-optimisation and it
   * cannot be removed as "defensive".
   */
  private speaking = false

  constructor(private readonly emit: (event: RuntimeEvent) => void) {}

  /**
   * Emit one event, marked as OURS for as long as the caller is delivering it.
   *
   * ⛔ **`emit` re-enters this class, synchronously, and that is how 123's first draft rebuilt 122's
   * stranding on the most ordinary path in the app** — a turn that streams text and completes:
   *
   * ```
   * status:working | assistant_delta | turn:completed        …and handle.status() === 'working'
   * ```
   *
   * The mechanism, found in review and reproduced end to end: {@link completeTurn} detaches the turn
   * BEFORE it emits the terminal (110's ordering, deliberately). The adapter's `emit` feeds a
   * `DeltaCoalescer`, whose contract is that buffered deltas are flushed *before* any non-delta
   * event — so emitting the `turn` re-enters the adapter's `deliver`, which calls
   * {@link noteProviderWork} for the flushed delta, which finds `this.turn` already null and latches
   * a burst. The derivation then says `working` forever, and {@link sync} publishes nothing because
   * `working` was already out there. Nothing on the wire even hints at it.
   *
   * ⚑ **The invariant this restores, stated positively:** content delivered as a side effect of the
   * machine announcing a boundary was produced BEFORE that boundary — the coalescer says so in its
   * own doc — so it is not evidence about what the provider is doing now.
   */
  private say(event: RuntimeEvent): void {
    const wasSpeaking = this.speaking
    this.speaking = true
    try {
      this.emit(this.withWhatTheBurstsStopEnded(event))
    } finally {
      this.speaking = wasSpeaking
    }
  }

  /**
   * ⚑ **F084 — a burst's ending, with what a stop of it ended** — here rather than at each of the
   * three paths that end a burst (its `result`, a forced end, a fault), so none can leave it out.
   * ⚑ A turn that joined the burst took them already ({@link beginTurn}).
   */
  private withWhatTheBurstsStopEnded(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'turn' || event.startedBy !== 'the-provider') return event
    if (event.endedCommands !== undefined || this.burstEndedCommands.length === 0) return event
    return { ...event, endedCommands: this.burstEndedCommands.splice(0) }
  }

  get state(): SessionState {
    return this._state
  }

  /** `closed` or `errored` — no further lifecycle events will be emitted. */
  get isTerminal(): boolean {
    return this._state === 'closed' || this._state === 'errored'
  }

  get hasActiveTurn(): boolean {
    return this.turn !== null
  }

  /**
   * **Is the provider's MAIN agent doing anything at all** — a turn we hold, or a burst nobody
   * asked for (123). ⚠️ D-040 · a sub-agent left running in the background is not: it is the
   * background level's, and its Stop is its own row's.
   *
   * ⚑ This is the predicate the Stop button needs, and `hasActiveTurn` is not it. `interrupt()`
   * returned immediately when no turn was open, so through the whole four-minute window 122
   * measured, the one control on the surface that promises to end things did nothing —
   * `PromptComposer.vue`'s own comment already said what that costs: *"a stop button that did
   * nothing would be the one control on this surface that lies."*
   */
  get hasProviderWork(): boolean {
    return this.turn !== null || this.unbidden
  }

  get activeTurnId(): number | null {
    return this.turn?.id ?? null
  }

  /** How many requests are waiting on the user. For tests and diagnostics. */
  get waiting(): number {
    return this.waits
  }

  /** `start()`/`resume()` was called; the provider handshake is in flight. */
  markStarting(): void {
    if (this._state === 'unstarted') this._state = 'starting'
  }

  /**
   * The provider confirmed the session (Claude `system/init`, Codex
   * `thread/start`/`resume` response). Emits the `session` event and then syncs.
   *
   * ⛔ **It is usually not the first status any more, and this comment said the opposite until 137.**
   * It read *"a status ahead of the `session` event would be out of order — so {@link derive}
   * returns null and {@link sync} says nothing"*, and 133 deleted the branch that made that true.
   * A turn opened before the handshake — every ordinary Claude first send — now publishes `working`
   * from {@link beginTurn}, so the order on the wire is `working` then `session`. 136 found the
   * sentence still standing here and measured the ordering it denied, on a run with no compaction
   * in it.
   *
   * ⚑ **What this call still does is stop the claim being made twice**: {@link sync} publishes only
   * a status that differs from the one already out there, so the handshake restates nothing. The
   * `idle` a ready session with no turn deserves (Codex, Fake) is still published from here, because
   * `unstarted` is the one state {@link derive} genuinely has nothing to say about.
   */
  sessionStarted(ref: SessionRef, opening: 'started' | 'resumed'): void {
    if (this.isTerminal || this._state === 'active') return
    this._state = 'active'
    this.say({ type: 'session', state: opening, ref })
    this.sync()
  }

  /**
   * ⛔ **Whether this session takes turns at all** — the state half of {@link beginTurn}'s `null`,
   * shared with {@link refusedTurn} so the two can never disagree about which half a refusal was.
   */
  private get acceptsTurns(): boolean {
    return this._state === 'active' || this._state === 'starting'
  }

  /**
   * 🔴 **Why {@link beginTurn} just answered `null`, as a thrown value** (650).
   *
   * ⚑ **Ask it in the SAME synchronous statement as the `null`** — the state it reads is the state
   * the refusal was decided on only until something else runs.
   *
   * ⛔ **The state is asked FIRST, and the order is the point.** A session that is closing can still
   * be holding the turn it was in the middle of — `beginClose` does not clear it — and that session
   * is not going to take this send when the turn ends. ⚠️ Asked the other way round it would read
   * as *busy*, and a caller told *busy* retries against a conversation that is going away.
   *
   * @returns {@link TurnInProgress} when the session takes turns and one is already held; otherwise
   *   a plain `Error` carrying the same {@link TURN_REFUSED} text every adapter has always thrown.
   */
  refusedTurn(): Error {
    if (!this.acceptsTurns) return new Error(TURN_REFUSED)
    if (this.turn) return new TurnInProgress()
    return new Error(TURN_REFUSED)
  }

  /**
   * Accept a new turn. Returns its id, or `null` if it must be rejected
   * (session closing/closed/errored, or a turn is already active — one tracked
   * turn at this layer, so overlapping sends are rejected). {@link refusedTurn} says which.
   *
   * Publishes `working` when nothing is waiting on the user — ⛔ **including when this turn is what
   * triggered the handshake**, which is the change 133 made and the clause this comment claimed the
   * opposite of until 137. It said the status was *"deferred to {@link sessionStarted}"*; it is not,
   * and a turn that waited ninety-one seconds for `system/init` is what that deferral cost.
   *
   * Publishes NOTHING at all when a card is open, because `waiting_permission` is still what the
   * session is doing and saying `working` over it is how the stall watchdog used to be disarmed
   * under an open card.
   */
  beginTurn(): number | null {
    if (!this.acceptsTurns) return null
    if (this.turn) return null
    const id = ++this.turnCounter
    // ⛔ **A turn we HOLD supersedes a burst we merely inferred, and both obligations become one
    // debt that rides on this turn** (123, review). Two reviewers reproduced what the first version
    // cost: `unbidden` survived into the new turn and, because {@link completeTurn} weighs it first,
    // the NEW turn's own terminal was spent on the burst — a turn that never closed. Folding the
    // burst into the debt keeps the thing the debt is for (the older work's terminal must not land
    // here) while bounding it the way a debt is bounded: one turn, and gone the moment this turn
    // produces content of its own.
    const joinedABurst = this.unbidden
    this.turn = {
      id,
      // ⚑ A stop already asked of the burst is this turn's: it is the same loop.
      interruptRequested: this.stopAskedOfTheBurst,
      absorbsForeignTerminal: this.foreignTerminal || this.unbidden,
      joinedABurst,
      // ⚑ **F084** — what a stop of the burst it joins ended is this turn's to say.
      endedCommands: joinedABurst ? this.burstEndedCommands.splice(0) : [],
    }
    this.foreignTerminal = false
    // 🔴 **F080 — a message that joins a burst joins its turn**: the CLI folds it into the loop it is
    // running, and that loop's `result`, naming the message, ends both. So the burst writes no
    // ending of its own here; this turn's ending is the burst's, marked `startedBy`
    // ({@link endingMarksOf}), and its `user_turn` joins the burst's row in the store.
    this.endBurst()
    this.sync()
    return id
  }

  /**
   * **The MAIN agent produced content** — a delta, a message, a thought, a tool call (123).
   *
   * Called by every adapter from the one place its events are final, for the events that prove the
   * main agent's model is running ({@link isProviderWork}). It is what gives the app the signal
   * `agent-state.ts` said it did not have and must not invent: *"the honest way to remove the trade
   * is a signal that says 'the provider is busy outside a turn'."* ⚠️ That trade's own case, a
   * background sub-agent still running, is not this signal's since D-040: the status stays `idle`,
   * and the background level says *running in the background*.
   *
   * 🔴 **D-040 · a sub-agent's content is not the main agent's** (F054). ⛔ A background sub-agent's
   * `tool_call`, 12 s after the main agent's turn had ended, opened a burst that only the main
   * agent's next `result` (its notification turn's), a Stop or a close would end — a sub-agent
   * writes no `result` of its own to its parent's stream — and the conversation read `working` for
   * eleven minutes, until the app restarted. ⚑ Its events carry `parentToolCallId` and never reach
   * here: they neither open a burst nor retire the debt below. A turn waiting on a FOREGROUND
   * sub-agent reads `working` as that turn.
   *
   * ⛔ **`activity` is deliberately not one of those types, and 099 is the reason with a number on
   * it**: 208 of 657 `activity` events — 32% — arrive with no turn open, because it is a
   * fire-and-forget phase notification with no ending of its own. Latching a status on one would
   * rebuild 099's bug inside the runtime, where nothing downstream could correct it.
   *
   * ⚑ **The burst has a real ending, and it was measured rather than hoped for** (`probe:out-of-turn`,
   * 12 Aug). A backgrounded `Bash` woke the agent 18.3 s after its turn had ended; the SDK sent a
   * fresh `system/init`, ran a whole agent loop — thinking, an `assistant` message, a tool result,
   * more thinking — and closed it with **exactly one `result/success` at +27.1 s**. So an unbidden
   * burst terminalizes the same way a turn does, and {@link completeTurn} is what unlatches this.
   *
   * @param kind the event that proved it. ⚑ Only `tool_result` is read (D-002); omitted, the
   *   content is treated as the model's own output.
   */
  noteProviderWork(kind?: RuntimeEvent['type']): void {
    if (this.isTerminal || this._state === 'closing') return
    // ⛔ **Content flushed by our own announcement is older than the announcement.** See {@link say}
    // — without this line a turn that merely streamed text never reached `idle` again.
    if (this.speaking) return
    if (this.turn) {
      // 🔴 **D-002 · `738` P-2 — a tool coming back is not the provider moving on.** ⛔ Stop while a
      // command ran, then send: the stopped call's own `tool_result` (`is_error`) landed on the
      // replacement turn, retired its debt below, and the stopped turn's `result` then closed the
      // replacement — whose reply streamed outside any turn (`smoke:claude` 3.4, both batches).
      // ⚑ A result is only ever this turn's own after this turn's own `tool_call`, and that call
      // has already retired the debt; so while the debt stands, every result is the stopped work's.
      if (kind === 'tool_result' && this.turn.absorbsForeignTerminal) return
      // ⚑ **Proof the provider has moved on to the turn we hold.** Any terminal it still owed for
      // work we ended ourselves can no longer arrive before this turn's own, so honouring the debt
      // from here could only mean swallowing the wrong one.
      this.turn.absorbsForeignTerminal = false
      return
    }
    // The tail of work we already ended is not new work. Its terminal is still coming and is spoken
    // for; calling it a fresh burst would leave a `working` for a second terminal nobody owes.
    if (this.foreignTerminal) return
    if (this.unbidden) return
    this.unbidden = true
    // 🔴 **F080 — the burst is a turn, started by the provider**, written before its first content
    // so that content lands in it ({@link RuntimeEvent} `provider_turn`); its ending is a `turn` row
    // marked `startedBy` on every path that ends it.
    this.say({ type: 'provider_turn' })
    this.sync()
  }

  /**
   * Mark the active turn interrupt-requested (interrupt(), or a `cancel` decision).
   *
   * 🔴 **720 · R71 — *a `cancel` decision* means every Cancel door again.** ⚑ The ruling: *"A
   * Cancel latches on every door … because a Cancel asked a stop on both, and a fault after it is
   * not the provider's word alone."* ⛔ `492` had taken the Codex agent-tool card off the latch (it
   * answers `item/tool/call` with a tool RESULT and asks the stop with `turn/interrupt`), so
   * *Cancel, then the stream dies* read `failed` there and `interrupted` on a command approval.
   * ⚑ Every Cancel comes here now: a command, file or elicitation approval (`{decision:'cancel'}`
   * / `{action:'cancel'}`), the agent-tool card, and Claude's `canUseTool` (`interrupt: true`).
   *
   * 🔴 **709 · R43: the latch no longer renames the provider's word.** ⛔ It used to make
   * {@link completeTurn} say `interrupted` whatever the provider reported — so the ledger said
   * `interrupted` over turns Codex COMPLETED (`probe:codex-early-interrupt`, 4 of 4 on `main` before
   * `704`). ⚑ What it still decides is the word of two endings this machine writes ITSELF, where no
   * provider has said anything: {@link failTurn}'s and a fatal error's (`terminalizeErrored`).
   * {@link forceEnd} sets the latch itself and says `interrupted` whatever came before.
   */
  requestInterrupt(): void {
    if (this.turn) this.turn.interruptRequested = true
    else if (this.unbidden) this.stopAskedOfTheBurst = true
  }

  /**
   * ⚑ **F084 — a stop of turn `of` ended these commands** (tool call ids), so the turn's ending says
   * which — or of the burst its provider started by itself, with no turn of ours open. ⚠️ Only while
   * that turn or burst is still the open one: a pass that finishes after its ending was written has
   * no row left to say it on, and must never be said on the next turn's.
   */
  noteWhatTheStopEnded(of: number | 'the-burst', toolCallIds: readonly string[]): void {
    const into =
      of === 'the-burst'
        ? this.turn === null && this.unbidden
          ? this.burstEndedCommands
          : null
        : this.turn !== null && this.turn.id === of
          ? this.turn.endedCommands
          : null
    if (into === null) return
    for (const id of toolCallIds) {
      if (!into.includes(id)) into.push(id)
    }
  }

  /** ⚑ **F084** — the id of the open turn, for an adapter noting what its stop ended. */
  get openTurnId(): number | null {
    return this.turn?.id ?? null
  }

  /** The burst is over, whoever ended it; whether a stop was asked of it. */
  private endBurst(): boolean {
    const stopAsked = this.stopAskedOfTheBurst
    this.unbidden = false
    this.stopAskedOfTheBurst = false
    return stopAsked
  }

  /**
   * Terminalize the active turn **in the provider's own word** and emit the correctly-ordered
   * terminal events. No-op if the machine is already terminal (freeze).
   *
   * 🔴 **709 · R43 — the ledger records the provider's word.** ⛔ This applied per-turn interrupt
   * classification — *an interrupt-requested turn is `interrupted`, whatever the provider
   * reported* — and that is how four turns Codex completed were recorded `interrupted`
   * (`probe:codex-early-interrupt` on `main` before `704`), and how a `smoke:ui` step passed on a
   * count Codex ran to sixty. ⚑ Now `interrupted` here means the PROVIDER said so: Codex's
   * `turn/completed{status:'interrupted'}`, or Claude's `result` with `terminal_reason`
   * `aborted_streaming` / `aborted_tools` (measured on CLI 2.1.281 — see `claudeResultOutcome`).
   * The ask is a second fact, recorded beside the turn by whoever asked.
   *
   * Handle a provider result even with no active foreground turn. A background workflow can already have closed that turn; ignoring the later result leaves stale working state. `probe:reject-question` covers a successful result after a rejected `AskUserQuestion`.
   *
   * ⛔ **It still returns in silence, and the repair is NOT here.** There is no turn, so a `turn`
   * event would be a boundary the provider never drew (039/086). ⚠️ An earlier draft of this fix
   * ALSO called `sync()` on this branch; the mutation check removed the call and every test stayed
   * green, because in the measured shape the status was already `idle` by the time the terminal
   * landed — the card had been answered, and {@link endWait} published it then.
   *
   * ⚠️ **"No test covers it" is not "it can never matter", and a reviewer built the difference.**
   * {@link abandonWait} moves the count WITHOUT publishing, by design, so `published` can be stale
   * when this branch is reached during teardown (`beginClose` → `settleRequests` → the shutdown
   * exit → a late `result`). A `sync()` here would emit `idle` in that window; today
   * {@link closeSession} publishes `ended` a moment later either way, so the difference is a status
   * nobody sees. It is left out because the branch's job is to NOT speak, and stated here rather
   * than sold as dead code.
   *
   * What actually repairs the stranding is that the status is DERIVED — a `working` now requires a
   * turn this machine holds, so there is no longer a stale one for a dropped terminal to leave
   * behind. The drop still happens; it just no longer costs anything.
   */
  completeTurn(
    providerOutcome: TurnOutcome,
    errorMessage?: string,
    /** ⚑ **F074** — the usage limit a `failed` turn ended on, when its provider said so. */
    limit?: TurnLimit,
    /**
     * 🔴 **F080 — whose ending this terminal is, when the adapter can tell** — Claude's `result`
     * echoes the uuid of the message it answers (`user_message_uuid(s)`), and names none for a loop
     * the CLI ran for itself.
     *  - `'the-open-turn'` — it answers the open turn's own message: that turn ends, whatever debt
     *    stood ({@link TrackedTurn.absorbsForeignTerminal} was a guess, and this is the fact).
     *  - `'not-the-open-turn'` — it answers no message of the open turn's: it pays a debt, or ends a
     *    burst, and ⛔ never ends the open turn. ⚑ Measured (`probe:claude-provider-burst`, arm B):
     *    resumed after a restart stopped its background work, the CLI first ends a loop of its own
     *    for the stopped task's notice — `result` with `num_turns: 0`, no uuid — and only then
     *    answers our message; that empty result used to end our turn before the model ran.
     *  - absent — this machine's own attribution (123), as before: Codex, the double.
     */
    whose?: 'the-open-turn' | 'not-the-open-turn',
    /**
     * ⚑ **F076 — a `failed` turn the provider failed on the login it was launched with**, said on
     * its row, when the provider says so on the turn's own terminal (Codex's `unauthorized`).
     * Claude's arrives as a fatal error instead ({@link fatalAfterReportedError}). Or the provider
     * would not bill the account the turn ran on (`billingRefused`).
     */
    refused?: RefusedLoginSaid,
  ): void {
    if (this.isTerminal) return
    if (whose === 'the-open-turn' && this.turn) this.turn.absorbsForeignTerminal = false
    if (whose === 'not-the-open-turn' && this.turn && !this.turn.absorbsForeignTerminal) {
      // ⚑ A loop the provider ran for itself, inside our turn: its content was this turn's to show,
      // and its ending is not this turn's. Our message is answered next.
      return
    }
    // ⚑ **Attribution, oldest obligation first (123).** Each of the three ends with exactly one
    // terminal, and this order is what stops one piece of work's ending from being spent on
    // another's — see the class doc for the two live instances of that happening.
    if (this.unbidden) {
      // 🔴 **F080 — the burst's own ending, as a `turn` row** (it opened as `provider_turn`): the
      // provider drew this boundary with its own `result`. ⛔ Until F080 it wrote none, so a burst
      // had no turn in the ledger at all.
      this.endBurst()
      this.sayTheEnding(
        providerOutcome,
        errorMessage,
        limit,
        { startedBy: 'the-provider' },
        refused,
      )
      this.sync()
      return
    }
    if (!this.turn) {
      // 122's branch, still silent — and now it also retires a debt that has nothing left to
      // protect: the aborted work's terminal has landed, and no turn was opened in between.
      this.foreignTerminal = false
      return
    }
    if (this.turn.absorbsForeignTerminal) {
      // ⛔ **This terminal belongs to the work we ended ourselves, not to the turn now open.**
      // Measured at +15 ms (`sess_0bc12ca1` 410-415) and +3 ms (`sess_6b4380fa`) after the
      // replacement turn began. Without this the replacement was recorded `failed`, and the aborted
      // turn's `error_during_execution` was shown to the user as that message's reason.
      this.turn.absorbsForeignTerminal = false
      return
    }
    const ended = this.takeTurn()
    this.sayTheEnding(providerOutcome, errorMessage, limit, endingMarksOf(ended), refused)
    this.sync()
  }

  /** A provider terminal, said: a failure's reason first, then the `turn` row. */
  private sayTheEnding(
    outcome: TurnOutcome,
    errorMessage: string | undefined,
    limit: TurnLimit | undefined,
    marks: ReturnType<typeof endingMarksOf>,
    /** ⚑ **F076** — on a `failed` row only, as {@link terminalizeErrored} says it. */
    refused: RefusedLoginSaid = {},
  ): void {
    if (outcome === 'failed') {
      this.say({ type: 'error', message: errorMessage ?? 'turn failed', fatal: false })
      this.say({
        type: 'turn',
        state: 'failed',
        ...(limit === undefined ? {} : { limit }),
        ...(refused.loginRefused === true ? { loginRefused: true } : {}),
        ...(refused.billingRefused === true ? { billingRefused: true } : {}),
        ...((refused.loginRefused === true || refused.billingRefused === true) &&
        refused.onAKey === true
          ? { onAKey: true }
          : {}),
        ...marks,
      })
    } else {
      this.say({ type: 'turn', state: outcome, ...marks })
    }
  }

  /**
   * **Fail the active turn because WE could not run it** — a queued setting the provider refused, a
   * `turn/start` that was rejected (123, from review).
   *
   * ⛔ **It exists because {@link completeTurn} is about the PROVIDER's terminal, and these are not
   * that.** Both call sites terminalize a turn the provider never began, so neither of the two
   * obligations `completeTurn` weighs can be theirs — and a reviewer found what routing them through
   * it costs: a turn opened by `sendInterrupting` inherits the stopped turn's debt, then fails
   * before producing a single event, and its own terminal is absorbed as if it were the old one's.
   * The turn stays open forever with `status: working` and the composer locked — *"a session bricked
   * by its own error path"*, which is the sentence `claude-runtime.ts` already had for this hazard
   * one line above the call.
   *
   * No debt is left behind either: a turn the provider never started owes no terminal.
   */
  failTurn(
    message: string,
    /**
     * ⚑ **F080 — the message never left this app** (Claude's settings, applied before the push), so
     * a burst it was to join runs on. ⚠️ Only the caller knows: Codex's `turn/start` is answered
     * after the host has recorded the message as sent.
     */
    said: { readonly neverSent?: true } = {},
  ): void {
    if (this.isTerminal || !this.turn) return
    const interrupted = this.turn.interruptRequested
    const ended = this.takeTurn()
    if (ended?.joinedABurst === true && !interrupted && said.neverSent === true) {
      // 🔴 **F080 — the message never reached the provider, and the burst it was to join runs on**:
      // the reason is said, and the burst is the provider's again, its row still open.
      this.say({ type: 'error', message, fatal: false })
      this.unbidden = true
      this.burstEndedCommands.push(...ended.endedCommands)
      this.sync()
      return
    }
    // ⚑ **720 · R71: the word is this machine's — the provider never began the turn.**
    if (interrupted) {
      this.say({ type: 'turn', state: 'interrupted', wordOf: 'this-app', ...endingMarksOf(ended) })
    } else {
      this.say({ type: 'error', message, fatal: false })
      this.say({ type: 'turn', state: 'failed', wordOf: 'this-app', ...endingMarksOf(ended) })
    }
    this.sync()
  }

  /**
   * **End what the provider is doing, ahead of the provider** — 074's forced terminal, widened to
   * cover work no turn was ever opened for (123).
   *
   * It replaces `completeTurn('interrupted')` at the two call sites that mean *"we are ending this,
   * whatever the provider does next"*: `interrupt()` and `close()`. The difference is not the event
   * — a turn still terminalizes as `interrupted`, exactly as before — but the memory: the provider
   * has not finished, so its terminal is still on its way and is already spent.
   *
   * 🔴 **720 · R71 — and the event says so: `wordOf: 'this-app'`.** ⚑ *"A stop the APP forces
   * (`forceEnd` on a Stop or a Close) records its word as the app's act, never as the provider's."*
   * ⚠️ The provider's own word for this work arrives later and is absorbed unread by the debt below,
   * so the mark is the only record of who ended it. `709` measured it on a live Claude Stop: the
   * receipt beats the result, so the recorded word is this app's.
   *
   * 🔴 **F080 — a burst ends as a turn too: `interrupted`, the app's word, marked `startedBy`** —
   * it opened as `provider_turn`, and a Stop or a close is what ended it.
   *
   * ⚠️ **It returns nothing, and an earlier version returned "was there anything to end".** No
   * adapter read it — only a test did — and a value whose sole consumer is its own assertion is the
   * affordance 106 is about. `hasProviderWork` already answers that question, and the adapters ask
   * it before they call.
   *
   * @param expectTerminal whether the provider was actually ASKED to stop and therefore still owes a
   * terminal for this work. ⚠️ **Codex passes `false` in one branch and the reason is real, not
   * tidiness** (123, review): `turn/interrupt` addresses a thread turn, so work Codex is doing
   * outside one has no address on that protocol and no RPC is sent. Recording a debt nobody was
   * asked to pay would leave {@link noteProviderWork} muted — it declines to open a fresh burst
   * while one is outstanding — so the session would go deaf to that provider's work until the user's
   * next message.
   */
  forceEnd(expectTerminal = true): void {
    if (this.isTerminal) return
    if (this.turn) {
      this.turn.interruptRequested = true
      const ended = this.takeTurn()
      this.say({ type: 'turn', state: 'interrupted', wordOf: 'this-app', ...endingMarksOf(ended) })
      this.foreignTerminal = expectTerminal
      this.sync()
      return
    }
    if (!this.unbidden) return
    this.endBurst()
    this.say({ type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' })
    // The burst's terminal is still coming, and the next turn opened is the one it could land on —
    // the same debt a stopped turn leaves, for the same reason.
    this.foreignTerminal = expectTerminal
    this.sync()
  }

  /**
   * A fatal, session-terminating error (e.g. the provider process died). Emits
   * `error{fatal:true}`, then — if a turn was active (including one blocked on a
   * permission/user-input wait) — **exactly one terminal `turn`** so the active
   * turn is never left dangling (023 P1-A: never zero terminal turns), then
   * `status:'errored'` and freezes the machine. The terminal turn is `interrupted`
   * if an interrupt was requested, else `failed`, and marked `wordOf: 'this-app'` (720, R71): the
   * provider died rather than ending the turn. Distinct from a recoverable turn failure
   * ({@link completeTurn}).
   */
  fatalError(message: string, endedByItsAdapter = false): void {
    if (this.isTerminal) return
    // ⚠️ The freeze is taken BEFORE the error is emitted, exactly as it always was: `emit` is a
    // caller-supplied callback, and a caller that re-entered from it would otherwise get a second
    // fatal error past a guard that had not closed yet.
    this._state = 'errored'
    // ⚠️ **The turn is cleared BEFORE the error is emitted, exactly as it always was** (110 review).
    // The first version of this split emitted the error first and cleared afterwards, which left
    // `hasActiveTurn` reporting true while the fatal error was being delivered — and `trackProgress`
    // reads it, so the event that ENDS the turn would have re-armed the stall watchdog. Harmless
    // today, because the terminal `turn` immediately after stops it; wrong the moment anything reads
    // the machine off the one event that carries the fatal cause.
    const endedTurn = this.takeTurn()
    this.say({
      type: 'error',
      message,
      fatal: true,
      ...(endedByItsAdapter ? { endedByItsAdapter: true as const } : {}),
    })
    this.terminalizeErrored(endedTurn)
  }

  /**
   * The same terminalization {@link fatalError} performs, for a fatal error **the caller has already
   * emitted** (110).
   *
   * It exists because one class of ending arrives as a normalized event rather than as a string: a
   * refused credential is reported by `normalizeMessage` — verbatim, with its `cause`, in the one
   * place that knows how to read the provider's message — and the adapter's job afterwards is only
   * to stop the session. Routing that back through {@link fatalError} would put the same failure in
   * the transcript twice, once as the provider said it and once as we paraphrased it, which is the
   * duplicate-fact defect 028 and 037 exist to prevent.
   *
   * Everything else is identical, deliberately: the state, the freeze, and **exactly one** terminal
   * `turn` for an active turn (023 P1-A: never zero terminal turns, never two). A turn is `failed`
   * here, not `completed` — which also corrects a smaller lie 110 measured, that the SDK sends
   * `result: success` after an authentication failure and the ledger recorded the turn as completed.
   *
   * ⚑ **F076 · `loginRefused`** — the reported error was the provider refusing the login this
   * session was launched with (`auth_stale`), and the turn it ends says so — and `onAKey`, that the
   * login was an API key a person saved.
   */
  fatalAfterReportedError(said: RefusedLoginSaid = {}): void {
    if (this.isTerminal) return
    this._state = 'errored'
    this.endedOnARefusedLogin = said.loginRefused === true
    this.endedOnARefusedKey = said.loginRefused === true && said.onAKey === true
    this.terminalizeErrored(this.takeTurn(), said)
  }

  /**
   * Note a request that is about to await the user (122, from `WaitLease` 063/061 finding 7).
   *
   * ONE count across every broker an adapter holds: two open cards and one answered is still a
   * session waiting on the user, so the status publishes on the 0 → 1 and 1 → 0 EDGES rather than
   * on every call.
   */
  beginWait(): void {
    this.waits += 1
    this.sync()
  }

  /**
   * Note a request that has been answered.
   *
   * Below zero is a no-op rather than an error: an adapter that released twice would be a bug, but
   * a negative count would make the NEXT card fail to publish `waiting_permission` — trading a
   * duplicated status for a silently unblocked one, which is the worse of the two.
   */
  endWait(): void {
    if (this.waits === 0) return
    this.waits -= 1
    this.sync()
  }

  /**
   * Give the slot back **without** re-publishing — the exit taken when the session is shutting down
   * under an open card.
   *
   * This is not an optimization of {@link endWait}. Both adapters already returned early on that
   * path without emitting `working`, and they were right to: a session whose teardown has begun is
   * not about to make progress, and a `working` on the way out re-arms the stall watchdog and
   * rewrites the durable status of a session that is ending.
   *
   * ⚠️ **Not publishing is the ENTIRE point; the decrement is bookkeeping.** An earlier version of
   * this comment justified the decrement by saying a later card would otherwise find a count it
   * could never bring to zero — and that reason is false (063 review). It is only ever reached when
   * the handle's `isShuttingDown` is true, that flag is monotonic, and `RequestBroker` refuses every
   * reservation while it holds. The decrement stays because {@link waiting} is read by tests and by
   * the next person to open this file, and a counter that stops matching reality is a trap even when
   * nothing currently trips on it — which is also why "fixing" it with an {@link endWait} here is
   * the one thing that must not happen.
   */
  abandonWait(): void {
    if (this.waits > 0) this.waits -= 1
  }

  /**
   * Detach the active turn so nothing can read it as still live.
   *
   * ⛔ **It deliberately does NOT clear the wait count, and an earlier version of this fix did.**
   * The reasoning for clearing it was that a turn which has ended is not waiting on anybody, so the
   * contract's *"a non-interrupted terminal turn is immediately followed by status:idle"* could be
   * kept verbatim. Two reviewers measured what that actually produced, through the real Claude
   * adapter: a turn with card A open, a provider `result` arriving while A is still pending, then
   * card B, then the user answering A —
   *
   * ```
   * working → waiting_permission → idle → waiting_permission → idle
   *                                 ^                            ^
   *                        card A still open            card B still open
   * ```
   *
   * — and `RuntimeHost` flushes the queued message on exactly that event. So clearing the count
   * published *"nothing is waiting on you"* twice while a card sat unanswered on screen, and sent a
   * queued message past it. That is 061 finding 7 / 063's whole subject, reintroduced by a line
   * written to protect a sentence.
   *
   * The count now survives the turn, so a card open at a terminal keeps the session on
   * `waiting_permission` and the `idle` arrives when the card is answered — which is later, and
   * true. It also closes a hole 077 believed it had already closed: its door #1 says *"none is
   * emitted while a card is open"*, and until now that was measurably false.
   */
  private takeTurn(): TrackedTurn | null {
    const turn = this.turn
    this.turn = null
    return turn
  }

  /**
   * The terminal half both fatal paths share: at most one terminal `turn`, then `errored`.
   *
   * ⚑ **720 · R71: the word is this machine's**, marked — no provider ended this turn. After a Cancel
   * (the latch) it is `interrupted`: *"a fault after it is not the provider's word alone."*
   */
  private terminalizeErrored(
    endedTurn: TrackedTurn | null,
    /** ⚑ **F076** — said on a `failed` turn only: an asked stop is the turn's word, as it was. */
    said: RefusedLoginSaid = {},
  ): void {
    if (endedTurn) {
      this.say({
        type: 'turn',
        state: endedTurn.interruptRequested ? 'interrupted' : 'failed',
        wordOf: 'this-app',
        ...(!endedTurn.interruptRequested && said.loginRefused === true
          ? { loginRefused: true }
          : {}),
        ...(!endedTurn.interruptRequested && this.endedOnARefusedKey ? { onAKey: true } : {}),
        ...endingMarksOf(endedTurn),
      })
    } else if (this.unbidden) {
      // 🔴 **F080** — a burst the fault ended ends as a turn too, as a turn would: `interrupted`
      // when a stop was asked of it first.
      const stopAsked = this.endBurst()
      this.say({
        type: 'turn',
        state: stopAsked ? 'interrupted' : 'failed',
        wordOf: 'this-app',
        startedBy: 'the-provider',
        ...(!stopAsked && said.loginRefused === true ? { loginRefused: true } : {}),
        ...(!stopAsked && this.endedOnARefusedKey ? { onAKey: true } : {}),
      })
    }
    this.sync()
  }

  /**
   * Enter `closing`: new sends/turns are rejected from here. Returns false if the
   * machine is already closing/terminal. The actual teardown (safe-reject, await
   * the provider wire) is 009's job — 008 only defines the state + guards.
   */
  beginClose(): boolean {
    if (this.isTerminal || this._state === 'closing') return false
    this._state = 'closing'
    return true
  }

  /**
   * Emit the sole terminal `session:'ended'` + `status:'ended'` and freeze.
   * No-op if already `closed`; an `errored` session stays errored (no `ended`).
   *
   * `ref` is `null` when the session never reached a validated provider ref
   * (011: closing before Claude's first-turn init, or a Codex handshake that
   * never confirmed). In that case NO `session:'ended'` is emitted — there is no
   * honest ref to carry (`sessionEventSchema.ref` requires a real id) and a
   * never-started session has no resumable identity to announce as ended — only
   * `status:'ended'` + freeze. This replaces the old `sessionId:'unstarted'`
   * placeholder (007 P1-4). ⚠️ **722 · R79**: a Claude launch closed before its
   * init passes the id it launched with here — not synthesized, the CLI's own
   * transcript names it (`ClaudeSessionHandle.launch`).
   */
  closeSession(ref: SessionRef | null): void {
    if (this._state === 'closed' || this._state === 'errored') return
    this._state = 'closed'
    this.takeTurn()
    if (ref) this.say({ type: 'session', state: 'ended', ref })
    this.sync()
  }

  /**
   * The status these facts add up to, or `null` when there is nothing honest to say yet.
   *
   * ⛔ **The order of these three questions is the contract.** A terminal session outranks
   * everything — a closed conversation is not "waiting on you". A wait outranks a turn, because
   * that is the difference between the two silences the app must keep apart (045 §3): a session
   * blocked on an answer is one the user can end, and one merely working is not.
   *
   * ⚑ **And `working` now means "the provider's MAIN agent is doing something", which is a WIDER
   * fact than "a turn is open" (123)** — and, since D-040, a narrower one than "the provider is
   * doing something": a sub-agent left running in the background is the background level's to say,
   * never `working`. 042's ruling was that `idle` means *"we are no longer driving a turn"*, and
   * 122 kept it: through the four minutes of real work in `sess_6b4380fa` the app said `idle` and
   * was, by that definition, telling the truth. ⛔ It was still the wrong thing to say. A person
   * reading `Idle` beside a visibly working agent is not being told a subtle fact about turn
   * ownership; they are being told nothing is happening. The window was measured end to end by
   * `probe:out-of-turn` — 8.7 seconds of thinking, tool use and a whole reply, with the adapter
   * reporting `working → idle` and `handle.status()` answering `idle` throughout.
   *
   * ⚠️ **`working` here does NOT imply the user started it, and 081 has no facet that could say so.**
   * What it implies is that something is running and can be stopped — which is true only because
   * {@link forceEnd} made the Stop button work outside a turn. That is the whole justification for
   * reusing the word rather than inventing one, and if the button ever stops working the word
   * becomes a lie again.
   */
  private derive(): SessionStatus | null {
    if (this._state === 'errored') return 'errored'
    if (this._state === 'closed') return 'ended'
    // ⚠️ **A wait is announced even before the handshake.** A card that is genuinely open is a fact
    // about the USER, not about the provider ref, and refusing to say so would leave a session
    // silently blocked on a question. This is also the behaviour the old lease had, which published
    // on `acquire` whatever the state was.
    //
    // ⛔ **It is no longer the ONLY status that does, and this comment said it was until 137.** The
    // clause *"`working`/`idle` are deferred until `active`"* was already only half true when it was
    // written — the old `starting` branch returned `idle` outright — and 133 removed the other half.
    // `unstarted` is now the single state with nothing to say, two lines down.
    //
    // ⛔ **…except once teardown has begun, and that is not an optimization.** `beginClose()` is
    // followed by `settleRequests()`: every open card is safe-declined, so nothing is being asked
    // of anybody any more. Counting them here would hold a closing session on `waiting_permission`
    // through its own terminal — the contract's `turn → idle → ended` would lose its middle — and
    // it is the same judgement {@link abandonWait} already makes on the other side of the same
    // moment. It is `_state`, not the count, because the count's own continuations arrive later on
    // a microtask and the ordering must not depend on which of them wins.
    if (this.waits > 0 && this._state !== 'closing') return 'waiting_permission'
    if (this._state === 'unstarted') return null
    // ⛔ **`working` used to be withheld until the handshake, and 133 measured what that cost.**
    // The line that stood here was `if (this._state === 'starting') return this.turn ? null : 'idle'`,
    // justified by *"a status cannot precede the `session` event"* and by the observation that
    // Claude accepts its first turn before `system/init` lands and {@link sessionStarted}
    // **"publishes it a moment later"**. That last clause was the premise, and it was not measured.
    //
    // A manual `/compact` after reopen can leave a turn waiting a long time for its handshake. Its open-turn state must remain working throughout:
    //
    // ```
    // 1824  +0ms      user_turn   "/compact"        ← beginTurn(): a turn this machine HOLDS
    // 1825  +18ms     activity    compacting
    //       ────────── 91 seconds. derive() returns null, so nothing is published ──────────
    // 1828  +91,387ms session     resumed           ← sessionStarted(): the handshake, at last
    // 1829  +91,388ms status      working           ← the deferred `working`, after the work
    // 1831  +91,392ms turn        completed
    // ```
    //
    // ⚑ **A turn this machine holds is `working`, handshake or not.** That is 042's own definition
    // of the opposite word — `idle` means *"we are no longer driving a turn"* — and for ninety-one
    // seconds we were driving one. This is not 123's WIDENED sense of `working`; it is the narrow,
    // original one, withheld by a rule about ordering.
    //
    // ⚠️ **The ordering rule it overturns was already not held by the other two statuses.**
    // `waiting_permission` publishes before the handshake by the branch above, deliberately, and
    // `idle` published before it too — the old `starting` branch returned `'idle'` outright. Only
    // `working` was deferred. The reachable case that made the old branch return `idle` rather than
    // `null` is unchanged and still covered: `claudeResultOutcome` fires on ANY `result` frame, so a
    // turn can TERMINALIZE before the handshake, and the `idle` the queue flush waits on still
    // arrives — it is now preceded by the `working` that turn always deserved.
    //
    // ⛔ **What did NOT change, and 133 was sent here to consider changing it.** `activity` is still
    // not evidence: `compacting` does not promote anything, {@link noteProviderWork} still refuses
    // it (124), and 099's rule that a stale activity cannot promote an idle session is untouched.
    //
    // ⚠️ **The census says why that is the right way round, and it is a census rather than a
    // constant** — the line here used to hard-code "1 time", and 136 re-measured two eleven hours
    // later. What does not move is the SHAPE, and the shape is the argument: every `compacting` row
    // this ledger has ever held was inside an open turn, while the phases that really do arrive with
    // nothing claimed arrive that way in the hundreds (`thinking` 339 of 1,165 and `waiting` 95 of
    // 270, at 136's census on 13 Aug). The claim was never missing here. It was held.
    if (this.turn || this.unbidden) return 'working'
    // ⚑ **F080 — a burst a close cut ends on its own `turn` row** ({@link forceEnd}), so it keeps
    // `turn → idle → ended` as a turn does; until F080 it had no row and its status was its record.
    return 'idle'
  }

  /** Publish the derived status, and only when it is not the one already out there. */
  private sync(): void {
    const next = this.derive()
    if (next === null || next === this.published) return
    this.published = next
    this.say({
      type: 'status',
      state: next,
      // ⚑ **F076** — the terminal status of a session a refused login ended says so.
      ...(next === 'errored' && this.endedOnARefusedLogin ? { loginRefused: true } : {}),
      ...(next === 'errored' && this.endedOnARefusedKey ? { onAKey: true } : {}),
    })
  }
}
