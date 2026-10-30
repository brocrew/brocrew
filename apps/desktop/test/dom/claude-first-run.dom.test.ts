import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import ProviderSetupWizard from '../../src/renderer/src/components/ProviderSetupWizard.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { wearTheme } from '../../look/fixtures/themes'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import type { ProviderVersion } from '../../src/shared/runtime-ipc'
import type { AuthState, ModelList } from '../../src/shared/runtime-ipc'
import type { ProviderSetupBridge, ProviderSetupState } from '../../src/shared/provider-setup'
import { mount, unmountAll } from './harness'
import { readsAt } from './what-is-painted-under'

const ABSENT: AuthState = { state: 'absent', why: 'no-login', reason: 'No fictional login.' }
const SIGNED_IN: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const GOOD: ModelList = {
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: [{ id: 'harbor-model', label: 'Harbor', efforts: [], addedBy: 'the-provider' }],
  lastPicked: null,
  startsOn: null,
}
const WARMING: ModelList = {
  ...GOOD,
  models: [],
  notAsked: { ok: false, reason: 'refused', detail: 'Fictional catalogue still warming up.' },
}
const MISSING: ProviderVersion = {
  version: null,
  reason: 'No fictional installed program.',
  program: {
    standing: 'missing',
    from: null,
    path: null,
    version: null,
    tested: { oldest: '2.1.280', newest: '2.1.305' },
    said: 'No fictional installed program.',
    help: null,
    update: null,
    others: [],
    updatedFrom: null,
  },
}
async function settle() {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}
function fixture(
  installed = false,
  persistentModelsFailure = false,
  slowRead = false,
  setupReady = true,
) {
  providersBridge(true)
  let auth: AuthState = ABSENT
  let finishState: (() => void) | undefined
  let afterSignIn = 0
  let snapshot: ProviderSetupState = {
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
  const listeners = new Set<(state: ProviderSetupState) => void>()
  function publish(patch: Partial<ProviderSetupState>) {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener(snapshot)
  }
  const bridge = {
    state: vi.fn(() => {
      const before = snapshot
      return slowRead
        ? new Promise<ProviderSetupState>((resolve) => {
            finishState = () => resolve(before)
          })
        : Promise.resolve(snapshot)
    }),
    onState: (listener: (state: ProviderSetupState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    install: vi.fn(async () => {
      publish({ phase: 'installing', progress: 'Downloading Claude Code…' })
      return { ok: true as const }
    }),
    signIn: vi.fn(async () => {
      publish({
        phase: 'signing-in',
        progress: 'Finish signing in in your browser.',
        authUrl: 'https://claude.ai/oauth/authorize?state=fictional-harbor',
      })
      return { ok: true as const }
    }),
    cancel: vi.fn(async () => {
      publish({ phase: 'cancelled', progress: 'Setup cancelled.' })
      return { ok: true as const }
    }),
  } satisfies ProviderSetupBridge
  const modelList = vi.fn(async () => {
    if (auth.state !== 'usable') return WARMING
    afterSignIn++
    return persistentModelsFailure || afterSignIn === 1 ? WARMING : GOOD
  })
  const legacySignIn = vi.fn(window.api.runtime.signInProvider)
  window.api = {
    ...window.api,
    providerSetup: bridge,
    runtime: {
      ...window.api.runtime,
      checkProviderAuth: async () => auth,
      modelList,
      signInProvider: legacySignIn,
    },
  }
  const readVersions = vi.fn<() => Promise<void>>(async () => {
    props.version = PROGRAM
  })
  const props = reactive({
    provider: 'claude' as const,
    capabilities: null,
    limit: null,
    limitsRead: true,
    clock: Date.now(),
    version: installed ? PROGRAM : MISSING,
    readings: [],
    resources: null,
    resourcesPaused: true,
    resourcesError: null,
    loginMoved: 0,
    lists: createModelLists(() => window.api.runtime),
    setupRequested: !installed,
    setup: setupReady
      ? {
          tool: 'Claude Code',
          install: {
            command: 'fictional installer',
            docs: 'https://code.claude.com/docs/en/setup',
          },
          signInCommand: 'fictional login',
          platform: 'macOS' as const,
          shell: 'Terminal' as const,
        }
      : undefined,
    readVersions,
  })
  const m = mount(
    defineComponent({ setup: () => () => h(ProviderCard, { ...props }) }),
    {},
    { width: 800, height: 1200 },
  )
  return {
    m,
    props,
    bridge,
    publish,
    readVersions,
    modelList,
    legacySignIn,
    signedIn: () => {
      auth = SIGNED_IN
    },
    finishState: () => finishState?.(),
  }
}

const PROGRAM: ProviderVersion = {
  version: '2.1.314',
  program: {
    standing: 'newer-than-tested',
    from: 'native-installer',
    path: '/Users/harbor/.local/bin/claude',
    version: '2.1.314',
    tested: { oldest: '2.1.280', newest: '2.1.305' },
    said: 'The fictional program is installed.',
    help: null,
    update: null,
    others: [],
    updatedFrom: null,
  },
}

afterEach(() => {
  unmountAll()
  applyTheme(null)
  Reflect.deleteProperty(window, 'api')
})

it.each(['classic', 'defined', 'crew-night'] as const)(
  'keeps the installed program location readable in %s',
  async (theme) => {
    providersBridge()
    if (theme === 'classic') applyTheme(null)
    else wearTheme(theme)
    const fixture = defineComponent({
      setup: () => () =>
        h('section', { 'data-on-white': '', style: 'background:var(--panel)' }, [
          h(ProviderCard, {
            provider: 'claude',
            capabilities: null,
            limit: null,
            limitsRead: true,
            clock: Date.now(),
            version: PROGRAM,
            readings: [],
            resources: null,
            resourcesPaused: true,
            resourcesError: null,
            loginMoved: 0,
            lists: createModelLists(() => window.api.runtime),
          }),
        ]),
    })
    const m = mount(fixture, {}, { width: 800, height: 1200 })
    const location = m.host.querySelector<HTMLDetailsElement>('.program-location')!
    location.open = true
    await vi.waitFor(() => expect(location.open).toBe(true))
    const path = m.host.querySelector<HTMLElement>('.program-full-path code')!
    const reading = await readsAt(path)
    console.info('program-location-cascade', {
      theme,
      background: getComputedStyle(location).backgroundColor,
      foreground: getComputedStyle(path).color,
      reading,
    })
    expect(reading.is).toBe('read')
    if (reading.is === 'read') expect(reading.ratio).toBeGreaterThanOrEqual(4.5)
  },
)

it('keeps connection controls hidden while installation details are still loading', async () => {
  const { m, modelList } = fixture(false, false, false, false)
  await settle()
  expect(m.host.textContent).toContain('Reading installation details…')
  for (const cy of ['provider-inline-setup', 'provider-key', 'provider-status', 'provider-version'])
    expect(m.all(cy)).toHaveLength(0)
  expect(modelList).not.toHaveBeenCalled()
})

it('shows the missing program first and alone even when setup was requested', async () => {
  const { m, modelList } = fixture()
  await settle()
  expect(m.q('install-missing').textContent?.trim()).toBe('Claude Code isn’t installed.')
  expect(m.q('install-program').textContent?.trim()).toBe('Install Claude Code')
  for (const cy of [
    'provider-inline-setup',
    'provider-key',
    'provider-status',
    'provider-version',
    'provider-usage',
    'provider-resources',
    'provider-models',
    'setup-command',
    'setup-check',
    'setup-sign-in',
  ])
    expect(m.all(cy)).toHaveLength(0)
  expect(modelList).not.toHaveBeenCalled()
})

it('runs one mocked installer gesture, reports progress, and cancels without a terminal', async () => {
  const { m, bridge } = fixture()
  await settle()
  m.q('install-program').click()
  await settle()
  expect(bridge.install).toHaveBeenCalledExactlyOnceWith('claude')
  expect(m.q('install-program').hasAttribute('disabled')).toBe(true)
  expect(m.q('install-progress').textContent).toContain('Downloading Claude Code')
  m.q('install-program').click()
  expect(bridge.install).toHaveBeenCalledTimes(1)
  m.q('install-cancel').click()
  await settle()
  expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith('claude')
  expect(m.all('setup-command')).toHaveLength(0)
})

it('shows real mocked installer error output and a separate installation-help link', async () => {
  const { m, publish } = fixture()
  await settle()
  m.q('install-program').click()
  await settle()
  publish({
    phase: 'failed',
    error: 'install-failed',
    progress: 'Installation failed.',
    details: 'curl: (22) The fictional server returned error: 403',
    exitCode: 22,
  })
  await settle()
  expect(m.q('install-error-output').textContent).toBe(
    'curl: (22) The fictional server returned error: 403',
  )
  expect(m.q('install-help').textContent?.trim()).toBe('How to install')
  expect(m.q('install-help').getAttribute('href')).toBe('https://code.claude.com/docs/en/setup')
  expect(m.all('provider-version')).toHaveLength(0)
})

it('automatically re-reads the program after installation and reveals connection steps', async () => {
  const { m, bridge, publish, readVersions } = fixture()
  await settle()
  m.q('install-program').click()
  await settle()
  publish({ phase: 'installed', progress: 'Claude Code is installed.', exitCode: 0 })
  await vi.waitFor(() => expect(m.all('provider-install')).toHaveLength(0))
  expect(bridge.install).toHaveBeenCalledTimes(1)
  expect(readVersions).toHaveBeenCalledTimes(1)
  expect(m.all('setup-sign-in')).toHaveLength(1)
  expect(m.all('provider-version')).toHaveLength(1)
})

it('uses CLI-owned browser sign-in and automatically retries a warming model catalogue', async () => {
  const { m, bridge, publish, signedIn, modelList, legacySignIn } = fixture(true)
  await settle()
  m.q('native-sign-in').click()
  await settle()
  expect(bridge.signIn).toHaveBeenCalledExactlyOnceWith('claude')
  expect(legacySignIn).not.toHaveBeenCalled()
  expect(m.q('native-sign-in-link').getAttribute('href')).toBe(
    'https://claude.ai/oauth/authorize?state=fictional-harbor',
  )
  signedIn()
  publish({ phase: 'signed-in', progress: 'Signed in.', authUrl: null, exitCode: 0 })
  await settle()
  expect(m.q('provider-models-said').textContent).toContain('Reading')
  expect(m.q('provider-models-said').textContent).not.toContain('Try again')
  await vi.waitFor(() => expect(m.all('provider-model-row')).toHaveLength(1))
  expect(modelList).toHaveBeenCalledTimes(3)
})

it('shows a persistent catalogue failure only after the bounded post-Check retries', async () => {
  const { m, signedIn, modelList } = fixture(true, true)
  signedIn()
  await settle()
  const check = [...m.host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Check again',
  )!
  const before = modelList.mock.calls.length
  check.click()
  await settle()
  expect(m.q('provider-models-said').textContent).toContain('Reading')
  expect(m.q('provider-models-said').textContent).not.toContain('Try again')
  await vi.waitFor(() => expect(m.q('provider-models-said').textContent).toContain('Try again'))
  expect(modelList).toHaveBeenCalledTimes(before + 3)
})

it('drops late setup completion after the card closes and cancels its own operation', async () => {
  const { m, bridge, publish, readVersions } = fixture()
  await settle()
  m.q('install-program').click()
  await settle()
  m.unmount()
  publish({ phase: 'installed', progress: 'Installed.', exitCode: 0 })
  await settle()
  expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith('claude')
  expect(readVersions).not.toHaveBeenCalled()
})

it('does not start a catalogue retry when a pending Check finishes after close', async () => {
  const { m, signedIn, modelList, readVersions } = fixture(true)
  await settle()
  signedIn()
  let finish: (() => void) | undefined
  readVersions.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const check = [...m.host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Check again',
  )!
  check.click()
  await settle()
  expect(readVersions).toHaveBeenCalledTimes(1)
  const before = modelList.mock.calls.length
  m.unmount()
  finish?.()
  await settle()
  expect(modelList).toHaveBeenCalledTimes(before)
})

it('never lets a late initial idle read erase newer installer progress', async () => {
  const { m, finishState } = fixture(false, false, true)
  await settle()
  m.q('install-program').click()
  await settle()
  finishState()
  await settle()
  expect(m.q('install-program').hasAttribute('disabled')).toBe(true)
  expect(m.q('install-progress').textContent).toContain('Downloading Claude Code')
})

it('uses the same missing-only installer in the first-run wizard, then advances automatically', async () => {
  const { props, publish, bridge } = fixture()
  const absent = { state: 'absent' as const, reason: 'The fictional tool owns its sign-in.' }
  const wizard = mount(
    defineComponent({
      setup: () => () =>
        h(ProviderSetupWizard, {
          provider: props.provider,
          version: props.version,
          setup: props.setup,
          auth: ABSENT,
          keyRefused: false,
          signIn: absent,
          reprovision: absent,
          busy: 'idle',
          notice: null,
          recheck: async () => {
            props.version = PROGRAM
          },
        }),
    }),
    {},
    { width: 800, height: 900 },
  )
  await settle()
  expect(wizard.all('setup-steps')).toHaveLength(0)
  expect(wizard.all('setup-command')).toHaveLength(0)
  expect(wizard.all('setup-next')).toHaveLength(0)
  expect(wizard.all('setup-use-key')).toHaveLength(0)
  wizard.q('install-program').click()
  await settle()
  publish({ phase: 'installed', progress: 'Installed.', exitCode: 0 })
  await vi.waitFor(() => expect(wizard.all('provider-install')).toHaveLength(0))
  expect(wizard.q('provider-setup-dialog').dataset.step).toBe('sign-in')
  wizard.q('native-sign-in').click()
  await settle()
  expect(bridge.signIn).toHaveBeenCalledExactlyOnceWith('claude')
  expect(wizard.all('setup-command')).toHaveLength(0)
  expect(wizard.all('native-sign-in-link')).toHaveLength(1)
})
