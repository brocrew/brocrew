import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { normalizeNotification } from '../src/codex/normalize'
import { normalizeMessage } from '../src/claude/normalize'
import { runtimeEventSchema } from '../src/events'
import { ClaudeFinalAnswers } from '../src/claude/final-answers'
import { readFileSync } from 'node:fs'

function normalizedWith(finalAnswers: ClaudeFinalAnswers, message: object) {
  return normalizeMessage(
    message as SDKMessage,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    finalAnswers,
  )
}

describe('provider-marked final messages', () => {
  it('preserves Codex final_answer and commentary through wire parsing, without guessing missing phase', () => {
    for (const [phase, expected] of [
      ['final_answer', 'final'],
      ['commentary', 'commentary'],
      [undefined, undefined],
    ]) {
      const events = normalizeNotification('item/completed', {
        threadId: 't',
        turnId: 'u',
        item: { type: 'agentMessage', id: 'm', text: '**Answer**', phase },
      })
      expect(runtimeEventSchema.parse(events[0])).toEqual({
        type: 'assistant_message',
        text: '**Answer**',
        ...(expected ? { phase: expected } : {}),
      })
    }
  })

  it('uses Claude end_turn only, leaving tool progress, missing reasons and error replies unmarked', () => {
    for (const [stop_reason, error, expected] of [
      ['end_turn', undefined, 'final'],
      ['tool_use', undefined, undefined],
      [null, undefined, undefined],
      ['end_turn', 'rate_limit', undefined],
    ]) {
      const message = {
        type: 'assistant',
        parent_tool_use_id: null,
        error,
        message: { content: [{ type: 'text', text: 'Answer' }], stop_reason },
      } as unknown as SDKMessage
      const prose = normalizeMessage(message).find((event) => event.type === 'assistant_message')
      expect(prose?.type === 'assistant_message' ? prose.phase : 'missing').toBe(expected)
    }
  })

  it('correlates Claude streamed end_turn to authoritative wrappers even when their stop_reason is null', () => {
    const finalAnswers = new ClaudeFinalAnswers()
    const normalized = (message: object) => normalizedWith(finalAnswers, message)
    normalized({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'api-1' } },
    })
    const first = normalized({
      type: 'assistant',
      uuid: 'block-1',
      parent_tool_use_id: null,
      message: { id: 'api-1', stop_reason: null, content: [{ type: 'text', text: 'First ' }] },
    })[0]
    normalized({
      type: 'assistant',
      uuid: 'block-2',
      parent_tool_use_id: null,
      message: { id: 'api-1', stop_reason: null, content: [{ type: 'text', text: '**answer**' }] },
    })
    const ending = normalized({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      },
    }).find((event) => event.type === 'assistant_message')
    expect(first?.type === 'assistant_message' ? first.phase : 'missing').toBeUndefined()
    expect(ending).toEqual({
      type: 'assistant_message',
      text: 'First **answer**',
      phase: 'final',
      messageId: first?.type === 'assistant_message' ? first.messageId : 'missing',
    })
  })

  it('leaves ordinary wrappers uncorrelated before a stream start and after a result', () => {
    const registry = new ClaudeFinalAnswers()
    const wrapper = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'Ordinary answer' }], stop_reason: null },
    }
    const ordinary = { type: 'assistant_message', text: 'Ordinary answer' }
    expect(normalizedWith(registry, wrapper)).toEqual([ordinary])
    normalizedWith(registry, {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id: 'fictional-message' } },
    })
    expect(
      normalizedWith(registry, { ...wrapper, message: { ...wrapper.message, id: 'other' } }),
    ).toEqual([ordinary])
    expect(
      normalizedWith(registry, {
        ...wrapper,
        parent_tool_use_id: 'child',
        message: { ...wrapper.message, id: 'fictional-message' },
      }),
    ).toEqual([{ ...ordinary, parentToolCallId: 'child' }])
    normalizedWith(registry, { type: 'result' })
    expect(normalizedWith(registry, wrapper)).toEqual([ordinary])
    normalizedWith(registry, {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: {} },
    })
    expect(normalizedWith(registry, wrapper)).toEqual([ordinary])
  })

  it('recognizes the existing captured person-turn stream shape through the production mapper', () => {
    const captured = JSON.parse(
      readFileSync(new URL('./fixtures/claude-provider-bursts.json', import.meta.url), 'utf8'),
    ) as {
      arms: Record<string, { lives: { frames: SDKMessage[] }[] }>
    }
    const registry = new ClaudeFinalAnswers()
    const events = captured.arms['F-person']!.lives[0]!.frames.flatMap((frame) =>
      normalizeMessage(
        frame,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        registry,
      ),
    )
    expect(
      events.filter((event) => event.type === 'assistant_message' && event.phase === 'final'),
    ).toHaveLength(1)
  })

  it('does not promote a child, aborted response, truncated response, or tool progress', () => {
    for (const variant of ['child', 'aborted', 'truncated', 'tool', 'error'] as const) {
      const registry = new ClaudeFinalAnswers()
      const parent = variant === 'child' ? 'child-tool' : null
      const stream = (event: object) =>
        registry.observe({ type: 'stream_event', parent_tool_use_id: parent, event } as SDKMessage)
      stream({ type: 'message_start', message: { id: 'api-1' } })
      registry.observe({
        type: 'assistant',
        parent_tool_use_id: parent,
        aborted: variant === 'aborted' ? true : undefined,
        error: variant === 'error' ? 'rate_limit' : undefined,
        uuid: '00000000-0000-4000-8000-000000000001',
        session_id: 'fictional-session',
        message: {
          id: 'api-1',
          container: null,
          context_management: null,
          diagnostics: null,
          model: 'fictional-model',
          role: 'assistant',
          stop_details: null,
          stop_reason: null,
          stop_sequence: null,
          type: 'message',
          usage: {
            cache_creation: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            inference_geo: null,
            input_tokens: 0,
            iterations: null,
            output_tokens: 0,
            output_tokens_details: null,
            server_tool_use: null,
            service_tier: null,
            speed: null,
          },
          content:
            variant === 'tool'
              ? [
                  { type: 'text', text: 'tool progress', citations: null },
                  { type: 'tool_use', id: 'tool', name: 'fake', input: {} },
                ]
              : [{ type: 'text', text: 'partial', citations: null }],
        },
      })
      expect(
        stream({
          type: 'message_delta',
          delta: { stop_reason: variant === 'truncated' ? 'max_tokens' : 'end_turn' },
        }),
      ).toBeNull()
    }
  })
})
