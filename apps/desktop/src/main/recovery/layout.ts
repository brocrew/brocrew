import { join } from 'node:path'

/**
 * Where the database, the recovery copies and the restore records live in a data folder.
 *
 * Copies and set-aside databases are never named `brobot2.sqlite`: deleting a workspace and
 * resetting a data folder both refuse when a sub-folder holds a file with that name, since it would
 * look like another workspace.
 */

/** The live database, beside its sidecars. */
export const DATABASE_FILE = 'brobot2.sqlite'

/** The files SQLite keeps beside a database, named by suffix. */
export const SIDECARS = ['-wal', '-shm', '-journal'] as const

/** A database copy's name inside a checkpoint, staged or preserved folder. */
export const COPY_FILE = 'database.sqlite'

export const BACKUPS_DIRNAME = 'backups'
export const RECOVERY_DIRNAME = 'recovery'

export const WORKSPACE_ID_FILE = 'workspace-id'
export const MANIFEST_FILE = 'manifest.json'
/** The empty file a checkpoint folder holds until its manifest is written. */
export const UNFINISHED_FILE = 'unfinished'
export const JOURNAL_FILE = 'restore-journal.json'
export const GATE_FILE = 'history-only.json'
export const STAGED_DIRNAME = 'staged'
export const PRESERVED_DIRNAME = 'preserved'
export const SCRATCH_DIRNAME = 'scratch'

/** What a return adds to a restore's id to name the folder the restored copy is set aside in. */
const RESTORED_SUFFIX = '-restored'

/** A random UUID as `crypto.randomUUID` writes one: version 4, lowercase. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Whether `text` is an id this app made: every checkpoint, restore and workspace id is one. */
export function isUuid(text: string): boolean {
  return UUID.test(text)
}

/** Names Windows gives to devices, with or without an extension: `NUL`, `con.json`, `COM1.txt`. */
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

/**
 * Whether `name` can stand as one path segment on every system the app runs on: letters, digits,
 * `.`, `_` and `-`, starting with a letter or digit, not ending in a dot, and not a name Windows
 * keeps for a device. File names read from a record pass this before they reach a path, so a
 * record cannot point outside its folder or at a device.
 */
export function isSafeName(name: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) &&
    !name.endsWith('.') &&
    !WINDOWS_DEVICE.test(name)
  )
}

function segment(name: string): string {
  if (!isSafeName(name)) throw new Error(`"${name}" is not a file or folder name`)
  return name
}

function id(text: string): string {
  if (!isUuid(text)) throw new Error(`"${text}" is not an id BroCrew made`)
  return text
}

/** A database file and the sidecars that may sit beside it, main file first. */
export function familyOf(main: string): string[] {
  return [main, ...SIDECARS.map((suffix) => `${main}${suffix}`)]
}

/** The live family's names: `brobot2.sqlite` and its sidecars. */
export const FAMILY: readonly string[] = familyOf(DATABASE_FILE)

/**
 * A live file's name inside a recovery folder: the database family as `database.sqlite*`, so each
 * sidecar stays paired with its main file, and a state file under its own name.
 */
export function copyNameOf(live: string): string {
  return FAMILY.includes(live) ? `${COPY_FILE}${live.slice(DATABASE_FILE.length)}` : segment(live)
}

export function databaseFile(userData: string): string {
  return join(userData, DATABASE_FILE)
}

/** An app state file directly in the data folder (see `state-files.ts`). */
export function stateFile(userData: string, file: { readonly name: string }): string {
  return join(userData, segment(file.name))
}

export function backupsDir(userData: string): string {
  return join(userData, BACKUPS_DIRNAME)
}

/** One random id per workspace, written once; every manifest repeats it. */
export function workspaceIdFile(userData: string): string {
  return join(backupsDir(userData), WORKSPACE_ID_FILE)
}

export function checkpointDir(userData: string, checkpointId: string): string {
  return join(backupsDir(userData), id(checkpointId))
}

export function manifestFile(userData: string, checkpointId: string): string {
  return join(checkpointDir(userData, checkpointId), MANIFEST_FILE)
}

export function checkpointDatabase(userData: string, checkpointId: string): string {
  return join(checkpointDir(userData, checkpointId), COPY_FILE)
}

export function recoveryDir(userData: string): string {
  return join(userData, RECOVERY_DIRNAME)
}

export function journalFile(userData: string): string {
  return join(recoveryDir(userData), JOURNAL_FILE)
}

export function gateFile(userData: string): string {
  return join(recoveryDir(userData), GATE_FILE)
}

/** `recovery/staged`, which holds one folder per restore under way. */
export function stagedRoot(userData: string): string {
  return join(recoveryDir(userData), STAGED_DIRNAME)
}

/** `recovery/preserved`, which holds what restores and returns set aside. */
export function preservedRoot(userData: string): string {
  return join(recoveryDir(userData), PRESERVED_DIRNAME)
}

/** `recovery/scratch`, where a database is read through a private copy of it. */
export function scratchDir(userData: string): string {
  return join(recoveryDir(userData), SCRATCH_DIRNAME)
}

export function stagedDir(userData: string, restoreId: string): string {
  return join(stagedRoot(userData), id(restoreId))
}

/** Where a restore set the newer data aside. */
export function preservedDir(userData: string, restoreId: string): string {
  return join(preservedRoot(userData), id(restoreId))
}

/** Where a return set the restored copy aside. */
export function restoredAsideDir(userData: string, restoreId: string): string {
  return join(preservedRoot(userData), `${id(restoreId)}${RESTORED_SUFFIX}`)
}

/** The preserved folder as the gate records it: relative to the data folder, `/`-separated. */
export function preservedAsRecorded(restoreId: string): string {
  return `${RECOVERY_DIRNAME}/${PRESERVED_DIRNAME}/${id(restoreId)}`
}

/**
 * Where a journal participant is set aside and where its replacement waits, as the journal records
 * them: relative to the data folder, `/`-separated.
 * - A restore sets the live file aside in `recovery/preserved/<id>/` and installs it from
 *   `recovery/staged/<id>/`.
 * - A return sets the restored file aside in `recovery/preserved/<id>-restored/` and installs the
 *   newer one from `recovery/preserved/<id>/`, where the restore left it.
 */
export function participantPlaces(
  kind: 'restore' | 'return',
  restoreId: string,
  live: string,
): { readonly aside: string; readonly incoming: string } {
  const name = copyNameOf(live)
  const preserved = preservedAsRecorded(restoreId)
  return kind === 'restore'
    ? {
        aside: `${preserved}/${name}`,
        incoming: `${RECOVERY_DIRNAME}/${STAGED_DIRNAME}/${restoreId}/${name}`,
      }
    : { aside: `${preserved}${RESTORED_SUFFIX}/${name}`, incoming: `${preserved}/${name}` }
}

/**
 * A path a record holds, relative to the data folder and `/`-separated, as a path on this system.
 * Records name only places inside `recovery/`.
 */
export function fromRecorded(userData: string, recorded: string): string {
  const [first, ...rest] = recorded.split('/')
  if (first !== RECOVERY_DIRNAME || rest.length === 0) {
    throw new Error(`"${recorded}" is not a place inside ${RECOVERY_DIRNAME}/`)
  }
  return join(recoveryDir(userData), ...rest.map(segment))
}
