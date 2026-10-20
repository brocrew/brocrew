import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import {
  parseGate,
  parseJournal,
  serializeGate,
  serializeManifest,
  STEPS,
  type CheckpointManifest,
  type HistoryOnlyGate,
  type ManifestFile,
  type Migration,
  type RestoreJournal,
  type Step,
} from '../../src/main/recovery/contract'
import { migrationsOf } from '../../src/main/recovery/database-facts'
import { nodeFs, type Moved, type RecoveryFs, type StepHooks } from '../../src/main/recovery/files'
import {
  CannotPutBack,
  ChangedOutside,
  readGateOnDisk,
  readJournalOnDisk,
  recoverInterrupted,
  restore,
  RestoreStopped,
  returnToNewer,
  sweepLeftovers,
  whatChangedSinceTheGate,
  type RestoreOptions,
} from '../../src/main/recovery/restore'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(here, '../../src/main/db/migrations')
const POSIX = process.platform !== 'win32'

const CHECKPOINT = '3f0c2b9e-5d1a-4c47-9a0e-6b1d2c3e4f50'
const RESTORE = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
const WORKSPACE = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f'
const ANOTHER = '0b1c2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e'
const CREATED_AT = '2026-10-01T09:00:00.000Z'

const COPY_AT = `backups/${CHECKPOINT}/database.sqlite`
const OLDER_DRAFTS_AT = `backups/${CHECKPOINT}/drafts.json`
const MANIFEST_AT = `backups/${CHECKPOINT}/manifest.json`
const GATE = 'recovery/history-only.json'
const JOURNAL = 'recovery/restore-journal.json'
const STAGED = `recovery/staged/${RESTORE}`
const PRESERVED = `recovery/preserved/${RESTORE}`
const RESTORED_ASIDE = `recovery/preserved/${RESTORE}-restored`

/** `size` bytes of `label`, repeated: a file whose content is its own. */
function filled(label: string, size: number): Buffer {
  const text = Buffer.from(`${label}\n`)
  return Buffer.from(Array.from({ length: size }, (_, i) => text[i % text.length] ?? 0))
}

// The engine never opens the live family, so its files need only bytes of their own. The
// database is larger than any head a cheap fingerprint would read.
const NEWER_DATABASE = filled('the newer database', 200_000)
const NEWER_SIDECAR: Readonly<Record<Sidecar, Buffer>> = {
  '-wal': filled('its -wal', 8_272),
  '-shm': filled('its -shm', 32_768),
  '-journal': filled('its -journal', 4_608),
}
const NEWER_DRAFTS = '{"version":1,"drafts":{"newer":"words not sent yet"}}\n'
const OLDER_DRAFTS = '{"version":1,"drafts":{"older":"words from before"}}\n'
const SIGN_INS_NOW = '{"version":1,"changed":{"claude":1790000000000}}\n'
const SIGN_INS_THEN = '{"version":1,"changed":{"claude":1780000000000}}\n'

type Sidecar = '-wal' | '-shm' | '-journal'

/** The checkpoint's copy: a database migrated as the app migrates its own, in rollback mode. */
let COPY: Buffer
/** This build's migrations as the copy records them, oldest first. */
let BUILD: readonly Migration[]

