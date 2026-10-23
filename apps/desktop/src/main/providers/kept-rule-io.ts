import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  MAX_SETTINGS_BYTES,
  aStagingName,
  createFreshFile,
  isStillTheFileOpened,
} from '@brobot2/runtime'
export const NO_LONGER_KEPT = 'That rule is no longer kept there.'

type Read =
  | { readonly state: 'absent' }
  | { readonly state: 'read'; readonly text: string }
  | { readonly state: 'unreadable'; readonly why: string }

/**
 * A file's text, read only when it is a regular file no larger than a settings file a person's
 * choices make — opened without blocking, so a pipe planted at the name cannot hang the read.
 */
export function readSmall(file: string): Read {
  let fd: number | null = null
  try {
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' }
      throw error
    }
    const stat = fstatSync(fd)
    if (!stat.isFile()) return { state: 'unreadable', why: 'it is not a regular file' }
    if (stat.size > MAX_SETTINGS_BYTES) return { state: 'unreadable', why: 'it is too large' }
    return { state: 'read', text: readAll(fd, stat.size) }
  } catch (error) {
    return { state: 'unreadable', why: error instanceof Error ? error.message : String(error) }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function readAll(fd: number, size: number): string {
  const buffer = Buffer.alloc(size)
  let read = 0
  while (read < size) {
    const got = readSync(fd, buffer, read, size - read, read)
    if (got === 0) break
    read += got
  }
  return buffer.subarray(0, read).toString('utf8')
}

/**
 * The file rewritten from what it holds now, keeping its permissions: staged under a fresh name and
 * renamed over it, so a reader never sees half of it.
 *
 * ⛔ **Never through a link**, its own or its folder's: the file is opened refusing to follow one, so
 * nothing a link points at is read or rewritten here. On Windows, whose opens follow a link, the
 * opened file must still be the one at its name. ⛔ **Never a file with a second name** (a hard
 * link): renaming over one name would part it from the other.
 */
export function rewrite(
  file: string,
  change: (text: string) => string,
  platform: NodeJS.Platform,
): void {
  if (lstatSync(dirname(file)).isSymbolicLink()) {
    throw new Error(`${dirname(file)} is a link, so ${file} was not rewritten`)
  }
  let fd: number
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error(`${file} is a link, so it was not rewritten`, { cause: error })
    }
    throw error
  }
  let text: string
  let mode: number
  try {
    if (platform === 'win32' && !isStillTheFileOpened(file, fd)) {
      throw new Error(`${file} is a link or was just replaced, so it was not rewritten`)
    }
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`${file} is not a regular file, so it was not rewritten`)
    if (stat.nlink > 1) throw new Error(`${file} has another name too, so it was not rewritten`)
    if (stat.size > MAX_SETTINGS_BYTES) throw new Error(`${file} is too large to rewrite`)
    text = readAll(fd, stat.size)
    mode = stat.mode & 0o7777
  } finally {
    closeSync(fd)
  }
  const next = change(text)
  const staged = aStagingName(file)
  const out = createFreshFile(staged)
  try {
    try {
      writeSync(out, next)
      fchmodSync(out, mode)
    } finally {
      closeSync(out)
    }
    renameSync(staged, file)
  } catch (error) {
    try {
      unlinkSync(staged)
    } catch {
      // best effort — the reason below is what matters
    }
    throw error
  }
}
