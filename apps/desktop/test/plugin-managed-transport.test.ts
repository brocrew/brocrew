import {
  createPrivatePluginPort,
  createPluginCredential,
} from '../src/main/plugins/managed-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { withManagedPluginMcp } from '../../../packages/runtime/src/managed-plugin-mcp'
import {
  noPrivateCredential,
  pluginProviderFixture,
  PLUGIN_MARKER,
} from './fixtures/plugin-provider-fixture'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture(secondTool = false) {
  const f = await pluginProviderFixture({ secondTool })
  cleanup.push(() => f.close())
  return f
}
async function connect(route: { server: { url: string; capability: string } }, name = 'fictional') {
  const client = new Client({ name, version: '1' })
  cleanup.push(() => client.close())
  client.onerror = () => undefined
  await client.connect(
    new StreamableHTTPClientTransport(new URL(route.server.url), {
      requestInit: { headers: { Authorization: `Bearer ${route.server.capability}` } },
    }),
  )
  return client
}
async function caller(f: Awaited<ReturnType<typeof fixture>>) {
  const route = await f.route('progress-caller')
  const client = await connect(route, 'progress-caller')
  return { client, route }
}

it('completes beyond elapsed deadlines while forwarding actual downstream progress', async () => {
  const f = await fixture()
  const { client } = await caller(f)
  f.reply('controlled')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const received: number[] = []
  let seen!: () => void
  const pending = client.callTool({ name: 'echo', arguments: { profile: 'fern' } }, undefined, {
    resetTimeoutOnProgress: true,
    onprogress: (value) => {
      received.push(value.progress)
      seen()
    },
  })
  void pending.catch(() => undefined)
  await f.admission
  expect(f.requestedProgress()).toBe(true)
  for (const value of [1, 2, 3, 4]) {
    await vi.advanceTimersByTimeAsync(35_000)
    const notification = new Promise<void>((resolve) => {
      seen = resolve
    })
    await f.progress(value)
    await notification
    expect(received).toContain(value)
  }
  f.complete()
  await expect(pending).resolves.toMatchObject({ content: [{ text: PLUGIN_MARKER }] })
  expect(received).toEqual([1, 2, 3, 4])
  expect(f.broker.status().available).toBe(true)
})

