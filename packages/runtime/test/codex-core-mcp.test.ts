import * as coreDeadline from '../src/codex/core-tool-deadline'
import { MessageActCalls } from '../src/message-act'
import { requestKey } from '../src/codex/runtime-parts/wire-values'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CodexRuntime } from '../src/codex'
import type { AgentToolDefinition, AgentToolset } from '../src/agent-tools'
import type { RuntimeEvent } from '../src'
import type { SessionRef } from '../src/session-ref'
import { readinessHomes, Wire } from './fixtures/plugin-readiness'
import { CORE_APPROVAL_TIMEOUT, CORE_TOOL_WAIT_SECONDS } from '../src/codex/core-tool-deadline'

const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
})
const { home, handles } = readinessHomes()
beforeEach(() => vi.useRealTimers())
afterEach(() => vi.restoreAllMocks())

function offered(call: AgentToolDefinition['call'], covered = true): AgentToolset {
  return {
    server: 'brobot',
    tools: [
      {
        name: 'compact_agent',
        description: 'Compact the current conversation history.',
        input: { agent: z.string() },
        beyondItsRails: covered
          ? 'nothing-its-rails-do-not-cover'
          : 'it-starts-something-outside-this-app',
        call,
      },
    ],
  }
}

async function opened(
  tools: AgentToolset,
  previous?: { ref: SessionRef; location: ReturnType<typeof home> },
) {
  const location = previous?.location ?? home()
  const wire = new Wire(location)
  const runtime = new CodexRuntime(() => wire)
  const options = { ...location, agentTools: tools, approvalMode: 'ask' as const, model: 'm' }
  const handle = previous
    ? await runtime.resume(previous.ref, options)
    : await runtime.start(options)
  handles.push(handle)
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  const launch = wire.requests.find(
    (one) => one.method === (previous ? 'thread/resume' : 'thread/start'),
  )!.params as {
    dynamicTools?: unknown
    config: {
      mcp_servers: Record<
        string,
        {
          url: string
          tools: unknown
          tool_timeout_sec: number
        }
      >
    }
  }
  const endpoint = launch.config.mcp_servers.brobot!
  const client = new Client({ name: 'fictional-native-mcp', version: '1' })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url)))
  return { location, wire, handle, events, launch, endpoint, client }
}

const metadata = (callId: string, turn = 'fictional-turn-1', thread = 'fictional-thread') => ({
  callId,
  'x-codex-turn-metadata': { thread_id: thread, turn_id: turn },
})

it('fresh and resumed threads discover the current core catalogue, without fresh dynamic tools', async () => {
  const freshCalls: Record<string, unknown>[] = []
  const first = await opened(
    offered(async (args) => {
      freshCalls.push(args)
      return { text: 'old' }
    }),
  )
  expect(first.launch.dynamicTools).toBeUndefined()
  expect(first.endpoint).not.toHaveProperty('http_headers')
  expect(first.endpoint.tools).toEqual({ compact_agent: { approval_mode: 'approve' } })
  expect(first.endpoint.tool_timeout_sec).toBe(CORE_TOOL_WAIT_SECONDS)
  expect(CORE_TOOL_WAIT_SECONDS).toBe(24 * 60 * 60 + 60)
  expect((await first.client.listTools()).tools.map((one) => one.name)).toEqual(['compact_agent'])
  await first.handle.send('compact another conversation')
  const freshResult = await first.client.callTool({
    name: 'compact_agent',
    arguments: { agent: 'another-conversation' },
    _meta: metadata('fresh-call'),
  })
  expect(freshResult.content).toEqual([{ type: 'text', text: 'old' }])
  expect(freshCalls).toEqual([{ agent: 'another-conversation' }])
  const ref = first.handle.ref!
  await first.client.close()
  await first.handle.close()
  const calls: Record<string, unknown>[] = []
  const nextTools = offered(async (args) => {
    calls.push(args)
    return { text: 'current queued result' }
  })
  const next = await opened(
    {
      ...nextTools,
      tools: nextTools.tools.map((one) => ({ ...one, description: 'Current description.' })),
    },
    { ref, location: first.location },
  )
  const list = await next.client.listTools()
  expect(list.tools.map((one) => [one.name, one.description])).toEqual([
    ['compact_agent', 'Current description.'],
  ])
  await next.handle.send('continue')
  const result = await next.client.callTool({
    name: 'compact_agent',
    arguments: { agent: 'another-conversation', extra: 4 },
    _meta: metadata('current-call'),
  })
  expect(calls).toEqual([{ agent: 'another-conversation', extra: 4 }])
  expect(result.content).toEqual([{ type: 'text', text: 'current queued result' }])
  expect(next.events.some((event) => event.type === 'permission_request')).toBe(false)
})

