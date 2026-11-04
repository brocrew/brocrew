import { describe, expect, it, vi } from 'vitest'
import { PluginUiAssets, PLUGIN_CSP, PLUGIN_SCHEME } from '../src/main/plugins/ui/assets'
import { PluginPageTools } from '../src/main/plugins/ui/tool-rpc'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'
import { uiFixture } from './plugin-ui-fixtures'
import { deferred } from './plugin-lifecycle-fixtures'
import type { PluginToolCallResult } from '../src/shared/plugin-contract'
const a = '11111111-1111-4111-8111-111111111111',
  b = '22222222-2222-4222-8222-222222222222'
const packet = (requestId = 'request') => ({
  channel: PLUGIN_PAGE_CHANNEL,
  requestId,
  method: 'callTool',
  params: { tool: 'bakery_read', arguments: {} },
})
const result: PluginToolCallResult = {
  status: 'result',
  result: { content: [], structuredContent: { loaves: 2 } },
}
describe('per-view verified assets', () => {
  it('serves only its admitted GET/HEAD assets with CSP and exact per-view URLs', async () => {
    const { verified } = uiFixture(),
      first = new PluginUiAssets(verified, a),
      second = new PluginUiAssets(verified, b)
    expect(first.origin).not.toBe(second.origin)
    const response = first.response({ url: first.entry, method: 'GET' })
    expect(await response.text()).toContain('Fictional bakery')
    expect(response.headers.get('content-security-policy')).toBe(PLUGIN_CSP)
    for (const rule of [
      "default-src 'none'",
      "script-src 'self'",
      'connect-src *',
      "frame-src 'none'",
      "worker-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ])
      expect(PLUGIN_CSP).toContain(rule)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await first.response({ url: first.entry, method: 'HEAD' }).text()).toBe('')
    for (const url of [
      second.entry,
      first.entry + '?query',
      first.entry + '#fragment',
      first.origin + '/plugin.json',
      'file:///fictional',
      'https://example.invalid/',
    ])
      expect(first.response({ url, method: 'GET' }).status).toBe(404)
    expect(first.response({ url: first.entry, method: 'POST' }).status).toBe(404)
    expect(PLUGIN_SCHEME.privileges).toMatchObject({
      standard: true,
      secure: true,
      bypassCSP: false,
      allowServiceWorkers: false,
      supportFetchAPI: true,
    })
  })
})

describe('generic own-plugin MCP page boundary', () => {
  it('forwards only tools, rejects retired protocol methods and malformed packets before execution', async () => {
    const callTool = vi.fn(async () => result)
    const rpc = new PluginPageTools({ current: () => true, callTool })
    for (const input of [
      ...['read', 'subscribe', 'unsubscribe', 'proposeConfig'].map((method) => ({
        ...packet(),
        method,
      })),
      { ...packet(), channel: 'brocrew-plugin-ui:v1' },
      { ...packet(), params: { tool: 'bakery_read', arguments: new Map() } },
    ])
      await expect(rpc.invoke(input)).rejects.toThrow()
    expect(callTool).not.toHaveBeenCalled()
    expect(await rpc.invoke(packet())).toEqual(result)
    expect(callTool).toHaveBeenCalledWith('bakery_read', {}, 'request', expect.any(AbortSignal))
    rpc.close()
  })
  it('rejects duplicate pending IDs and cancels all current calls on teardown without publishing late results', async () => {
    const held = deferred<PluginToolCallResult>()
    const callTool = vi.fn<ConstructorParameters<typeof PluginPageTools>[0]['callTool']>(
        () => held.promise,
      ),
      cancelTool = vi.fn(async () => {})
    const rpc = new PluginPageTools({ current: () => true, callTool, cancelTool })
    const pending = rpc.invoke(packet()).catch(() => null)
    await expect(rpc.invoke(packet())).rejects.toThrow()
    expect(callTool).toHaveBeenCalledOnce()
    rpc.close()
    expect(callTool.mock.calls[0]![3].aborted).toBe(true)
    expect(cancelTool).toHaveBeenCalledExactlyOnceWith('request')
    held.resolve(result)
    expect(await pending).toBeNull()
    await expect(rpc.invoke(packet('fresh'))).rejects.toThrow()
  })
  it('revalidates the live view after asynchronous execution and permits a fresh call after a failure', async () => {
    let live = true
    const callTool = vi.fn(async () => {
      live = false
      return result
    })
    const rpc = new PluginPageTools({ current: () => live, callTool })
    await expect(rpc.invoke(packet())).rejects.toThrow()
    live = true
    callTool.mockImplementation(async () => result)
    expect(await rpc.invoke(packet())).toEqual(result)
    rpc.close()
  })
})
