import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  counted,
  howTheDatabaseFits,
  NewerDatabaseError,
  newerDatabaseSentence,
  openOrRefuse,
  UnreadableDatabaseError,
  unreadableDatabaseSentence,
} from '../src/main/db/newer-database'
import {
  buildLineage,
  lineageFit,
  migrationsRecordedIn,
  type BuildMigration,
} from '../src/main/recovery/database-facts'

/**
 * 🔴 **W4.105 · A1 — a build refuses a database a newer build migrated.**
 *
 *  - §1 · the premise: Drizzle's migrator says nothing on a newer database — it applies nothing.
 *  - §2 · the passes: a new database, one this build migrated, one an older build migrated.
 *  - §3 · the refusals: a database with a later migration than this build knows — counted
 *    higher, or the same count with a change this build lacks — one whose record cannot be read,
 *    one with tables and no record, one whose migrations this build does not carry (by time or by
 *    hash), and the sentence a person reads.
 *  - §4 · open or refuse: asked before any migration, with no way past it.
 *  - §5 · the wiring: after the start-up check, before any migration, and said in a dialog on a
 *    person's launch.
 *
 * ⚑ Throwaway databases only, in this run's own temp folders.
 */

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(here, '../src/main/db/migrations')
const roots: string[] = []
const open: AppDatabase[] = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const aDatabase = (): { db: AppDatabase; file: string } => {
  const root = mkdtempSync(join(tmpdir(), 'brobot-newer-db-'))
  roots.push(root)
  const file = join(root, 'brobot2.sqlite')
  const db = openDatabase(file)
  open.push(db)
  return { db, file }
}
let build: readonly BuildMigration[] = []
beforeAll(async () => {
  build = await buildLineage(MIGRATIONS)
})
/** A migration file's hash, as the migrator records one. */
const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex')
/** How many migrations a database records, or null when it records none it can read. */
const countIn = (db: AppDatabase): number | null => {
  const record = migrationsRecordedIn(db)
  return record.kind === 'recorded' ? record.migrations.length : null
}
/** A migration a newer build would have written: later than any this build carries. */
const aNewerMigration = (db: AppDatabase, later = 60_000): void => {
  db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
    hashOf('-- a newer build'),
    counted(build).latest + later,
  )
}

describe('§1 · the premise: the migrator says nothing on a newer database', () => {
  it('⛔ applying this build’s migrations to a newer database neither fails nor changes it', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    aNewerMigration(db)
    const before = migrationsRecordedIn(db)
    expect(() => applyMigrations(db, MIGRATIONS)).not.toThrow()
    expect(migrationsRecordedIn(db)).toEqual(before)
  })

  it('⚑ this build’s journal is what its migrations folder holds', () => {
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))
    expect(build).toHaveLength(files.length)
    expect(counted(build).latest).toBeGreaterThan(0)
  })
})

describe('§2 · the passes', () => {
  it('🔴 the boundary: a database whose latest migration is this build’s own opens; one later by 1 ms does not', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    expect(howTheDatabaseFits(db, build).kind).toBe('fits')
    aNewerMigration(db, 1)
    expect(howTheDatabaseFits(db, build).kind).toBe('newer')
  })

  it('🔴 a new workspace, with no migration recorded yet, or an empty record', () => {
    const { db } = aDatabase()
    expect(migrationsRecordedIn(db)).toEqual({ kind: 'empty' })
    expect(howTheDatabaseFits(db, build)).toEqual({ kind: 'fits' })
    db.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text, created_at numeric)',
    )
    expect(migrationsRecordedIn(db)).toEqual({ kind: 'empty' })
    expect(howTheDatabaseFits(db, build)).toEqual({ kind: 'fits' })
  })

  it('🔴 a database this build migrated: its record is this build’s migrations, by time and hash', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    expect(migrationsRecordedIn(db)).toEqual({
      kind: 'recorded',
      migrations: build.map(({ createdAt, hash }) => ({ createdAt, hash })),
    })
    expect(howTheDatabaseFits(db, build)).toEqual({ kind: 'fits' })
  })

  it('🔴 a database an older build migrated — this build brings it forward', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    db.prepare(
      'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)',
    ).run()
    expect(countIn(db)).toBe(build.length - 1)
    expect(howTheDatabaseFits(db, build)).toEqual({ kind: 'fits' })
  })
})

