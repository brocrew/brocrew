import { MAX_INSTANT, clockTimeFrom } from '../../shared/clock'
import type { CurrentRules } from '../../shared/conversation-title'
import { localFields, localFormat } from '../../shared/local-time'
import type { PieceRow } from '../../shared/task-contracts'
import { WORK_BRIEF_CHARS } from '../../shared/work-fields'
import { providerFailureDiagnosis } from '../../shared/work-reconciliation'

/**
 * 🔴 **The block of this app's own words at the end of what a turn hands its agent.**
 *
 * ⚑ **One home for every sentence this app adds after the message**: the time; on a turn this app
 * started, when the person last wrote; and what the agent has open — its own questions to the
 * person, and who waits on it. ⛔ **Always last, and always marked as this app's**: its first line
 * says the message above comes first, so words a person typed are never read as this app's, and
 * are answered before anything here is acted on.
 *
 * ⛔ **Nothing here reads anything**: the host hands in what it found, and this file only says it.
 */

/** The line the block begins with, alone on its line: what follows it is this app's. */
export const THE_BLOCK_BEGINS = '—'

/** The most questions of its own the block names; the rest are counted. */
export const OPEN_QUESTIONS_NAMED = 5

/** How much of a question's first line the block quotes. */
const FIRST_WORDS = 80

/** How long to wait before repeating a confirmed person queue. */
export const WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS = 2 * 60 * 60_000
const TURN_LABEL_POINTS = 128

export const TURN_BLOCK_WORDS = {
  nobody: 'Nothing of yours is waiting on the person.',
  replyQuestion:
    'Your last reply asked the person something, but nothing is under Waiting on you. Ask it with ask_question if it still matters.',
  currentNone: 'Your current work: none.',
  currentAmbiguous: (labels: readonly string[], more: number): string =>
    `You hold ${String(labels.length + more)} tasks: ${labels.join(', ')}${more > 0 ? ` and ${String(more)} more` : ''}. list_tasks shows them.`,
  openHeld: (count: number): string =>
    count === 1
      ? 'You hold 1 open task. list_tasks shows it.'
      : `You hold ${String(count)} open tasks. list_tasks shows them.`,
  helpersHeading: 'Work you gave, still open:',
  waitingOnThePerson: 'waiting on the person',
  currentUnavailable: 'Your current work is not available. list_tasks shows what you hold.',
  untitled: 'untitled',
  helper: (
    conversation: string,
    label: string,
    name: string,
    state: string,
    age: string | null,
    context: number | null,
  ): string =>
    `${conversation} · task ${label} · ${name} · ${state}${age === null ? '' : ` · state updated ${age}`}${context === null ? '' : ` · context ${String(context)}%`}`,
  more: (count: number, incomplete = false): string =>
    `and ${incomplete ? 'at least ' : ''}${String(count)} more: list_tasks`,
  updateGivenWork: 'Check this work and make any needed updates.',
  current: (label: string, title: string, conversation: string): string =>
    `Your current work: task ${label} · ${title}, in ${conversation}${conversation.endsWith('.') ? '' : '.'}`,
  currentRules: (by: 'agent' | 'person', ago: string): string =>
    `Your current rules, set by ${by === 'person' ? 'the person' : 'you'} ${ago}:`,
  keepCurrentRules:
    'Keep these up to date with update_work current_rules, and remove any that no longer apply.',
} as const

export interface AHelperInTheTurn {
  readonly piece: string
  readonly label: string
  readonly owner: string
  readonly conversation: string
  readonly name: string
  readonly state: string | null
  readonly givenAt: number
  readonly changedAt: number | null
  readonly urgent: boolean
  readonly providerTurnFailure?: NonNullable<PieceRow['providerTurnFailure']>
}

export type CurrentWorkInTheTurn =
  | {
      readonly kind: 'piece'
      readonly label: string
      readonly title: string | null
      readonly status: string | null
    }
  | { readonly kind: 'ambiguous'; readonly labels: readonly string[]; readonly more: number }
  | { readonly kind: 'none' | 'unavailable' }

