import {
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statfsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import Database from 'better-sqlite3'
import { claudeTranscriptPath, type SessionRef } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

/**
 * Where a provider keeps its own record of a session, and how to read it a line at a time.
 *
 * The provider's native file is the record the provider itself resumes from, which is what makes it
 * the faithful one — so imports, rebuilds and exports read it rather than any copy.
 */

/** The format tag an export names, so a reader knows what it is holding. */
export const CLAUDE_JSONL = 'claude-jsonl'
export const CODEX_ROLLOUT_JSONL = 'codex-rollout-jsonl'

/**
 * The file a session's own conversation lives in, or null if there is nothing to read.
 *
 * Claude's is `<home>/projects/<projectDir>/<session_id>.jsonl`, found where the CLI RECORDED it
 * ({@link claudeTranscriptPath}): the folder its resume preflight tries FIRST (086), then every
 * project folder, as the bundled CLI's own resume does. 🔴 **731 · `706` F-5** — until `731` only the
 * first was asked, so a conversation whose working folder names a folder Claude never wrote (a
 * symlink, a move, a very long working folder) was resumed and never imported.
 * Codex records the path itself in its state database, so it is looked up rather than guessed.
 */
export function nativeTranscriptPath(
  provider: Provider,
  providerHome: string,
  ref: SessionRef,
): string | null {
  const path =
    provider === 'claude'
      ? claudeTranscriptPath(ref.sessionId, ref.cwd, providerHome)
      : codexRolloutPath(providerHome, ref.sessionId)
  return path !== null && existsSync(path) ? path : null
}

/**
 * ⛔ **Whether `path` is a provider's record of a conversation, in this profile's home** — Claude
 * Code's transcripts under `projects/`, Codex's rollouts under `sessions/` or `archived_sessions/` —
 * and nothing else in that home (W4.164): a path a provider's database names is checked, never
 * trusted.
 */
export function isTheProvidersRecord(provider: Provider, home: string, path: string): boolean {
  // ⚑ Where each IS, every link followed: a home reached through a link is still the home, and a
  // link named like a record that leads elsewhere is not one.
  const real = (one: string): string => {
    try {
      return realpathSync.native(one)
    } catch {
      return resolve(one)
    }
  }
  const resolved = real(path)
  const under = (folder: string): boolean => resolved.startsWith(join(real(home), folder) + sep)
  if (provider === 'claude') return under('projects') && resolved.endsWith('.jsonl')
  return (
    (under('sessions') || under('archived_sessions')) &&
    /^rollout-.*\.jsonl$/.test(basename(resolved))
  )
}

/** The rollout Codex recorded for a thread, read from the newest state database in the home. */
function codexRolloutPath(providerHome: string, threadId: string): string | null {
  const state = newestStateDatabase(providerHome)
  if (state === null) return null
  return readProviderDatabase(state, (db) => {
    const row = db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(threadId) as
      { rollout_path: unknown } | undefined
    return typeof row?.rollout_path === 'string' ? row.rollout_path : null
  })
}

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

/**
 * The newest `state_<n>.sqlite` in a Codex home. The number is a schema version, so the highest
 * one is the live database — an older one names threads Codex has already moved past.
 */
export function newestStateDatabase(home: string): string | null {
  if (!existsSync(home)) return null
  const versions = readdirSync(home)
    .map((name) => ({ name, version: /^state_(\d+)\.sqlite$/.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; version: string } => entry.version !== undefined)
    .sort((a, b) => Number(b.version) - Number(a.version))
  return versions[0] ? join(home, versions[0].name) : null
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

/** How far back {@link newestReplyModel} reads before it says it found none. */
const REPLY_MODEL_BUDGET_BYTES = 4 * 1024 * 1024

/**
 * ⚑ **W4.203 · the model Claude Code recorded on the newest reply of its own transcript** — the
 * `message.model` of the last `assistant` line, read back from the end of the file a page at a
 * time — or `null` when none is found within {@link REPLY_MODEL_BUDGET_BYTES}. ⛔ A reply of the
 * CLI's own making (`<synthetic>`: an error it reports as a reply) and a line of one of its own
 * sub-agents (`isSidechain`) do not count. ⚠️ Read only, and for Claude's transcripts only.
 */
export function newestReplyModel(path: string): string | null {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const stop = Math.max(0, size - REPLY_MODEL_BUDGET_BYTES)
    /**
     * The pages, in file order, of the line read so far without the break before it: a line not
     * yet whole. ⚑ Kept as pages and joined once, so one long line is not copied again per page.
     */
    let carried: Buffer[] = []
    let from = size
    const modelOf = (line: string): string | null => {
      // ⚑ Most lines are not replies, and some are large: only one that names a model is parsed.
      if (!line.includes('"model"')) return null
      try {
        const entry = JSON.parse(line) as {
          type?: unknown
          isSidechain?: unknown
          message?: { model?: unknown }
        }
        if (entry.type !== 'assistant' || entry.isSidechain === true) return null
        const model = entry.message?.model
        return typeof model === 'string' && model !== '' && model !== '<synthetic>' ? model : null
      } catch {
        return null
      }
    }
    while (from > stop) {
      const start = Math.max(stop, from - 64 * 1024)
      const chunk = Buffer.alloc(from - start)
      readSync(fd, chunk, 0, chunk.length, start)
      from = start
      // ⚑ The bytes before this page's first line break may begin mid-line — and mid-character —
      // unless the page starts the file: they wait, as bytes, for the page before it. ⚑ The break
      // is looked for in this page alone: what is carried has none, by construction.
      const firstBreak = start === 0 ? -1 : chunk.indexOf(0x0a)
      if (start !== 0 && firstBreak === -1) {
        carried = [chunk, ...carried]
        continue
      }
      const whole = Buffer.concat([chunk.subarray(firstBreak + 1), ...carried])
      carried = start === 0 ? [] : [chunk.subarray(0, firstBreak)]
      const lines = whole.toString('utf8').split('\n')
      for (let at = lines.length - 1; at >= 0; at -= 1) {
        const model = modelOf(lines[at] ?? '')
        if (model !== null) return model
      }
    }
    // ⚑ The whole file was read, or the budget ran out before a reply was found.
    return null
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
