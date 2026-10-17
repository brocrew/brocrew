/**
 * 🔴 **The whole of what a tool ANSWERED, for the one row that asked** (462) — the half a person
 * reads and the half a model parses, kept apart.
 *
 * ## ⛔ What `457` measured, and why a longer string is not the answer
 *
 * A tool row carries ONE summary and it is cut at `TOOL_SUMMARY_MAX` (200). `457` measured what
 * that costs through the app's own tools:
 *
 * | call | prose | structured payload |
 * |---|---|---|
 * | `list_projects`, six projects | **353 chars** | **3 691 chars** |
 * | `list_agents`, one agent | 31 chars | 169 chars |
 *
 * ⛔ **So 200 characters carries the covers-sentence and cuts every project line**, which is
 * `448`'s ruling correctly applied — the prose goes first precisely *because* it has to survive
 * the cut. 🔴 **And `457` closed the door on raising the bound with numbers**: a bound large enough
 * to carry the payload *"puts a 4 KB blob on every tool row in the transcript, writes it to the
 * ledger, and clones it across IPC for the life of the session — and it still is not readable."*
 *
 * ⚑ **So the bound stays at 200 and this is a SECOND place**, read on demand by whoever is showing
 * the row, exactly as `300`'s command tail is. The summary answers *what happened*; this answers
 * *what it said*.
 *
 * ## ⛔ Why this is a ring the adapter holds, and not a field on the event
 *
 * `command-output.ts` argues this for a tail and every clause of it survives the move to an answer:
 * **every `RuntimeEvent` is recorded**, so a payload on `tool_result` is a payload in the ledger of
 * every conversation that ever called a tool, and one cloned across IPC for the life of the
 * session. ⚠️ That is the shape `457` priced and refused; putting the same bytes on a neighbouring
 * field would be paying the price it refused while claiming to have avoided it.
 *
 * ## ⚠️ Which way this fails, and it is the opposite way from a tail
 *
 * ⛔ **A tail keeps the END and this keeps the BEGINNING.** `CommandTails` slices off the front
 * because the last thing a command printed is the thing a person is watching for. A tool answer is
 * not a stream: it is a document whose first sentence is the one `448` ordered first so it would
 * survive a cut, and whose payload opens with the fields that say what the rest of it is. ⚑ Cutting
 * an answer's head to keep its tail would throw away the half this exists to show.
 *
 * ⚠️ **And the cut is COUNTED, never silent** — `092`'s rule, the same way the tail states it.
 *
 * ## 🔴 What it does NOT promise
 *
 * ⛔ **Nothing here is durable.** This is memory held by a live adapter: a conversation reopened
 * from the ledger has no session holding anything, and {@link ToolAnswers.read} answers `null`.
 * ⚠️ That is a real hole and the surface DRAWS it rather than showing an empty panel — see
 * `renderer/src/lib/tool-answer.ts`, where the four different silences are one sentence each.
 */

/**
 * ⛔ **How much of ONE part of an answer is kept, in characters.**
 *
 * Use a 16,000-character part limit with headroom above observed app tool answers, so ordinary larger-workspace payloads can remain whole.
 *
 * ⛔ **And it is deliberately BELOW the largest thing ever seen on this wire** — `327` measured a
 * real MCP result come back as a single 90 047-character text block. ⚑ A ceiling raised to fit that
 * would be `457`'s own refusal restated: memory held, for the life of a session, against a panel
 * nobody may open. **The answer to a 90 000-character receipt is its first sixteen thousand
 * characters and a count of what was cut** — which is a true thing to show, where a ceiling chosen
 * to make the count zero is a cost paid by every conversation to avoid one sentence.
 */
export const MAX_TOOL_ANSWER_PART = 16_000

/**
 * ⛔ **How many parts of one answer are kept.**
 *
 * App tools emit one prose part. Historical and external receipts may contain more;
 * dropped parts are counted so the retained answer does not look complete.
 */
export const MAX_TOOL_ANSWER_PARTS = 8

