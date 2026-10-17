import type { BackgroundWorkEnding } from '../../../shared/runtime-ipc'

/**
 * **Work that outlives the turn, in words** (248, from `247`'s facts and `245`'s Rank-1 gap).
 *
 * ## The report
 *
 * > ⛔ *"Rank 1 because it destroys the central promise of a conversation UI: that the transcript is
 * > a trustworthy account of what the agent is still doing. It can make closing the app, changing
 * > branches or starting dependent work unsafe."* — `245` §3
 *
 * `247` then measured that a model reaches the state unaided: Haiku and Sonnet both emitted
 * `"run_in_background": true` off a one-sentence request, and on 2 of 4 runs Haiku did it on a turn
 * that never asked. Measured against the **OS**, not the provider: the turn ended at 9 507 ms and
 * the command stamped its file at 36 137 ms. ⛔ **26 630 ms of a green, settled card.**
 *
 * ## ⚠️ `ok` was never wrong. The card had nothing to say beside it.
 *
 * The receipt answers *"did the provider succeed at what it was asked"* and answers it correctly —
 * the detachment really did work. It has never answered *"has the work finished"*, and those are
 * different questions with different actions behind them. This file is the second answer.
 *
 * ⚑ `247` put it in the event's own doc: *"rewriting `ok` to `false` would trade one lie for another
 * by calling a successful backgrounding a failure. What was missing is not a different `ok`; it is
 * the sentence beside it."*
 *
 * ## `222` §4's rules, applied to six more words
 *
 * `222` gave endings five words and set out what a word has to be. The same four rules hold here,
 * and each one changed something:
 *
 *  - **A word is held to `219`'s refusal standard** — a sentence a person can act on. The
 *    {@link BACKGROUND_WORD} is what a glance reads; the {@link BACKGROUND_SENTENCE} is the whole
 *    fact, on the hover.
 *  - **One vocabulary, no call-site phrasing.** The conversation's tool card, a sub-agent card's
 *    own rows, and the registry above the composer all read this file, so no surface can name one
 *    state its own way — `099`/`064` are what that costs.
 *  - **Reuse the transcript's own word.** `finished` is `ENDING_WORD.completed`; `failed` is
 *    `ENDING_WORD.failed`; *"ended, outcome not reported"* is `WorkflowEntry`'s `STATUS_WORD.unknown`
 *    verbatim, because it is the same fact about a different kind of run.
 *  - ⛔ **Do not add a word nothing can produce** (`246` §2, which found `cut off` unreachable after
 *    `222` shipped it). Every one of the six below has a named producer, and they are named here
 *    rather than assumed — see each entry.
 *
 * ## ⚠️ Which way this fails
 *
 * Toward forgetting. `background_work.running` is a LEVEL with REPLACE semantics and `247` carried
 * the SDK's own instruction with it: *"consumers … should replace their set with each payload rather
 * than pairing edges, so a missed bookend cannot wedge a stale running indicator."* A `system/init`
 * empties it. So the failure available to this surface is a row that disappears slightly early, not
 * one that says *"still running"* forever about a dead process — which is `222`'s stale indicator,
 * and the direction that would make every word here worthless.
 *
 * ## ⚑ D-017 · R11 — what a row is RUNNING lives in `shared/agent-state.ts`
 *
 * `backgroundWhat`, `inTheBackground`, `somethingRunning` and `BACKGROUND_COMMAND_CHARS` moved there
 * whole, so `main` names a conversation's background work in the words this window's rows and plate
 * use. What stays here is the window's own vocabulary for one piece of work: its state, its
 * sentence, and the notes a row draws beside a cut or a shortfall.
 */

/** How a piece of background work ended, as the adapter reported it — never re-derived here. */
export type BackgroundOutcome = BackgroundWorkEnding['outcome']

/**
 * The six states one piece of background work can be in on screen.
 *
 * ⚠️ `running` and `unfinished` are not outcomes and are deliberately not in
 * {@link BackgroundOutcome}: they are the absence of one, and `074`'s rule is that saying nothing
 * arrived is a different fact from saying what did.
 */
export type BackgroundState = 'running' | 'unfinished' | BackgroundOutcome