interface OtherConversation {
  readonly id: string
  readonly title: string | null
  readonly line: string
  readonly lastActiveAt: number | null
}

export interface OtherConversations {
  readonly shown: readonly OtherConversation[]
  readonly more: number
}

function anotherConversationLine(other: OtherConversation): string {
  const named = `  - ${other.line}`
  const at = other.lastActiveAt
  if (at === null || !Number.isFinite(at) || Math.abs(at) > MAX_INSTANT) {
    return `${named} — last activity unknown.`
  }
  const wall = localFields(at)
  if (!Number.isFinite(wall.year) || wall.year < 0 || wall.year > 9999)
    return `${named} — last activity unknown.`
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${String(wall.year).padStart(4, '0')}-${pad(wall.month + 1)}-${pad(wall.date)}`
  const time = `${pad(wall.hours)}:${pad(wall.minutes)}`
  const civil = new Date(0)
  civil.setUTCFullYear(wall.year, wall.month, wall.date)
  civil.setUTCHours(wall.hours, wall.minutes, wall.seconds, 0)
  const offset = (civil.getTime() - Math.floor(at / 1000) * 1000) / 1000
  const absolute = Math.abs(offset)
  const seconds = absolute % 60
  const zone =
    offset === 0
      ? 'UTC'
      : `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(absolute / 3600))}:${pad(Math.floor(absolute / 60) % 60)}${seconds === 0 ? '' : `:${pad(seconds)}`}`
  return `${named} — last active ${date} at ${time} ${zone}.`
}

export const OTHER_CONVERSATIONS_SHOWN = 5

export function peerActivityText(others: OtherConversations, includeTimes = true): string {
  if (others.shown.length === 0) return ''
  return [
    '- Other conversations of this profile, newest first (list_agents shows more):',
    ...others.shown.map((other) =>
      includeTimes ? anotherConversationLine(other) : `  - ${other.line}`,
    ),
    ...(others.more > 0 ? [`  - and ${String(others.more)} more.`] : []),
  ].join('\n')
}

export interface ExtraTurnFacts {
  readonly profileChanges?: readonly string[]
  readonly helpers?: {
    readonly rows: readonly AHelperInTheTurn[]
    readonly more: number
    readonly incomplete?: boolean
  }
  readonly conversation?: string
  readonly currentContext?: number | null
  readonly contextOf?: (conversation: string) => number | null
  readonly nobodyWaiting?: boolean
  readonly replyQuestion?: boolean
  readonly currentWork?: CurrentWorkInTheTurn
  /** The conversation's current rules and who set them last, said on every turn they exist. */
  readonly currentRules?: CurrentRules | null
  readonly openHeldCount?: number
}

/**
 * Current rules as the footer lists them: who set them last and when, one item per non-blank line,
 * then what to do with them.
 */
function currentRulesLines(current: CurrentRules | null | undefined, now: number): string[] {
  const rules = (current?.text ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim().replace(/^[-*•]\s+/, ''))
    .filter((line) => line !== '')
  if (current == null || rules.length === 0) return []
  return [
    TURN_BLOCK_WORDS.currentRules(current.by, howLongAgo(current.at, now)),
    ...rules.map((rule) => `- ${rule}`),
    TURN_BLOCK_WORDS.keepCurrentRules,
  ]
}

function oneLine(text: string, limit: number): string {
  const cleaned = [...text]
    .map((point) => {
      const code = point.codePointAt(0)!
      return code <= 31 || code === 127 ? ' ' : point
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const points = [...cleaned]
  return points.length > limit ? `${points.slice(0, limit).join('')}…` : points.join('')
}

function currentLabel(current?: CurrentWorkInTheTurn): string | null {
  return current?.kind === 'piece' && [...current.label].length <= TURN_LABEL_POINTS
    ? current.label
    : null
}

function extraLines(facts: ExtraTurnFacts, now: number): string[] {
  const lines: string[] = []
  let nudged = false
  if (facts.helpers !== undefined) {
    const { more } = facts.helpers
    const rows = facts.helpers.rows.filter((row) => row.state !== null)
    if (rows.length > 0) lines.push(TURN_BLOCK_WORDS.helpersHeading)
    lines.push(
      ...rows.slice(0, 5).map((row) => {
        const label = [...row.label].length <= TURN_LABEL_POINTS ? row.label : row.piece
        if (row.providerTurnFailure !== undefined) {
          const conversation = row.conversation.replace(/^conversation /, 'Conversation ')
          const cause = oneLine(row.providerTurnFailure.message, WORK_BRIEF_CHARS)
          return `- ${providerFailureDiagnosis(conversation, cause)} · task ${label} · recorded failed turn ${String(row.providerTurnFailure.turnOrdinal)}`
        }
        return `- ${TURN_BLOCK_WORDS.helper(
          row.conversation,
          label,
          oneLine(row.name, 64),
          oneLine(row.state!, 100),
          row.changedAt === null ? null : howLongAgo(row.changedAt, now),
          facts.contextOf?.(row.owner) ?? null,
        )}`
      }),
    )
    const overflow = more + Math.max(0, rows.length - 5)
    if (overflow > 0) lines.push(TURN_BLOCK_WORDS.more(overflow, facts.helpers.incomplete === true))
    else if (facts.helpers.incomplete === true) lines.push('list_tasks shows the work you gave.')
    if (rows.length > 0) {
      lines.push(TURN_BLOCK_WORDS.updateGivenWork)
      nudged = true
    }
  }
  if (facts.nobodyWaiting === true) lines.push(TURN_BLOCK_WORDS.nobody)
  if (facts.replyQuestion === true) lines.push(TURN_BLOCK_WORDS.replyQuestion)
  const current = facts.currentWork
  if (current !== undefined) {
    if (
      (current.kind === 'piece' && currentLabel(current) === null) ||
      (current.kind === 'ambiguous' &&
        current.labels.some((label) => [...label].length > TURN_LABEL_POINTS))
    )
      lines.push(TURN_BLOCK_WORDS.currentUnavailable)
    else if (current.kind === 'piece') {
      lines.push(
        TURN_BLOCK_WORDS.current(
          current.label,
          oneLine(current.title ?? TURN_BLOCK_WORDS.untitled, 200),
          facts.conversation ?? 'this conversation',
        ),
      )
      if (!nudged) lines.push(TURN_BLOCK_WORDS.updateGivenWork)
    } else
      lines.push(
        current.kind === 'none'
          ? TURN_BLOCK_WORDS.currentNone
          : current.kind === 'ambiguous'
            ? TURN_BLOCK_WORDS.currentAmbiguous(
                current.labels.slice(0, 5),
                current.more + Math.max(0, current.labels.length - 5),
              )
            : TURN_BLOCK_WORDS.currentUnavailable,
      )
  }
  lines.push(...currentRulesLines(facts.currentRules, now))
  const count = facts.openHeldCount ?? 0
  if (count > 0) lines.push(TURN_BLOCK_WORDS.openHeld(count))
  const context = facts.currentContext ?? null
  if (context !== null) lines.push(`Your context: ${String(context)}% used.`)
  return lines
}

/** A question the conversation asked, still open. */
export interface AQuestionItHasOpen {
  readonly id: string
  readonly askedAt: number
  readonly prompt: string
  readonly recipient?: string
}

/** Someone who gave the conversation a piece it still holds open. */
interface AGiverWaitingOnIt {
  /** The giver, as a sentence names a conversation. */
  readonly who: string
  /** The piece: its label and title. */
  readonly work: string
}

/** Someone whose question to the conversation is still open. */
interface AnAskerWaitingOnIt {
  readonly who: string
  readonly id: string
  readonly askedAt: number
}

/** Who waits on the conversation: the givers of its open pieces, and its open askers. */
export interface WhoWaitsOnIt {
  readonly givers: readonly AGiverWaitingOnIt[]
  readonly askers: readonly AnAskerWaitingOnIt[]
}

const nowFormat = localFormat({
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** How long ago a moment was, in the largest whole unit: minutes, hours or days. */
export function howLongAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${String(days)} ${days === 1 ? 'day' : 'days'} ago`
}

