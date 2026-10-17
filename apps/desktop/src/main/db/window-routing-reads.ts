import { AsyncLocalStorage } from 'node:async_hooks'
import type { WindowWriterStamp } from './window-writer-stamp'
import type { SessionStore, RowsUnread } from './session-store'
import type { RoutingReading, WindowRoutes } from './window-read-protocol'

type Reading = {
  active: boolean
  readonly snapshot: WindowRoutes
  readonly routes: ReadonlyMap<string, RoutingReading>
}

export function sameWindowWriter(
  before: WindowWriterStamp | null,
  after: WindowWriterStamp | null,
): boolean {
  return (
    before !== null &&
    after !== null &&
    before.writer === after.writer &&
    before.watcher === after.watcher &&
    before.revision === after.revision &&
    before.dataVersion === after.dataVersion &&
    before.schemaVersion === after.schemaVersion &&
    Number.isFinite(before.at) &&
    Number.isFinite(after.at) &&
    before.at <= after.at
  )
}

/** Scopes a validated worker routing snapshot to one synchronous window answer. */
export class WindowRoutingReads {
  private readonly context = new AsyncLocalStorage<Reading>()

  run<T>(snapshot: WindowRoutes, answer: () => T): T {
    const reading: Reading = {
      active: true,
      snapshot,
      routes: new Map(snapshot.routes.map((row) => [row.sessionId, row])),
    }
    try {
      return this.context.run(reading, answer)
    } finally {
      // Async work scheduled by the answer must not inherit its now-finished snapshot.
      reading.active = false
    }
  }

  store(original: SessionStore): SessionStore {
    const current = (): Reading | undefined => {
      const reading = this.context.getStore()
      return reading?.active ? reading : undefined
    }
    const skipped = (reading: Reading, unread?: RowsUnread): void => {
      if (unread === undefined) return
      for (const row of reading.routes.values())
        for (const ordinal of row.skipped) unread.in(row.sessionId)(ordinal)
    }
    return new Proxy(original, {
      get: (store, key) => {
        if (key === 'routedRequestsOf')
          return (sessionId: string, unread?: RowsUnread) => {
            const reading = current()
            if (reading === undefined) return store.routedRequestsOf(sessionId, unread)
            const row = reading.routes.get(sessionId)
            if (unread !== undefined && row !== undefined)
              for (const ordinal of row.skipped) unread.in(sessionId)(ordinal)
            return row?.requests ?? []
          }
        if (key === 'questionsAPersonMustAnswer')
          return (unread?: RowsUnread) => {
            const reading = current()
            if (reading === undefined) return store.questionsAPersonMustAnswer(unread)
            skipped(reading, unread)
            return reading.snapshot.questions
          }
        if (key === 'decisionsAwaitingAPerson')
          return (unread?: RowsUnread) => {
            const reading = current()
            if (reading === undefined) return store.decisionsAwaitingAPerson(unread)
            skipped(reading, unread)
            return reading.snapshot.decisions
          }
        const value: unknown = Reflect.get(store, key, store)
        return typeof value === 'function' ? value.bind(store) : value
      },
    })
  }
}
