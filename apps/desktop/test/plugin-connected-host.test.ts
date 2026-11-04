import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  fixture,
  projection,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'
import { genericUiFixture } from './plugin-ui-fixtures'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { registerPluginHostIpc } from '../src/main/plugins/host-ipc'
import { pluginHostBridge } from '../src/preload/plugin-host'
import { PluginPageTools } from '../src/main/plugins/ui/tool-rpc'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'
import type { PluginNodeStart } from '../src/main/plugins/node-host'
import type { PluginHostSnapshot } from '../src/shared/plugin-host'

const closes: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup() {
  const f = await fixture({ appVersion: '1.0.0' }, false, 'fictional-list')
  const controller = sharedLifecycleWorkspaces(f.controller)
  const started: { spec: PluginNodeStart; runId: string }[] = []
  const start = f.opts.runtime.start
  f.opts.runtime.start = async (spec) => {
    const callsBefore = callTool.mock.calls.length
    const run = await start(spec)
    started.push({ spec, runId: run.runId })
    await spec.onStarted?.({ pluginId: spec.package.manifest.id, runId: run.runId })
    const described = await spec.hostRequest?.(
      { pluginId: spec.package.manifest.id, runId: run.runId },
      {
        api: 1,
        workspaceId: first.workspaceId,
        requestId: 'initialize',
        method: 'host.describe',
        params: null,
      },
      new AbortController().signal,
    )
    expect(described).toMatchObject({ value: { api: 1, speechAvailable: false } })
    expect(callTool).toHaveBeenCalledTimes(callsBefore)
    return run
  }
  const callTool = vi.fn(
    async (input: {
      workspaceId: string
      pluginId: string
      instanceId: string
      name: string
      arguments?: Record<string, unknown>
      requestId: string | number
      origin: string
    }): Promise<CallToolResult> => ({
      content: [],
      structuredContent:
        input.name === 'choose_titles'
          ? { pointers: [{ resourceId: 'fictional-guide', version: 'v1' }] }
          : { arguments: input.arguments ?? {} },
    }),
  )
  const cancelTool = vi.fn(async () => ({ cancelled: true, completed: false }))
  controller.bindGenericTools({ listTools: async () => [], callTool, cancelTool })
  const service = await servePersonPluginControl({
    root: f.root,
    key: 'c'.repeat(64),
    controller,
    read: async () => {
      throw new Error('Legacy reads must not be used by a generic page.')
    },
  })
  closes.push(() => service.close())
  const first = projection().sink,
    second = projection().sink
  async function connect(sink: typeof first) {
    const client = await connectPluginSettings({
      path: service.path,
      personKey: 'c'.repeat(64),
      root: f.root,
      pinnedPublicKey: f.opts.pinnedPublicKey,
      target: f.opts.target,
      appVersion: '1.0.0',
      catalogue: f.opts.catalogue,
      projection: sink,
      propose: () => {
        throw new Error('Generic pages do not propose app configuration.')
      },
    })
    const close = client.close.bind(client)
    let closed = false
    client.close = async () => {
      if (!closed) {
        closed = true
        await close()
      }
    }
    closes.push(() => client.close())
    if (!client.host) throw new Error('Expected connected host methods.')
    return client as typeof client & { host: NonNullable<typeof client.host> }
  }
  const a = await connect(first),
    b = await connect(second)
  const pkg = genericUiFixture({
    target: f.opts.target,
    ui: [
      {
        id: 'save',
        slot: 'composer.accessory',
        view: { label: 'Save fictional note' },
        invoke: { tool: 'notes_save', arguments: { collection: 'fictional-drafts' } },
      },
    ],
    hooks: [
      {
        id: 'titles',
        kind: 'turn.context.titles',
        api: 1,
        invoke: {
          tool: 'choose_titles',
          arguments: { collection: 'fictional-drafts' },
          inputField: 'context',
        },
      },
    ],
  })
  const source = join(f.parent, 'fictional-package.tar')
  await writeFile(source, pkg.archive)
  await a.applyPackage!(
    { source, sha256: pkg.binding.releaseDigest, bytes: pkg.archive.length },
    'install',
  )
  const ipc = { handle: vi.fn() }
  const bus = new EventEmitter()
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => false,
    send: (channel: string) => bus.emit(channel, {}),
  })
  registerPluginHostIpc(
    ipc,
    {
      request: (_workspace, input) => a.host.request(input),
      onChanged: (listener) => a.host.onChanged(() => listener(first.workspaceId)),
    },
    () => first.workspaceId,
  )
  const event = { sender, senderFrame: sender.mainFrame }
  const bridge = pluginHostBridge({
    invoke: async (_channel, input) =>
      structuredClone(await ipc.handle.mock.calls[0]![1](event, structuredClone(input))),
    on: (channel, listener) => {
      bus.on(channel, listener)
      return bus as never
    },
    off: (channel, listener) => {
      bus.off(channel, listener)
      return bus as never
    },
  })
  const snapshot = async () => {
    const result = await bridge.request({ kind: 'snapshot' })
    if (!('value' in result)) throw new Error('Expected a plain host snapshot.')
    return result.value as PluginHostSnapshot
  }
  return {
    f,
    controller,
    a,
    b,
    first,
    second,
    pkg,
    source,
    started,
    callTool,
    cancelTool,
    bridge,
    snapshot,
  }
}

