import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { importSideFile, objectIn } from './db/side-file-import'

/**
 * How each profile runs its work, kept across a restart: one `profile_execution` row per identity.
 *
 * A profile is `normal` (each giver's work in its own conversation) or a `service`: one
 * conversation, shared by every caller in this workspace, that runs their pieces one at a time. A
 * profile with no entry is normal.
 *
 * Entries are keyed by identity and its creation time, and retired before their identity goes: an
 * identity's id is derived from its name, so a name deleted and made again can have the same id.
 * A service's conversation, and a normal worker's, is reserved before it is made and completed
 * after; {@link reconcileProfileExecution} settles what a restart finds in between.
 *
 * With no `profile_execution_state` row, nothing has been written yet: every profile is normal only
 * while the database holds no service's conversation or worker registration.
 *
 * Only the one app running on this data changes it (the one-host gate's `sole`).
 */

/** A profile's kind. */
export type ProfileKind = 'normal' | 'service'

/** A delivery whose acceptance is not yet proved; a restart must not replay its brief. */
export interface NormalWorkerAssignment {
  readonly piece: string
  readonly giver: string
}

/** One stable worker number in a giver's pool; number 1 is its primary. */
export interface NormalWorkerBinding {
  readonly number: number
  readonly conversation: string
  readonly phase: 'reserved' | 'bound'
  /** Keeps the worker unavailable until durable work acceptance is proved. */
  readonly assignment?: NormalWorkerAssignment
}

/** One giver's workers, retaining the next extra number across failed starts. */
export interface NormalWorkerPool {
  readonly giver: string
  readonly nextNumber: number
  readonly workers: readonly NormalWorkerBinding[]
  /** The primary's reservation was dropped only after proving no recorded birth. */
  readonly primaryNeverBorn?: true
  /** Written before deleting the giver's conversation tree. */
  readonly removing?: true
}

/** One profile's entry. */
export interface ProfileExecution {
  readonly kind: ProfileKind
  /** When the identity this entry belongs to was made, epoch ms: its `agent_identity.created_at`. */
  readonly identityCreatedAt: number
  /** Only normal profiles have worker pools, separated by giver lineage. */
  readonly workerPools?: readonly NormalWorkerPool[]
  /** A service's one conversation, once it is made. */
  readonly serviceConversation?: string
  /** The conversation id reserved for a service before it is made, while that is in progress. */
  readonly reserved?: string
  /** The service's conversation, while a person's delete of it is in progress. */
  readonly removing?: string
  /** Its identity is being removed: the entry outlives no identity. */
  readonly retired?: true
}

/** What is kept, by identity id. */
export interface KeptProfileExecution {
  readonly profiles: Readonly<Record<string, ProfileExecution>>
  /**
   * A person turned services off in this workspace: no profile is made a service, and services
   * take no new work. ⚑ On where it is missing, so a new workspace and an installer start with
   * services on.
   */
  readonly servicesOff?: true
}

/** What a read found: the entries, or why they cannot be known. */
export type ProfileExecutionRead =
  | {
      readonly readable: true
      readonly kept: KeptProfileExecution
      /** Nothing was written yet, so nothing is kept unless the database says otherwise. */
      readonly absent?: true
    }
  | { readonly readable: false; readonly why: string }

/** The old file's versions the import reads. */
const PROFILE_EXECUTION_VERSIONS = [1, 2]

export const MAX_NORMAL_WORKER_POOLS = 128
export const MAX_NORMAL_WORKERS_PER_POOL = 64

/** Nothing kept: every profile is normal. */
export const NO_PROFILE_EXECUTION: KeptProfileExecution = { profiles: {} }

/** `entry` with `field` left out. */
export function entryWithout(
  entry: ProfileExecution,
  field: 'reserved' | 'removing',
): ProfileExecution {
  const copy: { -readonly [K in keyof ProfileExecution]: ProfileExecution[K] } = { ...entry }
  delete copy[field]
  return copy
}

/** The file older builds kept this in, imported once. */
export const PROFILE_EXECUTION_FILE = 'profile-execution.json'

/** What `database` keeps; the graph worker reads it in its own snapshot. */
export function readProfileExecution(database: Database.Database): ProfileExecutionRead {
  const state = database
    .prepare('SELECT services_off AS off FROM profile_execution_state WHERE id = 1')
    .get() as { off: number } | undefined
  if (state === undefined) return { readable: true, kept: NO_PROFILE_EXECUTION, absent: true }
  const rows = database.prepare('SELECT identity_id AS id, entry FROM profile_execution').all() as {
    id: string
    entry: string
  }[]
  const profiles = Object.fromEntries(
    rows.map(({ id, entry }) => [id, JSON.parse(entry) as ProfileExecution]),
  )
  return { readable: true, kept: state.off === 1 ? { servicesOff: true, profiles } : { profiles } }
}