describe('§3 · the refusals', () => {
  it('🔴 a database a newer build migrated further: its version and this build’s, named', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    aNewerMigration(db)
    const fit = howTheDatabaseFits(db, build)
    const { count, latest } = counted(build)
    expect(fit).toEqual({
      kind: 'newer',
      inTheDatabase: { count: count + 1, latest: latest + 60_000 },
      inTheBuild: { count, latest },
    })
    if (fit.kind !== 'newer') throw new Error('unreachable')
    expect(newerDatabaseSentence('/Users/x/brobot-research', fit)).toBe(
      `A newer version of BroCrew has updated this workspace's data (/Users/x/brobot-research) to database version ${String(count + 1)}, and this version of BroCrew reads up to version ${String(count)}. ` +
        'So this version of BroCrew did not open it, and nothing in it was changed. ' +
        'Open this workspace with the newer version of BroCrew, or update this one.',
    )
  })

  it('🔴 the same count, with a later change this build lacks: still refused, said without numbers', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    db.prepare(
      'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)',
    ).run()
    aNewerMigration(db)
    const fit = howTheDatabaseFits(db, build)
    expect(fit.kind).toBe('newer')
    if (fit.kind !== 'newer') throw new Error('unreachable')
    expect(newerDatabaseSentence('/f', fit)).toContain(
      'with a database change this version of BroCrew does not have',
    )
  })

  it('⚑ the refusal reads the database and changes nothing in it', () => {
    const { db, file } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    aNewerMigration(db)
    db.pragma('wal_checkpoint(TRUNCATE)')
    const sum = (): string => createHash('sha256').update(readFileSync(file)).digest('hex')
    const before = sum()
    howTheDatabaseFits(db, build)
    db.pragma('wal_checkpoint(TRUNCATE)')
    expect(sum()).toBe(before)
  })

  it('🔴 a record this build cannot read is refused, not left to the migrator', () => {
    const notATime = aDatabase().db
    notATime.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text, created_at numeric)',
    )
    notATime
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('a-hash', 'not a time')
    expect(howTheDatabaseFits(notATime, build)).toEqual({
      kind: 'unreadable',
      detail: 'its migration record holds a row this build cannot read',
    })

    const noTime = aDatabase().db
    noTime.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text)')
    noTime.prepare('INSERT INTO __drizzle_migrations (hash) VALUES (?)').run('a-hash')
    const fit = howTheDatabaseFits(noTime, build)
    expect(fit.kind).toBe('unreadable')
    if (fit.kind !== 'unreadable') throw new Error('unreachable')
    expect(fit.detail).toMatch(/created_at/)
    expect(unreadableDatabaseSentence('/f', fit.detail)).toBe(
      `BroCrew could not read which version this workspace's data (/f) is at: ${fit.detail}. ` +
        'So this version of BroCrew did not open it, and nothing in it was changed.',
    )
  })

  it('🔴 tables with no migration record are refused: no migrator made them, and migrating would write into them', () => {
    const { db } = aDatabase()
    db.exec('CREATE TABLE somebody_elses (x)')
    expect(howTheDatabaseFits(db, build)).toEqual({
      kind: 'unreadable',
      detail: 'it holds tables but no migration record',
    })
    db.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text, created_at numeric)',
    )
    expect(howTheDatabaseFits(db, build).kind).toBe('unreadable')
  })

  it('🔴 a migration this build does not carry, none later than its own, is refused: by time or by hash', () => {
    const byTime = aDatabase().db
    applyMigrations(byTime, MIGRATIONS)
    byTime
      .prepare(
        'UPDATE __drizzle_migrations SET created_at = created_at - 1 WHERE created_at = (SELECT min(created_at) FROM __drizzle_migrations)',
      )
      .run()
    const fit = howTheDatabaseFits(byTime, build)
    expect(fit.kind).toBe('unreadable')
    if (fit.kind !== 'unreadable') throw new Error('unreachable')
    expect(fit.detail).toMatch(/does not carry/)

    // The same times, and one file's text changed since: a different migration.
    const byHash = aDatabase().db
    applyMigrations(byHash, MIGRATIONS)
    byHash
      .prepare(
        'UPDATE __drizzle_migrations SET hash = ? WHERE created_at = (SELECT min(created_at) FROM __drizzle_migrations)',
      )
      .run(hashOf('-- another text'))
    expect(howTheDatabaseFits(byHash, build).kind).toBe('unreadable')
  })

  it('⚑ the rule, alone: a prefix fits, a later latest is newer, anything else is foreign', () => {
    const applied = build.map(({ createdAt, hash }) => ({ createdAt, hash }))
    expect(lineageFit([], build)).toBe('fits')
    expect(lineageFit(applied.slice(0, 3), build)).toBe('fits')
    const later = { createdAt: counted(build).latest + 1, hash: hashOf('x') }
    expect(lineageFit([...applied, later], build)).toBe('newer')
    expect(lineageFit([...applied.slice(0, -1), later], build)).toBe('newer')
    const first = applied[0]
    if (first === undefined) throw new Error('this build carries no migration')
    expect(lineageFit([{ ...first, hash: hashOf('y') }], build)).toBe('foreign')
    expect(lineageFit([{ ...first, createdAt: first.createdAt - 1 }], build)).toBe('foreign')
  })

  it('⚑ the error carries the sentence a person reads', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    aNewerMigration(db)
    const fit = howTheDatabaseFits(db, build)
    if (fit.kind !== 'newer') throw new Error('unreachable')
    const error = new NewerDatabaseError('/f', fit)
    expect(error.message).toBe(newerDatabaseSentence('/f', fit))
    expect(error.name).toBe('NewerDatabaseError')
  })
})

