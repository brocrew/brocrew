import type {
  PieceRow,
  StoppedOnALogin,
  TaskOutcome,
  TaskStallCause,
  TaskState,
  WorkReport,
} from '../../shared/task-contracts'
import type { RequestState } from '../../shared/question-contracts'
import { DEFAULT_IDENTITY_PROVIDER, providerDescriptor } from '@brobot2/shared'
import { refusalReason } from '../../shared/refusals'
import {
  aPieceNotEndedItsQuestionsUnread,
  aPieceNotEndedWhileAQuestionStarts,
  type UnreadQuestion,
} from '../../shared/questions'
import { A_PERSON_MUST_ACT_SENTENCE, TASK_IS_OPEN, undrivenSentence } from '../../shared/tasks'
import type { ResourceRefusal } from '../resources/resources'
import type { RailPermanence } from '../../shared/refusals'
import { HELD_FORMS_SAID } from '../../shared/documents'
import type { RefusalRemedy } from '../../shared/refusals'
import {
  ASKED_TO_STOP,
  askedByClause,
  YOU_ASKED_IT_TO_STOP,
  type WhoStoppedIt,
} from '../../shared/how-work-stopped'
import { exchangePreviewLines, type AConversation, type Exchange } from '../../shared/last-exchange'
import { pieceLine } from '../../shared/piece-called'
import { clockTime, clockTimeFrom } from '../../shared/clock'

import { PROVIDER_NAME } from '../../shared/runtime-ipc'

export type ReplyRail = keyof typeof REPLY_RECORDS

export function replyPermanenceOf(rail: ReplyRail): RailPermanence {
  return REPLY_RECORDS[rail].permanence
}

export function replyRetryableOf(rail: ReplyRail): boolean {
  return replyPermanenceOf(rail) === 'while-this-holds'
}

export function replyRemedyOf(rail: ReplyRail): RefusalRemedy | null {
  return REPLY_RECORDS[rail].remedy
}

export const REPLY_SUMMARY_LIMIT = 1_280

export interface ReplyRefusalDetail {
  readonly unreadQuestion?: UnreadQuestion
  path?: string
  resultDocumentProblem?: 'not-listed' | 'not-document'
  piece?: string
  label?: string
  state?: PieceRow['state']
  at?: number
  called?: string
  limit?: number
  was?: number
}

export interface ReplyRefusal {
  readonly rail: ReplyRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  readonly remedy: RefusalRemedy | null
  readonly detail: ReplyRefusalDetail
}

const LONG_SUMMARY_REMEDY = `Put the rest in ${HELD_FORMS_SAID} and name its path in resource_paths; the piece stays open. Nothing was shortened for you.`

const UNKEPT_FILE_KIND_NAMES: Readonly<Record<string, string>> = {
  '.zsh': 'a .zsh file',
  '.sh': 'a .sh file',
  '.ts': 'a .ts file',
  '.js': 'a .js file',
  '.json': 'a .json file',
  '.txt': 'a .txt file',
  '.zip': 'a .zip file',
  '.csv': 'a .csv file',
}

export function replyUnkeptFileReason(path: unknown): string {
  const dot = typeof path === 'string' ? path.lastIndexOf('.') : -1
  const slash = typeof path === 'string' ? path.lastIndexOf('/') : -1
  const extension = typeof path === 'string' && dot > slash + 1 ? path.slice(dot).toLowerCase() : ''
  const kind =
    (Object.hasOwn(UNKEPT_FILE_KIND_NAMES, extension)
      ? UNKEPT_FILE_KIND_NAMES[extension]
      : undefined) ?? 'a file of an unrecognised kind'
  return `This app does not keep ${kind}. It keeps ${HELD_FORMS_SAID}. Name its full path in summary instead of resource_paths; keep the file where it is. Nothing was kept or recorded.`
}

