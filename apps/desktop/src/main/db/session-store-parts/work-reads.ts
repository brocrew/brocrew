import type {
  InstructionProposedEvent,
  InstructionSettledEvent,
} from '../../../shared/conversation-events'
import { aConversationTitle, titleFromOpeningMessage } from '../../../shared/conversation-title'
import type { UserTurnEvent } from '../../../shared/human-answer-contracts'
import { type ReceivedInATurn, whatATurnDelivered, WORDS_CAP } from '../../../shared/last-exchange'
import { waitingOnAPerson } from '../../../shared/own-instructions'
import { pieceCalled, pieceNumbersOf, type WorkThatNamesIt } from '../../../shared/piece-called'
import { theMessagesOf } from '../../../shared/runtime-ipc'
import type { PieceRow } from '../../../shared/task-contracts'
import {
  composeWhatEachPieceIsWaitingOn,
  TASK_IS_OPEN,
  theWaitItMarks,
  theWorkThatNamesItAmong,
} from '../../../shared/tasks'
import { WORK_BRIEF_CHARS } from '../../../shared/work-fields'
import { serviceRegistrationOf } from '../../service-registration'
import type { AppDatabase } from '../connection'
import { agentIdentityRowId } from '../identity'
import { closePastWorkSearch, pastWorkSource, searchPastWork } from '../past-work-search'
import { type RowsUnread, rowsUnreadOnce } from '../rows-unread'
import { aStoredObject, noteUnreadRow } from '../stored-event-codec'
import type { SessionStore } from './session-store-contract'
import type {
  ClosedTurnRow,
  ExchangeRow,
  PieceForAName,
  PieceNamingStatus,
  WorkDbRow,
} from './session-store-rows'
import type { createTurnReadsPart } from './turn-reads'
import type { createWorkStatementsPart } from './work-statements'
import type { createLedgerEventsPart } from './ledger-events'
import type { createAgentIdentitiesPart } from './agent-identities'
import type { createPieceFoldsPart } from './piece-folds'
import type { createWorkSettlingPart } from './work-settling'

type FromTurnReads = Pick<
  ReturnType<typeof createTurnReadsPart>,
  | 'activeGeneration'
  | 'namedByAPiece'
  | 'selectMaxOrdinal'
  | 'selectTheTurnsOpening'
  | 'theFoldsMayBeKept'
>

type FromWorkStatements = Pick<
  ReturnType<typeof createWorkStatementsPart>,
  | 'chainUp'
  | 'namesRead'
  | 'newestLineAbout'
  | 'retitlesOf'
  | 'titleNow'
  | 'workRowFrom'
  | 'workRowWalked'
  | 'workSql'
>

type FromLedgerEvents = Pick<ReturnType<typeof createLedgerEventsPart>, 'firstPersonOpening'>

type FromAgentIdentities = Pick<
  ReturnType<typeof createAgentIdentitiesPart>,
  'workerGiverContains' | 'workerInItsPlace' | 'workerReplacementChain' | 'workersBorn'
>

type FromPieceFolds = Pick<
  ReturnType<typeof createPieceFoldsPart>,
  'foldPiecesOfSession' | 'oneWaitReadPerHolder' | 'piecesOfSession' | 'turnBlockPiecesOfSession'
>

type FromWorkSettling = Pick<
  ReturnType<typeof createWorkSettlingPart>,
  'selectServiceBorn' | 'selectServicesBorn'
>

interface WorkReadsPartDeps
  extends
    FromTurnReads,
    FromWorkStatements,
    FromLedgerEvents,
    FromAgentIdentities,
    FromPieceFolds,
    FromWorkSettling {
  readonly db: AppDatabase
  readonly connection: AppDatabase
}