describe('§4 · open or refuse — the step main takes before any migration', () => {
  const aNewerOne = (): { db: AppDatabase; file: string } => {
    const made = aDatabase()
    applyMigrations(made.db, MIGRATIONS)
    aNewerMigration(made.db)
    return made
  }

  it('🔴 refused: the database is closed, nothing in its record moves, and the sentence is thrown', () => {
    const { db, file } = aNewerOne()
    const before = migrationsRecordedIn(db)
    expect(() => openOrRefuse(db, build, { folder: '/f' })).toThrow(NewerDatabaseError)
    expect(db.open).toBe(false)
    const again = openDatabase(file)
    open.push(again)
    expect(migrationsRecordedIn(again)).toEqual(before)
  })

  it('🔴 an unreadable record is refused the same way: closed, and the sentence thrown', () => {
    const { db } = aDatabase()
    db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text)')
    db.prepare('INSERT INTO __drizzle_migrations (hash) VALUES (?)').run('a-hash')
    let thrown: unknown = null
    try {
      openOrRefuse(db, build, { folder: '/f' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(UnreadableDatabaseError)
    expect((thrown as Error).message).toMatch(/^BroCrew could not read which version/)
    expect(db.open).toBe(false)
  })

  it('⚑ a database that fits opens as it always has', () => {
    const { db } = aDatabase()
    applyMigrations(db, MIGRATIONS)
    openOrRefuse(db, build, { folder: '/f' })
    expect(db.open).toBe(true)
  })

  it('⛔ a build whose journal lists no migration is an error, not a pass', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'brobot-empty-journal-'))
    roots.push(folder)
    mkdirSync(join(folder, 'meta'))
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ entries: [] }))
    await expect(buildLineage(folder)).rejects.toThrow(/not one this build can read/)
  })
})

describe('§5 · the wiring in main', () => {
  const index = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
  const body = (from: string, to: string, after = 0): string => {
    const at = index.indexOf(from, after)
    return index.slice(at, index.indexOf(to, at))
  }
  /** The start's own failure handler: the first after its `whenReady`. */
  const startsCatch = index.indexOf('.catch((error: unknown) => {', index.indexOf('.whenReady()'))

  it('🔴 asked before any migration runs, with no way past it', () => {
    const init = body(
      'function initDatabase(): AppDatabase {',
      '/**\n * How many database migrations',
    )
    const asked = init.indexOf('openOrRefuse(database, theBuildsMigrations(), {')
    expect(asked).toBeGreaterThan(-1)
    expect(asked).toBeLessThan(init.indexOf('applyMigrations(database, migrationsFolder)'))
    // …against the migrations the start-up check read, the ones it let this start open by.
    expect(body('async function theVerdictBeforeTheData(', '\n}\n')).toMatch(
      /if \(verdict\.kind === 'open'\) \{\s+thisBuildsMigrations = await buildLineage\(resolveMigrationsFolder\(\)\)/,
    )
    // ⛔ The force-open switch is gone, from the app and from the module.
    expect(index).not.toMatch(/OPEN_A_NEWER_DATABASE|brobot-open-a-newer-database|override:/)
    expect(readFileSync(join(here, '../src/main/db/newer-database.ts'), 'utf8')).not.toMatch(
      /OPEN_A_NEWER_DATABASE|brobot-open-a-newer-database|override/,
    )
  })

  it('🔴 the start-up check runs before the database is opened at all', () => {
    const decided = index.indexOf('const verdict = await theVerdictBeforeTheData(ownership)')
    expect(decided).toBeGreaterThan(index.indexOf('.whenReady()'))
    expect(decided).toBeLessThan(index.indexOf('host = createRuntimeHost(initDatabase())'))
  })

  it('⚑ a hidden start that failed brings no window forward for a second launch', () => {
    expect(index).toContain('let startFailed = false')
    expect(startsCatch).toBeGreaterThan(-1)
    const ended = body('function endInRecovery(', '\n}\n')
    // A hidden start is a failed start unless a test keeps its recovery window to drive it.
    expect(ended).toMatch(
      /if \(presentation\.hidden\) \{[\s\S]*if \(!keepTheRecoveryWindowHidden\) \{\s+startFailed = true/,
    )
    expect(body('  focusExisting: () => {', '  announce: (message) => {')).toContain(
      'if (startFailed) return',
    )
  })

  it('🔴 a database the open refused ends in the recovery window on the check’s verdict, never a dialog', () => {
    expect(body('.catch((error: unknown) => {', '\n}\n', startsCatch)).toContain(
      'void endAFailedStart(error, ownership)',
    )
    // Asked again, so a newer database is offered any copy this build can open; when the check
    // cannot say, it is still said to be newer.
    const means = body('async function whatAFailedStartEndsOn(', '\n}\n')
    expect(means).toMatch(
      /if \(error instanceof NewerDatabaseError \|\| error instanceof UnreadableDatabaseError\) \{\s+const again = await theVerdictBeforeTheData\(ownership\)/,
    )
    expect(means).toMatch(/if \(error instanceof NewerDatabaseError\) \{[\s\S]*?kind: 'newer',/)
    expect(means).not.toContain('showErrorBox')
    const failure = body('async function endAFailedStart(', '\n}\n')
    expect(failure.slice(failure.indexOf('theDataOpened = false'))).not.toContain('showErrorBox')
  })
})
