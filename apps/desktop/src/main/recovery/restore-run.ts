/**
 * A restore or return as it runs: staging, moving each file forward or back, the gate, and the
 * decision after an interrupted run. Split out of restore.ts as a pure move.
 */
import { dirname, join } from 'node:path'
import type { HistoryOnlyGate } from '../../shared/recovery'
import {
  GATE_FORMAT,
  sameState,
  serializeGate,
  serializeJournal,
  type CheckpointManifest,
  type FileState,
  type Participant,
  type RestoreJournal,
  type Step,
} from './contract'
import { inRollbackMode, migrationsOf } from './database-facts'
import {
  assertOwnedPathsAreReal,
  copyDurably,
  errorCode,
  remove,
  removeIfEmpty,
  sweepLeftovers,
  pathExists,
  retrying,
  syncFolder,
  writeAtomically,
  type Content,
  type Moved,
  type RecoveryFs,
} from './files'
import {
  DATABASE_FILE,
  checkpointDatabase,
  checkpointDir,
  gateFile,
  journalFile,
  preservedAsRecorded,
  preservedDir,
  preservedRoot,
  recoveryDir,
  restoredAsideDir,
  stagedDir,
  stagedRoot,
} from './layout'
import { copySkillTree, stateContentAt as contentAt } from './trees'
import { gunzipCheckpoint } from './checkpoint-compression'
import { SKILL_TREES } from '../skills/shared-paths'
import {
  arrivingOrder,
  asState,
  CannotPutBack,
  checkpointCreatedAt,
  FAILED_CHECK,
  holds,
  type Hooks,
  leavingOrder,
  messageOf,
  ownedFolder,
  pathOf,
  type Place,
  readGateOnDisk,
  refuse,
  type Where,
} from './restore-plan'

export interface Run {
  readonly userData: string
  readonly fs: RecoveryFs
  readonly hooks: Hooks
  readonly tick: () => void
  journal: RestoreJournal
  readonly where: Map<string, Where>
}

export function startedRun(
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

export async function publish(run: Run, step: Step): Promise<void> {
  run.journal = { ...run.journal, step }
  const path = journalFile(run.userData)
  await assertOwnedPathsAreReal(run.userData, [path], run.fs)
  await writeAtomically(path, serializeJournal(run.journal), run.fs)
}

/** One step: its work between the hooks, then the journal names it. */
export async function stepOf(run: Run, step: Step, work: () => Promise<void>): Promise<void> {
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

export async function stage(run: Run, manifest: CheckpointManifest): Promise<void> {
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
    if (participant.role === 'database' && manifest.database.compression === 'gzip') {
      const compressed = await contentAt(source, fs)
      if (compressed.kind !== 'file' || compressed.sha256 !== manifest.database.sha256)
        refuse(FAILED_CHECK)
      await gunzipCheckpoint(source, copy, manifest.database.uncompressedBytes!, fs)
    } else if (SKILL_TREES.includes(participant.live)) await copySkillTree(source, copy, fs)
    else await copyDurably(source, copy, fs)
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

/** After a restore refused its copy while staging: its staged folder and journal go. */
export async function abandon(run: Run): Promise<void> {
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

export function gateFor(journal: RestoreJournal, checkpointCreatedAt: string): HistoryOnlyGate {
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

export async function writeTheGate(run: Run, gate: HistoryOnlyGate): Promise<void> {
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

async function isPermanent(error: unknown, fs: RecoveryFs): Promise<boolean> {
  if (!(error instanceof MoveFailed)) return false
  const code = errorCode(error.failure)
  if (code === 'EXDEV') return true
  return code === 'ENOENT' && (await pathExists(error.from, fs).catch(() => false))
}

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

export async function forward(run: Run): Promise<Outcome> {
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

export async function back(run: Run, undoing?: unknown): Promise<void> {
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

export async function decide(
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
