import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http'
import { mcpSessions } from './mcp-sessions.js'
import { withRequestSignal } from './request-signal.js'
type Request = IncomingMessage & { body?: unknown }
type Response = ServerResponse & {
  status(code: number): Response
  json(body: unknown): unknown
  send(body: string): unknown
}
interface Transport {
  sessionId?: string
  onclose?: () => void
  close(): Promise<void>
  handleRequest(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void>
}
type Handler = (req: Request, res: Response) => Promise<void>
interface App {
  post(path: string, handler: Handler): unknown
  get(path: string, handler: Handler): unknown
  delete(path: string, handler: Handler): unknown
  listen(port: number, host: string, ready: (error?: Error) => void): HttpServer
}
export const DEFAULT_SSE_PING_MS = 30000
export function canPing(
  res: Pick<ServerResponse, 'headersSent' | 'writableEnded' | 'destroyed' | 'getHeader'>,
): boolean {
  return (
    res.headersSent &&
    !res.writableEnded &&
    !res.destroyed &&
    String(res.getHeader('content-type') ?? '').includes('text/event-stream')
  )
}
export async function startMcpHttp<T extends Transport>(options: {
  app: App
  port: number
  host: string
  createTransport(options: {
    sessionIdGenerator: () => string
    onsessioninitialized: (sid: string) => void
  }): T
  connect(transport: T): Promise<void>
  isInitializeRequest(body: unknown): boolean
  setupRoutes?: () => void
  onListening?: () => void
  onRequestError?: (error: unknown) => void
  ssePingIntervalMs?: number
  registerSignalHandlers?: boolean
}) {
  const { app, port, host, setupRoutes, onListening, registerSignalHandlers = false } = options
  const sessions = mcpSessions<T>()
  const { transports } = sessions
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
      let transport: T
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId]
      } else if (!sessionId && options.isInitializeRequest(req.body)) {
        transport = options.createTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports[sid] = transport
          },
        })
        transport.onclose = () => sessions.closed(transport.sessionId)
        await options.connect(transport)
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
      await sessions.request(sid, () =>
        withRequestSignal(gone.signal, () => transport.handleRequest(req, res, req.body)),
      )
    } catch (error) {
      options.onRequestError?.(error)
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
  setupRoutes?.()
  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const server = app.listen(port, host, (error) => (error ? reject(error) : resolve(server)))
    server.once('error', reject)
  })
  onListening?.()
  const closeAllTransports = () => sessions.close()
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
