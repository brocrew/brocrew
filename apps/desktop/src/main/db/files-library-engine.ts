import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { serialize } from 'node:v8'
import { formOfName } from '../../shared/documents'
import { MAX_CAPABILITY_COUNT } from '../../shared/capabilities'
import { pieceCalled } from '../../shared/piece-called'
import {
  FILES_LIBRARY_BOUNDS as B,
  compareLibraryFiles,
  filesLibraryRequest,
  libraryKind,
  libraryMatches,
  libraryWords,
  libraryUnavailable,
  filesLibraryResult,
  type FilesLibraryQuery,
  type FilesLibraryRequest,
  type FilesLibraryResult,
  type LibraryKeep,
  type LibraryTask,
  type LibraryReadContext,
  type LibraryUnavailable,
} from '../../shared/files-library'
import { currentWorkTitle } from './current-work-title'
import { profileLabel } from '../../shared/runtime-ipc'

type Work = {
  id: string
  parent_id: string | null
  number: number
  owner_session_id: string
  given_by_session_id: string | null
  title: string | null
}
type Resource = {
  id: string
  work_id: string
  role: 'made' | 'input'
  title: string | null
  name: string
  sha256: string
  bytes: number
  added_by_session_id: string | null
  created_at: number
}
type FullTask = {
  row: Work
  label: string
  title: string | null
  breadcrumb: string
  depth: number
}
type FullKeep = LibraryKeep
type Group = { representative: FullKeep; matching: Set<string> }
type Metrics = { rows: number; bytes: number; elapsedMs: number; cacheBytes: number }
type Snapshot = {
  token: string
  context: LibraryReadContext
  readAt: number
  touchedAt: number
  version: number
  metrics: Metrics
}
type FileSnapshot = Snapshot & {
  query: FilesLibraryQuery
  groups: Group[]
  provenance: Map<string, FullKeep[]>
  scopeKeeps: number
  totalKeeps: number
  facets: Extract<FilesLibraryResult, { type: 'files' }>['facets']
}
type TaskSnapshot = Snapshot & { query: string; parent: string | null; tasks: LibraryTask[] }
class Failed extends Error {
  constructor(
    override readonly cause: LibraryUnavailable['cause'],
    readonly unread = 0,
  ) {
    super(cause)
  }
}
const clip = (text: string): string => text.slice(0, 512)
const object = (payload: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(payload)
    if (value !== null && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>
  } catch {
    /* Unread metadata cannot establish complete search coverage. */
  }
  throw new Failed('metadata', 1)
}

/** Owns complete immutable populations on a read-only connection, never a transaction between gestures. */
export class FilesLibraryEngine {
  private readonly db: Database.Database
  private files: FileSnapshot | undefined
  private tasks: TaskSnapshot | undefined
  private visited = 0
  private nativeBytes = 0
  private workingBytes = 0
  private residentBytes = 0
  private started = 0
  private abandoned: () => boolean = () => false
  private closed = false

