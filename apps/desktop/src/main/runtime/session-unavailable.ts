import { dirname } from 'node:path'
import type { Provider } from '@brobot2/shared'
import { A_PROVIDER_FOLDER, PROVIDER_NAME } from '../../shared/runtime-ipc'

export const UNAVAILABLE_REASONS = [
  'already-open',
  'already-open-elsewhere',
  'not-yours',
  'held-by-nobody',
  'a-person-must-answer',
  'run-by-another-host',
  'still-opening',
  'cancelled',
  'still-closing',
  'not-confirmed-stopped',
  'shutting-down',
  'lost-its-place',
  'machine-ran-short',
  'its-folder-could-not-be-made',
  'its-folder-is-gone',
  'its-provider-refused-it',
  'its-provider-could-not-be-started',
  'nothing-names-a-model',
  'surface-gone',
  'not-recorded',
  'cannot-be-reopened',
  'never-started',
  'not-running',
  'started-here',
  'read-only',
  'no-input-end',
  'restored-elsewhere',
] as const

export type Unavailable = (typeof UNAVAILABLE_REASONS)[number]

export class SessionUnavailable extends Error {
  constructor(
    readonly unavailable: Unavailable,
    message: string,
    readonly context: UnavailableContext = {},
    options?: { readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'SessionUnavailable'
  }
}

export class SessionStillStarting extends Error {
  constructor(
    message: string,
    readonly closing: boolean,
  ) {
    super(message)
  }
}

export class AStartThatDidNotHappen extends Error {
  constructor(override readonly cause: unknown) {
    super(
      `a conversation this app was not running was not started: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

export class ABriefThatDidNotArrive extends Error {
  constructor(
    readonly to: string,
    override readonly cause: unknown,
  ) {
    super(
      `a piece of work was not delivered to ${to}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

export class AGiveThatGaveNothing extends Error {
  constructor(
    readonly label: string,
    override readonly cause: unknown,
  ) {
    super(`${label} was not given: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export interface UnavailableContext {
  openingForMs?: number
  refusal?: string
  shortage?: string
  folder?: { readonly code: string; readonly path: string | null; readonly syscall?: string | null }
  reopening?: true
  providerSaid?: string
  listUnread?: {
    readonly provider: Provider
    readonly why: string | null
    readonly model: string | null
  }
}

export function saidOfAReopen(error: unknown): unknown {
  if (!(error instanceof SessionUnavailable) || error.context.reopening === true) return error
  return new SessionUnavailable(
    error.unavailable,
    error.message,
    { ...error.context, reopening: true },
    error.cause === undefined ? undefined : { cause: error.cause },
  )
}

export function unavailableOf(error: unknown): Unavailable | null {
  return error instanceof SessionUnavailable ? error.unavailable : null
}

export function unavailableContextOf(error: unknown): UnavailableContext {
  return error instanceof SessionUnavailable ? error.context : {}
}

const CREATES_AN_ENTRY: readonly string[] = [
  'copyfile',
  'link',
  'mkdir',
  'open',
  'rename',
  'symlink',
]

export function whatAFolderRefused(folder: UnavailableContext['folder']): {
  readonly failed: string
  readonly fix: string | null
} {
  const code = folder?.code
  const path = folder?.path ?? null
  const syscall = folder?.syscall ?? null
  const what =
    path === null
      ? 'make or write a folder it needs'
      : syscall === 'mkdir'
        ? `make the folder ${path}`
        : syscall === 'chmod'
          ? `set the permissions of ${path}`
          : `write ${path}`
  const could = `could not ${what}`
  if (code === 'EACCES' || code === 'EPERM') {
    if (path === null) {
      return {
        failed: `${could}, because it may not write where it needs to`,
        fix: 'Give BroCrew permission to write there',
      }
    }
    return syscall !== null && CREATES_AN_ENTRY.includes(syscall)
      ? {
          failed: `${could}, because it may not write in ${dirname(path)}`,
          fix: 'Give BroCrew permission to write to that folder',
        }
      : {
          failed: `${could}, because it may not change it`,
          fix: 'Give BroCrew permission to change it',
        }
  }
  if (code === 'EROFS')
    return { failed: `${could}, because that disk is read-only`, fix: 'Make it writable' }
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return {
      failed: `${could}, because the disk or its quota is full`,
      fix: 'Free some space on it',
    }
  }
  if (code === 'ENOTDIR' || code === 'EEXIST') {
    return {
      failed: `${could}, because a file stands where a folder must be`,
      fix: 'Move that file',
    }
  }
  return { failed: could, fix: null }
}

export function describeUnavailable(reason: Unavailable, context: UnavailableContext = {}): string {
  const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`
  const reopenIt = 'send it your message again'
  switch (reason) {
    case 'already-open':
      return 'This conversation is already open.'
    case 'already-open-elsewhere':
      return 'This conversation is already open in another window. Switch to that window to carry on with it.'
    case 'not-yours':
      return 'This conversation belongs to another window, so nothing was sent to it. Switch to that window to answer it or send to it.'
    case 'held-by-nobody':
      return 'No window holds this conversation, so nothing was done to it. Take it over by pressing its row, then send to it or answer it.'
    case 'a-person-must-answer':
      return 'Answering this is a person’s decision. An agent can give this conversation work, but not decide what that work is allowed to do. Open the conversation in a window and answer it there.'
    case 'run-by-another-host':
      return 'This conversation is already being run by another part of BroCrew, and only one part can drive it at a time, so it was not opened here. It can continue here once that part has let it go.'
    case 'still-opening': {
      const forMs = context.openingForMs
      const waited = forMs === undefined ? '' : ` It has been opening for ${seconds(forMs)}.`
      return `This conversation is still opening — it is waiting for its agent to answer.${waited} It opens by itself when its agent answers.`
    }
    case 'cancelled':
      return 'This conversation was stopped before it opened. Start it again whenever you are ready.'
    case 'still-closing':
      return "BroCrew is still putting away this conversation's last session, so nothing was done to it. A message sent to it waits until that is done."
    case 'not-confirmed-stopped':
      return 'This conversation cannot continue yet: BroCrew has not finished putting away its last session. Continuing now could put two agents on one transcript.'
    case 'shutting-down':
      return 'BroCrew is shutting down, so this conversation was not opened.'
    case 'lost-its-place':
      return 'This conversation was closed while it was opening, so it did not open.'
    case 'machine-ran-short': {
      const didNot = context.reopening === true ? 'did not continue' : 'did not open'
      const then = context.reopening === true ? `then ${reopenIt}` : 'then start it again'
      return context.shortage === 'EMFILE'
        ? `This conversation ${didNot}: BroCrew had too many files open to start its agent. Quit and reopen BroCrew, ${then}.`
        : `This conversation ${didNot}: this machine ran short of open files, processes or memory as its agent was starting. Close an app you are not using, or quit and reopen BroCrew, ${then}.`
    }
    case 'its-folder-could-not-be-made': {
      const didNot = context.reopening === true ? 'did not continue' : 'did not open'
      const then = context.reopening === true ? `then ${reopenIt}` : 'then start it again'
      const { failed, fix } = whatAFolderRefused(context.folder)
      const lead = `This conversation ${didNot}: BroCrew ${failed}`
      return fix === null
        ? `${lead}. A person has to fix that folder before it can open.`
        : `${lead}. ${fix}, ${then}.`
    }
    case 'its-folder-is-gone': {
      const path = context.folder?.path ?? null
      const where = path === null ? 'the folder it ran in' : `the folder it ran in, ${path},`
      return `This conversation did not continue: ${where} is no longer there. Put that folder back, then ${reopenIt}.`
    }
    case 'its-provider-refused-it': {
      const said = context.providerSaid
      const saying = said === undefined ? ' and gave no reason' : `, saying “${said}”`
      return context.reopening === true
        ? `This conversation did not continue: its provider refused to start it again${saying}. The conversation is kept, and its provider will refuse it the same way until what it refused is changed.`
        : `This conversation did not open: its provider refused to start it${saying}. No conversation was made, and starting it again will be refused the same way until what its provider refused is changed.`
    }
    case 'nothing-names-a-model': {
      const on =
        context.listUnread === undefined
          ? 'its provider'
          : PROVIDER_NAME[context.listUnread.provider]
      const why = context.listUnread?.why ?? null
      const model = context.listUnread?.model ?? null
      const half = model === null ? 'model' : 'effort'
      const cause =
        model === null
          ? why === null
            ? `${on} names no default model and effort, and nothing names a model for it`
            : `${on} could not be asked which models it offers (${why}), and nothing names a model for it`
          : why === null
            ? `${on} names no default effort to run “${model}” at, and nothing names one for it`
            : `${on} could not be asked which models it offers (${why}), and nothing names the effort “${model}” runs at`
      return context.reopening === true
        ? `This conversation did not continue: ${cause}. The conversation is kept: choose its ${half} in its settings, or ${reopenIt} once ${on} answers.`
        : `This conversation did not open: ${cause}, so no conversation was made. Name ${model === null ? 'a model' : 'its effort'}, or start it again once ${on} answers.`
    }
    case 'its-provider-could-not-be-started':
      return context.reopening === true
        ? 'This conversation did not continue: its provider could not be started again. The conversation is kept; if its provider fails the same way next time, a person has to look — BroCrew records why in its log.'
        : 'This conversation did not open: its provider could not be started, so no conversation was made. Start it again; if its provider fails the same way, a person has to look — BroCrew records why in its log.'

    case 'surface-gone':
      return 'The window that asked for this conversation went away before it opened, so no agent was started. Open it again.'
    case 'not-recorded':
      return 'There is no record of this conversation here.'
    case 'cannot-be-reopened':
    case 'never-started': {
      const said = context.refusal
      return said === undefined
        ? 'BroCrew could not continue this conversation. It is recorded here, but there is nothing to carry on from.'
        : `BroCrew could not continue this conversation: ${said}.`
    }
    case 'not-running':
      return 'There was nothing in this conversation to act on just now. Send it a message to carry on with it.'
    case 'started-here':
      return 'You started this conversation, so there is nobody to hand it back to.'
    case 'read-only':
      return `This conversation was found in ${A_PROVIDER_FOLDER}, which this app only reads. It can be read and exported, but not continued here.`
    case 'no-input-end':
      return 'This is a sub-agent conversation: another agent drove it, so it takes no message of its own. It can be read and exported.'
    case 'restored-elsewhere':
      return 'This conversation was restored from a bundle. BroCrew holds it and can show it, but no provider on this machine ever ran it, so there is nothing to carry on from.'
  }
}
