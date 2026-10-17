import type { MoveOffer } from './move-request'
import type { ChannelRefusal, UserInputQuestion } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type {
  PersistedEventInfo,
  QuestionEndedWithItsPieceEvent,
  RequestRoutedEvent,
  TranscriptEvent,
} from './runtime-ipc'

/**
 * 🔴 **Routed requests, DERIVED — what a conversation asked, where it went, and whether anybody has
 * answered** (394, HO-007 S4 + criteria 9, 10 and 14).
 *
 * ## ⛔ Criterion 2's property, a second time
 *
 * There is no question table and no question column. `RequestRoutedEvent` is a row in the ledger
 * like any other, and this module **imports TYPES and nothing else** — it cannot reach a database, a
 * host, a clock or a filesystem, so *"the rows are a function of the ledger"* is checked by the
 * compiler rather than by a test that has to remember to drop something. Same shape and same reason
 * as `tasks.ts`. ⚠️ **Stated without a count**, `396`'s correction: the sentence said *"two types"*
 * and a third would have made it quietly false while still reading as though something checked it.
 *
 * ## 🔴 It folds BOTH destinations, which is what makes it the instrument
 *
 * ⚠️ **Criterion 10 is a negative — *permissions cannot enter the question channel* — and a
 * negative asserted by a filter is worthless**: once anything permission-shaped is dropped at the
 * boundary, the census that would have caught a provider starting to send them reports zero
 * forever. ⛔ **So a request that did NOT travel is a row here too**, carrying
 * {@link WhereARequestWent}'s refused arm, and *"has anything permission-shaped ever arrived
 * here?"* is {@link permissionShaped} — a fold, not a promise.
 *
 * ## 🔴 The live half this fold could not have, and the launch that gives it one (396)
 *
 * ⛔ **`open` here means *nothing has ended it in the ledger*, not *it can still be answered*.** A
 * provider's pending request lives in the provider's process; an app restart takes it with it, and
 * **no function over the ledger can tell a live wait from a dead one** — the bytes of an app that is
 * running and holding a request and of an app that died holding one are identical. ⚑ That is the
 * same shape `354` measured for a held message and `379` for a stranded run, and `394` said so and
 * left it.
 *
 * 🔴 **`396` did not make the fold cleverer; it made the LAUNCH write the difference down.**
 * `SessionStore.settleStrandedRequests` runs at host construction — the one moment at which nothing
 * is running, so an `open` row belongs to a provider that is gone — and appends
 * {@link RequestStrandedEvent}. ⛔ **The repair had to be a WRITE**, exactly as `379`'s was: a
 * derivation cannot answer what its ledger does not contain.
 *
 * ⚠️ **So {@link RequestState.stranded} is a fact about the APP and not about the conversation**,
 * which is why it is not `abandoned`. Nothing ended, nobody declined, and the conversation that
 * asked can be resumed — what is gone is the request.
 *
 * ## 🔴 The half a LAUNCH could not write either, and the one it MISLABELLED (397)
 *
 * ⛔ **An interruption kills every open card and writes nothing about any of them.** Both adapters
 * call `settleRequests()` inside `interrupt()` and `RequestBroker.settleAll` safe-rejects the lot —
 * no `user_decision`, no `request_resolved` — so a routed request went on reading `open` while the
 * provider had already been told *no* on somebody's behalf.
 *
 * ⚠️ **The launch sweep did not repair that; it MISLABELLED it.** A row left open by an interruption
 * survives to the next launch and `settleStrandedRequests` closes it `stranded` — *the app had
 * stopped* — which is false: the app was running and somebody pressed Stop.
 *
 * 🔴 **{@link RequestInterruptedEvent} is the ending, and it is written beside the one that names
 * the actor.** `RuntimeHost.askTheWorkToStop` records {@link WorkInterruptedEvent} — *somebody asked
 * this work to stop, and here is who* — and then one of these per still-open request, in the same
 * synchronous stretch and BEFORE the provider is asked. ⛔ **What happened and who did it are
 * neighbouring rows**, which is `395`'s ruling rather than a field: *folding them into one
 * vocabulary is how "it was stopped" comes to imply "a person did it"*.
 *
 * ⚠️ **And it is NOT written by every act that stops a turn.** A stop of the whole conversation
 * takes the questions its provider held with it, so they are `abandoned` — ⚑ D-017: `end_agent`,
 * which recorded the ask and then ended the conversation, was the first such act.
 *
 * ## 🔴 The half that is not an ending at all (398)
 *
 * ⛔ **Criterion 11 — *an unanswered question escalates on timeout, chain visible* — adds NO state to
 * this vocabulary.** ⚠️ Escalating does not un-ask the original: the parent may still answer, the
 * card is still open on the child, and the request is still `open`. ⚑ *Has this ended?* and *has
 * this been escalated?* are two questions, and `395`'s ruling is that folding two questions into one
 * vocabulary is how a word comes to imply something nobody said. So the first is
 * {@link RoutedRequest.state} and the second is {@link RoutedRequest.escalatedAt} — a field beside
 * the word, exactly as `397` put the ACTOR on a neighbouring row rather than into the word.
 *
 * ⚠️ **The chain is a fold too**, and it is {@link escalationChain}: the rows read transitively, not
 * a sentence stored anywhere. ⛔ A stored chain would be a second spelling of a relationship the
 * ledger already holds, free to disagree with it the moment anything moved.
 */

/**
 * ⛔ **612 · `ESCALATION_WINDOW_MS` stood here and is GONE with the deadline it measured**
 * (HO-088 §3.1).
 *
 * ## 🔴 The ruling, quoted, because it is the THIRD time this app made the same mistake
 *
 * A timer cannot establish that an agent failed to answer. It can expire while that agent is still thinking and unnecessarily ask the person a question the agent could settle.
 *
 * > ⚑ **A parent answers the question, or passes it up. Both are deliberate. Neither is a
 * > timeout.**
 *
 * ## ⚑ What it WAS, because the derivation is cited elsewhere and the number is not
 *
 * ⛔ **30,000 ms, measured** — `353`, filed in `00-slice4-measurements.md` §2, at **1.80× the
 * largest turn in its sample**. ⚠️ **That response published its own weakness and the constant
 * inherited it**: `n=16`, eight turns per provider, so p90 and p95 ARE the maximum and the number
 * was a floor rather than a tail study. 🔴 **Restating it as *"measured"* without that clause is
 * how a floor becomes a fact** — and that sentence is the one `PROPOSAL_BOUND_MS` and the
 * `ASK_BOUND_MS` note below both cited, which is why it is kept here rather than deleted with the
 * number it was about.
 *
 * ⚠️ **616 · all three are gone now and the citation is a NAME rather than a `{@link}`** —
 * `608` took `ASK_BOUND_MS`, `612` took this one, `616` took `PROPOSAL_BOUND_MS`, and a link to a
 * symbol nothing exports is a pointer clause that cannot be followed (`a-pointer-clause-is-a-claim`).
 * ⚑ **The rule they cited outlives all three**, which is why it is written here in full rather
 * than left to a reference.
 *
 * ⚑ **It watched the QUESTION's age and never the provider's silence** — the other half of `353`'s
 * answer, and the reason it was never `LivenessTracker`'s window used twice.
 *
 * ## 🔴 What replaced it, and it is an ACT rather than a longer clock
 *
 * ⛔ **`611` built `pass_question_up`** (HO-088 §3.2): a parent that will not answer says so, in
 * one call, and the question reaches the person carrying the ORIGINAL words. ⚑ **So the row that
 * used to arrive because thirty seconds passed now arrives because somebody decided** — and it
 * lands in the same population, through {@link WhereARequestWent}'s `the-person-the-asker-named`
 * arm, which is what `HO-090` §4 asked for.
 *
 * ⚠️ **And the stall risk was already answered** (HO-088 §3.3): a turn that ends with a question
 * neither answered nor passed up is a STALLED TASK — `557`'s machinery, `609`'s `waiting-on-*`
 * family. ⛔ **Nothing here is a replacement timer**, and there is not to be one: the PO has ruled
 * against a clock in this position three times.
 *
 * ⚠️ **{@link RoutedRequest.escalatedAt} survives and nothing writes it any more** — see that
 * field for why a ledger that already holds one must go on reading.
 */

/**
 * ⛔ **608 · `ASK_BOUND_MS` stood here and is GONE with the wait it bounded** (HO-084 §4).
 *
 * ## 🔴 What it was, because the derivation is worth keeping and the number is not
 *
 * ⚑ **300,000 ms — TEN escalation windows** (437, criterion 29), so that the chain *ask → the
 * parent does not answer → a person is told → the person answers* fitted inside the time a
 * worker's tool call was parked. ⛔ **It was never a measurement of how long anybody takes to
 * decide**, and its own note said so: `353`'s 30,000 ms measures TURNS with a published weakness,
 * and restating a floor as a fact is the mistake the note above — where `ESCALATION_WINDOW_MS`
 * stood until `612` — warns about.
 *
 * Measure the person's answer window from when they actually received the question. Earlier escalation time and spare app windows must not consume the time offered to them.
 *
 * ## ⚠️ Why it could not simply stay
 *
 * ⛔ **`591` had already taken its meaning away.** 🔴 **This note said *a parent that answers after
 * the bound is refused BY NAME* — and `591` deleted the behaviour that sentence described**
 * (HO-082 §2, standing rule 8.1): both answer doors took a late answer and refused it on a flag in
 * memory, while the row they were refusing about went on saying somebody owed an answer. ⚠️ After
 * that a question ended when it was answered, or when its work was withdrawn or ended, and never on
 * elapsed time — so the number bounded ONE thing: how long the worker's tool call waited. ⚑ **`608` removed that wait**, and a
 * number whose last reader is gone is `a-number-can-survive-the-death-of-its-derivation`, which is
 * a defect this project keeps by name.
 *
 * ⚠️ **It had ONE other reader and that reader was re-homed rather than left importing a corpse**:
 * `PROPOSAL_BOUND_MS` was defined as this constant, for a stated reason — *this app has one bound
 * for a call parked on somebody else's decision, and a second spelling would be free to drift.*
 * ⛔ **That reason was about TWO such calls.** ⚑ `608` removed one and moved the other's literal
 * into `shared/proposals.ts`; 🔴 **`616` then removed that one too** (`HO-093` §2), so there is
 * no bound anywhere in this app on a call parked on somebody else's decision — because no such
 * call is parked.
 *
 * > ⚑ **HO-082 §2.2: a question ends when it is answered, or when the work it belongs to is
 * > withdrawn or ended. NEVER on elapsed time.** ⛔ Since `608` there is no elapsed time in this
 * > mechanism at all.
 *
 * ⚠️ **What is unchanged:** the routing row is still closed by the next launch's
 * `settleStrandedRequests` when nothing else closed it first — the app stopping really does end a
 * question, because the conversation holding it is gone.
 */

/**
 * Every state a routed request can be in, as data.
 *
 * ⛔ **A closed list because {@link REQUEST_IS_OPEN} is keyed by it**, so another cannot be added
 * without deciding whether it is still somebody's to answer. ⚠️ **The rule is stated without a
 * COUNT**, which `396` is the reason for: it said *"a seventh"* while there were six, and adding one
 * would have left a sentence that is arithmetically wrong and reads as though it were checked.
 */
export const REQUEST_STATES = [
  /** Nothing in this ledger has ended it. */
  'open',
  /** A person or the parent sent an answer. */
  'answered',
  /** A person or the parent declined to answer — the protocol-safe default, which is not an error. */
  'rejected',
  /**
   * ⚠️ **A permission outcome settled it** — `allow`, `deny`, `allow_for_session`,
   * `allow_all_for_session` or `cancel`. ⛔ Not folded into `answered`: what happened is that
   * somebody exercised authority, and a row that called that *answering a question* would be this
   * app's own vocabulary contradicting criterion 10.
   */
  'decided',
  /** The provider withdrew it — `request_resolved`, which `051` added for exactly this. */
  'withdrawn',
  /**
   * The conversation ended with it still open.
   *
   * ⚑ **D-017 · R4 — only a provider's own request, from a launch that wrote `launched` on**: a
   * question this app asked outlives the stop. ⚠️ A ledger written before then keeps its rows as they
   * are: nothing routes one again (D-016 · ruling 14). ⛔ The row itself never changes.
   */
  'abandoned',
  /**
   * 🔴 **The app stopped while it was still waiting, and the provider holding it is gone** (396).
   *
   * ⛔ **Not `abandoned`, and the difference is load-bearing.** `abandoned` says *the conversation
   * ended underneath it*; this says *the conversation is still there and the request is not*. A
   * parent told `abandoned` would reasonably conclude its child had gone away, which is exactly the
   * wrong thing to do about a conversation it can resume and ask again.
   *
   * ⚠️ **Written by ONE writer** — `SessionStore.settleStrandedRequests`, at host construction,
   * which is the only moment at which *nothing is running* is a fact rather than a hope. ⛔ It is
   * never derived from a timeout: *a timeout decides that silence means failure after N seconds — a
   * guess dressed as a fact* (`396` §4).
   */
  'stranded',
  /**
   * 🔴 **Somebody stopped the work this was raised in, and the conversation is still there** (397).
   *
   * ⛔ **ONE producer, and naming it is the whole point.** `RuntimeHost.askTheWorkToStop` is the
   * only path to `SessionHandle.interrupt()`, both adapters call `settleRequests()` on the line
   * after `requestInterrupt()`, and `RequestBroker.settleAll` safe-rejects every open card. ⚠️ It is
   * the app's own act and no provider can produce it — the same property {@link stranded} has, for
   * the opposite reason.
   *
   * ## ⛔ Why it is none of the other endings
   *
   *  - **not `rejected`** — a rejection is somebody DECIDING. Nobody decided: `settleAll` sends the
   *    protocol-safe default because the socket needs an answer, and calling that a decision is
   *    HO-005 Q2 in the ledger (*"an agent answering another agent's permission prompt is the kill
   *    switch with extra steps"*), written down after the fact.
   *  - **not `withdrawn`** — the provider did not clear it; this app killed it.
   *  - **not `abandoned`** — the conversation did not end. It is idle, it is resumable, and asking
   *    it again is exactly the right thing to do. ⚑ **An act that BOTH stops the turn and ends the
   *    conversation still gives `abandoned`**, because the ending is the fact that governs what a
   *    reader should do next (`end_agent`, until D-017, recorded the ask and never wrote this
   *    ending).
   *  - **not `stranded`** — the app did not stop. Reporting a restart that never happened would send
   *    a reader looking for a crash.
   *
   * ## ⚠️ It says WHAT happened and never WHO, and that is `395`'s ruling rather than an omission
   *
   * ⛔ **`HowWorkStopped` is about the work; `WhoStoppedIt` is about a gesture, and folding them
   * into one vocabulary is how *"it was stopped"* comes to imply *"a person did it"*** — the false
   * sentence `395` spent a dispatch removing. ⚑ The actor is on {@link WorkInterruptedEvent}, at the
   * ordinal immediately before the row this state is folded from: **one row over, not one ledger
   * over**, and written in the same synchronous stretch so nothing can come between them.
   */
  'interrupted',
  /**
   * 🔴 **The work this question was raised about was taken back, so there is nothing left to
   * decide** (591, HO-082 §2.2).
   *
   * ⛔ **Folded from the take-back itself.** A giver taking a piece back writes `work_taken_back`
   * into the owner's ledger — the asker's own, since a question about a piece is asked by the
   * conversation holding it — and {@link deriveRoutedRequests} ends every still-open request that
   * names that piece. ⚑ **Until `591` nothing ended them at all**, and the routing row read `open` for
   * ever — a queue row a person could never clear, about work that no longer existed; from `591` to
   * D-016 the door wrote one ending row per request, and since D-016 the one row does it.
   *
   * ## ⛔ Why it is none of the other endings
   *
   *  - **not `withdrawn`** — that one is the PROVIDER clearing its own card (`request_resolved`,
   *    `051`), or the asker taking its own question back. Nothing like that happened here, and a
   *    reader told `withdrawn` would reasonably conclude the asker retracted its own question. ⚡ The
   *    qualifier in this word is which thing was withdrawn, and it is there because the plain word
   *    was taken by the other one.
   *  - **not `rejected`** — a rejection is somebody declining to ANSWER, and the giver did not
   *    decline; it took the work away. ⚠️ Folding the two would tell a worker its question was
   *    considered and refused, which is a claim about a decision nobody made — `395`'s ruling.
   *  - **not `interrupted`** — that word means the turn was stopped and the card went with it.
   *    ⛔ Here the turn is untouched, the worker may still be mid-call, and
   *    {@link RequestState.interrupted}'s own sentence — *there is no longer a request on the other
   *    side to receive anything* — is false.
   *  - **not `abandoned`** — the conversation did not end. It is there, and it is told.
   *
   * ⚠️ **It says WHAT happened and never WHO**, which is `397`'s rule at this venue: the actor is
   * on the take-back row itself (`WorkTakenBackEvent.by`).
   */
  'work-withdrawn',
  /**
   * 🔴 **D-016 · the work this question was raised about was closed by its giver, so there is
   * nothing left to decide.**
   *
   * ⛔ **Folded from the close itself**, as `work-withdrawn` is from a take-back: the giver's
   * close writes `work_closed` into the owner's ledger — the asker's own — and
   * {@link deriveRoutedRequests} ends every still-open request that names that piece.
   *
   * ⚠️ **Not `work-withdrawn`**: nothing was taken back. Taking a piece back says its owner no longer
   * owes it; closing it says the work itself is ended by the one that gave it, and a reader told
   * *taken back* would look for the work to be given again.
   *
   * ⚠️ **It says WHAT happened and never WHO**, `work-withdrawn`'s rule: the actor is on the close
   * row itself (`WorkClosedEvent.by`).
   */
  'work-closed',
  /**
   * The work it was about was handed back (`work_replied`), so nothing is left for an answer to
   * decide. ⚑ It says what happened and never who: the reply row names its owner.
   */
  'work-replied',
  /**
   * 🔴 **D-009 · F012 — the conversation it was addressed to ended without answering it**
   * (ruling 5). ⛔ Not `abandoned`, which is the ASKER's conversation ending: this one is still
   * there, and it is told. ⚑ One producer, `question_recipient_ended`; a quit writes none.
   */
  'recipient-ended',
] as const

