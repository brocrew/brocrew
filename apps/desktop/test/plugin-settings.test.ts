import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { registerPluginSettings, type PluginSettingsController } from '../src/main/plugins/settings'
import { chromeUiFixture, FICTIONAL_CHROME } from './chrome-ui-fixture'
import { pluginsBridge } from '../src/preload/plugins'
import {
  PLUGIN_SETTINGS_CHANNEL,
  PLUGIN_SCREEN_CLOSED,
  type PluginCard,
} from '../src/shared/plugin-settings'
const fake = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: fake.open }))
afterEach(() => vi.clearAllMocks())
function setup(available = false, missing = false) {
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1180, height: 900 }),
    webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  })
  const contents = Object.assign(new EventEmitter(), {})
  const view = { webContents: contents, setBounds: vi.fn() }
  const close = vi.fn(async () => {
    contents.emit('destroyed')
  })
  fake.open.mockImplementation(async () => ({ view, close }))
  const cards: PluginCard[] = [
    {
      id: 'chrome',
      name: 'Chrome',
      installed: !available,
      state: available ? 'Available' : 'Running',
    },
  ]
  const f = chromeUiFixture()
  // Explicit fake lifecycle controller; performs no install or process launch.
  const controller: PluginSettingsController = {
    catalogue: vi.fn(async () => cards.map((card) => ({ ...card }))),
    install: vi.fn(async () => {
      cards[0]!.installed = true
      cards[0]!.state = 'Installed'
    }),
    uninstall: vi.fn(async () => {
      cards[0]!.installed = false
      cards[0]!.state = 'Available'
    }),
    screen: vi.fn(async () => ({
      ...f,
      peer: {
        read: async () => FICTIONAL_CHROME,
        subscribe: async () => () => {},
        proposeConfig: async () => ({ resources: [] }),
      },
      current: () => true,
      onInvalidate: () => () => {},
      propose: () => {},
    })),
  }
  const ipc = { handle: vi.fn() }
  registerPluginSettings(ipc, () => owner as never, missing ? undefined : controller)
  expect(ipc.handle.mock.calls[0]?.[0]).toBe(PLUGIN_SETTINGS_CHANNEL)
  const handler = ipc.handle.mock.calls[0]![1]
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }
  return {
    owner,
    contents,
    view,
    close,
    controller,
    event,
    call: (input: unknown, seen = event) => handler(seen, input),
  }
}
const screenId = '00000000-0000-0000-0000-000000000001'
const nextScreenId = '00000000-0000-0000-0000-000000000002'
const bounds = { x: 260, y: 240, width: 860, height: 500 }
it('the fixed preload carries only the request and only a bounded screen identity in lifecycle notifications', async () => {
  const ipc = { invoke: vi.fn(async () => ({ ok: true, cards: [] })), on: vi.fn(), off: vi.fn() },
    bridge = pluginsBridge(ipc),
    notify = vi.fn()
  await bridge.request({ kind: 'list' })
  expect(ipc.invoke).toHaveBeenCalledWith(PLUGIN_SETTINGS_CHANNEL, { kind: 'list' })
  const stop = bridge.onClosed(notify)
  ipc.on.mock.calls[0]![1]({ privateEvent: true }, 'fictional-private-payload')
  expect(notify).not.toHaveBeenCalled()
  ipc.on.mock.calls[0]![1]({ privateEvent: true }, screenId, 'fictional-private-payload')
  expect(notify).toHaveBeenCalledWith(screenId)
  expect(ipc.on.mock.calls[0]?.[0]).toBe(PLUGIN_SCREEN_CLOSED)
  stop()
  expect(ipc.off).toHaveBeenCalledOnce()
})
it('uses fake install/uninstall seams and binds Configure to its own verified source', async () => {
  const f = setup(true)
  expect(await f.call({ kind: 'install', id: 'chrome' })).toMatchObject({
    ok: true,
    cards: [{ state: 'Installed' }],
  })
  expect(f.controller.install).toHaveBeenCalledWith('chrome')
  expect(await f.call({ kind: 'configure', id: 'chrome', screenId, bounds })).toEqual({ ok: true })
  expect(fake.open.mock.calls.at(-1)?.[0].binding.pluginId).toBe('chrome')
  expect(f.owner.contentView.addChildView).toHaveBeenCalledWith(f.view)
  expect(f.view.setBounds).toHaveBeenCalledWith(bounds)
  expect(await f.call({ kind: 'uninstall', id: 'chrome' })).toMatchObject({
    ok: true,
    cards: [{ state: 'Available' }],
  })
  expect(f.controller.uninstall).toHaveBeenCalledWith('chrome')
})
it('fails visibly without a controller and rejects foreign frames, IDs and too little room in the window', async () => {
  const missing = setup(false, true)
  expect(await missing.call({ kind: 'list' })).toEqual({
    ok: false,
    listState: 'fetch-error',
  })
  const f = setup()
  for (const input of [
    { kind: 'configure', id: 'chrome', screenId, bounds: { ...bounds, x: 1000 } },
    { kind: 'configure', id: 'chrome', screenId, bounds: { ...bounds, y: 760 } },
    { kind: 'configure', id: 'chrome', screenId, bounds: { ...bounds, width: -1 } },
    { kind: 'configure', id: 'chrome', screenId, bounds: { ...bounds, x: 0.5 } },
    { kind: 'configure', id: 'other', screenId, bounds },
    { kind: 'configure', id: 'chrome', screenId, bounds, extra: true },
  ])
    expect(await f.call(input)).toMatchObject({ ok: false })
  expect(await f.call({ kind: 'list' }, { ...f.event, senderFrame: {} })).toMatchObject({
    ok: false,
  })
  expect(fake.open).not.toHaveBeenCalled()
})
it('shows a screen over only the part of its stage inside the window', async () => {
  const f = setup()
  // A window narrower than the app's frame scrolls it: the stage runs past either edge.
  const wide = { x: 87, y: 279, width: 1200, height: 415 }
  expect(await f.call({ kind: 'configure', id: 'chrome', screenId, bounds: wide })).toEqual({
    ok: true,
  })
  expect(f.view.setBounds).toHaveBeenLastCalledWith({ x: 87, y: 279, width: 1093, height: 415 })
  expect(
    await f.call({ kind: 'bounds', bounds: { x: -69, y: 279, width: 1068, height: 700 } }),
  ).toEqual({ ok: true })
  expect(f.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 279, width: 999, height: 621 })
  expect(
    await f.call({ kind: 'bounds', bounds: { x: -900, y: 279, width: 1068, height: 415 } }),
  ).toMatchObject({ ok: false })
})
it('discards a delayed Configure after the screen was closed', async () => {
  const f = setup()
  let release: () => void = () => {}
  const source = await f.controller.screen('chrome')
  f.controller.screen = vi.fn(
    () =>
      new Promise<typeof source>((resolve) => {
        release = () => resolve(source)
      }),
  )
  const opening = f.call({ kind: 'configure', id: 'chrome', screenId, bounds })
  await vi.waitFor(() => expect(f.controller.screen).toHaveBeenCalled())
  await f.call({ kind: 'close' })
  release()
  expect(await opening).toMatchObject({ ok: false })
  expect(fake.open).not.toHaveBeenCalled()
})

