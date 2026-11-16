import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { FakeProviderSessions, FakeRuntime, type ModelChoice } from '@brobot2/runtime'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { fixtureProviderConfig, neutralHostDeps, syntheticProviderHome } from './lib/host-fixture'
import { userProviderHomePath } from '../src/main/adopt/user-homes'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { ModelCatalogues } from '../src/main/connections/catalogues'

let world: AServiceWorld
let host: RuntimeHost
afterEach(async () => {
  await host?.closeAll()
  await world?.cleanUp()
  vi.restoreAllMocks()
})

function fixture(
  provider: Provider,
  namedConnections = true,
  scopedHomes = false,
  effortForA = 'medium',
  readNative = false,
) {
  world = aServiceWorld()
  world.anAgent('fern', 'normal', provider)
  const sessions = new FakeProviderSessions()
  const prepareHome = syntheticProviderHome(() => world.folder)
  const a: ProviderConnection = {
    id: 'endpoint-a',
    provider,
    name: 'Endpoint A',
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
  const b: ProviderConnection = { ...a, id: 'endpoint-b', name: 'Endpoint B' }
  const rows = [a, b]
  const homeOf = vi.fn((p: Provider, profile: string, id?: string) => {
    const legacy = join(world.folder, 'provider-homes', profile, p)
    const row = rows.find((one) => one.id === id)
    return row === undefined ? legacy : join(legacy, row.id)
  })
  for (const row of rows)
    world.db
      .prepare(
        'INSERT INTO provider_connection(id, provider, name, auth_method, credential_source) VALUES(?,?,?,?,?)',
      )
      .run(row.id, row.provider, row.name, row.authMethod, row.credentialSource)
  const resolve = vi.fn((p: Provider, id?: string | null): ProviderConnection => {
    const row = rows.find((one) => one.id === (id === 'Endpoint A' ? a.id : id))
    return row ?? { ...a, id: id ?? `${p}:sign-in`, provider: p }
  })
  const runtimes: FakeRuntime[] = []
  const prepare = vi.fn<NonNullable<RuntimeHostDeps['prepareProviderLaunch']>>(
    async (p, profile, row) => {
      const scope = rows.findIndex((one) => one.id === row?.id)
      const suffix = scope < 0 ? 'legacy' : scope === 0 ? 'a' : 'b'
      const effort = scope < 0 ? 'low' : scope === 0 ? effortForA : 'high'
      const models: ModelChoice[] = [
        {
          id: `model-${suffix}`,
          label: suffix,
          isDefault: true,
          efforts: [{ id: effort, label: effort }],
          defaultEffort: effort,
        },
        {
          id: 'shared-model',
          label: 'Shared name',
          efforts: [{ id: effort, label: effort }],
          defaultEffort: effort,
        },
      ]
      const runtime = new FakeRuntime(p, { sessions })
      vi.spyOn(runtime, 'listModels').mockResolvedValue(models)
      vi.spyOn(runtime, 'start')
      vi.spyOn(runtime, 'resume')
      runtimes.push(runtime)
      const home = scopedHomes ? homeOf(p, profile, row?.id) : prepareHome(p, profile)
      if (scopedHomes) mkdirSync(home, { recursive: true })
      return { home, runtime }
    },
  )
  const nativePath = vi.fn<RuntimeHostDeps['nativeTranscriptPath']>((_p, home, ref) =>
    readNative ? join(home, `fixture-${ref.sessionId}.jsonl`) : null,
  )
  let number = 0
  host = new RuntimeHost({
    ...neutralHostDeps(() => world.folder),
    store: world.store,
    nativeTranscriptPath: nativePath,
    createRuntime: (p) => new FakeRuntime(p, { sessions }),
    prepareProviderHome: prepareHome,
    providerHomePath: scopedHomes ? homeOf : prepareHome,
    prepareProviderLaunch: prepare,
    ...(namedConnections ? { connectionFor: resolve } : {}),
    listProfiles: () => ['brobot', 'fern'],
    resolveCwd: () => world.folder,
    readProviderConfig: fixtureProviderConfig,
    newSessionId: () => `fictional-launch-${++number}`,
  })
  world.store.setModelChoice('fern', {
    provider,
    model: 'model-b',
    effort: 'high',
    connectionId: b.id,
  })
  const launched = () => runtimes.flatMap((runtime) => vi.mocked(runtime.start).mock.calls)
  const resumed = () => runtimes.flatMap((runtime) => vi.mocked(runtime.resume).mock.calls)
  const closedOn = async (connectionId = a.id) => {
    const created = await host.createSession(
      {
        provider,
        profileId: 'fern',
        connectionId,
        cwd: world.folder,
        model: 'shared-model',
        reasoningEffort: 'medium',
      },
      world.window,
    )
    await host.close(created.sessionId, world.window)
    return created
  }
  return { a, b, prepare, resolve, launched, resumed, homeOf, closedOn, nativePath }
}

function recordedOn(provider: Provider, id: string, thread: string, connectionId: string | null) {
  world.store.adopt({
    id,
    provider,
    sessionId: thread,
    cwd: world.folder,
    profileId: 'fern',
    createdAt: world.clock,
    updatedAt: world.clock,
  })
  world.db.prepare('UPDATE provider_session SET connection_id=? WHERE id=?').run(connectionId, id)
}

function keptFile(provider: Provider, home: string, thread: string): string {
  const file =
    provider === 'claude'
      ? join(home, 'debug', `${thread}.txt`)
      : join(home, 'generated_images', thread, 'fictional.png')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'Fictional retained provider file')
  return provider === 'claude' ? file : dirname(file)
}

