import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PLUGIN_UI_CHANNEL, PLUGIN_UI_EVENT, PLUGIN_UI_RPC } from '../src/shared/plugin-ui'
const renderer = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ ok: true, data: { loaves: 2 } })),
  on: vi.fn(),
}))
vi.mock('electron', () => ({ ipcRenderer: renderer }))
const origin = 'brocrew-plugin://11111111-1111-4111-8111-111111111111',
  generation = '22222222-2222-4222-8222-222222222222'
const argv = process.argv,
  descriptor = Object.getOwnPropertyDescriptor(process, 'isMainFrame')
function page() {
  const value: {
    location: { origin: string; protocol: string }
    top: unknown
    addEventListener: ReturnType<typeof vi.fn>
    postMessage: ReturnType<typeof vi.fn>
  } = {
    location: { origin, protocol: 'brocrew-plugin:' },
    top: null,
    addEventListener: vi.fn(),
    postMessage: vi.fn(),
  }
  value.top = value
  return value
}
const packet = (requestId = 'one') => ({
  channel: PLUGIN_UI_CHANNEL,
  requestId,
  method: 'read',
  payload: {},
  configRevision: 0,
})
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.argv = [...argv, `--brocrew-plugin-generation=${generation}`]
  Object.defineProperty(process, 'isMainFrame', { configurable: true, value: true })
})
afterEach(() => {
  process.argv = argv
  if (descriptor) Object.defineProperty(process, 'isMainFrame', descriptor)
  else Reflect.deleteProperty(process, 'isMainFrame')
  vi.unstubAllGlobals()
})
it('the actual preload exports no API, accepts only its own source/origin and uses fixed IPC', async () => {
  const window = page()
  vi.stubGlobal('window', window)
  await import('../src/preload/plugin-ui')
  expect(Object.keys(window)).toEqual(['location', 'top', 'addEventListener', 'postMessage'])
  const deliver = window.addEventListener.mock.calls[0]![1]
  for (const event of [
    { source: {}, origin, data: packet() },
    { source: window, origin: 'https://example.invalid', data: packet() },
    { source: window, origin, data: { ...packet(), method: 'app:info' } },
    { source: window, origin, data: { ...packet(), extra: 1 } },
  ])
    await deliver(event)
  expect(renderer.invoke).not.toHaveBeenCalled()
  await deliver({ source: window, origin, data: packet() })
  expect(renderer.invoke).toHaveBeenCalledWith(PLUGIN_UI_RPC, { generation, packet: packet() })
  expect(window.postMessage).toHaveBeenCalledWith(
    { channel: PLUGIN_UI_CHANNEL, requestId: 'one', ok: true, data: { loaves: 2 } },
    origin,
  )
  expect(renderer.on.mock.calls[0]![0]).toBe(PLUGIN_UI_EVENT)
  const snapshot = renderer.on.mock.calls[0]![1]
  snapshot({ secretElectronEvent: true }, 'stale', { subscriptionId: 'x', data: {} })
  expect(window.postMessage).toHaveBeenCalledTimes(1)
  snapshot({ secretElectronEvent: true }, generation, { subscriptionId: 'x', data: {} })
  expect(JSON.stringify(window.postMessage.mock.calls)).not.toContain('secretElectronEvent')
})
it('installs no bridge in a child frame', async () => {
  const window = page()
  vi.stubGlobal('window', window)
  Object.defineProperty(process, 'isMainFrame', { configurable: true, value: false })
  await import('../src/preload/plugin-ui')
  expect(window.addEventListener).not.toHaveBeenCalled()
  expect(renderer.on).not.toHaveBeenCalled()
})
it('drops duplicate and excess pending DOM packets before IPC', async () => {
  const window = page()
  vi.stubGlobal('window', window)
  const releases: ((value: { ok: boolean; data: { loaves: number } }) => void)[] = []
  renderer.invoke.mockImplementation(() => new Promise((resolve) => releases.push(resolve)))
  await import('../src/preload/plugin-ui')
  const deliver = window.addEventListener.mock.calls[0]![1]
  const waits = ['a', 'b', 'c', 'd', 'e', 'a'].map((id) =>
    deliver({ source: window, origin, data: packet(id) }),
  )
  expect(renderer.invoke).toHaveBeenCalledTimes(4)
  for (const release of releases) release({ ok: true, data: { loaves: 2 } })
  await Promise.all(waits)
})
