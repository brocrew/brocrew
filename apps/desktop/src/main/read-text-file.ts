import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { isAbsolute } from 'node:path'

/**
 * **Opening one file, safely** — the half every file door in this app has in common (112).
 *
 * `workflow-output.ts` wrote these rules first and its header explains each one at length; that
 * explanation still stands and is not repeated here. What changed is that there are now TWO doors —
 * a workflow's output file and a sub-agent's own transcript — and the rules below are the ones both
 * of them need. They live here so the two cannot drift: a hardening applied to one door and missed
 * on the other is the failure mode this extraction exists to make impossible.
 *
 * 🔴 **731 · the one TYPE check left is here, and it is about what can be DRAWN** — every door
 * that reads through this draws text, and a binary cannot be drawn as text ({@link readTextFile}).
 * ⛔ Until `731` each door also kept a type allow-list of its own — Markdown for an instruction file,
 * a short list of text extensions for a workflow's output, `.jsonl` for a Codex child's rollout — and
 * each said its point was that a credential was not on it. The PM, ruling on `726` §9: *"A type
 * allow-list whose purpose is keeping credentials out goes: a text viewer opens any readable text
 * file a person names, `auth.json` included."* None of them asks WHERE a file is (`726` · R92).
 */

/** What a successful read yields. `bytes` is the file's real size, so a cut can say what it left. */
export interface TextFile {
  text: string
  /** True when the file was longer than the caller's ceiling and `text` is the head of it. */
  truncated: boolean
  bytes: number
}

/**
 * Why a read produced nothing.
 *
 * Three values rather than one `null`, because they are three different sentences to a reader: the
 * file is not there any more, it cannot be drawn as text (a binary, UTF-16, a folder, a fifo, a
 * socket — `731`), or it was there and could not be read.
 */
export type ReadRefusal = 'gone' | 'not-readable' | 'unreadable'

/**
 * The real file behind a path, or why there is not one.
 *
 * Split from the read so a caller can work from the RESOLVED path — a link may land anywhere, and it
 * is where it lands that is read, named, and (for a Claude child) looked beside for its sidecar.
 * ⚑ Since `731` no caller checks a TYPE here: {@link readTextFile} refuses a binary itself.
 *
 * ⚠️ **A tagged result rather than `string | ReadRefusal`**, which TypeScript would collapse to
 * `string` and let a caller pass the word `gone` on to `open(2)` as a filename with no complaint.
 */
export type RealPath = { ok: true; path: string } | { ok: false; reason: ReadRefusal }

export function realPathOf(path: string): RealPath {
  // A NUL truncates at the syscall boundary, so a name containing one is not the name that would be
  // opened. Refused rather than trimmed — `asset-protocol.ts`, same reasoning.
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
 * Why `open(2)` refused, in the three words a viewer has — asked of what is THERE, not of the code.
 *
 * `ELOOP` is the swap: `gone`. ⚑ **731 · the rest is no longer `gone` by default.** Until `731` every
 * failure was, and the extension lists kept most of the other causes from ever arriving; without
 * them a socket or a file this user may not read reached `open` and was drawn as *"no longer on
 * disk"* about a file that is there (`731`'s review). So the path is asked: nothing there is `gone`,
 * a socket or a device is `not-readable`, and a regular file that would not open (`EACCES`, a
 * descriptor shortage) is `unreadable`. ⚠️ Asked by `stat` and not by the error's code, because
 * libuv names a socket's `EOPNOTSUPP` on macOS only as *"Unknown system error -102"* (measured).
 */
function whyItDidNotOpen(realPath: string, error: unknown): ReadRefusal {
  if ((error as { code?: unknown }).code === 'ELOOP') return 'gone'
  try {
    return statSync(realPath).isFile() ? 'unreadable' : 'not-readable'
  } catch {
    return 'gone'
  }
}

/**
 * Read at most `max` bytes of `realPath`, which the caller has already resolved and vetted.
 *
 * `O_NOFOLLOW` because the path was `realpath`ed, so its last component is by definition not a
 * symlink — if it is one by the time we open it, that IS a swap. `O_NONBLOCK` because `open(2)` on
 * a fifo with no writer blocks itself, so without it the `isFile` check below would sit one line
 * after the freeze it exists to prevent. The regular-file check is asked of the DESCRIPTOR, so a
 * rename between the check and the read cannot change what is measured or what is read.
 *
 * ⚑ **731 · a NUL byte in what was read is `not-readable`**: this reads UTF-8, and a file with a NUL
 * in it cannot be drawn as UTF-8 text — a binary, and UTF-16 text too (every ASCII character of
 * it carries one), so the viewers say *"cannot be shown as text here"* and never *"is not text"*.
 * It is git's own test for *binary*. UTF-8 text never carries one, and JSON escapes it, so a
 * transcript never does. ⚠️ Its blind spot is git's: a binary with no NUL in the part read is
 * drawn as it decodes.
 */
export function readTextFile(realPath: string, max: number): TextFile | ReadRefusal {
  let fd: number
  try {
    fd = openSync(realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
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
    // `readSync` is allowed to return short. Looping is not defensive: a 1 MiB read off a slow
    // filesystem legitimately comes back in pieces, and taking the first one would silently show a
    // fraction of the document as if it were all of it.
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
