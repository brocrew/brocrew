import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { howTheDatabaseFits } from '../src/main/db/newer-database'
import { SKILL_CATALOGUE_TABLES } from '../src/main/db/skill-catalogue-tables'
import { verifyBuiltInSkills } from '../src/main/skills/built-in-catalogue'
import { SqliteSkillCatalogue } from '../src/main/skills/catalogue-store'
import { BUILT_IN_SKILL_NAMES } from '../src/shared/built-in-skills'
import { SKILL_CATALOGUE_RECOVERY, APP_STATE_FILES } from '../src/main/recovery/state-files'
import {
  buildLineage,
  migrationsRecordedIn,
  isLineagePrefix,
} from '../src/main/recovery/database-facts'
import { makeCheckpoint } from '../src/main/recovery/checkpoint'
import { restore, returnToNewer } from '../src/main/recovery/restore'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const resources = join(here, '../resources/built-in-skills')
const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
  entries: { tag: string; when: number }[]
}
const catalogueMigration = journal.entries.findIndex(
  (entry) => entry.tag === '0012_skills_catalogue',
)
if (catalogueMigration < 1) throw new Error('The skills catalogue migration boundary is missing')
const source = () =>
  verifyBuiltInSkills(
    JSON.parse(readFileSync(join(resources, 'manifest.json'), 'utf8')),
    new Map(
      BUILT_IN_SKILL_NAMES.map((name) => [
        name,
        readFileSync(join(resources, name, 'SKILL.md'), 'utf8'),
      ]),
    ),
  )
const draft = (text: string) => {
  const body = `---\nname: recipe-check\ndescription: Check a fictional recipe.\n---\n\n${text}`
  return {
    name: 'recipe-check',
    description: 'Check a fictional recipe.',
    reminder: 'Check quantities.',
    path: 'recipe-check/SKILL.md',
    body,
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
  }
}
let root: string
let handles: AppDatabase[]
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-skills-upgrade-'))
  handles = []
})
afterEach(() => {
  for (const db of handles) if (db.open) db.close()
  rmSync(root, { recursive: true, force: true })
})
function database(file: string) {
  const db = openDatabase(file)
  handles.push(db)
  return db
}
function priorMigrations() {
  const folder = join(root, 'prior-migrations')
  cpSync(migrations, folder, { recursive: true })
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, catalogueMigration) }),
  )
  return folder
}
function identity(db: AppDatabase) {
  db.prepare(
    "INSERT INTO agent_identity (id, slug, created_at) VALUES ('aid:recipe-worker', 'recipe-worker', 1)",
  ).run()
}

