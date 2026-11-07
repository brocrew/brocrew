import Database from 'better-sqlite3'
import type { Worker } from 'node:worker_threads'

/** What the check of a copy found. */
export type CopyCheck =
  /** The copy is one file and SQLite found nothing wrong. */
  | { readonly kind: 'ok' }
  /** SQLite's check found damage, or failed on it: the data is damaged. Not retried. */
  | { readonly kind: 'damaged'; readonly check: string }
  /** The copy could not be opened or made one file, or its check could not run. Retried. */
  | { readonly kind: 'failed'; readonly message: string }

/** Checks a copy and says what it found. */
export type VerifyCopy = (copy: string) => Promise<CopyCheck>

/** What a check worker is handed. */
export interface CopyCheckRequest {
  readonly copy: string
  /** A test's hold: the check's thread is kept this long before it starts. */
  readonly holdMs?: number
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function checkTheCopy(copy: string, holdMs = 0): CopyCheck {
  if (holdMs > 0) {
    // Holds this thread, as a long check would.
    const until = performance.now() + holdMs
    while (performance.now() < until) {
      /* held */
    }
  }
  let db: Database.Database
  try {
    db = new Database(copy, { fileMustExist: true })
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  }
  try {
    const mode = String(db.pragma('journal_mode = DELETE', { simple: true }))
    if (mode !== 'delete')
      return {
        kind: 'failed',
        message: `SQLite kept the copy in ${mode} mode, so it is not one file`,
      }
    // Some damage makes the check itself fail rather than report; either way the data is damaged.
    let check: string
    try {
      check = String(db.pragma('integrity_check', { simple: true }))
    } catch (error) {
      check = messageOf(error)
    }
    return check === 'ok' ? { kind: 'ok' } : { kind: 'damaged', check }
  } catch (error) {
    return { kind: 'failed', message: messageOf(error) }
  } finally {
    db.close()
  }
}

/** Whether a worker's message is a check's answer. */
function anAnswer(value: unknown): value is CopyCheck {
  if (typeof value !== 'object' || value === null) return false
  const one = value as { kind?: unknown; check?: unknown; message?: unknown }
  return (
    one.kind === 'ok' ||
    (one.kind === 'damaged' && typeof one.check === 'string') ||
    (one.kind === 'failed' && typeof one.message === 'string')
  )
}

/** Checks copies in workers, and stops them all when the app quits. */
export interface CopyVerifier {
  readonly verify: VerifyCopy
  stop(): Promise<void>
}

export function verifyInAWorker(
  start: (request: CopyCheckRequest) => Worker,
  holdMs?: number,
): CopyVerifier {
  const live = new Map<Worker, Promise<void>>()
  let stopped = false
  const verify: VerifyCopy = (copy) =>
    new Promise((resolve) => {
      if (stopped) {
        resolve({ kind: 'failed', message: 'its check was not started, as BroCrew is closing' })
        return
      }
      let worker: Worker
      try {
        worker = start(holdMs === undefined ? { copy } : { copy, holdMs })
      } catch (error) {
        resolve({ kind: 'failed', message: `its check could not start: ${messageOf(error)}` })
        return
      }
      let answer: CopyCheck | undefined
      worker.on('message', (message: unknown) => {
        if (answer === undefined && !stopped && anAnswer(message)) answer = message
      })
      worker.on('error', (error) => {
        answer ??= { kind: 'failed', message: `its check stopped: ${messageOf(error)}` }
      })
      live.set(
        worker,
        new Promise<void>((exited) => {
          worker.once('exit', (code) => {
            live.delete(worker)
            resolve(
              stopped
                ? { kind: 'failed', message: 'its check was ended, as BroCrew is closing' }
                : (answer ?? {
                    kind: 'failed',
                    message: `its check ended without an answer (exit ${String(code)})`,
                  }),
            )
            exited()
          })
        }),
      )
    })
  return {
    verify,
    async stop() {
      stopped = true
      const exits = [...live.values()]
      for (const worker of live.keys()) void worker.terminate()
      await Promise.all(exits)
    },
  }
}
