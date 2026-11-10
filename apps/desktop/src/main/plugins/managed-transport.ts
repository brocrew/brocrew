import { reportPluginToolFailure, type PluginToolDiagnostic } from './tool-diagnostics'
import { PluginBrokerError } from './tool-broker'
import type { RouteAdmissionTrace } from './route-admission-trace'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { ManagedPluginMcpServer } from '@brobot2/runtime/managed-plugin-mcp'
import type {
  BrokerAgent,
  BrokerCallCause,
  BrokerInput,
  BrokerReply,
  BrokerServer,
  BrokerValue,
  PluginToolBroker,
} from './tool-broker'

const WORDS = 'Plugin unavailable. Try again.'
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
function textReply(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
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
    independentToolCalls: true,
    tool(request, signal, onprogress) {
      let client: Client | undefined,
        cancelled = false,
        connected = false,
        closingAfterReply = false
      const cancellation = new AbortController()
      let prove!: () => void, unproved!: (cause?: BrokerCallCause, error?: unknown) => void
      let failureCause: BrokerCallCause | undefined
      let failureError: unknown
      const quiescent = new Promise<void>((resolve, reject) => {
        prove = resolve
        unproved = (cause, error) =>
          reject(new PluginBrokerError('downstream', request.name, cause, true, false, error))
      })
      void quiescent.catch(() => undefined)
      const cancel = () => {
        cancelled = true
        report('cancelled')
        cancellation.abort()
        if (!connected) void client?.close().catch(() => report('transport-close-failed'))
      }
      const reportError = (
        error: unknown,
        phase: Parameters<PluginToolDiagnostic>[0],
      ): BrokerCallCause => {
        report(phase)
        try {
          const value = error as {
            name?: unknown
            code?: unknown
            cause?: { code?: unknown }
          } | null
          const code = value?.cause?.code ?? value?.code
          if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
            report('transport-connection-reset')
            return 'connection-failed'
          } else if (code === 'ECONNREFUSED') {
            report('transport-connection-refused')
            return 'connection-failed'
          } else if (
            code === 'ETIMEDOUT' ||
            code === 'UND_ERR_CONNECT_TIMEOUT' ||
            code === -32001 ||
            value?.name === 'TimeoutError'
          ) {
            report('transport-timeout')
            return 'stalled'
          } else if (value?.name === 'AbortError') {
            report('transport-aborted')
            return 'cancelled'
          } else if (code === 401 || code === 403) report('transport-auth-refused')
        } catch {
          /* Fall back to downstream if classification fails. */
        }
        return 'downstream'
      }
      const result = (async (): Promise<BrokerReply> => {
        let natural = false
        try {
          if (signal.aborted) {
            report('cancelled')
            return { ok: false }
          }
          client = new Client({ name: 'brocrew-plugin-broker', version: '1' })
          client.onerror = (error) => {
            // Closing a completed client aborts its idle SSE reader.
            if (!closingAfterReply)
              reportError(error, connected ? 'transport-call-failed' : 'transport-connect-failed')
          }
          signal.addEventListener('abort', cancel, { once: true })
          const transport = new StreamableHTTPClientTransport(url, {
            requestInit: { headers: { Authorization: `Bearer ${credential}` }, redirect: 'error' },
          })
          await client.connect(transport)
          connected = true
          const reply = await client.callTool(
            { name: request.name, arguments: request.input, _meta: request._meta },
            undefined,
            {
              signal: cancellation.signal,
              resetTimeoutOnProgress: true,
              onprogress: (progress) => onprogress?.(progress),
            },
          )
          natural = true
          if (cancelled || signal.aborted) {
            report('cancelled')
            return { ok: false }
          }
          if (reply.isError) report('tool-error')
          return { ok: true, value: reply as BrokerValue }
        } catch (error) {
          const cause = reportError(
            error,
            cancelled || signal.aborted
              ? 'cancelled'
              : connected
                ? 'transport-call-failed'
                : 'transport-connect-failed',
          )
          failureError = error
          failureCause = cancelled || signal.aborted ? 'cancelled' : cause
          return { ok: false, cause: cancelled || signal.aborted ? 'cancelled' : cause, error }
        } finally {
          signal.removeEventListener('abort', cancel)
          let closed = false
          closingAfterReply = natural && !cancelled && !signal.aborted
          try {
            await client?.close()
            closed = true
          } catch (error) {
            failureError ??= error
            report('transport-close-failed')
          }
          if (natural && closed && !cancelled) prove()
          else unproved(failureCause, failureError)
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
        const request = trace ? randomUUID() : undefined
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
        for await (const chunk of req) {
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
          tools: broker.agent
            .discover(agent)
            .map(
              (tool) =>
                Object.fromEntries(
                  Object.entries(tool).filter(
                    ([key]) => key !== 'namespace' && key !== 'qualifiedName',
                  ),
                ) as Tool,
            ),
        }))
        mcp.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
          const tool = offered.find((one) => one.name === call.params.name)
          if (!tool) {
            report('route-tool-unknown')
            return textReply('The requested plugin tool is not offered.')
          }
          try {
            const result = await broker.agent.call(
              agent,
              tool.qualifiedName,
              (call.params.arguments ?? {}) as BrokerInput,
              controller.signal,
              (progress) => {
                const progressToken = call.params._meta?.progressToken
                if (progressToken !== undefined)
                  void extra
                    .sendNotification({
                      method: 'notifications/progress',
                      params: { ...progress, progressToken },
                    })
                    .catch(() => undefined)
              },
              call.params._meta,
            )
            return result as CallToolResult
          } catch (error) {
            // The broker audit records its own closed failure code.
            return textReply(
              error instanceof PluginBrokerError
                ? error.tool
                  ? error.message
                  : new PluginBrokerError(error.code, tool.name, undefined, false).message
                : error instanceof Error
                  ? error.message
                  : String(error),
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
      })().catch((error) => {
        report('route-request-failed')
        fail(res, error)
      })
    },
  )
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`
  if (trace) {
    trace.context.route = url
    if (trace.context.incarnation)
      trace.emit('route-configured', {
        attachmentRoute: url,
        server: name,
        configuredTools: offered.map((tool) => tool.name).sort(),
        configuredCount: offered.length,
      })
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
        // Flush the refusal before closing the transport.
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
function fail(res: ServerResponse, error: unknown) {
  if (res.destroyed || res.writableEnded) return
  if (!res.headersSent) res.writeHead(400)
  res.end(error instanceof Error ? error.message : String(error))
}
