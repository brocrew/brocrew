import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

it('returns a fresh handle and drains while every positive consumer acknowledgement is stalled', async () => {
  const h = await setup()
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
  await expect(
    bounded(h.controller.drain(), 'drain without consumer replies'),
  ).resolves.toBeUndefined()
  const calls = applied.mock.calls.length
  release.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  expect(applied).toHaveBeenCalledTimes(calls)
  expect(applied.mock.calls.some(([, receipt]) => receipt !== null)).toBe(false)
  expect(writes.mock.calls.filter(([workspace]) => workspace === fresh.sink.workspaceId)).toEqual(
    [],
  )
  expect(h.controller.agentAttachments(fresh.sink.workspaceId)).toEqual([])
}, 15000)

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
  const snapshot = join(h.f.root, 'state', 'installed-state.json')
  const selected = await readFile(snapshot)
  await expect(h.controller.detach(handle)).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(a.current()).toBe(false)
  expect(h.controller.agentAttachments(fresh.sink.workspaceId)).toEqual([])
  expect((await h.controller.status()).cleanupPending).toContain(B)
  expect(h.controller.cleanForShutdown()).toBe(false)
  expect(await readFile(snapshot)).toEqual(selected)
  const attempts = revoke.mock.calls.length
  allowRevoke = true
  await expect(h.controller.detach(handle)).resolves.toBeUndefined()
  expect(revoke.mock.calls.slice(attempts)).toEqual([[B, install.installId]])
  expect((await h.controller.status()).cleanupPending).not.toContain(B)
  expect(h.controller.cleanForShutdown()).toBe(true)
  expect(originalA.current()).toBe(true)
  expect(originalB.current()).toBe(true)
  expect(await readFile(snapshot)).toEqual(selected)
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
    expect(() => h.controller.contributions(old, A)).toThrow()
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
    const snapshot = join(h.f.root, 'state', 'installed-state.json')
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
    expect(await readFile(snapshot)).toEqual(selected)
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
    expect(await readFile(snapshot)).toEqual(selected)
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
