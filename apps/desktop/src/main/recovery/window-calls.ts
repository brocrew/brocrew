import type { LocalZone } from '../../shared/local-time'
import { MAX_MESSAGE_PATH_LENGTH, MAX_MESSAGE_PATHS } from '../../shared/runtime-ipc'
import {
  resolveMessagePaths,
  revealMessagePath,
  THIS_COMPUTER,
  type MessagePathPlace,
} from '../message-paths'
import {
  RECOVERY_CHANNELS,
  type ProgressListener,
  type RecoveryService,
  type StartupVerdict,
} from '../../shared/recovery'
import type { WorkingOn } from './coordinator'
import type { ClosableHistoryReader } from './history-reader'
import { isUuid } from './layout'

/**
 * What main answers the recovery window: the verdict, the restore, return and retry it offers, the
 * restored copy's history, the time zone, and quitting.
 *
 * Every call is checked against the verdict that stands: a restore only of the copy that verdict
 * offers, a return only from a restored copy, a retry only after a failure that may pass, and the
 * history only while a restored copy is open to be read. One restore, return or retry runs at a
 * time, and the history reader is closed before any of them moves a file.
 *
 * A failed migration is tried again by starting the app again: the new start checks the data and
 * migrates it, so a check here first would only copy the data twice.
 */

export interface RecoveryCallsDeps {
  readonly service: RecoveryService
  /** The verdict the start ended on. */
  readonly verdict: StartupVerdict
  /** A reader over a restored copy. */
  readonly openReader: (database: string) => ClosableHistoryReader
  readonly zone: () => LocalZone | null
  /** Sends the window a verdict main settled. */
  readonly sendVerdict: (verdict: StartupVerdict) => void
  readonly sendProgress: ProgressListener
  /** Ends the app. A start that ended in the recovery window exits non-zero. */
  readonly quit: () => void
  /** Starts the app again, now that its data opens. */
  readonly relaunch: () => void
  /** Shows a path in the file manager. */
  readonly reveal?: (path: string) => void
  /** Where a message's paths are read from; this computer when absent. */
  readonly place?: MessagePathPlace
}

export interface RecoveryCalls {
  /** The verdict that stands. */
  current(): StartupVerdict
  /** A verdict decided outside the window's calls, such as the end of a copy made at start. */
  settle(verdict: StartupVerdict): void
  /** Sends progress of work the window did not ask for, such as a copy made at start. */
  readonly progress: ProgressListener
  /** Answers one call from the window. A refusal rejects, with a sentence. */
  answer(channel: string, args: readonly unknown[]): Promise<unknown>
  /** Closes the history reader. */
  close(): void
}

/** The channels the window invokes. */
export const INVOKED_CHANNELS: readonly string[] = [
  RECOVERY_CHANNELS.verdict,
  RECOVERY_CHANNELS.restore,
  RECOVERY_CHANNELS.return,
  RECOVERY_CHANNELS.retry,
  RECOVERY_CHANNELS.quit,
  RECOVERY_CHANNELS.zone,
  RECOVERY_CHANNELS.conversations,
  RECOVERY_CHANNELS.transcript,
  RECOVERY_CHANNELS.messagePaths,
  RECOVERY_CHANNELS.revealMessagePath,
]

/** The longest conversation id the window may ask for. */
const MAX_ID_LENGTH = 200

function refuse(sentence: string): never {
  throw new Error(sentence)
}

const NOT_A_MESSAGE_PATH = 'That is not a path from a message.'

/** A conversation id the window may name, or `null` for none. */
function conversationOf(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID_LENGTH) {
    refuse(NOT_A_MESSAGE_PATH)
  }
  return value
}

/** A message's text, bounded as on the main window's wire; empty only in a batch. */
function pathTextOf(value: unknown, mayBeEmpty = false): string {
  if (
    typeof value !== 'string' ||
    (value === '' && !mayBeEmpty) ||
    value.length > MAX_MESSAGE_PATH_LENGTH
  ) {
    refuse(NOT_A_MESSAGE_PATH)
  }
  return value
}

