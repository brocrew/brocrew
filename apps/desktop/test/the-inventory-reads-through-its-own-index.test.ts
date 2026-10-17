import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'

/**
 * 🔴 **D-035 · the tool inventory in force where a page begins is read through its own index** —
 * `events_inventory_idx`.
 *
 * ⛔ **What it is for**: every page of history carries the conversation's newest `tool_inventory`
 * row below it, and a provider states that row once per start. Walked back row by row it cost 57 ms
 * on a 180,000-event life (the page itself, 2 ms), and a conversation with none was walked to its
 * start on every page opened or scrolled back to.
 *
 * ⚑ **What this pins**: the migrations create the index on the key and type it was built for, and
 * SQLite reads the one statement that names it through it — a seek, whatever the ledger holds.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('D-035 · the tool inventory reads through its own index', () => {
  let dir: string
  let db: AppDatabase
  /** The SQL of every statement the store prepares, as it prepares it. */
  let prepared: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-inventory-index-'))
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
    prepared.filter((sql) => sql.includes('events_inventory_idx'))

  it('⛔ the migrations create it, on the page key, over tool_inventory rows alone', () => {
    const row = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'events_inventory_idx'`,
      )
      .get() as { sql: string } | undefined
    expect(row, 'no migration creates events_inventory_idx').toBeDefined()
    expect(row?.sql).toContain('(`session_id`,`generation`,`ordinal`)')
    expect(row?.sql).toMatch(/WHERE "events"\."type" = 'tool_inventory'$/)
  })

  it('🔴 the one statement that names it is read through it', () => {
    const reads = throughTheIndex()
    expect(reads).toHaveLength(1)
    for (const sql of reads) {
      const args = (sql.match(/\?/g) ?? []).map(() => null)
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[])
        .map((one) => one.detail)
        .filter((detail) => /\bevents\b/.test(detail))
      expect(plan, sql.slice(0, 120)).toEqual([
        'SEARCH events USING INDEX events_inventory_idx (session_id=? AND generation=? AND ordinal<?)',
      ])
      // ⚑ …and in the index's own order: no sort after the seek.
      const all = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[])
        .map((one) => one.detail)
        .join(' | ')
      expect(all).not.toMatch(/TEMP B-TREE/)
    }
  })

  it('⚑ the control: a term that is not the index’s cannot be read through it', () => {
    expect(() =>
      db.prepare(
        `SELECT ordinal FROM events INDEXED BY events_inventory_idx
          WHERE type = 'tool_call' AND session_id = ? AND generation = ? AND ordinal < ?
          ORDER BY ordinal DESC LIMIT 1`,
      ),
    ).toThrow(/no query solution/)
  })
})
