import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  StorageEngine,
  insideData,
  storageReason,
  type StorageRoots,
  type StorageRequest,
} from '../src/main/storage/engine'
import { StorageService } from '../src/main/storage/service'
import { clearHttpCache, httpCacheFolder } from '../src/main/storage/cache'
import { registerStorageIpc } from '../src/main/storage/ipc'
import { STORAGE_CHANNELS, isStorageLocation } from '../src/shared/storage'
import { storageBridge } from '../src/preload/storage'
import { bundleAWorker } from './helpers/bundle-a-worker'

let folder: string
let roots: StorageRoots
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'brocrew-fictional-storage-'))
  const data = join(folder, 'data')
  await mkdir(data)
  roots = {
    data,
    workspace: join(data, 'brobot-workspace'),
    providers: join(data, 'provider-homes'),
    output: join(data, 'worker-output'),
    database: [join(data, 'brobot2.sqlite'), join(data, 'brobot2.sqlite-wal')],
    backups: [join(data, 'backups'), join(data, 'recovery')],
    recovery: join(data, 'recovery'),
    plugins: join(data, 'plugins'),
    cache: join(data, 'Cache'),
    resources: join(data, 'resources'),
  }
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(folder, { recursive: true, force: true })
})
async function file(path: string, bytes: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.alloc(bytes, 65))
}

it('measures logical bytes from the host roots, including database sidecars and recovery, without counting unrelated files', async () => {
  await file(join(roots.workspace, 'nested', 'file'), 13)
  await file(roots.database[0]!, 21)
  await file(roots.database[1]!, 7)
  await file(join(roots.backups[0]!, 'copy'), 31)
  await file(join(roots.backups[1]!, 'preserved', 'copy'), 11)
  await file(join(roots.resources, 'asset'), 8)
  await file(join(roots.data, 'unrelated'), 999)
  const reading = await new StorageEngine(roots).measure()
  expect(reading.totalBytes).toBe(91)
  expect(reading.parts.find((part) => part.id === 'database')?.bytes).toBe(28)
  expect(reading.parts.find((part) => part.id === 'backups')?.bytes).toBe(42)
  expect(reading.freeBytes).toBeGreaterThan(0)
  expect(reading.measuredAt).toBeGreaterThan(0)
  expect(reading.partial).toBe(false)
})

it('returns the ten largest children and exact remainder, using recursive directory sizes', async () => {
  for (let n = 1; n <= 12; n++) await file(join(roots.workspace, `file-${n}`), n)
  await file(join(roots.workspace, 'nested', 'file'), 50)
  const reading = await new StorageEngine(roots).children({ part: 'workspace', segments: [] })
  expect(reading.entries).toHaveLength(10)
  expect(reading.entries[0]).toEqual({ name: 'nested', bytes: 50, isDirectory: true })
  expect(reading.entries.map((entry) => entry.bytes)).toEqual([50, 12, 11, 10, 9, 8, 7, 6, 5, 4])
  expect(reading.smallerCount).toBe(3)
  expect(reading.smallerBytes).toBe(6)
  expect(reading.totalBytes).toBe(128)
  expect(reading.partial).toBe(false)
  expect(
    (await new StorageEngine(roots).children({ part: 'workspace', segments: ['nested'] }))
      .totalBytes,
  ).toBe(50)
})

it('exposes only the known provider conversation branches', async () => {
  await file(
    join(roots.providers, 'default', 'agent', 'claude', 'projects', 'one', 'conversation.jsonl'),
    12,
  )
  await file(join(roots.providers, 'default', 'agent', 'codex', 'sessions', 'one.jsonl'), 14)
  await file(
    join(roots.providers, 'default', 'agent', 'codex', 'archived_sessions', 'two.jsonl'),
    16,
  )
  await file(join(roots.providers, 'default', 'agent', 'codex', 'unrelated-private-state'), 999)
  const reading = await new StorageEngine(roots).measure()
  expect(reading.parts.find((part) => part.id === 'provider-conversations')?.bytes).toBe(42)
  const listing = await new StorageEngine(roots).children({
    part: 'provider-conversations',
    segments: ['default', 'agent', 'codex'],
  })
  expect(listing.entries.map((entry) => entry.name).sort()).toEqual([
    'archived_sessions',
    'sessions',
  ])
  expect(
    (
      await new StorageEngine(roots).children({
        part: 'provider-conversations',
        segments: ['default', 'agent', 'codex', 'unrelated-private-state'],
      })
    ).error,
  ).toBe('invalid-location')
})

