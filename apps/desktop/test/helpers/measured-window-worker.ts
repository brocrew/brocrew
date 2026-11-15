import '../../src/main/window-reader.worker'
import Database from 'better-sqlite3'
import { parentPort } from 'node:worker_threads'
import { WindowReadEngine } from '../../src/main/db/window-read-engine'
import { foldCounts, resetFoldCounts } from './observed-fold-counts'

let started = 0
let queries = 0
let rows = 0
let allQueries = 0
let allRows = 0
let capability: 'cold' | 'match' | 'miss' = 'cold'
let sequence = 0
const prepare = Database.prototype.prepare
const read = WindowReadEngine.prototype.read
WindowReadEngine.prototype.read = function (...args) {
  started = performance.now()
  queries = 0
  rows = 0
  allQueries = 0
  allRows = 0
  resetFoldCounts()
  const offered = 'reuse' in args[0] ? args[0].reuse : undefined
  capability =
    offered === undefined
      ? 'cold'
      : offered.token === (this as unknown as { cacheToken?: string }).cacheToken
        ? 'match'
        : 'miss'
  console.info(JSON.stringify({ windowReadStarted: ++sequence, kind: args[0].kind, capability }))
  return read.apply(this, args)
}
Database.prototype.prepare = function (this: Database.Database, sql: string) {
  const statement = prepare.call(this, sql) as Database.Statement<unknown[], unknown>
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return statement
  const history = /\bevents\b/i.test(sql) && /\bpayload\b/i.test(sql)
  const measured: Database.Statement<unknown[], unknown> = new Proxy(statement, {
    get(native, key) {
      if (key === 'iterate')
        return function* (...args: unknown[]) {
          allQueries++
          if (history) queries++
          for (const row of native.iterate(...args)) {
            allRows++
            if (history) rows++
            yield row
          }
        }
      if (key === 'get')
        return (...args: unknown[]) => {
          allQueries++
          if (history) queries++
          const value = native.get(...args)
          if (value !== undefined) {
            allRows++
            if (history) rows++
          }
          return value
        }
      if (key === 'all')
        return (...args: unknown[]) => {
          allQueries++
          if (history) queries++
          const value = native.all(...args)
          allRows += value.length
          if (history) rows += value.length
          return value
        }
      const value: unknown = Reflect.get(native, key, native)
      return typeof value === 'function'
        ? (...args: unknown[]) => {
            const result: unknown = value.apply(native, args)
            return result === native ? measured : result
          }
        : value
    },
  })
  return measured
} as typeof prepare
if (parentPort !== null) {
  const port = parentPort
  const post = port.postMessage.bind(port)
  port.postMessage = (message) =>
    post({
      ...message,
      measurement: {
        queries,
        rows,
        allQueries,
        allRows,
        capability,
        folds: foldCounts(),
        elapsedMs: performance.now() - started,
      },
    })
}