export type RequestState = (typeof REQUEST_STATES)[number]

/** ⛔ **Whether this request is still somebody's to answer** — one table rather than a `!==` list. */
export const REQUEST_IS_OPEN: Readonly<Record<RequestState, boolean>> = {
  open: true,
  answered: false,
  rejected: false,
  decided: false,
  withdrawn: false,
  abandoned: false,
  // ⚑ **396.** ⛔ Nobody is waiting: the provider that raised it died with the app that was running
  // it, so an answer would reach nothing. `admitAnswer` refuses through this table rather than
  // through a list of its own.
  stranded: false,
  // ⚑ **397.** ⛔ The card was safe-rejected to the provider when the turn was stopped, so there is
  // no longer a request on the other side to receive anything. `admitAnswer` refuses through this
  // table, and now NAMES this ending rather than falling through to the adapter's `not-pending`.
  interrupted: false,
  // ⚑ **591.** ⛔ The work it was about is gone, so there is nothing left for an answer to decide.
  // ⚠️ **This is the one entry `591` added, and adding it is what the closed table is for**: a
  // ledger row whose subject is already dead is a lie whatever the window is (HO-082 §4.1).
  'work-withdrawn': false,
  // ⚑ **D-016.** ⛔ The work it was about was closed by its giver: nothing is left to decide.
  'work-closed': false,
  // ⛔ The work it was about was handed back: nothing is left to decide.
  'work-replied': false,
  // ⚑ **D-009.** ⛔ Nobody is left to answer it: the conversation it was addressed to has ended.
  'recipient-ended': false,
}

/**
 * 🔴 **Who an agent may say its question is for** (611, HO-088 §2.1) — two ends, and only two.
 *
 * ⛔ **Not a list of arbitrary targets.** `HO-058`'s open messaging is how agents talk to each
 * other; this is the ESCALATION path, and the PO ruled it has two ends: *"the parent, or the
 * person."* ⚑ An agent that wants a THIRD conversation's opinion sends it a message.
 *
 * ## ⚠️ It is DERIVED from the wire's own field rather than spelled a second time
 *
 * ⛔ **{@link RequestRoutedEvent.to} is the durable record**, and a tool advertising its own copy
 * of the two words is how a verb comes to accept a value the ledger cannot hold. ⚑ The `satisfies`
 * below and {@link RECIPIENT_MEANS}' exhaustive `Record` pin it in both directions: a member added
 * to the event and missing here fails the Record, and a member here that the event does not have
 * fails the list.
 */
export type QuestionRecipient = RequestRoutedEvent['to']

/** ⛔ The members, in the order a model is shown them. */
export const QUESTION_RECIPIENTS = [
  'the-parent',
  'a-person',
  // 🔴 **D-009 · F012 — a third end: an agent the asker names** (ruling 1–2, which amends HO-088
  // §2.1: open messaging carries the ask and never the answer). ⚑ By the piece it owns or by its
  // conversation id (D-016 · commit 7 · R1).
  'an-agent',
] as const satisfies readonly QuestionRecipient[]

/**
 * ⚑ **What each one means, for a MODEL choosing between them** (611).
 *
 * ⚠️ **It INSTRUCTS and states a fact about the call; it does not describe how routing works**
 * (HO-015 §2) — neither sentence says what a channel is, what escalation is, or what the app does
 * afterwards. ⛔ And neither promises an answer: `581`'s bound is that we can prove what was sent
 * and never what was heeded.
 */
export const RECIPIENT_MEANS: Readonly<Record<QuestionRecipient, string>> = {
  'the-parent':
    "'the-parent' sends it to the conversation that gave you this work, which is where a question about the work belongs unless you were told otherwise.",
  'a-person':
    "'a-person' puts it in front of the person running this app, for something only they can decide — what they want, which of two things to do, a fact nobody here has.",
  'an-agent':
    "'an-agent' sends it to the agent you name in agent, by the piece it owns (W1.2) or by its id from list_agents; it answers, or says it cannot, and it cannot pass your question on.",
}

/**
 * ⚑ **The {@link ChannelRefusal} on a routing, or `null` because nothing refused it** (611).
 *
 * ⛔ **ONE narrowing, shared**, so a payload, a line, a smoke assertion and a queue row cannot
 * disagree about whether a row has one. ⚠️ The field lives on exactly one arm of
 * {@link WhereARequestWent}, and every reader that wants the word rather than the ARM comes
 * through here.
 */
export function theChannelRefusalIn(request: RoutedRequest): ChannelRefusal | null {
  return request.went.is === 'the-person-the-channel-left-it-with' ? request.went.because : null
}

/**
 * ⛔ **Is this one of the two ends?** — asked of a value that has crossed a tool boundary (611).
 *
 * ⚑ **`325`'s rule: a vocabulary the validator has not been taught is a refusal, never a pass.**
 * ⚠️ And a MISSING value fails it too, which is `HO-088` §2.2 in code — the app does not default
 * the recipient, so a call that did not name one is refused rather than routed somewhere.
 */
export function isQuestionRecipient(value: unknown): value is QuestionRecipient {
  return typeof value === 'string' && (QUESTION_RECIPIENTS as readonly string[]).includes(value)
}

/**
 * 🔴 **D-009 · F012 — where a question may be PASSED: the parent, or a person** (ruling 2: *only a
 * question to your parent can be passed further up*, and the next hop is the chain's). ⛔ Never an
 * agent by name — passing on is climbing the chain, not choosing a peer.
 */
export const PASS_UP_RECIPIENTS = [
  'the-parent',
  'a-person',
] as const satisfies readonly QuestionRecipient[]

/** One of {@link PASS_UP_RECIPIENTS}. */
export type PassUpRecipient = (typeof PASS_UP_RECIPIENTS)[number]

/** ⛔ {@link isQuestionRecipient}'s rule, for the pass-up door's narrower list. */
export function isPassUpRecipient(value: unknown): value is PassUpRecipient {
  return typeof value === 'string' && (PASS_UP_RECIPIENTS as readonly string[]).includes(value)
}

/**
 * 🔴 **Where a request went, and what put it there** (611, HO-088 §2) — one field, three arms, and
 * {@link ChannelRefusal} on the only arm that has one.
 *
 * ## ⛔ The invariant this replaces, quoted, because it was true until this dispatch
 *
 * ⚠️ **`RoutedRequest` carried `to` beside `because` and the docblock ruled them one fact:**
 * *"the event carries `because` if and only if it carries `to: 'a-person'`."* ⛔ **`HO-088` §2 ends
 * that**: an agent may now say its question is for the person, so `to: 'a-person'` has TWO causes —
 * *the asker addressed it* and *the channel refused it* — and only the second names a shape.
 *
 * ## 🔴 Why a union and not a word beside a value
 *
 * ⚑ **`a-value-beside-a-word-or-a-union-of-arms`: the pair is right only when the value stands
 * independently of the reason, and a `ChannelRefusal` does not.** ⛔ Nothing refused an addressed
 * question, so `{ to: 'a-person', because: null }` and `{ to: 'a-person', because: 'a-permission-
 * decision' }` are two different facts that a nullable field renders as one field with a hole in
 * it. ⚠️ **`607` split `TurnOrigin` this way and the split turned a latent defect into a compile
 * error**; the same happens here, and it had to: **every reader in this app spelled *the parent's*
 * as `because === null`**, which is the reading `HO-088` §2 makes wrong about the first row it
 * meets.
 *
 * ## ⚠️ `to` is on every arm, and that is not redundancy
 *
 * ⛔ **Most readers want the RECIPIENT and nothing else** — who may answer, whose queue it is in,
 * whether a deadline has anything to say about it. ⚑ Carrying `to` on each arm lets them read it
 * without narrowing, while `because` stays unreachable until a reader has decided which arm it is
 * looking at. ⚠️ The two cannot disagree: each arm fixes its own `to` as a literal.
 */
export type WhereARequestWent =
  /**
   * ⚑ **The conversation that spawned the asker owes the answer.**
   *
   * ⛔ **It is the arm for a question that TRAVELLED and for one an asker addressed upward**, and
   * the two are deliberately not told apart: nothing in this app acts differently on them, and a
   * member no reader can use is a member every reader still has to think about
   * (`a-closed-vocabulary-guards-what-a-member-says`, one direction over).
   */
  | { readonly is: 'the-parent'; readonly to: 'the-parent' }
  /**
   * 🔴 **611 · a PERSON's, because the asker said so** (HO-088 §2.3) — Ada tasks Ali with *ask the
   * person*, and Ali's question goes there in one hop instead of four.
   *
   * ⛔ **Nothing refused anything, which is the whole of what this arm says and the arm below does
   * not.** ⚠️ **And it is where it GOES rather than a lock on who may answer it**: the parent still
   * can, and {@link admitAnswer} still admits it — see that door for why refusing would leave a
   * question with nobody able to settle it at all.
   */
  | { readonly is: 'the-person-the-asker-named'; readonly to: 'a-person' }
  /**
   * 🔴 **D-009 · F012 — an AGENT's, because the asker named it** — {@link RoutedRequest.parent} is
   * that agent, the one who may answer. ⚑ It answers or says it cannot; it cannot pass it on.
   */
  | { readonly is: 'the-agent-the-asker-named'; readonly to: 'an-agent' }
  /**
   * ⛔ **394 · a PERSON's, because the channel refused it** — {@link ChannelRefusal} names which
   * shape did, in the classifier's own words.
   *
   * ⚑ **Recorded rather than dropped**, which is criterion 10's instrument: *"has anything
   * permission-shaped ever arrived here?"* is {@link permissionShaped} over these rows.
   */
  | {
      readonly is: 'the-person-the-channel-left-it-with'
      readonly to: 'a-person'
      readonly because: ChannelRefusal
    }

/**
 * ⛔ **What each arm stands for, in one line** — the exhaustive `Record` every closed vocabulary in
 * this app owns, so a fourth arm is a compile error rather than a blank space on a surface
 * (`a-closed-vocabulary-guards-what-a-member-says`).
 *
 * ⚠️ **For a reader of a LEDGER and never for a model.** `CHANNEL_REFUSAL_SENTENCES` is the
 * vocabulary a refusal is explained to a caller in, and `QUESTION_SENTENCES` is what a refused call
 * reads; neither is spliced in here, for `question-rails.ts`' stated reason.
 */
export const WENT_STANDS_FOR: Readonly<Record<WhereARequestWent['is'], string>> = {
  'the-parent': 'the conversation that gave the asker its work owes the answer',
  'the-person-the-asker-named': 'the asker addressed it to a person, and nothing refused it',
  'the-agent-the-asker-named': 'the asker addressed it to an agent it named, which owes the answer',
  'the-person-the-channel-left-it-with':
    'the channel refused it, so it never left the conversation that raised it',
}

/**
 * 🔴 **Read one routing row's destination** (611) — the ONE place the wire's two fields become the
 * union above, so no reader has to know the correspondence.
 *
 * ## ⛔ The refusal is asked FIRST, and the order is a fail-closed choice
 *
 * ⚠️ **A row carrying a {@link ChannelRefusal} is a person's whatever else it says.** ⛔ Reading
 * `to` first would let a row that somehow carried both be handed to a parent as answerable, which
 * is the one direction that costs something — `question-rails.ts`' own *"asked BEFORE the ending"*
 * argument, one field over.
 *
 * ## ⚑ Nothing new is written to the wire, and that is deliberate
 *
 * ⛔ **`to` IS the declaration.** {@link RequestRoutedEvent} already carried both fields; what
 * `611` changed is that `to: 'a-person'` may now arrive without a `because`, and this fold is where
 * that stops being a surprise. ⚠️ **Every row written before `611` is read the same way it always
 * was**: the only writer of `to: 'a-person'` was the refused branch, so the middle arm is
 * unreachable for historic rows rather than guessed at for them.
 */
export function whereItWent(event: RequestRoutedEvent): WhereARequestWent {
  if (event.because !== undefined) {
    return { is: 'the-person-the-channel-left-it-with', to: 'a-person', because: event.because }
  }
  if (event.to === 'a-person') return { is: 'the-person-the-asker-named', to: 'a-person' }
  if (event.to === 'an-agent') return { is: 'the-agent-the-asker-named', to: 'an-agent' }
  return { is: 'the-parent', to: 'the-parent' }
}

/**
 * Whether a routing row reads as its writers write one: the request's id, where it went, a refusal
 * as words when it carries one, and — where it went to the parent or to an agent the asker named —
 * who that is. ⚑ Only a request that went to a person may name no conversation: one raised where
 * nobody spawned the asker. ⛔ The one check {@link deriveRoutedRequests} folds a routing by, so a
 * routing every reader leaves out is one a counted reader counts.
 */
export function aWellFormedRouting(event: RequestRoutedEvent): boolean {
  const routing = event as unknown as Readonly<Record<string, unknown>>
  const aName = (value: unknown): value is string => typeof value === 'string' && value !== ''
  if (!aName(routing['requestId'])) return false
  if (routing['because'] !== undefined && typeof routing['because'] !== 'string') return false
  const parent = routing['parent']
  if (routing['to'] === 'a-person') return parent === undefined || parent === null || aName(parent)
  return (routing['to'] === 'the-parent' || routing['to'] === 'an-agent') && aName(parent)
}

