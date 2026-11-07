import type {
  QuestionRecipient,
  RequestState,
  RoutedRequest,
} from '../../shared/question-contracts'
import { refusalReason } from '../../shared/refusals'
import type { ChannelRefusal } from '@brobot2/runtime'
import type { UserInputQuestion } from '@brobot2/runtime'
import { REQUEST_IS_OPEN } from '../../shared/questions'
import type { RailPermanence } from '../../shared/refusals'
import type { RefusalRemedy } from '../../shared/refusals'

export type QuestionRail = keyof typeof QUESTION_RECORDS

export function questionPermanenceOf(rail: QuestionRail): RailPermanence {
  return QUESTION_RECORDS[rail].permanence
}

export function questionRetryableOf(rail: QuestionRail): boolean {
  return questionPermanenceOf(rail) === 'while-this-holds'
}

export function questionRemedyOf(rail: QuestionRail): RefusalRemedy | null {
  return QUESTION_RECORDS[rail].remedy
}

export interface QuestionRefusalDetail {
  question?: string
  because?: ChannelRefusal
  state?: RoutedRequest['state']
  at?: number
  itsAnswer?: AnAnswerOnItsWay
  said?: string
  piece?: string
  held?: readonly string[]
  askers?: readonly string[]
  agent?: string
  argument?: 'answers' | 'cannot_answer'
  limit?: number
  was?: number
}

export type AnAnswerOnItsWay =
  | 'held-and-this-turn-is-stopping'
  | 'held-until-this-turn-ends'
  | 'held-until-the-limit-resets'
  | 'already-sent'

export interface QuestionRefusal {
  readonly rail: QuestionRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  readonly remedy: RefusalRemedy | null
  readonly detail: QuestionRefusalDetail
}

const QUESTION_RECORDS = {
  'no-question-by-that-name': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'nobody is waiting on you for a request by that id, so nothing was answered. list_questions names the requests you can answer — from conversations you started, and agents that asked you; sending that id again will never succeed.',
  },
  'a-person-answers-this-one': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'that one is a person’s to settle rather than a question you can answer, so nothing was sent and it is still waiting for a person. Leave it for that person; retrying your answer will never succeed. The detail says what kind of thing it is.',
  },
  'question-has-already-ended': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'no further answer is owed: that question has ended, so nobody is waiting and nothing was sent. The detail says how it ended; retrying this id cannot work.',
  },
  'that-answer-cannot-be-sent': {
    permanence: 'while-this-holds',
    remedy: 'answer-every-part-the-request-asks-for',
    sentence:
      'that answer cannot be sent as it stands, so nothing was sent. Answer every part it asks about, choosing one of its options unless it takes an answer of your own. The request is still waiting.',
  },
  'the-conversation-that-asked-has-gone': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'no further answer is owed: the asking conversation stopped, so nobody waits and nothing was sent. Retrying this id cannot work.',
  },
  'more-than-one-question-has-that-id': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'name which one you mean: make the same call again with asked_by set to one of the conversations the detail lists. More than one conversation you started raised a request with that id, so nothing was sent; the id alone will never be enough.',
  },
  'that-conversation-did-not-ask-that': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'make the same call again with asked_by set to one of the conversations the detail lists: the one you named raised no request with that id, so nothing was sent, and naming it again will never succeed.',
  },
  'no-open-work-by-that-name': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'you hold no open piece by that name, so nothing was asked and nobody was told. list_tasks names the pieces you hold, and a question has to name one of those; sending that name again will never succeed.',
  },
  'nobody-to-pass-it-up-to': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'nothing started this conversation, so there is no parent for that question to go to and nothing was sent. Pass it to a person with a-person instead; sending it to the parent again will never succeed.',
  },
  'this-app-does-not-hold-those-words': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'nothing can be passed up: this app no longer holds the question’s original words. Nothing was sent, and retrying this id cannot recover them.',
  },
  'no-agent-you-can-ask-by-that-name': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'there is no other agent by that id or piece label that you can ask, so nothing was asked and nobody was told. list_agents names the agents you can ask; asking by that name again will never succeed.',
  },
  'a-question-asked-of-you-by-name-is-yours': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'that question was asked of you by name, so it is yours to answer — or to say you cannot, with answer_question and cannot_answer — and it cannot be passed on. Nothing was sent; passing it on again will never succeed.',
  },
  'no-open-question-you-asked-by-that-name': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'you have no open question by that id — you did not ask it, or it has ended — so nothing was withdrawn. Use the id ask_question returned; withdrawing this one again will never succeed.',
  },
  'name-the-piece-you-ask-about': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'you hold more than one piece, so say which one this question is about: ask again naming it as piece. The detail lists the ones that have reached you; nothing was asked and nobody was told.',
  },
  'no-piece-to-ask-about': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'you hold no open piece of work that has reached you, so nothing was asked. A question to another agent needs no piece; otherwise do the work here until you hold a piece to ask about.',
  },
  'answer-too-long': {
    permanence: 'while-this-holds',
    remedy: 'shorten-the-answer-or-put-the-long-form-in-a-file',
    sentence:
      'shorten your answer, or put the long form in a file and name its full path in your answer. It is longer than an answer may be, so nothing was sent or shortened; the question is still waiting for your answer.',
  },
  'move-offer-not-available': {
    permanence: 'permanent',
    remedy: null,
    sentence: 'This request cannot be offered for a move.',
  },
  'move-offer-is-held': {
    permanence: 'while-this-holds',
    remedy: 'make-the-same-call-when-this-settles',
    sentence: 'This request is still being recorded, so it cannot be offered for a move yet.',
  },
  'move-offer-needs-a-person': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence:
      'That conversation is unavailable until a person restores it, so this request cannot be offered for a move.',
  },
} satisfies Record<
  string,
  {
    permanence: RailPermanence
    remedy: RefusalRemedy | null
    sentence: string
  }
