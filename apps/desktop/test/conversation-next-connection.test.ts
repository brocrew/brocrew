import { afterEach, expect, it, vi } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  FakeLaunchGate,
  FakeProcessExit,
  AuthUnavailableError,
} from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { listProviderConnections, resolveProviderConnection } from '../src/main/connections/records'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { fixtureProviderConfig, neutralHostDeps, syntheticProviderHome } from './lib/host-fixture'

let world: AServiceWorld
let host: RuntimeHost

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a failed connection pick rolls back its pair and names the session table`, async () => {
    const f = fixture(provider)
    const created = await f.start()
    const before = world.store.whatItRunsOn(created.sessionId)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.spyOn(world.store, 'aPersonSetItsModelOrEffort').mockImplementationOnce(() => {
      throw Object.assign(new Error('fictional full disk'), { code: 'SQLITE_FULL' })
    })
    const change = {
      kind: 'model' as const,
      model: 'fictional-large',
      connectionId: `${provider}:sign-in`,
    }
    await expect(host.setSessionSetting(created.sessionId, change, world.window)).rejects.toThrow(
      'could not save',
    )
    expect(world.store.whatItRunsOn(created.sessionId)).toEqual(before)
    expect(world.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining(`session=${created.sessionId} table=provider_session code=SQLITE_FULL`),
    )
    write.mockRestore()
    await expect(host.setSessionSetting(created.sessionId, change, world.window)).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          nextConnection: expect.objectContaining({
            connectionId: `${provider}:sign-in`,
            model: 'fictional-large',
            effort: 'low',
          }),
        }),
      }),
    )
  })
}

afterEach(async () => {
  await host?.closeAll()
  await world?.cleanUp()
  vi.restoreAllMocks()
})

function fixture(
  provider: Provider,
  options: {
    gate?: FakeLaunchGate
    exit?: FakeProcessExit
    modelsRead?: (provider: Provider) => Promise<void>
    beforePrepare?: (provider: Provider, connection?: ProviderConnection) => void
  } = {},
) {
  world = aServiceWorld()
  world.anAgent('fern', 'normal', provider)
  const native = new FakeProviderSessions()
  const homeOf = syntheticProviderHome(() => world.folder)
  const launches: { connection: ProviderConnection | undefined; runtime: FakeRuntime }[] = []
  let serial = 0
  host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    createRuntime: (p) => new FakeRuntime(p, { sessions: native, ...options }),
    prepareProviderHome: homeOf,
    providerHomePath: homeOf,
    connectionFor: (p, connectionId) =>
      resolveProviderConnection(world.db, { provider: p, connectionId, keySaved: true }),
    listConnections: () => listProviderConnections(world.db, provider),
    prepareProviderLaunch: async (p, profile, connection) => {
      options.beforePrepare?.(p, connection)
      const runtime = new FakeRuntime(p, { sessions: native, ...options })
      vi.spyOn(runtime, 'start')
      vi.spyOn(runtime, 'resume')
      vi.spyOn(runtime, 'listModels').mockImplementation(async () => {
        await options.modelsRead?.(p)
        return ['small', 'large'].map((size) => ({
          id: `fictional-${size}`,
          label: size,
          isDefault: size === 'small' ? (true as const) : undefined,
          efforts: [{ id: 'low', label: 'Low' }],
          defaultEffort: 'low',
        }))
      })
      launches.push({ connection, runtime })
      return { home: homeOf(p, profile), runtime }
    },
    listProfiles: () => ['brobot', 'fern'],
    resolveCwd: () => world.folder,
    readProviderConfig: fixtureProviderConfig,
    newSessionId: () => `fictional-next-connection-${++serial}`,
  })
  const start = () =>
    host.createSession(
      {
        provider,
        profileId: 'fern',
        connectionId: `${provider}:api-key`,
        model: 'fictional-small',
      },
      world.window,
    )
  const nativeLaunches = () =>
    launches.filter(
      ({ runtime }) =>
        vi.mocked(runtime.start).mock.calls.length + vi.mocked(runtime.resume).mock.calls.length >
        0,
    )
  return { start, launches, nativeLaunches }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 ${provider}: an explicit connection pick reaches the next message on the same native conversation`, async () => {
    const f = fixture(provider)
    const created = await f.start()
    const before = f.nativeLaunches().length
    const change = {
      kind: 'model' as const,
      model: 'fictional-large',
      connectionId: `${provider}:sign-in`,
    }
    await host.setSessionSetting(created.sessionId, change, world.window)
    expect(world.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
    expect(f.nativeLaunches()).toHaveLength(before)
    await host.send(created.sessionId, 'Continue the fictional bakery plan.', world.window)
    await vi.waitFor(() => expect(f.nativeLaunches()).toHaveLength(before + 1))
    const next = f.nativeLaunches().at(-1)!
    expect(next.connection?.id).toBe(`${provider}:sign-in`)
    expect(next.runtime.resume).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: created.ref!.sessionId }),
      expect.objectContaining({ model: 'fictional-large' }),
    )
    expect(world.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
  })

  it(`v4 ${provider}: a never-started row accepts a pick and carries it to its replacement`, async () => {
    const f = fixture(provider)
    world.store.create({
      id: 'fictional-unstarted',
      provider,
      profileId: 'fern',
      cwd: world.folder,
      model: 'fictional-small',
      approvalMode: 'ask',
      connectionId: `${provider}:api-key`,
    })
    const change = {
      kind: 'model' as const,
      model: 'fictional-large',
      connectionId: `${provider}:sign-in`,
    }
    await expect(
      host.setSessionSetting('fictional-unstarted', change, world.window),
    ).resolves.toHaveProperty('settings.model', 'fictional-large')
    await host.setApprovalMode('fictional-unstarted', 'auto', world.window)
    await host.send('fictional-unstarted', 'Start the fictional bakery plan.', world.window)
    const nextId = host.tookItsPlace('fictional-unstarted')
    expect(nextId).not.toBeNull()
    expect(world.store.connectionOf(nextId!)).toBe(`${provider}:sign-in`)
    expect(world.store.findLive(nextId!)?.approvalMode).toBe('auto')
    const launched = f.nativeLaunches().at(-1)!
    expect(launched.connection?.id).toBe(`${provider}:sign-in`)
    expect(launched.runtime.start).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fictional-large' }),
    )
  })
}

