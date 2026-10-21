import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { AppInfo } from '@brobot2/shared'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import SignInPanel from '../../src/renderer/src/components/SignInPanel.vue'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'
import { assertDrawn } from './drawn'

afterEach(() => {
  unmountAll()
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
}
it.each([true, false])('shows build diagnostics only in development (%s)', async (development) => {
  providersBridge()
  vi.stubEnv('DEV', development)
  const m = mount(AppTitleBar, { info, error: null }, { width: 1180, height: 32 })
  await settle()
  expect(m.all('build-line')).toHaveLength(development ? 1 : 0)
  expect(m.q('app-info').textContent).toContain('Saved locally')
  if (development) {
    expect(m.q('build-line').textContent).toContain('a1b2c3d · schema 7')
    expect(m.q('build-line').getAttribute('title')).toContain('meadow')
  } else {
    expect(m.q('app-info').textContent).not.toMatch(/a1b2c3d|schema|meadow/)
  }
})

it('explains unknown title-bar usage through its tooltip and accessible name', async () => {
  providersBridge()
  window.api.runtime.providerUsage = async () => ({ claude: [], codex: [] })
  const m = mount(AppTitleBar, { info: null, error: null }, { width: 1180, height: 32 })
  await settle()
  const usage = m.q('app-usage')
  expect(usage.textContent).toContain('Claude 5h ? · week ? · Codex week ?')
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
  const empty = m.all('provider-key-none')
  expect(empty).toHaveLength(2)
  for (const line of empty)
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'No API key saved. You can sign in instead. If you save a key, new conversations will use it instead of your signed-in account.',
    )
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
