import type { MoveOffer, MoveReceipt } from '../../../shared/move-request'
import { agentName, type AgentIdentity, type UserInputResponse } from '../../../shared/runtime-ipc'
import type { AskedQuestion, OfferedAnswer } from '../../../shared/questions'
import { clockTime } from '../../../shared/clock'
import { whoAnsweredIt } from '../../../shared/who-did-it'
import { fullTime } from './clock'
import type {
  OutgoingQuestion,
  OutgoingQuestionPart,
  QuestionTool,
  ToolItem,
  TranscriptItem,
} from './transcript'
import { argumentExcerpt } from './argument-excerpt'
import { pieceSays } from './relayed-turn'
import { workIsWith, type WorkIsWith } from './where-the-work-is'
import {
  A_PERSON_ADDRESSED,
  AN_UNNAMED_PARENT,
  AN_UNNAMED_RECIPIENT,
  AN_UNRESOLVED_RECIPIENT,
  ITSELF_ADDRESSED,
  withoutHandles,
} from './outgoing-card'
import { THIS_CONVERSATION_FIRST } from './from-outside'
import { sinceWords, type PersonsQueueRow } from './persons-queue'

/**
 * # 🔴 UI-009 · A question is answered where it is asked, and in *Waiting on you*
 *
 * Use the same complete question details and answer controls in the queue and conversation.
 *
 * ⚑ **One card, two frames.** `QuestionCard.vue` draws a question this app asked (`ask_question`,
 * `pass_question_up`) — who asked whom and about which piece, the words, the parts with their
 * options as presses, a box for a person's own words, and how it stands. The conversation frames it
 * on the call that asked ({@link questionInTheConversation}); *Waiting on you* frames it on the
 * question's row ({@link questionOnTheQueue}). ⛔ Every word and every rule is here, none in a
 * template, so the two cannot say one question two ways.
 *
 * ⚑ **The door is the one every card answers through** — `respondUserInput`, with the request id
 * this app minted. The host files the answer under each part's id and takes any string for a
 * question it asked itself, so the window never sends a blank ({@link answerOf}).
 */

/** ⚑ How a question stands, as the card says it — a closed set a test can walk. */
export type QuestionState =
  /** The asking call is running and its row has not landed. */
  | 'asking'
  /** Asked, and waiting on its answer. */
  | 'open'
  /** An answer from this window is on its way. */
  | 'sending'
  | 'answered'
  | 'declined'
  | 'withdrawn'
  /** Its recipient's conversation ended without answering — `question_recipient_ended`. */
  | 'not-answered'
  /** The host closed it on an answer from here — its words are the card's note. */
  | 'closed'
  /** The call answered and no row landed — a refusal: its receipt is the whole story. */
  | 'receipt'
  | 'failed'
  | 'did-not-finish'

export const QUESTION_STATE_WORD: Readonly<Record<QuestionState, string>> = {
  asking: 'asking…',
  open: '',
  sending: 'answer sent',
  answered: 'answered',
  declined: 'declined',
  withdrawn: 'withdrawn',
  'not-answered': 'not answered · its conversation ended',
  // ⚑ The note under the card says what became of it — a word here could only guess.
  closed: '',
  receipt: '',
  failed: 'failed',
  'did-not-finish': 'did not finish',
}

/** ⚑ The verb between the asker and whom it asked — *BroBot asked you*. */
export const ASKED_WORD = 'asked'
/** ⚑ …and for a question carried up — *BroBot passed up to you*. */
export const PASSED_UP_WORD = 'passed up to'
/** ⚑ Whom a question was asked of, when no row and no argument says — never a guess. */
export const NOBODY_NAMED_YET = 'somebody'
/** ⚑ The asker of a row whose chain names nobody. */
export const AN_UNNAMED_ASKER = 'A conversation'
/** ⚑ What leads the note a conversation added when it passed a question up. */
export const ADDED_BESIDE = 'Added:'
/** ⚑ A queue row whose question's words BroBot could not find (D-046: `asked` is `null`). */
export const WORDS_NOT_FOUND =
  'BroCrew couldn’t find the question’s words. Open the asking conversation to read them.'
