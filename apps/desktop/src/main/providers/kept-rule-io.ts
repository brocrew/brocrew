import { readSizedUtf8Sync } from '@brobot2/runtime/sized-read'
import { writeAtomicallySync } from '@brobot2/runtime/atomic-write'
import { closeSync, constants, fstatSync, openSync, realpathSync, writeFileSync } from 'node:fs'
import { MAX_SETTINGS_BYTES, isStillTheFileOpened } from '@brobot2/runtime'
export const NO_LONGER_KEPT = 'That rule is no longer kept there.'

type Read =
  | { readonly state: 'absent' }
  | { readonly state: 'read'; readonly text: string }
  | { readonly state: 'unreadable'; readonly why: string }

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
    return { state: 'read', text: readSizedUtf8Sync(fd, stat.size) }
  } catch (error) {
    return { state: 'unreadable', why: error instanceof Error ? error.message : String(error) }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

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
    text = readSizedUtf8Sync(fd, stat.size)
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
  writeAtomicallySync(real, next, { mode })
}
