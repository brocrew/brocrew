import { CHANNEL_REFUSAL_SENTENCES, type AgentToolAnswer } from '@brobot2/runtime'
import { clockTimeFrom } from '../../shared/clock'
import type { HowWorkStopped } from '../../shared/how-work-stopped'
import {
  PERMANENCE_SAID,
  isRailPermanence,
  refusalReason,
  type RailPermanence,
} from '../../shared/refusals'

export const DONE = 'Done.'

export function doneWithThePiece(label: string): string {
  return `Done. ${label}.`
}

export function tookOnForPerson(label: string, parent: string): string {
  return `Took on ${label} under ${parent} for the person.`
}

export function tookOn(label: string): string {
  return `Took on ${label}.`
}

export function createdAndNamed(name: string): string {
  return `Created; this app named it ${name}.`
}

export const CREATED_UNDER_ITS_PROFILE_NAME = 'Created; it goes by its profile name.'

export const ITS_RULES_ARE_SAVED = 'Its rules are saved.'

export const RULES_WRITTEN =
  "Written: it reaches that agent's next conversation, not one already running."

export const RULES_PUT_BEFORE_A_PERSON =
  'Put in front of a person: nothing is written unless they approve it.'

export function keptResources(resources: readonly string[]): string {
  return `Kept: ${resources.join(', ')}.`
}

export const HOW_THE_LAST_TURN_ENDED: Readonly<Record<HowWorkStopped, string>> = {
  'it-finished': 'it finished',
  'it-was-stopped': 'it was stopped',
  'the-provider-faulted': 'its provider failed',
  'it-was-stopped-and-it-faulted': 'it was stopped, and its provider failed',
  'nothing-has-said': 'this app did not see how it ended',
}

export type WhenItWasAskedToStop = 'no-turn-running' | 'an-earlier-turn' | 'the-turn-running-now'

const WHEN_IT_WAS_ASKED_TO_STOP: Readonly<Record<WhenItWasAskedToStop, string>> = {
  'no-turn-running': 'when no turn was running',
  'an-earlier-turn': 'in a turn that ended before its last',
  'the-turn-running-now': 'in the turn running now',
}

export function lastAskedToStop(time: string, when?: WhenItWasAskedToStop): string {
  return when === undefined
    ? `It was last asked to stop at ${time}.`
    : `It was last asked to stop at ${time}, ${WHEN_IT_WAS_ASKED_TO_STOP[when]}.`
}

export function heldBy(holder: string): string {
  return `held by ${holder}`
}

export function theHolderIsNow(stateWords: string): string {
  return `the conversation holding it is now ${stateWords}`
}

export function itsInputs(files: readonly string[]): string {
  return `Its inputs: ${files.join(', ')}.`
}

export function whatWasMadeForIt(files: readonly string[]): string {
  return `What was made for it: ${files.join(', ')}.`
}

export function handedBackWithItsAnswer(files: readonly string[]): string {
  return `Handed back with its answer: ${files.join(', ')}.`
}

export interface AWindowReported {
  readonly window: string
  readonly first: string
  readonly last: string
}

export function windowsReported(provider: string, windows: readonly AWindowReported[]): string {
  const each = windows.map((one) => `${one.window} (first ${one.first}, last ${one.last})`)
  return `Windows ${provider} has reported: ${each.join('; ')}.`
}

export const THE_CONVERSATION_THAT_GAVE_YOU_THIS_WORK = 'the conversation that gave you this work'

export const A_PERSON = 'a person'

export function filesHoldingThoseWords(scope: string): string {
  return `Files ${scope} holding those words, newest first:`
}

export function noFileHoldsThoseWords(scope: string): string {
  return `No file ${scope} holds those words.`
}

export const FIX_IT_AND_CALL_AGAIN = 'Fix it and call again.'

const THIS_REFUSAL_HOLDS = 'This refusal holds'

export function permanenceInWords(rail: string, permanence: RailPermanence): string {
  if (permanence === 'permanent') {
    const never = `${capitalised(PERMANENCE_SAID.permanent)}.`
    return rail === 'malformed-request' ? `${never} ${FIX_IT_AND_CALL_AGAIN}` : never
  }
  return `${THIS_REFUSAL_HOLDS} ${PERMANENCE_SAID[permanence]}.`
}

export interface AnswerWordsContext {
  readonly me: string
  readonly addressOf: (conversation: string) => string
  readonly readAt: number
}

type DetailSaid = (
  detail: Readonly<Record<string, unknown>>,
  context: AnswerWordsContext,
) => string[]

const aText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const aCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    : []

const ERROR_CODE = /^E[A-Z0-9]+$/

