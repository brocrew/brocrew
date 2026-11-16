import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { AppInfo } from '@brobot2/shared'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import SignInPanel from '../../src/renderer/src/components/SignInPanel.vue'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { railFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { attributedUsageFixtures, runningSignInFixtures } from './provider-launch.fixture'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'
import { assertDrawn, drawnReady } from './drawn'

afterEach(() => {
  unmountAll()
  railFacts().update({ runningConversations: null })
  vi.unstubAllEnvs()
})
const info: AppInfo = {
  name: 'BroCrew',
  windowTitle: 'BroCrew',
  workspace: { name: 'Bakery', path: '/fictional/bakery', isDefault: false },
  version: '0.1.5',
  step: '',
  build: {
    id: 'a1b2c3d',
    commit: 'a1b2c3d'.padEnd(40, '0'),
    dirty: false,
    branches: [{ name: 'meadow', tip: 'b2c3d4e', held: true }],
  },
  db: { migrationsApplied: 7, providerSessionCount: 0 },
}
async function settle() {
  for (let index = 0; index < 5; index++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  await drawnReady()
}
it.each([true, false])('shows build diagnostics only in development (%s)', async (development) => {
  providersBridge()
  vi.stubEnv('DEV', development)
  const m = mount(AppTitleBar, { info, error: null }, { width: 1180, height: 32 })
  await settle()
  expect(m.all('build-line')).toHaveLength(development ? 1 : 0)
  expect(m.all('app-info')).toHaveLength(development ? 1 : 0)
  expect(m.host.textContent).not.toContain('Saved locally')
  expect(m.host.querySelector('.sync-dot')).toBeNull()
  if (development) {
    expect(m.q('build-line').textContent).toContain('a1b2c3d · schema 7')
    expect(m.q('build-line').getAttribute('title')).toContain('meadow')
  } else {
    expect(m.host.textContent).not.toMatch(/a1b2c3d|schema|meadow/)
  }
})

it.each([true, false])(
  'shows startup errors independently of build diagnostics (%s)',
  async (development) => {
    providersBridge()
    vi.stubEnv('DEV', development)
    for (const read of [null, info]) {
      const m = mount(
        AppTitleBar,
        { info: read, error: 'Could not read capabilities' },
        { width: 1180, height: 32 },
      )
      await settle()
      expect(m.q('startup-error').textContent).toBe('Could not read capabilities')
      expect(m.all('build-line')).toHaveLength(development && read ? 1 : 0)
      m.unmount()
    }
    const empty = mount(AppTitleBar, { info: null, error: null }, { width: 1180, height: 32 })
    expect(empty.all('app-info')).toHaveLength(0)
  },
)

it('explains unknown title-bar usage through its tooltip and accessible name', async () => {
  providersBridge()
  const readingRows = attributedUsageFixtures(await window.api.runtime.providerUsage())
  window.api.runtime.providerUsage = async () => ({
    claude: readingRows.claude.map((row) => ({ ...row, usedPercent: null })),
    codex: readingRows.codex.map((row) => ({ ...row, usedPercent: null })),
  })
  railFacts().update({ runningConversations: runningSignInFixtures() })
  const m = mount(AppTitleBar, { info: null, error: null }, { width: 1180, height: 32 })
  await settle()
  const usage = m.q('app-usage')
  expect(usage.textContent).toBe('Claude 5h ? · week ? · Codex week ? · 2 agents · 0 working · ?')
  assertDrawn(usage, 'unknown usage', m.host)
  expect(usage.scrollWidth).toBeLessThanOrEqual(usage.clientWidth + 1)
  expect(usage.title).toContain('Claude 5h ? · week ? · Codex week ?')
  for (const words of [
    'Claude 5-hour usage: unknown',
    'Claude weekly usage: unknown',
    'Codex weekly usage: unknown',
  ]) {
    expect(usage.getAttribute('title')).toContain(words)
    expect(usage.getAttribute('aria-label')).toContain(words)
  }
})

it('explains the provider connection and the empty API key in plain words', async () => {
  providersBridge()
  const m = mount(
    ProvidersScreen,
    { capabilities: CAPABILITY_FIXTURE, warnings: null, clock: Date.now() },
    { width: 1180, height: 1000 },
  )
  await settle()
  assertDrawn(m.q('providers-screen'), 'Providers page', m.host)
  expect(m.host.textContent).toContain(
    'Connect an AI service to start a conversation. Check your account and connection below.',
  )
  // Each provider's existing explanation is now read inside its selected drawer.
  for (const provider of ['claude', 'codex']) {
    const row = m.host.querySelector<HTMLButtonElement>(
      `[data-cy="provider-row"][data-provider="${provider}"]`,
    )
    expect(row).not.toBeNull()
    row!.click()
    await settle()
    expect(m.q('provider-card').getAttribute('data-provider')).toBe(provider)
    const key = m.q('provider-key')
    expect(
      key.closest('[data-cy="provider-connection"]')?.querySelector('.meta')?.textContent,
    ).toContain('API key')
    expect(key.querySelector('button.fold')).toBeNull()
    assertDrawn(key, `${provider} API key entry`, m.host)
    expect(m.all('provider-key-none')).toHaveLength(0)
    const field = m.q('provider-key-input') as HTMLInputElement
    assertDrawn(field, `${provider} API key paste field`, m.host)
    expect(field.placeholder).toContain('API key')
    expect(field.value).toBe('')
    m.q('provider-drawer').querySelector<HTMLButtonElement>('.drawer-close')!.click()
    await settle()
    expect(m.all('provider-card')).toHaveLength(0)
  }
})

it.each(['claude', 'codex'] as const)('names %s in each sign-in state', async (provider) => {
  const service = provider === 'claude' ? 'Claude' : 'Codex'
  for (const [state, words] of [
    ['absent', `Sign in to use ${service} with this agent`],
    ['stale', `Sign in again to use ${service} with this agent`],
    ['unknown', `Couldn't check this agent's ${service} sign-in`],
  ] as const) {
    const m = mount(
      SignInPanel,
      {
        provider,
        displayName: service,
        state: { state, reason: 'Try signing in.' },
        signIn: { state: 'available' },
        reprovision: { state: 'available' },
        busy: 'idle',
        notice: null,
      },
      { width: 440, height: 450 },
    )
    await settle()
    expect(m.q('sign-in-heading').textContent).toBe(words)
    expect(m.q('sign-in-start').textContent?.trim()).toBe('Sign in for this agent')
    expect(m.q('sign-in-caveat').textContent?.replace(/\s+/g, ' ').trim()).toBe(
      "Sign in here to keep this agent's login separate. Copying your computer's existing login is quicker, but either login may stop working when the other refreshes.",
    )
    unmountAll()
  }
})
