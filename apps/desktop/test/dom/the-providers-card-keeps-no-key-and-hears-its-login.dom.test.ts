import { providerConnectionFixtures } from '../../look/fixtures/providers'
import { createModelLists } from '../lib/provider-launch-fixture'
import { compatibilityConnectionId, providerDescriptor } from '@brobot2/shared'
import { settleDom as settled } from './settle-dom'
import type { ModelList } from '../../src/shared/model-choice-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'

import { clockTimeFrom } from '../../src/shared/clock'
import type { ProviderCondition } from '../../src/shared/provider-limit'
import {
  DEFAULT_PROFILE_ID,
  type ProviderHomesReprovision,
  type ApiKeyChanged,
  type ApiKeyCheck,
  type ApiKeyStatus,
  type AuthState,
  type RuntimeBridge,
  type ProviderCapabilityMap,
  type ProviderUsageReading,
} from '../../src/shared/runtime-ipc'
import { useKeyAsked } from '../../src/renderer/src/composables/useKeyAsked'
import { mount, unmountAll, visible, type Mounted } from './harness'

afterEach(unmountAll)

const NOW = new Date(2026, 9, 3, 9, 0).getTime()

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** A promise the test answers when it chooses — a door held open. */
function held<T>() {
  let answer!: (value: T) => void
  const promise = new Promise<T>((resolve) => (answer = resolve))
  return { promise, answer }
}

const AVAILABLE = { state: 'available' } as const
const NO_RENEWAL_MESSAGE = {
  state: 'absent',
  reason: 'Starting a conversation sends no message to renew its login.',
  checkedAgainst: 'the fake provider capabilities',
} as const
const CAPS = {
  claude: {
    signIn: AVAILABLE,
    reprovisionAuth: AVAILABLE,
    loginRenewalMessage: AVAILABLE,
  },
  codex: {
    signIn: AVAILABLE,
    reprovisionAuth: AVAILABLE,
    loginRenewalMessage: NO_RENEWAL_MESSAGE,
  },
} as unknown as ProviderCapabilityMap

const SIGNED_IN: AuthState = {
  state: 'usable',
  account: 'someone@example.com',
  login: 'account',
  plan: 'max',
  expiresAt: null,
}
const SIGNED_OUT: AuthState = { state: 'absent', reason: 'This profile has never been signed in.' }

const noHomeCopies = (): ProviderHomesReprovision => ({
  replaced: 0,
  pending: 0,
  skipped: 0,
  failed: 0,
  profiles: [],
})

const NO_KEY: ApiKeyStatus = { provider: 'claude', set: false, setAt: null, inUse: false }
const A_KEY: ApiKeyStatus = { provider: 'claude', set: true, setAt: NOW - 60_000, inUse: true }

const row = (id: string) => ({
  id,
  label: id,
  efforts: [],
  addedBy: 'the-provider' as const,
})
const LIST: ModelList = {
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: [row('claude-opus-5-5[1m]'), row('claude-sonnet-5-5')],
  lastPicked: null,
  startsOn: null,
}

interface Doors {
  checkProviderAuth?: RuntimeBridge['checkProviderAuth']
  apiKeyStatus?: () => Promise<ApiKeyStatus>
  setApiKey?: (input: { provider: string; key: string }) => Promise<ApiKeyChanged>
  removeApiKey?: () => Promise<ApiKeyChanged>
  checkApiKey?: () => Promise<ApiKeyCheck>
  homeCopyStatus?: () => ProviderHomesReprovision
  reprovisionProviderHomes?: (input: {
    provider: string
    statusOnly?: boolean
  }) => Promise<ProviderHomesReprovision>
  reprovisionProviderAuth?: () => Promise<'replaced' | 'unchanged'>
}

/**
 * ⚑ **The card behind a host whose `loginMoved` and `limit` move** — the screen's own hand-down —
 * over a bridge whose doors count their calls.
 */
