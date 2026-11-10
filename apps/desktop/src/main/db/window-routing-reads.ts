import { AsyncLocalStorage } from 'node:async_hooks'
import type { WindowWriterStamp } from './window-writer-stamp'
import type { LimitsWriterStamp } from './fresh-limits-snapshot'
import type { SessionStore } from './session-store'
import type { RowsUnread } from './rows-unread'
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

/** The routing writer and the content writer sampled together. */
export type WindowContentStamp = { window: WindowWriterStamp; content: LimitsWriterStamp }

/** True when neither writer changed between two samples taken in order. */
export function sameWindowContent(
  before: WindowContentStamp | null,
  after: WindowContentStamp | null,
): boolean {
  return (
    before !== null &&
    after !== null &&
    sameWindowWriter(before.window, after.window) &&
    before.content.writer === after.content.writer &&
    before.content.totalChanges === after.content.totalChanges &&
    before.content.dataVersion === after.content.dataVersion &&
    Number.isFinite(before.content.at) &&
    Number.isFinite(after.content.at) &&
    before.content.at <= after.content.at
  )
}

/** Scopes a validated worker routing snapshot to one synchronous window answer. */
export class WindowRoutingReads {
  private readonly context = new AsyncLocalStorage<Reading>()
  /** Each snapshot's routes by conversation, built once for as long as the snapshot is kept. */
  private readonly indexed = new WeakMap<WindowRoutes, ReadonlyMap<string, RoutingReading>>()

  run<T>(snapshot: WindowRoutes, answer: () => T): T {
    let routes = this.indexed.get(snapshot)
    if (routes === undefined) {
      routes = new Map(snapshot.routes.map((row) => [row.sessionId, row]))
      this.indexed.set(snapshot, routes)
    }
    const reading: Reading = { active: true, snapshot, routes }
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