beforeAll(async () => {
  const folder = mkdtempSync(join(tmpdir(), 'brobot2-restore-copy-'))
  try {
    const file = join(folder, 'database.sqlite')
    const db = openDatabase(file)
    applyMigrations(db, MIGRATIONS)
    db.pragma('journal_mode = DELETE')
    db.close()
    COPY = readFileSync(file)
    const recorded = await migrationsOf(file)
    if (recorded.kind !== 'recorded') throw new Error(`the copy's migrations: ${recorded.kind}`)
    BUILD = recorded.migrations
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

/** This build's rule: the copy's migrations are this build's first ones, times and hashes alike. */
function canOpen(migrations: readonly Migration[]): boolean {
  return (
    migrations.length <= BUILD.length &&
    migrations.every(
      (one, index) => one.createdAt === BUILD[index]?.createdAt && one.hash === BUILD[index]?.hash,
    )
  )
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function sha(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function coded(code: string): Error {
  return Object.assign(new Error(`${code}: made up by the test`), { code })
}

interface Shape {
  /** The sidecars beside the live database. */
  readonly sidecars?: readonly Sidecar[]
  /** Whether the live data has a `drafts.json`. */
  readonly drafts?: boolean
  /** Whether the checkpoint holds a `drafts.json`. */
  readonly checkpointDrafts?: boolean
}

/** A data folder with a live database family that is newer than its one checkpoint. */
function aDataFolder(shape: Shape = {}): string {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-restore-'))
  roots.push(userData)
  writeFileSync(join(userData, 'brobot2.sqlite'), NEWER_DATABASE)
  for (const suffix of shape.sidecars ?? ['-wal', '-shm']) {
    writeFileSync(join(userData, `brobot2.sqlite${suffix}`), NEWER_SIDECAR[suffix])
  }
  if (shape.drafts !== false) writeFileSync(join(userData, 'drafts.json'), NEWER_DRAFTS)
  writeFileSync(join(userData, 'sign-in-changes.json'), SIGN_INS_NOW)

  mkdirSync(join(userData, 'backups', CHECKPOINT), { recursive: true })
  writeFileSync(join(userData, 'backups', 'workspace-id'), `${WORKSPACE}\n`)
  writeFileSync(join(userData, COPY_AT), COPY)
  writeFileSync(join(userData, 'backups', CHECKPOINT, 'sign-in-changes.json'), SIGN_INS_THEN)
  if (shape.checkpointDrafts !== false) writeFileSync(join(userData, OLDER_DRAFTS_AT), OLDER_DRAFTS)
  writeTheManifest(userData, {
    files: [
      shape.checkpointDrafts === false
        ? { name: 'drafts.json', present: false }
        : {
            name: 'drafts.json',
            present: true,
            bytes: Buffer.byteLength(OLDER_DRAFTS),
            sha256: sha(OLDER_DRAFTS),
          },
      {
        name: 'sign-in-changes.json',
        present: true,
        bytes: Buffer.byteLength(SIGN_INS_THEN),
        sha256: sha(SIGN_INS_THEN),
      },
    ],
  })
  return userData
}

/**
 * Writes the checkpoint's manifest as its writer would, from the copy as it now is, with its files
 * and migrations given or kept.
 */
function writeTheManifest(
  userData: string,
  changes: { readonly files?: readonly ManifestFile[]; readonly migrations?: readonly Migration[] },
): void {
  const path = join(userData, MANIFEST_AT)
  const old = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as CheckpointManifest)
    : undefined
  const copy = readFileSync(join(userData, COPY_AT))
  const manifest: CheckpointManifest = {
    format: 'brobot-checkpoint',
    version: 1,
    id: CHECKPOINT,
    createdAt: CREATED_AT,
    workspaceId: WORKSPACE,
    reason: 'before-migration',
    madeBy: { appVersion: '0.1.0', build: null },
    database: {
      file: 'database.sqlite',
      bytes: copy.length,
      sha256: sha(copy),
      migrations: changes.migrations ?? BUILD,
    },
    files: changes.files ?? old?.files ?? [],
  }
  writeFileSync(path, serializeManifest(manifest))
}

function restoring(userData: string, more: Partial<RestoreOptions> = {}): RestoreOptions {
  return { userData, checkpointId: CHECKPOINT, canOpen, newId: () => RESTORE, ...more }
}

/**
 * Every file under `root`, by its `/`-separated path, with the sha256 of its bytes. A link is
 * listed as one, and not followed.
 */
function filesIn(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      const name = relative(root, path).split(sep).join('/')
      if (entry.isSymbolicLink()) files[name] = 'a link'
      else if (entry.isDirectory()) walk(path)
      else files[name] = sha(readFileSync(path))
    }
  }
  walk(root)
  return files
}

interface Standing {
  readonly files: Record<string, string>
  readonly gate: unknown
}

/** The data folder's files apart from the gate, and the gate as read. */
function standing(userData: string): Standing {
  const { [GATE]: gate, ...files } = filesIn(userData)
  if (gate === undefined) return { files, gate: null }
  const parsed = parseGate(readFileSync(join(userData, GATE), 'utf8'))
  return { files, gate: parsed.ok ? parsed.value : `unreadable: ${parsed.reason}` }
}

/** The live files of a data folder made with no shape given, by path, with their hashes. */
const AS_MADE: Readonly<Record<string, string>> = {
  'brobot2.sqlite': sha(NEWER_DATABASE),
  'brobot2.sqlite-wal': sha(NEWER_SIDECAR['-wal']),
  'brobot2.sqlite-shm': sha(NEWER_SIDECAR['-shm']),
  'drafts.json': sha(NEWER_DRAFTS),
}

/** The gate a restore of the checkpoint writes, over live files that were as `before` lists. */
function theGate(
  checkpointDrafts = true,
  before: Record<string, string> = AS_MADE,
): HistoryOnlyGate {
  return {
    format: 'brobot-history-only',
    version: 1,
    restoreId: RESTORE,
    checkpointId: CHECKPOINT,
    checkpointCreatedAt: CREATED_AT,
    installed: [
      { live: 'brobot2.sqlite', present: true, sha256: sha(COPY) },
      { live: 'brobot2.sqlite-wal', present: false },
      { live: 'brobot2.sqlite-shm', present: false },
      { live: 'brobot2.sqlite-journal', present: false },
      { live: 'skills', present: false },
      { live: 'skills-off', present: false },
      { live: 'skills-conversion.json', present: false },
      checkpointDrafts
        ? { live: 'drafts.json', present: true, sha256: sha(OLDER_DRAFTS) }
        : { live: 'drafts.json', present: false },
      { live: 'archived.json', present: false },
      { live: 'profile-execution.json', present: false },
    ],
    preserved: PRESERVED,
    preservedFiles: SET_ASIDE.map(([live]) => {
      const hash = before[live]
      return hash === undefined ? { live, present: false } : { live, present: true, sha256: hash }
    }),
  }
}

/** Each live name a restore sets aside, with its name in a recovery folder. */
const SET_ASIDE: readonly (readonly [string, string])[] = [
  ['brobot2.sqlite', 'database.sqlite'],
  ['brobot2.sqlite-wal', 'database.sqlite-wal'],
  ['brobot2.sqlite-shm', 'database.sqlite-shm'],
  ['brobot2.sqlite-journal', 'database.sqlite-journal'],
  ['skills', 'skills'],
  ['skills-off', 'skills-off'],
  ['skills-conversion.json', 'skills-conversion.json'],
  ['drafts.json', 'drafts.json'],
  ['archived.json', 'archived.json'],
  ['profile-execution.json', 'profile-execution.json'],
]

function hashAt(files: Record<string, string>, path: string): string {
  const hash = files[path]
  if (hash === undefined) throw new Error(`${path} is not in the data folder`)
  return hash
}

function asItWas(before: Record<string, string>): Standing {
  return { files: before, gate: null }
}

/** `before` after a finished restore: every participant checked by its bytes' hash. */
function restoredFrom(before: Record<string, string>): Standing {
  const files = Object.fromEntries(
    Object.entries(before).filter(([path]) => !SET_ASIDE.some(([live]) => live === path)),
  )
  for (const [live, kept] of SET_ASIDE) {
    const hash = before[live]
    if (hash !== undefined) files[`${PRESERVED}/${kept}`] = hash
  }
  files['brobot2.sqlite'] = hashAt(before, COPY_AT)
  const drafts = before[OLDER_DRAFTS_AT]
  if (drafts !== undefined) files['drafts.json'] = drafts
  return { files, gate: theGate(drafts !== undefined, before) }
}

/** `before` after a finished restore and return: all as it was, and the restored copy kept aside. */
function returnedFrom(before: Record<string, string>): Standing {
  const files = { ...before }
  files[`${RESTORED_ASIDE}/database.sqlite`] = hashAt(before, COPY_AT)
  const drafts = before[OLDER_DRAFTS_AT]
  if (drafts !== undefined) files[`${RESTORED_ASIDE}/drafts.json`] = drafts
  return { files, gate: null }
}

/** Where a test stops a restore or a return: before or after a step, or after one rename. */
type Fault =
  | { readonly at: Step; readonly after?: boolean }
  | { readonly move: string; readonly to: Moved['to'] }

function said(fault: Fault): string {
  return 'at' in fault
    ? `${fault.after === true ? 'after' : 'before'} ${fault.at}`
    : `after moving ${fault.move} to ${fault.to}`
}

/** Hooks that throw a coded error once, at `fault`, as a stop at that point would. */
function stoppingAt(fault: Fault, code = 'EBUSY'): StepHooks {
  let fired = false
  const fire = (): never => {
    fired = true
    throw coded(code)
  }
  return {
    beforeStep: (step) => {
      if (!fired && 'at' in fault && fault.after !== true && step === fault.at) fire()
    },
    afterStep: (step) => {
      if (!fired && 'at' in fault && fault.after === true && step === fault.at) fire()
    },
    afterMove: (moved) => {
      if (!fired && 'move' in fault && moved.live === fault.move && moved.to === fault.to) fire()
    },
  }
}

/** Hooks that stop at `step` every time it is reached. */
function alwaysStoppingBefore(step: Step, code = 'EBUSY'): StepHooks {
  return {
    beforeStep: (reached) => {
      if (reached === step) throw coded(code)
    },
  }
}

async function stoppedBy(work: Promise<unknown>): Promise<RestoreStopped> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(RestoreStopped)
  return error as RestoreStopped
}

/** The step the journal on disk names, or null with none. */
function journalStep(userData: string): string | null {
  const path = join(userData, JOURNAL)
  if (!existsSync(path)) return null
  const parsed = parseJournal(readFileSync(path, 'utf8'))
  return parsed.ok ? parsed.value.step : `unreadable: ${parsed.reason}`
}

function theJournal(userData: string): RestoreJournal {
  const parsed = parseJournal(readFileSync(join(userData, JOURNAL), 'utf8'))
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

/**
 * The real file system without its flushes to disk. A stop simulated in this process cannot tell
 * them apart, and they make the hundreds of runs below slow.
 */
const UNFLUSHED: RecoveryFs = {
  ...nodeFs,
  open: async (path, flags, mode) => {
    const handle = await nodeFs.open(path, flags, mode)
    return { ...handle, sync: () => Promise.resolve() }
  },
}

/**
 * A file system that dies at its `at`-th change: that change and every one after it fail, as if the
 * process had stopped there. Reads go on working.
 */
function dyingAt(at: number): { readonly fs: RecoveryFs; readonly changes: () => number } {
  const real = UNFLUSHED
  let changes = 0
  const change = <T>(op: () => Promise<T>): Promise<T> => {
    changes += 1
    return changes >= at ? Promise.reject(coded('ECRASH')) : op()
  }
  const fs: RecoveryFs = {
    ...real,
    rename: (from, to) => change(() => real.rename(from, to)),
    copyFile: (from, to, mode) => change(() => real.copyFile(from, to, mode)),
    link: (existing, name) => change(() => real.link(existing, name)),
    unlink: (path) => change(() => real.unlink(path)),
    rm: (path, options) => change(() => real.rm(path, options)),
    mkdir: (path, options) => change(() => real.mkdir(path, options)),
    mkdtemp: (prefix) => change(() => real.mkdtemp(prefix)),
    writeFile: (path, data, options) => change(() => real.writeFile(path, data, options)),
    chmod: (path, mode) => change(() => real.chmod(path, mode)),
    open: async (path, flags, mode) => {
      if (flags === 'r') return real.open(path, flags, mode)
      const handle = await change(() => real.open(path, flags, mode))
      return { ...handle, writeFile: (data) => change(() => handle.writeFile(data)) }
    },
  }
  return { fs, changes: () => changes }
}

/** A file system whose renames fail with `code` when `when` says so. */
function renamesFailing(code: string, when: (from: string, to: string) => boolean): RecoveryFs {
  return {
    ...UNFLUSHED,
    rename: (from, to) =>
      when(from, to) ? Promise.reject(coded(code)) : UNFLUSHED.rename(from, to),
  }
}

/** Removes a data folder at once, for loops that make hundreds of them. */
function throwAway(userData: string): void {
  rmSync(userData, { recursive: true, force: true })
  roots.splice(roots.indexOf(userData), 1)
}

function flipAByte(path: string, at = 200): void {
  const bytes = readFileSync(path)
  bytes[at] = (bytes[at] ?? 0) ^ 0xff
  writeFileSync(path, bytes)
}

function rewriteTheJournal(
  userData: string,
  change: (record: Record<string, unknown>) => void,
): void {
  const path = join(userData, JOURNAL)
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  change(record)
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
}

/** Whether this system lets the test make a symbolic link to a folder. */
function canLink(): boolean {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-restore-link-'))
  try {
    mkdirSync(join(root, 'target'))
    symlinkSync(join(root, 'target'), join(root, 'link'), 'junction')
    return true
  } catch {
    return false
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const LINKS = canLink()

/** Whether this system lets the test make a symbolic link to a file (Windows may need a right). */
function canLinkAFile(): boolean {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-restore-link-'))
  try {
    writeFileSync(join(root, 'target'), 'x')
    symlinkSync(join(root, 'target'), join(root, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const FILE_LINKS = canLinkAFile()

/** The shapes each boundary is stopped in: drafts each way, and each sidecar. */
const SHAPES: readonly (readonly [string, Shape])[] = [
  ['drafts on both sides, a -wal and a -shm', {}],
  [
    'drafts only in the copy, and a -journal',
    { drafts: false, checkpointDrafts: true, sidecars: ['-journal'] },
  ],
  ['drafts only live, and no sidecar', { drafts: true, checkpointDrafts: false, sidecars: [] }],
  [
    'no drafts on either side, and all three sidecars',
    { drafts: false, checkpointDrafts: false, sidecars: ['-wal', '-shm', '-journal'] },
  ],
]

/** Every rename a clean run of `work` makes, in order. */
async function movesIn(work: (hooks: StepHooks) => Promise<unknown>): Promise<Moved[]> {
  const moves: Moved[] = []
  await work({ afterMove: (moved) => moves.push(moved) })
  return moves
}

/** Every point a restore or return can be stopped at: each side of each step, and each rename. */
function faultsWith(moves: readonly Moved[]): Fault[] {
  return [
    ...STEPS.flatMap((at) => [{ at }, { at, after: true }]),
    ...moves.map(({ live, to }) => ({ move: live, to })),
  ]
}

/** The step the journal names when a run is stopped at `fault`: the one before it. */
function stepBefore(fault: Fault): Step | null {
  if (!('at' in fault)) return null
  const index = STEPS.indexOf(fault.at)
  return index === 0 ? null : (STEPS[index - 1] ?? null)
}

describe('restore', () => {
  it('installs the copy and its drafts behind the gate, and sets the newer family and drafts aside together', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    const restored = await restore(restoring(userData))
    expect(restored).toEqual({ gate: theGate(), database: join(userData, 'brobot2.sqlite') })
    expect(standing(userData)).toEqual(restoredFrom(before))
    expect(readdirSync(join(userData, 'recovery')).sort()).toEqual([
      'history-only.json',
      'preserved',
    ])
    if (POSIX) {
      expect(statSync(join(userData, 'brobot2.sqlite')).mode & 0o777).toBe(0o600)
      expect(statSync(join(userData, 'drafts.json')).mode & 0o777).toBe(0o600)
      expect(statSync(join(userData, GATE)).mode & 0o777).toBe(0o600)
      expect(statSync(join(userData, 'recovery')).mode & 0o777).toBe(0o700)
      expect(statSync(join(userData, PRESERVED)).mode & 0o777).toBe(0o700)
    }
  })

  it('records every participant’s place and full hash before and after, in its plan', async () => {
    const userData = aDataFolder({ sidecars: ['-wal'] })
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'staged' }))))
    const journal = theJournal(userData)
    expect(journal).toMatchObject({ id: RESTORE, kind: 'restore', step: 'planned' })
    expect(journal.participants).toEqual([
      {
        live: 'brobot2.sqlite',
        role: 'database',
        aside: `${PRESERVED}/database.sqlite`,
        incoming: `${STAGED}/database.sqlite`,
        was: { present: true, sha256: sha(NEWER_DATABASE) },
        becomes: { present: true, sha256: sha(COPY) },
      },
      {
        live: 'brobot2.sqlite-wal',
        role: 'sidecar',
        aside: `${PRESERVED}/database.sqlite-wal`,
        incoming: `${STAGED}/database.sqlite-wal`,
        was: { present: true, sha256: sha(NEWER_SIDECAR['-wal']) },
        becomes: { present: false },
      },
      {
        live: 'brobot2.sqlite-shm',
        role: 'sidecar',
        aside: `${PRESERVED}/database.sqlite-shm`,
        incoming: `${STAGED}/database.sqlite-shm`,
        was: { present: false },
        becomes: { present: false },
      },
      {
        live: 'brobot2.sqlite-journal',
        role: 'sidecar',
        aside: `${PRESERVED}/database.sqlite-journal`,
        incoming: `${STAGED}/database.sqlite-journal`,
        was: { present: false },
        becomes: { present: false },
      },
      {
        live: 'skills',
        role: 'state',
        aside: `${PRESERVED}/skills`,
        incoming: `${STAGED}/skills`,
        was: { present: false },
        becomes: { present: false },
      },
      {
        live: 'skills-off',
        role: 'state',
        aside: `${PRESERVED}/skills-off`,
        incoming: `${STAGED}/skills-off`,
        was: { present: false },
        becomes: { present: false },
      },
      {
        live: 'skills-conversion.json',
        role: 'state',
        aside: `${PRESERVED}/skills-conversion.json`,
        incoming: `${STAGED}/skills-conversion.json`,
        was: { present: false },
        becomes: { present: false },
      },
      {
        live: 'drafts.json',
        role: 'state',
        aside: `${PRESERVED}/drafts.json`,
        incoming: `${STAGED}/drafts.json`,
        was: { present: true, sha256: sha(NEWER_DRAFTS) },
        becomes: { present: true, sha256: sha(OLDER_DRAFTS) },
      },
      {
        live: 'archived.json',
        role: 'state',
        aside: `${PRESERVED}/archived.json`,
        incoming: `${STAGED}/archived.json`,
        was: { present: false },
        becomes: { present: false },
      },
      {
        live: 'profile-execution.json',
        role: 'state',
        aside: `${PRESERVED}/profile-execution.json`,
        incoming: `${STAGED}/profile-execution.json`,
        was: { present: false },
        becomes: { present: false },
      },
    ])
  })

  it('reports its progress from the start, once per step, up to its total', async () => {
    const userData = aDataFolder()
    const seen: [number, number][] = []
    await restore(restoring(userData, { progress: (done, total) => seen.push([done, total]) }))
    expect(seen).toEqual(STEPS.map((_, index) => [index, STEPS.length]).concat([[6, 6]]))
  })

  it('goes on when the window it reports to has gone', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await restore(
      restoring(userData, {
        progress: () => {
          throw new Error('the window was closed')
        },
      }),
    )
    expect(standing(userData)).toEqual(restoredFrom(before))
  })

  describe('refuses, and changes nothing, for', () => {
    const cases: readonly [
      string,
      (userData: string) => void,
      () => Partial<RestoreOptions>,
      RegExp,
    ][] = [
      [
        'a copy whose bytes no longer match its manifest',
        (userData) => flipAByte(join(userData, COPY_AT)),
        () => ({}),
        /did not pass its check/,
      ],
      [
        'a copy whose drafts no longer match its manifest',
        (userData) => writeFileSync(join(userData, OLDER_DRAFTS_AT), '{"version":1,"drafts":{}}\n'),
        () => ({}),
        /did not pass its check/,
      ],
      [
        'a copy whose drafts are gone',
        (userData) => rmSync(join(userData, OLDER_DRAFTS_AT)),
        () => ({}),
        /did not pass its check/,
      ],
      [
        'a copy whose migrations are not the ones its manifest lists',
        (userData) => writeTheManifest(userData, { migrations: BUILD.slice(0, -1) }),
        () => ({}),
        /did not pass its check/,
      ],
      [
        'a copy whose migration hashes are not the ones its manifest lists',
        (userData) =>
          writeTheManifest(userData, {
            migrations: BUILD.map((one, index) => (index === 2 ? { ...one, hash: sha('x') } : one)),
          }),
        () => ({ canOpen: () => true }),
        /did not pass its check/,
      ],
      [
        'a copy that is not a single rollback-mode file',
        (userData) => {
          const bytes = Buffer.from(COPY)
          bytes[18] = 2
          bytes[19] = 2
          writeFileSync(join(userData, COPY_AT), bytes)
          writeTheManifest(userData, {})
        },
        () => ({}),
        /did not pass its check/,
      ],
      [
        'a copy made for another workspace',
        (userData) => writeFileSync(join(userData, 'backups', 'workspace-id'), `${ANOTHER}\n`),
        () => ({}),
        /another workspace/,
      ],
      [
        'a workspace id that is not one BroBot made',
        (userData) => writeFileSync(join(userData, 'backups', 'workspace-id'), 'another-one\n'),
        () => ({}),
        /another workspace/,
      ],
      [
        'a copy past this build’s migrations',
        () => undefined,
        () => ({ canOpen: () => false }),
        /needs a newer version of BroCrew/,
      ],
      [
        'a copy that is not there',
        () => undefined,
        () => ({ checkpointId: ANOTHER }),
        /did not find/,
      ],
      [
        'a copy named by something other than an id BroBot made',
        () => undefined,
        () => ({ checkpointId: 'CON' }),
        /did not find/,
      ],
      [
        'a data folder with no database',
        (userData) => rmSync(join(userData, 'brobot2.sqlite')),
        () => ({}),
        /no database to set aside/,
      ],
      [
        'data that is already a restored copy',
        (userData) => {
          mkdirSync(join(userData, 'recovery'))
          writeFileSync(
            join(userData, GATE),
            serializeGate({
              ...theGate(),
              restoreId: ANOTHER,
              preserved: `recovery/preserved/${ANOTHER}`,
            }),
          )
        },
        () => ({}),
        /already a restored copy/,
      ],
      [
        'data with a restore still unfinished',
        (userData) => {
          mkdirSync(join(userData, 'recovery'))
          writeFileSync(join(userData, JOURNAL), 'whatever it holds')
        },
        () => ({}),
        /still unfinished/,
      ],
    ]

    it.each(cases)('%s', async (_, arrange, more, refusal) => {
      const userData = aDataFolder()
      arrange(userData)
      const before = filesIn(userData)
      const hadRecovery = existsSync(join(userData, 'recovery'))
      const stopped = await stoppedBy(restore(restoring(userData, more())))
      expect(stopped.message).toMatch(refusal)
      expect(stopped).toMatchObject({ during: 'restore', journalLeft: false, canRetry: false })
      expect(filesIn(userData)).toEqual(before)
      expect(existsSync(join(userData, 'recovery'))).toBe(hadRecovery)
    })
  })

  it('leaves its journal when the disk fills as it stages, and recovery puts nothing out of place', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    const full: RecoveryFs = { ...UNFLUSHED, copyFile: () => Promise.reject(coded('ENOSPC')) }
    const stopped = await stoppedBy(restore(restoring(userData, { fs: full })))
    expect(stopped).toMatchObject({ during: 'restore', journalLeft: true, canRetry: true })
    expect(stopped.message).toContain('ENOSPC')
    expect(journalStep(userData)).toBe('planned')
    expect(await recoverInterrupted({ userData })).toMatchObject({
      kind: 'rolled-back',
      what: 'restore',
    })
    expect(standing(userData)).toEqual(asItWas(before))
  })
})

