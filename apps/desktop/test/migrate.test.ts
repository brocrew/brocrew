import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('startup migrator', () => {
  let dir: string
  let db: AppDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-migrate-'))
    db = openDatabase(join(dir, 'test.sqlite'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies migration 0000 to a fresh database', () => {
    applyMigrations(db, migrationsFolder)
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name)
    expect(names).toContain('provider_session')
    expect(names).toContain('events')
  })

  it('is idempotent when re-run on an already-migrated database', () => {
    applyMigrations(db, migrationsFolder)
    expect(() => applyMigrations(db, migrationsFolder)).not.toThrow()
  })

  it('enforces the events → provider_session foreign key (PRAGMA foreign_keys = ON)', () => {
    applyMigrations(db, migrationsFolder)
    const now = Date.now()

    const insertOrphanEvent = () =>
      db
        .prepare(
          'INSERT INTO events (id, session_id, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('evt_orphan', 'sess_missing', 0, 'session', '{}', now)
    expect(insertOrphanEvent).toThrow()

    db.prepare(
      'INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('sess_1', 'claude', '/tmp/brobot2-scratch', 'idle', now, now)

    expect(() =>
      db
        .prepare(
          'INSERT INTO events (id, session_id, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('evt_1', 'sess_1', 0, 'session', '{}', now),
    ).not.toThrow()
  })

  it('rejects a provider outside the CHECK constraint', () => {
    applyMigrations(db, migrationsFolder)
    const now = Date.now()
    const insertBadProvider = () =>
      db
        .prepare(
          'INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('sess_bad', 'gemini', '/tmp', 'idle', now, now)
    expect(insertBadProvider).toThrow()
  })
})
