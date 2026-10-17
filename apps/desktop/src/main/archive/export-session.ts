import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SessionRef } from '@brobot2/runtime'
import type { Provider, SessionStatus } from '@brobot2/shared'
import { localFields } from '../../shared/local-time'
import type { TranscriptEvent } from '../../shared/runtime-ipc'
import { CLAUDE_JSONL, CODEX_ROLLOUT_JSONL, readLines } from './native-file'

/**
 * Put a session back out: as the provider's own file, or as one self-contained document (089).
 *
 * This is a copy, not a reconstruction: the provider's file is read line by line and written back
 * — which is why the round trip is byte for byte and not merely equivalent. Nothing here parses a
 * frame or re-serializes one.
 */

/**
 * The one rule that makes the round trip exact — the mirror of how the file is read.
 *
 * The result is newline-TERMINATED, which is what both providers write. There is one thing the
 * line reader does not keep: whether the original ended with that newline. `readLines` reads
 * `"a\nb"` and `"a\nb\n"` into the same lines, so a file that ended without one — a provider killed
 * mid-write, say — comes back one byte longer. Said here, and pinned by a test, rather than left
 * inside the phrase "byte-identical" to be discovered.
 *
 * ⚠️ **This holds the whole file, and is no longer how an export is written** (053). It is kept
 * because it states the rule in one line, and because that makes it the ORACLE
 * {@link writeNativeExport} is proven against: a streaming writer whose only specification is
 * itself is a writer whose bugs are invisible. Nothing in production calls it.
 */
export function reassembleNativeFile(frames: string[]): string {
  return frames.length === 0 ? '' : `${frames.join('\n')}\n`
}

/** Everything an export needs to know about a session, read off its row. */
export interface ExportableSession {
  sessionId: string
  provider: Provider
  ref: SessionRef
  cwd: string
  profileId: string | null
  status: SessionStatus
  adoptedAt: number | null
  createdAt: number
  updatedAt: number
}

/**
 * A session as one document: what it is, the provider's own lines, and our normalized ledger.
 *
 * The point of carrying all three is that each answers a different question — the frames are what
 * the provider wrote, the ledger is what we showed, and `meta` says which session they belong to.
 * A bundle depends on no provider home and no database, which is what makes it the thing you can
 * actually send someone.
 */
/**
 * Bundle shapes, oldest first.
 *
 *  - **1** — 089's: ledger entries were `{ ordinal, event }`, with no time.
 *  - **2** — each entry also carries `at` (Slice 2 · 001).
 *
 * A version-1 bundle is still readable: its entries simply do not say when they happened, and the
 * importer fills that in rather than refusing a file it can perfectly well understand.
 */
export type BundleVersion = 1 | 2

export interface SessionBundle {
  bundleVersion: BundleVersion
  meta: ExportableSession
  raw: { format: string; frames: string[] }
  /** `at` travels with each entry so a transferred conversation keeps its timeline (v2+). */
  ledger: { ordinal: number; at?: number; event: TranscriptEvent }[]
}

export const BUNDLE_VERSION = 2

/**
 * ⚠️ **This holds the whole session, and is no longer how a bundle is written** (053). Like
 * {@link reassembleNativeFile} it is kept as the ORACLE — {@link writeBundleExport} is asserted to
 * produce, byte for byte, `JSON.stringify(buildBundle(…), null, 2) + '\n'`, which is what makes
 * "streamed" a claim about memory only and not about the file. Nothing in production calls it.
 */
export function buildBundle(
  meta: ExportableSession,
  raw: { format: string; frames: string[] },
  ledger: { ordinal: number; at: number; event: TranscriptEvent }[],
): SessionBundle {
  return { bundleVersion: BUNDLE_VERSION, meta, raw, ledger }
}

