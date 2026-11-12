import type { AppDatabase } from './connection'
import type { DigestRow, EventRow } from './ledger-row-types'
import type { LedgerWalk } from '../../shared/question-contracts'
import { DIGEST_EVENT_TYPES } from '../../shared/digest'
import { toPersistedEvents } from './stored-event-codec'

/** A digest row as the database holds it — a ledger row plus the conversation it came from. */
interface DigestEventRow extends EventRow {
  session_id: string
}

export function createDigestWindowRead(
  db: AppDatabase,
  activeGeneration: (sessionId: string) => number,
  digestThroughOrdinal: (id: string, generation: number) => number,
) {
  const countPlacedConversations = db.prepare(
    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NOT NULL`,
  )
  const selectDigestWindow = db.prepare(
    `SELECT e.session_id AS session_id, e.ordinal AS ordinal, e.payload AS payload,
            e.created_at AS created_at
       FROM provider_session s
       JOIN events e ON e.session_id = s.id
      WHERE s.agent_identity_id IS NOT NULL
        AND e.created_at >= ? AND e.created_at < ?
        AND e.generation = coalesce(
              (SELECT d.active FROM derived_generation d WHERE d.session_id = e.session_id), 0)
        AND e.type IN ('work_given', 'work_replied', 'work_taken_back', 'work_closed',
                       'request_routed',
                       'request_escalated', 'request_stranded', 'request_resolved',
                       'request_interrupted',
                       'question_asked', 'user_decision', 'work_interrupted',
                       'work_restarted', 'tool_refused', 'turn',
                       'sub_agent', 'workflow_run',
                       'tool_call', 'tool_result', 'message_unqueued')
      ORDER BY e.created_at, e.session_id, e.ordinal`,
  )
  const selectPlacedConversationIds = db.prepare(
    `SELECT id FROM provider_session WHERE agent_identity_id IS NOT NULL`,
  )
  // Its type list is `DIGEST_EVENT_TYPES` itself, so it cannot drift from the digest's vocabulary.
  const selectDigestRowsAfter = db.prepare(
    `SELECT session_id, ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? AND ordinal > ? AND ordinal <= ?
        AND type IN (${DIGEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
      ORDER BY ordinal`,
  )
  interface KeptDigestRow {
    readonly at: number
    /** `null` for a row too torn to read: counted, never shown. */
    readonly row: DigestRow | null
  }
  const keptDigest = new Map<
    string,
    { generation: number; through: number; rows: KeptDigestRow[] }
  >()
  // The oldest moment the kept rows reach back to; a read reaching further starts afresh.
  let keptDigestFrom: number | null = null
  // The Away page reads every 30 s while it is shown; once it has stopped, the rows are let go.
  const DIGEST_ROWS_KEPT_FOR_MS = 120_000
  let letTheDigestRowsGo: ReturnType<typeof setTimeout> | undefined
  function forgetTheDigestRows(): void {
    keptDigest.clear()
    keptDigestFrom = null
  }
  function keepTheDigestRowsAWhile(): void {
    clearTimeout(letTheDigestRowsGo)
    letTheDigestRowsGo = setTimeout(forgetTheDigestRows, DIGEST_ROWS_KEPT_FOR_MS)
    letTheDigestRowsGo.unref?.()
  }

  function keptDigestRowsOf(rows: DigestEventRow[], from: number): KeptDigestRow[] {
    return rows
      .filter((row) => row.created_at >= from)
      .map((row) => {
        const [entry] = toPersistedEvents([row], () => {})
        return {
          at: row.created_at,
          row:
            entry === undefined
              ? null
              : {
                  sessionId: row.session_id,
                  ordinal: entry.ordinal,
                  at: entry.at,
                  event: entry.event,
                },
        }
      })
  }

  const keptDigestRows = db.transaction((from: number): void => {
    const placed = (selectPlacedConversationIds.all() as { id: string }[]).map((one) => one.id)
    if (keptDigestFrom === null || from < keptDigestFrom) {
      keptDigest.clear()
      keptDigestFrom = from
      const all = selectDigestWindow.all(from, Number.MAX_SAFE_INTEGER) as DigestEventRow[]
      const bySession = new Map<string, DigestEventRow[]>()
      for (const row of all) {
        const own = bySession.get(row.session_id)
        if (own === undefined) bySession.set(row.session_id, [row])
        else own.push(row)
      }
      for (const id of placed) {
        const generation = activeGeneration(id)
        keptDigest.set(id, {
          generation,
          through: digestThroughOrdinal(id, generation),
          rows: keptDigestRowsOf(bySession.get(id) ?? [], from),
        })
      }
      return
    }
    const stillPlaced = new Set(placed)
    for (const id of [...keptDigest.keys()]) if (!stillPlaced.has(id)) keptDigest.delete(id)
    for (const id of placed) {
      const generation = activeGeneration(id)
      const newest = digestThroughOrdinal(id, generation)
      const kept = keptDigest.get(id)
      if (kept === undefined || kept.generation !== generation) {
        const rows = selectDigestRowsAfter.all(id, generation, -1, newest) as DigestEventRow[]
        keptDigest.set(id, { generation, through: newest, rows: keptDigestRowsOf(rows, from) })
        continue
      }
      if (newest > kept.through) {
        const rows = selectDigestRowsAfter.all(
          id,
          generation,
          kept.through,
          newest,
        ) as DigestEventRow[]
        for (const one of keptDigestRowsOf(rows, from)) kept.rows.push(one)
        kept.through = newest
      }
      const first = kept.rows[0]
      if (first !== undefined && first.at < from)
        kept.rows = kept.rows.filter((one) => one.at >= from)
    }
    keptDigestFrom = from
  })
  return {
    activityWindow(from: number, to: number): LedgerWalk<DigestRow> {
      const selected = selectDigestWindow.all(from, to) as DigestEventRow[]
      const decoded = keptDigestRowsOf(selected, from)
      return {
        rows: decoded.flatMap((one) => (one.row === null ? [] : [one.row])),
        walk: 'one-window-over-every-agents-conversation',
        ledgers: (countPlacedConversations.get() as { n: number }).n,
        rowsUnread: decoded.filter((one) => one.row === null).length,
      }
    },

    digestWindow(from: number, to: number): LedgerWalk<DigestRow> {
      const insideATransaction = db.inTransaction
      try {
        keptDigestRows(from)
      } catch (error) {
        forgetTheDigestRows()
        throw error
      }
      keepTheDigestRowsAWhile()
      const ledgers = (countPlacedConversations.get() as { n: number }).n
      let rowsUnread = 0
      const rows: DigestRow[] = []
      for (const kept of keptDigest.values()) {
        for (const one of kept.rows) {
          if (one.at < from || one.at >= to) continue
          if (one.row === null) rowsUnread += 1
          else rows.push(one.row)
        }
      }
      if (insideATransaction) forgetTheDigestRows()
      // The window read's own order: by time, then conversation, then ordinal.
      rows.sort(
        (a, b) =>
          a.at - b.at ||
          (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
          a.ordinal - b.ordinal,
      )
      return {
        rows,
        walk: 'one-window-over-every-agents-conversation',
        ledgers,
        rowsUnread,
      }
    },
  }
}
