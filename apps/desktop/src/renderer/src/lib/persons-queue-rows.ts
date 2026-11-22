import type { QueueQuestionContext, QueueQuestionHop } from './question-queue-contracts'
import type { WorkInHand } from '../../../shared/question-contracts'
import type { AttentionDecision, AttentionLimit, AttentionRequest } from './attention'
// ⚑ **UI-009 · a question this app asked is drawn and answered as `QuestionCard`** — see
// {@link PersonsQueueRow.question}.
import type { AppQuestion, QuestionWords } from './question-card'

/**
 * 🔴 **What one participant in a chain has been OBSERVED to do** (613, `HO-088` §6).
 *
 * ⛔ **A closed vocabulary, because every member is a CLAIM about somebody** and the ruling that
 * asked for this shape asked for a word the ledger does not carry. `HO-088` §6 words the chain
 * *"Ali asked · Ada could not answer · BroBot could not answer"*; ⚠️ **this module had already
 * refused that word** — the corner's line said *"has not answered", never "cannot answer" — the
 * second is an inability the walk never establishes.* ⚑ The shape is the ruling's; the verb is the
 * one the walk can support.
 *
 * ## ⛔ What a hop actually carries, which is what bounds this list
 *
 * ⚑ **{@link ChainHop} is two names and nothing else** — who is waiting, and who owes the answer.
 * ⚠️ **There is no cause on a hop**, so a member here may only say something that is true of
 * EVERY hop of its kind:
 *
 *  - ⚑ the first participant RAISED the thing — it is the `askedBy` of the row itself;
 *  - ⛔ every later one has a request routed to it that is still open, and `REQUEST_IS_OPEN` is
 *    what admitted the row at all. **Silence is the whole of what is known about it.**
 *
 * 🔴 **And the causes a hop might have had cannot be confused, because only one can get here.**
 * `RuntimeHost.questionsForAPerson`'s `openQuestionOf` reads
 * `REQUEST_IS_OPEN[one.state] && one.went.to === 'the-parent'`, so an intermediate hop is a
 * conversation waiting on the one ABOVE it and nothing else.
 *
 * ⚠️ **611 · this sentence named a field that no longer exists, and re-saying it is better than
 * patching it** (HO-088 §2, standing rule 8.1). ⛔ It read *"`one.because === null`, so a request
 * the CHANNEL refused — a `PersonsQueueKind` of `a-decision` — is unreachable as an intermediate
 * hop"*, and that was TWO causes because there were only two. ⚑ {@link WhereARequestWent} now
 * names THREE, and the read excludes two of them:
 *
 *  - ⛔ `the-person-the-channel-left-it-with` — a request the channel refused, which is an
 *    `a-decision` row and was never a hop;
 *  - ⛔ `the-person-the-asker-named` — a question its asker ADDRESSED to a person (`HO-088` §2.3),
 *    which is an `escalated` row whose chain is ONE hop ending at you. ⚠️ **Walking through it
 *    would draw its parent as a conversation that *has not answered* about a question that parent
 *    was never asked**, which is the exact confusion the old conjunct was written against — it
 *    simply had no way to arrive yet.
 *
 * ⚑ **So the read narrows on WHERE IT WENT rather than on the absence of a refusal**, which is
 * shorter and truer than the null-check it replaces.
 */
export type PersonsQueueDid =
  /** ⚑ It raised the question — `request_routed`, in its own ledger. */
  | 'asked'
  /**
   * 🔴 **A question is routed to it and is still open.** ⛔ **Never *could not answer*** — see
   * this type's own docblock: escalating ends nothing, so a parent whose
   * deadline elapsed may still answer, and a walk that recorded silence may not report a refusal.
   */
  | 'has-not-answered'

/**
 * One hop as this surface draws it: a name, what that participant did, and whether the answer owed
 * here is the person's.
 */
export interface PersonsQueueHop extends QueueQuestionHop {
  /**
   * 🔴 **What this participant has been observed to do** — see {@link PersonsQueueDid}.
   *
   * ⛔ **`null` for exactly one participant, and it is the one that is not a conversation.** See
   * {@link YOU}: every member of that vocabulary is an act a CONVERSATION performed, and the person
   * the chain ends at has performed none of them. ⚠️ **Null iff {@link you}**, which
   * `the-chain-a-question-carries.test.ts` §1 asserts in both directions rather than leaving two
   * fields free to disagree about one participant.
   */
  readonly did: PersonsQueueDid | null
}

