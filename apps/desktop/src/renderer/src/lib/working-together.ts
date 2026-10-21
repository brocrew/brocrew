import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import { walkCovers, type LedgerWalk, type LedgerWalkKind } from '../../../shared/questions'
import { TASK_IS_OPEN } from '../../../shared/tasks'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../../shared/who-called-whom'
import type { TheWholeForest } from '../../../shared/the-whole-forest'
import { pieceNumbersOf, type WorkThatNamesIt } from '../../../shared/piece-called'
import {
  byConversation,
  whatAPlateCanDraw,
  type ConversationAtWork,
  type WhatIsBeingDone,
} from '../../../shared/what-is-being-done'
import { sessionFacets, type AgentFacets } from './agent-state'
import { agoWords } from './clock'
import { workReading, type WorkReading } from './work-report'
import { unreadSays } from './rows-unread'
import { A_PERSON_ADDRESSED } from './outgoing-card'

/**
 * 🔴 **The first picture of who called whom** (547) — `540` §7 slice 1's renderer half, over
 * `543`'s {@link WhoCalledWhom}.
 *
 * ## Show caller relationships and provide navigation
 *
 * > ⚑ *"when an Agent spawns another agent, I need to see the agent avatars too in that panel and
 * > the current state. BroBot conversation → I see big BroBot avatar, I also need to see the
 * > project manager (+ all tasks/conversations as clickable to go to that conversation)."*
 *
 * > 🔴 *"this is very important for me to see who's calling who and to navigate between them."*
 *
 * ⛔ **What he got before this file existed**, at the moment BroBot had spawned a project manager
 * and was waiting on it: **one avatar, one state word, `Nothing is waiting`, and a sentence
 * pointing at another tab.** ⛑ **`Nothing is waiting` is quoted as history** — `577` replaced that
 * heading with one that names what the pane counted. ⚠️ `543` built the read an hour earlier and
 * nothing drew it — *a read with no reader is a read whose shape nobody has tested against a
 * person*.
 *
 * ## ⛔ Two relations, and one may never be derived from the other
 *
 * ⚠️ **A spawn and a handoff are independent**, which `540` §5 measured: a conversation may give
 * work to one it never spawned. ⚑ **553 · this said *work is admitted by `can_message` and not by
 * descent*, and HO-060 §2 made it false** — the gate is `can_assign_work`, and since D-014 work
 * goes only to a conversation the giver started. ⚑ What keeps the two lists independent is the
 * ledger: work given under the wider rules before that stays recorded against conversations its
 * giver never spawned. ⛔ So {@link WorkingTogetherView.children} is the SPAWN list and
 * {@link WorkingTogetherView.others} is every conversation this one gave work to that the spawn
 * list does not name — v2.8's *other conversations given work*, which is a real product case and
 * not authored decoration. 🔴 **Nothing here ever says a recipient outside the child list *was
 * never spawned***: this read is one conversation's own edges and knows nothing about who else
 * spawned whom.
 *
 * ## 🔴 Every list carries its own completeness, and none of them may say `0 spawned`
 *
 * ⛔ **{@link ListCoverage} per list, because `543` §4 gave each walk its own** — *"an absent
 * relationship read and an incomplete list have different words, and neither may ever produce
 * `0 spawned`"* (`452` §5.1's forbidden sentence, one noun over). ⚑ {@link ListCoverage.count} is
 * the enforcement rather than a convention: it is `null` unless the walk answered, spelled a word
 * this build knows, was the walk that actually looks, and read every row — so a template that draws
 * a count cannot draw one over a partial read.
 *
 * ## ⚠️ What this fold refuses to say, and why each refusal is somebody's measurement
 *
 *  - ⛔ **No liveness, of any shape** (`509`'s ruled field). `live | silent` may only go on a reader
 *    whose cadence is shorter than the silence window, and this one re-reads on a push, never on a
 *    clock (W4.74). ⚑ A card that says what a conversation IS without claiming whether it
 *    is still alive is a complete card.
 *  - ⚑ **No navigation state** — D-017b: a conversation opens in its full view whatever it is
 *    doing, so there is nothing for a card to guess at.
 *  - ⛔ **No two-valued work status.** v2.8 folds task state to `open | answered`; this app has
 *    several states and three of them are closed — {@link TASK_IS_OPEN} — so that fold prints
 *    *answered* over work a parent took back or closed. ⚑ {@link CastWork.open} is the boolean and
 *    {@link CastWork.reading} carries `WORK_STATE_WORD`'s own sentence beside it, which is `169`
 *    §1: one vocabulary, already drawn by the transcript's work-report row and by the Work tab.
 *
 * ## ⚠️ Which way it fails
 *
 * **Toward saying too little, and toward saying it late.** A child that changed state moments ago
 * reads as it was at the last read until the next move of the work is pushed — and
 * {@link WorkingTogetherView.asOf} says how old a reading kept after a refused read is. A read that did not
 * answer keeps the last good cards and marks them. ⛔ **None of those is a false promise**: the
 * failure available here is a card that is stale or a list that is short by a number it states,
 * never a list claiming nobody was spawned.
 */