/** The glance — one or two words, on the card and in the registry. */
export const BACKGROUND_WORD: Record<BackgroundState, string> = {
  /**
   * ⛔ **Not `running…`, which is the tool row's own word for something else.** That one means *we
   * are waiting for this call to report back*; here the call HAS reported back — the receipt landed,
   * green and correct — and the work it describes is still going. Two facts, two words.
   *
   * Produced by every `tool_result` carrying `backgrounded: true`, and by every row the provider
   * names in `background_work.running`. Measured live on both models (`247` §1, and step `74`).
   */
  running: 'still running',
  /**
   * ⛔ **`ToolEntry`'s own word for the same fact, one axis over** (074) — *"we stopped watching
   * before this reported back"*, which is not an outcome and must never be rendered as one.
   *
   * Produced by `stopOpenToolCalls`: the conversation was closed, fatally errored, reopened from a
   * ledger, or is being read as a recording. The work died with the CLI child that started it and no
   * ending is coming, so *"still running"* would be `222`'s stale indicator arriving through the
   * store instead of through a missed bookend.
   */
  unfinished: 'did not finish',
  /** `ENDING_WORD.completed`'s word. Produced by `task_notification` / `task_updated` `completed`. */
  completed: 'finished',
  /** `ENDING_WORD.failed`'s word. Produced by the same two frames carrying `failed`. */
  failed: 'failed',
  /**
   * ⚑ **Three producers, and none is hypothetical.** The stop control this dispatch adds
   * (`stopBackgroundWork` → `Query.stopTask`, whose own doc promises *"a `task_notification` with
   * status 'stopped' will be emitted"*), and the model stopping its own work — `247` measured
   * `TaskStop` live in the 34-tool vocabulary, so the agent can reach it without us. ⚑ And since
   * Claude Code 2.1.285, a background command's own `timeout` (30 minutes unless the agent set one,
   * 2 hours at most), whose `stopped` notification *"says why"*.
   * `backgroundOutcome` maps `killed` here too, because `task_updated` spells the same event
   * differently from `task_notification`.
   */
  stopped: 'stopped',
  /**
   * ⛔ **`WorkflowEntry`'s word for the same fact**, and it is reachable rather than defensive.
   *
   * `task_notification` emits an ending for **any** status — unlike `task_updated`, which is gated
   * on the SDK's terminal set — so a notification carrying `paused`, an unrecognised word, or no
   * `status` field at all lands here. ⚠️ It says what we did not see, never what did not happen:
   * *"failed"* would be a verdict nobody reported, which is `074`'s rule and the one `222` §3 had to
   * take back out of `writerStopped`.
   */
  unknown: 'ended, outcome not reported',
}

/**
 * The whole fact, as a sentence — the hover on a row that has one piece of work to describe.
 *
 * ⚠️ **`running` says what the provider last told us, and says so.** The level is a claim about now
 * that only the provider can make; restating it as our own would be the app claiming a state nothing
 * can contradict, which is `106`'s live toggle in a different costume.
 *
 * ⛔ **None of these says "the turn is over", and the first draft of three of them did.** That reads
 * well and is not always true: the detachment happens mid-turn, and work can settle before the turn
 * it belongs to does — `247`'s own capture has a level payload at 5 150 ms on a turn that ran to
 * 9 507. The fact these sentences hold is about the RECEIPT, which is a moment they are all after;
 * `222` §4's rule is that a word may never over-claim, and a sentence is a word with more room to do
 * it in.
 */
export const BACKGROUND_SENTENCE: Record<BackgroundState, string> = {
  running:
    'the receipt said it started, not that it finished — the provider last said it is running',
  unfinished: 'the conversation running it is gone, so nothing will ever report how it ended',
  completed: 'it kept running after the receipt, and finished',
  failed: 'it kept running after the receipt, and failed',
  stopped: 'it was stopped before it finished — by you, by the agent, or by its time limit',
  unknown: 'it ended after the receipt, and the provider did not say how',
}

/**
 * What one piece of background work is doing, in one word.
 *
 * ⛔ **The outcome always wins, and `unfinished` is only ever consulted after it is found missing.**
 * That is `ToolEntry`'s own precedence rule, applied to the same question one axis over: *"the real
 * result still wins wherever there is one"*, so a `task_notification` that lands after a reopen
 * renders as the ending it is rather than as the sweep that preceded it.
 *
 * ⚠️ **`running` is the last resort and never a claim of ours.** Membership of the level set is a
 * statement about now that only the provider can make; the two facts above are ours, and they both
 * outrank it.
 */
export function backgroundState(work: {
  outcome?: BackgroundOutcome
  unfinished?: boolean
}): BackgroundState {
  if (work.outcome !== undefined) return work.outcome
  return work.unfinished === true ? 'unfinished' : 'running'
}

/**
 * ⛔ **What the registry says when it is UNDERSTATING what is running** (247's `dropped`).
 *
 * ⚠️ **Non-zero means rows the provider sent that this event does not carry** — past the 200
 * ceiling, or sent with no id at all, deliberately counted together. `092`'s rule is that a cap is
 * never silent, and `247` sharpened it for this event: *"a registry that quietly undercounts is
 * worse than none"*, because a list that looks complete is read as complete.
 *
 * It names the count and stops there. **Why** a row was dropped is not a fact this app holds — the
 * two reasons are counted together on purpose — and inventing one would be `039`'s failure.
 */
export function droppedNote(dropped: number): string {
  return dropped === 1
    ? 'and 1 more is running that this list cannot name'
    : `and ${dropped} more are running that this list cannot name`
}

/**
 * ⛔ **What the row says when it did not show all of it** (092's no-silent-cap rule).
 *
 * ⚠️ **`248`'s `.bg-what` was `text-overflow: ellipsis`, which is exactly the silent truncation that
 * rule forbids** — a `…` glyph the browser draws is indistinguishable from a `…` the command ends
 * with, and it says nothing about how much is missing. This is a COUNT, in the same shape as
 * {@link droppedNote} one field over, and the row wraps rather than clipping so the count is the only
 * thing hiding anything.
 *
 * ⚑ **It does not claim the rest is reachable, and the first draft did** — *"in full on the card
 * above"* is a sentence about a card that a released slab may no longer be holding (`carryForward`
 * keeps the registry across a release; it does not keep the items), and it would ALSO have been a
 * claim about a string the ledger may itself have cut at `TOOL_SUMMARY_MAX` and thrown away. The
 * `title` carries what this app holds, and this says only what it knows: how many characters of that
 * are not on the row.
 */
export function cutNote(cut: number): string {
  return cut === 1 ? '+1 more character' : `+${cut} more characters`
}
