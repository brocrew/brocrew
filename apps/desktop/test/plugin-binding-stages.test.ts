import { beforeEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ connect: vi.fn(), list: vi.fn(), close: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/client/index.js', async () => ({
  Client: (await import('./helpers/plugin-tool-broker')).inventoryClient(sdk),
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {},
}))
import { admittedPluginTools } from '../src/main/plugins/lifecycle/broker-inventory'

beforeEach(() => {
  sdk.connect.mockReset().mockResolvedValue(undefined)
  sdk.list.mockReset().mockResolvedValue({ tools: [] })
  sdk.close.mockReset().mockResolvedValue(undefined)
})
function fixture() {
  return {
    connection: Promise.resolve({
      mcp: () => ({
        url: 'http://127.0.0.1:8123/mcp',
        headers: { Authorization: `Bearer ${'a'.repeat(64)}` },
      }),
    }),
    current: vi.fn(() => true),
  } as unknown as Parameters<typeof admittedPluginTools>[0]
}
it.each(['connection', 'connect', 'inventory'] as const)(
  'names the actual binding %s failure, excluding its raw body',
  async (where) => {
    const view = fixture()
    const error = Object.assign(new Error('http://fictional.private/mcp Bearer secret-body'), {
      code: 'EACCES',
    })
    if (where === 'connection') Object.assign(view, { connection: Promise.reject(error) })
    else sdk[where === 'inventory' ? 'list' : where].mockRejectedValue(error)
    let failure: unknown
    try {
      await admittedPluginTools(view)
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ pluginStage: `binding-${where}`, pluginCause: 'io-denied' })
    expect((failure as Error).message).not.toMatch(/fictional.private|secret-body|Bearer/)
    expect(sdk.close).toHaveBeenCalledTimes(where === 'connection' ? 0 : 1)
  },
)
it('preserves the first failure when client cleanup also rejects', async () => {
  sdk.connect.mockRejectedValue(Object.assign(new Error('private connect'), { code: 'EACCES' }))
  sdk.close.mockRejectedValue(Object.assign(new Error('private close'), { code: 'EIO' }))
  await expect(admittedPluginTools(fixture())).rejects.toMatchObject({
    pluginStage: 'binding-connect',
    pluginCause: 'io-denied',
  })
  expect(sdk.close).toHaveBeenCalledOnce()
})
it('classifies the SDK request-timeout code without copying its message', async () => {
  sdk.list.mockRejectedValue(
    Object.assign(new Error('private SDK body'), { name: 'McpError', code: -32001 }),
  )
  await expect(admittedPluginTools(fixture())).rejects.toMatchObject({
    pluginStage: 'binding-inventory',
    pluginCause: 'timeout',
  })
})

it('lists named tools with their complete definitions in inventory order', async () => {
  const tools = ['second', 'first'].map((name) => ({
    name,
    description: 'a'.repeat(64),
    inputSchema: { type: 'object' as const, properties: {} },
  }))
  sdk.list.mockResolvedValue({ tools })
  const result = await admittedPluginTools(fixture())
  expect(result.admitted).toEqual(tools)
  expect(sdk.close).toHaveBeenCalledOnce()
})
it('keeps every declared tool including a newly added name', async () => {
  const named = { name: 'echo', inputSchema: { type: 'object' as const } }
  sdk.list.mockResolvedValue({ tools: [named, { ...named, name: 'unknown' }] })
  const result = await admittedPluginTools(fixture())
  expect(result.admitted).toEqual([named, { ...named, name: 'unknown' }])
})

it('returns all 257 listed tool definitions without an app count veto', async () => {
  const tools = Array.from({ length: 257 }, (_, i) => ({
    name: `tool_${i}`,
    inputSchema: { type: 'object' as const },
    annotations: { readOnlyHint: true },
  }))
  sdk.list.mockResolvedValue({ tools })
  const result = await admittedPluginTools(fixture())
  expect(result.admitted).toEqual(tools)
  expect(sdk.close).toHaveBeenCalledOnce()
})
it('keeps a successful inventory when close and its diagnostic observer fail', async () => {
  const tool = { name: 'echo', inputSchema: { type: 'object' as const } }
  sdk.list.mockResolvedValue({ tools: [tool] })
  sdk.close.mockRejectedValue(new Error('close failed'))
  const diagnostic = vi.fn(() => {
    throw new Error('observer failed')
  })
  const result = await admittedPluginTools(fixture(), diagnostic)
  expect(result.admitted).toEqual([tool])
  expect(diagnostic).toHaveBeenCalledWith('transport-close-failed')
  expect(sdk.close).toHaveBeenCalledOnce()
})
it('consumes every inventory page in order under one shared deadline', async () => {
  const first = { name: 'first', inputSchema: { type: 'object' as const }, _meta: { page: 1 } }
  const second = {
    name: 'second',
    inputSchema: { type: 'object' as const },
    annotations: { readOnlyHint: true },
  }
  sdk.list
    .mockResolvedValueOnce({ tools: [first], nextCursor: 'next' })
    .mockResolvedValueOnce({ tools: [second] })
  const result = await admittedPluginTools(fixture())
  expect(result.admitted).toEqual([first, second])
  const signal = sdk.list.mock.calls[0]![1].signal
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(sdk.list.mock.calls[1]![1].signal).toBe(signal)
  expect(sdk.list.mock.calls).toEqual([
    [{ cursor: undefined }, { signal }],
    [{ cursor: 'next' }, { signal }],
  ])
  expect(sdk.close).toHaveBeenCalledOnce()
})
