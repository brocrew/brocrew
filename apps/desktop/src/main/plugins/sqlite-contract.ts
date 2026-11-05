import Database from 'better-sqlite3'
import { synchronousPluginTransaction } from './sqlite-transaction'
import { pluginSqliteCall as checked } from './sqlite-errors'
import { pluginSqliteFullPolicy } from './sqlite-policy'

/** The complete SQLite surface used by the plugin owner, state archive and process slots. */
export type PluginSqliteValue = null | number | string | Uint8Array
export type PluginSqliteRow = Record<string, PluginSqliteValue>
export interface PluginSqliteOptions {
  readonly?: boolean
  fileMustExist?: boolean
  timeout?: 0
}
export interface PluginSqliteStatement {
  run(...parameters: PluginSqliteValue[]): void
  get(...parameters: PluginSqliteValue[]): PluginSqliteRow | undefined
  all(...parameters: PluginSqliteValue[]): PluginSqliteRow[]
}
export interface PluginSqlite {
  exec(sql: string): void
  prepare(sql: string): PluginSqliteStatement
  /** Synchronous only. A nested transaction or returned Promise is refused. */
  transaction<T>(work: () => T): () => T
  close(): void
}

/** App backend. The standalone builder replaces this MODULE, never the native package globally. */
export function openPluginSqlite(path: string, options: PluginSqliteOptions = {}): PluginSqlite {
  if (options.timeout !== undefined && options.timeout !== 0)
    throw new TypeError('plugin-sqlite-timeout-must-be-zero')
  const native = checked(() => new Database(path, { ...options, timeout: 0 }))
  const ensureFull = pluginSqliteFullPolicy({
    active: () => native.inTransaction,
    exec: (sql) => {
      checked(() => native.exec(sql))
    },
    readSynchronous: () =>
      (checked(() => native.prepare('PRAGMA synchronous').get()) as PluginSqliteRow | undefined)
        ?.synchronous,
  })
  const database: PluginSqlite = {
    exec: (sql) => {
      ensureFull()
      checked(() => native.exec(sql))
    },
    prepare: (sql) => {
      ensureFull()
      const statement = checked(() => native.prepare(sql))
      return {
        run: (...parameters) => {
          checked(() => statement.run(...parameters))
        },
        get: (...parameters) =>
          checked(() => statement.get(...parameters)) as PluginSqliteRow | undefined,
        all: (...parameters) => checked(() => statement.all(...parameters)) as PluginSqliteRow[],
      }
    },
    transaction: (work) => {
      ensureFull()
      return synchronousPluginTransaction(database, () => native.inTransaction, work)
    },
    close: () => checked(() => native.close()),
  }
  return database
}
