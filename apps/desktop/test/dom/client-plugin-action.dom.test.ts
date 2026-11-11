import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type {
  PluginsClient,
  PluginCard,
  PluginSettingsReply,
  PluginSettingsRequest,
} from '../../src/shared/plugin-settings'
import { PLUGIN_SETTINGS_CHANNEL } from '../../src/shared/plugin-settings-channels'
import { pluginsBridge } from '../../src/preload/plugins'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import { mount, unmountAll } from './harness'

const card: PluginCard = {
  id: 'fictional-fern',
  name: 'Fictional Fern',
  installed: true,
  state: 'Running',
  toolsUnavailable: true,
  action: {
    id: 'reconnect-fern',
    kind: 'restart',
    label: 'Reconnect Fern',
    note: 'Closes the fictional Fern windows.',
    failureAction: 'reconnect Fern',
  },
}
function screen(plugins?: PluginsClient, override?: PluginsClient) {
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => plugins,
  )
  return mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(PluginsSection, { client: override })
      },
    }),
    {},
  )
}
function fixture() {
  let reply: PluginSettingsReply = { ok: true, cards: [card] }
  let action = async (): Promise<PluginSettingsReply> => reply
  const ipc = {
    invoke: vi.fn(async (_channel: string, input: PluginSettingsRequest) =>
      input.kind === 'action' ? action() : input.kind === 'close' ? { ok: true } : reply,
    ),
    on: vi.fn(),
    off: vi.fn(),
  }
  return {
    ipc,
    client: pluginsBridge(ipc),
    setReply(value: PluginSettingsReply) {
      reply = value
    },
    setAction(value: typeof action) {
      action = value
    },
    actions: () => ipc.invoke.mock.calls.filter(([, input]) => input.kind === 'action'),
  }
}
beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Injected Plugins must not reach desktop globals')
    },
  })
})
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

it('keeps loading visible, then sends the supplied fictional action through the real bridge once', async () => {
  const f = fixture()
  let list!: (reply: PluginSettingsReply) => void
  const original = f.ipc.invoke.getMockImplementation()!
  f.ipc.invoke.mockImplementation((channel, input) =>
    input.kind === 'list'
      ? new Promise((resolve) => {
          list = resolve
        })
      : original(channel, input),
  )
  const m = screen(f.client)
  expect(m.all('plugin-card')).toHaveLength(0)
  expect(m.host.textContent).toContain('Loading plugins')
  list({ ok: true, cards: [card] })
  await vi.waitFor(() => expect(m.all('plugin-restart')).toHaveLength(1))
  expect(m.q('plugin-restart').textContent?.trim()).toBe('Reconnect Fern')
  expect(m.q('plugin-restart-note').textContent).toContain(card.action!.note)
  let finish!: (reply: PluginSettingsReply) => void
  f.setAction(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  m.q('plugin-restart').click()
  await nextTick()
  expect((m.q('plugin-restart') as HTMLButtonElement).disabled).toBe(true)
  m.q('plugin-restart').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(f.actions()).toEqual([
    [PLUGIN_SETTINGS_CHANNEL, { kind: 'action', id: card.id, actionId: card.action!.id }],
  ])
  finish({ ok: true, cards: [{ id: card.id, name: card.name, installed: true, state: 'Running' }] })
  await vi.waitFor(() => expect(m.all('plugin-restart')).toHaveLength(0))
  expect(m.all('plugins-error')).toHaveLength(0)
  m.unmount()
  expect(f.ipc.off.mock.calls.map(([channel]) => channel).sort()).toEqual(
    f.ipc.on.mock.calls.map(([channel]) => channel).sort(),
  )
  expect(f.ipc.invoke).toHaveBeenLastCalledWith(PLUGIN_SETTINGS_CHANNEL, { kind: 'close' })
})

it.each(['native-detail', 'rejected', 'missing-cards', 'missing-target'] as const)(
  'reports %s through the injected action flow and releases busy state',
  async (failure) => {
    const f = fixture(),
      m = screen(f.client)
    f.setAction(async () => {
      if (failure === 'rejected') throw new Error('Fictional native rejection')
      if (failure === 'native-detail')
        return {
          ok: false,
          error: 'Plugin unavailable. Try again.',
          detail: 'Fictional Fern host is busy.',
        }
      return failure === 'missing-cards' ? { ok: true } : { ok: true, cards: [] }
    })
    await vi.waitFor(() => expect(m.all('plugin-restart')).toHaveLength(1))
    m.q('plugin-restart').click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    expect(m.q('plugins-error').textContent).toContain(
      failure === 'missing-target'
        ? 'Fictional Fern is still unavailable'
        : "Couldn't reconnect Fern",
    )
    if (failure === 'native-detail')
      expect(m.q('plugins-error').textContent).toContain('Fictional Fern host is busy.')
    if (failure !== 'missing-target')
      expect((m.q('plugin-restart') as HTMLButtonElement).disabled).toBe(false)
    expect(f.actions()).toHaveLength(1)
  },
)

it('ignores an old action reply after disposal and leaves the next view independent', async () => {
  const f = fixture()
  let finish!: (reply: PluginSettingsReply) => void
  f.setAction(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const previous = screen(f.client)
  await vi.waitFor(() => expect(previous.all('plugin-restart')).toHaveLength(1))
  previous.q('plugin-restart').click()
  await nextTick()
  previous.unmount()
  f.setReply({
    ok: true,
    cards: [{ id: card.id, name: card.name, installed: true, state: 'Running' }],
  })
  const current = screen(f.client)
  await vi.waitFor(() => expect(current.all('plugin-card')).toHaveLength(1))
  finish({ ok: false, error: 'Plugin unavailable. Try again.', detail: 'Fictional late failure.' })
  await nextTick()
  await nextTick()
  expect(previous.host.textContent).toBe('')
  expect(current.all('plugins-error')).toHaveLength(0)
  expect(current.all('plugin-restart')).toHaveLength(0)
})

it('keeps an absent injected capability explicit and preserves the existing client prop override', async () => {
  const absent = screen()
  await vi.waitFor(() =>
    expect(absent.host.textContent).toContain("Couldn't load the plugin catalogue"),
  )
  expect(absent.all('plugin-card')).toHaveLength(0)
  const f = fixture(),
    explicit = screen(undefined, f.client)
  await vi.waitFor(() => expect(explicit.all('plugin-restart')).toHaveLength(1))
  expect(f.actions()).toHaveLength(0)
})
