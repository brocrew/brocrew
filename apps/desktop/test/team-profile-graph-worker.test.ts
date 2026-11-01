import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import {
  TeamProfileGraphLifetime,
  type GraphWorker,
} from '../src/main/db/team-profile-graph-reader'
import { TeamProfileGraphWindows } from '../src/main/db/team-profile-graph-windows'
import { graphContext } from './helpers/team-profile-graph-fixture'
import {
  graphUnavailable,
  emptyGraphCoverage,
  type TeamProfileGraphResult,
  type TeamProfileGraphRequest,
  type TeamProfileGraphReader,
} from '../src/shared/team-profile-graph'
class Worker extends EventEmitter {
  sent: Record<string, unknown>[] = []
  terminate = vi.fn(async () => 0)
  postMessage = (message: Record<string, unknown>) => {
    this.sent.push(message)
  }
  ready() {
    this.emit('message', { type: 'ready' })
  }
  reply(result: TeamProfileGraphResult) {
    const job = this.sent.at(-1)!
    this.emit('message', { type: 'read', id: job.id, result })
  }
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
afterEach(() => vi.useRealTimers())
const header: TeamProfileGraphResult = {
  type: 'snapshot',
  snapshot: 'fictional-token',
  readAt: 1,
  expiresAt: 60001,
  stale: false,
  semanticsVersion: 1,
  timezone: 'UTC',
  todaySince: 0,
  recentSince: -604799999,
  nodeCount: 0,
  edgeCount: 0,
  coverage: emptyGraphCoverage(),
  metrics: { rows: 0, projectedBytes: 0, aggregateBytes: 0, cacheBytes: 0, elapsedMs: 0 },
}
it('keeps native permit and shutdown pending until actual exit, even if terminate already resolves', async () => {
  vi.useFakeTimers()
  const worker = new Worker(),
    start = vi.fn(() => worker as unknown as GraphWorker),
    reader = new TeamProfileGraphLifetime(start, () => 0, 50)
  const first = reader.read({ operation: 'snapshot' }, graphContext)
  worker.ready()
  const next = reader.read({ operation: 'snapshot' }, graphContext)
  let firstDone = false,
    nextDone = false,
    closed = false
  void first.then(() => (firstDone = true))
  void next.then(() => (nextDone = true))
  await vi.advanceTimersByTimeAsync(50)
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(firstDone).toBe(false)
  expect(start).toHaveBeenCalledOnce()
  const closing = reader.close().then(() => (closed = true))
  await settle()
  expect(closed).toBe(false)
  worker.emit('exit', 1)
  await closing
  expect(closed).toBe(true)
  expect(await first).toMatchObject({ type: 'unavailable' })
  expect(await next).toMatchObject({ type: 'unavailable', cause: 'closed' })
  expect(nextDone).toBe(true)
})
it('admits only one native read and one replaceable successor', async () => {
  const worker = new Worker(),
    reader = new TeamProfileGraphLifetime(() => worker as unknown as GraphWorker)
  const first = reader.read({ operation: 'snapshot' }, graphContext)
  worker.ready()
  const replaced = reader.read({ operation: 'snapshot' }, graphContext),
    last = reader.read({ operation: 'snapshot' }, graphContext)
  expect(await replaced).toMatchObject({ cause: 'cancelled' })
  expect(worker.sent).toHaveLength(1)
  worker.reply(header)
  expect(await first).toMatchObject({ cause: 'cancelled' })
  await settle()
  expect(worker.sent).toHaveLength(2)
  worker.reply(header)
  expect(await last).toEqual(header)
  const closing = reader.close()
  worker.emit('exit', 0)
  await closing
})
it('rejects malformed worker replies and waits for native exit', async () => {
  const worker = new Worker(),
    reader = new TeamProfileGraphLifetime(() => worker as unknown as GraphWorker)
  const reading = reader.read({ operation: 'snapshot' }, graphContext)
  worker.ready()
  worker.emit('message', { type: 'read', id: 1, result: { ...header, privatePath: '/fictional' } })
  await settle()
  expect(worker.terminate).toHaveBeenCalledOnce()
  worker.emit('exit', 1)
  expect(await reading).toMatchObject({ cause: 'worker' })
  await reader.close()
})
it('bounds four windows to two workers plus two waiting windows and releases only after close', async () => {
  const instances: { reader: TeamProfileGraphReader; resolveClose: () => void }[] = []
  const start = () => {
    let resolveClose!: () => void
    const closing = new Promise<void>((r) => (resolveClose = r))
    const reader: TeamProfileGraphReader = {
      read: vi.fn(async (request: TeamProfileGraphRequest) =>
        request.operation === 'snapshot' ? header : graphUnavailable('expired'),
      ),
      close: () => closing,
    }
    instances.push({ reader, resolveClose })
    return reader
  }
  const windows = new TeamProfileGraphWindows(start, 'UTC')
  await windows.read('a', { operation: 'snapshot' }, '0')
  await windows.read('b', { operation: 'snapshot' }, '0')
  const third = windows.read('c', { operation: 'snapshot' }, '0'),
    fourth = windows.read('d', { operation: 'snapshot' }, '0')
  expect(instances).toHaveLength(2)
  expect(await windows.read('e', { operation: 'snapshot' }, '0')).toMatchObject({ cause: 'busy' })
  let closed = false
  const closeA = windows.closeWindow('a').then(() => (closed = true))
  await settle()
  expect(closed).toBe(false)
  expect(instances).toHaveLength(2)
  instances[0]!.resolveClose()
  await closeA
  await third
  expect(instances).toHaveLength(3)
  const closeB = windows.closeWindow('b')
  instances[1]!.resolveClose()
  await closeB
  await fourth
  expect(instances).toHaveLength(4)
  const closing = windows.close()
  instances[2]!.resolveClose()
  instances[3]!.resolveClose()
  await closing
})
it('shares failure cooldown across owner changes and resists backward wall time', async () => {
  let mono = 0,
    failed!: () => void
  const windows = new TeamProfileGraphWindows(
    (_admission, failure) => {
      failed = failure
      return { read: async () => header, close: async () => {} }
    },
    'UTC',
    () => mono,
  )
  await windows.read('a', { operation: 'snapshot' }, '0')
  failed()
  failed()
  failed()
  await windows.closeWindow('a')
  expect(await windows.read('b', { operation: 'snapshot' }, '0')).toMatchObject({
    cause: 'busy',
    retryAfterMs: 60000,
  })
  mono = 60001
  expect((await windows.read('b', { operation: 'snapshot' }, '0')).type).toBe('snapshot')
  await windows.close()
})

it('runs the production native worker, pages its complete reading, and observes real exit', async () => {
  const { Worker: NativeWorker } = await import('node:worker_threads')
  const { bundleAWorker } = await import('./helpers/bundle-a-worker')
  const { graphFixture } = await import('./helpers/team-profile-graph-fixture')
  const f = graphFixture()
  f.seed()
  f.db.exec(
    'UPDATE agent_identity SET created_at=created_at-86400000; UPDATE provider_session SET created_at=created_at-86400000,updated_at=updated_at-86400000; UPDATE work SET created_at=created_at-86400000; UPDATE events SET created_at=created_at-86400000; UPDATE turn SET opened_at=opened_at-86400000,closed_at=closed_at-86400000',
  )
  try {
    const bundle = await bundleAWorker(
      'src/main/team-profile-graph.worker.ts',
      f.directory,
      'graph-worker.cjs',
    )
    let native: InstanceType<typeof NativeWorker> | undefined,
      exited = false
    const reader = new TeamProfileGraphLifetime(() => {
      native = new NativeWorker(bundle, {
        workerData: { file: f.file, executionFile: f.executionFile },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      })
      native.on('exit', () => (exited = true))
      return native
    })
    try {
      const result = await reader.read({ operation: 'snapshot' }, graphContext)
      expect(result.type, JSON.stringify(result)).toBe('snapshot')
      if (result.type !== 'snapshot') throw new Error('incomplete reading')
      expect([result.nodeCount, result.edgeCount]).toEqual([5, 3])
      const page = await reader.read(
        { operation: 'nodes', snapshot: result.snapshot },
        graphContext,
      )
      expect(page.type).toBe('nodes')
      if (page.type === 'nodes') expect(page.nodes).toHaveLength(5)
      await reader.close()
      expect(exited).toBe(true)
    } finally {
      await reader.close()
    }
  } finally {
    f.close()
  }
})

it('includes workspace admission wait in the same six-second native watchdog', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  let starts = 0
  const windows = new TeamProfileGraphWindows(
    () => {
      const index = ++starts
      let settleRead: ((r: TeamProfileGraphResult) => void) | undefined
      return {
        read: async () =>
          index < 3
            ? header
            : new Promise<TeamProfileGraphResult>((resolve) => (settleRead = resolve)),
        close: async () => {
          settleRead?.(graphUnavailable('closed'))
        },
      }
    },
    'UTC',
    () => Date.now(),
  )
  await windows.read('a', { operation: 'snapshot' }, '0')
  await windows.read('b', { operation: 'snapshot' }, '0')
  const waiting = windows.read('c', { operation: 'snapshot' }, '0')
  await vi.advanceTimersByTimeAsync(5000)
  await windows.closeWindow('a')
  await settle()
  expect(starts).toBe(3)
  await vi.advanceTimersByTimeAsync(1001)
  expect(await waiting).toMatchObject({ type: 'unavailable', cause: 'worker' })
  await windows.close()
})

