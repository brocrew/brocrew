import { AsyncLocalStorage } from 'node:async_hooks'
import { serialize } from 'node:v8'
import type { SessionStore } from './session-store'
import { rowsUnreadOnce, type RowsUnread } from './rows-unread'
import type { LimitsWriterStamp } from './fresh-limits-snapshot'
import type { WindowWriterStamp } from './window-writer-stamp'
import { sameWindowContent, type WindowContentStamp } from './window-routing-reads'
import {
  WindowReadUnavailable,
  type IncidentReading,
  type IncidentFact,
  type IncidentHistory,
  type WindowIncidents,
} from './window-read-protocol'

export const INCIDENT_READ_LIMIT = { entries: 512, bytes: 4 * 1024 * 1024 } as const
type Kept = { value: unknown; bytes: number }

/** Supplies worker facts to one window answer, or reuses complete synchronous reads. */
export class WindowIncidentReads {
  private readonly context = new AsyncLocalStorage<{
    active: boolean
    owners?: ReadonlyMap<string, IncidentReading>
    roots?: ReadonlyMap<string, IncidentHistory['roots'][number]>
    reported?: ReadonlyMap<string, IncidentFact<readonly string[]>>
  }>()
  private readonly kept = new Map<string, Kept>()
  private stamp: WindowContentStamp | null = null
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
            roots: new Map(snapshot.owners.flatMap((row) => row.history.roots.map((root) => [root[0], root] as const))),
            reported: new Map(snapshot.reported),
          }),
    }
    try {
      return this.context.run(scope, answer)
    } finally {
      scope.active = false
    }
  }

  waitTarget(owner: string, piece: string, unread: RowsUnread): { state: IncidentHistory['states'][number][1] | null } | undefined {
    const scope = this.context.getStore()
    if (scope?.active !== true || scope.owners === undefined) return undefined
    const row = scope.owners.get(owner)
    if (row === undefined) throw new WindowReadUnavailable()
    for (const ordinal of row.history.statesSkipped) unread.in(owner)(ordinal)
    return { state: row.history.states.find(([id]) => id === piece)?.[1] ?? null }
  }

  private sample(): WindowContentStamp | null {
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
    if (!sameWindowContent(this.stamp, before)) this.invalidate()
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
    if (epoch !== this.epoch || !sameWindowContent(before, after)) {
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
    const valueOf = <T>(fact: IncidentFact<T> | undefined): T => {
      if (fact == null) throw new WindowReadUnavailable()
      return structuredClone(fact.value)
    }
    const history = (owner: string) => {
      const owners = current()
      if (owners === undefined) return undefined
      const row = owners.get(owner)
      if (row === undefined) throw new WindowReadUnavailable()
      return row.history
    }
    return new Proxy(original, {
      get: (store, key) => {
        if (key === 'rootLines' || key === 'turnBlockRootLines')
          return (piece: string) => {
            if (current() === undefined) return store[key](piece)
            const root = this.context.getStore()?.roots?.get(piece)
            return key === 'rootLines' ? valueOf(root?.[1]) : valueOf(root?.[2])
          }
        if (key === 'reconciliationReceipts')
          return (owner: string, piece: string) => {
            const row = history(owner)
            return row === undefined ? store.reconciliationReceipts(owner, piece)
              : valueOf(row.receipts.find(([id]) => id === piece)?.[1])
          }
        if (key === 'reconciliationRecovery')
          return (owner: string) => {
            const row = history(owner)
            return row === undefined ? store.reconciliationRecovery(owner) : valueOf(row.recovery)
          }
        if (key === 'theNewestTurn')
          return (owner: string) => {
            const row = history(owner)
            return row === undefined ? store.theNewestTurn(owner) : row.newestTurn
          }
        if (key === 'reconciliationDrivenByTurn')
          return (owner: string, turn: string) => {
            const row = history(owner)
            if (row === undefined) return store.reconciliationDrivenByTurn(owner, turn)
            if (turn !== row.newestTurn) throw new WindowReadUnavailable()
            return valueOf(row.driven)
          }
        if (key === 'whenAPersonLastWrote')
          return (owner: string) => {
            const row = history(owner)
            return row === undefined ? store.whenAPersonLastWrote(owner) : valueOf(row.lastPerson)
          }
        if (key === 'legacyOrdinaryStallWasReported')
          return (owner: string, piece: string, giver: string) => {
            const row = history(owner)
            return row === undefined ? store.legacyOrdinaryStallWasReported(owner, piece, giver)
              : valueOf(row.legacy.find(([id, by]) => id === piece && by === giver)?.[2])
          }
        if (key === 'workReportedTo')
          return (giver: string) => current() === undefined ? store.workReportedTo(giver)
            : new Set(valueOf(this.context.getStore()?.reported?.get(giver)))
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
