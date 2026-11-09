import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { cleanupLifecycleFixtures, deferred, fixture } from './plugin-lifecycle-fixtures'
import { closes, lease, live, request } from './helpers/plugin-agent-bridge'

afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

it('does not need a SQLite writer transaction to read admission', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const view = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
  const db = new Database(join(f.root, 'state', 'writer-lock.sqlite'), { timeout: 0 })
  db.exec('BEGIN EXCLUSIVE')
  try {
    expect(() => f.state.inspect()).toThrow(expect.objectContaining({ code: 'busy' }))
    expect(view.current()).toBe(true)
    expect(f.controller.agentScope(f.local.sink.workspaceId).entries[0]?.is).toBe('admitted')
  } finally {
    db.exec('ROLLBACK')
    db.close()
  }
})

it.each(['chrome', 'whatsapp', null])(
  'reads a fresh pending %s operation while its writer is suspended',
  async (pluginId) => {
    const f = await fixture()
    await f.controller.install(f.handle, 'chrome')
    const view = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
    const entered = deferred<void>(),
      release = deferred<void>()
    const writer = f.state.withExclusive(async () => {
      const state = f.state.inspect()
      const installed = state.guards.find((one) => one.pluginId === pluginId)
      f.state.prepare({
        operationId: randomUUID(),
        consent: {
          action: pluginId === null ? 'global-restore' : installed ? 'update' : 'install',
          pluginId,
          at: 1000,
          expectedSequence: state.sequence,
          expectedInstallId: installed?.installId ?? null,
          release:
            pluginId === null
              ? null
              : {
                  version: f.pkg.release.version,
                  archiveSha256: f.pkg.release.archive.sha256,
                  manifestSha256: f.pkg.release.manifestSha256,
                  dataSchema: f.pkg.manifest.dataSchema,
                },
        },
        snapshot: pluginId === null ? f.state.exportActivation() : null,
      })
      entered.resolve()
      await release.promise
    })
    await entered.promise
    try {
      expect(view.current()).toBe(pluginId === 'whatsapp')
      expect(f.state.readWorkspaceAdmission().pendingPlugin).toBe(pluginId ?? '*')
    } finally {
      release.resolve()
      await writer
    }
  },
)

it('keeps an issued route usable while another async lifecycle context owns the writer fence', async () => {
  const f = await live()
  const owner = lease(),
    req = request(f.local.sink.workspaceId)
  const [route] = await f.bridge.routes(owner, req)
  const entered = deferred<void>(),
    release = deferred<void>()
  const writer = f.state.withExclusive(async () => {
    f.state.inspect()
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const client = new Client({ name: 'fictional-contention', version: '1' })
  client.onerror = () => {}
  closes.push(() => client.close())
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(route!.url), {
        requestInit: { headers: { Authorization: `Bearer ${route!.capability}` } },
      }),
    )
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
      content: [{ type: 'text', text: 'fictional fern' }],
    })
    expect(f.call).toHaveBeenCalledOnce()
    expect(f.bridge.toolsUnavailable('chrome')).toBe(false)
  } finally {
    release.resolve()
    await writer
  }
})

it('does not permanently revoke a contribution during another lifecycle writer lease', async () => {
  const f = await fixture()
  await f.controller.install(f.handle, 'chrome')
  const entry = f.controller.contributions(f.handle, 'chrome')
  const entered = deferred<void>(),
    release = deferred<void>()
  const writer = f.state.withExclusive(async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  try {
    expect(entry.current()).toBe(true)
  } finally {
    release.resolve()
    await writer
  }
  expect(entry.current()).toBe(true)
})

it('recovers once after host exit and stays usable during subsequent writer contention', async () => {
  const exited = deferred<void>()
  const recover = vi.fn((view: { runId: string }, stopped: () => void): Promise<void> =>
    f.controller.restartChromeTools(view.runId, stopped),
  )
  const f = await live({ firstExit: exited.promise, recoverChromeHost: recover })
  const owner = lease(),
    req = request(f.local.sink.workspaceId)
  await f.bridge.routes(owner, req)
  exited.resolve()
  await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce())
  let route: Awaited<ReturnType<typeof f.bridge.routes>>[number] | undefined
  await vi.waitFor(async () => {
    route = (await f.bridge.routes(owner, req))[0]
    expect(route).toBeDefined()
  })
  const entered = deferred<void>(),
    release = deferred<void>()
  const writer = f.state.withExclusive(async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  try {
    const client = new Client({ name: 'fictional-recovered', version: '1' })
    client.onerror = () => {}
    closes.push(() => client.close())
    await client.connect(
      new StreamableHTTPClientTransport(new URL(route!.url), {
        requestInit: { headers: { Authorization: `Bearer ${route!.capability}` } },
      }),
    )
    await client.callTool({ name: 'echo', arguments: {} })
    expect(f.call).toHaveBeenCalledOnce()
    expect(recover).toHaveBeenCalledOnce()
    expect(f.bridge.toolsUnavailable('chrome')).toBe(false)
  } finally {
    release.resolve()
    await writer
  }
})
