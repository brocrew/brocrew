import { describe, expect, it, vi } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { ModelChoice } from '@brobot2/runtime'
import type { ModelCatalogue, ModelList } from '../src/shared/model-choice-contracts'
import { createModelLists } from '../src/renderer/src/lib/model-lists'
import { ModelCatalogues } from '../src/main/connections/catalogues'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

const oldModels: ModelChoice[] = [
  {
    id: 'default',
    label: 'Default (recommended)',
    resolvesTo: 'claude-sonnet-5-5',
    isDefault: true,
  },
  { id: 'fable', label: 'Fable', resolvesTo: 'claude-fable-5-1' },
]
const currentModels: ModelChoice[] = [
  { id: 'default', label: 'Default (recommended)', resolvesTo: 'claude-opus-5-5', isDefault: true },
  { id: 'fable', label: 'Fable 5.2', resolvesTo: 'claude-fable-5-2' },
]

function catalogue(
  read: (
    provider: Provider,
    profile: string,
    connectionId?: string,
  ) => Promise<ModelChoice[] | ModelCatalogue>,
  closing: () => boolean = () => false,
) {
  const probe = vi.fn(
    async (provider: Provider, profile: string, connectionId?: string): Promise<ModelCatalogue> => {
      const answer = await (connectionId === undefined
        ? read(provider, profile)
        : read(provider, profile, connectionId))
      return Array.isArray(answer) ? { ok: true, models: answer } : answer
    },
  )
  const holder = new ModelCatalogues(
    NULL_SESSION_STORE,
    () => [DEFAULT_PROFILE_ID, 'fern'],
    probe,
    closing,
    () => null,
    () => 100,
    () => {},
    String,
  )
  return { holder, probe }
}

function screenLists(read: () => Promise<ModelChoice[]>) {
  return createModelLists(() => ({
    providerLaunchChoices: async ({ provider, profileId }) => {
      const own = { model: profileId === 'fern' ? 'fable' : 'default', effort: null }
      return {
        list: {
          provider,
          models: (await read()).map((row) => ({ ...row, addedBy: 'the-provider' as const })),
          standIn: null,
          notAsked: null,
          lastPicked: null,
          startsOn: { ...own, from: 'its-default' as const },
        },
        ready: true,
        defaultModel: own,
        defaultModelToSend: own,
      }
    },
    resolveProviderLaunch: async () => {
      throw new Error('not used')
    },
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
  }))
}

