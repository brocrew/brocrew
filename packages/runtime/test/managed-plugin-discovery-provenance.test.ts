import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import type { ManagedPluginDiscovery } from '../src/managed-plugin-observation'
import { FakeRuntime } from '../src/fake-runtime'
import { withManagedPluginAttachments, type ManagedPluginAttachmentSource } from '../src/managed-plugin-session'

const fern = { name: 'plugin-fern', pluginId: 'fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) }
const willow = { ...fern, name: 'plugin-willow', pluginId: 'willow' }
const route = ({ name, url, pluginId }: typeof fern) => ({ name, url, pluginId })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function fixture(overrides: Partial<ClaudeQuery> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-provenance-')))
  const frames = new AsyncQueue<SDKMessage>()
  const observations: ManagedPluginDiscovery[] = []
  const query: ClaudeQuery = {
    interrupt: async () => {}, close: () => frames.close(), return: async () => frames.close(),
    setMcpServers: vi.fn(async () => ({ errors: {} })),
    [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](), ...overrides,
  }
  const runtime = new ClaudeRuntime(() => query, async () => true)
  const handle = await runtime.start({ cwd: root, providerHome: root, managedPluginMcp: [fern], observeManagedPlugins: (event) => observations.push(event) })
  cleanup.push(async () => { await handle.close(); rmSync(root, { recursive: true, force: true }) })
  function init(names: string[], tools: string[] | null = names.map((name) => `mcp__${name}__list`)) {
    frames.push({ type: 'system', subtype: 'init', session_id: 'fictional-session', cwd: root,
      ...(tools === null ? {} : { tools }), mcp_servers: names.map((name) => ({ name, status: 'connected' })) } as unknown as SDKMessage)
  }
  return { handle, query, observations, init, runtime }
}

it.each(['success', 'errors', 'rejected', 'sync'] as const)('init during %s refresh retains attempted names without endpoint provenance', async (result) => {
  const pending = deferred<unknown>()
  const status = vi.fn(async () => [])
  const f = await fixture({ setMcpServers: () => { if (result === 'sync') throw new Error('fictional'); return pending.promise }, mcpServerStatus: status })
  const refreshing = f.handle.refreshManagedPlugins!([willow])
  const settled = refreshing.catch(() => {})
  f.init([fern.name, willow.name])
  await vi.waitFor(() => expect(f.observations).toHaveLength(2))
  expect(f.observations).toEqual([fern, willow].map(({ name }) => ({ server: name, tools: ['list'], outcome: 'discovered', route: null })))
  if (result === 'rejected') pending.reject(new Error('fictional'))
  else pending.resolve({ errors: result === 'errors' ? { [willow.name]: 'fictional' } : {} })
  await settled
  expect(status).toHaveBeenCalledTimes(result === 'success' ? 1 : 0)
  f.observations.length = 0
  f.init([fern.name, willow.name])
  await vi.waitFor(() => expect(f.observations.length).toBeGreaterThan(0))
  expect(f.observations.map((one) => one.server)).toEqual(result === 'success' ? [willow.name] : [fern.name, willow.name])
  expect(f.observations.every((one) => one.route === null)).toBe(true)
})

it('latest attempt replaces historical names, including failed removal to empty', async () => {
  const f = await fixture({ setMcpServers: async () => ({ errors: { fictional: 'failed' } }) })
  await f.handle.refreshManagedPlugins!([willow]).catch(() => {})
  await f.handle.refreshManagedPlugins!([]).catch(() => {})
  f.init([fern.name, willow.name])
  await vi.waitFor(() => expect(f.observations).toHaveLength(1))
  expect(f.observations[0]).toEqual({ server: fern.name, tools: ['list'], outcome: 'discovered', route: null })
})

it.each([
  ['connected inventory', { status: 'connected', tools: [{ name: 'list' }] }, 'discovered', ['list'], true],
  ['explicit empty', { status: 'connected', tools: [] }, 'discovered', [], true],
  ['missing tools', { status: 'connected' }, 'unknown', undefined, true],
  ['pending', { status: 'pending', tools: [] }, 'unknown', undefined, true],
  ['needs-auth', { status: 'needs-auth' }, 'unknown', undefined, true],
  ['unrecognized', { status: 'fictional' }, 'unknown', undefined, true],
  ['missing status', {}, 'unknown', undefined, true],
  ['failed', { status: 'failed' }, 'unavailable', undefined, true],
  ['disabled', { status: 'disabled' }, 'unavailable', undefined, true],
  ['missing config', { status: 'connected', tools: [], config: undefined }, 'unknown', undefined, false],
  ['old URL', { status: 'connected', tools: [], config: { type: 'http', url: 'http://127.0.0.1:8000/mcp' } }, 'unknown', undefined, false],
  ['wrong name', { name: 'person-server', status: 'connected', tools: [] }, 'unknown', undefined, false],
] as const)('status preserves %s evidence', async (_label, fields, outcome, tools, matched) => {
  const rows = [{ name: fern.name, config: { type: 'http', url: fern.url }, ...fields }]
  const f = await fixture({ mcpServerStatus: vi.fn(async () => rows) as ClaudeQuery['mcpServerStatus'] })
  await f.handle.refreshManagedPlugins!([fern])
  await vi.waitFor(() => expect(f.observations).toHaveLength(1))
  expect(f.observations[0]).toEqual({ server: fern.name, outcome, ...(tools === null ? {} : { tools }), route: matched ? route(fern) : null })
})

it('two names sharing a URL match separately and ambiguous rows give no attribution', async () => {
  const f = await fixture({ mcpServerStatus: async () => [
    { name: fern.name, status: 'connected', config: { type: 'http', url: fern.url }, tools: [{ name: 'fern-tool' }] },
    { name: willow.name, status: 'connected', config: { type: 'http', url: willow.url }, tools: [{ name: 'willow-tool' }] },
    { name: willow.name, status: 'connected', config: { type: 'http', url: willow.url }, tools: [] },
  ] })
  await f.handle.refreshManagedPlugins!([fern, willow])
  await vi.waitFor(() => expect(f.observations).toHaveLength(2))
  expect(f.observations).toEqual([
    { server: fern.name, outcome: 'discovered', tools: ['fern-tool'], route: route(fern) },
    { server: willow.name, outcome: 'unknown', route: null },
  ])
})

it.each(['superseded', 'failed successor', 'closed'] as const)('late status is discarded after %s', async (reason) => {
  const pending = deferred<Awaited<ReturnType<NonNullable<ClaudeQuery['mcpServerStatus']>>>>()
  const status = vi.fn(() => pending.promise)
  const f = await fixture({ mcpServerStatus: status })
  await f.handle.refreshManagedPlugins!([fern])
  if (reason === 'closed') await f.handle.close()
  else {
    f.query.setMcpServers = async () => ({ errors: reason === 'failed successor' ? { fictional: 'failed' } : {} })
    await f.handle.refreshManagedPlugins!([]).catch(() => {})
  }
  pending.resolve([{ name: fern.name, status: 'connected', config: { type: 'http', url: fern.url }, tools: [] }])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(f.observations).toEqual([])
})

it.each(['missing', 'sync', 'rejected', 'hung'] as const)('%s status never joins refresh or close', async (mode) => {
  const status = mode === 'missing' ? undefined : vi.fn(() => {
    if (mode === 'sync') throw new Error('fictional')
    if (mode === 'rejected') return Promise.reject(new Error('fictional'))
    return new Promise<never>(() => {})
  })
  const f = await fixture({ mcpServerStatus: status })
  await f.handle.refreshManagedPlugins!([fern])
  await f.handle.close()
  expect(f.observations).toEqual([])
  if (status) expect(status).toHaveBeenCalledOnce()
})

it('wrapper distinguishes omitted, null and event-owned routes and ignores observations after close', async () => {
  const raw = new FakeRuntime('claude')
  let emit!: (event: ManagedPluginDiscovery) => void
  const start = raw.start.bind(raw)
  vi.spyOn(raw, 'start').mockImplementation(async (options) => { emit = options.observeManagedPlugins!; return start(options) })
  const events: Parameters<NonNullable<ManagedPluginAttachmentSource['observe']>>[0][] = []
  const handle = await withManagedPluginAttachments(raw, { read: async () => ({ revision: 'fictional', servers: [fern] }), close: async () => {}, observe: (event) => events.push(event) }).start({ cwd: '/fictional' })
  const discovery = { server: fern.name, outcome: 'discovered' as const, tools: [] }
  const snapshot = { ...route(fern), url: 'http://127.0.0.1:9234/mcp' }
  emit(discovery)
  emit({ ...discovery, route: null })
  emit({ ...discovery, route: snapshot })
  expect(events.filter((one) => one.discovery).map((one) => one.servers)).toEqual([[fern], [], [snapshot]])
  await handle.close()
  const count = events.length
  emit({ ...discovery, route: snapshot })
  expect(events).toHaveLength(count)
})

it('init with absent tools stays unknown while an explicit empty array reports zero', async () => {
  const f = await fixture()
  f.init([fern.name], null)
  await vi.waitFor(() => expect(f.observations).toHaveLength(1))
  expect(f.observations[0]).toEqual({ server: fern.name, outcome: 'unknown' })
  f.init([fern.name], [])
  await vi.waitFor(() => expect(f.observations).toHaveLength(2))
  expect(f.observations[1]).toEqual({ server: fern.name, outcome: 'discovered', tools: [] })
})

it('a hung success-status read leaves ordinary Send exactly once', async () => {
  const status = vi.fn(() => new Promise<never>(() => {}))
  const f = await fixture({ mcpServerStatus: status })
  const sent = vi.spyOn(f.handle, 'send').mockResolvedValue(undefined)
  vi.spyOn(f.runtime, 'start').mockResolvedValue(f.handle)
  let servers = [fern]
  const handle = await withManagedPluginAttachments(f.runtime, {
    read: async () => ({ revision: servers[0]!.name, servers }), close: async () => {},
  }).start({ cwd: '/fictional' })
  servers = [willow]
  await handle.send('fictional ordinary turn')
  expect(status).toHaveBeenCalledOnce()
  expect(sent).toHaveBeenCalledExactlyOnceWith('fictional ordinary turn')
  await handle.close()
})
