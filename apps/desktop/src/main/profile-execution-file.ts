import {
  closeSync,
  fsyncSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * **How each profile runs its work**, kept across a restart: `<userData>/profile-execution.json`.
 *
 * A profile is `normal` (each giver's work in its own conversation, today's behaviour) or a
 * `service`: one conversation, shared by every caller in this workspace, that runs their pieces one
 * at a time. The kind is not a column of the identity table: a profile with no entry here is normal.
 *
 * ⚑ **Keyed by identity AND its creation time, and retired before its identity goes.** An
 * identity's id is derived from its name, so a name deleted and made again has the same id, and may
 * have the same creation time. So the door that removes an identity marks its entry `retired` before
 * the row goes, and drops it after. An entry for another creation time is another identity's and is
 * dropped; a retired entry whose identity has the same creation time cannot be told from a removal
 * that failed, and that profile's kind is unknown.
 *
 * ⚑ **A service's conversation is reserved before it is made.** The file and the database cannot
 * commit together, so a reservation is written first, the conversation is made with that id, and
 * the reservation is completed. At the next start {@link reconcileProfileExecution} completes a
 * reservation whose conversation exists and drops one whose conversation does not. A service's
 * conversation a person deletes is marked `removing` first, and settled the same way.
 * Normal worker reservations additionally need an exact registration fact. Only a recorded
 * legacy primary may instead use the host's identity and giver-lineage proof. A conflicting
 * fact never permits that legacy fallback. Extra numbers are never reused; a proved never-born
 * primary may be reserved again. A normal pool's removal intent precedes deleting its giver
 * tree; only complete absence of that pool's conversations and birth facts settles the removal.
 *
 * ⛔ **A file that cannot be read is never read as "every profile is normal".** A service run as a
 * normal profile would start a second conversation on the shared thing; so an unreadable file is
 * a stated failure, and every profile's kind is unknown until it can be read.
 * ⚑ A missing file means every profile is normal only while the database holds no service's
 * conversation or worker registration; either says the file was lost, and every kind is unknown.
 *
 * ⛔ **Only the one app running on this data changes it** (the one-host gate's `sole`): two that
 * could each read and replace it would lose each other's writes.
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

/** What the file holds, by identity id. */
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
      /** There was no file, so nothing is kept unless the database says otherwise. */
      readonly absent?: true
    }
  | { readonly readable: false; readonly why: string }

/** Writes v2; reads v1 legacy entries as well. Older builds reject the v2 format. */
export const PROFILE_EXECUTION_VERSION = 2

/** The most profiles the file holds: far above any workspace. */
export const MAX_PROFILES_KEPT = 10_000

export const MAX_NORMAL_WORKER_POOLS = 128
export const MAX_NORMAL_WORKERS_PER_POOL = 64
/** The store's global registration scan and the file share this ceiling. */
export const MAX_NORMAL_WORKERS_KEPT = 8192
/** Bound the read before allocating or parsing the file. */
export const MAX_PROFILE_EXECUTION_BYTES = 8 * 1024 * 1024

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

/** Where a data folder keeps it. */
export function profileExecutionFile(userData: string): string {
  return join(userData, 'profile-execution.json')
}

const aRecord = (said: unknown): Record<string, unknown> | null =>
  typeof said === 'object' && said !== null && !Array.isArray(said)
    ? (said as Record<string, unknown>)
    : null

const anId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200

const aTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** One entry, checked; `null` when it is not one this build writes. */
function anEntry(said: unknown, version: number): ProfileExecution | null {
  const row = aRecord(said)
  if (row === null) return null
  const { kind, identityCreatedAt, serviceConversation, reserved, removing, retired, workerPools } =
    row
  if (kind !== 'normal' && kind !== 'service') return null
  if (retired !== undefined && retired !== true) return null
  if (!aTime(identityCreatedAt)) return null
  if (serviceConversation !== undefined && !anId(serviceConversation)) return null
  if (reserved !== undefined && !anId(reserved)) return null
  if (removing !== undefined && !anId(removing)) return null
  // ⛔ Only a service has a conversation of its own, made or reserved.
  if (kind === 'normal' && (serviceConversation !== undefined || reserved !== undefined))
    return null
  // ⛔ Only the conversation a service has can be being removed.
  if (removing !== undefined && removing !== serviceConversation) return null
  // A v1 reader never knew workers: do not silently discard a downgraded pool.
  if (version === 1 && Object.hasOwn(row, 'workerPools')) return null
  if (workerPools !== undefined && kind !== 'normal') return null
  const pools = workerPools === undefined ? undefined : normalWorkerPools(workerPools)
  if (pools === null) return null
  return {
    kind,
    identityCreatedAt,
    ...(pools === undefined ? {} : { workerPools: pools }),
    ...(serviceConversation === undefined ? {} : { serviceConversation }),
    ...(reserved === undefined ? {} : { reserved }),
    ...(removing === undefined ? {} : { removing }),
    ...(retired === undefined ? {} : { retired }),
  }
}

const aPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Unknown or partial hold fields cannot disappear into an apparently free worker. */
function normalWorkerAssignment(said: unknown): NormalWorkerAssignment | null {
  const assignment = aRecord(said)
  if (assignment === null) return null
  if (Object.keys(assignment).some((key) => key !== 'piece' && key !== 'giver')) return null
  const { piece, giver } = assignment
  return anId(piece) && anId(giver) ? { piece, giver } : null
}

/** Checked and copied, so callers cannot keep unknown fields or overlapping workers. */
function normalWorkerPools(said: unknown): readonly NormalWorkerPool[] | null {
  if (!Array.isArray(said) || said.length > MAX_NORMAL_WORKER_POOLS) return null
  const givers = new Set<string>()
  const conversations = new Set<string>()
  const pools: NormalWorkerPool[] = []
  for (const value of said) {
    const pool = aRecord(value)
    if (pool === null) return null
    if (
      Object.keys(pool).some(
        (key) => !['giver', 'nextNumber', 'workers', 'primaryNeverBorn', 'removing'].includes(key),
      )
    )
      return null
    const { giver, nextNumber, workers, primaryNeverBorn, removing } = pool
    if (!anId(giver) || givers.has(giver) || !aPositiveNumber(nextNumber)) return null
    if (!Array.isArray(workers) || workers.length > MAX_NORMAL_WORKERS_PER_POOL) return null
    if (primaryNeverBorn !== undefined && primaryNeverBorn !== true) return null
    if (removing !== undefined && removing !== true) return null
    if (primaryNeverBorn === true && nextNumber < 2) return null
    givers.add(giver)
    const numbers = new Set<number>()
    const bindings: NormalWorkerBinding[] = []
    for (const value of workers) {
      const worker = aRecord(value)
      if (worker === null) return null
      const { number, conversation, phase, assignment } = worker
      if (!aPositiveNumber(number) || number >= nextNumber || numbers.has(number)) return null
      if (!anId(conversation) || conversations.has(conversation)) return null
      if (phase !== 'reserved' && phase !== 'bound') return null
      const hold = assignment === undefined ? undefined : normalWorkerAssignment(assignment)
      if (hold === null) return null
      numbers.add(number)
      conversations.add(conversation)
      bindings.push({
        number,
        conversation,
        phase,
        ...(hold === undefined ? {} : { assignment: hold }),
      })
    }
    if (primaryNeverBorn === true && numbers.has(1)) return null
    pools.push({
      giver,
      nextNumber,
      workers: bindings,
      ...(primaryNeverBorn === undefined ? {} : { primaryNeverBorn }),
      ...(removing === undefined ? {} : { removing }),
    })
  }
  return pools
}

/**
 * What `file` holds. A missing file holds nothing, and says it was missing; a file that is not
 * JSON, is of another version, or holds an entry this build does not write cannot be read, and says
 * why.
 */
export function readProfileExecution(file: string): ProfileExecutionRead {
  let text: string
  try {
    const fd = openSync(file, 'r')
    try {
      const size = fstatSync(fd).size
      if (size > MAX_PROFILE_EXECUTION_BYTES) return { readable: false, why: 'it is too large' }
      // The extra byte detects a concurrent growth without an unbounded read/allocation.
      const bytes = Buffer.alloc(size + 1)
      let length = 0
      while (length < bytes.length) {
        const read = readSync(fd, bytes, length, bytes.length - length, null)
        if (read === 0) break
        length += read
      }
      if (length > size) return { readable: false, why: 'it grew while being read' }
      text = bytes.subarray(0, length).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { readable: true, kept: NO_PROFILE_EXECUTION, absent: true }
    }
    return { readable: false, why: `it could not be read (${(error as Error).message})` }
  }
  let said: unknown
  try {
    said = JSON.parse(text)
  } catch {
    return { readable: false, why: 'it is not JSON' }
  }
  const whole = aRecord(said)
  if (whole === null) return { readable: false, why: 'it holds no object' }
  const version = whole['version']
  if (version !== 1 && version !== PROFILE_EXECUTION_VERSION) {
    return { readable: false, why: `it is not version ${String(PROFILE_EXECUTION_VERSION)}` }
  }
  const rows = aRecord(whole['profiles'])
  if (rows === null) return { readable: false, why: 'it holds no profiles' }
  // ⚑ `false` reads as on, as a missing switch does.
  const servicesOff = whole['servicesOff']
  if (servicesOff !== undefined && typeof servicesOff !== 'boolean') {
    return { readable: false, why: 'its services switch is not one this app writes' }
  }
  const entries = Object.entries(rows)
  if (entries.length > MAX_PROFILES_KEPT)
    return { readable: false, why: 'it holds too many profiles' }
  const profiles: Record<string, ProfileExecution> = {}
  let workersKept = 0
  for (const [id, row] of entries) {
    const entry = anEntry(row, version)
    if (!anId(id) || entry === null) {
      return {
        readable: false,
        why: `its entry for ${anId(id) ? id : 'a profile'} is not one this app writes`,
      }
    }
    for (const pool of entry.workerPools ?? []) workersKept += pool.workers.length
    if (workersKept > MAX_NORMAL_WORKERS_KEPT)
      return { readable: false, why: 'it holds too many workers' }
    profiles[id] = entry
  }
  return {
    readable: true,
    kept: servicesOff === true ? { servicesOff: true, profiles } : { profiles },
  }
}

/**
 * Write what is kept, replacing what the file held: written beside it, flushed to disk, and
 * renamed, so a reader never sees half a file; then the rename itself is flushed, so a
 * conversation made after this returns is never newer on disk than its reservation.
 */
export function writeProfileExecution(file: string, kept: KeptProfileExecution): void {
  const body = `${JSON.stringify(
    {
      version: PROFILE_EXECUTION_VERSION,
      ...(kept.servicesOff === true ? { servicesOff: true } : {}),
      profiles: kept.profiles,
    },
    null,
    2,
  )}\n`
  if (Buffer.byteLength(body, 'utf8') > MAX_PROFILE_EXECUTION_BYTES)
    throw new Error('profile execution is too large')
  const entries = Object.entries(kept.profiles)
  if (
    entries.length > MAX_PROFILES_KEPT ||
    entries.some(([id, row]) => !anId(id) || anEntry(row, PROFILE_EXECUTION_VERSION) === null)
  )
    throw new Error('profile execution holds an invalid entry')
  let workersKept = 0
  for (const [, entry] of entries) {
    for (const pool of entry.workerPools ?? []) workersKept += pool.workers.length
  }
  if (workersKept > MAX_NORMAL_WORKERS_KEPT)
    throw new Error('profile execution holds too many workers')
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    const fd = openSync(temporary, 'w')
    try {
      writeFileSync(fd, body)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  // Windows cannot flush a folder; flushing the file through a handle that may write puts its
  // name on disk there (`recovery/files.ts`, `syncFolder`).
  const flushed = process.platform === 'win32' ? openSync(file, 'r+') : openSync(dirname(file), 'r')
  try {
    fsyncSync(flushed)
  } finally {
    closeSync(flushed)
  }
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
