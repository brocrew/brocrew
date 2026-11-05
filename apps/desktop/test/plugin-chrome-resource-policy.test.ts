import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { createPluginToolBroker, type PluginMcpClient } from '../src/main/plugins/tool-broker'
interface Harness {
  home: string
  downloads: string
  uploadRoot: string
  store: {
    dirOf(name: string): string
    setFlags(name: string, flags: Record<string, boolean>): unknown
  }
  browser: {
    touches: unknown[]
    close(name: string): Promise<void>
    exclusive<T>(name: string, work: () => Promise<T>): Promise<T>
  }
  profile(name: string, flags?: Record<string, boolean>): string
  call(name: string, args: Record<string, unknown>): Promise<{ json: unknown }>
}
const subjects: Harness[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const h of subjects.splice(0))
    for (const root of [h.home, dirname(h.downloads), h.uploadRoot])
      fs.rmSync(root, { recursive: true, force: true })
})
async function subject() {
  const { harness } = await vi.importActual<{ harness(): Harness }>(
    '../../../plugins/chrome/test/fakes',
  )
  const h = harness()
  subjects.push(h)
  return h
}
it('the real package resolves only its named enabled profile and refuses the next call after revocation', async () => {
  const h = await subject()
  h.profile('fern', { enabled: true })
  const tab = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json
  expect(tab).toMatchObject({ tabId: expect.any(String) })
  h.store.setFlags('fern', { enabled: false })
  h.browser.touches.length = 0
  await expect(h.call('list_tabs', { profile: 'fern' })).rejects.toThrow(/profile/)
  expect(h.browser.touches).toEqual([])
})
it('the real package enforces settings/extensions choices and tab ownership before effects', async () => {
  const h = await subject()
  h.profile('fern', { enabled: true, allowSettings: false, allowExtensions: false })
  h.profile('birch', { enabled: true })
  const tab = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
    tabId: string
  }
  h.browser.touches.length = 0
  await expect(
    h.call('set_setting', { profile: 'fern', key: 'translate.enabled', value: true }),
  ).rejects.toThrow(/settings/)
  await expect(
    h.call('install_extension', { profile: 'fern', source: 'a'.repeat(32) }),
  ).rejects.toThrow(/extensions/)
  await expect(h.call('close_tab', { profile: 'birch', tabId: tab.tabId })).rejects.toThrow(
    /profile/,
  )
  expect(h.browser.touches).toEqual([])
})
it('the actual generic transport never dispatches a pre-cancelled call after retiring the old policy read', async () => {
  const callTool = vi.fn<PluginMcpClient['callTool']>(),
    listTools = vi.fn<PluginMcpClient['listTools']>(async () => ({
      tools: [{ name: 'read_garden', inputSchema: { type: 'object', properties: {} } }],
    }))
  const broker = createPluginToolBroker({
    binding: {
      pluginId: 'fictional-garden',
      installId: 'fictional-code',
      instanceId: 'fictional-run',
    },
    client: { callTool, listTools },
    isEnabled: () => true,
  })
  const abort = new AbortController()
  abort.abort()
  await expect(
    broker.callTool({
      workspaceId: 'fictional-workspace',
      name: 'read_garden',
      arguments: {},
      requestId: 'cancelled',
      origin: 'agent',
      signal: abort.signal,
    }),
  ).rejects.toMatchObject({ code: 'cancelled' })
  expect(callTool).not.toHaveBeenCalled()
})
it('the real package rechecks a revoked settings permission after a held native close before writing', async () => {
  const h = await subject()
  h.profile('fern', { enabled: true, allowSettings: true })
  let release!: () => void, began!: () => void
  const reached = new Promise<void>((resolve) => {
    began = resolve
  })
  vi.spyOn(h.browser, 'close').mockImplementation(async () => {
    began()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  const work = h.call('set_setting', { profile: 'fern', key: 'translate.enabled', value: true })
  const refused = expect(work).rejects.toThrow(/settings/)
  await reached
  h.store.setFlags('fern', { allowSettings: false })
  release()
  await refused
  expect(fs.existsSync(join(h.store.dirOf('fern'), 'Default', 'Preferences'))).toBe(false)
})