/**
 * What the host reads: as {@link readProfileExecution}, except that an older build's file still
 * waiting to be imported is unreadable, so every kind is unknown rather than normal.
 */
export function readProfileExecutionIn(
  database: Database.Database,
  userData: string,
): ProfileExecutionRead {
  const imported =
    database
      .prepare('SELECT 1 FROM imported_side_file WHERE name = ?')
      .get(PROFILE_EXECUTION_FILE) !== undefined
  if (!imported && existsSync(join(userData, PROFILE_EXECUTION_FILE)))
    return { readable: false, why: `${PROFILE_EXECUTION_FILE} could not be imported` }
  return readProfileExecution(database)
}

/** Keep `kept`, replacing what was kept, in one transaction. */
export function writeProfileExecution(
  database: Database.Database,
  kept: KeptProfileExecution,
): void {
  database.transaction(() => replaceProfileExecution(database, kept))()
}

function replaceProfileExecution(database: Database.Database, kept: KeptProfileExecution): void {
  database.prepare('DELETE FROM profile_execution').run()
  const insert = database.prepare(
    'INSERT INTO profile_execution (identity_id, entry) VALUES (?, ?)',
  )
  for (const [id, entry] of Object.entries(kept.profiles)) insert.run(id, JSON.stringify(entry))
  database
    .prepare(
      `INSERT INTO profile_execution_state (id, services_off) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET services_off = excluded.services_off`,
    )
    .run(kept.servicesOff === true ? 1 : 0)
}

/** Imports `profile-execution.json` (v1 or v2) from `userData` once, each entry as written. */
export function importProfileExecutionFile(database: Database.Database, userData: string): void {
  importSideFile(database, join(userData, PROFILE_EXECUTION_FILE), (said) => {
    const whole = objectIn(said)
    if (!PROFILE_EXECUTION_VERSIONS.includes(whole['version'] as number))
      throw new Error('it is not a version this build imports')
    replaceProfileExecution(database, {
      profiles: objectIn(whole['profiles']) as Record<string, ProfileExecution>,
      ...(whole['servicesOff'] === true ? { servicesOff: true } : {}),
    })
  })
}

/** A conversation only a service's start makes: no parent, and no root. */
export interface ServiceBorn {
  readonly conversation: string
  /** The identity it runs as, by id. */
  readonly identity: string | null
}

/** The exact registration fact committed with a normal worker's conversation. */
export interface WorkerBorn {
  readonly identity: string
  readonly identityCreatedAt: number
  readonly giver: string
  readonly number: number
  readonly conversation: string
}

/** The facts {@link reconcileProfileExecution} asks the database. */
export interface WhatTheDatabaseHolds {
  /** The identity's creation time, or `null` when no identity has that id. */
  identityCreatedAt(identity: string): number | null
  /** Whether a conversation with that id is recorded. */
  hasConversation(conversation: string): boolean
  /** Every conversation the database holds that only a service's start makes. */
  readonly servicesBorn: readonly ServiceBorn[]
  /** Optional for legacy callers; the host supplies complete evidence, at most 8192 facts. */
  readonly workersBorn?: readonly WorkerBorn[]
  /** The actual worker's identity, incarnation, provider and parent lineage agree with the fact. */
  workerMatches?(fact: WorkerBorn): boolean
  /** Exact identity and giver-lineage proof for an existing, unregistered legacy primary only. */
  legacyPrimaryMatches?(fact: WorkerBorn): boolean
  /** True only when the matching work acceptance is durable; no evidence keeps the hold. */
  assignmentWasAccepted?(worker: WorkerBorn, assignment: NormalWorkerAssignment): boolean
}

/** What a reconcile found, and what it changed. */
export interface Reconciled {
  readonly kept: KeptProfileExecution
  /** Whether {@link kept} differs from what was read, so it is to be written. */
  readonly changed: boolean
  /** The identities whose entries {@link kept} changes. */
  readonly moved: readonly string[]
  /** Entries that cannot be settled from the evidence: their profiles' kinds stay unknown. */
  readonly conflicts: readonly string[]
}

/**
 * What a read means once the database's evidence is in: ⛔ a missing file is not "nothing kept"
 * while the database holds a service's conversation.
 */
