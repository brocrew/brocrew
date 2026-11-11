import type { Server as HttpServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { Express, RequestHandler } from 'express'
import { startMcpHttp } from '../../../shared/mcp-http.js'
export { canPing, DEFAULT_SSE_PING_MS } from '../../../shared/mcp-http.js'
interface McpServer {
  connect(transport: StreamableHTTPServerTransport): Promise<void>
}
const HOST = '127.0.0.1'
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]']
export interface HttpMcpServerOptions {
  port: number
  createServer: () => McpServer
  middleware?: readonly RequestHandler[]
  setupRoutes?: (app: Express) => void
  ssePingIntervalMs?: number
}
export interface RunningHttpMcpServer {
  close(): Promise<void>
  readonly httpServer: HttpServer
}
export async function startHttpMcpServer(
  options: HttpMcpServerOptions,
): Promise<RunningHttpMcpServer> {
  const { createServer, setupRoutes } = options
  const host = HOST
  const app = createMcpExpressApp({ host, allowedHosts: ALLOWED_HOSTS })
  for (const handler of options.middleware ?? []) app.use(handler)
  return startMcpHttp({
    app,
    port: options.port,
    host,
    createTransport: (settings) => new StreamableHTTPServerTransport(settings),
    connect: (transport) => createServer().connect(transport),
    isInitializeRequest,
    setupRoutes: () => setupRoutes?.(app),
    get ssePingIntervalMs() {
      return options.ssePingIntervalMs
    },
  })
}
