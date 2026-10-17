import { refusalReason } from '../../shared/refusals'
import type { SessionStatus } from '@brobot2/shared'
import type { RailPermanence } from './spawn-rails'
// ⚑ **425 · from `shared/refusals.ts` and not through `spawn-rails.ts`'s re-export.** That
// re-export exists so `405` could move `RailPermanence` without touching seven readers; a word
// added today has no such history and names its own home.
import type { RefusalRemedy } from '../../shared/refusals'

/**
 * 🔴 **The door an INTERRUPTION passes, and the vocabulary it is refused in** (395, HO-007 S5).
 *
 * ## ⛔ What is NOT in this list, and why the absences are the design
 *
 * ⚠️ **No grant is here, because none gates interrupting.** `RuntimeHost.interruptAgent` admits a
 * caller that commands the target or sits above it in the chain that created it.
 *
 * ⚠️ **`no-such-agent` is not here either.** It is `TOOL_REFUSALS`', it already folds *"not yours"*
 * and *"not there"* into one answer for `341`'s enumerator reason, and an interruption is asked
 * about exactly the same subject a message is. ⚑ The derived census requires sentences to be
 * unique absolutely and allows shared ownership only for the words its `DELIBERATELY_SHARED` list
 * names (`what-an-agent-is-told-about-its-work.test.ts`), each with one permanence at every door;
 * a duplicate *"no such agent"* would be outside that explicit allowlist and break it, correctly.
 * ⚠️ **This paragraph used to enumerate that list, and the enumeration went short** — the census is
 * the list. Two of THIS file's words are on it: `a-person-is-being-asked` since `496`, and
 * `that-conversation-has-not-started` since `650`.
 *
 * ## 🔴 What IS here: states of the TARGET, asked strictly after entitlement
 *
 * ⛔ **Who may interrupt is never conditional on the target's state** (HO-016 §1). A rule that read
 * state before deciding whether a caller may act at all is racy by construction — the child can
 * begin a turn between the read and the act — so entitlement is asked always, and everything in
 * this file is asked afterwards and answers a different question: *is there anything here to stop,
 * and may THIS be the thing that stops it.*
 *
 * ## ⚠️ A rail here can be RACED, and that is stated rather than sold as a guarantee
 *
 * ⛔ **An escalation guarantee is only as wide as what gets denied** (standing). Every rail below
 * reads a state that can change in the microtask after it is read: a card can open, a turn can end.
 * ⚑ So what these rails promise is narrow and exact — *this call, at this moment, was refused* —
 * and the only unconditional guarantee in this door is the entitlement above them. The one that
 * matters most, {@link a-person-is-being-asked}, says so in its own note.
 */
