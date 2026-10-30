import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { fileTimeOf, type TableReading, type TableRow } from '../src/codex/windows-tree'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(() => {
    throw new Error('unexpected process table command')
  }),
}))

function child(pid?: number) {
  return Object.assign(new EventEmitter(), {
    pid,
    stdin: Object.assign(new PassThrough(), { end: vi.fn() }),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  })
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
let app: ReturnType<typeof child>, ender: ReturnType<typeof child>
let born: bigint
let stopOnEof: boolean, stopOnKill: boolean
let outcomes: Map<string, string>
let running: Set<number>
let transports: SpawnCodexTransport[]
let cleaning = false
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  born = fileTimeOf(Date.now())
  app = child(4811)
  ender = child(9811)
  transports = []
  cleaning = false
  stopOnEof = true
  stopOnKill = true
  outcomes = new Map()
  running = new Set()
  vi.mocked(spawn).mockImplementation((command) => {
    if (command === 'fictional-program') return app as unknown as ReturnType<typeof spawn>
    if (command === 'powershell.exe') return ender as unknown as ReturnType<typeof spawn>
    throw new Error('unexpected command')
  })
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal !== 0) throw new Error('unexpected process signal')
    if (!running.has(pid)) throw Object.assign(new Error('fictional gone'), { code: 'ESRCH' })
    return true
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  app.stdin.end.mockImplementation(() => {
    if (stopOnEof) queueMicrotask(() => app.emit('exit'))
    return app.stdin
  })
  app.kill.mockImplementation(() => {
    if (stopOnKill) queueMicrotask(() => app.emit('exit'))
    return true
  })
  ender.stdin.end.mockImplementation((request?: string) => {
    if (request) {
      const keys = request.split('|')[0]!.split(' ')
      ender.stdout.emit(
        'data',
        keys.map((key) => `${outcomes.get(key) ?? 'ended'} ${key}`).join('\n'),
      )
    }
    queueMicrotask(() => ender.emit('exit'))
    return ender.stdin
  })
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
})
afterEach(async () => {
  cleaning = true
  try {
    for (const transport of transports) {
      const closing = transport.close()
      app.emit('exit')
      await vi.advanceTimersByTimeAsync(60_000)
      await closing
    }
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    Object.defineProperty(process, 'platform', platform)
    for (const one of [app, ender]) {
      one.removeAllListeners()
      for (const stream of [one.stdin, one.stdout, one.stderr]) stream.removeAllListeners()
    }
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.resetAllMocks()
  }
})
function transport(read: (ms: number) => Promise<TableReading | null>) {
  const value = new SpawnCodexTransport('fictional-program', [], {
    env: {},
    processTable: (ms) =>
      cleaning ? Promise.resolve(reading([], fileTimeOf(Date.now()))) : read(ms),
    exitGraceMs: 40,
    killGraceMs: 40,
    stopBudgetMs: 2000,
  })
  transports.push(value)
  return value
}
function frame(message: object) {
  app.stdout.emit('data', `${JSON.stringify(message)}\n`)
}
function item() {
  frame({ method: 'item/started', params: {} })
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function reading(rows: TableRow[], at = born + 20_000_000n): TableReading {
  return { rows, at }
}
async function closed(value: SpawnCodexTransport) {
  const started = Date.now()
  const closing = value.close()
  let settledAt: number | undefined
  void closing.then(() => {
    settledAt = Date.now()
  })
  expect(value.close()).toBe(closing)
  await vi.advanceTimersByTimeAsync(2000)
  await closing
  expect(settledAt).toBeDefined()
  expect(settledAt! - started).toBeGreaterThanOrEqual(0)
  expect(settledAt! - started).toBeLessThanOrEqual(2000)
}

it('single-flight sampling owes one reread and retains a vanished launcher without adopting its reused PID', async () => {
  const launcher = { pid: 4812, ppid: 4811, created: born + 100_000n }
  const descendant = { pid: 4813, ppid: 4812, created: born + 200_000n }
  const stranger = { pid: 4812, ppid: 1, created: born + 30_000_000n }
  const strangersChild = { pid: 4814, ppid: 4812, created: born + 40_000_000n }
  let release!: (value: TableReading) => void
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    .mockResolvedValueOnce(reading([launcher]))
    .mockResolvedValue(reading([descendant, stranger, strangersChild], born + 50_000_000n))
  const value = transport(read)
  frame({ method: 'turn/started' })
  expect(read).not.toHaveBeenCalled()
  item()
  item()
  item()
  expect(read).toHaveBeenCalledExactlyOnceWith(15_000)
  release(reading([launcher], born + 10_000_000n))
  await flush()
  expect(read.mock.calls).toEqual([[15_000], [15_000]])
  running.add(descendant.pid)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  expect(ender.stdin.end).toHaveBeenCalledExactlyOnceWith(`4813:${descendant.created}|1960\n`)
  expect(read.mock.calls[2]).toEqual([500])
  expect(console.warn).not.toHaveBeenCalled()
  expect(app.kill).not.toHaveBeenCalled()
  expect(value.pid).toBeUndefined()
  expect(quiet).toBe(true)
  expect(spawn).toHaveBeenCalledTimes(2)
})

it('a rejected and then unavailable sample releases single-flight state and leaves responses usable', async () => {
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockRejectedValueOnce(new Error('fictional sampling failure'))
    .mockResolvedValueOnce(null)
    .mockResolvedValue(reading([]))
  const value = transport(read)
  item()
  await flush()
  item()
  await flush()
  const response = value.request('fictional/request', {})
  expect(() =>
    app.stdin.emit('error', Object.assign(new Error('fictional pipe'), { code: 'EPIPE' })),
  ).not.toThrow()
  frame({ id: 1, result: { recovered: true } })
  await expect(response).resolves.toEqual({ recovered: true })
  expect(read.mock.calls).toEqual([[15_000], [15_000]])
  await closed(value)
  await value.quiesced
  expect(ender.stdin.end).toHaveBeenCalledExactlyOnceWith()
  expect(console.warn).not.toHaveBeenCalled()
})

it('retains at most 4096 identities and refreshes a known launcher cutoff without evicting another identity', async () => {
  const rows = Array.from({ length: 4096 }, (_, index) => ({
    pid: 10_000 + index,
    ppid: 4811,
    created: born + BigInt(index + 1),
  }))
  const newest = { pid: 20_000, ppid: 4811, created: born + 9000n }
  const laterChild = { pid: 20_001, ppid: rows[1]!.pid, created: born + 25_000_000n }
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockResolvedValueOnce(reading(rows))
    .mockResolvedValueOnce(reading([rows[1]!], born + 30_000_000n))
    .mockResolvedValueOnce(reading([newest], born + 40_000_000n))
    .mockResolvedValueOnce(reading([laterChild], born + 50_000_000n))
    .mockResolvedValue(null)
  const value = transport(read)
  item()
  await flush()
  item()
  await flush()
  item()
  await flush()
  item()
  await flush()
  for (const row of [...rows, newest, laterChild]) running.add(row.pid)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  const targets = (ender.stdin.end.mock.calls[0]![0] as string).split('|')[0]!.split(' ')
  expect(targets).toHaveLength(4096)
  expect(targets).not.toContain(`${rows[0]!.pid}:${rows[0]!.created}`)
  expect(targets).not.toContain(`${rows[1]!.pid}:${rows[1]!.created}`)
  expect(targets).toContain(`${rows[2]!.pid}:${rows[2]!.created}`)
  expect(targets).toContain(`${newest.pid}:${newest.created}`)
  expect(targets).toContain(`${laterChild.pid}:${laterChild.created}`)
  expect(quiet).toBe(false)
  expect(console.warn).toHaveBeenCalledExactlyOnceWith(
    'codex app-server 4811: the process table was not read in time, so only the processes found before were ended; what it started since may still be running',
  )
  running.clear()
  running.add(rows[0]!.pid)
  await vi.advanceTimersByTimeAsync(200_000)
  expect(quiet).toBe(false)
})

it.each(['alive', 'failed'] as const)(
  'a descendant reported %s keeps cleanup unproved after leader exit',
  async (outcome) => {
    const row = { pid: 4813, ppid: 4811, created: born + 1000n }
    running.add(row.pid)
    outcomes.set(`4813:${row.created}`, outcome)
    const value = transport(async () => reading([row]))
    let quiet = false
    void value.quiesced.then(() => {
      quiet = true
    })
    await closed(value)
    await value.exited
    expect(quiet).toBe(false)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      `codex app-server 4811: may still be running after 2000ms: 4813:${row.created} ${outcome}`,
    )
  },
)

