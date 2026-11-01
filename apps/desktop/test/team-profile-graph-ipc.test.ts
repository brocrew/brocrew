import { expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { TeamProfileGraphWindows } from '../src/main/db/team-profile-graph-windows'
import { TeamProfileGraphLifetime } from '../src/main/db/team-profile-graph-reader'
import { graphUnavailable } from '../src/shared/team-profile-graph'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { createSessionStore } from '../src/main/db/session-store'
import { graphFixture } from './helpers/team-profile-graph-fixture'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { fictionalGraph } from './fixtures/team-profile-graph-view'

const sink = {
  ownerId: 'fictional-window',
  alive: true,
  aPersonIsBehindIt: true,
  send() {},
  sendLiveness() {},
}
function hostFor(
  f: ReturnType<typeof graphFixture>,
  graphs: TeamProfileGraphWindows,
  revision: () => string | null,
  extra: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {},
) {
  return new RuntimeHost({
    store: createSessionStore(f.db),
    teamProfileGraphs: graphs,
    teamProfileGraphRevision: revision,
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
    ...extra,
  })
}
it.each(['budget', 'worker', 'metadata'] as const)(
  'preserves a %s failure after its worker is drained',
  async (cause) => {
    const f = graphFixture(),
      read = vi.fn(async () => graphUnavailable(cause)),
      close = vi.fn(async () => {})
    const graphs = new TeamProfileGraphWindows(() => ({ read, close }), 'UTC')
    const host = hostFor(f, graphs, () => '0', { afterFirstWindowLoad: new Promise(() => {}) })
    try {
      expect(await host.teamProfileGraphForWindow({ operation: 'snapshot' }, sink)).toMatchObject({
        type: 'unavailable',
        cause,
        complete: false,
      })
      expect(read).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
    } finally {
      await host.closeAll()
      f.close()
    }
  },
)
it('rejects all caller context and accepts only the strict person-window graph request', async () => {
  const read = vi.fn(async () => graphUnavailable('worker')),
    host = { teamProfileGraphForWindow: read } as unknown as RuntimeHost
  for (const request of [
    { operation: 'snapshot', path: '/fictional' },
    { operation: 'snapshot', owner: 'other' },
    { operation: 'snapshot', sql: 'SELECT 1' },
    { operation: 'snapshot', session: 'other' },
    { operation: 'snapshot', timezone: 'UTC' },
    { operation: 'nodes', snapshot: 'a', size: 101 },
    { operation: 'edges', snapshot: 'a', size: 257 },
    { operation: 'release', workspace: 'other' },
  ])
    await expect(
      executeRuntimeCommand(host, sink, { kind: 'teamProfileGraph', request }),
    ).rejects.toThrow()
  expect(read).not.toHaveBeenCalled()
  await expect(
    executeRuntimeCommand(host, sink, {
      kind: 'teamProfileGraph',
      request: { operation: 'snapshot' },
    }),
  ).resolves.toMatchObject({ cause: 'worker' })
  expect(read).toHaveBeenCalledWith({ operation: 'snapshot' }, sink)
})
it('reads through the real graph worker with no main event fold and marks a concurrent revision stale without retry', async () => {
  const f = graphFixture()
  f.seed()
  const historical = Date.now() - 3600000
  f.db.prepare('UPDATE events SET created_at=?').run(historical)
  f.db.prepare('UPDATE work SET created_at=?').run(historical)
  const bundled = await bundleAWorker(
    'src/main/team-profile-graph.worker.ts',
    f.directory,
    'graph-ipc.cjs',
  )
  const mainReads: string[] = []
  const counted = new Proxy(f.db, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          const stmt = target.prepare(sql)
          return new Proxy(stmt, {
            get(native, method) {
              const operation: unknown = Reflect.get(native, method, native)
              if (typeof operation !== 'function') return operation
              return (...args: unknown[]) => {
                if (['all', 'get', 'iterate'].includes(String(method))) mainReads.push(sql)
                return Reflect.apply(operation, native, args)
              }
            },
          })
        }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const store = createSessionStore(counted),
    fold = vi.fn(() => {
      throw new Error('main event fold')
    })
  counted.prepare('SELECT COUNT(*) FROM events').get()
  expect(mainReads.some((s) => s === 'SELECT COUNT(*) FROM events')).toBe(true)
  let starts = 0,
    stamp = 0,
    releaseStartup!: () => void
  const graphs = new TeamProfileGraphWindows((admission, failure) => {
    starts++
    return new TeamProfileGraphLifetime(
      () => new Worker(bundled, { workerData: { file: f.file, executionFile: f.executionFile } }),
      () => performance.now(),
      undefined,
      admission,
      failure,
    )
  }, 'UTC')
  const host = hostFor(f, graphs, () => String(stamp++), {
    store: { ...store, events: fold },
    afterFirstWindowLoad: new Promise<void>((r) => {
      releaseStartup = r
    }),
  })
  mainReads.length = 0
  try {
    const result = await host.teamProfileGraphForWindow({ operation: 'snapshot' }, sink)
    expect(result).toMatchObject({ type: 'snapshot', nodeCount: 5, edgeCount: 3, stale: true })
    expect(starts).toBe(1)
    if (result.type !== 'snapshot') throw new Error('Missing graph')
    expect(
      await host.teamProfileGraphForWindow({ operation: 'nodes', snapshot: result.snapshot }, sink),
    ).toMatchObject({ type: 'nodes', nodes: expect.any(Array), stale: true })
    expect(
      await host.teamProfileGraphForWindow({ operation: 'edges', snapshot: result.snapshot }, sink),
    ).toMatchObject({ type: 'edges', edges: expect.any(Array), stale: true })
    expect(mainReads).toEqual([])
    expect(fold).not.toHaveBeenCalled()
    expect(starts).toBe(1)
    console.info(
      'TEAM_GRAPH_MAIN_READS',
      JSON.stringify({
        controlledMainStatements: mainReads.length,
        eventStatements: 0,
        positiveEventFoldObserved: true,
        starts,
      }),
    )
    await host.teamProfileGraphForWindow({ operation: 'release' }, sink)
  } finally {
    releaseStartup()
    await host.closeAll()
    f.close()
  }
})
it('refuses agent, dead, quit and unavailable-metadata reads while release still drains the owned worker', async () => {
  const f = graphFixture(),
    read = vi.fn(async () => fictionalGraph(1).header),
    close = vi.fn(async () => {}),
    graphs = new TeamProfileGraphWindows(() => ({ read, close }), 'UTC')
  let revision: string | null = '0'
  const host = hostFor(f, graphs, () => revision, { afterFirstWindowLoad: new Promise(() => {}) })
  try {
    expect(
      await host.teamProfileGraphForWindow(
        { operation: 'snapshot' },
        { ...sink, aPersonIsBehindIt: false },
      ),
    ).toMatchObject({ cause: 'closed' })
    expect(
      await host.teamProfileGraphForWindow({ operation: 'snapshot' }, { ...sink, alive: false }),
    ).toMatchObject({ cause: 'closed' })
    expect(read).not.toHaveBeenCalled()
    await host.teamProfileGraphForWindow({ operation: 'snapshot' }, sink)
    revision = null
    expect(await host.teamProfileGraphForWindow({ operation: 'snapshot' }, sink)).toMatchObject({
      cause: 'changed',
    })
    expect(await host.teamProfileGraphForWindow({ operation: 'release' }, sink)).toEqual({
      type: 'released',
    })
    expect(close).toHaveBeenCalledOnce()
    await host.closeAll()
    expect(await host.teamProfileGraphForWindow({ operation: 'snapshot' }, sink)).toMatchObject({
      cause: 'closed',
    })
  } finally {
    await host.closeAll()
    f.close()
  }
})