describe('drafts.json and each sidecar, restored and returned', () => {
  it.each(SHAPES)('%s: restored, then returned, byte for byte', async (_, shape) => {
    const userData = aDataFolder(shape)
    const before = filesIn(userData)
    await restore(restoring(userData))
    expect(standing(userData)).toEqual(restoredFrom(before))
    expect(existsSync(join(userData, 'drafts.json'))).toBe(shape.checkpointDrafts !== false)
    for (const suffix of ['-wal', '-shm', '-journal']) {
      expect(existsSync(join(userData, `brobot2.sqlite${suffix}`))).toBe(false)
    }
    await returnToNewer({ userData })
    expect(standing(userData)).toEqual(returnedFrom(before))
    expect(existsSync(join(userData, PRESERVED))).toBe(false)
  })
})

describe('a restore stopped at any boundary, then recovered', () => {
  for (const [name, shape] of SHAPES) {
    it(`ends restored or as it was, and stays so (${name})`, async () => {
      const moves = await movesIn((hooks) => restore(restoring(aDataFolder(shape), hooks)))
      expect(moves.map(({ to }) => to)).toContain('aside')
      expect(moves.map(({ to }) => to)).toContain('live')
      for (const fault of faultsWith(moves)) {
        const userData = aDataFolder(shape)
        const before = filesIn(userData)
        const stopped = await stoppedBy(restore(restoring(userData, stoppingAt(fault))))
        expect(stopped.message, said(fault)).toContain('EBUSY')
        expect(stopped.canRetry, said(fault)).toBe(true)
        if ('at' in fault) expect(journalStep(userData), said(fault)).toBe(stepBefore(fault))

        const recovered = await recoverInterrupted({ userData, fs: UNFLUSHED })
        // Until the journal names `staged`, the copy was never confirmed checked.
        const notBegun = 'at' in fault && (fault.at === 'planned' || fault.at === 'staged')
        if (notBegun) {
          expect(recovered.kind, said(fault)).toBe(
            fault.at === 'planned' ? 'nothing-to-do' : 'rolled-back',
          )
          expect(standing(userData), said(fault)).toEqual(asItWas(before))
        } else {
          expect(recovered, said(fault)).toEqual({ kind: 'finished', what: 'restore' })
          expect(standing(userData), said(fault)).toEqual(restoredFrom(before))
        }
        const settled = filesIn(userData)
        expect(await recoverInterrupted({ userData })).toEqual({ kind: 'nothing-to-do' })
        expect(filesIn(userData), said(fault)).toEqual(settled)
        throwAway(userData)
      }
    })
  }

  it.each(['ENOSPC', 'EACCES'])('carries a %s from the step that failed', async (code) => {
    const userData = aDataFolder()
    const stopped = await stoppedBy(
      restore(restoring(userData, stoppingAt({ at: 'moving' }, code))),
    )
    expect(stopped).toMatchObject({ journalLeft: true, canRetry: true })
    expect(stopped.message).toContain(code)
  })

  it('stays unfinished while the same step keeps failing, and finishes once it does not', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    const failing = alwaysStoppingBefore('installed')
    await stoppedBy(restore(restoring(userData, failing)))
    const again = await stoppedBy(recoverInterrupted({ userData, ...failing }))
    expect(again).toMatchObject({ during: 'restore', journalLeft: true, canRetry: true })
    expect(existsSync(join(userData, JOURNAL))).toBe(true)
    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'finished', what: 'restore' })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })

  it('is finished from a journal that names done with its staged folder gone', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'done', after: true }))))
    expect(existsSync(join(userData, STAGED))).toBe(false)
    rewriteTheJournal(userData, (journal) => {
      journal.step = 'done'
    })
    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'finished', what: 'restore' })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })
})