>

export const QUESTION_RAILS: readonly QuestionRail[] = Object.keys(
  QUESTION_RECORDS,
) as QuestionRail[]

function answerTooLongSentence(detail: QuestionRefusalDetail): string {
  if (detail.was === undefined || detail.limit === undefined) {
    return QUESTION_RECORDS['answer-too-long'].sentence
  }
  const after = 'so nothing was sent or shortened; the question is still waiting for your answer.'
  return detail.argument === 'cannot_answer'
    ? `shorten your reason, or put the long form in a file and name its full path in cannot_answer. It is ${String(detail.was)} units long and a reason may be at most ${String(detail.limit)}, ${after}`
    : `shorten your answer, or put the long form in a file and name its full path in your answer. Your own words in it are ${String(detail.was)} units long and an answer may carry at most ${String(detail.limit)}, ${after}`
}

function aQuestionThatWasAnsweredSentence(detail: QuestionRefusalDetail): string {
  const ended =
    detail.state === 'answered' ? 'answered' : detail.state === 'rejected' ? 'declined' : null
  if (ended === null || detail.itsAnswer === undefined) {
    return QUESTION_RECORDS['no-open-question-you-asked-by-that-name'].sentence
  }
  const reply = detail.state === 'answered' ? 'its answer' : 'the reply declining it'
  switch (detail.itsAnswer) {
    case 'held-and-this-turn-is-stopping':
      return `stop here and read ${reply}: that question was already ${ended}, so nothing was withdrawn. This turn is being stopped, so ${reply}, held for you, comes in now.`
    case 'held-until-this-turn-ends':
      return `end this turn to read ${reply} before you report on that question: it was already ${ended}, so nothing was withdrawn, and ${reply} is held for you until this turn ends.`
    case 'held-until-the-limit-resets':
      return `end this turn to read ${reply} before you report on that question: it was already ${ended}, so nothing was withdrawn, and ${reply} is held for you until this turn ends, or longer if your usage limit still holds then.`
    case 'already-sent':
      return `read ${reply}, which was sent to you as a message: that question was already ${ended}, so nothing was withdrawn.`
  }
}