/**
 * ⛔ **Which population a row came from** (403), and it is a fact about who may settle it rather
 * than a label for a style.
 *
 * ⚠️ **The two are drawn together and never blended.** See this module's table: one is a question
 * whose parent has not answered yet, the other is a request no parent may ever be asked. A surface
 * that printed them identically would tell a person that somebody else might still pick one up.
 */
export type PersonsQueueKind =
  /**
   * 🔴 **A question a PERSON has to answer** — `questionsForAPerson`.
   *
   * ## ⛔ 612 · it was `escalated`, and the word had stopped being true of anything (HO-088 §3.1)
   *
   * ⚠️ **A NAME is a claim** (standing rule 25), and this one said *a deadline decided a parent
   * had not answered*. ⛔ **No deadline does that any more**, and since `611` two of the three ways
   * into this population never involved one: an asker ADDRESSES a question to a person, or a parent
   * PASSES IT UP. 🔴 **After `612` the word is true of nothing this app will ever write** — only of
   * rows a ledger already holds.
   *
   * ⚑ **`a-question` reads as the noun it is**, beside `a-decision`: the two things a person's
   * queue can hold, named by what they ARE rather than by how they got there.
   * ⚠️ **And the sibling names were already nouns**, which is what made the odd one visible.
   */
  | 'a-question'
  /** A request that never travelled: only a person may settle it — `decisionsForAPerson`. */
  | 'a-decision'