/**
 * Where the provider itself would keep this session's file, under a home of your choosing.
 *
 * **Claude**: in the folder the CLI RECORDED the conversation in, in its own home (`recordedAt`,
 * `native-file.ts`'s `nativeTranscriptPath`) — 🔴 **731 · `706` F-5**: for a very long working
 * folder the CLI's own folder name may differ from the flattened cwd, so only its own spelling is one
 * its resume tries first.
 *
 * **Codex** keeps rollouts under a date-partitioned `sessions/<y>/<m>/<d>/` with a LOCAL-time
 * stamp in the filename, which is why the date parts below are read on the Mac's clock too — the
 * zone Codex names the file in (D-031, `shared/local-time.ts`). Even so the name can differ from
 * the original — the row holds an instant, not the offset that was in force when the provider
 * named the file. Measured: that does not matter. Codex locates a thread by its ID — a real rollout
 * dropped into a home under `sessions/2020/01/01/rollout-2020-01-01T00-00-00-<id>.jsonl`, with no
 * state database in that home at all, resumed. The date path is convention, not a lookup key.
 */
export function nativeExportPath(
  provider: Provider,
  targetHome: string,
  ref: SessionRef,
  startedAt: number,
  /** The provider's own file for this conversation, in the home it ran in. */
  recordedAt: string,
): string {
  if (provider === 'claude') {
    return join(targetHome, 'projects', basename(dirname(recordedAt)), `${ref.sessionId}.jsonl`)
  }
  const when = localFields(startedAt)
  const [year, month, day] = [
    String(when.year),
    String(when.month + 1).padStart(2, '0'),
    String(when.date).padStart(2, '0'),
  ]
  const stamp = `${year}-${month}-${day}T${String(when.hours).padStart(2, '0')}-${String(
    when.minutes,
  ).padStart(2, '0')}-${String(when.seconds).padStart(2, '0')}`
  return join(targetHome, 'sessions', year, month, day, `rollout-${stamp}-${ref.sessionId}.jsonl`)
}

/**
 * What an exported native file is actually good for, per provider — stated rather than implied,
 * because "exported" reads like "restored" and that is a claim, not a description.
 *
 * BOTH are resumable, and for Codex that was measured rather than assumed: the expectation going
 * in was that it needed a `threads` row in its own state database, and that turned out to be
 * wrong. A real rollout copied into an otherwise empty home — auth and config only, no state
 * database — resumed by thread id. Writing "not resumable" on the strength of the assumption
 * would have been a false claim in the one place this feature exists to be honest about.
 *
 * The one thing an export cannot carry is the CWD: both providers resume a conversation into the
 * directory it ran in, and our own adapters refuse a ref whose cwd does not match (011). That is
 * a property of the session, not of the file, so it is said here rather than discovered later.
 */
export function nativeExportSupport(provider: Provider): {
  format: string
  resumable: boolean
  note: string
} {
  return provider === 'claude'
    ? {
        format: CLAUDE_JSONL,
        resumable: true,
        // ⚑ 731 · Claude looks in this folder FIRST and then by id in every project folder (`706`),
        // and the file is written where the CLI recorded the original — *"by this exact path"*
        // said the first half as if it were the whole.
        note: 'Claude looks for a session in this folder first, then by its id — a home with this file in it can resume the conversation, from the same working directory.',
      }
    : {
        format: CODEX_ROLLOUT_JSONL,
        resumable: true,
        note: 'Codex finds a thread by its id anywhere under sessions/ — a home with this file in it can resume the conversation, from the same working directory.',
      }
}

/** Write a file and the directories above it, and hand back where it went. */
export function writeExport(path: string, contents: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  return path
}

