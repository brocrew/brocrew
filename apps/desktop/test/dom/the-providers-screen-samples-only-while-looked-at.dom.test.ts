import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SettingsScreen, {
  type SettingsTab,
} from '../../src/renderer/src/components/SettingsScreen.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useDebugMode } from '../../src/renderer/src/composables/useDebugMode'
import { hiddenDrawerTabs } from '../../src/renderer/src/lib/developer-views'
import type { DrawerTab } from '../../src/renderer/src/lib/drawer'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { readingSays } from '../../src/renderer/src/lib/usage-limit'
import type {
  ApiKeyStatus,
  AuthState,
  ModelList,
  Provider,
  ProviderCapabilityMap,
  ProviderResources,
  ProvidersChangedMessage,
  ProviderUsageReading,
  ProviderVersion,
} from '../../src/shared/runtime-ipc'
import { drawerProps, mount, paneProps, unmountAll, type Mounted } from './harness'

/**
 * # W4.26 · the Providers screen — what is running is sampled only while a person is looking
 *
 * ⚑ **`25cca325`'s cost rule** (`providers-screen-2.md`, *Cost*): `providerResources()` is asked
 * every 5 s **only while the screen is mounted, the window has focus and the page is visible**; the
 * next sample only after the last one answered, so two never overlap; blur, hiding or leaving clears
 * the timer; coming back asks once straight away. ⚑ The CPU fix this follows must not be undone by a
 * screen left open. Its "for landing" names this *the sampling gate*.
 *
 * | § | subject | ⚑ control |
 * |---|---|---|
 * | 1 | the gate: arrival, 5 s, no overlap, blur / hidden / leave, back in front | the same screen in front keeps sampling |
 * | 2 | the change notices: `usage` reads usage again and tells the window; `login` re-checks THAT card | versions are read once a visit |
 * | 3 | `714955ca` · the Debug mode switch: off by default, a press is kept, the side panel follows | Events is offered while it is on |
 *
 * ⚠️ **`document.hasFocus()` and `visibilityState` are the browser's, and a headless runner's are not
 * a person's** — so both are stood in for (a spy and an own property, removed after each test), and
 * the events the screen listens to are dispatched as the window would. ⚑ Timers are faked only for
 * §1 (`setTimeout`/`clearTimeout`, as `a-command-that-has-no-answer.dom.test.ts` does).
 */

const DEBUG_KEY = 'brobot2.debugMode'
// ⚑ Before the first `useDebugMode()` of this file: the switch starts from nothing stored.
localStorage.removeItem(DEBUG_KEY)
// ⚑ …and made here, outside any component. The shared switch's save-watch lives in the scope of
// whoever first asks for it: in the app that is `RuntimeScreen`, which is never unmounted; here the
// first screen mounted would be, and its unmount would stop every later save.
useDebugMode()

const NOW = new Date(2026, 9, 3, 9, 0).getTime()

let focused = true
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  focused = true
  visibility = 'visible'
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  unmountAll()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'visibilityState')
  Reflect.deleteProperty(window, 'api')
})

