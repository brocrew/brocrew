import { beforeEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  list: vi.fn(),
  close: vi.fn(),
  tool: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', async () => ({
  Client: (await import('./helpers/plugin-tool-broker')).inventoryClient(sdk),
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {},
}))
vi.mock('../src/main/plugins/managed-transport', () => ({
  createPrivatePluginPort: () => ({ tool: sdk.tool, admin: vi.fn() }),
}))
import { pluginBrokerBinding } from '../src/main/plugins/lifecycle/broker-binding'
import { createPluginToolBroker } from '../src/main/plugins/tool-broker'
import type { AgentAttachmentView } from '../src/main/plugins/lifecycle/contracts'

beforeEach(() => {
  sdk.connect.mockReset().mockResolvedValue(undefined)
  sdk.close.mockReset().mockResolvedValue(undefined)
  sdk.tool.mockReset().mockReturnValue({
    result: Promise.resolve({
      ok: true,
      value: { content: [{ type: 'text', text: 'package result' }] },
    }),
    quiescent: Promise.resolve(),
    cancel() {},
  })
})
it.each(['chrome', 'fictional-orchid'])(
  'binds every declared tool for %s without domain claims',
  async (pluginId) => {
    const tool = {
      name: 'added_by_package',
      description: 'Package tool',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
      _meta: { vendor: { field: true } },
    }
    sdk.list.mockReset().mockResolvedValue({ tools: [tool] })
    const binding = await pluginBrokerBinding({
      package: { compatibility: { tools: true } },
      connection: Promise.resolve({
        mcp: () => ({
          url: 'http://127.0.0.1:8123/mcp',
          headers: { Authorization: 'Bearer fictional' },
        }),
      }),
      current: () => true,
    } as unknown as AgentAttachmentView)
    const broker = createPluginToolBroker({
      ...binding,
      binding: { pluginId, installId: 'fixture-install', epoch: 'fixture-epoch' },
      reservedNamespace: 'host',
      hostToolNames: [],
      occupiedNamespaces: [],
      occupiedQualifiedNames: [],
    })
    const agent = broker.owner.grantAgent(broker.owner.attach('fixture-workspace'), 'fixture-agent')
    const [published] = broker.agent.discover(agent)
    expect(published).toMatchObject(tool)
    const input = { profile: 'package owned value', tabId: 'tab-'.repeat(100) }
    expect(await broker.agent.call(agent, published!.qualifiedName, input)).toEqual({
      content: [{ type: 'text', text: 'package result' }],
    })
    expect(sdk.tool.mock.calls[0]![0].input).toEqual(input)
    expect(sdk.tool.mock.calls[0]![0]).not.toHaveProperty('resources')
  },
)