describe('a return stopped at any boundary, then recovered', () => {
  for (const [name, shape] of SHAPES) {
    it(`ends returned or still restored, and stays so (${name})`, async () => {
      const moves = await movesIn(async (hooks) => {
        const userData = aDataFolder(shape)
        await restore(restoring(userData, { fs: UNFLUSHED }))
        await returnToNewer({ userData, ...hooks })
      })
      for (const fault of faultsWith(moves)) {
        const userData = aDataFolder(shape)
        const before = filesIn(userData)
        await restore(restoring(userData, { fs: UNFLUSHED }))
        const stopped = await stoppedBy(returnToNewer({ userData, ...stoppingAt(fault) }))
        expect(stopped.message, said(fault)).toContain('EBUSY')
        if ('at' in fault) expect(journalStep(userData), said(fault)).toBe(stepBefore(fault))

        const recovered = await recoverInterrupted({ userData, fs: UNFLUSHED })
        if ('at' in fault && fault.at === 'planned') {
          expect(recovered, said(fault)).toEqual({ kind: 'nothing-to-do' })
          expect(standing(userData), said(fault)).toEqual(restoredFrom(before))
        } else {
          expect(recovered, said(fault)).toEqual({ kind: 'finished', what: 'return' })
          expect(standing(userData), said(fault)).toEqual(returnedFrom(before))
        }
        expect(await recoverInterrupted({ userData })).toEqual({ kind: 'nothing-to-do' })
        throwAway(userData)
      }
    })
  }
})

describe('a restore that stops after any one change to the disk', () => {
  /** How many changes a whole restore makes. */
  async function changesInARestore(): Promise<number> {
    const counting = dyingAt(Number.POSITIVE_INFINITY)
    const userData = aDataFolder()
    await restore(restoring(userData, { fs: counting.fs }))
    throwAway(userData)
    return counting.changes()
  }

  /** Runs a restore that dies at change `at`; it stops, or finishes when only a clean-up failed. */
  async function aRestoreDyingAt(userData: string, at: number): Promise<void> {
    await restore(restoring(userData, { fs: dyingAt(at).fs })).catch((error: unknown) => {
      expect(error).toBeInstanceOf(RestoreStopped)
    })
  }

  it(
    'ends, after recoverInterrupted, restored behind its gate or exactly as it was',
    { timeout: 300_000 },
    async () => {
      const total = await changesInARestore()
      expect(total).toBeGreaterThan(20)
      const outcomes = new Set<string>()
      for (let at = 1; at <= total; at += 1) {
        const userData = aDataFolder()
        const before = filesIn(userData)
        await aRestoreDyingAt(userData, at)
        const journal = existsSync(join(userData, JOURNAL))
        const gate = existsSync(join(userData, GATE))
        const recovered = await recoverInterrupted({ userData, fs: UNFLUSHED })
        const end = standing(userData)
        const where = `stopped at change ${String(at)} of ${String(total)}`
        expect([restoredFrom(before), asItWas(before)], where).toContainEqual(end)
        if (gate) expect(end, where).toEqual(restoredFrom(before))
        if (!journal && !gate) expect(end, where).toEqual(asItWas(before))
        expect(existsSync(join(userData, JOURNAL)), where).toBe(false)
        const ended = isDeepStrictEqual(end, restoredFrom(before)) ? 'restored' : 'as it was'
        outcomes.add(`${recovered.kind}, ${ended}`)
        throwAway(userData)
      }
      expect([...outcomes]).toEqual(
        expect.arrayContaining([
          'finished, restored',
          'rolled-back, as it was',
          'nothing-to-do, as it was',
        ]),
      )
    },
  )

  it(
    'and when the recovery itself stops after any one change, the next recovery ends where an unbroken one would',
    { timeout: 600_000 },
    async () => {
      const total = await changesInARestore()
      let recoveries = 0
      for (let at = 1; at <= total; at += 1) {
        const reference = aDataFolder()
        await aRestoreDyingAt(reference, at)
        const leftAJournal = existsSync(join(reference, JOURNAL))
        await recoverInterrupted({ userData: reference, fs: UNFLUSHED })
        const expected = standing(reference)
        throwAway(reference)
        if (!leftAJournal) continue
        for (let dies = 1; ; dies += 1) {
          const userData = aDataFolder()
          await aRestoreDyingAt(userData, at)
          const recovery = dyingAt(dies)
          const finished = await recoverInterrupted({ userData, fs: recovery.fs }).then(
            () => true,
            (error: unknown) => {
              expect(error).toBeInstanceOf(RestoreStopped)
              return false
            },
          )
          await recoverInterrupted({ userData, fs: UNFLUSHED })
          const where = `restore stopped at change ${String(at)}, recovery at change ${String(dies)}`
          expect(standing(userData), where).toEqual(expected)
          throwAway(userData)
          recoveries += 1
          if (finished && recovery.changes() < dies) break
        }
      }
      expect(recoveries).toBeGreaterThan(total)
    },
  )
})

