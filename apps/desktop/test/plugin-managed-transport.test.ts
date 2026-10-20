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
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture() {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  return f
}
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
  it('enforces current resource policy and leaves unsupported surfaces absent', async () => {
    const f = await fixture(),
      route = await f.route('willow'),
      client = new Client({ name: 'fictional', version: '1' })
    cleanup.push(() => client.close())
    client.onerror = () => undefined
    await client.connect(
      new StreamableHTTPClientTransport(new URL(route.server.url), {
        requestInit: { headers: { Authorization: `Bearer ${route.server.capability}` } },
      }),
    )
    f.allow(false)
    expect((await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })).isError).toBe(
      true,
    )
    await expect(client.listResources()).rejects.toThrow()
    await expect(client.listPrompts()).rejects.toThrow()
    expect(f.seen).toEqual([])
  })
  it.each(['secret', 'metadata-secret', 'key-secret', 'error'] as const)(
    'keeps a downstream %s out of model results and diagnostics',
    async (mode) => {
      const f = await fixture(),
        route = await f.route('willow'),
        client = new Client({ name: 'fictional', version: '1' })
      cleanup.push(() => client.close())
      client.onerror = () => undefined
      f.reply(mode)
      await client.connect(
        new StreamableHTTPClientTransport(new URL(route.server.url), {
          requestInit: { headers: { Authorization: `Bearer ${route.server.capability}` } },
        }),
      )
      const result = await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })
      expect(result.isError).toBe(true)
      noPrivateCredential([result, f.audit], f.credential)
    },
  )
})

it('does not invent remote quiescence when an authenticated stream is cancelled', async () => {
  const f = await fixture(),
    route = await f.route('willow'),
    client = new Client({ name: 'fictional', version: '1' })
  cleanup.push(() => client.close())
  client.onerror = () => undefined
  f.reply('hold')
  await client.connect(
    new StreamableHTTPClientTransport(new URL(route.server.url), {
      requestInit: { headers: { Authorization: `Bearer ${route.server.capability}` } },
    }),
  )
  const controller = new AbortController()
  const pending = client.callTool({ name: 'echo', arguments: { profile: 'fern' } }, undefined, {
    signal: controller.signal,
  })
  void pending.catch(() => undefined)
  await vi.waitFor(() => expect(f.seen.length).toBe(1))
  controller.abort()
  await expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(f.broker.status().available).toBe(false), { timeout: 2000 })
  expect(f.seen).toHaveLength(1)
  noPrivateCredential(f.audit, f.credential)
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
it('also suppresses a private admin credential in a successful tool result', async () => {
  const extraPrivateCredential = 'c'.repeat(64)
  const f = await pluginProviderFixture({ extraPrivateCredential })
  cleanup.push(() => f.close())
  f.reply('secret')
  const route = await f.route('fictional-willow')
  const client = new Client({ name: 'fictional-admin-fence', version: '1' })
  client.onerror = () => undefined
  cleanup.push(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(route.server.url), {
      requestInit: { headers: { Authorization: `Bearer ${route.server.capability}` } },
    }),
  )
  const result = await client.callTool({ name: 'echo', arguments: { profile: 'fern' } })
  expect(result).toMatchObject({ isError: true })
  noPrivateCredential(result, extraPrivateCredential)
})
