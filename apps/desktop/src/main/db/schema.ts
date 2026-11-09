import { sql, type SQL } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'
import {
  CAPABILITY_FIELDS,
  MAX_CAPABILITY_COUNT,
  type AnyCapabilityField,
} from '../../shared/capabilities'
import { RESOURCE_ROLES } from '../../shared/documents'
import { FOLD_TYPE_LIST } from './fold-index'
import { HUMAN_CONTEXT_TERM, HUMAN_FINAL_TERM } from './human-answer-index'

/** A SQL list of string literals, e.g. `'none', 'any'` — for a CHECK over a closed vocabulary. */
function oneOf(words: readonly string[]): SQL {
  return sql.raw(words.map((word) => `'${word.replaceAll("'", "''")}'`).join(', '))
}

function capabilityCheck(field: AnyCapabilityField, column: AnySQLiteColumn): SQL {
  switch (field.editor) {
    case 'count':
      return sql`${column} IS NULL OR (typeof(${column}) = 'integer' AND ${column} BETWEEN 0 AND ${sql.raw(String(MAX_CAPABILITY_COUNT))})`
    case 'choice':
      if (field.vocabulary === undefined || field.vocabulary.length === 0) {
        throw new Error(`capability ${field.key} is a choice with no vocabulary`)
      }
      return sql`${column} IS NULL OR ${column} IN (${oneOf(field.vocabulary)})`
  }
}

export const agentIdentity = sqliteTable(
  'agent_identity',
  {
    /** `aid:<folded slug>` — derived. See the table comment. */
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    displayName: text('display_name'),
    maxDepth: integer('max_depth'),
    canMessage: text('can_message'),
    canAssignWork: text('can_assign_work'),
    canCreateAgents: text('can_create_agents'),
    canWriteRules: text('can_write_rules'),
    provider: text('provider'),
    /** Null retains the legacy dynamic provider/key selection for future starts. */
    connectionId: text('connection_id').references(() => providerConnection.id),
    modelChoice: text('model_choice'),
    createdBy: text('created_by'),
    /** When this identity first existed. */
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('agent_identity_slug_uq').on(sql`${t.slug} COLLATE NOCASE`),
    check('agent_identity_slug_folded_ck', sql`${t.slug} = lower(${t.slug})`),
    ...CAPABILITY_FIELDS.map((field) =>
      check(`agent_identity_${field.column}_ck`, capabilityCheck(field, t[field.key])),
    ),
  ],
)

export const externalMcpServer = sqliteTable(
  'external_mcp_server',
  {
    /** `ems:<folded name>` — derived. See {@link agentIdentity.id} for why nothing here is generated. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** When a person added it — durable audit, and the order the registry is drawn in. */
    registeredAt: integer('registered_at').notNull(),
    reach: text('reach').notNull().default('everyone'),
  },
  (t) => [
    uniqueIndex('external_mcp_server_name_uq').on(sql`${t.name} COLLATE NOCASE`),
    check('external_mcp_server_name_folded_ck', sql`${t.name} = lower(${t.name})`),
  ],
)

export const externalMcpServerGrant = sqliteTable(
  'external_mcp_server_grant',
  {
    /** `emg:<folded identity slug>:<folded server name>` — derived, like every id in this schema. */
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => externalMcpServer.id, { onDelete: 'cascade' }),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => [
    uniqueIndex('external_mcp_server_grant_uq').on(t.identityId, t.serverId),
    index('external_mcp_server_grant_identity_idx').on(t.identityId),
  ],
)