/** One routed request, as derived. */
export interface RoutedRequest {
  /** The provider's own request id — what a card carries and what an answer names. */
  readonly requestId: string
  /**
   * ⛔ **The conversation that RAISED it — the ledger this row was folded from.**
   *
   * ⚠️ **Not on the event**, deliberately: a row that named the session it is stored in would be a
   * second spelling of one fact. {@link deriveRoutedRequests} takes the ledger's own name instead —
   * `PieceRow.owner`'s shape, one subject over.
   */
  readonly askedBy: string
  /**
   * The conversation that spawned {@link askedBy} — off the event, on both destinations.
   *
   * ⛔ **611 · NULL when the conversation that raised it has none** (HO-088 §3.2). ⚑ Two routings
   * produce one: `pass_question_up` from a top-level conversation carrying a child's question the
   * last hop, to the person — and (⚑ D-017 · R19) a provider's own request raised in a conversation
   * nobody spawned, which is a person's. ⚠️ **It is not *"we did not look"*** — the conversation's row
   * was read, and it names no parent.
   */
  readonly parent: string | null
  /**
   * 🔴 **Where it went, and — for the two ways it can be a person's — WHICH of them** (611,
   * HO-088 §2).
   *
   * ⛔ **It replaced `to` and `because`, and the sentence that stood here is FALSE since 611.** It
   * read: *"Null and `to: 'the-parent'` are one fact seen twice and cannot disagree: the event
   * carries `because` if and only if it carries `to: 'a-person'`, and this fold copies rather than
   * decides."* ⚠️ **The *only if* half still holds and the *if* half does not**: an asker may now
   * address its question to a person, which is `to: 'a-person'` with nothing refused. ⚑ A pair of
   * fields would have left every reader that used `because === null` to mean *the parent's* right
   * by habit and wrong by contract — see {@link WhereARequestWent} for why this is a union.
   */
  readonly went: WhereARequestWent
  /** Epoch ms of the routing — the `at` of the event. */
  readonly at: number
  readonly state: RequestState
  /** Epoch ms of the event that closed it, or null while it is open. */
  readonly endedAt: number | null
  /**
   * 🔴 **Epoch ms at which this question became a person's to answer, or null because it has
   * not** (398, criterion 11).
   *
   * ⛔ **A FIELD and not a state, which is the whole design.** Escalating does not end anything: the
   * parent may still answer, and {@link state} goes on saying whether anybody can. ⚠️ A reader that
   * needs *"can this still be answered"* asks {@link REQUEST_IS_OPEN}; one that needs *"is a person
   * on the hook for it"* asks this. ⛔ Collapsing them would make *"escalated"* imply *"the parent
   * lost its chance"*, which is false and is the exact shape `395` removed.
   *
   * ⚑ **It survives the ending.** A question that escalated and was then answered keeps this stamp,
   * because *a person was told* remains true about what happened; the pair `(state, escalatedAt)`
   * is what lets somebody ask how often an escalation was still needed by the time it fired.
   *
   * ## 🔴 612 · NOTHING WRITES IT ANY MORE, and it is read rather than deleted (HO-088 §3.1)
   *
   * ⛔ **The deadline that stamped it is gone.** `ESCALATION_WINDOW_MS`, the sweep that asked what
   * was due and the timer that armed the look all went with it; `RequestEscalatedEvent` has no
   * producer left in this app.
   *
   * Keep the stored escalation field readable for older ledger rows. Those questions were genuinely shown to a person; ignoring their stamps would remove still-answerable rows from `SessionStore.questionsAPersonMustAnswer` merely because automatic escalation was retired.
   *
   * ⚠️ **So `null` means two different things now and only one of them is new**: this question was
   * never escalated, which since `612` is true of every question this app will ever route. 🔴 **A
   * reader that needs *is a person on the hook* must NOT ask this field** — it asks
   * {@link aPersonsSince}, which reads the stamp for a historic row and
   * {@link WhereARequestWent} for a live one.
   *
   * ⚠️ **It was never set for anything that was ALREADY a person's** — {@link WhereARequestWent}'s
   * two `a-person` arms both — so no historic row carries a stamp it should not.
   *
   * ⛔ **611 · this said *"anything with a `because`"*** and that admitted the arm `HO-088` §2
   * created: a question an agent addressed to a person carries no refusal, so the old sentence
   * would have had a deadline declare that a parent had failed to answer a question it was never
   * asked.
   */
  readonly escalatedAt: number | null
}

/**
 * 🔴 **The words of one question, as its own request row recorded them** (396).
 *
 * ⛔ **A parent that was not live when its child asked received no message**, so the id on its own
 * names something it cannot answer: `answer_question` takes one entry per PART, and only the request
 * carries the part ids and what each offers. ⚑ Read back from the ledger rather than copied onto the
 * routing, so what a parent reads is what the card said.
 *
 * ⚠️ **Never carried for anything the parent may not answer.** `SessionStore.questionsRaisedIn`
 * reads the two question rows — `user_input_request` and `question_asked` — and the caller narrows
 * again to rows whose `because` is null, because a Codex grant of access arrives on the first of
 * those event types. ⛔ **This note said *"reads only `user_input_request`"* until `474`**, which
 * `437` had already made false: the second type is the whole reason {@link RaisedQuestion.piece}
 * can be here.
 */
/**
 * 🔴 **What put this question in front of somebody — and it is what decides whether a CARD
 * exists** (602).
 *
 * ## ⛔ Why it is a field and not a read of {@link RaisedQuestion.piece}
 *
 * ⚠️ **The two do not even agree today.** Only `question_asked` carries a piece, and not every one
 * does — a question passed up, or asked of another agent about no piece, names none — so
 * `piece !== null` answers *this app raised it* only in part — ⛔ **and it answers a DIFFERENT question**
 * (`widening-a-predicate-widens-every-question-its-field-answers`). {@link WorkInHand}'s own note
 * says the work edge is expected to widen; the day a provider-raised question carries one, a
 * surface reading `about` to decide whether to say *"open it to answer"* would start lying, and
 * nothing would go red.
 *
 * ⚑ **So this is read from the ROW'S OWN TYPE** — `question_asked` or `user_input_request` — in the
 * one statement that already selects both.
 *
 * ## 🔴 What each arm means for a person looking for a control
 *
 * | arm | the row | is there a card? |
 * |---|---|---|
 * | `this-app` | `question_asked`, written by `ask_question` | ⛔ **no, and not anywhere** — `transcript.ts` draws a NOTICE for it, so no `userInput` item exists in any window |
 * | `the-provider` | `user_input_request` | ⚑ **yes, in the asker's own transcript** — it may have been paged out, which is what `NoAnswerHere` `'not-in-this-window'` is about |
 * | `nothing-says` | no row this read could find answers to the request id | ⚠️ **unknown, and a surface may not guess** |
 */
export type HowItWasRaised =
  /**
   * ⛔ **This app raised it, through `ask_question`** — see {@link QuestionAskedEvent}. ⚑ No card was
   * ever drawn for it and none can be: the fold turns the row into a notice.
   */
  | 'this-app'
  /** ⚑ **A provider raised it**, and the asker's transcript drew a card from the same row. */
  | 'the-provider'
  /**
   * ⚠️ **The request is routed and this read found no row that raised it.** ⛔ A generation that
   * flipped under the read, or `394` §5's repeated id. ⚑ It is NOT *"no card"* — it is *this app
   * cannot say*, and a surface keeps the sentence it would have said anyway.
   */
  | 'nothing-says'

/** A file a to-do hands the person, kept as a resource of the piece the to-do is about. */
export interface ActionFile {
  readonly resource: string
  readonly name: string
}

/** What marks a question this app asked as a to-do for a person: the files handed with it. */
export interface ActionAsked {
  readonly files: readonly ActionFile[]
}

/** Whether a stored value is an {@link ActionAsked}, every file named in full. */
export function anActionAsked(value: unknown): value is ActionAsked {
  if (value === null || typeof value !== 'object') return false
  const files = (value as { files?: unknown }).files
  return (
    Array.isArray(files) &&
    files.every(
      (one: unknown) =>
        one !== null &&
        typeof one === 'object' &&
        typeof (one as ActionFile).resource === 'string' &&
        typeof (one as ActionFile).name === 'string',
    )
  )
}

export interface RaisedQuestion {
  readonly move?: MoveOffer
  /** It asks a person to do something, with these files (`request_action`). */
  readonly action?: ActionAsked
  readonly prompt: string
  readonly questions: readonly UserInputQuestion[]
  /**
   * 🔴 **611 · the question this one is CARRYING, or null because it carries none** (HO-088 §3.2)
   * — see {@link QuestionAskedEvent.passedUpFrom}.
   *
   * ⛔ **It is the join `HO-088` §6's chain is built from**, and it is the one edge the escalation
   * walk cannot supply: that walk goes UP from a conversation to its parent, and a passed-up
   * question's relationship to the one it repeats points DOWN.
   */
  readonly passedUpFrom: string | null
  /**
   * 🔴 **611 · what the conversation that passed it on added, beside the words** (HO-088 §3.1) —
   * null because it added nothing, which is every question raised through `ask_question`.
   */
  readonly context: string | null
  /**
   * 🔴 **The piece this question is about, as the row that raised it named it — or `null` because
   * no row named any** (474, from `463` F4; a piece since D-016).
   *
   * ⛔ **Only `question_asked` carries one.** `430` measured that a provider-raised question
   * identifies its request and its parent and NOT the work, so `user_input_request` lands here as
   * `null` for ever and that is a property of the wire rather than of this read. ⚠️ A row written
   * before D-016 names a task under another key and lands here as `null` too.
   *
   * ⚠️ **It is the piece's id and not its label** — the id is what the asker's own ledger is keyed
   * by. ⛔ Turning it into something a person says out loud is {@link aboutTheWork}'s job, and it is
   * done in exactly one place so that a row a reader cannot resolve is reported rather than dropped.
   */
  readonly piece: string | null
  /**
   * 🔴 **Which of the two rows this is** (602) — see {@link HowItWasRaised}.
   *
   * ⛔ **Two arms and not three**: this value exists only because a row WAS found, so
   * `'nothing-says'` is unconstructable here and belongs to the caller that looked and missed.
   */
  readonly raisedBy: Exclude<HowItWasRaised, 'nothing-says'>
}

/**
 * 🔴 **What the asker OFFERED, when a person can press it somewhere no card exists** (619,
 * HO-093 §3.1) — or `null` because they cannot.
 *
 * ## ⛔ Why it is a value and not two fields on the row
 *
 * ⚠️ **The part id and the labels are one fact and a row may not carry half of it.** The labels are
 * what a person presses; the part is the key `respondUserInput` files the answer under, and an
 * answer filed under the wrong key is refused by the completeness rail as *no answer was given for
 * `answer`*. ⛔ Two nullable fields would make *labels with no part* constructable, which is a
 * button that cannot be sent — `a-value-beside-a-word-or-a-union-of-arms`.
 *
 * ⚑ **`options` is never empty here.** {@link whatTheAskerOffered} returns `null` rather than an
 * empty list, so a surface can draw this value without asking a second question about it.
 */
export interface OfferedAnswer {
  /**
   * ⛔ **The part the answer is keyed by** — `respondUserInput`'s `answers` map key, and the id
   * `RuntimeHost.raiseAQuestion` mints as `'answer'` for a question it composed itself.
   *
   * ⚠️ **Read off the part rather than spelled here**, because a question PASSED UP carries the
   * ORIGINAL asker's parts — `passQuestionUp` copies `raised.questions` verbatim — and those came
   * from a provider that names its own ids.
   */
  readonly part: string
  /** ⛔ **The labels the asker offered, in the order it offered them.** Never empty. */
  readonly options: readonly string[]
}

/**
 * 🔴 **Whether a person can answer this question where there is no card, and with what** (619).
 *
 * ⛔ **Three refusals, and each one is a fact about the question rather than a policy.**
 *
 * 1. ⚠️ **A read that missed** (`undefined`). `questionsRaisedInSession` SKIPS a row it cannot
 *    parse — *"a reader with a hole is honest, a reader with an invented question is not"* — and
 *    inventing an offer out of that absence would put buttons on a question nobody can read.
 * 2. ⛔ **A question the PROVIDER raised.** It has a card, `transcript.ts` draws it, and
 *    `attention.ts` already carries what it offers; a second offer composed here is `214 §3`'s
 *    defect — two surfaces deciding what one request offers.
 * 3. ⚠️ **More than one part, or a part with no options.** `AttentionLimit` already rules both:
 *    `'multiple'` because *"one click cannot answer two, and answering one is not an answer"*, and
 *    `'free-form'` because *"no options at all, so there is nothing to click; the answer is
 *    typed"*. ⚑ **This is that rule, not a second one** — stated here because this population has
 *    no live row to carry an {@link AttentionLimit} on.
 *
 * 🔴 **It does NOT ask whether anybody still holds the conversation.** ⛔ That is the WINDOW's
 * question and the window is the only thing that can answer it; folding it in here would make a
 * fact about the question depend on which window asked.
 */
export function whatTheAskerOffered(raised: RaisedQuestion | undefined): OfferedAnswer | null {
  if (raised === undefined) return null
  if (raised.raisedBy !== 'this-app') return null
  // ⛔ **Exactly one**, and `[0]` is guarded by the length test rather than by a non-null
  // assertion: a list this app composed has one part and a passed-up one has as many as the
  // provider asked for.
  if (raised.questions.length !== 1) return null
  const part = raised.questions[0]
  if (part === undefined) return null
  // ⚠️ **`label` and never a second spelling** — it is the string `answerToForward` matches an
  // answer against, so a button that sent anything else would be refused as not one of the
  // responses this request offers.
  //
  // ⛔ **The empty label is dropped, and it is reachable rather than defensive**: `ask_question`
  // bounds the options' total LENGTH and nothing refuses an empty one, so a model may offer a
  // choice with no word on it — and a blank button is `106`'s control that cannot say what it
  // does. ⚑ When every label is empty this returns `null`, which is the same absence as offering
  // none.
  const options = part.options.map((one) => one.label).filter((label) => label !== '')
  if (options.length === 0) return null
  return { part: part.id, options }
}

/**
 * 🔴 **One routed request as a PARENT may read it** (396) — the row, plus the words when they are
 * the parent's to read.
 *
 * ⛔ **Two fields and not one flattened payload**, because they answer to two different rules: the
 * row is derived from the ledger and is always present; the words are read from the asker's request
 * event and are present only for a request this parent may answer. ⚑ Flattening them would make
 * *"nothing carries a permission's text"* a property of how a payload happened to be built rather
 * than of a field that is `null`.
 */
export interface VisibleQuestion {
  readonly request: RoutedRequest
  /**
   * 🔴 **F033 · what a line calls the question's asker** — its agent's name beside the piece the
   * question was asked under (`RuntimeHost.nameByItsWorkUnder`): its root when it owns one, else its
   * own piece on that piece's chain — the name the question's own words gave it. ⛔ Not what it
   * holds now: an old question read *"from Arjun (the owner of W1.48 …)"*, a piece Arjun was given
   * days after asking. ⚠️ A question that names no piece names its asker as it is called now.
   */
  readonly askerCalled: string
  /**
   * ⛔ **The words the parent would have been sent — `null` for anything it may not answer, and for
   * anything whose request row this app can no longer read.**
   *
   * ⚠️ **`null` is TWO facts and the caller must not collapse them into one sentence.** A
   * permission-shaped routing has no words here because a parent may not have them; a question whose
   * asker's ledger was rebuilt has none because they are gone. ⚑ Neither is *"there is nothing to
   * answer"*, which is what the row's own `state` says.
   */
  readonly words: string | null
}

