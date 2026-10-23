import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  readlinkSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { InjectedInstruction, RefusedInstruction } from '../../shared/runtime-ipc'
import type { InstructionRead, AgentMemoryRead, MemoryCandidate } from './instruction-types'
import { INSTRUCTION_FILE_CAP, AGENT_MEMORY_TOTAL_CAP } from './instruction-limits'

export function readInstructionFile(path: string, cap = INSTRUCTION_FILE_CAP): InstructionRead {
  let seen: Stats
  try {
    seen = statSync(path)
  } catch (error) {
    // ENOENT is the ordinary case — most directories have no `CLAUDE.md` — and it is not a
    // refusal. Anything else (a permission wall, a broken mount) is, because we cannot say the
    // file is absent when what we learned is that we could not look.
    //
    // ⚠️ A DANGLING link is ENOENT and therefore `absent` — which is also what the provider's own
    // `stat` makes of it, so nothing reached the model and there is nothing to report. ⚑ A LOOP is
    // ELOOP, and it is refused as a link: there is no file at the end of it to read.
    if (isAbsent(error)) return { ok: false, reason: 'absent' }
    return { ok: false, reason: isSymlinkError(error) ? 'symlink' : 'unreadable' }
  }
  if (!seen.isFile()) return { ok: false, reason: 'not-a-regular-file' }

  let fd: number
  try {
    // ⚠️ **`O_NONBLOCK`, for the swap step 2 cannot see** (`733` review): a link retargeted at a
    // FIFO between the `stat` and this `open` would otherwise block the main process on the open
    // itself. On a regular file it changes nothing; the `fstat` below then refuses the FIFO.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  } catch (error) {
    // ⚠️ ELOOP here is a path that became a loop after the `stat` above.
    return { ok: false, reason: isSymlinkError(error) ? 'symlink' : 'unreadable' }
  }
  try {
    const held = fstatSync(fd)
    if (!held.isFile()) return { ok: false, reason: 'not-a-regular-file' }
    // The descriptor and the path we checked must be the SAME file. This is the TOCTOU close: a
    // rename or a swap between step 1 and step 2 changes the inode, and nothing else here would
    // notice: `stat` and `fstat` disagree exactly when the path was swapped between them.
    if (held.ino !== seen.ino || held.dev !== seen.dev) return { ok: false, reason: 'symlink' }

    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(16 * 1024)
    let total = 0
    let truncated = false
    for (;;) {
      // `null` position: read sequentially through this descriptor, never re-opening the path.
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      const room = cap - total
      if (read >= room) {
        chunks.push(Buffer.from(buffer.subarray(0, room)))
        total += room
        // Only truncated if there was actually more to keep — a file that ends exactly on the cap
        // was read whole, and saying otherwise would be a warning about nothing.
        truncated = read > room || readSync(fd, buffer, 0, 1, null) > 0
        break
      }
      chunks.push(Buffer.from(buffer.subarray(0, read)))
      total += read
    }

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    } catch {
      // ⚠️ A truncated read can split a multi-byte character, which would refuse a perfectly good
      // UTF-8 file for the cap's sake. Drop the trailing partial sequence and decode again; only a
      // file that is still invalid after that is refused.
      const trimmed = dropPartialTail(Buffer.concat(chunks))
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(trimmed)
      } catch {
        return { ok: false, reason: 'not-utf8' }
      }
    }
    return { ok: true, text, bytes: total, truncated, real: realPath(path) }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    try {
      closeSync(fd)
    } catch {
      // best-effort: the read is done either way
    }
  }
}

export function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

export function isSymlinkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ELOOP' || code === 'EMLINK'
}

export function realPath(path: string): string {
  const absolute = resolve(path)
  const tail: string[] = []
  let at = absolute
  for (;;) {
    try {
      // The home boundary is containment, not display identity. Keep the filesystem's spelling so
      // a case or Unicode alias of home cannot make the walk read personal instruction files.
      return join(realpathSync.native(at), ...tail)
    } catch {
      const parent = dirname(at)
      // The filesystem root resolved to nothing, so there is no real ancestor to hang the tail on.
      // Lexical is all that is left, and every caller compares it against a real path that will
      // therefore not match — which is the fail-closed direction for all three of them.
      if (parent === at) return absolute
      tail.unshift(basename(at))
      at = parent
    }
  }
}

export function dropPartialTail(bytes: Buffer): Buffer {
  for (let back = 1; back <= 3 && back <= bytes.length; back += 1) {
    const byte = bytes[bytes.length - back]!
    if ((byte & 0b1100_0000) === 0b1000_0000) continue // continuation byte — keep walking back
    const needed =
      (byte & 0b1110_0000) === 0b1100_0000
        ? 2
        : (byte & 0b1111_0000) === 0b1110_0000
          ? 3
          : (byte & 0b1111_1000) === 0b1111_0000
            ? 4
            : 1
    return needed > back ? bytes.subarray(0, bytes.length - back) : bytes
  }
  return bytes
}