/** Microtasks and Vue's flushes — no macrotask, so it is safe under faked timers. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

function held<T>() {
  let answer!: (value: T) => void
  const promise = new Promise<T>((resolve) => (answer = resolve))
  return { promise, answer }
}

const AVAILABLE = { state: 'available' } as const
const CAPS = {
  claude: { signIn: AVAILABLE, reprovisionAuth: AVAILABLE },
  codex: { signIn: AVAILABLE, reprovisionAuth: AVAILABLE },
} as unknown as ProviderCapabilityMap

const SIGNED_IN: AuthState = { state: 'usable', login: 'account', expiresAt: null }

type Resources = Readonly<Record<Provider, ProviderResources>>
const RESOURCES: Resources = {
  claude: { running: 2, at: NOW, rssBytes: 1.3 * 1024 ** 3, cpuPercent: 34.4 },
  codex: { running: 0, at: NOW, rssBytes: 0, cpuPercent: 0 },
}
const VERSIONS: Readonly<Record<Provider, ProviderVersion>> = {
  claude: {
    version: '2.1.287',
    program: {
      standing: 'tested',
      from: 'native-installer',
      path: '/Users/someone/.local/bin/claude',
      version: '2.1.287',
      tested: { oldest: '2.1.280', newest: '2.1.290' },
      said: 'Claude Code 2.1.287, installed with Anthropic’s installer, at /Users/someone/.local/bin/claude.',
      help: { label: 'Installing and updating Claude Code', url: 'https://example.invalid/setup' },
      others: [],
      updatedFrom: null,
      update: { command: 'claude update' },
    },
  },
  codex: { version: null, reason: 'Codex could not be asked for its version just now.' },
}
const FIVE_HOURS: ProviderUsageReading = {
  window: 'five_hour',
  usedPercent: 12,
  resetsAt: NOW + 2 * 60 * 60 * 1000,
  at: NOW,
}
const USAGE: Readonly<Record<Provider, readonly ProviderUsageReading[]>> = {
  claude: [FIVE_HOURS],
  codex: [],
}

const LIST = (provider: Provider): ModelList => ({
  provider,
  notAsked: null,
  standIn: null,
  models: [],
  lastPicked: null,
  startsOn: null,
})

/**
 * ⚑ **The screen over a bridge that counts** — `onProvidersChanged` keeps its listener so a test can
 * speak as the host does, and hands back an unsubscribe that counts too.
 */
function theScreen(
  sample: () => Promise<Resources> = async () => RESOURCES,
  versions: Readonly<Record<Provider, ProviderVersion>> = VERSIONS,
  tab: SettingsTab = 'providers',
) {
  const listeners: ((message: ProvidersChangedMessage) => void)[] = []
  const unsubscribe = vi.fn()
  const runtime = {
    providerVersions: vi.fn(async () => versions),
    providerSetup: vi.fn(async () => ({})),
    providerUsage: vi.fn(async () => USAGE),
    providerResources: vi.fn(sample),
    onProvidersChanged: vi.fn((listener: (message: ProvidersChangedMessage) => void) => {
      listeners.push(listener)
      return unsubscribe
    }),
    checkProviderAuth: vi.fn<
      (asked: { provider: Provider; profileId: string }) => Promise<AuthState>
    >(async () => SIGNED_IN),
    apiKeyStatus: vi.fn(async (asked: { provider: Provider }): Promise<ApiKeyStatus> => ({
      provider: asked.provider,
      set: false,
      setAt: null,
      inUse: false,
    })),
  }
  ;(window as unknown as { api: unknown }).api = { runtime }
  const lists = createModelLists(
    () =>
      ({
        modelList: async (asked: { provider: Provider }) => LIST(asked.provider),
        addHandAddedModel: async () => undefined,
        deleteHandAddedModel: async () => undefined,
      }) as never,
  )
  const usageMoved = vi.fn()
  const m = mount(
    SettingsScreen as Component,
    {
      tab,
      capabilities: CAPS,
      warnings: { walls: [], unread: false },
      clock: NOW,
      lists,
      onUsageMoved: usageMoved,
    },
    { width: 1200, height: 1600 },
  )
  const tell = (message: ProvidersChangedMessage): void => {
    for (const listener of listeners) listener(message)
  }
  return { m, runtime, unsubscribe, usageMoved, tell }
}

const card = async (m: Mounted, provider: Provider): Promise<HTMLElement> => {
  const row = m.host.querySelector<HTMLButtonElement>(
    `[data-cy="provider-row"][data-provider="${provider}"]`,
  )
  expect(row).not.toBeNull()
  row!.click()
  await flush()
  const el = m.host.querySelector<HTMLElement>(
    `[data-cy="provider-card"][data-provider="${provider}"]`,
  )
  expect(el, `no card for ${provider}`).not.toBeNull()
  return el!
}
const inCard = async (m: Mounted, provider: Provider, cy: string): Promise<HTMLElement> => {
  await card(m, provider)
  if (cy === 'provider-standing')
    return m.q('provider-drawer').querySelector<HTMLElement>('[data-cy="provider-standing"]')!
  const el = (await card(m, provider)).querySelector<HTMLElement>(`[data-cy="${cy}"]`)
  expect(el, `no ${cy} on the ${provider} card`).not.toBeNull()
  return el!
}
const running = async (m: Mounted): Promise<string> =>
  text(await inCard(m, 'claude', 'provider-resources-says'))

