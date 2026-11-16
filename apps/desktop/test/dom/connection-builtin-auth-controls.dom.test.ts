import { expect, it, vi } from 'vitest'
import { defineComponent, h, ref, type Component } from 'vue'
import { compatibilityConnectionId, providerDescriptor, type Provider } from '@brobot2/shared'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import { createProviderAccess } from '../../src/renderer/src/lib/provider-access'
import type {
  ApiKeyStatus,
  AuthState,
  RuntimeBridge,
  ProviderUsageReading,
} from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { providerConnectionFixtures } from '../../look/fixtures/providers'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, visible, type Mounted } from './harness'
import {
  providerConditions,
  readProviderLimit,
  type ProviderCondition,
} from '../../src/shared/provider-limit'
import {
  providerCardReadingProps,
  providerLaunchFixture,
  settleProviderLaunch as settle,
} from './provider-launch.fixture'

providerLaunchFixture()

const ACCOUNT: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const KEY: AuthState = {
  state: 'usable',
  login: 'api-key',
  expiresAt: null,
  loginBehindTheKey: true,
}
const STALE: AuthState = { state: 'stale', reason: 'The fictional subscription has expired.' }

type Options = {
  unreadable?: boolean
  saved?: boolean
  signIn?: AuthState
  extra?: boolean
  readings?: readonly ProviderUsageReading[]
  limit?: ProviderCondition | null
}
async function drawer(provider: Provider, options: Options = {}) {
  Reflect.deleteProperty(window.api, 'providerSetup')
  const id = compatibilityConnectionId(provider, 'sign-in')
  const saved = options.saved ?? true
  const status: ApiKeyStatus = {
    provider,
    set: saved,
    setAt: saved ? 1 : null,
    inUse: saved && !options.unreadable,
    ...(options.unreadable
      ? {
          readState: 'unreadable' as const,
          unreadableReason: 'The fictional saved key cannot be read.',
        }
      : {}),
  }
  const legacy: AuthState = options.unreadable
    ? { state: 'absent', reason: 'The fictional saved key cannot be read.' }
    : saved
      ? KEY
      : STALE
  const auth = vi.fn<RuntimeBridge['checkProviderAuth']>(async (input) =>
    input.connectionId === id ? (options.signIn ?? ACCOUNT) : legacy,
  )
  const keyStatus = vi.fn<RuntimeBridge['apiKeyStatus']>(async () => status)
  window.api.runtime.checkProviderAuth = auth
  window.api.runtime.apiKeyStatus = keyStatus
  const rows = providerConnectionFixtures()
    .filter((row) => row.provider === provider)
    .map((row) => ({
      ...row,
      name: row.authMethod === 'sign-in' ? 'Fictional sign-in' : 'Fictional key',
    }))
  if (options.extra)
    rows.push({ ...rows[0]!, id: 'fictional-additional-sign-in', name: 'Fictional additional' })
  window.api.runtime.providerConnections = async () => rows
  const copy = vi.fn<RuntimeBridge['reprovisionProviderAuth']>(async () => 'replaced' as const)
  const signIn = vi.fn<RuntimeBridge['signInProvider']>(async () => ({
    success: false,
    state: STALE,
    detail: 'Fictional sign-in cancelled.',
  }))
  const cancel = vi.fn<RuntimeBridge['cancelProviderSignIn']>(async () => {})
  window.api.runtime.reprovisionProviderAuth = copy
  window.api.runtime.signInProvider = signIn
  window.api.runtime.cancelProviderSignIn = cancel
  const remove = vi.spyOn(window.api.runtime, 'removeApiKey')
  const save = vi.spyOn(window.api.runtime, 'setApiKey')
  const overview = createProviderAccess(
    () => provider,
    () => {},
    () => window.api.runtime,
  )
  overview.auth.value = legacy
  overview.keyStatus.value = status
  const capabilities =
    provider === 'claude'
      ? {
          ...CAPABILITY_FIXTURE,
          claude: {
            ...CAPABILITY_FIXTURE.claude,
            loginRenewalMessage: { state: 'available' as const },
          },
        }
      : CAPABILITY_FIXTURE
  const revision = ref(0)
  const props = {
    provider,
    descriptor: providerDescriptor(provider),
    access: overview,
    capabilities,
    ...providerCardReadingProps(options.readings ?? []),
    limit: options.limit ?? null,
    limitsRead: true,
    clock: Date.now(),
    version: { version: 'fictional' },
  }
  const card: Component = ProviderCard
  const Frame = defineComponent(() => () => h(card, { ...props, loginMoved: revision.value }))
  const m = mount(Frame, {}, { width: 760, height: 1400 })
  await settle()
  return {
    m,
    id,
    auth,
    keyStatus,
    overview,
    legacy,
    copy,
    signIn,
    cancel,
    remove,
    save,
    refresh: () => {
      revision.value++
    },
  }
}

