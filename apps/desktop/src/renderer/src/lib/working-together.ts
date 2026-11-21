import type { LedgerWalk, LedgerWalkKind } from '../../../shared/question-contracts'
import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import { walkCovers } from '../../../shared/questions'
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
 * Keep spawn and work relationships independent: older ledgers can name recipients the giver
 * did not spawn. These lists only describe the current conversation’s relationships.
 */

/** ⛔ **The ONE empty that is about the conversation**, rather than about a read or about this app. */
export const NO_SPAWNED_CONVERSATIONS = 'No conversations started'

/** Shared with tests that verify the retired empty-parent wording stays off screen. */
export const NOBODY_IN_THIS_APP_SPAWNED_IT = 'Nothing in this app spawned this conversation'

/** A missing conversation or ledger cannot establish that a relationship list is empty. */
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

/** A refused refresh keeps the previous cards and timestamp. Show the refusal once for the whole read. */
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
  /** Expose counts only after a successful walk of the expected kind with no unread rows or skipped ledgers. */
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
  /** Read openness from TASK_IS_OPEN. Require an own property so unknown states count as closed. */
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

/** Key cards by conversation so tasks share a card and distinct sessions of one identity stay separate. */
export interface CastCard {
  /** The conversation's own id — what every door on this wire calls `sessionId`. */
  readonly conversation: string
  /** ⚑ **{@link agentName}, the app's one naming function** (`449`) — never a name invented here. */
  readonly name: string
  /** ⚠️ The identity's slug, BESIDE the name. `null` is *this app records no identity for it*. */
  readonly identity: string | null
  /**
   * Share the roster’s facet derivation. When live status is missing, use idle only if the host reports
   * no live session. Otherwise show unknown activity.
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
 * Draw the parent separately. The given-out walk supplies other recipients and has its own coverage,
 * since an unread work row may hide a recipient even when the spawn list is complete.
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
  /** Show age only for a reading kept after a failed refresh. Use the aggregate’s completion time. */
  readonly asOf: string | null
}

/** Bind the reading to its conversation so a late refresh cannot show its cards in another drawer. */
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

function atWorkOf(reading: CastReading): ReadonlyMap<string, ConversationAtWork> | null {
  return reading.atWork === null ? null : byConversation(reading.atWork)
}

/**
 * Share the parent card between navigation and the work the parent gave. A missing card may mean
 * either no recorded parent or an unread parent, so it cannot establish root status.
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
    taken: read.workTakenIn.rows.map((row) =>
      taskGivenToThisOne(row, input.identities, parent, read.readAt),
    ),
    tookInShort: unreadSays(tookIn.short, tookIn.skipped),
    // ⛔ **Folded here and not in the component**: a derivation written inside an SFC is reachable
    // by no mutation row.
    asOf: reading.answered ? null : agoWords(read.readAt, input.now),
  }
}

/** The walk describes the last answer. A refused refresh carries that older walk and suppresses its count. */
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

/** A work edge supplies a name but has no session reading from which to infer activity. */
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
 * With no usable status, show idle when the host reports no live session and a faceless plate otherwise.
 * Launch phase and timed liveness are unavailable in this relationship read.
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
 * The taken-work walk excludes the person-given root. Find it by its one-part label and show it
 * as open without giver navigation. The plate carries its conversation state.
 */
export function theWorkAPersonGave(
  named: WorkThatNamesIt | null | undefined,
): WorkThatNamesIt | null {
  if (named === undefined || named === null) return null
  return pieceNumbersOf(named.label)?.length === 1 ? named : null
}

export function taskGivenToThisOne(
  row: WorkEdge,
  identities: WorkingTogetherInput['identities'],
  parent: CastCard | null,
  at: number,
): CastTask {
  const piece: CastWork = {
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
    fromName: row.from === null ? A_PERSON_ADDRESSED : agentName(row.fromIdentity, identities),
    given: agoWords(row.givenAt, at),
  }
  return {
    piece,
    facets: parent !== null && piece.from === parent.conversation ? parent.facets : null,
    toName: piece.fromName,
  }
}

/**
 * Show a held stand-in once at its predecessor’s position. If it is absent, show the predecessor
 * as replaced. Preserve the original cards until the forest has been read.
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

/** Index the work in this reading by the conversation holding it. */
export function workByConversation(forest: TheWholeForest | null): Map<string, WorkEdge[]> {
  const holders = new Map<string, WorkEdge[]>()
  for (const node of forest?.nodes.rows ?? []) {
    if (node.node !== 'a-task') continue
    const pieces = holders.get(node.work.to)
    if (pieces) pieces.push(node.work)
    else holders.set(node.work.to, [node.work])
  }
  return holders
}
