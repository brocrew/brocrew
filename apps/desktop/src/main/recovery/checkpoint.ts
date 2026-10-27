import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { OfferedCheckpoint, ProgressListener } from '../../shared/recovery'
import type { RetainedRecoveryCopy } from '../../shared/recovery-retention'
import { freeBytesOn } from '../archive/native-file'
import { keepNoMoreOpenThanTheData } from '../data-folder-privacy'
import type { HostGateVerdict } from '../one-host-gate'
import {
  MANIFEST_FORMAT,
  parseManifest,
  parseWorkspaceId,
  serializeManifest,
  type CheckpointManifest,
  type CheckpointReason,
  type ManifestFile,
  type Migration,
} from './contract'
import {
  hasPendingMigrations,
  isLineagePrefix,
  migrationsOf,
  type BuildMigration,
  type MigrationsRead,
} from './database-facts'
import {
  assertOwnedPathsAreReal,
  copyDurably,
  errorCode,
  nodeFs,
  pathExists,
  privateDir,
  readTextOrNull,
  retrying,
  sha256Of,
  syncFolder,
  writeAtomically,
  type RecoveryFs,
  type RecoveryStats,
} from './files'
import {
  COPY_FILE,
  MANIFEST_FILE,
  UNFINISHED_FILE,
  backupsDir,
  checkpointDatabase,
  checkpointDir,
  databaseFile,
  isUuid,
  manifestFile,
  stateFile,
  workspaceIdFile,
} from './layout'
import { CHECKPOINT_LINE } from './log-lines'
import {
  beginCheckpointDeletion,
  deletionRemnant,
  finishCheckpointDeletion,
  readCheckpointDeletion,
  type CheckpointDeletion,
} from './checkpoint-deletion'
import { APP_STATE_FILES } from './state-files'
import { copySkillTree, readSkillTree, stateContentAt as contentAt } from './trees'
import { SKILL_TREES, SKILLS_CONVERSION_FILE } from '../skills/shared-paths'

/**
 * The checked copies in `backups/`: whether a start needs one, making one, which ones this build
 * can offer, and which ones to let go.
 *
 * A copy is the database read through SQLite's backup API into a private folder of its own, turned
 * into a single rollback-mode file, checked by SQLite and hashed, with the app's state files copied
 * beside it. Every file is on disk before its manifest is written, last, so a folder without one is
 * never a checkpoint and a manifest never names a file a power cut lost. The writer's first file in
 * the folder is an empty `unfinished`, removed once the manifest is written: a folder with no
 * manifest is a copy that never finished only when it holds that file.
 */

/** The steps of making a copy, in order. */
export type CheckpointStep = 'copy' | 'verify' | 'files' | 'manifest'

/** A copy that was not made. The message is a sentence a person can read. */
export class CheckpointFailed extends Error {
  constructor(
    message: string,
    /** Whether trying again could succeed. */
    readonly canRetry: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CheckpointFailed'
  }
}

/** The preflight found too little room before any checkpoint folder was made. */
export class CheckpointNoRoom extends CheckpointFailed {
  constructor(
    readonly needed: number,
    readonly free: number,
  ) {
    super(
      `A recovery copy of this workspace's data needs about ${inWords(needed)} free on its disk, ` +
        `and ${inWords(free)} is free.`,
      true,
    )
    this.name = 'CheckpointNoRoom'
  }
}

/** A checkpoint of this workspace whose manifest this build reads. */
export interface Checkpoint {
  /** `backups/<id>`. */
  readonly folder: string
  readonly manifest: CheckpointManifest
}

/** What the recovery window is told about a checkpoint. */
export function offeredFrom(checkpoint: Checkpoint): OfferedCheckpoint {
  const { id, createdAt, database } = checkpoint.manifest
  return { id, createdAt, bytes: database.bytes }
}

const REGISTRY: ReadonlySet<string> = new Set(APP_STATE_FILES.map((file) => file.name))

/** The state files a restore installs with the database, by name. */
const RESTORED_WITH_THE_DATABASE: ReadonlySet<string> = new Set(
  APP_STATE_FILES.filter((file) => file.restore === 'with-the-database').map((file) => file.name),
)

/** The one copy made before the latest upgrade. */
const KEEP_NEWEST = 1
/** Age at which even the last copy expires after a successful database open. */
const KEEP_WITHIN_MS = 3 * 24 * 60 * 60 * 1000
/** A checkpoint folder with no manifest this old is a copy that never finished. */
const UNFINISHED_AFTER_MS = 60 * 60 * 1000
/** The room a copy needs beyond the database's own size, for the copy's journal and the rest. */
const HEADROOM_SHARE = 1.1
const HEADROOM_BYTES = 64 * 1024 * 1024
/** About how much one backup step copies before the event loop turns again. */
const COPY_STEP_BYTES = 4 * 1024 * 1024

export interface CheckpointFacts {
  /** What the live database records. */
  readonly database: MigrationsRead
  /** This build's migrations, oldest first. */
  readonly lineage: readonly BuildMigration[]
  /** This build's release version on a packaged build; null on any other. */
  readonly release: string | null
  /** The commit this build was made from, as its manifests record it; null when unknown. */
  readonly build?: string | null
  /** {@link listOfferable}'s answer. */
  readonly offerable: readonly Checkpoint[]
  /** {@link whenTheDatabaseLastChanged}'s answer. */
  readonly databaseChangedAt: number | null
  /**
   * The ids of offerable checkpoints whose files were hashed and match their manifests. A copy is
   * reused in place of a new one only when it is among them, so a retry never leans on a copy
   * damaged since it was made. {@link checkpointNeeded} hashes the one it would reuse.
   */
  readonly intact?: ReadonlySet<string>
}

/**
 * Why this start needs a checkpoint before it opens the database, or null when it needs none.
 *
 * Migrations still to apply need one, unless this build already made a copy of the database as it
 * is now and that copy is intact: the same migrations, and nothing changed since (a retry after a
 * failed migration). A packaged build knows its copies by its release version, any other by the
 * commit it was made from. A packaged release's first start needs one too, found by there being no
 * offerable checkpoint made by it. An absent, empty or unreadable database never needs one.
 */
