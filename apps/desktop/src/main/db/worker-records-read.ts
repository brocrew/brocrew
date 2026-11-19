import type { AppDatabase, AppStatement } from './connection'
import type { WorkerBorn } from '../profile-execution-file'
import { workerRegistrationOf } from '../worker-registration'
import { FOLD_TERM } from './fold-index'
import { aStoredObject, isAStoredId } from './stored-event-codec'

/** Child conversations read per page while looking for worker births. */
const WORKER_BIRTH_PAGE = 1024

export function createWorkerRecordsRead(db: AppDatabase, selectOne: AppStatement) {
  // Worker birth is always the first row of the first life, so each child is a constant index
  // probe. Children are read a page at a time, in id order, so any number of conversations is read.
  const selectWorkerBirthPage = db.prepare(
    `SELECT s.id, s.agent_identity_id AS identity, a.created_at AS identityCreatedAt,
            e.type AS type, substr(e.payload, 1, 4097) AS payload, length(e.payload) AS characters
       FROM (SELECT id, agent_identity_id FROM provider_session
             WHERE parent_session_id IS NOT NULL AND id > ? ORDER BY id LIMIT ?) AS s
       LEFT JOIN events AS e INDEXED BY events_session_ordinal_uq
         ON e.session_id = s.id AND e.generation = 0 AND e.ordinal = 0
       LEFT JOIN agent_identity AS a ON a.id = s.agent_identity_id
       ORDER BY s.id`,
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
  function workersBorn(page = WORKER_BIRTH_PAGE): readonly WorkerBorn[] {
    const rows: {
      id: string
      identity: string | null
      identityCreatedAt: number | null
      payload: string
      characters: number
    }[] = []
    for (let after = ''; ;) {
      const read = selectWorkerBirthPage.all(after, page) as {
        id: string
        identity: string | null
        identityCreatedAt: number | null
        type: string | null
        payload: string
        characters: number
      }[]
      for (const row of read) if (row.type === 'worker_registered') rows.push(row)
      if (read.length < page) break
      after = read[read.length - 1]!.id
    }
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
    workerReplacementChain,
  }
}
