import type { Told } from '../message-records'
import type { SendRecipientState } from '../../../shared/tool-outcome'
import type {
  ProviderFailureReconciliationEvent,
  WorkRecoveryEvent,
  WorkReconciliationEvent,
} from '../../../shared/reconciliation-contracts'
import { type Provider } from '@brobot2/shared'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import {
  AStartThatDidNotHappen,
  describeUnavailable,
  unavailableContextOf,
  unavailableOf,
  type Unavailable,
} from '../session-unavailable'
import { type QueueOutcome } from '../../../shared/runtime-ipc'
import type {
  MessageSentEvent,
  ReplyUndeliveredEvent,
  UserDecisionEvent,
  QueuedMessageEvent,
  UnqueuedMessageEvent,
  RestoredFromTheArchiveEvent,
} from '../../../shared/conversation-events'
import type {
  QuestionRecipientEndedEvent,
  QuestionEndedWithItsPieceEvent,
} from '../../../shared/question-contracts'
import type {
  WorkTakenBackEvent,
  WorkRetitledEvent,
  WorkStatusSetEvent,
  WorkRebriefedEvent,
  WorkClosedEvent,
  WorkSentEvent,
} from '../../../shared/task-contracts'
import { aWakeThatDidNotHappen } from '../agent-tools'
import type { RoutedRequest } from '../../../shared/question-contracts'
import { type AppNotice } from '../../../shared/app-notice'
import type { QueuedMessage } from '../queued-message'
import { type HostedSession } from './hosted-session'

/** Why held words are ended unsent once the piece they carried, or reached through, has ended. */
const ITS_PIECE_HAD_ENDED = {
  reason: 'abandoned',
  detail: 'the piece it carried had already ended',
} as const

/**
 * App notices that never start a turn of their own: each is recorded at once and rides the
 * conversation's next ordinary input (§8: who ended, stopped or compacted its work, and why).
 */
const NOTICES_FOR_ITS_NEXT_INPUT: ReadonlySet<AppNotice> = new Set<AppNotice>([
  'a-conversation-was-compacted',
  'a-queued-message-was-cancelled',
  'a-piece-closed',
  'a-piece-a-person-closed',
  'a-piece-taken-back',
  'a-piece-a-person-took-back',
  'a-piece-it-gave-closed',
  'a-piece-it-gave-a-person-closed',
  'a-piece-it-gave-taken-back',
  'a-piece-it-gave-a-person-took-back',
])

function isANoticeForItsNextInput(message: Pick<QueuedMessage, 'authorship'>): boolean {
  const notice = message.authorship.appNotice
  return notice !== undefined && NOTICES_FOR_ITS_NEXT_INPUT.has(notice)
}

/**
 * Whether held words drive a turn of their own. A notice for the next input does not, and neither
 * does a new brief: it waits in the mailbox and goes with the next ordinary input.
 */
function isRunnableHeldMessage(message: Pick<QueuedMessage, 'authorship' | 'rebrief'>): boolean {
  return !isANoticeForItsNextInput(message) && message.rebrief !== true
}

/** Whether anything held in its mailbox would drive a turn. */
function somethingRunnableIsHeld(session: Pick<HostedSession, 'mailbox'>): boolean {
  return session.mailbox.some(isRunnableHeldMessage)
}

/** A work-wait reminder can carry held notices that do not require ordinary input. */
function noticesThatRideThisInput(
  held: readonly QueuedMessage[],
  inputs: readonly Pick<QueuedMessage['authorship'], 'appNotice'>[],
): QueuedMessage[] {
  if (inputs.some((input) => input.appNotice === undefined)) return held.slice()
  if (!inputs.some((input) => input.appNotice === 'a-work-wait-needs-attention')) return []
  return held.filter((notice) => notice.authorship.appNotice !== 'a-queued-message-was-cancelled')
}

/** Who a compaction a person asked for says it came from: nobody is told. */
const A_PERSON_ASKED = 'a-person'

