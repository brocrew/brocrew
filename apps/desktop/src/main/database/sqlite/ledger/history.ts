import type { AppDatabase } from '../../../db/connection'
import type { EventRow, PersistedEvent } from '../../../db/ledger-row-types'
import { toPersistedEvents } from '../../../db/stored-event-codec'
import { FOLD_TERM } from '../../../db/fold-index'
import type { TranscriptEvent } from '../../../../shared/conversation-events'
import { readAncestryContext, type AncestryContext } from './ancestry-read'
import { createThreadLeadReader } from './thread-lead-reader'

export interface LedgerWindowQuery {
  /** How many turns to take, counting back. At least one is always taken when one exists. */
  turns: number
  maxEvents: number
  before?: number
}

/** One page of a session's ledger, and enough to ask for the page before it. */
export interface LedgerWindow {
  entries: PersistedEvent[]
  from: number
  /** Whether any event exists below `from`. The cursor's "there is more", read rather than guessed. */
  hasOlder: boolean
  turnAligned: boolean
  toolsInForce?: PersistedEvent
}

export function createLedgerHistoryRead(
  db: AppDatabase,
  activeGeneration: (sessionId: string) => number,
) {
  const selectEventWindow = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? ORDER BY ordinal LIMIT ?`,
  )
  const selectNewestLaunched = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'launched'
        AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const { threadLeadRows } = createThreadLeadReader(db, activeGeneration)
  const selectNewestOfType = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND type = ? AND ordinal >= ? AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectEventRange = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal < ? ORDER BY ordinal`,
  )
  const selectTurnStarts = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type = 'user_turn' AND ordinal < ?
      ORDER BY ordinal DESC LIMIT ?`,
  )
  /** The `maxEvents`-th event counting back — the floor the turn boundary is not allowed below. */
  const selectEventFloor = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal < ? ORDER BY ordinal DESC LIMIT 1 OFFSET ?`,
  )
  const selectAnyEventBelow = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM events
                     WHERE session_id = ? AND generation = ? AND ordinal < ?) AS present`,
  )
  const selectToolsInForce = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_inventory_idx
      WHERE type = 'tool_inventory' AND session_id = ? AND generation = ? AND ordinal < ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectAnyEvent = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM events WHERE session_id = ? AND generation = ?) AS present`,
  )
  const selectMaxOrdinal = db.prepare(
    `SELECT max(ordinal) AS max_ordinal FROM events WHERE session_id = ? AND generation = ?`,
  )

  return {
    selectAnyEvent,
    selectMaxOrdinal,
    threadLeadRows,
    newestOfType(
      sessionId: string,
      type: TranscriptEvent['type'],
      before = Number.MAX_SAFE_INTEGER,
      from = 0,
    ): PersistedEvent | null {
      const generation = activeGeneration(sessionId)
      for (let below = before; ;) {
        const rows = (
          type === 'launched'
            ? selectNewestLaunched.all(sessionId, generation, below)
            : type === 'tool_inventory'
              ? selectToolsInForce.all(sessionId, generation, below)
              : selectNewestOfType.all(sessionId, generation, type, from, below)
        ) as EventRow[]
        const row = rows[0]
        if (row === undefined || row.ordinal < from) return null
        const entry = toPersistedEvents(rows)[0]
        if (entry !== undefined) return entry
        below = row.ordinal
      }
    },

    eventsFrom(sessionId: string, fromOrdinal: number, limit: number): PersistedEvent[] {
      const generation = activeGeneration(sessionId)
      for (let from = fromOrdinal; ;) {
        const rows = selectEventWindow.all(sessionId, generation, from, limit) as EventRow[]
        const last = rows[rows.length - 1]
        if (last === undefined) return []
        const entries = toPersistedEvents(rows)
        if (entries.length > 0) return entries
        from = last.ordinal + 1
      }
    },

    ancestryContext(
      sessionId: string,
      page: readonly PersistedEvent[],
      through: number,
      budget: number,
    ): AncestryContext {
      return readAncestryContext(
        db,
        sessionId,
        activeGeneration(sessionId),
        page,
        through,
        budget,
        (row) => toPersistedEvents([row])[0],
      )
    },

    turnWindow(sessionId: string, options: LedgerWindowQuery): LedgerWindow {
      const generation = activeGeneration(sessionId)
      const turns = Math.max(1, Math.floor(options.turns))
      const maxEvents = Math.max(1, Math.floor(options.maxEvents))
      const before =
        options.before ??
        ((selectMaxOrdinal.get(sessionId, generation) as { max_ordinal: number | null } | undefined)
          ?.max_ordinal ?? -1) + 1

      const floorRow = selectEventFloor.get(sessionId, generation, before, maxEvents - 1) as
        { ordinal: number } | undefined
      const eventFloor = floorRow?.ordinal ?? 0

      const starts = selectTurnStarts.all(sessionId, generation, before, turns) as {
        ordinal: number
      }[]

      let from = eventFloor
      let cutAtTurn = false
      if (starts.length >= turns) {
        for (const row of starts) {
          if (row.ordinal < eventFloor) break
          from = row.ordinal
          cutAtTurn = true
        }
      }

      const hasOlder =
        (selectAnyEventBelow.get(sessionId, generation, from) as { present: number }).present === 1
      const inForce = hasOlder
        ? (selectToolsInForce.get(sessionId, generation, from) as EventRow | undefined)
        : undefined
      const toolsInForce =
        inForce === undefined
          ? undefined
          : toPersistedEvents([inForce]).find((row) => row.event.type === 'tool_inventory')
      return {
        entries: toPersistedEvents(
          selectEventRange.all(sessionId, generation, from, before) as EventRow[],
        ),
        from,
        hasOlder,
        ...(toolsInForce === undefined ? {} : { toolsInForce }),
        turnAligned: cutAtTurn || !hasOlder,
      }
    },
  }
}