/** ⛔ **The ONE empty that is about the conversation**, rather than about a read or about this app. */
export const NO_SPAWNED_CONVERSATIONS = 'No conversations started'

/**
 * ⛔ **The sentence this band no longer says** — kept as a constant, and the keeping is deliberate.
 *
 * ⚑ It was the parent's absence said once: `SessionStore.spawnProvenance` (`parentOf` since D-016)
 * answered `null` only when the triple was not all there, so it covered *nothing in this app spawned
 * it* and *it was recorded before the columns existed* together — the pair
 * {@link WhoCalledWhom.parent}'s own docblock named — and it was withheld under any doubt about the
 * lineage read.
 *
 * Nothing produces this retired sentence; {@link parentCardOf} returns no empty-parent wording. Keep the constant shared by tests that assert it is never displayed, as `visible-copy.ts` does, instead of duplicating the forbidden string in each test.
 */
export const NOBODY_IN_THIS_APP_SPAWNED_IT = 'Nothing in this app spawned this conversation'

/**
 * 🔴 **Why a list may not be what is in the database** — or `null`, no reason at all.
 *
 * ⛔ **`WorkDoubt`'s two members and a third, and the third is this shape's own.** A walk that read
 * NOTHING is not a walk that answered with an empty list: `no-such-conversation` is *this app holds
 * no conversation by that id* and `no-ledger` is *this app has no ledger open*, and either of them
 * drawn as an empty child list would be the forbidden sentence. ⚠️ A boolean would have made *the
 * read did not answer* the only thing a band could say, and two of these three are reads that
 * answered perfectly well.
 */
export type ListDoubt =
  /** 🔴 The read answered with a walk word this build cannot spell — `467` F7, the preload CASTS. */
  | 'a-word-this-app-cannot-spell'
  /**
   * ⛔ **The walk that answered is not the walk that looks** — `no-such-conversation`, `no-ledger`,
   * or any other word that reads nothing for this question. ⚑ Detected by comparing the word the
   * answer carries against the word this list is asking for: the empty sentence is drawn only under
   * the word that means *I really looked*.
   */
  | 'nothing-was-walked'

/** ⛔ **Exhaustive**: a third cause fails to compile until somebody has decided what it says. */
export const LIST_DOUBT_WORDS: Readonly<Record<ListDoubt, string>> = {
  'a-word-this-app-cannot-spell':
    'This came back describing a read this version of the app does not know how to explain, so what is above is shown without the sentence that says what was covered.',
  'nothing-was-walked':
    'Nothing was read for this, so there is nothing here to count. It is not an empty list and it is not a statement that nobody was spawned or that no work passed.',
}

/**
 * 🔴 **The read did not answer — said ONCE, at the moment it is about** (v2.8 §06, `547` §3.3).
 *
 * ⛔ **Not a {@link ListDoubt}, and it was one until a mutation said so.** `answered` is one boolean
 * over one round trip, so every list is in doubt together — and a band that carried it per list drew
 * three near-identical blocks for one fact. ⚑ **The anchor is the read's own footer**, beside the
 * moment it kept: *"a failed refresh preserves old data and its old timestamp, with a quiet error at
 * the same anchor"*.
 *
 * ⚠️ **The row that found it survived.** With the refusal competing with a walk WORD for one slot,
 * the two orderings of that decision agree on every input a suite can reach — which is
 * `a-comparison-tested-where-both-sides-agree-measures-nothing`, and the fix is the shape rather
 * than one more assertion.
 */