/**
 * 🔴 **One session's ledger folded into the requests it raised.**
 *
 * ⛔ **Pure, total, and ordered by the ledger it was handed.**
 *
 * ## ⚠️ The transitions
 *
 * ⚠️ **Stated without a COUNT** (`396`'s correction, kept): a list whose sentence counts itself goes
 * quietly wrong the first time anything is added to it.
 *
 *  - **`request_routed`** opens the row at `open`. ⛔ A second routing for an id that is still OPEN
 *    is ignored — a duplicate would be a bug, not a state. ⚑ One for an id whose last row is CLOSED
 *    opens a new row: a resume's repeated provider id (`396` §3).
 *  - **`user_decision`** closes it: `answered` and `rejected` are the user-input outcomes, and every
 *    other value is a PERMISSION outcome and lands on `decided`. ⚑ Derived from the value rather
 *    than from which kind of card it was, because the ledger row is what a reader has.
 *  - **`request_resolved`** closes it `withdrawn` — the provider cleared it on its own (`051`).
 *  - **`request_stranded`** closes it `stranded` — a launch found it open with nothing behind it
 *    (`396`). ⛔ **A transition no provider can produce**, which is the point: it is the app writing
 *    down a difference the ledger could not otherwise hold. ⚠️ It read *"the ONE transition"* until
 *    `397` added the second, which is what a sentence that counts itself always does.
 *  - **`request_interrupted`** closes it `interrupted` — the turn it was raised in was stopped and
 *    every open card went with it (`397`). ⛔ **The other one no provider can produce**, and the
 *    writer emits one per open request rather than one for the conversation, because
 *    `RequestBroker.settleAll` kills them one by one and a single row would be a summary of an act
 *    the ledger could then not enumerate.
 *  - **`work_taken_back`** closes `work-withdrawn` every open request whose question named THAT
 *    piece — the giver took back the work the question was about, so there is nothing left to decide
 *    (591, HO-082 §2.2; one row for the piece since D-016). ⛔ **The third ending no provider can
 *    produce**, and it reaches only questions this app raised about the piece: a provider's own
 *    request names no piece.
 *  - **`work_closed`** closes `work-closed` exactly the requests `work_taken_back` would — the giver
 *    closed the work the question was about (D-016) — and it too is an ending no provider can
 *    produce.
 *  - **`request_escalated`** closes NOTHING (398), and since `612` NOTHING WRITES ONE — this
 *    branch reads a ledger that already holds them and no new row will ever reach it (HO-088
 *    §3.1). It stamps {@link RoutedRequest.escalatedAt} on a
 *    row this ledger still holds, open or closed, and leaves the state exactly where it was — the
 *    one transition in this fold that is not a transition. ⛔ It is applied to a CLOSED row too, so
 *    that a stamp written at the deadline and an answer that arrived a moment earlier cannot make
 *    the fold depend on which of the two the sweep happened to see first.
 *  - **`status: ended | errored`** abandons what the stopped provider held: the conversation went
 *    away with somebody waiting on it. ⚑ **D-017 · R4 — from a `launched` row on, a question
 *    this app asked (its `question_asked` row) outlives it**: it stays open until it is answered or
 *    withdrawn, and the answer starts the conversation again. ⚠️ A ledger with no such row replays
 *    as it always did: every open request is abandoned.
 *  - **`launched`** and **`question_asked`** close nothing: they say which of the requests a stop
 *    leaves open — and `question_asked` which piece a question is about, for the take-back and the
 *    close above.
 *  - **nothing else**, which is why a fold over a long conversation costs one comparison per row.
 *
 * ⛔ **A routing that is no well-formed routing opens nothing** ({@link aWellFormedRouting}): it is
 * left out and told to `notWellFormed` by its ordinal, so a counted reader knows it did not read
 * every request — never folded into one whose destination or answerer is a guess.
 */
export function deriveRoutedRequests(
  askedBy: string,
  entries: readonly PersistedEventInfo[],
  notWellFormed?: (ordinal: number) => void,
): readonly RoutedRequest[] {
  const rows: RoutedRequest[] = []
  const open = new Map<string, number>()
  // ⚑ **The LATEST row each id opened** (398) — because {@link settle} deletes from `open` and a
  // stamp that is not an ending must still reach a row after it has closed. ⛔ Two maps rather than
  // one that is never pruned: `open` answers *what is still somebody's to answer* and is walked on a
  // session ending, and putting closed rows into it would abandon them a second time.
  const everSeen = new Map<string, number>()
  // ⚑ **D-017 · R4** — the questions this app asked, and whether a launch has said they outlive a stop.
  const oursToOutlive = new Set<string>()
  let questionsOutliveAStop = false
  // ⚑ **D-016 · the piece each question this app asked is about** — what a take-back or a close ends.
  const pieceOf = new Map<string, string>()

  const settle = (requestId: string, state: RequestState, at: number): void => {
    const index = open.get(requestId)
    if (index === undefined) return
    rows[index] = { ...rows[index]!, state, endedAt: at }
    open.delete(requestId)
  }

  for (const entry of entries) {
    const event = entry.event
    if (event.type === 'launched') {
      questionsOutliveAStop = true
      continue
    }
    if (event.type === 'question_asked') {
      oursToOutlive.add(event.requestId)
      if (event.piece !== undefined) pieceOf.set(event.requestId, event.piece)
      continue
    }
    if (event.type === 'request_routed') {
      if (!aWellFormedRouting(event)) {
        notWellFormed?.(entry.ordinal)
        continue
      }
      if (open.has(event.requestId)) continue
      open.set(event.requestId, rows.length)
      // ⚑ **Overwritten, never guarded** (398). One id CAN legitimately open a second row — a
      // request id repeated across a resume, which `396` §3 measured — and this map exists only so a
      // stamp can reach a row after {@link settle} has taken it out of `open`. ⛔ Using it to refuse
      // the second routing would delete that second row, which is a behaviour `396` built on
      // purpose.
      everSeen.set(event.requestId, rows.length)
      rows.push({
        requestId: event.requestId,
        askedBy,
        // ⚑ **611 · absent is NULL and never a string** — see {@link RoutedRequest.parent}.
        parent: event.parent ?? null,
        // ⚑ **611 · one reading of the two wire fields, in one place** — see {@link whereItWent}.
        went: whereItWent(event),
        at: entry.at,
        state: 'open',
        endedAt: null,
        escalatedAt: null,
      })
      continue
    }
    if (event.type === 'user_decision') {
      // ⛔ **The two user-input outcomes by name, and everything else is a permission's.**
      // `UserDecisionEvent.outcome` is `PermissionDecision['outcome'] | 'answered' | 'rejected'`, so
      // an `else` here is not a catch-all — it is the other half of a union the compiler already
      // closed, and adding a permission outcome cannot silently become an answer.
      settle(
        event.requestId,
        event.outcome === 'answered'
          ? 'answered'
          : event.outcome === 'rejected'
            ? 'rejected'
            : 'decided',
        entry.at,
      )
      continue
    }
    if (event.type === 'request_stranded') {
      // ⛔ **`settle` is a no-op for a row that is already closed**, which is what makes a second
      // sweep over a ledger it has already repaired cost nothing and change nothing — the same
      // property `settleStrandedMessages` gets from its `NOT EXISTS`, here from the fold.
      settle(event.requestId, 'stranded', entry.at)
      continue
    }
    if (event.type === 'request_resolved') {
      // ⚠️ **`id`, not `requestId`, and the difference is the provider's** — `requestResolvedSchema`
      // carries *"the SAME neutral request id the card carries"* under `id`, while the decision this
      // app writes calls it `requestId`. ⛔ Two spellings of one correlation, and the fold has to
      // know both or a withdrawal would silently match nothing.
      settle(event.id, 'withdrawn', entry.at)
      continue
    }
    if (event.type === 'question_withdrawn') {
      // 🔴 **D-009 · the asker withdrew it** — `withdrawn`, the asker's side ending it, as a
      // provider withdrawing its own request already reads. Idempotent through {@link settle}.
      settle(event.requestId, 'withdrawn', entry.at)
      continue
    }
    if (event.type === 'question_ended_with_its_piece') {
      // A question this conversation passed up ends as the one it carried did, when its piece ended.
      settle(event.requestId, event.ending, entry.at)
      continue
    }
    if (event.type === 'question_recipient_ended') {
      // 🔴 **D-009 · the conversation it was addressed to ended without answering it.**
      settle(event.requestId, 'recipient-ended', entry.at)
      continue
    }
    if (event.type === 'work_taken_back') {
      // ⛔ **D-016 · the piece was taken back, so every question still open about it ends with it**
      // (591). ⚑ Idempotent through {@link settle} for `request_stranded`'s reason: a request an
      // earlier ending already closed is not in `open`, so the first ending stands — which is the
      // ending that governs what a reader should do next.
      for (const requestId of [...open.keys()]) {
        if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-withdrawn', entry.at)
      }
      continue
    }
    if (event.type === 'work_closed') {
      // ⛔ **D-016 · the piece was closed by its giver** — the take-back arm above, ending in its own
      // word. Idempotent through {@link settle} for the same reason.
      for (const requestId of [...open.keys()]) {
        if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-closed', entry.at)
      }
      continue
    }
    if (event.type === 'work_replied') {
      // ⛔ The piece was handed back, so every question and to-do still open about it ends with it —
      // the close arm above, in its own word.
      for (const requestId of [...open.keys()]) {
        if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-replied', entry.at)
      }
      continue
    }
    if (event.type === 'request_interrupted') {
      // ⛔ **Written BEFORE the provider is asked** (`RuntimeHost.askTheWorkToStop`), which is what
      // makes this ending exist at all on a provider whose `interrupt()` never returns — Codex awaits
      // the answer to its own `turn/interrupt` request, unbounded (709). ⚑ Idempotent through {@link settle} for
      // `request_stranded`'s reason: a second interruption over a ledger the first already closed
      // costs nothing and changes nothing.
      settle(event.requestId, 'interrupted', entry.at)
      continue
    }
    if (event.type === 'request_escalated') {
      // 🔴 **The one branch that is not a transition** (398). It stamps and returns; the state
      // is untouched, because a question a person was told about is still the parent's to answer.
      //
      // ⛔ **`everSeen` and not `open`, deliberately.** A parent that answered between the deadline
      // falling due and the sweep looking leaves a CLOSED row, and dropping the stamp there would
      // make *"was a person ever told?"* depend on the order two independent writers happened to
      // run in. ⚑ The pair `(state, escalatedAt)` then says the useful thing: it escalated, and it
      // was answered anyway.
      //
      // ⚠️ **First stamp wins.** The writer refuses to escalate twice, and this refuses to record it
      // if it ever did — the moment a person was first told is not a thing a later row may move.
      const index = everSeen.get(event.requestId)
      if (index === undefined) continue
      if (rows[index]!.escalatedAt !== null) continue
      rows[index] = { ...rows[index]!, escalatedAt: entry.at }
      continue
    }
    if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
      // ⚠️ **A snapshot, because {@link settle} writes to the map it is walking.**
      for (const requestId of [...open.keys()]) {
        if (questionsOutliveAStop && oursToOutlive.has(requestId)) continue
        settle(requestId, 'abandoned', entry.at)
      }
    }
  }

  return rows
}

/**
 * ⚑ **D-019 · the row types a conversation's two wait reads select** — `selectRoutedRequestEvents`'
 * (the rows {@link deriveRoutedRequests} folds) and `selectQuestionsRaised`' (`user_input_request`
 * and `question_asked`), both in `db/session-store.ts`. ⛔ Three lists say the same words: this one
 * and the two statements. ⚑ `status` is not here: {@link aWaitIsReadFrom} asks its state.
 */
const WHAT_THE_WAIT_READS_SELECT: ReadonlySet<TranscriptEvent['type']> = new Set<
  TranscriptEvent['type']
>([
  'request_routed',
  'user_decision',
  'request_resolved',
  'request_stranded',
  'request_interrupted',
  'work_taken_back',
  'work_closed',
  'work_replied',
  'request_escalated',
  'question_withdrawn',
  'question_recipient_ended',
  'question_ended_with_its_piece',
  'question_asked',
  'launched',
  'user_input_request',
])

/** How a piece ended, as the question passed up about it ended with it, in a reader's words. */
export const HOW_ITS_PIECE_ENDED = {
  'work-replied': 'handed back',
  'work-withdrawn': 'taken back',
  'work-closed': 'closed',
} as const satisfies Record<QuestionEndedWithItsPieceEvent['ending'], string>

/**
 * Why `label` did not end as `ending` says: a conversation holding a copy passed up of a question
 * about it is starting, so that copy could not end with it.
 */
export function aPieceNotEndedWhileAQuestionStarts(
  label: string,
  ending: QuestionEndedWithItsPieceEvent['ending'],
): string {
  return `${label} wasn't ${HOW_ITS_PIECE_ENDED[ending]}: a conversation with a question about it is still starting. Try again in a moment.`
}

/** Why `label` did not end as `ending` says: the questions about it could not all be read. */
export function aPieceNotEndedItsQuestionsUnread(
  label: string,
  ending: QuestionEndedWithItsPieceEvent['ending'],
): string {
  return `${label} wasn't ${HOW_ITS_PIECE_ENDED[ending]}: its questions couldn't all be read. Try again; if it fails again, ask a person.`
}

/**
 * 🔴 **D-019 · a row that can move who owes a conversation its next move** — one its two wait reads
 * select and fold, so the answer they gave before it was written may not be the answer now.
 *
 * ⚑ **A `status` counts only when it ends the provider** (`ended` | `errored`): the statement selects
 * every status, and {@link deriveRoutedRequests}' one status arm acts on those two alone — so a
 * turn's `working` and `idle` move nothing it folds.
 */
export function aWaitIsReadFrom(event: TranscriptEvent): boolean {
  if (event.type === 'status') return event.state === 'ended' || event.state === 'errored'
  return WHAT_THE_WAIT_READS_SELECT.has(event.type)
}

/**
 * 🔴 **The moment this request became a PERSON's to answer** (611, HO-090 §4).
 *
 * ## ⛔ Two clocks, one question, and the row says which it answered from
 *
 * ⚑ **A question the parent owed becomes a person's when the deadline stamps it** —
 * {@link RoutedRequest.escalatedAt}. ⚠️ **One an asker ADDRESSED to a person was a person's from
 * the instant it was written**, so its moment is {@link RoutedRequest.at} — which is the argument
 * `SessionStore.decisionsAwaitingAPerson` already makes for a refused routing, in its own words:
 * *"there is no parent that failed to answer in time and nothing an escalation would record… the
 * row is a person's from the instant it is written rather than one window later."*
 *
 * ⛔ **One function, because the ORDER and the AGE are the same fact.** The store sorts a person's
 * queue by it and the window draws *"waiting 14 minutes"* from it; two spellings would let the
 * oldest row and the one drawn as oldest be different rows.
 *
 * ⚠️ **It is not asked of a request that is nobody's** — a routing to the parent with no stamp
 * answers `null`, and a caller that has one of those is holding a row the person's queue never
 * admitted.
 */
export function aPersonsSince(request: RoutedRequest): number | null {
  if (request.escalatedAt !== null) return request.escalatedAt
  return request.went.to === 'a-person' ? request.at : null
}

/**
 * 🔴 **Has anything permission-shaped arrived at this channel?** — criterion 10, as a fold.
 *
 * ⛔ **The whole reason the routing is recorded on both arms.** A gate that dropped these would make
 * this function's answer permanently `[]` and permanently uninformative; because nothing is dropped,
 * an empty answer means *none arrived* and a non-empty one names each shape that did.
 *
 * ⚠️ **Every arrival, not the first.** A reader that returned one would pass a control that plants
 * two — standing rule 12, and the exact defect it exists to catch.
 */
export function permissionShaped(
  requests: readonly RoutedRequest[],
): readonly RequestOnlyAPersonCanSettle[] {
  return requests.filter(
    (one): one is RequestOnlyAPersonCanSettle =>
      one.went.is === 'the-person-the-channel-left-it-with',
  )
}

/**
 * 🔴 **Is a PERSON still on the hook for something this conversation raised?** (609) — the question
 * half of {@link WhatAConversationIsWaitingOn.aPerson}.
 *
 * ## ⛔ Two conditions and both are necessary
 *
 * ⚑ **{@link WhereARequestWent}'s `to` says *a person has it*; {@link REQUEST_IS_OPEN} says *it
 * can still be settled*.** ⚠️ Either alone is a different question: the first is true for ever
 * about a card somebody answered an hour ago, and the second is true of a question the PARENT owes
 * — which is {@link composeWhatEachPieceIsWaitingOn}'s FIRST arm and not this one.
 *
 * ## 🔴 611 · it reads the RECIPIENT now, and it used to read the refusal
 *
 * ⛔ **It was `permissionShaped(requests).some(...)`, which is *only a person MAY settle it*.**
 * ⚠️ Since `HO-088` §2 a conversation can also be waiting on a person because its asker ADDRESSED
 * a question there, and nothing refused anything — so the old spelling reported a conversation
 * parked on a person as having nobody outstanding at all, which is `603`'s own defect with the
 * subject changed. ⚑ **The question this answers is *is a person on the hook*, and that is `to`.**
 *
 * ## ⚠️ Escalation is deliberately not here
 *
 * ⛔ **{@link RoutedRequest.escalatedAt} does not make a request a person's for this purpose.** A
 * question routed to the parent that escalates is still the parent's to answer — `escalatedAt`'s
 * own docblock: *"Escalating does not end anything"* — and it already reads
 * `waiting-on-an-answer`. ⚑ Admitting it here would move a piece's state at an escalation while
 * nothing about the work changed, which is the exact claim `603` refused when it named the state
 * after what the worker did rather than after who owes the answer.
 *
 * ⚑ **A boolean and not a list**, because nothing joins one of these to a piece of work: a
 * provider-raised question carries {@link RaisedQuestion.piece}` === null` for ever (`430`), so
 * the fact is the conversation's and a list would suggest a join the ledger does not hold.
 */
