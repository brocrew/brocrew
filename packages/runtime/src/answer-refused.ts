/**
 * Why an answer to a card was refused — as a value, not as prose (085).
 *
 * ## The defect this exists to close
 *
 * Answering an already-settled question can produce a raw provider refusal such as:
 *
 * > `user-input request number:0 is not pending (already answered, settled, or unknown)`
 *
 * Every word of that is true and every word of it is written for us. `number:0` is 045's
 * type-preserved request key — load-bearing, so that `string:7` can never collapse into numeric
 * `7` — and it has no meaning whatsoever to the person who pressed a button.
 *
 * The message was not the mistake; **carrying the reason ONLY as a message was.** These throws are
 * the adapters' diagnostics: they name the id, the phase and the offered set, and that is exactly
 * what belongs in a log when the question is "which of the four ways to settle a request happened
 * here". So the text stays, verbatim, on `.message`. What is added is a {@link AnswerRefusal} the
 * app can switch on without reading English — because the alternative, matching the prose at the
 * boundary, makes every one of those diagnostics load-bearing UI copy, and the first adapter to
 * reword one would silently start showing it to the user again.
 *
 * ⚠️ **Thrown by the adapters, translated by the app, never by the renderer.** The runtime is a
 * library and does not know what a person is looking at; the host is the one boundary where both
 * facts are in hand — the raw text to log and the reason to say. Both live in the SAME process, so
 * the discriminant survives; Electron's `ipcMain.handle` serialises a rejection to a STRING across
 * to the renderer — `toString()`, `${name}: ${message}`, measured on 43.2.0 (675) — so no field
 * survives the crossing, which is precisely why the translation cannot wait until it gets there.
 */

/**
 * The four ways answering a card can be refused, and they are genuinely different events.
 *
 *  - `not-pending` — the request is gone: answered, settled by teardown, withdrawn by the provider,
 *    or from a session that has since been resumed (a new adapter has never heard of the id). **The
 *    user did nothing wrong**, and the honest sentence is about the question, not about them.
 *  - `not-offered` — the outcome is not one this request listed. That is a defect in OUR UI: a card
 *    drew a button the provider never offered. It must still not be shown as a request key, but it
 *    is not a stale card and must not be dressed as one.
 *  - `not-usable` — the request is still pending and the answer cannot be told to the provider:
 *    a question left unanswered, nothing chosen, or several chosen for a question that takes one
 *    (`answerToForward`). ⛔ **The card is still LIVE, and that is the whole difference** (142). The
 *    first two refusals are about a request that has gone; this one is about a gesture that has not
 *    happened yet, so the answer is refused BEFORE it takes the broker slot — nothing is written to
 *    the ledger, the question is still there, and the user can answer it again. It replaces the
 *    shape 139 shipped, where the answer was accepted, recorded as `Answered`, and denied to the
 *    provider a moment later by a continuation nobody could observe.
 *  - `not-kept` — 🔴 **740 · R99 (`736` F-6)** — an *always* answer this app must KEEP before it
 *    goes (Codex's approval of an MCP tool, `keepToolApproval`), and the keep failed. ⛔ **Live, like
 *    `not-usable`** — refused before the answer was sent, so nothing was granted and every other
 *    button on the card still works — ⚠️ **and not one of its causes**: until `740` it was
 *    `not-usable`, which the host words as the sentence about a question left blank.
 */
export type AnswerRefusal = 'not-pending' | 'not-offered' | 'not-usable' | 'not-kept'

/**
 * An adapter refusing to forward an answer, carrying its diagnostic AND its reason.
 *
 * `instanceof` is the check, and it works because the adapters and the host share one process.
 * A refusal that crosses a process boundary arrives as its `.message` alone and is no longer one
 * of these — which is the reason the host translates before that happens rather than after.
 */
export class AnswerRefused extends Error {
  constructor(
    /** Machine-readable, so nothing downstream has to read the prose. */
    readonly refusal: AnswerRefusal,
    /** The adapter's own diagnostic — the ONLY copy of the id, phase and offered set. */
    message: string,
  ) {
    super(message)
    this.name = 'AnswerRefused'
  }
}

/** Narrow an unknown caught value to a refusal we can name a reason for. */
export function answerRefusalOf(error: unknown): AnswerRefusal | null {
  return error instanceof AnswerRefused ? error.refusal : null
}