/**
 * ⛔ **How many answers one session holds at once.**
 *
 * ⚠️ **Smaller than `MAX_COMMAND_TAILS`'s thirty-two, and the unit is bigger.** A tail is
 * 8 000 characters of one command; an answer is up to {@link MAX_TOOL_ANSWER_PART} × the parts it
 * carried. Twenty-four is a long turn's worth of tool calls and it bounds a session's hold at a
 * few megabytes in the worst case nothing has ever produced.
 *
 * ⚠️ **Least-recently-WRITTEN, not least-recently-read** — `CommandTails`' own rule, and for a
 * reason of its own here: a person scrolls back to an old row and opens it, and evicting by reads
 * would then throw away the answer of the call that just landed.
 */
export const MAX_TOOL_ANSWERS = 24

/** One piece of what a tool answered, as much of it as this app is holding. */
export interface ToolAnswerPart {
  /** The first {@link MAX_TOOL_ANSWER_PART} characters of this part. */
  readonly text: string
  /**
   * Characters cut off the END of this part. `0` normally.
   *
   * ⛔ **A COUNT, never an ellipsis** (092): a `…` the renderer draws cannot be told from one the
   * tool wrote, and says nothing about how much is behind it.
   */
  readonly dropped: number
}

/**
 * Receipt parts stay in provider order. App tools return one prose part; other receipts can carry
 * several. This records receipts; forwarding to a model request is measured separately.
 */
export interface ToolAnswer {
  readonly parts: readonly ToolAnswerPart[]
  /**
   * Parts past {@link MAX_TOOL_ANSWER_PARTS} that this app did not keep. `0` normally, and never
   * inferred — it is the count of what arrived minus the count of what is here.
   */
  readonly partsDropped: number
}

/**
 * **One session's tool answers** — a bounded hold per call, kept by the adapter that received them.
 *
 * ⚠️ **A class rather than a `Map`, for `CommandTails`' reason**: two of the three rules are
 * about eviction and bounding, and a bare map leaves every caller to remember them.
 */
export class ToolAnswers {
  /**
   * Insertion order is the eviction order, which is what `Map` already promises — and `set` after
   * `delete` is how a re-written key moves to the back. See {@link MAX_TOOL_ANSWERS}.
   */
  private readonly answers = new Map<string, ToolAnswer>()

  /**
   * Keep what one call answered.
   *
   * ⛔ **It REPLACES rather than appends**, which is the opposite of `CommandTails.write` and
   * is the difference between a stream and a receipt: a tool answers once, and a second receipt for
   * the same id is a correction rather than a continuation.
   *
   * ⚠️ **Sliced by CODE POINT**, not by UTF-16 unit — `251`'s lesson on the registry row, and it
   * matters more here than on a tail because an answer is JSON a person may copy: a cut mid-surrogate
   * puts `�` inside a string value.
   *
   * ⚠️ **An empty `id` is the only thing refused.** Zero parts is written, not skipped — see
   * {@link ToolAnswer}.
   */
  write(id: string, parts: readonly string[]): void {
    if (id === '') return
    // Re-inserted rather than mutated in place, so the key moves to the back of the eviction order.
    this.answers.delete(id)
    const kept = parts.slice(0, MAX_TOOL_ANSWER_PARTS).map((text) => {
      const points = [...text]
      const over = Math.max(0, points.length - MAX_TOOL_ANSWER_PART)
      return {
        text: over === 0 ? text : points.slice(0, MAX_TOOL_ANSWER_PART).join(''),
        dropped: over,
      }
    })
    this.answers.set(id, {
      parts: kept,
      partsDropped: Math.max(0, parts.length - kept.length),
    })
    this.evict()
  }

  /** What this app is holding for that call, or `null` — see {@link ToolAnswer}. */
  read(id: string): ToolAnswer | null {
    return this.answers.get(id) ?? null
  }

  /** ⚠️ Oldest WRITE first, which is what `Map` iteration order gives and `write`'s delete keeps. */
  private evict(): void {
    while (this.answers.size > MAX_TOOL_ANSWERS) {
      const oldest = this.answers.keys().next()
      if (oldest.done === true) return
      this.answers.delete(oldest.value)
    }
  }
}
