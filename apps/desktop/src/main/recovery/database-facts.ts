import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { freeBytesOn } from '../archive/native-file'
import type { Migration } from './contract'
import {
  assertOwnedPathsAreReal,
  errorCode,
  nodeFs,
  privateDir,
  retrying,
  type RecoveryFs,
  type RecoveryStats,
} from './files'
import { COPY_FILE, DATABASE_FILE, isSafeName, recoveryDir, scratchDir } from './layout'

/**
 * Facts about a database file, read without changing it or creating anything beside it.
 *
 * A read-only SQLite connection is not enough for that. On a database in WAL mode (the app's live
 * database always is) it creates `-wal` and `-shm` beside the file even when neither was there,
 * and leaves them; with a `-journal` beside the file it cannot roll a half-written transaction
 * back. So only a rollback-mode file with no sidecars, such as a checkpoint's copy, is opened in
 * place. Any other file is read through a private folder of its own under the data folder's
 * `recovery/scratch/`, never the system's temporary folder, so what is made there stays as private
 * as the data and goes when the workspace goes:
 * - when no `-wal` or `-journal` beside the file holds data, as after every clean exit, a hard link
 *   to the file, which costs nothing and is opened read-only;
 * - otherwise, or on a disk that makes no hard links, a copy of the file and of each sidecar
 *   holding data, which SQLite may then recover freely: a clone where the disk can make one, which
 *   takes no room, else a full copy, which is not begun when the disk says it lacks the room.
 */

/** What a database file records about its migrations. */
export type MigrationsOnDisk =
  | { readonly kind: 'absent' }
  /** No tables, or only an empty migration record: a new workspace. */
  | { readonly kind: 'empty' }
  | { readonly kind: 'unreadable'; readonly detail: string }
  /** Each applied migration as the migrator recorded it, oldest first. */
  | { readonly kind: 'recorded'; readonly migrations: readonly Migration[] }

/**
 * What {@link migrationsOf} found in a file: {@link MigrationsOnDisk}, or that the file could only
 * be read through a copy and the disk has no room for one. Bytes are counted on the disk holding
 * the data folder.
 */
export type MigrationsRead =
  MigrationsOnDisk | { readonly kind: 'no-room'; readonly needed: number; readonly free: number }

/** One migration this build carries. */
export interface BuildMigration extends Migration {
  /**
   * Every hash a database may record for it: drizzle's hash of the file as this build holds it, and
   * of the same text with its line endings written the other way, as a checkout on another system
   * converts them. Any other hash is a different migration.
   */
  readonly recordedAs: readonly string[]
}

/**
 * How a database's applied migrations stand against this build's. The start-up check and the
 * database's open both decide by this one rule.
 */
export type LineageFit =
  /** This build's first migrations, some or all: this build opens it, applying any left. */
  | 'fits'
  /**
   * A latest migration later than this build's newest: a newer build migrated it. The migrator's
   * own measure, by which it would apply nothing to it and run on a schema this build does not know.
   */
  | 'newer'
  /**
   * Anything else: a migration this build does not carry, or one whose file changed since, and none
   * later than this build's newest. The migrator would apply this build's later ones over it.
   */
  | 'foreign'

export interface MigrationsOfOptions {
  readonly fs?: RecoveryFs
  /**
   * The data folder `file` belongs to; a read through a copy makes it under this folder's
   * `recovery/scratch/`. When not given, the live database's own folder. Any other file that can
   * only be read through a copy is then unreadable.
   */
  readonly userData?: string
  /** Bytes free on the disk holding a path, or null when that cannot be told. */
  readonly freeBytes?: (path: string) => number | null
}

const EMPTY: MigrationsOnDisk = { kind: 'empty' }
const HEADER_BYTES = 100
const SQLITE_MAGIC = 'SQLite format 3\u0000'
/** The sidecars that hold data the main file does not; `-shm` is only an index SQLite rebuilds. */
const DATA_SIDECARS = ['-wal', '-journal'] as const
const SHA256_HEX = /^[0-9a-f]{64}$/
/** Room a read through a copy keeps free for the files SQLite makes beside the copy. */
const SCRATCH_HEADROOM_BYTES = 64 * 1024 * 1024