function theCard(
  doors: Doors = {},
  over: {
    limit?: ProviderCondition | null
    list?: ModelList
    readings?: readonly ProviderUsageReading[]
    provider?: 'claude' | 'codex'
    capabilities?: ProviderCapabilityMap
  } = {},
) {
  const moved = ref(0)
  const limit = ref<ProviderCondition | null>(over.limit ?? null)
  const authChanged: string[] = []
  // ⚑ Each door typed once, so a test's own door and the default are one function type.
  const checkProviderAuth: NonNullable<Doors['checkProviderAuth']> =
    doors.checkProviderAuth ?? (async () => SIGNED_IN)
  const apiKeyStatus: NonNullable<Doors['apiKeyStatus']> =
    doors.apiKeyStatus ?? (async () => ({ ...NO_KEY }))
  const setApiKey: NonNullable<Doors['setApiKey']> = doors.setApiKey ?? (async () => ({ ...A_KEY }))
  const removeApiKey: NonNullable<Doors['removeApiKey']> =
    doors.removeApiKey ?? (async () => ({ ...NO_KEY }))
  const checkApiKey: NonNullable<Doors['checkApiKey']> =
    doors.checkApiKey ?? (async () => ({ ok: true }))
  const reprovisionProviderAuth: NonNullable<Doors['reprovisionProviderAuth']> =
    doors.reprovisionProviderAuth ?? (async () => 'replaced')
  const runtime = {
    providerConnections: async () => providerConnectionFixtures(),
    onProvidersChanged: () => () => {},
    reprovisionProviderHomes: vi.fn(async (input: { provider: string; statusOnly?: boolean }) =>
      input.statusOnly
        ? (doors.homeCopyStatus?.() ?? noHomeCopies())
        : (doors.reprovisionProviderHomes?.(input) ?? noHomeCopies()),
    ),
    checkProviderAuth: vi.fn<RuntimeBridge['checkProviderAuth']>(checkProviderAuth),
    apiKeyStatus: vi.fn(apiKeyStatus),
    setApiKey: vi.fn(setApiKey),
    removeApiKey: vi.fn(removeApiKey),
    checkApiKey: vi.fn(checkApiKey),
    reprovisionProviderAuth: vi.fn(reprovisionProviderAuth),
    signInProvider: vi.fn(async () => ({ success: false, state: SIGNED_OUT, detail: null })),
    cancelProviderSignIn: vi.fn(async () => undefined),
  }
  ;(window as unknown as { api: unknown }).api = { runtime }
  const lists = createModelLists(
    () =>
      ({
        modelList: async () => over.list ?? { ...LIST, provider: over.provider ?? 'claude' },
        addHandAddedModel: async () => undefined,
        deleteHandAddedModel: async () => undefined,
      }) as never,
  )
  const Host = defineComponent({
    name: 'ProviderCardHost',
    setup() {
      return () =>
        h(ProviderCard as Component, {
          provider: over.provider ?? 'claude',
          descriptor: providerDescriptor(over.provider ?? 'claude'),
          capabilities: over.capabilities ?? CAPS,
          limit: limit.value,
          limitsRead: true,
          clock: NOW,
          version: { version: '2.1.287' },
          readings: over.readings ?? [],
          resources: null,
          resourcesPaused: false,
          resourcesError: null,
          loginMoved: moved.value,
          lists,
          onAuthChanged: (profileId: string) => authChanged.push(profileId),
        })
    },
  })
  const m = mount(Host, {}, { width: 720, height: 1400 })
  return { m, runtime, moved, limit, authChanged }
}

const keyInput = (m: Mounted): HTMLInputElement => m.q('provider-key-input') as HTMLInputElement
const keyForm = (m: Mounted): HTMLFormElement => {
  const form = keyInput(m).closest('form')
  expect(form, 'the key field is in no form').not.toBeNull()
  return form!
}
const saveButton = (m: Mounted): HTMLButtonElement => {
  const button = keyForm(m).querySelector<HTMLButtonElement>('button[type="submit"]')
  expect(button, 'the key form has no Save button').not.toBeNull()
  return button!
}
async function typeKey(m: Mounted, key: string): Promise<void> {
  const input = keyInput(m)
  input.value = key
  input.dispatchEvent(new Event('input'))
  await nextTick()
}

function authReadings(
  signIn: AuthState,
  overview: AuthState,
  provider: 'claude' | 'codex' = 'claude',
): RuntimeBridge['checkProviderAuth'] {
  return async (input) =>
    input.connectionId === compatibilityConnectionId(provider, 'sign-in') ? signIn : overview
}

/* ================================================================ §1 · the key field */

