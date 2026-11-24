import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../src/main/db/connection'
import { incrementallyCompact } from '../src/main/db/compact'
import type { EventTrimResult } from '../src/main/db/event-retention'
import * as logging from '../src/main/logging/log'
import { startEventRetention } from '../src/main/storage/event-retention'

vi.mock('../src/main/db/event-retention', () => ({
  eventTrimWriter: () => () => ({ changed: 200, durationMs: 1, checkpointMs: 0 }),
}))
vi.mock('../src/main/db/compact', () => ({ incrementallyCompact: vi.fn() }))

const minute = 60_000
const result = (removed: number): EventTrimResult => ({
  removed,
  batches: 0,
  longestBatchMs: 0,
  longestSelectionMs: 0,
  largestCandidateListRows: 0,
  peakHeapBytes: 0,
  longestCheckpointMs: 0,
  incrementalSteps: 0,
  reclaimedPages: 0,
  longestIncrementalLockMs: 0,
  budgetReached: removed >= 100_000,
  interrupted: false,
  deferredConversations: 0,
  reads: 0,
})

class SweepWorker extends EventEmitter {
  postMessage = vi.fn((message: { kind?: string }) => {
    if (message.kind === 'stop') queueMicrotask(() => this.emit('exit', 0))
  })
  terminate = vi.fn(async () => {
    this.emit('exit', 1)
    return 1
  })
  complete(removed: number): void {
    this.emit('message', { ok: true, value: result(removed) })
    this.emit('exit', 0)
  }
}

describe('event retention sweep timing and logging', () => {
  let logDirectory: string
  let logFile: string
  let retention: ReturnType<typeof startEventRetention>
  let workers: SweepWorker[]
  let start: ReturnType<typeof vi.fn<() => Worker>>
  let trimmed: ReturnType<typeof vi.fn<(value: EventTrimResult) => Promise<void>>>
  let warn: ReturnType<typeof vi.fn<(error: unknown) => void>>

  beforeEach(() => {
    logDirectory = mkdtempSync(join(tmpdir(), 'retention-log-'))
    logFile = join(logDirectory, 'brocrew.log')
    logging.openLog(logFile, { console: false, sync: true })
    vi.spyOn(logging, 'logInfo')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.mocked(incrementallyCompact).mockResolvedValue({
      steps: 0,
      reclaimedPages: 0,
      longestLockMs: 0,
    })
    workers = []
    start = vi.fn(() => {
      const worker = new SweepWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    trimmed = vi.fn(async () => {})
    warn = vi.fn<(error: unknown) => void>()
    retention = startEventRetention({} as AppDatabase, start, trimmed, warn)
  })

  afterEach(async () => {
    await retention.stop()
    const records = vi.mocked(logging.logInfo)
    const lines = existsSync(logFile)
      ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      : []
    expect(lines).toHaveLength(records.mock.calls.length)
    for (const [index, call] of records.mock.calls.entries()) {
      const outcome = call[2] as { removed: number; elapsedMs: number; status: string }
      expect(lines[index]).toContain('[info]')
      expect(lines[index]).toContain(`removed: ${outcome.removed}`)
      expect(lines[index]).toContain(`elapsedMs: ${outcome.elapsedMs}`)
      expect(lines[index]).toContain(outcome.status)
    }
    rmSync(logDirectory, { recursive: true, force: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('logs zero removals and waits an hour after completion, starting ten minutes after the list', async () => {
    retention.firstListAccepted(2 * minute)
    retention.firstListAccepted(0)
    await vi.advanceTimersByTimeAsync(12 * minute - 1)
    expect(start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(start).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(17_000)
    workers[0]!.complete(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(console.info).toHaveBeenCalledOnce()
    expect(logging.logInfo).toHaveBeenCalledOnce()
    expect(console.info).toHaveBeenNthCalledWith(1, 'BroCrew event history sweep started.')
    expect(logging.logInfo).toHaveBeenCalledWith(
      'retention',
      'Event history sweep ended',
      expect.objectContaining({ removed: 0, elapsedMs: 17_000, exitCode: 0, status: 'completed' }),
    )
    expect(trimmed).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60 * minute - 1)
    expect(start).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('catches up sixty seconds after all completion work, without overlapping a long sweep', async () => {
    let finish!: () => void
    trimmed.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    retention.firstListAccepted(0)
    await vi.advanceTimersByTimeAsync(10 * minute)
    await vi.advanceTimersByTimeAsync(70 * minute)
    expect(start).toHaveBeenCalledOnce()
    workers[0]!.complete(100_000)
    await vi.advanceTimersByTimeAsync(2 * minute)
    expect(start).toHaveBeenCalledOnce()
    expect(console.info).toHaveBeenCalledOnce()
    finish()
    await vi.advanceTimersByTimeAsync(minute - 1)
    expect(start).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(start).toHaveBeenCalledTimes(2)
    workers[1]!.complete(3)
    await vi.advanceTimersByTimeAsync(60 * minute - 1)
    expect(start).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(start).toHaveBeenCalledTimes(3)
  })

  it.each(['exit', 'empty', 'message', 'error', 'start', 'compact'] as const)(
    'logs one failure end for %s, including its exit code, without a fast retry',
    async (mode) => {
      if (mode === 'start')
        start.mockImplementationOnce(() => {
          throw new Error('start failed')
        })
      if (mode === 'compact')
        vi.mocked(incrementallyCompact).mockRejectedValueOnce(new Error('compact failed'))
      retention.firstListAccepted(0)
      await vi.advanceTimersByTimeAsync(10 * minute)
      if (mode !== 'start') {
        if (mode === 'message') workers[0]!.emit('message', { ok: false, error: 'message failed' })
        if (mode === 'error') workers[0]!.emit('error', new Error('worker failed'))
        if (mode === 'compact') workers[0]!.complete(100_000)
        else workers[0]!.emit('exit', mode === 'exit' || mode === 'error' ? 7 : 0)
      }
      await vi.advanceTimersByTimeAsync(0)
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          exitCode: mode === 'start' ? null : mode === 'exit' || mode === 'error' ? 7 : 0,
          elapsedMs: expect.any(Number),
          error: expect.any(String),
        }),
      )
      expect(console.info).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(minute)
      expect(start).toHaveBeenCalledOnce()
    },
  )

  it('uses the twenty-minute fallback and logs a joined stop with applied rows', async () => {
    await vi.advanceTimersByTimeAsync(20 * minute - 1)
    expect(start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    workers[0]!.emit('message', { kind: 'trim-batch', batch: {} })
    workers[0]!.postMessage.mockImplementationOnce(() => {})
    let joined = false
    const stopped = retention.stop().then(() => {
      joined = true
    })
    expect(workers[0]!.postMessage).toHaveBeenLastCalledWith({ kind: 'stop' })
    await Promise.resolve()
    expect(joined).toBe(false)
    workers[0]!.emit('exit', 0)
    await stopped
    expect(joined).toBe(true)
    expect(workers[0]!.terminate).not.toHaveBeenCalled()
    expect(trimmed).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledOnce()
    expect(logging.logInfo).toHaveBeenCalledOnce()
    expect(logging.logInfo).toHaveBeenLastCalledWith(
      'retention',
      'Event history sweep ended',
      expect.objectContaining({ status: 'stopped', removed: 200, exitCode: 0 }),
    )
    await vi.advanceTimersByTimeAsync(120 * minute)
    expect(start).toHaveBeenCalledOnce()
  })
})
