import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import {
  resolveProviderConnection,
  resolveNamedProviderConnection,
  listProviderConnections,
} from '../src/main/db/provider-connections'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { onProviderConnection } from '../src/main/providers'
import { prepareCodexHome } from '../src/main/providers/codex'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'

let db: AppDatabase
let dir: string
let host: RuntimeHost
const sink: RuntimeEventSink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send: () => {},
  sendLiveness: () => {},
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-connections-'))
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(async () => {
  await host?.closeAll()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function fixture(withKeys = false, extra: Partial<RuntimeHostDeps> = {}) {
  const store = createSessionStore(db)
  const sessions = new FakeProviderSessions()
  const state: {
    revision: number
    revisionOf?: (provider: Provider) => number
    beforeLaunch?: () => Promise<void>
    modelPrefix?: string
    modelWait?: Promise<void>
  } = { revision: 0 }
  const rawRuntimes: FakeRuntime[] = []
  let number = 0
  const prepare = vi.fn<(provider: Provider, profile: string) => string | Promise<string>>(
    (provider, profile) => {
      const home = join(dir, profile, provider)
      mkdirSync(home, { recursive: true })
      return home
    },
  )
  const resolve = (provider: Provider, id?: string | null) => {
    const connection = resolveProviderConnection(db, { provider, connectionId: id })
    if (id != null && connection.id !== resolveProviderConnection(db, { provider }).id)
      throw new Error('The selected connection conflicts with the current credential route')
    return connection
  }
  const connectionFor = vi.fn((provider: Provider, id?: string | null) => resolve(provider, id).id)
  const create = vi.fn((provider: Provider, id?: string | null) =>
    onProviderConnection(
      provider,
      () => {
        const runtime = new FakeRuntime(provider, { sessions })
        vi.spyOn(runtime, 'start')
        vi.spyOn(runtime, 'resume')
        const listModels = runtime.listModels.bind(runtime)
        vi.spyOn(runtime, 'listModels').mockImplementation(async (context) => {
          const prefix = state.modelPrefix
          const wait = state.modelWait
          const rows = await listModels(context)
          if (wait !== undefined) await wait
          return prefix === undefined
            ? rows
            : rows.map((row) => ({ ...row, id: `${prefix}-${row.id}` }))
        })
        rawRuntimes.push(runtime)
        return runtime
      },
      (requested) => resolve(provider, requested),
      id,
    ),
  )
  const deps = {
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: create,
    beforeProviderLaunch: async () => state.beforeLaunch?.(),
    prepareProviderHome: prepare,
    providerHomePath: (provider: Provider, profile: string) => join(dir, profile, provider),
    resolveCwd: () => dir,
    newSessionId: () => `fictional-session-${++number}`,
    readProviderConfig: (_provider: Provider, home: string) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'fictional-small',
      authNote: null,
      files: [],
    }),
  }
  Reflect.set(deps, 'connectionFor', connectionFor)
  Reflect.set(
    deps,
    'connectionRevision',
    (provider: Provider) => state.revisionOf?.(provider) ?? state.revision,
  )
  const named = vi.fn((selection: string, chosenProvider?: Provider) =>
    resolveNamedProviderConnection(db, { connection: selection, provider: chosenProvider }),
  )
  Reflect.set(deps, 'connectionNamed', named)
  Reflect.set(deps, 'listConnections', () =>
    (['claude', 'codex'] as const).flatMap((provider) => listProviderConnections(db, provider)),
  )
  if (withKeys) {
    const keys = new ApiKeys(store, {
      available: () => true,
      seal: (key) => Buffer.from(key).toString('base64'),
      open: () => {
        throw new Error('Model metadata must not open a saved key')
      },
    })
    Reflect.set(deps, 'apiKeys', keys)
    state.revisionOf = (provider) => keys.revision(provider)
  }
  host = new RuntimeHost({ ...deps, ...extra })
  return { store, prepare, create, connectionFor, state, deps, rawRuntimes, named }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('Codex key consumption during real home preparation cannot launch under changed-back sign-in metadata', async () => {
  const f = fixture()
  const keys = new ApiKeys(f.store, {
    available: () => true,
    seal: (key) => Buffer.from(key).toString('base64'),
    open: (sealed) => Buffer.from(sealed, 'base64').toString(),
  })
  f.state.revisionOf = (provider) => keys.revision(provider)
  let applied: string | undefined
  const copied = vi.fn()
  f.prepare.mockImplementation((_provider, profile) =>
    prepareCodexHome(
      {
        managedRoot: dir,
        defaultProfile: 'fern',
        homeOf: (name) => join(dir, name, 'codex'),
        profiles: () => ['fern'],
        assertMayOpen: () => {},
      },
      profile,
      {
        provisionHome: (_root, home) => {
          mkdirSync(home, { recursive: true })
        },
        provisionCodexAuth: copied,
        key: {
          isSaved: () => keys.status('codex').set,
          current: async () => {
            await keys.set('codex', 'fictional-willow-key')
            const key = await keys.current('codex')
            keys.remove('codex')
            return key
          },
          change: async (_home, change) => {
            applied = change.to
            return { ok: true, authMethod: 'apikey' }
          },
        },
      },
    ),
  )
  await expect(host.createSession({ provider: 'codex', profileId: 'fern' }, sink)).rejects.toThrow(
    'connection changed',
  )
  expect(applied).toBe('the-key')
  expect(keys.revision('codex')).toBe(2)
  expect(copied).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  expect(db.prepare('SELECT connection_id FROM provider_session').all()).toEqual([])
})

for (const provider of ['claude', 'codex'] as const) {
  for (const opening of ['fresh', 'bound resume', 'legacy resume', 'models'] as const) {
    it(`${provider}: changed-back credentials in the final ${opening} wait refuse before delegation`, async () => {
      const f = fixture()
      let sessionId: string | undefined
      if (opening !== 'fresh') {
        const created = await host.createSession(
          {
            provider,
            profileId: 'fern',
            model: `fake-${provider}-a`,
            reasoningEffort: 'medium',
          },
          sink,
        )
        sessionId = created.sessionId
        await host.close(sessionId, sink)
        if (opening === 'legacy resume')
          db.prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?').run(sessionId)
        f.rawRuntimes.length = 0
      }
      const entered = deferred()
      const released = deferred()
      let calls = 0
      f.state.beforeLaunch = async () => {
        calls++
        if (opening === 'models' && calls === 1) return
        entered.resolve()
        await released.promise
      }
      const pending =
        opening === 'models'
          ? host.providerModels('fern', provider)
          : sessionId === undefined
            ? host.createSession(
                {
                  provider,
                  profileId: 'fern',
                  model: `fake-${provider}-a`,
                  reasoningEffort: 'medium',
                },
                sink,
              )
            : host.resumeSession(sessionId, sink)
      await entered.promise
      f.state.revision += 2
      released.resolve()
      if (opening === 'models') {
        expect(await pending).toMatchObject({ ok: false, reason: 'refused' })
      } else {
        await expect(pending).rejects.toThrow('connection changed')
      }
      for (const runtime of f.rawRuntimes) {
        expect(runtime.start).not.toHaveBeenCalled()
        expect(runtime.resume).not.toHaveBeenCalled()
        expect(runtime.listModels).not.toHaveBeenCalled()
      }
      if (sessionId === undefined) {
        expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([])
      } else {
        expect(f.store.connectionOf(sessionId)).toBe(
          opening === 'legacy resume' ? null : `${provider}:sign-in`,
        )
      }
    })
  }

  it(`${provider}: an explicit foreign connection refuses before any home or runtime side effect`, async () => {
    const f = fixture()
    const foreign = provider === 'claude' ? 'codex:sign-in' : 'claude:sign-in'
    await expect(
      Reflect.apply(host.createSession, host, [
        {
          provider,
          profileId: 'fern',
          model: `fake-${provider}-a`,
          reasoningEffort: 'medium',
          connectionId: foreign,
        },
        sink,
      ]),
    ).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([])
  })

  it(`${provider}: a persisted sign-in default cannot silently launch with a newly saved key`, async () => {
    const f = fixture()
    f.store.createAgentIdentity({ slug: 'fern', displayName: 'Fern', provider }, { by: 'a-person' })
    f.store.setAgentConnection('fern', provider, `${provider}:sign-in`)
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    await expect(
      host.createSession(
        {
          provider,
          profileId: 'fern',
          model: `fake-${provider}-a`,
          reasoningEffort: 'medium',
        },
        sink,
      ),
    ).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.store.defaultConnectionOf('fern')).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: an unavailable key default cannot fall back to sign-in`, async () => {
    const f = fixture()
    f.store.createAgentIdentity({ slug: 'fern', displayName: 'Fern', provider }, { by: 'a-person' })
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    f.store.setAgentConnection('fern', provider, `${provider}:api-key`)
    db.prepare('DELETE FROM provider_api_key WHERE provider=?').run(provider)
    await expect(
      host.createSession(
        {
          provider,
          profileId: 'fern',
          model: `fake-${provider}-a`,
          reasoningEffort: 'medium',
        },
        sink,
      ),
    ).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.store.defaultConnectionOf('fern')).toBe(`${provider}:api-key`)
  })

  it(`${provider}: a valid explicit key reference is admitted as that exact selection`, async () => {
    const f = fixture()
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    const created = await Reflect.apply(host.createSession, host, [
      {
        provider,
        profileId: 'fern',
        model: `fake-${provider}-a`,
        reasoningEffort: 'medium',
        connectionId: `${provider}:api-key`,
      },
      sink,
    ])
    expect(f.connectionFor).toHaveBeenCalledWith(provider, `${provider}:api-key`)
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)
  })

  it(`${provider}: a person's explicit connection and model become one consistent new-conversation default`, async () => {
    const f = fixture()
    const oldProvider = provider === 'claude' ? 'codex' : 'claude'
    f.store.createAgentIdentity(
      { slug: 'fern', displayName: 'Fern', provider: oldProvider },
      { by: 'a-person' },
    )
    const result = await Reflect.apply(host.setAgentModelAndEffort, host, [
      'fern',
      {
        provider,
        model: `fake-${provider}-a`,
        effort: 'medium',
        connectionId: `${provider}:sign-in`,
      },
    ])
    expect(result).toMatchObject({
      ok: true,
      choice: {
        provider,
        model: `fake-${provider}-a`,
        effort: 'medium',
        connectionId: `${provider}:sign-in`,
      },
    })
    expect(f.store.providerOf('fern')).toBe(provider)
    expect(f.store.defaultConnectionOf('fern')).toBe(`${provider}:sign-in`)
    expect(f.store.modelChoiceOf('fern')).toMatchObject({
      provider,
      connectionId: `${provider}:sign-in`,
    })
  })

  it(`${provider}: a foreign default connection refuses before a catalogue or home is requested`, async () => {
    const f = fixture()
    f.store.createAgentIdentity({ slug: 'fern', displayName: 'Fern', provider }, { by: 'a-person' })
    const before = db.prepare("SELECT * FROM agent_identity WHERE slug='fern'").get()
    const foreign = provider === 'claude' ? 'codex:sign-in' : 'claude:sign-in'
    const result = await Reflect.apply(host.setAgentModelAndEffort, host, [
      'fern',
      {
        provider,
        model: `fake-${provider}-a`,
        effort: 'medium',
        connectionId: foreign,
      },
    ])
    expect(result.ok).toBe(false)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare("SELECT * FROM agent_identity WHERE slug='fern'").get()).toEqual(before)
  })

  it(`${provider}: credential ABA across the default catalogue wait cannot save a mislabeled connection`, async () => {
    const f = fixture()
    await host.createSession(
      { provider, profileId: 'fern', model: `fake-${provider}-a`, reasoningEffort: 'medium' },
      sink,
    )
    const catalogue = await host.providerModels('fern', provider)
    expect(catalogue.ok).toBe(true)
    const before = db.prepare("SELECT * FROM agent_identity WHERE slug='fern'").get()
    const entered = deferred()
    const released = deferred()
    vi.spyOn(host, 'providerModels').mockImplementationOnce(async () => {
      entered.resolve()
      await released.promise
      return catalogue
    })
    const pending = Reflect.apply(host.setAgentModelAndEffort, host, [
      'fern',
      {
        provider,
        model: `fake-${provider}-a`,
        effort: 'medium',
        connectionId: `${provider}:sign-in`,
      },
    ])
    await entered.promise
    f.state.revision += 2
    released.resolve()
    expect((await pending).ok).toBe(false)
    expect(db.prepare("SELECT * FROM agent_identity WHERE slug='fern'").get()).toEqual(before)
  })

  it(`${provider}: records successful new launches on the admitted connection and per-agent home`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern', cwd: dir }, sink)
    expect(f.connectionFor).toHaveBeenCalledWith(provider)
    expect(f.create).toHaveBeenCalledWith(provider, `${provider}:sign-in`)
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
    expect(created.providerHome).toBe(join(dir, 'fern', provider))
  })

  it(`${provider}: rejects a disabled connection before preparing a home or creating a runtime`, async () => {
    const f = fixture()
    db.prepare('UPDATE provider_connection SET enabled=0 WHERE id=?').run(`${provider}:sign-in`)
    await expect(host.createSession({ provider, profileId: 'fern' }, sink)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([])
  })

  it(`${provider}: model admission refuses a disabled connection before preparing its home`, async () => {
    const f = fixture()
    db.prepare('UPDATE provider_connection SET enabled=0 WHERE id=?').run(`${provider}:sign-in`)
    expect(await host.providerModels('fern', provider)).toMatchObject({ ok: false })
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: a key changed and changed back during preparation cannot launch`, async () => {
    const f = fixture()
    const prepare = f.prepare.getMockImplementation()!
    f.prepare.mockImplementation((kind, profile) => {
      f.state.revision += 2
      return prepare(kind, profile)
    })
    await expect(host.createSession({ provider, profileId: 'fern' }, sink)).rejects.toThrow()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([])
  })

  it(`${provider}: resume retains a recorded binding instead of choosing a newly saved key`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=? WHERE id=?').run(
      `${provider}:sign-in`,
      created.sessionId,
    )
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    f.prepare.mockClear()
    f.create.mockClear()
    await expect(host.resumeSession(created.sessionId, sink)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: reopening legacy NULL chooses dynamically without backfilling`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?').run(created.sessionId)
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    const resumed = await host.resumeSession(created.sessionId, sink)
    expect(resumed.ref).toEqual(created.ref)
    expect(resumed.providerHome).toBe(join(dir, 'fern', provider))
    expect(f.store.connectionOf(created.sessionId)).toBeNull()
    expect(f.create).toHaveBeenLastCalledWith(provider, `${provider}:api-key`)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  function reservedService() {
    const f = fixture()
    const id = 'fictional-reserved-service'
    f.store.create({
      id,
      provider,
      cwd: dir,
      profileId: 'fern',
      approvalMode: 'ask',
      service: true,
      model: `fake-${provider}-a`,
      reasoningEffort: 'medium',
    })
    const identity = f.store.agentIdentities().find((one) => one.slug === 'fern')!
    host = new RuntimeHost({
      ...f.deps,
      profileExecution: {
        read: () => ({
          readable: true,
          kept: {
            profiles: {
              [identity.id]: {
                kind: 'service',
                identityCreatedAt: identity.createdAt,
                serviceConversation: id,
              },
            },
          },
        }),
        write: () => {},
        owned: true,
      },
    })
    expect(f.store.recordedOne(id)?.neverStarted).toBe(true)
    expect(f.store.connectionOf(id)).toBeNull()
    return { ...f, id }
  }

  it(`${provider}: a reserved service's non-NULL key binding wins over a changed sign-in default`, async () => {
    const f = reservedService()
    f.store.setAgentConnection('fern', provider, `${provider}:sign-in`)
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    db.prepare('UPDATE provider_session SET connection_id=? WHERE id=?').run(
      `${provider}:api-key`,
      f.id,
    )
    await host.send(f.id, 'Check the fictional room.', sink)
    expect(f.connectionFor).toHaveBeenCalledWith(provider, `${provider}:api-key`)
    expect(f.store.defaultConnectionOf('fern')).toBe(`${provider}:sign-in`)
    expect(f.store.connectionOf(f.id)).toBe(`${provider}:api-key`)
  })

  it(`${provider}: a reserved service's old sign-in binding refuses instead of taking the new key default`, async () => {
    const f = reservedService()
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    f.store.setAgentConnection('fern', provider, `${provider}:api-key`)
    db.prepare('UPDATE provider_session SET connection_id=? WHERE id=?').run(
      `${provider}:sign-in`,
      f.id,
    )
    const before = db.prepare('SELECT * FROM provider_session WHERE id=?').get(f.id)
    await expect(host.send(f.id, 'Check the fictional room.', sink)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get(f.id)).toEqual(before)
  })

  it(`${provider}: a reserved service's first launch uses its explicit agent default`, async () => {
    const f = reservedService()
    f.store.setAgentConnection('fern', provider, `${provider}:sign-in`)
    await host.send(f.id, 'Check the fictional room.', sink)
    expect(f.connectionFor).toHaveBeenCalledWith(provider, `${provider}:sign-in`)
    expect(f.store.connectionOf(f.id)).toBe(`${provider}:sign-in`)
    expect(f.store.recordedOne(f.id)?.neverStarted).toBe(false)
  })

  it(`${provider}: a reserved service cannot ignore a sign-in default when a key is now saved`, async () => {
    const f = reservedService()
    f.store.setAgentConnection('fern', provider, `${provider}:sign-in`)
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    const before = db.prepare('SELECT * FROM provider_session WHERE id=?').get(f.id)
    await expect(host.send(f.id, 'Check the fictional room.', sink)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get(f.id)).toEqual(before)
  })

  it(`${provider}: a reserved service cannot fall back when its key default disappeared`, async () => {
    const f = reservedService()
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    f.store.setAgentConnection('fern', provider, `${provider}:api-key`)
    db.prepare('DELETE FROM provider_api_key WHERE provider=?').run(provider)
    const before = db.prepare('SELECT * FROM provider_session WHERE id=?').get(f.id)
    await expect(host.send(f.id, 'Check the fictional room.', sink)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get(f.id)).toEqual(before)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  const readConnectionModels = (connectionId: string) =>
    Reflect.apply(host.modelList, host, [provider, 'fern', connectionId])

  it(`${provider}: a foreign connection cannot read a successful cached catalogue`, async () => {
    const f = fixture()
    await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.modelList(provider, 'fern')
    f.prepare.mockClear()
    f.create.mockClear()
    const foreign = provider === 'claude' ? 'codex:sign-in' : 'claude:sign-in'
    await expect(readConnectionModels(foreign)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: a key catalogue never borrows the previous sign-in answer`, async () => {
    const f = fixture()
    await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.modelList(provider, 'fern')
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    f.state.revision++
    f.create.mockClear()
    const list = await readConnectionModels(`${provider}:api-key`)
    expect(list.notAsked).toBeNull()
    expect(f.create).toHaveBeenCalledWith(provider, `${provider}:api-key`)
    f.create.mockClear()
    await readConnectionModels(`${provider}:api-key`)
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: an explicit sign-in cannot read a cached list while a key takes precedence`, async () => {
    const f = fixture()
    await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.modelList(provider, 'fern')
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    f.prepare.mockClear()
    f.create.mockClear()
    await expect(readConnectionModels(`${provider}:sign-in`)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: a removed key reference cannot read its cached answer`, async () => {
    const f = fixture()
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    await host.createSession({ provider, profileId: 'fern' }, sink)
    await readConnectionModels(`${provider}:api-key`)
    db.prepare('DELETE FROM provider_api_key WHERE provider=?').run(provider)
    f.prepare.mockClear()
    f.create.mockClear()
    await expect(readConnectionModels(`${provider}:api-key`)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })
}

for (const provider of ['claude', 'codex'] as const) {
  async function giver() {
    const f = fixture()
    const created = await host.createSession(
      {
        provider,
        profileId: 'caller',
        model: `fake-${provider}-a`,
        reasoningEffort: 'medium',
      },
      sink,
    )
    const by = { ownerId: agentCallerId(created.sessionId) }
    const give = (extra: Record<string, unknown> = {}) =>
      host.giveWork(
        {
          profile: 'fern',
          title: 'Fictional room check',
          brief: 'Check the fictional room.',
          definition_of_done: 'The fictional check is recorded.',
          ...extra,
        },
        by,
      )
    return { ...f, give, caller: created.sessionId }
  }

  it(`${provider}: give_work resolves a named connection once and starts on its canonical ID`, async () => {
    const f = await giver()
    f.store.createAgentIdentity({ slug: 'fern', displayName: 'Fern', provider }, { by: 'a-person' })
    db.prepare('UPDATE provider_connection SET name=? WHERE id=?').run(
      'Fern account',
      `${provider}:sign-in`,
    )
    f.prepare.mockClear()
    const result = await f.give({ connection: 'Fern account' })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.refusal.reason)
    expect(f.named).toHaveBeenCalledTimes(1)
    expect(f.store.connectionOf(result.owner)).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: an explicit new-worker connection wins over its agent default without changing that default`, async () => {
    const f = await giver()
    f.store.createAgentIdentity({ slug: 'fern', displayName: 'Fern', provider }, { by: 'a-person' })
    f.store.setAgentConnection('fern', provider, `${provider}:sign-in`)
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    const result = await f.give({ connection: `${provider}:api-key` })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.refusal.reason)
    expect(f.store.connectionOf(result.owner)).toBe(`${provider}:api-key`)
    expect(f.store.defaultConnectionOf('fern')).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: give_work rejects a foreign connection before creating an identity or piece`, async () => {
    const f = await giver()
    f.prepare.mockClear()
    f.create.mockClear()
    const foreign = provider === 'claude' ? 'codex:sign-in' : 'claude:sign-in'
    const before = f.store.piecesGivenBy(f.caller)
    const result = await f.give({ connection: foreign, provider, new: true })
    expect(result.ok).toBe(false)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.store.capabilitiesOf('fern')).toBeNull()
    expect(f.store.piecesGivenBy(f.caller)).toEqual(before)
  })

  for (const legacy of [false, true]) {
    it(`${provider}: an existing ${legacy ? 'legacy NULL' : 'bound'} worker never changes connection for a later give`, async () => {
      const f = await giver()
      f.store.createAgentIdentity(
        { slug: 'fern', displayName: 'Fern', provider },
        { by: 'a-person' },
      )
      const first = await f.give()
      expect(first.ok).toBe(true)
      if (!first.ok) throw new Error(first.refusal.reason)
      if (legacy)
        db.prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?').run(first.owner)
      db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
        provider,
        'fictional-sealed',
        1,
      )
      const before = f.store.piecesGivenBy(f.caller)
      f.prepare.mockClear()
      f.create.mockClear()
      const result = await f.give({ connection: `${provider}:api-key` })
      expect(result.ok).toBe(false)
      expect(f.prepare).not.toHaveBeenCalled()
      expect(f.create).not.toHaveBeenCalled()
      expect(f.store.piecesGivenBy(f.caller)).toEqual(before)
      expect(f.store.connectionOf(first.owner)).toBe(legacy ? null : `${provider}:sign-in`)
    })
  }
}

for (const provider of ['claude', 'codex'] as const) {
  const readKeyModels = () =>
    Reflect.apply(host.modelList, host, [provider, 'fern', `${provider}:api-key`])
  async function keyCatalogue() {
    const f = fixture(true)
    await host.createSession(
      { provider, profileId: 'fern', model: `fake-${provider}-a`, reasoningEffort: 'medium' },
      sink,
    )
    await host.setApiKey(provider, 'fictional-account-a-key')
    f.state.modelPrefix = 'fictional-account-a'
    return f
  }

  for (const removeFirst of [false, true]) {
    it(`${provider}: ${removeFirst ? 'removing and re-adding' : 'rotating'} a key replaces the same-ID catalogue`, async () => {
      const f = await keyCatalogue()
      const before = await readKeyModels()
      expect(before.models[0]?.id).toMatch(/^fictional-account-a-/)
      if (removeFirst) await host.removeApiKey(provider)
      await host.setApiKey(provider, 'fictional-account-b-key')
      f.state.modelPrefix = 'fictional-account-b'
      f.create.mockClear()
      const after = await readKeyModels()
      expect(after.models[0]?.id).toMatch(/^fictional-account-b-/)
      expect(f.create).toHaveBeenCalledExactlyOnceWith(provider, `${provider}:api-key`)
    })
  }

  it(`${provider}: an old in-flight catalogue cannot become current after same-ID key rotation`, async () => {
    const f = await keyCatalogue()
    const gate = deferred()
    f.state.modelWait = gate.promise
    f.create.mockClear()
    const old = readKeyModels().then(
      () => null,
      (error: unknown) => error,
    )
    await vi.waitFor(() => expect(f.rawRuntimes.at(-1)?.listModels).toHaveBeenCalled())
    await host.setApiKey(provider, 'fictional-account-b-key')
    f.state.modelPrefix = 'fictional-account-b'
    f.state.modelWait = undefined
    const fresh = readKeyModels()
    gate.resolve()
    expect(await old).toBeInstanceOf(Error)
    const current = await fresh
    expect(current.models[0]?.id).toMatch(/^fictional-account-b-/)
    expect((await readKeyModels()).models[0]?.id).toMatch(/^fictional-account-b-/)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: the person's creation stores a qualified connection without preparing a home`, () => {
    const f = fixture()
    const said = {
      slug: 'willow',
      displayName: 'Willow',
      provider,
      connectionId: `${provider}:sign-in`,
    }
    const created = host.createAgent(said)
    expect(created).toMatchObject({ provider, connectionId: `${provider}:sign-in` })
    expect(f.store.defaultConnectionOf('willow')).toBe(`${provider}:sign-in`)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: creation refuses unavailable or conflicting connections before writing an identity`, () => {
    const f = fixture()
    const other = provider === 'claude' ? 'codex' : 'claude'
    const before = f.store.agentIdentities()
    for (const connectionId of ['fictional-missing', `${other}:sign-in`, `${provider}:api-key`]) {
      expect(() =>
        host.createAgent({ slug: 'willow', displayName: 'Willow', provider, ...{ connectionId } }),
      ).toThrow()
      expect(f.store.agentIdentities()).toEqual(before)
    }
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    expect(() =>
      host.createAgent({
        slug: 'willow',
        displayName: 'Willow',
        provider,
        ...{ connectionId: `${provider}:sign-in` },
      }),
    ).toThrow()
    expect(f.store.agentIdentities()).toEqual(before)
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: create_agent resolves a connection-only name once and persists its canonical default`, async () => {
    const f = fixture()
    const caller = await host.createSession({ provider, profileId: 'fern' }, sink)
    host.setSpawningEnabled(true)
    f.prepare.mockClear()
    f.create.mockClear()
    f.named.mockClear()
    const tools = agentToolsFor(host, caller.sessionId)
    const create = tools.tools.find((tool) => tool.name === 'create_agent')!
    const give = tools.tools.find((tool) => tool.name === 'give_work')!
    expect(create.input).toHaveProperty('connection')
    expect(give.input).toHaveProperty('connection')
    const named = resolveProviderConnection(db, { provider }).name
    const answer = await create.call({ profile_slug: 'willow', connection: named, provider })
    expect(answer.structured).toMatchObject({ outcome: 'ok' })
    expect(f.named).toHaveBeenCalledTimes(1)
    expect(f.store.providerOf('willow')).toBe(provider)
    expect(f.store.defaultConnectionOf('willow')).toBe(`${provider}:sign-in`)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: create_agent binds its named connection and judged model in one default`, async () => {
    const f = fixture()
    const caller = await host.createSession({ provider, profileId: 'fern' }, sink)
    host.setSpawningEnabled(true)
    const create = agentToolsFor(host, caller.sessionId).tools.find(
      (tool) => tool.name === 'create_agent',
    )!
    const answer = await create.call({
      profile_slug: 'willow',
      connection: `${provider}:sign-in`,
      model: `fake-${provider}-a`,
      effort: 'medium',
    })
    expect(answer.structured).toMatchObject({ outcome: 'ok' })
    expect(f.store.defaultConnectionOf('willow')).toBe(`${provider}:sign-in`)
    expect(f.store.modelChoiceOf('willow')).toEqual({
      provider,
      connectionId: `${provider}:sign-in`,
      model: `fake-${provider}-a`,
      effort: 'medium',
    })
    expect(f.create).toHaveBeenLastCalledWith(provider, `${provider}:sign-in`)
  })

  it(`${provider}: a changed-back key during create_agent's catalogue wait refuses without minting`, async () => {
    const f = fixture()
    const caller = await host.createSession({ provider, profileId: 'fern' }, sink)
    host.setSpawningEnabled(true)
    const wait = deferred()
    f.state.modelWait = wait.promise
    for (const runtime of f.rawRuntimes) vi.mocked(runtime.listModels).mockClear()
    const create = agentToolsFor(host, caller.sessionId).tools.find(
      (tool) => tool.name === 'create_agent',
    )!
    const pending = create.call({
      profile_slug: 'willow',
      provider,
      connection: `${provider}:sign-in`,
      model: `fake-${provider}-a`,
    })
    await vi.waitFor(() =>
      expect(
        f.rawRuntimes.some((runtime) => vi.mocked(runtime.listModels).mock.calls.length > 0),
      ).toBe(true),
    )
    f.state.revision += 2
    wait.resolve()
    expect((await pending).structured).not.toMatchObject({ outcome: 'ok' })
    expect(f.store.agentIdentities().some((row) => row.slug === 'willow')).toBe(false)
  })
}

it('list_profiles publishes named metadata without addresses, secrets or a new model read', async () => {
  const f = fixture()
  const caller = await host.createSession({ provider: 'claude', profileId: 'fern' }, sink)
  f.prepare.mockClear()
  f.create.mockClear()
  const list = agentToolsFor(host, caller.sessionId).tools.find(
    (tool) => tool.name === 'list_profiles',
  )!
  const answer = await list.call({})
  expect(answer.structured).toHaveProperty('connections', [
    {
      id: 'claude:sign-in',
      provider: 'claude',
      name: 'subscription',
      label: 'Claude · subscription',
    },
    { id: 'codex:sign-in', provider: 'codex', name: 'ChatGPT', label: 'Codex · ChatGPT' },
  ])
  expect(answer.text).toContain('Connections')
  expect(f.prepare).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
})

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: launch and resume disclose only a persisted binding and leave genuine legacy NULL absent`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    expect(created).toHaveProperty('connectionId', `${provider}:sign-in`)
    await host.close(created.sessionId, sink)
    const resumed = await host.resumeSession(created.sessionId, sink)
    expect(resumed).toHaveProperty('connectionId', `${provider}:sign-in`)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?').run(created.sessionId)
    const legacy = await host.resumeSession(created.sessionId, sink)
    expect(legacy).not.toHaveProperty('connectionId')
    expect(f.store.connectionOf(created.sessionId)).toBeNull()
  })

  it(`${provider}: the roster and named record retain a default connection even without a model`, async () => {
    const f = fixture()
    const caller = await host.createSession({ provider, profileId: 'fern' }, sink)
    host.createAgent({
      slug: 'willow',
      displayName: 'Willow',
      provider,
      connectionId: `${provider}:sign-in`,
    })
    expect(
      host.profilesVisibleTo().profiles.find((row) => row.profile === 'willow'),
    ).toHaveProperty('connectionId', `${provider}:sign-in`)
    const list = agentToolsFor(host, caller.sessionId).tools.find(
      (tool) => tool.name === 'list_profiles',
    )!
    const roster = await list.call({})
    expect(roster.structured).toHaveProperty(
      'profiles',
      expect.arrayContaining([
        expect.objectContaining({ profile: 'willow', connection_id: `${provider}:sign-in` }),
      ]),
    )
    const record = await list.call({ profile: 'willow' })
    expect(record.structured).toHaveProperty('connection_id', `${provider}:sign-in`)
    f.store.setModelChoice('willow', { provider, model: `fake-${provider}-a`, effort: 'medium' })
    expect(
      host.profilesVisibleTo().profiles.find((row) => row.profile === 'willow')?.defaultModel,
    ).toEqual({
      provider,
      connectionId: `${provider}:sign-in`,
      model: `fake-${provider}-a`,
      effort: 'medium',
    })
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: editing a genuine legacy NULL conversation's model never backfills its binding`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?').run(created.sessionId)
    await host.resumeSession(created.sessionId, sink)
    const answer = await host.setSessionSetting(
      created.sessionId,
      { kind: 'model', model: `fake-${provider}-b` },
      sink,
    )
    expect(answer.settings.pendingModel).toEqual({ value: `fake-${provider}-b` })
    expect(f.store.findLive(created.sessionId)?.model).toBe(`fake-${provider}-b`)
    expect(f.store.connectionOf(created.sessionId)).toBeNull()
    expect(
      db.prepare('SELECT connection_id FROM provider_session WHERE id=?').get(created.sessionId),
    ).toEqual({ connection_id: null })
  })
}

for (const provider of ['claude', 'codex'] as const) {
  for (const changedHome of [null, 'BroBot', 'Willow']) {
    const sameHome = changedHome === 'BroBot'
    it(`${provider}: ${changedHome === null ? 'no' : sameHome ? 'same' : 'different'} home login after judging a default respects the actual folder casing before creation`, async () => {
      const reprovision = vi.fn(async () => 'replaced' as const)
      const f = fixture(false, {
        listProfiles: () => ['fern', 'BroBot', 'Willow'],
        providerAuth: {
          credentialHome: (one, profile) => join(dir, 'fictional-auth', one, profile),
          check: async () => ({
            state: 'usable' as const,
            login: 'account' as const,
            expiresAt: null,
          }),
          reprovision,
          signIn: async () => {
            throw new Error('No fictional sign-in was requested')
          },
          bringTheKeyToItsHomes: async () => null,
          replaceARefusedCopy: async () => 'not-tried' as const,
        },
      })
      const caller = await host.createSession({ provider, profileId: 'fern' }, sink)
      host.setSpawningEnabled(true)
      const judge = host.judgeTheDefaultItNames.bind(host)
      vi.spyOn(host, 'judgeTheDefaultItNames').mockImplementation(async (...args) => {
        const verdict = await judge(...args)
        expect(verdict.ok).toBe(true)
        expect(f.prepare).toHaveBeenCalledWith(provider, 'BroBot')
        if (changedHome !== null) await host.reprovisionProviderAuth(provider, changedHome)
        return verdict
      })
      const before = f.store.agentIdentities()
      const create = agentToolsFor(host, caller.sessionId).tools.find(
        (tool) => tool.name === 'create_agent',
      )!
      const answer = await create.call({
        profile_slug: 'maple',
        provider,
        connection: `${provider}:sign-in`,
        model: `fake-${provider}-a`,
        effort: 'medium',
      })
      if (changedHome === null) expect(reprovision).not.toHaveBeenCalled()
      else expect(reprovision).toHaveBeenCalledExactlyOnceWith(provider, changedHome)
      if (sameHome) {
        expect(answer.structured).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
        expect(f.store.agentIdentities()).toEqual(before)
        expect(f.store.defaultConnectionOf('maple')).toBe(null)
        expect(f.store.modelChoiceOf('maple')).toBe(null)
      } else {
        expect(answer.structured).toMatchObject({ outcome: 'ok' })
        expect(f.store.defaultConnectionOf('maple')).toBe(`${provider}:sign-in`)
      }
    })
  }
}
