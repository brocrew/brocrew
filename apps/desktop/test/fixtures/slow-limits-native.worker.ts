import Database from 'better-sqlite3'
import { workerData, type MessagePort } from 'node:worker_threads'

const options = workerData as { file: string; probe?: MessagePort }
const probe = options.probe
delete options.probe
probe?.unref()

const prepare = Database.prototype.prepare
Database.prototype.prepare = function (this: Database.Database, sql: string) {
  const slow = sql.includes('payload LIKE ?') && !sql.includes('fictional_native_delay')
  if (slow) {
    sql = sql.replace(
      'FROM events',
      `FROM events CROSS JOIN (
      WITH RECURSIVE fictional_native_delay(n) AS (
        VALUES(0) UNION ALL SELECT n + 1 FROM fictional_native_delay WHERE n < 4000000
      ) SELECT sum(n) AS fictional_sum FROM fictional_native_delay
    )`,
    )
  }
  const statement = prepare.call(this, sql)
  if (!slow) return statement
  return new Proxy(statement, {
    get(target, key) {
      if (key === 'iterate')
        return function* (...args: unknown[]) {
          probe?.postMessage({ type: 'native-start', at: Date.now() })
          yield* (target.iterate as (...parameters: unknown[]) => IterableIterator<unknown>).apply(
            target,
            args,
          )
        }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
} as typeof prepare

void import('../../src/main/limits-reader.worker')
