import type { Provider } from '@brobot2/shared'
import { NONE_STARTED, type StartedOn } from '../../../shared/agent-roster'
import type {
  InstructionProposedEvent,
  InstructionSettledEvent,
  McpServerRequestedEvent,
  McpServerRequestSettledEvent,
} from '../../../shared/conversation-events'
import {
  externalMcpGrantRowId,
  type ExternalMcpServerRow,
  externalMcpServerRowId,
  foldExternalMcpReach,
} from '../../../shared/external-mcp'
import {
  mcpServerRequestsWaiting,
  type McpServerRequestWaiting,
} from '../../../shared/mcp-server-requests'
import { sameModel } from '../../../shared/model-choice'
import type { ModelAndEffort } from '../../../shared/model-choice-contracts'
import {
  type InstructionAskWaiting,
  type InstructionEnding,
  waitingOnAPerson,
} from '../../../shared/own-instructions'
import type {
  AgentIdentity,
  AgentIdentityName,
  IdentityCreator,
  NewAgent,
} from '../../../shared/runtime-ipc'
import type { ActedBy } from '../../../shared/who-did-it'
import { workerRegistrationOf } from '../../worker-registration'
import { createAgentKnowledgeHistory } from '../agent-knowledge-history'
import type { AppDatabase, AppStatement } from '../connection'
import { FOLD_TERM } from '../fold-index'
import { agentIdentityRowId, foldProfileName, readIdentityCreator } from '../identity'
import { readInstructionAskers } from '../instruction-askers-read'
import { createMemoryRecoveryStore } from '../memory-recovery'
import { createMethodChangeStore } from '../method-changes'
import type { RowsUnread } from '../rows-unread'
import { noteUnreadRow } from '../stored-event-codec'
import { createWorkerRecordsRead } from '../worker-records-read'
import {
  modelChoiceWritten,
  parseModelChoice,
  parseProvider,
} from '../../database/sqlite/agents/model-choice-storage'
import type { SessionStore } from './session-store-contract'
import type { NewSessionRecord } from './session-store-rows'
import { parseStrings, theFoldIndexHolds } from './store-helpers'
import type { createTurnReadsPart } from './turn-reads'
import type { createWorkStatementsPart } from './work-statements'
import type { createLedgerEventsPart } from './ledger-events'

type FromTurnReads = Pick<
  ReturnType<typeof createTurnReadsPart>,
  'activeGeneration' | 'appendTx' | 'selectMaxOrdinal' | 'selectOne' | 'selectRoutedRequestEvents'
>

type FromWorkStatements = Pick<
  ReturnType<typeof createWorkStatementsPart>,
  | 'identityRowFor'
  | 'launchSql'
  | 'nameForANewIdentity'
  | 'openRoot'
  | 'spawnSql'
  | 'writeIdentityRow'
>

type FromLedgerEvents = Pick<
  ReturnType<typeof createLedgerEventsPart>,
  'selectSubAgentReported' | 'selectWorkflowAgentTask' | 'selectWorkflowOutput'
>

interface AgentIdentitiesPartDeps extends FromTurnReads, FromWorkStatements, FromLedgerEvents {
  readonly db: AppDatabase
  readonly now: () => number
  readonly memoryRecoveryStore: ReturnType<typeof createMemoryRecoveryStore>
  readonly methodChangeStore: ReturnType<typeof createMethodChangeStore>
}

