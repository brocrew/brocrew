import { reportPluginToolFailure, type PluginToolDiagnostic } from './tool-diagnostics'
import { randomBytes, timingSafeEqual, randomUUID, createHash } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js'
import type { ManagedPluginMcpServer } from '@brobot2/runtime'
import type { BrokerReply, BrokerServer, BrokerValue, GenericPluginToolBroker } from './tool-broker'
import { PluginBrokerError } from './tool-broker'

export function createPluginCredential(): string {
  return randomBytes(32).toString('hex')
}

/** Legacy endpoint adapter; the process runner supplies the retained client for new packages. */
export function createPrivatePluginPort(options: {
  url: string
  credential: string
  privateCredentials?: readonly string[]
  diagnostic?: PluginToolDiagnostic
}): BrokerServer & { close(): Promise<void> } {
  let url: URL
  try {
    url = new URL(options.url)
    if (!/^[0-9a-f]{64}$/.test(options.credential)) throw new Error('Invalid credential')
  } catch {
    throw new Error('Plugin unavailable. Try again.')
  }
  const client = new Client({ name: 'brocrew-plugin-forwarder', version: '1' })
  client.onerror = () => reportPluginToolFailure(options.diagnostic, 'transport-call-failed')
  let connection: Promise<void> | undefined
  return {
    tool(request, signal) {
      const controller = new AbortController()
      const combined = AbortSignal.any([signal, controller.signal])
      const result = (async (): Promise<BrokerReply> => {
        try {
          if (combined.aborted) return { ok: false }
          connection ??= client
            .connect(
              new StreamableHTTPClientTransport(url, {
                requestInit: { headers: { Authorization: `Bearer ${options.credential}` } },
              }),
            )
            .catch((error: unknown) => {
              connection = undefined
              throw error
            })
          await connection
          if (combined.aborted) return { ok: false }
          const value = await client.callTool(
            {
              name: request.name,
              arguments: request.input,
              _meta: { workspaceId: request.identity.workspaceId, origin: request.identity.kind },
            },
            undefined,
            { signal: combined },
          )
          return { ok: true, value: value as BrokerValue }
        } catch {
          reportPluginToolFailure(
            options.diagnostic,
            combined.aborted ? 'cancelled' : 'transport-call-failed',
          )
          return { ok: false }
        }
      })()
      const quiescent = result.then((reply) => {
        if (!reply.ok || combined.aborted) throw new Error('Plugin request completion is unknown.')
      })
      void quiescent.catch(() => undefined)
      return { result, quiescent, cancel: () => controller.abort() }
    },
    admin() {
      return { result: Promise.resolve({ ok: false }), quiescent: Promise.resolve(), cancel() {} }
    },
    close: () => client.close(),
  }
}

export interface ManagedPluginRoute {
  readonly server: ManagedPluginMcpServer
  close(): Promise<void>
}

export function pluginProviderNamespace(pluginId: string): string {
  return /^[a-z0-9-]{1,57}$/.test(pluginId)
    ? `plugin-${pluginId}`
    : `plugin-${createHash('sha256').update(pluginId).digest('hex').slice(0, 56)}`
}

/** Only provider naming is adapted; every definition keeps its server schema and metadata. */
function providerToolName(name: string): string {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name)
    ? name
    : `tool-${createHash('sha256').update(name).digest('hex').slice(0, 59)}`
}

/** SDK Client adds a display prefix to a received JSON-RPC error. Remove exactly that
 * one prefix for the next wire hop, so its code/message/data do not change at the relay. */
function forwardMcpError(error: unknown): never {
  if (!(error instanceof McpError)) throw error
  const prefix = `MCP error ${error.code}: `
  throw Object.assign(
    new Error(
      error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message,
    ),
    { code: error.code, data: error.data },
  )
}

