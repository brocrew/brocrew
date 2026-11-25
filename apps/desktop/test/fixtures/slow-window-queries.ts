import Database from 'better-sqlite3'
import { performance } from 'node:perf_hooks'

export type NativeStatementInterval = { startedAt: number; finishedAt: number }

/** Makes the canonical queries spend time inside SQLite without sleeping on the caller. */
export function slowWindowQueries(
  started: (sql: string) => void,
  iterations = 4_000_000,
  record?: (interval: NativeStatementInterval) => void,
): () => void {
  function measure<T>(read: () => T): T {
    if (record === undefined) return read()
    const startedAt = performance.timeOrigin + performance.now()
    try {
      return read()
    } finally {
      record({ startedAt, finishedAt: performance.timeOrigin + performance.now() })
    }
  }

  const prepare = Database.prototype.prepare
  const positionalPrepare = prepare<unknown[]>
  Database.prototype.prepare = function (this: Database.Database, sql: string) {
    const slow =
      sql.includes('FROM events') &&
      (sql.includes('SELECT DISTINCT session_id AS id') ||
        sql.includes('AS handed') ||
        sql.includes('payload LIKE ?'))
    if (slow)
      sql = sql.replace(
        /FROM events(?:\s+INDEXED BY \w+)?/,
        `$& CROSS JOIN (
          WITH RECURSIVE fictional_native_delay(n) AS (
            VALUES(0) UNION ALL SELECT n + 1 FROM fictional_native_delay WHERE n < ${iterations}
          ) SELECT sum(n) AS fictional_sum FROM fictional_native_delay
        )`,
      )
    const statement = positionalPrepare.call(this, sql)
    if (!slow) return statement
    return new Proxy(statement, {
      get(target, key) {
        if (key === 'iterate')
          return function* (...args: unknown[]) {
            started(sql)
            const cursor = target.iterate(...args)
            if (record === undefined) {
              yield* cursor
              return
            }
            // The first step materializes the added recursive CTE.
            let row: IteratorResult<unknown> | undefined
            try {
              row = measure(() => cursor.next())
              while (!row.done) {
                yield row.value
                row = cursor.next()
              }
            } finally {
              if (row?.done !== true) cursor.return?.()
            }
          }
        if (key === 'all' || key === 'get')
          return (...args: unknown[]) => {
            started(sql)
            return measure(() => target[key](...args))
          }
        const value: unknown = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  } as typeof prepare
  return () => {
    Database.prototype.prepare = prepare
  }
}
