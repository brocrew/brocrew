import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { Worker } from 'node:worker_threads'
import { appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  aDiagnosticsSink,
  writeWhole,
  type DiagnosticsSink,
  type WritePart,
} from '../src/main/diagnostics-sink'

/**
 * The page's freeze reports and the main thread's stalls are written to the console and to
 * `stalls.log`. Taking a line in is the main thread's: it queues the line and returns. Writing it
 * is a writer's, one batch at a time, in order, moving the log aside between batches. A slow disk
 * or console therefore never holds the thread the report is about, the queue never grows past its
 * bound, and a line lost is counted once, never logged again as a warning of its own.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function aFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'brobot2-diagnostics-'))
  folders.push(folder)
  return folder
}

/** A writer that holds every append until released, as a stalled disk does, then writes freely. */
function heldWriter() {
  const held: (() => void)[] = []
  let calls = 0
  let released = false
  return {
    append: (file: string, text: string): Promise<void> => {
      calls += 1
      if (released) return appendFile(file, text)
      return new Promise<void>((done) => held.push(() => void appendFile(file, text).then(done)))
    },
    release: () => {
      released = true
      for (const go of held.splice(0)) go()
    },
    get calls() {
      return calls
    },
  }
}

/** Spends `ms` of the calling thread, as a synchronous write to a slow disk does. */
function busy(ms: number): void {
  const until = performance.now() + ms
  while (performance.now() < until) {
    /* the thread is held */
  }
}

const p95 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0

/** The synchronous time each line costs the caller. */
function receiptTimes(take: (line: string) => void, lines: number): number[] {
  const times: number[] = []
  for (let index = 0; index < lines; index++) {
    const started = performance.now()
    take(`fictional stall ${String(index)}`)
    times.push(performance.now() - started)
  }
  return times
}

/** A console that keeps each line it is handed. */
const collecting =
  (into: string[]) =>
  async (text: string): Promise<void> => {
    into.push(...text.trimEnd().split('\n'))
  }
const silent = async (): Promise<void> => {}

/**
 * How late a 10 ms timer ran at worst while `work` went on: the main thread's own heartbeat, which
 * a write on it would hold however fast the receipt returned.
 */
