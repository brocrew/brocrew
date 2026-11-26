import { observeDatabaseMemory } from '../database-memory'
import { headerOf } from './sqlite-header'
import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
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

export type MigrationsOnDisk =
  | { readonly kind: 'absent' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'recorded'; readonly migrations: readonly Migration[] }

export type MigrationsRead =
  MigrationsOnDisk | { readonly kind: 'no-room'; readonly needed: number; readonly free: number }

export interface BuildMigration extends Migration {
  readonly recordedAs: readonly string[]
}

export type LineageFit = 'fits' | 'newer' | 'foreign'

export interface MigrationsOfOptions {
  readonly fs?: RecoveryFs
  readonly userData?: string

  readonly freeBytes?: (path: string) => number | null
}

const EMPTY: MigrationsOnDisk = { kind: 'empty' }

const SQLITE_MAGIC = 'SQLite format 3\u0000'

const DATA_SIDECARS = ['-wal', '-journal'] as const
const SHA256_HEX = /^[0-9a-f]{64}$/

const SCRATCH_HEADROOM_BYTES = 64 * 1024 * 1024

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

export function isLineagePrefix(
  applied: readonly Migration[],
  lineage: readonly BuildMigration[],
): boolean {
  return (
    applied.length <= lineage.length &&
    applied.every((migration, index) => isTheBuildsMigration(migration, lineage[index]))
  )
}

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

export function hasPendingMigrations(
  applied: readonly Migration[],
  lineage: readonly BuildMigration[],
): boolean {
  const latest = latestOf(applied)
  return lineage.some(({ createdAt }) => createdAt > latest)
}

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

    if (!sidecars.some(({ suffix, bytes }) => suffix === '-journal' && bytes > 0)) {
      return readMigrations(file, true)
    }

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

export function migrationsRecordedIn(db: Database.Database): MigrationsOnDisk {
  try {
    const table = db
      .prepare(`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get('__drizzle_migrations')
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

interface ToRead {
  readonly file: string
  readonly bytes: number
  readonly holding: readonly { readonly suffix: string; readonly bytes: number }[]
}

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

    const copy = join(folder, COPY_FILE)
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
    let copied: boolean
    let fullCopyAdmitted = false
    try {
      copied = await copyWithCloneAdapter(pairs, fs, () => {
        if (fullCopyAdmitted) return
        const free = freeBytes(folder)
        if (free !== null && free < spaceToReadThroughACopy(toRead))
          throw Object.assign(new Error('Not enough room for a full scratch copy.'), {
            code: 'ENOSPC',
          })
        fullCopyAdmitted = true
      })
    } catch (error) {
      if (errorCode(error) !== 'ENOSPC') throw error
      return {
        kind: 'no-room',
        needed: spaceToReadThroughACopy(toRead),
        free: freeBytes(folder) ?? 0,
      }
    }
    if (!copied) {
      const needed = spaceToReadThroughACopy(toRead)
      const free = freeBytes(folder)

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

function spaceToReadThroughACopy({ bytes, holding }: ToRead): number {
  const sidecars = holding.reduce((sum, sidecar) => sum + sidecar.bytes, 0)
  return bytes + 2 * sidecars + SCRATCH_HEADROOM_BYTES
}

async function copyWithCloneAdapter(
  pairs: readonly (readonly [string, string])[],
  fs: RecoveryFs,
  beforeFullCopy: () => void,
): Promise<boolean> {
  for (const [from, to] of pairs) {
    try {
      await fs.cloneFile(from, to, undefined, beforeFullCopy)
    } catch (error) {
      if (!['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL'].includes(errorCode(error) ?? ''))
        throw error
      return false
    }
  }
  return true
}

async function removeScratch(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  try {
    await assertOwnedPathsAreReal(userData, [folder], fs)
    await retrying(() => fs.rm(folder, { recursive: true, force: true }))
    for (const emptied of [scratchDir(userData), recoveryDir(userData)]) {
      await fs.rmdir(emptied)
    }
  } catch {
    // A later start can remove scratch folders that are still in use.
  }
}

function readMigrations(path: string, readonly: boolean): MigrationsOnDisk {
  const db = new Database(path, { readonly, fileMustExist: true })
  observeDatabaseMemory(db, 'recovery-migrations')
  try {
    return migrationsRecordedIn(db)
  } finally {
    db.close()
  }
}

export function sameMigrations(a: readonly Migration[], b: readonly Migration[]): boolean {
  return (
    a.length === b.length &&
    a.every((one, index) => one.createdAt === b[index]?.createdAt && one.hash === b[index]?.hash)
  )
}

export async function inRollbackMode(path: string, fs: RecoveryFs): Promise<boolean> {
  const header = new Uint8Array(20)
  const handle = await fs.open(path, 'r')
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return bytesRead === header.length && header[18] === 1 && header[19] === 1
  } finally {
    await handle.close()
  }
}
