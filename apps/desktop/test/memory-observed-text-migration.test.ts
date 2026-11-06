import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { legacyIdentity } from './fixtures/legacy-migration-data'
import { agentIdentityRowId } from '../src/main/db/identity'
import { createSessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
const folders: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixture(last: number) {
  const root = mkdtempSync(join(tmpdir(), 'fictional-memory-migration-'))
  folders.push(root)
  const prefix = join(root, 'prefix')
  mkdirSync(join(prefix, 'meta'), { recursive: true })
  const entries = journal.entries.slice(0, last + 1)
  for (const entry of entries)
    copyFileSync(join(migrations, `${entry.tag}.sql`), join(prefix, `${entry.tag}.sql`))
  writeFileSync(join(prefix, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  const db = openDatabase(join(root, 'workspace.sqlite'))
  databases.push(db)
  applyMigrations(db, prefix)
  legacyIdentity(db, 'lark', 'codex')
  const actor = JSON.stringify({ who: 'a-person' })
  const observer = JSON.stringify({ who: 'the-app-itself' })
  const insert = db.prepare(`INSERT INTO identity_memory_amendment
    (id, identity_id, seq, provider, entry, act, by, text_before, text_after, created_at, source_id, outcome, actual, settled_by, settled_at)
    VALUES (?, ?, ?, 'codex', '/fictional/note.md', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const identity = agentIdentityRowId('lark')
  insert.run(
    'delete',
    identity,
    1,
    'removed',
    actor,
    'Before',
    null,
    1,
    null,
    'done',
    '{"fingerprint":null}',
    observer,
    10,
  )
  insert.run(
    'restore',
    identity,
    2,
    'restored',
    actor,
    null,
    'Before',
    2,
    'delete',
    'done',
    JSON.stringify({ fingerprint: 'a'.repeat(64) }),
    actor,
    11,
  )
  insert.run(
    'partial',
    identity,
    3,
    'corrected',
    actor,
    'Before',
    'After',
    3,
    null,
    'partial',
    JSON.stringify({ fingerprint: 'b'.repeat(64) }),
    observer,
    12,
  )
  insert.run(
    'unchanged',
    identity,
    4,
    'removed',
    actor,
    'After',
    null,
    4,
    null,
    'unchanged',
    JSON.stringify({ fingerprint: 'c'.repeat(64) }),
    actor,
    13,
  )
  insert.run(
    'pending',
    identity,
    5,
    'removed',
    actor,
    'After',
    null,
    5,
    null,
    'pending',
    null,
    null,
    null,
  )
  return { db, root }
}
const rows = (db: AppDatabase) =>
  db.prepare('SELECT * FROM identity_memory_amendment ORDER BY seq').all()
const indexes = (db: AppDatabase) =>
  db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='identity_memory_amendment' ORDER BY name",
    )
    .all()

it.each([18, 21])(
  'keeps every populated post-%i memory row, relation and outcome through migration and second open',
  (last) => {
    const { db } = fixture(last)
    const before = rows(db)
    const priorIndexes = indexes(db)
    applyMigrations(db, migrations)
    expect(rows(db)).toEqual(before)
    expect(indexes(db)).toEqual(priorIndexes)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    applyMigrations(db, migrations)
    expect(rows(db)).toEqual(before)
    const store = createSessionStore(db)
    expect(store.memoryAmendment('lark', 'pending')?.outcome).toBe('pending')
    expect(store.memoryAmendment('lark', 'partial')).toMatchObject({
      outcome: 'partial',
      actual: {},
    })
    expect(store.memoryAmendment('lark', 'restore')).toMatchObject({
      outcome: 'done',
      textAfter: 'Before',
      actual: {},
    })
    expect(() =>
      db.prepare("UPDATE identity_memory_amendment SET id='orphan' WHERE id='delete'").run(),
    ).toThrow()
    expect(() =>
      db
        .prepare(
          "UPDATE identity_memory_amendment SET outcome='pending', actual=NULL, settled_by=NULL, settled_at=NULL WHERE id='partial'",
        )
        .run(),
    ).toThrow()
  },
)

it('rolls back the rebuilt table, rows, indexes and migration journal together on a late SQL failure', () => {
  const { db, root } = fixture(21)
  const before = rows(db)
  const priorIndexes = indexes(db)
  const priorJournal = db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()
  const priorTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE name='identity_memory_amendment'")
    .get()
  const broken = join(root, 'broken')
  mkdirSync(join(broken, 'meta'), { recursive: true })
  for (const entry of journal.entries)
    copyFileSync(join(migrations, `${entry.tag}.sql`), join(broken, `${entry.tag}.sql`))
  writeFileSync(join(broken, 'meta/_journal.json'), JSON.stringify(journal))
  const migration = join(broken, '0022_memory_observed_text.sql')
  writeFileSync(
    migration,
    readFileSync(migration, 'utf8') +
      '\n--> statement-breakpoint\nSELECT * FROM deliberately_missing_migration_table;\n',
  )
  expect(() => applyMigrations(db, broken)).toThrow()
  expect(rows(db)).toEqual(before)
  expect(indexes(db)).toEqual(priorIndexes)
  expect(db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()).toEqual(priorJournal)
  expect(
    db.prepare("SELECT sql FROM sqlite_master WHERE name='identity_memory_amendment'").get(),
  ).toEqual(priorTable)
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name='identity_memory_amendment_next'").get(),
  ).toBeUndefined()
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})
