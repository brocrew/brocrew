/**
 * Keep command output deltas in a bounded adapter buffer for on-demand reads. The tool_result
 * holds the durable output, so individual deltas do not need ledger rows or replay.
 */

/** Bound each command’s live tail and count any discarded output. */
export const MAX_COMMAND_TAIL = 8_000

/** Evict by last write so reading an old tail cannot move it ahead of active output. */
export const MAX_COMMAND_TAILS = 32

/** An empty tail has held no output. A null read means no tail was retained for that command. */
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
