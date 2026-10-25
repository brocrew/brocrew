import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FilesLibraryLifetime, type LibraryWorker } from '../src/main/db/files-library-reader'
import { FilesLibraryEngine } from '../src/main/db/files-library-engine'
import { libraryUnavailable, type FilesLibraryResult } from '../src/shared/files-library'
import {
  filesLibraryFixture,
  workspaceQuery,
  libraryContext,
} from './helpers/files-library-fixture'
import { bundleAWorker } from './helpers/bundle-a-worker'

class FictionalWorker extends EventEmitter implements LibraryWorker {
  posted: Record<string, unknown>[] = []
  terminationRequested = false
  postMessage(value: unknown): void {
    this.posted.push(value as Record<string, unknown>)
  }
  terminate(): Promise<number> {
    this.terminationRequested = true
    return Promise.resolve(0)
  }
  ready(): void {
    this.emit('message', { type: 'ready' })
  }
  reply(result: FilesLibraryResult = libraryUnavailable('budget')): void {
    this.emit('message', { type: 'read', id: this.posted.at(-1)!['id'], result })
  }
  exit(): void {
    this.emit('exit', 1)
  }
}
const query = { operation: 'query' as const, query: workspaceQuery }
afterEach(() => vi.useRealTimers())

it('coalesces waiting queries while retaining the native permit through cooperative cancellation', async () => {
  const workers: FictionalWorker[] = []
  const lifetime = new FilesLibraryLifetime(() => {
    const worker = new FictionalWorker()
    workers.push(worker)
    return worker
  })
  const first = lifetime.read(query, libraryContext)
  const worker = workers[0]!
  worker.ready()
  const second = lifetime.read(query, libraryContext)
  const latest = lifetime.read(query, libraryContext)
  expect(await second).toMatchObject({ cause: 'cancelled' })
  expect(worker.posted).toHaveLength(1)
  expect(
    Atomics.load(new Int32Array(worker.posted[0]!['cancellation'] as SharedArrayBuffer), 0),
  ).toBe(1)
  worker.reply()
  expect(await first).toMatchObject({ cause: 'cancelled' })
  expect(worker.posted).toHaveLength(2)
  worker.reply()
  expect(await latest).toMatchObject({ cause: 'budget' })
  expect(workers).toHaveLength(1)
  expect(worker.terminationRequested).toBe(false)
  const retry = lifetime.read(query, libraryContext)
  worker.reply(libraryUnavailable('metadata', 8, 1))
  expect(await retry).toMatchObject({ cause: 'metadata', unread: 1 })
  const closed = lifetime.close()
  worker.exit()
  await closed
})

it('cancels before ready without allocating another native worker', async () => {
  const worker = new FictionalWorker()
  const lifetime = new FilesLibraryLifetime(() => worker)
  const first = lifetime.read(query, libraryContext),
    latest = lifetime.read(query, libraryContext)
  expect(worker.posted).toHaveLength(0)
  worker.ready()
  worker.reply()
  expect(await first).toMatchObject({ cause: 'cancelled' })
  worker.reply()
  await latest
  const closed = lifetime.close()
  worker.exit()
  await closed
})

it('waits for actual exit on timeout, limits forced replacements and respects the rolling cooldown', async () => {
  vi.useFakeTimers()
  let now = 0
  const workers: FictionalWorker[] = []
  const lifetime = new FilesLibraryLifetime(
    () => {
      const worker = new FictionalWorker()
      workers.push(worker)
      return worker
    },
    () => now,
    20,
  )
  for (let i = 0; i < 4; i++) {
    const read = lifetime.read(query, libraryContext)
    await Promise.resolve()
    const worker = workers[i]!
    expect(worker).toBeDefined()
    worker.ready()
    let settled = false
    void read.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(21)
    expect(worker.terminationRequested).toBe(true)
    expect(settled).toBe(false)
    expect(workers).toHaveLength(i + 1)
    worker.exit()
    expect(await read).toMatchObject({ cause: 'worker' })
  }
  expect(await lifetime.read(query, libraryContext)).toMatchObject({
    cause: 'busy',
    retryAfterMs: 60_000,
  })
  expect(workers).toHaveLength(4)
  now = 60_001
  const retry = lifetime.read(query, libraryContext)
  await Promise.resolve()
  workers[4]!.ready()
  workers[4]!.reply()
  expect(await retry).toMatchObject({ cause: 'budget' })
  const closed = lifetime.close()
  workers[4]!.exit()
  await closed
})

it('malformed or oversized worker replies fail closed and release only after exit', async () => {
  const worker = new FictionalWorker()
  const lifetime = new FilesLibraryLifetime(() => worker)
  const read = lifetime.read(query, libraryContext)
  worker.ready()
  worker.emit('message', { type: 'read', id: 1, result: { type: 'files', files: [] } })
  expect(worker.terminationRequested).toBe(true)
  worker.exit()
  expect(await read).toMatchObject({ cause: 'worker' })
  await lifetime.close()
})