export function needsACheckpoint(facts: CheckpointFacts): CheckpointReason | null {
  const { database } = facts
  if (database.kind !== 'recorded') return null
  if (hasPendingMigrations(database.migrations, facts.lineage)) {
    const reused = reusableCopies(facts).some(
      ({ manifest }) => facts.intact?.has(manifest.id) === true,
    )
    return reused ? null : 'before-migration'
  }
  const byThisRelease = facts.offerable.some(
    ({ manifest }) => manifest.madeBy.appVersion === facts.release,
  )
  return facts.release !== null && !byThisRelease ? 'first-start-of-release' : null
}

export interface CheckpointQuestion {
  readonly userData: string
  /** What the live database records. */
  readonly database: MigrationsRead
  /** This build's migrations, oldest first. */
  readonly lineage: readonly BuildMigration[]
  /** This build's release version on a packaged build; null on any other. */
  readonly release: string | null
  /** The commit this build was made from; null when unknown. */
  readonly build?: string | null
  readonly fs?: RecoveryFs
}

/**
 * {@link needsACheckpoint}, with the facts read from the data folder: the offerable copies, when
 * the database last changed, and, for the one copy a retry would reuse, a hash of every file a
 * restore of it installs. A copy is only ever reused in place of one made before migrations, so it
 * is hashed only when migrations are left to apply.
 */
export async function checkpointNeeded(
  question: CheckpointQuestion,
): Promise<CheckpointReason | null> {
  const { userData, database, lineage, release } = question
  const fs = question.fs ?? nodeFs
  if (database.kind !== 'recorded') return null
  const facts: CheckpointFacts = {
    database,
    lineage,
    release,
    build: question.build ?? null,
    offerable: await listOfferable(userData, lineage, fs),
    databaseChangedAt: await whenTheDatabaseLastChanged(userData, fs),
  }
  const intact = new Set<string>()
  const reusable = hasPendingMigrations(database.migrations, lineage) ? reusableCopies(facts) : []
  for (const candidate of reusable) {
    if (await isIntact(candidate, fs)) {
      intact.add(candidate.manifest.id)
      break
    }
  }
  const needed = needsACheckpoint({ ...facts, intact })
  if (needed === 'first-start-of-release') {
    try {
      const receipt = await readRetentionReceipt(userData, fs)
      if (receipt?.appVersion === release) return null
    } catch {
      // An unreadable receipt cannot establish that this release has already opened.
    }
  }
  return needed
}

/**
 * This build's offerable copies of the database as it is now, newest first: made by this release,
 * or on a build that is not packaged by this commit; with the same migrations; and made no earlier
 * than the database last changed. A build that knows neither has none.
 */
function reusableCopies(facts: CheckpointFacts): Checkpoint[] {
  const { database, release, databaseChangedAt } = facts
  const build = facts.build ?? null
  if (database.kind !== 'recorded' || databaseChangedAt === null) return []
  const byThisBuild = ({ madeBy }: CheckpointManifest): boolean =>
    release === null ? build !== null && madeBy.build === build : madeBy.appVersion === release
  return facts.offerable.filter(
    ({ manifest }) =>
      byThisBuild(manifest) &&
      sameMigrations(manifest.database.migrations, database.migrations) &&
      Math.floor(databaseChangedAt) <= Date.parse(manifest.createdAt),
  )
}

/**
 * When the live database last changed: the newest modification time of `brobot2.sqlite` and of a
 * `-wal` or `-journal` beside it that holds anything. Null when there is no database; a time that
 * cannot be read is thrown, never taken as no change.
 */
export async function whenTheDatabaseLastChanged(
  userData: string,
  fs: RecoveryFs = nodeFs,
): Promise<number | null> {
  const main = databaseFile(userData)
  const stats = await statOrNull(main, fs)
  if (stats === null) return null
  let newest = stats.mtimeMs
  for (const suffix of ['-wal', '-journal']) {
    const sidecar = await statOrNull(`${main}${suffix}`, fs)
    if (sidecar !== null && sidecar.size > 0) newest = Math.max(newest, sidecar.mtimeMs)
  }
  return newest
}

/**
 * Whether every file a restore of `checkpoint` installs still hashes to what its manifest records:
 * the database copy and each state file restored with it. Reads every byte of them.
 */
export async function isIntact(checkpoint: Checkpoint, fs: RecoveryFs = nodeFs): Promise<boolean> {
  for (const { name, sha256 } of installedByARestore(checkpoint.manifest)) {
    const content = await contentAt(join(checkpoint.folder, name), fs).catch(() => null)
    if (content?.kind !== 'file' || content.sha256 !== sha256) return false
  }
  return true
}

/**
 * The newest of `offerable` that {@link isIntact} finds whole, hashing one copy at a time from the
 * newest, or null when none is. This is the copy a restore is offered from.
 */
export async function theNewestIntact(
  offerable: readonly Checkpoint[],
  fs: RecoveryFs = nodeFs,
): Promise<Checkpoint | null> {
  for (const checkpoint of offerable) {
    if (await isIntact(checkpoint, fs)) return checkpoint
  }
  return null
}

export interface MakeCheckpointOptions {
  readonly userData: string
  /** The one-app check's answer. A copy is made only on 'sole'. */
  readonly ownership: HostGateVerdict
  readonly appVersion: string
  readonly build: string | null
  readonly reason: CheckpointReason
  /** Work done of the whole; a listener that throws stops the copy. */
  readonly progress?: ProgressListener
  readonly fs?: RecoveryFs
  /** Epoch ms. */
  readonly now?: () => number
  /** Bytes free on the disk holding a path, or null when that cannot be told. */
  readonly freeBytes?: (path: string) => number | null
  /** Where {@link CHECKPOINT_LINE} goes. */
  readonly log?: (line: string) => void
  /** Called before each step; a test throws from it to stop the copy there. */
  readonly beforeStep?: (step: CheckpointStep) => void
}