/** One thing a person now owes an answer or a decision to. */
export interface PersonsQueueRow extends QueueQuestionContext {
  /**
   * ⛔ **Which of the two populations this is** — see {@link PersonsQueueKind}. ⚠️ The row's chain,
   * its age and its words all differ by it, and a surface reads this rather than inferring the kind
   * from the shape of the chain, which two rows could coincide on.
   */
  readonly kind: PersonsQueueKind
  /**
   * Distinct across conversations — the list renders on this, and it is the key
   * {@link alsoOnScreen} is looked up by, so it is the live queue's own spelling
   * (`sessionId:requestId`) and carries no mention of {@link kind}.
   */
  readonly key: string
  /**
   * ⛔ **The conversation the CARD is in** — `askedBy`, the child that raised it, never the parent
   * that failed to answer. A person answers where the card is.
   */
  readonly sessionId: string
  /**
   * ⛔ **The chain, asker first, ending at you** — rendered from the hops the host named, never
   * from a sentence taken apart again.
   */
  readonly chain: readonly PersonsQueueHop[]
  /**
   * ⛔ **What kind of thing only a person may settle here, in the vocabulary's own words** — *"a
   * command or file approval, which is a person's to give"* — and **null for an escalated
   * question**, which is not one of those things: it travelled, and what happened is that nobody
   * answered.
   *
   * ⚑ **Composed main-side** — see `PersonsDecision.says`. The map is a value in
   * `@brobot2/runtime` and the window does not import it.
   */
  readonly says: string | null
  /**
   * ⛔ **Whether this window is already running the conversation the card is in.**
   *
   * ⚠️ **It decides the GESTURE, and the gesture is a widening.** A conversation this window holds
   * is opened; one it does not is `336`'s door — taking over a conversation nobody owns — and a
   * person is told which of the two the button does before they press it, never after.
   */
  readonly held: boolean
  /** What the button says, given {@link held}. */
  readonly action: string
  /**
   * ⛔ **Whether the card is ALSO live in a conversation this window holds** (`attention.ts`).
   *
   * ⚑ **The card and this row say different things about one conversation**: the card carries
   * the question and an answer, this row the chain and how long a person has owed it. ⚑ **D-017 ·
   * R19 — *Waiting on you* no longer lists the card beside this row** (`listedNowhereElse`), so the
   * row says where the card is rather than that it is listed twice.
   *
   * ⛔ **Since `434` it is also the CAPABILITY and not only a disclosure**: the live queue's row is
   * where the offered answers come from, so a row that is on it can be settled here and a row that
   * is not cannot. See {@link answers}.
   */
  readonly alsoOnScreen: boolean
  /**
   * 🔴 **The answers a person may send FROM THIS ROW, in the words the card itself uses** (434,
   * HO-024 criterion 17's second clause).
   *
   * ⛔ **Taken off the live projection and computed nowhere else.** `permissionOffer` and
   * `userInputOffer` decide what one request offers; `attention.ts` puts that on an
   * `AttentionRequest`; this copies it. ⚠️ **A second computation main-side was the obvious
   * alternative and it is the defect `214 §3` names by name** — *"holding the vocabulary here and
   * the card's answer there is what let a summary say a plan could not be approved while the card
   * beside it approved plans"*.
   *
   * ⛔ **Empty is not *nothing may be done*; it is *not from here, and here is why*** — exactly one
   * of {@link answers} being non-empty and {@link noAnswerHere} being non-null holds, on every row
   * but a question this app asked, which its own card answers ({@link question}) and which has
   * neither.
   */
  readonly answers: readonly AttentionDecision[]
  /**
   * ⛔ **Why there is no POSITIVE one-click answer here, or null because there is** (434) — the
   * live row's own {@link AttentionLimit}, drawn beside the buttons exactly as `AttentionQueue`
   * draws it.
   *
   * ⚠️ **Not one of {@link noAnswerHere}, and the difference is measured rather than tidy.**
   * `userInputOffer` always offers Reject — *"the protocol-safe default the contract names"* — so
   * a limited request can still be settled from here; what it cannot be is ANSWERED from here.
   * ⛔ Folding the two would tell a person a frozen child cannot be released when it can.
   */
  readonly limit: AttentionLimit | null
  /**
   * 🔴 **Why this row cannot be settled here, or null because it can** (434).
   *
   * ⚠️ **A closed vocabulary, because a surface has to say something specific.** *"Take it over"*,
   * *"the card is not in this window"*, *"an answer is already going"*, *"it is over and this list
   * has not caught up"* and the {@link AttentionLimit} shapes are each a different thing to do
   * next, and one shrug for all of them is `106` — a control that cannot act, with nothing saying
   * why. ⛔ **Stated without a COUNT since `468` added a fifth member** and found this sentence
   * naming four.
   */
  readonly noAnswerHere: NoAnswerHere | null
  /**
   * 🔴 **UI-009 · a question THIS APP asked, drawn and answered as its card** (F052) — or `null`
   * for every other row (a provider's question, a decision, a row whose raiser no read found).
   *
   * ⚑ **The card is the whole row**: who asked and about which piece, the words, the options, the
   * box, and the press to the conversation — `QuestionCard`, the one the conversation draws. Its
   * answer goes through `respondUserInput` with the id this app minted, which the host finds in the
   * asker's ledger and admits a person's answer to whoever holds it (D-017 · R6) — so it needs no
   * take-over, and {@link answers} and {@link noAnswerHere} are empty on it.
   *
   * ⚑ **D-046 · the words are the person's list's own** (`PersonsQuestion.asked`), whichever
   * conversation asked and whether or not this window holds it. Where the host found none the card
   * has the host's offer and no box.
   */
  readonly question: AppQuestion | null
  /**
   * 🔴 **D-046 · a question the PROVIDER raised, as it was asked — for drawing only.** Its card in
   * its asker's conversation stays the one surface that answers it, so nothing here offers to; ⚑
   * `null` for a question this app asked (its card above carries the words), a decision, and a
   * row the host found no words for.
   */
  readonly words: QuestionWords | null
  /**
   * What a decision row's request asks, as its card discloses it, on a row that offers answers here,
   * so a person reads what they are answering. `null` on every other row.
   */
  readonly disclosed: DisclosedRequest | null
  /**
   * 🔴 **Why this request offers no way to ALLOW it** (487) — the sentence, or null when it offers
   * one, carried through from {@link AttentionRequest.noPositive}.
   *
   * ⚠️ **Not one of {@link noAnswerHere}, and it is the same distinction `limit` already makes**:
   * this row CAN be settled from here — 487's whole point is that both refusals are on it — so
   * folding *"there is no way to allow this"* into *"you cannot answer this here"* would tell a
   * person the opposite of what is true. ⛔ Null wherever the card is not in this window, because
   * then there is no live offer to be short of and this row would be guessing.
   */
  readonly noPositive: string | null
  /**
   * 🔴 **701 · `700` §5 GAP 1 — what the provider's marks say** — {@link AttentionRequest.marksSay},
   * copied and never recomputed: `whatTheMarksSay`'s lines in its order (why no grant is here, why
   * Deny leads, and the provider's own words, last — its reason for a mark, or since `725` (R73) a
   * policy's rule, labelled as its rule).
   *
   * ⛔ **Empty wherever this row has no answers**, for {@link noPositive}'s reason and a sharper one:
   * one of those lines says Deny comes FIRST here, which is false beside no buttons at all. ⚠️ Before
   * `701` this surface — the floating one a person answers from over any screen — drew none of them,
   * so an ask the provider marked had live Allow and Deny buttons and no word of the mark.
   */
  readonly marksSay: readonly string[]
  /**
   * 🔴 **701 · refusal is this row's default** — {@link AttentionRequest.refusesFirst}: its
   * refusals lead (they already do — {@link answers} is the offer's own order) and must not be
   * DIMMED the way a refusal that is not the expected answer is. `false` wherever there are no
   * answers.
   */
  readonly refusesFirst: boolean
  /**
   * 🔴 **Why the last answer sent from here did not land, on a row that is still answerable**
   * (468) — {@link AttentionRequest.refused}, which is the transcript item's own sentence.
   *
   * ⛔ **Beside {@link answers} and not instead of them, and that is the whole shape.** A refusal
   * the host left open puts the request back on the table — `noteAnswer` clears `sent` for exactly
   * that reason — so the buttons come back. ⚠️ **Before this they came back with nothing said**:
   * the sentence went to the card, and a person answering from the queue watched four controls
   * disappear and reappear with no account of it. ⛔ `106` on a control that DID act and was
   * refused.
   *
   * ⚑ **Not a member of {@link NoAnswerHere}**, and the docblock there says why: that vocabulary
   * is *cannot be settled here*, and this row can — it is *press again, and here is what happened
   * last time*.
   *
   * ⛔ **Null for a refusal that CLOSED the card, and that is the contract rather than a gap.**
   * `markRequestFailed` writes `note`, `isAwaitingAnswer` goes false and the
   * live projection drops the request — so there is no row to press and nothing to say *press
   * again* about. ⚑ That state is {@link NoAnswerHere} `'no-longer-waiting'`, and the host's own
   * sentence is on the card the row's button opens.
   */
  readonly refused: string | null
  /**
   * 🔴 **The open work the conversation that asked is holding** (434, criterion 20's *which
   * work*) — and see {@link WorkInHand}: it is that CONVERSATION's work.
   *
   * ⛔ **474 · it is no longer the whole answer to *which work*, and the sentence that said it was
   * is gone.** This note read *"not this question's subject, which is a fact nothing in the ledger
   * records"*; `437` had already made that false for one origin, and {@link about} is the fact it
   * was denying. ⚠️ The list is still drawn beside the edge — what a blocked conversation is
   * holding is what a person has to move — and it is never narrowed to the named task.
   */
  readonly work: readonly WorkInHand[]
}

