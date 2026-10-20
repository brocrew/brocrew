import { randomUUID } from 'node:crypto'
import type { Server as HttpServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { Express, Request, RequestHandler, Response } from 'express'
import { withRequestSignal } from './requestSignal.js'
interface McpServer {
  connect(transport: StreamableHTTPServerTransport): Promise<void>
}
export const DEFAULT_SSE_PING_MS = 30000
export const DEFAULT_BIND_HOST = '127.0.0.1'
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '[::1]',
  'host.docker.internal',
]
export const BIND_HOST_ENV = 'MCP_BIND_HOST'
const VALID_BIND_HOST = /^(?:[A-Za-z0-9.-]+|[0-9A-Fa-f:]+)$/
export function resolveBindHost(optionHost?: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[BIND_HOST_ENV]?.trim()
  const host = fromEnv || optionHost || DEFAULT_BIND_HOST
  if (!VALID_BIND_HOST.test(host)) {
    throw new Error(
      `Invalid bind host${fromEnv ? ` in ${BIND_HOST_ENV}` : ''}: ${JSON.stringify(host)}`,
    )
  }
  return host
}
export interface HttpMcpServerOptions {
  port: number
  host?: string
  allowedHosts?: readonly string[]
  createServer: () => McpServer
  middleware?: readonly RequestHandler[]
  setupRoutes?: (app: Express) => void
  onListening?: () => void
  redirectConsole?: boolean
  ssePingIntervalMs?: number
  registerSignalHandlers?: boolean
}
export interface RunningHttpMcpServer {
  close(): Promise<void>
  readonly httpServer: HttpServer
}
export function canPing(
  res: Pick<Response, 'headersSent' | 'writableEnded' | 'destroyed' | 'getHeader'>,
): boolean {
  return (
    res.headersSent &&
    !res.writableEnded &&
    !res.destroyed &&
    String(res.getHeader('content-type') ?? '').includes('text/event-stream')
  )
}
export async function startHttpMcpServer(
  options: HttpMcpServerOptions,
): Promise<RunningHttpMcpServer> {
  const {
    port,
    createServer,
    setupRoutes,
    onListening,
    redirectConsole = false,
    registerSignalHandlers = false,
  } = options
  const host = resolveBindHost(options.host)
  const allowedHosts = [...(options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS)]
  if (redirectConsole) {
    console.log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n')
  }
  const app = createMcpExpressApp({ host, allowedHosts })
  for (const handler of options.middleware ?? []) app.use(handler)
  const transports: Record<string, StreamableHTTPServerTransport> = {}
  const pendingRequests = new Map<string, number>()
  const closedSessions = new Set<string>()
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    const gone = new AbortController()
    const pingMs = options.ssePingIntervalMs ?? DEFAULT_SSE_PING_MS
    const pinger =
      pingMs > 0
        ? setInterval(() => {
            if (canPing(res)) res.write(': ping\n\n')
          }, pingMs)
        : null
    pinger?.unref()
    res.once('close', () => {
      if (pinger) clearInterval(pinger)
      if (!res.writableFinished) gone.abort()
    })
    try {
      let transport: StreamableHTTPServerTransport
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId]
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports[sid] = transport
          },
        })
        transport.onclose = () => {
          const sid = transport.sessionId
          if (!sid) return
          if (pendingRequests.get(sid)) {
            closedSessions.add(sid)
          } else {
            delete transports[sid]
          }
        }
        const server = createServer()
        await server.connect(transport)
        await withRequestSignal(gone.signal, () => transport.handleRequest(req, res, req.body))
        return
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        })
        return
      }
      const sid = transport.sessionId ?? sessionId!
      pendingRequests.set(sid, (pendingRequests.get(sid) ?? 0) + 1)
      try {
        await withRequestSignal(gone.signal, () => transport.handleRequest(req, res, req.body))
      } finally {
        const count = (pendingRequests.get(sid) ?? 1) - 1
        if (count <= 0) {
          pendingRequests.delete(sid)
          if (closedSessions.has(sid)) {
            closedSessions.delete(sid)
            delete transports[sid]
          }
        } else {
          pendingRequests.set(sid, count)
        }
      }
    } catch (error) {
      console.error('Error handling MCP request:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    }
  })
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    const pingMs = options.ssePingIntervalMs ?? DEFAULT_SSE_PING_MS
    if (pingMs > 0) {
      const timer = setInterval(() => {
        if (res.headersSent && !res.writableEnded && !res.destroyed) res.write(': ping\n\n')
      }, pingMs)
      timer.unref()
      res.once('close', () => clearInterval(timer))
    }
    await transports[sessionId].handleRequest(req, res)
  })
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    await transports[sessionId].handleRequest(req, res)
  })
  if (setupRoutes) {
    setupRoutes(app)
  }
  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server))
    server.once('error', reject)
  })
  onListening?.()
  const closeAllTransports = async () => {
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close()
        delete transports[sid]
      } catch {
        /* Continue without this optional result. */
      }
    }
  }
  if (registerSignalHandlers) {
    const shutdown = async () => {
      await closeAllTransports()
      httpServer.close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }
  return {
    httpServer,
    async close() {
      await closeAllTransports()
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}
