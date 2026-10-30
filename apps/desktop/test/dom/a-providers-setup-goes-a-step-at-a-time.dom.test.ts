import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component, type Ref } from 'vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import ProviderSetupAtLaunch from '../../src/renderer/src/components/ProviderSetupAtLaunch.vue'
import { useKeyAsked } from '../../src/renderer/src/composables/useKeyAsked'
import ProviderSetupWizard from '../../src/renderer/src/components/ProviderSetupWizard.vue'
import { forgetProfileSignIns } from '../../src/renderer/src/composables/useProfileSignIn'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { ProviderSetupSays } from '../../src/renderer/src/lib/provider-setup'
import type {
  ApiKeyStatus,
  RuntimeBridge,
  AuthState,
  CapabilityStatus,
  Provider,
  ProviderCapabilityMap,
  ProviderProgram,
  ProviderProgramStanding,
  ProviderVersion,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'
import type { ProviderSetupBridge, ProviderSetupState } from '../../src/shared/provider-setup'

/**
 * A provider's setup, a step at a time. Each step says one thing to do; Copy puts the exact
 * command on the clipboard; Next reads the facts again and moves on only when the step's own
 * fact changed. Codex has two steps and signs in inside the app. At launch it opens only when a
 * provider isn't ready; the card's Set up opens it any time.
 */

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

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

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

function installBridge() {
  let state: ProviderSetupState = {
    provider: 'claude',
    supported: { install: true, signIn: false },
    available: true,
    phase: 'idle',
    progress: '',
    authUrl: null,
    error: null,
    details: null,
    exitCode: null,
  }
  const listeners = new Set<(next: ProviderSetupState) => void>()
  const publish = (phase: ProviderSetupState['phase']) => {
    state = { ...state, phase }
    for (const listener of listeners) listener(state)
  }
  const bridge = {
    state: async () => state,
    onState: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    install: vi.fn(async () => {
      publish('installing')
      return { ok: true as const }
    }),
    signIn: vi.fn(async () => ({ ok: false as const, reason: 'unsupported-provider' as const })),
    cancel: vi.fn(async () => {
      publish('cancelled')
      return { ok: true as const }
    }),
  } satisfies ProviderSetupBridge
  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: { ...window.api, providerSetup: bridge },
  })
  return { bridge, complete: () => publish('installed') }
}

/** The wizard in the app's dialog layer, over facts the test moves; `recheck` moves them. */
function theWizard(start: {
  provider?: Provider
  version: ProviderVersion | null
  auth: AuthState | null
  setup?: ProviderSetupSays | null
  keyRefused?: boolean
  keyUnreadable?: string | null
  signIn?: CapabilityStatus
  onRecheck?: (facts: { version: Ref<ProviderVersion | null>; auth: Ref<AuthState | null> }) => void
}) {
  const installer = installBridge()
  const versionNow = ref<ProviderVersion | null>(start.version)
  const authNow = ref<AuthState | null>(start.auth)
  const events: string[] = []
  let rechecks = 0
  const Host = defineComponent({
    name: 'SetupUnderTest',
    setup: () => () =>
      h(
        OverlayHost,
        { label: 'Set up', onClose: () => events.push('close') },
        {
          default: () => [
            h(ProviderSetupWizard as Component, {
              provider: start.provider ?? 'claude',
              version: versionNow.value,
              setup: start.setup === undefined ? SETUP : start.setup,
              auth: authNow.value,
              keyRefused: start.keyRefused ?? false,
              keyUnreadable: start.keyUnreadable ?? null,
              signIn: start.signIn ?? ABSENT,
              reprovision: ABSENT,
              busy: 'idle',
              notice: null,
              recheck: async () => {
                rechecks += 1
                start.onRecheck?.({ version: versionNow, auth: authNow })
              },
              onClose: () => events.push('close'),
              onStart: () => events.push('start'),
              onSignIn: () => events.push('sign-in'),
              onOpenKey: () => events.push('open-key'),
            }),
          ],
        },
      ),
  })
  const m = mount(Host, {}, { width: 10, height: 10 })
  return { m, events, versionNow, authNow, installer, rechecks: () => rechecks }
}

const stepOf = (m: Mounted): string | undefined => m.q('provider-setup-dialog').dataset.step
const kindOf = (m: Mounted): string | undefined => m.q('provider-setup-dialog').dataset.kind
const titleOf = (m: Mounted): string => text(m.q('setup-title'))
const next = async (m: Mounted): Promise<void> => {
  ;(m.q('setup-next') as HTMLButtonElement).click()
  await settled()
}