/**
 * ⛔ **Why a row cannot be settled from the queue** (434) — one value, and every one of them is a
 * different next move for the person reading it.
 */
export type NoAnswerHere =
  /**
   * ⚑ **UI-009 · `'no-card-was-drawn'` is gone** — a question this app asked is answered on its own
   * card in the row, with its options or in the person's own words ({@link PersonsQueueRow.question}).
   *
   * ⛔ **This window does not hold the conversation the card is in**, which is the ORDINARY state
   * of this population: an agent-spawned child is reserved under no owner. ⚑ The move is `336`'s
   * door — take it over — and the row says so rather than offering a control that would be refused.
   */
  | 'not-yours-yet'
  /**
   * ⚠️ **This window HOLDS it and the live fold has no pending request under this key.** A card old
   * enough to have been released from the window's page is the reachable way in (`106`).
   *
   * ⛔ **It used to cover a second cause and it was the WRONG sentence for it** (468). *"…and so
   * is the gap between a look landing and a card being answered in another surface"* was true of
   * the state and false of the words: the sentence tells a person to open a card and answer it,
   * and for the commonest way into this branch — **they had just answered it themselves, from
   * this row** — there is nothing there to answer. See {@link 'no-longer-waiting'}.
   *
   * ⚠️ **What is left here really is the paging case**, and it is the one `106` named: a card old
   * enough to have been released from the window's page, with no answer ever sent from here.
   * Every settled card this window acted on — taken, refused-and-gone, or a fault nobody could
   * classify — is `'no-longer-waiting'`, because `RequestDraft.answered` survives all three.
   */
  | 'not-in-this-window'
  /**
   * 🔴 **This window answered it and the list has not caught up** (468, `453` weak point 1).
   *
   * ## ⛔ The five seconds, and what was actually in them
   *
   * ⚑ **The press is not silent and has not been since `207` M2**: `markSent` writes `sent` on the
   * record's own draft BEFORE the first await, so the buttons are replaced by
   * {@link 'answer-sent'} inside one tick. ⛔ **What follows it is the defect.** The host publishes
   * `user_decision`, the record's fold closes the item, {@link isAwaitingAnswer} goes false and the
   * request leaves `attentionQueue` — while the ROW stays, because the row came off a ledger walk
   * that is up to {@link LOOK_EVERY_MS} old. ⚠️ **So `live` is undefined on a conversation this
   * window holds**, which is {@link 'not-in-this-window'} — *"open it to answer"*, about a card
   * the person answered four hundred milliseconds ago.
   *
   * 🔴 **A false instruction is worse than silence**, and the bulk of the five seconds was spent
   * giving one.
   *
   * ## ⚑ Why it is not an opinion of its own about what is closed
   *
   * ⛔ **It is a read of `RequestDraft.answered`**, a CURRENT read rather than a memory: this
   * module holds no list of keys it has seen settled, and the row leaves when the LEDGER says so
   * and at no other moment. ⚠️ The two members differ by one fact each is already given — whether
   * the live request is still there — and nothing new is remembered to tell them apart.
   *
   * ⚑ **`answered` and not `sent`, and this dispatch's own review is why.** `sent` is `064`'s
   * in-flight guard and comes off on every failure, including the refusals that also CLOSE the
   * card — so reading it left exactly those cards drawing the retired sentence.
   *
   * ⚑ **The next move it names is *none*, and that is a next move.** Every other member sends a
   * person somewhere; this one is the only state in which the right thing to do is nothing, and
   * saying so is the whole of what `453` asked for.
   */
  | 'no-longer-waiting'
  /**
   * ⛔ **An answer is already on its way** (`207` M2) — the row is not offered again, and the
   * reason is said rather than the buttons being drawn dead with nothing beside them.
   */
  | 'answer-sent'
  /**
   * ⚠️ **The request itself offers nothing this surface can send.** `permissionOffer` filters the
   * outcomes the PROVIDER named, and a request that named none leaves an empty row (⚑ since `743`,
   * `739` F-1 ruled, a request naming only the wholesale grant draws that grant here, as the card
   * does). ⛔ `106`: a control that cannot act must say so rather than be absent.
   *
   * 🔴 **487 narrowed what can reach it, and did not remove it.** Every producer this app owns now
   * publishes both always-honoured refusals, so a permission this window's own adapters raised
   * always has two answers on it. ⛔ **What still reaches here is an event this window did not
   * produce** — a replayed ledger from before that change, or an adapter it has never met — and
   * {@link PersonsQueueRow.noPositive} is the different, live case: a row that CAN be refused and
   * cannot be allowed.
   */
  | 'nothing-on-offer'

