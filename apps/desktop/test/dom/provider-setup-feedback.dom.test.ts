import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import ProviderSetupWizard from '../../src/renderer/src/components/ProviderSetupWizard.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import type { LimitsDisplayState } from '../../src/renderer/src/lib/limits-display'
import type {
  AuthState,
  Provider,
  ProviderCapabilityMap,
  ProviderVersion,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

const NOW = Date.UTC(2026, 9, 24, 12)
const USABLE: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const ABSENT: AuthState = { state: 'absent', why: 'no-login', reason: 'No fictional login.' }
const UNKNOWN: AuthState = { state: 'unknown', reason: 'The fictional login could not be read.' }
const EXPIRED: AuthState = {
  state: 'absent',
  why: 'expired',
  reason: 'The fictional login expired.',
}
const PROGRAM: ProviderVersion = {
  version: '2.1.290',
  program: {
    standing: 'tested',
    from: 'native-installer',
    path: 'C:\\Users\\Example Tester\\.local\\bin\\claude.exe',
    version: '2.1.290',
    tested: { oldest: '2.1.257', newest: '2.1.290' },
    said: 'A tested fictional program.',
    help: null,
    update: null,
    others: [],
    updatedFrom: null,
  },
}
const COMMAND = "& 'C:\\Users\\Example O''Tester\\.local\\bin\\claude.exe'"
const INSTRUCTIONS =
  'If Claude Code opens at its interactive prompt, type /login there, not in PowerShell. Finish signing in in your browser, then return to BroCrew and check the sign-in again.'

const settled = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}
const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
  Reflect.deleteProperty(navigator, 'clipboard')
})

function limits(): LimitsDisplayState {
  return {
    status: 'ready',
    reading: {
      operation: 1,
      databaseEpoch: 1,
      signInEpoch: 1,
      pinStartedAt: NOW,
      pinFinishedAt: NOW,
      evaluatedAt: NOW,
      usageAt: NOW,
      finishedAt: NOW,
      walked: {
        walk: 'every-provider-wall-recently-recorded',
        rows: [],
        ledgers: 1,
        rowsUnread: 0,
      },
    },
  }
}

function card(provider: Provider = 'claude') {
  const auth = ref<AuthState>(ABSENT)
  const copied: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => void copied.push(value) },
  })
  const runtime = {
    checkProviderAuth: vi.fn(async () => auth.value),
    apiKeyStatus: vi.fn(async () => ({ provider, set: false, setAt: null, inUse: false })),
    signInProvider: vi.fn(async () => ({ success: true, state: USABLE })),
    reprovisionProviderAuth: vi.fn(),
    cancelProviderSignIn: vi.fn(),
  }
  ;(window as unknown as { api: unknown }).api = { runtime }
  const access = { state: 'absent', reason: 'Use the external tool.', checkedAgainst: 'fictional' }
  const capabilities = {
    [provider]: {
      signIn: provider === 'codex' ? { state: 'available' } : access,
      reprovisionAuth: access,
    },
  } as unknown as ProviderCapabilityMap
  const props = reactive({
    provider,
    capabilities,
    limit: null,
    limitsRead: true,
    limitsDisplay: limits(),
    clock: NOW,
    version: PROGRAM as ProviderVersion,
    readings: [],
    resources: null,
    resourcesPaused: false,
    resourcesError: null,
    loginMoved: 0,
    lists: createModelLists(() => ({
      modelList: async () => ({
        provider,
        notAsked: null,
        standIn: null,
        models: [],
        lastPicked: null,
        startsOn: null,
      }),
      addHandAddedModel: async () => [],
      deleteHandAddedModel: async () => [],
    })),
    setup: {
      tool: 'Claude Code',
      install: { command: 'fictional-install', docs: 'https://example.invalid/setup' },
      signInCommand: COMMAND,
      signInInstructions: INSTRUCTIONS,
      platform: 'Windows' as const,
      shell: 'PowerShell' as const,
    },
    readVersions: vi.fn(async () => undefined),
  })
  const host = defineComponent({ setup: () => () => h(ProviderCard, { ...props }) })
  const m = mount(host, {}, { width: 760, height: 1400 })
  return { m, auth, runtime, props, copied }
}

async function begin(m: Mounted) {
  if (m.all('provider-options').length) {
    m.q('provider-options').click()
    await settled()
  }
  m.q('provider-set-up').click()
  await settled()
}

async function failCheck(out: ReturnType<typeof card>, failed: AuthState = ABSENT) {
  await settled()
  await begin(out.m)
  out.m.q('setup-sign-in').click()
  await settled()
  out.auth.value = failed
  out.m.q('setup-check').click()
  await settled()
  expect(out.m.all('setup-done')).toHaveLength(0)
  expect(words(out.m.q('provider-inline-setup'))).toContain('Not connected yet')
}

function cancel(m: Mounted) {
  const button = [...m.q('provider-inline-setup').querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === 'Cancel',
  )!
  button.click()
}

