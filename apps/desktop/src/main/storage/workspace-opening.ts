import type { Worker } from 'node:worker_threads'
import {
  openFailureFrom,
  type OpenFailure,
  type WorkspaceDatabaseOpening,
} from '../db/open-workspace-database'

type Opening = Omit<WorkspaceDatabaseOpening, 'openFailed' | 'migrate'>

/**
 * The start's database open, run on the storage worker: open, refuse a newer database, migrate and
 * import the side files, then close, so main opens a database that is ready. A failure comes back
 * as the error the open would have thrown on main. A quit waits for the worker to exit, never ends
 * it: a worker ended inside a SQLite call takes the whole app down.
 */
export function workspaceOpening(start: (request: { kind: 'open'; opening: Opening }) => Worker): {
  open(opening: Opening, migration: { begun(): void; ended(): void }): Promise<void>
  stop(): Promise<void>
} {
  let stopped = false
  let exited: Promise<void> = Promise.resolve()
  return {
    open: (opening, migration) =>
      new Promise((resolve, reject) => {
        if (stopped) {
          reject(new Error('The workspace is closing.'))
          return
        }
        const current = start({ kind: 'open', opening })
        let answer: { ok: boolean; value: OpenFailure | null; error?: string } | undefined
        let problem: Error | undefined
        current.on('message', (message) => {
          if ('migrating' in message) migration.begun()
          else if ('migrated' in message) migration.ended()
          else answer = message
        })
        current.once('error', (error) => {
          problem = error
        })
        exited = new Promise<void>((done) => {
          current.once('exit', (code) => {
            if (answer?.ok && answer.value !== null) reject(openFailureFrom(answer.value))
            else if (stopped || code !== 0 || problem || !answer?.ok)
              reject(problem ?? new Error(answer?.error ?? 'The workspace database did not open.'))
            else resolve()
            done()
          })
        })
      }),
    async stop() {
      stopped = true
      await exited
    },
  }
}