it('v4 the existing setting command carries an explicit connection through the actual wire', async () => {
  const f = fixture('codex')
  const created = await f.start()
  const command = {
    kind: 'setSessionSetting' as const,
    sessionId: created.sessionId,
    body: { kind: 'model' as const, value: 'fictional-large', connectionId: 'codex:sign-in' },
  }
  const parsed = runtimeCommandSchema.parse(command)
  expect(parsed).toMatchObject(command)
  await executeRuntimeCommand(host, world.window, parsed)
  expect(world.store.connectionOf(created.sessionId)).toBe('codex:sign-in')
})

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 ${provider}: a queued switch waits for the current turn and carries the message once`, async () => {
    const f = fixture(provider)
    const created = await f.start()
    const first = f.nativeLaunches()[0]!
    const handle = await vi.mocked(first.runtime.start).mock.results[0]!.value
    await host.send(created.sessionId, 'First fictional bakery task.', world.window)
    await vi.waitFor(() => expect(handle.status()).toBe('waiting_permission'))
    const changed = await host.setSessionSetting(
      created.sessionId,
      {
        kind: 'model',
        model: 'fictional-large',
        connectionId: `${provider}:sign-in`,
      },
      world.window,
    )
    expect(changed.settings.nextConnection).toEqual({
      connectionId: `${provider}:sign-in`,
      model: 'fictional-large',
      effort: 'low',
    })
    await host.send(created.sessionId, 'Second fictional bakery task.', world.window)
    expect(handle.status()).toBe('waiting_permission')
    expect(f.nativeLaunches()).toHaveLength(1)
    await host.respondPermission(
      created.sessionId,
      'turn_1_perm',
      { outcome: 'allow' },
      world.window,
    )
    await vi.waitFor(() => expect(f.nativeLaunches()).toHaveLength(2))
    const resumed = f.nativeLaunches()[1]!
    expect(resumed.connection?.id).toBe(`${provider}:sign-in`)
    expect(resumed.runtime.resume).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: created.ref!.sessionId }),
      expect.objectContaining({ model: 'fictional-large' }),
    )
    await vi.waitFor(() =>
      expect(
        world.window.messages.filter(
          ({ event }) =>
            event.type === 'user_turn' && event.text === 'Second fictional bakery task.',
        ),
      ).toHaveLength(1),
    )
    expect(host.tookItsPlace(created.sessionId)).toBeNull()
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 ${provider}: a later pick back to the current connection supersedes the pending switch`, async () => {
    const f = fixture(provider)
    const created = await f.start()
    await host.setSessionSetting(
      created.sessionId,
      { kind: 'model', model: 'fictional-large', connectionId: `${provider}:sign-in` },
      world.window,
    )
    const answer = await host.setSessionSetting(
      created.sessionId,
      { kind: 'model', model: 'fictional-small', connectionId: `${provider}:api-key` },
      world.window,
    )
    expect(world.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)
    expect(answer.settings.nextConnection).toBeUndefined()
    await host.send(created.sessionId, 'Use the final fictional choice.', world.window)
    expect(f.nativeLaunches()).toHaveLength(1)
  })
}

