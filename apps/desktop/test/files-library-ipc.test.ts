import { expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { FilesLibraryWindows } from '../src/main/db/files-library-windows'
import { FilesLibraryLifetime } from '../src/main/db/files-library-reader'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { filesLibraryFixture, workspaceQuery } from './helpers/files-library-fixture'
import {
  filesLibraryResult,
  libraryUnavailable,
  type FilesLibraryReader,
} from '../src/shared/files-library'
import { createSessionStore } from '../src/main/db/session-store'

const sink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send() {},
  sendLiveness() {},
}
it('validates library requests before dispatch and gives the renderer no database/SQL/giver authority', async () => {
  const read = vi.fn(async () => libraryUnavailable('worker'))
  const host = { filesLibraryForWindow: read } as unknown as RuntimeHost
  const request = { operation: 'query', query: workspaceQuery }
  for (const command of [
    { kind: 'filesLibrary', request, path: '/fictional' },
    { kind: 'filesLibrary', request: { ...request, size: 101 } },
    { kind: 'filesLibrary', request: { ...request, query: { ...workspaceQuery, givers: ['a'] } } },
    { kind: 'filesLibrary', request: { ...request, sql: 'SELECT 1' } },
  ])
    await expect(executeRuntimeCommand(host, sink, command)).rejects.toThrow()
  expect(read).not.toHaveBeenCalled()
  expect(await executeRuntimeCommand(host, sink, { kind: 'filesLibrary', request })).toMatchObject({
    cause: 'worker',
  })
  expect(read).toHaveBeenCalledWith(request, sink)
})