describe('§1 · 25cca325 · the API key field — the key leaves the field as it is sent, and stays nowhere', () => {
  const FAKE = 'sk-ant-fake not a key'

  it('🔴 a refused key: the field empties at once, the host says why, and no key is set', async () => {
    const door = held<ApiKeyChanged>()
    const { m, runtime } = theCard({ setApiKey: () => door.promise })
    await settled()
    expect(m.all('provider-key-none')).toHaveLength(0)
    expect(keyInput(m).placeholder).toBe('Paste your Claude API key')

    await typeKey(m, `  ${FAKE}  `)
    saveButton(m).click()
    await nextTick()
    // ⛔ While the key is out, the field holds nothing and takes nothing.
    expect(keyInput(m).value).toBe('')
    expect(keyInput(m).disabled).toBe(true)
    expect(runtime.setApiKey).toHaveBeenCalledTimes(1)
    expect(runtime.setApiKey).toHaveBeenCalledWith({ provider: 'claude', key: FAKE })

    door.answer({ ...NO_KEY, refused: 'An API key has no spaces or line breaks.' })
    await settled()
    const said = m.q('provider-key-said')
    expect(text(said)).toBe('The key wasn’t saved. An API key has no spaces or line breaks.')
    expect(said.classList.contains('warn')).toBe(true)
    expect(m.all('provider-key-none')).toHaveLength(0)
    expect(keyInput(m).placeholder).toContain('API key')
    expect(m.all('provider-key-set')).toHaveLength(0)
    expect(keyInput(m).disabled).toBe(false)
    // 🔒 The key is nowhere: not in the text, not in an attribute, not in the field.
    expect(m.host.innerHTML).not.toContain('sk-ant-fake')
    expect(keyInput(m).value).toBe('')
  })

  it('⚑ the control: an accepted key — "Key saved", a key is set for its explicit connection, and still nowhere on the page', async () => {
    const { m, runtime } = theCard({
      setApiKey: async () => ({ ...A_KEY }),
    })
    await settled()
    await typeKey(m, FAKE)
    saveButton(m).click()
    await settled()
    expect(runtime.setApiKey).toHaveBeenCalledTimes(1)
    expect(text(m.q('provider-key-said'))).toBe('Key saved for this API-key connection.')
    expect(m.q('provider-key-said').classList.contains('warn')).toBe(false)
    expect(m.host.querySelector('[data-cy=provider-key-input]')).toBeNull()
    expect(
      m
        .all('provider-connection')
        .find((one) => one.textContent?.includes('API key'))
        ?.querySelector('.meta')?.textContent,
    ).toContain('API key · saved')
    expect(m.all('provider-key-in-use')).toHaveLength(0)
    expect(m.host.innerHTML).not.toContain('sk-ant-fake')
  })

  it('⚑ the host’s own notice, when it has one, is what the card says', async () => {
    const notice = 'Saved. Codex profiles that are running pick it up at their next start.'
    const { m } = theCard({ setApiKey: async () => ({ ...A_KEY, notice }) })
    await settled()
    await typeKey(m, FAKE)
    saveButton(m).click()
    await settled()
    expect(text(m.q('provider-key-said'))).toBe(notice)
  })

  it('⛔ a blank key is not sent', async () => {
    const { m, runtime } = theCard()
    await settled()
    await typeKey(m, '   ')
    expect(saveButton(m).disabled).toBe(true)
    // ⚑ Even submitted by the form itself (Enter in the field), nothing reaches the host.
    keyForm(m).requestSubmit()
    await settled()
    expect(runtime.setApiKey).not.toHaveBeenCalled()
    expect(m.all('provider-key-said')).toHaveLength(0)
  })

  it('⚑ a key that cannot be read by this Mac is said as a warning, not as in use', async () => {
    const { m } = theCard({ apiKeyStatus: async () => ({ ...A_KEY, inUse: false }) })
    await settled()
    const line = m.q('provider-key-in-use')
    expect(text(line)).toBe(
      'This computer can’t read it, so the Claude API-key connection won’t start. Save it again, or choose a sign-in connection for a new conversation.',
    )
    expect(line.classList.contains('warn')).toBe(true)
  })

  it('🔴 Check key says it is checking while it is out, then the host’s reason', async () => {
    const door = held<ApiKeyCheck>()
    const { m, runtime } = theCard({
      apiKeyStatus: async () => ({ ...A_KEY }),
      checkApiKey: () => door.promise,
    })
    await settled()
    const button = m.q('provider-key-check') as HTMLButtonElement
    expect(text(button)).toBe('Check key')
    button.click()
    await nextTick()
    expect(text(button)).toBe('Checking…')
    expect(button.disabled).toBe(true)
    // ⛔ One request at a time: Remove waits too.
    expect((m.q('provider-key-remove') as HTMLButtonElement).disabled).toBe(true)
    door.answer({ ok: false, reason: 'Anthropic did not accept this key.' })
    await settled()
    expect(runtime.checkApiKey).toHaveBeenCalledTimes(1)
    expect(text(button)).toBe('Check key')
    expect(text(m.q('provider-key-said'))).toBe('Anthropic did not accept this key.')
    expect(m.q('provider-key-said').classList.contains('warn')).toBe(true)
  })

  it('⚑ Remove: the key connection needs a key, and the field is offered again', async () => {
    const { m, runtime } = theCard({ apiKeyStatus: async () => ({ ...A_KEY }) })
    await settled()
    m.q('provider-key-remove').click()
    await settled()
    expect(runtime.removeApiKey).toHaveBeenCalledWith({ provider: 'claude' })
    expect(text(m.q('provider-key-said'))).toBe(
      'Key removed. This API-key connection needs a key before it can start.',
    )
    expect(m.all('provider-key-none')).toHaveLength(0)
    expect(keyInput(m).placeholder).toContain('API key')
  })
})

