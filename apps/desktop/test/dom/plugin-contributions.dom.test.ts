import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, unmountAll } from './harness'
import PluginContributions from '../../src/renderer/src/components/PluginContributions.vue'
import type { PluginHostClient, PluginHostSnapshot } from '../../src/shared/plugin-host'

afterEach(() => unmountAll())
it('shows the canonical workspace switch and restores its confirmed value after a failed write', async () => {
  const state: PluginHostSnapshot = {
    plugins: [{ pluginId: 'orbit-notes', name: 'Fictional notes', enabled: true }],
    contributions: [],
    notifications: [],
  }
  const request = vi.fn(async (input) => {
    structuredClone(input)
    return structuredClone(
      input.kind === 'snapshot'
        ? { value: state }
        : { error: { code: 'error' as const, message: 'The fictional preference was not saved.' } },
    )
  })
  const client: PluginHostClient = { request, onChanged: () => () => {} }
  const m = mount(PluginContributions, { client, surface: 'settings' }, { width: 520, height: 180 })
  await vi.waitFor(() => expect(m.all('plugin-workspace-enabled')).toHaveLength(1))
  const input = m.q('plugin-workspace-enabled') as HTMLInputElement
  expect(input.checked).toBe(true)
  input.click()
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      kind: 'enabled',
      pluginId: 'orbit-notes',
      enabled: false,
    }),
  )
  await vi.waitFor(() =>
    expect(m.q('plugin-contribution-error').textContent).toBe(
      'The fictional preference was not saved.',
    ),
  )
  expect(input.checked).toBe(true)
})
it('mounts generic buttons and notifications, forwards plain callback handles and removes switched-off effects', async () => {
  let update!: () => void
  let state: PluginHostSnapshot = {
    contributions: [
      {
        handle: 'button',
        pluginId: 'orbit-notes',
        contributionId: 'save',
        kind: 'ui.button',
        state: 'active',
        definition: {
          slot: 'composer.accessory',
          view: { label: 'Save a fictional note', tooltip: 'Open your collection' },
          invoke: { tool: 'save' },
        },
        titlesEnabled: false,
      },
    ],
    notifications: [
      {
        handle: 'notice',
        pluginId: 'orbit-notes',
        notificationId: 'saved',
        title: 'Fictional note saved',
        text: 'Your collection is ready.',
        level: 'info',
        actions: [{ id: 'open', label: 'Open collection' }],
      },
    ],
  }
  const request = vi.fn(async (input) => {
    structuredClone(input)
    return { value: input.kind === 'snapshot' ? structuredClone(state) : {} }
  })
  const client: PluginHostClient = {
    request,
    onChanged(listener) {
      update = listener
      return () => {}
    },
  }
  const m = mount(PluginContributions, { client, surface: 'composer' }, { width: 520, height: 300 })
  await vi.waitFor(() => expect(m.all('plugin-contribution-button')).toHaveLength(1))
  m.q('plugin-contribution-button').click()
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith({ kind: 'activate', handle: 'button' }),
  )
  expect(m.q('plugin-notification').textContent).toContain('Your collection is ready.')
  m.q('plugin-notification-action').click()
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      kind: 'notification-action',
      handle: 'notice',
      actionId: 'open',
    }),
  )
  state = { contributions: [{ ...state.contributions[0]!, state: 'inactive' }], notifications: [] }
  update()
  await vi.waitFor(() => expect(m.all('plugin-notification')).toHaveLength(0))
  expect(m.all('plugin-contribution-button')).toHaveLength(0)
})
it('shows settings and the explicit titles switch, leaves reserved services unavailable and reports callback failures', async () => {
  const state: PluginHostSnapshot = {
    contributions: [
      {
        handle: 'settings',
        pluginId: 'orbit-notes',
        contributionId: 'preferences',
        kind: 'settings.page',
        state: 'active',
        definition: { title: 'Fictional notes', entry: 'settings.html', assets: ['settings.html'] },
        titlesEnabled: false,
      },
      {
        handle: 'titles',
        pluginId: 'orbit-notes',
        contributionId: 'titles',
        kind: 'turn.context.titles',
        state: 'active',
        definition: { invoke: { tool: 'titles' } },
        titlesEnabled: false,
      },
      {
        handle: 'speech',
        pluginId: 'orbit-notes',
        contributionId: 'voice',
        kind: 'speech.transcribe',
        state: 'unsupported',
        definition: { label: 'Local voice' },
        titlesEnabled: false,
      },
    ],
    notifications: [],
  }
  const request = vi.fn(async (input) => {
    structuredClone(input)
    return input.kind === 'snapshot'
      ? { value: structuredClone(state) }
      : { error: { code: 'error' as const, message: 'The fictional callback failed.' } }
  })
  const client: PluginHostClient = { request, onChanged: () => () => {} }
  const m = mount(PluginContributions, { client, surface: 'settings' }, { width: 520, height: 400 })
  await vi.waitFor(() => expect(m.all('plugin-titles-enabled')).toHaveLength(1))
  expect((m.q('plugin-titles-enabled') as HTMLInputElement).checked).toBe(false)
  m.q('plugin-titles-enabled').click()
  await nextTick()
  await vi.waitFor(() =>
    expect(m.q('plugin-contribution-error').textContent).toContain(
      'The fictional callback failed.',
    ),
  )
  expect((m.q('plugin-titles-enabled') as HTMLInputElement).checked).toBe(false)
  expect(request).toHaveBeenCalledWith({
    kind: 'titles-enabled',
    pluginId: 'orbit-notes',
    enabled: true,
  })
  expect(m.q('plugin-contributions').textContent).toContain(
    'Local voice is unavailable in this app.',
  )
})
it('shows the actionable protocol message from button and notification callbacks', async () => {
  const state: PluginHostSnapshot = {
    contributions: [
      {
        handle: 'button',
        pluginId: 'orbit-notes',
        contributionId: 'save',
        kind: 'ui.button',
        state: 'active',
        definition: {
          slot: 'composer.accessory',
          view: { label: 'Save fictional note' },
          invoke: { tool: 'notes_save' },
        },
        titlesEnabled: false,
      },
    ],
    notifications: [
      {
        handle: 'notice',
        pluginId: 'orbit-notes',
        notificationId: 'choose',
        title: 'Choose a collection',
        text: 'Save your fictional note.',
        level: 'info',
        actions: [{ id: 'save', label: 'Save note' }],
      },
    ],
  }
  const message = 'MCP error -32000: Select a fictional collection'
  const failure = {
    error: {
      code: 'protocol-error' as const,
      message,
      protocol: { code: -32000, message, data: { choices: ['fictional-drafts'] } },
    },
  }
  const request = vi.fn(async (input) => {
    structuredClone(input)
    return structuredClone(input.kind === 'snapshot' ? { value: state } : failure)
  })
  const client: PluginHostClient = { request, onChanged: () => () => {} }
  const m = mount(PluginContributions, { client, surface: 'composer' }, { width: 520, height: 350 })
  await vi.waitFor(() => expect(m.all('plugin-contribution-button')).toHaveLength(1))
  m.q('plugin-contribution-button').click()
  await vi.waitFor(() => expect(m.q('plugin-contribution-error').textContent).toBe(message))
  m.q('plugin-notification-action').click()
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      kind: 'notification-action',
      handle: 'notice',
      actionId: 'save',
    }),
  )
  await vi.waitFor(() => expect(m.q('plugin-contribution-error').textContent).toBe(message))
})
