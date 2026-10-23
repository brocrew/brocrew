import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statfsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import Database from 'better-sqlite3'

/**
 * Read a provider's own SQLite index **through a private copy** (046 review, P1).
 *
 * ## `readonly: true` is not read-only
 *
 * Measured, not assumed: open a WAL-mode database with `new Database(path, {readonly: true})` when
 * its `-shm` is absent — after a reboot, or any time the owner is not running — and SQLite
 * **creates `<name>-shm` next to it**. That is a write into `~/.codex`, which this app has promised
 * never to do, and in the worst case a read-only opener also drives WAL recovery against someone
 * else's live database.
 *
 * better-sqlite3 has no `immutable` option to turn that off — it takes `readonly`, `fileMustExist`,
 * `timeout`, `verbose` and `nativeBinding`, and silently ignores anything else, so passing
 * `immutable: true` (the obvious fix, and the one first suggested) changes nothing. Verified: the
 * `-shm` still appeared.
 *
 * So the file is copied somewhere we own and the copy is opened. The `-wal` comes with it, or the
 * copy would be missing every transaction the owner has not checkpointed yet.
 *
 * ⚠️ A copy taken while the owner is mid-write can be torn. That is why the whole thing is inside
 * one `try`: an unreadable index yields `null`, and every caller already treats that as "this home
 * has nothing to offer" rather than as a failure — which is true, and is the safe way to be wrong.
 */
export function readProviderDatabase<T>(
  path: string,
  read: (db: Database.Database) => T,
): T | null {
  let scratch: string | null = null
  try {
    scratch = mkdtempSync(join(tmpdir(), 'brobot2-provider-db-'))
    const copy = join(scratch, 'state.sqlite')
    copyFileSync(path, copy)
    // Best-effort: a database with no WAL beside it simply has nothing uncheckpointed.
    if (existsSync(`${path}-wal`)) copyFileSync(`${path}-wal`, `${copy}-wal`)

    const db = new Database(copy, { readonly: true, fileMustExist: true })
    try {
      return read(db)
    } finally {
      db.close()
    }
  } catch {
    return null
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true })
  }
}

/** A pull of lines from a file, and where to carry on from. */
export interface LineChunk {
  lines: string[]
  /** Byte offset just past the last line returned — the `from` of the next pull. */
  offset: number
  /** True once the file has been read to its end. */
  done: boolean
  /**
   * **The last line came with no newline after it** (070, from 068 finding 3).
   *
   * Only ever true alongside {@link done} — a mid-file pull always cuts on a newline. It is the one
   * fact that distinguishes *"this file ends here"* from *"this file has not finished being written"*,
   * and the two are indistinguishable from the bytes alone: a JSONL writer appends the object and
   * then the newline, so a reader that arrives between the two sees a truncated object that looks
   * exactly like a final line.
   *
   * A derive leaves it unread (`deriveLedger`), so a ledger never records half a record.
   */
  partial: boolean
}

/**
 * Read AT MOST `maxLines` starting at a byte offset (046), so a caller can yield to the event loop
 * between pulls: over a 1.53 GB rollout a single synchronous read is a multi-minute freeze of the
 * process that paints the window.
 *
 * EVERY line is emitted, blank ones included, minus the empty piece a trailing newline leaves
 * behind: `"a\nb\n"` and `"a\nb"` both give `["a", "b"]`, and `"a\n\nb\n"` gives `["a", "", "b"]`.
 * That rule is what makes `frames.join('\n') + '\n'` give the file back byte for byte. The offset is
 * counted in BYTES consumed by the lines actually returned, so it is exact regardless of how the
 * decoder split its chunks, and a partial multi-byte character is never handed back as nonsense.
 */
export function readLines(path: string, from: number, maxLines: number): LineChunk {
  // A pull of nothing would return `{lines: [], done: false}` forever, and every caller here loops
  // until `done`. Refused loudly rather than hanging.
  if (maxLines <= 0) throw new Error(`readLines needs a positive line budget, got ${maxLines}`)
  const fd = openSync(path, 'r')
  try {
    const lines: string[] = []
    const chunk = Buffer.alloc(64 * 1024)
    const decoder = new StringDecoder('utf8')
    let pending = ''
    let position = from
    let consumed = 0

    const take = (line: string): void => {
      lines.push(line)
      consumed += Buffer.byteLength(line, 'utf8') + 1 // the '\n' that ended it
    }

    for (;;) {
      if (lines.length >= maxLines)
        return { lines, offset: from + consumed, done: false, partial: false }
      const read = readSync(fd, chunk, 0, chunk.length, position)
      position += read
      const end = read === 0
      pending += end ? decoder.end() : decoder.write(chunk.subarray(0, read))

      const split = pending.split('\n')
      // The last piece is only a whole line once the file has ended.
      pending = split.pop() ?? ''
      for (const line of split) {
        take(line)
        if (lines.length >= maxLines) {
          // Everything after the cut is re-read on the next pull; the offset says exactly where.
          return { lines, offset: from + consumed, done: false, partial: false }
        }
      }

      if (end) {
        // A final line with no newline after it is still a line — and consumed one byte less. It is
        // also the only line this function cannot vouch for, which is what `partial` says (070).
        if (pending !== '') {
          lines.push(pending)
          consumed += Buffer.byteLength(pending, 'utf8')
        }
        return { lines, offset: from + consumed, done: true, partial: pending !== '' }
      }
    }
  } finally {
    closeSync(fd)
  }
}

/**
 * Bytes available on the volume holding `path` — for the recovery copy and the launch compaction.
 *
 * `bavail` and not `bfree`: the two differ by the blocks the filesystem reserves for root, and the
 * app runs as the user. On this machine that gap is real — `bfree` agreed with `df` at 175.3 GB
 * while `bavail` reported 169.2 GB — and a floor built on space we cannot actually have is not a
 * floor. The conservative number is the correct one here.
 *
 * `null`, not 0, when the volume cannot be interrogated. Only one of them is a claim about the disk: reporting 0 for a probe that
 * failed would put "0 bytes free" in a log that a person — or a monitor — would read as a full disk.
 */
export function freeBytesOn(path: string): number | null {
  try {
    const stats = statfsSync(path)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}