export function createRecoveryCalls(deps: RecoveryCallsDeps): RecoveryCalls {
  let current = deps.verdict
  let running = false
  let reader: ClosableHistoryReader | null = null

  const close = (): void => {
    reader?.close()
    reader = null
  }
  // A window that is gone or reloading must not stop the work it is told about.
  const send = (verdict: StartupVerdict): void => {
    try {
      deps.sendVerdict(verdict)
    } catch {
      // The window asks for the verdict again when it loads.
    }
  }
  const progress: ProgressListener = (done, total) => {
    try {
      deps.sendProgress(done, total)
    } catch {
      // Progress is only shown.
    }
  }
  const settle = (verdict: StartupVerdict): void => {
    current = verdict
    if (verdict.kind !== 'history-only') close()
    send(verdict)
  }

  const run = async (
    working: WorkingOn | null,
    step: (progress: ProgressListener) => Promise<StartupVerdict>,
  ): Promise<StartupVerdict> => {
    if (running) refuse('BroCrew is still working on the last step.')
    running = true
    const before = current
    close()
    if (working !== null) current = { kind: 'working', what: working }
    try {
      const next = await step(progress)
      settle(next)
      if (next.kind === 'open') deps.relaunch()
      return next
    } catch (error) {
      current = before
      throw error
    } finally {
      running = false
    }
  }

  const history = (): ClosableHistoryReader => {
    if (running || current.kind !== 'history-only') {
      refuse('There is no restored copy to read now.')
    }
    reader ??= deps.openReader(current.database)
    return reader
  }

  return {
    current: () => current,
    settle,
    progress,
    close,
    async answer(channel, args) {
      switch (channel) {
        case RECOVERY_CHANNELS.verdict:
          return current
        case RECOVERY_CHANNELS.zone:
          return deps.zone()
        case RECOVERY_CHANNELS.quit:
          close()
          deps.quit()
          return undefined
        case RECOVERY_CHANNELS.restore: {
          const [checkpointId] = args
          if (typeof checkpointId !== 'string' || !isUuid(checkpointId)) {
            refuse('That is not a recovery copy BroCrew keeps.')
          }
          if (current.kind !== 'newer' || current.offers?.id !== checkpointId) {
            refuse('That recovery copy is not the one offered now.')
          }
          return run('restore', (told) => deps.service.restore(checkpointId, told))
        }
        case RECOVERY_CHANNELS.return:
          if (current.kind !== 'history-only') refuse('This data is not a restored copy.')
          return run('return', (told) => deps.service.returnToNewer(told))
        case RECOVERY_CHANNELS.retry:
          if (current.kind !== 'failed' || !current.canRetry) {
            refuse('There is nothing to try again now.')
          }
          if (current.reason === 'migration-failed') {
            if (running) refuse('BroCrew is still working on the last step.')
            close()
            deps.relaunch()
            return current
          }
          return run(null, () => deps.service.retry())
        case RECOVERY_CHANNELS.conversations:
          return history().conversations()
        case RECOVERY_CHANNELS.transcript: {
          const [id] = args
          if (typeof id !== 'string' || id === '' || id.length > MAX_ID_LENGTH) {
            refuse('That is not a conversation.')
          }
          return history().transcript(id)
        }
        case RECOVERY_CHANNELS.messagePaths: {
          const [ask] = args
          const { sessionId, texts } = (ask ?? {}) as { sessionId?: unknown; texts?: unknown }
          if (!Array.isArray(texts) || texts.length > MAX_MESSAGE_PATHS) refuse(NOT_A_MESSAGE_PATH)
          const said = texts.map((text) => pathTextOf(text, true))
          const reader = history()
          const id = conversationOf(sessionId)
          const folder = id === null ? null : await reader.workingFolder(id)
          // This window only ever shows a path: nothing here opens one.
          return resolveMessagePaths(said, folder, deps.place ?? THIS_COMPUTER, { mayOpen: false })
        }
        case RECOVERY_CHANNELS.revealMessagePath: {
          const [target] = args
          const { sessionId, text } = (target ?? {}) as { sessionId?: unknown; text?: unknown }
          const said = pathTextOf(text)
          const reader = history()
          const id = conversationOf(sessionId)
          const folder = id === null ? null : await reader.workingFolder(id)
          return revealMessagePath(said, folder, deps.place ?? THIS_COMPUTER, deps.reveal)
        }
        default:
          return refuse(`BroCrew does not answer ${channel} in the recovery window.`)
      }
    },
  }
}