type AgentIdentitiesMethods = Pick<
  SessionStore,
  | 'canReadFreshSnapshot'
  | 'create'
  | 'connectionOf'
  | 'firstLaunchOf'
  | 'aLaunchWentUnnamed'
  | 'identityOf'
  | 'agentIdentityOf'
  | 'ownInstructionsOf'
  | 'currentOwnInstructionsOf'
  | 'readCurrentAgentRules'
  | 'configuredLayerFor'
  | 'writeDirectAgentRules'
  | 'writeOwnInstructions'
  | 'undoOwnInstructions'
  | 'instructionUnread'
  | 'markInstructionsSeen'
  | 'beginMethodChange'
  | 'settleMethodChange'
  | 'hasPendingMethodChange'
  | 'methodChange'
  | 'methodChanges'
  | 'memoryAmendmentsOf'
  | 'writeMemoryAmendment'
  | 'beginMemoryAmendment'
  | 'settleMemoryAmendment'
  | 'hasPendingMemoryAmendment'
  | 'memoryAmendment'
  | 'instructionAskersAmong'
  | 'instructionAsksWaiting'
  | 'settleInstructionAsk'
  | 'mcpServerRequestsWaiting'
  | 'mcpServerRequestWasMade'
  | 'agentIdentityNameById'
  | 'agentIdentities'
  | 'agentIdentityPage'
  | 'reconciliationNames'
  | 'createAgentIdentity'
  | 'providerOf'
  | 'startedOnOf'
  | 'saveProviderIfNoneIsSaved'
  | 'setAgentProvider'
  | 'setAgentDisplayName'
  | 'renameAgentDisplayName'
  | 'modelChoiceOf'
  | 'setModelChoice'
  | 'handAddedModels'
  | 'addHandAddedModel'
  | 'deleteHandAddedModel'
  | 'lastPicked'
  | 'hasSealedApiKey'
  | 'forgetSealedApiKey'
  | 'aPersonPicked'
  | 'conversationsPerIdentity'
  | 'removeAgentIdentity'
  | 'externalMcpServers'
  | 'registerExternalMcpServer'
  | 'removeExternalMcpServer'
  | 'externalMcpServersFor'
  | 'grantExternalMcpServer'
  | 'setExternalMcpServers'
  | 'defaultApprovalModeChosen'
  | 'defaultApprovalMode'
  | 'setDefaultApprovalMode'
>

