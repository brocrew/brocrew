import { serializeSessionRef, storedQuestionsParsed } from '@brobot2/runtime'
import type { SessionStatus } from '@brobot2/shared'
import type { TranscriptEvent } from '../../../shared/conversation-events'
import type { UserTurnEvent } from '../../../shared/human-answer-contracts'
import { moveOfferOf } from '../../../shared/move-request'
import type { RaisedQuestion, RoutedRequest } from '../../../shared/question-contracts'
import {
  anActionAsked,
  aWaitIsReadFrom,
  deriveRoutedRequests,
  questionFilesOf,
} from '../../../shared/questions'
import type { PieceRow } from '../../../shared/task-contracts'
import { createLedgerHistoryRead } from '../../database/sqlite/ledger/history'
import { committedChangesOf, committedRowOf } from '../committed-changes'
import type { AppDatabase, AppStatement } from '../connection'
import { FOLD_TERM } from '../fold-index'
import { newEventId, newTurnId } from '../ids'
import { createLedgerFoldState, type SnapshotFoldAnswers } from '../ledger-fold-state'
import type { EventRow, PersistedEvent } from '../ledger-row-types'
import { ledgerWritesFor } from '../ledger-write-stamp'
import type { SkipNote } from '../rows-unread'
import { createSessionCatalogueRead, resolveEndReason } from '../session-catalogue-read'
import {
  aStoredObject,
  boundStoredEvent,
  noteUnreadRow,
  persistedEventsFrom,
  toPersistedEvents,
} from '../stored-event-codec'
import type { SessionStore } from './session-store-contract'
import type {
  ExchangeRow,
  GenerationRow,
  OpenTurnRow,
  PieceNamingStatus,
  RaisedQuestionRow,
  TurnEndReason,
} from './session-store-rows'
import { readOrSkip, ROUTED_REQUEST_EVENT_TYPES, theFoldIndexHolds } from './store-helpers'

interface TurnReadsPartDeps {
  readonly db: AppDatabase
  readonly oneSnapshot: boolean
  readonly checkFoldState?: (state: readonly unknown[], complete?: boolean) => void
  readonly snapshotAnswers?: SnapshotFoldAnswers
  readonly committed: ReturnType<typeof committedChangesOf>
  readonly connection: AppDatabase
  readonly ledgerWrites: ReturnType<typeof ledgerWritesFor>
}

type TurnReadsMethods = Pick<
  SessionStore,
  | 'discardGeneration'
  | 'deadGenerations'
  | 'turns'
  | 'closeOpenTurn'
  | 'reopened'
  | 'closedByTheQuit'
  | 'whatTheQuitClosed'
  | 'restartedWorkLate'
  | 'whatTheNewestQuitClosed'
  | 'backgroundTheRestartStopped'
  | 'terminate'
  | 'lastOrdinalWrite'
  | 'nextOrdinal'
  | 'resumable'
  | 'unresumable'
  | 'recorded'
  | 'recordedPage'
  | 'replacements'
>