function refusedKeyRow(provider: Provider): string {
  const id = 'fictional-refused-key-row'
  world.store.create({
    id,
    provider,
    profileId: 'fern',
    cwd: world.folder,
    model: 'fictional-small',
    reasoningEffort: 'low',
    approvalMode: 'ask',
    connectionId: `${provider}:api-key`,
  })
  world.store.append(
    id,
    0,
    {
      type: 'error',
      message: 'Fictional API key refused.',
      fatal: true,
      cause: 'auth',
      onAKey: true,
    },
    1000,
  )
  world.store.append(id, 1, { type: 'status', state: 'errored' }, 1001)
  return id
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 ${provider}: refused key then a person's pick keeps its provider and connection in the replacement`, async () => {
    const f = fixture(provider)
    const failed = refusedKeyRow(provider)
    expect(world.store.recordedOne(failed)?.neverStarted).toBe(true)
    const other = provider === 'claude' ? 'codex' : 'claude'
    expect(world.store.setAgentProvider('fern', other)).toBe(true)
    await host.setSessionSetting(
      failed,
      { kind: 'model', model: 'fictional-large', connectionId: `${provider}:sign-in` },
      world.window,
    )
    await host.send(failed, 'Continue using the person’s fictional choice.', world.window)
    const replacement = host.tookItsPlace(failed)!
    expect(replacement).not.toBeNull()
    expect(world.store.recordedOne(replacement)?.provider).toBe(provider)
    expect(world.store.connectionOf(replacement)).toBe(`${provider}:sign-in`)
    expect(f.nativeLaunches().at(-1)!.connection?.id).toBe(`${provider}:sign-in`)
    expect(f.nativeLaunches().at(-1)!.runtime.start).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fictional-large', reasoningEffort: 'low' }),
    )
    await host.setSessionSetting(
      failed,
      { kind: 'model', model: 'fictional-small', connectionId: `${provider}:api-key` },
      world.window,
    )
    expect(world.store.connectionOf(replacement)).toBe(`${provider}:api-key`)
    expect(world.store.whatItRunsOn(replacement)?.model).toBe('fictional-small')
    expect(world.store.connectionOf(failed)).toBe(`${provider}:sign-in`)
  })

  it(`v4 ${provider}: without a person's pick replacement still follows the agent's current provider`, async () => {
    fixture(provider)
    const failed = refusedKeyRow(provider)
    const other = provider === 'claude' ? 'codex' : 'claude'
    expect(world.store.setAgentProvider('fern', other)).toBe(true)
    await host.send(failed, 'Start the next fictional task.', world.window)
    const replacement = host.tookItsPlace(failed)!
    expect(world.store.recordedOne(replacement)?.provider).toBe(other)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 edge ${provider}: a pick made during startup reaches the next message`, async () => {
    const gate = new FakeLaunchGate()
    const f = fixture(provider, { gate })
    const creating = f.start()
    await vi.waitFor(() => expect(gate.held).toBe(1))
    const picking = host.setSessionSetting(
      'fictional-next-connection-1',
      { kind: 'model', model: 'fictional-large', connectionId: `${provider}:sign-in` },
      world.window,
    )
    const checked = expect(picking).resolves.toHaveProperty(
      'settings.nextConnection.connectionId',
      `${provider}:sign-in`,
    )
    gate.release()
    const [created] = await Promise.all([creating, checked])
    await host.send(created.sessionId, 'Use the fictional startup choice.', world.window)
    await vi.waitFor(() => expect(f.nativeLaunches()).toHaveLength(2))
    expect(f.nativeLaunches()[1]!.connection?.id).toBe(`${provider}:sign-in`)
  })

  it(`v4 edge ${provider}: a pick made while stopping is kept for the next start`, async () => {
    const exit = new FakeProcessExit()
    const f = fixture(provider, { exit })
    const created = await f.start()
    const stopping = host.close(created.sessionId, world.window)
    try {
      await expect(
        host.setSessionSetting(
          created.sessionId,
          { kind: 'model', model: 'fictional-large', connectionId: `${provider}:sign-in` },
          world.window,
        ),
      ).resolves.toHaveProperty('thePick')
      expect(world.store.whatItRunsOn(created.sessionId)?.model).toBe('fictional-large')
      expect(world.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
      expect(exit.isConfirmed).toBe(false)
    } finally {
      exit.confirm()
      await stopping
    }
    await host.send(created.sessionId, 'Use the fictional stopped choice.', world.window)
    await vi.waitFor(() => expect(f.nativeLaunches()).toHaveLength(2))
    expect(f.nativeLaunches()[1]!.connection?.id).toBe(`${provider}:sign-in`)
  })

  it(`v4 edge ${provider}: a manual connection pick leaves planning on its normal reopen`, async () => {
    const f = fixture(provider)
    const created = await f.start()
    await host.setSessionSetting(created.sessionId, { kind: 'planMode', on: true }, world.window)
    await host.setSessionSetting(
      created.sessionId,
      { kind: 'model', model: 'fictional-large', connectionId: `${provider}:sign-in` },
      world.window,
    )
    await host.send(created.sessionId, 'Continue on the fictional connection.', world.window)
    await vi.waitFor(() => expect(f.nativeLaunches()).toHaveLength(2))
    const resumed = f.nativeLaunches()[1]!
    expect(resumed.connection?.id).toBe(`${provider}:sign-in`)
    const handle = await vi.mocked(resumed.runtime.resume).mock.results[0]!.value
    expect(handle.settings.planMode.requested).toBe(false)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 edge ${provider}: a model pick during stopping writes the next start without calling the closing provider`, async () => {
    const exit = new FakeProcessExit()
    const f = fixture(provider, { exit })
    const created = await f.start()
    const handle = await vi.mocked(f.nativeLaunches()[0]!.runtime.start).mock.results[0]!.value
    const setModel = vi.spyOn(handle, 'setModel')
    const stopping = host.close(created.sessionId, world.window)
    try {
      await host.setSessionSetting(
        created.sessionId,
        { kind: 'model', model: 'fictional-large', connectionId: `${provider}:api-key` },
        world.window,
      )
      expect(world.store.whatItRunsOn(created.sessionId)?.model).toBe('fictional-large')
      expect(setModel).not.toHaveBeenCalled()
      expect(exit.isConfirmed).toBe(false)
    } finally {
      exit.confirm()
      await stopping
    }
    await host.send(created.sessionId, 'Use the fictional model after stopping.', world.window)
    expect(f.nativeLaunches().at(-1)!.runtime.resume).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'fictional-large' }),
    )
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 ${provider}: recorded setting responses keep the chosen connection through model and effort`, async () => {
    fixture(provider)
    const failed = refusedKeyRow(provider)
    const model = await host.setSessionSetting(
      failed,
      { kind: 'model', model: 'fictional-large', connectionId: `${provider}:sign-in` },
      world.window,
    )
    expect(model.settings.nextConnection).toEqual({
      connectionId: `${provider}:sign-in`,
      model: 'fictional-large',
      effort: 'low',
    })
    const effort = await host.setSessionSetting(
      failed,
      { kind: 'reasoningEffort', effort: 'low' },
      world.window,
    )
    expect(effort.settings.nextConnection).toEqual(model.settings.nextConnection)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 race ${provider}: a delayed pick writes nothing when its replacement changed provider`, async () => {
    let release!: () => void
    let naming = false
    const catalogue = new Promise<void>((done) => {
      release = done
    })
    fixture(provider, {
      modelsRead: async (asked) => {
        if (asked !== provider) return
        naming = true
        await catalogue
      },
    })
    const failed = refusedKeyRow(provider)
    const other = provider === 'claude' ? 'codex' : 'claude'
    expect(world.store.setAgentProvider('fern', other)).toBe(true)
    const picking = host
      .setSessionSetting(
        failed,
        { kind: 'model', model: 'fictional-large', connectionId: `${provider}:sign-in` },
        world.window,
      )
      .then(
        () => null,
        (error: unknown) => error,
      )
    await vi.waitFor(() => expect(naming).toBe(true))
    await host.send(failed, 'Start the concurrent fictional task.', world.window)
    const replacement = host.tookItsPlace(failed)!
    expect(world.store.recordedOne(replacement)?.provider).toBe(other)
    const before = world.store.whatItRunsOn(replacement)
    const connection = world.store.connectionOf(replacement)
    release()
    const error = await picking
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Provider changed. Pick again.')
    expect(world.store.whatItRunsOn(replacement)).toEqual(before)
    expect(world.store.connectionOf(replacement)).toBe(connection)
    expect(world.store.connectionOf(failed)).toBe(`${provider}:api-key`)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 ${provider}: a picked key removed before the next message fails once without a subscription fallback`, async () => {
    let saved = true
    const prepare = vi.fn((asked: Provider, connection?: ProviderConnection) => {
      if (connection?.authMethod === 'api-key' && !saved)
        throw new AuthUnavailableError(asked, 'The selected API key is unavailable')
    })
    const f = fixture(provider, { beforePrepare: prepare })
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const created = await host.createSession(
      {
        provider,
        profileId: 'fern',
        connectionId: `${provider}:sign-in`,
        model: 'fictional-small',
        reasoningEffort: 'low',
      },
      world.window,
    )
    await host.setSessionSetting(
      created.sessionId,
      {
        kind: 'model',
        model: 'fictional-small',
        connectionId: `${provider}:api-key`,
      },
      world.window,
    )
    saved = false
    prepare.mockClear()
    const before = f.nativeLaunches().length
    await host.send(created.sessionId, 'Continue the fictional missing-key task.', world.window)
    await vi.waitFor(() =>
      expect(warnings).toHaveBeenCalledWith(
        expect.stringContaining('for the messages it held: The selected API key is unavailable'),
      ),
    )
    expect(world.store.recordedOne(created.sessionId)?.status).toBe('ended')
    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      provider,
      expect.objectContaining({
        id: `${provider}:api-key`,
        authMethod: 'api-key',
      }),
    )
    expect(f.nativeLaunches()).toHaveLength(before)
    expect(world.store.connectionOf(created.sessionId)).toBe(`${provider}:api-key`)
    expect(host.tookItsPlace(created.sessionId)).toBeNull()
    await host.setSessionSetting(
      created.sessionId,
      { kind: 'model', model: 'fictional-small', connectionId: `${provider}:sign-in` },
      world.window,
    )
    await host.send(created.sessionId, 'Retry after the explicit fictional pick.', world.window)
    await vi.waitFor(() => expect(f.nativeLaunches()).toHaveLength(before + 1))
    expect(f.nativeLaunches().at(-1)!.connection?.id).toBe(`${provider}:sign-in`)
  })
}
