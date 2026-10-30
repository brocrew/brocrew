import { refusalReason } from '../../shared/refusals'
import { CHANNEL_REFUSAL_SENTENCES, type ChannelRefusal } from '@brobot2/runtime'
import type { UserInputQuestion } from '@brobot2/runtime'
import {
  REQUEST_IS_OPEN,
  type QuestionRecipient,
  type RequestState,
  type RoutedRequest,
} from '../../shared/questions'
import type { RailPermanence } from './spawn-rails'
// ⚑ **425 · from `shared/refusals.ts` and not through `spawn-rails.ts`'s re-export.** That
// re-export exists so `405` could move `RailPermanence` without touching seven readers; a word
// added today has no such history and names its own home.
import type { RefusalRemedy } from '../../shared/refusals'

/**
 * 🔴 **The door an ANSWER passes, and the vocabulary it is refused in** (394, HO-007 S4).
 *
 * ## ⛔ The entitlement is structural, exactly as `393`'s is
 *
 * ⚠️ **A caller cannot spell an id that reaches a conversation it did not spawn.** The lookup is
 * `SessionStore.questionsRoutedTo(caller)` — every routing whose `parent` is the caller — so *"that
 * request is not yours"* and *"there is no such request"* arrive here as the same absence and leave
 * as the same sentence. ⛔ `refuse-on-entitlement-before-refusing-on-existence` made structural
 * rather than ordered: a rail asked in the right order can be reordered; a question that was never
 * asked of the whole database cannot.
 *
 * ⚑ **And that is also why there is no `not-your-question` rail.** Two answers would let a caller
 * walk request ids and learn which conversations are waiting on what — the defect `no-such-agent`
 * and `no-piece-by-that-name` already fold away. ⛔ **549 · `no-such-document` was named here too
 * and has stopped folding** (HO-057 §3.2): documents are open to every agent now, questions are
 * not, and this rail's own reason is unchanged.
 *
 * ## 🔴 The scope contains permissions ON PURPOSE, and that is criterion 10's instrument
 *
 * ⛔ **The obvious implementation of *"permissions cannot enter the question channel"* is to route
 * only questions and let a permission id resolve to nothing.** ⚠️ **That is the filter `394` §2
 * forbids**: the parent would meet `no-question-by-that-name`, which is the sentence for *there is
 * nothing here*, and the app would have lost the ability to say *there IS something here and it is
 * not yours to answer*. ⚑ So `RequestRoutedEvent` is written for **both** destinations, the lookup
 * finds both, and {@link QuestionRail.a-person-answers-this-one} is a rail an actual call can trip.
 *
 * ## ⚠️ A vocabulary of its own, sharing the grammar and only deliberately shared names
 *
 * `374`'s rule survives as separate properties: **sentences are unique across every rail
 * vocabulary**, while names may be shared only by the explicit census allowlist —
 * `malformed-request` and `spawning-disabled`, each owned by `SPAWN_RAILS` and `TOOL_REFUSALS`.
 * All vocabularies share the PAYLOAD — `347`'s rule that a model meets one grammar everywhere.
 */