function entry(m: Mounted, name: string): HTMLElement {
  const row = m
    .all('provider-connection')
    .find((one) => one.querySelector('strong')?.textContent?.endsWith(` · ${name}`))
  expect(row, `the ${name} connection entry`).toBeDefined()
  return row!
}
const state = (row: HTMLElement) =>
  `${row.querySelector('.meta')?.textContent?.trim().split(' · ')[0]} · ${row.querySelector('[data-cy=connection-status]')?.textContent?.trim()}`

for (const provider of ['claude', 'codex'] as const) {
  for (const unreadable of [false, true]) {
    it(`${provider}: reads the sign-in row independently of a ${unreadable ? 'unreadable' : 'saved'} key and supplied global access`, async () => {
      const f = await drawer(provider, { unreadable })
      expect(f.auth).toHaveBeenCalledExactlyOnceWith({
        provider,
        profileId: DEFAULT_PROFILE_ID,
        connectionId: f.id,
      })
      const login = entry(f.m, 'Fictional sign-in')
      expect(state(login)).toBe('Sign-in · Ready')
      expect(login.querySelector('.meta')?.textContent).toContain('Sign-in')
      expect(login.textContent).not.toContain('Runs on the saved API key')
      expect(login.textContent).not.toContain('Models not checked.')
      expect(state(entry(f.m, 'Fictional key'))).toBe(
        unreadable ? 'API key · API key needs attention' : 'API key · Ready',
      )
      expect(f.overview.auth.value).toBe(f.legacy)
      expect(f.keyStatus).not.toHaveBeenCalled()
      expect(f.remove).not.toHaveBeenCalled()
      expect(f.save).not.toHaveBeenCalled()
    })
  }

  it(`${provider}: a global usable key does not make the stale sign-in row ready`, async () => {
    const f = await drawer(provider, { signIn: STALE })
    expect(state(entry(f.m, 'Fictional sign-in'))).toBe('Sign-in · Needs sign-in')
    expect(entry(f.m, 'Fictional sign-in').textContent).toContain(STALE.reason)
    const before = f.auth.mock.calls.length
    f.m.q('sign-in-check').click()
    await settle()
    expect(f.auth.mock.calls.slice(before)).toEqual([
      [
        {
          provider,
          profileId: DEFAULT_PROFILE_ID,
          connectionId: f.id,
          ...(providerDescriptor(provider).signIn.manualProbe ? { probe: true } : {}),
        },
      ],
      [{ provider, profileId: DEFAULT_PROFILE_ID }],
    ])
    expect(f.overview.auth.value).toBe(f.legacy)
  })

  it(`${provider}: describes the key connection without claiming it outranks the sign-in`, async () => {
    const f = await drawer(provider)
    const key = entry(f.m, 'Fictional key')
    expect(key.textContent).not.toContain('outranks')
    expect(key.querySelector('.meta')?.textContent).toContain('API key · saved')
    if (provider === 'claude') {
      expect(f.m.host.querySelector('[data-cy=provider-login-renewal]')).toBeNull()
    }
    expect(f.remove).not.toHaveBeenCalled()
  })

  it(`${provider}: an empty key entry describes an explicit connection choice`, async () => {
    const f = await drawer(provider, { saved: false })
    const key = entry(f.m, 'Fictional key')
    expect(key.querySelector('[data-cy=provider-key-none]')).toBeNull()
    expect(
      key.querySelector<HTMLInputElement>('[data-cy=provider-key-input]')?.placeholder,
    ).toContain('API key')
    expect(state(key)).toBe('API key · Not checked')
    expect(state(entry(f.m, 'Fictional sign-in'))).toBe('Sign-in · Ready')
    expect(f.overview.auth.value).toBe(f.legacy)
    expect(f.save).not.toHaveBeenCalled()
    expect(f.remove).not.toHaveBeenCalled()
  })

  it(`${provider}: a saved key cannot enable Check for a stale sign-in setup`, async () => {
    const f = await drawer(provider, { signIn: STALE })
    f.m.q('provider-options').click()
    await settle()
    f.m.q('provider-set-up').click()
    await settle()
    const before = f.auth.mock.calls.slice()
    const check = f.m.q('setup-check') as HTMLButtonElement
    expect(check.disabled).toBe(true)
    check.click()
    await settle()
    expect(f.auth.mock.calls).toEqual(before)
    expect(f.save).not.toHaveBeenCalled()
    expect(f.remove).not.toHaveBeenCalled()
  })

  it(`${provider}: additional rows borrow neither builtin auth nor controls`, async () => {
    const f = await drawer(provider, { extra: true })
    const additional = entry(f.m, 'Fictional additional')
    expect(state(additional)).toBe('Sign-in · Not checked')
    expect(additional.querySelectorAll('button, input, meter')).toHaveLength(0)
    expect(additional.textContent).not.toContain('Models not checked.')
  })
}

