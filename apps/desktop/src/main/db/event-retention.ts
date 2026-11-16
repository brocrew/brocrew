import Database from 'better-sqlite3'
import { setTimeout as pause } from 'node:timers/promises'
import { eventRetentionRowsSQL } from './event-retention-policy'
import type { AppDatabase } from './connection'
import { committedChangesOf } from './committed-changes'

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

export interface EventTrimBatch {
  readonly session: string
  readonly active: number
  readonly ids: readonly string[]
  readonly before: number
}

export interface EventTrimWrite {
  readonly changed: number | null
  readonly durationMs: number
  readonly checkpointMs: number
}

/** Apply the worker's bounded selection on the connection that records ordinary commits. */
export function eventTrimWriter(db: AppDatabase): (batch: EventTrimBatch) => EventTrimWrite {
  const committed = committedChangesOf(db)
  const generation = db.prepare(`SELECT coalesce(g.active,0) AS active, g.building
    FROM provider_session s LEFT JOIN derived_generation g ON g.session_id=s.id WHERE s.id=?`)
  const remove = db.prepare(`DELETE FROM events
    WHERE session_id = @session AND id IN (SELECT value FROM json_each(@ids))
      AND (created_at < @before OR type IN ('provider_commands','tool_inventory','launched'))`)
  const write = db.transaction((batch: EventTrimBatch) => {
    const current = generation.get(batch.session) as
      { active: number; building: number | null } | undefined
    if (!current || current.active !== batch.active || current.building !== null) return null
    const changed = remove.run({ ...batch, ids: JSON.stringify(batch.ids) }).changes
    if (changed > 0) committed.whole(batch.session, 'trimmed')
    return changed
  })
  return (batch) => {
    const began = performance.now()
    const changed = write.immediate(batch)
    const durationMs = performance.now() - began
    const checkpointBegan = performance.now()
    if (changed !== null) db.pragma('wal_checkpoint(PASSIVE)')
    return { changed, durationMs, checkpointMs: performance.now() - checkpointBegan }
  }
}

/** Trim known history, retaining human/final records and the state/input anchors they use. */
export async function trimOldEvents(
  file: string,
  stopped: () => boolean,
  write: (batch: EventTrimBatch) => Promise<EventTrimWrite>,
  now: number = Date.now(),
): Promise<EventTrimResult> {
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 })
  const before = now - KEEP_DAYS * 86_400_000
  let removed = 0
  let batches = 0
  let longestBatchMs = 0
  let longestSelectionMs = 0
  let largestCandidateListRows = 0
  let peakHeapBytes = 0
  let longestCheckpointMs = 0
  let deferredConversations = 0
  const result = (interrupted: boolean): EventTrimResult => ({
    removed,
    batches,
    longestBatchMs,
    longestSelectionMs,
    largestCandidateListRows,
    peakHeapBytes,
    longestCheckpointMs,
    incrementalSteps: 0,
    reclaimedPages: 0,
    longestIncrementalLockMs: 0,
    budgetReached: removed >= ROWS_PER_SWEEP,
    interrupted,
    deferredConversations,
  })
  try {
    const conversations = db.prepare('SELECT id FROM provider_session ORDER BY id').all() as {
      id: string
    }[]
    const candidates = db.prepare(`${eventRetentionRowsSQL} SELECT id FROM choices
      WHERE protected=0 AND anchor=0 AND nth>cap
        AND (at<@cutoff OR t IN ('provider_commands','tool_inventory','launched'))
      ORDER BY g,o LIMIT @limit`)
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
        try {
          const batch = await write({ session: conversation.id, active, ids, before })
          const changed = batch.changed
          longestBatchMs = Math.max(longestBatchMs, batch.durationMs)
          longestCheckpointMs = Math.max(longestCheckpointMs, batch.checkpointMs)
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
        await pause(BETWEEN_BATCHES_MS)
      }
    }
    return result(stopped())
  } finally {
    db.close()
  }
}
