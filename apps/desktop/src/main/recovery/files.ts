import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { Step } from './contract'
import {
  BACKUPS_DIRNAME,
  RECOVERY_DIRNAME,
  backupsDir,
  preservedRoot,
  recoveryDir,
  scratchDir,
  stagedRoot,
} from './layout'

/**
 * Every file operation recovery makes goes through a {@link RecoveryFs}, so a test can make any
 * one of them fail. Production uses {@link nodeFs}; a test spreads it and replaces what it needs.
 */

export type { Step }

/** Called before a journaled step's work begins. A test throws from it to stop there. */
export type BeforeStep = (step: Step) => void

/** Called after a journaled step's work, before the journal names the step. */
export type AfterStep = (step: Step) => void

/**
 * One file a restore or return just renamed: the participant by its live name, and where it went.
 * `incoming` is only reached when an unfinished restore or return is undone.
 */
export interface Moved {
  readonly live: string
  readonly to: 'aside' | 'live' | 'incoming'
}

/** Called after each rename, before the next journal write. */
export type AfterMove = (moved: Moved) => void

/** The points a test can stop a restore or a return at. Production passes none. */
export interface StepHooks {
  readonly beforeStep?: BeforeStep
  readonly afterStep?: AfterStep
  readonly afterMove?: AfterMove
}

export interface RecoveryFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number }>
  writeFile(data: string | Uint8Array): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface RecoveryStats {
  readonly size: number
  readonly mtimeMs: number
  isFile(): boolean
  isDirectory(): boolean
  /** A symbolic link; on Windows a junction too. Only `lstat` can answer true. */
  isSymbolicLink(): boolean
}

export interface RecoveryFs {
  rename(from: string, to: string): Promise<void>
  /** `mode` is `fs.constants.COPYFILE_*`. */
  copyFile(from: string, to: string, mode?: number): Promise<void>
  link(existing: string, name: string): Promise<void>
  unlink(path: string): Promise<void>
  rm(
    path: string,
    options?: { readonly recursive?: boolean; readonly force?: boolean },
  ): Promise<void>
  mkdir(
    path: string,
    options?: { readonly recursive?: boolean; readonly mode?: number },
  ): Promise<void>
  /** Removes a folder only when it is empty; one that holds anything is refused. */
  rmdir(path: string): Promise<void>
  /** A new folder whose name starts with `prefix`; returns its path. */
  mkdtemp(prefix: string): Promise<string>
  open(path: string, flags: string, mode?: number): Promise<RecoveryFileHandle>
  /** Follows a link to what it points at. */
  stat(path: string): Promise<RecoveryStats>
  /** The entry itself, a link included. */
  lstat(path: string): Promise<RecoveryStats>
  /** The file's text, as UTF-8. */
  readFile(path: string): Promise<string>
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { readonly mode?: number; readonly flag?: string },
  ): Promise<void>
  readdir(path: string): Promise<string[]>
  chmod(path: string, mode: number): Promise<void>
}

export const nodeFs: RecoveryFs = {
  rename: (from, to) => nodeFsPromises.rename(from, to),
  copyFile: (from, to, mode) => nodeFsPromises.copyFile(from, to, mode),
  link: (existing, name) => nodeFsPromises.link(existing, name),
  unlink: (path) => nodeFsPromises.unlink(path),
  rm: (path, options) => nodeFsPromises.rm(path, options),
  mkdir: async (path, options) => {
    await nodeFsPromises.mkdir(path, options)
  },
  rmdir: (path) => nodeFsPromises.rmdir(path),
  mkdtemp: (prefix) => nodeFsPromises.mkdtemp(prefix),
  open: async (path, flags, mode) => {
    const handle = await nodeFsPromises.open(path, flags, mode)
    return {
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      writeFile: (data) => handle.writeFile(data),
      sync: () => handle.sync(),
      close: () => handle.close(),
    }
  },
  stat: (path) => nodeFsPromises.stat(path),
  lstat: (path) => nodeFsPromises.lstat(path),
  readFile: (path) => nodeFsPromises.readFile(path, 'utf8'),
  writeFile: (path, data, options) => nodeFsPromises.writeFile(path, data, options),
  readdir: (path) => nodeFsPromises.readdir(path),
  chmod: (path, mode) => nodeFsPromises.chmod(path, mode),
}

