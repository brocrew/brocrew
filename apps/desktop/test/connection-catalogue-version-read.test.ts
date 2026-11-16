import { expect, it, vi } from 'vitest'
import type { ModelChoice } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { ModelCatalogues } from '../src/main/connections/catalogues'
import { providerLaunchChoices } from '../src/main/connections/launch'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { ListsAsLastRead } from '../src/main/connections/model-rails'
import type { ModelList, SelectedModel } from '../src/shared/model-choice-contracts'

const firstId = 'fictional-server-a'
const otherId = 'fictional-server-b'

function rows(id: string): ModelChoice[] {
  return [
    {
      id,
      label: id,
      isDefault: true,
      efforts: [{ id: 'gentle', label: 'Gentle' }],
      defaultEffort: 'gentle',
    },
  ]
}

function fixture(
  readVersion: (provider: Provider, id: string) => Promise<string | null>,
  closing: () => boolean = () => false,
  store: ConstructorParameters<typeof ModelCatalogues>[0] = NULL_SESSION_STORE,
) {
  const names: Record<string, string> = { [firstId]: 'a-1', [otherId]: 'b-1' }
  const probe = vi.fn(async (_provider: Provider, _profile: string, id?: string) => ({
    ok: true as const,
    models: rows(id === undefined ? 'legacy-model' : (names[id] ?? 'unrecognized-route')),
  }))
  // JavaScript callers can supply the proposed optional constructor argument on the old base.
  const holder: ModelCatalogues = Reflect.construct(ModelCatalogues, [
    store,
    () => [DEFAULT_PROFILE_ID, 'fern'],
    probe,
    closing,
    () => null,
    () => 100,
    () => {},
    String,
    readVersion,
  ])
  expect(holder).toBeInstanceOf(ModelCatalogues)
  return { holder, probe, names }
}

function list(
  holder: ModelCatalogues,
  provider: Provider,
  id?: string,
  profile = DEFAULT_PROFILE_ID,
): Promise<ModelList> {
  return holder.modelList(provider, profile, id)
}