/* ------------------------------------------------------------------ §1 each step's state */

describe('§1 · each step says one thing to do', () => {
  it('missing installs need no shell; fallback sign-in follows the shell main names', async () => {
    const mac = theWizard({ version: version('missing'), auth: SIGNED_OUT })
    await settled()
    expect(text(mac.m.q('install-program'))).toBe('Install The Tool')
    expect(mac.m.all('setup-command')).toHaveLength(0)
    expect(text(mac.m.q('provider-setup-dialog'))).not.toContain('Terminal')
    unmountAll()

    const windows = theWizard({
      version: version('missing'),
      auth: SIGNED_OUT,
      setup: { ...SETUP, platform: 'Windows', shell: 'PowerShell' },
    })
    await settled()
    expect(text(windows.m.q('install-program'))).toBe('Install The Tool')
    expect(windows.m.all('setup-command')).toHaveLength(0)
    expect(text(windows.m.q('provider-setup-dialog'))).not.toContain('PowerShell')
    unmountAll()

    // The shell named is the one main typed the command for, not a guess from the platform.
    const typedFor = theWizard({
      version: version('tested'),
      auth: SIGNED_OUT,
      setup: { ...SETUP, shell: 'PowerShell' },
    })
    await settled()
    expect(text(typedFor.m.q('setup-says'))).toBe(
      'Run this command in PowerShell. Follow its sign-in, then come back here.',
    )
  })

  it('install: one primary action, with connection and check steps hidden', async () => {
    const { m, installer } = theWizard({ version: version('missing'), auth: SIGNED_OUT })
    await settled()
    expect(stepOf(m)).toBe('install')
    expect(text(m.q('install-missing'))).toBe('The Tool isn’t installed.')
    expect(text(m.q('install-program'))).toBe('Install The Tool')
    for (const cy of [
      'setup-command',
      'setup-next',
      'setup-step',
      'setup-back',
      'setup-use-key',
      'sign-in-start',
    ])
      expect(m.all(cy)).toHaveLength(0)
    m.q('install-program').click()
    await settled()
    expect(installer.bridge.install).toHaveBeenCalledExactlyOnceWith('claude')
    expect((m.q('install-program') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a version read that failed is "could not check", never "missing"', async () => {
    const { m } = theWizard({ version: { version: null, reason: 'The read failed.' }, auth: null })
    await settled()
    expect(kindOf(m)).toBe('cannot-check')
    expect(titleOf(m)).toBe('Could not check for The Tool')
    expect(text(m.q('setup-says'))).toBe('The read failed. Choose Next to try again.')
    expect(m.all('setup-command')).toHaveLength(0)
  })

  it('older than tested, with main’s update command: that command to copy, and Next', async () => {
    const { m } = theWizard({
      version: version('older-than-tested', 'homebrew', { command: 'brew upgrade the-tool' }),
      auth: SIGNED_IN,
    })
    await settled()
    expect(titleOf(m)).toBe('Update The Tool')
    expect(text(m.q('setup-command'))).toBe('brew upgrade the-tool')
    expect(m.all('setup-next')).toHaveLength(1)
  })

  it('older than tested: no invented command; what to do in words, and the help link', async () => {
    const { m } = theWizard({ version: version('older-than-tested'), auth: SIGNED_IN })
    await settled()
    expect(stepOf(m)).toBe('version')
    expect(titleOf(m)).toBe('Update The Tool')
    expect(m.all('setup-command')).toHaveLength(0)
    const help = m.q('setup-help') as HTMLAnchorElement
    expect(help.href).toBe('https://example.com/help')
    expect(text(help)).toBe('How to update')
    // The steps before it are done.
    expect(m.all('setup-step').map(text)[0]).toBe('Install , done')
  })

  it('🔴 the sign-in and update commands are the ones main found, whole: shown and copied', async () => {
    const signIn = "& 'C:\\Users\\Ada O''Neil\\.local\\bin\\claude.exe' auth login"
    const out = theWizard({
      version: version('tested'),
      auth: SIGNED_OUT,
      setup: { ...SETUP, signInCommand: signIn, platform: 'Windows', shell: 'PowerShell' },
    })
    await settled()
    expect(text(out.m.q('setup-command'))).toBe(signIn)
    expect(text(out.m.q('setup-says'))).toContain('PowerShell')
    out.m.q('setup-copy').click()
    await settled()
    expect(copied).toEqual([signIn])
    unmountAll()

    const update = "'/Users/ada lovelace/.local/bin/claude' update"
    const old = theWizard({
      version: version('older-than-tested', 'native-installer', { command: update }),
      auth: SIGNED_IN,
    })
    await settled()
    expect(stepOf(old.m)).toBe('version')
    expect(text(old.m.q('setup-command'))).toBe(update)
  })

  it('signed out: the sign-in command; expired: sign in again', async () => {
    const out = theWizard({ version: version('tested'), auth: SIGNED_OUT })
    await settled()
    expect(stepOf(out.m)).toBe('sign-in')
    // The sign-in is the tool's own, so the title names the tool and not the provider.
    expect(titleOf(out.m)).toBe('Sign in to The Tool')
    expect(titleOf(out.m)).not.toBe('Sign in to Claude')
    expect(text(out.m.q('setup-command'))).toBe('the-tool')
    unmountAll()

    const stale = theWizard({ version: version('tested'), auth: { state: 'stale', reason: 'r' } })
    await settled()
    expect(titleOf(stale.m)).toBe('Sign in again')
  })

  it('🔴 the sign-in step also offers an API key, and the press asks for the key field', async () => {
    for (const auth of [SIGNED_OUT, { state: 'stale', reason: 'r' } as AuthState]) {
      const { m, events } = theWizard({ version: version('tested'), auth })
      await settled()
      expect(stepOf(m)).toBe('sign-in')
      const useKey = m.q('setup-use-key')
      expect(text(useKey)).toBe('Use an API key instead')
      expect(useKey.tagName).toBe('BUTTON')
      useKey.click()
      expect(events).toEqual(['open-key'])
      // Signing in is still there: the key is a second way, not the only one.
      expect(m.all('setup-next')).toHaveLength(1)
      unmountAll()
    }
  })

  it('⚑ the controls: no other step offers it', async () => {
    const steps = [
      theWizard({ version: version('missing'), auth: SIGNED_OUT }),
      theWizard({ version: version('older-than-tested'), auth: SIGNED_OUT }),
      theWizard({ version: version('tested'), auth: SIGNED_IN }),
      theWizard({ version: version('tested'), auth: ON_A_KEY, keyRefused: true }),
    ]
    await settled()
    for (const { m } of steps) expect(m.all('setup-use-key'), stepOf(m)).toHaveLength(0)
    // The refused key keeps its own way to the same field.
    expect(steps[3]!.m.all('setup-open-key')).toHaveLength(1)
  })

  it('a refused key: Open API key, no Next', async () => {
    const refused = theWizard({ version: version('tested'), auth: ON_A_KEY, keyRefused: true })
    await settled()
    expect(titleOf(refused.m)).toBe('The saved key needs attention')
    expect(refused.m.all('setup-next')).toHaveLength(0)
    refused.m.q('setup-open-key').click()
    expect(refused.events).toEqual(['open-key'])
  })

  it('🔴 a saved key that can’t be read: not ready, the app’s own sentence, Open API key, no Next', async () => {
    // Main's reason has more than one form; the step shows whichever it sent, whole.
    const start = 'BroBot can’t read the API key saved for Claude on this computer. '
    const end =
      'Save it again under “API key” on the Claude card in Providers, or remove it there to use your sign-in instead.'
    const forms = [
      'macOS may be waiting for permission to read its saved key. ',
      'It was saved with a Keychain entry this version of BroBot doesn’t have. ',
      '',
    ].map((middle) => start + middle + end)
    for (const form of forms.slice(1)) {
      const other = theWizard({ version: version('tested'), auth: ON_A_KEY, keyUnreadable: form })
      await settled()
      expect(kindOf(other.m)).toBe('key-unreadable')
      expect(text(other.m.q('setup-says'))).toBe(form)
      unmountAll()
    }
    const says = forms[0]!
    const { m, events } = theWizard({
      version: version('tested'),
      auth: ON_A_KEY,
      keyUnreadable: says,
    })
    await settled()
    expect(stepOf(m)).toBe('sign-in')
    expect(kindOf(m)).toBe('key-unreadable')
    expect(titleOf(m)).toBe('The saved key needs attention')
    expect(text(m.q('setup-says'))).toBe(says)
    expect(m.all('setup-next')).toHaveLength(0)
    expect(m.all('setup-use-key')).toHaveLength(0)
    m.q('setup-open-key').click()
    expect(events).toEqual(['open-key'])
  })

  it('⚑ the control: the same key, readable, is ready on the key', async () => {
    const { m } = theWizard({ version: version('tested'), auth: ON_A_KEY, keyUnreadable: null })
    await settled()
    expect(stepOf(m)).toBe('ready')
  })

  it('ready: what it runs on, the plan only as reported, and Start a conversation', async () => {
    const { m, events } = theWizard({ version: version('tested'), auth: SIGNED_IN })
    await settled()
    expect(stepOf(m)).toBe('ready')
    expect(titleOf(m)).toBe('Claude is ready')
    expect(text(m.q('setup-ready-checks'))).toBe('The Tool found Usable sign-in')
    expect(text(m.q('setup-details'))).toContain('Plan: Max')
    expect(text(m.q('setup-next'))).toBe('Start a conversation')
    await next(m)
    expect(events).toEqual(['start'])
  })

  it('ready on a saved key says so', async () => {
    const { m } = theWizard({ version: version('tested'), auth: ON_A_KEY })
    await settled()
    expect(text(m.q('setup-ready-checks'))).toContain('Runs on the saved API key')
    expect(text(m.q('setup-details'))).toContain('Plan: not reported')
  })
})

/* ------------------------------------------------------------------ §2 Copy */

describe('§2 · Copy', () => {
  it('puts the exact command on the clipboard, and says so', async () => {
    const { m } = theWizard({
      version: version('older-than-tested', 'homebrew', { command: 'brew upgrade the-tool' }),
      auth: SIGNED_OUT,
    })
    await settled()
    m.q('setup-copy').click()
    await settled()
    expect(copied).toEqual(['brew upgrade the-tool'])
    expect(text(m.q('setup-copy'))).toBe('Copied')
    expect(text(m.q('setup-feedback'))).toBe('Command copied.')
  })

  it('a clipboard that refuses: the command stays to select, and no copy is claimed', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (): Promise<void> => {
          throw new DOMException('Write permission denied.', 'NotAllowedError')
        },
      },
    })
    const { m } = theWizard({
      version: version('older-than-tested', 'homebrew', { command: 'brew upgrade the-tool' }),
      auth: SIGNED_OUT,
    })
    await settled()
    m.q('setup-copy').click()
    await settled()
    expect(text(m.q('setup-copy'))).toBe('Copy')
    expect(text(m.q('setup-feedback'))).toBe(
      'Could not copy. Select the command and copy it yourself.',
    )
  })
})