  constructor(
    file: string,
    private readonly now: () => number = Date.now,
    private readonly trace?: (sql: string, bindings: readonly unknown[]) => void,
  ) {
    this.db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
    try {
      this.db.pragma('query_only = ON')
      this.db.pragma('cache_size = -4096')
      if (this.db.pragma('journal_mode', { simple: true }) !== 'wal') throw new Failed('worker')
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  read(
    input: FilesLibraryRequest,
    context: LibraryReadContext,
    abandoned: () => boolean = () => false,
  ): FilesLibraryResult {
    this.visited = 0
    this.nativeBytes = 0
    this.workingBytes = 0
    this.started = this.now()
    this.abandoned = abandoned
    if (this.closed) return libraryUnavailable('closed')
    try {
      const request = filesLibraryRequest.parse(input)
      this.expire()
      this.residentBytes =
        (this.files?.metrics.cacheBytes ?? 0) + (this.tasks?.metrics.cacheBytes ?? 0)
      if (request.operation === 'release') {
        this.files = undefined
        this.tasks = undefined
        return { type: 'released' }
      }
      if (request.operation === 'query') {
        const snapshot = this.transaction(() => this.buildFiles(request.query, context))
        const result = this.filePage(snapshot, 0, request.size ?? 60, context)
        this.checkedReply(result)
        this.files = snapshot
        return result
      }
      if (request.operation === 'page') {
        const { snapshot, offset } = this.fileCursor(request.cursor, 'files', context)
        return this.checkedReply(this.filePage(snapshot, offset, request.size ?? 60, context))
      }
      if (request.operation === 'provenance') {
        const snapshot = this.requireFiles(request.snapshot, context)
        const group = snapshot.groups.find((one) => one.representative.sha256 === request.sha256)
        const keeps = snapshot.provenance.get(request.sha256)
        if (group === undefined || keeps === undefined) throw new Failed('invalid-cursor')
        const offset =
          request.cursor === undefined
            ? 0
            : this.offset(
                request.cursor,
                snapshot.token,
                `provenance:${request.sha256}`,
                keeps.length,
              )
        const end = Math.min(keeps.length, offset + (request.size ?? 50))
        return this.checkedReply({
          type: 'provenance',
          ...this.stamp(snapshot, context),
          sha256: request.sha256,
          keeps: keeps.slice(offset, end).map((file) => ({
            file: this.displayKeep(file),
            matching: group.matching.has(file.resourceId),
          })),
          total: keeps.length,
          matching: group.matching.size,
          next:
            end < keeps.length
              ? this.cursor(snapshot.token, `provenance:${request.sha256}`, end)
              : null,
        })
      }
      let snapshot: TaskSnapshot
      let offset = 0
      if (request.cursor === undefined) {
        snapshot = this.transaction(() => this.buildTasks(request.query, request.parent, context))
      } else {
        if (this.tasks === undefined) throw new Failed('cursor-expired')
        snapshot = this.tasks
        this.boundContext(snapshot, context)
        if (snapshot.query !== request.query || snapshot.parent !== request.parent)
          throw new Failed('invalid-cursor')
        offset = this.offset(request.cursor, snapshot.token, 'tasks', snapshot.tasks.length)
      }
      const end = Math.min(snapshot.tasks.length, offset + (request.size ?? 50))
      const result = this.checkedReply({
        type: 'tasks',
        ...this.stamp(snapshot, context),
        tasks: snapshot.tasks.slice(offset, end),
        total: snapshot.tasks.length,
        next: end < snapshot.tasks.length ? this.cursor(snapshot.token, 'tasks', end) : null,
      })
      this.tasks = snapshot
      return result
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      return libraryUnavailable(
        error instanceof Failed ? error.cause : 'worker',
        this.visited,
        error instanceof Failed ? error.unread : 0,
      )
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.files = undefined
    this.tasks = undefined
    this.db.close()
  }

  private check(): void {
    if (this.abandoned()) throw new Failed('cancelled')
    if (this.now() - this.started > B.deadlineMs) throw new Failed('budget')
  }
  private counted<T>(row: T): T {
    this.check()
    if (row !== undefined) {
      this.visited++
      this.nativeBytes += serialize(row).byteLength
      if (
        this.visited > B.rows ||
        this.nativeBytes + this.workingBytes + this.residentBytes > B.bytes
      )
        throw new Failed('budget')
      if (typeof row === 'object' && row !== null && 'oversized' in row && row.oversized)
        throw new Failed('budget')
    }
    return row
  }
  private get<T>(sql: string, ...bindings: unknown[]): T | undefined {
    this.trace?.(sql, bindings)
    return this.counted(this.db.prepare(sql).get(...bindings) as T | undefined)
  }
  private *iterate<T>(sql: string, ...bindings: unknown[]): Generator<T> {
    this.check()
    this.trace?.(sql, bindings)
    for (const row of this.db.prepare(sql).iterate(...bindings)) yield this.counted(row as T)
  }
  private version(): number {
    return this.db.pragma('data_version', { simple: true }) as number
  }
  private transaction<T>(build: () => T): T {
    const before = this.version()
    this.db.exec('BEGIN')
    this.db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'work_resource'").get()
    const result = build()
    this.check()
    this.db.exec('COMMIT')
    if (before !== this.version()) throw new Failed('changed')
    return result
  }
  private base(context: LibraryReadContext): Snapshot {
    return {
      token: randomUUID(),
      context: { ...context, givers: [...context.givers].sort() },
      readAt: this.now(),
      touchedAt: this.now(),
      version: this.version(),
      metrics: {
        rows: this.visited,
        bytes: this.nativeBytes + this.workingBytes + this.residentBytes,
        elapsedMs: this.now() - this.started,
        cacheBytes: 0,
      },
    }
  }
  private cacheSize(snapshot: FileSnapshot | TaskSnapshot): number {
    return serialize(snapshot).byteLength
  }
  private finish<T extends FileSnapshot | TaskSnapshot>(snapshot: T, other?: Snapshot): T {
    snapshot.metrics.cacheBytes = this.cacheSize(snapshot)
    const combined = snapshot.metrics.cacheBytes + (other?.metrics.cacheBytes ?? 0)
    if (combined > B.bytes) throw new Failed('budget')
    return snapshot
  }
  private expire(): void {
    if (this.files !== undefined && this.now() - this.files.touchedAt >= B.idleMs)
      this.files = undefined
    if (this.tasks !== undefined && this.now() - this.tasks.touchedAt >= B.idleMs)
      this.tasks = undefined
  }
  private boundContext(snapshot: Snapshot, context: LibraryReadContext): void {
    if (snapshot.context.workspace !== context.workspace) throw new Failed('invalid-cursor')
  }
  private stamp(snapshot: Snapshot, context: LibraryReadContext) {
    this.boundContext(snapshot, context)
    snapshot.touchedAt = this.now()
    return {
      snapshot: snapshot.token,
      readAt: snapshot.readAt,
      metrics: snapshot.metrics,
      stale:
        snapshot.context.hostRevision !== context.hostRevision ||
        snapshot.version !== this.version() ||
        JSON.stringify(snapshot.context.givers) !== JSON.stringify([...context.givers].sort()),
    }
  }
  private cursor(token: string, kind: string, offset: number): string {
    return Buffer.from(JSON.stringify([token, kind, offset])).toString('base64url')
  }
  private offset(cursor: string, token: string, kind: string, length: number): number {
    try {
      const data: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (
        Array.isArray(data) &&
        data.length === 3 &&
        data[0] === token &&
        data[1] === kind &&
        Number.isSafeInteger(data[2]) &&
        data[2] > 0 &&
        data[2] < length &&
        this.cursor(token, kind, data[2] as number) === cursor
      )
        return data[2] as number
    } catch {
      /* A cursor identifies only a retained population and offset. */
    }
    throw new Failed('invalid-cursor')
  }
  private requireFiles(token: string, context: LibraryReadContext): FileSnapshot {
    if (this.files === undefined) throw new Failed('cursor-expired')
    if (this.files.token !== token) throw new Failed('invalid-cursor')
    this.boundContext(this.files, context)
    return this.files
  }
  private fileCursor(cursor: string, kind: string, context: LibraryReadContext) {
    if (this.files === undefined) throw new Failed('cursor-expired')
    this.boundContext(this.files, context)
    return {
      snapshot: this.files,
      offset: this.offset(cursor, this.files.token, kind, this.files.groups.length),
    }
  }
  private checkedReply<T extends FilesLibraryResult>(result: T): T {
    if (serialize(result).byteLength > B.replyBytes) throw new Failed('budget')
    filesLibraryResult.parse(result)
    return result
  }
  private displayKeep(file: FullKeep): LibraryKeep {
    const values = [
      file.title,
      file.name,
      file.label,
      file.breadcrumb,
      file.pieceTitle ?? '',
      file.addedBy?.name ?? '',
    ]
    return {
      ...file,
      title: clip(file.title),
      name: clip(file.name),
      label: clip(file.label),
      breadcrumb: clip(file.breadcrumb),
      pieceTitle: file.pieceTitle === null ? null : clip(file.pieceTitle),
      clipped: values.some((value) => value.length > 512),
      addedBy: file.addedBy === null ? null : { ...file.addedBy, name: clip(file.addedBy.name) },
    }
  }
  private filePage(
    snapshot: FileSnapshot,
    offset: number,
    size: number,
    context: LibraryReadContext,
  ): FilesLibraryResult {
    const end = Math.min(snapshot.groups.length, offset + size)
    return {
      type: 'files',
      ...this.stamp(snapshot, context),
      files: snapshot.groups.slice(offset, end).map((group) => ({
        file: this.displayKeep(group.representative),
        matchingKeeps: group.matching.size,
      })),
      totalFiles: snapshot.groups.length,
      totalKeeps: snapshot.totalKeeps,
      scopeKeeps: snapshot.scopeKeeps,
      facets: snapshot.facets,
      next: end < snapshot.groups.length ? this.cursor(snapshot.token, 'files', end) : null,
    }
  }

  private metadata() {
    const tasks = new Map<string, FullTask>()
    const owners = new Map<string, Map<string, Record<string, unknown>>>()
    const people = new Map<string, LibraryKeep['addedBy']>()
    const newest = (owner: string): Map<string, Record<string, unknown>> => {
      const known = owners.get(owner)
      if (known !== undefined) return known
      const generation =
        this.get<{ active: number }>(
          'SELECT active FROM derived_generation WHERE session_id = ?',
          owner,
        )?.active ?? 0
      const found = new Map<string, Record<string, unknown>>()
      for (const row of this.iterate<{ payload: string }>(
        `SELECT
          CASE WHEN length(CAST(payload AS BLOB)) <= ${B.fieldBytes} THEN payload END AS payload,
          length(CAST(payload AS BLOB)) > ${B.fieldBytes} AS oversized
          FROM events INDEXED BY events_kind_owner_idx
          WHERE type = 'work_retitled' AND session_id = ? AND generation = ? ORDER BY ordinal DESC`,
        owner,
        generation,
      )) {
        const said = object(row.payload)
        if (typeof said.piece !== 'string' || typeof said.title !== 'string')
          throw new Failed('metadata', 1)
        if (!found.has(said.piece)) {
          this.allocated(said)
          found.set(said.piece, said)
        }
      }
      owners.set(owner, found)
      return found
    }
    const task = (id: string, path = new Set<string>()): FullTask => {
      const known = tasks.get(id)
      if (known !== undefined) {
        if (known.depth + path.size > MAX_CAPABILITY_COUNT + 2) throw new Failed('ancestry')
        return known
      }
      if (path.has(id) || path.size >= MAX_CAPABILITY_COUNT + 2) throw new Failed('ancestry')
      path.add(id)
      const row = this.get<Work>(
        `SELECT id, parent_id, number, owner_session_id, given_by_session_id,
        CASE WHEN length(CAST(title AS BLOB)) <= ${B.fieldBytes} THEN title END AS title,
        length(CAST(title AS BLOB)) > ${B.fieldBytes} AS oversized FROM work WHERE id = ?`,
        id,
      )
      if (row === undefined || !Number.isSafeInteger(row.number) || row.number < 1)
        throw new Failed('ancestry')
      const parent = row.parent_id === null ? null : task(row.parent_id, path)
      const title = currentWorkTitle(row.title, newest(row.owner_session_id).get(row.id) ?? null)
      const label = parent === null ? pieceCalled([row.number]) : `${parent.label}.${row.number}`
      const breadcrumb =
        (parent === null ? '' : `${parent.breadcrumb} / `) +
        `${label}${title === null ? '' : ` · ${title}`}`
      const depth = (parent?.depth ?? 0) + 1
      if (depth > MAX_CAPABILITY_COUNT + 2) throw new Failed('ancestry')
      const result = { row, label, title, breadcrumb, depth }
      this.allocated(result)
      tasks.set(id, result)
      return result
    }
    const person = (id: string | null): LibraryKeep['addedBy'] => {
      if (id === null) return null
      const known = people.get(id)
      if (known !== undefined) return known
      const row = this.get<{ slug: string | null; name: string | null }>(
        `SELECT i.slug,
        CASE WHEN length(CAST(i.display_name AS BLOB)) <= ${B.fieldBytes} THEN i.display_name END AS name,
        length(CAST(i.display_name AS BLOB)) > ${B.fieldBytes} AS oversized
        FROM provider_session s LEFT JOIN agent_identity i ON i.id = s.agent_identity_id WHERE s.id = ?`,
        id,
      )
      if (row === undefined) throw new Failed('metadata', 1)
      const result = {
        conversation: id,
        identity: row.slug,
        name:
          row.slug === null
            ? 'an agent this app cannot name'
            : (row.name ?? profileLabel(row.slug)),
      }
      this.allocated(result)
      people.set(id, result)
      return result
    }
    const keep = (row: Resource): FullKeep => {
      if (
        !/^[0-9a-f]{64}$/.test(row.sha256) ||
        !['made', 'input'].includes(row.role) ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 0 ||
        !Number.isSafeInteger(row.created_at) ||
        Math.abs(row.created_at) > 8_640_000_000_000_000 ||
        row.id.length === 0 ||
        row.id.length > 200
      )
        throw new Failed('metadata', 1)
      const on = task(row.work_id)
      const result = {
        resourceId: row.id,
        title: row.title ?? row.name,
        name: row.name,
        clipped: false,
        sha256: row.sha256,
        bytes: row.bytes,
        role: row.role,
        keptAt: row.created_at,
        addedBy: person(row.added_by_session_id),
        piece: row.work_id,
        label: on.label,
        pieceTitle: on.title,
        breadcrumb: on.breadcrumb,
        form: formOfName(row.name),
      }
      this.allocated(result)
      return result
    }
    return { task, keep }
  }

  private represented(session: string, supplied: readonly string[]): string[] {
    if (this.get('SELECT id FROM provider_session WHERE id = ?', session) === undefined)
      throw new Failed('missing-conversation')
    const edges = new Map<string, string>()
    for (const row of this.iterate<{ session_id: string; payload: string }>(`SELECT e.session_id,
      CASE WHEN length(CAST(e.payload AS BLOB)) <= ${B.fieldBytes} THEN e.payload END AS payload,
      length(CAST(e.payload AS BLOB)) > ${B.fieldBytes} AS oversized
      FROM events e INDEXED BY events_kind_owner_idx
      LEFT JOIN derived_generation g ON g.session_id = e.session_id
      WHERE e.type = 'replaced_by' AND e.generation = coalesce(g.active, 0)`)) {
      const said = object(row.payload)
      if (
        typeof said.sessionId !== 'string' ||
        edges.has(row.session_id) ||
        this.get('SELECT id FROM provider_session WHERE id = ?', said.sessionId) === undefined
      )
        throw new Failed('metadata', 1)
      edges.set(row.session_id, said.sessionId)
    }
    const represented = [session]
    for (const old of edges.keys()) {
      let current = old
      const visited = new Set<string>()
      while (edges.has(current)) {
        this.check()
        if (visited.has(current) || visited.size >= 64) throw new Failed('metadata', 1)
        visited.add(current)
        current = edges.get(current)!
      }
      if (old !== session && current === session) represented.push(old)
    }
    if (
      new Set(supplied).size !== supplied.length ||
      JSON.stringify([...supplied].sort()) !== JSON.stringify(represented.sort())
    )
      throw new Failed('changed')
    return represented
  }

  private scope(
    query: FilesLibraryQuery,
    context: LibraryReadContext,
    task: (id: string) => FullTask,
  ): Set<string> | null {
    const scope = query.scope
    if (scope.type === 'workspace') return null
    if (scope.type === 'task') {
      if (this.get('SELECT id FROM work WHERE id = ?', scope.id) === undefined)
        throw new Failed('missing-task')
      task(scope.id)
    }
    const givers =
      scope.type === 'conversationWork' ? this.represented(scope.id, context.givers) : []
    const seed =
      scope.type === 'task'
        ? 'SELECT id FROM work WHERE id = @id'
        : 'SELECT id FROM work WHERE owner_session_id = @id OR given_by_session_id IN (SELECT value FROM json_each(@givers))'
    const sql = `WITH RECURSIVE selected(id) AS (${seed}${
      scope.includeSubtasks
        ? ' UNION SELECT w.id FROM work w JOIN selected s ON w.parent_id = s.id'
        : ''
    }) SELECT id FROM selected`
    const selected = new Set<string>()
    for (const row of this.iterate<{ id: string }>(
      sql,
      scope.type === 'task' ? { id: scope.id } : { id: scope.id, givers: JSON.stringify(givers) },
    )) {
      task(row.id)
      selected.add(row.id)
    }
    return selected
  }
  private allocated(value: unknown): void {
    this.workingBytes += serialize(value).byteLength + 128
    if (this.nativeBytes + this.workingBytes + this.residentBytes > B.bytes)
      throw new Failed('budget')
  }
  private *resources(): Generator<Resource> {
    let after = Number.NEGATIVE_INFINITY
    for (;;) {
      let count = 0
      for (const row of this.iterate<Resource & { at: number }>(
        `SELECT rowid AS at,
        id, work_id, role, sha256, bytes, added_by_session_id, created_at,
        CASE WHEN length(CAST(title AS BLOB)) <= ${B.fieldBytes} THEN title END AS title,
        CASE WHEN length(CAST(name AS BLOB)) <= ${B.fieldBytes} THEN name END AS name,
        (length(CAST(title AS BLOB)) > ${B.fieldBytes} OR length(CAST(name AS BLOB)) > ${B.fieldBytes}) AS oversized
        FROM work_resource WHERE rowid > ? ORDER BY rowid LIMIT ${B.page}`,
        after,
      )) {
        if (!Number.isSafeInteger(row.at) || row.at <= after) throw new Failed('metadata', 1)
        after = row.at
        count++
        yield row
      }
      if (count < B.page) break
    }
  }
  private buildFiles(query: FilesLibraryQuery, context: LibraryReadContext): FileSnapshot {
    const metadata = this.metadata()
    const selected = this.scope(query, context, metadata.task)
    const groups = new Map<string, Group>()
    const kinds = {
      all: new Set<string>(),
      documents: new Set<string>(),
      images: new Set<string>(),
    }
    const roles = { all: new Set<string>(), made: new Set<string>(), input: new Set<string>() }
    const tokens = libraryWords(query.query)
    let totalKeeps = 0,
      scopeKeeps = 0
    for (const row of this.resources()) {
      if (selected !== null && !selected.has(row.work_id)) continue
      scopeKeeps++
      const file = metadata.keep(row)
      const kind = libraryKind(file.name)
      if (
        !libraryMatches(
          [
            file.name,
            file.title,
            file.label,
            file.breadcrumb,
            file.addedBy?.name ?? 'person',
            file.addedBy?.identity ?? '',
            file.role,
            kind,
            file.form ?? 'unknown',
          ],
          tokens,
        )
      )
        continue
      const roleMatches = query.role === 'all' || file.role === query.role
      const kindMatches = query.kind === 'all' || kind === query.kind
      if (roleMatches) {
        kinds.all.add(file.sha256)
        if (kind !== 'unknown') kinds[kind].add(file.sha256)
      }
      if (kindMatches) {
        roles.all.add(file.sha256)
        roles[file.role].add(file.sha256)
      }
      if (!roleMatches || !kindMatches) continue
      totalKeeps++
      const group = groups.get(file.sha256)
      if (group === undefined)
        groups.set(file.sha256, { representative: file, matching: new Set([file.resourceId]) })
      else {
        group.matching.add(file.resourceId)
        if (
          file.keptAt > group.representative.keptAt ||
          (file.keptAt === group.representative.keptAt &&
            file.resourceId > group.representative.resourceId)
        )
          group.representative = file
      }
    }
    const provenance = new Map<string, FullKeep[]>()
    if (groups.size > 0)
      for (const row of this.resources()) {
        if (!groups.has(row.sha256)) continue
        const keeps = provenance.get(row.sha256) ?? []
        keeps.push(metadata.keep(row))
        provenance.set(row.sha256, keeps)
      }
    for (const keeps of provenance.values())
      keeps.sort((a, b) => b.keptAt - a.keptAt || b.resourceId.localeCompare(a.resourceId, 'en'))
    const ordered = [...groups.values()].sort((a, b) =>
      compareLibraryFiles(a.representative, b.representative, query.sort),
    )
    return this.finish(
      {
        ...this.base(context),
        query,
        groups: ordered,
        provenance,
        scopeKeeps,
        totalKeeps,
        facets: {
          kinds: {
            all: kinds.all.size,
            documents: kinds.documents.size,
            images: kinds.images.size,
          },
          roles: { all: roles.all.size, made: roles.made.size, input: roles.input.size },
        },
      },
      this.tasks,
    )
  }
  private buildTasks(
    query: string,
    parent: string | null,
    context: LibraryReadContext,
  ): TaskSnapshot {
    const metadata = this.metadata()
    if (parent !== null) {
      if (this.get('SELECT id FROM work WHERE id = ?', parent) === undefined)
        throw new Failed('missing-task')
      metadata.task(parent)
    }
    const tokens = libraryWords(query)
    const tasks: LibraryTask[] = []
    let after = Number.NEGATIVE_INFINITY
    for (;;) {
      let count = 0
      const sql =
        tokens.length > 0
          ? `SELECT rowid AS at, id FROM work WHERE rowid > @after ORDER BY rowid LIMIT ${B.page}`
          : `SELECT rowid AS at, id FROM work WHERE parent_id IS @parent AND rowid > @after ORDER BY rowid LIMIT ${B.page}`
      for (const row of this.iterate<{ at: number; id: string }>(
        sql,
        tokens.length > 0 ? { after } : { after, parent },
      )) {
        if (!Number.isSafeInteger(row.at) || row.at <= after) throw new Failed('metadata', 1)
        after = row.at
        count++
        const task = metadata.task(row.id)
        if (!libraryMatches([task.label, task.title ?? '', task.breadcrumb], tokens)) continue
        // Iterating the indexed children counts work done as well as returned metadata.
        let children = 0
        for (const child of this.iterate<{ id: string }>(
          'SELECT id FROM work WHERE parent_id = ?',
          row.id,
        )) {
          if (typeof child.id !== 'string') throw new Failed('metadata', 1)
          children++
        }
        tasks.push({
          id: row.id,
          label: clip(task.label),
          title: task.title === null ? null : clip(task.title),
          breadcrumb: clip(task.breadcrumb),
          children,
          clipped: [task.label, task.title ?? '', task.breadcrumb].some(
            (value) => value.length > 512,
          ),
        })
      }
      if (count < B.page) break
    }
    tasks.sort(
      (a, b) =>
        a.label.localeCompare(b.label, 'en', { numeric: true }) || a.id.localeCompare(b.id, 'en'),
    )
    return this.finish({ ...this.base(context), query, parent, tasks }, this.files)
  }
}
