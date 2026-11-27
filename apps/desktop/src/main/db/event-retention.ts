import { observeDatabaseMemory } from '../database-memory'
import Database from 'better-sqlite3'
import { keptChatter, repeatingWarning, type KeptChatter } from '../providers/kept-chatter'
import { setTimeout as pause, setImmediate as seeMessages } from 'node:timers/promises'
import {
  ANCHORS,
  conversationHeadSQL,
  historyStepsSQL,
  HISTORY_TYPES,
  keptNewest,
  NEWEST_ONLY,
  recoveryReadsFromSQL,
  rawPayloadSQL,
  turnInputSQL,
} from './event-retention-policy'
import type { AppDatabase } from './connection'
import { committedChangesOf } from './committed-changes'
import { THE_ROWS_A_REFUSED_TURN_IS_READ_IN } from '../../shared/refused-turn-window'

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
  readonly incrementalSteps: number
  readonly reclaimedPages: number
  readonly longestIncrementalLockMs: number
  readonly budgetReached: boolean
  readonly interrupted: boolean
  readonly deferredConversations: number
  /** Selections made, each after a check for a stop: how far a stopped sweep got (404). */
  readonly reads: number
  /** Rows selected under a kind's own rule ({@link keptChatter}), by provider and label. */
  readonly chatterSelected: Readonly<Record<string, number>>
}

export interface EventTrimBatch {
  readonly session: string
  readonly active: number
  readonly ids: readonly string[]
  readonly before: number
  /** The ids a kind's own rule removes however recent they are. */
  readonly atAnyAge?: readonly string[]
}

