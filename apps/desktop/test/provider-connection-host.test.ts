import { neutralHostDeps } from './lib/host-fixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AuthUnavailableError,
  FakeProviderSessions,
  FakeRuntime,
  type FakeSessionHandle,
} from '@brobot2/runtime'
import { CodexRuntime } from '@brobot2/runtime/codex'
import * as codexRuntimeModule from '@brobot2/runtime/codex'
import { ScriptedAppServer } from './lib/scripted-codex-host'
import { threadStartResponse } from '../../../packages/runtime/test/fixtures/codex-protocol'
import { createProviderModules, providerAuthFromModules } from '../src/main/providers'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import {
  ProviderConnectionUnavailable,
  resolveProviderConnection,
} from '../src/main/connections/records'
import type { ProviderAuthOps } from '../src/main/providers/auth-operations'
import {
  readProfileExecution,
  writeProfileExecution,
  type KeptProfileExecution,
} from '../src/main/profile-execution-file'
import { createCodexModule } from '../src/main/providers/codex/index'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'

let db: AppDatabase
const saved = new Set<Provider>()
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
  saved.clear()
  dir = mkdtempSync(join(tmpdir(), 'brocrew-connections-'))
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(async () => {
  await host?.closeAll()
  vi.restoreAllMocks()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function fixture(
  apiKeys?: ApiKeys,
  auth: Partial<Pick<RuntimeHostDeps, 'providerAuth' | 'askTheProvider' | 'providersMoved'>> = {},
  namedConnections = true,
) {
  const store = createSessionStore(db)
  const sessions = new FakeProviderSessions()
  const state: {
    revision: number
    revisionOf?: (provider: Provider) => number
    beforeLaunch?: () => Promise<void>
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
  const resolve = (provider: Provider, id?: string | null) =>
    resolveProviderConnection(db, { provider, connectionId: id, keySaved: saved.has(provider) })
  const connectionFor = vi.fn(resolve)
  const create = vi.fn((provider: Provider) => {
    const runtime = new FakeRuntime(provider, { sessions })
    vi.spyOn(runtime, 'start')
    vi.spyOn(runtime, 'resume')
    vi.spyOn(runtime, 'listModels')
    rawRuntimes.push(runtime)
    return runtime
  })
  const deps = {
    store,
    profileExecution: {
      read: () => readProfileExecution(db),
      write: (kept: KeptProfileExecution) => writeProfileExecution(db, kept),
      owned: true,
    },
    ...(apiKeys === undefined ? {} : { apiKeys }),
    ...auth,
    ...neutralHostDeps(() => dir),
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
  if (namedConnections) Reflect.set(deps, 'connectionFor', connectionFor)
  const revision = vi.fn((provider: Provider) => state.revisionOf?.(provider) ?? state.revision)
  Reflect.set(deps, 'connectionRevision', revision)
  const prepared = vi.fn<NonNullable<RuntimeHostDeps['prepareProviderLaunch']>>(
    async (provider: Provider, profile: string, connection) => {
      if (connection?.authMethod === 'api-key' && !saved.has(provider))
        throw new AuthUnavailableError(provider, 'The selected API key is unavailable')
      return { home: await prepare(provider, profile), runtime: create(provider) }
    },
  )
  Reflect.set(deps, 'prepareProviderLaunch', prepared)
  host = new RuntimeHost(deps)
  return { store, prepare, create, connectionFor, revision, state, deps, rawRuntimes, prepared }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('Codex home preparation uses the once-selected method instead of a newly saved key', async () => {
  const f = fixture()
  const keys = new ApiKeys(dir)
  f.state.revisionOf = (provider) => keys.revision(provider)
  const changed = vi.fn(async () => ({ ok: true as const, authMethod: null }))
  const copied = vi.fn()
  f.prepared.mockImplementation(async (provider, profile, connection) => {
    const module = createCodexModule(
      {
        managedRoot: dir,
        defaultProfile: 'fern',
        homeOf: (name) => join(dir, name, 'codex'),
        profiles: () => ['fern'],
        assertMayOpen: () => {},
      },
      {
        runtime: { command: () => '/fictional/codex' },
        home: {
          provisionHome: (_root, home) => {
            mkdirSync(home, { recursive: true })
          },
          provisionCodexAuth: copied,
          key: {
            isSaved: () => keys.status('codex').set,
            current: async () => {
              await keys.set('codex', 'fictional-willow-key')
              const key = await keys.current('codex')
              await keys.remove('codex')
              return key
            },
            change: changed,
          },
        },
        auth: { command: () => '/fictional/codex' },
      },
    )
    const prepared = await module.prepareLaunch(profile, connection)
    return { home: prepared.home, runtime: f.create(provider) }
  })
  const created = await host.createSession(
    { provider: 'codex', profileId: 'fern', model: 'fake-codex-a' },
    sink,
  )
  expect(changed).not.toHaveBeenCalled()
  expect(keys.revision('codex')).toBe(0)
  expect(copied).toHaveBeenCalled()
  expect(f.revision).not.toHaveBeenCalled()
  expect(f.store.connectionOf(created.sessionId)).toBe('codex:sign-in')
})

for (const provider of ['claude', 'codex'] as const) {
  for (const named of [false, true]) {
    it(`${provider}: give_work starts a fresh conversation on an explicit ${named ? 'connection name' : 'connection id'}`, async () => {
      const f = fixture()
      saved.add(provider)
      f.store.createAgentIdentity({ slug: 'fern', displayName: null, provider }, { by: 'a-person' })
      db.prepare('UPDATE provider_connection SET name = ? WHERE id = ?').run(
        'Fern plan',
        `${provider}:sign-in`,
      )
      const parent = await host.createSession({ provider: 'claude', profileId: 'moss' }, sink)
      const given = await host.giveWork(
        {
          profile: 'fern',
          title: 'Fictional routing check',
          brief: 'Return the fictional result.',
          definition_of_done: 'The fictional result is recorded.',
          provider,
          connectionId: named ? 'Fern plan' : `${provider}:sign-in`,
        },
        { ownerId: agentCallerId(parent.sessionId) },
      )
      expect(given.ok).toBe(true)
      if (!given.ok) throw new Error(given.refusal.reason)
      expect(f.store.connectionOf(given.owner)).toBe(`${provider}:sign-in`)
      expect(f.prepared).toHaveBeenCalledWith(
        provider,
        'fern',
        expect.objectContaining({ id: `${provider}:sign-in` }),
      )
    })
  }

  for (const opening of ['fresh', 'bound resume', 'legacy resume', 'models'] as const) {
    it(`${provider}: a changed-back generation during the final ${opening} wait does not replace the chosen route`, async () => {
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
      f.connectionFor.mockClear()
      f.revision.mockClear()
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
        expect(await pending).toMatchObject({ ok: true })
      } else {
        await expect(pending).resolves.toHaveProperty('sessionId')
      }
      expect(f.revision).not.toHaveBeenCalled()
      expect(
        f.rawRuntimes.some(
          (runtime) =>
            vi.mocked(runtime.start).mock.calls.length > 0 ||
            vi.mocked(runtime.resume).mock.calls.length > 0 ||
            vi.mocked(runtime.listModels).mock.calls.length > 0,
        ),
      ).toBe(true)
      if (sessionId === undefined) {
        expect(db.prepare('SELECT id FROM provider_session').all()).toHaveLength(1)
      } else {
        expect(f.store.connectionOf(sessionId)).toBe(
          opening === 'legacy resume' ? null : `${provider}:sign-in`,
        )
      }
    })
  }

  it(`${provider}: the default command retains the chosen connection with its model`, async () => {
    const f = fixture()
    f.store.createAgentIdentity({ slug: 'fern', displayName: null, provider }, { by: 'a-person' })
    const command = {
      kind: 'setAgentModelAndEffort' as const,
      profileId: 'fern',
      provider,
      model: `fake-${provider}-a`,
      effort: 'medium',
      connectionId: `${provider}:sign-in`,
    }
    await expect(executeRuntimeCommand(host, sink, command)).resolves.toMatchObject({
      ok: true,
      choice: {
        provider,
        model: command.model,
        effort: 'medium',
        connectionId: command.connectionId,
      },
    })
    expect(f.store.modelChoiceOf('fern')).toEqual({
      provider,
      model: command.model,
      effort: 'medium',
      connectionId: command.connectionId,
    })
  })

  it(`${provider}: a new start honors the agent's existing connection default and model`, async () => {
    const f = fixture()
    f.store.createAgentIdentity({ slug: 'fern', displayName: null, provider }, { by: 'a-person' })
    f.store.setModelChoice('fern', { provider, model: `fake-${provider}-a`, effort: 'medium' })
    db.prepare('UPDATE agent_identity SET connection_id=? WHERE slug=?').run(
      `${provider}:sign-in`,
      'fern',
    )
    saved.add(provider)

    const created = await host.createSession({ provider, profileId: 'fern' }, sink)

    const starts = f.rawRuntimes.flatMap((runtime) =>
      vi.mocked(runtime.start).mock.calls.map(([options]) => options),
    )
    expect(starts).toEqual([expect.objectContaining({ model: `fake-${provider}-a` })])
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
    expect(f.prepared).toHaveBeenCalledWith(
      provider,
      'fern',
      expect.objectContaining({ id: `${provider}:sign-in`, authMethod: 'sign-in' }),
    )
  })

  it(`${provider}: the create command records its explicit subscription despite a saved key`, async () => {
    const f = fixture()
    saved.add(provider)
    const command = {
      kind: 'createSession' as const,
      provider,
      profileId: 'fern',
      connectionId: `${provider}:sign-in`,
    }
    const created = (await executeRuntimeCommand(host, sink, command)) as { sessionId: string }
    expect(f.store.connectionOf(created.sessionId)).toBe(command.connectionId)
    const forTheConversation = f.prepared.mock.calls.filter(([, profile]) => profile === 'fern')
    expect(forTheConversation).toEqual([
      [
        provider,
        'fern',
        expect.objectContaining({ id: command.connectionId, authMethod: 'sign-in' }),
      ],
    ])
  })

  it(`${provider}: the create command refuses a missing explicit key without opening a subscription`, async () => {
    const f = fixture()
    const command = {
      kind: 'createSession' as const,
      provider,
      profileId: 'fern',
      connectionId: `${provider}:api-key`,
    }
    await expect(executeRuntimeCommand(host, sink, command)).rejects.toBeInstanceOf(
      AuthUnavailableError,
    )
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([])
  })

  for (const [keySaved, method] of [
    [false, 'sign-in'],
    [true, 'api-key'],
  ] as const) {
    it(`${provider}: an omitted new choice records ${method} once and keeps it after credential changes`, async () => {
      const f = fixture()
      if (keySaved) saved.add(provider)
      const connectionId = `${provider}:${method}`
      const created = await host.createSession({ provider, profileId: 'fern', cwd: dir }, sink)
      const id = created.sessionId
      expect(f.connectionFor).toHaveBeenCalledWith(provider)
      expect(f.prepared).toHaveBeenCalledWith(
        provider,
        'fern',
        expect.objectContaining({ id: connectionId, authMethod: method }),
      )
      expect(f.store.connectionOf(id)).toBe(connectionId)
      expect(created.providerHome).toBe(join(dir, 'fern', provider))
      expect(created).toHaveProperty('connectionId', connectionId)
      expect(await host.look(id, sink, false)).toHaveProperty('connectionId', connectionId)
      await host.close(id, sink)
      expect(await host.look(id, sink, false)).toHaveProperty('connectionId', connectionId)
      if (keySaved) {
        saved.delete(provider)
        await expect(host.resumeSession(id, sink)).rejects.toBeInstanceOf(AuthUnavailableError)
      }
      saved.add(provider)
      await expect(host.resumeSession(id, sink)).resolves.toMatchObject({
        sessionId: id,
        connectionId,
      })
      expect(f.prepared).toHaveBeenLastCalledWith(
        provider,
        'fern',
        expect.objectContaining({ id: connectionId, authMethod: method }),
      )
      expect(f.store.connectionOf(id)).toBe(connectionId)
    })
  }

  for (const whilePreparing of [false, true]) {
    it(`${provider}: a key replaced ${whilePreparing ? 'during preparation' : 'while running'} is applied before sending`, async () => {
      const keys = new ApiKeys(dir)
      await keys.set(provider, 'fictional-first-key')
      saved.add(provider)
      const f = fixture(keys)
      const used: (string | undefined)[] = []
      const entered = deferred()
      const released = deferred()
      f.prepared.mockImplementation(async (kind, profile, connection) => {
        if (profile === 'fern') {
          expect(connection).toMatchObject({ id: `${provider}:api-key`, authMethod: 'api-key' })
          used.push((await keys.current(kind))?.key)
          if (whilePreparing && used.length === 1) {
            entered.resolve()
            await released.promise
          }
        }
        return { home: await f.prepare(kind, profile), runtime: f.create(kind) }
      })
      const events: string[] = []
      let completed = 0
      const by: RuntimeEventSink = {
        ...sink,
        send(message) {
          events.push(message.event.type)
          if (message.event.type === 'turn' && message.event.state === 'completed') completed++
        },
      }
      const creating = host.createSession(
        { provider, profileId: 'fern', connectionId: `${provider}:api-key`, approvalMode: 'auto' },
        by,
      )
      if (whilePreparing) {
        await entered.promise
        await host.setApiKey(provider, 'fictional-second-key')
        released.resolve()
      }
      const created = await creating
      expect(used).toEqual(['fictional-first-key'])

      if (!whilePreparing) await host.setApiKey(provider, 'fictional-second-key')
      await host.send(created.sessionId, 'carry on', by)

      await vi.waitFor(() =>
        expect(events.filter((event) => event === 'user_turn')).toHaveLength(1),
      )
      expect(used).toEqual(['fictional-first-key', 'fictional-second-key'])
      expect(events.filter((event) => event === 'reopened')).toHaveLength(1)
      expect(events.slice(0, events.indexOf('reopened'))).not.toContain('user_turn')
      expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)

      await vi.waitFor(() => expect(completed).toBe(1))
      await host.setApiKey(provider, 'fictional-third-key')
      await host.send(created.sessionId, 'and again', by)
      await vi.waitFor(() => expect(completed).toBe(2))
      expect(used).toEqual(['fictional-first-key', 'fictional-second-key', 'fictional-third-key'])
      expect(events.filter((event) => event === 'reopened')).toHaveLength(2)

      await host.send(created.sessionId, 'unchanged this time', by)
      await vi.waitFor(() => expect(completed).toBe(3))
      expect(events.filter((event) => event === 'user_turn')).toHaveLength(3)
      expect(events.filter((event) => event === 'reopened')).toHaveLength(2)
      expect(used).toHaveLength(3)
      expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([
        { id: created.sessionId },
      ])
      expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)
    })
  }

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

  it(`${provider}: a generation changed during preparation does not refuse the native launch`, async () => {
    const f = fixture()
    const prepare = f.prepare.getMockImplementation()!
    f.prepare.mockImplementation((kind, profile) => {
      f.state.revision += 2
      return prepare(kind, profile)
    })
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    expect(f.revision).not.toHaveBeenCalled()
    expect(f.create).toHaveBeenCalled()
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: resume retains a recorded binding instead of choosing a newly saved key`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=? WHERE id=?').run(
      `${provider}:sign-in`,
      created.sessionId,
    )
    saved.add(provider)
    f.prepare.mockClear()
    f.create.mockClear()
    await expect(host.resumeSession(created.sessionId, sink)).resolves.toHaveProperty('sessionId')
    expect(f.create).toHaveBeenCalled()
    expect(f.prepared).toHaveBeenLastCalledWith(
      provider,
      'fern',
      expect.objectContaining({ id: `${provider}:sign-in`, authMethod: 'sign-in' }),
    )
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: a selected API key that is missing refuses without a subscription fallback`, async () => {
    saved.add(provider)
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)
    saved.delete(provider)
    f.prepare.mockClear()
    f.create.mockClear()
    await expect(host.resumeSession(created.sessionId, sink)).rejects.toBeInstanceOf(
      AuthUnavailableError,
    )
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)
  })

  it(`${provider}: reopening legacy NULL chooses dynamically without backfilling`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?').run(created.sessionId)
    expect(await host.look(created.sessionId, sink, false)).not.toHaveProperty('connectionId')
    saved.add(provider)
    const resumed = await host.resumeSession(created.sessionId, sink)
    expect(resumed).not.toHaveProperty('connectionId')
    expect(resumed.ref).toEqual(created.ref)
    expect(resumed.providerHome).toBe(join(dir, 'fern', provider))
    expect(f.store.connectionOf(created.sessionId)).toBeNull()
    expect(f.prepared).toHaveBeenLastCalledWith(
      provider,
      'fern',
      expect.objectContaining({ id: `${provider}:api-key`, authMethod: 'api-key' }),
    )
  })
}

