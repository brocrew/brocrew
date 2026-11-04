import { DatabaseSync } from 'node:sqlite'
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One ordinary runtime mutex per plugin ID in this installation root. */
export async function acquireRuntimeLock(path, cancelled = () => false) {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA busy_timeout=100')
    for (;;) {
      if (cancelled()) {
        db.close()
        return undefined
      }
      try {
        db.exec('BEGIN EXCLUSIVE')
        return () => db.close()
      } catch (error) {
        if (error.errcode !== 5) throw error
        await pause(25)
      }
    }
  } catch (error) {
    db.close()
    throw error
  }
}
