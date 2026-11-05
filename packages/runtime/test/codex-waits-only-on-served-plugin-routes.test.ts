import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexRuntime } from '../src/codex/codex-runtime'
import type { CodexIncoming, CodexTransport } from '../src/codex/codex-transport'
import { AsyncQueue } from '../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import {
  withManagedPluginAttachments,
  type ManagedPluginAttachment,
} from '../src/managed-plugin-session'
import type { RuntimeEvent, SessionHandle } from '../src/index'
import { threadStartResponse, turnStartResponse, completedTurn } from './fixtures/codex-protocol'

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
  // One health read of the configured set before the turn; no wait on the starting route.
  expect(
    wire.requests.slice(before).filter((one) => one.method === 'mcpServerStatus/list'),
  ).toHaveLength(1)
  expect(wire.requests.slice(before).some((one) => one.method === 'thread/resume')).toBe(false)
  expect(configured(wire)).toContain(route.name)
})
