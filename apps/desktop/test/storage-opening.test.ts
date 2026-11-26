import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { IpcMain, IpcMainInvokeEvent, IpcRenderer } from 'electron'
import { expect, it, vi } from 'vitest'
import type { StorageRoots } from '../src/main/storage/engine'
import { registerStorageIpc } from '../src/main/storage/ipc'
import { StorageService, type StorageWorkerFactory } from '../src/main/storage/service'
import { storageBridge } from '../src/preload/storage'
import { bundleAWorker } from './helpers/bundle-a-worker'

function storageRoots(data: string): StorageRoots {
  return {
    data,
    workspace: join(data, 'workspace'),
    providers: join(data, 'providers'),
    output: join(data, 'output'),
    database: [join(data, 'database')],
    backups: [],
    plugins: join(data, 'plugins'),
    cache: join(data, 'cache'),
    resources: join(data, 'resources'),
  }
}

function storageClient(roots: StorageRoots, start: StorageWorkerFactory) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent) => unknown>()
  const ipc: Pick<IpcMain, 'handle' | 'removeHandler'> = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    },
    removeHandler: (channel) => {
      handlers.delete(channel)
    },
  }
  const event = { sender: new EventEmitter() } as unknown as IpcMainInvokeEvent
  const client: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'> = {
    invoke: async (channel: string) => handlers.get(channel)?.(event),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  const service = new StorageService(roots, start)
  const stop = registerStorageIpc(ipc, service, {
    reveal: () => {},
    clearCache: async () => {},
    pruneBackups: async () => 0,
    isAppWindow: () => true,
  })
  const bridge = storageBridge(client)
  return { bridge: bridge as typeof bridge & { freeSpace?(): Promise<number | null> }, stop }
}

it('delivers free space while the Storage worker is still measuring', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'fictional-storage-opening-'))
  const data = join(folder, 'data')
  const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => 0) })
  const start = vi.fn(() => worker)
  const { bridge, stop } = storageClient(storageRoots(data), start)
  try {
    await mkdir(data)
    let measured = false
    const measurement = bridge.measure().then((result) => {
      measured = true
      return result
    })
    expect(bridge.freeSpace).toBeTypeOf('function')
    const available = await bridge.freeSpace?.()
    expect(available).toBeGreaterThan(0)
    expect(measured).toBe(false)
    expect(start).toHaveBeenCalledTimes(1)
    worker.emit('message', { ok: true, value: { totalBytes: 23, freeBytes: available } })
    worker.emit('exit', 0)
    expect(await measurement).toMatchObject({ totalBytes: 23, freeBytes: available })

    await rm(data, { recursive: true })
    expect(await bridge.freeSpace?.()).toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
  } finally {
    stop()
    await rm(folder, { recursive: true, force: true })
  }
})

it('measures the same fictional roots with worker and opening timings', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'fictional-storage-scale-'))
  const data = join(folder, 'data')
  const base = storageRoots(data)
  const roots = { ...base, output: join(base.workspace, 'task-output') }
  const workers: Worker[] = []
  const bundle = await bundleAWorker('src/main/storage.worker.ts', folder, 'storage.cjs')
  const { bridge, stop } = storageClient(roots, (workerRoots, request) => {
    const worker = new Worker(bundle, { workerData: { roots: workerRoots, request } })
    workers.push(worker)
    return worker
  })
  try {
    for (let batch = 0; batch < 32; batch++) {
      const directory = join(roots.workspace, `branch-${batch}`)
      await mkdir(directory, { recursive: true })
      await Promise.all(
        Array.from({ length: 16 }, (_, index) => writeFile(join(directory, `item-${index}`), 'a')),
      )
    }
    await mkdir(roots.output)
    await writeFile(join(roots.output, 'result'), Buffer.alloc(23))
    await writeFile(roots.database[0]!, Buffer.alloc(29))
    await writeFile(join(data, 'unrelated'), Buffer.alloc(999))

    const start = performance.now()
    const complete = bridge.measure().then((value) => ({ value, time: performance.now() - start }))
    const free = bridge.freeSpace
      ? await bridge.freeSpace().then((value) => ({ value, time: performance.now() - start }))
      : await complete.then(({ value, time }) => ({ value: value.freeBytes, time }))
    const { value, time } = await complete
    console.info(
      `Storage ${process.platform}, 515 files, 33 subdirectories: free space ${free.time.toFixed(1)} ms, complete ${time.toFixed(1)} ms`,
    )
    expect(free.value).toBeGreaterThan(0)
    expect(value).toMatchObject({ totalBytes: 564, partial: false })
    expect(value.parts.find((part) => part.id === 'workspace')?.bytes).toBe(535)
    expect(value.parts.find((part) => part.id === 'agent-output')?.bytes).toBe(0)
    expect(value.parts.reduce((sum, part) => sum + (part.bytes ?? 0), 0)).toBe(564)
  } finally {
    stop()
    await Promise.all(workers.map((worker) => worker.terminate()))
    await rm(folder, { recursive: true, force: true })
  }
})