function aQuestionThatEndedSentence(detail: QuestionRefusalDetail): string {
  if (detail.state === undefined || REQUEST_IS_OPEN[detail.state]) {
    return QUESTION_RECORDS['no-open-question-you-asked-by-that-name'].sentence
  }
  const instant = new Date(detail.at ?? Number.NaN)
  const ended = Number.isNaN(instant.getTime())
    ? 'This question has already ended. No withdrawal is needed.'
    : detail.state === 'withdrawn'
      ? `This question was already withdrawn at ${instant.toISOString()}. No withdrawal is needed.`
      : `This question ended at ${instant.toISOString()}. No withdrawal is needed.`
  return (detail.state === 'answered' || detail.state === 'rejected') &&
    detail.itsAnswer !== undefined
    ? `${aQuestionThatWasAnsweredSentence(detail)} ${ended}`
    : ended
}

export function quotingTheQuestion(id: string): string {
  return `quoting ${id}.`
}

export function questionKey(askedBy: string, requestId: string): string {
  return `${askedBy}\u0000${requestId}`
}

export function refuseQuestion(
  rail: QuestionRail,
  detail: QuestionRefusalDetail = {},
): QuestionRefusal {
  const permanence = questionPermanenceOf(rail)
  return {
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(
      rail === 'answer-too-long'
        ? answerTooLongSentence(detail)
        : rail === 'no-open-question-you-asked-by-that-name'
          ? aQuestionThatEndedSentence(detail)
          : QUESTION_RECORDS[rail].sentence,
    ),
    remedy: questionRemedyOf(rail),
    detail,
  }
}

export function admitAnswer(request: RoutedRequest | undefined): QuestionRefusal | null {
  if (request === undefined) return refuseQuestion('no-question-by-that-name')
  if (request.went.is === 'the-person-the-channel-left-it-with') {
    return refuseQuestion('a-person-answers-this-one', {
      question: request.requestId,
      because: request.went.because,
    })
  }
  if (!REQUEST_IS_OPEN[request.state]) {
    return refuseQuestion('question-has-already-ended', {
      question: request.requestId,
      state: request.state,
    })
  }
  return null
}

export const A_PERSONS_ANSWER_TO_AN_ENDED_QUESTION: Readonly<
  Record<Exclude<RequestState, 'open'>, string>
> = {
  answered: 'That question was already answered, so your answer was not sent.',
  rejected: 'That question was already declined, so your answer was not sent.',
  decided: 'That question was already settled, so your answer was not sent.',
  withdrawn: 'The conversation that asked took that question back, so your answer was not sent.',
  abandoned: 'That question was given up before this answer came, so your answer was not sent.',
  stranded: 'That question was left behind when this app stopped, so your answer was not sent.',
  interrupted: 'The turn that asked it was stopped, so your answer was not sent.',
  'work-withdrawn': 'The work that question was about was taken back, so your answer was not sent.',
  'work-closed': 'The work that question was about was closed, so your answer was not sent.',
  'work-replied': 'The work that question was about was handed back, so your answer was not sent.',
  'recipient-ended':
    'That question was closed when the one it was asked of was ended, so your answer was not sent.',
}

export const NOT_A_PERSONS_TO_ANSWER_HERE =
  'That question was asked of another conversation, not of you, so your answer was not sent. Open the conversation that asked it to answer it there.'

export const NO_SUCH_QUESTION_TO_ANSWER =
  'This app has no question by that id in that conversation, so your answer was not sent.'

export type AnswerOutcome =
  | {
      readonly ok: true
      readonly question: string
      readonly asked: string
      readonly piece: string | null
      readonly notAsked: readonly string[]
      readonly kept?: string
    }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

export function admitAsk(
  piece: { readonly piece: string } | null,
  named: string,
  held: readonly string[],
): QuestionRefusal | null {
  return piece === null ? noPieceToAskAbout(named, held) : null
}

export function noPieceToAskAbout(named: string, held: readonly string[]): QuestionRefusal {
  if (named !== '') return refuseQuestion('no-open-work-by-that-name', { piece: named })
  return held.length > 1
    ? refuseQuestion('name-the-piece-you-ask-about', { held })
    : refuseQuestion('no-piece-to-ask-about')
}

export type AskOutcome =
  | {
      readonly ok: true
      readonly question: string
      readonly went: QuestionRecipient
      readonly aboutItsRoot: boolean
    }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

export type PassUpOutcome =
  | {
      readonly ok: true
      readonly question: string
      readonly carried: {
        readonly question: string
        readonly askedBy: string
        readonly piece: string | null
      }
    }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

