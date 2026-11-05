import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  ClaudeRuntime,
  CodexRuntime,
  withManagedPluginAttachments,
  type CodexIncoming,
  type CodexTransport,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  threadStartResponse,
  turnStartResponse,
} from '../../../packages/runtime/test/fixtures/codex-protocol'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { requirePluginAdapter } from '../src/main/plugins/lifecycle/adapters'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import { fixture, deferred, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { manifestFor, packageFixture, signed } from './plugin-package-fixtures'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})

/** Inert package HTTP peer: the real inventory, binding and route code uses MCP against it. */
async function host(tool: string) {
  const token = randomBytes(32).toString('hex')
  const http = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end()
    if (req.method !== 'POST') return res.writeHead(405).end()
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const packet = JSON.parse(body)
      if (packet.id === undefined) return res.writeHead(202).end()
      const result =
        packet.method === 'initialize'
          ? {
              protocolVersion: packet.params.protocolVersion,
              serverInfo: { name: 'fictional-host', version: '1' },
              capabilities: { tools: {} },
            }
          : packet.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: tool,
                    description: 'Fictional plugin tool',
                    inputSchema: { type: 'object' },
                  },
                ],
              }
            : { content: [{ type: 'text', text: 'fictional fern' }] }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ jsonrpc: '2.0', id: packet.id, result }))
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()))
        http.closeAllConnections()
      }),
  )
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  return {
    serverPid: 404941,
    origin,
    mcp: () => ({ url: `${origin}/mcp`, headers: { Authorization: `Bearer ${token}` } }),
    admin: () => ({
      url: `${origin}/v1`,
      headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}` },
    }),
  }
}

async function client(server: { url: string; headers: Record<string, string> }) {
  const mcp = new Client({ name: 'fictional-provider', version: '1' })
  mcp.onerror = () => {}
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    }),
  )
  return mcp
}

describe.skipIf(process.platform === 'win32')('Running before a fresh session starts', () => {
  it.each([
    { provider: 'claude', earlierCaller: false },
    { provider: 'codex', earlierCaller: false },
    { provider: 'claude', earlierCaller: true },
    { provider: 'codex', earlierCaller: true },
  ] as const)(
    '$provider receives and calls Chrome on its first turn despite a held sibling (earlier caller $earlierCaller)',
    async ({ provider, earlierCaller }) => {
      const peers = {
        chrome: await host('list_browser_profiles'),
        whatsapp: await host('list_chats'),
      }
      const packages = ['chrome', 'whatsapp'].map((id) => {
        const manifest = manifestFor()
        manifest.id = id
        manifest.skills = []
        manifest.platforms = [
          { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
        ]
        manifest.permissions.resources = [
          {
            id: id === 'chrome' ? 'browser-profiles' : 'whatsapp',
            label: 'Fictional resource',
            read: true,
            write: true,
          },
        ]
        return packageFixture({ manifest })
      })
      const f = await fixture({
        catalogue: signed({ format: 1, entries: packages.map((pkg) => pkg.release) }),
        download: async (release) => packages.find((pkg) => pkg.release.id === release.id)!.archive,
      })
      f.opts.runtime.start = async (spec) => {
        const exited = deferred<void>()
        return {
          runId: randomUUID(),
          exited: exited.promise,
          ready: async () => peers[spec.package.manifest.id as keyof typeof peers],
          stop: async () => exited.resolve(),
        }
      }
      await f.controller.detach(f.handle)
      const controller = sharedLifecycleWorkspaces(f.controller)
      const person = await controller.attach(f.local.sink)
      await controller.install(person, 'chrome')
      await controller.install(person, 'whatsapp')
      expect((await controller.status()).cards).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'chrome', state: 'Running' }),
          expect.objectContaining({ id: 'whatsapp', state: 'Running' }),
        ]),
      )
      expect(
        controller
          .agentAttachments(f.local.sink.workspaceId)
          .map((view) => view.installation.pluginId),
      ).toEqual(['chrome', 'whatsapp'])

      const held = deferred<void>(),
        entered = deferred<void>()
      const diagnostic = vi.fn()
      const bridge = createLifecycleAgentBridge({
        controller,
        diagnostic,
        owner: { valid: () => true },
        binding: async (view, diagnostic) => {
          if (view.installation.pluginId === 'whatsapp') {
            entered.resolve()
            await held.promise
          }
          return requirePluginAdapter(view.installation.pluginId).broker(
            view,
            async () => {},
            diagnostic,
          )
        },
      })
      cleanup.push(async () => {
        held.resolve()
        await Promise.all([controller.drain(), bridge.close()])
      })
      const lease: WorkspaceLease = {
        id: randomUUID(),
        workspace: 'a'.repeat(64),
        generation: randomUUID(),
        epoch: randomUUID(),
        counter: 0,
        renewedAt: 0,
        minor: 0,
        features: [],
      }
      const command = (input: { incarnation: string; occupied: string[]; release?: boolean }) => ({
        kind: 'agent-routes' as const,
        workspaceId: f.local.sink.workspaceId,
        workspace: lease.workspace,
        generation: lease.generation,
        lease: lease.id,
        ...input,
        release: input.release ?? false,
      })
      // Legacy-array entry point exists in both shipped and ported bridges. The earlier read
      // holds WhatsApp; it must not prevent a different incarnation from obtaining Chrome.
      const earlierRequest = command({ incarnation: randomUUID(), occupied: [] })
      const earlier = earlierCaller ? bridge.routes(lease, earlierRequest) : Promise.resolve([])
      void earlier.catch(() => {})
      if (earlierCaller) await entered.promise
      const source = new WorkspacePluginAttachments(
        {
          agentRoutes: async (input) => ({
            format: 1 as const,
            value: await bridge.routes(lease, command(input)),
          }),
        },
        f.local.sink.workspaceId,
      ).agent(['brobot'])
      const called: unknown[] = []
      const configured: string[][] = []
      const invoke = async (
        server: { url: string; headers: Record<string, string> } | undefined,
      ) => {
        if (!server) {
          called.push('no such tool')
          return
        }
        const mcp = await client(server)
        try {
          expect((await mcp.listTools()).tools.map((tool) => tool.name)).toContain(
            'list_browser_profiles',
          )
          called.push(await mcp.callTool({ name: 'list_browser_profiles', arguments: {} }))
        } finally {
          await mcp.close()
        }
      }
      const frames = new AsyncQueue<never>()
      const queue = new AsyncQueue<CodexIncoming>()
      let installed: Record<string, { url: string; http_headers: Record<string, string> }> = {}
      const wire: CodexTransport = {
        request: async (method, params) => {
          if (method === 'initialize')
            return { userAgent: `fictional/${CODEX_PROTOCOL_VERSION}`, codexHome: f.workspace }
          if (method === 'getAuthStatus') return { authMethod: 'apikey', requiresOpenaiAuth: true }
          if (method === 'account/read') return { account: { type: 'apiKey' } }
          if (method === 'thread/start' || method === 'thread/resume') {
            installed =
              (params as { config?: { mcp_servers?: typeof installed } }).config?.mcp_servers ?? {}
            configured.push(Object.keys(installed))
            return threadStartResponse('fictional-thread', f.workspace)
          }
          if (method === 'mcpServerStatus/list')
            return {
              data: Object.keys(installed).map((name) => ({
                name,
                runtimeStatus: 'connected',
                toolsError: null,
                tools: { list_browser_profiles: {} },
              })),
            }
          if (method === 'turn/start') {
            const server = installed['plugin-chrome']
            await invoke(server && { url: server.url, headers: server.http_headers })
            return turnStartResponse('fictional-first-turn')
          }
          return {}
        },
        notify() {},
        respond() {},
        respondError() {},
        incoming: () => queue,
        close: () => queue.close(),
      }
      const raw =
        provider === 'codex'
          ? new CodexRuntime(() => wire)
          : new ClaudeRuntime(
              ({ prompt, options }) => {
                configured.push(Object.keys(options.mcpServers ?? {}))
                void (async () => {
                  for await (const message of prompt) {
                    expect(message.type).toBe('user')
                    const server = options.mcpServers?.['plugin-chrome']
                    await invoke(
                      server && 'url' in server
                        ? {
                            url: server.url,
                            headers: 'headers' in server ? (server.headers ?? {}) : {},
                          }
                        : undefined,
                    )
                  }
                })().catch((error) => called.push(error))
                return {
                  interrupt: async () => {},
                  close: () => frames.close(),
                  return: async () => frames.close(),
                  [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
                }
              },
              async () => true,
            )
      const runtime = withManagedPluginAttachments(raw, source)
      const started = performance.now()
      const conversation = await runtime.start({ cwd: f.workspace, providerHome: f.workspace })
      cleanup.push(() => conversation.close())
      try {
        expect(configured[0]).toContain('plugin-chrome')
        expect(performance.now() - started).toBeLessThan(1000)
        await conversation.send('Use Chrome on this first turn.')
        await vi.waitFor(() =>
          expect(called).toEqual([
            expect.objectContaining({ content: [{ type: 'text', text: 'fictional fern' }] }),
          ]),
        )
      } finally {
        held.resolve()
        await earlier
        await vi.waitFor(
          async () => {
            const routes = await bridge.routes(lease, earlierRequest)
            expect(routes, JSON.stringify(diagnostic.mock.calls)).toHaveLength(2)
          },
          { timeout: 5000 },
        )
      }
    },
  )
})
