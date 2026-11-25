import { serializeSessionRef } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { TranscriptEvent } from '../../../shared/conversation-events'
import { aNameForANewAgent } from '../../../shared/human-names'
import { pieceCalled } from '../../../shared/piece-called'
import {
  DEFAULT_PROFILE_ID,
  type IdentityCreator,
  seededProviderFor,
} from '../../../shared/runtime-ipc'
import type { ChildDescent } from '../../adopt/discover-sessions'
import { NORMALIZER_VERSION } from '../../archive/normalizer'
import { committedChangesOf } from '../committed-changes'
import type { AppDatabase, AppStatement } from '../connection'
import { currentWorkTitle } from '../current-work-title'
import {
  agentIdentityRowId,
  foldProfileName,
  identityCreatorColumn,
  ROOTS_SCOPE,
} from '../identity'
import { newWorkId } from '../ids'
import { parseChildDescent } from '../session-catalogue-read'
import { aStoredObject, boundStoredEvent } from '../stored-event-codec'
import { withWindowWriteFence } from '../window-write-fence'
import type { WorkRow } from '../work-ledger-read'
import type { SessionStore } from './session-store-contract'
import {
  type AdoptedSessionRecord,
  HELD_UNDER,
  KEPT_BEFORE,
  KEPT_FILE_COLUMNS,
  RESOURCE_COLUMNS,
  type SessionSnapshot,
  WORK_COLUMNS,
  type WorkDbRow,
} from './session-store-rows'
import { mergeDescent } from './store-helpers'
import type { createTurnReadsPart } from './turn-reads'

type FromTurnReads = Pick<ReturnType<typeof createTurnReadsPart>, 'activeGeneration' | 'appendTx'>

interface WorkStatementsPartDeps extends FromTurnReads {
  readonly db: AppDatabase
  readonly now: () => number
  readonly random: () => number
  readonly oneSnapshot: boolean
  readonly committed: ReturnType<typeof committedChangesOf>
  readonly connection: AppDatabase
}

type WorkStatementsMethods = Pick<
  SessionStore,
  | 'parentOf'
  | 'adopt'
  | 'importSnapshot'
  | 'refreshAdopted'
  | 'learnDescent'
  | 'setApprovalMode'
  | 'endPlanMode'
  | 'startPlanMode'
  | 'sourceSessionIds'
  | 'associateBundleSource'
  | 'acceptedAskHandoff'
  | 'sessionForSourceId'
  | 'findByProviderRef'
  | 'nameItsLaunch'
>

