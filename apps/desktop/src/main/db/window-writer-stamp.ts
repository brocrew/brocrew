import type Database from 'better-sqlite3'
import type { WindowReadQuery } from './window-read-protocol'
import { ROUTED_REQUEST_EVENT_TYPES, THREAD_LEAD_EVENT_TYPES } from './session-store'
import { setWindowWriteFence } from './window-write-fence'
import { FOLD_TYPE_LIST } from './fold-index'

export interface WindowWriterStamp {
  readonly writer: object
  readonly watcher: number
  readonly revision: bigint
  readonly dataVersion: bigint
  readonly schemaVersion?: bigint
  readonly at: number
  readonly foldRevision?: bigint
  readonly foldReset?: bigint
}

export type WindowWriterSampler = ((query: WindowReadQuery) => WindowWriterStamp | null) & {
  changedOwners?: (before: WindowWriterStamp, now: WindowWriterStamp) => readonly string[] | null
}

const terms = (types: readonly string[]) => types.map((type) => `'${type}'`).join(', ')
const selects = (row: string, types: readonly string[]) =>
  `(CASE ${row}.type ${types.map((type) => `WHEN '${type}' THEN 1`).join(' ')} ELSE 0 END)`
const operations = ['INSERT', 'DELETE', 'UPDATE']
const eventTriggers = operations.map((operation) => `window_read_event_${operation}`)
const generationTriggers = operations.map((operation) => `window_read_generation_${operation}`)
const foldTriggers = operations.map((operation) => `window_read_fold_${operation}`)
const resetTriggers = operations.map((operation) => `window_read_stall_${operation}`)
const triggerCount = BigInt(eventTriggers.length + generationTriggers.length + foldTriggers.length + resetTriggers.length + 1)
const installedTriggers = `(SELECT count(*) FROM sqlite_temp_master WHERE type = 'trigger' AND
  ((tbl_name = 'events' AND name IN (${terms(eventTriggers)})) OR
   (tbl_name = 'derived_generation' AND name IN (${terms(generationTriggers)})) OR
   (tbl_name = 'events' AND name IN (${terms(foldTriggers)})) OR
   (tbl_name = 'work_legacy_stall_cut' AND name IN (${terms(resetTriggers)})) OR
   (tbl_name = 'provider_session' AND name = 'window_read_provider_update')))`
const integer = (value: unknown): value is bigint => typeof value === 'bigint' && value >= 0n
const watchers = new WeakMap<
  Database.Database,
  {
    kept: Map<string, number>
    sequence: number
    owner: object
    suspended: number
    failed: boolean
    warnedAt?: number
  }
>()

