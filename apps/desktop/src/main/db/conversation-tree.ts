import type { AppDatabase } from './connection'

/**
 * A conversation and the conversations below it, the helpers it started and theirs, as a delete
 * reads and removes them.
 *
 * A helper's row hangs off the row of the conversation that started it, and its pieces off its
 * giver's pieces, so a conversation's records can go only with every conversation below it: the
 * tree is what a delete removes, or nothing.
 */

/** Every conversation in `root`'s tree: `root` first, each before the ones it started. */
export function conversationTree(db: AppDatabase, root: string): string[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE tree(id, depth) AS (
         SELECT id, 0 FROM provider_session WHERE id = ?
         UNION ALL
         SELECT child.id, tree.depth + 1
           FROM provider_session AS child JOIN tree ON child.parent_session_id = tree.id
       )
       SELECT id FROM tree ORDER BY depth, id`,
    )
    .all(root) as { id: string }[]
  return rows.map(({ id }) => id)
}

/** Something outside a tree that one of its conversations is tied to, so it isn't only the tree's. */
export interface TiedOutside {
  /** The conversation in the tree. */
  readonly conversation: string
  /** The conversation outside it. */
  readonly with: string
  readonly how:
    | 'gave-it-work'
    | 'holds-work-it-gave'
    | 'wrote-to-it'
    | 'asked-it'
    | 'added-files-to-its-work'
    | 'gave-it-a-piece-below'
}

/**
 * What ties the tree to conversations outside it: work given to one of its conversations from
 * outside or by one of them to a conversation outside, words written or questions routed to a
 * helper from outside, files added to work outside, and work outside that hangs below the tree's. Words and questions sent to the root are not ties: the
 * root is what the person is deleting, and copies of what others sent it stay in their ledgers.
 */
export function whatTiesTheTreeOutside(db: AppDatabase, tree: readonly string[]): TiedOutside[] {
  const inTree = new Set(tree)
  const [root] = tree
  const ties: TiedOutside[] = []
  const add = (conversation: string, outside: string | null, how: TiedOutside['how']): void => {
    if (outside !== null && !inTree.has(outside)) ties.push({ conversation, with: outside, how })
  }
  const givers = db.prepare(
    `SELECT DISTINCT given_by_session_id AS id FROM work
      WHERE owner_session_id = ? AND given_by_session_id IS NOT NULL`,
  )
  const holders = db.prepare(
    `SELECT DISTINCT owner_session_id AS id FROM work WHERE given_by_session_id = ?`,
  )
  const writers = db.prepare(
    `SELECT DISTINCT json_extract(payload, '$.relayedFrom') AS id FROM events
      WHERE session_id = ? AND type IN ('user_turn', 'message_queued')
        AND json_valid(payload) AND json_extract(payload, '$.relayedFrom') IS NOT NULL`,
  )
  const askers = db.prepare(
    `SELECT DISTINCT session_id AS id FROM events
      WHERE type = 'request_routed' AND json_valid(payload)
        AND json_extract(payload, '$.parent') = ?`,
  )
  const filesAddedOutside = db.prepare(
    `SELECT DISTINCT work.owner_session_id AS id FROM work_resource
       JOIN work ON work.id = work_resource.work_id
      WHERE work_resource.added_by_session_id = ?`,
  )
  const piecesBelow = db.prepare(
    `SELECT DISTINCT below.owner_session_id AS id FROM work AS mine
       JOIN work AS below ON below.parent_id = mine.id
      WHERE mine.owner_session_id = ?`,
  )
  for (const conversation of tree) {
    const ids = (statement: typeof givers): (string | null)[] =>
      (statement.all(conversation) as { id: string | null }[]).map(({ id }) => id)
    for (const id of ids(givers)) add(conversation, id, 'gave-it-work')
    for (const id of ids(holders)) add(conversation, id, 'holds-work-it-gave')
    for (const id of ids(filesAddedOutside)) add(conversation, id, 'added-files-to-its-work')
    for (const id of ids(piecesBelow)) add(conversation, id, 'gave-it-a-piece-below')
    if (conversation === root) continue
    for (const id of ids(writers)) add(conversation, id, 'wrote-to-it')
    for (const id of ids(askers)) add(conversation, id, 'asked-it')
  }
  return ties
}

/** A file kept for a piece, as `resources/<sha256>/<name>` names it. */
export interface KeptFileName {
  readonly sha256: string
  readonly name: string
}

/** What deleting a tree removed beyond its rows. */
export interface TreeDeleted {
  /** Files kept for its pieces that no remaining piece names, so their bytes may go too. */
  readonly filesNoOneNames: readonly KeptFileName[]
}

/**
 * Deletes every row of the tree's conversations, in one transaction: the files kept for their
 * pieces, their pieces (each below its parent first), then the conversations (each started one
 * before the one that started it). Their ledgers, turns, archived frames and generations go with
 * their rows; an instruction one of them proposed keeps its text and names no conversation.
 */
export function deleteTheTree(db: AppDatabase, tree: readonly string[]): TreeDeleted {
  const ids = JSON.stringify(tree)
  const run = db.transaction((): TreeDeleted => {
    const kept = db
      .prepare(
        `SELECT DISTINCT sha256, name FROM work_resource
          WHERE work_id IN (SELECT id FROM work WHERE owner_session_id IN (SELECT value FROM json_each(?)))`,
      )
      .all(ids) as KeptFileName[]
    db.prepare(
      `DELETE FROM work_resource
        WHERE work_id IN (SELECT id FROM work WHERE owner_session_id IN (SELECT value FROM json_each(?)))`,
    ).run(ids)
    const leaves = db.prepare(
      `DELETE FROM work
        WHERE owner_session_id IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (SELECT 1 FROM work AS below WHERE below.parent_id = work.id)`,
    )
    while (leaves.run(ids).changes > 0) {
      // Each round removes the pieces nothing is below, until none of the tree's is left.
    }
    const left = db
      .prepare(
        `SELECT count(*) AS n FROM work WHERE owner_session_id IN (SELECT value FROM json_each(?))`,
      )
      .get(ids) as { n: number }
    if (left.n > 0) throw new Error('a piece of work outside this conversation hangs below its own')
    const conversation = db.prepare(`DELETE FROM provider_session WHERE id = ?`)
    for (const id of [...tree].reverse()) conversation.run(id)
    const named = db.prepare(`SELECT 1 FROM work_resource WHERE sha256 = ? AND name = ? LIMIT 1`)
    return {
      filesNoOneNames: kept.filter(({ sha256, name }) => named.get(sha256, name) === undefined),
    }
  })
  return run.immediate()
}

/** One of a conversation's provider sessions, and the folder it ran in. */
export interface ProviderSessionOf {
  readonly sessionId: string
  readonly cwd: string
}

/**
 * Every provider session a conversation had: the one its row names now, the one its launch minted,
 * and each one a life moved to (`session` and `conversation_reset` rows, which a clear or a new
 * plan start); and the Codex threads it started as helpers of its own (`sub_agent` rows naming a
 * thread). A provider's own files are named by these ids.
 */
export function providerSessionsOf(db: AppDatabase, conversation: string): ProviderSessionOf[] {
  const row = db
    .prepare(`SELECT external_ref, launched_as, cwd FROM provider_session WHERE id = ?`)
    .get(conversation) as
    { external_ref: string | null; launched_as: string | null; cwd: string } | undefined
  if (row === undefined) return []
  const found = new Map<string, string>()
  const add = (sessionId: unknown, cwd: unknown): void => {
    if (typeof sessionId !== 'string' || sessionId === '' || found.has(sessionId)) return
    found.set(sessionId, typeof cwd === 'string' && cwd !== '' ? cwd : row.cwd)
  }
  if (row.external_ref !== null) {
    try {
      const ref = JSON.parse(row.external_ref) as { sessionId?: unknown; cwd?: unknown }
      add(ref.sessionId, ref.cwd)
    } catch {
      // A row whose reference is not JSON names no session by it.
    }
  }
  add(row.launched_as, row.cwd)
  const lives = db
    .prepare(
      `SELECT json_extract(payload, '$.ref.sessionId') AS id, json_extract(payload, '$.ref.cwd') AS cwd
         FROM events
        WHERE session_id = ? AND type IN ('session', 'conversation_reset') AND json_valid(payload)`,
    )
    .all(conversation) as { id: unknown; cwd: unknown }[]
  for (const { id, cwd } of lives) add(id, cwd)
  const threads = db
    .prepare(
      `SELECT DISTINCT json_extract(payload, '$.agentId') AS id FROM events
        WHERE session_id = ? AND type = 'sub_agent' AND json_valid(payload)
          AND json_extract(payload, '$.idKind') = 'thread'`,
    )
    .all(conversation) as { id: unknown }[]
  for (const { id } of threads) add(id, row.cwd)
  return [...found].map(([sessionId, cwd]) => ({ sessionId, cwd }))
}
