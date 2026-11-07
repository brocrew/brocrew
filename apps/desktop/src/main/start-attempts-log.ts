import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import type { StartPhase } from '@brobot2/runtime'

export const START_ATTEMPTS_FILE = 'start-attempts.jsonl'
export const START_ATTEMPTS_OLDER_FILE = 'start-attempts.1.jsonl'
const START_ATTEMPTS_MOST_BYTES = 2 * 1024 * 1024
const START_ATTEMPTS_MOST_WAITING = 64

export type StartAttemptOutcome = 'ready' | 'failed' | 'cancelled'

interface StartAttemptOf {
  readonly v: 1
  readonly attempt: string
  readonly session: string
  readonly provider: Provider
  readonly opening: 'fresh' | 'resume'
  readonly at: string
}

export type StartAttemptLine =
  | (StartAttemptOf & { readonly stage: 'began' })
  | (StartAttemptOf & {
      readonly stage: 'ended'
      readonly outcome: StartAttemptOutcome
      readonly elapsedMs: number
      readonly phases: Readonly<Partial<Record<StartPhase, number>>>
      readonly lastPhase: StartPhase | null
      readonly responseBytes: number | null
    })

export interface StartAttemptsFiles {
  readonly makeFolder: (path: string) => Promise<unknown>
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
  readonly write: (line: StartAttemptLine) => void
  readonly settled: () => Promise<void>
}

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