export function readAgainstTheDatabase(
  read: ProfileExecutionRead,
  servicesBorn: readonly ServiceBorn[],
  workersBorn: readonly WorkerBorn[] = [],
): ProfileExecutionRead {
  if (!read.readable || read.absent !== true) return read
  if (servicesBorn.length > 0)
    return {
      readable: false,
      why: 'it is missing, and the database holds a service’s conversation',
    }
  if (workersBorn.length > 0)
    return { readable: false, why: 'it is missing, and the database holds a worker registration' }
  return read
}

/** Recover only registrations proved by both stores; a conflict leaves the whole entry intact. */
function settleNormalWorkers(
  identity: string,
  entry: ProfileExecution,
  registrations: readonly WorkerBorn[],
  factsByConversation: ReadonlyMap<string, readonly WorkerBorn[]>,
  database: WhatTheDatabaseHolds,
): { entry: ProfileExecution; conflict: boolean } {
  if (entry.workerPools === undefined) return { entry, conflict: registrations.length > 0 }
  const named = new Set<string>()
  const pools: NormalWorkerPool[] = []
  let changed = false
  for (const pool of entry.workerPools) {
    if (pool.removing === true && !database.hasConversation(pool.giver)) {
      // Missing rows alone do not prove the whole giver tree was deleted. A registration
      // outside this profile still blocks removal when it names one of this pool's workers.
      if (
        database.workersBorn === undefined ||
        pool.workers.some((worker) => database.hasConversation(worker.conversation)) ||
        registrations.some((fact) => fact.giver === pool.giver) ||
        pool.workers.some(
          (worker) => (factsByConversation.get(worker.conversation)?.length ?? 0) > 0,
        )
      )
        return { entry, conflict: true }
      changed = true
      continue
    }
    const workers: NormalWorkerBinding[] = []
    let primaryNeverBorn = pool.primaryNeverBorn
    for (const worker of pool.workers) {
      named.add(worker.conversation)
      const facts = factsByConversation.get(worker.conversation) ?? []
      const fact = facts[0]
      const exact =
        facts.length === 1 &&
        fact?.identity === identity &&
        fact.identityCreatedAt === entry.identityCreatedAt &&
        fact.giver === pool.giver &&
        fact.number === worker.number &&
        database.workerMatches?.(fact) !== false
      const recorded = database.hasConversation(worker.conversation)
      const proved =
        exact ||
        (recorded &&
          facts.length === 0 &&
          worker.number === 1 &&
          database.legacyPrimaryMatches?.({
            identity,
            identityCreatedAt: entry.identityCreatedAt,
            giver: pool.giver,
            number: worker.number,
            conversation: worker.conversation,
          }) === true)
      if (worker.phase === 'bound') {
        if (!recorded || !proved) return { entry, conflict: true }
        workers.push(worker)
      } else if (recorded && proved) {
        workers.push({ ...worker, phase: 'bound' })
        changed = true
      } else if (!recorded && facts.length === 0) {
        if (worker.number === 1) primaryNeverBorn = true
        changed = true
      } else {
        return { entry, conflict: true }
      }
    }
    const activePool: { -readonly [K in keyof NormalWorkerPool]: NormalWorkerPool[K] } = { ...pool }
    if (pool.removing === true) {
      delete activePool.removing
      changed = true
    }
    pools.push({
      ...activePool,
      workers,
      ...(primaryNeverBorn === undefined ? {} : { primaryNeverBorn }),
    })
  }
  if (registrations.some((fact) => !named.has(fact.conversation))) return { entry, conflict: true }
  // All bindings must be known before any delivery hold can be settled for this entry.
  const settledPools = pools.map((pool) => ({
    ...pool,
    workers: pool.workers.map((worker) => {
      if (
        worker.assignment === undefined ||
        database.assignmentWasAccepted?.(
          {
            identity,
            identityCreatedAt: entry.identityCreatedAt,
            giver: pool.giver,
            number: worker.number,
            conversation: worker.conversation,
          },
          worker.assignment,
        ) !== true
      )
        return worker
      const copy: { -readonly [K in keyof NormalWorkerBinding]: NormalWorkerBinding[K] } = {
        ...worker,
      }
      delete copy.assignment
      changed = true
      return copy
    }),
  }))
  return {
    entry: changed ? { ...entry, workerPools: settledPools } : entry,
    conflict: false,
  }
}

