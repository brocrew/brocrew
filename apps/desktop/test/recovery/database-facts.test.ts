import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import type { Migration } from '../../src/main/recovery/contract'
import {
  buildLineage,
  hasPendingMigrations,
  isLineagePrefix,
  lineageFit,
  migrationsOf,
  migrationsRecordedIn,
  type BuildMigration,
} from '../../src/main/recovery/database-facts'
import { nodeFs, type RecoveryFs } from '../../src/main/recovery/files'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(here, '../../src/main/db/migrations')

interface JournalEntry {
  when: number
  tag: string
}
const JOURNAL = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
  entries: JournalEntry[]
}
/** The `when` of every migration this build carries, oldest first. */
const THE_BUILDS = JOURNAL.entries.map((entry) => entry.when)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const POSIX = process.platform !== 'win32'

let LINEAGE: readonly BuildMigration[]
beforeAll(async () => {
  LINEAGE = await buildLineage(MIGRATIONS)
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function aRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-recovery-facts-'))
  roots.push(root)
  return root
}

/**
 * A folder of loose database files, and a data folder of the test's own whose `recovery/scratch/`
 * the reads use, so what they leave there can be seen.
 */
function aFolder(): { folder: string; userData: string } {
  const root = aRoot()
  const folder = join(root, 'files')
  const userData = join(root, 'data')
  mkdirSync(folder)
  mkdirSync(userData)
  return { folder, userData }
}

/** A database migrated as the app migrates its own, and closed as the app closes it. */
function aMigratedDatabase(file: string, migrations = MIGRATIONS): void {
  const db = openDatabase(file)
  applyMigrations(db, migrations)
  db.close()
}

/**
 * What a crash leaves at `left`: the main file and a -wal holding the migrations, with no -shm. The
 * database is made in `folder` and gone from it after.
 */
function crashedInto(folder: string, left: string): void {
  const live = join(folder, 'live.sqlite')
  const db = openDatabase(live)
  db.pragma('wal_autocheckpoint = 0')
  applyMigrations(db, MIGRATIONS)
  copyFileSync(live, left)
  copyFileSync(`${live}-wal`, `${left}-wal`)
  db.close()
  rmSync(live)
  expect(statSync(`${left}-wal`).size).toBeGreaterThan(0)
}

function fingerprint(file: string): { bytes: number; mtimeMs: number; sha256: string } {
  const stats = statSync(file)
  return {
    bytes: stats.size,
    mtimeMs: stats.mtimeMs,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  }
}

/**
 * The migrator's own record in a database, read directly from a copy of it, since a reader opened
 * on the file itself would leave sidecars beside it.
 */
function recordIn(file: string): Migration[] {
  const copy = join(aRoot(), 'read.sqlite')
  copyFileSync(file, copy)
  if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`)
  const db = new Database(copy, { readonly: true, fileMustExist: true })
  try {
    return (
      db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all() as {
        hash: string
        created_at: number | string
      }[]
    ).map((row) => ({ createdAt: Number(row.created_at), hash: row.hash }))
  } finally {
    db.close()
  }
}

/** This build's migrations folder, each `.sql` file's text changed as given. */
function migrationsWith(change: (text: string, tag: string) => string): string {
  const folder = join(aRoot(), 'migrations')
  cpSync(MIGRATIONS, folder, { recursive: true })
  for (const { tag } of JOURNAL.entries) {
    const file = join(folder, `${tag}.sql`)
    writeFileSync(file, change(readFileSync(file, 'utf8'), tag))
  }
  return folder
}

/** Every path a file system call reaches, in order, with what the call was. */
function watched(): { fs: RecoveryFs; calls: string[] } {
  const calls: string[] = []
  const fs: RecoveryFs = {
    ...nodeFs,
    mkdir: (path, options) => (calls.push(`mkdir ${path}`), nodeFs.mkdir(path, options)),
    link: (existing, name) => (calls.push(`link ${name}`), nodeFs.link(existing, name)),
    copyFile: (from, to, mode) => (calls.push(`copy ${to}`), nodeFs.copyFile(from, to, mode)),
    mkdtemp: (prefix) => (calls.push(`mkdtemp ${prefix}`), nodeFs.mkdtemp(prefix)),
  }
  return { fs, calls }
}

describe('migrationsOf', () => {
  it('is absent when there is no file', async () => {
    const { userData } = aFolder()
    expect(await migrationsOf(join(userData, 'brobot2.sqlite'))).toEqual({ kind: 'absent' })
    expect(readdirSync(userData)).toEqual([])
  })

  it('is empty for an empty file, a database with no tables, and an empty record alone', async () => {
    const { folder, userData } = aFolder()
    const zero = join(folder, 'zero.sqlite')
    writeFileSync(zero, '')
    expect(await migrationsOf(zero, { userData })).toEqual({ kind: 'empty' })

    const noTable = join(folder, 'no-table.sqlite')
    const one = new Database(noTable)
    one.pragma('user_version = 1')
    one.close()
    expect(await migrationsOf(noTable, { userData })).toEqual({ kind: 'empty' })

    const noRows = join(folder, 'no-rows.sqlite')
    const two = new Database(noRows)
    two.pragma('journal_mode = WAL')
    two.exec(
      'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    )
    two.close()
    expect(await migrationsOf(noRows, { userData })).toEqual({ kind: 'empty' })
    expect(readdirSync(folder).sort()).toEqual(['no-rows.sqlite', 'no-table.sqlite', 'zero.sqlite'])
    expect(readdirSync(userData)).toEqual([])
  })

  it('is unreadable for an empty file beside a -wal or -journal that holds data', async () => {
    const { userData } = aFolder()
    const file = join(userData, 'brobot2.sqlite')
    writeFileSync(file, '')
    writeFileSync(`${file}-wal`, '')
    expect(await migrationsOf(file), 'an empty -wal holds nothing').toEqual({ kind: 'empty' })

    for (const suffix of ['-wal', '-journal']) {
      rmSync(`${file}-wal`, { force: true })
      writeFileSync(`${file}${suffix}`, Buffer.alloc(4096, 7))
      const before = fingerprint(`${file}${suffix}`)
      expect(await migrationsOf(file)).toEqual({
        kind: 'unreadable',
        detail: `it is empty, and the ${suffix} beside it holds data`,
      })
      expect(fingerprint(`${file}${suffix}`), 'the sidecar is left as it was').toEqual(before)
      rmSync(`${file}${suffix}`)
    }
    expect(readdirSync(userData)).toEqual(['brobot2.sqlite'])
  })

  it('is unreadable for tables with no migration record, or an empty one', async () => {
    const { folder, userData } = aFolder()
    const noRecord = join(folder, 'no-record.sqlite')
    const one = new Database(noRecord)
    one.exec('CREATE TABLE other (x)')
    one.close()
    expect(await migrationsOf(noRecord, { userData })).toEqual({
      kind: 'unreadable',
      detail: 'it holds tables but no migration record',
    })

    const emptyRecord = join(folder, 'empty-record.sqlite')
    const two = new Database(emptyRecord)
    two.exec(
      'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    )
    two.exec('CREATE TABLE other (x)')
    two.close()
    expect(await migrationsOf(emptyRecord, { userData })).toMatchObject({ kind: 'unreadable' })
  })

  it('is unreadable for a record holding a row the migrator would not write', async () => {
    const { folder, userData } = aFolder()
    const rows: [string, [unknown, unknown][]][] = [
      ['a hash that is not a sha256', [['not-a-hash', THE_BUILDS[0]]]],
      [
        'two migrations at one time',
        [
          ['a'.repeat(64), THE_BUILDS[0]],
          ['b'.repeat(64), THE_BUILDS[0]],
        ],
      ],
      ['a time that is not one', [['a'.repeat(64), 'soon']]],
    ]
    for (const [what, values] of rows) {
      const file = join(folder, `${what.replace(/\W+/g, '-')}.sqlite`)
      const db = new Database(file)
      db.exec(
        'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      )
      const insert = db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      for (const [hash, at] of values) insert.run(hash, at)
      db.close()
      expect(await migrationsOf(file, { userData }), what).toMatchObject({ kind: 'unreadable' })
    }
  })

  it('is unreadable for a file that is not a database, and never creates one', async () => {
    const { folder, userData } = aFolder()
    const garbage = join(folder, 'garbage.sqlite')
    writeFileSync(garbage, Buffer.alloc(8192, 0x5a))
    expect(await migrationsOf(garbage, { userData })).toMatchObject({ kind: 'unreadable' })

    const short = join(folder, 'short.sqlite')
    writeFileSync(short, 'SQLite')
    expect(await migrationsOf(short, { userData })).toMatchObject({ kind: 'unreadable' })

    const torn = join(folder, 'torn.sqlite')
    writeFileSync(
      torn,
      Buffer.concat([Buffer.from('SQLite format 3\u0000'), Buffer.alloc(8176, 0xff)]),
    )
    expect(await migrationsOf(torn, { userData })).toMatchObject({ kind: 'unreadable' })

    const folderInstead = join(folder, 'a-folder.sqlite')
    mkdirSync(folderInstead)
    expect(await migrationsOf(folderInstead, { userData })).toMatchObject({ kind: 'unreadable' })

    expect(readdirSync(folder).sort()).toEqual([
      'a-folder.sqlite',
      'garbage.sqlite',
      'short.sqlite',
      'torn.sqlite',
    ])
    expect(readdirSync(userData)).toEqual([])
  })

  it('reads the record of a database the app migrated, and leaves the file and its folder as they were', async () => {
    const { userData } = aFolder()
    const file = join(userData, 'brobot2.sqlite')
    aMigratedDatabase(file)
    expect(readdirSync(userData)).toEqual(['brobot2.sqlite'])
    const before = fingerprint(file)

    const facts = await migrationsOf(file)

    expect(facts).toEqual({ kind: 'recorded', migrations: recordIn(file) })
    expect(facts.kind === 'recorded' && facts.migrations.map(({ createdAt }) => createdAt)).toEqual(
      THE_BUILDS,
    )
    expect(readdirSync(userData), 'no sidecar, and no scratch folder left').toEqual([
      'brobot2.sqlite',
    ])
    expect(fingerprint(file)).toEqual(before)
    expect(statSync(file).nlink).toBe(1)
  })

  it('reads through a private folder of its own in the data folder, never the system’s temporary folder', async () => {
    const { userData } = aFolder()
    const file = join(userData, 'brobot2.sqlite')
    aMigratedDatabase(file)
    const { fs, calls } = watched()
    const modes: number[] = []
    const watching: RecoveryFs = {
      ...fs,
      link: async (existing, name) => {
        modes.push(statSync(dirname(name)).mode & 0o777)
        await fs.link(existing, name)
      },
    }

    expect(await migrationsOf(file, { fs: watching })).toMatchObject({ kind: 'recorded' })

    const scratch = join(userData, 'recovery', 'scratch')
    const made = calls.filter((call) => call.startsWith('mkdir ')).map((call) => call.slice(6))
    expect(made.slice(0, 2)).toEqual([join(userData, 'recovery'), scratch])
    const own = made[2] ?? ''
    expect(dirname(own)).toBe(scratch)
    expect(relative(scratch, own).split(sep)).toHaveLength(1)
    expect(UUID.test(relative(scratch, own))).toBe(true)
    expect(calls.filter((call) => call.startsWith('link ')).map((call) => call.slice(5))).toEqual([
      join(own, 'database.sqlite'),
    ])
    expect(calls.some((call) => call.startsWith('mkdtemp '))).toBe(false)
    if (POSIX) expect(modes).toEqual([0o700])
    expect(readdirSync(userData)).toEqual(['brobot2.sqlite'])
  })

  it('keeps a recovery folder that was already there, with what it holds, and leaves nothing in it', async () => {
    const { userData } = aFolder()
    const file = join(userData, 'brobot2.sqlite')
    aMigratedDatabase(file)
    mkdirSync(join(userData, 'recovery'))
    writeFileSync(join(userData, 'recovery', 'history-only.json'), '{}\n')

    expect(await migrationsOf(file)).toMatchObject({ kind: 'recorded' })

    expect(readdirSync(join(userData, 'recovery'))).toEqual(['history-only.json'])
  })

  it('links rather than copies while nothing beside the file holds data, an empty -wal included', async () => {
    const { userData } = aFolder()
    const file = join(userData, 'brobot2.sqlite')
    aMigratedDatabase(file)
    writeFileSync(`${file}-wal`, '')
    writeFileSync(`${file}-shm`, Buffer.alloc(32_768, 1))
    const { fs, calls } = watched()

    expect(await migrationsOf(file, { fs, freeBytes: () => 0 })).toEqual({
      kind: 'recorded',
      migrations: recordIn(file),
    })
    expect(calls.filter((call) => call.startsWith('link '))).toHaveLength(1)
    expect(calls.some((call) => call.startsWith('copy '))).toBe(false)
    expect(readdirSync(userData).sort()).toEqual([
      'brobot2.sqlite',
      'brobot2.sqlite-shm',
      'brobot2.sqlite-wal',
    ])
    expect(statSync(file).nlink).toBe(1)
  })

  it('copies the file and each sidecar that holds data, and only those', async () => {
    const { folder, userData } = aFolder()
    const left = join(userData, 'brobot2.sqlite')
    crashedInto(folder, left)
    writeFileSync(`${left}-journal`, '')
    const { fs, calls } = watched()

    const facts = await migrationsOf(left, { fs })

    expect(facts.kind === 'recorded' && facts.migrations.map(({ createdAt }) => createdAt)).toEqual(
      THE_BUILDS,
    )
    expect(calls.some((call) => call.startsWith('link '))).toBe(false)
    const copied = calls.filter((call) => call.startsWith('copy ')).map((call) => call.slice(5))
    expect(new Set(copied.map((path) => path.split(sep).at(-1)))).toEqual(
      new Set(['database.sqlite', 'database.sqlite-wal']),
    )
    expect(readdirSync(userData).sort()).toEqual([
      'brobot2.sqlite',
      'brobot2.sqlite-journal',
      'brobot2.sqlite-wal',
    ])
  })

  it('clones first, which takes no room, so a full disk refuses no clone', async () => {
    const { folder, userData } = aFolder()
    const left = join(userData, 'brobot2.sqlite')
    crashedInto(folder, left)
    const modes: number[] = []
    const cloning: RecoveryFs = {
      ...nodeFs,
      // A clone as a disk that clones makes it, made here as a plain copy.
      copyFile: (from, to, mode) => (modes.push(mode ?? 0), nodeFs.copyFile(from, to)),
    }

    expect(await migrationsOf(left, { fs: cloning, freeBytes: () => 0 })).toMatchObject({
      kind: 'recorded',
    })
    expect(modes).toEqual([constants.COPYFILE_FICLONE_FORCE, constants.COPYFILE_FICLONE_FORCE])
  })

  it('makes a full copy only when the disk has room for it, and says so rather than unreadable', async () => {
    const { folder, userData } = aFolder()
    const left = join(userData, 'brobot2.sqlite')
    crashedInto(folder, left)
    const main = fingerprint(left)
    const wal = fingerprint(`${left}-wal`)
    const copies: string[] = []
    const noClones: RecoveryFs = {
      ...nodeFs,
      copyFile: (from, to, mode) => {
        if (((mode ?? 0) & constants.COPYFILE_FICLONE_FORCE) !== 0) {
          return Promise.reject(Object.assign(new Error('ENOTSUP: no clones'), { code: 'ENOTSUP' }))
        }
        copies.push(to)
        return nodeFs.copyFile(from, to, mode)
      },
    }
    const asked: string[] = []
    const needed = main.bytes + 2 * wal.bytes + 64 * 1024 * 1024

    const refused = await migrationsOf(left, {
      fs: noClones,
      freeBytes: (path) => (asked.push(path), needed - 1),
    })

    expect(refused).toEqual({ kind: 'no-room', needed, free: needed - 1 })
    expect(copies, 'no copy was begun').toEqual([])
    expect(asked.every((path) => path.startsWith(join(userData, 'recovery', 'scratch')))).toBe(true)
    expect(readdirSync(userData).sort()).toEqual(['brobot2.sqlite', 'brobot2.sqlite-wal'])
    expect(fingerprint(left)).toEqual(main)

    expect(await migrationsOf(left, { fs: noClones, freeBytes: () => needed })).toMatchObject({
      kind: 'recorded',
    })
    expect(copies).toHaveLength(2)
    expect(await migrationsOf(left, { fs: noClones, freeBytes: () => null })).toMatchObject({
      kind: 'recorded',
    })
    expect(readdirSync(userData).sort()).toEqual(['brobot2.sqlite', 'brobot2.sqlite-wal'])
  })

  it('takes a disk that fills during the copy as no room, not as data it cannot read', async () => {
    const { folder, userData } = aFolder()
    const left = join(userData, 'brobot2.sqlite')
    crashedInto(folder, left)
    const full: RecoveryFs = {
      ...nodeFs,
      copyFile: () => Promise.reject(Object.assign(new Error('ENOSPC: full'), { code: 'ENOSPC' })),
    }

    expect(await migrationsOf(left, { fs: full, freeBytes: () => null })).toMatchObject({
      kind: 'no-room',
      free: 0,
    })
    expect(readdirSync(userData).sort()).toEqual(['brobot2.sqlite', 'brobot2.sqlite-wal'])
  })

  it.runIf(POSIX)('reads a database that is itself a link through a copy, not a link', async () => {
    const { folder, userData } = aFolder()
    const real = join(folder, 'kept-elsewhere.sqlite')
    aMigratedDatabase(real)
    const file = join(userData, 'brobot2.sqlite')
    symlinkSync(real, file)
    const { fs, calls } = watched()

    expect(await migrationsOf(file, { fs })).toEqual({
      kind: 'recorded',
      migrations: recordIn(real),
    })
    expect(calls.some((call) => call.startsWith('link '))).toBe(false)
    expect(readdirSync(userData)).toEqual(['brobot2.sqlite'])
  })

  it.runIf(POSIX)(
    'reads nothing through a recovery or scratch folder that is a link, and makes nothing there',
    async () => {
      for (const linked of ['recovery', join('recovery', 'scratch')]) {
        const { userData } = aFolder()
        const file = join(userData, 'brobot2.sqlite')
        aMigratedDatabase(file)
        const elsewhere = join(aRoot(), 'elsewhere')
        mkdirSync(elsewhere)
        mkdirSync(dirname(join(userData, linked)), { recursive: true })
        symlinkSync(elsewhere, join(userData, linked))

        const facts = await migrationsOf(file)

        expect(facts, linked).toMatchObject({ kind: 'unreadable' })
        expect(facts.kind === 'unreadable' ? facts.detail : '').toContain('is a link')
        expect(readdirSync(elsewhere), linked).toEqual([])
      }
    },
  )

  it('is unreadable when a file other than the live database needs a copy and no place is given', async () => {
    const { folder } = aFolder()
    const file = join(folder, 'other.sqlite')
    aMigratedDatabase(file)
    expect(await migrationsOf(file)).toEqual({
      kind: 'unreadable',
      detail: 'it can only be read through a copy, and no place for one was given',
    })
    expect(readdirSync(folder)).toEqual(['other.sqlite'])
  })

  it('reads what is still only in a -wal a crash left, and changes neither file', async () => {
    const { folder, userData } = aFolder()
    const live = join(folder, 'live.sqlite')
    const db = openDatabase(live)
    db.pragma('wal_autocheckpoint = 0')
    applyMigrations(db, MIGRATIONS)
    // What a crash leaves: the main file and a -wal holding the migrations, with no -shm.
    const left = join(userData, 'brobot2.sqlite')
    copyFileSync(live, left)
    copyFileSync(`${live}-wal`, `${left}-wal`)
    db.close()
    rmSync(live)
    const main = fingerprint(left)
    const wal = fingerprint(`${left}-wal`)
    expect(wal.bytes).toBeGreaterThan(0)

    const facts = await migrationsOf(left)
    expect(facts.kind === 'recorded' && facts.migrations.map(({ createdAt }) => createdAt)).toEqual(
      THE_BUILDS,
    )

    expect(readdirSync(userData).sort()).toEqual(['brobot2.sqlite', 'brobot2.sqlite-wal'])
    expect(fingerprint(left)).toEqual(main)
    expect(fingerprint(`${left}-wal`)).toEqual(wal)
  })

  it('reads a checkpoint’s copy in place, creating nothing beside it', async () => {
    const { folder } = aFolder()
    const copy = join(folder, 'database.sqlite')
    aMigratedDatabase(copy)
    const db = new Database(copy)
    db.pragma('journal_mode = DELETE')
    db.close()
    const before = fingerprint(copy)
    const { fs, calls } = watched()

    expect(await migrationsOf(copy, { fs })).toEqual({
      kind: 'recorded',
      migrations: recordIn(copy),
    })
    expect(calls, 'no scratch folder was needed').toEqual([])
    expect(readdirSync(folder)).toEqual(['database.sqlite'])
    expect(fingerprint(copy)).toEqual(before)
  })

  it('copies the file when it cannot be linked, and still leaves nothing behind', async () => {
    const { userData } = aFolder()
    const file = join(userData, 'brobot2.sqlite')
    aMigratedDatabase(file)
    const before = fingerprint(file)
    const noLinks: RecoveryFs = {
      ...nodeFs,
      link: () =>
        Promise.reject(Object.assign(new Error('EXDEV: another disk'), { code: 'EXDEV' })),
    }

    expect(await migrationsOf(file, { fs: noLinks })).toMatchObject({ kind: 'recorded' })
    expect(readdirSync(userData)).toEqual(['brobot2.sqlite'])
    expect(fingerprint(file)).toEqual(before)
  })

  it('is unreadable when the file cannot be read at all', async () => {
    const { userData } = aFolder()
    const file = join(userData, 'brobot2.sqlite')
    aMigratedDatabase(file)
    const denied: RecoveryFs = {
      ...nodeFs,
      open: () => Promise.reject(Object.assign(new Error('EACCES: denied'), { code: 'EACCES' })),
    }
    const facts = await migrationsOf(file, { fs: denied })
    expect(facts).toMatchObject({ kind: 'unreadable' })
    expect(facts.kind === 'unreadable' && facts.detail).toContain('EACCES')
  })
})

describe('migrationsRecordedIn', () => {
  it('reads a connection already open by the rule migrationsOf reads a file by', async () => {
    const { folder } = aFolder()
    const none = new Database(':memory:')
    expect(migrationsRecordedIn(none)).toEqual({ kind: 'empty' })
    none.exec('CREATE TABLE other (x)')
    expect(migrationsRecordedIn(none)).toEqual({
      kind: 'unreadable',
      detail: 'it holds tables but no migration record',
    })
    none.close()

    const file = join(folder, 'database.sqlite')
    const db = openDatabase(file)
    applyMigrations(db, MIGRATIONS)
    expect(migrationsRecordedIn(db)).toEqual({ kind: 'recorded', migrations: recordIn(file) })
    db.close()
    expect(migrationsRecordedIn(db), 'a closed connection').toMatchObject({ kind: 'unreadable' })
  })
})

describe('the build’s lineage', () => {
  it('is every migration this build carries, oldest first, with the hash the migrator records', async () => {
    const { folder } = aFolder()
    const file = join(folder, 'database.sqlite')
    aMigratedDatabase(file)
    const recorded = recordIn(file)

    expect(LINEAGE.map(({ createdAt }) => createdAt)).toEqual(THE_BUILDS)
    expect(LINEAGE.map(({ createdAt, hash }) => ({ createdAt, hash }))).toEqual(recorded)
    for (const [index, { tag }] of JOURNAL.entries.entries()) {
      const text = readFileSync(join(MIGRATIONS, `${tag}.sql`), 'utf8')
      expect(LINEAGE[index]?.hash).toBe(createHash('sha256').update(text).digest('hex'))
      expect(LINEAGE[index]?.recordedAs).toContain(LINEAGE[index]?.hash)
    }
    expect(isLineagePrefix(recorded, LINEAGE)).toBe(true)
  })

  it('cannot be read from a journal that is missing, empty, out of order, or names a missing file', async () => {
    const { folder } = aFolder()
    await expect(buildLineage(folder)).rejects.toThrow()
    mkdirSync(join(folder, 'meta'))
    const journal = join(folder, 'meta', '_journal.json')
    writeFileSync(journal, JSON.stringify({ entries: [] }))
    await expect(buildLineage(folder)).rejects.toThrow('not one this build can read')
    writeFileSync(join(folder, 'a.sql'), 'SELECT 1;\n')
    writeFileSync(join(folder, 'b.sql'), 'SELECT 2;\n')
    writeFileSync(
      journal,
      JSON.stringify({
        entries: [
          { when: 2, tag: 'a' },
          { when: 1, tag: 'b' },
        ],
      }),
    )
    await expect(buildLineage(folder)).rejects.toThrow('not one this build can read')
    writeFileSync(journal, JSON.stringify({ entries: [{ when: 1 }] }))
    await expect(buildLineage(folder)).rejects.toThrow('not one this build can read')
    writeFileSync(journal, JSON.stringify({ entries: [{ when: 1, tag: '../a' }] }))
    await expect(buildLineage(folder)).rejects.toThrow('not one this build can read')
    writeFileSync(journal, JSON.stringify({ entries: [{ when: 1, tag: 'c' }] }))
    await expect(buildLineage(folder)).rejects.toThrow('ENOENT')
    writeFileSync(journal, JSON.stringify({ entries: [{ when: 1, tag: 'a' }] }))
    expect(await buildLineage(folder)).toHaveLength(1)
  })

  it('opens a database whose migrations are its first ones, by time and by hash, and no other', () => {
    const own: Migration[] = LINEAGE.map(({ createdAt, hash }) => ({ createdAt, hash }))
    const later: Migration = { createdAt: Date.UTC(2027, 0, 1), hash: 'f'.repeat(64) }
    expect(isLineagePrefix(own, LINEAGE)).toBe(true)
    expect(isLineagePrefix(own.slice(0, 3), LINEAGE)).toBe(true)
    expect(isLineagePrefix([], LINEAGE)).toBe(true)
    expect(isLineagePrefix([...own, later], LINEAGE)).toBe(false)
    expect(isLineagePrefix(own.slice(1), LINEAGE)).toBe(false)
    const movedInTime = own.map((one, index) =>
      index === 2 ? { ...one, createdAt: one.createdAt + 1 } : one,
    )
    expect(isLineagePrefix(movedInTime, LINEAGE)).toBe(false)
    const changedFile = own.map((one, index) =>
      index === 2 ? { ...one, hash: 'e'.repeat(64) } : one,
    )
    expect(isLineagePrefix(changedFile, LINEAGE), 'the same time, another file').toBe(false)
  })

  it('takes a migration file whose line endings a checkout converted as the same migration', async () => {
    // Both spellings are made here, so the test means the same on a checkout of either kind.
    const crlf = migrationsWith((text) => text.replace(/\r?\n/g, '\r\n'))
    const lf = migrationsWith((text) => text.replace(/\r\n/g, '\n'))
    const crlfLineage = await buildLineage(crlf)
    const lfLineage = await buildLineage(lf)
    const { folder } = aFolder()
    const windows = join(folder, 'windows.sqlite')
    aMigratedDatabase(windows, crlf)
    const recordedOnWindows = recordIn(windows)
    const elsewhere = join(folder, 'elsewhere.sqlite')
    aMigratedDatabase(elsewhere, lf)
    const recordedElsewhere = recordIn(elsewhere)
    // A file of one line has no line ending to convert; every other one hashes differently.
    expect(
      recordedOnWindows.filter((one, index) => one.hash !== recordedElsewhere[index]?.hash).length,
      'the two spellings hash differently',
    ).toBeGreaterThan(0)

    // A database a build from a CRLF checkout migrated opens with a build from an LF one, and the
    // other way round, by the start-up check's measure and by the open's.
    expect(isLineagePrefix(recordedOnWindows, lfLineage)).toBe(true)
    expect(lineageFit(recordedOnWindows, lfLineage)).toBe('fits')
    expect(isLineagePrefix(recordedElsewhere, crlfLineage)).toBe(true)
    expect(lineageFit(recordedElsewhere, crlfLineage)).toBe('fits')
  })

  it('does not take a migration whose text changed as the same one', async () => {
    const changedTag = JOURNAL.entries[1]?.tag
    const edited = migrationsWith((text, tag) =>
      tag === changedTag ? `${text}\n-- changed after it shipped\n` : text,
    )
    const { folder } = aFolder()
    const file = join(folder, 'edited.sqlite')
    aMigratedDatabase(file, edited)

    expect(isLineagePrefix(recordIn(file), LINEAGE)).toBe(false)
    expect(lineageFit(recordIn(file), LINEAGE)).toBe('foreign')
  })

  it('tells a database this build fits from a newer one and a foreign one', () => {
    const own: Migration[] = LINEAGE.map(({ createdAt, hash }) => ({ createdAt, hash }))
    const later: Migration = {
      createdAt: (own.at(-1)?.createdAt ?? 0) + 86_400_000,
      hash: 'f'.repeat(64),
    }
    expect(lineageFit(own, LINEAGE)).toBe('fits')
    expect(lineageFit(own.slice(0, -1), LINEAGE)).toBe('fits')
    expect(lineageFit([...own, later], LINEAGE)).toBe('newer')
    const otherFirst = own.map((one, index) =>
      index === 0 ? { ...one, hash: 'e'.repeat(64) } : one,
    )
    // Later than this build's newest is newer whatever came before it: the migrator would apply
    // nothing to it, as it would to a database that carries on from this build.
    expect(lineageFit([...otherFirst, later], LINEAGE), 'later, after another history').toBe(
      'newer',
    )
    expect(lineageFit([...own.slice(0, -1), later], LINEAGE), 'later, one of ours missing').toBe(
      'newer',
    )
    expect(lineageFit(otherFirst.slice(0, 2), LINEAGE)).toBe('foreign')
    expect(lineageFit(otherFirst, LINEAGE), 'as late as ours, not ours').toBe('foreign')
  })

  it('has migrations to apply to a database whose latest is older than the build’s newest', () => {
    const own: Migration[] = LINEAGE.map(({ createdAt, hash }) => ({ createdAt, hash }))
    expect(hasPendingMigrations(own, LINEAGE)).toBe(false)
    expect(hasPendingMigrations(own.slice(0, -1), LINEAGE)).toBe(true)
    expect(hasPendingMigrations([], LINEAGE)).toBe(true)
  })
})
