import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../../../src/main/db/connection'
import { applyMigrations } from '../../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../../src/main/db/session-store'
import type { TranscriptEvent } from '../../../src/shared/runtime-ipc'
import {
  makeCheckpoint as writeACheckpoint,
  type Checkpoint,
} from '../../../src/main/recovery/checkpoint'
import {
  STEPS,
  parseGate,
  parseJournal,
  serializeManifest,
  type CheckpointManifest,
  type CheckpointReason,
  type HistoryOnlyGate,
  type RestoreJournal,
  type Step,
} from '../../../src/main/recovery/contract'
import {
  nodeFs,
  privateDir,
  writeAtomically,
  type RecoveryFs,
  type StepHooks,
} from '../../../src/main/recovery/files'
import {
  DATABASE_FILE,
  UNFINISHED_FILE,
  backupsDir,
  checkpointDatabase,
  checkpointDir,
  databaseFile,
  gateFile,
  journalFile,
  manifestFile,
  preservedDir,
  stagedDir,
  stateFile,
  workspaceIdFile,
} from '../../../src/main/recovery/layout'
import { restore, RestoreStopped } from '../../../src/main/recovery/restore'
import { APP_STATE_FILES, type AppStateFile } from '../../../src/main/recovery/state-files'

/**
 * A data folder for recovery tests, laid down from real files: a database built by the app's own
 * migrations and written to through its own session store, checkpoints made by the checkpoint
 * writer itself, and the records and files of a restore stopped after any step. Everything in
 * it is synthetic: short conversations, no provider home, no sign-in and no saved key.
 *
 * The workspace's history runs oldest first. Each checkpoint copies the database as it stood when
 * the copy was made, and every stretch of time adds one conversation, so each copy holds one more
 * conversation than the copy before it and the workspace's own database one more than its newest
 * copy. A database one migration newer is this build's with one more migration recorded, as a newer
 * build leaves it; its tables are unchanged, since no build carries that migration.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** The app's own migrations folder. */
export const MIGRATIONS_FOLDER = join(here, '../../../src/main/db/migrations')

/** Each migration this build carries (its journal `when`), oldest first. */
export const BUILD_LINEAGE: readonly number[] = (
  JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: { when: number }[]
  }
).entries.map((entry) => entry.when)

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** How many migrations this build carries, and so records in a database it migrated. */
export const THIS_BUILD = BUILD_LINEAGE.length

/** How many a database records that a newer build migrated: this build's, and one more. */
export const ONE_NEWER = THIS_BUILD + 1

/**
 * The migration a database {@link ONE_NEWER} records beyond this build's: dated a day after this
 * build's newest, with the hash of a migration file no build carries.
 */
export const NEWER_MIGRATION: { readonly hash: string; readonly createdAt: number } = {
  hash: createHash('sha256').update('-- a migration only a newer BroBot carries\n').digest('hex'),
  createdAt: (BUILD_LINEAGE.at(-1) ?? 0) + DAY_MS,
}

/** The version a copy on this build's schema names, and the newer one that moved a workspace past it. */
export const THIS_VERSION = '0.1.0'
export const NEWER_VERSION = '0.2.0'

/** How many migrations a database records: {@link THIS_BUILD} or {@link ONE_NEWER}. */
export type Schema = number

/**
 * What is wrong with a checkpoint, when something is:
 * - `no-manifest`: the copy and the writer's `unfinished` file are there and its manifest is not,
 *   as a copy stopped part-way leaves it;
 * - `copy-changed`: one byte of the copy changed after its manifest was written, size kept;
 * - `version-2`: its manifest says version 2, as a later build might write one;
 * - `another-workspace`: its manifest names a workspace id other than this folder's.
 */
export type CheckpointFault = 'no-manifest' | 'copy-changed' | 'version-2' | 'another-workspace'