const leaveTheFront = async (): Promise<void> => {
  focused = false
  window.dispatchEvent(new Event('blur'))
  await flush()
}
const comeBack = async (): Promise<void> => {
  focused = true
  window.dispatchEvent(new Event('focus'))
  await flush()
}

/* ================================================================ §1 · the sampling gate */

/**
 * The screen's minute clock, which keeps a reset said as "in 2 h" true: one timer, armed while the
 * screen is mounted, and never a sample.
 */
const MINUTE_CLOCK = 1

describe('§1 · 25cca325 · what is running is sampled only while a person can see the screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  it('⚑ the control: in front, it samples on arrival, then once every 5 s after each answer', async () => {
    const { m, runtime } = theScreen()
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
    expect(await running(m)).toBe('2 agents running · 1.3 GB memory · 34% CPU')
    expect(text(await inCard(m, 'codex', 'provider-resources-says'))).toBe('No agents running.')

    await vi.advanceTimersByTimeAsync(4_999)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(3)
  })

  it('🔴 two samples never overlap: the next is asked only after the last one answered', async () => {
    const second = held<Resources>()
    let calls = 0
    const { runtime } = theScreen(() => {
      calls += 1
      return calls === 2 ? second.promise : Promise.resolve(RESOURCES)
    })
    await flush()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(2)
    // ⛔ However long it is out, nothing else is asked…
    await vi.advanceTimersByTimeAsync(30_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(2)
    // ⛔ …not even by coming back to the front while it is out.
    await leaveTheFront()
    await comeBack()
    expect(runtime.providerResources).toHaveBeenCalledTimes(2)

    second.answer(RESOURCES)
    await flush()
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(3)
  })

  it('🔴 the window leaving the front stops it, says so, and coming back asks at once', async () => {
    const { m, runtime } = theScreen()
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
    // ⚑ The premise: the next sample is armed while the window is in front.
    expect(vi.getTimerCount()).toBe(1 + MINUTE_CLOCK)

    await leaveTheFront()
    // ⛔ …and leaving takes the armed one away, not only the sample it would ask (3018 M13).
    expect(vi.getTimerCount()).toBe(MINUTE_CLOCK)
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
    expect(await running(m)).toBe(
      '2 agents running · 1.3 GB memory · 34% CPU · paused while BroCrew isn’t in front',
    )

    await comeBack()
    // ⚑ At once — no timer advanced.
    expect(runtime.providerResources).toHaveBeenCalledTimes(2)
    expect(await running(m)).not.toContain('paused')
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(3)
  })

  it('🔴 a sample answered after the window left the front arms no next one', async () => {
    const first = held<Resources>()
    let calls = 0
    const { runtime } = theScreen(() => {
      calls += 1
      return calls === 1 ? first.promise : Promise.resolve(RESOURCES)
    })
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
    await leaveTheFront()
    first.answer(RESOURCES)
    await flush()
    // ⛔ No timer is armed by an answer that came after the window left (3018 M11).
    expect(vi.getTimerCount()).toBe(MINUTE_CLOCK)
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
  })

  it('⛔ a hidden page stops it as a blur does', async () => {
    const { runtime } = theScreen()
    await flush()
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(2)
  })

  it('⛔ leaving the screen clears the timer, the listeners and the subscription', async () => {
    const { m, runtime, unsubscribe } = theScreen()
    await flush()
    expect(runtime.onProvidersChanged).toHaveBeenCalledTimes(1)
    m.unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    // ⚑ The window's own events no longer reach it.
    await leaveTheFront()
    await comeBack()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
  })

  it('⚑ arriving while the window is not in front asks nothing, and says when it will', async () => {
    focused = false
    const { m, runtime } = theScreen()
    await flush()
    expect(runtime.providerResources).not.toHaveBeenCalled()
    expect(await running(m)).toBe('Shown while BroCrew is in front.')
    await comeBack()
    expect(runtime.providerResources).toHaveBeenCalledTimes(1)
  })

  it('⚑ a failed sample after a good one says so, instead of showing the old reading as now', async () => {
    let calls = 0
    const { m } = theScreen(async () => {
      calls += 1
      if (calls === 1) return RESOURCES
      throw new Error('ps did not answer within 2 s')
    })
    await flush()
    expect(await running(m)).toBe('2 agents running · 1.3 GB memory · 34% CPU')
    await vi.advanceTimersByTimeAsync(5_000)
    await flush()
    expect(await running(m)).toContain('Couldn’t measure just now:')
    expect(await running(m)).toContain('ps did not answer within 2 s')
    const row = m.host.querySelector<HTMLElement>(
      '[data-cy="provider-row"][data-provider="claude"]',
    )!
    expect(row.textContent).not.toContain('2 agents running')
    expect(row.textContent).toContain("Couldn't measure running agents")
  })
})