it('keeps the existing app prompt and uses its answer rather than a second native approval', async () => {
  const calls: unknown[] = []
  const fixture = await opened(
    offered(async (args) => {
      calls.push(args)
      return { text: 'approved' }
    }, false),
  )
  await fixture.handle.send('work')
  const result = fixture.client.callTool({
    name: 'compact_agent',
    arguments: { agent: 'other' },
    _meta: metadata('prompted'),
  })
  await vi.waitFor(() =>
    expect(fixture.events.filter((event) => event.type === 'permission_request')).toHaveLength(1),
  )
  expect(calls).toEqual([])
  const card = fixture.events.find((event) => event.type === 'permission_request')!
  await fixture.handle.respondPermission(card.id, { outcome: 'allow' })
  expect((await result).content).toEqual([{ type: 'text', text: 'approved' }])
  expect(calls).toEqual([{ agent: 'other' }])
})

it('closes a cancelled pending prompt and never runs it after a late approval', async () => {
  const call = vi.fn(async () => ({ text: 'must not run' }))
  const fixture = await opened(offered(call, false))
  await fixture.handle.send('work')
  const abort = new AbortController()
  const result = fixture.client.callTool(
    { name: 'compact_agent', arguments: { agent: 'other' }, _meta: metadata('cancelled') },
    undefined,
    { signal: abort.signal },
  )
  const failed = expect(result).rejects.toThrow()
  await vi.waitFor(() =>
    expect(fixture.events.some((event) => event.type === 'permission_request')).toBe(true),
  )
  const card = fixture.events.find((event) => event.type === 'permission_request')!
  abort.abort()
  await failed
  await vi.waitFor(() =>
    expect(fixture.events).toContainEqual({ type: 'request_resolved', id: card.id }),
  )
  await expect(fixture.handle.respondPermission(card.id, { outcome: 'allow' })).rejects.toThrow()
  expect(call).not.toHaveBeenCalled()
})

it('preserves a rail refusal and rejects unbound, late and repeated calls', async () => {
  const call = vi.fn(async () => ({
    text: 'Refused by the existing rail.',
    structured: { outcome: 'refused' },
  }))
  const fixture = await opened(offered(call))
  const args = { name: 'compact_agent', arguments: { agent: 'other' } }
  expect((await fixture.client.callTool(args)).content).toEqual([
    { type: 'text', text: 'this session cannot take tool calls right now' },
  ])
  await fixture.handle.send('work')
  expect((await fixture.client.callTool({ ...args, _meta: metadata('refused') })).content).toEqual([
    { type: 'text', text: 'Refused by the existing rail.' },
  ])
  await fixture.client.callTool({ ...args, _meta: metadata('refused') })
  for (const foreign of [
    metadata('foreign-turn', 'different-turn'),
    metadata('foreign-thread', 'fictional-turn-1', 'different-thread'),
  ]) {
    expect((await fixture.client.callTool({ ...args, _meta: foreign })).content).toEqual([
      { type: 'text', text: 'this session cannot take tool calls right now' },
    ])
  }
  fixture.wire.finish()
  await vi.waitFor(() => expect(fixture.handle.status()).toBe('idle'))
  await fixture.client.callTool({ ...args, _meta: metadata('late') })
  expect(call).toHaveBeenCalledTimes(1)
  await fixture.handle.close()
  await expect(fetch(fixture.endpoint.url)).rejects.toThrow()
})

it('pairs a message receipt with the exact native MCP completion', async () => {
  const act = 'message_act_12345678-1234-4123-8123-123456789abc'
  const set = offered(async () => ({
    text: 'sent',
    structured: {
      outcome: 'ok',
      delivery: 'sent',
      kind: 'note',
      agent: 'other',
      messageAct: act,
    },
  }))
  const fixture = await opened({
    ...set,
    tools: set.tools.map((one) => ({ ...one, name: 'message_agent' })),
  })
  await fixture.handle.send('work')
  const result = await fixture.client.callTool({
    name: 'message_agent',
    arguments: { agent: 'other' },
    _meta: metadata('message-call'),
  })
  expect(result._meta).toEqual({ 'brobot/message-act': act })
  fixture.wire.queue.push({
    kind: 'notification',
    method: 'item/completed',
    params: {
      threadId: 'fictional-thread',
      turnId: 'fictional-turn-1',
      item: {
        id: 'message-call',
        type: 'mcpToolCall',
        server: 'brobot',
        tool: 'message_agent',
        arguments: { agent: 'other' },
        status: 'completed',
        durationMs: 1,
        result,
        error: null,
      },
    },
  })
  await vi.waitFor(() =>
    expect(
      fixture.events.some((event) => event.type === 'tool_result' && event.messageAct === act),
    ).toBe(true),
  )
})