/* ================================================================ §2 · sign-in controls are independent of a saved key */

describe('§2 · 25cca325 · a saved key does not suppress sign-in controls', () => {
  it('a saved key does not hide an available sign-in', async () => {
    const { m, runtime } = theCard({
      checkProviderAuth: async () => SIGNED_OUT,
      apiKeyStatus: async () => ({ ...A_KEY }),
    })
    await settled()
    expect(m.all('sign-in-panel')).toHaveLength(1)
    expect(m.all('sign-in-start')).toHaveLength(1)
    expect(m.all('sign-in-reprovision')).toHaveLength(1)
    expect(m.all('sign-in-unavailable')).toHaveLength(0)
    expect(runtime.removeApiKey).not.toHaveBeenCalled()
    expect(runtime.setApiKey).not.toHaveBeenCalled()
  })

  it('an unusable saved key does not hide an available sign-in', async () => {
    const { m, runtime } = theCard({
      checkProviderAuth: async () => SIGNED_OUT,
      apiKeyStatus: async () => ({ ...A_KEY, inUse: false }),
    })
    await settled()
    expect(m.all('sign-in-start')).toHaveLength(1)
    expect(m.all('sign-in-reprovision')).toHaveLength(1)
    expect(m.all('sign-in-unavailable')).toHaveLength(0)
    expect(runtime.removeApiKey).not.toHaveBeenCalled()
    expect(runtime.setApiKey).not.toHaveBeenCalled()
  })

  it('⚑ the control: no key saved — Sign in and Copy are both offered, and the field is pointed at', async () => {
    const { m } = theCard({ checkProviderAuth: async () => SIGNED_OUT })
    await settled()
    expect(m.all('sign-in-start')).toHaveLength(1)
    expect(m.all('sign-in-reprovision')).toHaveLength(1)
    expect(m.all('sign-in-unavailable')).toHaveLength(0)
    expect(text(m.q('provider-key-prompt'))).toBe('Or add an API key below.')
    // ⚑ The panel offers no "Open Providers" here: this IS that screen (2caad6d2).
    expect(m.all('sign-in-open-providers')).toHaveLength(0)
  })
})

/* ================================================================ §3 · a notice mid-gesture */

describe('§3 · 25cca325 · a login notice that lands while a copy is out is not lost', () => {
  const asked = {
    provider: 'claude',
    profileId: DEFAULT_PROFILE_ID,
    connectionId: compatibilityConnectionId('claude', 'sign-in'),
  }
  const overviewAsked = { provider: 'claude', profileId: DEFAULT_PROFILE_ID }
  it('🔴 the check the notice asked for runs once the copy settles, and the card turns Ready', async () => {
    let reading: AuthState = SIGNED_OUT
    const copy = held<'replaced' | 'unchanged'>()
    const { m, runtime, moved, authChanged } = theCard({
      checkProviderAuth: async () => reading,
      reprovisionProviderAuth: () => copy.promise,
    })
    await settled()
    expect(runtime.checkProviderAuth.mock.calls).toEqual([[asked], [overviewAsked]])
    expect(text(m.q('provider-standing'))).toBe('Needs setup')

    m.q('sign-in-reprovision').click()
    await settled()
    expect(runtime.reprovisionProviderAuth).toHaveBeenCalledWith({
      provider: 'claude',
      profileId: DEFAULT_PROFILE_ID,
      connectionId: compatibilityConnectionId('claude', 'sign-in'),
    })
    // ⚑ The host says "login" before its answer to the copy arrives.
    reading = SIGNED_IN
    moved.value += 1
    await settled()
    // ⛔ The sign-in row is not asked while the copy is out — one gesture at a time…
    expect(runtime.checkProviderAuth.mock.calls).toEqual([
      [asked],
      [overviewAsked],
      [overviewAsked],
    ])
    // …but the key's status is read again at once.
    expect(runtime.apiKeyStatus).toHaveBeenCalledTimes(2)

    copy.answer('replaced')
    await settled()
    // 🔴 …and kept for when it settles: asked once more, and the card is Ready by itself.
    expect(runtime.checkProviderAuth.mock.calls).toEqual([
      [asked],
      [overviewAsked],
      [overviewAsked],
      [asked],
    ])
    expect(text(m.q('provider-standing'))).toBe('Ready')
    // The person's own login, named by its tool: BroBot made no sign-in.
    expect(
      m
        .all('provider-connection')
        .find((one) => one.querySelector('.meta')?.textContent?.includes('Sign-in'))
        ?.querySelector('.meta')?.textContent,
    ).toBe('Sign-in · Max plan')
    expect(m.all('provider-account')).toHaveLength(0)
    expect(m.all('provider-auth-notice')).toHaveLength(0)
    expect(authChanged).toEqual([DEFAULT_PROFILE_ID])
  })

  it('⚑ the control: a copy with no notice asks nothing by itself — the notice is what asks', async () => {
    const reading = SIGNED_OUT
    const { m, runtime, authChanged } = theCard({
      checkProviderAuth: async () => reading,
      reprovisionProviderAuth: async () => 'replaced',
    })
    await settled()
    m.q('sign-in-reprovision').click()
    await settled()
    expect(runtime.reprovisionProviderAuth).toHaveBeenCalledTimes(1)
    expect(runtime.checkProviderAuth.mock.calls).toEqual([[asked], [overviewAsked]])
    expect(text(m.q('provider-standing'))).toBe('Needs setup')
    expect(authChanged).toEqual([DEFAULT_PROFILE_ID])
  })

  it('⚑ a notice with no gesture out is asked about at once', async () => {
    const { runtime, moved } = theCard()
    await settled()
    expect(runtime.checkProviderAuth.mock.calls).toEqual([[asked], [overviewAsked]])
    moved.value += 1
    await settled()
    expect(runtime.checkProviderAuth.mock.calls).toEqual([
      [asked],
      [overviewAsked],
      [asked],
      [overviewAsked],
    ])
  })
})

