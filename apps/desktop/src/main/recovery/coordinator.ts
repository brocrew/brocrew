import type {
  ProgressListener,
  RecoveryService,
  StartFailure,
  StartupVerdict,
} from '../../shared/recovery'
import type { HostGateVerdict } from '../one-host-gate'
import { PACKAGED_WORKSPACE_REFUSAL } from '../workspace-routing'
import {
  CheckpointFailed,
  CheckpointNoRoom,
  checkpointNeeded,
  inWords,
  listCheckpoints,
  listOfferable,
  makeCheckpoint,
  offeredFrom,
  prune,
  theNewestIntact,
  type Checkpoint,
  type CheckpointStep,
} from './checkpoint'
import { STEPS, type HistoryOnlyGate, type RestoreKind, type Step } from './contract'
import {
  buildLineage,
  hasPendingMigrations,
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

/**
 * The start-up check: what a start may do with the workspace's data, decided before anything else
 * opens it, and the recovery window's service built on the same check.
 *
 * {@link inspect} runs in this order, and the first step that decides ends it:
 * 1. an unfinished restore or return is settled (a record that cannot be read refuses the start);
 * 2. the history-only gate is checked against the files it names;
 * 3. the database's migrations are read: absent or empty opens, unreadable refuses, newer offers a
 *    copy this build can open;
 * 4. a checked copy is made when the data is about to change;
 * 5. the data opens.
 *
 * Steps 1 and 4, every restore or return, and a start with migrations to apply change files, so they
 * need this process to be the only app on the data folder. A new workspace needs nothing, so it
 * opens whatever the one-app check said.
 */

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
  /** A packaged release makes a copy at its first start on existing data. */
  readonly packaged: boolean
  readonly requireExistingDatabase?: boolean
  /**
   * The one-app check's answer. Asked once per check, restore or return, so an answer that was
   * `unknown` may be asked again when the person tries again.
   */
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
  /**
   * Told before the steps of a check that can take a while, so a window can say so: settling an
   * unfinished restore or return, and reading the database, which may copy it, hash a copy to
   * reuse, or make one. Told again only when what it is working on changes.
   */
  readonly working?: (what: WorkingOn) => void
  /** That step's progress. */
  readonly progress?: ProgressListener
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

/**
 * Where a test stops the work: before a journaled step of a restore or return, or after its work
 * and before its journal names it; just after one file's rename; or at a step of making a copy.
 */
export type FaultPoint = Step | CheckpointStep | { readonly move: string; readonly to: Moved['to'] }

/** A fault a test asks for, to stop a copy, a restore or a return at a chosen point. */
export interface RecoveryFaults {
  readonly at: FaultPoint
  /**
   * For a journaled step: after its work, before its journal names it, instead of before its work.
   * For a step of making a copy: before the next step. A rename's fault is always just after it.
   */
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

/**
 * The service with a fault built in, for tests. The fault fires once, the first time its point is
 * reached, so the recovery that follows a stopped restore or return can finish it.
 */
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

/**
 * The launch switch a test passes to keep the recovery window on a hidden launch, so it can drive
 * that window. It changes only what a refused hidden start does next (stay open instead of
 * exiting), never the verdict or any step on the data. Honoured only by a build that is not
 * packaged.
 */
export const KEEP_RECOVERY_WINDOW_SWITCH = 'brobot-test-keep-recovery-window'

/** Whether a hidden launch keeps its recovery window, saying so either way when it was asked. */
export function keepsTheRecoveryWindow(
  asked: boolean,
  packaged: boolean,
  warn: (line: string) => void,
): boolean {
  if (!asked) return false
  if (packaged) {
    warn(`BroCrew ignored --${KEEP_RECOVERY_WINDOW_SWITCH}: a packaged build takes no test switch`)
    return false
  }
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

/**
 * The launch switch a test asks for a fault with: `<step>[,after][,<code>]`, or
 * `move:<live name>:<aside|live|incoming>[,<code>]`. Honoured only by a build that is not packaged.
 */
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

/**
 * The line a start that did not open its data prints after the fail line: the verdict in one
 * sentence, with the check's own detail when it has one.
 */
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

/**
 * Lets go of the recovery copies no longer kept. Only for a start that opened its data, after it
 * said so, and only when it is the sole app on the folder: a copy is never removed while a restore
 * could still want it, or while another app may be reading it.
 */
export async function pruneTheCopies(
  userData: string,
  buildMigrationsFolder: string,
  ownership: Ownership,
  warn: (line: string) => void,
): Promise<string[]> {
  if (ownership !== 'sole') return []
  return prune(userData, await buildLineage(buildMigrationsFolder), { ownership, warn })
}

// ---------------------------------------------------------------------------------------------

const OPEN_NOT_NEEDED: StartupVerdict = { kind: 'open', checkpoint: 'not-needed' }

function failed(reason: StartFailure, canRetry: boolean, detail?: string): StartupVerdict {
  return { kind: 'failed', reason, canRetry, ...(detail === undefined ? {} : { detail }) }
}

/**
 * Another app holds the folder, or sole use could not be confirmed. Only the second may pass on
 * another try, which asks the one-app check again.
 */
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
  // From here the check may copy the database to read it, hash a copy it would reuse, or make one,
  // so it says it is checking before any of them, and that it is making a copy only once it has
  // decided to. After settling a restore or return it goes on naming that until it makes a copy.
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
      return failed('database-unreadable', false, PACKAGED_WORKSPACE_REFUSAL)
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
    case 'foreign':
      return failed(
        'database-unreadable',
        false,
        `${databaseFile(userData)} records migrations this version of BroCrew does not carry, and none later ` +
          'than its own, so no version of BroCrew this one knows made it.',
      )
    case 'fits':
      break
  }

  // Migrations still to apply change the data, so they need the sole app on the folder even when
  // a copy made before them is kept.
  const pending = hasPendingMigrations(applied, lineage)
  const reason = await checkpointNeeded({
    userData,
    database,
    lineage,
    release: deps.packaged ? deps.appVersion : null,
    build: deps.build,
    fs,
  })
  if (reason === null && !pending) return OPEN_NOT_NEEDED
  if (owner !== 'sole') return notTheOnlyApp(owner)
  if (reason === null) return OPEN_NOT_NEEDED
  working('checkpoint')
  const make = (): Promise<Checkpoint> =>
    makeCheckpoint({
      userData,
      ownership: owner,
      appVersion: deps.appVersion,
      build: deps.build,
      reason,
      fs,
      ...(deps.progress === undefined ? {} : { progress: quietly(deps.progress) }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
      ...(deps.freeBytes === undefined ? {} : { freeBytes: deps.freeBytes }),
      ...(deps.log === undefined ? {} : { log: deps.log }),
      ...(deps.beforeCheckpointStep === undefined ? {} : { beforeStep: deps.beforeCheckpointStep }),
    })
  try {
    try {
      await make()
    } catch (error) {
      if (!(error instanceof CheckpointNoRoom)) throw error
      const removed = await prune(userData, lineage, {
        ownership: owner,
        fs,
        ...(deps.now === undefined ? {} : { now: deps.now }),
        includeUnfinished: false,
        currentAppVersion: deps.appVersion,
      })
      try {
        await make()
      } catch (retryError) {
        if (!(retryError instanceof CheckpointNoRoom)) throw retryError
        const first =
          `There isn't enough free space for a recovery copy: it needs about ` +
          `${inWords(retryError.needed)}, and ${inWords(retryError.free)} is free.`
        return failed(
          'checkpoint-failed',
          true,
          removed.length === 0
            ? first
            : `${first} BroCrew already removed its older recovery copies. Free some space, then try again.`,
        )
      }
    }
  } catch (error) {
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

/**
 * The gate stands: the files must still be as the restore installed them, with no sidecar beside
 * the copy. Anything else was put there from outside, and nothing is touched.
 */
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
  // The newest copy a restore would take as it is: its database and every state file restored with
  // it still hash to its manifest; one that does not is passed over for the next.
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

/**
 * The app that moved the database past this build, as the newest copy that says so names it: a copy
 * holding more migrations than this build carries, or one another version made before migrating.
 */
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

/**
 * A restore or return that stopped. One that left its journal is settled at once, as the next start
 * would settle it, so the window shows where the data now stands; one that could not put a file
 * back is not, since trying again at once cannot help. A return that found the files changed
 * outside BroBot since the restore is said as that.
 */
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
