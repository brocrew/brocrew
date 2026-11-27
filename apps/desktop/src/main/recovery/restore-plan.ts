/**
 * What a restore or return reads and checks before it moves anything: the copy's record, the
 * plan, the places, and the sentences a refusal says. Split out of restore.ts as a pure move.
 */
import { dirname, join } from 'node:path'
import type { HistoryOnlyGate, InstalledFile, ProgressListener } from '../../shared/recovery'
import {
  parseGate,
  parseJournal,
  parseManifest,
  parseWorkspaceId,
  roleOf,
  type CheckpointManifest,
  type FileState,
  type Migration,
  type Parsed,
  type Participant,
  type RestoreJournal,
  type RestoreKind,
} from './contract'
import {
  OwnedPathIsALink,
  assertOwnedPathsAreReal,
  nodeFs,
  pathExists,
  privateDir,
  readTextOrNull,
  retrying,
  syncFolder,
  type Content,
  type RecoveryFs,
  type StepHooks,
} from './files'
import {
  DATABASE_FILE,
  FAMILY,
  checkpointDatabase,
  checkpointDir,
  databaseFile,
  fromRecorded,
  gateFile,
  isUuid,
  journalFile,
  manifestFile,
  participantPlaces,
  stateFile,
  workspaceIdFile,
} from './layout'
import { APP_STATE_FILES } from './state-files'
import { stateContentAt as contentAt } from './trees'
import { SKILL_TREES, SKILLS_CONVERSION_FILE } from '../skills/shared-paths'

/** A restore or return that stopped. The message is a sentence a person can read. */
export class RestoreStopped extends Error {
  constructor(
    message: string,
    readonly during: RestoreKind,
    readonly journalLeft: boolean,
    /** False when the copy or the data itself is the reason, so that trying again cannot help. */
    readonly canRetry: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RestoreStopped'
  }
}

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

export class CannotPutBack extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CannotPutBack'
  }
}

/** A record found on disk: none, one this build reads, or one it cannot. */
export type RecordOnDisk<T> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly value: T }
  /** `canRetry` when reading failed; a record that does not parse is never retried. */
  | { readonly kind: 'unreadable'; readonly detail: string; readonly canRetry: boolean }

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

// ---------------------------------------------------------------------------------------------

/** The state files a restore installs and sets aside together with the database. */
export const WITH_THE_DATABASE: readonly string[] = APP_STATE_FILES.filter(
  (file) => file.restore === 'with-the-database',
).map((file) => file.name)

/** Every live name a restore or return moves, in the journal's order. */
export const PARTICIPANT_NAMES: readonly string[] = [...FAMILY, ...WITH_THE_DATABASE]

const NO_SUCH_COPY = 'BroCrew did not find this recovery copy, so it restored nothing.'
const UNREADABLE_COPY =
  "BroCrew could not read this recovery copy's record, so it restored nothing."
const ANOTHER_WORKSPACE =
  'This recovery copy was made for another workspace, so BroCrew restored nothing.'
const NEEDS_A_NEWER_BUILD = 'This copy needs a newer BroCrew. Open it there.'
export const FAILED_CHECK =
  'This recovery copy did not pass its check, so BroCrew restored nothing.'
export const UNFINISHED = 'A restore is unfinished. Restart BroCrew.'
export const ALREADY_RESTORED =
  'This data is already a restored copy, so BroCrew restored nothing over it.'
const NOTHING_TO_SET_ASIDE =
  'This workspace has no database to set aside, so BroCrew restored nothing.'
export const NOT_RESTORED = 'This data is not a restored copy, so there is nothing to return from.'
export const UNREADABLE_GATE =
  'BroCrew could not read the record of this restore, so it changed nothing.'
export const CHANGED_OUTSIDE =
  "This workspace's data was changed outside BroCrew since its copy was restored, so BroCrew changed nothing."
const NEWER_MISSING =
  'The newer data the restore set aside is not where it was left, so BroCrew changed nothing.'
const SET_ASIDE_CHANGED =
  'The newer data the restore set aside was changed outside BroCrew since, so BroCrew changed nothing.'
const RESTORED_FOLDER_TAKEN =
  'The folder for setting the restored copy aside already holds files, so BroCrew changed nothing.'
export const MOVED_MORE = 'Use the newer BroCrew to return to newer data.'

/** A restore or return this build will not make, with the sentence that says why. */
export class Refusal extends Error {}

