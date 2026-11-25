import type { SessionStatus } from '@brobot2/shared'
import type { TranscriptEvent } from '../../../shared/conversation-events'
import {
  aConversationTitle,
  aTitleAuthor,
  CONVERSATION_TITLE_CHARS,
  type ConversationTitle,
  type ConversationTitledEvent,
  type ConversationTitleHistory,
  type ConversationTitleHistoryCursor,
} from '../../../shared/conversation-title'
import type { UserTurnEvent } from '../../../shared/human-answer-contracts'
import { REQUEST_IS_OPEN } from '../../../shared/questions'
import { PRE_CONTRACT_NORMALIZER_VERSION } from '../../archive/normalizer'
import { committedChangesOf } from '../committed-changes'
import type { AppDatabase } from '../connection'
import { createHumanAnswerReader } from '../human-answer-reader'
import { newEventId } from '../ids'
import type { EventRow, PersistedEvent } from '../ledger-row-types'
import { ledgerWritesFor } from '../ledger-write-stamp'
import { retryBusyWrite } from '../retry-busy-write'
import type { RowsUnread, SkipNote } from '../rows-unread'
import { derivedStateOf } from '../session-catalogue-read'
import { noteUnreadRow, toPersistedEvents } from '../stored-event-codec'
import { createTurnEvidenceRead } from '../turn-evidence-read'
import { withWindowWriteFence } from '../window-write-fence'
import type { SessionStore } from './session-store-contract'
import type { GenerationRow } from './session-store-rows'
import { skipTheLedger } from './store-helpers'
import type { createTurnReadsPart } from './turn-reads'
import type { createWorkStatementsPart } from './work-statements'

type FromTurnReads = Pick<
  ReturnType<typeof createTurnReadsPart>,
  | 'activeGeneration'
  | 'ancestryContext'
  | 'appendTx'
  | 'closeTurn'
  | 'currentStatus'
  | 'eventsFrom'
  | 'insertEvent'
  | 'newestOfType'
  | 'questionsRaisedInSession'
  | 'recordedTurnOpeningOf'
  | 'routedRequestsOfSession'
  | 'selectAnyEvent'
  | 'selectGeneration'
  | 'selectLastTurn'
  | 'selectMaxOrdinal'
  | 'selectOpenTurnId'
  | 'selectStatus'
  | 'sessionCatalogueRead'
  | 'settleTx'
  | 'threadLeadRows'
  | 'turnWindow'
  | 'updateStatus'
>

type FromWorkStatements = Pick<ReturnType<typeof createWorkStatementsPart>, 'openRoot'>

interface LedgerEventsPartDeps extends FromTurnReads, FromWorkStatements {
  readonly db: AppDatabase
  readonly now: () => number
  readonly committed: ReturnType<typeof committedChangesOf>
  readonly connection: AppDatabase
  readonly ledgerWrites: ReturnType<typeof ledgerWritesFor>
}

type LedgerEventsMethods = Pick<
  SessionStore,
  | 'append'
  | 'titleConversation'
  | 'conversationTitle'
  | 'conversationTitleHistory'
  | 'appendMany'
  | 'atomically'
  | 'onCommitted'
  | 'checkCommitted'
  | 'find'
  | 'findLive'
  | 'workflowOutputPath'
  | 'workflowAgentTask'
  | 'workflowAgentIds'
  | 'reportedSubAgent'
  | 'events'
  | 'newestOfType'
  | 'threadLeadRows'
  | 'eventsFrom'
  | 'ancestryContext'
  | 'turnWindow'
  | 'latestHumanAnswers'
  | 'humanFinalsInWindow'
  | 'ledgerStatus'
  | 'beginGeneration'
  | 'appendGeneration'
  | 'promoteGeneration'
  | 'abandonGeneration'
  | 'clearOrphanBuilds'
  | 'settleOrphanRuns'
  | 'whatACrashLeftRunning'
  | 'recordedTurnMessage'
  | 'recordedTurnOpening'
  | 'ensurePersonalRoot'
  | 'theOpenTurn'
  | 'theNewestTurn'
  | 'theActiveGeneration'
  | 'aLifeOpenedTheTurn'
  | 'howATurnEnded'
  | 'whatBecameOfAMessage'
  | 'settleStrandedRequests'
>

