import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginEffectQueue } from '../src/main/plugins/lifecycle/effect-queue'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import type {
  LifecycleRuntime,
  LifecycleWorkspace,
  WorkspaceProjection,
} from '../src/main/plugins/lifecycle/types'
import type {
  ManagedPluginRoute,
  openManagedPluginRoute,
} from '../src/main/plugins/managed-transport'
import type { createPluginNodeHost, PluginNodeProcess } from '../src/main/plugins/node-host'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import {
  pluginWorkspaceIdentity,
  PluginWorkspaceLease,
} from '../src/main/plugins/supervisor/client'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
} from './plugin-lifecycle-fixtures'
import { fictionalPublicKey, signed, tar } from './plugin-package-fixtures'

const routeFactory = vi.hoisted(() => ({
  observe: undefined as
    | undefined
    | ((
        route: ManagedPluginRoute,
        input: Parameters<typeof openManagedPluginRoute>,
      ) => Promise<ManagedPluginRoute>),
}))
vi.mock('../src/main/plugins/managed-transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/plugins/managed-transport')>()
  return {
    ...real,
    async openManagedPluginRoute(...input: Parameters<typeof real.openManagedPluginRoute>) {
      const route = await real.openManagedPluginRoute(...input)
      return routeFactory.observe ? routeFactory.observe(route, input) : route
    },
  }
})

const A = 'fictional-dahlia'
const B = 'fictional-lilac'
const tool = 'gather_petals'
const releases: Array<() => void> = []
const closers: Array<() => Promise<unknown>> = []
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))
// This bounds a hung test fixture; it does not set a product timeout.
async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Joint close timed out: ${label}`)), 4000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

afterEach(async () => {
  const errors: unknown[] = []
  for (const release of releases.splice(0)) {
    try {
      release()
    } catch (error) {
      errors.push(error)
    }
  }
  for (const close of closers.splice(0).reverse()) {
    try {
      await bounded(Promise.resolve().then(close), 'owned fixture close')
    } catch (error) {
      errors.push(error)
    }
  }
  routeFactory.observe = undefined
  vi.restoreAllMocks()
  try {
    await cleanupLifecycleFixtures()
  } catch (error) {
    errors.push(error)
  }
  if (errors.length) throw new AggregateError(errors, 'Joint close fixture cleanup failed')
})

function genericPackage(id: string) {
  const target = {
    os: process.platform as 'darwin' | 'linux' | 'win32',
    cpu: process.arch as 'arm64' | 'x64',
  }
  const tools = [{ name: tool, inputSchema: { type: 'object' as const } }]
  const files = new Map([
    ['main.cjs', Buffer.from('// Fictional controlled child; SDK peer supplies MCP.')],
    ['tools.json', Buffer.from(JSON.stringify({ tools }))],
  ])
  const manifest = {
    format: 3,
    id,
    name: id,
    version: '1.0.0',
    description: 'Gather fictional petals.',
    authors: ['Fictional Gardeners'],
    platforms: [target],
    permissions: { description: 'Gather fictional petals.' },
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    runtime: { kind: 'node', entry: 'main.cjs' },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    lifecycle: { stop: { signal: 'SIGTERM' }, dataOnRemove: 'keep' },
    data: { schema: 1 },
  }
  const archive = tar([
    { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  return {
    archive,
    tools,
    release: {
      id,
      version: '1.0.0',
      sourceCommit: 'f'.repeat(40),
      platforms: [target],
      archive: {
        url: `https://plugins.example.invalid/${id}.tar`,
        size: archive.length,
        sha256: pluginSha256(archive),
        compression: 'tar',
      },
      manifestSha256: pluginSha256(Buffer.from(JSON.stringify(manifest))),
    },
  }
}

async function accepted(
  controller: PluginLifecycleController,
  handle: LifecycleWorkspace,
  workspaceId: string,
  installId: string,
) {
  const ready = deferred<void>()
  const check = () => {
    if (controller.admitted(handle, A, installId)) ready.resolve()
  }
  const stop = controller.onHostChanged((changed) => {
    if (changed === workspaceId) check()
  })
  closers.push(async () => stop())
  try {
    check()
    await bounded(ready.promise, 'actual accepted A receipt')
  } finally {
    stop()
  }
}
async function connectRoute(route: ManagedPluginRoute, name: string) {
  const client = new Client({ name, version: '1' })
  client.onerror = () => undefined
  closers.push(() => client.close())
  await bounded(
    client.connect(
      new StreamableHTTPClientTransport(new URL(route.server.url), {
        requestInit: { headers: { Authorization: `Bearer ${route.server.capability}` } },
      }),
    ),
    'actual SDK HTTP connection',
  )
  return client
}

