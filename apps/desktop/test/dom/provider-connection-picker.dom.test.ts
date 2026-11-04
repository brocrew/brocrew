import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, type Component } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ModelList } from '../../src/shared/runtime-ipc'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll, type Mounted } from './harness'

function connection(
  provider: Provider,
  authMethod: 'sign-in' | 'api-key',
  enabled = true,
): ProviderConnection {
  return {
    id: `${provider}:${authMethod}`,
    provider,
    name: authMethod === 'api-key' ? 'API key' : 'Fictional subscription',
    authMethod,
    credentialSource: authMethod === 'api-key' ? 'provider-api-key' : 'provider-sign-in',
    baseUrl: null,
    enabled,
    contractVersion: 1,
  }
}
function answer(provider: Provider, id: string): ModelList {
  return {
    provider,
    models: [
      {
        id: `model-${id}`,
        label: `model-${id}`,
        addedBy: 'the-provider',
        efforts: [{ id: 'medium', label: 'Medium' }],
        defaultEffort: 'medium',
      },
    ],
    notAsked: null,
    standIn: null,
    lastPicked: null,
    startsOn: null,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => providersBridge())
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

function fixture(
  options: {
    rows?: ProviderConnection[]
    read?: () => Promise<ProviderConnection[]>
    locked?: boolean
    personal?: boolean
    shown?: { provider: Provider; connectionId?: string; model: string; effort: string | null }
  } = {},
) {
  const rows = options.rows ?? [connection('claude', 'sign-in'), connection('codex', 'sign-in')]
  const metadata = vi.fn(options.read ?? (async () => rows))
  window.api.runtime.providerConnections = metadata
  const held = new Map<string, ReturnType<typeof deferred<ModelList>>>()
  let personal = options.personal === true ? ['fictional-personal'] : []
  const remove = vi.fn(async ({ model }: { model: string }) => {
    personal = personal.filter((id) => id !== model)
    return personal
  })
  const modelList = vi.fn(
    async ({ provider, connectionId }: { provider: Provider; connectionId?: string }) => {
      const id = connectionId ?? `${provider}:legacy`
      const own = answer(provider, id)
      return (
        held.get(id)?.promise ?? {
          ...own,
          models: [
            ...own.models,
            ...personal.map((model) => ({
              id: model,
              label: model,
              addedBy: 'a-person' as const,
              efforts: [{ id: 'medium', label: 'Medium' }],
              defaultEffort: 'medium',
            })),
          ],
        }
      )
    },
  )
  const lists = createModelLists(() => ({
    modelList,
    addHandAddedModel: vi.fn(async () => []),
    deleteHandAddedModel: remove,
  }))
  const take = vi.fn(async () => null)
  const props = reactive({
    providers: ['claude', 'codex'],
    readiness: { claude: true, codex: true },
    shown: options.shown ?? null,
    preferredProvider: 'claude',
    profileId: undefined as string | undefined,
    lockedConnection: options.locked ?? false,
    takeWords: 'Use this model',
    take,
    lists,
  })
  const wrapper = defineComponent({ setup: () => () => h(ModelPicker as Component, props) })
  const m = mount(wrapper, {})
  return { m, props, metadata, modelList, held, take, remove }
}
async function open(m: Mounted) {
  ;(m.q('model-picker-face') as HTMLButtonElement).click()
  await expect.poll(() => m.all('model-picker-connection').length).toBe(1)
  return m.q('model-picker-connection') as HTMLSelectElement
}
async function select(m: Mounted, id: string) {
  const control = m.q('model-picker-connection') as HTMLSelectElement
  control.value = id
  control.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}
async function chooseModel(m: Mounted) {
  await expect.poll(() => m.all('model-picker-row').length).toBe(1)
  m.q('model-picker-row').querySelector('input')!.click()
  await nextTick()
}

it('a closed picker reads only metadata; model lists wait for opening and a metadata answer', async () => {
  const pending = deferred<ProviderConnection[]>()
  const f = fixture({ read: () => pending.promise })
  await expect.poll(() => f.metadata.mock.calls.length).toBe(1)
  expect(f.modelList).not.toHaveBeenCalled()
  ;(f.m.q('model-picker-face') as HTMLButtonElement).click()
  await expect.poll(() => f.metadata.mock.calls.length).toBe(1)
  expect(f.modelList).not.toHaveBeenCalled()
  pending.resolve([connection('claude', 'sign-in'), connection('codex', 'sign-in')])
  await expect.poll(() => f.modelList.mock.calls.length).toBe(1)
  expect(f.modelList).toHaveBeenCalledWith({ provider: 'claude', connectionId: 'claude:sign-in' })
})

it('one flat named connection list precedes the model and uses only its selected catalogue', async () => {
  const f = fixture()
  const control = await open(f.m)
  expect([...control.options].map((option) => option.text)).toEqual([
    'Claude · Fictional subscription',
    'Codex · Fictional subscription',
  ])
  expect(f.m.all('model-picker-providers')).toHaveLength(0)
  await chooseModel(f.m)
  ;(f.m.q('model-picker-take') as HTMLButtonElement).click()
  await expect.poll(() => f.take.mock.calls.length).toBe(1)
  expect(f.take).toHaveBeenCalledWith({
    provider: 'claude',
    connectionId: 'claude:sign-in',
    model: 'model-claude:sign-in',
    effort: 'medium',
  })
  expect(f.modelList).toHaveBeenCalledTimes(1)
})

it('a six-entry fictional preview keeps the four extra entries disabled', async () => {
  const rows = [connection('claude', 'sign-in'), connection('codex', 'sign-in')]
  for (let n = 0; n < 4; n++)
    rows.push({
      ...connection('claude', 'sign-in', false),
      id: `fictional-extra-${n}`,
      name: `Fictional route ${n}`,
    })
  const f = fixture({ rows })
  const control = await open(f.m)
  expect(control.options).toHaveLength(6)
  expect([...control.options].filter((option) => option.disabled)).toHaveLength(4)
  expect(
    f.modelList.mock.calls.every(([input]) => !input.connectionId?.startsWith('fictional-extra-')),
  ).toBe(true)
})

it('switching connection clears the carried model and ignores an old held answer', async () => {
  const f = fixture()
  const old = deferred<ModelList>()
  f.held.set('claude:sign-in', old)
  await open(f.m)
  await expect.poll(() => f.modelList.mock.calls.length).toBe(1)
  await select(f.m, 'codex:sign-in')
  await chooseModel(f.m)
  old.resolve(answer('claude', 'old-fictional-account'))
  await nextTick()
  expect(f.m.q('model-picker-panel').textContent).not.toContain('model-old-fictional-account')
  ;(f.m.q('model-picker-take') as HTMLButtonElement).click()
  await expect.poll(() => f.take.mock.calls.length).toBe(1)
  expect(f.take).toHaveBeenCalledWith({
    provider: 'codex',
    connectionId: 'codex:sign-in',
    model: 'model-codex:sign-in',
    effort: 'medium',
  })
})

it('same-provider connections read separate catalogues instead of carrying another connection model', async () => {
  const f = fixture({
    rows: [connection('claude', 'sign-in'), connection('claude', 'api-key')],
    shown: {
      provider: 'claude',
      connectionId: 'claude:sign-in',
      model: 'model-claude:sign-in',
      effort: 'medium',
    },
  })
  await open(f.m)
  await chooseModel(f.m)
  expect(f.modelList).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    connectionId: 'claude:sign-in',
  })
  await select(f.m, 'claude:api-key')
  expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
  await chooseModel(f.m)
  ;(f.m.q('model-picker-take') as HTMLButtonElement).click()
  await expect.poll(() => f.take.mock.calls.length).toBe(1)
  expect(f.take).toHaveBeenCalledWith({
    provider: 'claude',
    connectionId: 'claude:api-key',
    model: 'model-claude:api-key',
    effort: 'medium',
  })
})