export function aPersonOwesAnAnswerIn(requests: readonly RoutedRequest[]): boolean {
  return requests.some((one) => one.went.to === 'a-person' && REQUEST_IS_OPEN[one.state])
}

/**
 * 🔴 **A routed request that never travelled, with the reason it did not, in the type** (403).
 *
 * ⛔ **The narrowing is the whole of it.** {@link RoutedRequest.went} carries `because` on ONE of
 * its three arms; a reader that has ALREADY selected that arm would otherwise have to narrow it a
 * second time, or assert past it. ⚑ {@link permissionShaped} is the one selector, so this is what
 * it hands back and there is no second spelling of *"it did not travel"* anywhere.
 *
 * ⚠️ **611 · it narrows on the ARM and no longer on `because !== null`.** ⛔ Since `HO-088` §2 a
 * request can be a person's with nothing refused, so the old spelling would have admitted an
 * ADDRESSED question into the population criterion 10 counts — and the census that answers *"has
 * anything permission-shaped arrived?"* would have started saying yes about questions.
 *
 * ⚠️ **Every member of {@link ChannelRefusal}, not the one the briefs talk about.** A permission is
 * the plainest of five; a grant of access, a consent with nothing to answer, a shape this app has
 * not been taught and a secret only a person can type are the other four, and all five mean the
 * same thing about who may settle it. ⛔ A reader that admitted only `a-permission-decision` would
 * be a filter over a closed vocabulary that grew — see `403`'s response §1.
 */
export type RequestOnlyAPersonCanSettle = RoutedRequest & {
  readonly went: Extract<WhereARequestWent, { readonly is: 'the-person-the-channel-left-it-with' }>
}

/**
 * One hop of a chain: a conversation, the question it is waiting on, and who owes the answer.
 */
export interface EscalationLink {
  /** The conversation that is waiting. */
  readonly waiting: string
  /** The question it is waiting on an answer to. */
  readonly requestId: string
  /**
   * The conversation that owes the answer.
   *
   * ⛔ **611 · NULL is the PERSON**, which is {@link ChainHop.on}'s own convention one type down.
   * ⚑ Two rows produce it: a question its asker ADDRESSED to a person, which no parent was ever
   * going to answer, and a top-level conversation that passed one up. ⚠️ Before `611` the walk
   * always started at a parent, so the person could only ever be the hop AFTER the last link.
   */
  readonly on: string | null
}

/**
 * 🔴 **Who is waiting on whom, all the way up** (398, criterion 11) — HO-007's *"worker
 * waiting on PM, PM waiting on you"*, as data.
 */
export interface EscalationChain {
  /** The hops, asker first. Never empty: a chain of one is still a chain. */
  readonly links: readonly EscalationLink[]
  /**
   * ⛔ **Whether the walk ENDED, rather than being stopped.** True when the last conversation in the
   * chain has no open question of its own, so the next answer really is a person's. ⚠️ False means
   * the walk hit {@link CHAIN_HOP_LIMIT} — a refusal, not a conclusion — and a caller must not print
   * *"waiting on you"* after it.
   */
  readonly endsWithAPerson: boolean
}

/**
 * 🔴 **One question a person now owes an answer to, and why** (398, criterion 11).
 *
 * ⛔ **Separate fields and never one flattened line**, for {@link VisibleQuestion}'s reason: the row is
 * derived from the ledger, the chain is derived from the rows above it, and the sentence is the
 * chain rendered for a person. ⚑ A surface that wants to say it differently — a list, a tree, a
 * badge — has the parts; a surface that wants HO-007's own evidence line has {@link sentence}, and
 * the two cannot drift because one is computed from the other.
 */
export interface PersonsQuestion {
  /** The routed request itself — still `open`, because escalating ends nothing. */
  readonly request: RoutedRequest
  /**
   * A to-do the agent asked the person to do (`request_action`), rather than a question: what to do
   * and the files handed with it. The person answers it Done or Can't do it (`answerAction`).
   */
  readonly action?: { readonly text: string; readonly files: readonly ActionFile[] }
  /**
   * 🔴 **611 · when this became a PERSON's, whichever way it did** (HO-090 §4) — see
   * {@link aPersonsSince}.
   *
   * ⛔ **On the row rather than left to the window, because there are TWO clocks now.** ⚠️ A
   * question a deadline escalated became a person's at {@link RoutedRequest.escalatedAt}; one an
   * asker ADDRESSED to a person was a person's at {@link RoutedRequest.at}, which is the argument
   * `decisionsAwaitingAPerson` already makes for a refused routing. ⛔ A renderer reading
   * `escalatedAt` would draw *"no time recorded"* over every addressed row, and the queue's whole
   * ordering is *oldest-blocked first*.
   *
   * ⚑ **The SAME number the store sorted by**, so the oldest row and the row drawn as oldest are
   * one row.
   *
   * ⚠️ **NULL is carried rather than filled in**, for {@link PersonsQueueRow.blockedSinceIs}'
   * reason: *which instant this is* and *there is no instant* are answers to the same question,
   * and a row may not carry both. ⛔ The reader that builds this list admits only rows that HAVE
   * one, so a null here says that reader widened — which a surface draws as *no time recorded*
   * rather than as *just now*.
   */
  readonly aPersonsSince: number | null
  /** Who is waiting on whom, asker first. */
  readonly chain: EscalationChain
  /**
   * 🔴 **The same chain with its conversations NAMED, hop by hop** (401).
   *
   * ⛔ **The half `398`'s *"a surface that wants to say it differently has the parts"* was missing.**
   * {@link EscalationChain.links} carries session ids, and the one party that can name a
   * conversation is the one holding its ledger — a person's question is very often raised by a
   * child NO window is running, so a renderer resolving names itself would print `sess_<uuid>` for
   * exactly the conversations a person cannot recognise. ⚑ {@link sentence} is a join of this, so a
   * surface drawing hops and a surface printing the line cannot disagree.
   */
  readonly reading: ChainReading
  /**
   * The chain as HO-007 criterion 11 words it — *"worker waiting on PM, PM waiting on you"*.
   *
   * ⚠️ **Conversations are named the way a PERSON reads them** — by their AGENT's name since `734`
   * (R41), and by the basename of the working directory only where a conversation has no agent,
   * falling back to the id — and never the `sess_<uuid>` an agent is given. ⛔ That fallback is the
   * id and never a word like *"a conversation"*. ⚠️ **Two conversations of one identity read the
   * same name here**: the sentence is a join of names, and what tells them apart stays on the row
   * beside it — {@link chain}'s links carry each conversation, and {@link request} the asker's
   * (`732` F-6, closed on exactly that).
   */
  readonly sentence: string
  /**
   * 🔴 **The open work the asking conversation is holding — criterion 20's *which work*, as far as
   * the ledger goes** (434). See {@link WorkInHand}: this is the CONVERSATION's work — its root, when
   * it owns one, and its open pieces — and which of it the question is about is {@link about}'s.
   *
   * ⚠️ **Empty is a fact and not a gap.** A conversation that owns no root and holds no open piece
   * holds nothing, and that is the true answer to *which work* rather than a read that failed.
   *
   * 🔴 **474 · read beside {@link about}, which is the field that says whether this list is the
   * answer or the consolation.** ⛔ When the asker NAMED its work, {@link about} is the answer to
   * *which work* and this list is context; when nothing named any, this list is all there is. ⚠️ **It is not narrowed to the named piece** — a person moving a blocked conversation
   * wants to see everything it is holding, and dropping the rest would answer a question nobody
   * asked.
   */
  readonly work: readonly WorkInHand[]
  /**
   * 🔴 **Which work this question is about, and why that is the answer** (474, from `463` F4) — see
   * {@link AboutWork}, whose three arms are the whole of it.
   */
  readonly about: AboutWork
  /**
   * 🔴 **What raised this question, which is what decides whether there is a card to open** (602) —
   * see {@link HowItWasRaised}.
   *
   * ⛔ **Carried main-side for {@link reading}'s reason**: the row that raised a question lives in
   * the ASKER's ledger, and a renderer holds no ledger. ⚠️ `589` measured what its absence cost —
   * the queue told a person *"open it to answer"* about a question that has no card in any part of
   * any transcript, which is `106`'s shape said out loud.
   */
  readonly raisedBy: HowItWasRaised
  /**
   * 🔴 **What the asker offered, when a person can press it from the queue** (619, HO-093 §3.1) —
   * see {@link whatTheAskerOffered}, which is the whole of the decision.
   *
   * ## ⛔ Why it rides beside {@link raisedBy} rather than being derived from it
   *
   * ⚠️ **`raisedBy` answers *is there a card*; this answers *is there anything to press*.** They
   * agree on three populations and part company on the one that matters: a question this app
   * raised has no card AND may still have offered choices, which is exactly the row `589` measured
   * a person landing on with nothing to do. ⛔ A surface that inferred one from the other would be
   * back to `602`'s false instruction with the sign flipped.
   *
   * ⚑ **Carried main-side for {@link reading}'s reason.** The words live in the ASKER's ledger and
   * the window holds no ledger; `questionsForAPerson` already reads that row for `raisedBy` and
   * `about`, so this field costs no second statement.
   *
   * ⛔ **It says nothing about WHO may press it.** Whether this window holds the conversation is
   * the window's own fact — `PersonsQueueWorld.held` — and a field that folded it in would be a
   * question's answerability depending on which window asked.
   */
  readonly offered: OfferedAnswer | null
  /**
   * 🔴 **D-046 · the question as it was asked** — its words, what a conversation added when it
   * passed it up, and each part with its own wording, its choices and its rules — see
   * {@link AskedQuestion}.
   *
   * ⚑ **Carried main-side for {@link reading}'s reason, and off the SAME row** {@link raisedBy},
   * {@link about} and {@link offered} read, so it costs no second statement and cannot come from
   * another moment. ⚑ **For a question either origin raised**, so a window draws the question
   * whichever conversation asked it and whether or not it holds that conversation. ⛔ **For one the
   * provider raised (`'the-provider'`) it is for DRAWING only**: its card, in its asker's own
   * conversation, stays the one surface that answers it — {@link whatTheAskerOffered}'s second
   * refusal, for the same reason.
   *
   * ⚠️ **`null` where no row was found** — {@link raisedBy} `'nothing-says'` — the honest absence,
   * never an empty question.
   */
  readonly asked: AskedQuestion | null
}

/**
 * 🔴 **D-046 · a question as it was asked, for the person's list** — see
 * {@link PersonsQuestion.asked}. ⚑ Read off {@link RaisedQuestion}, whole: nothing here is cut,
 * renamed or filtered, for `questionText`'s reason — an answer is matched against the labels
 * as the asker wrote them.
 */
export interface AskedQuestion {
  readonly move?: MoveOffer
  /** ⚑ Its words, whole, as the row recorded them. */
  readonly prompt: string
  /**
   * ⚑ What the last conversation that passed it up added, beside the words — `null` where nothing
   * was. ⚠️ Only that hop's: a pass-up copies the words and the parts it carries, not what an earlier
   * hop added.
   */
  readonly context: string | null
  /** ⚑ It was passed up, carrying another conversation's question ({@link RaisedQuestion.passedUpFrom}). */
  readonly passedUp: boolean
  /**
   * ⚑ **Each part, in the order asked**: its `id` — the key an answer is filed under, as
   * `respondUserInput` takes it — its `header`, its own wording (`prompt`), its choices (`options`,
   * each a `label` and an optional `description`), and its rules: `multiSelect` takes several
   * answers; `allowOther`, or no options at all, takes a typed answer; `secret` hides the answer.
   */
  readonly parts: readonly UserInputQuestion[]
}

/**
 * 🔴 **The work the conversation that ASKED is holding, as a person refers to it** (434, HO-024
 * criterion 20).
 *
 * ⛔ **It is what that CONVERSATION is doing, and never what this question is ABOUT.** The two are
 * different claims and only the first is recorded FOR A QUESTION THE MODEL RAISED: `430` measured
 * that a routed provider question identifies its request and its parent and **not the work**, and
 * more than one piece can be open in one conversation at once. ⚠️ So a surface drawing one of those
 * must name it as the asker's work and say that which of it the question concerns is unrecorded —
 * HO-024 §5.3's renderable unknown rather than an omitted line.
 *
 * 🔴 **An `ask_question` question DOES name its piece, and `437` is where that became true** (a
 * task until D-016). {@link QuestionAskedEvent.piece} carries it, because the verb derived its
 * destination from that edge. ⛔ **So the renderable unknown is not unconditional**: the honest
 * reading is the row's — if it carries a piece, name it; if it does not, say so. ⚑ `474` carries it
 * to the person's queue and the transcript — see {@link AboutWork}, which is *"the honest reading is
 * the row's"* made into a vocabulary.
 *
 * ⚠️ **A root is the asker's work too** (D-016): its owner may ask about it, and the store's reading
 * of what an asker holds lists the root's label beside its open pieces.
 */
export interface WorkInHand {
  /** The label a person says out loud — *W1.2*. Off the give, never recomputed. */
  readonly label: string
}

/**
 * 🔴 **Which work a question is about, and why that is the answer** (474, from `463` F4).
 *
 * ## ⛔ Why a bare `WorkInHand | null` could not carry this
 *
 * ⚠️ **This vocabulary exists because a null had two readings**, and the app was already DRAWING
 * the wrong one of them: the person's queue said
 * *"which of it this is about is not recorded"* over every row, including the rows where `437` had
 * recorded exactly that. ⛔ **An edge this app never had and an edge this app threw away are not the
 * same claim about the ledger.**
 *
 * ## 🔴 A UNION rather than a value beside a word, and that is the stronger half
 *
 * ⛔ **A pair of `aboutWork` and `aboutWorkIs` would let *"the asker named it"* stand over no work, and *"nothing recorded it"* stand over a
 * placed piece — two states a reader would have to decide about, which is the defect this vocabulary
 * exists to remove. ⚑ **Here the work lives on the one arm that has any**, so the disagreeing pair
 * is unconstructable rather than merely unwritten, and a surface switching on the `is` word is
 * handed the work already narrowed.
 *
 * ## ⚠️ Three members, and the middle one is the reason there are not two
 *
 * ⛔ **A row can NAME work this read cannot place.** `ask_question` checks the piece against what
 * the asker holds before it writes, so the pair is consistent at the moment it is written — but a
 * ledger is read back long after: `importBundle` takes a conversation's events without its whole
 * history, `derivePieces` skips a row it cannot parse, and a generation rebuild moves what
 * `SessionStore.questionsRaisedIn` can see. ⛔ **Folding that into *nothing
 * recorded it* would be this app reporting its own short read as a fact about the ledger**, which is
 * `447`'s defect and HO-024 §5.3's rule.
 *
 * ## ⚠️ What a skipped question row lands on, said rather than discovered
 *
 * ⛔ **`SessionStore.questionsRaisedIn` SKIPS a row whose payload it cannot read**, so a request
 * whose question row is unreadable reaches this fold with no named piece and lands on
 * `nothing-recorded-it` beside a provider's question. ⚑ **That is honest rather than a
 * conflation**: in both cases nothing this app can read names the work, and the difference between
 * *"the provider does not record it"* and *"a row would not parse"* is a fact about the READ —
 * which {@link LedgerWalk.rowsUnread} already carries beside the row and which no surface may infer
 * from this word.
 */
