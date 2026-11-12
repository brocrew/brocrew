import { connectedProviderReads } from './lib/connected-provider-reads'
import type { ProviderLaunchChoices } from '../src/shared/provider-launch'
import type { Provider, RuntimeBridge } from '../src/shared/runtime-ipc'
import { describe, expect, it, vi } from 'vitest'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import type { ModelList } from '../src/shared/model-choice-contracts'
import type { ClientProviderApi } from '../src/shared/client-provider-api'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'
import { providerCatalogue } from '../src/renderer/src/client-provider/catalogue'
import { readProviderSetup } from '../src/renderer/src/lib/provider-setup'
import { modelListsForClient as useModelLists } from '../src/renderer/src/client-provider/model-lists'

function fixture() {
  const off = vi.fn()
  const list: ModelList = {
    provider: 'claude',
    models: [],
    notAsked: null,
    standIn: null,
    startsOn: null,
    lastPicked: null,
  }
  const transport = {
    providerUsage: vi.fn<ClientProviderApi['providerUsage']>(),
    providerCatalogue: vi.fn(async () => [{ ...PROVIDER_DESCRIPTORS[0], displayName: 'Fable' }]),
    modelList: vi.fn(async () => list),
    providerLaunchChoices: vi.fn<ClientProviderApi['providerLaunchChoices']>(async () => ({
      list,
      ready: true,
      defaultModel: null,
      defaultModelToSend: null,
    })),
    resolveProviderLaunch: vi.fn<ClientProviderApi['resolveProviderLaunch']>(async () => ({
      provider: 'claude',
      pickerProvider: 'claude',
      readiness: [],
    })),
    addHandAddedModel: vi.fn(async () => [] as readonly string[]),
    deleteHandAddedModel: vi.fn(async () => [] as readonly string[]),
    ...connectedProviderReads(),
    providerSetup: vi.fn<RuntimeBridge['providerSetup']>(async () => ({
      claude: null,
      codex: null,
    })),
    providerVersions: vi.fn<ClientProviderApi['providerVersions']>(),
    providerResources: vi.fn<ClientProviderApi['providerResources']>(),
    providerConnections: vi.fn<ClientProviderApi['providerConnections']>(),
    setApiKey: vi.fn<ClientProviderApi['setApiKey']>(),
    removeApiKey: vi.fn<ClientProviderApi['removeApiKey']>(),
    checkApiKey: vi.fn<ClientProviderApi['checkApiKey']>(),
    reprovisionProviderAuth: vi.fn<ClientProviderApi['reprovisionProviderAuth']>(),
    reprovisionProviderHomes: vi.fn<ClientProviderApi['reprovisionProviderHomes']>(),
    signInProvider: vi.fn<ClientProviderApi['signInProvider']>(async () => ({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
      presentation: { message: 'Fable connected.' },
    })),
    cancelProviderSignIn: vi.fn(async () => {}),
    onProvidersChanged: vi.fn<ClientProviderApi['onProvidersChanged']>(() => off),
  }
  const runtime = vi.fn(() => transport)
  const api = createDesktopProviderApi(runtime, () => undefined)
  return { transport, runtime, api, off, list }
}

