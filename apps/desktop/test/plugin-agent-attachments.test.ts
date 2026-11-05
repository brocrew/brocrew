import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import type { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleWorkspace, WorkspaceProjection } from '../src/main/plugins/lifecycle/types'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import type { Command } from '../src/main/plugins/supervisor/protocol'
import type { ManagedPluginMcpServer } from '@brobot2/runtime'
import type { PluginMcpClient } from '../src/main/plugins/tool-broker'
import { pluginProviderFixture, PLUGIN_MARKER } from './fixtures/plugin-provider-fixture'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
type View = ReturnType<PluginLifecycleController['agentAttachments']>[number]
type Request = Extract<Command, { kind: 'agent-routes' }>
const request = (workspaceId = 'fictional-workspace', incarnation = randomUUID()): Request => ({
  kind: 'agent-routes',
  workspaceId,
  incarnation,
  workspace: 'a'.repeat(64),
  generation: randomUUID(),
  lease: 'b'.repeat(64),
  occupied: ['brobot'],
  release: false,
})
const lease = (): WorkspaceLease => ({
  id: randomUUID(),
  workspace: 'a'.repeat(64),
  generation: randomUUID(),
  epoch: randomUUID(),
  counter: 0,
  renewedAt: 0,
  minor: 0,
  features: [],
})
async function connected(server: ManagedPluginMcpServer) {
  const client = new Client({ name: 'fictional-agent', version: '1' })
  client.onerror = () => undefined
  cleanup.push(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: `Bearer ${server.capability}` } },
    }),
  )
  return client
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
async function fixture(bindingReady?: Promise<PluginMcpClient>) {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  let runId = 'fictional-instance',
    live = true
  const revisions = new Map<string, number>()
  const sinks = new Map<LifecycleWorkspace, WorkspaceProjection>()
  const controller = {
    agentAttachments: vi.fn((workspaceId: string): View[] => {
      if (!f.enabled.has(workspaceId)) return []
      const instance = runId
      const revision = revisions.get(workspaceId) ?? 0
      return [
        {
          installation: {
            pluginId: 'fern',
            installId: 'fictional-code',
            incarnation: 1,
            configRevision: 1,
          },
          workspaceId,
          runId: instance,
          exited: new Promise<void>(() => {}),
          connection: Promise.resolve({ client: f.client }),
          current: () =>
            live &&
            instance === runId &&
            f.enabled.has(workspaceId) &&
            (revisions.get(workspaceId) ?? 0) === revision,
        } as unknown as View,
      ]
    }),
    agentScope: vi.fn((workspaceId: string) => ({
      workspaceId,
      revision: 0,
      entries: controller.agentAttachments(workspaceId).map((view) => ({
        pluginId: view.installation.pluginId,
        enabled: true,
        installId: view.installation.installId,
        runId: view.runId,
        switchRevision: revisions.get(workspaceId) ?? 0,
        is: 'admitted' as const,
        view,
      })),
    })),
    onHostChanged: vi.fn(() => () => {}),
    attach: vi.fn(async (sink: WorkspaceProjection) => {
      const handle = {} as LifecycleWorkspace
      sinks.set(handle, sink)
      return handle
    }),
    detach: vi.fn(async (handle: LifecycleWorkspace) => {
      const sink = sinks.get(handle)
      if (sink) await sink.revoke('fern', 'fictional-code')
      sinks.delete(handle)
    }),
  }
  const owner = { valid: vi.fn(() => live) }
  const restartHost = vi.fn(async () => {
    runId = randomUUID()
  })
  const bridge = createLifecycleAgentBridge({
    owner,
    controller,
    restartHost,
    ...(bindingReady ? { binding: () => bindingReady } : {}),
  })
  cleanup.push(() => bridge.close())
  const scope = (workspaceId = 'fictional-workspace') => ({
    workspaceId,
    pluginId: 'fern',
    instanceId: runId,
  })
  const call = (workspaceId = 'fictional-workspace') => ({
    ...scope(workspaceId),
    name: 'echo',
    arguments: { basket: 'fern' },
    requestId: randomUUID(),
    origin: 'button',
  })
  return {
    ...f,
    bridge,
    controller,
    owner,
    sinks,
    restartHost,
    scope,
    call,
    switchWorkspace(workspaceId: string, enabled: boolean) {
      if (f.enabled.has(workspaceId) === enabled) return
      revisions.set(workspaceId, (revisions.get(workspaceId) ?? 0) + 1)
      if (enabled) f.enabled.add(workspaceId)
      else f.enabled.delete(workspaceId)
    },
    replace: () => {
      runId = randomUUID()
    },
    end: () => {
      live = false
    },
  }
}
it('exposes generic provider attachments and sends app callbacks through the same instance client', async () => {
  const f = await fixture(),
    l = lease(),
    req = request()
  const servers = await f.bridge.routes(l, req)
  expect(servers).toHaveLength(1)
  const client = await connected(servers[0]!)
  expect((await client.listTools()).tools[0]?.name).toBe('echo')
  await client.callTool({ name: 'echo', arguments: { basket: 'agent' } })
  const result = await f.bridge.callTool(f.call())
  expect(result.content).toEqual([{ type: 'text', text: PLUGIN_MARKER }])
  expect(f.seen.map((one) => one.arguments)).toEqual([{ basket: 'agent' }, { basket: 'fern' }])
  expect(f.seen.map((one) => one.meta?.origin)).toEqual(['agent', 'button'])
  expect(f.controller.attach).toHaveBeenCalledOnce()
})
it('uses current inventory for callbacks and providers, including changed schemas', async () => {
  const f = await fixture(),
    servers = await f.bridge.routes(lease(), request()),
    client = await connected(servers[0]!)
  const tools = [
    {
      name: 'gather_petals',
      inputSchema: { type: 'object' as const, properties: { flowers: { type: 'array' } } },
    },
  ]
  f.setTools(tools)
  expect(await f.bridge.listTools(f.scope())).toEqual(tools)
  expect((await client.listTools()).tools).toEqual(tools)
})
it('does not retarget old callbacks or routes when an instance is replaced', async () => {
  const f = await fixture(),
    l = lease(),
    req = request(),
    oldCall = f.call()
  const oldServers = await f.bridge.routes(l, req),
    oldClient = await connected(oldServers[0]!)
  f.replace()
  await expect(f.bridge.callTool(oldCall)).rejects.toThrow()
  await expect(oldClient.callTool({ name: 'echo', arguments: {} })).rejects.toThrow()
  const newServers = await f.bridge.routes(l, req)
  expect(newServers[0]?.url).not.toBe(oldServers[0]?.url)
  await f.bridge.callTool(f.call())
  expect(f.seen).toHaveLength(1)
})
it('removes one workspace routes and callbacks while keeping another workspace live', async () => {
  const f = await fixture(),
    a = lease(),
    b = lease()
  const first = await f.bridge.routes(a, request()),
    second = await f.bridge.routes(b, request('fictional-other'))
  const firstClient = await connected(first[0]!),
    secondClient = await connected(second[0]!)
  f.enabled.delete('fictional-workspace')
  const firstSink = [...f.sinks.values()].find(
    (sink) => sink.workspaceId === 'fictional-workspace',
  )!
  expect(await firstSink.revoke('fern', 'fictional-code')).toBe(true)
  await expect(firstClient.listTools()).rejects.toThrow()
  await expect(f.bridge.callTool(f.call())).rejects.toMatchObject({ code: 'disabled' })
  await secondClient.callTool({ name: 'echo', arguments: {} })
  await f.bridge.callTool(f.call('fictional-other'))
  expect(f.seen).toHaveLength(2)
})
it('cancels a matching callback without disabling its future calls', async () => {
  const f = await fixture(),
    call = f.call()
  f.hold(true)
  const outcome = f.bridge.callTool(call).catch((error: unknown) => error)
  await vi.waitFor(() => expect(f.seen).toHaveLength(1))
  expect(await f.bridge.cancelTool(call)).toEqual({ cancelled: true, completed: false })
  expect(await outcome).toMatchObject({ code: 'cancelled' })
  await vi.waitFor(() => expect(f.cancelled).toHaveLength(1))
  f.hold(false)
  await f.bridge.callTool(f.call())
  expect(f.seen).toHaveLength(2)
})
it('releases one agent attachment without a per-agent tool grant or another consumer being revoked', async () => {
  const f = await fixture(),
    l = lease(),
    req = request()
  const source = new WorkspacePluginAttachments(
    { agentRoutes: (input) => f.bridge.routes(l, { ...req, ...input }) },
    req.workspaceId,
  )
  const a = source.agent(['brobot']),
    b = source.agent(['brobot'])
  const first = await a.read(),
    second = await b.read()
  expect(first.servers).toHaveLength(1)
  expect(second.servers).toHaveLength(1)
  expect(first.servers[0]?.url).not.toBe(second.servers[0]?.url)
  await a.close()
  await expect(a.read()).rejects.toThrow()
  const client = await connected((await b.read()).servers[0]!)
  await client.callTool({ name: 'echo', arguments: {} })
  await b.close()
})
it('generic restart retires old instances and an old host exit never revokes the replacement', async () => {
  const f = await fixture(),
    l = lease(),
    req = request(),
    old = f.scope()
  await f.bridge.routes(l, req)
  await f.bridge.restartPlugin('fern')
  expect(f.restartHost).toHaveBeenCalledWith('fern')
  await f.bridge.routes(l, req)
  f.bridge.hostExited('fern', old.instanceId)
  await f.bridge.callTool(f.call())
  await expect(f.bridge.callTool({ ...f.call(), instanceId: old.instanceId })).rejects.toThrow()
})
it('coalesces concurrent callbacks for a new instance without retiring the same replacement', async () => {
  const f = await fixture()
  await f.bridge.callTool(f.call())
  f.replace()
  await Promise.all([f.bridge.callTool(f.call()), f.bridge.callTool(f.call())])
  expect(f.seen).toHaveLength(3)
})
it('assigns another reversible namespace when an external server occupies the preferred name', async () => {
  const f = await fixture(),
    l = lease(),
    req = request()
  req.occupied.push('plugin-fern')
  const first = await f.bridge.routes(l, req)
  expect(first).toHaveLength(1)
  expect(first[0]?.name).not.toBe('plugin-fern')
  const client = await connected(first[0]!)
  await client.callTool({ name: 'echo', arguments: {} })
  expect(f.seen).toHaveLength(1)
})

