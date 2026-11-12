import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive } from 'vue'
import { providerDescriptor } from '@brobot2/shared'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import type { ApiKeyStatus, ProviderVersion } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import type { ModelList } from '../../src/shared/model-choice-contracts'
import { modelListsForClient } from '../../src/renderer/src/client-provider/model-lists'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})
function card(models: ModelList['models'] = []) {
  const descriptor = {
    ...providerDescriptor('claude'),
    displayName: 'Fern',
    credential: 'profile-or-key' as const,
  }
  const empty: ApiKeyStatus = { provider: 'claude', set: false, setAt: null, inUse: false }
  const saved = { ...empty, set: true, inUse: true }
  let stored = empty
  const list = {
    provider: 'claude' as const,
    models,
    notAsked: null,
    standIn: null,
    startsOn: null,
    lastPicked: null,
  }
  const api: ClientProviderApi = {
    providerCatalogue: async () => [descriptor],
    providerSetup: async () => ({ claude: null, codex: null }),
    providerUsage: async () => ({ claude: [], codex: [] }),
    providerConnections: async () => [],
    providerVersions: async () => {
      throw new Error('No version read expected by this card')
    },
    providerResources: async () => {
      throw new Error('No resource read expected by this card')
    },
    providerLaunchChoices: async () => ({
      list,
      ready: true,
      defaultModel: null,
      defaultModelToSend: null,
    }),
    resolveProviderLaunch: async () => ({
      provider: 'claude',
      pickerProvider: 'claude',
      readiness: [],
    }),
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
    checkProviderAuth: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
    apiKeyStatus: async () => stored,
    setApiKey: vi.fn<ClientProviderApi['setApiKey']>(async () => saved),
    removeApiKey: vi.fn<ClientProviderApi['removeApiKey']>(async () => empty),
    checkApiKey: vi.fn<ClientProviderApi['checkApiKey']>(async () => ({
      ok: false,
      reason: 'Fern supplied refusal.',
    })),
    reprovisionProviderAuth: vi.fn<ClientProviderApi['reprovisionProviderAuth']>(
      async () => 'replaced',
    ),
    reprovisionProviderHomes: vi.fn<ClientProviderApi['reprovisionProviderHomes']>(async () => ({
      replaced: 1,
      pending: 0,
      skipped: 0,
      failed: 0,
      profiles: [{ profileId: 'fern', state: 'replaced' }],
    })),
    signInProvider: async () => ({
      success: false,
      state: { state: 'unknown', reason: 'Not requested.' },
    }),
    cancelProviderSignIn: async () => {},
    onProvidersChanged: () => () => {},
    setup: undefined,
  }
  const forbidden = vi.fn(() => {
    throw new Error('ProviderCard reached the global operation')
  })
  Reflect.set(window, 'api', {
    runtime: {
      providerConnections: async () => [],
      setApiKey: forbidden,
      removeApiKey: forbidden,
      checkApiKey: forbidden,
      reprovisionProviderAuth: forbidden,
      reprovisionProviderHomes: forbidden,
    },
  })
  const version: ProviderVersion = {
    version: 'fictional',
    program: {
      standing: 'tested',
      from: 'native-installer',
      installerLabel: 'Fern’s supplied installer',
      path: '/fictional/fern',
      version: 'fictional',
      tested: null,
      said: 'Opaque program observation.',
      help: null,
      update: null,
      others: [],
      updatedFrom: null,
    },
  }
  const props = reactive({
    provider: 'claude' as const,
    descriptor,
    capabilities: null,
    limit: null,
    limitsRead: true,
    clock: Date.now(),
    version,
    readings: [],
    resources: null,
    resourcesPaused: false,
    resourcesError: null,
    loginMoved: 0,
  })
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(ProviderCard, props)
      },
    }),
    {},
    { width: 760, height: 1400 },
  )
  return {
    api,
    list,
    props,
    m,
    forbidden,
    saved,
    store: (value: ApiKeyStatus) => {
      stored = value
    },
  }
}
it('uses injected key operations, clears the draft before completion and keeps supplied refusal words', async () => {
  const out = card()
  await settle()
  let finish!: (value: ApiKeyStatus) => void
  vi.mocked(out.api.setApiKey).mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done
      }),
  )
  const field = out.m.q('provider-key-input') as HTMLInputElement
  field.value = 'fictional-key'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  field.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await nextTick()
  expect(field.value).toBe('')
  expect(field.disabled).toBe(true)
  expect(out.api.setApiKey).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    key: 'fictional-key',
  })
  out.store(out.saved)
  finish(out.saved)
  await settle()
  out.m.q('provider-key-check').click()
  await settle()
  expect(out.api.checkApiKey).toHaveBeenCalledExactlyOnceWith({ provider: 'claude' })
  expect(out.m.q('provider-key-said').textContent).toBe('Fern supplied refusal.')
  out.m.q('provider-key-remove').click()
  await settle()
  expect(out.api.removeApiKey).toHaveBeenCalledExactlyOnceWith({ provider: 'claude' })
  expect(out.m.all('provider-key-input')).toHaveLength(1)
  expect(out.forbidden).not.toHaveBeenCalled()
})
it('renders supplied installer words and preserves an older observation without guessing its owner', async () => {
  const { m, props } = card()
  await settle()
  expect(m.q('provider-version').textContent).toContain('Fern’s supplied installer')
  expect(m.q('provider-version').textContent).not.toContain('Anthropic')
  if (!props.version.program) throw new Error('Fixture requires a program')
  props.version = {
    ...props.version,
    program: { ...props.version.program, installerLabel: undefined },
  }
  await nextTick()
  expect(m.q('provider-version').textContent).toContain('native-installer')
  expect(m.q('provider-version').textContent).not.toContain('Anthropic')
})
it('copies all profiles through the injected operation and retains its result', async () => {
  const { m, api, forbidden } = card()
  await settle()
  expect(api.reprovisionProviderHomes).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    statusOnly: true,
  })
  vi.mocked(api.reprovisionProviderHomes).mockClear()
  m.q('copy-all-sign-ins').querySelector('button')!.click()
  await settle()
  expect(api.reprovisionProviderHomes).toHaveBeenCalledExactlyOnceWith({ provider: 'claude' })
  expect(m.q('copy-all-sign-ins').textContent).toContain('1 switched now, 0 will switch')
  expect(forbidden).not.toHaveBeenCalled()
})

