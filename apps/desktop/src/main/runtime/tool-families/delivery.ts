import { type EndedPieceDetail } from '../work-records'
import {
  type NewBriefDelivery,
  type OutOfReach,
  type TellDelivery,
  type TheStopAMessageGot,
  type Told,
} from '../message-records'
import { type TakeBackRefused } from '../host-split/host-command-contracts'
import { ASKED_TO_STOP, type WhereAnAskLanded } from '../../../shared/how-work-stopped'
import { AStartThatDidNotHappen, SessionStillStarting, unavailableOf } from '../session-unavailable'
import { type AgentToolAnswer } from '@brobot2/runtime'
import { PROVIDER_DESCRIPTORS, type Provider, providerDescriptor } from '@brobot2/shared'
import { type ReplyOutcome, theStoppedWork } from '../reply-rails'
import { TOOL_SENTENCES, refuseTool } from './refusals'
import { type ToolName } from './catalog'
import { type WhenItWasAskedToStop } from '../agent-tool-answer-words'
import { aWakeRefused, aWakeThatDidNotHappen } from './launch-failures'
import { refusalAnswer } from './answers'
import { clockTimeFrom } from '../../../shared/clock'
import { didIt } from '../../../shared/who-did-it'
import { conversationLine } from '../conversation-address'

/** Where the last ask to stop landed, as the sentence that says it names the three. */
export const WHEN_THE_ASK_LANDED: Readonly<
  Record<Exclude<WhereAnAskLanded, 'the-turn-that-ended-last'>, WhenItWasAskedToStop>
> = {
  'no-turn-was-running': 'no-turn-running',
  'a-turn-that-ended-earlier': 'an-earlier-turn',
  'a-turn-that-is-running-now': 'the-turn-running-now',
}

/**
 * **F059 · `update_work` on a piece that has ended, said with how, when and by whom** — the facts
 * `reply_to_parent`'s refusal has said since D-025 (`endedPieceSentence`), off the row that ended it.
 *
 * **The act first, inside the cut, and the act THIS caller has**: its owner, which may not name a
 * piece a conversation gave it, stops work on it, `reply_to_parent`'s act; a giver told its piece
 * was answered reads the answer rather than wondering why its call did nothing; and whoever may
 * still name it is told that is all it may do. **Each fact only where the detail carries it**, and
 * the caller's own act said as its own: never its own name.
 */
export function anEndedPieceSaid(detail: EndedPieceDetail, readAt: number): string {
  const when = detail.at === undefined ? '' : ` at ${clockTimeFrom(detail.at, readAt)}`
  const actor = detail.nextSteps?.actor
  const nonConversation = actor !== undefined && actor.who !== 'an-agent'
  const called = nonConversation ? didIt(actor) : detail.called
  const by = called === undefined ? '' : ` by ${called}`
  const yours = !nonConversation && detail.endedByYou === true
  const { label } = detail
  let ended: string
  switch (detail.state) {
    case 'answered':
      ended = yours ? `You answered ${label}${when}` : `${label} was answered${by}${when}`
      break
    case 'closed':
      ended = yours ? `You closed ${label}${when}` : `${label} was closed${by}${when}`
      break
    case 'withdrawn':
      ended = yours ? `You took ${label} back${when}` : `${label} was taken back${by}${when}`
      break
    default:
      return TOOL_SENTENCES['that-piece-has-ended']
  }
  if (detail.nextSteps !== undefined) {
    const { title, outcome, address, heldTasks, heldByCaller } = detail.nextSteps
    const stop = heldByCaller ? ' Stop work on it; no further reply is owed.' : ''
    const retitle = detail.yoursToRetitle ? ' Only its title can still change.' : ''
    const note =
      heldTasks.length === 0
        ? ''
        : ` To note something, set the status of a task you hold: ${heldTasks.join(', ')}.`
    const ending = when === '' && by === '' && !yours ? '' : ` ${ended}.`
    const continuation =
      actor?.who === 'a-person'
        ? ' Leave it to the person, or ask them before continuing.'
        : address === null
          ? ''
          : ` To have more done, give_work with to: ${address}.`
    return `Not changed: task ${detail.label} · ${title} has ended (${outcome ?? detail.state}) and keeps that outcome.${ending}${stop}${retitle}${note}${continuation}`
  }
  const act = !detail.yoursToRetitle
    ? 'stop work on that piece; no further reply is owed.'
    : detail.state === 'answered' && !yours
      ? `read its answer with list_tasks, naming ${label}; only its title may still be changed.`
      : 'only its title may still be changed.'
  return `${act} ${ended}, so nothing was changed.`
}

