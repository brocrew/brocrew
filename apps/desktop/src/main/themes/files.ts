import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
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
      readonly cause?: unknown
    }
  | {
      readonly ok: false
      readonly failure: 'too-large'
      readonly size: number
      readonly maximum: number
    }

export interface ThemeReadFiles {
  open(path: string, flags: number): Promise<FileHandle>
}

export function readRefused(error: unknown): boolean {
  const code = errorCode(error)
  return code !== 'ENOENT' && code !== 'ENOTDIR'
}

/** An unreadable answer, keeping the error when the system refused the read. */
export const unreadable = (error: unknown): ThemeFileRead =>
  readRefused(error)
    ? { ok: false, failure: 'unreadable', refused: error, cause: error }
    : { ok: false, failure: 'unreadable', cause: error }

export const THEME_READ_FILES: ThemeReadFiles = {
  open: (path, flags) => open(path, flags),
}

async function readRegular(
  path: string,
  maximum: number,
  files: ThemeReadFiles = THEME_READ_FILES,
): Promise<ThemeFileRead> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await files.open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) return { ok: false, failure: 'unreadable' }
    if (before.size > maximum)
      return { ok: false, failure: 'too-large', size: Number(before.size), maximum }
    const bytes = Buffer.alloc(maximum + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    const after = await handle.stat({ bigint: true })
    if (length > maximum || after.size > maximum)
      return {
        ok: false,
        failure: 'too-large',
        size: Math.max(length, Number(after.size)),
        maximum,
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
  return readRegular(path, maximum, files)
}

export async function readOfferedThemeAsset(
  path: string,
  maximum: number,
  files: ThemeReadFiles = THEME_READ_FILES,
): Promise<ThemeFileRead> {
  if (!isAbsolute(path)) return { ok: false, failure: 'outside' }
  return readRegular(path, maximum, files)
}