for (const gesture of ['save', 'check', 'sibling launch', 'earlier sibling launch'] as const) {
  it(`Codex subscription stays subscription when a key ${gesture} occurs between preparation and spawn`, async () => {
    const keys = new ApiKeys(dir)
    if (gesture !== 'save') {
      await keys.set('codex', 'fictional-existing-key')
      saved.add('codex')
    }
    const homeOf = (profile: string) => join(dir, profile, 'codex')
    const change = vi.fn(async (home: string) => {
      rmSync(join(home, 'auth.json'), { force: true })
      return { ok: true as const, authMethod: null }
    })
    const key = {
      isSaved: () => keys.status('codex').set,
      current: () => keys.current('codex'),
      change,
    }
    const modules = createProviderModules(
      (provider) => ({
        managedRoot: dir,
        defaultProfile: 'fern',
        homeOf: (profile) => join(dir, profile, provider),
        profiles: () => ['fern'],
        assertMayOpen: () => {},
      }),
      {
        claude: {
          runtime: { program: () => '/fictional/claude', key: () => null },
          home: {},
          auth: {},
        },
        codex: {
          runtime: { command: () => '/fictional/codex' },
          home: {
            provisionHome: (_root, home) => {
              mkdirSync(home, { recursive: true })
            },
            provisionCodexAuth: (home) => {
              writeFileSync(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }))
            },
            key,
          },
          auth: { command: () => '/fictional/codex', key },
        },
      },
    )
    const f = fixture(keys, {
      providerAuth: providerAuthFromModules(modules),
      askTheProvider: async () => ({ ok: true, answeredARequest: true }),
    })
    const prepared = deferred()
    const released = deferred()
    const modesAtSpawn: string[] = []
    const apiKeysAtWork: unknown[] = []
    let oauthBefore: Buffer | undefined
    let threads = 0
    const modeIn = (home: string) =>
      (JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')) as { auth_mode: string }).auth_mode
    vi.spyOn(codexRuntimeModule, 'createSpawnTransportFactory').mockImplementation(
      () => (context) => {
        if (context.providerHome === homeOf('fern')) {
          expect(modeIn(context.providerHome)).toBe('chatgpt')
          if (!context.apiKeyBound) modesAtSpawn.push(modeIn(context.providerHome))
        }
        const server = new ScriptedAppServer(context.providerHome)
        const request = server.request.bind(server)
        server.request = (method, params) => {
          if (method === 'thread/start') {
            if (context.apiKeyBound) {
              const calls = server.requests.map((one) => one.method)
              expect(calls[0]).toBe('initialize')
              expect(calls.indexOf('account/login/start')).toBeGreaterThan(0)
              expect(calls.indexOf('account/login/start')).toBeLessThan(
                calls.indexOf('getAuthStatus'),
              )
              expect(calls.indexOf('getAuthStatus')).toBeLessThan(calls.length)
              expect(calls).toContain('account/read')
              const login = server.requests.find((one) => one.method === 'account/login/start')
              expect(login?.params['type']).toBe('apiKey')
              if (context.providerHome === homeOf('fern'))
                apiKeysAtWork.push(login?.params['apiKey'])
            }
            return Promise.resolve(threadStartResponse('fictional-thread-' + ++threads, dir))
          }
          return request(method, params)
        }
        return server
      },
    )
    f.prepared.mockImplementation(async (_provider, profile, connection) => {
      const launch = await modules.codex.prepareLaunch(profile, connection)
      expect(launch.runtime).toBeInstanceOf(CodexRuntime)
      if (profile === 'fern' && connection?.authMethod === 'sign-in') {
        expect(modeIn(launch.home)).toBe('chatgpt')
        oauthBefore = readFileSync(join(launch.home, 'auth.json'))
        prepared.resolve()
        await released.promise
      }
      return launch
    })
    if (gesture === 'earlier sibling launch') {
      mkdirSync(homeOf('fern'), { recursive: true })
      const original = JSON.stringify({ auth_mode: 'chatgpt' })
      writeFileSync(join(homeOf('fern'), 'auth.json'), original)
      const sibling = await host.createSession(
        { provider: 'codex', profileId: 'fern', model: 'gpt-5', connectionId: 'codex:api-key' },
        sink,
      )
      expect(f.store.connectionOf(sibling.sessionId)).toBe('codex:api-key')
      expect(apiKeysAtWork).toEqual(['fictional-existing-key'])
      expect(readFileSync(join(homeOf('fern'), 'auth.json'), 'utf8')).toBe(original)
    }
    const creating = host.createSession(
      { provider: 'codex', profileId: 'fern', model: 'gpt-5', connectionId: 'codex:sign-in' },
      sink,
    )
    await prepared.promise
    if (gesture === 'save') {
      saved.add('codex')
      await host.setApiKey('codex', 'fictional-new-key')
    } else if (gesture === 'check') {
      await expect(host.checkApiKey('codex')).resolves.toMatchObject({ ok: true })
    } else if (gesture === 'sibling launch') {
      const sibling = await host.createSession(
        { provider: 'codex', profileId: 'fern', model: 'gpt-5', connectionId: 'codex:api-key' },
        sink,
      )
      expect(f.store.connectionOf(sibling.sessionId)).toBe('codex:api-key')
      expect(apiKeysAtWork).toEqual(['fictional-existing-key'])
      expect(readFileSync(join(homeOf('fern'), 'auth.json'))).toEqual(oauthBefore)
    }
    released.resolve()
    const created = await creating
    expect(f.store.connectionOf(created.sessionId)).toBe('codex:sign-in')
    expect(modesAtSpawn).toEqual(['chatgpt'])
    expect(readFileSync(join(homeOf('fern'), 'auth.json'))).toEqual(oauthBefore)
    expect(change).not.toHaveBeenCalled()
  })
}

