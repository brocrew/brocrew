import { randomUUID } from 'node:crypto'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { RuntimeEvent } from '../events'

/** Claude's streamed wrappers precede the end_turn receipt and commonly have a null stop_reason. */
export class ClaudeFinalAnswers {
  private current: {
    providerId: string; correlation: string; text: string; blocks: number;
    ended: boolean; failed: boolean; emitted: number; seen: Set<string>;
  } | null = null

  messageId(message: Extract<SDKMessage, { type: 'assistant' }>): string | undefined {
    return message.parent_tool_use_id == null && this.current?.providerId === message.message.id
      ? this.current.correlation : undefined
  }

  observe(message: SDKMessage): RuntimeEvent | null {
    if (message.type === 'result') { this.current = null; return null }
    if (message.type === 'stream_event' && message.parent_tool_use_id == null) {
      const event = message.event
      if (event.type === 'message_start') {
        this.current = event.message != null && typeof event.message.id === 'string' ? {
          providerId: event.message.id, correlation: randomUUID(), text: '', blocks: 0,
          ended: false, failed: false, emitted: 0, seen: new Set(),
        } : null
      } else if (event.type === 'message_delta' && this.current !== null) {
        this.current.ended = event.delta != null && event.delta.stop_reason === 'end_turn'
      }
    } else if (message.type === 'assistant' && this.messageId(message) !== undefined) {
      const current = this.current!
      if (message.error !== undefined || message.aborted === true) current.failed = true
      if (typeof message.uuid === 'string' && current.seen.has(message.uuid)) return null
      if (current.seen.size >= 128) { current.failed = true; return null }
      if (typeof message.uuid === 'string') current.seen.add(message.uuid)
      if (!Array.isArray(message.message.content)) { current.failed = true; return null }
      for (const block of message.message.content) {
        if (block.type === 'tool_use') current.failed = true
        if (block.type !== 'text') continue
        current.blocks++
        if (current.blocks > 128 || current.text.length + block.text.length > 1_048_576) {
          current.failed = true
          continue
        }
        current.text += block.text
      }
    }
    const current = this.current
    if (current === null || !current.ended || current.failed || current.blocks === current.emitted
      || current.text.trim() === '') return null
    current.emitted = current.blocks
    return { type: 'assistant_message', text: current.text, phase: 'final', messageId: current.correlation }
  }
}
