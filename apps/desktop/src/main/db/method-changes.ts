import { createHash } from 'node:crypto'
import type { ActedBy } from '../../shared/who-did-it'
import type { AppDatabase } from './connection'

export interface MethodFileImage {
  readonly base64: string
  readonly fingerprint: string
  readonly mode: number
}

export interface MethodFileChange {
  readonly name: string
  readonly before: MethodFileImage | null
  readonly after: string | null
  /** Absent on legacy records whose planned permissions were not kept. */
  readonly afterMode?: number | null
}

export interface MethodFileState {
  readonly name: string
  readonly fingerprint: string | null
  readonly unreadable?: true
  /** Null means absent or unreadable; omitted means permissions were not recorded. */
  readonly mode?: number | null
}

export interface MethodChangeIntent {
  readonly operation: 'delete' | 'undo'
  readonly sourceId: string | null
  readonly target: string
  readonly files: readonly MethodFileChange[]
}

export interface MethodSettlement {
  readonly by: { readonly who: 'a-person' } | { readonly who: 'the-app-itself' }
  readonly at: number
}

export interface MethodChangeRecord extends MethodChangeIntent {
  readonly id: string
  readonly sequence: number
  readonly by: { readonly who: 'a-person' }
  readonly outcome: 'pending' | 'done' | 'partial'
  readonly actual: readonly MethodFileState[] | null
  readonly createdAt: number
  readonly settlement: MethodSettlement | null
}

export interface MethodChangeStore {
  hasPending(identityId: string): boolean
  begin(
    identityId: string,
    said: MethodChangeIntent,
    by: ActedBy,
    at: number,
  ): MethodChangeRecord | null
  settle(
    identityId: string,
    id: string,
    outcome: 'done' | 'partial',
    actual: readonly MethodFileState[],
    by: ActedBy,
  ): boolean
  read(identityId: string, id: string): MethodChangeRecord | null
  list(identityId: string, offset: number, limit: number): readonly MethodChangeRecord[]
}

/** Internal startup observation; deliberately not forwarded through SessionStore. */
export interface MethodChangeReconciler {
  reconcile(
    identityId: string,
    id: string,
    actual: readonly MethodFileState[],
    by: ActedBy,
  ): boolean
}

const SHA256 = /^[0-9a-f]{64}$/
const FILE_BYTES = 16 * 1024
const INDEX_BYTES = 64 * 1024

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Names are copied from a fresh managed inventory, never accepted as relative paths. */
export function methodChangeName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    /\.md$/i.test(name) &&
    Buffer.byteLength(name) <= 255
  )
}

function fingerprint(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && SHA256.test(value))
}

function permissionMode(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0o777)
  )
}

function filesFrom(value: unknown): readonly MethodFileChange[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null
  const names = new Set<string>()
  const files: MethodFileChange[] = []
  let totalBytes = 0
  for (const entry of value) {
    const row = object(entry)
    if (
      row === null ||
      !methodChangeName(row['name']) ||
      names.has(row['name']) ||
      !fingerprint(row['after']) ||
      (row['afterMode'] !== undefined &&
        (!permissionMode(row['afterMode']) ||
          (row['after'] === null ? row['afterMode'] !== null : row['afterMode'] === null)))
    )
      return null
    const name = row['name']
    names.add(name)
    let before: MethodFileImage | null = null
    if (row['before'] !== null) {
      const image = object(row['before'])
      if (
        image === null ||
        typeof image['base64'] !== 'string' ||
        typeof image['fingerprint'] !== 'string' ||
        !SHA256.test(image['fingerprint']) ||
        typeof image['mode'] !== 'number' ||
        !Number.isInteger(image['mode']) ||
        image['mode'] < 0 ||
        image['mode'] > 0o777
      )
        return null
      const limit = name.toLowerCase() === 'index.md' ? INDEX_BYTES : FILE_BYTES
      if (image['base64'].length > Math.ceil(limit / 3) * 4) return null
      const bytes = Buffer.from(image['base64'], 'base64')
      if (
        bytes.length > limit ||
        bytes.toString('base64') !== image['base64'] ||
        createHash('sha256').update(bytes).digest('hex') !== image['fingerprint']
      )
        return null
      totalBytes += bytes.length
      if (totalBytes > INDEX_BYTES + FILE_BYTES) return null
      before = { base64: image['base64'], fingerprint: image['fingerprint'], mode: image['mode'] }
    }
    files.push({
      name,
      before,
      after: row['after'],
      ...(row['afterMode'] === undefined ? {} : { afterMode: row['afterMode'] as number | null }),
    })
  }
  return files
}