const REPLY_RECORDS = {
  'no-piece-by-that-name': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'you hold no open piece by that name, so nothing was recorded. list_tasks names the pieces you hold, by label, and only one it names can be replied to; sending that name again will never succeed.',
  },
  'a-person-gave-that-piece': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'that is this conversation’s own work — its root, which never ends — so there is nothing to reply about and nothing was recorded: answer the person here, in your own words. Work you took on with take_on_work is finished with reply_to_parent naming its piece.',
  },
  'piece-already-ended': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'stop work on that piece; no further reply is owed. It has ended, so nothing was recorded or changed. The detail says how it ended; retrying this piece cannot work.',
  },
  'summary-too-long': {
    permanence: 'while-this-holds',
    remedy: 'shorten-the-summary-and-attach-the-long-form',
    sentence: `Not handed back: the summary exceeds ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters. ${LONG_SUMMARY_REMEDY}`,
  },
  'result-document-not-returned': {
    permanence: 'permanent',
    remedy: null,
    sentence:
      'The main result document must be a Markdown file or page listed in resource_paths. Nothing was recorded.',
  },
  'a-conversation-with-its-questions-is-starting': {
    permanence: 'while-this-holds',
    remedy: 'make-the-same-call-when-this-settles',
    sentence:
      "that piece wasn't handed back: a conversation with a question about it is still starting. Try again in a moment.",
  },
  'its-questions-could-not-all-be-read': {
    permanence: 'while-this-holds',
    remedy: 'make-the-same-call-when-this-settles',
    sentence:
      "that piece wasn't handed back: its question records could not be read. Check that record, then retry this call.",
  },
} satisfies Record<
  string,
  {
    permanence: RailPermanence
    remedy: RefusalRemedy | null
    sentence: string
  }
>

export const REPLY_RAILS: readonly ReplyRail[] = Object.keys(REPLY_RECORDS) as ReplyRail[]

function longSummarySentence(detail: ReplyRefusalDetail): string {
  const was = detail.was
  if (was === undefined || !Number.isSafeInteger(was) || was < 0) {
    return REPLY_RECORDS['summary-too-long'].sentence
  }
  return `Not handed back: the summary is ${was.toLocaleString('en-US')} characters; the most is ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')}, so cut at least ${Math.max(0, was - REPLY_SUMMARY_LIMIT).toLocaleString('en-US')}. ${LONG_SUMMARY_REMEDY}`
}

function endedPieceSentence(detail: ReplyRefusalDetail): string {
  const by = detail.called === undefined ? '' : ` by ${detail.called}`
  const at = detail.at === undefined ? '' : ` at ${clockTime(detail.at)}`
  switch (detail.state) {
    case 'answered':
      return `stop work on that piece; no further reply is owed. You already replied${at}, so nothing was recorded or changed.`
    case 'withdrawn':
      return `stop work on that piece; no further reply is owed. It was taken back${by}${at}, so nothing was recorded or changed.`
    case 'closed':
      return `stop work on that piece; no further reply is owed. It was closed${by}${at}, so nothing was recorded or changed.`
    default:
      return REPLY_RECORDS['piece-already-ended'].sentence
  }
}

export function refuseReply(rail: ReplyRail, detail: ReplyRefusalDetail = {}): ReplyRefusal {
  const permanence = replyPermanenceOf(rail)
  return {
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(
      rail === 'piece-already-ended'
        ? endedPieceSentence(detail)
        : rail === 'summary-too-long'
          ? longSummarySentence(detail)
          : rail === 'a-conversation-with-its-questions-is-starting' && detail.label !== undefined
            ? aPieceNotEndedWhileAQuestionStarts(detail.label, 'work-replied')
            : rail === 'its-questions-could-not-all-be-read' && detail.label !== undefined
              ? aPieceNotEndedItsQuestionsUnread(
                  detail.label,
                  'work-replied',
                  detail.unreadQuestion,
                )
              : REPLY_RECORDS[rail].sentence,
    ),
    remedy: replyRemedyOf(rail),
    detail,
  }
}

export function admitReply(
  named: string,
  piece: PieceRow | undefined,
  root: boolean,
  summary: string,
  whatToCall: WhatToCallAConversation,
): ReplyRefusal | null {
  if (piece === undefined) {
    return refuseReply(root ? 'a-person-gave-that-piece' : 'no-piece-by-that-name', {
      piece: named,
    })
  }
  if (!TASK_IS_OPEN[piece.state]) {
    return refuseReply('piece-already-ended', {
      piece: named,
      label: piece.label,
      state: piece.state,
      ...(piece.endedAt === null ? {} : { at: piece.endedAt }),
      ...(piece.endedBy === null || piece.endedBy === piece.owner
        ? {}
        : { called: whatToCall(piece.endedBy) }),
    })
  }
  if (summary.length > REPLY_SUMMARY_LIMIT) {
    return refuseReply('summary-too-long', {
      piece: named,
      label: piece.label,
      limit: REPLY_SUMMARY_LIMIT,
      was: summary.length,
    })
  }
  return null
}

export const REPLY_DELIVERIES = ['sent', 'held', 'kept', 'not-delivered'] as const

export type ReplyDelivery = (typeof REPLY_DELIVERIES)[number]

export const REPLY_LANDED: Readonly<Record<ReplyDelivery, boolean>> = {
  sent: true,
  held: true,
  'not-delivered': false,
  kept: true,
}

