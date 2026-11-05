import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'
import { PluginEffectQueue } from '../src/main/plugins/lifecycle/effect-queue'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import type { LifecycleOptions } from '../src/main/plugins/lifecycle/types'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'
import { signed, tar } from './plugin-package-fixtures'
const A = 'fictional-garden',
  B = 'fictional-moss'
const gather = { tool: 'gather_petals', arguments: { basket: 'contribution' } }
const releases: Array<() => void> = []
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  try {
    for (const close of closers.splice(0).reverse()) await close()
  } finally {
    vi.restoreAllMocks()
    await cleanupLifecycleFixtures()
  }
})
async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The drain boundary did not settle')), 1500)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function removalFixture() {
  const pkg = genericPackage(B)
  const mcp = await pluginProviderFixture({ createBroker: false })
  closers.push(() => mcp.close())
  mcp.setTools(pkg.tools)
  const stop = vi.fn(),
    removeCode = vi.fn(async () => {}),
    removeData = vi.fn(async () => {})
  const queue = new PluginEffectQueue()
  const runtime: LifecycleOptions['runtime'] = {
    previousOwnerClean: async () => true,
    removeCode,
    removeData,
    async start() {
      const exit = deferred<void>()
      let stopped = false
      const stopping = async () => {
        if (stopped) return
        stopped = true
        stop()
        exit.resolve()
      }
      owner!.adopt({ stop: stopping, exited: exit.promise, descendantsGone: async () => false })
      return {
        runId: randomUUID(),
        exited: exit.promise,
        stop: stopping,
        async ready() {
          return {
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            client: mcp.client,
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
            admin: () => ({ url: '', headers: { Authorization: '' } }),
          }
        },
      }
    },
  }
  const f = await fixture(
    {
      runtime,
      effectQueue: queue,
      catalogue: signed({ format: 1, entries: [pkg.release] }),
      download: async () => pkg.archive,
    },
    false,
    B,
  )
  const owner = await PluginSupervisor.start({
    root: f.root,
    workspaceRoots: [f.workspace],
    drainWithin: 1000,
  })
  owner.bindLifecycleEffects(queue)
  owner.bindAgentBridge({ routes: async () => [], revoke() {}, close: () => f.controller.drain() })
  const lease = await PluginWorkspaceLease.attach({
    root: f.root,
    workspaceRoot: f.workspace,
    generation: randomUUID(),
    build: 'fictional',
  })
  closers.push(async () => {
    lease.abandon()
    await owner!.shutdown()
    await owner!.closed
    await f.controller.drain()
  })
  await f.controller.install(f.handle, B)
  return { f, mcp, owner, stop, removeCode, removeData }
}
async function recoverController(f: Awaited<ReturnType<typeof fixture>>) {
  const state = reopenLifecycleFixture(f)
  const owner = await PluginSupervisor.start({ root: f.root, workspaceRoots: [f.workspace] })
  const queue = new PluginEffectQueue()
  owner.bindLifecycleEffects(queue)
  closers.push(async () => {
    await owner.shutdown()
    await owner.closed
  })
  const controller = await PluginLifecycleController.open({ ...f.opts, state, effectQueue: queue })
  closers.push(() => controller.drain())
  owner.bindAgentBridge({ routes: async () => [], revoke() {}, close: () => controller!.drain() })
  return { state, controller }
}