it('rejects traversal, absolute paths, Windows spellings and malformed locations before any path is used', async () => {
  for (const segment of [
    '..',
    '.',
    '/tmp',
    'C:\\temp',
    'a/b',
    'a\\b',
    'a\0b',
    'a:stream',
    'NUL',
    'a.',
  ]) {
    const location = { part: 'workspace' as const, segments: [segment] }
    expect(isStorageLocation(location)).toBe(false)
    expect((await new StorageEngine(roots).children(location)).error).toBe('invalid-location')
  }
  expect(isStorageLocation({ part: 'workspace', segments: [], path: roots.data })).toBe(false)
  expect(isStorageLocation({ part: 'other', segments: [] })).toBe(false)
  expect(isStorageLocation({ part: 'workspace', segments: Array(65).fill('x') })).toBe(false)
  expect(insideData(roots.data, `${roots.data}-sibling`)).toBe(false)
  const outside = { ...roots, resources: join(folder, 'installed-app') }
  await file(join(outside.resources, 'asset'), 100)
  const measurement = await new StorageEngine(outside).measure()
  expect(measurement.parts.find((part) => part.id === 'app-resources')).toMatchObject({
    partial: true,
    error: 'outside-data',
  })
  await expect(
    new StorageEngine(outside).reveal({ part: 'app-resources', segments: [] }),
  ).rejects.toMatchObject({ reason: 'outside-data' })
})

