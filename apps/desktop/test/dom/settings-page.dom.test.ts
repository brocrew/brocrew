import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref } from 'vue'
import type { ClientApi } from '../../src/shared/client-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { visibleProviderDescriptors } from '@brobot2/shared'
import SettingsScreen, {
  type SettingsTab,
} from '../../src/renderer/src/components/SettingsScreen.vue'
import { useAttentionSignals } from '../../src/renderer/src/composables/useAttentionSignals'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type { AgentIdentities, RuntimeBridge } from '../../src/shared/runtime-ipc'
import {
  STORAGE_PART_IDS,
  type StorageBridge,
  type CacheClearState,
} from '../../src/shared/storage'
import { providersBridge } from '../../look/fixtures/providers'
import { themesBridge } from '../../look/fixtures/themes'
import { mount, unmountAll } from './harness'

const computer = vi.hoisted(() => ({ platform: 'MacIntel' }))
vi.mock('../../src/renderer/src/lib/this-computer', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/lib/this-computer')>()),
  platformHere: () => computer.platform,
}))

const identities: AgentIdentities = {
  identities: [],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const cacheListeners = new Set<(state: CacheClearState | null) => void>()

afterEach(() => {
  unmountAll()
  expect(cacheListeners.size).toBe(0)
  Reflect.deleteProperty(window, 'api')
  useAttentionSignals().value = true
  computer.platform = 'MacIntel'
})

async function settings(
  start: SettingsTab = 'providers',
  retention?: NonNullable<Window['api']['transcriptRetention']>,
  logging?: NonNullable<Window['api']['logging']>,
  client?: ClientApi,
) {
  providersBridge()
  let cacheState: CacheClearState | null = null
  window.api = {
    ...window.api,
    storage: {
      measure: async () => ({
        totalBytes: 0,
        freeBytes: 0,
        measuredAt: 1,
        partial: false,
        parts: STORAGE_PART_IDS.map((id) => ({ id, bytes: 0, partial: false })),
      }),
      children: async (location) => ({
        location,
        entries: [],
        smallerCount: 0,
        smallerBytes: 0,
        totalBytes: 0,
        partial: false,
      }),
      reveal: async () => ({ ok: true }),
      clearCache: async () => {
        const operation = { id: (cacheState?.id ?? 0) + 1, status: 'complete' as const }
        cacheState = operation
        for (const onState of cacheListeners) onState(operation)
        return { ok: true, operation }
      },
      watchCacheClear: (onState) => {
        cacheListeners.add(onState)
        onState(cacheState)
        return () => {
          cacheListeners.delete(onState)
        }
      },
      pruneBackups: async () => ({ ok: true }),
    } satisfies StorageBridge,
    logging: logging ?? {
      getLogging: async () => ({
        debug: false,
        path: '/fictional/app/logs/brocrew.log',
        servicePath: null,
      }),
      setLoggingDebug: async (debug) => ({
        debug,
        path: '/fictional/app/logs/brocrew.log',
        servicePath: null,
      }),
    },
  }
  if (retention) window.api = { ...window.api, transcriptRetention: retention }
  themesBridge('brocrew')
  const store = createAgentStore({ agentIdentities: async () => identities } as RuntimeBridge)
  await store.load()
  const tab = ref<SettingsTab>(start)
  const owner = defineComponent({
    setup() {
      if (client) provide(CLIENT_PROVIDERS, client)
      return () =>
        h(SettingsScreen, {
          tab: tab.value,
          capabilities: null,
          warnings: null,
          clock: Date.now(),
          store,
          'onUpdate:tab': (next: SettingsTab) => (tab.value = next),
        })
    },
  })
  const m = mount(owner, {}, { width: 1000, height: 800 })
  await nextTick()
  return { m, tab }
}

it('opens Providers by default and moves the existing Settings content between tabs', async () => {
  const { m, tab } = await settings()
  expect(m.q('settings-screen').querySelector('h1')?.textContent).toBe('Settings')
  const providers = visibleProviderDescriptors(false)
  expect(m.all('provider-row').map((row) => row.dataset['provider'])).toEqual(
    providers.map((provider) => provider.id),
  )
  expect(m.all('provider-card')).toHaveLength(0)
  expect(m.all('kept-rules')).toHaveLength(0)
  m.q('provider-row').click()
  await vi.waitFor(() => expect(m.all('provider-card')).toHaveLength(1))
  expect(m.q('provider-card').dataset['provider']).toBe(providers[0]!.id)
  expect(m.all('kept-rules')).toHaveLength(1)
  expect(m.q('kept-rules-provider').dataset['provider']).toBe(providers[0]!.id)
  m.q('provider-drawer').querySelector<HTMLButtonElement>('.drawer-close')!.click()
  await nextTick()
  expect(m.all('provider-card')).toHaveLength(0)
  expect(m.all('kept-rules')).toHaveLength(0)
  expect(m.all('tools-register')).toHaveLength(0)
  m.q('settings-tab-tools').click()
  await nextTick()
  expect(tab.value).toBe('tools')
  expect(m.all('tools-register')).toHaveLength(1)
  expect(m.all('provider-row')).toHaveLength(0)
  expect(m.all('provider-card')).toHaveLength(0)
  expect(m.all('provider-drawer')).toHaveLength(0)
  m.q('settings-tab-skills').click()
  await nextTick()
  expect(m.all('skills-section')).toHaveLength(1)
  m.q('settings-tab-themes').click()
  await nextTick()
  expect(m.all('themes-section')).toHaveLength(1)
  m.q('settings-tab-general').click()
  await nextTick()
  expect(m.all('debug-mode')).toHaveLength(1)
  expect(m.all('attention-signals')).toHaveLength(1)
  expect(m.all('themes-section')).toHaveLength(0)
})

it('keeps attention signals independent of the debug mode preference', async () => {
  const { m } = await settings('general')
  await vi.waitFor(() =>
    expect((m.q('debug-mode-switch') as HTMLInputElement).disabled).toBe(false),
  )
  const attention = m.q('attention-signals-switch') as HTMLInputElement
  attention.click()
  await nextTick()
  expect(useAttentionSignals().value).toBe(false)
  expect((m.q('debug-mode-switch') as HTMLInputElement).checked).toBe(false)
})

it('shows the saved choice and the full log path, and saves a change', async () => {
  const path = '/fictional/very long workspace folder/logs/brocrew.log'
  const servicePath = '/fictional/plugins/service.log'
  const setLoggingDebug = vi.fn(async (debug: boolean) => ({ debug, path, servicePath }))
  const logging = {
    getLogging: async () => ({ debug: true, path, servicePath }),
    setLoggingDebug,
  }
  const raw = {
    getLogging: vi.fn(async () => ({ debug: false, path: '/wrong/window.log', servicePath: null })),
    setLoggingDebug: vi.fn(async () => ({
      debug: false,
      path: '/wrong/window.log',
      servicePath: null,
    })),
  }
  const client = createDesktopProviderApi(
    () => window.api.runtime,
    () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => logging,
  )
  const { m } = await settings('general', undefined, raw, client)
  const toggle = m.q('debug-mode-switch') as HTMLInputElement
  await vi.waitFor(() => expect(toggle.checked).toBe(true))
  expect(m.q('log-path').textContent).toContain(path)
  expect(m.q('log-service-path').textContent).toContain(servicePath)
  expect(m.q('debug-mode').textContent).toContain('Errors are always logged')
  toggle.click()
  await vi.waitFor(() => expect(setLoggingDebug).toHaveBeenCalledWith(false))
  expect(raw.getLogging).not.toHaveBeenCalled()
  expect(raw.setLoggingDebug).not.toHaveBeenCalled()
})

it('keeps the switch disabled until the read arrives', async () => {
  let resolve!: (state: { debug: boolean; path: string; servicePath: null }) => void
  const answer = new Promise<{ debug: boolean; path: string; servicePath: null }>((done) => {
    resolve = done
  })
  const { m } = await settings('general', undefined, {
    getLogging: () => answer,
    setLoggingDebug: vi.fn(),
  })
  const toggle = m.q('debug-mode-switch') as HTMLInputElement
  expect(toggle.disabled).toBe(true)
  expect(m.all('log-path')).toHaveLength(0)
  resolve({ debug: false, path: '/fictional/logs/brocrew.log', servicePath: null })
  await vi.waitFor(() => expect(toggle.disabled).toBe(false))
  expect(m.all('log-service-path')).toHaveLength(0)
})

it('retries a failed read and restores the checkbox after a failed save', async () => {
  const state = { debug: false, path: '/fictional/logs/brocrew.log', servicePath: null }
  const getLogging = vi
    .fn()
    .mockRejectedValueOnce(new Error('read failed'))
    .mockResolvedValue(state)
  const setLoggingDebug = vi.fn().mockRejectedValue(new Error('write failed'))
  const { m } = await settings('general', undefined, { getLogging, setLoggingDebug })
  await vi.waitFor(() => expect(m.all('log-error')).toHaveLength(1))
  const toggle = m.q('debug-mode-switch') as HTMLInputElement
  expect(toggle.disabled).toBe(true)
  m.q('log-retry').click()
  await vi.waitFor(() => expect(toggle.disabled).toBe(false))
  toggle.click()
  await vi.waitFor(() => expect(m.q('log-error').textContent).toContain('Could not save'))
  expect(toggle.checked).toBe(false)
})

it('says the Windows taskbar action on Windows, without changing the switch', async () => {
  computer.platform = 'Win32'
  const { m } = await settings('general')
  expect(m.q('attention-signals').textContent).toContain(
    'When BroCrew is in the background, flash the taskbar button and show the count.',
  )
  expect((m.q('attention-signals-switch') as HTMLInputElement).checked).toBe(true)
})

it('says what Linux desktops can support without promising a Dock or taskbar', async () => {
  computer.platform = 'Linux x86_64'
  const { m } = await settings('general')
  expect(m.q('attention-signals').textContent).toContain(
    'When BroCrew is in the background, show the count on its icon where your desktop supports it.',
  )
})

it('keeps the switch thumb on its own side in both drawn states', async () => {
  const { m } = await settings('general')
  const toggle = m.q('attention-signals-switch') as HTMLInputElement
  const on = getComputedStyle(toggle)
  const onPosition = on.backgroundPosition
  expect(on.backgroundRepeat).toBe('no-repeat')
  expect(on.backgroundSize).toBe('18px 18px')
  expect(onPosition).toMatch(/(?:right|100%)/)

  toggle.click()
  await nextTick()
  const off = getComputedStyle(toggle)
  expect(off.backgroundRepeat).toBe('no-repeat')
  expect(off.backgroundSize).toBe('18px 18px')
  expect(off.backgroundPosition).toMatch(/(?:left|2px)/)
  expect(off.backgroundPosition).not.toBe(onPosition)
})

it('keeps a chosen picture non-repeating and pixelated on the real Settings page', async () => {
  const root = document.documentElement
  root.style.setProperty(
    '--conversation-bg-image',
    'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%222%22 height=%222%22/%3E")',
  )
  root.style.setProperty('--conversation-bg-repeat', 'no-repeat')
  root.style.setProperty('--conversation-bg-rendering', 'pixelated')
  try {
    const { m } = await settings('general')
    const style = getComputedStyle(m.q('settings-screen'))
    expect(style.backgroundImage).toContain('data:image/svg+xml')
    expect(style.backgroundRepeat).toBe('no-repeat')
    expect(style.imageRendering).toBe('pixelated')
  } finally {
    root.style.removeProperty('--conversation-bg-image')
    root.style.removeProperty('--conversation-bg-repeat')
    root.style.removeProperty('--conversation-bg-rendering')
  }
})

it('moves tab focus with arrows, Home and End while keeping just one tab selected', async () => {
  const { m, tab } = await settings()
  const key = async (id: SettingsTab, pressed: string, prevented = true) => {
    const event = new KeyboardEvent('keydown', { key: pressed, bubbles: true, cancelable: true })
    m.q(`settings-tab-${id}`).dispatchEvent(event)
    await nextTick()
    expect(event.defaultPrevented).toBe(prevented)
  }
  await key('providers', 'ArrowRight')
  expect(tab.value).toBe('tools')
  expect(document.activeElement).toBe(m.q('settings-tab-tools'))
  await key('tools', 'End')
  expect(tab.value).toBe('storage')
  await key('storage', 'Home')
  expect(tab.value).toBe('providers')
  expect(m.all('settings-tab-plugins')).toHaveLength(0)
  await key('providers', 'Home')
  await key('providers', 'ArrowRight')
  await key('tools', 'ArrowRight')
  await key('skills', 'ArrowRight')
  expect(tab.value).toBe('themes')
  expect(document.activeElement).toBe(m.q('settings-tab-themes'))
  await key('themes', 'Home')
  await key('providers', 'ArrowLeft')
  expect(tab.value).toBe('storage')
  expect(document.activeElement).toBe(m.q('settings-tab-storage'))
  await key('storage', 'ArrowRight')
  expect(tab.value).toBe('providers')
  for (const ignored of ['ArrowUp', 'ArrowDown', 'Enter']) {
    await key('providers', ignored, false)
    expect(tab.value).toBe('providers')
  }
  expect(m.host.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1)
})

it('keeps agents transcripts for the saved period, with 90 days as the default', async () => {
  let kept: 30 | 90 | 365 | 'forever' = 90
  const bridge = {
    read: vi.fn(async () => kept),
    set: vi.fn(async (value: typeof kept) => (kept = value)),
  }
  const { m } = await settings('general', bridge)
  const select = m.q('transcript-retention-period') as HTMLSelectElement
  await vi.waitFor(() => expect(select.disabled).toBe(false))
  expect(m.q('transcript-retention').textContent).toContain("Keep agents' transcripts")
  expect(m.q('transcript-retention').textContent?.replace(/\s+/g, ' ')).toContain(
    "A conversation unused for this long has its transcript deleted to save space. It stays here, but its agent can't pick it up again.",
  )
  expect([...select.options].map((option) => option.textContent)).toEqual([
    '30 days',
    '90 days',
    '1 year',
    'Forever',
  ])
  expect(select.value).toBe('90')
  for (const value of ['30', '365', 'forever']) {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => {
      expect(select.disabled).toBe(false)
      expect(select.value).toBe(value)
    })
    expect(String(kept)).toBe(value)
  }
  m.unmount()
  const again = await settings('general', bridge)
  await vi.waitFor(() =>
    expect((again.m.q('transcript-retention-period') as HTMLSelectElement).value).toBe('forever'),
  )
})
it('a failed transcript retention save restores what was actually kept', async () => {
  const { m } = await settings('general', {
    read: async () => 90,
    set: async () => {
      throw new Error('fictional disk refusal')
    },
  })
  const select = m.q('transcript-retention-period') as HTMLSelectElement
  await vi.waitFor(() => expect(select.disabled).toBe(false))
  select.value = '30'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() =>
    expect(m.q('transcript-retention').textContent).toContain("That didn't work. Try again."),
  )
  expect(select.value).toBe('90')
})