describe('a return that stops after any one change to the disk', () => {
  /** A data folder restored, and a return that dies at change `at`. */
  async function aReturnDyingAt(
    at: number,
  ): Promise<{ userData: string; before: Record<string, string> }> {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await restore(restoring(userData, { fs: UNFLUSHED }))
    await returnToNewer({ userData, fs: dyingAt(at).fs }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(RestoreStopped)
    })
    return { userData, before }
  }

  async function changesInAReturn(): Promise<number> {
    const counting = dyingAt(Number.POSITIVE_INFINITY)
    const userData = aDataFolder()
    await restore(restoring(userData, { fs: UNFLUSHED }))
    await returnToNewer({ userData, fs: counting.fs })
    throwAway(userData)
    return counting.changes()
  }

  it(
    'ends returned, or still restored, after it stops at any one change',
    { timeout: 300_000 },
    async () => {
      const total = await changesInAReturn()
      expect(total).toBeGreaterThan(10)
      for (let at = 1; at <= total; at += 1) {
        const { userData, before } = await aReturnDyingAt(at)
        const underway = existsSync(join(userData, JOURNAL)) || !existsSync(join(userData, GATE))
        await recoverInterrupted({ userData, fs: UNFLUSHED })
        expect(standing(userData), `stopped at change ${String(at)} of ${String(total)}`).toEqual(
          underway ? returnedFrom(before) : restoredFrom(before),
        )
        throwAway(userData)
      }
    },
  )

  it(
    'and when the recovery itself stops after any one change, the next recovery ends returned',
    { timeout: 600_000 },
    async () => {
      const total = await changesInAReturn()
      let recoveries = 0
      for (let at = 1; at <= total; at += 1) {
        for (let dies = 1; ; dies += 1) {
          const { userData, before } = await aReturnDyingAt(at)
          if (!existsSync(join(userData, JOURNAL))) {
            throwAway(userData)
            break
          }
          const recovery = dyingAt(dies)
          const finished = await recoverInterrupted({ userData, fs: recovery.fs }).then(
            () => true,
            (error: unknown) => {
              expect(error).toBeInstanceOf(RestoreStopped)
              return false
            },
          )
          await recoverInterrupted({ userData, fs: UNFLUSHED })
          const where = `return stopped at change ${String(at)}, recovery at change ${String(dies)}`
          expect(standing(userData), where).toEqual(returnedFrom(before))
          throwAway(userData)
          recoveries += 1
          if (finished && recovery.changes() < dies) break
        }
      }
      expect(recoveries).toBeGreaterThan(total)
    },
  )
})

describe('replacements that no longer pass their check', () => {
  it.each(['gate-installed', 'moving'] as const)(
    'a staged copy changed after a restore stopped before %s has every file put back as it was',
    async (step) => {
      const userData = aDataFolder()
      const before = filesIn(userData)
      await stoppedBy(restore(restoring(userData, stoppingAt({ at: step }))))
      flipAByte(join(userData, STAGED, 'database.sqlite'))
      expect(await recoverInterrupted({ userData })).toMatchObject({
        kind: 'rolled-back',
        what: 'restore',
      })
      expect(standing(userData)).toEqual(asItWas(before))
    },
  )

  it('a staged drafts.json changed after the copy was installed has the copy taken back out too', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(
      restore(restoring(userData, stoppingAt({ move: 'brobot2.sqlite', to: 'live' }))),
    )
    writeFileSync(join(userData, STAGED, 'drafts.json'), '{"changed":true}\n')
    const recovered = await recoverInterrupted({ userData })
    expect(recovered).toMatchObject({ kind: 'rolled-back' })
    expect(recovered.kind === 'rolled-back' && recovered.detail).toContain('drafts.json')
    expect(standing(userData)).toEqual(asItWas(before))
  })

  it('a restore whose journal never named staged is put back, even with every staged file whole', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'staged', after: true }))))
    expect(journalStep(userData)).toBe('planned')
    expect(readFileSync(join(userData, STAGED, 'database.sqlite'))).toEqual(COPY)
    const recovered = await recoverInterrupted({ userData })
    expect(recovered).toMatchObject({ kind: 'rolled-back', what: 'restore' })
    expect(recovered.kind === 'rolled-back' && recovered.detail).toContain('had been checked')
    expect(standing(userData)).toEqual(asItWas(before))
  })

  it('a staged copy that is gone has every file put back as it was', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    rmSync(join(userData, 'recovery', 'staged'), { recursive: true })
    expect(await recoverInterrupted({ userData })).toMatchObject({ kind: 'rolled-back' })
    expect(standing(userData)).toEqual(asItWas(before))
  })

  it('a restore whose gate is still to be written takes its date from the manifest', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'gate-installed' }))))
    expect(existsSync(join(userData, GATE))).toBe(false)
    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'finished', what: 'restore' })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })

  it('and has every file put back when the manifest is gone too', async () => {
    const userData = aDataFolder()
    const before = Object.fromEntries(
      Object.entries(filesIn(userData)).filter(([path]) => path !== MANIFEST_AT),
    )
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'gate-installed' }))))
    rmSync(join(userData, MANIFEST_AT))
    expect(await recoverInterrupted({ userData })).toMatchObject({ kind: 'rolled-back' })
    expect(standing(userData)).toEqual(asItWas(before))
  })
})

describe('data changed outside BroCrew while a restore was unfinished', () => {
  /** A restore stopped at `fault`, then the change; recovery must report it and touch nothing. */
  async function reportedAndUntouched(
    fault: Fault,
    change: (userData: string) => void,
    shape: Shape = {},
  ): Promise<void> {
    const userData = aDataFolder(shape)
    await stoppedBy(restore(restoring(userData, stoppingAt(fault))))
    change(userData)
    const before = filesIn(userData)
    const recovered = await recoverInterrupted({ userData })
    expect(recovered, said(fault)).toMatchObject({ kind: 'replaced-outside', where: 'journal' })
    expect(filesIn(userData), said(fault)).toEqual(before)
  }

  it.each([
    { at: 'gate-installed' },
    { at: 'moving' },
    { at: 'installed' },
    { at: 'done' },
  ] as const)('a different brobot2.sqlite written in place, stopped $at', async (fault) => {
    await reportedAndUntouched(fault, (userData) =>
      writeFileSync(join(userData, 'brobot2.sqlite'), filled('a database from elsewhere', 20_480)),
    )
  })

  it('a -wal changed and nothing else, before anything moved', async () => {
    await reportedAndUntouched({ at: 'moving' }, (userData) =>
      writeFileSync(join(userData, 'brobot2.sqlite-wal'), filled('a -wal from elsewhere', 8_272)),
    )
  })

  it('a -wal changed and nothing else, after it was set aside', async () => {
    await reportedAndUntouched({ move: 'brobot2.sqlite-wal', to: 'aside' }, (userData) =>
      writeFileSync(
        join(userData, PRESERVED, 'database.sqlite-wal'),
        filled('a -wal from elsewhere', 8_272),
      ),
    )
  })

  it('a -wal that appeared where there was none', async () => {
    await reportedAndUntouched(
      { at: 'moving' },
      (userData) =>
        writeFileSync(join(userData, 'brobot2.sqlite-wal'), filled('a -wal from elsewhere', 4_152)),
      { sidecars: [] },
    )
  })

  it('a database with the same size, time and first bytes, and another last byte', async () => {
    await reportedAndUntouched({ at: 'moving' }, (userData) => {
      const live = join(userData, 'brobot2.sqlite')
      const { atime, mtime } = statSync(live)
      flipAByte(live, NEWER_DATABASE.length - 1)
      utimesSync(live, atime, mtime)
      expect(statSync(live).size).toBe(NEWER_DATABASE.length)
    })
  })

  it('the same tail change to the database already set aside', async () => {
    await reportedAndUntouched({ move: 'brobot2.sqlite', to: 'aside' }, (userData) => {
      const aside = join(userData, PRESERVED, 'database.sqlite')
      const { atime, mtime } = statSync(aside)
      flipAByte(aside, NEWER_DATABASE.length - 1)
      utimesSync(aside, atime, mtime)
    })
  })

  it('a drafts.json changed before it moved', async () => {
    await reportedAndUntouched({ at: 'moving' }, (userData) =>
      writeFileSync(join(userData, 'drafts.json'), '{"version":1,"drafts":{}}\n'),
    )
  })

  it('a -wal written beside the installed copy', async () => {
    await reportedAndUntouched({ at: 'done' }, (userData) =>
      writeFileSync(join(userData, 'brobot2.sqlite-wal'), filled('a -wal from elsewhere', 4_152)),
    )
  })

  it('a set-aside database that is gone, with no empty database made', async () => {
    await reportedAndUntouched({ at: 'installed' }, (userData) => {
      rmSync(join(userData, PRESERVED, 'database.sqlite'))
      rmSync(join(userData, 'brobot2.sqlite'))
    })
  })

  it('a gate of another restore', async () => {
    await reportedAndUntouched({ at: 'moving' }, (userData) =>
      writeFileSync(
        join(userData, GATE),
        serializeGate({
          ...theGate(),
          restoreId: ANOTHER,
          preserved: `recovery/preserved/${ANOTHER}`,
        }),
      ),
    )
  })

  it('a gate removed once files had moved', async () => {
    await reportedAndUntouched({ move: 'brobot2.sqlite', to: 'aside' }, (userData) =>
      rmSync(join(userData, GATE)),
    )
  })

  it('a gate whose set-aside files are not the ones the journal found', async () => {
    await reportedAndUntouched({ at: 'moving' }, (userData) => {
      const gate = theGate()
      writeFileSync(
        join(userData, GATE),
        serializeGate({
          ...gate,
          preservedFiles: gate.preservedFiles.map((entry) =>
            entry.live === 'brobot2.sqlite-wal' ? { live: entry.live, present: false } : entry,
          ),
        }),
      )
    })
  })

  it.each([
    ['not JSON', 'not a record'],
    ['of a later version', JSON.stringify({ format: 'brobot-restore', version: 2 })],
  ])('a journal that is %s is reported as unreadable, and nothing is touched', async (_, text) => {
    const userData = aDataFolder()
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'installed' }))))
    writeFileSync(join(userData, JOURNAL), text)
    const before = filesIn(userData)
    expect(await recoverInterrupted({ userData })).toMatchObject({ kind: 'unreadable' })
    expect(filesIn(userData)).toEqual(before)
  })

  it('a journal naming a place outside its folders is unreadable, and nothing is touched', async () => {
    const userData = aDataFolder()
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    rewriteTheJournal(userData, (journal) => {
      const [first] = journal.participants as Record<string, unknown>[]
      if (first !== undefined) first.aside = 'recovery/../../elsewhere/database.sqlite'
    })
    const before = filesIn(userData)
    expect(await recoverInterrupted({ userData })).toMatchObject({ kind: 'unreadable' })
    expect(filesIn(userData)).toEqual(before)
  })
})

