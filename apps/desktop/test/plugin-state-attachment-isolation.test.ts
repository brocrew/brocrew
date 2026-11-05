import { snapshotPath } from './helpers/plugin-state-snapshot'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { PluginEffectQueue } from '../src/main/plugins/lifecycle/effect-queue'
import type { VerifiedPluginPackage } from '../src/main/plugins/package-verifier'
import type { Effect } from '../src/main/plugins/lifecycle/files'
import type {
  Installation,
  LifecycleOptions,
  LifecycleRun,
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
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'
import { signed, tar } from './plugin-package-fixtures'

const A = 'fictional-garden'
const B = 'fictional-moss'
const gather = { tool: 'gather_petals', arguments: { basket: 'contribution' } }
const modes = ['new workspace', 'new consumer'] as const
const coldRemovers = new Set<() => void>()
const coldCleanupFailures: unknown[] = []
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
  for (const stop of coldRemovers) {
    try {
      stop()
    } catch (error) {
      coldCleanupFailures.push(error)
    }
  }
  coldRemovers.clear()
  for (const release of releases.splice(0)) release()
  // Attempt every closer even if the regression invalidates a consumer or route.
  const failures: unknown[] = []
  failures.push(...coldCleanupFailures.splice(0))
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

async function setup(expectUnmarkedDrain = false) {
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
  closers.push(async () => {
    const draining = controller.drain()
    if (expectUnmarkedDrain) {
      await expect(draining).rejects.toMatchObject({ code: 'cleanup-pending' })
      expect(controller.cleanForShutdown()).toBe(false)
    } else await draining
  })
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
  async function ready(handle: LifecycleWorkspace, id: string) {
    return bounded(
      vi.waitFor(
        () => {
          const contribution = controller.contributions(handle, id)
          expect(contribution.current()).toBe(true)
          return contribution
        },
        { timeout: 2500, interval: 10 },
      ),
      `${id} acknowledged contribution`,
    )
  }
  const person = await attach(f.local.sink)
  const other = projection()
  const otherPerson = await attach(other.sink)
  await controller.install(person, A)
  await controller.install(person, B)
  // Immediate attachment is not acknowledgement of each installed plugin.
  await ready(person, A)
  await ready(otherPerson, A)
  await ready(person, B)
  await ready(otherPerson, B)
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
    const incarnation = randomUUID()
    const route = await bounded(
      vi.waitFor(
        async () => {
          const servers = await bridge.routes(lease, {
            kind: 'agent-routes',
            workspaceId,
            incarnation,
            workspace: lease.workspace,
            generation: lease.generation,
            lease: lease.id,
            occupied: ['brobot'],
            release: false,
          })
          const route = servers.find((one) => one.name === pluginProviderNamespace(id))
          expect(route, `${id} must have a current SDK route`).toBeDefined()
          return route!
        },
        { timeout: 2500, interval: 10 },
      ),
      'SDK route attachment',
    )
    const client = new Client({ name: 'fictional-attachment-provider', version: '1' })
    client.onerror = () => undefined
    closers.push(() => client.close())
    await bounded(
      client.connect(
        new StreamableHTTPClientTransport(new URL(route.url), {
          requestInit: { headers: { Authorization: `Bearer ${route.capability}` } },
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
    bridge,
    person,
    other,
    otherPerson,
    attach,
    ready,
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
      await h.ready(handle, A)
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
      const choices = [A, B].map((id) => h.f.state.getEnabled(workspaceId, id))
      // Acknowledged A remains live even though this consumer cannot acknowledge B.
      const partial = await h.attach(sink)
      await h.ready(partial, A)
      const partialProvider = await h.connect(workspaceId)
      await h.usable(partial, partialProvider, 'partial-A-despite-B-failure')
      await h.bUnavailable(partial, workspaceId, h.bRun)
      await expect(
        bounded(h.controller.hostScreen(partial, B), 'own pending B Configure'),
      ).rejects.toBeDefined()
      expect([A, B].map((id) => h.f.state.getEnabled(workspaceId, id))).toEqual(choices)
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
      // Detaching the partial consumer permits a healthy consumer to acknowledge A again.
      const partialContribution = h.controller.contributions(partial, A)
      const retainedA =
        mode === 'new consumer' ? h.controller.contributions(h.person, A) : undefined
      await bounded(h.controller.detach(partial), 'partial consumer detach')
      expect(partialContribution.current()).toBe(false)
      if (retainedA) {
        expect(retainedA.current()).toBe(true)
        await h.usable(h.person, partialProvider, 'retained-consumer-before-reconnect')
      }
      const recovered = projection()
      const reconnect = await h.attach({ ...recovered.sink, workspaceId })
      await h.ready(reconnect, A)
      const reconnectedProvider = await h.connect(workspaceId)
      await h.usable(reconnect, reconnectedProvider, 'reconnected-during-B')
      expect(recovered.rows.has(B)).toBe(false)
      await h.bUnavailable(reconnect, workspaceId, h.bRun)
      expect(originalView.current()).toBe(true)
      expect(originalContribution.current()).toBe(true)
      await h.usable(h.otherPerson, provider, 'after-reconnect')
      expect(partialContribution.current()).toBe(false)
      if (retainedA) expect(retainedA.current()).toBe(true)
    })
  },
  15000,
)

it.each(modes.flatMap((mode) => (['reconcile', 'applied'] as const).map((ack) => ({ mode, ack }))))(
  'returns usable A for a $mode while B $ack is held and abandons the detached B reply',
  async ({ mode, ack }) => {
    const h = await setup()
    const otherProvider = await h.connect(h.other.sink.workspaceId)
    const otherA = h.controller.contributions(h.otherPerson, A)
    const otherB = h.controller.contributions(h.otherPerson, B)
    const otherView = h.controller
      .agentAttachments(h.other.sink.workspaceId)
      .find((one) => one.installation.pluginId === A)!
    const fresh = projection()
    const workspaceId =
      mode === 'new workspace' ? fresh.sink.workspaceId : h.f.local.sink.workspaceId
    const choices = [A, B].map((id) => h.f.state.getEnabled(workspaceId, id))
    const entered = deferred<void>()
    const release = deferred<void>()
    const returned = deferred<void>()
    releases.push(() => release.resolve())
    let held = false
    async function hold() {
      held = true
      entered.resolve()
      await release.promise
      held = false
      returned.resolve()
    }
    const reconcile = vi.fn(async (change: Parameters<WorkspaceProjection['reconcile']>[0]) => {
      await fresh.sink.reconcile(change)
      if (ack === 'reconcile' && change.pluginId === B && change.receipt) await hold()
    })
    const applied = vi.fn(
      async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
        await fresh.sink.applied(id, receipt)
        // The consumer may have applied the row; its acknowledgement is still outstanding.
        if (ack === 'applied' && id === B && receipt) await hold()
      },
    )
    const sink: WorkspaceProjection = { ...fresh.sink, workspaceId, reconcile, applied }
    const attachment = h.attach(sink)
    // Keep a missing callback marker from leaving a separately rejected deadline unobserved.
    void attachment.catch(() => undefined)
    await bounded(entered.promise, 'positive B acknowledgement entered')
    const partial = await attachment
    await h.ready(partial, A)
    expect(held).toBe(true)
    expect(h.f.state.currentInstallation(B)).not.toBeNull()
    const bScope = { workspaceId, pluginId: B, instanceId: h.bRun }
    async function ownBUnavailable() {
      expect(() => h.controller.contributions(partial, B)).toThrow()
      expect(() => h.controller.screen(partial, B)).toThrow()
      await expect(
        bounded(h.controller.hostScreen(partial, B), 'own pending B Configure'),
      ).rejects.toBeDefined()
    }
    async function canonicalBReady() {
      await bounded(
        vi.waitFor(
          () => {
            const install = h.f.state.currentInstallation(B)!
            const receipt = h.f.state.projections(workspaceId).find((one) => one.pluginId === B)
            expect(receipt).toMatchObject({
              installId: install.installId,
              incarnation: install.incarnation,
              releaseRevision: install.releaseRevision,
              configRevision: install.configRevision,
            })
            expect(h.f.state.matchesProjection(receipt, workspaceId)).toBe(true)
            const view = h.controller
              .agentAttachments(workspaceId)
              .find((one) => one.installation.pluginId === B)
            expect(view?.current()).toBe(true)
            expect(view?.runId).toBe(h.bRun)
          },
          { timeout: 2500, interval: 10 },
        ),
        'exact canonical B receipt publication',
      )
      await expect(
        bounded(h.controller.genericListTools(bScope), 'canonical B callback tools'),
      ).resolves.toMatchObject([{ name: 'retire_moss' }])
    }
    // A pending Person acknowledgement is local. Without an exact healthy receipt,
    // the new workspace still has no B route; a retained healthy consumer already has one.
    await ownBUnavailable()
    if (mode === 'new workspace') {
      expect(h.f.state.projections(workspaceId).some((one) => one.pluginId === B)).toBe(false)
      expect(
        h.controller.agentAttachments(workspaceId).map((one) => one.installation.pluginId),
      ).toEqual([A])
      await expect(h.controller.genericListTools(bScope)).rejects.toMatchObject({
        code: 'disabled',
      })
    } else await canonicalBReady()
    const provider = await h.connect(workspaceId)
    await h.usable(partial, provider, `held-${ack}-${mode}`)
    const oldA = h.controller.contributions(partial, A)
    const oldView = h.controller
      .agentAttachments(workspaceId)
      .find((one) => one.installation.pluginId === A)!
    // This independent SDK consumer can acknowledge active B for the canonical workspace.
    await canonicalBReady()
    const healthyBProvider = await h.connect(workspaceId, B)
    await expect(
      bounded(healthyBProvider.listTools(), 'independent healthy B SDK'),
    ).resolves.toMatchObject({
      tools: [{ name: 'retire_moss' }],
    })
    await ownBUnavailable()
    expect([A, B].map((id) => h.f.state.getEnabled(workspaceId, id))).toEqual(choices)
    const positiveB = () => applied.mock.calls.filter(([id, receipt]) => id === B && receipt)
    expect(positiveB()).toHaveLength(ack === 'applied' ? 1 : 0)

    // An own-workspace A switch invalidates its old scopes while other workspaces stay live.
    await expect(
      bounded(h.controller.setEnabled(partial, A, false), 'own A off during held B'),
    ).resolves.toMatchObject({ enabled: false, revision: choices[0]!.revision + 1 })
    expect(oldA.current()).toBe(false)
    expect(oldView.current()).toBe(false)
    expect(() => h.controller.contributions(partial, A)).toThrow()
    await expect(bounded(provider.listTools(), 'disabled own A SDK')).rejects.toBeDefined()
    expect(otherA.current()).toBe(true)
    expect(otherView.current()).toBe(true)
    expect(otherB.current()).toBe(true)
    await h.usable(h.otherPerson, otherProvider, `other-during-${ack}`)
    await expect(
      bounded(h.controller.setEnabled(partial, A, true), 'own A on during held B'),
    ).resolves.toMatchObject({ enabled: true, revision: choices[0]!.revision + 2 })
    const enabledA = await h.ready(partial, A)
    const enabledProvider = await h.connect(workspaceId)
    await h.usable(partial, enabledProvider, `enabled-during-${ack}`)
    expect(oldA.current()).toBe(false)
    expect(oldView.current()).toBe(false)
    expect(held).toBe(true)
    await ownBUnavailable()

    const retainedA = mode === 'new consumer' ? h.controller.contributions(h.person, A) : undefined
    await bounded(h.controller.detach(partial), 'detach while B acknowledgement is held')
    expect(enabledA.current()).toBe(false)
    expect(() => h.controller.contributions(partial, A)).toThrow()
    if (retainedA) {
      expect(retainedA.current()).toBe(true)
      await h.usable(h.person, enabledProvider, `retained-consumer-before-${ack}-reconnect`)
    }
    const recovered = projection()
    await canonicalBReady()
    await expect(
      bounded(healthyBProvider.listTools(), 'retained B SDK before reconnect'),
    ).resolves.toMatchObject({
      tools: [{ name: 'retire_moss' }],
    })
    const reconnect = await h.attach({ ...recovered.sink, workspaceId })
    await h.ready(reconnect, A)
    const reconnectedProvider = await h.connect(workspaceId)
    await h.usable(reconnect, reconnectedProvider, `reconnected-before-${ack}-reply`)
    const readyA = h.controller.contributions(reconnect, A)
    const readyB = await h.ready(reconnect, B)
    const bProvider = await h.connect(workspaceId, B)
    await expect(bounded(bProvider.listTools(), 'reconnected B SDK')).resolves.toMatchObject({
      tools: [{ name: 'retire_moss' }],
    })
    expect(recovered.rows.has(B)).toBe(true)
    await bounded(h.controller.setEnabled(reconnect, B, false), 'own B off before late reply')
    expect(readyB.current()).toBe(false)
    await expect(bounded(bProvider.listTools(), 'disabled own B SDK')).rejects.toBeDefined()
    expect(readyA.current()).toBe(true)
    expect(otherB.current()).toBe(true)
    await bounded(h.controller.setEnabled(reconnect, B, true), 'own B on before late reply')
    const enabledB = await h.ready(reconnect, B)
    const enabledBProvider = await h.connect(workspaceId, B)
    await expect(
      bounded(enabledBProvider.listTools(), 'healthy B before late reply'),
    ).resolves.toMatchObject({
      tools: [{ name: 'retire_moss' }],
    })
    expect(enabledB.current()).toBe(true)
    expect(readyB.current()).toBe(false)
    expect(held).toBe(true)
    const projections = h.f.state.projections(workspaceId)
    const enabled = [A, B].map((id) => h.f.state.getEnabled(workspaceId, id))
    const reconciliations = reconcile.mock.calls.length
    const acknowledgements = applied.mock.calls.length
    // A stale same-value write would be invisible in the projection snapshot alone.
    const writes = vi.spyOn(h.f.state, 'recordProjection')

    release.resolve()
    await bounded(returned.promise, 'late B acknowledgement returned')
    // Let the abandoned consumer continuation run before checking for any late publication.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(reconcile).toHaveBeenCalledTimes(reconciliations)
    expect(applied).toHaveBeenCalledTimes(acknowledgements)
    expect(positiveB()).toHaveLength(ack === 'applied' ? 1 : 0)
    expect(
      writes.mock.calls.filter(([workspace, id]) => workspace === workspaceId && id === B),
    ).toHaveLength(0)
    expect(h.f.state.projections(workspaceId)).toEqual(projections)
    expect([A, B].map((id) => h.f.state.getEnabled(workspaceId, id))).toEqual(enabled)
    expect(oldA.current()).toBe(false)
    expect(oldView.current()).toBe(false)
    expect(enabledA.current()).toBe(false)
    expect(() => h.controller.contributions(partial, B)).toThrow()
    expect(readyA.current()).toBe(true)
    expect(readyB.current()).toBe(false)
    expect(enabledB.current()).toBe(true)
    expect(otherA.current()).toBe(true)
    expect(otherView.current()).toBe(true)
    expect(otherB.current()).toBe(true)
    if (retainedA) {
      expect(retainedA.current()).toBe(true)
      await h.usable(h.person, enabledProvider, `retained-consumer-after-late-${ack}-reply`)
    }
    await h.usable(reconnect, reconnectedProvider, `after-late-${ack}-reply`)
    await h.usable(h.otherPerson, otherProvider, `other-after-late-${ack}-reply`)
    await expect(bounded(provider.listTools(), 'old A SDK after late reply')).rejects.toBeDefined()
    await expect(bounded(bProvider.listTools(), 'old B SDK after late reply')).rejects.toBeDefined()
    await expect(
      bounded(enabledBProvider.listTools(), 'healthy B after late reply'),
    ).resolves.toMatchObject({
      tools: [{ name: 'retire_moss' }],
    })
  },
  20000,
)

it.each(['trusted', 'unmarked'] as const)(
  'returns a fresh handle and drains while every positive consumer acknowledgement is stalled (%s)',
  async (mode) => {
    const h = await setup(mode === 'unmarked')
    const fresh = projection()
    const release = deferred<void>()
    releases.push(() => release.resolve())
    const entered = new Set<string>()
    const reconcile = vi.fn(async (change: Parameters<WorkspaceProjection['reconcile']>[0]) => {
      if (change.receipt) {
        entered.add(change.pluginId)
        await release.promise
      }
      await fresh.sink.reconcile(change)
    })
    const applied = vi.fn(fresh.sink.applied)
    const writes = vi.spyOn(h.f.state, 'recordProjection')
    const handle = await h.attach({ ...fresh.sink, reconcile, applied })
    await vi.waitFor(() => expect([...entered].sort()).toEqual([A, B]))
    expect(h.controller.consumerBindings(handle).map((one) => one.state)).toEqual([
      'pending',
      'pending',
    ])
    expect(h.controller.agentAttachments(fresh.sink.workspaceId)).toEqual([])
    expect(() => h.controller.screen(handle, A)).toThrow()
    expect(() => h.controller.screen(handle, B)).toThrow()
    if (mode === 'trusted') {
      const agentClosing = h.bridge.close()
      h.controller.consumersEnded()
      await expect(
        bounded(
          Promise.all([h.controller.drain(), agentClosing]),
          'trusted drain without consumer replies',
        ),
      ).resolves.toEqual([undefined, undefined])
      expect(h.controller.cleanForShutdown()).toBe(true)
      expect(() => h.controller.hostWorkspace(handle)).toThrow()
    } else {
      await expect(
        bounded(h.controller.drain(), 'unmarked drain without consumer replies'),
      ).rejects.toMatchObject({ code: 'cleanup-pending' })
      expect(h.controller.cleanForShutdown()).toBe(false)
      expect((await h.controller.status()).cleanupPending).toEqual([A, B])
      expect(h.controller.hostWorkspace(handle)).toBe(fresh.sink.workspaceId)
    }
    for (const id of [A, B]) {
      expect(h.controller.admitted(handle, id, h.f.state.currentInstallation(id)!.installId)).toBe(
        false,
      )
      expect(() => h.controller.contributions(handle, id)).toThrow()
    }
    const calls = applied.mock.calls.length
    release.resolve()
    await new Promise((resolve) => setImmediate(resolve))
    expect(applied).toHaveBeenCalledTimes(calls)
    expect(applied.mock.calls.some(([, receipt]) => receipt !== null)).toBe(false)
    expect(writes.mock.calls.filter(([workspace]) => workspace === fresh.sink.workspaceId)).toEqual(
      [],
    )
    expect(h.controller.agentAttachments(fresh.sink.workspaceId)).toEqual([])
    for (const id of [A, B]) {
      expect(h.controller.admitted(handle, id, h.f.state.currentInstallation(id)!.installId)).toBe(
        false,
      )
      expect(() => h.controller.contributions(handle, id)).toThrow()
    }
    if (mode === 'trusted') {
      expect(h.controller.cleanForShutdown()).toBe(true)
      expect(() => h.controller.hostWorkspace(handle)).toThrow()
      expect((await h.controller.status()).cleanupPending).toEqual([])
    } else {
      expect(h.controller.cleanForShutdown()).toBe(false)
      expect((await h.controller.status()).cleanupPending).toEqual([A, B])
      expect(h.controller.hostWorkspace(handle)).toBe(fresh.sink.workspaceId)
    }
  },
  15000,
)

it('keeps a contribution handle stable within one consumer and distinct from healthy peers', async () => {
  const h = await setup()
  const original = h.controller.contributions(h.person, A)
  expect(h.controller.contributions(h.person, A)).toBe(original)
  const other = h.controller.contributions(h.otherPerson, A)
  expect(other).not.toBe(original)
  const fresh = projection()
  const shared = await h.attach({ ...fresh.sink, workspaceId: h.f.local.sink.workspaceId })
  const peer = await h.ready(shared, A)
  expect(peer).not.toBe(original)
  expect(h.controller.contributions(shared, A)).toBe(peer)
  expect(original.current()).toBe(true)
  peer.revoke()
  expect(peer.current()).toBe(false)
  expect(original.current()).toBe(true)
  const replacement = h.controller.contributions(shared, A)
  expect(replacement).not.toBe(peer)
  expect(h.controller.contributions(shared, A)).toBe(replacement)
  await h.controller.setEnabled(shared, A, false)
  expect(original.current()).toBe(false)
  expect(replacement.current()).toBe(false)
  expect(other.current()).toBe(true)
  await h.controller.setEnabled(shared, A, true)
  const enabled = await h.ready(h.person, A)
  expect(enabled).not.toBe(original)
  expect(h.controller.contributions(h.person, A)).toBe(enabled)
  await h.controller.detach(shared)
  expect(enabled.current()).toBe(true)
  expect(h.controller.contributions(h.person, A)).toBe(enabled)
}, 15000)

it('retains a failed partial-publication revoke after logical detach and retries the exact install', async () => {
  const h = await setup()
  const fresh = projection()
  const install = h.f.state.currentInstallation(B)!
  const originalA = h.controller.contributions(h.person, A)
  const originalB = h.controller.contributions(h.person, B)
  let published = false
  let allowRevoke = false
  const revoke = vi.fn(async (id: string, installId: string) => {
    if (id === B && published && !allowRevoke) return false
    return fresh.sink.revoke(id, installId)
  })
  const applied = vi.fn(
    async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
      await fresh.sink.applied(id, receipt)
      if (id === B && receipt) {
        published = true
        throw new Error('Fictional acknowledgement failure after positive publication')
      }
    },
  )
  const handle = await h.attach({ ...fresh.sink, revoke, applied })
  const a = await h.ready(handle, A)
  await vi.waitFor(() => {
    expect(published).toBe(true)
    expect(revoke.mock.calls.filter(([id]) => id === B).length).toBeGreaterThanOrEqual(2)
    expect(h.controller.consumerBindings(handle)).toContainEqual({ pluginId: B, state: 'failed' })
  })
  expect(fresh.rows.get(B)?.installId).toBe(install.installId)
  expect(h.f.state.projections(fresh.sink.workspaceId).some((one) => one.pluginId === B)).toBe(
    false,
  )
  const snapshot = snapshotPath(join(h.f.root, 'state'))
  const selected = await readFile(snapshot)
  await expect(h.controller.detach(handle)).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(a.current()).toBe(false)
  expect(h.controller.agentAttachments(fresh.sink.workspaceId)).toEqual([])
  expect((await h.controller.status()).cleanupPending).toContain(B)
  expect(h.controller.cleanForShutdown()).toBe(false)
  expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
  const attempts = revoke.mock.calls.length
  allowRevoke = true
  await expect(h.controller.detach(handle)).resolves.toBeUndefined()
  expect(revoke.mock.calls.slice(attempts)).toEqual([[B, install.installId]])
  expect((await h.controller.status()).cleanupPending).not.toContain(B)
  expect(h.controller.cleanForShutdown()).toBe(true)
  expect(originalA.current()).toBe(true)
  expect(originalB.current()).toBe(true)
  expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
}, 15000)