async function worstLateness(work: () => Promise<void>): Promise<number> {
  let worst = 0
  let expected = performance.now() + 10
  const beat = setInterval(() => {
    const now = performance.now()
    worst = Math.max(worst, now - expected)
    expected = now + 10
  }, 10)
  try {
    await work()
  } finally {
    clearInterval(beat)
  }
  return worst
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

async function drained(sink: DiagnosticsSink): Promise<void> {
  await sink.idle()
}

describe('taking a line in', () => {
  it('returns at once while the disk and the console are both stalled', async () => {
    const logs = aFolder()
    const writer = heldWriter()
    const consoled: string[] = []
    const keep = collecting(consoled)
    const sink = aDiagnosticsSink({
      logs,
      append: writer.append,
      console: async (text) => {
        await pause(50)
        await keep(text)
      },
    })
    const times = receiptTimes((line) => sink.accept(line), 1_000)
    expect(p95(times)).toBeLessThanOrEqual(5)
    expect(consoled, 'the console was written inside the receipt').toEqual([])
    writer.release()
    await drained(sink)
  })

  it('THE CONTROL — a line written where it is taken in holds the caller for the write', () => {
    const logs = aFolder()
    const file = join(logs, 'stalls.log')
    const times = receiptTimes((line) => {
      busy(20)
      appendFileSync(file, `${line}\n`)
    }, 20)
    expect(p95(times)).toBeGreaterThan(5)
  })
})

describe('what is written', () => {
  it('writes every line in the order it was taken, to the log and to the console', async () => {
    const logs = aFolder()
    const consoled: string[] = []
    const sink = aDiagnosticsSink({ logs, console: collecting(consoled) })
    for (let index = 0; index < 300; index++) sink.accept(`line ${String(index)}`)
    await drained(sink)
    const expected = Array.from({ length: 300 }, (_, index) => `line ${String(index)}`)
    expect(readFileSync(join(logs, 'stalls.log'), 'utf8')).toBe(`${expected.join('\n')}\n`)
    expect(consoled).toEqual(expected)
  })

  it('keeps the order across the log being moved aside', async () => {
    const logs = aFolder()
    const sink = aDiagnosticsSink({ logs, console: silent, mostLogBytes: 2_000 })
    const lines = Array.from({ length: 400 }, (_, index) => `ordered line ${String(index)}`)
    for (const line of lines) sink.accept(line)
    await drained(sink)
    expect(readdirSync(logs).sort()).toEqual(['stalls.1.log', 'stalls.log'])
    const older = readFileSync(join(logs, 'stalls.1.log'), 'utf8').trimEnd().split('\n')
    const newer = readFileSync(join(logs, 'stalls.log'), 'utf8').trimEnd().split('\n')
    const kept = [...older, ...newer]
    expect(kept).toEqual(lines.slice(lines.length - kept.length))
    expect(newer.length).toBeGreaterThan(0)
  })

  it('writes to the console alone when there is no log folder, as a hidden launch does', async () => {
    const consoled: string[] = []
    const sink = aDiagnosticsSink({ logs: null, console: collecting(consoled) })
    sink.accept('hidden one')
    sink.accept('hidden two')
    expect(consoled).toEqual([])
    await drained(sink)
    expect(consoled).toEqual(['hidden one', 'hidden two'])
  })
})

describe('a stalled writer', () => {
  it('keeps at most its bound, and says once how many lines it lost', async () => {
    const logs = aFolder()
    const writer = heldWriter()
    const sink = aDiagnosticsSink({
      logs,
      append: writer.append,
      console: silent,
      mostEntries: 64,
    })
    for (let index = 0; index < 10_000; index++) sink.accept(`flood ${String(index)}`)
    expect(sink.queued()).toBeLessThanOrEqual(64)
    writer.release()
    await drained(sink)
    const written = readFileSync(join(logs, 'stalls.log'), 'utf8').trimEnd().split('\n')
    const notices = written.filter((line) => /diagnostic lines? dropped/.test(line))
    expect(notices).toHaveLength(1)
    const dropped = Number(/(\d+) diagnostic/.exec(notices[0]!)![1])
    const kept = written.filter((line) => line.startsWith('flood '))
    expect(kept.length + dropped).toBe(10_000)
    expect(kept).toEqual([...kept].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))))
  })

  it('counts a failed write as lost lines, tries again only with the next line, and logs no warning of its own', async () => {
    const logs = aFolder()
    const consoled: string[] = []
    let failing = true
    let tries = 0
    const sink = aDiagnosticsSink({
      logs,
      console: collecting(consoled),
      append: (file, text) => {
        tries += 1
        return failing ? Promise.reject(new Error('fictional disk full')) : appendFile(file, text)
      },
    })
    sink.accept('lost one')
    await drained(sink)
    await pause(20)
    // One try, then the writer waits: a disk that keeps failing is not asked again in a loop.
    expect(tries).toBe(1)
    failing = false
    sink.accept('kept one')
    await drained(sink)
    const written = readFileSync(join(logs, 'stalls.log'), 'utf8').trimEnd().split('\n')
    expect(written).toEqual(['1 diagnostic line dropped', 'kept one'])
    // The console still said the line the log refused.
    expect(consoled[0]).toBe('lost one')
    expect(consoled.filter((line) => /fictional disk full/.test(line))).toEqual([])
  })

  it('says a line refused for its size while the app runs, though nothing else was queued', async () => {
    const consoled: string[] = []
    const sink = aDiagnosticsSink({ logs: null, console: collecting(consoled), mostBytes: 10 })
    sink.accept('a line far longer than the ten bytes this sink may hold')
    await drained(sink)
    expect(consoled).toEqual(['1 diagnostic line dropped'])
  })

  it('keeps the lines it wrote when the log cannot be moved aside', async () => {
    const logs = aFolder()
    // A folder where the older log would go: the move fails, the lines are already written.
    mkdirSync(join(logs, 'stalls.1.log', 'occupied'), { recursive: true })
    const sink = aDiagnosticsSink({ logs, console: silent, mostLogBytes: 10 })
    const lines = Array.from({ length: 130 }, (_, index) => `kept ${String(index)}`)
    for (const line of lines) sink.accept(line)
    await drained(sink)
    expect(readFileSync(join(logs, 'stalls.log'), 'utf8')).toBe(`${lines.join('\n')}\n`)
  })

  it('makes the log folder it is given, where none is yet', async () => {
    const logs = join(aFolder(), 'nested', 'logs')
    const sink = aDiagnosticsSink({ logs, console: silent })
    sink.accept('one')
    sink.accept('two')
    await drained(sink)
    expect(readFileSync(join(logs, 'stalls.log'), 'utf8')).toBe('one\ntwo\n')
  })
})