export interface CheckpointSpec {
  /** The schema of the database when the copy was made. */
  readonly migrations: Schema
  /** ISO. When not given, the copies are a day apart and the newest is a day before `now`. */
  readonly createdAt?: string
  /**
   * `0.2.0` for a copy one migration newer and for the last copy on this build's schema in a
   * workspace a newer build migrated, which that build made just before it migrated; `0.1.0`
   * otherwise.
   */
  readonly appVersion?: string
  /** `before-migration` for the copy made just before a migration, else `first-start-of-release`. */
  readonly reason?: CheckpointReason
  /** Whether the copy holds `drafts.json`; the fixture's `drafts` when not given. */
  readonly drafts?: boolean
  readonly fault?: CheckpointFault
  /**
   * Marks the checkpoint a `journalAt` or `gate` restore copies. When none is marked it is the
   * newest whole one on this build's schema.
   */
  readonly restored?: boolean
}

export interface RecoveryFixtureOptions {
  /** The schema of the workspace's own database. */
  readonly migrations: Schema
  /** Oldest first. A bare schema stands for a checkpoint with every default. */
  readonly checkpoints: readonly (CheckpointSpec | Schema)[]
  /**
   * Lays down a restore that stopped after this step, made by the restore engine itself: the
   * journal names it as the last step whose work is done, the files are where that step left them,
   * and the next step has not begun.
   */
  readonly journalAt?: Step
  /**
   * With no `journalAt`, lays down a finished restore: the gate, the restored copy as the database,
   * the workspace's own database set aside, and no journal. With `journalAt`, it must agree with
   * whether that step has installed the gate.
   */
  readonly gate?: boolean
  /** Whether the workspace has unsent drafts (`drafts.json`), which a restore moves with the database. */
  readonly drafts?: boolean
  /**
   * Whether the workspace has a `workspace.json`, a state file each checkpoint copies and a restore
   * leaves as it is. The copies hold an earlier name than the live file.
   */
  readonly keptCurrent?: boolean
  /**
   * Leaves the workspace's database as a crash leaves it: its newest stretch only in
   * `brobot2.sqlite-wal`, beside a `brobot2.sqlite-shm`.
   */
  readonly crashed?: boolean
  /** The time the default dates count back from. */
  readonly now?: number
  /**
   * Whether each conversation also holds the rows whose controls the history window must not
   * offer: a generated image, a sub-agent, a workflow run and a message held for the next turn.
   */
  readonly everyRowKind?: boolean
}

export interface FixtureCheckpoint {
  readonly id: string
  /** `backups/<id>`. */
  readonly dir: string
  /** `backups/<id>/database.sqlite`. */
  readonly database: string
  readonly migrations: Schema
  readonly fault: CheckpointFault | null
  /**
   * The version-1 manifest that describes this copy. It is on disk as it is here unless the fault
   * says otherwise: absent for `no-manifest`, with version 2 for `version-2`.
   */
  readonly manifest: CheckpointManifest
  /** The conversations the copy holds, oldest first. */
  readonly conversations: readonly string[]
}

export interface FixtureRestore {
  readonly id: string
  readonly checkpointId: string
  /** As last written, or null once the restore finished and removed it. */
  readonly journal: RestoreJournal | null
  /** Null before the gate is installed. */
  readonly gate: HistoryOnlyGate | null
  /** `recovery/staged/<id>`, removed once the restore is done. */
  readonly staged: string
  /** `recovery/preserved/<id>`, made when the workspace's own files are set aside. */
  readonly preserved: string
}

export interface RecoveryFixture {
  readonly userData: string
  /** `brobot2.sqlite`: the workspace's own database, or the restored copy once it is installed. */
  readonly database: string
  /** The schema of the workspace's own database. */
  readonly migrations: Schema
  /** What `backups/workspace-id` holds, or null when no checkpoint was made. */
  readonly workspaceId: string | null
  /** In the order given, oldest first. */
  readonly checkpoints: readonly FixtureCheckpoint[]
  /** The conversations the workspace's own database holds, oldest first. */
  readonly conversations: readonly string[]
  readonly restore: FixtureRestore | null
}

interface PlannedCheckpoint {
  readonly createdAt: string
  readonly migrations: Schema
  readonly appVersion: string
  readonly reason: CheckpointReason
  readonly drafts: boolean
  readonly fault: CheckpointFault | null
  readonly restored: boolean
}

/** What one stretch of time left in the state files: each file's text, or null for none. */
interface StateTexts {
  readonly drafts: string | null
  readonly workspace: string | null
}

