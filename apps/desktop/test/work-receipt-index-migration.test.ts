import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { inspect } from '../src/main/recovery/coordinator'
import { listCheckpoints } from '../src/main/recovery/checkpoint'
import { checkpointDatabase } from '../src/main/recovery/layout'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let folder: string
let db: AppDatabase
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brobot-receipt-index-'))
  db = openDatabase(join(folder, 'brobot2.sqlite'))
})
afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})

function plans(): void {
  const owner = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT payload, created_at FROM events INDEXED BY events_kind_owner_idx
    WHERE type = 'work_reconciliation' AND session_id = ? ORDER BY generation, ordinal`,
    )
    .all('owner')
  const piece = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT payload, created_at FROM events INDEXED BY events_work_piece_idx
    WHERE type = 'work_reconciliation' AND session_id = ?
      AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?
    ORDER BY generation, ordinal`,
    )
    .all('owner', 'piece')
  const unread = db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT 1 FROM events INDEXED BY events_work_piece_idx
    WHERE type = 'work_reconciliation' AND session_id = ?
      AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END IS NULL LIMIT 1`,
    )
    .all('owner')
  expect(JSON.stringify(owner)).toContain('events_kind_owner_idx')
  expect(JSON.stringify(piece)).toContain('events_work_piece_idx')
  expect(JSON.stringify(piece)).toContain('session_id=? AND <expr>=?')
  expect(JSON.stringify(unread)).toContain('events_work_piece_idx')
  expect(JSON.stringify(unread)).toContain('session_id=? AND <expr>=?')
}

it('a fresh database has both receipt read indexes, and rerunning changes nothing', () => {
  applyMigrations(db, migrations)
  plans()
  const before = db.prepare('SELECT * FROM __drizzle_migrations').all()
  applyMigrations(db, migrations)
  expect(db.prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(before)
  plans()
})

it('upgrades from 0007 without losing old rows and makes the automatic pre-migration copy', async () => {
  const old = join(folder, 'old-migrations')
  cpSync(migrations, old, { recursive: true })
  const journalPath = join(old, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] }
  const currentMigrationCount = journal.entries.length
  journal.entries = journal.entries.filter((one) => one.idx <= 7)
  writeFileSync(journalPath, JSON.stringify(journal))
  applyMigrations(db, old)
  db.prepare(
    `INSERT INTO provider_session (id,provider,cwd,status,created_at,updated_at)
    VALUES ('owner','claude','/tmp/fictional','idle',1,1)`,
  ).run()
  const insert =
    db.prepare(`INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at)
    VALUES (?, 'owner',0,?,?,?,1)`)
  const rows = [
    ['work_reconciliation', '{"piece":"piece"}'],
    ['work_reconciliation', '{'],
    ['work_reconciliation', '{}'],
    ['work_recovery', '{}'],
    ['memory_note', '{}'],
    ['work_given', '{}'],
    ['user_turn', '{}'],
  ]
  for (const [i, row] of rows.entries()) insert.run(`row-${i}`, i, row[0], row[1])
  const before = db.prepare('SELECT * FROM events ORDER BY ordinal').all()
  db.close()
  try {
    expect(
      await inspect({
        userData: folder,
        buildMigrationsFolder: migrations,
        appVersion: '1.0.0',
        build: 'fictional-receipt-index',
        packaged: false,
        ownership: async () => 'sole',
        log: () => {},
      }),
    ).toEqual({ kind: 'open', checkpoint: 'made' })
    const copies = await listCheckpoints(folder)
    expect(copies).toHaveLength(1)
    expect(copies[0]!.manifest.reason).toBe('before-migration')
    const copy = openDatabase(checkpointDatabase(folder, copies[0]!.manifest.id))
    try {
      expect(copy.prepare('SELECT * FROM events ORDER BY ordinal').all()).toEqual(before)
      expect(copy.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 8 })
      expect(
        copy.prepare("SELECT name FROM sqlite_master WHERE name = 'events_work_piece_idx'").get(),
      ).toBeUndefined()
    } finally {
      copy.close()
    }
  } finally {
    db = openDatabase(join(folder, 'brobot2.sqlite'))
  }
  applyMigrations(db, migrations)
  expect(db.prepare('SELECT * FROM events ORDER BY ordinal').all()).toEqual(before)
  plans()
  expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: currentMigrationCount,
  })
  applyMigrations(db, migrations)
  expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: currentMigrationCount,
  })
})