/* ================================================================ §4 · at its limit */

const stopped = (
  standing: ProviderCondition['standing'],
  resetsAt: number | null,
): ProviderCondition => ({
  key: 'claude',
  provider: 'claude',
  standing,
  says: '',
  said: ['claude is rate-limited (five_hour); resets 2026-10-03T15:50:00.000Z'],
  meaning: [{ word: '5-hour', used: null, untimed: false }],
  resetsAt,
})

describe('§4 · b975fa15 · a stopped provider says so at the top of its card', () => {
  it('🔴 a stopped wall: "At its limit until …" under the name, announced, and the badge says At its limit', async () => {
    const reset = NOW + 2 * 60 * 60 * 1000
    const { m } = theCard({}, { limit: stopped('stopped', reset) })
    await settled()
    const heading = m.q('provider-at-limit')
    expect(text(heading)).toBe(`At its limit until ${clockTimeFrom(reset, NOW)}`)
    expect(heading.getAttribute('role')).toBe('status')
    expect(heading.getAttribute('title')).toContain('claude is rate-limited (five_hour)')
    expect(text(m.q('provider-standing'))).toBe('At its limit')
  })

  it('⚑ the control: a wall about to stop, or none — no heading, and Ready', async () => {
    const { m, limit } = theCard({}, { limit: stopped('about-to-stop', NOW + 3_600_000) })
    await settled()
    expect(m.all('provider-at-limit')).toHaveLength(0)
    expect(text(m.q('provider-standing'))).toBe('Ready')
    // ⚑ …and the wall lifting takes the heading with it.
    limit.value = stopped('stopped', NOW + 3_600_000)
    await settled()
    expect(m.all('provider-at-limit')).toHaveLength(1)
    limit.value = null
    await settled()
    expect(m.all('provider-at-limit')).toHaveLength(0)
    expect(text(m.q('provider-standing'))).toBe('Ready')
  })
})

describe('a check that finds the saved key unusable', () => {
  it('a refused check shows recovery words and refreshes the unreadable status', async () => {
    const reason =
      'BroBot can’t read its saved key. macOS may be waiting for permission. Save it again in Providers.'
    let status: ApiKeyStatus = { ...A_KEY }
    const { m } = theCard({
      apiKeyStatus: async () => status,
      checkApiKey: async () => {
        status = { ...A_KEY, inUse: false, readState: 'unreadable', unreadableReason: reason }
        return { ok: false, reason }
      },
    })
    await settled()
    ;(m.q('provider-key-check') as HTMLButtonElement).click()
    await settled()
    expect(text(m.q('provider-key-in-use'))).toBe(reason)
    expect(m.q('provider-key-in-use').classList.contains('warn')).toBe(true)
    ;(m.q('provider-key-replace') as HTMLButtonElement).click()
    await settled()
    expect(visible(m.q('provider-key-input'))).toBe(true)
  })
})