async function accepted(
  controller: Awaited<ReturnType<typeof setup>>['controller'],
  handle: LifecycleWorkspace,
  id: string,
  installId: string,
) {
  const workspaceId = controller.hostWorkspace(handle)
  const done = deferred<void>()
  const check = () => {
    if (controller.admitted(handle, id, installId)) done.resolve()
  }
  const unsubscribe = controller.onHostChanged((changed) => {
    if (changed === workspaceId) check()
  })
  try {
    check()
    await bounded(done.promise, 'exact consumer receipt acceptance')
  } finally {
    unsubscribe()
  }
}

it.each(['pending', 'failed'] as const)(
  'retains a published %s binding on detach before its acknowledgement and retries only its old origin',
  async (latch) => {
    const h = await setup()
    const install = h.f.state.currentInstallation(A)!
    const bInstall = h.f.state.currentInstallation(B)!
    const otherA = h.controller.contributions(h.otherPerson, A)
    const otherB = h.controller.contributions(h.otherPerson, B)
    const fresh = projection()
    const entered = deferred<void>(),
      hold = deferred<void>(),
      returned = deferred<void>()
    let published = false,
      allowRevoke = false
    releases.push(() => {
      allowRevoke = true
      hold.resolve()
    })
    const revoke = vi.fn(async (id: string, installId: string) => {
      if (id === A && published && !allowRevoke) {
        if (latch === 'failed') throw new Error('Fictional old-origin revoke failed')
        return false
      }
      const confirmed = await fresh.sink.revoke(id, installId)
      if (confirmed && id === A && published) fresh.rows.delete(id)
      return confirmed
    })
    const reconcile = vi.fn(fresh.sink.reconcile)
    const applied = vi.fn(
      async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
        await fresh.sink.applied(id, receipt)
        if (id === A && receipt) {
          published = true
          entered.resolve()
          await hold.promise
          returned.resolve()
        }
      },
    )
    const sink = { ...fresh.sink, revoke, reconcile, applied }
    const old = await h.attach(sink)
    await bounded(entered.promise, 'positive old-origin applied before acknowledgement')
    await accepted(h.controller, old, B, bInstall.installId)
    const oldB = h.controller.contributions(old, B)
    expect(oldB.current()).toBe(true)
    expect(fresh.rows.get(A)).toMatchObject({
      installId: install.installId,
      incarnation: install.incarnation,
    })
    expect(h.controller.consumerReceipts(old).some((one) => one.pluginId === A)).toBe(false)
    expect(h.controller.admitted(old, A, install.installId)).toBe(false)
    if (latch === 'failed') h.controller.cancelConsumer(old, sink)
    expect(h.controller.consumerBindings(old)).toContainEqual({ pluginId: A, state: latch })
    const beforeDetach = revoke.mock.calls.length
    await expect(h.controller.detach(old)).rejects.toMatchObject({ code: 'cleanup-pending' })
    expect(revoke.mock.calls.slice(beforeDetach)).toContainEqual([A, install.installId])
    expect(() => h.controller.hostWorkspace(old)).toThrow()
    expect(() => h.controller.contributions(old, A)).toThrow()
    expect(() => h.controller.contributions(old, B)).toThrow()
    expect(oldB.current()).toBe(false)
    expect(h.controller.cleanForShutdown()).toBe(false)
    expect((await h.controller.status()).cleanupPending).toContain(A)

    const next = projection()
    const nextRevoke = vi.fn(next.sink.revoke)
    const current = await h.attach({
      ...next.sink,
      workspaceId: sink.workspaceId,
      revoke: nextRevoke,
    })
    await accepted(h.controller, current, A, install.installId)
    await accepted(h.controller, current, B, bInstall.installId)
    const oldView = h.controller.contributions(current, A)
    await h.controller.setEnabled(current, A, false)
    expect(oldView.current()).toBe(false)
    await h.controller.setEnabled(current, A, true)
    const currentA = h.controller.contributions(current, A)
    const currentB = h.controller.contributions(current, B)
    expect(currentA.current()).toBe(true)
    expect(h.f.state.getEnabled(sink.workspaceId, A).revision).toBe(2)
    expect(
      h.controller.agentScope(sink.workspaceId).entries.find((one) => one.pluginId === A),
    ).toMatchObject({
      is: 'admitted',
      installId: install.installId,
      switchRevision: 2,
    })
    await expect(
      h.controller.genericCallTool({
        workspaceId: sink.workspaceId,
        pluginId: A,
        instanceId: currentA.identity.runId,
        name: gather.tool,
        arguments: gather.arguments,
        requestId: randomUUID(),
        origin: 'button',
      }),
    ).resolves.toHaveProperty('content')
    expect(h.controller.cleanForShutdown()).toBe(false)
    expect(fresh.rows.get(A)?.installId).toBe(install.installId)

    const data = join(h.f.root, 'data', A, 'opaque.keep')
    await mkdir(join(h.f.root, 'data', A), { recursive: true })
    await writeFile(data, 'Fictional retained old-origin data')
    const dataBefore = await readFile(data)
    const snapshot = snapshotPath(join(h.f.root, 'state'))
    const selected = await readFile(snapshot)
    const writes = vi.spyOn(h.f.state, 'recordProjection')
    const starts = vi.spyOn(h.f.opts.runtime, 'start')
    const removes = vi.spyOn(h.f.opts.runtime, 'removeCode')
    const oldCalls = {
      revoke: revoke.mock.calls.length,
      reconcile: reconcile.mock.calls.length,
      applied: applied.mock.calls.length,
    }
    const nextCalls = nextRevoke.mock.calls.length
    hold.resolve()
    await bounded(returned.promise, 'abandoned positive acknowledgement returned')
    // Flush the abandoned continuation once; this is not a readiness retry.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(() => h.controller.hostWorkspace(old)).toThrow()
    expect(() => h.controller.contributions(old, A)).toThrow()
    expect(() => h.controller.contributions(old, B)).toThrow()
    expect(oldB.current()).toBe(false)
    expect(revoke).toHaveBeenCalledTimes(oldCalls.revoke)
    expect(reconcile).toHaveBeenCalledTimes(oldCalls.reconcile)
    expect(applied).toHaveBeenCalledTimes(oldCalls.applied)
    expect(writes).not.toHaveBeenCalled()
    expect(starts).not.toHaveBeenCalled()
    expect(removes).not.toHaveBeenCalled()
    expect((await h.controller.status()).cleanupPending).toContain(A)
    expect(h.controller.cleanForShutdown()).toBe(false)
    expect(currentA.current()).toBe(true)
    expect(currentB.current()).toBe(true)
    expect(otherA.current()).toBe(true)
    expect(otherB.current()).toBe(true)
    expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
    expect(await readFile(data)).toEqual(dataBefore)

    allowRevoke = true
    const retry = revoke.mock.calls.length
    await expect(h.controller.detach(old)).resolves.toBeUndefined()
    expect(revoke.mock.calls.slice(retry)).toEqual([[A, install.installId]])
    expect(nextRevoke).toHaveBeenCalledTimes(nextCalls)
    expect(fresh.rows.has(A)).toBe(false)
    expect(next.rows.get(A)?.installId).toBe(install.installId)
    expect((await h.controller.status()).cleanupPending).not.toContain(A)
    expect(h.controller.cleanForShutdown()).toBe(true)
    expect(currentA.current()).toBe(true)
    expect(currentB.current()).toBe(true)
    expect(otherA.current()).toBe(true)
    expect(otherB.current()).toBe(true)
    expect(writes).not.toHaveBeenCalled()
    expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
    expect(await readFile(data)).toEqual(dataBefore)
  },
  15000,
)

