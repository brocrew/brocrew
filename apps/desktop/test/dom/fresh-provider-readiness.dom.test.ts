import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import RuntimeScreen from '../../src/renderer/src/components/RuntimeScreen.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { forgetProfileSignIns } from '../../src/renderer/src/composables/useProfileSignIn'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { providersBridge } from '../../look/fixtures/providers'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import type {
  AgentIdentities,
  AuthState,
  CreatedSession,
  CreateSessionInput,
  ModelList,
  Provider,
  RefusedLaunch,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import type { ProviderSetupBridge, ProviderSetupState } from '../../src/shared/provider-setup'
import { mount, unmountAll, META } from './harness'

let sessions: SessionStore
let agents: ReturnType<typeof createAgentStore>
let lists: ReturnType<typeof createModelLists>
vi.mock('../../src/renderer/src/composables/useSessionStore', () => ({
  useSessionStore: () => sessions,
}))
vi.mock('../../src/renderer/src/composables/useAgentStore', () => ({ useAgentStore: () => agents }))
vi.mock('../../src/renderer/src/composables/useModelLists', () => ({ useModelLists: () => lists }))

const ABSENT: AuthState = { state: 'absent', why: 'no-login', reason: 'No fictional sign-in.' }
const READY: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const identities: AgentIdentities = {
  identities: [],
  use: [],
  foldersWithoutARow: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  defaultApprovalModeChosen: true,
  externalMcpServers: [],
}
const walk = () => ({
  rows: [],
  walk: 'every-conversation-that-routed' as const,
  ledgers: 0,
  rowsUnread: 0,
})
async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((done) => setTimeout(done, 0))
    await nextTick()
  }
}
function catalogue(provider: Provider, ready: boolean): ModelList {
  return {
    provider,
    standIn: null,
    lastPicked: null,
    notAsked: ready ? null : { ok: false, reason: 'refused', detail: 'Not signed in.' },
    models: ready
      ? [
          {
            id: 'harbor-default',
            label: 'Harbor',
            isDefault: true,
            addedBy: 'the-provider',
            efforts: [],
          },
        ]
      : [],
    startsOn: ready ? { model: 'harbor-default', effort: null, from: 'its-default' } : null,
  }
}
function fixture(claudeReady = false, holdFirstUsage = false) {
  providersBridge()
  let signedIn = claudeReady
  const listeners = new Set<Parameters<RuntimeBridge['onProvidersChanged']>[0]>()
  const setupListeners = new Set<Parameters<ProviderSetupBridge['onState']>[0]>()
  let setup: ProviderSetupState = {
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
  const publish = (patch: Partial<ProviderSetupState>) => {
    setup = { ...setup, ...patch }
    for (const one of setupListeners) one(setup)
  }
  const providerSetup: ProviderSetupBridge = {
    state: async () => setup,
    onState: (one) => {
      setupListeners.add(one)
      return () => {
        setupListeners.delete(one)
      }
    },
    install: vi.fn<ProviderSetupBridge['install']>(async () => ({ ok: true })),
    signIn: vi.fn<ProviderSetupBridge['signIn']>(async () => {
      publish({ phase: 'signing-in', progress: 'Finish signing in in your browser.' })
      return { ok: true }
    }),
    cancel: vi.fn<ProviderSetupBridge['cancel']>(async () => {
      publish({ phase: 'cancelled', progress: 'Setup cancelled.' })
      return { ok: true }
    }),
  }
  const versions = window.api.runtime.providerVersions
  const checkAuth = vi.fn<RuntimeBridge['checkProviderAuth']>(async ({ provider }) =>
    provider === 'claude' && signedIn ? READY : ABSENT,
  )
  const create = vi.fn<(input: CreateSessionInput) => void>()
  function createSession<Asked extends true | undefined = undefined>(
    input: CreateSessionInput & { readonly answerARefusal?: Asked },
  ): Promise<Asked extends true ? CreatedSession | RefusedLaunch : CreatedSession>
  async function createSession(input: CreateSessionInput): Promise<CreatedSession> {
    create(input)
    return {
      ...META,
      sessionId: 'fictional-claude',
      provider: input.provider,
      profileId: 'default',
    }
  }
  const send = vi.fn<RuntimeBridge['send']>(async () => {})
  let usageReads = 0
  let releaseUsage: (() => void) | undefined
  const usage = vi.fn<RuntimeBridge['providerUsage']>(async () => {
    const authenticated = signedIn
    if (++usageReads === 1 && holdFirstUsage)
      await new Promise<void>((resolve) => {
        releaseUsage = resolve
      })
    return {
      claude: authenticated
        ? [{ window: 'five_hour', usedPercent: 28, resetsAt: null, at: Date.now() }]
        : [],
      codex: [],
    }
  })
  window.api = {
    ...window.api,
    providerSetup,
    getAppInfo: async () => ({
      name: 'Fictional BroCrew',
      windowTitle: 'Fictional BroCrew',
      version: '0.0.0',
      step: 'test',
      workspace: { name: 'Harbor', path: '/fictional/harbor', isDefault: false },
      build: { id: 'test', commit: '', dirty: false, branches: null },
      db: { migrationsApplied: 0, providerSessionCount: 0 },
    }),
    onNavigate: () => () => {},
    runtime: {
      ...window.api.runtime,
      checkProviderAuth: checkAuth,
      onEvent: () => () => {},
      onLiveness: () => () => {},
      onChanged: () => () => {},
      onStates: () => () => {},
      onLimitsDisplayChanged: () => () => {},
      onProvidersChanged: (one) => {
        listeners.add(one)
        return () => {
          listeners.delete(one)
        }
      },
      attachOpen: async () => [],
      listResumable: async () => [],
      listUnresumable: async () => [],
      agentIdentities: async () => identities,
      profiles: async () => [],
      capabilities: async () => CAPABILITY_FIXTURE,
      providerVersions: versions,
      modelList: async ({ provider }) => catalogue(provider, provider === 'claude' && signedIn),
      providerUsage: usage,
      questionsForAPerson: async () => walk(),
      decisionsForAPerson: async () => walk(),
      stalledWorkForAPerson: async () => walk(),
      stoppedWorkForAPerson: async () => walk(),
      workIncidentsForAPerson: async () => walk(),
      waitingOnWhoWroteForAPerson: async () => walk(),
      instructionAsksForAPerson: async () => [],
      mcpServerRequestsForAPerson: async () => [],
      readLimitsDisplay: async () => ({ is: 'unavailable', databaseEpoch: 1, signInEpoch: 1 }),
      readWorkspace: async () => ({ readAt: 1, needsYou: { counted: 'in-full', count: 0 } }),
      whatEachConversationIsWaitingOn: async () => ({
        readAt: 1,
        conversations: [],
        rowsUnread: 0,
      }),
      whatIsBeingDone: async () => ({ readAt: 1, conversations: [] }),
      theWholeForest: async () => ({
        readAt: 1,
        nodes: { ...walk(), walk: 'every-conversation-this-app-placed' },
        conversations: 0,
        heldByNoAgent: 0,
      }),
      createSession,
      send,
    },
  }
  sessions = createSessionStore(window.api.runtime)
  agents = createAgentStore(window.api.runtime)
  lists = createModelLists(() => window.api.runtime)
  const screen = mount(RuntimeScreen, {}, { width: 1440, height: 1200 })
  return {
    screen,
    create,
    send,
    providerSetup,
    checkAuth,
    usage,
    listeners,
    releaseUsage: () => releaseUsage?.(),
    fail() {
      publish({ phase: 'failed', progress: '', error: 'login-failed' })
    },
    complete(authenticated = true) {
      signedIn = authenticated
      for (const one of listeners) one({ what: 'login', provider: 'claude' })
      publish({ phase: 'signed-in', progress: 'Claude Code signed in.', error: null })
    },
  }
}
afterEach(() => {
  unmountAll()
  sessions?.dispose()
  forgetProfileSignIns()
  useOverlays().close()
  localStorage.clear()
})

it('starts on Claude and sends when only Claude is ready on a fresh profile', async () => {
  const { screen, create, send } = fixture(true)
  await settle()
  screen.q('new-conversation').click()
  await settle()
  const composer =
    screen.host.querySelector<HTMLTextAreaElement>('textarea[data-cy="prompt-input"]') ??
    screen.host.querySelector<HTMLTextAreaElement>('textarea')!
  composer.value = 'Review the fictional Harbor plan.'
  composer.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  screen.q('send-prompt').click()
  await settle()
  expect(create).toHaveBeenCalledOnce()
  expect(create.mock.calls[0]?.[0].provider).toBe('claude')
  expect(send).toHaveBeenCalledOnce()
})
it('shows one clear provider setup action and no unavailable current provider when none is ready', async () => {
  const { screen } = fixture()
  await settle()
  screen.q('new-conversation').click()
  await settle()
  const action = screen.q('new-provider-setup')
  expect(action.textContent?.trim()).toBe('Set up a provider')
  expect(screen.all('provider-chip')).toHaveLength(0)
  expect(screen.all('model-picker-face')).toHaveLength(0)
  expect(screen.all('send-prompt')).toHaveLength(0)
  action.click()
  await settle()
  expect(screen.all('provider-drawer')).toHaveLength(0)
  expect(screen.all('provider-row')).toHaveLength(2)
})
it('refreshes Claude across the real window after native browser sign-in completes without remount', async () => {
  const { screen, providerSetup, complete, usage } = fixture()
  await settle()
  screen.host
    .querySelector<HTMLButtonElement>('[data-cy="provider-row"][data-provider="claude"]')!
    .click()
  await settle()
  screen.q('setup-sign-in').click()
  await settle()
  expect(providerSetup.signIn).toHaveBeenCalledExactlyOnceWith('claude')
  complete()
  await settle()
  expect(screen.q('provider-standing').textContent).toContain('Ready')
  screen.q('new-conversation').click()
  await settle()
  expect(screen.q('provider-chip').textContent).toContain('Claude · Ready')
  screen.q('model-picker-face').click()
  await settle()
  expect(screen.q('model-picker-choose-claude').closest('label')?.textContent).toContain(
    'Claude · Ready',
  )
  expect(screen.q('app-usage').textContent).toContain('Claude · Ready')
  expect(screen.q('app-usage').textContent).toContain('5h 28%')
  expect(usage.mock.calls.length).toBeGreaterThan(1)
})

it('does not treat an open browser, failure or cancellation as a ready provider', async () => {
  const { screen, providerSetup, fail } = fixture()
  await settle()
  await providerSetup.signIn('claude')
  screen.q('new-conversation').click()
  await settle()
  expect(screen.q('new-provider-setup').textContent).toContain('Set up a provider')
  expect(screen.all('provider-chip')).toHaveLength(0)
  fail()
  await settle()
  expect(screen.q('new-provider-setup').textContent).toContain('Set up a provider')
  await providerSetup.cancel('claude')
  await settle()
  expect(screen.q('app-usage').textContent).toContain('Claude · Needs setup')
  expect(screen.all('send-prompt')).toHaveLength(0)
})

it('rechecks the real auth answer rather than trusting a signed-in setup phase', async () => {
  const { screen, complete } = fixture()
  await settle()
  complete(false)
  screen.q('new-conversation').click()
  await settle()
  expect(screen.q('new-provider-setup').textContent).toContain('Set up a provider')
  expect(screen.q('app-usage').textContent).toContain('Claude · Needs setup')
  expect(screen.all('provider-chip')).toHaveLength(0)
})

it('releases provider notices with the window so late completion cannot refresh a closed screen', async () => {
  const { complete, checkAuth, listeners } = fixture()
  await settle()
  expect(listeners.size).toBeGreaterThan(0)
  unmountAll()
  expect(listeners.size).toBe(0)
  const checked = checkAuth.mock.calls.length
  complete()
  await settle()
  expect(checkAuth.mock.calls).toHaveLength(checked)
})

it('keeps the post-login usage answer when an older signed-out read arrives late', async () => {
  const { screen, complete, releaseUsage } = fixture(false, true)
  await settle()
  complete()
  await settle()
  expect(screen.q('app-usage').textContent).toContain('5h 28%')
  releaseUsage()
  await settle()
  expect(screen.q('app-usage').textContent).toContain('5h 28%')
})
