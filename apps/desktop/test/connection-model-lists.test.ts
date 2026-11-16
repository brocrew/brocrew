import { expect, it, vi } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { ProviderLaunchChoices, ProviderModelReadInput } from '../src/shared/provider-launch'
import type { ListedModel } from '../src/shared/model-choice-contracts'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { createModelLists, type ModelLists } from '../src/renderer/src/lib/model-lists'

const firstId = 'fictional-endpoint-a'
const otherId = 'fictional-endpoint-b'

function row(id: string): ListedModel {
  return { id, label: id, addedBy: 'the-provider' }
}

function facts(provider: Provider, id?: string, profile?: string): ProviderLaunchChoices {
  const prefix = id === firstId ? 'a' : id === otherId ? 'b' : 'legacy'
  const model = `${prefix}-${profile === 'fern' ? '2' : '1'}`
  const pair = { model, effort: null }
  return {
    list: {
      provider,
      models: [1, 2].map((n) => row(`${prefix}-${n}`)),
      notAsked: null,
      standIn: null,
      lastPicked: null,
      startsOn: { ...pair, from: 'its-default' },
    },
    defaultConnectionId: id ?? `${provider}:sign-in`,
    ready: id !== `${provider}:sign-in`,
    defaultModel: pair,
    defaultModelToSend: null,
  }
}

