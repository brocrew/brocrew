import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import { preparePluginNodeRuntime } from '../src/main/plugins/node-runtime'
import { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { PluginPageTools } from '../src/main/plugins/ui/tool-rpc'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'
import type { LifecycleWorkspace, WorkspaceProjection } from '../src/main/plugins/lifecycle/types'
import type { ProjectionReceipt } from '../src/main/plugins/state/format'
import { fictionalPublicKey, signed } from './plugin-package-fixtures'
import {
  thirdPluginId,
  thirdPluginPackage,
  type ThirdPluginTransport,
} from './fixtures/third-plugin-acceptance'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

function projection(workspaceId: string) {
  const receipts = new Map<string, ProjectionReceipt>()
  const sink: WorkspaceProjection = {
    workspaceId,
    async applied(id, receipt) {
      if (receipt) receipts.set(id, receipt)
      else receipts.delete(id)
    },
    async revoke() {
      return true
    },
    async reconcile() {},
  }
  return { sink, receipts }
}
interface AcceptanceSession {
  owner: PluginSupervisor
  lease: PluginWorkspaceLease
  host: ReturnType<typeof createPluginNodeHost>
  service: Awaited<ReturnType<typeof createSupervisorLifecycle>>
  close(): Promise<void>
  handles: LifecycleWorkspace[]
  projections: ReturnType<typeof projection>[]
  clients: Awaited<ReturnType<typeof connectPluginSettings>>[]
  pages: PluginPageTools[]
}
async function records(path: string): Promise<Record<string, unknown>[]> {
  try {
    return (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
async function appSourceIdentity() {
  const names = [
    'node-host.ts',
    'process-runner.ts',
    'lifecycle/controller.ts',
    'lifecycle/agent-bridge.ts',
  ]
  return Promise.all(
    names.map(async (name) =>
      createHash('sha256')
        .update(await readFile(new URL('../src/main/plugins/' + name, import.meta.url)))
        .digest('hex'),
    ),
  )
}
async function acceptance(
  transport: ThirdPluginTransport,
  options: { dataOnRemove?: 'keep' | 'remove'; cleanupLosesReply?: boolean } = {},
) {
  const parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'third-plugin-')),
  )
  cleanup.push(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'installation')
  const appData = join(parent, 'app-data')
  const workspaces = [join(parent, 'workspace-a'), join(parent, 'workspace-b')]
  for (const directory of [root, appData, ...workspaces]) await mkdir(directory)
  const resources = join(parent, 'resources')
  await mkdir(join(resources, 'plugin-node'), { recursive: true })
  await copyFile(
    process.execPath,
    join(resources, 'plugin-node', process.platform === 'win32' ? 'node.exe' : 'node'),
  )
  // Copy the real app bootstrap directory, including helpers discovered by runtime preparation.
  const { cp } = await import('node:fs/promises')
  await cp(new URL('../resources/plugin-host/', import.meta.url), join(resources, 'plugin-host'), {
    recursive: true,
  })
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: resources,
    durableRoot: join(parent, 'runtime'),
  })
  const packages = []
  for (const revision of [1, 2] as const) {
    const pkg = thirdPluginPackage(revision, transport, options)
    const source = join(parent, `fictional-pebbles-${revision}.tar`)
    await writeFile(source, pkg.archive)
    packages.push({ ...pkg, ref: { source, sha256: pkg.sha256, bytes: pkg.archive.length } })
  }
  const ids = [randomUUID(), randomUUID()]
  let state = GlobalPluginState.create({ root: join(root, 'state'), workspaceRoots: workspaces })
  const sessions: AcceptanceSession[] = []
  async function start(): Promise<AcceptanceSession> {
    const owner = await PluginSupervisor.start({ root, workspaceRoots: workspaces })
    const sessionCleanup: { close?: () => Promise<void> } = {}
    cleanup.push(async () => {
      if (sessionCleanup.close) await sessionCleanup.close()
      else await owner.shutdown()
    })
    const lease = await PluginWorkspaceLease.attach({
      root,
      workspaceRoot: workspaces[0]!,
      generation: randomUUID(),
      build: 'fictional-third-plugin-acceptance',
    })
    const host = createPluginNodeHost({
      root: join(root, 'host'),
      runtime,
      sharedDataOwner: {
        appData,
        ownerId: '0c6462db-745c-405e-a826-3bc49852cdad',
        ownerLabel: 'Fictional installation',
      },
    })
    const service = await createSupervisorLifecycle({
      owner,
      host,
      personKey: '7'.repeat(64),
      read: async () => null,
      lifecycle: {
        root,
        state,
        pinnedPublicKey: fictionalPublicKey,
        target: {
          os: process.platform as 'darwin' | 'linux' | 'win32',
          cpu: process.arch as 'arm64' | 'x64',
        },
        appVersion: '1.0.0',
        catalogue: signed({ format: 1, entries: [] }),
        names: {},
        deny() {},
      },
    })
    const clients: AcceptanceSession['clients'] = []
    const pages: PluginPageTools[] = []
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      for (const page of pages) page.close()
      await Promise.allSettled(clients.map((client) => client.close()))
      await service.close()
      await host.stop()
      await lease.close()
      expect(await owner.shutdown()).toBe(true)
    }
    sessionCleanup.close = close
    const handles: LifecycleWorkspace[] = []
    const projections = ids.map(projection)
    for (const projection of projections)
      handles.push(await service.controller.attach(projection.sink))
    for (const local of projections) {
      clients.push(
        await connectPluginSettings({
          path: service.path,
          personKey: '7'.repeat(64),
          root,
          pinnedPublicKey: fictionalPublicKey,
          target: {
            os: process.platform as 'darwin' | 'linux' | 'win32',
            cpu: process.arch as 'arm64' | 'x64',
          },
          appVersion: '1.0.0',
          catalogue: signed({ format: 1, entries: [] }),
          projection: local.sink,
          propose: () => {
            throw new Error('Fictional generic settings must use MCP.')
          },
        }),
      )
    }
    const session: AcceptanceSession = {
      owner,
      lease,
      host,
      service,
      close,
      handles,
      projections,
      clients,
      pages,
    }
    sessions.push(session)
    return session
  }
  cleanup.push(async () => {
    for (const session of sessions.slice().reverse()) await session.close()
    state.close()
  })
  return {
    root,
    parent,
    appData,
    packages,
    ids,
    start,
    get state() {
      return state
    },
    reopenState() {
      state.close()
      state = GlobalPluginState.open({ root: join(root, 'state'), workspaceRoots: workspaces })
    },
  }
}