describe('at quit', () => {
  it('tells lines never started from the batch still being written, and keeps the deadline', async () => {
    const logs = aFolder()
    const writer = heldWriter()
    const sink = aDiagnosticsSink({ logs, append: writer.append, console: silent })
    for (let index = 0; index < 100; index++) sink.accept(`late ${String(index)}`)
    // The first batch of 64 is with the writer, held; the other 36 have not started.
    await pause(20)
    expect(writer.calls).toBe(1)
    const started = performance.now()
    const left = await sink.close(100)
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(left).toEqual({ notStarted: 36, inFlight: 64, dropped: 0, said: false })
    // A line after the close is counted, never queued.
    sink.accept('after the quit began')
    expect(sink.queued()).toBe(0)
    // The batch in flight still lands, whole and in order, and nothing after it does.
    writer.release()
    await drained(sink)
    const written = readFileSync(join(logs, 'stalls.log'), 'utf8').trimEnd().split('\n')
    expect(written).toEqual(Array.from({ length: 64 }, (_, index) => `late ${String(index)}`))
    expect(writer.calls).toBe(1)
  })

  it('counts the lines it took in apart from those it refused', async () => {
    const logs = aFolder()
    const writer = heldWriter()
    const sink = aDiagnosticsSink({ logs, append: writer.append, console: silent, mostEntries: 10 })
    for (let index = 0; index < 100; index++) sink.accept(`burst ${String(index)}`)
    await pause(20)
    expect(await sink.close(50)).toEqual({ notStarted: 0, inFlight: 10, dropped: 90, said: false })
    writer.release()
    await drained(sink)
  })

  it('counts queued, in-flight and refused lines each once', async () => {
    const logs = aFolder()
    const writer = heldWriter()
    const sink = aDiagnosticsSink({ logs, append: writer.append, console: silent, mostEntries: 10 })
    sink.accept('first')
    await pause(20)
    for (let index = 0; index < 30; index++) sink.accept(`queued ${String(index)}`)
    expect(await sink.close(50)).toEqual({ notStarted: 10, inFlight: 1, dropped: 20, said: false })
    writer.release()
    await drained(sink)
  })

  it('writes what it holds until the deadline, then says what it left after the last batch', async () => {
    const consoled: string[] = []
    const sink = aDiagnosticsSink({
      logs: aFolder(),
      append: async (file, text) => {
        await pause(30)
        await appendFile(file, text)
      },
      console: collecting(consoled),
    })
    for (let index = 0; index < 100; index++) sink.accept(`quitting ${String(index)}`)
    const closing = sink.close(500)
    // Taken in after the quit began: refused and counted, never written.
    sink.accept('too late')
    expect(await closing).toEqual({ notStarted: 0, inFlight: 0, dropped: 1, said: true })
    expect(consoled.slice(0, 100)).toEqual(
      Array.from({ length: 100 }, (_, index) => `quitting ${String(index)}`),
    )
    expect(consoled.slice(100)).toEqual([
      'stall lines at quit: 0 not written, 0 still being written, 1 dropped before',
    ])

    // Past its deadline, the notice is not written later either.
    const held = heldWriter()
    const later: string[] = []
    const stuck = aDiagnosticsSink({
      logs: aFolder(),
      append: held.append,
      console: collecting(later),
    })
    stuck.accept('stuck')
    await pause(5)
    expect((await stuck.close(30)).said).toBe(false)
    held.release()
    await drained(stuck)
    await pause(20)
    expect(later).toEqual(['stuck'])
  })
})

