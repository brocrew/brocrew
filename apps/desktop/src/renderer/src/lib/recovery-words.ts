import { localFields } from '../../../shared/local-time'
import type { StartFailure, StartupVerdict } from '../../../shared/recovery'

/**
 * What the recovery window says for each verdict. Pure: facts in, words out, so every sentence a
 * person reads is testable without a window. Every refusal ends with what to do next, and no
 * sentence carries an id.
 */

export type RecoveryAction =
  | { readonly kind: 'restore'; readonly label: string; readonly checkpointId: string }
  | { readonly kind: 'return'; readonly label: string }
  | { readonly kind: 'retry'; readonly label: string }
  | { readonly kind: 'close'; readonly label: string }

export interface RecoveryWords {
  readonly heading: string
  /** Paragraphs, in reading order. */
  readonly body: readonly string[]
  /** The coordinator's own sentence, drawn small and selectable under the words. */
  readonly detail?: string
  readonly actions: readonly RecoveryAction[]
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * A copy's date in local time: "10 October, 09:00", with the year added when it is not this
 * year's. An unreadable date says so rather than printing "Invalid Date".
 */
export function copyDate(iso: string, now: number = Date.now()): string {
  return dateWords(Date.parse(iso), now)
}

/** {@link copyDate} for an instant in ms. */
export function dateWords(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at)) return 'an unknown date'
  const when = localFields(at)
  const year = when.year === localFields(now).year ? '' : ` ${when.year}`
  const hh = String(when.hours).padStart(2, '0')
  const mm = String(when.minutes).padStart(2, '0')
  return `${when.date} ${MONTHS[when.month]}${year}, ${hh}:${mm}`
}

const CLOSE: RecoveryAction = { kind: 'close', label: 'Close' }
const TRY_AGAIN: RecoveryAction = { kind: 'retry', label: 'Try again' }

/** "the newer BroBot", or "BroBot 0.2.0 or later" when a copy names the build that wrote it. */
function theNewerBroBot(madeBy: { readonly appVersion: string } | null | undefined): string {
  return madeBy ? `BroCrew ${madeBy.appVersion} or later` : 'the newer version of BroCrew'
}

/** A newer BroBot changed the data. Offers the copy only when there is one this build can read. */
export function newerWords(
  verdict: Extract<StartupVerdict, { kind: 'newer' }>,
  now?: number,
): RecoveryWords {
  const openWith = theNewerBroBot(verdict.newer.madeBy)
  const heading = "This version of BroCrew can't open this workspace"
  if (verdict.offers === null) {
    return {
      heading,
      body: [
        "A newer version of BroCrew has changed this workspace's data, and there is no copy this version can read.",
        `To keep working, open the workspace with ${openWith}.`,
      ],
      actions: [CLOSE],
    }
  }
  const date = copyDate(verdict.offers.createdAt, now)
  return {
    heading,
    body: [
      `A newer version of BroCrew has changed this workspace's data. To keep working, open it with ${openWith}.`,
      `Or restore the copy from ${date} to read its history. Agents stay stopped, nothing after that date appears, and the newer data is kept. Project files and provider sign-ins are not changed.`,
    ],
    actions: [
      {
        kind: 'restore',
        label: `Restore the copy from ${date}`,
        checkpointId: verdict.offers.id,
      },
      CLOSE,
    ],
  }
}

/** The banner over the read-only history. */
export function historyOnlyWords(
  verdict: Extract<StartupVerdict, { kind: 'history-only' }>,
  now?: number,
): RecoveryWords {
  const date = copyDate(verdict.gate.checkpointCreatedAt, now)
  return {
    heading: `Read-only history from the copy of ${date}`,
    body: [
      'Agents are stopped and nothing here can change.',
      'To keep working, return to the newer data, then open it with the newer version of BroCrew.',
    ],
    actions: [{ kind: 'return', label: 'Return to the newer data' }, CLOSE],
  }
}

/** What to do after a failure that may pass: try again, or open BroBot again later. */
function tryAgainOr(canRetry: boolean, otherwise: string): string {
  return canRetry ? 'Try again.' : otherwise
}

/** Where to turn when nothing in the window can help, pointing at the detail when there is one. */
function askForHelp(detail: string | undefined): string {
  return detail
    ? "Leave the workspace's data folder as it is, and quote the line below to whoever helps you."
    : "Leave the workspace's data folder as it is, and ask whoever helps you with BroCrew."
}