export function aTaskChoiceSaid(names: readonly string[], count: number): string {
  if (names.length === 0) return 'Name the task in piece. Nothing was changed.'
  const remaining = count - names.length
  const more = remaining === 0 ? '' : ` and ${String(remaining)} more (list_tasks)`
  return `Name the task in piece. You hold ${String(count)}: ${names.join(', ')}${more}. Nothing was changed.`
}

/** `that-piece-is-still-queued`'s sentence, naming the piece by its label. */
export function aMessageAboutAQueuedPiece(label: string): string {
  return `Not sent: ${label} is still queued. Change its brief with update_work.`
}

/**
 * **The facts a take-back refusal states, per rail** (429).
 *
 * **A switch over a discriminated union rather than one bag built at the door**, so the arm that
 * has no label cannot be given one and the arm that has no resources cannot grow a key for them.
 * **Absent, never null**, for `WorkGivenEvent.messageId`'s reason: a model reads *there was none*
 * as the absence it is, and a sentinel would be a second spelling of it.
 */
export function takeBackDetail(
  piece: string,
  refused: TakeBackRefused,
): Readonly<Record<string, unknown>> {
  switch (refused.rail) {
    case 'no-piece-by-that-name':
      return { piece }
    case 'that-piece-was-already-answered':
      return {
        ...refused.ended,
        piece,
        ...(refused.outcome === null ? {} : { answered: refused.outcome }),
        ...(refused.resources.length === 0 ? {} : { resources: refused.resources }),
      }
    case 'that-piece-was-already-taken-back':
    case 'that-piece-was-already-closed':
      return { ...refused.ended, piece }
    case 'that-is-your-own-work':
    case 'that-work-is-being-sent':
    case 'that-conversation-has-not-started':
    case 'a-conversation-with-its-questions-is-starting':
      return { piece, label: refused.label }
    case 'its-questions-could-not-all-be-read':
      return { piece, label: refused.label, unreadQuestion: refused.unreadQuestion }
    default: {
      const exhaustive: never = refused
      void exhaustive
      return { piece }
    }
  }
}

/**
 * **591 · the questions a take-back or a close ended, said only when it happened** — a clause
 * reading *and it ended 0 questions* on every ordinary one is a sentence about nothing.
 */
export function theQuestionsItEnded(endedQuestions: number): string {
  return endedQuestions === 0
    ? ''
    : `. ${String(endedQuestions)} question${
        endedQuestions === 1
          ? ' it had asked about that work has'
          : 's it had asked about that work have'
      } ended with it, so answering ${endedQuestions === 1 ? 'it' : 'them'} now is refused`
}

/**
 * **D-027 · how a held message goes out, in the verbs' words** — with whatever else is held for
 * that conversation, oldest first. **Except a person's command, which goes alone**
 * (`RuntimeHost.theTurnItTakes`, `R42`): a sentence that promised *one turn with everything held*
 * would be false whenever one is held — and so would *until its turn ends*, one turn early. So
 * the sentences that use this say *until it is free*.
 */
const WITH_WHATEVER_ELSE_IS_HELD =
  'with whatever else is held for it, oldest first (a person\u2019s command goes on its own)'

/**
 * **D-022 · R3 — what reached the holder of a piece**, in the words `withdraw_task` and
 * `update_work` share: *told* only for `sent`; `held` says it waits until the holder is free, then
 * goes {@link WITH_WHATEVER_ELSE_IS_HELD} — and, for a take-back or a close, that `interrupt_agent`
 * asks the turn the holder is running now to stop. A new brief's own two: it rides the piece's
 * give that still waits, or the piece had ended when it reached the holder. See
 * `TakeBackOutcome.delivery` and `UpdateWorkOutcome.delivery`.
 */