/**
 * The migrations this build carries, oldest first: each entry of its migrations folder's
 * `meta/_journal.json`, with the `when` the migrator records as `created_at` and the sha256 of its
 * `<tag>.sql` text, which the migrator records as `hash`. Throws when the folder cannot be read,
 * since a build without it cannot open any database.
 */
export async function buildLineage(
  migrationsFolder: string,
  fs: RecoveryFs = nodeFs,
): Promise<readonly BuildMigration[]> {
  const unreadable = (): Error =>
    new Error(`the migrations journal in ${migrationsFolder} is not one this build can read`)
  const journal = JSON.parse(
    await fs.readFile(join(migrationsFolder, 'meta', '_journal.json')),
  ) as { entries?: unknown }
  const entries = journal.entries
  if (!Array.isArray(entries) || entries.length === 0) throw unreadable()
  const lineage: BuildMigration[] = []
  for (const entry of entries as unknown[]) {
    const { when, tag } = (typeof entry === 'object' && entry !== null ? entry : {}) as {
      when?: unknown
      tag?: unknown
    }
    if (typeof when !== 'number' || !Number.isSafeInteger(when)) throw unreadable()
    if (typeof tag !== 'string' || !isSafeName(tag)) throw unreadable()
    if (when <= (lineage.at(-1)?.createdAt ?? Number.NEGATIVE_INFINITY)) throw unreadable()
    // The migrator hashes the file's text as it reads it: decoded as UTF-8, hashed as a string.
    const text = await fs.readFile(join(migrationsFolder, `${tag}.sql`))
    const lf = text.replace(/\r\n/g, '\n')
    lineage.push({
      createdAt: when,
      hash: sha256Of(text),
      recordedAs: [...new Set([text, lf, lf.replace(/\n/g, '\r\n')].map(sha256Of))],
    })
  }
  return lineage
}

/** Whether a migration a database records is this one of the build's: the same time and file. */
export function isTheBuildsMigration(
  applied: Migration,
  built: BuildMigration | undefined,
): boolean {
  return (
    built !== undefined &&
    applied.createdAt === built.createdAt &&
    built.recordedAs.includes(applied.hash)
  )
}

/**
 * Whether a database that applied `applied` is one `lineage` can open: the same migrations, by time
 * and by hash, in the same order, as the build's first ones. A database with none applied is too.
 */
export function isLineagePrefix(
  applied: readonly Migration[],
  lineage: readonly BuildMigration[],
): boolean {
  return (
    applied.length <= lineage.length &&
    applied.every((migration, index) => isTheBuildsMigration(migration, lineage[index]))
  )
}

/** How `applied` stands against `lineage`; see {@link LineageFit}. */
export function lineageFit(
  applied: readonly Migration[],
  lineage: readonly BuildMigration[],
): LineageFit {
  if (isLineagePrefix(applied, lineage)) return 'fits'
  return latestOf(applied) > latestOf(lineage) ? 'newer' : 'foreign'
}

function latestOf(migrations: readonly Migration[]): number {
  return migrations.at(-1)?.createdAt ?? Number.NEGATIVE_INFINITY
}

/**
 * Whether the build has migrations to apply to a database that applied `applied`, by the migrator's
 * own measure: it applies every migration later than the latest one recorded.
 */
export function hasPendingMigrations(
  applied: readonly Migration[],
  lineage: readonly BuildMigration[],
): boolean {
  const latest = latestOf(applied)
  return lineage.some(({ createdAt }) => createdAt > latest)
}