export function createTurnReadsPart(deps: TurnReadsPartDeps) {
  const { db, oneSnapshot, checkFoldState, snapshotAnswers, committed, connection, ledgerWrites } =
    deps
  const insertEvent = db.prepare(
    `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, turn_id, generation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertTurn = db.prepare(
    `INSERT INTO turn (id, session_id, ordinal, prompt, opened_at, generation)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  /** The open turn, if any. At most one: a second `user_turn` cannot arrive while one is open. */
  const selectOpenTurn = db.prepare(
    `SELECT id, blocked_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  /** The most recent turn whatever its state — what a late content event is attributed to. */
  const selectLastTurn = db.prepare(
    `SELECT id FROM turn WHERE session_id = ? AND generation = ? ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectStatus = db.prepare(`SELECT status FROM provider_session WHERE id = ?`)
  const selectTurnCount = db.prepare(
    `SELECT COUNT(*) AS n FROM turn WHERE session_id = ? AND generation = ?`,
  )
  const closeTurn = db.prepare(
    `UPDATE turn SET closed_at = ?, end_reason = ?, blocked_at = NULL
      WHERE id = ? AND closed_at IS NULL`,
  )
  const setTurnBlocked = db.prepare(`UPDATE turn SET blocked_at = ? WHERE id = ?`)
  const selectTurns = db.prepare(
    `SELECT id, ordinal, prompt, opened_at, closed_at, end_reason, blocked_at
       FROM turn WHERE session_id = ? AND generation = ? ORDER BY ordinal`,
  )
  const selectOpenTurnId = db.prepare(
    `SELECT id FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const updateRef = db.prepare(
    `UPDATE provider_session SET external_ref = ?, updated_at = ? WHERE id = ?`,
  )
  const updateStatus = db.prepare(
    `UPDATE provider_session SET status = ?, updated_at = ? WHERE id = ?`,
  )
  const stampClosedByTheQuit = db.prepare(
    `UPDATE provider_session SET closed_by_the_quit_at = ? WHERE id = ?`,
  )
  const clearClosedByTheQuit = db.prepare(
    `UPDATE provider_session SET closed_by_the_quit_at = NULL
      WHERE id = ? AND closed_by_the_quit_at IS NOT NULL`,
  )
  const selectClosedByTheNewestQuit = db.prepare(
    `SELECT id, closed_by_the_quit_at AS at FROM provider_session
      WHERE closed_by_the_quit_at = (SELECT max(closed_by_the_quit_at) FROM provider_session)
      ORDER BY id`,
  )
  function newestQuitClosed(notBefore: number): readonly string[] {
    return (selectClosedByTheNewestQuit.all() as { id: string; at: number }[])
      .filter((row) => row.at >= notBefore)
      .map((row) => row.id)
  }
  const selectBackgroundNewestFirst = db.prepare(
    `SELECT type, payload FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND type IN ('background_work', 'launched')
      ORDER BY generation DESC, ordinal DESC LIMIT 200`,
  )
  const selectLastMomentBefore = db.prepare(
    `SELECT max(created_at) AS at FROM events WHERE session_id = ? AND created_at < ?`,
  )
  const selectClosedByTheQuit = db.prepare(
    `SELECT id FROM provider_session WHERE closed_by_the_quit_at IS NOT NULL
      ORDER BY closed_by_the_quit_at, id`,
  )
  const closedByTheQuitTx = db.transaction((sessionIds: readonly string[], at: number): void => {
    for (const id of sessionIds) stampClosedByTheQuit.run(at, id)
  })
  const SESSION_COLUMNS = `provider_session.id AS id, provider, external_ref, cwd, status, approval_mode, profile_id, reasoning_effort, model, plan_mode, plan_ended_at, model_or_effort_set_by_a_person_at, reported_model, reported_effort, adopted_at, restored_at, child_descent, provider_session.created_at AS created_at, provider_session.updated_at AS updated_at`
  const HAS_EVENTS_COLUMN = `EXISTS (SELECT 1 FROM events
                                       WHERE events.session_id = provider_session.id
                                         AND events.generation = coalesce(g.active, 0)
                                         AND events.type <> 'service_registered') AS has_events`
  const GENERATION_COLUMNS = `${HAS_EVENTS_COLUMN},
            g.normalizer_version AS normalizer_version,
            g.building AS building,
            g.failure AS failure`
  const GENERATION_JOIN = `LEFT JOIN derived_generation g ON g.session_id = provider_session.id`
  const LAST_ENDING_COLUMN = `(SELECT t.end_reason FROM turn t
                                WHERE t.session_id = provider_session.id
                                  AND t.generation = coalesce(g.active, 0)
                                  AND t.closed_at IS NOT NULL
                                ORDER BY t.ordinal DESC LIMIT 1) AS last_end_reason`
  const selectAll = db.prepare(
    `SELECT ${SESSION_COLUMNS}, ${GENERATION_COLUMNS}, ${LAST_ENDING_COLUMN}
       FROM provider_session ${GENERATION_JOIN}
      ORDER BY provider_session.updated_at DESC`,
  )
  // Keep replacement insertion order across generations and require an existing target.
  const selectReplacements = db.prepare(
    `SELECT session_id, payload FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND type = 'replaced_by' AND json_valid(payload)
        AND EXISTS (SELECT 1 FROM provider_session
                     WHERE provider_session.id = json_extract(events.payload, '$.sessionId'))
      ORDER BY events.rowid`,
  )
  const selectOne = db.prepare(
    `SELECT ${SESSION_COLUMNS}, ${GENERATION_COLUMNS}, ${LAST_ENDING_COLUMN}
       FROM provider_session ${GENERATION_JOIN} WHERE provider_session.id = ?`,
  )
  const selectCataloguePage = db.prepare(
    `SELECT ${SESSION_COLUMNS}, ${GENERATION_COLUMNS}, ${LAST_ENDING_COLUMN}
       FROM provider_session ${GENERATION_JOIN}
      WHERE (@identity IS NULL OR agent_identity_id = @identity)
        AND provider_session.updated_at BETWEEN @from AND @to
        AND (@afterId IS NULL OR (provider_session.updated_at, provider_session.id) < (@afterAt, @afterId))
      ORDER BY provider_session.updated_at DESC, provider_session.id DESC LIMIT @limit`,
  )
  const sessionCatalogueRead = createSessionCatalogueRead(selectAll, selectOne, selectCataloguePage)
  const A_STATUS_THE_FOLD_ACTS_ON = `CASE WHEN type = 'status' THEN
          CASE WHEN json_valid(payload) AND json_type(payload) = 'object'
               THEN json_extract(payload, '$.state') IN ('ended', 'errored')
               ELSE 1 END
          ELSE 1 END`
  // Card 397: the sort keeps each row's id, not its payload. A sort of a long conversation's
  // payloads outgrew SQLite's cache and was written to a temp file, 69 MB at startup on the seed.
  const selectRoutedRequestEvents = db.prepare(
    `SELECT rowid AS row, ordinal FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
        AND ${A_STATUS_THE_FOLD_ACTS_ON}
        AND (ordinal >= (SELECT min(ordinal) FROM events
                            INDEXED BY events_kind_owner_idx
                          WHERE ${FOLD_TERM} AND session_id = @session
                            AND generation = @generation
                            AND type IN ('request_routed', 'question_asked'))
             OR ordinal = (SELECT max(ordinal) FROM events
                              INDEXED BY events_kind_owner_idx
                            WHERE ${FOLD_TERM} AND session_id = @session
                              AND generation = @generation
                              AND type = 'launched'
                              AND ordinal < (SELECT min(ordinal) FROM events
                                                INDEXED BY events_kind_owner_idx
                                              WHERE ${FOLD_TERM} AND session_id = @session
                                                AND generation = @generation
                                                AND type IN ('request_routed', 'question_asked'))))
      ORDER BY ordinal`,
  )
  const selectRoutedRequestPayload = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN json_remove(payload, '$.sent', '$.given')
                 ELSE payload END AS payload,
            created_at FROM events WHERE rowid = ?`,
  )
  // The rows of those types written after a kept fold of them, to carry it forward.
  const selectRoutedRequestEventsAfter = db.prepare(
    `SELECT ordinal, type, json_valid(payload) AS readable,
            CASE WHEN json_valid(payload) THEN json_remove(payload, '$.sent', '$.given')
                 ELSE payload END AS payload,
            created_at FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})
        AND ordinal > @after
      ORDER BY ordinal`,
  )
  const selectQuestionsRaised = db.prepare(
    `SELECT COALESCE(json_extract(payload, '$.id'), json_extract(payload, '$.requestId')) AS id,
            -- The kind of the field the id above was read from.
            CASE WHEN json_extract(payload, '$.id') IS NOT NULL THEN json_type(payload, '$.id')
                 ELSE json_type(payload, '$.requestId') END AS idIs,
            json_type(payload, '$.prompt') AS promptIs,
            json_type(payload, '$.questions') AS questionsIs,
            json_type(payload, '$.piece') AS pieceIs,
            json_type(payload, '$.passedUpFrom') AS passedUpFromIs,
            json_type(payload, '$.context') AS contextIs,
            type AS type,
            json_extract(payload, '$.prompt') AS prompt,
            json_extract(payload, '$.questions') AS questions,
            json_extract(payload, '$.piece') AS piece,
            -- 611 · the two fields a PASSED-UP question carries (HO-088 3.2). SQL NULL for every
            -- row that is not one, which is every row written before 611 and every question an
            -- agent raised itself -- the same absence piece already answers with.
            -- (No backticks in this template literal: it is one, and a backtick ends it.)
            json_extract(payload, '$.passedUpFrom') AS passedUpFrom,
            json_extract(payload, '$.context') AS context,
            json_extract(payload, '$.move') AS move,
            json_extract(payload, '$.action') AS action,
            json_extract(payload, '$.files') AS files,
            -- 671 · R18: which rows were torn, and where, so the reader COUNTS them.
            ordinal AS ordinal,
            readable AS readable
       FROM (SELECT ordinal, type, json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload
               FROM events
        INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type IN ('user_input_request', 'question_asked')
        AND ordinal > ?)
      ORDER BY ordinal`,
  )
  // Whether a question row was written after a kept fold of the questions.
  const selectQuestionsRaisedMoved = db.prepare(
    `SELECT 1 FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = @session AND generation = @generation
        AND ordinal > @after AND type IN ('user_input_request', 'question_asked')
      LIMIT 1`,
  )
  const selectAProviderTurnsOpening = db.prepare(
    `SELECT 1 AS began FROM events WHERE turn_id = ? AND type = 'provider_turn' LIMIT 1`,
  )
  const selectTheTurnsOpening = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE turn_id = ? AND session_id = ? AND generation = ? AND type = 'user_turn'
      ORDER BY ordinal LIMIT 1`,
  )
  const {
    newestOfType,
    eventsFrom,
    ancestryContext,
    turnWindow,
    threadLeadRows,
    selectAnyEvent,
    selectMaxOrdinal,
  } = createLedgerHistoryRead(db, activeGeneration)

  const selectGeneration = db.prepare(
    `SELECT active, normalizer_version, derived_through, building, highest, failure
       FROM derived_generation WHERE session_id = ?`,
  )
  const deleteEventGeneration = db.prepare(
    `DELETE FROM events WHERE rowid IN
       (SELECT rowid FROM events WHERE session_id = ? AND generation = ?
         AND type <> 'service_registered' LIMIT ?)`,
  )
  const generationHoldsRowsReadInEvery = db.prepare(
    `SELECT EXISTS (SELECT 1 FROM events WHERE session_id = ? AND generation = ?
                       AND type IN ('instruction_proposed', 'instruction_settled'))
         OR EXISTS (SELECT 1 FROM events WHERE session_id = ? AND generation = ?
                       AND type IN ('mcp_server_requested', 'mcp_server_request_settled')) AS holds`,
  )
  const deleteTurnGeneration = db.prepare(
    `DELETE FROM turn WHERE rowid IN
       (SELECT rowid FROM turn WHERE session_id = ? AND generation = ? LIMIT ?)`,
  )
  const appendTx = db.transaction(
    (
      sessionId: string,
      ordinal: number,
      incoming: TranscriptEvent,
      at: number,
      generation: number,
      reconcileStatus: boolean,
    ) => {
      const event = boundStoredEvent(incoming)
      invalidateForAppend(sessionId, ordinal, event)
      if (event.type === 'reopened') {
        const left = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
        if (left) closeTurn.run(at, 'unknown', left.id)
      }
      const already = (
        event.type === 'user_turn' || event.type === 'provider_turn'
          ? selectOpenTurn.get(sessionId, generation)
          : undefined
      ) as OpenTurnRow | undefined
      const joinsTheProvidersTurn =
        event.type === 'user_turn' &&
        already !== undefined &&
        selectAProviderTurnsOpening.get(already.id) !== undefined &&
        selectTheTurnsOpening.get(already.id, sessionId, generation) === undefined
      if (
        (event.type === 'user_turn' || event.type === 'provider_turn') &&
        !joinsTheProvidersTurn
      ) {
        if (already) closeTurn.run(at, 'unknown', already.id)
        const nth = (selectTurnCount.get(sessionId, generation) as { n: number }).n
        const prompt = event.type === 'user_turn' ? event.text : ''
        insertTurn.run(newTurnId(), sessionId, nth, prompt, at, generation)
      }

      const open = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
      markOwnAppend(sessionId, generation, ordinal, event)
      insertEvent.run(
        newEventId(),
        sessionId,
        ordinal,
        event.type,
        JSON.stringify(event),
        at,
        turnFor(sessionId, event, open, generation),
        generation,
      )
      // A rolled-back write still invalidates a live allocator; it never publishes a floor.
      ledgerWrites.set(sessionId, { ordinal, generation })
      committed.appended(committedRowOf(sessionId, generation, ordinal, event))

      if (event.type === 'session' || event.type === 'conversation_reset') {
        updateRef.run(serializeSessionRef(event.ref), at, sessionId)
      }

      if (event.type === 'turn' && open) closeTurn.run(at, event.state, open.id)
      if (event.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
        if (open) closeTurn.run(at, 'ended', open.id)
      }
      if (event.type === 'status' && open) {
        if (event.state === 'waiting_permission') setTurnBlocked.run(at, open.id)
        if (event.state === 'working') setTurnBlocked.run(null, open.id)
      }

      if (reconcileStatus)
        updateStatus.run(currentStatus(sessionId, event, generation), at, sessionId)
    },
  )

  const CONTENT_EVENTS = new Set([
    'assistant_message',
    'assistant_delta',
    'tool_call',
    'tool_result',
    'thinking',
    'sub_agent',
    'plan_update',
    'image',
    'file_change',
    'memory_note',
  ])

  function turnFor(
    sessionId: string,
    event: TranscriptEvent,
    open: OpenTurnRow | undefined,
    generation: number,
  ): string | null {
    if (open) return open.id
    if (!CONTENT_EVENTS.has(event.type)) return null
    const last = selectLastTurn.get(sessionId, generation) as { id: string } | undefined
    return last?.id ?? null
  }

  function readGeneration(sessionId: string): number {
    return (selectGeneration.get(sessionId) as GenerationRow | undefined)?.active ?? 0
  }

  function activeGeneration(sessionId: string): number {
    return oneSnapshot ? snapshotGeneration(sessionId) : readGeneration(sessionId)
  }

  /** The requests one ledger routed, with what carries its fold forward. */
  interface RoutedRequestsKept {
    readonly answer: readonly RoutedRequest[]
    /** The first routing or question this app asked: the fold reads the ledger from there on. */
    readonly floor: number | null
    readonly entries: readonly PersistedEvent[] | null
  }
  // How many rows a routed fold keeps to be carried forward; a ledger with more is folded whole.
  const ROUTED_ENTRIES_KEPT_AT_MOST = 1024

  const {
    generationOf: snapshotGeneration,
    invalidateForAppend,
    markOwnAppend,
    forgetTheKeptFoldsOf,
    theFoldsMayBeKept,
    keptUntilItsLedgerGrows,
    theKeptOnly,
  } = createLedgerFoldState(
    db,
    connection,
    readGeneration,
    oneSnapshot,
    theFoldIndexHolds,
    invalidateWorkReads,
    invalidateAllWorkReads,
    snapshotAnswers,
  )

  const routedRequestsKept = keptUntilItsLedgerGrows(
    foldRoutedRequestsOfSession,
    carryTheRoutedRequestsForward,
    'routes',
  )
  const routedRequestsOfSession = (sessionId: string, noteSkip?: SkipNote) =>
    routedRequestsKept(sessionId, noteSkip).answer
  const questionsRaisedInSession = keptUntilItsLedgerGrows(
    foldQuestionsRaisedInSession,
    (session, generation, after, held) =>
      selectQuestionsRaisedMoved.get({ session, generation, after }) === undefined ? held : null,
    'questions',
  )
  function recordedTurnOpeningOf(sessionId: string, turnId: string): UserTurnEvent | null {
    const generation = activeGeneration(sessionId)
    const owned = (selectTurnOwned ??= db.prepare(
      'SELECT 1 FROM turn WHERE id = ? AND session_id = ? AND generation = ?',
    )).get(turnId, sessionId, generation)
    if (owned === undefined) return null
    const row = selectTheTurnsOpening.get(turnId, sessionId, generation) as ExchangeRow | undefined
    if (row === undefined || row.payload === null) return null
    const event = aStoredObject(row.payload)
    if (event?.type !== 'user_turn' || typeof event.text !== 'string')
      throw new Error('unread turn opening')
    return event as unknown as UserTurnEvent
  }

  const pieceFoldFloors = new Map<string, { readonly generation: number; readonly floor: number }>()

  // Prepared on first use, once per store: a window read asks for every conversation's cut.
  let selectTurnEnding: AppStatement | undefined
  let selectTurnOwned: AppStatement | undefined
  /** `null` is a foreign/old turn; `undefined` is a current turn with no terminal yet. */
  function reconciliationCut(owner: string, turn: string): number | null | undefined {
    const current = activeGeneration(owner)
    const ending = (selectTurnEnding ??= db.prepare(
      `SELECT e.ordinal FROM events e JOIN turn t ON t.id = e.turn_id
        WHERE t.session_id = ? AND t.id = ? AND t.generation = ?
          AND (e.type = 'turn' OR (e.type = 'status' AND json_valid(e.payload)
            AND json_extract(e.payload, '$.state') IN ('idle', 'ended', 'errored')))
        ORDER BY e.ordinal LIMIT 1`,
    )).get(owner, turn, current) as { ordinal: number } | undefined
    const known = (selectTurnOwned ??= db.prepare(
      'SELECT 1 FROM turn WHERE id = ? AND session_id = ? AND generation = ?',
    )).get(turn, owner, current)
    return known === undefined ? null : ending?.ordinal
  }

  const namedByAPiece = new Map<
    string,
    {
      readonly generation: number
      readonly through: number | null
      readonly pieces: readonly PieceNamingStatus[]
      readonly waiting: PieceRow | null
    }
  >()

  function invalidateWorkReads(session: string): void {
    namedByAPiece.delete(session)
    pieceFoldFloors.delete(session)
  }

  function invalidateAllWorkReads(): void {
    namedByAPiece.clear()
    pieceFoldFloors.clear()
  }

  function foldRoutedRequestsOfSession(sessionId: string, noteSkip?: SkipNote): RoutedRequestsKept {
    const generation = activeGeneration(sessionId)
    return readOrSkip(sessionId, noteSkip, { answer: [], floor: null, entries: [] }, () => {
      let floor: number | null = null
      // A read-only snapshot keeps the answer, not provider/question bodies for append replay.
      let actedOn: PersistedEvent[] | null = oneSnapshot ? null : []
      function* entries() {
        const keys = selectRoutedRequestEvents.iterate({
          session: sessionId,
          generation,
        }) as Iterable<{ readonly row: number; readonly ordinal: number }>
        function* rows(): Generator<EventRow> {
          for (const { row, ordinal } of keys) {
            const read = selectRoutedRequestPayload.get(row) as
              Pick<EventRow, 'payload' | 'created_at'> | undefined
            if (read !== undefined) yield { ordinal, ...read }
          }
        }
        for (const entry of persistedEventsFrom(rows(), noteSkip)) {
          if (entry.event.type === 'request_routed' || entry.event.type === 'question_asked')
            floor = floor === null ? entry.ordinal : Math.min(floor, entry.ordinal)
          if (actedOn !== null && aWaitIsReadFrom(entry.event)) {
            actedOn.push(entry)
            if (actedOn.length > ROUTED_ENTRIES_KEPT_AT_MOST) actedOn = null
          }
          yield entry
        }
      }
      const answer = deriveRoutedRequests(
        sessionId,
        entries(),
        (ordinal) => noteUnreadRow(sessionId, ordinal, noteSkip, 'is not a well-formed routing'),
        checkFoldState === undefined
          ? undefined
          : (state, complete) => checkFoldState([...state, actedOn], complete),
      )
      return {
        answer,
        floor,
        entries: actedOn,
      }
    })
  }

  function carryTheRoutedRequestsForward(
    sessionId: string,
    generation: number,
    after: number,
    held: RoutedRequestsKept,
  ): RoutedRequestsKept | null {
    const rows = selectRoutedRequestEventsAfter.iterate({
      session: sessionId,
      generation,
      after,
    }) as Iterable<EventRow & { readonly type: string; readonly readable: number }>
    // A row the whole fold would count as unread, or a first routing, is the whole fold's to read.
    let skipped = false
    const added: PersistedEvent[] = []
    for (const row of rows) {
      if (row.readable !== 1) return null
      if (held.floor === null) {
        if (row.type === 'request_routed' || row.type === 'question_asked') return null
        continue
      }
      for (const entry of toPersistedEvents([row], () => {
        skipped = true
      })) {
        if (!aWaitIsReadFrom(entry.event)) continue
        if (held.entries === null) return null
        added.push(entry)
        if (held.entries.length + added.length > ROUTED_ENTRIES_KEPT_AT_MOST) return null
      }
      if (skipped) return null
    }
    if (added.length === 0) return held
    if (held.entries === null) return null
    const entries = [...held.entries, ...added]
    let wellFormed = true
    try {
      const answer = deriveRoutedRequests(sessionId, entries, () => {
        wellFormed = false
      })
      return wellFormed ? { answer, floor: held.floor, entries } : null
    } catch {
      return null
    }
  }

  function foldQuestionsRaisedInSession(
    sessionId: string,
    noteSkip?: SkipNote,
  ): ReadonlyMap<string, RaisedQuestion> {
    const rows = selectQuestionsRaised.all(
      sessionId,
      activeGeneration(sessionId),
      Number.NEGATIVE_INFINITY,
    ) as RaisedQuestionRow[]
    return readOrSkip(sessionId, noteSkip, new Map<string, RaisedQuestion>(), () =>
      wordsIn(sessionId, rows, noteSkip, (question) => question),
    )
  }

  function aQuestionRaisedIn(row: RaisedQuestionRow): RaisedQuestion | null {
    const aTextOrAbsent = (is: string | null): boolean =>
      is === null || is === 'null' || is === 'text'
    if (row.id === null || row.prompt === null || row.questions === null) return null
    if (row.idIs !== 'text' || row.promptIs !== 'text' || row.questionsIs !== 'array') return null
    if (![row.pieceIs, row.passedUpFromIs, row.contextIs].every(aTextOrAbsent)) return null
    try {
      const questions = storedQuestionsParsed(JSON.parse(row.questions))
      const fromThisApp = row.type === 'question_asked'
      const move = fromThisApp && row.move !== null ? moveOfferOf(JSON.parse(row.move)) : undefined
      if (fromThisApp && row.move !== null && move === undefined) return null
      const action: unknown = fromThisApp && row.action !== null ? JSON.parse(row.action) : null
      if (fromThisApp && row.action !== null && !anActionAsked(action)) return null
      const files =
        fromThisApp && row.files !== null ? questionFilesOf(JSON.parse(row.files)) : undefined
      return {
        ...(files === undefined ? {} : { files }),
        prompt: row.prompt,
        questions,
        piece: row.piece,
        passedUpFrom: row.passedUpFrom,
        context: row.context,
        raisedBy: row.type === 'question_asked' ? 'this-app' : 'the-provider',
        ...(move === undefined ? {} : { move }),
        ...(anActionAsked(action) ? { action: { files: action.files } } : {}),
      }
    } catch {
      return null
    }
  }

  function wordsIn<T>(
    sessionId: string,
    rows: Iterable<RaisedQuestionRow>,
    noteSkip: SkipNote | undefined,
    project: (question: RaisedQuestion) => T,
  ): ReadonlyMap<string, T> {
    const words = new Map<string, T>()
    for (const row of rows) {
      if (row.readable === 0) {
        noteUnreadRow(sessionId, row.ordinal, noteSkip)
        continue
      }
      const question = aQuestionRaisedIn(row)
      if (question === null || row.id === null) {
        noteUnreadRow(sessionId, row.ordinal, noteSkip, 'is not a well-formed question')
        continue
      }
      words.set(row.id, project(question))
    }
    return words
  }

  function currentStatus(
    sessionId: string,
    event: TranscriptEvent | null,
    generation: number,
  ): SessionStatus {
    if (event?.type === 'status' && (event.state === 'ended' || event.state === 'errored')) {
      return event.state
    }
    const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
    if (row?.status === 'ended' || row?.status === 'errored') return row.status
    const open = selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
    if (!open) return 'idle'
    return open.blocked_at === null ? 'working' : 'waiting_permission'
  }

  const settleTx = db.transaction(
    (
      sessionId: string,
      reason: TurnEndReason,
      at: number,
      terminal: 'ended' | 'errored' | null,
    ): boolean => {
      const open = selectOpenTurnId.get(sessionId, activeGeneration(sessionId)) as
        { id: string } | undefined
      if (open) closeTurn.run(at, reason, open.id)
      const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
      if (row && row.status !== 'ended' && row.status !== 'errored') {
        updateStatus.run(terminal ?? 'idle', at, sessionId)
      }
      return open !== undefined
    },
  )

  const reopenTx = db.transaction((sessionId: string, at: number): boolean => {
    clearClosedByTheQuit.run(sessionId)
    const row = selectStatus.get(sessionId) as { status: SessionStatus } | undefined
    if (row?.status !== 'ended' && row?.status !== 'errored') return false
    updateStatus.run('idle', at, sessionId)
    return true
  })

  const methods: TurnReadsMethods & ThisType<SessionStore> = {
    discardGeneration(sessionId, generation, limit) {
      return db.transaction(() =>
        committed.asStaged(() => {
          committed.staged(sessionId)
          // A batch that may take out such a row moves their readers; any other stays quiet.
          const seen = generationHoldsRowsReadInEvery.get(
            sessionId,
            generation,
            sessionId,
            generation,
          ) as { holds: number }
          const events = deleteEventGeneration.run(sessionId, generation, limit)
          if (seen.holds === 1 && events.changes > 0) committed.stagedRemovedSeen(sessionId)
          if (events.changes > 0) return events.changes
          return deleteTurnGeneration.run(sessionId, generation, limit).changes
        }),
      )()
    },

    deadGenerations(sessionId) {
      const row = selectGeneration.get(sessionId) as GenerationRow | undefined
      if (row === undefined) return []
      const dead: number[] = []
      for (let generation = 0; generation <= row.highest; generation++) {
        if (generation !== row.active) dead.push(generation)
      }
      return dead
    },

    turns(sessionId) {
      return (
        selectTurns.all(sessionId, activeGeneration(sessionId)) as {
          id: string
          ordinal: number
          prompt: string
          opened_at: number
          closed_at: number | null
          end_reason: string | null
          blocked_at: number | null
        }[]
      ).map((row) => ({
        id: row.id,
        ordinal: row.ordinal,
        prompt: row.prompt,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        endReason: resolveEndReason(row.end_reason),
        blockedAt: row.blocked_at,
      }))
    },

    closeOpenTurn(sessionId, reason, at) {
      return settleTx(sessionId, reason, at, null)
    },

    reopened(sessionId, at) {
      return reopenTx(sessionId, at)
    },

    closedByTheQuit(sessionIds, at) {
      closedByTheQuitTx(sessionIds, at)
    },

    whatTheQuitClosed() {
      return (selectClosedByTheQuit.all() as { id: string }[]).map((row) => row.id)
    },

    restartedWorkLate(conversation, pieces, at) {
      if (pieces.length === 0) return
      const generation = activeGeneration(conversation)
      const max = selectMaxOrdinal.get(conversation, generation) as
        { max_ordinal: number | null } | undefined
      appendTx(
        conversation,
        (max?.max_ordinal ?? -1) + 1,
        { type: 'work_restarted', pieces: [...pieces] },
        at,
        generation,
        false,
      )
    },

    whatTheNewestQuitClosed: newestQuitClosed,

    backgroundTheRestartStopped(alsoTheseDied, before, notBefore, owners, quitClosed) {
      const quit = quitClosed ?? newestQuitClosed(notBefore)
      const found: { conversation: string; stopped: readonly string[]; endedAt: number }[] = []
      for (const conversation of new Set([...quit, ...alsoTheseDied])) {
        if (owners !== undefined && !owners.has(conversation)) continue
        try {
          const ended = new Set<string>()
          let running: readonly string[] = []
          for (const row of selectBackgroundNewestFirst.all(conversation) as {
            type: string
            payload: string
          }[]) {
            if (row.type === 'launched') break
            const event = JSON.parse(row.payload) as {
              running?: { id: string; description?: string; kind?: string }[]
              ended?: { id: string }
            }
            if (event.running !== undefined) {
              running = event.running
                .filter((one) => !ended.has(one.id))
                .map((one) => one.description ?? one.kind ?? one.id)
              break
            }
            if (event.ended !== undefined) ended.add(event.ended.id)
          }
          if (running.length === 0) continue
          const last = (
            selectLastMomentBefore.get(conversation, before) as { at: number | null } | undefined
          )?.at
          found.push({ conversation, stopped: running, endedAt: last ?? before })
        } catch (error) {
          console.warn(
            `session store could not read what ${conversation} was running in the background: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      return found
    },

    terminate(sessionId, status, reason, at) {
      return settleTx(sessionId, reason, at, status)
    },

    lastOrdinalWrite(sessionId) {
      return db.inTransaction ? undefined : ledgerWrites.get(sessionId)
    },

    nextOrdinal(sessionId) {
      const row = selectMaxOrdinal.get(sessionId, activeGeneration(sessionId)) as
        { max_ordinal: number | null } | undefined
      return (row?.max_ordinal ?? -1) + 1
    },

    resumable() {
      return sessionCatalogueRead.resumable()
    },

    unresumable() {
      return sessionCatalogueRead.unresumable()
    },

    recorded() {
      return sessionCatalogueRead.recorded()
    },

    recordedPage(input) {
      return sessionCatalogueRead.recordedPage(input)
    },

    replacements() {
      return (selectReplacements.all() as { session_id: string; payload: string }[]).flatMap(
        (row) => {
          try {
            const event = JSON.parse(row.payload) as { sessionId?: unknown }
            return typeof event.sessionId === 'string'
              ? [{ replaced: row.session_id, by: event.sessionId }]
              : []
          } catch (error) {
            console.warn(
              `session store skipped an unreadable replacement row in ${row.session_id}: ${error instanceof Error ? error.message : String(error)}`,
            )
            return []
          }
        },
      )
    },
  }
  return {
    methods,
    insertEvent,
    selectOpenTurn,
    selectLastTurn,
    selectStatus,
    closeTurn,
    selectOpenTurnId,
    updateStatus,
    selectOne,
    sessionCatalogueRead,
    selectRoutedRequestEvents,
    selectRoutedRequestEventsAfter,
    selectQuestionsRaised,
    selectQuestionsRaisedMoved,
    selectAProviderTurnsOpening,
    selectTheTurnsOpening,
    newestOfType,
    eventsFrom,
    ancestryContext,
    turnWindow,
    threadLeadRows,
    selectAnyEvent,
    selectMaxOrdinal,
    selectGeneration,
    appendTx,
    activeGeneration,
    forgetTheKeptFoldsOf,
    theFoldsMayBeKept,
    keptUntilItsLedgerGrows,
    theKeptOnly,
    routedRequestsOfSession,
    questionsRaisedInSession,
    recordedTurnOpeningOf,
    pieceFoldFloors,
    reconciliationCut,
    namedByAPiece,
    foldRoutedRequestsOfSession,
    foldQuestionsRaisedInSession,
    wordsIn,
    currentStatus,
    settleTx,
  }
}