export const MORE = 'more'
export const LESS = 'less'
export const SEND = 'Send'
/** ⚑ The box beside a question's options. */
export const TYPE_YOUR_OWN = 'Or answer in your own words'
/** ⚑ The box of a question asked with no options. */
export const TYPE_YOUR_ANSWER = 'Your answer'
/** ⚑ `UserInputCard`'s own words for a part that takes several. */
export const PICK_SEVERAL = 'pick as many as you like'
/** ⚑ Why *Send* is off on a question of several parts. */
export const ANSWER_EACH_PART = 'Answer each part to send.'
/** ⚑ Why *Send* is off on a one-part question that takes several, while nothing is picked. */
export const PICK_AT_LEAST_ONE = 'Pick at least one to send.'

/** One choice a part offers. */
export interface QuestionOption {
  readonly label: string
  readonly description: string | null
}

/** One part of a question, and the rules it is answered by. */
export interface QuestionPart {
  /** ⛔ The key the answer is filed under — `''` where the row named none, which nothing can answer. */
  readonly id: string
  readonly header: string | null
  /** ⚑ The part's own words, only where they say more than the question's. */
  readonly prompt: string | null
  readonly options: readonly QuestionOption[]
  readonly multiSelect: boolean
  /** ⚑ A box is drawn for it — it has no options, or it takes an answer off the list. */
  readonly typed: boolean
  readonly secret: boolean
}

/**
 * ⚑ **The question as it was asked** — its words, what was added when it was passed up, and its
 * parts. Read off the asker's `question_asked` in a conversation ({@link wordsOf}), and off the
 * person's list on *Waiting on you* ({@link wordsAsked}, D-046).
 */
export interface QuestionWords {
  readonly move?: MoveOffer
  readonly prompt: string
  readonly context: string | null
  readonly passedUp: boolean
  readonly parts: readonly QuestionPart[]
}

/** ⚑ What a queue row carries for a question this app asked — see `PersonsQueueRow.question`. */
export interface AppQuestion {
  /** The words, off the person's list (D-046) — `null` where the host found no row for it. */
  readonly words: QuestionWords | null
  /** ⚑ The host's one-part offer, used where the words are not here. */
  readonly offered: OfferedAnswer | null
  /** ⚑ This window has sent an answer for it — `PersonsQueueWorld.answeredFromHere`. */
  readonly sent: boolean
}

/** ⚑ What the last press on a queue card came to, until the row leaves the list. */
export type QueuePress =
  | { readonly is: 'sending' }
  /** The host's words — the card is open again under them. */
  | { readonly is: 'refused'; readonly said: string }

/** ⚑ Everything one card says. */
export interface QuestionCardReading {
  readonly move?: MoveOffer
  readonly movedTo?: MoveReceipt
  readonly requestId: string | null
  readonly asker: string
  readonly verb: string
  readonly askedOf: string
  /** The piece it is about — `W2`. */
  readonly piece: string | null
  /** ⚑ The queue: the host's chain sentence, where the chain is not the asker and you. */
  readonly via: string | null
  readonly at: string | null
  readonly atTitle: string | null
  /** The question's words — `null` where there are none to draw. */
  readonly words: string | null
  /** ⛔ The words are the call's arguments, cut at their bound. */
  readonly wordsAreCut: boolean
  /** ⚑ The queue: the host found no words for it (D-046's `asked: null`). */
  readonly wordsMissing: boolean
  readonly context: string | null
  readonly parts: readonly QuestionPart[]
  readonly state: QuestionState
  /** ⚑ Who answered it — `whoAnsweredIt`, once a decision is recorded. */
  readonly answeredBy: string | null
  /** ⛔ This surface may answer it — the presses and the box are drawn only then. */
  readonly answerable: boolean
  /** The host's words for an answer from here that it did not take — the card stays open. */
  readonly refused: string | null
  /** The host's words for an answer it closed — kept for a next start, or over. */
  readonly note: string | null
  /** The asking call's own answer, where no row landed. */
  readonly receipt: string | null
  /** The conversation that answers it, as a press. */
  readonly where: WorkIsWith | null
}

/**
 * ⚑ A part as either source carries it — the asker's `question_asked` or the person's list
 * (`UserInputQuestion`, whose flags may be `false` where the other's are only ever `true`).
 */
type AskedPart = Pick<OutgoingQuestionPart, 'id' | 'prompt' | 'header' | 'options'> & {
  readonly allowOther?: boolean | undefined
  readonly secret?: boolean | undefined
  readonly multiSelect?: boolean | undefined
}

