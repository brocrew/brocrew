import { afterEach, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { ProviderVersion } from '@brobot2/runtime/provider-module'
import { providerRecord, type Provider, type ProviderConnection } from '@brobot2/shared'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { ProviderConnectionUnavailable } from '../src/main/connections/records'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { ModelList, ModelCatalogue } from '../src/shared/model-choice-contracts'
import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { providerVersionsFromModules } from '../src/main/providers'
import type { ProviderAuthOps } from '../src/main/providers/auth-operations'
import { unstartedProviderModules } from './helpers/unstarted-provider-modules'

const hosts: RuntimeHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.closeAll()))
  vi.restoreAllMocks()
})

function connection(provider: Provider, id: string): ProviderConnection {
  return {
    id,
    provider,
    name: id,
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
}

function version(value: string): ProviderVersion {
  return {
    version: value,
    program: {
      standing: 'tested',
      from: 'carried',
      path: '/fictional/program',
      version: value,
      tested: null,
      said: value,
      help: null,
      update: null,
      others: [],
      updatedFrom: null,
    },
  }
}

function fixture(provider: Provider, useModule = true, defaultId?: string, auth?: ProviderAuthOps) {
  const a = connection(provider, 'fictional-endpoint-a')
  const b = connection(provider, 'fictional-endpoint-b')
  const legacy = connection(provider, `${provider}:sign-in`)
  const names = { [a.id]: 'a-1', [b.id]: 'b-1' }
  const versions = { [a.id]: '1', [b.id]: '7' }
  const resolve = vi.fn((asked: Provider, id?: string | null) => {
    if (asked !== provider) return connection(asked, `${asked}:sign-in`)
    if (id === undefined || id === null || id === legacy.id) return legacy
    if (id === `${provider}:api-key`) return connection(provider, id)
    if (id === a.id || id === 'Endpoint A') return a
    if (id === b.id) return b
    throw new ProviderConnectionUnavailable()
  })
  const readVersions = vi.fn(async (row?: ProviderConnection) =>
    providerRecord((p) => version(p === row?.provider ? (versions[row.id] ?? '0') : 'local')),
  )
  const prepare = vi.fn(async (p: Provider, _profile: string, row?: ProviderConnection) => {
    const runtime = new FakeRuntime(p)
    vi.spyOn(runtime, 'listModels').mockResolvedValue([
      {
        id: row === undefined ? 'local-model' : (names[row.id] ?? 'local-model'),
        label: 'Fictional model',
        isDefault: true,
      },
    ])
    return { home: '/fictional/home', runtime }
  })
  const prepareHome = vi.fn(
    (_p: Provider, _profile: string, id?: string) => `/fictional/${id ?? 'legacy'}`,
  )
  const host = new RuntimeHost({
    ...neutralHostDeps(() => '/fictional'),
    store:
      defaultId === undefined
        ? NULL_SESSION_STORE
        : {
            ...NULL_SESSION_STORE,
            modelChoiceOf: () => ({
              provider,
              model: 'unlisted-default',
              effort: null,
              connectionId: defaultId,
            }),
          },
    readProviderConfig: fixtureProviderConfig,
    listProfiles: () => [DEFAULT_PROFILE_ID, 'fern'],
    resolveCwd: () => '/fictional/work',
    newSessionId: () => 'fictional-unused-session',
    createRuntime: (p) => new FakeRuntime(p),
    prepareProviderHome: prepareHome,
    providerHomePath: () => '/fictional/home',
    ...(useModule ? { prepareProviderLaunch: prepare } : {}),
    connectionFor: resolve,
    listConnections: () => [legacy, a, b],
    providerVersions: readVersions,
    ...(auth === undefined ? {} : { providerAuth: auth }),
  })
  hosts.push(host)
  const read: (p: Provider, profile: string, id?: string) => Promise<ModelList> =
    host.modelList.bind(host)
  const choices: (
    p: Provider,
    profile: string,
    id?: string,
  ) => ReturnType<RuntimeHost['providerLaunchChoices']> = host.providerLaunchChoices.bind(host)
  return {
    host,
    read,
    choices,
    a,
    b,
    legacy,
    names,
    versions,
    resolve,
    readVersions,
    prepare,
    prepareHome,
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: the host qualifies aliases and reads models and versions for that endpoint`, async () => {
    const f = fixture(provider)
    const legacy = await f.read(provider, DEFAULT_PROFILE_ID)
    expect(legacy.models.map((row) => row.id)).toEqual(['local-model'])
    const first = await f.read(provider, DEFAULT_PROFILE_ID, 'Endpoint A')
    expect(first.models.map((row) => row.id)).toEqual(['a-1'])
    expect(f.readVersions).toHaveBeenCalledExactlyOnceWith(f.a)
    expect(f.prepare).toHaveBeenLastCalledWith(provider, DEFAULT_PROFILE_ID, f.a)
    expect((await f.read(provider, 'fern', f.b.id)).models.map((row) => row.id)).toEqual(['b-1'])
    f.names[f.a.id] = 'a-2'
    f.versions[f.a.id] = '2'
    expect((await f.read(provider, 'fern', f.a.id)).models.map((row) => row.id)).toEqual(['a-2'])
    expect(
      (await f.read(provider, DEFAULT_PROFILE_ID, f.b.id)).models.map((row) => row.id),
    ).toEqual(['b-1'])
    expect(f.prepare.mock.calls.map((call) => call[2]?.id)).toEqual([
      f.legacy.id,
      f.a.id,
      f.b.id,
      f.a.id,
    ])
    const before = f.prepare.mock.calls.length
    expect((await f.read(provider, DEFAULT_PROFILE_ID)).models).toEqual(legacy.models)
    expect(f.prepare).toHaveBeenCalledTimes(before)
  })

  it(`${provider}: raw providerModels uses the same canonical endpoint alias`, async () => {
    const f = fixture(provider)
    const read: (profile: string, p: Provider, id?: string) => Promise<ModelCatalogue> =
      f.host.providerModels.bind(f.host)
    await expect(read(DEFAULT_PROFILE_ID, provider, 'Endpoint A')).resolves.toMatchObject({
      ok: true,
      models: [{ id: 'a-1' }],
    })
    expect(f.readVersions).toHaveBeenCalledExactlyOnceWith(f.a)
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID, f.a)
  })

  it(`${provider}: the omitted and built-in family preserves the old version-read arity`, async () => {
    const f = fixture(provider)
    for (const id of [undefined, `${provider}:sign-in`, `${provider}:api-key`]) {
      expect((await f.read(provider, DEFAULT_PROFILE_ID, id)).models.map((row) => row.id)).toEqual([
        'local-model',
      ])
    }
    expect(f.readVersions).not.toHaveBeenCalled()
    expect(f.prepare).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID, f.legacy)
    await f.host.providerVersions()
    expect(f.readVersions.mock.calls).toEqual([[]])
  })

  it(`${provider}: an unknown route is refused before version or model launch admission`, async () => {
    const f = fixture(provider)
    await expect(f.read(provider, DEFAULT_PROFILE_ID, 'not-a-connection')).rejects.toBeInstanceOf(
      ProviderConnectionUnavailable,
    )
    expect(f.readVersions).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: an absent profile starts neither endpoint version work nor a model child`, async () => {
    const f = fixture(provider)
    const answer = await f.read(provider, 'no-such-profile', f.a.id)
    expect(answer.notAsked).toEqual({ ok: false, reason: 'no-profile' })
    expect(f.readVersions).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: the existing home adapter also receives the selected ID without a module preparer`, async () => {
    const f = fixture(provider, false)
    await f.read(provider, DEFAULT_PROFILE_ID, f.a.id)
    expect(f.prepareHome).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID, f.a.id)
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: shutdown during the owned version read starts no model preparation`, async () => {
    const f = fixture(provider)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    f.readVersions.mockImplementationOnce(async () => {
      await held
      return providerRecord(() => version('1'))
    })
    const pending = f.read(provider, DEFAULT_PROFILE_ID, f.a.id)
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(f.readVersions).toHaveBeenCalledExactlyOnceWith(f.a)
      expect(f.prepare).not.toHaveBeenCalled()
    } finally {
      const closing = f.host.closeAll()
      release()
      await Promise.all([pending, closing])
    }
    expect((await pending).notAsked).toEqual({ ok: false, reason: 'closing' })
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it(`${provider}: selected launch choices use one canonical ID for the list and auth`, async () => {
    const f = fixture(provider)
    const auth = vi
      .spyOn(f.host, 'checkProviderAuth')
      .mockResolvedValue({ state: 'unknown', reason: 'Fictional check' })
    const answer = await f.choices(provider, DEFAULT_PROFILE_ID, 'Endpoint A')
    expect(answer.list.models.map((row) => row.id)).toEqual(['a-1'])
    expect(answer.defaultConnectionId).toBe(f.a.id)
    expect(auth).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID, false, f.a.id)
  })

  it(`${provider}: selected choices perform a passive check with the actual qualified auth row`, async () => {
    const check = vi.fn<ProviderAuthOps['check']>(async () => ({
      state: 'absent',
      reason: 'Fictional passive answer',
    }))
    const probe = vi.fn<NonNullable<ProviderAuthOps['probe']>>(async () => ({
      state: 'unknown',
      reason: 'Fictional manual answer',
    }))
    const noGesture = vi.fn((): never => {
      throw new Error('No credential gesture')
    })
    const auth: ProviderAuthOps = {
      check,
      probe,
      credentialHome: () => '/fictional/auth-home',
      reprovision: noGesture,
      signIn: noGesture,
      replaceARefusedCopy: noGesture,
    }
    const f = fixture(provider, true, undefined, auth)
    const answer = await f.choices(provider, DEFAULT_PROFILE_ID, 'Endpoint A')
    expect(answer.ready).toBe(false)
    expect(answer.reason).toBe('Fictional passive answer')
    expect(check).toHaveBeenCalledExactlyOnceWith(
      provider,
      DEFAULT_PROFILE_ID,
      expect.any(AbortSignal),
      f.a,
    )
    expect(probe).not.toHaveBeenCalled()
    expect(noGesture).not.toHaveBeenCalled()
  })

  it(`${provider}: an unknown launch-choice route reaches neither models nor auth`, async () => {
    const f = fixture(provider)
    const auth = vi
      .spyOn(f.host, 'checkProviderAuth')
      .mockResolvedValue({ state: 'unknown', reason: 'Fictional check' })
    await expect(f.choices(provider, DEFAULT_PROFILE_ID, 'missing-route')).rejects.toBeInstanceOf(
      ProviderConnectionUnavailable,
    )
    expect(auth).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.readVersions).not.toHaveBeenCalled()
  })

  it(`${provider}: omitted model-read identity keeps legacy facts despite a new agent default`, async () => {
    const f = fixture(provider, true, 'fictional-endpoint-b')
    const auth = vi
      .spyOn(f.host, 'checkProviderAuth')
      .mockResolvedValue({ state: 'unknown', reason: 'Fictional check' })
    const answer = await f.host.providerLaunchChoices(provider, DEFAULT_PROFILE_ID)
    expect(answer.list.models.map((row) => row.id)).toEqual(['local-model'])
    expect(answer.defaultConnectionId).toBe(f.b.id)
    expect(auth).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID)
    expect(f.readVersions).not.toHaveBeenCalled()
  })

  for (const kind of ['modelList', 'providerLaunchChoices'] as const) {
    it(`${provider}: ${kind} keeps the selected endpoint through the real command decoder`, async () => {
      const f = fixture(provider)
      vi.spyOn(f.host, 'checkProviderAuth').mockResolvedValue({
        state: 'unknown',
        reason: 'Fictional check',
      })
      const input = { kind, provider, profileId: DEFAULT_PROFILE_ID, connectionId: 'Endpoint A' }
      expect(runtimeCommandSchema.parse(input)).toEqual(input)
      const answer = await executeRuntimeCommand(
        f.host,
        new RecordingSink('fictional-model-reader'),
        input,
      )
      expect(answer).toMatchObject(
        kind === 'modelList'
          ? { models: [{ id: 'a-1' }] }
          : { list: { models: [{ id: 'a-1' }] }, defaultConnectionId: f.a.id },
      )
    })

    it(`${provider}: ${kind} keeps omission exact and rejects malformed selected IDs`, () => {
      const legacy = { kind, provider }
      expect(runtimeCommandSchema.parse(legacy)).toEqual(legacy)
      for (const connectionId of ['', null, 17]) {
        expect(runtimeCommandSchema.safeParse({ ...legacy, connectionId }).success).toBe(false)
      }
      for (const gesture of ['signInProvider', 'reprovisionProviderAuth']) {
        const command = { kind: gesture, provider }
        expect(runtimeCommandSchema.parse(command)).toEqual(command)
        const selected = { ...command, connectionId: 'fictional-auth-choice' }
        expect(runtimeCommandSchema.parse(selected)).toEqual(selected)
        for (const connectionId of ['', null, 17]) {
          expect(runtimeCommandSchema.safeParse({ ...command, connectionId }).success).toBe(false)
        }
      }
    })
  }

  it(`${provider}: only its bound version service receives selected endpoint metadata`, async () => {
    const unread = vi.fn((): never => {
      throw new Error('No native lookup')
    })
    const modules = unstartedProviderModules(unread, '/fictional')
    const row = connection(provider, 'fictional-endpoint-a')
    const services = providerRecord((p) => ({
      ownProvider: p,
      version: vi.fn(function (this: { ownProvider: Provider }, selected?: ProviderConnection) {
        return Promise.resolve(version(`${this.ownProvider}:${selected?.id ?? 'local'}`))
      }),
    }))
    const read: (
      selected?: ProviderConnection,
    ) => Promise<Readonly<Record<Provider, ProviderVersion>>> = providerVersionsFromModules(
      providerRecord((p) => ({ ...modules[p], program: services[p] })),
    )
    const answer = await read(row)
    expect(answer[provider].version).toBe(`${provider}:${row.id}`)
    for (const p of ['claude', 'codex'] as const) {
      expect(services[p].version.mock.calls).toEqual(p === provider ? [[row]] : [[]])
    }
    expect(unread).not.toHaveBeenCalled()
  })
}
