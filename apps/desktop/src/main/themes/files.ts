import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { errorCode } from '../recovery/files'

export const THEME_JSON_BYTES = 256 * 1024
export const THEME_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export type ThemeFileFailure = 'unreadable' | 'changed' | 'link' | 'outside' | 'too-large'
export type ThemeFileRead =
  | { readonly ok: true; readonly bytes: Buffer }
  | {
      readonly ok: false
      readonly failure: Exclude<ThemeFileFailure, 'too-large'>
      /** Set when the system refused the read, so the file may be readable later. */
      readonly refused?: unknown
    }
  | {
      readonly ok: false
      readonly failure: 'too-large'
      readonly size: number
      readonly maximum: number
    }

export interface ThemeReadFiles {
  lstat(path: string): Promise<BigIntStats>
  realpath(path: string): Promise<string>
  open(path: string, flags: number): Promise<FileHandle>
}

/**
 * Whether `error` is the system refusing a read (a file held, a permission, an I/O fault) rather
 * than saying the file is not there. A refused read says nothing about what the file holds.
 */
export function readRefused(error: unknown): boolean {
  const code = errorCode(error)
  return code !== 'ENOENT' && code !== 'ENOTDIR'
}

/** An unreadable answer, keeping the error when the system refused the read. */
export const unreadable = (error: unknown): ThemeFileRead =>
  readRefused(error)
    ? { ok: false, failure: 'unreadable', refused: error }
    : { ok: false, failure: 'unreadable' }

export const THEME_READ_FILES: ThemeReadFiles = {
  lstat: (path) => lstat(path, { bigint: true }),
  realpath: (path) => realpath(path),
  open: (path, flags) => open(path, flags),
}

const sameFile = (a: BigIntStats, b: BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino
const unchanged = (a: BigIntStats, b: BigIntStats): boolean =>
  sameFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs

export function insideThemeFolder(root: string, path: string): boolean {
  const rest = relative(root, path)
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest)
}

interface DirectoryPin {
  readonly path: string
  readonly stat: BigIntStats
}

async function directories(
  root: string,
  path: string,
  files: ThemeReadFiles,
): Promise<readonly DirectoryPin[] | null> {
  if (!insideThemeFolder(root, path)) return null
  const parts = relative(root, path).split(sep).slice(0, -1)
  const pins: DirectoryPin[] = []
  let at = root
  for (const part of ['', ...parts]) {
    if (part) at = join(at, part)
    const stat = await files.lstat(at)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null
    const real = await files.realpath(at)
    if (real !== at) return null
    pins.push({ path: at, stat })
  }
  return pins
}

async function pinsStillHold(
  pins: readonly DirectoryPin[],
  files: ThemeReadFiles,
): Promise<boolean> {
  for (const pin of pins) {
    const now = await files.lstat(pin.path)
    if (!now.isDirectory() || now.isSymbolicLink() || !sameFile(pin.stat, now)) return false
    if ((await files.realpath(pin.path)) !== pin.path) return false
  }
  return true
}

async function readRegular(
  path: string,
  maximum: number,
  pins: readonly DirectoryPin[] = [],
  files: ThemeReadFiles = THEME_READ_FILES,
): Promise<ThemeFileRead> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    const expected = await files.lstat(path)
    if (expected.isSymbolicLink()) return { ok: false, failure: 'link' }
    if (!expected.isFile()) return { ok: false, failure: 'unreadable' }
    if (expected.size > maximum)
      return { ok: false, failure: 'too-large', size: Number(expected.size), maximum }
    handle = await files.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || !unchanged(expected, before) || !(await pinsStillHold(pins, files))) {
      return { ok: false, failure: 'changed' }
    }
    const bytes = Buffer.alloc(Number(before.size) + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    if (length > maximum && after.size > maximum)
      return { ok: false, failure: 'too-large', size: Number(after.size), maximum }
    if (
      BigInt(length) !== before.size ||
      !unchanged(before, after) ||
      !(await pinsStillHold(pins, files)) ||
      !unchanged(after, await files.lstat(path))
    ) {
      return { ok: false, failure: 'changed' }
    }
    return { ok: true, bytes: bytes.subarray(0, length) }
  } catch (error) {
    return unreadable(error)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export async function readThemeFile(
  root: string,
  file: string,
  maximum: number,
  files: ThemeReadFiles = THEME_READ_FILES,
): Promise<ThemeFileRead> {
  const path = resolve(root, file)
  if (!insideThemeFolder(root, path)) return { ok: false, failure: 'outside' }
  try {
    const pins = await directories(root, path, files)
    if (!pins || !(await pinsStillHold(pins, files))) return { ok: false, failure: 'link' }
    if ((await files.realpath(path)) !== path) return { ok: false, failure: 'link' }
    return await readRegular(path, maximum, pins, files)
  } catch (error) {
    return unreadable(error)
  }
}

export async function readOfferedThemeAsset(
  path: string,
  maximum: number,
  files: ThemeReadFiles = THEME_READ_FILES,
): Promise<ThemeFileRead> {
  if (!isAbsolute(path)) return { ok: false, failure: 'outside' }
  return readRegular(path, maximum, [], files)
}