it('a successful mutation handover does not create cancellation revoke debt for its superseded job', async () => {
  const h = await setup()
  const install = h.f.state.currentInstallation(A)!
  const operation = h.f.state
    .inspect()
    .operations.find((one) => one.status === 'completed' && one.operation.next?.pluginId === A)!
    .operation.request.operationId
  const fresh = projection()
  const entered = deferred<void>(),
    hold = deferred<void>(),
    returned = deferred<void>()
  releases.push(() => hold.resolve())
  let positives = 0
  const revoke = vi.fn(fresh.sink.revoke)
  const applied = vi.fn(
    async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
      await fresh.sink.applied(id, receipt)
      if (id === A && receipt && ++positives === 1) {
        entered.resolve()
        await hold.promise
        returned.resolve()
      }
    },
  )
  const handle = await h.attach({ ...fresh.sink, revoke, applied })
  await bounded(entered.promise, 'first mutation-target acknowledgement held')
  await accepted(h.controller, handle, B, h.f.state.currentInstallation(B)!.installId)
  const calls = revoke.mock.calls.filter(([id]) => id === A).length
  await h.controller.install(handle, A, operation)
  expect(fresh.rows.get(A)?.installId).toBe(install.installId)
  expect(h.controller.admitted(handle, A, install.installId)).toBe(true)
  expect(revoke.mock.calls.filter(([id]) => id === A)).toHaveLength(calls)
  expect(h.controller.cleanForShutdown()).toBe(true)
  expect((await h.controller.status()).cleanupPending).not.toContain(A)
  const contribution = h.controller.contributions(handle, A)
  const writes = vi.spyOn(h.f.state, 'recordProjection')
  hold.resolve()
  await bounded(returned.promise, 'superseded mutation acknowledgement returned')
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(writes).not.toHaveBeenCalled()
  expect(contribution.current()).toBe(true)
  expect(h.controller.cleanForShutdown()).toBe(true)
  expect(revoke.mock.calls.filter(([id]) => id === A)).toHaveLength(calls)
}, 15000)

