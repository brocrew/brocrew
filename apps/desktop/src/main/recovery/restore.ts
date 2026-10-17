import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { HistoryOnlyGate, InstalledFile, ProgressListener } from '../../shared/recovery'
import { keepNoMoreOpenThanTheData } from '../data-folder-privacy'
import {
  GATE_FORMAT,
  JOURNAL_FORMAT,
  STEPS,
  parseGate,
  parseJournal,
  parseManifest,
  parseWorkspaceId,
  roleOf,
  sameState,
  serializeGate,
  serializeJournal,
  type CheckpointManifest,
  type FileState,
  type Migration,
  type Parsed,
  type Participant,
  type RestoreJournal,
  type RestoreKind,
  type Step,
} from './contract'
import { migrationsOf } from './database-facts'
import {
  OwnedPathIsALink,
  assertOwnedPathsAreReal,
  contentAt,
  copyDurably,
  errorCode,
  nodeFs,
  pathExists,
  privateDir,
  readTextOrNull,
  retrying,
  syncFolder,
  writeAtomically,
  type Content,
  type Moved,
  type RecoveryFs,
  type StepHooks,
} from './files'
import {
  DATABASE_FILE,
  FAMILY,
  GATE_FILE,
  JOURNAL_FILE,
  checkpointDatabase,
  checkpointDir,
  databaseFile,
  fromRecorded,
  gateFile,
  isUuid,
  journalFile,
  manifestFile,
  participantPlaces,
  preservedAsRecorded,
  preservedDir,
  preservedRoot,
  recoveryDir,
  restoredAsideDir,
  scratchDir,
  stagedDir,
  stagedRoot,
  stateFile,
  workspaceIdFile,
} from './layout'
import { APP_STATE_FILES } from './state-files'

/**
 * The restore engine: it installs a checkpoint's copy as the workspace's database, puts the newer
 * data back later, and settles either one that a crash or a failure left unfinished.
 *
 * Both are a plan over participants: the database, each of its three sidecars and each state file
 * restored with the database, present or not. For each the journal records the live file before
 * (`was`) and after (`becomes`) by full sha256, where it is set aside and where its replacement
 * waits. The journal is rewritten atomically after each step's work, naming it:
 * 1. `planned`: the participants, with `was` read from the live files;
 * 2. `staged`: a restore copies the checkpoint's files into `recovery/staged/<id>/`, each put on
 *    disk and checked against `becomes`; a return's newer files already wait in
 *    `recovery/preserved/<id>/`;
 * 3. `gate-installed`: a restore writes the history-only gate; a return's already stands;
 * 4. `moving`: every live file present is renamed aside, then every replacement into place;
 * 5. `installed`: every live file is checked against `becomes`;
 * 6. `done`: a restore removes its staged folder, a return its gate, and then the journal goes.
 *
 * Files only move by rename, and a move never replaces a file. Files leave the data folder
 * sidecars first and the database last, and arrive the database first, so the data folder never
 * holds a sidecar or a state file beside a database it did not come with.
 *
 * {@link recoverInterrupted} decides from the disk, not from the journal's step, since a step's
 * renames and the journal's rewrite may reach the disk in either order. It finds each participant
 * by full hashes: its `was` live, its `was` aside, or its `becomes` live. When every one is found it
 * finishes when the replacements still pass their check and otherwise puts every `was` back. One
 * that matches none of its identities stops it before it touches anything.
 *
 * The gate records what the restore set aside as well as what it installed, since the journal goes
 * once the restore is done: a return plans from both, and refuses when the set-aside files are not
 * exactly those, absent ones included.
 *
 * Every database handle on the live family must be closed before any of these run. The engine opens
 * none on it.
 */

/** A restore or return that stopped. The message is a sentence a person can read. */
export class RestoreStopped extends Error {
  constructor(
    message: string,
    readonly during: RestoreKind,
    /**
     * Whether a journal is left on disk. {@link recoverInterrupted} finishes or undoes the work
     * from it, and must run before the data is opened.
     */
    readonly journalLeft: boolean,
    /** False when the copy or the data itself is the reason, so that trying again cannot help. */
    readonly canRetry: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RestoreStopped'
  }
}

export interface RestoreEngineOptions extends StepHooks {
  readonly userData: string
  readonly fs?: RecoveryFs
  /** Told at the start, then once per step. */
  readonly progress?: ProgressListener
}

export interface RestoreOptions extends RestoreEngineOptions {
  readonly checkpointId: string
  /** Whether this build can open a database that applied these migrations, oldest first. */
  readonly canOpen: (migrations: readonly Migration[]) => boolean
  readonly now?: () => Date
  /** Names the restore's folders: a random UUID when not given. */
  readonly newId?: () => string
}

export interface ReturnOptions extends RestoreEngineOptions {
  readonly now?: () => Date
}

/**
 * A return refused because files the gate records were changed outside BroBot since the restore:
 * the restored ones in place, or the newer ones it set aside. Nothing was touched.
 */
export class ChangedOutside extends Error {
  constructor(
    message: string,
    /** When the restored copy was made, as the gate records it. */
    readonly checkpointCreatedAt: string,
  ) {
    super(message)
    this.name = 'ChangedOutside'
  }
}

/**
 * A file that could not be put back for a reason trying again cannot change, such as a folder that
 * is now on another disk. Every file stays where it is and the journal stays, so the next start that
 * owns the data folder tries again once the cause is put right.
 */
export class CannotPutBack extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CannotPutBack'
  }
}

export interface Restored {
  readonly gate: HistoryOnlyGate
  /** The restored copy, now the workspace's database. */
  readonly database: string
}

export interface Returned {
  /** The newer database, back in its place. */
  readonly database: string
}

/** What {@link recoverInterrupted} found and did. */
export type Recovered =
  | { readonly kind: 'nothing-to-do' }
  /** The restore or return was finished as it was asked for. */
  | { readonly kind: 'finished'; readonly what: RestoreKind }
  /** It could not be finished, so every file was put back as it was before it began. */
  | { readonly kind: 'rolled-back'; readonly what: RestoreKind; readonly detail: string }
  /** A file matches none of the journal's identities for it. Nothing was touched. */
  | { readonly kind: 'replaced-outside'; readonly where: 'journal'; readonly detail: string }
  /** The journal cannot be read as one. Nothing was touched. */
  | { readonly kind: 'unreadable'; readonly detail: string }