describe('data changed outside BroCrew while a return was unfinished', () => {
  /** A restore, a return stopped at `fault`, then the change; recovery must report it and touch nothing. */
  async function reportedAndUntouched(
    fault: Fault,
    change: (userData: string) => void,
  ): Promise<void> {
    const userData = aDataFolder()
    await restore(restoring(userData))
    await stoppedBy(returnToNewer({ userData, ...stoppingAt(fault) }))
    change(userData)
    const before = filesIn(userData)
    const recovered = await recoverInterrupted({ userData })
    expect(recovered, said(fault)).toMatchObject({ kind: 'replaced-outside', where: 'journal' })
    expect(filesIn(userData), said(fault)).toEqual(before)
  }

  it('a -wal changed and nothing else, after the return put it back in place', async () => {
    await reportedAndUntouched({ move: 'brobot2.sqlite-wal', to: 'live' }, (userData) =>
      writeFileSync(join(userData, 'brobot2.sqlite-wal'), filled('a -wal from elsewhere', 8_272)),
    )
  })

  it('the restored copy set aside, with the same size, time and first bytes, and another last byte', async () => {
    await reportedAndUntouched({ move: 'brobot2.sqlite', to: 'aside' }, (userData) => {
      const aside = join(userData, RESTORED_ASIDE, 'database.sqlite')
      const { atime, mtime } = statSync(aside)
      flipAByte(aside, COPY.length - 1)
      utimesSync(aside, atime, mtime)
      expect(statSync(aside).size).toBe(COPY.length)
    })
  })

  it('the newer database put back, changed in its last byte', async () => {
    await reportedAndUntouched({ move: 'brobot2.sqlite', to: 'live' }, (userData) => {
      const live = join(userData, 'brobot2.sqlite')
      const { atime, mtime } = statSync(live)
      flipAByte(live, NEWER_DATABASE.length - 1)
      utimesSync(live, atime, mtime)
    })
  })
})

describe('reading the records', () => {
  it('tries a journal held briefly by another program again, and settles it', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    let refusals = 3
    const held: RecoveryFs = {
      ...UNFLUSHED,
      readFile: (path) =>
        path.endsWith('restore-journal.json') && refusals-- > 0
          ? Promise.reject(coded('EBUSY'))
          : UNFLUSHED.readFile(path),
    }
    expect(await recoverInterrupted({ userData, fs: held })).toEqual({
      kind: 'finished',
      what: 'restore',
    })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })

  it('throws a journal that cannot be read as one that may be tried again, and touches nothing', async () => {
    const userData = aDataFolder()
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    const before = filesIn(userData)
    const broken: RecoveryFs = {
      ...UNFLUSHED,
      readFile: (path) =>
        path.endsWith('restore-journal.json')
          ? Promise.reject(coded('EIO'))
          : UNFLUSHED.readFile(path),
    }
    const stopped = await stoppedBy(recoverInterrupted({ userData, fs: broken }))
    expect(stopped).toMatchObject({ journalLeft: true, canRetry: true })
    expect(filesIn(userData)).toEqual(before)
    expect(await readJournalOnDisk(userData, broken)).toMatchObject({
      kind: 'unreadable',
      canRetry: true,
    })
  })

  it('reads each record as absent, present, or unreadable with whether to try again', async () => {
    const userData = aDataFolder()
    expect(await readJournalOnDisk(userData)).toEqual({ kind: 'absent' })
    expect(await readGateOnDisk(userData)).toEqual({ kind: 'absent' })
    await restore(restoring(userData))
    expect(await readGateOnDisk(userData)).toEqual({ kind: 'present', value: theGate() })
    writeFileSync(join(userData, GATE), '{"format":"brobot-history-only","version":2}')
    expect(await readGateOnDisk(userData)).toMatchObject({ kind: 'unreadable', canRetry: false })
  })
})

describe('a flush that fails after a record is renamed into place', () => {
  it('stops the restore with its journal left, and the next recovery settles it', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    // What puts the gate's rename on disk: its folder, or on Windows, which cannot flush a folder,
    // the gate itself flushed again under its name.
    const flushed = POSIX ? join(userData, 'recovery') : join(userData, GATE)
    let failed = false
    // The first such flush once the gate is renamed into place fails, as a disk error would.
    const flushFails: RecoveryFs = {
      ...UNFLUSHED,
      open: async (path, flags, mode) => {
        const handle = await UNFLUSHED.open(path, flags, mode)
        if (failed || path !== flushed || !existsSync(join(userData, GATE))) return handle
        failed = true
        return { ...handle, sync: () => Promise.reject(coded('EIO')) }
      },
    }
    const stopped = await stoppedBy(restore(restoring(userData, { fs: flushFails })))
    expect(failed).toBe(true)
    expect(stopped).toMatchObject({ during: 'restore', journalLeft: true, canRetry: true })
    expect(stopped.message).toContain('EIO')
    expect(journalStep(userData)).toBe('staged')
    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'finished', what: 'restore' })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })
})

describe('a move that cannot succeed by trying again', () => {
  const intoPlace = (from: string, to: string): boolean =>
    from.includes(`${sep}staged${sep}`) && to.endsWith(`${sep}brobot2.sqlite`)

  it('during a restore, has every file put back and says so', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    const stopped = await stoppedBy(
      restore(restoring(userData, { fs: renamesFailing('EXDEV', intoPlace) })),
    )
    expect(stopped).toMatchObject({ during: 'restore', journalLeft: false, canRetry: false })
    expect(stopped.message).toContain('EXDEV')
    expect(stopped.message).toContain('put the newer data back')
    expect(standing(userData)).toEqual(asItWas(before))
  })

  it('on the first file set aside, has nothing to put back', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(
      restore(
        restoring(userData, {
          fs: renamesFailing('EXDEV', (_, to) => to.includes(PRESERVED.split('/').join(sep))),
        }),
      ),
    )
    expect(standing(userData)).toEqual(asItWas(before))
  })

  it('when the folder it moves into is gone and the file is still there, is undone too', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    const stopped = await stoppedBy(
      restore(restoring(userData, { fs: renamesFailing('ENOENT', intoPlace) })),
    )
    expect(stopped.message).toContain('ENOENT')
    expect(standing(userData)).toEqual(asItWas(before))
  })

  it('found by recovery, is undone rather than tried at every start', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    const recovered = await recoverInterrupted({
      userData,
      fs: renamesFailing('EXDEV', intoPlace),
    })
    expect(recovered).toMatchObject({ kind: 'rolled-back', what: 'restore' })
    expect(standing(userData)).toEqual(asItWas(before))
    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'nothing-to-do' })
  })

  it('during a return, leaves the restored copy in place behind its gate', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await restore(restoring(userData))
    const stopped = await stoppedBy(
      returnToNewer({
        userData,
        fs: renamesFailing(
          'EXDEV',
          (from, to) =>
            from.includes(`${PRESERVED.split('/').join(sep)}${sep}`) &&
            to.endsWith(`${sep}brobot2.sqlite`),
        ),
      }),
    )
    expect(stopped).toMatchObject({ during: 'return', journalLeft: false, canRetry: false })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })

  it('that cannot be undone either, is said once with both causes, and the files wait for the next start', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    const intoLive = (_: string, to: string): boolean => to.endsWith(`${sep}brobot2.sqlite`)

    const stopped = await stoppedBy(
      restore(restoring(userData, { fs: renamesFailing('EXDEV', intoLive) })),
    )

    expect(stopped).toMatchObject({ during: 'restore', journalLeft: true, canRetry: false })
    expect(stopped.cause).toBeInstanceOf(CannotPutBack)
    expect(stopped.message).toContain('The restore stopped: BroCrew could not move brobot2.sqlite')
    expect(stopped.message).toContain('could not put brobot2.sqlite back where it was')
    expect(stopped.message).toContain('is on another disk than')
    expect(stopped.message).toContain('(EXDEV)')
    expect(journalStep(userData)).toBe('gate-installed')
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(false)

    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'finished', what: 'restore' })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })

  it('found by recovery and not undone either, says the same why at each try, until the cause is gone', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    const stuck = renamesFailing('EXDEV', (_, to) => to.endsWith(`${sep}brobot2.sqlite`))

    const first = await stoppedBy(recoverInterrupted({ userData, fs: stuck }))
    const second = await stoppedBy(recoverInterrupted({ userData, fs: stuck }))

    expect(first).toMatchObject({ journalLeft: true, canRetry: false })
    expect(first.cause).toBeInstanceOf(CannotPutBack)
    expect(first.message).toContain('tries again the next time it starts')
    expect(second.message).toBe(first.message)
    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'finished', what: 'restore' })
    expect(standing(userData)).toEqual(restoredFrom(before))
  })

  it('a source that is gone is not taken for one: the journal stays and the change is reported', async () => {
    const userData = aDataFolder()
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    const vanishing: RecoveryFs = {
      ...UNFLUSHED,
      rename: async (from, to) => {
        if (from.endsWith(`${sep}brobot2.sqlite`)) {
          rmSync(from)
          throw coded('ENOENT')
        }
        await UNFLUSHED.rename(from, to)
      },
    }
    const stopped = await stoppedBy(recoverInterrupted({ userData, fs: vanishing }))
    expect(stopped).toMatchObject({ journalLeft: true })
    expect(await recoverInterrupted({ userData })).toMatchObject({ kind: 'replaced-outside' })
  })
})