export const QUESTION_RAILS = [
  /**
   * ⛔ **No conversation you started has a request by that id.** The causes below deliberately fold
   * to the same answer:
   *
   *  - the id names nothing anywhere;
   *  - it names a request raised inside somebody else's family;
   *  - this conversation has never spawned anything — ⚑ **the ordinary answer for a conversation
   *    with no children**, not an error path;
   *  - the id is a string no provider here has minted.
   *
   * ## 🔴 `permanent` since `424`, and the argument that stood here was about a DIFFERENT call
   *
   * ⛔ **It read:** *"`while-this-holds`, and the third cause is the reason. A conversation that has
   * spawned nothing yet may spawn something in the next minute, so the identical call can succeed
   * without anybody changing a rule."* ⚠️ **What a later spawn produces is a request id of its
   * own.** Every handle here is minted by a provider for a request it raised; the id in THIS call
   * was never routed to this family and cannot be routed to it afterwards — `RequestRoutedEvent` is
   * written when the request is raised, and nothing re-addresses one.
   *
   * ⚑ **`permanent`'s own definition is the remedy**: *change the call, not the world*, which is
   * `list_questions` and then an id it names. ⛔ HO-023 §2.1 is why it had to move: `retryable:
   * true` told a model that the same guess would eventually land (`422` row 10).
   */
  'no-question-by-that-name',
  /**
   * 🔴 **That is a person's to answer, and it is PERMANENT** (criterion 10).
   *
   * ⛔ **Knowledge escalates; authority does not.** The request exists, it belongs to a conversation
   * this caller started, and it is still not the caller's to settle — because what it asks for is a
   * decision, a grant, a consent or a secret rather than something the caller knows. ⚑
   * `detail.because` names which, in `CHANNEL_REFUSALS`' own words, so a model is told what kind of
   * thing it tried to answer rather than merely that it may not.
   *
   * ⚠️ **Permanent, and that is the strong claim it looks like.** No later state of the world makes
   * an agent able to answer a permission: it is not a grant somebody could widen — HO-007 §2.1's
   * *"the human unrestricted"* is about a PERSON, and there is no capability that turns an agent
   * into one.
   *
   * ⛔ **Asked BEFORE the ending**, deliberately: a parent that named a permission is told it is not
   * its to answer whether or not a person has already answered it. Telling it *"already ended"*
   * would answer a question about a card it may not touch, which is `340`'s finding — a reason
   * answering with another reason's sentence.
   */
  'a-person-answers-this-one',
  /**
   * ⛔ **Nobody is waiting for this answer any more** — a person or the parent settled it, the
   * provider withdrew it, the work it was about was taken back, or the conversation ended around
   * it.
   *
   * 🔴 **591 · what it does NOT mean, because for five months it did** (HO-082 §2). ⛔ **A
   * question does not end because time passed.** Both answer doors used to refuse on an in-memory
   * flag once the five-minute ask bound elapsed, and the row they were refusing about went on
   * saying somebody owed an answer — a `NEEDS YOU` a person could never clear (`589`). ⚑ **This
   * rail now fires only on {@link REQUEST_IS_OPEN}**, which is `admitAnswer`'s own note made true
   * of every caller: *a rail with its own idea of which states are endings would be free to
   * disagree with the derivation it guards.*
   *
   * ⚠️ **608 · the bound itself is gone** (HO-084 §4), so the flag, the clock and the number are
   * all out of this app — and this rail is the whole of what *already ended* means.
   *
   * ⚑ **The refusal NAMES the ending rather than saying the id was wrong** — `393`'s
   * `piece-already-ended`, one subject over. `detail.state` is one of `REQUEST_STATES`, and its closed
   * values mean different things to a caller deciding what to do next. ⚠️ **Stated without a COUNT**
   * (`396`'s rule): it said *"the four closed values"* while there were five, `397` made it more
   * and `591` made it more again — which is exactly what a sentence that counts itself always
   * does.
   *
   * 🔴 **`interrupted` is the value `397` made reachable HERE, and that is the point of the word.**
   * Before it, an interruption left the fold reading `open`, this rail did not fire, the answer went
   * to the adapter and bounced as `not-pending` — a refusal with no `detail.state` at all, because
   * the only word the ledger had was the wrong one.
   *
   * ⚠️ **PERMANENT.** A settled request is never re-opened: both providers spend the request when
   * they receive a response, and `051` added `request_resolved` precisely because a late answer to a
   * cleared request *"is an out-of-lifecycle authorization"*.
   */
  'question-has-already-ended',
  /**
   * ⛔ **The answer itself cannot be sent** — nothing chosen, a value that is not one of the offered
   * labels on a question that offers no free-form escape, or several chosen where one was asked for.
   *
   * ⚑ **Not re-implemented here.** `answerToForward` in `@brobot2/runtime` is where completeness and
   * usefulness are decided for a person's answer, both adapters refuse through it, and this rail is
   * that same refusal reaching a model instead of a card. ⛔ A second copy of the rule would be
   * `169` §1 exactly — and the copy that drifts is always the one further from the thing it
   * protects.
   *
   * ⚠️ **`while-this-holds`: the identical intent succeeds with a different answer**, which is
   * *change the call, not the world*.
   */
  'that-answer-cannot-be-sent',
  /**
   * 🔴 **A request the PROVIDER raised, and the conversation that raised it has stopped**, so
   * nobody is waiting for the answer.
   *
   * ⛔ **A pending provider request lives in the provider's process**: a stop takes it with it. A
   * resumed conversation is a NEW provider session, so no later state of the world makes this exact
   * call succeed — PERMANENT, and it is the strong claim it looks like. ⚑ *"Nothing unwired implies
   * a working state"* (criterion 15) — a `taken` for an answer that reached nobody would be exactly
   * that.
   *
   * ⚑ **D-017 · R1 — never a question this app asked**: its answer is written into its asker's
   * ledger and starts it.
   */
  'the-conversation-that-asked-has-gone',
  /**
   * 🔴 **679 · more than one conversation you started asked a question with that id** (`675` F-b).
   *
   * ⛔ **Why an id can name two questions at all.** A provider's request id is SESSION-LOCAL — Codex
   * numbers its server requests per connection, and every conversation has its own — so two
   * children's first questions can carry one id ([[a-provider-request-id-is-session-local]]). ⚠️ The
   * doors used to take the id ALONE and reach the newest routing, so an answer meant for one child
   * went to the other.
   *
   * ⚑ **Refused, never guessed** — neither the newest, nor the only one still open: a caller that
   * meant the other would have its answer taken by a conversation that never asked it. ⚑ **The act
   * is the same call with `asked_by`**, the field `list_questions` shows beside every id, so the
   * caller names something it has already been shown rather than a second identifier it cannot know.
   *
   * ⚠️ **`permanent`: the identical call never lands** — no routing leaves a ledger, so the id stays
   * shared for good. ⛔ **So the remedy is null and the act is in the SENTENCE** (`425` §3.1's
   * biconditional): *change the call, not the world*, exactly as `no-question-by-that-name`.
   *
   * ⛔ **It names the askers, and that is not the enumerator this file's header refuses.** Only
   * questions routed to the CALLER are counted, and `list_questions` already names every one of
   * their askers to it — so a caller learns nothing here it could not read there.
   *
   * ⚠️ **"Raised a request", not "asked a question"** (the review's finding): a permission routed to
   * the caller shares the id space — Codex numbers its approvals on the same connection — and a
   * sentence saying *question* would be false of it. ⚑ When EVERY asker's last routing under the id is
   * a person's request of one kind, this rail does not fire at all: whichever was meant, the door says
   * `a-person-answers-this-one` and sends nothing, so nothing is guessed.
   */
  'more-than-one-question-has-that-id',
  /**
   * 🔴 **679 · the conversation `asked_by` names raised nothing by that id — another one the caller
   * started did** (found by this dispatch's review).
   *
   * ⛔ **Not `no-question-by-that-name`**, whose *"no conversation you started is waiting on a request
   * by that id… sending that id again will never succeed"* is false here: a child IS waiting on it,
   * and the same call with the right `asked_by` — or none, when one child has it — succeeds. ⚑ The
   * detail lists the ones that raised it, and the act is the same call naming one of them.
   *
   * ⛔ **One answer for every wrong name** — a child that raised nothing by the id, a conversation the
   * caller did not start, and a name that is nobody. What it states depends only on the requests
   * routed to the CALLER, each of which `list_questions` already names to it, so naming a stranger
   * learns nothing about the stranger (`refuse-on-entitlement-before-refusing-on-existence`). ⚑ An id
   * nothing routed to the caller carries stays `no-question-by-that-name` whatever `asked_by` says.
   *
   * ⚠️ **`permanent`**: the named conversation's ledger never gains that id's routing to this
   * caller, so the identical call never lands.
   */
  'that-conversation-did-not-ask-that',
  /**
   * 🔴 **You hold no open piece by that name, so there is nobody this question is for** (437,
   * criterion 29; a piece since D-016).
   *
   * ## ⛔ The enumerated causes share an answer — and already-ended work is not an error
   *
   *  - the label or id names no piece at all;
   *  - it names a piece this conversation does not hold;
   *  - ⚑ **it names a piece that has already ended — `answered`, `withdrawn` or `closed`** — the
   *    ordinary answer for a worker that asks a second time about something it has already
   *    reported, not an error path.
   *
   * ⚠️ **A question that named NO piece is not here** — it has two words of its own below, because
   * *"that name"* would be a name it never spelled.
   *
   * ⛔ **Answering these causes separately would be an enumerator.** A worker told *"that piece
   * exists but is not yours"* learns which pieces this app holds, which is the disclosure
   * `no-such-agent` and `no-question-by-that-name` already fold away — and `RuntimeHost`'s lookup
   * folds these causes the same way: it finds the name among what the asker HOLDS (`heldBy`), in
   * the lookup rather than in a rail asked in the right order.
   *
   * ## 🔴 `permanent`, and the already-ended cause is why it is not `while-this-holds`
   *
   * ⛔ **Work does not reopen.** `TASK_IS_OPEN`'s `answered`, `withdrawn` and `closed` states are
   * each somebody DECIDING, and nothing in this app moves a piece back out of one — so a name
   * refused here is refused for good, and `424`'s rule applies exactly as it did to
   * `no-question-by-that-name`: *change the call, not the world.* ⚠️ **`422` row 10 is the failure
   * this avoids** — `retryable: true` telling a model that the same guess would eventually land.
   *
   * ⚑ **No remedy, and that is a decision rather than an omission.** HO-025 §1 admits a remedy on a
   * permanent rail, but a remedy *"reads as what else you may do, never as how to get what you
   * asked for"* — and what a worker may do here depends on which folded cause it hit, which
   * this rail deliberately does not tell it. ⛔ **A conditionally-true remedy is the
   * `document-registry-unavailable` shape `425` withdrew.**
   */
  'no-open-work-by-that-name',
  /**
   * 🔴 **611 · nothing spawned this conversation, so there is no parent to pass it to**
   * (HO-088 §3.2).
   *
   * ⛔ **It fires on ONE argument and one topology**: `who_answers: 'the-parent'` from a
   * conversation `SessionStore.parentOf` answers `null` for — a top-level conversation, which is
   * what BroBot itself is. ⚑ **The remedy is the other member of the vocabulary**, and it is a real act
   * rather than a pointer: the same question, passed to a person, which is the last hop of
   * `HO-088` §6's chain.
   *
   * ⚠️ **`permanent`, and the claim is exact.** Nothing in this app re-parents a conversation —
   * its parent is written once inside `createTx` and no path rewrites it — so the identical
   * call never lands. ⛔ **It is refused rather than silently redirected to the person**: the PO
   * ruled the app routes what the agent declared and infers nothing, and quietly sending a question
   * somewhere the caller did not name is that rule broken in the direction that costs most.
   */
  'nobody-to-pass-it-up-to',
  /**
   * 🔴 **611 · this app does not hold the words to carry** (HO-088 §3.1).
   *
   * ⛔ **Passing a question up means repeating it VERBATIM**, and the words are read out of the
   * original asker's own ledger rather than taken from the caller — see
   * `RuntimeHost.passQuestionUp`. ⚠️ **When that read comes up empty there is nothing to repeat**:
   * a `.brobot` bundle whose payload this build cannot parse, or a row `toPersistedEvents` skipped.
   * ⚑ It is the same null `list_questions` already reports as *"this app does not hold the words
   * for this one"*, reaching the other verb.
   *
   * ⛔ **Refused rather than summarised.** *"A question reworded at every hop arrives as something
   * nobody asked"* — and a hop that invents the words because it could not find them is the worst
   * case of that, because nothing downstream could tell.
   *
   * ⚠️ **`permanent`.** The words are gone from the ledger; no later state of the world puts them
   * back, and a caller that wants the decision anyway has `ask_question`, which is its OWN question
   * in its own words rather than a claim about somebody else's.
   */
  'this-app-does-not-hold-those-words',
  // 🔴 **D-009 · F012** — asking an agent this caller may not name, or itself.
  'no-agent-you-can-ask-by-that-name',
  // 🔴 **D-009 · F012** — ruling 2: *only a question to your parent can be passed further up*.
  'a-question-asked-of-you-by-name-is-yours',
  // 🔴 **D-009 · F012** — withdrawing a question this caller did not ask, or that has ended.
  'no-open-question-you-asked-by-that-name',
  /**
   * 🔴 **D-016 · a question for the conversation that gave the work, or for a person, named no
   * piece — and several the asker holds have reached it**, so none can be inferred. ⚑ The detail
   * lists their labels, and the sentence says to name one. ⚑ **D-022 · R4 — a piece whose brief is
   * still held in its mailbox is one it cannot mean**, and is not counted.
   *
   * ⚠️ **`permanent`, as give's `name-the-piece-you-give-from` is**: the call to change is this one
   * — name the piece. The unnamed call could land later only once the asker's other pieces have
   * ended, and waiting for that is never the act; so the sentence says what to do and claims
   * nothing about *never*.
   */
  'name-the-piece-you-ask-about',
  /**
   * 🔴 **D-016 · the same, and NO open piece the asker holds has reached it** — nothing it has been
   * handed is still open, so a question to the conversation that gave the work, or to a person, has
   * nothing to be about (D-022 · R4). ⚑ A question to another agent needs no piece, and the sentence
   * says so.
   *
   * ⚠️ **`permanent`, as give's `no-piece-to-give-from` is**: the unnamed call could land later —
   * once a piece held for the asker reaches it, when its turn ends — but waiting for that is never
   * the act; naming the piece is, and a name resolves among every piece it holds.
   */
  'no-piece-to-ask-about',
  /**
   * 🔴 **An answer — or a reason it cannot be given — longer than an answer may carry**, refused
   * before anything is recorded: the question stays open and the same caller answers it again.
   *
   * ⛔ **Until now the words were cut and marked after the question was closed**, so the rest could
   * not go the same way: one answerer re-sent it as a note, another never did, and the rest of its
   * answer lived only in its own conversation. ⚑ `summary-too-long`'s rule, one door over: nothing
   * is shortened for the caller, and it decides what the shorter answer says.
   *
   * ⚠️ **Measured as `REPLY_SUMMARY_LIMIT` measures** — UTF-16 units over the answerer's OWN words
   * (`RuntimeHost`'s `oneAgentsAnswer`): an offered label is the asker's words, and a part the
   * question never asked is not delivered, so neither is counted. ⚑ `cannot_answer` is measured
   * whole, on the same bound.
   *
   * ⚠️ **`while-this-holds`**: the identical intent succeeds the moment the words are shorter.
   */
  'answer-too-long',
  'move-offer-not-available',
  'move-offer-is-held',
  'move-offer-needs-a-person',
] as const

