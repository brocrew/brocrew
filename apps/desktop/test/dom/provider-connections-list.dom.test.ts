import { compatibilityConnectionId, providerDescriptor } from '@brobot2/shared'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, type Component } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'

import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll } from './harness'
import { providerCardReadingProps } from './provider-launch.fixture'

const rows = (provider: Provider, name = 'Fictional subscription'): ProviderConnection[] => [
  {
    id: `${provider}:sign-in`,
    provider,
    name,
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  },
]
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
function held<T>() {
  let answer!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    answer = resolve
  })
  return { promise, answer }
}
beforeEach(() => providersBridge())
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

function card(read: () => Promise<readonly ProviderConnection[]>) {
  Reflect.set(window.api.runtime, 'providerConnections', read)
  const props = reactive({
    provider: 'claude' as Provider,
    capabilities: null,
    limit: null,
    limitsRead: true,
    clock: Date.now(),
    version: { version: 'fictional' },
    ...providerCardReadingProps([]),
  })
  const component = defineComponent({
    setup: () => () =>
      h(ProviderCard as Component, {
        ...props,
        descriptor: providerDescriptor(props.provider),
      }),
  })
  return { props, m: mount(component, {}, { width: 520, height: 900 }) }
}

it('shows a pending metadata read without inventing a connection or readiness', async () => {
  const pending = held<ProviderConnection[]>()
  const { m } = card(() => pending.promise)
  await settle()
  expect(m.q('provider-connections').textContent).toContain('Reading…')
  expect(m.all('provider-connection')).toHaveLength(0)
  pending.answer(rows('claude'))
  await settle()
  expect(m.all('provider-connection')).toHaveLength(1)
})

it('shows named compatibility rows only in their provider drawer', async () => {
  const { m } = card(async () => [...rows('claude'), ...rows('codex', 'Other account')])
  await settle()
  const text = m.q('provider-connections').textContent
  expect(text).toContain('Claude · Fictional subscription')
  expect(text).not.toContain('In use')
  expect(text).toContain('Ready')
  expect(text).not.toContain('Other account')
  expect(text).toContain('Sign-in · Max plan')
  expect(m.q('provider-connection').querySelectorAll('.meta')).toHaveLength(1)
  const entry = m.q('provider-connection')
  expect(entry.querySelectorAll('[data-cy="provider-status"]')).toHaveLength(1)
  expect(entry.querySelectorAll('[data-cy="provider-usage"]')).toHaveLength(0)
  expect(entry.querySelector('[data-cy="provider-key"]')).toBeNull()
  expect(m.all('provider-status')).toHaveLength(1)
  expect(m.all('provider-usage')).toHaveLength(0)
})

it('reads metadata beside separate overview and sign-in checks without adding mutations', async () => {
  const auth = vi.fn(window.api.runtime.checkProviderAuth)
  const model = vi.fn(window.api.runtime.modelList)
  const login = vi.fn(window.api.runtime.signInProvider)
  window.api.runtime.checkProviderAuth = auth
  window.api.runtime.modelList = model
  window.api.runtime.signInProvider = login
  const { m } = card(async () => rows('claude'))
  await settle()
  expect(m.all('provider-connection')).toHaveLength(1)
  expect(auth.mock.calls).toEqual([
    [
      {
        provider: 'claude',
        profileId: DEFAULT_PROFILE_ID,
        connectionId: compatibilityConnectionId('claude', 'sign-in'),
      },
    ],
    [{ provider: 'claude', profileId: DEFAULT_PROFILE_ID }],
  ])
  expect(model).toHaveBeenCalledTimes(1)
  expect(login).not.toHaveBeenCalled()
})

it('uses fixed read-error words rather than displaying an exception', async () => {
  const { m } = card(async () => {
    throw new Error('fictional-private-diagnostic')
  })
  await settle()
  expect(m.q('provider-connections').textContent).toContain('Connections could not be read.')
  expect(m.q('provider-connections').textContent).not.toContain('fictional-private-diagnostic')
})

it('does not advertise models below when the existing catalog read failed', async () => {
  window.api.runtime.modelList = async () => {
    throw new Error('fictional-catalog-unavailable')
  }
  const { m } = card(async () => rows('claude'))
  await settle()
  expect(m.q('provider-connections').textContent).not.toContain('Models not checked.')
  expect(m.q('provider-connections').textContent).not.not.toContain('Models are shown below.')
})