export type ReplyOutcome =
  | {
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly resources: readonly string[]
      readonly resultDocument?: string
      readonly delivered: null
    }
  | ({
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly resources: readonly string[]
      readonly resultDocument?: string
      readonly giver: string
      readonly tookItsPlace: boolean
    } & (
      | {
          readonly delivered: 'sent'
          readonly why?: undefined
        }
      | {
          readonly delivered: 'held'
          readonly why?: string
        }
      | {
          readonly delivered: 'kept' | 'not-delivered'
          readonly why: string
        }
    ))
  | { readonly ok: false; readonly refusal: ReplyRefusal | ResourceRefusal }

export function resourcesNamed(
  resources: readonly { readonly resource: string; readonly name: string }[],
): string {
  return resources.map((one) => `${one.resource} (${one.name})`).join(', ')
}

export const READ_ONE_WITH_READ_DOCUMENT = 'Read one with read_document.'

export function resourcesSaid(
  lead: string,
  resources: readonly { readonly resource: string; readonly name: string }[],
): string {
  return `${lead}: ${resourcesNamed(resources)}. ${READ_ONE_WITH_READ_DOCUMENT}`
}

export function replyText(
  piece: Pick<PieceRow, 'label' | 'title'>,
  holder: string,
  reply: { outcome: TaskOutcome; summary: string; needsUserAction: boolean },
  resources: readonly { readonly resource: string; readonly name: string }[],
  aNewBriefWaited: boolean,
): string {
  const lines = [
    `${pieceLine(piece.label, piece.title)} was answered by ${holder}: ${reply.outcome}.`,
    ...(aNewBriefWaited
      ? [
          `This answers the brief before your new one, which had not reached ${holder} when it answered.`,
        ]
      : []),
    reply.summary,
  ]
  if (resources.length > 0) lines.push(resourcesSaid('Its resources', resources))
  if (reply.needsUserAction) {
    lines.push(`That agent said ${A_PERSON_MUST_ACT_SENTENCE}.`)
  }
  return lines.join('\n\n')
}

export function workAnswered(
  piece: Pick<PieceRow, 'piece' | 'label' | 'owner'>,
  reply: { outcome: TaskOutcome; needsUserAction: boolean },
  resources: readonly string[],
): WorkReport {
  return {
    piece: piece.piece,
    label: piece.label,
    owner: piece.owner,
    state: 'answered',
    outcome: reply.outcome,
    ...(resources.length === 0 ? {} : { resources }),
    ...(reply.needsUserAction ? { needsUserAction: true as const } : {}),
  }
}

export function workUndriven(
  piece: Pick<PieceRow, 'piece' | 'label' | 'owner'>,
  cause: TaskStallCause,
): WorkReport {
  return {
    piece: piece.piece,
    label: piece.label,
    owner: piece.owner,
    state: 'stalled',
    stalledBecause: cause,
  }
}

export type WhatToCallAConversation = (conversation: string) => string

export interface TheAskNamed {
  readonly by: WhoStoppedIt
  readonly called: string | null
  readonly byTheReader: boolean
}

export function theAskNamed(
  ask: PieceRow['stalledBy'],
  whatToCall: WhatToCallAConversation,
  reader: string,
): TheAskNamed | null {
  if (ask === null) return null
  if (ask.by === 'an-agent' && ask.asker !== null && ask.asker === reader) {
    return { by: ask.by, called: null, byTheReader: true }
  }
  return {
    by: ask.by,
    called: ask.asker === null ? null : whatToCall(ask.asker),
    byTheReader: false,
  }
}

export const AN_AGENT_THIS_APP_CANNOT_NAME = 'an agent this app cannot name'

const undrivenNotice = (
  cause: TaskStallCause,
  by: TheAskNamed | null,
  limit: TheLimitSaid | undefined,
  login: StoppedOnALogin | undefined,
): string => `${theStallAndItsAsk(cause, by, limit, login)}.`

function theLoginSentence(login: StoppedOnALogin): string {
  const words = providerDescriptor(login.provider ?? DEFAULT_IDENTITY_PROVIDER).words.loginRefusal
  const refused =
    login.onAKey === true ? words.key : login.reopened ? words.signInAfterReopen : words.signIn
  if (login.reopened) {
    return `${refused}; its conversation has been reopened since, and nothing from that turn was sent again`
  }
  return words.saysNotReopened
    ? `${refused}, and its conversation has not been reopened since`
    : refused
}

interface TheLimitSaid {
  readonly provider: string
  readonly resetsAt: number | null
  readonly named: boolean
  readonly now: number
}

