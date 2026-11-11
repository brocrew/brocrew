import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { providerDescriptor, type ProviderConnection } from '@brobot2/shared'
import type { ClientApi } from '../../src/shared/client-api'
import type { ApiKeyStatus, Provider, ProviderVersion } from '../../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { forgetProfileSignIns } from '../../src/renderer/src/composables/useProfileSignIn'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import ProviderConnections from '../../src/renderer/src/components/ProviderConnections.vue'
import ProviderSetupAtLaunch from '../../src/renderer/src/components/ProviderSetupAtLaunch.vue'
import { unmountAll } from './harness'
import { mountProviderReadSurface as surface } from './provider-read-surface'

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
const emptyKey = (provider: Provider): ApiKeyStatus => ({
  provider,
  set: false,
  setAt: null,
  inUse: false,
})
const version = (missing: boolean): ProviderVersion => ({
  ...(missing ? { version: null, reason: 'Fern is not installed.' } : { version: '8.0' }),
  program: {
    standing: missing ? 'missing' : 'tested',
    from: missing ? null : 'native-installer',
    path: missing ? null : '/fictional/fern',
    version: missing ? null : '8.0',
    tested: null,
    said: 'Fern supplied installation observation.',
    help: null,
    update: null,
    others: [],
    updatedFrom: null,
  },
})
function fixture() {
  const descriptor = { ...providerDescriptor('claude'), displayName: 'Fern' }
  const forbidden = vi.fn(() => {
    throw new Error('An assigned read reached the window')
  })
  Reflect.set(window, 'api', {
    runtime: {
      providerVersions: forbidden,
      providerResources: forbidden,
      providerConnections: forbidden,
      apiKeyStatus: forbidden,
      providerUsage: async () => ({ claude: [], codex: [] }),
      onProvidersChanged: () => () => {},
      providerSetup: async () => ({
        claude: {
          tool: 'Fern',
          install: null,
          signInCommand: 'fern',
          platform: 'macOS',
          shell: 'Terminal',
        },
        codex: null,
      }),
      checkProviderAuth: async ({ provider }: { provider: Provider }) =>
        provider === 'claude'
          ? { state: 'usable', login: 'account', expiresAt: null }
          : { state: 'absent', reason: 'No supplied login.' },
    },
  })
  const off = vi.fn()
  const usageOff = vi.fn()
  const api = {
    ...createDesktopProviderApi(
      (): never => {
        throw new Error('Unexpected transport read')
      },
      () => undefined,
    ),
    providerCatalogue: async () => [descriptor],
    providerSetup: async () => ({
      claude: {
        tool: 'Fern',
        install: { command: 'fern install', docs: 'https://example.invalid/install' },
        signInCommand: 'fern',
        platform: 'macOS' as const,
        shell: 'Terminal' as const,
      },
      codex: null,
    }),
    providerUsage: async () => ({ claude: [], codex: [] }),
    providerVersions: vi.fn(async () => ({ claude: version(false), codex: version(false) })),
    providerResources: vi.fn(async () => ({
      claude: {
        running: 7,
        at: 1,
        rssBytes: null,
        cpuPercent: null,
        reason: 'No process measurements supplied.',
      },
      codex: {
        running: 0,
        at: 1,
        rssBytes: null,
        cpuPercent: null,
        reason: 'No process measurements supplied.',
      },
    })),
    providerConnections: vi.fn<ClientApi['providerConnections']>(async () => []),
    apiKeyStatus: vi.fn<ClientApi['apiKeyStatus']>(async ({ provider }) => emptyKey(provider)),
    checkProviderAuth: vi.fn<ClientApi['checkProviderAuth']>(async ({ provider }) =>
      provider === 'claude'
        ? { state: 'usable', login: 'account', expiresAt: null }
        : { state: 'absent', reason: 'No supplied login.' },
    ),
    onProvidersChanged: vi
      .fn<ClientApi['onProvidersChanged']>(() => off)
      .mockReturnValueOnce(usageOff),
  } satisfies ClientApi
  return { api, forbidden, off, usageOff, descriptor }
}