it('never follows directory or file links, including a linked root and an ancestor of a drill target', async () => {
  await file(join(folder, 'outside', 'large'), 999)
  await file(join(roots.workspace, 'safe'), 7)
  await symlink(
    join(folder, 'outside'),
    join(roots.workspace, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const listing = await new StorageEngine(roots).children({ part: 'workspace', segments: [] })
  expect(listing.entries).toEqual([
    { name: 'safe', bytes: 7, isDirectory: false },
    { name: 'escape', bytes: null, isDirectory: false, isLink: true },
  ])
  expect(listing.error).toBe('linked-path')
  expect(
    (await new StorageEngine(roots).children({ part: 'workspace', segments: ['escape'] })).error,
  ).toBe('linked-path')
  await expect(
    new StorageEngine(roots).reveal({ part: 'workspace', segments: ['escape', 'large'] }),
  ).rejects.toMatchObject({ reason: 'linked-path' })
  const linked = join(roots.data, 'linked-root')
  await symlink(roots.workspace, linked, process.platform === 'win32' ? 'junction' : 'dir')
  expect(
    (await new StorageEngine({ ...roots, output: linked }).measure()).parts.find(
      (part) => part.id === 'agent-output',
    )?.error,
  ).toBe('linked-path')
  if (process.platform !== 'win32') {
    await symlink(join(folder, 'outside', 'large'), join(roots.workspace, 'file-link'))
    expect(
      (await new StorageEngine(roots).children({ part: 'workspace', segments: [] })).entries,
    ).toContainEqual({ name: 'file-link', bytes: null, isDirectory: false, isLink: true })
    expect(
      (await new StorageEngine(roots).children({ part: 'workspace', segments: ['file-link'] }))
        .error,
    ).toBe('linked-path')
  }
})

it('includes the resolved external plugin root but never discovers or admits sibling backup folders', async () => {
  const plugins = join(folder, 'plugins')
  const backup = join(folder, 'desktop-backups-2026')
  const mapped = { ...roots, plugins }
  await file(join(plugins, 'installed', 'entry'), 17)
  await file(join(backup, 'copy'), 23)
  await file(join(roots.backups[0]!, 'copy'), 7)
  await file(join(folder, 'plugins-other', 'entry'), 999)
  const reading = await new StorageEngine(mapped).measure()
  expect(reading.parts.find((part) => part.id === 'plugins')?.bytes).toBe(17)
  expect(reading.parts.find((part) => part.id === 'backups')?.bytes).toBe(7)
  expect(reading.totalBytes).toBe(24)
  expect(reading.partial).toBe(false)
  expect(
    (await new StorageEngine(mapped).children({ part: 'plugins', segments: [] })).entries,
  ).toEqual([{ name: 'installed', bytes: 17, isDirectory: true }])
  await expect(
    new StorageEngine(mapped).reveal({ part: 'plugins', segments: ['installed'] }),
  ).resolves.toEqual({ path: await realpath(join(plugins, 'installed')) })
  expect(
    (await new StorageEngine(mapped).children({ part: 'backups', segments: [] })).entries.map(
      (entry) => entry.name,
    ),
  ).toEqual(['backups'])
  expect(
    (
      await new StorageEngine(mapped).children({
        part: 'backups',
        segments: ['desktop-backups-2026'],
      })
    ).error,
  ).toBe('invalid-location')
  await expect(
    new StorageEngine(mapped).reveal({
      part: 'backups',
      segments: ['desktop-backups-2026', 'copy'],
    }),
  ).rejects.toMatchObject({ reason: 'invalid-location' })
  const untrusted = { ...mapped, backups: [backup] }
  expect(
    (await new StorageEngine(untrusted).measure()).parts.find((part) => part.id === 'backups'),
  ).toMatchObject({ bytes: null, error: 'outside-data' })
  await expect(
    new StorageEngine(untrusted).reveal({ part: 'backups', segments: [] }),
  ).rejects.toMatchObject({ reason: 'outside-data' })
  expect(
    (
      await new StorageEngine(mapped).children({
        part: 'backups',
        segments: ['desktop-backups-unlisted'],
      })
    ).error,
  ).toBe('invalid-location')
  expect(
    (
      await new StorageEngine(mapped).children({
        part: 'plugins',
        segments: ['..', 'plugins-other'],
      })
    ).error,
  ).toBe('invalid-location')
})

it('shows links under an external root without following them, including links back into data', async () => {
  const plugins = join(folder, 'plugins')
  await file(join(plugins, 'safe'), 5)
  await file(join(roots.workspace, 'workspace-file'), 111)
  await symlink(
    roots.workspace,
    join(plugins, 'linked-workspace'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const mapped = { ...roots, plugins }
  const listing = await new StorageEngine(mapped).children({ part: 'plugins', segments: [] })
  expect(listing.entries).toEqual([
    { name: 'safe', bytes: 5, isDirectory: false },
    { name: 'linked-workspace', bytes: null, isDirectory: false, isLink: true },
  ])
  expect(listing.totalBytes).toBe(5)
  expect(
    (await new StorageEngine(mapped).measure()).parts.find((part) => part.id === 'plugins'),
  ).toMatchObject({ bytes: 5, partial: true, error: 'linked-path' })
  await expect(
    new StorageEngine(mapped).reveal({
      part: 'plugins',
      segments: ['linked-workspace', 'workspace-file'],
    }),
  ).rejects.toMatchObject({ reason: 'linked-path' })
})

it('keeps virtual backup roots with equal basenames addressable without exposing their parent', async () => {
  const first = join(roots.data, 'one', 'copies')
  const second = join(roots.data, 'two', 'copies')
  await file(join(first, 'entry'), 3)
  await file(join(second, 'entry'), 8)
  const mapped = { ...roots, backups: [first, second] }
  const listing = await new StorageEngine(mapped).children({ part: 'backups', segments: [] })
  expect(listing.entries.map((entry) => entry.name)).toEqual(['copies (2)', 'copies'])
  expect(
    (await new StorageEngine(mapped).children({ part: 'backups', segments: ['copies (2)'] }))
      .totalBytes,
  ).toBe(8)
  await expect(
    new StorageEngine(mapped).reveal({ part: 'backups', segments: ['copies (2)', 'entry'] }),
  ).resolves.toEqual({ path: await realpath(join(second, 'entry')) })
})

it('includes recovery under Backups only when that resolved folder has content', async () => {
  await mkdir(roots.backups[0]!)
  await mkdir(roots.recovery!)
  expect(
    (await new StorageEngine(roots).children({ part: 'backups', segments: [] })).entries,
  ).toEqual([{ name: 'backups', bytes: 0, isDirectory: true }])
  const zeroByteChild = join(roots.recovery!, 'zero-byte-child')
  await file(zeroByteChild, 0)
  expect(
    (await new StorageEngine(roots).children({ part: 'backups', segments: [] })).entries,
  ).toContainEqual({ name: 'recovery', bytes: 0, isDirectory: true })
  await rm(zeroByteChild)
  await file(join(roots.recovery!, 'preserved', 'copy'), 9)
  const listing = await new StorageEngine(roots).children({ part: 'backups', segments: [] })
  expect(listing.entries).toEqual([
    { name: 'recovery', bytes: 9, isDirectory: true },
    { name: 'backups', bytes: 0, isDirectory: true },
  ])
  expect(listing.totalBytes).toBe(9)
  await rm(roots.backups[0]!, { recursive: true })
  await expect(new StorageEngine(roots).reveal({ part: 'backups', segments: [] })).resolves.toEqual(
    { path: await realpath(roots.recovery!) },
  )
  await rm(join(roots.recovery!, 'preserved'), { recursive: true })
  await expect(
    new StorageEngine(roots).reveal({ part: 'backups', segments: [] }),
  ).rejects.toMatchObject({ reason: 'unavailable' })
})

it('lists grouped database and backup roots without exposing the rest of the data folder', async () => {
  await file(roots.database[0]!, 20)
  await file(join(roots.backups[0]!, 'copy'), 30)
  const listing = await new StorageEngine(roots).children({ part: 'database', segments: [] })
  expect(listing.entries).toEqual([{ name: 'brobot2.sqlite', bytes: 20, isDirectory: false }])
  const backups = await new StorageEngine(roots).children({ part: 'backups', segments: [] })
  expect(backups.entries[0]).toEqual({ name: 'backups', bytes: 30, isDirectory: true })
  expect(
    (await new StorageEngine(roots).children({ part: 'database', segments: ['resources'] })).error,
  ).toBe('invalid-location')
  await expect(new StorageEngine(roots).reveal()).resolves.toEqual({
    path: await realpath(roots.data),
  })
  await expect(
    new StorageEngine(roots).reveal({ part: 'database', segments: [] }),
  ).resolves.toEqual({ path: await realpath(roots.database[0]!) })
  await expect(new StorageEngine(roots).reveal({ part: 'backups', segments: [] })).resolves.toEqual(
    { path: await realpath(roots.backups[0]!) },
  )
})

it('root reveal selects the first existing database-family file or backup folder and refuses an absent family', async () => {
  for (const part of ['database', 'backups'] as const) {
    await expect(new StorageEngine(roots).reveal({ part, segments: [] })).rejects.toMatchObject({
      reason: 'unavailable',
    })
  }
  await file(roots.database[1]!, 5)
  await file(join(roots.backups[1]!, 'copy'), 7)
  await expect(
    new StorageEngine(roots).reveal({ part: 'database', segments: [] }),
  ).resolves.toEqual({ path: await realpath(roots.database[1]!) })
  await expect(new StorageEngine(roots).reveal({ part: 'backups', segments: [] })).resolves.toEqual(
    { path: await realpath(roots.backups[1]!) },
  )
  await symlink(
    roots.backups[1]!,
    roots.backups[0]!,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await expect(
    new StorageEngine(roots).reveal({ part: 'backups', segments: [] }),
  ).rejects.toMatchObject({ reason: 'linked-path' })
})

it('reports finite traversal limits and cancellation, including a depth limit', async () => {
  await file(join(roots.workspace, 'one', 'two', 'file'), 3)
  const limited = await new StorageEngine(roots, {
    entries: 2,
    depth: 64,
    milliseconds: 10_000,
  }).measure()
  expect(limited.partial).toBe(true)
  expect(limited.parts.some((part) => part.error === 'limit')).toBe(true)
  expect(
    (await new StorageEngine(roots, undefined, () => true).measure()).parts.some(
      (part) => part.error === 'cancelled',
    ),
  ).toBe(true)
  expect(
    (
      await new StorageEngine(roots, { entries: 100, depth: 1, milliseconds: 10_000 }).measure()
    ).parts.find((part) => part.id === 'workspace')?.error,
  ).toBe('limit')
})

class FakeWorker extends EventEmitter {
  terminate = vi.fn(async () => 0)
}

it('retains its two worker permits until confirmed exit after abort, failure and timeout', async () => {
  vi.useFakeTimers()
  const workers: FakeWorker[] = []
  const service = new StorageService(
    roots,
    () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    100,
  )
  const cancel = new AbortController()
  const first = service.run({ kind: 'measure' }, cancel.signal)
  const second = service.run({ kind: 'measure' })
  cancel.abort()
  expect(await first).toEqual({ ok: false, error: 'cancelled' })
  expect(await service.run({ kind: 'measure' })).toEqual({ ok: false, error: 'busy' })
  await vi.advanceTimersByTimeAsync(100)
  expect(await second).toEqual({ ok: false, error: 'limit' })
  expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
  expect(await service.run({ kind: 'measure' })).toEqual({ ok: false, error: 'busy' })
  workers[0]!.emit('exit', 0)
  const third = service.run({ kind: 'measure' })
  workers[2]!.emit('error', new Error('fictional failure'))
  expect(await third).toEqual({ ok: false, error: 'unavailable' })
  service.close()
  expect(await service.run({ kind: 'measure' })).toEqual({ ok: false, error: 'cancelled' })
})

it('runs the actual production filesystem worker while its caller remains schedulable', async () => {
  for (let n = 0; n < 120; n++) await file(join(roots.workspace, `directory-${n}`, 'file'), 10)
  const bundle = await bundleAWorker('src/main/storage.worker.ts', folder, 'storage.cjs')
  const workers: Worker[] = []
  const service = new StorageService(roots, (workerRoots, request) => {
    const worker = new Worker(bundle, { workerData: { roots: workerRoots, request } })
    workers.push(worker)
    return worker
  })
  let beats = 0
  const heartbeat = setInterval(() => beats++, 1)
  try {
    const result = await service.run({ kind: 'measure' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ totalBytes: 1200, partial: false })
    expect(beats).toBeGreaterThan(0)
  } finally {
    clearInterval(heartbeat)
    service.close()
    await Promise.all(workers.map((worker) => worker.terminate()))
  }
})

function harness() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc = {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    },
  } as Pick<IpcMain, 'handle' | 'removeHandler'>
  const sender = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
  }) as unknown as WebContents
  const event = { sender } as IpcMainInvokeEvent
  return {
    ipc,
    sender,
    event,
    invoke: (channel: string, ...args: unknown[]) =>
      Promise.resolve(handlers.get(channel)!(event, ...args)),
  }
}

it('cache clear uses only the narrow cache API and preserves unrelated state in fake data', async () => {
  const cacheFile = join(roots.cache!, 'http')
  const kept = [
    join(roots.workspace, 'file'),
    roots.database[0]!,
    join(roots.backups[0]!, 'copy'),
    join(roots.plugins!, 'plugin'),
    join(roots.data, 'Cookies'),
  ]
  for (const path of [cacheFile, ...kept]) await file(path, 3)
  const h = harness()
  const run = vi.fn(async () => ({
    ok: true as const,
    value: await new StorageEngine(roots).reveal({ part: 'cache', segments: [] }),
  }))
  const service = { run, close: vi.fn() } as unknown as StorageService
  const clear = vi.fn(async () => {
    await rm(cacheFile)
  })
  const reveal = vi.fn()
  const stop = registerStorageIpc(h.ipc, service, {
    clearCache: () => clearHttpCache(service, clear),
    reveal,
    isAppWindow: () => true,
  })
  expect(await h.invoke(STORAGE_CHANNELS.clearCache)).toEqual({ ok: true })
  expect(clear).toHaveBeenCalledExactlyOnceWith()
  expect(run).toHaveBeenCalledExactlyOnceWith({
    kind: 'reveal',
    location: { part: 'cache', segments: [] },
  })
  expect(reveal).not.toHaveBeenCalled()
  for (const path of kept) expect(await readFile(path, 'utf8')).toBe('AAA')
  stop()
})

it('derives cache from actual session storage and supports contained browse and reveal', async () => {
  expect(httpCacheFolder(null)).toBeNull()
  const cache = httpCacheFolder(join(roots.data, 'session'))!
  expect(cache).toBe(join(roots.data, 'session', 'Cache'))
  const mapped = { ...roots, cache }
  await file(join(cache, 'Cache_Data', 'entry'), 24)
  await file(join(roots.data, 'session', 'Cookies'), 90)
  const engine = new StorageEngine(mapped)
  expect((await engine.measure()).parts.find((part) => part.id === 'cache')?.bytes).toBe(24)
  expect(
    (await new StorageEngine(mapped).children({ part: 'cache', segments: [] })).entries,
  ).toEqual([{ name: 'Cache_Data', bytes: 24, isDirectory: true }])
  await expect(new StorageEngine(mapped).reveal({ part: 'cache', segments: [] })).resolves.toEqual({
    path: await realpath(cache),
  })
})

it('refuses native cache clear when its mapped root is linked or outside the data folder', async () => {
  const outside = join(folder, 'outside-session')
  await file(join(outside, 'Cache', 'entry'), 10)
  await symlink(
    outside,
    join(roots.data, 'linked-session'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const h = harness()
  for (const [session, reason] of [
    [outside, 'outside-data'],
    [join(roots.data, 'linked-session'), 'linked-path'],
  ] as const) {
    const mapped = { ...roots, cache: httpCacheFolder(session) }
    const service = {
      run: vi.fn(async () => {
        try {
          return {
            ok: true as const,
            value: await new StorageEngine(mapped).reveal({ part: 'cache', segments: [] }),
          }
        } catch (error) {
          return { ok: false as const, error: storageReason(error) }
        }
      }),
      close: vi.fn(),
    } as unknown as StorageService
    const clear = vi.fn(async () => {})
    const stop = registerStorageIpc(h.ipc, service, {
      clearCache: () => clearHttpCache(service, clear),
      reveal: () => {},
      isAppWindow: () => true,
    })
    expect(await h.invoke(STORAGE_CHANNELS.clearCache)).toEqual({ ok: false, error: reason })
    expect(clear).not.toHaveBeenCalled()
    stop()
  }
  expect(await readFile(join(outside, 'Cache', 'entry'), 'utf8')).toBe('AAAAAAAAAA')
})

it('rejects foreign senders and malformed IPC; cancels reads on navigation and removes handlers on stop', async () => {
  const h = harness()
  const service = {
    run: vi.fn(async (_request: StorageRequest, signal?: AbortSignal) => {
      return await new Promise<{ ok: false; error: 'cancelled' }>((resolve) =>
        signal?.addEventListener('abort', () => resolve({ ok: false, error: 'cancelled' })),
      )
    }),
    close: vi.fn(),
  } as unknown as StorageService
  const clear = vi.fn(async () => {})
  let permitted = false
  const stop = registerStorageIpc(h.ipc, service, {
    clearCache: clear,
    reveal: () => {},
    isAppWindow: () => permitted,
  })
  expect(await h.invoke(STORAGE_CHANNELS.clearCache)).toEqual({ ok: false, error: 'unavailable' })
  expect(clear).not.toHaveBeenCalled()
  expect(
    await h.invoke(STORAGE_CHANNELS.children, { part: 'workspace', segments: ['..'] }),
  ).toMatchObject({ error: 'invalid-location' })
  expect(service.run).not.toHaveBeenCalled()
  permitted = true
  const pending = h.invoke(STORAGE_CHANNELS.children, { part: 'workspace', segments: [] })
  h.sender.emit('did-start-navigation')
  expect(await pending).toMatchObject({ error: 'cancelled' })
  stop()
  expect(service.close).toHaveBeenCalledOnce()
  expect(h.sender.listenerCount('did-start-navigation')).toBe(0)
})

it('the preload forwards only the declared Storage methods and typed locations', async () => {
  const invoke = vi.fn(async () => ({ ok: true }))
  const bridge = storageBridge({ invoke })
  const location = { part: 'workspace' as const, segments: ['one'] }
  await bridge.measure()
  await bridge.children(location)
  await bridge.reveal(location)
  await bridge.clearCache()
  expect(Object.isFrozen(bridge)).toBe(true)
  expect(invoke.mock.calls).toEqual([
    [STORAGE_CHANNELS.measure],
    [STORAGE_CHANNELS.children, location],
    [STORAGE_CHANNELS.reveal, location],
    [STORAGE_CHANNELS.clearCache],
  ])
})
