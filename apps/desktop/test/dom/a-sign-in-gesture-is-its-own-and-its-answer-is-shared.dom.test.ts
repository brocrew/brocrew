import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import {
  forgetProfileSignIns,
  useProfileSignIn,
} from '../../src/renderer/src/composables/useProfileSignIn'
import { useProviderUsage } from '../../src/renderer/src/composables/useProviderUsage'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { DEFAULT_PROFILE_ID, type Provider } from '../../src/shared/runtime-ipc'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # A sign-in gesture is its surface's own, and what it learns is the window's
 *
 * The launcher, the title bar and the agent cards each sign a profile in through one gesture
 * implementation. Each surface's busy phase and notice are its own; what a check or a sign-in
 * learns about a provider and profile is kept once, so every surface reading that pair agrees.
 * A provider's usage is held once too, and the newest read wins.
 */

const ABSENT = { state: 'absent', reason: 'This profile has never been signed in.' } as const
const USABLE = { state: 'usable', login: 'account', expiresAt: null } as const

function aGate<T>(): { promise: Promise<T>; open: (value: T) => void } {
  let open: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}

afterEach(() => {
  unmountAll()
  forgetProfileSignIns()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

/** The launcher on `provider`, with a launch that fails so its sign-in panel is drawn. */
function launcher(runtime: Record<string, unknown>): {
  m: Mounted
  provider: { value: Provider }
  fail: () => Promise<void>
} {
  const busy = ref(false)
  const error = ref<string | null>(null)
  const words = ref('go')
  const provider = ref<Provider>('codex')
  const book = createAttachmentBook()
  ;(window as unknown as { api: unknown }).api = { runtime }
  const Frame = defineComponent({
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: busy.value,
          error: error.value,

          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: provider.value,
          models: null,
          choices: NO_LAUNCH_CHOICES,
          capabilities: allProviderCapabilities(),
          'onUpdate:draft': (text: string) => (words.value = text),
          onStart: () => (busy.value = true),
        })
    },
  })
  const m = mount(Frame, {}, { width: 1200, height: 900 })
  const fail = async (): Promise<void> => {
    ;(m.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    busy.value = false
    error.value = 'codex exited before it started: no such file or directory (cwd)'
    await settled()
  }
  return { m, provider, fail }
}