/** A record found on disk: none, one this build reads, or one it cannot. */
export type RecordOnDisk<T> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly value: T }
  /** `canRetry` when reading failed; a record that does not parse is never retried. */
  | { readonly kind: 'unreadable'; readonly detail: string; readonly canRetry: boolean }

/**
 * Installs checkpoint `checkpointId` as the workspace's database, behind the history-only gate.
 *
 * Throws {@link RestoreStopped}. With `journalLeft` false nothing in the data folder changed. With
 * it true the files stand where the failure left them, and {@link recoverInterrupted} settles them.
 */
export async function restore(options: RestoreOptions): Promise<Restored> {
  const fs = options.fs ?? nodeFs
  const { userData, checkpointId } = options
  const hooks = hooksOf(options)
  const tick = ticker(options.progress, STEPS.length)
  const id = (options.newId ?? randomUUID)()

  let run: Run
  let manifest: CheckpointManifest
  try {
    if (!isUuid(id)) throw new Error(`"${id}" cannot name a restore`)
    await assertOwnedPathsAreReal(userData, [], fs)
    if (await pathExists(journalFile(userData), fs)) refuse(UNFINISHED)
    if (await pathExists(gateFile(userData), fs)) refuse(ALREADY_RESTORED)
    manifest = await readTheCheckpoint(userData, checkpointId, options.canOpen, fs)
    await sweepLeftovers(userData, fs)
    await assertTheRunsPlacesAreReal(userData, 'restore', id, fs)
    hooks.beforeStep('planned')
    const participants = await planARestore(userData, id, manifest, fs)
    hooks.afterStep('planned')
    run = startedRun(userData, fs, hooks, tick, {
      format: JOURNAL_FORMAT,
      version: 1,
      id,
      kind: 'restore',
      checkpointId,
      startedAt: (options.now?.() ?? new Date()).toISOString(),
      step: 'planned',
      participants,
    })
  } catch (error) {
    throw stopped('restore', error, false)
  }

  try {
    await ownedFolder(userData, recoveryDir(userData), fs)
    await keepNoMoreOpenThanTheData(recoveryDir(userData), userData)
    await publish(run, 'planned')
    tick()
  } catch (error) {
    throw stopped('restore', error, await journalIsThere(userData, fs))
  }

  try {
    await stepOf(run, 'staged', () => stage(run, manifest))
  } catch (error) {
    if (error instanceof Refusal || error instanceof OwnedPathIsALink) await abandon(run)
    throw stopped('restore', error, await journalIsThere(userData, fs))
  }

  const gate = gateFor(run.journal, manifest.createdAt)
  try {
    await stepOf(run, 'gate-installed', () => writeTheGate(run, gate))
    const outcome = await forward(run)
    if (outcome.kind === 'rolled-back') {
      throw new RestoreStopped(outcome.detail, 'restore', false, false)
    }
  } catch (error) {
    throw stopped('restore', error, await journalIsThere(userData, fs))
  }
  return { gate, database: databaseFile(userData) }
}

/**
 * Sets the restored copy aside and puts the newer data the restore preserved back in its place,
 * then removes the gate.
 *
 * Throws {@link RestoreStopped}, as {@link restore} does.
 */
export async function returnToNewer(options: ReturnOptions): Promise<Returned> {
  const fs = options.fs ?? nodeFs
  const { userData } = options
  const hooks = hooksOf(options)
  const tick = ticker(options.progress, STEPS.length)

  let run: Run
  try {
    await assertOwnedPathsAreReal(userData, [], fs)
    if (await pathExists(journalFile(userData), fs)) refuse(UNFINISHED)
    const found = await readGateOnDisk(userData, fs)
    if (found.kind === 'absent') refuse(NOT_RESTORED)
    if (found.kind === 'unreadable') {
      if (found.canRetry) throw new Error(found.detail)
      refuse(UNREADABLE_GATE)
    }
    const gate = found.value
    if (
      [...gate.installed, ...gate.preservedFiles].some(
        (entry) => !PARTICIPANT_NAMES.includes(entry.live),
      )
    ) {
      refuse(MOVED_MORE)
    }
    await assertTheRunsPlacesAreReal(userData, 'return', gate.restoreId, fs)
    const changed = await whatChangedSinceTheGate(userData, gate, fs)
    if (changed !== null) {
      throw new ChangedOutside(`${CHANGED_OUTSIDE} ${changed}`, gate.checkpointCreatedAt)
    }
    hooks.beforeStep('planned')
    const participants = await planAReturn(userData, gate, fs)
    hooks.afterStep('planned')
    run = startedRun(userData, fs, hooks, tick, {
      format: JOURNAL_FORMAT,
      version: 1,
      id: gate.restoreId,
      kind: 'return',
      checkpointId: gate.checkpointId,
      startedAt: (options.now?.() ?? new Date()).toISOString(),
      step: 'planned',
      participants,
    })
  } catch (error) {
    throw stopped('return', error, false)
  }

  try {
    await publish(run, 'planned')
    tick()
    // The newer files already wait where the restore set them aside, as the plan hashed them, and
    // the gate already stands; the journal still names both steps, as a restore's does.
    await stepOf(run, 'staged', () => Promise.resolve())
    await stepOf(run, 'gate-installed', () => Promise.resolve())
    const outcome = await forward(run)
    if (outcome.kind === 'rolled-back') {
      throw new RestoreStopped(outcome.detail, 'return', false, false)
    }
  } catch (error) {
    throw stopped('return', error, await journalIsThere(userData, fs))
  }
  return { database: databaseFile(userData) }
}

/**
 * Settles a restore or return that a crash or a failure left unfinished.
 *
 * With no journal it only removes what a restore stopped before its journal can leave, so it is
 * cheap to run at every start. Throws {@link RestoreStopped} when a file operation fails, leaving
 * the journal for the next try.
 */