it('closes the owned endpoint when thread startup fails', async () => {
  const location = home()
  const wire = new Wire(location)
  const request = wire.request.bind(wire)
  vi.spyOn(wire, 'request').mockImplementation(async (method, params) => {
    const answer = await request(method, params)
    if (method === 'thread/start') throw new Error('fictional startup failure')
    return answer
  })
  await expect(
    new CodexRuntime(() => wire).start({
      ...location,
      approvalMode: 'ask',
      model: 'm',
      agentTools: offered(async () => ({ text: 'unused' })),
    }),
  ).rejects.toThrow()
  const params = wire.requests.find((one) => one.method === 'thread/start')!.params as {
    config: { mcp_servers: { brobot: { url: string } } }
  }
  await expect(fetch(params.config.mcp_servers.brobot.url)).rejects.toThrow()
})

it('expires a prompted call with a short injected deadline and never accepts a late action', async () => {
  const call = vi.fn(async () => ({ text: 'must not run' }))
  const fixture = await opened(offered(call, false))
  await fixture.handle.send('work')
  const deadline = coreDeadline.coreApprovalDeadline
  vi.spyOn(coreDeadline, 'coreApprovalDeadline').mockImplementation((signal) =>
    deadline(signal, 25),
  )
  const result = fixture.client.callTool({
    name: 'compact_agent',
    arguments: { agent: 'other' },
    _meta: metadata('approval-deadline'),
  })
  await vi.waitFor(() =>
    expect(fixture.events.some((event) => event.type === 'permission_request')).toBe(true),
  )
  const card = fixture.events.find((event) => event.type === 'permission_request')!
  expect((await result).content).toEqual([{ type: 'text', text: CORE_APPROVAL_TIMEOUT }])
  expect(fixture.events).toContainEqual({ type: 'request_resolved', id: card.id })
  await expect(fixture.handle.respondPermission(card.id, { outcome: 'allow' })).rejects.toThrow()
  expect(call).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('does not cancel or retry a tool after its side effect has begun', async () => {
  let finish!: () => void
  let completed = false
  const gate = new Promise<void>((resolve) => {
    finish = resolve
  })
  const call = vi.fn(async () => {
    await gate
    completed = true
    return { text: 'completed once' }
  })
  const fixture = await opened(offered(call))
  await fixture.handle.send('work')
  const abort = new AbortController()
  const result = fixture.client.callTool(
    { name: 'compact_agent', arguments: { agent: 'other' }, _meta: metadata('already-acting') },
    undefined,
    { signal: abort.signal },
  )
  const failed = expect(result).rejects.toThrow()
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1))
  abort.abort()
  await failed
  finish()
  await vi.waitFor(() => expect(completed).toBe(true))
  expect(call).toHaveBeenCalledTimes(1)
})

it('spends a throwing MCP call while returning the handler failure as an MCP error', async () => {
  const call = vi.fn(async () => {
    throw new Error('fictional handler defect')
  })
  const fixture = await opened(offered(call))
  await fixture.handle.send('work')
  const result = await fixture.client.callTool({
    name: 'compact_agent',
    arguments: { agent: 'other' },
    _meta: metadata('broken-call'),
  })
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: 'compact_agent failed: fictional handler defect' }],
  })
  const states = (fixture.handle as unknown as { requestStates: Map<string, unknown> })
    .requestStates
  expect(states.get(requestKey('mcp:broken-call'))).toEqual({ phase: 'spent' })
  expect(call).toHaveBeenCalledTimes(1)
})

it('keeps a completed action successful if receipt bookkeeping throws', async () => {
  vi.spyOn(MessageActCalls.prototype, 'remember').mockImplementation(() => {
    throw new Error('fictional receipt defect')
  })
  const call = vi.fn(async () => ({ text: 'acted once' }))
  const fixture = await opened(offered(call))
  await fixture.handle.send('work')
  const result = await fixture.client.callTool({
    name: 'compact_agent',
    arguments: { agent: 'other' },
    _meta: metadata('acted-call'),
  })
  expect(result.content).toEqual([{ type: 'text', text: 'acted once' }])
  expect(result.isError).not.toBe(true)
  expect(call).toHaveBeenCalledTimes(1)
})