/** The reason a notice says when its sender gave none. */
const NO_REASON_GIVEN = 'no reason given'

/** The reason slot of a notice: the reason given, or {@link NO_REASON_GIVEN}. */
function reasonSaid(reason: string | undefined): string {
  const given = aReasonGiven(reason)
  return given === null ? `Reason: ${NO_REASON_GIVEN}.` : `Reason: ${given}`
}

/** A reason as given, or `null` for none or only blanks. */
function aReasonGiven(reason: string | undefined): string | null {
  const trimmed = reason?.trim()
  return trimmed === undefined || trimmed === '' ? null : trimmed
}

/**
 * **What the host owns for one session id, from BEFORE the provider is asked for it** (062, from
 * 061 finding 2).
 *
 * Ownership used to begin when `start()` or `resume()` RESOLVED. In between — an external process
 * spawn, the slowest thing this app does — the provider existed and the host knew nothing about it.
 * `closeAll()` and the window's owner cleanup both walk the map, so a quit landing in that window
 * missed the provider entirely; the handle then arrived, registered into a host that was already
 * down, and wrote its first ledger row against a closed database and a dead renderer sink.
 * `resumeSession` was worse: it checked `sessions.has()`, awaited a spawn, and registered with a
 * blind `set`, so two resumes of the same record both passed the check, both spawned, one
 * overwrote the other in the map, and either one's finalizer would unregister the survivor.
 *
 * The slot is reserved FIRST, synchronously, and the three phases are what the interval needs:
 *
 *  - **`starting`** — reserved, nothing registered. The id is taken, so a second resume of the same
 *    record is refused before it can spawn anything.
 *  - **`live`** — the handle arrived and was claimed. This is the only phase with a `session`.
 *  - **`closing`** — somebody asked for this session to go away while it was still starting. The
 *    arriving handle is closed and handed straight back instead of being registered.
 *
 * ⚠️ **The `closing` check and `register` must stay in one synchronous block.** An `await` between
 * them re-opens the exact race this replaces: a close could mark the slot after the check and then
 * wait on {@link SessionSlot.arrived}, while the start registered a session nothing would ever
 * close.
 */
/**
 * 🔴 **What one agent may be told about another** (347) — the shape `list_agents` and
 * `get_agent_status` answer with.
 *
 * ⛔ **Assembled from three sources on purpose, and each answers a different question.** The SLOT
 * knows what is live in this process, the LEDGER knows what was recorded (including provenance,
 * which is the half that survives a restart — criterion 8), and the HANDLE knows what the
 * conversation is doing right now. A card built from any one of them alone would be wrong in a way
 * that reads as true: the slot cannot say where a session came from, the ledger cannot say whether
 * it is thinking, and the handle does not exist until the provider has arrived.
 *
 * ⚠️ **Every field that can be unknown is `| null` rather than omitted**, because an absent key and
 * a null one read identically to a model and only one of them is a fact. `074`'s rule — absence is
 * not an outcome — at the width of a tool result.
 */
/**
 * ⚑ **Why words about a piece went to nobody when its holder could never be reopened** — the
 * conversation in its place never held the piece, so they are not sent to it.
 */
const ITS_PLACE_WAS_TAKEN =
  'The conversation that held it could never be reopened, and the one that took its place never held it.'

/**
 * ⚑ **Words about a piece that reached the conversation in its holder's place** — found only as the
 * tell starts the holder, so the words are refused there ({@link RuntimeHost.toItsHolderAlone}).
 */
class ItsPlaceWasTaken extends Error {
  constructor(to: string, holder: string, label: string) {
    super(`${to} took the place of ${holder}, which holds ${label}`)
  }
}

/**
 * ⚑ **A tell that failed**, said in words: its holder replaced, wherever in the cause chain that was
 * found, else {@link whyItWasNotDelivered}.
 */