/**
 * 🔴 **The order criterion 17 asks for: oldest-blocked first, over both populations** (434).
 *
 * ## ⛔ Where a row with NO instant goes, decided rather than fallen into
 *
 * **LAST.** ⚠️ *Oldest-blocked-first* is a promise about a NUMBER, and a row with no number is
 * neither the oldest nor the newest — so the only dishonest thing available is to let it land at
 * one end silently. ⛔ **`?? 0` would put every clockless row at the TOP**, which is the strongest
 * claim this list makes: *this is the one that has waited longest*. A row that cannot support that
 * claim may not be given it.
 *
 * ⚑ **The same ruling `attention.ts` already made, one surface over, and deliberately not a second
 * opinion about it**: *"A card with NO recorded time sorts LAST, not first. An unknown age is not
 * an old age"* — `086`'s rule applied to a comparator. ⛔ Two queues a person reads in one panel
 * may not sort an unknown two different ways.
 *
 * ⚠️ **And it is SAID on the row, not only sorted** — {@link PersonsQueueRow.blockedSinceIs} is
 * `not-recorded`, and the surface draws that rather than a blank: a row at the bottom with no
 * words looks like the newest thing in the list.
 *
 * ## ⛔ The tie-break, and why a tie is broken by KIND
 *
 * ⚑ **`a-decision` first, which is `byUrgency`'s ruling in this list's vocabulary**: *"a permission
 * freezes the composer as well as the turn, so with two cards of the same age it is the one that
 * has stopped more"* — and `a-decision` is the permission-shaped population by construction. ⚠️
 * Then {@link PersonsQueueRow.key}, so the order is TOTAL: a list that re-orders two equal rows
 * between two five-second looks is a list a person cannot read twice.
 *
 * ## 🔴 The tie-break is a table rather than a ternary (446)
 *
 * ⛔ **`left.kind === 'a-decision' ? -1 : 1` reads as total and stops being total at three kinds**:
 * a third would sort above a question and below one depending on which side of the comparison it
 * landed, which is a comparator that is not a total order. ⚑ {@link BLOCKED_ORDER_OF_KIND} is
 * exhaustive, so a new kind is a compile error here rather than a silently wrong sort.
 */