/** ⚑ One part as the card draws it — its prompt only where it says more than the words. */
function partOf(part: AskedPart, words: string | null): QuestionPart {
  const prompt = part.prompt.trim()
  return {
    id: part.id,
    header: part.header ?? null,
    prompt: prompt === '' || prompt === words?.trim() ? null : part.prompt,
    options: part.options.map((option) => ({
      label: option.label,
      description: option.description ?? null,
    })),
    multiSelect: part.multiSelect === true,
    typed: part.options.length === 0 || part.allowOther === true,
    secret: part.secret === true,
  }
}

/** ⚑ **The question as its asker's ledger holds it** — see {@link QuestionWords}. */
export function wordsOf(asked: OutgoingQuestion): QuestionWords {
  return {
    ...(asked.move === undefined ? {} : { move: asked.move }),
    prompt: asked.prompt,
    context: asked.context ?? null,
    passedUp: asked.passedUpFrom !== undefined,
    parts: asked.parts.map((part) => partOf(part, asked.prompt)),
  }
}

/**
 * 🔴 **D-046 · the question as the person's list carries it** — whichever conversation asked it,
 * and whether or not this window holds that conversation.
 */
export function wordsAsked(asked: AskedQuestion): QuestionWords {
  return {
    ...(asked.move === undefined ? {} : { move: asked.move }),
    prompt: asked.prompt,
    context: asked.context,
    passedUp: asked.passedUp,
    parts: asked.parts.map((part) => partOf(part, asked.prompt)),
  }
}

/** ⚑ Every part can be filed — a part with no id cannot be answered by anybody. */
function fileable(parts: readonly QuestionPart[]): boolean {
  return parts.length > 0 && parts.every((part) => part.id !== '')
}

/** ⚑ Whom the call said it asks — its `who_answers` argument, whole and one of the three, or `null`. */
function whoAnswersSaid(summary: string): OutgoingQuestion['to'] | null {
  const said = argumentExcerpt(summary, 'who_answers')
  if (said === null || said.cut) return null
  return said.text === 'a-person' || said.text === 'the-parent' || said.text === 'an-agent'
    ? said.text
    : null
}

/** ⚑ How the question stands, off the rows that landed on its call. */
function stateInTheConversation(
  item: Pick<ToolItem, 'result' | 'unfinished'>,
  asked: OutgoingQuestion | null,
): QuestionState {
  if (asked === null) {
    if (item.result === null) return item.unfinished === true ? 'did-not-finish' : 'asking'
    return item.result.ok ? 'receipt' : 'failed'
  }
  if (asked.answered === 'answered') return 'answered'
  if (asked.answered === 'rejected') return 'declined'
  if (asked.closed === 'withdrawn') return 'withdrawn'
  if (asked.closed === 'recipient-ended') return 'not-answered'
  if (asked.note !== undefined) return 'closed'
  // ⚠️ A call that errored after its row was written says nothing about where the question went.
  return item.result?.ok === false ? 'failed' : 'open'
}

/**
 * ⚑ **The card on the call that asked** — to whom is `request_routed`'s (a person is *you*, the
 * parent is named by the brief that gave the piece, an agent is *another agent* and its
 * conversation is the press); before that row the call's own `who_answers` says it. ⚑ The words are
 * the host's whole `question_asked.prompt`, and only where that row is absent the question the
 * call's arguments carried — never a passed-up question's id.
 *
 * ⛔ **Answerable only by a person asked it, on a surface that answers** — a question to another
 * agent is that agent's, and its options draw as chips.
 */