export function createWorkStatementsPart(deps: WorkStatementsPartDeps) {
  const { db, now, random, oneSnapshot, committed, connection, activeGeneration, appendTx } = deps
  let spawnStatements: {
    listIdentities: AppStatement
    identityPage: AppStatement
    countIdentities: AppStatement
    ensureIdentityRow: AppStatement
    identityNameById: AppStatement
    identityById: AppStatement
    identityBySlug: AppStatement
    namesInUse: AppStatement
    writeProvider: AppStatement
    writeDisplayName: AppStatement
    readModelChoice: AppStatement
    writeModelChoice: AppStatement
    deleteIdentity: AppStatement
    conversationsPerIdentity: AppStatement
    startedOnOf: AppStatement
    identityOfSession: AppStatement
    writeIdentityOnSession: AppStatement
    readApprovalDefault: AppStatement
    writeApprovalDefault: AppStatement
    readParent: AppStatement
    writeParent: AppStatement
    spawnedBy: AppStatement
    conversationBinding: AppStatement
  } | null = null
  const spawnSql = (): NonNullable<typeof spawnStatements> =>
    (spawnStatements ??= {
      listIdentities: db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM agent_identity ORDER BY slug`),
      identityPage: db.prepare(
        `SELECT id, slug, display_name AS displayName, created_at AS createdAt
           FROM agent_identity WHERE slug COLLATE NOCASE > ? ORDER BY slug COLLATE NOCASE LIMIT ?`,
      ),
      countIdentities: db.prepare('SELECT COUNT(*) AS count FROM agent_identity'),
      ensureIdentityRow: db.prepare(
        `INSERT OR IGNORE INTO agent_identity
           (id, slug, display_name, provider, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      namesInUse: db.prepare(`SELECT slug, display_name AS displayName FROM agent_identity`),
      identityBySlug: db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM agent_identity WHERE slug = ?`),
      identityById: db.prepare(`SELECT ${IDENTITY_COLUMNS} FROM agent_identity WHERE id = ?`),
      identityNameById: db.prepare(
        'SELECT id, slug, display_name AS displayName FROM agent_identity WHERE id = ?',
      ),
      writeProvider: db.prepare(`UPDATE agent_identity SET provider = ? WHERE id = ?`),
      writeDisplayName: db.prepare(`UPDATE agent_identity SET display_name = ? WHERE id = ?`),
      readModelChoice: db.prepare(`SELECT model_choice FROM agent_identity WHERE slug = ?`),
      writeModelChoice: db.prepare(`UPDATE agent_identity SET model_choice = ? WHERE id = ?`),

      deleteIdentity: db.prepare(`DELETE FROM agent_identity WHERE id = ?`),
      conversationsPerIdentity: db.prepare(
        `SELECT agent_identity_id AS identity, provider, count(*) AS conversations,
                count(external_ref) AS started
           FROM provider_session
          WHERE agent_identity_id IS NOT NULL
          GROUP BY agent_identity_id, provider`,
      ),
      /** One identity's started conversations on each provider, through `provider_session_identity_idx`. */
      startedOnOf: db.prepare(
        `SELECT provider, count(*) AS started FROM provider_session
          WHERE agent_identity_id = ? AND external_ref IS NOT NULL
          GROUP BY provider`,
      ),
      identityOfSession: db.prepare(
        `SELECT identity.slug AS profile_slug
           FROM provider_session s
           JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id = ?`,
      ),
      writeIdentityOnSession: db.prepare(
        `UPDATE provider_session SET agent_identity_id = ? WHERE id = ?`,
      ),
      readApprovalDefault: db.prepare(
        `SELECT default_approval_mode FROM app_policy WHERE id = 'policy'`,
      ),
      writeApprovalDefault: db.prepare(
        `UPDATE app_policy SET default_approval_mode = ? WHERE id = 'policy'`,
      ),
      readParent: db.prepare(`SELECT parent_session_id FROM provider_session WHERE id = ?`),
      spawnedBy: db.prepare(
        `SELECT s.id AS id, s.provider AS provider, identity.slug AS identity
           FROM provider_session s
           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.parent_session_id = ?
          ORDER BY s.created_at, s.id`,
      ),
      conversationBinding: db.prepare(
        `SELECT s.provider AS provider, identity.slug AS identity
           FROM provider_session s
           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id = ?`,
      ),
      writeParent: db.prepare(`UPDATE provider_session SET parent_session_id = ? WHERE id = ?`),
    })

  const IDENTITY_COLUMNS = 'id, slug, display_name, provider, created_at, created_by'

  type SaidAtCreation = {
    displayName: string | null
    provider: Provider | null
  }

  const nameForANewIdentity = (profileSlug: string): string | null => {
    const folded = foldProfileName(profileSlug)
    if (folded === DEFAULT_PROFILE_ID) return null
    if (spawnSql().identityBySlug.get(folded) !== undefined) return null
    const rows = spawnSql().namesInUse.all() as { slug: string; displayName: string | null }[]
    const taken: string[] = []
    for (const row of rows) {
      taken.push(row.slug)
      if (row.displayName !== null) taken.push(row.displayName)
    }
    return aNameForANewAgent(taken, random)
  }

  const writeIdentityRow = (
    profileSlug: string,
    at: number,
    said: SaidAtCreation,
    broughtIntoBeingBy: IdentityCreator | null,
  ): void => {
    spawnSql().ensureIdentityRow.run(
      agentIdentityRowId(profileSlug),
      foldProfileName(profileSlug),
      said.displayName,
      said.provider,
      at,
      broughtIntoBeingBy === null ? null : identityCreatorColumn(broughtIntoBeingBy),
    )
  }

  const identityRowFor = (profileSlug: string, at: number): string => {
    writeIdentityRow(
      profileSlug,
      at,
      {
        displayName: nameForANewIdentity(profileSlug),
        provider: seededProviderFor(profileSlug),
      },
      { by: 'this-app' },
    )
    return agentIdentityRowId(profileSlug)
  }
  const insertAdopted = db.prepare(
    `INSERT INTO provider_session (id, provider, external_ref, cwd, status, approval_mode, profile_id, created_at, updated_at, adopted_at, child_descent)
     VALUES (?, ?, ?, ?, 'ended', NULL, ?, ?, ?, ?, ?)`,
  )
  const touchAdopted = db.prepare(
    `UPDATE provider_session SET updated_at = ?
      WHERE id = ? AND adopted_at IS NOT NULL AND updated_at < ?`,
  )
  const markRestored = db.prepare(`UPDATE provider_session SET restored_at = ? WHERE id = ?`)
  const readAdoptedDescent = db.prepare(
    `SELECT child_descent FROM provider_session WHERE id = ? AND adopted_at IS NOT NULL`,
  )
  const writeAdoptedDescent = db.prepare(
    `UPDATE provider_session SET child_descent = ? WHERE id = ? AND adopted_at IS NOT NULL`,
  )
  const writeApprovalMode = db.prepare(
    `UPDATE provider_session SET approval_mode = ?, updated_at = ? WHERE id = ?`,
  )
  const writePlanEnded = db.prepare(
    `UPDATE provider_session SET plan_ended_at = ?, updated_at = ?
      WHERE id = ? AND plan_mode = 1 AND plan_ended_at IS NULL`,
  )
  const writePlanStarted = db.prepare(
    `UPDATE provider_session SET plan_mode = 1, plan_ended_at = NULL, updated_at = ? WHERE id = ?`,
  )
  const selectByRef = db.prepare(
    `SELECT id FROM provider_session
      WHERE provider = ? AND json_extract(external_ref, '$.sessionId') = ?`,
  )
  let launchStatements:
    | { readonly write: AppStatement; readonly select: AppStatement; readonly name: AppStatement }
    | undefined
  const launchSql = (): NonNullable<typeof launchStatements> =>
    (launchStatements ??= {
      write: db.prepare(`UPDATE provider_session SET launched_as = ? WHERE id = ?`),
      select: db.prepare(`SELECT id FROM provider_session WHERE provider = ? AND launched_as = ?`),
      name: db.prepare(
        `UPDATE provider_session SET external_ref = ?
          WHERE id = ? AND external_ref IS NULL AND launched_as = ?`,
      ),
    })
  const writeGeneration = db.prepare(
    `INSERT INTO derived_generation
       (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
     VALUES (?, 0, ?, ?, NULL, 0, NULL, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       normalizer_version = excluded.normalizer_version,
       derived_through = excluded.derived_through, building = NULL, failure = NULL,
       updated_at = excluded.updated_at`,
  )

  let workStatements: {
    bump: AppStatement
    last: AppStatement
    insert: AppStatement
    byId: AppStatement
    rootNumbered: AppStatement
    childNumbered: AppStatement
    rootOwnedBy: AppStatement
    firstOwnedBy: AppStatement
    firstNonRootOwnedBy: AppStatement
    children: AppStatement
    countChildrenAfter: AppStatement
    doneCondition: AppStatement
    newestLine: AppStatement
    turnRootLine: AppStatement
    retitlesIn: AppStatement
    conversationsOf: AppStatement
    recentGivenFrom: AppStatement
    newestHeldIn: AppStatement
    heldInCount: AppStatement
    insertResource: AppStatement
    resourcesOf: AppStatement
    countResourcesAfter: AppStatement
    filesOnPiece: AppStatement
    filesAddedBy: AppStatement
    filesUnder: AppStatement
    madeBy: AppStatement
    madeByCount: AppStatement
    newestKeptAnywhere: AppStatement
    keptAnywhereCount: AppStatement
    newestKeptUnder: AppStatement
    keptUnderCount: AppStatement
    resourceById: AppStatement
    untitledResources: AppStatement
    titleResource: AppStatement
    titledResources: AppStatement
    retitleResource: AppStatement
  } | null = null
  const workSql = (): NonNullable<typeof workStatements> =>
    (workStatements ??= {
      bump: db.prepare(
        `INSERT INTO work_sequence (scope, last) VALUES (?, 1)
           ON CONFLICT(scope) DO UPDATE SET last = last + 1`,
      ),
      last: db.prepare(`SELECT last FROM work_sequence WHERE scope = ?`),
      insert: db.prepare(
        `INSERT INTO work
           (id, parent_id, number, owner_session_id, given_by_session_id, title, brief, folder,
            created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      byId: db.prepare(`SELECT ${WORK_COLUMNS} FROM work WHERE id = ?`),
      rootNumbered: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id IS NULL AND number = ?`,
      ),
      childNumbered: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id = ? AND number = ?`,
      ),
      rootOwnedBy: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work WHERE parent_id IS NULL AND owner_session_id = ?`,
      ),
      // ⚑ Stored order is the row's insertion order (rowid), read in the owner index's own order.
      firstOwnedBy: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work INDEXED BY work_owner_idx
          WHERE owner_session_id = ? ORDER BY rowid LIMIT 1`,
      ),
      firstNonRootOwnedBy: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work INDEXED BY work_owner_idx
          WHERE owner_session_id = ? AND parent_id IS NOT NULL ORDER BY rowid LIMIT 1`,
      ),
      children: db.prepare(
        `SELECT ${WORK_COLUMNS} FROM work
          WHERE parent_id = ? AND number > ? ORDER BY number LIMIT ?`,
      ),
      countChildrenAfter: db.prepare(
        `SELECT count(*) AS total FROM work WHERE parent_id = ? AND number > ?`,
      ),
      doneCondition: db.prepare(
        `SELECT payload FROM events
          WHERE session_id = ? AND +generation = ?
            AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                         'work_status_set', 'work_rebriefed', 'work_closed')
            AND type = 'work_rebriefed'
            AND CASE WHEN json_valid(payload) THEN
              CASE WHEN json_type(payload, '$.piece') = 'text' THEN
                json_extract(payload, '$.piece') = ? AND json_type(payload, '$.definitionOfDone') IS NOT NULL
              ELSE 1 END ELSE 1 END
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      newestLine: db.prepare(
        `SELECT payload, created_at, ordinal FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type = ?
            AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?
          ORDER BY ordinal DESC
          LIMIT 1`,
      ),
      // A malformed newest row could name this root; never skip it to claim absence.
      turnRootLine: db.prepare(
        `SELECT payload, created_at, ordinal FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type = ?
            AND CASE WHEN json_valid(payload)
              THEN CASE WHEN json_type(payload, '$.piece') = 'text'
                THEN json_extract(payload, '$.piece') = ? ELSE 1 END
              ELSE 1 END
          ORDER BY ordinal DESC LIMIT 1`,
      ),
      retitlesIn: db.prepare(
        `SELECT payload FROM events INDEXED BY events_kind_owner_idx
          WHERE session_id = ? AND generation = ?
            AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                         'work_status_set', 'work_rebriefed', 'work_closed')
            AND type = 'work_retitled'
          ORDER BY ordinal DESC`,
      ),
      conversationsOf: db.prepare(
        `SELECT id, parent_session_id, created_at, updated_at FROM provider_session
          WHERE agent_identity_id = ?
          ORDER BY updated_at DESC, id DESC`,
      ),
      recentGivenFrom: db.prepare(
        `SELECT s.id,
                (SELECT w.title FROM work AS w INDEXED BY work_owner_idx
                  WHERE w.owner_session_id = s.id AND w.parent_id IS NOT NULL
                  ORDER BY w.created_at DESC, w.id DESC LIMIT 1) AS title
           FROM provider_session AS s
          WHERE s.agent_identity_id = @recipient
            AND EXISTS (
              SELECT 1 FROM work AS w INDEXED BY work_owner_idx
                JOIN provider_session AS g ON g.id = w.given_by_session_id
               WHERE w.owner_session_id = s.id
                 AND (g.id = @giver OR g.agent_identity_id =
                      (SELECT agent_identity_id FROM provider_session WHERE id = @giver)))
          ORDER BY s.updated_at DESC, s.id DESC
          LIMIT @limit`,
      ),
      newestHeldIn: db.prepare(
        `SELECT id, owner_session_id FROM work
          WHERE owner_session_id IN (SELECT value FROM json_each(?))
            AND parent_id IS NOT NULL
          ORDER BY created_at DESC, id DESC LIMIT ?`,
      ),
      heldInCount: db.prepare(
        `SELECT count(*) AS total FROM work
          WHERE owner_session_id IN (SELECT value FROM json_each(?))
            AND parent_id IS NOT NULL`,
      ),
      insertResource: db.prepare(
        `INSERT INTO work_resource
           (id, work_id, role, title, summary, name, sha256, bytes, added_by_session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      resourcesOf: db.prepare(
        `SELECT ${RESOURCE_COLUMNS} FROM work_resource
          WHERE work_id = @piece AND (@at IS NULL OR (created_at, id) > (@at, @id))
          ORDER BY created_at, id LIMIT @limit`,
      ),
      countResourcesAfter: db.prepare(
        `SELECT count(*) AS total FROM work_resource
          WHERE work_id = @piece AND (@at IS NULL OR (created_at, id) > (@at, @id))`,
      ),
      filesOnPiece: db.prepare(`SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE work_id = ?`),
      filesAddedBy: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE added_by_session_id = ?`,
      ),
      filesUnder: db.prepare(
        `${HELD_UNDER}
         SELECT ${KEPT_FILE_COLUMNS} FROM work_resource WHERE work_id IN (SELECT id FROM held)`,
      ),
      madeBy: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource
          WHERE role = 'made'
            AND work_id IN (SELECT w.id FROM work w
                              JOIN provider_session s ON s.id = w.owner_session_id
                             WHERE s.agent_identity_id = ?)
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      ),
      madeByCount: db.prepare(
        `SELECT count(*) AS total FROM work_resource
          WHERE role = 'made'
            AND work_id IN (SELECT w.id FROM work w
                              JOIN provider_session s ON s.id = w.owner_session_id
                             WHERE s.agent_identity_id = ?)`,
      ),
      newestKeptAnywhere: db.prepare(
        `SELECT ${KEPT_FILE_COLUMNS} FROM work_resource
          WHERE ${KEPT_BEFORE}
          ORDER BY rowid DESC
          LIMIT @limit`,
      ),
      keptAnywhereCount: db.prepare(
        `SELECT count(*) AS total FROM (SELECT 1 FROM work_resource WHERE ${KEPT_BEFORE} LIMIT @cap)`,
      ),
      newestKeptUnder: db.prepare(
        `${HELD_UNDER}
         SELECT ${KEPT_FILE_COLUMNS} FROM work_resource INDEXED BY work_resource_work_idx
          WHERE work_id IN (SELECT id FROM held) AND ${KEPT_BEFORE}
          ORDER BY rowid DESC
          LIMIT @limit`,
      ),
      keptUnderCount: db.prepare(
        `${HELD_UNDER}
         SELECT count(*) AS total FROM (
           SELECT 1 FROM work_resource INDEXED BY work_resource_work_idx
            WHERE work_id IN (SELECT id FROM held) AND ${KEPT_BEFORE}
            LIMIT @cap)`,
      ),
      resourceById: db.prepare(`SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE id = ?`),
      untitledResources: db.prepare(
        `SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE title IS NULL ORDER BY rowid LIMIT ?`,
      ),
      titleResource: db.prepare(
        `UPDATE work_resource SET title = ? WHERE id = ? AND title IS NULL`,
      ),
      titledResources: db.prepare(
        `SELECT rowid AS at, ${RESOURCE_COLUMNS} FROM work_resource
          WHERE title IS NOT NULL AND rowid > @after
            AND (title = name OR created_at < @keptBefore)
          ORDER BY rowid LIMIT @limit`,
      ),
      retitleResource: db.prepare(
        `UPDATE work_resource SET title = @title
          WHERE id = @id AND title = @was AND @title <> @was`,
      ),
    })

  const bumpSequence = (scope: string): number => {
    workSql().bump.run(scope)
    return (workSql().last.get(scope) as { last: number }).last
  }

  const openRoot = (owner: string, at: number, title: string | null = null): void => {
    workSql().insert.run(
      newWorkId(),
      null,
      bumpSequence(ROOTS_SCOPE),
      owner,
      null,
      title,
      null,
      null,
      at,
    )
  }

  // One snapshot's work rows never change, so a window read walks each chain once.
  const chainsWalked = oneSnapshot ? new Map<string, readonly WorkDbRow[]>() : undefined
  // …and names each piece a conversation holds once, however many pieces below it ask.
  const namesRead = oneSnapshot
    ? new Map<string, { readonly label: string; readonly title: string | null }>()
    : undefined
  const chainUp = (row: WorkDbRow): readonly WorkDbRow[] => {
    const walked = chainsWalked?.get(row.id)
    if (walked !== undefined) return walked
    const chain = [row]
    const seen = new Set([row.id])
    let parent = row.parent_id
    while (parent !== null) {
      // A parent walked before ended in a root, so the rows above it are its chain.
      const above = chainsWalked?.get(parent)
      if (above !== undefined) {
        chain.push(...above)
        break
      }
      if (seen.has(parent)) throw new Error(`the pieces above ${row.id} do not end in a root`)
      seen.add(parent)
      const up = workSql().byId.get(parent) as WorkDbRow | undefined
      if (up === undefined) throw new Error(`piece ${row.id} names a parent this database lacks`)
      chain.push(up)
      parent = up.parent_id
    }
    chainsWalked?.set(row.id, chain)
    return chain
  }

  const workRowFrom = (row: WorkDbRow, numbers: readonly number[]): WorkRow => ({
    piece: row.id,
    parent: row.parent_id,
    number: row.number,
    label: pieceCalled(numbers),
    owner: row.owner_session_id,
    givenBy: row.given_by_session_id,
    title: row.title,
    brief: row.brief,
    folder: row.folder,
    createdAt: row.created_at,
  })

  const workRowWalked = (row: WorkDbRow): WorkRow =>
    workRowFrom(
      row,
      [...chainUp(row)].reverse().map((each) => each.number),
    )

  const newestLineAbout = (
    piece: WorkDbRow,
    generation: number,
    type: 'work_retitled' | 'work_status_set',
  ): Record<string, unknown> | null => {
    const found = workSql().newestLine.get(piece.owner_session_id, generation, type, piece.id) as
      { payload: string; created_at: number; ordinal: number } | undefined
    if (found === undefined) return null
    const stored = aStoredObject(found.payload)
    return stored === null ? null : { ...stored, at: found.created_at, revision: found.ordinal }
  }

  const titleNow = (
    piece: WorkDbRow,
    generation: number,
    newestRetitle: (piece: WorkDbRow, generation: number) => Record<string, unknown> | null = (
      one,
      itsGeneration,
    ) => newestLineAbout(one, itsGeneration, 'work_retitled'),
  ): string | null => {
    return currentWorkTitle(piece.title, newestRetitle(piece, generation))
  }

  const retitlesOf = (
    owner: string,
    generation: number,
  ): ReadonlyMap<string, Record<string, unknown>> => {
    const newest = new Map<string, Record<string, unknown>>()
    for (const row of workSql().retitlesIn.all(owner, generation) as { payload: string }[]) {
      const stored = aStoredObject(row.payload)
      const piece = stored?.piece
      if (stored === null || typeof piece !== 'string' || newest.has(piece)) continue
      newest.set(piece, stored)
    }
    return newest
  }

  const insertAdoptedRow = (record: AdoptedSessionRecord, at: number): void => {
    const ref = serializeSessionRef({
      provider: record.provider,
      sessionId: record.sessionId,
      cwd: record.cwd,
      rotation: record.rotation ?? 0,
    })
    const identityId = record.profileId === null ? null : identityRowFor(record.profileId, at)
    insertAdopted.run(
      record.id,
      record.provider,
      ref,
      record.cwd,
      record.profileId,
      record.createdAt,
      record.updatedAt,
      at,
      record.child ? JSON.stringify(record.child) : null,
    )
    if (identityId !== null) spawnSql().writeIdentityOnSession.run(identityId, record.id)
    openRoot(record.id, at)
  }

  const selectSourceSessionIds = db.prepare(
    'SELECT source_session_ids AS aliases FROM provider_session WHERE id = ?',
  )
  const writeSourceSessionIds = db.prepare(
    'UPDATE provider_session SET source_session_ids = ? WHERE id = ?',
  )
  const selectSessionForSourceId = db.prepare(
    `SELECT id FROM provider_session
      WHERE id = ? OR EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(source_session_ids)
          THEN source_session_ids ELSE '[]' END) WHERE value = ?
      ) LIMIT 2`,
  )
  const selectAcceptedAskHandoff = db.prepare(
    `SELECT ordinal, created_at, payload FROM events INDEXED BY events_kind_owner_idx
      WHERE session_id = ? AND generation = ? AND type = 'user_turn' AND ordinal > ?
        AND json_extract(CASE WHEN json_valid(payload) THEN payload END, '$.askHandoffAttempt') = ?
      ORDER BY ordinal LIMIT 1`,
  )
  const selectSourceEvidence = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN payload END AS payload FROM events
      WHERE session_id = ? AND generation = ? AND ordinal = ? AND type = ?`,
  )
  function sourceSessionIds(sessionId: string): readonly string[] {
    const row = selectSourceSessionIds.get(sessionId) as { aliases: string | null } | undefined
    if (row?.aliases == null) return []
    try {
      const values: unknown = JSON.parse(row.aliases)
      return Array.isArray(values)
        ? values.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : []
    } catch {
      return []
    }
  }

  function keepSourceSessionIds(sessionId: string, incoming: readonly string[]): void {
    const current = sourceSessionIds(sessionId)
    const aliases = [...new Set([...current, ...incoming])].filter((id) => id !== sessionId).sort()
    if (aliases.length > 0 && JSON.stringify(aliases) !== JSON.stringify(current))
      writeSourceSessionIds.run(JSON.stringify(aliases), sessionId)
  }

  // A native reference nominates a row. A matching stamped origin proves only its own address.
  function bundleSourceEvidence(event: TranscriptEvent): string | undefined {
    if (event.type === 'request_routed') return event.originalOpening
    if (event.type === 'user_turn') return event.askHandoffAttempt
    if (event.type === 'ask_handoff_attempted') return event.attempt
    return undefined
  }

  function sourceOfBundleEvidence(evidence: string): string | undefined {
    try {
      const locator: unknown = JSON.parse(evidence)
      return Array.isArray(locator) &&
        locator.length === 3 &&
        typeof locator[0] === 'string' &&
        Number.isSafeInteger(locator[1]) &&
        Number.isSafeInteger(locator[2])
        ? locator[0]
        : undefined
    } catch {
      return undefined
    }
  }

  const associateBundleSource = db.transaction(
    (sessionId: string, sourceIds: readonly string[], ledger: SessionSnapshot['ledger']): void => {
      const known = new Set([sessionId, ...sourceSessionIds(sessionId)])
      const wanted = new Set(sourceIds.filter((id) => !known.has(id)))
      if (wanted.size === 0) return
      const generation = activeGeneration(sessionId)
      const verified: string[] = []
      for (const { ordinal, event } of ledger) {
        const evidence = bundleSourceEvidence(event)
        if (evidence === undefined) continue
        const source = sourceOfBundleEvidence(evidence)
        if (source === undefined || !wanted.has(source)) continue
        const row = selectSourceEvidence.get(sessionId, generation, ordinal, event.type) as
          { payload: string | null } | undefined
        if (row?.payload == null) continue
        if (bundleSourceEvidence(JSON.parse(row.payload) as TranscriptEvent) !== evidence) continue
        wanted.delete(source)
        verified.push(source)
        if (wanted.size === 0) break
      }
      if (verified.length > 0) keepSourceSessionIds(sessionId, verified)
    },
  )

  const importSnapshotTx = db.transaction((snapshot: SessionSnapshot) =>
    committed.asAWhole(() => importSnapshotRows(snapshot)),
  )
  const importSnapshotRows = (snapshot: SessionSnapshot): void => {
    committed.whole(snapshot.session.id, 'imported')
    const at = now()
    insertAdoptedRow(snapshot.session, at)
    markRestored.run(at, snapshot.session.id)
    if (snapshot.sourceSessionId !== undefined)
      keepSourceSessionIds(snapshot.session.id, [snapshot.sourceSessionId])
    for (const entry of snapshot.ledger) {
      appendTx(snapshot.session.id, entry.ordinal, entry.event, entry.at, 0, true)
    }
    if (snapshot.sourceSessionIds !== undefined)
      associateBundleSource(snapshot.session.id, snapshot.sourceSessionIds, snapshot.ledger)
    writeGeneration.run(snapshot.session.id, NORMALIZER_VERSION, snapshot.derivedThrough, at)
  }

  const learnDescentTx = db.transaction((sessionId: string, child: ChildDescent | undefined) => {
    if (!child) return false
    const row = readAdoptedDescent.get(sessionId) as { child_descent: string | null } | undefined
    if (row === undefined) return false
    const merged = mergeDescent(parseChildDescent(row.child_descent), child)
    const next = merged === null ? null : JSON.stringify(merged)
    if (next === row.child_descent) return false
    writeAdoptedDescent.run(next, sessionId)
    return true
  })

  const refreshAdoptedTx = db.transaction(
    (sessionId: string, updatedAt: number, child: ChildDescent | undefined) => {
      touchAdopted.run(updatedAt, sessionId, updatedAt)
      return learnDescentTx(sessionId, child)
    },
  )

  const adoptTx = db.transaction((record: AdoptedSessionRecord, at: number) => {
    insertAdoptedRow(record, at)
  })

  const methods: WorkStatementsMethods & ThisType<SessionStore> = {
    parentOf(sessionId) {
      const row = spawnSql().readParent.get(sessionId) as
        { parent_session_id: string | null } | undefined
      return row?.parent_session_id ?? null
    },

    adopt(record) {
      adoptTx(record, now())
    },

    importSnapshot(snapshot) {
      withWindowWriteFence(connection, () => importSnapshotTx(snapshot))
    },

    refreshAdopted(sessionId, updatedAt, child) {
      return refreshAdoptedTx(sessionId, updatedAt, child)
    },

    learnDescent(sessionId, child) {
      return learnDescentTx(sessionId, child)
    },

    setApprovalMode(sessionId, mode) {
      writeApprovalMode.run(mode, now(), sessionId)
    },

    endPlanMode(sessionId, at) {
      writePlanEnded.run(at, at, sessionId)
    },
    startPlanMode(sessionId, at) {
      writePlanStarted.run(at, sessionId)
    },
    sourceSessionIds,

    associateBundleSource(sessionId, sourceIds, ledger) {
      associateBundleSource(sessionId, sourceIds, ledger)
    },

    acceptedAskHandoff(sessionId, generation, afterOrdinal, attempt) {
      const row = selectAcceptedAskHandoff.get(sessionId, generation, afterOrdinal, attempt) as
        { ordinal: number; created_at: number; payload: string } | undefined
      if (row === undefined) return null
      return {
        ordinal: row.ordinal,
        at: row.created_at,
        event: boundStoredEvent(JSON.parse(row.payload) as TranscriptEvent),
      }
    },

    sessionForSourceId(sourceId) {
      const rows = selectSessionForSourceId.all(sourceId, sourceId) as { id: string }[]
      return rows.length === 1 ? (rows[0]?.id ?? null) : null
    },

    findByProviderRef(provider, sessionId) {
      const row = selectByRef.get(provider, sessionId) as { id: string } | undefined
      if (row) return row.id
      const launched = launchSql().select.get(provider, sessionId) as { id: string } | undefined
      return launched?.id ?? null
    },

    nameItsLaunch(sessionId, ref) {
      return launchSql().name.run(serializeSessionRef(ref), sessionId, ref.sessionId).changes > 0
    },
  }
  return {
    methods,
    spawnSql,
    nameForANewIdentity,
    writeIdentityRow,
    identityRowFor,
    launchSql,
    workSql,
    bumpSequence,
    openRoot,
    namesRead,
    chainUp,
    workRowFrom,
    workRowWalked,
    newestLineAbout,
    titleNow,
    retitlesOf,
  }
}
