import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from './connection'
import { currentWorkTitle } from './current-work-title'
import { aStoredObject, toPersistedEvents } from './stored-event-codec'

interface TitlePoint {
  readonly id: string
  readonly at: number
}

export interface WorkSearchTitleMatch extends TitlePoint {
  readonly profile: string | null
  readonly provider: Provider | null
  readonly archivedAt: number | null
  readonly tasks: { id: string; title: string }[]
}

interface TitleRow {
  conversation: string
  updated_at: number
  profile: string | null
  provider: Provider | null
  archived_at: number | null
  piece: string | null
  title: string | null
  payload: string | null
  ordinal: number | null
  created_at: number | null
}

/** Read the small title catalogue separately from the ledgers used to describe search hits. */
export function matchingWorkTitles(
  db: AppDatabase,
  high: TitlePoint,
  includeMetadata: boolean,
  matches: (title: string) => boolean,
): WorkSearchTitleMatch[] {
  const rows = db.prepare(
    `WITH title_events AS (
       SELECT e.type, e.session_id, e.ordinal, e.created_at, e.payload,
              CASE WHEN e.type = 'work_retitled' AND json_valid(e.payload)
                THEN json_extract(e.payload, '$.piece') END AS piece
       FROM events e INDEXED BY events_kind_owner_idx
       LEFT JOIN derived_generation g ON g.session_id = e.session_id
       WHERE e.type IN ('titled', 'work_retitled') AND e.generation = coalesce(g.active, 0)
     ), latest AS (
       SELECT *, row_number() OVER (
         PARTITION BY session_id, type, piece ORDER BY ordinal DESC
       ) AS position
       FROM title_events
     ), catalogue AS (
       SELECT w.owner_session_id AS conversation, w.id AS piece, w.title,
              r.payload, r.ordinal, r.created_at, w.created_at AS given_at
       FROM work w
       LEFT JOIN latest r ON r.session_id = w.owner_session_id
         AND r.type = 'work_retitled' AND r.piece = w.id AND r.position = 1
       UNION ALL
       SELECT session_id, NULL, NULL, payload, ordinal, created_at, NULL
       FROM latest WHERE type = 'titled' AND position = 1
     )
     SELECT c.conversation, c.piece, c.title, c.payload, c.ordinal, c.created_at,
            s.updated_at, a.slug AS profile,
            ${includeMetadata ? 's.provider, archived.archived_at' : 'NULL AS provider, NULL AS archived_at'}
     FROM catalogue c JOIN provider_session s ON s.id = c.conversation
     LEFT JOIN agent_identity a ON a.id = s.agent_identity_id
     ${includeMetadata ? 'LEFT JOIN archived_conversation archived ON archived.conversation_id = s.id' : ''}
     WHERE (s.updated_at, s.id) <= (?, ?)
     ORDER BY s.updated_at DESC, s.id DESC, c.given_at DESC, c.piece DESC`,
  )
  const found = new Map<string, WorkSearchTitleMatch>()
  for (const row of rows.iterate(high.at, high.id) as Iterable<TitleRow>) {
    const title = titleFrom(row)
    if (title === null || !matches(title)) continue
    let hit = found.get(row.conversation)
    if (hit === undefined) {
      hit = {
        id: row.conversation,
        at: row.updated_at,
        profile: row.profile,
        provider: row.provider,
        archivedAt: row.archived_at,
        tasks: [],
      }
      found.set(row.conversation, hit)
    }
    if (row.piece !== null) hit.tasks.push({ id: row.piece, title })
  }
  return [...found.values()]
}

function titleFrom(row: TitleRow): string | null {
  if (row.piece !== null) return currentWorkTitle(row.title, aStoredObject(row.payload))
  if (row.payload === null || row.ordinal === null || row.created_at === null) return null
  const event = toPersistedEvents([
    { payload: row.payload, ordinal: row.ordinal, created_at: row.created_at },
  ])[0]?.event
  return event?.type === 'titled' ? event.title : null
}
