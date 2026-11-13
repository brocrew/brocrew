import '../../src/main/window-reader.worker'
import Database from 'better-sqlite3'
import { parentPort } from 'node:worker_threads'
import { WindowReadEngine } from '../../src/main/db/window-read-engine'

let started = 0
let queries = 0
let rows = 0
const prepare = Database.prototype.prepare
const read = WindowReadEngine.prototype.read
WindowReadEngine.prototype.read = function (...args) {
  started = performance.now()
  queries = 0
  rows = 0
  return read.apply(this, args)
}
Database.prototype.prepare = function (this: Database.Database, sql: string) {
  const statement = prepare.call(this, sql) as Database.Statement<unknown[], unknown>
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || !/\bevents\b/i.test(sql) || !/\bpayload\b/i.test(sql))
    return statement
  return new Proxy(statement, {
    get(native, key) {
      if (key === 'iterate')
        return function* (...args: unknown[]) {
          queries++
          for (const row of native.iterate(...args)) {
            rows++
            yield row
          }
        }
      if (key === 'get')
        return (...args: unknown[]) => {
          queries++
          const value = native.get(...args)
          if (value !== undefined) rows++
          return value
        }
      if (key === 'all')
        return (...args: unknown[]) => {
          queries++
          const value = native.all(...args)
          rows += value.length
          return value
        }
      const value: unknown = Reflect.get(native, key, native)
      return typeof value === 'function' ? value.bind(native) : value
    },
  })
} as typeof prepare
if (parentPort !== null) {
  const port = parentPort
  const post = port.postMessage.bind(port)
  port.postMessage = (message) =>
    post({ ...message, measurement: { queries, rows, elapsedMs: performance.now() - started } })
}