/* ================================================================ §2 · the notices */

describe('§2 · 25cca325 · the provider’s own change notices redraw the screen', () => {
  it('🔴 a usage notice reads usage again and tells the window to look at the walls', async () => {
    const { m, runtime, usageMoved, tell } = theScreen()
    await settled()
    expect(runtime.providerUsage).toHaveBeenCalledTimes(1)
    // ⚑ The reset is said relative to now: the window's clock, or the screen's own minute clock when
    // that is later — this fixture's clock is days behind the machine's.
    expect(text(await inCard(m, 'claude', 'provider-usage-reading'))).toBe(
      readingSays(FIVE_HOURS, Math.max(NOW, Date.now())),
    )
    expect(text(await inCard(m, 'codex', 'provider-usage-none'))).toBe(
      'No reading yet. Codex sends one with its next turn.',
    )
    tell({ what: 'usage', provider: 'claude' })
    await settled()
    expect(runtime.providerUsage).toHaveBeenCalledTimes(2)
    expect(usageMoved).toHaveBeenCalledTimes(1)
    // ⛔ A usage notice is not a login notice.
    expect(runtime.checkProviderAuth).toHaveBeenCalledTimes(2)
  })

  it('🔴 a login notice re-checks THAT provider’s card — its login and its key — and no other', async () => {
    const { runtime, usageMoved, tell } = theScreen()
    await settled()
    const asked = (provider: Provider) =>
      runtime.checkProviderAuth.mock.calls.filter(([one]) => one.provider === provider).length
    const keyAsked = (provider: Provider) =>
      runtime.apiKeyStatus.mock.calls.filter(([one]) => one.provider === provider).length
    expect([asked('claude'), asked('codex')]).toEqual([1, 1])
    tell({ what: 'login', provider: 'codex' })
    await settled()
    expect([asked('claude'), asked('codex')]).toEqual([1, 2])
    expect([keyAsked('claude'), keyAsked('codex')]).toEqual([1, 2])
    expect(runtime.providerUsage).toHaveBeenCalledTimes(1)
    expect(usageMoved).not.toHaveBeenCalled()
  })

  it('⚑ versions are read once as the screen opens, and a version that could not be read says why', async () => {
    const { m, runtime, tell } = theScreen()
    await settled()
    tell({ what: 'usage', provider: 'codex' })
    tell({ what: 'login', provider: 'claude' })
    await settled()
    expect(runtime.providerVersions).toHaveBeenCalledTimes(1)
    expect(text(await inCard(m, 'claude', 'provider-version-said'))).toBe(
      'Claude Code 2.1.287, installed with Anthropic’s installer, at /Users/someone/.local/bin/claude.',
    )
    expect(text(await inCard(m, 'codex', 'provider-version-said'))).toBe(
      'Codex could not be asked for its version just now.',
    )
  })

  it('⚑ the Codex card says which program runs — the copy BroCrew carries — with no link to install it', async () => {
    const path = '/Applications/BroBot.app/Contents/Resources/codex/bin/codex'
    const { m } = theScreen(undefined, {
      ...VERSIONS,
      codex: {
        version: '0.160.0',
        program: {
          standing: 'tested',
          from: 'carried',
          path,
          version: '0.160.0',
          tested: null,
          said: `Codex 0.160.0, the copy BroCrew carries, at ${path}.`,
          help: null,
          others: [],
          updatedFrom: null,
          update: null,
        },
      },
    })
    await settled()
    const said = await inCard(m, 'codex', 'provider-version-said')
    expect(text(said)).toBe(`Codex 0.160.0, the copy BroCrew carries, at ${path}.`)
    expect(said.classList.contains('warn')).toBe(false)
    expect((await card(m, 'codex')).querySelector('[data-cy="provider-version-help"]')).toBeNull()
    // ⚑ …and Claude's, a program a person installed, keeps its link.
    expect(
      (await card(m, 'claude')).querySelector('[data-cy="provider-version-help"]'),
    ).not.toBeNull()
  })

  /** A Claude Code program at this version and standing, with these other copies beside it. */
  const claudeAt = (
    version: string,
    standing: 'tested' | 'newer-than-tested' | 'older-than-tested',
    others: readonly { path: string; version: string }[] = [],
  ): ProviderVersion => ({
    version,
    program: {
      standing,
      from: 'native-installer',
      path: '/Users/someone/.local/bin/claude',
      version,
      tested: { oldest: '2.1.257', newest: '2.1.290' },
      said: `Claude Code ${version}, at /Users/someone/.local/bin/claude.`,
      help: { label: 'Installing and updating Claude Code', url: 'https://example.invalid/setup' },
      others: others.map((copy) => ({
        from: 'homebrew' as const,
        path: copy.path,
        version: copy.version,
        said: `${copy.version}, installed with Homebrew, at ${copy.path}`,
      })),
      updatedFrom: null,
      update: { command: 'claude update' },
    },
  })

  it('⚑ a Claude Code newer than tested draws no warning, and the card stays Ready', async () => {
    const { m } = theScreen(undefined, {
      ...VERSIONS,
      claude: claudeAt('2.1.292', 'newer-than-tested'),
    })
    await settled()
    expect((await inCard(m, 'claude', 'provider-version-said')).classList.contains('warn')).toBe(
      false,
    )
    expect(text(await inCard(m, 'claude', 'provider-standing'))).toBe('Ready')
  })

  it('⚑ the control: older than tested is a warning', async () => {
    const { m } = theScreen(undefined, {
      ...VERSIONS,
      claude: claudeAt('2.1.200', 'older-than-tested'),
    })
    await settled()
    expect((await inCard(m, 'claude', 'provider-version-said')).classList.contains('warn')).toBe(
      true,
    )
  })

  it('⚑ the other copies on this computer are listed, each with its version, one click away', async () => {
    const { m } = theScreen(undefined, {
      ...VERSIONS,
      claude: claudeAt('2.1.292', 'newer-than-tested', [
        { path: '/opt/homebrew/bin/claude', version: '2.1.245' },
      ]),
    })
    await settled()
    const others = await inCard(m, 'claude', 'provider-version-others')
    expect(text(others.querySelector('summary') as Element)).toBe('1 other copy found')
    expect([...others.querySelectorAll('[data-cy="provider-version-other"]')].map(text)).toEqual([
      '2.1.245, installed with Homebrew, at /opt/homebrew/bin/claude',
    ])
    // ⚑ …and none is drawn where there is none.
    expect((await card(m, 'codex')).querySelector('[data-cy="provider-version-others"]')).toBeNull()
  })

  it('⚑ an update that landed is said: Updated to its version, from the one before', async () => {
    const updated = claudeAt('2.1.292', 'newer-than-tested')
    const { m } = theScreen(undefined, {
      ...VERSIONS,
      claude: { ...updated, program: { ...updated.program!, updatedFrom: '2.1.245' } },
    })
    await settled()
    expect(text(await inCard(m, 'claude', 'provider-version-updated'))).toBe(
      'Updated to 2.1.292, from 2.1.245.',
    )
    // ⚑ …and nothing is said where nothing changed.
    expect(
      (await card(m, 'codex')).querySelector('[data-cy="provider-version-updated"]'),
    ).toBeNull()
  })

  it('🔴 Check again reads the program and its version again, so an update shows', async () => {
    let installed = claudeAt('2.1.245', 'older-than-tested')
    const { m, runtime } = theScreen()
    runtime.providerVersions.mockImplementation(async () => ({ ...VERSIONS, claude: installed }))
    await settled()
    const asked = runtime.providerVersions.mock.calls.length
    installed = claudeAt('2.1.292', 'newer-than-tested')
    const checkAgain = [...(await card(m, 'claude')).querySelectorAll('button')].find(
      (button) => text(button) === 'Check again',
    )
    if (checkAgain === undefined) throw new Error('no Check again on the Claude card')
    checkAgain.click()
    await settled()
    expect(runtime.providerVersions.mock.calls.length).toBe(asked + 1)
    expect(text(await inCard(m, 'claude', 'provider-version-said'))).toContain('2.1.292')
  })

  it('🔴 the setup facts are read again with the versions, so a program installed since is named by its path', async () => {
    const { m, runtime } = theScreen()
    await settled()
    expect(runtime.providerSetup).toHaveBeenCalledTimes(1)
    const checkAgain = [...(await card(m, 'claude')).querySelectorAll('button')].find(
      (button) => text(button) === 'Check again',
    )
    if (checkAgain === undefined) throw new Error('no Check again on the Claude card')
    checkAgain.click()
    await settled()
    expect(runtime.providerSetup).toHaveBeenCalledTimes(2)
    expect(runtime.providerVersions).toHaveBeenCalledTimes(2)
  })
})

