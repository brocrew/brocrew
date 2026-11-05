import { write } from 'node:fs'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** How large `stalls.log` grows before it is moved aside to `stalls.1.log`. */
export const STALL_LOG_MOST_BYTES = 8 * 1024 * 1024

const MOST_ENTRIES = 512
const MOST_BYTES = 256 * 1024
const LINES_PER_BATCH = 64

/** Writes part of a buffer to a file descriptor and says how many bytes went, as `fs.write` does. */
export type WritePart = (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
) => Promise<number>

const writePart: WritePart = (fd, buffer, offset, length) =>
  new Promise((done, failed) => {
    write(fd, buffer, offset, length, null, (error, written) => {
      if (error) failed(error)
      else done(written)
    })
  })

/**
 * Writes the whole of `text` to `fd`, asking again from where a short write stopped, so a pipe that
 * takes part of a batch neither loses nor reorders the rest. The write runs on the threadpool: a
 * slow terminal or pipe holds a pool thread, never the main thread as `console.warn` would.
 */
export async function writeWhole(
  fd: number,
  text: string,
  part: WritePart = writePart,
): Promise<void> {
  const bytes = Buffer.from(text, 'utf8')
  for (let written = 0; written < bytes.length;) {
    written += await part(fd, bytes, written, bytes.length - written)
  }
}

/** Where the sink writes, and its bounds. */
export interface DiagnosticsSinkOptions {
  /** The folder `stalls.log` is kept in, or `null` to write to the console alone. */
  readonly logs: string | null
  /** The descriptor the console mirror writes to through {@link writeWhole}: standard error. */
  readonly consoleFd?: number
  /** Replaces the console mirror; for tests that collect what it says. */
  readonly console?: (text: string) => Promise<void>
  readonly append?: (file: string, text: string) => Promise<void>
  /** The most lines held while the writer is behind. */
  readonly mostEntries?: number
  /** The most bytes held while the writer is behind. */
  readonly mostBytes?: number
  /** How large `stalls.log` grows before it is moved aside to `stalls.1.log`. */
  readonly mostLogBytes?: number
}

/** What a closing sink left behind at its deadline. */
export interface SinkClosed {
  /** Lines it had taken in that were never started. */
  readonly notStarted: number
  /** Lines of the batch already being written, which may still land after the deadline. */
  readonly inFlight: number
  /** Lines refused (queue full, too large, or after the close) or lost to a failed write, not yet said in the log. */
  readonly dropped: number
  /** Whether the closing notice was written within the deadline. */
  readonly said: boolean
}

export interface DiagnosticsSink {
  /** Queues one line and returns; it never writes and never throws. */
  accept(line: string): void
  /** How many lines are waiting for the writer. */
  queued(): number
  /** Resolves once the writer has nothing left to write. */
  idle(): Promise<void>
  /**
   * Stops taking lines, lets the writer go on until `deadlineMs`, then says on the console what it
   * left behind, within the same deadline. What had not started by then is dropped and counted; a
   * batch already being written is left to finish, and the notice follows it so the two never
   * interleave.
   */
  close(deadlineMs: number): Promise<SinkClosed>
}

interface Entry {
  readonly line: string
  /** Lines refused after this one because the queue was full. */
  lostAfter: number
}

const droppedSays = (count: number): string =>
  `${String(count)} diagnostic ${count === 1 ? 'line' : 'lines'} dropped`

const closedSays = (left: Omit<SinkClosed, 'said'>): string =>
  `stall lines at quit: ${String(left.notStarted)} not written, ${String(left.inFlight)} still being written, ${String(left.dropped)} dropped before`

/**
 * Diagnostics written off the caller's thread. Taking a line in queues it and returns; one writer
 * appends the queue in order, a batch at a time, to the log and then the console, and moves the log
 * aside between batches. Neither write runs on the main thread. While the writer is behind, the
 * queue holds at most its bound and every refused line is counted, then said once, in place, as a
 * line of its own. A write that fails counts its lines the same way and logs nothing about itself,
 * so a broken disk cannot become a storm of warnings. Taking a line in is not a promise it reaches
 * the disk: a quit waits for the writer only until its deadline.
 */