describe('a saved key this computer can’t read: the card says one true thing', () => {
  const REASON =
    'BroBot can’t read its saved key. macOS may be waiting for permission. Save it again in Providers.'
  const ON_THE_KEY: AuthState = { state: 'usable', login: 'api-key', expiresAt: null }

  for (const provider of ['claude', 'codex'] as const) {
    it(`🔴 ${provider}: no Ready, no "runs on the saved key", and the recovery message with its two ways out`, async () => {
      const { m } = theCard(
        {
          checkProviderAuth: authReadings(SIGNED_OUT, ON_THE_KEY, provider),
          apiKeyStatus: async () => ({
            ...A_KEY,
            provider,
            inUse: false,
            readState: 'unreadable',
            unreadableReason: REASON,
          }),
        },
        { provider },
      )
      await settled()
      expect(text(m.q('provider-standing'))).toBe('Needs setup')
      expect(m.all('provider-account')).toHaveLength(0)
      expect(text(m.host)).not.toContain('Runs on the saved API key')
      expect(text(m.q('provider-key-in-use'))).toBe(REASON)
      expect(visible(m.q('provider-key-replace'))).toBe(true)
      expect(visible(m.q('provider-key-remove'))).toBe(true)
    })

    it(`⚑ ${provider}, the controls: a key it can read is Ready on the key, and no key is Ready on the login`, async () => {
      const onTheKey = theCard(
        {
          checkProviderAuth: authReadings(SIGNED_IN, ON_THE_KEY, provider),
          apiKeyStatus: async () => ({ ...A_KEY, provider }),
        },
        { provider },
      )
      await settled()
      expect(text(onTheKey.m.q('provider-standing'))).toBe('Ready')
      expect(onTheKey.m.all('provider-account')).toHaveLength(0)
      expect(onTheKey.m.all('provider-key-in-use')).toHaveLength(0)
      expect(onTheKey.m.host.textContent).toContain('Sign-in · Max plan')
      expect(onTheKey.m.host.textContent).toContain('API key · saved')
      unmountAll()

      const noKey = theCard({ apiKeyStatus: async () => ({ ...NO_KEY, provider }) }, { provider })
      await settled()
      expect(text(noKey.m.q('provider-standing'))).toBe('Ready')
      expect(noKey.m.all('provider-account')).toHaveLength(0)
      expect(noKey.m.host.textContent).toContain('Sign-in · Max plan')
    })
  }
})

describe('the setup window at launch asked for a provider’s key field', () => {
  it('🔴 that provider’s card takes focus to its key field once it is drawn, and the ask is answered once', async () => {
    useKeyAsked().value = 'claude'
    const { m } = theCard()
    await settled()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(m.q('provider-key').contains(document.activeElement)).toBe(true)
    expect(useKeyAsked().value).toBeNull()
  })

  it('⛔ the control: another provider’s card leaves focus alone and leaves the ask standing', async () => {
    useKeyAsked().value = 'codex'
    const { m } = theCard()
    await settled()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(m.q('provider-key').contains(document.activeElement)).toBe(false)
    expect(useKeyAsked().value).toBe('codex')
    useKeyAsked().value = null
  })
})

/* ================================================================ §5 · the list's spelling */

describe('§5 · 5d5a991a · the card says what new conversations start on in the list’s spelling', () => {
  it('🔴 a last pick stored in another letter case is shown as the list spells it', async () => {
    const { m } = theCard(
      {},
      { list: { ...LIST, lastPicked: { model: 'claude-opus-5-5[1M]', effort: 'high' } } },
    )
    await settled()
    const line = text(m.q('provider-starts-on'))
    expect(line).toContain('New conversations start on claude-opus-5-5[1m] · high')
    expect(line).not.toContain('[1M]')
  })

  it('⚑ the control: a model the list does not hold is shown as it was picked', async () => {
    const { m } = theCard(
      {},
      { list: { ...LIST, lastPicked: { model: 'Claude-Haiku-9', effort: null } } },
    )
    await settled()
    expect(text(m.q('provider-starts-on'))).toContain('New conversations start on Claude-Haiku-9 —')
  })
})