it('retries two publishers of one install independently and never treats the old true as the new acknowledgement', async () => {
  const h = await setup()
  const install = h.f.state.currentInstallation(A)!
  const bInstall = h.f.state.currentInstallation(B)!
  const old = projection(),
    next = projection()
  let oldConfirmed = false,
    nextConfirmed = false,
    retiring = false
  const oldRevoke = vi.fn(async (id: string, installId: string) => {
    if (id === A && retiring && !oldConfirmed) return false
    const answer = await old.sink.revoke(id, installId)
    if (answer && id === A && retiring) old.rows.delete(id)
    return answer
  })
  const nextRevoke = vi.fn(async (id: string, installId: string) => {
    if (id === A && retiring && !nextConfirmed) return false
    const answer = await next.sink.revoke(id, installId)
    if (answer && id === A && retiring) next.rows.delete(id)
    return answer
  })
  releases.push(() => {
    oldConfirmed = true
    nextConfirmed = true
  })
  const handle = await h.attach({ ...old.sink, revoke: oldRevoke })
  await accepted(h.controller, handle, A, install.installId)
  await accepted(h.controller, handle, B, bInstall.installId)
  const publisher: WorkspaceProjection = {
    ...next.sink,
    workspaceId: old.sink.workspaceId,
    revoke: nextRevoke,
  }
  await h.controller.reconcileConsumer(handle, publisher)
  await accepted(h.controller, handle, A, install.installId)
  await accepted(h.controller, handle, B, bInstall.installId)
  expect(old.rows.get(A)?.installId).toBe(install.installId)
  expect(next.rows.get(A)?.installId).toBe(install.installId)
  expect(h.controller.admitted(handle, A, install.installId)).toBe(true)
  // Old publisher debt does not narrow this newly accepted consumer's admission.
  expect(h.controller.cleanForShutdown()).toBe(false)
  retiring = true
  const oldCalls = oldRevoke.mock.calls.length,
    nextCalls = nextRevoke.mock.calls.length
  await expect(h.controller.detach(handle)).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(oldRevoke.mock.calls.slice(oldCalls)).toContainEqual([A, install.installId])
  expect(nextRevoke.mock.calls.slice(nextCalls)).toContainEqual([A, install.installId])
  const snapshot = snapshotPath(join(h.f.root, 'state'))
  const selected = await readFile(snapshot)
  oldConfirmed = true
  const oldRetry = oldRevoke.mock.calls.length,
    nextRetry = nextRevoke.mock.calls.length
  await expect(h.controller.detach(handle)).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(oldRevoke.mock.calls.slice(oldRetry)).toEqual([[A, install.installId]])
  expect(nextRevoke.mock.calls.slice(nextRetry)).toEqual([[A, install.installId]])
  expect(old.rows.has(A)).toBe(false)
  expect(next.rows.get(A)?.installId).toBe(install.installId)
  expect(h.controller.cleanForShutdown()).toBe(false)
  expect((await h.controller.status()).cleanupPending).toContain(A)
  nextConfirmed = true
  const lastOld = oldRevoke.mock.calls.length,
    lastNext = nextRevoke.mock.calls.length
  await expect(h.controller.detach(handle)).resolves.toBeUndefined()
  expect(oldRevoke).toHaveBeenCalledTimes(lastOld)
  expect(nextRevoke.mock.calls.slice(lastNext)).toEqual([[A, install.installId]])
  expect(next.rows.has(A)).toBe(false)
  expect(h.controller.cleanForShutdown()).toBe(true)
  expect(h.controller.contributions(h.otherPerson, A).current()).toBe(true)
  expect(h.controller.contributions(h.otherPerson, B).current()).toBe(true)
  expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
}, 15000)