/* ------------------------------------------------------------------ §3 Next */

describe('§3 · Next reads the facts again and moves on only when they changed', () => {
  it('installer completion cannot claim success if re-detection still says missing', async () => {
    const { m, rechecks, installer } = theWizard({ version: version('missing'), auth: SIGNED_OUT })
    await settled()
    m.q('install-program').click()
    await settled()
    installer.complete()
    await settled()
    expect(rechecks()).toBe(1)
    expect(stepOf(m)).toBe('install')
    expect(text(m.q('install-missing'))).toBe('The Tool isn’t installed.')
    expect(m.all('setup-ready-checks')).toHaveLength(0)
  })

  it('successful install re-detects and moves on without another click', async () => {
    const { m, installer } = theWizard({
      version: version('missing'),
      auth: SIGNED_OUT,
      onRecheck: (facts) => (facts.version.value = version('tested')),
    })
    await settled()
    m.q('install-program').click()
    await settled()
    installer.complete()
    await settled()
    expect(stepOf(m)).toBe('sign-in')
    expect(document.activeElement).toBe(m.q('setup-title'))
  })

  it('a press alone moves nothing: without a changed fact the sign-in step stays', async () => {
    const { m } = theWizard({ version: version('tested'), auth: SIGNED_OUT })
    await settled()
    await next(m)
    await next(m)
    expect(stepOf(m)).toBe('sign-in')
    expect(text(m.q('setup-feedback'))).toBe(
      'No usable sign-in yet. Finish signing in, then choose Next again.',
    )
  })

  it('signed in by the time Next checks: Ready', async () => {
    const { m } = theWizard({
      version: version('tested'),
      auth: SIGNED_OUT,
      onRecheck: (facts) => (facts.auth.value = SIGNED_IN),
    })
    await settled()
    await next(m)
    expect(stepOf(m)).toBe('ready')
  })

  it('a fact that moves underneath does not move the step; Next does', async () => {
    const { m, authNow } = theWizard({ version: version('tested'), auth: SIGNED_OUT })
    await settled()
    authNow.value = SIGNED_IN
    await settled()
    expect(stepOf(m)).toBe('sign-in')
    await next(m)
    expect(stepOf(m)).toBe('ready')
  })

  it('a check that throws says it could not check, and stays', async () => {
    const versionNow = version('tested')
    const Host = defineComponent({
      setup: () => () =>
        h(ProviderSetupWizard as Component, {
          provider: 'claude',
          version: versionNow,
          setup: SETUP,
          auth: SIGNED_OUT,
          keyRefused: false,
          signIn: ABSENT,
          reprovision: ABSENT,
          busy: 'idle',
          notice: null,
          recheck: async () => {
            throw new Error('The host did not answer.')
          },
        }),
    })
    const m = mount(Host, {}, { width: 700, height: 900 })
    await settled()
    await next(m)
    expect(stepOf(m)).toBe('sign-in')
    expect(text(m.q('setup-feedback'))).toMatch(/^Could not check just now\./)
  })
})

