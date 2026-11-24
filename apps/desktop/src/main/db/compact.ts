import type { AppDatabase } from './connection'
import { setTimeout as pause } from 'node:timers/promises'

export async function incrementallyCompact(
  db: AppDatabase,
  stopped: () => boolean,
): Promise<{ steps: number; reclaimedPages: number; longestLockMs: number }> {
  let steps = 0
  let reclaimedPages = 0
  let longestLockMs = 0
  const vacuum = db.transaction(() => {
    db.pragma('incremental_vacuum(16)')
  })
  while (!stopped()) {
    const before = Number(db.pragma('freelist_count', { simple: true }))
    const began = performance.now()
    try {
      vacuum.immediate()
    } catch (error) {
      if ((error as { code?: string }).code === 'SQLITE_BUSY') break
      throw error
    }
    longestLockMs = Math.max(longestLockMs, performance.now() - began)
    steps += 1
    const after = Number(db.pragma('freelist_count', { simple: true }))
    reclaimedPages += Math.max(0, before - after)
    if (after === 0 || after >= before) break
    await pause(25)
  }
  return { steps, reclaimedPages, longestLockMs }
}
