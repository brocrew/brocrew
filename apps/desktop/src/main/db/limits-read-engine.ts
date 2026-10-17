import Database from 'better-sqlite3'
import { serialize } from 'node:v8'
import type { Provider } from '@brobot2/shared'
import {
  foldProviderLimits,
  PROVIDER_WALL_LOOKBACK_MS,
  wallsFromUsage,
} from '../../shared/provider-limit'
import { createSessionStore } from './session-store'
import { LimitsMaterialization, type LimitsReadBounds } from './bounded-limits-statements'
import {
  LIMITS_READ_BOUNDS,
  limitsReadInput,
  limitsReadResult,
  LimitsReadUnavailable,
  type LimitsReadInput,
  type LimitsReadResult,
} from './limits-read-protocol'

/** Owns a read-only connection and creates a new canonical store for each snapshot. */
export class LimitsReadEngine {
  private readonly db: Database.Database
  private closed = false

  constructor(
    file: string,
    private readonly now: () => number = Date.now,
    private readonly bounds: LimitsReadBounds = LIMITS_READ_BOUNDS,
  ) {
    // This connection never migrates or changes journal mode.
    this.db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
    try {
      this.db.pragma('query_only = ON')
      this.db.pragma('cache_size = -4096')
      if (this.db.pragma('journal_mode', { simple: true }) !== 'wal')
        throw new LimitsReadUnavailable('failed')
      const tables = this.db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('events', 'provider_session', 'turn', 'derived_generation')",
        )
        .all()
      if (tables.length !== 4) throw new LimitsReadUnavailable('failed')
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  read(input: LimitsReadInput): LimitsReadResult {
    if (this.closed) throw new LimitsReadUnavailable('closed')
    const wanted = limitsReadInput.parse(input)
    const readStartedAt = this.now()
    this.db.exec('BEGIN')
    try {
      const snapshotPinStartedAt = this.now()
      this.db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get()
      const snapshotPinnedAt = this.now()
      const evaluatedAt = this.now()
      const materialization = new LimitsMaterialization(this.bounds)
      const bounded = materialization.database(this.db)
      const floor = evaluatedAt - PROVIDER_WALL_LOOKBACK_MS
      // Reject oversized raw cells before LIKE or JSON functions open their contents.
      const raw = this.db
        .prepare(
          `SELECT count(*) AS rows, coalesce(sum(bytes), 0) AS bytes,
                  coalesce(max(wide), 0) AS wide
             FROM (
               SELECT octet_length(payload) + octet_length(session_id) AS bytes,
                      (octet_length(payload) > ? OR octet_length(session_id) > ?) AS wide
                 FROM events WHERE type = 'error' AND likelihood(created_at >= ?, 0.00001)
               UNION ALL
               SELECT octet_length(payload) + octet_length(session_id) AS bytes,
                      (octet_length(payload) > ? OR octet_length(session_id) > ?) AS wide
                 FROM events WHERE type = 'provider_limit_clear' AND likelihood(created_at >= ?, 0.00001)
             )`,
        )
        .get(
          this.bounds.cellBytes,
          this.bounds.cellBytes,
          floor,
          this.bounds.cellBytes,
          this.bounds.cellBytes,
          floor,
        ) as { rows: number; bytes: number; wide: number }
      if (raw.wide || raw.rows > this.bounds.rows || raw.bytes > this.bounds.bytes)
        materialization.overflow()
      const signInChangedAt = new Map<Provider, number>()
      for (const provider of ['claude', 'codex'] as const) {
        const at = wanted.signInChangedAt[provider]
        if (at !== undefined) signInChangedAt.set(provider, at)
      }
      const canonical = createSessionStore(bounded, () => evaluatedAt).providerLimitsSeen(
        evaluatedAt,
        signInChangedAt,
      )
      materialization.assert()
      const near = wallsFromUsage(wanted.usage, canonical.rows, evaluatedAt)
      const display =
        near.length === 0
          ? canonical
          : {
              ...canonical,
              rows: foldProviderLimits([...canonical.rows, ...near], [], evaluatedAt),
            }
      const read = limitsReadResult.parse({
        operation: wanted.operation,
        databaseEpoch: wanted.databaseEpoch,
        signInEpoch: wanted.signInEpoch,
        inputCapturedAt: wanted.capturedAt,
        readStartedAt,
        snapshotPinStartedAt,
        snapshotPinnedAt,
        evaluatedAt,
        readFinishedAt: this.now(),
        canonical,
        display,
        measured: materialization.measured(),
      })
      if (serialize(read).byteLength > LIMITS_READ_BOUNDS.replyBytes)
        throw new LimitsReadUnavailable('overflow')
      this.db.exec('COMMIT')
      return read
    } catch (error) {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}
