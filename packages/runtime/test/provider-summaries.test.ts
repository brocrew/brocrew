import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'
import { parseRuntimeEvent } from '../src/events'

const turn = {
  type: 'system',
  subtype: 'post_turn_summary',
  status_category: 'completed',
  status_detail: 'Checked the fictional change',
  needs_action: false,
  summarizes_uuid: 'fictional-turn',
}
const command = { type: 'system', subtype: 'task_summary', detail: 'Checking the fictional change' }
const normalize = (value: unknown) => normalizeMessage(value as SDKMessage)

describe('provider-neutral summaries', () => {
  it.each([false, true])('maps a reported turn summary, retaining needs-action %s', (needsAction) => {
    const event = {
      type: 'turn_summary',
      status: turn.status_category,
      detail: turn.status_detail,
      needsAction,
    }
    expect(normalize({ ...turn, needs_action: needsAction })).toEqual([event])
    expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
  })

  it('maps the reported command description without provider fields', () => {
    const event = { type: 'command_summary', description: command.detail }
    expect(normalize(command)).toEqual([event])
    expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
  })

  it.each([
    { ...turn, status_category: undefined },
    { ...turn, status_category: 7 },
    { ...turn, status_category: '' },
    { ...turn, status_detail: undefined },
    { ...turn, status_detail: {} },
    { ...turn, status_detail: ' ' },
    { ...turn, needs_action: undefined },
    { ...turn, needs_action: 'false' },
    { ...command, detail: undefined },
    { ...command, detail: [] },
    { ...command, detail: '' },
  ])('omits an absent or changed undocumented summary shape: %j', (value) => {
    expect(normalize(value)).toEqual([])
  })

  it('keeps a future unknown system event available to the existing Debug-only path', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const raw = { type: 'system', subtype: 'fictional_future_event', detail: 'New words' }
      const events = normalize(raw)
      expect(events).toEqual([
        { type: 'unknown', provider: 'claude', category: 'unrecognized', label: raw.subtype, raw },
      ])
      expect(warning).toHaveBeenCalledExactlyOnceWith('Unmodeled provider event', events[0])
    } finally {
      warning.mockRestore()
    }
  })
})