describe('the launcher’s sign-in', () => {
  it('writes what its check learns into the profile’s sign-in, so the title bar agrees', async () => {
    const { m, fail } = launcher({ checkProviderAuth: vi.fn(async () => ABSENT) })
    await fail()

    expect(m.all('sign-in-panel')).toHaveLength(1)
    expect(useProfileSignIn('codex', DEFAULT_PROFILE_ID).auth).toEqual(ABSENT)
  })

  it('a check it could not ask leaves the profile’s sign-in as the host last said it', async () => {
    useProfileSignIn('codex', DEFAULT_PROFILE_ID).auth = { ...USABLE }
    const { m, fail } = launcher({
      checkProviderAuth: vi.fn(async () => {
        throw new Error('the bridge is gone')
      }),
    })
    await fail()

    expect(m.q('sign-in-panel').textContent).toContain('the bridge is gone')
    expect(useProfileSignIn('codex', DEFAULT_PROFILE_ID).auth).toEqual(USABLE)
  })

  it('a check it asked before another surface signed in does not undo that sign-in', async () => {
    const old = aGate<typeof ABSENT>()
    let checks = 0
    const { m, fail } = launcher({
      checkProviderAuth: vi.fn(() => (++checks === 1 ? old.promise : Promise.resolve(USABLE))),
      signInProvider: async () => ({ success: true, state: { ...USABLE } }),
    })
    await fail()
    const profile = useProfileSignIn('codex', DEFAULT_PROFILE_ID)
    await profile.signIn()
    await settled()
    expect(profile.auth).toEqual(USABLE)

    old.open(ABSENT)
    await settled()
    expect(profile.auth).toEqual(USABLE)
    expect(m.all('sign-in-panel')).toHaveLength(1)
  })

  it('keeps its busy phase and notice to itself while its sign-in runs', async () => {
    const signInProvider = vi.fn(() => new Promise<never>(() => {}))
    const { m, fail } = launcher({ checkProviderAuth: async () => ABSENT, signInProvider })
    await fail()
    ;(m.q('sign-in-start') as HTMLButtonElement).click()
    await nextTick()

    expect(m.q('sign-in-notice').textContent).toContain('Finish signing in in your browser')
    const elsewhere = useProfileSignIn('codex', DEFAULT_PROFILE_ID)
    expect(elsewhere.busy).toBe('idle')
    expect(elsewhere.notice).toBeNull()
  })

  it('leaves a second sign-in of the same profile to the host, whose refusal is said where it was asked', async () => {
    const asked: unknown[] = []
    const signInProvider = vi.fn((input: unknown) => {
      asked.push(input)
      return asked.length === 1
        ? new Promise<never>(() => {})
        : Promise.reject(new Error('A sign-in for Codex is already running in profile default.'))
    })
    const { m, fail } = launcher({
      checkProviderAuth: async () => ABSENT,
      signInProvider,
      cancelProviderSignIn: async () => {},
    })
    await fail()
    ;(m.q('sign-in-start') as HTMLButtonElement).click()
    await nextTick()

    const elsewhere = useProfileSignIn('codex', DEFAULT_PROFILE_ID)
    await elsewhere.signIn()
    await settled()

    expect(asked).toEqual([
      { provider: 'codex', profileId: DEFAULT_PROFILE_ID },
      { provider: 'codex', profileId: DEFAULT_PROFILE_ID },
    ])
    expect(elsewhere.notice).toContain('already running')
    expect(m.q('sign-in-notice').textContent).toContain('Finish signing in in your browser')
  })

  it('cancels the sign-in it started, under the pair it started for, after the provider moved', async () => {
    const cancelled: unknown[] = []
    const { m, provider, fail } = launcher({
      checkProviderAuth: async () => ABSENT,
      signInProvider: () => new Promise<never>(() => {}),
      cancelProviderSignIn: async (input: unknown) => void cancelled.push(input),
    })
    await fail()
    ;(m.q('sign-in-start') as HTMLButtonElement).click()
    await nextTick()
    provider.value = 'claude'
    await nextTick()
    ;(m.q('sign-in-cancel') as HTMLButtonElement).click()
    await settled()

    expect(cancelled).toEqual([{ provider: 'codex', profileId: DEFAULT_PROFILE_ID }])
  })

  it('a check that answers after the provider moved is not drawn, and is kept for its own profile', async () => {
    const late = aGate<typeof USABLE>()
    let checks = 0
    const { m, provider, fail } = launcher({
      checkProviderAuth: vi.fn(() => (++checks === 1 ? late.promise : Promise.resolve(ABSENT))),
    })
    await fail()
    provider.value = 'claude'
    await nextTick()
    late.open(USABLE)
    await settled()

    expect(m.all('sign-in-panel')).toHaveLength(0)
    expect(useProfileSignIn('codex', DEFAULT_PROFILE_ID).auth).toEqual(USABLE)
    expect(useProfileSignIn('claude', DEFAULT_PROFILE_ID).auth).toBeNull()
  })
})

describe('a provider’s usage, held once for the window', () => {
  it('Providers and the title bar share one read, and an older answer never draws over a newer one', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    providersBridge()
    const runtime = window.api.runtime as unknown as Record<string, unknown>
    const reading = (usedPercent: number) => ({
      claude: [{ window: 'seven_day', usedPercent, resetsAt: Date.now() + 86_400_000, at: 1 }],
      codex: [],
    })
    const first = aGate<ReturnType<typeof reading>>()
    const second = aGate<ReturnType<typeof reading>>()
    const answers = [first.promise, second.promise]
    const providerUsage = vi.fn(() => answers.shift() ?? second.promise)
    const listeners: ((message: { what: string; provider?: Provider }) => void)[] = []
    runtime['providerUsage'] = providerUsage
    runtime['onProvidersChanged'] = (listener: (typeof listeners)[number]) => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    }
    const titleBar = defineComponent({
      setup() {
        const usage = useProviderUsage()
        return () =>
          h('span', { 'data-cy': 'title-usage' }, String(usage.value?.claude[0]?.usedPercent ?? ''))
      },
    })
    const bar = mount(titleBar, {})
    const screen = mount(
      ProvidersScreen,
      { capabilities: null, warnings: { walls: [], unread: false }, clock: Date.now() },
      { width: 1180, height: 900 },
    )
    await settled()
    expect(providerUsage).toHaveBeenCalledTimes(1)

    for (const listener of [...listeners]) listener({ what: 'usage', provider: 'claude' })
    await settled()
    second.open(reading(80))
    await settled()
    first.open(reading(20))
    await settled()

    expect(bar.q('title-usage').textContent).toBe('80')
    const row = screen.host.querySelector('[data-cy="provider-row"][data-provider="claude"]')
    expect(row?.textContent).toContain('80% used')
    expect(row?.textContent).not.toContain('20% used')
  })
})