export function questionInTheConversation(
  item: Pick<ToolItem, 'summary' | 'result' | 'unfinished' | 'refusalRail'> &
    Pick<TranscriptItem, 'at'>,
  tool: QuestionTool,
  asked: OutgoingQuestion | null,
  context: {
    readonly ownAgent: string | null
    readonly identities: readonly AgentIdentity[] | null
    readonly held: ReadonlySet<string> | null
    readonly canAnswer: boolean
  },
): QuestionCardReading {
  const state = stateInTheConversation(item, asked)
  const to = asked?.to ?? whoAnswersSaid(item.summary)
  const recorded = asked !== null && asked.prompt.trim() !== '' ? asked.prompt : null
  const excerpt =
    recorded === null && tool === 'ask_question' ? argumentExcerpt(item.summary, 'question') : null
  const words = recorded ?? excerpt?.text ?? null
  const parts = (asked?.parts ?? []).map((part) => partOf(part, words))
  return {
    requestId: asked?.requestId ?? null,
    ...(asked?.move === undefined ? {} : { move: asked.move }),
    ...(asked?.movedTo === undefined ? {} : { movedTo: asked.movedTo }),
    asker: context.ownAgent ?? THIS_CONVERSATION_FIRST,
    verb: tool === 'ask_question' ? ASKED_WORD : PASSED_UP_WORD,
    askedOf:
      to === 'a-person'
        ? A_PERSON_ADDRESSED
        : to === 'the-parent'
          ? asked?.toProfile === undefined
            ? AN_UNNAMED_PARENT
            : agentName(asked.toProfile, context.identities)
          : to === 'an-agent'
            ? item.refusalRail === 'that-agent-is-you'
              ? ITSELF_ADDRESSED
              : asked?.toConversation === undefined
                ? argumentExcerpt(item.summary, 'agent')?.text
                  ? AN_UNRESOLVED_RECIPIENT
                  : NOBODY_NAMED_YET
                : AN_UNNAMED_RECIPIENT
            : NOBODY_NAMED_YET,
    piece: pieceSays(
      asked?.piece === undefined
        ? undefined
        : asked.label === undefined
          ? {}
          : { label: asked.label },
    ),
    via: null,
    at: clockTime(item.at),
    atTitle: fullTime(item.at),
    words,
    wordsAreCut: recorded === null && excerpt?.cut === true,
    wordsMissing: false,
    context: asked?.context ?? null,
    parts,
    state,
    answeredBy: asked?.answered === undefined ? null : whoAnsweredIt(asked.by),
    answerable: context.canAnswer && asked?.to === 'a-person' && fileable(parts),
    refused: asked?.refused ?? null,
    note: asked?.note ?? null,
    receipt:
      (state === 'receipt' || state === 'failed') && item.result !== null
        ? withoutHandles(item.result.summary)
        : null,
    where:
      asked?.toConversation === undefined
        ? null
        : workIsWith({ owner: asked.toConversation }, context.held),
  }
}

/**
 * ⚑ **The card on a *Waiting on you* row** — the row's own facts (who asked, the piece, how long
 * ago) and the words the person's list carries (D-046). ⚠️ **Where the host found none**, the host's
 * offer is the one part, with no box: nothing says whether that part takes a typed answer.
 */
export function questionOnTheQueue(
  row: PersonsQueueRow,
  question: AppQuestion,
  pressed: QueuePress | undefined,
): QuestionCardReading {
  const words = question.words
  const parts: readonly QuestionPart[] =
    words?.parts ??
    (question.offered === null
      ? []
      : [
          {
            id: question.offered.part,
            header: null,
            prompt: null,
            options: question.offered.options.map((label) => ({ label, description: null })),
            multiSelect: false,
            typed: false,
            secret: false,
          },
        ])
  const asker = row.chain[0]
  // ⚑ The chain says no more than the head does when it is the asker and you.
  const plain = !row.unfollowable && row.chain.length === 2 && row.chain[1]?.you === true
  const state: QuestionState = pressed?.is === 'sending' || question.sent ? 'sending' : 'open'
  return {
    requestId: row.requestId,
    ...(words?.move === undefined ? {} : { move: words.move }),
    asker: asker?.name ?? AN_UNNAMED_ASKER,
    verb: words?.passedUp === true ? PASSED_UP_WORD : ASKED_WORD,
    askedOf: A_PERSON_ADDRESSED,
    piece: row.about.is === 'the-asker-named-it' ? row.about.work.label : null,
    via: plain ? null : row.sentence,
    at: row.since ?? 'no time recorded',
    atTitle: row.blockedSince === null ? sinceWords(row) : fullTime(row.blockedSince),
    words: words === null || words.prompt.trim() === '' ? null : words.prompt,
    wordsAreCut: false,
    wordsMissing: words === null,
    context: words?.context ?? null,
    parts,
    // ⚑ An answer sent from here — this card's press, or the asker's own card in this window — is
    // *answer sent*: the store takes `sent` back on a refusal that leaves the question open, so the
    // two cards cannot disagree about it.
    state,
    answeredBy: null,
    answerable: fileable(parts),
    // ⚑ The host's words, over a card that is open again under them.
    refused: state === 'open' && pressed?.is === 'refused' ? pressed.said : null,
    note: null,
    receipt: null,
    where: null,
  }
}