/** A Node error's `code` (`ENOENT`, `EBUSY`…), or undefined for anything else. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * Whether anything is at `path`, a link included even when what it points at is gone. Errors other
 * than its absence are thrown.
 */
export async function pathExists(path: string, fs: RecoveryFs = nodeFs): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

/** The codes a file held briefly by another program gives, mostly antivirus and indexers on Windows. */
const BRIEFLY_HELD = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** Whether `error` is one a file held briefly by another program gives. */
export function isBrieflyHeld(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && BRIEFLY_HELD.has(code)
}

/** The waits between tries: ten tries over about two seconds. */
export const RETRY_DELAYS_MS: readonly number[] = [50, 100, 150, 200, 250, 300, 300, 300, 350]

export interface RetryOptions {
  readonly delays?: readonly number[]
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * Runs `op`, and runs it again after a short wait while it fails with a code a briefly held file
 * gives. Any other failure, or the last one, is thrown as it came.
 */
export async function retrying<T>(op: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await op()
    } catch (error) {
      const wait = delays[attempt]
      if (wait === undefined || !isBrieflyHeld(error)) throw error
      await sleep(wait)
    }
  }
}

/**
 * A file's text, or null when there is none. A read a briefly held file refuses is tried again;
 * any other failure is thrown.
 */
