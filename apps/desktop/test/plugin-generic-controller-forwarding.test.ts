import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import {
  fixture,
  cleanupLifecycleFixtures,
  projection,
  reopenLifecycleFixture,
  deferred,
} from './plugin-lifecycle-fixtures'
import { signed, tar } from './plugin-package-fixtures'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
it('projects an installed generic package into the same provider and callback MCP path', async () => {
  const mcp = await pluginProviderFixture({ createBroker: false })
  cleanup.push(() => mcp.close())
  const target = {
    os: process.platform as 'darwin' | 'linux' | 'win32',
    cpu: process.arch as 'arm64' | 'x64',
  }
  const files = new Map([
    ['main.cjs', Buffer.from('// Inert fictional garden entry.')],
    ['tools.json', Buffer.from('{"tools":[]}')],
  ])
  const manifest = {
    format: 3,
    id: 'fictional-garden',
    name: 'Fictional garden',
    version: '1.0.0',
    description: 'Gather fictional petals.',
    authors: ['Fictional Gardener'],
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
  const bytes = Buffer.from(JSON.stringify(manifest))
  const archive = tar([
    { path: 'plugin.json', body: bytes },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  const catalogue = signed({
    format: 1,
    entries: [
      {
        id: manifest.id,
        version: manifest.version,
        sourceCommit: 'f'.repeat(40),
        platforms: [target],
        archive: {
          url: 'https://plugins.example.invalid/garden.tar',
          size: archive.length,
          sha256: pluginSha256(archive),
          compression: 'tar',
        },
        manifestSha256: pluginSha256(bytes),
      },
    ],
  })
  const f = await fixture(
    {
      catalogue,
      download: async () => archive,
      runtime: {
        previousOwnerClean: async () => true,
        removeCode: async () => {},
        start: async () => ({
          runId: randomUUID(),
          exited: new Promise<void>(() => {}),
          stop: async () => {},
          ready: async () => ({
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            client: mcp.client,
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
            admin: () => ({ url: '', headers: { Authorization: '' } }),
          }),
        }),
      },
    },
    false,
    'fictional-garden',
  )
  await f.controller.detach(f.handle)
  const controller = sharedLifecycleWorkspaces(f.controller)
  const person = await controller.attach(f.local.sink)
  cleanup.push(() => controller.detach(person))
  await controller.install(person, manifest.id)
  const views = controller.agentAttachments(f.local.sink.workspaceId)
  expect(views).toHaveLength(1)
  expect(views[0]!.package.manifest.format).toBe(3)
  const bridge = createLifecycleAgentBridge({ owner: { valid: () => true }, controller })
  controller.bindGenericTools(bridge)
  cleanup.push(() => bridge.close())
  const lease: WorkspaceLease = {
    id: randomUUID(),
    workspace: 'a'.repeat(64),
    generation: randomUUID(),
    epoch: randomUUID(),
    counter: 0,
    renewedAt: 0,
    minor: 0,
    features: [],
  }
  const servers = await bridge.routes(lease, {
    kind: 'agent-routes',
    workspaceId: f.local.sink.workspaceId,
    incarnation: randomUUID(),
    workspace: lease.workspace,
    generation: lease.generation,
    lease: 'b'.repeat(64),
    occupied: ['brobot'],
    release: false,
  })
  expect(servers).toHaveLength(1)
  const provider = new Client({ name: 'fictional-provider', version: '1' })
  provider.onerror = () => undefined
  cleanup.push(() => provider.close())
  await provider.connect(
    new StreamableHTTPClientTransport(new URL(servers[0]!.url), {
      requestInit: { headers: { Authorization: `Bearer ${servers[0]!.capability}` } },
    }),
  )
  const tools = [
    {
      name: 'gather_petals',
      inputSchema: { type: 'object' as const, properties: { basket: { type: 'string' } } },
    },
  ]
  mcp.setTools(tools)
  const scope = {
    workspaceId: f.local.sink.workspaceId,
    pluginId: manifest.id,
    instanceId: views[0]!.runId,
  }
  expect(await controller.genericListTools(scope)).toEqual(tools)
  expect((await provider.listTools()).tools).toEqual(tools)
  await provider.callTool({ name: 'gather_petals', arguments: { basket: 'provider' } })
  await controller.genericCallTool({
    ...scope,
    name: 'gather_petals',
    arguments: { basket: 'callback' },
    requestId: randomUUID(),
    origin: 'button',
  })
  expect(mcp.seen.map((call) => call.arguments)).toEqual([
    { basket: 'provider' },
    { basket: 'callback' },
  ])
  expect(mcp.seen.map((call) => call.meta?.origin)).toEqual(['agent', 'button'])
  for (const code of [
    ErrorCode.InvalidParams,
    ErrorCode.ConnectionClosed,
    ErrorCode.RequestTimeout,
  ]) {
    const message = 'fictional callback basket',
      data = { field: 'basket' }
    mcp.fail({ code, message, data })
    await expect(
      controller.genericCallTool({
        ...scope,
        name: 'gather_petals',
        arguments: {},
        requestId: randomUUID(),
        origin: 'button',
      }),
    ).rejects.toMatchObject({ code, message: `MCP error ${code}: ${message}`, data })
  }
  mcp.fail()
  const workspaceId = scope.workspaceId
  const other = projection()
  const otherPerson = await controller.attach(other.sink)
  cleanup.push(() => controller.detach(otherPerson))
  expect(f.state.getEnabled(workspaceId, manifest.id)).toEqual({ enabled: true, revision: 0 })
  expect(f.state.getTitlesEnabled(workspaceId, manifest.id)).toEqual({
    enabled: false,
    revision: 0,
  })
  const captured = controller.agentAttachments(workspaceId)[0]!
  let release!: () => void
  const completion = new Promise<void>((resolve) => {
    release = resolve
  })
  let arrived = false
  const original = mcp.client.callTool.bind(mcp.client)
  const delayed = vi.spyOn(mcp.client, 'callTool').mockImplementationOnce(async (...args) => {
    const result = await original(...args)
    arrived = true
    await completion
    return result
  })
  const pending = controller.genericCallTool({
    ...scope,
    name: 'gather_petals',
    requestId: randomUUID(),
    origin: 'button',
  })
  const outcome = pending.catch((error: unknown) => error)
  await vi.waitFor(() => expect(arrived).toBe(true))
  await f.state.withExclusive(async () => {
    f.state.setEnabled(workspaceId, manifest.id, false)
  })
  expect(controller.agentAttachments(workspaceId)).toEqual([])
  expect(captured.current()).toBe(false)
  await expect(controller.genericListTools(scope)).rejects.toMatchObject({ code: 'disabled' })
  await expect(
    controller.genericCallTool({
      ...scope,
      name: 'gather_petals',
      requestId: randomUUID(),
      origin: 'button',
    }),
  ).rejects.toMatchObject({ code: 'disabled' })
  const otherView = controller.agentAttachments(other.sink.workspaceId)[0]!
  await expect(
    controller.genericCallTool({
      workspaceId: other.sink.workspaceId,
      pluginId: manifest.id,
      instanceId: otherView.runId,
      name: 'gather_petals',
      requestId: randomUUID(),
      origin: 'button',
    }),
  ).resolves.toHaveProperty('content')
  const reconciled = await controller.attach({ ...f.local.sink })
  cleanup.push(() => controller.detach(reconciled))
  expect(f.state.getEnabled(workspaceId, manifest.id)).toEqual({ enabled: false, revision: 1 })
  expect(controller.agentAttachments(workspaceId)).toEqual([])
  await f.state.withExclusive(async () => {
    f.state.setEnabled(workspaceId, manifest.id, true)
  })
  expect(f.state.getEnabled(workspaceId, manifest.id)).toEqual({ enabled: true, revision: 2 })
  expect(captured.current()).toBe(false)
  release()
  await expect(outcome).resolves.toMatchObject({ code: 'disabled' })
  delayed.mockRestore()
  await expect(
    controller.genericCallTool({
      ...scope,
      name: 'gather_petals',
      requestId: randomUUID(),
      origin: 'button',
    }),
  ).resolves.toHaveProperty('content')
  await expect(provider.listTools()).rejects.toBeDefined()
  await f.state.withExclusive(async () => {
    f.state.setEnabled(workspaceId, manifest.id, false)
  })
  const reopened = reopenLifecycleFixture(f)
  expect(reopened.getEnabled(workspaceId, manifest.id)).toEqual({ enabled: false, revision: 3 })
  const restarted = sharedLifecycleWorkspaces(
    await PluginLifecycleController.open({ ...f.opts, state: reopened }),
  )
  const restartedPerson = await restarted.attach(f.local.sink)
  cleanup.push(() => restarted.detach(restartedPerson))
  expect(restarted.agentAttachments(workspaceId)).toEqual([])
  expect(reopened.getEnabled(workspaceId, manifest.id)).toEqual({ enabled: false, revision: 3 })
  const restartedBridge = createLifecycleAgentBridge({
    owner: { valid: () => true },
    controller: restarted,
  })
  restarted.bindGenericTools(restartedBridge)
  cleanup.push(() => restartedBridge.close())
  const receipt = deferred<void>()
  const install = reopened.currentInstallation(manifest.id)!
  const checkReceipt = () => {
    if (restarted.admitted(restartedPerson, manifest.id, install.installId)) receipt.resolve()
  }
  const stopObserving = restarted.onHostChanged((changed) => {
    if (changed === workspaceId) checkReceipt()
  })
  cleanup.push(async () => stopObserving())
  try {
    await restarted.setEnabled(restartedPerson, manifest.id, true)
    checkReceipt()
    await receipt.promise
  } finally {
    stopObserving()
  }
  expect(reopened.getEnabled(workspaceId, manifest.id)).toEqual({ enabled: true, revision: 4 })
  const restartedView = restarted.agentAttachments(workspaceId)[0]!
  await expect(
    restarted.genericCallTool({
      workspaceId,
      pluginId: manifest.id,
      instanceId: restartedView.runId,
      name: 'gather_petals',
      requestId: randomUUID(),
      origin: 'button',
    }),
  ).resolves.toHaveProperty('content')
})
