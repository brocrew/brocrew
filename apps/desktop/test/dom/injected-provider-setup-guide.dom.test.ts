import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, type Component } from 'vue'
import { providerDescriptor } from '@brobot2/shared'
import type { ClientApi } from '../../src/shared/client-api'
import type { ProviderSetup, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { forgetProfileSignIns } from '../../src/renderer/src/composables/useProfileSignIn'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import ProviderSetupAtLaunch from '../../src/renderer/src/components/ProviderSetupAtLaunch.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll } from './harness'

const observed = vi.hoisted(() => ({ facts: vi.fn() }))
vi.mock('../../src/renderer/src/lib/provider-setup-steps', async (original) => {
  const actual = await original<typeof import('../../src/renderer/src/lib/provider-setup-steps')>()
  return {
    ...actual,
    isReady: (facts: Parameters<typeof actual.isReady>[0]) => {
      observed.facts(facts)
      return actual.isReady(facts)
    },
  }
})

type Guide = Awaited<ReturnType<RuntimeBridge['providerSetup']>>
const guide = (name: string): ProviderSetup => ({
  tool: `${name} Tool`,
  install: { command: `${name.toLowerCase()} install`, docs: 'https://example.invalid/install' },
  signInCommand: `${name.toLowerCase()} login`,
  signInInstructions: `${name} supplied sign-in instructions.`,
  platform: 'macOS',
  shell: 'Terminal',
})
const fern = guide('Fern')
const cedar = guide('Cedar')
const selected: Guide = { claude: fern, codex: null }
const caps = {
  claude: providerDescriptor('claude').capabilities,
  codex: providerDescriptor('codex').capabilities,
}
async function settle() {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
function fixture() {
  providersBridge()
  const raw = window.api.runtime
  const ambient = vi.spyOn(raw, 'providerSetup').mockResolvedValue({
    claude: guide('Ambient'),
    codex: null,
  })
  const api = {
    ...createDesktopProviderApi(
      () => raw,
      () => undefined,
    ),
    providerSetup: vi.fn<RuntimeBridge['providerSetup']>(async function (this: object) {
      expect(this).toBe(api)
      return selected
    }),
    apiKeyStatus: vi.fn<RuntimeBridge['apiKeyStatus']>(async ({ provider }) => ({
      provider,
      set: false,
      setAt: null,
      inUse: false,
    })),
    checkProviderAuth: vi.fn<RuntimeBridge['checkProviderAuth']>(async () => ({
      state: 'absent',
      reason: 'Fern supplied missing login.',
    })),
  }
  return { api, ambient }
}
function surface(component: Component, api: ClientApi, props: Record<string, unknown>) {
  return mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(component, props)
      },
    }),
    {},
    { width: 1100, height: 900 },
  )
}
const screenProps = () => ({
  descriptors: [{ ...providerDescriptor('claude'), displayName: 'Fern' }],
  capabilities: caps,
  warnings: null,
  clock: Date.now(),
  setupProvider: 'claude',
})
afterEach(() => {
  unmountAll()
  forgetProfileSignIns()
  observed.facts.mockClear()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

it('the real Providers screen displays selected tool, command and instructions rather than ambient guidance', async () => {
  const out = fixture()
  const m = surface(ProvidersScreen, out.api, screenProps())
  await settle()
  expect(out.api.providerSetup).toHaveBeenCalledExactlyOnceWith()
  expect(out.ambient).not.toHaveBeenCalled()
  m.q('setup-sign-in').click()
  await settle()
  expect(m.q('setup-command').textContent).toBe(fern.signInCommand)
  expect(m.q('provider-card').textContent).toContain(fern.signInInstructions)
  expect(m.q('provider-card').textContent).toContain(fern.tool)
  expect(m.q('provider-card').textContent).not.toContain('Ambient')
})

it('the real launch caller retains selected native facts and native null entries', async () => {
  const out = fixture()
  const open = vi.fn()
  surface(ProviderSetupAtLaunch, out.api, { capabilities: caps, onOpenProviders: open })
  await settle()
  expect(out.api.providerSetup).toHaveBeenCalledExactlyOnceWith()
  expect(out.ambient).not.toHaveBeenCalled()
  const facts = observed.facts.mock.calls.map(([one]) => one)
  expect(facts.some((one) => one.setup === fern)).toBe(true)
  expect(facts.some((one) => one.setup === null)).toBe(true)
  expect(open).toHaveBeenCalledExactlyOnceWith()
})

it.each(['null', 'error'] as const)(
  'launch guidance %s settles the existing decision without a raw fallback',
  async (kind) => {
    const out = fixture()
    if (kind === 'null') out.api.providerSetup.mockResolvedValue({ claude: null, codex: null })
    else out.api.providerSetup.mockRejectedValue(new Error('Selected guide unavailable'))
    const open = vi.fn()
    surface(ProviderSetupAtLaunch, out.api, { capabilities: caps, onOpenProviders: open })
    await settle()
    expect(out.api.providerSetup).toHaveBeenCalledExactlyOnceWith()
    expect(out.ambient).not.toHaveBeenCalled()
    const facts = observed.facts.mock.calls.map(([one]) => one)
    expect(facts.some((one) => one.setup === (kind === 'null' ? null : undefined))).toBe(true)
    expect(open).toHaveBeenCalledExactlyOnceWith()
  },
)

it('a later Screen guide wins and a rejected reread keeps that last successful answer', async () => {
  const out = fixture()
  let focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  let finish!: (value: Guide) => void
  out.api.providerSetup.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const m = surface(ProvidersScreen, out.api, screenProps())
  await settle()
  expect(out.api.providerSetup).toHaveBeenCalledTimes(1)
  const refocus = async () => {
    focused = false
    window.dispatchEvent(new Event('blur'))
    focused = true
    window.dispatchEvent(new Event('focus'))
    await settle()
  }
  out.api.providerSetup.mockResolvedValueOnce({ claude: cedar, codex: null })
  await refocus()
  expect(out.api.providerSetup).toHaveBeenCalledTimes(2)
  m.q('setup-sign-in').click()
  await settle()
  expect(m.q('setup-command').textContent).toBe(cedar.signInCommand)
  finish(selected)
  await settle()
  expect(m.q('setup-command').textContent).toBe(cedar.signInCommand)
  out.api.providerSetup.mockRejectedValueOnce(new Error('Selected later read refused'))
  await refocus()
  expect(out.api.providerSetup).toHaveBeenCalledTimes(3)
  expect(m.q('setup-command').textContent).toBe(cedar.signInCommand)
  expect(out.ambient).not.toHaveBeenCalled()
})

it.each(['null', 'error'] as const)(
  'Screen guidance %s stays unavailable without borrowing ambient words',
  async (kind) => {
    const out = fixture()
    if (kind === 'null') out.api.providerSetup.mockResolvedValue({ claude: null, codex: null })
    else out.api.providerSetup.mockRejectedValue(new Error('Selected guide unavailable'))
    const m = surface(ProvidersScreen, out.api, screenProps())
    await settle()
    expect(out.api.providerSetup).toHaveBeenCalledExactlyOnceWith()
    expect(out.ambient).not.toHaveBeenCalled()
    expect(m.all('setup-command')).toHaveLength(0)
    expect(m.q('provider-card').textContent).not.toContain('Ambient')
  },
)