it('cooperatively cancels a real engine between native pages and can build again after rollback', async () => {
  const { Worker: NativeWorker } = await import('node:worker_threads')
  const { writeFileSync } = await import('node:fs')
  const { join, resolve } = await import('node:path')
  const { bundleAWorker } = await import('./helpers/bundle-a-worker')
  const { graphFixture } = await import('./helpers/team-profile-graph-fixture')
  const { graphCutoff } = await import('./fixtures/team-profile-graph-oracle')
  const f = graphFixture()
  try {
    f.identity('aid:a')
    f.identity('aid:b')
    f.session('a', 'aid:a')
    f.session('b', 'aid:b')
    f.root('a')
    f.root('b')
    f.db.transaction(() => {
      for (let i = 0; i < 100000; i++)
        f.event('a', 'message_sent', '{"to":"b"}', 0, graphCutoff - 86400000, i)
    })()
    const driver = join(f.directory, 'cancel-driver.ts')
    const enginePath = resolve('apps/desktop/src/main/db/team-profile-graph-engine.ts')
    writeFileSync(
      driver,
      `import {parentPort,workerData} from 'node:worker_threads';
import {TeamProfileGraphEngine} from ${JSON.stringify(enginePath)};
const flag=new Int32Array(workerData.flag);let notified=false;
const engine=new TeamProfileGraphEngine(workerData.file,workerData.executionFile,Date.now,()=>performance.now(),sql=>{if(!notified&&sql.includes('FROM events WHERE type')){notified=true;parentPort.postMessage({type:'native-page'});}});
const first=engine.read({operation:'snapshot'},workerData.context,()=>Atomics.load(flag,0)!==0);
Atomics.store(flag,0,0);const next=engine.read({operation:'snapshot'},workerData.context);
engine.close();parentPort.postMessage({type:'done',first,next});parentPort.close();`,
    )
    const bundle = await bundleAWorker(driver, f.directory, 'cancel-driver.cjs'),
      flag = new Int32Array(new SharedArrayBuffer(4))
    const worker = new NativeWorker(bundle, {
      workerData: {
        file: f.file,
        executionFile: f.executionFile,
        context: graphContext,
        flag: flag.buffer,
      },
    })
    let sawNativePage = false
    const exit = new Promise<void>((resolve, reject) => {
      worker.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker exit'))))
      worker.once('error', reject)
    })
    const result = await new Promise<{
      first: TeamProfileGraphResult
      next: TeamProfileGraphResult
    }>((resolve, reject) => {
      worker.on('message', (message) => {
        if (message.type === 'native-page') {
          sawNativePage = true
          Atomics.store(flag, 0, 1)
        } else if (message.type === 'done') resolve(message)
      })
      worker.once('error', reject)
    })
    expect(sawNativePage).toBe(true)
    expect(result.first).toMatchObject({
      type: 'unavailable',
      cause: 'cancelled',
      phase: 'messages',
    })
    if (result.first.type === 'unavailable') expect(result.first.visited).toBeGreaterThan(2)
    expect(result.next.type).toBe('snapshot')
    await exit
  } finally {
    f.close()
  }
})
