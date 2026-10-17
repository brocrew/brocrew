import type { HistoryOnlyGate, InstalledFile, PreservedFile } from '../../shared/recovery'
import {
  COPY_FILE,
  DATABASE_FILE,
  FAMILY,
  isSafeName,
  isUuid,
  participantPlaces,
  preservedAsRecorded,
} from './layout'

/**
 * The three recovery records, version 1: a checkpoint's manifest, the restore journal and the
 * history-only gate.
 *
 * Parsing is strict. An unknown `format`, a `version` other than 1, or a known field that is
 * missing or of the wrong type refuses the whole record with a reason; nothing is guessed, since a
 * record read wrongly could move or hide a database. Fields this build does not know are allowed:
 * the parsed value is the record itself, so they stay on it and are written back when it is
 * rewritten.
 */

export type { HistoryOnlyGate, InstalledFile, PreservedFile }

export const MANIFEST_FORMAT = 'brobot-checkpoint'
export const JOURNAL_FORMAT = 'brobot-restore'
export const GATE_FORMAT = 'brobot-history-only'

export const CHECKPOINT_REASONS = ['first-start-of-release', 'before-migration'] as const
export type CheckpointReason = (typeof CHECKPOINT_REASONS)[number]

/** Whether a restore installs a state file with the database or leaves the live one in place. */
export const RESTORE_RULES = ['with-the-database', 'kept-current'] as const
export type RestoreRule = (typeof RESTORE_RULES)[number]

/** The journal's steps, in order. The journal names each one once its work is done. */
export const STEPS = ['planned', 'staged', 'gate-installed', 'moving', 'installed', 'done'] as const
export type Step = (typeof STEPS)[number]

export type RestoreKind = 'restore' | 'return'

/** What a journal participant is: the database's main file, one of its sidecars, or a state file. */
export const PARTICIPANT_ROLES = ['database', 'sidecar', 'state'] as const
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number]

/** One applied migration, as the migrator records it: its journal `when` and its sha256. */
export interface Migration {
  readonly createdAt: number
  readonly hash: string
}

/** A file as a record knows it: there with these bytes (full sha256, hex), or not there. */
export type FileState =
  { readonly present: true; readonly sha256: string } | { readonly present: false }

export interface CheckpointManifest {
  readonly format: typeof MANIFEST_FORMAT
  readonly version: 1
  /** The checkpoint's folder name. */
  readonly id: string
  /** ISO. */
  readonly createdAt: string
  /** The content of `backups/workspace-id` when the copy was made. */
  readonly workspaceId: string
  readonly reason: CheckpointReason
  readonly madeBy: { readonly appVersion: string; readonly build: string | null }
  readonly database: {
    readonly file: typeof COPY_FILE
    readonly bytes: number
    readonly sha256: string
    /** Read from the copy's own migration record, oldest first. */
    readonly migrations: readonly Migration[]
  }
  /** Every app state file, copied beside the database, or recorded as absent. */
  readonly files: readonly ManifestFile[]
}

export type ManifestFile =
  | { readonly name: string; readonly present: false }
  | {
      readonly name: string
      readonly present: true
      readonly bytes: number
      readonly sha256: string
    }

/**
 * One file a restore or return moves. `aside` and `incoming` are relative to the data folder and
 * `/`-separated; they are always the places this build computes for the participant (see
 * `participantPlaces`), and a journal naming any other is refused.
 */
export interface Participant {
  readonly live: string
  readonly role: ParticipantRole
  /** Where the live file is set aside. */
  readonly aside: string
  /** Where the file that replaces it waits. */
  readonly incoming: string
  /** The live file before the swap. */
  readonly was: FileState
  /** The live file after it. */
  readonly becomes: FileState
}

export interface RestoreJournal {
  readonly format: typeof JOURNAL_FORMAT
  readonly version: 1
  /** The restore's id, which names its staged and preserved folders. */
  readonly id: string
  readonly kind: RestoreKind
  readonly checkpointId: string
  /** ISO. */
  readonly startedAt: string
  /** The last step whose work is done. */
  readonly step: Step
  /** The database family's four names and each state file restored with the database. */
  readonly participants: readonly Participant[]
}

export type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

export function parseManifest(text: string): Parsed<CheckpointManifest> {
  return parseWith(text, MANIFEST_FORMAT, readManifest)
}

export function parseJournal(text: string): Parsed<RestoreJournal> {
  return parseWith(text, JOURNAL_FORMAT, readJournal)
}

export function parseGate(text: string): Parsed<HistoryOnlyGate> {
  return parseWith(text, GATE_FORMAT, readGate)
}

/** The record as file text. Throws when this build would refuse to read it back. */
export function serializeManifest(manifest: CheckpointManifest): string {
  return serializeChecked(manifest, parseManifest, 'manifest')
}