it('shows an empty metadata result without a setup or selection control', async () => {
  const { m } = card(async () => [])
  await settle()
  expect(m.q('provider-connections').textContent).toContain('No connections available.')
  expect(m.q('provider-connections').querySelectorAll('input,select,button,a')).toHaveLength(0)
})

it('keeps a known billing refusal from becoming a Ready key connection', async () => {
  window.api.runtime.apiKeyStatus = async () => ({
    provider: 'claude',
    set: true,
    setAt: 1,
    inUse: true,
    refusedForBilling: { at: Date.now(), aLoginRunsWithoutIt: false },
  })
  window.api.runtime.checkProviderAuth = async () => ({
    state: 'usable',
    login: 'api-key',
    expiresAt: null,
  })
  const key: ProviderConnection = {
    ...rows('claude')[0]!,
    id: 'claude:api-key',
    name: 'Fictional key',
    authMethod: 'api-key',
    credentialSource: 'provider-api-key',
  }
  const { m } = card(async () => [key])
  await settle()
  expect(m.q('provider-connection').textContent).toContain('API key needs attention')
  expect(m.q('provider-connection').textContent).not.toContain('Ready')
})

it('does not let an older metadata answer replace the selected provider reading', async () => {
  const pending = held<ProviderConnection[]>()
  let calls = 0
  const { m, props } = card(async () =>
    ++calls === 1 ? pending.promise : rows('codex', 'New name'),
  )
  await settle()
  props.provider = 'codex'
  await settle()
  pending.answer(rows('codex', 'Old name'))
  await settle()
  expect(m.q('provider-connections').textContent).toContain('Codex · New name')
  expect(m.q('provider-connections').textContent).not.toContain('Old name')
})

it('does not claim per-connection totals or checked models for an inactive connection', async () => {
  const key: ProviderConnection = {
    ...rows('claude')[0]!,
    id: 'claude:api-key',
    name: 'Fictional key',
    authMethod: 'api-key',
    credentialSource: 'provider-api-key',
  }
  window.api.runtime.apiKeyStatus = async () => ({
    provider: 'claude',
    set: true,
    setAt: 1,
    inUse: true,
  })
  window.api.runtime.checkProviderAuth = async () => ({
    state: 'usable',
    login: 'api-key',
    expiresAt: null,
  })
  const { m } = card(async () => [...rows('claude'), key])
  await settle()
  const entries = m.all('provider-connection')
  expect(entries).toHaveLength(2)
  expect(entries[0]!.textContent).toContain('Not checked')
  expect(entries[0]!.textContent).not.toContain('Models not checked.')
  expect(entries[0]!.textContent).not.toContain('Ready')
  expect(entries[1]!.querySelector('[data-cy=connection-status]')?.textContent).toContain('Ready')
  expect(entries[1]!.textContent).not.toContain('Models are shown below.')
  expect(entries[0]!.querySelectorAll('[data-cy="provider-status"]')).toHaveLength(1)
  expect(entries[1]!.querySelectorAll('[data-cy="provider-key"]')).toHaveLength(1)
  expect(entries[0]!.querySelector('[data-cy="provider-key"]')).toBeNull()
  expect(entries[1]!.querySelector('[data-cy="provider-status"]')).toBeNull()
  expect(entries[1]!.querySelector('[data-cy="provider-usage"]')).toBeNull()
  expect(m.all('provider-status')).toHaveLength(1)
  expect(m.all('provider-key')).toHaveLength(1)
  expect(entries[0]!.querySelectorAll('meter')).toHaveLength(0)
  expect(entries[1]!.querySelectorAll('meter')).toHaveLength(0)
  expect(m.q('provider-connections').textContent).not.toContain('In use')
})

it('rereads metadata when the existing provider login notice changes', async () => {
  let current = rows('claude', 'Before')
  const { m, props } = card(async () => current)
  await settle()
  current = rows('claude', 'After')
  props.loginMoved++
  await settle()
  expect(m.q('provider-connections').textContent).toContain('After')
  expect(m.q('provider-connections').textContent).not.toContain('Before')
})

for (const state of ['absent', 'unknown'] as const) {
  it(`does not label an ${state} sign-in route as In use`, async () => {
    window.api.runtime.checkProviderAuth = async () => ({ state, reason: 'Fictional status' })
    const { m } = card(async () => rows('claude'))
    await settle()
    expect(m.q('provider-connection').textContent).not.toMatch(/Selected|In use/)
  })
}