it('a cancellation during the catalogue read prevents a late screen from opening', async () => {
  const f = setup()
  const cards = await f.controller.catalogue()
  let release = () => {}
  f.controller.catalogue = vi.fn(
    () =>
      new Promise<typeof cards>((resolve) => {
        release = () => resolve(cards)
      }),
  )
  const opening = f.call({ kind: 'configure', id: 'chrome', screenId, bounds })
  await vi.waitFor(() => expect(f.controller.catalogue).toHaveBeenCalledOnce())
  await f.call({ kind: 'close' })
  release()
  expect(await opening).toMatchObject({ ok: false })
  expect(fake.open).not.toHaveBeenCalled()
  expect(f.owner.contentView.addChildView).not.toHaveBeenCalled()
})
it('an old screen destruction is tagged with A while B is opening', async () => {
  const f = setup()
  expect(await f.call({ kind: 'configure', id: 'chrome', screenId, bounds })).toEqual({ ok: true })
  let destroyA = () => {}
  const closedA = new Promise<void>((resolve) => {
    destroyA = () => {
      f.contents.emit('destroyed')
      resolve()
    }
  })
  f.close.mockImplementation(() => closedA)
  const bContents = new EventEmitter()
  const bView = { webContents: bContents, setBounds: vi.fn() }
  fake.open.mockImplementation(async () => ({ view: bView, close: async () => {} }))
  const cancelling = f.call({ kind: 'close' })
  const openingB = f.call({ kind: 'configure', id: 'chrome', screenId: nextScreenId, bounds })
  // B reaches its close(A) await before A's delayed destruction completes.
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledTimes(2))
  destroyA()
  await cancelling
  expect(await openingB).toEqual({ ok: true })
  expect(f.owner.webContents.send).toHaveBeenCalledWith(PLUGIN_SCREEN_CLOSED, screenId)
  expect(f.owner.webContents.send).not.toHaveBeenCalledWith(PLUGIN_SCREEN_CLOSED, nextScreenId)
  expect(f.owner.contentView.addChildView).toHaveBeenLastCalledWith(bView)
})