export function serializeJournal(journal: RestoreJournal): string {
  return serializeChecked(journal, parseJournal, 'restore journal')
}

export function serializeGate(gate: HistoryOnlyGate): string {
  return serializeChecked(gate, parseGate, 'history-only gate')
}

/** The id in `backups/workspace-id`, or null when the text is not one. */
export function parseWorkspaceId(text: string): string | null {
  const id = text.trim()
  return isUuid(id) ? id : null
}

/** Whether two file states say the same: both absent, or both present with the same bytes. */
export function sameState(a: FileState, b: FileState): boolean {
  return a.present ? b.present && a.sha256 === b.sha256 : !b.present
}

/** A participant's role, from its live name. */
export function roleOf(live: string): ParticipantRole {
  if (live === DATABASE_FILE) return 'database'
  return FAMILY.includes(live) ? 'sidecar' : 'state'
}

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason)
}

type Fields = Readonly<Record<string, unknown>>

function parseWith<T>(text: string, format: string, read: (record: Fields) => T): Parsed<T> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'it is not JSON' }
  }
  try {
    const record = fields(value, 'the record')
    if (record.format !== format) refuse(`its format is not "${format}"`)
    if (record.version === undefined) refuse('it has no version')
    if (record.version !== 1) {
      refuse(`its version is ${JSON.stringify(record.version)}, and this build reads version 1`)
    }
    return { ok: true, value: read(record) }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message }
    throw error
  }
}

function serializeChecked<T>(value: T, parse: (text: string) => Parsed<T>, what: string): string {
  const text = `${JSON.stringify(value, null, 2)}\n`
  const back = parse(text)
  if (!back.ok) throw new Error(`this ${what} would not be read back: ${back.reason}`)
  return text
}

