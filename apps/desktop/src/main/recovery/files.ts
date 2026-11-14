import { retrying, syncFolder, flushFile, type RetryOptions } from '@brobot2/runtime/atomic-write'
export {
  retrying,
  syncFolder,
  writeAtomically,
  writeJsonAtomically,
  RETRY_DELAYS_MS,
  type RetryOptions,
} from '@brobot2/runtime/atomic-write'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants, type BigIntStats } from 'node:fs'
import * as nodeFsPromises from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
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

export type { Step }

/** Called before a journaled step's work begins. A test throws from it to stop there. */
export type BeforeStep = (step: Step) => void

/** Called after a journaled step's work, before the journal names the step. */
export type AfterStep = (step: Step) => void

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
  stat?(): Promise<RecoveryStats>
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
  readonly mode?: number
  readonly dev?: number | string
  readonly ino?: number | string
  isFile(): boolean
  isDirectory(): boolean
  /** A symbolic link; on Windows a junction too. Only `lstat` can answer true. */
  isSymbolicLink(): boolean
}

export interface RecoveryFs {
  rename(from: string, to: string): Promise<void>
  /** `mode` is `fs.constants.COPYFILE_*`. */
  copyFile(from: string, to: string, mode?: number): Promise<void>
  /** Exclusive copy-on-write attempt; Darwin uses the platform's `cp -c`. */
  cloneFile(
    from: string,
    to: string,
    signal?: AbortSignal,
    beforeFullCopy?: () => void,
  ): Promise<void>
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
  open(path: string, flags: string, mode?: number, noFollow?: boolean): Promise<RecoveryFileHandle>
  /** Follows a link to what it points at. */
  stat(path: string): Promise<RecoveryStats>
  /** The entry itself, a link included. */
  lstat(path: string): Promise<RecoveryStats>
  realpath(path: string): Promise<string>
  /** The file's text, as UTF-8. */
  readFile(path: string): Promise<string>
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { readonly mode?: number; readonly flag?: string },
  ): Promise<void>
  readdir(path: string): Promise<string[]>
}

/** Keep Windows' 64-bit file IDs exact while retaining the existing safe-number representation. */
function recoveryStats(stats: BigIntStats): RecoveryStats {
  const identity = (value: bigint): number | string =>
    value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
  return {
    size: Number(stats.size),
    mtimeMs: Number(stats.mtimeNs / 1_000_000n) + Number(stats.mtimeNs % 1_000_000n) / 1e6,
    mode: Number(stats.mode),
    dev: identity(stats.dev),
    ino: identity(stats.ino),
    isFile: () => stats.isFile(),
    isDirectory: () => stats.isDirectory(),
    isSymbolicLink: () => stats.isSymbolicLink(),
  }
}

export const nodeFs: RecoveryFs = {
  realpath: (path) => nodeFsPromises.realpath(path),
  rename: (from, to) => nodeFsPromises.rename(from, to),
  copyFile: (from, to, mode) => nodeFsPromises.copyFile(from, to, mode),
  cloneFile: cloneRecoveryFile,
  link: (existing, name) => nodeFsPromises.link(existing, name),
  unlink: (path) => nodeFsPromises.unlink(path),
  rm: (path, options) => nodeFsPromises.rm(path, options),
  mkdir: async (path, options) => {
    await nodeFsPromises.mkdir(path, options)
  },
  rmdir: (path) => nodeFsPromises.rmdir(path),
  mkdtemp: (prefix) => nodeFsPromises.mkdtemp(prefix),
  open: async (path, flags, mode, noFollow) => {
    const handle = await nodeFsPromises.open(
      path,
      noFollow ? constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK : flags,
      mode,
    )
    return {
      stat: async () => recoveryStats(await handle.stat({ bigint: true })),
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      writeFile: (data) => handle.writeFile(data),
      sync: () => handle.sync(),
      close: () => handle.close(),
    }
  },
  stat: async (path) => recoveryStats(await nodeFsPromises.stat(path, { bigint: true })),
  lstat: async (path) => recoveryStats(await nodeFsPromises.lstat(path, { bigint: true })),
  readFile: (path) => nodeFsPromises.readFile(path, 'utf8'),
  writeFile: (path, data, options) => nodeFsPromises.writeFile(path, data, options),
  readdir: (path) => nodeFsPromises.readdir(path),
}

async function cloneRecoveryFile(from: string, to: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (process.platform !== 'darwin') {
    await nodeFsPromises.copyFile(
      from,
      to,
      constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE,
    )
    return
  }
  if (await pathExists(to))
    throw Object.assign(new Error(`${to} already exists`), { code: 'EEXIST' })
  const staging = await nodeFsPromises.mkdtemp(join(dirname(to), '.copy-'))
  const copy = join(staging, 'copy')
  let failure: unknown
  try {
    await new Promise<void>((resolve, reject) => {
      let problem: Error | null = null
      const child = execFile('/bin/cp', ['-c', from, copy], { signal }, (error) => {
        if (error) problem = error
      })
      child.on('error', (error) => {
        problem = error
      })
      child.once('close', () => (problem ? reject(problem) : resolve()))
    })
    signal?.throwIfAborted()
    await nodeFsPromises.link(copy, to)
  } catch (error) {
    failure = error
  }
  try {
    await nodeFsPromises.rm(staging, { recursive: true, force: true })
  } catch (error) {
    if (failure !== undefined)
      throw new AggregateError([failure, error], 'Recovery copy and cleanup failed.', {
        cause: error,
      })
    throw error
  }
  if (failure !== undefined) throw failure
}

/** A Node error's `code` (`ENOENT`, `EBUSY`…), or undefined for anything else. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

export async function pathExists(path: string, fs: RecoveryFs = nodeFs): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

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

export async function copyDurably(
  from: string,
  to: string,
  fs: RecoveryFs = nodeFs,
): Promise<void> {
  await fs.copyFile(from, to, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
  await flushFile(to, fs)
  await syncFolder(dirname(to), fs)
}

export async function privateDir(path: string, fs: RecoveryFs = nodeFs): Promise<void> {
  await fs.mkdir(path, { recursive: true, mode: 0o700 })
  const stats = await fs.lstat(path)
  if (stats.isSymbolicLink()) throw new OwnedPathIsALink(path)
  if (!stats.isDirectory()) throw new Error(`${path} is not a folder`)
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

export type Content =
  | { readonly kind: 'absent' }
  | { readonly kind: 'file'; readonly sha256: string }
  | { readonly kind: 'other' }

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
