import { describe, expect, it, vi } from 'vitest'
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  createPluginToolBroker,
  PluginBrokerError,
  type PluginMcpClient,
} from '../src/main/plugins/tool-broker'

const definition = {
  name: 'gather_petals',
  title: 'Gather petals',
  description: 'A fictional garden operation',
  inputSchema: { type: 'object' as const, properties: { basket: { type: 'string' } } },
  annotations: { readOnlyHint: false, destructiveHint: true },
  _meta: { garden: { version: 1 } },
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function fixture(diagnostic = vi.fn()) {
  const enabled = new Set(['willow', 'birch'])
  const listTools = vi.fn<PluginMcpClient['listTools']>(async () => ({ tools: [definition] }))
  const callTool = vi.fn<PluginMcpClient['callTool']>(async () => ({
    content: [{ type: 'text', text: 'petals gathered' }],
  }))
  const broker = createPluginToolBroker({
    binding: { pluginId: 'garden', installId: 'garden-code', instanceId: 'garden-run' },
    client: { listTools, callTool },
    isEnabled: (workspaceId: string) => enabled.has(workspaceId),
    diagnostic,
  })
  const call = (requestId = 'basket-one', workspaceId = 'willow') =>
    broker.callTool({
      workspaceId,
      requestId,
      name: definition.name,
      arguments: { basket: 'tulip', nested: { keep: true } },
      origin: 'button',
    })
  return { broker, enabled, listTools, callTool, call, diagnostic }
}
describe('generic plugin MCP forwarding', () => {
  it('passes server definitions and paginated new tools without an app name table', async () => {
    const f = fixture()
    f.listTools.mockImplementation(async (input) =>
      input?.cursor === 'next'
        ? {
            tools: [
              {
                ...definition,
                name: 'count_seeds',
                inputSchema: { type: 'object', properties: { varieties: { type: 'array' } } },
              },
            ],
          }
        : { tools: [definition], nextCursor: 'next' },
    )
    const tools = await f.broker.listTools('willow')
    expect(tools).toEqual([
      definition,
      {
        ...definition,
        name: 'count_seeds',
        inputSchema: { type: 'object', properties: { varieties: { type: 'array' } } },
      },
    ])
    expect(f.listTools.mock.calls).toEqual([[undefined], [{ cursor: 'next' }]])
  })
  it('forwards unchanged arguments and metadata outside them, with exact MCP error results', async () => {
    const f = fixture()
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'the basket is full', annotations: { audience: ['user'] } }],
      structuredContent: { remaining: 0 },
      isError: true,
      _meta: { receipt: 'tulip' },
    }
    f.callTool.mockResolvedValue(result)
    expect(await f.call()).toBe(result)
    expect(f.callTool.mock.calls[0]?.[0]).toEqual({
      name: definition.name,
      arguments: { basket: 'tulip', nested: { keep: true } },
      _meta: { workspaceId: 'willow', requestId: 'basket-one', origin: 'button' },
    })
    expect(f.callTool.mock.calls[0]?.[2]).toMatchObject({ signal: expect.any(AbortSignal) })
  })
  it('distinguishes transport failures and makes no retry or permanent denial', async () => {
    const f = fixture()
    f.callTool.mockRejectedValueOnce(new Error('fictional transport interruption'))
    await expect(f.call()).rejects.toMatchObject({ code: 'transport' })
    expect(f.callTool).toHaveBeenCalledOnce()
    expect(await f.call('basket-two')).toMatchObject({ content: [{ text: 'petals gathered' }] })
  })
  it('allows overlapping calls and cancels only the matching workspace/request', async () => {
    const f = fixture()
    const one = deferred<CallToolResult>(),
      two = deferred<CallToolResult>(),
      three = deferred<CallToolResult>()
    f.callTool
      .mockImplementationOnce(() => one.promise)
      .mockImplementationOnce(() => two.promise)
      .mockImplementationOnce(() => three.promise)
    const a = f.call('same-id'),
      b = f.call('same-id', 'birch'),
      c = f.call('another-id')
    expect(f.callTool).toHaveBeenCalledTimes(3)
    expect(f.broker.cancelTool({ workspaceId: 'willow', requestId: 'same-id' })).toEqual({
      cancelled: true,
      completed: false,
    })
    await expect(a).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.callTool.mock.calls[0]?.[2]?.signal?.aborted).toBe(true)
    expect(f.callTool.mock.calls[1]?.[2]?.signal?.aborted).toBe(false)
    expect(f.callTool.mock.calls[2]?.[2]?.signal?.aborted).toBe(false)
    two.resolve({ content: [] })
    three.resolve({ content: [] })
    one.resolve({ content: [] })
    await Promise.all([b, c])
    await f.call('after-cancel')
  })
  it('gates only the workspace and retained instance lifetime, including late completions', async () => {
    const f = fixture(),
      held = deferred<CallToolResult>()
    f.callTool.mockImplementationOnce(() => held.promise)
    const pending = f.call()
    f.enabled.delete('willow')
    held.resolve({ content: [{ type: 'text', text: 'already acted' }] })
    await expect(pending).rejects.toMatchObject({ code: 'disabled' })
    await expect(f.call('off')).rejects.toMatchObject({ code: 'disabled' })
    await f.call('still-on', 'birch')
    f.broker.invalidate()
    await expect(f.call('old-run', 'birch')).rejects.toBeInstanceOf(PluginBrokerError)
    expect(f.callTool).toHaveBeenCalledTimes(2)
  })
})
it('follows an empty cursor and has no app inventory size cap', async () => {
  const f = fixture()
  const tools = Array.from({ length: 300 }, (_, index) => ({
    ...definition,
    name: `garden_${index}`,
  }))
  f.listTools.mockImplementation(async (input) =>
    input?.cursor === '' ? { tools } : { tools: [definition], nextCursor: '' },
  )
  expect(await f.broker.listTools('willow')).toEqual([definition, ...tools])
})
it('reports a non-progressing MCP inventory without disabling later discovery', async () => {
  const f = fixture()
  f.listTools.mockResolvedValue({ tools: [], nextCursor: 'repeat' })
  await expect(f.broker.listTools('willow')).rejects.toMatchObject({ code: 'protocol' })
  f.listTools.mockResolvedValue({ tools: [definition] })
  expect(await f.broker.listTools('willow')).toEqual([definition])
})
it('never dispatches a pre-cancelled request and rejects a duplicate live request identity', async () => {
  const f = fixture(),
    abort = new AbortController(),
    held = deferred<CallToolResult>()
  abort.abort()
  await expect(
    f.broker.callTool({
      workspaceId: 'willow',
      requestId: 'cancelled',
      name: 'gather_petals',
      origin: 'button',
      signal: abort.signal,
    }),
  ).rejects.toMatchObject({ code: 'cancelled' })
  expect(f.callTool).not.toHaveBeenCalled()
  f.callTool.mockImplementationOnce(() => held.promise)
  const first = f.call()
  await expect(f.call()).rejects.toMatchObject({ code: 'duplicate-request' })
  held.resolve({ content: [] })
  await first
  expect(f.callTool).toHaveBeenCalledOnce()
})
it('does not add a fixed argument size limit or infer a domain argument', async () => {
  const f = fixture(),
    arguments_ = { tabId: 'fictional-tab', prose: 'petal'.repeat(15_000) }
  await f.broker.callTool({
    workspaceId: 'willow',
    requestId: 'large-basket',
    name: 'gather_petals',
    arguments: arguments_,
    origin: 'notification',
  })
  expect(f.callTool.mock.calls[0]?.[0]?.arguments).toBe(arguments_)
  expect(f.callTool.mock.calls[0]?.[0]?.arguments).not.toHaveProperty('profile')
})

it('retains SDK error payloads without guessing local versus remote origin from numeric codes', async () => {
  const f = fixture()
  for (const code of [
    ErrorCode.ConnectionClosed,
    ErrorCode.RequestTimeout,
    ErrorCode.InvalidParams,
  ]) {
    const remote = new McpError(code, 'fictional schema error', { field: 'basket' })
    f.callTool.mockRejectedValueOnce(remote)
    await expect(f.call('invalid')).rejects.toBe(remote)
    f.listTools.mockRejectedValueOnce(remote)
    await expect(f.broker.listTools('willow')).rejects.toBe(remote)
  }
})

it('keeps remote error data out of fixed diagnostics without hiding it from callers', async () => {
  const f = fixture()
  const remote = new McpError(-32123, 'fictional basket details', { petals: ['fern'] })
  f.callTool.mockRejectedValueOnce(remote)
  await expect(f.call()).rejects.toBe(remote)
  expect(f.diagnostic.mock.calls).toEqual([['downstream']])
  expect(await f.call('next-basket')).toMatchObject({ content: [{ text: 'petals gathered' }] })
})