export function whatReachedItsHolder(
  owner: string,
  label: string,
  told: Told<NewBriefDelivery>,
  /**
   * `a-stop-asked`: a take-back whose holder's turn is not the caller's to stop — asked already,
   * or a service's — so no stop is offered.
   */
  what: 'a-stop' | 'a-stop-asked' | 'a-new-brief' | 'its-inputs',
  /**
   * Why what is held waits for more than the holder's turn, when it does — said IN PLACE of
   * *until it is free*.
   */
  waits: string | null,
): string {
  const untilItIsFree = waits === null ? ` until ${owner} is free` : ''
  const withTheRest = `then goes out ${WITH_WHATEVER_ELSE_IS_HELD}`
  switch (told.delivery) {
    case 'sent':
      return `${owner} has been told.`
    case 'held':
      if (waits !== null) {
        return what === 'a-new-brief'
          ? `${owner} is not told yet: the new brief is held. ${waits}`
          : `${owner} is not told yet: it is held. ${waits}`
      }
      return what === 'a-stop'
        ? `${owner} is not told yet: it is held${untilItIsFree}, ${withTheRest} — interrupt_agent asks the turn ${owner} is running now to stop.`
        : what === 'a-new-brief'
          ? `${owner} is not told yet: the new brief is held${untilItIsFree}, ${withTheRest}.`
          : `${owner} is not told yet: it is held${untilItIsFree}, ${withTheRest}.`
    case 'with-its-give':
      return `${owner} is not told yet: the give of ${label} is still held${untilItIsFree}, and the new brief goes out with it, in place of the first.${
        waits === null ? '' : ` ${waits}`
      }`
    case 'after-it-ended':
      return `${label} had ended before its new brief reached ${owner}, so the new brief was not sent: any answer to it is to the brief before.`
    case 'not-delivered':
      return `${owner} could not be told. ${told.whyNotTold}`
  }
}

/**
 * Where a reply went, using the actual recipient from its receipt when available.
 * `sent` and `held` use `give_work`'s words;
 * `kept` in the words D-030 ruled; `not-delivered` says why, where the answer stays
 * ({@link PieceRow.answerReachedNobody}) and what to do, since nothing tells the giver to look.
 * **D-017 · R10 — and a giver that could never be reopened is said**, in `give_work`'s words, for
 * every answer whose words went to the one in its place.
 */
export function whereTheReplyWent(
  replied: Extract<ReplyOutcome, { readonly giver: string }>,
): string {
  const { label } = replied
  const recipient = replied.receipt?.recipient
  const giver =
    recipient === undefined ? replied.giver : conversationLine(recipient.address, recipient.title)
  const inItsPlace = replied.tookItsPlace
    ? ` The conversation that gave ${label} could never be reopened, so your answer went to the conversation that took its place.`
    : ''
  switch (replied.delivered) {
    case 'sent':
      return `it went to ${giver} straight away.${inItsPlace}`
    case 'held':
      // Held for the giver's reopen on the current sign-in, it says why in place of *until it is
      // free*.
      return replied.why === undefined
        ? `it is held until ${giver} is free, then goes out ${WITH_WHATEVER_ELSE_IS_HELD}.${inItsPlace}`
        : `it is held for ${giver}. ${replied.why}${inItsPlace}`
    case 'kept':
      // **W4.172 · F095** — what is kept for a start waits there for a usage limit, as any word
      // this app or an agent holds for it does.
      return `kept on ${label}; ${giver} gets it when it next starts, or later if its provider’s usage limit holds then.${inItsPlace}`
    case 'not-delivered':
      return `${giver} could not be told: ${replied.why} Your answer stays on ${label}, where ${giver} can read it with list_tasks, but nothing will tell it to look: tell the person here.`
  }
}

/**
 * **D-022 · R3 — a new brief's own two words, as the payload's `delivery`**: a brief riding a
 * held give is held; one not sent was not delivered.
 */
export const AS_A_DELIVERY: Readonly<Record<NewBriefDelivery, TellDelivery>> = {
  sent: 'sent',
  held: 'held',
  'not-delivered': 'not-delivered',
  'with-its-give': 'held',
  'after-it-ended': 'not-delivered',
}

/**
 * **F084 · what a stop that makes way for words ends, on the receiver's provider** — said when its
 * turn had not ended within the wait, so what it did end is not known yet.
 */