export type QuestionRail = (typeof QUESTION_RAILS)[number]

/** ⛔ **One table, so `permanence` and `retryable` cannot disagree** — `341`'s rule at this venue. */
const PERMANENCE: Readonly<Record<QuestionRail, RailPermanence>> = {
  'move-offer-not-available': 'permanent',
  'move-offer-is-held': 'while-this-holds',
  'move-offer-needs-a-person': 'until-a-person-changes-it',
  // 🔴 **`permanent` since `424`** — see the rail's own note, and HO-023 §2.1.
  'no-question-by-that-name': 'permanent',
  'a-person-answers-this-one': 'permanent',
  'question-has-already-ended': 'permanent',
  'that-answer-cannot-be-sent': 'while-this-holds',
  'the-conversation-that-asked-has-gone': 'permanent',
  // 🔴 **679** — no routing leaves a ledger, so the id stays shared and the identical call never lands.
  'more-than-one-question-has-that-id': 'permanent',
  'that-conversation-did-not-ask-that': 'permanent',
  // 🔴 **437** — see the rail's own note: work does not reopen, so the identical call never lands.
  'no-open-work-by-that-name': 'permanent',
  // 🔴 **611** — nothing re-parents a conversation, and the words are not coming back.
  'nobody-to-pass-it-up-to': 'permanent',
  'this-app-does-not-hold-those-words': 'permanent',
  // ⚑ **D-009** — each is changed by the call, never by the world: another id, another verb.
  'no-agent-you-can-ask-by-that-name': 'permanent',
  'a-question-asked-of-you-by-name-is-yours': 'permanent',
  'no-open-question-you-asked-by-that-name': 'permanent',
  // ⚑ **D-016** — changed by the call: name a piece. See each rail's own note.
  'name-the-piece-you-ask-about': 'permanent',
  'no-piece-to-ask-about': 'permanent',
  'answer-too-long': 'while-this-holds',
}

export function questionPermanenceOf(rail: QuestionRail): RailPermanence {
  return PERMANENCE[rail]
}

/**
 * **Would the identical call ever succeed on its own?**
 *
 * ⛔ **Derived, never written twice.** ⚠️ **No row is `until-a-person-changes-it`**: D-017 removed
 * `the-conversation-that-asked-has-ended`, the one that was — an answer to a question this app asked
 * starts its asker. ⛔ **That price is absent for a permission, and that absence is a finding rather
 * than an omission**: there is no grant that would let an agent answer a permission, so pointing a caller at
 * a person to ask for one would be this app describing a capability that does not exist.
 */
export function questionRetryableOf(rail: QuestionRail): boolean {
  return questionPermanenceOf(rail) === 'while-this-holds'
}

/**
 * 🔴 **425 · what the caller may do instead — `that-answer-cannot-be-sent` has the answer**
 * (HO-023 §2.2).
 *
 * ⛔ **It is the only remedy-bearing row here, and the request is still open while it holds** —
 * which is what makes the act real: the same caller, the same request id, an answer put together
 * properly. ⚑ A missing part, a value the request cannot use and an option nobody offered fold to
 * that rail, and the same act clears every folded cause.
 *
 * ⚠️ **The word does NOT say *from the choices offered*, and the first draft of this dispatch did.**
 * `answerToForward` pushes `unanswered` for a question with **no options at all** — the free-form
 * case its own comment names — so a remedy naming choices would instruct an impossible act on exactly
 * the arm where the caller has the most freedom. ⛔ **A remedy true on two arms of three is what
 * `422` condemned the spawn rails for.**
 *
 * ⚠️ **`no-question-by-that-name` gets NOTHING**, for `no-piece-by-that-name`'s reason one door over:
 * `422` §1 row 10 measured the fold, `list_questions` composes a DIFFERENT call, and a later provider
 * mints its own handles. ⛔ **Finding another id is not making this id answerable.** ⚑ It was written
 * while the rail said `while-this-holds`; `424` has since made it `permanent`, which says the same
 * thing through the permanence.
 *
 * ⚑ **Every remaining row is `permanent` too.**
 */
