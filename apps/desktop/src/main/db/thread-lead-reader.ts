import type { AppDatabase } from './connection'

export const THREAD_LEAD_EVENT_TYPES = [
  'compaction',
  'conversation_reset',
  'launched',
  'user_turn',
  'turn',
] as const

export interface ThreadLeadRow {
  readonly ordinal: number
  /** The row's own type. */
  readonly rowType: 'launched' | 'user_turn' | 'turn' | 'compaction' | 'conversation_reset'
  /** A launch's `given.thisConversation`, as stored. */
  readonly conversation: unknown
  /** Whether a message's row kept what it handed over (`sent`) at all. */
  readonly handedOver: boolean
  /** A message's `sent`, only when it opens with this conversation's text. */
  readonly sent: string | null
  /** A message's `lead`, as stored. */
  readonly lead: unknown
  /** A turn this app ended as failed (`state: 'failed'`, `wordOf: 'this-app'`). */
  readonly failedByThisApp: boolean
}

export function createThreadLeadReader(
  db: Pick<AppDatabase, 'prepare'>,
  activeGeneration: (sessionId: string) => number,
): {
  threadLeadRows(
    sessionId: string,
    leadsOpenWith: string,
    before?: number,
    historicalLeadsOpenWith?: string,
    fromOrdinal?: number,
  ): readonly ThreadLeadRow[]
} {
  const selectThreadLeadRows = db.prepare(
    `SELECT ordinal, type,
            CASE WHEN type = 'launched'
                  AND json_type(payload, '$.given.thisConversation') = 'object'
                 THEN json_extract(payload, '$.given.thisConversation') END AS conversation,
            CASE WHEN type = 'user_turn' THEN json_type(payload, '$.sent') = 'text' END AS handed,
            CASE WHEN type = 'user_turn' AND json_type(payload, '$.sent') = 'text'
                   AND (json_extract(payload, '$.sent') LIKE ? ESCAPE '\\'
                        OR json_extract(payload, '$.sent') LIKE ? ESCAPE '\\')
                 THEN json_extract(payload, '$.sent') END AS sent,
            CASE WHEN type = 'user_turn' AND json_type(payload, '$.lead') = 'object'
                 THEN json_extract(payload, '$.lead') END AS lead,
            CASE WHEN type = 'turn'
                 THEN json_extract(payload, '$.state') = 'failed'
                      AND json_extract(payload, '$.wordOf') = 'this-app' END AS failed
       FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal < ?
        AND type IN (${THREAD_LEAD_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
        AND (type IN ('compaction', 'conversation_reset') OR json_valid(payload))
      ORDER BY ordinal`,
  )

  return {
    threadLeadRows(
      sessionId,
      leadsOpenWith,
      before = Number.MAX_SAFE_INTEGER,
      historicalLeadsOpenWith = leadsOpenWith,
      fromOrdinal = Number.NEGATIVE_INFINITY,
    ) {
      const opening = `${leadsOpenWith.replace(/[\\%_]/g, (one) => `\\${one}`)}%`
      const historicalOpening = `${historicalLeadsOpenWith.replace(/[\\%_]/g, (one) => `\\${one}`)}%`
      const rows = selectThreadLeadRows.all(
        opening,
        historicalOpening,
        sessionId,
        activeGeneration(sessionId),
        fromOrdinal,
        before,
      ) as {
        ordinal: number
        type: ThreadLeadRow['rowType']
        conversation: string | null
        handed: number | null
        sent: string | null
        lead: string | null
        failed: number | null
      }[]
      const parsed = (text: string | null): unknown => {
        if (text === null) return null
        try {
          return JSON.parse(text) as unknown
        } catch {
          return null
        }
      }
      return rows.map((row) => ({
        ordinal: row.ordinal,
        rowType: row.type,
        conversation: parsed(row.conversation),
        handedOver: row.handed === 1,
        sent: row.sent,
        lead: parsed(row.lead),
        failedByThisApp: row.failed === 1,
      }))
    },
  }
}
