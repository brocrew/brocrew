import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

/** A real local MCP server on its own kernel-assigned `127.0.0.1` port, in this process. */
export interface LocalServer {
  readonly url: string
  close(): Promise<void>
}

/**
 * ⚠️ **A fresh server and transport PER REQUEST, which is the reference implementation's own
 * stateless shape.** ⛔ One long-lived stateless transport rejects the `initialized` notification
 * that follows `initialize` — measured, not guessed: the client's `connect()` threw
 * *"Error POSTing to endpoint"* against a shared instance and succeeds against this one.
 */
export async function startLocalMcpServer(tools: readonly string[]): Promise<LocalServer> {
  const build = async (): Promise<StreamableHTTPServerTransport> => {
    const mcp = new McpServer({ name: 'fixture', version: '1' })
    for (const name of tools) {
      mcp.registerTool(name, { description: `the fixture's ${name}` }, () => ({
        content: [{ type: 'text' as const, text: 'never called' }],
      }))
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await mcp.connect(transport)
    return transport
  }
  const http: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const transport = await build()
      res.on('close', () => void transport.close())
      await transport.handleRequest(req, res)
    })()
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