describe('the injected provider client and desktop adapter', () => {
  it('does no reads at construction and forwards catalogue words without probing', async () => {
    const { runtime, transport, api } = fixture()
    expect(runtime).not.toHaveBeenCalled()
    expect((await api.providerCatalogue())[0]?.displayName).toBe('Fable')
    expect(transport.checkProviderAuth).not.toHaveBeenCalled()
    expect(transport.modelList).not.toHaveBeenCalled()
  })

  it('forwards the original promise, rejection and subscription cleanup', async () => {
    const { transport, api, off } = fixture()
    const error = new Error('fictional catalogue unavailable')
    const pending = Promise.reject<ProviderLaunchChoices>(error)
    transport.providerLaunchChoices.mockReturnValueOnce(pending)
    const result = api.providerLaunchChoices({ provider: 'claude', profileId: 'fictional-profile' })
    expect(result).toBe(pending)
    await expect(result).rejects.toBe(error)
    expect(transport.providerLaunchChoices).toHaveBeenCalledWith({
      provider: 'claude',
      profileId: 'fictional-profile',
    })
    const listener = vi.fn()
    const unsubscribe = api.onProvidersChanged(listener)
    expect(transport.onProvidersChanged).toHaveBeenCalledWith(listener)
    expect(unsubscribe).toBe(off)
    unsubscribe()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('keeps empty and failed catalogue answers explicit without a native fallback', async () => {
    const { transport, api } = fixture()
    transport.providerCatalogue.mockResolvedValueOnce([])
    const catalogue = providerCatalogue(api)
    expect(catalogue.held.value.state).toBe('loading')
    await catalogue.read()
    expect(catalogue.held.value).toEqual({ state: 'answered', providers: [] })
    const other = fixture()
    other.transport.providerCatalogue.mockRejectedValueOnce(new Error('fictional read failed'))
    const failed = providerCatalogue(other.api)
    await failed.read()
    expect(failed.held.value).toEqual({ state: 'unread', why: 'fictional read failed' })
    await failed.read()
    expect(failed.held.value.state).toBe('answered')
    expect(providerCatalogue(other.api)).toBe(failed)
  })

  it('keeps one existing model holder and in-flight promise per client and profile', async () => {
    const { transport, api, list } = fixture()
    let finish!: (value: ProviderLaunchChoices) => void
    transport.providerLaunchChoices.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const models = useModelLists(api)
    expect(useModelLists(api)).toBe(models)
    const first = models.read('claude', 'profile-a')
    expect(models.read('claude', 'profile-a')).toBe(first)
    finish({ list, ready: true, defaultModel: null, defaultModelToSend: null })
    await first
    expect(models.held('claude', 'profile-a')).toEqual({ state: 'answered', list })
    expect(models.held('claude', 'profile-b')).toBeNull()
    expect(transport.providerLaunchChoices).toHaveBeenCalledTimes(1)
    expect(transport.modelList).not.toHaveBeenCalled()
    expect(useModelLists(fixture().api)).not.toBe(models)
  })
})

it('retains supplied fictional readiness and model choices instead of interpreting diagnostic words', async () => {
  const { api, transport, list } = fixture()
  const provider = 'fable' as Provider
  const supplied: ProviderLaunchChoices = {
    list: {
      ...list,
      provider,
      notAsked: { ok: false, reason: 'refused', detail: 'auth.json missing; not signed in' },
      models: [
        { id: 'the-first', label: 'First', efforts: [], isDefault: true, addedBy: 'the-provider' },
      ],
    },
    ready: true,
    defaultModel: { model: 'a-different-choice', effort: 'quiet' },
    defaultModelToSend: { model: 'a-different-choice', effort: 'quiet' },
  }
  transport.providerLaunchChoices.mockResolvedValueOnce(supplied)
  const lists = useModelLists(api)
  await lists.read(provider)
  expect(lists.choices(provider)).toEqual(supplied)
  expect(lists.held(provider)).toEqual({ state: 'answered', list: supplied.list })
  expect(transport.modelList).not.toHaveBeenCalled()
  expect(transport.checkProviderAuth).not.toHaveBeenCalled()
})

it('disowns an older choice answer with the same profile invalidation as its model list', async () => {
  const { api, transport, list } = fixture()
  let finish!: (value: ProviderLaunchChoices) => void
  const latest: ProviderLaunchChoices = {
    list,
    ready: false,
    defaultModel: null,
    defaultModelToSend: null,
  }
  transport.providerLaunchChoices
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    .mockResolvedValueOnce(latest)
  const lists = useModelLists(api)
  const old = lists.read('claude', 'profile-a')
  lists.forget('profile-a')
  expect(lists.choices('claude', 'profile-a')).toBeNull()
  await lists.read('claude', 'profile-a')
  finish({ ...latest, ready: true, defaultModel: { model: 'old', effort: null } })
  await old
  expect(lists.choices('claude', 'profile-a')).toEqual(latest)
  expect(lists.held('claude', 'profile-a')).toEqual({ state: 'answered', list })
})

it('forwards the original no-probe selection promise and the supplied snapshot unchanged', async () => {
  const { api, transport } = fixture()
  const input = {
    profileId: 'fictional-profile',
    askedProvider: 'fable' as Provider,
    providers: [{ provider: 'fable' as Provider, ready: true }],
  }
  const expected = {
    provider: 'fable' as Provider,
    pickerProvider: 'fable' as Provider,
    readiness: input.providers,
  }
  const pending = Promise.resolve(expected)
  transport.resolveProviderLaunch.mockReturnValueOnce(pending)
  expect(api.resolveProviderLaunch(input)).toBe(pending)
  await expect(pending).resolves.toBe(expected)
  expect(transport.resolveProviderLaunch).toHaveBeenCalledExactlyOnceWith(input)
  expect(transport.providerLaunchChoices).not.toHaveBeenCalled()
  expect(transport.checkProviderAuth).not.toHaveBeenCalled()
})

function operationCase<Input>(
  method: string,
  input: Input,
  call: (api: ClientProviderApi, input: Input) => Promise<unknown>,
) {
  return { method, input, call: (api: ClientProviderApi) => call(api, input) }
}
const operationCases = [
  operationCase('setApiKey', { provider: 'claude' as const, key: 'fictional-key' }, (api, input) =>
    api.setApiKey(input),
  ),
  operationCase('removeApiKey', { provider: 'claude' as const }, (api, input) =>
    api.removeApiKey(input),
  ),
  operationCase('checkApiKey', { provider: 'claude' as const }, (api, input) =>
    api.checkApiKey(input),
  ),
  operationCase(
    'reprovisionProviderAuth',
    { provider: 'claude' as const, profileId: 'fictional-profile' },
    (api, input) => api.reprovisionProviderAuth(input),
  ),
  operationCase(
    'reprovisionProviderHomes',
    { provider: 'claude' as const, statusOnly: true },
    (api, input) => api.reprovisionProviderHomes(input),
  ),
]
for (const row of operationCases) {
  it(`forwards ${row.method} lazily with its receiver, original input and rejection`, async () => {
    const { api, runtime, transport } = fixture()
    const failure = new Error('Fictional operation refused')
    const pending = Promise.reject<never>(failure)
    const forwarded = vi.fn(function (this: typeof transport, value: unknown) {
      expect(this).toBe(transport)
      expect(value).toBe(row.input)
      return pending
    })
    Object.assign(transport, { [row.method]: forwarded })
    expect(runtime).not.toHaveBeenCalled()
    const result = row.call(api)
    expect(result).toBe(pending)
    await expect(result).rejects.toBe(failure)
    expect(forwarded).toHaveBeenCalledExactlyOnceWith(row.input)
  })
}

it('forwards the original usage promise and supplied facts without changing the receiver', async () => {
  const { api, runtime, transport } = fixture()
  const snapshot = {
    claude: [
      {
        window: 'seven_day',
        period: { word: 'Fern interval', durationMs: 1234, bucket: false, bucketName: null },
        usedPercent: 23,
        resetsAt: null,
        at: 7,
      },
    ],
    codex: [],
  }
  const pending = Promise.resolve(snapshot)
  transport.providerUsage.mockImplementation(function (this: typeof transport) {
    expect(this).toBe(transport)
    return pending
  })
  expect(runtime).not.toHaveBeenCalled()
  expect(api.providerUsage()).toBe(pending)
  await expect(pending).resolves.toBe(snapshot)
  const failure = new Error('Fictional usage read failed')
  const rejected = Promise.reject<never>(failure)
  transport.providerUsage.mockReturnValueOnce(rejected)
  expect(api.providerUsage()).toBe(rejected)
  await expect(rejected).rejects.toBe(failure)
})

for (const method of ['providerVersions', 'providerResources', 'providerConnections'] as const) {
  it(`forwards ${method} without a read at construction, preserving receiver, promise and refusal`, async () => {
    const { api, runtime, transport } = fixture()
    const failure = new Error('Fictional read refused')
    const pending = Promise.reject<never>(failure)
    const read = vi.fn(function (this: typeof transport) {
      expect(this).toBe(transport)
      return pending
    })
    Object.assign(transport, { [method]: read })
    expect(runtime).not.toHaveBeenCalled()
    expect(api[method]()).toBe(pending)
    await expect(pending).rejects.toBe(failure)
    expect(read).toHaveBeenCalledExactlyOnceWith()
  })
}

it('forwards native setup guidance lazily with its receiver, exact promise and null entries', async () => {
  const { api, runtime, transport } = fixture()
  const answer: Awaited<ReturnType<RuntimeBridge['providerSetup']>> = {
    claude: {
      tool: 'Fern Tool',
      install: { command: 'fern install', docs: 'https://example.invalid/install' },
      signInCommand: 'fern login',
      signInInstructions: 'Fern supplied instructions.',
      platform: 'macOS',
      shell: 'Terminal',
    },
    codex: null,
  }
  const pending = Promise.resolve(answer)
  transport.providerSetup.mockImplementation(function (this: object) {
    expect(this).toBe(transport)
    return pending
  })
  expect(runtime).not.toHaveBeenCalled()
  expect(api.providerSetup()).toBe(pending)
  await expect(pending).resolves.toBe(answer)
  expect(transport.providerSetup).toHaveBeenCalledExactlyOnceWith()
  await expect(readProviderSetup(api)).resolves.toBe(answer)
  const failure = new Error('Fern guide read refused')
  const rejected = Promise.reject<never>(failure)
  transport.providerSetup.mockReturnValueOnce(rejected)
  expect(api.providerSetup()).toBe(rejected)
  await expect(rejected).rejects.toBe(failure)
  transport.providerSetup.mockRejectedValueOnce(failure)
  await expect(readProviderSetup(api)).resolves.toBeNull()
})

it('keeps throwing setup suppliers and operation getters inside the guide reader null boundary', async () => {
  const { api, runtime, transport } = fixture()
  const failure = new Error('Fern guide transport unavailable')
  runtime.mockImplementationOnce(() => {
    throw failure
  })
  await expect(readProviderSetup(api)).resolves.toBeNull()
  const getter = vi.fn(() => {
    throw failure
  })
  Object.defineProperty(transport, 'providerSetup', { get: getter, configurable: true })
  await expect(readProviderSetup(api)).resolves.toBeNull()
  expect(getter).toHaveBeenCalledExactlyOnceWith()
  expect(api.setup).toBeUndefined()
})
