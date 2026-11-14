import type {
  ProgressListener,
  RecoveryService,
  StartFailure,
  StartupVerdict,
} from '../../shared/recovery'
import type { HostGateVerdict } from '../one-host-gate'
import {
  CheckpointFailed,
  CheckpointNoRoom,
  checkpointNeeded,
  inWords,
  listCheckpoints,
  listOfferable,
  theNewestIntact,
  captureCheckpoint,
  resumeCapturedCheckpoints,
  offeredFrom,
  prune,
  type Checkpoint,
  type CheckpointStep,
} from './checkpoint'
import { STEPS, type HistoryOnlyGate, type RestoreKind, type Step } from './contract'
import {
  buildLineage,
  hasPendingMigrations,
  isTheBuildsMigration,
  isLineagePrefix,
  lineageFit,
  migrationsOf,
  type BuildMigration,
} from './database-facts'
import {
  nodeFs,
  pathExists,
  type AfterMove,
  type AfterStep,
  type BeforeStep,
  type Moved,
  type RecoveryFs,
  type StepHooks,
} from './files'
import { DATABASE_FILE, databaseFile } from './layout'
import {
  CannotPutBack,
  ChangedOutside,
  RestoreStopped,
  readGateOnDisk,
  readJournalOnDisk,
  recoverInterrupted,
  restore as restoreACheckpoint,
  returnToNewer as returnToTheNewer,
  sweepLeftovers,
  whatChangedSinceTheGate,
  type RecordOnDisk,
  type Recovered,
} from './restore'
import type { VerifyCopy } from './copy-check'

/** Whether this process is the only app on the data folder, as the launch's one-app check found. */
export type Ownership = HostGateVerdict

export type WorkingOn = 'check' | 'checkpoint' | 'restore' | 'return'

/** What a start that ended while still working was working on, in the line it prints. */
const WORKING_SAID: Readonly<Record<WorkingOn, string>> = {
  check: 'check of its data',
  checkpoint: 'recovery copy',
  restore: 'restore',
  return: 'return',
}

export interface CoordinatorDeps {
  readonly userData: string
  /** This build's migrations folder; its journal lists the migrations the build carries. */
  readonly buildMigrationsFolder: string
  readonly appVersion: string
  /** The commit this build was made from, recorded in each copy's manifest; null when unknown. */
  readonly build: string | null
  /** Whether this build has a release version for checkpoint reuse. */
  readonly packaged: boolean
  readonly requireExistingDatabase?: boolean
  readonly ownership: () => Promise<Ownership>
  readonly fs?: RecoveryFs
  /** Called before each journaled step of a restore or return. A test throws from it. */
  readonly beforeStep?: BeforeStep
  /** Called after each journaled step's work, before the journal names it. A test throws from it. */
  readonly afterStep?: AfterStep
  /** Called after each file a restore or return renames. A test throws from it. */
  readonly afterMove?: AfterMove
  /** Called before each step of making a copy. A test throws from it. */
  readonly beforeCheckpointStep?: (step: CheckpointStep) => void
  /** Epoch ms. */
  readonly now?: () => number
  /** Bytes free on the disk holding a path, or null when that cannot be told. */
  readonly freeBytes?: (path: string) => number | null
  /** Where the copy's line goes. */
  readonly log?: (line: string) => void
  readonly working?: (what: WorkingOn) => void
  /** That step's progress. */
  readonly progress?: ProgressListener
  /** Checks a recovery copy before it is kept: in the app, in a worker. */
  readonly verifyCopy: VerifyCopy
  readonly hashCopy?: VerifyCopy
  readonly signal?: AbortSignal
}

/** What this start may do with the workspace's data. Never throws. */
export async function inspect(deps: CoordinatorDeps): Promise<StartupVerdict> {
  try {
    return await decide(deps, askedOnce(deps.ownership))
  } catch (error) {
    return failed(
      'database-unreadable',
      true,
      `BroCrew could not check this workspace's data: ${messageOf(error)}`,
    )
  }
}

/** The recovery window's service: the start-up check, and the restore and return it offers. */
export function createRecoveryService(deps: CoordinatorDeps): RecoveryService {
  return {
    inspect: () => inspect(deps),
    restore: (checkpointId, progress) => restoreThenInspect(deps, checkpointId, progress),
    returnToNewer: (progress) => returnThenInspect(deps, progress),
    retry: () => inspect(deps),
  }
}

