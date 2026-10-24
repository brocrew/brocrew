import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { userEvent } from 'vitest/browser'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import OverlayHost, { provideOverlayLayer } from '../../src/renderer/src/components/OverlayHost.vue'
import type { Provider } from '../../src/shared/runtime-ipc'
import { providersBridge } from '../../look/fixtures/providers'
import { useDebugMode } from '../../src/renderer/src/composables/useDebugMode'
import { mount, unmountAll, type Mounted } from './harness'

const NOW = Date.now()
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
beforeEach(() => {
  localStorage.clear()
  useDebugMode().value = false
  providersBridge()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})
const screen = (extra: Record<string, unknown> = {}, width = 1180) =>
  mount(
    ProvidersScreen,
    { capabilities: null, warnings: { walls: [], unread: false }, clock: NOW, ...extra },
    { width, height: 900 },
  )
const row = (m: Mounted, provider: string) => {
  const found = m.host.querySelector<HTMLButtonElement>(
    `[data-cy="provider-row"][data-provider="${provider}"]`,
  )
  expect(found, 'a provider gets a row').not.toBeNull()
  return found!
}

describe('the Providers list opens the existing controls in one drawer', () => {
  it('one Escape closes only the top dialog when a setup route arrives over another modal', async () => {
    const fixture = defineComponent({
      setup(_props, { expose }) {
        const layer = ref<HTMLElement | null>(null)
        const setup = ref<Provider | null>(null)
        const other = ref(true)
        provideOverlayLayer(layer)
        expose({
          route: () => {
            setup.value = 'codex'
          },
        })
        return () =>
          h('div', { style: 'display:flex;width:100%;height:100%' }, [
            h(ProvidersScreen, {
              setupProvider: setup.value,
              capabilities: null,
              warnings: null,
              clock: NOW,
            }),
            h('div', { ref: layer }),
            other.value
              ? h(
                  OverlayHost,
                  {
                    label: 'Other dialog',
                    onClose: () => {
                      other.value = false
                    },
                  },
                  () => h('button', 'Close other'),
                )
              : null,
          ])
      },
    })
    const m = mount(fixture, {}, { width: 1180, height: 900 })
    await settle()
    ;(m.vm['route'] as () => void)()
    await settle()
    expect(m.host.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    await userEvent.keyboard('{Escape}')
    await settle()
    const remaining = m.host.querySelectorAll('[role="dialog"]')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(m.host.querySelectorAll('[role="dialog"]')).toHaveLength(0)
  })
  it('draws descriptor rows with counts and the tightest usage reading, without cards on the page', async () => {
    const m = screen()
    await settle()
    expect(m.all('provider-row')).toHaveLength(PROVIDER_DESCRIPTORS.length)
    expect(row(m, 'claude').textContent).toContain('3 agents running')
    expect(row(m, 'claude').textContent).toContain('Weekly limit: 67% used')
    expect(row(m, 'claude').textContent).not.toContain('5-hour limit: 42%')
    expect(row(m, 'codex').textContent).toContain('1 agent running')
    expect(m.all('provider-card')).toHaveLength(0)
  })
  it('adds a made-up descriptor row and letter mark without another UI branch', async () => {
    const check = window.api.runtime.checkProviderAuth
    window.api.runtime.checkProviderAuth = async (asked) =>
      (asked.provider as string) === 'fable'
        ? { state: 'absent', reason: 'No fictional sign-in.', why: 'no-login' }
        : check(asked)
    const cedar = {
      ...PROVIDER_DESCRIPTORS[0],
      id: 'fable',
      displayName: 'Fable',
      debugOnly: false,
    }
    const m = screen({ descriptors: [...PROVIDER_DESCRIPTORS, cedar] })
    await settle()
    expect(m.all('provider-row')).toHaveLength(3)
    expect(row(m, 'fable').textContent).toContain('Fable')
    expect(row(m, 'fable').querySelector('[data-provider-mark="fable"]')?.textContent).toContain(
      'F',
    )
    row(m, 'fable').click()
    await settle()
    expect(m.q('provider-drawer').textContent).toContain('Fable')
    expect(m.q('provider-card').getAttribute('data-provider')).toBe('fable')
    expect(m.q('kept-rules-provider').getAttribute('data-provider')).toBe('fable')
    expect(m.q('kept-rules-provider').querySelector('h3')?.textContent).toBe('Fable')
    expect(m.q('kept-rules-none').textContent).toContain('None kept.')
  })
  it('opens the reused card and only that provider’s kept rules, then restores focus on Escape', async () => {
    const check = vi.spyOn(window.api.runtime, 'checkProviderAuth')
    const key = vi.spyOn(window.api.runtime, 'apiKeyStatus')
    const m = screen()
    await settle()
    const before = check.mock.calls.length
    const keysBefore = key.mock.calls.length
    row(m, 'claude').focus()
    row(m, 'claude').click()
    await settle()
    const dialog = m.q('provider-drawer')
    expect(dialog.closest('[role="dialog"]')).not.toBeNull()
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(dialog.querySelector('[data-cy="provider-card"][data-provider="claude"]')).not.toBeNull()
    expect(dialog.querySelector('[data-cy="provider-card"][data-provider="codex"]')).toBeNull()
    expect(dialog.textContent).toContain('Kept rules')
    expect(dialog.querySelectorAll('[data-cy="kept-rules-provider"]')).toHaveLength(1)
    expect(
      dialog.querySelector('[data-cy="kept-rules-provider"]')?.getAttribute('data-provider'),
    ).toBe('claude')
    expect(check.mock.calls).toHaveLength(before)
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(m.host.querySelector('[data-cy="provider-drawer"]')).toBeNull()
    expect(document.activeElement).toBe(row(m, 'claude'))
    row(m, 'claude').click()
    await settle()
    expect(check).toHaveBeenCalledTimes(before)
    expect(key).toHaveBeenCalledTimes(keysBefore)
  })
  it('puts setup first when signed out, without a tested-version badge or repeated instruction', async () => {
    providersBridge(true)
    const m = screen()
    await settle()
    expect(row(m, 'claude').textContent).toContain('Needs setup')
    row(m, 'claude').click()
    await settle()
    const dialog = m.q('provider-drawer')
    expect(dialog.querySelector('[data-cy="provider-inline-setup"]')).not.toBeNull()
    expect(dialog.textContent).not.toContain('Tested version')
    expect(dialog.textContent?.match(/Sign in or use an API key\./g)).toHaveLength(1)
  })
  it('moves Set up into the options menu after the provider is Ready', async () => {
    const m = screen()
    await settle()
    row(m, 'claude').click()
    await settle()
    const dialog = m.q('provider-drawer')
    expect(dialog.querySelector('[data-cy="provider-set-up"]')).toBeNull()
    m.q('provider-options').click()
    await settle()
    m.q('provider-set-up').focus()
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(dialog.querySelector('[data-cy="provider-inline-setup"]')).not.toBeNull()
    expect(m.q('provider-inline-setup').contains(document.activeElement)).toBe(true)
  })
  it('a login notice updates the row without restarting setup inside an open drawer', async () => {
    let changed: Parameters<typeof window.api.runtime.onProvidersChanged>[0] = () => {}
    window.api.runtime.onProvidersChanged = (listener) => {
      changed = listener
      return () => {}
    }
    const original = window.api.runtime.checkProviderAuth
    let signedOut = false
    window.api.runtime.checkProviderAuth = (asked) =>
      signedOut
        ? Promise.resolve({ state: 'absent', reason: 'No fictional login.', why: 'no-login' })
        : original(asked)
    const check = vi.spyOn(window.api.runtime, 'checkProviderAuth')
    const key = vi.spyOn(window.api.runtime, 'apiKeyStatus')
    const m = screen()
    await settle()
    row(m, 'claude').click()
    await settle()
    expect(m.host.querySelector('[data-cy="provider-inline-setup"]')).toBeNull()
    signedOut = true
    changed({ what: 'login', provider: 'claude' })
    await settle()
    expect(row(m, 'claude').textContent).toContain('Needs setup')
    expect(check).toHaveBeenCalledTimes(3)
    expect(key).toHaveBeenCalledTimes(3)
    expect(m.host.querySelector('[data-cy="provider-inline-setup"]')).toBeNull()
    await userEvent.keyboard('{Escape}')
    await settle()
    row(m, 'claude').click()
    await settle()
    expect(m.q('provider-inline-setup')).toBeDefined()
  })
  it('discards an unsaved fictional key draft when the drawer closes', async () => {
    providersBridge(true)
    const save = vi.spyOn(window.api.runtime, 'setApiKey')
    const m = screen()
    await settle()
    row(m, 'claude').click()
    await settle()
    m.q('setup-use-key').click()
    await settle()
    await userEvent.fill(m.q('setup-key-input'), 'fictional-draft-only')
    await userEvent.keyboard('{Escape}')
    await settle()
    row(m, 'claude').click()
    await settle()
    m.q('setup-use-key').click()
    await settle()
    expect((m.q('setup-key-input') as HTMLInputElement).value).toBe('')
    expect(save).not.toHaveBeenCalled()
  })
  it('reads kept rules once per opening and refreshes after removal', async () => {
    const read = vi.spyOn(window.api.runtime, 'keptRules')
    const remove = vi.spyOn(window.api.runtime, 'removeKeptRule')
    const m = screen()
    await settle()
    expect(read).not.toHaveBeenCalled()
    row(m, 'claude').click()
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    m.q('kept-rule-remove').click()
    await settle()
    expect(remove).toHaveBeenCalledWith({
      provider: 'claude',
      file: '/Users/someone/work/site/.claude/settings.local.json',
      kept: 'Bash(npm run test:*)',
    })
    expect(read).toHaveBeenCalledTimes(2)
    await userEvent.keyboard('{Escape}')
    await settle()
    row(m, 'codex').click()
    await settle()
    expect(read).toHaveBeenCalledTimes(3)
    expect(m.all('kept-rules-provider')).toHaveLength(1)
    expect(m.q('kept-rules-provider').getAttribute('data-provider')).toBe('codex')
  })
  it('uses At its limit for a stopped signed-in provider and Couldn’t check for unknown auth', async () => {
    const runtime = window.api.runtime
    const original = runtime.checkProviderAuth
    runtime.checkProviderAuth = async (asked) =>
      asked.provider === 'codex'
        ? { state: 'unknown', reason: 'The fictional service did not answer.' }
        : original(asked)
    const m = screen({
      warnings: {
        walls: [{ provider: 'claude', standing: 'stopped', resetsAt: NOW + 3600000, said: [] }],
        unread: false,
      },
    })
    await settle()
    expect(row(m, 'claude').textContent).toContain('At its limit')
    expect(row(m, 'claude').textContent).not.toContain('Ready')
    expect(row(m, 'codex').textContent).toContain("Couldn't check")
  })
  it('opens the requested setup provider through the existing Settings route', async () => {
    const m = screen({ setupProvider: 'codex' })
    await settle()
    expect(m.q('provider-drawer').textContent).toContain('Codex')
    expect(m.q('provider-inline-setup')).toBeDefined()
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(document.activeElement).toBe(row(m, 'codex'))
  })
})