it('takes the command through a dedicated real worker with no main-thread legacy file/ledger fallback', async () => {
  const f = filesLibraryFixture()
  f.example()
  const bundled = await bundleAWorker(
    'src/main/files-library.worker.ts',
    f.directory,
    'library-ipc.cjs',
  )
  const forbidden = vi.fn(() => {
    throw new Error('main-thread file fold')
  })
  const mainReads: string[] = []
  const counted = new Proxy(f.db, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          const statement = target.prepare(sql)
          const traced: typeof statement = new Proxy(statement, {
            get(native, method) {
              const operation: unknown = Reflect.get(native, method, native)
              if (typeof operation !== 'function') return operation
              return (...args: unknown[]) => {
                if (method === 'all' || method === 'get' || method === 'iterate')
                  mainReads.push(sql)
                const answer: unknown = Reflect.apply(operation, native, args)
                return answer === native ? traced : answer
              }
            },
          })
          return traced
        }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const measuredStore = createSessionStore(counted)
  mainReads.length = 0
  counted.prepare('SELECT COUNT(*) FROM events').get()
  expect(mainReads).toEqual(['SELECT COUNT(*) FROM events'])
  const libraries = new FilesLibraryWindows(
    () => new FilesLibraryLifetime(() => new Worker(bundled, { workerData: { file: f.file } })),
  )
  let releaseStartup!: () => void
  // Measure the startup reconciler separately after the library requests finish.
  const afterFirstWindowLoad = new Promise<void>((resolve) => {
    releaseStartup = resolve
  })
  const host = new RuntimeHost({
    store: { ...measuredStore, filesKept: forbidden, filesKeptTogether: forbidden },
    filesLibraries: libraries,
    filesLibraryRevision: () => '0',
    afterFirstWindowLoad,
    discoverSessions: NO_DISCOVERY,
    createRuntime: () => new FakeRuntime('codex'),
    resolveCwd: () => f.directory,
    prepareProviderHome: () => f.directory,
    providerHomePath: () => f.directory,
    nativeTranscriptPath: () => null,
    exportDirectory: () => f.directory,
    newSessionId: () => 'fictional-new',
    readProviderConfig: () => ({
      home: f.directory,
      homeEnv: 'CODEX_HOME',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  })
  mainReads.length = 0
  try {
    const result = filesLibraryResult.parse(
      await executeRuntimeCommand(host, sink, {
        kind: 'filesLibrary',
        request: { operation: 'query', query: workspaceQuery, size: 1 },
      }),
    )
    expect(result).toMatchObject({ type: 'files', totalFiles: 16, totalKeeps: 22 })
    if (result.type !== 'files' || result.next === null) throw new Error('Missing first page')
    expect(
      await executeRuntimeCommand(host, sink, {
        kind: 'filesLibrary',
        request: { operation: 'page', cursor: result.next },
      }),
    ).toMatchObject({ type: 'files', totalFiles: 16 })
    expect(
      await executeRuntimeCommand(host, sink, {
        kind: 'filesLibrary',
        request: {
          operation: 'provenance',
          snapshot: result.snapshot,
          sha256: result.files[0]!.file.sha256,
        },
      }),
    ).toMatchObject({ type: 'provenance' })
    expect(
      await executeRuntimeCommand(host, sink, {
        kind: 'filesLibrary',
        request: { operation: 'tasks', query: '', parent: null },
      }),
    ).toMatchObject({ type: 'tasks', total: 4 })
    const on = await executeRuntimeCommand(host, sink, {
      kind: 'filesLibrary',
      request: {
        operation: 'query',
        query: {
          ...workspaceQuery,
          scope: { type: 'conversationWork', id: 'brobot', includeSubtasks: true },
        },
      },
    })
    expect(on).toMatchObject({ type: 'files', totalFiles: 11, totalKeeps: 15 })
    expect(forbidden).not.toHaveBeenCalled()
    const eventReads = mainReads.filter((sql) => /\bevents\b/iu.test(sql))
    expect(eventReads).toEqual([])
    console.info(
      'FILES_LIBRARY_MAIN_READS',
      JSON.stringify({
        operations: ['workspace', 'page', 'provenance', 'tasks', 'conversationWork'],
        mainStatements: mainReads.length,
        eventStatements: eventReads.length,
        positiveEventReadStatements: 1,
        legacyFolds: forbidden.mock.calls.length,
      }),
    )
    releaseStartup()
    await vi.waitFor(() =>
      expect(mainReads.filter((sql) => /\bevents\b/iu.test(sql)).length).toBeGreaterThan(0),
    )
    console.info(
      'FILES_LIBRARY_STARTUP_CONTROL',
      JSON.stringify({
        eventStatements: mainReads.filter((sql) => /\bevents\b/iu.test(sql)).length,
      }),
    )
    await host.closeFilesLibraryWindow(sink.ownerId)
  } finally {
    await host.closeAll()
    f.close()
  }
})

it.each(['cancelled', 'changed'] as const)(
  'never lets an older %s query retry across the latest window admission',
  async (cause) => {
    const f = filesLibraryFixture()
    let revision = '0'
    const pending: ((value: ReturnType<typeof libraryUnavailable>) => void)[] = []
    const read = vi.fn(
      () => new Promise<ReturnType<typeof libraryUnavailable>>((resolve) => pending.push(resolve)),
    )
    const libraries = new FilesLibraryWindows(() => ({ read, close: async () => {} }))
    const host = new RuntimeHost({
      store: f.store,
      filesLibraries: libraries,
      filesLibraryRevision: () => revision,
      discoverSessions: NO_DISCOVERY,
      createRuntime: () => new FakeRuntime('codex'),
      resolveCwd: () => f.directory,
      prepareProviderHome: () => f.directory,
      providerHomePath: () => f.directory,
      nativeTranscriptPath: () => null,
      exportDirectory: () => f.directory,
      newSessionId: () => 'fictional-new',
      readProviderConfig: () => ({
        home: f.directory,
        homeEnv: 'CODEX_HOME',
        model: 'fictional',
        authNote: null,
        files: [],
      }),
    })
    try {
      const first = host.filesLibraryForWindow(
        { operation: 'query', query: { ...workspaceQuery, query: 'old' } },
        sink,
      )
      revision = '1'
      const latest = host.filesLibraryForWindow(
        { operation: 'query', query: { ...workspaceQuery, query: 'latest' } },
        sink,
      )
      pending[0]!(libraryUnavailable(cause))
      expect(await first).toMatchObject({ cause: 'cancelled' })
      expect(read).toHaveBeenCalledTimes(2)
      pending[1]!(libraryUnavailable('worker'))
      expect(await latest).toMatchObject({ cause: 'worker' })
      expect(read).toHaveBeenCalledTimes(2)
    } finally {
      await host.closeAll()
      f.close()
    }
  },
)

it('owns isolated window lifetimes and disposes only the closed window', async () => {
  const owned: { reader: FilesLibraryReader; close: ReturnType<typeof vi.fn> }[] = []
  const windows = new FilesLibraryWindows(() => {
    const close = vi.fn(async () => {})
    const reader = { read: vi.fn(async () => libraryUnavailable('worker')), close }
    owned.push({ reader, close })
    return reader
  })
  const request = { operation: 'query' as const, query: workspaceQuery }
  await windows.read('a', request, '0')
  await windows.read('b', request, '0')
  expect(owned).toHaveLength(2)
  await windows.closeWindow('a')
  expect(owned[0]!.close).toHaveBeenCalledOnce()
  expect(owned[1]!.close).not.toHaveBeenCalled()
  await windows.read('b', request, '1')
  expect(owned).toHaveLength(2)
  await windows.close()
  expect(owned[1]!.close).toHaveBeenCalledOnce()
  expect(await windows.read('a', request, '2')).toMatchObject({ cause: 'closed' })
})

it("waits for a crashed renderer's owned worker exit before the same window can allocate another", async () => {
  let exit!: () => void
  let starts = 0
  const windows = new FilesLibraryWindows(() => {
    starts++
    return {
      read: async () => libraryUnavailable('worker'),
      close:
        starts === 1
          ? () =>
              new Promise<void>((resolve) => {
                exit = resolve
              })
          : async () => {},
    }
  })
  const request = { operation: 'query' as const, query: workspaceQuery }
  await windows.read('a', request, '0')
  const closed = windows.closeWindow('a')
  const replacement = windows.read('a', request, '1')
  await Promise.resolve()
  expect(starts).toBe(1)
  exit()
  await closed
  await replacement
  expect(starts).toBe(2)
  await windows.close()
})
