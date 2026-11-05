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

export default class SupervisorDatabase implements PluginSqlite {
  private readonly db: DatabaseSync
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
      // No journal_mode pragma: it can acquire a shared lock before the slot's BUSY retry loop.
      // DELETE remains the SQLite file default. Never enable WAL in either owner backend.
      this.exec('PRAGMA synchronous=FULL')
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  exec(sql: string): void {
    checked(() => this.db.exec(sql))
  }
  prepare(sql: string): PluginSqliteStatement {
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
    return synchronousPluginTransaction(this, () => this.db.isTransaction, work)
  }
  close(): void {
    checked(() => this.db.close())
  }
}

export function openPluginSqlite(path: string, options: PluginSqliteOptions = {}): PluginSqlite {
  return new SupervisorDatabase(path, options)
}