for (const saved of [false, true]) {
  for (const operation of ['copy', 'sign-in'] as const) {
    it(`Codex ${operation}: sends the builtin sign-in ID with saved-key=${saved}`, async () => {
      const f = await drawer('codex', { saved, signIn: STALE })
      const button = f.m.q(
        operation === 'copy' ? 'sign-in-reprovision' : 'sign-in-start',
      ) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      button.click()
      await settle()
      expect(operation === 'copy' ? f.copy : f.signIn).toHaveBeenCalledExactlyOnceWith({
        provider: 'codex',
        profileId: DEFAULT_PROFILE_ID,
        connectionId: f.id,
      })
      expect(f.remove).not.toHaveBeenCalled()
      expect(f.save).not.toHaveBeenCalled()
    })
  }
}

it('Codex manual cancellation remains provider/profile scoped while a row sign-in is pending', async () => {
  const f = await drawer('codex', { saved: false, signIn: STALE })
  let finish!: (value: Awaited<ReturnType<RuntimeBridge['signInProvider']>>) => void
  f.signIn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  f.m.q('sign-in-start').click()
  await settle()
  f.m.q('sign-in-cancel').click()
  await settle()
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith({
    provider: 'codex',
    profileId: DEFAULT_PROFILE_ID,
  })
  finish({ success: false, state: STALE, detail: 'Fictional sign-in cancelled.' })
  await settle()
  expect(f.m.all('sign-in-cancel')).toHaveLength(0)
  expect(f.remove).not.toHaveBeenCalled()
  expect(f.save).not.toHaveBeenCalled()
})

it('coalesces notice-driven row checks behind a pending sign-in without changing global auth', async () => {
  const f = await drawer('codex', { saved: false, signIn: STALE })
  f.auth.mockClear()
  let finish!: (value: Awaited<ReturnType<RuntimeBridge['signInProvider']>>) => void
  f.signIn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  f.m.q('sign-in-start').click()
  await settle()
  f.refresh()
  await settle()
  f.refresh()
  await settle()
  expect(f.auth).not.toHaveBeenCalled()
  expect(f.signIn).toHaveBeenCalledTimes(1)
  expect((f.m.q('sign-in-start') as HTMLButtonElement).disabled).toBe(true)
  expect(f.overview.auth.value).toBe(f.legacy)
  finish({ success: false, state: STALE, detail: 'Fictional sign-in settled.' })
  await settle()
  expect(f.auth).toHaveBeenCalledExactlyOnceWith({
    provider: 'codex',
    profileId: DEFAULT_PROFILE_ID,
    connectionId: f.id,
  })
  expect(f.overview.auth.value).toBe(f.legacy)
  expect(f.cancel).not.toHaveBeenCalled()
})

