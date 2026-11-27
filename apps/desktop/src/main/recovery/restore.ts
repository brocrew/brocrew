import { randomUUID } from 'node:crypto'
import type { HistoryOnlyGate, ProgressListener } from '../../shared/recovery'
import {
  JOURNAL_FORMAT,
  STEPS,
  type CheckpointManifest,
  type Migration,
  type RestoreKind,
} from './contract'
import {
  OwnedPathIsALink,
  assertOwnedPathsAreReal,
  nodeFs,
  sweepLeftovers,
  pathExists,
  type RecoveryFs,
  type StepHooks,
} from './files'
import {
  DATABASE_FILE,
  FAMILY,
  databaseFile,
  gateFile,
  isUuid,
  journalFile,
  recoveryDir,
} from './layout'
import { stateContentAt as contentAt } from './trees'
import { checkFreeSpace } from './checkpoint-space'
import { freeBytesOn } from '../archive/native-file'
export { sweepLeftovers } from './files'
export {
  CannotPutBack,
  ChangedOutside,
  RestoreStopped,
  readGateOnDisk,
  readJournalOnDisk,
  type RecordOnDisk,
} from './restore-plan'
import {
  ALREADY_RESTORED,
  assertTheRunsPlacesAreReal,
  CHANGED_OUTSIDE,
  ChangedOutside,
  holds,
  hooksOf,
  journalIsThere,
  livePath,
  MOVED_MORE,
  namesTheParticipantsThisBuildMoves,
  NOT_RESTORED,
  ownedFolder,
  PARTICIPANT_NAMES,
  planARestore,
  planAReturn,
  readGateOnDisk,
  readJournalOnDisk,
  readTheCheckpoint,
  Refusal,
  refuse,
  RestoreStopped,
  stopped,
  ticker,
  UNFINISHED,
  UNREADABLE_GATE,
  WITH_THE_DATABASE,
} from './restore-plan'
import {
  abandon,
  back,
  decide,
  forward,
  gateFor,
  publish,
  type Run,
  stage,
  startedRun,
  stepOf,
  writeTheGate,
} from './restore-run'

export interface RestoreEngineOptions extends StepHooks {
  readonly userData: string
  readonly fs?: RecoveryFs
  /** Told at the start, then once per step. */
  readonly progress?: ProgressListener
}

export interface RestoreOptions extends RestoreEngineOptions {
  readonly checkpointId: string
  /** Available disk bytes, or null when they cannot be read. */
  readonly freeBytes?: (path: string) => number | null
  /** Whether this build can open a database that applied these migrations, oldest first. */
  readonly canOpen: (migrations: readonly Migration[]) => boolean
  readonly now?: () => Date
  /** Names the restore's folders: a random UUID when not given. */
  readonly newId?: () => string
}

export interface ReturnOptions extends RestoreEngineOptions {
  readonly now?: () => Date
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
    if (!(await sweepLeftovers(userData, fs)))
      throw new Error('BroCrew could not remove a temporary recovery copy. Try again.')
    const incomingBytes =
      (manifest.database.compression === 'gzip'
        ? manifest.database.uncompressedBytes!
        : manifest.database.bytes) +
      manifest.files.reduce(
        (bytes, file) =>
          bytes + (file.present && WITH_THE_DATABASE.includes(file.name) ? file.bytes : 0),
        0,
      )
    checkFreeSpace(userData, incomingBytes, options.freeBytes ?? freeBytesOn)
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