export function theRuleOfAStopForWords(provider: Provider | undefined, called: string): string {
  if (provider === undefined) {
    return (
      PROVIDER_DESCRIPTORS.map(
        (descriptor, index) =>
          `${index === 0 ? 'On' : 'on'} ${descriptor.displayName}, ${descriptor.words.interruptSummary}`,
      ).join('; ') + '.'
    )
  }
  const words = providerDescriptor(provider).words.stopForWords
  return `${words.beforeName}${called}${words.afterName}`
}

/**
 * What a receipt says about the stop an interrupting message asked for, and the fields that say it.
 * **F084** — once the stopped turn has ended, what its stop ended and what still runs, named.
 */
export function whatBecameOfTheStop(
  now: {
    readonly stop: TheStopAMessageGot
    readonly askedOf: string | null
    readonly ended?: readonly string[]
    readonly stillRunning?: readonly string[]
    readonly provider?: Provider
  },
  /**
   * **The receiver as a LATER sentence names it — its name alone**
   * ({@link AgentToolHost.whatToCallTheConversation}). These words always follow the receipt's first
   * sentence, which named it in full, by the piece it owns: said in full again, the one name ran
   * five times through one paragraph.
   */
  called: string,
  what: 'this message' | 'your answer' | 'your reason',
  yours: (conversation: string) => boolean,
  nameOf: (conversation: string) => string,
  /**
   * The receipt already says what the held words wait for ({@link heldAndWhy}), so a stop refused
   * because a person is being asked says only why it was refused.
   */
  itsWaitIsSaid = false,
): { readonly structured: Readonly<Record<string, unknown>>; readonly said: string } {
  const notStopped = { asked_to_stop: false, not_stopped_because: now.stop }
  switch (now.stop) {
    case 'asked': {
      // **F084 · what it ended and what still runs, once its turn ended** — else the rule its
      // provider stops by, said as a rule: what happens, not what has.
      const runs = now.stillRunning ?? []
      const left =
        now.ended === undefined
          ? theRuleOfAStopForWords(now.provider, called)
          : `${
              now.ended.length === 0
                ? 'The stop ended none of its commands'
                : `The stop ended ${theStoppedWork(now.ended)}`
            }${runs.length === 0 ? '' : `; ${called} still has ${theStoppedWork(runs)} running in the background`}.`
      return {
        structured: {
          asked_to_stop: true,
          ...(now.ended === undefined ? {} : { ended: now.ended }),
          ...(runs.length === 0 ? {} : { still_running: runs }),
        },
        said: `The turn ${called} was running was ${ASKED_TO_STOP}, so that ${what} need not wait for that work to finish, and ${called} is told you asked for the stop. ${left}`,
      }
    }
    case 'not-needed':
      return {
        structured: notStopped,
        said: 'No turn was running that needed stopping, so nothing was interrupted.',
      }
    case 'not-below-you':
      return {
        structured: notStopped,
        said: `${called} is no longer working on the sender's piece, so its turn was not stopped; ${what} waits for that turn to end.`,
      }
    case 'a-person-is-replacing-its-turn':
      return {
        structured: notStopped,
        said: `A person is already stopping the turn ${called} was running to give it their own words, so it was not interrupted again; ${what} goes with or after theirs.`,
      }
    case 'a-person-is-being-asked':
      return {
        structured: notStopped,
        said: itsWaitIsSaid
          ? `The turn ${called} is running was not interrupted: stopping it would answer for the person it waits on.`
          : `The turn ${called} is running waits for a person's answer, and stopping it would answer for them, so it was not interrupted; ${what} waits for that turn to end.`,
      }
    case 'it-is-waiting-on-an-answer': {
      const owedBy = now.askedOf
      if (owedBy !== null && yours(owedBy)) {
        return {
          structured: { ...notStopped, asked_of: owedBy },
          said: `The turn ${called} is running waits for your answer to its question, and stopping it would throw that question away, so it was not interrupted. Answer it with answer_question; ${what} waits for that turn to end.`,
        }
      }
      return {
        structured: { ...notStopped, ...(owedBy === null ? {} : { asked_of: owedBy }) },
        said: `The turn ${called} is running waits for an answer from ${owedBy === null ? 'another conversation' : nameOf(owedBy)}, and stopping it would throw that question away, so it was not interrupted; ${what} waits for that turn to end.`,
      }
    }
    case 'could-not-be-asked':
      return {
        structured: notStopped,
        said: `The turn ${called} was running could not be asked to stop, so ${what} waits for that turn to end. interrupt_agent can ask again.`,
      }
    case 'a-person-started-its-turn':
      return {
        structured: notStopped,
        said: `A person's own words started the turn ${called} is running, so it was not interrupted; ${what} waits for that turn to end.`,
      }
    case 'already-asked':
      return {
        structured: notStopped,
        said: `The turn ${called} was running had already been ${ASKED_TO_STOP}, so it was not asked again; ${what} goes in as that turn ends.`,
      }
  }
}

