import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { CodexRuntime } from '../src/codex/codex-runtime'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import type { CodexIncoming, CodexTransport } from '../src/codex/codex-transport'
import { AsyncQueue } from '../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import type { RuntimeEvent, SessionHandle } from '../src/index'
import { threadStartResponse, turnStartResponse, completedTurn } from './fixtures/codex-protocol'
import { MANAGED_PLUGIN_READY_WITHIN_MS } from '../src/codex/managed-plugin-readiness'

const route = { name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) }
const folders: string[] = []
const handles: SessionHandle[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close()
  vi.useRealTimers()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function home() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-plugin-readiness-')))
  folders.push(root)
  const providerHome = join(root, 'home')
  mkdirSync(providerHome)
  return { providerHome, cwd: root }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((ready) => {
    resolve = ready
  })
  return { promise, resolve }
}
const ready = (name = route.name) => ({
  data: [{ name, runtimeStatus: 'connected', toolsError: null, tools: { echo: {} } }],
})
const tick = () => vi.advanceTimersByTimeAsync(0)

class Wire implements CodexTransport {
  readonly queue = new AsyncQueue<CodexIncoming>()
  readonly requests: { method: string; params: unknown }[] = []
  readonly catalogsAtTurns: string[][] = []
  catalog: string[] = []
  discovery: (params: unknown) => Promise<unknown> = async () => ready()
  constructor(readonly location: ReturnType<typeof home>) {}
  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'initialize')
      return {
        userAgent: `fictional/${CODEX_PROTOCOL_VERSION}`,
        codexHome: this.location.providerHome,
      }
    if (method === 'getAuthStatus') return { authMethod: 'apikey', requiresOpenaiAuth: true }
    if (method === 'account/read') return { account: { type: 'apiKey' } }
    if (method === 'thread/start' || method === 'thread/resume')
      return threadStartResponse('fictional-thread', this.location.cwd)
    if (method === 'mcpServerStatus/list') return this.discovery(params)
    if (method === 'turn/start') {
      this.catalogsAtTurns.push([...this.catalog])
      return turnStartResponse(`fictional-turn-${this.catalogsAtTurns.length}`)
    }
    return {}
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  finish() {
    this.queue.push({
      kind: 'notification',
      method: 'turn/completed',
      params: {
        threadId: 'fictional-thread',
        turn: completedTurn(`fictional-turn-${this.catalogsAtTurns.length}`),
      },
    })
  }
}
async function start(managed = true) {
  const location = home(),
    wire = new Wire(location)
  const runtime = new CodexRuntime(() => wire)
  const handle = await runtime.start({
    ...location,
    ...(managed ? { managedPluginMcp: [route] } : {}),
  })
  handles.push(handle)
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  return { wire, handle, events }
}
const warnings = (events: RuntimeEvent[]) =>
  events.filter((event) => event.type === 'unknown' && event.label === 'managed-plugin/discovery')

it('holds the first model turn until the managed catalog is available, while showing working', async () => {
  const { wire, handle, events } = await start()
  const discovery = deferred<unknown>()
  wire.discovery = () => discovery.promise
  await handle.send('Fictional first turn')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(wire.catalogsAtTurns).toEqual([])
  expect(events.some((event) => event.type === 'status' && event.state === 'working')).toBe(true)
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual([
    {
      method: 'mcpServerStatus/list',
      params: {
        threadId: 'fictional-thread',
        serverName: 'plugin-fern',
        detail: 'toolsAndAuthOnly',
      },
    },
  ])
  wire.catalog = ['echo']
  discovery.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([['echo']])
  expect(warnings(events)).toEqual([])
})

it('starts without a dead plugin and records one fixed line without provider error text', async () => {
  const { wire, handle, events } = await start()
  wire.discovery = async () => {
    throw new Error('fictional-private-marker')
  }
  await handle.send('Fictional first turn')
  await tick()
  expect(wire.catalogsAtTurns).toEqual([[]])
  expect(warnings(events)).toHaveLength(1)
  expect(JSON.stringify(warnings(events))).not.toContain('fictional-private-marker')
  expect(JSON.stringify(warnings(events))).not.toContain(route.capability)
  wire.finish()
  await tick()
  await handle.send('Fictional later turn')
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(2)
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toHaveLength(1)
  expect(warnings(events)).toHaveLength(1)
})

