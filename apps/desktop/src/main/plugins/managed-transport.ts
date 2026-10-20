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

function containsCredential(value: unknown, credential: string): boolean {
  const pending = [value]
  const seen = new Set<object>()
  while (pending.length) {
    const item = pending.pop()
    if (typeof item === 'string' && item.includes(credential)) return true
    if (item && typeof item === 'object' && !seen.has(item)) {
      seen.add(item)
      for (const [key, child] of Object.entries(item)) {
        if (key.includes(credential)) return true
        pending.push(child)
      }
    }
  }
  return false
}

/** The downstream credential stays in this closure, outside provider configuration and diagnostics. */
export function createPrivatePluginPort(options: {
  url: string
  credential: string
  privateCredentials?: readonly string[]
}): BrokerServer {
  const url = endpoint(options.url)
  const credential = options.credential
  const privateCredentials = [credential, ...(options.privateCredentials ?? [])]
  if (
    privateCredentials.length > 3 ||
    privateCredentials.some((one) => !/^[0-9a-f]{64}$/.test(one))
  )
    throw new Error(WORDS)
  return {
    tool(request, signal) {
      let client: Client | undefined,
        cancelled = false
      let prove!: () => void, unproved!: () => void
      const quiescent = new Promise<void>((resolve, reject) => {
        prove = resolve
        unproved = () => reject(new Error(WORDS))
      })
      void quiescent.catch(() => undefined)
      const cancel = () => {
        cancelled = true
        void client?.close().catch(() => undefined)
      }
      const result = (async (): Promise<BrokerReply> => {
        let natural = false
        try {
          if (signal.aborted) return { ok: false }
          client = new Client({ name: 'brocrew-plugin-broker', version: '1' })
          client.onerror = () => undefined
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
                    if (bytes > OUTPUT_BYTES) throw new Error(WORDS)
                    controller.enqueue(chunk)
                  },
                }),
              )
              return new Response(body, { status: response.status, headers: response.headers })
            },
          })
          await client.connect(transport)
          const reply = await client.callTool({ name: request.name, arguments: request.input })
          natural = true
          if (
            cancelled ||
            signal.aborted ||
            privateCredentials.some((one) => containsCredential(reply, one))
          )
            return { ok: false }
          const checked = CallToolResultSchema.safeParse(reply)
          if (!checked.success || checked.data.isError) return { ok: false }
          return { ok: true, value: checked.data as BrokerValue }
        } catch {
          return { ok: false }
        } finally {
          signal.removeEventListener('abort', cancel)
          let closed = false
          try {
            await client?.close()
            closed = true
          } catch {
            /* No raw transport error crosses the boundary. */
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
  current: () => boolean = () => true,
): Promise<ManagedPluginRoute> {
  const offered = broker.agent.discover(agent)
  const name = offered[0]?.namespace
  if (!name || offered.some((tool) => tool.namespace !== name)) throw new Error(WORDS)
  const capability = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${capability}`)
  let accepting = true
  const exchanges = new Set<StreamableHTTPServerTransport>()
  const active = new Map<string | number, AbortController>()
  const http = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 },
    (req, res) => {
      void (async () => {
        const supplied = Buffer.from(req.headers.authorization ?? '')
        if (
          !accepting ||
          !current() ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
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
        } catch {
          res.writeHead(401)
          res.end()
          return
        }
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
          if (!current()) return textReply()
          const tool = offered.find((one) => one.name === call.params.name)
          if (!tool) return textReply()
          try {
            const result = await broker.agent.call(
              agent,
              tool.qualifiedName,
              (call.params.arguments ?? {}) as BrokerInput,
              controller.signal,
            )
            const parsed = CallToolResultSchema.safeParse(result)
            return parsed.success ? parsed.data : textReply()
          } catch {
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
      })().catch(() => fail(res))
    },
  )
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  return {
    server: Object.freeze({
      name,
      url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
      capability,
    }),
    async close() {
      accepting = false
      for (const controller of active.values()) controller.abort()
      active.clear()
      broker.owner.revoke(agent)
      await Promise.allSettled([...exchanges].map((transport) => transport.close()))
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
function fail(res: ServerResponse) {
  if (res.destroyed || res.writableEnded) return
  if (!res.headersSent) res.writeHead(400)
  res.end()
}