describe.skipIf(!LINKS)('a link where one of BroBot’s own folders should be', () => {
  /** Makes `owned` (a `/`-separated path in the data folder) a link to a folder of its own. */
  function linked(userData: string, owned: string): string {
    const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-restore-elsewhere-'))
    roots.push(elsewhere)
    const parts = owned.split('/')
    mkdirSync(join(userData, ...parts.slice(0, -1)), { recursive: true })
    symlinkSync(elsewhere, join(userData, ...parts), 'junction')
    return elsewhere
  }

  /** Moves the folder `owned` to another place and links it back. Returns that place. */
  async function movedAndLinked(userData: string, owned: string): Promise<string> {
    const folder = join(userData, ...owned.split('/'))
    const elsewhere = join(mkdtempSync(join(tmpdir(), 'brobot2-restore-elsewhere-')), 'moved')
    roots.push(dirname(elsewhere))
    await nodeFs.rename(folder, elsewhere)
    symlinkSync(elsewhere, folder, 'junction')
    return elsewhere
  }

  it('refuses a restore through a linked recovery/, touching nothing on either side', async () => {
    const userData = aDataFolder()
    const elsewhere = linked(userData, 'recovery')
    writeFileSync(join(elsewhere, 'theirs.txt'), 'not BroBot’s')
    const before = filesIn(userData)
    const stopped = await stoppedBy(restore(restoring(userData)))
    expect(stopped).toMatchObject({ journalLeft: false, canRetry: false })
    expect(stopped.message).toContain('is a link')
    expect(filesIn(userData)).toEqual(before)
    expect(readdirSync(elsewhere)).toEqual(['theirs.txt'])
  })

  it('refuses a restore from a linked backups/, touching nothing on either side', async () => {
    const userData = aDataFolder()
    // The real copies, moved to another folder and linked back, as a person moving them would.
    const elsewhere = await movedAndLinked(userData, 'backups')
    const before = filesIn(userData)
    const theirs = filesIn(elsewhere)
    const stopped = await stoppedBy(restore(restoring(userData)))
    expect(stopped.message).toContain('is a link')
    expect(filesIn(userData)).toEqual(before)
    expect(filesIn(elsewhere)).toEqual(theirs)
  })

  it('reports an unfinished restore through a linked recovery/ and touches nothing', async () => {
    const userData = aDataFolder()
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    const elsewhere = await movedAndLinked(userData, 'recovery')
    const before = filesIn(userData)
    const theirs = filesIn(elsewhere)
    const recovered = await recoverInterrupted({ userData })
    expect(recovered).toMatchObject({ kind: 'replaced-outside', where: 'journal' })
    expect(recovered.kind === 'replaced-outside' && recovered.detail).toContain('is a link')
    expect(filesIn(userData)).toEqual(before)
    expect(filesIn(elsewhere)).toEqual(theirs)
  })

  it.each([STAGED, PRESERVED])(
    'reports an unfinished restore whose own %s became a link, and touches nothing',
    async (owned) => {
      const userData = aDataFolder()
      await stoppedBy(
        restore(restoring(userData, stoppingAt({ move: 'brobot2.sqlite', to: 'aside' }))),
      )
      const elsewhere = await movedAndLinked(userData, owned)
      const before = filesIn(userData)
      const theirs = filesIn(elsewhere)
      const recovered = await recoverInterrupted({ userData })
      expect(recovered).toMatchObject({ kind: 'replaced-outside', where: 'journal' })
      expect(recovered.kind === 'replaced-outside' && recovered.detail).toContain('is a link')
      expect(filesIn(userData)).toEqual(before)
      expect(filesIn(elsewhere)).toEqual(theirs)
    },
  )

  it.skipIf(!FILE_LINKS)(
    'refuses a restore of a checkpoint whose copy is a link, touching nothing',
    async () => {
      const userData = aDataFolder()
      const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-restore-elsewhere-'))
      roots.push(elsewhere)
      const copy = join(userData, COPY_AT)
      writeFileSync(join(elsewhere, 'database.sqlite'), readFileSync(copy))
      rmSync(copy)
      symlinkSync(join(elsewhere, 'database.sqlite'), copy)
      const before = filesIn(userData)
      const stopped = await stoppedBy(restore(restoring(userData)))
      expect(stopped).toMatchObject({ journalLeft: false, canRetry: false })
      expect(stopped.message).toContain('is a link')
      expect(filesIn(userData)).toEqual(before)
    },
  )

  it.skipIf(!FILE_LINKS)(
    'refuses to restore over a database that is a link, touching nothing',
    async () => {
      const userData = aDataFolder()
      const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-restore-elsewhere-'))
      roots.push(elsewhere)
      const live = join(userData, 'brobot2.sqlite')
      writeFileSync(join(elsewhere, 'brobot2.sqlite'), readFileSync(live))
      rmSync(live)
      symlinkSync(join(elsewhere, 'brobot2.sqlite'), live)
      const before = filesIn(userData)
      const stopped = await stoppedBy(restore(restoring(userData)))
      expect(stopped).toMatchObject({ journalLeft: false, canRetry: false })
      expect(stopped.message).toContain('not a file')
      expect(filesIn(userData)).toEqual(before)
      expect(readFileSync(join(elsewhere, 'brobot2.sqlite'))).toEqual(NEWER_DATABASE)
    },
  )

  it.each(['recovery', 'recovery/staged', 'recovery/scratch'])(
    'sweeps nothing through a linked %s',
    async (owned) => {
      const userData = aDataFolder()
      const elsewhere = linked(userData, owned)
      mkdirSync(join(elsewhere, ANOTHER))
      writeFileSync(join(elsewhere, ANOTHER, 'theirs.txt'), 'not BroBot’s')
      await sweepLeftovers(userData)
      expect(await recoverInterrupted({ userData })).toEqual({ kind: 'nothing-to-do' })
      expect(readdirSync(join(elsewhere, ANOTHER))).toEqual(['theirs.txt'])
    },
  )

  it('refuses a return through a linked recovery/preserved, touching nothing', async () => {
    const userData = aDataFolder()
    await restore(restoring(userData))
    const elsewhere = await movedAndLinked(userData, 'recovery/preserved')
    const before = filesIn(userData)
    const theirs = filesIn(elsewhere)
    const stopped = await stoppedBy(returnToNewer({ userData }))
    expect(stopped).toMatchObject({ journalLeft: false, canRetry: false })
    expect(filesIn(userData)).toEqual(before)
    expect(filesIn(elsewhere)).toEqual(theirs)
  })
})

describe('sweepLeftovers', () => {
  it('removes id-named leftovers in staged/ and scratch/, and temporary records, and keeps the rest', async () => {
    const userData = aDataFolder()
    for (const folder of ['staged', 'scratch']) {
      mkdirSync(join(userData, 'recovery', folder, ANOTHER), { recursive: true })
      writeFileSync(join(userData, 'recovery', folder, ANOTHER, 'database.sqlite'), 'left over')
      mkdirSync(join(userData, 'recovery', folder, 'not-an-id'))
      writeFileSync(join(userData, 'recovery', folder, 'not-an-id', 'kept.txt'), 'kept')
    }
    writeFileSync(join(userData, 'recovery', 'restore-journal.json.0123456789ab.tmp'), 'half')
    writeFileSync(join(userData, 'recovery', 'notes.txt'), 'kept')
    await sweepLeftovers(userData)
    const left = Object.keys(filesIn(userData)).filter((path) => path.startsWith('recovery/'))
    expect(left.sort()).toEqual([
      'recovery/notes.txt',
      'recovery/scratch/not-an-id/kept.txt',
      'recovery/staged/not-an-id/kept.txt',
    ])
  })

  it('does nothing while a journal is on disk', async () => {
    const userData = aDataFolder()
    await stoppedBy(restore(restoring(userData, stoppingAt({ at: 'moving' }))))
    const before = filesIn(userData)
    await sweepLeftovers(userData)
    expect(filesIn(userData)).toEqual(before)
  })
})