it('uses the prepared adapter runtime for a start', async () => {
  const f = fixture()
  const started = await host.createSession({ provider: 'claude', cwd: dir }, sink)
  expect(started.sessionId).toBeTruthy()
  expect(f.prepared).toHaveBeenCalled()
  expect(f.create.mock.calls.length).toBe(f.prepared.mock.calls.length)
  expect(f.rawRuntimes.some((runtime) => vi.mocked(runtime.start).mock.calls.length > 0)).toBe(true)
})

function authOperations(
  check: ProviderAuthOps['check'],
  probe: NonNullable<ProviderAuthOps['probe']> = check,
): ProviderAuthOps {
  return {
    check,
    probe,
    credentialHome: (provider, profile) => join(dir, profile, provider),
    reprovision: () => {
      throw new Error('Unexpected credential copy')
    },
    signIn: async () => {
      throw new Error('Unexpected sign-in')
    },
    replaceARefusedCopy: async () => 'not-tried',
  }
}

function authErrorFrom(f: ReturnType<typeof fixture>, onAKey = false) {
  let failed: FakeSessionHandle | undefined
  f.prepared.mockImplementation(async (provider, profile) => {
    const runtime = f.create(provider)
    const start = FakeRuntime.prototype.start.bind(runtime)
    vi.mocked(runtime.start).mockImplementation(async (options) => {
      const handle = await start(options)
      const events = handle.events.bind(handle)
      vi.spyOn(handle, 'events').mockImplementation(async function* () {
        for await (const event of events())
          yield event.type === 'error'
            ? { ...event, cause: 'auth' as const, ...(onAKey ? { onAKey: true as const } : {}) }
            : event
      })
      failed = handle
      return handle
    })
    return { home: await f.prepare(provider, profile), runtime }
  })
  return () => failed
}

