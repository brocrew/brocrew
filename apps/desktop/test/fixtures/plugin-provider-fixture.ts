import type { PluginToolDiagnostic } from '../../src/main/plugins/tool-diagnostics'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createPluginToolBroker, type BrokerTool } from '../../src/main/plugins/tool-broker'
import {
  createPrivatePluginPort,
  createPluginCredential,
  openManagedPluginRoute,
} from '../../src/main/plugins/managed-transport'

export const PLUGIN_MARKER = 'Fictional plugin result: fern'
export function noPrivateCredential(value: unknown, secret: string): void {
  JSON.stringify(value, (key, item) => {
    if (key.includes(secret) || (typeof item === 'string' && item.includes(secret)))
      throw new Error('Private plugin credential escaped')
    return item
  })
}
export async function pluginProviderFixture(
  options: { diagnostic?: PluginToolDiagnostic; secondTool?: boolean } = {},
) {
  const credential = createPluginCredential()
  const seen: { method: string; authenticated: boolean }[] = []
  const audit: unknown[] = []
  let allowed = true,
    reply: 'normal' | 'error' | 'tool-error' | 'hold' | 'controlled' = 'normal'
  let admitted!: () => void
  const admission = new Promise<void>((resolve) => {
    admitted = resolve
  })
  let complete!: () => void
  let progress!: (value: number) => Promise<void>
  let requestedProgress = false
  const transports = new Set<StreamableHTTPServerTransport>()
  const http = createServer((req, res) => {
    const authenticated = req.headers.authorization === `Bearer ${credential}`
    if (!authenticated) {
      seen.push({ method: 'refused', authenticated })
      res.writeHead(401)
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    void (async () => {
      const server = new Server(
        { name: 'fictional-plugin', version: '1' },
        { capabilities: { tools: {} } },
      )
      server.onerror = () => undefined
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: ['echo', ...(options.secondTool ? ['other'] : [])].map((name) => ({
          name,
          description: 'Fictional echo',
          inputSchema: {
            type: 'object',
            properties: { profile: { type: 'string' } },
            required: ['profile'],
          },
        })),
      }))
      server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        seen.push({ method: 'tools/call', authenticated })
        if (!allowed || request.params.arguments?.profile !== 'fern')
          return {
            isError: true,
            content: [{ type: 'text', text: 'Package settings refused the call.' }],
          }
        if (reply === 'controlled') {
          requestedProgress = request.params._meta?.progressToken !== undefined
          const done = new Promise<void>((resolve) => {
            complete = resolve
          })
          progress = async (value) => {
            const progressToken = request.params._meta?.progressToken
            if (progressToken !== undefined)
              await extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress: value, total: 4, message: `Completed ${value}` },
              })
          }
          admitted()
          await done
        }
        if (reply === 'error') throw new Error(credential)
        if (reply === 'hold') await new Promise<void>(() => undefined)
        await new Promise<void>((resolve) => setImmediate(resolve))
        return {
          content: [
            {
              type: 'text',
              text: reply === 'tool-error' ? 'Error: window operation timed out' : PLUGIN_MARKER,
            },
          ],
          ...(reply === 'tool-error' ? { isError: true } : {}),
          _meta: { fixture: true },
        }
      })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      transports.add(transport)
      res.once('close', () => {
        transports.delete(transport)
        void server.close().catch(() => undefined)
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(400)
      res.end()
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`
  const broker = createPluginToolBroker({
    binding: { pluginId: 'fern', installId: 'fixture-install', epoch: 'fixture-epoch' },
    reservedNamespace: 'brobot',
    hostToolNames: [],
    occupiedNamespaces: [],
    occupiedQualifiedNames: [],
    tools: ['echo', ...(options.secondTool ? ['other'] : [])].map<BrokerTool>((name) => ({
      name,
      description: 'Fictional echo',
      inputSchema: {
        type: 'object',
        properties: { profile: { type: 'string' } },
        required: ['profile'],
        additionalProperties: false,
      },
    })),
    adminOperations: [],
    server: createPrivatePluginPort({
      url,
      credential,
      diagnostic: options.diagnostic,
    }),
    audit: (event) => audit.push(event),
  })
  const routes: Awaited<ReturnType<typeof openManagedPluginRoute>>[] = []
  const workspace = broker.owner.attach('fictional-workspace')
  return {
    broker,
    credential,
    seen,
    audit,
    admission,
    requestedProgress: () => requestedProgress,
    progress: (value: number) => progress(value),
    complete: () => complete(),
    allow(value: boolean) {
      allowed = value
    },
    reply(value: typeof reply) {
      reply = value
    },
    async route(incarnation: string) {
      const agent = broker.owner.grantAgent(workspace, incarnation)
      const route = await openManagedPluginRoute(broker, agent)
      routes.push(route)
      return { ...route, agent }
    },
    async close() {
      await Promise.allSettled(routes.map((route) => route.close()))
      broker.owner.invalidate()
      await Promise.allSettled([...transports].map((transport) => transport.close()))
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