it.each(['false', 'held'] as const)(
  'global restart retains an alternate publisher with a %s revoke while its positive acknowledgement is held',
  async (mode) => {
    const h = await setup()
    const install = h.f.state.currentInstallation(A)!
    const beforeRun = h.controller.contributions(h.person, A)
    const peerB = h.controller.contributions(h.otherPerson, B)
    const local = projection()
    const handle = await h.attach(local.sink)
    await accepted(h.controller, handle, A, install.installId)
    await accepted(h.controller, handle, B, h.f.state.currentInstallation(B)!.installId)
    const alternate = projection()
    const entered = deferred<void>(),
      hold = deferred<void>(),
      returned = deferred<void>(),
      revokeHold = deferred<void>(),
      revokeReturned = deferred<void>()
    let published = false,
      confirmed = false
    releases.push(() => {
      confirmed = true
      hold.resolve()
      revokeHold.resolve()
    })
    const revoke = vi.fn(async (id: string, installId: string) => {
      if (id === A && published && !confirmed) {
        if (mode === 'held') await revokeHold.promise
        revokeReturned.resolve()
        return false
      }
      const result = await alternate.sink.revoke(id, installId)
      if (result && id === A && published) alternate.rows.delete(id)
      return result
    })
    const applied = vi.fn(
      async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
        await alternate.sink.applied(id, receipt)
        if (id === A && receipt) {
          published = true
          entered.resolve()
          await hold.promise
          returned.resolve()
        }
      },
    )
    const reconcile = vi.fn(alternate.sink.reconcile)
    await h.controller.reconcileConsumer(handle, {
      ...alternate.sink,
      workspaceId: local.sink.workspaceId,
      revoke,
      applied,
      reconcile,
    })
    await bounded(entered.promise, 'alternate publisher applied before global restart')
    await accepted(h.controller, handle, B, h.f.state.currentInstallation(B)!.installId)
    expect(alternate.rows.get(A)?.installId).toBe(install.installId)
    expect(h.controller.admitted(handle, A, install.installId)).toBe(false)
    const calls = revoke.mock.calls.length
    const stopped = vi.fn()
    await bounded(
      h.controller.restartPluginTools(A, beforeRun.identity.runId, stopped),
      'global restart with refusing alternate publisher',
    )
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(revoke.mock.calls.slice(calls)).toContainEqual([A, install.installId])
    expect((await h.controller.status()).cleanupPending).toContain(A)
    expect(h.controller.cleanForShutdown()).toBe(false)
    expect(alternate.rows.get(A)?.installId).toBe(install.installId)
    expect(beforeRun.current()).toBe(false)
    const replacement = h.controller.contributions(handle, A)
    expect(replacement.current()).toBe(true)
    expect(replacement.identity.runId).not.toBe(beforeRun.identity.runId)
    expect(peerB.current()).toBe(true)
    const snapshot = snapshotPath(join(h.f.root, 'state'))
    const selected = await readFile(snapshot)
    const writes = vi.spyOn(h.f.state, 'recordProjection')
    const oldCalls = [
      revoke.mock.calls.length,
      reconcile.mock.calls.length,
      applied.mock.calls.length,
    ]
    hold.resolve()
    await bounded(returned.promise, 'late alternate acknowledgement after global restart')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect([
      revoke.mock.calls.length,
      reconcile.mock.calls.length,
      applied.mock.calls.length,
    ]).toEqual(oldCalls)
    expect(writes).not.toHaveBeenCalled()
    expect((await h.controller.status()).cleanupPending).toContain(A)
    expect(replacement.current()).toBe(true)
    expect(peerB.current()).toBe(true)
    expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
    revokeHold.resolve()
    await bounded(revokeReturned.promise, 'old alternate revoke returned false')
    await expect(h.controller.detach(handle)).rejects.toMatchObject({ code: 'cleanup-pending' })
    confirmed = true
    const retry = revoke.mock.calls.length
    await expect(h.controller.detach(handle)).resolves.toBeUndefined()
    expect(revoke.mock.calls.slice(retry)).toEqual([[A, install.installId]])
    expect(alternate.rows.has(A)).toBe(false)
    expect(h.controller.contributions(h.person, A).current()).toBe(true)
    expect(peerB.current()).toBe(true)
    expect(h.controller.cleanForShutdown()).toBe(true)
    expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
  },
  15000,
)

it.each(['revoke', 'clear'] as const)(
  'an old publisher held in %s cannot clear a newer binding that reuses the same sink',
  async (boundary) => {
    const h = await setup()
    const install = h.f.state.currentInstallation(A)!
    const originalRun = h.controller.contributions(h.person, A)
    const local = projection()
    const handle = await h.attach(local.sink)
    await accepted(h.controller, handle, A, install.installId)
    await accepted(h.controller, handle, B, h.f.state.currentInstallation(B)!.installId)
    const alternate = projection()
    const positiveEntered = deferred<void>(),
      positiveHold = deferred<void>(),
      positiveReturned = deferred<void>(),
      cleanupEntered = deferred<void>(),
      cleanupHold = deferred<void>(),
      cleanupReturned = deferred<void>()
    let firstPositive = true,
      retiring = false,
      firstRevoke = true,
      firstClear = true
    releases.push(() => {
      positiveHold.resolve()
      cleanupHold.resolve()
    })
    const revoke = vi.fn(async (id: string, installId: string) => {
      const result = await alternate.sink.revoke(id, installId)
      if (id === A && retiring) {
        // The old revoke's side effect precedes its held acknowledgement.
        alternate.rows.delete(id)
        if (firstRevoke) {
          firstRevoke = false
          if (boundary === 'revoke') {
            cleanupEntered.resolve()
            await cleanupHold.promise
            cleanupReturned.resolve()
          }
        }
      }
      return result
    })
    const reconcile = vi.fn(async (change: Parameters<WorkspaceProjection['reconcile']>[0]) => {
      await alternate.sink.reconcile(change)
      if (change.pluginId === A && !change.receipt && retiring && firstClear) {
        firstClear = false
        if (boundary === 'clear') {
          await alternate.sink.applied(A, null)
          cleanupEntered.resolve()
          await cleanupHold.promise
          cleanupReturned.resolve()
        }
      }
    })
    const applied = vi.fn(
      async (id: string, receipt: Parameters<WorkspaceProjection['applied']>[1]) => {
        await alternate.sink.applied(id, receipt)
        if (id === A && receipt && firstPositive) {
          firstPositive = false
          positiveEntered.resolve()
          await positiveHold.promise
          positiveReturned.resolve()
        }
      },
    )
    const publisher: WorkspaceProjection = {
      ...alternate.sink,
      workspaceId: local.sink.workspaceId,
      revoke,
      reconcile,
      applied,
    }
    await h.controller.reconcileConsumer(handle, publisher)
    await bounded(positiveEntered.promise, 'old same-origin positive publication')
    await accepted(h.controller, handle, B, h.f.state.currentInstallation(B)!.installId)
    retiring = true
    await bounded(
      h.controller.restartPluginTools(A, originalRun.identity.runId, () => {}),
      'replacement before old same-origin cleanup acknowledgement',
    )
    await bounded(cleanupEntered.promise, 'old same-origin cleanup held after its side effect')
    expect(alternate.rows.has(A)).toBe(false)
    await h.controller.reconcileConsumer(handle, publisher)
    await accepted(h.controller, handle, A, install.installId)
    const replacement = h.controller.contributions(handle, A)
    const newRow = alternate.rows.get(A)!
    expect(newRow.installId).toBe(install.installId)
    expect(replacement.identity.runId).not.toBe(originalRun.identity.runId)
    expect(replacement.current()).toBe(true)
    const snapshot = snapshotPath(join(h.f.root, 'state'))
    const selected = await readFile(snapshot)
    const writes = vi.spyOn(h.f.state, 'recordProjection')
    const callbacks = [reconcile.mock.calls.length, applied.mock.calls.length]
    cleanupHold.resolve()
    positiveHold.resolve()
    await bounded(cleanupReturned.promise, 'old same-origin cleanup returned')
    await bounded(positiveReturned.promise, 'old same-origin positive acknowledgement returned')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect([reconcile.mock.calls.length, applied.mock.calls.length]).toEqual(callbacks)
    expect(writes).not.toHaveBeenCalled()
    expect(alternate.rows.get(A)).toBe(newRow)
    expect(h.controller.admitted(handle, A, install.installId)).toBe(true)
    expect(replacement.current()).toBe(true)
    expect(h.controller.contributions(h.otherPerson, B).current()).toBe(true)
    expect(await readFile(snapshotPath(join(h.f.root, 'state')))).toEqual(selected)
    await h.controller.detach(handle)
    expect(h.controller.cleanForShutdown()).toBe(true)
  },
  15000,
)

