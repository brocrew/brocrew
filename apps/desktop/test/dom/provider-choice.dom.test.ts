import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import {
  defaultModel,
  providerReady,
  readyProvider,
} from '../../src/renderer/src/lib/provider-models'
import type { ModelList, Provider, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'
import { providersBridge } from '../../look/fixtures/providers'

beforeEach(() => {
  providersBridge()
})
afterEach(unmountAll)
const list = (provider: Provider): ModelList => ({
  provider,
  notAsked: null,
  standIn: null,
  models: [
    {
      id: `${provider}-default`,
      label: `${provider} default`,
      isDefault: true,
      addedBy: 'the-provider',
      efforts: [],
    },
  ],
  lastPicked: null,
  startsOn: { model: `${provider}-default`, effort: null, from: 'its-default' },
})
const missing = (): ModelList => ({
  ...list('codex'),
  models: [],
  startsOn: null,
  notAsked: {
    ok: false,
    reason: 'refused',
    detail: 'personal Codex auth.json not found at /fictional/account/.codex/auth.json',
  },
})
async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
  await drawnReady()
}
async function open(m: Mounted) {
  m.q('model-picker-face').click()
  await settle()
}
function fixture(codex: ModelList = list('codex')) {
  const modelList = vi.fn(async ({ provider }: { provider: Provider }) =>
    provider === 'codex' ? codex : list('claude'),
  )
  const host = {
    modelList,
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
  } satisfies Pick<RuntimeBridge, 'modelList' | 'addHandAddedModel' | 'deleteHandAddedModel'>
  const lists = createModelLists(() => host)
  const setup = vi.fn()
  const take = vi.fn(async () => null)
  const m = mount(
    ModelPicker,
    {
      providers: ['claude', 'codex'],
      shown: { provider: 'claude', model: 'claude-default', effort: null },
      takeWords: 'Start on this',
      take,
      lists,
      setUp: setup,
    },
    { width: 700, height: 800 },
  )
  return { m, setup, take, modelList, lists }
}
it('shows provider radios, one provider model list and only its Add action', async () => {
  const { m, take } = fixture()
  await open(m)
  assertDrawn(m.q('model-picker-providers'), 'provider choices', m.host)
  expect((m.q('model-picker-choose-claude') as HTMLInputElement).checked).toBe(true)
  expect(m.all('model-picker-row').map((el) => el.dataset.model)).toEqual(['claude-default'])
  m.q('model-picker-choose-codex').click()
  await settle()
  expect((m.q('model-picker-choose-codex') as HTMLInputElement).checked).toBe(true)
  expect(m.all('model-picker-row').map((el) => el.dataset.model)).toEqual(['codex-default'])
  expect(m.q('model-picker-add-open').textContent).toContain('+ Add a Codex model')
  m.q('model-picker-take').click()
  await settle()
  expect(take).toHaveBeenCalledExactlyOnceWith({
    provider: 'codex',
    model: 'codex-default',
    effort: null,
  })
})
it('disables the provider that needs setup and opens Settings for its exact card', async () => {
  const { m, setup, take } = fixture(missing())
  await open(m)
  const radio = m.q('model-picker-choose-codex') as HTMLInputElement
  expect(radio.disabled).toBe(true)
  expect(radio.closest('label')?.textContent).toContain('Codex · Not set up')
  const link = m.q('model-picker-setup-codex')
  assertDrawn(link, 'provider setup link', m.host)
  expect(link.textContent?.trim()).toBe('Set up in Settings')
  radio.click()
  await settle()
  expect(m.q('model-picker-provider').dataset.provider).toBe('claude')
  expect(m.q('model-picker-panel').textContent).not.toContain('/fictional/')
  expect(take).not.toHaveBeenCalled()
  link.click()
  await settle()
  expect(setup).toHaveBeenCalledExactlyOnceWith('codex')
})
it('offers plain retry wording for other failures and retries the same provider', async () => {
  const failed = {
    ...list('codex'),
    models: [],
    startsOn: null,
    notAsked: {
      ok: false as const,
      reason: 'refused' as const,
      detail: 'transport failure at /fictional/socket',
    },
  }
  const { m, modelList } = fixture(failed)
  await open(m)
  const codex = m.q('model-picker-choose-codex') as HTMLInputElement
  expect(codex.disabled).toBe(true)
  expect(codex.closest('label')?.textContent).toContain('Codex · Checking…')
  expect(m.q('model-picker-said').textContent?.trim()).toBe("Codex didn't answer. Try again.")
  expect(m.q('model-picker-said').title).toContain('/fictional/socket')
  m.q('model-picker-retry').click()
  await settle()
  expect(modelList.mock.calls.filter(([body]) => body.provider === 'codex')).toHaveLength(2)
})
it('never defaults a new conversation to a known unavailable provider', async () => {
  const held = { state: 'answered' as const, list: missing() }
  const readiness = {
    claude: providerReady({ state: 'answered', list: list('claude') }),
    codex: providerReady(held),
  }
  expect(readiness).toEqual({ claude: true, codex: false })
  const provider = readyProvider('codex', readiness)
  expect(provider).toBe('claude')
  const sent = vi.fn()
  const { lists } = fixture(missing())
  await lists.read('claude')
  const m = mount(NewConversation, {
    busy: false,
    error: null,
    draft: 'Review this project',
    defaultProvider: provider,
    providerReadiness: readiness,
    defaultApprovalMode: 'ask',
    approvalDefaultChosen: true,
    capabilities: null,
    choices: { ...NO_LAUNCH_CHOICES },
    lists,
    onStart: sent,
  })
  await settle()
  expect(m.q('model-picker-face').textContent).toContain('claude-default')
  m.q('send-prompt').click()
  await settle()
  expect(sent.mock.calls[0]?.[0].provider).toBe('claude')
})
it('uses the declared default model if no selected pair exists', () => {
  expect(defaultModel({ ...list('claude'), startsOn: null })).toEqual({
    model: 'claude-default',
    effort: null,
  })
})

