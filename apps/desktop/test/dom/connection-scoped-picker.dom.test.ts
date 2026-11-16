import { expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type {
  ProviderLaunchChoices,
  ProviderModelReadInput,
} from '../../src/shared/provider-launch'
import { createModelLists, type PickedModel } from '../../src/renderer/src/lib/model-lists'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import { mount, type Mounted } from './harness'
import { providerLaunchFixture, settleProviderLaunch as settle } from './provider-launch.fixture'

providerLaunchFixture()

const idOf = (provider: Provider, endpoint: 'a' | 'b') =>
  `fictional-${provider}-endpoint-${endpoint}`
const modelOf = (provider: Provider, endpoint: string) => `${provider}-${endpoint}-model`

function connections(provider: Provider): ProviderConnection[] {
  return (['a', 'b'] as const).map<ProviderConnection>((endpoint) => ({
    id: idOf(provider, endpoint),
    provider,
    name: endpoint === 'a' ? 'First endpoint' : 'Second endpoint',
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }))
}

function answer(provider: Provider, connectionId?: string, ready = true): ProviderLaunchChoices {
  if (connectionId !== undefined && !connections(provider).some((row) => row.id === connectionId))
    throw new Error('Fictional provider and connection mismatch')
  const endpoint =
    connectionId === idOf(provider, 'a')
      ? 'a'
      : connectionId === idOf(provider, 'b')
        ? 'b'
        : 'legacy'
  const model = modelOf(provider, endpoint)
  const pair = { model, effort: `${endpoint}-low` }
  return {
    list: {
      provider,
      notAsked: null,
      standIn: null,
      lastPicked: null,
      startsOn: { ...pair, from: 'the-providers-default' },
      models: [
        {
          id: model,
          label: model,
          addedBy: 'the-provider',
          isDefault: true,
          efforts: ['low', 'high'].map((level) => ({ id: `${endpoint}-${level}`, label: level })),
          defaultEffort: `${endpoint}-low`,
        },
      ],
    },
    ready,
    connections: connections(provider),
    defaultConnectionId: connectionId ?? idOf(provider, 'a'),
    defaultModel: pair,
    defaultModelToSend: null,
  }
}

function pending() {
  let resolve!: (result: ProviderLaunchChoices) => void
  const promise = new Promise<ProviderLaunchChoices>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

async function fixture(
  provider: Provider,
  options: {
    descriptions?: boolean
    a?: ReturnType<typeof pending>
    b?: ReturnType<typeof pending>
    pinned?: boolean
    pinnedId?: string
    noShown?: boolean
    defaultId?: string
    rename?: boolean
    providers?: readonly Provider[]
    beforeResolve?: () => Promise<void>
    nextProfile?: ReturnType<typeof pending>
    profileId?: string
  } = {},
) {
  const providers = options.providers ?? [provider]
  const read = vi.fn(async (input: ProviderModelReadInput) => {
    if (
      input.profileId === 'fern' &&
      input.connectionId === idOf(provider, 'a') &&
      options.nextProfile
    )
      return options.nextProfile.promise
    if (input.connectionId === idOf(provider, 'a') && options.a) return options.a.promise
    if (input.connectionId === idOf(provider, 'b') && options.b) return options.b.promise
    const base = answer(input.provider, input.connectionId)
    const first = base.list.models[0]!
    const result = options.descriptions
      ? {
          ...base,
          list: {
            ...base.list,
            models: [
              { ...first, description: 'First fictional model description.' },
              {
                ...first,
                id: first.id + '-other',
                isDefault: undefined,
                description: 'Other fictional model description.',
              },
            ],
          },
        }
      : base
    if (options.rename && input.connectionId === idOf(provider, 'a')) {
      return {
        ...result,
        connections: result.connections?.map((row) =>
          row.id === input.connectionId ? { ...row, name: 'Renamed endpoint' } : row,
        ),
      }
    }
    return input.connectionId === undefined && options.defaultId
      ? { ...result, defaultConnectionId: options.defaultId }
      : result
  })
  const lists = createModelLists(() => ({
    providerLaunchChoices: read,
    resolveProviderLaunch: async (input) => {
      await options.beforeResolve?.()
      return {
        provider: input.askedProvider ?? provider,
        pickerProvider: input.askedProvider ?? provider,
        connectionId:
          input.askedConnectionId ??
          options.defaultId ??
          idOf(input.askedProvider ?? provider, 'a'),
        readiness: input.providers.map(({ provider: p }) => ({ provider: p, ready: true })),
      }
    },
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
  }))
  await Promise.all(providers.map((p) => lists.read(p)))
  const take = vi.fn<(pick: PickedModel) => Promise<null>>(async () => null)
  const state = reactive({
    providers,
    lists,
    take,
    takeWords: 'Use this model',
    chooseConnection: options.pinned !== true,
    connectionId: options.pinnedId,
    profileId: options.profileId,
    shown: options.noShown
      ? null
      : {
          provider,
          connectionId: idOf(provider, 'a'),
          model: modelOf(provider, 'a'),
          effort: 'a-high',
        },
  })
  const m = mount(defineComponent({ setup: () => () => h(ModelPicker, state) }), {})
  await settle()
  return {
    m,
    read,
    take,
    lists,
    setReadProfile: (id: string) => {
      state.profileId = id
    },
    setReadConnection: (id: string) => {
      state.connectionId = id
    },
  }
}

async function open(m: Mounted) {
  m.q('model-picker-face').click()
  await settle()
}

function select(m: Mounted, connectionId: string) {
  const row = m
    .all('model-picker-connection')
    .find((one) => one.dataset.connection === connectionId)
  expect(row).toBeDefined()
  row!.querySelector<HTMLInputElement>('input')!.click()
}

async function takeB(f: Awaited<ReturnType<typeof fixture>>, provider: Provider, routed: boolean) {
  expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
    modelOf(provider, 'b'),
  ])
  f.m.q('model-picker-take').click()
  await settle()
  expect(f.take).toHaveBeenCalledExactlyOnceWith({
    provider,
    ...(routed ? { connectionId: idOf(provider, 'b') } : {}),
    model: modelOf(provider, 'b'),
    effort: 'b-low',
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a connection switch waits for its own rows and effort before Take`, async () => {
    const b = pending()
    const f = await fixture(provider, { b })
    try {
      await open(f.m)
      select(f.m, idOf(provider, 'b'))
      await settle()
      expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
      f.m.q('model-picker-take').click()
      expect(f.take).not.toHaveBeenCalled()
    } finally {
      b.resolve(answer(provider, idOf(provider, 'b'), false))
      await settle()
    }
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'b'),
    ])
    await takeB(f, provider, true)
  })

  it(`${provider}: a late old model read cannot replace a newer selected connection`, async () => {
    const a = pending()
    const f = await fixture(provider, { a })
    try {
      await open(f.m)
      expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
      expect(f.m.all('model-picker-row')).toHaveLength(0)
      select(f.m, idOf(provider, 'b'))
      await settle()
    } finally {
      a.resolve(answer(provider, idOf(provider, 'a')))
      await settle()
    }
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'b'),
    ])
    await takeB(f, provider, true)
  })

  it(`${provider}: a pinned reader with no model uses its immutable connection and emits no route change`, async () => {
    const f = await fixture(provider, {
      pinned: true,
      pinnedId: idOf(provider, 'b'),
      noShown: true,
    })
    await open(f.m)
    expect(f.m.all('model-picker-connection')).toHaveLength(0)
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'b'),
    ])
    expect(f.read.mock.calls.some(([input]) => input.connectionId === idOf(provider, 'b'))).toBe(
      true,
    )
    expect(f.read.mock.calls.some(([input]) => input.connectionId === idOf(provider, 'a'))).toBe(
      false,
    )
    f.m.all('model-picker-row')[0]!.querySelector<HTMLInputElement>('input')!.click()
    await settle()
    await takeB(f, provider, false)
  })

  it(`${provider}: changing a pinned read route clears Take before deferred resolution`, async () => {
    let waiting = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = await fixture(provider, {
      pinned: true,
      pinnedId: idOf(provider, 'a'),
      beforeResolve: async () => {
        if (waiting) await gate
      },
    })
    await open(f.m)
    expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(false)
    waiting = true
    f.setReadConnection(idOf(provider, 'b'))
    try {
      await settle()
      expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
      f.m.q('model-picker-take').click()
      expect(f.take).not.toHaveBeenCalled()
    } finally {
      release()
      await settle()
    }
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'b'),
    ])
    await takeB(f, provider, false)
  })

  it(`${provider}: a profile change invalidates a manual draft even when the new profile's old route is warm`, async () => {
    const nextProfile = pending()
    const f = await fixture(provider, { nextProfile })
    await open(f.m)
    select(f.m, idOf(provider, 'b'))
    await settle()
    expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(false)
    await f.lists.read(provider, 'fern', { connectionId: idOf(provider, 'b') })
    f.setReadProfile('fern')
    try {
      await settle()
      expect((f.m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
      expect(f.read).toHaveBeenCalledWith({
        provider,
        profileId: 'fern',
        connectionId: idOf(provider, 'a'),
      })
      f.m.q('model-picker-take').click()
      expect(f.take).not.toHaveBeenCalled()
    } finally {
      nextProfile.resolve(answer(provider, idOf(provider, 'a')))
      await settle()
    }
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'a'),
    ])
    f.m.q('model-picker-take').click()
    await settle()
    expect(f.take).toHaveBeenCalledExactlyOnceWith({
      provider,
      connectionId: idOf(provider, 'a'),
      model: modelOf(provider, 'a'),
      effort: 'a-high',
    })
  })

  it(`${provider}: pinned legacy NULL ignores an advertised new default and keeps the old payload`, async () => {
    const f = await fixture(provider, {
      pinned: true,
      noShown: true,
      defaultId: idOf(provider, 'b'),
    })
    await open(f.m)
    expect(f.m.all('model-picker-connection')).toHaveLength(0)
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'legacy'),
    ])
    expect(f.read.mock.calls.every(([input]) => input.connectionId === undefined)).toBe(true)
    f.m.all('model-picker-row')[0]!.querySelector<HTMLInputElement>('input')!.click()
    await settle()
    f.m.q('model-picker-take').click()
    await settle()
    expect(f.take).toHaveBeenCalledExactlyOnceWith({
      provider,
      model: modelOf(provider, 'legacy'),
      effort: 'legacy-low',
    })
  })

  it(`${provider}: the closed face uses the current metadata of its stored connection`, async () => {
    const f = await fixture(provider, { rename: true })
    expect(f.m.q('model-picker-face').textContent).toContain('Renamed endpoint')
    expect(f.read).toHaveBeenCalledWith({ provider, connectionId: idOf(provider, 'a') })
  })
}

