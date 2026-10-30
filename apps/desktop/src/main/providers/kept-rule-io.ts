import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
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
 * A link the person made — the file's own or its folder's — is followed: the file it leads to is the
 * one rewritten, and the link stays. A file with a second name (a hard link) is written in place,
 * so every name keeps the same text.
 */
export function rewrite(
  file: string,
  change: (text: string) => string,
  platform: NodeJS.Platform,
): void {
  const real = realpathSync(file)
  const fd = openSync(real, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
  let text: string
  let mode: number
  let names: number
  try {
    if (platform === 'win32' && !isStillTheFileOpened(real, fd)) {
      throw new Error(`${file} was just replaced, so it was not rewritten`)
    }
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`${file} is not a regular file, so it was not rewritten`)
    if (stat.size > MAX_SETTINGS_BYTES) throw new Error(`${file} is too large to rewrite`)
    text = readAll(fd, stat.size)
    mode = stat.mode & 0o7777
    names = stat.nlink
  } finally {
    closeSync(fd)
  }
  const next = change(text)
  if (names > 1) {
    writeFileSync(real, next)
    return
  }
  file = real
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
