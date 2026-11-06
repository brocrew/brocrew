import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { HAND_WRITTEN_OBJECTS, QUESTION_COPY_TRIGGERS } from '../src/main/db/question-copies'

const db_ = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db')
const migrations = join(db_, 'migrations')

/**
 * The schema objects written by hand in migrations — those the generated schema does not know, so
 * a generated rebuild of their table drops them — are declared, and a rebuild of `events` the way
 * the migration generator writes one is survived: the copies' triggers come back at open and their
 * fill starts again, and every hand-written index it dropped is named.
 */
describe('hand-written schema survives a rebuild', () => {
  let folder: string
  let db: AppDatabase
  const said: string[] = []

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'fictional-schema-'))
    db = openDatabase(join(folder, 'fictional.sqlite'))
    applyMigrations(db, migrations)
    said.length = 0
    vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
      said.push(String(line))
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('every partial index, and every index and trigger the generated schema does not know, is declared', () => {
    const schema = readFileSync(join(db_, 'schema.ts'), 'utf8')
    const written = readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .flatMap((name) =>
        [
          ...readFileSync(join(migrations, name), 'utf8').matchAll(
            /CREATE\s+(?:UNIQUE\s+)?(INDEX|TRIGGER)\s+`?(\w+)`?([^;]*)/gi,
          ),
        ].map((one) => ({
          type: one[1]!.toLowerCase(),
          name: one[2]!,
          partial: /\bWHERE\b/i.test(one[3] ?? ''),
        })),
      )
      // Unknown to the generated schema, or a partial index, which a rebuild may not carry over.
      .filter(
        (one) =>
          one.partial || (!schema.includes(`'${one.name}'`) && !schema.includes(`"${one.name}"`)),
      )
      // One a later migration dropped with its table is gone, not missing.
      .filter(
        (one) =>
          db
            .prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?')
            .get(one.type, one.name) !== undefined,
      )
    expect(written.length).toBeGreaterThan(0)
    const declared = new Set(HAND_WRITTEN_OBJECTS.map((one) => `${one.type} ${one.name}`))
    for (const one of written)
      expect(declared, `${one.type} ${one.name}`).toContain(`${one.type} ${one.name}`)
    // And each declared object exists once every migration has run.
    for (const one of HAND_WRITTEN_OBJECTS)
      expect(
        db
          .prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?')
          .get(one.type, one.name),
        `${one.type} ${one.name}`,
      ).toBeDefined()
  })

  it('a missing guard is said as a rule not enforced, and a missing read index as slower reads', () => {
    db.exec('DROP TRIGGER skill_version_no_update')
    db.exec('DROP INDEX events_fold_idx')
    createSessionStore(db)
    expect(said.find((line) => line.includes('skill_version_no_update'))).toContain('not enforced')
    expect(said.find((line) => line.includes('events_fold_idx'))).toContain('slower')
  })

  it('a rebuild of events as the generator writes one is repaired at open, and what it dropped is named', () => {
    const store = createSessionStore(db)
    store.create({
      id: 'alpha',
      provider: 'codex',
      cwd: folder,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    db.prepare('UPDATE question_copy_progress SET done = 1 WHERE id = 1').run()
    // The generator's rebuild: a new table, the rows copied, the old one dropped, the new renamed.
    const columns = (db.prepare("PRAGMA table_info('events')").all() as { name: string }[])
      .map((one) => `\`${one.name}\``)
      .join(', ')
    const create = (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'")
        .get() as {
        sql: string
      }
    ).sql.replace(/CREATE TABLE [`"]?events[`"]?/, 'CREATE TABLE `__new_events`')
    db.pragma('foreign_keys = OFF')
    db.exec(create)
    db.exec(`INSERT INTO __new_events (${columns}) SELECT ${columns} FROM events`)
    db.exec('DROP TABLE events')
    db.exec('ALTER TABLE __new_events RENAME TO events')
    db.pragma('foreign_keys = ON')
    for (const name of Object.keys(QUESTION_COPY_TRIGGERS))
      expect(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name),
      ).toBeUndefined()

    createSessionStore(db)
    for (const name of Object.keys(QUESTION_COPY_TRIGGERS))
      expect(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name),
      ).toBeDefined()
    expect(db.prepare('SELECT done FROM question_copy_progress WHERE id = 1').get()).toEqual({
      done: 0,
    })
    for (const name of ['events_kind_owner_idx', 'events_work_piece_idx'])
      expect(
        said.some((line) => line.includes(name)),
        name,
      ).toBe(true)
  })
})
