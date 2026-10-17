import { clockTimeFrom } from '../../shared/clock'
import { localFormat } from '../../shared/local-time'

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

/** How long a list this app's own turns already carried stays unsaid while it does not change. */
export const WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS = 2 * 60 * 60_000
export const TURN_LABEL_POINTS = 128

export const TURN_BLOCK_WORDS = {
  nobody: 'Nothing of yours is waiting on the person.',
  helpersUnavailable: "Helpers' status is not fully available. list_tasks shows the work you gave.",
  replyQuestion:
    'Your last reply asked the person something, but nothing is under Waiting on you. Ask it with ask_question if it still matters.',
  currentNone: 'Your current work: none.',
  currentAmbiguous: (labels: string, more: number): string =>
    `You hold several pieces: ${labels}${more > 0 ? ` and ${String(more)} more` : ''}. list_tasks shows them.`,
  helpersHeading: 'Work you gave:',
  waitingOnThePerson: 'waiting on the person',
  currentUnavailable: 'Your current work is not available. list_tasks shows what you hold.',
  untitled: 'untitled',
  noStatus: 'none',
  helper: (label: string, name: string, state: string, age: string | null): string =>
    `${label} · ${name} · ${state}${age === null ? '' : ` · ${age}`}`,
  ended: (outcome: string): string => `ended: ${outcome}`,
  unchanged: (count: number): string =>
    `Work you gave: ${String(count)} ${count === 1 ? 'piece' : 'pieces'} out, no change.`,
  more: (count: number): string => `and ${String(count)} more: list_tasks`,
  current: (label: string, title: string, status: string): string =>
    `Your current work: ${label} · ${title} · status: ${status}. If either no longer fits, update it with update_work.`,
} as const

export interface AHelperInTheTurn {
  readonly piece: string
  readonly label: string
  readonly name: string
  readonly state: string
  readonly givenAt: number
  readonly changedAt: number | null
  readonly open: boolean
  readonly urgent: boolean
  readonly revision: string
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

export interface ExtraTurnFacts {
  readonly helpers?: {
    readonly rows: readonly AHelperInTheTurn[]
    readonly more: number
    readonly unchanged: number
  } | null
  readonly nobodyWaiting?: boolean
  readonly replyQuestion?: boolean
  readonly currentWork?: CurrentWorkInTheTurn
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

function extraLines(facts: ExtraTurnFacts, now: number): string[] {
  const lines: string[] = []
  if (
    facts.helpers === null ||
    facts.helpers?.rows.some((row) => [...row.label].length > TURN_LABEL_POINTS)
  )
    lines.push(TURN_BLOCK_WORDS.helpersUnavailable)
  else if (facts.helpers !== undefined) {
    const { rows, more, unchanged } = facts.helpers
    if (rows.length > 0) lines.push(TURN_BLOCK_WORDS.helpersHeading)
    lines.push(
      ...rows
        .slice(0, 5)
        .map((row) =>
          TURN_BLOCK_WORDS.helper(
            row.label,
            oneLine(row.name, 64),
            oneLine(row.state, 100),
            row.changedAt === null ? null : howLongAgo(row.changedAt, now),
          ),
        ),
    )
    const overflow = more + Math.max(0, rows.length - 5)
    if (overflow > 0) lines.push(TURN_BLOCK_WORDS.more(overflow))
    else if (rows.length === 0 && unchanged > 0) lines.push(TURN_BLOCK_WORDS.unchanged(unchanged))
  }
  if (facts.nobodyWaiting === true) lines.push(TURN_BLOCK_WORDS.nobody)
  if (facts.replyQuestion === true) lines.push(TURN_BLOCK_WORDS.replyQuestion)
  const current = facts.currentWork
  if (current !== undefined) {
    if (
      (current.kind === 'piece' && [...current.label].length > TURN_LABEL_POINTS) ||
      (current.kind === 'ambiguous' &&
        current.labels.some((label) => [...label].length > TURN_LABEL_POINTS))
    )
      lines.push(TURN_BLOCK_WORDS.currentUnavailable)
    else if (current.kind === 'piece')
      lines.push(
        TURN_BLOCK_WORDS.current(
          current.label,
          oneLine(current.title ?? TURN_BLOCK_WORDS.untitled, 200),
          oneLine(current.status ?? TURN_BLOCK_WORDS.noStatus, 200),
        ),
      )
    else
      lines.push(
        current.kind === 'none'
          ? TURN_BLOCK_WORDS.currentNone
          : current.kind === 'ambiguous'
            ? TURN_BLOCK_WORDS.currentAmbiguous(
                current.labels.slice(0, 5).join(', '),
                current.more + Math.max(0, current.labels.length - 5),
              )
            : TURN_BLOCK_WORDS.currentUnavailable,
      )
  }
  return lines
}

/** A question the conversation asked a person, still open. */
export interface AQuestionItHasOpen {
  readonly id: string
  readonly askedAt: number
  readonly prompt: string
}

/** Someone who gave the conversation a piece it still holds open. */
export interface AGiverWaitingOnIt {
  /** The giver, as a sentence names a conversation. */
  readonly who: string
  /** The piece: its label and title. */
  readonly work: string
}

/** Someone whose question to the conversation is still open. */
export interface AnAskerWaitingOnIt {
  readonly who: string
  readonly id: string
  readonly askedAt: number
}

/** Who waits on the conversation: the givers of its open pieces, and its open askers. */
export interface WhoWaitsOnIt {
  readonly givers: readonly AGiverWaitingOnIt[]
  readonly askers: readonly AnAskerWaitingOnIt[]
}

/**
 * ⚑ **A list as one string to compare** — the same string for the same questions, or the same
 * givers and askers, whatever their ages, so *did it change since it was last said* is one
 * comparison.
 */
export function itsQuestionsInOneWord(questions: readonly AQuestionItHasOpen[]): string {
  return JSON.stringify(questions.map((one) => one.id))
}
export function whoWaitsInOneWord(waiting: WhoWaitsOnIt): string {
  return JSON.stringify([
    waiting.givers.map((one) => [one.who, one.work]),
    waiting.askers.map((one) => one.id),
  ])
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
    const when = `asked ${howLongAgo(one.askedAt, now)}`
    return asked === '' ? `- ${one.id}, ${when}` : `- ${one.id}, ${when}: “${asked}”`
  })
  const more = questions.length - named.length
  return [
    questions.length === 1
      ? 'You have 1 question open with the person:'
      : `You have ${String(questions.length)} questions open with the person:`,
    ...named,
    ...(more > 0 ? [`and ${String(more)} more. list_questions shows them all.`] : []),
    'If one is answered or no longer needed, take it back with withdraw_question.',
  ]
}