const REMEDY: Readonly<Record<QuestionRail, RefusalRemedy | null>> = {
  'move-offer-not-available': null,
  'move-offer-is-held': 'make-the-same-call-when-this-settles',
  'move-offer-needs-a-person': null,
  'no-question-by-that-name': null,
  'a-person-answers-this-one': null,
  'question-has-already-ended': null,
  'that-answer-cannot-be-sent': 'answer-every-part-the-request-asks-for',
  'the-conversation-that-asked-has-gone': null,
  // ⛔ **679 · null, by the same biconditional** — permanent, so the act (`asked_by`) is in the
  // sentence rather than a word that would claim the identical call could land.
  'more-than-one-question-has-that-id': null,
  // ⛔ **679 · null, by the same biconditional** — permanent; the act is in the sentence.
  'that-conversation-did-not-ask-that': null,
  // ⛔ **437 · null on purpose** — the rail folds the listed causes and a remedy would have to be
  // true of every one. See the rail's own note, and `425`'s withdrawn
  // `document-registry-unavailable`.
  'no-open-work-by-that-name': null,
  // 🔴 **611 · NULL, and the reason is `425` §3.1's biconditional rather than a shortage of
  // acts.** ⛔ **Every rail this app can retry carries an act, and no rail it cannot retry
  // pretends to** — this one is `permanent`, because nothing re-parents a conversation, so the
  // identical call never lands. ⚑ **The other end is in the SENTENCE**, which is where a next
  // call belongs on a permanent rail: *"a person is the other end it can go to."* ⚠️ A remedy
  // here would be `no-question-by-that-name`'s refusal one door over — *finding another id is not
  // making this id answerable* — with the id swapped for a recipient.
  'nobody-to-pass-it-up-to': null,
  // ⛔ **Null.** There is nothing to do about words the ledger no longer holds, and pointing a
  // caller at `ask_question` would be telling it to invent the question it could not carry.
  'this-app-does-not-hold-those-words': null,
  'no-agent-you-can-ask-by-that-name': null,
  'a-question-asked-of-you-by-name-is-yours': null,
  'no-open-question-you-asked-by-that-name': null,
  // ⚑ **D-016 · null, by the biconditional** — permanent; the act is in the sentence.
  'name-the-piece-you-ask-about': null,
  'no-piece-to-ask-about': null,
  'answer-too-long': 'shorten-the-answer-or-put-the-long-form-in-a-file',
}

/** ⛔ **What a caller may do instead, or `null` because this app knows of nothing** (425). */
export function questionRemedyOf(rail: QuestionRail): RefusalRemedy | null {
  return REMEDY[rail]
}

/**
 * The facts an answer refusal may state beyond the rail itself, carried as DATA (`341`, 100).
 *
 * ## ⛔ The fields that are deliberately NOT here
 *
 * ⚠️ **Nothing names the conversation that asked.** A caller that could read a child's session id
 * off a refusal for an id it merely guessed would have an enumerator — and the one gate that says
 * *"there is no such request"* must not be the reader that says whose it is. ⚑ **679 · with one
 * exception, {@link askers}**, which names only askers of questions routed to the caller — the
 * ones `list_questions` names to it already. ⛔ **And nothing
 * carries the request's PROMPT**: a permission's text is what a person is being asked to approve,
 * and handing it back in a refusal would deliver the contents of the card the rail just refused.
 */
export interface QuestionRefusalDetail {
  /** The request id this call named, echoed back so a model can match refusal to request. */
  question?: string
  /**
   * ⛔ **Which shape made it a person's — present only on `a-person-answers-this-one`.** One of
   * `CHANNEL_REFUSALS`.
   */
  because?: ChannelRefusal
  /** The ending that prevents an answer, or explains why the caller's own question needs no withdrawal. */
  state?: RoutedRequest['state']
  /** When that question ended, in epoch milliseconds. */
  at?: number
  /** Where the answer or decline to the caller's own question can be read. */
  itsAnswer?: AnAnswerOnItsWay
  /** What the answer machinery said — present only on `that-answer-cannot-be-sent`. */
  said?: string
  /**
   * ⛔ **The piece the ASK named, echoed back as it was spelled — present only on
   * `no-open-work-by-that-name`** (437; a piece since D-016).
   *
   * ⚠️ **It echoes what the caller already spelled and never what the app found**, which is why it
   * is not the disclosure the field above it refuses to be: a worker learns nothing here it did not
   * write itself.
   */
  piece?: string
  /**
   * ⚑ **D-016 · the labels of the pieces the caller holds that have reached it** (D-022 · R4) —
   * present only on `name-the-piece-you-ask-about`, so it can name one. ⛔ Its own holdings, which
   * `list_tasks` already tells it.
   */
  held?: readonly string[]
  /**
   * 🔴 **679 · every conversation that raised a request with this id — present only on
   * `more-than-one-question-has-that-id` and `that-conversation-did-not-ask-that`**, in the order
   * their requests were routed.
   *
   * ⛔ **The one field that names an asker**, and the header's refusal does not reach it: these are
   * askers of requests routed to the CALLER, each of which `list_questions` already names to it.
   * ⚑ It is what the caller quotes back as `asked_by`.
   */
  askers?: readonly string[]
  /** ⚑ **D-009** — the agent id a question was addressed to, echoed back on a refusal about it. */
  agent?: string
  /**
   * Which words were too long — the parts' `answers`, or the `cannot_answer` reason. Present only
   * on `answer-too-long`.
   */
  argument?: 'answers' | 'cannot_answer'
  /** How long those words may be, in UTF-16 units. Present only on `answer-too-long`. */
  limit?: number
  /** How long the ones that arrived were, in the same units. Present only on `answer-too-long`. */
  was?: number
}

/**
 * ⚑ **F020 · where an answer to an asker's question is when it tries to withdraw that question** —
 * held for it behind its running turn, which is being stopped so the answer comes in now; held
 * until that turn ends; held until its provider's usage limit resets; or already sent to it.
 */
export type AnAnswerOnItsWay =
  | 'held-and-this-turn-is-stopping'
  | 'held-until-this-turn-ends'
  | 'held-until-the-limit-resets'
  | 'already-sent'

/** 🔴 **A refusal, as a payload rather than a throw** — `341`'s shape, carried over MCP unchanged. */
export interface QuestionRefusal {
  readonly rail: QuestionRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /** ⛔ **425 · the act left, as a word** — one of `REFUSAL_REMEDIES`, or `null`. See {@link questionRemedyOf}. */
  readonly remedy: RefusalRemedy | null
  readonly detail: QuestionRefusalDetail
}

/**
 * The sentence for each rail.
 *
 * ⚠️ **A refusal INSTRUCTS or STATES A FACT ABOUT THIS CALL; it does not describe how the system
 * works** (HO-015 §2, standing). ⛔ None of these says how a question is routed, what a channel is,
 * or which provider sent what — the class of sentence the PO named as *"one mistake made eight
 * times"*.
 *
 * 🔴 **`a-person-answers-this-one` interpolates NOTHING**, and that is `374`'s finding kept: an
 * interpolated sentence quietly asserts a second fact. Which shape it was is in `detail.because`,
 * where a model reads it as data, and `CHANNEL_REFUSAL_SENTENCES` is the vocabulary that explains
 * one to a reader of a ledger — deliberately not spliced in here, so the two never become one
 * string that has to be right for both audiences.
 */
