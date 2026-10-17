import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentToolset } from '../src/agent-tools'
import { claudeMcpServersFor } from '../src/claude/agent-tools'
import { normalizeMessage } from '../src/claude/normalize'
import { answerCodexToolCall } from '../src/codex/agent-tools'
import { normalizeNotification } from '../src/codex/normalize'
import { runtimeEventSchema } from '../src/events'
import { MESSAGE_ACT_META, MessageActCalls, messageActFromAnswer } from '../src/message-act'
import { ClaudeMessageReceipts } from '../src/claude/message-receipts'

const first = 'message_act_00000000-0000-4000-8000-000000000001'
const second = 'message_act_00000000-0000-4000-8000-000000000002'
const structured = (messageAct: string) => ({
  outcome: 'ok',
  delivery: 'sent',
  kind: 'note',
  agent: 'sess_receiver',
  messageAct,
})
const tools: AgentToolset = {
  server: 'brobot',
  tools: [
    {
      name: 'message_agent',
      description: 'Deliver a note.',
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: { messageAct: z.string() },
      call: async (args) => ({
        text: 'The note arrived.',
        structured: structured(String(args.messageAct)),
      }),
    },
  ],
}

describe('message receipts belong to their tool result', () => {
  const bound = (receipts: ClaudeMessageReceipts, message: unknown) =>
    normalizeMessage(
      message as SDKMessage,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      receipts,
    )
  const called = (
    receipts: ClaudeMessageReceipts,
    id: string,
    name = 'mcp__brobot__message_agent',
    parent: string | null = null,
  ) =>
    bound(receipts, {
      type: 'assistant',
      parent_tool_use_id: parent,
      message: { content: [{ type: 'tool_use', id, name, input: {} }] },
    })
  const receipt = (id: string, act = first, parent: string | null = null) => ({
    type: 'user',
    parent_tool_use_id: parent,
    tool_use_result: { _meta: { [MESSAGE_ACT_META]: act } },
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'Done.' }] },
      ],
    },
  })

  it('binds new and historical Claude receipts through the same observed call', () => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(receipts, 'a')
    called(receipts, 'b', 'mcp__brobot__message_agent', 'parent')
    const legacy = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            content: [
              { type: 'text', text: 'Done.' },
              { type: 'text', text: JSON.stringify(structured(first)) },
            ],
          },
        ],
      },
    }
    expect(bound(receipts, receipt('b', second, 'parent'))[0]).toMatchObject({ messageAct: second })
    expect(bound(receipts, legacy)[0]).toMatchObject({ messageAct: first })
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
  })

  it('does not let foreign, unbound or wrong-parent receipts consume an owned call', () => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(receipts, 'a', 'mcp__other__message_agent')
    called(receipts, 'b', 'mcp__brobot__message_agent', 'parent')
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('unknown'))[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('b'))[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('b', second, 'parent'))[0]).toMatchObject({ messageAct: second })
    expect(normalizeMessage(receipt('unbound') as unknown as SDKMessage)[0]).not.toHaveProperty(
      'messageAct',
    )
  })

  it('rejects malformed metadata without falling back to valid historical JSON', () => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(receipts, 'a')
    const raw = receipt('a', 'invalid')
    raw.message.content[0]!.content.push({ type: 'text', text: JSON.stringify(structured(first)) })
    expect(bound(receipts, raw)[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
  })

  it.each([
    null,
    {},
    { foreign: first },
    { [MESSAGE_ACT_META]: first, extra: true },
    { [MESSAGE_ACT_META]: 'invalid' },
  ])('never retries rejected metadata through the historical codec', (meta) => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(receipts, 'a')
    const raw = {
      ...receipt('a'),
      tool_use_result: { _meta: meta },
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            content: [
              { type: 'text', text: 'Done.' },
              { type: 'text', text: JSON.stringify(structured(first)) },
            ],
          },
        ],
      },
    }
    expect(bound(receipts, raw)[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
  })

  it.each(
    [
      [],
      [''],
      ['Done.', JSON.stringify(structured(first))],
      ['Done.', JSON.stringify(structured(second))],
    ].map((texts) => ({ texts })),
  )('rejects ambiguous or incomplete prose beside valid metadata', ({ texts }) => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(receipts, 'a')
    const raw = {
      ...receipt('a'),
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            content: texts.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    }
    expect(bound(receipts, raw)[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
  })

  it('rejects valid historical JSON from an observed foreign tool', () => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(receipts, 'a', 'mcp__other__message_agent')
    const raw = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            content: [
              { type: 'text', text: 'Done.' },
              { type: 'text', text: JSON.stringify(structured(first)) },
            ],
          },
        ],
      },
    }
    expect(bound(receipts, raw)[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
  })

  it('counts malformed raw results before filtering and spends ambiguous ownership', () => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(receipts, 'a')
    const raw = receipt('a')
    ;(raw.message.content as unknown[]).push({ type: 'tool_result' })
    expect(bound(receipts, raw)[0]).not.toHaveProperty('messageAct')
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
  })

  it('does not reopen duplicate, saturated or torn-down call ownership', () => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent', 2)
    called(receipts, 'a')
    called(receipts, 'a')
    expect(bound(receipts, receipt('a'))[0]).not.toHaveProperty('messageAct')
    called(receipts, 'b')
    called(receipts, 'overflow')
    expect(bound(receipts, receipt('b'))[0]).not.toHaveProperty('messageAct')
    const closed = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    called(closed, 'a')
    closed.close()
    called(closed, 'later')
    expect(bound(closed, receipt('a'))[0]).not.toHaveProperty('messageAct')
    expect(bound(closed, receipt('later'))[0]).not.toHaveProperty('messageAct')
  })

  it('keeps Codex call ids and act ids separate when identical-address calls finish out of order', async () => {
    const calls = new MessageActCalls()
    for (const [id, messageAct] of [
      ['call_b', second],
      ['call_a', first],
    ]) {
      const owned = calls.claim(id!, 'turn', true)
      const answer = await answerCodexToolCall(
        tools,
        {
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { messageAct },
        },
        (completed) => calls.remember(id!, owned, completed.structured),
      )
      const event = normalizeNotification('item/completed', {
        threadId: 'thread',
        turnId: 'turn',
        item: {
          type: 'dynamicToolCall',
          id,
          status: 'completed',
          namespace: 'brobot',
          tool: 'message_agent',
          ...answer,
        },
      })[0]
      const act = calls.consume(id!, 'turn', (call) => call.act)
      const paired = { ...event, messageAct: act }
      expect(paired).toMatchObject({ type: 'tool_result', id, messageAct, ok: true })
      expect(runtimeEventSchema.parse(paired)).toMatchObject({ messageAct })
    }
  })

  it('keeps Claude tool_use_id bound to the actual adapter answer, without a live answer ring', async () => {
    const receipts = new ClaudeMessageReceipts('mcp__brobot__message_agent')
    const servers = claudeMcpServersFor(tools)!
    const instance = (
      servers.brobot as unknown as {
        instance: {
          _registeredTools: Record<
            string,
            { handler(args: unknown, extra: unknown): Promise<unknown> }
          >
        }
      }
    ).instance
    const registered = instance._registeredTools.message_agent
    expect(registered).toBeDefined()
    if (registered === undefined) throw new Error('message_agent was not registered')
    for (const [id, messageAct] of [
      ['call_b', second],
      ['call_a', first],
    ]) {
      receipts.called(id!, 'mcp__brobot__message_agent', null)
      const result = await registered.handler({ messageAct }, {})
      const event = normalizeMessage(
        {
          type: 'user',
          tool_use_result: result,
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: id, ...(result as object) }],
          },
        } as unknown as SDKMessage,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        receipts,
      )[0]
      expect(event).toMatchObject({ type: 'tool_result', id, messageAct, ok: true })
      expect(runtimeEventSchema.parse(event)).toMatchObject({ messageAct })
    }
  })

  it.each(
    [
      null,
      [],
      ['', JSON.stringify(structured(first))],
      [JSON.stringify(structured(first))],
      ['prose', JSON.stringify(structured(first)), 'extra'],
      ['prose', '{broken'],
      ['prose', JSON.stringify({ ...structured(first), messageAct: 'call_a' })],
      ['prose', JSON.stringify({ ...structured(first), outcome: 'refused' })],
      ['prose', JSON.stringify({ ...structured(first), delivery: 'unknown' })],
      ['prose', JSON.stringify({ ...structured(first), kind: 'work' })],
      ['prose', JSON.stringify({ ...structured(first), agent: '' })],
      ['prose', JSON.stringify({ ...structured(first), padding: 'x'.repeat(16_000) })],
    ].map((parts) => ({ parts })),
  )('leaves incomplete or damaged result metadata unpaired', ({ parts }) => {
    expect(messageActFromAnswer(parts)).toBeUndefined()
  })

  it('never uses a valid-looking success payload from a failed result', () => {
    const content = [
      { type: 'text', text: 'prose' },
      { type: 'text', text: JSON.stringify(structured(first)) },
    ]
    expect(
      normalizeMessage({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'bad', is_error: true, content }],
        },
      } as unknown as SDKMessage)[0],
    ).not.toHaveProperty('messageAct')
    expect(
      normalizeNotification('item/completed', {
        threadId: 'thread',
        turnId: 'turn',
        item: {
          type: 'dynamicToolCall',
          id: 'bad',
          status: 'completed',
          namespace: 'brobot',
          tool: 'message_agent',
          success: false,
          contentItems: content.map((one) => ({ ...one, type: 'inputText' })),
        },
      })[0],
    ).not.toHaveProperty('messageAct')
  })

  it('does not recognize another Codex tool or namespace as the app message codec', () => {
    for (const changed of [{ tool: 'read' }, { namespace: 'other' }]) {
      const event = normalizeNotification('item/completed', {
        threadId: 'thread',
        turnId: 'turn',
        item: {
          type: 'dynamicToolCall',
          id: 'other',
          status: 'completed',
          namespace: 'brobot',
          tool: 'message_agent',
          success: true,
          contentItems: [
            { type: 'inputText', text: 'prose' },
            { type: 'inputText', text: JSON.stringify(structured(first)) },
          ],
          ...changed,
        },
      })[0]
      expect(event).toMatchObject({ type: 'tool_result', id: 'other', ok: true })
      expect(event).not.toHaveProperty('messageAct')
    }
  })

  it('does not hide extra raw blocks while recognizing the Claude machine half', () => {
    expect(
      normalizeMessage({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'extra',
              content: [
                { type: 'text', text: 'prose' },
                { type: 'text', text: JSON.stringify(structured(first)) },
                { type: 'image', data: 'unused' },
              ],
            },
          ],
        },
      } as unknown as SDKMessage)[0],
    ).not.toHaveProperty('messageAct')
  })
})