export const appPolicy = sqliteTable(
  'app_policy',
  {
    /** Always the literal `policy` — see the CHECK below, which is what enforces it. */
    id: text('id').primaryKey(),
    spawningEnabled: integer('spawning_enabled').notNull().default(1),
    defaultApprovalMode: text('default_approval_mode'),
    /** When the switch was last thrown, so a person can tell a fresh install from a decision. */
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [check('app_policy_singleton_ck', sql`${t.id} = 'policy'`)],
)

export const providerModelSetting = sqliteTable('provider_model_setting', {
  /** The provider these facts are about — `claude` or `codex`. */
  provider: text('provider').primaryKey(),
  handAdded: text('hand_added'),
  lastModel: text('last_model'),
  /** Its effort — NULL beside a model, when that model offers none. */
  lastEffort: text('last_effort'),
  updatedAt: integer('updated_at').notNull(),
})

export const providerApiKey = sqliteTable('provider_api_key', {
  /** The provider the key is for — `claude` or `codex`. */
  provider: text('provider').primaryKey(),
  /** Keys earlier versions sealed with `safeStorage`. Nothing reads them: keys live in api-keys.json. */
  sealed: text('sealed').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** Connection metadata references existing credential services; no credential bytes live here. */
export const providerConnection = sqliteTable(
  'provider_connection',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    authMethod: text('auth_method').notNull(),
    credentialSource: text('credential_source').notNull(),
    baseUrl: text('base_url'),
    enabled: integer('enabled').notNull().default(1),
    contractVersion: integer('contract_version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('provider_connection_name_uq').on(t.provider, sql`${t.name} COLLATE NOCASE`),
    check('provider_connection_auth_ck', sql`${t.authMethod} IN ('sign-in', 'api-key')`),
    check(
      'provider_connection_source_ck',
      sql`(${t.authMethod} = 'sign-in' AND ${t.credentialSource} = 'provider-sign-in') OR (${t.authMethod} = 'api-key' AND ${t.credentialSource} = 'provider-api-key')`,
    ),
    check('provider_connection_enabled_ck', sql`${t.enabled} IN (0, 1)`),
    check('provider_connection_version_ck', sql`${t.contractVersion} = 1`),
  ],
)

export const providerSession = sqliteTable(
  'provider_session',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    /** Null preserves the original provider/profile binding on older conversations. */
    connectionId: text('connection_id').references(() => providerConnection.id),
    // Provider thread/session ref used to resume; unknown until the session starts.
    externalRef: text('external_ref'),
    launchedAs: text('launched_as'),
    cwd: text('cwd').notNull(),
    status: text('status').notNull().default('idle'),
    approvalMode: text('approval_mode'),
    profileId: text('profile_id'),
    reasoningEffort: text('reasoning_effort'),
    model: text('model'),
    planMode: integer('plan_mode', { mode: 'boolean' }),
    planEndedAt: integer('plan_ended_at'),
    modelOrEffortSetByAPersonAt: integer('model_or_effort_set_by_a_person_at'),
    reportedModel: text('reported_model'),
    reportedEffort: text('reported_effort'),
    adoptedAt: integer('adopted_at'),
    restoredAt: integer('restored_at'),
    childDescent: text('child_descent'),
    agentIdentityId: text('agent_identity_id').references(() => agentIdentity.id),
    parentSessionId: text('parent_session_id').references(
      (): AnySQLiteColumn => providerSession.id,
    ),
    closedByTheQuitAt: integer('closed_by_the_quit_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('provider_session_provider_ck', sql`${t.provider} in ('claude', 'codex')`),
    check(
      'provider_session_status_ck',
      sql`${t.status} in ('idle', 'working', 'waiting_permission', 'ended', 'errored')`,
    ),
    check(
      'provider_session_approval_mode_ck',
      sql`${t.approvalMode} is null or ${t.approvalMode} in ('ask', 'auto')`,
    ),
    index('provider_session_status_idx').on(t.status),
    index('provider_session_identity_idx').on(t.agentIdentityId),
    index('provider_session_parent_idx').on(t.parentSessionId),
    index('provider_session_parent_identity_idx').on(t.parentSessionId, t.agentIdentityId),
    index('provider_session_launched_as_idx').on(t.launchedAs),
  ],
)

export const turn = sqliteTable(
  'turn',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => providerSession.id, { onDelete: 'cascade' }),
    /** Nth turn in this session, from 0 — the same counting the ledger's ordinals use. */
    ordinal: integer('ordinal').notNull(),
    prompt: text('prompt').notNull(),
    openedAt: integer('opened_at').notNull(),
    /** Null while the turn is open. Moves together with {@link endReason}, by CHECK. */
    closedAt: integer('closed_at'),
    endReason: text('end_reason'),
    blockedAt: integer('blocked_at'),
    generation: integer('generation').notNull().default(0),
  },
  (t) => [
    uniqueIndex('turn_session_ordinal_uq').on(t.sessionId, t.generation, t.ordinal),
    index('turn_session_idx').on(t.sessionId),
    check(
      'turn_end_reason_ck',
      sql`${t.endReason} is null or ${t.endReason} in ('completed', 'failed', 'interrupted', 'ended', 'unknown')`,
    ),
    check('turn_closed_with_reason_ck', sql`(${t.closedAt} is null) = (${t.endReason} is null)`),
  ],
)

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => providerSession.id, { onDelete: 'cascade' }),
    // Per-session monotonic ordinal — preserves order for persist-before-publish.
    ordinal: integer('ordinal').notNull(),
    type: text('type').notNull(),
    // Normalized-event payload as JSON text; validated by zod in the runtime layer.
    payload: text('payload', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    turnId: text('turn_id').references(() => turn.id, { onDelete: 'set null' }),
    generation: integer('generation').notNull().default(0),
  },
  (t) => [
    uniqueIndex('events_session_ordinal_uq').on(t.sessionId, t.generation, t.ordinal),
    index('events_session_idx').on(t.sessionId),
    index('events_turn_idx').on(t.turnId),
    // Latest human prompt and its final remain two seeks after the history page moves past them.
    index('events_human_prompt_idx')
      .on(t.sessionId, t.generation, t.type, t.ordinal)
      .where(sql.raw(HUMAN_CONTEXT_TERM)),
    index('events_human_final_idx')
      .on(t.sessionId, t.generation, t.turnId, t.ordinal)
      .where(sql.raw(HUMAN_FINAL_TERM)),
    index('events_turn_opening_idx')
      .on(t.sessionId, t.generation, t.turnId, t.ordinal)
      .where(sql`${t.type} = 'user_turn'`),
    index('events_work_idx')
      .on(t.sessionId, t.ordinal)
      .where(
        sql`${t.type} IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled', 'work_status_set', 'work_rebriefed', 'work_closed')`,
      ),
    index('events_request_routed_idx')
      .on(t.sessionId, t.ordinal)
      .where(sql`${t.type} = 'request_routed'`),
    index('events_error_idx')
      .on(t.createdAt)
      .where(sql`${t.type} = 'error'`),
    index('events_instruction_ask_idx')
      .on(t.createdAt)
      .where(sql`${t.type} in ('instruction_proposed', 'instruction_settled')`),
    index('events_mcp_request_idx')
      .on(t.createdAt)
      .where(sql`${t.type} in ('mcp_server_requested', 'mcp_server_request_settled')`),
    index('events_provider_clear_idx')
      .on(t.createdAt)
      .where(sql`${t.type} = 'provider_limit_clear'`),
    index('events_fold_idx')
      .on(t.sessionId, t.generation, t.ordinal)
      .where(sql`${t.type} IN (${sql.raw(FOLD_TYPE_LIST)})`),
    index('events_inventory_idx')
      .on(t.sessionId, t.generation, t.ordinal)
      .where(sql`${t.type} = 'tool_inventory'`),
  ],
)