export type FaultPoint = Step | CheckpointStep | { readonly move: string; readonly to: Moved['to'] }

/** A fault a test asks for, to stop a copy, a restore or a return at a chosen point. */
export interface RecoveryFaults {
  readonly at: FaultPoint
  readonly after?: boolean
  /** The code the fault's error carries, as a briefly held file or a full disk gives one. */
  readonly error?: FaultCode
}

export const FAULT_CODES = ['EBUSY', 'ENOSPC', 'EACCES'] as const
export type FaultCode = (typeof FAULT_CODES)[number]

const CHECKPOINT_STEPS: readonly CheckpointStep[] = ['copy', 'verify', 'files', 'manifest']

/** What a test passes to {@link createRecoveryServiceForTests}. */
export interface RecoveryTestOptions extends Omit<
  CoordinatorDeps,
  | 'buildMigrationsFolder'
  | 'ownership'
  | 'build'
  | 'packaged'
  | 'beforeStep'
  | 'afterStep'
  | 'afterMove'
  | 'beforeCheckpointStep'
> {
  /** This build's migrations folder. */
  readonly migrationsFolder: string
  /** The one-app check's answer, or what to ask for it. */
  readonly ownership: Ownership | (() => Promise<Ownership>)
  readonly build?: string | null
  readonly packaged?: boolean
  readonly faults?: RecoveryFaults
}

export function createRecoveryServiceForTests(options: RecoveryTestOptions): RecoveryService {
  const { migrationsFolder, ownership, build, packaged, faults, ...deps } = options
  return createRecoveryService({
    ...deps,
    buildMigrationsFolder: migrationsFolder,
    build: build ?? null,
    packaged: packaged ?? false,
    ownership: typeof ownership === 'function' ? ownership : () => Promise.resolve(ownership),
    ...(faults === undefined ? {} : hooksFor(faults)),
  })
}

/** The hooks that carry out `faults`. Throws when `faults` names a point that never comes. */
export function hooksFor(
  faults: RecoveryFaults,
): StepHooks & Pick<CoordinatorDeps, 'beforeCheckpointStep'> {
  const { at, after = false } = faults
  let fired = false
  const fire = (where: string): void => {
    if (fired) return
    fired = true
    throw faultError(faults.error, where)
  }
  if (typeof at === 'object') {
    return {
      afterMove: (moved) => {
        if (moved.live === at.move && moved.to === at.to) {
          fire(`after ${moved.live} moved to ${moved.to}`)
        }
      },
    }
  }
  if (isCheckpointStep(at)) {
    if (after && at === CHECKPOINT_STEPS.at(-1)) {
      throw new Error(`a copy has no step after "${at}"`)
    }
    let passed = false
    return {
      beforeCheckpointStep: (step) => {
        if (!after && step === at) fire(`before "${at}"`)
        if (after && passed) fire(`after "${at}"`)
        passed ||= step === at
      },
    }
  }
  return after
    ? { afterStep: (step) => (step === at ? fire(`after "${at}"`) : undefined) }
    : { beforeStep: (step) => (step === at ? fire(`before "${at}"`) : undefined) }
}

export const KEEP_RECOVERY_WINDOW_SWITCH = 'brobot-test-keep-recovery-window'

/** Whether a hidden launch keeps its recovery window, saying so either way when it was asked. */
export function keepsTheRecoveryWindow(
  asked: boolean,
  _packaged: boolean,
  warn: (line: string) => void,
): boolean {
  if (!asked) return false
  warn(`BroCrew keeps its recovery window on a hidden launch: --${KEEP_RECOVERY_WINDOW_SWITCH}`)
  return true
}

function isCheckpointStep(point: string): point is CheckpointStep {
  return (CHECKPOINT_STEPS as readonly string[]).includes(point)
}

function faultError(code: FaultCode | undefined, where: string): Error {
  const error = new Error(`${code ?? 'A fault'}: a test stopped this ${where}`) as Error & {
    code?: string
  }
  if (code !== undefined) error.code = code
  return error
}

export const RECOVERY_FAULT_SWITCH = 'brobot-recovery-fault'