const QUESTION_SENTENCES: Readonly<Record<QuestionRail, string>> = {
  'move-offer-not-available': 'This request cannot be offered for a move.',
  'move-offer-is-held':
    'This request is still being recorded, so it cannot be offered for a move yet.',
  'move-offer-needs-a-person':
    'That conversation is unavailable until a person restores it, so this request cannot be offered for a move.',
  // ⚠️ **The middle clause is new** (424): a request id belongs to the request it was raised for,
  // so the one in the refused call does not become answerable here however long a caller waits.
  'no-question-by-that-name':
    'nobody is waiting on you for a request by that id, so nothing was answered. list_questions names the requests you can answer — from conversations you started, and agents that asked you; sending that id again will never succeed.',
  'a-person-answers-this-one':
    'that one is a person’s to settle rather than a question you can answer, so nothing was sent and it is still waiting for a person. Leave it for that person; retrying your answer will never succeed. The detail says what kind of thing it is.',
  'question-has-already-ended':
    'no further answer is owed: that question has ended, so nobody is waiting and nothing was sent. The detail says how it ended; retrying this id cannot work.',
  'that-answer-cannot-be-sent':
    'that answer cannot be sent as it stands, so nothing was sent. Answer every part it asks about, choosing one of its options unless it takes an answer of your own. The request is still waiting.',
  // ⚑ **D-017** — a fact about THIS request (HO-015 §2: never which part of the system held it), and
  // short enough that the whole row, rail and all, is inside the 200-character cut.
  'the-conversation-that-asked-has-gone':
    'no further answer is owed: the asking conversation stopped, so nobody waits and nothing was sent. Retrying this id cannot work.',
  // 🔴 **679 · the act FIRST** (`675`'s cut) — the call to make, then the fact that makes it
  // necessary. ⛔ It names neither door: the same sentence is true at `answer_question` and at
  // `pass_question_up`, because the act is *the same call again*.
  'more-than-one-question-has-that-id':
    'name which one you mean: make the same call again with asked_by set to one of the conversations the detail lists. More than one conversation you started raised a request with that id, so nothing was sent; the id alone will never be enough.',
  // ⚑ **679 · the act first, and it is the same act** — a name the detail lists. ⛔ It says what is
  // true of the NAMED conversation only, never why, so a stranger's name and a child's read alike.
  'that-conversation-did-not-ask-that':
    'make the same call again with asked_by set to one of the conversations the detail lists: the one you named raised no request with that id, so nothing was sent, and naming it again will never succeed.',
  // ⚠️ **It states a fact about THIS call and instructs; it does not explain how work is addressed.**
  // ⛔ And it names none of the folded causes — see the rail's note on why that is the point.
  'no-open-work-by-that-name':
    'you hold no open piece by that name, so nothing was asked and nobody was told. list_tasks names the pieces you hold, and a question has to name one of those; sending that name again will never succeed.',
  // ⚑ **611 · it states a fact about THIS call and names the act left.** ⛔ It does not explain
  // spawning, provenance or what a parent is — the class of sentence HO-015 §2 keeps out of a
  // refusal.
  'nobody-to-pass-it-up-to':
    'nothing started this conversation, so there is no parent for that question to go to and nothing was sent. Pass it to a person with a-person instead; sending it to the parent again will never succeed.',
  'this-app-does-not-hold-those-words':
    'nothing can be passed up: this app no longer holds the question’s original words. Nothing was sent, and retrying this id cannot recover them.',
  // ⚑ **D-016 · commit 7 · R1 — *id or piece label*, one answer for both**: a label that names no
  // piece, or one whose owner the caller may not ask, reaches this sentence exactly as an unknown id.
  'no-agent-you-can-ask-by-that-name':
    'there is no other agent by that id or piece label that you can ask, so nothing was asked and nobody was told. list_agents names the agents you can ask; asking by that name again will never succeed.',
  'a-question-asked-of-you-by-name-is-yours':
    'that question was asked of you by name, so it is yours to answer — or to say you cannot, with answer_question and cannot_answer — and it cannot be passed on. Nothing was sent; passing it on again will never succeed.',
  'no-open-question-you-asked-by-that-name':
    'you have no open question by that id — you did not ask it, or it has ended — so nothing was withdrawn. Use the id ask_question returned; withdrawing this one again will never succeed.',
  // ⚑ **D-016 · the act first, inside the cut** — and no *never*: see the rail's own note.
  'name-the-piece-you-ask-about':
    'you hold more than one piece, so say which one this question is about: ask again naming it as piece. The detail lists the ones that have reached you; nothing was asked and nobody was told.',
  'no-piece-to-ask-about':
    'you hold no open piece of work that has reached you, so nothing was asked. A question to another agent needs no piece; otherwise do the work here until you hold a piece to ask about.',
  // ⚑ The act first, inside the cut. ⚠️ The words' length and the limit are said by
  // {@link answerTooLongSentence} whenever the detail holds them; this is the sentence without them.
  'answer-too-long':
    'shorten your answer, or put the long form in a file and name its full path in your answer. It is longer than an answer may be, so nothing was sent or shortened; the question is still waiting for your answer.',
}

/**
 * ⚑ **`answer-too-long`, with the length and the limit in the words** — what to do first, then the
 * two numbers, then what became of the call. ⚠️ Each from the detail, so the sentence and the data
 * a model reads beside it cannot disagree; without them it is the rail's own sentence.
 */
function answerTooLongSentence(detail: QuestionRefusalDetail): string {
  if (detail.was === undefined || detail.limit === undefined) {
    return QUESTION_SENTENCES['answer-too-long']
  }
  const after = 'so nothing was sent or shortened; the question is still waiting for your answer.'
  return detail.argument === 'cannot_answer'
    ? `shorten your reason, or put the long form in a file and name its full path in cannot_answer. It is ${String(detail.was)} units long and a reason may be at most ${String(detail.limit)}, ${after}`
    : `shorten your answer, or put the long form in a file and name its full path in your answer. Your own words in it are ${String(detail.was)} units long and an answer may carry at most ${String(detail.limit)}, ${after}`
}

/**
 * ⚑ **F020 · `no-open-question-you-asked-by-that-name`, when the caller's own question was answered
 * or declined** — said so, with where its answer is and what to do about it first: an asker that
 * hears only *"you did not ask it, or it has ended"* reports without the answer that was on its way
 * (measured: it did). ⚑ Without those facts, the rail's own sentence.
 */
function aQuestionThatWasAnsweredSentence(detail: QuestionRefusalDetail): string {
  const ended =
    detail.state === 'answered' ? 'answered' : detail.state === 'rejected' ? 'declined' : null
  if (ended === null || detail.itsAnswer === undefined) {
    return QUESTION_SENTENCES['no-open-question-you-asked-by-that-name']
  }
  const reply = detail.state === 'answered' ? 'its answer' : 'the reply declining it'
  switch (detail.itsAnswer) {
    case 'held-and-this-turn-is-stopping':
      return `stop here and read ${reply}: that question was already ${ended}, so nothing was withdrawn. This turn is being stopped, so ${reply}, held for you, comes in now.`
    case 'held-until-this-turn-ends':
      return `end this turn to read ${reply} before you report on that question: it was already ${ended}, so nothing was withdrawn, and ${reply} is held for you until this turn ends.`
    // ⚑ **W4.172 · F095 — not *"once your usage limit resets"***: this turn completing is the
    // provider taking work again, which ends the limit's hold (`foldProviderLimits`), so the reply
    // goes as it ends — and waits longer only when the limit outlives it.
    case 'held-until-the-limit-resets':
      return `end this turn to read ${reply} before you report on that question: it was already ${ended}, so nothing was withdrawn, and ${reply} is held for you until this turn ends, or longer if your usage limit still holds then.`
    case 'already-sent':
      return `read ${reply}, which was sent to you as a message: that question was already ${ended}, so nothing was withdrawn.`
  }
}

/** Explain a known ending without copying the caller's question id into the reason. */
function aQuestionThatEndedSentence(detail: QuestionRefusalDetail): string {
  if (detail.state === undefined || REQUEST_IS_OPEN[detail.state]) {
    return QUESTION_SENTENCES['no-open-question-you-asked-by-that-name']
  }
  const instant = new Date(detail.at ?? Number.NaN)
  const ended = Number.isNaN(instant.getTime())
    ? 'This question has already ended. No withdrawal is needed.'
    : detail.state === 'withdrawn'
      ? `This question was already withdrawn at ${instant.toISOString()}. No withdrawal is needed.`
      : `This question ended at ${instant.toISOString()}. No withdrawal is needed.`
  return (detail.state === 'answered' || detail.state === 'rejected') &&
    detail.itsAnswer !== undefined
    ? `${aQuestionThatWasAnsweredSentence(detail)} ${ended}`
    : ended
}

/**
 * ⚑ **F020 · the words every answer quotes its question by** ({@link answerText}) — and so how the
 * host finds an answer held for its asker (`RuntimeHost.whereItsAnswerIs`): one spelling for both.
 */
export function quotingTheQuestion(id: string): string {
  return `quoting ${id}.`
}

/**
 * 🔴 **679 · the one key a routed question is known by: the conversation that asked, and its id.**
 *
 * ⛔ **An id alone names nothing across conversations** — a provider's is session-local
 * ([[a-provider-request-id-is-session-local]]), so every reader whose scope is more than one
 * conversation keys by this: `list_questions` (`675`) and both doors that take an answer.
 * ⚑ **One function, so the readers cannot come to two keys.**
 *
 * ⚠️ **The joiner is a NUL**, `digest.ts`' own choice (`474`): a `:` would be ambiguous against
 * Codex's `requestKey`, which spells `number:1`, and neither a session id nor a request id can
 * contain a NUL.
 */
