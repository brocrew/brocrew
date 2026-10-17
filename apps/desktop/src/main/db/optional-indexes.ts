import type { AppDatabase, AppStatement } from './connection'

const hint = /\s+INDEXED\s+BY\s+[A-Za-z_]\w*/gi
const rejectedHint = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === 'SQLITE_ERROR' &&
  /no such index:|no query solution/.test(error.message)

/** Workers leave planning to SQLite; optional main-thread hints never require an index. */
export function withOptionalIndexes(db: AppDatabase): AppDatabase {
  return new Proxy(db, {
    get(database, key) {
      if (key === 'prepare')
        return (sql: string) => {
          const unhinted = sql.replace(hint, '')
          if (unhinted === sql || database.readonly) return database.prepare(unhinted)
          let statement: AppStatement
          try {
            statement = database.prepare(sql)
          } catch (error) {
            if (rejectedHint(error)) return database.prepare(unhinted)
            throw error
          }
          // SQLite can recompile a prepared read after another connection drops an index.
          return new Proxy(statement, {
            get(_native, method) {
              if (method === 'iterate')
                return function* (...args: unknown[]) {
                  let yielded = false
                  try {
                    for (const row of statement.iterate(...args)) {
                      yielded = true
                      yield row
                    }
                  } catch (error) {
                    if (yielded || !rejectedHint(error)) throw error
                    statement = database.prepare(unhinted)
                    yield* statement.iterate(...args)
                  }
                }
              if (method === 'all' || method === 'get')
                return (...args: unknown[]) => {
                  try {
                    return statement[method](...args)
                  } catch (error) {
                    if (!rejectedHint(error)) throw error
                    statement = database.prepare(unhinted)
                    return statement[method](...args)
                  }
                }
              const value: unknown = Reflect.get(statement, method, statement)
              return typeof value === 'function' ? value.bind(statement) : value
            },
          })
        }
      const value: unknown = Reflect.get(database, key, database)
      return typeof value === 'function' ? value.bind(database) : value
    },
  })
}