function itsFirstWords(prompt: string): string {
  const line = prompt.split(/\r\n|\r|\n/)[0]?.trim() ?? ''
  const points = [...line]
  return points.length > FIRST_WORDS ? `${points.slice(0, FIRST_WORDS).join('')}…` : line
}

function itsOpenQuestions(questions: readonly AQuestionItHasOpen[], now: number): string[] {
  if (questions.length === 0) return []
  const named = questions.slice(0, OPEN_QUESTIONS_NAMED).map((one) => {
    const asked = itsFirstWords(one.prompt)
    const lead = `- ${one.id} to ${one.recipient ?? 'the person'}, asked ${howLongAgo(one.askedAt, now)}`
    return asked === '' ? lead : `${lead}: “${asked}”`
  })
  const more = questions.length - named.length
  return [
    "Questions you're waiting on:",
    ...named,
    ...(more > 0 ? [`and ${String(more)} more: list_questions`] : []),
    "Withdraw one you don't need with withdraw_question; withdraw your questions about a task when it ends.",
  ]
}

function whoWaitsOnIt(waiting: WhoWaitsOnIt, now: number, selected: string | null): string[] {
  if (waiting.givers.length + waiting.askers.length === 0) return []
  const givers = waiting.givers.slice(0, OPEN_QUESTIONS_NAMED)
  const askers = waiting.askers.slice(0, OPEN_QUESTIONS_NAMED - givers.length)
  const moreWork = waiting.givers.length - givers.length
  const moreAskers = waiting.askers.length - askers.length
  return [
    'Waiting on you:',
    ...givers.map(
      (one) =>
        `- ${one.who} gave you ${one.work === selected ? 'the current task' : `task ${one.work}`} and is waiting for it.`,
    ),
    ...askers.map(
      (one) =>
        `- ${one.who} asked you ${one.id} ${howLongAgo(one.askedAt, now)}. ` +
        'Answer it with answer_question.',
    ),
    ...(moreWork > 0 ? [TURN_BLOCK_WORDS.more(moreWork)] : []),
    ...(moreAskers > 0 ? [`and ${String(moreAskers)} more: list_questions`] : []),
  ]
}