// These controls model allocation, readiness and exact exits without launching a package process.
function coldModel(
  options: {
    allocation?: 'held'
    readiness?: 'held'
    stop?: 'held'
    exit?: 'held'
    error?: Error
  } = {},
) {
  const allocation = deferred<void>(),
    readiness = deferred<void>(),
    stopReply = deferred<void>()
  const exited = deferred<void>(),
    entered = deferred<void>(),
    readyEntered = deferred<void>()
  const stopEntered = deferred<void>()
  if (!options.allocation) allocation.resolve()
  if (!options.readiness) readiness.resolve()
  if (!options.stop) stopReply.resolve()
  releases.push(() => {
    allocation.resolve()
    readiness.resolve()
    stopReply.resolve()
  })
  const connection: Awaited<ReturnType<LifecycleRun['ready']>> = {
    serverPid: 404941,
    origin: 'http://127.0.0.1:1',
    mcp: () => ({ url: '', headers: { Authorization: '' } }),
  }
  const ready = vi.fn(async () => {
    readyEntered.resolve()
    await readiness.promise
    if (options.error) throw options.error
    return connection
  })
  const stop = vi.fn(async () => {
    stopEntered.resolve()
    await stopReply.promise
    if (!options.exit) exited.resolve()
  })
  const run: LifecycleRun = { runId: randomUUID(), ready, stop, exited: exited.promise }
  const start = vi.fn(async () => {
    entered.resolve()
    await allocation.promise
    return run
  })
  return {
    allocation,
    readiness,
    stopReply,
    exited,
    entered,
    readyEntered,
    stopEntered,
    run,
    ready,
    stop,
    start,
  }
}
type ColdModel = ReturnType<typeof coldModel>
type WorkOutcome<T> = { is: 'fulfilled'; value: T } | { is: 'rejected'; error: unknown }
function observedOutcome<T>(work: Promise<T>): Promise<WorkOutcome<T>> {
  return work.then(
    (value): WorkOutcome<T> => ({ is: 'fulfilled', value }),
    (error: unknown): WorkOutcome<T> => ({ is: 'rejected', error }),
  )
}
async function regressionController(models: ColdModel[], holdDownload = false) {
  const pkg = genericPackage(A),
    seed = coldModel()
  const seedRuntime: LifecycleOptions['runtime'] = {
    start: seed.start,
    previousOwnerClean: async () => true,
    removeCode: async () => {},
  }
  const f = await fixture(
    {
      catalogue: signed({ format: 1, entries: [pkg.release] }),
      download: async () => pkg.archive,
      runtime: seedRuntime,
    },
    false,
    A,
  )
  let seeded = false
  const closeSeed = async () => {
    if (seeded) return
    try {
      await f.controller.detach(f.handle)
    } finally {
      await f.controller.drain()
    }
    seeded = true
  }
  closers.push(closeSeed)
  await f.controller.install(f.handle, A)
  const selected = f.state.currentInstallation(A)!
  const data = join(f.root, 'host', 'data', A, 'cold-regression.bin')
  const bytes = Buffer.from([0, 255, 71, 128])
  await mkdir(join(f.root, 'host', 'data', A), { recursive: true })
  await writeFile(data, bytes)
  await closeSeed()
  await seed.exited.promise
  expect(seed.start).toHaveBeenCalledOnce()
  expect(seed.stop).toHaveBeenCalledOnce()
  expect(f.controller.cleanForShutdown()).toBe(true)
  const state = reopenLifecycleFixture(f),
    queue = new PluginEffectQueue()
  const downloadEntered = deferred<void>(),
    downloadReturn = deferred<void>()
  if (!holdDownload) downloadReturn.resolve()
  releases.push(() => downloadReturn.resolve())
  let next = 0
  const start: LifecycleOptions['runtime']['start'] = vi.fn(async () => {
    const model = models[next++]
    if (!model) throw new Error('Unexpected fictional runtime allocation')
    return model.start()
  })
  const controller = await PluginLifecycleController.open({
    ...f.opts,
    state,
    effectQueue: queue,
    runtime: { ...seedRuntime, start },
    download: async () => {
      downloadEntered.resolve()
      await downloadReturn.promise
      return pkg.archive
    },
  })
  closers.push(async () => {
    controller.beginDrain()
    for (const model of models) model.exited.resolve()
    await controller.drain()
  })
  const workspaces: string[] = []
  async function attach(sink: WorkspaceProjection) {
    const handle = await controller.attach(sink)
    workspaces.push(sink.workspaceId)
    closers.push(() => controller.detach(handle))
    return handle
  }
  return {
    controller,
    queue,
    workspaces,
    state,
    selected,
    root: f.root,
    data,
    bytes,
    start,
    attach,
    downloadEntered,
    downloadReturn,
  }
}

