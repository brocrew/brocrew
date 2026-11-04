import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import {
  createPrivatePluginPort,
  createPluginCredential,
} from '../src/main/plugins/managed-transport'
import type { BrokerRequest } from '../src/main/plugins/tool-broker'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function fixture(reply: CallToolResult) {
  const credential = createPluginCredential()
  let initializations = 0
  const exchanges = new Set<StreamableHTTPServerTransport>()
  const http = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk)
      const packet = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (packet.method === 'initialize') initializations++
      const server = new Server(
        { name: 'fictional-garden', version: '1' },
        { capabilities: { tools: {} } },
      )
      server.onerror = () => undefined
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: 'gather_petals', inputSchema: { type: 'object' } }],
      }))
      server.setRequestHandler(CallToolRequestSchema, async () => reply)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      exchanges.add(transport)
      res.once('close', () => {
        exchanges.delete(transport)
        void server.close().catch(() => undefined)
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, packet)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(400)
      res.end()
    })
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const port = createPrivatePluginPort({
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    credential,
  })
  cleanup.push(async () => {
    await (port as typeof port & { close?(): Promise<void> }).close?.()
    await Promise.allSettled([...exchanges].map((transport) => transport.close()))
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  })
  const request: BrokerRequest = {
    name: 'gather_petals',
    input: { basket: 'fern' },
    resources: [],
    identity: {
      pluginId: 'garden',
      installId: 'fictional-code',
      epoch: 'fictional-run',
      workspaceId: 'willow',
      kind: 'agent',
      incarnation: 'fictional-agent',
    },
  }
  const call = () => port.tool(request, new AbortController().signal)
  return { call, initializations: () => initializations }
}
it('returns a valid MCP isError result exactly instead of collapsing it into unavailability', async () => {
  const reply = {
    content: [{ type: 'text' as const, text: 'the basket is full' }],
    structuredContent: { remaining: 0 },
    isError: true,
    _meta: { basket: 'fern' },
  }
  const f = await fixture(reply)
  expect(await f.call().result).toEqual({ ok: true, value: reply })
})
it('retains the initialized client across valid results instead of closing after each call', async () => {
  const f = await fixture({ content: [{ type: 'text', text: 'petals gathered' }] })
  const close = vi.spyOn(Client.prototype, 'close')
  expect(await f.call().result).toMatchObject({ ok: true })
  expect(await f.call().result).toMatchObject({ ok: true })
  expect(close).not.toHaveBeenCalled()
  expect(f.initializations()).toBe(1)
})
