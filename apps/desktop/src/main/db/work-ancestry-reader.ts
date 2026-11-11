import type { AppDatabase } from './connection'
import type { PersistedEvent } from './session-store'
import type { TranscriptEvent } from '../../shared/conversation-events'
import { ANCESTRY_ACCESS, ANCESTRY_HAS_DISPATCH } from './work-ancestry-index'

export type AncestryKey = { readonly kind: keyof typeof ANCESTRY_ACCESS; readonly id: string }
export interface AncestryEpoch {
  readonly after: number
  readonly through: number
  readonly entries: readonly PersistedEvent[]
  readonly missing: readonly AncestryKey[]
  readonly truncated: boolean
}
export interface AncestryContext {
  readonly epochs: readonly AncestryEpoch[]
  readonly entries: readonly PersistedEvent[]
  readonly missing: readonly AncestryKey[]
  readonly truncated: boolean
}

/** Each wanted identity makes an indexed latest-fact seek, not a scan of its event population. */
export function ancestrySeekSql(kind: AncestryKey['kind'], count: number): string {
  const access = ANCESTRY_ACCESS[kind]
  return `WITH wanted(id) AS (VALUES ${Array.from({ length: count }, () => '(?)').join(',')})
    ${kind === 'agent' ? ', parts(has_dispatch) AS (VALUES (0),(1))' : ''}
    SELECT wanted.id AS wanted, e.ordinal, e.payload, e.created_at
      FROM wanted ${kind === 'agent' ? 'CROSS JOIN parts' : ''} LEFT JOIN events e
        ON e.session_id = ? AND e.generation = ? AND e.ordinal = (
          SELECT ordinal FROM events INDEXED BY ${access.index}
           WHERE session_id = ? AND generation = ? AND ${access.term}
             AND ${access.expression} = wanted.id ${kind === 'agent' ? `AND ${ANCESTRY_HAS_DISPATCH} = parts.has_dispatch` : ''} AND ordinal > ? AND ordinal <= ?
           ORDER BY ordinal DESC LIMIT 1)`
}

export const ancestryResetBeforeSql = `SELECT ordinal FROM events INDEXED BY events_kind_owner_idx
  WHERE type = 'conversation_reset' AND session_id = ? AND generation = ? AND ordinal <= ?
  ORDER BY ordinal DESC LIMIT 1`
export const ancestryResetsInPageSql = `SELECT ordinal FROM events INDEXED BY events_kind_owner_idx
  WHERE type = 'conversation_reset' AND session_id = ? AND generation = ? AND ordinal > ? AND ordinal <= ?
  ORDER BY ordinal`

function readEpoch(
  db: AppDatabase,
  sessionId: string,
  generation: number,
  page: readonly PersistedEvent[],
  after: number,
  through: number,
  budget: number,
  recorded: (row: {
    ordinal: number
    payload: string
    created_at: number
  }) => PersistedEvent | undefined,
): AncestryEpoch & { reads: number } {
  const queued: AncestryKey[] = []
  const seen = new Map<AncestryKey['kind'], Set<string>>([
    ['agent', new Set()],
    ['tool', new Set()],
    ['dispatch', new Set()],
  ])
  const add = (kind: AncestryKey['kind'], id: string): void => {
    if (seen.get(kind)!.has(id)) return
    seen.get(kind)!.add(id)
    queued.push({ kind, id })
  }
  const need = (event: TranscriptEvent): void => {
    if (event.type === 'tool_result') add('tool', event.id)
    if (event.type === 'sub_agent') {
      add('agent', event.agentId)
      if (event.parentToolCallId !== undefined) add('tool', event.parentToolCallId)
    }
    if ('parentToolCallId' in event && typeof event.parentToolCallId === 'string') {
      add('dispatch', event.parentToolCallId)
    }
  }
  for (const row of page) need(row.event)
  const entries = new Map<number, PersistedEvent>()
  const missing: AncestryKey[] = []
  let reads = 0
  while (queued.length > 0 && reads < budget) {
    const frontier = queued.splice(0, Math.min(queued.length, budget - reads))
    reads += frontier.length
    for (const kind of ['agent', 'tool', 'dispatch'] as const) {
      const keys = frontier.filter((key) => key.kind === kind)
      if (keys.length === 0) continue
      const rows = db
        .prepare(ancestrySeekSql(kind, keys.length))
        .all(
          ...keys.map((key) => key.id),
          sessionId,
          generation,
          sessionId,
          generation,
          after,
          through,
        ) as {
        wanted: string
        ordinal: number | null
        payload: string | null
        created_at: number
      }[]
      const found = new Set(rows.filter((row) => row.ordinal !== null).map((row) => row.wanted))
      for (const key of keys) {
        if (!found.has(key.id)) missing.push(key)
      }
      for (const row of rows) {
        if (row.ordinal === null || row.payload === null) continue
        if (entries.has(row.ordinal)) continue
        const entry = recorded({
          ordinal: row.ordinal,
          payload: row.payload,
          created_at: row.created_at,
        })
        if (entry === undefined) {
          missing.push({ kind, id: row.wanted })
          continue
        }
        entries.set(row.ordinal, entry)
        need(entry.event)
      }
    }
  }
  return {
    after,
    through,
    reads,
    entries: [...entries.values()].sort((a, b) => a.ordinal - b.ordinal),
    missing,
    truncated: queued.length > 0,
  }
}

/** Reset seeks use the existing type/owner/ordinal index; the range lies inside the bounded page. */
export function readAncestryContext(
  db: AppDatabase,
  sessionId: string,
  generation: number,
  page: readonly PersistedEvent[],
  through: number,
  budget: number,
  recorded: (row: {
    ordinal: number
    payload: string
    created_at: number
  }) => PersistedEvent | undefined,
): AncestryContext {
  const first = page[0]?.ordinal ?? through
  const prior = db.prepare(ancestryResetBeforeSql).get(sessionId, generation, first) as
    { ordinal: number } | undefined
  const boundaries = db
    .prepare(ancestryResetsInPageSql)
    .all(sessionId, generation, first, through) as { ordinal: number }[]
  const floors = [prior?.ordinal ?? -1, ...boundaries.map((row) => row.ordinal)]
  const epochs: AncestryEpoch[] = []
  let remaining = budget
  let position = 0
  for (const [index, after] of floors.entries()) {
    const end = Math.min(through, (floors[index + 1] ?? through + 1) - 1)
    const rows: PersistedEvent[] = []
    while (position < page.length && page[position]!.ordinal <= end) {
      rows.push(page[position++]!)
    }
    if (rows.length === 0) continue
    const epoch = readEpoch(db, sessionId, generation, rows, after, end, remaining, recorded)
    remaining -= epoch.reads
    epochs.push(epoch)
  }
  return {
    epochs,
    entries: epochs.flatMap((epoch) => epoch.entries),
    missing: epochs.flatMap((epoch) => epoch.missing),
    truncated: epochs.some((epoch) => epoch.truncated),
  }
}