export const THE_READ_DID_NOT_ANSWER =
  'This did not answer just now, so the cards above and the moment below them are the last answer this window had. It is not a conversation that spawned nobody, and it is not a statement that nothing has changed since.'

/**
 * 🔴 **What is known about ONE of this band's lists** — `543` §4's *every list needs a completeness
 * signal of its own*, as a shape rather than as four fields repeated three times.
 */
export interface ListCoverage {
  /** 🔴 Why this list may not be current, or `null`. See {@link ListDoubt}. */
  readonly doubt: ListDoubt | null
  /**
   * ⛔ **Rows the walk could not read, so this list is SHORT by an amount only this number can
   * say.** ⚠️ Not a count of rows found: an unread row usually folds into no card at all, so this
   * and the list above it do not add up to anything and must not be drawn as if they did.
   */
  readonly short: number
  /** ⚑ **D-017 · R8** — how many records the walk skipped whole; this list is short by them too. */
  readonly skipped: number
  /**
   * 🔴 **How many rows there are — ONLY when the list is complete**, and `null` otherwise.
   *
   * ⛔ **v2.8 §05, enforced here instead of in a template**: *"Direct-child and open-task counts
   * appear only when the relevant list and completeness flag are supplied."* ⚑ Four conditions have
   * to hold — the read answered, the word is one this build spells, it is the word that actually
   * looks, and no row went unread — and a surface that draws `count` cannot be drawing it over a
   * partial read.
   */
  readonly count: number | null
}

/** One piece of work on this band, as a card draws it. */
/**
 * ⚑ **631 · one task line** — the piece, plus the plate and name of the conversation that GAVE it:
 * every line is work this conversation was given, since the given-out lines went (PM ruling,
 * 2026-10-01). ⛔ The plate is the CARD's, not a second `plateOf` call, so one agent cannot wear
 * two faces.
 */
export interface CastTask {
  readonly piece: CastWork
  /** ⛔ **`null` where this band holds no card for that conversation** — see the `taken` note. */
  readonly facets: AgentFacets | null
  readonly toName: string
}

export interface CastWork {
  /** The piece's id — the row's key, and never drawn: its label is what a person reads. */
  readonly piece: string
  /**
   * ⛔ **The words, from {@link workReading}** — the label, the state word or its cause, the
   * outcome, and the mark. ⚑ The SAME reading the transcript's work-report row and the Work tab
   * draw, so three surfaces cannot describe one fold differently (`169` §1, `222` §4).
   */
  readonly reading: WorkReading
  /**
   * 🔴 **Still somebody's to finish** — {@link TASK_IS_OPEN}, read and never re-derived.
   *
   * ⛔ **`Object.hasOwn` rather than `??`**, which is `406`'s review finding one file over: that
   * table is an object literal, so a state naming `constructor` or `toString` indexes to a FUNCTION,
   * which is truthy. ⚑ **Unknown counts as CLOSED** — the fail-quiet direction, since an open bit
   * is a claim that something is still owed.
   */
  readonly open: boolean
  /**
   * ⛔ **631 · the raw state, kept.** `workOf` folded it to {@link CastWork.open} and dropped it,
   * and a boolean cannot choose between this app's piece states.
   */
  readonly state: WorkEdge['state']
  /**
   * The piece's TITLE, verbatim — {@link WorkEdge.title}, the newest title, whoever set it. ⚑ One
   * line by construction, bounded where it is given; an empty string draws nothing.
   */
  readonly said: string
  /**
   * The conversation that gave it, and the name of the identity recorded for it — or `null`: a
   * person gave it, work its holder took on for them (D-016 · commit 6), named
   * {@link A_PERSON_ADDRESSED}.
   */
  readonly from: string | null
  readonly fromName: string
  /** When it was handed out, in a person's words — `agoWords(givenAt, readAt)`. */
  readonly given: string
}

/**
 * 🔴 **One conversation beside this one** — a spawned child, or a conversation this one gave work
 * to that the spawn list does not name.
 *
 * ⛔ **A card is a CONVERSATION, not an identity and not a task** (v2.8 §01). ⚠️ A task-first flat
 * list duplicates the avatar and loses direction; a role-first list MERGES distinct conversations
 * made from one identity — which is the exact case `543` §0 plants and `WorkGivenOut` cannot tell
 * apart.
 */