/* ================================================================ §3 · Debug mode */

/** The side panel as `RuntimeScreen` hands it over: the tabs debug mode hides, from the one switch. */
const drawerFor = (tab: DrawerTab): Mounted =>
  mount(
    SessionDrawer as Component,
    drawerProps({ tab, hiddenTabs: hiddenDrawerTabs(useDebugMode().value) }),
    { width: 380, height: 900 },
  )

describe('§3 · 714955ca · the Debug mode switch, and the side panel that follows it', () => {
  afterEach(async () => {
    useDebugMode().value = false
    await nextTick()
    localStorage.removeItem(DEBUG_KEY)
  })

  it('🔴 off by default: the switch is off, and the side panel offers no Events tab and draws no event list', async () => {
    expect(useDebugMode().value).toBe(false)
    const { m } = theScreen(undefined, VERSIONS, 'general')
    await settled()
    expect((m.q('debug-mode-switch') as HTMLInputElement).checked).toBe(false)
    m.unmount()

    const drawer = drawerFor('events')
    expect(drawer.all('drawer-tab-events')).toHaveLength(0)
    expect(drawer.all('event-stream')).toHaveLength(0)
    // ⚑ The strip is still a strip: the default tab is there.
    expect(drawer.all('drawer-tab-open')).toHaveLength(1)
  })

  it('🔴 a press turns it on and keeps it, and Events is offered and drawn again', async () => {
    const { m } = theScreen(undefined, VERSIONS, 'general')
    await settled()
    const toggle = m.q('debug-mode-switch') as HTMLInputElement
    toggle.click()
    await nextTick()
    expect(toggle.checked).toBe(true)
    expect(useDebugMode().value).toBe(true)
    // ⚑ Kept as a window preference, across restarts and windows.
    expect(localStorage.getItem(DEBUG_KEY)).toBe('true')
    m.unmount()

    const drawer = drawerFor('events')
    expect(drawer.all('drawer-tab-events')).toHaveLength(1)
    expect(drawer.all('event-stream')).toHaveLength(1)
  })

  it('⚑ pressed again it is off again, and that is kept too', async () => {
    const { m } = theScreen(undefined, VERSIONS, 'general')
    await settled()
    const toggle = m.q('debug-mode-switch') as HTMLInputElement
    toggle.click()
    await nextTick()
    toggle.click()
    await nextTick()
    expect(toggle.checked).toBe(false)
    expect(localStorage.getItem(DEBUG_KEY)).toBe('false')
  })

  it('⚑ the conversation pane hands the hidden tabs to its side panel', () => {
    const hidden = mount(
      ConversationPane as Component,
      paneProps({ drawerOpen: true, drawerTab: 'open', hiddenDrawerTabs: hiddenDrawerTabs(false) }),
      { width: 1200, height: 900 },
    )
    expect(hidden.all('drawer-tab-open')).toHaveLength(1)
    expect(hidden.all('drawer-tab-events')).toHaveLength(0)
    unmountAll()
    // ⚑ The control: the same pane with debug mode on.
    const shown = mount(
      ConversationPane as Component,
      paneProps({ drawerOpen: true, drawerTab: 'open', hiddenDrawerTabs: hiddenDrawerTabs(true) }),
      { width: 1200, height: 900 },
    )
    expect(shown.all('drawer-tab-events')).toHaveLength(1)
  })
})