export async function recoverInterrupted(options: RestoreEngineOptions): Promise<Recovered> {
  const fs = options.fs ?? nodeFs
  const { userData } = options

  const found = await readJournalOnDisk(userData, fs)
  if (found.kind === 'absent') {
    await sweepLeftovers(userData, fs)
    return { kind: 'nothing-to-do' }
  }
  if (found.kind === 'unreadable') {
    if (found.canRetry) throw new RestoreStopped(found.detail, 'restore', true, true)
    return { kind: 'unreadable', detail: found.detail }
  }
  const journal = found.value
  if (!namesTheParticipantsThisBuildMoves(journal)) {
    return {
      kind: 'unreadable',
      detail: 'The restore record names files this build does not restore with the database.',
    }
  }

  try {
    await assertTheRunsPlacesAreReal(userData, journal.kind, journal.id, fs)
  } catch (error) {
    if (error instanceof OwnedPathIsALink) {
      return { kind: 'replaced-outside', where: 'journal', detail: error.message }
    }
    throw stopped(journal.kind, error, true)
  }

  try {
    const decided = await decide(userData, journal, fs)
    if (decided.kind === 'replaced-outside') {
      return { kind: 'replaced-outside', where: 'journal', detail: decided.detail }
    }
    if (decided.kind === 'unreadable') return { kind: 'unreadable', detail: decided.detail }

    const steps = decided.kind === 'back' ? 2 : 3 + (decided.gate === null ? 0 : 1)
    const run: Run = {
      userData,
      fs,
      hooks: hooksOf(options),
      tick: ticker(options.progress, steps),
      journal,
      where: decided.where,
    }
    if (decided.kind === 'back') {
      await back(run)
      return { kind: 'rolled-back', what: journal.kind, detail: decided.detail }
    }
    if (decided.gate !== null) {
      const gate = decided.gate
      await stepOf(run, 'gate-installed', () => writeTheGate(run, gate))
    }
    const outcome = await forward(run)
    return outcome.kind === 'finished'
      ? { kind: 'finished', what: journal.kind }
      : { kind: 'rolled-back', what: journal.kind, detail: outcome.detail }
  } catch (error) {
    throw stopped(journal.kind, error, true)
  }
}

/**
 * Whether the files are still as the gate says the restore left them: every listed file by full
 * sha256, and no sidecar beside the restored copy. Null when they are; otherwise a sentence that
 * says what changed.
 */
export async function whatChangedSinceTheGate(
  userData: string,
  gate: HistoryOnlyGate,
  fs: RecoveryFs = nodeFs,
): Promise<string | null> {
  for (const name of FAMILY.slice(1)) {
    if (await pathExists(livePath(userData, name), fs)) {
      return `${name} is beside the restored copy, which is one file.`
    }
  }
  for (const entry of gate.installed) {
    const content = await contentAt(livePath(userData, entry.live), fs)
    if (!holds(content, entry)) {
      return entry.live === DATABASE_FILE
        ? `${DATABASE_FILE} is no longer the restored copy.`
        : `${entry.live} is no longer as the restore left it.`
    }
  }
  return null
}

/** The restore journal on disk. A read that keeps failing can be tried again; a bad record cannot. */
export function readJournalOnDisk(
  userData: string,
  fs: RecoveryFs = nodeFs,
): Promise<RecordOnDisk<RestoreJournal>> {
  return recordOnDisk(journalFile(userData), parseJournal, 'restore record', fs)
}

/** The history-only gate on disk, read as {@link readJournalOnDisk} reads the journal. */
export function readGateOnDisk(
  userData: string,
  fs: RecoveryFs = nodeFs,
): Promise<RecordOnDisk<HistoryOnlyGate>> {
  return recordOnDisk(gateFile(userData), parseGate, 'history-only record', fs)
}

/**
 * Removes what a restore that stopped before its journal can leave, and what an interrupted read
 * left in the scratch folder: id-named folders in `recovery/staged/` and `recovery/scratch/`, and
 * temporary record files. Does nothing while a journal is on disk, since its staged folder is still
 * in use, or when an owned folder is a link. Best effort: a leftover costs space and never changes
 * what is restored.
 */
export async function sweepLeftovers(userData: string, fs: RecoveryFs = nodeFs): Promise<void> {
  try {
    await assertOwnedPathsAreReal(userData, [], fs)
    if (await pathExists(journalFile(userData), fs)) return
  } catch {
    return
  }
  const entriesOf = (folder: string): Promise<string[]> => fs.readdir(folder).catch(() => [])
  for (const root of [stagedRoot(userData), scratchDir(userData)]) {
    for (const entry of await entriesOf(root)) {
      if (!isUuid(entry)) continue
      await remove(userData, join(root, entry), fs).catch(() => undefined)
    }
    await removeIfEmpty(userData, root, fs).catch(() => undefined)
  }
  for (const entry of await entriesOf(recoveryDir(userData))) {
    if (isRecordLeftover(entry)) {
      await remove(userData, join(recoveryDir(userData), entry), fs).catch(() => undefined)
    }
  }
}

// ---------------------------------------------------------------------------------------------

/** The state files a restore installs and sets aside together with the database. */
const WITH_THE_DATABASE: readonly string[] = APP_STATE_FILES.filter(
  (file) => file.restore === 'with-the-database',
).map((file) => file.name)

/** Every live name a restore or return moves, in the journal's order. */
const PARTICIPANT_NAMES: readonly string[] = [...FAMILY, ...WITH_THE_DATABASE]

const NO_SUCH_COPY = 'BroCrew did not find this recovery copy, so it restored nothing.'
const UNREADABLE_COPY =
  "BroCrew could not read this recovery copy's record, so it restored nothing."
const ANOTHER_WORKSPACE =
  'This recovery copy was made for another workspace, so BroCrew restored nothing.'
const NEEDS_A_NEWER_BUILD =
  'This recovery copy needs a newer version of BroCrew to open it, so this one restored nothing.'
const FAILED_CHECK = 'This recovery copy did not pass its check, so BroCrew restored nothing.'
const UNFINISHED =
  'A restore or return is still unfinished on this data, so BroCrew started no other.'
const ALREADY_RESTORED =
  'This data is already a restored copy, so BroCrew restored nothing over it.'
const NOTHING_TO_SET_ASIDE =
  'This workspace has no database to set aside, so BroCrew restored nothing.'
const NOT_RESTORED = 'This data is not a restored copy, so there is nothing to return from.'
const UNREADABLE_GATE = 'BroCrew could not read the record of this restore, so it changed nothing.'
const CHANGED_OUTSIDE =
  "This workspace's data was changed outside BroCrew since its copy was restored, so BroCrew changed nothing."