it('an existing conversation keeps its bound connection while its model remains editable', async () => {
  const f = fixture({
    locked: true,
    shown: {
      provider: 'codex',
      connectionId: 'codex:sign-in',
      model: 'model-codex:sign-in',
      effort: 'medium',
    },
  })
  const control = await open(f.m)
  expect(control.disabled).toBe(true)
  expect(control.value).toBe('codex:sign-in')
  expect(f.m.q('model-picker-panel').textContent).toContain(
    'This conversation keeps its connection.',
  )
  await chooseModel(f.m)
  expect(f.modelList.mock.calls.every(([input]) => input.connectionId === 'codex:sign-in')).toBe(
    true,
  )
})

it('a missing recorded connection cannot silently choose a different one', async () => {
  const f = fixture({
    locked: true,
    shown: {
      provider: 'codex',
      connectionId: 'codex:missing',
      model: 'fictional-old',
      effort: null,
    },
  })
  await open(f.m)
  expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
  expect(f.modelList).not.toHaveBeenCalled()
  expect(f.take).not.toHaveBeenCalled()
})

it('a metadata read failure shows fixed words without probing or exposing the exception', async () => {
  const f = fixture({
    read: async () => {
      throw new Error('fictional-private-metadata-detail')
    },
  })
  ;(f.m.q('model-picker-face') as HTMLButtonElement).click()
  await expect
    .poll(() => f.m.q('model-picker-panel').textContent)
    .toContain('Connections could not be read.')
  expect(f.m.q('model-picker-panel').textContent).not.toContain('fictional-private-metadata-detail')
  expect(f.modelList).not.toHaveBeenCalled()
})

it('a parent rerender with the same provider values preserves the unsaved route and model', async () => {
  const f = fixture()
  await open(f.m)
  await chooseModel(f.m)
  const reads = f.metadata.mock.calls.length
  expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(false)
  f.props.providers = [...f.props.providers]
  await nextTick()
  await new Promise((done) => setTimeout(done, 20))
  expect(f.metadata).toHaveBeenCalledTimes(reads)
  expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(false)
  expect(f.m.q('model-picker-row').querySelector('input')?.checked).toBe(true)
})