export function questionKey(askedBy: string, requestId: string): string {
  return `${askedBy}\u0000${requestId}`
}

/** ⛔ `retryable` is DERIVED from `permanence` through one table, so the two cannot disagree. */
export function refuseQuestion(
  rail: QuestionRail,
  detail: QuestionRefusalDetail = {},
): QuestionRefusal {
  const permanence = questionPermanenceOf(rail)
  return {
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(
      rail === 'answer-too-long'
        ? answerTooLongSentence(detail)
        : rail === 'no-open-question-you-asked-by-that-name'
          ? aQuestionThatEndedSentence(detail)
          : QUESTION_SENTENCES[rail],
    ),
    remedy: questionRemedyOf(rail),
    detail,
  }
}

/**
 * 🔴 **The whole door, as a pure function of what the caller's own family holds** (394 §6).
 *
 * ⛔ **`request` is `undefined` when nothing routed to this caller has that id — never when it
 * belongs to somebody else.** The lookup is the entitlement and it happens before this call; see
 * this file's header on why that is stronger than an ordered check.
 *
 * ⚠️ **The order is kind, then ending**, and it is argued on
 * {@link QuestionRail.a-person-answers-this-one}: a permission is refused as a permission whatever
 * state it is in.
 */
export function admitAnswer(request: RoutedRequest | undefined): QuestionRefusal | null {
  if (request === undefined) return refuseQuestion('no-question-by-that-name')
  // 🔴 **611 · the REFUSED arm, and it used to be `because !== null`** (HO-088 §2.3).
  //
  // ⛔ **Addressing a question to a person is where it GOES; it is not a lock on who may answer
  // it.** ⚠️ The alternative was measured and refused: a question an asker addressed to a person
  // lands in that person's queue as a row with **no card and no controls** — `A_CARD_TO_OPEN`
  // answers `was-never-drawn` for everything `question_asked` raised, and `PersonsQueueRow.answers`
  // comes only off a LIVE provider projection (`434`) — so refusing the parent here would have left
  // the question with nobody in this app able to settle it at all. ⛔ That is `589`'s permanent
  // *NEEDS YOU* rebuilt, which is the one outcome `HO-082` §2 exists to prevent.
  //
  // ⚑ **And it is what `HO-088` §2.3 describes**: *"Ada still SEES that Ali asked and sees the
  // answer — she delegated the asking, not her sight of it."* A parent that knows the answer
  // answering it is the app working; a parent that should not answer it is a judgment this app
  // does not make for anybody — see `611`'s response §4 for the half that is still missing.
  if (request.went.is === 'the-person-the-channel-left-it-with') {
    return refuseQuestion('a-person-answers-this-one', {
      question: request.requestId,
      because: request.went.because,
    })
  }
  // ⛔ **The same table the fold settles by**, imported rather than re-listed: a rail with its own
  // idea of which states are endings would be free to disagree with the derivation it guards.
  if (!REQUEST_IS_OPEN[request.state]) {
    return refuseQuestion('question-has-already-ended', {
      question: request.requestId,
      state: request.state,
    })
  }
  return null
}

/**
 * ⚑ **D-017 · R6 — why a PERSON's answer to a question this app asked was not sent**, in this app's
 * own words: {@link admitAnswer}'s ending, said to the person who pressed. ⛔ Never the provider's
 * *"no longer waiting"*: no provider ever held this question.
 */
export const A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION: Readonly<
  Record<Exclude<RequestState, 'open'>, string>
> = {
  answered: 'That question was already answered, so your answer was not sent.',
  rejected: 'That question was already declined, so your answer was not sent.',
  decided: 'That question was already settled, so your answer was not sent.',
  withdrawn: 'The conversation that asked took that question back, so your answer was not sent.',
  abandoned: 'That question was given up before this answer came, so your answer was not sent.',
  stranded: 'That question was left behind when this app stopped, so your answer was not sent.',
  interrupted: 'The turn that asked it was stopped, so your answer was not sent.',
  'work-withdrawn': 'The work that question was about was taken back, so your answer was not sent.',
  'work-closed': 'The work that question was about was closed, so your answer was not sent.',
  'work-replied': 'The work that question was about was handed back, so your answer was not sent.',
  'recipient-ended':
    'That question was closed when the one it was asked of was ended, so your answer was not sent.',
}

/**
 * ⚑ **D-017 · R6 — a person answered a question here that is not theirs to answer here**: it was
 * asked of another conversation, whose answer it waits for, and this window does not hold the one
 * that asked.
 */
export const NOT_A_PERSONS_TO_ANSWER_HERE =
  'That question was asked of another conversation, not of you, so your answer was not sent. Open the conversation that asked it to answer it there.'

/** ⚑ **D-017 · R6 — a person answered a question id this app has no record of.** */
export const NO_SUCH_QUESTION_TO_ANSWER =
  'This app has no question by that id in that conversation, so your answer was not sent.'

/**
 * The answer `answer_question` gets — a returned union, never a throw (`341`'s shape).
 *
 * ⛔ **There is no delivery vocabulary on the `ok` arm, and its absence is a ruling.** `393`'s reply
 * has one because the reply is RECORDED whether or not anybody was there to read it — the piece
 * closes either way — so *what became of the words* is a second fact. ⚠️ An answer records nothing
 * and closes nothing: either the provider took it and the conversation is running again, or it did
 * not and the caller is refused BY NAME. ⚑ A `delivered: 'no-conversation'` on a successful call
 * would be *"nothing unwired implies a working state"* with a word in front of it.
 *
 * ⚑ **D-017 · R1 — one fact of that kind now, and only for a question THIS APP asked**: its answer
 * IS recorded — the decision closes the question, and the words wait in the asker's ledger as a held
 * message — whether or not the asker could be started, so what became of the words is a second fact,
 * as a reply's is. ⚑ `kept` says it, in words, only when the start did not happen.
 */
export type AnswerOutcome =
  | {
      readonly ok: true
      readonly question: string
      readonly asked: string
      /**
       * ⚑ **F033 · the piece the question was asked under**, by id — what the answer's receipt
       * names the asker by — or `null`: it named none, or a provider asked it.
       */
      readonly piece: string | null
      /**
       * 🔴 **The parts the caller answered that the question never asked**, which did not reach the
       * asker (`RuntimeHost`'s `oneAgentsAnswer`). ⛔ Not delivery vocabulary — the paragraph above
       * still holds — but a fact about the WORDS, which the caller would otherwise believe all went.
       * ⚑ Nothing that reaches the asker is cut: an answer over the bound is refused
       * (`answer-too-long`). Always present, so an empty list is a measurement.
       */
      readonly notAsked: readonly string[]
      /**
       * ⚑ **D-017 · R1 — the asker could not be started now**: the answer is kept in its ledger and
       * goes to it first when it next starts; the sentence says so, and why the start did not
       * happen. ⚠️ Absent when the answer reached the asker, sent or held behind its turn.
       */
      readonly kept?: string
    }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

/**
 * 🔴 **The whole ask door, as a pure function of what the caller HOLDS** (437, criterion 29) —
 * {@link admitAnswer}'s shape pointed the other way.
 *
 * ⛔ **`piece` is `null` when this conversation holds no open piece by that name — never when the
 * piece belongs to somebody else.** The host resolves it among the caller's own holdings — its root,
 * then its open pieces — so the lookup is the entitlement and it has already happened by the time
 * this is called; a caller cannot spell a name that reaches another conversation's work.
 *
 * ⚠️ **{@link noPieceToAskAbout} is the whole door.** Everything else a question could fail on is
 * either not a failure — a parent that is not running still gets a durable routing row and can
 * answer from `list_questions` later, which is `394`'s ruling — or is the tool's own shape check.
 */
