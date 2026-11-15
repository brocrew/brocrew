import Database from 'better-sqlite3'
import { setTimeout as pause } from 'node:timers/promises'
import { eventRetentionRowsSQL } from './event-retention-policy'
import { incrementallyCompact } from './compact'

const KEEP_DAYS = 3
const BATCH_ROWS = 200
const ROWS_PER_SWEEP = 100_000
const BETWEEN_BATCHES_MS = 100

export interface EventTrimResult {
  readonly removed: number
  readonly batches: number
  readonly longestBatchMs: number
  readonly longestSelectionMs: number
  readonly largestCandidateListRows: number
  readonly peakHeapBytes: number
  readonly longestCheckpointMs: number
  readonly incrementalSteps: number
  readonly reclaimedPages: number
  readonly longestIncrementalLockMs: number
  readonly budgetReached: boolean
  readonly interrupted: boolean
  readonly deferredConversations: number
}

/** Trim known history, retaining human/final records and the state/input anchors they use. */
export async function trimOldEvents(
  file: string,
  stopped: () => boolean,
  now: number = Date.now(),
): Promise<EventTrimResult> {
  const db = new Database(file, { fileMustExist: true, timeout: 0 })
  const before = now - KEEP_DAYS * 86_400_000
  let removed = 0
  let batches = 0
  let longestBatchMs = 0
  let longestSelectionMs = 0
  let largestCandidateListRows = 0
  let peakHeapBytes = 0
  let longestCheckpointMs = 0
  let deferredConversations = 0
  let incremental = { steps: 0, reclaimedPages: 0, longestLockMs: 0 }
  const result = (interrupted: boolean): EventTrimResult => ({
    removed,
    batches,
    longestBatchMs,
    longestSelectionMs,
    largestCandidateListRows,
    peakHeapBytes,
    longestCheckpointMs,
    incrementalSteps: incremental.steps,
    reclaimedPages: incremental.reclaimedPages,
    longestIncrementalLockMs: incremental.longestLockMs,
    budgetReached: removed >= ROWS_PER_SWEEP,
    interrupted,
    deferredConversations,
  })
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('wal_autocheckpoint = 0')
    const conversations = db.prepare('SELECT id FROM provider_session ORDER BY id').all() as {
      id: string
    }[]
    const candidates = db.prepare(`${eventRetentionRowsSQL} SELECT id FROM choices
      WHERE protected=0 AND anchor=0 AND nth>cap
        AND (at<@cutoff OR t IN ('provider_commands','tool_inventory','launched'))
      ORDER BY g,o LIMIT @limit`)
    const remove = db.prepare(`DELETE FROM events
      WHERE id IN (SELECT value FROM json_each(?))
        AND (created_at < ? OR type IN ('provider_commands','tool_inventory','launched'))`)
    const generation = db.prepare(`SELECT coalesce(g.active,0) AS active, g.building
      FROM provider_session s LEFT JOIN derived_generation g ON g.session_id=s.id WHERE s.id=?`)
    const currentGeneration = (session: string) =>
      generation.get(session) as { active: number; building: number | null } | undefined
    const select = db.transaction((session: string, limit: number) => {
      const current = currentGeneration(session)
      if (!current || current.building !== null) return null
      return {
        active: current.active,
        rows: candidates.all({ session, cutoff: before, limit }) as { id: string }[],
      }
    })
    const write = db.transaction((session: string, active: number, ids: readonly string[]) => {
      const current = currentGeneration(session)
      if (!current || current.active !== active || current.building !== null) return null
      return remove.run(JSON.stringify(ids), before).changes
    })
    sweep: for (const conversation of conversations) {
      if (stopped() || removed >= ROWS_PER_SWEEP) break
      const selectionBegan = performance.now()
      const selected = select.deferred(conversation.id, ROWS_PER_SWEEP - removed)
      longestSelectionMs = Math.max(longestSelectionMs, performance.now() - selectionBegan)
      if (selected === null) {
        deferredConversations += 1
        continue
      }
      const { rows, active } = selected
      largestCandidateListRows = Math.max(largestCandidateListRows, rows.length)
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed)
      for (let from = 0; from < rows.length && !stopped();) {
        if (removed >= ROWS_PER_SWEEP) break sweep
        const take = Math.min(BATCH_ROWS, ROWS_PER_SWEEP - removed)
        const ids = rows.slice(from, from + take).map((row) => row.id)
        from += ids.length
        const began = performance.now()
        try {
          const changed = write.immediate(conversation.id, active, ids)
          if (changed === null) {
            deferredConversations += 1
            break
          }
          removed += changed
        } catch (error) {
          if ((error as { code?: string }).code === 'SQLITE_BUSY') return result(true)
          throw error
        }
        batches += 1
        longestBatchMs = Math.max(longestBatchMs, performance.now() - began)
        const checkpointBegan = performance.now()
        db.pragma('wal_checkpoint(PASSIVE)')
        longestCheckpointMs = Math.max(longestCheckpointMs, performance.now() - checkpointBegan)
        await pause(BETWEEN_BATCHES_MS)
      }
    }
    incremental = await incrementallyCompact(db, stopped)
    return result(stopped())
  } finally {
    db.close()
  }
}