describe('whatChangedSinceTheGate', () => {
  it('is null for the files the restore left, and names a change to any of them', async () => {
    const userData = aDataFolder()
    const { gate } = await restore(restoring(userData))
    expect(await whatChangedSinceTheGate(userData, gate)).toBeNull()

    writeFileSync(join(userData, 'drafts.json'), '{"changed":true}\n')
    expect(await whatChangedSinceTheGate(userData, gate)).toContain('drafts.json')
    writeFileSync(join(userData, 'drafts.json'), OLDER_DRAFTS)

    writeFileSync(join(userData, 'brobot2.sqlite-shm'), 'index')
    expect(await whatChangedSinceTheGate(userData, gate)).toContain('brobot2.sqlite-shm')
    rmSync(join(userData, 'brobot2.sqlite-shm'))

    const live = join(userData, 'brobot2.sqlite')
    flipAByte(live, COPY.length - 1)
    expect(await whatChangedSinceTheGate(userData, gate)).toContain('no longer the restored copy')
  })
})

describe('returnToNewer', () => {
  it('puts the newer family and its drafts back byte for byte, removes the gate, and keeps the restored copy aside', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await restore(restoring(userData))
    const seen: number[] = []
    const returned = await returnToNewer({ userData, progress: (done) => seen.push(done) })
    expect(returned).toEqual({ database: join(userData, 'brobot2.sqlite') })
    expect(standing(userData)).toEqual(returnedFrom(before))
    expect(existsSync(join(userData, PRESERVED))).toBe(false)
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('refuses, changing nothing, when the restored copy was changed outside BroCrew', async () => {
    const userData = aDataFolder()
    await restore(restoring(userData))
    writeFileSync(join(userData, 'brobot2.sqlite'), filled('a database from elsewhere', 20_480))
    const before = filesIn(userData)
    const stopped = await stoppedBy(returnToNewer({ userData }))
    expect(stopped).toMatchObject({ during: 'return', journalLeft: false, canRetry: false })
    expect(stopped.message).toMatch(/changed outside BroCrew/)
    expect(filesIn(userData)).toEqual(before)
  })

  it('refuses, changing nothing, when the restored drafts were changed outside BroCrew', async () => {
    const userData = aDataFolder()
    await restore(restoring(userData))
    writeFileSync(join(userData, 'drafts.json'), '{"changed":true}\n')
    const before = filesIn(userData)
    const stopped = await stoppedBy(returnToNewer({ userData }))
    expect(stopped.message).toMatch(/changed outside BroCrew/)
    expect(filesIn(userData)).toEqual(before)
  })

  it('refuses when there is no restore to return from, or its record cannot be read', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    expect((await stoppedBy(returnToNewer({ userData }))).message).toMatch(/not a restored copy/)
    expect(filesIn(userData)).toEqual(before)
    mkdirSync(join(userData, 'recovery'))
    writeFileSync(join(userData, GATE), 'not a record')
    expect((await stoppedBy(returnToNewer({ userData }))).message).toMatch(/could not read/)
  })

  it('refuses when the newer database it would put back is gone', async () => {
    const userData = aDataFolder()
    await restore(restoring(userData))
    rmSync(join(userData, PRESERVED, 'database.sqlite'))
    const before = filesIn(userData)
    const stopped = await stoppedBy(returnToNewer({ userData }))
    expect(stopped.message).toMatch(/not where it was left/)
    expect(stopped.cause).toBeInstanceOf(ChangedOutside)
    expect(filesIn(userData)).toEqual(before)
  })

  describe('refuses, as changed outside BroCrew and changing nothing, when the set-aside data', () => {
    const cases: readonly [string, Shape, (userData: string) => void, string][] = [
      [
        'lost the -wal the restore set aside',
        {},
        (userData) => rmSync(join(userData, PRESERVED, 'database.sqlite-wal')),
        `${PRESERVED}/database.sqlite-wal is gone`,
      ],
      [
        'gained a -wal the restore did not set aside',
        { sidecars: [] },
        (userData) =>
          writeFileSync(
            join(userData, PRESERVED, 'database.sqlite-wal'),
            filled('a -wal from elsewhere', 4_152),
          ),
        `${PRESERVED}/database.sqlite-wal is there, and it set none aside there`,
      ],
      [
        'holds drafts with other bytes',
        {},
        (userData) => flipAByte(join(userData, PRESERVED, 'drafts.json'), 5),
        `${PRESERVED}/drafts.json is not the file it set aside`,
      ],
      [
        'holds a database with another last byte',
        {},
        (userData) =>
          flipAByte(join(userData, PRESERVED, 'database.sqlite'), NEWER_DATABASE.length - 1),
        `${PRESERVED}/database.sqlite is not the file it set aside`,
      ],
    ]

    it.each(cases)('%s', async (_, shape, change, said) => {
      const userData = aDataFolder(shape)
      const { gate } = await restore(restoring(userData))
      change(userData)
      const before = filesIn(userData)
      const stopped = await stoppedBy(returnToNewer({ userData }))
      expect(stopped).toMatchObject({ during: 'return', journalLeft: false, canRetry: false })
      expect(stopped.cause).toBeInstanceOf(ChangedOutside)
      expect((stopped.cause as ChangedOutside).checkpointCreatedAt).toBe(gate.checkpointCreatedAt)
      expect(stopped.message).toContain(said)
      expect(filesIn(userData)).toEqual(before)
    })
  })

  it('refuses, changing nothing, a gate that lists a set-aside file this build does not move', async () => {
    const userData = aDataFolder()
    const { gate } = await restore(restoring(userData))
    writeFileSync(
      join(userData, GATE),
      serializeGate({
        ...gate,
        preservedFiles: [...gate.preservedFiles, { live: 'notes.json', present: false }],
      }),
    )
    const before = filesIn(userData)
    const stopped = await stoppedBy(returnToNewer({ userData }))
    expect(stopped).toMatchObject({ journalLeft: false, canRetry: false })
    expect(stopped.message).toContain('newer version of BroCrew')
    expect(filesIn(userData)).toEqual(before)
  })

  it('returns from a gate that lists the database alone, taking the other files as it finds them', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    const { gate } = await restore(restoring(userData))
    writeFileSync(
      join(userData, GATE),
      serializeGate({ ...gate, installed: gate.installed.slice(0, 1) }),
    )
    await stoppedBy(returnToNewer({ userData, ...stoppingAt({ at: 'moving' }) }))
    expect(await recoverInterrupted({ userData })).toEqual({ kind: 'finished', what: 'return' })
    expect(standing(userData)).toEqual(returnedFrom(before))
  })

  it('refuses, changing nothing, a gate that lists a file this build does not move', async () => {
    const userData = aDataFolder()
    const { gate } = await restore(restoring(userData))
    writeFileSync(
      join(userData, GATE),
      serializeGate({
        ...gate,
        installed: [...gate.installed, { live: 'notes.json', present: false }],
      }),
    )
    const before = filesIn(userData)
    const stopped = await stoppedBy(returnToNewer({ userData }))
    expect(stopped).toMatchObject({ journalLeft: false, canRetry: false })
    expect(stopped.message).toContain('newer version of BroCrew')
    expect(filesIn(userData)).toEqual(before)
  })

  it('refuses when the folder the restored copy goes to already holds files', async () => {
    const userData = aDataFolder()
    await restore(restoring(userData))
    mkdirSync(join(userData, RESTORED_ASIDE), { recursive: true })
    writeFileSync(join(userData, RESTORED_ASIDE, 'database.sqlite'), 'something')
    const before = filesIn(userData)
    expect((await stoppedBy(returnToNewer({ userData }))).message).toMatch(/already holds files/)
    expect(filesIn(userData)).toEqual(before)
  })

  it('a different brobot2.sqlite written while a return was unfinished is reported, and nothing is touched', async () => {
    const userData = aDataFolder()
    await restore(restoring(userData))
    await stoppedBy(
      returnToNewer({ userData, ...stoppingAt({ move: 'brobot2.sqlite', to: 'aside' }) }),
    )
    expect(existsSync(join(userData, 'brobot2.sqlite'))).toBe(false)
    writeFileSync(join(userData, 'brobot2.sqlite'), filled('a database from elsewhere', 20_480))
    const before = filesIn(userData)
    expect(await recoverInterrupted({ userData })).toMatchObject({
      kind: 'replaced-outside',
      where: 'journal',
    })
    expect(filesIn(userData)).toEqual(before)
  })

  it('a newer database changed while a return was unfinished has the restored copy put back', async () => {
    const userData = aDataFolder()
    const before = filesIn(userData)
    await restore(restoring(userData))
    await stoppedBy(returnToNewer({ userData, ...stoppingAt({ at: 'moving' }) }))
    flipAByte(join(userData, PRESERVED, 'database.sqlite'))
    const changed = filesIn(userData)
    expect(await recoverInterrupted({ userData })).toMatchObject({
      kind: 'rolled-back',
      what: 'return',
    })
    expect(filesIn(userData)).toEqual(
      Object.fromEntries(Object.entries(changed).filter(([path]) => path !== JOURNAL)),
    )
    expect(standing(userData).gate).toEqual(restoredFrom(before).gate)
  })
})
