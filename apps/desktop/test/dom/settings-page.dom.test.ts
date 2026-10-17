import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import SettingsScreen, {
  type SettingsTab,
} from '../../src/renderer/src/components/SettingsScreen.vue'
import { useAttentionSignals } from '../../src/renderer/src/composables/useAttentionSignals'
import { useDebugMode } from '../../src/renderer/src/composables/useDebugMode'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import type { AgentIdentities, RuntimeBridge } from '../../src/shared/runtime-ipc'
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

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
  useAttentionSignals().value = true
  useDebugMode().value = false
  computer.platform = 'MacIntel'
})

async function settings(
  start: SettingsTab = 'providers',
  retention?: NonNullable<Window['api']['transcriptRetention']>,
) {
  providersBridge()
  if (retention) window.api = { ...window.api, transcriptRetention: retention }
  themesBridge('brocrew')
  const store = createAgentStore({ agentIdentities: async () => identities } as RuntimeBridge)
  await store.load()
  const tab = ref<SettingsTab>(start)
  const owner = defineComponent({
    setup: () => () =>
      h(SettingsScreen, {
        tab: tab.value,
        capabilities: null,
        warnings: null,
        clock: Date.now(),
        store,
        'onUpdate:tab': (next: SettingsTab) => (tab.value = next),
      }),
  })
  const m = mount(owner, {}, { width: 1000, height: 800 })
  await nextTick()
  return { m, tab }
}

it('opens Providers by default and moves the existing content between four tabs', async () => {
  const { m, tab } = await settings()
  expect(m.q('settings-screen').querySelector('h1')?.textContent).toBe('Settings')
  expect(m.all('provider-card')).toHaveLength(2)
  expect(m.all('kept-rules')).toHaveLength(1)
  expect(m.all('tools-register')).toHaveLength(0)
  m.q('settings-tab-tools').click()
  await nextTick()
  expect(tab.value).toBe('tools')
  expect(m.all('tools-register')).toHaveLength(1)
  expect(m.all('provider-card')).toHaveLength(0)
  m.q('settings-tab-themes').click()
  await nextTick()
  expect(m.all('themes-section')).toHaveLength(1)
  m.q('settings-tab-general').click()
  await nextTick()
  expect(m.all('debug-mode')).toHaveLength(1)
  expect(m.all('attention-signals')).toHaveLength(1)
  expect(m.all('themes-section')).toHaveLength(0)
})

it('keeps both General switches bound to the window preferences', async () => {
  useAttentionSignals().value = true
  useDebugMode().value = false
  const { m } = await settings('general')
  const attention = m.q('attention-signals-switch') as HTMLInputElement
  const debug = m.q('debug-mode-switch') as HTMLInputElement
  expect(attention.checked).toBe(true)
  expect(debug.checked).toBe(false)
  attention.click()
  debug.click()
  await nextTick()
  expect(useAttentionSignals().value).toBe(false)
  expect(useDebugMode().value).toBe(true)
  expect(m.q('attention-signals').textContent).toContain(
    'When BroCrew is in the background, bounce the Dock icon once and show the count.',
  )
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
  const key = async (id: SettingsTab, pressed: string) => {
    m.q(`settings-tab-${id}`).dispatchEvent(
      new KeyboardEvent('keydown', { key: pressed, bubbles: true }),
    )
    await nextTick()
  }
  await key('providers', 'ArrowRight')
  expect(tab.value).toBe('tools')
  expect(document.activeElement).toBe(m.q('settings-tab-tools'))
  await key('tools', 'End')
  expect(tab.value).toBe('general')
  await key('general', 'Home')
  expect(tab.value).toBe('providers')
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