/**
 * Settle what the file holds against the database, as the host starts.
 * - An entry whose identity is gone, or was made again since, is dropped: it was another profile's.
 * - A reservation whose conversation is recorded is completed; one whose conversation is not is
 *   dropped, since that conversation was never made.
 * - A removal whose conversation is still recorded did not happen, and is dropped; one whose
 *   conversation is gone is done, and the service has no conversation.
 * - ⛔ A service whose made conversation is not recorded, or whose made conversation and a
 *   different reservation are both recorded, cannot be settled: it is listed in `conflicts`, never
 *   repaired by making another conversation.
 * - ⛔ A retired entry whose identity has its creation time, and a service's conversation in the
 *   database that its identity's entry does not name, cannot be settled either.
 */
export function reconcileProfileExecution(
  kept: KeptProfileExecution,
  database: WhatTheDatabaseHolds,
): Reconciled {
  const profiles: Record<string, ProfileExecution> = {}
  const conflicts: string[] = []
  const serviceIdentities = new Set(database.servicesBorn.map(({ identity }) => identity))
  const workersByIdentity = new Map<string, WorkerBorn[]>()
  const factsByConversation = new Map<string, WorkerBorn[]>()
  for (const fact of database.workersBorn ?? []) {
    const facts = workersByIdentity.get(fact.identity) ?? []
    facts.push(fact)
    workersByIdentity.set(fact.identity, facts)
    const registrations = factsByConversation.get(fact.conversation) ?? []
    registrations.push(fact)
    factsByConversation.set(fact.conversation, registrations)
  }
  let changed = false
  for (const [identity, read] of Object.entries(kept.profiles)) {
    let entry = read
    if (database.identityCreatedAt(identity) !== entry.identityCreatedAt) {
      changed = true
      continue
    }
    if (entry.retired === true) {
      conflicts.push(identity)
      profiles[identity] = entry
      continue
    }
    if (entry.kind === 'normal') {
      if (serviceIdentities.has(identity)) {
        conflicts.push(identity)
        profiles[identity] = entry
        continue
      }
      const settled = settleNormalWorkers(
        identity,
        entry,
        workersByIdentity.get(identity) ?? [],
        factsByConversation,
        database,
      )
      if (settled.conflict) conflicts.push(identity)
      if (settled.entry !== entry) changed = true
      profiles[identity] = settled.entry
      continue
    }
    const { identityCreatedAt } = entry
    if (entry.removing !== undefined) {
      changed = true
      if (!database.hasConversation(entry.removing)) {
        profiles[identity] = { kind: 'service', identityCreatedAt }
        continue
      }
      entry = entryWithout(entry, 'removing')
    }
    const { serviceConversation: made, reserved } = entry
    if (made !== undefined && !database.hasConversation(made)) {
      conflicts.push(identity)
      profiles[identity] = entry
      continue
    }
    if (reserved === undefined) {
      profiles[identity] = entry
      continue
    }
    const reservedWasMade = database.hasConversation(reserved)
    if (made !== undefined && made !== reserved && reservedWasMade) {
      conflicts.push(identity)
      profiles[identity] = entry
      continue
    }
    changed = true
    const conversation = reservedWasMade ? reserved : made
    profiles[identity] =
      conversation === undefined
        ? { kind: 'service', identityCreatedAt }
        : { kind: 'service', identityCreatedAt, serviceConversation: conversation }
  }
  for (const { conversation, identity } of database.servicesBorn) {
    if (identity === null || conflicts.includes(identity)) continue
    const entry = profiles[identity]
    const named =
      entry?.serviceConversation === conversation ||
      entry?.reserved === conversation ||
      entry?.removing === conversation
    if (!named) conflicts.push(identity)
  }
  for (const identity of workersByIdentity.keys()) {
    if (conflicts.includes(identity)) continue
    if (profiles[identity]?.kind !== 'normal') conflicts.push(identity)
  }
  const moved = [...new Set([...Object.keys(kept.profiles), ...Object.keys(profiles)])].filter(
    (identity) => JSON.stringify(kept.profiles[identity]) !== JSON.stringify(profiles[identity]),
  )
  return {
    kept: kept.servicesOff === true ? { servicesOff: true, profiles } : { profiles },
    changed,
    moved,
    conflicts,
  }
}

/**
 * A profile's kind as kept: `normal` where nothing is kept for it, or what is kept is another
 * identity's of the same name; `unknown` where the file cannot be read or its entry is in conflict.
 */
export function kindOf(
  read: ProfileExecutionRead,
  conflicts: readonly string[],
  identity: string,
  identityCreatedAt: number,
): ProfileKind | 'unknown' {
  if (!read.readable || conflicts.includes(identity)) return 'unknown'
  const entry = read.kept.profiles[identity]
  if (entry === undefined || entry.identityCreatedAt !== identityCreatedAt) return 'normal'
  return entry.retired === true ? 'unknown' : entry.kind
}
