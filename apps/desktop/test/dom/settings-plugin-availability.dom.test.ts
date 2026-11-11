import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { PluginsClient, PluginSettingsReply } from '../../src/shared/plugin-settings'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { settingsWindow } from '../../look/fixtures/settings-window'
import { fictionalPlugins } from '../../look/fixtures/plugins'
import { mount, unmountAll } from './harness'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'

afterEach(() => {
  unmountAll()
  applyTheme(null)
  Reflect.deleteProperty(window, 'api')
})

function availability(
  request: PluginsClient['request'] | undefined,
  explicit?: PluginsClient,
  rawAvailable = false,
) {
  const screen = settingsWindow('plugins', 'classic', explicit)
  const raw = {
    request: vi.fn<PluginsClient['request']>(async () => ({ ok: true, available: rawAvailable })),
    onClosed: vi.fn(() => () => {}),
  }
  window.api = { ...window.api, plugins: raw }
  const controller = request ? { request, onClosed: () => () => {} } : undefined
  const client = createDesktopProviderApi(
    () => window.api.runtime,
    () => undefined,
    undefined,
    undefined,
    undefined,
    () => controller,
  )
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, client)
        return () => h(screen)
      },
    }),
    {},
    { width: 1180, height: 900 },
  )
  return { m, raw, controller }
}

it('uses ancestor availability and the same injected controller for the Plugins tab', async () => {
  const request = vi.fn<PluginsClient['request']>(async (input) =>
    input.kind === 'availability'
      ? { ok: true, available: true }
      : { ok: true, cards: [], listState: 'empty' },
  )
  const { m, raw, controller } = availability(request)
  await vi.waitFor(() => expect(m.all('settings-tab-plugins')).toHaveLength(1))
  await vi.waitFor(() => expect(m.all('plugins-section')).toHaveLength(1))
  expect(request).toHaveBeenCalledWith({ kind: 'availability' })
  expect(request).toHaveBeenCalledWith({ kind: 'list' })
  expect(request.mock.contexts[0]).toBe(controller)
  expect(raw.request).not.toHaveBeenCalled()
})

it('preserves the explicit controller bypass of availability', async () => {
  const explicit = fictionalPlugins()
  const request = vi.fn<PluginsClient['request']>()
  const { m, raw } = availability(request, explicit.client)
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  expect(request).not.toHaveBeenCalled()
  expect(raw.request).not.toHaveBeenCalled()
  expect(explicit.calls.some((input) => input.kind === 'availability')).toBe(false)
})

it.each(['absent', 'refused', 'rejected'] as const)(
  'keeps unavailable Plugins hidden for an injected %s controller',
  async (mode) => {
    const request = vi.fn<PluginsClient['request']>(async () => {
      if (mode === 'rejected') throw new Error('fictional unavailable controller')
      return { ok: false, listState: 'fetch-error' }
    })
    const { m, raw } = availability(mode === 'absent' ? undefined : request, undefined, true)
    await nextTick()
    await vi.waitFor(() => expect(m.all('provider-row').length).toBeGreaterThan(0))
    expect(m.all('settings-tab-plugins')).toHaveLength(0)
    expect(m.all('plugins-section')).toHaveLength(0)
    expect(raw.request).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(mode === 'absent' ? 0 : 1)
  },
)

it('ignores availability arriving after Settings unmounts', async () => {
  let finish!: (reply: PluginSettingsReply) => void
  const reply = new Promise<PluginSettingsReply>((resolve) => (finish = resolve))
  const request = vi.fn<PluginsClient['request']>(() => reply)
  const { m, raw } = availability(request)
  expect(request).toHaveBeenCalledExactlyOnceWith({ kind: 'availability' })
  m.unmount()
  finish({ ok: true, available: true })
  await nextTick()
  expect(request).toHaveBeenCalledTimes(1)
  expect(raw.request).not.toHaveBeenCalled()
  expect(document.querySelector('[data-cy="plugins-section"]')).toBeNull()
})