/**
 * A named pipe read from a thread of its own, starting only after `afterMs`, so a write that holds
 * the main thread is still let go. The reader also holds a writing end of its own, so one writer
 * closing never ends the pipe: every writer after it can still open and write, whether it blocks
 * the main thread or not. `log` opens nothing until the wait is over, as nobody would open
 * `stalls.log` until then; `console` opens at once, so a writer can open the pipe. `text()` stops
 * the reader and gives back everything it read.
 */
function aPipeReadLater(path: string, kind: 'log' | 'console', afterMs: number) {
  const stop = new Int32Array(new SharedArrayBuffer(4))
  const reader = new Worker(
    `
    const { workerData, parentPort } = require('node:worker_threads')
    const fs = require('node:fs')
    const { path, kind, after, stop } = workerData
    const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
    const open = () => {
      const read = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
      const keep = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)
      return { read, keep }
    }
    let ends = null
    if (kind === 'console') {
      ends = open()
      parentPort.postMessage({ ready: true })
    }
    sleep(after)
    if (kind === 'log') ends = open()
    const chunks = []
    const buffer = Buffer.alloc(65536)
    for (;;) {
      const stopping = Atomics.load(stop, 0) === 1
      let read = 0
      try {
        read = fs.readSync(ends.read, buffer, 0, buffer.length, null)
      } catch (error) {
        if (error.code !== 'EAGAIN') throw error
      }
      if (read > 0) { chunks.push(Buffer.from(buffer.subarray(0, read))); continue }
      if (stopping) break
      sleep(5)
    }
    fs.closeSync(ends.keep)
    fs.closeSync(ends.read)
    parentPort.postMessage({ text: Buffer.concat(chunks).toString('utf8') })
    `,
    { eval: true, workerData: { path, kind, after: afterMs, stop } },
  )
  const ready = new Promise<void>((done) =>
    reader.on('message', (said: { ready?: true }) => said.ready && done()),
  )
  const text = new Promise<string>((done, failed) => {
    reader.on('message', (said: { text?: string }) => said.text !== undefined && done(said.text))
    reader.on('error', failed)
  })
  return {
    ready,
    text: (): Promise<string> => {
      Atomics.store(stop, 0, 1)
      return text
    },
    stop: () => reader.terminate(),
  }
}

/** Bursts past the queue's bound, then a quit, all timed by the main heartbeat. */
async function aBusyQuit(sink: DiagnosticsSink, deadlineMs: number) {
  let left: Awaited<ReturnType<DiagnosticsSink['close']>> | null = null
  const worst = await worstLateness(async () => {
    for (let burst = 0; burst < 3; burst++) {
      for (let index = 0; index < 600; index++)
        sink.accept(`heartbeat ${String(burst)}-${String(index)}`)
      await pause(150)
    }
    left = await sink.close(deadlineMs)
  })
  return { worst, left: left! }
}