function statesFrom(
  value: unknown,
  files: readonly MethodFileChange[],
): readonly MethodFileState[] | null {
  if (!Array.isArray(value) || value.length !== files.length) return null
  const states: MethodFileState[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const row = object(entry)
    if (
      row === null ||
      typeof row['name'] !== 'string' ||
      seen.has(row['name']) ||
      !files.some((file) => file.name === row['name']) ||
      !fingerprint(row['fingerprint']) ||
      (row['unreadable'] !== undefined && row['unreadable'] !== true) ||
      (row['mode'] !== undefined &&
        (!permissionMode(row['mode']) ||
          (row['fingerprint'] === null ? row['mode'] !== null : row['mode'] === null) ||
          (row['unreadable'] === true && row['mode'] !== null)))
    )
      return null
    seen.add(row['name'])
    states.push({
      name: row['name'],
      fingerprint: row['fingerprint'],
      ...(row['unreadable'] === true ? { unreadable: true } : {}),
      ...(row['mode'] === undefined ? {} : { mode: row['mode'] as number | null }),
    })
  }
  return states
}

interface Stored {
  id: string
  seq: number
  operation: 'delete' | 'undo'
  source_id: string | null
  target: string
  files: string
  by: string
  outcome: 'pending' | 'done' | 'partial'
  actual: string | null
  created_at: number
  settled_by: string | null
  settled_at: number | null
}

function validSettlementTime(at: unknown): at is number {
  return typeof at === 'number' && Number.isSafeInteger(at) && at >= 0
}

function settlementFrom(row: Stored): MethodSettlement | null {
  if (row.settled_by === null && row.settled_at === null) return null
  if (
    row.settled_by === null ||
    !validSettlementTime(row.settled_at) ||
    row.outcome === 'pending'
  ) {
    throw new Error('Saved-method settlement is unreadable')
  }
  const observer = object(JSON.parse(row.settled_by))
  if (observer?.['who'] === 'a-person') return { by: { who: 'a-person' }, at: row.settled_at }
  if (observer?.['who'] === 'the-app-itself')
    return { by: { who: 'the-app-itself' }, at: row.settled_at }
  throw new Error('Saved-method settlement is unreadable')
}

function record(row: Stored): MethodChangeRecord {
  const files = filesFrom(JSON.parse(row.files))
  const by = object(JSON.parse(row.by))
  const actual =
    row.actual === null || files === null ? null : statesFrom(JSON.parse(row.actual), files)
  if (
    files === null ||
    by?.['who'] !== 'a-person' ||
    !methodChangeName(row.target) ||
    (row.outcome === 'pending' ? row.actual !== null : actual === null)
  ) {
    throw new Error('Saved-method recovery record is unreadable')
  }
  return {
    id: row.id,
    sequence: row.seq,
    operation: row.operation,
    sourceId: row.source_id,
    target: row.target,
    files,
    by: { who: 'a-person' },
    outcome: row.outcome,
    actual,
    createdAt: row.created_at,
    settlement: settlementFrom(row),
  }
}

function canReverse(source: MethodChangeRecord, files: readonly MethodFileChange[]): boolean {
  if (source.files.length !== files.length) return false
  return source.files.every((original) => {
    const current = files.find((file) => file.name === original.name)
    if (current === undefined || current.after !== (original.before?.fingerprint ?? null))
      return false
    const before = original.before?.fingerprint ?? null
    const currentFingerprint = current.before?.fingerprint ?? null
    const actual = source.actual?.find((file) => file.name === original.name)
    if (
      (original.afterMode !== undefined || current.afterMode !== undefined) &&
      current.afterMode !== (original.before?.mode ?? null)
    )
      return false
    if (original.afterMode !== undefined || actual?.mode !== undefined) {
      if (actual === undefined || actual.mode === undefined || actual.unreadable) return false
      const knownBefore =
        actual.fingerprint === before && actual.mode === (original.before?.mode ?? null)
      const knownAfter =
        original.afterMode !== undefined &&
        actual.fingerprint === original.after &&
        actual.mode === original.afterMode
      if ((!knownBefore && !knownAfter) || (current.before?.mode ?? null) !== actual.mode)
        return false
    }
    // An unexpected external edit is not made ours by recording it after a failed operation.
    if (
      actual !== undefined &&
      (actual.unreadable ||
        (actual.fingerprint !== before && actual.fingerprint !== original.after))
    )
      return false
    return actual === undefined
      ? currentFingerprint === before || currentFingerprint === original.after
      : currentFingerprint === actual.fingerprint
  })
}