export interface CastCard {
  /** The conversation's own id — what every door on this wire calls `sessionId`. */
  readonly conversation: string
  /** ⚑ **{@link agentName}, the app's one naming function** (`449`) — never a name invented here. */
  readonly name: string
  /** ⚠️ The identity's slug, BESIDE the name. `null` is *this app records no identity for it*. */
  readonly identity: string | null
  /**
   * 🔴 **The plate** — the SAME {@link sessionFacets} the roster's rows call, with the inputs this
   * read actually carries.
   *
   * ## ⛔ What `547` F1 refused, and it was right to
   *
   * ⚠️ **`status` was not one of them, and that was the finding rather than a shortcut.**
   * {@link SpawnEdge} carries `running` and not `status`, and those answer different questions —
   * `ResumableSessionInfo.running`'s own docblock: *"a row can be `idle` in the database and
   * `not-running` here"*. ⛔ So a child this app was RUNNING drew `doing: 'unknown'` — `081`'s
   * faceless plate — because nothing on that read said whether a turn was being driven.
   *
   * ## ⚑ 632 · what changed is the READ, not the rule
   *
   * 🔴 **`575` and `593` built the missing fact and `547` F1 could not have known it** — it was
   * written three weeks later. ⛔ {@link ConversationAtWork} carries the status, the activity and
   * the streaming flag off the live event stream, `whatAPlateCanDraw` is the one door out of it,
   * and `team-roster.ts` has drawn plates from it since `593`. ⚑ **This band is another caller of
   * that door and composes nothing of its own.**
   *
   * ⚠️ **The faceless plate is still reachable and is still the honest answer**, by two roads
   * rather than one: a child this app is not running is in no {@link WhatIsBeingDone} at all, and a
   * child that has said nothing has its recorded status WITHHELD by `whatAPlateCanDraw`. ⛔ Neither
   * may read as `idle`, which is `an-unenumerated-state-counts-as-success` and the rule `HO-095`
   * §5.1 and `EXT-014` §5 were both broken by.
   */
  readonly facets: AgentFacets
  /**
   * ⚑ **F094 · replaced** — this conversation could never be reopened, and a new one of the same
   * agent took its place, which this strip does not hold (past the forest's bound, or not one of
   * this conversation's agents). The name to say — the stand-in's, else this card's own. Absent
   * otherwise: a replaced one whose stand-in IS here is not drawn at all ({@link inTheirPlace}).
   */
  readonly replacedBy?: string
}

/**
 * 🔴 **The band, before any card.**
 *
 * ⚑ **The parent is not here**: the panel draws it, through {@link parentCardOf}, and the band
 * reads it only to put a plate on the work the parent gave.
 *
 * ⛔ **The work this conversation gave out has no LINES here** (PM ruling, 2026-10-01): no surface
 * drew them since the card's given list went (4f5d9d7a), and the Graph tab draws each piece on its
 * holder's card. `654`'s tint went with them — it could fire only on a given-out line, a taken
 * line's subject being its giver. ⚑ **The given-out walk still feeds two things**: the
 * {@link others} on the strip, and {@link gaveOutShort} — a torn row in that walk can drop an
 * *other* from the strip, and the spawn list's own count does not see it.
 */