type WorkReadsMethods = Pick<
  SessionStore,
  | 'workById'
  | 'activityWorkNames'
  | 'workByLabel'
  | 'firstTaskOf'
  | 'defaultConversationTitle'
  | 'rootOf'
  | 'workersBorn'
  | 'workerGiverContains'
  | 'workerInItsPlace'
  | 'workerLineage'
  | 'serviceBorn'
  | 'servicesBorn'
  | 'rootDoneCondition'
  | 'rootLines'
  | 'turnBlockRootLines'
  | 'workThatNames'
  | 'workThatNamesAndItsWait'
  | 'workOnItsChainThatNames'
  | 'workThatNamesUnder'
  | 'childrenOf'
  | 'countChildrenAfter'
  | 'pieceOfItsChainHeldBy'
  | 'turnBlockCandidates'
  | 'instructionAsksWaitingIn'
  | 'replyQuestionWithoutARequest'
  | 'searchPastWork'
  | 'pastWorkSearchSource'
  | 'closePastWorkSearch'
  | 'piecesOwnedBy'
  | 'piecesOwnedBefore'
  | 'piecesWithTheirWaits'
  | 'turnBlockPiecesOwnedBy'
  | 'openPiecesOf'
  | 'recentConversationsGivenFrom'
  | 'conversationsOf'
  | 'newestPiecesHeldIn'
  | 'pieceItWasStartedWith'
>