describe('§5 · a saved key whose account can’t pay is not ready', () => {
  const ON_THE_KEY = { ...SIGNED_IN, login: 'api-key' as const, loginBehindTheKey: true }
  const REFUSED_AT = NOW - 30_000
  const refused = (aLoginRunsWithoutIt: boolean): ApiKeyStatus => ({
    ...A_KEY,
    refusedForBilling: { at: REFUSED_AT, aLoginRunsWithoutIt },
  })

  it('🔴 Not ready, and the key’s line says why and the ways out, the login among them where there is one', async () => {
    const { m } = theCard({
      checkProviderAuth: authReadings(SIGNED_IN, ON_THE_KEY),
      apiKeyStatus: async () => refused(true),
    })
    await settled()
    expect(text(m.q('provider-standing'))).toBe('Needs setup')
    const line = text(m.q('provider-key-refused'))
    expect(line).toContain('the account the key belongs to can’t pay for it')
    expect(line).toContain(
      'Add credit to that account, or replace the key, or choose a sign-in connection for a new conversation.',
    )
    expect(line).toContain('This clears once a turn or a check on the key works.')
  })

  it('🔴 where no login runs without the key, removing it is not offered', async () => {
    const { m } = theCard({
      checkProviderAuth: authReadings(SIGNED_OUT, ON_THE_KEY),
      apiKeyStatus: async () => refused(false),
    })
    await settled()
    const line = text(m.q('provider-key-refused'))
    expect(line).toContain('Add credit to that account, or replace the key.')
    expect(line).not.toContain('remove it')
  })

  it.each([false, undefined])(
    'a refused key never promises a sign-in when its presence is %s',
    async (behind) => {
      const { m } = theCard({
        checkProviderAuth: authReadings(SIGNED_OUT, { ...ON_THE_KEY, loginBehindTheKey: behind }),
        apiKeyStatus: async () => refused(true),
      })
      await settled()
      expect(text(m.q('provider-key-refused'))).not.toContain(
        'choose a sign-in connection for a new conversation',
      )
    },
  )

  it('⚑ control: a key nothing refused is Ready, with no such line', async () => {
    const { m } = theCard({
      checkProviderAuth: authReadings(SIGNED_IN, ON_THE_KEY),
      apiKeyStatus: async () => ({ ...A_KEY }),
    })
    await settled()
    expect(text(m.q('provider-standing'))).toBe('Ready')
    expect(m.host.querySelector('[data-cy="provider-key-refused"]')).toBeNull()
  })

  it('🔴 the check says before it is pressed that it sends one short message, and after, that the account paid', async () => {
    const { m } = theCard({
      apiKeyStatus: async () => ({ ...A_KEY, aCheckSpendsAToken: true }),
      checkApiKey: async () => ({ ok: true, answeredARequest: true }),
    })
    await settled()
    expect(text(m.q('provider-key-check-sends'))).toBe(
      'Checking sends Claude “Hi”, which costs a tiny amount.',
    )
    expect(visible(m.q('provider-key-check-sends'))).toBe(true)
    const button = m.q('provider-key-check') as HTMLButtonElement
    // Said in a line a person sees, not in a tooltip.
    expect(button.title).toBe('')
    button.click()
    await settled()
    expect(text(m.q('provider-key-said'))).toBe(
      'The key works, and its account can pay: Claude answered a one-token request on it.',
    )
  })
})

describe('what the app sends to a provider is said where a person sees it', () => {
  it('a Codex key check says it only asks for the model list', async () => {
    const { m } = theCard(
      { apiKeyStatus: async () => ({ ...A_KEY, provider: 'codex' }) },
      { provider: 'codex' },
    )
    await settled()
    expect(text(m.q('provider-key-check-sends'))).toBe(
      'Checking only asks Codex for its model list, which costs nothing.',
    )
  })

  it('a usable Claude login offers its actions without a renewal paragraph', async () => {
    const { m } = theCard()
    await settled()
    expect(m.all('provider-login-renewal')).toHaveLength(0)
    expect(m.all('provider-connection')).toHaveLength(2)
  })

  it.each([
    ['claude', false],
    ['codex', true],
  ] as const)(
    'the %s renewal capability adds no explanatory paragraph',
    async (provider, renews) => {
      const capabilities = {
        ...CAPS,
        [provider]: {
          ...CAPS[provider],
          loginRenewalMessage: renews ? AVAILABLE : NO_RENEWAL_MESSAGE,
        },
      }
      const { m } = theCard(
        { apiKeyStatus: async () => ({ ...NO_KEY, provider }) },
        { provider, capabilities },
      )
      await settled()
      const line = m.host.querySelector('[data-cy="provider-login-renewal"]')
      expect(line).toBeNull()
    },
  )

  it('a saved key and an incapable provider both omit the renewal paragraph', async () => {
    const keyed = theCard({ apiKeyStatus: async () => ({ ...A_KEY }) })
    await settled()
    expect(keyed.m.all('provider-login-renewal')).toHaveLength(0)
    expect(keyed.m.host.textContent).toContain('API key · saved')
    const codex = theCard(
      { apiKeyStatus: async () => ({ ...NO_KEY, provider: 'codex' }) },
      { provider: 'codex' },
    )
    await settled()
    expect(codex.m.host.querySelector('[data-cy="provider-login-renewal"]')).toBeNull()
  })
})

/* ================================================================ §6 · time gone beside usage */