/**
 * Makes a checked copy of the live database and the app's state files in `backups/<id>/`, and
 * publishes it by writing its manifest. Every database handle on the live database must be closed
 * first. Any failure removes the unfinished folder and throws {@link CheckpointFailed}.
 *
 * Progress counts the database's pages three times: once copying, once checking, once hashing.
 */
export async function makeCheckpoint(options: MakeCheckpointOptions): Promise<Checkpoint> {
  const { userData } = options
  const fs = options.fs ?? nodeFs
  const now = options.now ?? Date.now
  const log = options.log ?? ((line: string) => console.log(line))
  const beforeStep = options.beforeStep ?? (() => undefined)
  if (options.ownership !== 'sole') {
    throw new CheckpointFailed(
      'BroCrew did not make a recovery copy, because it could not be sure that no other copy of BroCrew ' +
        'has this workspace open.',
      false,
    )
  }

  const id = randomUUID()
  const backups = backupsDir(userData)
  const folder = checkpointDir(userData, id)
  const copy = checkpointDatabase(userData, id)
  const marker = join(folder, UNFINISHED_FILE)
  let made = false
  let total = 0
  const report = (done: number): void => options.progress?.(done, total)
  let manifest: CheckpointManifest
  try {
    let pages = 0
    let workspaceId: string
    const source = new Database(databaseFile(userData), { fileMustExist: true })
    try {
      pages = Math.max(1, Number(source.pragma('page_count', { simple: true })))
      const pageSize = Number(source.pragma('page_size', { simple: true }))
      total = 3 * pages
      checkFreeSpace(userData, pages * pageSize, options.freeBytes ?? freeBytesOn)
      await assertOwnedPathsAreReal(userData, [folder, workspaceIdFile(userData)], fs)
      await privateDir(backups, fs)
      await keepNoMoreOpenThanTheData(backups, userData)
      await syncFolder(userData, fs)
      workspaceId = await workspaceIdFor(userData, fs)
      await fs.mkdir(folder, { mode: 0o700 })
      made = true
      await assertOwnedPathsAreReal(userData, [folder, marker], fs)
      await fs.chmod(folder, 0o700)
      await syncFolder(backups, fs)
      await fs.writeFile(marker, '', { mode: 0o600, flag: 'wx' })
      await syncFolder(folder, fs)

      beforeStep('copy')
      const pagesPerStep = Math.max(1, Math.round(COPY_STEP_BYTES / pageSize))
      await source.backup(copy, {
        progress: ({ totalPages, remainingPages }) => {
          report(Math.min(pages, totalPages - remainingPages))
          return pagesPerStep
        },
      })
    } finally {
      source.close()
    }
    const createdAt = new Date(now()).toISOString()
    report(pages)

    beforeStep('verify')
    verifyTheCopy(copy)
    await leaveOneFile(userData, copy, fs)
    const recorded = await migrationsOf(copy, { fs })
    if (recorded.kind !== 'recorded') {
      throw new CheckpointFailed(
        recorded.kind === 'unreadable'
          ? `BroCrew could not read the migration record in its copy of this workspace's data: ${recorded.detail}`
          : "BroCrew's copy of this workspace's data records no migrations, so it is not a workspace's data.",
        false,
      )
    }
    report(2 * pages)
    await assertOwnedPathsAreReal(userData, [copy], fs)
    await fs.chmod(copy, 0o600)
    await putOnDisk(copy, fs)
    const bytes = (await fs.lstat(copy)).size
    const sha256 = await sha256Of(copy, fs)

    beforeStep('files')
    const files = await copyStateFiles(userData, folder, fs)
    await syncFolder(folder, fs)

    beforeStep('manifest')
    manifest = {
      format: MANIFEST_FORMAT,
      version: 1,
      id,
      createdAt,
      workspaceId,
      reason: options.reason,
      madeBy: { appVersion: options.appVersion, build: options.build },
      database: { file: COPY_FILE, bytes, sha256, migrations: recorded.migrations },
      files,
    }
    await assertOwnedPathsAreReal(userData, [manifestFile(userData, id)], fs)
    await writeAtomically(manifestFile(userData, id), serializeManifest(manifest), fs)
    report(total)
  } catch (error) {
    if (made) await removeUnfinished(userData, folder, fs)
    throw failureFrom(error)
  }
  // After the manifest, so no moment leaves a copy with neither. A marker that stays beside a
  // manifest changes nothing: a folder with a manifest is read by its manifest alone.
  await assertOwnedPathsAreReal(userData, [marker], fs)
    .then(() => retrying(() => fs.rm(marker, { force: true })))
    .catch(() => undefined)
  log(CHECKPOINT_LINE)
  return { folder, manifest }
}

/**
 * Every checkpoint of this workspace whose manifest this build reads, newest first, whatever its
 * migrations and whether or not its files are still there. None when `backups/` cannot be read.
 */
export async function listCheckpoints(
  userData: string,
  fs: RecoveryFs = nodeFs,
): Promise<Checkpoint[]> {
  const folders = await foldersInBackups(userData, fs).catch(() => [])
  const workspace = await readWorkspaceId(userData, fs)
  return workspace.kind === 'id' ? ofThisWorkspace(workspace.id, folders) : []
}

/**
 * The checkpoints this build can offer, newest first: this workspace's, listing only state files
 * this build's registry names, whole (see {@link wholeness}), and holding migrations that are the
 * first of `lineage` by time and hash, so this build can open the copy. Their hashes are checked
 * when one is offered ({@link theNewestIntact}) and again when it is restored.
 */
