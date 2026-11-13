import { AsyncLocalStorage } from 'node:async_hooks'
import type { WindowWriterStamp } from './window-writer-stamp'
import type { LimitsWriterStamp } from './fresh-limits-snapshot'
import type { SessionStore } from './session-store'
import type { RowsUnread } from './rows-unread'
import type { RoutingReading, WindowRoutes } from './window-read-protocol'
import { WindowReadUnavailable } from './window-read-protocol'
import type { WindowFact, WindowWorkReading } from './window-work-reading'

type Reading = {
  active: boolean
  readonly snapshot: WindowRoutes
  readonly routes: ReadonlyMap<string, RoutingReading>
  readonly work?: {
    owners: ReadonlyMap<string, WindowWorkReading['owners'][number]>
    names: ReadonlyMap<string, ReadonlyMap<string, WindowWorkReading['namesUnder'][number][2]>>
    raised: ReadonlyMap<string, WindowWorkReading['raised'][number][1]>
    askers: ReadonlyMap<string, ReadonlySet<string>>
  }
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
  private readonly workIndexed = new WeakMap<WindowRoutes, NonNullable<Reading['work']>>()

  get active(): boolean {
    return this.context.getStore()?.active === true
  }

  askersOf(parent: string): ReadonlySet<string> | undefined {
    const reading = this.context.getStore()
    if (!reading?.active) return undefined
    if (reading.work === undefined) throw new WindowReadUnavailable()
    return reading.work.askers.get(parent) ?? new Set()
  }

  private fact<T>(fact: WindowFact<T>, unread?: RowsUnread): T {
    for (const [id, rows] of fact.skipped) for (const ordinal of rows) unread?.in(id)(ordinal)
    return fact.value
  }

  private owner(id: string): WindowWorkReading['owners'][number] | undefined {
    const reading = this.context.getStore()
    if (!reading?.active) return undefined
    if (reading.work === undefined) throw new WindowReadUnavailable()
    return (
      reading.work.owners.get(id) ?? {
        id,
        given: { value: [], skipped: [] },
        waitsOnWhoWrote: { value: [], skipped: [] },
        naming: { value: { named: null, waitingOnPurpose: null }, skipped: [] },
      }
    )
  }

  given(id: string, unread?: RowsUnread) {
    const owner = this.owner(id)
    return owner === undefined ? undefined : this.fact(owner.given, unread)
  }

  waitingOnWhoWrote(id: string, unread?: RowsUnread) {
    const owner = this.owner(id)
    return owner === undefined ? undefined : this.fact(owner.waitsOnWhoWrote, unread)
  }

  naming(id: string, unread?: RowsUnread) {
    const owner = this.owner(id)
    return owner === undefined ? undefined : this.fact(owner.naming, unread)
  }

  raised(id: string, unread?: RowsUnread) {
    const reading = this.context.getStore()
    if (!reading?.active) return undefined
    if (reading.work === undefined) throw new WindowReadUnavailable()
    const raised = reading.work.raised.get(id)
    return new Map(raised === undefined ? [] : this.fact(raised, unread))
  }

  queue<K extends keyof WindowWorkReading['queue']>(
    kind: K,
    unread: RowsUnread,
  ): WindowWorkReading['queue'][K]['value'] | undefined {
    const reading = this.context.getStore()
    if (!reading?.active) return undefined
    if (reading.snapshot.work?.queue === undefined) throw new WindowReadUnavailable()
    return this.fact<WindowWorkReading['queue'][K]['value']>(
      reading.snapshot.work.queue[kind],
      unread,
    )
  }

  instructionAskers(unread: RowsUnread) {
    const reading = this.context.getStore()
    if (!reading?.active) return undefined
    if (reading.snapshot.work === undefined) throw new WindowReadUnavailable()
    return this.fact(reading.snapshot.work.instructionAskers, unread)
  }

  run<T>(snapshot: WindowRoutes, answer: () => T): T {
    let routes = this.indexed.get(snapshot)
    if (routes === undefined) {
      routes = new Map(snapshot.routes.map((row) => [row.sessionId, row]))
      this.indexed.set(snapshot, routes)
    }
    let work = this.workIndexed.get(snapshot)
    if (work === undefined && snapshot.work !== undefined) {
      const names = new Map<string, Map<string, WindowWorkReading['namesUnder'][number][2]>>()
      for (const [owner, piece, name] of snapshot.work.namesUnder) {
        let own = names.get(owner)
        if (own === undefined) names.set(owner, (own = new Map()))
        own.set(piece, name)
      }
      const askers = new Map<string, Set<string>>()
      for (const { asker, parent } of snapshot.work.routedTo) {
        let from = askers.get(parent)
        if (from === undefined) askers.set(parent, (from = new Set()))
        from.add(asker)
      }
      work = {
        owners: new Map(snapshot.work.owners.map((owner) => [owner.id, owner])),
        names,
        raised: new Map(snapshot.work.raised),
        askers,
      }
      this.workIndexed.set(snapshot, work)
    }
    const reading: Reading = { active: true, snapshot, routes, work }
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
        if (key === 'workThatNames')
          return (id: string, unread?: RowsUnread) =>
            this.naming(id, unread)?.named ??
            (current() === undefined ? store.workThatNames(id, unread) : null)
        if (key === 'workThatNamesUnder')
          return (id: string, piece: string, unread?: RowsUnread) => {
            const reading = current()
            if (reading === undefined) return store.workThatNamesUnder(id, piece, unread)
            const named = reading.work?.names.get(id)?.get(piece)
            return named === undefined ? this.naming(id, unread)!.named : this.fact(named, unread)
          }
        if (key === 'whoRoutedToWhom')
          return () => {
            const reading = current()
            if (reading === undefined) return store.whoRoutedToWhom()
            if (reading.snapshot.work === undefined) throw new WindowReadUnavailable()
            return reading.snapshot.work.routedTo
          }
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
