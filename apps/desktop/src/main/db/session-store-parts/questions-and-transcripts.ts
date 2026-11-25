import { aPersonsOwnWords } from '../../../shared/a-persons-own-words'
import type { TheQuestionItAsks, TranscriptEvent } from '../../../shared/conversation-events'
import {
  type AskToStop,
  howWorkStopped,
  type LastEndedTurn,
  type StopReading,
  type WhereAnAskLanded,
  WHO_STOPPED_IT,
  whoCancelledIt,
  type WhoStoppedIt,
} from '../../../shared/how-work-stopped'
import type { UserTurnEvent } from '../../../shared/human-answer-contracts'
import {
  capped,
  PREVIEW_CAP,
  type ReceivedInATurn,
  type TaskRecordExchange,
  type TranscriptTurn,
  type Words,
  WORDS_CAP,
} from '../../../shared/last-exchange'
import { moveOfferOf, moveReceiptOf } from '../../../shared/move-request'
import { failureAtTurnEnd } from '../../../shared/piece-fold'
import type { QuestionAskedEvent, RoutedRequest } from '../../../shared/question-contracts'
import { MAX_TURN_PARTS, theMessagesOf } from '../../../shared/runtime-ipc'
import { type ActedBy, actedByFrom } from '../../../shared/who-did-it'
import type { AppDatabase, AppStatement } from '../connection'
import { FOLD_TERM } from '../fold-index'
import type { EventRow } from '../ledger-row-types'
import { fillQuestionCopies, questionCopiesReady } from '../question-copies'
import type { RowsUnread, SkipNote } from '../rows-unread'
import {
  aStoredObject,
  isAStoredId,
  noteUnreadRow,
  theQuestionItAsks,
  toPersistedEvents,
} from '../stored-event-codec'
import type { SessionStore } from './session-store-contract'
import {
  type AskRow,
  CLOSED_TURNS_FOR_PROVIDER_FAILURE,
  type ClosedTurnRow,
  type ExchangeRow,
  type OpenTurnRow,
  PERSON_LAST_WROTE_WITHIN_TURNS,
  type ProviderFailureEpisode,
  type ProviderFailureEvidence,
} from './session-store-rows'
import { readOrSkip, theFoldIndexHolds } from './store-helpers'
import type { createTurnReadsPart } from './turn-reads'
import type { createAgentIdentitiesPart } from './agent-identities'
import type { createPieceFoldsPart } from './piece-folds'
import type { createWorkReadsPart } from './work-reads'

type FromTurnReads = Pick<
  ReturnType<typeof createTurnReadsPart>,
  | 'activeGeneration'
  | 'foldQuestionsRaisedInSession'
  | 'foldRoutedRequestsOfSession'
  | 'questionsRaisedInSession'
  | 'routedRequestsOfSession'
  | 'selectAProviderTurnsOpening'
  | 'selectOpenTurn'
  | 'selectTheTurnsOpening'
  | 'theKeptOnly'
>

type FromAgentIdentities = Pick<
  ReturnType<typeof createAgentIdentitiesPart>,
  'selectNewestTurnsOpened'
>

type FromPieceFolds = Pick<
  ReturnType<typeof createPieceFoldsPart>,
  'foldPiecesKept' | 'questionStatesInSession' | 'selectTheDecisionOn'
>

type FromWorkReads = Pick<
  ReturnType<typeof createWorkReadsPart>,
  'MAIN_THREAD_WORDS' | 'receivedOn' | 'selectLastClosedTurn'
>

interface QuestionsPartDeps
  extends FromTurnReads, FromAgentIdentities, FromPieceFolds, FromWorkReads {
  readonly db: AppDatabase
  readonly connection: AppDatabase
}

type QuestionsMethods = Pick<
  SessionStore,
  | 'routedRequestsOf'
  | 'lastEndedTurn'
  | 'providerFailureEpisode'
  | 'routedRequestsAtHand'
  | 'questionsRaisedAtHand'
  | 'piecesAtHand'
  | 'questionsRoutedToAtHand'
  | 'whenAPersonLastWrote'
  | 'requestsItsLastEndedTurnInterrupted'
  | 'lastExchange'
  | 'lastExchangeForTaskRecord'
  | 'whatOpenedTheLastEndedTurn'
  | 'transcript'
  | 'lastAskToStop'
  | 'lastExplicitStopRequest'
  | 'questionsRaisedIn'
  | 'questionStatesIn'
  | 'conversationsHoldingACopyOf'
  | 'fillQuestionCopies'
  | 'whoRoutedToWhom'
  | 'theRequestRouted'
  | 'generationOf'
  | 'latestMoveOffer'
  | 'theDecisionOn'
  | 'questionsRoutedTo'