/** The migrations `file` records, read from its own `__drizzle_migrations`. Never throws. */
export async function migrationsOf(
  file: string,
  options: MigrationsOfOptions = {},
): Promise<MigrationsRead> {
  const fs = options.fs ?? nodeFs
  try {
    let size: number
    try {
      const stats = await fs.stat(file)
      if (!stats.isFile()) return unreadable('it is not a file')
      size = stats.size
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { kind: 'absent' }
      throw error
    }

    const sidecars = await dataSidecarsOf(file, fs)
    if (size === 0) {
      // SQLite drops a -wal or -journal beside an empty file, and with it the data it holds.
      const holding = sidecars.find((sidecar) => sidecar.bytes > 0)
      return holding === undefined
        ? EMPTY
        : unreadable(`it is empty, and the ${holding.suffix} beside it holds data`)
    }
    const header = await headerOf(file, fs)
    if (header === null) return unreadable('it is too short to be a database')
    if (Buffer.from(header.subarray(0, 16)).toString('latin1') !== SQLITE_MAGIC) {
      return unreadable('it is not a SQLite database')
    }
    const rollbackMode = header[18] === 1 && header[19] === 1
    if (rollbackMode && sidecars.length === 0) return readMigrations(file, true)

    const userData =
      options.userData ?? (basename(file) === DATABASE_FILE ? dirname(file) : undefined)
    if (userData === undefined) {
      return unreadable('it can only be read through a copy, and no place for one was given')
    }
    return await throughScratch(
      { file, bytes: size, holding: sidecars.filter((sidecar) => sidecar.bytes > 0) },
      fs,
      userData,
      options.freeBytes ?? freeBytesOn,
    )
  } catch (error) {
    return unreadable(error instanceof Error ? error.message : String(error))
  }
}

/**
 * The migrations an open database records: the rule {@link migrationsOf} reads a file by, for a
 * connection already open on it. Never throws.
 */