function whoWaitsOnIt(waiting: WhoWaitsOnIt, now: number): string[] {
  if (waiting.givers.length + waiting.askers.length === 0) return []
  return [
    'Waiting on you:',
    ...waiting.givers.map((one) => `- ${one.who} gave you ${one.work}, and is waiting for it.`),
    ...waiting.askers.map(
      (one) =>
        `- ${one.who} asked you ${one.id} ${howLongAgo(one.askedAt, now)}. ` +
        'Answer it with answer_question.',
    ),
  ]
}

/**
 * 🔴 **The block, whole.** ⚑ The time on every turn. ⚑ On a turn this app started
 * (`aPersonStartedIt` false), when the person last wrote — `null` is *not that this app knows of* —
 * and that they have read nothing since. ⚑ Its open questions, and who waits on it, as the host
 * hands them in.
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
      ? 'The person has not written in this conversation recently.'
      : `The person last wrote in this conversation at ${clockTimeFrom(turn.thePersonLastWroteAt, now)}.`
  return [
    THE_BLOCK_BEGINS,
    turn.aPersonStartedIt
      ? 'This app adds what follows. It is not part of the person’s message above, and that message comes first.'
      : 'This app adds what follows. It is not part of the message above, and that message comes first.',
    turn.aPersonStartedIt
      ? itIs
      : `${itIs} ${lastWrote} When you next write to the person, assume they have read nothing ` +
        'since then, and tell them briefly what they need to know.',
    ...(turn.questions === null ? [] : itsOpenQuestions(turn.questions, now)),
    ...(turn.waiting === null ? [] : whoWaitsOnIt(turn.waiting, now)),
    ...extraLines(turn.extra ?? {}, now),
  ].join('\n')
}