export interface EventTrimWrite {
  readonly changed: number | null
  readonly durationMs: number
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
      AND (created_at < @before OR type IN ('provider_commands','tool_inventory')
        OR id IN (SELECT value FROM json_each(@atAnyAge)))`)
  const write = db.transaction((batch: EventTrimBatch) => {
    const current = generation.get(batch.session) as
      { active: number; building: number | null } | undefined
    if (!current || current.active !== batch.active || current.building !== null) return null
    const changed = remove.run({
      session: batch.session,
      before: batch.before,
      ids: JSON.stringify(batch.ids),
      atAnyAge: JSON.stringify(batch.atAnyAge ?? []),
    }).changes
    if (changed > 0) committed.whole(batch.session, 'trimmed')
    return changed
  })
  return (batch) => {
    const began = performance.now()
    const changed = write.immediate(batch)
    return { changed, durationMs: performance.now() - began }
  }
}

interface ConversationHead {
  readonly active: number
  readonly building: number | null
}

interface HistoryRow {
  readonly id: string
  readonly g: number
  readonly o: number
  readonly at: number
  readonly t: string | null
  readonly k: string
  readonly labelled: number
  readonly malformed: number
  readonly protected: number
  readonly resumed: number
  readonly message: string | null
  readonly stall: number
  readonly fatal: number
}

/** A repeating warning keeps its newest one, of its own kind, at any age. */
const WARNING_RULE: KeptChatter = { category: 'error', newest: 1 }

interface ChatterKind {
  readonly label: string
  readonly rule: KeptChatter | null
}

/** A stored chatter kind's own rule, from its `[provider, category, label]` key. */
function chatterKindOf(k: string, known: Map<string, ChatterKind>): ChatterKind | null {
  if (k === '') return null
  let kind = known.get(k)
  if (kind === undefined) {
    const [provider, category, label] = JSON.parse(k) as [unknown, unknown, unknown]
    const named =
      typeof provider === 'string' && typeof category === 'string' && typeof label === 'string'
    kind = {
      label: named ? `${provider} ${label}` : k,
      rule: named ? keptChatter(provider, category, label) : null,
    }
    known.set(k, kind)
  }
  return kind
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
  let deferredConversations = 0
  let reads = 0
  const chatterSelected: Record<string, number> = {}
  const result = (interrupted: boolean): EventTrimResult => ({
    removed,
    batches,
    longestBatchMs,
    longestSelectionMs,
    largestCandidateListRows,
    peakHeapBytes,
    incrementalSteps: 0,
    reclaimedPages: 0,
    longestIncrementalLockMs: 0,
    budgetReached: removed >= ROWS_PER_SWEEP,
    interrupted,
    deferredConversations,
    reads,
    chatterSelected,
  })
  /** One timed read, after the worker has seen its messages; null once it is asked to stop. */
  const read = async <T>(run: () => T): Promise<T | null> => {
    await seeMessages()
    if (stopped()) return null
    const began = performance.now()
    reads += 1
    const value = run()
    longestSelectionMs = Math.max(longestSelectionMs, performance.now() - began)
    return value
  }
  try {
    const conversations = db.prepare('SELECT id FROM provider_session ORDER BY id').all() as {
      id: string
    }[]
    const headOf = db.prepare(conversationHeadSQL)
    const rawOf = db.prepare(rawPayloadSQL).pluck()
    const recoveryReadsFrom = db.prepare(recoveryReadsFromSQL).pluck()
    const inputOf = db.prepare(turnInputSQL)
    const kinds = new Map<string, ChatterKind>()
    /** Whether a row beyond its kind's newest may go: null once the sweep is asked to stop. */
    const ruleAllows = async (
      rule: KeptChatter,
      row: HistoryRow,
      session: string,
    ): Promise<boolean | null> => {
      if (rule.echoed === undefined && rule.routine === undefined) return !row.protected
      const json = await read(() => rawOf.get(row.id) as string | null | undefined)
      if (json === null) return null
      const raw: unknown = json === undefined ? undefined : JSON.parse(json)
      if (rule.routine !== undefined && !rule.routine(raw)) return false
      if (rule.echoed === undefined) return !row.protected
      const text = rule.echoed(raw)
      if (text === null || row.t === null) return false
      const inputs = await read(
        () =>
          inputOf.all({ session, generation: row.g, turn: row.t }) as {
            sent: unknown
            text: unknown
          }[],
      )
      if (inputs === null) return null
      // What was sent is the input; the displayed words stand in only when nothing else was kept.
      return inputs.some((input) =>
        typeof input.sent === 'string' ? input.sent === text : input.text === text,
      )
    }
    const steps = historyStepsSQL.map((sql) => db.prepare(sql))
    for (const { id: session } of conversations) {
      if (removed >= ROWS_PER_SWEEP) break
      const head = await read(() => headOf.get(session) as ConversationHead | undefined)
      if (head === null) return result(true)
      if (head === undefined || head.building !== null) {
        deferredConversations += 1
        continue
      }
      const recoveryReads = await read(
        () =>
          recoveryReadsFrom.get({
            session,
            generation: head.active,
            window: THE_ROWS_A_REFUSED_TURN_IS_READ_IN,
          }) as number,
      )
      if (recoveryReads === null) return result(true)
      let found = 0
      let ids: string[] = []
      let atAnyAgeIds: string[] = []
      /** Applies the rows found so far; false when this conversation is to be left as it is. */
      const apply = async (): Promise<boolean | 'stop'> => {
        if (stopped()) return 'stop'
        const batch = { session, active: head.active, ids, before, atAnyAge: atAnyAgeIds }
        ids = []
        atAnyAgeIds = []
        try {
          const applied = await write(batch)
          longestBatchMs = Math.max(longestBatchMs, applied.durationMs)
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
        /** The same, counting only the rows a kind's own rule covers. */
        const ruled = new Map<string, number>()
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
              const warning =
                type === 'error'
                  ? repeatingWarning(row.message, row.stall === 1, row.fatal === 1)
                  : null
              if (type === 'error' && warning === null) continue
              const key = warning === null ? row.k : `warning ${warning}`
              const nth = (newer.get(key) ?? 0) + 1
              newer.set(key, nth)
              let anchor = false
              if (active && !row.protected) {
                if (unmet.delete('command') || unmet.delete('inventory')) anchor = true
                if (!row.resumed && unmet.delete('declaration')) anchor = true
              }
              const kind =
                warning !== null
                  ? { label: key, rule: WARNING_RULE }
                  : row.labelled === 1
                    ? chatterKindOf(row.k, kinds)
                    : null
              if (kind?.rule) {
                // Only rows the rule covers count toward its newest: an unlabelled or malformed row
                // of the same key never stands in for the newest reading, and is kept anyway.
                if (row.malformed) continue
                const nthOfRule = (ruled.get(key) ?? 0) + 1
                ruled.set(key, nthOfRule)
                if (nthOfRule <= kind.rule.newest) continue
                if (row.g === head.active && row.o >= recoveryReads) continue
                const allowed = await ruleAllows(kind.rule, row, session)
                if (allowed === null) return result(true)
                if (!allowed) continue
                atAnyAgeIds.push(row.id)
                chatterSelected[kind.label] = (chatterSelected[kind.label] ?? 0) + 1
              } else if (nth <= cap || row.protected || anchor || (!atAnyAge && row.at >= before))
                continue
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
