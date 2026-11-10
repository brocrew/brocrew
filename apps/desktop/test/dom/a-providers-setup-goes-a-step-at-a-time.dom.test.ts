import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, type Component } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import ProviderSetupAtLaunch from '../../src/renderer/src/components/ProviderSetupAtLaunch.vue'
import { useKeyAsked } from '../../src/renderer/src/composables/useKeyAsked'
import { forgetProfileSignIns } from '../../src/renderer/src/composables/useProfileSignIn'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { ProviderSetupSays } from '../../src/renderer/src/lib/provider-setup'
import type {
  ApiKeyStatus,
  RuntimeBridge,
  AuthState,
  CapabilityStatus,
  ProviderCapabilityMap,
  ProviderProgram,
  ProviderProgramStanding,
  ProviderVersion,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/** Live launch routing and inline provider setup. */

const readiness = vi.hoisted(() => ({
  seen: vi.fn<(facts: { keyUnreadable?: string | null }) => void>(),
}))
vi.mock('../../src/renderer/src/lib/provider-setup-steps', async (original) => {
  const actual = await original<typeof import('../../src/renderer/src/lib/provider-setup-steps')>()
  return {
    ...actual,
    isReady: (facts: Parameters<typeof actual.isReady>[0]) => {
      readiness.seen(facts)
      return actual.isReady(facts)
    },
  }
})

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

const settled = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

const memoryStorage = (): Storage => {
  const kept = new Map<string, string>()
  return {
    get length() {
      return kept.size
    },
    clear: () => kept.clear(),
    getItem: (key: string) => kept.get(key) ?? null,
    key: (index: number) => [...kept.keys()][index] ?? null,
    removeItem: (key: string) => void kept.delete(key),
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
  }
}

let copied: string[] = []
let storage: Storage

beforeEach(async () => {
  readiness.seen.mockClear()
  copied = []
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (words: string): Promise<void> => {
        copied.push(words)
      },
    },
  })
  await page.viewport(1440, 1000)
})