describe('§6 · each usage box shows how much of its window has gone, and says when usage is ahead', () => {
  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  const reading = (
    window: string,
    usedPercent: number | null,
    resetsAt: number | null,
    period?: ProviderUsageReading['period'],
  ): ProviderUsageReading => ({
    connectionId: compatibilityConnectionId('claude', 'sign-in'),
    window,
    usedPercent,
    resetsAt,
    at: NOW,
    period,
  })
  const boxes = (m: Mounted) => [...m.host.querySelectorAll<HTMLElement>('.usage-window')]
  const inBox = (box: HTMLElement, cy: string): HTMLElement | null =>
    box.querySelector<HTMLElement>(`[data-cy="${cy}"]`)

  it('🔴 a known window with a reset ahead gets a grey time bar and its words', async () => {
    const { m } = theCard(
      {},
      {
        readings: [
          reading('five_hour', 42, NOW + 2.5 * HOUR, {
            word: '5-hour',
            durationMs: 5 * HOUR,
            bucket: false,
            bucketName: null,
          }),
        ],
      },
    )
    await settled()
    const [box] = boxes(m)
    const bar = inBox(box!, 'provider-usage-time') as HTMLMeterElement
    expect(bar.tagName).toBe('METER')
    expect(bar.value).toBe(0.5)
    expect(bar.getAttribute('aria-label')).toBe('Time gone in this window')
    expect(bar.getAttribute('aria-valuetext')).toBe('2 h 30 min of 5 h gone')
    expect(text(inBox(box!, 'provider-usage-time-words')!)).toBe(
      'time gone · 2 h 30 min of 5 h gone',
    )
    expect(visible(bar)).toBe(true)
    // Usage trails time: no warning, and the usage bar keeps its colour.
    expect(inBox(box!, 'provider-usage-ahead')).toBeNull()
    expect(box!.querySelector('meter:not(.time-meter)')!.classList.contains('ahead')).toBe(false)
  })

  it('🔴 usage ahead of time turns the usage bar amber and says so in words', async () => {
    const { m } = theCard(
      {},
      {
        readings: [
          reading('seven_day', 67, NOW + 3 * DAY, {
            word: 'weekly',
            durationMs: 7 * DAY,
            bucket: false,
            bucketName: null,
          }),
        ],
      },
    )
    await settled()
    const [box] = boxes(m)
    expect(text(inBox(box!, 'provider-usage-time-words')!)).toBe('time gone · 4 of 7 days gone')
    expect(text(inBox(box!, 'provider-usage-ahead')!)).toBe('Usage ahead of time')
    const usage = box!.querySelector<HTMLMeterElement>('meter:not(.time-meter)')!
    expect(usage.classList.contains('ahead')).toBe(true)
    expect(getComputedStyle(inBox(box!, 'provider-usage-ahead')!).color).not.toBe(
      getComputedStyle(inBox(box!, 'provider-usage-time-words')!).color,
    )
  })

  it('⚑ control: no time bar for an unknown window, an unsaid reset, or a reset already past', async () => {
    const { m } = theCard(
      {},
      {
        readings: [
          reading('overage', 10, NOW + HOUR),
          reading('five_hour', 10, null, {
            word: '5-hour',
            durationMs: 5 * HOUR,
            bucket: false,
            bucketName: null,
          }),
          reading('seven_day', 95, NOW - DAY, {
            word: 'weekly',
            durationMs: 7 * DAY,
            bucket: false,
            bucketName: null,
          }),
          reading('seven_day_opus', 3, NOW + DAY, {
            word: 'weekly Opus',
            durationMs: 7 * DAY,
            bucket: false,
            bucketName: null,
          }),
        ],
      },
    )
    await settled()
    const all = boxes(m)
    expect(all).toHaveLength(4)
    for (const box of all.slice(0, 3)) {
      expect(inBox(box, 'provider-usage-time')).toBeNull()
      expect(inBox(box, 'provider-usage-time-words')).toBeNull()
      expect(inBox(box, 'provider-usage-ahead')).toBeNull()
    }
    // The usage line for each stays as it was.
    expect(text(inBox(all[2]!, 'provider-usage-reading')!)).toBe(
      'Weekly limit: was 95% used; it reset 1 day ago.',
    )
    expect(inBox(all[3]!, 'provider-usage-time')).not.toBeNull()
  })
})

describe('the removed manual all-agent sign-in action', () => {
  it('has no button, result list or automatic status read in the drawer', async () => {
    const { m, runtime, authChanged } = theCard({}, { provider: 'codex' })
    await settled()
    expect(m.all('copy-all-sign-ins')).toHaveLength(0)
    expect(m.host.textContent).not.toContain('switched now')
    expect(m.host.textContent).not.toContain('will switch when')
    expect(runtime.reprovisionProviderHomes).not.toHaveBeenCalled()
    expect(authChanged).toEqual([])
  })
})
