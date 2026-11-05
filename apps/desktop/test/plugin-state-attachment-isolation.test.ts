import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import type {
  LifecycleOptions,
  LifecycleWorkspace,
  WorkspaceProjection,
} from '../src/main/plugins/lifecycle/types'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { pluginProviderNamespace } from '../src/main/plugins/managed-transport'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
} from './plugin-lifecycle-fixtures'
import { signed, tar } from './plugin-package-fixtures'

const A = 'fictional-garden'
const B = 'fictional-moss'
const gather = { tool: 'gather_petals', arguments: { basket: 'contribution' } }
const modes = ['new workspace', 'new consumer'] as const
const releases: Array<() => void> = []
const closers: Array<() => Promise<unknown>> = []
type Fixture = Awaited<ReturnType<typeof fixture>>

async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  // Attempt every closer even if the regression invalidates a consumer or route.
  const failures: unknown[] = []
  try {
    for (const close of closers.splice(0).reverse()) {
      try {
        await bounded(Promise.resolve().then(close), 'fixture close')
      } catch (error) {
        failures.push(error)
      }
    }
  } finally {
    vi.restoreAllMocks()
    await cleanupLifecycleFixtures()
  }
  if (failures.length) throw new AggregateError(failures, 'Attachment fixture cleanup failed')
})

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
    ['main.cjs', Buffer.from('// Inert fictional runtime; actual SDK fixture supplies MCP.')],
    ['tools.json', Buffer.from(JSON.stringify({ tools }))],
    ['configure.html', Buffer.from('<!doctype html><title>Fictional garden settings</title>')],
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
    settings: { page: { entry: 'configure.html', assets: ['configure.html'] } },
    ui:
      id === A
        ? [{ id: 'gather', slot: 'composer.accessory', view: { label: 'Gather' }, invoke: gather }]
        : [],
    lifecycle: {
      stop: { signal: 'SIGTERM' },
      dataOnRemove: 'keep',
      ...(id === B
        ? { beforeRemove: { tool: 'retire_moss', arguments: { basket: 'cleanup' } } }
        : {}),
    },
    data: { schema: 1 },
  }
  const bytes = Buffer.from(JSON.stringify(manifest))
  const archive = tar([
    { path: 'plugin.json', body: bytes },
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
      manifestSha256: pluginSha256(bytes),
    },
  }
}