export function byBlockedSince(left: PersonsQueueRow, right: PersonsQueueRow): number {
  if (left.blockedSince !== right.blockedSince) {
    // ⛔ **Null LAST, on both sides, and never through an arithmetic default.**
    if (left.blockedSince === null) return 1
    if (right.blockedSince === null) return -1
    return left.blockedSince - right.blockedSince
  }
  if (left.kind !== right.kind) {
    return BLOCKED_ORDER_OF_KIND[left.kind] - BLOCKED_ORDER_OF_KIND[right.kind]
  }
  return left.key < right.key ? -1 : 1
}

/**
 * 🔴 **Which kind wins a tie, exhaustively** (446) — the ordering the paragraph above argues for,
 * written as data so a new population cannot default into a position nobody chose. ⚑ Ties are rare
 * and the AGE above decides every ordinary case; the population a row belongs to is written on the
 * row either way.
 */
const BLOCKED_ORDER_OF_KIND: Readonly<Record<PersonsQueueKind, number>> = {
  'a-decision': 0,
  'a-question': 1,
}

/**
 * 🔴 **The fixed copy for each population, said once** (434, on the row since 403) — in the module,
 * because *one derivation, wherever it lives* is this file's rule
 * (`a-closed-vocabulary-guards-what-a-member-says`): two sentences for one `kind` are free to
 * disagree about who else might still pick a row up.
 *
 * ⚠️ **The escalated label states the SILENCE and the decision label states the RULE**, which is
 * the difference the two populations carry: a parent that has not answered may still answer, and a
 * request that never travelled has nobody above it who ever could.
 *
 * 🔴 **Why it left the group header.** Criterion 17 orders ONE list by how long each thing has been
 * blocked, and a group is a second ordering: with the rows grouped, a nine-minute permission sat
 * under a four-second question because of which reader found it. ⛔ **A label over a group is
 * therefore not available any more**, and the fact it carried — which population a row is — is
 * carried by the row, which is where {@link PersonsQueueRow.kind} always said it was.
 *
 * ⚠️ **Neither says *them* or *these*, and neither says *routed*.** These rows ARE routed requests:
 * what they were refused is entry to the question channel, which is not what *routed* means
 * anywhere else in this app.
 */
export const KIND_WORDS: Readonly<Record<PersonsQueueKind, string>> = {
  'a-question': 'Escalated to you — nobody above has answered',
  'a-decision': 'Only you can decide — nobody else was ever asked',
}

