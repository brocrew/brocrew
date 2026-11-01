import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'

it('probes replacements by type and session in a large fictional profile', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-startup-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  try {
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const prepare = db.prepare.bind(db)
    const queries: string[] = []
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      queries.push(sql)
      return prepare(sql)
    })
    const store = createSessionStore(db)
    spy.mockRestore()
    store.create({
      id: 'atlas',
      provider: 'codex',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'atlas-reader',
    })
    const insert = db.prepare(`INSERT INTO events
      (id, session_id, generation, ordinal, type, payload, created_at)
      VALUES (?, 'atlas', 0, ?, ?, ?, ?)`)
    db.transaction(() => {
      for (let i = 0; i < 297_164; i++) {
        const type = i < 18_114 ? 'launched' : 'text'
        insert.run(`atlas-${i}`, i, type, JSON.stringify({ type }), i)
      }
    })()
    const sql = queries.find(
      (sql) => sql.includes("AND type = 'replaced_by'") && sql.includes('4097'),
    )!
    expect(sql).toBeDefined()
    const previous = sql.replace(
      /FROM events(?: INDEXED BY events_\w+)?/,
      'FROM events INDEXED BY events_fold_idx',
    )
    const time = (lookup: () => unknown) => {
      const start = performance.now()
      for (let i = 0; i < 274; i++) lookup()
      return performance.now() - start
    }
    const old = db.prepare(previous)
    const beforeMs = time(() => old.all('atlas'))
    const afterMs = time(() => expect(store.workerGiverContains('atlas', 'atlas')).toBe(true))
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('atlas') as { detail: string }[]
    process.stdout.write(
      JSON.stringify({ calls: 274, events: 297_164, foldRows: 18_114, beforeMs, afterMs, plan }) +
        '\n',
    )
    expect(plan.some((row) => row.detail.includes('type=? AND session_id=?'))).toBe(true)
    expect(afterMs).toBeLessThan(beforeMs / 4)
  } finally {
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