for (const { succeeds, keyBefore } of [
  { succeeds: false, keyBefore: false },
  { succeeds: true, keyBefore: false },
  { succeeds: true, keyBefore: true },
]) {
  it(`a selected Claude sign-in ${succeeds ? 'clears' : 'keeps'} its rejection after a ${succeeds ? 'confirmed' : 'failed'} probe when a key was saved ${keyBefore ? 'before' : 'after'} the rejection`, async () => {
    const keys = new ApiKeys(dir)
    if (keyBefore) await keys.set('claude', 'fictional-saved-before-rejection')
    const ready = { state: 'usable' as const, login: 'account' as const, expiresAt: null }
    const check = vi.fn(async () => ready)
    const outcome = succeeds
      ? ready
      : { state: 'unknown' as const, reason: 'Fictional probe failure' }
    const probe = vi.fn(async () => outcome)
    const moved = vi.fn()
    const f = fixture(keys, { providerAuth: authOperations(check, probe), providersMoved: moved })
    const failed = authErrorFrom(f)
    await host.createSession(
      { provider: 'claude', profileId: 'fern', connectionId: 'claude:sign-in' },
      sink,
    )
    expect(failed()).toBeDefined()
    moved.mockClear()
    failed()!.simulateError('Fictional rejected sign-in', true)
    await vi.waitFor(() => {
      expect(moved).toHaveBeenCalledWith({ what: 'login', provider: 'claude' })
    })
    if (!keyBefore) await keys.set('claude', 'fictional-saved-after-rejection')
    const revision = keys.revision('claude')
    const command = {
      kind: 'checkProviderAuth' as const,
      provider: 'claude' as const,
      profileId: 'fern',
      connectionId: 'claude:sign-in',
    }
    expect(await executeRuntimeCommand(host, sink, command)).toMatchObject({ state: 'stale' })
    expect(probe).not.toHaveBeenCalled()
    expect(await executeRuntimeCommand(host, sink, { ...command, probe: true })).toEqual(outcome)
    expect(await executeRuntimeCommand(host, sink, command)).toMatchObject({
      state: succeeds ? 'usable' : 'stale',
    })
    expect(probe).toHaveBeenCalledExactlyOnceWith(
      'claude',
      'fern',
      expect.any(AbortSignal),
      expect.objectContaining({ id: 'claude:sign-in' }),
    )
    expect(keys.status('claude').set).toBe(true)
    expect(keys.revision('claude')).toBe(revision)
  })
}

