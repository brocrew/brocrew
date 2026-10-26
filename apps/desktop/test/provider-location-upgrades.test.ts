import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { buildLineage } from '../src/main/recovery/database-facts'
import { NewerDatabaseError, openOrRefuse } from '../src/main/db/newer-database'
import releases from './fixtures/provider-location-releases/releases.json'

const here = dirname(fileURLToPath(import.meta.url))
const current = join(here, '../src/main/db/migrations')
const fixtures = join(here, 'fixtures/provider-location-releases')
let dir: string
let handles: AppDatabase[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-location-upgrade-'))
  handles = []
})
afterEach(() => {
  for (const db of handles) if (db.open) db.close()
  rmSync(dir, { recursive: true, force: true })
})
function open(file: string) {
  const db = openDatabase(file)
  handles.push(db)
  return db
}
function stage(release: (typeof releases)[number]) {
  const folder = join(dir, release.release)
  mkdirSync(join(folder, 'meta'), { recursive: true })
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(release.journal))
  for (const file of release.files) {
    const source = join(fixtures, 'sql', `${file.sha256}.sql`)
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(file.sha256)
    copyFileSync(source, join(folder, `${file.tag}.sql`))
  }
  return folder
}
function seed(db: AppDatabase) {
  const columns = (db.pragma('table_info(provider_session)') as Array<{ name: string }>).map(
    (x) => x.name,
  )
  for (const provider of ['claude', 'codex'])
    for (const profile of [null, 'default', 'brobot', 'Fern']) {
      const values: Record<string, string | number | null> = {
        id: `${provider}_${profile ?? 'omitted'}`,
        provider,
        cwd: '/fictional/fern',
        status: 'ended',
        external_ref: JSON.stringify({
          provider,
          sessionId: `thread_${provider}_${profile ?? 'omitted'}`,
          cwd: '/fictional/fern',
          rotation: 0,
        }),
        profile_id: profile,
        created_at: 100,
        updated_at: 200,
      }
      const names = Object.keys(values).filter((name) => columns.includes(name))
      db.prepare(
        `INSERT INTO provider_session (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
      ).run(...names.map((name) => values[name]))
    }
}
const rows = (db: AppDatabase) =>
  db.prepare('SELECT * FROM provider_session ORDER BY id').all() as Array<Record<string, unknown>>
const migrationRows = (db: AppDatabase) =>
  db.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all()

// These fixtures pin each release's migration SQL, not a packaged-app upgrade or provider resume.
it.each(releases)(
  'adds a nullable location without changing fictional $release records',
  (release) => {
    expect(release.commit).toMatch(/^[0-9a-f]{40}$/)
    const db = open(join(dir, 'workspace.sqlite'))
    applyMigrations(db, stage(release))
    seed(db)
    const before = rows(db)
    applyMigrations(db, current)
    const upgraded = rows(db)
    for (const row of upgraded) expect(row.provider_home).toBeNull()
    expect(
      upgraded.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'provider_home')),
      ),
    ).toEqual(
      before.map((row) =>
        Object.fromEntries(
          Object.keys(upgraded[0]!)
            .filter((key) => key !== 'provider_home')
            .map((key) => [key, key in row ? row[key] : null]),
        ),
      ),
    )
    const column = (
      db.pragma('table_info(provider_session)') as Array<{
        name: string
        notnull: number
        dflt_value: unknown
      }>
    ).find((x) => x.name === 'provider_home')
    expect(column).toMatchObject({ notnull: 0, dflt_value: null })
    const migrations = migrationRows(db)
    applyMigrations(db, current)
    expect(rows(db)).toEqual(upgraded)
    expect(migrationRows(db)).toEqual(migrations)
  },
)

it('retains downgrade refusal and the untouched pre-upgrade backup', async () => {
  const release = releases.find((x) => x.release === 'v0.1.7')!
  const previous = stage(release)
  const file = join(dir, 'workspace.sqlite')
  const db = open(file)
  applyMigrations(db, previous)
  seed(db)
  const oldRows = rows(db)
  const backup = join(dir, 'pre-upgrade.sqlite')
  await db.backup(backup)
  applyMigrations(db, current)
  db.prepare(
    "UPDATE provider_session SET provider_home = 'default/Fern/codex' WHERE id = 'codex_Fern'",
  ).run()
  const upgraded = rows(db)
  const recorded = migrationRows(db)
  db.close()
  // Node-level rehearsal of the unchanged startup guard. The packaged previous-release lane is separate.
  const awaitPrevious = await buildLineage(previous)
  const older = open(file)
  expect(() => openOrRefuse(older, awaitPrevious, { folder: dir })).toThrow(NewerDatabaseError)
  expect(older.open).toBe(false)
  const after = open(file)
  expect(rows(after)).toEqual(upgraded)
  expect(migrationRows(after)).toEqual(recorded)
  openOrRefuse(after, await buildLineage(current), { folder: dir })
  expect(rows(after).find((row) => row.id === 'codex_Fern')?.provider_home).toBe(
    'default/Fern/codex',
  )
  const restored = open(backup)
  openOrRefuse(restored, await buildLineage(previous), { folder: dir })
  expect(rows(restored)).toEqual(oldRows)
  expect(rows(restored).some((row) => 'provider_home' in row)).toBe(false)
})
