import type { AppDatabase, AppStatement } from './connection'
import { LimitsMaterialization } from './bounded-limits-statements'
import { LimitsReadUnavailable } from './limits-read-protocol'
import { rowsUnreadOnce, type RowsUnread } from './session-store'
import { WORK_SEARCH_BOUNDS } from '../../shared/work-search'

export class WorkSearchPageBudget {
  private rows = 0
  private failed = false

  constructor(private readonly outOfTime: () => boolean = () => false) {}

  get returnedRows(): number {
    return this.rows
  }
  get overflowed(): boolean {
    return this.failed
  }

  database(db: AppDatabase): AppDatabase {
    const count = function* (
      this: WorkSearchPageBudget,
      source: Iterable<Record<string, unknown>>,
    ) {
      for (const row of source) {
        if (this.outOfTime() || this.rows === WORK_SEARCH_BOUNDS.pageRows) {
          this.failed = true
          throw new LimitsReadUnavailable('overflow')
        }
        this.rows++
        yield row
      }
    }.bind(this)
    return new Proxy(db, {
      get: (target, property) => {
        if (property === 'prepare')
          return (sql: string) => {
            const statement = db.prepare(sql)
            const rows = (args: unknown[]) =>
              count(statement.iterate(...args) as Iterable<Record<string, unknown>>)
            return new Proxy(statement, {
              get: (original, key) => {
                if (key === 'all') return (...args: unknown[]) => Array.from(rows(args))
                if (key === 'iterate') return (...args: unknown[]) => rows(args)
                if (key === 'get')
                  return (...args: unknown[]) => {
                    for (const row of rows(args)) return row
                    return undefined
                  }
                const value = Reflect.get(original, key, original) as unknown
                return typeof value === 'function' ? value.bind(original) : value
              },
            }) as AppStatement
          }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}

export function workSearchMaterialization(page?: WorkSearchPageBudget) {
  const ledger = new LimitsMaterialization({
    rows: WORK_SEARCH_BOUNDS.ledgerRows,
    bytes: WORK_SEARCH_BOUNDS.ledgerBytes,
    cellBytes: WORK_SEARCH_BOUNDS.cellBytes,
  })
  return {
    assert: () => ledger.assert(),
    measured: () => ledger.measured(),
    database: (db: AppDatabase) =>
      page === undefined ? ledger.database(db) : page.database(ledger.database(db)),
  }
}

export function workSearchUnread(page: RowsUnread): RowsUnread {
  const local = rowsUnreadOnce()
  return {
    in: (session) => {
      const here = local.in(session)
      const all = page.in(session)
      return (ordinal) => {
        here(ordinal)
        all(ordinal)
      }
    },
    get count() {
      return local.count
    },
    get ledgersSkipped() {
      return local.ledgersSkipped
    },
  }
}