export function createLedgerEventsPart(deps: LedgerEventsPartDeps) {
  const {
    db,
    now,
    committed,
    connection,
    ledgerWrites,
    activeGeneration,
    ancestryContext,
    appendTx,
    closeTurn,
    currentStatus,
    eventsFrom,
    insertEvent,
    newestOfType,
    openRoot,
    questionsRaisedInSession,
    recordedTurnOpeningOf,
    routedRequestsOfSession,
    selectAnyEvent,
    selectGeneration,
    selectLastTurn,
    selectMaxOrdinal,
    selectOpenTurnId,
    selectStatus,
    sessionCatalogueRead,
    settleTx,
    threadLeadRows,
    turnWindow,
    updateStatus,
  } = deps
  const { firstPersonOpening, latestHumanAnswers, humanFinalsInWindow } = createHumanAnswerReader(
    db,
    selectLastTurn,
    activeGeneration,
    toPersistedEvents,
  )

  const selectEvents = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
      WHERE session_id = ? AND generation = ? ORDER BY ordinal`,
  )
  const selectSessionsThatRouted = db.prepare(
    `SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'`,
  )
  const selectRoutedBy = db.prepare(
    `SELECT 1 AS yes FROM events WHERE session_id = ? AND type = 'request_routed' LIMIT 1`,
  )
  /** The named conversations that routed a request, without reading every asker's rows. */
  const routedAmong = (owners: ReadonlySet<string> | undefined): { id: string }[] =>
    owners === undefined
      ? (selectSessionsThatRouted.all() as { id: string }[])
      : [...owners].filter((id) => selectRoutedBy.get(id) !== undefined).map((id) => ({ id }))
  const selectWorkflowOutput = db.prepare(
    `SELECT run.readable AS readable, run.ordinal AS ordinal,
            json_extract(run.body, '$.outputFile') AS path
       FROM (SELECT ordinal, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'workflow_run') run
      WHERE NOT run.readable
         OR (json_extract(run.body, '$.taskId') = ?
             AND json_extract(run.body, '$.outputFile') IS NOT NULL)
      ORDER BY run.ordinal DESC`,
  )
  const selectWorkflowAgentTask = db.prepare(
    `SELECT run.readable AS readable, run.ordinal AS ordinal,
            json_extract(run.body, '$.taskId') AS taskId
       FROM (SELECT ordinal, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'workflow_run') run
       LEFT JOIN json_each(run.body, '$.agents') AS agent
      WHERE NOT run.readable OR json_extract(agent.value, '$.agentId') = ?
      ORDER BY run.ordinal DESC`,
  )
  const selectWorkflowAgentIds = db.prepare(
    `SELECT json_extract(json_each.value, '$.agentId') AS agentId, MIN(run.ordinal) AS seen
       FROM (SELECT ordinal, CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'workflow_run') run,
            json_each(run.body, '$.agents')
      WHERE json_extract(run.body, '$.taskId') = ?
        AND agentId IS NOT NULL
      GROUP BY agentId
      ORDER BY seen`,
  )
  const selectSubAgentReported = db.prepare(
    `SELECT reported.readable AS readable, reported.ordinal AS ordinal
       FROM (SELECT ordinal, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body
               FROM events WHERE session_id = ? AND generation = ? AND type = 'sub_agent') reported
      WHERE NOT reported.readable OR json_extract(reported.body, '$.agentId') = ?`,
  )
  const selectTornRuns = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type = 'workflow_run'
        AND NOT json_valid(payload)`,
  )
  const firstReadable = <Row extends { readable: number; ordinal: number }>(
    sessionId: string,
    candidates: Iterable<Row>,
    unread: RowsUnread | undefined,
  ): Row | undefined => {
    for (const row of candidates) {
      if (row.readable) return row
      noteUnreadRow(sessionId, row.ordinal, unread?.in(sessionId))
    }
    return undefined
  }
  const startBuilding = db.prepare(
    `INSERT INTO derived_generation
       (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
     VALUES (?, 0, ?, 0, 1, 1, NULL, ?)
     ON CONFLICT (session_id) DO UPDATE SET
       building = highest + 1, highest = highest + 1, failure = NULL, updated_at = excluded.updated_at`,
  )
  /** The flip. `building` is cleared in the same write that makes its generation the active one. */
  const promoteBuilding = db.prepare(
    `UPDATE derived_generation
        SET active = ?, normalizer_version = ?, derived_through = ?, building = NULL, failure = NULL, updated_at = ?
      WHERE session_id = ? AND building = ?`,
  )
  /** Stop building. `failure` null is a cancellation, which is not a fault and is recorded as none. */
  const stopBuilding = db.prepare(
    `UPDATE derived_generation SET building = NULL, failure = ?, updated_at = ?
      WHERE session_id = ? AND building = ?`,
  )
  const clearBuilding = db.prepare(
    `UPDATE derived_generation SET building = NULL, updated_at = ? WHERE building IS NOT NULL
       AND session_id = ?`,
  )
  const selectBuildingSessions = db.prepare(
    `SELECT session_id FROM derived_generation WHERE building IS NOT NULL`,
  )
  const clearOrphanBuildsTx = db.transaction(
    (at: number, running: ReadonlySet<string>, owners?: ReadonlySet<string>): number => {
      const rows = selectBuildingSessions.all() as { session_id: string }[]
      let cleared = 0
      for (const row of rows) {
        if (owners !== undefined && !owners.has(row.session_id)) continue
        if (running.has(row.session_id)) continue
        const changed = clearBuilding.run(at, row.session_id).changes
        if (changed > 0) committed.whole(row.session_id, 'listing')
        cleared += changed
      }
      return cleared
    },
  )
  const selectNewestTitled = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_kind_owner_idx
      WHERE type = 'titled' AND session_id = ? AND generation = ?
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const titlePageSize = 20
  const selectTitledPage = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_kind_owner_idx
      WHERE type = 'titled' AND session_id = ? AND generation = ? AND ordinal <= ?
      ORDER BY ordinal DESC LIMIT ?`,
  )
  const conversationTitleHistory = db.transaction(
    (conversation: string, before?: ConversationTitleHistoryCursor): ConversationTitleHistory => {
      const generation = activeGeneration(conversation)
      if (before !== undefined && before.generation !== generation) {
        return { kind: 'generation-changed' }
      }
      const through = before === undefined ? Number.MAX_SAFE_INTEGER : before.ordinal - 1
      const rows = selectTitledPage.all(
        conversation,
        generation,
        through,
        titlePageSize + 1,
      ) as EventRow[]
      const page = rows.slice(0, titlePageSize)
      const titles = toPersistedEvents(page).flatMap(({ event, ordinal, at }) =>
        event.type === 'titled' ? [{ ordinal, title: event.title, author: event.author, at }] : [],
      )
      return {
        kind: 'titles',
        titles,
        rowsUnread: page.length - titles.length,
        next:
          rows.length > titlePageSize
            ? { generation, ordinal: page[titlePageSize - 1]!.ordinal }
            : null,
      }
    },
  )

  /** The newest `titled` row of one generation; an unreadable one reads as none, and is logged. */
  function newestConversationTitle(
    conversation: string,
    generation: number,
    noteSkip?: SkipNote,
  ): ConversationTitle | null {
    const row = selectNewestTitled.get(conversation, generation) as EventRow | undefined
    if (row === undefined) return null
    const read = toPersistedEvents([row], noteSkip)[0]
    if (read === undefined) return null
    if (read.event.type !== 'titled') {
      noteSkip?.(row.ordinal)
      return null
    }
    return { title: read.event.title, author: read.event.author, at: read.at }
  }

  const selectTitledOf = db.prepare(
    `SELECT type, payload, created_at FROM events INDEXED BY events_kind_owner_idx
      WHERE type IN ('titled', 'current_rules_set') AND session_id = ? AND generation = ?
      ORDER BY ordinal`,
  )

  /**
   * A provider rebuild has no titles and no current rules. A copied ledger may already hold their
   * ordered prefix.
   */
  function carryTitles(sessionId: string, from: number, to: number): void {
    if (from === to) return
    type TitleRow = { type: string; payload: string; created_at: number }
    const titles = selectTitledOf.all(sessionId, from) as TitleRow[]
    if (titles.length === 0) return
    const copied = selectTitledOf.all(sessionId, to) as TitleRow[]
    const firstMissing = titles.findIndex(
      (title, index) =>
        title.type !== copied[index]?.type ||
        title.payload !== copied[index]?.payload ||
        title.created_at !== copied[index]?.created_at,
    )
    if (firstMissing < 0) return
    const last =
      (selectMaxOrdinal.get(sessionId, to) as { max_ordinal: number | null } | undefined)
        ?.max_ordinal ?? -1
    titles.slice(firstMissing).forEach((title, index) => {
      insertEvent.run(
        newEventId(),
        sessionId,
        last + 1 + index,
        title.type,
        title.payload,
        title.created_at,
        null,
        to,
      )
    })
  }

  const appendManyTx = db.transaction(
    (
      sessionId: string,
      entries: { ordinal: number; event: TranscriptEvent; at: number }[],
      generation: number,
      reconcileStatus: boolean,
    ) => {
      for (const entry of entries) {
        appendTx(sessionId, entry.ordinal, entry.event, entry.at, generation, reconcileStatus)
      }
    },
  )

  const selectRunningSessions = db.prepare(
    `SELECT id FROM provider_session WHERE status IN ('working', 'waiting_permission')`,
  )

  const selectALaunch = db.prepare(
    `SELECT 1 AS yes FROM events WHERE session_id = ? AND generation = ? AND type = 'launched' LIMIT 1`,
  )
  const settleStrandedRequestsTx = db.transaction(
    (
      at: number,
      running: ReadonlySet<string>,
      unread?: RowsUnread,
      owners?: ReadonlySet<string>,
    ): number => {
      let settled = 0
      for (const asker of routedAmong(owners)) {
        if (running.has(asker.id)) continue
        try {
          const generation = activeGeneration(asker.id)
          const launched = selectALaunch.get(asker.id, generation) !== undefined
          const raised = launched ? questionsRaisedInSession(asker.id, unread?.in(asker.id)) : null
          for (const request of routedRequestsOfSession(asker.id, unread?.in(asker.id))) {
            if (!REQUEST_IS_OPEN[request.state]) continue
            if (raised?.get(request.requestId)?.raisedBy === 'this-app') continue
            const max = selectMaxOrdinal.get(asker.id, generation) as
              { max_ordinal: number | null } | undefined
            appendTx(
              asker.id,
              (max?.max_ordinal ?? -1) + 1,
              { type: 'request_stranded', requestId: request.requestId },
              at,
              generation,
              true,
            )
            settled += 1
          }
        } catch (error) {
          skipTheLedger(asker.id, error, unread?.in(asker.id))
        }
      }
      return settled
    },
  )

  const {
    whatACrashLeftRunning,
    theOpenTurn,
    theNewestTurn,
    aLifeOpenedTheTurn,
    howATurnEnded,
    whatBecameOfAMessage,
  } = createTurnEvidenceRead(db, activeGeneration)

  const settleOrphanRunsTx = db.transaction(
    (at: number, running: ReadonlySet<string>, owners?: ReadonlySet<string>): number => {
      const rows = selectRunningSessions.all() as { id: string }[]
      const stranded = rows.filter(
        (row) => !running.has(row.id) && (owners === undefined || owners.has(row.id)),
      )
      for (const row of stranded) settleTx(row.id, 'unknown', at, null)
      return stranded.length
    },
  )

  const whereAskProvenanceWasRecorded = db.prepare(
    `SELECT 1 FROM events INDEXED BY events_kind_owner_idx
     WHERE session_id = ? AND generation = ? AND type = ?
       AND (? IS NULL OR json_extract(CASE WHEN json_valid(payload) THEN payload END, ?) IS NOT NULL)
     LIMIT 1`,
  )
  const replacementEdges = db.prepare(
    `SELECT type, created_at, payload, generation FROM events INDEXED BY events_kind_owner_idx
     WHERE session_id = ? AND type IN ('replaces', 'replaced_by')
       AND json_valid(payload) AND json_type(payload, '$.sessionId') = 'text'
     ORDER BY rowid`,
  )
  function carryAskProvenance(sessionId: string, outgoing: number, incoming: number): void {
    if (outgoing === incoming) return
    const has = (type: string, field: string | null = null): boolean =>
      whereAskProvenanceWasRecorded.get(sessionId, outgoing, type, field, field) !== undefined
    const losesEvidence =
      has('ask_handoff_attempted') ||
      has('ask_provenance_unresolved') ||
      has('request_routed', '$.originalOpening') ||
      has('message_queued', '$.asks.originalOpening') ||
      has('user_turn', '$.askHandoffAttempt')
    type Edge = {
      type: 'replaces' | 'replaced_by'
      payload: string
      created_at: number
      generation: number
    }
    // A lineage member can carry only an edge. Keep the last insertion of each target, in
    // canonical order, before the inactive generations are collected.
    const edges = replacementEdges.all(sessionId) as Edge[]
    const ordered = new Map<string, Edge>()
    for (const edge of edges) {
      ordered.delete(edge.payload)
      ordered.set(edge.payload, edge)
    }
    const surviving = [...ordered.values()]
    const carry = surviving.some((edge) => edge.generation !== incoming)
    if (!carry && !losesEvidence) return
    const last = selectMaxOrdinal.get(sessionId, incoming) as
      { max_ordinal: number | null } | undefined
    let next = (last?.max_ordinal ?? -1) + 1
    if (carry) {
      for (const edge of surviving) {
        insertEvent.run(
          newEventId(),
          sessionId,
          next++,
          edge.type,
          edge.payload,
          edge.created_at,
          null,
          incoming,
        )
      }
    }
    if (!losesEvidence) return
    // Native parsing cannot verify the original app handoff. Keep the gap after the old rows retire.
    appendTx(
      sessionId,
      next,
      {
        type: 'ask_provenance_unresolved',
        outgoingGeneration: outgoing,
        coverage: 'unprepared',
      },
      now(),
      incoming,
      false,
    )
  }

  const methods: LedgerEventsMethods & ThisType<SessionStore> = {
    append(sessionId, ordinal, event, at) {
      appendTx(sessionId, ordinal, event, at, activeGeneration(sessionId), true)
    },

    titleConversation(conversation, ordinal, titled, at) {
      const title = aConversationTitle(titled.title)
      if (title === null || !aTitleAuthor(titled.author)) {
        throw new Error(
          `a conversation title is one line of 1 to ${String(CONVERSATION_TITLE_CHARS)} characters, with its author`,
        )
      }
      const event: ConversationTitledEvent = { type: 'titled', title, author: titled.author }
      appendTx(conversation, ordinal, event, at, activeGeneration(conversation), true)
    },

    conversationTitle(conversation, unread) {
      return newestConversationTitle(
        conversation,
        activeGeneration(conversation),
        unread?.in(conversation),
      )
    },

    conversationTitleHistory,

    appendMany(sessionId, entries) {
      if (entries.length === 0) return
      appendManyTx(sessionId, entries, activeGeneration(sessionId), true)
    },

    atomically(work) {
      return retryBusyWrite(db, () => db.transaction(work)())
    },

    onCommitted(listener) {
      return committed.listen(listener)
    },

    checkCommitted() {
      committed.check()
    },

    find(sessionId) {
      return sessionCatalogueRead.find(sessionId)
    },

    findLive(sessionId) {
      return sessionCatalogueRead.findLive(sessionId)
    },

    workflowOutputPath(sessionId, taskId, unread) {
      const row = firstReadable(
        sessionId,
        selectWorkflowOutput.iterate(sessionId, activeGeneration(sessionId), taskId) as Iterable<{
          readable: number
          ordinal: number
          path: string | null
        }>,
        unread,
      )
      return row?.path ?? null
    },

    workflowAgentTask(sessionId, agentId, unread) {
      if (agentId === '') return null
      const row = firstReadable(
        sessionId,
        selectWorkflowAgentTask.iterate(
          sessionId,
          activeGeneration(sessionId),
          agentId,
        ) as Iterable<{
          readable: number
          ordinal: number
          taskId: string | null
        }>,
        unread,
      )
      return row?.taskId ?? null
    },

    workflowAgentIds(sessionId, taskId, unread) {
      if (taskId === '') return []
      const generation = activeGeneration(sessionId)
      const rows = selectWorkflowAgentIds.all(sessionId, generation, taskId) as {
        agentId: string
      }[]
      for (const torn of selectTornRuns.all(sessionId, generation) as { ordinal: number }[]) {
        noteUnreadRow(sessionId, torn.ordinal, unread?.in(sessionId))
      }
      return rows.map((row) => row.agentId)
    },

    reportedSubAgent(sessionId, agentId, unread) {
      if (agentId === '') return false
      const walk = selectSubAgentReported.iterate(
        sessionId,
        activeGeneration(sessionId),
        agentId,
      ) as Iterable<{ readable: number; ordinal: number }>
      const torn: number[] = []
      for (const row of walk) {
        if (row.readable) return true
        torn.push(row.ordinal)
      }
      for (const ordinal of torn) noteUnreadRow(sessionId, ordinal, unread?.in(sessionId))
      return false
    },

    events(sessionId) {
      return toPersistedEvents(
        selectEvents.all(sessionId, activeGeneration(sessionId)) as EventRow[],
      )
    },

    newestOfType,

    threadLeadRows,

    eventsFrom,

    ancestryContext,

    turnWindow,

    latestHumanAnswers,
    humanFinalsInWindow,

    ledgerStatus(sessionId) {
      const row = (selectGeneration.get(sessionId) as GenerationRow | undefined) ?? null
      const generation = row?.active ?? 0
      const present =
        (selectAnyEvent.get(sessionId, generation) as { present: number }).present === 1
      return {
        present,
        derived: derivedStateOf(
          row === null
            ? null
            : {
                normalizerVersion: row.normalizer_version,
                building: row.building,
                failure: row.failure,
              },
          present,
        ),
        derivedThrough: row?.derived_through ?? 0,
        normalizerVersion: row?.normalizer_version ?? PRE_CONTRACT_NORMALIZER_VERSION,
        failure: row?.failure ?? null,
      }
    },

    beginGeneration(sessionId) {
      db.transaction(() => {
        committed.whole(sessionId, 'listing')
        startBuilding.run(sessionId, PRE_CONTRACT_NORMALIZER_VERSION, now())
      })()
      const row = selectGeneration.get(sessionId) as GenerationRow | undefined
      if (row?.building == null) {
        throw new Error(`could not open a generation to build for ${sessionId}`)
      }
      return row.building
    },

    appendGeneration(sessionId, generation, entries) {
      if (entries.length === 0) return
      withWindowWriteFence(connection, () =>
        committed.asStaged(() => appendManyTx(sessionId, entries, generation, false)),
      )
    },

    promoteGeneration(sessionId, generation, through) {
      return db.transaction(() => {
        const outgoing = activeGeneration(sessionId)
        const flipped = promoteBuilding.run(
          generation,
          through.normalizerVersion,
          through.derivedThrough,
          now(),
          sessionId,
          generation,
        )
        if (flipped.changes === 0) return false
        carryTitles(sessionId, outgoing, generation)
        carryAskProvenance(sessionId, outgoing, generation)
        committed.whole(sessionId, 'promoted')
        ledgerWrites.set(sessionId, { ordinal: null, generation })
        const open = selectOpenTurnId.get(sessionId, generation) as { id: string } | undefined
        if (open) closeTurn.run(now(), 'unknown', open.id)
        const status = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
        if (status && status.status !== 'ended' && status.status !== 'errored') {
          updateStatus.run(currentStatus(sessionId, null, generation), now(), sessionId)
        }
        return true
      })()
    },

    abandonGeneration(sessionId, generation, failure) {
      db.transaction(() => {
        committed.whole(sessionId, 'listing')
        stopBuilding.run(failure, now(), sessionId, generation)
      })()
    },

    clearOrphanBuilds(running, owners) {
      return clearOrphanBuildsTx(now(), running, owners)
    },

    settleOrphanRuns(at, running, owners) {
      return settleOrphanRunsTx(at, running, owners)
    },

    whatACrashLeftRunning,

    recordedTurnMessage(sessionId, turnId) {
      const row = db
        .prepare(
          `SELECT e.ordinal, e.payload, e.created_at FROM events e
        JOIN turn t ON t.id=e.turn_id AND t.session_id=e.session_id AND t.generation=e.generation
        WHERE t.id=? AND t.session_id=? AND e.type='user_turn' ORDER BY e.ordinal LIMIT 1`,
        )
        .get(turnId, sessionId) as EventRow | undefined
      const message = row === undefined ? undefined : toPersistedEvents([row])[0]
      return message?.event.type === 'user_turn'
        ? (message as PersistedEvent & { event: UserTurnEvent })
        : null
    },

    recordedTurnOpening(sessionId, turnId) {
      return recordedTurnOpeningOf(sessionId, turnId)
    },

    ensurePersonalRoot(sessionId, at) {
      return db.transaction(() => {
        const existing = this.rootOf(sessionId)
        if (existing !== null) return existing
        openRoot(sessionId, at)
        const root = this.rootOf(sessionId)
        if (root === null) throw new Error('personal root was not written')
        return root
      })()
    },

    theOpenTurn,

    theNewestTurn,

    theActiveGeneration(sessionId) {
      return activeGeneration(sessionId)
    },

    aLifeOpenedTheTurn,

    howATurnEnded,

    whatBecameOfAMessage,

    settleStrandedRequests(at, running, unread, owners) {
      return settleStrandedRequestsTx(at, running, unread, owners)
    },
  }
  return {
    methods,
    firstPersonOpening,
    selectSessionsThatRouted,
    selectWorkflowOutput,
    selectWorkflowAgentTask,
    selectSubAgentReported,
    selectBuildingSessions,
    selectRunningSessions,
    theNewestTurn,
  }
}