it('saves the new-conversation default and preserves the confirmed value on refusal', async () => {
  providersBridge()
  let answer: (value: { defaultApprovalMode: 'ask' | 'auto' }) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const save = vi.fn(
    () =>
      new Promise<{ defaultApprovalMode: 'ask' | 'auto' }>((resolve, reject) => {
        answer = resolve
        fail = reject
      }),
  )
  const store = createAgentStore({
    ...window.api.runtime,
    agentIdentities: async () => ({ ...identities, defaultApprovalModeChosen: false }),
    setDefaultApprovalMode: save,
  })
  await store.load()
  const m = mount(
    SettingsScreen,
    { tab: 'general', capabilities: null, warnings: null, clock: 0, store },
    { width: 1000, height: 900 },
  )
  const input = m.q('settings-approval-switch') as HTMLInputElement
  input.click()
  await nextTick()
  expect(save).toHaveBeenLastCalledWith({ mode: 'auto' })
  expect(input.disabled).toBe(true)
  expect(input.checked).toBe(false)
  fail(new Error('Could not save the default.'))
  await vi.waitFor(() => expect(input.disabled).toBe(false))
  expect(input.checked).toBe(false)
  expect(m.q('settings-approval-default').querySelector('[role="alert"]')?.textContent).toContain(
    'Could not save',
  )
  input.click()
  await nextTick()
  answer({ defaultApprovalMode: 'auto' })
  await vi.waitFor(() => expect(input.checked).toBe(true))
  expect(store.identities.value?.defaultApprovalModeChosen).toBe(true)
  input.click()
  await nextTick()
  expect(save).toHaveBeenLastCalledWith({ mode: 'ask' })
  answer({ defaultApprovalMode: 'ask' })
  await vi.waitFor(() => expect(input.checked).toBe(false))
  expect(m.q('settings-approval-default').querySelector('[role="alert"]')).toBeNull()
})