it('P3: real Settings dispatch denies uninstall before catalogue or slow UI teardown', async () => {
  const f = setup()
  await f.call({ kind: 'configure', id: 'chrome', screenId, bounds })
  const never = new Promise<void>(() => {})
  f.close.mockImplementationOnce(() => never)
  vi.mocked(f.controller.catalogue).mockImplementationOnce(() => new Promise(() => {}))
  const denied = vi.fn()
  vi.mocked(f.controller.uninstall).mockImplementationOnce(async () => {
    denied()
  })
  void f.call({ kind: 'uninstall', id: 'chrome' })
  expect(denied).toHaveBeenCalledOnce()
})
it('P3: failed UI teardown cannot suppress the real Settings uninstall dispatch', async () => {
  const f = setup()
  await f.call({ kind: 'configure', id: 'chrome', screenId, bounds })
  f.close.mockRejectedValueOnce(new Error('fictional failed close'))
  const denied = vi.fn()
  vi.mocked(f.controller.uninstall).mockImplementationOnce(async () => {
    denied()
  })
  expect(await f.call({ kind: 'uninstall', id: 'chrome' })).toMatchObject({ ok: false })
  expect(denied).toHaveBeenCalledOnce()
})

it.skipIf(process.platform === 'win32')(
  'P4: real Settings can reinstall after clean uninstall recovery without another restart',
  async () => {
    const { fixture, reopenLifecycleFixture, cleanupLifecycleFixtures } =
      await import('./plugin-lifecycle-fixtures')
    const { PluginLifecycleController } = await import('../src/main/plugins/lifecycle/controller')
    try {
      const live = await fixture()
      await live.controller.install(live.handle, 'chrome')
      live.failStop()
      await expect(live.controller.uninstall(live.handle, 'chrome')).rejects.toThrow()
      const state = reopenLifecycleFixture(live)
      live.failStop(false)
      const recovered = await PluginLifecycleController.open({ ...live.opts, state })
      const handle = await recovered.attach(live.local.sink)
      const f = setup(true)
      vi.mocked(f.controller.catalogue).mockImplementation(
        async () => (await recovered.status()).cards,
      )
      vi.mocked(f.controller.install).mockImplementation((id) => recovered.install(handle, id))
      expect(await f.call({ kind: 'install', id: 'chrome' })).toMatchObject({
        ok: true,
        cards: [{ state: 'Running' }],
      })
    } finally {
      await cleanupLifecycleFixtures()
    }
  },
)