it('keeps the same route usable after an SDK idle timeout without claiming remote completion', async () => {
  const f = await fixture(true)
  const { client } = await caller(f)
  f.reply('controlled')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const pending = client.callTool({ name: 'echo', arguments: { profile: 'fern' } }, undefined, {
    timeout: 180_000,
  })
  void pending.catch(() => undefined)
  await f.admission
  await vi.advanceTimersByTimeAsync(60_001)
  await expect(pending).resolves.toMatchObject({
    isError: true,
    content: [
      {
        text: 'Tool echo took too long; completion is unknown. The operation may still be running.',
      },
    ],
  })
  expect(f.broker.status().available).toBe(true)
  expect(f.broker.owner.hasCompletionProof()).toBe(false)
  f.reply('normal')
  await expect(
    client.callTool({ name: 'other', arguments: { profile: 'fern' } }),
  ).resolves.toMatchObject({ content: [{ text: PLUGIN_MARKER }] })
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo', 'other'])
  f.broker.owner.invalidate()
  expect(f.broker.owner.hasCompletionProof()).toBe(false)
  f.complete()
})
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider} configuration discovers and calls through an authenticated SSE broker stream`, async () => {
    const f = await fixture(),
      route = await f.route(provider)
    const config =
      provider === 'claude'
        ? claudeMcpServersFor(undefined, [], [route.server])
        : withManagedPluginMcp({}, [route.server]).mcp_servers
    noPrivateCredential(config, f.credential)
    const entry = (
      config as Record<
        string,
        { url: string; headers?: Record<string, string>; http_headers?: Record<string, string> }
      >
    )[route.server.name]!
    const contentTypes: string[] = []
    const client = new Client({ name: `fictional-${provider}`, version: '1' })
    cleanup.push(() => client.close())
    client.onerror = () => undefined
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), {
        requestInit: { headers: entry.headers ?? entry.http_headers },
        fetch: async (url, init) => {
          const response = await fetch(url, init)
          contentTypes.push(response.headers.get('content-type') ?? '')
          return response
        },
      }),
    )
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo'])
    const result = await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })
    expect(result).toMatchObject({ content: [{ type: 'text', text: PLUGIN_MARKER }] })
    expect(contentTypes).toContain('text/event-stream')
    expect(f.seen).toEqual([{ method: 'tools/call', authenticated: true }])
    noPrivateCredential([result, f.audit], f.credential)
  })
}
it('releases dispatch after a real downstream reply when client close fails', async () => {
  const f = await fixture(true)
  const { client } = await caller(f)
  const unclosed: Client[] = []
  const close = vi.spyOn(Client.prototype, 'close').mockImplementationOnce(function (this: Client) {
    unclosed.push(this)
    return Promise.reject(new Error('fictional close failure'))
  })
  try {
    await expect(
      client.callTool({ name: 'echo', arguments: { profile: 'fern' } }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: 'Tool echo failed: downstream; completion is unknown.' }],
    })
    expect(f.broker.status()).toMatchObject({
      available: true,
      executing: false,
      awaitingQuiescence: true,
    })
  } finally {
    close.mockRestore()
    await Promise.all(unclosed.map((one) => one.close()))
  }
  await expect(
    client.callTool({ name: 'other', arguments: { profile: 'fern' } }),
  ).resolves.toMatchObject({ content: [{ text: PLUGIN_MARKER }] })
  expect(f.broker.status().unknownCalls).toHaveLength(1)
})
describe('authenticated broker boundaries', () => {
  it('rejects no token, wrong token, wrong route, Origin and a token for another caller', async () => {
    const f = await fixture(),
      a = await f.route('willow'),
      b = await f.route('birch')
    for (const headers of [
      {},
      { Authorization: 'Bearer wrong' },
      { Authorization: `Bearer ${b.server.capability}` },
    ]) {
      const response = await fetch(a.server.url, { method: 'POST', headers, body: '{}' })
      expect(response.status).toBe(401)
      await response.body?.cancel()
    }
    const headers = { Authorization: `Bearer ${a.server.capability}` }
    const origin = await fetch(a.server.url, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://fictional.invalid' },
      body: '{}',
    })
    expect(origin.status).toBe(403)
    await origin.body?.cancel()
    const admin = await fetch(a.server.url.replace('/mcp', '/admin'), {
      method: 'POST',
      headers,
      body: '{}',
    })
    expect(admin.status).toBe(403)
    await admin.body?.cancel()
    expect(f.seen).toEqual([])
  })
  it('denies a revoked capability even with its former bearer', async () => {
    const f = await fixture(),
      route = await f.route('willow')
    f.broker.owner.revoke(route.agent)
    const response = await fetch(route.server.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${route.server.capability}` },
      body: '{}',
    })
    expect(response.status).toBe(401)
    await response.body?.cancel()
  })
  it('preserves package-owned refusal results and leaves unsupported surfaces absent', async () => {
    const f = await fixture(),
      client = await connect(await f.route('willow'))
    f.allow(false)
    expect((await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })).isError).toBe(
      true,
    )
    await expect(client.listResources()).rejects.toThrow()
    await expect(client.listPrompts()).rejects.toThrow()
    expect(f.seen).toEqual([{ method: 'tools/call', authenticated: true }])
  })
})

it('does not invent remote quiescence when an authenticated stream is cancelled', async () => {
  const f = await fixture(),
    route = await f.route('willow')
  f.reply('hold')
  const client = await connect(route)
  const controller = new AbortController()
  const pending = client.callTool({ name: 'echo', arguments: { profile: 'fern' } }, undefined, {
    signal: controller.signal,
  })
  void pending.catch(() => undefined)
  await vi.waitFor(() => expect(f.seen.length).toBe(1))
  controller.abort()
  await expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(f.broker.status().awaitingQuiescence).toBe(true))
  expect(f.broker.status().available).toBe(true)
  expect(f.broker.owner.hasCompletionProof()).toBe(false)
  expect(f.seen).toHaveLength(1)
  noPrivateCredential(f.audit, f.credential)
})

