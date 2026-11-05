import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import type { LifecycleOptions } from '../src/main/plugins/lifecycle/types'
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
const releases: Array<() => void> = []
const closers: Array<() => Promise<unknown>> = []

afterEach(async () => {
  // Release only this test's gates, including when a regression fails an assertion.
  for (const release of releases.splice(0)) release()
  try {
    for (const close of closers.splice(0).reverse()) await close()
  } finally {
    vi.restoreAllMocks()
    await cleanupLifecycleFixtures()
  }
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
      dataOnRemove: 'keep',
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

it('keeps actual A provider tools and contribution callbacks current while B removal cleanup is held', async () => {
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
  const catalogue = signed({ format: 1, entries: [...packages.values()].map((pkg) => pkg.release) })
  const removalId = randomUUID()
  const entered =
    deferred<ReturnType<Awaited<ReturnType<typeof fixture>>['state']['inspect']>['pending']>()
  const releaseB = deferred<void>()
  releases.push(() => releaseB.resolve())
  let holdingB = false
  const starts: Array<{ pluginId: string; runId: string }> = []
  const stops: Array<{ pluginId: string; runId: string }> = []
  const removeCode = vi.fn(async (pluginId: string, digest: string) => {
    if (pluginId !== B || digest !== packages.get(B)!.release.archive.sha256)
      throw new Error('Only the captured B release belongs to this removal')
    // This executes after prepare/cleanup/stop, in the operation's own async context.
    // Read the public committed state here so old writer-held code reaches the gate too.
    const pending = state.inspect().pending
    holdingB = true
    entered.resolve(pending)
    await releaseB.promise
    holdingB = false
  })
  const removeData = vi.fn(async (pluginId: string) => {
    void pluginId
  })
  const runtime: LifecycleOptions['runtime'] = {
    previousOwnerClean: async () => true,
    removeCode,
    removeData,
    async start(spec) {
      const pluginId = spec.package.manifest.id
      const client = pluginId === A ? mcpA.client : mcpB.client
      const runId = randomUUID(),
        exit = deferred<void>()
      starts.push({ pluginId, runId })
      return {
        runId,
        exited: exit.promise,
        async stop() {
          stops.push({ pluginId, runId })
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
    { catalogue, runtime, download: async (release) => packages.get(release.id)!.archive },
    false,
    A,
  )
  const state: Awaited<ReturnType<typeof fixture>>['state'] = f.state
  await f.controller.detach(f.handle)
  const controller = sharedLifecycleWorkspaces(f.controller)
  closers.push(() => controller.drain())
  const person = await controller.attach(f.local.sink)
  closers.push(() => controller.detach(person))
  const other = projection()
  const otherPerson = await controller.attach(other.sink)
  closers.push(() => controller.detach(otherPerson))
  await controller.install(person, A)
  const initialA = state.currentInstallation(A)!
  const originalView = controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const originalContribution = controller.contributions(person, A)
  const otherContribution = controller.contributions(otherPerson, A)
  expect(originalContribution.current()).toBe(true)
  expect(originalContribution.contributions.declarations).toContainEqual(
    expect.objectContaining({
      id: 'gather',
      kind: 'ui.button',
      definition: expect.objectContaining({ invoke: gather }),
    }),
  )
  const bridge = createLifecycleAgentBridge({ owner: { valid: () => true }, controller })
  controller.bindGenericTools(bridge)
  closers.push(() => bridge.close())
  const callers = new Map<string, { lease: WorkspaceLease; incarnation: string }>()
  async function connectA(workspaceId: string) {
    let caller = callers.get(workspaceId)
    if (!caller) {
      caller = {
        incarnation: randomUUID(),
        lease: {
          id: randomBytes(32).toString('hex'),
          workspace: 'a'.repeat(64),
          generation: randomUUID(),
          epoch: randomUUID(),
          counter: 0,
          renewedAt: 0,
          minor: 0,
          features: [],
        },
      }
      callers.set(workspaceId, caller)
    }
    const { lease, incarnation } = caller
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
    const server = servers.find((one) => one.name === pluginProviderNamespace(A))
    expect(server, 'A must have a current provider route').toBeDefined()
    const provider = new Client({ name: 'fictional-isolation-provider', version: '1' })
    provider.onerror = () => undefined
    closers.push(() => provider.close())
    await provider.connect(
      new StreamableHTTPClientTransport(new URL(server!.url), {
        requestInit: { headers: { Authorization: `Bearer ${server!.capability}` } },
      }),
    )
    return provider
  }
  const provider = await connectA(f.local.sink.workspaceId)
  const otherProvider = await connectA(other.sink.workspaceId)
  await expect(provider.listTools()).resolves.toMatchObject({ tools: packages.get(A)!.tools })
  await controller.install(person, B)
  const initialB = state.currentInstallation(B)!
  const bRun = controller
    .agentAttachments(f.local.sink.workspaceId)
    .find((view) => view.installation.pluginId === B)!.runId
  const dataA = join(f.root, 'host', 'data', A, 'kept.txt')
  const dataB = join(f.root, 'host', 'data', B, 'kept.txt')
  for (const id of [A, B]) {
    const file = id === A ? dataA : dataB
    await mkdir(join(f.root, 'host', 'data', id), { recursive: true })
    await writeFile(file, `fictional retained data for ${id}`)
  }

  const removal = controller.uninstall(person, B, removalId)
  const removalResult = removal.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  )
  let heldOperation: ReturnType<typeof state.inspect>['pending'] | undefined
  let retryResult: typeof removalResult | undefined
  let restartBResult: Promise<{ ok: boolean }> | undefined
  const stoppedB = vi.fn()
  const releaseReply = deferred<void>()
  releases.push(() => releaseReply.resolve())
  let delayedResult: Promise<unknown> | undefined
  try {
    // Deterministic lifecycle marker, not a timer or public archive-download preflight.
    const pending = await Promise.race([
      entered.promise,
      removalResult.then(() => {
        throw new Error('B removal settled before reaching prepared removeCode')
      }),
    ])
    heldOperation = pending
    expect(pending).toMatchObject({
      request: {
        operationId: removalId,
        consent: { action: 'uninstall', pluginId: B, expectedInstallId: initialB.installId },
      },
      next: { pluginId: B, installId: initialB.installId },
    })
    expect(holdingB).toBe(true)
    expect(removeCode).toHaveBeenCalledExactlyOnceWith(B, initialB.release.archiveSha256)
    expect(stops.filter((one) => one.pluginId === B)).toEqual([{ pluginId: B, runId: bRun }])
    expect(mcpB.seen).toMatchObject([
      { name: 'retire_moss', meta: { origin: 'lifecycle.beforeRemove', requestId: removalId } },
    ])

    // On d609 the marker above is reached, but state.load joins B's active writer:
    // agentAttachments/admitted then removes A, and this actual SDK provider assertion fails.
    await expect(provider.listTools()).resolves.toMatchObject({ tools: packages.get(A)!.tools })
    await expect(
      provider.callTool({ name: gather.tool, arguments: { basket: 'provider-during-B' } }),
    ).resolves.toHaveProperty('content')
    expect(originalView.current()).toBe(true)
    expect(originalContribution.current()).toBe(true)
    const duringB = controller.contributions(person, A)
    expect(duringB.current()).toBe(true)
    expect(duringB.identity.runId).toBe(originalView.runId)
    const scope = {
      workspaceId: f.local.sink.workspaceId,
      pluginId: A,
      instanceId: duringB.identity.runId,
    }
    await expect(
      controller.genericCallTool({
        ...scope,
        name: gather.tool,
        arguments: gather.arguments,
        requestId: randomUUID(),
        origin: 'button',
      }),
    ).resolves.toHaveProperty('content')
    expect(mcpA.seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arguments: { basket: 'provider-during-B' },
          meta: expect.objectContaining({ origin: 'agent' }),
        }),
        expect.objectContaining({
          arguments: gather.arguments,
          meta: expect.objectContaining({ origin: 'button' }),
        }),
      ]),
    )
    expect(
      controller
        .agentAttachments(f.local.sink.workspaceId)
        .map((view) => view.installation.pluginId),
    ).toEqual([A])
    expect(state.currentInstallation(B)).toBeNull()
    expect(holdingB).toBe(true)

    // The same operation must join, not repeat cleanup or allocate a new removal.
    retryResult = controller.uninstall(person, B, removalId).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    )
    restartBResult = controller.restartPluginTools(B, bRun, stoppedB).then(
      () => ({ ok: true }),
      () => ({ ok: false }),
    )
    const replyReady = deferred<void>()
    const callTool = mcpA.client.callTool.bind(mcpA.client)
    vi.spyOn(mcpA.client, 'callTool').mockImplementationOnce(async (...args) => {
      const result = await callTool(...args)
      replyReady.resolve()
      await releaseReply.promise
      return result
    })
    delayedResult = controller
      .genericCallTool({
        ...scope,
        name: gather.tool,
        arguments: { basket: 'stale-result' },
        requestId: randomUUID(),
        origin: 'button',
      })
      .catch((error: unknown) => error)
    await replyReady.promise
    await expect(controller.setEnabled(person, A, false)).resolves.toEqual({
      enabled: false,
      revision: 1,
    })
    expect(state.getEnabled(f.local.sink.workspaceId, A)).toEqual({ enabled: false, revision: 1 })
    expect(originalView.current()).toBe(false)
    expect(originalContribution.current()).toBe(false)
    expect(duringB.current()).toBe(false)
    expect(() => controller.contributions(person, A)).toThrow()
    await expect(controller.genericListTools(scope)).rejects.toMatchObject({ code: 'disabled' })
    await expect(provider.listTools()).rejects.toBeDefined()
    expect(otherContribution.current()).toBe(true)
    expect(state.getEnabled(other.sink.workspaceId, A)).toEqual({ enabled: true, revision: 0 })
    await expect(otherProvider.listTools()).resolves.toMatchObject({
      tools: packages.get(A)!.tools,
    })
    await expect(
      otherProvider.callTool({ name: gather.tool, arguments: { basket: 'other-workspace' } }),
    ).resolves.toHaveProperty('content')
    await expect(controller.setEnabled(person, A, true)).resolves.toEqual({
      enabled: true,
      revision: 2,
    })
    expect(state.getEnabled(f.local.sink.workspaceId, A)).toEqual({ enabled: true, revision: 2 })
    expect(originalContribution.current()).toBe(false)
    expect(originalView.current()).toBe(false)
    releaseReply.resolve()
    await expect(delayedResult).resolves.toMatchObject({ code: 'disabled' })
    expect(holdingB).toBe(true)
    const enabledContribution = controller.contributions(person, A)
    expect(enabledContribution.current()).toBe(true)
    await expect(provider.listTools()).rejects.toBeDefined()
    const enabledProvider = await connectA(f.local.sink.workspaceId)
    await expect(
      enabledProvider.callTool({ name: gather.tool, arguments: { basket: 'enabled-during-B' } }),
    ).resolves.toHaveProperty('content')

    // A's runtime restart and reprojection must not join B's slow cleanup queue.
    const stoppedA = vi.fn(() => bridge.hostExited(A, originalView.runId))
    await controller.restartPluginTools(A, originalView.runId, stoppedA)
    expect(stoppedA).toHaveBeenCalledOnce()
    expect(holdingB).toBe(true)
    const restarted = controller.contributions(person, A)
    expect(restarted.current()).toBe(true)
    expect(restarted.identity.runId).not.toBe(originalView.runId)
    expect(enabledContribution.current()).toBe(false)
    expect(controller.contributions(otherPerson, A).current()).toBe(true)
    const restartedProvider = await connectA(f.local.sink.workspaceId)
    await expect(restartedProvider.listTools()).resolves.toMatchObject({
      tools: packages.get(A)!.tools,
    })
    await expect(
      restartedProvider.callTool({
        name: gather.tool,
        arguments: { basket: 'restarted-during-B' },
      }),
    ).resolves.toHaveProperty('content')
    expect(starts.filter((one) => one.pluginId === A)).toHaveLength(2)
    expect(starts.filter((one) => one.pluginId === B)).toHaveLength(1)
    expect(stoppedB).not.toHaveBeenCalled()
    expect(state.inspect().pending).toEqual(pending)
    expect(state.currentInstallation(A)).toEqual(initialA)
    expect(state.getTitlesEnabled(f.local.sink.workspaceId, A)).toEqual({
      enabled: false,
      revision: 0,
    })
    expect(await readFile(dataA, 'utf8')).toBe(`fictional retained data for ${A}`)
    expect(await readFile(dataB, 'utf8')).toBe(`fictional retained data for ${B}`)
  } finally {
    releaseReply.resolve()
    releaseB.resolve()
    await Promise.all([removalResult, retryResult, restartBResult, delayedResult])
  }

  const outcome = await removalResult
  expect(outcome).toMatchObject({ ok: true, value: { data: 'kept', cleanup: 'completed' } })
  expect(await retryResult).toEqual(outcome)
  expect(await restartBResult).toEqual({ ok: false })
  expect(stoppedB).not.toHaveBeenCalled()
  expect(holdingB).toBe(false)
  expect(removeCode).toHaveBeenCalledTimes(1)
  expect(removeData).not.toHaveBeenCalled()
  expect(mcpB.seen).toHaveLength(1)
  expect(stops.filter((one) => one.pluginId === B)).toEqual([{ pluginId: B, runId: bRun }])
  expect(state.operation(removalId)).toMatchObject({
    status: 'completed',
    operation: {
      request: { operationId: removalId },
      allocated: heldOperation!.allocated,
      next: heldOperation!.next,
    },
  })
  expect(state.inspect().pending).toBeNull()
  expect(state.currentInstallation(B)).toBeNull()
  expect(state.currentInstallation(A)).toEqual(initialA)
  expect(state.getEnabled(f.local.sink.workspaceId, A)).toEqual({ enabled: true, revision: 2 })
  expect(state.getEnabled(other.sink.workspaceId, A)).toEqual({ enabled: true, revision: 0 })
  expect(await readFile(dataA, 'utf8')).toBe(`fictional retained data for ${A}`)
  expect(await readFile(dataB, 'utf8')).toBe(`fictional retained data for ${B}`)
})