export interface WorkingTogetherView {
  /** ⚑ **What it started** — the DIRECT children, in the order the walk gave them. */
  readonly children: readonly CastCard[]
  /**
   * 🔴 **{@link THE_READ_DID_NOT_ANSWER}, or `null`** — one sentence for the whole band, at the
   * moment it is about. ⛔ Never per list: one round trip, one refusal.
   */
  readonly refusal: string | null
  /** ⛔ The spawn list's own completeness. */
  readonly childList: ListCoverage
  /** ⛔ **{@link NO_SPAWNED_CONVERSATIONS}, or `null`** — drawn only under a COMPLETE empty list. */
  readonly childrenEmpty: string | null
  /**
   * 🔴 **Conversations this one gave work to that the spawn list does not name** — v2.8's *other
   * conversations given work*, and a group of its own so the two edges are never collapsed.
   */
  readonly others: readonly CastCard[]
  /**
   * 🔴 **678 · F-R18a — the sentence for the given-out walk's `short` and `skipped`**, drawn under
   * *Assigned by it*; `null` at 0. ⛔ **It was folded and drawn by NOTHING** — `631` removed the
   * per-list hooks with the cards — so a torn row in this walk was invisible. ⚠️ **Per list, never
   * summed**: the taken walk's wait reads can read the same ledger, so one torn row may be counted
   * in both.
   */
  readonly gaveOutShort: string | null
  /** 🔴 **631 · the work this conversation was GIVEN** — the agent card's *Current task*. */
  readonly taken: readonly CastTask[]
  /** 🔴 **678 · F-R18a — the same sentence for the taken-in walk**, under *Current task*. See {@link gaveOutShort}. */
  readonly tookInShort: string | null
  /**
   * 🔴 **How old this reading is, in a person's words** — `agoWords(read.readAt, now)`.
   *
   * ⛔ **`null` while the newest read answered** (W4.74, D-033): the band is read again on every
   * move of the work it draws, so an answered reading is the current one whatever its age, and an
   * age under it would say *stale* about a band that is not. ⚑ Said for a reading KEPT after a read
   * that did not answer — the one that may be behind.
   *
   * ⚠️ **Measured from {@link WhoCalledWhom.readAt}, which `543` stamps LAST over one synchronous
   * aggregate** — so it is one completion point over all three lists rather than three clocks a band
   * would have to reconcile (`540` MI-19, and the condition it named).
   */
  readonly asOf: string | null
}

/**
 * 🔴 **One answer, and the conversation it is ABOUT.**
 *
 * ⛔ **The conversation is on the reading and is never assumed from the surface.** A person can open
 * conversation A and then B inside one round trip; without this the kept-last-good band would draw
 * A's children under B's drawer, which is the strongest false claim this band could make. ⚑
 * `WorkGivenOutReading`'s guard exactly, one question over.
 */
export interface CastReading {
  readonly conversation: string
  readonly read: WhoCalledWhom
  /** Whether the MOST RECENT read for this conversation answered (`434`'s distinction). */
  readonly answered: boolean
  /**
   * Current activity, requested with the relationship read and applied when it arrives. Null
   * until then, or when a read fails; kept cards never retain an old activity claim.
   */
  readonly atWork: WhatIsBeingDone | null
}

/** Everything the fold reads. Plain data, so it can be asserted with no renderer at all. */
export interface WorkingTogetherInput {
  readonly reading: CastReading | null
  /** The conversation the SURFACE is showing. */
  readonly forConversation: string
  /** ⚑ `null` until the identities read lands — a cold window names every card by its slug. */
  readonly identities: readonly AgentIdentity[] | null
  /** The live instant {@link WorkingTogetherView.asOf} is measured against. ⛔ A minute clock. */
  readonly now: number
}

/**
 * ⛔ **`632`'s keying, in ONE expression** (631) — the reading's rows, keyed by CONVERSATION.
 *
 * ⚠️ **Extracted because it had been written twice**: `parentCardOf` needs the same map the view
 * needs, and the second copy made `632 M9`'s anchor ambiguous — a row that matches two lines
 * protects neither. ⛔ **A card is a CONVERSATION and not an identity**, which is this file's own
 * rule and exactly what that row plants against.
 */
function atWorkOf(reading: CastReading): ReadonlyMap<string, ConversationAtWork> | null {
  return reading.atWork === null ? null : byConversation(reading.atWork)
}

/**
 * 🔴 **The conversation that spawned this one, as a card** (631) — ONE implementation, two callers.
 *
 * `SessionPanel` draws parent navigation above the avatar while `WorkingTogether` draws the rest of the band. Share the parent fold so those components cannot derive conflicting descriptions.
 *
 * ⚑ **So this is the shape `recordFacets` already has in this app** — *"THE SAME FUNCTION THE PANE
 * CALLS, ON THE SAME NUMBERS"*. The panel calls it for the way up it draws; {@link
 * workingTogetherView} calls it for the plate the work the parent gave wears. ⛔ Neither computes a
 * parent of its own.
 *
 * A null parent draws nothing, whether nobody spawned this conversation or the parent could not be looked up. The removed {@link NOBODY_IN_THIS_APP_SPAWNED_IT} sentence no longer distinguishes those states on screen; do not infer confirmed root status from the absence of a parent row.
 */
export function parentCardOf(input: WorkingTogetherInput): CastCard | null {
  const reading = input.reading
  if (reading === null || reading.conversation !== input.forConversation) return null
  const read = reading.read
  if (read.parent === null) return null
  const atWork = atWorkOf(reading)
  return cardOf(read.parent, input, atWork)
}