describe('setup feedback follows the latest facts', () => {
  it.each([ABSENT, UNKNOWN, EXPIRED])(
    'drops an obsolete $state check failure from Done and the normal Login section',
    async (failed) => {
      const out = card()
      await failCheck(out, failed)
      out.auth.value = USABLE
      out.m.q('setup-check').click()
      await settled()
      expect(words(out.m.q('setup-ready'))).toBe('Claude is ready.')
      expect(words(out.m.q('provider-inline-setup'))).not.toContain('Not connected yet')
      out.m.q('setup-done').click()
      await settled()
      expect(words(out.m.q('provider-standing'))).toBe('Ready')
      expect(words(out.m.q('provider-status'))).not.toContain('Not connected yet')
    },
  )

  it.each(['check-again', 'login-change'] as const)(
    'drops obsolete feedback when %s updates Login after leaving setup',
    async (event) => {
      const out = card()
      await failCheck(out)
      cancel(out.m)
      await settled()
      out.auth.value = USABLE
      if (event === 'check-again') out.m.q('sign-in-check').click()
      else out.props.loginMoved++
      await settled()
      expect(words(out.m.q('provider-standing'))).toBe('Ready')
      expect(words(out.m.q('provider-status'))).not.toContain('Not connected yet')
    },
  )

  it('keeps a real sign-in completion notice through a readiness check and Done', async () => {
    const out = card('codex')
    await settled()
    await begin(out.m)
    out.m.q('setup-sign-in').click()
    await settled()
    out.auth.value = USABLE
    out.m.q('setup-check').click()
    await settled()
    out.m.q('setup-done').click()
    await settled()
    expect(words(out.m.q('provider-auth-notice'))).toBe('Signed in to Codex.')
  })

  it('clears the inline failure when a login-change check becomes usable', async () => {
    const out = card()
    await failCheck(out)
    out.auth.value = USABLE
    out.props.loginMoved++
    await settled()
    expect(words(out.m.q('provider-inline-setup'))).not.toContain('Not connected yet')
    expect(out.m.all('setup-done')).toHaveLength(0)
    out.m.q('setup-check').click()
    await settled()
    expect(out.m.all('setup-done')).toHaveLength(1)
  })

  it('keeps a genuine program failure after the local sign-in becomes usable', async () => {
    const out = card()
    await failCheck(out)
    out.auth.value = USABLE
    out.props.version = {
      ...PROGRAM,
      program: {
        ...PROGRAM.program!,
        standing: 'missing',
        said: 'The fictional program is missing.',
      },
    }
    await settled()
    expect(out.m.all('setup-done')).toHaveLength(0)
    expect(out.m.all('provider-inline-setup')).toHaveLength(0)
    expect(out.m.q('install-missing').textContent).toContain('isn’t installed.')
    expect(out.m.q('install-program').textContent).toContain('Install')
  })

  it('explains the interactive login step without changing the quoted PowerShell command', async () => {
    const out = card()
    await settled()
    await begin(out.m)
    out.m.q('setup-sign-in').click()
    await settled()
    expect(words(out.m.q('setup-command'))).toBe(COMMAND)
    out.m.q('setup-copy').click()
    await settled()
    expect(out.copied).toEqual([COMMAND])
    expect(words(out.m.q('provider-inline-setup'))).toContain(INSTRUCTIONS)
    expect(out.runtime.signInProvider).not.toHaveBeenCalled()
  })

  it('also shows the interactive instructions in the step-by-step guide', async () => {
    const out = card()
    unmountAll()
    const external = {
      state: 'absent' as const,
      reason: 'Use the tool.',
      checkedAgainst: 'fictional',
    }
    const m = mount(ProviderSetupWizard, {
      provider: 'claude',
      version: PROGRAM,
      setup: out.props.setup,
      auth: ABSENT,
      keyRefused: false,
      signIn: external,
      reprovision: external,
      busy: 'idle',
      notice: null,
      recheck: async () => undefined,
    })
    await settled()
    expect(words(m.q('setup-says'))).toContain(INSTRUCTIONS)
    expect(words(m.q('setup-command'))).toBe(COMMAND)
    m.q('setup-copy').click()
    await settled()
    expect(out.copied).toEqual([COMMAND])
  })
})

describe('usage readings and recorded warnings are separate evidence', () => {
  it('calls unread usage unknown and labels empty warning history without claiming allowance', async () => {
    const out = card()
    await settled()
    expect(words(out.m.q('provider-usage-none'))).toBe(
      'Usage is unknown. No reading yet from Claude.',
    )
    expect(out.m.all('provider-limits-reading')).toHaveLength(0)
    expect(words(out.m.q('provider-usage-says'))).toMatch(/^No limit warnings recorded as of /)
    expect(words(out.m.q('provider-usage-says'))).not.toContain('No limits reported')
  })

  it.each(['unavailable', 'updating', 'unread-rows', 'skipped-ledger', 'no-ledger'] as const)(
    'never treats %s as an empty complete warning history',
    async (failure) => {
      const out = card()
      const display = limits()
      const reading = display.reading!
      out.props.limitsDisplay =
        failure === 'unavailable' || failure === 'updating'
          ? { ...display, status: failure }
          : {
              ...display,
              reading: {
                ...reading,
                walked: {
                  ...reading.walked,
                  ...(failure === 'unread-rows' ? { rowsUnread: 1 } : {}),
                  ...(failure === 'skipped-ledger' ? { ledgersSkipped: 1 } : {}),
                  ...(failure === 'no-ledger' ? { walk: 'no-ledger' as const } : {}),
                },
              },
            }
      await settled()
      expect(out.m.all('provider-limits-reading')).toHaveLength(0)
      expect(words(out.m.q('provider-usage-says'))).not.toContain('No limit warnings recorded')
      expect(out.m.all('provider-usage-reading')).toHaveLength(0)
    },
  )
})
