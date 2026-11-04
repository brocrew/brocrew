import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { createPluginToolBroker } from '../../src/main/plugins/tool-broker'
import {
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
export async function pluginProviderFixture(options: { createBroker?: boolean } = {}) {
  const credential = createPluginCredential()
  const seen: {
    name: string
    arguments?: Record<string, unknown>
    meta?: Record<string, unknown>
  }[] = []
  let tools: Tool[] = [
    { name: 'echo', description: 'Fictional echo', inputSchema: { type: 'object' } },
  ]
  let reply: CallToolResult = {
    content: [{ type: 'text', text: PLUGIN_MARKER }],
    _meta: { fixture: true },
  }
  let hold = false
  let failure: { code: number; message: string; data?: unknown } | undefined
  function throwFailure() {
    if (failure)
      throw Object.assign(new Error(failure.message), { code: failure.code, data: failure.data })
  }
  const enabled = new Set(['fictional-workspace', 'fictional-other'])
  const cancelled: string[] = []
  const server = new Server(
    { name: 'fictional-plugin', version: '1' },
    { capabilities: { tools: {} } },
  )
  server.onerror = () => undefined
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    throwFailure()
    return { tools }
  })
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    seen.push({
      name: request.params.name,
      arguments: request.params.arguments,
      meta: request.params._meta,
    })
    throwFailure()
    if (hold)
      await new Promise<void>((resolve) => {
        extra.signal.addEventListener(
          'abort',
          () => {
            cancelled.push(String(request.params._meta?.requestId))
            resolve()
          },
          { once: true },
        )
      })
    return reply
  })
  const client = new Client({ name: 'fictional-retained-client', version: '1' })
  client.onerror = () => undefined
  const [downstream, upstream] = InMemoryTransport.createLinkedPair()
  await server.connect(downstream)
  await client.connect(upstream)
  const broker =
    options.createBroker === false
      ? undefined
      : createPluginToolBroker({
          binding: {
            pluginId: 'fern',
            installId: 'fictional-code',
            instanceId: 'fictional-instance',
          },
          client,
          isEnabled: (workspaceId) => enabled.has(workspaceId),
        })
  const routes: Awaited<ReturnType<typeof openManagedPluginRoute>>[] = []
  return {
    broker,
    client,
    credential,
    seen,
    enabled,
    cancelled,
    setTools(value: Tool[]) {
      tools = value
    },
    reply(value: CallToolResult) {
      reply = value
    },
    hold(value: boolean) {
      hold = value
    },
    fail(value?: { code: number; message: string; data?: unknown }) {
      failure = value
    },
    async route(_incarnation: string, workspaceId = 'fictional-workspace') {
      if (!broker) throw new Error('Provider route is not part of this fixture.')
      const route = await openManagedPluginRoute(broker, { workspaceId, origin: 'agent' })
      routes.push(route)
      return route
    },
    async close() {
      broker?.invalidate()
      await Promise.allSettled(routes.map((route) => route.close()))
      await client.close()
      await server.close()
    },
  }
}