/** How far a restore got: after one of its steps, or finished with its journal removed. */
type RestoreReach = Step | 'finished'

/** Lays down the data folder `dir` (made when missing) as `options` describe. */
export async function makeRecoveryFixture(
  dir: string,
  options: RecoveryFixtureOptions,
): Promise<RecoveryFixture> {
  const now = options.now ?? Date.now()
  const planned = planCheckpoints(options, now)
  const reach = restoreReach(options)
  const restoring = reach === null ? null : restoredCheckpoint(planned)
  if (reach === null && planned.some((checkpoint) => checkpoint.restored)) {
    throw new Error('a checkpoint is marked restored, but no journalAt or gate asks for a restore')
  }

  await mkdir(dir, { recursive: true })
  const workspaceId = planned.length > 0 ? randomUUID() : null
  if (workspaceId !== null) {
    await privateDir(backupsDir(dir))
    await writeAtomically(workspaceIdFile(dir), `${workspaceId}\n`)
  }

  const scratch = await mkdtemp(join(tmpdir(), 'brobot2-recovery-fixture-'))
  const checkpoints: FixtureCheckpoint[] = []
  const conversations: string[] = []
  try {
    const source = join(scratch, DATABASE_FILE)
    const db = openDatabase(source)
    try {
      applyMigrations(db, MIGRATIONS_FOLDER)
      let clock = now
      const store = createSessionStore(db, () => clock)
      let schema: Schema = THIS_BUILD
      const migrateTo = (wanted: Schema): void => {
        if (wanted === ONE_NEWER && schema === THIS_BUILD) {
          db.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(
            NEWER_MIGRATION.hash,
            NEWER_MIGRATION.createdAt,
          )
          schema = ONE_NEWER
        }
      }

      for (const [index, plan] of planned.entries()) {
        migrateTo(plan.migrations)
        clock = Date.parse(plan.createdAt) - HOUR_MS
        const copy = index + 1
        conversations.push(
          converse(
            store,
            dir,
            conversations.length + 1,
            `before copy ${String(copy)}`,
            clock,
            options.everyRowKind,
          ),
        )
        const texts: StateTexts = {
          drafts: plan.drafts
            ? draftsText(conversations, `as they stood at copy ${String(copy)}`)
            : null,
          workspace: options.keptCurrent === true ? workspaceText('its earlier name') : null,
        }
        checkpoints.push(
          await checkpointByTheWriter(
            dir,
            scratch,
            db,
            plan,
            workspaceId ?? '',
            [...conversations],
            texts,
          ),
        )
      }

      if (options.crashed === true) {
        // Everything older is in the main file; the last stretch stays in the -wal.
        db.pragma('wal_checkpoint(TRUNCATE)')
        db.pragma('wal_autocheckpoint = 0')
      }
      migrateTo(options.migrations)
      const newest = planned.at(-1)
      clock = newest === undefined ? now - HOUR_MS : Date.parse(newest.createdAt) + HOUR_MS
      conversations.push(
        converse(
          store,
          dir,
          conversations.length + 1,
          'after the newest copy',
          clock,
          options.everyRowKind,
        ),
      )

      if (options.crashed === true) {
        // Read and written whole while the connection still holds them open, which every system
        // allows; a copy routine may ask for more than a read.
        for (const suffix of ['', '-wal', '-shm']) {
          await writeFile(`${databaseFile(dir)}${suffix}`, await readFile(`${source}${suffix}`))
        }
      }
    } finally {
      db.close()
    }
    if (options.crashed !== true) await copyFile(source, databaseFile(dir))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }

  await writeStateFiles(dir, {
    drafts:
      options.drafts === true ? draftsText(conversations, 'written after the newest copy') : null,
    workspace: options.keptCurrent === true ? workspaceText('its name now') : null,
  })

  let restore: FixtureRestore | null = null
  if (reach !== null && restoring !== null) {
    const checkpoint = checkpoints[planned.indexOf(restoring)]
    if (checkpoint === undefined) throw new Error('the restored checkpoint was not made')
    restore = await layRestore(dir, checkpoint, reach, now)
  }

  return {
    userData: dir,
    database: databaseFile(dir),
    migrations: options.migrations,
    workspaceId,
    checkpoints,
    conversations,
    restore,
  }
}

