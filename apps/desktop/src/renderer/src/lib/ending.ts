import type { TurnEnding } from '../../../shared/runtime-ipc'

/**
 * **How a conversation's last turn ended, in words** (222, from `220` finding 2).
 *
 * ## The report
 *
 * > *"Quit the whole app while a shell command is running. Reopen it. Look at the rail and Sessions
 * > BEFORE resuming anything."* — **No active row returned. Three closed threads were hidden, and
 * > all corresponding Sessions rows said `ended`, with no interrupted or unfinished distinction.
 * > Only after choosing Resume did the transcript reveal "did not finish" and "turn interrupted".**
 *
 * ⛔ **What it costs is that you have to open a conversation to find out whether it needs you** —
 * the exact inverse of `205`'s *"everything that needs you in one place"*.
 *
 * ## ⚠️ `ended` was never wrong. It was the only word.
 *
 * The status column answers *"is this conversation over"* and answers it correctly. It has never
 * answered *"did the work in it finish"*, and those are different questions with different actions
 * behind them. This file is the second answer, and it is a projection of one column —
 * `turn.end_reason` — which 045 gave five members precisely so this case could be recorded.
 *
 * Turn endings can be `completed`, `interrupted` or `unknown` even when session status has fewer distinct words. Preserve the ending separately.
 *
 * ## `219`'s standard, applied to a label
 *
 * `219` spent a dispatch on the rule that a refusal is a sentence a person can act on. The same
 * standard holds here: the {@link ENDING_WORD} is what a glance down a column reads, and the
 * {@link ENDING_SENTENCE} is the whole fact, on the hover and in the row that has room for it.
 * Neither is composed at a call site — a surface that wanted its own phrasing would be the second
 * vocabulary, and `099`/`064` are what that costs.
 *
 * ## ⛔ Why `completed` has a word too
 *
 * The first draft rendered nothing for a clean finish, which reads well and is not honest: a row
 * with no word would then mean *either* "it finished" *or* "we hold no closed turn for it", and a
 * reader cannot tell those apart. Absence is reserved for the second — a conversation the provider
 * has and we never ran or imported — so that saying nothing is itself a true statement.
 */

/** The glance — one or two words, beside the status. */
export const ENDING_WORD: Record<TurnEnding, string> = {
  completed: 'finished',
  failed: 'failed',
  /**
   * ⚑ The same word the transcript uses (`TURN_END_WORD.interrupted`, 085), so the list and the
   * conversation it opens cannot name one ending two ways — which is the drift `099` is about, one
   * level up from the status pill.
   */
  interrupted: 'interrupted',
  /**
   * ⛔ **No gesture on either shipped adapter produces this word** (246 §2, from `244`, which tried).
   *
   * `end_reason = 'ended'` has one writer — `appendTx`, when `status: ended | errored` lands on a
   * turn whose own ending was never announced — and `010` forbade that ordering on every adapter:
   * `close()` calls `forceEnd()` first, so the turn is already `interrupted` by the time the
   * terminal status arrives, and both fatal paths emit a terminal `turn` before `errored`.
   * `conformance.test.ts` asserts it on Fake, Claude and Codex; `cut-off.test.ts` connects that
   * ordering to this word and shows the negative control that reaches it.
   *
   * ⚠️ **Kept, and 246 §2's response says why**: it is the honest name for a state the ledger can
   * still be handed — an imported ledger, a future adapter, or the day the `forceEnd` above is
   * deleted — and every alternative is a worse claim (`unknown` says we never saw the ending, when
   * on this path we did). ⚑ Measured across two real ledgers, 76 closed turns, zero of them this.
   */
  ended: 'cut off',
  unknown: 'unknown',
}

/**
 * The whole fact, as a sentence.
 *
 * ⚠️ **`unknown` says what we did not see, never what did not happen.** *"It never finished"* would
 * be a claim about a provider we stopped watching; 208 H3 is the review finding that this app had
 * already made that claim once, in `writerStopped`, and 222 §3 is where it stopped making it. The
 * turn produced no ending in our ledger — that is all we know, and all this says.
 */
export const ENDING_SENTENCE: Record<TurnEnding, string> = {
  completed: 'its last turn finished',
  failed: 'its last turn failed',
  /**
   * 🔴 **`222` shipped *"you stopped its last turn before it finished"* and it was false** (395 §5).
   *
   * ⛔ **Four gestures write this value and only one of them is *you*.** `close()` calls
   * `machine.forceEnd()` on both adapters, so closing a conversation mid-turn writes `interrupted`;
   * `end_agent` reached that same teardown until D-017 removed it, so a PARENT AGENT ending a busy
   * child wrote it too, in older ledgers;
   * `terminalizeErrored` writes it when a fatal error lands on a turn an interrupt was requested
   * for, so a provider that died mid-Stop wrote it; and a permission answered `cancel` writes it in
   * the provider's own word (a Cancel asks the provider to stop on every door since `709`/`720`,
   * and only a stream that dies after it makes it the machine's). ⚑ *An escalation guarantee is only
   * as wide as what gets denied* — and a sentence that names an actor is only as true as the
   * narrowest gesture that reaches it.
   *
   * ⚠️ **725 · R71 — the transcript can now tell the machine's endings apart, and this row cannot.**
   * The first three (and a Cancel whose stream then died) carry `wordOf: 'this-app'` on their `turn`
   * EVENT since `720` wherever the machine's own ending wrote it — ⚠️ a Codex provider that answers
   * during a close's interrupt ack writes its own, unmarked — and the transcript says *this app's
   * word, not the provider's* since `725`;
   * but the mark is on the event and not on `turn.end_reason`, which is the one column this row is
   * built from — so it stays passive (a GAP for main, `725`).
   *
   * ⚠️ **Passive, and the actor is NOT interpolated here.** `work_interrupted` (395) records who
   * asked, but this row is built from `turn.end_reason` alone — one column, read at list time — and
   * plumbing the asker into the Sessions list would be a second derivation for a surface that
   * already tells an interruption from a fault. ⛔ **What that surface could not do was tell the
   * truth about the actor**, and that is what this line fixes; the actor is named where the ledger
   * for it is open — the transcript, and `AgentCard.lastTurn`.
   */
  interrupted: 'its last turn was stopped before it finished',
  ended: 'it stopped while a turn was still running',
  unknown: 'a turn was still running, and this app never saw how it ended',
}

/**
 * Whether this ending is one a person may want to pick back up.
 *
 * ⛔ **`completed` is the only one that is not.** A failed turn, an interrupted one, one cut off by
 * a close and one whose ending nobody saw are four different stories with the same consequence:
 * work was left where it stopped. `220`'s three hidden threads were all of this kind.
 *
 * ⚠️ **A type predicate rather than a `boolean`**, so a caller that indexes a word table behind this
 * guard is narrowed by the compiler instead of by a cast: a future edit that let `null` through here
 * would return `undefined` from `ENDING_WORD`/`ENDING_SENTENCE` and render an empty string, which no
 * assertion about a WORD would notice. With the predicate it does not compile.
 */
export function endedUnfinished(ending: TurnEnding | null): ending is TurnEnding {
  return ending !== null && ending !== 'completed'
}

/**
 * **What the Sessions row says beside the status**, or null when we hold no closed turn for it.
 *
 * Null rather than a placeholder: `086` forbids inventing a fact for a row that has none, and a row
 * the provider holds and we have never run has no turn of ours to have ended.
 */
export function endingLabel(ending: TurnEnding | null): { word: string; sentence: string } | null {
  return ending === null ? null : { word: ENDING_WORD[ending], sentence: ENDING_SENTENCE[ending] }
}
