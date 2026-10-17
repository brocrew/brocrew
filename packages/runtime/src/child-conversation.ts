/**
 * # A child you can talk to (296) — the vocabulary, and the ruling that shapes it
 *
 * `112` gave a sub-agent a viewer and `115` gave a Codex child its own rollout. Both are a bounded
 * SNAPSHOT: opened once, read once, and read-only by construction. This module is the two facts a
 * conversation needs that a snapshot does not — **is the child able to hear me**, and **what
 * happened when I spoke**.
 *
 * ## ⛔ The ruling, and it comes from a measurement rather than a preference
 *
 * `295` sent `turn/start` to a Codex child that was still working. The provider ACCEPTED it and
 * answered with a turn id — and then did none of the things that id implied:
 *
 * ```text
 * @55  14.888 s  turn/start on the active child
 * @57  14.889 s  success, proposed turn …06d7        ← this id appears in 1 of 167 frames. Only here.
 * @75  31.400 s  the new message lands on the EXISTING turn …853b
 * @85  32.843 s  that turn answers
 * @90  32.893 s  …and COMPLETES
 * @132 40.560 s  the `sleep 20` it was running finally finishes — 7.667 s after "completed"
 * ```
 *
 * ⛔ **So the message did not open a turn; it joined one, ended it early, and left the child's own
 * command running past its reported completion.** A composer that called that *"sent"* would be
 * making three false statements at once, and the third one is about somebody else's work.
 *
 * ⚑ **This build REFUSES while the child is working**, which is the first of the two answers §1
 * permits, and it refuses in the adapter rather than in the button — see
 * {@link ChildInputOutcome}. `277` and `222` are the precedents: a provider that reports one thing
 * and does another is not a reason to repeat its wording.
 *
 * ## ⚠️ Two methods, not one, and that is the same finding applied to our own API
 *
 * The defect above IS *"two gestures wearing one method"*. So {@link ChildThreadState} is read by
 * one call and input is sent by another, rather than one `childThread(id, text?)` that means
 * different things depending on an argument. A single entry point would have been smaller and would
 * have reproduced, inside this repo, the exact shape the dispatch was written about.
 */

/**
 * What the provider says about one child, right now.
 *
 * ⚠️ **Every field is the PROVIDER's answer, not ours.** `295` measured Codex renaming a child it
 * was asked to call `probechild` to `Plato`, so {@link nickname} is read back rather than assumed,
 * and nothing in this app keys on a name it chose.
 */
export interface ChildThreadState {
  /**
   * ⛔ **`working` is the one that changes what the app may do**, and the four words are kept
   * distinct because they are four different reasons a composer is dark.
   *
   * - `working` — a turn is in progress. Input is refused (see the module note).
   * - `idle` — loaded, and a message would be a real new turn.
   * - `unloaded` — the provider knows this thread and does not have it open. Codex answers
   *   `{"type":"notLoaded"}` here and reports `canAcceptDirectInput: null`, which its own type
   *   documents as *"the capability is unavailable, such as for an unloaded stored thread"*.
   * - `error` — the provider reported `systemError` for this thread.
   */
  readonly status: 'working' | 'idle' | 'unloaded' | 'error'
  /**
   * The provider's own `canAcceptDirectInput`, verbatim — and `null` when it did not say.
   *
   * ⛔ **`null` is not `false`.** The vendored type declares this `boolean | null` and documents the
   * null as *"the capability is unavailable"*, which is a different sentence from *"this thread
   * refuses input"*. Collapsing them would let an unloaded thread read as a refusing one.
   */
  readonly acceptsInput: boolean | null
  /** The provider's own name for it, when it gave one. `295`: it assigns these itself. */
  readonly nickname: string | null
  /** How many turns the provider reports on this thread, or `null` when it did not say. */
  readonly turns: number | null
}

