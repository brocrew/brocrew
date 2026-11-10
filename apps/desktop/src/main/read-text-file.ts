import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { isAbsolute } from 'node:path'
import { openNotThroughALink } from '@brobot2/runtime/provider-home'

/**
 * Shared bounded text reads for document viewers. Callers resolve the source path and choose the
 * byte limit; this reader handles file kind, content decoding and reported truncation without
 * requiring a particular filename or extension.
 */

/** What a successful read yields. `bytes` is the file's real size, so a cut can say what it left. */
export interface TextFile {
  text: string
  /** True when the file was longer than the caller's ceiling and `text` is the head of it. */
  truncated: boolean
  bytes: number
}

/**
 * Distinguish a missing file, one that cannot be shown as text, and one that could not be read so
 * the viewer can explain the actual result.
 */
export type ReadRefusal = 'gone' | 'not-readable' | 'unreadable'

/**
 * Resolve separately so callers can use the target path for a title or a sibling sidecar.
 * The tagged result keeps failure words distinct from filenames; `string | ReadRefusal` would
 * collapse to `string`.
 */
export type RealPath = { ok: true; path: string } | { ok: false; reason: ReadRefusal }

export function realPathOf(path: string): RealPath {
  // Reject embedded NULs rather than changing the requested filename.
  if (path.includes('\0')) return { ok: false, reason: 'not-readable' }
  if (!isAbsolute(path)) return { ok: false, reason: 'not-readable' }
  try {
    // Consumers check this result and read from it, so retain filesystem identity rather than the
    // caller's case/Unicode alias.
    return { ok: true, path: realpathSync.native(path) }
  } catch {
    return { ok: false, reason: 'gone' }
  }
}

/**
 * Classify a failed open by the filesystem entry, since platform error codes for sockets differ.
 * `ELOOP` can mean a replaced path or a directory rejected by the Windows regular-file check;
 * `lstat` distinguishes the directory without following a link. Otherwise, an existing regular
 * file is unreadable, another file kind is not readable as text, and a missing entry is gone.
 */
function whyItDidNotOpen(realPath: string, error: unknown): ReadRefusal {
  try {
    if ((error as { code?: unknown }).code === 'ELOOP')
      return lstatSync(realPath).isDirectory() ? 'not-readable' : 'gone'
    return statSync(realPath).isFile() ? 'unreadable' : 'not-readable'
  } catch {
    return 'gone'
  }
}

/**
 * Read at most `max` bytes of the caller-resolved path.
 *
 * The open helper handles a link introduced after resolution with `O_NOFOLLOW` or a Windows
 * post-open check. `O_NONBLOCK` keeps a fifo with no writer from hanging before the file-kind check.
 * Checking and reading the same descriptor keeps a rename from changing the file being read.
 *
 * A NUL in the sampled head makes the content not readable here, including common UTF-16 text.
 * Content without a NUL in that head is decoded as UTF-8, even if it is not actually text.
 */
export function readTextFile(realPath: string, max: number): TextFile | ReadRefusal {
  let fd: number
  try {
    fd = openNotThroughALink(realPath, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    return whyItDidNotOpen(realPath, error)
  }
  try {
    const stat = fstatSync(fd)
    // Neither a fifo nor a device nor a directory is a document.
    if (!stat.isFile()) return 'not-readable'
    const bytes = stat.size
    const take = Math.min(bytes, max)
    const buffer = Buffer.allocUnsafe(take)
    let filled = 0
    // A short read can leave more bytes available; keep reading until the requested head or EOF.
    while (filled < take) {
      const got = readSync(fd, buffer, filled, take - filled, filled)
      if (got <= 0) break
      filled += got
    }
    const head = buffer.subarray(0, filled)
    if (head.includes(0)) return 'not-readable'
    return { text: head.toString('utf8'), truncated: bytes > take, bytes }
  } catch {
    return 'unreadable'
  } finally {
    // A leaked descriptor in the main process is a leak for the life of the app.
    closeSync(fd)
  }
}