export function refuse(sentence: string): never {
  throw new Refusal(sentence)
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function stopped(during: RestoreKind, error: unknown, journalLeft: boolean): RestoreStopped {
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

export async function journalIsThere(userData: string, fs: RecoveryFs): Promise<boolean> {
  return pathExists(journalFile(userData), fs).catch(() => true)
}

/** Reports `done` of `total`. A listener that throws, such as a closed window, stops nothing. */
export function ticker(listener: ProgressListener | undefined, total: number): () => void {
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

export type Hooks = Required<StepHooks>

export function hooksOf(options: StepHooks): Hooks {
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

/** A live name's path in the data folder. */
export function livePath(userData: string, live: string): string {
  return FAMILY.includes(live)
    ? `${databaseFile(userData)}${live.slice(DATABASE_FILE.length)}`
    : stateFile(userData, { name: live })
}

export type Place = 'live' | 'aside' | 'incoming'

export function pathOf(userData: string, participant: Participant, place: Place): string {
  return place === 'live'
    ? livePath(userData, participant.live)
    : fromRecorded(userData, participant[place])
}

/** Files leave a folder sidecars first, then state files, then the database. */
export function leavingOrder(participants: readonly Participant[]): Participant[] {
  return (['sidecar', 'state', 'database'] as const).flatMap((role) =>
    participants.filter((participant) => participant.role === role),
  )
}

/** And arrive the database first. */
export function arrivingOrder(participants: readonly Participant[]): Participant[] {
  return leavingOrder(participants).reverse()
}

/** Whether `content` is the file `state` describes: absent, or a file with those bytes. */
export function holds(content: Content, state: FileState): boolean {
  return state.present
    ? content.kind === 'file' && content.sha256 === state.sha256
    : content.kind === 'absent'
}

function stateOf(content: Content): FileState | null {
  if (content.kind === 'absent') return { present: false }
  return content.kind === 'file' ? { present: true, sha256: content.sha256 } : null
}

export async function assertTheRunsPlacesAreReal(
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

export async function ownedFolder(userData: string, folder: string, fs: RecoveryFs): Promise<void> {
  await assertOwnedPathsAreReal(userData, [folder], fs)
  await privateDir(folder, fs)
  await syncFolder(dirname(folder), fs)
}

export async function readTheCheckpoint(
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

export async function planARestore(
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
      becomes = {
        present: true,
        sha256:
          manifest.database.compression === 'gzip'
            ? manifest.database.uncompressedSha256!
            : manifest.database.sha256,
      }
    } else if (role === 'state') {
      const entry = manifest.files.find((file) => file.name === live)
      if (entry?.present === true) becomes = { present: true, sha256: entry.sha256 }
    }
    participants.push({ live, role, ...participantPlaces('restore', id, live), was, becomes })
  }
  return participants
}

export async function planAReturn(
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
    if (await retrying(() => pathExists(fromRecorded(userData, places.aside), fs)))
      refuse(RESTORED_FOLDER_TAKEN)
    participants.push({ live, role, ...places, was, becomes })
  }
  return participants
}

export function asState(entry: InstalledFile): FileState {
  return entry.present ? { present: true, sha256: entry.sha256 } : { present: false }
}

export function namesTheParticipantsThisBuildMoves(journal: RestoreJournal): boolean {
  const names = journal.participants.map((participant) => participant.live)
  const legacy = PARTICIPANT_NAMES.filter(
    (name) => !SKILL_TREES.includes(name) && name !== SKILLS_CONVERSION_FILE,
  )
  return (
    (names.length === PARTICIPANT_NAMES.length &&
      PARTICIPANT_NAMES.every((name) => names.includes(name))) ||
    (names.length === legacy.length && legacy.every((name) => names.includes(name)))
  )
}

/** Where one participant stands. */
export type Where =
  /** Absent before and after: nothing moves. */
  | 'nothing'
  /** Its `was` is live and nothing is aside. */
  | 'before'
  /** Its `was` is aside and its replacement is not live yet. */
  | 'aside'
  /** Its `becomes` is live, and its `was` aside. */
  | 'after'

export async function checkpointCreatedAt(
  userData: string,
  checkpointId: string,
  fs: RecoveryFs,
): Promise<string | null> {
  const text = await readTextOrNull(manifestFile(userData, checkpointId), fs).catch(() => null)
  const parsed = text === null ? null : parseManifest(text)
  return parsed?.ok === true && parsed.value.id === checkpointId ? parsed.value.createdAt : null
}