/** A route is retained for one workspace/instance. Provider cancellation stays scoped to it. */
export async function openManagedPluginRoute(
  broker: GenericPluginToolBroker,
  scope: { workspaceId: string; origin?: string; namespace?: string },
  current: () => boolean = () => true,
  diagnostic?: PluginToolDiagnostic,
): Promise<ManagedPluginRoute> {
  const name = scope.namespace ?? pluginProviderNamespace(broker.binding.pluginId)
  const capability = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${capability}`)
  const routeId = randomUUID()
  let accepting = true
  let closing: Promise<void> | undefined
  const exchanges = new Set<StreamableHTTPServerTransport>()
  const active = new Map<string | number, AbortController>()
  const toolNames = new Map<string, string>()
  const providerNames = new Map<string, string>()
  async function inventory(signal?: AbortSignal) {
    if (!accepting || !current()) throw new PluginBrokerError('unavailable')
    const definitions = await broker.listTools(scope.workspaceId, signal)
    if (!accepting || !current()) throw new PluginBrokerError('unavailable')
    const tools = definitions.map((tool) => {
      let encoded = providerNames.get(tool.name) ?? providerToolName(tool.name)
      // Keep aliases bound for this route's entire lifetime. A later tool must not
      // acquire an older alias, even if it deliberately resembles an encoding.
      while (toolNames.has(encoded) && toolNames.get(encoded) !== tool.name)
        encoded = `tool-${createHash('sha256')
          .update(encoded + tool.name)
          .digest('hex')
          .slice(0, 59)}`
      toolNames.set(encoded, tool.name)
      providerNames.set(tool.name, encoded)
      return encoded === tool.name ? tool : { ...tool, name: encoded }
    })
    return { tools }
  }
  const http = createServer((req, res) => {
    void (async () => {
      const supplied = Buffer.from(req.headers.authorization ?? '')
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected) ||
        !accepting ||
        !current()
      ) {
        res.writeHead(401)
        res.end()
        return
      }
      if (
        req.headers.origin !== undefined ||
        req.headers.host !== `127.0.0.1:${(http.address() as AddressInfo).port}` ||
        req.url !== '/mcp'
      ) {
        res.writeHead(403)
        res.end()
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk)
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        res.writeHead(400)
        res.end()
        return
      }
      const packet = body as { method?: unknown; id?: unknown; params?: { requestId?: unknown } }
      if (packet.method === 'notifications/cancelled') {
        const id = packet.params?.requestId
        if (typeof id === 'string' || typeof id === 'number') active.get(id)?.abort()
        res.writeHead(202)
        res.end()
        return
      }
      const controller = new AbortController()
      const id =
        packet.method === 'tools/call' &&
        (typeof packet.id === 'string' || typeof packet.id === 'number')
          ? packet.id
          : undefined
      if (id !== undefined) {
        if (active.has(id)) {
          res.writeHead(409)
          res.end()
          return
        }
        active.set(id, controller)
      }
      res.once('close', () => {
        if (id !== undefined && active.get(id) === controller) active.delete(id)
        if (!res.writableEnded) controller.abort()
      })
      const mcp = new Server({ name, version: '1' }, { capabilities: { tools: {} } })
      mcp.onerror = () => undefined
      mcp.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
        try {
          return await inventory(extra.signal)
        } catch (error) {
          return forwardMcpError(error)
        }
      })
      mcp.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
        if (!accepting || !current())
          throw new McpError(ErrorCode.InvalidRequest, 'Plugin instance is unavailable.')
        // Discovery is not an allowlist. Ordinary unencoded names can be called directly.
        const original = toolNames.get(call.params.name) ?? call.params.name
        try {
          const result = await broker.callTool({
            workspaceId: scope.workspaceId,
            requestId: `${routeId}:${JSON.stringify(extra.requestId)}`,
            name: original,
            arguments: call.params.arguments,
            meta: call.params._meta,
            origin: scope.origin ?? 'agent',
            signal: AbortSignal.any([controller.signal, extra.signal]),
          })
          if (!accepting || !current()) throw new PluginBrokerError('unavailable')
          return result
        } catch (error) {
          if (error instanceof McpError) return forwardMcpError(error)
          const code = error instanceof PluginBrokerError ? error.code : 'transport'
          reportPluginToolFailure(diagnostic, 'transport-call-failed')
          // An MCP protocol error is distinct from a valid result whose isError is true.
          return forwardMcpError(
            new McpError(ErrorCode.InternalError, `Plugin call failed: ${code}.`),
          )
        }
      })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      exchanges.add(transport)
      res.once('close', () => {
        exchanges.delete(transport)
        void mcp.close().catch(() => undefined)
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    })().catch(() => {
      reportPluginToolFailure(diagnostic, 'route-request-failed')
      fail(res)
    })
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  return {
    server: Object.freeze({
      name,
      url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
      capability,
    }),
    close() {
      return (closing ??= (async () => {
        accepting = false
        for (const controller of active.values()) controller.abort()
        active.clear()
        const closed = new Promise<void>((resolve) => http.close(() => resolve()))
        await Promise.allSettled([...exchanges].map((transport) => transport.close()))
        http.closeAllConnections()
        await closed
      })())
    },
  }
}
function fail(res: ServerResponse) {
  if (res.destroyed || res.writableEnded) return
  if (!res.headersSent) res.writeHead(400)
  res.end()
}