afterEach(async () => {
  useKeyAsked().value = null
  unmountAll()
  usePersonsQueue().forget()
  forgetProfileSignIns()
  Reflect.deleteProperty(navigator, 'clipboard')
  delete (window as unknown as { api?: unknown }).api
  vi.unstubAllGlobals()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ------------------------------------------------------------------ facts */

const SETUP: ProviderSetupSays = {
  tool: 'The Tool',
  install: {
    command: 'curl -fsSL https://example.com/install.sh | bash',
    docs: 'https://example.com/docs',
  },
  signInCommand: 'the-tool',
  platform: 'macOS',
  shell: 'Terminal',
}

function version(
  standing: ProviderProgramStanding,
  from: ProviderProgram['from'] = 'native-installer',
  update: ProviderProgram['update'] = null,
): ProviderVersion {
  const program: ProviderProgram = {
    standing,
    from: standing === 'missing' ? null : from,
    path: standing === 'missing' ? null : '/Users/someone/.local/bin/the-tool',
    version: standing === 'missing' || standing === 'unreadable' ? null : '2.1.300',
    tested: from === 'carried' ? null : { oldest: '2.1.257', newest: '2.1.290' },
    said: 'said by main',
    help: from === 'carried' ? null : { label: 'How to update', url: 'https://example.com/help' },
    update,
    others: [],
    updatedFrom: null,
  }
  return program.version === null
    ? { version: null, reason: 'It did not say.', program }
    : { version: program.version, program }
}

const SIGNED_IN: AuthState = { state: 'usable', login: 'account', plan: 'max', expiresAt: null }
const ON_A_KEY: AuthState = { state: 'usable', login: 'api-key', expiresAt: null }
const SIGNED_OUT: AuthState = { state: 'absent', reason: 'Never signed in here.', why: 'no-login' }

const ABSENT: CapabilityStatus = {
  state: 'absent',
  reason: 'It signs in with its own command.',
  checkedAgainst: 'test',
}
const AVAILABLE: CapabilityStatus = { state: 'available' }

function theBridge(over: {
  claude: ProviderVersion
  claudeAuth: AuthState
  codexAuth: AuthState
  codexKey?: Partial<ApiKeyStatus>
}) {
  const runtime = {
    providerVersions: vi.fn(async () => ({
      claude: over.claude,
      codex: version('tested', 'carried'),
    })),
    providerSetup: vi.fn(async () => ({ claude: SETUP, codex: null })),
    apiKeyStatus: vi.fn(async ({ provider }: { provider: Provider }): Promise<ApiKeyStatus> => ({
      provider,
      set: false,
      setAt: null,
      inUse: false,
      ...(provider === 'codex' ? over.codexKey : {}),
    })),
    checkProviderAuth: vi.fn(async ({ provider }: { provider: Provider }) =>
      provider === 'codex' ? over.codexAuth : over.claudeAuth,
    ),
    signInProvider: vi.fn(),
    cancelProviderSignIn: vi.fn(),
    reprovisionProviderAuth: vi.fn(),
  }
  ;(window as unknown as { api: unknown }).api = { runtime }
  return runtime
}

const CAPS = {
  claude: { signIn: ABSENT, reprovisionAuth: ABSENT },
  codex: { signIn: AVAILABLE, reprovisionAuth: ABSENT },
} as unknown as ProviderCapabilityMap

// The Claude-first popup was replaced by equal provider cards. Unknown facts do not redirect.
describe('first run routes only when no provider is ready', () => {
  it.each([
    [SIGNED_OUT, SIGNED_OUT, 1],
    [SIGNED_IN, SIGNED_OUT, 0],
    [SIGNED_OUT, SIGNED_IN, 0],
    [SIGNED_IN, SIGNED_IN, 0],
    [{ state: 'unknown', reason: 'Cannot check' } as AuthState, SIGNED_OUT, 0],
  ])(
    'routes from readiness facts without a provider popup',
    async (claudeAuth, codexAuth, count) => {
      theBridge({ claude: version('tested'), claudeAuth, codexAuth })
      const open = vi.fn()
      const m = mount(ProviderSetupAtLaunch, { capabilities: CAPS, onOpenProviders: open })
      await settled()
      expect(open).toHaveBeenCalledTimes(count)
      expect(m.all('provider-setup-dialog')).toHaveLength(0)
      await settled()
      expect(open).toHaveBeenCalledTimes(count)
    },
  )
})

/* ------------------------------------------------------------------ §8 the card's Set up */

describe('§8 · the Providers card’s Set up opens it', () => {
  function theCard(
    auth: AuthState,
    program: ProviderVersion = version('tested'),
    options: { savedKey?: boolean; capabilities?: ProviderCapabilityMap | null } = {},
  ) {
    const runtime = {
      checkProviderAuth: vi.fn(async () => auth),
      apiKeyStatus: vi.fn(async () => ({
        provider: 'claude',
        set: options.savedKey ?? false,
        setAt: null,
        inUse: false,
      })),
      setApiKey: vi.fn(async (): Promise<Awaited<ReturnType<RuntimeBridge['setApiKey']>>> => ({
        provider: 'claude',
        set: false,
        setAt: null,
        inUse: false,
        refused: 'Storage unavailable.',
      })),
      checkApiKey: vi.fn(),
      signInProvider: vi.fn(),
      cancelProviderSignIn: vi.fn(),
      reprovisionProviderAuth: vi.fn(),
    }
    ;(window as unknown as { api: unknown }).api = { runtime }
    const lists = createModelLists(
      () =>
        ({
          modelList: async () => ({
            provider: 'claude',
            notAsked: null,
            standIn: null,
            models: [],
            lastPicked: null,
            startsOn: null,
          }),
          addHandAddedModel: async () => undefined,
          deleteHandAddedModel: async () => undefined,
        }) as never,
    )
    const readVersions = vi.fn(async () => undefined)
    const m = mount(
      ProviderCard as Component,
      {
        provider: 'claude',
        capabilities: options.capabilities === undefined ? CAPS : options.capabilities,
        limit: null,
        limitsRead: true,
        clock: Date.now(),
        version: program,
        readings: [],
        resources: null,
        resourcesPaused: false,
        resourcesError: null,
        loginMoved: 0,
        lists,
        setup: SETUP,
        readVersions,
      },
      { width: 720, height: 1400 },
    )
    return { m, runtime, readVersions }
  }

  it('keeps setup inside its card, and Cancel restores the normal sections', async () => {
    const { m } = theCard(SIGNED_OUT)
    await settled()
    if (m.all('provider-options').length > 0) {
      m.q('provider-options').click()
      await nextTick()
    }
    m.q('provider-set-up').click()
    await settled()
    expect(m.all('provider-inline-setup')).toHaveLength(1)
    expect(m.all('provider-setup-dialog')).toHaveLength(0)
    expect(m.all('provider-status')).toHaveLength(0)
    expect(m.all('provider-key')).toHaveLength(0)
    expect((m.q('setup-check') as HTMLButtonElement).disabled).toBe(true)
    m.q('setup-use-key').click()
    await settled()
    expect(m.q('setup-key-input').getAttribute('type')).toBe('password')
    const cancel = [...m.q('provider-inline-setup').querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    )!
    cancel.click()
    await settled()
    expect(m.all('provider-inline-setup')).toHaveLength(0)
    expect(m.all('provider-status')).toHaveLength(1)
  })
  it('Check re-reads readiness and Done closes the flow without another provider prompt', async () => {
    const { m, runtime, readVersions } = theCard(SIGNED_IN)
    await settled()
    if (m.all('provider-options').length > 0) {
      m.q('provider-options').click()
      await nextTick()
    }
    m.q('provider-set-up').click()
    await settled()
    m.q('setup-check').click()
    await settled()
    expect(readVersions).toHaveBeenCalledTimes(1)
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(2)
    expect(m.q('setup-ready').textContent).toContain('Claude is ready.')
    m.q('setup-done').click()
    await settled()
    expect(m.all('provider-inline-setup')).toHaveLength(0)
    expect(m.all('setup-other')).toHaveLength(0)
  })
  it('a failed readiness check never claims Done', async () => {
    const { m, runtime } = theCard(SIGNED_IN)
    await settled()
    if (m.all('provider-options').length > 0) {
      m.q('provider-options').click()
      await nextTick()
    }
    m.q('provider-set-up').click()
    await settled()
    runtime.checkProviderAuth.mockRejectedValueOnce(new Error('Cannot reach provider'))
    m.q('setup-check').click()
    await settled()
    expect(m.all('setup-done')).toHaveLength(0)
    expect(m.q('provider-inline-setup').textContent).toContain('Not connected yet')
  })
  it('does not check or claim Done after an API-key save is refused', async () => {
    const { m, runtime } = theCard(SIGNED_OUT)
    await settled()
    if (m.all('provider-options').length > 0) {
      m.q('provider-options').click()
      await nextTick()
    }
    m.q('provider-set-up').click()
    await settled()
    m.q('setup-use-key').click()
    await settled()
    const field = m.q('setup-key-input') as HTMLInputElement
    field.value = 'fictional-key-for-test'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    m.q('setup-check').click()
    await settled()
    expect(runtime.setApiKey).toHaveBeenCalledWith({
      provider: 'claude',
      key: 'fictional-key-for-test',
    })
    expect(runtime.checkApiKey).not.toHaveBeenCalled()
    expect(field.value).toBe('')
    expect(m.all('setup-done')).toHaveLength(0)
    expect(m.q('provider-inline-setup').textContent).toContain('Storage unavailable.')
  })
  it.each([{ savedKey: true }, { capabilities: null }])(
    'does not offer sign-in with a saved key or unread capabilities: %j',
    async (options) => {
      const { m, runtime } = theCard(SIGNED_OUT, version('tested'), options)
      await settled()
      if (m.all('provider-options').length > 0) {
        m.q('provider-options').click()
        await nextTick()
      }
      m.q('provider-set-up').click()
      await settled()
      const signIn = m.q('setup-sign-in') as HTMLButtonElement
      expect(signIn.disabled).toBe(true)
      signIn.click()
      await settled()
      expect(m.all('setup-command')).toHaveLength(0)
      expect(runtime.signInProvider).not.toHaveBeenCalled()
    },
  )
  it('uses the existing machine sign-in command when the provider has no in-app sign-in', async () => {
    const { m, runtime } = theCard(SIGNED_OUT)
    await settled()
    if (m.all('provider-options').length > 0) {
      m.q('provider-options').click()
      await nextTick()
    }
    m.q('provider-set-up').click()
    await settled()
    m.q('setup-sign-in').click()
    await settled()
    expect(m.q('setup-command').textContent).toBe(SETUP.signInCommand)
    expect(runtime.signInProvider).not.toHaveBeenCalled()
    m.q('setup-copy').click()
    await settled()
    expect(copied).toEqual([SETUP.signInCommand])
    expect((m.q('setup-check') as HTMLButtonElement).disabled).toBe(false)
    runtime.checkProviderAuth.mockResolvedValueOnce(SIGNED_IN)
    m.q('setup-check').click()
    await settled()
    expect(m.q('setup-ready').textContent).toContain('Claude is ready.')
  })
})

it.each([true, false, undefined])(
  'launch readiness says a sign-in can replace an unreadable key only when presence is %s',
  async (behind) => {
    theBridge({
      claude: version('tested'),
      claudeAuth: SIGNED_IN,
      codexAuth: { ...ON_A_KEY, loginBehindTheKey: behind } as AuthState,
      codexKey: { set: true, setAt: 1, inUse: false, readState: 'unreadable' },
    })
    mount(ProviderSetupAtLaunch, { capabilities: CAPS })
    await settled()
    const said = readiness.seen.mock.calls
      .map(([facts]) => facts.keyUnreadable)
      .find((line) => line?.includes('Codex'))
    expect(said).toBeDefined()
    expect(said?.includes('remove it to use the sign-in')).toBe(behind === true)
  },
)