export const INTERRUPT_RAILS = [
  /**
   * 🔴 **A person is being asked something, and cutting the turn would answer it for them.**
   *
   * ## ⛔ This is a permission refusal wearing an interruption's clothes
   *
   * ⚠️ **Both adapters call `settleRequests()` INSIDE `interrupt()`** — `claude-runtime.ts` and
   * `codex-runtime.ts`, each on the line after `requestInterrupt()` — and `RequestBroker.settleAll`
   * safe-rejects every pending card: a permission resolves as `{outcome:'deny'}` and a question as
   * `{kind:'reject'}`. ⛔ **So an agent interrupting a child that is waiting on a person DENIES the
   * card on that person's behalf**, which is HO-005 Q2 exactly — *"An agent answering another
   * agent's permission prompt is the kill switch with extra steps. Build it so no path exists."*
   * `394` built the door that refuses it by name; this is the same authority arriving through a
   * different verb.
   *
   * ⚑ **And the settling writes NOTHING.** `settleAll` emits no event, no `user_decision` and no
   * `request_resolved` on Claude — so the card would die, the derived request would go on reading
   * `open` for ever, and no row anywhere would say a parent had ended it. The rail is the only thing
   * standing between an agent and a silent denial.
   *
   * ## ⚠️ What it does NOT promise
   *
   * ⛔ **It cannot promise a card is never destroyed by an agent.** The status is read and then the
   * provider is asked, and a card raised in that window is settled by the interruption that was
   * already in flight. ⚑ What it removes is the case a caller can actually see and choose — a child
   * visibly parked on a question — which is every case anything has ever reached today, and the race
   * is stated here rather than left for somebody to discover as a guarantee that was never given.
   *
   * ## 🔴 `until-a-person-changes-it`, and it read `while-this-holds` until `424`
   *
   * ⛔ **HO-023 §2.1:** *"`retryable: true` must name something a model can do without destroying
   * anyone's work… either the refusal carries a legitimate remedy, or its permanence is wrong."*
   * `422` row 12 measured this one: *"Only the person's response door ends this state.
   * `answer_question` deliberately cannot answer a permission; waiting is not an act the model can
   * perform."*
   *
   * ⚠️ **The argument that stood here was that *"nobody has to change a RULE"*, and that is not
   * what the word means.** `RAIL_PERMANENCES` glosses `until-a-person-changes-it` as *"somebody has
   * to decide something"* — and a card parked on a person is somebody deciding something, which is
   * the most literal reading of it in this app. ⛔ Its neighbour is glossed *"the world is simply
   * busy right now, and will stop being"*, and a question nobody has answered does not stop being
   * one on its own.
   *
   * ⚑ **What it changes for a model is the whole point**: `retryable` is derived, so this rail no
   * longer tells a caller that coming back will work. ⛔ **And a model must not spin on it**, which
   * is what the old sentence's *"wait for the person to answer, then ask again"* asked for — the
   * one instruction a model cannot carry out, because waiting is not an act it can perform.
   */
  'a-person-is-being-asked',
  /**
   * ⚑ **D-017 · R19 — it is parked on a question it asked, and the question went to another
   * conversation** — its parent, or the agent it named — not to a person.
   *
   * ⛔ **Not `a-person-is-being-asked`**, whose sentence would be false twice over: nobody but that
   * conversation is being asked, and it ends when that conversation answers, with `answer_question`
   * — which may be the caller itself. ⚑ The same cut settles the card either way (the note above),
   * so this is refused on the same ground, in its own words, naming who owes the answer
   * ({@link InterruptRefusalDetail.askedOf}).
   *
   * ⚠️ **`until-a-person-changes-it`** — *somebody has to decide something*: the conversation it
   * went to answers it, and asking again before then will not interrupt it. No remedy word: the act
   * that ends it is that conversation's answer, and the sentence names it.
   */
  'it-is-waiting-on-an-answer',
  /**
   * ⚑ **D-017 · R12 — that conversation is not below the caller in the spawn chain.**
   *
   * ⛔ **`no-such-agent` is said only about an id no conversation has** (`05` rule 6), so a
   * conversation that exists and that this caller may not interrupt is refused in this door's own
   * word: interrupting reaches the chain below the caller — the conversations it started, and the
   * ones those started — and nothing a grant widens (D-014).
   *
   * ⚠️ **`permanent`**: who started a conversation is fixed when it starts. The sentence names the
   * acts left — a question or a message, which reach further.
   */
  'not-below-you',
  /**
   * ⚑ **It has not started yet — there is no provider behind it to ask.**
   *
   * ⛔ **A refusal rather than a quiet success** — *"'done' for a teardown that never happened is an
   * unenumerated state counting as success"* (`end_agent`'s ruling, one verb over, until D-017). A
   * reservation whose launch is still in flight has no handle, and answering `ok` would tell a model
   * it had stopped work that has not begun.
   *
   * ⚠️ **`while-this-holds`, and it is the one rail here a caller should simply retry.**
   *
   * 🔴 **650 · shared with `TOOL_REFUSALS`, so it means one thing at both doors: a launch in
   * flight.** ⛔ `message_agent` meets the same fact — a reservation whose provider has not arrived
   * — and a second spelling would be a second thing for a model to learn. ⚑ **A reservation a person
   * CLOSED is not this**: it has no session either, but it will never start, so `interruptAgent`
   * answers that nothing was running to interrupt.
   */
  'that-conversation-has-not-started',
  /**
   * ⚑ **A service's turn is on another caller's piece, while the caller's own waits behind it**:
   * only the caller whose piece it is on, and a person, may stop it. ⚠️ `while-this-holds`: once that piece has ended, the service goes on to
   * the next in its queue, and the same call is asked of that one.
   */
  'that-service-is-on-another-callers-piece',
] as const