it('bounds a never-settling discovery and does not dispatch again when it eventually answers', async () => {
  const { wire, handle, events } = await start()
  const discovery = deferred<unknown>()
  wire.discovery = () => discovery.promise
  await handle.send('Fictional first turn')
  await vi.advanceTimersByTimeAsync(MANAGED_PLUGIN_READY_WITHIN_MS - 1)
  expect(wire.catalogsAtTurns).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(wire.catalogsAtTurns).toEqual([[]])
  expect(warnings(events)).toHaveLength(1)
  wire.finish()
  await tick()
  await handle.send('Fictional later turn')
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(2)
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toHaveLength(1)
  discovery.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(2)
  expect(warnings(events)).toHaveLength(1)
})

it('rechecks a still-starting catalog within the same deadline', async () => {
  const { wire, handle } = await start()
  let reads = 0
  wire.discovery = async () =>
    ++reads < 3 ? { data: [{ name: route.name, runtimeStatus: 'starting' }] } : ready()
  await handle.send('Fictional first turn')
  await vi.advanceTimersByTimeAsync(99)
  expect(wire.catalogsAtTurns).toEqual([])
  wire.catalog = ['echo']
  await vi.advanceTimersByTimeAsync(1)
  expect(wire.catalogsAtTurns).toEqual([['echo']])
})

it.each(['failed', 'authenticationRequired', 'disabled', 'cancelled'])(
  'a terminal %s discovery does not prevent a turn',
  async (runtimeStatus) => {
    const { wire, handle, events } = await start()
    wire.discovery = async () => ({
      data: [{ name: route.name, runtimeStatus, toolsError: 'fictional-private-marker' }],
    })
    await handle.send('Fictional first turn')
    await tick()
    expect(wire.catalogsAtTurns).toEqual([[]])
    expect(warnings(events)).toHaveLength(1)
    expect(JSON.stringify(warnings(events))).not.toContain('fictional-private-marker')
  },
)

it('stops an undispatched turn promptly and a late catalog cannot send it', async () => {
  const { wire, handle, events } = await start()
  const discovery = deferred<unknown>()
  wire.discovery = () => discovery.promise
  await handle.send('Fictional first turn')
  await handle.interrupt()
  await tick()
  expect(
    events.filter((event) => event.type === 'turn' && event.state === 'interrupted'),
  ).toHaveLength(1)
  discovery.resolve(ready())
  await vi.advanceTimersByTimeAsync(MANAGED_PLUGIN_READY_WITHIN_MS)
  expect(wire.catalogsAtTurns).toEqual([])
  expect(warnings(events)).toEqual([])
  wire.discovery = async () => ready()
  await handle.send('Fictional replacement turn')
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(1)
})

it('closing during discovery prevents a late turn from being sent', async () => {
  const { wire, handle } = await start()
  const discovery = deferred<unknown>()
  wire.discovery = () => discovery.promise
  await handle.send('Fictional first turn')
  await handle.close()
  discovery.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([])
})

it('does not query or wait for unmanaged Codex sessions', async () => {
  const { wire, handle } = await start(false)
  await handle.send('Fictional first turn')
  expect(wire.catalogsAtTurns).toEqual([[]])
  expect(wire.requests.some((one) => one.method === 'mcpServerStatus/list')).toBe(false)
})

it('Claude still delivers its first prompt immediately with its authenticated managed route', async () => {
  const location = home(),
    frames = new AsyncQueue<SDKMessage>()
  const received: unknown[] = []
  let options: unknown
  const query: ClaudeQuery = {
    async interrupt() {},
    close() {
      frames.close()
    },
    async return() {
      frames.close()
    },
    [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
  }
  const runtime = new ClaudeRuntime(
    (params) => {
      options = params.options.mcpServers
      void (async () => {
        for await (const message of params.prompt) received.push(message)
      })()
      return query
    },
    async () => true,
  )
  const handle = await runtime.start({ ...location, managedPluginMcp: [route] })
  handles.push(handle)
  frames.push({
    type: 'system',
    subtype: 'init',
    session_id: 'fictional-claude',
    cwd: location.cwd,
  } as unknown as SDKMessage)
  await tick()
  await handle.send('Fictional first turn')
  await tick()
  expect(received).toHaveLength(1)
  expect(options).toEqual({
    'plugin-fern': {
      type: 'http',
      url: route.url,
      headers: { Authorization: `Bearer ${route.capability}` },
    },
  })
})