/**
 * # Exports are written in windows, not assembled in memory (053)
 *
 * A whole session as one array, and then as ONE STRING — `frames.join('\n')` for a native file,
 * `JSON.stringify(bundle, null, 2)` for a bundle — does not export slowly past ~512 MB, it
 * **throws**: a JavaScript string cannot be longer. Provider files reach 1.5 GB. The writers below
 * pull {@link EXPORT_FRAME_BATCH} rows at a time and append each one, so the resident cost is a
 * batch instead of a session, and no string is ever larger than one row.
 *
 * **The output is byte-identical to what the in-memory version produced**, and that is not asserted
 * here — {@link reassembleNativeFile} and {@link buildBundle} are kept precisely so a test can
 * compare against them. An export that changed shape while becoming cheaper would break the round
 * trip 088/089 built, which is the one property this feature has.
 */

/**
 * Rows pulled per window while an export is written. At a typical line size it puts a window at low
 * single-digit megabytes.
 */
export const EXPORT_FRAME_BATCH = 1_000
export const EXPORT_LEDGER_BATCH = 1_000

/** One window of rows, keyed by ordinal — the shape both {@link SessionStore} windows already have. */
export type RowWindow<T> = (fromOrdinal: number, limit: number) => T[]

/**
 * A provider's file as rows numbered from 0, for a writer that walks it in order. The position in
 * the file is carried between pulls, so each pull reads only its own window; a walk that starts
 * again from 0 starts the file again.
 */
export function linesAsRows(path: string): RowWindow<{ ordinal: number; frame: string }> {
  let next = 0
  let offset = 0
  return (from, limit) => {
    if (from === 0) {
      next = 0
      offset = 0
    } else if (from !== next) {
      throw new Error(`a provider file is read in order: asked for line ${from}, next is ${next}`)
    }
    const chunk = readLines(path, offset, limit)
    const rows = chunk.lines.map((frame, index) => ({ ordinal: next + index, frame }))
    next += rows.length
    offset = chunk.offset
    return rows
  }
}

/**
 * Called between window pulls. The default hands the event loop back, which is what stops a
 * gigabyte-scale export from freezing the window that asked for it.
 *
 * The export needed it the moment 053 made a gigabyte export POSSIBLE: the old whole-string version
 * could not block the window for a minute, because on a session that size it threw before it got
 * started.
 */
export type BetweenBatches = () => Promise<void>

const yieldToLoop: BetweenBatches = () => new Promise((resolve) => setImmediate(resolve))

/**
 * Distinguishes one export in flight from another in the same directory. A counter and the pid,
 * because two windows of one app share a pid and two apps do not share a counter.
 */
let partialCounter = 0

/**
 * ⚠️ **Never `.jsonl` or `.json`.** A native export lands INSIDE a provider's own project directory
 * — that is what makes it resumable — so a scratch file wearing the provider's extension is a file
 * `discoverSessionsIn` and the provider's own reader would both offer as a conversation.
 */
function partialPathFor(path: string): string {
  return `${path}.partial-${process.pid}-${++partialCounter}`
}

/**
 * Append `text` and keep going. A tiny seam so both writers below share one file handle discipline:
 * the handle is closed on the way out whatever happens, and a partially written export is removed
 * rather than left looking like a complete one.
 *
 * ## ⛔ It writes a scratch file and RENAMES it (207 M3)
 *
 * It used to open `path` itself with `'w'`, which truncates. Exporting the same session twice is
 * ordinary — the pathname is deterministic, `<sessionId>.brobot-session.json` — so the second call
 * destroyed the first export's bytes in its first syscall, before reading a single row. If it then
 * failed, the `catch` below deleted that same pathname: **a command classified as a read removed a
 * good file it did not write.** 207 reached it through a second WINDOW (`exportSession` takes no
 * sink, so a non-owner can start one), but no second window is needed — one person pressing Export
 * twice on a session whose provider file has since gone unreadable is the whole reproduction.
 *
 * The rename is what makes it safe rather than merely later: `rename(2)` within a directory is
 * atomic, so the previous export is either wholly the old one or wholly the new one, and two
 * exports racing on one pathname end as one of the two files rather than as their interleaving.
 *
 * ⚠️ **A crash still leaves something behind, and it is a better something.** Before, the wreckage
 * wore the export's own name and opened cleanly; now it is `…partial-<pid>-<n>`, which no reader in
 * this app or either provider will offer as a session, and which does not displace the good file.
 */
