import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'

// Reported stream shapes, with fictional text and identifiers.
const lines = [
  '{"type":"system","subtype":"post_turn_summary","status_category":"completed","status_detail":"Finished the reply","needs_action":false,"summarizes_uuid":"fictional-turn"}',
  '{"type":"system","subtype":"task_summary","detail":"Finished the tool call"}',
  '{"type":"system","subtype":"future_housekeeping","detail":"A new provider notice"}',
]

describe('Claude system summaries', () => {
  it.each(lines)('maps reported summaries and retains unknown system diagnostics: %s', (line) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const message = JSON.parse(line) as SDKMessage
      const events = normalizeMessage(message)
      if (line === lines[0]) {
        expect(events).toEqual([{ type: 'turn_summary', status: 'completed', detail: 'Finished the reply', needsAction: false }])
        expect(warning).not.toHaveBeenCalled()
        return
      }
      if (line === lines[1]) {
        expect(events).toEqual([{ type: 'command_summary', description: 'Finished the tool call' }])
        expect(warning).not.toHaveBeenCalled()
        return
      }
      expect(events).toEqual([
        {
          type: 'unknown',
          provider: 'claude',
          category: 'unrecognized',
          label: (message as { subtype: string }).subtype,
          raw: message,
        },
      ])
      expect(warning).toHaveBeenCalledExactlyOnceWith('Unmodeled provider event', events[0])
    } finally {
      warning.mockRestore()
    }
  })
})
