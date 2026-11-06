/**
 * The check a recovery copy passes before it is kept: turned into one rollback-mode file, then
 * SQLite's own integrity check over all of it. It runs in a worker, so a large copy never holds the
 * main thread; its answer keeps the three outcomes apart, since each is said and retried apart.
 */
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

/**
 * Turns the copy, which the backup leaves marked for WAL like its source, into one rollback-mode
 * file that a read-only reader can open in place, and has SQLite check all of it. The copy is
 * closed before the answer is returned. It throws nothing: every outcome is an answer.
 */
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

/**
 * Checks each copy in a worker `start` makes. The answer is taken only once the worker has exited,
 * so the copy is closed and released before anything touches it next. A worker that cannot start,
 * fails, or exits with no answer says the check could not run, which is retried, and the copy is
 * never kept unchecked.
 */
export function verifyInAWorker(
  start: (request: CopyCheckRequest) => Worker,
  holdMs?: number,
): VerifyCopy {
  return (copy) =>
    new Promise((resolve) => {
      let worker: Worker
      try {
        worker = start(holdMs === undefined ? { copy } : { copy, holdMs })
      } catch (error) {
        resolve({ kind: 'failed', message: `its check could not start: ${messageOf(error)}` })
        return
      }
      let answer: CopyCheck | undefined
      worker.on('message', (message: unknown) => {
        if (answer === undefined && anAnswer(message)) answer = message
      })
      worker.on('error', (error) => {
        answer ??= { kind: 'failed', message: `its check stopped: ${messageOf(error)}` }
      })
      worker.once('exit', (code) => {
        resolve(
          answer ?? {
            kind: 'failed',
            message: `its check ended without an answer (exit ${String(code)})`,
          },
        )
      })
    })
}
