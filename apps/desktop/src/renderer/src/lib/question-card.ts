import type { MoveOffer, MoveReceipt } from '../../../shared/move-contracts'
import type {
  AskedQuestion,
  OfferedAnswer,
  QuestionFiles,
} from '../../../shared/question-contracts'

import { agentName, type AgentIdentity, type UserInputResponse } from '../../../shared/runtime-ipc'

import { clockTime } from '../../../shared/clock'
import { whoAnsweredIt } from '../../../shared/who-did-it'
import { fullTime } from './clock'
import type {
  OutgoingQuestion,
  OutgoingQuestionPart,
  QuestionTool,
  ToolItem,
  TranscriptItem,
  UserInputItem,
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
import type { QueueQuestionContext } from './question-queue-contracts'
import { sinceWords } from './queue-time'
import { legacyQuestionFiles } from './legacy-question-files'

export type QuestionState =
  | 'asking'
  | 'open'
  | 'sending'
  | 'answered'
  | 'declined'
  | 'withdrawn'
  | 'not-answered'
  | 'closed'
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
  closed: '',
  receipt: '',
  failed: 'failed',
  'did-not-finish': 'did not finish',
}

export const ASKED_WORD = 'asked'
export const PASSED_UP_WORD = 'passed up to'
export const NOBODY_NAMED_YET = 'somebody'
const AN_UNNAMED_ASKER = 'A conversation'
export const ADDED_BESIDE = 'Added:'
export const WORDS_NOT_FOUND =
  'BroCrew couldn’t find the question’s words. Open the asking conversation to read them.'
export const SEND = 'Send'
export const TYPE_YOUR_OWN = 'Or answer in your own words'
export const TYPE_YOUR_ANSWER = 'Your answer'
export const PICK_SEVERAL = 'pick as many as you like'
export const ANSWER_EACH_PART = 'Answer each part to send.'
export const PICK_AT_LEAST_ONE = 'Pick at least one to send.'

interface QuestionOption {
  readonly label: string
  readonly description: string | null
}

export interface QuestionPart {
  readonly id: string
  readonly header: string | null
  readonly prompt: string | null
  readonly options: readonly QuestionOption[]
  readonly multiSelect: boolean
  readonly typed: boolean
  readonly secret: boolean
  readonly providerPart?: true
}

export interface QuestionWords {
  readonly files?: QuestionFiles
  readonly move?: MoveOffer
  readonly prompt: string
  readonly context: string | null
  readonly passedUp: boolean
  readonly parts: readonly QuestionPart[]
}

export interface AppQuestion {
  readonly words: QuestionWords | null
  readonly offered: OfferedAnswer | null
  readonly sent: boolean
}

export type QueuePress =
  { readonly is: 'sending' } | { readonly is: 'refused'; readonly said: string }

export interface QuestionCardReading {
  readonly files?: QuestionFiles
  readonly move?: MoveOffer
  readonly movedTo?: MoveReceipt
  readonly requestId: string | null
  readonly asker: string
  readonly verb: string
  readonly askedOf: string
  readonly piece: string | null
  readonly via: string | null
  readonly at: string | null
  readonly atTitle: string | null
  readonly words: string | null
  readonly wordsAreCut: boolean
  readonly wordsMissing: boolean
  readonly context: string | null
  readonly parts: readonly QuestionPart[]
  readonly state: QuestionState
  readonly answeredBy: string | null
  readonly answerable: boolean
  readonly refused: string | null
  readonly note: string | null
  readonly receipt: string | null
  readonly where: WorkIsWith | null
}

type AskedPart = Pick<OutgoingQuestionPart, 'id' | 'prompt' | 'header' | 'options'> & {
  readonly allowOther?: boolean | undefined
  readonly secret?: boolean | undefined
  readonly multiSelect?: boolean | undefined
}

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

export function providerQuestion(
  item: UserInputItem & Partial<Pick<TranscriptItem, 'at'>>,
  agent: string | null,
  answerable: boolean,
): QuestionCardReading {
  const state: QuestionState =
    item.answered === 'answered'
      ? 'answered'
      : item.answered === 'rejected'
        ? 'declined'
        : item.note !== null
          ? 'closed'
          : 'open'
  return {
    requestId: item.request.id,
    asker: agent ?? AN_UNNAMED_ASKER,
    verb: ASKED_WORD,
    askedOf: A_PERSON_ADDRESSED,
    piece: null,
    via: null,
    at: item.at == null ? null : clockTime(item.at),
    atTitle: item.at == null ? null : fullTime(item.at),
    words: item.request.prompt,
    wordsAreCut: false,
    wordsMissing: false,
    context: null,
    parts: item.request.questions.map((part) => ({
      ...partOf(part, item.request.prompt),
      providerPart: true,
    })),
    state,
    answeredBy: item.answered === null ? null : whoAnsweredIt(item.by),
    answerable,
    refused: item.refused,
    note: item.note,
    receipt: null,
    where: null,
  }
}

