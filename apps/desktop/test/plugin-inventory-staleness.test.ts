import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { admittedPluginTools } from '../src/main/plugins/lifecycle/broker-inventory'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { managedPluginFailure } from '@brobot2/runtime/plugin-failure'
import { deferred } from './plugin-lifecycle-fixtures'
import { lease, request } from './helpers/plugin-agent-bridge'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function view() {
  const exited = deferred<void>()
  const attachment = {
    workspaceId: randomUUID(),
    runId: randomUUID(),
    installation: {
      pluginId: 'chrome',
      installId: randomUUID(),
      incarnation: randomUUID(),
      configRevision: 0,
    },
    connection: Promise.resolve({
      mcp: () => ({
        url: 'http://127.0.0.1:8123/mcp',
        headers: { Authorization: `Bearer ${'a'.repeat(64)}` },
      }),
      admin: () => ({ headers: { Authorization: `Bearer ${'b'.repeat(64)}` } }),
    }),
    exited: exited.promise,
    current: () => true,
  } as unknown as Parameters<typeof admittedPluginTools>[0]
  return { attachment, exited }
}

/** A controllable HTTP peer; the production SDK still performs initialize and tools/list. */
function peer(hold = 'tools/list') {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // Node's native timeout signal uses an internal clock. Give the parent's deadline the same
  // controllable clock as the SDK so RED and GREEN exercise precisely the same elapsed time.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const abort = new AbortController()
    setTimeout(() => abort.abort(new DOMException('Timed out', 'TimeoutError')), ms)
    return abort.signal
  })
  const started = deferred<void>()
  let stream!: ReadableStreamDefaultController<Uint8Array>
  let remaining = ''
  let signal: AbortSignal | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      if (init.method !== 'POST') return new Response(null, { status: 405 })
      const packet = JSON.parse(init.body as string)
      if (packet.id === undefined) return new Response(null, { status: 202 })
      const result =
        packet.method === 'initialize'
          ? {
              protocolVersion: packet.params.protocolVersion,
              serverInfo: { name: 'fictional-peer', version: '1' },
              capabilities: { tools: {} },
            }
          : { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
      const body = JSON.stringify({ jsonrpc: '2.0', id: packet.id, result })
      if (packet.method !== hold)
        return new Response(body, { headers: { 'content-type': 'application/json' } })
      signal = init.signal ?? undefined
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
            remaining = body.slice(1)
            controller.enqueue(new TextEncoder().encode(body.slice(0, 1)))
            signal?.addEventListener('abort', () => controller.error(signal!.reason), {
              once: true,
            })
            started.resolve()
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }),
  )
  return {
    started: started.promise,
    byte() {
      stream.enqueue(new TextEncoder().encode(remaining.slice(0, 1)))
      remaining = remaining.slice(1)
    },
    finish() {
      if (!signal?.aborted) {
        stream.enqueue(new TextEncoder().encode(remaining))
        stream.close()
      }
    },
    aborted: () => signal?.aborted,
  }
}

it.each(['initialize', 'tools/list'])(
  'accepts a slow %s response that keeps delivering real bytes past 1.5 seconds',
  async (method) => {
    const remote = peer(method)
    const { attachment } = view()
    let outcome: unknown
    const work = admittedPluginTools(attachment, new Set(['echo']), () => {}).then(
      (value) => (outcome = { value }),
      (error: unknown) => (outcome = { error }),
    )
    await remote.started
    try {
      await vi.advanceTimersByTimeAsync(2000)
      expect(outcome).toBeUndefined()
      remote.byte()
      await vi.advanceTimersByTimeAsync(2000)
      expect(outcome).toBeUndefined()
    } finally {
      remote.finish()
      await work
    }
    expect(outcome).toMatchObject({ value: { admitted: [{ name: 'echo' }] } })
  },
)

it('resets inventory staleness on bytes, then reports the silent stage as stalled', async () => {
  const remote = peer()
  const work = admittedPluginTools(view().attachment, new Set(['echo']), () => {}).catch(
    (error: unknown) => error,
  )
  await remote.started
  await vi.advanceTimersByTimeAsync(20_000)
  if (!remote.aborted()) remote.byte()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(remote.aborted()).toBe(false)
  await vi.advanceTimersByTimeAsync(10_001)
  expect(await work).toMatchObject({ pluginStage: 'binding-inventory', pluginCause: 'stalled' })
  expect(remote.aborted()).toBe(true)
})

it('reports connection refused immediately with the actual connect cause', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(
      new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNREFUSED' }) }),
    ),
  )
  await expect(admittedPluginTools(view().attachment, new Set(), () => {})).rejects.toMatchObject({
    pluginStage: 'binding-connect',
    pluginCause: 'connection-refused',
  })
})

it('ends a pending inventory immediately when the exact host exits', async () => {
  const remote = peer()
  const { attachment, exited } = view()
  const work = admittedPluginTools(attachment, new Set(), () => {}).catch((error: unknown) => error)
  await remote.started
  exited.resolve()
  await vi.advanceTimersByTimeAsync(0)
  try {
    expect(remote.aborted()).toBe(true)
  } finally {
    remote.finish()
  }
  expect(await work).toMatchObject({
    pluginStage: 'binding-inventory',
    pluginCause: 'process-exited',
  })
})

it('retries a failed inventory on the next read and marks the held retry as starting', async () => {
  const { attachment } = view()
  const held = deferred<void>()
  const bound = {
    tools: [],
    resources: [],
    adminOperations: [],
    isAllowed: () => true,
    server: {
      tool: vi.fn(),
      admin: vi.fn(),
    },
  }
  const binding = vi
    .fn()
    .mockRejectedValueOnce(
      managedPluginFailure({ code: 'ECONNREFUSED' }, 'binding-connect'),
    )
    .mockImplementationOnce(async () => {
      await held.promise
      return bound
    })
  const controller = {
    attach: async () => ({}),
    detach: async () => {},
    agentAttachments: () => [attachment],
    onHostChanged: () => () => {},
    withAgentScope: (_workspace: string, decide: (...args: unknown[]) => unknown) =>
      decide({ entries: [{ pluginId: 'chrome', is: 'admitted', view: attachment }] }, () => true),
  } as unknown as Parameters<typeof createLifecycleAgentBridge>[0]['controller']
  const bridge = createLifecycleAgentBridge({
    owner: { valid: () => true },
    controller,
    binding,
    refused: () => {},
    openRoute: async () => ({
      server: { name: 'chrome', url: 'http://127.0.0.1:8123/mcp', capability: 'c'.repeat(64) },
      close: async () => {},
    }),
  })
  const owner = lease(), req = request(attachment.workspaceId)
  try {
    expect(await bridge.agentRoutes(owner, req)).toMatchObject({ servers: [], pending: [] })
    expect(bridge.toolsUnavailable('chrome')).toBe(true)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const retry = bridge.agentRoutes(owner, req)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await retry).toMatchObject({ servers: [], pending: ['chrome'] })
    expect(binding).toHaveBeenCalledTimes(2)
    expect(bridge.toolsUnavailable('chrome')).toBe(false)
    expect(bridge.toolsPending('chrome')).toBe('binding-connection')
    expect(bridge.toolsCause('chrome')).toBe('binding-connect: connection-refused')
    held.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect((await bridge.agentRoutes(owner, req)).servers).toHaveLength(1)
    expect(bridge.toolsUnavailable('chrome')).toBe(false)
    expect(bridge.toolsCause('chrome')).toBeUndefined()
  } finally {
    held.resolve()
    await bridge.close()
  }
})