async function setup() {
  const packages = new Map([
    [A, genericPackage(A)],
    [B, genericPackage(B)],
  ])
  const mcpA = await pluginProviderFixture({ createBroker: false })
  closers.push(() => mcpA.close())
  const mcpB = await pluginProviderFixture({ createBroker: false })
  closers.push(() => mcpB.close())
  mcpA.setTools(packages.get(A)!.tools)
  mcpB.setTools(packages.get(B)!.tools)
  const entered = deferred<ReturnType<Fixture['state']['inspect']>['pending']>()
  const release = deferred<void>()
  releases.push(() => release.resolve())
  let held = false
  const stops: string[] = []
  const removeCode = vi.fn(async (id: string, digest: string) => {
    if (id !== B || digest !== packages.get(B)!.release.archive.sha256)
      throw new Error('Only the captured B package may reach removeCode')
    held = true
    entered.resolve(state.inspect().pending)
    await release.promise
    held = false
  })
  const runtime: LifecycleOptions['runtime'] = {
    previousOwnerClean: async () => true,
    removeCode,
    async start(spec) {
      const id = spec.package.manifest.id
      const client = id === A ? mcpA.client : mcpB.client
      const exit = deferred<void>()
      return {
        runId: randomUUID(),
        exited: exit.promise,
        async stop() {
          stops.push(id)
          exit.resolve()
        },
        async ready() {
          return {
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            client,
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
            admin: () => ({ url: '', headers: { Authorization: '' } }),
          }
        },
      }
    },
  }
  const f = await fixture(
    {
      catalogue: signed({ format: 1, entries: [...packages.values()].map((pkg) => pkg.release) }),
      download: async (selected) => packages.get(selected.id)!.archive,
      runtime,
    },
    false,
    A,
  )
  const state: Fixture['state'] = f.state
  await f.controller.detach(f.handle)
  const controller = sharedLifecycleWorkspaces(f.controller)
  closers.push(() => controller.drain())
  async function attach(sink: WorkspaceProjection) {
    // Register eventual handles before racing a deadline, so a delayed attachment is cleaned up.
    return bounded(
      controller.attach(sink).then((handle) => {
        closers.push(() => controller.detach(handle))
        return handle
      }),
      'consumer attachment while B is held',
    )
  }
  const person = await attach(f.local.sink)
  const other = projection()
  const otherPerson = await attach(other.sink)
  await controller.install(person, A)
  await controller.install(person, B)
  const initialA = f.state.currentInstallation(A)!
  const initialB = f.state.currentInstallation(B)!
  const bridge = createLifecycleAgentBridge({ owner: { valid: () => true }, controller })
  controller.bindGenericTools(bridge)
  closers.push(() => bridge.close())
  async function connect(workspaceId: string, id = A) {
    const lease: WorkspaceLease = {
      id: randomBytes(32).toString('hex'),
      workspace: 'a'.repeat(64),
      generation: randomUUID(),
      epoch: randomUUID(),
      counter: 0,
      renewedAt: 0,
      minor: 0,
      features: [],
    }
    const servers = await bounded(
      bridge.routes(lease, {
        kind: 'agent-routes',
        workspaceId,
        incarnation: randomUUID(),
        workspace: lease.workspace,
        generation: lease.generation,
        lease: lease.id,
        occupied: ['brobot'],
        release: false,
      }),
      'SDK route attachment',
    )
    const route = servers.find((one) => one.name === pluginProviderNamespace(id))
    expect(route, `${id} must have a current SDK route`).toBeDefined()
    const client = new Client({ name: 'fictional-attachment-provider', version: '1' })
    client.onerror = () => undefined
    closers.push(() => client.close())
    await bounded(
      client.connect(
        new StreamableHTTPClientTransport(new URL(route!.url), {
          requestInit: { headers: { Authorization: `Bearer ${route!.capability}` } },
        }),
      ),
      'SDK connect',
    )
    return client
  }
  async function usable(handle: LifecycleWorkspace, provider: Client, basket: string) {
    await expect(bounded(provider.listTools(), 'SDK tools/list')).resolves.toMatchObject({
      tools: packages.get(A)!.tools,
    })
    await expect(
      bounded(
        provider.callTool({
          name: gather.tool,
          arguments: { basket },
        }),
        'SDK tools/call',
      ),
    ).resolves.toHaveProperty('content')
    const contribution = controller.contributions(handle, A)
    expect(contribution.current()).toBe(true)
    expect(contribution.contributions.configuration).toMatchObject({
      page: { entry: 'configure.html' },
    })
    const snapshot = controller.hostSnapshot(handle)
    const button = snapshot.contributions.find(
      (one) => one.pluginId === A && one.kind === 'ui.button',
    )!
    expect(button).toMatchObject({ state: 'active', definition: { invoke: gather } })
    await expect(
      bounded(
        controller.hostUi(handle, {
          kind: 'activate',
          handle: button.handle,
        }),
        'contribution activation',
      ),
    ).resolves.toHaveProperty('value.content')
    const page = await bounded(controller.hostScreen(handle, A), 'Configure open')
    expect(page).toMatchObject({
      installation: initialA,
      instanceId: contribution.identity.runId,
      page: { entry: 'configure.html', assets: ['configure.html'] },
    })
    await expect(
      bounded(
        controller.hostPageTool(handle, {
          pluginId: A,
          instanceId: page.instanceId,
          contributionHandle: page.contributionHandle,
          viewId: page.viewId,
          name: gather.tool,
          arguments: { basket: `${basket}-configure` },
          requestId: randomUUID(),
        }),
        'Configure tool call',
      ),
    ).resolves.toMatchObject({ status: 'result', result: { content: expect.any(Array) } })
    await controller.hostUi(handle, { kind: 'settings-close', viewId: page.viewId })
    expect(mcpA.seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arguments: { basket },
          meta: expect.objectContaining({ origin: 'agent' }),
        }),
        expect.objectContaining({
          arguments: gather.arguments,
          meta: expect.objectContaining({ origin: 'ui.button' }),
        }),
        expect.objectContaining({
          arguments: { basket: `${basket}-configure` },
          meta: expect.objectContaining({ origin: 'settings.page' }),
        }),
      ]),
    )
  }
  function bUnavailable(handle: LifecycleWorkspace, workspaceId: string, bRun: string) {
    expect(
      controller.agentAttachments(workspaceId).map((one) => one.installation.pluginId),
    ).toEqual([A])
    expect(() => controller.contributions(handle, B)).toThrow()
    expect(() => controller.screen(handle, B)).toThrow()
    return expect(
      controller.genericListTools({ workspaceId, pluginId: B, instanceId: bRun }),
    ).rejects.toMatchObject({ code: 'disabled' })
  }
  const bRun = controller
    .agentAttachments(other.sink.workspaceId)
    .find((one) => one.installation.pluginId === B)!.runId
  async function holdB(run: () => Promise<void>) {
    const operationId = randomUUID()
    const removal = controller.uninstall(person, B, operationId).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    try {
      const pending = await bounded(
        Promise.race([
          entered.promise,
          removal.then(() => {
            throw new Error('B settled before prepared removeCode')
          }),
        ]),
        'prepared B removeCode marker',
      )
      expect(pending).toMatchObject({
        request: {
          operationId,
          consent: { action: 'uninstall', pluginId: B, expectedInstallId: initialB.installId },
        },
        next: { pluginId: B, installId: initialB.installId },
      })
      expect(stops).toEqual([B])
      expect(mcpB.seen).toMatchObject([
        { name: 'retire_moss', meta: { origin: 'lifecycle.beforeRemove', requestId: operationId } },
      ])
      expect(held).toBe(true)
      expect(f.state.currentInstallation(B)).toBeNull()
      await run()
      expect(held).toBe(true)
      expect(f.state.inspect().pending).toEqual(pending)
      expect(f.state.currentInstallation(A)).toEqual(initialA)
    } finally {
      release.resolve()
      await bounded(removal, 'released B removal settlement')
    }
    expect(await removal).toMatchObject({ ok: true, value: { data: 'kept', cleanup: 'completed' } })
    expect(removeCode).toHaveBeenCalledExactlyOnceWith(B, initialB.release.archiveSha256)
    expect(f.state.inspect().pending).toBeNull()
    expect(f.state.currentInstallation(B)).toBeNull()
  }
  return {
    f,
    controller,
    person,
    other,
    otherPerson,
    attach,
    connect,
    usable,
    bUnavailable,
    bRun,
    holdB,
  }
}