function notTold(error: unknown): Told {
  let seen: unknown = error
  for (let depth = 0; depth < 8 && seen instanceof Error; depth += 1) {
    if (seen instanceof ItsPlaceWasTaken) {
      return { delivery: 'not-delivered', whyNotTold: ITS_PLACE_WAS_TAKEN }
    }
    seen = (seen as { cause?: unknown }).cause
  }
  return { delivery: 'not-delivered', whyNotTold: whyItWasNotDelivered(error) }
}

/**
 * ⚑ **D-022 · R3** — a tell's delivery in the verbs' words; `null`: another conversation took its
 * place.
 */
function deliveryOf(delivered: QueueOutcome | null): Told {
  return delivered === null
    ? { delivery: 'not-delivered', whyNotTold: ITS_PLACE_WAS_TAKEN }
    : { delivery: delivered.outcome === 'sent' ? 'sent' : 'held' }
}

/** No piece a conversation gave has stopped: what `RuntimeHost.whoOwesIt` leaves out by default. */
const NO_PIECE_STOPPED: ReadonlySet<string> = new Set()

/**
 * ⚑ **F036 · one question a conversation owes an answer to** — its routing, and ⚑ **F033** the
 * piece its asker asked it under (`RaisedQuestion.piece`), or `null`: what names that asker on the
 * line that says it waits.
 */
interface OwedQuestion extends RoutedRequest {
  readonly piece: string | null
}

/**
 * ⚑ **F036 · the questions a conversation owes an answer to, by the conversation asked about** —
 * see `RuntimeHost.oneOwedReadPerAnswer`. ⚠️ Read from the ASKERS' ledgers, as {@link WorkOutOf}
 * is read from the holders': other rows move it.
 */
type OwedBy = (id: string) => readonly OwedQuestion[]

/** ⚑ **D-017 · R11 · R19** — see `RuntimeHost.whoOwesIt`. */
interface WhoOwesIt {
  /** A person's answer is waiting in it. */
  readonly needsYou: boolean
  /** The conversation a question it asked went to, as it stands now, or `null`. */
  readonly askedOf: string | null
  /** What to call {@link askedOf}, or `null`. */
  readonly waitingOnTheAnswerOf: string | null
  /** When it asked the question {@link askedOf} owes it, epoch ms, or `null`. */
  readonly waitingOnTheAnswerSince: number | null
  /**
   * ⚑ **D-036 · the conversations holding open work it gave**, each once, in the order of its
   * oldest open give.
   */
  readonly workIsWith: readonly string[]
  /** ⚑ **D-036** — what to call each of {@link workIsWith}, as {@link waitingOnTheAnswerOf} is. */
  readonly waitingOnTheWorkOf: readonly string[]
  /** When it gave out the oldest of that open work, epoch ms, or `null`. */
  readonly waitingOnTheWorkSince: number | null
  /**
   * ⚑ **F036 · the conversations that asked it a question it still owes an answer to**, as they
   * asked (the ledger each question is in), each once, in the order of its oldest such question.
   */
  readonly owedTo: readonly string[]
  /** ⚑ **F036** — what to call each of {@link owedTo}, as it stands now, named as above. */
  readonly owesAnAnswerTo: readonly string[]
  /** When the oldest question it owes an answer to was put to it, epoch ms, or `null`. */
  readonly owesAnAnswerSince: number | null
  readonly owedQuestions: readonly OwedQuestion[]
}

/**
 * ⚑ **D-017 · the rows {@link RuntimeHost.writeIntoItsLedger} writes into a conversation whatever
 * state it is in.**
 */
