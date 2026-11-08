import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'
import { openManagedPluginRoute } from '../src/main/plugins/managed-transport'
import {
  createRouteAdmissionTrace, recordRouteAdmissionTrace,
  type RouteAdmissionEvent,
} from '../src/main/plugins/route-admission-trace'

const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function log() {
  const root = mkdtempSync(join(tmpdir(), 'fictional-route-trace-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'plugin-route-admission.log')
  return { root, path, rows: () => readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as RouteAdmissionEvent) }
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
  const post = (headers: Record<string, string>) => fetch(route.server.url, { method: 'POST', headers, body: '{}' })
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
  for (const secret of [route.server.capability, f.credential, route.server.url, 'fictional-private-token'])
    expect(readFileSync(output.path, 'utf8')).not.toContain(secret)
  await route.close()
  expect(output.rows().slice(-2).map((row) => row.event)).toEqual(['route-close-start', 'route-close-complete'])
})

it('bounds the fixed trace and excludes arbitrary fields, malformed identifiers and raw errors', () => {
  const output = log()
  writeFileSync(output.path, 'x'.repeat(1024 * 1024))
  recordRouteAdmissionTrace(output.root, {
    process: '1'.repeat(32), sequence: 1, event: 'http-current-refused',
    request: 'fictional-private-token', condition: 'fictional-private-condition',
    error: 'fictional-private-error', raw: 'fictional-private-body',
  } as unknown as RouteAdmissionEvent)
  expect(statSync(output.path).size).toBeLessThan(1024 * 1024)
  expect(readFileSync(output.path, 'utf8')).not.toContain('fictional-private')
  expect(() => recordRouteAdmissionTrace(join(output.root, 'absent'), output.rows()[0]!)).not.toThrow()
})

it('aliases shared supervisor identities consistently with separate typed domains and process namespaces', () => {
  const a = createRouteAdmissionTrace()({})
  const b = createRouteAdmissionTrace()({})
  expect(a.alias('source', 'fictional-identity')).toBe(a.alias('source', 'fictional-identity'))
  expect(a.alias('source', 'fictional-identity')).not.toBe(a.alias('lease', 'fictional-identity'))
  expect(a.alias('source', 'fictional-identity')).not.toBe(b.alias('source', 'fictional-identity'))
})