/** ⚑ **One press answers** — one part, one choice, and choices to press. */
export function answersAtOnePress(parts: readonly QuestionPart[]): boolean {
  const only = parts[0]
  return parts.length === 1 && only !== undefined && !only.multiSelect && only.options.length > 0
}

/**
 * ⚑ **Where a part's own typed words are kept** — in the same draft, under a key of their own, so
 * the box is never read back out of the answer (F0). ⛔ Read back out of it, a typed `No` was a
 * pick of the option `No`: the box went blank under the person's hands and the start of their
 * answer was lost. ⚠️ The NUL keeps it off every part id an asker writes in words.
 */
function ownKey(part: QuestionPart): string {
  return `${part.id}\u0000own`
}

/**
 * ⚑ **The options pressed for a part, always as a list** — the draft holds a label for a
 * single-select part and a list for a multi-select one (`UserInputCard`'s reading).
 */
export function pickedOf(
  part: QuestionPart,
  draft: ReadonlyMap<string, string | string[]>,
): readonly string[] {
  const value = draft.get(part.id)
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return values.filter((one) => typeof one === 'string' && one.trim() !== '')
}

/** ⚑ **The box's own text, exactly as it was typed.** */
export function typedOf(part: QuestionPart, draft: ReadonlyMap<string, string | string[]>): string {
  const value = draft.get(ownKey(part))
  return typeof value === 'string' ? value : ''
}

/**
 * ⚑ **What a part answers** — its picks, then the typed words. ⛔ A blank is not an answer, and words
 * that are already a pick are not sent twice.
 */
function chosenOf(
  part: QuestionPart,
  draft: ReadonlyMap<string, string | string[]>,
): readonly string[] {
  const picked = pickedOf(part, draft)
  const typed = typedOf(part, draft)
  return typed.trim() === '' || picked.includes(typed) ? picked : [...picked, typed]
}

/**
 * ⚑ **Pick a choice** — one of n for a single-select part, which replaces any typed words; on and
 * off for a multi-select one, kept in the part's order, and beside the typed words.
 */
export function pick(
  part: QuestionPart,
  draft: Map<string, string | string[]>,
  label: string,
): void {
  if (!part.multiSelect) {
    draft.set(part.id, label)
    draft.delete(ownKey(part))
    return
  }
  const next = new Set(pickedOf(part, draft))
  if (next.has(label)) next.delete(label)
  else next.add(label)
  draft.set(
    part.id,
    part.options.map((option) => option.label).filter((one) => next.has(one)),
  )
}

/**
 * ⚑ **Type an answer** — kept as typed; it replaces the choice of a single-select part and joins a
 * multi-select one's.
 */
export function setTyped(
  part: QuestionPart,
  draft: Map<string, string | string[]>,
  text: string,
): void {
  if (text === '') draft.delete(ownKey(part))
  else draft.set(ownKey(part), text)
  if (!part.multiSelect) draft.delete(part.id)
}

/**
 * ⚑ **The answer to send, or `null` while a part is still unanswered** — every part, each as a list
 * of fresh strings, in a null-prototype map (a passed-up question's part ids are a provider's, and
 * `__proto__` is a legal one).
 *
 * ⛔ **Never a blank.** The host checks only that every part has an answer, and takes an empty one
 * for a question this app asked — so the window is where a blank is refused.
 */
export function answerOf(
  parts: readonly QuestionPart[],
  draft: ReadonlyMap<string, string | string[]>,
): UserInputResponse | null {
  if (!fileable(parts)) return null
  const answers: Record<string, string[]> = Object.create(null)
  for (const part of parts) {
    const values = chosenOf(part, draft)
    if (values.length === 0) return null
    answers[part.id] = values.map((value) => `${value}`)
  }
  return { kind: 'answer', answers }
}

/** ⚑ **One choice, pressed** — the answer a one-press question sends. */
export function oneAnswer(part: QuestionPart, label: string): UserInputResponse {
  const answers: Record<string, string[]> = Object.create(null)
  answers[part.id] = [`${label}`]
  return { kind: 'answer', answers }
}