for (const provider of ['claude', 'codex'] as const) {
  for (const id of ['Endpoint A', 'endpoint-a']) {
    it(`${provider}: agent default save resolves ${id} before using A's cached catalogue`, async () => {
      const f = fixture(provider)
      await host.modelList(provider, 'fern')
      await host.modelList(provider, 'fern', f.b.id)
      await host.modelList(provider, 'fern', f.a.id)
      f.resolve.mockClear()
      f.prepare.mockClear()
      const saved = await host.setAgentModelAndEffort('fern', {
        provider,
        model: 'model-a',
        effort: null,
        connectionId: id,
      })
      expect(saved).toEqual({
        ok: true,
        choice: { provider, model: 'model-a', effort: 'medium', connectionId: f.a.id },
      })
      expect(host.agentModelAndEffort('fern')).toEqual(saved.ok ? saved.choice : null)
      expect(f.resolve.mock.calls[0]).toEqual([provider, id])
      expect(f.prepare).not.toHaveBeenCalled()
      expect(world.store.lastPicked(provider)).toEqual({ model: 'model-a', effort: 'medium' })
    })
  }

  it(`${provider}: omitted-ID save and clear keep their existing delegation`, async () => {
    const f = fixture(provider)
    await host.modelList(provider, 'fern')
    f.resolve.mockClear()
    f.prepare.mockClear()
    expect(
      await host.setAgentModelAndEffort('fern', { provider, model: 'shared-model', effort: 'low' }),
    ).toEqual({
      ok: true,
      choice: { provider, model: 'shared-model', effort: 'low', connectionId: f.b.id },
    })
    expect(await host.setAgentModelAndEffort('fern', null)).toEqual({ ok: true, choice: null })
    expect(world.store.modelChoiceOf('fern')).toBeNull()
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: agent default save keeps absent-resolver compatibility`, async () => {
    const f = fixture(provider, false)
    expect(
      await host.setAgentModelAndEffort('fern', {
        provider,
        model: 'shared-model',
        effort: 'low',
        connectionId: f.a.id,
      }),
    ).toEqual({
      ok: true,
      choice: { provider, model: 'shared-model', effort: 'low', connectionId: f.a.id },
    })
    expect(f.resolve).not.toHaveBeenCalled()
    expect(f.prepare.mock.calls.every((call) => call[2] === undefined)).toBe(true)
  })

  for (const profile of ['fern', 'missing-agent']) {
    it(`${provider}: invalid default connection rejects before ${profile} admission, probes or writes`, async () => {
      const f = fixture(provider)
      const before = world.store.modelChoiceOf('fern')
      const error = new Error('The fictional selected connection is unavailable')
      f.resolve.mockImplementation(() => {
        throw error
      })
      const admitted = vi.spyOn(ModelCatalogues.prototype, 'setAgentModelAndEffort')
      const written = vi.spyOn(world.store, 'setModelChoice')
      const lastPicked = vi.spyOn(world.store, 'aPersonPicked')
      const versions = vi.spyOn(host, 'providerVersions')
      await expect(
        host.setAgentModelAndEffort(profile, {
          provider,
          model: 'shared-model',
          effort: 'medium',
          connectionId: 'missing-route',
        }),
      ).rejects.toBe(error)
      expect(f.resolve).toHaveBeenCalledExactlyOnceWith(provider, 'missing-route')
      expect(admitted).not.toHaveBeenCalled()
      expect(f.prepare).not.toHaveBeenCalled()
      expect(versions).not.toHaveBeenCalled()
      expect(written).not.toHaveBeenCalled()
      expect(lastPicked).not.toHaveBeenCalled()
      expect(world.store.modelChoiceOf('fern')).toEqual(before)
    })
  }

  it(`${provider}: a missing agent with a valid default connection keeps its class refusal`, async () => {
    const f = fixture(provider)
    const written = vi.spyOn(world.store, 'setModelChoice')
    expect(
      await host.setAgentModelAndEffort('missing-agent', {
        provider,
        model: 'shared-model',
        effort: 'medium',
        connectionId: f.a.id,
      }),
    ).toMatchObject({ ok: false, rail: 'no-such-agent' })
    expect(written).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: a valid default connection preserves the identity-provider refusal`, async () => {
    const f = fixture(provider)
    const other = provider === 'claude' ? 'codex' : 'claude'
    world.anAgent('birch', 'normal', other)
    const written = vi.spyOn(world.store, 'setModelChoice')
    expect(
      await host.setAgentModelAndEffort('birch', {
        provider,
        model: 'shared-model',
        effort: 'medium',
        connectionId: f.a.id,
      }),
    ).toMatchObject({
      ok: false,
      rail: 'not-its-provider',
      detail: { profileId: 'birch', provider, itsProvider: other },
    })
    expect(written).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(world.store.modelChoiceOf('birch')).toBeNull()
  })

  for (const action of ['preview', 'delete'] as const) {
    it(`${provider}: ${action} uses A's recorded files and leaves B and legacy files alone`, async () => {
      const f = fixture(provider, true, true)
      const created = await f.closedOn()
      const thread = world.store.recordedOne(created.sessionId)?.providerSessionId
      if (thread == null) throw new Error('The fixture has no provider reference')
      const a = keptFile(provider, f.homeOf(provider, 'fern', f.a.id), thread)
      const b = keptFile(provider, f.homeOf(provider, 'fern', f.b.id), thread)
      const legacy = keptFile(provider, f.homeOf(provider, 'fern'), thread)
      f.homeOf.mockClear()
      f.prepare.mockClear()
      if (action === 'preview') {
        const verdict = host.deleteVerdict(created.sessionId)
        if (!verdict.ok) throw new Error(verdict.refusal)
        expect(
          verdict.parts.find((part) => part.id === `files:${created.sessionId}`)?.paths,
        ).toEqual([a])
        expect(existsSync(a)).toBe(true)
      } else {
        const deleted = await host.deleteConversation(created.sessionId, [
          `files:${created.sessionId}`,
        ])
        expect(deleted).toMatchObject({
          done: true,
          removed: [`files:${created.sessionId}`],
          left: [],
        })
        expect(existsSync(a)).toBe(false)
        expect(world.store.recordedOne(created.sessionId)).not.toBeNull()
      }
      expect(existsSync(b)).toBe(true)
      expect(existsSync(legacy)).toBe(true)
      expect(f.homeOf.mock.calls.every((call) => call[2] === f.a.id)).toBe(true)
      expect(f.prepare).not.toHaveBeenCalled()
      expect(world.store.connectionOf(created.sessionId)).toBe(f.a.id)
    })
  }

  it(`${provider}: recorded import reads A's own transcript without preparation`, async () => {
    const f = fixture(provider, true, true, 'medium', true)
    const id = 'fictional-import'
    const thread = '11111111-1111-4111-8111-111111111111'
    recordedOn(provider, id, thread, f.a.id)
    const original = readFileSync(
      new URL(
        provider === 'claude'
          ? './fixtures/claude-transcript.jsonl'
          : './fixtures/codex-rollout.jsonl',
        import.meta.url,
      ),
      'utf8',
    )
    for (const [connection, marker] of [
      [f.a.id, 'Endpoint A imported message'],
      [f.b.id, 'Endpoint B imported message'],
      [undefined, 'Legacy imported message'],
    ] as const) {
      const home = f.homeOf(provider, 'fern', connection)
      mkdirSync(home, { recursive: true })
      const contents = original
        .replaceAll('PINGPONG', marker)
        .replaceAll('There are 12 lines.', marker)
      writeFileSync(join(home, `fixture-${thread}.jsonl`), contents)
    }
    f.homeOf.mockClear()
    f.prepare.mockClear()
    expect(world.store.ledgerStatus(id).present).toBe(false)
    const result = await host.importRecordedSession(id)
    expect(result).toMatchObject({ outcome: 'imported', readable: true })
    const ledger = JSON.stringify(world.store.events(id))
    expect(ledger).toContain('Endpoint A imported message')
    expect(ledger).not.toContain('Legacy imported message')
    expect(ledger).not.toContain('Endpoint B imported message')
    expect(f.nativePath).toHaveBeenCalledExactlyOnceWith(
      provider,
      join(world.folder, 'provider-homes', 'fern', provider, f.a.id),
      expect.objectContaining({ sessionId: thread }),
    )
    expect(f.prepare).not.toHaveBeenCalled()
    expect(world.store.connectionOf(id)).toBe(f.a.id)
  })

  it(`${provider}: file operations keep built-ins and legacy NULL in their original home`, async () => {
    const f = fixture(provider, true, true)
    for (const id of [`${provider}:sign-in`, `${provider}:api-key`, null]) {
      const created = await f.closedOn(id ?? `${provider}:sign-in`)
      if (id === null)
        world.db
          .prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?')
          .run(created.sessionId)
      const thread = world.store.recordedOne(created.sessionId)?.providerSessionId
      if (thread == null) throw new Error('The fixture has no provider reference')
      const legacy = keptFile(provider, f.homeOf(provider, 'fern'), thread)
      const b = keptFile(provider, f.homeOf(provider, 'fern', f.b.id), thread)
      f.homeOf.mockClear()
      f.prepare.mockClear()
      const verdict = host.deleteVerdict(created.sessionId)
      if (!verdict.ok) throw new Error(verdict.refusal)
      expect(verdict.parts.find((part) => part.id === `files:${created.sessionId}`)?.paths).toEqual(
        [legacy],
      )
      expect(
        await host.deleteConversation(created.sessionId, [`files:${created.sessionId}`]),
      ).toMatchObject({ done: true, left: [] })
      expect(existsSync(legacy)).toBe(false)
      expect(existsSync(b)).toBe(true)
      if (id === null) expect(f.homeOf.mock.calls.every((call) => call.length === 2)).toBe(true)
      expect(f.prepare).not.toHaveBeenCalled()
      expect(world.store.connectionOf(created.sessionId)).toBe(id)
    }
  })

  it(`${provider}: user-home file and import controls stay outside managed lookup`, async () => {
    const f = fixture(provider, true, true)
    const created = await f.closedOn()
    world.db
      .prepare('UPDATE provider_session SET adopted_at=?,profile_id=NULL WHERE id=?')
      .run(world.clock, created.sessionId)
    f.homeOf.mockClear()
    f.prepare.mockClear()
    f.nativePath.mockClear()
    const verdict = host.deleteVerdict(created.sessionId)
    if (!verdict.ok) throw new Error(verdict.refusal)
    expect(verdict.parts.every((part) => part.kind === 'records')).toBe(true)
    expect(await host.importRecordedSession(created.sessionId)).toMatchObject({
      outcome: 'user-home',
    })
    expect(f.homeOf).not.toHaveBeenCalled()
    expect(f.nativePath).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(world.store.connectionOf(created.sessionId)).toBe(f.a.id)
  })

  it(`${provider}: a nonadopted NULL profile uses the managed default home for files`, async () => {
    const f = fixture(provider, true, true)
    const created = await f.closedOn(`${provider}:sign-in`)
    world.db
      .prepare('UPDATE provider_session SET profile_id=NULL WHERE id=?')
      .run(created.sessionId)
    const thread = world.store.recordedOne(created.sessionId)?.providerSessionId
    if (thread == null) throw new Error('The fixture has no provider reference')
    const file = keptFile(provider, f.homeOf(provider, DEFAULT_PROFILE_ID), thread)
    f.homeOf.mockClear()
    const verdict = host.deleteVerdict(created.sessionId)
    if (!verdict.ok) throw new Error(verdict.refusal)
    expect(verdict.parts.find((part) => part.id === `files:${created.sessionId}`)?.paths).toEqual([
      file,
    ])
    expect(f.homeOf.mock.calls.every((call) => call[1] === DEFAULT_PROFILE_ID)).toBe(true)
  })

  for (const state of ['live', 'closed'] as const) {
    for (const change of [
      { kind: 'model', model: 'shared-model' },
      { kind: 'model', model: undefined },
      { kind: 'reasoningEffort', effort: undefined },
    ] as const) {
      it(`${provider}: ${state} ${change.kind} ${change.kind === 'model' && change.model !== undefined ? 'pick' : 'reset'} reads A and retains the agent's B mode`, async () => {
        const f = fixture(provider)
        const created = await host.createSession(
          {
            provider,
            profileId: 'fern',
            connectionId: f.a.id,
            model: 'shared-model',
            reasoningEffort: 'medium',
            cwd: world.folder,
          },
          world.window,
        )
        if (state === 'closed') await host.close(created.sessionId, world.window)
        const changed = await host.setSessionSetting(created.sessionId, change, world.window)
        expect({
          model:
            changed.settings.pendingModel === null
              ? changed.settings.model
              : changed.settings.pendingModel.value,
          reasoningEffort:
            changed.settings.pendingReasoningEffort === null
              ? changed.settings.reasoningEffort
              : changed.settings.pendingReasoningEffort.value,
        }).toEqual({
          model: change.kind === 'model' && change.model === undefined ? 'model-a' : 'shared-model',
          reasoningEffort: 'medium',
        })
        expect(world.store.connectionOf(created.sessionId)).toBe(f.a.id)
        expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
      })
    }
  }

  it(`${provider}: an unlisted recorded model uses A's own fallback effort`, async () => {
    const f = fixture(provider, true, false, 'high')
    const created = await f.closedOn()
    world.store.setReasoningEffort(created.sessionId, null)
    const changed = await host.setSessionSetting(
      created.sessionId,
      { kind: 'model', model: 'fictional-unlisted' },
      world.window,
    )
    expect(changed.settings).toMatchObject({ model: 'fictional-unlisted', reasoningEffort: 'high' })
    expect(changed.thePick).toMatchObject({
      itsAgentsDefault: false,
      because: 'the-list-does-not-hold-it',
    })
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
  })

  it(`${provider}: a legacy NULL model reset keeps old list-call arity and provider defaults`, async () => {
    const f = fixture(provider)
    const created = await f.closedOn(`${provider}:sign-in`)
    world.db
      .prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?')
      .run(created.sessionId)
    const list = vi.spyOn(ModelCatalogues.prototype, 'theListFor')
    const changed = await host.setSessionSetting(
      created.sessionId,
      { kind: 'model', model: undefined },
      world.window,
    )
    expect(changed.settings).toMatchObject({
      model: provider === 'claude' ? 'default' : 'model-legacy',
      reasoningEffort: provider === 'claude' ? 'medium' : 'low',
    })
    expect(list).toHaveBeenCalledExactlyOnceWith(provider, 'fern')
    expect(world.store.connectionOf(created.sessionId)).toBeNull()
    expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
  })

  it(`${provider}: a legacy row with no profile still reads a managed default home`, async () => {
    const f = fixture(provider, true, true)
    const created = await f.closedOn(`${provider}:sign-in`)
    world.db
      .prepare('UPDATE provider_session SET profile_id=NULL,connection_id=NULL WHERE id=?')
      .run(created.sessionId)
    f.homeOf.mockClear()
    f.prepare.mockClear()
    expect((await host.look(created.sessionId, world.window, false)).providerHome).toBe(
      join(world.folder, 'provider-homes', DEFAULT_PROFILE_ID, provider),
    )
    expect(f.homeOf).toHaveBeenCalled()
    expect(
      f.homeOf.mock.calls.every((call) => call.length === 2 && call[1] === DEFAULT_PROFILE_ID),
    ).toBe(true)
    expect(f.prepare).not.toHaveBeenCalled()
    expect(world.store.connectionOf(created.sessionId)).toBeNull()
  })

  for (const adopted of [false, true]) {
    it(`${provider}: a recorded ${adopted ? 'managed adoption' : 'conversation'} reads A's home while the agent defaults to B`, async () => {
      const f = fixture(provider, true, true)
      const created = await f.closedOn()
      expect(created.providerHome).toBe(
        join(world.folder, 'provider-homes', 'fern', provider, f.a.id),
      )
      if (adopted)
        world.db
          .prepare('UPDATE provider_session SET adopted_at=? WHERE id=?')
          .run(world.clock, created.sessionId)
      f.homeOf.mockClear()
      f.prepare.mockClear()
      const shown = await host.look(created.sessionId, world.window, false)
      expect(shown.providerHome).toBe(created.providerHome)
      expect(f.homeOf).toHaveBeenCalled()
      expect(f.homeOf.mock.calls.every((call) => call[2] === f.a.id)).toBe(true)
      expect(f.prepare).not.toHaveBeenCalled()
      expect(world.store.connectionOf(created.sessionId)).toBe(f.a.id)
    })
  }

  it(`${provider}: a user-home adoption bypasses managed home lookup even with a stored ID`, async () => {
    const f = fixture(provider, true, true)
    const created = await f.closedOn()
    world.db
      .prepare('UPDATE provider_session SET adopted_at=?,profile_id=NULL WHERE id=?')
      .run(world.clock, created.sessionId)
    f.homeOf.mockClear()
    f.prepare.mockClear()
    expect((await host.look(created.sessionId, world.window, false)).providerHome).toBe(
      userProviderHomePath(provider),
    )
    expect(f.homeOf).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: recorded built-ins and legacy NULL keep the original home without adopting today's endpoint`, async () => {
    const f = fixture(provider, true, true)
    for (const id of [`${provider}:sign-in`, `${provider}:api-key`, null]) {
      const created = await f.closedOn(id ?? `${provider}:sign-in`)
      if (id === null)
        world.db
          .prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?')
          .run(created.sessionId)
      f.homeOf.mockClear()
      f.prepare.mockClear()
      expect((await host.look(created.sessionId, world.window, false)).providerHome).toBe(
        join(world.folder, 'provider-homes', 'fern', provider),
      )
      if (id === null) expect(f.homeOf.mock.calls.every((call) => call.length === 2)).toBe(true)
      expect(f.prepare).not.toHaveBeenCalled()
      expect(world.store.connectionOf(created.sessionId)).toBe(id)
    }
  })

  for (const opening of ['fresh', 'resume', 'legacy NULL'] as const) {
    it(`${provider}: ${opening} tools describe only their own already-read model catalogue`, async () => {
      const f = fixture(provider)
      await host.modelList(provider, 'fern')
      await host.modelList(provider, 'fern', f.b.id)
      await host.modelList(provider, 'fern', f.a.id)
      const before = f.prepare.mock.calls.length
      const created = await host.createSession(
        {
          provider,
          profileId: 'fern',
          connectionId: f.a.id,
          cwd: world.folder,
          model: 'shared-model',
          reasoningEffort: 'medium',
        },
        world.window,
      )
      if (opening !== 'fresh') {
        await host.close(created.sessionId, world.window)
        if (opening === 'legacy NULL')
          world.db
            .prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?')
            .run(created.sessionId)
        await host.resumeSession(created.sessionId, world.window)
      }
      const tools =
        opening === 'fresh'
          ? f.launched().at(-1)?.[0].agentTools
          : f.resumed().at(-1)?.[1].agentTools
      for (const name of ['give_work', 'create_agent']) {
        const shape = tools?.tools.find((tool) => tool.name === name)?.input
        const advertised = z.toJSONSchema(z.looseObject(shape ?? {}))
        const description = JSON.stringify(advertised.properties?.['model'])
        expect(description).toContain(opening === 'legacy NULL' ? 'model-legacy' : 'model-a')
        expect(description).not.toContain('model-b')
        expect(description).not.toContain(opening === 'legacy NULL' ? 'model-a' : 'model-legacy')
        expect(advertised.properties?.['effort']).toMatchObject({
          description: expect.stringContaining(
            `as last read — ${provider === 'claude' ? 'Claude' : 'Codex'}: ${opening === 'legacy NULL' ? 'low' : 'medium'}.`,
          ),
        })
      }
      expect(f.prepare).toHaveBeenCalledTimes(before + (opening === 'fresh' ? 1 : 2))
    })
  }

  it(`${provider}: an absent connection resolver keeps the legacy resume ledger-read order`, async () => {
    const f = fixture(provider, false)
    world.store.setModelChoice('fern', null)
    const created = await host.createSession(
      {
        provider,
        profileId: 'fern',
        cwd: world.folder,
        model: 'shared-model',
        reasoningEffort: 'medium',
      },
      world.window,
    )
    await host.close(created.sessionId, world.window)
    f.prepare.mockClear()
    const read = vi.spyOn(world.store, 'connectionOf')
    const resumed = await host.resumeSession(created.sessionId, world.window)
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith(provider, 'fern', undefined)
    expect(read).toHaveBeenCalledExactlyOnceWith(created.sessionId)
    expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      read.mock.invocationCallOrder[0] ?? 0,
    )
    expect(f.resolve).not.toHaveBeenCalled()
    expect(resumed).not.toHaveProperty('connectionId')
    expect(f.resumed().at(-1)?.[1]).toMatchObject({
      model: 'shared-model',
      reasoningEffort: 'medium',
    })
  })

  for (const named of [false, true]) {
    it(`${provider}: a fresh ${named ? 'named model' : 'default'} uses the selected endpoint's effort and rows`, async () => {
      const f = fixture(provider)
      const created = await host.createSession(
        {
          provider,
          profileId: 'fern',
          connectionId: 'Endpoint A',
          cwd: world.folder,
          ...(named ? { model: 'shared-model' } : {}),
        },
        world.window,
      )
      expect(f.launched()).toHaveLength(1)
      expect(f.launched()[0]?.[0]).toMatchObject({
        model: named ? 'shared-model' : 'model-a',
        reasoningEffort: 'medium',
      })
      expect(world.store.connectionOf(created.sessionId)).toBe(f.a.id)
      expect(f.prepare.mock.calls.every((call) => call[2]?.id === f.a.id)).toBe(true)
    })

    it(`${provider}: a recorded ${named ? 'named model' : 'missing pair'} resumes from A while the agent defaults to B`, async () => {
      const f = fixture(provider)
      const created = await host.createSession(
        {
          provider,
          profileId: 'fern',
          connectionId: f.a.id,
          cwd: world.folder,
          model: 'shared-model',
          reasoningEffort: 'medium',
        },
        world.window,
      )
      await host.close(created.sessionId, world.window)
      world.store.setModel(created.sessionId, named ? 'shared-model' : null)
      world.store.setReasoningEffort(created.sessionId, null)
      await host.resumeSession(created.sessionId, world.window)
      expect(f.resumed()).toHaveLength(1)
      expect(f.resumed()[0]?.[1]).toMatchObject({
        model: named ? 'shared-model' : 'model-a',
        reasoningEffort: 'medium',
      })
      expect(world.store.connectionOf(created.sessionId)).toBe(f.a.id)
      expect(f.prepare.mock.calls.every((call) => call[2]?.id === f.a.id)).toBe(true)
    })
  }

  it(`${provider}: built-in and legacy NULL launches keep the provider family instead of adopting the new default`, async () => {
    const f = fixture(provider)
    world.store.setModelChoice('fern', null)
    const pair =
      provider === 'claude'
        ? { model: 'default', effort: 'medium' }
        : { model: 'model-legacy', effort: 'low' }
    for (const method of ['sign-in', 'api-key'] as const) {
      const created = await host.createSession(
        {
          provider,
          profileId: 'fern',
          connectionId: `${provider}:${method}`,
          cwd: world.folder,
        },
        world.window,
      )
      expect(f.launched().at(-1)?.[0]).toMatchObject({
        model: pair.model,
        reasoningEffort: pair.effort,
      })
      await host.close(created.sessionId, world.window)
      world.db
        .prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?')
        .run(created.sessionId)
      world.store.setModel(created.sessionId, null)
      world.store.setReasoningEffort(created.sessionId, null)
      world.store.setModelChoice('fern', {
        provider,
        ...pair,
        connectionId: f.b.id,
      })
      await host.resumeSession(created.sessionId, world.window)
      expect(f.resumed().at(-1)?.[1]).toMatchObject({
        model: pair.model,
        reasoningEffort: pair.effort,
      })
      expect(world.store.connectionOf(created.sessionId)).toBeNull()
      await host.close(created.sessionId, world.window)
    }
  })
}