it('opens only the requested provider setup inside Settings', async () => {
  const m = mount(
    SettingsScreen,
    {
      tab: 'providers',
      setupProvider: 'codex',
      capabilities: CAPABILITY_FIXTURE,
      warnings: null,
      clock: 1,
    },
    { width: 1180, height: 1000 },
  )
  await settle()
  await settle()
  const codex = m.host.querySelector<HTMLElement>(
    '[data-cy="provider-card"][data-provider="codex"]',
  )!
  const claude = m.host.querySelector<HTMLElement>(
    '[data-cy="provider-card"][data-provider="claude"]',
  )!
  assertDrawn(
    codex.querySelector<HTMLElement>('[data-cy="provider-inline-setup"]')!,
    'targeted setup',
    m.host,
  )
  expect(claude.querySelector('[data-cy="provider-inline-setup"]')).toBeNull()
})
it('blocks both the button and keyboard if the only selected provider needs setup', async () => {
  const start = vi.fn()
  const { lists } = fixture(missing())
  const m = mount(NewConversation, {
    busy: false,
    error: null,
    draft: 'Write a menu',
    defaultProvider: 'codex',
    providerReadiness: { claude: false, codex: false },
    defaultApprovalMode: 'ask',
    approvalDefaultChosen: true,
    capabilities: null,
    choices: NO_LAUNCH_CHOICES,
    lists,
    onStart: start,
  })
  await settle()
  expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
  m.q('prompt-input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true }),
  )
  expect(start).not.toHaveBeenCalled()
  expect(m.q('composer-hint').textContent).toContain(
    "Codex isn't set up. Set it up in Settings → Providers.",
  )
})

it('blocks an unknown provider even with retained models, and never relabels its model on launch', async () => {
  const { lists, take } = fixture()
  await lists.read('claude')
  await lists.read('codex')
  const readiness = { claude: true, codex: null }
  const picker = mount(ModelPicker, {
    providers: ['claude', 'codex'],
    shown: { provider: 'codex', model: 'codex-default', effort: null },
    readiness,
    takeWords: 'Start on this',
    take,
    lists,
  })
  await open(picker)
  const radio = picker.q('model-picker-choose-codex') as HTMLInputElement
  expect(radio.disabled).toBe(true)
  expect(radio.closest('label')?.textContent).toContain('Codex · Checking…')
  radio.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  expect(picker.q('model-picker-provider').dataset.provider).toBe('claude')
  expect(picker.all('model-picker-row').map((row) => row.dataset.model)).toEqual(['claude-default'])
  const sent = vi.fn()
  const m = mount(NewConversation, {
    busy: false,
    error: null,
    draft: 'Review this project',
    defaultProvider: readyProvider('codex', readiness),
    providerReadiness: readiness,
    defaultApprovalMode: 'ask',
    approvalDefaultChosen: true,
    capabilities: null,
    choices: { provider: 'codex', model: 'codex-default', reasoningEffort: '' },
    lists,
    onStart: sent,
  })
  await settle()
  expect(m.q('model-picker-face').textContent).toContain('claude-default')
  m.q('send-prompt').click()
  await settle()
  expect(sent.mock.calls[0]?.[0]).toMatchObject({ provider: 'claude', model: 'claude-default' })
  expect(take).not.toHaveBeenCalled()
})