export async function listOfferable(
  userData: string,
  lineage: readonly BuildMigration[],
  fs: RecoveryFs = nodeFs,
): Promise<Checkpoint[]> {
  const offerable: Checkpoint[] = []
  const workspace = await readWorkspaceId(userData, fs)
  let deletion: CheckpointDeletion | null
  try {
    deletion = await readCheckpointDeletion(
      userData,
      workspace.kind === 'id' ? workspace.id : null,
      fs,
    )
  } catch {
    return []
  }
  for (const checkpoint of await listCheckpoints(userData, fs)) {
    if (checkpoint.manifest.id === deletion?.manifest.id) continue
    if (!couldBeOffered(checkpoint, lineage)) continue
    if ((await wholeness(checkpoint, fs)) === 'whole') offerable.push(checkpoint)
  }
  return offerable
}

export interface PruneOptions {
  /** The one-app check's answer. Nothing is removed unless it is 'sole'. */
  readonly ownership: HostGateVerdict
  readonly fs?: RecoveryFs
  /** Epoch ms. */
  readonly now?: () => number
  readonly warn?: (line: string) => void
  /** Leave unfinished folders alone when freeing room before making a new copy. */
  readonly includeUnfinished?: boolean
  /** Also keep copies from a later app version when pruning before this version starts. */
  readonly currentAppVersion?: string
  /** Before migrations, even an expired newest intact copy must survive until a new one exists. */
  readonly expire?: boolean
}

/**
 * Lets go of the checkpoints no longer kept, and returns the folder names it removed.
 *
 * Keeps one newest intact copy, until three days or three successful starts of its version.
 * Before migrations the newest copy is protected regardless of expiry. Foreign, damaged,
 * unreadable and newer-build copies remain protected. Unfinished writer-marked UUID folders
 * are removed after an hour. Non-UUID folders, including manual timestamp copies, are untouched.
 *
 * It removes nothing unless this process is the only app on the data folder, and nothing in a run
 * where anything in `backups/` could not be read, since what to keep is then not known.
 */
export async function prune(
  userData: string,
  lineage: readonly BuildMigration[],
  options: PruneOptions,
): Promise<string[]> {
  if (options.ownership !== 'sole') return []
  const fs = options.fs ?? nodeFs
  const now = options.now ?? Date.now
  const warn = options.warn ?? ((line: string) => console.warn(line))
  const notThisTime = (why: string): string[] => {
    warn(`BroCrew kept every old recovery copy this time: ${why}`)
    return []
  }

  let folders: InBackups[]
  let workspace: WorkspaceIdOnDisk
  try {
    await assertOwnedPathsAreReal(userData, [], fs)
    if (
      (await pathExists(join(userData, 'recovery', 'history-only.json'), fs)) ||
      (await pathExists(join(userData, 'recovery', 'restore-journal.json'), fs))
    )
      return []
    folders = await foldersInBackups(userData, fs)
    workspace = await readWorkspaceId(userData, fs)
  } catch (error) {
    return notThisTime(messageOf(error))
  }
  const unread = folders.find(({ found }) => found.kind === 'unknown')
  if (unread !== undefined) {
    return notThisTime(`${checkpointDir(userData, unread.name)} could not be read.`)
  }
  if (workspace.kind === 'unreadable') {
    return notThisTime(`${workspaceIdFile(userData)} could not be read.`)
  }

  let receipt: RetentionReceipt | null
  let deletion: CheckpointDeletion | null
  try {
    receipt = await readRetentionReceipt(userData, fs)
    deletion = await readCheckpointDeletion(
      userData,
      workspace.kind === 'id' ? workspace.id : null,
      fs,
    )
    if (deletion) await deletionRemnant(userData, deletion, fs)
  } catch (error) {
    return notThisTime(messageOf(error))
  }
  const whole: Checkpoint[] = []
  for (const checkpoint of workspace.kind === 'id' ? ofThisWorkspace(workspace.id, folders) : []) {
    if (checkpoint.manifest.id === deletion?.manifest.id) continue
    if (
      options.currentAppVersion !== undefined &&
      newerAppVersion(checkpoint.manifest.madeBy.appVersion, options.currentAppVersion)
    ) {
      continue
    }
    if (!couldBeOffered(checkpoint, lineage)) continue
    const found = await wholeness(checkpoint, fs)
    if (found === 'unknown') return notThisTime(`${checkpoint.folder} could not be read.`)
    if (found === 'whole') whole.push(checkpoint)
  }
  // Hashing reads every byte of a copy, so a copy is hashed only when it matters: one that would be
  // kept while another would go, newest first, giving its place to the next when it does not
  // match; then each copy that would go, just before it goes.
  let candidates = whole
  const keepingOf = (copies: readonly Checkpoint[]): Set<string> => {
    const newest = copies[0]
    const expired =
      newest !== undefined &&
      options.expire !== false &&
      (now() - Date.parse(newest.manifest.createdAt) >= KEEP_WITHIN_MS ||
        (receipt?.checkpointId === newest.manifest.id &&
          receipt.appVersion === newest.manifest.madeBy.appVersion &&
          receipt.successfulStarts >= 3))
    return new Set(expired ? [] : copies.slice(0, KEEP_NEWEST).map(({ manifest }) => manifest.id))
  }
  const intact = new Set<string>()
  for (;;) {
    const keeping = keepingOf(candidates)
    if (candidates.every(({ manifest }) => keeping.has(manifest.id))) break
    const unchecked = candidates.find(
      ({ manifest }) => keeping.has(manifest.id) && !intact.has(manifest.id),
    )
    if (unchecked === undefined) break
    if (await isIntact(unchecked, fs)) intact.add(unchecked.manifest.id)
    else candidates = candidates.filter((checkpoint) => checkpoint !== unchecked)
  }
  const kept = keepingOf(candidates)
  const goes: string[] = []
  for (const checkpoint of candidates) {
    if (!kept.has(checkpoint.manifest.id) && (await isIntact(checkpoint, fs))) {
      try {
        if (await onlyCheckpointFiles(checkpoint, fs)) goes.push(checkpoint.manifest.id)
      } catch (error) {
        return notThisTime(messageOf(error))
      }
    }
  }

  const unfinished = (options.includeUnfinished === false ? [] : folders).flatMap(
    ({ name, found }) =>
      isUuid(name) &&
      name !== deletion?.manifest.id &&
      found.kind === 'unfinished' &&
      found.marked &&
      found.onlyTheWritersFiles &&
      now() - found.changedAt > UNFINISHED_AFTER_MS
        ? [name]
        : [],
  )
  const removed: string[] = []
  if (deletion && options.expire !== false) {
    const selected = {
      folder: checkpointDir(userData, deletion.manifest.id),
      manifest: deletion.manifest,
    }
    if (
      !couldBeOffered(selected, lineage) ||
      (options.currentAppVersion !== undefined &&
        newerAppVersion(deletion.manifest.madeBy.appVersion, options.currentAppVersion))
    )
      return notThisTime('An unfinished deletion belongs to a newer recovery copy.')
    try {
      if (await finishCheckpointDeletion(userData, deletion, fs)) removed.push(deletion.manifest.id)
    } catch (error) {
      return notThisTime(messageOf(error))
    }
  }
  for (const name of [...goes, ...unfinished]) {
    const folder = checkpointDir(userData, name)
    try {
      await assertOwnedPathsAreReal(userData, [folder], fs)
      await retrying(() => fs.rm(folder, { recursive: true, force: true }))
      removed.push(name)
    } catch (error) {
      warn(`BroCrew could not remove the old recovery copy in ${folder}: ${messageOf(error)}`)
    }
  }
  return removed
}

