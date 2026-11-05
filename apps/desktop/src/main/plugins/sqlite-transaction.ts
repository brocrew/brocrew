import type { PluginSqlite } from './sqlite-contract'

/** One small transaction policy shared by the app and standalone SQLite backends. */
export function synchronousPluginTransaction<T>(
  database: Pick<PluginSqlite, 'exec' | 'close'>,
  active: () => boolean,
  work: () => T,
): () => T {
  return () => {
    if (active()) throw new Error('plugin-sqlite-nested-transaction')
    database.exec('BEGIN')
    try {
      const result = work()
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as { then?: unknown }).then === 'function'
      ) {
        // Consume a rejected Promise without treating its completion as transaction success.
        void Promise.resolve(result).catch(() => {})
        throw new TypeError('plugin-sqlite-async-transaction')
      }
      database.exec('COMMIT')
      return result
    } catch (error) {
      try {
        database.exec('ROLLBACK')
      } catch {
        // A failed rollback cannot leave a usable connection with uncertain transaction state.
        try {
          database.close()
        } catch {
          /* Preserve the original failure. */
        }
      }
      throw error
    }
  }
}
