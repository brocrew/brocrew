import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { useDebugMode } from '../../src/renderer/src/composables/useDebugMode'
import {
  DEFAULT_PROFILE_ID,
  type AuthState,
  type RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import type { ProviderSetupBridge, ProviderSetupState } from '../../src/shared/provider-setup'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, visible } from './harness'

const READY: AuthState = {
  state: 'usable',
  login: 'account',
  plan: 'Max',
  expiresAt: Date.UTC(2026, 10, 28),
}
const REFUSED: AuthState = {
  state: 'stale',
  reason: 'Claude rejected this sign-in. Sign in again.',
}
const SETUP: ProviderSetupState = {
  provider: 'claude',
  supported: { install: true, signIn: true },
  available: true,
  phase: 'idle',
  progress: '',
  authUrl: null,
  error: null,
  details: null,
  exitCode: null,
}

function fixture(initial: AuthState = READY) {
  localStorage.clear()
  useDebugMode().value = false
  providersBridge()
  let auth = initial
  let probeReply: AuthState | null = null
  const authListeners = new Set<Parameters<RuntimeBridge['onProvidersChanged']>[0]>()
  const setupListeners = new Set<Parameters<ProviderSetupBridge['onState']>[0]>()
  const original = window.api.runtime.checkProviderAuth
  const check = vi.fn<RuntimeBridge['checkProviderAuth']>(async (input) => {
    if (input.provider !== 'claude') return original(input)
    if (input.probe && probeReply !== null) auth = probeReply
    return auth
  })
  let setup = SETUP
  const providerSetup: ProviderSetupBridge = {
    state: async () => setup,
    onState: (listener) => {
      setupListeners.add(listener)
      return () => {
        setupListeners.delete(listener)
      }
    },
    install: async () => ({ ok: true }),
    signIn: vi.fn(async () => {
      setup = {
        ...SETUP,
        phase: 'signing-in',
        progress: 'Finish signing in in your browser.',
        authUrl: 'https://claude.ai/oauth/authorize?response_type=code&state=fictional',
      }
      for (const listener of setupListeners) listener(setup)
      return { ok: true }
    }),
    cancel: vi.fn(async () => ({ ok: true })),
  }
  window.api = {
    ...window.api,
    providerSetup,
    runtime: {
      ...window.api.runtime,
      checkProviderAuth: check,
      onProvidersChanged: (listener) => {
        authListeners.add(listener)
        return () => {
          authListeners.delete(listener)
        }
      },
    },
  }
  return {
    check,
    providerSetup,
    replyToProbe(next: AuthState) {
      probeReply = next
    },
    rejected() {
      auth = REFUSED
      for (const listener of authListeners) listener({ provider: 'claude', what: 'login' })
    },
  }
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
async function screen() {
  await page.viewport(1280, 1000)
  const m = mount(
    ProvidersScreen,
    {
      capabilities: CAPABILITY_FIXTURE,
      warnings: { walls: [], unread: false },
      clock: Date.UTC(2026, 9, 30),
    },
    { width: 1180, height: 900 },
  )
  await settle()
  m.host
    .querySelector<HTMLButtonElement>('[data-cy="provider-row"][data-provider="claude"]')!
    .click()
  await settle()
  const login = m
    .q('provider-drawer')
    .querySelector<HTMLButtonElement>('button[aria-controls$="-login"]')!
  if (login.getAttribute('aria-expanded') !== 'true') login.click()
  await settle()
  return m
}
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

describe('Claude recovery in the real Providers drawer', () => {
  it('offers native Sign in again even while the local login still says Ready', async () => {
    const api = fixture()
    const m = await screen()
    expect(m.q('provider-standing').innerText).toBe('Ready')
    const action = m.q('native-sign-in-again') as HTMLButtonElement
    expect(visible(action)).toBe(true)
    expect(action.disabled).toBe(false)
    await drawnReady()
    assertDrawn(action, 'drawer Sign in again')
    if (import.meta.env.VITE_CLAUDE_CAPTURE)
      await page.screenshot({
        element: m.q('provider-drawer'),
        path: `${import.meta.env.VITE_CLAUDE_CAPTURE}/drawer-current.png`,
      })
    action.click()
    await settle()
    expect(api.providerSetup.signIn).toHaveBeenCalledExactlyOnceWith('claude')
    expect(m.q('native-sign-in-link').getAttribute('href')).toContain(
      'https://claude.ai/oauth/authorize',
    )
  })

  it('a rejection notice replaces Ready and keeps the native recovery action enabled', async () => {
    const api = fixture()
    const m = await screen()
    api.rejected()
    await settle()
    expect(m.q('provider-standing').innerText).not.toBe('Ready')
    const action = m.q('native-sign-in') as HTMLButtonElement
    expect(visible(action)).toBe(true)
    expect(action.innerText).toBe('Sign in again')
    expect(action.disabled).toBe(false)
    if (import.meta.env.VITE_CLAUDE_CAPTURE)
      await page.screenshot({
        element: m.q('provider-drawer'),
        path: `${import.meta.env.VITE_CLAUDE_CAPTURE}/drawer-rejected.png`,
      })
    action.click()
    await settle()
    expect(api.providerSetup.signIn).toHaveBeenCalledExactlyOnceWith('claude')
  })

  it('Check again probes once, shows the failed result and removes Ready', async () => {
    const api = fixture()
    const m = await screen()
    expect(api.check.mock.calls.every(([input]) => input.probe !== true)).toBe(true)
    api.replyToProbe({
      state: 'unknown',
      reason: 'Claude sign-in could not be verified. Try again or sign in again.',
    })
    const actions = m.q('native-sign-in-again').parentElement!
    const check = [...actions.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Check again',
    )!
    check.click()
    await settle()
    expect(api.check.mock.calls.filter(([input]) => input.probe === true)).toHaveLength(1)
    expect(api.check).toHaveBeenCalledWith({
      provider: 'claude',
      profileId: DEFAULT_PROFILE_ID,
      probe: true,
    })
    expect(m.q('provider-standing').innerText).not.toBe('Ready')
    expect(m.q('provider-auth-result').innerText).toContain('could not be verified')
    expect((m.q('native-sign-in') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a successful manual probe shows its result and restores Ready', async () => {
    const api = fixture()
    const m = await screen()
    api.rejected()
    await settle()
    api.replyToProbe(READY)
    const actions = m.q('native-sign-in').parentElement!
    const check = [...actions.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Check again',
    )!
    check.click()
    await settle()
    expect(api.check.mock.calls.filter(([input]) => input.probe === true)).toHaveLength(1)
    expect(m.q('provider-standing').innerText).toBe('Ready')
    expect(m.q('provider-auth-notice').innerText).toBe('Claude sign-in works.')
  })
})