function pendingVersion() {
  let release!: (version: string | null) => void
  const answer = new Promise<string | null>((resolve) => {
    release = resolve
  })
  return { read: vi.fn(() => answer), release }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: an endpoint version refresh evicts only its own catalogue`, async () => {
    let firstVersion: string | null = '1'
    const readVersion = vi.fn(async (_provider: Provider, id: string) =>
      id === firstId ? firstVersion : '7',
    )
    const { holder, probe, names } = fixture(readVersion)
    expect((await list(holder, provider, firstId)).models.map((row) => row.id)).toEqual(['a-1'])
    expect(probe).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID, firstId)
    await list(holder, provider, otherId)
    names[firstId] = 'a-2'
    expect((await list(holder, provider, firstId)).models.map((row) => row.id)).toEqual(['a-1'])
    firstVersion = '2'
    expect((await list(holder, provider, firstId)).models.map((row) => row.id)).toEqual(['a-2'])
    expect((await list(holder, provider, otherId)).models.map((row) => row.id)).toEqual(['b-1'])
    names[firstId] = 'a-3'
    firstVersion = null
    expect((await list(holder, provider, firstId)).models.map((row) => row.id)).toEqual(['a-2'])
    expect(probe.mock.calls.map((call) => call[2])).toEqual([firstId, otherId, firstId])
  })

  it(`${provider}: concurrent profiles share one pending version read and one first model probe`, async () => {
    const { read: readVersion, release } = pendingVersion()
    const { holder, probe } = fixture(readVersion)
    const first = list(holder, provider, firstId)
    const another = list(holder, provider, firstId, 'fern')
    try {
      await Promise.resolve()
      expect(readVersion).toHaveBeenCalledExactlyOnceWith(provider, firstId)
      expect(probe).not.toHaveBeenCalled()
    } finally {
      release('1')
      await Promise.all([first, another])
    }
    expect((await first).models).toEqual((await another).models)
    expect(probe).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID, firstId)
  })

  it(`${provider}: shutdown while a version read waits starts no uncached model child`, async () => {
    let closing = false
    const { read: readVersion, release } = pendingVersion()
    const { holder, probe } = fixture(readVersion, () => closing)
    const pending = holder.providerModels(DEFAULT_PROFILE_ID, provider, firstId)
    try {
      await Promise.resolve()
      expect(readVersion).toHaveBeenCalledExactlyOnceWith(provider, firstId)
      closing = true
    } finally {
      release('1')
      await pending
    }
    expect(await pending).toEqual({ ok: false, reason: 'closing' })
    expect(probe).not.toHaveBeenCalled()
  })

  it(`${provider}: omitted and both built-in scopes never add a version callback`, async () => {
    const readVersion = vi.fn(async () => 'unused')
    const { holder, probe } = fixture(readVersion)
    for (const id of [undefined, `${provider}:sign-in`, `${provider}:api-key`]) {
      expect((await list(holder, provider, id)).models.map((row) => row.id)).toEqual([
        'legacy-model',
      ])
    }
    expect(readVersion).not.toHaveBeenCalled()
    expect(probe).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID)
  })

  it(`${provider}: cached tool rows come from the requested connection without changing the default view`, async () => {
    const { holder } = fixture(async () => '1')
    await list(holder, provider, firstId)
    await list(holder, provider, otherId)
    await list(holder, provider)
    const held: (provider?: Provider, id?: string) => ListsAsLastRead =
      holder.theListsAsLastRead.bind(holder)
    expect(held(provider, firstId)[provider]?.map((row) => row.id)).toEqual(['a-1'])
    expect(held(provider, otherId)[provider]?.map((row) => row.id)).toEqual(['b-1'])
    expect(held(provider, 'unrecognized-route')[provider]).toBeUndefined()
    expect(holder.theListsAsLastRead()[provider]?.map((row) => row.id)).toEqual(['legacy-model'])
  })

  it(`${provider}: a rejected version read releases ownership so the next read can recover`, async () => {
    const failure = new Error('Fictional version read failed')
    const readVersion = vi
      .fn<(provider: Provider, id: string) => Promise<string | null>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('1')
    const { holder, probe } = fixture(readVersion)
    await expect(holder.providerModels(DEFAULT_PROFILE_ID, provider, firstId)).rejects.toBe(failure)
    expect(probe).not.toHaveBeenCalled()
    await expect(holder.providerModels(DEFAULT_PROFILE_ID, provider, firstId)).resolves.toEqual({
      ok: true,
      models: rows('a-1'),
    })
    expect(readVersion.mock.calls).toEqual([
      [provider, firstId],
      [provider, firstId],
    ])
    expect(probe).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID, firstId)
  })

  it(`${provider}: a missing profile starts neither a version read nor a model probe`, async () => {
    const readVersion = vi.fn(async () => '1')
    const { holder, probe } = fixture(readVersion)
    await expect(holder.providerModels('not-an-agent', provider, firstId)).resolves.toEqual({
      ok: false,
      reason: 'no-profile',
    })
    expect(readVersion).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })

  it(`${provider}: compatible extra picks and raw default-family picks keep their projection`, async () => {
    let pick = { model: 'a-1', effort: 'gentle' }
    const { holder } = fixture(
      async () => '1',
      () => false,
      { ...NULL_SESSION_STORE, lastPicked: () => pick },
    )
    expect((await list(holder, provider, firstId)).lastPicked).toEqual(pick)
    pick = { model: 'provider-wide-unlisted', effort: 'forceful' }
    for (const id of [undefined, `${provider}:sign-in`, `${provider}:api-key`]) {
      const offered = await list(holder, provider, id)
      expect(offered.lastPicked).toEqual(pick)
      const launch = providerLaunchChoices(offered, { state: 'unknown', reason: 'Fictional check' })
      expect(offered.startsOn).toMatchObject(pick)
      expect(launch.defaultModel).toEqual(pick)
      expect(launch.defaultModelToSend).toBeNull()
    }
  })

  for (const wrong of ['model', 'effort'] as const) {
    it(`${provider}: an inherited wrong ${wrong} falls back to this endpoint's own default`, async () => {
      const store = {
        ...NULL_SESSION_STORE,
        lastPicked: () => ({
          model: wrong === 'model' ? 'another-endpoint-model' : 'a-1',
          effort: wrong === 'effort' ? 'forceful' : 'gentle',
        }),
        aPersonPicked: vi.fn(),
        setModelChoice: vi.fn(() => false),
      }
      const { holder } = fixture(
        async () => '1',
        () => false,
        store,
      )
      const selected: (
        provider: Provider,
        profile: string | null,
        named: { model?: string; effort?: string },
        id?: string,
      ) => Promise<SelectedModel> = holder.theSelectedModel.bind(holder)
      const expected = { model: 'a-1', effort: 'gentle', from: 'the-providers-default' }
      expect(await selected(provider, null, {}, firstId)).toEqual(expected)
      const offered = await list(holder, provider, firstId)
      expect(offered.startsOn).toEqual(expected)
      const launch = providerLaunchChoices(offered, {
        state: 'unknown',
        reason: 'Fictional mode check',
      })
      expect(launch.defaultModel).toEqual({ model: 'a-1', effort: 'gentle' })
      expect(launch.defaultModelToSend).toBeNull()
      expect(offered.lastPicked).toBeNull()
      expect(store.aPersonPicked).not.toHaveBeenCalled()
      expect(store.setModelChoice).not.toHaveBeenCalled()
    })
  }
}