/**
 * **D-017 · R12 — an id this caller may not reach, answered in one sentence at every door**
 * (`RuntimeHost.whyItIsOutOfReach`): `no-such-agent` only for an id no conversation has — and for a
 * label that names nothing this caller may reach (D-016 · commit 7 · R1) — its own word for one a
 * message cannot start, and its own word for a service's conversation.
 */
export const outOfReachAnswer = (out: OutOfReach, agent: string): AgentToolAnswer => {
  if (out.is === 'no-such-agent') return refusalAnswer(refuseTool('no-such-agent', { agent }))
  if (out.is === 'takes-no-messages') {
    return refusalAnswer(refuseTool('that-conversation-takes-no-messages', { agent }))
  }
  return refusalAnswer(refuseTool('that-is-a-service', { agent }))
}

/**
 * **What a delivery that did not happen answers, in this file's vocabulary** — `message_agent`'s
 * words, and `give_work`'s for a brief that did not arrive (D-016): one classification, so the two
 * doors cannot come to say one failure two ways. **One arm reads `tool`**: a start in flight that
 * never came up leaves no conversation by the id a message NAMED, and a give named a profile.
 *
 * **The host's own refusal, classified.** The host is where the rule lives; all that happens here
 * is that a throw becomes a payload a model can read as policy.
 */
export function whatADeliveryMet(
  error: unknown,
  agent: string,
  tool: Extract<ToolName, 'message_agent' | 'give_work'>,
): AgentToolAnswer {
  // **692 · the START this delivery asked for did not happen** — **D-017 · R1**: of any
  // conversation that was not running — answered in the WAKE's words, because it was a wake: the
  // reopen's failure classified by {@link aWakeThatDidNotHappen}, with its true reason. Only this
  // type: `aWakeThatDidNotHappen` asked of every throw below would re-word refusals that have nothing
  // to do with a start.
  if (error instanceof AStartThatDidNotHappen) {
    // **D-017 · R1 — a launch in flight that failed before anything was recorded**: the delivery
    // waited on it, and there is no such conversation. The host's person-read refusal carries
    // the reason on its `cause`, as the classifier reads it.
    const { cause } = error
    const unavailable =
      unavailableOf(cause) ??
      (cause instanceof Error ? unavailableOf((cause as { cause?: unknown }).cause) : null)
    if (unavailable === 'not-recorded') {
      // **`message_agent` named that id, and the identical retry meets `no-such-agent`**; a give
      // named a profile, and the identical give starts a new conversation (D-016).
      return refusalAnswer(
        tool === 'give_work'
          ? refuseTool('the-start-it-waited-on-did-not-happen', { agent })
          : refuseTool('no-such-agent', { agent }),
      )
    }
    const unwoken = aWakeThatDidNotHappen(error.cause)
    if (unwoken === null) throw error.cause
    console.warn(
      `${tool}: the start did not happen (${unwoken.because}): ${
        error.cause instanceof Error ? error.cause.message : String(error.cause)
      }`,
    )
    return refusalAnswer(aWakeRefused(unwoken, agent))
  }
  const said = error instanceof Error ? error.message : String(error)
  // **650 · the arm of the fold below that clears with nobody acting**, by the TYPE thrown where
  // its fact is known — never by `said`. **A reservation being CLOSED stays in the fold**: it will
  // never come up, and telling a caller to make the same call again would be a retry this app
  // already knows cannot work. **681 · what this answers AFTER** (PM ruling R30b): every POLICY
  // wall a running receiver would refuse this caller by, so a retry is never refused by a grant the
  // caller could have been told about now (`650` F1).
  if (error instanceof SessionStillStarting && !error.closing) {
    return refusalAnswer(refuseTool('that-conversation-has-not-started', { agent, said }))
  }
  return refusalAnswer(refuseTool('agent-cannot-take-a-message', { agent, said }))
}