it('a provider switch carries only its own connection while an old provider read is pending', async () => {
  const a = pending()
  const f = await fixture('claude', { a, providers: ['claude', 'codex'] })
  try {
    await open(f.m)
    f.m.q('model-picker-choose-codex').click()
    await settle()
    select(f.m, idOf('codex', 'b'))
    await settle()
  } finally {
    a.resolve(answer('claude', idOf('claude', 'a')))
    await settle()
  }
  f.m.q('model-picker-take').click()
  await settle()
  expect(f.take).toHaveBeenCalledExactlyOnceWith({
    provider: 'codex',
    connectionId: idOf('codex', 'b'),
    model: modelOf('codex', 'b'),
    effort: 'b-low',
  })
  expect(
    f.read.mock.calls.every(
      ([input]) =>
        input.connectionId === undefined ||
        connections(input.provider).some((row) => row.id === input.connectionId),
    ),
  ).toBe(true)
})

it('v4 new picker places provider before its two local connections', async () => {
  const f = await fixture('claude', { providers: ['claude', 'codex'] })
  await open(f.m)
  expect(f.m.all('model-picker-providers')).toHaveLength(1)
  expect(f.m.all('model-picker-connection')).toHaveLength(2)
  const providers = f.m.q('model-picker-providers')
  const codex = [...providers.querySelectorAll('label')].find((row) =>
    row.textContent?.includes('Codex'),
  )!
  codex.querySelector<HTMLInputElement>('input')!.click()
  await settle()
  const connections = f.m.all('model-picker-connection')
  expect(connections).toHaveLength(2)
  expect(connections.every((row) => row.dataset.connection?.includes('codex'))).toBe(true)
})

it('v4 model descriptions follow only the selected radio', async () => {
  const f = await fixture('claude', { descriptions: true })
  await open(f.m)
  const rows = f.m.all('model-picker-row')
  expect(rows).toHaveLength(2)
  expect(f.m.host.querySelectorAll('.description')).toHaveLength(1)
  expect(f.m.host.querySelector('.description')?.textContent).toContain('First fictional')
  rows[1]!.querySelector<HTMLInputElement>('input')!.click()
  await settle()
  expect(f.m.host.querySelectorAll('.description')).toHaveLength(1)
  expect(f.m.host.querySelector('.description')?.textContent).toContain('Other fictional')
})