it('Try again uses the existing catalogue/connect path and never invokes installation', async () => {
  const f = setup()
  vi.mocked(f.controller.catalogue)
    .mockResolvedValueOnce([
      { id: 'chrome', name: 'Fictional Fir', installed: true, state: 'Unavailable' },
    ])
    .mockResolvedValueOnce([
      { id: 'chrome', name: 'Fictional Fir', installed: true, state: 'Running' },
    ])
  expect(await f.call({ kind: 'list' })).toMatchObject({
    ok: true,
    cards: [{ state: 'Unavailable', installed: true }],
  })
  expect(await f.call({ kind: 'retry', id: 'chrome' })).toMatchObject({
    ok: true,
    cards: [{ state: 'Running', installed: true }],
  })
  expect(f.controller.install).not.toHaveBeenCalled()
  expect(f.controller.uninstall).not.toHaveBeenCalled()
  expect(f.controller.screen).not.toHaveBeenCalled()
  expect(await f.call({ kind: 'retry', id: 'chrome', raw: true })).toMatchObject({ ok: false })
  expect(await f.call({ kind: 'retry', id: 'foreign' })).toMatchObject({ ok: false })
  f.controller.retry = vi.fn(async () => {
    throw new Error('fictional-private-owner-stack')
  })
  expect(await f.call({ kind: 'retry', id: 'chrome' })).toEqual({
    ok: false,
    error: 'Plugin unavailable. Try again.',
  })
})

it.each([true, false, null])(
  'passes the optional closed priority fact %s through Settings',
  async (priorityClamped) => {
    const f = setup()
    vi.mocked(f.controller.catalogue).mockResolvedValueOnce([
      { id: 'chrome', name: 'Chrome', installed: true, state: 'Running', priorityClamped },
    ])
    expect(await f.call({ kind: 'list' })).toEqual({
      ok: true,
      listState: 'ready',
      cards: [{ id: 'chrome', name: 'Chrome', installed: true, state: 'Running', priorityClamped }],
    })
  },
)
it('refuses raw scheduling output and extra diagnostic fields at Settings', async () => {
  const f = setup()
  for (const diagnostic of [
    { priorityClamped: 'fictional-private-output' },
    { rawPriority: 'fictional-private-output' },
  ]) {
    vi.mocked(f.controller.catalogue).mockResolvedValueOnce([
      { id: 'chrome', name: 'Chrome', installed: true, state: 'Running', ...diagnostic } as never,
    ])
    expect(await f.call({ kind: 'list' })).toEqual({
      ok: false,
      listState: 'fetch-error',
    })
  }
})

it('a page list refreshes the source; update uses its own door and closes configuration', async () => {
  const f = setup()
  const catalogue = vi.mocked(f.controller.catalogue)
  catalogue.mockResolvedValue([
    {
      id: 'chrome',
      name: 'Chrome',
      installed: true,
      state: 'Running',
      installedVersion: '0.1.0',
      updateVersion: '0.1.3',
      uninstallDeletesData: false,
    },
  ])
  f.controller.update = vi.fn(async () => {})
  expect((await f.call({ kind: 'list' })).ok).toBe(true)
  expect(catalogue).toHaveBeenCalledWith(true)
  expect((await f.call({ kind: 'update', id: 'chrome' })).ok).toBe(true)
  expect(f.controller.update).toHaveBeenCalledWith('chrome')
  expect(f.controller.uninstall).not.toHaveBeenCalled()
  catalogue.mockResolvedValue([
    { id: 'chrome', name: 'Chrome', installed: true, state: 'Running', installedVersion: '0.1.3' },
  ])
  expect((await f.call({ kind: 'update', id: 'chrome' })).ok).toBe(false)
  expect(f.controller.update).toHaveBeenCalledOnce()
})

it('keeps only closed local and remote removal facts after uninstall', async () => {
  const f = setup()
  vi.mocked(f.controller.uninstall).mockResolvedValueOnce({
    data: 'deleted',
    logout: 'unconfirmed',
  } as never)
  expect(await f.call({ kind: 'uninstall', id: 'whatsapp' })).toMatchObject({
    ok: true,
    removal: { data: 'deleted', logout: 'unconfirmed' },
  })
})

it('refuses malformed removal facts without forwarding private reply bytes', async () => {
  const f = setup()
  vi.mocked(f.controller.uninstall).mockResolvedValueOnce({
    data: 'deleted',
    logout: 'confirmed',
    diagnostic: 'fictional-private-diagnostic',
  } as never)
  const answer = await f.call({ kind: 'uninstall', id: 'whatsapp' })
  expect(answer).toEqual({ ok: false, error: 'Plugin unavailable. Try again.' })
  expect(JSON.stringify(answer)).not.toContain('fictional-private-diagnostic')
})