/** Unknown version forms are kept because their order cannot be proved. */
function newerAppVersion(candidate: string, current: string): boolean {
  const parse = (version: string): RegExpMatchArray | null =>
    version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  const a = parse(candidate)
  const b = parse(current)
  if (a === null || b === null) return true
  for (const part of [1, 2, 3]) {
    const difference = Number(a[part]) - Number(b[part])
    if (difference !== 0) return difference > 0
  }
  const aPre = a[4]
  const bPre = b[4]
  if (aPre === undefined) return bPre !== undefined
  if (bPre === undefined) return false
  const aParts = aPre.split('.')
  const bParts = bPre.split('.')
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const left = aParts[index]
    const right = bParts[index]
    if (left === undefined) return false
    if (right === undefined) return true
    if (left === right) continue
    const leftNumber = /^\d+$/.test(left)
    const rightNumber = /^\d+$/.test(right)
    if (leftNumber && rightNumber) return Number(left) > Number(right)
    if (leftNumber !== rightNumber) return !leftNumber
    return left > right
  }
  return false
}

function sameMigrations(a: readonly Migration[], b: readonly Migration[]): boolean {
  return (
    a.length === b.length &&
    a.every((one, index) => one.createdAt === b[index]?.createdAt && one.hash === b[index]?.hash)
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failureFrom(error: unknown): CheckpointFailed {
  if (error instanceof CheckpointFailed) return error
  return new CheckpointFailed(
    `BroCrew could not make a recovery copy of this workspace's data: ${messageOf(error)}`,
    true,
    { cause: error },
  )
}

/** Only an absent file is null; any other failure to read it is thrown. */
async function statOrNull(path: string, fs: RecoveryFs): Promise<RecoveryStats | null> {
  try {
    return await fs.stat(path)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

/** A size as a person reads it: `3.2 GB`, or `45 MB` and never less than `1 MB`. */
export function inWords(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${String(Math.max(1, Math.round(bytes / 1e6)))} MB`
}

function checkFreeSpace(
  userData: string,
  databaseBytes: number,
  freeBytes: (path: string) => number | null,
): void {
  const needed = Math.ceil(databaseBytes * HEADROOM_SHARE) + HEADROOM_BYTES
  // A disk that cannot be asked is not refused: the copy itself fails if the space runs out.
  const free = freeBytes(userData)
  if (free !== null && free < needed) {
    throw new CheckpointNoRoom(needed, free)
  }
}

type WorkspaceIdOnDisk =
  | { readonly kind: 'none' }
  | { readonly kind: 'id'; readonly id: string }
  /** `canRetry` when the file could not be read, rather than read and found not to be an id. */
  | { readonly kind: 'unreadable'; readonly canRetry: boolean }

async function readWorkspaceId(userData: string, fs: RecoveryFs): Promise<WorkspaceIdOnDisk> {
  let text: string | null
  try {
    text = await readTextOrNull(workspaceIdFile(userData), fs)
  } catch {
    return { kind: 'unreadable', canRetry: true }
  }
  if (text === null) return { kind: 'none' }
  const id = parseWorkspaceId(text)
  return id === null ? { kind: 'unreadable', canRetry: false } : { kind: 'id', id }
}

/**
 * The workspace's id, made the first time. One that cannot be read is never replaced, since every
 * checkpoint already made names it.
 */
async function workspaceIdFor(userData: string, fs: RecoveryFs): Promise<string> {
  const found = await readWorkspaceId(userData, fs)
  if (found.kind === 'id') return found.id
  if (found.kind === 'unreadable') {
    throw new CheckpointFailed(
      `BroCrew could not read ${workspaceIdFile(userData)}, which ties this workspace to its ` +
        'recovery copies, so it made no copy.',
      found.canRetry,
    )
  }
  const id = randomUUID()
  await writeAtomically(workspaceIdFile(userData), `${id}\n`, fs)
  return id
}

/**
 * Turns the copy, which the backup leaves marked for WAL like its source, into one rollback-mode
 * file that a read-only reader can open in place, and has SQLite check all of it.
 */
function verifyTheCopy(copy: string): void {
  const db = new Database(copy, { fileMustExist: true })
  try {
    const mode = String(db.pragma('journal_mode = DELETE', { simple: true }))
    if (mode !== 'delete') {
      throw new Error(`SQLite kept the copy in ${mode} mode, so it is not one file`)
    }
    // Some damage makes the check itself fail rather than report; either way the data is damaged.
    let check: string
    try {
      check = String(db.pragma('integrity_check', { simple: true }))
    } catch (error) {
      check = messageOf(error)
    }
    if (check !== 'ok') {
      throw new CheckpointFailed(
        `BroCrew's copy of this workspace's data did not pass SQLite's own check (${check}), so ` +
          'BroCrew changed nothing in the data.',
        false,
      )
    }
  } finally {
    db.close()
  }
}

/**
 * Leaves the copy as one file. A rollback-mode database never reads a `-wal` or `-shm`, so one
 * left behind (Windows can fail to delete them on close) is removed; a `-journal` means a write
 * did not finish, and the copy is refused.
 */
async function leaveOneFile(userData: string, copy: string, fs: RecoveryFs): Promise<void> {
  if (await pathExists(`${copy}-journal`, fs)) {
    throw new Error('the copy was left with an unfinished write beside it')
  }
  for (const suffix of ['-wal', '-shm']) {
    await assertOwnedPathsAreReal(userData, [`${copy}${suffix}`], fs)
    await retrying(() => fs.rm(`${copy}${suffix}`, { force: true }))
  }
}

/** Puts a file's bytes on disk through a handle that may write, the only kind Windows flushes. */
async function putOnDisk(path: string, fs: RecoveryFs): Promise<void> {
  const handle = await fs.open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Copies each app state file that exists into the checkpoint folder, each one on disk before this
 * returns, and lists every one.
 */
async function copyStateFiles(
  userData: string,
  folder: string,
  fs: RecoveryFs,
): Promise<ManifestFile[]> {
  const names = [...SKILL_TREES, SKILLS_CONVERSION_FILE]
  const states = (root: string) => Promise.all(names.map((name) => contentAt(join(root, name), fs)))
  let last: unknown = new Error('Skills could not be read.')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const before = JSON.stringify(await states(userData))
      const result = await copyStateFilesOnce(userData, folder, fs)
      if (
        JSON.stringify(await states(userData)) === before &&
        JSON.stringify(await states(folder)) === before
      )
        return result
    } catch (error) {
      last = error
    }
  }
  throw last
}