function planCheckpoints(options: RecoveryFixtureOptions, now: number): PlannedCheckpoint[] {
  const specs: CheckpointSpec[] = options.checkpoints.map((spec) =>
    typeof spec === 'number' ? { migrations: spec } : spec,
  )
  for (const schema of [options.migrations, ...specs.map((spec) => spec.migrations)]) {
    if (schema !== THIS_BUILD && schema !== ONE_NEWER) {
      throw new Error(`schema ${String(schema)} is neither THIS_BUILD nor ONE_NEWER`)
    }
  }
  // In a workspace a newer build migrated, the last copy on this build's schema is the one the
  // newer build made before it migrated.
  let beforeMigration = -1
  if (options.migrations === ONE_NEWER) {
    specs.forEach((spec, index) => {
      if (spec.migrations === THIS_BUILD) beforeMigration = index
    })
  }

  const planned = specs.map((spec, index): PlannedCheckpoint => {
    const at = `checkpoint ${String(index + 1)}`
    if (spec.migrations > options.migrations) {
      throw new Error(`${at} has schema ${String(spec.migrations)}, past the workspace's own`)
    }
    const before = specs[index - 1]
    if (before !== undefined && spec.migrations < before.migrations) {
      throw new Error(`${at} has a lower schema than the one before it, and they are oldest first`)
    }
    const madeByTheNewer = spec.migrations === ONE_NEWER || index === beforeMigration
    return {
      createdAt: spec.createdAt ?? new Date(now - (specs.length - index) * DAY_MS).toISOString(),
      migrations: spec.migrations,
      appVersion: spec.appVersion ?? (madeByTheNewer ? NEWER_VERSION : THIS_VERSION),
      reason:
        spec.reason ?? (index === beforeMigration ? 'before-migration' : 'first-start-of-release'),
      drafts: spec.drafts ?? options.drafts ?? false,
      fault: spec.fault ?? null,
      restored: spec.restored ?? false,
    }
  })

  planned.forEach((plan, index) => {
    const before = planned[index - 1]
    if (before !== undefined && Date.parse(plan.createdAt) <= Date.parse(before.createdAt)) {
      throw new Error(`checkpoint ${String(index + 1)} is not newer than the one before it`)
    }
  })
  return planned
}

function restoreReach(options: RecoveryFixtureOptions): RestoreReach | null {
  const { journalAt, gate } = options
  if (journalAt === undefined) return gate === true ? 'finished' : null
  const gateInstalled = STEPS.indexOf(journalAt) >= STEPS.indexOf('gate-installed')
  if (gate !== undefined && gate !== gateInstalled) {
    throw new Error(
      gateInstalled
        ? `a restore stopped after ${journalAt} has installed its gate`
        : `a restore stopped after ${journalAt} has not installed its gate yet`,
    )
  }
  return journalAt
}

function restoredCheckpoint(planned: readonly PlannedCheckpoint[]): PlannedCheckpoint {
  const marked = planned.filter((checkpoint) => checkpoint.restored)
  if (marked.length > 1) throw new Error('more than one checkpoint is marked restored')
  const chosen =
    marked[0] ??
    [...planned]
      .reverse()
      .find((checkpoint) => checkpoint.migrations === THIS_BUILD && checkpoint.fault === null)
  if (chosen === undefined) {
    throw new Error("a restore needs a whole checkpoint on this build's schema to copy")
  }
  if (chosen.migrations !== THIS_BUILD || chosen.fault !== null) {
    throw new Error(
      "a restore copies only a whole checkpoint on this build's schema, as this build verifies one",
    )
  }
  return chosen
}

/**
 * The rows the history window draws with a control of its own in the app (open the image, open
 * the sub-agent's transcript, open a workflow's output, put a held message back in the composer),
 * in the shapes the app's adapters write them. The recovery window offers none of those controls.
 * A workflow run is drawn on the row of the `Workflow` call that launched it, so that call comes
 * first and the run names it.
 */