/** The faults a switch value asks for, or null when it names none this build knows. */
export function faultsFromSwitch(value: string): RecoveryFaults | null {
  const [point, ...rest] = value.split(',').map((part) => part.trim())
  if (point === undefined) return null
  let at: FaultPoint
  let after = false
  let error: FaultCode | undefined
  if (point.startsWith('move:')) {
    const [, live, to, ...extra] = point.split(':')
    if (live === undefined || live === '' || extra.length > 0) return null
    if (to !== 'aside' && to !== 'live' && to !== 'incoming') return null
    at = { move: live, to }
  } else {
    const steps: readonly string[] = [...STEPS, ...CHECKPOINT_STEPS]
    if (!steps.includes(point)) return null
    at = point as Step | CheckpointStep
  }
  for (const part of rest) {
    if (part === 'after' && typeof at === 'string') after = true
    else if ((FAULT_CODES as readonly string[]).includes(part)) error = part as FaultCode
    else return null
  }
  if (after && at === CHECKPOINT_STEPS.at(-1)) return null
  return { at, ...(after ? { after } : {}), ...(error === undefined ? {} : { error }) }
}

export function whyItDidNotStart(verdict: StartupVerdict): string {
  switch (verdict.kind) {
    case 'open':
      return "The workspace's data opened."
    case 'working':
      return `BroCrew is still working on a ${WORKING_SAID[verdict.what]}.`
    case 'newer': {
      const { inTheDatabase, inTheBuild } = verdict.newer
      const what =
        inTheDatabase > inTheBuild
          ? `to database version ${String(inTheDatabase)}, and this version of BroCrew reads up to version ${String(inTheBuild)}`
          : 'with a database change this version of BroCrew does not have'
      const offer =
        verdict.offers === null
          ? ' No recovery copy this version of BroCrew can open is kept.'
          : ` A recovery copy from ${verdict.offers.createdAt} can be restored.`
      return `A newer version of BroCrew has updated this workspace's data (${verdict.workspace}) ${what}.${offer}`
    }
    case 'history-only':
      return (
        `This workspace's data is a recovery copy from ${verdict.gate.checkpointCreatedAt}, ` +
        'restored to be read; the newer data it set aside can be put back.'
      )
    case 'failed': {
      const said =
        verdict.reason === 'not-the-only-app-on-this-folder' && verdict.ownership === 'taken'
          ? 'Another copy of BroCrew has this workspace open.'
          : FAILURES[verdict.reason]
      return verdict.detail === undefined ? said : `${said} ${verdict.detail}`
    }
  }
}

const FAILURES: Readonly<Record<StartFailure, string>> = {
  'not-the-only-app-on-this-folder':
    'BroCrew could not be sure that no other copy of BroCrew has this workspace open, so it changed nothing.',
  'database-unreadable': "BroCrew could not read this workspace's data safely.",
  'checkpoint-failed':
    "BroCrew could not make the copy of this workspace's data it needs before going on, so it changed nothing.",
  'migration-failed': "BroCrew could not update this workspace's data to this version.",
  'replaced-outside': "This workspace's data was changed outside BroCrew after a restore began.",
  'recovery-unreadable': 'BroCrew could not read the record it keeps while restoring a copy.',
  'restore-failed': 'A restore or a return did not finish.',
  'start-failed': 'BroCrew could not finish starting.',
}

export async function pruneTheCopies(
  userData: string,
  buildMigrationsFolder: string,
  ownership: Ownership,
  warn: (line: string) => void,
  appVersion?: string,
): Promise<string[]> {
  if (ownership !== 'sole') return []
  const lineage = await buildLineage(buildMigrationsFolder)
  const options = { ownership, warn, currentAppVersion: appVersion }
  return prune(userData, lineage, options)
}

const OPEN_NOT_NEEDED: StartupVerdict = { kind: 'open', checkpoint: 'not-needed' }

function failed(reason: StartFailure, canRetry: boolean, detail?: string): StartupVerdict {
  return { kind: 'failed', reason, canRetry, ...(detail === undefined ? {} : { detail }) }
}

function notTheOnlyApp(ownership: Exclude<Ownership, 'sole'>): StartupVerdict {
  return {
    kind: 'failed',
    reason: 'not-the-only-app-on-this-folder',
    canRetry: ownership === 'unknown',
    ownership,
  }
}

