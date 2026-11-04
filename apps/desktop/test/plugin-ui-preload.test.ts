import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PLUGIN_UI_RPC } from '../src/shared/plugin-ui'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'
const renderer = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    ok: true,
    data: { loaves: 2 },
  })),
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
  channel: PLUGIN_PAGE_CHANNEL,
  requestId,
  method: 'callTool',
  params: { tool: 'bakery_read', arguments: {} },
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
    { channel: PLUGIN_PAGE_CHANNEL, requestId: 'one', ok: true, data: { loaves: 2 } },
    origin,
  )
  expect(renderer.on).not.toHaveBeenCalled()
})
it('installs no bridge in a child frame', async () => {
  const window = page()
  vi.stubGlobal('window', window)
  Object.defineProperty(process, 'isMainFrame', { configurable: true, value: false })
  await import('../src/preload/plugin-ui')
  expect(window.addEventListener).not.toHaveBeenCalled()
  expect(renderer.on).not.toHaveBeenCalled()
})
it('drops duplicate DOM request IDs before IPC while retaining generic concurrency', async () => {
  const window = page()
  vi.stubGlobal('window', window)
  const releases: ((value: { ok: boolean; data: { loaves: number } }) => void)[] = []
  renderer.invoke.mockImplementation(() => new Promise((resolve) => releases.push(resolve)))
  await import('../src/preload/plugin-ui')
  const deliver = window.addEventListener.mock.calls[0]![1]
  const waits = ['a', 'b', 'c', 'd', 'e', 'a'].map((id) =>
    deliver({ source: window, origin, data: packet(id) }),
  )
  expect(renderer.invoke).toHaveBeenCalledTimes(5)
  for (const release of releases) release({ ok: true, data: { loaves: 2 } })
  await Promise.all(waits)
})
it('forwards generic MCP arguments and full replies without the legacy page quotas', async () => {
  const window = page()
  vi.stubGlobal('window', window)
  const releases: ((value: unknown) => void)[] = []
  renderer.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(resolve)
      }),
  )
  await import('../src/preload/plugin-ui')
  const deliver = window.addEventListener.mock.calls[0]![1]
  const args = { text: 'Fictional note '.repeat(6000), nested: { labels: ['draft'] } }
  const generic = (requestId: string) => ({
    channel: PLUGIN_PAGE_CHANNEL,
    requestId,
    method: 'callTool',
    params: { tool: 'notes_save', arguments: args },
  })
  const waits = ['one', 'two', 'three', 'four', 'five', 'six', 'one'].map((requestId) =>
    deliver({ source: window, origin, data: structuredClone(generic(requestId)) }),
  )
  expect(renderer.invoke).toHaveBeenCalledTimes(6)
  expect(renderer.invoke).toHaveBeenNthCalledWith(1, PLUGIN_UI_RPC, {
    generation,
    packet: generic('one'),
  })
  const result = {
    status: 'result',
    result: {
      content: [{ type: 'text', text: 'Fictional result '.repeat(70000) }],
      structuredContent: { saved: true },
    },
  }
  for (const release of releases) release(structuredClone({ ok: true, data: result }))
  await Promise.all(waits)
  expect(window.postMessage).toHaveBeenCalledTimes(6)
  expect(window.postMessage).toHaveBeenCalledWith(
    { channel: PLUGIN_PAGE_CHANNEL, requestId: 'one', ok: true, data: result },
    origin,
  )
})