type Acquisition = (
  id: string,
  install: Installation,
  checked: VerifiedPluginPackage,
) => Promise<LifecycleRun>
interface AcquisitionCall {
  receiver: PluginLifecycleController
  args: Parameters<Acquisition>
  work?: Promise<LifecycleRun>
  outcome: Promise<WorkOutcome<LifecycleRun>>
}
function observeAcquisition(controller: PluginLifecycleController) {
  const name = 'acquireBindingRun'
  const descriptor = Object.getOwnPropertyDescriptor(controller, name)
  const original: Acquisition = Reflect.get(controller, name)
  const calls: AcquisitionCall[] = []
  const listeners = new Set<(call: AcquisitionCall) => void>()
  const observer = vi.fn<Acquisition>(function (this: PluginLifecycleController, ...args) {
    let work: Promise<LifecycleRun>
    try {
      work = original.apply(this, args)
    } catch (error) {
      const call: AcquisitionCall = {
        receiver: this,
        args,
        outcome: Promise.resolve({ is: 'rejected', error }),
      }
      calls.push(call)
      for (const listener of listeners) listener(call)
      throw error
    }
    const call: AcquisitionCall = { receiver: this, args, work, outcome: observedOutcome(work) }
    calls.push(call)
    for (const listener of listeners) listener(call)
    return work
  })
  expect(Reflect.set(controller, name, observer)).toBe(true)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    listeners.clear()
    coldRemovers.delete(stop)
    if (descriptor) Object.defineProperty(controller, name, descriptor)
    else if (!Reflect.deleteProperty(controller, name))
      throw new Error('Acquisition observer restoration failed')
  }
  coldRemovers.add(stop)
  function next() {
    const returned = deferred<AcquisitionCall>()
    const receive = (call: AcquisitionCall) => returned.resolve(call)
    listeners.add(receive)
    const remove = () => {
      listeners.delete(receive)
      coldRemovers.delete(remove)
    }
    coldRemovers.add(remove)
    return { work: returned.promise, stop: remove }
  }
  return { calls, observer, next, stop }
}
function terminalConsumer(controller: PluginLifecycleController, workspaceId: string) {
  let handle: LifecycleWorkspace | undefined
  const terminal = deferred<'ready' | 'failed' | { error: unknown }>()
  const check = () => {
    if (!handle) return
    try {
      const binding = controller.consumerBindings(handle).find((one) => one.pluginId === A)
      if (binding?.state === 'ready' || binding?.state === 'failed') terminal.resolve(binding.state)
    } catch (error) {
      terminal.resolve({ error })
    }
  }
  const remove = controller.onHostChanged((changed) => {
    if (changed === workspaceId) check()
  })
  const stop = () => {
    remove()
    coldRemovers.delete(stop)
  }
  coldRemovers.add(stop)
  return {
    work: terminal.promise,
    capture(value: LifecycleWorkspace) {
      handle = value
      check()
    },
    stop,
  }
}
async function coldPair(h: Awaited<ReturnType<typeof regressionController>>, model: ColdModel) {
  const observation = observeAcquisition(h.controller)
  const first = projection(),
    second = projection()
  expect(first.sink.workspaceId).not.toBe(second.sink.workspaceId)
  const firstTerminal = terminalConsumer(h.controller, first.sink.workspaceId)
  const terminals = [firstTerminal]
  const a = await h.attach(first.sink)
  firstTerminal.capture(a)
  await model.entered.promise
  return {
    observation,
    first,
    second,
    a,
    firstTerminal,
    stop() {
      for (const terminal of terminals) terminal.stop()
      observation.stop()
    },
    async overlap() {
      const returned = observation.next()
      const terminal = terminalConsumer(h.controller, second.sink.workspaceId)
      terminals.push(terminal)
      const decision = Promise.race([
        returned.work.then((call) => ({ is: 'returned' as const, call })),
        terminal.work.then((state) => ({ is: 'terminal' as const, state })),
      ])
      const b = await h.attach(second.sink)
      terminal.capture(b)
      const result = await decision
      returned.stop()
      return { b, terminal, result }
    },
  }
}
function ownFacts(h: Awaited<ReturnType<typeof regressionController>>, handle: LifecycleWorkspace) {
  const workspace = h.controller.hostWorkspace(handle)
  const scope = h.controller.agentScope(workspace).entries.find((one) => one.pluginId === A)
  return {
    admitted: h.controller.admitted(handle, A, h.selected.installId),
    receipts: h.controller.consumerReceipts(handle),
    canonical: scope?.is,
    current: scope?.is === 'admitted' && scope.view.current(),
  }
}
function assertOwnReady(
  h: Awaited<ReturnType<typeof regressionController>>,
  handle: LifecycleWorkspace,
) {
  expect(ownFacts(h, handle)).toEqual({
    admitted: true,
    receipts: [{ pluginId: A, installId: h.selected.installId }],
    canonical: 'admitted',
    current: true,
  })
}
async function assertColdDurable(h: Awaited<ReturnType<typeof regressionController>>) {
  expect(h.state.currentInstallation(A)).toEqual(h.selected)
  for (const workspace of h.workspaces)
    expect(h.state.getEnabled(workspace, A)).toEqual({ enabled: true, revision: 0 })
  expect(await readFile(h.data)).toEqual(h.bytes)
}

it('gives both own consumers receipts after overlapping one cold allocation', async () => {
  const model = coldModel({ allocation: 'held' }),
    h = await regressionController([model])
  const pair = await coldPair(h, model)
  try {
    const other = await pair.overlap()
    expect(other.result.is).toBe('returned')
    model.allocation.resolve()
    expect(await Promise.all([pair.firstTerminal.work, other.terminal.work])).toEqual([
      'ready',
      'ready',
    ])
    expect(pair.observation.calls).toHaveLength(2)
    expect(pair.observation.calls[0]!.work).toBe(pair.observation.calls[1]!.work)
    assertOwnReady(h, pair.a)
    assertOwnReady(h, other.b)
    expect(h.start).toHaveBeenCalledOnce()
    expect(model.ready).toHaveBeenCalledOnce()
    assertAcquisitionIdentity(h, pair.observation)
    await assertColdDurable(h)
  } finally {
    model.allocation.resolve()
    pair.stop()
  }
})

it('joins pending readiness even after the cold run has been registered', async () => {
  const model = coldModel({ readiness: 'held' }),
    h = await regressionController([model])
  const pair = await coldPair(h, model)
  try {
    await model.readyEntered.promise
    const other = await pair.overlap()
    expect(other.result.is).toBe('returned')
    expect(h.controller.admitted(other.b, A, h.selected.installId)).toBe(false)
    expect(h.controller.consumerReceipts(other.b)).toEqual([])
    model.readiness.resolve()
    expect(await Promise.all([pair.firstTerminal.work, other.terminal.work])).toEqual([
      'ready',
      'ready',
    ])
    expect(pair.observation.calls[0]!.work).toBe(pair.observation.calls[1]!.work)
    assertOwnReady(h, pair.a)
    assertOwnReady(h, other.b)
    expect(h.start).toHaveBeenCalledOnce()
    expect(model.ready).toHaveBeenCalledOnce()
    assertAcquisitionIdentity(h, pair.observation)
    await assertColdDurable(h)
  } finally {
    model.readiness.resolve()
    pair.stop()
  }
})

it('shares the original readiness rejection without publishing either own receipt', async () => {
  const failure = new Error('Fictional shared readiness rejection')
  const model = coldModel({ allocation: 'held', error: failure }),
    h = await regressionController([model])
  const pair = await coldPair(h, model)
  try {
    const other = await pair.overlap()
    expect(other.result.is).toBe('returned')
    model.allocation.resolve()
    await model.readyEntered.promise
    expect(await Promise.all([pair.firstTerminal.work, other.terminal.work])).toEqual([
      'failed',
      'failed',
    ])
    expect(pair.observation.calls).toHaveLength(2)
    for (const call of pair.observation.calls) {
      const outcome = await call.outcome
      expect(outcome.is).toBe('rejected')
      if (outcome.is === 'rejected') expect(outcome.error).toBe(failure)
    }
    expect(pair.observation.calls[0]!.work).toBe(pair.observation.calls[1]!.work)
    for (const handle of [pair.a, other.b]) {
      expect(h.controller.admitted(handle, A, h.selected.installId)).toBe(false)
      expect(h.controller.consumerReceipts(handle)).toEqual([])
    }
    expect(h.start).toHaveBeenCalledOnce()
    expect(model.ready).toHaveBeenCalledOnce()
    assertAcquisitionIdentity(h, pair.observation)
    await assertColdDurable(h)
  } finally {
    model.allocation.resolve()
    pair.stop()
  }
})

it('cancels one waiting consumer without cancelling another own cold admission', async () => {
  const model = coldModel({ allocation: 'held' }),
    h = await regressionController([model])
  const pair = await coldPair(h, model)
  const positive = vi.spyOn(pair.first.sink, 'applied')
  try {
    const other = await pair.overlap()
    expect(other.result.is).toBe('returned')
    await h.controller.detach(pair.a)
    const before = positive.mock.calls.filter(([, receipt]) => receipt !== null).length
    expect(before).toBe(0)
    pair.firstTerminal.stop()
    model.allocation.resolve()
    expect(await other.terminal.work).toBe('ready')
    assertOwnReady(h, other.b)
    expect(positive.mock.calls.filter(([, receipt]) => receipt !== null)).toHaveLength(before)
    expect(h.controller.admitted(pair.a, A, h.selected.installId)).toBe(false)
    expect(h.start).toHaveBeenCalledOnce()
    expect(model.stop).not.toHaveBeenCalled()
    assertAcquisitionIdentity(h, pair.observation)
    await assertColdDurable(h)
  } finally {
    model.allocation.resolve()
    pair.stop()
  }
})