/**
 * What happened when a message was offered to a child.
 *
 * ⚠️ **`ok: false` here is never an error and is never thrown.** Each arm is a fact about the child
 * that a person can act on — wait, or stop waiting — and a rejected promise would flatten all four
 * into "something went wrong" beside the genuine transport failures, which DO reject.
 */
export type ChildInputOutcome =
  | {
      readonly ok: true
      /**
       * The provider's id for the turn this opened, when it gave one.
       *
       * ⛔ **Reported, never trusted as proof.** `295` watched this exact field carry an id the
       * provider then never used. It is here because a reader comparing BroBot's record with the
       * child's rollout needs it, and it is documented as a claim rather than a receipt.
       */
      readonly turnId: string | null
    }
  | {
      readonly ok: false
      /**
       * - `working` — ⛔ the ruling. A turn is in progress and this build will not merge into it.
       * - `not-accepting` — the child is idle and the provider still said `canAcceptDirectInput:
       *   false`. Its answer, passed through rather than argued with.
       * - `unloaded` — the provider is not holding this thread open, so there is nothing to speak to.
       * - `error` — the provider reports this thread in `systemError`.
       */
      readonly reason: 'working' | 'not-accepting' | 'unloaded' | 'error'
      /** The state the refusal was decided from, so a caller can say WHY rather than only "no". */
      readonly state: ChildThreadState
    }

/**
 * ⚠️ **A child that has said nothing yet still has a state**, so this is what an adapter returns
 * when the provider answered but said nothing usable — never an invented `idle`.
 *
 * `279` §2's rule, one level down: *"a registry that stayed `null` reads as 'we have not been told',
 * while an invented `[]` would say this agent has no commands"*. An invented `idle` would say this
 * child is ready to hear you.
 */
export const CHILD_STATE_UNKNOWN: ChildThreadState = Object.freeze({
  status: 'unloaded',
  acceptsInput: null,
  nickname: null,
  turns: null,
})

/**
 * Read Codex's `ThreadStatus` into {@link ChildThreadState.status}.
 *
 * ⛔ **The provider's word for "busy" is `active`, and ours is `working`**, because `active` in this
 * app already means a session the user has open. `ThreadStatus` is a tagged union — `{type:'idle'}`,
 * `{type:'active', activeFlags}`, `{type:'notLoaded'}`, `{type:'systemError'}` — so the tag is read
 * rather than the object being truthiness-tested.
 *
 * ⚠️ **An unrecognised tag is `error`, not `idle`.** A status this app has never seen is a thread it
 * cannot make promises about, and the safe reading of "I do not know" is the one that keeps the
 * composer shut.
 */
export function childStatusOf(tag: unknown): ChildThreadState['status'] {
  if (tag === 'idle') return 'idle'
  if (tag === 'active') return 'working'
  if (tag === 'notLoaded') return 'unloaded'
  return 'error'
}

/**
 * Whether a state permits a message, and the word for why not.
 *
 * ⛔ **ONE predicate, because the adapter, the host and the composer must not each hold their own
 * copy** — `169` §1 is the dispatch about a rule spelled in three places, and `279` §3 answered the
 * same problem with a type predicate. The composer draws from this, the host re-asks it immediately
 * before the wire write, and the two therefore cannot disagree about a child.
 *
 * ⚠️ **It is re-asked rather than remembered**, because between the draw and the press the child may
 * have started working. That race cannot be closed from here — the provider is the only authority —
 * so the last read before the write is the one that decides, and a child that starts working in the
 * gap is refused by the provider's own turn semantics rather than by us.
 */
export function childInputRefusal(
  state: ChildThreadState,
): Exclude<ChildInputOutcome, { ok: true }>['reason'] | null {
  if (state.status === 'working') return 'working'
  if (state.status === 'unloaded') return 'unloaded'
  if (state.status === 'error') return 'error'
  // Idle, and the provider still said no. Its answer, not ours — and `null` is not a no.
  if (state.acceptsInput === false) return 'not-accepting'
  return null
}