export async function readTextOrNull(
  path: string,
  fs: RecoveryFs = nodeFs,
  options: RetryOptions = {},
): Promise<string | null> {
  try {
    return await retrying(() => fs.readFile(path), options)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

/**
 * Replaces `path` with `data` so that a reader finds the old file or the new one, never a part:
 * the data goes to a private temporary file beside it (mode 0600), is flushed to disk, and is
 * renamed over `path`; then the rename itself is put on disk, so it survives a power cut. A
 * failure before the rename leaves the old file as it was and removes the temporary one. A failure
 * to put the rename on disk is thrown too: the new file is in place, but nothing may count on it.
 *
 * The rename is put on disk by flushing the folder, except on Windows, which cannot flush a
 * folder: there the file is flushed again under its new name, through a handle that may write.
 * NTFS and ReFS log every change to a volume's names in order, so that flush also puts on disk
 * every rename and new file the app made on the volume before it.
 */
export async function writeAtomically(
  path: string,
  data: string | Uint8Array,
  fs: RecoveryFs = nodeFs,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const temporary = join(dirname(path), `${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  let handle: RecoveryFileHandle | null = null
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    await handle.writeFile(data)
    await handle.sync()
    const written = handle
    handle = null
    await written.close()
    await retrying(() => fs.rename(temporary, path))
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  if (platform === 'win32') await flushFile(path, fs)
  else await syncFolder(dirname(path), fs, platform)
}

/** {@link writeAtomically} for a JSON value, two-space indented with a final newline. */
export async function writeJsonAtomically(
  path: string,
  value: unknown,
  fs: RecoveryFs = nodeFs,
): Promise<void> {
  await writeAtomically(path, `${JSON.stringify(value, null, 2)}\n`, fs)
}

/**
 * Flushes a folder's entries to disk, so a rename or a new file in it survives a power cut. A
 * failure is thrown, since nothing written into the folder may then count as kept.
 *
 * Windows cannot flush a folder, so there this does nothing. Its names reach the disk with the next
 * file flushed after them, and NTFS and ReFS keep them in the order they were made, so a crash
 * leaves the earlier ones without the later ones. Every step a later one counts on ends with a
 * record written by {@link writeAtomically}, which flushes one. The renames that put files back
 * after a stopped restore, and the removal of a finished journal, reach the disk with the next file
 * flushed; until then the journal is still there, and the next start does them again.
 */
export async function syncFolder(
  folder: string,
  fs: RecoveryFs = nodeFs,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') return
  const handle = await fs.open(folder, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Flushes a file's bytes and its entry, through a handle that may write: Windows flushes only those.
 * The open is tried again while another program briefly holds the file, as a rename is.
 */
async function flushFile(path: string, fs: RecoveryFs): Promise<void> {
  const handle = await retrying(() => fs.open(path, 'r+'))
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Copies `from` to a new file `to` (mode 0600) and puts its bytes and its name on disk before it
 * returns: the copy is flushed through a handle that may write, and then its folder is flushed.
 * On Windows the copy's flush puts its name on disk too. Never replaces a file already at `to`.
 */
export async function copyDurably(
  from: string,
  to: string,
  fs: RecoveryFs = nodeFs,
): Promise<void> {
  await fs.copyFile(from, to, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
  await fs.chmod(to, 0o600)
  await flushFile(to, fs)
  await syncFolder(dirname(to), fs)
}

/**
 * Makes `path` and any missing parents, readable by this user only (0700). A link standing where
 * the folder should be is refused, so the mode is never set on what it points at. Its parents are
 * not checked here: inside `backups/` and `recovery/`, {@link assertOwnedPathsAreReal} checks them
 * first.
 */
export async function privateDir(path: string, fs: RecoveryFs = nodeFs): Promise<void> {
  await fs.mkdir(path, { recursive: true, mode: 0o700 })
  const stats = await fs.lstat(path)
  if (stats.isSymbolicLink()) throw new OwnedPathIsALink(path)
  if (!stats.isDirectory()) throw new Error(`${path} is not a folder`)
  await fs.chmod(path, 0o700)
}

/** A link or junction where one of the app's own recovery folders or files should be. */
export class OwnedPathIsALink extends Error {
  constructor(readonly path: string) {
    super(
      `${path} is a link to another place, not a folder BroCrew made, so BroCrew did not change ` +
        'anything through it.',
    )
    this.name = 'OwnedPathIsALink'
  }
}

/**
 * Refuses, with {@link OwnedPathIsALink}, when a folder the app owns is a link or a junction:
 * `backups/`, `recovery/`, `recovery/staged/`, `recovery/preserved/`, `recovery/scratch/`, and
 * every entry on the way to each of `paths` below `backups/` or `recovery/`, the path itself
 * included. Called before every rename, removal, mode change and sweep there, so none of them
 * reaches through a link into a folder the app does not own. A path not there yet is fine; paths
 * directly in the data folder have no owned parent to check.
 */
export async function assertOwnedPathsAreReal(
  userData: string,
  paths: readonly string[] = [],
  fs: RecoveryFs = nodeFs,
): Promise<void> {
  const owned = [
    backupsDir(userData),
    recoveryDir(userData),
    stagedRoot(userData),
    preservedRoot(userData),
    scratchDir(userData),
  ]
  const checked = new Set<string>()
  const check = async (path: string): Promise<boolean> => {
    if (checked.has(path)) return true
    checked.add(path)
    let stats: RecoveryStats
    try {
      stats = await fs.lstat(path)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false
      throw error
    }
    if (stats.isSymbolicLink()) throw new OwnedPathIsALink(path)
    return true
  }
  for (const path of owned) await check(path)
  for (const path of paths) {
    const inside = relative(userData, path)
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`${path} is not inside the data folder ${userData}`)
    }
    const parts = inside.split(sep)
    if (parts[0] !== BACKUPS_DIRNAME && parts[0] !== RECOVERY_DIRNAME) continue
    let at = userData
    for (const part of parts) {
      at = join(at, part)
      if (!(await check(at))) break
    }
  }
}

const CHUNK_BYTES = 1024 * 1024

/** The sha256 (hex) of a whole file, read in chunks so a large database is never held in memory. */
export async function sha256Of(path: string, fs: RecoveryFs = nodeFs): Promise<string> {
  const hash = createHash('sha256')
  const handle = await retrying(() => fs.open(path, 'r'))
  try {
    const buffer = new Uint8Array(CHUNK_BYTES)
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

/**
 * What is at a path: nothing, a file with its full sha256, or something that is not a file (a
 * folder, or a link even to a file).
 */
export type Content =
  | { readonly kind: 'absent' }
  | { readonly kind: 'file'; readonly sha256: string }
  | { readonly kind: 'other' }

/**
 * What is at `path`, hashed whole when it is a file. A link is `other`, never what it points at: a
 * rename would move the link and leave its target where it is.
 */
export async function contentAt(path: string, fs: RecoveryFs = nodeFs): Promise<Content> {
  let stats: RecoveryStats
  try {
    stats = await retrying(() => fs.lstat(path))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'absent' }
    throw error
  }
  if (!stats.isFile()) return { kind: 'other' }
  return { kind: 'file', sha256: await sha256Of(path, fs) }
}