it('connects preload/UI actions to one instance and persists a workspace switch without changing another workspace', async () => {
  const f = await setup()
  const snapshot = await f.snapshot()
  const button = snapshot.contributions.find((item) => item.kind === 'ui.button')!
  expect(snapshot.plugins).toEqual([
    { pluginId: 'fictional-bakery', name: 'Fictional bakery', enabled: true },
  ])
  expect(f.f.state.getEnabled(f.first.workspaceId, 'fictional-bakery')).toEqual({
    enabled: true,
    revision: 0,
  })
  await f.bridge.request({ kind: 'activate', handle: button.handle })
  expect(f.callTool).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      workspaceId: f.first.workspaceId,
      pluginId: 'fictional-bakery',
      instanceId: f.started[0]!.runId,
      name: 'notes_save',
      arguments: { collection: 'fictional-drafts' },
    }),
  )
  const launch = f.started[0]!
  await launch.spec.hostRequest!(
    { pluginId: 'fictional-bakery', runId: launch.runId },
    {
      api: 1,
      workspaceId: f.first.workspaceId,
      requestId: 'notice',
      method: 'host.notifications.show',
      params: { title: 'Fictional note saved', text: 'Open the collection.', level: 'info' },
    },
    new AbortController().signal,
  )
  expect((await f.snapshot()).notifications).toHaveLength(1)
  await f.bridge.request({ kind: 'enabled', pluginId: 'fictional-bakery', enabled: false })
  expect(f.f.state.getEnabled(f.first.workspaceId, 'fictional-bakery')).toEqual({
    enabled: false,
    revision: 1,
  })
  expect((await f.snapshot()).notifications).toEqual([])
  expect(await f.bridge.request({ kind: 'activate', handle: button.handle })).toMatchObject({
    error: { code: 'disabled' },
  })
  const other = await f.b.host.snapshot()
  const otherButton = other.contributions.find((item) => item.kind === 'ui.button')!
  expect(otherButton.state).toBe('active')
  await f.b.host.request({ kind: 'activate', handle: otherButton.handle })
  expect(f.callTool.mock.calls[1]![0]).toMatchObject({
    workspaceId: f.second.workspaceId,
    instanceId: launch.runId,
  })
  expect(f.f.starts()).toBe(1)
  await f.a.close()
  expect(f.f.state.getEnabled(f.first.workspaceId, 'fictional-bakery').enabled).toBe(false)
})

it('uses the same page call/cancel service and preserves protocol errors through real person-control frames', async () => {
  const f = await setup()
  const screen = await f.a.screen('fictional-bakery')
  if (!screen.tools) throw new Error('Expected generic page tools.')
  const page = new PluginPageTools(screen.tools)
  const args = { collection: 'fictional-drafts', workspaceId: 'a-plugin-argument' }
  const packet = {
    channel: PLUGIN_PAGE_CHANNEL,
    requestId: 'save',
    method: 'callTool',
    params: { tool: 'notes_save', arguments: args },
  }
  expect(await page.invoke(packet)).toMatchObject({
    status: 'result',
    result: { structuredContent: { arguments: args } },
  })
  expect(f.callTool.mock.calls[0]![0]).toMatchObject({
    workspaceId: f.first.workspaceId,
    instanceId: f.started[0]!.runId,
    arguments: args,
    origin: 'settings.page',
  })
  const error = new McpError(-32000, 'Choose a fictional collection', {
    choices: ['drafts'],
    hint: 'Fictional detail '.repeat(2000),
  })
  f.callTool.mockRejectedValueOnce(error)
  expect(await page.invoke({ ...packet, requestId: 'reject' })).toEqual({
    status: 'protocol-error',
    error: { code: error.code, message: error.message, data: error.data },
  })
  let finish!: (value: CallToolResult) => void
  f.callTool.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = page.invoke({ ...packet, requestId: 'pending' })
  await vi.waitFor(() => expect(f.callTool).toHaveBeenCalledTimes(3))
  const rejected = expect(pending).rejects.toThrow('Plugin unavailable.')
  page.close()
  await vi.waitFor(() =>
    expect(f.cancelTool).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: f.first.workspaceId,
        instanceId: f.started[0]!.runId,
        requestId: 'pending',
      }),
    ),
  )
  finish({ content: [] })
  await rejected
})

it('forwards metadata-only title hooks from the independent durable opt-in', async () => {
  const f = await setup()
  const input = {
    turnId: 'fictional-turn',
    pieceId: 'fictional-piece',
    candidates: [
      {
        resourceId: 'fictional-guide',
        version: 'v1',
        title: 'Fictional guide',
        pieceId: 'fictional-piece',
      },
    ],
  }
  expect(await f.a.host.beforeTurn(input)).toEqual({ pointers: [] })
  expect(f.f.state.getTitlesEnabled(f.first.workspaceId, 'fictional-bakery')).toEqual({
    enabled: false,
    revision: 0,
  })
  await f.bridge.request({ kind: 'titles-enabled', pluginId: 'fictional-bakery', enabled: true })
  expect(await f.a.host.beforeTurn(input)).toEqual({
    pointers: [{ resourceId: 'fictional-guide', version: 'v1' }],
  })
  expect(f.callTool).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      workspaceId: f.first.workspaceId,
      instanceId: f.started[0]!.runId,
      arguments: {
        collection: 'fictional-drafts',
        context: { ...input, workspaceId: f.first.workspaceId },
      },
    }),
  )
  expect(f.f.state.getEnabled(f.first.workspaceId, 'fictional-bakery')).toEqual({
    enabled: true,
    revision: 0,
  })
  await f.a.close()
  await f.b.close()
  const reopened = reopenLifecycleFixture(f.f)
  expect(reopened.getTitlesEnabled(f.first.workspaceId, 'fictional-bakery')).toEqual({
    enabled: true,
    revision: 1,
  })
})
