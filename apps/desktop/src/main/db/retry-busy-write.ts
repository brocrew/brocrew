import type { AppDatabase } from './connection'

/** Retry a rolled-back write once, within the connection's existing busy timeout. */
export function retryBusyWrite<T>(db: AppDatabase, write: () => T): T {
  const nested = db.inTransaction
  const began = performance.now()
  try {
    return write()
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (
      nested ||
      db.inTransaction ||
      !(
        typeof code === 'string' &&
        (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'))
      )
    )
      throw error
    const timeout = Number(db.pragma('busy_timeout', { simple: true }))
    const remaining = Math.max(0, timeout - Math.ceil(performance.now() - began))
    if (timeout > 0 && remaining === 0) throw error
    db.pragma(`busy_timeout = ${String(remaining)}`)
    try {
      return write()
    } finally {
      db.pragma(`busy_timeout = ${String(timeout)}`)
    }
  }
}