/**
 * ⛔ **The whole band, from the reading and nothing else** (547).
 *
 * Pure and total. ⚑ `null` is *nothing has been read for this conversation yet* — a state the band
 * draws as neither cards nor an empty sentence, because it has not asked a question yet and an
 * answer about a question nobody asked is the claim `434` spent a dispatch removing.
 */
export function workingTogetherView(input: WorkingTogetherInput): WorkingTogetherView | null {
  // ⛔ **`?? null`, and it is the same discovery `work-given-out.ts` records.** A mount that OMITS
  // the prop type-checks and passes `undefined` at run time, and every render file that does not
  // care about this band does exactly that. ⚠️ `074`'s rule — nothing declared is nothing to say,
  // whichever shape the nothing arrives in.
  const reading = input.reading ?? null
  if (reading === null || reading.conversation !== input.forConversation) return null
  const read = reading.read

  // ⚑ **632 · the PARENT wears a plate too**, and it is the same door: a parent is a conversation
  // this app may be running. ⛔ **631 · through `parentCardOf`, because `SessionPanel` draws this
  // same card** as the way up and must not fold a second one — here it only lends its plate to the
  // work it gave (`taken`, below).
  const parent = parentCardOf(input)

  const childList = coverageOf(
    read.children,
    'every-conversation-this-one-spawned',
    reading.answered,
  )
  const gaveOut = coverageOf(
    read.workGivenOut,
    'every-conversation-this-one-gave-work-to',
    reading.answered,
  )
  const tookIn = coverageOf(
    read.workTakenIn,
    'every-piece-of-work-this-one-was-given',
    reading.answered,
  )

  // Key activity once for the whole band, from this relationship reading's own refinement.
  const atWork = atWorkOf(reading)

  const work = (row: WorkEdge): CastWork => workOf(row, input, read.readAt)
  const children = read.children.rows.map((row) => cardOf(row, input, atWork))

  // ⛔ **Every recipient the spawn list does not name, in the order the work rows first name them.**
  // ⚠️ The set is built from the ROWS THAT WERE READ, so a child the walk could not read leaves its
  // recipient here rather than silently merged into a card that is not on screen — which is the
  // honest direction: `childList.short` is the number that says the spawn list is incomplete.
  const spawned = new Set(read.children.rows.map((row) => row.conversation))
  const others: CastCard[] = []
  const seen = new Set<string>()
  for (const row of read.workGivenOut.rows) {
    if (spawned.has(row.to) || seen.has(row.to)) continue
    seen.add(row.to)
    others.push(recipientCard(row, input))
  }

  return {
    refusal: reading.answered ? null : THE_READ_DID_NOT_ANSWER,
    children,
    childList,
    // ⛔ **`count === 0` and not `children.length === 0`.** The count is `null` on every read that
    // could not look, so this sentence cannot be drawn out of one — which is the whole of `543` §4.
    childrenEmpty: childList.count === 0 ? NO_SPAWNED_CONVERSATIONS : null,
    others,
    gaveOutShort: unreadSays(gaveOut.short, gaveOut.skipped),
    // Fold work given to this conversation. The giver's plate is known only when it is the held parent card; other givers get null facets so the row omits a plate instead of inventing one.
    taken: read.workTakenIn.rows.map(work).map((piece) => ({
      piece,
      facets: parent !== null && piece.from === parent.conversation ? parent.facets : null,
      toName: piece.fromName,
    })),
    tookInShort: unreadSays(tookIn.short, tookIn.skipped),
    // ⛔ **Folded here and not in the component**: a derivation written inside an SFC is reachable
    // by no mutation row.
    asOf: reading.answered ? null : agoWords(read.readAt, input.now),
  }
}

/**
 * ⛔ **What is known about one walk**, with the four conditions {@link ListCoverage.count} needs.
 *
 * ⚠️ **Order matters and the first arm wins**: a read that did not answer is a fact about THIS
 * poll, while a word is a fact about the answer it gave. A refused read leaves the previous
 * answer's word standing, so asking the word first would report the older problem
 * (`work-given-out.ts`' own ordering, and its reason).
 */
