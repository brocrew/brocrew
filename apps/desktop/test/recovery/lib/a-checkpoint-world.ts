import { openCheckpointForRead } from './recovery-files'
import {
  MIGRATIONS_FOLDER as MIGRATIONS,
  firstMigrationsIn,
  failingMigrationsIn,
  BUILD_LINEAGE as THE_BUILDS,
} from './migration-journal'
import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll } from 'vitest'
import { openDatabase } from '../../../src/main/db/connection'
import { applyMigrations } from '../../../src/main/db/migrate'
import {
  makeCheckpoint,
  type Checkpoint,
  type MakeCheckpointOptions,
  type PruneOptions,
} from '../../../src/main/recovery/checkpoint'
import type { CheckpointManifest, Migration } from '../../../src/main/recovery/contract'
import { buildLineage, type BuildMigration } from '../../../src/main/recovery/database-facts'
import { nodeFs, type RecoveryFs } from '../../../src/main/recovery/files'
import { checkTheCopyHere } from '../../helpers/check-the-copy-here'

const LATEST = THE_BUILDS[THE_BUILDS.length - 1] ?? 0
const A_LATER_ONE = LATEST + 86_400_000
const LATER_HASH = 'f'.repeat(64)
const LATER: BuildMigration = { createdAt: A_LATER_ONE, hash: LATER_HASH, recordedAs: [LATER_HASH] }

let LINEAGE: readonly BuildMigration[]
let OWN: readonly Migration[]
beforeAll(async () => {
  LINEAGE = await buildLineage(MIGRATIONS)
  OWN = LINEAGE.map(({ createdAt, hash }) => ({ createdAt, hash }))
})

const POSIX = process.platform !== 'win32'
const START = Date.UTC(2026, 9, 1, 9, 0, 0)
const minute = (n: number): number => START + n * 60_000
const DAY_MS = 24 * 60 * 60 * 1000

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function aRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-recovery-checkpoint-'))
  roots.push(root)
  return root
}

function aDataFolder(): string {
  const userData = join(aRoot(), 'data')
  mkdirSync(userData)
  return userData
}

function liveFile(userData: string): string {
  return join(userData, 'brobot2.sqlite')
}

const FILLER_ROWS = 300

function fill(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS filler (n INTEGER, body BLOB)')
  const insert = db.prepare('INSERT INTO filler VALUES (?, ?)')
  for (let n = 0; n < FILLER_ROWS; n += 1) insert.run(n, Buffer.alloc(1000, n % 251))
}

function aLiveDatabase(userData: string, migrations = MIGRATIONS): void {
  const db = openDatabase(liveFile(userData))
  applyMigrations(db, migrations)
  fill(db)
  db.close()
}

function aLiveWorkspace(): string {
  const userData = aDataFolder()
  aLiveDatabase(userData)
  return userData
}

async function aCopiedWorkspace(options: Partial<MakeCheckpointOptions> = {}) {
  const userData = aLiveWorkspace()
  return { userData, copy: await make(userData, options) }
}

const theFirstMigrations = (count: number): string => firstMigrationsIn(aRoot(), count)
const migrationsWithOneThatFails = (): string => failingMigrationsIn(aRoot(), A_LATER_ONE)

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function coded(code: string): Error {
  return Object.assign(new Error(`${code}: made up by the test`), { code })
}

const SOLE: PruneOptions = { ownership: 'sole' }
const fullCopyFs: RecoveryFs = { ...nodeFs, cloneFile: () => Promise.reject(coded('ENOTSUP')) }

function make(userData: string, options: Partial<MakeCheckpointOptions> = {}): Promise<Checkpoint> {
  return makeCheckpoint({
    verifyCopy: checkTheCopyHere,
    userData,
    ownership: 'sole',
    appVersion: '0.1.0',
    build: 'b7c1d2e',
    reason: 'first-start-of-release',
    log: () => undefined,
    ...options,
  })
}

function rows(file: string): number {
  const db = openCheckpointForRead(file)
  try {
    return (db.prepare('SELECT count(*) AS n FROM filler').get() as { n: number }).n
  } finally {
    db.close()
  }
}

function manifestPath(userData: string, id: string): string {
  return join(userData, 'backups', id, 'manifest.json')
}

function rewrite(userData: string, id: string, value: unknown): void {
  writeFileSync(manifestPath(userData, id), `${JSON.stringify(value, null, 2)}\n`)
}

function copyOf(
  userData: string,
  from: Checkpoint,
  change: (manifest: CheckpointManifest) => object = (manifest) => manifest,
): string {
  const id = randomUUID()
  cpSync(from.folder, join(userData, 'backups', id), { recursive: true })
  rewrite(userData, id, { ...change(from.manifest), id })
  return id
}

function oneMigrationLater(manifest: CheckpointManifest, createdAt: number): object {
  const { migrations } = manifest.database
  return {
    ...manifest,
    createdAt: new Date(createdAt).toISOString(),
    madeBy: { appVersion: '0.2.0', build: null },
    database: {
      ...manifest.database,
      migrations: [...migrations, { createdAt: A_LATER_ONE, hash: LATER_HASH }],
    },
  }
}

const ids = (checkpoints: readonly Checkpoint[]): string[] =>
  checkpoints.map(({ manifest }) => manifest.id)

function flipLastByte(file: string): void {
  const stats = statSync(file)
  const bytes = readFileSync(file)
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
  writeFileSync(file, bytes)
  utimesSync(file, stats.atime, stats.mtime)
}

function leftUnfinished(userData: string, id: string): void {
  rmSync(manifestPath(userData, id))
  writeFileSync(join(userData, 'backups', id, 'unfinished'), '')
}

function anHourAndMoreAgo(userData: string, name: string, now = Date.now()): void {
  const then = (now - 61 * 60_000) / 1000
  const folder = join(userData, 'backups', name)
  for (const entry of readdirSync(folder)) utimesSync(join(folder, entry), then, then)
  utimesSync(folder, then, then)
}

export { LATER, LINEAGE, OWN, POSIX, START, minute, DAY_MS, aRoot, aDataFolder, liveFile }
export { FILLER_ROWS, fill, aLiveDatabase, aLiveWorkspace, aCopiedWorkspace, theFirstMigrations }
export { migrationsWithOneThatFails, sha256, coded, SOLE, fullCopyFs, make, rows, manifestPath }
export { rewrite, copyOf, oneMigrationLater, ids, flipLastByte, leftUnfinished, anHourAndMoreAgo }