function rowsWithControls(when: string): TranscriptEvent[] {
  return [
    { type: 'image', imageId: `image-${when}`, path: `/generated/${when}.png`, prompt: 'a chart' },
    { type: 'sub_agent', agentId: `agent-${when}`, phase: 'started', kind: 'Explore' },
    { type: 'sub_agent', agentId: `agent-${when}`, phase: 'ended' },
    { type: 'tool_call', id: `workflow-call-${when}`, name: 'Workflow', summary: 'a review' },
    {
      type: 'workflow_run',
      taskId: `workflow-${when}`,
      toolUseId: `workflow-call-${when}`,
      name: 'a review',
      phases: [{ index: 0, title: 'Read' }],
      agents: [{ agentId: `step-${when}`, label: 'reader', phaseIndex: 0, state: 'done' }],
      outcome: 'completed',
      outputFile: `/generated/${when}-output.md`,
      source: 'fixture',
    },
    { type: 'message_queued', messageId: `held-${when}`, kind: 'work', text: 'one more thing' },
  ] as TranscriptEvent[]
}

/** One short conversation, written through the app's own store. Returns its id. */
function converse(
  store: SessionStore,
  userData: string,
  n: number,
  when: string,
  at: number,
  everyRowKind = false,
): string {
  const id = `conversation-${String(n)}`
  store.create({
    id,
    provider: 'claude',
    cwd: join(userData, 'brobot-workspace'),
    approvalMode: 'ask',
    profileId: 'default',
  })
  store.append(id, 0, { type: 'user_turn', text: `Asked ${when}.` }, at)
  store.append(id, 1, { type: 'assistant_message', text: `Answered ${when}.` }, at + 1_000)
  if (everyRowKind) {
    for (const [index, event] of rowsWithControls(when).entries()) {
      store.append(id, 2 + index, event, at + 2_000 + index)
    }
  }
  return id
}

/** `drafts.json` as the drafts writer writes it, with one draft in the newest conversation. */
function draftsText(conversations: readonly string[], when: string): string {
  const newest = conversations.at(-1) ?? ''
  return JSON.stringify({
    version: 1,
    drafts: [{ slot: `session:${newest}`, text: `Unsent words, ${when}.`, attached: [] }],
  })
}

function workspaceText(which: string): string {
  return JSON.stringify({ name: `The workspace, under ${which}` })
}

/** The state files a stretch of time leaves, by registry entry; null where it leaves none. */
function stateTextOf(file: AppStateFile, texts: StateTexts): string | null {
  if (file.name === 'drafts.json') return texts.drafts
  if (file.name === 'workspace.json') return texts.workspace
  return null
}

async function writeStateFiles(folder: string, texts: StateTexts): Promise<void> {
  for (const file of APP_STATE_FILES) {
    const text = stateTextOf(file, texts)
    if (text !== null) await writeFile(stateFile(folder, file), text, { mode: 0o600 })
  }
}

/** The real file system without its flushes to disk, which a fixture has no use for. */
const UNFLUSHED: RecoveryFs = {
  ...nodeFs,
  open: async (path, flags, mode) => {
    const handle = await nodeFs.open(path, flags, mode)
    return { ...handle, sync: () => Promise.resolve() }
  },
}

/**
 * A checkpoint made by the checkpoint writer, of the database as it stands. The writer runs on a
 * data folder of its own in the scratch folder, holding a copy of the database, this stretch's state
 * files and the workspace's id, and the folder it makes is then moved into `backups/`. The fault, if
 * any, is laid on it after, and its files are dated when it was made.
 */
