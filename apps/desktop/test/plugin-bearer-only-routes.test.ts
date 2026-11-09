import { afterEach, expect, it, vi } from 'vitest'
import { closes, lease, live, request } from './helpers/plugin-agent-bridge'
import { cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'

afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

it.each(['uninstall', 'run-ended', 'lease-revoked', 'bridge-closed', 'source-released'] as const)(
  'closes the retired route on %s so its old bearer cannot answer',
  async (event) => {
    const exited = deferred<void>()
    const records: { event: string }[] = []
    const f = await live({
      firstExit: exited.promise,
      routeTrace: (row) => records.push(row as { event: string }),
    })
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [route] = await f.bridge.routes(owner, req)
    if (event === 'uninstall') await f.controller.uninstall(f.person, 'chrome')
    if (event === 'run-ended') exited.resolve()
    if (event === 'lease-revoked') f.revokeLease(owner)
    if (event === 'bridge-closed') await f.bridge.close()
    if (event === 'source-released') await f.bridge.routes(owner, { ...req, release: true })
    await vi.waitFor(() =>
      expect(records.some((row) => row.event === 'route-close-start')).toBe(true),
    )
    try {
      const response = await fetch(route!.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${route!.capability}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(response.status).toBe(401)
      await response.body?.cancel()
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      expect((error as TypeError & { cause?: { code?: string } }).cause?.code).toBe('ECONNREFUSED')
    }
    expect(f.call).not.toHaveBeenCalled()
  },
)

it('starts closing an issued route synchronously when source retirement is requested', async () => {
  const records: { event: string }[] = []
  const f = await live({ routeTrace: (row) => records.push(row as { event: string }) })
  const owner = lease(),
    req = request(f.local.sink.workspaceId)
  await f.bridge.routes(owner, req)
  const releasing = f.bridge.routes(owner, { ...req, release: true })
  try {
    expect(records.map((row) => row.event)).toContain('route-close-start')
  } finally {
    await releasing
  }
})