describe('one current catalogue per provider', () => {
  it('gives the drawer and an agent the same provider-reported Default and Fable', async () => {
    const { holder, probe } = catalogue(async (_provider, profile) =>
      profile === DEFAULT_PROFILE_ID ? currentModels : oldModels,
    )
    const agent = await holder.modelList('claude', 'fern')
    const drawer = await holder.modelList('claude')
    expect(agent.models).toEqual(currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })))
    expect(drawer.models).toEqual(agent.models)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith('claude', DEFAULT_PROFILE_ID)
  })

  it('a sign-in change from any profile refreshes the provider catalogue for every screen', async () => {
    let models = oldModels
    const { holder } = catalogue(async () => models)
    await holder.modelList('claude')
    await holder.modelList('claude', 'fern')
    models = currentModels
    holder.forgetModels('claude')
    const drawer = await holder.modelList('claude')
    const agent = await holder.modelList('claude', 'fern')
    expect(drawer.models).toEqual(currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })))
    expect(agent.models).toEqual(drawer.models)
  })

  it('an answer from before sign-in changed cannot restore the old catalogue', async () => {
    let release!: (models: ModelChoice[]) => void
    let first = true
    const { holder } = catalogue(async () => {
      if (!first) return currentModels
      first = false
      return new Promise<ModelChoice[]>((resolve) => {
        release = resolve
      })
    })
    const before = holder.modelList('claude')
    holder.forgetModels('claude')
    const after = holder.modelList('claude')
    release(oldModels)
    expect((await before).models).toEqual((await after).models)
    expect((await holder.modelList('claude', 'fern')).models).toEqual((await after).models)
  })

  it('a newly read bundled version replaces a previously successful catalogue', async () => {
    let models = oldModels
    const { holder, probe } = catalogue(async () => models)
    holder.setProviderVersion('claude', '2.1.321')
    await holder.modelList('claude')
    models = currentModels
    holder.setProviderVersion('claude', '2.1.322')
    expect((await holder.modelList('claude', 'fern')).models).toEqual(
      currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })),
    )
    expect(probe).toHaveBeenCalledTimes(2)
    holder.setProviderVersion('claude', '2.1.322')
    await holder.modelList('claude')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('the drawer and picker share updated rows while keeping each saved choice', async () => {
    let models = oldModels
    const lists = screenLists(async () => models)
    await lists.read('claude')
    await lists.read('claude', 'fern')
    models = currentModels
    lists.forget('fern')
    await lists.read('claude', 'fern')
    const drawer = lists.held('claude')
    const picker = lists.held('claude', 'fern')
    expect(drawer?.state).toBe('answered')
    expect(picker?.state).toBe('answered')
    if (drawer?.state !== 'answered' || picker?.state !== 'answered') throw new Error('no rows')
    expect(drawer.list.models).toEqual(picker.list.models)
    expect(picker.list.models).toEqual(
      currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })),
    )
    expect(lists.choices('claude')?.defaultModel?.model).toBe('default')
    expect(lists.choices('claude', 'fern')?.defaultModel?.model).toBe('fable')
  })

  it('a late drawer answer cannot replace rows refreshed after another profile signs in', async () => {
    let release!: (models: ModelChoice[]) => void
    let first = true
    const lists = screenLists(async () => {
      if (!first) return currentModels
      first = false
      return new Promise<ModelChoice[]>((resolve) => {
        release = resolve
      })
    })
    const oldDrawer = lists.read('claude')
    await lists.read('claude', 'fern')
    lists.forget('fern')
    const freshDrawer = lists.read('claude')
    await lists.read('claude', 'fern')
    release(oldModels)
    await Promise.all([oldDrawer, freshDrawer])
    const drawer = lists.held('claude')
    expect(drawer?.state).toBe('answered')
    if (drawer?.state !== 'answered') throw new Error('no rows')
    expect(drawer.list.models).toEqual(
      currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })),
    )
    expect(lists.held('claude', 'fern')).toMatchObject({ list: { models: drawer.list.models } })
  })

  it('a forgotten in-flight answer cannot start a replacement probe after shutdown', async () => {
    let closing = false
    let release!: (models: ModelChoice[]) => void
    let first = true
    const { holder, probe } = catalogue(
      async () => {
        if (!first) return currentModels
        first = false
        return new Promise<ModelChoice[]>((resolve) => {
          release = resolve
        })
      },
      () => closing,
    )
    const before = holder.modelList('claude')
    holder.forgetModels('claude')
    closing = true
    release(oldModels)
    expect((await before).notAsked).toEqual({ ok: false, reason: 'closing' })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it.each(['claude', 'codex'] as const)(
    'a cold %s screen can warm again after another profile signs in',
    async (provider) => {
      let release!: (models: ModelChoice[]) => void
      let first = true
      const lists = screenLists(async () => {
        if (!first) return currentModels
        first = false
        return new Promise<ModelChoice[]>((resolve) => {
          release = resolve
        })
      })
      const pending = lists.read(provider, 'birch', { once: true })
      await lists.read('claude', 'fern')
      lists.forget('fern')
      release(oldModels)
      await pending
      await lists.read(provider, 'birch', { once: true })
      expect(lists.held(provider, 'birch')).toMatchObject({
        state: 'answered',
        list: {
          models: currentModels.map((row) => ({ ...row, addedBy: 'the-provider' })),
        },
      })
      expect(lists.readiness(provider, 'birch').state).toBe('settled')
    },
  )
})

