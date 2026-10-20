import { AsyncLocalStorage } from 'node:async_hooks'
import { serialize } from 'node:v8'
import { rowsUnreadOnce, type RowsUnread, type SessionStore } from './session-store'
import type { LimitsWriterStamp } from './fresh-limits-snapshot'
import type { WindowWriterStamp } from './window-writer-stamp'
import { sameWindowWriter } from './window-routing-reads'
import {
  WindowReadUnavailable,
  type IncidentReading,
  type WindowIncidents,
} from './window-read-protocol'

export const INCIDENT_READ_LIMIT = { entries: 512, bytes: 4 * 1024 * 1024 } as const
type Stamp = { window: WindowWriterStamp; content: LimitsWriterStamp }
type Kept = { value: unknown; bytes: number }

function same(before: Stamp | null, after: Stamp | null): boolean {
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

/** Supplies worker facts to one window answer, or reuses complete synchronous reads. */
export class WindowIncidentReads {
  private readonly context = new AsyncLocalStorage<{
    active: boolean
    owners?: ReadonlyMap<string, IncidentReading>
  }>()
  private readonly kept = new Map<string, Kept>()
  private stamp: Stamp | null = null
  private bytes = 0
  private epoch = 0

  constructor(
    private readonly window: () => WindowWriterStamp | null,
    private readonly content: () => LimitsWriterStamp | null,
  ) {}

  invalidate(): void {
    this.kept.clear()
    this.bytes = 0
    this.stamp = null
    this.epoch++
  }

  run<T>(answer: () => T, snapshot?: WindowIncidents): T {
    const scope = {
      active: true,
      ...(snapshot === undefined
        ? {}
        : {
            owners: new Map(snapshot.owners.map((row) => [row.sessionId, row])),
          }),
    }
    try {
      return this.context.run(scope, answer)
    } finally {
      scope.active = false
    }
  }

  private sample(): Stamp | null {
    try {
      const window = this.window()
      const content = this.content()
      return window === null || content === null ? null : { window, content }
    } catch {
      return null
    }
  }

  private read<T>(key: string, read: (unread: RowsUnread) => T, unread?: RowsUnread): T {
    const before = this.sample()
    if (!same(this.stamp, before)) this.invalidate()
    this.stamp = before
    const kept = this.kept.get(key)
    if (kept !== undefined) {
      this.kept.delete(key)
      this.kept.set(key, kept)
      return structuredClone(kept.value) as T
    }
    const epoch = this.epoch
    const own = rowsUnreadOnce()
    const counting: RowsUnread = {
      in: (session) => (ordinal) => {
        own.in(session)(ordinal)
        unread?.in(session)(ordinal)
      },
      get count() {
        return own.count
      },
      get ledgersSkipped() {
        return own.ledgersSkipped
      },
    }
    const value = read(counting)
    const after = this.sample()
    if (epoch !== this.epoch || !same(before, after)) {
      this.invalidate()
      return value
    }
    if (own.count !== 0 || own.ledgersSkipped !== 0) return value
    const bytes = serialize([key, value]).byteLength
    if (bytes > INCIDENT_READ_LIMIT.bytes) return value
    this.kept.set(key, { value: structuredClone(value), bytes })
    this.bytes += bytes
    while (this.kept.size > INCIDENT_READ_LIMIT.entries || this.bytes > INCIDENT_READ_LIMIT.bytes) {
      const oldest = this.kept.entries().next().value!
      this.bytes -= oldest[1].bytes
      this.kept.delete(oldest[0])
    }
    return value
  }

  store(original: SessionStore): SessionStore {
    const current = () => {
      const scope = this.context.getStore()
      if (scope?.active !== true || scope.owners === undefined) return undefined
      return scope.owners
    }
    const fact = (
      id: string,
      unread: RowsUnread | undefined,
      kind: 'messages' | 'stop' | 'pieces' | 'routes',
    ) => {
      const owners = current()
      if (owners === undefined) return undefined
      const row = owners.get(id)
      if (row === undefined) throw new WindowReadUnavailable()
      for (const ordinal of row[`${kind}Skipped`]) unread?.in(id)(ordinal)
      return row
    }
    return new Proxy(original, {
      get: (store, key) => {
        if (key === 'reconciliationOwners')
          return () => {
            const owners = current()
            return owners === undefined ? store.reconciliationOwners() : [...owners.keys()]
          }
        if (key === 'reconciliationWork')
          return (holders?: ReadonlySet<string>, unread?: RowsUnread) => {
            const owners = current()
            if (owners === undefined) return store.reconciliationWork(holders, unread)
            return [...(holders ?? owners.keys())].flatMap((id) => {
              const row = fact(id, unread, 'pieces')
              if (row === undefined) throw new WindowReadUnavailable()
              return structuredClone(row.work)
            })
          }
        if (key === 'openPiecesOf')
          return (id: string, unread?: RowsUnread) => {
            const row = fact(id, unread, 'pieces')
            return row === undefined ? store.openPiecesOf(id, unread) : structuredClone(row.pieces)
          }
        if (key === 'routedRequestsOf')
          return (id: string, unread?: RowsUnread) => {
            const row = fact(id, unread, 'routes')
            return row === undefined
              ? store.routedRequestsOf(id, unread)
              : structuredClone(row.routes)
          }
        if (key === 'messagesWaitingIn')
          return (id: string, unread?: RowsUnread, maximumRows?: number) => {
            const row = fact(id, unread, 'messages')
            if (row !== undefined) {
              if (maximumRows !== undefined) throw new WindowReadUnavailable()
              return structuredClone(row.messages)
            }
            return this.context.getStore()?.active === true
              ? this.read(
                  JSON.stringify([key, id, maximumRows]),
                  (note) => store.messagesWaitingIn(id, note, maximumRows),
                  unread,
                )
              : store.messagesWaitingIn(id, unread, maximumRows)
          }
        if (key === 'lastAskToStop')
          return (id: string, unread?: RowsUnread) => {
            const row = fact(id, unread, 'stop')
            if (row !== undefined) return structuredClone(row.stop)
            return this.context.getStore()?.active === true
              ? this.read(
                  JSON.stringify([key, id]),
                  (note) => store.lastAskToStop(id, note),
                  unread,
                )
              : store.lastAskToStop(id, unread)
          }
        const value: unknown = Reflect.get(store, key, store)
        return typeof value === 'function' ? value.bind(store) : value
      },
    })
  }
}
