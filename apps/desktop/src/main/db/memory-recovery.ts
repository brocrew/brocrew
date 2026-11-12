import { providerSchema } from '@brobot2/shared'
import type { AppDatabase } from './connection'
import { actedByFrom, isWhoDidIt, type ActedBy } from '../../shared/who-did-it'
import type {
  MemoryAmendment,
  MemoryAmendmentWrite,
  MemoryObservation,
  MemoryOutcome,
  MemorySettlement,
} from '../../shared/agent-memory'

const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0

export function validMemoryIntent(said: MemoryAmendmentWrite, at: number): boolean {
  const text = (value: unknown) =>
    typeof value === 'string' &&
    Buffer.byteLength(value, 'utf8') <= 65536 &&
    Buffer.from(value, 'utf8').toString('utf8') === value
  return (
    validTime(at) &&
    isWhoDidIt(said?.by?.who) &&
    (said.by.who !== 'an-agent' || (typeof said.by.agent === 'string' && said.by.agent !== '')) &&
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
  const actual = source.actual
  if (actual?.unreadable) return false
  // Completed legacy history has recorded before/after text, even without an ordinary observation.
  if (actual?.text === undefined) return source.outcome !== 'partial' && before === source.textAfter
  return actual.text === before && (before === source.textBefore || before === source.textAfter)
}

export function memoryObservation(value: unknown): MemoryObservation | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const one = { ...(value as Record<string, unknown>) }
  if (one.text === undefined && 'fingerprint' in one)
    return one.unreadable === true ? { unreadable: true } : {}
  // The existing SQL envelope still requires this inert member; it is not an observation.
  delete one.fingerprint
  if (one.text === undefined && Object.keys(one).length === 0) return {}
  if (
    Object.keys(one).some((key) => key !== 'text' && key !== 'unreadable' && key !== 'cause') ||
    (one.text !== null &&
      (typeof one.text !== 'string' ||
        Buffer.byteLength(one.text) > 65536 ||
        Buffer.from(one.text, 'utf8').toString('utf8') !== one.text)) ||
    (one.unreadable !== undefined && one.unreadable !== true) ||
    (one.unreadable === true && one.text !== null) ||
    (one.cause !== undefined && (typeof one.cause !== 'string' || one.cause.length > 8192))
  )
    return null
  return {
    text: one.text as string | null,
    ...(one.unreadable === true ? { unreadable: true } : {}),
    ...(one.cause === undefined ? {} : { cause: one.cause as string }),
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
      if (actual === null || actual.text === undefined) return false
      const row = db
        .prepare(
          `SELECT text_before, text_after FROM identity_memory_amendment
      WHERE identity_id = ? AND id = ? AND outcome = 'pending'`,
        )
        .get(identity, id) as { text_before: string | null; text_after: string | null } | undefined
      if (row === undefined) return false
      const at = now()
      if (!validTime(at)) return false
      const outcome: MemoryOutcome =
        actual.unreadable || actual.text === undefined
          ? 'partial'
          : actual.text === row.text_before
            ? 'unchanged'
            : actual.text === row.text_after
              ? 'done'
              : 'partial'
      return (
        db
          .prepare(
            `UPDATE identity_memory_amendment
      SET outcome = ?, actual = ?, settled_by = ?, settled_at = ?
      WHERE identity_id = ? AND id = ? AND outcome = 'pending'`,
          )
          .run(
            outcome,
            JSON.stringify({ ...actual, fingerprint: null }),
            JSON.stringify(observer),
            at,
            identity,
            id,
          ).changes === 1
      )
    })()
  return {
    hasPending,
    settle(identity: string, id: string, actual: MemoryObservation, by: ActedBy): boolean {
      return finish(identity, id, actual, actedByFrom(by))
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
