import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive } from 'vue'
import { PROVIDER_DESCRIPTORS, type ProviderDescriptor } from '@brobot2/shared'
import type { Provider, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { useKeyAsked } from '../../src/renderer/src/composables/useKeyAsked'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { useModelLists } from '../../src/renderer/src/composables/useModelLists'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll } from './harness'

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
beforeEach(() => {
  useKeyAsked().value = null
  providersBridge()
})
afterEach(() => {
  unmountAll()
  useKeyAsked().value = null
  Reflect.deleteProperty(window, 'api')
})

type ScreenProps = {
  setupProvider?: Provider | null
  descriptors?: readonly ProviderDescriptor[]
}

function screen(api: ClientProviderApi, props: ScreenProps = {}) {
  return mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () =>
          h(ProvidersScreen, { capabilities: null, warnings: null, clock: Date.now(), ...props })
      },
    }),
    {},
    { width: 1180, height: 900 },
  )
}

function client(): ClientProviderApi {
  return createDesktopProviderApi(
    () => window.api.runtime,
    () => undefined,
  )
}

it('shows loading without native rows until the supplied catalogue answers', async () => {
  let finish!: (value: Awaited<ReturnType<ClientProviderApi['providerCatalogue']>>) => void
  const pending = new Promise<Awaited<ReturnType<ClientProviderApi['providerCatalogue']>>>(
    (resolve) => {
      finish = resolve
    },
  )
  const m = screen({ ...client(), providerCatalogue: () => pending })
  await settle()
  expect(m.all('provider-row')).toHaveLength(0)
  expect(m.q('provider-catalogue-status').textContent).toContain('Reading provider information')
  finish([])
  await settle()
  expect(m.all('provider-row')).toHaveLength(0)
  expect(m.q('provider-catalogue-empty')).toBeDefined()
})

it('loads a fictional catalogue through the injected client before its actual model holder reads', async () => {
  const descriptor = {
    ...PROVIDER_DESCRIPTORS[0],
    id: 'fable',
    displayName: 'Fable',
    debugOnly: false,
  }
  const models = vi.fn<RuntimeBridge['modelList']>(async ({ provider }) => ({
    provider,
    notAsked: null,
    standIn: null,
    models: [{ id: 'fable-one', label: 'Fable One', efforts: [], addedBy: 'the-provider' }],
    lastPicked: null,
    startsOn: { model: 'fable-one', effort: null, from: 'the-providers-default' },
  }))
  const catalogue = vi.fn(async () => [descriptor])
  const api: ClientProviderApi = {
    ...client(),
    providerCatalogue: catalogue,
    providerLaunchChoices: async (input) => ({
      list: await models(input),
      ready: true,
      defaultModel: { model: 'fable-one', effort: null },
      defaultModelToSend: null,
    }),
    checkProviderAuth: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
  }
  const m = screen(api)
  await settle()
  expect(catalogue).toHaveBeenCalledTimes(1)
  expect(m.all('provider-row')).toHaveLength(1)
  expect(m.q('provider-row').getAttribute('data-provider')).toBe('fable')
  expect(m.q('provider-row').textContent).toContain('Fable')
  expect(models).toHaveBeenCalledTimes(1)
  const held = useModelLists(api).held(
    'fable' as Parameters<RuntimeBridge['modelList']>[0]['provider'],
  )
  expect(held).toMatchObject({
    state: 'answered',
    list: { notAsked: null, startsOn: { model: 'fable-one' } },
  })
  m.q('provider-row').click()
  await settle()
  expect(m.q('provider-card').textContent).toContain('Fable One')
  expect(m.q('provider-card').textContent).not.toContain('Reading provider information')
})

it('keeps a supplied empty catalogue empty instead of restoring native rows', async () => {
  const api = { ...client(), providerCatalogue: async () => [] }
  const m = screen(api)
  await settle()
  expect(m.all('provider-row')).toHaveLength(0)
  expect(m.q('provider-catalogue-empty').textContent?.trim()).toBe('No providers are available.')
})

it('shows unread state and retries the same supplied read without native rows', async () => {
  const read = vi
    .fn<ClientProviderApi['providerCatalogue']>()
    .mockRejectedValueOnce(new Error('fictional catalogue offline'))
    .mockResolvedValueOnce([])
  const m = screen({ ...client(), providerCatalogue: read })
  await settle()
  expect(m.all('provider-row')).toHaveLength(0)
  expect(m.q('provider-catalogue-status').textContent).toContain('fictional catalogue offline')
  m.q('provider-catalogue-status').querySelector('button')!.click()
  await settle()
  expect(read).toHaveBeenCalledTimes(2)
  expect(m.all('provider-row')).toHaveLength(0)
  expect(m.q('provider-catalogue-empty')).toBeDefined()
})

const suppliedProviders = PROVIDER_DESCRIPTORS.map((descriptor) => ({
  ...descriptor,
  debugOnly: false,
}))

function deferredCatalogue() {
  let answer!: (providers: readonly ProviderDescriptor[]) => void
  const pending = new Promise<readonly ProviderDescriptor[]>((resolve) => {
    answer = resolve
  })
  return { read: () => pending, answer }
}