function pending() {
  let resolve!: (answer: ProviderLaunchChoices) => void
  const promise = new Promise<ProviderLaunchChoices>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

function fixture(
  provider: Provider,
  receive = async (input: ProviderModelReadInput) =>
    facts(input.provider, input.connectionId, input.profileId),
) {
  const read = vi.fn(receive)
  const add = vi.fn(async (): Promise<readonly string[]> => [])
  const remove = vi.fn(async (): Promise<readonly string[]> => [])
  const lists = createModelLists(() => ({
    providerLaunchChoices: read,
    resolveProviderLaunch: async () => {
      throw new Error('No selection request')
    },
    addHandAddedModel: add,
    deleteHandAddedModel: remove,
  }))
  const held: (p: Provider, profile?: string, id?: string) => ReturnType<ModelLists['held']> =
    lists.held.bind(lists)
  const choices: (p: Provider, profile?: string, id?: string) => ReturnType<ModelLists['choices']> =
    lists.choices.bind(lists)
  const readiness: (
    p: Provider,
    profile?: string,
    id?: string,
  ) => ReturnType<ModelLists['readiness']> = lists.readiness.bind(lists)
  return {
    lists,
    read,
    add,
    remove,
    ask(id?: string, profile?: string, once = false) {
      const options = { once, ...(id === undefined ? {} : { connectionId: id }) }
      return lists.read(provider, profile, options)
    },
    held: (id?: string, profile?: string) => held(provider, profile, id),
    choices: (id?: string, profile?: string) => choices(provider, profile, id),
    readiness: (id?: string, profile?: string) => readiness(provider, profile, id),
  }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: two connections in one profile retain their own rows and exact read identity`, async () => {
    const f = fixture(provider)
    await f.ask(firstId)
    await f.ask(otherId)
    expect(f.read.mock.calls).toEqual([
      [{ provider, connectionId: firstId }],
      [{ provider, connectionId: otherId }],
    ])
    expect(f.held(firstId)).toEqual({ state: 'answered', list: facts(provider, firstId).list })
    expect(f.held(otherId)).toEqual({ state: 'answered', list: facts(provider, otherId).list })
  })

  it(`${provider}: profiles retain separate choices over the same connection rows`, async () => {
    const f = fixture(provider)
    await f.ask(firstId, DEFAULT_PROFILE_ID)
    await f.ask(firstId, 'fern')
    expect(f.choices(firstId, DEFAULT_PROFILE_ID)?.defaultModel).toEqual({
      model: 'a-1',
      effort: null,
    })
    expect(f.choices(firstId, 'fern')?.defaultModel).toEqual({ model: 'a-2', effort: null })
    expect(f.choices(firstId, DEFAULT_PROFILE_ID)?.list.models).toEqual(
      f.choices(firstId, 'fern')?.list.models,
    )
  })

  it(`${provider}: a read joins only its own route while another route is still pending`, async () => {
    const a = pending()
    const b = pending()
    const f = fixture(provider, async (input) =>
      input.connectionId === firstId
        ? a.promise
        : input.connectionId === otherId
          ? b.promise
          : facts(provider),
    )
    const reads = [f.ask(firstId), f.ask(firstId), f.ask(otherId)]
    try {
      expect(f.read).toHaveBeenCalledTimes(2)
      expect(f.held(firstId)).toEqual({ state: 'asking' })
      expect(f.held(otherId)).toEqual({ state: 'asking' })
    } finally {
      a.resolve(facts(provider, firstId))
      b.resolve(facts(provider, otherId))
      await Promise.all(reads)
    }
  })

  it(`${provider}: a late previous-route response cannot replace the selected route's rows`, async () => {
    const a = pending()
    const f = fixture(provider, async (input) =>
      input.connectionId === firstId ? a.promise : facts(provider, input.connectionId),
    )
    const first = f.ask(firstId)
    try {
      await f.ask(otherId)
      expect(f.choices(otherId)?.defaultModel?.model).toBe('b-1')
    } finally {
      a.resolve(facts(provider, firstId))
      await first
    }
    expect(f.choices(otherId)?.list.models).toEqual(facts(provider, otherId).list.models)
    expect(f.choices(firstId)?.list.models).toEqual(facts(provider, firstId).list.models)
  })

  it(`${provider}: built-in modes share current model rows and retain distinct readiness facts`, async () => {
    let revision = 0
    const f = fixture(provider, async (input) => {
      const answer = facts(provider, input.connectionId)
      const model = `shared-${++revision}`
      return { ...answer, list: { ...answer.list, models: [row(model)] } }
    })
    const signin = `${provider}:sign-in`
    const key = `${provider}:api-key`
    await f.ask(signin)
    await f.ask(key)
    expect(f.choices(signin)?.ready).toBe(false)
    expect(f.choices(key)?.ready).toBe(true)
    expect(f.readiness(signin)).toEqual({ state: 'settled', ready: false, reason: null })
    expect(f.readiness(key)).toEqual({ state: 'settled', ready: true, reason: null })
    expect(f.choices(signin)?.list.models).toEqual(f.choices(key)?.list.models)
    expect(f.choices(signin)?.list.models[0]?.id).toBe('shared-2')
  })

  it(`${provider}: forgetting credentials retires old responses across connection scopes`, async () => {
    const a = pending()
    const b = pending()
    let firstA = true
    const fresh = facts(provider, firstId, 'fern')
    const f = fixture(provider, async (input) => {
      if (input.connectionId === firstId && firstA) {
        firstA = false
        return a.promise
      }
      if (input.connectionId === otherId) return b.promise
      return input.connectionId === firstId ? fresh : facts(provider)
    })
    const old = [f.ask(firstId), f.ask(otherId)]
    try {
      f.lists.forget(DEFAULT_PROFILE_ID)
      await f.ask(firstId)
    } finally {
      a.resolve(facts(provider, firstId))
      b.resolve(facts(provider, otherId))
      await Promise.all(old)
    }
    expect(f.choices(firstId)?.defaultModel?.model).toBe('a-2')
    expect(f.held(otherId)).toBeNull()
  })

  it(`${provider}: advertised fresh-default metadata cannot supply rows before its scoped read`, async () => {
    const a = pending()
    const f = fixture(provider, async (input) =>
      input.connectionId === firstId
        ? a.promise
        : { ...facts(provider), defaultConnectionId: firstId },
    )
    await f.ask()
    expect(f.read).toHaveBeenCalledExactlyOnceWith({ provider })
    expect(f.choices()?.defaultConnectionId).toBe(firstId)
    expect(f.held(firstId)).toBeNull()
    const scoped = f.ask(firstId)
    try {
      expect(f.held(firstId)).toEqual({ state: 'asking' })
      expect(f.choices(firstId)).toBeNull()
    } finally {
      a.resolve(facts(provider, firstId))
      await scoped
    }
    expect(f.choices(firstId)?.defaultModel?.model).toBe('a-1')
  })

  it(`${provider}: once and failure retry apply to the selected route without retiring its neighbor`, async () => {
    let first = true
    const f = fixture(provider, async (input) => {
      if (input.connectionId === firstId && first) {
        first = false
        const answer = facts(provider, firstId)
        return {
          ...answer,
          list: {
            ...answer.list,
            models: [],
            notAsked: { ok: false, reason: 'refused', detail: 'Fictional endpoint warming up' },
          },
        }
      }
      return facts(provider, input.connectionId)
    })
    await f.ask(firstId, undefined, true)
    await f.ask(firstId, undefined, true)
    expect(f.read).toHaveBeenCalledTimes(1)
    await f.ask(otherId)
    await f.ask(firstId)
    expect(f.read).toHaveBeenCalledTimes(3)
    expect(f.choices(firstId)?.list.notAsked).toBeNull()
    expect(f.choices(otherId)?.defaultModel?.model).toBe('b-1')
  })
  it(`${provider}: add, remove and roster reread keep every recorded route identity`, async () => {
    const manual: string[] = []
    const failedId = 'fictional-failed-endpoint'
    const f = fixture(provider, async (input) => {
      const answer = facts(provider, input.connectionId, input.profileId)
      const added = manual.map((id): ListedModel => ({ ...row(id), addedBy: 'a-person' }))
      return input.connectionId === failedId
        ? {
            ...answer,
            list: {
              ...answer.list,
              models: [],
              notAsked: { ok: false, reason: 'refused', detail: 'Fictional failed neighbor' },
            },
          }
        : { ...answer, list: { ...answer.list, models: [...answer.list.models, ...added] } }
    })
    await f.ask(firstId)
    await f.ask(otherId, 'fern')
    f.add.mockImplementationOnce(async () => {
      manual.push('manual')
      return manual
    })
    await expect(f.lists.add(provider, ' manual ')).resolves.toBeNull()
    expect(f.add).toHaveBeenCalledExactlyOnceWith({ provider, model: 'manual' })
    expect(f.choices(firstId)?.list.models.map((m) => m.id)).toEqual(['a-1', 'a-2', 'manual'])
    expect(f.choices(otherId, 'fern')?.list.models.map((m) => m.id)).toEqual([
      'b-1',
      'b-2',
      'manual',
    ])
    f.remove.mockImplementationOnce(async () => {
      manual.splice(0)
      return []
    })
    await expect(f.lists.remove(provider, 'manual')).resolves.toBeNull()
    expect(f.remove).toHaveBeenCalledExactlyOnceWith({ provider, model: 'manual' })
    expect(f.choices(firstId)?.list.models.map((m) => m.id)).toEqual(['a-1', 'a-2'])
    expect(f.choices(otherId, 'fern')?.list.models.map((m) => m.id)).toEqual(['b-1', 'b-2'])
    await f.ask(failedId)
    const beforeRosterRead = f.read.mock.calls.length
    manual.push('from-another-window')
    await f.lists.reread()
    expect(f.read.mock.calls.slice(beforeRosterRead)).toEqual([
      [{ provider, connectionId: firstId }],
      [{ provider, profileId: 'fern', connectionId: otherId }],
    ])
    expect(f.choices(firstId)?.list.models.at(-1)?.id).toBe('from-another-window')
    expect(f.choices(otherId, 'fern')?.list.models.at(-1)?.id).toBe('from-another-window')
    expect(f.choices(otherId, 'fern')?.defaultModel?.model).toBe('b-2')
    expect(f.choices(failedId)?.list.notAsked).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'Fictional failed neighbor',
    })
  })

  it(`${provider}: a missing profile borrows neither another route's rows nor its read failure`, async () => {
    const f = fixture(provider, async (input) => {
      const answer = facts(provider, input.connectionId, input.profileId)
      const manual: ListedModel = { ...row('manual'), addedBy: 'a-person' }
      return input.profileId === 'missing'
        ? {
            ...answer,
            list: {
              ...answer.list,
              models: [manual],
              notAsked: { ok: false, reason: 'no-profile' },
            },
          }
        : { ...answer, list: { ...answer.list, models: [...answer.list.models, manual] } }
    })
    await f.ask(otherId)
    await f.ask(firstId, 'missing')
    expect(f.choices(firstId, 'missing')?.list.notAsked).toEqual({
      ok: false,
      reason: 'no-profile',
    })
    expect(f.choices(firstId, 'missing')?.list.models.map((m) => m.id)).toEqual(['manual'])
    expect(f.choices(otherId)?.list.models.map((m) => m.id)).toEqual(['b-1', 'b-2', 'manual'])
    await f.ask(firstId, 'fern')
    expect(f.choices(firstId, 'missing')?.list.models.map((m) => m.id)).toEqual(['manual'])
    expect(f.choices(otherId)?.list.notAsked).toBeNull()
  })

  it(`${provider}: forgetting one profile retires another profile's old refresh without dropping its newer answer`, async () => {
    const a = pending()
    const oldB = pending()
    const successorB = pending()
    let bReads = 0
    const freshB = facts(provider, otherId, 'fern')
    const current = {
      ...freshB,
      list: {
        ...freshB.list,
        models: freshB.list.models.map((m) => ({ ...m, label: 'Current endpoint B' })),
      },
    }
    const f = fixture(provider, async (input) => {
      if (input.connectionId === firstId) return a.promise
      if (input.connectionId === otherId) {
        bReads++
        return bReads === 1 ? freshB : bReads === 2 ? oldB.promise : successorB.promise
      }
      return facts(provider)
    })
    await f.ask(otherId, 'fern')
    const first = f.ask(firstId)
    const refresh = f.lists.reread()
    let successorRefresh: Promise<void> | undefined
    let joinedBefore: Promise<void> | undefined
    let joinedAfter: Promise<void> | undefined
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(bReads).toBe(2)
      f.lists.forget(DEFAULT_PROFILE_ID)
      successorRefresh = f.lists.reread()
      await Promise.resolve()
      await Promise.resolve()
      expect(bReads).toBe(3)
      joinedBefore = f.ask(otherId, 'fern')
      const callsBeforeOldAnswer = f.read.mock.calls.length
      oldB.resolve(freshB)
      await refresh
      joinedAfter = f.ask(otherId, 'fern')
      expect(joinedAfter).toBe(joinedBefore)
      let settled = false
      void joinedAfter.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(f.read).toHaveBeenCalledTimes(callsBeforeOldAnswer)
    } finally {
      a.resolve(facts(provider, firstId))
      oldB.resolve(freshB)
      successorB.resolve(current)
      await Promise.all([first, refresh, successorRefresh, joinedBefore, joinedAfter])
    }
    expect(f.held(firstId)).toBeNull()
    expect(f.choices(otherId, 'fern')?.list).toEqual(current.list)
  })
}