const NEWER_MISSING =
  'The newer data the restore set aside is not where it was left, so BroCrew changed nothing.'
const SET_ASIDE_CHANGED =
  'The newer data the restore set aside was changed outside BroCrew since, so BroCrew changed nothing.'
const RESTORED_FOLDER_TAKEN =
  'The folder for setting the restored copy aside already holds files, so BroCrew changed nothing.'
const MOVED_MORE =
  'This copy was restored by a newer version of BroCrew, which moved files this one does not, so this one changed nothing. Return to the newer data with that version of BroCrew.'

/** A restore or return this build will not make, with the sentence that says why. */
class Refusal extends Error {}

function refuse(sentence: string): never {
  throw new Refusal(sentence)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stopped(during: RestoreKind, error: unknown, journalLeft: boolean): RestoreStopped {
  if (error instanceof RestoreStopped) return error
  if (
    error instanceof Refusal ||
    error instanceof OwnedPathIsALink ||
    error instanceof ChangedOutside ||
    error instanceof CannotPutBack
  ) {
    return new RestoreStopped(error.message, during, journalLeft, false, { cause: error })
  }
  const message = journalLeft
    ? `The ${during} stopped part way through, and BroCrew finishes or undoes it before this data is opened: ${messageOf(error)}`
    : `The ${during} stopped before it changed this workspace's data: ${messageOf(error)}`
  return new RestoreStopped(message, during, journalLeft, true, { cause: error })
}

async function journalIsThere(userData: string, fs: RecoveryFs): Promise<boolean> {
  return pathExists(journalFile(userData), fs).catch(() => true)
}

/** Reports `done` of `total`. A listener that throws, such as a closed window, stops nothing. */
function ticker(listener: ProgressListener | undefined, total: number): () => void {
  let done = 0
  const report = (): void => {
    try {
      listener?.(done, total)
    } catch {
      // Progress is only shown; the work goes on without it.
    }
  }
  report()
  return () => {
    done = Math.min(done + 1, total)
    report()
  }
}

type Hooks = Required<StepHooks>

function hooksOf(options: StepHooks): Hooks {
  return {
    beforeStep: options.beforeStep ?? (() => undefined),
    afterStep: options.afterStep ?? (() => undefined),
    afterMove: options.afterMove ?? (() => undefined),
  }
}

async function recordOnDisk<T>(
  path: string,
  parse: (text: string) => Parsed<T>,
  what: string,
  fs: RecoveryFs,
): Promise<RecordOnDisk<T>> {
  let text: string | null
  try {
    text = await readTextOrNull(path, fs)
  } catch (error) {
    return {
      kind: 'unreadable',
      canRetry: true,
      detail: `BroCrew could not read its ${what}: ${messageOf(error)}`,
    }
  }
  if (text === null) return { kind: 'absent' }
  const parsed = parse(text)
  return parsed.ok
    ? { kind: 'present', value: parsed.value }
    : {
        kind: 'unreadable',
        canRetry: false,
        detail: `BroCrew could not read its ${what} (${path}): ${parsed.reason}.`,
      }
}

// ---------------------------------------------------------------------------------------------
// Places

/** A live name's path in the data folder. */
function livePath(userData: string, live: string): string {
  return FAMILY.includes(live)
    ? `${databaseFile(userData)}${live.slice(DATABASE_FILE.length)}`
    : stateFile(userData, { name: live })
}

type Place = 'live' | 'aside' | 'incoming'

function pathOf(userData: string, participant: Participant, place: Place): string {
  return place === 'live'
    ? livePath(userData, participant.live)
    : fromRecorded(userData, participant[place])
}

/** Files leave a folder sidecars first, then state files, then the database. */
function leavingOrder(participants: readonly Participant[]): Participant[] {
  return (['sidecar', 'state', 'database'] as const).flatMap((role) =>
    participants.filter((participant) => participant.role === role),
  )
}

/** And arrive the database first. */
function arrivingOrder(participants: readonly Participant[]): Participant[] {
  return leavingOrder(participants).reverse()
}

/** Whether `content` is the file `state` describes: absent, or a file with those bytes. */
function holds(content: Content, state: FileState): boolean {
  return state.present
    ? content.kind === 'file' && content.sha256 === state.sha256
    : content.kind === 'absent'
}

function stateOf(content: Content): FileState | null {
  if (content.kind === 'absent') return { present: false }
  return content.kind === 'file' ? { present: true, sha256: content.sha256 } : null
}

/**
 * Refuses, before anything is read or moved, when any place a restore or return with this id uses
 * is a link or passes through one: the journal, the gate, and each participant's places, which
 * include the run's own staged and preserved folders.
 */
async function assertTheRunsPlacesAreReal(
  userData: string,
  kind: RestoreKind,
  id: string,
  fs: RecoveryFs,
): Promise<void> {
  const places = PARTICIPANT_NAMES.flatMap((live) => {
    const { aside, incoming } = participantPlaces(kind, id, live)
    return [fromRecorded(userData, aside), fromRecorded(userData, incoming)]
  })
  await assertOwnedPathsAreReal(
    userData,
    [journalFile(userData), gateFile(userData), ...places],
    fs,
  )
}

/**
 * Makes one of the app's own folders (0700) once nothing on the way to it is a link, and puts its
 * entry in its parent on disk, so what is then renamed into it survives a power cut.
 */
async function ownedFolder(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  await assertOwnedPathsAreReal(userData, [folder], fs)
  await privateDir(folder, fs)
  await syncFolder(dirname(folder), fs)
}

/** Removes a file or a folder and all it holds, once nothing on the way to it is a link. */
async function remove(userData: string, path: string, fs: RecoveryFs): Promise<void> {
  await assertOwnedPathsAreReal(userData, [path], fs)
  await retrying(() => fs.rm(path, { recursive: true, force: true }))
}

/** Removes a folder only when nothing is in it. */
async function removeIfEmpty(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(folder)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  if (entries.length === 0) await remove(userData, folder, fs)
}

/** Whether `name` is a temporary file `writeAtomically` left while writing the journal or gate. */
function isRecordLeftover(name: string): boolean {
  return [JOURNAL_FILE, GATE_FILE].some(
    (record) =>
      name.startsWith(`${record}.`) && /^\.[0-9a-f]{12}\.tmp$/.test(name.slice(record.length)),
  )
}

// ---------------------------------------------------------------------------------------------
// Planning

async function readTheCheckpoint(
  userData: string,
  checkpointId: string,
  canOpen: (migrations: readonly Migration[]) => boolean,
  fs: RecoveryFs,
): Promise<CheckpointManifest> {
  if (!isUuid(checkpointId)) refuse(NO_SUCH_COPY)
  const folder = checkpointDir(userData, checkpointId)
  await assertOwnedPathsAreReal(
    userData,
    [
      manifestFile(userData, checkpointId),
      checkpointDatabase(userData, checkpointId),
      ...WITH_THE_DATABASE.map((name) => join(folder, name)),
    ],
    fs,
  )
  const text = await readTextOrNull(manifestFile(userData, checkpointId), fs)
  if (text === null) refuse(NO_SUCH_COPY)
  const parsed = parseManifest(text)
  if (!parsed.ok || parsed.value.id !== checkpointId) refuse(UNREADABLE_COPY)
  const manifest = parsed.value
  const workspace = await readTextOrNull(workspaceIdFile(userData), fs)
  if (workspace === null || parseWorkspaceId(workspace) !== manifest.workspaceId) {
    refuse(ANOTHER_WORKSPACE)
  }
  if (!canOpen(manifest.database.migrations)) refuse(NEEDS_A_NEWER_BUILD)
  return manifest
}

/**
 * A restore's participants: each live file as it is now, and what the checkpoint puts in its place.
 * The sidecars become absent, since the copy is one file. State files come from this build's
 * registry; the manifest only says whether the copy holds each one, and with what bytes.
 */
async function planARestore(
  userData: string,
  id: string,
  manifest: CheckpointManifest,
  fs: RecoveryFs,
): Promise<Participant[]> {
  const participants: Participant[] = []
  for (const live of PARTICIPANT_NAMES) {
    const role = roleOf(live)
    const was = stateOf(await contentAt(livePath(userData, live), fs))
    if (was === null) refuse(`${live} is not a file, so BroCrew restored nothing.`)
    if (role === 'database' && !was.present) refuse(NOTHING_TO_SET_ASIDE)
    let becomes: FileState = { present: false }
    if (role === 'database') {
      becomes = { present: true, sha256: manifest.database.sha256 }
    } else if (role === 'state') {
      const entry = manifest.files.find((file) => file.name === live)
      if (entry?.present === true) becomes = { present: true, sha256: entry.sha256 }
    }
    participants.push({ live, role, ...participantPlaces('restore', id, live), was, becomes })
  }
  return participants
}

/**
 * A return's participants: each live file as the gate says the restore left it, and each newer
 * file as the gate says the restore set it aside. Every set-aside file is hashed again, and must
 * be exactly that, absence included: a file the gate does not list must not be there. The places
 * the restored files go must be free.
 */
async function planAReturn(
  userData: string,
  gate: HistoryOnlyGate,
  fs: RecoveryFs,
): Promise<Participant[]> {
  const participants: Participant[] = []
  for (const live of PARTICIPANT_NAMES) {
    const role = roleOf(live)
    const places = participantPlaces('return', gate.restoreId, live)
    const installed = gate.installed.find((entry) => entry.live === live)
    const was: FileState | null =
      installed === undefined
        ? stateOf(await contentAt(livePath(userData, live), fs))
        : asState(installed)
    if (was === null) throw new ChangedOutside(CHANGED_OUTSIDE, gate.checkpointCreatedAt)
    const setAside = gate.preservedFiles.find((entry) => entry.live === live)
    const becomes: FileState = setAside === undefined ? { present: false } : asState(setAside)
    const waiting = await contentAt(fromRecorded(userData, places.incoming), fs)
    if (!holds(waiting, becomes)) {
      throw new ChangedOutside(
        becomes.present && waiting.kind === 'absent'
          ? `${NEWER_MISSING} ${places.incoming} is gone.`
          : `${SET_ASIDE_CHANGED} ${places.incoming} is ${becomes.present ? 'not the file it set aside' : 'there, and it set none aside there'}.`,
        gate.checkpointCreatedAt,
      )
    }
    if ((await contentAt(fromRecorded(userData, places.aside), fs)).kind !== 'absent') {
      refuse(RESTORED_FOLDER_TAKEN)
    }
    participants.push({ live, role, ...places, was, becomes })
  }
  return participants
}

function asState(entry: InstalledFile): FileState {
  return entry.present ? { present: true, sha256: entry.sha256 } : { present: false }
}

function namesTheParticipantsThisBuildMoves(journal: RestoreJournal): boolean {
  const names = journal.participants.map((participant) => participant.live)
  return (
    names.length === PARTICIPANT_NAMES.length &&
    PARTICIPANT_NAMES.every((name) => names.includes(name))
  )
}

// ---------------------------------------------------------------------------------------------
// Running the steps, shared by a run and by the recovery that finishes it

/** Where one participant stands. */
type Where =
  /** Absent before and after: nothing moves. */
  | 'nothing'
  /** Its `was` is live and nothing is aside. */
  | 'before'
  /** Its `was` is aside and its replacement is not live yet. */
  | 'aside'
  /** Its `becomes` is live, and its `was` aside. */
  | 'after'

interface Run {
  readonly userData: string
  readonly fs: RecoveryFs
  readonly hooks: Hooks
  readonly tick: () => void
  journal: RestoreJournal
  readonly where: Map<string, Where>
}

function startedRun(
  userData: string,
  fs: RecoveryFs,
  hooks: Hooks,
  tick: () => void,
  journal: RestoreJournal,
): Run {
  const where = new Map<string, Where>(
    journal.participants.map((participant) => [
      participant.live,
      participant.was.present || participant.becomes.present ? 'before' : 'nothing',
    ]),
  )
  return { userData, fs, hooks, tick, journal, where }
}

async function publish(run: Run, step: Step): Promise<void> {
  run.journal = { ...run.journal, step }
  const path = journalFile(run.userData)
  await assertOwnedPathsAreReal(run.userData, [path], run.fs)
  await writeAtomically(path, serializeJournal(run.journal), run.fs)
}

/** One step: its work between the hooks, then the journal names it. */
async function stepOf(run: Run, step: Step, work: () => Promise<void>): Promise<void> {
  run.hooks.beforeStep(step)
  await work()
  run.hooks.afterStep(step)
  await publish(run, step)
  run.tick()
}

function participantNamed(run: Run, live: string): Participant {
  const found = run.journal.participants.find((participant) => participant.live === live)
  if (found === undefined) throw new Error(`the journal has no ${live}`)
  return found
}

/**
 * Restore step 2: each file the checkpoint puts in place is copied into the staged folder, put on
 * disk, and checked there against the plan, so what is installed is what was checked.
 */
async function stage(run: Run, manifest: CheckpointManifest): Promise<void> {
  const { userData, fs } = run
  await ownedFolder(userData, stagedRoot(userData), fs)
  await ownedFolder(userData, stagedDir(userData, run.journal.id), fs)
  for (const participant of run.journal.participants) {
    if (!participant.becomes.present) continue
    const source =
      participant.role === 'database'
        ? checkpointDatabase(userData, manifest.id)
        : join(checkpointDir(userData, manifest.id), participant.live)
    const copy = pathOf(userData, participant, 'incoming')
    await assertOwnedPathsAreReal(userData, [source, copy], fs)
    if (!(await pathExists(source, fs))) refuse(FAILED_CHECK)
    await copyDurably(source, copy, fs)
    if (!holds(await contentAt(copy, fs), participant.becomes)) refuse(FAILED_CHECK)
  }

  // A copy in rollback mode is one file: reading it read-only creates nothing beside it.
  const copy = pathOf(userData, participantNamed(run, DATABASE_FILE), 'incoming')
  if (!(await inRollbackMode(copy, fs))) refuse(FAILED_CHECK)
  const recorded = await migrationsOf(copy, { fs })
  const listed = manifest.database.migrations
  if (
    recorded.kind !== 'recorded' ||
    recorded.migrations.length !== listed.length ||
    listed.some(
      (migration, index) =>
        recorded.migrations[index]?.createdAt !== migration.createdAt ||
        recorded.migrations[index]?.hash !== migration.hash,
    )
  ) {
    refuse(FAILED_CHECK)
  }
}

/** Whether a SQLite file's header says rollback-journal mode: bytes 18 and 19 are both 1. */
async function inRollbackMode(path: string, fs: RecoveryFs): Promise<boolean> {
  const header = new Uint8Array(20)
  const handle = await fs.open(path, 'r')
  try {
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    return bytesRead === header.length && header[18] === 1 && header[19] === 1
  } finally {
    await handle.close()
  }
}

/** After a restore refused its copy while staging: its staged folder and journal go. */
async function abandon(run: Run): Promise<void> {
  const { userData, fs } = run
  try {
    await remove(userData, stagedDir(userData, run.journal.id), fs)
    await removeIfEmpty(userData, stagedRoot(userData), fs)
    await removeTheJournal(run)
    await removeIfEmpty(userData, recoveryDir(userData), fs)
  } catch {
    // The journal stays, and the next recovery undoes what is left.
  }
}

function gateFor(journal: RestoreJournal, checkpointCreatedAt: string): HistoryOnlyGate {
  return {
    format: GATE_FORMAT,
    version: 1,
    restoreId: journal.id,
    checkpointId: journal.checkpointId,
    checkpointCreatedAt,
    installed: journal.participants.map(({ live, becomes }) => ({ live, ...becomes })),
    preserved: preservedAsRecorded(journal.id),
    preservedFiles: journal.participants.map(({ live, was }) => ({ live, ...was })),
  }
}

async function writeTheGate(run: Run, gate: HistoryOnlyGate): Promise<void> {
  const path = gateFile(run.userData)
  await assertOwnedPathsAreReal(run.userData, [path], run.fs)
  await writeAtomically(path, serializeGate(gate), run.fs)
}

/** A rename that failed, with the participant it was for. */
class MoveFailed extends Error {
  constructor(
    readonly live: string,
    readonly from: string,
    readonly to: string,
    readonly failure: unknown,
  ) {
    super(`BroCrew could not move ${live}: ${messageOf(failure)}`, { cause: failure })
    this.name = 'MoveFailed'
  }
}

/**
 * Renames one participant's file from one of its places to another, never onto a file already
 * there, then tells the hook.
 */
async function move(run: Run, participant: Participant, from: Place, to: Place): Promise<void> {
  const { userData, fs } = run
  const source = pathOf(userData, participant, from)
  const target = pathOf(userData, participant, to)
  await assertOwnedPathsAreReal(userData, [source, target], fs)
  if (await pathExists(target, fs)) {
    throw new Error(`${target} is already there, so BroCrew did not move ${source} onto it`)
  }
  try {
    await retrying(() => fs.rename(source, target))
  } catch (error) {
    throw new MoveFailed(participant.live, source, target, error)
  }
  const moved: Moved = { live: participant.live, to }
  run.hooks.afterMove(moved)
}

/**
 * Whether a move failed for a reason that trying again cannot change: the destination is on another
 * disk, or its folder is gone while the file to move is still there.
 */
async function isPermanent(error: unknown, fs: RecoveryFs): Promise<boolean> {
  if (!(error instanceof MoveFailed)) return false
  const code = errorCode(error.failure)
  if (code === 'EXDEV') return true
  return code === 'ENOENT' && (await pathExists(error.from, fs).catch(() => false))
}

/**
 * The stop of a run that could not put a file back, said once with its cause: what stopped the run
 * when it was being undone, and why the file cannot go back.
 */
function cannotPutBack(run: Run, failed: MoveFailed, undoing: unknown): CannotPutBack {
  const why =
    errorCode(failed.failure) === 'EXDEV'
      ? `${dirname(failed.to)} is on another disk than ${dirname(failed.from)}, and a file cannot move between disks without being copied`
      : `${dirname(failed.to)} is gone`
  const stoppedBy =
    undoing === undefined ? '' : `The ${run.journal.kind} stopped: ${messageOf(undoing)}. `
  return new CannotPutBack(
    `${stoppedBy}BroCrew could not put ${failed.live} back where it was, because ${why} ` +
      `(${errorCode(failed.failure) ?? 'no code'}). Trying again as things stand cannot change ` +
      'that, so BroCrew left every file where it is and tries again the next time it starts.',
    { cause: failed },
  )
}

/** The folders a run's renames changed, flushed so the renames reach the disk before the journal. */
async function syncTheFolders(run: Run, places: readonly Place[]): Promise<void> {
  const folders = new Set<string>()
  for (const participant of run.journal.participants) {
    for (const place of places) folders.add(dirname(pathOf(run.userData, participant, place)))
  }
  for (const folder of folders) {
    if (await pathExists(folder, run.fs)) await syncFolder(folder, run.fs)
  }
}

/** The folder a run sets files aside in. */
function asideFolder(run: Run): string {
  return run.journal.kind === 'restore'
    ? preservedDir(run.userData, run.journal.id)
    : restoredAsideDir(run.userData, run.journal.id)
}

type Outcome =
  { readonly kind: 'finished' } | { readonly kind: 'rolled-back'; readonly detail: string }

/**
 * Steps 4 to 6 from wherever each participant stands. A move that cannot succeed by trying again
 * puts every `was` back instead, so a later start is not left trying it for good.
 */
async function forward(run: Run): Promise<Outcome> {
  run.hooks.beforeStep('moving')
  try {
    await ownedFolder(run.userData, preservedRoot(run.userData), run.fs)
    await ownedFolder(run.userData, asideFolder(run), run.fs)
    for (const participant of leavingOrder(run.journal.participants)) {
      if (run.where.get(participant.live) !== 'before') continue
      if (participant.was.present) await move(run, participant, 'live', 'aside')
      run.where.set(participant.live, 'aside')
    }
    for (const participant of arrivingOrder(run.journal.participants)) {
      if (run.where.get(participant.live) !== 'aside') continue
      if (participant.becomes.present) await move(run, participant, 'incoming', 'live')
      run.where.set(participant.live, 'after')
    }
    await syncTheFolders(run, ['live', 'aside', 'incoming'])
  } catch (error) {
    if (!(await isPermanent(error, run.fs))) throw error
    await back(run, error)
    const what = run.journal.kind === 'restore' ? 'newer data' : 'restored copy'
    return {
      kind: 'rolled-back',
      detail: `${messageOf(error)}. BroCrew put the ${what} back as it was.`,
    }
  }
  run.hooks.afterStep('moving')
  await publish(run, 'moving')
  run.tick()

  await stepOf(run, 'installed', async () => {
    for (const participant of run.journal.participants) {
      const content = await contentAt(pathOf(run.userData, participant, 'live'), run.fs)
      if (!holds(content, participant.becomes)) {
        throw new Error(`${participant.live} is not what the ${run.journal.kind} installed`)
      }
    }
  })

  run.hooks.beforeStep('done')
  const { userData, fs } = run
  if (run.journal.kind === 'restore') {
    await remove(userData, stagedDir(userData, run.journal.id), fs)
    await removeIfEmpty(userData, stagedRoot(userData), fs)
    await syncFolder(recoveryDir(userData), fs)
  } else {
    await remove(userData, gateFile(userData), fs)
    await syncFolder(recoveryDir(userData), fs)
    await removeIfEmpty(userData, preservedDir(userData, run.journal.id), fs)
  }
  run.hooks.afterStep('done')
  await publish(run, 'done')
  await removeTheJournal(run)
  run.tick()
  return { kind: 'finished' }
}

/**
 * Puts every `was` back: each installed file returns to where it waited, then each file set aside
 * returns to its place. A restore then removes its staged folder and its gate; a return keeps the
 * gate, since the restored copy is live again. `undoing` is what stopped the run, when something
 * did. A move back that trying again cannot help throws {@link CannotPutBack}.
 */
async function back(run: Run, undoing?: unknown): Promise<void> {
  const { userData, fs } = run
  run.hooks.beforeStep('moving')
  try {
    for (const participant of leavingOrder(run.journal.participants)) {
      if (run.where.get(participant.live) !== 'after') continue
      if (participant.becomes.present) {
        // A restore's staged folder may be gone already; the installed file goes back into it.
        const waiting = dirname(pathOf(userData, participant, 'incoming'))
        await ownedFolder(userData, dirname(waiting), fs)
        await ownedFolder(userData, waiting, fs)
        await move(run, participant, 'live', 'incoming')
      }
      run.where.set(participant.live, 'aside')
    }
    for (const participant of arrivingOrder(run.journal.participants)) {
      if (run.where.get(participant.live) !== 'aside') continue
      if (participant.was.present) await move(run, participant, 'aside', 'live')
      run.where.set(participant.live, 'before')
    }
  } catch (error) {
    if (await isPermanent(error, fs)) throw cannotPutBack(run, error as MoveFailed, undoing)
    throw error
  }
  await syncTheFolders(run, ['live', 'aside', 'incoming'])
  run.hooks.afterStep('moving')
  run.tick()

  run.hooks.beforeStep('done')
  if (run.journal.kind === 'restore') {
    await remove(userData, stagedDir(userData, run.journal.id), fs)
    await removeIfEmpty(userData, stagedRoot(userData), fs)
    await remove(userData, gateFile(userData), fs)
    await syncFolder(recoveryDir(userData), fs)
  }
  await removeIfEmpty(userData, asideFolder(run), fs)
  await removeIfEmpty(userData, preservedRoot(userData), fs)
  run.hooks.afterStep('done')
  await removeTheJournal(run)
  if (run.journal.kind === 'restore') await removeIfEmpty(userData, recoveryDir(userData), fs)
  run.tick()
}

async function removeTheJournal(run: Run): Promise<void> {
  await remove(run.userData, journalFile(run.userData), run.fs)
  await syncFolder(recoveryDir(run.userData), run.fs)
  await sweepLeftovers(run.userData, run.fs)
}

// ---------------------------------------------------------------------------------------------
// Deciding from the disk

type Decision =
  | {
      readonly kind: 'forward'
      readonly where: Map<string, Where>
      /** The gate a restore still has to write, or null when it stands. */
      readonly gate: HistoryOnlyGate | null
    }
  | { readonly kind: 'back'; readonly where: Map<string, Where>; readonly detail: string }
  | { readonly kind: 'replaced-outside'; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly detail: string }

const SAID: Record<Content['kind'], string> = {
  absent: 'not there',
  file: 'a file',
  other: 'not a file',
}

/**
 * Where one participant stands, from the files at its three places, or null when they fit no state
 * a restore or return can leave: a file at none of its identities, one in two places, or a file
 * waiting where nothing is to arrive.
 */
function whereIs(
  participant: Participant,
  live: Content,
  aside: Content,
  incoming: Content,
): Where | null {
  const { was, becomes } = participant
  if ([live, aside, incoming].some((content) => content.kind === 'other')) return null
  if (!becomes.present && incoming.kind !== 'absent') return null
  if (!was.present && !becomes.present) {
    return live.kind === 'absent' && aside.kind === 'absent' ? 'nothing' : null
  }
  if (holds(live, was) && aside.kind === 'absent') return 'before'
  if (was.present && holds(aside, was) && live.kind === 'absent') {
    return becomes.present ? 'aside' : 'after'
  }
  if (becomes.present && holds(live, becomes) && holds(aside, was) && incoming.kind === 'absent') {
    return 'after'
  }
  return null
}

async function decide(
  userData: string,
  journal: RestoreJournal,
  fs: RecoveryFs,
): Promise<Decision> {
  const where = new Map<string, Where>()
  let ready = true
  let notReady = ''
  for (const participant of journal.participants) {
    const at = (place: Place): Promise<Content> =>
      contentAt(pathOf(userData, participant, place), fs)
    const [live, aside, incoming] = [await at('live'), await at('aside'), await at('incoming')]
    const found = whereIs(participant, live, aside, incoming)
    if (found === null) {
      return {
        kind: 'replaced-outside',
        detail:
          `${participant.live} is not where the ${journal.kind} left it: live it is ` +
          `${describe(live, participant)}, set aside it is ${describe(aside, participant)}, and ` +
          `waiting it is ${describe(incoming, participant)}.`,
      }
    }
    where.set(participant.live, found)
    if (
      (found === 'before' || found === 'aside') &&
      participant.becomes.present &&
      !holds(incoming, participant.becomes)
    ) {
      ready = false
      notReady ||= `The ${participant.live} the ${journal.kind} was to install is ${incoming.kind === 'absent' ? 'gone' : 'no longer what it checked'}.`
    }
  }

  // A restore's journal names `staged` only once every staged file passed all its checks, which
  // are more than its hash, and nothing moves before that journal is on disk.
  if (journal.kind === 'restore' && journal.step === 'planned') {
    ready = false
    notReady = 'The restore stopped before the copy it was to install had been checked.'
  }

  const gate = await readGateOnDisk(userData, fs)
  if (gate.kind === 'unreadable') {
    if (gate.canRetry) throw new Error(gate.detail)
    return { kind: 'unreadable', detail: gate.detail }
  }
  if (gate.kind === 'present' && !isTheGateOf(gate.value, journal)) {
    return {
      kind: 'replaced-outside',
      detail: 'The history-only record belongs to another restore.',
    }
  }
  const states = [...where.values()]
  const moved = states.some((state) => state === 'aside' || state === 'after')
  const allInstalled = states.every((state) => state === 'after' || state === 'nothing')
  if (gate.kind === 'absent') {
    if (journal.kind === 'restore' && moved) {
      return {
        kind: 'replaced-outside',
        detail: 'The history-only record is gone, and files had already moved.',
      }
    }
    if (journal.kind === 'return' && !allInstalled) {
      return {
        kind: 'replaced-outside',
        detail: 'The history-only record is gone, and the return had not finished.',
      }
    }
  }

  if (!ready) return { kind: 'back', where, detail: notReady }
  if (journal.kind === 'return' || gate.kind === 'present') {
    return { kind: 'forward', where, gate: null }
  }
  const createdAt = await checkpointCreatedAt(userData, journal.checkpointId, fs)
  if (createdAt === null) {
    return {
      kind: 'back',
      where,
      detail: 'The record of the copy being restored is gone, so its date is not known.',
    }
  }
  return { kind: 'forward', where, gate: gateFor(journal, createdAt) }
}

function describe(content: Content, participant: Participant): string {
  if (content.kind !== 'file') return SAID[content.kind]
  const { was, becomes } = participant
  if (was.present && content.sha256 === was.sha256) return 'the file from before'
  if (becomes.present && content.sha256 === becomes.sha256) return 'the file it installs'
  return 'a file BroCrew did not put there'
}

/**
 * Whether `gate` is the one this journal's restore wrote: the same ids, each file it lists as
 * installed as the journal says the restore left it, and each file it lists as set aside as the
 * journal says the restore found it. A restore's own gate lists every participant on both sides.
 * The gate a return starts from may list fewer installed (the database alone is a whole gate), and
 * the return took the others as it found them; a set-aside file it does not list was absent.
 */
function isTheGateOf(gate: HistoryOnlyGate, journal: RestoreJournal): boolean {
  if (gate.restoreId !== journal.id || gate.checkpointId !== journal.checkpointId) return false
  const { participants } = journal
  const restoring = journal.kind === 'restore'
  if (
    restoring &&
    (gate.installed.length !== participants.length ||
      gate.preservedFiles.length !== participants.length)
  ) {
    return false
  }
  const listedAs = (live: string): Participant | undefined =>
    participants.find((one) => one.live === live)
  const installedAsLeft = gate.installed.every((entry) => {
    const participant = listedAs(entry.live)
    if (participant === undefined) return false
    return sameState(asState(entry), restoring ? participant.becomes : participant.was)
  })
  const setAsideAsFound = participants.every((participant) => {
    const entry = gate.preservedFiles.find((one) => one.live === participant.live)
    const setAside: FileState = entry === undefined ? { present: false } : asState(entry)
    return sameState(setAside, restoring ? participant.was : participant.becomes)
  })
  return (
    installedAsLeft &&
    setAsideAsFound &&
    gate.preservedFiles.every((entry) => listedAs(entry.live) !== undefined)
  )
}

async function checkpointCreatedAt(
  userData: string,
  checkpointId: string,
  fs: RecoveryFs,
): Promise<string | null> {
  const text = await readTextOrNull(manifestFile(userData, checkpointId), fs).catch(() => null)
  const parsed = text === null ? null : parseManifest(text)
  return parsed?.ok === true && parsed.value.id === checkpointId ? parsed.value.createdAt : null
}