it('runs real native worker queries/pages/provenance and closes its owned connection', async () => {
  const f = filesLibraryFixture()
  f.example()
  try {
    const bundled = await bundleAWorker(
      'src/main/files-library.worker.ts',
      f.directory,
      'files-library.cjs',
    )
    const lifetime = new FilesLibraryLifetime(
      () => new Worker(bundled, { workerData: { file: f.file } }),
    )
    try {
      const result = await lifetime.read({ ...query, size: 2 }, libraryContext)
      expect(result.type).toBe('files')
      if (result.type !== 'files') throw new Error(JSON.stringify(result))
      expect([result.totalFiles, result.totalKeeps, result.files.length]).toEqual([16, 22, 2])
      const page = await lifetime.read({ operation: 'page', cursor: result.next! }, libraryContext)
      expect(page.type).toBe('files')
      const provenance = await lifetime.read(
        {
          operation: 'provenance',
          snapshot: result.snapshot,
          sha256: result.files[0]!.file.sha256,
        },
        libraryContext,
      )
      expect(provenance.type).toBe('provenance')
      expect(await lifetime.read({ operation: 'release' }, libraryContext)).toEqual({
        type: 'released',
      })
      expect(
        await lifetime.read({ operation: 'page', cursor: result.next! }, libraryContext),
      ).toMatchObject({ cause: 'cursor-expired' })
    } finally {
      await lifetime.close()
    }
    expect(await lifetime.read(query, libraryContext)).toMatchObject({ cause: 'closed' })
  } finally {
    f.close()
  }
})

it('bounds time and abandoned native scans honestly without poisoning the surviving engine', () => {
  let now = 0
  const f = filesLibraryFixture()
  f.example()
  const engine = new FilesLibraryEngine(f.file, () => now)
  try {
    let checks = 0
    expect(
      engine.read(query, libraryContext, () => {
        if (++checks === 10) now = 5_001
        return false
      }),
    ).toMatchObject({ cause: 'budget', complete: false })
    expect(engine.read(query, libraryContext).type).toBe('files')
  } finally {
    engine.close()
    f.close()
  }
})

it('cooperatively cancels inside the real worker engine without releasing its permit or restarting it', async () => {
  const f = filesLibraryFixture()
  f.example()
  const driver = join(f.directory, 'native-cancellation.ts')
  const enginePath = new URL('../src/main/db/files-library-engine.ts', import.meta.url).pathname
  writeFileSync(
    driver,
    `
    import { parentPort, workerData } from 'node:worker_threads'
    import { FilesLibraryEngine } from ${JSON.stringify(enginePath)}
    let flag, first = true
    const engine = new FilesLibraryEngine(workerData.file, Date.now, (sql) => {
      if (first && sql.includes('FROM work_resource')) {
        first = false
        parentPort.postMessage({ type: 'native-reading' })
        Atomics.wait(flag, 0, 0, 500)
      }
    })
    parentPort.postMessage({ type: 'ready' })
    parentPort.on('message', ({ id, request, context, cancellation }) => {
      flag = new Int32Array(cancellation)
      parentPort.postMessage({ type: 'read', id,
        result: engine.read(request, context, () => Atomics.load(flag, 0) !== 0) })
    })
  `,
  )
  let nativeStarted!: () => void
  const entered = new Promise<void>((resolve) => {
    nativeStarted = resolve
  })
  class ObservedWorker extends EventEmitter implements LibraryWorker {
    constructor(readonly worker: Worker) {
      super()
      worker.on('message', (message: { type: string }) => {
        if (message.type === 'native-reading') nativeStarted()
        else this.emit('message', message)
      })
      worker.on('error', (error) => this.emit('error', error))
      worker.on('exit', (code) => this.emit('exit', code))
    }
    postMessage: Worker['postMessage'] = (...args) => this.worker.postMessage(...args)
    terminate: Worker['terminate'] = () => this.worker.terminate()
  }
  let starts = 0
  let lifetime: FilesLibraryLifetime | undefined
  try {
    const bundle = await bundleAWorker(driver, f.directory, 'native-cancellation.cjs')
    lifetime = new FilesLibraryLifetime(() => {
      starts++
      return new ObservedWorker(new Worker(bundle, { workerData: { file: f.file } }))
    })
    const first = lifetime.read(query, libraryContext)
    await entered
    const latest = lifetime.read(query, libraryContext)
    expect(starts).toBe(1)
    expect(await first).toMatchObject({ cause: 'cancelled' })
    expect(await latest).toMatchObject({ type: 'files', totalFiles: 16, totalKeeps: 22 })
    expect(starts).toBe(1)
  } finally {
    await lifetime?.close()
    f.close()
  }
})
