import { reportPluginToolFailure, type PluginToolDiagnostic } from './tool-diagnostics'
import { PluginBrokerError } from './tool-broker'
import type { RouteAdmissionTrace } from './route-admission-trace'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { ManagedPluginMcpServer } from '@brobot2/runtime'
import type {
  BrokerAgent,
  BrokerInput,
  BrokerReply,
  BrokerServer,
  BrokerValue,
  PluginToolBroker,
} from './tool-broker'

const WORDS = 'Plugin unavailable. Try again.'
const INPUT_BYTES = 64 * 1024
const OUTPUT_BYTES = 8 * 1024 * 1024
function endpoint(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(WORDS)
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(WORDS)
  return url
}
function textReply(): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: WORDS }], isError: true }
}

export function createPluginCredential(): string {
  return randomBytes(32).toString('hex')
}

/** The downstream credential stays in this closure, outside provider configuration and diagnostics. */
export function createPrivatePluginPort(options: {
  url: string
  credential: string
  diagnostic?: PluginToolDiagnostic
}): BrokerServer {
  const report = (reason: Parameters<PluginToolDiagnostic>[0]) =>
    reportPluginToolFailure(options.diagnostic, reason)
  const url = endpoint(options.url)
  const credential = options.credential
  if (!/^[0-9a-f]{64}$/.test(credential)) throw new Error(WORDS)
  return {
    tool(request, signal) {
      let client: Client | undefined,
        cancelled = false,
        closingAfterReply = false
      let prove!: () => void, unproved!: () => void
      const quiescent = new Promise<void>((resolve, reject) => {
        prove = resolve
        unproved = () => reject(new Error(WORDS))
      })
      void quiescent.catch(() => undefined)
      const cancel = () => {
        cancelled = true
        report('cancelled')
        void client?.close().catch(() => report('transport-close-failed'))
      }
      const reportError = (error: unknown, phase: Parameters<PluginToolDiagnostic>[0]) => {
        report(phase)
        // Transport exceptions may contain page data. Only these closed causes may be retained.
        try {
          const value = error as {
            name?: unknown
            code?: unknown
            cause?: { code?: unknown }
          } | null
          const code = value?.cause?.code ?? value?.code
          if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET')
            report('transport-connection-reset')
          else if (code === 'ECONNREFUSED') report('transport-connection-refused')
          else if (
            code === 'ETIMEDOUT' ||
            code === 'UND_ERR_CONNECT_TIMEOUT' ||
            code === -32001 ||
            value?.name === 'TimeoutError'
          )
            report('transport-timeout')
          else if (value?.name === 'AbortError') report('transport-aborted')
          else if (code === 401 || code === 403) report('transport-auth-refused')
        } catch {
          /* Never inspect or stringify an arbitrary error further. */
        }
      }
      const result = (async (): Promise<BrokerReply> => {
        let natural = false
        let connected = false
        try {
          if (signal.aborted) {
            report('cancelled')
            return { ok: false }
          }
          client = new Client({ name: 'brocrew-plugin-broker', version: '1' })
          client.onerror = (error) => {
            // Closing a completed per-call client aborts its idle SSE reader. That
            // local teardown callback is not a failed tool call. Catch still reports
            // call failures; close() rejection below retains its separate diagnostic.
            if (!closingAfterReply)
              reportError(error, connected ? 'transport-call-failed' : 'transport-connect-failed')
          }
          signal.addEventListener('abort', cancel, { once: true })
          const transport = new StreamableHTTPClientTransport(url, {
            requestInit: { headers: { Authorization: `Bearer ${credential}` }, redirect: 'error' },
            fetch: async (input, init) => {
              const response = await fetch(input, { ...init, redirect: 'error' })
              if (!response.body) return response
              let bytes = 0
              const body = response.body.pipeThrough(
                new TransformStream<Uint8Array, Uint8Array>({
                  transform(chunk, controller) {
                    bytes += chunk.byteLength
                    if (bytes > OUTPUT_BYTES) {
                      report('response-limit')
                      throw new Error(WORDS)
                    }
                    controller.enqueue(chunk)
                  },
                }),
              )
              return new Response(body, { status: response.status, headers: response.headers })
            },
          })
          await client.connect(transport)
          connected = true
          const reply = await client.callTool({ name: request.name, arguments: request.input })
          natural = true
          if (cancelled || signal.aborted) {
            report('cancelled')
            return { ok: false }
          }
          const checked = CallToolResultSchema.safeParse(reply)
          if (!checked.success) {
            report('result-invalid')
            return { ok: false }
          }
          if (checked.data.isError) report('tool-error')
          return { ok: true, value: checked.data as BrokerValue }
        } catch (error) {
          reportError(
            error,
            cancelled || signal.aborted
              ? 'cancelled'
              : connected
                ? 'transport-call-failed'
                : 'transport-connect-failed',
          )
          return { ok: false }
        } finally {
          signal.removeEventListener('abort', cancel)
          let closed = false
          closingAfterReply = natural && !cancelled && !signal.aborted
          try {
            await client?.close()
            closed = true
          } catch {
            report('transport-close-failed')
          }
          if (natural && closed && !cancelled) prove()
          else unproved()
        }
      })()
      return { result, quiescent, cancel }
    },
    admin() {
      return { result: Promise.resolve({ ok: false }), quiescent: Promise.resolve(), cancel() {} }
    },
  }
}