export function createWorkReadsPart(deps: WorkReadsPartDeps) {
  const {
    db,
    connection,
    activeGeneration,
    chainUp,
    firstPersonOpening,
    foldPiecesOfSession,
    namedByAPiece,
    namesRead,
    newestLineAbout,
    oneWaitReadPerHolder,
    piecesOfSession,
    retitlesOf,
    selectMaxOrdinal,
    selectServiceBorn,
    selectServicesBorn,
    selectTheTurnsOpening,
    theFoldsMayBeKept,
    titleNow,
    turnBlockPiecesOfSession,
    workerGiverContains,
    workerInItsPlace,
    workerReplacementChain,
    workersBorn,
    workRowFrom,
    workRowWalked,
    workSql,
  } = deps
  const selectLastClosedTurn = db.prepare(
    `SELECT id, opened_at, closed_at FROM turn WHERE session_id = ? AND generation = ? AND closed_at IS NOT NULL
      ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectTurnBlockCandidates = db.prepare(
    `SELECT id AS piece, owner_session_id AS owner FROM work
      WHERE given_by_session_id = ?
        AND (? IS NULL OR (created_at, id) < (SELECT created_at, id FROM work WHERE id = ?))
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
  const selectTurnBlockInstructions = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal, json_valid(payload) AS readable, payload
       FROM events WHERE session_id = ? AND type IN ('instruction_proposed', 'instruction_settled')
       ORDER BY created_at, ordinal`,
  )
  const MAIN_THREAD_WORDS = `(type = 'assistant_message'
        AND CASE WHEN json_valid(payload)
                 THEN json_extract(payload, '$.parentToolCallId') IS NULL
                 ELSE 1
            END)`
  const selectReplyQuestion = db.prepare(
    `SELECT json_valid(payload) AS readable,
       CASE WHEN json_valid(payload) THEN
         CASE WHEN json_type(payload, '$.text') = 'text'
           THEN substr(rtrim(json_extract(payload, '$.text'), ?), -1) = '?' ELSE NULL END
         ELSE NULL END AS question
       FROM events WHERE turn_id = ? AND ${MAIN_THREAD_WORDS} ORDER BY ordinal DESC LIMIT 1`,
  )
  const selectPersonRequestInTurn = db.prepare(
    `SELECT 1 FROM events WHERE turn_id = ? AND (
       type IN ('permission_request', 'instruction_proposed', 'mcp_server_requested') OR
       (type = 'request_routed' AND CASE WHEN json_valid(payload)
         THEN json_extract(payload, '$.to') = 'a-person' ELSE 1 END)) LIMIT 1`,
  )
  const selectClosedTurnReason = db.prepare('SELECT end_reason FROM turn WHERE id = ?')
  const selectFirstReceived = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN payload END AS payload, ordinal FROM events
      WHERE session_id = @conversation AND generation = @generation AND type = 'user_turn'
      ORDER BY ordinal ASC LIMIT 1`,
  )
  function piecesForAName(
    conversation: string,
    generation: number,
    unread: RowsUnread | undefined,
  ): readonly PieceForAName[] {
    return heldForAName(conversation, generation, unread).pieces
  }

  /** {@link piecesForAName}, and its newest open piece when the fold reads it as waiting on purpose. */
  function heldForAName(
    conversation: string,
    generation: number,
    unread: RowsUnread | undefined,
  ): {
    readonly pieces: readonly PieceNamingStatus[]
    readonly waiting: PieceRow | null
    readonly incomplete?: true
  } {
    const mayKeep = theFoldsMayBeKept()
    const through =
      (selectMaxOrdinal.get(conversation, generation) as { max_ordinal: number | null } | undefined)
        ?.max_ordinal ?? null
    const known = mayKeep ? namedByAPiece.get(conversation) : undefined
    if (known !== undefined && known.generation === generation && known.through === through) {
      return known
    }
    const missed = rowsUnreadOnce()
    const folded = piecesOfSession(conversation, (ordinal) => {
      missed.in(conversation)(ordinal)
      unread?.in(conversation)(ordinal)
    })
    const newestOpen = folded.filter((piece) => TASK_IS_OPEN[piece.state]).at(-1)
    const waiting = newestOpen?.state === 'waiting-on-purpose' ? newestOpen : null
    const pieces = folded.map(
      ({
        piece,
        label,
        title,
        owner,
        giver,
        givenAt,
        state,
        outcome,
        endedAt,
        statusLine,
      }): PieceNamingStatus => ({
        piece,
        label,
        title,
        owner,
        giver,
        givenAt,
        state,
        outcome,
        endedAt,
        statusLine,
      }),
    )
    if (missed.count !== 0 || missed.ledgersSkipped !== 0)
      return { pieces, waiting, incomplete: true }
    if (mayKeep) namedByAPiece.set(conversation, { generation, through, pieces, waiting })
    return { pieces, waiting }
  }

  function doneConditionOfRoot(root: WorkDbRow): string | null {
    const found = workSql().doneCondition.get(
      root.owner_session_id,
      activeGeneration(root.owner_session_id),
      root.id,
    ) as { payload: string } | undefined
    if (found === undefined) return null
    const payload = aStoredObject(found.payload)
    if (
      payload?.type !== 'work_rebriefed' ||
      payload.piece !== root.id ||
      typeof payload.definitionOfDone !== 'string' ||
      payload.definitionOfDone.length > WORK_BRIEF_CHARS ||
      payload.definitionOfDone.trim() === ''
    )
      throw new Error('unread done condition')
    return payload.definitionOfDone
  }

  function theRootThatNames(conversation: string, generation: number): WorkThatNamesIt | null {
    const root = workSql().rootOwnedBy.get(conversation) as WorkDbRow | undefined
    return root === undefined ? null : theNameOfRoot(root, generation)
  }

  function theNameOfRoot(root: WorkDbRow, generation: number): WorkThatNamesIt {
    return {
      label: pieceCalled([root.number]),
      title: titleNow(root, generation),
      definitionOfDone: doneConditionOfRoot(root),
    }
  }

  function rootStatusOf(root: WorkDbRow, generation: number): PieceRow['statusLine'] {
    const statusSet = newestLineAbout(root, generation, 'work_status_set')
    return typeof statusSet?.line === 'string' &&
      typeof statusSet.by === 'string' &&
      typeof statusSet.at === 'number'
      ? {
          text: statusSet.line,
          by: statusSet.by,
          at: statusSet.at,
          revision: statusSet.revision as number,
          ...theWaitItMarks(statusSet),
        }
      : null
  }

  function theWorkThatNamesNow(
    conversation: string,
    unread: RowsUnread | undefined,
  ): WorkThatNamesIt | null {
    const generation = activeGeneration(conversation)
    return (
      theRootThatNames(conversation, generation) ??
      theWorkThatNamesItAmong(piecesForAName(conversation, generation, unread))
    )
  }

  function replyQuestionWithoutARequest(conversation: string): string | null {
    const generation = activeGeneration(conversation)
    const closed = selectLastClosedTurn.get(conversation, generation) as ClosedTurnRow | undefined
    if (
      closed === undefined ||
      (selectClosedTurnReason.get(closed.id) as { end_reason: string }).end_reason !== 'completed'
    )
      return null
    const opening = selectTheTurnsOpening.get(closed.id, conversation, generation) as
      ExchangeRow | undefined
    if (opening === undefined) return null
    const received = receivedOn(conversation, opening, 0)
    if (![received, ...(received.cameWith ?? [])].some((one) => one.from.is === 'a-person'))
      return null
    if (selectPersonRequestInTurn.get(closed.id) !== undefined) return null
    const tail = selectReplyQuestion.get(
      ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
      closed.id,
    ) as { readable: number; question: number | null } | undefined
    return tail?.readable === 1 && tail.question === 1 ? closed.id : null
  }

  function receivedOn(sessionId: string, row: ExchangeRow, cap = WORDS_CAP): ReceivedInATurn {
    if (row.payload === null) {
      noteUnreadRow(sessionId, row.ordinal, undefined)
      return { from: { is: 'unreadable' }, words: { unreadable: true } }
    }
    return whatATurnDelivered(JSON.parse(row.payload) as UserTurnEvent, cap)
  }

  const methods: WorkReadsMethods & ThisType<SessionStore> = {
    workById(piece) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      return row === undefined ? null : workRowWalked(row)
    },

    activityWorkNames(pieces) {
      const named = new Map<string, { label: string; title: string | null } | null>()
      const owners = new Map<string, WorkDbRow[]>()
      for (const id of new Set(pieces)) {
        try {
          const row = workSql().byId.get(id) as WorkDbRow | undefined
          if (row === undefined) {
            named.set(id, null)
            continue
          }
          const group = owners.get(row.owner_session_id) ?? []
          group.push(row)
          owners.set(row.owner_session_id, group)
        } catch {
          named.set(id, null)
        }
      }
      for (const [owner, rows] of owners) {
        try {
          const generation = activeGeneration(owner)
          const titles = retitlesOf(owner, generation)
          for (const row of rows) {
            named.set(row.id, {
              label: workRowWalked(row).label,
              title: titleNow(row, generation, (one) => titles.get(one.id) ?? null),
            })
          }
        } catch {
          for (const row of rows) named.set(row.id, null)
        }
      }
      return named
    },

    workByLabel(label) {
      const numbers = pieceNumbersOf(label)
      if (numbers === null) return null
      const [first, ...below] = numbers
      if (first === undefined) return null
      let row = workSql().rootNumbered.get(first) as WorkDbRow | undefined
      for (const number of below) {
        if (row === undefined) return null
        row = workSql().childNumbered.get(row.id, number) as WorkDbRow | undefined
      }
      return row === undefined ? null : workRowFrom(row, numbers)
    },

    firstTaskOf(conversation) {
      const row = workSql().firstOwnedBy.get(conversation) as WorkDbRow | undefined
      if (row === undefined) return null
      return { piece: row.id, label: workRowWalked(row).label }
    },

    defaultConversationTitle(conversation, includeOpening = false) {
      const sql = workSql()
      const generation = activeGeneration(conversation)
      const root = sql.rootOwnedBy.get(conversation) as WorkDbRow | undefined
      const rootTitle = root === undefined ? null : aConversationTitle(titleNow(root, generation))
      if (rootTitle !== null) return rootTitle
      const first = sql.firstNonRootOwnedBy.get(conversation) as WorkDbRow | undefined
      const taskTitle = first === undefined ? null : aConversationTitle(titleNow(first, generation))
      if (taskTitle !== null) return taskTitle
      if (!includeOpening || root === undefined) return null
      const opening = firstPersonOpening(conversation, generation)
      return opening === null ? null : titleFromOpeningMessage(opening)
    },

    rootOf(conversation) {
      const row = workSql().rootOwnedBy.get(conversation) as WorkDbRow | undefined
      return row === undefined ? null : workRowFrom(row, [row.number])
    },

    workersBorn,
    workerGiverContains,
    workerInItsPlace,
    workerLineage: workerReplacementChain,

    serviceBorn(conversation) {
      return selectServiceBorn.get(conversation) !== undefined
    },

    servicesBorn() {
      const rows = selectServicesBorn.all() as {
        id: string
        identity: string | null
        incarnation: number | null
        parent: string | null
        created: number
        birth: string | null
      }[]
      return rows.map(({ id, identity, incarnation, parent, created, birth }) => {
        const registration = birth === null ? null : serviceRegistrationOf(aStoredObject(birth))
        const conflicted =
          birth !== null &&
          (registration === null ||
            registration.identity !== identity ||
            registration.identityCreatedAt !== incarnation ||
            registration.identityCreatedAt > created ||
            parent !== null)
        return {
          conversation: id,
          identity,
          ...(conflicted
            ? { conflicted: true as const }
            : registration === null
              ? {}
              : { identityCreatedAt: registration.identityCreatedAt }),
        }
      })
    },

    rootDoneCondition(root) {
      const row = workSql().byId.get(root) as WorkDbRow | undefined
      if (row === undefined || row.parent_id !== null) throw new Error('unread root')
      return doneConditionOfRoot(row)
    },

    rootLines(root) {
      const row = workSql().byId.get(root) as WorkDbRow | undefined
      if (row === undefined || row.parent_id !== null) return { title: null, statusLine: null }
      const generation = activeGeneration(row.owner_session_id)
      const statusLine = rootStatusOf(row, generation)
      return { title: titleNow(row, generation), statusLine }
    },

    turnBlockRootLines(root) {
      const row = workSql().byId.get(root) as WorkDbRow | undefined
      if (row === undefined || row.parent_id !== null) return null
      const generation = activeGeneration(row.owner_session_id)
      const read = (type: 'work_retitled' | 'work_status_set') => {
        const found = workSql().turnRootLine.get(row.owner_session_id, generation, type, root) as
          { payload: string; created_at: number; ordinal: number } | undefined
        if (found === undefined) return { kind: 'absent' as const }
        const payload = aStoredObject(found.payload)
        if (payload?.piece !== root || payload.type !== type) return { kind: 'unread' as const }
        return { kind: 'present' as const, payload, at: found.created_at, revision: found.ordinal }
      }
      const title = read('work_retitled')
      const status = read('work_status_set')
      if (title.kind === 'unread' || status.kind === 'unread') return null
      if (title.kind === 'present' && typeof title.payload.title !== 'string') return null
      if (row.title !== null && typeof row.title !== 'string') return null
      if (
        status.kind === 'present' &&
        (typeof status.payload.line !== 'string' ||
          typeof status.payload.by !== 'string' ||
          typeof status.at !== 'number')
      )
        return null
      return {
        title: title.kind === 'present' ? (title.payload.title as string) : row.title,
        statusLine:
          status.kind === 'present'
            ? {
                text: status.payload.line as string,
                by: status.payload.by as string,
                at: status.at,
                revision: status.revision,
              }
            : null,
      }
    },

    workThatNames(conversation, unread) {
      return theWorkThatNamesNow(conversation, unread)
    },

    workThatNamesAndItsWait(conversation, unread, folded, includeNamingStatus) {
      const generation = activeGeneration(conversation)
      const held =
        folded === undefined
          ? heldForAName(conversation, generation, unread)
          : {
              pieces: folded,
              incomplete: undefined,
              waiting: folded.filter((piece) => TASK_IS_OPEN[piece.state]).at(-1) ?? null,
            }
      const root = workSql().rootOwnedBy.get(conversation) as WorkDbRow | undefined
      const named =
        root === undefined ? theWorkThatNamesItAmong(held.pieces) : theNameOfRoot(root, generation)
      let line: PieceRow['statusLine'] | undefined
      if (includeNamingStatus) {
        if (root !== undefined) line = rootStatusOf(root, generation)
        else if (!held.incomplete && named !== null)
          line = held.pieces.find((piece) => piece.label === named.label)?.statusLine
      }
      return {
        named,
        ...(line == null ? {} : { namingTaskStatus: line.text }),
        waitingOnPurpose: held.waiting?.state === 'waiting-on-purpose' ? held.waiting : null,
      }
    },

    workOnItsChainThatNames(conversation, piece) {
      const itsGeneration = activeGeneration(conversation)
      const itsRoot = theRootThatNames(conversation, itsGeneration)
      if (itsRoot !== null) return itsRoot
      try {
        const given = workSql().byId.get(piece) as WorkDbRow | undefined
        const itsOwn =
          given === undefined
            ? undefined
            : chainUp(given).find((above) => above.owner_session_id === conversation)
        return itsOwn === undefined
          ? null
          : { label: workRowWalked(itsOwn).label, title: titleNow(itsOwn, itsGeneration) }
      } catch (error) {
        console.warn(
          `session store could not walk up from ${piece} to name ${conversation}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return null
      }
    },

    workThatNamesUnder(conversation, piece, unread) {
      const generation = activeGeneration(conversation)
      const root = theRootThatNames(conversation, generation)
      if (root !== null) return root
      let mine: WorkDbRow | undefined
      try {
        const row = workSql().byId.get(piece) as WorkDbRow | undefined
        mine =
          row === undefined
            ? undefined
            : chainUp(row).find((one) => one.owner_session_id === conversation)
      } catch (error) {
        console.warn(
          `session store could not walk up from ${piece} for ${conversation}: ${error instanceof Error ? error.message : String(error)}`,
        )
        mine = undefined
      }
      if (mine === undefined) {
        return theWorkThatNamesItAmong(piecesForAName(conversation, generation, unread))
      }
      const read = namesRead?.get(mine.id)
      if (read !== undefined) return read
      const named = { label: workRowWalked(mine).label, title: titleNow(mine, generation) }
      namesRead?.set(mine.id, named)
      return named
    },

    childrenOf(piece, after = 0, limit = -1) {
      const row = workSql().byId.get(piece) as WorkDbRow | undefined
      if (row === undefined) return []
      const above = [...chainUp(row)].reverse().map((each) => each.number)
      return (workSql().children.all(piece, after, limit) as WorkDbRow[]).map((child) =>
        workRowFrom(child, [...above, child.number]),
      )
    },

    countChildrenAfter(piece, after) {
      return (workSql().countChildrenAfter.get(piece, after) as { total: number }).total
    },

    pieceOfItsChainHeldBy(piece, owner) {
      try {
        const row = workSql().byId.get(piece) as WorkDbRow | undefined
        if (row === undefined) return null
        return chainUp(row).find((one) => one.owner_session_id === owner)?.id ?? null
      } catch (error) {
        console.warn(
          `session store could not walk up from ${piece} for ${owner}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return null
      }
    },

    turnBlockCandidates(giver, limit, after = null) {
      return selectTurnBlockCandidates.all(giver, after, after, limit) as {
        piece: string
        owner: string
      }[]
    },

    instructionAsksWaitingIn(conversation, unread) {
      const rows = selectTurnBlockInstructions.all(conversation) as {
        conversation: string
        at: number
        ordinal: number
        readable: number
        payload: string
      }[]
      return waitingOnAPerson(
        rows.flatMap((row) => {
          try {
            if (row.readable !== 1) throw new Error('unreadable instruction')
            const event = JSON.parse(row.payload) as
              InstructionProposedEvent | InstructionSettledEvent | null
            if (typeof event?.askId !== 'string') throw new Error('instruction has no ask id')
            return [{ conversation, at: row.at, event }]
          } catch {
            noteUnreadRow(conversation, row.ordinal, unread.in(conversation))
            return []
          }
        }),
      )
    },

    replyQuestionWithoutARequest,

    searchPastWork(caller, words, profile, cursor, transcript) {
      return searchPastWork(connection, this, caller, words, undefined, profile, cursor, transcript)
    },

    pastWorkSearchSource(caller, profile, after, recent) {
      return pastWorkSource(connection, caller, profile, after, recent)
    },

    closePastWorkSearch() {
      closePastWorkSearch(connection)
    },

    piecesOwnedBy(owner, unread) {
      return piecesOfSession(owner, unread?.in(owner))
    },

    piecesOwnedBefore(owner, ordinal, unread) {
      return foldPiecesOfSession(owner, unread?.in(owner), false, ordinal)
    },

    piecesWithTheirWaits(owner, unread, pieces = piecesOfSession(owner, unread.in(owner))) {
      return composeWhatEachPieceIsWaitingOn(pieces, oneWaitReadPerHolder(unread))
    },

    turnBlockPiecesOwnedBy(owner, unread) {
      return turnBlockPiecesOfSession(owner, unread?.in(owner))
    },

    openPiecesOf(owner, unread) {
      return piecesOfSession(owner, unread?.in(owner)).filter((piece) => TASK_IS_OPEN[piece.state])
    },

    recentConversationsGivenFrom(giver, recipientProfile, limit) {
      const rows = workSql().recentGivenFrom.all({
        recipient: agentIdentityRowId(recipientProfile),
        giver,
        limit: limit + 1,
      }) as { id: string; title: string | null }[]
      return {
        rows: rows.slice(0, limit).map((row) => ({ conversation: row.id, title: row.title })),
        more: rows.length > limit,
      }
    },

    conversationsOf(profileSlug) {
      const rows = workSql().conversationsOf.all(agentIdentityRowId(profileSlug)) as {
        id: string
        parent_session_id: string | null
        created_at: number
        updated_at: number
      }[]
      return rows.map((row) => ({
        conversation: row.id,
        parent: row.parent_session_id,
        startedAt: row.created_at,
        lastActiveAt: row.updated_at,
      }))
    },

    newestPiecesHeldIn(conversations, limit, unread) {
      if (conversations.length === 0 || limit < 1) return { rows: [], newest: 0, total: 0 }
      const among = JSON.stringify(conversations)
      const newest = workSql().newestHeldIn.all(among, limit) as {
        id: string
        owner_session_id: string
      }[]
      const folded = new Map<string, readonly PieceForAName[]>()
      const rows = newest.flatMap((row): PieceForAName[] => {
        const holder = row.owner_session_id
        let held = folded.get(holder)
        if (held === undefined) {
          held = piecesForAName(holder, activeGeneration(holder), unread)
          folded.set(holder, held)
        }
        const piece = held.find((one) => one.piece === row.id)
        return piece === undefined ? [] : [piece]
      })
      return {
        rows,
        newest: newest.length,
        total: (workSql().heldInCount.get(among) as { total: number }).total,
      }
    },

    pieceItWasStartedWith(conversation, unread) {
      const row = selectFirstReceived.get({
        conversation,
        generation: activeGeneration(conversation),
      }) as { payload: string | null; ordinal: number } | undefined
      if (row === undefined) return null
      const turn: unknown = row.payload === null ? null : JSON.parse(row.payload)
      if (typeof turn !== 'object' || turn === null) {
        noteUnreadRow(conversation, row.ordinal, unread?.in(conversation))
        return null
      }
      const first = theMessagesOf(turn as UserTurnEvent)[0]
      return typeof first?.piece === 'string' ? first.piece : null
    },
  }
  return { methods, selectLastClosedTurn, MAIN_THREAD_WORDS, receivedOn }
}
