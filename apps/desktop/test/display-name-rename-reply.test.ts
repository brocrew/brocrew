import { expect, it, onTestFinished, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime/testing'
import type { RuntimeChangeMessage } from '../src/shared/runtime-ipc'
import { createAppLifetime } from '../src/main/app-lifetime'
import { closeDatabase } from '../src/main/db/close-database'
import { openDatabase } from '../src/main/db/connection'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, refusedDuringAQuit } from '../src/main/runtime/ipc'
import { closeHostFixture, numberedFixtureHostPaths } from './lib/host-fixture'
import { deferred } from './helpers/quit-open-list-cases'
import { scratchHostState } from './helpers/scratch-host'

it('returns the committed point result and drains the accepted rename before closing SQLite', async () => {
  let clock = 5_000_000
  const tick = (): number => clock++
  const { userData, root, db, store, issued, window } = scratchHostState('rename-reply', tick)
  const said: RuntimeChangeMessage[] = []
  const host = new RuntimeHost({
    store,
    ...numberedFixtureHostPaths(() => userData, tick),
    createRuntime: (provider) => new FakeRuntime(provider, { sessions: issued }),
    announce: (change) => void (change.what !== 'persons' && said.push(change)),
  })
  onTestFinished(() =>
    closeHostFixture(
      host,
      {
        close: () => (db.open ? db.close() : db),
      },
      userData,
      root,
    ),
  )
  const colleague: RuntimeEventSink = {
    ownerId: 'agent:colleague',
    aPersonIsBehindIt: false,
    alive: true,
    send() {},
    sendLiveness() {},
  }

  let measuring = false
  const reads: { sql: string; bindings: unknown[]; inTransaction: boolean }[] = []
  const prepare = db.prepare.bind(db)
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!/^SELECT .* FROM (?:agent_identity|external_mcp_server_grant)\b/s.test(sql))
      return statement
    const capture = (bindings: unknown[]): void => {
      if (measuring) reads.push({ sql, bindings, inTransaction: db.inTransaction })
    }
    const get = statement.get.bind(statement)
    vi.spyOn(statement, 'get').mockImplementation((...bindings) => {
      capture(bindings)
      return get(...bindings)
    })
    const all = statement.all.bind(statement)
    vi.spyOn(statement, 'all').mockImplementation((...bindings) => {
      capture(bindings)
      return all(...bindings)
    })
    return statement
  })

  host.createAgent({ slug: 'worker', displayName: 'Worker', provider: null }, window)
  const server = store.registerExternalMcpServer({
    name: 'notes',
    url: 'http://127.0.0.1:4310/mcp',
    reach: 'restricted',
  })!
  const before = host.setExternalMcpServers('worker', [server.id])!
  const expected = { ...before, displayName: 'Planner' }
  expect(before.createdBy).toEqual({ by: 'a-person' })
  expect(before.externalMcpServerIds).toEqual([server.id])
  said.length = 0

  const captured = deferred()
  const release = deferred()
  const rename = store.renameAgentDisplayName.bind(store)
  vi.spyOn(store, 'renameAgentDisplayName').mockImplementationOnce(async (...args) => {
    measuring = true
    const result = await rename(...args)
    measuring = false
    captured.resolve()
    await release.promise
    return result
  })

  const order: string[] = []
  const lifetime = createAppLifetime({
    announceClosing: () => {},
    recordOpenSessions: () => host.recordOpenForQuit(),
    stopArchiveWork: () => host.stopSweeping(),
    closeAllSessions: () => host.closeAll(),
    drainArchiveWork: () => host.drainArchiveWork(),
    closeDatabase: () => {
      closeDatabase(db)
      order.push('close')
    },
    quit: () => {},
    exit: () => {},
    log: () => {},
    armLastResort: () => {},
    now: tick,
  })
  const reply = executeRuntimeCommand(host, window, {
    kind: 'setAgentDisplayName',
    profileId: 'Worker',
    displayName: 'Planner',
  }).then((result) => {
    order.push('reply')
    return result
  })

  try {
    await Promise.race([captured.promise, reply])
    const other = openDatabase(db.name, { fileMustExist: true })
    try {
      expect(createSessionStore(other, tick).agentIdentityOf('worker')).toEqual(expected)
      expect(reads.map(({ bindings, inTransaction }) => ({ bindings, inTransaction }))).toEqual([
        { bindings: [before.id], inTransaction: true },
        { bindings: [before.id], inTransaction: true },
      ])
      const plans = reads.map(({ sql, bindings }) =>
        (other.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings) as { detail: string }[])
          .map(({ detail }) => detail)
          .join('\n'),
      )
      expect(plans[0]).toMatch(/SEARCH agent_identity USING INDEX .* \(id=\?\)/)
      expect(plans[1]).toMatch(
        /SEARCH external_mcp_server_grant USING (?:COVERING )?INDEX .* \(identity_id=\?\)/,
      )
      console.info('Display-name identity and grant lookup plans', plans)
    } finally {
      other.close()
    }
    lifetime.beforeQuit({ preventDefault() {} })
    await new Promise<void>((done) => setImmediate(done))
    expect(db.open).toBe(true)
    expect(order).toEqual([])
    expect(said).toEqual([])
    for (const sink of [window, colleague]) {
      await expect(
        executeRuntimeCommand(host, sink, {
          kind: 'setAgentDisplayName',
          profileId: 'worker',
          displayName: 'Too late',
        }),
      ).rejects.toThrow(refusedDuringAQuit('setAgentDisplayName'))
    }
  } finally {
    release.resolve()
    await lifetime.shuttingDown
  }

  expect(await reply).toEqual(expected)
  expect(said).toEqual([{ what: 'agents' }])
  expect(order).toEqual(['reply', 'close'])
  expect(db.open).toBe(false)
})