>

export function createQuestionsPart(deps: QuestionsPartDeps) {
  const {
    db,
    connection,
    activeGeneration,
    foldPiecesKept,
    foldQuestionsRaisedInSession,
    foldRoutedRequestsOfSession,
    MAIN_THREAD_WORDS,
    questionsRaisedInSession,
    questionStatesInSession,
    receivedOn,
    routedRequestsOfSession,
    selectAProviderTurnsOpening,
    selectLastClosedTurn,
    selectNewestTurnsOpened,
    selectOpenTurn,
    selectTheDecisionOn,
    selectTheTurnsOpening,
    theKeptOnly,
  } = deps
  const selectClosedTurnsForProviderFailure = db.prepare(
    `SELECT id FROM turn
       WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
       ORDER BY ordinal DESC LIMIT ?`,
  )
  const selectWhoRoutedToWhom = db.prepare(
    `SELECT DISTINCT session_id AS asker,
            CASE WHEN json_valid(payload) THEN json_extract(payload, '$.parent') END AS parent
       FROM events INDEXED BY events_request_routed_idx
      WHERE type = 'request_routed'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.to') END IS NOT 'a-person'`,
  )
  /** {@link SessionStore.conversationsHoldingACopyOf}'s conversations. */
  const selectConversationsHoldingACopyOf = db.prepare(
    `SELECT DISTINCT session_id AS id FROM events
      WHERE type = 'question_asked'
        AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.passedUpFrom') END = ?
      ORDER BY session_id`,
  )
  /** The same conversations, by the copies' key, each checked against its ledger row. */
  let selectConversationsByCopy: AppStatement | undefined
  const selectLatestMoveOffer = db.prepare(
    `SELECT payload FROM events INDEXED BY events_kind_owner_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'question_asked'
        AND CASE WHEN json_valid(payload) THEN json_type(payload, '$.move') END = 'object'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectTheRequestRouted = db.prepare(
    `SELECT ordinal, payload, created_at FROM events
        INDEXED BY events_session_ordinal_uq
      WHERE session_id = @session AND generation = @generation
        AND type IN ('permission_request', 'user_input_request')
        AND ordinal < (SELECT max(ordinal) FROM events
                          INDEXED BY events_request_routed_idx
                        WHERE session_id = @session AND type = 'request_routed'
                          AND generation = @generation
                          AND CASE WHEN json_valid(payload)
                                THEN json_extract(payload, '$.requestId') END = @request)
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectLastTurnEndingEvents = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_turn_idx
      WHERE session_id = ? AND generation = ?
        AND type IN ('turn', 'error', 'work_interrupted', 'user_decision')
        AND turn_id = (SELECT id FROM turn
                        WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
                        ORDER BY ordinal DESC LIMIT 1)
      ORDER BY ordinal`,
  )
  const selectProviderFailureTurnEnd = db.prepare(
    `SELECT type, ordinal, payload, created_at FROM events INDEXED BY events_turn_idx
       WHERE session_id = ? AND generation = ? AND turn_id = ?
         AND (type IN ('turn', 'work_interrupted')
           OR (type = 'user_decision' AND CASE WHEN json_valid(payload)
             THEN json_extract(payload, '$.outcome') = 'cancel' ELSE 1 END))
       ORDER BY ordinal LIMIT ?`,
  )
  const selectOpeningBeforeFailureTurn = db.prepare(
    `SELECT ordinal FROM events
       WHERE session_id = ? AND generation = ? AND ordinal < ? AND turn_id IS NOT ?
         AND type IN ('user_turn', 'provider_turn')
       ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectSentBeforeFailureOpening = db.prepare(
    `SELECT ordinal, payload FROM events INDEXED BY events_fold_idx
       WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'message_unqueued'
         AND ordinal > ? AND ordinal < ?
         AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.reason') = 'sent'
                  ELSE 1 END
       ORDER BY ordinal LIMIT ?`,
  )
  theFoldIndexHolds(selectSentBeforeFailureOpening)
  const selectQueueRowForFailure = db.prepare(
    `SELECT payload FROM events INDEXED BY events_kind_owner_idx
       WHERE type = 'message_queued' AND session_id = ? AND generation = ? AND ordinal < ?
         AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.messageId') = ? END
       ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectRequestsTheLastClosedTurnInterrupted = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN json_extract(payload, '$.requestId') END AS request
       FROM events INDEXED BY events_turn_idx
      WHERE session_id = ? AND generation = ? AND type = 'request_interrupted'
        AND turn_id = (SELECT id FROM turn
                        WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
                        ORDER BY ordinal DESC LIMIT 1)
      ORDER BY ordinal`,
  )
  const selectNewestReceived = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type = 'user_turn'
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectNewestAnswerAfter = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal > ? AND ${MAIN_THREAD_WORDS}
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectReceivedStartsBack = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type IN ('user_turn', 'provider_turn')
      ORDER BY ordinal DESC LIMIT ?`,
  )
  const selectNextReceivedAfter = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND type IN ('user_turn', 'provider_turn')
        AND ordinal > ?
      ORDER BY ordinal ASC LIMIT 1`,
  )
  const selectWhatEndedBefore = db.prepare(
    `SELECT json_extract(payload, '$.ended.summary') AS summary FROM events
      WHERE session_id = @session AND generation = @generation AND type = 'background_work'
        AND ordinal < @before
        AND ordinal > coalesce((SELECT ordinal FROM events
                                 WHERE session_id = @session AND generation = @generation
                                   AND type IN ('turn', 'user_turn', 'provider_turn', 'reopened')
                                   AND ordinal < @before
                                 ORDER BY ordinal DESC LIMIT 1), -1)
        AND json_valid(payload) AND json_type(payload, '$.ended.summary') = 'text'
      ORDER BY ordinal ASC`,
  )
  const selectAProviderTurnAfter = db.prepare(
    `SELECT 1 AS began FROM events
      WHERE session_id = ? AND generation = ? AND type = 'provider_turn' AND ordinal > ?
      LIMIT 1`,
  )
  const selectExchangeRowsBetween = db.prepare(
    `SELECT type, CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal < ?
        AND (type IN ('user_turn', 'provider_turn') OR ${MAIN_THREAD_WORDS})
      ORDER BY ordinal ASC`,
  )
  const selectSearchTurnStarts = db.prepare(
    `SELECT DISTINCT (SELECT MAX(u.ordinal) FROM events u
                       WHERE u.session_id = e.session_id AND u.generation = e.generation
                         AND u.type IN ('user_turn', 'provider_turn')
                         AND u.ordinal <= e.ordinal) AS start
      FROM events e
      WHERE e.session_id = ? AND e.generation = ? AND json_valid(e.payload)
        AND (e.type = 'user_turn' OR (e.type = 'assistant_message'
             AND json_extract(e.payload, '$.parentToolCallId') IS NULL))
        AND instr(lower(json_extract(e.payload, '$.text')), ?) > 0
        AND start IS NOT NULL
      ORDER BY start DESC LIMIT ?`,
  )
  const selectLastAskToStop = db.prepare(
    `SELECT payload, created_at, turn_id, type, ordinal FROM (
       SELECT * FROM (
         SELECT payload, created_at, turn_id, type, ordinal FROM events
          WHERE type = 'work_interrupted' AND session_id = @session AND generation = @generation
            AND json_valid(payload)
          ORDER BY ordinal DESC LIMIT 1
       )
       UNION ALL
       SELECT * FROM (
         SELECT payload, created_at, turn_id, type, ordinal FROM events
          WHERE type = 'user_decision' AND session_id = @session AND generation = @generation
            AND CASE WHEN json_valid(payload) THEN
              json_extract(payload, '$.outcome') = 'cancel'
              AND json_type(payload, '$.stopsNothing') IS NOT 'true' ELSE 0 END
          ORDER BY ordinal DESC LIMIT 1
       )
     ) ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectTornAsksAfter = db.prepare(
    `SELECT ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal > ?
        AND type IN ('work_interrupted', 'user_decision')
        AND NOT json_valid(payload)`,
  )
  const selectLastExplicitStopOnTurn = db.prepare(
    `SELECT payload, created_at, turn_id, type, ordinal FROM events
      WHERE type = 'work_interrupted' AND session_id = ? AND generation = ? AND turn_id = ?
        AND CASE WHEN json_valid(payload) THEN
          json_extract(payload, '$.by') = 'an-agent'
          AND json_type(payload, '$.agent') = 'text'
          AND json_type(payload, '$.reason') = 'text' ELSE 0 END
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectSessionsRoutingTo = db.prepare(
    `SELECT DISTINCT routed.session_id AS id,
            CASE WHEN routed.readable THEN NULL ELSE routed.ordinal END AS unreadAt
       FROM (SELECT session_id, generation, ordinal, type,
                    json_valid(payload) AS readable,
                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS payload
               FROM events) routed
      WHERE routed.type = 'request_routed'
        AND (json_extract(routed.payload, '$.parent') = ?
             OR (NOT routed.readable
                 AND routed.generation = coalesce((SELECT active FROM derived_generation g
                                                    WHERE g.session_id = routed.session_id), 0)))`,
  )
  const piecesKeptOnly = theKeptOnly(foldPiecesKept)
  const piecesAtHand = (owner: string) => piecesKeptOnly(owner)?.answer ?? null
  const routedRequestsKeptOnly = theKeptOnly(foldRoutedRequestsOfSession)
  const routedRequestsAtHand = (sessionId: string) =>
    routedRequestsKeptOnly(sessionId)?.answer ?? null
  const questionsRaisedAtHand = theKeptOnly(foldQuestionsRaisedInSession)
  function lastEndedTurnOf(sessionId: string, noteSkip?: SkipNote): LastEndedTurn | null {
    const generation = activeGeneration(sessionId)
    const closed = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    if (closed === undefined) return null
    const since: LastEndedTurn['since'] =
      (selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined) === undefined
        ? 'nothing-has-started-since'
        : 'a-turn-is-running-now'
    const rows = selectLastTurnEndingEvents.all(
      sessionId,
      generation,
      sessionId,
      generation,
    ) as EventRow[]
    const nothingHasSaid: StopReading = { how: 'nothing-has-said', who: null, asker: null }
    const reading: StopReading =
      rows.length === 0
        ? nothingHasSaid
        : readOrSkip(sessionId, noteSkip, nothingHasSaid, () =>
            howWorkStopped(toPersistedEvents(rows, noteSkip)),
          )
    const byItsProvider = selectAProviderTurnsOpening.get(closed.id) !== undefined
    return {
      ...reading,
      startedAt: closed.opened_at,
      endedAt: closed.closed_at,
      since,
      ...(byItsProvider ? { startedByItsProvider: true as const } : {}),
    }
  }

  function questionsInFailedTurn(
    sessionId: string,
    generation: number,
    turnId: string,
    opening: ExchangeRow,
    turn: UserTurnEvent,
  ): readonly TheQuestionItAsks[] {
    const before = selectOpeningBeforeFailureTurn.get(
      sessionId,
      generation,
      opening.ordinal,
      turnId,
    ) as { ordinal: number } | undefined
    const sent = selectSentBeforeFailureOpening.all(
      sessionId,
      generation,
      before?.ordinal ?? -1,
      opening.ordinal,
      MAX_TURN_PARTS + 1,
    ) as { ordinal: number; payload: string }[]
    const parts = theMessagesOf(turn)
    if (parts.length === 0 || (turn.parts !== undefined && turn.parts.length !== parts.length))
      throw new Error('the failed turn parts could not be read')
    if (sent.length === 0) return []

    // A flush records sent rows and then the opening parts in the same order.
    if (sent.length !== parts.length)
      throw new Error('the failed turn could not be matched to its queued input')

    const asks: TheQuestionItAsks[] = []
    for (const [index, row] of sent.entries()) {
      const ending = aStoredObject(row.payload)
      const messageId = ending?.['messageId']
      if (ending?.['type'] !== 'message_unqueued' || !isAStoredId(messageId))
        throw new Error('a sent message from the failed turn could not be read')
      const found = selectQueueRowForFailure.get(sessionId, generation, row.ordinal, messageId) as
        { payload: string } | undefined
      const queued = aStoredObject(found?.payload ?? null)
      if (queued?.['type'] !== 'message_queued')
        throw new Error('the queued message for the failed turn could not be read')
      if (queued['kind'] !== 'question') continue
      const ask = theQuestionItAsks(queued['asks'])?.asks
      if (ask === undefined || ask.asker !== parts[index]?.relayedFrom)
        throw new Error('the question could not be matched to the failed turn')
      asks.push(ask)
    }
    return asks
  }

  function providerFailureEpisodeOf(
    sessionId: string,
    unread?: RowsUnread,
    evidence?: ProviderFailureEvidence,
  ): ProviderFailureEpisode {
    const noteSkip = unread?.in(sessionId) ?? (() => {})
    return readOrSkip<ProviderFailureEpisode>(sessionId, noteSkip, 'unknown', () => {
      const generation = activeGeneration(sessionId)
      const turns = selectClosedTurnsForProviderFailure.all(
        sessionId,
        generation,
        CLOSED_TURNS_FOR_PROVIDER_FAILURE,
      ) as { id: string }[]
      for (const { id } of turns) {
        const opening = selectTheTurnsOpening.get(id, sessionId, generation) as
          ExchangeRow | undefined
        if (opening === undefined) continue
        const turn = aStoredObject(opening.payload)
        if (turn?.['type'] !== 'user_turn' || typeof turn['text'] !== 'string')
          throw new Error('the failed turn opening could not be read')

        const rows = selectProviderFailureTurnEnd.all(
          sessionId,
          generation,
          id,
          MAX_TURN_PARTS + 1,
        ) as (EventRow & { type: TranscriptEvent['type'] })[]
        if (rows.length > MAX_TURN_PARTS) {
          if (evidence !== undefined) evidence.exceededPartLimit = MAX_TURN_PARTS
          return 'unknown'
        }
        const entries = toPersistedEvents(rows, noteSkip)
        if (
          entries.length !== rows.length ||
          entries.some((entry, index) => entry.event.type !== rows[index]?.type)
        )
          return 'unknown'
        const terminalAt = entries.findIndex(({ event }) => event.type === 'turn')
        const terminal = entries[terminalAt]
        if (terminal?.event.type !== 'turn') continue
        const raw = aStoredObject(rows[terminalAt]?.payload ?? null)
        const state = raw?.['state']
        if (
          (state !== 'failed' && state !== 'completed' && state !== 'interrupted') ||
          entries.slice(terminalAt + 1).some(({ event }) => event.type === 'turn') ||
          (state === 'failed' &&
            raw?.['providerFailure'] !== undefined &&
            terminal.event.providerFailure === undefined)
        )
          throw new Error('the recorded terminal could not be read')

        if (evidence !== undefined) evidence.checkedTurnEndings++
        const failure = failureAtTurnEnd(terminal.event, terminal.ordinal)
        if (failure === undefined) continue
        if (failure === null) {
          if (howWorkStopped(entries).who === null) return 'none'
          continue
        }
        const { turnOrdinal: terminalOrdinal, ...cause } = failure
        const asks = questionsInFailedTurn(
          sessionId,
          generation,
          id,
          opening,
          turn as unknown as UserTurnEvent,
        )
        return { generation, terminalOrdinal, turnId: id, cause, asks }
      }
      return turns.length === CLOSED_TURNS_FOR_PROVIDER_FAILURE ? 'unknown' : 'none'
    })
  }

  function whatOpenedTheLastEndedTurn(sessionId: string): ReceivedInATurn | null {
    const generation = activeGeneration(sessionId)
    const closed = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    if (closed === undefined) return null
    const row = selectTheTurnsOpening.get(closed.id, sessionId, generation) as
      ExchangeRow | undefined
    return row === undefined ? null : receivedOn(sessionId, row, PREVIEW_CAP)
  }

  function wordsOf(sessionId: string, row: ExchangeRow, cap = WORDS_CAP): Words {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { unreadable: true }
    }
    // ⚠️ Cast to `unknown`-shaped and CHECKED — a ledger written by another build can hold anything.
    const said = JSON.parse(row.payload) as { text?: unknown }
    return capped(typeof said.text === 'string' ? said.text : '', cap)
  }

  function lastExchangeIn(sessionId: string, cap = WORDS_CAP): TaskRecordExchange {
    const generation = activeGeneration(sessionId)
    const got = selectNewestReceived.get(sessionId, generation) as ExchangeRow | undefined
    if (got === undefined) return { exchange: { received: null, answer: null }, revision: '' }
    const back = selectNewestAnswerAfter.get(sessionId, generation, got.ordinal) as
      ExchangeRow | undefined
    const sinceThen = selectAProviderTurnAfter.get(sessionId, generation, got.ordinal) !== undefined
    return {
      revision: JSON.stringify([generation, got.ordinal, back?.ordinal, sinceThen]),
      exchange: {
        received: receivedOn(sessionId, got, cap),
        answer: back === undefined ? null : wordsOf(sessionId, back, cap),
        ...(sinceThen ? { sinceThenItsProviderStartedATurn: true as const } : {}),
      },
    }
  }

  function turnFrom(
    sessionId: string,
    generation: number,
    rows: readonly ExchangeRow[],
  ): TranscriptTurn | null {
    const [first, ...rest] = rows
    if (first === undefined) return null
    const said = rest.map((row) => wordsOf(sessionId, row))
    const texts = said.flatMap((one) => ('text' in one && one.text !== '' ? [one.text] : []))
    const words: Words | null =
      said.length === 0
        ? null
        : texts.length === 0 && said.some((one) => 'unreadable' in one)
          ? { unreadable: true }
          : capped(texts.join('\n\n'), WORDS_CAP)
    if (first.type === 'provider_turn') {
      const ended = selectWhatEndedBefore.all({
        session: sessionId,
        generation,
        before: first.ordinal,
      }) as { summary: string }[]
      return {
        at: first.ordinal,
        startedByItsProvider: { after: ended.map((one) => one.summary) },
        said: words,
      }
    }
    if (first.type !== 'user_turn') return null
    return { at: first.ordinal, received: receivedOn(sessionId, first), said: words }
  }

  function turnRows(sessionId: string, generation: number, from: number, until: number) {
    return selectExchangeRowsBetween.all(sessionId, generation, from, until) as ExchangeRow[]
  }

  function transcriptOf(
    sessionId: string,
    read: { readonly back: number; readonly search: string | null },
  ): { readonly turns: readonly TranscriptTurn[]; readonly older: boolean } {
    const generation = activeGeneration(sessionId)
    const back = Math.max(1, Math.floor(read.back))
    const end = Number.MAX_SAFE_INTEGER
    const nextStart = (after: number): number =>
      (selectNextReceivedAfter.get(sessionId, generation, after) as { ordinal: number } | undefined)
        ?.ordinal ?? end
    const starts: number[] = []
    if (read.search === null) {
      const newest = selectReceivedStartsBack.all(sessionId, generation, back + 1) as {
        ordinal: number
      }[]
      starts.push(...newest.slice(0, back).map((one) => one.ordinal))
      const turns = [...starts]
        .reverse()
        .map((start) =>
          turnFrom(sessionId, generation, turnRows(sessionId, generation, start, nextStart(start))),
        )
        .filter((one): one is TranscriptTurn => one !== null)
      return { turns, older: newest.length > back }
    }
    const found = selectSearchTurnStarts.all(
      sessionId,
      generation,
      read.search.toLowerCase(),
      back + 1,
    ) as { start: number }[]
    starts.push(...found.map((one) => one.start))
    const turns = starts
      .slice(0, back)
      .reverse()
      .map((start) =>
        turnFrom(sessionId, generation, turnRows(sessionId, generation, start, nextStart(start))),
      )
      .filter((one): one is TranscriptTurn => one !== null)
    return { turns, older: starts.length > back }
  }

  function actorOfTheAsk(row: AskRow): Pick<AskToStop, 'by' | 'asker' | 'reason'> | null {
    const asked = JSON.parse(row.payload) as { by?: unknown; agent?: unknown; reason?: unknown }
    if (row.type === 'user_decision') return whoCancelledIt(asked.by as ActedBy | undefined)
    if (!(WHO_STOPPED_IT as readonly unknown[]).includes(asked.by)) return null
    const by = asked.by as WhoStoppedIt
    return {
      by,
      asker: by === 'an-agent' && typeof asked.agent === 'string' ? asked.agent : null,
      ...(typeof asked.reason === 'string' ? { reason: asked.reason } : {}),
    }
  }

  function lastAskToStopOf(
    sessionId: string,
    noteSkip?: SkipNote,
    source?: 'work_interrupted',
  ): AskToStop | null {
    const generation = activeGeneration(sessionId)
    const row = selectLastAskToStop.get({ session: sessionId, generation }) as AskRow | undefined
    for (const torn of selectTornAsksAfter.all(sessionId, generation, row?.ordinal ?? -1) as {
      ordinal: number
    }[]) {
      noteUnreadRow(sessionId, torn.ordinal, noteSkip)
    }
    if (row === undefined || (source !== undefined && row.type !== source)) return null
    const asked = readOrSkip(sessionId, noteSkip, null, () => actorOfTheAsk(row))
    if (asked === null) return null
    // Each turn is read only when the answer turns on it: the open one can be a long walk.
    const closed = () =>
      selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
    const open = () => selectOpenTurn.get(sessionId, generation) as OpenTurnRow | undefined
    const turn: WhereAnAskLanded =
      row.turn_id === null
        ? 'no-turn-was-running'
        : row.turn_id === closed()?.id
          ? 'the-turn-that-ended-last'
          : row.turn_id === open()?.id
            ? 'a-turn-that-is-running-now'
            : 'a-turn-that-ended-earlier'
    return { ...asked, at: row.created_at, turn }
  }

  const methods: QuestionsMethods & ThisType<SessionStore> = {
    routedRequestsOf(sessionId, unread) {
      return routedRequestsOfSession(sessionId, unread?.in(sessionId))
    },

    lastEndedTurn(sessionId, unread) {
      return lastEndedTurnOf(sessionId, unread?.in(sessionId))
    },
    providerFailureEpisode: providerFailureEpisodeOf,
    routedRequestsAtHand(sessionId) {
      return routedRequestsAtHand(sessionId)
    },
    questionsRaisedAtHand(sessionId) {
      return questionsRaisedAtHand(sessionId)
    },
    piecesAtHand(owner) {
      return piecesAtHand(owner)
    },
    questionsRoutedToAtHand(parentSessionId) {
      const routed: RoutedRequest[] = []
      const read = new Set<string>()
      for (const candidate of selectSessionsRoutingTo.all(parentSessionId) as {
        id: string
        unreadAt: number | null
      }[]) {
        // A routing that cannot be read names no parent: it is in no answer.
        if (candidate.unreadAt !== null || read.has(candidate.id)) continue
        read.add(candidate.id)
        const kept = routedRequestsAtHand(candidate.id)
        if (kept === null) return null
        routed.push(...kept)
      }
      return routed
        .filter((request) => request.parent === parentSessionId)
        .sort((left, right) => left.at - right.at)
    },
    whenAPersonLastWrote(sessionId) {
      const turns = selectNewestTurnsOpened.iterate(
        sessionId,
        activeGeneration(sessionId),
        PERSON_LAST_WROTE_WITHIN_TURNS,
      ) as Iterable<{ payload: string | null; at: number }>
      for (const row of turns) {
        if (row.payload === null) continue
        // ⚠️ Checked, not trusted: a ledger written by another build can hold anything.
        const turn = JSON.parse(row.payload) as UserTurnEvent
        if (theMessagesOf(turn).some(aPersonsOwnWords)) return row.at
      }
      return null
    },
    requestsItsLastEndedTurnInterrupted(sessionId) {
      const generation = activeGeneration(sessionId)
      return (
        selectRequestsTheLastClosedTurnInterrupted.all(
          sessionId,
          generation,
          sessionId,
          generation,
        ) as { request: unknown }[]
      ).flatMap((row) =>
        typeof row.request === 'string' && row.request !== '' ? [row.request] : [],
      )
    },
    lastExchange(sessionId) {
      return lastExchangeIn(sessionId).exchange
    },

    lastExchangeForTaskRecord(sessionId) {
      return lastExchangeIn(sessionId, Infinity)
    },
    whatOpenedTheLastEndedTurn(sessionId) {
      return whatOpenedTheLastEndedTurn(sessionId)
    },
    transcript(sessionId, read) {
      return transcriptOf(sessionId, read)
    },
    lastAskToStop(sessionId, unread, source) {
      return lastAskToStopOf(sessionId, unread?.in(sessionId), source)
    },
    lastExplicitStopRequest(sessionId) {
      const generation = activeGeneration(sessionId)
      const turn = selectLastClosedTurn.get(sessionId, generation) as ClosedTurnRow | undefined
      if (turn === undefined) return null
      const row = selectLastExplicitStopOnTurn.get(sessionId, generation, turn.id) as
        AskRow | undefined
      const asked = row === undefined ? null : actorOfTheAsk(row)
      return asked?.asker != null && asked.reason !== undefined
        ? { asker: asked.asker, reason: asked.reason }
        : null
    },
    questionsRaisedIn(sessionId, unread) {
      return questionsRaisedInSession(sessionId, unread?.in(sessionId))
    },
    questionStatesIn(sessionId, unread) {
      return questionStatesInSession(sessionId, unread?.in(sessionId))
    },
    conversationsHoldingACopyOf(requestId) {
      // The copies only once they are full and indexed; until then, the exact read of the ledger.
      const byCopy = questionCopiesReady(connection)
        ? (selectConversationsByCopy ??= db.prepare(
            `SELECT DISTINCT e.session_id AS id
               FROM question_copy q INDEXED BY question_copy_key_idx
               JOIN events e ON e.id = q.event_id
              WHERE q.passed_up_from = ?
                AND e.type = 'question_asked'
                AND CASE WHEN json_valid(e.payload) THEN json_extract(e.payload, '$.passedUpFrom') END = ?
              ORDER BY e.session_id`,
          ))
        : undefined
      const rows =
        byCopy === undefined
          ? selectConversationsHoldingACopyOf.all(requestId)
          : byCopy.all(requestId, requestId)
      return (rows as { id: string }[]).map((row) => row.id)
    },

    fillQuestionCopies(rows, bytes) {
      return fillQuestionCopies(connection, rows, bytes)
    },
    whoRoutedToWhom() {
      return (selectWhoRoutedToWhom.all() as { asker: string; parent: unknown }[]).flatMap((row) =>
        typeof row.parent === 'string' && row.parent !== ''
          ? [{ asker: row.asker, parent: row.parent }]
          : [],
      )
    },
    theRequestRouted(sessionId, requestId) {
      const row = selectTheRequestRouted.get({
        session: sessionId,
        generation: activeGeneration(sessionId),
        request: requestId,
      }) as EventRow | undefined
      if (row === undefined) return null
      const asked = toPersistedEvents([row])[0]?.event
      if (asked?.type !== 'permission_request' && asked?.type !== 'user_input_request') return null
      return asked.id === requestId ? asked : null
    },
    generationOf(sessionId) {
      return activeGeneration(sessionId)
    },
    latestMoveOffer(sessionId) {
      const row = selectLatestMoveOffer.get(sessionId, activeGeneration(sessionId)) as
        { payload: string } | undefined
      if (row === undefined) return null
      const event = JSON.parse(row.payload) as QuestionAskedEvent
      return moveOfferOf(event.move) === undefined ? null : event
    },
    theDecisionOn(sessionId, requestId) {
      const row = selectTheDecisionOn.get(sessionId, activeGeneration(sessionId), requestId) as
        { payload: string } | undefined
      if (row === undefined) return null
      const decided = JSON.parse(row.payload) as {
        outcome?: unknown
        by?: unknown
        movedTo?: unknown
      }
      return {
        outcome: typeof decided.outcome === 'string' ? decided.outcome : '',
        by: decided.by === undefined ? null : actedByFrom(decided.by),
        ...(moveReceiptOf(decided.movedTo) === undefined
          ? {}
          : { movedTo: moveReceiptOf(decided.movedTo) }),
      }
    },
    questionsRoutedTo(parentSessionId, unread) {
      const sessions = (
        selectSessionsRoutingTo.all(parentSessionId) as { id: string; unreadAt: number | null }[]
      ).filter((candidate) => {
        if (candidate.unreadAt === null) return true
        noteUnreadRow(candidate.id, candidate.unreadAt, unread?.in(candidate.id))
        return false
      })
      return sessions
        .flatMap((row) => [...routedRequestsOfSession(row.id, unread?.in(row.id))])
        .filter((request) => request.parent === parentSessionId)
        .sort((left, right) => left.at - right.at)
    },
  }
  return { methods }
}
