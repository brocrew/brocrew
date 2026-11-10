import { route, readinessHomes, deferred, ready, tick, Wire } from './fixtures/plugin-readiness'
import { expect, it } from 'vitest'
import { CodexRuntime } from '../src/codex/codex-runtime'
import {
  withManagedPluginAttachments,
  type ManagedPluginAttachment,
} from '../src/managed-plugin-session'
import type { RuntimeEvent } from '../src/index'

const { home, handles } = readinessHomes()

async function start(managedPluginMcp: readonly (typeof route & { retained?: true })[]) {
  const location = home(),
    wire = new Wire(location)
  const runtime = new CodexRuntime(() => wire)
  const handle = await runtime.start({ ...location, managedPluginMcp })
  handles.push(handle)
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  return { wire, handle, events }
}

const configured = (wire: Wire) =>
  JSON.stringify(wire.requests.find((one) => one.method === 'thread/start')?.params)

it.each(['pending', 'unknown'] as const)(
  'a failed retained route stays %s for several turns without reopening the Codex thread',
  async (state) => {
    const location = home()
    const wires: Wire[] = []
    const fern = { ...route, pluginId: 'fern' }
    let reply: ManagedPluginAttachment = {
      revision: 'served',
      servers: [fern],
      plugins: { pending: [], none: [], unknown: false },
    }
    const runtime = new CodexRuntime(() => {
      const wire = new Wire(location)
      wire.discovery = async () => ({
        data: [{ name: route.name, runtimeStatus: 'failed', toolsError: 'route retired' }],
      })
      wires.push(wire)
      return wire
    })
    const handle = await withManagedPluginAttachments(runtime, {
      read: async () => reply,
      close: async () => {},
    }).start(location)
    handles.push(handle)
    const saved = handle.ref
    reply = {
      revision: state,
      servers: [],
      plugins: {
        pending: state === 'pending' ? ['fern'] : [],
        none: [],
        unknown: state === 'unknown',
      },
    }
    for (let turn = 0; turn < 3; turn++) {
      await handle.send('fictional words while the plugin remains unavailable')
      await tick()
      expect(wires).toHaveLength(1)
      expect(wires[0]!.catalogsAtTurns).toHaveLength(turn + 1)
      expect(
        wires[0]!.requests.filter((one) => one.method === 'mcpServerStatus/list'),
      ).toHaveLength(0)
      wires[0]!.finish()
      await tick()
    }
    expect(handle.ref).toEqual(saved)
    expect(configured(wires[0]!)).toContain(route.name)
  },
)

it('a route kept while its plugin is starting is configured but never awaited before a turn', async () => {
  const kept = { ...route, name: 'plugin-aster', retained: true as const }
  const { wire, handle } = await start([kept])
  wire.discovery = () => new Promise<unknown>(() => {})
  expect(configured(wire)).toContain('plugin-aster')
  await handle.send('fictional words')
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(1)
  expect(wire.requests.some((one) => one.method === 'mcpServerStatus/list')).toBe(false)
})

it('a served route beside a kept one is the only one awaited, and the turn waits for it', async () => {
  const kept = { ...route, name: 'plugin-aster', retained: true as const }
  const { wire, handle } = await start([route, kept])
  expect(configured(wire)).toContain('plugin-aster')
  expect(configured(wire)).toContain(route.name)
  const asked: unknown[] = []
  const reply = deferred<unknown>()
  wire.discovery = (params) => {
    asked.push(params)
    return reply.promise
  }
  await handle.send('fictional words')
  await tick()
  expect(asked).toEqual([
    { threadId: 'fictional-thread', serverName: route.name, detail: 'toolsAndAuthOnly' },
  ])
  expect(wire.catalogsAtTurns).toHaveLength(0)
  reply.resolve(ready(route.name))
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(1)
  expect(JSON.stringify(asked)).not.toContain('plugin-aster')
})

it('a route served at launch that turns pending on the same handle stays configured and is no longer awaited', async () => {
  const location = home()
  const wire = new Wire(location)
  const fern = { ...route, pluginId: 'fern' }
  let reply: ManagedPluginAttachment = {
    revision: 'served',
    servers: [fern],
    plugins: { pending: [], none: [], unknown: false },
  }
  const handle = await withManagedPluginAttachments(new CodexRuntime(() => wire), {
    read: async () => reply,
    close: async () => {},
  }).start(location)
  handles.push(handle)
  const saved = handle.ref
  await handle.send('fictional first words')
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(1)
  wire.finish()
  await tick()
  reply = {
    revision: 'starting',
    servers: [],
    plugins: { pending: ['fern'], none: [], unknown: false },
  }
  wire.discovery = async () => ({
    data: [{ name: route.name, runtimeStatus: 'starting', toolsError: null }],
  })
  const before = wire.requests.length
  await handle.send('fictional later words')
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(2)
  // The pending route remains configured, with neither health recovery nor a readiness wait.
  expect(
    wire.requests.slice(before).filter((one) => one.method === 'mcpServerStatus/list'),
  ).toHaveLength(0)
  expect(configured(wire)).toContain(route.name)
  wire.finish()
  await tick()

  // Served again: the health read says nothing certain, and the turn waits for the route.
  reply = {
    revision: 'served-again',
    servers: [fern],
    plugins: { pending: [], none: [], unknown: false },
  }
  const held = deferred<unknown>()
  const asked: unknown[] = []
  wire.discovery = (params) => {
    asked.push(params)
    return asked.length === 1
      ? Promise.resolve({
          data: [{ name: route.name, runtimeStatus: 'starting', toolsError: null }],
        })
      : held.promise
  }
  await handle.send('fictional words once it is back')
  await tick()
  // The health read, then the turn's own discovery of the served route, both scoped to it.
  const scoped = {
    threadId: 'fictional-thread',
    serverName: route.name,
    detail: 'toolsAndAuthOnly',
  }
  expect(asked).toEqual([scoped, scoped])
  expect(wire.catalogsAtTurns).toHaveLength(2)
  held.resolve(ready(route.name))
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(3)
  expect(wire.requests.filter((one) => one.method === 'thread/start')).toHaveLength(1)
  expect(wire.requests.filter((one) => one.method === 'thread/resume')).toHaveLength(0)
  expect(handle.ref).toEqual(saved)
})
