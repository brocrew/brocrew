/**
 * 🔴 **The words for the press that gives a conversation back, and the one decision in front of it**
 * (523 — `519` item 3, HO-045 §1).
 *
 * ## ⛔ What this file is
 *
 * ⚑ **`taking-over.ts` read backwards.** That file holds the words for *"Take it over and open it"*;
 * this one holds the words for undoing it. ⚠️ **Nothing here knows about the store, the bridge or the
 * host** — it is words and one predicate — so it can be read by a test with no renderer, which is the
 * rule `taking-over.ts` states.
 *
 * ## 🔴 Why the press is labelled as the INVERSE of the press that got the person here
 *
 * ⛔ **Q1 of this dispatch: a Release that looks like a Close is the defect with an extra button.**
 * `520` renamed the claimed pane's `Close` to *End conversation* and put a confirmation in front of
 * it, because `519` F2 measured that *"window close and pane Close are opposite operations for a
 * claimed agent-born child"* and nothing on screen said so. ⚑ **So this control is not named against
 * that one; it is named against the press it undoes.** A person who pressed *Take it over and open
 * it* reads {@link HAND_IT_BACK} as its opposite without being taught anything, and neither one is a
 * word about ending.
 *
 * ⚑ **D-017b · the End press is gone** — nothing in the window ends a conversation, and no press on
 * the bar says *end*. ⛔ **This one still asks once and never twice**: a confirmation in front of a
 * REVERSIBLE act teaches a person the act weighs what an irreversible one does. Handing back is
 * undone by taking it again.
 *
 * ## ⚠️ Why this is its own module
 *
 * ⛔ **The rule being kept is *a surface spells none of these words*, not *one file per pane*.**
 * `taking-over.ts` is the precedent, one gesture over: it holds the words for taking a conversation
 * over and is read by the rail, the person's queue and the project room — three surfaces, one
 * gesture, one module. ⚑ This file is that gesture's inverse, so it sits beside it.
 *
 * ## ⚠️ Nothing is said beside the press (2026-10-01)
 *
 * Keep the header height stable without the extra explanatory line. After the press, {@link handedBackSays} still describes a released conversation's open question from the host's report.
 */

import type { ReleasedSession } from '../../../shared/runtime-ipc'

/**
 * 🔴 **What the press says it will do** — the inverse of a press that took a conversation over.
 *
 * ⛔ **Not *Release*, and not *Stop watching*.** *Release* is this app's word for three unrelated
 * mechanisms already — a plan-mode release, a history window's tail, a credential home — and none of
 * them is this. ⚠️ *Stop watching* describes what the person stops doing and hides what they give up:
 * after this press they can no longer send, answer, interrupt or change the mode, and a word about
 * watching would make that a surprise. ⚑ **The conversation is the object of both presses**, which is
 * what makes the pair legible: it was taken over, and it is handed back.
 */
export const HAND_IT_BACK = 'Hand it back'

/** What a pane draws for this gesture, or `null` for a conversation that has nothing to hand back. */
export interface HandBackOffer {
  /** The press — {@link HAND_IT_BACK}. */
  readonly action: string
}

/**
 * 🔴 **Whether this conversation is one a person can hand back.**
 *
 * ⛔ **`null` is the ABSENT arm** (Q3) — a pane with nothing to offer offers nothing, instead of a
 * disabled control explaining itself. ⚠️ **A conversation a person
 * started has no prior state to return it to**: its slot was born owned, `closeSessionsForOwner`
 * closes it rather than releasing it, and handing it back would leave a provider running for a
 * surface that is still there — which is `062`'s defect asked for on purpose. ⚑ So the control is
 * absent there, and the HOST refuses the same call with `started-here` if anything sends it anyway.
 *
 * ⛔ **It reads `mayHandItBack` and does not recompute it.** The field is
 * `RuntimeHost.mayHandBack`'s own answer, carried on the hand-over; a second derivation here — even
 * the obvious `startedWithoutAWindow && heldHere` — would be `169` §1's two spellings of one rule,
 * and the half that drifts is always the one that decides whether a person sees a button.
 *
 * ⚠️ **`startedWithoutAWindow` is deliberately NOT consulted**, even though it is the reason the
 * answer is what it is. The decision is one field.
 *
 * ⚠️ `null` is a header with no conversation under it (the launcher renders one), and it answers
 * `null` for the same reason a conversation a person started does.
 */
export function handBackOffer(
  session: { readonly mayHandItBack: boolean } | null,
): HandBackOffer | null {
  if (session === null || !session.mayHandItBack) return null
  return { action: HAND_IT_BACK }
}

/**
 * 🔴 **What the person is told AFTER the press, computed from what the host reported** (standing
 * rule 18, and `a-report-must-be-computed-from-the-outcome`).
 *
 * ⛔ **Every word of this comes from {@link ReleasedSession} and none of it from the request.** The
 * pane could say *"handed back"* the moment its call resolved; what it says instead is the word the
 * host measured off the slot map after the write, so an implementation that cleared no owner puts
 * *"it is still open in this window"* on screen rather than a cheerful confirmation of a write that
 * did not happen.
 *
 * ⚠️ **`in-a-window` is not unreachable and is not an error either** — it is the honest report of a
 * release that did not take, which is the only thing this function can say about one.
 */
export function handedBackSays(released: ReleasedSession): string {
  if (released.running !== 'unwatched') {
    return 'BroCrew did not hand this conversation back — it is still open in this window.'
  }
  // ⚑ **D-017b · the view stays on screen** (`SessionStore.release`), so the words say what this
  // window gave up and how to take it again — ⛔ never *not open in any window* about a conversation
  // the person is still looking at.
  return released.waitingForAHuman
    ? 'Handed back — this window no longer holds it, and its question cannot be answered until somebody takes it over. Send it a message or press its row to take it again.'
    : 'Handed back — this window no longer holds it. Send it a message or press its row to take it again.'
}
