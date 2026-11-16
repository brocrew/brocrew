import { expect, it, vi } from 'vitest'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type {
  ResolveProviderLaunchInput,
  ResolvedProviderLaunch,
} from '../../src/shared/provider-launch'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { mount } from './harness'
import { providerLaunchFixture, settleProviderLaunch as settle } from './provider-launch.fixture'

providerLaunchFixture()

function connections(provider: Provider) {
  return (['sign-in', 'api-key'] as const).map<ProviderConnection & { description: string }>(
    (method) => ({
      id: `${provider}:${method}`,
      provider,
      name: method === 'sign-in' ? 'Fictional account' : 'Fictional key',
      description: method === 'sign-in' ? 'Writing and research' : 'Metered experiments',
      authMethod: method,
      credentialSource: method === 'sign-in' ? 'provider-sign-in' : 'provider-api-key',
      baseUrl: null,
      enabled: true,
      contractVersion: 1,
    }),
  )
}

async function picker(
  ready = true,
  chooseConnection = true,
  providers: readonly Provider[] = ['claude', 'codex'],
  options: {
    metadata?: boolean
    shownConnectionId?: string
    resolve?: (input: ResolveProviderLaunchInput) => Promise<ResolvedProviderLaunch>
  } = {},
) {
  const lists = createModelLists(() => ({
    providerLaunchChoices: async ({ provider }) => ({
      list: {
        provider,
        notAsked: null,
        standIn: null,
        startsOn: null,
        lastPicked: null,
        models: [
          { id: 'fictional-small', label: 'Fictional small', efforts: [], addedBy: 'the-provider' },
        ],
      },
      ready,
      ...(options.metadata === false
        ? {}
        : { connections: connections(provider), defaultConnectionId: `${provider}:sign-in` }),
      defaultModel: { model: 'fictional-small', effort: null },
      defaultModelToSend: { model: 'fictional-small', effort: null },
    }),
    resolveProviderLaunch:
      options.resolve ??
      (async (input) => ({
        provider: input.askedProvider ?? 'claude',
        pickerProvider: input.askedProvider ?? 'claude',
        ...(options.metadata === false
          ? {}
          : {
              connectionId: input.askedConnectionId ?? `${input.askedProvider ?? 'claude'}:sign-in`,
            }),
        readiness: input.providers.map(({ provider }) => ({ provider, ready })),
      })),
    addHandAddedModel: window.api.runtime.addHandAddedModel,
    deleteHandAddedModel: window.api.runtime.deleteHandAddedModel,
  }))
  const take = vi.fn(async () => null)
  const m = mount(ModelPicker, {
    providers,
    chooseConnection,
    shown: {
      provider: 'claude',
      model: 'fictional-small',
      effort: null,
      ...(options.shownConnectionId === undefined
        ? {}
        : { connectionId: options.shownConnectionId }),
    },
    takeWords: 'Start on this',
    take,
    lists,
  })
  m.q('model-picker-face').click()
  await settle()
  return { m, take }
}

it('puts provider first, then only that provider’s connections before model and effort', async () => {
  const { m } = await picker()
  const providerRows = m.q('model-picker-providers').querySelectorAll('label')
  expect([...providerRows].map((row) => row.textContent?.trim())).toEqual(['Claude', 'Codex'])
  expect(m.all('model-picker-connection').map((row) => row.dataset.connection)).toEqual([
    'claude:sign-in',
    'claude:api-key',
  ])
  expect(m.all('model-picker-connection').map((row) => row.textContent?.trim())).toEqual([
    'Fictional account',
    'Fictional key',
  ])
  expect(
    m
      .all('model-picker-connection')
      .every((row) => row.querySelector('input[type="radio"]') !== null),
  ).toBe(true)
  expect(
    [...m.q('model-picker-panel').querySelectorAll('legend,h4')].map((node) =>
      node.textContent?.trim(),
    ),
  ).toEqual(['Provider', 'Connection', 'Model', 'Effort'])
  expect(m.q('model-picker-panel').textContent).not.toMatch(
    /Writing and research|Metered experiments|Not checked/,
  )
  m.q('model-picker-choose-codex').click()
  await settle()
  expect(m.all('model-picker-connection').map((row) => row.dataset.connection)).toEqual([
    'codex:sign-in',
    'codex:api-key',
  ])
})

it('keeps a not-ready connection selectable and sends its ID with the chosen model', async () => {
  const { m, take } = await picker(false)
  const key = m
    .all('model-picker-connection')
    .find((row) => row.dataset.connection === 'claude:api-key')!
  expect(key).toBeDefined()
  expect(key.textContent?.trim()).toBe('Fictional key')
  const radio = key.querySelector<HTMLInputElement>('input[type="radio"]')!
  expect(radio.disabled).toBe(false)
  radio.click()
  await settle()
  m.q('model-picker-take').click()
  await settle()
  expect(take).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    connectionId: 'claude:api-key',
    model: 'fictional-small',
    effort: null,
  })
})

for (const { name, chooseConnection, metadata } of [
  {
    name: 'keeps a current conversation model-only even when launch metadata includes other connections',
    chooseConnection: false,
    metadata: true,
  },
  {
    name: 'omitted connection metadata preserves the legacy emitted shape even for an opted-in host',
    chooseConnection: true,
    metadata: false,
  },
]) {
  it(name, async () => {
    const { m, take } = await picker(true, chooseConnection, ['claude'], { metadata })
    expect(m.all('model-picker-connection')).toHaveLength(0)
    m.q('model-picker-take').click()
    await settle()
    expect(take).toHaveBeenCalledExactlyOnceWith({
      provider: 'claude',
      model: 'fictional-small',
      effort: null,
    })
  })
}

it('switching provider takes only that provider connection', async () => {
  const { m, take } = await picker()
  m.q('model-picker-choose-codex').click()
  await settle()
  const row = m
    .all('model-picker-connection')
    .find((one) => one.dataset.connection === 'codex:api-key')
  expect(row).toBeDefined()
  row!.querySelector<HTMLInputElement>('input')!.click()
  await settle()
  m.q('model-picker-take').click()
  await settle()
  expect(take).toHaveBeenCalledExactlyOnceWith({
    provider: 'codex',
    connectionId: 'codex:api-key',
    model: 'fictional-small',
    effort: null,
  })
})

it('a late resolved default cannot replace a connection the person just selected', async () => {
  let release!: (answer: ResolvedProviderLaunch) => void
  const waiting = new Promise<ResolvedProviderLaunch>((resolve) => {
    release = resolve
  })
  const { m, take } = await picker(true, true, ['claude'], { resolve: () => waiting })
  const row = m
    .all('model-picker-connection')
    .find((one) => one.dataset.connection === 'claude:api-key')
  expect(row).toBeDefined()
  row!.querySelector<HTMLInputElement>('input')!.click()
  await settle()
  release({
    provider: 'claude',
    pickerProvider: 'claude',
    connectionId: 'claude:sign-in',
    readiness: [{ provider: 'claude', ready: true }],
  })
  await settle()
  m.q('model-picker-take').click()
  await settle()
  expect(take).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    connectionId: 'claude:api-key',
    model: 'fictional-small',
    effort: null,
  })
})

it('the picker face names the same stored connection that Take emits', async () => {
  const { m, take } = await picker(true, true, ['claude'], { shownConnectionId: 'claude:api-key' })
  expect(m.q('model-picker-face').textContent).toContain('Claude · Fictional key')
  m.q('model-picker-take').click()
  await settle()
  expect(take).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    connectionId: 'claude:api-key',
    model: 'fictional-small',
    effort: null,
  })
})
