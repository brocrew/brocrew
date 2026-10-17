import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { FOLD_EVENT_TYPES, FOLD_TERM, FOLD_TYPE_LIST } from '../src/main/db/fold-index'

/**
 * 🔴 **F071 · the ledger folds read through their own index** — `events_fold_idx`.
 *
 * ⛔ **What it fixed**: the person's look, every five seconds, read four folds whose statements
 * filtered `type` over `events_session_ordinal_uq`, so SQLite read every row of a ledger to test its
 * type. Measured on a database of 174,000 events: the main process burst 160 ms every five seconds,
 * and 280 ms at twice the events.
 *
 * ⚑ **What this pins**: the index the migration created holds exactly `FOLD_EVENT_TYPES`, in its
 * order; every statement the store names it in carries that list; and SQLite reads each of them
 * through it. ⛔ SQLite uses a partial index only for a WHERE that implies the index's, word for
 * word — a list that drifted would stop the store from starting, and §1's control shows that.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('F071 · the ledger folds read through their own index', () => {
  let dir: string
  let db: AppDatabase
  /** The SQL of every statement the store prepares, as it prepares it. */
  let prepared: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-fold-index-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    prepared = []
    const prepare = db.prepare.bind(db)
    ;(db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
      prepared.push(sql)
      return prepare(sql)
    }) as typeof db.prepare
    createSessionStore(db, () => 1)
    ;(db as unknown as { prepare: typeof db.prepare }).prepare = prepare
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const throughTheIndex = (): string[] =>
    prepared.filter(
      (sql) =>
        sql.includes('events_fold_idx') ||
        (sql.includes('events_kind_owner_idx') && sql.includes(FOLD_TERM)),
    )

  describe('§1 · one list: the migration’s index and the statements', () => {
    it('⛔ the index the migrations create holds FOLD_EVENT_TYPES, in its order', () => {
      const row = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'events_fold_idx'`)
        .get() as { sql: string } | undefined
      expect(row, 'no migration creates events_fold_idx').toBeDefined()
      const listed = /IN \(([^)]*)\)/.exec(row?.sql ?? '')?.[1] ?? ''
      expect([...listed.matchAll(/'([^']*)'/g)].map((one) => one[1])).toEqual([...FOLD_EVENT_TYPES])
      expect(listed).toBe(FOLD_TYPE_LIST)
      expect(row?.sql).toContain('(`session_id`,`generation`,`ordinal`)')
    })

    it('⛔ every statement that names the index carries the same list', () => {
      const reads = throughTheIndex()
      expect(reads).toHaveLength(23)
      const kindReads = reads.filter((sql) => sql.includes('events_kind_owner_idx'))
      expect(kindReads).toHaveLength(8)
      expect(
        kindReads.filter((sql) => sql.includes("json_remove(payload, '$.sent', '$.given')")),
      ).toHaveLength(2)
      expect(
        kindReads.filter((sql) => sql.includes("type IN ('message_queued', 'message_unqueued')")),
      ).toHaveLength(1)
      const workers = reads.filter((sql) => sql.includes('substr(payload, 1, 4097)'))
      expect(workers).toHaveLength(1)
      expect(workers[0]).toContain("type = 'replaced_by'")
      expect(workers[0]).toContain('AND session_id = ?')
      expect(workers[0]).toContain('ORDER BY generation DESC, ordinal DESC LIMIT 2')
      const moves = reads.filter((sql) => sql.includes("json_type(payload, '$.move')"))
      expect(moves).toHaveLength(1)
      expect(moves[0]).toContain("type = 'question_asked'")
      expect(moves[0]).toContain('ORDER BY ordinal DESC LIMIT 1')
      for (const sql of reads) {
        const from = [...sql.matchAll(/INDEXED BY events_(?:fold|kind_owner)_idx/g)].length
        // ⚑ Each FROM that names the index repeats the term beside it.
        expect(sql.split(FOLD_TERM).length - 1, sql.slice(0, 120)).toBe(from)
      }
    })

    it('⚑ the control: a list that is not the index’s cannot be read through it', () => {
      const reordered = [...FOLD_EVENT_TYPES]
        .reverse()
        .map((type) => `'${type}'`)
        .join(', ')
      expect(() =>
        db.prepare(
          `SELECT ordinal FROM events INDEXED BY events_fold_idx
            WHERE type IN (${reordered}) AND session_id = ? AND generation = ?
            ORDER BY ordinal`,
        ),
      ).toThrow(/no query solution/)
      // …and the same statement with the index's own list prepares.
      expect(() =>
        db.prepare(
          `SELECT ordinal FROM events INDEXED BY events_fold_idx
            WHERE ${FOLD_TERM} AND session_id = ? AND generation = ?
            ORDER BY ordinal`,
        ),
      ).not.toThrow()
    })
  })

  describe('§2 · SQLite reads each of them through it', () => {
    it('each indexed read uses its declared event range', () => {
      const reads = throughTheIndex()
      expect(reads).toHaveLength(23)
      for (const sql of reads) {
        const named = [...new Set([...sql.matchAll(/@([A-Za-z_]\w*)/g)].map((one) => one[1]))]
        const args: unknown[] = []
        if (named.length > 0) args.push(Object.fromEntries(named.map((name) => [name, null])))
        args.push(...(sql.match(/\?/g) ?? []).map(() => null))
        const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[])
          .map((one) => one.detail)
          .filter((detail) => /^(SEARCH|SCAN) (events|e)(?: |$)/.test(detail))
        expect(plan.length, sql.slice(0, 120)).toBeGreaterThan(0)
        for (const detail of plan) {
          if (sql.includes('events_kind_owner_idx')) {
            expect(detail, sql.slice(0, 120)).toMatch(
              /^SEARCH (events|e) USING (?:COVERING )?INDEX events_kind_owner_idx /,
            )
          } else if (sql.includes('AS first_listed') && detail.startsWith('SEARCH e ')) {
            expect(detail, sql.slice(0, 120)).toMatch(/^SEARCH e USING INDEX events_session_idx /)
          } else if (
            sql.includes('AS first_listed') ||
            sql.startsWith('SELECT session_id, payload FROM events INDEXED')
          ) {
            expect(detail, sql.slice(0, 120)).toMatch(
              /^(SEARCH|SCAN) events USING INDEX events_fold_idx(?: |$)/,
            )
          } else {
            expect(detail, sql.slice(0, 120)).toMatch(
              /^SEARCH (events|e) USING INDEX events_fold_idx /,
            )
          }
        }
      }
    })
  })
})