export const derivedGeneration = sqliteTable('derived_generation', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => providerSession.id, { onDelete: 'cascade' }),
  /** The generation every read of this session's ledger and turns is scoped to. */
  active: integer('active').notNull(),
  normalizerVersion: integer('normalizer_version').notNull(),
  /** How many of the provider's lines the active generation was read from. */
  derivedThrough: integer('derived_through').notNull(),
  /** The generation currently being built beside the active one, or null when none is. */
  building: integer('building'),
  highest: integer('highest').notNull(),
  failure: text('failure'),
  updatedAt: integer('updated_at').notNull(),
})

export const work = sqliteTable(
  'work',
  {
    /** `work_<uuid>` — `newWorkId`. */
    id: text('id').primaryKey(),
    /** The piece this one was given under, or NULL: a root. */
    parentId: text('parent_id').references((): AnySQLiteColumn => work.id),
    /** Its number under its parent, or among the roots — from {@link workSequence}, never reused. */
    number: integer('number').notNull(),
    /** The conversation whose ledger holds this piece's life — fixed for good. */
    ownerSessionId: text('owner_session_id')
      .notNull()
      .references(() => providerSession.id),
    givenBySessionId: text('given_by_session_id').references(() => providerSession.id),
    /** As given. NULL only on a root, whose title lives in its `work_retitled` rows. */
    title: text('title'),
    /** As given. NULL only on a root. */
    brief: text('brief'),
    /** The folder the give asked for, as asked, or NULL when it named none. */
    folder: text('folder'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('work_number_ck', sql`${t.number} >= 1`),
    check(
      'work_a_root_is_given_by_a_person_ck',
      sql`${t.parentId} IS NOT NULL OR ${t.givenBySessionId} IS NULL`,
    ),
    check(
      'work_a_piece_has_a_title_and_a_brief_ck',
      sql`${t.parentId} IS NULL OR (${t.title} IS NOT NULL AND ${t.brief} IS NOT NULL)`,
    ),
    uniqueIndex('work_parent_number_uq')
      .on(t.parentId, t.number)
      .where(sql`${t.parentId} IS NOT NULL`),
    uniqueIndex('work_root_number_uq')
      .on(t.number)
      .where(sql`${t.parentId} IS NULL`),
    uniqueIndex('work_one_root_per_conversation_uq')
      .on(t.ownerSessionId)
      .where(sql`${t.parentId} IS NULL`),
    index('work_owner_idx').on(t.ownerSessionId),
    index('work_given_by_idx').on(t.givenBySessionId),
  ],
)

export const workSequence = sqliteTable(
  'work_sequence',
  {
    /** A parent's `work.id`, or `ROOTS_SCOPE`. */
    scope: text('scope').primaryKey(),
    /** The last number handed out in this scope. Starts at 1; only ever goes up. */
    last: integer('last').notNull(),
  },
  (t) => [check('work_sequence_last_ck', sql`${t.last} >= 1`)],
)

export const workResource = sqliteTable(
  'work_resource',
  {
    /** `res_<32 hex>` — `newResourceId`. */
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => work.id),
    /** One of {@link RESOURCE_ROLES}, and the CHECK below is what closes it. */
    role: text('role').notNull(),
    title: text('title'),
    /** What the one who added it said it holds, or NULL when nothing was said. */
    summary: text('summary'),
    /** The file's own name as it was handed in — the last segment of its path here. */
    name: text('name').notNull(),
    /** Lower-case hex of the bytes as they were kept. */
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    /** The conversation that added it, or NULL: a person. */
    addedBySessionId: text('added_by_session_id').references(() => providerSession.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('work_resource_role_ck', sql`${t.role} IN (${oneOf(RESOURCE_ROLES)})`),
    check(
      'work_resource_sha256_ck',
      sql`length(${t.sha256}) = 64 AND ${t.sha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check('work_resource_bytes_ck', sql`${t.bytes} >= 1`),
    index('work_resource_work_idx').on(t.workId),
  ],
)

export const identityInstruction = sqliteTable(
  'identity_instruction',
  {
    /** `ins:<folded slug>:<version>` — derived. See the table comment. */
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    text: text('text').notNull(),
    wroteIt: text('wrote_it').notNull(),
    author: text('author', { mode: 'json' }),
    by: text('by', { mode: 'json' }).notNull(),
    conversationId: text('conversation_id').references(() => providerSession.id, {
      onDelete: 'set null',
    }),
    /** What the agent said when it asked — a CLAIM, and null for a version a person wrote. */
    said: text('said'),
    broughtBack: integer('brought_back'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('identity_instruction_identity_idx').on(t.identityId, t.version),
    uniqueIndex('identity_instruction_version_uq').on(t.identityId, t.version),
    check('identity_instruction_version_ck', sql`${t.version} >= 1`),
    check(
      'identity_instruction_wrote_it_ck',
      sql`${t.wroteIt} in ('a-person', 'an-agents-proposal', 'relayed-from-user', 'its-creator', 'an-agent-direct')`,
    ),
    check(
      'identity_instruction_creator_is_first_ck',
      sql`${t.wroteIt} <> 'its-creator' or ${t.version} = 1`,
    ),
    check(
      'identity_instruction_brought_back_ck',
      sql`${t.broughtBack} is null or (${t.broughtBack} >= 1 and ${t.broughtBack} < ${t.version})`,
    ),
    check(
      'identity_instruction_person_said_nothing_ck',
      sql`${t.wroteIt} <> 'a-person' or (${t.conversationId} is null and ${t.said} is null)`,
    ),
  ],
)

/** The last rules change displayed to a person for this identity. */
export const identityInstructionSeen = sqliteTable(
  'identity_instruction_seen',
  {
    identityId: text('identity_id')
      .primaryKey()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    seenThrough: integer('seen_through').notNull().default(0),
  },
  (t) => [check('identity_instruction_seen_version_ck', sql`${t.seenThrough} >= 0`)],
)

export const identityMemoryAmendment = sqliteTable(
  'identity_memory_amendment',
  {
    /** `mem:<folded slug>:<seq>` — derived. See `memoryAmendmentRowId`. */
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    provider: text('provider').notNull(),
    entry: text('entry').notNull(),
    /** One of `MEMORY_AMENDMENT`, and the CHECK below is what closes it. */
    act: text('act').notNull(),
    by: text('by', { mode: 'json' }).notNull(),
    textBefore: text('text_before'),
    textAfter: text('text_after'),
    createdAt: integer('created_at').notNull(),
    sourceId: text('source_id').references((): AnySQLiteColumn => identityMemoryAmendment.id),
    outcome: text('outcome').notNull().default('done'),
    actual: text('actual', { mode: 'json' }),
    settledBy: text('settled_by', { mode: 'json' }),
    settledAt: integer('settled_at'),
  },
  (t) => [
    index('identity_memory_amendment_identity_idx').on(t.identityId, t.seq),
    uniqueIndex('identity_memory_amendment_seq_uq').on(t.identityId, t.seq),
    uniqueIndex('identity_memory_amendment_one_pending_uq')
      .on(t.identityId)
      .where(sql`${t.outcome} = 'pending'`),
    check('identity_memory_amendment_seq_ck', sql`${t.seq} >= 1`),
    check(
      'identity_memory_amendment_act_ck',
      sql`${t.act} in ('removed', 'corrected', 'restored')`,
    ),
    check('identity_memory_amendment_provider_ck', sql`${t.provider} in ('claude', 'codex')`),
    check(
      'identity_memory_amendment_after_matches_act_ck',
      sql`(${t.act} = 'removed' and ${t.textBefore} is not null and ${t.textAfter} is null) or (${t.act} = 'corrected' and ${t.textBefore} is not null and ${t.textAfter} is not null) or (${t.act} = 'restored' and ${t.textBefore} is null and ${t.textAfter} is not null and ${t.sourceId} is not null)`,
    ),
    check(
      'identity_memory_amendment_source_ck',
      sql`${t.sourceId} is null or (${t.sourceId} <> ${t.id} and (${t.act} in ('removed', 'restored') or (${t.act} = 'corrected' and (${t.outcome} = 'pending' or ${t.actual} is not null))))`,
    ),
    check(
      'identity_memory_amendment_source_person_ck',
      sql`${t.sourceId} is null or (case when json_valid(${t.by}) then json_extract(${t.by}, '$.who') is 'a-person' else 0 end)`,
    ),
    check(
      'identity_memory_amendment_outcome_ck',
      sql`${t.outcome} IN ('pending', 'done', 'partial', 'unchanged')`,
    ),
    check(
      'identity_memory_amendment_recovery_person_ck',
      sql`(${t.outcome} = 'done' AND ${t.actual} IS NULL AND ${t.settledBy} IS NULL AND ${t.settledAt} IS NULL) OR (CASE WHEN json_valid(${t.by}) THEN json_extract(${t.by}, '$.who') IS 'a-person' ELSE 0 END)`,
    ),
    check(
      'identity_memory_amendment_recovery_ck',
      sql`(
  ${t.outcome} IN ('pending', 'done') AND ${t.actual} IS NULL AND ${t.settledBy} IS NULL AND ${t.settledAt} IS NULL
) OR (
  ${t.outcome} IN ('done', 'partial', 'unchanged') AND ${t.actual} IS NOT NULL AND
  ${t.settledBy} IS NOT NULL AND ${t.settledAt} IS NOT NULL AND
  typeof(${t.settledAt}) = 'integer' AND ${t.settledAt} >= 0 AND ${t.settledAt} <= 9007199254740991 AND
  CASE WHEN json_valid(${t.actual}) THEN
    json_type(${t.actual}) IS 'object' AND
    CASE json_type(${t.actual}, '$.fingerprint')
      WHEN 'null' THEN 1
      WHEN 'text' THEN length(json_extract(${t.actual}, '$.fingerprint')) = 64 AND json_extract(${t.actual}, '$.fingerprint') NOT GLOB '*[^0-9a-f]*'
      ELSE 0
    END AND
    CASE WHEN json_type(${t.actual}, '$.unreadable') IS NULL THEN 1
      WHEN json_type(${t.actual}, '$.unreadable') IS 'true' THEN
        ${t.outcome} = 'partial' AND json_type(${t.actual}, '$.fingerprint') IS 'null'
      ELSE 0
    END
  ELSE 0 END AND
  CASE WHEN json_valid(${t.settledBy}) THEN
    json_type(${t.settledBy}) IS 'object' AND coalesce(json_extract(${t.settledBy}, '$.who'), '') IN ('a-person', 'the-app-itself')
  ELSE 0 END
)`,
    ),
  ],
)

/** The holder ledger boundary captured once when ordinary stalls adopt holder-first reminders. */
export const workLegacyStallCut = sqliteTable('work_legacy_stall_cut', {
  sessionId: text('session_id')
    .primaryKey()
    .notNull()
    .references(() => providerSession.id, { onDelete: 'cascade' }),
  generation: integer('generation').notNull(),
  throughOrdinal: integer('through_ordinal').notNull(),
})

/** Immutable source versions; provider-home views are derived from these bytes later. */
export const skillVersion = sqliteTable(
  'skill_version',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id').notNull(),
    versionKey: text('version_key').notNull(),
    metadata: text('metadata').notNull(),
    body: text('body').notNull(),
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    pluginId: text('plugin_id'),
    packageVersion: text('package_version'),
    packageSha256: text('package_sha256'),
    packageManifestSha256: text('package_manifest_sha256'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('skill_version_release_uq').on(t.skillId, t.versionKey),
    uniqueIndex('skill_version_owner_uq').on(t.skillId, t.id),
    index('skill_version_package_idx').on(t.pluginId, t.packageVersion),
    check(
      'skill_version_metadata_ck',
      sql`json_valid(${t.metadata}) AND length(CAST(${t.metadata} AS BLOB)) <= 8192`,
    ),
    check(
      'skill_version_bytes_ck',
      sql`typeof(${t.bytes}) = 'integer' AND ${t.bytes} BETWEEN 1 AND 65536 AND length(CAST(${t.body} AS BLOB)) = ${t.bytes}`,
    ),
    check(
      'skill_version_package_ck',
      sql`(${t.pluginId} IS NULL AND ${t.packageVersion} IS NULL AND ${t.packageSha256} IS NULL AND ${t.packageManifestSha256} IS NULL) OR (${t.pluginId} IS NOT NULL AND ${t.packageVersion} IS NOT NULL AND ${t.packageSha256} IS NOT NULL AND ${t.packageManifestSha256} IS NOT NULL)`,
    ),
  ],
)

/** One current version per source-qualified skill, without changing prior versions. */
export const skillCurrent = sqliteTable(
  'skill_current',
  {
    id: text('id').primaryKey(),
    alias: text('alias').notNull(),
    currentVersion: text('current_version').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    uniqueIndex('skill_current_alias_uq').on(t.alias),
    foreignKey({
      columns: [t.id, t.currentVersion],
      foreignColumns: [skillVersion.skillId, skillVersion.id],
    }),
    check('skill_current_active_ck', sql`${t.active} IN (0, 1)`),
  ],
)

/** A person's saved next-start choice, attached to an identity rather than its display name. */
export const skillSelection = sqliteTable(
  'skill_selection',
  {
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => skillCurrent.id, { onDelete: 'cascade' }),
    choice: text('choice').notNull(),
  },
  (t) => [
    uniqueIndex('skill_selection_identity_uq').on(t.identityId, t.skillId),
    index('skill_selection_skill_idx').on(t.skillId),
    check('skill_selection_choice_ck', sql`${t.choice} IN ('default', 'on', 'off')`),
  ],
)

/** Compare-and-swap revision for catalogue edits and selections in one transaction. */
export const skillCatalogueState = sqliteTable(
  'skill_catalogue_state',
  {
    id: integer('id').primaryKey(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    check(
      'skill_catalogue_state_ck',
      sql`${t.id} = 1 AND typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`,
    ),
  ],
)

/** Exact recovery bytes stay in main; window history receives metadata only. */
export const identityMethodChange = sqliteTable(
  'identity_method_change',
  {
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    operation: text('operation').notNull(),
    sourceId: text('source_id').references((): AnySQLiteColumn => identityMethodChange.id),
    target: text('target').notNull(),
    files: text('files', { mode: 'json' }).notNull(),
    by: text('by', { mode: 'json' }).notNull(),
    outcome: text('outcome').notNull(),
    actual: text('actual', { mode: 'json' }),
    createdAt: integer('created_at').notNull(),
    settledBy: text('settled_by', { mode: 'json' }),
    settledAt: integer('settled_at'),
  },
  (t) => [
    uniqueIndex('identity_method_change_sequence_uq').on(t.identityId, t.seq),
    uniqueIndex('identity_method_change_pending_uq')
      .on(t.identityId)
      .where(sql`${t.outcome} = 'pending'`),
    check('identity_method_change_sequence_ck', sql`${t.seq} >= 1`),
    check(
      'identity_method_change_operation_ck',
      sql`(${t.operation} = 'delete' AND ${t.sourceId} IS NULL) OR (${t.operation} = 'undo' AND ${t.sourceId} IS NOT NULL)`,
    ),
    check(
      'identity_method_change_outcome_ck',
      sql`(${t.outcome} = 'pending' AND ${t.actual} IS NULL) OR (${t.outcome} IN ('done', 'partial') AND ${t.actual} IS NOT NULL)`,
    ),
    check(
      'identity_method_change_settlement_ck',
      sql`(${t.settledBy} IS NULL AND ${t.settledAt} IS NULL) OR (${t.settledBy} IS NOT NULL AND ${t.settledAt} IS NOT NULL AND ${t.outcome} IN ('done', 'partial') AND typeof(${t.settledAt}) = 'integer' AND ${t.settledAt} >= 0 AND ${t.settledAt} <= 9007199254740991 AND CASE WHEN json_valid(${t.settledBy}) THEN coalesce(json_extract(${t.settledBy}, '$.who'), '') IN ('a-person', 'the-app-itself') ELSE 0 END)`,
    ),
  ],
)

/** Separate from standing rules: every version records an agent's own page or a person's edit. */
export const identityOwnNotes = sqliteTable(
  'identity_own_notes',
  {
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    text: text('text').notNull(),
    author: text('author'),
    actor: text('actor').notNull(),
    reason: text('reason').notNull(),
    restoredFromVersion: integer('restored_from_version'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('identity_own_notes_version_uq').on(t.identityId, t.version),
    check('identity_own_notes_version_ck', sql`${t.version} >= 1`),
    check(
      'identity_own_notes_text_ck',
      sql`length(${t.text}) <= 4000 AND instr(${t.text}, char(0)) = 0`,
    ),
    check(
      'identity_own_notes_reason_ck',
      sql`length(trim(${t.reason})) > 0 AND length(${t.reason}) <= 4000`,
    ),
    check(
      'identity_own_notes_restore_ck',
      sql`${t.restoredFromVersion} IS NULL OR (${t.restoredFromVersion} >= 0 AND ${t.restoredFromVersion} < ${t.version})`,
    ),
    check(
      'identity_own_notes_actor_ck',
      sql`json_valid(${t.actor}) AND coalesce(json_extract(${t.actor}, '$.who') IN ('a-person', 'an-agent'), 0)`,
    ),
    check(
      'identity_own_notes_author_ck',
      sql`(json_extract(${t.actor}, '$.who') = 'a-person' AND ${t.author} IS NULL) OR (json_extract(${t.actor}, '$.who') = 'an-agent' AND ${t.author} IS NOT NULL AND json_valid(${t.author}))`,
    ),
  ],
)

export const identityOwnNotesSeen = sqliteTable(
  'identity_own_notes_seen',
  {
    identityId: text('identity_id')
      .primaryKey()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    seenThrough: integer('seen_through').notNull().default(0),
  },
  (t) => [check('identity_own_notes_seen_ck', sql`${t.seenThrough} >= 0`)],
)

/** A side file a start imported into these tables; a named file is only ever deleted after. */
export const importedSideFile = sqliteTable('imported_side_file', {
  name: text('name').primaryKey(),
})

export const archivedConversation = sqliteTable('archived_conversation', {
  conversationId: text('conversation_id').primaryKey(),
  archivedAt: integer('archived_at').notNull(),
})

export const signInChange = sqliteTable('sign_in_change', {
  provider: text('provider').primaryKey(),
  changedAt: integer('changed_at').notNull(),
})