function imageFixture(connectionId: string | null, savedPath = false) {
  const f = fixture('codex', true, true, 'medium', true)
  const id = 'fictional-image-record'
  const thread = '22222222-2222-4222-8222-222222222222'
  const imageId = 'call_fictional_image'
  recordedOn('codex', id, thread, connectionId)
  const imageAt = (home: string): string => {
    const path = join(home, 'generated_images', thread, `${imageId}.png`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from('89504e470d0a1a0a', 'hex'))
    return realpathSync(path)
  }
  const aHome = f.homeOf('codex', 'fern', f.a.id)
  const legacyHome = f.homeOf('codex', 'fern')
  const a = imageAt(aHome)
  const b = imageAt(f.homeOf('codex', 'fern', f.b.id))
  const legacy = imageAt(legacyHome)
  const home = connectionId === f.a.id ? aHome : legacyHome
  const file = join(home, `fixture-${thread}.jsonl`)
  const frames = [
    {
      type: 'response_item',
      timestamp: '2026-11-01T12:00:00.000Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Draw a fictional scene' }],
      },
    },
    {
      type: 'event_msg',
      timestamp: '2026-11-01T12:00:01.000Z',
      payload: {
        type: 'image_generation_end',
        call_id: imageId,
        status: 'completed',
        revised_prompt: 'A fictional scene',
        result: 'A'.repeat(64),
        ...(savedPath ? { saved_path: b } : {}),
      },
    },
  ]
  writeFileSync(file, frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n')
  f.homeOf.mockClear()
  f.nativePath.mockClear()
  f.prepare.mockClear()
  const image = () => world.store.events(id).find((entry) => entry.event.type === 'image')?.event
  return { ...f, id, thread, file, home, images: { a, b, legacy }, image }
}

