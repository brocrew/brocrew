/**
 * Track output from a command while it is running.
 *
 * ## ⛔ What the wire actually gives us, measured
 *
 * `smoke/command-output-probe.smoke.ts`, bundled `codex-cli 0.146.0`, three threads:
 *
 * | question | the answer, measured |
 * |---|---|
 * | does a running command stream its output? | ⚑ **yes on Codex** — `item/commandExecution/outputDelta`, **11 frames** for a 12-tick command, one a second, `"tick-2\n"` |
 * | is the delta's `itemId` the CARD's id? | ⚑ **yes** — `exec-25999b84-…` on the delta and on `tool_call.id`, same run |
 * | does it keep streaming after the turn ends? | ⚑ **yes** — **39 frames after `turn/completed`** for a detached command |
 * | does BroBot see any of it today? | ⛔ **none of it.** In-turn frames classify as `unknown{activity}` and render as nothing; post-turn frames are dropped by `TURN_SCOPED_METHODS` before the normalizer runs |
 * | and on Claude? | ⛔ **nothing carries it.** 45 frames over a 12 s command and the output arrives once, in the `tool_result` |
 *
 * ⚠️ **`300` §3 named `command/exec/outputDelta` and `process/outputDelta` and both are the wrong
 * channel** — their own generated docblocks say they are emitted for a streaming `command/exec` /
 * `process/spawn` request, keyed by a *"client-supplied, connection-scoped"* id. Those are processes
 * the CLIENT spawns; this app spawns none, and neither method appeared in any run.
 *
 * ## ⛔ Why this is a RING the adapter holds, and not an event
 *
 * ⚠️ **Every `RuntimeEvent` is recorded.** `RuntimeHost.deliver` takes an ordinal and appends before
 * it sends, deliberately — *"recording is what makes the session survive the process"*. A delta
 * stream on that path would put one durable row per line into the ledger of every conversation that
 * ever ran a chatty command, which is `052`'s ceiling met head-on, and a replay would then render a
 * live-looking tail for a process that died months ago — `222`'s stale indicator by a new road.
 *
 * ⚑ **And it would be redundant where it is not harmful.** When a command finishes, its `tool_result`
 * carries the output and IS the record; the tail is a claim about NOW, which is the same thing
 * `background_work.running` is and the reason `247` made that a level rather than a log.
 *
 * ⛔ **So the tail is READ, on demand, by the surface that is showing the command** — the shape `296`
 * established for a live child's transcript, and for the same reason: it costs nothing while nobody
 * is looking, and there is exactly one copy for a second surface to disagree with.
 *
 * ## ⚠️ Which way this fails
 *
 * Toward showing LESS than the command printed, and saying so. The ring keeps the last
 * {@link MAX_COMMAND_TAIL} characters and counts what it dropped; {@link MAX_COMMAND_TAILS} bounds
 * how many commands are held at once. A tail that has been evicted reads as absent — *"this app is
 * not holding it"* — which is a different sentence from *"the command printed nothing"*, and
 * {@link CommandTail} keeps them apart.
 */

/**
 * ⛔ **How much of one command's output is kept, in characters.**
 *
 * ⚠️ **A tail, not a log, and the number is chosen from what a person reads rather than from what a
 * command produces.** Eight thousand characters is around a hundred wrapped lines — more than the
 * card can show at once and enough that scrolling back inside it is worth doing. Anything larger
 * would be storing a build log in memory for a panel nobody may open.
 *
 * ⚑ `092`'s rule holds: the cut is COUNTED, never silent — see {@link CommandTail.dropped}.
 */
export const MAX_COMMAND_TAIL = 8_000

/**
 * ⛔ **How many commands' tails one session holds at once.**
 *
 * ⚠️ **Bounded because a turn can run dozens of commands and a session hundreds**, and a map that
 * grew with the conversation would be `052`'s blow-up with a smaller unit. Thirty-two is far past
 * what can be running simultaneously — the measured live case is one — so eviction reaches only
 * commands that finished long ago, whose `tool_result` is the record anyway.
 *
 * ⚠️ **Least-recently-WRITTEN, not least-recently-read.** A reader is a person opening a card; a
 * writer is a process still producing. Evicting by reads would throw away the tail of the one
 * command still running the moment somebody looked at an older one.
 */