async function checkpointByTheWriter(
  userData: string,
  scratch: string,
  source: AppDatabase,
  plan: PlannedCheckpoint,
  workspaceId: string,
  conversations: readonly string[],
  texts: StateTexts,
): Promise<FixtureCheckpoint> {
  const writing = await mkdtemp(join(scratch, 'writer-'))
  let made: Checkpoint
  try {
    await privateDir(backupsDir(writing))
    await writeFile(workspaceIdFile(writing), `${workspaceId}\n`, { mode: 0o600 })
    await source.backup(databaseFile(writing))
    await writeStateFiles(writing, texts)
    made = await writeACheckpoint({
      userData: writing,
      ownership: 'sole',
      appVersion: plan.appVersion,
      build: null,
      reason: plan.reason,
      fs: UNFLUSHED,
      now: () => Date.parse(plan.createdAt),
      freeBytes: () => null,
      log: () => undefined,
    })
    await moveFolder(made.folder, checkpointDir(userData, made.manifest.id))
  } finally {
    await rm(writing, { recursive: true, force: true })
  }

  const { id } = made.manifest
  const folder = checkpointDir(userData, id)
  const copy = checkpointDatabase(userData, id)
  let manifest = made.manifest
  if (plan.fault === 'another-workspace') {
    manifest = { ...manifest, workspaceId: randomUUID() }
    await writeAtomically(manifestFile(userData, id), serializeManifest(manifest))
  } else if (plan.fault === 'version-2') {
    const later = { ...manifest, version: 2 }
    await writeAtomically(manifestFile(userData, id), `${JSON.stringify(later, null, 2)}\n`)
  } else if (plan.fault === 'no-manifest') {
    await rm(manifestFile(userData, id))
    await writeFile(join(folder, UNFINISHED_FILE), '', { mode: 0o600 })
  } else if (plan.fault === 'copy-changed') {
    await flipLastByte(copy)
  }

  const madeAt = new Date(plan.createdAt)
  for (const name of await readdir(folder)) await utimes(join(folder, name), madeAt, madeAt)
  await utimes(folder, madeAt, madeAt)

  return {
    id,
    dir: folder,
    database: copy,
    migrations: plan.migrations,
    fault: plan.fault,
    manifest,
    conversations,
  }
}

/** Renames a folder, or copies it across when it is on another disk. */
async function moveFolder(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EXDEV') throw error
    await cp(from, to, { recursive: true })
    await rm(from, { recursive: true, force: true })
  }
}

async function flipLastByte(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try {
    const { size } = await handle.stat()
    const byte = new Uint8Array(1)
    await handle.read(byte, 0, 1, size - 1)
    byte[0] = (byte[0] ?? 0) ^ 0xff
    await handle.write(byte, 0, 1, size - 1)
  } finally {
    await handle.close()
  }
}

/**
 * A restore of `checkpoint`, run by the restore engine and stopped once `reach` is done: before the
 * next step begins, so the journal names `reach` and nothing of the next step has happened. A
 * journal left at `done` is the one the engine writes just before it removes it. A finished restore
 * has removed its journal.
 */
async function layRestore(
  userData: string,
  checkpoint: FixtureCheckpoint,
  reach: RestoreReach,
  now: number,
): Promise<FixtureRestore> {
  const id = randomUUID()
  const next = reach === 'finished' ? null : (STEPS[STEPS.indexOf(reach) + 1] ?? null)
  const stop = new Error(`the fixture stops this restore after ${reach}`)
  const hooks: StepHooks = {
    beforeStep: (step) => {
      if (step === next) throw stop
    },
  }
  // Left at `done`: the engine's own removal of the journal is what fails.
  const fs: RecoveryFs =
    reach === 'done'
      ? {
          ...nodeFs,
          rm: (path, options) =>
            path === journalFile(userData) ? Promise.reject(stop) : nodeFs.rm(path, options),
        }
      : nodeFs
  try {
    await restore({
      userData,
      checkpointId: checkpoint.id,
      canOpen: () => true,
      newId: () => id,
      now: () => new Date(now),
      fs,
      ...hooks,
    })
    if (reach !== 'finished') throw new Error(`the restore did not stop after ${reach}`)
  } catch (error) {
    if (!(error instanceof RestoreStopped) || error.cause !== stop) throw error
  }

  const journalText = await readFile(journalFile(userData), 'utf8').catch(() => null)
  const journal = journalText === null ? null : parseJournal(journalText)
  if (journal !== null && !journal.ok) throw new Error(journal.reason)
  const gateText = await readFile(gateFile(userData), 'utf8').catch(() => null)
  const gate = gateText === null ? null : parseGate(gateText)
  if (gate !== null && !gate.ok) throw new Error(gate.reason)
  return {
    id,
    checkpointId: checkpoint.id,
    journal: journal?.value ?? null,
    gate: gate?.value ?? null,
    staged: stagedDir(userData, id),
    preserved: preservedDir(userData, id),
  }
}