function scopedList(
  holder: ModelCatalogues,
  provider: Provider,
  connectionId: string,
  profileId = DEFAULT_PROFILE_ID,
) {
  const read: (
    provider: Provider,
    profileId?: string,
    connectionId?: string,
  ) => Promise<ModelList> = holder.modelList.bind(holder)
  return read(provider, profileId, connectionId)
}

const endpointRows = (id: string): ModelChoice[] => [
  { id, label: id, isDefault: true, efforts: [] },
]

function changingEndpoints() {
  let a = 0
  let b = 0
  return catalogue(async (_provider, _profile, id) =>
    endpointRows(
      id === 'fictional-server-a'
        ? `a-${++a}`
        : id === 'fictional-server-b'
          ? `b-${++b}`
          : 'legacy-model',
    ),
  )
}

for (const provider of ['claude', 'codex'] as const) {
  describe(`${provider} connection catalogue identity`, () => {
    it('keeps two endpoints independent while profiles of one endpoint share a probe', async () => {
      const { holder, probe } = catalogue(async (_provider, _profile, id) =>
        endpointRows(
          id === 'fictional-server-a'
            ? 'model-a'
            : id === 'fictional-server-b'
              ? 'model-b'
              : 'legacy-model',
        ),
      )
      const a = await scopedList(holder, provider, 'fictional-server-a')
      const b = await scopedList(holder, provider, 'fictional-server-b')
      const otherProfile = await scopedList(holder, provider, 'fictional-server-a', 'fern')
      expect(a.models.map((one) => one.id)).toEqual(['model-a'])
      expect(b.models.map((one) => one.id)).toEqual(['model-b'])
      expect(otherProfile.models).toEqual(a.models)
      expect(probe.mock.calls).toEqual([
        [provider, DEFAULT_PROFILE_ID, 'fictional-server-a'],
        [provider, DEFAULT_PROFILE_ID, 'fictional-server-b'],
      ])
    })

    it('invalidates only the named connection after its credential changes', async () => {
      const { holder, probe } = changingEndpoints()
      await scopedList(holder, provider, 'fictional-server-a')
      await scopedList(holder, provider, 'fictional-server-b')
      const forget: (provider: Provider, connectionId?: string) => void =
        holder.forgetModels.bind(holder)
      forget(provider, 'fictional-server-a')
      expect(
        (await scopedList(holder, provider, 'fictional-server-b')).models.map((one) => one.id),
      ).toEqual(['b-1'])
      expect(
        (await scopedList(holder, provider, 'fictional-server-a')).models.map((one) => one.id),
      ).toEqual(['a-2'])
      expect(probe.mock.calls.map((call) => call[2])).toEqual([
        'fictional-server-a',
        'fictional-server-b',
        'fictional-server-a',
      ])
    })

    it('compares program versions within each connection rather than across the provider', async () => {
      const { holder, probe } = changingEndpoints()
      const version: (provider: Provider, value: string | null, connectionId?: string) => void =
        holder.setProviderVersion.bind(holder)
      version(provider, '1.0', 'fictional-server-a')
      await scopedList(holder, provider, 'fictional-server-a')
      version(provider, '7.0', 'fictional-server-b')
      await scopedList(holder, provider, 'fictional-server-b')
      version(provider, '7.1', 'fictional-server-b')
      expect(
        (await scopedList(holder, provider, 'fictional-server-a')).models.map((one) => one.id),
      ).toEqual(['a-1'])
      expect(
        (await scopedList(holder, provider, 'fictional-server-b')).models.map((one) => one.id),
      ).toEqual(['b-2'])
      version(provider, '7.1', 'fictional-server-b')
      await scopedList(holder, provider, 'fictional-server-b')
      expect(probe).toHaveBeenCalledTimes(3)
    })

    it('a late old answer follows its own replacement and never another connection', async () => {
      let release!: (models: ModelChoice[]) => void
      let first = true
      const { holder } = catalogue(async (_provider, _profile, id) => {
        if (first) {
          first = false
          return new Promise<ModelChoice[]>((resolve) => {
            release = resolve
          })
        }
        return endpointRows(
          id === 'fictional-server-a'
            ? 'fresh-a'
            : id === 'fictional-server-b'
              ? 'stable-b'
              : 'legacy-model',
        )
      })
      const before = scopedList(holder, provider, 'fictional-server-a')
      const b = scopedList(holder, provider, 'fictional-server-b')
      const forget: (provider: Provider, connectionId?: string) => void =
        holder.forgetModels.bind(holder)
      forget(provider, 'fictional-server-a')
      const after = scopedList(holder, provider, 'fictional-server-a')
      release(endpointRows('old-a'))
      expect((await before).models.map((one) => one.id)).toEqual(['fresh-a'])
      expect((await after).models.map((one) => one.id)).toEqual(['fresh-a'])
      expect((await b).models.map((one) => one.id)).toEqual(['stable-b'])
    })
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: both built-in modes share the unchanged default catalogue memo`, async () => {
    const { holder, probe } = catalogue(async () => endpointRows('legacy-model'))
    const original = await holder.modelList(provider)
    for (const method of ['sign-in', 'api-key'] as const) {
      expect(await scopedList(holder, provider, `${provider}:${method}`)).toEqual(original)
    }
    expect(probe).toHaveBeenCalledExactlyOnceWith(provider, DEFAULT_PROFILE_ID)
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: concurrent readers retry only their failed connection`, async () => {
    let release!: (answer: ModelCatalogue) => void
    let first = true
    const { holder, probe } = catalogue(async (_provider, _profile, id) => {
      if (first) {
        first = false
        return new Promise<ModelCatalogue>((resolve) => {
          release = resolve
        })
      }
      return endpointRows(id === 'fictional-server-a' ? 'fresh-a' : 'stable-b')
    })
    const a = scopedList(holder, provider, 'fictional-server-a')
    const anotherA = scopedList(holder, provider, 'fictional-server-a', 'fern')
    const b = scopedList(holder, provider, 'fictional-server-b')
    release({ ok: false, reason: 'refused', detail: 'Fictional endpoint unavailable' })
    const [firstA, sharedA, stableB] = await Promise.all([a, anotherA, b])
    expect(firstA.notAsked).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'Fictional endpoint unavailable',
    })
    expect(sharedA.notAsked).toEqual(firstA.notAsked)
    expect(stableB.models.map((row) => row.id)).toEqual(['stable-b'])
    const next = await Promise.all([
      scopedList(holder, provider, 'fictional-server-a'),
      scopedList(holder, provider, 'fictional-server-a', 'fern'),
    ])
    expect(next.map((list) => list.models.map((row) => row.id))).toEqual([['fresh-a'], ['fresh-a']])
    expect((await scopedList(holder, provider, 'fictional-server-b')).models).toEqual(
      stableB.models,
    )
    expect(probe.mock.calls.map((call) => call[2])).toEqual([
      'fictional-server-a',
      'fictional-server-b',
      'fictional-server-a',
    ])
  })

  it(`${provider}: shutdown serves only the cached connection and starts no cold probe`, async () => {
    let closing = false
    const models = endpointRows('fictional-model')
    const { holder, probe } = catalogue(
      async () => models,
      () => closing,
    )
    await scopedList(holder, provider, 'fictional-server-a')
    closing = true
    const read: (profile: string, provider: Provider, id?: string) => Promise<ModelCatalogue> =
      holder.providerModels.bind(holder)
    expect(await read(DEFAULT_PROFILE_ID, provider, 'fictional-server-a')).toEqual({
      ok: true,
      models,
    })
    await expect(read(DEFAULT_PROFILE_ID, provider, 'fictional-server-b')).rejects.toThrow(
      'shutting down',
    )
    expect(probe).toHaveBeenCalledTimes(1)
  })
}