function theLimitSentence(limit: TheLimitSaid): string {
  if (!limit.named && limit.resetsAt === null) {
    return `its turn ended because ${limit.provider} refused it on its plan or usage; ${limit.provider}’s own words are in that conversation`
  }
  const resets =
    limit.resetsAt === null ? '' : `; it resets at ${clockTimeFrom(limit.resetsAt, limit.now)}`
  return `its turn ended because ${limit.provider}’s usage limit was reached${resets}`
}

export function theLimitItStoppedOn(
  piece: Partial<Pick<PieceRow, 'stalledAt' | 'stoppedOnALimit'>>,
): TheLimitSaid | undefined {
  const limit = piece.stoppedOnALimit
  if (limit === undefined) return undefined
  const resetsAt = limit.resetsAt ?? null
  return {
    provider: PROVIDER_NAME[limit.provider],
    resetsAt,
    named: limit.window !== undefined,
    now: piece.stalledAt ?? resetsAt ?? 0,
  }
}

export function theStallAndItsAsk(
  cause: TaskStallCause,
  by: TheAskNamed | null,
  limit?: TheLimitSaid,
  login?: StoppedOnALogin,
): string {
  const stall =
    cause === 'provider_limited' && limit !== undefined
      ? theLimitSentence(limit)
      : cause === 'login_refused' && login !== undefined
        ? theLoginSentence(login)
        : undrivenSentence(cause)
  if (by?.byTheReader === true) return `${stall}; ${YOU_ASKED_IT_TO_STOP}`
  const ask = by === null ? null : { by: by.by, asker: by.called }
  return by !== null && cause !== 'turn_interrupted'
    ? `${stall}; it had been ${ASKED_TO_STOP}${askedByClause(ask)}`
    : `${stall}${askedByClause(ask)}`
}

export function undrivenWorkText(
  piece: Pick<PieceRow, 'label' | 'title' | 'questionLostAtRestart'> &
    Partial<
      Pick<PieceRow, 'stalledAt' | 'stoppedInTheBackground' | 'stoppedOnALimit' | 'stoppedOnALogin'>
    >,
  cause: TaskStallCause,
  exchange: Exchange,
  holder: string,
  askedToStop: TheAskNamed | null,
  nameOf: (who: AConversation) => string,
  mayReadIt: boolean,
  endedByTheRestart: boolean,
  stillRunning: readonly string[],
  endedByTheStop: readonly string[],
): string {
  const limit = cause === 'provider_limited' ? theLimitItStoppedOn(piece) : undefined
  const login = cause === 'login_refused' ? piece.stoppedOnALogin : undefined
  const said = undrivenNotice(cause, askedToStop, limit, login)
  const notWorkedOn = cause === 'provider_limited' ? '' : ' is not being worked on'
  const lines = [`${pieceLine(piece.label, piece.title)} with ${holder}${notWorkedOn}: ${said}`]
  if (limit !== undefined && limit.resetsAt !== null) {
    lines.push(`A message to ${holder} waits until then.`)
  }
  const stopped = whatStoppedWithIt(piece, cause, endedByTheRestart)
  if (stopped !== null) lines.push(stopped)
  if (cause === 'turn_interrupted' && endedByTheStop.length > 0) {
    lines.push(`The stop ended ${theStoppedWork(endedByTheStop)}.`)
  }
  if (stillRunning.length > 0) {
    lines.push(`${holder} still has ${theStoppedWork(stillRunning)} running in the background.`)
  }
  if (piece.questionLostAtRestart) {
    lines.push('A question that conversation had asked was still unanswered when the app stopped.')
  }
  lines.push(...exchangePreviewLines(holder, exchange, nameOf))
  if (mayReadIt) {
    lines.push(`To read more of that conversation, call read_transcript with agent ${piece.label}.`)
  }
  lines.push(`It has not been answered. Read its record with list_tasks, naming ${piece.label}.`)
  return lines.join('\n\n')
}

const STOPPED_NAMED = 3
const STOPPED_NAME_MAX = 120

