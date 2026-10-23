import { closeSync, openSync, readSync, statSync, watch, type FSWatcher } from 'node:fs'
import { type Provider } from '@brobot2/shared'
import { FileEdits } from '@brobot2/runtime'
import type { ImportedEntry, ImportedTranscript } from './transcript-types'
import { providerDefinitions } from '../providers/definitions'
import { readLines } from './native-file'

/**
 * ONE reader for any session's transcript, whoever wrote it (036).
 *
 * Tailing a child transcript and tailing another provider session use the same reader. The sub-agent card is one consumer; session reading and import can reuse it.
 *
 * ## What it produces
 *
 * The same `TranscriptEvent`s the live stream produces. That is the whole point: a session that was
 * read off disk renders through the identical components, with no `provider ===` branch anywhere in
 * the renderer. The provider difference lives here, in the choice of parser, and stops here.
 *
 * ## Two modes, one parser each
 *
 *  - **read** — a finished file, parsed once.
 *  - **tail** — a file still being appended, followed by `fs.watch` and a byte offset.
 *
 * ## Why a watcher and not a timer
 *
 * A child's file genuinely grows mid-run (measured: 258KB → 369KB during a single sub-agent). A
 * polling interval would either lag the file or wake up hundreds of times to find nothing, and the
 * app already refuses ticking clocks that describe nothing (035). `fs.watch` fires when the OS says
 * something changed and is silent otherwise.
 *
 * ## Partial lines are the hazard, and they are handled
 *
 * A watcher fires while the writer is mid-line. Reading to EOF would hand a parser half a JSON
 * object, which would count as `unreadable` and be LOST — the line is never re-read once the offset
 * moves past it. So the offset only ever advances to the last complete newline, and the trailing
 * fragment is kept for the next event.
 */

/** Where a transcript is, and who wrote it — the only thing the reader needs to know. */
export interface TranscriptSource {
  provider: Provider
  /** Absolute path to the provider's own `.jsonl`. */
  path: string
  /**
   * The time to date a record that carries none. Required for the same reason the importers require
   * it: a default of 0 renders a confident "12:00 AM" over a conversation dated to 1970.
   */
  fallbackAt: number
}

/** What a tail hands back each time the file grows. */
export interface TranscriptChunk {
  entries: ImportedEntry[]
  /** Lines that were not JSON at all — reported, never silently dropped. */
  unreadable: number
  /**
   * True once the file has been read to its end AT LEAST ONCE. It says the reader has caught up,
   * and **nothing more**: see {@link TranscriptTail} for why that is not "finished".
   */
  caughtUp: boolean
}

export interface TranscriptTail {
  /**
   * Stop following. Idempotent — teardown races are ordinary here, since a card can be closed while
   * its child is still writing.
   *
   * ⚠️ **Stopping is not completing, and neither is silence.** A file that stops growing may mean
   * the task finished, or that the process died, or that it is simply thinking. This reader
   * therefore reports only what it can see — bytes arriving — and never an outcome. Completion
   * comes from the endings the providers actually send (`task_updated`/`task_notification` for
   * Claude, `thread/status/changed` for Codex), which is the rule 035 set and the reason
   * `thread_spawn_edges.status` is not used here either: 614 of its 624 rows read `open`, including
   * for threads that ended months ago.
   */
  stop(): void
}

/** Parse a batch of lines the way this provider's own files are written. */
function parseFor(provider: Provider, frames: string[], fallbackAt: number): ImportedTranscript {
  return providerDefinitions[provider].transcripts.parse(frames, fallbackAt)
}

/**
 * Read `length` bytes from `offset`. Uses a positional read rather than a stream because the file
 * is being appended to while we read it: a stream would hold a handle open across the whole tail
 * and see its own buffering, where a positional read answers "what is there now" exactly.
 */
function readFrom(path: string, offset: number, length: number): string {
  if (length <= 0) return ''
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const read = readSync(fd, buffer, 0, length, offset)
    return buffer.toString('utf8', 0, read)
  } finally {
    closeSync(fd)
  }
}

/** File text → the lines a parser should see: no trailing blank from the final newline. */
function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * The largest file {@link readTranscript} will materialize (052).
 *
 * This function returns the whole conversation at once, so its cost is the file's size no matter
 * how it is read — the ceiling is on the CONTRACT, not on the reading technique. Measured on this
 * machine on 2026-08-03: the biggest transcripts in the user's own homes are **1.43 GB** (a Codex
 * rollout) and **0.69 GB** (a Claude transcript). An earlier pass over the same corpus measured
 * **1.53 GB** for the largest single file; both are true readings, because these
 * files are appended to and pruned — the worst case is a moving number, which is itself the
 * argument for a ceiling rather than for trusting any one of them.
 *
 * Anything at that scale must go through `readLines` windows, which stream it in batches; this is the convenience path for ordinary files, and it now says so at the
 * top of its voice instead of dying at an implementation limit.
 *
 * 64 MiB is far below the point where holding one conversation in memory is reckless, and far
 * above any transcript this reader is pointed at in practice.
 */
export const MAX_WHOLE_TRANSCRIPT_BYTES = 64 * 1024 * 1024