describe('skills follow the database upgrade and recovery boundary', () => {
  it('upgrades the previous workspace in place and declares exactly four restored tables', () => {
    const db = database(join(root, 'old.sqlite'))
    applyMigrations(db, priorMigrations())
    identity(db)
    const before = db.prepare('SELECT * FROM agent_identity').all()
    applyMigrations(db, migrations)
    const names = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'skill_%' ORDER BY name",
      )
      .all() as { name: string }[]
    expect(names.map((one) => one.name)).toEqual([...SKILL_CATALOGUE_TABLES])
    expect(SKILL_CATALOGUE_RECOVERY).toMatchObject({
      tables: SKILL_CATALOGUE_TABLES,
      restore: 'with-the-database',
    })
    expect(
      APP_STATE_FILES.filter((one) => /skill/.test(one.name)).map((one) => [one.name, one.restore]),
    ).toEqual([
      ['skills', 'with-the-database'],
      ['skills-off', 'with-the-database'],
      ['skills-conversion.json', 'with-the-database'],
    ])
    expect(db.prepare('SELECT * FROM agent_identity').all()).toEqual(before)
    const catalogue = new SqliteSkillCatalogue(db, source())
    expect(catalogue.list().total).toBe(8)
    catalogue.select('aid:recipe-worker', 'built-in/delegate', 'off', catalogue.list().revision)
    applyMigrations(db, migrations)
    expect(
      new SqliteSkillCatalogue(db, source())
        .resolve('aid:recipe-worker', { canCreateAgents: true, isCoordinator: false })
        .choices.find((one) => one.skill.id === 'built-in/delegate')?.selection,
    ).toBe('off')
  })
  it('rolls back an interrupted migration wholly, and retries without changing previous rows', () => {
    const db = database(join(root, 'interrupted.sqlite'))
    applyMigrations(db, priorMigrations())
    identity(db)
    const before = migrationsRecordedIn(db)
    const failing = join(root, 'failing-migrations')
    cpSync(migrations, failing, { recursive: true })
    const sql = join(failing, `${journal.entries[catalogueMigration]!.tag}.sql`)
    writeFileSync(
      sql,
      readFileSync(sql, 'utf8') +
        '\n--> statement-breakpoint\nSELECT fictional_migration_interruption();\n',
    )
    expect(() => applyMigrations(db, failing)).toThrow('fictional_migration_interruption')
    expect(migrationsRecordedIn(db)).toEqual(before)
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'skill_%'").all()).toEqual([])
    expect(db.prepare('SELECT id FROM agent_identity').all()).toEqual([{ id: 'aid:recipe-worker' }])
    applyMigrations(db, migrations)
    expect(new SqliteSkillCatalogue(db, source()).list().total).toBe(8)
  })
  it('an older build refuses the migrated skills database before opening it', async () => {
    const old = await buildLineage(priorMigrations())
    const current = await buildLineage(migrations)
    const db = database(join(root, 'newer.sqlite'))
    applyMigrations(db, migrations)
    new SqliteSkillCatalogue(db, source())
    expect(howTheDatabaseFits(db, current).kind).toBe('fits')
    expect(howTheDatabaseFits(db, old).kind).toBe('newer')
  })
  it('upgrades a pre-skills checkpoint, restores it, rehearses the current migrations and returns to saved choices/history', async () => {
    const userData = join(root, 'pre-skills-workspace')
    mkdirSync(userData)
    const file = join(userData, 'brobot2.sqlite')
    let db = database(file)
    applyMigrations(db, priorMigrations())
    identity(db)
    const oldRows = db.prepare('SELECT * FROM agent_identity').all()
    expect(migrationsRecordedIn(db)).toHaveProperty('migrations.length', 12)
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'skill_%'").all()).toEqual([])
    db.close()
    const checkpoint = await makeCheckpoint({
      userData,
      ownership: 'sole',
      appVersion: 'fictional-before-skills',
      build: 'fictional-before-skills',
      reason: 'before-migration',
      freeBytes: () => 1_000_000_000,
      log: () => {},
    })
    db = database(file)
    applyMigrations(db, migrations)
    let catalogue = new SqliteSkillCatalogue(db, source())
    catalogue.savePersonal(draft('First fictional recipe.'), catalogue.list().revision)
    const first = catalogue.detail('person/recipe-check')!
    catalogue.select('aid:recipe-worker', first.id, 'on', catalogue.list().revision)
    catalogue.savePersonal(
      draft('Second fictional recipe.'),
      catalogue.list().revision,
      first.versionId,
    )
    catalogue.select('aid:recipe-worker', first.id, 'off', catalogue.list().revision)
    const second = catalogue.detail(first.id)!
    expect(migrationsRecordedIn(db)).toHaveProperty('migrations.length', journal.entries.length)
    db.close()
    const lineage = await buildLineage(migrations)
    await restore({
      userData,
      checkpointId: checkpoint.manifest.id,
      canOpen: (saved) => isLineagePrefix(saved, lineage),
    })
    // Rehearse the next upgrade on the restored bytes without changing the return-to-newer fingerprint.
    const copy = join(root, 'restored-12-rehearsal.sqlite')
    copyFileSync(file, copy)
    db = database(copy)
    expect(migrationsRecordedIn(db)).toHaveProperty('migrations.length', 12)
    expect(db.prepare('SELECT * FROM agent_identity').all()).toEqual(oldRows)
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'skill_%'").all()).toEqual([])
    applyMigrations(db, migrations)
    catalogue = new SqliteSkillCatalogue(db, source())
    expect(migrationsRecordedIn(db)).toHaveProperty('migrations.length', journal.entries.length)
    expect(catalogue.list().total).toBe(8)
    expect(db.prepare('SELECT * FROM agent_identity').all()).toEqual(oldRows)
    expect(db.prepare('SELECT * FROM skill_selection').all()).toEqual([])
    expect(catalogue.detail(first.id)).toBeNull()
    db.close()
    await returnToNewer({ userData })
    db = database(file)
    catalogue = new SqliteSkillCatalogue(db, source())
    expect(migrationsRecordedIn(db)).toHaveProperty('migrations.length', journal.entries.length)
    expect(db.prepare('SELECT * FROM agent_identity').all()).toEqual(oldRows)
    expect(catalogue.detail(first.id)?.body).toBe(second.body)
    expect(catalogue.detail(first.id, first.versionId)?.body).toBe(first.body)
    expect(
      catalogue
        .resolve('aid:recipe-worker', { canCreateAgents: true, isCoordinator: false })
        .choices.find((one) => one.skill.id === first.id)?.selection,
    ).toBe('off')
  })
  it('real checkpoint restore and return keep source bodies and choices from the same database', async () => {
    const userData = join(root, 'workspace')
    mkdirSync(userData)
    const file = join(userData, 'brobot2.sqlite')
    let db = database(file)
    applyMigrations(db, migrations)
    identity(db)
    let catalogue = new SqliteSkillCatalogue(db, source())
    catalogue.savePersonal(draft('First fictional recipe.'), catalogue.list().revision)
    const first = catalogue.detail('person/recipe-check')!
    catalogue.select('aid:recipe-worker', first.id, 'on', catalogue.list().revision)
    db.close()
    const checkpoint = await makeCheckpoint({
      userData,
      ownership: 'sole',
      appVersion: 'fictional',
      build: 'fictional-build',
      reason: 'before-migration',
      freeBytes: () => 1_000_000_000,
      log: () => {},
    })
    db = database(file)
    catalogue = new SqliteSkillCatalogue(db, source())
    catalogue.savePersonal(
      draft('Second fictional recipe.'),
      catalogue.list().revision,
      first.versionId,
    )
    catalogue.select('aid:recipe-worker', first.id, 'off', catalogue.list().revision)
    db.close()
    const lineage = await buildLineage(migrations)
    await restore({
      userData,
      checkpointId: checkpoint.manifest.id,
      canOpen: (saved) => isLineagePrefix(saved, lineage),
    })
    const inspect = (name: string) => {
      const copy = join(root, `${name}.sqlite`)
      copyFileSync(file, copy)
      const db = database(copy)
      const view = new SqliteSkillCatalogue(db, source())
      const result = {
        body: view.detail(first.id)?.body,
        selection: view
          .resolve('aid:recipe-worker', { canCreateAgents: true, isCoordinator: false })
          .choices.find((one) => one.skill.id === first.id)?.selection,
      }
      db.close()
      return result
    }
    expect(inspect('restored')).toEqual({ body: first.body, selection: 'on' })
    await returnToNewer({ userData })
    expect(inspect('returned')).toEqual({
      body: draft('Second fictional recipe.').body,
      selection: 'off',
    })
  })
})