describe.skipIf(process.platform === 'win32')(
  'the main thread keeps its heartbeat with the shipped writers',
  () => {
    it('while the log cannot be opened, the queue overflows and the app quits', async () => {
      const logs = aFolder()
      const log = join(logs, 'stalls.log')
      execFileSync('mkfifo', [log])
      const reader = aPipeReadLater(log, 'log', 1_500)
      const nowhere = openSync('/dev/null', 'w')
      try {
        const sink = aDiagnosticsSink({ logs, consoleFd: nowhere })
        const { worst, left } = await aBusyQuit(sink, 200)
        expect(worst).toBeLessThan(50)
        expect(left.inFlight).toBeGreaterThan(0)
        expect(left.notStarted + left.dropped).toBeGreaterThan(0)
        expect(left.said).toBe(false)
        await drained(sink)
        const landed = (await reader.text()).trimEnd().split('\n')
        expect(landed).toHaveLength(left.inFlight)
        expect(landed[0]).toBe('heartbeat 0-0')
      } finally {
        closeSync(nowhere)
        await reader.stop()
      }
    }, 20_000)

    it('while the console is full, the queue overflows and the app quits', async () => {
      const pipe = join(aFolder(), 'console')
      execFileSync('mkfifo', [pipe])
      const reader = aPipeReadLater(pipe, 'console', 1_500)
      await reader.ready
      const consoleFd = openSync(pipe, 'w')
      // Fill the pipe, so the next write to it waits for the reader.
      const filler = openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK)
      try {
        for (;;) writeSync(filler, Buffer.alloc(4096, '.'))
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe('EAGAIN')
      } finally {
        closeSync(filler)
      }
      try {
        const sink = aDiagnosticsSink({ logs: null, consoleFd })
        const { worst, left } = await aBusyQuit(sink, 200)
        expect(worst).toBeLessThan(50)
        expect(left.inFlight).toBeGreaterThan(0)
        expect(left.said).toBe(false)
        await drained(sink)
        closeSync(consoleFd)
        const landed = (await reader.text()).replace(/^\.+/, '').trimEnd().split('\n')
        expect(landed).toHaveLength(left.inFlight)
        expect(landed[0]).toBe('heartbeat 0-0')
      } finally {
        await reader.stop()
      }
    }, 20_000)
  },
)

describe('a console that takes part of a write', () => {
  /** A descriptor that takes at most `most` bytes per write, as a full pipe does. */
  function aShortPipe(most: number) {
    const taken: Buffer[] = []
    let writes = 0
    const part: WritePart = async (_fd, buffer, offset, length) => {
      writes += 1
      await pause(0)
      const size = Math.min(most, length)
      taken.push(Buffer.from(buffer.subarray(offset, offset + size)))
      return size
    }
    return { part, text: () => Buffer.concat(taken).toString('utf8'), writes: () => writes }
  }

  it('writes the rest from where each short write stopped, whole and in order, across characters', async () => {
    const pipe = aShortPipe(3)
    const text = 'stall · 12 ms → één\nnext line\n'
    await writeWhole(2, text, pipe.part)
    expect(pipe.text()).toBe(text)
    expect(pipe.writes()).toBeGreaterThan(Buffer.byteLength(text) / 3 - 1)
  })

  it('keeps batches in order through the sink when every console write is short', async () => {
    const pipe = aShortPipe(7)
    const sink = aDiagnosticsSink({ logs: null, console: (text) => writeWhole(2, text, pipe.part) })
    const lines = Array.from({ length: 150 }, (_, index) => `short ${String(index)}`)
    for (const line of lines.slice(0, 70)) sink.accept(line)
    await pause(5)
    for (const line of lines.slice(70)) sink.accept(line)
    await drained(sink)
    expect(pipe.text()).toBe(`${lines.join('\n')}\n`)
  })

  it('THE CONTROL — taking one write as the whole loses the rest', async () => {
    const pipe = aShortPipe(3)
    await pipe.part(2, Buffer.from('a whole line\n'), 0, 13)
    expect(pipe.text()).not.toBe('a whole line\n')
  })
})