for (const action of ['import', 'rebuild'] as const) {
  for (const scenario of [
    { name: 'uses its endpoint-a home', route: 'endpoint-a', saved: false, expected: 'a' },
    {
      name: 'uses its codex:sign-in home',
      route: 'codex:sign-in',
      saved: false,
      expected: 'legacy',
    },
    {
      name: 'uses its codex:api-key home',
      route: 'codex:api-key',
      saved: false,
      expected: 'legacy',
    },
    { name: 'uses its legacy NULL home', route: null, saved: false, expected: 'legacy' },
    {
      name: "keeps an absolute saved path ahead of A's convention",
      route: 'endpoint-a',
      saved: true,
      expected: 'b',
    },
  ] as const) {
    it(`codex: recorded image ${action} ${scenario.name}`, async () => {
      const f = imageFixture(scenario.route, scenario.saved)
      expect(await host.importRecordedSession(f.id)).toMatchObject({
        outcome: 'imported',
        readable: true,
      })
      if (action === 'rebuild') {
        appendFileSync(
          f.file,
          JSON.stringify({
            type: 'event_msg',
            timestamp: '2026-11-01T12:00:02.000Z',
            payload: { type: 'user_message', message: 'A later fictional line' },
          }) + '\n',
        )
        expect(await host.rebuildLedger(f.id)).toMatchObject({ outcome: 'imported' })
      }
      expect(f.image()).toMatchObject({ path: f.images[scenario.expected] })
      expect(f.nativePath.mock.calls.every((call) => call[1] === f.home)).toBe(true)
      if (scenario.route === null)
        expect(f.homeOf.mock.calls.every((call) => call.length === 2)).toBe(true)
      expect(f.prepare).not.toHaveBeenCalled()
      expect(world.store.connectionOf(f.id)).toBe(scenario.route)
      expect(world.store.modelChoiceOf('fern')?.connectionId).toBe(f.b.id)
    })
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a transcript without images performs no extra home lookup`, async () => {
    const f = fixture(provider, true, true, 'medium', true)
    const id = 'fictional-text-record'
    const thread = '33333333-3333-4333-8333-333333333333'
    recordedOn(provider, id, thread, f.a.id)
    const home = f.homeOf(provider, 'fern', f.a.id)
    mkdirSync(home, { recursive: true })
    const frame =
      provider === 'claude'
        ? {
            type: 'user',
            timestamp: '2026-11-01T12:00:00.000Z',
            message: { content: 'A fictional text-only turn' },
          }
        : {
            type: 'response_item',
            timestamp: '2026-11-01T12:00:00.000Z',
            payload: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'A fictional text-only turn' }],
            },
          }
    writeFileSync(join(home, `fixture-${thread}.jsonl`), JSON.stringify(frame) + '\n')
    f.homeOf.mockClear()
    f.prepare.mockClear()
    expect(await host.importRecordedSession(id)).toMatchObject({
      outcome: 'imported',
      readable: true,
    })
    expect(f.homeOf).toHaveBeenCalledExactlyOnceWith(provider, 'fern', f.a.id)
    expect(world.store.events(id).some((entry) => entry.event.type === 'image')).toBe(false)
    expect(f.prepare).not.toHaveBeenCalled()
  })
}
