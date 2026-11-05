// Build-time replacement for sqlite-contract.ts in the standalone supervisor only.
import { DatabaseSync } from 'node:sqlite'
import { lstatSync } from 'node:fs'
import type {
  PluginSqlite,
  PluginSqliteOptions,
  PluginSqliteStatement,
  PluginSqliteRow,
} from '../sqlite-contract'
import { synchronousPluginTransaction } from '../sqlite-transaction'
import { pluginSqliteCall as checked } from '../sqlite-errors'
import { pluginSqliteFullPolicy } from '../sqlite-policy'

export default class SupervisorDatabase implements PluginSqlite {
  private readonly db: DatabaseSync
  private readonly ensureFull: () => void
  constructor(path: string, options: PluginSqliteOptions = {}) {
    if (options.timeout !== undefined && options.timeout !== 0)
      throw new TypeError('plugin-sqlite-timeout-must-be-zero')
    const before = options.fileMustExist ? lstatSync(path, { bigint: true }) : undefined
    if (before && !before.isFile()) throw new Error('plugin-sqlite-existing-file-required')
    this.db = checked(
      () =>
        new DatabaseSync(path, {
          readOnly: options.readonly ?? false,
          timeout: 0,
          readBigInts: false,
        }),
    )
    try {
      if (before) {
        const after = lstatSync(path, { bigint: true })
        if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino)
          throw new Error('plugin-sqlite-existing-file-changed')
      }
    } catch (error) {
      this.db.close()
      throw error
    }
    // No constructor SQL: even synchronous=FULL may be BUSY before the caller can retry.
    // DELETE remains the SQLite file default. Never enable WAL in either owner backend.
    this.ensureFull = pluginSqliteFullPolicy({
      active: () => this.db.isTransaction,
      exec: (sql) => {
        checked(() => this.db.exec(sql))
      },
      readSynchronous: () =>
        checked(() => this.db.prepare('PRAGMA synchronous').get())?.synchronous,
    })
  }
  exec(sql: string): void {
    this.ensureFull()
    checked(() => this.db.exec(sql))
  }
  prepare(sql: string): PluginSqliteStatement {
    this.ensureFull()
    const statement = checked(() => this.db.prepare(sql))
    return {
      run: (...parameters) => {
        checked(() => statement.run(...parameters))
      },
      get: (...parameters) =>
        checked(() => statement.get(...parameters)) as PluginSqliteRow | undefined,
      all: (...parameters) => checked(() => statement.all(...parameters)) as PluginSqliteRow[],
    }
  }
  transaction<T>(work: () => T): () => T {
    this.ensureFull()
    return synchronousPluginTransaction(this, () => this.db.isTransaction, work)
  }
  close(): void {
    checked(() => this.db.close())
  }
}

export function openPluginSqlite(path: string, options: PluginSqliteOptions = {}): PluginSqlite {
  return new SupervisorDatabase(path, options)
}