type IntoItsLedger =
  | WorkReconciliationEvent
  | ProviderFailureReconciliationEvent
  | WorkRecoveryEvent
  | ReplyUndeliveredEvent
  | UserDecisionEvent
  | WorkTakenBackEvent
  // ⚑ **D-016 · `update_work`'s rows** — a piece's title, status line, new brief and close, written
  // into its OWNER's ledger whatever state that conversation is in ({@link RuntimeHost.updateWork}).
  | WorkRetitledEvent
  | WorkStatusSetEvent
  | WorkRebriefedEvent
  | WorkClosedEvent
  // ⚑ **D-047** — what a conversation gave, in its own ledger: a call can answer inside its stop.
  | WorkSentEvent
  | MessageSentEvent
  | UnqueuedMessageEvent
  // ⚑ **D-017 · R1** — a message held for a conversation's next start ({@link
  // RuntimeHost.holdUntilItStarts}).
  | QueuedMessageEvent
  // A question whose recipient was deleted ends in its asker's ledger, whatever state that is in.
  | QuestionRecipientEndedEvent
  // A question passed up ends in the ledger that passed it up when its piece ends.
  | QuestionEndedWithItsPieceEvent
  // An agent's restore says so in each conversation it brought back, before any of them starts.
  | RestoredFromTheArchiveEvent

/**
 * ⚑ **D-016 · the held messages that carry one piece, where each waits** —
 * {@link RuntimeHost.theHeldMessagesCarrying}'s answer, which a take-back and a close refuse on and
 * then take back.
 */
interface TheHeldMessagesCarrying {
  /** The running conversation holding the piece, or `null` when this app is not running it. */
  readonly session: HostedSession | null
  /** In its mailbox, where a turn's end sends them. */
  readonly inTheMailbox: readonly QueuedMessage[]
  /** What a stop in flight handed on to its next start. */
  readonly handedOn: readonly QueuedMessage[]
  /** For a conversation this app is not running: the ids of what waits for its next start. */
  readonly waiting: readonly string[]
}

/**
 * ⚑ **D-017 · R1 — the conversation a queue-door delivery went straight into stopped under it
 * before its words were handed over** — {@link RuntimeHost.queueAs} catches it and starts the
 * conversation again for them. ⛔ Never reaches a caller.
 */
class ItStoppedUnderTheDelivery extends Error {
  constructor() {
    super('the conversation stopped before these words were handed over')
  }
}

/**
 * ⚑ **D-022 · R2 — the piece a new brief was on its way to had ended when the words reached its
 * holder** — {@link RuntimeHost.tellItsOwnerItsNewBrief} catches it. ⛔ Never reaches a caller.
 */
class ItEndedBeforeItsNewBrief extends Error {
  constructor() {
    super('the piece had ended before its new brief reached the conversation holding it')
  }
}

/**
 * ⚑ **D-017 · R3 — what a giver still holds, as the 703 take-back reads it**: a running one's
 * session, or — for one on its way out or stopped — what waits for its next start.
 */
type WhatAGiverHolds = Pick<HostedSession, 'mailbox' | 'handingOver'>

type AnswerDelivery = { readonly to: string; readonly taskLabel: string | null } & (
  | { readonly kind: 'sent' }
  | { readonly kind: 'held'; readonly queueId: string }
  | Extract<SendRecipientState, { kind: 'cannot-run' }>
)

/**
 * ⚑ **D-030 — what became of a reply's words**: one that landed in a turn or a mailbox has nothing
 * to explain; one kept for its giver's next start, or that reached nobody, says why.
 */
type WhereAReplyWent = { readonly to: string } & (
  | { readonly delivered: 'sent'; readonly why: null }
  | { readonly delivered: 'held'; readonly why: null; readonly queueId?: string }
  | {
      readonly delivered: 'kept' | 'not-delivered'
      readonly why: string
      readonly state: Extract<SendRecipientState, { kind: 'cannot-run' }>
    }
)

/**
 * ⚑ **D-030 — where words held for a conversation wait** ({@link RuntimeHost.holdUntilItStarts}):
 * its mailbox, for a turn of this life; its ledger, for its next start; or nowhere — its record
 * would not take them, and nothing else holds them for that start.
 */
type WhereHeldWordsWait = 'its-mailbox' | 'its-ledger' | 'nowhere'

