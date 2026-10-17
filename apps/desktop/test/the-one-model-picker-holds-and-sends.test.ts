import { describe, expect, it, vi } from 'vitest'
import { NO_LAUNCH_CHOICES } from '../src/renderer/src/lib/launch-choices'
import {
  createModelLists,
  pickInAConversation,
  theDraftEffort,
  theFormSends,
  theFormStartsOn,
  whatAPickBecameSays,
  type PickedModel,
} from '../src/renderer/src/lib/model-lists'
import type { SessionRecord } from '../src/renderer/src/lib/session-record'
import type { ModelList } from '../src/shared/runtime-ipc'

/**
 * UI-012 · **the one model picker's holder and its arithmetic** — landing coverage for what the
 * commit's re-aimed tests do not drive: the holder's read/re-read rules, what the form starts on and
 * sends, the order of a pick in a conversation, and the sentence a Take says it reaches.
 */

const row = (id: string, efforts: string[] = [], extra: object = {}) => ({
  id,
  label: id,
  efforts: efforts.map((level) => ({ id: level, label: level })),
  addedBy: 'the-provider' as const,
  ...extra,
})

const list = (over: Partial<ModelList> = {}): ModelList => ({
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: [row('opus', ['low', 'high'], { defaultEffort: 'high' }), row('haiku')],
  lastPicked: null,
  startsOn: null,
  ...over,
})

const NOT_ASKED = { ok: false, reason: 'no-profile' } as unknown as NonNullable<
  ModelList['notAsked']
>

function holder(read: (provider: string) => Promise<ModelList>) {
  const modelList = vi.fn((input: { provider: string }) => read(input.provider))
  const addHandAddedModel = vi.fn(async () => undefined)
  const deleteHandAddedModel = vi.fn(async () => undefined)
  const lists = createModelLists(
    () => ({ modelList, addHandAddedModel, deleteHandAddedModel }) as never,
  )
  return { lists, modelList, addHandAddedModel, deleteHandAddedModel }
}