it('ends an uncooperative leader through its child handle and waits for that exit before publishing cleanup', async () => {
  stopOnEof = false
  stopOnKill = false
  const value = transport(async () => reading([]))
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  const closing = value.close()
  await vi.advanceTimersByTimeAsync(79)
  expect(app.kill).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(app.kill).toHaveBeenCalledExactlyOnceWith()
  expect(quiet).toBe(false)
  app.emit('exit')
  await closing
  await value.quiesced
  expect(quiet).toBe(true)
  expect(ender.stdin.end).toHaveBeenCalledExactlyOnceWith()
  await vi.advanceTimersByTimeAsync(2000)
  expect(console.warn).not.toHaveBeenCalled()
})

it('a table that never answers reaches the reserve deadline using only previously observed identities', async () => {
  const row = { pid: 4813, ppid: 4811, created: born + 1000n }
  let finish!: (value: TableReading | null) => void
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockResolvedValueOnce(reading([row]))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  const value = transport(read)
  item()
  await flush()
  running.add(row.pid)
  let settled = false
  const closing = value.close().then(() => {
    settled = true
  })
  await vi.advanceTimersByTimeAsync(499)
  expect(settled).toBe(false)
  expect(ender.stdin.end).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await closing
  expect(ender.stdin.end).toHaveBeenCalledExactlyOnceWith(`4813:${row.created}|1500\n`)
  expect(console.warn).toHaveBeenCalledOnce()
  finish(null)
  await flush()
})