/**
 * 🔴 **The word each act is drawn as, said once for every surface that draws a chain** (613).
 *
 * ⛔ **Here and not in a component**, for {@link KIND_WORDS}'s reason: two vocabularies are two
 * sentences for one fact, free to disagree. ⚠️ A chain is drawn on two surfaces today and the same
 * argument holds for each hop of it.
 *
 * ⚑ **Exhaustive over {@link PersonsQueueDid}**, so a fifth act cannot reach a person without a
 * word of its own — the property {@link NOUN_OF_KIND} has for populations.
 */
export const DID_WORDS: Readonly<Record<PersonsQueueDid, string>> = {
  asked: 'asked',
  // ⛔ **Not *could not answer*, which is what `HO-088` §6 wrote** — see {@link PersonsQueueDid}.
  // ⚑ It is the strongest claim the walk establishes about one participant.
  'has-not-answered': 'has not answered',
}

/**
 * 🔴 **737 · `734` F-2 — a row whose asker reads the same NAME as another conversation's.**
 *
 * ⛔ **Two parents' Bobs are two rows that both read *"Bob waiting on you"*** — a give finds the
 * one conversation its giver has with an agent, per giver, so two live conversations of one
 * identity are ordinary, and
 * since `734` the queue names a conversation by its agent (R41). ⚑ Each row carries its own
 * conversation ({@link PersonsQueueRow.sessionId}) and its own press, but ⛔ the id is never drawn
 * (`HO-095` §5.3), and nothing a person could recognise is sure to differ between them: the same
 * folder, no task (`734` §1.7's shape). ⚑ **What always differs is WHEN each
 * conversation reached you** — its earliest row, on the clock this list sorts by
 * ({@link byBlockedSince}) — so that is what the row says, beside the name and outside the chain
 * the host named. ⚠️ Of the CONVERSATION, not the row: a conversation holding two rows is placed by
 * its earlier one, so its later row can sit below a namesake's and still say it reached you first — and
 * every row of it says the same, which is what ties them to one conversation.
 *
 * ⚠️ **Which Bob is WHOSE is not on the wire** — the parent's name (`737` GAP-Q1); the row says there
 * are two and which reached you first, and no more.
 */
export interface Namesake {
  /** The name the rows share — the asker's hop, as the host named it. */
  readonly name: string
  /** How many OTHER conversations in this look read the same name. */
  readonly others: number
  /**
   * ⚑ This conversation's place by when it reached you — `1` reached you first (its earliest row,
   * on {@link byBlockedSince}'s clock). ⛔ `null` when the look cannot tell: a stamp that did not
   * cross, or two alike.
   */
  readonly rank: number | null
}

/**
 * 🔴 **737 · the rows of {@link rows} that have a namesake, by row key** — over the WHOLE look.
 *
 * ⚠️ **Conversations, not rows**: one conversation holding two requests is two rows with one
 * `sessionId`, and those are not namesakes of each other. ⚑ A conversation reached you with its
 * earliest row.
 */
export function namesakesIn(rows: readonly PersonsQueueRow[]): ReadonlyMap<string, Namesake> {
  const byName = new Map<string, Map<string, number | null>>()
  for (const row of rows) {
    const asker = row.chain[0]
    if (asker === undefined) continue
    const conversations = byName.get(asker.name) ?? new Map<string, number | null>()
    byName.set(asker.name, conversations)
    const waiting = conversations.get(row.sessionId)
    conversations.set(
      row.sessionId,
      !conversations.has(row.sessionId)
        ? row.blockedSince
        : waiting === null || waiting === undefined || row.blockedSince === null
          ? null
          : Math.min(waiting, row.blockedSince),
    )
  }
  const namesakes = new Map<string, Namesake>()
  for (const row of rows) {
    const asker = row.chain[0]
    if (asker === undefined) continue
    const conversations = byName.get(asker.name)
    if (conversations === undefined || conversations.size < 2) continue
    const since = [...conversations.values()]
    const told = since.every((at) => at !== null) && new Set(since).size === since.length
    const mine = conversations.get(row.sessionId) ?? null
    const rank =
      told && mine !== null ? 1 + since.filter((at) => at !== null && at < mine).length : null
    namesakes.set(row.key, { name: asker.name, others: conversations.size - 1, rank })
  }
  return namesakes
}