afterEach(() => {
  unmountAll()
  forgetProfileSignIns()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

it('uses injected versions and resources on arrival and focus, then stops after leaving', async () => {
  const out = fixture()
  let focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  out.api.providerVersions.mockResolvedValue({ claude: version(true), codex: version(false) })
  const m = surface(ProvidersScreen, out.api, {
    descriptors: [out.descriptor],
    capabilities: null,
    warnings: null,
    clock: Date.now(),
  })
  await settle()
  expect(m.q('provider-row').textContent).toContain('Fern supplied installation observation.')
  expect(m.q('provider-row').querySelector('.running')?.textContent?.trim()).toBe(
    '7 agents running',
  )
  expect(out.api.providerVersions).toHaveBeenCalledTimes(1)
  expect(out.api.providerResources).toHaveBeenCalledTimes(1)
  focused = false
  window.dispatchEvent(new Event('blur'))
  focused = true
  window.dispatchEvent(new Event('focus'))
  await settle()
  expect(out.api.providerVersions).toHaveBeenCalledTimes(2)
  expect(out.api.providerResources).toHaveBeenCalledTimes(2)
  m.unmount()
  window.dispatchEvent(new Event('focus'))
  await settle()
  expect(out.api.providerResources).toHaveBeenCalledTimes(2)
  expect(out.off).toHaveBeenCalledTimes(1)
  expect(out.usageOff).toHaveBeenCalledTimes(1)
  expect(out.forbidden).not.toHaveBeenCalled()
})

const rows = (provider: Provider, name: string): ProviderConnection[] => [
  {
    id: provider,
    provider,
    name,
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  },
]
it('keeps injected connection reads scoped to the current provider and ignores late and unmounted replies', async () => {
  const out = fixture()
  let finish!: (value: readonly ProviderConnection[]) => void
  out.api.providerConnections.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const props = reactive({
    provider: 'claude' as Provider,
    name: 'Fern',
    auth: null,
    keyStatus: null,
    loginMoved: 0,
    modelsKnown: false,
  })
  const m = surface(ProviderConnections, out.api, props)
  expect(m.q('provider-connections').textContent).toContain('Reading…')
  out.api.providerConnections.mockResolvedValueOnce(rows('codex', 'Supplied second account'))
  props.provider = 'codex'
  props.name = 'Cedar'
  await settle()
  expect(m.q('provider-connections').textContent).toContain('Cedar · Supplied second account')
  finish(rows('claude', 'Obsolete first account'))
  await settle()
  expect(m.q('provider-connections').textContent).not.toContain('Obsolete first account')
  out.api.providerConnections.mockRejectedValueOnce(new Error('Supplied metadata refusal'))
  props.loginMoved++
  await settle()
  expect(m.q('provider-connections').textContent).toContain('Connections could not be read.')
  out.api.providerConnections.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  props.loginMoved++
  await settle()
  m.unmount()
  finish(rows('codex', 'After leaving'))
  await settle()
  expect(m.host.isConnected).toBe(false)
  expect(out.api.providerConnections).toHaveBeenCalledTimes(4)
  expect(out.forbidden).not.toHaveBeenCalled()
})

it.each([false, true])(
  'launch readiness uses injected version and saved-key facts (unreadable: %s)',
  async (unreadable) => {
    const out = fixture()
    if (unreadable)
      out.api.apiKeyStatus.mockImplementation(async ({ provider }) =>
        provider === 'claude'
          ? {
              ...emptyKey(provider),
              set: true,
              readState: 'unreadable',
              unreadableReason: 'Fern supplied unreadable key.',
            }
          : emptyKey(provider),
      )
    const open = vi.fn()
    surface(ProviderSetupAtLaunch, out.api, { capabilities: null, onOpenProviders: open })
    await settle()
    expect(open).toHaveBeenCalledTimes(unreadable ? 1 : 0)
    expect(out.api.providerVersions).toHaveBeenCalledExactlyOnceWith()
    expect(out.api.apiKeyStatus).toHaveBeenCalledTimes(2)
    expect(out.api.apiKeyStatus).toHaveBeenCalledWith({ provider: 'claude' })
    expect(out.api.apiKeyStatus).toHaveBeenCalledWith({ provider: 'codex' })
    expect(out.forbidden).not.toHaveBeenCalled()
  },
)
