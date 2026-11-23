import type { AppDatabase } from './connection'
import { setTimeout as pause } from 'node:timers/promises'

export async function incrementallyCompact(
  db: AppDatabase,
  stopped: () => boolean,
): Promise<{ steps: number; reclaimedPages: number; longestLockMs: number }> {
  let steps = 0
  let reclaimedPages = 0
  let longestLockMs = 0
  let transactionMs = 0
  let freelistMs = 0
  let checkpointMs = 0
  let pauseMs = 0
  let pauses = 0
  const compactionBegan = performance.now()
  const vacuum = db.transaction(() => {
    db.pragma('incremental_vacuum(16)')
  })
  try {
    while (!stopped()) {
      let phaseBegan = performance.now()
      const before = Number(db.pragma('freelist_count', { simple: true }))
      freelistMs += performance.now() - phaseBegan
      const began = performance.now()
      try {
        vacuum.immediate()
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_BUSY') break
        throw error
      } finally {
        transactionMs += performance.now() - began
      }
      longestLockMs = Math.max(longestLockMs, performance.now() - began)
      steps += 1
      phaseBegan = performance.now()
      const after = Number(db.pragma('freelist_count', { simple: true }))
      freelistMs += performance.now() - phaseBegan
      reclaimedPages += Math.max(0, before - after)
      phaseBegan = performance.now()
      db.pragma('wal_checkpoint(PASSIVE)')
      checkpointMs += performance.now() - phaseBegan
      if (after === 0 || after >= before) break
      phaseBegan = performance.now()
      await pause(25)
      pauseMs += performance.now() - phaseBegan
      pauses += 1
    }
  } finally {
    console.error('retention trace compaction aggregate', {
      at: process.hrtime.bigint().toString(),
      elapsedMs: performance.now() - compactionBegan,
      transactionMs,
      freelistMs,
      checkpointMs,
      pauseMs,
      pauses,
      steps,
      reclaimedPages,
    })
  }
  return { steps, reclaimedPages, longestLockMs }
}