/**
 * 🔴 **The block, whole.** ⚑ The time on every turn. ⚑ On a turn this app started
 * (`aPersonStartedIt` false), when the person last wrote — `null` means that time is unknown.
 * Its open questions, and who waits on it, as the host hands them in.
 *
 * An unknown list makes no absence claim. The host can separately supply a confirmed-empty
 * person queue, helper changes and the current work.
 */
export function whatThisAppAddsToATurn(turn: {
  readonly now: number
  readonly aPersonStartedIt: boolean
  readonly thePersonLastWroteAt: number | null
  readonly questions: readonly AQuestionItHasOpen[] | null
  readonly waiting: WhoWaitsOnIt | null
  readonly extra?: ExtraTurnFacts
}): string {
  const { now } = turn
  const itIs = `It is ${nowFormat(now)}.`
  const lastWrote =
    turn.thePersonLastWroteAt === null
      ? 'The last time the person wrote here is unknown.'
      : `The person last wrote in this conversation at ${clockTimeFrom(turn.thePersonLastWroteAt, now)}.`
  return [
    THE_BLOCK_BEGINS,
    turn.aPersonStartedIt
      ? 'This app adds what follows. It is not part of the person’s message above, and that message comes first.'
      : 'This app adds what follows. It is not part of the message above, and that message comes first.',
    turn.aPersonStartedIt ? itIs : `${itIs} ${lastWrote}`,
    ...(turn.questions === null ? [] : itsOpenQuestions(turn.questions, now)),
    ...(turn.waiting === null
      ? []
      : whoWaitsOnIt(turn.waiting, now, currentLabel(turn.extra?.currentWork))),
    ...extraLines(turn.extra ?? {}, now),
    ...(turn.extra?.profileChanges ?? []),
  ].join('\n')
}