export function aDiagnosticsSink(options: DiagnosticsSinkOptions): DiagnosticsSink {
  const append = options.append ?? ((file: string, text: string) => appendFile(file, text))
  const consoleFd = options.consoleFd ?? 2
  const mirror = options.console ?? ((text: string) => writeWhole(consoleFd, text))
  const mostEntries = options.mostEntries ?? MOST_ENTRIES
  const mostBytes = options.mostBytes ?? MOST_BYTES
  const mostLogBytes = options.mostLogBytes ?? STALL_LOG_MOST_BYTES
  const file = options.logs === null ? null : join(options.logs, 'stalls.log')
  const queue: Entry[] = []
  let queuedBytes = 0
  /** Losses with no queued line to say them after, said at the head of the next batch. */
  let carried = 0
  /** Every loss not yet said by a batch that reached its record. */
  let unsaid = 0
  let inFlight = 0
  let draining: Promise<void> | null = null
  /** Set when a quit begins: no line is taken in after it. */
  let closing = false
  /** Set at the quit's deadline: no batch is started after it. */
  let closed = false
  let madeFolder = false
  let writtenSinceLook = 0

  async function rotate(): Promise<void> {
    if (file === null || options.logs === null) return
    const size = await stat(file).then(
      (found) => found.size,
      () => 0,
    )
    if (size > mostLogBytes) await rename(file, join(options.logs, 'stalls.1.log'))
  }

  /**
   * Writes one batch to the log, then to the console; says whether the log took it. The console
   * gets every batch whatever became of the log, so a full disk does not silence standard error.
   */
  async function record(text: string): Promise<boolean> {
    let logged = file === null
    if (file !== null && options.logs !== null) {
      try {
        if (!madeFolder) {
          await mkdir(options.logs, { recursive: true })
          madeFolder = true
        }
        await append(file, text)
        logged = true
      } catch {
        /* counted by the caller as lost */
      }
    }
    const mirrored = await mirror(text).then(
      () => true,
      () => false,
    )
    if (file === null) return mirrored
    if (logged) {
      writtenSinceLook += text.split('\n').length - 1
      if (writtenSinceLook >= LINES_PER_BATCH) {
        writtenSinceLook = 0
        // The lines are written; a log that could not be moved aside keeps growing until next time.
        await rotate().catch(() => {})
      }
    }
    return logged
  }

  /** Writes one batch and says whether its record took it. */
  async function writeBatch(batch: readonly Entry[]): Promise<boolean> {
    const lines: string[] = []
    const head = carried
    carried = 0
    if (head > 0) lines.push(droppedSays(head))
    let refusals = head
    for (const entry of batch) {
      lines.push(entry.line)
      if (entry.lostAfter > 0) lines.push(droppedSays(entry.lostAfter))
      refusals += entry.lostAfter
    }
    if (await record(`${lines.join('\n')}\n`)) {
      unsaid -= refusals
      return true
    }
    // Its lines are lost too, and every loss in it is said by the next batch.
    carried += refusals + batch.length
    unsaid += batch.length
    return false
  }

  async function drain(): Promise<void> {
    // Starts after the caller's turn, so a burst of lines is written as one batch.
    await new Promise<void>((started) => setImmediate(started))
    while (!closed && (queue.length > 0 || carried > 0)) {
      const batch = queue.splice(0, LINES_PER_BATCH)
      for (const entry of batch) queuedBytes -= Buffer.byteLength(entry.line)
      inFlight = batch.length
      const took = await writeBatch(batch)
      inFlight = 0
      // A record that refused is tried again when the next line arrives, never in a loop of its own.
      if (!took) break
    }
    draining = null
  }

  function refuse(): void {
    unsaid += 1
    const last = queue.at(-1)
    if (last) last.lostAfter += 1
    else carried += 1
  }

  return {
    accept(line) {
      if (closing) {
        unsaid += 1
        return
      }
      const bytes = Buffer.byteLength(line)
      if (queue.length >= mostEntries || queuedBytes + bytes > mostBytes) refuse()
      else {
        queue.push({ line, lostAfter: 0 })
        queuedBytes += bytes
      }
      // A refusal starts the writer too, so the loss is said while the app runs.
      draining ??= drain()
    },
    queued: () => queue.length,
    idle: async () => {
      while (draining !== null) await draining
    },
    async close(deadlineMs) {
      closing = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<'late'>((late) => {
        timer = setTimeout(() => late('late'), deadlineMs)
      })
      const writing = draining
      if (writing !== null) await Promise.race([writing, deadline])
      closed = true
      const notStarted = queue.splice(0).length
      queuedBytes = 0
      const left = { notStarted, inFlight, dropped: unsaid }
      let said = false
      if (left.notStarted + left.inFlight + left.dropped > 0) {
        // After the batch in flight, never beside it, and only within what is left of the deadline:
        // once the deadline has passed, the notice is not written at all.
        let late = false
        const notice = (writing ?? Promise.resolve()).then(() =>
          late
            ? false
            : mirror(`${closedSays(left)}\n`).then(
                () => true,
                () => false,
              ),
        )
        const first = await Promise.race([notice, deadline])
        late = first === 'late'
        said = first === true
      }
      clearTimeout(timer)
      return { ...left, said }
    },
  }
}
