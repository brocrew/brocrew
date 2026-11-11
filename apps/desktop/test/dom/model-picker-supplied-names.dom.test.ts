import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import type { Provider } from '../../src/shared/runtime-ipc'
import type { ModelList } from '../../src/shared/model-choice-contracts'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import { launchFacts, resolveProviderLaunch } from '../lib/provider-launch-fixture'
import { mount, unmountAll } from './harness'

const list = (provider: Provider): ModelList => ({
  provider,
  models: [
    {
      id: 'listed-model',
      label: 'Listed Model',
      addedBy: 'the-provider',
      efforts: [{ id: 'high', label: 'High' }],
      defaultEffort: 'high',
    },
  ],
  notAsked: null,
  standIn: null,
  startsOn: null,
  lastPicked: null,
})
const settle = async () => {
  for (let index = 0; index < 5; index++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

function picker() {
  const catalogue = vi.fn(async () =>
    PROVIDER_DESCRIPTORS.map((row) => ({
      ...row,
      displayName: row.id === 'claude' ? 'Fern' : 'Birch',
    })),
  )
  const add = vi.fn(async () => [])
  const selected = {
    ...createDesktopProviderApi(
      (): never => {
        throw new Error('Unexpected provider operation')
      },
      () => undefined,
    ),
    providerCatalogue: catalogue,
    providerLaunchChoices: async ({ provider }: { provider: Provider }) => ({
      ...launchFacts(list(provider)),
      ready: true,
    }),
    resolveProviderLaunch: async (input: Parameters<typeof resolveProviderLaunch>[0]) =>
      resolveProviderLaunch(input, null),
    addHandAddedModel: add,
    deleteHandAddedModel: async () => [],
  }
  const ambientCatalogue = vi.fn(async () => PROVIDER_DESCRIPTORS)
  Reflect.set(window, 'api', { runtime: { ...selected, providerCatalogue: ambientCatalogue } })
  const take = vi.fn(async (): Promise<string | null> => null)
  const owner = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, selected)
      return () =>
        h(ModelPicker, {
          providers: ['claude', 'codex'],
          readiness: { claude: true, codex: true },
          shown: { provider: 'claude', model: 'listed-model', effort: 'high' },
          takeWords: 'Use this model',
          take,
        })
    },
  })
  const view = mount(owner, {}, { width: 900 })
  return { view, catalogue, ambientCatalogue, add, take }
}

it('uses the ancestor Fern/Birch catalogue for the face and both provider sections', async () => {
  const { view, catalogue, ambientCatalogue } = picker()
  await settle()
  expect(view.q('model-picker-face').textContent).toContain('Fern ·')
  view.q('model-picker-face').click()
  await expect.poll(() => view.all('model-picker-row').length).toBe(1)
  expect(view.q('model-picker-providers').textContent).toContain('Fern')
  expect(view.q('model-picker-providers').textContent).toContain('Birch')
  expect(catalogue).toHaveBeenCalledTimes(1)
  expect(ambientCatalogue).not.toHaveBeenCalled()
})

it('keeps duplicate selection and refusal behavior while naming the supplied provider', async () => {
  const { view, add, take } = picker()
  await settle()
  view.q('model-picker-face').click()
  await expect.poll(() => view.all('model-picker-row').length).toBe(1)
  view.q('model-picker-add-open').click()
  await nextTick()
  const input = view.q('model-picker-add-name') as HTMLInputElement
  input.value = ' LISTED-MODEL '
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  view.q('model-picker-add').click()
  await expect.poll(() => view.all('model-picker-add-name').length).toBe(0)
  expect(view.q('model-picker-add-said').textContent).toBe(
    '“LISTED-MODEL” is already in Fern’s list — selected it.',
  )
  expect(add).not.toHaveBeenCalled()
  take.mockResolvedValueOnce('The supplied host refused this exact choice.')
  view.q('model-picker-take').click()
  await expect.poll(() => view.all('model-picker-refusal').length).toBe(1)
  expect(view.q('model-picker-refusal').textContent).toBe(
    'The supplied host refused this exact choice.',
  )
  expect(take).toHaveBeenCalledTimes(1)
  expect(take).toHaveBeenLastCalledWith({
    provider: 'claude',
    model: 'listed-model',
    effort: 'high',
  })
})
