import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { openAgentMcpHttp } from '../src/codex/agent-mcp-http'
import type { AgentMcpDispatch } from '../src/agent-mcp-server'
import type { AgentToolset } from '../src/agent-tools'

const opened: { close(): Promise<void> }[] = []
afterEach(async () => {
  for (const one of opened.reverse()) await one.close()
  opened.length = 0
})

const toolset = (calls: Record<string, unknown>[]): AgentToolset => ({
  server: 'brobot',
  instructions: 'The same app tools on either transport.',
  tools: [
    {
      name: 'message_agent',
      description: 'Send the current message.',
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: { text: z.string().describe('Words to send.') },
      call: async (args) => {
        calls.push(args)
        return {
          text: 'sent',
          structured: {
            outcome: 'ok',
            delivery: 'sent',
            kind: 'note',
            agent: 'receiver',
            messageAct: 'message_act_12345678-1234-4123-8123-123456789abc',
          },
        }
      },
    },
  ],
})

async function connected(dispatch?: AgentMcpDispatch) {
  const calls: Record<string, unknown>[] = []
  const server = await openAgentMcpHttp(toolset(calls), dispatch ?? ((one, args) => one.call(args)))
  opened.push(server)
  const client = new Client({ name: 'fictional-codex', version: '1' })
  opened.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(server.launch.url)))
  return { server, client, calls }
}

it('serves the current neutral schema, raw arguments and receipt through the shared SDK factory', async () => {
  const { client, calls } = await connected()
  const list = await client.listTools()
  expect(list.tools.map((one) => [one.name, one.description])).toEqual([
    ['message_agent', 'Send the current message.'],
  ])
  expect(list.tools[0]!.inputSchema.properties?.text).toMatchObject({
    description: 'Words to send.',
  })
  const result = await client.callTool({
    name: 'message_agent',
    arguments: { text: 'hello', extra: 3 },
  })
  expect(calls).toEqual([{ text: 'hello', extra: 3 }])
  expect(result).toMatchObject({
    content: [{ type: 'text', text: 'sent' }],
    _meta: { 'brobot/message-act': 'message_act_12345678-1234-4123-8123-123456789abc' },
  })
})

it('passes native call metadata to the same dispatch without guessing from argument equality', async () => {
  const metadata: unknown[] = []
  const { client } = await connected(async (one, args, extra) => {
    metadata.push((extra as { _meta?: unknown })._meta)
    return one.call(args)
  })
  await Promise.all(
    ['first', 'second'].map((callId) =>
      client.callTool({
        name: 'message_agent',
        arguments: { text: 'same' },
        _meta: { callId, 'x-codex-turn-metadata': { thread_id: 'thread', turn_id: 'turn' } },
      }),
    ),
  )
  expect(metadata).toEqual(
    ['first', 'second'].map((callId) => ({
      callId,
      'x-codex-turn-metadata': { thread_id: 'thread', turn_id: 'turn' },
    })),
  )
})

it('delivers cancellation to the waiting dispatch so a pending approval can be settled', async () => {
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  let cancelled!: () => void
  const stopped = new Promise<void>((resolve) => {
    cancelled = resolve
  })
  const { client } = await connected(async (_one, _args, extra) => {
    const signal = (extra as { signal: AbortSignal }).signal
    started()
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        'abort',
        () => {
          cancelled()
          resolve()
        },
        { once: true },
      ),
    )
    return { text: 'cancelled before approval' }
  })
  const abort = new AbortController()
  const result = client.callTool(
    { name: 'message_agent', arguments: { text: 'wait' } },
    undefined,
    { signal: abort.signal },
  )
  const rejected = expect(result).rejects.toThrow()
  await entered
  abort.abort()
  await rejected
  await stopped
})

it('rejects unknown MCP session IDs and closes idempotently', async () => {
  const { server, client } = await connected()
  const foreign = await fetch(server.launch.url, { headers: { 'mcp-session-id': 'foreign-id' } })
  expect(foreign.status).toBe(404)
  await client.close()
  await server.close()
  await server.close()
  await expect(fetch(server.launch.url)).rejects.toThrow()
})
