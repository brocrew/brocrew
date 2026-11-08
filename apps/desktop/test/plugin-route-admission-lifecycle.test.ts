import { afterEach, expect, it, vi } from 'vitest'
import { closes, live, request, lease } from './helpers/plugin-agent-bridge'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'

afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

it('traces a refused HTTP admission with opaque lifecycle correlation and the original typed cause', async () => {
  const events: unknown[] = []
  const f = await live({ routeTrace: (event) => events.push(event) })
  const one = lease()
  const ask = request(f.local.sink.workspaceId)
  const route = (await f.bridge.routes(one, ask))[0]!
  expect(route).toBeDefined()
  // The original state read refuses. Diagnostics must not read it again.
  const original = f.opts.state.readWorkspaceAdmission.bind(f.opts.state)
  const read = vi.spyOn(f.opts.state, 'readWorkspaceAdmission')
  const { PluginStateError } = await import('../src/main/plugins/state/format')
  const error = new PluginStateError('busy')
  error.message = 'fictional-private-error-body'
  read.mockImplementation(() => {
    throw error
  })
  try {
    const response = await fetch(route.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.capability}` },
    })
    expect(response.status).toBe(401)
    expect(read).toHaveBeenCalledTimes(1)
    const refused = events.find(
      (event) => (event as { event: string }).event === 'http-current-refused',
    )
    expect(refused).toMatchObject({
      event: 'http-current-refused',
      condition: 'admission-error',
      error: 'state-busy',
      request: expect.stringMatching(/^[a-f0-9]{32}$/),
      route: expect.stringMatching(/^[a-f0-9]{32}$/),
      source: expect.stringMatching(/^[a-f0-9]{32}$/),
      workspace: expect.stringMatching(/^[a-f0-9]{32}$/),
      lease: expect.stringMatching(/^[a-f0-9]{32}$/),
      epoch: expect.stringMatching(/^[a-f0-9]{32}$/),
      hostRun: expect.stringMatching(/^[a-f0-9]{32}$/),
    })
    const serialized = JSON.stringify(events)
    for (const secret of [
      route.capability,
      route.url,
      ask.workspaceId,
      ask.incarnation,
      one.id,
      one.epoch,
      error.message,
    ])
      expect(serialized).not.toContain(secret)
  } finally {
    read.mockImplementation(original)
  }
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
  const refused = records.find((row) => row.event === 'http-current-refused')!
  for (const field of ['process', 'route', 'source', 'workspace', 'lease', 'epoch', 'hostRun'])
    expect(refused[field]).toBe(issued[field])
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
    'http-current-refused',
    'release-received',
    'source-retired',
    'route-close-start',
    'route-close-complete',
  ]
  expect(order.map((event) => labels.indexOf(event))).toEqual(
    [...order.map((event) => labels.indexOf(event))].sort((a, b) => a - b),
  )
  expect(labels.lastIndexOf('source-refresh')).toBeGreaterThan(
    labels.indexOf('http-current-refused'),
  )
  expect(labels.lastIndexOf('source-refresh')).toBeLessThan(labels.indexOf('release-received'))
})

it('records the first failed lease condition without reading the already-refused view', async () => {
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
  const read = vi.spyOn(f.opts.state, 'readWorkspaceAdmission').mockImplementation(() => {
    throw new Error('fictional later failure must not be read')
  })
  f.setValid(false)
  try {
    expect(
      (
        await fetch(route.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${route.capability}` },
        })
      ).status,
    ).toBe(401)
    expect(read).not.toHaveBeenCalled()
    const refused = events.find(
      (event) => (event as { event: string }).event === 'http-current-refused',
    )
    expect(refused).toMatchObject({ condition: 'lease-invalid' })
    expect(refused).not.toHaveProperty('error')
  } finally {
    read.mockRestore()
  }
})
