import { createHash, randomBytes } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
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

async function flushFile(path: string, fs: RecoveryFs): Promise<void> {
  const handle = await retrying(() => fs.open(path, 'r+'))
  try {
    await handle.sync()
  } finally {
    await handle.close()
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