for (const operation of ['list', 'call'] as const) {
  it(`rejects a ${operation} captured before an off-on transition while binding awaits`, async () => {
    const binding = deferred<PluginMcpClient>()
    const f = await fixture(binding.promise)
    const pending =
      operation === 'list' ? f.bridge.listTools(f.scope()) : f.bridge.callTool(f.call())
    const outcome = pending.catch((error: unknown) => error)
    f.switchWorkspace('fictional-workspace', false)
    f.switchWorkspace('fictional-workspace', true)
    binding.resolve(f.client)
    expect(await outcome).toMatchObject({ code: 'disabled' })
    expect(f.seen).toHaveLength(0)
    expect(await f.bridge.callTool(f.call())).toMatchObject({ content: [{ text: PLUGIN_MARKER }] })
  })

  it(`suppresses a callback ${operation} reply captured before an off-on transition`, async () => {
    const f = await fixture(),
      complete = deferred<void>()
    let arrived = false
    if (operation === 'list') {
      const original = f.client.listTools.bind(f.client)
      vi.spyOn(f.client, 'listTools').mockImplementationOnce(async (...args) => {
        const result = await original(...args)
        arrived = true
        await complete.promise
        return result
      })
    } else {
      const original = f.client.callTool.bind(f.client)
      vi.spyOn(f.client, 'callTool').mockImplementationOnce(async (...args) => {
        const result = await original(...args)
        arrived = true
        await complete.promise
        return result
      })
    }
    const pending =
      operation === 'list' ? f.bridge.listTools(f.scope()) : f.bridge.callTool(f.call())
    const outcome = pending.catch((error: unknown) => error)
    await vi.waitFor(() => expect(arrived).toBe(true))
    f.switchWorkspace('fictional-workspace', false)
    f.switchWorkspace('fictional-workspace', true)
    complete.resolve()
    expect(await outcome).toMatchObject({ code: 'disabled' })
    expect(await f.bridge.callTool(f.call())).toMatchObject({ content: [{ text: PLUGIN_MARKER }] })
  })

  it(`suppresses an old provider ${operation} reply and replaces the retired route after off-on`, async () => {
    const f = await fixture(),
      l = lease(),
      req = request(),
      complete = deferred<void>()
    const servers = await f.bridge.routes(l, req)
    const client = await connected(servers[0]!)
    let arrived = false
    if (operation === 'list') {
      const original = f.client.listTools.bind(f.client)
      vi.spyOn(f.client, 'listTools').mockImplementationOnce(async (...args) => {
        const result = await original(...args)
        arrived = true
        await complete.promise
        return result
      })
    } else {
      const original = f.client.callTool.bind(f.client)
      vi.spyOn(f.client, 'callTool').mockImplementationOnce(async (...args) => {
        const result = await original(...args)
        arrived = true
        await complete.promise
        return result
      })
    }
    const pending =
      operation === 'list' ? client.listTools() : client.callTool({ name: 'echo', arguments: {} })
    const outcome = pending.catch((error: unknown) => error)
    await vi.waitFor(() => expect(arrived).toBe(true))
    f.switchWorkspace('fictional-workspace', false)
    f.switchWorkspace('fictional-workspace', true)
    complete.resolve()
    expect(await outcome).toBeInstanceOf(Error)
    const fresh = await f.bridge.routes(l, req)
    expect(fresh[0]!.url).not.toBe(servers[0]!.url)
    const next = await connected(fresh[0]!)
    expect(await next.callTool({ name: 'echo', arguments: {} })).toMatchObject({
      content: [{ text: PLUGIN_MARKER }],
    })
  })
}