/**
 * ⚑ **D-030 · the refusals {@link whyItWasNotDelivered} reads down the cause chain**, each said in
 * this app's own words: a quit, a close or a Cancel while it opened, a wait for its provider that
 * ran out, its last session still being put away. ⛔ Not
 * `nothing-names-a-model`: its sentence can quote its provider's own diagnostic, and a model reads
 * this (D-039). ⛔ Nor `still-opening`: a delivery's start meets it only from another start that
 * took the reservation first, and passes it on only once that start failed or is being closed
 * ({@link RuntimeHost.startForADelivery}) — so *it opens by itself* would be false.
 */
const REFUSALS_IN_THIS_APPS_OWN_WORDS: ReadonlySet<Unavailable> = new Set<Unavailable>([
  'its-session-is-gone',
  'shutting-down',
  'cancelled',
  'lost-its-place',
  'took-too-long',
  'still-closing',
  'not-confirmed-stopped',
])

/**
 * ⚑ **D-017 · R14 — why a delivery that starts its recipient did not happen, in words a person or a
 * model reads.** ⛔ Never the diagnostic — it names ids and paths, and it goes to the log.
 *
 * ⚑ A refusal that knows its reason says it ({@link describeUnavailable}, as a reopen's); a failure
 * the wake classifier knows ({@link aWakeThatDidNotHappen}) is said in a clause of its own, with no
 * remedy — the reader may be a model whose only act left is the one that failed. ⚑ **D-030 · and a
 * refusal down the cause chain** says it too, in this app's own words
 * ({@link REFUSALS_IN_THIS_APPS_OWN_WORDS}). ⚠️ Anything else is one fixed sentence, true of a giver
 * that runs and of one that does not.
 */
function whyItWasNotDelivered(error: unknown): string {
  const cause = error instanceof AStartThatDidNotHappen ? error.cause : error
  const reason = unavailableOf(cause)
  if (reason !== null) {
    return describeUnavailable(reason, { ...unavailableContextOf(cause), reopening: true })
  }
  const unwoken = aWakeThatDidNotHappen(cause)
  if (unwoken?.rail === 'that-conversation-could-not-be-woken-just-now') {
    return describeUnavailable('machine-ran-short', { reopening: true, shortage: unwoken.because })
  }
  if (unwoken?.what === 'program') {
    return 'This conversation did not start: this machine could not run its provider’s program — it may be missing or not runnable.'
  }
  if (unwoken?.what === 'folder') {
    return 'This conversation did not start: BroCrew could not make or write a folder it needs.'
  }
  if (unwoken?.what === 'no-sign-in-to-copy') {
    return 'This conversation did not start: there is no Codex sign-in for that agent to start on.'
  }
  if (unwoken?.what === 'gone-folder') {
    return 'This conversation did not start: the folder it ran in is no longer there.'
  }
  // 🔴 **D-039 · R2 — its provider refused the start** (F055): until D-039 the arm below said it,
  // guessing at a sign-in or a lost conversation and naming neither. ⛔ **Never in the provider's
  // words**: a model reads this, and they can name a path in its home (`A_PROVIDER_REFUSED_THE_START`).
  if (unwoken?.what === 'provider-refused') {
    return 'This conversation did not start: its provider refused to start it.'
  }
  if (unwoken?.provider !== undefined && unwoken.what === 'sign-in') {
    return `This conversation did not start: its ${PROVIDER_NAME[unwoken.provider]} sign-in could not be used.`
  }
  if (unwoken?.provider !== undefined && unwoken.what === 'settings') {
    return `This conversation did not start: the ${PROVIDER_NAME[unwoken.provider]} settings in its profile could not be used.`
  }
  if (unwoken?.rail === 'that-conversation-could-not-be-resumed') {
    return 'This conversation did not start: its provider could not bring it back — it may need signing in again, or may no longer have it.'
  }
  // ⚑ **D-030 · the refusal a reopen met, read down the cause chain** as {@link itCanNeverBeReopened}
  // reads it: it reaches here wrapped in its person-read sentence
  // ({@link RuntimeHost.refusalTranslated}), so the first arm never sees it. ⚑ The outermost refusal
  // decides, and one not in {@link REFUSALS_IN_THIS_APPS_OWN_WORDS} is the fixed sentence below.
  let seen: unknown = cause
  for (let depth = 0; depth < 8 && seen instanceof Error; depth += 1) {
    const refused = unavailableOf(seen)
    if (refused !== null) {
      if (!REFUSALS_IN_THIS_APPS_OWN_WORDS.has(refused)) break
      return describeUnavailable(refused, { ...unavailableContextOf(seen), reopening: true })
    }
    seen = (seen as { cause?: unknown }).cause
  }
  return 'This conversation could not be reached just now, for a reason BroCrew records only in its log.'
}