/* ------------------------------------------------------------------ §4 newer than tested */

describe('§4 · newer than tested passes quietly', () => {
  it('a newer version passes with no warning; its range is only in Details', async () => {
    const { m } = theWizard({
      version: { version: null, reason: 'The initial read failed.' },
      auth: SIGNED_OUT,
      onRecheck: (facts) => (facts.version.value = version('newer-than-tested')),
    })
    await settled()
    await next(m)
    expect(stepOf(m)).toBe('version')
    expect(kindOf(m)).toBe('passed')
    expect(titleOf(m)).toBe('Version check passed')
    expect(m.all('setup-help')).toHaveLength(0)
    expect(text(m.q('setup-details'))).toContain(
      'Tested with 2.1.257–2.1.290. A newer version passes too.',
    )
    await next(m)
    expect(stepOf(m)).toBe('sign-in')
  })

  it('⚑ control: older than tested stops the step', async () => {
    const { m } = theWizard({ version: version('older-than-tested'), auth: SIGNED_OUT })
    await settled()
    await next(m)
    expect(stepOf(m)).toBe('version')
    expect(kindOf(m)).toBe('older')
    expect(text(m.q('setup-feedback'))).toBe(
      'The version has not changed. Finish the update, then choose Next again.',
    )
  })
})