describe.each(['stdio', 'streamable-http'] as const)(
  'third plugin acceptance over %s',
  (transport) => {
    it('installs, configures through tools, adds v2 tools/settings and retains workspace/data choices with unchanged app source', async () => {
      const app = await appSourceIdentity()
      const f = await acceptance(transport)
      let session = await f.start()
      const id = thirdPluginId
      const privateData = join(f.root, 'host', 'data', id)
      const sharedData = join(f.appData, '@brobot2', 'shared', id)
      const scope = (workspace = 0) => {
        const view = session.service.controller.agentAttachments(f.ids[workspace]!)[0]
        expect(view).toBeDefined()
        return { workspaceId: f.ids[workspace]!, pluginId: id, instanceId: view!.runId }
      }
      const call = (name: string, args: Record<string, unknown> = {}, workspace = 0) =>
        session.service.controller.genericCallTool({
          ...scope(workspace),
          name,
          arguments: args,
          requestId: randomUUID(),
          origin: 'acceptance',
        })
      await session.clients[0]!.applyPackage!(f.packages[0]!.ref, 'install')
      const first = scope()
      expect((await call('pebble.helper')).structuredContent).toMatchObject({
        helper: 'opaque-third-helper',
      })
      const initial = await session.service.controller.genericListTools(first)
      expect(initial.map((tool) => tool.name)).toContain('pebble.echo')
      expect(initial.map((tool) => tool.name)).not.toContain('pebble.count')
      const configuration = async (workspace = 0) => {
        const client = session.clients[workspace]!
        const snapshot = await client.host!.snapshot()
        expect(snapshot.contributions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ pluginId: id, kind: 'settings.page', state: 'active' }),
          ]),
        )
        const screen = await client.screen(id)
        if (!screen.tools) throw new Error('Expected the real generic Configure tool service.')
        expect(screen.hostViewId).toEqual(expect.any(String))
        expect(screen.verified.readFile(screen.page!.entry)).toBeDefined()
        const page = new PluginPageTools(screen.tools)
        session.pages.push(page)
        return {
          screen,
          invoke: (tool: string, args: Record<string, unknown> = {}) =>
            page.invoke({
              channel: PLUGIN_PAGE_CHANNEL,
              requestId: randomUUID(),
              method: 'callTool',
              params: { tool, arguments: args },
            }),
        }
      }
      const pageV1 = await configuration()
      const configured = await pageV1.invoke('pebble.write_settings', {
        label: 'Opaque fictional basket',
      })
      expect(configured).toMatchObject({
        status: 'result',
        result: {
          structuredContent: {
            revision: 1,
            settings: { label: 'Opaque fictional basket' },
            home: privateData,
            shared: sharedData,
          },
        },
      })
      expect(pageV1.screen.page!.fields).toEqual(f.packages[0]!.fields)
      expect(
        session.service.controller.contributions(session.handles[0]!, id).contributions.settings
          ?.fields,
      ).toEqual(f.packages[0]!.fields)
      const opaque = Buffer.from([0, 255, 3, 17, 128])
      expect(await readFile(join(privateData, 'opaque.bin'))).toEqual(opaque)
      expect(await readFile(join(sharedData, 'opaque.bin'))).toEqual(opaque)
      expect(
        await session.clients[1]!.host!.request({ kind: 'enabled', pluginId: id, enabled: false }),
      ).toMatchObject({ value: { enabled: false } })
      expect(session.service.controller.agentAttachments(f.ids[1]!)).toEqual([])
      await expect(
        session.service.controller.genericListTools({ ...first, workspaceId: f.ids[1]! }),
      ).rejects.toMatchObject({ code: 'disabled' })
      await session.clients[0]!.applyPackage!(f.packages[1]!.ref, 'update')
      const updated = scope()
      await expect(pageV1.invoke('pebble.read_settings')).rejects.toThrow('Plugin unavailable.')
      const pageV2 = await configuration()
      expect(pageV2.screen.page!.fields).toEqual(f.packages[1]!.fields)
      expect(updated.instanceId).not.toBe(first.instanceId)
      await expect(session.service.controller.genericListTools(first)).rejects.toMatchObject({
        code: 'disabled',
      })
      expect(
        (await session.service.controller.genericListTools(updated)).map((tool) => tool.name),
      ).toContain('pebble.count')
      expect(
        (await call('pebble.count', { stones: ['opaque-a', 'opaque-b'] })).structuredContent,
      ).toMatchObject({ revision: 2, count: 2 })
      expect((await call('pebble.read_settings')).structuredContent).toMatchObject({
        settings: { label: 'Opaque fictional basket' },
        home: privateData,
        shared: sharedData,
      })
      expect(
        await pageV2.invoke('pebble.write_settings', { colour: 'fictional violet' }),
      ).toMatchObject({
        status: 'result',
        result: {
          structuredContent: {
            settings: { label: 'Opaque fictional basket', colour: 'fictional violet' },
          },
        },
      })
      expect(await pageV2.invoke('pebble.tool_error')).toMatchObject({
        status: 'result',
        result: { isError: true, structuredContent: { reason: 'fictional-full', revision: 2 } },
      })
      expect(await pageV2.invoke('pebble.protocol_error')).toEqual({
        status: 'protocol-error',
        error: {
          code: -32602,
          message: 'MCP error -32602: Fictional invalid pebble',
          data: { field: 'basket', revision: 2 },
        },
      })
      expect(
        session.service.controller.contributions(session.handles[0]!, id).contributions.settings
          ?.fields,
      ).toEqual(f.packages[1]!.fields)
      expect(await records(join(privateData, 'explicit-cleanup.jsonl'))).toEqual([])
      expect((await records(join(privateData, 'boots.jsonl')))[1]).toMatchObject({
        revision: 2,
        bootstrap: {
          previousVersion: '1.0.0',
          previousDataSchema: 1,
          dataDirectory: privateData,
          sharedDataDirectory: sharedData,
        },
      })
      expect(f.state.getEnabled(f.ids[1]!, id)).toMatchObject({ enabled: false, revision: 1 })
      await expect(call('pebble.tool_error')).resolves.toEqual({
        isError: true,
        content: [{ type: 'text', text: 'Fictional basket is full' }],
        structuredContent: { reason: 'fictional-full', revision: 2 },
      })
      await expect(call('pebble.protocol_error')).rejects.toMatchObject({
        code: -32602,
        message: 'MCP error -32602: Fictional invalid pebble',
        data: { field: 'basket', revision: 2 },
      })
      const crashing = session.service.controller.agentAttachments(f.ids[0]!)[0]!
      await expect(call('pebble.lose_reply')).rejects.toBeDefined()
      await crashing.exited
      expect(
        (await records(join(privateData, 'calls.jsonl'))).filter(
          (row) => row.name === 'pebble.lose_reply',
        ),
      ).toHaveLength(1)
      expect(session.service.controller.agentAttachments(f.ids[0]!)).toEqual([])
      await session.service.controller.restartPluginTools(id, crashing.runId, () => {})
      expect(scope().instanceId).not.toBe(crashing.runId)
      expect(
        (await records(join(privateData, 'calls.jsonl'))).filter(
          (row) => row.name === 'pebble.lose_reply',
        ),
      ).toHaveLength(1)
      // Restart never replays the package call whose reply was lost after its side effect.
      await session.clients[0]!.host!.request({ kind: 'enabled', pluginId: id, enabled: false })
      await session.clients[1]!.host!.request({ kind: 'enabled', pluginId: id, enabled: true })
      await session.close()
      f.reopenState()
      session = await f.start()
      expect(f.state.getEnabled(f.ids[0]!, id).enabled).toBe(false)
      expect(f.state.getEnabled(f.ids[1]!, id).enabled).toBe(true)
      expect(session.service.controller.agentAttachments(f.ids[0]!)).toEqual([])
      expect((await call('pebble.read_settings', {}, 1)).structuredContent).toMatchObject({
        revision: 2,
        settings: { label: 'Opaque fictional basket', colour: 'fictional violet' },
        home: privateData,
        shared: sharedData,
      })
      await session.clients[0]!.host!.request({ kind: 'enabled', pluginId: id, enabled: true })
      expect(
        (await session.service.controller.genericListTools(scope())).map((tool) => tool.name),
      ).toContain('pebble.count')
      // Updates, explicit process restart and app reopening must not run uninstall cleanup.
      expect(await records(join(privateData, 'explicit-cleanup.jsonl'))).toEqual([])
      const removing = scope()
      expect(await session.clients[0]!.uninstall(id)).toMatchObject({
        data: 'kept',
        cleanup: 'completed',
        result: { content: expect.any(Array) },
      })
      expect(session.service.controller.agentAttachments(f.ids[0]!)).toEqual([])
      expect(await records(join(privateData, 'explicit-cleanup.jsonl'))).toEqual([
        {
          revision: 2,
          args: { reason: 'declared fictional uninstall' },
          meta: expect.objectContaining({ origin: 'lifecycle.beforeRemove' }),
          runId: removing.instanceId,
        },
      ])
      expect(await readFile(join(privateData, 'opaque.bin'))).toEqual(opaque)
      expect(await readFile(join(sharedData, 'opaque.bin'))).toEqual(opaque)
      expect(await appSourceIdentity()).toEqual(app)
    }, 240000)
  },
)