const ENDS_A_SENTENCE = /[.!?…]["'”’)]*$/u

function aSentence(words: string): string {
  const trimmed = words.trimEnd()
  return ENDS_A_SENTENCE.test(trimmed) ? trimmed : `${trimmed}.`
}

function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const problemsSaid = (detail: Readonly<Record<string, unknown>>): string[] => {
  const problems = texts(detail['problems']).map((one) => one.trim().replace(/[.;]+$/u, ''))
  return problems.length === 0 ? [] : [aSentence(`Problems: ${problems.join('; ')}`)]
}

const A_START_DID_NOT_HAPPEN_BECAUSE: Readonly<Record<string, string>> = {
  cancelled: 'it was stopped before it opened',
  'shutting-down': 'BroCrew is shutting down',
  'lost-its-place': 'it was closed while it was opening',
  'nothing-names-a-model': 'nothing names a model for it',
  'its-provider-could-not-be-started': 'its provider could not be started',
}

export const THE_PROVIDER_PROGRAM_IS_UNAVAILABLE = 'The provider program is unavailable.'

const theErrorAndItsProvider: DetailSaid = (detail) => {
  const said: string[] = []
  const because = aText(detail['because'])
  if (because === 'provider-binary-unavailable') said.push(THE_PROVIDER_PROGRAM_IS_UNAVAILABLE)
  if (because !== undefined && ERROR_CODE.test(because)) said.push(`The error was ${because}.`)
  const provider = aText(detail['providerSaid'])
  if (provider !== undefined) {
    said.push(
      ENDS_A_SENTENCE.test(provider)
        ? `Its provider said: “${provider}”`
        : `Its provider said: “${provider}”.`,
    )
  }
  return said
}

const thisAppSaid: DetailSaid = (detail) => {
  const said = aText(detail['said'])
  return said === undefined ? [] : [aSentence(`This app said: ${said}`)]
}

const A_QUESTION_ENDED: Readonly<Record<string, string>> = {
  answered: 'already answered',
  rejected: 'already declined',
  decided: 'already settled',
  withdrawn: 'taken back by the conversation that asked it',
  abandoned: 'given up',
  stranded: 'left behind when this app stopped',
  interrupted: 'ended when the turn that asked it was stopped',
  'work-withdrawn': 'about work that was taken back',
  'work-closed': 'about work that was closed',
  'work-replied': 'about work that was handed back',
  'recipient-ended': 'closed when the one it was asked of was ended',
}

function sizeSaid(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} bytes`
  const kilobytes = Math.round(bytes / 100) / 10
  return kilobytes < 1_000
    ? `${String(kilobytes)} KB`
    : `${String(Math.round(bytes / 100_000) / 10)} MB`
}

function sizesSaid(bytes: number, limit: number): readonly [string, string] {
  const [size, most] = [sizeSaid(bytes), sizeSaid(limit)]
  if (size !== most) return [size, most]
  const exactly = (count: number): string => `${count.toLocaleString('en-US')} bytes`
  return [exactly(bytes), exactly(limit)]
}

const theFile: DetailSaid = (detail) => {
  const path = aText(detail['path'])
  return path === undefined ? [] : [aSentence(`The file was ${path}`)]
}

function askersSaid(
  detail: Readonly<Record<string, unknown>>,
  context: AnswerWordsContext,
): string[] {
  const askers = texts(detail['askers']).map((one) => context.addressOf(one))
  return askers.length === 0 ? [] : [`Those that asked it: ${askers.join(', ')}.`]
}

const DETAIL_SAID: Readonly<Record<string, DetailSaid>> = {
  'result-document-not-returned': (detail) => {
    const path = detail['path']
    const problem = detail['resultDocumentProblem']
    if (typeof path !== 'string' || (problem !== 'not-listed' && problem !== 'not-document'))
      return []
    return [`${path} is ${problem === 'not-listed' ? 'not listed' : 'not Markdown or a page'}.`]
  },
  'malformed-request': problemsSaid,
  'agent-did-not-start': (detail) => {
    const because = aText(detail['because'])
    const words =
      because !== undefined && Object.hasOwn(A_START_DID_NOT_HAPPEN_BECAUSE, because)
        ? A_START_DID_NOT_HAPPEN_BECAUSE[because]
        : undefined
    return words === undefined ? [] : [`It did not start because ${words}.`]
  },
  'agent-could-not-be-started': theErrorAndItsProvider,
  'that-conversation-could-not-be-resumed': theErrorAndItsProvider,
  'agent-cannot-take-a-message': thisAppSaid,
  'it-could-not-be-restored': thisAppSaid,
  'that-piece-was-already-answered': (detail, context) => {
    const label = aText(detail['label'])
    if (label === undefined) return []
    const outcome = aText(detail['answered'])
    const at = aCount(detail['at'])
    const time = at === undefined ? '' : clockTimeFrom(at, context.readAt)
    const how = outcome === undefined ? '' : ` ${outcome}`
    const when = time === '' ? '' : ` at ${time}`
    const said = [`${label} was answered${how}${when}.`]
    const resources = texts(detail['resources'])
    if (resources.length > 0) said.push(`Its reply handed in ${resources.join(', ')}.`)
    return said
  },
  'a-person-answers-this-one': (detail) => {
    const because = aText(detail['because'])
    return because !== undefined && Object.hasOwn(CHANNEL_REFUSAL_SENTENCES, because)
      ? [
          aSentence(
            `It is ${CHANNEL_REFUSAL_SENTENCES[because as keyof typeof CHANNEL_REFUSAL_SENTENCES]}`,
          ),
        ]
      : []
  },
  'question-has-already-ended': (detail, context) => {
    const state = aText(detail['state'])
    if (state !== undefined && Object.hasOwn(A_QUESTION_ENDED, state)) {
      return [`It was ${A_QUESTION_ENDED[state] ?? state}.`]
    }
    const said = thisAppSaid(detail, context)
    return said.length === 0
      ? []
      : [`${capitalised(HOW_THE_LAST_TURN_ENDED['nothing-has-said'])}.`, ...said]
  },
  'that-answer-cannot-be-sent': thisAppSaid,
  'more-than-one-question-has-that-id': askersSaid,
  'that-conversation-did-not-ask-that': askersSaid,
  'name-the-piece-you-ask-about': (detail) => {
    const held = texts(detail['held'])
    return held.length === 0 ? [] : [`You hold ${held.join(', ')}.`]
  },
  'it-is-waiting-on-an-answer': (detail, context) => {
    const askedOf = aText(detail['askedOf'])
    if (askedOf === undefined) return []
    return [`It waits on ${askedOf === context.me ? 'you' : context.addressOf(askedOf)}.`]
  },
  'resource-unreadable': theFile,
  'resource-not-a-form-this-app-keeps': theFile,
  'resource-empty': theFile,
  'resource-not-text': theFile,
  'resource-too-large': (detail, context) => {
    const bytes = aCount(detail['bytes'])
    const limit = aCount(detail['limit'])
    if (bytes === undefined || limit === undefined) return theFile(detail, context)
    const [size, most] = sizesSaid(bytes, limit)
    return [...theFile(detail, context), `It is ${size}; the most kept of that kind is ${most}.`]
  },
  'resource-could-not-be-kept': (detail) => {
    const path = aText(detail['path'])
    const problem = aText(detail['problem'])
    return path === undefined || problem === undefined ? [] : [aSentence(`${path}: ${problem}`)]
  },
}

function labelAndPermanence(structured: Readonly<Record<string, unknown>>, rail: string): string[] {
  const clauses: string[] = []
  const unused = aText(structured['label_not_used'])
  if (unused !== undefined)
    clauses.push(`The label ${unused} was used up by this failed give and names no piece.`)
  const permanence = structured['permanence']
  if (isRailPermanence(permanence) && rail !== 'result-document-not-returned')
    clauses.push(permanenceInWords(rail, permanence))
  return clauses
}

function whatARefusalAdds(
  structured: Readonly<Record<string, unknown>> | undefined,
  context: AnswerWordsContext,
): string {
  if (structured === undefined || structured['outcome'] !== 'refused') return ''
  const rail = aText(structured['rail']) ?? ''
  const detail = detailOf(structured)
  const said = Object.hasOwn(DETAIL_SAID, rail) ? (DETAIL_SAID[rail]?.(detail, context) ?? []) : []
  said.push(...labelAndPermanence(structured, rail))
  return said.join(' ')
}

export function answerInWords(
  answered: AgentToolAnswer,
  context: AnswerWordsContext,
): AgentToolAnswer {
  if (answered.structured?.['outcome'] === 'refused') {
    const reason = answered.structured['reason']
    if (typeof reason === 'string') refusalReason(reason)
  }
  const adds = whatARefusalAdds(answered.structured, context)
  if (adds === '') return answered
  const said = answered.text.trimEnd()
  if (said.endsWith(adds)) return answered
  const text = said === '' ? adds : `${aSentence(said)} ${adds}`
  return answered.structured === undefined ? { text } : { text, structured: answered.structured }
}

function detailOf(
  structured: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const raw = structured['detail']
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Readonly<Record<string, unknown>>)
    : {}
}

export function appOnlyRefusalQuote(
  structured: Readonly<Record<string, unknown>> | undefined,
  finalText?: string,
  problemsAreOurs = false,
): string | undefined {
  if (structured?.['outcome'] !== 'refused') return undefined
  const reason = structured?.['reason']
  if (typeof reason !== 'string' || reason === '') return undefined
  if (finalText === undefined) return reason
  refusalReason(reason)
  const rail = aText(structured?.['rail'])
  if (rail === undefined || !finalText.startsWith(`refused (${rail}): ${reason}`))
    throw new Error('A fresh refusal quote must prefix its composed answer.')
  const clauses: string[] =
    problemsAreOurs && rail === 'malformed-request' ? problemsSaid(detailOf(structured)) : []
  clauses.push(...labelAndPermanence(structured, rail))
  const prefix = `refused (${rail}): `
  const base = `${prefix}${reason}`
  const candidate = clauses.length === 0 ? base : `${aSentence(base)} ${clauses.join(' ')}`
  const quote = candidate.slice(prefix.length)
  return finalText === candidate && quote.startsWith(reason) ? quote : reason
}
