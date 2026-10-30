import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import { NOTHING_NAMED_THE_WORK, WALK_COVERS } from '../../../shared/questions'
import type {
  AboutWork,
  ChainHop,
  LedgerWalk,
  // ⚑ **619 · what the asker offered** — the one part a question's card has where its words are
  // not in this window (UI-009, D-046).
  OfferedAnswer,
  PersonsDecision,
  PersonsQuestion,
  LedgerWalkKind,
  WorkInHand,
} from '../../../shared/questions'
// ⚑ **557 · the second band the queue carries beside its rows** — see {@link StalledWorkView} for
// the table that decides it is a band and not a fourth row.
import { stalledWorkKey, stalledWorkSaid } from '../../../shared/stalled-work'
import { unreadSays } from './rows-unread'
import type { StalledWork } from '../../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../../shared/stopped-work'
import { clockTime } from '../../../shared/clock'
// ⚑ **F097 · the work whose agent answered a person, carried beside the rows and counted with them**
// — see {@link WaitingOnWhoWroteView} for why it is beside them and not one of them.
import { waitingOnWhoWroteKey, type WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
// ⚑ **D-017 · R19 · the asks against an identity's rules, carried beside the rows** — see
// {@link InstructionAsksView} for why they are beside them and not one of them.
import type { InstructionAskWaiting } from '../../../shared/own-instructions'
import type { AnswerAck, McpServerRequestForAPerson } from '../../../shared/runtime-ipc'
// ⚑ **533 · the wall the queue carries beside its rows** — see {@link ProviderLimitsView} for why
// it is beside them and not one of them.
import { providerConditions } from '../../../shared/provider-limit'
import type { ProviderCondition, ProviderLimitSeen } from '../../../shared/provider-limit'
import type { LimitsDisplayState } from './limits-display'
import type { AttentionDecision, AttentionLimit, AttentionRequest } from './attention'
import { agoWords } from './clock'
import { OPEN_THE_CONVERSATION } from './taking-over'
import {
  questionsOnly,
  todoAnsweredSays,
  todosOf,
  workWaitsView,
  type IncidentsRead,
  type ListRead,
  type TodoRow,
  type WorkEntry,
  type WorkWaitsView,
} from './work-waits'
import type { PermissionDecision, UserInputResponse } from '../../../shared/runtime-ipc'
// ⚑ **UI-009 · a question this app asked is drawn and answered as `QuestionCard`** — see
// {@link PersonsQueueRow.question}.
import { wordsAsked, type AppQuestion, type QueuePress, type QuestionWords } from './question-card'

/**
 * ⚑ **W4.28 review · *I opened it* is never offered where the link is not shown.** A server's url
 * card answers *I opened it* (`accept`) — the person's word that they opened the link on the card —
 * and this queue draws no request detail, so the link is not on its row. ⛔ The positive is left off
 * here; Deny, Cancel and the way to the card stay. The card and the overview, which show the link,
 * keep it.
 */
function withoutALinkItDoesNotShow(
  live: AttentionRequest | undefined,
): AttentionRequest | undefined {
  if (live === undefined || live.kind !== 'permission') return live
  const decisions = live.decisions.filter(
    (one) =>
      !(
        one.kind === 'permission' &&
        one.decision.outcome === 'allow' &&
        one.server?.opensALink === true
      ),
  )
  return decisions.length === live.decisions.length ? live : { ...live, decisions }
}
/**
 * 🔴 **The queue that ends at a person — what has been escalated to YOU, and the chain that says
 * why** (401, HO-007 criterion 11, HO-018 §5 item 3).
 *
 * ⚑ The PO's words for why this exists at all:
 *
 * > ⛔ **"A chain that stops before the person is not a chain — it is the feature not existing,
 * > disclosed as a backend."**
 *
 * ## ⛔ Why it is a module and not a component, and why there are two surfaces
 *
 * ⚠️ **`spawn-safety.ts`'s shape, one subject over, and for the same measured reason.** `390`
 * proved that a control which only exists when nothing else is open is not available at the moment
 * a person reaches for it: every `OverlayHost` is a fixed `inset: 0` `aria-modal` layer with a
 * focus trap and it deliberately covers the rail. ⛔ **A question is exactly what a person opens a
 * sheet to answer**, so a queue reachable only with everything closed is `390` again with the
 * subject changed. So the same rows are drawn twice — on *Waiting on you*, and in the overlay layer —
 * and this file is what makes "twice" safe: **one state, and one derivation of every word that
 * MOVES**, and the fixed copy said once (see {@link KIND_WORDS} and {@link sinceWords}).
 *
 * ## 🔴 It is a POLL, and that is a measurement rather than a preference
 *
 * ⛔ **Nothing pushes a question at this window, and three independent facts each make that
 * true.** (1) `RequestRoutedEvent` is written into the ledger of the CHILD that asked, and a
 * spawned child is reserved under no owner — its sink is `NO_SURFACE`, whose `alive` is `false`, so
 * `RuntimeHost.emitOurs` returns before it sends. (2) A row for a conversation this host is not
 * running is written straight to the database by `SessionStore` with no wire message at all.
 * (3) Even in the window that DOES own the child, `transcript.ts` draws nothing for that row at
 * all — the words are already on the page.
 *
 * ⚑ **612 · the three facts named `RequestEscalatedEvent` until `HO-088` §3.1 removed the only
 * thing that wrote one.** ⛔ **Every one of them is unchanged and the SUBJECT moved** — which is
 * the strongest form this argument has ever had, because the row that makes a question a person's
 * is now the ROUTING itself, written by `ask_question` or `pass_question_up`.
 *
 * ⚠️ **So the only honest cadence is asking.** {@link LOOK_EVERY_MS} says how often and why.
 *
 * ## ⚠️ What this surface may NOT do, all four, from the brief
 *
 *  - ⛔ **It never answers.** Knowledge escalates; authority does not. A person answers a question
 *    on the card, in the conversation it was raised in, through `respondUserInput` — the door that
 *    has always been there. This takes them to it and does nothing else.
 *  - ⛔ **It never invents an actor.** `PersonsQuestion` carries no decider and this adds none.
 *  - ⛔ **It never implies a question is answerable when it is not.** See {@link PersonsQueueRow}
 *    on `held`, and {@link personsQueueView} on why a CLOSED question can never appear here.
 *  - ⛔ **It never rounds the count.** {@link PersonsQueueView.count} is `rows.length`.
 *
 * ## 🔴 TWO populations, from two readers, and they are not the same kind of thing
 *
 * ⛔ **`401` drew the queue and could not see the population a spawned child actually lands in.**
 * `402` performed the loop live and measured it: every spawned child is `ask` BY RAIL, so its first
 * consequential tool call parks on a permission card — and `questionsForAPerson` is structurally
 * unable to list one, because a permission never travelled and so was never escalated. **Three
 * permissions needed a person on one worker and that queue listed none of them.**
 *
 * ⚑ **So there are two readers, and the difference is the reason there are two rather than one
 * widened one:**
 *
 * | {@link PersonsQueueRow.kind} | reader | what it promises |
 * |---|---|---|
 * | `a-question` | `questionsForAPerson` | an agent asked something a PERSON has to answer. A parent may still answer it (`HO-088` §2.3); the chain is the walk; the age is {@link aPersonsSince} |
 * | `a-decision` | `decisionsForAPerson` | a request never travelled at all. **No parent may ever answer it**; the chain is one hop; the age is the routing's own `at` |
 *
 * ⛔ **Knowledge escalates; authority does not**, and criterion 10's negative rides on the first
 * reader being unable to return the second's rows. ⚠️ **They are merged HERE and nowhere earlier**
 * — one list, one count, one summons — because a person does not have two inboxes; what stops the
 * merge being a blend is that every row says which it is, in its own chain and in its own words.
 *
 * ## 🔴 One ORDER over both, and it is criterion 17's whole first clause (434)
 *
 * ⛔ **`403` concatenated them — every escalated row, then every decision — and each reader sorted
 * its own population.** So the list was ordered twice and globally not at all: a permission a child
 * parked on nine minutes ago sat below a question that became a person's four seconds ago, because
 * of which READER found it. ⚠️ HO-024 criterion 17 says *"ordered, with the oldest-blocked first"*,
 * and an order that is a function of the reader is not that.
 *
 * ⚑ **So the merge sorts, on {@link PersonsQueueRow.blockedSince}** — see
 * {@link byBlockedSince} for the comparator and {@link PersonsQueueRow.blockedSinceIs} for the
 * thing that makes one number out of several clocks honest: each row says WHICH instant its own
 * number is, so *oldest-blocked-first* is one ordering over several facts rather than one fact
 * invented over several populations.
 */

/**
 * ⛔ **How often this window asks whether anything has become a person's** (401).
 *
 * ## ⛔ 612 · its derivation is GONE and its JOB grew (HO-088 §3.1)
 *
 * ⚠️ **It said: *"derived from the deadline it is watching, not chosen. `ESCALATION_WINDOW_MS` is
 * 30 s (398, measured by 353), so a question becomes a person's at most one window after it is
 * asked and then waits on a human — this is a sixth of that."*** ⛔ **There is no deadline.** A
 * question is a person's the INSTANT its routing row is written: `611`'s `ask_question` addresses
 * one there in one call, and `pass_question_up` carries one there in one act.
 *
 * 🔴 **So the number did not move and everything it was FOR did** —
 * `a-number-can-survive-the-death-of-its-derivation`, caught by the dispatch that killed the
 * derivation rather than by the one that trips over it later.
 *
 * ## ⚑ What it is for NOW, and it is a stronger claim than the one it replaces
 *
 * ⛔ **This poll is the WHOLE latency between an agent asking and a person knowing.** Every
 * population it feeds — a question, a decision, stalled work — is a person's
 * from the instant its row is written, and nothing pushes (see `RuntimeScreen.lookForWhatIsYours`
 * for the three facts). ⚠️ **It used to bound staleness against a clock that moved in thirties; it
 * now bounds it against zero.**
 *
 * ⚑ **Five seconds is held by the COST argument, which is the half that survived intact** — and it
 * is why the number is not shorter rather than why it is this one. ⛔ **Not two seconds, which is
 * what `ChildWorkViewer` polls at.** That read *"costs a buffer read and nothing else"*; this one
 * is a fold of every ledger that has ever routed a request. ⚠️ **And nothing makes it longer**: a
 * summary may be thirty seconds stale (`DISTIL_EVERY_MS`), a list of a person's own obligations
 * may not.
 *
 * 🔴 **What would settle it is a MEASUREMENT nobody has taken** — the wall-clock cost of one look
 * against a workspace of N routing ledgers. ⛔ `612` did not take it and does not pretend the
 * number is derived; what it has is a reason to keep it and a named reason it is not two.
 */
// Questions, approvals and other actionable queue readings refresh every five seconds.
export const LOOK_EVERY_MS = 5_000
// Provider-limit warnings refresh less often; explicit refreshes still read them immediately.
export const LIMITS_LOOK_EVERY_MS = 30_000

/** A skipped scheduled limit read leaves the caller's last answer and read status untouched. */
export function limitsReadCadence(now: () => number = () => Date.now()) {
  let lastScheduledAt: number | null = null
  return async <Answer>(
    read: () => Promise<Answer>,
    scheduled = false,
  ): Promise<Answer | undefined> => {
    const at = now()
    if (
      scheduled &&
      lastScheduledAt !== null &&
      at >= lastScheduledAt &&
      at - lastScheduledAt < LIMITS_LOOK_EVERY_MS
    ) {
      return undefined
    }
    // The first look anchors the schedule; explicit refreshes do not postpone it.
    if (scheduled || lastScheduledAt === null) lastScheduledAt = at
    return read()
  }
}

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
export interface PersonsQueueHop {
  /** The conversation that is waiting, named the way a person reads it. */
  readonly name: string
  /** ⛔ **Whether the answer owed AT this hop is yours.** The last hop of a walk that ended. */
  readonly you: boolean
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
export interface PersonsQueueRow {
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
  /** The provider's own request id — what the card carries. */
  readonly requestId: string
  /**
   * ⛔ **The chain, asker first, ending at you** — rendered from the hops the host named, never
   * from a sentence taken apart again.
   */
  readonly chain: readonly PersonsQueueHop[]
  /**
   * ⛔ **The walk was stopped rather than ended**, so nothing above the last hop is known and no
   * hop says `you`. ⚠️ A cycle and {@link CHAIN_HOP_LIMIT} are both this, and the surface may not
   * tell them apart because the payload does not.
   */
  readonly unfollowable: boolean
  /** HO-007's own evidence line, as the host composed it from these same hops. */
  readonly sentence: string
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
   * How long it has been a person's, or null when the stamp did not cross.
   *
   * ⚠️ **Two different clocks under one field, and the row's own copy says which** (403). For an
   * `escalated` row it is `escalatedAt` — *the moment a person was told*. For `a-decision` there is
   * no such moment and never could be: it was a person's from the instant it was routed, so it is
   * the routing's own `at`. ⛔ Folding those into one WORD would say a person had been told about
   * something nothing ever told them about.
   */
  readonly since: string | null
  /**
   * 🔴 **The instant the ORDER is computed from, in epoch ms, or null because nothing recorded
   * one** (434, criterion 17).
   *
   * ⛔ **The number beside the words, and not a second derivation of them.** {@link since} is
   * `agoWords` of exactly this against exactly the same `now`, so a row cannot be drawn as
   * *"9 minutes ago"* and sorted as something else.
   *
   * ⚠️ **Null is ordered explicitly and never by a `?? 0`** — see {@link byBlockedSince}.
   */
  readonly blockedSince: number | null
  /**
   * 🔴 **WHICH instant {@link blockedSince} is** (434) — the field that lets one ordering run over
   * two clocks without claiming they are the same clock.
   *
   * ⛔ **`not-recorded` is a third value and not an absence**, for the reason
   * {@link PersonsQueueView.count} is never rounded: a surface that had only `blockedSince: null`
   * to go on would have to decide for itself whether that meant *old* or *new*, and two surfaces
   * would decide differently.
   */
  readonly blockedSinceIs: BlockedSinceIs
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
  /**
   * 🔴 **Which work this row is about, and why that is the answer** (474, from `463` F4) — the
   * vocabulary is `AboutWork` in `shared/questions.ts`, and its three arms are the whole of it.
   *
   * ⛔ **One field rather than a value beside a word**: the work this question names exists only on
   * the arm that names it.
   */
  readonly about: AboutWork
}

/**
 * ⛔ **Which of the two clocks {@link PersonsQueueRow.blockedSince} is, or that there was
 * none** (434).
 *
 * ⚠️ **`told` and `routed` are not the same event and the difference is criterion 17's.** A
 * question escalated after a wait was BLOCKED before it escalated — what `escalatedAt` stamps is
 * the moment a PERSON was told, which is the moment it became theirs. A permission was a person's
 * from the instant it was routed and nothing ever announced it. ⛔ Sorting one list by *arrival*
 * and calling it *blocked-since* would be a third meaning neither row carries.
 */
export type BlockedSinceIs =
  /** `escalatedAt` — the moment a person was told, on an `escalated` row. */
  | 'told'
  /** The routing's own `at` — the moment it became a person's, on `a-decision`. */
  | 'routed'
  /** ⛔ **No instant crossed the wire at all** — see {@link byBlockedSince} for where it sorts. */
  | 'not-recorded'

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
 * 🔴 **What one of the looks actually WALKED, as a surface reads it** (453) — see
 * `LedgerWalk`, which is where the store computes it.
 *
 * ⛔ **The sentence is rendered HERE, from the word the walk used** — *"the row carries the WORD,
 * the surface carries the sentence"* — and the reason `WALK_COVERS`
 * lives in `shared/` rather than on the wire: a sentence that crossed the IPC boundary would be a
 * second copy of a string this module can derive, free to go stale against the word beside it.
 */
export interface QueueCoverage {
  /** Which candidate set the look started from. */
  readonly walk: LedgerWalkKind
  /** ⛔ **How many ledgers it opened** — the QUERY's number, never `rows.length`. */
  readonly ledgers: number
  /** ⛔ **How many ledger rows it could not read** — the partial load, counted. */
  readonly rowsUnread: number
  /** ⚑ **D-017 · R8** — how many records it skipped whole, when any. */
  readonly ledgersSkipped?: number
  /** {@link WALK_COVERS} for {@link walk}, said once. */
  readonly says: string
}

/**
 * Everything both surfaces draw that MOVES with the state.
 *
 * ⚠️ **The FIXED copy is not on here and does not need to be** — this said *"every string"* and
 * five were not. ⛔ **Stated as a RULE rather than as a list, since `403` added three more to it**
 * (the review caught the list under-counting): every word that does not MOVE with the state is
 * written once — one derivation, wherever it lives. ⚑ That covers the unfollowable paragraph, the
 * two age phrasings (this object carries the age, not the phrase), the *also listed* clause, the
 * two group labels and the short-list disclosure. The destination's own group label is the SCREEN's
 * chrome and not this queue's.
 *
 * ⚑ {@link KIND_WORDS} and {@link sinceWords} are exported from this module, and the ones only
 * `PersonsQueue.vue` draws are its own.
 */
export interface PersonsQueueView {
  /**
   * ⛔ **Both populations, OLDEST-BLOCKED FIRST** (434, criterion 17; `403` had them concatenated)
   * — one list, because a person has one inbox and one order.
   *
   * ⚠️ Every row still carries {@link PersonsQueueRow.kind}, and a surface reads it **per row**
   * rather than grouping on it: a group is a second ordering, and two orderings on one list is the
   * thing criterion 17 forbids. See {@link byBlockedSince}.
   */
  readonly rows: readonly PersonsQueueRow[]
  /**
   * ⛔ **A fact, not a badge.** `rows.length`, never rounded, never capped, and never drawn at all
   * when it is zero — an app that says *"0"* where it means *"nothing"* has spent the reader's
   * attention to tell them there was nothing to spend it on.
   */
  readonly count: number
  /**
   * The strong line. ⚠️ **It names the populations rather than a total noun** (403): *"2 questions
   * and 1 decision are waiting on you"*, because how much of a summons somebody else might still
   * take is part of what it says.
   */
  readonly heading: string
  /**
   * ⛔ **The one sentence a screen reader is told, or the empty string** (401, from the v2.5.1
   * attention-policy correction).
   *
   * ⚑ **A question and a permission are the only things that may summon attention**, and since
   * `403` this channel carries both — not a completion, not an error, not a count of anything
   * else. `401` could spend only half of that licence, because the population that was missing is
   * the permission.
   *
   * 🔴 **And it now carries a THIRD kind of thing the grammar has no word for, which is a finding
   * rather than a licence quietly widened.** `403`'s reader admits every member of
   * `ChannelRefusal`, and that vocabulary's own docblock says *"four of these are criterion 10's
   * and the fifth is not — a secret is not authority, it is a credential"*. ⛔ **A conversation
   * frozen on a secret only a person can type is exactly as frozen as one frozen on an
   * approval**, so dropping it would be the surface refusing to show a person the thing that is
   * waiting on them; announcing it is the honest act and the grammar is what is short a member.
   * See `403`'s response §11.
   *
   * ⚠️ Empty when there is nothing, so the region says nothing rather than announcing an
   * all-clear nobody asked for.
   */
  readonly announcement: string
  /**
   * 🔴 **One of the two reads did not answer, so this list is short and says so** (403, from the
   * review).
   *
   * ⛔ **The first version coupled them and it re-created the defect `401` exists to prevent.** It
   * returned `null` for the whole view when EITHER read refused — so one persistent failure of the
   * verb `403` added deleted `401`'s escalated queue as well, and a summary counting a `null` view as
   * zero went back to *"Nothing needs you. The workspace is quiet."* over rows it had just read
   * successfully. ⚑ **A new read must not be able to take an old feature down.**
   *
   * ⚠️ **So `null` is now BOTH-refused, and one refusal draws what landed and discloses the
   * hole.** The count is then *what is known*, not *what there is* — which is a weaker claim than
   * the queue usually makes, and the only honest one available.
   */
  readonly partial: boolean
  /**
   * 🔴 **The most recent look did not answer, so what is drawn is the one before it** (434).
   *
   * ⛔ **This is the hole `403`'s `partial` could not see, and it is the one that is REACHABLE.**
   * The screen keeps each population's last good answer on a refusal — which is right, and is why
   * *"nothing is waiting on you"* cannot be drawn out of a dropped IPC call. ⚠️ But the value is
   * then non-null for ever, so `partial` is false for ever, and a read that has been failing since
   * the first minute of a session draws a list from that minute **with nothing saying so**.
   *
   * ⛔ **A queue that silently omits an item fails criterion 17 in the direction that costs most**,
   * and a stale list omits every item that arrived since it was taken. ⚑ So the two disclosures are
   * separate facts: {@link partial} is *a list has never been read*, this is *a list is not being
   * read any more*, and a surface may be in both at once.
   */
  readonly stale: boolean
  /**
   * 🔴 **What each look walked, or `null` because that look has never answered**
   * (453, HO-024 criterion 17's *everything*).
   *
   * ## ⛔ Why it is per POPULATION and not one number
   *
   * ⚠️ **The two walks read the SAME candidate set** — `questionsAPersonMustAnswer` and
   * `decisionsAwaitingAPerson` both start from `SELECT DISTINCT session_id … WHERE type =
   * 'request_routed'` — so a total across both double-counts every ledger and every unread row in
   * it. ⛔ A sum would be a number nobody could act on, which is the defect
   * {@link PersonsQueueView.count} refuses in the other direction.
   *
   * ⚑ **Exhaustive over {@link PersonsQueueKind}**, so a new population arrives here as a compile
   * error rather than as a silently missing coverage fact.
   */
  readonly covers: Readonly<Record<PersonsQueueKind, QueueCoverage | null>>
  /**
   * 🔴 **Not one of the looks that ANSWERED walked a ledger at all** (453).
   *
   * ⛔ **The false all-clear `403` and `434` each closed one door on, and this is the third.**
   * `partial` is *a list has never been read*; `stale` is *a list is not being read any more*; this
   * is **a list was read and there was no ledger behind it** — `NULL_SESSION_STORE` answers every
   * one of these readers with an empty list, and *"Nothing is waiting on you"* was drawn from it
   * with nothing anywhere able to tell it apart from a quiet workspace.
   */
  readonly noLedger: boolean
  /**
   * 🔴 **At least one look could not read a ledger ROW, so this list may be short** (453).
   *
   * ⛔ **`150`'s backlogged mark, come due on the one surface that cannot carry it.** An
   * unparseable ledger row has been skipped since `150` — *"a transcript with a hole is honest"* —
   * and that skip was invisible above the store. ⚠️ A digest may be scoped; a list of obligations
   * may not, so a row this app dropped is an obligation a person is not being told about.
   */
  readonly rowsDropped: boolean
  /**
   * 🔴 **ANY of the four holes — the one input `homeAttention.unread` takes** (453).
   *
   * ## ⛔ It exists because the two call sites had already diverged
   *
   * ⚠️ **`434` widened *what forbids quiet* from `partial` to `partial || stale` and widened it in
   * ONE of the two places.** One call site passed both; `RuntimeScreen.vue`'s `homeNeedsYou`
   * passed `partial` alone — so the rail's own summary could say *"Nothing needs you. The
   * workspace is quiet."* over a list that stopped answering an hour ago while the screen beside
   * it disclosed exactly that. ⛔ **`304`'s contradiction**, and the docblock over that call site
   * cites `304` by name.
   *
   * 🔴 **Two more holes would have been two more chances to diverge**, so the disjunction is
   * derived HERE and the call sites read one field — `taking-over.ts`'s ruling one surface over:
   * *two copies of one sentence is how the same press comes to be described two ways.*
   *
   * ⚑ **`quiet` is a CLAIM and every one of these says *not knowing*** — `086`'s rule, which is
   * the whole reason `unread` is an input at all.
   */
  readonly mayBeShort: boolean
}

/**
 * ⛔ **The noun each population is counted in, and the article it takes when there is one of it**
 * (446) — exhaustive over {@link PersonsQueueKind}, so a new population cannot reach a surface
 * without a word of its own.
 *
 * ⚠️ **`403` had two nouns in two functions and `434` read them in three places.** A third
 * population would have been a third function and a fourth branch in every sentence below; written
 * as data, the sentences fold over whatever is present and the compiler is what refuses a
 * population with nothing to call itself.
 */
const NOUN_OF_KIND: Readonly<Record<PersonsQueueKind, { one: string; many: string }>> = {
  'a-question': { one: 'question', many: 'questions' },
  'a-decision': { one: 'decision', many: 'decisions' },
}

/** "1 question" / "4 questions" — the plural said once, from the table above. */
function counted(kind: PersonsQueueKind, count: number): string {
  const noun = NOUN_OF_KIND[kind]
  return `${count} ${count === 1 ? noun.one : noun.many}`
}

/**
 * ⛔ **"a", "a and b", "a, b and c"** — the serial join, so a sentence that names N populations is
 * one derivation rather than one branch per combination (446).
 *
 * ⚠️ **`403` wrote the two-population sentence by hand**, and the asks joined it (D-017 · R19): a
 * sentence per state is `never-name-a-count-of-surfaces` written as prose.
 */
function andJoin(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * ⛔ **What is waiting, counted by population and never blended into one noun** (403).
 *
 * ⚑ **"2 questions and 1 decision"**, because the populations are different kinds of thing and a
 * person reading a summons is entitled to know how much of it somebody else might still take.
 * ⚠️ **A population with no rows is not named** — a
 * heading that named an empty one would be a count of nothing, which is what
 * {@link PersonsQueueView.count} refuses to draw for the whole.
 */
function waitingFor(present: readonly { kind: PersonsQueueKind; count: number }[]): string {
  return andJoin(present.map((one) => counted(one.kind, one.count)))
}

/**
 * ⛔ **The word for the one answerer in the chain who is not a conversation** (401).
 *
 * ⚑ **A constant, because it is the only place a name is not a name.** `ChainHop.on` is `null` for
 * this hop precisely so that an agent called `you` — or, where a conversation has none, its working
 * folder (`734`) — cannot be mistaken for the person: the discrimination is the null, and this is
 * only how the null prints.
 */
const YOU = 'you'

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
 * ⛔ **What each instant means, said rather than implied** (434; in this module for
 * {@link KIND_WORDS}'s reason) — see {@link PersonsQueueRow.blockedSinceIs}.
 *
 * ⚠️ *Yours since* is a claim that a person was TOLD at that moment, which is true of an escalation
 * and false of a routing nothing ever announced. 🔴 **And the third arm says where the row SORTS**,
 * because the list is ordered oldest-first and a row at the bottom with no words on it reads as the
 * newest thing in it — which is the one claim an unrecorded instant cannot make.
 */
export function sinceWords(row: PersonsQueueRow): string {
  if (row.blockedSinceIs === 'not-recorded') return 'no time recorded — listed last, not first'
  return SINCE_PHRASE[row.blockedSinceIs](row.since)
}

/**
 * ⛔ **One phrase per instant, exhaustively** (446) — `told` / `routed`, with `not-recorded`
 * answered above because it is the one arm that says nothing about a time.
 *
 * ⚠️ **`434` wrote this as a ternary on `told`, so every non-`told` instant fell through to one
 * phrase.** ⛔ That is the shape `a-loop-over-a-literal-variant-list-is-not-exhaustive` names: a new
 * word would silently borrow the routing's sentence.
 */
const SINCE_PHRASE: Readonly<
  Record<Exclude<BlockedSinceIs, 'not-recorded'>, (since: string | null) => string>
> = {
  told: (since) => `yours since ${since}`,
  routed: (since) => `waiting since ${since}`,
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

/**
 * ⛔ **What every participant after the first has been observed to do** — the claim NAMED at the
 * point it is made, so the expression below reads as *the person, or silence* rather than as a
 * null beside a bare string.
 *
 * ⚠️ **Not *ran out of answers*, *could not answer* or anything else in that direction**, however
 * the identifier is spelled: see {@link PersonsQueueDid}. ⚑ A constant is a name and a name is a
 * claim (`a-column-name-is-a-claim`), so this one says exactly what its value says.
 */
const HAS_NOT_ANSWERED: PersonsQueueDid = 'has-not-answered'

/**
 * 🔴 **What the FIRST participant did, by population** (613).
 *
 * ⚠️ **A permission DID ask**: it is a `RoutedRequest` like an escalated question, and what it was
 * refused is entry to the channel rather than the asking.
 *
 * ⚑ **Exhaustive over {@link PersonsQueueKind}** for {@link NOUN_OF_KIND}'s reason: a new
 * population cannot reach a surface without deciding what its asker did.
 */
const RAISED_IT: Readonly<Record<PersonsQueueKind, PersonsQueueDid>> = {
  'a-question': 'asked',
  'a-decision': 'asked',
}

/**
 * 🔴 **The hops turned into the thing a person looks at: A → B → you** (401).
 *
 * ⛔ **Derived, not a second walk.** Each hop is *X waiting on Y* and `hops[n].waiting` is
 * `hops[n-1].on` by construction, so the chain a surface draws is the first hop's asker followed by
 * every hop's answerer — one participant per hop end, in order, and none said twice in a row. ⚠️
 * Since `734` a participant is its AGENT's name, so two conversations of one identity next to each
 * other in a chain read the same word twice. ⚑ The wire row carries each conversation
 * (`PersonsQuestion.chain.links`); this row carries the asker's (`sessionId`) — `732` F-6. ⚑ And two
 * ROWS whose askers read one name are told apart beside the chain, never inside it
 * ({@link namesakesIn}, `737`).
 *
 * ⛔ **613 · and each of them carries what it DID** — see {@link PersonsQueueDid}. ⚑ Derived from
 * the same hop the name came from and never decided per surface, which is what stops two surfaces
 * saying two things about one walk.
 *
 * ⚠️ **An empty reading gives an empty chain, and never a bare `you`.** `escalationChain` cannot
 * produce one — it seeds a link before the loop — but the wire type permits it, and a surface that
 * printed a lone *"you"* for it would name a person as the answerer of a walk with no hops in it.
 */
function chainOf(hops: readonly ChainHop[], raised: PersonsQueueDid): PersonsQueueHop[] {
  const first = hops[0]
  if (first === undefined) return []
  return [
    { name: first.waiting, you: false, did: raised },
    // ⛔ **One condition, read twice** (613). ⚑ `hop.on === null` is the person, and both fields
    // are derived from it in one expression so a hop that says *you* and also claims an act is
    // unconstructable — which is what {@link PersonsQueueHop.did}'s *null iff you* rests on.
    ...hops.map((hop) => ({
      name: hop.on ?? YOU,
      you: hop.on === null,
      did: hop.on === null ? null : HAS_NOT_ANSWERED,
    })),
  ]
}

/** What a request asks, as its card discloses it — the fields of {@link AttentionRequest} that say so. */
export type DisclosedRequest = Pick<
  AttentionRequest,
  'asked' | 'scope' | 'underDisclosed' | 'detailOmitted' | 'agentSays' | 'actionLines'
>

function disclosedBy(card: AttentionRequest): DisclosedRequest {
  return {
    asked: card.asked,
    scope: card.scope,
    underDisclosed: card.underDisclosed,
    detailOmitted: card.detailOmitted,
    ...(card.agentSays === undefined ? {} : { agentSays: card.agentSays }),
    ...(card.actionLines === undefined ? {} : { actionLines: card.actionLines }),
  }
}

/**
 * The scope lines about this one action, which the closed card draws: the complete command or
 * file first. Every line, where the card does not say which are about a broader grant.
 */
export function actionLinesOf(disclosed: DisclosedRequest): readonly string[] {
  return disclosed.actionLines === undefined
    ? disclosed.scope
    : disclosed.scope.slice(0, disclosed.actionLines)
}

/** The scope lines about what a broader answer would install, drawn only under more options. */
export function broaderLinesOf(disclosed: DisclosedRequest): readonly string[] {
  return disclosed.actionLines === undefined ? [] : disclosed.scope.slice(disclosed.actionLines)
}

/**
 * Whether a permission answer settles this one request and nothing more. A standing grant, and a
 * Cancel that asks the whole turn to stop, are broader choices.
 */
const SETTLES_ONLY_THIS_REQUEST: Readonly<Record<PermissionDecision['outcome'], boolean>> = {
  allow: true,
  deny: true,
  allow_for_session: false,
  allow_all_for_session: false,
  allow_always: false,
  cancel: false,
}

/**
 * Whether an answer is one of the request's own primary answers, drawn side by side on the card.
 * An answer to a question settles only that question, so every one of them is.
 */
export function isAPrimaryAnswer(decision: AttentionDecision): boolean {
  return decision.kind !== 'permission' || SETTLES_ONLY_THIS_REQUEST[decision.decision.outcome]
}

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

/**
 * 🔴 **The one derivation of this queue's rows and its words** — pure, so both surfaces and a test
 * ask it the same question without a component around it.
 *
 * ⚠️ **`null` is *nobody has answered yet*, and it is not *nothing is waiting*.** `086`'s rule on
 * the one read where the wrong default is a false all-clear: a queue drawn empty before the first
 * look has landed claims a person is free, which is the claim this whole surface exists to stop
 * the app making by omission.
 *
 * ## ⛔ A CLOSED question cannot appear here, and the reason is upstream
 *
 * `SessionStore.questionsAPersonMustAnswer` filters `REQUEST_IS_OPEN[state]` (and, since `611`,
 * admits a row a deadline stamped OR one whose asker ADDRESSED it to a person, while excluding
 * {@link WhereARequestWent}'s refused arm by name — it was `escalatedAt !== null && because ===
 * null` until `HO-088` §2 gave a question a second way to become a person's), and
 * `RuntimeHost.questionsForAPerson` only maps — so `interrupted`, `stranded`, `abandoned`,
 * `answered`, `rejected`, `decided` and `withdrawn` are all absent by construction and this
 * surface never renders one. ⚠️ **What it must therefore not do is promise the converse.** A row
 * was open *when the look landed*; between that and a press the parent may answer it, somebody may
 * press Stop, or the app may go down. So the button takes a person to the CARD and the card
 * answers for itself, and nothing here says the question can still be answered.
 */
export function personsQueueView(
  questionsForAPerson: LedgerWalk<PersonsQuestion> | null,
  decisionsForAPerson: LedgerWalk<PersonsDecision> | null,
  world: PersonsQueueWorld,
): PersonsQueueView | null {
  // ⛔ **`null` only when NEITHER has landed** (403, corrected by the review). ⚠️ The first version
  // returned `null` when either did, which reads as the conservative choice and is the opposite:
  // `null` here means *nothing is drawn*, *Waiting on you* counts it as zero, and
  // one persistent failure of the new verb would therefore delete the escalated queue AND put the
  // screen back to *"the workspace is quiet"* over rows it had just read. ⛔ A read added today may
  // not take a feature that shipped yesterday down with it. ⚑ What one refusal costs instead is
  // disclosed — see {@link PersonsQueueView.partial}.
  if (questionsForAPerson === null && decisionsForAPerson === null) return null
  const asked = questionsForAPerson?.rows ?? []
  const settled = decisionsForAPerson?.rows ?? []
  // 🔴 **453 · what each look WALKED, kept beside what it found.** ⛔ `null` is *this look has
  // never answered* — the same absence {@link PersonsQueueView.partial} reads — and it is not
  // *"it walked nothing"*, which is `no-ledger` and a different sentence.
  const coverOf = <Row>(walked: LedgerWalk<Row> | null): QueueCoverage | null =>
    walked === null
      ? null
      : {
          walk: walked.walk,
          ledgers: walked.ledgers,
          rowsUnread: walked.rowsUnread,
          ...(walked.ledgersSkipped === undefined ? {} : { ledgersSkipped: walked.ledgersSkipped }),
          says: WALK_COVERS[walked.walk],
        }
  const covers = {
    'a-question': coverOf(questionsForAPerson),
    'a-decision': coverOf(decisionsForAPerson),
  } as const satisfies Readonly<Record<PersonsQueueKind, QueueCoverage | null>>
  const walked = Object.values(covers).filter((one) => one !== null)
  // ⛔ **EVERY look that answered, and never one of them.** A single look with no ledger behind it
  // while the others read the workspace is not a blind card — it is one read this app could not
  // serve, and drawing the strongest disclosure over it would say nothing was seen when most of it
  // was.
  //
  // ⚠️ **No `walked.length > 0` guard, and its absence is argued rather than forgotten.** `every`
  // over an empty list is vacuously TRUE, which would be the wrong answer — but the list cannot be
  // empty here: this function has already returned `null` when both readings are `null`, which
  // `persons-queue.test.ts` §2 pins. ⛔ A conjunct no mutation can make fail is not carrying a rule
  // (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`); the early return is.
  const noLedger = walked.every((one) => one.walk === 'no-ledger')
  // ⚠️ **ANY, not all.** One walk that dropped a row — or (D-017) skipped a whole record — makes
  // the whole merged list short.
  const rowsDropped = walked.some((one) => one.rowsUnread > 0 || (one.ledgersSkipped ?? 0) > 0)
  const place = (
    kind: PersonsQueueKind,
    request: { askedBy: string; requestId: string },
    hops: readonly ChainHop[],
    unfollowable: boolean,
    sentence: string,
    says: string | null,
    at: number | null,
    blockedSinceIs: BlockedSinceIs,
    work: readonly WorkInHand[],
    // ⛔ **474 · handed in from the population that knows** — see {@link PersonsQueueRow.about}.
    // ⚑ A permission passes {@link NOTHING_NAMED_THE_WORK}, which is that answer
    // DERIVED through the same fold rather than a word spelled twice.
    about: AboutWork,
    // 🔴 **UI-009 · a question THIS APP asked, with the host's offer on it — or `null`** — see
    // {@link PersonsQueueRow.question}. ⛔ Handed in per population for the reason `about` is: only
    // the question population can raise one, and a decision says `null` rather than being
    // defaulted into it.
    askedHere: { readonly offered: OfferedAnswer | null } | null,
    // 🔴 **D-046 · the question as it was asked**, off the person's list — `null` for a decision,
    // and where the host found no row.
    askedWords: QuestionWords | null,
  ): PersonsQueueRow => {
    const key = `${request.askedBy}:${request.requestId}`
    const held = world.held.has(request.askedBy)
    // ⛔ **The live row is the ONLY source of what may be sent** — see
    // {@link PersonsQueueRow.answers}. ⚠️ `held` and this are two different questions and the row
    // says both: a window can hold a conversation whose card is not in the page it holds.
    const onScreen = world.answerable.get(key)
    const live = withoutALinkItDoesNotShow(
      onScreen ?? (held ? undefined : world.nobodyHolds?.get(key)),
    )
    // 🔴 **UI-009 · a question this app asked is answered on its own card** — see
    // {@link PersonsQueueRow.question}. ⚑ Its words, off the person's list (D-046); and whether
    // this window already pressed, read before the card is drawn, so the five
    // seconds between a press and the next look say *answer sent* rather than offer it again
    // (`468`, `207` M2). ⚑ **D-017 · R6** — whether this window HOLDS the asker is not asked.
    const question: AppQuestion | null =
      askedHere === null
        ? null
        : {
            words: askedWords,
            offered: askedHere.offered,
            sent: world.answeredFromHere.has(key),
          }
    const settling =
      question !== null
        ? // ⚑ **The card answers it** — no decision from the live queue, and nothing to explain.
          { answers: [], limit: null, noAnswerHere: null }
        : live === undefined
          ? {
              answers: [],
              limit: null,
              // 🔴 **468 · THREE absences and not two** — see {@link NoAnswerHere}. ⚠️ The window's
              // own answer is read FIRST, because it is the one this row caused: a card settled by
              // the press a person just made here is not a card that was never in this page, and
              // *"open it to answer"* over one is a false instruction rather than a missing one.
              //
              // ⚑ **UI-009 · `602`'s fourth absence is gone** — a question this app raised has its
              // card above, so every row here has a card in its asker's transcript.
              //
              // ⚠️ **The ladder below is written with no comment in it on purpose**: mutation rows
              // across `434` and `602` anchor on this expression as literal text, and a sentence
              // inside it would darken every one of them the next time somebody edited a word
              // (`a-source-census-that-pins-a-line-kills-every-row-on-it`, one instrument over).
              noAnswerHere: world.answeredFromHere.has(key)
                ? 'no-longer-waiting'
                : held
                  ? 'not-in-this-window'
                  : 'not-yours-yet',
            }
          : live.sent
            ? // ⛔ **`sent` before the offer** (`207` M2): the buttons are gone the instant one is
              // pressed, and the reason is said where they were.
              { answers: [], limit: live.limit, noAnswerHere: 'answer-sent' }
            : live.decisions.length === 0
              ? { answers: [], limit: live.limit, noAnswerHere: 'nothing-on-offer' }
              : { answers: live.decisions, limit: live.limit, noAnswerHere: null }
    return {
      kind,
      key,
      sessionId: request.askedBy,
      requestId: request.requestId,
      chain: chainOf(hops, RAISED_IT[kind]),
      unfollowable,
      sentence,
      says,
      // ⚠️ **Null is rendered as "no time recorded", never as zero and never as "just now"** —
      // `attention.ts`'s rule, and the age is this surface's whole argument.
      since: at === null ? null : agoWords(at, world.now),
      // ⛔ **The same number the words were made from** — see {@link PersonsQueueRow.blockedSince}.
      blockedSince: at,
      // ⚠️ **`not-recorded` overrides the population's own clock when the stamp did not cross**,
      // because *which instant this is* and *there is no instant* are answers to the same question
      // and a row may not carry both.
      blockedSinceIs: at === null ? 'not-recorded' : blockedSinceIs,
      held,
      // ⚑ **487 · read off the LIVE row, and only where this row can still be answered here.**
      //
      // ⛔ **Both halves are load-bearing** (the second was found by this dispatch's own review).
      // A window that does not hold this card has no offer to read, and inventing the sentence
      // from a stale one is the shape `453` already paid for. ⚠️ **And every sentence this field
      // can carry ends with *refusing still works*** — which is false the instant there are no
      // buttons beside it. A row whose answers are gone for ANY of {@link NoAnswerHere}'s reasons
      // says that reason and nothing else: two sentences about one row, one of them describing
      // controls that are not there, is `468`'s false instruction with a new subject.
      noPositive: settling.answers.length === 0 ? null : (live?.noPositive ?? null),
      // ⚑ **701 · the same two halves, for the same reason** — see {@link PersonsQueueRow.marksSay}.
      marksSay: settling.answers.length === 0 ? [] : (live?.marksSay ?? []),
      refusesFirst: settling.answers.length > 0 && live?.refusesFirst === true,
      // ⚑ **D-017b · the one press's words** (`taking-over.ts`): the row's travel opens the
      // conversation in its full view, whatever it is doing, as every surface's press does.
      action: OPEN_THE_CONVERSATION,
      alsoOnScreen: onScreen !== undefined,
      answers: settling.answers,
      limit: settling.limit,
      // ⛔ **468 · off the LIVE row, which is the only thing that holds it** — a request with no
      // live projection has no bounced answer to report, because the thing that bounced took the
      // card out of the projection or left it in it. See {@link PersonsQueueRow.refused}.
      refused: live?.refused ?? null,
      noAnswerHere: settling.noAnswerHere as NoAnswerHere | null,
      question,
      // ⚑ A provider's question: its words, drawn beside the row's own answer path.
      words: question === null ? askedWords : null,
      disclosed:
        kind === 'a-decision' && settling.answers.length > 0 && live !== undefined
          ? disclosedBy(live)
          : null,
      work,
      about,
    }
  }
  const rows = [
    ...asked.map((one) =>
      place(
        'a-question',
        one.request,
        one.reading.hops,
        one.reading.unfollowable,
        one.sentence,
        // ⛔ **Null, and it is a fact rather than a gap.** `says` names what kept a request OUT of
        // the question channel; this one went through it. What happened to it is the chain.
        null,
        // 🔴 **611 · the moment it became a PERSON's, which is no longer always an escalation**
        // (HO-088 §2, HO-090 §4) — see {@link PersonsQuestion.aPersonsSince}. ⛔ It read
        // `one.request.escalatedAt`, which is null for a question its asker ADDRESSED to a person:
        // every such row would have drawn *"no time recorded"* and sorted as `not-recorded` in a
        // queue whose whole ordering is oldest-blocked first.
        one.aPersonsSince,
        // 🔴 **611 · WHICH event that number came off, which is now two events on one
        // population** (HO-088 §2). ⛔ This vocabulary's own job is to say which — *"`told` and
        // `routed` are not the same event"* — and a question an asker ADDRESSED to a person was
        // never told to anybody: it was a person's from the instant it was routed, which is
        // exactly what `routed` already means one population over.
        one.request.went.is === 'the-person-the-asker-named' ? 'routed' : 'told',
        one.work,
        // 🔴 **474 · the ONE population that can name its work** — `question_asked.piece` (`437`'s
        // edge, a piece since D-016), carried from the host's own fold. See {@link PersonsQueueRow.about}.
        one.about,
        // 🔴 **UI-009 · the ONE population this app can raise**, answered on its own card — the
        // offer is `whatTheAskerOffered`'s, run main-side beside the read that answered `raisedBy`.
        one.raisedBy === 'this-app' ? { offered: one.offered } : null,
        one.asked === null ? null : wordsAsked(one.asked),
      ),
    ),
    ...settled.map((one) =>
      place(
        'a-decision',
        one.request,
        one.reading.hops,
        one.reading.unfollowable,
        one.sentence,
        one.says,
        // ⛔ **The routing's own stamp, because there is no other moment** — see
        // {@link PersonsQueueRow.since}. It was a person's from the instant it was written.
        one.request.at,
        'routed',
        one.work,
        // ⛔ **A permission names no piece at all** — `PermissionRequestEvent` has no such field —
        // so the answer is not *unknown*, it is *nothing records it*.
        NOTHING_NAMED_THE_WORK,
        // ⛔ **A permission has a card in the asker's own transcript and the card is what answers
        // it** — the provider raised it there. ⚠️ Composing an offer here would be `214 §3`'s
        // defect, and `permissionOffer` already decides it, on the live row.
        null,
        null,
      ),
    ),
    // ⛔ **Sorted ONCE, over both, and this is criterion 17's first clause** (434) — see
    // {@link byBlockedSince}. ⚠️ `403` concatenated here and each reader sorted its own
    // population, so the list was ordered by which READER found a row.
  ].sort(byBlockedSince)
  const count = rows.length
  // ⛔ **What is actually here, by population, and never a list of every population** (446) — the
  // sentences below fold over THIS, so a population with no rows is named nowhere.
  const present = (
    [
      { kind: 'a-question', count: asked.length },
      { kind: 'a-decision', count: settled.length },
    ] as const satisfies readonly { kind: PersonsQueueKind; count: number }[]
  ).filter((one) => one.count > 0)
  const only = present.length === 1 ? present[0]!.kind : null
  // ⛔ **One of the two reads did not answer** — see {@link PersonsQueueView.partial}. Named here
  // because the heading has to know: a strong line claiming to know, over a small line saying it
  // does not, is one card saying two things.
  const partial = questionsForAPerson === null || decisionsForAPerson === null
  // ⛔ **A read that has STOPPED answering, which `partial` cannot see** — see
  // {@link PersonsQueueView.stale}. ⚠️ Named beside `partial` rather than folded into it: they are
  // different holes, a surface may be in both, and the sentence for each is different.
  const stale = !world.lastLookAnswered.questions || !world.lastLookAnswered.decisions
  return {
    rows,
    count,
    // ⛔ **A true sentence at zero, and the PHOTOGRAPH is what found the second arm.** With one
    // read refused and the other empty this card draws — that is the whole of `partial` — and it
    // was drawing the strong line *"Nothing is waiting on you"* directly above a small line
    // saying a list could not be read. ⚠️ Two sentences, one claiming to know and one saying it
    // does not. ⚑ Naming every population would have been worse still: *"0 decisions"*, a noun for
    // a population that is not there — which is why `present` is filtered.
    heading:
      count === 0
        ? // ⛔ **Two different holes and two different sentences** (434). A list that has never
          // been read and a list that has stopped being read are not the same claim, and neither
          // of them is *"nothing is waiting on you"* — which at zero-with-a-hole is the strongest
          // false thing this app can say about somebody's own workload.
          // 🔴 **453 · and a THIRD and FOURTH hole, in front of the other two.** ⛔ *"This app has
          // no ledger"* subsumes every other disclosure — nothing was read, so nothing can be
          // partial or stale about it — and *"some of it could not be read"* is the one hole that
          // is true of a list that DID answer. ⚠️ Ordered strongest-first for `434`'s reason: at
          // zero-with-a-hole, *"nothing is waiting on you"* is the strongest false thing this app
          // can say about somebody's own workload, and every arm above it is a true one.
          noLedger
          ? 'No list could be read at all'
          : partial
            ? 'One list could not be read'
            : stale
              ? 'One list has stopped answering'
              : rowsDropped
                ? 'Some of what is waiting could not be read'
                : 'Nothing is waiting on you'
        : // ⚑ **446 · the singular reads its noun out of the same table the plural does.** ⛔ `403`
          // wrote *"A question"* / *"A decision"* as a ternary on one population's count, which is
          // a branch per population: a third would have made the FALSE arm mean *"whichever of the
          // other two it was"*.
          count === 1 && only !== null
          ? `A ${NOUN_OF_KIND[only].one} is waiting on you`
          : `${waitingFor(present)} are waiting on you`,
    announcement: count === 0 ? '' : `${waitingFor(present)} waiting on you.`,
    partial,
    stale,
    covers,
    noLedger,
    rowsDropped,
    // ⛔ **Derived once, here** — see {@link PersonsQueueView.mayBeShort} for the divergence it
    // closes. ⚑ Written as an `||` over the four named facts rather than as a fifth computation,
    // so a fifth hole added above cannot reach a surface by being forgotten in one of two places.
    mayBeShort: partial || stale || noLedger || rowsDropped,
  }
}

/**
 * 🔴 **What the queue says about the providers — the band, and it is NOT a fourth row** (533 §2.1).
 *
 * ## ⛔ The shape decision, and the queue's own tables are the argument
 *
 * ⚠️ **The brief asks whether a limit is a fourth {@link PersonsQueueKind} or something the queue
 * carries differently.** ⛔ **It cannot be a fourth kind**, and the reason is not taste: several
 * tables in this module are exhaustive over that vocabulary, and three of them would have to be
 * given a sentence that is false of a wall. ⚑ **Three of them, not all of them** — `KIND_WORDS` and
 * `BLOCKED_ORDER_OF_KIND` could each have been given an honest entry, which is precisely why the
 * compiler alone would not have refused this.
 *
 * | table | what a fourth member would have to say | why it is false |
 * |---|---|---|
 * | {@link NOUN_OF_KIND} | *"A limit is waiting on you"* | nothing is waiting on him; he is waiting on a clock |
 * | `WHY_ITS_YOURS` (retired by UI-009) | a claim about who else might settle it | nobody settles it, including him |
 * | `WHERE_ITS_SETTLED` (retired by UI-009) | *"the card is where you …"* | there is no card and no gesture |
 *
 * 🔴 **And the queue's own completeness test would demand the first of those out loud**:
 * `everything-a-person-must-answer-is-in-the-queue.test.ts` walks every `PersonsQueueKind` and
 * asserts `heading` matches `/^A [a-z]+ is waiting on you$/`. ⛔ A fourth kind is a test that
 * requires the app to say the false sentence.
 *
 * ⚠️ **{@link PersonsQueueView.count} settles it a second time.** It is `rows.length` — *"a fact,
 * not a badge"* — and it is the number a person reads as *how much do I owe*. A wall is owed by
 * nobody, so folding it in would inflate the one number this queue promises never to round.
 *
 * ## ⚑ So what a wall DOES instead of an action (533 §2.2)
 *
 * ⛔ **It carries a TIME, and that is the whole of it.** A question and a decision each end when a
 * person acts; a wall ends when the provider says so — its clock, or its next answer
 * (`586`, `HO-080` §1). ⚠️ **There is no control
 * on this band and inventing one would be `106` from the other side** — a button that cannot act,
 * with a sentence explaining that it cannot.
 *
 * ## 🔴 It is still the QUEUE, which is what the PO ruled
 *
 * Limits publish in their own dated lane, beside the actionable queue. The same view feeds the
 * Waiting on you page, the rail and Providers; a slow limit read does not withhold ready questions
 * or approvals. Limits are warnings, so they do not enter the overlay's summons count.
 */
export interface ProviderLimitsView {
  readonly display?: LimitsDisplayState
  /**
   * ⛔ **ONE row per provider, strongest first** (586, `HO-080` §2) — every wall still standing is
   * folded by `foldProviderLimits` before it crosses the wire, so this window decides nothing about
   * what counts as one wall; what it does decide is that a provider gets ONE sentence, stated at
   * the confidence of its weakest record, with every record still drawn underneath it.
   */
  readonly walls: readonly ProviderCondition[]
  /**
   * 🔴 **The most recent look for walls did not answer, so this band may be short** (533).
   *
   * ⛔ **{@link PersonsQueueView.stale}'s fact for the fourth read, and it is kept OFF that field
   * deliberately.** That one is *a list of what you owe has stopped answering* and feeds
   * `mayBeShort`, which four surfaces spend on *"the workspace is quiet"*; this one is *whether a
   * provider has walled is not being read any more*. ⚠️ Folding them would make a dropped wall read
   * change the heading over a list of questions that answered perfectly.
   */
  readonly unread: boolean
}

/**
 * 🔴 **The band's one derivation** — pure, like {@link personsQueueView} and for its reason.
 *
 * ⛔ **`null` is *nobody has looked yet* and it is not *no provider has walled*.** `086`'s rule on
 * the read where the wrong default is a false all-clear, and here the all-clear is about the world:
 * an empty band says every provider is still taking work, which is the claim `533` §0 measured this
 * app making silently while both of them had walled.
 *
 * ⚠️ **A refused look is drawn rather than dropped.** When the read has stopped answering the band
 * exists with no walls on it and {@link ProviderLimitsView.unread} true, so the surface can say it
 * does not know — the alternative is a band that vanishes, which reads as an all-clear.
 */
export function providerLimitsView(
  limitsForAPerson: LedgerWalk<ProviderLimitSeen> | null,
  lastLookAnswered: boolean,
  now: number,
  display?: LimitsDisplayState,
): ProviderLimitsView | null {
  if (display !== undefined) {
    const reading = display.reading
    return {
      display,
      walls: reading === null ? [] : providerConditions(reading.walked.rows, reading.evaluatedAt),
      unread:
        display.status !== 'ready' ||
        reading === null ||
        reading.walked.walk === 'no-ledger' ||
        reading.walked.rowsUnread > 0 ||
        (reading.walked.ledgersSkipped ?? 0) > 0,
    }
  }
  if (limitsForAPerson === null) return lastLookAnswered ? null : { walls: [], unread: true }
  // ⛔ **ONE row per provider** (586, `HO-080` §2). ⚠️ The wire still carries every record — `585`
  // is right that collapsing them could hide a real second limit — and `providerConditions` groups
  // them for the one surface that draws a sentence, at the weakest record's confidence.
  return { walls: providerConditions(limitsForAPerson.rows, now), unread: !lastLookAnswered }
}

/**
 * 🔴 **One piece of work that has stopped with nobody left to tell, as the band draws it** (557).
 *
 * ⛔ **Every word on it MOVES with the state**, which is why it is on this object at all — the
 * fixed copy around it is the component's, exactly as for {@link ProviderCondition}.
 */
export interface StalledWorkRow {
  /** ⛔ **One piece of work** — `stalledWorkKey`, which is the piece's id and says why. */
  readonly key: string
  /**
   * ⛔ **The conversation HOLDING the work, which is where the button goes.**
   *
   * ⚠️ **Not the giver, and that is the one place this band's destination differs from what the
   * sentence is about.** The news is *the giver does not know* — it was told nothing; the thing a
   * person can look at, and message, is the work — and the work is in the holder's conversation.
   */
  readonly sessionId: string
  /** 🔴 **The consequence, first and alone** — {@link stalledWorkLead}. */
  readonly says: string
  /** ⛔ **What the engine observed, in the app's one set of words for it** — `stalledWorkSaid`. */
  readonly said: string
  /**
   * ⚑ **The assignment's own first line**, so a person can tell two stalled pieces of work apart
   * without opening either. ⛔ The whole text is on the row a conversation draws; this is the
   * shortening the band does, and it is the only one.
   */
  readonly what: string
  /**
   * 🔴 **How long ago the engine observed it, or null because nothing recorded the moment** (484
   * added the stamp after rows could already exist).
   *
   * ⛔ **Derived against the SAME `now` the queue's rows are**, so two lines on one card cannot
   * measure from two instants.
   */
  readonly since: string | null
  /**
   * ⛔ **Whether this window is already running the conversation the work is in** — {@link
   * PersonsQueueRow.held}'s fact, one population over, and it decides the same gesture: a
   * conversation this window holds is opened, one it does not is `336`'s door.
   */
  readonly held: boolean
  /** What the button says, given {@link held}. */
  readonly action: string
}

/**
 * 🔴 **What the queue says about work whose giver does not know — the second band, and it is NOT a
 * fourth row** (557, HO-018 §2.1 · criterion 4).
 *
 * ## ⛔ The shape decision, taken with `533`'s own test and NOT by analogy
 *
 * ⚠️ **The brief asked whether this is a fourth {@link PersonsQueueKind} and said to answer the
 * clearability question first.** ⛔ **It cannot be a fourth kind**, and the argument is the table
 * `533` wrote for a provider wall, re-run against this subject — **two of its three rows go false,
 * and they are not the same two.**
 *
 * | table | what a fourth member would have to say | verdict |
 * |---|---|---|
 * | {@link NOUN_OF_KIND} | *"A task is waiting on you"* | ⚠️ **ARGUABLE, and the count below settles which reading this table uses** |
 * | `WHY_ITS_YOURS` (retired by UI-009) | a claim about who else might settle it | ⚑ **TRUE** — *nobody has been told and no agent is going to be* is the admission predicate itself, and this is the row a wall's table answers differently |
 * | `WHERE_ITS_SETTLED` (retired by UI-009) | *"This takes you to the card; the card is where you …"* | ⛔ **FALSE** — there is no card, no request and no answer to send |
 * | `WHERE_THEYRE_SETTLED` (retired by UI-009) | *"the card is where each one is settled"* | ⛔ **FALSE the moment one of these sits beside a question** |
 *
 * ⚠️ **Row one is arguable rather than true, and saying so is the point.** The WORK waits on a
 * person — nobody else will move it — and nothing is FROZEN waiting for their answer, which is
 * what the populations mean by *waiting on you*. ⛔ Two readings of one sentence in a
 * table that has to be read one way.
 *
 * 🔴 **And {@link PersonsQueueRow} is card-shaped in fields that would all be vacuous**:
 * `requestId`, `alsoOnScreen`, `limit`, `noPositive`, `marksSay`, `refusesFirst` and `refused`. ⛔ Worse, that row promises
 * *exactly one of `answers` being non-empty and {@link NoAnswerHere} being non-null holds, always*
 * — so a stall would force a sixth member of a vocabulary whose every word is about a card in a
 * window.
 *
 * ⚠️ **{@link PersonsQueueView.count} settles it a third time.** It is `rows.length` — *"a fact,
 * not a badge"* — and it is the number a person reads as *how much do I owe an answer to*. ⛔ Every
 * row in it has something FROZEN behind it: a permission stops the composer, an escalated question
 * blocks the asker. ⚑ **A stalled piece freezes nothing**
 * — the conversation holding it is idle — so folding it in would change what the one number this
 * queue promises never to round is counting.
 *
 * ⚠️ **609 · that reason became a PROPERTY rather than an assumption, and it is worth saying which.**
 * ⛔ *"The conversation holding it is idle"* used to be true of a `stalled` row by observation — the
 * turn had ended — and it was silently FALSE whenever the holder was waiting on a person or on a
 * worker of its own. ⚑ Those rows no longer read `stalled` at all (`composeWhatEachPieceIsWaitingOn`),
 * so the sentence above is now enforced by the composition rather than hoped for. 🔴 **And the one
 * it was already wrong about is the one this queue DOES hold**: a permission is a row
 * here, which is why it was never the stalled piece's job to carry it.
 *
 * ## 🔴 What it does INSTEAD of an answer, and this is where the wall band ends and this one starts
 *
 * ⛔ **A wall has no control because there is nowhere to go and nothing to do** — *"a button that
 * cannot act is `106` from the other side"*. ⚑ **This band HAS one**, and the difference is real:
 * the work is in a conversation a person can open, read and message, which is HO-018 §2.1's
 * *"wait, interrupt, re-assign or end"* with a door in front of it.
 *
 * ## ⚠️ How a row CLEARS, which is the question the brief said to answer before adding anything
 *
 * ⛔ **No gesture here clears one, and no gesture anywhere does.** `RuntimeHost.takeBackPiece`
 * answers `not-a-piece-you-gave` to a person by design — *"no door lets a person take work back"*,
 * not even work taken on for them (D-016 · commit 6 · R5) — and closing a piece is its giver's act
 * too (`update_work`), so HO-018's fourth choice has no door for a person.
 *
 * 🔴 **What clears a row is a LEDGER FACT, and all four are reachable:**
 *
 *  1. ⚑ **The giver is opened** — it registers, `tellAboutWorkItGaveOut` pushes, the receipt lands
 *     and this read stops returning the row. **This is the person's own gesture and it is the one
 *     that repairs the defect**: the agent path carries the news again.
 *  2. ⚑ **The holder replies** — `work_replied` settles the piece `answered`.
 *  3. ⚑ **The giver takes the work back** — `work_taken_back`, through `withdraw_task`.
 *  4. ⚑ **The giver closes it** — `work_closed`, through `update_work`.
 *
 * ⛔ **So this band is a disclosure whose clearing gesture is *restore the agent path*, not a
 * second inbox a person empties.** ⚠️ **And the residual is stated rather than hidden**: work whose
 * giver can never come back has no clearing act, which is `514` F1's shape and is reported as a
 * finding rather than papered over with a dismissal — a dismissed-list in this module is the one
 * thing criterion 17 forbids by name.
 *
 * ## ⚑ It is still the QUEUE, which is what the PO ruled
 *
 * ⛔ **Same look, same cadence, same two surfaces, same module** — `533`'s sentence unchanged.
 * *"Not a toast, not a banner, not a second notification place"*, and `HO-025` §5: there is no
 * separate notification centre.
 */
export interface StalledWorkView {
  /**
   * ⛔ **Every piece of work whose giver does not know, oldest first** — already ordered main-side by
   * the moment the engine observed the stall, so this window decides nothing about the order.
   *
   * ⛔ **Never a piece a person gave** (D-016 · commit 6 · R3): the person is its giver, and nobody
   * is owed a word — the host's walk leaves it out (`aStallItsGiverCanBeToldOf`).
   */
  readonly rows: readonly StalledWorkRow[]
  /**
   * 🔴 **The most recent look for stalled work did not answer, so this band may be short** (557) —
   * {@link ProviderLimitsView.unread}'s fact for the fifth read, and kept OFF
   * {@link PersonsQueueView.stale} for its reason exactly.
   *
   * ⛔ **Folding them would make a dropped read here change the heading over a list of questions
   * that answered perfectly.**
   */
  readonly unread: boolean
  /**
   * 🔴 **678 · F-R18b — the walk answered, and could not read some of its rows** — `unreadSays`
   * over `LedgerWalk.rowsUnread` (and D-017's records skipped whole), the one sentence every
   * surface draws for that count; `null` when there is nothing to say.
   *
   * ⛔ **Not {@link unread}**, which is *the look did not answer at all*: this walk DID answer, and
   * `671` made it count a torn row instead of raising — the stall reads, the folds and the givers'
   * receipts alike. ⚠️ **Until `678` nothing drew it**, so a stall walk that dropped its only row
   * drew no band: the all-clear this band exists not to give. ⚑ Absent where nothing looked.
   */
  readonly short?: string | null
}

/**
 * 🔴 **672 · the stalled row's lead, in the card's spelling** — *W1.2 with Pam is not being worked
 * on, and Ada — which gave it out — has not been told.*
 *
 * ⛔ **It was `shared/stalled-work.ts`' `stalledWorkSays`** — *"Work #3 with Pam…"*: a third name for
 * one piece, on the same card whose question rows name it by its label. ⚑ The renderer was its one
 * product caller, so the sentence moved here, where it says the piece's label; the shared copy lost
 * its last caller and was deleted in `697` (`672` H2). The consequence-first shape is `533` §1.1's
 * and is unchanged.
 *
 * ⚑ **D-016c · one lead, true of every row.** A row is here only while its giver holds no standing
 * receipt for the piece (`SessionStore.workReportedTo`), and a giver is told about a piece once: a
 * stop and a start tell nobody anything (`05`), so there is no other telling for the lead to name.
 */
export function stalledWorkLead(work: StalledWork): string {
  return `${work.label} with ${work.ownerName} is not being worked on, and ${work.giverName} — which gave it out — has not been told.`
}

/**
 * 🔴 **The band's one derivation** — pure, like {@link providerLimitsView} and for its reason.
 *
 * ⛔ **`null` is *nobody has looked yet* and it is not *nothing has stopped*.** `086`'s rule on the
 * read where the wrong default is a false all-clear — and here the all-clear is the sharpest one
 * this app can make: *every piece of work that stopped has reached somebody*, which is precisely
 * the claim `555` §3.1 measured it making silently.
 *
 * ⚠️ **A refused look is drawn rather than dropped**, for the wall band's reason: a band that
 * vanishes reads as an all-clear.
 */
export function stalledWorkView(
  stalledWorkForAPerson: LedgerWalk<StalledWork> | null,
  lastLookAnswered: boolean,
  now: number,
  held: ReadonlySet<string>,
): StalledWorkView | null {
  if (stalledWorkForAPerson === null) return lastLookAnswered ? null : { rows: [], unread: true }
  return {
    rows: stalledWorkForAPerson.rows.map((work) => ({
      key: stalledWorkKey(work),
      sessionId: work.owner,
      says: stalledWorkLead(work),
      said: stalledWorkSaid(work),
      // ⛔ **The piece's title, whole** — the one line `undrivenWorkText` names it by in the
      // parent's notice, so a person and the agent beside them read one piece of work.
      what: work.title,
      // ⛔ **Null when nothing recorded the moment**, and the band says so rather than drawing a
      // blank — `sinceWords`' third arm, one population over.
      since: work.stalledAt === null ? null : agoWords(work.stalledAt, now),
      held: held.has(work.owner),
      // ⚑ **D-017b · the one press's words, and not a second vocabulary** — the conversation opens
      // in its full view, whatever it is doing.
      action: OPEN_THE_CONVERSATION,
    })),
    unread: !lastLookAnswered,
    short: unreadSays(stalledWorkForAPerson.rowsUnread, stalledWorkForAPerson.ledgersSkipped),
  }
}

/** The press that opens a stopped piece's holder; the one that takes it back is `TAKE_BACK`. */
export const LOOK = 'Look'

/**
 * A piece whose holder stopped with it open, its giver told, as *Waiting on you* draws it: beside
 * the stalled band and for its reason, since nothing is frozen behind it and it is not counted.
 * Unlike that band it can be cleared here: a person looks at the holder, or hands the piece back.
 */
export interface StoppedWorkRow {
  /** The piece's id. */
  readonly key: string
  /** The holder's conversation, where Look goes. */
  readonly sessionId: string
  /** The piece and its holder: `W6.4.1 with Quinn`. */
  readonly who: string
  /** The piece's label, which Take back names. */
  readonly label: string
  /** The piece's title, whole. */
  readonly what: string
  /** `stopped at 00:28. Look, or take it back for Ada to redo or give again.` */
  readonly says: string
  /** When it stopped, epoch ms: a later stop of the same piece is another row. */
  readonly at: number
}

/** The two work lists a take-back can be pressed on. */
export type WorkPart = 'incidents' | 'recoveries'

/** One work card: a listed entry, or one a take-back from this window still speaks for. */
export interface WorkCard {
  readonly entry: WorkEntry
  readonly listed: boolean
  readonly pending: boolean
  readonly said: string | null
}

/** One to-do card: listed, or answered here after the list stopped holding it. */
export interface TodoCard {
  readonly row: TodoRow
  /** The last look lists it, so it can still be answered. */
  readonly listed: boolean
  /** An answer from this window is on its way. */
  readonly pending: boolean
  /** What its last answer came to, or `null`. */
  readonly said: string | null
  /** The host took its answer: the presses go, and the card says so until dismissed. */
  readonly taken: boolean
}

/**
 * One card of the stopped band: a row the last look listed, or one a hand-back from this window
 * still speaks for after the look stopped listing it. A hand-back's answer is kept apart from the
 * list, so a refresh that drops the row does not take the answer with it.
 */
export interface StoppedWorkCard {
  readonly row: StoppedWorkRow
  /** The last look lists this stop, so it can be handed back. */
  readonly listed: boolean
  /** A hand-back of it is on its way. */
  readonly pending: boolean
  /** What its last hand-back answered, or `null`. */
  readonly said: string | null
}

/** The stopped pieces, with the stalled band's two holes. */
export interface StoppedWorkView {
  /** Every such piece, as the host read them. */
  readonly rows: readonly StoppedWorkRow[]
  /** The most recent look did not answer, so the list may be short. */
  readonly unread: boolean
  /** The look answered and could not read some rows; `null` when there is nothing to say. */
  readonly short?: string | null
}

/**
 * The untold and told reads are separate calls, so a giver told between them lists one stop in both.
 * Each piece is drawn once: the newer stop wins, and for the same stop the told one, since a giver
 * is told after its piece stalls.
 */
export function eachStopOnce(
  stalls: LedgerWalk<StalledWork> | null,
  stops: LedgerWalk<StoppedWorkForAPerson> | null,
): {
  readonly stalls: LedgerWalk<StalledWork> | null
  readonly stops: LedgerWalk<StoppedWorkForAPerson> | null
} {
  if (stalls === null || stops === null) return { stalls, stops }
  const stoppedAt = new Map(stops.rows.map((one) => [one.piece, one.at]))
  const stalledAt = new Map(stalls.rows.map((one) => [one.piece, one.stalledAt]))
  return {
    stalls: {
      ...stalls,
      rows: stalls.rows.filter((one) => {
        const told = stoppedAt.get(one.piece)
        return told === undefined || (one.stalledAt !== null && one.stalledAt > told)
      }),
    },
    stops: {
      ...stops,
      rows: stops.rows.filter((one) => {
        const untold = stalledAt.get(one.piece)
        return untold === undefined || untold === null || untold <= one.at
      }),
    },
  }
}

/** One stop of one piece: a hand-back speaks for the stop it was pressed on. */
function stopKey(row: StoppedWorkRow): string {
  return `${row.key}@${String(row.at)}`
}

/** Its one derivation: `null` is nobody has looked yet, not that nothing has stopped. */
export function stoppedWorkView(
  walked: LedgerWalk<StoppedWorkForAPerson> | null,
  lastLookAnswered: boolean,
): StoppedWorkView | null {
  if (walked === null) return lastLookAnswered ? null : { rows: [], unread: true }
  return {
    rows: walked.rows.map((one) => ({
      key: one.piece,
      sessionId: one.holder,
      who: `${one.label} with ${one.holderName}`,
      label: one.label,
      what: one.title,
      says: `stopped at ${clockTime(one.at)}. Look, or take it back for ${one.giverName || 'its giver'} to redo or give again.`,
      at: one.at,
    })),
    unread: !lastLookAnswered,
    short: unreadSays(walked.rowsUnread, walked.ledgersSkipped),
  }
}

/**
 * ⚑ **D-017 · R19 · one ask an agent made against an identity's rules, as a person reads it** — the
 * row *Waiting on you* and the overlay's corner both draw, from {@link instructionAsksView}.
 */
export interface InstructionAskRow {
  /** ⛔ The ask's own id — the list keys on it, and `decideInstruction` takes it. */
  readonly askId: string
  /** The agent that asked, NAMED over the roster. */
  readonly askedBy: string
  /** The identity whose rules it asked to set, NAMED over the roster. */
  readonly about: string
  /** ⚠️ **Its own reason — a CLAIM nothing in this app checked**, and drawn as one (`438`). */
  readonly why: string
  /** The rules it asked for, whole. */
  readonly text: string
}

/**
 * 🔴 **D-017 · R19 · the instruction asks — carried BESIDE the queue's rows, and not a
 * {@link PersonsQueueKind}.**
 *
 * ⛔ **Not a fourth kind, for {@link ProviderLimitsView}'s reason one population over**: the tables
 * exhaustive over that vocabulary say where a row's CARD is and who else might pick it up, and an
 * ask has no card and no conversation to open — it is decided on its row, through the door its
 * identity's own sheet presses (`decideInstruction`). ⚑ **But unlike a wall it IS owed by a
 * person** — nothing is written until a person approves it — so it is counted with the rows
 * wherever *what needs you* is counted: *Waiting on you*, the rail's badge, the workspace reading
 * (`WHAT_NEEDS_A_PERSON`), and the corner's head ({@link cornerHead}).
 *
 * ⚑ **One module, so the page and the corner cannot disagree** — `RuntimeScreen` supplies the look,
 * and both surfaces read this view.
 */
export interface InstructionAsksView {
  /** ⛔ Every ask nobody has answered, oldest first — as the host read them. */
  readonly rows: readonly InstructionAskRow[]
  /** ⛔ **No look for asks has answered yet** — {@link PersonsQueueView.partial}'s fact, for this list. */
  readonly partial: boolean
  /**
   * ⛔ **The most recent look for asks did not answer**, so what is drawn is the one before —
   * {@link PersonsQueueView.stale}'s fact, for this list.
   */
  readonly stale: boolean
}

/**
 * 🔴 **The asks' one derivation** — pure, like {@link stalledWorkView} and for its reason.
 *
 * ⛔ **`null` is *nobody has looked yet*, and it is not *no agent is asking*** — `086`'s rule. ⚠️ A
 * refused look is drawn rather than dropped: a list that vanishes reads as an all-clear.
 */
export function instructionAsksView(
  instructionAsksForAPerson: readonly InstructionAskWaiting[] | null,
  lastLookAnswered: boolean,
  nameOf: (slug: string) => string,
): InstructionAsksView | null {
  if (instructionAsksForAPerson === null && lastLookAnswered) return null
  return {
    rows: (instructionAsksForAPerson ?? []).map((one) => ({
      askId: one.asked.askId,
      askedBy: nameOf(one.asked.proposedBy),
      about: nameOf(one.asked.about),
      why: one.asked.why,
      text: one.asked.text,
    })),
    partial: instructionAsksForAPerson === null,
    stale: !lastLookAnswered,
  }
}

/** One agent's request to register an MCP server, as the person reads it on its card. */
export interface McpServerRequestRow {
  /** The request's own id: the list keys on it, and `decideMcpServerRequest` takes it. */
  readonly requestId: string
  /** The agent that asked, named over the roster. */
  readonly askedBy: string
  /** What the asking conversation is called. */
  readonly askerCalled: string
  /** The server's name, as it would be registered. */
  readonly name: string
  /** The address, whole: it is never shortened. */
  readonly url: string
  /** What the agent says the server can read and do: its claim, drawn as one. */
  readonly reaches: string
  /** `null` when every agent would get it; else the agents, named over the roster. */
  readonly only: readonly string[] | null
  /** Whether approving reopens the asking conversation: its own profile would get the server. */
  readonly reopensTheAsker: boolean
}

/**
 * The agents' requests to register an MCP server, carried beside the queue's rows like the
 * instruction asks and for their reason: a request has no card in a conversation, and it is decided
 * on its row. It is owed by a person, so it is counted wherever what needs you is counted.
 */
export interface McpServerRequestsView {
  /** Every request nobody has decided, oldest first, as the host read them. */
  readonly rows: readonly McpServerRequestRow[]
  /** No look for requests has answered yet. */
  readonly partial: boolean
  /** The most recent look for requests did not answer, so what is drawn is the one before. */
  readonly stale: boolean
}

/**
 * A request decided from this window, kept on its card with the host's own words for how it ended
 * — "Registered. It offers: …", "Refused. Nothing was registered.", or why it is over — until the
 * person dismisses it. Nothing needs them any more, so it counts nowhere.
 */
export interface McpServerRequestSettledHere {
  readonly row: McpServerRequestRow
  readonly said: string
}

/** How many settled cards a window keeps, newest first. */
const SETTLED_CARDS_KEPT = 10

/** The requests' one derivation. `null` is nobody has looked yet, not no agent is asking. */
export function mcpServerRequestsView(
  walked: readonly McpServerRequestForAPerson[] | null,
  lastLookAnswered: boolean,
  nameOf: (slug: string) => string,
): McpServerRequestsView | null {
  if (walked === null && lastLookAnswered) return null
  return {
    rows: (walked ?? []).map(({ requested, askerCalled }) => {
      const agents = requested.whoGetsIt === 'everyone' ? null : (requested.agents ?? [])
      return {
        requestId: requested.requestId,
        askedBy: nameOf(requested.requestedBy),
        askerCalled,
        name: requested.name,
        url: requested.url,
        reaches: requested.reaches,
        only: agents === null ? null : agents.map(nameOf),
        reopensTheAsker: agents === null || agents.includes(requested.requestedBy),
      }
    }),
    partial: walked === null,
    stale: !lastLookAnswered,
  }
}

/**
 * 🔴 **F097 · one piece of work whose agent answered a person, as that person reads it** — the row
 * *Waiting on you* and the overlay's corner both draw, from {@link waitingOnWhoWroteView}.
 *
 * ⛔ **Every word on it MOVES with the state**, {@link StalledWorkRow}'s reason: the fixed copy around
 * it is the component's.
 */
export interface WaitingOnWhoWroteRow {
  /** ⛔ **One piece of work** — `waitingOnWhoWroteKey`, the piece's id. */
  readonly key: string
  /**
   * ⛔ **The conversation HOLDING the work, which is where the button goes** — the one the person
   * wrote to, and the one their next words go to.
   */
  readonly sessionId: string
  /** What the agent holding it is called — named main-side (`WaitingOnWhoWrote.ownerName`). */
  readonly agent: string
  /** The piece's label, the one a person says out loud. */
  readonly label: string
  /** ⚑ **The piece's title, whole**, so a person can tell two rows apart without opening either. */
  readonly what: string
  /**
   * 🔴 **How long ago its turn answered the person** — derived against the SAME `now` the queue's
   * rows are, {@link StalledWorkRow.since}'s rule.
   */
  readonly since: string
  /**
   * ⛔ **Whether this window is already running the conversation the work is in** —
   * {@link StalledWorkRow.held}'s fact, one population over.
   */
  readonly held: boolean
  /** What the button says. */
  readonly action: string
}

/**
 * 🔴 **F097 · the work whose agent answered a person — carried BESIDE the queue's rows, and counted
 * with them.**
 *
 * ⛔ **Not a {@link PersonsQueueKind}**, for {@link InstructionAsksView}'s reason one population over:
 * the tables exhaustive over that vocabulary say where a row's CARD is, and this has none — nothing
 * is frozen behind it. ⚑ **Like the stalled band it has a door** — the work is in a conversation a
 * person can open and write to — and **like the asks it is owed by a person**: its agent answered
 * them, and the next move is their words. So it is counted wherever *what needs you* is counted:
 * *Waiting on you*, the rail's badge, the workspace reading (`WHAT_NEEDS_A_PERSON`'s `a-reply`) and
 * the corner's head ({@link cornerHead}).
 *
 * ⚠️ **How a row clears**: the person writes to that conversation, or the piece moves some other way
 * — its giver's follow-up, a take-back, a reply. ⛔ No gesture here clears one: the door only opens
 * the conversation.
 */
export interface WaitingOnWhoWroteView {
  /** ⛔ Every such piece, oldest first — as the host read them. */
  readonly rows: readonly WaitingOnWhoWroteRow[]
  /**
   * 🔴 **The most recent look for this work did not answer, so the list may be short** —
   * {@link StalledWorkView.unread}'s fact, for this list.
   */
  readonly unread: boolean
  /**
   * 🔴 **The walk answered, and could not read some of its rows** — {@link StalledWorkView.short}'s
   * sentence, for this list; `null` when there is nothing to say. ⚑ Absent where nothing looked.
   */
  readonly short?: string | null
}

/**
 * 🔴 **Its one derivation** — pure, like {@link stalledWorkView} and for its reason.
 *
 * ⛔ **`null` is *nobody has looked yet*, and it is not *nobody is waiting on your reply*** — `086`'s
 * rule. ⚠️ A refused look is drawn rather than dropped: a list that vanishes reads as an all-clear.
 */
export function waitingOnWhoWroteView(
  walked: LedgerWalk<WaitingOnWhoWrote> | null,
  lastLookAnswered: boolean,
  now: number,
  held: ReadonlySet<string>,
): WaitingOnWhoWroteView | null {
  if (walked === null) return lastLookAnswered ? null : { rows: [], unread: true }
  return {
    unread: !lastLookAnswered,
    short: unreadSays(walked.rowsUnread, walked.ledgersSkipped),
    rows: walked.rows.map((one) => ({
      key: waitingOnWhoWroteKey(one),
      sessionId: one.owner,
      agent: one.ownerName,
      label: one.label,
      what: one.title,
      since: agoWords(one.answeredAt, now),
      held: held.has(one.owner),
      // ⚑ **The stalled band's one press, and its words**: the conversation opens in its full view.
      action: OPEN_THE_CONVERSATION,
    })),
  }
}

/**
 * ⚑ **D-017 · R19 · what the overlay's corner copy says at its head** — see {@link cornerHead}.
 */
export interface CornerHead {
  readonly heading: string
  /**
   * ⛔ **Everything the corner lists: the queue's rows, the asks AND (F097) the work waiting on the
   * person's reply**, so the corner counts what *Waiting on you* draws. ⚠️ Never drawn at zero —
   * {@link PersonsQueueView.count}'s rule.
   */
  readonly count: number
}

/** "1 ask to set an agent's rules" / "3 asks to set agents' rules". */
function asksCounted(count: number): string {
  return count === 1 ? "1 ask to set an agent's rules" : `${count} asks to set agents' rules`
}

/** "1 thing an agent asked you to do" / "2 things agents asked you to do". */
function todosCounted(count: number): string {
  return count === 1 ? '1 thing an agent asked you to do' : `${count} things agents asked you to do`
}

/** "1 request to add an MCP server" / "2 requests to add MCP servers". */
function serverRequestsCounted(count: number): string {
  return count === 1 ? '1 request to add an MCP server' : `${count} requests to add MCP servers`
}

/** ⚑ **F097** — "1 piece of work that needs your reply" / "2 pieces of work that need your reply". */
function repliesCounted(count: number): string {
  return count === 1
    ? '1 piece of work that needs your reply'
    : `${count} pieces of work that need your reply`
}

/**
 * 🔴 **D-017 · R19 · the corner's head — the queue's heading, widened by what is drawn beside it**:
 * the asks, and (F097) the work waiting on the person's reply.
 *
 * ⛔ **Without either it is {@link PersonsQueueView.heading}, word for word** — with one exception,
 * and it is `434`'s rule: over nothing, the all-clear *"Nothing is waiting on you"* may not stand
 * while the look for either has not answered whole, so that list's own hole is said instead.
 *
 * ⚑ **With either, one noun per population, never blended** — {@link waitingFor}'s rule, the asks
 * and then the replies named last. ⚠️ `null` where there is nothing the head may say: no queue look
 * has landed and neither list has anything to add — a heading over lists nobody has read is the
 * false all-clear.
 */
export function cornerHead(
  view: PersonsQueueView | null,
  asks: InstructionAsksView | null,
  replies: WaitingOnWhoWroteView | null,
  servers: McpServerRequestsView | null = null,
  todos: ListRead<TodoRow> | null = null,
): CornerHead | null {
  const asked = asks?.rows.length ?? 0
  const owed = replies?.rows.length ?? 0
  const requested = servers?.rows.length ?? 0
  const todo = todos?.rows.length ?? 0
  const count = (view?.count ?? 0) + asked + owed + requested + todo
  const asksHole =
    asks === null
      ? null
      : asks.partial
        ? 'One list could not be read'
        : asks.stale
          ? 'One list has stopped answering'
          : null
  // ⚑ **F097 · the replies' two holes, in the queue heading's words for them** — `unread` is either
  // of the asks' two, so it says the one true of both.
  const repliesHole =
    replies === null
      ? null
      : replies.unread
        ? 'One list could not be read'
        : replies.short
          ? 'Some of what is waiting could not be read'
          : null
  // The requests' two holes, in the asks' words for them.
  const serversHole =
    servers === null
      ? null
      : servers.partial
        ? 'One list could not be read'
        : servers.stale
          ? 'One list has stopped answering'
          : null
  const todosHole = todos?.unread === true ? 'One list could not be read' : null
  const besideHole = asksHole ?? repliesHole ?? serversHole ?? todosHole
  if (asked + owed + requested + todo === 0) {
    if (view === null) return besideHole === null ? null : { heading: besideHole, count }
    const allClear = view.count === 0 && !view.mayBeShort
    return { heading: allClear && besideHole !== null ? besideHole : view.heading, count }
  }
  if (count === 1) {
    return {
      heading:
        asked === 1
          ? "An ask to set an agent's rules is waiting on you"
          : requested === 1
            ? 'A request to add an MCP server is waiting on you'
            : todo === 1
              ? 'An agent asked you to do something'
              : 'An agent is waiting on your reply',
      count,
    }
  }
  const rows = view?.rows ?? []
  const present = (['a-question', 'a-decision'] as const)
    .map((kind) => ({ kind, count: rows.filter((row) => row.kind === kind).length }))
    .filter((one) => one.count > 0)
  return {
    heading: `${andJoin([
      ...present.map((one) => counted(one.kind, one.count)),
      ...(asked > 0 ? [asksCounted(asked)] : []),
      ...(owed > 0 ? [repliesCounted(owed)] : []),
      ...(requested > 0 ? [serverRequestsCounted(requested)] : []),
      ...(todo > 0 ? [todosCounted(todo)] : []),
    ])} are waiting on you`,
    count,
  }
}

/**
 * ⛔ **What a person may do to a row, handed in rather than reached for** (434) — so this module
 * stays a fold with no store, no bridge and no host in it. ⚠️ Stated without a COUNT: `557` and
 * D-017 · R19 each added a door.
 */
export interface PersonsQueueDoors {
  /** Take a person to the card this row names. */
  travel(row: PersonsQueueRow): void
  /**
   * 🔴 **Settle the row where it is, through the door that already exists** (434, criterion 17's
   * second clause).
   *
   * ⛔ **`respondPermission` / `respondUserInput` and NOTHING ELSE.** The request fold closes the
   * row, every projection refolds, and this queue holds no idea of its own about what is closed —
   * see {@link PersonsQueueView.rows}. ⚠️ A second write path, or a dismissed-list in this module,
   * would be a copy that can disagree with the ledger, which is the whole of what *clearing it
   * there clears it everywhere* forbids.
   */
  settle(row: PersonsQueueRow, decision: AttentionDecision): void
  /**
   * 🔴 **UI-009 · answer a question this app asked, on its card** ({@link PersonsQueueRow.question})
   * — `respondUserInput` with the id this app minted, through the store. ⚑ It answers the host's
   * words when the answer did not land as sent, or `null`. ⚠️ **Optional**, as a caller that
   * supplies no such row has nothing to answer.
   */
  answer?(row: PersonsQueueRow, response: UserInputResponse): Promise<string | null>
  move?(row: PersonsQueueRow, decision: 'move' | 'here'): Promise<string | null>
  /**
   * 🔴 **Take the conversation over so the card can be answered HERE, without going to it** (434).
   *
   * ⛔ **`336`'s door, and not a new one.** {@link PersonsQueueDoors.travel} already claims on the
   * way past for exactly this population — an agent-spawned child is reserved under no owner — so
   * this is that claim with the navigation left off. ⚠️ **What the button discloses is the ACT**,
   * and `523` corrected this clause twice over: it said the cost was on the button, which it never
   * was — `TAKE_IT_OVER_TO_ANSWER_HERE` names the gesture and no cost — and it named the wrong cost.
   * ⚑ Taking a conversation over makes this window the one that may answer it; it does not make it
   * the window the conversation ends with. `closeSessionsForOwner` releases a claim on a session
   * born without a surface, so leaving hands it back, and ending it is a press of its own.
   */
  takeOver(row: PersonsQueueRow): void
  /**
   * 🔴 **Take a person to the conversation a stalled piece of work is IN** (557) — see
   * {@link StalledWorkView} for why this band has a door where the wall band deliberately has none.
   *
   * ⛔ **{@link PersonsQueueDoors.travel}'s act with no card to land on.** It claims on the way past
   * for the same reason — an agent-spawned child is reserved under no owner — and then shows the
   * conversation; there is no request id to focus, because a stall is not a request.
   *
   * ⚠️ **It settles nothing and it is not offered as settling anything.** No gesture in this app
   * closes a piece on a person's behalf, which this band's docblock states rather than works around.
   *
   * ⚑ **F097 · and the conversation holding work that waits on the person's reply** — the same act
   * to the same place: what the person owes there is their next words, which they write in it.
   */
  open(sessionId: string): void
  /**
   * Hand a stopped piece back to its giver (`takeBackWork`), by its label: the door's answer in
   * words. Optional: a caller that supplies no stopped work has none to hand back.
   */
  handBack?(label: string): Promise<string>
  closeWork?(piece: string): Promise<{ ok: boolean; said: string }>
  /**
   * Answer a to-do an agent asked of a person: done or not, with an optional note. `null` when the
   * host took it, else its words for why not. Optional: a caller that supplies no to-dos has none.
   */
  answerTodo?(
    sessionId: string,
    requestId: string,
    done: boolean,
    note: string,
  ): Promise<string | null>
  /** Open a file a to-do was handed with, by its resource id. */
  openFile?(resource: string): void
  /**
   * ⚑ **D-017 · R19 · approve or refuse one ask about an identity's rules, on its row** — the
   * `decideInstruction` that identity's own sheet presses. ⚠️ **Optional, as the asks' supply is**:
   * a caller that supplies no asks has none to decide.
   */
  decideInstruction?(askId: string, approve: boolean): void
  /** Approve or refuse one agent's request to register an MCP server, on its row. */
  decideMcpServerRequest?(requestId: string, approve: boolean): Promise<AnswerAck>
}

export interface PersonsQueue {
  /** What to draw, or `null` while nobody has answered. */
  readonly view: ComputedRef<PersonsQueueView | null>
  /**
   * 🔴 **What the queue says about the PROVIDERS, or `null` while nobody has looked** (533) — see
   * {@link ProviderLimitsView}, whose docblock is the whole argument for why this is a second
   * computed rather than a fourth population of {@link view}.
   */
  readonly limits: ComputedRef<ProviderLimitsView | null>
  /**
   * 🔴 **What the queue says about work that stopped with nobody left to tell, or `null` while
   * nobody has looked** (557) — see {@link StalledWorkView}, whose docblock is the whole argument
   * for why this is a third computed rather than a fourth population of {@link view}.
   */
  readonly stalled: ComputedRef<StalledWorkView | null>
  /** The pieces whose holder stopped with them, or `null` while nobody has looked. */
  readonly stopped: ComputedRef<StoppedWorkView | null>
  /**
   * 🔴 **678 · whether ANY list this queue reads may be short** — the one field both `homeAttention`
   * call sites pass as `unread`, so *"the workspace is quiet"* is forbidden by every hole the queue
   * knows of and the two sites cannot come apart (`453`'s rule).
   *
   * ⚑ **{@link PersonsQueueView.mayBeShort} for the request lists, OR the stalled band's two
   * holes**: a stall look that did not answer, and one that could not read some rows (`678`
   * F-R18b) — ⚑ **D-017 · R19 · OR a look for the asks that has not answered** ({@link asks}) —
   * ⚑ **F097 · OR the same two holes in the work waiting on the person's reply**
   * ({@link waitingOnWhoWrote}). ⛔ **Not folded into the view's field**, which the queue's
   * HEADING reads — `557` kept the stall band off that heading so a dropped stall read cannot
   * re-word a list of questions that answered. ⚠️ Found by `678`'s review: once the Waiting-on-you
   * page drew the stall band, an all-clear above it said the opposite of the line under it.
   */
  readonly mayBeShort: ComputedRef<boolean>
  /**
   * ⚑ **D-017 · R19 · the asks against an identity's rules, or `null` while nobody has looked** —
   * see {@link InstructionAsksView} for why they are beside {@link view} and not in it.
   */
  readonly asks: ComputedRef<InstructionAsksView | null>
  /**
   * ⚑ **F097 · the work whose agent answered a person, or `null` while nobody has looked** — see
   * {@link WaitingOnWhoWroteView} for why it is beside {@link view} and not in it.
   */
  readonly waitingOnWhoWrote: ComputedRef<WaitingOnWhoWroteView | null>
  /** The agents' requests to register an MCP server, or `null` while nobody has looked. */
  readonly serverRequests: ComputedRef<McpServerRequestsView | null>
  /**
   * ⚑ **D-017 · R19 · the corner copy's head** — {@link cornerHead} over {@link view}, {@link asks}
   * and (F097) {@link waitingOnWhoWrote}.
   */
  readonly corner: ComputedRef<CornerHead | null>
  /** Take a person to the card this row names. ⛔ It never answers; it only arrives. */
  take(row: PersonsQueueRow): void
  /** Settle the row here — {@link PersonsQueueDoors.settle}. */
  settle(row: PersonsQueueRow, decision: AttentionDecision): void
  /**
   * ⚑ **UI-009 · answer a question this app asked, on its card** — {@link PersonsQueueDoors.answer}.
   * ⚑ What it came to is {@link presses}' until the row leaves the list.
   */
  answer(row: PersonsQueueRow, response: UserInputResponse): Promise<void>
  move(row: PersonsQueueRow, decision: 'move' | 'here'): Promise<void>
  /**
   * ⚑ **UI-009 · the last press on each question card, by row key** — *answer sent* until the row
   * leaves, or the host's words for an answer it did not take. ⛔ One map for both copies, so the
   * corner and *Waiting on you* cannot say one press two ways.
   */
  readonly presses: ReadonlyMap<string, QueuePress>
  /** Take the conversation over without leaving — {@link PersonsQueueDoors.takeOver}. */
  takeOver(row: PersonsQueueRow): void
  /**
   * Go to the conversation a stalled piece of work is in — ⚑ or (F097) one waiting on the person's
   * reply — {@link PersonsQueueDoors.open}.
   */
  openWork(row: { readonly sessionId: string }): void
  /** Hand a stopped piece back — {@link PersonsQueueDoors.handBack}; its answer is on its card. */
  handBack(row: StoppedWorkRow): void
  closeWork(piece: string): void
  readonly closingWork: ReadonlySet<string>
  readonly closedWork: ReadonlyMap<string, { ok: boolean; said: string }>
  /** The stopped band's cards: each listed stop, then each one a hand-back still speaks for. */
  readonly stoppedCards: ComputedRef<readonly StoppedWorkCard[]>
  /** Take away a card the list no longer holds, once its hand-back has answered. */
  dismissHandBack(row: StoppedWorkRow): void
  /** To-dos, pieces that need a look, and recoveries: each piece drawn once. */
  readonly workWaits: ComputedRef<WorkWaitsView>
  /** Read-presence facts, separate from whether the most recent look failed. */
  readonly attentionReady: ComputedRef<{ readonly todos: boolean; readonly incidents: boolean }>
  /** The to-do cards: each listed to-do, then each answered here the list no longer holds. */
  readonly todoCards: ComputedRef<readonly TodoCard[]>
  /** Answer a to-do on its card — {@link PersonsQueueDoors.answerTodo}. */
  answerTodo(row: TodoRow, done: boolean, note: string): void
  /** Take away a to-do card the list no longer holds, once its answer is in. */
  dismissTodo(row: TodoRow): void
  /** Open a to-do's file — {@link PersonsQueueDoors.openFile}. */
  openFile(resource: string): void
  /** The cards of the two work lists: each listed entry, then each a take-back still speaks for. */
  readonly workCards: ComputedRef<{
    readonly incidents: readonly WorkCard[]
    readonly recoveries: readonly WorkCard[]
  }>
  /** Take back the piece a work entry names — the hand-back door, fenced per press. */
  takeBackEntry(part: WorkPart, entry: WorkEntry): void
  /** Take away a work card the list no longer holds, once its take-back has answered. */
  dismissEntry(part: WorkPart, entry: WorkEntry): void
  /** Approve or refuse one ask — {@link PersonsQueueDoors.decideInstruction}. */
  decideInstruction(askId: string, approve: boolean): void
  /** Approve or refuse one request — {@link PersonsQueueDoors.decideMcpServerRequest}. */
  decideMcpServerRequest(requestId: string, approve: boolean): void
  /** The requests a press is being decided for, whose buttons wait for its answer. */
  readonly deciding: ReadonlySet<string>
  /** The host's words for the last press on a request that is still waiting, by request id. */
  readonly serverRequestPressed: ReadonlyMap<string, string>
  /** The requests decided from this window, newest first, until the person dismisses them. */
  readonly serverRequestsSettled: ComputedRef<readonly McpServerRequestSettledHere[]>
  /** Take one settled request's card away. */
  dismissServerRequest(requestId: string): void
  /**
   * Hand over what the last look said, what this window holds, and the doors.
   *
   * ⛔ **Every population in one call** (403, widened by 533 to the walls that are not a
   * population), and that is the shape rather than an economy: a supply that took one of them
   * would let the module hold a view assembled from looks taken at different moments, and the count
   * it draws is one number over all of them.
   *
   * ⚑ **533 · it said *All THREE* and the next read made the count false** — standing rule 19, a
   * repair correcting the prose it makes stale in the same commit; the reads are not counted here
   * since.
   */
  supply(
    questionsForAPerson: LedgerWalk<PersonsQuestion> | null,
    decisionsForAPerson: LedgerWalk<PersonsDecision> | null,
    world: PersonsQueueWorld,
    doors: PersonsQueueDoors,
    /**
     * The separately dated limits reading shares the view, without sharing the actionable lane's
     * completion time. Its display metadata qualifies retained evidence.
     *
     * ⛔ **Optional, and the default is *nobody has looked for a wall*** — `null` with
     * `lastLookAnswered` true, which draws nothing. ⚠️ That is what every caller that predates this
     * dispatch means, and it is the only value for which {@link providerLimitsView} claims nothing.
     */
    limits?: {
      readonly walked: LedgerWalk<ProviderLimitSeen> | null
      readonly lastLookAnswered: boolean
      readonly display?: LimitsDisplayState
    },
    /**
     * ⚑ **557 · the stall read, in the SAME call as the others** — this method's own rule, for
     * its stated reason: one supply, one moment.
     *
     * ⛔ **Optional, and the default is *nobody has looked for a stall*** — `null` with
     * `lastLookAnswered` true, which draws nothing, and is what every caller that predates this
     * dispatch means.
     */
    stalled?: {
      readonly walked: LedgerWalk<StalledWork> | null
      readonly lastLookAnswered: boolean
    },
    /**
     * ⚑ **D-017 · R19 · the ask read, in the SAME call as the others** — this method's own
     * rule, for its stated reason: one supply, one moment. `nameOf` names a slug over the roster.
     *
     * ⛔ **Optional, and the default is *nobody has looked for an ask*** — `null` with
     * `lastLookAnswered` true, which draws nothing, and is what every caller that predates it means.
     */
    asks?: {
      readonly walked: readonly InstructionAskWaiting[] | null
      readonly lastLookAnswered: boolean
      readonly nameOf: (slug: string) => string
    },
    /**
     * ⚑ **F097 · the read of the work waiting on the person's reply, in the SAME call as the
     * others** — this method's own rule, for its stated reason: one supply, one moment.
     *
     * ⛔ **Optional, and the default is *nobody has looked for it*** — `null` with
     * `lastLookAnswered` true, which draws nothing, and is what every caller that predates it means.
     */
    waitingOnWhoWrote?: {
      readonly walked: LedgerWalk<WaitingOnWhoWrote> | null
      readonly lastLookAnswered: boolean
    },
    /** The agents' requests to register an MCP server, in the same call; absent is nobody has looked. */
    serverRequests?: {
      readonly walked: readonly McpServerRequestForAPerson[] | null
      readonly lastLookAnswered: boolean
      readonly nameOf: (slug: string) => string
    },
    /** The stopped work, in the same call; absent is nobody has looked. */
    stopped?: {
      readonly walked: LedgerWalk<StoppedWorkForAPerson> | null
      readonly lastLookAnswered: boolean
    },
    /**
     * Open work no other list shows (incidents and recovery), in the same call; absent is nobody
     * looked. ⚑ The to-dos are the question rows the host marked as actions.
     */
    incidents?: IncidentsRead,
  ): void
  /** Put it back to *nobody has answered* — the screen's unmount, and a test's `afterEach`. */
  forget(): void
}

/**
 * ⛔ **The world before any look has landed** — and `lastLookAnswered` is TRUE in it, which is the
 * one value that reads backwards and is right.
 *
 * ⚠️ **`stale` is *a read that used to answer has stopped*, so before the first look there is
 * nothing to have stopped.** ⛔ Seeding it false would draw *"one list has stopped answering"* on
 * a window that has been open for four milliseconds, which is `086` with the sign flipped: a
 * disclosure nobody can act on, every launch, until it is ignored.
 */
/**
 * ⛔ **Before any look for a wall** (533) — and `lastLookAnswered` is TRUE in it, which is
 * {@link NOTHING_LOOKED_AT_YET}'s own reason: *stale* is a read that used to answer and has
 * stopped, and before the first look nothing has stopped.
 */
const NOBODY_HAS_LOOKED_FOR_A_WALL = {
  walked: null,
  lastLookAnswered: true,
} as const satisfies { walked: LedgerWalk<ProviderLimitSeen> | null; lastLookAnswered: boolean }

/**
 * ⛔ **Before any look for stalled work** (557) — {@link NOBODY_HAS_LOOKED_FOR_A_WALL}'s reason
 * exactly: *stale* is a read that used to answer and has stopped, and before the first look nothing
 * has stopped.
 */
const NOBODY_HAS_LOOKED_FOR_A_STALL = {
  walked: null,
  lastLookAnswered: true,
} as const satisfies { walked: LedgerWalk<StalledWork> | null; lastLookAnswered: boolean }

/**
 * ⛔ **Before any look for an ask** (D-017 · R19) — {@link NOBODY_HAS_LOOKED_FOR_A_STALL}'s reason
 * exactly: *stale* is a read that used to answer and has stopped, and before the first look nothing
 * has stopped.
 */
const NOBODY_HAS_LOOKED_FOR_AN_ASK = {
  walked: null,
  lastLookAnswered: true,
  nameOf: (slug: string) => slug,
} as const satisfies {
  walked: readonly InstructionAskWaiting[] | null
  lastLookAnswered: boolean
  nameOf: (slug: string) => string
}

/**
 * ⛔ **Before any look for the work waiting on a person's reply** (F097) —
 * {@link NOBODY_HAS_LOOKED_FOR_A_STALL}'s reason exactly.
 */
const NOBODY_HAS_LOOKED_FOR_A_REPLY = {
  walked: null,
  lastLookAnswered: true,
} as const satisfies { walked: LedgerWalk<WaitingOnWhoWrote> | null; lastLookAnswered: boolean }

/** Before any look for open work no other list shows, for the stalls' reason. */
const NOBODY_HAS_LOOKED_FOR_AN_INCIDENT: IncidentsRead = { incidents: null, lastLookAnswered: true }

/** Before any look for stopped work, for the stalls' reason. */
const NOBODY_HAS_LOOKED_FOR_A_STOP = {
  walked: null,
  lastLookAnswered: true,
} as const satisfies { walked: LedgerWalk<StoppedWorkForAPerson> | null; lastLookAnswered: boolean }

/** Before any look for a request to register an MCP server, for the asks' reason. */
const NOBODY_HAS_LOOKED_FOR_A_SERVER_REQUEST = {
  walked: null,
  lastLookAnswered: true,
  nameOf: (slug: string) => slug,
} as const satisfies {
  walked: readonly McpServerRequestForAPerson[] | null
  lastLookAnswered: boolean
  nameOf: (slug: string) => string
}

const NOTHING_LOOKED_AT_YET: PersonsQueueWorld = {
  held: new Set<string>(),
  answerable: new Map<string, AttentionRequest>(),
  // ⚑ **468 · empty, and unlike `lastLookAnswered` there is nothing backwards about it**: this
  // window has answered nothing before it has drawn anything.
  answeredFromHere: new Set<string>(),
  now: 0,
  lastLookAnswered: { questions: true, decisions: true },
}

export function createPersonsQueue(): PersonsQueue {
  const answered: Ref<LedgerWalk<PersonsQuestion> | null> = ref(null)
  const decided: Ref<LedgerWalk<PersonsDecision> | null> = ref(null)
  // ⚑ **533 · the walls, and whether the last look for them answered.** ⛔ Held as ONE ref rather
  // than two, because {@link providerLimitsView} reads them together and a band that had the walls
  // of one look beside the answered-ness of another would disclose the wrong hole.
  const walls = ref<{
    walked: LedgerWalk<ProviderLimitSeen> | null
    lastLookAnswered: boolean
    display?: LimitsDisplayState
  }>(NOBODY_HAS_LOOKED_FOR_A_WALL)
  // ⚑ **557 · held as ONE ref for the walls' reason**, so a band drawn from one look's rows and
  // another look's answered-ness cannot disclose the wrong hole.
  const stalledWork = ref<{
    walked: LedgerWalk<StalledWork> | null
    lastLookAnswered: boolean
  }>(NOBODY_HAS_LOOKED_FOR_A_STALL)
  // ⚑ **D-017 · R19 · held as ONE ref for the walls' reason**, so a list drawn from one look's rows
  // and another look's answered-ness cannot disclose the wrong hole.
  const asked = ref<{
    walked: readonly InstructionAskWaiting[] | null
    lastLookAnswered: boolean
    nameOf: (slug: string) => string
  }>(NOBODY_HAS_LOOKED_FOR_AN_ASK)
  // ⚑ **F097 · held as ONE ref for the walls' reason**, so a list drawn from one look's rows and
  // another look's answered-ness cannot disclose the wrong hole.
  const replyOwed = ref<{
    walked: LedgerWalk<WaitingOnWhoWrote> | null
    lastLookAnswered: boolean
  }>(NOBODY_HAS_LOOKED_FOR_A_REPLY)
  // Held as one ref for the walls' reason.
  const serverAsked = ref<{
    walked: readonly McpServerRequestForAPerson[] | null
    lastLookAnswered: boolean
    nameOf: (slug: string) => string
  }>(NOBODY_HAS_LOOKED_FOR_A_SERVER_REQUEST)
  const stoppedWork = ref<{
    walked: LedgerWalk<StoppedWorkForAPerson> | null
    lastLookAnswered: boolean
  }>(NOBODY_HAS_LOOKED_FOR_A_STOP)
  const world = ref<PersonsQueueWorld>(NOTHING_LOOKED_AT_YET)
  let doors: PersonsQueueDoors | null = null
  // ⚑ **UI-009 · what each question card's last press came to** — see {@link PersonsQueue.presses}.
  const presses = reactive(new Map<string, QueuePress>())
  // The requests to register an MCP server whose press has not been answered yet, the words for a
  // press that left one waiting, and the ones decided here.
  const deciding = reactive(new Set<string>())
  const pressed = reactive(new Map<string, string>())
  const settledHere = reactive(new Map<string, McpServerRequestSettledHere>())
  // Hand-backs from this window, by stop (`stopKey`), kept apart from what the looks list. Each
  // press has its own number, so an answer only lands while its own press is the one on its way.
  const handingBack = reactive(new Map<string, { row: StoppedWorkRow; press: number }>())
  const incidentsRead = ref<IncidentsRead>(NOBODY_HAS_LOOKED_FOR_AN_INCIDENT)
  // To-do answers from this window, by request id, fenced per press like a hand-back.
  const answeringTodo = reactive(new Map<string, { row: TodoRow; press: number }>())
  const todoSaid = reactive(new Map<string, { row: TodoRow; said: string; taken: boolean }>())
  let todoPresses = 0
  const closingWork = reactive(new Set<string>())
  const closedWork = reactive(new Map<string, { ok: boolean; said: string }>())
  let closeGeneration = 0
  // Take-backs pressed on a work entry, by list and piece, fenced per press.
  const takingEntry = reactive(new Map<string, { entry: WorkEntry; press: number }>())
  const entrySaid = reactive(new Map<string, { entry: WorkEntry; said: string }>())
  let entryPresses = 0
  const entryKey = (part: WorkPart, entry: WorkEntry): string => `${part}:${entry.key}`
  let handBackPresses = 0
  const handedBack = reactive(new Map<string, { row: StoppedWorkRow; said: string }>())

  // A question the host marked as an action is a to-do, drawn on its own card and not as a question.
  const view = computed(() =>
    personsQueueView(questionsOnly(answered.value), decided.value, world.value),
  )
  // ⛔ **The SAME `now` the rows' ages are drawn against** — see {@link ProviderCondition.says}.
  const limits = computed(() =>
    providerLimitsView(
      walls.value.walked,
      walls.value.lastLookAnswered,
      world.value.now,
      walls.value.display,
    ),
  )
  // ⛔ **The SAME `now` and the SAME `held` set the rows above are drawn against** — two lines on
  // one card may not measure from two instants, and a button may not say *Open* on one row and
  // *Take it over* on another for the same conversation.
  // One stop drawn once across the untold and told reads.
  const attentionReady = computed(() => ({
    todos: answered.value !== null,
    incidents: incidentsRead.value.incidents !== null,
  }))
  const workWaits = computed(() =>
    workWaitsView(
      {
        todos: answered.value === null ? null : todosOf(answered.value),
        incidents: incidentsRead.value.incidents,
        lastLookAnswered: {
          todos: world.value.lastLookAnswered.questions,
          incidents: incidentsRead.value.lastLookAnswered,
        },
        incidentsShort: {
          rowsUnread: incidentsRead.value.rowsUnread ?? 0,
          ...(incidentsRead.value.ledgersSkipped === undefined
            ? {}
            : { ledgersSkipped: incidentsRead.value.ledgersSkipped }),
        },
      },
      world.value.now,
    ),
  )
  // A piece drawn as needing a look or being picked back up is not drawn again as stalled or stopped.
  const outsideWorkWaits = <Row extends { readonly piece: string }>(
    walk: LedgerWalk<Row> | null,
  ): LedgerWalk<Row> | null =>
    walk === null
      ? null
      : { ...walk, rows: walk.rows.filter((one) => !workWaits.value.shown.has(one.piece)) }
  const eachOnce = computed(() =>
    eachStopOnce(
      outsideWorkWaits(stalledWork.value.walked),
      outsideWorkWaits(stoppedWork.value.walked),
    ),
  )
  const workCards = computed(() => {
    const cardsOf = (part: WorkPart): WorkCard[] => {
      const listed = workWaits.value[part].rows.map((entry) => ({
        entry,
        listed: true,
        pending: takingEntry.has(entryKey(part, entry)),
        said: entrySaid.get(entryKey(part, entry))?.said ?? null,
      }))
      const shown = new Set(listed.map((card) => entryKey(part, card.entry)))
      const kept: WorkCard[] = []
      for (const [key, { entry, said }] of entrySaid) {
        if (key.startsWith(`${part}:`) && !shown.has(key))
          kept.push({ entry, listed: false, pending: takingEntry.has(key), said })
      }
      for (const [key, { entry }] of takingEntry) {
        if (key.startsWith(`${part}:`) && !shown.has(key) && !entrySaid.has(key))
          kept.push({ entry, listed: false, pending: true, said: null })
      }
      return [...listed, ...kept]
    }
    return { incidents: cardsOf('incidents'), recoveries: cardsOf('recoveries') }
  })
  const todoCards = computed((): readonly TodoCard[] => {
    const listed = workWaits.value.todos.rows.map((row) => {
      const said = todoSaid.get(row.key)
      return {
        row,
        listed: true,
        pending: answeringTodo.has(row.key),
        said: said?.said ?? null,
        taken: said?.taken === true,
      }
    })
    const shown = new Set(listed.map((card) => card.row.key))
    const kept: TodoCard[] = []
    for (const [key, { row, said, taken }] of todoSaid) {
      if (!shown.has(key)) kept.push({ row, listed: false, pending: false, said, taken })
    }
    for (const [key, { row }] of answeringTodo) {
      if (!shown.has(key) && !todoSaid.has(key))
        kept.push({ row, listed: false, pending: true, said: null, taken: false })
    }
    return [...listed, ...kept]
  })
  const stalled = computed(() =>
    stalledWorkView(
      eachOnce.value.stalls,
      stalledWork.value.lastLookAnswered,
      world.value.now,
      world.value.held,
    ),
  )

  const stopped = computed(() =>
    stoppedWorkView(eachOnce.value.stops, stoppedWork.value.lastLookAnswered),
  )
  const stoppedCards = computed((): readonly StoppedWorkCard[] => {
    const listed = (stopped.value?.rows ?? []).map((row) => ({
      row,
      listed: true,
      pending: handingBack.has(stopKey(row)),
      said: handedBack.get(stopKey(row))?.said ?? null,
    }))
    const shown = new Set(listed.map((card) => stopKey(card.row)))
    const kept = new Map<string, StoppedWorkCard>()
    for (const [key, { row, said }] of handedBack) {
      if (!shown.has(key)) kept.set(key, { row, listed: false, pending: false, said })
    }
    for (const [key, { row }] of handingBack) {
      if (!shown.has(key)) kept.set(key, { row, listed: false, pending: true, said: null })
    }
    return [...listed, ...kept.values()]
  })

  const asks = computed(() =>
    instructionAsksView(asked.value.walked, asked.value.lastLookAnswered, asked.value.nameOf),
  )
  // ⚑ **F097** — and the SAME `now` and `held` as the stalled band, for its reason one list over.
  const waitingOnWhoWrote = computed(() =>
    waitingOnWhoWroteView(
      replyOwed.value.walked,
      replyOwed.value.lastLookAnswered,
      world.value.now,
      world.value.held,
    ),
  )
  // A request decided here leaves the list at once, though the next look has not dropped it yet.
  const serverRequests = computed(() => {
    const read = mcpServerRequestsView(
      serverAsked.value.walked,
      serverAsked.value.lastLookAnswered,
      serverAsked.value.nameOf,
    )
    return read === null
      ? null
      : { ...read, rows: read.rows.filter((one) => !settledHere.has(one.requestId)) }
  })
  const serverRequestsSettled = computed(() => [...settledHere.values()].reverse())
  const corner = computed(() =>
    cornerHead(
      view.value,
      asks.value,
      waitingOnWhoWrote.value,
      serverRequests.value,
      workWaits.value.todos,
    ),
  )

  const mayBeShort = computed(
    () =>
      (view.value?.mayBeShort ?? false) ||
      // ⚑ **D-017 · R19** — and a look for asks that has not answered: the asks are owed by a person.
      asks.value?.partial === true ||
      asks.value?.stale === true ||
      // …and a look for the agents' requests to register an MCP server that has not answered.
      serverRequests.value?.partial === true ||
      serverRequests.value?.stale === true ||
      // ⚑ **F097** — and the work waiting on a person's reply, owed by a person too: its two holes.
      waitingOnWhoWrote.value?.unread === true ||
      (waitingOnWhoWrote.value?.short ?? null) !== null ||
      stalled.value?.unread === true ||
      (stalled.value?.short ?? null) !== null ||
      stopped.value?.unread === true ||
      (stopped.value?.short ?? null) !== null ||
      workWaits.value.todos.unread ||
      workWaits.value.incidents.unread ||
      workWaits.value.incidents.short !== null,
  )

  return {
    view,
    limits,
    stalled,
    stopped,
    mayBeShort,
    asks,
    waitingOnWhoWrote,
    serverRequests,
    corner,
    take(row) {
      doors?.travel(row)
    },
    settle(row, decision) {
      doors?.settle(row, decision)
    },
    async answer(row, response) {
      const door = doors?.answer
      if (door === undefined || presses.get(row.key)?.is === 'sending') return
      presses.set(row.key, { is: 'sending' })
      const said = await door(row, response)
      // ⚑ Taken: *answer sent* stands until the next look drops the row. Not taken: the host's
      // words, and the card is open again.
      if (said !== null) presses.set(row.key, { is: 'refused', said })
    },
    async move(row, decision) {
      const door = doors?.move
      if (door === undefined || presses.get(row.key)?.is === 'sending') return
      presses.set(row.key, { is: 'sending' })
      const said = await door(row, decision)
      // ⚑ Taken: *answer sent* stands until the next look drops the row. Not taken: the host's
      // words, and the card is open again.
      if (said !== null) presses.set(row.key, { is: 'refused', said })
    },
    presses,
    takeOver(row) {
      doors?.takeOver(row)
    },
    openWork(row) {
      doors?.open(row.sessionId)
    },
    handBack(row) {
      const door = doors?.handBack
      const key = stopKey(row)
      if (door === undefined || handingBack.has(key)) return
      const press = ++handBackPresses
      handingBack.set(key, { row, press })
      handedBack.delete(key)
      const stillMine = (): boolean => handingBack.get(key)?.press === press
      void door(row.label)
        .then((said) => {
          if (stillMine()) handedBack.set(key, { row, said })
        })
        .finally(() => {
          if (stillMine()) handingBack.delete(key)
        })
    },
    stoppedCards,
    closingWork,
    closedWork,
    closeWork(piece) {
      const door = doors?.closeWork
      if (door === undefined || closingWork.has(piece) || closedWork.get(piece)?.ok) return
      const generation = closeGeneration
      closingWork.add(piece)
      closedWork.delete(piece)
      void door(piece)
        .then(
          (result) => {
            if (generation === closeGeneration) closedWork.set(piece, result)
          },
          () => {
            if (generation === closeGeneration)
              closedWork.set(piece, { ok: false, said: 'That piece did not close. Try again.' })
          },
        )
        .finally(() => {
          if (generation === closeGeneration) closingWork.delete(piece)
        })
    },
    workWaits,
    attentionReady,
    todoCards,
    answerTodo(row, done, note) {
      const door = doors?.answerTodo
      if (door === undefined || answeringTodo.has(row.key)) return
      const press = ++todoPresses
      answeringTodo.set(row.key, { row, press })
      todoSaid.delete(row.key)
      const stillMine = (): boolean => answeringTodo.get(row.key)?.press === press
      void door(row.sessionId, row.key, done, note.trim())
        .then((refused) => {
          if (!stillMine()) return
          todoSaid.set(row.key, {
            row,
            said: refused ?? todoAnsweredSays(row.askedByName, done),
            taken: refused === null,
          })
        })
        .finally(() => {
          if (stillMine()) answeringTodo.delete(row.key)
        })
    },
    dismissTodo(row) {
      todoSaid.delete(row.key)
    },
    workCards,
    takeBackEntry(part, entry) {
      const door = doors?.handBack
      const key = entryKey(part, entry)
      if (door === undefined || takingEntry.has(key)) return
      const press = ++entryPresses
      takingEntry.set(key, { entry, press })
      entrySaid.delete(key)
      const stillMine = (): boolean => takingEntry.get(key)?.press === press
      void door(entry.label)
        .then((said) => {
          if (stillMine()) entrySaid.set(key, { entry, said })
        })
        .finally(() => {
          if (stillMine()) takingEntry.delete(key)
        })
    },
    dismissEntry(part, entry) {
      entrySaid.delete(entryKey(part, entry))
    },
    openFile(resource) {
      doors?.openFile?.(resource)
    },
    dismissHandBack(row) {
      handedBack.delete(stopKey(row))
    },
    decideInstruction(askId, approve) {
      doors?.decideInstruction?.(askId, approve)
    },
    decideMcpServerRequest(requestId, approve) {
      const door = doors?.decideMcpServerRequest
      const row = serverRequests.value?.rows.find((one) => one.requestId === requestId)
      if (door === undefined || row === undefined || deciding.has(requestId)) return
      deciding.add(requestId)
      pressed.delete(requestId)
      void door(requestId, approve)
        .then((ack) => {
          // Still waiting: the words stay on its card. Over: the card stays, saying how it ended.
          if (ack.outcome === 'refused' && ack.stillOpen) {
            pressed.set(requestId, ack.reason)
            return
          }
          settledHere.set(requestId, { row, said: ack.reason ?? '' })
          for (const kept of [...settledHere.keys()].slice(0, -SETTLED_CARDS_KEPT)) {
            settledHere.delete(kept)
          }
        })
        .finally(() => deciding.delete(requestId))
    },
    deciding,
    serverRequestPressed: pressed,
    serverRequestsSettled,
    dismissServerRequest(requestId) {
      settledHere.delete(requestId)
    },
    supply(
      next,
      nextDecisions,
      nextWorld,
      nextDoors,
      nextLimits,
      nextStalled,
      nextAsks,
      nextOwed,
      nextServerRequests,
      nextStopped,
      nextIncidents,
    ) {
      // ⚑ **UI-009 · a press is forgotten when its row leaves** — a look that did not answer keeps them.
      if (next !== null) {
        const listed = new Set(
          next.rows.map((one) => `${one.request.askedBy}:${one.request.requestId}`),
        )
        for (const key of [...presses.keys()]) if (!listed.has(key)) presses.delete(key)
      }
      answered.value = next
      decided.value = nextDecisions
      // ⛔ **A caller that names no walls means *nobody has looked*, not *keep the last ones***.
      // ⚠️ Carrying them over would let a band outlive the look that produced it, which is the
      // staleness `PersonsQueueView.stale` exists to disclose rather than to hide.
      walls.value = nextLimits ?? NOBODY_HAS_LOOKED_FOR_A_WALL
      // ⛔ **A caller that names no stalls means *nobody has looked*, not *keep the last ones***,
      // which is the line above's rule and not a second one.
      stalledWork.value = nextStalled ?? NOBODY_HAS_LOOKED_FOR_A_STALL
      // ⛔ **…and a caller that names no asks means *nobody has looked*** — the same rule again.
      asked.value = nextAsks ?? NOBODY_HAS_LOOKED_FOR_AN_ASK
      // ⛔ **…and one that names no work waiting on a reply** (F097), once more.
      replyOwed.value = nextOwed ?? NOBODY_HAS_LOOKED_FOR_A_REPLY
      // …and one that names no requests to register an MCP server.
      serverAsked.value = nextServerRequests ?? NOBODY_HAS_LOOKED_FOR_A_SERVER_REQUEST
      stoppedWork.value = nextStopped ?? NOBODY_HAS_LOOKED_FOR_A_STOP
      incidentsRead.value = nextIncidents ?? NOBODY_HAS_LOOKED_FOR_AN_INCIDENT
      // A refusal is forgotten when its to-do leaves the list; an answer taken stays until dismissed.
      if (next !== null) {
        const listed = new Set(todosOf(next).map((one) => one.requestId))
        for (const [key, one] of [...todoSaid])
          if (!listed.has(key) && !one.taken) todoSaid.delete(key)
      }
      // A press's words go with the request when a look no longer lists it.
      const stillAsked = nextServerRequests?.walked
      if (stillAsked !== undefined && stillAsked !== null) {
        const listed = new Set(stillAsked.map((one) => one.requested.requestId))
        for (const key of [...pressed.keys()]) if (!listed.has(key)) pressed.delete(key)
      }
      world.value = nextWorld
      doors = nextDoors
    },
    forget() {
      presses.clear()
      deciding.clear()
      pressed.clear()
      settledHere.clear()
      handingBack.clear()
      handedBack.clear()
      answeringTodo.clear()
      todoSaid.clear()
      closeGeneration += 1
      closingWork.clear()
      closedWork.clear()
      takingEntry.clear()
      entrySaid.clear()
      answered.value = null
      decided.value = null
      walls.value = NOBODY_HAS_LOOKED_FOR_A_WALL
      stalledWork.value = NOBODY_HAS_LOOKED_FOR_A_STALL
      asked.value = NOBODY_HAS_LOOKED_FOR_AN_ASK
      replyOwed.value = NOBODY_HAS_LOOKED_FOR_A_REPLY
      serverAsked.value = NOBODY_HAS_LOOKED_FOR_A_SERVER_REQUEST
      stoppedWork.value = NOBODY_HAS_LOOKED_FOR_A_STOP
      incidentsRead.value = NOBODY_HAS_LOOKED_FOR_AN_INCIDENT
      world.value = NOTHING_LOOKED_AT_YET
      doors = null
    },
  }
}

/** The window's one person's queue. */
const shared = createPersonsQueue()

export function usePersonsQueue(): PersonsQueue {
  return shared
}
