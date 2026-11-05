import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { withManagedPluginMcp } from '../../../packages/runtime/src/managed-plugin-mcp'
import { pluginProviderFixture, PLUGIN_MARKER } from './fixtures/plugin-provider-fixture'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture(options: Parameters<typeof pluginProviderFixture>[0] = {}) {
  const f = await pluginProviderFixture(options)
  cleanup.push(() => f.close())
  return f
}
async function connect(server: { url: string; capability: string }) {
  const client = new Client({ name: 'fictional-provider', version: '1' })
  client.onerror = () => undefined
  cleanup.push(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: `Bearer ${server.capability}` } },
    }),
  )
  return client
}
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider} discovers and calls the same generic route using its existing attachment API`, async () => {
    const f = await fixture(),
      route = await f.route(provider)
    const config =
      provider === 'claude'
        ? claudeMcpServersFor(undefined, [], [route.server])
        : withManagedPluginMcp({}, [route.server]).mcp_servers
    const entry = (
      config as Record<
        string,
        { url: string; headers?: Record<string, string>; http_headers?: Record<string, string> }
      >
    )[route.server.name]!
    expect(entry.url).toBe(route.server.url)
    expect(entry.headers ?? entry.http_headers).toEqual({
      Authorization: `Bearer ${route.server.capability}`,
    })
    const client = await connect(route.server)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
    const arguments_ = { basket: 'fern', profile: 'explicit-fictional-profile' }
    expect(await client.callTool({ name: 'echo', arguments: arguments_ })).toMatchObject({
      content: [{ text: PLUGIN_MARKER }],
    })
    expect(f.seen).toEqual([
      {
        name: 'echo',
        arguments: arguments_,
        meta: {
          workspaceId: 'fictional-workspace',
          origin: 'agent',
          requestId: expect.any(String),
        },
      },
    ])
  })
}
it('keeps all MCP content, structured content, isError and metadata exact through the provider route', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = await connect(route.server)
  const result = {
    content: [
      {
        type: 'text' as const,
        text: 'No petals remain',
        annotations: { audience: ['user' as const] },
      },
      { type: 'image' as const, mimeType: 'image/png', data: 'ZmVybg==' },
      { type: 'audio' as const, mimeType: 'audio/wav', data: 'ZmVybg==' },
      {
        type: 'resource' as const,
        resource: { uri: 'garden://fern', mimeType: 'text/plain', text: 'fern' },
      },
      { type: 'resource_link' as const, uri: 'garden://fern', name: 'Fern' },
    ],
    structuredContent: { available: false, settings: { flower: 'fern' } },
    isError: true,
    _meta: { garden: ['fern', { remaining: 0 }] },
  }
  f.reply(result)
  expect(await client.callTool({ name: 'echo', arguments: {} }, CallToolResultSchema)).toEqual(
    result,
  )
})
it('adds tools and changed schemas on an unchanged route without an app table', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = await connect(route.server)
  await client.listTools()
  const tools = [
    {
      name: 'plant_seeds',
      title: 'Plant seeds',
      inputSchema: {
        type: 'object' as const,
        properties: { varieties: { type: 'array', items: { type: 'string' } } },
      },
      annotations: { destructiveHint: false },
      _meta: { revision: 2 },
    },
  ]
  f.setTools(tools)
  expect((await client.listTools()).tools).toEqual(tools)
  await client.callTool({ name: 'plant_seeds', arguments: { varieties: ['fern'] } })
  expect(f.seen.at(-1)?.name).toBe('plant_seeds')
})
it('reverses only provider naming while preserving the plugin name and schema at dispatch', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = await connect(route.server)
  const name = 'garden.collect/petals with an intentionally unusual and long fictional name'
  const schema = { type: 'object' as const, properties: { flower: { type: 'string' } } }
  f.setTools([{ name, inputSchema: schema }])
  const offered = (await client.listTools()).tools[0]!
  expect(offered.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  expect(offered.inputSchema).toEqual(schema)
  await client.callTool({ name: offered.name, arguments: { flower: 'fern' } })
  expect(f.seen.at(-1)?.name).toBe(name)
})
it('reports a transport failure as an MCP protocol error and does not collapse it into a tool result', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = await connect(route.server)
  await f.client.close()
  await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toMatchObject({
    code: ErrorCode.InternalError,
    message: 'MCP error -32603: Plugin call failed: transport.',
  })
  expect(f.seen).toEqual([])
})
it.each([ErrorCode.InvalidParams, ErrorCode.ConnectionClosed, ErrorCode.RequestTimeout])(
  'preserves actual remote wire error %s through inventory and tool calls',
  async (code) => {
    const f = await fixture(),
      route = await f.route('willow'),
      client = await connect(route.server)
    const message = 'fictional basket is invalid'
    const data = { field: 'basket', alternatives: ['fern', 'violet'] }
    f.fail({ code, message, data })
    const expected = { code, message: `MCP error ${code}: ${message}`, data }
    await expect(client.listTools()).rejects.toMatchObject(expected)
    await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toMatchObject(expected)
    f.fail()
    expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
      content: [{ text: PLUGIN_MARKER }],
    })
  },
)
it('retains details of an actual local SDK timeout and permits later calls', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = await connect(route.server)
  const original = f.client.callTool.bind(f.client)
  const shortTimeout = vi
    .spyOn(f.client, 'callTool')
    .mockImplementation((request, schema, options) =>
      original(request, schema, { ...options, timeout: 50 }),
    )
  f.hold(true)
  await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toMatchObject({
    code: ErrorCode.RequestTimeout,
    data: { timeout: 50 },
  })
  await vi.waitFor(() => expect(f.cancelled).toHaveLength(1))
  f.hold(false)
  shortTimeout.mockRestore()
  expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
    content: [{ text: PLUGIN_MARKER }],
  })
})

it('propagates cancellation without closing the retained instance client or poisoning later calls', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = await connect(route.server)
  const closed = vi.spyOn(f.client, 'close')
  f.hold(true)
  const abort = new AbortController()
  const pending = client.callTool({ name: 'echo', arguments: {} }, undefined, {
    signal: abort.signal,
  })
  const outcome = pending.catch((error: unknown) => error)
  await vi.waitFor(() => expect(f.seen).toHaveLength(1))
  abort.abort()
  await outcome
  await vi.waitFor(() => expect(f.cancelled).toHaveLength(1))
  f.hold(false)
  expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
    content: [{ text: PLUGIN_MARKER }],
  })
  expect(closed).not.toHaveBeenCalled()
})
it('stops exposure in one workspace while another remains usable and rejects old routes after close', async () => {
  const f = await fixture(),
    a = await f.route('willow'),
    b = await f.route('birch', 'fictional-other')
  const first = await connect(a.server),
    second = await connect(b.server)
  f.enabled.delete('fictional-workspace')
  await expect(first.callTool({ name: 'echo', arguments: {} })).rejects.toBeInstanceOf(McpError)
  await expect(second.callTool({ name: 'echo', arguments: {} })).resolves.toMatchObject({
    content: [{ text: PLUGIN_MARKER }],
  })
  await a.close()
  await expect(first.listTools()).rejects.toThrow()
})
it('keeps attachment routing identities separate and closes only the matching route', async () => {
  const f = await fixture(),
    a = await f.route('willow'),
    b = await f.route('birch')
  const response = await fetch(a.server.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${b.server.capability}` },
    body: '{}',
  })
  expect(response.status).toBe(401)
  await response.body?.cancel()
  await a.close()
  const other = await connect(b.server)
  await other.callTool({ name: 'echo', arguments: {} })
  expect(f.seen).toHaveLength(1)
})
it('never reassigns a provider alias to a later tool that resembles the encoding', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = await connect(route.server)
  const original = 'garden.collect/petals'
  const schema = { type: 'object' as const }
  f.setTools([{ name: original, inputSchema: schema }])
  const oldAlias = (await client.listTools()).tools[0]!.name
  f.setTools([
    { name: oldAlias, inputSchema: schema },
    { name: original, inputSchema: schema },
  ])
  const next = (await client.listTools()).tools
  expect(new Set(next.map((tool) => tool.name)).size).toBe(2)
  expect(next[1]!.name).toBe(oldAlias)
  await client.callTool({ name: oldAlias, arguments: {} })
  await client.callTool({ name: next[0]!.name, arguments: {} })
  expect(f.seen.map((call) => call.name)).toEqual([original, oldAlias])
})

