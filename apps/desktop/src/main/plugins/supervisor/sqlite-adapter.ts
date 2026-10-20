// Build-time replacement for better-sqlite3 in the standalone supervisor only.
import { DatabaseSync } from 'node:sqlite'

export default class SupervisorDatabase {
  private readonly db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    // Match PluginFence's better-sqlite3 connection: rollback journal, no busy wait,
    // exclusive transaction ownership. Never enable WAL in either owner backend.
    try {
      this.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL')
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  exec(sql: string): void {
    try {
      this.db.exec(sql)
    } catch (error) {
      if (error instanceof Error && 'errcode' in error && Number(error.errcode) % 256 === 5)
        throw Object.assign(new Error('supervisor busy'), { code: 'SQLITE_BUSY' })
      throw error
    }
  }
  close(): void {
    this.db.close()
  }
}