export function wordsAsked(asked: AskedQuestion, appQuestion = false): QuestionWords {
  const { text, files } =
    appQuestion && asked.files === undefined
      ? legacyQuestionFiles(asked.prompt)
      : { text: asked.prompt, files: asked.files ?? [] }
  return {
    ...(files.length === 0 ? {} : { files }),
    ...(asked.move === undefined ? {} : { move: asked.move }),
    prompt: text,
    context: asked.context,
    passedUp: asked.passedUp,
    parts: asked.parts.map((part) => partOf(part, asked.prompt)),
  }
}

function fileable(parts: readonly QuestionPart[]): boolean {
  return parts.length > 0 && parts.every((part) => part.id !== '')
}

function whoAnswersSaid(summary: string): OutgoingQuestion['to'] | null {
  const said = argumentExcerpt(summary, 'who_answers')
  if (said === null || said.cut) return null
  return said.text === 'a-person' || said.text === 'the-parent' || said.text === 'an-agent'
    ? said.text
    : null
}

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
  return item.result?.ok === false ? 'failed' : 'open'
}

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
  const { text: words, files } =
    recorded !== null && asked?.files === undefined
      ? legacyQuestionFiles(recorded)
      : { text: recorded ?? excerpt?.text ?? null, files: asked?.files ?? [] }
  const parts = (asked?.parts ?? []).map((part) => partOf(part, recorded ?? words))
  return {
    files,
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

export function questionOnTheQueue(
  row: QueueQuestionContext,
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
    ...(words?.files === undefined ? {} : { files: words.files }),
    words: words === null || words.prompt.trim() === '' ? null : words.prompt,
    wordsAreCut: false,
    wordsMissing: words === null,
    context: words?.context ?? null,
    parts,
    state,
    answeredBy: null,
    answerable: fileable(parts),
    refused: state === 'open' && pressed?.is === 'refused' ? pressed.said : null,
    note: null,
    receipt: null,
    where: null,
  }
}

export function answersAtOnePress(parts: readonly QuestionPart[]): boolean {
  const only = parts[0]
  return parts.length === 1 && only !== undefined && !only.multiSelect && only.options.length > 0
}

// Keep typed text separate from an option with the same label.
function ownKey(part: QuestionPart): string {
  return `${part.id}\u0000own`
}

export function pickedOf(
  part: QuestionPart,
  draft: ReadonlyMap<string, string | string[]>,
): readonly string[] {
  const value = draft.get(part.id)
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return values.filter(
    (one) =>
      typeof one === 'string' && (one.trim() !== '' || (part.providerPart && part.multiSelect)),
  )
}

export function typedOf(part: QuestionPart, draft: ReadonlyMap<string, string | string[]>): string {
  const value = draft.get(ownKey(part))
  return typeof value === 'string' ? value : ''
}

function chosenOf(
  part: QuestionPart,
  draft: ReadonlyMap<string, string | string[]>,
): readonly string[] {
  const picked = pickedOf(part, draft)
  const typed = typedOf(part, draft)
  return typed.trim() === '' || picked.includes(typed) ? picked : [...picked, typed]
}

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

export function setTyped(
  part: QuestionPart,
  draft: Map<string, string | string[]>,
  text: string,
): void {
  if (text === '') draft.delete(ownKey(part))
  else draft.set(ownKey(part), text)
  if (!part.multiSelect) draft.delete(part.id)
}

export function answerOf(
  parts: readonly QuestionPart[],
  draft: ReadonlyMap<string, string | string[]>,
  useSingleValues = false,
): UserInputResponse | null {
  if (!fileable(parts)) return null
  const answers: Record<string, string | string[]> = Object.create(null)
  for (const part of parts) {
    const values = chosenOf(part, draft)
    const first = values[0]
    if (first === undefined) return null
    answers[part.id] = useSingleValues && !part.multiSelect ? first : [...values]
  }
  return { kind: 'answer', answers }
}

export function oneAnswer(part: QuestionPart, label: string): UserInputResponse {
  const answers: Record<string, string[]> = Object.create(null)
  answers[part.id] = [`${label}`]
  return { kind: 'answer', answers }
}
