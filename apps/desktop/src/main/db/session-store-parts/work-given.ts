import type { Provider, SessionStatus } from '@brobot2/shared'
import { formOfName, type ResourceRole } from '../../../shared/documents'
import { pieceCalled } from '../../../shared/piece-called'
import type { LedgerWalk } from '../../../shared/question-contracts'
import type { PieceRow } from '../../../shared/task-contracts'
import { composeWhatEachPieceIsWaitingOn, workGivenOut } from '../../../shared/tasks'
import { workEdge } from '../../../shared/who-called-whom'
import { workFileGroup } from '../../../shared/work-file-groups'
import { committedChangesOf } from '../committed-changes'
import type { AppDatabase } from '../connection'
import {
  conversationTree,
  deleteTheTree,
  providerSessionsOf,
  whatTiesTheTreeOutside,
} from '../conversation-tree'
import { createDigestWindowRead } from '../digest-window-read'
import { FOLD_TERM } from '../fold-index'
import { forestListing } from '../forest-listing'
import type { ForestedNode } from '../forest-store'
import { agentIdentityRowId } from '../identity'
import { newResourceId } from '../ids'
import { ledgerWritesFor } from '../ledger-write-stamp'
import { rowsUnreadOnce } from '../rows-unread'
import type { SessionStore } from './session-store-contract'
import {
  type BindingRow,
  type ForestSessionRow,
  type GivenWorkRow,
  inLabelOrder,
  type KeptFileDbRow,
  type KeptFileRow,
  type KeptFilesAsked,
  MAX_SCHEDULE_EVIDENCE_ROWS,
  MAX_SCHEDULE_HISTORY_WALKED,
  type ResourceDbRow,
  type ResourceRow,
  type ScheduleEvidenceRow,
  type SpawnedSessionRow,
  type WorkDbRow,
} from './session-store-rows'
import {
  ledgersSkippedOf,
  noSuchConversation,
  pieceStallOrdinals,
  scheduleLevelFromRow,
  underWhat,
  walkLedgers,
} from './store-helpers'
import type { createTurnReadsPart } from './turn-reads'
import type { createWorkStatementsPart } from './work-statements'
import type { createAgentIdentitiesPart } from './agent-identities'
import type { createPieceFoldsPart } from './piece-folds'

type FromTurnReads = Pick<
  ReturnType<typeof createTurnReadsPart>,
  'activeGeneration' | 'forgetTheKeptFoldsOf' | 'selectMaxOrdinal' | 'sessionCatalogueRead'
>

type FromWorkStatements = Pick<
  ReturnType<typeof createWorkStatementsPart>,
  'chainUp' | 'retitlesOf' | 'spawnSql' | 'titleNow' | 'workSql'
>

type FromAgentIdentities = Pick<
  ReturnType<typeof createAgentIdentitiesPart>,
  'workerReplacementChain'
>

type FromPieceFolds = Pick<
  ReturnType<typeof createPieceFoldsPart>,
  | 'oneWaitReadPerHolder'
  | 'piecesGivenBySession'
  | 'piecesOfSession'
  | 'selectOwnersGivenWorkBy'
  | 'stallsToldToSession'
>

interface WorkGivenPartDeps
  extends FromTurnReads, FromWorkStatements, FromAgentIdentities, FromPieceFolds {
  readonly db: AppDatabase
  readonly oneSnapshot: boolean
  readonly committed: ReturnType<typeof committedChangesOf>
  readonly ledgerWrites: ReturnType<typeof ledgerWritesFor>
}

