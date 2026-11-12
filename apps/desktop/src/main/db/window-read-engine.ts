import Database from 'better-sqlite3'
import { recentActivity } from '../runtime/recent-activity'
import { createSessionStore, type ThreadLeadRow } from './session-store'
import { rowsUnreadOnce, type RowsUnread } from './rows-unread'
import { readTheForestFirst } from './forest-listing'
import {
  WINDOW_READ_BOUNDS,
  windowReadQuery,
  WindowReadUnavailable,
  type RoutingReading,
  type IncidentReading,
  type SkippedRow,
  type WindowReadQuery,
  type WindowReadResult,
} from './window-read-protocol'

/** Canonical folds over one read-only WAL snapshot, consuming SQLite iterators incrementally. */
export class WindowReadEngine {
  private readonly db: Database.Database

  constructor(file: string) {
    this.db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
    try {
      this.db.pragma('query_only = ON')
      this.db.pragma('cache_size = -4096')
      if (this.db.pragma('journal_mode', { simple: true }) !== 'wal')
        throw new WindowReadUnavailable()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  read(input: WindowReadQuery, abandoned: () => boolean = () => false): WindowReadResult {
    const query = windowReadQuery.parse(input)
    let refused: WindowReadUnavailable | undefined
    const checkCancelled = () => {
      if (refused !== undefined) throw refused
      if (!abandoned()) return
      refused = new WindowReadUnavailable('failed', 'cancelled')
      throw refused
    }
    const cancellable = new Proxy(this.db, {
      get: (database, key) => {
        if (key === 'prepare')
          return (sql: string) => {
            const statement = database.prepare(sql)
            return new Proxy(statement, {
              get: (native, method) => {
                if (method === 'all')
                  return (...args: unknown[]) => {
                    const result: unknown[] = []
                    for (const row of native.iterate(...args)) {
                      checkCancelled()
                      result.push(row)
                    }
                    return result
                  }
                if (method === 'get')
                  return (...args: unknown[]) => {
                    checkCancelled()
                    return native.get(...args)
                  }
                if (method === 'iterate')
                  return function* (...args: unknown[]) {
                    for (const row of native.iterate(...args)) {
                      checkCancelled()
                      yield row
                    }
                  }
                const value: unknown = Reflect.get(native, method, native)
                return typeof value === 'function' ? value.bind(native) : value
              },
            })
          }
        const value: unknown = Reflect.get(database, key, database)
        return typeof value === 'function' ? value.bind(database) : value
      },
    })
    this.db.exec('BEGIN')
    try {
      this.db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get()
      // Made for this snapshot alone, so a fold that read every row is not read again.
      const store = createSessionStore(
        cancellable,
        Date.now,
        undefined,
        Math.random,
        checkCancelled,
        true,
      )
      let result: WindowReadResult
      if (query.kind === 'forest') {
        result = { kind: 'forest', ...readTheForestFirst(store, query.asked) }
      } else if (query.kind === 'forest-nodes') {
        result = {
          kind: 'forest-nodes',
          ...store.forestNodesOf(query.conversations, new Set(query.drawn), query.hidden),
        }
      } else if (query.kind === 'incidents') {
        const owners = store.reconciliationOwners()
        const readings: IncidentReading[] = []
        for (const sessionId of owners) {
          checkCancelled()
          const piecesSkipped = new Set<SkippedRow>()
          const routesSkipped = new Set<SkippedRow>()
          const messagesSkipped = new Set<SkippedRow>()
          const stopSkipped = new Set<SkippedRow>()
          const noted = (skipped: Set<SkippedRow>): RowsUnread => {
            const unread = rowsUnreadOnce()
            return {
              in: (id) => (ordinal) => {
                if (id !== sessionId) throw new WindowReadUnavailable()
                skipped.add(ordinal)
                unread.in(id)(ordinal)
              },
              get count() {
                return unread.count
              },
              get ledgersSkipped() {
                return unread.ledgersSkipped
              },
            }
          }
          const pieces = store.openPiecesOf(sessionId, noted(piecesSkipped))
          // The canonical work reader shares the open-piece fold already read for this owner.
          const foldedStore: typeof store = {
            ...store,
            openPiecesOf: (owner, unread) => {
              if (owner !== sessionId) throw new WindowReadUnavailable()
              for (const ordinal of piecesSkipped) unread?.in(owner)(ordinal)
              return pieces
            },
          }
          readings.push({
            sessionId,
            pieces,
            work: foldedStore.reconciliationWork(new Set([sessionId]), noted(piecesSkipped)),
            routes: store.routedRequestsOf(sessionId, noted(routesSkipped)),
            messages: store.messagesWaitingIn(sessionId, noted(messagesSkipped)),
            stop: store.lastAskToStop(sessionId, noted(stopSkipped)),
            piecesSkipped: [...piecesSkipped],
            routesSkipped: [...routesSkipped],
            messagesSkipped: [...messagesSkipped],
            stopSkipped: [...stopSkipped],
          })
        }
        result = { kind: 'incidents', owners: readings }
      } else if (query.kind === 'activity') {
        const reading = recentActivity(store, query.from, query.to)
        result = { kind: 'activity', ...reading }
      } else if (query.kind === 'files') {
        if (store.conversationBinding(query.sessionId) === null) throw new WindowReadUnavailable()
        const files = store.filesKeptTogether({
          scope: 'tree',
          holder: query.sessionId,
          givers: query.givers,
        })
        const roster = store.agentIdentities()
        result = { kind: 'files', ...files, roster }
      } else if (query.kind === 'leads') {
        // Bound each native page by ledger rows, including rows the lead selector skips.
        const page = this.db.prepare(`SELECT ordinal FROM events
          WHERE session_id = @session AND generation = coalesce(
            (SELECT active FROM derived_generation WHERE session_id = @session), 0)
            AND ordinal >= @from AND ordinal < @before
          ORDER BY ordinal LIMIT @limit`)
        const rows: ThreadLeadRow[] = []
        let from = Number.NEGATIVE_INFINITY
        for (;;) {
          checkCancelled()
          const ordinals = page.all({
            session: query.sessionId,
            from,
            before: query.before,
            limit: WINDOW_READ_BOUNDS.leadPageRows,
          }) as { ordinal: number }[]
          const last = ordinals.at(-1)
          if (last === undefined) break
          if (
            !Number.isSafeInteger(last.ordinal) ||
            last.ordinal < from ||
            last.ordinal >= query.before
          )
            throw new WindowReadUnavailable()
          const before = last.ordinal + 1
          const found = store.threadLeadRows?.(
            query.sessionId,
            query.opening,
            before,
            query.historicalOpening,
            from,
          )
          if (found === undefined) throw new WindowReadUnavailable()
          rows.push(...found)
          from = before
        }
        result = { kind: 'leads', rows }
      } else {
        const candidates = this.db
          .prepare("SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'")
          .iterate() as IterableIterator<{ id: string }>
        const routes: RoutingReading[] = []
        const skipped = new Map<string, Set<SkippedRow>>()
        const counts = rowsUnreadOnce()
        const unread: RowsUnread = {
          in: (sessionId) => (ordinal) => {
            let seen = skipped.get(sessionId)
            if (seen === undefined) skipped.set(sessionId, (seen = new Set()))
            seen.add(ordinal)
            counts.in(sessionId)(ordinal)
          },
          get count() {
            return counts.count
          },
          get ledgersSkipped() {
            return counts.ledgersSkipped
          },
        }
        for (const { id } of candidates) {
          checkCancelled()
          routes.push({
            sessionId: id,
            requests: store.routedRequestsOf(id, unread),
            skipped: [...(skipped.get(id) ?? [])],
          })
        }
        result = {
          kind: 'routes',
          routes,
          questions: store.questionsAPersonMustAnswer(unread),
          decisions: store.decisionsAwaitingAPerson(unread),
        }
      }
      if (refused !== undefined) throw refused
      checkCancelled()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}