export type AboutWork =
  /**
   * ⛔ **The asker named its work and this read placed it** — {@link QuestionAskedEvent.piece},
   * resolved against what the asker holds to the label a person says out loud.
   */
  | { readonly is: 'the-asker-named-it'; readonly work: WorkInHand }
  /**
   * 🔴 **A row named work and nothing in the asker's ledger answers to it.** ⛔ The edge exists and
   * this read could not follow it; see the docblock above for the three ways that happens. ⚠️ **It
   * carries no work, and that is the point** — a surface may say the edge is there and unfollowable
   * without being handed something to draw.
   */
  | { readonly is: 'named-work-nothing-answers-to' }
  /**
   * ⛔ **Nothing this app can read names the work this question is about.** ⚑ The ordinary member:
   * `430` measured that a provider-raised question identifies its request and its parent and not the
   * work, and a permission carries no piece at all.
   */
  | { readonly is: 'nothing-recorded-it' }

/** ⛔ **The word alone**, for a table that has to be exhaustive over it. */
export type AboutWorkIs = AboutWork['is']

/**
 * ⛔ **What each {@link AboutWorkIs} means, for a surface that has to say something** — the
 * exhaustive table that makes a fourth member a compile error rather than a blank.
 *
 * ⚑ **The row carries the WORD and the surface carries the sentence**, so a fourth member cannot
 * reach a person as an empty line.
 *
 * ⚠️ **The first member's sentence names no label**, because the label is on the arm and only a
 * surface holding it can say `W1.2` — see `PersonsQueue.vue`, where all three are drawn.
 */
export const ABOUT_WORK_SAYS: Readonly<Record<AboutWorkIs, string>> = {
  'the-asker-named-it': 'The conversation that asked said which piece of work this is about.',
  'named-work-nothing-answers-to':
    'The conversation that asked named the piece of work this is about, and no piece this app can read answers to it.',
  'nothing-recorded-it': 'Nothing this app records says which piece of work this is about.',
}

/**
 * 🔴 **The ONE fold from *a piece a row named* to *which work, and why that answer*** (474).
 *
 * ⛔ **The WORK is read before the word**: the arm that carries work is chosen because work was
 * FOUND, never because a caller said so, and the failing direction is always the weaker claim.
 *
 * ⚠️ **`find` is handed in rather than reached for**, which is what keeps this module free of a
 * database exactly as {@link escalationChain}'s `openQuestionOf` is — and what lets the same
 * derivation serve a host that reads a store and a test that plants two rows.
 */
export function aboutTheWork(
  named: string | null,
  find: (piece: string) => WorkInHand | null,
): AboutWork {
  const found = named === null ? null : find(named)
  if (found !== null) return { is: 'the-asker-named-it', work: found }
  return { is: named === null ? 'nothing-recorded-it' : 'named-work-nothing-answers-to' }
}

/**
 * ⛔ **What a population that CANNOT name work carries** (474) — a permission, whose event type
 * has no piece to read at all.
 *
 * ⚑ **Derived through {@link aboutTheWork} rather than spelled**, so the call sites in the person's
 * queue have one derivation between them and a fourth member of {@link AboutWork} cannot
 * reach a surface by being forgotten here.
 */
export const NOTHING_NAMED_THE_WORK: AboutWork = aboutTheWork(null, () => null)

/**
 * 🔴 **The still-open questions one conversation has raised, grouped by the PIECE each one names**
 * (603, HO-091 §1) — the one derivation two doors ask in opposite directions.
 *
 * ## ⛔ Two readers, and they must agree by construction rather than by care
 *
 * ⚑ **A take-back or a close COUNTS them** — the questions it ends with the piece, in the words it
 * answers with (`591`'s repair; the ending itself is folded from the take-back or close row,
 * {@link deriveRoutedRequests}). ⚠️ **The composition READS them** —
 * `WhatAConversationIsWaitingOn.answers`, so a piece whose question is open says
 * `waiting-on-an-answer` rather than `stalled`.
 *
 * 🔴 **Spelling the pair twice is how the two would come to disagree**: a piece that goes on reading
 * *waiting on an answer* about a question the take-back or close already ended, or the reverse.
 * ⛔ **One derivation is what makes the complement provable** — `aStallItsGiverCanBeToldOf`'s own
 * argument, one subject over.
 *
 * ## ⚠️ Only `question_asked` names work, and that is the wire rather than this filter
 *
 * ⛔ **A permission-shaped routing can never appear here.** `430` measured that a provider-raised
 * question identifies its request and its parent and NOT the work, so `user_input_request` carries
 * {@link RaisedQuestion.piece}` === null` for ever and is walked past. ⚑ **Which is the right
 * answer and not a lucky one**: a giver must not be told its owner is *asking about work* because a
 * provider put a command-approval card on the screen.
 *
 * ## ⚠️ A question about NO piece holds no piece (D-016)
 *
 * ⛔ **A question to another agent may name none**, and it is not in this map: it holds none of the
 * asker's work, and no piece of it reads *waiting on an answer* because of it. ⚑ Until D-016 such a
 * question held every task its asker had; a piece now waits only on a question about itself.
 *
 * ## ⚑ {@link REQUEST_IS_OPEN} and never a list written here
 *
 * ⛔ **The same table `admitAnswer` refuses through**, so another ending cannot make this read
 * disagree with the door a giver answers at.
 *
 * ## ⚠️ A list per piece rather than a boolean, and one reader needs the list
 *
 * ⛔ **An owner may have more than one question open about one piece** — nothing refuses a second
 * `ask_question` while the first is unanswered — and a take-back or a close says how many it ended.
 */
export function openQuestionsByWork(
  requests: readonly RoutedRequest[],
  raised: ReadonlyMap<string, RaisedQuestion>,
): ReadonlyMap<string, readonly RoutedRequest[]> {
  const byWork = new Map<string, RoutedRequest[]>()
  for (const request of requests) {
    if (!REQUEST_IS_OPEN[request.state]) continue
    const named = raised.get(request.requestId)?.piece ?? null
    if (named === null) continue
    const held = byWork.get(named)
    if (held === undefined) byWork.set(named, [request])
    else held.push(request)
  }
  return byWork
}

/**
 * ⛔ **The bound the walk refuses at**, and the answer to *"is a cycle impossible or refused?"* —
 * **refused**, and here.
 *
 * ⚠️ **A cycle is also unreachable today, and saying so is not the same as guarding.** A
 * conversation's parent is written exactly once, inside `createTx`, in the same transaction as the
 * row's INSERT; the child's id is minted before its slot is reserved so a give cannot name an
 * existing conversation as the child; no re-parent path exists; and `ancestorsOf`'s own CTE bounds
 * at 64 while `maxDepth` defaults to 6. ⛔ **All four of those are properties of code that could
 * change, and a walk that relied on them would hang rather than refuse when one did** — which is the
 * judgement `ancestorsOf`' bound already records.
 *
 * ⚑ **8 rather than 64**, because this walks a chain of conversations that are waiting on each other
 * and `maxDepth` defaults to 6: a chain of eight is already past the default, and a bound that is
 * reachable only by a defect should be small enough that the defect is obvious.
 */
export const CHAIN_HOP_LIMIT = 8

/**
 * 🔴 **Walk up from the conversation that asked, and say who owes what** (398).
 *
 * ⛔ **A fold, not a stored string.** `394` routed the questions and `396` gave a parent a reader for
 * them; the chain is those rows read transitively, and nothing here is written down anywhere.
 *
 * ⚠️ **The lookup is handed in rather than reached for**, which is what keeps this module free of a
 * database exactly as {@link deriveRoutedRequests} is. `openQuestionOf` answers *"is this
 * conversation itself waiting on an answer from ITS parent?"* — one open, parent-routed request, or
 * null.
 *
 * ⛔ **`seen` is the cycle refusal and {@link CHAIN_HOP_LIMIT} is the backstop**, and they are not
 * redundant: `seen` catches a loop, the limit catches a chain that is merely absurd. Either one
 * leaves `endsWithAPerson` false, because what the walk found was not an ending.
 *
 * ## 🔴 474 · `seen` held CONVERSATIONS and REQUEST IDS in one set, and that was a defect
 *
 * ⛔ **A provider's request id is session-local and this walk crosses conversations.** Codex's is a
 * JSON-RPC `RequestId` rendered by `requestKey` as `number:1` for the first server request of every
 * connection, so two conversations blocked on their first question both carry `number:1`; Claude's
 * is an SDK `toolUseID`, *"unique per tool call and scoped to the turn that raised them"*. ⚠️ **So
 * `seen.has(next.requestId)` compared two ids minted in two different namespaces**, and a parent
 * whose open question happened to share a descendant's id was refused as a CYCLE — the walk stopped,
 * `endsWithAPerson` went false, and the queue drew *"the chain above this could not be followed"*
 * over a chain that was perfectly followable. 🔴 `463` F2, on the reader nobody had looked at.
 *
 * ⛔ **The half is REMOVED rather than re-keyed**, and that is the honest version. Keyed by
 * `(conversation, request)` it could never fire: `openQuestionOf(cursor.parent)` answers with a
 * request whose `askedBy` IS `cursor.parent`, so a repeated pair implies a repeated conversation and
 * the line above has already returned. ⚑ A conjunct no input can make fail is not carrying a rule
 * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`); the conversation set is the rule, and it
 * is the one that was always doing the work.
 */
export function escalationChain(
  from: RoutedRequest,
  openQuestionOf: (sessionId: string) => RoutedRequest | null,
): EscalationChain {
  // 🔴 **611 · a question addressed to a PERSON has no hop above it** (HO-088 §2.3).
  //
  // ⛔ **The walk asks *who owes this answer*, and for an addressed question the answer is the
  // person from the first link on.** ⚠️ Walking to `parent` anyway would draw *"Ali waiting on
  // Ada, Ada waiting on you"* about a question Ada was never asked and is not waiting on — a chain
  // that names a conversation as an answerer this app did not ask, which is exactly the sentence
  // {@link decisionReading} exists rather than to print.
  //
  // ⚑ **And it is that reader's argument, not a new one**: *"a request refused entry to the
  // channel was ALWAYS a person's and no parent ever had a chance to answer it."* `HO-088` §2
  // adds a second way for that to be true, and the walk has to honour both.
  const links: EscalationLink[] = [
    {
      waiting: from.askedBy,
      requestId: from.requestId,
      on: from.went.to === 'a-person' ? null : from.parent,
    },
  ]
  if (from.went.to === 'a-person') return { links, endsWithAPerson: true }
  const seen = new Set<string>([from.askedBy])
  let cursor = from
  while (links.length < CHAIN_HOP_LIMIT) {
    // ⚑ **611 · a conversation nobody spawned ends the walk at the person** — see
    // {@link RoutedRequest.parent}. ⛔ It is the ordinary ending and not a refusal: there is no
    // hop above a top-level conversation, so nothing above it is unknown.
    const next = cursor.parent === null ? null : openQuestionOf(cursor.parent)
    // ⚑ **The ordinary ending**: the conversation that owes the answer is not itself blocked, so it
    // is the one a person has to move.
    if (next === null) return { links, endsWithAPerson: true }
    // ⛔ **A CONVERSATION seen twice is a cycle**, and it is refused rather than walked — see the
    // docblock for why the request id is no longer asked the same question.
    if (seen.has(next.askedBy)) return { links, endsWithAPerson: false }
    seen.add(next.askedBy)
    links.push({ waiting: next.askedBy, requestId: next.requestId, on: next.parent })
    cursor = next
  }
  return { links, endsWithAPerson: false }
}

/**
 * 🔴 **One hop of the chain as a person reads it: who is waiting, and who owes the answer** (401).
 *
 * ⛔ **The names are resolved, and that is the whole reason this crosses the wire.** {@link
 * EscalationLink} carries `sess_<uuid>`s, and the only party that can turn one into a word is the
 * one holding the ledger — {@link RoutedRequest.askedBy} names a conversation a WINDOW may not be
 * running, so a renderer given links alone can only print ids for exactly the conversations a
 * person is least able to recognise.
 */
export interface ChainHop {
  /** The conversation that is waiting, named — its agent's name since `734` (R41). */
  readonly waiting: string
  /**
   * ⛔ **Who owes the answer — and `null` is YOU**, the one answerer that is not a conversation.
   *
   * ⚠️ **Null rather than the word**, for {@link RoutedRequest.escalatedAt}'s reason: a surface that
   * had to compare a name against the string `'you'` would say *you* about an agent — or, with no
   * agent, a working folder — that happened to be called that.
   */
  readonly on: string | null
}

/**
 * 🔴 **The chain, named and hop by hop** (401) — the shape {@link chainSentence} is a join of.
 *
 * ⛔ **One derivation, two renderings.** `398` shipped the sentence and said a surface wanting to
 * *"say it differently — a list, a tree, a badge"* has {@link EscalationChain.links}; `401` measured
 * that it has the links and no NAMES, so the alternative rendering was ids. This is the missing
 * half, and the sentence is now built out of it so the two cannot disagree about a chain.
 */
export interface ChainReading {
  /**
   * ⛔ **Asker first, and the last hop is the one a person owes** — so a chain of one is two hops
   * (*worker waiting on pm*, *pm waiting on you*) and reads as a chain rather than as a stub.
   */
  readonly hops: readonly ChainHop[]
  /**
   * ⛔ **The walk was STOPPED rather than ended, so nothing above the last hop is known** — a cycle
   * or {@link CHAIN_HOP_LIMIT}. ⚠️ True and `hops` never ends at `null`: a surface must not name a
   * person as the answerer on the strength of a walk that never reached one.
   */
  readonly unfollowable: boolean
}

/**
 * 🔴 **Read the chain into named hops** (401), with the same `name` the sentence is given.
 *
 * ⚠️ **`endsWithAPerson` alone does not settle it.** An empty `links` is unreachable from
 * {@link escalationChain} and still legal in the type, and the sentence has always refused to print
 * *"you"* for one — so the `undefined` check is the second conjunct here exactly as it was there.
 */
export function chainReading(
  chain: EscalationChain,
  name: (sessionId: string) => string,
): ChainReading {
  // ⚑ **611 · a link that owes nobody is already the person's hop** — see {@link EscalationLink.on}.
  const hops: ChainHop[] = chain.links.map((link) => ({
    waiting: name(link.waiting),
    on: link.on === null ? null : name(link.on),
  }))
  const last = chain.links[chain.links.length - 1]
  if (chain.endsWithAPerson && last !== undefined) {
    // ⛔ **611 · nothing is appended when the last link already ends at the person.** ⚠️ The push
    // exists to turn *"X waiting on Y"* into a chain that says what Y owes; a link whose `on` is
    // null has no Y, and appending would have called `name(null)`. ⚑ `unfollowable` stays false:
    // the walk ENDED, which is what that field is about.
    if (last.on !== null) hops.push({ waiting: name(last.on), on: null })
    return { hops, unfollowable: false }
  }
  return { hops, unfollowable: true }
}

/**
 * 🔴 **The chain as a sentence a person reads** (398) — HO-007 criterion 11's evidence line.
 *
 * ⛔ **The names are handed in.** A conversation has no title column; to a person it is its agent's
 * name (R41, since `734` — the basename of its working directory before) and to an agent it is its
 * agent's name and the piece it owns (D-016 · commit 7 · R3 — `sess_<uuid>` before), and which of
 * those a surface wants is the surface's business. ⚑ This owns the SHAPE of the sentence so two
 * surfaces cannot render one chain two ways.
 *
 * ⚠️ **`waiting on you` is appended only when the walk ENDED.** A chain that was refused says so
 * instead — printing *"you"* after a cycle would name a person as the answerer on the strength of a
 * walk that never reached them.
 *
 * ⚑ **A join of {@link chainReading} since `401`, and not a second walk.** The bytes it produces are
 * unchanged; what changed is that the surface drawing hops and the surface printing the line are
 * reading one derivation, which is the property `398`'s own note claimed for `links` and could not
 * deliver because links carry no names.
 */