export function admitAsk(
  piece: { readonly piece: string } | null,
  /** ⚑ What the caller spelled — `''` when it named none. */
  named: string,
  /** ⚑ The labels of the pieces it holds that have reached it (D-022 · R4). */
  held: readonly string[],
): QuestionRefusal | null {
  return piece === null ? noPieceToAskAbout(named, held) : null
}

/**
 * ⚑ **D-016 · why an ask found no piece, in the word that fits what it SPELLED**: a name it does not
 * hold is `no-open-work-by-that-name`; no name, and several that have reached it (D-022 · R4), is
 * `name-the-piece-you-ask-about` with their labels; no name, and none, is `no-piece-to-ask-about`.
 */
export function noPieceToAskAbout(named: string, held: readonly string[]): QuestionRefusal {
  if (named !== '') return refuseQuestion('no-open-work-by-that-name', { piece: named })
  return held.length > 1
    ? refuseQuestion('name-the-piece-you-ask-about', { held })
    : refuseQuestion('no-piece-to-ask-about')
}

/**
 * 🔴 **What `ask_question` gets back** — `341`'s returned union, never a throw, third venue.
 *
 * ## ⛔ 608 · it says the question was RAISED, and nothing about an answer (HO-084 §4)
 *
 * ⚠️ **`437` held the worker's turn open and this type carried what came back from the wait:**
 * `answered` (what arrived), `waitedForMs` (how long it took) and — after `591` — `questionIs`
 * (what the routing row said at the end of it). ⛔ **All three described the wait, and the wait is
 * gone.** ⚑ The call now writes the question row, the routing row and a best-effort delivery, and
 * returns; an ANSWER is a turn that arrives later, through `RuntimeHost.deliverAnswer`.
 *
 * 🔴 **They were removed rather than left reporting a constant.** `answered` could only ever be
 * `null`, `waitedForMs` only ever a few ticks of the caller's own dispatch, and the ledger read
 * behind `questionIs` could only ever answer `open`, because nothing is awaited between the write
 * and the return. ⚠️ `a-positive-assertion-must-differ-from-the-default`, and
 * `a-number-can-survive-the-death-of-its-derivation` — the same reason this dispatch took the
 * five-minute constant out.
 *
 * ⚑ **What a model is told instead is one sentence, and it is true of every call**: the question
 * is recorded and routed, the work is still yours and still open, and the answer reaches you as a
 * message. ⛔ Standing rule 13's distinction is unchanged and is now trivially satisfied — the ASK
 * is performed, the ANSWER is somebody else's act, and nothing here reports on a deadline because
 * there is none.
 *
 * ## ⚠️ `parent` went too, and it is the one removal `608` did not cause
 *
 * ⛔ **`437` returned the conversation that was asked and NOTHING ever read it** — not the tool,
 * not a test, not a caller inside the process — which this dispatch found reviewing its own diff.
 * ⚑ It is the same charge as the three above, and leaving it while removing them for exactly that
 * reason would make this docblock argue against itself.
 *
 * ⚠️ **It was removed rather than surfaced, and that is deliberate.** ⛔ Putting a parent's session
 * id into a payload a worker reads is a DISCLOSURE — `433`'s *a caller may see exactly what it may
 * send to*, and `437` §2 measures that `list_agents` does not name the parent — so widening what a
 * worker is told is a product decision and not a side effect of removing a wait.
 */
export type AskOutcome =
  | {
      readonly ok: true
      /** ⚑ **The id the parent quotes to answer.** */
      readonly question: string
      /**
       * ⚑ **D-016 · where it went** — what the asker said, except that a question for the conversation
       * that gave a ROOT, or work the asker took on for a person (commit 6), goes to a person: their
       * giver is the person (spec D15).
       */
      readonly went: QuestionRecipient
      /**
       * ⚑ **D-016 · the piece it is about is the asker's own ROOT** — work a person gave it, which
       * nothing hands back — so the answer says how that work ends instead of naming
       * `reply_to_parent`, which refuses a root.
       */
      readonly aboutItsRoot: boolean
    }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

/**
 * 🔴 **679 · what a pass-up states: the new question, AND the one it carried, by its asker.**
 *
 * ⛔ **The carried question stays open and stays the passer's** — it answers it with
 * `answer_question` when the answer comes back — and a provider's id is session-local, so a sibling
 * asked later can share it (`675` F-b). ⚑ Naming the asker here is what lets the passer quote the
 * pair then, rather than meet `more-than-one-question-has-that-id` with nothing recorded to choose by.
 */
export type PassUpOutcome =
  | {
      readonly ok: true
      readonly question: string
      readonly carried: {
        readonly question: string
        readonly askedBy: string
        /**
         * ⚑ **F033 · the piece the carried question was asked under** (`RaisedQuestion.piece`), or
         * `null` — so the receipt quotes its asker by the label the question's own words gave it.
         */
        readonly piece: string | null
      }
    }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

/**
 * 🔴 **The words a parent actually receives when a child asks it something.**
 *
 * ## ⛔ It says what it is, because it arrives as an ordinary turn
 *
 * ⚠️ **A routed question reaches a parent through `queueMessage`, so it renders as a `user_turn`** —
 * the same shape work takes when a parent gives it to a child, and the same shape a reply takes
 * coming back. ⛔ Without a first line naming what this is, a parent reading its own transcript
 * would see words that look like a person's. ⚑ The provenance is in the TEXT, where the reader is.
 *
 * ## ⚠️ It states facts about THIS question and instructs nothing about the app
 *
 * ⛔ **No sentence here describes how routing works, what a channel is, or what happens if nobody
 * answers** (HO-015 §2, standing). Every line is a value off the request. ⚑ The one imperative
 * names a tool that exists and what to quote — the id and, since `679`, the asker beside it —
 * `replyText`'s *"Read it with read_document"*, one subject over.
 *
 * 🔴 **D-016 · commit 7 · R3 — the asker by the piece it owns, and its ADDRESS to quote**: the
 * sentence names it as every sentence about one piece names another conversation — ⚑ F033 · by the
 * piece the question was asked under (`RuntimeHost.nameByItsWorkUnder`) — and `asked_by` quotes the
 * label of that piece — which `answer_question` takes (R1) — or its id when it holds no piece.
 * ⚠️ Both composed at the call site: this module has no store.
 *
 * ⛔ **The options are listed verbatim and never trimmed, renamed or filtered** (`143`/`146`): the
 * providers validate an answer against the labels the model wrote, so a parent that cannot see them
 * exactly cannot answer at all.
 */
export function questionText(
  asker: {
    /** ⚑ What the sentence calls the asker — its agent's name and the piece it owns. */
    readonly called: string
    /** ⚑ What `asked_by` quotes — the label of the piece that names it, or its id. */
    readonly address: string
  },
  request: {
    id: string
    prompt: string
    questions: readonly UserInputQuestion[]
    /**
     * 🔴 **611 · what a PASSER added, beside the original words rather than instead of them**
     * (HO-088 §3.1) — absent on a question the asker raised itself.
     */
    context?: string | null
    /**
     * ⚑ **D-016 · the label of the piece it is about** (`W1.2`) — absent for a question about no
     * piece, a passed-up one and a provider's.
     */
    label?: string | null
  },
): string {
  const about =
    request.label === undefined || request.label === null ? '' : ` about ${request.label}`
  const lines = [
    // ⚑ **679 · the asker beside the id** — a provider's id is session-local, so two children's can
    // be one string (`675` F-b), and a door handed the pair never has to refuse the id as shared.
    `${asker.called} is waiting on an answer${about} before it can go on. Answer it with answer_question, quoting ${request.id} with asked_by ${asker.address}.`,
    request.prompt,
  ]
  // 🔴 **611 · a separate paragraph, and the separation is the ruling** (HO-088 §3.1). ⛔ *"The
  // parent MAY add context; it may NOT replace the question."* ⚠️ A sentence that merged the two
  // would be the reworded question this app refuses to let anybody write — so the words above are
  // the asker's, unedited, and everything a hop added is below this line and labelled.
  if (request.context !== undefined && request.context !== null && request.context !== '') {
    lines.push(`Context added by the conversation that passed it on: ${request.context}`)
  }
  for (const question of request.questions) {
    const options =
      question.options.length === 0
        ? '    (answer in your own words)'
        : question.options.map((option) => `    - ${option.label}`).join('\n')
    lines.push(
      `  part ${question.id}${question.header === undefined ? '' : ` · ${question.header}`}: ${question.prompt}\n${options}` +
        (question.allowOther === true ? '\n    (or an answer of your own)' : '') +
        (question.multiSelect === true ? '\n    (this part takes more than one)' : ''),
    )
  }
  return lines.join('\n\n')
}