/** Intent is durable before any filesystem write; only its one settlement may update the row. */
export function createMethodChangeStore(
  db: AppDatabase,
  now: () => number = Date.now,
): MethodChangeStore & MethodChangeReconciler {
  // Lazy preparation keeps old-schema migration fixtures independent of this later table.
  const sql = () => ({
    exists: db.prepare('SELECT id FROM agent_identity WHERE id = ?'),
    newest: db.prepare('SELECT max(seq) AS seq FROM identity_method_change WHERE identity_id = ?'),
    pending: db.prepare(
      "SELECT id FROM identity_method_change WHERE identity_id = ? AND outcome = 'pending' LIMIT 1",
    ),
    read: db.prepare('SELECT * FROM identity_method_change WHERE identity_id = ? AND id = ?'),
    list: db.prepare(
      'SELECT * FROM identity_method_change WHERE identity_id = ? ORDER BY seq DESC LIMIT ? OFFSET ?',
    ),
    insert: db.prepare(`INSERT INTO identity_method_change
      (id, identity_id, seq, operation, source_id, target, files, by, outcome, actual, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`),
    settle:
      db.prepare(`UPDATE identity_method_change SET outcome = ?, actual = ?, settled_by = ?, settled_at = ?
      WHERE identity_id = ? AND id = ? AND outcome = 'pending'`),
  })
  let statements: ReturnType<typeof sql> | undefined
  const prepared = () => (statements ??= sql())
  const finish = (
    identityId: string,
    id: string,
    outcome: 'done' | 'partial' | null,
    actual: readonly MethodFileState[],
    observer: MethodSettlement['by'],
  ): boolean =>
    db.transaction(() => {
      const queries = prepared()
      const stored = queries.read.get(identityId, id) as Stored | undefined
      if (stored === undefined || stored.outcome !== 'pending') return false
      const saved = record(stored)
      const states = statesFrom(actual, saved.files)
      if (states === null) return false
      const matchesPlan = states.every((state) => {
        const planned = saved.files.find((file) => file.name === state.name)
        return (
          planned !== undefined &&
          !state.unreadable &&
          state.fingerprint === planned.after &&
          (planned.afterMode === undefined || state.mode === planned.afterMode)
        )
      })
      if (outcome === 'done' && !matchesPlan) return false
      const at = now()
      if (!validSettlementTime(at)) return false
      return (
        queries.settle.run(
          outcome ?? (matchesPlan ? 'done' : 'partial'),
          JSON.stringify(states),
          JSON.stringify(observer),
          at,
          identityId,
          id,
        ).changes === 1
      )
    })()
  return {
    hasPending(identityId) {
      // Older migration fixtures can use identity removal before this table exists.
      if (
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get('identity_method_change') === undefined
      )
        return false
      // Keep this guard usable in migration fixtures predating settlement metadata.
      return (
        db
          .prepare(
            "SELECT id FROM identity_method_change WHERE identity_id = ? AND outcome = 'pending' LIMIT 1",
          )
          .get(identityId) !== undefined
      )
    },
    begin(identityId, said, by, at) {
      if (
        by.who !== 'a-person' ||
        !methodChangeName(said.target) ||
        (said.operation !== 'delete' && said.operation !== 'undo') ||
        (said.operation === 'delete' ? said.sourceId !== null : typeof said.sourceId !== 'string')
      )
        return null
      const files = filesFrom(said.files)
      if (files === null) return null
      if (
        said.operation === 'delete' &&
        !files.some((file) => (file.before?.fingerprint ?? null) !== file.after)
      )
        return null
      return db.transaction(() => {
        const queries = prepared()
        if (
          queries.exists.get(identityId) === undefined ||
          queries.pending.get(identityId) !== undefined
        )
          return null
        if (said.operation === 'undo') {
          const stored = queries.read.get(identityId, said.sourceId) as Stored | undefined
          if (stored === undefined) return null
          const source = record(stored)
          if (source.target !== said.target || !canReverse(source, files)) return null
        }
        const seq = ((queries.newest.get(identityId) as { seq: number | null }).seq ?? 0) + 1
        const id = `method-change:${identityId}:${seq}`
        queries.insert.run(
          id,
          identityId,
          seq,
          said.operation,
          said.sourceId,
          said.target,
          JSON.stringify(files),
          JSON.stringify({ who: 'a-person' }),
          at,
        )
        return record(queries.read.get(identityId, id) as Stored)
      })()
    },
    settle(identityId, id, outcome, actual, by) {
      if (by.who !== 'a-person' || (outcome !== 'done' && outcome !== 'partial')) return false
      return finish(identityId, id, outcome, actual, { who: 'a-person' })
    },
    reconcile(identityId, id, actual, by) {
      if (by.who !== 'the-app-itself') return false
      // Record an observation only; the original operation author and method files are untouched.
      return finish(identityId, id, null, actual, { who: 'the-app-itself' })
    },
    read(identityId, id) {
      const row = prepared().read.get(identityId, id) as Stored | undefined
      return row === undefined ? null : record(row)
    },
    list(identityId, offset, limit) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        return []
      return (prepared().list.all(identityId, limit, offset) as Stored[]).map(record)
    },
  }
}