export function createAgentIdentitiesPart(deps: AgentIdentitiesPartDeps) {
  const {
    db,
    now,
    memoryRecoveryStore,
    methodChangeStore,
    activeGeneration,
    appendTx,
    identityRowFor,
    launchSql,
    nameForANewIdentity,
    openRoot,
    selectMaxOrdinal,
    selectOne,
    selectRoutedRequestEvents,
    selectSubAgentReported,
    selectWorkflowAgentTask,
    selectWorkflowOutput,
    spawnSql,
    writeIdentityRow,
  } = deps
  let reconciliationNames: AppStatement | undefined
  const insertSession = db.prepare(
    `INSERT INTO provider_session (id, provider, cwd, status, approval_mode, profile_id, reasoning_effort, model, plan_mode, connection_id, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const readConnection = db.prepare(
    'SELECT connection_id, provider, external_ref FROM provider_session WHERE id = ?',
  )
  const blankToNull = (value: string | null | undefined): string | null => {
    if (value === null || value === undefined) return null
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  let modelListStatements: { read: AppStatement; write: AppStatement } | null = null
  const modelListSql = (): NonNullable<typeof modelListStatements> =>
    (modelListStatements ??= {
      read: db.prepare(
        `SELECT hand_added, last_model, last_effort FROM provider_model_setting WHERE provider = ?`,
      ),
      write: db.prepare(
        `INSERT INTO provider_model_setting (provider, hand_added, last_model, last_effort, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET
           hand_added = excluded.hand_added, last_model = excluded.last_model,
           last_effort = excluded.last_effort, updated_at = excluded.updated_at`,
      ),
    })
  interface APersonsList {
    readonly handAdded: readonly string[]
    readonly lastPicked: ModelAndEffort | null
  }
  const modelListOf = (provider: Provider): APersonsList => {
    const row = modelListSql().read.get(provider) as
      | {
          hand_added: string | null
          last_model: string | null
          last_effort: string | null
        }
      | undefined
    if (row === undefined) return { handAdded: [], lastPicked: null }
    const lastModel = blankToNull(row.last_model)
    return {
      handAdded: parseStrings(row.hand_added),
      lastPicked:
        lastModel === null ? null : { model: lastModel, effort: blankToNull(row.last_effort) },
    }
  }
  const writeTheList = db.transaction(
    (
      provider: Provider,
      change: (held: APersonsList) => APersonsList,
      at: number,
    ): APersonsList => {
      const next = change(modelListOf(provider))
      modelListSql().write.run(
        provider,
        next.handAdded.length === 0 ? null : JSON.stringify(next.handAdded),
        next.lastPicked?.model ?? null,
        next.lastPicked?.effort ?? null,
        at,
      )
      return next
    },
  )
  let externalMcpStatements: {
    listServers: AppStatement
    serverByName: AppStatement
    serverById: AppStatement
    insertServer: AppStatement
    deleteServer: AppStatement
    grantsOf: AppStatement
    serversUsableBy: AppStatement
    insertGrant: AppStatement
    clearGrantsOf: AppStatement
  } | null = null
  const externalMcpSql = (): NonNullable<typeof externalMcpStatements> =>
    (externalMcpStatements ??= {
      listServers: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server ORDER BY registered_at, name`,
      ),
      serverByName: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server WHERE name = ?`,
      ),
      serverById: db.prepare(
        `SELECT id, name, url, registered_at, reach FROM external_mcp_server WHERE id = ?`,
      ),
      insertServer: db.prepare(
        `INSERT OR IGNORE INTO external_mcp_server (id, name, url, registered_at, reach)
         VALUES (?, ?, ?, ?, ?)`,
      ),
      deleteServer: db.prepare(`DELETE FROM external_mcp_server WHERE id = ?`),
      /** Which servers one identity is granted, as ids — what a surface ticks its boxes from. */
      grantsOf: db.prepare(
        `SELECT server_id FROM external_mcp_server_grant WHERE identity_id = ? ORDER BY server_id`,
      ),
      serversUsableBy: db.prepare(
        `SELECT s.id, s.name, s.url, s.registered_at, s.reach
           FROM external_mcp_server s
          WHERE s.reach = 'everyone'
             OR EXISTS (SELECT 1 FROM external_mcp_server_grant g
                         WHERE g.server_id = s.id AND g.identity_id = ?)
          ORDER BY s.registered_at, s.name`,
      ),
      insertGrant: db.prepare(
        `INSERT OR IGNORE INTO external_mcp_server_grant (id, identity_id, server_id, granted_at)
         VALUES (?, ?, ?, ?)`,
      ),
      clearGrantsOf: db.prepare(`DELETE FROM external_mcp_server_grant WHERE identity_id = ?`),
    })

  const knowledgeHistory = createAgentKnowledgeHistory(
    db,
    memoryRecoveryStore,
    () => spawnSql().identityBySlug,
    () => spawnSql().identityNameById,
  )

  /** One `external_mcp_server` row as `better-sqlite3` hands it back. */
  type ExternalMcpRow = {
    id: string
    name: string
    url: string
    registered_at: number
    reach: unknown
  }

  const externalMcpFrom = (row: ExternalMcpRow): ExternalMcpServerRow => ({
    id: row.id,
    name: row.name,
    url: row.url,
    registeredAt: row.registered_at,
    reach: foldExternalMcpReach(row.reach),
  })

  /** The server ids one identity holds, by row id — used by the reader and by the save. */
  const grantedServerIds = (identityRowId: string): string[] =>
    (externalMcpSql().grantsOf.all(identityRowId) as { server_id: string }[]).map(
      (row) => row.server_id,
    )

  type IdentityRow = {
    id: string
    slug: string
    display_name: string | null
    provider: string | null
    created_at: number
    created_by: string | null
  }

  const identityFrom = (row: IdentityRow): AgentIdentity => {
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      createdAt: row.created_at,
      createdBy: readIdentityCreator(row.created_by),
      provider: parseProvider(row.provider),
      externalMcpServerIds: grantedServerIds(row.id),
    }
  }

  const writeAgentDisplayName = (id: string, displayName: string | null): boolean =>
    spawnSql().writeDisplayName.run(blankToNull(displayName), id).changes > 0

  const setAgentProviderTx = db.transaction(
    (profileSlug: string, provider: Provider | null): boolean => {
      const rowId = agentIdentityRowId(profileSlug)
      if (spawnSql().writeProvider.run(provider, rowId).changes === 0) return false
      if (provider === null) return true
      const held = spawnSql().readModelChoice.get(foldProfileName(profileSlug)) as
        { model_choice: string | null } | undefined
      const choice = held === undefined ? null : parseModelChoice(held.model_choice)
      if (choice !== null && choice.provider !== provider) {
        spawnSql().writeModelChoice.run(null, rowId)
      }
      return true
    },
  )

  const saveProviderIfNoneIsSavedTx = db.transaction(
    (profileSlug: string, provider: Provider): boolean => {
      const row = spawnSql().identityBySlug.get(foldProfileName(profileSlug)) as
        IdentityRow | undefined
      if (row === undefined || parseProvider(row.provider) !== null) return false
      return spawnSql().writeProvider.run(provider, row.id).changes > 0
    },
  )

  const createAgentIdentityTx = db.transaction(
    (
      said: NewAgent,
      at: number,
      broughtIntoBeingBy: IdentityCreator | null,
    ): AgentIdentity | null => {
      const slug = foldProfileName(said.slug)
      if (spawnSql().identityBySlug.get(slug) !== undefined) return null
      writeIdentityRow(
        slug,
        at,
        {
          displayName: blankToNull(said.displayName) ?? nameForANewIdentity(slug),
          provider: said.provider,
        },
        broughtIntoBeingBy,
      )
      return identityFrom(spawnSql().identityBySlug.get(slug) as IdentityRow)
    },
  )

  const selectNewestTurnsOpened = db.prepare(
    `SELECT CASE WHEN json_valid(payload) THEN payload END AS payload, created_at AS at
       FROM events INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ? AND type = 'user_turn'
      ORDER BY ordinal DESC LIMIT ?`,
  )
  theFoldIndexHolds(selectNewestTurnsOpened)
  const selectPieceEvents = db.prepare(
    `SELECT ordinal,
            CASE WHEN json_valid(payload) THEN
                   CASE WHEN type IN ('user_turn', 'message_queued', 'message_unqueued')
                             AND json_extract(payload, '$.type') = type
                        THEN json_remove(payload, '$.sent', '$.given', '$.text')
                        ELSE json_remove(payload, '$.sent', '$.given') END
                 ELSE payload END AS payload,
            created_at FROM events
        INDEXED BY events_fold_idx
      WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
        AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',
                     'work_status_set', 'work_rebriefed', 'work_closed', 'message_unqueued',
                     'user_decision', 'reopened', 'reply_undelivered', 'message_queued',
                     'replaced_by', 'work_restarted', 'request_routed', 'request_stranded',
                     'user_turn', 'turn', 'status', 'work_interrupted', 'background_work',
                     'scheduled_work')
        AND ordinal >= ? AND ordinal < ?
      ORDER BY ordinal`,
  )
  const selectInstructionAsks = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal,
            -- D-017 · R8: which rows are torn, so the reader skips them and says so.
            json_valid(payload) AS readable, payload
       FROM events
      WHERE type IN ('instruction_proposed', 'instruction_settled')
      ORDER BY created_at, session_id, ordinal`,
  )
  const selectMcpServerRequests = db.prepare(
    `SELECT session_id AS conversation, created_at AS at, ordinal,
            json_valid(payload) AS readable, payload
       FROM events
      WHERE type IN ('mcp_server_requested', 'mcp_server_request_settled')
      ORDER BY created_at, session_id, ordinal`,
  )
  const { workersBorn, workerGiverContains, workerInItsPlace, workerReplacementChain } =
    createWorkerRecordsRead(db, selectOne)

  type PendingProposalLedgerRow = {
    conversation: string
    at: number
    ordinal: number
    readable: number
    payload: string
  }

  function decodeProposalRows<Event extends object>(
    rows: readonly PendingProposalLedgerRow[],
    id: keyof Event,
    missingId: string,
    unread: RowsUnread | undefined,
  ): { conversation: string; at: number; event: Event }[] {
    return rows.flatMap((row) => {
      if (row.readable === 0) {
        noteUnreadRow(row.conversation, row.ordinal, unread?.in(row.conversation))
        return []
      }
      try {
        const event = JSON.parse(row.payload) as Event | null
        if (event === null || typeof event[id] !== 'string') throw new Error(missingId)
        return [{ conversation: row.conversation, at: row.at, event }]
      } catch (error) {
        console.warn(
          `session ledger: ${row.conversation} ordinal ${String(row.ordinal)} could not be read ` +
            `and was skipped (${error instanceof Error ? error.message : String(error)})`,
        )
        unread?.in(row.conversation)(row.ordinal)
        return []
      }
    })
  }

  const instructionAsksWaiting = (unread?: RowsUnread): readonly InstructionAskWaiting[] =>
    waitingOnAPerson(
      decodeProposalRows<InstructionProposedEvent | InstructionSettledEvent>(
        selectInstructionAsks.all() as PendingProposalLedgerRow[],
        'askId',
        'an instruction row with no ask id',
        unread,
      ),
    )

  const settleInstructionAskTx = db.transaction(
    (askId: string, ending: InstructionEnding, by: ActedBy, at: number): boolean => {
      const waiting = instructionAsksWaiting().find((one) => one.asked.askId === askId)
      if (waiting === undefined) return false
      const generation = activeGeneration(waiting.conversation)
      const highest = selectMaxOrdinal.get(waiting.conversation, generation) as
        { max_ordinal: number | null } | undefined
      appendTx(
        waiting.conversation,
        (highest?.max_ordinal ?? -1) + 1,
        { type: 'instruction_settled', askId, ending, by },
        at,
        generation,
        true,
      )
      return true
    },
  )

  /** Every MCP server request still waiting: {@link instructionAsksWaiting}'s read, for requests. */
  const mcpServerRequestsWaitingNow = (unread?: RowsUnread): readonly McpServerRequestWaiting[] =>
    mcpServerRequestsWaiting(
      decodeProposalRows<McpServerRequestedEvent | McpServerRequestSettledEvent>(
        selectMcpServerRequests.all() as PendingProposalLedgerRow[],
        'requestId',
        'an MCP server request row with no request id',
        unread,
      ),
    )

  /** Whether any readable row is the request by this id, waiting or settled. */
  const mcpServerRequestWasMade = (requestId: string): boolean =>
    (selectMcpServerRequests.all() as { readable: number; payload: string }[]).some((row) => {
      if (row.readable === 0) return false
      try {
        const event = JSON.parse(row.payload) as { type?: unknown; requestId?: unknown } | null
        return event?.type === 'mcp_server_requested' && event.requestId === requestId
      } catch {
        return false
      }
    })

  const writeAFirstLaunch = db.prepare(
    `UPDATE provider_session SET reasoning_effort = ?, model = ?, plan_mode = ?, connection_id = COALESCE(connection_id, ?), updated_at = ?
      WHERE id = ? AND external_ref IS NULL`,
  )
  const selectALaunchUnnamed = db.prepare(
    `SELECT 1 FROM provider_session
      WHERE id = ? AND external_ref IS NULL AND launched_as IS NOT NULL`,
  )
  const connectionBelongsToProvider = db.prepare(
    'SELECT 1 FROM provider_connection WHERE id = ? AND provider = ?',
  )
  function assertConnectionProvider(provider: Provider, connectionId: string): void {
    if (!connectionBelongsToProvider.get(connectionId, provider))
      throw new Error('The selected connection is unavailable')
  }
  const firstLaunchTx = db.transaction(
    (
      record: Pick<
        NewSessionRecord,
        'id' | 'model' | 'reasoningEffort' | 'planMode' | 'launchedAs' | 'connectionId'
      >,
      at: number,
    ): boolean => {
      const prior = readConnection.get(record.id) as
        | {
            connection_id: string | null
            provider: Provider
            external_ref: string | null
          }
        | undefined
      if (!prior || prior.external_ref !== null) return false
      if (record.connectionId !== undefined) {
        if (prior.connection_id !== null && prior.connection_id !== record.connectionId)
          throw new Error('The recorded connection cannot be replaced')
        assertConnectionProvider(prior.provider, record.connectionId)
      }
      const wrote = writeAFirstLaunch.run(
        record.reasoningEffort ?? null,
        record.model ?? null,
        record.planMode === undefined ? null : record.planMode ? 1 : 0,
        record.connectionId ?? null,
        at,
        record.id,
      )
      if (wrote.changes === 0) return false
      if (record.launchedAs !== undefined) launchSql().write.run(record.launchedAs, record.id)
      return true
    },
  )

  const createTx = db.transaction((record: NewSessionRecord, at: number) => {
    if (record.connectionId !== undefined)
      assertConnectionProvider(record.provider, record.connectionId)
    const identityId = identityRowFor(record.profileId, at)
    if (record.worker !== undefined) {
      const fact = workerRegistrationOf({ type: 'worker_registered', ...record.worker })
      const identity = spawnSql().identityBySlug.get(foldProfileName(record.profileId)) as
        { created_at: number } | undefined
      if (
        fact === null ||
        fact.identity !== identityId ||
        fact.identityCreatedAt !== identity?.created_at ||
        record.parentSessionId === undefined ||
        record.service === true ||
        !workerGiverContains(fact.giver, record.parentSessionId)
      ) {
        throw new Error('worker registration does not match the new conversation')
      }
      if (
        workersBorn().some(
          (one) =>
            one.identity === fact.identity &&
            one.giver === fact.giver &&
            one.number === fact.number,
        )
      ) {
        throw new Error('worker number is already registered')
      }
    }
    insertSession.run(
      record.id,
      record.provider,
      record.cwd,
      record.approvalMode,
      record.profileId,
      record.reasoningEffort ?? null,
      record.model ?? null,
      record.planMode === undefined ? null : record.planMode ? 1 : 0,
      record.connectionId ?? null,
      at,
      at,
    )
    spawnSql().writeIdentityOnSession.run(identityId, record.id)
    if (record.launchedAs !== undefined) launchSql().write.run(record.launchedAs, record.id)
    if (record.parentSessionId !== undefined) {
      if (record.service === true) throw new Error('a service is started by no conversation')
      spawnSql().writeParent.run(record.parentSessionId, record.id)
    } else if (record.serviceStandingTitle !== undefined) {
      const identity = spawnSql().identityBySlug.get(foldProfileName(record.profileId)) as
        { created_at: number } | undefined
      if (record.service !== true || identity === undefined)
        throw new Error('service registration does not match the new conversation')
      openRoot(record.id, at, record.serviceStandingTitle)
      appendTx(
        record.id,
        0,
        {
          type: 'service_registered',
          identity: identityId,
          identityCreatedAt: identity.created_at,
        },
        at,
        0,
        true,
      )
    } else if (record.service !== true) {
      openRoot(record.id, at)
    }
    if (record.worker !== undefined) {
      appendTx(record.id, 0, { type: 'worker_registered', ...record.worker }, at, 0, true)
    }
  })

  const methods: AgentIdentitiesMethods & ThisType<SessionStore> = {
    canReadFreshSnapshot() {
      return (
        selectPieceEvents.busy === false &&
        selectRoutedRequestEvents.busy === false &&
        selectWorkflowOutput.busy === false &&
        selectWorkflowAgentTask.busy === false &&
        selectSubAgentReported.busy === false &&
        selectNewestTurnsOpened.busy === false
      )
    },
    create(record) {
      createTx(record, now())
    },
    connectionOf(sessionId) {
      const row = readConnection.get(sessionId) as { connection_id: string | null } | undefined
      return row?.connection_id ?? null
    },
    firstLaunchOf(record) {
      return firstLaunchTx(record, now())
    },
    aLaunchWentUnnamed(sessionId) {
      return selectALaunchUnnamed.get(sessionId) !== undefined
    },

    identityOf(sessionId) {
      const row = spawnSql().identityOfSession.get(sessionId) as
        { profile_slug: string } | undefined
      return row === undefined ? null : { profileSlug: row.profile_slug }
    },

    agentIdentityOf(profileSlug) {
      const row = spawnSql().identityBySlug.get(foldProfileName(profileSlug)) as
        IdentityRow | undefined
      return row === undefined ? null : identityFrom(row)
    },

    ownInstructionsOf: knowledgeHistory.ownInstructionsOf,
    currentOwnInstructionsOf: knowledgeHistory.currentOwnInstructionsOf,
    readCurrentAgentRules: knowledgeHistory.readCurrentAgentRules,
    configuredLayerFor: knowledgeHistory.configuredLayerFor,
    writeDirectAgentRules(said, at, afterCommit) {
      return knowledgeHistory.writeDirectAgentRules(this, said, at, afterCommit)
    },

    writeOwnInstructions(said, at) {
      return knowledgeHistory.writeOwnInstructions(this, said, at)
    },
    undoOwnInstructions(profileSlug, expectedVersion, by, at) {
      return knowledgeHistory.undoOwnInstructions(this, profileSlug, expectedVersion, by, at)
    },
    instructionUnread: knowledgeHistory.instructionUnread,
    markInstructionsSeen: knowledgeHistory.markInstructionsSeen,

    beginMethodChange(profileSlug, said, by, at) {
      return methodChangeStore.begin(agentIdentityRowId(foldProfileName(profileSlug)), said, by, at)
    },
    settleMethodChange(profileSlug, id, outcome, actual, by) {
      return methodChangeStore.settle(
        agentIdentityRowId(foldProfileName(profileSlug)),
        id,
        outcome,
        actual,
        by,
      )
    },
    hasPendingMethodChange(profileSlug) {
      return methodChangeStore.hasPending(agentIdentityRowId(foldProfileName(profileSlug)))
    },
    methodChange(profileSlug, id) {
      return methodChangeStore.read(agentIdentityRowId(foldProfileName(profileSlug)), id)
    },
    methodChanges(profileSlug, offset = 0, limit = 50) {
      return methodChangeStore.list(agentIdentityRowId(foldProfileName(profileSlug)), offset, limit)
    },

    memoryAmendmentsOf: knowledgeHistory.memoryAmendmentsOf,
    writeMemoryAmendment: knowledgeHistory.writeMemoryAmendment,
    beginMemoryAmendment: knowledgeHistory.beginMemoryAmendment,
    settleMemoryAmendment: knowledgeHistory.settleMemoryAmendment,
    hasPendingMemoryAmendment: knowledgeHistory.hasPendingMemoryAmendment,
    memoryAmendment: knowledgeHistory.memoryAmendment,

    instructionAskersAmong(owners, unread) {
      return readInstructionAskers(db, owners, (owner, ordinal) =>
        noteUnreadRow(owner, ordinal, unread.in(owner)),
      )
    },
    instructionAsksWaiting(unread) {
      return instructionAsksWaiting(unread)
    },

    settleInstructionAsk(askId, ending, by, at) {
      return settleInstructionAskTx(askId, ending, by, at)
    },

    mcpServerRequestsWaiting(unread) {
      return mcpServerRequestsWaitingNow(unread)
    },

    mcpServerRequestWasMade(requestId) {
      return mcpServerRequestWasMade(requestId)
    },

    agentIdentityNameById(id) {
      return (spawnSql().identityNameById.get(id) as AgentIdentityName | undefined) ?? null
    },
    agentIdentities() {
      return (spawnSql().listIdentities.all() as IdentityRow[]).map(identityFrom)
    },
    agentIdentityPage(after, limit) {
      const sql = spawnSql()
      return db.transaction(() => ({
        identities: sql.identityPage.all(after, limit) as Pick<
          AgentIdentity,
          'id' | 'slug' | 'displayName' | 'createdAt'
        >[],
        count: (sql.countIdentities.get() as { count: number }).count,
      }))()
    },
    reconciliationNames(conversations) {
      if (conversations.length === 0) return []
      reconciliationNames ??= db.prepare(
        `SELECT s.id AS conversation, identity.id, identity.slug,
                identity.display_name AS displayName
           FROM provider_session s
           JOIN agent_identity identity ON identity.id = s.agent_identity_id
          WHERE s.id IN (SELECT value FROM json_each(?))`,
      )
      return reconciliationNames.all(JSON.stringify(conversations)) as (AgentIdentityName & {
        conversation: string
      })[]
    },
    createAgentIdentity(said, broughtIntoBeingBy) {
      return createAgentIdentityTx(said, now(), broughtIntoBeingBy)
    },
    providerOf(profileSlug) {
      const row = spawnSql().identityBySlug.get(foldProfileName(profileSlug)) as
        IdentityRow | undefined
      return row === undefined ? null : parseProvider(row.provider)
    },

    startedOnOf(profileSlug) {
      const rows = spawnSql().startedOnOf.all(agentIdentityRowId(profileSlug)) as {
        provider: string
        started: number
      }[]
      return rows.reduce<StartedOn>((on, row) => {
        const provider = parseProvider(row.provider)
        return provider === null ? on : { ...on, [provider]: on[provider] + row.started }
      }, NONE_STARTED)
    },

    saveProviderIfNoneIsSaved(profileSlug, provider) {
      return saveProviderIfNoneIsSavedTx(profileSlug, provider)
    },

    setAgentProvider(profileSlug, provider) {
      return setAgentProviderTx(profileSlug, provider)
    },

    setAgentDisplayName(profileSlug, displayName) {
      return writeAgentDisplayName(agentIdentityRowId(profileSlug), displayName)
    },

    async renameAgentDisplayName(profileSlug, displayName) {
      const id = agentIdentityRowId(profileSlug)
      return this.atomically(() => {
        if (!writeAgentDisplayName(id, displayName)) return null
        const row = spawnSql().identityById.get(id) as IdentityRow | undefined
        return row === undefined ? null : identityFrom(row)
      })
    },

    modelChoiceOf(profileSlug) {
      const row = spawnSql().readModelChoice.get(foldProfileName(profileSlug)) as
        { model_choice: string | null } | undefined
      return row === undefined ? null : parseModelChoice(row.model_choice)
    },

    setModelChoice(profileSlug, choice) {
      return (
        spawnSql().writeModelChoice.run(modelChoiceWritten(choice), agentIdentityRowId(profileSlug))
          .changes > 0
      )
    },

    handAddedModels(provider) {
      return modelListOf(provider).handAdded
    },
    addHandAddedModel(provider, model, at) {
      return writeTheList(
        provider,
        (held) => ({
          ...held,
          handAdded: held.handAdded.some((one) => sameModel(one, model))
            ? held.handAdded
            : [...held.handAdded, model],
        }),
        at,
      ).handAdded
    },
    deleteHandAddedModel(provider, model, at) {
      return writeTheList(
        provider,
        (held) => ({ ...held, handAdded: held.handAdded.filter((one) => one !== model) }),
        at,
      ).handAdded
    },
    lastPicked(provider) {
      return modelListOf(provider).lastPicked
    },
    hasSealedApiKey(provider) {
      return (
        db.prepare('SELECT 1 FROM provider_api_key WHERE provider = ?').get(provider) !== undefined
      )
    },
    forgetSealedApiKey(provider) {
      db.prepare('DELETE FROM provider_api_key WHERE provider = ?').run(provider)
    },
    aPersonPicked(provider, pair, at) {
      writeTheList(provider, (held) => ({ ...held, lastPicked: pair }), at)
    },

    conversationsPerIdentity() {
      const rows = spawnSql().conversationsPerIdentity.all() as {
        identity: string
        provider: string
        conversations: number
        started: number
      }[]
      const byIdentity = new Map<string, { conversations: number; startedOn: StartedOn }>()
      for (const row of rows) {
        const was = byIdentity.get(row.identity) ?? { conversations: 0, startedOn: NONE_STARTED }
        const provider = parseProvider(row.provider)
        byIdentity.set(row.identity, {
          conversations: was.conversations + row.conversations,
          startedOn:
            provider === null
              ? was.startedOn
              : { ...was.startedOn, [provider]: was.startedOn[provider] + row.started },
        })
      }
      return [...byIdentity].map(([identityId, one]) => ({ identityId, ...one }))
    },

    removeAgentIdentity(profileSlug) {
      return db.transaction(() => {
        const rowId = agentIdentityRowId(profileSlug)
        if (methodChangeStore.hasPending(rowId) || memoryRecoveryStore.hasPending(rowId))
          return false
        return spawnSql().deleteIdentity.run(rowId).changes > 0
      })()
    },

    externalMcpServers() {
      return (externalMcpSql().listServers.all() as ExternalMcpRow[]).map(externalMcpFrom)
    },

    registerExternalMcpServer(said) {
      const name = foldProfileName(said.name)
      const id = externalMcpServerRowId(name)
      const wrote =
        externalMcpSql().insertServer.run(
          id,
          name,
          said.url,
          now(),
          foldExternalMcpReach(said.reach),
        ).changes > 0
      if (!wrote) return null
      const row = externalMcpSql().serverByName.get(name) as ExternalMcpRow | undefined
      return row === undefined ? null : externalMcpFrom(row)
    },

    removeExternalMcpServer(serverId) {
      return externalMcpSql().deleteServer.run(serverId).changes > 0
    },

    externalMcpServersFor(profileSlug) {
      return (
        externalMcpSql().serversUsableBy.all(agentIdentityRowId(profileSlug)) as ExternalMcpRow[]
      ).map(externalMcpFrom)
    },

    grantExternalMcpServer(serverName, profileSlugs) {
      return db.transaction(() => {
        const server = externalMcpSql().serverByName.get(foldProfileName(serverName)) as
          ExternalMcpRow | undefined
        if (server === undefined) return null
        const granted: string[] = []
        const missing: string[] = []
        const at = now()
        for (const slug of new Set(profileSlugs.map((one) => foldProfileName(one)))) {
          if (spawnSql().identityBySlug.get(slug) === undefined) {
            missing.push(slug)
            continue
          }
          externalMcpSql().insertGrant.run(
            externalMcpGrantRowId(slug, server.name),
            agentIdentityRowId(slug),
            server.id,
            at,
          )
          granted.push(slug)
        }
        return { granted, missing }
      })()
    },

    setExternalMcpServers(profileSlug, externalMcpServerIds) {
      const rowId = agentIdentityRowId(profileSlug)
      if (spawnSql().identityBySlug.get(foldProfileName(profileSlug)) === undefined) return false
      db.transaction(() => {
        externalMcpSql().clearGrantsOf.run(rowId)
        const at = now()
        for (const serverId of new Set(externalMcpServerIds)) {
          const row = externalMcpSql().serverById.get(serverId) as ExternalMcpRow | undefined
          if (row === undefined) continue
          externalMcpSql().insertGrant.run(
            externalMcpGrantRowId(profileSlug, row.name),
            rowId,
            row.id,
            at,
          )
        }
      })()
      return true
    },

    defaultApprovalModeChosen() {
      const row = spawnSql().readApprovalDefault.get() as
        { default_approval_mode: string | null } | undefined
      return row?.default_approval_mode === 'ask' || row?.default_approval_mode === 'auto'
    },

    defaultApprovalMode() {
      const row = spawnSql().readApprovalDefault.get() as
        { default_approval_mode: string | null } | undefined
      return row?.default_approval_mode === 'auto' ? 'auto' : 'ask'
    },

    setDefaultApprovalMode(mode) {
      spawnSql().writeApprovalDefault.run(mode)
    },
  }
  return {
    methods,
    selectNewestTurnsOpened,
    selectPieceEvents,
    workersBorn,
    workerGiverContains,
    workerInItsPlace,
    workerReplacementChain,
  }
}