// 8fe65ca8 continuity: completed results stay quiet; retained clients are not per-call streams.
it.each([false, true])(
  'keeps diagnostics quiet for completed provider calls with isError=%s and route teardown',
  async (isError) => {
    const reasons: string[] = []
    const f = await fixture({ diagnostic: (reason) => reasons.push(reason) }),
      route = await f.route('diagnostic-completed'),
      client = await connect(route.server)
    const retainedClose = vi.spyOn(f.client, 'close')
    const result = {
      content: [{ type: 'text' as const, text: 'fictional private page text' }],
      structuredContent: { url: 'https://fictional.invalid/private-page' },
      isError,
      _meta: { credential: f.credential },
    }
    f.reply(result)
    for (let n = 0; n < 2; n++) {
      expect(
        await client.callTool({
          name: 'echo',
          arguments: { profile: 'fern', privateArgument: 'fictional private argument' },
        }),
      ).toEqual(result)
      expect(reasons).toEqual([])
    }
    expect(f.seen).toHaveLength(2)
    expect(retainedClose).not.toHaveBeenCalled()
    await client.close()
    await route.close()
    expect(retainedClose).not.toHaveBeenCalled()
    expect(reasons).toEqual([])
    retainedClose.mockRestore()
  },
)
it('diagnoses a real retained-client transport failure with bounded reasons only', async () => {
  const reasons: string[] = []
  const f = await fixture({ diagnostic: (reason) => reasons.push(reason) }),
    route = await f.route('diagnostic-transport-failure'),
    client = await connect(route.server)
  // Closing the actual downstream client leaves the provider route alive to observe failure.
  await f.client.close()
  await expect(
    client.callTool({
      name: 'echo',
      arguments: {
        pageText: 'fictional private page text',
        url: 'https://fictional.invalid/private-page',
        credential: f.credential,
      },
    }),
  ).rejects.toMatchObject({
    code: ErrorCode.InternalError,
    message: 'MCP error -32603: Plugin call failed: transport.',
  })
  expect(f.seen).toEqual([])
  expect(reasons).toContain('transport-call-failed')
  expect(reasons.every((reason) => reason === 'transport-call-failed')).toBe(true)
})
it('diagnoses a genuine remote protocol error without retaining its private payload', async () => {
  const reasons: string[] = []
  const f = await fixture({ diagnostic: (reason) => reasons.push(reason) }),
    route = await f.route('diagnostic-protocol-failure'),
    client = await connect(route.server)
  const message = `fictional raw error ${f.credential}`
  const data = { pageText: 'fictional private page text', url: 'https://fictional.invalid/private' }
  f.fail({ code: ErrorCode.InvalidParams, message, data })
  await expect(
    client.callTool({ name: 'echo', arguments: { privateArgument: 'fictional argument' } }),
  ).rejects.toMatchObject({ code: ErrorCode.InvalidParams, data })
  expect(f.seen).toHaveLength(1)
  expect(reasons).toEqual(['downstream'])
  f.fail()
  expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
    content: [{ text: PLUGIN_MARKER }],
  })
  expect(f.seen).toHaveLength(2)
  expect(reasons).toEqual(['downstream'])
})