/** A journal or gate on disk that this start cannot read. A read that failed may pass later. */
function unreadableRecord(
  found: Extract<RecordOnDisk<unknown>, { kind: 'unreadable' }>,
): StartupVerdict {
  return failed('recovery-unreadable', found.canRetry, found.detail)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The ownership verdict, asked for once; a check that fails is not a 'sole'. */
function askedOnce(ownership: () => Promise<Ownership>): () => Promise<Ownership> {
  let asked: Promise<Ownership> | null = null
  return () => {
    asked ??= ownership().catch(() => 'unknown' as const)
    return asked
  }
}

function stepHooksOf(deps: CoordinatorDeps): StepHooks {
  return { beforeStep: deps.beforeStep, afterStep: deps.afterStep, afterMove: deps.afterMove }
}

/** Tells `deps.working` what the check is working on, once each time that changes. */
function workingOn(deps: CoordinatorDeps): (what: WorkingOn) => void {
  let said: WorkingOn | null = null
  return (what) => {
    if (what === said) return
    said = what
    deps.working?.(what)
  }
}

async function decide(
  deps: CoordinatorDeps,
  ownership: () => Promise<Ownership>,
): Promise<StartupVerdict> {
  const fs = deps.fs ?? nodeFs
  const { userData } = deps
  const working = workingOn(deps)

  const journal = await readJournalOnDisk(userData, fs)
  if (journal.kind === 'unreadable') return unreadableRecord(journal)
  const owner = await ownership()
  if (journal.kind === 'present') {
    if (owner !== 'sole') return notTheOnlyApp(owner)
    working(journal.value.kind)
    const settled = await settleAtStart(deps, fs, journal.value.kind)
    if (settled !== null) return settled
  }

  const gate = await readGateOnDisk(userData, fs)
  if (gate.kind === 'unreadable') return unreadableRecord(gate)
  if (gate.kind === 'present') return historyOnly(userData, gate.value, fs)
  if (journal.kind === 'absent') working('check')
  // With no journal and no gate this only removes what an interrupted restore or read left.
  if (owner === 'sole') await sweepLeftovers(userData, fs).catch(() => undefined)

  const lineage = await buildLineage(deps.buildMigrationsFolder, fs)
  const database = await migrationsOf(databaseFile(userData), {
    fs,
    userData,
    ...(deps.freeBytes === undefined ? {} : { freeBytes: deps.freeBytes }),
  })
  if (database.kind === 'absent') {
    if (deps.requireExistingDatabase)
      return failed(
        'database-unreadable',
        false,
        `Database ${databaseFile(userData)} does not exist (ENOENT).`,
      )
    const stray = await strayData(userData, fs)
    return stray === null ? OPEN_NOT_NEEDED : failed('database-unreadable', false, stray)
  }
  if (database.kind === 'empty') return OPEN_NOT_NEEDED
  if (database.kind === 'no-room') {
    return failed(
      'checkpoint-failed',
      true,
      "There is not enough free space to check this workspace's data. Checking it needs a copy " +
        `of it, about ${inWords(database.needed)}, and ${inWords(database.free)} is free on its ` +
        'disk. Free some space, then try again.',
    )
  }
  if (database.kind === 'unreadable') {
    return failed(
      'database-unreadable',
      true,
      `BroCrew could not read the migration record of ${databaseFile(userData)}: ${database.detail}.`,
    )
  }
  const applied = database.migrations
  switch (lineageFit(applied, lineage)) {
    case 'newer':
      return newer(deps, applied.length, lineage, fs)
    case 'foreign': {
      const index = applied.findIndex(
        (migration, at) => !isTheBuildsMigration(migration, lineage[at]),
      )
      const recorded = applied[index]!
      const expected = lineage[index]
      const build = `${deps.appVersion}${deps.build ? ` (${deps.build})` : ''}`
      return failed(
        'database-unreadable',
        false,
        `${databaseFile(userData)}: migration ${index + 1} records time ${recorded.createdAt} and hash ${recorded.hash}. ` +
          `BroCrew ${build} ${expected ? `expects time ${expected.createdAt} and hash ${expected.hash}` : 'has no migration at that position'}. ` +
          'This build cannot open that migration history.',
      )
    }
    case 'fits':
      break
  }

  const pending = hasPendingMigrations(applied, lineage)
  const options = {
    userData,
    ownership: owner,
    appVersion: deps.appVersion,
    build: deps.build,
    reason: 'before-migration' as const,
    fs,
    verifyCopy: deps.verifyCopy,
    hashCopy: deps.hashCopy,
    signal: deps.signal,
    expectedMigrations: applied,
    progress: deps.progress === undefined ? undefined : quietly(deps.progress),
    now: deps.now,
    freeBytes: deps.freeBytes,
    log: deps.log,
    beforeStep: deps.beforeCheckpointStep,
  }
  const retained = await resumeCapturedCheckpoints(options)
  for (const captured of retained) await captured.finish()
  const reason = await checkpointNeeded({
    userData,
    database,
    lineage,
    release: deps.packaged ? deps.appVersion : null,
    build: deps.build,
    fs,
  })
  if (reason === null && !pending && retained.length === 0) return OPEN_NOT_NEEDED
  if (owner !== 'sole') return notTheOnlyApp(owner)
  const rotate = (): Promise<string[]> =>
    prune(userData, lineage, {
      ownership: owner,
      currentAppVersion: deps.appVersion,
      fs,
      now: deps.now,
    })
  if (reason === null) {
    await rotate()
    return OPEN_NOT_NEEDED
  }
  working('checkpoint')
  const make = async (): Promise<void> => {
    const captured = await captureCheckpoint({ ...options, reason })
    await captured.finish()
    await rotate()
  }
  try {
    await make()
  } catch (error) {
    if (error instanceof CheckpointNoRoom) {
      return failed(
        'checkpoint-failed',
        true,
        `There isn't enough free space for a recovery copy: it needs about ` +
          `${inWords(error.needed)}, and ${inWords(error.free)} is free.`,
      )
    }
    return error instanceof CheckpointFailed
      ? failed('checkpoint-failed', error.canRetry, error.message)
      : failed(
          'checkpoint-failed',
          true,
          `BroCrew could not make a recovery copy of this workspace's data: ${messageOf(error)}`,
        )
  }
  return { kind: 'open', checkpoint: 'made' }
}

/** A progress listener that cannot stop the work it is told about. */
function quietly(listener: ProgressListener): ProgressListener {
  return (done, total) => {
    try {
      listener(done, total)
    } catch {
      // Progress is only shown.
    }
  }
}

/** Settles a journal found at start. Null when the start goes on to the next step. */
async function settleAtStart(
  deps: CoordinatorDeps,
  fs: RecoveryFs,
  kind: RestoreKind,
): Promise<StartupVerdict | null> {
  let recovered: Recovered
  try {
    recovered = await recoverInterrupted({
      userData: deps.userData,
      fs,
      ...stepHooksOf(deps),
      ...(deps.progress === undefined ? {} : { progress: deps.progress }),
    })
  } catch (error) {
    return error instanceof RestoreStopped
      ? restoreFailed(error.during, error.message, error.canRetry)
      : restoreFailed(kind, messageOf(error))
  }
  return afterRecovery(recovered)
}

/** What a recovery's outcome means for the start. Null when it finished, and the start goes on. */
function afterRecovery(recovered: Recovered): StartupVerdict | null {
  switch (recovered.kind) {
    case 'nothing-to-do':
    case 'finished':
      return null
    case 'rolled-back':
      return restoreFailed(
        recovered.what,
        `The ${recovered.what} did not finish, so BroCrew put this workspace's data back as it was. ${recovered.detail}`,
      )
    case 'replaced-outside':
      return {
        kind: 'failed',
        reason: 'replaced-outside',
        canRetry: false,
        where: 'journal',
        detail: recovered.detail,
      }
    case 'unreadable':
      return failed('recovery-unreadable', false, recovered.detail)
  }
}

function restoreFailed(during: RestoreKind, detail: string, canRetry = true): StartupVerdict {
  return { kind: 'failed', reason: 'restore-failed', canRetry, during, detail }
}

async function historyOnly(
  userData: string,
  gate: HistoryOnlyGate,
  fs: RecoveryFs,
): Promise<StartupVerdict> {
  const replaced = await whatChangedSinceTheGate(userData, gate, fs)
  if (replaced === null) return { kind: 'history-only', gate, database: databaseFile(userData) }
  return {
    kind: 'failed',
    reason: 'replaced-outside',
    canRetry: false,
    where: 'gate',
    checkpointCreatedAt: gate.checkpointCreatedAt,
    detail: replaced,
  }
}

/** A sidecar holding data with no database beside it, which a new database would take in. */
async function strayData(userData: string, fs: RecoveryFs): Promise<string | null> {
  const main = databaseFile(userData)
  for (const suffix of ['-wal', '-journal']) {
    if (await pathExists(`${main}${suffix}`, fs)) {
      return `${DATABASE_FILE}${suffix} is in ${userData} without ${DATABASE_FILE}, so BroCrew made no new database beside it.`
    }
  }
  return null
}

async function newer(
  deps: CoordinatorDeps,
  inTheDatabase: number,
  lineage: readonly BuildMigration[],
  fs: RecoveryFs,
): Promise<StartupVerdict> {
  const offered = await theNewestIntact(await listOfferable(deps.userData, lineage, fs), fs)
  const checkpoints = await listCheckpoints(deps.userData, fs)
  return {
    kind: 'newer',
    workspace: deps.userData,
    newer: {
      inTheDatabase,
      inTheBuild: lineage.length,
      madeBy: newerAppOf(checkpoints, lineage.length, deps.appVersion),
    },
    offers: offered === null ? null : offeredFrom(offered),
  }
}

function newerAppOf(
  checkpoints: readonly Checkpoint[],
  inTheBuild: number,
  appVersion: string,
): { readonly appVersion: string } | null {
  const found = checkpoints.find(
    ({ manifest }) =>
      manifest.database.migrations.length > inTheBuild ||
      (manifest.reason === 'before-migration' && manifest.madeBy.appVersion !== appVersion),
  )
  return found === undefined ? null : { appVersion: found.manifest.madeBy.appVersion }
}

async function restoreThenInspect(
  deps: CoordinatorDeps,
  checkpointId: string,
  progress: ProgressListener,
): Promise<StartupVerdict> {
  const fs = deps.fs ?? nodeFs
  const owner = await askedOnce(deps.ownership)()
  if (owner !== 'sole') return notTheOnlyApp(owner)
  try {
    const now = deps.now
    const lineage = await buildLineage(deps.buildMigrationsFolder, fs)
    await restoreACheckpoint({
      userData: deps.userData,
      checkpointId,
      canOpen: (migrations) => isLineagePrefix(migrations, lineage),
      fs,
      progress,
      ...stepHooksOf(deps),
      ...(now === undefined ? {} : { now: () => new Date(now()) }),
    })
  } catch (error) {
    return afterAStop(deps, fs, 'restore', error, progress)
  }
  return inspect(deps)
}

async function returnThenInspect(
  deps: CoordinatorDeps,
  progress: ProgressListener,
): Promise<StartupVerdict> {
  const fs = deps.fs ?? nodeFs
  const owner = await askedOnce(deps.ownership)()
  if (owner !== 'sole') return notTheOnlyApp(owner)
  try {
    const now = deps.now
    await returnToTheNewer({
      userData: deps.userData,
      fs,
      progress,
      ...stepHooksOf(deps),
      ...(now === undefined ? {} : { now: () => new Date(now()) }),
    })
  } catch (error) {
    return afterAStop(deps, fs, 'return', error, progress)
  }
  return inspect(deps)
}

async function afterAStop(
  deps: CoordinatorDeps,
  fs: RecoveryFs,
  during: RestoreKind,
  error: unknown,
  progress: ProgressListener,
): Promise<StartupVerdict> {
  const stopped = error instanceof RestoreStopped ? error : null
  if (stopped?.cause instanceof ChangedOutside) {
    return {
      kind: 'failed',
      reason: 'replaced-outside',
      canRetry: false,
      where: 'gate',
      checkpointCreatedAt: stopped.cause.checkpointCreatedAt,
      detail: stopped.message,
    }
  }
  if (stopped === null || !stopped.journalLeft || stopped.cause instanceof CannotPutBack) {
    return restoreFailed(during, messageOf(error), stopped?.canRetry ?? true)
  }
  let recovered: Recovered
  try {
    recovered = await recoverInterrupted({
      userData: deps.userData,
      fs,
      progress,
      ...stepHooksOf(deps),
    })
  } catch (again) {
    return again instanceof RestoreStopped && again.cause instanceof CannotPutBack
      ? restoreFailed(during, again.message, again.canRetry)
      : restoreFailed(during, stopped.message)
  }
  if (recovered.kind === 'rolled-back') return restoreFailed(during, stopped.message)
  return afterRecovery(recovered) ?? inspect(deps)
}
