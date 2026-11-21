import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createAgentMcpServer, type AgentMcpDispatch } from '../agent-mcp-server'
import type { AgentToolset } from '../agent-tools'

export interface AgentMcpLaunch {
  readonly name: string
  readonly url: string
}

// One child owns the endpoint and the tool closures, just as one Claude query owns its SDK server.
export async function openAgentMcpHttp(toolset: AgentToolset, dispatch: AgentMcpDispatch) {
  const clients = new Set<ReturnType<typeof createAgentMcpServer>['instance']>()
  const transports = new Map<string, StreamableHTTPServerTransport>()
  let closed = false
  const http = createServer((request, response) => {
    void (async () => {
      if (closed || request.url !== '/mcp') {
        response.writeHead(404).end()
        return
      }
      const sessionId = request.headers['mcp-session-id']
      let transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined
      let parsed: unknown
      if (transport === undefined) {
        if (sessionId !== undefined || request.method !== 'POST') {
          response.writeHead(404).end()
          return
        }
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          response.writeHead(400).end()
          return
        }
        if (closed) {
          response.end()
          return
        }
        const sdk = createAgentMcpServer(toolset, dispatch).instance
        clients.add(sdk)
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            transports.set(id, transport!)
          },
        })
        try {
          await sdk.connect(transport)
        } catch (error) {
          clients.delete(sdk)
          await sdk.close()
          throw error
        }
        const previous = transport.onclose
        transport.onclose = () => {
          previous?.()
          clients.delete(sdk)
          if (transport?.sessionId !== undefined) {
            transports.delete(transport.sessionId)
          }
        }
        response.once('close', () => {
          if (transport?.sessionId === undefined) void sdk.close()
        })
      }
      await transport.handleRequest(request, response, parsed)
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })
  const close = async () => {
    if (closed) return
    closed = true
    await Promise.allSettled([...clients].map((sdk) => sdk.close()))
    clients.clear()
    transports.clear()
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
  http.on('error', () => {
    void close()
  })
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', () => {
        http.off('error', reject)
        resolve()
      })
    })
    const at = http.address()
    if (at === null || typeof at === 'string') throw new Error('No loopback MCP address')
    const launch: AgentMcpLaunch = {
      name: toolset.server,
      url: `http://127.0.0.1:${at.port}/mcp`,
    }
    return { launch, close }
  } catch (error) {
    await close()
    throw error
  }
}