export function theStoppedWork(stopped: readonly string[]): string {
  const quoted = stopped.slice(0, STOPPED_NAMED).map((one) => {
    const cut = one.length > STOPPED_NAME_MAX ? `${one.slice(0, STOPPED_NAME_MAX - 1)}…` : one
    return `“${cut}”`
  })
  const more = stopped.length - quoted.length
  if (more > 0) return `${quoted.join(', ')} and ${String(more)} more`
  if (quoted.length <= 1) return quoted.join('')
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1] ?? ''}`
}

export function whatStoppedWithIt(
  piece: Partial<Pick<PieceRow, 'stalledAt' | 'stoppedInTheBackground'>>,
  cause: TaskStallCause,
  endedByTheRestart: boolean,
): string | null {
  const stopped = piece.stoppedInTheBackground ?? []
  if (stopped.length === 0) return null
  if (cause !== 'background_stopped' && cause !== 'app_restarted') return null
  const named = theStoppedWork(stopped)
  const time =
    piece.stalledAt === null || piece.stalledAt === undefined ? null : clockTime(piece.stalledAt)
  if (cause === 'background_stopped') {
    if (endedByTheRestart) {
      return time === null
        ? `That was ${named}, which the app’s restart stopped.`
        : `That was ${named}, which the app’s restart at ${time} stopped.`
    }
    return time === null
      ? `That was ${named}.`
      : `That was ${named}; its conversation ended at ${time}.`
  }
  return time === null
    ? `It was waiting on ${named}, which did not survive the app’s restart.`
    : `It was waiting on ${named}, which did not survive the app’s restart (it started again at ${time}).`
}

export type WhatMadeItFalse =
  'asked-about-it' | 'rebriefed' | Extract<TaskState, 'withdrawn' | 'answered' | 'closed'>

const WHAT_MADE_IT_FALSE: Readonly<Record<WhatMadeItFalse, (holder: string) => string>> = {
  'asked-about-it': (holder) => `this conversation asked ${holder} about that work`,
  rebriefed: (holder) => `this conversation gave ${holder} a new brief for that work`,
  withdrawn: () => 'this conversation withdrew that work',
  answered: (holder) => `${holder} answered that work`,
  closed: () => 'this conversation closed that work',
}

export function aNoticeALaterFactRetracted(fact: WhatMadeItFalse, holder: string): string {
  return `${TAKEN_BACK_UNREAD}: ${WHAT_MADE_IT_FALSE[fact](holder)}`
}

const TAKEN_BACK_UNREAD = 'taken back by this app before it was read, because it was no longer true'

const WHY_A_QUESTION_NO_LONGER_WAITS: Readonly<
  Record<Exclude<RequestState, 'open'>, (asker: string) => string>
> = {
  answered: (asker) => `${asker}'s question had already been answered`,
  rejected: (asker) => `${asker}'s question had already been declined`,
  decided: (asker) => `${asker}'s request had already been settled`,
  withdrawn: (asker) => `${asker}'s question had been withdrawn`,
  abandoned: (asker) => `${asker} stopped, and its question went with it`,
  stranded: (asker) => `${asker}'s question was lost when this app stopped`,
  interrupted: (asker) => `${asker}'s question ended when its work was stopped`,
  'work-withdrawn': (asker) => `${asker}'s question was about work that had been taken back`,
  'work-closed': (asker) => `${asker}'s question was about work that had been closed`,
  'work-replied': (asker) => `${asker}'s question was about work that had been handed back`,
  'recipient-ended': (asker) => `this conversation stopped before it answered ${asker}'s question`,
}

export function aQuestionNoticeALaterFactRetracted(
  ended: Exclude<RequestState, 'open'>,
  asker: string,
): string {
  return `${TAKEN_BACK_UNREAD}: ${WHY_A_QUESTION_NO_LONGER_WAITS[ended](asker)}`
}

export function messageNamingThePiece(
  text: string,
  piece: {
    readonly label: string
    readonly definitionOfDone?: string
    readonly inputs: readonly { readonly resource: string; readonly name: string }[]
    readonly grant?: string
    readonly outputFolder?: string
  } | null,
): string {
  if (piece === null) return text
  const { label } = piece
  const inputs = piece.inputs.length === 0 ? '' : `${resourcesSaid('Its inputs', piece.inputs)} `
  const grant =
    piece.grant === undefined
      ? ''
      : `While it is open you may also work in ${piece.grant}: your working folder is unchanged, so write paths there in full. `
  const output =
    piece.outputFolder === undefined ? '' : `Put this piece's output in ${piece.outputFolder}. `
  const line =
    `This is piece ${label}. ${inputs}${grant}${output}Finish it by calling reply_to_parent with piece ${label}. ` +
    `If you need a decision before you can finish it, call ask_question with piece ${label} and ` +
    `who_answers — that keeps the work yours, where reply_to_parent hands it back.`
  const condition =
    piece.definitionOfDone === undefined ? '' : `Done when: ${piece.definitionOfDone}\n\n`
  return text.trim() === '' ? `${condition}${line}` : `${text}\n\n${condition}${line}`
}