it('delivers the failed call before closing its route while retaining unknown remote quiescence', async () => {
  const f = await fixture(),
    route = await f.route('willow')
  f.reply('hold')
  const client = await connect(route)
  const pending = client
    .callTool({ name: 'echo', arguments: { profile: 'fern' } }, undefined, { timeout: 1500 })
    .catch(() => ({ lost: true }))
  await vi.waitFor(() => expect(f.seen).toHaveLength(1))
  await route.close()
  const reply = await pending
  expect(reply).toMatchObject({ isError: true })
  await vi.waitFor(() => expect(f.broker.status().available).toBe(true))
  expect(f.broker.status().awaitingQuiescence).toBe(true)
  expect(f.broker.owner.hasCompletionProof()).toBe(false)
  noPrivateCredential([reply, f.audit], f.credential)
})

it('keeps malformed downstream configuration errors closed', () => {
  const credential = 'fictional-private-'.repeat(4)
  let error: unknown
  try {
    createPrivatePluginPort({ url: `invalid ${credential}`, credential })
  } catch (caught) {
    error = caught
  }
  expect((error as Error).message === 'Plugin unavailable. Try again.').toBe(true)
  noPrivateCredential(String(error), credential)
})

it('creates fresh fixed-length lowercase hex credentials', () => {
  const a = createPluginCredential(),
    b = createPluginCredential()
  expect(/^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b)).toBe(true)
  expect(a !== b).toBe(true)
})
it('records a closed connect-failure reason without arguments, credentials or raw transport errors', async () => {
  const reasons: string[] = []
  const port = createPrivatePluginPort({
    url: 'http://127.0.0.1:1/mcp',
    credential: 'a'.repeat(64),
    diagnostic: (reason) => reasons.push(reason),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Object.assign(new Error('fictional-private-page-body'), {
        cause: { code: 'ECONNRESET' },
      })
    }),
  )
  try {
    const execution = port.tool(
      {
        identity: {
          pluginId: 'chrome',
          installId: 'fictional',
          epoch: 'one',
          workspaceId: 'fictional',
          kind: 'agent',
          incarnation: 'one',
        },
        name: 'echo',
        input: { private: 'fictional-private-argument' },
      },
      new AbortController().signal,
    )
    await expect(execution.result).resolves.toEqual({ ok: false, cause: 'connection-failed' })
    await expect(execution.quiescent).rejects.toThrow()
    expect(reasons).toContain('transport-connect-failed')
    expect(reasons).toContain('transport-connection-reset')
    expect(JSON.stringify(reasons)).not.toMatch(/fictional-private|aaaaaaaa/)
  } finally {
    vi.unstubAllGlobals()
  }
})

it('does not diagnose successful calls as failures when their per-call MCP streams close', async () => {
  const reasons: string[] = []
  const f = await pluginProviderFixture({ diagnostic: (reason) => reasons.push(reason) })
  cleanup.push(() => f.close())
  const client = await connect(await f.route('fictional-diagnostic'))
  expect(await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })).toMatchObject({
    content: [{ text: PLUGIN_MARKER }],
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 50))
  expect(reasons).toEqual([])
})

it('still diagnoses an actual failed call even though its MCP client also closes', async () => {
  const reasons: string[] = []
  const f = await pluginProviderFixture({ diagnostic: (reason) => reasons.push(reason) })
  cleanup.push(() => f.close())
  f.reply('error')
  const client = await connect(await f.route('fictional-failed'))
  const result = await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })
  expect(result).toMatchObject({ isError: true })
  expect(reasons).toContain('transport-call-failed')
  noPrivateCredential([result, f.audit], f.credential)
})

it('delivers the real plugin tool error through the agent MCP route', async () => {
  const reasons: string[] = []
  const f = await pluginProviderFixture({ diagnostic: (reason) => reasons.push(reason) })
  cleanup.push(() => f.close())
  f.reply('tool-error')
  const client = await connect(await f.route('fictional-window-timeout'))
  expect(await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: 'Error: window operation timed out' }],
  })
  expect(reasons).toContain('tool-error')
  expect(f.broker.status().available).toBe(true)
})
