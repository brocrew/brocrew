import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let folder: string
let db: AppDatabase
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'fictional-stall-cut-'))
  db = openDatabase(join(folder, 'record.sqlite'))
})
afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})
const cuts = () => db.prepare('SELECT * FROM work_legacy_stall_cut ORDER BY session_id').all()
const session = (id: string) =>
  db
    .prepare(
      "INSERT INTO provider_session (id,provider,cwd,status,created_at,updated_at) VALUES (?, 'codex', '/tmp/fictional', 'idle', 1, 1)",
    )
    .run(id)
const event = (id: string, generation: number, ordinal: number, time: number) =>
  db
    .prepare(
      'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?,?,?,?,\'turn\',\'{"type":"turn","state":"completed"}\',?)',
    )
    .run(`${id}-${generation}-${ordinal}`, id, generation, ordinal, time)

it('a fresh cut is empty; later conversations are never retroactively grandfathered on rerun', () => {
  applyMigrations(db, migrations)
  expect(cuts()).toEqual([])
  session('later')
  event('later', 0, 0, 100)
  applyMigrations(db, migrations)
  expect(cuts()).toEqual([])
})

it('upgrade captures each active ordinal once, independent of clocks and unused generations', () => {
  const old = join(folder, 'old-migrations')
  cpSync(migrations, old, { recursive: true })
  const path = join(old, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { idx: number }[] }
  journal.entries = journal.entries.filter((entry) => entry.idx <= 9)
  writeFileSync(path, JSON.stringify(journal))
  applyMigrations(db, old)
  for (const id of ['empty', 'original', 'rebuilt']) session(id)
  event('original', 0, 2, 5000)
  event('original', 0, 7, 1)
  event('rebuilt', 0, 99, 99999)
  db.prepare(
    'INSERT INTO derived_generation (session_id,active,normalizer_version,derived_through,highest,updated_at) VALUES (?,2,1,0,2,0)',
  ).run('rebuilt')
  event('rebuilt', 2, 3, 0)
  applyMigrations(db, migrations)
  const expected = [
    { session_id: 'empty', generation: 0, through_ordinal: -1 },
    { session_id: 'original', generation: 0, through_ordinal: 7 },
    { session_id: 'rebuilt', generation: 2, through_ordinal: 3 },
  ]
  expect(cuts()).toEqual(expected)
  event('original', 0, 8, -1000)
  applyMigrations(db, migrations)
  expect(cuts()).toEqual(expected)
  db.prepare('DELETE FROM provider_session WHERE id = ?').run('empty')
  expect(cuts()).toEqual(expected.slice(1))
})
