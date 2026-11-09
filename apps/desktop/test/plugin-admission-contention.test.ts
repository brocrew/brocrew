import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { cleanupLifecycleFixtures, deferred, fixture } from './plugin-lifecycle-fixtures'
import { closes, connected, lease, live, request } from './helpers/plugin-agent-bridge'

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

it.each(['writer-fence', 'sqlite-exclusive'] as const)(
  'initializes, lists and calls a live route without lifecycle reads during %s contention',
  async (mode) => {
    const f = await live()
    const [route] = await f.bridge.routes(lease(), request(f.local.sink.workspaceId))
    const entered = deferred<void>(),
      release = deferred<void>()
    let writer: Promise<unknown> | undefined
    let db: Database.Database | undefined
    if (mode === 'writer-fence') {
      writer = f.state.withExclusive(async () => {
        entered.resolve()
        await release.promise
      })
      await entered.promise
    } else {
      db = new Database(join(f.root, 'state', 'writer-lock.sqlite'), { timeout: 0 })
      db.exec('BEGIN EXCLUSIVE')
    }
    const read = vi.spyOn(f.state, 'readWorkspaceAdmission')
    const admission = vi.spyOn(f.state, 'withWorkspaceAdmission')
    try {
      expect(() => f.state.inspect()).toThrow(expect.objectContaining({ code: 'busy' }))
      const client = await connected(route!)
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
      expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: 'fictional fern' }],
      })
      expect(f.call).toHaveBeenCalledOnce()
      expect(read).not.toHaveBeenCalled()
      expect(admission).not.toHaveBeenCalled()
      expect(f.bridge.toolsUnavailable('chrome')).toBe(false)
    } finally {
      read.mockRestore()
      admission.mockRestore()
      db?.exec('ROLLBACK')
      db?.close()
      release.resolve()
      await writer
    }
  },
)

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
    const client = await connected(route!)
    await client.callTool({ name: 'echo', arguments: {} })
    expect(f.call).toHaveBeenCalledOnce()
    expect(recover).toHaveBeenCalledOnce()
    expect(f.bridge.toolsUnavailable('chrome')).toBe(false)
  } finally {
    release.resolve()
    await writer
  }
})