it('a leader that never reports exit stays unproved at the stop deadline even with an empty table', async () => {
  stopOnEof = false
  stopOnKill = false
  const value = transport(async () => reading([]))
  let exited = false,
    quiet = false
  void value.exited.then(() => {
    exited = true
  })
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  expect(app.kill).toHaveBeenCalledExactlyOnceWith()
  expect(exited).toBe(false)
  expect(quiet).toBe(false)
  expect(console.warn).toHaveBeenCalledExactlyOnceWith(
    'codex app-server 4811: may still be running after 2000ms: 4811 (the app-server itself) alive',
  )
})

it('a spawn without a PID settles exit and close without starting an ending helper', async () => {
  app.pid = undefined
  const read = vi.fn(async () => reading([]))
  const value = transport(read)
  item()
  app.emit('error', new Error('fictional unavailable program'))
  await value.close()
  await value.exited
  await value.quiesced
  expect(read).not.toHaveBeenCalled()
  expect(spawn).toHaveBeenCalledOnce()
  expect(ender.stdin.end).not.toHaveBeenCalled()
})

it('observes a late empty Windows tree after a missing stop reading without extending close', async () => {
  const read = vi.fn<(ms: number) => Promise<TableReading | null>>().mockResolvedValue(null)
  const value = transport(read)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  await value.exited
  expect(quiet).toBe(false)
  const before = read.mock.calls.length
  expect(before).toBeGreaterThanOrEqual(1)
  read.mockImplementation(async () => reading([], fileTimeOf(Date.now())))
  await vi.advanceTimersByTimeAsync(20_000)
  expect(quiet).toBe(true)
  expect(read.mock.calls.length).toBeGreaterThan(before)
  expect(app.kill).not.toHaveBeenCalled()
  expect(ender.stdin.end).toHaveBeenCalledTimes(1)
  const count = read.mock.calls.length
  await vi.advanceTimersByTimeAsync(60_000)
  expect(read).toHaveBeenCalledTimes(count)
})

it('keeps unknown and live identities held, then ignores a reused PID without killing it', async () => {
  const owned = { pid: 4813, ppid: 4811, created: born + 1000n }
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockImplementation(async () => reading([owned], fileTimeOf(Date.now())))
  running.add(owned.pid)
  outcomes.set(`4813:${owned.created}`, 'failed')
  const value = transport(read)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  const kills = ender.stdin.end.mock.calls.length
  expect(quiet).toBe(false)
  await vi.advanceTimersByTimeAsync(3000)
  expect(quiet).toBe(false)
  read.mockResolvedValue(null)
  await vi.advanceTimersByTimeAsync(5000)
  expect(quiet).toBe(false)
  read.mockImplementation(async () => reading([{ ...owned, created: 0n }], fileTimeOf(Date.now())))
  await vi.advanceTimersByTimeAsync(10_000)
  expect(quiet).toBe(false)
  const stranger = { pid: owned.pid, ppid: 1, created: fileTimeOf(Date.now()) }
  read.mockImplementation(async () => reading([stranger], fileTimeOf(Date.now())))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(quiet).toBe(true)
  expect(ender.stdin.end).toHaveBeenCalledTimes(kills)
  expect(app.kill).not.toHaveBeenCalled()
})

