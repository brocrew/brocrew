import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { normalizeNotification } from '../src/codex/normalize'
import { normalizeMessage } from '../src/claude/normalize'
import { runtimeEventSchema } from '../src/events'

describe('provider-marked final messages', () => {
  it('preserves Codex final_answer and commentary through wire parsing, without guessing missing phase', () => {
    for (const [phase, expected] of [['final_answer', 'final'], ['commentary', 'commentary'], [undefined, undefined]]) {
      const events = normalizeNotification('item/completed', { threadId: 't', turnId: 'u', item: { type: 'agentMessage', id: 'm', text: '**Answer**', phase } })
      expect(runtimeEventSchema.parse(events[0])).toEqual({ type: 'assistant_message', text: '**Answer**', ...(expected ? { phase: expected } : {}) })
    }
  })

  it('uses Claude end_turn only, leaving tool progress, missing reasons and error replies unmarked', () => {
    for (const [stop_reason, error, expected] of [['end_turn', undefined, 'final'], ['tool_use', undefined, undefined], [null, undefined, undefined], ['end_turn', 'rate_limit', undefined]]) {
      const message = { type: 'assistant', parent_tool_use_id: null, error, message: { content: [{ type: 'text', text: 'Answer' }], stop_reason } } as unknown as SDKMessage
      const prose = normalizeMessage(message).find((event) => event.type === 'assistant_message')
      expect(prose?.type === 'assistant_message' ? prose.phase : 'missing').toBe(expected)
    }
  })
})