export function chainSentence(chain: EscalationChain, name: (sessionId: string) => string): string {
  return readingSentence(chainReading(chain, name))
}

/**
 * 🔴 **A reading, joined into the line a person reads** (403) — lifted out of {@link chainSentence}
 * unchanged, because a second population now renders one.
 *
 * ⛔ **The JOIN is what both populations share, and the WALK is what they do not.** An escalated
 * question is a walk up the parents; a request only a person can settle never travelled and has
 * exactly one hop. ⚑ Giving the second its own sentence function would be two spellings of
 * *"X waiting on Y"*, free to disagree the day either is reworded — which is the drift
 * {@link chainReading} was extracted at `401` to make impossible one layer up.
 *
 * ⚠️ **`waiting on you` is still the null hop and never a name.** See {@link ChainHop.on}: an agent
 * — or a working folder — called `you` must not be able to impersonate the person.
 */
export function readingSentence(reading: ChainReading): string {
  const clauses = reading.hops.map((hop) => `${hop.waiting} waiting on ${hop.on ?? 'you'}`)
  if (reading.unfollowable) clauses.push('and the chain above that could not be followed')
  return clauses.join(', ')
}

/**
 * 🔴 **The chain for something that never travelled: one hop, and it ends at you** (403, from
 * `402` F1).
 *
 * ⛔ **A permission has no middle, whatever the depth.** A question may travel — worker to PM to a
 * person — because knowledge escalates; authority does not, so a request refused entry to the
 * channel was ALWAYS a person's and no parent ever had a chance to answer it. ⚠️ **So the walk is
 * not shortened here; there is no walk.** Rendering a PM link for one would name a conversation as
 * an answerer that this app has refused, by rail, to ask.
 *
 * ⚑ **`unfollowable` is false and that is a fact rather than a default.** The walk is not *stopped*
 * — a cycle or {@link CHAIN_HOP_LIMIT} — it is complete in one step, so a surface may print
 * *"you"* after it. See {@link ChainReading.unfollowable} for the state this is not.
 *
 * ⚠️ **A chain of one is still a chain** (`401` §2), which is why this returns a reading rather
 * than a bare name: the surface that draws hops and the surface that prints the line read one
 * derivation for both populations.
 */
export function decisionReading(
  /** 🔴 **The conversation that is waiting**, by id (403's shape, one argument narrower). */
  askedBy: string,
  name: (sessionId: string) => string,
): ChainReading {
  return { hops: [{ waiting: name(askedBy), on: null }], unfollowable: false }
}

/**
 * 🔴 **One request only a person can settle, as a person reads it** (403, from `402` F1 and
 * HO-018 §5 item 3).
 *
 * ⛔ **A sibling of {@link PersonsQuestion} and deliberately NOT a widening of it.** The two carry
 * different guarantees and the difference is the reason there are two readers:
 *
 *  - {@link PersonsQuestion} is *a question that TRAVELLED to a parent and went unanswered past its
 *    deadline*. Its chain is a walk, its age is `escalatedAt`, and a parent may still answer it.
 *  - **This** is *a request that never travelled at all*. Its chain is one hop, its age is the
 *    routing's own `at`, and no parent may ever answer it — {@link RuntimeHost.answerQuestion}
 *    refuses one BY NAME.
 *
 * ⚠️ **Merging them would have widened `questionsForAPerson`, which carries criterion 10's
 * negative.** A predicate that answers several questions widens all of them at once; the strict
 * reader stays strict and this is the named second one.
 */
export interface PersonsDecision {
  /** The routed request itself — open, and never travelled. */
  readonly request: RequestOnlyAPersonCanSettle
  /**
   * ⛔ **One hop, ending at you** — see {@link decisionReading} for why there is never a second.
   */
  readonly reading: ChainReading
  /** The reading joined: *"worker waiting on you"*, always, whatever the depth. */
  readonly sentence: string
  /**
   * ⛔ **What kind of thing it is, in words, from {@link CHANNEL_REFUSAL_SENTENCES}** — *"a command
   * or file approval, which is a person's to give"*.
   *
   * ⚑ **Rendered main-side, and that is a decision about the renderer's weight rather than a
   * preference.** The sentences are a value in `@brobot2/runtime`; a renderer importing them to
   * turn `because` into prose would pull that package into the window bundle for five strings.
   * ⚠️ **The map's own docblock says these are for *a person or a test* and never for a model** —
   * a model reads `because` itself, which is the word `answer_question` refuses with.
   */
  readonly says: string
  /**
   * 🔴 **The open work the asking conversation is holding** (434) — {@link PersonsQuestion.work}'s
   * twin, carried on both populations because criterion 20 asks *about which work* of anything
   * waiting on a person and does not care which reader found it.
   */
  readonly work: readonly WorkInHand[]
  /**
   * The request as its card draws it, read from the asking conversation's record — present only
   * while that conversation runs with no window holding it, so a person can answer it from the
   * queue without opening it.
   */
  readonly card?: CardNobodyHolds
}

/** A request a provider raised and a card answers: a permission, or its own question. */
export type ProviderRequestEvent = Extract<
  TranscriptEvent,
  { type: 'permission_request' | 'user_input_request' }
>

/** A request in a conversation no window holds, with what its card's words depend on. */
export interface CardNobodyHolds {
  readonly asked: ProviderRequestEvent
  readonly provider: Provider
  /** The identity the conversation runs as. */
  readonly profileId: string
}

/**
 * 🔴 **What NARROWED one walk over ledgers — the fact `434-relay-1` does not carry** (453,
 * HO-024 criterion 17's *everything*). ⚑ 467 and 466 both extended this register while the other
 * was in flight; this is the one account of it, and neither side's is left standing beside it.
 *
 * ## ⛔ It was `QUEUE_WALKS`, and 467 had already written down why that name was wrong
 *
 * ⚠️ **466 is why the name could not stay.** A digest word inside a constant called `QUEUE_WALKS`, keyed
 * into a table called `WALK_COVERS`, is exactly the shape
 * `the-artefact-you-resolve-through-can-carry-the-defect` names — the artefact every reader
 * resolves through, spelling the one thing it is not. ⛔ **Nothing about the members moved with
 * the name.**
 *
 * ## 🔴 The eleven words, and what each one narrowed
 *
 * | the word | ledgers it opened | what else narrowed what it read |
 * |---|---|---|
 * | `every-conversation-that-routed` | every conversation in this app that ever routed a request | the live projection |
 * | `one-window-over-every-agents-conversation` | every conversation one of this app's agents holds | the live projection, **and a clock** |
 * | `every-conversation-this-app-placed` | **the same conversations as the row above**, newest first | the live projection, **and a LIMIT** |
 * | `every-conversation-this-one-gave-work-to` | every conversation one conversation ever gave work to | the live projection |
 * | `every-conversation-this-one-spawned` | every conversation this app recorded as started by one conversation | nothing — **no ledger row is read at all** |
 * | `every-piece-of-work-this-one-was-given` | one conversation's own ledger | the live projection |
 * | `every-conversation-that-was-given-work` | every conversation in this app another conversation ever gave work to | the live projection |
 * | `every-conversation-that-holds-work` | every conversation that holds work, including roots | the live projection, open pieces only |
 * | `every-provider-wall-recently-recorded` | every conversation in this app, for their error rows only | a clock, and the three phrases a provider walls in — **not** the live projection |
 * | `no-such-conversation` | none — this app holds no conversation by that id | — |
 * | `no-ledger` | none — this app has no database | — |
 *
 * ⚑ **508 · `every-conversation-this-one-gave-work-to` is the first candidate set keyed on a
 * CONVERSATION rather than on the whole app**: *"the work I gave out"* starts from the giver.
 *
 * 🔴 **557 · `every-conversation-that-was-given-work` is that word with the GIVER taken out**, and
 * it is the first candidate set over the whole app that opens ledgers whole. ⛔ A person is not
 * inside one family, so a reader on their behalf cannot start from one conversation — the same
 * reason `questionsAPersonMustAnswer` reads every conversation that routed rather than one parent's
 * children.
 *
 * 🔴 **533 · `every-provider-wall-recently-recorded` is the first candidate set that is ROWS
 * rather than conversations, and the first whose narrowing is NOT the live projection.**
 * `providerLimitsSeen` reads the error rows of
 * every ledger at once and deliberately does not scope to the active generation: a wall is a fact
 * about the provider's account, so a rebuilt projection has not un-spent the window. ⚠️ **That is
 * why it earns a word rather than borrowing one** — every sentence above carries the generation
 * clause and this read cannot make that promise.
 *
 * ⚑ **543 · two more candidate sets and one more emptiness, and the ORDINALS above are gone
 * rather than renumbered.** `every-conversation-this-one-spawned` is the first member that opens no
 * ledger at all — lineage is three columns of a `provider_session` row — and
 * `every-piece-of-work-this-one-was-given` is the first whose candidate set is a SINGLE ledger, its
 * own, so its `ledgers` is 1 by construction. ⛔ `no-such-conversation` answers for the LINEAGE half
 * alone.
 *
 * ⚑ **A census reads this table back against the array**, so an ELEVENTH word that nobody wrote a
 * row for fails rather than reading as covered — `a-pointer-clause-is-a-claim`. ⚠️ **Two sentences
 * above used to number their subject** — *the fifth*, *the sixth* — **and `543` replaced the
 * ordinals with the words themselves**, because an ordinal is a number in prose and this register
 * gains members: `a-number-can-survive-the-death-of-its-derivation`, which had already made the
 * count in the heading wrong twice. ⛔ The heading's COUNT stays a count on purpose: `466 M24`
 * mutates it, and the census derives the numeral from the array.
 *
 * ## ⛔ A member is a (candidate set, NARROWING) pair — which is what both sides had to change
 *
 * 🔴 **This used to say *a member per POPULATION*, and it used to say the candidate set was *the
 * only thing that narrows this read*. Neither survives**: the digest and the forest open the SAME
 * conversations — every one an agent of this app holds — and each narrows them differently, the
 * digest by a clock and the forest by a limit.
 *
 * ⚠️ **So two words over one candidate set is legal, and ONLY because each narrowing makes a
 * sentence the other cannot say.** ⛔ Reusing one word for both would ship one read's promise over
 * the other — a false sentence rather than a shortcut, which is the failure this vocabulary exists
 * to stop and the one nothing goes red for.
 *
 * ⛔ **The discipline, restated so the next member can be judged against it: a walk needs a word
 * of its own when no existing word's {@link WALK_COVERS} sentence is TRUE of it.** ⚑ That still
 * makes a new population a new word — no sentence about another population is true of it — and it
 * now makes a new narrowing one too. {@link WALK_COVERS} is exhaustive over the type, which is
 * `NOUN_OF_KIND`'s discipline one layer down and `448`'s argument verbatim: *a member fails
 * to compile until somebody has decided what a list folded through it is.*
 *
 * ⚠️ **The two words over one candidate set are deliberately NOT substrings of one another.** The
 * moment two words describe one population, an assertion written against either can be satisfied
 * by the other — `an-assertion-can-be-satisfied-by-a-neighbouring-element`.
 *
 * ## ⚑ The three ways a walk can answer NOTHING
 *
 * 🔴 **`rows: []` is three different facts, and the word plus {@link LedgerWalk.ledgers} is the
 * whole of what tells them apart:**
 *
 * 1. ⛔ **`no-ledger`** — this app has no database at all. `NULL_SESSION_STORE`.
 * 2. ⛔ **a reading word with `ledgers: 0`** — there was nothing to open.
 * 3. ⛔ **a reading word with `ledgers: 47`** — forty-seven conversations, and they said nothing.
 *
 * ⚠️ **Only the first is a word; the second and third are one word told apart by a count.** ⛔ That
 * is the entire reason {@link LedgerWalk.ledgers} is taken from the candidate query and never from
 * the rows — a count folded out of `rows` answers `0` to both of them.
 *
 * ## ⛔ The defect it closes, and it is the empty case
 *
 * ⚠️ **`434-relay-1` settled the WINDOW and nothing else.** It measured, against a real database,
 * that neither statement in this path carries a time bound, a `LIMIT` or a page — *"the waiting set
 * can be read completely at any age"* — and `the-queue-is-complete-regardless-of-age.test.ts` pins
 * both statements so a `created_at >=` added later goes red. ⛔ **That is a fact about AGE. It says
 * nothing about SCOPE**, and an unwindowed read can still be short because it walked the wrong
 * ledgers, walked none, or could not finish walking one.
 *
 * 🔴 **And the empty case is the one a person reads most often**, because it is the one that lets
 * them stop looking. `personsQueueView` draws *"Nothing is waiting on you"* at zero rows, and before
 * this vocabulary existed that sentence was the same bytes whether the reader had walked every
 * ledger in the workspace or had no database at all — `NULL_SESSION_STORE` answers `[]` to all
 * three readers, and `[]` is what *"the workspace is quiet"* is drawn from.
 *
 * ## ⚑ 448's shape, and deliberately not a second invention of it
 *
 * ⛔ **`448` met this exact problem one surface over and its commit is named for it** — *a count
 * that says what it counted*. `447` proved that *the list was filtered* and *the list was stale* are
 * the same bytes from outside, and `448`'s answer was a WORD the fold itself used plus a sentence
 * keyed on it (`count_covers`). ⚠️ This is that shape with the axis changed: there
 * is no grant to report here — a person reaches everything — so the word names what narrowed the
 * read, starting with the candidate set it opened.
 */
