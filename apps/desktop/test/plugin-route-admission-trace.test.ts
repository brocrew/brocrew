import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse, RequestListener, ServerOptions } from 'node:http'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'
import { openManagedPluginRoute } from '../src/main/plugins/managed-transport'
import {
  createRouteAdmissionTrace,
  recordRouteAdmissionTrace,
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

it('persists bearer and broker refusals when its observer throws', async () => {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  const original = await f.route('fictional-caller')
  const output = log()
  const scope = createRouteAdmissionTrace((event) => {
    recordRouteAdmissionTrace(output.root, event)
    throw new Error('fictional observer failure')
  })
  const trace = scope({})
  const route = await openManagedPluginRoute(f.broker, original.agent, undefined, trace)
  cleanup.push(() => route.close())
  const auth = { Authorization: `Bearer ${route.server.capability}` }
  const post = (headers: Record<string, string>) =>
    fetch(route.server.url, { method: 'POST', headers, body: '{}' })
  expect((await post({ Authorization: 'Bearer fictional-private-token' })).status).toBe(401)
  f.broker.owner.revoke(original.agent)
  expect((await post(auth)).status).toBe(401)
  const rows = output.rows()
  expect(rows.map((row) => [row.event, row.condition, row.error])).toEqual([
    ['http-bearer-refused', 'bearer', undefined],
    ['http-broker-refused', 'broker-discovery', 'broker-unauthorized'],
  ])
  expect(new Set(rows.map((row) => row.request)).size).toBe(2)
  expect(new Set(rows.map((row) => row.route)).size).toBe(1)
  expect(rows.every((row) => row.route === route.server.url)).toBe(true)
  expect(readFileSync(output.path, 'utf8')).not.toContain(route.server.capability)
  await route.close()
  expect(
    output
      .rows()
      .slice(-2)
      .map((row) => row.event),
  ).toEqual(['route-close-start', 'route-close-complete'])
})

it('bounds the trace and ignores file failures', () => {
  const output = log()
  writeFileSync(output.path, 'x'.repeat(1024 * 1024))
  recordRouteAdmissionTrace(output.root, {
    process: '1'.repeat(32),
    sequence: 1,
    event: 'http-bearer-refused',
    condition: 'bearer',
  })
  expect(statSync(output.path).size).toBeLessThan(1024 * 1024)
  expect(output.rows()).toMatchObject([{ event: 'http-bearer-refused', condition: 'bearer' }])
  expect(() =>
    recordRouteAdmissionTrace(join(output.root, 'absent'), output.rows()[0]!),
  ).not.toThrow()
})

it('refuses an already accepted request callback after close starts', async () => {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  const original = await f.route('fictional-caller')
  const events: RouteAdmissionEvent[] = []
  const trace = createRouteAdmissionTrace((event) => events.push(event))({})
  const route = await openManagedPluginRoute(f.broker, original.agent, undefined, trace)
  const listener = accepted.listener!
  const closed = route.close()
  const response = { writeHead: vi.fn(), end: vi.fn() }
  listener(
    { headers: { authorization: `Bearer ${route.server.capability}` } } as IncomingMessage,
    response as unknown as ServerResponse,
  )
  expect(response.writeHead).toHaveBeenCalledWith(401)
  expect(events.map((event) => event.event)).toEqual(['route-close-start'])
  await closed
  expect(events.at(-1)?.event).toBe('route-close-complete')
})
