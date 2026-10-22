import { createHash } from 'node:crypto'
import { providerSchema } from '@brobot2/shared'
import type { AppDatabase } from './connection'
import type { ActedBy } from '../../shared/who-did-it'
import type {
  MemoryAmendment,
  MemoryAmendmentWrite,
  MemoryObservation,
  MemoryOutcome,
  MemorySettlement,
} from '../../shared/agent-memory'

const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0
const hash = (text: string | null) =>
  text === null ? null : createHash('sha256').update(text).digest('hex')

export function validMemoryIntent(said: MemoryAmendmentWrite, at: number): boolean {
  const text = (value: unknown) =>
    typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= 65536 &&
    Buffer.from(value, 'utf8').toString('utf8') === value
  return (
    validTime(at) &&
    said?.by?.who === 'a-person' &&
    typeof said.profileSlug === 'string' &&
    typeof said.entry === 'string' &&
    said.entry.length > 0 &&
    Buffer.byteLength(said.entry, 'utf8') <= 8192 &&
    !said.entry.includes('\0') &&
    providerSchema.safeParse(said.provider).success &&
    (said.sourceId === undefined ||
      (typeof said.sourceId === 'string' &&
        said.sourceId.length > 0 &&
        said.sourceId.length <= 1024)) &&
    ((said.act === 'removed' && text(said.textBefore) && said.textAfter === null) ||
      (said.act === 'corrected' && text(said.textBefore) && text(said.textAfter)) ||
      (said.act === 'restored' &&
        said.textBefore === null &&
        text(said.textAfter) &&
        typeof said.sourceId === 'string'))
  )
}

/** A reversal cannot adopt external or unreadable bytes as this app's work. */
export function knownMemorySource(source: MemoryAmendment, before: string | null): boolean {
  if (source.outcome === 'pending' || source.outcome === 'unchanged') return false
  if (source.actual === undefined)
    return source.outcome !== 'partial' && before === source.textAfter
  const actual = memoryObservation(source.actual)
  return (
    actual !== null &&
    !actual.unreadable &&
    actual.fingerprint === hash(before) &&
    (actual.fingerprint === hash(source.textBefore) ||
      actual.fingerprint === hash(source.textAfter))
  )
}

export function memoryObservation(value: unknown): MemoryObservation | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const one = value as Record<string, unknown>
  if (
    Object.keys(one).some((key) => key !== 'fingerprint' && key !== 'unreadable') ||
    (one.fingerprint !== null &&
      (typeof one.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(one.fingerprint))) ||
    (one.unreadable !== undefined && one.unreadable !== true) ||
    (one.unreadable === true && one.fingerprint !== null)
  )
    return null
  return {
    fingerprint: one.fingerprint as string | null,
    ...(one.unreadable === true ? { unreadable: true } : {}),
  }
}

/** The same connection owns intent allocation, removal protection and the one observation. */
export function createMemoryRecoveryStore(db: AppDatabase, now: () => number = Date.now) {
  const hasPending = (identity: string): boolean => {
    // Old upgrade fixtures may remove an identity before the recovery columns exist.
    const columns = db.prepare('PRAGMA table_info(identity_memory_amendment)').all() as {
      name: string
    }[]
    if (!columns.some((one) => one.name === 'outcome')) return false
    return (
      db
        .prepare(
          "SELECT id FROM identity_memory_amendment WHERE identity_id = ? AND outcome = 'pending' LIMIT 1",
        )
        .get(identity) !== undefined
    )
  }
  const finish = (
    identity: string,
    id: string,
    input: MemoryObservation,
    observer: MemorySettlement['by'],
  ): boolean =>
    db.transaction(() => {
      const actual = memoryObservation(input)
      if (actual === null) return false
      const row = db
        .prepare(
          `SELECT text_before, text_after FROM identity_memory_amendment
      WHERE identity_id = ? AND id = ? AND outcome = 'pending'`,
        )
        .get(identity, id) as { text_before: string | null; text_after: string | null } | undefined
      if (row === undefined) return false
      const at = now()
      if (!validTime(at)) return false
      const outcome: MemoryOutcome = actual.unreadable
        ? 'partial'
        : actual.fingerprint === hash(row.text_before)
          ? 'unchanged'
          : actual.fingerprint === hash(row.text_after)
            ? 'done'
            : 'partial'
      return (
        db
          .prepare(
            `UPDATE identity_memory_amendment
      SET outcome = ?, actual = ?, settled_by = ?, settled_at = ?
      WHERE identity_id = ? AND id = ? AND outcome = 'pending'`,
          )
          .run(outcome, JSON.stringify(actual), JSON.stringify(observer), at, identity, id)
          .changes === 1
      )
    })()
  return {
    hasPending,
    settle(identity: string, id: string, actual: MemoryObservation, by: ActedBy): boolean {
      return by.who === 'a-person' && finish(identity, id, actual, { who: 'a-person' })
    },
    reconcile(identity: string, id: string, actual: MemoryObservation, by: ActedBy): boolean {
      return by.who === 'the-app-itself' && finish(identity, id, actual, { who: 'the-app-itself' })
    },
  }
}

/** Main's awaited launch path gets only observation, never begin or filesystem writes. */
export function createMemoryAmendmentObserver(db: AppDatabase, now: () => number = Date.now) {
  const recovery = createMemoryRecoveryStore(db, now)
  return { reconcile: recovery.reconcile }
}