/** Transactional counters on the writer connection; unrelated content never changes them. */
export function windowWriterSampler(
  db: Database.Database,
  noRetainedCursor: () => boolean,
  now: () => number = Date.now,
): WindowWriterSampler {
  let state = watchers.get(db)
  if (state === undefined) {
    state = { kept: new Map(), sequence: 0, owner: {}, suspended: 0, failed: false }
    watchers.set(db, state)
  }
  const shared = state
  const kept = shared.kept
  const failedReinstall = () => {
    shared.failed = true
    shared.owner = {}
    const at = now()
    if (Number.isFinite(at) && (shared.warnedAt === undefined || at - shared.warnedAt >= 60_000)) {
      shared.warnedAt = at
      console.warn('window writer tracking could not be installed; the next sample will retry')
    }
  }
  let installed = false
  const candidate = (row: string) => `EXISTS (SELECT 1 FROM main.events
    WHERE type = 'request_routed' AND session_id = ${row}.session_id)`
  const active = (row: string) => `${row}.generation = coalesce(
    (SELECT active FROM main.derived_generation WHERE session_id = ${row}.session_id), 0)`
  const relevant = (row: string) => `(CASE
    WHEN ${row}.type = 'status' AND
      CASE WHEN json_valid(${row}.payload) THEN
        coalesce(json_extract(${row}.payload, '$.type') = 'status' AND
                 json_extract(${row}.payload, '$.state') IN ('working', 'idle'), 0)
      ELSE 0 END THEN 0
    ELSE ${selects(row, ROUTED_REQUEST_EVENT_TYPES)} END)`
  const route = (row: string) => `(${relevant(row)} AND
    (${row}.type = 'request_routed' OR (${active(row)} AND ${candidate(row)})))`
  const lead = (row: string) => `(${selects(row, THREAD_LEAD_EVENT_TYPES)} AND
    session = ${row}.session_id AND before_ordinal > ${row}.ordinal AND ${active(row)})`
  const install = () => {
    if (installed) return
    // REPLACE deletes must fire the same invalidation triggers as explicit deletes.
    db.pragma('recursive_triggers = ON')
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_temp_master WHERE type = 'table' AND name = 'window_read_revision'",
        )
        .get() === undefined
    ) {
      kept.clear()
      shared.owner = {}
    } else if (
      db.prepare('SELECT 1 FROM temp.window_read_revision WHERE id = 0').get() === undefined
    ) {
      shared.owner = {}
    }
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS window_read_revision (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, session TEXT, before_ordinal INTEGER,
      revision INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS temp.window_read_revision_session ON window_read_revision(session);
      INSERT OR IGNORE INTO window_read_revision (id, kind) VALUES (0, 'routes');`)
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS window_read_fold_owners (
      session TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS temp.window_read_fold_owners_revision ON window_read_fold_owners(revision);
      INSERT OR IGNORE INTO window_read_revision (id, kind) VALUES (-1, 'folds'), (-2, 'reset');`)
    for (const operation of operations) {
      const rows =
        operation === 'UPDATE' ? ['OLD', 'NEW'] : [operation === 'INSERT' ? 'NEW' : 'OLD']
      const change = (columns: readonly string[]) =>
        operation === 'UPDATE'
          ? `(${columns.map((column) => `OLD.${column} IS NOT NEW.${column}`).join(' OR ')})`
          : '1'
      const leadsChanged = change(['type', 'payload', 'session_id', 'generation', 'ordinal'])
      const routesChanged = change([
        'type',
        'payload',
        'session_id',
        'generation',
        'ordinal',
        'created_at',
      ])
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS window_read_event_${operation}
        AFTER ${operation} ON main.events
        WHEN (${routesChanged} AND (${rows.map(relevant).join(' OR ')}))
          OR (${leadsChanged} AND (${rows.map((row) => selects(row, THREAD_LEAD_EVENT_TYPES)).join(' OR ')}))
        BEGIN
          UPDATE window_read_revision SET revision = revision + 1
            WHERE id = 0 AND (${rows.map(route).join(' OR ')});
          UPDATE window_read_revision SET revision = revision + 1
            WHERE (${rows.map((row) => selects(row, THREAD_LEAD_EVENT_TYPES)).join(' OR ')})
              AND session IN (${rows.map((row) => `${row}.session_id`).join(', ')})
              AND kind = 'leads' AND (${rows.map(lead).join(' OR ')});
        END;`)
      const changed =
        operation === 'UPDATE'
          ? 'WHEN (OLD.active IS NOT NEW.active OR OLD.session_id IS NOT NEW.session_id) AND (OLD.active != 0 OR NEW.active != 0)'
          : `WHEN ${rows.map((row) => `${row}.active != 0`).join(' OR ')}`
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS window_read_generation_${operation}
        AFTER ${operation} ON main.derived_generation ${changed}
        BEGIN
          UPDATE window_read_revision SET revision = revision + 1 WHERE id = -1;
          ${rows.map((row) => `INSERT INTO window_read_fold_owners(session, revision)
            VALUES (${row}.session_id, (SELECT revision FROM window_read_revision WHERE id = -1))
            ON CONFLICT(session) DO UPDATE SET revision = excluded.revision;`).join('\n')}
          UPDATE window_read_revision SET revision = revision + 1
            WHERE (id = 0 AND (${rows.map(candidate).join(' OR ')}))
               OR (${rows.map((row) => `session = ${row}.session_id`).join(' OR ')});
        END;`)
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS window_read_fold_${operation}
        AFTER ${operation} ON main.events
        WHEN ${rows.map((row) => `${row}.type IN (${FOLD_TYPE_LIST})`).join(' OR ')}
        BEGIN
          UPDATE window_read_revision SET revision = revision + 1 WHERE id = -1;
          ${rows.map((row) => `INSERT INTO window_read_fold_owners(session, revision)
            VALUES (${row}.session_id, (SELECT revision FROM window_read_revision WHERE id = -1))
            ON CONFLICT(session) DO UPDATE SET revision = excluded.revision;`).join('\n')}
        END;
        CREATE TEMP TRIGGER IF NOT EXISTS window_read_stall_${operation}
        AFTER ${operation} ON main.work_legacy_stall_cut
        BEGIN UPDATE window_read_revision SET revision = revision + 1 WHERE id = -2; END;`)
    }
    db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS window_read_provider_update
      AFTER UPDATE OF provider ON main.provider_session WHEN OLD.provider IS NOT NEW.provider
      BEGIN UPDATE window_read_revision SET revision = revision + 1 WHERE id = -2; END;`)
    installed = true
  }
  if (shared.suspended > 0) failedReinstall()
  else {
    try {
      install()
      shared.failed = false
    } catch {
      failedReinstall()
    }
  }
  // Prepared once the counter exists, so a writer whose first install failed can still sample.
  let statements:
    | {
        sample: Database.Statement
        add: Database.Statement
        remove: Database.Statement
        changed: Database.Statement
      }
    | undefined
  const prepared = () =>
    (statements ??= {
      sample: db
        .prepare(
          `SELECT revision, total_changes() AS changes, data_version AS version,
      (SELECT revision FROM window_read_revision WHERE id = -1) AS folds,
      (SELECT revision FROM window_read_revision WHERE id = -2) AS reset,
      recursive_triggers AS recursive,
      ${installedTriggers} AS triggers
    FROM temp.window_read_revision, pragma_data_version, pragma_recursive_triggers
    WHERE id = ?`,
        )
        .safeIntegers(true),
      add: db.prepare(`INSERT INTO temp.window_read_revision
    (id, kind, session, before_ordinal) VALUES (?, 'leads', ?, ?)`),
      remove: db.prepare('DELETE FROM temp.window_read_revision WHERE id = ?'),
      changed: db.prepare('SELECT session FROM temp.window_read_fold_owners WHERE revision > ?'),
    })
  setWindowWriteFence(db, <T>(write: () => T): T => {
    if (shared.suspended > 0) return write()
    shared.suspended++
    try {
      for (const trigger of [...eventTriggers, ...generationTriggers, ...foldTriggers, ...resetTriggers, 'window_read_provider_update'])
        db.exec(`DROP TRIGGER IF EXISTS temp.${trigger}`)
      return write()
    } finally {
      try {
        installed = false
        install()
        db.prepare('UPDATE temp.window_read_revision SET revision = revision + 1').run()
        shared.failed = false
      } catch {
        failedReinstall()
      }
      shared.suspended--
    }
  })
  const sampler: WindowWriterSampler = (query) => {
    // Files name their rows from one worker snapshot and do not use this writer stamp.
    if (query.kind === 'files') return null
    try {
      if (shared.suspended > 0 || !db.open || db.inTransaction || !noRetainedCursor()) return null
      if (shared.failed) {
        try {
          installed = false
          install()
          db.prepare('UPDATE temp.window_read_revision SET revision = revision + 1').run()
          shared.failed = false
        } catch {
          failedReinstall()
          return null
        }
      }
      const { sample, add, remove } = prepared()
      let watcher = 0
      if (query.kind === 'leads') {
        const key = JSON.stringify([query.sessionId, query.before])
        const cached = kept.get(key)
        if (cached === undefined) {
          if (shared.sequence >= Number.MAX_SAFE_INTEGER) return null
          watcher = ++shared.sequence
          add.run(watcher, query.sessionId, query.before)
          kept.set(key, watcher)
          if (kept.size > 256) {
            const oldest = kept.entries().next().value
            if (oldest !== undefined) {
              remove.run(oldest[1])
              kept.delete(oldest[0])
            }
          }
        } else {
          watcher = cached
          kept.delete(key)
          kept.set(key, watcher)
        }
      }
      const row = sample.get(watcher) as
        | {
            revision?: unknown
            version?: unknown
            recursive?: unknown
            triggers?: unknown
            changes?: unknown
            folds?: unknown
            reset?: unknown
          }
        | undefined
      // Recreated counters and triggers cannot validate a sample from before the schema change.
      const schemaVersion: unknown = db.pragma('temp.schema_version', { simple: true })
      const at = now()
      if (
        row === undefined ||
        row.recursive !== 1n ||
        row.triggers !== triggerCount ||
        typeof schemaVersion !== 'number' ||
        !Number.isSafeInteger(schemaVersion) ||
        schemaVersion < 0 ||
        !integer(row.revision) ||
        !integer(row.version) ||
        !integer(row.changes) ||
        !integer(row.folds) ||
        !integer(row.reset) ||
        !Number.isFinite(at) ||
        !db.open ||
        db.inTransaction ||
        !noRetainedCursor()
      )
        return null
      return {
        writer: shared.owner,
        watcher,
        revision: query.kind === 'routes' || query.kind === 'publication' ? row.changes : row.revision,
        dataVersion: row.version,
        schemaVersion: BigInt(schemaVersion),
        at,
        foldRevision: row.folds,
        foldReset: row.reset,
      }
    } catch {
      return null
    }
  }
  sampler.changedOwners = (before, current) => {
    if (before.writer !== current.writer || before.dataVersion !== current.dataVersion ||
        before.schemaVersion !== current.schemaVersion || before.foldReset !== current.foldReset ||
        before.foldRevision === undefined || current.foldRevision === undefined) return null
    return (prepared().changed
      .all(before.foldRevision) as { session: string }[]).map((row) => row.session)
  }
  return sampler
}
