import type { AppDatabase } from './connection'

/** The final writer stays open until its WAL has been checkpointed. */
export function closeDatabase(db: AppDatabase): void {
  const [result] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
    busy: number
    log: number
    checkpointed: number
  }>
  if (result === undefined || result.busy !== 0 || result.log !== result.checkpointed)
    throw new Error(`Database checkpoint did not finish: ${JSON.stringify(result)}`)
  db.close()
}