function fields(value: unknown, where: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${where} is not an object`)
  }
  return value as Fields
}

function field(record: Fields, key: string, where: string): unknown {
  if (!Object.hasOwn(record, key)) refuse(`${where}.${key} is missing`)
  return record[key]
}

function text(record: Fields, key: string, where: string): string {
  const value = field(record, key, where)
  if (typeof value !== 'string' || value === '') refuse(`${where}.${key} is not a non-empty string`)
  return value
}

function name(record: Fields, key: string, where: string): string {
  const value = text(record, key, where)
  if (!isSafeName(value)) refuse(`${where}.${key} is not a file name every system accepts`)
  return value
}

function uuid(record: Fields, key: string, where: string): string {
  const value = text(record, key, where)
  if (!isUuid(value)) refuse(`${where}.${key} is not an id BroCrew made`)
  return value
}

/** An ISO 8601 date and time with its offset, as `Date.prototype.toISOString` writes one. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function instant(record: Fields, key: string, where: string): string {
  const value = text(record, key, where)
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    refuse(`${where}.${key} is not an ISO date and time`)
  }
  return value
}

function byteCount(record: Fields, key: string, where: string): number {
  const value = field(record, key, where)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    refuse(`${where}.${key} is not a whole number of zero or more`)
  }
  return value
}

function sha256(record: Fields, key: string, where: string): string {
  const value = field(record, key, where)
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    refuse(`${where}.${key} is not a sha256`)
  }
  return value
}

function bool(record: Fields, key: string, where: string): boolean {
  const value = field(record, key, where)
  if (typeof value !== 'boolean') refuse(`${where}.${key} is not true or false`)
  return value
}

function oneOf<T extends string>(
  record: Fields,
  key: string,
  values: readonly T[],
  where: string,
): T {
  const value = field(record, key, where)
  if (!values.includes(value as T)) refuse(`${where}.${key} is not one of ${values.join(', ')}`)
  return value as T
}

function list(record: Fields, key: string, where: string): readonly unknown[] {
  const value = field(record, key, where)
  if (!Array.isArray(value)) refuse(`${where}.${key} is not a list`)
  return value
}

function nested(record: Fields, key: string, where: string): Fields {
  return fields(field(record, key, where), `${where}.${key}`)
}

/**
 * A file's presence and, when present, its sha256. An absent file has no sha256: a record that
 * gives one is contradicting itself.
 */
function fileState(record: Fields, where: string): FileState {
  if (bool(record, 'present', where))
    return { present: true, sha256: sha256(record, 'sha256', where) }
  if (record.sha256 !== undefined && record.sha256 !== null) {
    refuse(`${where} is absent and has a sha256`)
  }
  return { present: false }
}

function readManifest(record: Fields): CheckpointManifest {
  const where = 'manifest'
  uuid(record, 'id', where)
  instant(record, 'createdAt', where)
  uuid(record, 'workspaceId', where)
  oneOf(record, 'reason', CHECKPOINT_REASONS, where)

  const madeBy = nested(record, 'madeBy', where)
  text(madeBy, 'appVersion', `${where}.madeBy`)
  const build = field(madeBy, 'build', `${where}.madeBy`)
  if (build !== null && (typeof build !== 'string' || build === '')) {
    refuse(`${where}.madeBy.build is neither null nor a non-empty string`)
  }

  const database = nested(record, 'database', where)
  oneOf(database, 'file', [COPY_FILE], `${where}.database`)
  byteCount(database, 'bytes', `${where}.database`)
  sha256(database, 'sha256', `${where}.database`)
  let before = Number.NEGATIVE_INFINITY
  list(database, 'migrations', `${where}.database`).forEach((entry, index) => {
    const here = `${where}.database.migrations[${String(index)}]`
    const migration = fields(entry, here)
    const createdAt = field(migration, 'createdAt', here)
    if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt)) {
      refuse(`${here}.createdAt is not a whole number`)
    }
    if (createdAt <= before) refuse(`${where}.database.migrations is not oldest first`)
    before = createdAt
    sha256(migration, 'hash', here)
  })

  const seen = new Set<string>()
  list(record, 'files', where).forEach((entry, index) => {
    const here = `${where}.files[${String(index)}]`
    const one = fields(entry, here)
    const file = name(one, 'name', here)
    if (seen.has(file)) refuse(`${where}.files names ${file} twice`)
    seen.add(file)
    if (bool(one, 'present', here)) {
      byteCount(one, 'bytes', here)
      sha256(one, 'sha256', here)
    }
  })
  return record as unknown as CheckpointManifest
}

function readJournal(record: Fields): RestoreJournal {
  const where = 'journal'
  const id = uuid(record, 'id', where)
  const kind = oneOf(record, 'kind', ['restore', 'return'], where)
  uuid(record, 'checkpointId', where)
  instant(record, 'startedAt', where)
  oneOf(record, 'step', STEPS, where)

  const seen = new Set<string>()
  list(record, 'participants', where).forEach((entry, index) => {
    const here = `${where}.participants[${String(index)}]`
    const one = fields(entry, here)
    const live = name(one, 'live', here)
    if (seen.has(live)) refuse(`${where}.participants names ${live} twice`)
    seen.add(live)
    const role = oneOf(one, 'role', PARTICIPANT_ROLES, here)
    if (role !== roleOf(live)) refuse(`${here}.role is not what ${live} is`)
    const places = participantPlaces(kind, id, live)
    if (text(one, 'aside', here) !== places.aside) refuse(`${here}.aside is not ${places.aside}`)
    if (text(one, 'incoming', here) !== places.incoming) {
      refuse(`${here}.incoming is not ${places.incoming}`)
    }
    const was = fileState(nested(one, 'was', here), `${here}.was`)
    const becomes = fileState(nested(one, 'becomes', here), `${here}.becomes`)
    if (role === 'database' && !(was.present && becomes.present)) {
      refuse(`${here} is the database, which must be there before and after`)
    }
  })
  for (const member of FAMILY) {
    if (!seen.has(member)) refuse(`${where}.participants leaves out ${member}`)
  }
  return record as unknown as RestoreJournal
}

function readGate(record: Fields): HistoryOnlyGate {
  const where = 'gate'
  const restoreId = uuid(record, 'restoreId', where)
  uuid(record, 'checkpointId', where)
  instant(record, 'checkpointCreatedAt', where)

  liveFiles(record, 'installed', where).forEach(({ live, state, here }) => {
    if (roleOf(live) === 'sidecar' && state.present) {
      refuse(`${here} is a sidecar, and the restored copy is one file`)
    }
  })

  const preserved = text(record, 'preserved', where)
  if (preserved !== preservedAsRecorded(restoreId)) {
    refuse(`${where}.preserved is not ${preservedAsRecorded(restoreId)}`)
  }
  liveFiles(record, 'preservedFiles', where)
  return record as unknown as HistoryOnlyGate
}

/**
 * A gate's list of live files: each named once by a name every system accepts, the database among
 * them and present.
 */
function liveFiles(
  record: Fields,
  key: string,
  where: string,
): { readonly live: string; readonly state: FileState; readonly here: string }[] {
  const seen = new Set<string>()
  const found = list(record, key, where).map((entry, index) => {
    const here = `${where}.${key}[${String(index)}]`
    const one = fields(entry, here)
    const live = name(one, 'live', here)
    if (seen.has(live)) refuse(`${where}.${key} names ${live} twice`)
    seen.add(live)
    const state = fileState(one, here)
    if (roleOf(live) === 'database' && !state.present) {
      refuse(`${here} is the database, which is there`)
    }
    return { live, state, here }
  })
  if (!seen.has(DATABASE_FILE)) refuse(`${where}.${key} leaves out ${DATABASE_FILE}`)
  return found
}