export function questionText(
  asker: {
    readonly called: string
    readonly address: string
  },
  request: {
    id: string
    prompt: string
    questions: readonly UserInputQuestion[]
    context?: string | null
    label?: string | null
  },
): string {
  const about =
    request.label === undefined || request.label === null ? '' : ` about ${request.label}`
  const lines = [
    `${asker.called} is waiting on an answer${about} before it can go on. Answer it with answer_question, quoting ${request.id} with asked_by ${asker.address}.`,
    request.prompt,
  ]
  if (request.context !== undefined && request.context !== null && request.context !== '') {
    lines.push(`Context added by the conversation that passed it on: ${request.context}`)
  }
  for (const question of request.questions) {
    const options =
      question.options.length === 0
        ? '    (answer in your own words)'
        : question.options.map((option) => `    - ${option.label}`).join('\n')
    lines.push(
      `  part ${question.id}${question.header === undefined ? '' : ` · ${question.header}`}: ${question.prompt}\n${options}` +
        (question.allowOther === true ? '\n    (or an answer of your own)' : '') +
        (question.multiSelect === true ? '\n    (this part takes more than one)' : ''),
    )
  }
  return lines.join('\n\n')
}

export type WithdrawQuestionOutcome =
  | { readonly ok: true; readonly question: string }
  | { readonly ok: false; readonly refusal: QuestionRefusal }

export type AnAnswersOrigin = 'a-person-answered-it-where-it-was-passed-up' | 'asked-of-a-person'

export function answerText(
  answerer: string | null,
  question: {
    readonly id: string
    readonly prompt: string
    readonly label: string | null
  },
  answers: readonly { readonly part: string; readonly answer: readonly string[] }[] | null,
  said: string | null = null,
  origin: AnAnswersOrigin | null = null,
): string {
  const who = answerer ?? 'A person'
  const about = question.label === null ? '' : ` about ${question.label}`
  const lines =
    answers === null
      ? [
          `${who} declined to answer the question you asked${about}, ${quotingTheQuestion(question.id)}`,
        ]
      : origin === 'asked-of-a-person'
        ? [
            `${who} answered the question you asked a person${about}, instead of that person, ${quotingTheQuestion(question.id)} This app cannot tell you whether it asked them first.`,
          ]
        : [`${who} answered the question you asked${about}, ${quotingTheQuestion(question.id)}`]
  if (answers === null && said !== null) lines.push(`It said: ${said}`)
  if (answers !== null && origin === 'a-person-answered-it-where-it-was-passed-up') {
    lines.push(
      'It had passed your question up, and a person answered it there. Its answer below is in its own words: it may quote that answer, or say it differently.',
    )
  }
  lines.push(`You asked: ${question.prompt}`)
  for (const one of answers ?? []) lines.push(`  ${one.part}: ${one.answer.join(', ')}`)
  return lines.join('\n\n')
}

export const A_TO_DO_DONE = 'Done'
export const A_TO_DO_NOT_DONE = 'Can’t do it'

export function aToDoAnsweredText(
  answerer: string | null,
  question: { readonly id: string; readonly prompt: string; readonly label: string | null },
  answers: readonly { readonly part: string; readonly answer: readonly string[] }[],
): string | null {
  const said = answers.find((one) => one.part === 'answer')?.answer
  if (said?.length !== 1 || (said[0] !== A_TO_DO_DONE && said[0] !== A_TO_DO_NOT_DONE)) return null
  const about = question.label === null ? '' : ` about ${question.label}`
  const note = answers
    .filter((one) => one.part === 'note')
    .flatMap((one) => one.answer)
    .join('\n')
    .trim()
  const done = said[0] === A_TO_DO_DONE
  return [
    answerer !== null
      ? `${answerer} answered for the person${about}: ${done ? 'done' : 'can’t do it'}, ${quotingTheQuestion(question.id)}`
      : done
        ? `A person did what you asked them to do${about}, ${quotingTheQuestion(question.id)}`
        : `A person could not do what you asked them to do${about}, ${quotingTheQuestion(question.id)}`,
    `You asked: ${question.prompt}`,
    ...(note === '' ? [] : [`Their note: ${note}`]),
  ].join('\n\n')
}
