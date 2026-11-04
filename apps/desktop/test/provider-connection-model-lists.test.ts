import { expect, it, vi } from 'vitest'
import { createModelLists } from '../src/renderer/src/lib/model-lists'
import type { ModelList, Provider } from '../src/shared/runtime-ipc'

function answer(model: string): ModelList {
  return {
    provider: 'claude',
    notAsked: null,
    standIn: null,
    models: [{ id: model, label: model, addedBy: 'the-provider', efforts: [] }],
    lastPicked: null,
    startsOn: null,
  }
}

function fixture() {
  const waiting = new Map<string, (list: ModelList) => void>()
  const modelList = vi.fn(
    (input: { provider: Provider; profileId?: string; connectionId?: string }) =>
      new Promise<ModelList>((done) => waiting.set(input.connectionId ?? 'legacy', done)),
  )
  const lists = createModelLists(() => ({
    modelList,
    addHandAddedModel: vi.fn(async () => []),
    deleteHandAddedModel: vi.fn(async () => []),
  }))
  const read = (id?: string) =>
    Reflect.apply(lists.read, lists, [
      'claude',
      'fern',
      id === undefined ? undefined : { connectionId: id },
    ]) as Promise<void>
  const held = (id?: string) => Reflect.apply(lists.held, lists, ['claude', 'fern', id])
  return { waiting, modelList, lists, read, held }
}

it('separate connection reads never join or overwrite each other when answers arrive out of order', async () => {
  const f = fixture()
  const first = f.read('claude:sign-in')
  const second = f.read('claude:api-key')
  expect(f.modelList).toHaveBeenCalledTimes(2)
  expect(f.modelList).toHaveBeenNthCalledWith(1, {
    provider: 'claude',
    profileId: 'fern',
    connectionId: 'claude:sign-in',
  })
  expect(f.modelList).toHaveBeenNthCalledWith(2, {
    provider: 'claude',
    profileId: 'fern',
    connectionId: 'claude:api-key',
  })
  f.waiting.get('claude:api-key')!(answer('fictional-key-model'))
  await second
  f.waiting.get('claude:sign-in')!(answer('fictional-subscription-model'))
  await first
  expect(f.held('claude:api-key')).toEqual({
    state: 'answered',
    list: answer('fictional-key-model'),
  })
  expect(f.held('claude:sign-in')).toEqual({
    state: 'answered',
    list: answer('fictional-subscription-model'),
  })
  expect(f.held()).toBeNull()
})

it('forgetting an agent discards every connection and prevents old replies from returning', async () => {
  const f = fixture()
  const first = f.read('claude:sign-in')
  const second = f.read('claude:api-key')
  expect(f.modelList).toHaveBeenCalledTimes(2)
  f.lists.forget('fern')
  f.waiting.get('claude:api-key')!(answer('fictional-key-model'))
  f.waiting.get('claude:sign-in')!(answer('fictional-subscription-model'))
  await Promise.all([first, second])
  expect(f.held('claude:api-key')).toBeNull()
  expect(f.held('claude:sign-in')).toBeNull()
})

it('an omitted legacy selection keeps its exact old wire payload', async () => {
  const f = fixture()
  const pending = f.read()
  expect(f.modelList).toHaveBeenCalledExactlyOnceWith({ provider: 'claude', profileId: 'fern' })
  f.waiting.get('legacy')!(answer('fictional-legacy-model'))
  await pending
  expect(f.held()).toEqual({ state: 'answered', list: answer('fictional-legacy-model') })
})