export interface ManagedPluginRoute {
  readonly server: ManagedPluginMcpServer
  close(): Promise<void>
}
/** One authenticated HTTP endpoint bound to one opaque broker capability, with no admin surface. */
export async function openManagedPluginRoute(
  broker: PluginToolBroker,
  agent: BrokerAgent,
  diagnostic?: PluginToolDiagnostic,
  trace?: RouteAdmissionTrace,
): Promise<ManagedPluginRoute> {
  const report = (reason: Parameters<PluginToolDiagnostic>[0]) =>
    reportPluginToolFailure(diagnostic, reason)
  const offered = broker.agent.discover(agent)
  const name = offered[0]?.namespace
  if (!name || offered.some((tool) => tool.namespace !== name)) throw new Error(WORDS)
  const capability = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${capability}`)
  let accepting = true
  let closing: Promise<void> | undefined
  const exchanges = new Set<StreamableHTTPServerTransport>()
  const active = new Map<string | number, AbortController>()
  const responses = new Set<Promise<void>>()
  const http = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 },
    (req, res) => {
      void (async () => {
        const request = trace?.fresh('request')
        const supplied = Buffer.from(req.headers.authorization ?? '')
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          trace?.emit('http-bearer-refused', { condition: 'bearer' }, request)
          res.writeHead(401)
          res.end()
          return
        }
        if (!accepting) {
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
        try {
          broker.agent.discover(agent)
        } catch (error) {
          trace?.emit(
            'http-broker-refused',
            {
              condition: 'broker-discovery',
              error: error instanceof PluginBrokerError ? `broker-${error.code}` : 'unknown',
            },
            request,
          )
          report('route-unavailable')
          res.writeHead(401)
          res.end()
          return
        }
        const flushed: Promise<void> = new Promise<void>((resolve) => {
          const done = () => {
            res.off('finish', done)
            res.off('close', done)
            responses.delete(flushed)
            resolve()
          }
          res.once('finish', done)
          res.once('close', done)
        })
        responses.add(flushed)
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of req) {
          length += chunk.length
          if (length > INPUT_BYTES) {
            res.writeHead(413)
            res.end()
            return
          }
          chunks.push(chunk)
        }
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
        res.on('close', () => {
          if (id !== undefined && active.get(id) === controller) active.delete(id)
          if (!res.writableEnded) controller.abort()
        })
        const mcp = new Server({ name, version: '1' }, { capabilities: { tools: {} } })
        mcp.onerror = () => undefined
        mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: broker.agent.discover(agent).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as { type: 'object' },
          })),
        }))
        mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
          const tool = offered.find((one) => one.name === call.params.name)
          if (!tool) {
            report('route-tool-unknown')
            return textReply()
          }
          try {
            const result = await broker.agent.call(
              agent,
              tool.qualifiedName,
              (call.params.arguments ?? {}) as BrokerInput,
              controller.signal,
            )
            const parsed = CallToolResultSchema.safeParse(result)
            if (!parsed.success) report('result-invalid')
            return parsed.success ? parsed.data : textReply()
          } catch {
            // The broker audit records its own closed failure code.
            return textReply()
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
        report('route-request-failed')
        fail(res)
      })
    },
  )
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`
  // Reuse the inventory already admitted above; observation does not rediscover or authorize.
  try {
    if (trace?.aliases.incarnation)
      trace.emit('route-configured', {
        attachmentRoute: trace.attachmentId('route', url),
        server: trace.attachmentId('server', name),
        configuredTools: offered
          .flatMap((tool) => {
            const id = trace.attachmentId('tool', tool.name)
            return id ? [id] : []
          })
          .sort(),
        configuredCount: offered.length,
      })
  } catch {
    /* Diagnostic only. */
  }
  return {
    server: Object.freeze({
      name,
      url,
      capability,
    }),
    close() {
      return (closing ??= (async () => {
        accepting = false
        trace?.emit('route-close-start')
        const closed = new Promise<void>((resolve) => http.close(() => resolve()))
        broker.owner.revoke(agent)
        // Revocation answers the old caller immediately. Let that fixed failure
        // reach its HTTP response before closing the MCP transport. This bounded
        // local flush grants no remote completion or host-exit authority.
        let grace: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            Promise.all([...responses]),
            new Promise<void>((resolve) => {
              grace = setTimeout(resolve, 500)
            }),
          ])
        } finally {
          clearTimeout(grace)
        }
        for (const controller of active.values()) controller.abort()
        active.clear()
        await Promise.allSettled([...exchanges].map((transport) => transport.close()))
        http.closeAllConnections()
        await closed
        trace?.emit('route-close-complete')
      })())
    },
  }
}
function fail(res: ServerResponse) {
  if (res.destroyed || res.writableEnded) return
  if (!res.headersSent) res.writeHead(400)
  res.end()
}