async function writeStreamed(
  path: string,
  write: (append: (text: string) => void) => Promise<void>,
): Promise<string> {
  mkdirSync(dirname(path), { recursive: true })
  const partial = partialPathFor(path)
  const fd = openSync(partial, 'w')
  try {
    await write((text) => {
      // ⚠️ `writeSync` is ONE `write(2)` and returns how many bytes it managed — it does not loop.
      // On a regular file a short write means the filesystem stopped accepting bytes, and the
      // disk filling up mid-export is exactly the case this whole function is shaped around. Not
      // looping here would silently truncate the file and return normally, which is the one
      // outcome worse than throwing: the `catch` below would never run and the wreckage would be
      // left behind wearing a complete export's name. Looping turns it into the ENOSPC it is.
      const buffer = Buffer.from(text, 'utf8')
      for (let written = 0; written < buffer.length;) {
        written += writeSync(fd, buffer, written, buffer.length - written)
      }
    })
  } catch (error) {
    // A half-written file is worse than no file: it opens, it looks like an export, and its
    // truncation is only visible to whoever reads the end of it.
    //
    // The handle is closed first — deleting a file we still hold open is a race we do not need —
    // but in a `finally`, because `close(2)` can ITSELF fail with EIO when dirty pages cannot be
    // flushed, and a full disk is precisely the failure this path exists for. Written as two bare
    // statements, that throw would skip the delete and leave the wreckage behind.
    //
    // ⛔ **`partial`, and never `path`** (207 M3). This call created `partial`; it did not create
    // whatever is at `path`, and removing a file because our own write failed is how the previous
    // export was destroyed by the next one's error.
    try {
      closeSync(fd)
    } finally {
      rmSync(partial, { force: true })
    }
    throw error
  }
  // Closed BEFORE the rename, not after: the bytes have to be the file's before anything can be
  // asked to read it under its real name.
  closeSync(fd)
  renameSync(partial, path)
  return path
}

export class EmptyNativeTranscript extends Error {
  constructor() {
    super('The source transcript is empty.')
  }
}

/**
 * The provider's own file, reassembled a window at a time.
 *
 * Exactly {@link reassembleNativeFile}'s bytes: each frame followed by a newline is
 * `frames.join('\n') + '\n'`. A source with no lines is refused before promotion. Returns how many
 * frames went out, so the caller reports what it wrote rather than what it expected to.
 */
export async function writeNativeExport(
  path: string,
  frames: RowWindow<{ ordinal: number; frame: string }>,
  batch: number = EXPORT_FRAME_BATCH,
  betweenBatches: BetweenBatches = yieldToLoop,
): Promise<{ path: string; frames: number }> {
  let count = 0
  await writeStreamed(path, async (append) => {
    for await (const row of eachRow(frames, batch, betweenBatches)) {
      append(`${row.frame}\n`)
      count += 1
    }
    if (count === 0) throw new EmptyNativeTranscript()
  })
  return { path, frames: count }
}

/**
 * A bundle, streamed — and byte-identical to `JSON.stringify(buildBundle(…), null, 2) + '\n'`.
 *
 * The indentation is reproduced rather than re-derived: every value that is small (the meta block,
 * one frame, one ledger entry) is handed to `JSON.stringify` itself and then shifted to the depth it
 * sits at, so the escaping and the key order are the platform's and only the layout is ours. What is
 * NOT handed to `JSON.stringify` is the whole document, which is the entire point.
 */