/** The heading and opening sentences for each reason, before what to do next. */
function failureFacts(
  verdict: Extract<StartupVerdict, { kind: 'failed' }>,
  now?: number,
): { heading: string; facts: string[]; next: string } {
  const { reason, canRetry, detail } = verdict
  switch (reason) {
    case 'not-the-only-app-on-this-folder':
      // Only a known other owner is named as a fact; an unconfirmed one is said as just that.
      if (verdict.ownership === 'taken') {
        return {
          heading: 'Another copy of BroCrew is using this workspace',
          facts: ['So this one didn’t open the workspace’s data.'],
          next: canRetry
            ? 'Close the other copy of BroCrew, then try again.'
            : 'Close the other copy of BroCrew, then open this one again.',
        }
      }
      return {
        heading: 'BroCrew couldn’t confirm it alone can use this workspace',
        facts: ['So it didn’t open the workspace’s data.'],
        next: canRetry
          ? 'If another copy of BroCrew is open on this workspace, close it, then try again.'
          : 'If another copy of BroCrew is open on this workspace, close it, then open BroCrew again.',
      }
    case 'database-unreadable':
      return {
        heading: "BroCrew couldn't read this workspace's data",
        facts: [
          "BroCrew couldn't read this workspace's data safely, so it didn't open it. Nothing was changed.",
        ],
        next: askForHelp(detail),
      }
    case 'recovery-unreadable':
      return {
        heading: "BroCrew couldn't read its record of a restore",
        facts: [
          "BroCrew couldn't read the record it keeps while restoring a copy of this workspace, so it didn't open it. Nothing was changed.",
        ],
        next: `If a newer version of BroCrew has used this workspace, open it with that one. If not, ${lowerFirst(askForHelp(detail))}`,
      }
    case 'checkpoint-failed':
      return {
        heading: "BroCrew couldn't make a checked copy",
        facts: [
          "BroCrew couldn't make a checked copy of this workspace's data before updating it, so it stopped before changing anything.",
        ],
        next: tryAgainOr(canRetry, askForHelp(detail)),
      }
    case 'migration-failed':
      return {
        heading: "BroCrew couldn't update this workspace's data",
        facts: [
          "BroCrew couldn't update this workspace's data, so it stopped before changing anything else.",
        ],
        next: tryAgainOr(canRetry, askForHelp(detail)),
      }
    case 'restore-failed': {
      const what = verdict.during === 'return' ? 'the return to the newer data' : 'the restore'
      return {
        heading: `BroCrew couldn't finish ${what}`,
        facts: [
          `BroCrew couldn't finish ${what}, so it stopped before changing anything else. Nothing was deleted.`,
        ],
        next: tryAgainOr(canRetry, askForHelp(detail)),
      }
    }
    case 'replaced-outside': {
      const heading = "This workspace's data was changed outside BroCrew"
      const next = 'Open the workspace with the version of BroCrew that changed it.'
      if (verdict.where === 'journal') {
        return {
          heading,
          facts: [
            "It was changed while a restore was unfinished, so BroCrew didn't open it. Nothing was deleted: the newer data is kept.",
          ],
          next,
        }
      }
      if (verdict.where === 'gate') {
        const since = verdict.checkpointCreatedAt
          ? `after its copy from ${copyDate(verdict.checkpointCreatedAt, now)} was restored`
          : 'after a copy of it was restored'
        return {
          heading,
          facts: [`It was changed ${since}, so BroCrew didn't open it. Nothing was deleted.`],
          next,
        }
      }
      return { heading, facts: ["BroCrew didn't open it. Nothing was deleted."], next }
    }
    case 'start-failed':
      return {
        heading: "BroCrew couldn't finish starting",
        facts: [
          "BroCrew opened this workspace's data, then something else it needs to start failed, so it stopped what it had started.",
        ],
        next: tryAgainOr(canRetry, askForHelp(detail)),
      }
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** A start that stopped before anything else ran. */
export function failedWords(
  verdict: Extract<StartupVerdict, { kind: 'failed' }>,
  now?: number,
): RecoveryWords {
  const { heading, facts, next } = failureFacts(verdict, now)
  return {
    heading,
    body: [...facts, next],
    ...(verdict.detail ? { detail: verdict.detail } : {}),
    actions: verdict.canRetry ? [TRY_AGAIN, CLOSE] : [CLOSE],
  }
}

/** `open` never reaches this window on purpose; if it does, the data opened and BroBot can restart. */
export function openWords(): RecoveryWords {
  return {
    heading: "This workspace's data can be opened normally",
    body: ['Close this window, then open BroCrew again.'],
    actions: [CLOSE],
  }
}

const WORKING_HEADING = {
  check: 'Checking this workspace’s data',
  checkpoint: 'Making a checked copy of this workspace’s data',
  restore: 'Restoring the copy',
  return: 'Returning to the newer data',
} as const

/** Work that must not be interrupted: no action is offered until the next verdict arrives. */
export function workingWords(verdict: Extract<StartupVerdict, { kind: 'working' }>): RecoveryWords {
  return {
    heading: WORKING_HEADING[verdict.what],
    body: ['This can take a minute for a large workspace. Keep BroCrew open until it finishes.'],
    actions: [],
  }
}

/** The words for any verdict. */
export function recoveryWords(verdict: StartupVerdict, now?: number): RecoveryWords {
  switch (verdict.kind) {
    case 'open':
      return openWords()
    case 'newer':
      return newerWords(verdict, now)
    case 'history-only':
      return historyOnlyWords(verdict, now)
    case 'failed':
      return failedWords(verdict, now)
    case 'working':
      return workingWords(verdict)
  }
}

/** Every reason a start can fail, for tests that walk them all. */
export const START_FAILURES: readonly StartFailure[] = [
  'not-the-only-app-on-this-folder',
  'database-unreadable',
  'checkpoint-failed',
  'migration-failed',
  'replaced-outside',
  'recovery-unreadable',
  'restore-failed',
  'start-failed',
]

/** What the window says when it is opened anywhere but inside BroBot. */
export const NO_BRIDGE_WORDS =
  "This is BroCrew's recovery window. It only works inside BroCrew, so there is nothing to show here."
