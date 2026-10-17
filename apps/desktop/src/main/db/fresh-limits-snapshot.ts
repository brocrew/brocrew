import type Database from 'better-sqlite3'
import { PROVIDER_WALL_LOOKBACK_MS } from '../../shared/provider-limit'
import type { LimitsReadInput, LimitsReadResult } from './limits-read-protocol'

export interface LimitsWriterStamp {
  readonly writer: object
  readonly totalChanges: bigint
  readonly dataVersion: bigint
  readonly at: number
}

const integer = (value: unknown): value is bigint =>
  typeof value === 'bigint' && value >= 0n && value <= 9_223_372_036_854_775_807n

/** Samples only the existing writer, outside its transactions and retained read cursors. */
export function limitsWriterSampler(
  db: Database.Database,
  noRetainedCursor: () => boolean,
  now: () => number = Date.now,
): () => LimitsWriterStamp | null {
  let statement: Database.Statement | undefined
  return () => {
    try {
      if (!db.open || db.inTransaction || !noRetainedCursor()) return null
      statement ??= db
        .prepare(
          'SELECT total_changes() AS changes, data_version AS version FROM pragma_data_version',
        )
        .safeIntegers(true)
      const row = statement.get() as { changes?: unknown; version?: unknown } | undefined
      const at = now()
      if (
        row === undefined ||
        !integer(row.changes) ||
        !integer(row.version) ||
        !Number.isFinite(at) ||
        !db.open ||
        db.inTransaction ||
        !noRetainedCursor()
      )
        return null
      return { writer: db, totalChanges: row.changes, dataVersion: row.version, at }
    } catch {
      return null
    }
  }
}

export function completeCanonicalLimits(result: LimitsReadResult): boolean {
  return (
    result.canonical.walk === 'every-provider-wall-recently-recorded' &&
    result.canonical.rowsUnread === 0 &&
    (result.canonical.ledgersSkipped ?? 0) === 0 &&
    result.canonical.rows.length <= 2_048 &&
    result.canonical.rows.every(
      (row) => Number.isFinite(row.at) && (row.resetsAt === null || Number.isFinite(row.resetsAt)),
    )
  )
}

/** A dated result can be prepared as current only while the writer and time boundaries agree. */
export function freshLimitsSnapshot(
  input: LimitsReadInput,
  result: LimitsReadResult,
  before: LimitsWriterStamp | null,
  after: LimitsWriterStamp | null,
): boolean {
  if (
    before === null ||
    after === null ||
    before.writer !== after.writer ||
    before.totalChanges !== after.totalChanges ||
    before.dataVersion !== after.dataVersion ||
    !integer(before.totalChanges) ||
    !integer(before.dataVersion) ||
    !Number.isFinite(before.at) ||
    !Number.isFinite(after.at) ||
    before.at > after.at ||
    input.operation !== result.operation ||
    input.databaseEpoch !== result.databaseEpoch ||
    input.signInEpoch !== result.signInEpoch ||
    input.capturedAt !== result.inputCapturedAt ||
    !completeCanonicalLimits(result)
  )
    return false
  const instants = [
    before.at,
    result.readStartedAt,
    result.snapshotPinStartedAt,
    result.snapshotPinnedAt,
    result.evaluatedAt,
    result.readFinishedAt,
    after.at,
  ]
  if (instants.some((at, i) => !Number.isFinite(at) || (i > 0 && at < instants[i - 1]!)))
    return false
  return result.canonical.rows.every((row) => {
    const lookbackEnd = row.at + PROVIDER_WALL_LOOKBACK_MS
    return (
      Number.isFinite(lookbackEnd) &&
      lookbackEnd > after.at &&
      (row.resetsAt === null || row.resetsAt > after.at)
    )
  })
}
