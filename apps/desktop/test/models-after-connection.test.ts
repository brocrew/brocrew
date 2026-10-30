import { expect, it, vi } from 'vitest'
import { createModelLists } from '../src/renderer/src/lib/model-lists'
import { modelsAfterConnection } from '../src/renderer/src/lib/models-after-connection'
import type { ModelList } from '../src/shared/runtime-ipc'

const GOOD: ModelList = {
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: [{ id: 'harbor-model', label: 'Harbor', efforts: [], addedBy: 'the-provider' }],
  lastPicked: null,
  startsOn: null,
}
const WARMING: ModelList = {
  ...GOOD,
  models: [],
  notAsked: { ok: false, reason: 'refused', detail: 'The fictional provider is warming up.' },
}
function holder(read: () => Promise<ModelList>) {
  return createModelLists(() => ({
    modelList: read,
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
  }))
}

it('retries a transient connection answer without another person gesture', async () => {
  const read = vi
    .fn<() => Promise<ModelList>>()
    .mockResolvedValueOnce(WARMING)
    .mockResolvedValueOnce(GOOD)
  const wait = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async () => {})
  const lists = holder(read)
  await modelsAfterConnection(lists, 'claude', new AbortController().signal, wait)
  expect(read).toHaveBeenCalledTimes(2)
  expect(wait).toHaveBeenCalledWith(150, expect.any(AbortSignal))
  expect(lists.held('claude')).toEqual({ state: 'answered', list: GOOD })
})

it('stops after the first usable catalogue without a delay or extra probe', async () => {
  const read = vi.fn(async () => GOOD)
  const wait = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async () => {})
  await modelsAfterConnection(holder(read), 'claude', new AbortController().signal, wait)
  expect(read).toHaveBeenCalledTimes(1)
  expect(wait).not.toHaveBeenCalled()
})

it('limits persistent failures to three reads and two brief delays', async () => {
  const read = vi.fn(async () => {
    throw new Error('Fictional provider unavailable')
  })
  const wait = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async () => {})
  const lists = holder(read)
  await modelsAfterConnection(lists, 'claude', new AbortController().signal, wait)
  expect(read).toHaveBeenCalledTimes(3)
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([150, 300])
  expect(lists.held('claude')).toEqual({ state: 'unread', why: 'Fictional provider unavailable' })
})

it('does not retry after the card closes or changes provider', async () => {
  const stop = new AbortController()
  const read = vi.fn(async () => WARMING)
  const wait = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async () => stop.abort())
  await modelsAfterConnection(holder(read), 'claude', stop.signal, wait)
  expect(read).toHaveBeenCalledTimes(1)
  expect(wait).toHaveBeenCalledTimes(1)
})