it('a successful scoped probe remains ready when the independent overview refresh fails', async () => {
  const f = await drawer('claude', { signIn: STALE })
  f.auth.mockClear()
  f.auth.mockImplementation(async (input) => {
    if (input.connectionId === f.id) return ACCOUNT
    throw new Error('The fictional overview read failed.')
  })
  f.m.q('sign-in-check').click()
  await settle()
  expect(state(entry(f.m, 'Fictional sign-in'))).toBe('Sign-in · Ready')
  expect(f.overview.auth.value).toEqual({
    state: 'unknown',
    reason: 'The fictional overview read failed.',
  })
  expect(f.auth.mock.calls).toEqual([
    [{ provider: 'claude', profileId: DEFAULT_PROFILE_ID, connectionId: f.id, probe: true }],
    [{ provider: 'claude', profileId: DEFAULT_PROFILE_ID }],
  ])
  expect(f.save).not.toHaveBeenCalled()
  expect(f.remove).not.toHaveBeenCalled()
})

for (const provider of ['claude', 'codex'] as const) {
  for (const hasOwn of [true, false]) {
    it(`${provider}: the sign-in entry ${hasOwn ? 'shows only its attributed figures' : 'stays unknown without an attributed reading'}`, async () => {
      const now = Date.now()
      const reading = (usedPercent: number, connectionId?: string): ProviderUsageReading => ({
        window: 'seven_day',
        usedPercent,
        resetsAt: now + 3_600_000,
        at: now,
        period: { word: 'weekly', durationMs: 7 * 24 * 3_600_000, bucket: false, bucketName: null },
        ...(connectionId === undefined ? {} : { connectionId }),
      })
      const ownId = compatibilityConnectionId(provider, 'sign-in')
      const f = await drawer(provider, {
        readings: [
          reading(99, compatibilityConnectionId(provider, 'api-key')),
          reading(88, 'fictional-additional-sign-in'),
          reading(77),
          ...(hasOwn ? [reading(40, ownId)] : []),
        ],
        extra: true,
      })
      const signIn = entry(f.m, 'Fictional sign-in')
      const amounts = [...signIn.querySelectorAll<HTMLMeterElement>('meter:not(.time-meter)')]
      expect(amounts.map((meter) => meter.value)).toEqual(hasOwn ? [40] : [])
      expect(signIn.querySelectorAll('[data-cy=provider-usage-reading]')).toHaveLength(
        hasOwn ? 1 : 0,
      )
      if (hasOwn) {
        expect(signIn.querySelector('[data-cy=provider-usage-reading]')?.textContent).toContain(
          '40%',
        )
        expect(signIn.querySelectorAll('[data-cy=provider-usage-time]')).toHaveLength(1)
      } else {
        expect(signIn.querySelector('[data-cy=provider-usage-none]')).toBeNull()
      }
      for (const percent of ['99%', '88%', '77%']) expect(signIn.textContent).not.toContain(percent)
      expect(entry(f.m, 'Fictional key').querySelectorAll('meter')).toHaveLength(0)
      expect(entry(f.m, 'Fictional additional').querySelectorAll('meter')).toHaveLength(0)
      expect(f.copy).not.toHaveBeenCalled()
      expect(f.signIn).not.toHaveBeenCalled()
      expect(f.save).not.toHaveBeenCalled()
      expect(f.remove).not.toHaveBeenCalled()
    })
  }
}