export type InterruptRail = (typeof INTERRUPT_RAILS)[number]

/** ⛔ **One table, so `permanence` and `retryable` cannot disagree** — `341`'s rule at this venue. */
const PERMANENCE: Readonly<Record<InterruptRail, RailPermanence>> = {
  // 🔴 **`until-a-person-changes-it` since `424`** — see the rail's own note, and HO-023 §2.1.
  'a-person-is-being-asked': 'until-a-person-changes-it',
  'it-is-waiting-on-an-answer': 'until-a-person-changes-it',
  'not-below-you': 'permanent',
  'that-conversation-has-not-started': 'while-this-holds',
  'that-service-is-on-another-callers-piece': 'while-this-holds',
}

export function interruptPermanenceOf(rail: InterruptRail): RailPermanence {
  return PERMANENCE[rail]
}

/**
 * **Would the identical call ever succeed on its own?**
 *
 * ⛔ **Derived, never written twice** — `341`'s rule.
 *
 * ⚠️ **`until-a-person-changes-it` was absent from this table until `424`, and the note here read
 * that the absence was a finding** — *"nothing in this file is answered by a grant"*. ⛔ **The
 * premise was that the word is about GRANTS, and it is not**: `RAIL_PERMANENCES` glosses it *"a
 * switch, a capability list, a directory that must exist"*, and that list is examples rather than
 * the rule. ⚑ The rule is that a person has to act, and `a-person-is-being-asked` is the one rail
 * in this app where a person is already, visibly, the only one who can.
 */
export function interruptRetryableOf(rail: InterruptRail): boolean {
  return interruptPermanenceOf(rail) === 'while-this-holds'
}

/**
 * 🔴 **425 · what the caller may do instead — `that-conversation-has-not-started` has the answer**
 * (HO-023 §2.2).
 *
 * ⛔ **`that-conversation-has-not-started` is a launch in flight and nothing else**: it either
 * attaches its provider session or fails and abandons the reservation, and either way the wait is
 * bounded by something already happening. ⚑ **The caller changes nothing** — the same call, once that
 * has settled.
 *
 * ⚠️ **The word says what to DO and never that it will succeed**, and the abandon arm is why. On a
 * launch that fails, the retry meets `no-such-agent`, which is `permanent` — ⛔ **this said
 * `that-conversation-has-already-ended` until `650`, and it was false**: a failed launch is
 * abandoned, `abandon` deletes the reservation, and `interruptAgent` answers a missing slot with
 * `no-such-agent` before it reads any state. `a-refusal-that-clears-on-its-own.test.ts` §2 measures it.
 * ⛔ **Whether a retry can work is `retryable`'s answer**, and the row carries it one field over; a
 * remedy that promised the outcome as well would be two fields saying one thing, and the weaker of
 * the two would be the one that was wrong. 🔴 **This is the only INTERRUPT rail carrying that word;
 * `TOOL_REFUSALS` also assigns it to `that-work-is-being-sent`, since `650` to this same word,
 * since `657` to `agent-took-too-long-to-start`, since `663` to `that-conversation-is-still-stopping`,
 * since `705` to `that-conversation-could-not-be-woken-just-now`, and since `707` to
 * `agent-could-not-start-just-now`.** (`650` gave it to `agent-started-a-turn-first` as well; `657`
 * retired that word, because a lost race is held now rather than refused. `703` gave it to
 * `a-message-you-cannot-withdraw-is-waiting`, which D-010 retired: a second message is held now.)
 *
 * 🔴 **`a-person-is-being-asked` gets NOTHING, and this is the sharpest `null` across the registered
 * remedy tables.** ⛔ Written while the rail said `while-this-holds` and its sentence said *"wait for the
 * person to answer"* — honest CONTEXT, and not an act this caller can perform: only the person's own
 * door ends that state, and `answer_question` deliberately cannot answer a permission. **Waiting for
 * somebody else is not a remedy**, and a field that recorded it as one would tell a person reading
 * the transcript that their agent had a way out when the way out was them. ⚑ **`424` then repriced
 * the rail `until-a-person-changes-it` and rewrote the sentence** — *"Only the person answering ends
 * this, and asking again will not"* — which is the same finding arriving through the permanence.
 *
 * ⚑ **`not-below-you` is `permanent`**, so it carries no act (the biconditional); its sentence
 * names the other doors.
 */
