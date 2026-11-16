import { expect, it, vi } from 'vitest'
import { defineComponent, h, provide } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import type { ProviderLaunchChoices } from '../../src/shared/provider-launch'
import type {
  SessionSettingsDisclosure,
  WhatAPickBecame,
} from '../../src/shared/model-choice-contracts'
import { theList } from '../../src/shared/model-choice'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { createModelLists, type PickedModel } from '../../src/renderer/src/lib/model-lists'
import { useConversationModelPick } from '../../src/renderer/src/composables/useConversationModelPick'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import { META, mount } from './harness'
import { providerLaunchFixture, settleProviderLaunch as settle } from './provider-launch.fixture'

providerLaunchFixture()
const idOf = (provider: Provider, endpoint: 'a' | 'b') =>
  `fictional-${provider}-endpoint-${endpoint}`
const modelOf = (provider: Provider, endpoint: string) => `fictional-${provider}-${endpoint}-model`

async function fixture(
  provider: Provider,
  connectionId?: string,
  fixed = false,
  nextConnection?: SessionSettingsDisclosure['nextConnection'],
  currentPendingEffort?: string,
) {
  const local = createDesktopProviderApi(
    () => window.api.runtime,
    () => undefined,
  )
  const read = vi.fn<ClientProviderApi['providerLaunchChoices']>(
    async (input): Promise<ProviderLaunchChoices> => {
      expect(input.provider).toBe(provider)
      const endpoint =
        input.connectionId === idOf(provider, 'a')
          ? 'a'
          : input.connectionId === idOf(provider, 'b')
            ? 'b'
            : 'legacy'
      const model = modelOf(provider, endpoint)
      return {
        list: {
          provider,
          notAsked: null,
          standIn: null,
          lastPicked: null,
          startsOn: { model, effort: 'low', from: 'the-providers-default' },
          models: theList(
            [
              {
                id: model,
                label: model,
                efforts: [
                  { id: 'low', label: 'low' },
                  ...(currentPendingEffort === undefined ? [] : [{ id: 'high', label: 'high' }]),
                ],
                defaultEffort: 'low',
              },
            ],
            [],
          ),
        },
        ready: true,
        defaultConnectionId: input.connectionId ?? idOf(provider, 'b'),
        defaultModel: { model, effort: 'low' },
        defaultModelToSend: null,
        connections: (['a', 'b'] as const).map<ProviderConnection>((endpoint) => ({
          provider,
          id: idOf(provider, endpoint),
          name: `Fictional endpoint ${endpoint}`,
          authMethod: 'sign-in',
          credentialSource: 'provider-sign-in',
          baseUrl: null,
          enabled: true,
          contractVersion: 1,
        })),
      }
    },
  )
  const api = {
    ...local,
    providerLaunchChoices: read,
    resolveProviderLaunch: async (input: Parameters<typeof local.resolveProviderLaunch>[0]) => ({
      provider,
      pickerProvider: provider,
      connectionId: input.askedConnectionId ?? idOf(provider, 'b'),
      readiness: [{ provider, ready: true }],
    }),
  }
  const lists = createModelLists(() => api)
  await lists.read(provider, 'fern')
  const meta = {
    ...META,
    provider,
    profileId: 'fern',
    settingsFixed: fixed,
    settings: {
      ...META.settings,
      model: null,
      reasoningEffort: null,
      ...(nextConnection === undefined ? {} : { nextConnection }),
      ...(currentPendingEffort === undefined
        ? {}
        : { pendingReasoningEffort: { value: currentPendingEffort } }),
    },
    ...(connectionId === undefined ? {} : { connectionId }),
  }
  const take = vi.fn<(pick: PickedModel) => Promise<WhatAPickBecame>>(async () => ({
    itsAgentsDefault: true,
    theLastPick: true,
  }))
  const frame = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, api)
      const picked = useConversationModelPick({
        session: () => meta,
        providerName: (provider) => provider,
        pickModel: () => take,
        capabilities: () => null,
      })
      return () =>
        picked.picker.value === null ? null : h(ModelPicker, { ...picked.picker.value, lists })
    },
  })
  const m = mount(frame, {})
  await settle()
  m.q('model-picker-face').click()
  await settle()
  return { m, read, take }
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: the real conversation picker carries stored A with no model and never follows fresh default B`, async () => {
    const f = await fixture(provider, idOf(provider, 'a'))
    expect(f.read).toHaveBeenCalledWith({
      provider,
      profileId: 'fern',
      connectionId: idOf(provider, 'a'),
    })
    expect(f.read.mock.calls.every(([input]) => input.connectionId !== idOf(provider, 'b'))).toBe(
      true,
    )
    expect(f.m.all('model-picker-connection')).toHaveLength(2)
    expect(
      f.m
        .all('model-picker-connection')
        .find((row) => row.querySelector<HTMLInputElement>('input')!.checked)?.dataset.connection,
    ).toBe(idOf(provider, 'a'))
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'a'),
    ])
    f.m.all('model-picker-row')[0]!.querySelector<HTMLInputElement>('input')!.click()
    await settle()
    f.m.q('model-picker-take').click()
    await settle()
    expect(f.take).toHaveBeenCalledExactlyOnceWith({
      provider,
      connectionId: idOf(provider, 'a'),
      model: modelOf(provider, 'a'),
      effort: 'low',
    })
  })
  it(`${provider}: an opaque recorded ID is shown without borrowing a known connection`, async () => {
    const id = `fictional-${provider}-opaque`
    const f = await fixture(provider, id)
    expect(f.m.all('model-picker-connection')).toHaveLength(2)
    expect(f.m.q('model-picker-recorded-connection').textContent).toContain(id)
    expect(f.m.q('model-picker-recorded-connection').textContent).not.toContain(
      'Fictional endpoint',
    )
    expect(f.read.mock.calls.every(([input]) => input.connectionId !== idOf(provider, 'b'))).toBe(
      true,
    )
    expect(f.take).not.toHaveBeenCalled()
  })
  it(`${provider}: a legacy NULL conversation still omits identity and ignores the fresh default B`, async () => {
    const f = await fixture(provider)
    expect(f.read.mock.calls.every(([input]) => input.connectionId === undefined)).toBe(true)
    expect(f.m.all('model-picker-connection')).toHaveLength(2)
    expect(f.m.q('model-picker-recorded-connection').textContent).toContain(
      'Connection not recorded',
    )
    expect(f.m.q('model-picker-recorded-connection').textContent).not.toContain('endpoint b')
    expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'legacy'),
    ])
    f.m.all('model-picker-row')[0]!.querySelector<HTMLInputElement>('input')!.click()
    await settle()
    f.m.q('model-picker-take').click()
    await settle()
    expect(f.take).toHaveBeenCalledExactlyOnceWith({
      provider,
      model: modelOf(provider, 'legacy'),
      effort: 'low',
    })
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`v4 ${provider}: a fixed recorded view can choose a connection for its next message`, async () => {
    const f = await fixture(provider, idOf(provider, 'a'), true)
    expect(f.m.all('model-picker-providers')).toHaveLength(0)
    expect(f.m.all('model-picker-connection')).toHaveLength(2)
    const other = f.m
      .all('model-picker-connection')
      .find((row) => row.dataset.connection === idOf(provider, 'b'))!
    other.querySelector<HTMLInputElement>('input')!.click()
    await settle()
    expect(f.read).toHaveBeenLastCalledWith({
      provider,
      profileId: 'fern',
      connectionId: idOf(provider, 'b'),
    })
    const take = f.m.q('model-picker-take') as HTMLButtonElement
    expect(take.disabled, f.m.q('model-picker-panel').innerHTML).toBe(false)
    take.click()
    await settle()
    expect(f.take).toHaveBeenCalledExactlyOnceWith({
      provider,
      connectionId: idOf(provider, 'b'),
      model: modelOf(provider, 'b'),
      effort: 'low',
    })
    f.m.q('model-picker-face').click()
    await settle()
    expect(f.m.q('model-picker-panel')).not.toBeNull()
  })
}

for (const provider of ['claude', 'codex'] as const) {
  for (const currentPendingEffort of [undefined, 'high'] as const) {
    it(`v4 ${provider}: reopening keeps the NEXT tuple with CURRENT pending ${currentPendingEffort ?? 'none'}`, async () => {
      const f = await fixture(
        provider,
        idOf(provider, 'a'),
        true,
        {
          connectionId: idOf(provider, 'b'),
          model: modelOf(provider, 'b'),
          effort: 'low',
        },
        currentPendingEffort,
      )
      const checked = f.m
        .all('model-picker-connection')
        .find((row) => row.querySelector<HTMLInputElement>('input')!.checked)
      expect(checked?.dataset.connection).toBe(idOf(provider, 'b'))
      expect(f.m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
        modelOf(provider, 'b'),
      ])
      const selected = f.m
        .all('model-picker-effort')
        .find((row) => row.querySelector<HTMLInputElement>('input')!.checked)
      expect(selected?.textContent).toContain('low')
      f.m.q('model-picker-take').click()
      await settle()
      expect(f.take).toHaveBeenCalledExactlyOnceWith({
        provider,
        connectionId: idOf(provider, 'b'),
        model: modelOf(provider, 'b'),
        effort: 'low',
      })
    })
  }
}
