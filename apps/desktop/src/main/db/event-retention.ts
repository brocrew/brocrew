import { observeDatabaseMemory } from '../database-memory'
import Database from 'better-sqlite3'
import { setTimeout as pause, setImmediate as seeMessages } from 'node:timers/promises'
import {
  ANCHORS,
  conversationHeadSQL,
  historyStepsSQL,
  HISTORY_TYPES,
  keptNewest,
  NEWEST_ONLY,
} from './event-retention-policy'
import type { AppDatabase } from './connection'
import { committedChangesOf } from './committed-changes'

const KEEP_DAYS = 3
const BATCH_ROWS = 200
const ROWS_PER_SWEEP = 100_000
const BETWEEN_BATCHES_MS = 100
/**
 * Rows per read. Each row can be a page read of its own: on a 22 GB workspace with a cold cache a
 * read of 1,000 took 2.8 s, so a quit, which waits for the read under way, waits a quarter of that.
 */
const ROWS_PER_READ = 250

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
  // The unary plus keeps the conversation check off the indexes: the delete then seeks each id by
  // the primary key, instead of reading every row of the conversation through `session_id`.
  const remove = db.prepare(`DELETE FROM events
    WHERE +session_id = @session AND id IN (SELECT value FROM json_each(@ids))
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

interface ConversationHead {
  readonly active: number
  readonly building: number | null
  readonly after: number
}

interface HistoryRow {
  readonly id: string
  readonly g: number
  readonly o: number
  readonly at: number
  readonly k: string
  readonly protected: number
  readonly resumed: number
}

/**
 * Trim known history, retaining human/final records and the state/input anchors they use. Each
 * conversation is read in steps of {@link ROWS_PER_READ} rows, newest first, and the worker looks
 * at its messages before every read, so a stop is seen within one read.
 */
export async function trimOldEvents(
  file: string,
  stopped: () => boolean,
  write: (batch: EventTrimBatch) => Promise<EventTrimWrite>,
  now: number = Date.now(),
): Promise<EventTrimResult> {
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 })
  observeDatabaseMemory(db, 'event-retention')
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
  /** One timed read, after the worker has seen its messages; null once it is asked to stop. */
  const read = async <T>(run: () => T): Promise<T | null> => {
    await seeMessages()
    if (stopped()) return null
    const began = performance.now()
    const value = run()
    longestSelectionMs = Math.max(longestSelectionMs, performance.now() - began)
    return value
  }
  try {
    const conversations = db.prepare('SELECT id FROM provider_session ORDER BY id').all() as {
      id: string
    }[]
    const headOf = db.prepare(conversationHeadSQL)
    const steps = historyStepsSQL.map((sql) => db.prepare(sql))
    for (const { id: session } of conversations) {
      if (removed >= ROWS_PER_SWEEP) break
      const head = await read(() => headOf.get(session) as ConversationHead | undefined)
      if (head === null) return result(true)
      if (head === undefined || head.building !== null) {
        deferredConversations += 1
        continue
      }
      let found = 0
      let ids: string[] = []
      /** Applies the rows found so far; false when this conversation is to be left as it is. */
      const apply = async (): Promise<boolean | 'stop'> => {
        if (stopped()) return 'stop'
        const batch = { session, active: head.active, ids, before }
        ids = []
        try {
          const applied = await write(batch)
          longestBatchMs = Math.max(longestBatchMs, applied.durationMs)
          longestCheckpointMs = Math.max(longestCheckpointMs, applied.checkpointMs)
          if (applied.changed === null) {
            deferredConversations += 1
            return false
          }
          removed += applied.changed
        } catch (error) {
          if ((error as { code?: string }).code === 'SQLITE_BUSY' || stopped()) return 'stop'
          throw error
        }
        batches += 1
        await pause(BETWEEN_BATCHES_MS)
        return true
      }
      conversation: for (const type of HISTORY_TYPES) {
        const cap = keptNewest(type)
        const atAnyAge = NEWEST_ONLY.has(type)
        /** How many rows of each kind of this type are newer than the next one read. */
        const newer = new Map<string, number>()
        /** The anchors of this type not yet met: the first well-formed row in the active generation. */
        const unmet = new Set(ANCHORS[type])
        for (const [index, step] of steps.entries()) {
          const active = index === 0
          const older = index === historyStepsSQL.length - 1
          let generation = older ? head.active : Number.MAX_SAFE_INTEGER
          let ordinal = older ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
          for (;;) {
            const rows = await read(
              () =>
                step.all({
                  type,
                  session,
                  active: head.active,
                  generation,
                  ordinal,
                  limit: ROWS_PER_READ,
                }) as HistoryRow[],
            )
            if (rows === null) return result(true)
            for (const row of rows) {
              const nth = (newer.get(row.k) ?? 0) + 1
              newer.set(row.k, nth)
              let anchor = active && type === 'launched' && row.o > head.after
              if (active && !row.protected) {
                if (unmet.delete('command') || unmet.delete('inventory')) anchor = true
                if (!row.resumed && unmet.delete('declaration')) anchor = true
              }
              if (nth <= cap || row.protected || anchor || (!atAnyAge && row.at >= before)) continue
              found += 1
              ids.push(row.id)
              if (ids.length < Math.min(BATCH_ROWS, ROWS_PER_SWEEP - removed)) continue
              const applied = await apply()
              if (applied === 'stop') return result(true)
              if (!applied) break conversation
              if (removed >= ROWS_PER_SWEEP) break conversation
            }
            if (rows.length < ROWS_PER_READ) break
            generation = rows.at(-1)!.g
            ordinal = rows.at(-1)!.o
          }
        }
      }
      if (ids.length > 0 && removed < ROWS_PER_SWEEP) {
        const applied = await apply()
        if (applied === 'stop') return result(true)
      }
      largestCandidateListRows = Math.max(largestCandidateListRows, found)
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed)
    }
    return result(stopped())
  } finally {
    db.close()
  }
}