export const MAX_COMMAND_TAILS = 32

/**
 * What one command has printed, as much of it as this app is holding.
 *
 * ⚠️ **`null` from {@link CommandTails.read} and an empty `text` are different facts and must stay
 * that way.** `null` is *"this app is not holding a tail for that command"* — it was never streamed,
 * or it has been evicted. An empty `text` is *"it is streaming and has printed nothing yet"*, which
 * is what a command that is thinking looks like. `074`'s rule: saying nothing arrived is a different
 * fact from saying what did.
 */
export interface CommandTail {
  /** The last {@link MAX_COMMAND_TAIL} characters the command printed, oldest first. */
  readonly text: string
  /**
   * Characters this ring has already discarded off the front. `0` normally.
   *
   * ⛔ **A COUNT, never an ellipsis** (092, and `background-work.ts`'s `cutNote` one surface over):
   * a `…` the renderer draws cannot be told from one the command printed, and says nothing about how
   * much is behind it.
   */
  readonly dropped: number
  /**
   * ⛔ **The provider has said this command is over**, so the tail will not grow again.
   *
   * ⚠️ It is set by the adapter that owns the ring and never inferred from silence. A command that
   * prints nothing for a minute is not finished; it is a command printing nothing.
   */
  readonly closed: boolean
}

/**
 * **One session's live command tails** — a bounded ring per command, held by the adapter.
 *
 * ⚠️ **A class rather than a `Map`, because two of the three rules are about eviction** and a bare
 * map would leave each caller to remember them. It holds no provider state and touches no wire: it
 * is a buffer with a written-down ceiling.
 */
export class CommandTails {
  /**
   * Insertion order is the eviction order, which is what `Map` already promises — and `set` after
   * `delete` is how a re-written key moves to the back. See {@link MAX_COMMAND_TAILS}.
   */
  private readonly tails = new Map<string, { text: string; dropped: number; closed: boolean }>()

  /**
   * Add what a command just printed.
   *
   * ⚠️ **Sliced by CODE POINT**, not by UTF-16 unit: a tail cut mid-surrogate renders `�` on
   * the one surface whose whole job is showing what a command really printed. `251` learned this on
   * the registry row and the rule is the same here.
   */
  write(id: string, delta: string): void {
    if (id === '' || delta === '') return
    const held = this.tails.get(id)
    // Re-inserted rather than mutated in place, so the key moves to the back of the eviction order.
    if (held !== undefined) this.tails.delete(id)
    const joined = (held?.text ?? '') + delta
    const points = [...joined]
    const over = Math.max(0, points.length - MAX_COMMAND_TAIL)
    this.tails.set(id, {
      text: over === 0 ? joined : points.slice(over).join(''),
      dropped: (held?.dropped ?? 0) + over,
      // A delta for a command we were told had ended reopens it: the provider is still producing, so
      // "closed" was wrong. Nothing observed does this; leaving it latched would be a claim.
      closed: false,
    })
    this.evict()
  }

  /**
   * ⛔ **The provider says this command is over.** Kept rather than dropped: the tail is the last
   * thing a person saw and a card that emptied the moment the work ended would take the answer away
   * at exactly the moment it was wanted.
   *
   * ⚠️ **It does not CREATE a ring.** An ending for a command that never streamed leaves nothing
   * behind, so `read` goes on answering `null` — *"this app is not holding a tail"* — instead of
   * inventing an empty one that would read as *"it printed nothing"*.
   */
  close(id: string): void {
    const held = this.tails.get(id)
    if (held === undefined) return
    held.closed = true
  }

  /** What this app is holding for that command, or `null` — see {@link CommandTail}. */
  read(id: string): CommandTail | null {
    const held = this.tails.get(id)
    return held === undefined
      ? null
      : { text: held.text, dropped: held.dropped, closed: held.closed }
  }

  /** Let a session's buffers go at teardown. */
  clear(): void {
    this.tails.clear()
  }

  /** How many commands are held — for a test, and for a bound that can be asserted. */
  get size(): number {
    return this.tails.size
  }

  private evict(): void {
    while (this.tails.size > MAX_COMMAND_TAILS) {
      const oldest = this.tails.keys().next()
      if (oldest.done === true) return
      this.tails.delete(oldest.value)
    }
  }
}