it('unmounting during a metadata refresh cannot launch a catalogue read', async () => {
  const pending = deferred<ProviderConnection[]>()
  let reads = 0
  const f = fixture({
    read: () =>
      ++reads === 1
        ? Promise.resolve([connection('claude', 'sign-in'), connection('codex', 'sign-in')])
        : pending.promise,
  })
  await expect
    .poll(() => f.m.q('model-picker-face').textContent)
    .toContain('Fictional subscription')
  f.m.q('model-picker-face').click()
  await expect.poll(() => reads).toBe(2)
  f.m.unmount()
  pending.resolve([connection('claude', 'sign-in'), connection('codex', 'sign-in')])
  await new Promise((done) => setTimeout(done, 30))
  expect(f.modelList).not.toHaveBeenCalled()
})

it('an obsolete metadata refresh cannot read an old route in a new profile', async () => {
  const old = deferred<ProviderConnection[]>()
  const current = deferred<ProviderConnection[]>()
  let reads = 0
  const f = fixture({
    read: () =>
      ++reads === 1
        ? Promise.resolve([connection('claude', 'sign-in')])
        : reads === 2
          ? old.promise
          : current.promise,
  })
  await expect
    .poll(() => f.m.q('model-picker-face').textContent)
    .toContain('Fictional subscription')
  f.m.q('model-picker-face').click()
  await expect.poll(() => reads).toBe(2)
  f.props.providers = ['codex']
  f.props.preferredProvider = 'codex'
  f.props.profileId = 'willow'
  await expect.poll(() => reads).toBe(3)
  old.resolve([connection('claude', 'sign-in')])
  await new Promise((done) => setTimeout(done, 30))
  expect(f.modelList).not.toHaveBeenCalled()
  current.resolve([connection('codex', 'sign-in')])
  await expect.poll(() => f.modelList.mock.calls.length).toBe(1)
  expect(f.modelList).toHaveBeenCalledExactlyOnceWith({
    provider: 'codex',
    profileId: 'willow',
    connectionId: 'codex:sign-in',
  })
})

it('a locked legacy NULL conversation keeps catalogue and Take payloads dynamic', async () => {
  const f = fixture({
    locked: true,
    shown: {
      provider: 'claude',
      model: 'model-claude:legacy',
      effort: 'medium',
    },
  })
  const control = await open(f.m)
  expect(control.disabled).toBe(true)
  await expect.poll(() => f.modelList.mock.calls.length).toBe(1)
  expect(f.modelList).toHaveBeenCalledExactlyOnceWith({ provider: 'claude' })
  await chooseModel(f.m)
  f.m.q('model-picker-take').click()
  await expect.poll(() => f.take.mock.calls.length).toBe(1)
  expect(f.take).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    model: 'model-claude:legacy',
    effort: 'medium',
  })
})

for (const switched of [false, true]) {
  it(`deleting a model ${switched ? 'after switching connection clears another route’s fallback' : 'on the original connection retains its own fallback'}`, async () => {
    const f = fixture({
      personal: true,
      rows: [connection('claude', 'sign-in'), connection('claude', 'api-key')],
      shown: {
        provider: 'claude',
        connectionId: 'claude:sign-in',
        model: 'model-claude:sign-in',
        effort: 'medium',
      },
    })
    await open(f.m)
    if (switched) await select(f.m, 'claude:api-key')
    await expect.poll(() => f.m.all('model-picker-row').length).toBe(2)
    const personal = f.m
      .all('model-picker-row')
      .find((row) => row.dataset.model === 'fictional-personal')!
    personal.querySelector('input')!.click()
    await nextTick()
    expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(false)
    personal.querySelector<HTMLButtonElement>('[data-cy="model-picker-delete"]')!.click()
    await expect.poll(() => f.m.all('model-picker-delete').length).toBe(0)
    expect(f.remove).toHaveBeenCalledExactlyOnceWith({
      provider: 'claude',
      model: 'fictional-personal',
    })
    expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(switched)
    expect(f.take).not.toHaveBeenCalled()
    const chosen = switched ? 'claude:api-key' : 'claude:sign-in'
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([`model-${chosen}`])
    await chooseModel(f.m)
    f.m.q('model-picker-take').click()
    await expect.poll(() => f.take.mock.calls.length).toBe(1)
    expect(f.take).toHaveBeenCalledExactlyOnceWith({
      provider: 'claude',
      connectionId: chosen,
      model: `model-${chosen}`,
      effort: 'medium',
    })
  })
}


it('connection-led polish: every picker hides supplied prose and model descriptions', async () => {
  const f = fixture()
  Reflect.set(f.props, 'note', 'Fictional explanatory paragraph that must stay out of the picker.')
  Reflect.set(f.props, 'reaches', () => 'Fictional save explanation that must stay out of the picker.')
  await open(f.m)
  await chooseModel(f.m)
  expect(f.m.host.querySelector('[data-cy="model-picker-note"]')).toBeNull()
  expect(f.m.host.querySelector('[data-cy="model-picker-reaches"]')).toBeNull()
  expect(f.m.host.querySelector('.description')).toBeNull()
  expect(f.m.q('model-picker-take')).toBeDefined()
})
