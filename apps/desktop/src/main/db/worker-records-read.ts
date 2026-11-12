import type { AppDatabase, AppStatement } from './connection'
import type { EventRow, PersistedEvent } from './ledger-row-types'
import type { TranscriptEvent } from '../../shared/conversation-events'
import type { WorkerBorn } from '../profile-execution-file'
import { workerRegistrationOf } from '../worker-registration'
import { FOLD_TERM } from './fold-index'
import { aStoredObject, isAStoredId, boundStoredEvent } from './stored-event-codec'

export function createWorkerRecordsRead(
  db: AppDatabase,
  selectOne: AppStatement,
  activeGeneration: (sessionId: string) => number,
) {
  // Worker birth is always the first row of the first life, so this is a constant index probe.
  const selectWorkerBirths = db.prepare(
    `SELECT s.id, s.agent_identity_id AS identity, a.created_at AS identityCreatedAt,
            substr(e.payload, 1, 4097) AS payload, length(e.payload) AS characters
       FROM (SELECT id, agent_identity_id FROM provider_session INDEXED BY provider_session_parent_identity_idx
             WHERE parent_session_id IS NOT NULL LIMIT 8193) AS s
       CROSS JOIN events AS e INDEXED BY events_session_ordinal_uq
         ON e.session_id = s.id AND e.generation = 0 AND e.ordinal = 0
       LEFT JOIN agent_identity AS a ON a.id = s.agent_identity_id
       WHERE e.type = 'worker_registered'
       ORDER BY s.id LIMIT 8193`,
  )
  const workerCandidateCount = db.prepare(
    `SELECT count(*) AS total FROM (SELECT 1 FROM provider_session INDEXED BY provider_session_parent_identity_idx
       WHERE parent_session_id IS NOT NULL LIMIT 8193)`,
  )
  const workerGiverReplacements = db.prepare(
    `SELECT substr(payload, 1, 4097) AS payload, length(payload) AS characters
       FROM events INDEXED BY events_kind_owner_idx WHERE ${FOLD_TERM}
         AND session_id = ? AND type = 'replaced_by'
       ORDER BY generation DESC, ordinal DESC LIMIT 2`,
  )
  function workerReplacementChain(first: string): readonly string[] {
    if (selectOne.get(first) === undefined) throw new Error('worker replacement record is missing')
    const seen = new Set<string>()
    const chain: string[] = []
    let current = first
    for (let hops = 0; hops < 64; hops += 1) {
      if (seen.has(current)) throw new Error('worker replacement lineage is cyclic')
      seen.add(current)
      chain.push(current)
      const rows = workerGiverReplacements.all(current) as { payload: string; characters: number }[]
      if (rows.length === 0) return chain
      const next = rows.map((row) => {
        if (row.characters > 4096) throw new Error('worker replacement is too large')
        const event = aStoredObject(row.payload)
        if (event?.type !== 'replaced_by' || !isAStoredId(event.sessionId)) {
          throw new Error('worker replacement is unreadable')
        }
        return event.sessionId
      })
      if (next.length !== 1) throw new Error('worker replacement is ambiguous')
      current = next[0]!
      if (selectOne.get(current) === undefined)
        throw new Error('worker replacement target is missing')
    }
    throw new Error('worker replacement lineage is too deep')
  }
  function workerGiverContains(giver: string, conversation: string): boolean {
    return workerReplacementChain(giver).includes(conversation)
  }
  function workerInItsPlace(conversation: string): string {
    return workerReplacementChain(conversation).at(-1)!
  }
  const workerLedgerBudget = db.prepare(
    `SELECT count(*) AS rows, coalesce(sum(length(CAST(payload AS BLOB))), 0) AS bytes
       FROM (SELECT payload FROM events INDEXED BY events_session_ordinal_uq
         WHERE session_id = ? AND generation = ? ORDER BY ordinal LIMIT 8193)`,
  )
  const workerLedgerRead = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_session_ordinal_uq
       WHERE session_id = ? AND generation = ? ORDER BY ordinal LIMIT 8193`,
  )
  function workerLedger(
    conversation: string,
    left?: { rowsLeft: number; bytesLeft: number },
  ): readonly PersistedEvent[] | null {
    if (left !== undefined && (left.rowsLeft <= 0 || left.bytesLeft <= 0)) return null
    if (selectOne.get(conversation) === undefined) return null
    const generation = activeGeneration(conversation)
    const budget = workerLedgerBudget.get(conversation, generation) as {
      rows: number
      bytes: number
    }
    if (
      budget.rows > 8192 ||
      budget.bytes > 8 * 1024 * 1024 ||
      (left !== undefined && (budget.rows > left.rowsLeft || budget.bytes > left.bytesLeft))
    ) {
      if (left !== undefined) {
        left.rowsLeft = 0
        left.bytesLeft = 0
      }
      return null
    }
    if (left !== undefined) {
      left.rowsLeft -= budget.rows
      left.bytesLeft -= budget.bytes
    }
    const rows = workerLedgerRead.all(conversation, generation) as EventRow[]
    try {
      return rows.map((row) => {
        const event = aStoredObject(row.payload)
        if (event === null || typeof event.type !== 'string')
          throw new Error('worker ledger unreadable')
        return {
          ordinal: row.ordinal,
          at: row.created_at,
          event: boundStoredEvent(event as unknown as TranscriptEvent),
        }
      })
    } catch {
      return null
    }
  }
  const workerRoutingRows = db.prepare(
    `SELECT session_id, substr(payload, 1, 4097) AS payload, length(payload) AS characters
       FROM events INDEXED BY events_request_routed_idx WHERE type = 'request_routed'
       ORDER BY session_id, ordinal LIMIT 8193`,
  )
  function workerQuestionTargets(): readonly { asker: string; recipient: string }[] | null {
    const rows = workerRoutingRows.all() as {
      session_id: string
      payload: string
      characters: number
    }[]
    if (rows.length > 8192) return null
    const targets: { asker: string; recipient: string }[] = []
    for (const row of rows) {
      if (row.characters > 4096) return null
      const event = aStoredObject(row.payload)
      if (
        event?.type !== 'request_routed' ||
        !isAStoredId(event.requestId) ||
        (event.parent !== null && !isAStoredId(event.parent))
      )
        return null
      if (event.parent !== null) targets.push({ asker: row.session_id, recipient: event.parent })
    }
    return targets
  }
  function workersBorn(): readonly WorkerBorn[] {
    const count = workerCandidateCount.get() as { total: number }
    if (count.total > 8192) throw new Error('too many worker birth candidates')
    const rows = selectWorkerBirths.all() as {
      id: string
      identity: string | null
      identityCreatedAt: number | null
      payload: string
      characters: number
    }[]
    if (rows.length > 8192) throw new Error('too many worker registrations')
    return rows.map((row) => {
      if (row.characters > 4096) throw new Error('worker registration is too large')
      const fact = workerRegistrationOf(JSON.parse(row.payload))
      if (
        fact === null ||
        fact.identity !== row.identity ||
        fact.identityCreatedAt !== row.identityCreatedAt
      ) {
        throw new Error('worker registration does not match its identity')
      }
      return {
        conversation: row.id,
        identity: fact.identity,
        identityCreatedAt: fact.identityCreatedAt,
        giver: fact.giver,
        number: fact.number,
      }
    })
  }

  return {
    workersBorn,
    workerGiverContains,
    workerInItsPlace,
    workerLedger,
    workerReplacementChain,
    workerQuestionTargets,
  }
}