const REMEDY: Readonly<Record<InterruptRail, RefusalRemedy | null>> = {
  'a-person-is-being-asked': null,
  'it-is-waiting-on-an-answer': null,
  'not-below-you': null,
  'that-conversation-has-not-started': 'make-the-same-call-when-this-settles',
  'that-service-is-on-another-callers-piece': 'make-the-same-call-when-this-settles',
}

/** ⛔ **What a caller may do instead, or `null` because this app knows of nothing** (425). */
export function interruptRemedyOf(rail: InterruptRail): RefusalRemedy | null {
  return REMEDY[rail]
}

/**
 * The facts an interrupt refusal may state beyond the rail itself, carried as DATA (`341`, 100).
 *
 * ## ⛔ The field that is deliberately NOT here
 *
 * ⚠️ **Nothing says WHAT the person is being asked.** A permission's text is the thing a person is
 * deciding about, and handing it back in the refusal that just protected it would deliver the card's
 * contents to the caller the rail turned away — `394`'s `QuestionRefusalDetail` makes the same
 * omission for the same reason, and this is the door where the omission is load-bearing.
 */
export interface InterruptRefusalDetail {
  /** The conversation this call named, echoed back so a model can match refusal to request. */
  agent?: string
  /**
   * ⚑ **D-017 · R19 — the conversation its question went to**, on `it-is-waiting-on-an-answer`: the
   * one whose `answer_question` ends the wait. ⛔ Who, never what: the question's words stay out, for
   * this interface's reason.
   */
  askedOf?: string
}

/** 🔴 **A refusal, as a payload rather than a throw** — `341`'s shape, carried over MCP unchanged. */
export interface InterruptRefusal {
  readonly rail: InterruptRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /** ⛔ **425 · the act left, as a word** — one of `REFUSAL_REMEDIES`, or `null`. See {@link interruptRemedyOf}. */
  readonly remedy: RefusalRemedy | null
  readonly detail: InterruptRefusalDetail
}

/**
 * The sentence for each rail.
 *
 * ⚠️ **A refusal INSTRUCTS or STATES A FACT ABOUT THIS CALL; it does not describe how the system
 * works** (HO-015 §2, standing). ⛔ None of these names a capability, a column, an adapter or an
 * event — and none says *what* the person is being asked, for {@link InterruptRefusalDetail}'s
 * reason.
 *
 * 🔴 **`a-person-is-being-asked` says what would have happened, because that is the fact about THIS
 * call.** A caller told only *"refused"* would reasonably retry; a caller told that cutting in would
 * have answered somebody's question knows both why it stopped and what to do instead.
 */
