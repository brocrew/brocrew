import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse, RequestListener, ServerOptions } from 'node:http'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'
import { openManagedPluginRoute } from '../src/main/plugins/managed-transport'
import {
  createRouteAdmissionTrace,
  observeAdmission,
  recordRouteAdmissionTrace,
  type AdmissionObserver,
  type RouteAdmissionEvent,
} from '../src/main/plugins/route-admission-trace'

const accepted = vi.hoisted(() => ({ listener: undefined as RequestListener | undefined }))
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer(options: ServerOptions | RequestListener, listener?: RequestListener) {
      if (typeof options === 'function') return actual.createServer(options)
      accepted.listener = listener
      return actual.createServer(options, listener)
    },
  }
})

const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
function log() {
  const root = mkdtempSync(join(tmpdir(), 'fictional-route-trace-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'plugin-route-admission.log')
  return {
    root,
    path,
    rows: () =>
      readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as RouteAdmissionEvent),
  }
}

it('persists distinct HTTP 401 sites without changing short circuits when its observer throws', async () => {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  const original = await f.route('fictional-caller')
  const output = log()
  const scope = createRouteAdmissionTrace((event) => {
    recordRouteAdmissionTrace(output.root, event)
    throw new Error('fictional observer failure')
  })
  const trace = scope({ route: scope({}).fresh('route') })
  const current = vi.fn(() => true)
  const route = await openManagedPluginRoute(f.broker, original.agent, current, undefined, trace)
  cleanup.push(() => route.close())
  const auth = { Authorization: `Bearer ${route.server.capability}` }
  const post = (headers: Record<string, string>) =>
    fetch(route.server.url, { method: 'POST', headers, body: '{}' })
  expect((await post({ Authorization: 'Bearer fictional-private-token' })).status).toBe(401)
  expect(current).not.toHaveBeenCalled()
  current.mockReturnValue(false)
  expect((await post(auth)).status).toBe(401)
  expect(current).toHaveBeenCalledTimes(1)
  current.mockReturnValue(true)
  f.broker.owner.revoke(original.agent)
  expect((await post(auth)).status).toBe(401)
  expect(current).toHaveBeenCalledTimes(2)
  const rows = output.rows()
  expect(rows.map((row) => [row.event, row.condition, row.error])).toEqual([
    ['http-bearer-refused', 'bearer', undefined],
    ['http-current-refused', 'current', undefined],
    ['http-broker-refused', 'broker-discovery', 'broker-unauthorized'],
  ])
  expect(new Set(rows.map((row) => row.request)).size).toBe(3)
  expect(new Set(rows.map((row) => row.route)).size).toBe(1)
  for (const secret of [
    route.server.capability,
    f.credential,
    route.server.url,
    'fictional-private-token',
  ])
    expect(readFileSync(output.path, 'utf8')).not.toContain(secret)
  await route.close()
  expect(
    output
      .rows()
      .slice(-2)
      .map((row) => row.event),
  ).toEqual(['route-close-start', 'route-close-complete'])
})

it('bounds the fixed trace and excludes arbitrary fields, malformed identifiers and raw errors', () => {
  const output = log()
  writeFileSync(output.path, 'x'.repeat(1024 * 1024))
  recordRouteAdmissionTrace(output.root, {
    process: '1'.repeat(32),
    sequence: 1,
    event: 'http-current-refused',
    request: 'fictional-private-token',
    condition: 'fictional-private-condition',
    error: 'fictional-private-error',
    raw: 'fictional-private-body',
  } as unknown as RouteAdmissionEvent)
  expect(statSync(output.path).size).toBeLessThan(1024 * 1024)
  expect(readFileSync(output.path, 'utf8')).not.toContain('fictional-private')
  expect(() =>
    recordRouteAdmissionTrace(join(output.root, 'absent'), output.rows()[0]!),
  ).not.toThrow()
})

it('aliases shared supervisor identities consistently with separate typed domains and process namespaces', () => {
  const a = createRouteAdmissionTrace()({})
  const b = createRouteAdmissionTrace()({})
  expect(a.alias('source', 'fictional-identity')).toBe(a.alias('source', 'fictional-identity'))
  expect(a.alias('source', 'fictional-identity')).not.toBe(a.alias('lease', 'fictional-identity'))
  expect(a.alias('source', 'fictional-identity')).not.toBe(b.alias('source', 'fictional-identity'))
})

it('skips current after close starts even for an already accepted request callback', async () => {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  const original = await f.route('fictional-caller')
  const events: RouteAdmissionEvent[] = []
  const trace = createRouteAdmissionTrace((event) => events.push(event))({})
  const current = vi.fn(() => {
    throw new Error('current must be skipped')
  })
  const route = await openManagedPluginRoute(f.broker, original.agent, current, undefined, trace)
  const listener = accepted.listener!
  const closed = route.close()
  const response = { writeHead: vi.fn(), end: vi.fn() }
  listener(
    { headers: { authorization: `Bearer ${route.server.capability}` } } as IncomingMessage,
    response as unknown as ServerResponse,
  )
  expect(response.writeHead).toHaveBeenCalledWith(401)
  expect(current).not.toHaveBeenCalled()
  expect(events.find((event) => event.event === 'http-current-refused')).toMatchObject({
    condition: 'accepting',
  })
  await closed
  expect(events.at(-1)?.event).toBe('route-close-complete')
})

it('keeps a handler refusal distinct from HTTP 401 after the same request passed admission', async () => {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  const original = await f.route('fictional-caller')
  const events: RouteAdmissionEvent[] = []
  const scope = createRouteAdmissionTrace((event) => {
    events.push(event)
    throw new Error('fictional observer failure')
  })
  const routeId = scope({}).fresh('route')
  const trace = scope({ route: routeId })
  const fresh = vi.spyOn(trace, 'fresh')
  const current = vi.fn((_observer?: AdmissionObserver) => true)
  const route = await openManagedPluginRoute(f.broker, original.agent, current, undefined, trace)
  cleanup.push(() => route.close())
  const client = new Client({ name: 'fictional-handler-refusal', version: '1' })
  cleanup.push(() => client.close())
  client.onerror = () => undefined
  await client.connect(new StreamableHTTPClientTransport(new URL(route.server.url), {
    requestInit: { headers: { Authorization: `Bearer ${route.server.capability}` } },
  }))
  fresh.mockClear()
  current.mockReset().mockReturnValueOnce(true).mockImplementation((observer) => {
    observeAdmission(observer, { condition: 'lease-invalid' })
    return false
  })
  const reply = await client.callTool({ name: 'echo', arguments: {} })
  expect(reply).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Plugin unavailable. Try again.' }] })
  expect(current).toHaveBeenCalledTimes(2)
  expect(fresh).toHaveBeenCalledTimes(1)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    event: 'tool-current-refused', condition: 'lease-invalid', route: routeId,
    request: fresh.mock.results[0]!.value,
  })
  expect(events[0]!.request).toMatch(/^[a-f0-9]{32}$/)
  expect(f.seen).toEqual([])
})