function genericPackage(id: string) {
  const target = {
    os: process.platform as 'darwin' | 'linux' | 'win32',
    cpu: process.arch as 'arm64' | 'x64',
  }
  const tools = [
    {
      name: id === A ? gather.tool : 'retire_moss',
      inputSchema: { type: 'object' as const, properties: { basket: { type: 'string' } } },
    },
  ]
  const files = new Map([
    ['main.cjs', Buffer.from('// Inert fictional runtime; MCP is the actual SDK fixture.')],
    ['tools.json', Buffer.from(JSON.stringify({ tools }))],
  ])
  const manifest = {
    format: 3,
    id,
    name: id,
    version: '1.0.0',
    description: 'Fictional independent garden work.',
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
    ui:
      id === A
        ? [
            {
              id: 'gather',
              slot: 'composer.accessory',
              view: { label: 'Gather petals' },
              invoke: gather,
            },
          ]
        : [],
    lifecycle: {
      stop: { signal: 'SIGTERM' },
      dataOnRemove: 'remove',
      ...(id === B
        ? { beforeRemove: { tool: 'retire_moss', arguments: { basket: 'cleanup' } } }
        : {}),
    },
    data: { schema: 1 },
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const archive = tar([
    { path: 'plugin.json', body: manifestBytes },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  return {
    tools,
    archive,
    release: {
      id,
      version: manifest.version,
      sourceCommit: 'f'.repeat(40),
      platforms: [target],
      archive: {
        url: `https://plugins.example.invalid/${id}.tar`,
        size: archive.length,
        sha256: pluginSha256(archive),
        compression: 'tar',
      },
      manifestSha256: pluginSha256(manifestBytes),
    },
  }
}

it('drain stops the retained run with an actual held beforeRemove request and recovery never replays it', async () => {
  const { f, mcp, owner, stop, removeCode, removeData } = await removalFixture()
  mcp.hold(true)
  const calls = vi.spyOn(mcp.client, 'callTool')
  const operation = randomUUID()
  const removal = f.controller.uninstall(f.handle, B, operation).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
  await vi.waitFor(() =>
    expect(mcp.seen).toMatchObject([
      { name: 'retire_moss', meta: { requestId: operation, origin: 'lifecycle.beforeRemove' } },
    ]),
  )
  const effects = await LifecycleEffects.open(f.root, false)
  expect(await effects.read(operation)).toMatchObject({
    operationId: operation,
    cleanupAttempted: true,
    cleanupResult: 'unconfirmed',
  })
  const selected = await readFile(join(f.root, 'state/installed-state.json'))
  expect(await within(owner.shutdown())).toBe(true)
  await within(owner.closed)
  await within(f.controller.drain())
  expect(stop).toHaveBeenCalledOnce()
  expect((await within(removal)).ok).toBe(false)
  expect(calls).toHaveBeenCalledOnce()
  expect(removeCode).not.toHaveBeenCalled()
  expect(removeData).not.toHaveBeenCalled()
  expect(await readFile(join(f.root, 'state/installed-state.json'))).toEqual(selected)
  expect(f.state.inspect().pending?.request.operationId).toBe(operation)
  expect(mcp.cancelled).toContain(operation)
  mcp.hold(false)
  const { state } = await recoverController(f)
  expect(state.operation(operation)?.status).toBe('completed')
  expect(state.currentInstallation(B)).toBeNull()
  expect(calls).toHaveBeenCalledOnce()
  expect(removeCode).toHaveBeenCalledOnce()
  expect(removeData).toHaveBeenCalledOnce()
  expect(await effects.read(operation)).toMatchObject({
    cleanupAttempted: true,
    cleanupResult: 'unconfirmed',
    removalOutcome: { data: 'deleted', cleanup: 'unconfirmed' },
  })
})
it('drain waits for removeData already in flight but refuses the subsequent commit', async () => {
  const { f, owner, stop, removeData } = await removalFixture()
  const entered = deferred<void>(),
    release = deferred<void>()
  releases.push(() => release.resolve())
  removeData.mockImplementation(async () => {
    entered.resolve()
    await release.promise
  })
  const operation = randomUUID()
  const removal = f.controller.uninstall(f.handle, B, operation).then(
    () => true,
    () => false,
  )
  await within(
    Promise.race([
      entered.promise,
      removal.then(() => {
        throw new Error('The removal did not reach removeData')
      }),
    ]),
  )
  const selected = await readFile(join(f.root, 'state/installed-state.json'))
  let drained = false
  const draining = owner.shutdown().then(async () => {
    await owner.closed
    await f.controller.drain()
    drained = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(stop).toHaveBeenCalled()
  expect(drained).toBe(false)
  await expect(
    PluginSupervisor.start({ root: f.root, workspaceRoots: [f.workspace] }),
  ).rejects.toMatchObject({ code: 'busy' })
  expect(f.state.operation(operation)?.status).toBe('prepared')
  release.resolve()
  await within(draining)
  expect(await removal).toBe(false)
  expect(removeData).toHaveBeenCalledOnce()
  expect(await readFile(join(f.root, 'state/installed-state.json'))).toEqual(selected)
})
it('a held consumer acknowledgement cannot retain drain or start deletion after closing', async () => {
  const { f, owner, removeCode, removeData } = await removalFixture()
  const entered = deferred<void>(),
    ack = deferred<void>()
  releases.push(() => ack.resolve())
  f.local.sink.revoke = vi.fn(async () => {
    entered.resolve()
    await ack.promise
    return true
  })
  const write = vi.spyOn(LifecycleEffects.prototype, 'write')
  const operation = randomUUID()
  const removal = f.controller.uninstall(f.handle, B, operation).then(
    () => true,
    () => false,
  )
  await within(
    Promise.race([
      entered.promise,
      removal.then(() => {
        throw new Error('The removal did not reach consumer revoke')
      }),
    ]),
  )
  const writes = write.mock.calls.length
  const selected = await readFile(join(f.root, 'state/installed-state.json'))
  await within(f.controller.drain())
  expect(await removal).toBe(false)
  expect(write).toHaveBeenCalledTimes(writes)
  expect(removeCode).not.toHaveBeenCalled()
  expect(removeData).not.toHaveBeenCalled()
  ack.resolve()
  await Promise.resolve()
  expect(write).toHaveBeenCalledTimes(writes)
  expect(await readFile(join(f.root, 'state/installed-state.json'))).toEqual(selected)
  expect(await within(owner.shutdown())).toBe(true)
  await within(owner.closed)
  const { state } = await recoverController(f)
  expect(state.operation(operation)?.status).toBe('completed')
  expect(removeCode).toHaveBeenCalledOnce()
  expect(removeData).toHaveBeenCalledOnce()
})
it('drain retains an already started effect file write and prevents the cleanup call after it', async () => {
  const { f, mcp, owner, removeCode, removeData } = await removalFixture()
  const entered = deferred<void>(),
    release = deferred<void>()
  releases.push(() => release.resolve())
  const operation = randomUUID()
  const original = LifecycleEffects.prototype.write
  const write = vi.spyOn(LifecycleEffects.prototype, 'write').mockImplementation(async function (
    this: LifecycleEffects,
    effect,
  ) {
    if (effect.operationId === operation && effect.cleanupAttempted === true) {
      entered.resolve()
      await release.promise
    }
    return original.call(this, effect)
  })
  const removal = f.controller.uninstall(f.handle, B, operation).then(
    () => true,
    () => false,
  )
  await within(
    Promise.race([
      entered.promise,
      removal.then(() => {
        throw new Error('The consumed marker write was not reached')
      }),
    ]),
  )
  const selected = await readFile(join(f.root, 'state/installed-state.json'))
  const writes = write.mock.calls.length
  let drained = false
  const draining = owner.shutdown().then(async () => {
    await owner.closed
    await f.controller.drain()
    drained = true
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(drained).toBe(false)
  await expect(
    PluginSupervisor.start({ root: f.root, workspaceRoots: [f.workspace] }),
  ).rejects.toMatchObject({ code: 'busy' })
  release.resolve()
  await within(draining)
  expect(await removal).toBe(false)
  expect(write).toHaveBeenCalledTimes(writes)
  expect(mcp.seen).toEqual([])
  expect(removeCode).not.toHaveBeenCalled()
  expect(removeData).not.toHaveBeenCalled()
  expect(await readFile(join(f.root, 'state/installed-state.json'))).toEqual(selected)
  expect(await (await LifecycleEffects.open(f.root, false)).read(operation)).toMatchObject({
    cleanupAttempted: true,
    cleanupResult: 'unconfirmed',
  })
})
