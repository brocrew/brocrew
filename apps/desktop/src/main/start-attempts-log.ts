import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import type { StartPhase } from '@brobot2/runtime'

/** The file each launch's timing is written to, in the data folder. */
export const START_ATTEMPTS_FILE = 'start-attempts.jsonl'
/** Where the file is moved once full; the one there before is replaced. */
export const START_ATTEMPTS_OLDER_FILE = 'start-attempts.1.jsonl'
/** The most either file holds: a line that would take it past this moves it aside first. */
export const START_ATTEMPTS_MOST_BYTES = 2 * 1024 * 1024
/** The most lines waiting to be written; one more is dropped. */
export const START_ATTEMPTS_MOST_WAITING = 64

/** How a launch ended: ready, given up on at its deadline, failed, or stopped while it started. */
export type StartAttemptOutcome = 'ready' | 'timed-out' | 'failed' | 'cancelled'

interface StartAttemptOf {
  readonly v: 1
  /** This launch's own id, shared by its two lines. */
  readonly attempt: string
  readonly session: string
  readonly provider: Provider
  readonly opening: 'fresh' | 'resume'
  /** When the line was made, in UTC. */
  readonly at: string
}

/**
 * One launch's timing, by name and number only: never what it sent or received. A line when the
 * launch begins, and one when it ends.
 */
export type StartAttemptLine =
  | (StartAttemptOf & { readonly stage: 'began' })
  | (StartAttemptOf & {
      readonly stage: 'ended'
      readonly outcome: StartAttemptOutcome
      /** Milliseconds from the first line, on a clock that only moves forward. */
      readonly elapsedMs: number
      /** Each phase reached, in milliseconds from the first line. */
      readonly phases: Readonly<Partial<Record<StartPhase, number>>>
      /** The last phase reached: at a timeout, the one the launch was waiting after. */
      readonly lastPhase: StartPhase | null
      /** The size of the thread's answer, when the provider's transport counts it. */
      readonly responseBytes: number | null
    })

/** The file operations the log uses, all of them off the main thread. */
export interface StartAttemptsFiles {
  readonly makeFolder: (path: string) => Promise<unknown>
  /** The file's size, or 0 when there is none. */
  readonly sizeOf: (path: string) => Promise<number>
  readonly append: (path: string, text: string) => Promise<void>
  readonly move: (from: string, to: string) => Promise<void>
}

const ON_DISK: StartAttemptsFiles = {
  makeFolder: (path) => mkdir(path, { recursive: true }),
  sizeOf: async (path) => {
    try {
      return (await stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  },
  append: (path, text) => appendFile(path, text),
  move: (from, to) => rename(from, to),
}

export interface StartAttemptsLog {
  /**
   * Takes a line now and writes it later, after the lines before it. Never waits for the disk and
   * never throws: a line it has no room for is dropped.
   */
  readonly write: (line: StartAttemptLine) => void
  /** Settles once every line taken so far is written or dropped. */
  readonly settled: () => Promise<void>
}

/**
 * The launch timing log in `userData`: {@link START_ATTEMPTS_FILE}, and {@link
 * START_ATTEMPTS_OLDER_FILE} once it is full, neither past {@link START_ATTEMPTS_MOST_BYTES}. A line
 * that would take the file past it moves the file aside first; if that move fails, the line is
 * dropped and nothing more is written this run, so the file never grows past it.
 */
export function aStartAttemptsLog(
  userData: string,
  options: {
    readonly mostBytes?: number
    readonly mostWaiting?: number
    readonly files?: StartAttemptsFiles
  } = {},
): StartAttemptsLog {
  const mostBytes = options.mostBytes ?? START_ATTEMPTS_MOST_BYTES
  const mostWaiting = options.mostWaiting ?? START_ATTEMPTS_MOST_WAITING
  const files = options.files ?? ON_DISK
  const file = join(userData, START_ATTEMPTS_FILE)
  const older = join(userData, START_ATTEMPTS_OLDER_FILE)
  let made = false
  /** The file's size as this log last knew it; read again after a failed append. */
  let size: number | null = null
  let stopped = false
  let waiting = 0
  let last: Promise<void> = Promise.resolve()

  const writeOne = async (text: string): Promise<void> => {
    const bytes = Buffer.byteLength(text, 'utf8')
    if (stopped || bytes > mostBytes) return
    if (!made) {
      await files.makeFolder(userData)
      made = true
    }
    size ??= await files.sizeOf(file)
    if (size + bytes > mostBytes) {
      try {
        await files.move(file, older)
      } catch {
        stopped = true
        return
      }
      size = 0
    }
    try {
      await files.append(file, text)
      size += bytes
    } catch {
      size = null
    }
  }

  return {
    write: (line) => {
      if (stopped || waiting >= mostWaiting) return
      const text = `${JSON.stringify(line)}\n`
      waiting += 1
      last = last
        .then(() => writeOne(text))
        .catch(() => {
          size = null
        })
        .finally(() => {
          waiting -= 1
        })
    },
    settled: () => last,
  }
}