type WorkGivenMethods = Pick<
  SessionStore,
  | 'addResource'
  | 'resourcesOf'
  | 'countResourcesAfter'
  | 'filesKept'
  | 'filesKeptTogether'
  | 'keptFilesNewestFirst'
  | 'keptFilesBefore'
  | 'madeBy'
  | 'resource'
  | 'untitledResources'
  | 'titleResource'
  | 'titledResources'
  | 'retitleResource'
  | 'activityWindow'
  | 'digestWindow'
  | 'conversationsHeldByNoAgent'
  | 'forestListing'
  | 'forestNodesOf'
  | 'workReportedTo'
  | 'legacyOrdinaryStallWasReported'
  | 'workGivenOutBy'
  | 'workThisOneGaveOut'
  | 'workThisOneWasGiven'
  | 'conversationTree'
  | 'whatTiesTheTreeOutside'
  | 'providerSessionsOf'
  | 'deleteTheTree'
  | 'spawnedBy'
  | 'conversationBinding'
  | 'piecesGivenBy'
  | 'newestScheduleLevels'
  | 'newestScheduleLevel'
  | 'lastStatusAt'
  | 'scheduleEvidenceRows'
  | 'recordedOne'
>

export function createWorkGivenPart(deps: WorkGivenPartDeps) {
  const {
    db,
    oneSnapshot,
    committed,
    ledgerWrites,
    activeGeneration,
    chainUp,
    forgetTheKeptFoldsOf,
    oneWaitReadPerHolder,
    piecesGivenBySession,
    piecesOfSession,
    retitlesOf,
    selectMaxOrdinal,
    selectOwnersGivenWorkBy,
    sessionCatalogueRead,
    spawnSql,
    stallsToldToSession,
    titleNow,
    workerReplacementChain,
    workSql,
  } = deps
  const scheduleLevelsSql = (owners: string) =>
    `WITH levels AS MATERIALIZED (
       SELECT session_id, created_at, generation, ordinal, payload
         FROM events INDEXED BY events_kind_owner_idx
        WHERE ${FOLD_TERM} AND type = 'scheduled_work'
          AND ${owners}
          AND CASE WHEN json_valid(payload) THEN json_type(payload, '$.jobs') = 'array' ELSE 1 END
     ), candidates AS MATERIALIZED (
       SELECT session_id, payload FROM (
         SELECT session_id, payload, row_number() OVER (
                  PARTITION BY session_id ORDER BY created_at DESC, generation DESC, ordinal DESC
                ) AS nth
           FROM levels
       ) WHERE nth = 1
           AND CASE WHEN json_valid(payload)
                    THEN json_array_length(payload, '$.jobs') > 0
                         OR coalesce(json_extract(payload, '$.dropped'), 0) > 0
                    ELSE 1 END
     ), firsts AS MATERIALIZED (
       SELECT l.session_id, json_extract(job.value, '$.id') AS id, min(l.created_at) AS at
         FROM levels l JOIN candidates n ON n.session_id = l.session_id,
              json_each(CASE WHEN json_valid(l.payload) THEN l.payload ELSE '{}' END, '$.jobs') job
        WHERE json_type(job.value, '$.id') = 'text'
        GROUP BY 1, 2
     )
     SELECT n.session_id, n.payload,
            (SELECT json_group_object(f.id, f.at) FROM firsts f
              WHERE f.session_id = n.session_id) AS first_listed,
            (SELECT max(e.created_at) FROM events e INDEXED BY events_session_idx
              WHERE e.session_id = n.session_id AND e.type = 'compaction') AS compacted_at
       FROM candidates n`
  const selectNewestScheduleLevels = db.prepare(
    scheduleLevelsSql('(? IS NULL OR session_id IN (SELECT value FROM json_each(?)))'),
  )
  const selectNewestScheduleLevel = db.prepare(scheduleLevelsSql('session_id = ?'))
  // The newest status row of a conversation's newest generation: one walk back down the index.
  const selectLastStatusAt = db.prepare(
    `SELECT created_at AS at FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND type = 'status'
      ORDER BY generation DESC, ordinal DESC LIMIT 1`,
  )
  const selectScheduleEvidenceRows = db.prepare(
    `WITH walk AS MATERIALIZED (
       SELECT ordinal, created_at, type, payload, generation
         FROM events INDEXED BY events_fold_idx
        WHERE ${FOLD_TERM} AND session_id = ?
        ORDER BY generation DESC, ordinal DESC
        LIMIT ?)
     SELECT ordinal, created_at, type, payload, generation, NULL AS walked FROM (
       SELECT ordinal, created_at, type, payload, generation,
              row_number() OVER (PARTITION BY kind
                                 ORDER BY created_at DESC, generation DESC,
                                          ordinal DESC) AS newest
         FROM (SELECT ordinal, created_at, type, payload, generation,
                      CASE WHEN type = 'launched' THEN 'life'
                           WHEN NOT json_valid(payload) THEN NULL
                           WHEN type = 'scheduled_work' AND json_extract(payload, '$.reset') = 1
                             THEN 'life'
                           WHEN type = 'status'
                             THEN CASE WHEN json_extract(payload, '$.state') IN ('ended', 'errored')
                                       THEN 'life' END
                           WHEN json_extract(payload, '$.receipt.tool') IN ('CronCreate', 'CronDelete')
                             THEN 'receipt'
                           WHEN json_type(payload, '$.receipt') IS NOT NULL THEN NULL
                           WHEN json_extract(payload, '$.source') LIKE 'app/%'
                             OR json_extract(payload, '$.source') LIKE 'this app%' THEN NULL
                           ELSE 'level' END AS kind
                 FROM walk
                WHERE type IN ('scheduled_work', 'launched', 'status'))
        WHERE kind IS NOT NULL)
      WHERE newest <= ?
     UNION ALL
     SELECT NULL, NULL, NULL, NULL, NULL, count(*) FROM walk
     ORDER BY created_at, ordinal, generation DESC`,
  )
  const selectPlacedConversationsAmong = db.prepare(
    `SELECT provider_session.id AS id, identity.slug AS profile_slug,
            provider_session.provider AS provider, provider_session.status AS status,
            provider_session.created_at AS created_at,
            provider_session.updated_at AS updated_at,
            provider_session.parent_session_id AS parent_session_id
       FROM json_each(@ids) asked
       JOIN provider_session ON provider_session.id = asked.value
       JOIN agent_identity identity ON identity.id = provider_session.agent_identity_id
      WHERE provider_session.id NOT IN (SELECT value FROM json_each(@hidden))
      ORDER BY asked.key`,
  )

  /** Each placed conversation's node with the pieces it holds; parents and givers named against `drawn`. */
  function forestNodesAmong(
    placed: readonly ForestSessionRow[],
    drawn: ReadonlySet<string>,
  ): LedgerWalk<ForestedNode> {
    const unread = rowsUnreadOnce()
    const waiting = oneWaitReadPerHolder(unread)
    const identityOfGiver = identitiesOnce()
    return walkLedgers(
      'every-conversation-this-app-placed',
      placed,
      (sessionId, noteSkip, row) => {
        return [
          {
            node: 'a-conversation',
            conversation: row.id,
            under: underWhat(row.parent_session_id, drawn),
            identity: row.profile_slug,
            provider: row.provider as Provider,
            status: row.status as SessionStatus,
            startedAt: row.created_at,
            updatedAt: row.updated_at,
          },
          ...composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).map(
            (piece) => ({
              node: 'a-task' as const,
              under: { is: 'a-conversation' as const, conversation: row.id },
              givenBy: underWhat(piece.giver, drawn),
              work: workEdge(piece, row.profile_slug, identityOfGiver(piece.giver)),
            }),
          ),
        ]
      },
      unread,
    )
  }

  function digestThroughOrdinal(id: string, generation: number): number {
    return (
      (selectMaxOrdinal.get(id, generation) as { max_ordinal: number | null } | undefined)
        ?.max_ordinal ?? -1
    )
  }
  const digestRead = createDigestWindowRead(db, activeGeneration, digestThroughOrdinal)
  const countConversationsHeldByNoAgent = db.prepare(
    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NULL`,
  )
  const selectLegacyStallCut = db.prepare(
    'SELECT generation, through_ordinal FROM work_legacy_stall_cut WHERE session_id = ?',
  )
  function walkWorkGivenBy<Row extends { readonly givenAt: number; readonly piece: string }>(
    sessionId: string,
    map: (piece: PieceRow, candidate: GivenWorkRow) => Row,
  ): LedgerWalk<Row> {
    const unread = rowsUnreadOnce()
    const owners = selectOwnersGivenWorkBy.all(sessionId) as GivenWorkRow[]
    const waiting = oneWaitReadPerHolder(unread)
    const walked = walkLedgers(
      'every-conversation-this-one-gave-work-to',
      owners,
      (owner, noteSkip, candidate) =>
        composeWhatEachPieceIsWaitingOn(
          [...piecesOfSession(owner, noteSkip)].filter((piece) => piece.giver === sessionId),
          waiting,
        ).map((piece) => map(piece, candidate)),
      unread,
    )
    return {
      walk: walked.walk,
      ledgers: walked.ledgers,
      rowsUnread: walked.rowsUnread,
      ...ledgersSkippedOf(walked.ledgersSkipped),
      rows: [...walked.rows].sort(
        (left, right) => left.givenAt - right.givenAt || (left.piece < right.piece ? -1 : 1),
      ),
    }
  }

  const identitiesOnce = (): ((sessionId: string | null) => string | null) => {
    const known = new Map<string, string | null>()
    return (sessionId) => {
      if (sessionId === null) return null
      if (known.has(sessionId)) return known.get(sessionId) ?? null
      const row = spawnSql().identityOfSession.get(sessionId) as
        { profile_slug: string } | undefined
      const identity = row?.profile_slug ?? null
      known.set(sessionId, identity)
      return identity
    }
  }

  const resourceFrom = (row: ResourceDbRow): ResourceRow => ({
    resource: row.id,
    piece: row.work_id,
    role: row.role as ResourceRole,
    title: row.title,
    summary: row.summary,
    name: row.name,
    sha256: row.sha256,
    bytes: row.bytes,
    addedBy: row.added_by_session_id,
    createdAt: row.created_at,
  })

  const treeOf = (
    asked: Extract<KeptFilesAsked, { readonly scope: 'tree' }>,
  ): { readonly holder: string; readonly givers: string } => ({
    holder: asked.holder,
    givers: JSON.stringify(asked.givers),
  })

  const onTheirPieces = (
    rows: readonly KeptFileDbRow[],
  ): readonly { readonly file: KeptFileRow; readonly numbers: readonly number[] }[] => {
    type Named = {
      readonly numbers: readonly number[]
      readonly title: string | null
      readonly returned: ReadonlySet<string> | null
      readonly mainResult: string | null
    } | null
    const pieces = new Map<string, Named>()
    const replies = new Map<string, ReadonlyMap<string, PieceRow> | null>()
    const generations = new Map<string, number>()
    const retitles = new Map<string, ReadonlyMap<string, Record<string, unknown>>>()
    const newestRetitle = (
      piece: WorkDbRow,
      generation: number,
    ): Record<string, unknown> | null => {
      let owners = retitles.get(piece.owner_session_id)
      if (owners === undefined) {
        owners = retitlesOf(piece.owner_session_id, generation)
        retitles.set(piece.owner_session_id, owners)
      }
      return owners.get(piece.id) ?? null
    }
    const named = (id: string): Named => {
      const known = pieces.get(id)
      if (known !== undefined) return known
      const row = workSql().byId.get(id) as WorkDbRow | undefined
      let found: Named = null
      if (row !== undefined) {
        let generation = generations.get(row.owner_session_id)
        if (generation === undefined) {
          generation = activeGeneration(row.owner_session_id)
          generations.set(row.owner_session_id, generation)
        }
        let owned = replies.get(row.owner_session_id)
        if (owned === undefined) {
          let unread = false
          const folded = piecesOfSession(row.owner_session_id, () => {
            unread = true
          })
          owned = unread ? null : new Map(folded.map((piece) => [piece.piece, piece]))
          replies.set(row.owner_session_id, owned)
        }
        const returned =
          row.parent_id === null
            ? new Set<string>()
            : owned === null || !owned.has(row.id)
              ? null
              : new Set(owned.get(row.id)!.resources)
        const documents =
          returned === null
            ? []
            : [...returned].filter((id) => {
                const resource = workSql().resourceById.get(id) as ResourceDbRow | undefined
                if (resource?.work_id !== row.id || resource.role !== 'made') return false
                const form = formOfName(resource.name)
                return form === 'markdown' || form === 'page'
              })
        found = {
          numbers: [...chainUp(row)].reverse().map((each) => each.number),
          title: titleNow(row, generation, newestRetitle),
          returned,
          mainResult: documents.includes(owned?.get(row.id)?.resultDocument ?? '')
            ? owned!.get(row.id)!.resultDocument!
            : documents.length === 1
              ? documents[0]!
              : null,
        }
      }
      pieces.set(id, found)
      return found
    }
    return rows.flatMap((row) => {
      const on = named(row.work_id)
      if (on === null) return []
      const group = workFileGroup(
        { role: row.role as ResourceRole, form: formOfName(row.name) },
        on.returned === null ? null : on.returned.has(row.id),
      )
      return [
        {
          file: {
            ...(group === null ? {} : { group }),
            ...(on.mainResult === row.id ? { mainResult: true as const } : {}),
            resource: resourceFrom(row),
            label: pieceCalled(on.numbers),
            pieceTitle: on.title,
            addedByIdentity: row.added_by_identity,
          },
          numbers: on.numbers,
        },
      ]
    })
  }

  /** Label order, then creation time and id within each piece. */
  const namedFiles = (rows: readonly KeptFileDbRow[]): readonly KeptFileRow[] => {
    return [...onTheirPieces(rows)]
      .sort(
        (a, b) =>
          inLabelOrder(a.numbers, b.numbers) ||
          a.file.resource.createdAt - b.file.resource.createdAt ||
          (a.file.resource.resource < b.file.resource.resource ? -1 : 1),
      )
      .map((one) => one.file)
  }

  const methods: WorkGivenMethods & ThisType<SessionStore> = {
    addResource(input, at) {
      const id = newResourceId()
      db.transaction(() => {
        committed.kept(input.piece, id)
        workSql().insertResource.run(
          id,
          input.piece,
          input.role,
          input.title,
          input.summary,
          input.name,
          input.sha256,
          input.bytes,
          input.addedBy,
          at,
        )
      })()
      return { ...input, resource: id, createdAt: at }
    },

    resourcesOf(piece, after = null, limit = -1) {
      return (
        workSql().resourcesOf.all({
          piece,
          at: after?.createdAt ?? null,
          id: after?.resource ?? null,
          limit,
        }) as ResourceDbRow[]
      ).map(resourceFrom)
    },

    countResourcesAfter(piece, after) {
      return (
        workSql().countResourcesAfter.get({
          piece,
          at: after?.createdAt ?? null,
          id: after?.resource ?? null,
        }) as { total: number }
      ).total
    },

    filesKept(asked) {
      const rows = (
        asked.scope === 'piece'
          ? workSql().filesOnPiece.all(asked.piece)
          : asked.scope === 'conversation'
            ? workSql().filesAddedBy.all(asked.conversation)
            : workSql().filesUnder.all(treeOf(asked))
      ) as KeptFileDbRow[]
      return namedFiles(rows)
    },

    filesKeptTogether(asked) {
      const tree = workSql().filesUnder.all(treeOf(asked)) as KeptFileDbRow[]
      const added = workSql().filesAddedBy.all(asked.holder) as KeptFileDbRow[]
      const treeIds = new Set(tree.map((row) => row.id))
      const addedIds = new Set(added.map((row) => row.id))
      const union = new Map([...tree, ...added].map((row) => [row.id, row]))
      const files = namedFiles([...union.values()])
      return {
        tree: files.filter((row) => treeIds.has(row.resource.resource)),
        added: files.filter((row) => addedIds.has(row.resource.resource)),
      }
    },

    keptFilesNewestFirst(asked, page) {
      const rows = (
        asked.scope === 'tree'
          ? workSql().newestKeptUnder.all({
              ...treeOf(asked),
              from: page.olderThan,
              limit: page.limit,
            })
          : workSql().newestKeptAnywhere.all({ from: page.olderThan, limit: page.limit })
      ) as KeptFileDbRow[]
      return { rows: onTheirPieces(rows).map((one) => one.file), through: rows.at(-1)?.id ?? null }
    },

    keptFilesBefore(asked, olderThan, cap) {
      const counted = (
        asked.scope === 'tree'
          ? workSql().keptUnderCount.get({ ...treeOf(asked), from: olderThan, cap })
          : workSql().keptAnywhereCount.get({ from: olderThan, cap })
      ) as { total: number }
      return counted.total
    },

    madeBy(profileSlug, limit) {
      const identityId = agentIdentityRowId(profileSlug)
      return {
        rows: onTheirPieces(workSql().madeBy.all(identityId, limit) as KeptFileDbRow[]).map(
          (one) => one.file,
        ),
        total: (workSql().madeByCount.get(identityId) as { total: number }).total,
      }
    },

    resource(id) {
      const row = workSql().resourceById.get(id) as ResourceDbRow | undefined
      return row === undefined ? null : resourceFrom(row)
    },

    untitledResources(limit) {
      return (workSql().untitledResources.all(limit) as ResourceDbRow[]).map(resourceFrom)
    },

    titleResource(id, title) {
      return workSql().titleResource.run(title, id).changes > 0
    },

    titledResources(after, limit, keptBefore) {
      const rows = workSql().titledResources.all({ after, limit, keptBefore }) as (ResourceDbRow & {
        at: number
      })[]
      return rows.map((row) => ({ at: row.at, row: resourceFrom(row) }))
    },

    retitleResource(id, was, title) {
      return workSql().retitleResource.run({ id, was, title }).changes > 0
    },

    activityWindow(from, to) {
      return digestRead.activityWindow(from, to)
    },

    digestWindow(from, to) {
      return digestRead.digestWindow(from, to)
    },

    conversationsHeldByNoAgent() {
      return (countConversationsHeldByNoAgent.get() as { n: number }).n
    },

    forestListing(asked) {
      return forestListing(db, asked)
    },

    forestNodesOf(conversations, drawn, hidden) {
      const placed = selectPlacedConversationsAmong.all({
        ids: JSON.stringify(conversations),
        hidden: JSON.stringify(hidden),
      }) as ForestSessionRow[]
      const found = new Set(placed.map((row) => row.id))
      return {
        nodes: forestNodesAmong(placed, drawn),
        gone: conversations.filter((id) => !found.has(id)),
      }
    },

    workReportedTo(sessionId) {
      if (!oneSnapshot) return stallsToldToSession(sessionId)
      // Read with a note so a complete fold is kept; a ledger with an unread row is read as before.
      let unread = false
      const told = stallsToldToSession(sessionId, () => {
        unread = true
      })
      return unread ? stallsToldToSession(sessionId) : told
    },
    legacyOrdinaryStallWasReported(owner, piece, giver) {
      const cut = selectLegacyStallCut.get(owner) as
        { generation: number; through_ordinal: number } | undefined
      if (cut === undefined || cut.generation !== activeGeneration(owner)) return false
      let unread = false
      const pieces = piecesOfSession(owner, () => {
        unread = true
      })
      const ordinal = pieceStallOrdinals.get(pieces)?.get(piece)
      if (unread || ordinal === undefined || ordinal > cut.through_ordinal) return false
      try {
        let told = false
        for (const id of workerReplacementChain(giver)) {
          let incomplete = false
          const receipts = stallsToldToSession(id, () => {
            incomplete = true
          })
          if (incomplete) return false
          if (receipts.has(piece)) told = true
        }
        return told
      } catch {
        return false
      }
    },

    workGivenOutBy(sessionId) {
      return walkWorkGivenBy(sessionId, (piece, candidate) =>
        workGivenOut(piece, candidate.identity),
      )
    },

    workThisOneGaveOut(sessionId) {
      const giver = identitiesOnce()(sessionId)
      return walkWorkGivenBy(sessionId, (piece, candidate) =>
        workEdge(piece, candidate.identity, giver),
      )
    },

    workThisOneWasGiven(sessionId) {
      const mine = spawnSql().conversationBinding.get(sessionId) as BindingRow | undefined
      const identity = mine?.identity ?? null
      const identityOfGiver = identitiesOnce()
      const unread = rowsUnreadOnce()
      const waiting = oneWaitReadPerHolder(unread)
      return walkLedgers(
        'every-piece-of-work-this-one-was-given',
        [{ id: sessionId }],
        (held, noteSkip) =>
          composeWhatEachPieceIsWaitingOn(piecesOfSession(held, noteSkip), waiting).map((piece) =>
            workEdge(piece, identity, identityOfGiver(piece.giver)),
          ),
        unread,
      )
    },

    conversationTree(root) {
      return conversationTree(db, root)
    },

    whatTiesTheTreeOutside(tree) {
      return whatTiesTheTreeOutside(db, tree)
    },

    providerSessionsOf(conversation) {
      return providerSessionsOf(db, conversation)
    },

    deleteTheTree(tree) {
      const deleted = deleteTheTree(db, tree)
      for (const id of tree) {
        forgetTheKeptFoldsOf(id)
        ledgerWrites.delete(id)
      }
      return deleted
    },

    spawnedBy(sessionId) {
      if (spawnSql().conversationBinding.get(sessionId) === undefined) return noSuchConversation()
      const children = spawnSql().spawnedBy.all(sessionId) as SpawnedSessionRow[]
      return walkLedgers('every-conversation-this-one-spawned', children, (id, _noteSkip, row) => [
        {
          conversation: id,
          identity: row.identity,
          provider: row.provider as Provider,
        },
      ])
    },

    conversationBinding(sessionId) {
      const row = spawnSql().conversationBinding.get(sessionId) as BindingRow | undefined
      if (row === undefined) return null
      return {
        provider: row.provider as Provider,
        identity: row.identity,
      }
    },

    piecesGivenBy(sessionId, unread) {
      return piecesGivenBySession(sessionId, unread)
    },

    newestScheduleLevels(owners) {
      const selected = owners === undefined ? null : JSON.stringify([...owners])
      const rows = selectNewestScheduleLevels.all(selected, selected) as {
        session_id: string
        payload: string
        first_listed: string | null
        compacted_at: number | null
      }[]
      return rows.flatMap((row) => {
        const level = scheduleLevelFromRow(row)
        return level === null ? [] : [level]
      })
    },

    newestScheduleLevel(sessionId) {
      const row = selectNewestScheduleLevel.get(sessionId) as
        Parameters<typeof scheduleLevelFromRow>[0] | undefined
      return row === undefined ? null : scheduleLevelFromRow(row)
    },

    lastStatusAt(sessionId) {
      const row = selectLastStatusAt.get(sessionId) as { at: number } | undefined
      return row === undefined ? null : row.at
    },

    scheduleEvidenceRows(sessionId) {
      const answered = selectScheduleEvidenceRows.all(
        sessionId,
        MAX_SCHEDULE_HISTORY_WALKED + 1,
        MAX_SCHEDULE_EVIDENCE_ROWS,
      ) as {
        ordinal: number
        created_at: number
        type: string
        payload: string
        walked: number | null
      }[]
      const walked = answered.find((row) => row.walked !== null)?.walked ?? 0
      const rows = answered.filter((row) => row.walked === null)
      const given = new Set<string>()
      // How many rows of each kind were read: one that reached the cap may have more behind it.
      const read = { life: 0, receipt: 0, level: 0 }
      const kept = rows.flatMap((row): ScheduleEvidenceRow[] => {
        let payload: unknown
        try {
          payload = JSON.parse(row.payload) as unknown
        } catch {
          return []
        }
        if (row.type !== 'scheduled_work') read.life += 1
        else if (typeof payload === 'object' && payload !== null && 'receipt' in payload) {
          read.receipt += 1
        } else read.level += 1
        const key = `${String(row.created_at)}:${String(row.ordinal)}:${row.type}`
        if (given.has(key)) return []
        given.add(key)
        return [{ ordinal: row.ordinal, at: row.created_at, rowType: row.type, payload }]
      })
      const cut =
        Math.max(read.life, read.receipt, read.level) >= MAX_SCHEDULE_EVIDENCE_ROWS ||
        walked > MAX_SCHEDULE_HISTORY_WALKED
      return { rows: kept, cut }
    },

    recordedOne(sessionId) {
      return sessionCatalogueRead.recordedOne(sessionId)
    },
  }
  return { methods }
}