/**
 * Everything in a finished file, once. The simple half, and the one 2b's import path will call.
 *
 * ## The whole-file read is gone (052)
 *
 * This used to be `readFrom(path, 0, size)` — the entire file into a **single string**. Two things
 * were wrong with that, and only one of them was a performance problem:
 *
 *  - **It throws outright above ~512 MB**, V8's maximum string length. The two largest transcripts
 *    on this machine are 1.43 GB and 0.69 GB, so this would not have been slow on the biggest
 *    files, it would have been an exception — in a function whose own comment advertised it as the
 *    one 2b's import path would call.
 *  - Below that limit it holds the file twice over: once as the string, once as the split array.
 *
 * The read is now {@link readLines}, in 4,096-line pulls, so no single string is
 * ever larger than one batch. The ARRAY of lines is still whole — that is what "everything at
 * once" means — which is why {@link MAX_WHOLE_TRANSCRIPT_BYTES} exists above it: refusing a file
 * this shape cannot serve, by name and with the reason, beats returning half a conversation or
 * inheriting a limit nobody chose.
 */
export function readTranscript(source: TranscriptSource): ImportedTranscript {
  const size = sizeOf(source.path)
  if (size === 0)
    return { entries: [], unreadable: 0, lastAt: source.fallbackAt, edits: new FileEdits() }
  if (size > MAX_WHOLE_TRANSCRIPT_BYTES) {
    throw new Error(
      `${source.path} is ${size} bytes, over readTranscript's ${MAX_WHOLE_TRANSCRIPT_BYTES}-byte ceiling — ` +
        'this function materializes a whole conversation, so a file this size must be streamed ' +
        'in windows (readLines) instead',
    )
  }
  const lines: string[] = []
  for (let offset = 0; ;) {
    const chunk = readLines(source.path, offset, WHOLE_TRANSCRIPT_LINE_BATCH)
    lines.push(...chunk.lines)
    if (chunk.done) break
    // A pull that returns nothing and is not `done` would spin forever. `readLines` cannot do that
    // today, and the reason is specific: both of its `done: false` returns happen only after at
    // least one line has been taken, and every take adds at least one byte to `consumed` — so the
    // offset has always moved. That is a property of its internals rather than of its contract, so
    // the loop checks rather than trusting it.
    if (chunk.offset === offset) break
    offset = chunk.offset
  }
  // `readLines` emits exactly the lines the old `splitLines` did, minus the empty piece a trailing
  // newline leaves behind — the same contract, and the reason this swap is not observable. That
  // matters because `importClaudeTranscript` counts a blank line as `unreadable`, so a phantom
  // final line would have every real transcript reporting damage it does not have.
  return parseFor(source.provider, lines, source.fallbackAt)
}

/** Lines per pull. Big enough that a 64 MB file is a handful of reads, small enough to bound each. */
const WHOLE_TRANSCRIPT_LINE_BATCH = 4096

/**
 * Follow a file that is still being written, calling `onChunk` with each batch of NEW entries.
 *
 * The first call delivers everything already in the file (with `caughtUp: true`), so a consumer
 * that attaches late is not missing the beginning — which is the normal case for a sub-agent whose
 * card is opened after it started.
 */
export function tailTranscript(
  source: TranscriptSource,
  onChunk: (chunk: TranscriptChunk) => void,
): TranscriptTail {
  let offset = 0
  /** The fragment after the last complete newline — a line the writer had not finished. */
  let pending = ''
  let stopped = false
  let watcher: FSWatcher | null = null
  /** Re-entrancy guard: `fs.watch` can fire again while we are still reading. */
  let reading = false

  const pump = (): void => {
    if (stopped || reading) return
    reading = true
    try {
      const size = sizeOf(source.path)
      // TRUNCATION or replacement: the file got smaller than what we have already consumed, so our
      // offset points into a file that no longer exists. Start again rather than reading garbage
      // from the middle of a different file.
      if (size < offset) {
        offset = 0
        pending = ''
      }
      if (size === offset) return
      const text = pending + readFrom(source.path, offset, size - offset)
      offset = size
      // Only advance past COMPLETE lines. Everything after the last newline is a line the writer
      // has not finished, and re-reading it is impossible once the offset has moved.
      const lastBreak = text.lastIndexOf('\n')
      const complete = lastBreak === -1 ? '' : text.slice(0, lastBreak)
      pending = lastBreak === -1 ? text : text.slice(lastBreak + 1)
      if (complete === '') return
      const parsed = parseFor(source.provider, splitLines(complete), source.fallbackAt)
      if (parsed.entries.length > 0 || parsed.unreadable > 0) {
        onChunk({ ...parsed, caughtUp: true })
      }
    } catch {
      // A file that vanishes mid-tail is an ordinary end, not an error to throw into a watcher
      // callback with nobody to catch it. The consumer keeps whatever it already has.
    } finally {
      reading = false
    }
  }

  // ARM THE WATCHER FIRST, then read what is already there. The other order loses any line written
  // in the gap between the two: the read has passed it and the watcher was not yet listening, so
  // nothing reports it until the NEXT append — and for a child whose last line is written in that
  // window, "the next append" never comes. Arming first can only cause a redundant pump, which the
  // offset makes a no-op.
  try {
    watcher = watch(source.path, { persistent: false }, pump)
  } catch {
    // The file may not exist yet — a child announced before its first line is written. Not an
    // error: the consumer gets nothing, which is the truth, and can retry.
    watcher = null
  }
  pump() // whatever is already there
  // ONE deferred catch-up read, and it closes a real race rather than papering over a test.
  // Measured directly: `fs.watch` does not deliver a change that lands before its kqueue
  // registration takes effect, and that registration is not complete until the event loop turns.
  // A child that writes its final line in that window would otherwise never be reported — the
  // watcher missed it, and there is no later append to notice it by. `setImmediate` is a single
  // scheduled read, not a poll: it happens once, and the offset makes it a no-op if nothing moved.
  setImmediate(() => {
    if (!stopped) pump()
  })

  return {
    stop(): void {
      if (stopped) return
      stopped = true
      watcher?.close()
      watcher = null
    },
  }
}