export async function writeBundleExport(
  path: string,
  source: {
    meta: ExportableSession
    format: string
    frames: RowWindow<{ ordinal: number; frame: string }>
    ledger: RowWindow<{ ordinal: number; at: number; event: TranscriptEvent }>
  },
  batches: { frames?: number; ledger?: number; betweenBatches?: BetweenBatches } = {},
): Promise<{ path: string; frames: number; ledgerEntries: number }> {
  let frames = 0
  let ledgerEntries = 0
  const between = batches.betweenBatches ?? yieldToLoop

  await writeStreamed(path, async (append) => {
    append('{\n')
    append(`  "bundleVersion": ${JSON.stringify(BUNDLE_VERSION)},\n`)
    append(`  "meta": ${atDepth(source.meta, 2)},\n`)
    append('  "raw": {\n')
    append(`    "format": ${JSON.stringify(source.format)},\n`)
    append('    "frames": [')
    for await (const row of eachRow(source.frames, batches.frames ?? EXPORT_FRAME_BATCH, between)) {
      append(`${frames === 0 ? '' : ','}\n      ${JSON.stringify(row.frame)}`)
      frames += 1
    }
    // `[]` on one line when empty, exactly as `JSON.stringify` writes an empty array. No comma:
    // `frames` is the last key of `raw`, and the comma belongs to the line that closes `raw` below.
    append(frames === 0 ? ']\n' : '\n    ]\n')
    append('  },\n')
    append('  "ledger": [')
    for await (const row of eachRow(
      source.ledger,
      batches.ledger ?? EXPORT_LEDGER_BATCH,
      between,
    )) {
      append(`${ledgerEntries === 0 ? '' : ','}\n    ${atDepth(row, 4)}`)
      ledgerEntries += 1
    }
    append(ledgerEntries === 0 ? ']\n' : '\n  ]\n')
    append('}\n')
  })

  return { path, frames, ledgerEntries }
}

/** `JSON.stringify(value, null, 2)`, shifted so its continuation lines sit at `spaces`. */
function atDepth(value: unknown, spaces: number): string {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .join(`\n${' '.repeat(spaces)}`)
}

/**
 * Every row a window can produce, pulled a batch at a time.
 *
 * ⚠️ **Only an EMPTY pull ends it — a short one does not.** Ordinals are not assumed contiguous, and
 * a window is allowed to hand back fewer rows than it was asked for while more remain: the ledger
 * window drops a row whose payload will not decode, exactly as `events()` always has. Treating
 * "short" as "finished" is how a streaming reader turns one corrupt row into a truncated export
 * that opens cleanly and is missing its second half. The cursor therefore advances to one past the
 * last ordinal SEEN, and the loop stops only when there is nothing left at all — one extra query
 * per export, which is the price of not guessing.
 */
async function* eachRow<T extends { ordinal: number }>(
  window: RowWindow<T>,
  batch: number,
  betweenBatches: BetweenBatches,
): AsyncGenerator<T> {
  if (batch <= 0) throw new Error(`an export window needs a positive batch size, got ${batch}`)
  for (let from = 0; ;) {
    const rows = window(from, batch)
    const last = rows[rows.length - 1]
    if (last === undefined) return
    // ⚠️ Checked BEFORE the rows are handed out, not after. A window that ignores its cursor would
    // otherwise get a whole batch appended to the open file before the generator resumed and threw
    // — wreckage the caller then has to clean up, for a fault it could have refused to act on.
    // `readTranscript` carries the same kind of check for the same reason: the loop verifies that
    // it MOVED rather than trusting a contract it cannot enforce. Found by pointing this generator
    // at a deliberately broken window while proving the bound, which is what those proofs are for.
    if (last.ordinal < from) {
      throw new Error(
        `an export window ignored its cursor: asked from ordinal ${from}, came back ending at ${last.ordinal}`,
      )
    }
    for (const row of rows) yield row
    from = last.ordinal + 1
    // Once per window, so a multi-gigabyte export does not hold the thread that paints the window.
    await betweenBatches()
  }
}
