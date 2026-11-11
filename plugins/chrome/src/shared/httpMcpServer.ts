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
export async function startHttpMcpServer(
  options: HttpMcpServerOptions,
): Promise<RunningHttpMcpServer> {
  const { createServer, setupRoutes } = options
  const host = resolveBindHost(options.host)
  const allowedHosts = [...(options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS)]
  if (options.redirectConsole) {
    console.log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n')
  }
  const app = createMcpExpressApp({ host, allowedHosts })
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
    onListening: options.onListening,
    onRequestError: (error) => console.error('Error handling MCP request:', error),
    registerSignalHandlers: options.registerSignalHandlers,
  })
}