/**
 * 🔴 **The words a WORKER receives when its question is answered after its turn has moved
 * on** (591, HO-082 §2) — {@link questionText} pointed the other way down the same edge.
 *
 * ## ⛔ Why there are words at all, and not just a resolved promise
 *
 * ⚠️ **`437` held the worker's turn open and settled a promise, which reaches a model only while
 * that promise is still awaited.** ⛔ HO-082 §2 rules that *a question outlives the turn that asked
 * it, and an answer given hours later reaches the agent* — and the only thing that reaches a
 * conversation which is no longer inside that call is a TURN. ⚑ So a late answer arrives the way a
 * question does: through `queueMessage`, as words, in the mailbox lane that cannot be refused.
 *
 * ## ⚠️ It states facts about THIS answer and instructs nothing about the app
 *
 * ⛔ **No sentence here says what a bound is, how long anything waited, or what the worker may now
 * do** (HO-015 §2, standing). ⚑ **And none of them says the work is still open**, which is the
 * mistake `437`'s own review caught one door over: *"it says what the CALL did and never what the
 * world still is"* — a piece can be taken back between the answer and the reading, and a sentence
 * promising otherwise would be false by the time it was read.
 *
 * ⚑ **The question is quoted back**, because the turn that asked it may be hours gone and a model
 * reading a bare answer has nothing to attach it to.
 *
 * ## ⛔ `null` for the answerer is a PERSON, and it is not the string
 *
 * ⚠️ **`ChainHop.on`'s rule at this venue** (`shared/questions.ts`): a surface that compared a name against the word
 * *a person* would say it about an agent — or, with no agent, a working folder — that happened to be
 * called that.
 * ⚑ The two doors each pass what they know — the answering conversation, named by the piece it
 * owns (D-016 · commit 7 · R3), or nothing.
 *
 * ⛔ **A declined answer is its own arm**, because *nobody chose* and *they chose this* are
 * different things to act on and `437` already refused to let them share a word.
 */
/**
 * 🔴 **D-009 · F012 — what withdrawing a question answers** — the question closed, or why not.
 */
export type WithdrawQuestionOutcome =
  | { readonly ok: true; readonly question: string }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

/**
 * ⚑ **F026 · where an agent's answer came from, when the app knows it was not that agent's alone** —
 * it had passed the question up and a person answered it there, or the asker had addressed the
 * question to a person and the agent answered in their place. ⚑ The asker reads whose decision it
 * was: a person's choice about the work is not one its giver may later overrule. ⚠️ The answering
 * agent's words are still its own, which the sentence says, since this app cannot tell whether they
 * quote the person.
 */
export type AnAnswersOrigin = 'a-person-answered-it-where-it-was-passed-up' | 'asked-of-a-person'

export function answerText(
  /** ⚑ The answering conversation, named by its work — or `null`: a person. */
  answerer: string | null,
  question: {
    readonly id: string
    readonly prompt: string
    /**
     * ⛔ **The label of the piece it was about — NULL for a question about no piece, and for one this
     * conversation PASSED UP** (611, HO-088 §3.2) — see {@link QuestionAskedEvent.piece}. ⚑ A
     * passed-up question's work is the original asker's, so a sentence naming it would name work the
     * reader cannot look up.
     */
    readonly label: string | null
  },
  answers: readonly { readonly part: string; readonly answer: readonly string[] }[] | null,
  /** ⚑ **D-009** — a decline's reason, in the decliner's words; said only on the declined arm. */
  said: string | null = null,
  /** ⚑ **F026** — where an agent's answer came from ({@link AnAnswersOrigin}); said on its answer. */
  origin: AnAnswersOrigin | null = null,
): string {
  const who = answerer ?? 'A person'
  // ⚑ **611 · the clause is dropped rather than filled with a word.** ⛔ *"the question you asked
  // about nothing"* is the shape `a-positive-assertion-must-differ-from-the-default` warns about
  // one audience over — a sentence that reads like a fact and names none.
  const about = question.label === null ? '' : ` about ${question.label}`
  const lines =
    answers === null
      ? [
          `${who} declined to answer the question you asked${about}, ${quotingTheQuestion(question.id)}`,
        ]
      : origin === 'asked-of-a-person'
        ? [
            `${who} answered the question you asked a person${about}, instead of that person, ${quotingTheQuestion(question.id)} This app cannot tell you whether it asked them first.`,
          ]
        : [`${who} answered the question you asked${about}, ${quotingTheQuestion(question.id)}`]
  if (answers === null && said !== null) lines.push(`It said: ${said}`)
  if (answers !== null && origin === 'a-person-answered-it-where-it-was-passed-up') {
    lines.push(
      'It had passed your question up, and a person answered it there. Its answer below is in its own words: it may quote that answer, or say it differently.',
    )
  }
  lines.push(`You asked: ${question.prompt}`)
  for (const one of answers ?? []) lines.push(`  ${one.part}: ${one.answer.join(', ')}`)
  return lines.join('\n\n')
}

/**
 * ⚑ **How a routing reads in a log**, for a person or a test — never for a model.
 *
 * ⛔ **The model-facing sentences are {@link QUESTION_SENTENCES} and these are not them.** Kept
 * apart deliberately: `374`'s rule that no two rail vocabularies share a sentence, applied to the
 * two audiences of one fact.
 */
/** The two answers a to-do takes (`request_action`), as the person's window sends them. */
export const A_TO_DO_DONE = 'Done'
export const A_TO_DO_NOT_DONE = 'Can’t do it'

/**
 * The words the agent that asked a person to do something reads when it is answered: by the person
 * (`answerer` null) whether they did it, or by the agent `answerer` names, which answered for them;
 * then what was asked, and the note. `null` where the answer is neither of {@link A_TO_DO_DONE}
 * and {@link A_TO_DO_NOT_DONE}, which an answer to a question says instead ({@link answerText}).
 */
export function aToDoAnsweredText(
  answerer: string | null,
  question: { readonly id: string; readonly prompt: string; readonly label: string | null },
  answers: readonly { readonly part: string; readonly answer: readonly string[] }[],
): string | null {
  const said = answers.find((one) => one.part === 'answer')?.answer
  if (said?.length !== 1 || (said[0] !== A_TO_DO_DONE && said[0] !== A_TO_DO_NOT_DONE)) return null
  const about = question.label === null ? '' : ` about ${question.label}`
  const note = answers
    .filter((one) => one.part === 'note')
    .flatMap((one) => one.answer)
    .join('\n')
    .trim()
  const done = said[0] === A_TO_DO_DONE
  return [
    answerer !== null
      ? `${answerer} answered for the person${about}: ${done ? 'done' : 'can’t do it'}, ${quotingTheQuestion(question.id)}`
      : done
        ? `A person did what you asked them to do${about}, ${quotingTheQuestion(question.id)}`
        : `A person could not do what you asked them to do${about}, ${quotingTheQuestion(question.id)}`,
    `You asked: ${question.prompt}`,
    ...(note === '' ? [] : [`Their note: ${note}`]),
  ].join('\n\n')
}

export function describeRouting(because: ChannelRefusal): string {
  return CHANNEL_REFUSAL_SENTENCES[because]
}