it.each(modes)(
  'admits fresh A SDK/Configure/contributions for a %s during held B removal',
  async (mode) => {
    const h = await setup()
    const fresh = projection()
    const sink =
      mode === 'new workspace'
        ? fresh.sink
        : { ...fresh.sink, workspaceId: h.f.local.sink.workspaceId }
    const applied = vi.spyOn(sink, 'applied')
    await h.holdB(async () => {
      // Neither this sink nor its provider existed before B entered durable removeCode.
      const handle = await h.attach(sink)
      const provider = await h.connect(sink.workspaceId)
      await h.usable(handle, provider, `fresh-${mode}`)
      expect(applied.mock.calls.some(([id, receipt]) => id === A && receipt !== null)).toBe(true)
      expect(applied.mock.calls.some(([id, receipt]) => id === B && receipt !== null)).toBe(false)
      await h.bUnavailable(handle, sink.workspaceId, h.bRun)
      await expect(h.controller.hostScreen(handle, B)).rejects.toBeDefined()
    })
  },
  15000,
)

it.each(modes)(
  'isolates a B sink failure and reconnect in a %s from A in another workspace',
  async (mode) => {
    const h = await setup()
    const provider = await h.connect(h.other.sink.workspaceId)
    const bProvider = await h.connect(h.other.sink.workspaceId, B)
    const originalView = h.controller
      .agentAttachments(h.other.sink.workspaceId)
      .find((one) => one.installation.pluginId === A)!
    const originalContribution = h.controller.contributions(h.otherPerson, A)
    const originalButton = h.controller
      .hostSnapshot(h.otherPerson)
      .contributions.find((one) => one.pluginId === A && one.kind === 'ui.button')!
    const originalPage = await h.controller.hostScreen(h.otherPerson, A)
    await h.usable(h.otherPerson, provider, 'before-B-failure')
    const fresh = projection()
    const workspaceId =
      mode === 'new workspace' ? fresh.sink.workspaceId : h.f.local.sink.workspaceId
    const failed = vi.fn(
      async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
        if (id === B) throw new Error('Fictional B-only consumer acknowledgement failure')
        await fresh.sink.applied(id, receipt)
      },
    )
    const sink: WorkspaceProjection = { ...fresh.sink, workspaceId, applied: failed }
    await h.holdB(async () => {
      // Persistent B failure also exercises attach's rollback proof; A callbacks all acknowledge.
      await expect(h.attach(sink)).rejects.toMatchObject({ code: 'cleanup-pending' })
      expect(failed.mock.calls.some(([id, receipt]) => id === A && receipt !== null)).toBe(true)
      expect(failed.mock.calls.some(([id]) => id === B)).toBe(true)
      expect(failed.mock.calls.some(([id, receipt]) => id === B && receipt !== null)).toBe(false)
      // Check old handles before a healthy reconnect could conceal global invalidation.
      expect(originalView.current()).toBe(true)
      expect(originalContribution.current()).toBe(true)
      expect(h.controller.hostSnapshot(h.otherPerson).contributions).toContainEqual(originalButton)
      await expect(
        bounded(
          h.controller.hostUi(h.otherPerson, { kind: 'activate', handle: originalButton.handle }),
          'original contribution after B failure',
        ),
      ).resolves.toHaveProperty('value.content')
      await expect(
        bounded(
          h.controller.hostPageTool(h.otherPerson, {
            pluginId: A,
            instanceId: originalPage.instanceId,
            contributionHandle: originalPage.contributionHandle,
            viewId: originalPage.viewId,
            name: gather.tool,
            arguments: { basket: 'original-Configure-after-B-failure' },
            requestId: randomUUID(),
          }),
          'original Configure after B failure',
        ),
      ).resolves.toMatchObject({ status: 'result' })
      await h.usable(h.otherPerson, provider, 'after-B-failure')
      await expect(bounded(bProvider.listTools(), 'old B SDK route')).rejects.toBeDefined()
      await h.bUnavailable(h.otherPerson, h.other.sink.workspaceId, h.bRun)
      // Failed sinks are removed from the shared group; a fresh consumer can acknowledge A.
      const recovered = projection()
      const reconnect = await h.attach({ ...recovered.sink, workspaceId })
      const reconnectedProvider = await h.connect(workspaceId)
      await h.usable(reconnect, reconnectedProvider, 'reconnected-during-B')
      expect(recovered.rows.has(B)).toBe(false)
      await h.bUnavailable(reconnect, workspaceId, h.bRun)
      expect(originalView.current()).toBe(true)
      expect(originalContribution.current()).toBe(true)
      await h.usable(h.otherPerson, provider, 'after-reconnect')
    })
  },
  15000,
)