function warnedReading(
  provider: Provider,
  connectionId: string | undefined,
  usedPercent: number,
): ProviderUsageReading {
  const now = Date.now()
  const resetsAt = now + 3_600_000
  return {
    ...(connectionId === undefined ? {} : { connectionId }),
    window: 'seven_day',
    usedPercent,
    resetsAt,
    at: now,
    period: { word: 'weekly', durationMs: 7 * 24 * 3_600_000, bucket: false, bucketName: null },
    warning: {
      ...readProviderLimit(
        `${provider} is approaching its rate limit (seven_day) — ${usedPercent}% used; resets ${new Date(resetsAt).toISOString()}`,
        now,
      )!,
      meaning: { word: 'weekly', used: usedPercent, untimed: false },
    },
  }
}

for (const provider of ['claude', 'codex'] as const) {
  for (const other of ['api-key', 'additional', 'legacy'] as const) {
    it(`${provider}: a ${other} warning does not belong to the sign-in usage entry`, async () => {
      const own = {
        ...warnedReading(provider, compatibilityConnectionId(provider, 'sign-in'), 29),
        warning: null,
      }
      const foreign = warnedReading(
        provider,
        other === 'api-key'
          ? compatibilityConnectionId(provider, 'api-key')
          : other === 'additional'
            ? 'fictional-additional-sign-in'
            : undefined,
        95,
      )
      const f = await drawer(provider, {
        readings: [foreign, own],
        limit: providerConditions([foreign.warning!], Date.now())[0]!,
        extra: true,
      })
      const row = entry(f.m, 'Fictional sign-in')
      expect(row.querySelector('[data-cy=provider-usage-says]')).toBeNull()
      expect(row.textContent).not.toContain('95%')
      expect(row.textContent).not.toContain('is near')
      expect(row.querySelector('[data-cy=provider-usage-reading]')?.textContent).toContain(
        '29% used',
      )
      expect(
        [...row.querySelectorAll<HTMLMeterElement>('meter:not(.time-meter)')].map(
          (meter) => meter.value,
        ),
      ).toEqual([29])
      expect(entry(f.m, 'Fictional key').querySelector('[data-cy=provider-usage-says]')).toBeNull()
      expect(
        entry(f.m, 'Fictional additional').querySelector('[data-cy=provider-usage-says]'),
      ).toBeNull()
      expect(f.save).not.toHaveBeenCalled()
      expect(f.remove).not.toHaveBeenCalled()
    })
  }

  it(`${provider}: a supplied sign-in warning is visible without a provider-wide condition`, async () => {
    const own = warnedReading(provider, compatibilityConnectionId(provider, 'sign-in'), 84)
    const f = await drawer(provider, { readings: [own], limit: null })
    const warning = entry(f.m, 'Fictional sign-in').querySelector('[data-cy=provider-usage-says]')!
    expect(visible(warning)).toBe(true)
    expect(warning.textContent).toContain('84% used')
    expect(warning.textContent).toContain('1 h')
    expect(warning.classList.contains('warn')).toBe(true)
    expect(warning.getAttribute('title')).toContain(own.warning!.said)
    expect(f.save).not.toHaveBeenCalled()
    expect(f.remove).not.toHaveBeenCalled()
  })

  it(`${provider}: an unattributed reported stop stays in the provider header and is not borrowed by the sign-in entry`, async () => {
    const stop = {
      ...readProviderLimit(`${provider} is rate-limited (seven_day)`, Date.now())!,
      meaning: { word: 'weekly', used: null, untimed: true },
    }
    const own = {
      ...warnedReading(provider, compatibilityConnectionId(provider, 'sign-in'), 29),
      warning: null,
    }
    const f = await drawer(provider, {
      readings: [own],
      limit: providerConditions([stop], Date.now())[0]!,
    })
    const header = f.m.q('provider-at-limit')
    expect(visible(header)).toBe(true)
    expect(header.textContent).toContain('At its limit')
    expect(header.getAttribute('title')).toContain(stop.said)
    const row = entry(f.m, 'Fictional sign-in')
    expect(row.querySelector('[data-cy=provider-usage-says]')).toBeNull()
    expect(row.textContent).not.toMatch(/has reached|At its limit/)
    expect(row.querySelector('[data-cy=provider-usage-reading]')?.textContent).toContain('29% used')
  })
}