for (const condition of ['api', 'api-untagged', 'key-tagged', 'older-login'] as const) {
  it(`ignores unrelated Claude sign-in rejection from ${condition}`, async () => {
    const keys = new ApiKeys(dir)
    const api = condition === 'api' || condition === 'api-untagged'
    if (api) await keys.set('claude', 'fictional-launch-key')
    const ready = { state: 'usable' as const, login: 'account' as const, expiresAt: null }
    const check = vi.fn(async () => ready)
    const moved = vi.fn()
    const f = fixture(keys, { providerAuth: authOperations(check), providersMoved: moved })
    const failed = authErrorFrom(f, condition === 'api' || condition === 'key-tagged')
    const send = vi.fn<RuntimeEventSink['send']>()
    await host.createSession(
      {
        provider: 'claude',
        profileId: 'fern',
        connectionId: api ? 'claude:api-key' : 'claude:sign-in',
      },
      { ...sink, send },
    )
    if (api) await keys.remove('claude')
    if (condition === 'older-login') host.providerSetupCompleted('claude', 'signIn')
    moved.mockClear()
    failed()!.simulateError('Fictional unrelated failure', true)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'error',
            cause: 'auth',
            message: 'Fictional unrelated failure',
          }),
        }),
      )
    })
    expect(moved).not.toHaveBeenCalledWith({ what: 'login', provider: 'claude' })
    expect(
      await executeRuntimeCommand(host, sink, {
        kind: 'checkProviderAuth',
        provider: 'claude',
        profileId: 'fern',
        connectionId: 'claude:sign-in',
      }),
    ).toEqual(ready)
    expect(check).toHaveBeenCalledTimes(1)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: the real auth command canonicalizes its connection name before checking`, async () => {
    const check = vi.fn(async () => ({ state: 'unknown' as const, reason: 'Fictional status' }))
    const f = fixture(undefined, { providerAuth: authOperations(check) })
    db.prepare('UPDATE provider_connection SET name = ? WHERE id = ?').run(
      'Fictional subscription',
      `${provider}:sign-in`,
    )
    await executeRuntimeCommand(host, sink, {
      kind: 'checkProviderAuth',
      provider,
      profileId: 'fern',
      connectionId: 'Fictional subscription',
    })
    expect(f.connectionFor).toHaveBeenCalledExactlyOnceWith(provider, 'Fictional subscription')
    expect(check).toHaveBeenCalledExactlyOnceWith(
      provider,
      'fern',
      expect.any(AbortSignal),
      expect.objectContaining({ id: `${provider}:sign-in`, authMethod: 'sign-in' }),
    )
    expect(f.prepared).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: an unknown auth connection fails before any provider or home work`, async () => {
    const check = vi.fn(async () => ({ state: 'unknown' as const, reason: 'Fictional status' }))
    const f = fixture(undefined, { providerAuth: authOperations(check) })
    const before = vi.fn(async () => {})
    f.state.beforeLaunch = before
    await expect(
      executeRuntimeCommand(host, sink, {
        kind: 'checkProviderAuth',
        provider,
        connectionId: 'missing-fictional-connection',
      }),
    ).rejects.toBeInstanceOf(ProviderConnectionUnavailable)
    expect(check).not.toHaveBeenCalled()
    expect(before).not.toHaveBeenCalled()
    expect(f.prepared).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: missing named-connection capability cannot fall back to a legacy auth check`, async () => {
    const check = vi.fn(async () => ({ state: 'unknown' as const, reason: 'Fictional status' }))
    const f = fixture(undefined, { providerAuth: authOperations(check) }, false)
    const before = vi.fn(async () => {})
    f.state.beforeLaunch = before
    expect(
      await executeRuntimeCommand(host, sink, {
        kind: 'checkProviderAuth',
        provider,
        connectionId: `${provider}:sign-in`,
      }),
    ).toEqual({ state: 'unknown', reason: 'This app build cannot check a named connection.' })
    expect(check).not.toHaveBeenCalled()
    expect(before).not.toHaveBeenCalled()
    expect(f.prepared).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: a named sign-in probe does not join a legacy mode probe`, async () => {
    const hold = deferred()
    const probe = vi.fn(async () => {
      await hold.promise
      return { state: 'unknown' as const, reason: 'Fictional probe' }
    })
    fixture(undefined, { providerAuth: authOperations(probe) })
    const selected = Reflect.apply(host.checkProviderAuth, host, [
      provider,
      'fern',
      true,
      `${provider}:sign-in`,
    ])
    const legacy = host.checkProviderAuth(provider, 'fern', true)
    try {
      await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
    } finally {
      hold.resolve()
      await Promise.all([selected, legacy])
    }
  })

  it(`${provider}: aliases of one selected connection still coalesce their manual probes`, async () => {
    const hold = deferred()
    const probe = vi.fn(async () => {
      await hold.promise
      return { state: 'unknown' as const, reason: 'Fictional probe' }
    })
    fixture(undefined, { providerAuth: authOperations(probe) })
    db.prepare('UPDATE provider_connection SET name = ? WHERE id = ?').run(
      'Fictional plan',
      `${provider}:sign-in`,
    )
    const first = Reflect.apply(host.checkProviderAuth, host, [
      provider,
      'fern',
      true,
      `${provider}:sign-in`,
    ])
    const second = Reflect.apply(host.checkProviderAuth, host, [
      provider,
      'fern',
      true,
      'fictional plan',
    ])
    try {
      expect(first).toBe(second)
      await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1))
    } finally {
      hold.resolve()
      await Promise.all([first, second])
    }
  })
}
