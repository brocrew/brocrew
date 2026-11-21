import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEnvironmentData, Worker } from 'node:worker_threads'
import { once } from 'node:events'
import Database from 'better-sqlite3'
import { afterEach, expect, test, vi } from 'vitest'
import { databaseMemory, observeDatabaseMemory } from '../src/main/database-memory'
import { memoryDiagnostic, withWorkerMemory } from '../src/main/worker-memory'
import { startMemoryWatch } from '../src/main/memory-watch'
import {
  readWorkerMemory,
  writeWorkerMemory,
  WORKER_MEMORY_BYTES,
  WORKER_MEMORY_CONNECTIONS,
} from '../src/main/worker-memory-record'
import { bundleAWorker } from './helpers/bundle-a-worker'

const folders: string[] = []
const workers: Worker[] = []
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()))
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

test('the warning reads distinct live isolates and removes exited generations without waiting', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'worker-memory-'))
  folders.push(folder)
  const bundle = await bundleAWorker(
    'test/helpers/memory-diagnostic.worker.ts',
    folder,
    'worker.cjs',
  )
  const start = async (rows: number, cacheSize: number) => {
    const worker = withWorkerMemory(
      'window-reader',
      () =>
        new Worker(bundle, {
          workerData: { rows, cacheSize },
        }),
    )
    workers.push(worker)
    const ready = once(worker, 'message')
    expect(getEnvironmentData('brocrew.worker-memory')).toBeUndefined()
    const [own] = await ready
    expect(own.heapUsed).toBeGreaterThan(0)
    expect(own.inheritedSlotCleared).toBe(true)
    return worker
  }
  const first = await start(100_000, -4096)
  const second = await start(4_000_000, 123)
  const line = memoryDiagnostic()
  const heaps = [...line.matchAll(/window-reader#\d+:live ageMs=\d+ heapUsed=(\d+)/g)].map(
    (match) => Number(match[1]),
  )
  expect(heaps).toHaveLength(2)
  expect(Math.max(...heaps) - Math.min(...heaps)).toBeGreaterThan(15_000_000)
  expect(line).toContain('cache_size=-4096(configured-KiB)')
  expect(line).toContain('cache_size=123(configured-pages)')
  const warnings: string[] = []
  let tick = () => {}
  const watch = startMemoryWatch({
    sample: () => 3 * 1024 ** 3,
    log: (line) => warnings.push(line),
    setInterval: (sample) => {
      tick = sample
      return 1
    },
    clearInterval: () => {},
  })
  tick()
  tick()
  watch.stop()
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain('worker isolate memory bytes:')
  expect(warnings[0]).toContain('cache_size=-4096(configured-KiB)')
  const firstHeap = () =>
    Number(memoryDiagnostic().match(/window-reader#\d+:live ageMs=\d+ heapUsed=(\d+)/)?.[1])
  const beforeRead = firstHeap()
  const refreshed = once(first, 'message')
  first.postMessage({ afterRead: true, rows: 2_000_000, offsetMs: 31_000 })
  await refreshed
  const afterRead = firstHeap()
  expect(afterRead - beforeRead).toBeGreaterThan(10_000_000)
  const withinBudget = once(first, 'message')
  first.postMessage({ afterRead: true, rows: 2_000_000, offsetMs: 31_000 })
  await withinBudget
  expect(firstHeap()).toBe(afterRead)
  expect(memoryDiagnostic(Date.now() + 180_000)).toContain('/stale')
  const ended = once(first, 'exit')
  first.postMessage('close')
  await ended
  expect(memoryDiagnostic().match(/window-reader#\d+:live/g)).toHaveLength(1)
  const stopping = second.terminate()
  expect(memoryDiagnostic()).toContain(':closing')
  await stopping
  expect(memoryDiagnostic()).toContain('window-reader:closed')
  expect(memoryDiagnostic()).not.toMatch(/window-reader#\d+:/)
  const replacement = await start(100_000, 0)
  expect(memoryDiagnostic().match(/window-reader#\d+:live/g)).toHaveLength(1)
  const exited = once(replacement, 'exit')
  replacement.postMessage('close')
  await exited
  const earlyStop = withWorkerMemory(
    'storage',
    () =>
      new Worker(bundle, {
        workerData: { rows: 0, cacheSize: null },
      }),
  )
  workers.push(earlyStop)
  const stoppedEarly = earlyStop.terminate()
  earlyStop.emit('online')
  expect(memoryDiagnostic()).toMatch(/storage#\d+:closing/)
  await stoppedEarly
  const noConnection = withWorkerMemory(
    'settings-locator',
    () =>
      new Worker(bundle, {
        workerData: { rows: 0, cacheSize: null },
      }),
  )
  workers.push(noConnection)
  await once(noConnection, 'message')
  expect(memoryDiagnostic()).toMatch(/settings-locator#\d+:live.*sqlite=no-open-connection/)
  const noConnectionExit = once(noConnection, 'exit')
  noConnection.postMessage('close')
  await noConnectionExit
}, 30_000)

test('writer and readonly handle settings are actual signed limits, with no closed-handle PRAGMA', () => {
  const folder = mkdtempSync(join(tmpdir(), 'cache-setting-'))
  folders.push(folder)
  const file = join(folder, 'fictional.sqlite')
  const writer = new Database(file)
  writer.exec('CREATE TABLE example(value)')
  const reader = new Database(file, { readonly: true })
  try {
    writer.pragma('cache_size=-321')
    reader.pragma('cache_size=77')
    observeDatabaseMemory(writer, 'writer')
    observeDatabaseMemory(reader, 'window-reader')
    expect(databaseMemory().map((row) => row.cacheSize)).toEqual(expect.arrayContaining([-321, 77]))
    expect(memoryDiagnostic()).toContain('cache_size=-321(configured-KiB)')
    const pragma = vi.spyOn(reader, 'pragma')
    reader.close()
    pragma.mockClear()
    expect(databaseMemory().some((row) => row.cacheSize === 77)).toBe(false)
    expect(pragma).not.toHaveBeenCalled()
  } finally {
    if (reader.open) reader.close()
    writer.close()
  }
})

test('a partial numeric publication is unavailable and capacity overflow is explicit', () => {
  const record = new BigInt64Array(new SharedArrayBuffer(WORKER_MEMORY_BYTES))
  expect(readWorkerMemory(record)).toBeNull()
  const rows = Array.from({ length: WORKER_MEMORY_CONNECTIONS + 1 }, (_, generation) => ({
    generation,
    role: 0,
    cacheSize: generation === 0 ? null : -4096,
  }))
  writeWorkerMemory(record, { heapUsed: 101, heapTotal: 202 }, rows, 1234)
  expect(readWorkerMemory(record)).toMatchObject({
    at: 1234,
    heapUsed: 101,
    heapTotal: 202,
    omitted: 1,
    connections: rows.slice(0, WORKER_MEMORY_CONNECTIONS),
  })
  Atomics.add(record, 0, 1n)
  expect(readWorkerMemory(record)).toBeNull()
  writeWorkerMemory(record, { heapUsed: 303, heapTotal: 404 }, [], 5678)
  expect(readWorkerMemory(record)).toMatchObject({ at: 5678, heapUsed: 303, heapTotal: 404 })
})

test('a failed factory restores environment data without registering a phantom worker', () => {
  const before = memoryDiagnostic()
  expect(() =>
    withWorkerMemory('storage', () => {
      throw new Error('not started')
    }),
  ).toThrow('not started')
  expect(getEnvironmentData('brocrew.worker-memory')).toBeUndefined()
  expect(memoryDiagnostic()).toBe(before)
})