async function copyStateFilesOnce(
  userData: string,
  folder: string,
  fs: RecoveryFs,
): Promise<ManifestFile[]> {
  const files: ManifestFile[] = []
  for (const file of APP_STATE_FILES) {
    const source = stateFile(userData, file)
    const copy = join(folder, file.name)
    try {
      await assertOwnedPathsAreReal(userData, [copy], fs)
      await retrying(async () => {
        // A try a briefly held file stopped may have left part of a copy.
        await fs.rm(copy, { recursive: file.kind === 'tree', force: true })
        if (file.kind === 'tree') await copySkillTree(source, copy, fs)
        else await copyDurably(source, copy, fs)
      })
    } catch (error) {
      if (errorCode(error) !== 'ENOENT' || (await pathExists(source, fs))) throw error
      files.push({ name: file.name, present: false })
      continue
    }
    const tree = file.kind === 'tree' ? await readSkillTree(copy, fs) : null
    files.push({
      name: file.name,
      present: true,
      bytes: tree?.bytes ?? (await fs.lstat(copy)).size,
      sha256: tree?.sha256 ?? (await sha256Of(copy, fs)),
    })
  }
  return files
}

/** Best effort: what is left has no manifest, and a later prune removes it. */
async function removeUnfinished(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  try {
    await assertOwnedPathsAreReal(userData, [folder], fs)
    await retrying(() => fs.rm(folder, { recursive: true, force: true }))
  } catch {
    // Left for a later prune.
  }
}

type FoundInBackups =
  | { readonly kind: 'checkpoint'; readonly checkpoint: Checkpoint }
  /** A folder with no manifest: when it or anything in it last changed, and what it holds. */
  | {
      readonly kind: 'unfinished'
      readonly changedAt: number
      /** Whether it holds the writer's `unfinished` file, as a plain file. */
      readonly marked: boolean
      /** Whether it holds only files with names the writer gives the files it makes. */
      readonly onlyTheWritersFiles: boolean
    }
  /** Not a folder, a link, or a manifest this build does not read. */
  | { readonly kind: 'other' }
  /** Something in it could not be read. */
  | { readonly kind: 'unknown' }

interface InBackups {
  readonly name: string
  readonly found: FoundInBackups
}

const OTHER: FoundInBackups = { kind: 'other' }
const UNKNOWN: FoundInBackups = { kind: 'unknown' }