/* ------------------------------------------------------------------ §5 Codex */

describe('§5 · a carried program: sign in, then ready', () => {
  it('two steps, the app’s own sign-in, and Ready once Next finds a usable sign-in', async () => {
    const { m, events } = theWizard({
      provider: 'codex',
      version: version('tested', 'carried'),
      auth: SIGNED_OUT,
      setup: null,
      signIn: AVAILABLE,
      onRecheck: (facts) => (facts.auth.value = SIGNED_IN),
    })
    await settled()
    expect(m.all('setup-step').map(text)).toEqual(['1 Sign in', '2 Ready'])
    expect(titleOf(m)).toBe('Sign in to Codex')
    expect(m.all('setup-use-key')).toHaveLength(1)
    expect(m.all('setup-command')).toHaveLength(0)
    m.q('sign-in-start').click()
    expect(events).toEqual(['sign-in'])
    await next(m)
    expect(stepOf(m)).toBe('ready')
    expect(text(m.q('setup-ready-checks'))).toContain('Comes with BroCrew')
  })
})

/* ------------------------------------------------------------------ §6 keyboard */

describe('§6 · keyboard and focus inside the dialog', () => {
  it('the step heading takes focus; Tab stays inside; Escape closes', async () => {
    const { m, events } = theWizard({ version: version('missing'), auth: SIGNED_OUT })
    await settled()
    expect(document.activeElement).toBe(m.q('install-missing'))
    const host = m.q('overlay-host')
    for (let i = 0; i < 12; i += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      await nextTick()
      expect(host.contains(document.activeElement), `Tab ${i + 1} left the dialog`).toBe(true)
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(events).toContain('close')
  })

  it('Back moves to the step before and focuses its heading', async () => {
    const { m } = theWizard({ version: version('tested'), auth: SIGNED_OUT })
    await settled()
    m.q('setup-back').click()
    await settled()
    expect(stepOf(m)).toBe('version')
    expect(document.activeElement).toBe(m.q('setup-title'))
  })
})

/* ------------------------------------------------------------------ §7 at launch */

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