it('keeps post-stop table reads single-flight while a slow reading is outstanding', async () => {
  let finish!: (value: TableReading) => void
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockResolvedValueOnce(null)
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  const value = transport(read)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  try {
    await closed(value)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(quiet).toBe(false)
    finish(reading([], fileTimeOf(Date.now())))
    await flush()
    expect(quiet).toBe(true)
    expect(ender.stdin.end).toHaveBeenCalledTimes(1)
  } finally {
    finish?.(reading([], fileTimeOf(Date.now())))
  }
})

it('joins a stop reading that outlasted its budget before observing again', async () => {
  let finish!: (value: TableReading | null) => void
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockImplementation(async () => reading([], fileTimeOf(Date.now())))
  const value = transport(read)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  try {
    await closed(value)
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(quiet).toBe(false)
    finish(null)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(quiet).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
  } finally {
    finish?.(null)
  }
})

it('releases after bounded table failures only when the exited leader and known PIDs are gone', async () => {
  const read = vi.fn<(ms: number) => Promise<TableReading | null>>().mockResolvedValue(null)
  const value = transport(read)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  read.mockRejectedValue(new Error('fictional CIM unavailable'))
  await vi.advanceTimersByTimeAsync(110_000)
  expect(quiet).toBe(false)
  await vi.advanceTimersByTimeAsync(90_000)
  expect(quiet).toBe(true)
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining('unobserved descendants may still be running'),
  )
  expect(app.kill).not.toHaveBeenCalled()
  expect(ender.stdin.end).toHaveBeenCalledTimes(1)
})

it('does not release on table failures while a known or reused PID remains alive', async () => {
  const owned = { pid: 4813, ppid: 4811, created: born + 1000n }
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockResolvedValue(reading([owned]))
  const value = transport(read)
  item()
  await flush()
  running.add(owned.pid)
  outcomes.set(`4813:${owned.created}`, 'failed')
  read.mockResolvedValue(null)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  const endings = ender.stdin.end.mock.calls.length
  await vi.advanceTimersByTimeAsync(200_000)
  expect(quiet).toBe(false)
  running.delete(owned.pid)
  running.add(4811)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(quiet).toBe(false)
  running.delete(4811)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(quiet).toBe(true)
  expect(app.kill).not.toHaveBeenCalled()
  expect(ender.stdin.end).toHaveBeenCalledTimes(endings)
})

it('never treats a successful table with an unknown identity as a table failure deadline', async () => {
  const read = vi
    .fn<(ms: number) => Promise<TableReading | null>>()
    .mockResolvedValueOnce(null)
    .mockImplementation(async () =>
      reading([{ pid: 4813, ppid: 4811, created: 0n }], fileTimeOf(Date.now())),
    )
  const value = transport(read)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  await vi.advanceTimersByTimeAsync(200_000)
  expect(quiet).toBe(false)
  read.mockImplementation(async () => reading([], fileTimeOf(Date.now())))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(quiet).toBe(true)
})

it.each(['EPERM', 'EIO'])('retains exclusion when a direct PID probe reports %s', async (code) => {
  const read = vi.fn<(ms: number) => Promise<TableReading | null>>().mockResolvedValue(null)
  const value = transport(read)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  vi.mocked(process.kill).mockImplementation(() => {
    throw Object.assign(new Error('fictional probe unavailable'), { code })
  })
  await vi.advanceTimersByTimeAsync(200_000)
  expect(quiet).toBe(false)
  vi.mocked(process.kill).mockImplementation(() => {
    throw Object.assign(new Error('fictional gone'), { code: 'ESRCH' })
  })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(quiet).toBe(true)
  expect(app.kill).not.toHaveBeenCalled()
})

it('does not shorten the failure delay when the wall clock jumps forward', async () => {
  const value = transport(async () => null)
  let quiet = false
  void value.quiesced.then(() => {
    quiet = true
  })
  await closed(value)
  vi.setSystemTime(Date.now() + 600_000)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(quiet).toBe(false)
  await vi.advanceTimersByTimeAsync(200_000)
  expect(quiet).toBe(true)
})