const INTERRUPT_SENTENCES: Readonly<Record<InterruptRail, string>> = {
  // 🔴 **The last sentence used to be *"wait for the person to answer, then ask again"*** (424).
  // ⛔ Waiting is not an act a model can perform and no retry of this call clears the card, so what
  // it asked for was a loop. ⚑ It now names who ends this, and says that coming back does not.
  'a-person-is-being-asked':
    'that conversation is waiting for a person to answer something. Nothing was interrupted: carry on with something else, or say that you are blocked on it — cutting into it now would throw that question away and answer it as a refusal. Only the person answering ends this, and asking again will not.',
  'it-is-waiting-on-an-answer':
    'that conversation is waiting on an answer from the conversation this refusal names, so nothing was interrupted. If that is you, answer it with answer_question; otherwise it goes on once that one answers. The question went to that conversation, not to a person: cutting into it now would throw that question away and answer it as a refusal, and asking again will not interrupt it.',
  'not-below-you':
    'that conversation is not one you started, or one started under them, so nothing was interrupted: only those can be. To ask it something use ask_question; to tell it something, message_agent.',
  // 🔴 **657 · the last clause presupposed the launch would succeed** (`650` F7). ⛔ It said *wait for
  // it to be working*, and a launch that FAILS never is: the reservation is abandoned and the retry
  // meets `no-such-agent`. ⚑ It now names the act and both ways the wait can end — the permanence
  // was already right, and the remedy says what to do rather than that it will work (`425`).
  'that-conversation-has-not-started':
    'that conversation has not started yet, so there is nothing running to interrupt. It comes up or fails to launch on its own: ask again in a moment.',
  'that-service-is-on-another-callers-piece':
    'Not stopped: that service is on another caller’s piece. Yours waits behind it.',
}

/** Build the whole payload from the rail and its facts, so its policy fields cannot drift apart. */
export function refuseInterrupt(
  rail: InterruptRail,
  detail: InterruptRefusalDetail = {},
): InterruptRefusal {
  return {
    rail,
    permanence: interruptPermanenceOf(rail),
    retryable: interruptRetryableOf(rail),
    reason: refusalReason(INTERRUPT_SENTENCES[rail]),
    remedy: interruptRemedyOf(rail),
    detail,
  }
}

/**
 * 🔴 **The states of a target that stop an interruption, asked in one place and in one order.**
 *
 * ⛔ **Asked AFTER entitlement**, which is every other gate in this app's order and the reason these
 * sentences are safe to say: a caller that may not reach this conversation at all never learns
 * whether somebody is being asked something in it.
 *
 * ⚑ **D-017 · a conversation that is stopping or stopped reaches no rail here**: nothing is running
 * in it, so the door answers that there was nothing to interrupt, before it asks this (a session in
 * teardown could report a stale `waiting_permission`, and *"a person is being asked"* about it
 * would be `340`'s finding again, a reason answering with another reason's sentence).
 *
 * @param status the target's status, or `null` when it has no provider behind it yet.
 * @returns the rail that stopped this act, or `null` when nothing did.
 */
export function admitInterrupt(
  agent: string,
  status: SessionStatus | null,
  /**
   * ⚑ **D-017 · R19 — the conversation the card it is parked on went to**, or `null` when it went
   * to a person (or nothing is routed): read by the host off the same routings the state is.
   */
  askedOf: string | null = null,
): InterruptRefusal | null {
  if (status === null) return refuseInterrupt('that-conversation-has-not-started', { agent })
  if (status === 'waiting_permission') {
    return askedOf === null
      ? refuseInterrupt('a-person-is-being-asked', { agent })
      : refuseInterrupt('it-is-waiting-on-an-answer', { agent, askedOf })
  }
  // ⚠️ **`idle` is admitted, and it is not a fourth rail.** ⚑ D-017 — the door answers an idle
  // conversation with no turn of its own open as *nothing to interrupt* before it asks this; what
  // reaches here idle is one a turn is on its way into, which the provider is asked about.
  return null
}
