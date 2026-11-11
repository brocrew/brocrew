import { expect, it } from 'vitest'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { startHttpMcpServer } from '../src/shared/httpMcpServer.js'
import { currentRequestSignal } from '../../shared/request-signal.js'

it('cancels the active HTTP request when its MCP caller leaves', async () => {
  const entered = Promise.withResolvers<AbortSignal>(),
    cancelled = Promise.withResolvers<boolean>()
  const running = await startHttpMcpServer({
    port: 0,
    ssePingIntervalMs: 0,
    createServer: () => {
      const server = new Server({ name: 'test', version: '1' }, { capabilities: { tools: {} } })
      server.setRequestHandler(CallToolRequestSchema, async () => {
        const signal = currentRequestSignal()!
        entered.resolve(signal)
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        cancelled.resolve(signal.aborted)
        return { content: [] }
      })
      return server
    },
  })
  const url = new URL(
    `http://127.0.0.1:${(running.httpServer.address() as { port: number }).port}/mcp`,
  )
  const client = new Client({ name: 'caller', version: '1' })
  const transport = new StreamableHTTPClientTransport(url)
  try {
    await client.connect(transport)
    const controller = new AbortController()
    const pending = fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': transport.sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 77,
        method: 'tools/call',
        params: { name: 'hold', arguments: {} },
      }),
      signal: controller.signal,
    }).then((response) => response.text())
    const rejected = expect(pending).rejects.toThrow()
    const signal = await entered.promise
    expect(signal.aborted).toBe(false)
    controller.abort()
    await rejected
    expect(await cancelled.promise).toBe(true)
  } finally {
    await client.close()
    await running.close()
  }
})