export function migrationsRecordedIn(db: Database.Database): MigrationsOnDisk {
  try {
    const table = db
      .prepare(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get('__drizzle_migrations')
    // Only a database with no tables of its own is a new workspace. One with tables and no
    // migration record was not made by the migrator, and migrating it would write into it.
    const others = db
      .prepare(
        `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name <> ? AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`,
      )
      .get('__drizzle_migrations')
    const noRecord =
      others === undefined ? EMPTY : unreadable('it holds tables but no migration record')
    if (table === undefined) return noRecord
    const rows = db
      .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
      .all() as { hash: unknown; created_at: unknown }[]
    if (rows.length === 0) return noRecord
    const migrations: Migration[] = []
    for (const row of rows) {
      const createdAt =
        typeof row.created_at === 'number' ||
        (typeof row.created_at === 'string' && row.created_at.trim() !== '')
          ? Number(row.created_at)
          : Number.NaN
      if (
        !Number.isSafeInteger(createdAt) ||
        typeof row.hash !== 'string' ||
        !SHA256_HEX.test(row.hash)
      ) {
        return unreadable('its migration record holds a row this build cannot read')
      }
      // The migrator never records two migrations at one time.
      if (createdAt <= (migrations.at(-1)?.createdAt ?? Number.NEGATIVE_INFINITY)) {
        return unreadable('its migration record lists two migrations at the same time')
      }
      migrations.push({ createdAt, hash: row.hash })
    }
    return { kind: 'recorded', migrations }
  } catch (error) {
    return unreadable(error instanceof Error ? error.message : String(error))
  }
}

function unreadable(detail: string): MigrationsOnDisk {
  return { kind: 'unreadable', detail }
}

function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The `-wal` and `-journal` beside `file`, with their sizes. */
async function dataSidecarsOf(
  file: string,
  fs: RecoveryFs,
): Promise<{ readonly suffix: string; readonly bytes: number }[]> {
  const found: { suffix: string; bytes: number }[] = []
  for (const suffix of DATA_SIDECARS) {
    let stats: RecoveryStats
    try {
      stats = await fs.lstat(`${file}${suffix}`)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue
      throw error
    }
    if (!stats.isFile()) throw new Error(`the ${suffix} beside it is not a file`)
    found.push({ suffix, bytes: stats.size })
  }
  return found
}

async function headerOf(file: string, fs: RecoveryFs): Promise<Uint8Array | null> {
  const header = new Uint8Array(HEADER_BYTES)
  const handle = await fs.open(file, 'r')
  try {
    let filled = 0
    while (filled < HEADER_BYTES) {
      const { bytesRead } = await handle.read(header, filled, HEADER_BYTES - filled, filled)
      if (bytesRead === 0) return null
      filled += bytesRead
    }
    return header
  } finally {
    await handle.close()
  }
}

/** A database file to read through the scratch folder, with its sidecars that hold data. */
interface ToRead {
  readonly file: string
  readonly bytes: number
  readonly holding: readonly { readonly suffix: string; readonly bytes: number }[]
}

/**
 * Reads a database through a folder of its own in `recovery/scratch/`, named by a random UUID (the
 * start-up sweep removes such folders when a read was cut short), and removes the folder after,
 * with `recovery/scratch/` and `recovery/` when they are left empty.
 */
async function throughScratch(
  toRead: ToRead,
  fs: RecoveryFs,
  userData: string,
  freeBytes: (path: string) => number | null,
): Promise<MigrationsRead> {
  const { file, holding } = toRead
  const folder = join(scratchDir(userData), randomUUID())
  await assertOwnedPathsAreReal(userData, [folder], fs)
  try {
    await privateDir(recoveryDir(userData), fs)
    await privateDir(scratchDir(userData), fs)
    await fs.mkdir(folder, { mode: 0o700 })
    await fs.chmod(folder, 0o700)
    const copy = join(folder, COPY_FILE)
    // A link shares the file's bytes, so the connection on it stays read-only. A database that is
    // itself a link is copied, since a hard link would not follow it on every system.
    if (holding.length === 0 && !(await fs.lstat(file)).isSymbolicLink()) {
      const linked = await fs.link(file, copy).then(
        () => true,
        () => false,
      )
      if (linked) return readMigrations(copy, true)
    }
    const pairs: (readonly [string, string])[] = [
      [file, copy],
      ...holding.map(({ suffix }) => [`${file}${suffix}`, `${copy}${suffix}`] as const),
    ]
    if (!(await clonedAll(pairs, fs))) {
      const needed = spaceToReadThroughACopy(toRead)
      const free = freeBytes(folder)
      // A disk that cannot be asked is not refused: the copy itself says when the space runs out.
      if (free !== null && free < needed) return { kind: 'no-room', needed, free }
      try {
        for (const [from, to] of pairs) await fs.copyFile(from, to)
      } catch (error) {
        if (errorCode(error) !== 'ENOSPC') throw error
        return { kind: 'no-room', needed, free: freeBytes(folder) ?? 0 }
      }
    }
    return readMigrations(copy, false)
  } finally {
    await removeScratch(userData, folder, fs)
  }
}

/**
 * What a read through a copy can take on its disk: the copied bytes, the sidecars' bytes again,
 * since SQLite folds a `-wal` into the copy's main file or rolls a `-journal` back into it, and
 * room for the files SQLite keeps beside it.
 */
function spaceToReadThroughACopy({ bytes, holding }: ToRead): number {
  const sidecars = holding.reduce((sum, sidecar) => sum + sidecar.bytes, 0)
  return bytes + 2 * sidecars + SCRATCH_HEADROOM_BYTES
}

/**
 * Whether every file was cloned, which shares the source's blocks until either side is written
 * and so takes no space. False as soon as one cannot be, on a disk or a system that clones nothing.
 */
async function clonedAll(
  pairs: readonly (readonly [string, string])[],
  fs: RecoveryFs,
): Promise<boolean> {
  for (const [from, to] of pairs) {
    const cloned = await fs.copyFile(from, to, constants.COPYFILE_FICLONE_FORCE).then(
      () => true,
      () => false,
    )
    if (!cloned) return false
  }
  return true
}

/** Best effort: a folder left behind is removed by the next start that owns the data folder. */
async function removeScratch(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  try {
    await assertOwnedPathsAreReal(userData, [folder], fs)
    await retrying(() => fs.rm(folder, { recursive: true, force: true }))
    for (const emptied of [scratchDir(userData), recoveryDir(userData)]) {
      await fs.rmdir(emptied)
    }
  } catch {
    // Still in use, or not empty: either way it stays.
  }
}

function readMigrations(path: string, readonly: boolean): MigrationsOnDisk {
  const db = new Database(path, { readonly, fileMustExist: true })
  try {
    return migrationsRecordedIn(db)
  } finally {
    db.close()
  }
}