it('fulfills a setup request that arrives while the real catalogue is pending', async () => {
  const catalogue = deferredCatalogue()
  const props = reactive<ScreenProps>({ setupProvider: null })
  const m = screen({ ...client(), providerCatalogue: catalogue.read }, props)
  await settle()
  props.setupProvider = 'codex'
  await settle()
  expect(m.all('provider-drawer')).toHaveLength(0)
  catalogue.answer(suppliedProviders)
  await settle()
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('codex')
  expect(m.q('provider-inline-setup')).toBeDefined()
})

it('uses the latest setup request made during catalogue loading', async () => {
  const catalogue = deferredCatalogue()
  const props = reactive<ScreenProps>({ setupProvider: 'claude' })
  const m = screen({ ...client(), providerCatalogue: catalogue.read }, props)
  await settle()
  props.setupProvider = 'codex'
  await settle()
  catalogue.answer(suppliedProviders)
  await settle()
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('codex')
  expect(m.q('provider-inline-setup')).toBeDefined()
})

it('lets a later key request select and focus its actual field after catalogue readiness', async () => {
  const catalogue = deferredCatalogue()
  const m = screen(
    {
      ...client(),
      providerCatalogue: catalogue.read,
      apiKeyStatus: async ({ provider }) => ({ provider, set: false, setAt: null, inUse: false }),
    },
    { setupProvider: 'codex' },
  )
  await settle()
  useKeyAsked().value = 'codex'
  await settle()
  useKeyAsked().value = 'claude'
  await settle()
  catalogue.answer(suppliedProviders)
  await settle()
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('claude')
  expect(useKeyAsked().value).toBeNull()
  expect(document.activeElement).toBe(m.q('provider-key-input'))
})

it('fulfills the current setup request after an unread catalogue is retried', async () => {
  const catalogue = deferredCatalogue()
  const read = vi
    .fn<ClientProviderApi['providerCatalogue']>()
    .mockRejectedValueOnce(new Error('fictional first read failed'))
    .mockImplementationOnce(catalogue.read)
  const props = reactive<ScreenProps>({ setupProvider: 'codex' })
  const m = screen({ ...client(), providerCatalogue: read }, props)
  await settle()
  expect(m.q('provider-catalogue-status').textContent).toContain('fictional first read failed')
  props.setupProvider = 'claude'
  await settle()
  m.q('provider-catalogue-status').querySelector('button')!.click()
  await settle()
  catalogue.answer(suppliedProviders)
  await settle()
  expect(read).toHaveBeenCalledTimes(2)
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('claude')
  expect(m.q('provider-inline-setup')).toBeDefined()
})

it('retains a one-shot setup request through the parent prop cleanup before the catalogue answers', async () => {
  const catalogue = deferredCatalogue()
  const props = reactive<ScreenProps>({ setupProvider: 'claude' })
  const m = screen({ ...client(), providerCatalogue: catalogue.read }, props)
  await settle()
  props.setupProvider = null
  await settle()
  catalogue.answer(suppliedProviders)
  await settle()
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('claude')
  expect(m.q('provider-inline-setup')).toBeDefined()
})

it('keeps a newer manual choice and close ahead of the earlier catalogue continuation', async () => {
  const catalogue = deferredCatalogue()
  const props = reactive<ScreenProps>({ setupProvider: 'claude' })
  const m = screen({ ...client(), providerCatalogue: catalogue.read }, props)
  await settle()
  props.descriptors = suppliedProviders
  await settle()
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('claude')
  m.q('provider-drawer').querySelector<HTMLButtonElement>('[aria-label="Close Claude"]')!.click()
  await settle()
  expect(m.all('provider-drawer')).toHaveLength(0)
  const row = m.all('provider-row').find((one) => one.dataset.provider === 'codex')!
  row.click()
  await settle()
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('codex')
  catalogue.answer(suppliedProviders)
  await settle()
  expect(m.q('provider-card').getAttribute('data-provider')).toBe('codex')
  m.q('provider-drawer').querySelector<HTMLButtonElement>('[aria-label="Close Codex"]')!.click()
  await settle()
  props.descriptors = undefined
  await settle()
  expect(m.all('provider-drawer')).toHaveLength(0)
})

it('disposes selection ownership before an unmounted screen catalogue answers', async () => {
  const catalogue = deferredCatalogue()
  const off = vi.fn()
  const api: ClientProviderApi = {
    ...client(),
    providerCatalogue: catalogue.read,
    onProvidersChanged: () => off,
  }
  const m = screen(api, { setupProvider: 'claude' })
  await settle()
  m.unmount()
  expect(off).toHaveBeenCalledTimes(1)
  catalogue.answer(suppliedProviders)
  await settle()
  expect(document.querySelector('[data-cy="provider-drawer"]')).toBeNull()
  const next = screen(api)
  await settle()
  expect(next.all('provider-row')).toHaveLength(suppliedProviders.length)
  expect(next.all('provider-drawer')).toHaveLength(0)
})