function coverageOf(
  walk: LedgerWalk<unknown>,
  looks: LedgerWalkKind,
  answered: boolean,
): ListCoverage {
  const says = walkCovers(walk.walk)
  // ⛔ **About the WORD the answer carried, and nothing else.** Whether the round trip answered at
  // all is {@link THE_READ_DID_NOT_ANSWER}'s, said once for the band — see its own note.
  const doubt: ListDoubt | null =
    says === null
      ? 'a-word-this-app-cannot-spell'
      : walk.walk !== looks
        ? 'nothing-was-walked'
        : null
  return {
    doubt,
    short: walk.rowsUnread,
    skipped: walk.ledgersSkipped ?? 0,
    // ⛔ **All FOUR conditions, and `rowsUnread === 0` is the one a mutation walked through.** A
    // list that could not read its rows can still hold none of them, and `count: 0` is what draws
    // *No spawned conversations* — so without this clause the forbidden sentence is reachable from
    // a walk that refused every row it had. ⚑ **D-017 · R8** — nor one that skipped a whole record.
    count:
      answered && doubt === null && walk.rowsUnread === 0 && (walk.ledgersSkipped ?? 0) === 0
        ? walk.rows.length
        : null,
  }
}

function cardOf(
  edge: SpawnEdge,
  input: WorkingTogetherInput,
  atWork: ReadonlyMap<string, ConversationAtWork> | null,
): CastCard {
  return {
    conversation: edge.conversation,
    name: agentName(edge.identity, input.identities ?? null),
    identity: edge.identity,
    // 🔴 **632 · the plate, from the reading's own row** — see {@link plateOf}.
    facets: plateOf(edge.running === 'not-running', atWork?.get(edge.conversation) ?? null),
  }
}

/**
 * ⛔ **A card built from a WORK edge alone** — no session row was read for it, so it carries a name
 * and no state at all.
 *
 * ⚑ **It is not a lesser child card; it is a different fact.** The spawn walk reads
 * `provider_session`; a work row names a `session_id` that walk never looked at, and inventing a
 * `running` for it would be this band answering a question the read did not ask.
 */
function recipientCard(row: WorkEdge, input: WorkingTogetherInput): CastCard {
  return {
    conversation: row.to,
    name: agentName(row.toIdentity, input.identities ?? null),
    identity: row.toIdentity,
    // ⛔ **632 · the faceless plate, and no reading is asked for it.** A {@link WorkEdge} names a
    // conversation the spawn walk never read, so this card holds no `running` — and asking
    // `whatIsBeingDone` about it would be this band answering a question the read did not ask.
    // ⚠️ The population that read covers is *conversations this app is running*, which is a
    // different set again.
    facets: plateOf(false, null),
  }
}

/**
 * ⛔ **The plate** (547 F1, reopened by 632).
 *
 * ⚑ **D-017b · a conversation this app is not running is doing nothing here** — `idle`, the one
 * state's plate, and never a ring of its own: whether a process runs is not the plate's to say.
 *
 * ## 🔴 632 · the three fields `547` F1 had to leave empty, and where they come from
 *
 * ⛔ **`547` F1 read: *"Everything else is absent rather than guessed: no phase, no status, no
 * activity, no stream."*** ⚑ **`status`, `activity` and `streaming` are now on a read that did not
 * exist then** — {@link ConversationAtWork}, from `575` and `593` — and this takes them through
 * `whatAPlateCanDraw`, which is the only door out of that module and which composes no word of its
 * own. ⚠️ **`phase` and `liveness` stay absent and that is still a limit of the shape**: a phase is
 * a window's record of a launch it performed, and liveness moves on a timer with nothing to
 * announce from (`509`). ⛔ `sessionFacets` draws LESS rather than something else for both.
 *
 * ## ⛔ `atWork === null` is TWO states and both draw the faceless ring
 *
 * ⚑ **This app is not running it** — it is in no {@link WhatIsBeingDone}, because that read's
 * population is the running one. ⚑ **Or this window has no reading at all** — a cold band, or a
 * refusal that dropped it. ⚠️ **Neither may be drawn as `idle`**, and neither is: the recorded
 * status stays `null`, so `sessionDoing` answers `unknown` and `081`'s faceless plate is what a
 * person sees. 🔴 **That is the whole of `an-unenumerated-state-counts-as-success` at this band.**
 */
