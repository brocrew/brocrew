import { afterEach, expect, it } from 'vitest'
import { closes, live, request, lease } from './helpers/plugin-agent-bridge'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

it('correlates route issue and teardown with its source without retaining private identities', async () => {
  const events: unknown[] = []
  const f = await live({ routeTrace: (event) => events.push(event) })
  const one = lease()
  const ask = request(f.local.sink.workspaceId)
  const route = (await f.bridge.routes(one, ask))[0]!
  expect(route).toBeDefined()
  await f.bridge.routes(one, ask)
  await f.bridge.routes(one, { ...ask, release: true })
  const labels = events.map((event) => (event as { event: string }).event)
  expect(labels).toEqual(
    expect.arrayContaining([
      'route-issued',
      'source-refresh',
      'release-received',
      'source-retired',
      'route-close-start',
      'route-close-complete',
    ]),
  )
  const rows = events as { sequence: number; process: string }[]
  expect(rows.every((row, index) => index === 0 || row.sequence > rows[index - 1]!.sequence)).toBe(
    true,
  )
  expect(new Set(rows.map((row) => row.process)).size).toBe(1)
  const records = events as Record<string, unknown>[]
  const issued = records.find((row) => row.event === 'route-issued')!
  for (const field of ['process', 'route', 'source', 'workspace', 'lease', 'epoch', 'hostRun'])
    expect(issued[field]).toMatch(/^[a-f0-9]{32}$/)
  for (const event of [
    'release-received',
    'source-retired',
    'route-close-start',
    'route-close-complete',
  ]) {
    const row = records.find((row) => row.event === event)!
    expect(row.source).toBe(issued.source)
    expect(row.lease).toBe(issued.lease)
    expect(row.epoch).toBe(issued.epoch)
  }
  const order = [
    'route-issued',
    'release-received',
    'source-retired',
    'route-close-start',
    'route-close-complete',
  ]
  expect(order.map((event) => labels.indexOf(event))).toEqual(
    [...order.map((event) => labels.indexOf(event))].sort((a, b) => a - b),
  )
  expect(labels.lastIndexOf('source-refresh')).toBeLessThan(labels.indexOf('release-received'))
  for (const secret of [
    route.capability,
    route.url,
    ask.workspaceId,
    ask.incarnation,
    one.id,
    one.epoch,
  ])
    expect(JSON.stringify(events)).not.toContain(secret)
})

it('still records teardown when its observer throws', async () => {
  const events: unknown[] = []
  const f = await live({
    routeTrace: (event) => {
      events.push(event)
      throw new Error('fictional observer failure')
    },
  })
  const owner = lease()
  const req = request(f.local.sink.workspaceId)
  const route = (await f.bridge.routes(owner, req))[0]!
  expect(route).toBeDefined()
  await f.bridge.routes(owner, { ...req, release: true })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: 'route-close-start' }),
      expect.objectContaining({ event: 'route-close-complete' }),
    ]),
  )
})