it('uninstall removes only declared private data while retaining shared data and its cleanup receipt', async () => {
  const f = await acceptance('stdio', { dataOnRemove: 'remove' })
  const session = await f.start()
  await session.clients[0]!.applyPackage!(f.packages[0]!.ref, 'install')
  const outcome = await session.clients[0]!.uninstall(thirdPluginId)
  expect(outcome).toMatchObject({ data: 'deleted', cleanup: 'completed' })
  await expect(
    readFile(join(f.root, 'host', 'data', thirdPluginId, 'opaque.bin')),
  ).rejects.toMatchObject({ code: 'ENOENT' })
  const shared = join(f.appData, '@brobot2', 'shared', thirdPluginId)
  expect(await readFile(join(shared, 'opaque.bin'))).toEqual(Buffer.from([0, 255, 3, 17, 128]))
  expect(await records(join(shared, 'cleanup-events.jsonl'))).toHaveLength(1)
}, 180000)

it('recovers uninstall after code retirement without replaying an ambiguous consumed cleanup', async () => {
  const f = await acceptance('stdio', { cleanupLosesReply: true })
  let session = await f.start()
  await session.clients[0]!.applyPackage!(f.packages[0]!.ref, 'install')
  const code = join(f.root, 'host', 'packages', f.packages[0]!.sha256, 'peer.mjs')
  const audit = join(f.appData, '@brobot2', 'shared', thirdPluginId, 'cleanup-events.jsonl')
  let interrupted = false
  const completion = vi.spyOn(f.state, 'complete').mockImplementationOnce(() => {
    interrupted = !existsSync(code)
    throw new Error('Fictional interruption after code retirement, before state completion')
  })
  try {
    await expect(session.clients[0]!.uninstall(thirdPluginId)).rejects.toBeDefined()
  } finally {
    completion.mockRestore()
  }
  expect(interrupted).toBe(true)
  expect(f.state.inspect().pending).not.toBeNull()
  expect(await records(audit)).toHaveLength(1)
  await session.close()
  f.reopenState()
  session = await f.start()
  expect(f.state.inspect().pending).toBeNull()
  expect(f.state.exportActivation().entries).toEqual([])
  await session.clients[0]!.uninstall(thirdPluginId)
  expect(await records(audit)).toHaveLength(1)
  expect(await readFile(join(f.root, 'host', 'data', thirdPluginId, 'opaque.bin'))).toEqual(
    Buffer.from([0, 255, 3, 17, 128]),
  )
}, 180000)
