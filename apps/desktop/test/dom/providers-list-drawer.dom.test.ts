import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { userEvent } from 'vitest/browser'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
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
    const cedar = {
      ...PROVIDER_DESCRIPTORS[0],
      id: 'cedar',
      displayName: 'Cedar',
      debugOnly: false,
    }
    const m = screen({ descriptors: [...PROVIDER_DESCRIPTORS, cedar] })
    await settle()
    expect(m.all('provider-row')).toHaveLength(3)
    expect(row(m, 'cedar').textContent).toContain('Cedar')
    expect(row(m, 'cedar').querySelector('[data-provider-mark="cedar"]')?.textContent).toContain(
      'C',
    )
  })
  it('opens the reused card and only that provider’s kept rules, then restores focus on Escape', async () => {
    const check = vi.spyOn(window.api.runtime, 'checkProviderAuth')
    const m = screen()
    await settle()
    const before = check.mock.calls.length
    row(m, 'claude').focus()
    row(m, 'claude').click()
    await settle()
    const dialog = m.q('provider-drawer')
    expect(dialog.closest('[role="dialog"]')).not.toBeNull()
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(dialog.querySelector('[data-cy="provider-card"][data-provider="claude"]')).not.toBeNull()
    expect(dialog.querySelector('[data-cy="provider-card"][data-provider="codex"]')).toBeNull()
    expect(dialog.textContent).toContain('Kept rules')
    expect(check.mock.calls).toHaveLength(before)
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(m.host.querySelector('[data-cy="provider-drawer"]')).toBeNull()
    expect(document.activeElement).toBe(row(m, 'claude'))
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
    m.q('provider-set-up').click()
    await settle()
    expect(dialog.querySelector('[data-cy="provider-inline-setup"]')).not.toBeNull()
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
  })
})