describe('UI-012 · the window’s holder of the picker’s lists', () => {
  it('🔴 a list read twice at once is asked once, and an answered list is never asked again', async () => {
    const { lists, modelList } = holder(async () => list())
    expect(lists.held('claude')).toBeNull()
    const a = lists.read('claude')
    const b = lists.read('claude')
    expect(lists.held('claude')).toEqual({ state: 'asking' })
    await Promise.all([a, b])
    expect(modelList).toHaveBeenCalledTimes(1)
    await lists.read('claude')
    expect(modelList).toHaveBeenCalledTimes(1)
    expect(lists.held('claude')?.state).toBe('answered')
  })

  it('⚑ the key is provider and profile: two profiles hold two lists', async () => {
    const { lists, modelList } = holder(async () => list())
    await lists.read('claude')
    await lists.read('claude', 'work')
    expect(modelList).toHaveBeenCalledTimes(2)
    expect(modelList).toHaveBeenLastCalledWith({ provider: 'claude', profileId: 'work' })
  })

  it('⛔ a failed list is asked again on a person’s press, but not by a warming screen (`once`)', async () => {
    let fail = true
    const { lists, modelList } = holder(async () => {
      if (fail) throw new Error('the program is missing')
      return list()
    })
    await lists.read('claude', undefined, { once: true })
    const held = lists.held('claude')
    expect(held?.state).toBe('unread')
    await lists.read('claude', undefined, { once: true })
    expect(modelList, '`once` re-asked a failure').toHaveBeenCalledTimes(1)
    fail = false
    await lists.read('claude')
    expect(modelList).toHaveBeenCalledTimes(2)
    expect(lists.held('claude')?.state).toBe('answered')
  })

  it('⚑ an answer that says the provider’s rows are missing is asked again on a press', async () => {
    const { lists, modelList } = holder(async () => list({ notAsked: NOT_ASKED }))
    await lists.read('claude')
    await lists.read('claude')
    expect(modelList).toHaveBeenCalledTimes(2)
  })

  it('🔴 reread() asks again only the lists that ANSWERED, and a failed re-read keeps the answer', async () => {
    let calls = 0
    let failNow = false
    const { lists, modelList } = holder(async (provider) => {
      calls += 1
      if (provider === 'codex') throw new Error('down')
      if (failNow) throw new Error('a hiccup')
      return list({ lastPicked: { model: 'opus', effort: `n${calls}` } })
    })
    await lists.read('claude')
    await lists.read('codex')
    expect(lists.held('codex')?.state).toBe('unread')
    const before = modelList.mock.calls.length

    await lists.reread()
    expect(
      modelList.mock.calls.length - before,
      'a failed list was re-asked by a roster change',
    ).toBe(1)

    failNow = true
    const kept = lists.held('claude')
    await lists.reread()
    expect(lists.held('claude'), 'a failed re-read dropped the answer it had').toBe(kept)
  })

  it('🔴 add() trims the name, then reads that provider’s lists again; the door’s words come back', async () => {
    const { lists, modelList, addHandAddedModel } = holder(async () => list())
    await lists.read('claude')
    expect(await lists.add('claude', '  my-model  ')).toBeNull()
    expect(addHandAddedModel).toHaveBeenCalledWith({ provider: 'claude', model: 'my-model' })
    expect(modelList).toHaveBeenCalledTimes(2)

    addHandAddedModel.mockRejectedValueOnce(new Error('already listed'))
    const said = await lists.add('claude', 'opus')
    expect(said).toContain('already listed')
    expect(modelList, 'a refused add re-read the list').toHaveBeenCalledTimes(2)
  })

  it('⚑ remove() does the same for the other door', async () => {
    const { lists, modelList, deleteHandAddedModel } = holder(async () => list())
    await lists.read('claude')
    expect(await lists.remove('claude', 'my-model')).toBeNull()
    expect(deleteHandAddedModel).toHaveBeenCalledWith({ provider: 'claude', model: 'my-model' })
    expect(modelList).toHaveBeenCalledTimes(2)

    deleteHandAddedModel.mockRejectedValueOnce(new Error('not a hand-added model'))
    expect(await lists.remove('claude', 'opus')).toContain('not a hand-added model')
    expect(modelList).toHaveBeenCalledTimes(2)
  })
})

describe('UI-012 · what the new-conversation form starts on and sends', () => {
  it('🔴 starts on the last pick, else what the host would start on, else nothing', () => {
    expect(theFormStartsOn(null)).toBeNull()
    expect(theFormStartsOn(list())).toBeNull()
    const starts = { model: 'haiku', effort: null, from: 'its-default' as const }
    expect(theFormStartsOn(list({ startsOn: starts }))).toEqual({ model: 'haiku', effort: null })
    expect(
      theFormStartsOn(list({ startsOn: starts, lastPicked: { model: 'opus', effort: 'low' } })),
    ).toEqual({ model: 'opus', effort: 'low' })
  })

  it('🔴 a person’s pick is sent; the last pick only where the host would not start there anyway', () => {
    const last = { model: 'opus', effort: 'low' }
    const picked = { ...NO_LAUNCH_CHOICES, model: ' haiku ', reasoningEffort: '' }
    expect(theFormSends(picked, list({ lastPicked: last }))).toEqual({
      model: 'haiku',
      effort: null,
    })

    expect(
      theFormSends(
        NO_LAUNCH_CHOICES,
        list({ lastPicked: last, startsOn: { ...last, from: 'its-default' as const } }),
      ),
    ).toBeNull()
    expect(theFormSends(NO_LAUNCH_CHOICES, list({ lastPicked: last, startsOn: null }))).toEqual(
      last,
    )
    expect(
      theFormSends(
        NO_LAUNCH_CHOICES,
        list({
          lastPicked: last,
          startsOn: { model: 'opus', effort: 'high', from: 'its-default' as const },
        }),
      ),
    ).toEqual(last)
    expect(
      theFormSends(
        NO_LAUNCH_CHOICES,
        list({ startsOn: { ...last, from: 'its-default' as const } }),
      ),
    ).toBeNull()
  })

  it('⚑ a draft on a model no row names keeps the effort it holds', () => {
    expect(theDraftEffort(list(), 'gpt-hand-added', 'high')).toBe('high')
    // ⛔ A hand-added model while the provider's own rows are missing offers efforts nobody knows.
    const mine = list({
      notAsked: NOT_ASKED,
      models: [row('mine', ['low'], { addedBy: 'a-person' })],
    })
    expect(theDraftEffort(mine, 'mine', 'low')).toBeNull()
  })
})