/** Every folder in `backups/` named by an id this app makes. Throws when `backups/` is unreadable. */
async function foldersInBackups(userData: string, fs: RecoveryFs): Promise<InBackups[]> {
  let names: string[]
  try {
    names = await fs.readdir(backupsDir(userData))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
  const folders: InBackups[] = []
  for (const name of names.filter(isUuid).sort()) {
    folders.push({ name, found: await readFolder(userData, name, fs) })
  }
  return folders
}

/** The checkpoints among `folders` that name the workspace `workspaceId`, newest first. */
function ofThisWorkspace(workspaceId: string, folders: readonly InBackups[]): Checkpoint[] {
  return folders
    .flatMap(({ found }) =>
      found.kind === 'checkpoint' && found.checkpoint.manifest.workspaceId === workspaceId
        ? [found.checkpoint]
        : [],
    )
    .sort(newestFirst)
}

/** Whether a checkpoint is one this build could offer, before its files are looked at. */
function couldBeOffered(checkpoint: Checkpoint, lineage: readonly BuildMigration[]): boolean {
  const { manifest } = checkpoint
  return (
    isLineagePrefix(manifest.database.migrations, lineage) &&
    manifest.files.every((file) => REGISTRY.has(file.name))
  )
}

/** An entry is looked at as it is: a link is never followed. */
async function lstatOrNull(path: string, fs: RecoveryFs): Promise<RecoveryStats | null> {
  try {
    return await retrying(() => fs.lstat(path))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

async function readFolder(userData: string, name: string, fs: RecoveryFs): Promise<FoundInBackups> {
  const folder = checkpointDir(userData, name)
  const manifestPath = manifestFile(userData, name)
  try {
    const stats = await lstatOrNull(folder, fs)
    if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) return OTHER
    const manifest = await lstatOrNull(manifestPath, fs)
    if (manifest === null) return await unfinished(folder, stats, fs)
    if (manifest.isSymbolicLink() || !manifest.isFile()) return OTHER
    const text = await readTextOrNull(manifestPath, fs)
    if (text === null) return UNKNOWN
    const parsed = parseManifest(text)
    if (!parsed.ok || parsed.value.id !== name) return OTHER
    return { kind: 'checkpoint', checkpoint: { folder, manifest: parsed.value } }
  } catch {
    return UNKNOWN
  }
}

/** The temporary name `writeAtomically` gives the manifest while writing it. */
const MANIFEST_BEING_WRITTEN = new RegExp(
  `^${MANIFEST_FILE.replace(/\./g, '\\.')}\\.[0-9a-f]{12}\\.tmp$`,
)

/**
 * The names of the files the writer makes in a checkpoint folder: its `unfinished` file; the copy,
 * and the sidecars SQLite keeps beside it while it is written and switched to one file; the state
 * files of this build's registry; and the manifest while it is written.
 */
function isTheWritersName(name: string): boolean {
  return (
    [
      UNFINISHED_FILE,
      COPY_FILE,
      `${COPY_FILE}-journal`,
      `${COPY_FILE}-wal`,
      `${COPY_FILE}-shm`,
    ].includes(name) ||
    REGISTRY.has(name) ||
    MANIFEST_BEING_WRITTEN.test(name)
  )
}

async function unfinished(
  folder: string,
  stats: RecoveryStats,
  fs: RecoveryFs,
): Promise<FoundInBackups> {
  let changedAt = stats.mtimeMs
  let marked = false
  let onlyTheWritersFiles = true
  for (const entry of await fs.readdir(folder)) {
    const inside = await lstatOrNull(join(folder, entry), fs)
    if (inside === null) continue
    changedAt = Math.max(changedAt, inside.mtimeMs)
    if (
      !(inside.isFile() || (inside.isDirectory() && SKILL_TREES.includes(entry))) ||
      !isTheWritersName(entry)
    )
      onlyTheWritersFiles = false
    if (entry === UNFINISHED_FILE && inside.isFile()) marked = true
  }
  return { kind: 'unfinished', changedAt, marked, onlyTheWritersFiles }
}

/** The files a restore of a checkpoint installs, as its manifest records them. */
function installedByARestore(
  manifest: CheckpointManifest,
): { readonly name: string; readonly bytes: number; readonly sha256: string }[] {
  return [
    { name: COPY_FILE, bytes: manifest.database.bytes, sha256: manifest.database.sha256 },
    ...manifest.files.flatMap((file) =>
      file.present && RESTORED_WITH_THE_DATABASE.has(file.name)
        ? [{ name: file.name, bytes: file.bytes, sha256: file.sha256 }]
        : [],
    ),
  ]
}

/**
 * Whether the files a restore would install are there, as plain files at the sizes the manifest
 * records; `unknown` when one could not be looked at for any reason but its absence.
 */
async function wholeness(
  checkpoint: Checkpoint,
  fs: RecoveryFs,
): Promise<'whole' | 'not-whole' | 'unknown'> {
  for (const { name, bytes } of installedByARestore(checkpoint.manifest)) {
    let stats: RecoveryStats | null
    try {
      stats = await lstatOrNull(join(checkpoint.folder, name), fs)
    } catch {
      return 'unknown'
    }
    if (SKILL_TREES.includes(name)) {
      if (!stats?.isDirectory() || stats.isSymbolicLink()) return 'not-whole'
    } else if (stats === null || !stats.isFile() || stats.size !== bytes) return 'not-whole'
  }
  return 'whole'
}

function newestFirst(a: Checkpoint, b: Checkpoint): number {
  const byTime = Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt)
  if (byTime !== 0) return byTime
  return a.manifest.id < b.manifest.id ? 1 : a.manifest.id > b.manifest.id ? -1 : 0
}

const RETENTION_FILE = 'retention.json'
interface RetentionReceipt {
  readonly format: 'brocrew-recovery-retention'
  readonly version: 1
  readonly workspaceId: string
  readonly appVersion: string
  readonly checkpointId: string | null
  readonly successfulStarts: number
}

async function readRetentionReceipt(
  userData: string,
  fs: RecoveryFs,
): Promise<RetentionReceipt | null> {
  const path = join(backupsDir(userData), RETENTION_FILE)
  await assertOwnedPathsAreReal(userData, [path, workspaceIdFile(userData)], fs)
  const text = await readTextOrNull(path, fs)
  if (text === null) return null
  const value = JSON.parse(text) as Partial<RetentionReceipt> | null
  const workspace = await readWorkspaceId(userData, fs)
  if (
    value?.format !== 'brocrew-recovery-retention' ||
    value.version !== 1 ||
    workspace.kind !== 'id' ||
    value.workspaceId !== workspace.id ||
    typeof value.appVersion !== 'string' ||
    value.appVersion.length === 0 ||
    !(
      value.checkpointId === null ||
      (typeof value.checkpointId === 'string' && isUuid(value.checkpointId))
    ) ||
    !Number.isSafeInteger(value.successfulStarts) ||
    (value.successfulStarts ?? -1) < 0
  ) {
    throw new Error('The recovery copy start record could not be read.')
  }
  return value as RetentionReceipt
}

/** Called once per process only after the database opened and migrations completed. */
export async function recordSuccessfulStart(
  userData: string,
  lineage: readonly BuildMigration[],
  options: PruneOptions,
): Promise<void> {
  if (options.ownership !== 'sole' || options.currentAppVersion === undefined) return
  const fs = options.fs ?? nodeFs
  await assertOwnedPathsAreReal(userData, [], fs)
  // A history-only restore must keep its copy and must never count as a successful new start.
  if (
    (await pathExists(join(userData, 'recovery', 'history-only.json'), fs)) ||
    (await pathExists(join(userData, 'recovery', 'restore-journal.json'), fs))
  )
    return
  const workspace = await readWorkspaceId(userData, fs)
  if (workspace.kind !== 'id') return
  const previous = await readRetentionReceipt(userData, fs)
  const newest = (await listOfferable(userData, lineage, fs))[0]
  const checkpointId = newest?.manifest.id ?? previous?.checkpointId ?? null
  const same =
    previous?.appVersion === options.currentAppVersion && previous.checkpointId === checkpointId
  const receipt: RetentionReceipt = {
    format: 'brocrew-recovery-retention',
    version: 1,
    workspaceId: workspace.id,
    appVersion: options.currentAppVersion,
    checkpointId,
    successfulStarts: Math.min(3, same ? previous.successfulStarts + 1 : 1),
  }
  const path = join(backupsDir(userData), RETENTION_FILE)
  await assertOwnedPathsAreReal(userData, [path], fs)
  await writeAtomically(path, JSON.stringify(receipt) + '\n', fs)
}

/** Refuse extra files, links and unexpected directories before removing an entire folder. */
async function onlyCheckpointFiles(checkpoint: Checkpoint, fs: RecoveryFs): Promise<boolean> {
  const allowed = new Set([
    MANIFEST_FILE,
    UNFINISHED_FILE,
    COPY_FILE,
    ...checkpoint.manifest.files.filter((file) => file.present).map((file) => file.name),
  ])
  for (const name of await fs.readdir(checkpoint.folder)) {
    if (!allowed.has(name)) return false
    const stat = await fs.lstat(join(checkpoint.folder, name))
    if (
      stat.isSymbolicLink() ||
      !(stat.isFile() || (SKILL_TREES.includes(name) && stat.isDirectory()))
    )
      return false
  }
  return true
}

export async function retainedCopyInfo(
  userData: string,
  lineage: readonly BuildMigration[],
  options: PruneOptions,
): Promise<RetainedRecoveryCopy | null> {
  const fs = options.fs ?? nodeFs
  await assertOwnedPathsAreReal(userData, [], fs)
  const receipt = await readRetentionReceipt(userData, fs)
  const workspace = await readWorkspaceId(userData, fs)
  const deletion = await readCheckpointDeletion(
    userData,
    workspace.kind === 'id' ? workspace.id : null,
    fs,
  )
  const remnant = deletion ? await deletionRemnant(userData, deletion, fs) : null
  // A confirmed deletion is no longer a restore offer, but its remaining bytes stay visible.
  if (deletion && remnant) {
    return {
      id: deletion.manifest.id,
      appVersion: deletion.manifest.madeBy.appVersion,
      bytes: remnant.bytes,
      expiresAt: new Date(Date.parse(deletion.manifest.createdAt) + KEEP_WITHIN_MS).toISOString(),
      startsLeft: 0,
    }
  }
  const copy = (await listOfferable(userData, lineage, fs)).find(
    ({ manifest }) =>
      options.currentAppVersion === undefined ||
      !newerAppVersion(manifest.madeBy.appVersion, options.currentAppVersion),
  )
  if (!copy) return null
  return {
    id: copy.manifest.id,
    appVersion: copy.manifest.madeBy.appVersion,
    bytes:
      copy.manifest.database.bytes +
      copy.manifest.files.reduce((total, file) => total + (file.present ? file.bytes : 0), 0),
    expiresAt: new Date(Date.parse(copy.manifest.createdAt) + KEEP_WITHIN_MS).toISOString(),
    startsLeft: Math.max(
      0,
      3 -
        (receipt?.checkpointId === copy.manifest.id &&
        receipt.appVersion === copy.manifest.madeBy.appVersion
          ? receipt.successfulStarts
          : 0),
    ),
  }
}

/** Delete only the still-current selected copy, under the same safety checks as pruning. */
export async function deleteRetainedCopy(
  userData: string,
  lineage: readonly BuildMigration[],
  id: string,
  options: PruneOptions,
): Promise<boolean> {
  if (options.ownership !== 'sole' || !isUuid(id)) return false
  const fs = options.fs ?? nodeFs
  try {
    await assertOwnedPathsAreReal(userData, [], fs)
    if (
      (await pathExists(join(userData, 'recovery', 'history-only.json'), fs)) ||
      (await pathExists(join(userData, 'recovery', 'restore-journal.json'), fs))
    )
      return false
    const folders = await foldersInBackups(userData, fs)
    if (folders.some(({ found }) => found.kind === 'unknown')) return false
    const receipt = await readRetentionReceipt(userData, fs)
    const workspace = await readWorkspaceId(userData, fs)
    if (workspace.kind !== 'id') return false
    const deletion = await readCheckpointDeletion(userData, workspace.id, fs)
    if (deletion) {
      const remnant = await deletionRemnant(userData, deletion, fs)
      if (deletion.manifest.id === id) {
        if (
          !couldBeOffered(
            { folder: checkpointDir(userData, id), manifest: deletion.manifest },
            lineage,
          ) ||
          (options.currentAppVersion !== undefined &&
            newerAppVersion(deletion.manifest.madeBy.appVersion, options.currentAppVersion))
        )
          return false
        await finishCheckpointDeletion(userData, deletion, fs)
        return true
      }
      if (remnant) return false
    }
    const candidates = ofThisWorkspace(workspace.id, folders)
    // If a newer or unreadable copy is present, a stale Settings view must not delete around it.
    const copy = candidates[0]
    if (
      !copy ||
      copy.manifest.id !== id ||
      !couldBeOffered(copy, lineage) ||
      (options.currentAppVersion !== undefined &&
        newerAppVersion(copy.manifest.madeBy.appVersion, options.currentAppVersion)) ||
      !(await isIntact(copy, fs)) ||
      !(await onlyCheckpointFiles(copy, fs))
    )
      return false
    if (!receipt || receipt.appVersion !== copy.manifest.madeBy.appVersion) return false
    await assertOwnedPathsAreReal(userData, [copy.folder], fs)
    await finishCheckpointDeletion(userData, await beginCheckpointDeletion(userData, copy, fs), fs)
    return true
  } catch {
    return false
  }
}
