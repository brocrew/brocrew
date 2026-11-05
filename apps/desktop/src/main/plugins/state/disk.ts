import { randomUUID } from 'node:crypto'
import { openPluginSqlite, type PluginSqlite } from '../sqlite-contract'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  lstatSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { PluginFence } from './fence'
import { syncDirectory } from '../private-files'
import {
  WorkspacePluginChoice,
  workspacePluginKey,
  decodeState,
  encodeState,
  Event,
  Installation,
  JournalRecord,
  Operation,
  ProjectionReceipt,
  refuseState,
} from './format'
import { foldRecord, type LifecycleState, newLifecycle } from './machine'
import { readLegacyPluginState } from './legacy'

export interface PluginDiskOptions {
  root: string
  workspaceRoots: readonly string[]
  fault?: (point: 'staged' | 'published' | 'durable') => void
}
const OperationRecord = z.object({
  operation: Operation,
  status: z.enum(['prepared', 'completed', 'aborted']),
})
type OperationRecord = z.infer<typeof OperationRecord>
const Snapshot = z.object({
  format: z.literal(2),
  rootId: z.uuid(),
  epoch: z.uuid(),
  sequence: z.number().int().nonnegative().safe(),
  installations: z.array(Installation),
  active: z.array(Installation),
  operations: z.array(OperationRecord).optional(),
  recentOperations: z.array(OperationRecord).optional(),
  pending: Operation.nullable(),
  projections: z.array(ProjectionReceipt),
  workspaceEnabled: z.array(WorkspacePluginChoice).optional(),
  workspaceTitlesEnabled: z.array(WorkspacePluginChoice).optional(),
})
function decodeSnapshot(bytes: Buffer): LifecycleState {
  const value = decodeState(bytes, Snapshot),
    state = newLifecycle()
  state.rootId = value.rootId
  state.epoch = value.epoch
  state.sequence = value.sequence
  state.head = String(value.sequence)
  state.guards = new Map(value.installations.map((entry) => [entry.pluginId, entry]))
  state.admitted = new Map(value.active.map((entry) => [entry.pluginId, entry]))
  state.operations = new Map(
    (value.recentOperations ?? value.operations ?? []).map((entry) => [
      entry.operation.request.operationId,
      entry,
    ]),
  )
  state.pending = value.pending
  state.projections = new Map(
    value.projections.map((entry) => [`${entry.workspaceId}/${entry.pluginId}`, entry]),
  )
  for (const field of ['workspaceEnabled', 'workspaceTitlesEnabled'] as const)
    state[field] = new Map(
      (value[field] ?? []).map((entry) => [
        workspacePluginKey(entry.workspaceId, entry.pluginId),
        entry,
      ]),
    )
  return state
}
type Publication = { path: string; ordinal: string; cursor: string }
const publicationName = /^(\d{16})-c(r|\d{16})\.json$/
const lastOrdinal = 9999999999999999n
function publications(root: string): Publication[] {
  let entries
  try {
    entries = readdirSync(join(root, 'snapshots'), { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const seen = new Set<string>()
  return entries
    .map((entry) => {
      const match = publicationName.exec(entry.name)
      if (!match || match[0] !== entry.name || !entry.isFile() || seen.has(match[1]!))
        refuseState('corrupt')
      seen.add(match[1]!)
      return { path: join(root, 'snapshots', entry.name), ordinal: match[1]!, cursor: match[2]! }
    })
    .sort((a, b) => a.ordinal.localeCompare(b.ordinal))
}
function selectedBytes(root: string): { bytes?: Buffer; publication?: Publication } {
  for (let attempt = 0; attempt < 2; attempt++) {
    const publication = publications(root).at(-1)
    if (publication) {
      try {
        return { bytes: readFileSync(publication.path), publication }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && attempt === 0) continue
        throw error
      }
    }
    try {
      return { bytes: readFileSync(join(root, 'installed-state.json')) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return {}
    }
  }
  return refuseState('corrupt')
}
function readState(root: string): LifecycleState {
  const selected = selectedBytes(root)
  return selected.bytes ? decodeSnapshot(selected.bytes) : readLegacyPluginState(root)
}
function prune(queue: Publication[]): void {
  for (const publication of queue) {
    try {
      unlinkSync(publication.path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'EPERM' && code !== 'EBUSY')
        console.warn('Plugin snapshot cleanup failed', error)
    }
  }
}
/** Read-only display uses the same atomic selection as production, including old journal input. */
export function readInstalledPluginDescriptor(options: PluginDiskOptions, id: string) {
  try {
    const state = readState(resolve(options.root))
    const installed = state.admitted.get(id)
    if (!installed) return null
    return Object.freeze({
      version: installed.release.version,
      archiveSha256: installed.release.archiveSha256,
      manifestSha256: installed.release.manifestSha256,
    })
  } catch {
    return null
  }
}

/** Immutable selections, with ordinary serialized writes across app copies. */
export class PluginStateDisk {
  readonly root: string
  private lock?: PluginFence
  private closed = false
  private archive?: PluginSqlite
  constructor(
    private readonly options: PluginDiskOptions,
    _create = false,
    private readonly readOnly = false,
  ) {
    void _create
    this.root = resolve(options.root)
    if (!readOnly) {
      mkdirSync(this.root, { recursive: true })
      this.lock = PluginFence.acquire(join(this.root, 'writer-lock.sqlite'))
    }
  }
  private check(): void {
    if (this.closed) refuseState('conflict')
  }
  private exclusive<T>(run: () => T): T {
    this.check()
    return this.lock ? this.lock.sync(this, run) : run()
  }
  withExclusive<T>(run: () => Promise<T>): Promise<T> {
    this.check()
    if (!this.lock) refuseState('conflict')
    return this.lock.async(this, run)
  }
  load(_keptActivations?: Set<string>): LifecycleState {
    void _keptActivations
    return this.read((state) => structuredClone(state))
  }
  /** One synchronous selection; callers cannot retain its private maps for mutation. */
  read<T>(select: (state: LifecycleState) => T): T {
    this.check()
    const read = () => readState(this.root)
    return select(this.lock ? this.lock.readSnapshot(read) : read())
  }
  retainOwnerReadSnapshot(): () => void {
    this.check()
    if (!this.lock) refuseState('conflict')
    return this.lock.retainSnapshot()
  }
  loadForObservation(): LifecycleState {
    return this.load()
  }
  private historyDatabase(): PluginSqlite {
    if (this.readOnly) refuseState('conflict')
    if (!this.archive) {
      this.archive = openPluginSqlite(join(this.root, 'operations.sqlite'), { timeout: 0 })
      this.archive.exec(
        'CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, value TEXT NOT NULL, status TEXT NOT NULL)',
      )
    }
    return this.archive
  }
  private archiveOperation(record: OperationRecord, sequence: number): void {
    this.historyDatabase()
      .prepare(
        'INSERT INTO operations (id, sequence, value, status) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status',
      )
      .run(record.operation.request.operationId, sequence, JSON.stringify(record), record.status)
  }
  operation(id: string): OperationRecord | undefined {
    return this.exclusive(() => {
      const state = readState(this.root)
      const current = state.operations.get(id)
      if (current) return current
      const row = this.historyDatabase()
        .prepare('SELECT value FROM operations WHERE id = ?')
        .get(id) as { value: string } | undefined
      return row ? OperationRecord.parse(JSON.parse(row.value)) : undefined
    })
  }
  operationHistory(view: LifecycleState): OperationRecord[] {
    if (!existsSync(join(this.root, 'operations.sqlite'))) return [...view.operations.values()]
    const read = (database: PluginSqlite) => {
      const rows = database
        .prepare(
          "SELECT value FROM operations WHERE status <> 'prepared' AND sequence <= ? ORDER BY sequence, id",
        )
        .all(view.sequence) as Array<{ value: string }>
      const records = new Map(
        rows.map((row) => {
          const value = OperationRecord.parse(JSON.parse(row.value))
          return [value.operation.request.operationId, value]
        }),
      )
      for (const [id, record] of view.operations) records.set(id, record)
      return [...records.values()]
    }
    if (this.closed) {
      const database = openPluginSqlite(join(this.root, 'operations.sqlite'), {
        readonly: true,
        fileMustExist: true,
      })
      try {
        return read(database)
      } finally {
        database.close()
      }
    }
    return this.exclusive(() => read(this.historyDatabase()))
  }
  recoveryOperations(): OperationRecord[] {
    return [...this.load().operations.values()]
  }
  private compact(state: LifecycleState): void {
    const recent = new Map<string, OperationRecord>()
    for (const record of state.operations.values())
      recent.set(record.operation.request.consent.pluginId ?? '', record)
    state.operations = new Map(
      [...recent.values()].map((record) => [record.operation.request.operationId, record]),
    )
  }
  private save(state: LifecycleState): void {
    if (this.readOnly) refuseState('conflict')
    this.compact(state)
    const bytes = encodeState({
      format: 2,
      rootId: state.rootId,
      epoch: state.epoch,
      sequence: state.sequence,
      installations: [...state.guards.values()],
      active: [...state.admitted.values()],
      recentOperations: [...state.operations.values()],
      pending: state.pending,
      projections: [...state.projections.values()],
      workspaceEnabled: [...state.workspaceEnabled.values()],
      workspaceTitlesEnabled: [...state.workspaceTitlesEnabled.values()],
    })
    const files = publications(this.root),
      previous = files.at(-1)
    if (previous) decodeSnapshot(readFileSync(previous.path))
    const next = previous ? BigInt(previous.ordinal) + 1n : 0n
    if (next > lastOrdinal) refuseState('limit')
    const eligible = previous
      ? files.filter((file) => file.ordinal < previous.ordinal).reverse()
      : []
    const cursor = previous?.cursor ?? 'r'
    const ordered =
      cursor === 'r'
        ? eligible
        : [
            ...eligible.filter((file) => file.ordinal < cursor),
            ...eligible.filter((file) => file.ordinal >= cursor),
          ]
    const queue = ordered.slice(0, 4),
      nextCursor = queue.at(-1)?.ordinal ?? cursor
    const folder = join(this.root, 'snapshots')
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const target = join(folder, next.toString().padStart(16, '0') + '-c' + nextCursor + '.json')
    try {
      lstatSync(target)
      refuseState('conflict')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const temporary = join(this.root, '.installed-state-stage')
    try {
      unlinkSync(temporary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      try {
        writeFileSync(fd, bytes)
        fsyncSync(fd)
        this.options.fault?.('staged')
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, target)
      this.lock?.published()
      this.options.fault?.('published')
      if (process.platform !== 'win32') {
        for (const path of [folder, this.root]) {
          const directory = openSync(path, 'r')
          try {
            syncDirectory(directory)
          } finally {
            closeSync(directory)
          }
        }
      }
      this.options.fault?.('durable')
      prune(queue)
    } finally {
      try {
        unlinkSync(temporary)
      } catch {
        // A later writer removes an abandoned stage before its exclusive open.
      }
    }
  }
  /** Opening imports a legacy selection once; old journals and all plugin data remain untouched. */
  reclaim(): void {
    this.exclusive(() => {
      const selected = selectedBytes(this.root)
      const state = selected.bytes
        ? decodeSnapshot(selected.bytes)
        : readLegacyPluginState(this.root)
      if (state.sequence < 0)
        this.apply(state, { kind: 'created', rootId: randomUUID(), epoch: randomUUID() })
      const database = this.historyDatabase()
      const insert = database.prepare(
        'INSERT OR IGNORE INTO operations (id, sequence, value, status) VALUES (?, ?, ?, ?)',
      )
      database.transaction(() => {
        let sequence = 0
        for (const record of state.operations.values())
          insert.run(
            record.operation.request.operationId,
            sequence++,
            JSON.stringify(record),
            record.status,
          )
      })()
      if (
        selected.publication &&
        selected.bytes &&
        JSON.parse(selected.bytes.toString()).recentOperations !== undefined
      )
        return
      this.save(state)
    })
  }
  private current(previous: LifecycleState): LifecycleState {
    const current = readState(this.root)
    if (current.sequence !== previous.sequence) refuseState('conflict')
    return current
  }
  private apply(state: LifecycleState, event: Event): void {
    foldRecord(
      state,
      { sequence: state.sequence + 1, previous: null, publicationId: randomUUID(), event },
      '',
    )
  }
  prepare(previous: LifecycleState, operation: Operation): void {
    this.exclusive(() => {
      const state = this.current(previous)
      if (state.pending) refuseState('busy')
      this.apply(state, { kind: 'prepared', operation })
      this.archiveOperation({ operation, status: 'prepared' }, state.sequence)
      this.save(state)
    })
  }
  resolve(previous: LifecycleState, success: boolean): void {
    this.exclusive(() => {
      const state = this.current(previous)
      if (!state.pending) refuseState('conflict')
      const operation = state.pending
      this.apply(state, {
        kind: success ? 'completed' : 'aborted',
        operationId: operation.request.operationId,
      })
      this.archiveOperation(
        { operation, status: success ? 'completed' : 'aborted' },
        state.sequence,
      )
      this.save(state)
    })
  }
  append(previous: LifecycleState, event: JournalRecord['event']): void {
    this.exclusive(() => {
      const state = this.current(previous)
      if (
        state.pending &&
        (event.kind !== 'projected' ||
          state.pending.request.consent.action === 'global-restore' ||
          state.pending.request.consent.pluginId === event.pluginId)
      )
        refuseState('busy')
      this.apply(state, event)
      this.save(state)
    })
  }
  setWorkspaceChoice(
    field: 'workspaceEnabled' | 'workspaceTitlesEnabled',
    workspaceId: string,
    pluginId: string,
    enabled: boolean,
  ) {
    return this.exclusive(() => {
      const state = readState(this.root)
      const key = workspacePluginKey(workspaceId, pluginId)
      const before = state[field].get(key) ?? {
        enabled: field === 'workspaceEnabled',
        revision: 0,
      }
      if (before.enabled === enabled) return { enabled, revision: before.revision }
      const row = WorkspacePluginChoice.parse({
        workspaceId,
        pluginId,
        enabled,
        revision: before.revision + 1,
      })
      state[field].set(key, row)
      state.sequence++
      this.save(state)
      return { enabled: row.enabled, revision: row.revision }
    })
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.archive?.close()
    this.archive = undefined
    this.lock?.release()
    this.lock = undefined
  }
}