export function isHomeOrAbove(dir: string, home: string): boolean {
  return dir === home || home.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

export function readMemoryStore(candidates: readonly MemoryCandidate[]): AgentMemoryRead {
  const memory: InjectedInstruction[] = []
  const refused: RefusedInstruction[] = []
  // ⚠️ A broken `memories/` directory link makes EVERY leaf under it absent, so without this the
  // same one-line finding would be reported once per candidate.
  const reported = new Set<string>()
  let budget = AGENT_MEMORY_TOTAL_CAP

  const declare = (row: RefusedInstruction): void => {
    if (reported.has(row.path)) return
    reported.add(row.path)
    refused.push(row)
  }

  for (const candidate of candidates) {
    // ⛔ **The per-file cap, NOT what is left of the budget** (187 §2). Reading at the remaining
    // budget is the defect that made "there is no room left" and "there is no file there" the same
    // answer; the file is read whole and the fit is decided afterwards, so a drop can be stated.
    const read = readInstructionFile(candidate.path, INSTRUCTION_FILE_CAP)
    if (!read.ok) {
      // ⛔ `absent` is silent — unless what is absent is the far end of a LINK (314 §3).
      if (read.reason === 'absent') {
        const broken = brokenMemoryLink(candidate.path)
        if (broken !== null) declare(broken)
        continue
      }
      declare({ path: candidate.path, reason: read.reason })
      continue
    }
    // An empty file is not an item — a heading over no text is 086 in the other direction.
    if (read.text.trim() === '') continue
    // ⚠️ Silent, and deliberately: what did not fit is counted and named in the note sentence
    // ({@link codexMemoryNote}), because a store of a thousand one-line notes would otherwise turn
    // 187's "a dropped file is a row" into a thousand rows nobody can read.
    if (read.bytes > budget) continue
    budget -= read.bytes
    const link = read.real !== undefined && read.real !== candidate.derived ? read.real : undefined
    memory.push({
      kind: candidate.kind,
      path: candidate.path,
      text: read.text,
      bytes: read.bytes,
      truncated: read.truncated,
      reach: candidate.reach,
      ...(link === undefined ? {} : { link }),
    })
  }
  return { memory, refused }
}

export function safeStat(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

export function resolves(path: string): boolean {
  return safeStat(path) !== null
}

export function brokenMemoryLink(path: string): RefusedInstruction | null {
  for (const candidate of [path, dirname(path)]) {
    let seen: Stats
    try {
      seen = lstatSync(candidate)
    } catch {
      continue // nothing at this name at all — the ordinary case, and it stays silent
    }
    if (!seen.isSymbolicLink()) continue
    // ⛔ **A link is only reported when it leads NOWHERE, and this line is why.** Found reviewing
    // this diff: `memory/` may be a symlink somebody pointed at a real directory on another disk,
    // and the index inside it simply has not been written yet — a perfectly working redirect with
    // no file at the far end of the LEAF. Without this the panel told them their memory was gone.
    // ⚠️ `stat` follows; a link that resolves answers here and is left alone.
    if (resolves(candidate)) continue
    let target: string
    try {
      target = resolve(dirname(candidate), readlinkSync(candidate))
    } catch {
      target = '(unreadable)'
    }
    return { path: candidate, reason: 'dangling-link', link: target }
  }
  return null
}

export function sizeOnDisk(path: string): number {
  return Math.min(INSTRUCTION_FILE_CAP, safeStat(path)?.size ?? 0)
}

export function memoryDirNames(
  dir: string,
  followLink: boolean,
): {
  names: string[]
  refused: RefusedInstruction | null
} {
  let seen: Stats
  try {
    seen = lstatSync(dir)
  } catch {
    return { names: [], refused: null } // nothing written yet — the ordinary case, and it is silent
  }
  if (seen.isSymbolicLink()) {
    // ⛔ **A link that leads NOWHERE is not a refusal** (314 §3), and this branch is here because
    // the one below would have called it one. ⚠️ Found reviewing 317's diff: nothing declined to
    // read anything when the far end of a link is gone, and *"not read: symlink"* would send
    // somebody looking for a decision the app never made. {@link brokenMemoryLink} already knows
    // how to say it, target and all. ⚑ It runs for BOTH policies, because a broken link is not a
    // decision either of them made.
    const broken = brokenMemoryLink(dir)
    if (broken !== null) return { names: [], refused: broken }
    // 🔒 See this function's own note for why one store refuses here and the other does not.
    // Named as the DIRECTORY, because that is what was wrong.
    if (!followLink) return { names: [], refused: { path: dir, reason: 'symlink' } }
  }
  // ⚠️ **`statSync`, and only on the followed path.** `seen` is the LINK when there is one, so it
  // is never a directory and the check below would refuse every working redirect as
  // `not-a-regular-file` — the same row under a different word.
  const target = seen.isSymbolicLink() ? safeStat(dir) : seen
  if (target === null || !target.isDirectory()) {
    return { names: [], refused: { path: dir, reason: 'not-a-regular-file' } }
  }
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      // ⚠️ **A symlinked ENTRY is kept, and that is not an inconsistency with the check above.**
      // The directory is refused because following it would let a link decide the whole store's
      // shape; a single memory that is a link is 170 §2's ordinary case — the agent reaches it
      // whichever way we go, so the guarded reader follows it and the panel discloses where it
      // went. Only a DIRECTORY is dropped here, silently: a subdirectory named `*.md` is not a
      // memory, and Codex's `memories__list` reports its `entry_type` as such.
      .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
    return { names, refused: null }
  } catch {
    return { names: [], refused: { path: dir, reason: 'unreadable' } }
  }
}

/** A bounded note listing, newest filename first, without following a directory link. */
export function newestMemoryNotes(notesDir: string): {
  names: string[]
  refused: RefusedInstruction | null
} {
  const listed = memoryDirNames(notesDir, false)
  return { names: [...listed.names].reverse(), refused: listed.refused }
}