it('one refreshed provider catalogue feeds the drawer, the agent picker and the taken launch aliases', async () => {
  const rows = (current: boolean): ModelList['models'] => [
    {
      id: 'default',
      label: 'Default (recommended)',
      resolvesTo: current ? 'claude-opus-5-5' : 'claude-sonnet-5-5',
      isDefault: true,
      addedBy: 'the-provider',
    },
    {
      id: 'fable',
      label: current ? 'Fable 5.2' : 'Fable',
      resolvesTo: current ? 'claude-fable-5-2' : 'claude-fable-5-1',
      addedBy: 'the-provider',
    },
  ]
  const out = card(rows(false))
  const lists = modelListsForClient(out.api)
  await lists.read('claude', 'fern')
  const take = vi.fn(async () => null)
  const picker = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, out.api)
        return () =>
          h(ModelPicker, {
            providers: ['claude'],
            profileId: 'fern',
            shown: { provider: 'claude', model: 'default', effort: null },
            takeWords: 'Switch from your next message',
            take,
            lists,
            readiness: { claude: true },
          })
      },
    }),
    {},
    { width: 760, height: 900 },
  )
  await settle()
  ;(picker.q('model-picker-face') as HTMLElement).click()
  await settle()
  out.list.models = rows(true)
  lists.forget(DEFAULT_PROFILE_ID)
  await lists.read('claude')
  await settle()
  const drawerRows = out.m.all('provider-model-row')
  const pickerRows = picker.all('model-picker-row')
  expect(drawerRows).toHaveLength(2)
  expect(pickerRows).toHaveLength(2)
  for (const [index, row] of rows(true).entries()) {
    for (const drawn of [drawerRows[index]!, pickerRows[index]!]) {
      expect(drawn.getAttribute('data-model')).toBe(row.id)
      expect(drawn.textContent).toContain(row.label)
      expect(drawn.textContent).toContain(row.resolvesTo)
    }
  }
  for (const row of rows(true)) {
    if (picker.q('model-picker-face').getAttribute('aria-expanded') !== 'true') {
      ;(picker.q('model-picker-face') as HTMLElement).click()
      await settle()
    }
    const input = picker.host.querySelector<HTMLInputElement>(`input[value="claude:${row.id}"]`)!
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    ;(picker.q('model-picker-take') as HTMLButtonElement).click()
    await settle()
    expect(take).toHaveBeenLastCalledWith({ provider: 'claude', model: row.id, effort: null })
  }
})