/**
 * ⚑ **D-030 · why a reply's words could not even be kept** — its giver's record would not take them,
 * so nothing holds them for its next start. ⛔ The store's own message goes to the log.
 */
const ITS_RECORD_WOULD_NOT_TAKE_IT = 'BroCrew could not write it into that conversation’s record.'

/**
 * ⚑ **D-017 · R1 — what whoever answered is told when the answer is kept for its asker's next
 * start**: that it is recorded and kept, where it goes, and why it did not go now. ⚑ The asker is
 * named once, by the piece it owns (D-016 · commit 7 · R3), and then called *that conversation*.
 */
function anAnswerKeptForItsStart(asker: string, why: string): string {
  return `The answer is recorded and kept for ${asker}: it goes to that conversation first when it next starts, or later if its provider’s usage limit holds then. It could not be started now — ${why}`
}

/** ⚑ **D-017 · R6** — {@link RuntimeHost.answeredInThisRun}'s key: a request id is the asker's own. */
function aQuestionKey(askedBy: string, requestId: string): string {
  return `${askedBy}\u0000${requestId}`
}

/**
 * ⚑ **D-017 · R2 — a conversation this app is not running, described as the start a delivery would
 * give it** — see {@link RuntimeHost.startable}, its one maker.
 *
 * ⚑ **`ownerId` and `commandedBy` are the two fields {@link mayCommand} reads**, spelled exactly as
 * {@link RuntimeHost.resumeSession} would reserve them for a start with no window.
 */
interface Startable {
  readonly id: string
  readonly ownerId: null
  readonly commandedBy: string | null
  /** The conversation that started it — `null` for a person's conversation (D-016: the parent alone). */
  readonly parent: string | null
  readonly profileId: string | null
  readonly provider: Provider
}

/**
 * ⚑ **690 · the two ways a held message is TAKEN BACK** — {@link RuntimeHost}'s `takeQueuedBack`.
 * ⛔ `cancelled` is a person's or an agent's own act; `retracted` is this app's, and carries the
 * sentence saying what made its own notice false (R32).
 */
type HowItWasTakenBack =
  { readonly reason: 'cancelled' } | { readonly reason: 'retracted'; readonly detail: string }

export {
  A_PERSON_ASKED,
  anAnswerKeptForItsStart,
  type AnswerDelivery,
  aQuestionKey,
  aReasonGiven,
  deliveryOf,
  type HowItWasTakenBack,
  type IntoItsLedger,
  isANoticeForItsNextInput,
  isRunnableHeldMessage,
  ItEndedBeforeItsNewBrief,
  ITS_PIECE_HAD_ENDED,
  ITS_RECORD_WOULD_NOT_TAKE_IT,
  ItsPlaceWasTaken,
  ItStoppedUnderTheDelivery,
  NO_PIECE_STOPPED,
  NO_REASON_GIVEN,
  noticesThatRideThisInput,
  notTold,
  type OwedBy,
  type OwedQuestion,
  reasonSaid,
  somethingRunnableIsHeld,
  type Startable,
  type TheHeldMessagesCarrying,
  type WhatAGiverHolds,
  type WhereAReplyWent,
  type WhereHeldWordsWait,
  type WhoOwesIt,
  whyItWasNotDelivered,
}
