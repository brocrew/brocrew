import type {
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
} from '../../../shared/question-contracts'
import type { McpServerRequestForAPerson } from '../../../shared/conversation-events'
import { computed, reactive, ref, type ComputedRef, type Ref } from 'vue'
import { unreadSays } from './rows-unread'
import type { StalledWork } from '../../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../../shared/stopped-work'
import { clockTime } from '../../../shared/clock'
// ⚑ **F097 · the work whose agent answered a person, carried beside the rows and counted with them**
// — see {@link WaitingOnWhoWroteView} for why it is beside them and not one of them.
import type { WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
// ⚑ **D-017 · R19 · the asks against an identity's rules, carried beside the rows** — see
// {@link InstructionAsksView} for why they are beside them and not one of them.
import type { InstructionAskWaiting } from '../../../shared/own-instructions'
import type { AnswerAck } from '../../../shared/runtime-ipc'
import type { ProviderLimitSeen } from '../../../shared/provider-limit'
import type { LimitsDisplayState } from './limits-display'
import type { AttentionDecision, AttentionRequest } from './attention'
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
import type { UserInputResponse } from '../../../shared/runtime-ipc'
// ⚑ **UI-009 · a question this app asked is drawn and answered as `QuestionCard`** — see
// {@link PersonsQueueRow.question}.
import type { QueuePress } from './question-card'
import {
  namesakesIn,
  type Namesake,
  type PersonsQueueRow,
  type PersonsQueueWorld,
} from './persons-queue-rows'
import { type PersonsQueueView, personsQueueView } from './persons-queue-view'
import {
  type InstructionAsksView,
  type ProviderLimitsView,
  type StalledWorkView,
  type WaitingOnWhoWroteView,
  instructionAsksView,
  providerLimitsView,
  stalledWorkView,
  waitingOnWhoWroteView,
} from './persons-queue-beside'

export {
  byBlockedSince,
  KIND_WORDS,
  DID_WORDS,
  isAnApproval,
  namesakesIn,
  namesakeSays,
} from './persons-queue-rows'
export type {
  PersonsQueueDid,
  PersonsQueueHop,
  PersonsQueueKind,
  PersonsQueueRow,
  NoAnswerHere,
  PersonsQueueWorld,
} from './persons-queue-rows'
export { personsQueueView } from './persons-queue-view'
export type { PersonsQueueView } from './persons-queue-view'
export {
  providerLimitsView,
  stalledWorkLead,
  stalledWorkView,
  instructionAsksView,
  waitingOnWhoWroteView,
} from './persons-queue-beside'
export type {
  ProviderLimitsView,
  StalledWorkRow,
  InstructionAskRow,
  InstructionAsksView,
  WaitingOnWhoWroteRow,
  WaitingOnWhoWroteView,
} from './persons-queue-beside'

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

/** The press that opens a stopped piece's holder; the one that takes it back is `TAKE_BACK`. */
export const LOOK = 'Look'

/**
 * A piece whose holder stopped with it open, its giver told, as *Waiting on you* draws it: beside
 * the stalled band and for its reason, since nothing is frozen behind it and it is not counted.
 * Unlike that band it can be cleared here: a person looks at the holder, or hands the piece back.
 */
interface StoppedWorkRow {
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
type WorkPart = 'incidents' | 'recoveries'

/** One work card: a listed entry, or one a take-back from this window still speaks for. */
interface WorkCard {
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
interface StoppedWorkCard {
  readonly row: StoppedWorkRow
  /** The last look lists this stop, so it can be handed back. */
  readonly listed: boolean
  /** A hand-back of it is on its way. */
  readonly pending: boolean
  /** What its last hand-back answered, or `null`. */
  readonly said: string | null
}

/** The stopped pieces, with the stalled band's two holes. */
interface StoppedWorkView {
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
function eachStopOnce(
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
/** One stop of one piece: a piece can stop again after an earlier stop's hand-back. */
export function stopKey(row: StoppedWorkRow): string {
  return `${row.key}@${String(row.at)}`
}

/** Its one derivation: `null` is nobody has looked yet, not that nothing has stopped. */
function stoppedWorkView(
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

/** One agent's request to register an MCP server, as the person reads it on its card. */
interface McpServerRequestRow {
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
  /** When it was asked, epoch ms: where Waiting on you lists it, oldest first. */
  readonly at: number
  /** The conversation that asked, which its card opens. */
  readonly sessionId: string
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
interface McpServerRequestSettledHere {
  readonly row: McpServerRequestRow
  readonly said: string
}

/** How many settled cards a window keeps, newest first. */
const SETTLED_CARDS_KEPT = 10

/** The requests' one derivation. `null` is nobody has looked yet, not no agent is asking. */
function mcpServerRequestsView(
  walked: readonly McpServerRequestForAPerson[] | null,
  lastLookAnswered: boolean,
  nameOf: (slug: string) => string,
): McpServerRequestsView | null {
  if (walked === null && lastLookAnswered) return null
  return {
    rows: (walked ?? []).map(({ requested, askerCalled, at, conversation }) => {
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
        at,
        sessionId: conversation,
      }
    }),
    partial: walked === null,
    stale: !lastLookAnswered,
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

/**
 * 🔴 **D-017 · R19 · the corner's head — the queue's heading, widened by what is drawn beside it**:
 * the asks, and (F097) the work waiting on the person's reply.
 *
 * ⛔ **Without either it is {@link PersonsQueueView.heading}, word for word** — with one exception,
 * and it is `434`'s rule: over nothing, the all-clear *"Nothing is waiting on you"* may not stand
 * while the look for either has not answered whole, so that list's own hole is said instead.
 *
 * With more than one kind waiting, the head is the page's own title, *Waiting on you*, and the
 * count beside it says how many: a sentence naming every kind wrapped to eight lines in the narrow
 * corner before any item showed. ⚠️ `null` where there is nothing the head may say: no queue look
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
  return { heading: 'Waiting on you', count }
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
  /** The rows whose asker reads the same name as another conversation's, over the whole look. */
  readonly namesakes: ComputedRef<ReadonlyMap<string, Namesake>>
  /**
   * Whether the screen's first look has come back, answered or not (`PersonsQueueWorld.looked`).
   * Before it, every list is still loading; after it, a list with nothing in it is empty or could
   * not be read.
   */
  readonly looked: ComputedRef<boolean>
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
  const looked = ref(false)
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

  const beginPress = <Pending extends { press: number }, Result>(
    pending: Map<string, Pending>,
    results: Map<string, Result>,
    key: string,
    value: Pending,
  ) => {
    pending.set(key, value)
    results.delete(key)
    const stillMine = (): boolean => pending.get(key)?.press === value.press
    const finish = (): void => {
      if (stillMine()) pending.delete(key)
    }
    return { stillMine, finish }
  }

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
    looked: computed(() => looked.value),
    namesakes: computed(() => namesakesIn(view.value?.rows ?? [])),
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
      const { stillMine, finish } = beginPress(handingBack, handedBack, key, { row, press })
      void door(row.label)
        .then((said) => {
          if (stillMine()) handedBack.set(key, { row, said })
        })
        .finally(finish)
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
      const { stillMine, finish } = beginPress(answeringTodo, todoSaid, row.key, {
        row,
        press,
      })
      void door(row.sessionId, row.key, done, note.trim())
        .then((refused) => {
          if (!stillMine()) return
          todoSaid.set(row.key, {
            row,
            said: refused ?? todoAnsweredSays(row.askedByName, done),
            taken: refused === null,
          })
        })
        .finally(finish)
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
      const { stillMine, finish } = beginPress(takingEntry, entrySaid, key, { entry, press })
      void door(entry.label)
        .then((said) => {
          if (stillMine()) entrySaid.set(key, { entry, said })
        })
        .finally(finish)
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
      looked.value = nextWorld.looked !== false
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
      looked.value = false
      doors = null
    },
  }
}

/** The window's one person's queue. */
const shared = createPersonsQueue()

export function usePersonsQueue(): PersonsQueue {
  return shared
}