it.each(['service first', 'last lease first'] as const)(
  'real supervisor close preserves physical and consumer boundaries with %s',
  async (order) => {
    const packages = new Map([
      [A, genericPackage(A)],
      [B, genericPackage(B)],
    ])
    const provider = await pluginProviderFixture({ createBroker: false })
    provider.setTools(packages.get(A)!.tools)
    closers.push(() => provider.close())
    const control = await pluginProviderFixture()
    closers.push(() => control.close())

    // Seeding uses inert runs and real signed packages, never an installed app or OS child.
    const seedRuntime: LifecycleRuntime = {
      previousOwnerClean: async () => true,
      removeCode: async () => {},
      async start() {
        const exited = deferred<void>()
        return {
          runId: randomUUID(),
          exited: exited.promise,
          stop: async () => exited.resolve(),
          ready: async () => ({
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            client: provider.client,
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
          }),
        }
      },
    }
    const download = vi.fn(async (release: { id: string }) => packages.get(release.id)!.archive)
    const f = await fixture(
      {
        catalogue: signed({ format: 1, entries: [...packages.values()].map((one) => one.release) }),
        download,
        runtime: seedRuntime,
      },
      false,
      A,
    )
    await f.controller.install(f.handle, A)
    await f.controller.install(f.handle, B)
    // Only the seed controller drains here. The subject opens the same stored packages
    // with a separate controller and queue, and marks consumers ended inside service.close.
    f.controller.consumersEnded()
    await f.controller.drain()
    const install = f.state.currentInstallation(A)!
    const workspaceId = pluginWorkspaceIdentity(f.workspace)
    const startEntered = deferred<void>(),
      startHold = deferred<void>()
    releases.push(() => startHold.resolve())
    const children = new Map(
      [A, B].map((id) => {
        const exit = deferred<{ exited: boolean }>()
        const stopped = deferred<void>()
        releases.push(() => exit.resolve({ exited: true }))
        // Stop completion alone is deliberately not the physical exit proof.
        const child: PluginNodeProcess = {
          runId: randomUUID(),
          receiptPath: join(f.root, 'fictional-unused-exit-' + id),
          exited: exit.promise,
          stop: vi.fn(async () => {
            stopped.resolve()
            return { exited: true }
          }),
          ready: async () => ({
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            client: provider.client,
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
          }),
        }
        return [id, { child, exit, stopped }] as const
      }),
    )
    const host = {
      start: vi.fn(
        async (input: Parameters<ReturnType<typeof createPluginNodeHost>['start']>[0]) => {
          if (input.package.manifest.id === B) {
            startEntered.resolve()
            await startHold.promise
          }
          return children.get(input.package.manifest.id)!.child
        },
      ),
      removePackage: vi.fn(async () => {}),
      removeData: vi.fn(async () => {}),
    }
    const ownerOptions = {
      root: f.root,
      workspaceRoots: [f.workspace],
      tickEvery: 60_000,
      drainWithin: 8000,
    }
    const owner = await PluginSupervisor.start(ownerOptions)
    closers.push(async () => {
      expect(await owner.shutdown()).toBe(true)
      await owner.closed
    })
    const lease = await PluginWorkspaceLease.attach({
      root: f.root,
      workspaceRoot: f.workspace,
      generation: randomUUID(),
      build: 'fictional-joint-close',
    })
    closers.push(async () => lease.abandon())
    let effectQueue: PluginEffectQueue | undefined
    const bindEffects = owner.bindLifecycleEffects
    vi.spyOn(owner, 'bindLifecycleEffects').mockImplementation(function (
      this: PluginSupervisor,
      queue,
    ) {
      if (queue instanceof PluginEffectQueue) effectQueue = queue
      bindEffects.call(this, queue)
    })
    const service = await createSupervisorLifecycle({
      owner,
      host: host as unknown as ReturnType<typeof createPluginNodeHost>,
      lifecycle: f.opts,
      personKey: 'a'.repeat(64),
    })
    closers.push(() => service.close())
    expect(effectQueue).toBeInstanceOf(PluginEffectQueue)

    const attachOriginal = PluginLifecycleController.prototype.attach
    const attached = vi.spyOn(PluginLifecycleController.prototype, 'attach')
    const handles: LifecycleWorkspace[] = []
    attached.mockImplementation(function (this: PluginLifecycleController, sink, shared) {
      return attachOriginal.call(this, sink, shared).then((handle) => {
        handles.push(handle)
        return handle
      })
    })
    async function person(sink: WorkspaceProjection) {
      let lost = false
      const client = await connectPluginSettings({
        path: service.path,
        personKey: 'a'.repeat(64),
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        download: f.opts.download,
        projection: sink,
        lost: () => {
          lost = true
        },
      })
      closers.push(async () => {
        if (lost) await expect(client.close()).rejects.toMatchObject({ code: 'unavailable' })
        else await client.close()
      })
      return client
    }
    const healthy = await person({ ...projection().sink, workspaceId })
    const healthyHandle = handles[0]!
    await bounded(startEntered.promise, 'B host.start after actual owner reservation')
    await accepted(service.controller, healthyHandle, workspaceId, install.installId)
    expect(
      service.controller.agentScope(workspaceId).entries.find((one) => one.pluginId === A),
    ).toMatchObject({
      is: 'admitted',
      installId: install.installId,
      runId: children.get(A)!.child.runId,
    })
    const positiveEntered = deferred<void>(),
      positiveHold = deferred<void>(),
      positiveReturned = deferred<void>()
    releases.push(() => positiveHold.resolve())
    const pendingPerson = projection()
    const applied = vi.fn(
      async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
        await pendingPerson.sink.applied(id, receipt)
        if (id === A && receipt) {
          positiveEntered.resolve()
          await positiveHold.promise
          positiveReturned.resolve()
        }
      },
    )
    const stalled = await person({ ...pendingPerson.sink, workspaceId, applied })
    await bounded(positiveEntered.promise, 'additional person actual positive callback')
    const personHandle = handles[1]!
    expect(service.controller.admitted(personHandle, A, install.installId)).toBe(false)
    expect(service.controller.admitted(healthyHandle, A, install.installId)).toBe(true)

    const routeEntered = deferred<void>(),
      routeHold = deferred<void>(),
      routeClosed = deferred<void>()
    releases.push(() => routeHold.resolve())
    let heldRoute: ManagedPluginRoute | undefined
    let routeCurrent: (() => boolean) | undefined
    const ownedRouteCloses = vi.fn()
    const controlRouteCloses = vi.fn()
    routeFactory.observe = async (route, input) => {
      const [broker, scope, current] = input
      const isOwned =
        broker.binding.pluginId === A &&
        scope.workspaceId === workspaceId &&
        broker.binding.instanceId === children.get(A)!.child.runId
      const wrapped: ManagedPluginRoute = {
        server: route.server,
        async close() {
          if (isOwned) ownedRouteCloses()
          else controlRouteCloses()
          await route.close()
          if (isOwned) routeClosed.resolve()
        },
      }
      if (isOwned) {
        heldRoute = wrapped
        routeCurrent = current
        routeEntered.resolve()
        await routeHold.promise
      }
      return wrapped
    }
    const controlRoute = await control.route(randomUUID())
    const outside = await connectRoute(controlRoute, 'fictional-outside-authority')
    await expect(outside.listTools()).resolves.toMatchObject({ tools: [{ name: 'echo' }] })
    const routeRequest = { workspaceId, incarnation: randomUUID(), occupied: ['brobot'] }
    const reading = lease.agentRoutes(routeRequest).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await bounded(routeEntered.promise, 'actual owned HTTP route open before held return')
    expect(handles).toHaveLength(3)
    const agentHandle = handles[2]!
    expect(routeCurrent!()).toBe(true)
    const inside = await connectRoute(heldRoute!, 'fictional-pre-close-control')
    const inventory = await inside.listTools()
    expect(inventory.tools).toMatchObject([{ name: tool }])
    await expect(
      inside.callTool({ name: inventory.tools[0]!.name, arguments: { basket: 'before-close' } }),
    ).resolves.toHaveProperty('content')
    expect(provider.seen).toContainEqual(
      expect.objectContaining({ arguments: { basket: 'before-close' } }),
    )

    const statePath = join(f.root, 'state', 'installed-state.json')
    const effectPaths = (await readdir(join(f.root, 'lifecycle-effects')))
      .sort()
      .map((name) => join(f.root, 'lifecycle-effects', name))
    const dataPath = join(f.root, 'host', 'data', A, 'sentinel')
    await mkdir(join(dataPath, '..'), { recursive: true })
    await writeFile(dataPath, 'Fictional retained login; not an installed account')
    const effectEntered = deferred<void>(),
      effectHold = deferred<void>()
    releases.push(() => effectHold.resolve())
    const stagePath = join(f.root, 'fictional-tracked-stage.keep')
    // This is the actual queue owned by the supervisor, with an independent staging reply gate.
    const staging = effectQueue!.stage(async () => {
      await writeFile(stagePath, 'Fictional content staged before close')
      effectEntered.resolve()
      await effectHold.promise
    })
    closers.push(() => staging)
    await bounded(effectEntered.promise, 'actual tracked staging write before close')
    const paths = [statePath, dataPath, stagePath, ...effectPaths]
    const before = await Promise.all(paths.map((path) => readFile(path)))
    const writes = vi.spyOn(f.state, 'recordProjection')
    const callbacks = applied.mock.calls.length
    const downloads = download.mock.calls.length
    const starts = host.start.mock.calls.length
    const markEntered = deferred<void>()
    const markOriginal = PluginLifecycleController.prototype.consumersEnded
    vi.spyOn(PluginLifecycleController.prototype, 'consumersEnded').mockImplementation(function (
      this: PluginLifecycleController,
    ) {
      markOriginal.call(this)
      markEntered.resolve()
    })
    const detachEntered = deferred<{ before: boolean; after: boolean }>()
    const detachOriginal = PluginLifecycleController.prototype.detach
    vi.spyOn(PluginLifecycleController.prototype, 'detach').mockImplementation(function (
      this: PluginLifecycleController,
      handle,
    ) {
      const wasClean = this.cleanForShutdown()
      return detachOriginal.call(this, handle).then(() => {
        if (handle === agentHandle)
          detachEntered.resolve({ before: wasClean, after: this.cleanForShutdown() })
      })
    })
    let serviceFinished = false,
      ownerFinished = false
    let closing: Promise<unknown>
    if (order === 'service first') {
      closing = service.close()
      expect(routeCurrent!()).toBe(false)
    } else closing = lease.close()
    void closing.then(() => {
      if (order === 'service first') serviceFinished = true
    })
    await bounded(markEntered.promise, 'owner-side lifecycle close mark after IPC release')
    expect(routeCurrent!()).toBe(false)
    const denied = await fetch(heldRoute!.server.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${heldRoute!.server.capability}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(2000),
    })
    expect(denied.status).toBe(401)
    await denied.body?.cancel()
    expect(ownedRouteCloses).not.toHaveBeenCalled()
    await expect(healthy.catalogue()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(stalled.catalogue()).rejects.toMatchObject({ code: 'unavailable' })
    expect(service.controller.cleanForShutdown()).toBe(false)
    let physicalClose: Promise<boolean> | undefined
    if (order === 'last lease first') {
      physicalClose = closing as Promise<boolean>
      void physicalClose.then(() => {
        ownerFinished = true
      })
      expect(
        await bounded(detachEntered.promise, 'original agent detach before physical proof'),
      ).toEqual({ before: false, after: false })
    }
    startHold.resolve()
    await bounded(
      Promise.all([...children.values()].map((one) => one.stopped.promise)),
      'captured children stop replies',
    )
    const draining = service.controller.drain()
    let controllerFinished = false
    void draining.then(() => {
      controllerFinished = true
    })
    if (order === 'last lease first') {
      effectHold.resolve()
      await bounded(staging, 'tracked staging settled while both child exits remain held')
      expect(effectQueue!.idle).toBe(true)
    }
    await turn()
    expect(controllerFinished).toBe(false)
    expect(service.controller.cleanForShutdown()).toBe(false)
    if (order === 'last lease first') expect(ownerFinished).toBe(false)
    await expect(PluginSupervisor.start(ownerOptions)).rejects.toMatchObject({ code: 'busy' })
    children.get(A)!.exit.resolve({ exited: true })
    await turn()
    expect(controllerFinished).toBe(false)
    expect(service.controller.cleanForShutdown()).toBe(false)
    if (order === 'last lease first') expect(ownerFinished).toBe(false)
    await expect(PluginSupervisor.start(ownerOptions)).rejects.toMatchObject({ code: 'busy' })
    children.get(B)!.exit.resolve({ exited: true })
    if (order === 'service first') {
      await turn()
      expect(controllerFinished).toBe(false)
      expect(service.controller.cleanForShutdown()).toBe(false)
      expect(effectQueue!.idle).toBe(false)
      // This owner is still serving; its busy result is standing-owner exclusion.
      await expect(PluginSupervisor.start(ownerOptions)).rejects.toMatchObject({ code: 'busy' })
      effectHold.resolve()
      await bounded(staging, 'tracked staging reply settled after actual child exits')
    }
    await bounded(draining, 'actual modeled exits and tracked-effect settlement')
    expect(service.controller.cleanForShutdown()).toBe(true)
    if (order === 'service first') {
      expect(serviceFinished).toBe(false)
      expect(ownedRouteCloses).not.toHaveBeenCalled()
      physicalClose = owner.shutdown()
      void physicalClose.then(() => {
        ownerFinished = true
      })
      expect(
        await bounded(detachEntered.promise, 'original late agent detach after retirement'),
      ).toEqual({ before: true, after: true })
    }
    expect(await bounded(physicalClose!, 'actual owner transaction release')).toBe(true)
    await owner.closed
    expect(ownerFinished).toBe(true)
    const replacement = await PluginSupervisor.start(ownerOptions)
    closers.push(async () => {
      expect(await replacement.shutdown()).toBe(true)
      await replacement.closed
    })
    expect(await replacement.shutdown()).toBe(true)
    await replacement.closed
    expect(service.controller.cleanForShutdown()).toBe(true)
    expect((await service.controller.status()).cleanupPending).toEqual([])
    for (const handle of [healthyHandle, personHandle, agentHandle])
      expect(() => service.controller.hostWorkspace(handle)).toThrow()
    const afterPhysical = await Promise.all(paths.map((path) => readFile(path)))
    expect(afterPhysical).toEqual(before)
    expect(applied).toHaveBeenCalledTimes(callbacks)
    positiveHold.resolve()
    routeHold.resolve()
    await bounded(positiveReturned.promise, 'late person acknowledgement returned')
    await bounded(routeClosed.promise, 'captured late route closed its own actual HTTP server')
    await bounded(service.close(), 'eventual person and route cleanup join')
    await bounded(closing, 'original close caller')
    await turn()
    expect(ownedRouteCloses).toHaveBeenCalledOnce()
    expect(controlRouteCloses).not.toHaveBeenCalled()
    await expect(
      fetch(heldRoute!.server.url, { signal: AbortSignal.timeout(2000) }),
    ).rejects.toBeDefined()
    await expect(outside.listTools()).resolves.toMatchObject({ tools: [{ name: 'echo' }] })
    expect(applied).toHaveBeenCalledTimes(callbacks)
    expect(writes).not.toHaveBeenCalled()
    expect(service.controller.cleanForShutdown()).toBe(true)
    expect((await service.controller.status()).cleanupPending).toEqual([])
    expect(service.controller.agentAttachments(workspaceId)).toEqual([])
    for (const handle of [healthyHandle, personHandle, agentHandle])
      expect(() => service.controller.hostWorkspace(handle)).toThrow()
    expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(before)
    expect(host.removePackage).not.toHaveBeenCalled()
    expect(host.removeData).not.toHaveBeenCalled()
    expect(host.start).toHaveBeenCalledTimes(starts)
    expect(new Set(host.start.mock.calls.map(([input]) => input.package.manifest.id))).toEqual(
      new Set([A, B]),
    )
    expect(download).toHaveBeenCalledTimes(downloads)
    const routeOutcome = await bounded(reading, 'negotiated route request completion')
    if (routeOutcome.ok) {
      expect([1, 2]).toContain(routeOutcome.value.format)
      if (routeOutcome.value.format === 2)
        expect(routeOutcome.value.value).toMatchObject({ format: 2, servers: [] })
      else expect(routeOutcome.value.value).toEqual([])
    } else expect(routeOutcome.error).toMatchObject({ code: 'unavailable' })
  },
  20000,
)
