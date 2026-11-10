import type { TranscriptEvent } from '../../shared/conversation-events'
import { mkdirSync } from 'node:fs'
import { writeAtomically } from '@brobot2/runtime/atomic-write'
import { dirname } from 'node:path'
import type { SessionRef } from '@brobot2/runtime'
import { type Provider, type SessionStatus } from '@brobot2/shared'

import { readLines } from './native-io'
import { providerDefinitions } from '../providers/index'

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
type BundleVersion = 1 | 2

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
const EXPORT_LEDGER_BATCH = 1_000

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

async function writeStreamed(
  path: string,
  write: (append: (text: string) => Promise<void>) => Promise<void>,
): Promise<string> {
  mkdirSync(dirname(path), { recursive: true })
  await writeAtomically(path, write)
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
      await append(`${row.frame}\n`)
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
    await append('{\n')
    await append(`  "bundleVersion": ${JSON.stringify(BUNDLE_VERSION)},\n`)
    await append(`  "meta": ${atDepth(source.meta, 2)},\n`)
    await append('  "raw": {\n')
    await append(`    "format": ${JSON.stringify(source.format)},\n`)
    await append('    "frames": [')
    for await (const row of eachRow(source.frames, batches.frames ?? EXPORT_FRAME_BATCH, between)) {
      await append(`${frames === 0 ? '' : ','}\n      ${JSON.stringify(row.frame)}`)
      frames += 1
    }
    await append(frames === 0 ? ']\n' : '\n    ]\n')
    await append('  },\n')
    await append('  "ledger": [')
    for await (const row of eachRow(
      source.ledger,
      batches.ledger ?? EXPORT_LEDGER_BATCH,
      between,
    )) {
      await append(`${ledgerEntries === 0 ? '' : ','}\n    ${atDepth(row, 4)}`)
      ledgerEntries += 1
    }
    await append(ledgerEntries === 0 ? ']\n' : '\n  ]\n')
    await append('}\n')
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

export function nativeExportPath(
  provider: Provider,
  targetHome: string,
  ref: SessionRef,
  startedAt: number,
  recordedAt: string,
): string {
  return providerDefinitions[provider].transcripts.exportPath(
    targetHome,
    ref,
    startedAt,
    recordedAt,
  )
}
export function nativeExportSupport(provider: Provider): {
  format: string
  resumable: boolean
  note: string
} {
  return providerDefinitions[provider].transcripts.exportSupport()
}