/**
 * ⚑ **The ordinals a namesake line counts in** — `ten` is far past any queue a person reads; past it
 * the line says the number.
 */
const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
] as const

/**
 * 🔴 **737 · what a namesake row says** — *"Bob has another conversation asking you something too;
 * this conversation reached you first."*
 *
 * ⚑ *Asking you something* is true of both kinds on both surfaces — a question, and a decision only
 * you can make. ⛔ **Not *asked first*** (737 review, round three): the place is
 * when each REACHED you, on the clock the list sorts by, and an escalated question reached you after
 * it asked its parent — so *reached you first* is the one true of the clock.
 * ⚠️ **The CONVERSATION's place** ({@link Namesake.rank}), so every row of one conversation says the
 * same thing — which is how two rows of one Bob read as one Bob.
 */
export function namesakeSays(namesake: Namesake): string {
  const { name, others, rank } = namesake
  const count = others + 1
  const lead =
    others === 1
      ? `${name} has another conversation asking you something too`
      : `${name} has ${others} other conversations asking you something too`
  if (rank === null) return `${lead}; each row opens its own conversation.`
  if (rank === 1) return `${lead}; this conversation reached you first.`
  if (rank === count) {
    return `${lead}; this conversation reached you ${count === 2 ? 'second' : 'last'}.`
  }
  return `${lead}; this conversation reached you ${ORDINALS[rank - 1] ?? `number ${rank}`} of ${count}.`
}

/** What a request asks, as its card discloses it — the fields of {@link AttentionRequest} that say so. */
export type DisclosedRequest = Pick<
  AttentionRequest,
  'asked' | 'scope' | 'underDisclosed' | 'detailOmitted' | 'agentSays' | 'actionLines'
>

/**
 * ⛔ **Everything this derivation needs that is not a row** — one object, because the four move
 * together and a view assembled from two of them taken at different moments is the defect
 * {@link PersonsQueue.supply} already refuses for the two populations.
 */
export interface PersonsQueueWorld {
  /** Session ids this window is running right now. */
  readonly held: ReadonlySet<string>
  /**
   * 🔴 **The live attention row for every `sessionId:requestId` this window can answer** (434) —
   * `attention.ts`'s own projection, keyed by its own key.
   *
   * ⛔ **The map and not a set of keys**, since `434`: the row it holds is where
   * {@link PersonsQueueRow.answers} comes from, and a set would have made *"is it also on screen"*
   * and *"what may be sent"* two facts free to disagree.
   */
  readonly answerable: ReadonlyMap<string, AttentionRequest>
  /**
   * The row for each request in a conversation no window holds, built from the card the host read
   * in its record, by the same key: what a row offers when this window does not hold its asker.
   * Absent where no such card was read.
   */
  readonly nobodyHolds?: ReadonlyMap<string, AttentionRequest>
  /**
   * 🔴 **Every `sessionId:requestId` this window has sent an answer for and not had put back**
   * (468) — see {@link NoAnswerHere} `'no-longer-waiting'`.
   *
   * ⛔ **A set of keys and not a map, because there is nothing to carry.** {@link answerable}
   * holds rows because the row is what a person may press; this holds the one bit that separates
   * *the card here was answered* from *the card here was never in this page*, and a second copy of
   * anything else would be a fact free to disagree with the row beside it.
   *
   * ⚠️ **It is a READ of `record.requests`, not a list this module keeps.** The screen derives it
   * from the same drafts `attention.ts` reads `sent` off; nothing here writes to it, nothing
   * remembers it across a look, and a row leaves the queue only when a ledger walk stops
   * returning it.
   */
  readonly answeredFromHere: ReadonlySet<string>
  /** The clock the ages are measured against. */
  readonly now: number
  /**
   * 🔴 **Whether the MOST RECENT look answered, per population** (434) — see
   * {@link PersonsQueueView.stale}.
   *
   * ⚠️ **Not derivable from the rows.** The screen keeps each population's last good answer on a
   * refusal, so by the time a list reaches this function a read that has been failing for an hour
   * is indistinguishable from one that answered a moment ago.
   */
  readonly lastLookAnswered: {
    readonly questions: boolean
    readonly decisions: boolean
  }
}
