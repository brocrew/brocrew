import type { LedgerWalk } from '../../../shared/question-contracts'
// ⚑ **557 · the second band the queue carries beside its rows** — see {@link StalledWorkView} for
// the table that decides it is a band and not a fourth row.
import { stalledWorkKey, stalledWorkSaid } from '../../../shared/stalled-work'
import { unreadSays } from './rows-unread'
import type { StalledWork } from '../../../shared/stalled-work'
// ⚑ **F097 · the work whose agent answered a person, carried beside the rows and counted with them**
// — see {@link WaitingOnWhoWroteView} for why it is beside them and not one of them.
import { waitingOnWhoWroteKey, type WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
// ⚑ **D-017 · R19 · the asks against an identity's rules, carried beside the rows** — see
// {@link InstructionAsksView} for why they are beside them and not one of them.
import type { InstructionAskWaiting } from '../../../shared/own-instructions'
// ⚑ **533 · the wall the queue carries beside its rows** — see {@link ProviderLimitsView} for why
// it is beside them and not one of them.
import { providerConditions } from '../../../shared/provider-limit'
import type { ProviderCondition, ProviderLimitSeen } from '../../../shared/provider-limit'
import type { LimitsDisplayState } from './limits-display'
import { agoWords } from './clock'
import { OPEN_THE_CONVERSATION } from './taking-over'

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
