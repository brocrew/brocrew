import { afterEach, expect, it, vi } from 'vitest'
import type { BrokerRequest } from '../src/main/plugins/tool-broker'

const downstream = vi.hoisted(() => ({ tool: vi.fn() }))
vi.mock('../src/main/plugins/lifecycle/broker-inventory', () => ({
  admittedPluginTools: async () => ({
    connection: { admin: () => ({ url: 'http://127.0.0.1:8123/v1', headers: {} }) },
    endpoint: { url: 'http://127.0.0.1:8123/mcp' },
    credential: 'a'.repeat(64),
    adminCredential: 'b'.repeat(64),
    admitted: [],
  }),
}))
vi.mock('../src/main/plugins/managed-transport', () => ({
  createPrivatePluginPort: () => ({ tool: downstream.tool, admin: vi.fn() }),
}))
import { chromeBrokerBinding } from '../src/main/plugins/lifecycle/chrome-broker'

afterEach(() => vi.unstubAllGlobals())
it.each(['healthy', 'tool-error'] as const)(
  'dispatches a %s profile call without reading a stuck unrelated profile snapshot',
  async (mode) => {
    const snapshot = vi.fn(async () => {
      throw new Error('window operation timed out')
    })
    vi.stubGlobal('fetch', snapshot)
    const value = {
      content: [{ type: 'text', text: mode === 'healthy' ? 'fern result' : 'Error: window operation timed out' }],
      ...(mode === 'tool-error' ? { isError: true } : {}),
    }
    const execution = {
      result: Promise.resolve({ ok: true as const, value }),
      quiescent: Promise.resolve(),
      cancel: vi.fn(),
    }
    downstream.tool.mockReset().mockReturnValue(execution)
    const binding = await chromeBrokerBinding({
      installation: { pluginId: 'chrome' },
      package: {
        compatibility: { tools: true },
        manifest: { permissions: { resources: [{ id: 'browser-profiles', read: true, write: true }] } },
      },
    } as unknown as Parameters<typeof chromeBrokerBinding>[0])
    const request: BrokerRequest = {
      name: 'snapshot',
      input: { tabId: 'fern-tab' },
      resources: [],
      identity: {
        pluginId: 'chrome', installId: 'fixture', epoch: 'fixture', workspaceId: 'fixture', kind: 'agent', incarnation: 'fixture',
      },
    }
    const signal = new AbortController().signal
    const work = binding.server.tool(request, signal)
    expect(await work.result).toEqual({ ok: true, value })
    await work.quiescent
    expect(downstream.tool).toHaveBeenCalledWith(request, signal)
    expect(snapshot).not.toHaveBeenCalled()
  },
)