describe('UI-012 · a pick in a conversation', () => {
  const pick: PickedModel = { provider: 'claude', model: 'opus', effort: 'high' }

  function storeOver(record: object | null) {
    const setSessionSetting = vi.fn(async () => undefined)
    return {
      setSessionSetting,
      store: { get: () => record as unknown as SessionRecord | null, setSessionSetting },
    }
  }
  const held = (settings: object, error: string | null = null) => ({
    error,
    meta: { settings },
  })

  it('🔴 the model is always sent, then the effort where it differs from what the record holds', async () => {
    const { store, setSessionSetting } = storeOver(held({ reasoningEffort: 'low' }))
    await pickInAConversation(store, 's1', pick)
    expect(setSessionSetting.mock.calls).toEqual([
      ['s1', { kind: 'model', value: 'opus' }],
      ['s1', { kind: 'reasoningEffort', value: 'high' }],
    ])
  })

  it('⚑ the model alone when the record already holds the effort — or has one queued', async () => {
    const same = storeOver(held({ reasoningEffort: 'high' }))
    await pickInAConversation(same.store, 's1', pick)
    expect(same.setSessionSetting).toHaveBeenCalledTimes(1)

    const queued = storeOver(
      held({ reasoningEffort: 'low', pendingReasoningEffort: { value: 'high' } }),
    )
    await pickInAConversation(queued.store, 's1', pick)
    expect(queued.setSessionSetting, 'the queued effort was ignored').toHaveBeenCalledTimes(1)

    const queuedOther = storeOver(
      held({ reasoningEffort: 'high', pendingReasoningEffort: { value: 'low' } }),
    )
    await pickInAConversation(queuedOther.store, 's1', pick)
    expect(queuedOther.setSessionSetting).toHaveBeenCalledTimes(2)
  })

  it('⛔ a refusal stops the sequence, and a pick with no effort names the model only', async () => {
    const refused = storeOver(held({ reasoningEffort: 'low' }, 'The model was refused'))
    await pickInAConversation(refused.store, 's1', pick)
    expect(refused.setSessionSetting).toHaveBeenCalledTimes(1)

    const none = storeOver(held({ reasoningEffort: 'low' }))
    await pickInAConversation(none.store, 's1', { ...pick, effort: null })
    expect(none.setSessionSetting).toHaveBeenCalledTimes(1)

    const gone = storeOver(null)
    await pickInAConversation(gone.store, 's1', pick)
    expect(gone.setSessionSetting).toHaveBeenCalledTimes(1)
  })

  // ⚑ D-048 · the prediction went: the host answers what the pick became, and the words say that.
  it('🔴 what a pick became is said from the host’s answer, in the provider’s name', () => {
    expect(whatAPickBecameSays({ itsAgentsDefault: true, theLastPick: true }, 'claude')).toBe(
      'This conversation, this agent’s default for new conversations, and your last pick for Claude.',
    )
    expect(
      whatAPickBecameSays(
        {
          itsAgentsDefault: false,
          theLastPick: true,
          because: 'its-agent-runs-on-another-provider',
        },
        'claude',
      ),
    ).toBe(
      'This conversation, and your last pick for Claude. This agent runs on another provider, so its default stays as it is.',
    )
    expect(
      whatAPickBecameSays(
        { itsAgentsDefault: false, theLastPick: false, because: 'the-list-does-not-hold-it' },
        'codex',
      ),
    ).toBe('This conversation only: Codex’s list doesn’t have it.')
  })
})