type EnsureRun = (
  install: Installation,
  checked: VerifiedPluginPackage,
  previous?: Pick<Effect, 'previousVersion' | 'previousDataSchema'>,
) => Promise<LifecycleRun>
function observeEnsureRun(controller: PluginLifecycleController) {
  const name = 'ensureRunning',
    descriptor = Object.getOwnPropertyDescriptor(controller, name)
  const original: EnsureRun = Reflect.get(controller, name)
  const observer = vi.fn<EnsureRun>(function (this: PluginLifecycleController, ...args) {
    return original.apply(this, args)
  })
  expect(Reflect.set(controller, name, observer)).toBe(true)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    coldRemovers.delete(stop)
    if (descriptor) Object.defineProperty(controller, name, descriptor)
    else if (!Reflect.deleteProperty(controller, name))
      throw new Error('Run observer restoration failed')
  }
  coldRemovers.add(stop)
  return { observer, stop }
}
function observeColdQueue(queue: PluginEffectQueue) {
  const original = queue.restart.bind(queue)
  const calls: {
    target: string
    work: Promise<unknown>
    outcome: Promise<WorkOutcome<unknown>>
  }[] = []
  const observer = vi.spyOn(queue, 'restart').mockImplementation(function <T>(
    this: PluginEffectQueue,
    target: string,
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const work = original(target, operation, run)
    calls.push({ target, work, outcome: observedOutcome(work) })
    return work
  })
  const stop = () => {
    observer.mockRestore()
    coldRemovers.delete(stop)
  }
  coldRemovers.add(stop)
  return { calls, observer, stop }
}
function assertAcquisitionIdentity(
  h: Awaited<ReturnType<typeof regressionController>>,
  observation: ReturnType<typeof observeAcquisition>,
) {
  for (const [index, call] of observation.calls.entries()) {
    expect(call.receiver).toBe(h.controller)
    expect(call.args[0]).toBe(A)
    expect(call.args[1].pluginId).toBe(A)
    expect(call.args[1].installId).toBe(h.selected.installId)
    expect(call.args[1].incarnation).toBe(h.selected.incarnation)
    if (call.work) expect(observation.observer.mock.results[index]?.value).toBe(call.work)
  }
}

it('refuses a stale blocked acquisition before another restart and preserves the queued update', async () => {
  const old = coldModel({ allocation: 'held' }),
    replacement = coldModel()
  const h = await regressionController([old, replacement], true)
  const queue = observeColdQueue(h.queue),
    ensuring = observeEnsureRun(h.controller)
  const pair = await coldPair(h, old)
  const positives = [pair.first, pair.second].map((one) => vi.spyOn(one.sink, 'applied'))
  let updateOutcome: Promise<WorkOutcome<void>> | undefined
  let removeThird: (() => void) | undefined
  try {
    const other = await pair.overlap()
    expect(other.result.is).toBe('returned')
    const restartsBeforeC = queue.calls.length
    const ensuresBeforeC = ensuring.observer.mock.calls.length
    const update = h.controller.update(pair.a, A, randomUUID())
    updateOutcome = observedOutcome(update)
    const settleUpdate = updateOutcome
    closers.push(async () => {
      const outcome = await settleUpdate
      if (outcome.is === 'rejected') throw outcome.error
    })
    const third = projection(),
      returned = pair.observation.next()
    const thirdTerminal = terminalConsumer(h.controller, third.sink.workspaceId)
    removeThird = thirdTerminal.stop
    const c = await h.attach(third.sink)
    thirdTerminal.capture(c)
    const decision = await returned.work
    returned.stop()
    expect(decision.work).not.toBe(pair.observation.calls[0]!.work)
    expect(queue.calls).toHaveLength(restartsBeforeC)
    expect(ensuring.observer).toHaveBeenCalledTimes(ensuresBeforeC)
    const refused = await decision.outcome
    expect(refused.is).toBe('rejected')
    if (refused.is === 'rejected') expect(refused.error).toMatchObject({ code: 'cleanup-pending' })
    expect(h.start).toHaveBeenCalledOnce()
    expect(old.ready).not.toHaveBeenCalled()
    old.allocation.resolve()
    await h.downloadEntered.promise
    const oldQueueResult = await queue.calls[0]!.outcome
    const oldResults = await Promise.all(
      pair.observation.calls.slice(0, 2).map((call) => call.outcome),
    )
    expect(oldResults).toHaveLength(2)
    for (const outcome of [oldQueueResult, ...oldResults]) {
      if (outcome.is === 'fulfilled') expect(outcome.value).toBe(old.run)
      else expect(outcome.error).toMatchObject({ code: 'cleanup-pending' })
    }
    expect(
      await Promise.all([pair.firstTerminal.work, other.terminal.work, thirdTerminal.work]),
    ).toEqual(['failed', 'failed', 'failed'])
    for (const handle of [pair.a, other.b, c]) {
      expect(h.controller.admitted(handle, A, h.selected.installId)).toBe(false)
      expect(h.controller.consumerReceipts(handle)).toEqual([])
    }
    for (const positive of positives)
      expect(
        positive.mock.calls.filter(([, receipt]) => receipt?.installId === h.selected.installId),
      ).toEqual([])
    expect(h.start).toHaveBeenCalledOnce()
    expect(replacement.start).not.toHaveBeenCalled()
    await assertColdDurable(h)
    assertAcquisitionIdentity(h, pair.observation)
    h.downloadReturn.resolve()
    expect(await updateOutcome).toEqual({ is: 'fulfilled', value: undefined })
    expect(h.state.currentInstallation(A)?.installId).toBe(h.selected.installId)
    expect(h.state.currentInstallation(A)?.incarnation).not.toBe(h.selected.incarnation)
    expect(await readFile(h.data)).toEqual(h.bytes)
    expect(h.start).toHaveBeenCalledTimes(2)
    expect(old.stop).toHaveBeenCalledOnce()
    await old.exited.promise
    expect(replacement.start).toHaveBeenCalledOnce()
  } finally {
    old.allocation.resolve()
    h.downloadReturn.resolve()
    if (updateOutcome) {
      const outcome = await updateOutcome
      if (outcome.is === 'rejected') coldCleanupFailures.push(outcome.error)
    }
    removeThird?.()
    ensuring.stop()
    queue.stop()
    pair.stop()
  }
})

it.each(['effect first', 'exit first'] as const)(
  'drains a joined late allocation with independent exact proof barriers: %s',
  async (order) => {
    const model = coldModel({ allocation: 'held', stop: 'held', exit: 'held' })
    const h = await regressionController([model]),
      pair = await coldPair(h, model)
    const effectReturn = deferred<void>(),
      effectEntered = deferred<void>()
    releases.push(() => effectReturn.resolve())
    let draining: Promise<WorkOutcome<void>> | undefined
    try {
      const other = await pair.overlap()
      expect(other.result.is).toBe('returned')
      const write = h.queue.stage(async () => {
        await writeFile(join(h.root, 'cold-stage-effect.bin'), Buffer.from([17, 0, 255]))
        effectEntered.resolve()
        await effectReturn.promise
      })
      const staged = observedOutcome(write)
      await effectEntered.promise
      await h.controller.detach(pair.a)
      await h.controller.detach(other.b)
      pair.firstTerminal.stop()
      other.terminal.stop()
      let finished = false
      const drain = h.controller.drain()
      draining = observedOutcome(drain)
      void drain.then(
        () => {
          finished = true
        },
        () => {
          finished = true
        },
      )
      model.allocation.resolve()
      await model.stopEntered.promise
      // Stop is not allowed to mask either independent exit/effect necessity check.
      model.stopReply.resolve()
      expect(await model.stop.mock.results[0]!.value).toBeUndefined()
      expect(model.stop).toHaveBeenCalledOnce()
      const acquired = await Promise.all(pair.observation.calls.map((call) => call.outcome))
      for (const outcome of acquired) {
        expect(outcome.is).toBe('rejected')
        if (outcome.is === 'rejected')
          expect(outcome.error).toMatchObject({ code: 'cleanup-pending' })
      }
      expect(finished).toBe(false)
      expect(h.controller.cleanForShutdown()).toBe(false)
      if (order === 'effect first') {
        effectReturn.resolve()
        expect(await staged).toEqual({ is: 'fulfilled', value: undefined })
        expect(h.queue.idle).toBe(true)
        expect(finished).toBe(false)
        expect(h.controller.cleanForShutdown()).toBe(false)
        model.exited.resolve()
      } else {
        model.exited.resolve()
        await model.exited.promise
        expect(h.queue.idle).toBe(false)
        expect(finished).toBe(false)
        expect(h.controller.cleanForShutdown()).toBe(false)
        effectReturn.resolve()
      }
      expect(await draining).toEqual({ is: 'fulfilled', value: undefined })
      expect(await staged).toEqual({ is: 'fulfilled', value: undefined })
      expect(h.controller.cleanForShutdown()).toBe(true)
      expect(h.start).toHaveBeenCalledOnce()
      expect(model.ready).not.toHaveBeenCalled()
      expect(pair.first.rows.has(A)).toBe(false)
      expect(pair.second.rows.has(A)).toBe(false)
      expect(pair.observation.calls[0]!.work).toBe(pair.observation.calls[1]!.work)
      assertAcquisitionIdentity(h, pair.observation)
      await assertColdDurable(h)
    } finally {
      h.controller.beginDrain()
      model.allocation.resolve()
      model.stopReply.resolve()
      model.exited.resolve()
      effectReturn.resolve()
      if (draining) {
        const outcome = await draining
        if (outcome.is === 'rejected') coldCleanupFailures.push(outcome.error)
      }
      pair.stop()
    }
  },
)