export const LEDGER_WALK_KINDS = [
  /**
   * ⛔ **Every conversation in this database that has ever routed a request** —
   * `SELECT DISTINCT session_id FROM events WHERE type = 'request_routed'`, which is the candidate
   * set `questionsAPersonMustAnswer` and `decisionsAwaitingAPerson` both start from.
   */
  'every-conversation-that-routed',
  /**
   * 🔴 **Every conversation one of this app's agents holds, read only inside one stretch of the
   * clock** (466; one list since D-016) — `selectDigestWindow`: `provider_session` whose
   * `agent_identity_id` is set, and `created_at >= ? AND < ?`.
   *
   * ⛔ **The first member that is NOT a population of its own.** The forest's word below opens the
   * same conversations and reads the whole of each; this reads a window out of each. ⚑ Two words,
   * because the forest's sentence promises *no window* and this read cannot inherit that promise.
   *
   * ⚠️ **The candidate set is every such conversation and NOT the conversations that produced a
   * row** — `WindowDigest.sessions` is the second number and it is counted off the rows. ⚑ Forty-seven
   * conversations and a quiet night is `ledgers: 47, sessions: 0`, and those are two different
   * facts that `rows.length` answers `0` to for both.
   *
   * ⛔ **Not a substring of the word below and not a superstring of it**, deliberately — see the
   * register's own note on `an-assertion-can-be-satisfied-by-a-neighbouring-element`.
   */
  'one-window-over-every-agents-conversation',
  /**
   * 🔴 **Every conversation one of this app's agents holds, BOUNDED** (637 §2.2) — every row, newest
   * first, up to `MAX_FOREST_CONVERSATIONS`.
   *
   * 🔴 **The LIMIT is why this may not be the digest's word read wider.** ⚠️ Every
   * other sentence in {@link WALK_COVERS} that READS anything promises *no limit*; this one cannot, and a
   * walk inheriting a promise it breaks is the defect `466` spent a word to avoid. ⛔ **Past the
   * bound the answer is SHORT and never a refusal** — `TheWholeForest.conversations` beside
   * {@link LedgerWalk.ledgers} is how short, and a drawn conversation whose parent fell outside
   * says so in a word rather than pointing at nothing.
   *
   * ⚠️ **A conversation no agent of this app holds is in no forest** — `agent_identity_id IS NULL`,
   * the population `TheWholeForest.heldByNoAgent` discloses. ⛔ Excluded by the candidate query
   * rather than dropped by a filter.
   */
  'every-conversation-this-app-placed',
  /**
   * 🔴 **Every conversation this one has ever GIVEN WORK TO** (508) —
   * `SELECT DISTINCT owner_session_id FROM work WHERE given_by_session_id = ?`, served by
   * `work_given_by_idx` (D-016; a scan of the ledger for task rows until then).
   *
   * ⛔ **Not a narrowing of the words above, and the candidate set is why.** This one starts from
   * the giver and follows the work wherever it went; the `work` table carries no generation, because
   * a piece is a row written once.
   *
   * ⚠️ **The ledgers it opens ARE read at their live projection**, unlike the candidate query:
   * `piecesOfSession` passes `activeGeneration(sessionId)`, so work whose state exists only in a
   * projection this app has replaced is not folded. ⛔ The sentence below says both halves,
   * because they are two different narrowings and only one of them is the candidate set's.
   */
  'every-conversation-this-one-gave-work-to',
  /**
   * 🔴 **Every conversation this app recorded one conversation as having SPAWNED** (543) —
   * `SELECT … FROM provider_session WHERE parent_session_id = ?`, served by
   * `provider_session_parent_idx`, over the self-FK `341` wrote.
   *
   * ⛔ **The first member that opens NO LEDGER, and that is why it is a word rather than a
   * borrowing.** Every sentence above promises something about what was read out of a ledger;
   * lineage is one column of a `provider_session` row, written with the row, and this walk reads
   * those rows and folds nothing. ⚑ So {@link LedgerWalk.rowsUnread} is `0` here: since D-016 the
   * parent is the whole of the edge, and there is no half-written one to count.
   *
   * ⚑ **Not a narrowing of the word above it, and the two lists coincide only by accident.** A
   * conversation may give work to one it never spawned — `540` §5 measured that population and
   * named it — and may spawn one it never gives work to.
   *
   * ⚠️ **557 · this clause used to end *work is admitted by `can_message` and not by descent*, and
   * HO-060 §2 made it false.** ⚑ **Since D-014 work needs `can_assign_work` AND a conversation the
   * giver started**, and since D-016 a give starts the conversation it gives to when there is none,
   * so descent is the relationship rather than the thing the gate ignores. 🔴 **The two lists still
   * differ**: a conversation may start one it never gives more work to once the first piece ends.
   */
  'every-conversation-this-one-spawned',
  /**
   * 🔴 **One conversation's own ledger, read whole, for the work it was GIVEN** (543) —
   * `piecesOfSession(sessionId)`, which is `selectPieceEvents` at that conversation's active
   * generation.
   *
   * ⛔ **The other END of the work edge, and it is not the word above narrowed.**
   * `every-conversation-this-one-gave-work-to` opens the ledger of everybody this conversation gave
   * work to; this opens exactly one — its own — because {@link PieceRow.owner} is *the ledger
   * this row was folded from*. ⚑ So {@link LedgerWalk.ledgers} is always 1 here, which is a fact
   * about the shape rather than about the workspace, and a reader must not read it as a count of
   * anything a person did.
   *
   * ⚠️ **The generation clause is the one it shares with its neighbours**: work that exists only in
   * a projection this app has replaced is not folded.
   */
  'every-piece-of-work-this-one-was-given',
  /**
   * 🔴 **Every conversation in this database that another conversation has ever GIVEN work** (557)
   * — `SELECT DISTINCT owner_session_id FROM work WHERE given_by_session_id IS NOT NULL` (D-016 ·
   * commit 6): never a root's owner for its root, nor for work it took on for a person — no giver
   * waits on either (R1).
   *
   * ⛔ **It is `every-conversation-this-one-gave-work-to` with the GIVER taken out, and that is
   * what makes it a word rather than a borrowing.** That set starts from one conversation and
   * follows what it handed out; this one starts from nobody, because a person is not inside one
   * family — the same reason `questionsForAPerson` reads every conversation that routed rather
   * than one parent's children.
   *
   * ⚠️ **The OWNER, so these are the ledgers the work LANDED in** — the half a sweep reading the
   * givers would get backwards: a stall is folded from the HOLDER's rows.
   *
   * ⚑ **The ledgers are read at their live projection**, like every other word here that opens
   * one, so work that exists solely in a projection this app has replaced is not folded.
   */
  'every-conversation-that-was-given-work',
  /**
   * 🔴 **Every provider wall this app has recorded inside its own lookback** (533) —
   * `SELECT … FROM events WHERE type = 'error' AND created_at >= ?`, served by
   * `events_error_idx`, across every conversation in the database.
   *
   * ⛔ **The first member whose candidate set is ROWS rather than conversations, and it is a
   * different narrowing from every word above.** Those open a list of ledgers and fold each one
   * whole; this one reads the error rows themselves, from every ledger at once, and the ledgers it
   * touched are counted off the same predicate. ⚑ Two of the words above already prove a walk earns
   * its own entry when what it NARROWS differs — a window over the same ledgers is a second word —
   * and this narrows by the clock and by the event type.
   *
   * ⚠️ **It is NOT scoped to the live projection, and that is the one place it differs from its
   * neighbours.** A wall is a fact about the provider's account rather than about a conversation, so
   * a rebuilt projection does not un-say it: the provider's window is still spent. ⛔ The clause is
   * therefore absent from the sentence rather than copied into it, because it would be false here.
   */
  'every-provider-wall-recently-recorded',
  /**
   * 🔴 **Nothing was walked, because this app holds no conversation by that id** (543).
   *
   * ⛔ **It answers for the LINEAGE half and for nothing else, and that is measured rather than
   * hedged.** A parent and a child are columns of `provider_session`, and the work walks answer
   * with their own words — the work a conversation gave or holds is read off `work` and its owners'
   * ledgers, whatever this word says about its lineage.
   *
   * ⚑ **The sentence it stops this app from saying** is `452` §5.1's, one noun over: *nothing was
   * spawned from here*, drawn out of an id this app has never seen.
   */
  'no-such-conversation',
  /**
   * 🔴 **Nothing was walked, because this app has no ledger to walk** — `NULL_SESSION_STORE`.
   *
   * ⛔ **The reachable false case, and the reason this vocabulary is not decoration.** That store
   * answers `[]` to all three readers, with the same bytes a workspace where genuinely nothing is
   * waiting answers — so *"Nothing is waiting on you"* was drawn out of *"I have no database"* and
   * nothing anywhere could tell the two apart.
   */
  'no-ledger',
  'every-conversation-that-holds-work',
] as const

/** One of {@link LEDGER_WALK_KINDS}. */
export type LedgerWalkKind = (typeof LEDGER_WALK_KINDS)[number]

/**
 * 🔴 **What each walk COVERS, in words a person reads** — `448`'s reach sentences, one axis over.
 *
 * ⛔ **Each sentence is about the WALK and never about what it found.** A count is what it found;
 * this is the question that produced it, which is the half `rows.length` can never supply. ⚑ Same
 * rule `448` stated for its own: *each sentence says what the LIST is, never what the caller
 * may do about it.*
 *
 * ⚠️ **The generation clause is in every sentence that read a ledger, and it is the one narrowing
 * they share.** `routedRequestsOfSession`, `piecesOfSession` and `selectDigestWindow` all read the
 * ACTIVE generation — *"a superseded projection's rows are
 * garbage, not history"* — so a row that exists only in a projection this app has replaced is not
 * counted. ⛔ Leaving it out would make *"whole workspace"* the strongest claim in the app and a
 * false one.
 *
 * 🔴 **466 · the forest's sentence carries it too.** Its rows are conversations, and the generation
 * cannot remove one of those — but each conversation's open work is folded through `piecesOfSession`
 * at `activeGeneration(sessionId)`, so a conversation whose piece rows live only in a replaced
 * projection is drawn with NO open work beside it. ⛔ The narrowing lands one field in, on `work`,
 * and the sentence says so.
 */
export const WALK_COVERS: Readonly<Record<LedgerWalkKind, string>> = {
  'every-conversation-that-routed':
    'Every conversation in this app that has ever routed a request was read: no window, no page and no limit narrowed it. Only each conversation’s live projection is read, so a request that exists solely in one this app has replaced is not counted.',
  'one-window-over-every-agents-conversation':
    'Every conversation one of this app’s agents holds was read, and from each one only the rows stamped inside the window you chose: no page and no limit narrowed it further. Only each conversation’s live projection is read, so a row that exists solely in one this app has replaced is not counted.',
  // 🔴 **The one READING sentence in this table that does NOT promise *no limit*, and it says the
  // number** — the three `no-…` words promise nothing because they read nothing
  // (637 §2.2). ⛔ Every other entry can promise it; this walk is bounded at
  // `MAX_FOREST_CONVERSATIONS` and a sentence inheriting a promise it breaks is exactly what
  // `466` spent a word to avoid. ⚑ The clause about a parent that fell outside is what keeps the
  // picture honest: the tree is short at the TOP, which is the end a person would not notice.
  //
  // ⚠️ **The number is WRITTEN OUT and pinned rather than interpolated**, which is this table's own
  // device one entry down: `every-provider-wall-recently-recorded` spells `PROVIDER_WALL_LOOKBACK_MS`
  // as *"the last month"* because importing the value would be a cycle — `the-whole-forest.ts`
  // takes `LedgerWalk` from this module, so a value import back is the same cycle with the arrow
  // reversed. ⛔ `the-whole-forest.test.ts` §4 asserts this sentence still contains the constant,
  // which is what stops `a-number-can-survive-the-death-of-its-derivation`.
  'every-conversation-this-app-placed':
    'Every conversation one of this app’s agents holds was read, whether or not anything is waiting in any of them: no window narrowed it. Newest first, up to 500 of them — past that the forest is short, it says how many conversations there are, and a drawn conversation whose parent was not reached says so rather than pointing at nothing. A conversation no agent of this app holds is in no forest and is counted separately. Only each conversation’s live projection is read, so work that exists solely in one this app has replaced is not drawn beside it.',
  'every-conversation-this-one-gave-work-to':
    'Every conversation this one has ever given work to was read, whether or not anything is still open in it: no window, no page and no limit narrowed it. Only each of those conversations’ live projections is read, so work that exists solely in one this app has replaced is not counted.',
  // ⛔ **The one sentence in this table that promises nothing about a ledger, because this walk
  // opens none** — see this word's own entry.
  'every-conversation-this-one-spawned':
    'Every conversation this app recorded as started by this one was read, whether or not this app is still running it: no window, no page and no limit narrowed it. No conversation’s record was opened, so nothing here is folded from a transcript.',
  'every-piece-of-work-this-one-was-given':
    'This conversation’s own record was read whole for the work it was given, whoever gave it: no window, no page and no limit narrowed it. Only its live projection is read, so work that exists solely in one this app has replaced is not counted.',
  'every-conversation-that-holds-work': 'Every conversation that holds work, including roots.',
  'every-conversation-that-was-given-work':
    'Every conversation in this app that another conversation has ever given work to was read, whichever one gave it: no window, no page and no limit narrowed it. Only each conversation’s live projection is read, so work that exists solely in one this app has replaced is not counted.',
  // ⛔ **"the last month" is a SPELLING of `PROVIDER_WALL_LOOKBACK_MS` and not a second opinion
  // about it** — `a-wall-he-finds-out-about.test.ts` §1 pins the two against each other, which is
  // this repository's own device for a constant that cannot be imported without a cycle (331).
  // ⚑ The generation clause every sentence above carries is deliberately absent; see this word's
  // own entry in `LEDGER_WALK_KINDS` for why it would be false here.
  'every-provider-wall-recently-recorded':
    'Every conversation in this app was read, and from all of them together the moments a provider reported a limit inside the last month: no page narrowed it. A wall whose window has already reset is not counted, and neither is one this app recorded before that stretch began.',
  'no-such-conversation':
    'Nothing was read, because this app holds no conversation by that id. An empty list here is a statement about the id that was asked for and not about what anybody spawned or was given.',
  'no-ledger':
    'Nothing was read, because this app has no ledger open. An empty list here is a statement about this app and not about what is waiting on you.',
}

/**
 * 🔴 **{@link WALK_COVERS}, read fail-closed** (472, spending `467` F7).
 *
 * ## ⛔ Why a lookup that cannot miss needs a function
 *
 * ⚠️ **The type says it cannot miss and the WIRE says otherwise.** `preload/index.ts` casts —
 * `command({…}) as Promise<…>` — and nothing between the host and a fold validates the word that
 * arrives, so a {@link LedgerWalkKind} this build does not spell is reachable the moment the two
 * sides are not the same build. ⛔ `WALK_COVERS[walk]` then answers `undefined`, which type-checks,
 * and a surface that draws it prints the word **undefined** where a sentence about what was read
 * belongs.
 *
 * ⚑ **`438` ruled the neighbouring register must be fail-closed and `467` filed this one as F7.**
 * The ruling is here: a word with no sentence is **not an answer**, and a caller treats it exactly
 * as it treats a read that did not answer — it does not draw the rows as an authoritative list and
 * it does not claim the list is empty.
 *
 * ⛔ **`persons-queue.ts` still reads the record directly and that is UNCHANGED by this dispatch**
 * ({@link QueueCoverage.says} is typed `string`, so making it honest widens a field `453`'s surface
 * and four of its tests read). 🔴 **F7 is open for that caller and closed for this one.**
 */
export function walkCovers(walk: LedgerWalkKind): string | null {
  return WALK_COVERS[walk] ?? null
}

/**
 * 🔴 **One walk over ledgers: what it covered, how many it read, how many it could not, and what it
 * found** (453).
 *
 * ⛔ **The three counts are computed from the QUERY and never from {@link LedgerWalk.rows}.**
 * {@link ledgers} is the candidate set's own size — the number of conversations the walk opened —
 * so `ledgers: 47, rows: 0` is *forty-seven ledgers say nothing is waiting* and `ledgers: 0` with
 * `LedgerWalkKind` `every-conversation-that-routed` is *nothing in this app has ever routed a
 * request*. ⚠️ Those are different facts and `rows.length` is `0` for both of them, and for
 * `no-ledger` as well.
 *
 * ⚑ **Shared by the store and the host rather than translated between them**, for
 * `MessageRefusalDetail.reach`'s reason exactly (`448`): the party that WALKED is the only one that
 * can say what it walked, and a second derivation one layer up could answer a number the walk never
 * used.
 */
export interface LedgerWalk<Row> {
  /** What the walk found, in the reader's own order. */
  readonly rows: readonly Row[]
  /** Which candidate set it started from — see {@link LEDGER_WALK_KINDS}. */
  readonly walk: LedgerWalkKind
  /**
   * ⛔ **How many ledgers the walk OPENED**, from the candidate query and never from the rows.
   * ⚑ Zero is a fact about the workspace on either non-`no-ledger` word, and about this app on it.
   */
  readonly ledgers: number
  /**
   * 🔴 **How many ledger ROWS the walk could not read, and therefore folded nothing from** — the
   * partial load, counted.
   *
   * ## ⛔ It was already happening and nothing above could see it
   *
   * ⚠️ **`toPersistedEvents` has skipped an unparseable row since `150`** — *"a transcript with a
   * hole is honest, a transcript with a fabricated entry is not"* — and that skip is silent to
   * every reader above it. ⛔ `150` ruled the user-facing mark BACKLOGGED on the transcript, for a
   * stated reason: it *"would need a field, a surface, and wording honest about a count we can
   * state and a cause we cannot"*. ⚑ **A queue is where that bill comes due**: a digest may be
   * scoped and a list of obligations may not, so a row this app dropped is a row a person is not
   * being told they owe.
   *
   * ⛔ **`DigestGap`'s rule — *a COUNT of the rows it is unable to speak for*** — with the cause
   * still unstated, because the cause genuinely is not known. ⚠️ **Not a count of ROWS FOUND**: an
   * unread ledger row usually folds into no queue row at all, so this number and
   * {@link LedgerWalk.rows} do not add up to anything and must not be drawn as if they did.
   */
  readonly rowsUnread: number
  /**
   * 🔴 **D-017 · R8 — how many conversations' records the walk skipped WHOLE**, because a fold over
   * one threw — present only when there were some. ⛔ Its own count, never added to
   * {@link rowsUnread}: a whole record is not one row.
   */
  readonly ledgersSkipped?: number
}