function plateOf(nothingRunsIt: boolean, atWork: ConversationAtWork | null): AgentFacets {
  // ⚠️ **The status is WITHHELD, never replaced, and the decision is `whatAPlateCanDraw`'s and not
  // ours.** ⛔ This band holds no status column of its own, so the
  // `recorded` argument is the row's own, exactly as `team-roster.ts` passes it.
  const plate = atWork === null ? null : whatAPlateCanDraw(atWork, atWork.status)
  const told = {
    phase: null,
    status: plate?.status ?? (nothingRunsIt ? ('idle' as const) : null),
    activity: plate?.activity ?? null,
    streaming: plate?.streaming ?? false,
    liveness: null,
  }
  return sessionFacets(told)
}

/**
 * 🔴 **UI-008 · F051 — the work a PERSON gave this conversation**, for its card's *Current task*:
 * the root it owns, out of the work that names it (`ResumableSessionInfo.named`), or `null`.
 *
 * The band's {@link WhoCalledWhom.workTakenIn} walk excludes a root. Include the person's root separately so the card does not show No current task over that work. A root label has one number; held-work labels have two or more.
 *
 * ⚠️ What its line can say is what the name carries: its label and its title. Its state is its
 * conversation's (R1), which the plate above it says; a root never ends, so it is always open; and
 * no conversation gave it, so its line is never a press (`TaskList`'s `pressable`).
 */
export function theWorkAPersonGave(
  named: WorkThatNamesIt | null | undefined,
): WorkThatNamesIt | null {
  if (named === undefined || named === null) return null
  return pieceNumbersOf(named.label)?.length === 1 ? named : null
}

function workOf(row: WorkEdge, input: WorkingTogetherInput, at: number): CastWork {
  return {
    piece: row.piece,
    // ⛔ **`workReading` over the EDGE**, which is legal because `WorkEdge`'s `label`, `state` and
    // absent `outcome` are `WorkWords`' shape — the narrowing `508` introduced so one vocabulary
    // could word two carriers. ⚑ A third carrier costs nothing here and a second table would cost
    // the app a disagreement.
    reading: workReading(row),
    open: Object.hasOwn(TASK_IS_OPEN, row.state) && TASK_IS_OPEN[row.state],
    state: row.state,
    said: row.title,
    from: row.from,
    // ⚑ **D-016 · commit 6 · a person gave it** — the window's one word for the person reading it,
    // never `agentName(null)`, which is BroBot.
    fromName:
      row.from === null
        ? A_PERSON_ADDRESSED
        : agentName(row.fromIdentity, input.identities ?? null),
    given: agoWords(row.givenAt, at),
  }
}

/**
 * 🔴 **F094 · the strip draws a stand-in in its predecessor's place** — D-034's rule on the Graph,
 * for the right panel's *Sub agents*. ⚑ A card whose conversation was replaced (the forest's
 * `inItsPlace`, which names the end of a chain) is not drawn beside its stand-in: the stand-in takes
 * the predecessor's position, once. ⚑ A stand-in this strip does not hold leaves the predecessor
 * drawn, saying it was replaced and by whom — never *idle*. ⛔ No forest read yet: the cards as they
 * are.
 */
export function inTheirPlace(
  cards: readonly CastCard[],
  forest: TheWholeForest | null,
  identities: readonly AgentIdentity[] | null,
): CastCard[] {
  if (forest === null) return [...cards]
  const placeOf = new Map<string, string>()
  const identityOf = new Map<string, string | null>()
  for (const node of forest.nodes.rows) {
    if (node.node !== 'a-conversation') continue
    identityOf.set(node.conversation, node.identity)
    const after = node.inItsPlace?.conversation
    if (after !== undefined && after !== node.conversation) placeOf.set(node.conversation, after)
  }
  const byId = new Map(cards.map((card) => [card.conversation, card]))
  const placed = new Set<string>()
  const out: CastCard[] = []
  for (const card of cards) {
    if (placed.has(card.conversation)) continue
    const after = placeOf.get(card.conversation)
    if (after === undefined) {
      placed.add(card.conversation)
      out.push(card)
      continue
    }
    const standIn = byId.get(after)
    if (standIn !== undefined) {
      if (!placed.has(after)) {
        placed.add(after)
        out.push(standIn)
      }
      continue
    }
    const named = identityOf.get(after)
    out.push({
      ...card,
      replacedBy: named === undefined ? card.name : agentName(named, identities),
    })
  }
  return out
}
