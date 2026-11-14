import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'
import { parseRuntimeEvent } from '../src/events'

const turn = {
  type: 'system',
  subtype: 'post_turn_summary',
  status_category: 'completed',
  status_detail: 'Checked the fictional change',
  needs_action: '',
  uuid: 'fictional-summary',
  session_id: 'fictional-session',
  summarizes_uuid: 'fictional-turn',
}
const command = {
  type: 'system',
  subtype: 'task_summary',
  detail: 'Checking the fictional change',
  uuid: 'fictional-command',
  session_id: 'fictional-session',
}
const normalize = (value: unknown) => normalizeMessage(value as SDKMessage)

function expectUnknown(raw: Record<string, unknown> & { subtype: string }): void {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const events = normalize(raw)
    expect(events).toEqual([
      { type: 'unknown', provider: 'claude', category: 'unrecognized', label: raw.subtype, raw },
    ])
    expect(warning).toHaveBeenCalledExactlyOnceWith('Unmodeled provider event', events[0])
  } finally {
    warning.mockRestore()
  }
}

describe('provider-neutral summaries', () => {
  it.each([
    { type: 'turn_summary', status: 'completed', detail: 'Checked the change', needsAction: '' },
    { type: 'command_summary', description: 'Checking the change' },
    { type: 'turn_summary', detail: 'Only the supplied detail', needsAction: 'Review this' },
  ])('admits portable summary facts without naming a provider: %j', (event) => {
    expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
  })
  it.each(['', 'Review the fictional change'])(
    'maps a reported turn summary, retaining needs-action %s',
    (needsAction) => {
      const event = {
        type: 'turn_summary',
        status: turn.status_category,
        detail: turn.status_detail,
        needsAction,
      }
      expect(normalize({ ...turn, needs_action: needsAction })).toEqual([event])
      expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
    },
  )

  it.each(['completed', 'review_ready', 'blocked'])('maps observed native status %s', (status) => {
    expect(normalize({ ...turn, status_category: status })).toEqual([
      { type: 'turn_summary', status, detail: turn.status_detail, needsAction: '' },
    ])
  })

  it('retains only an unknown status detail for display without inventing a status', () => {
    expect(
      normalize({
        ...turn,
        status_category: 'fictional_future_status',
        needs_action: 'Review this',
      }),
    ).toEqual([{ type: 'turn_summary', detail: turn.status_detail, needsAction: 'Review this' }])
  })

  it('maps the reported command description without provider fields', () => {
    const event = { type: 'command_summary', description: command.detail }
    expect(normalize(command)).toEqual([event])
    expect(parseRuntimeEvent(event)).toEqual({ ok: true, event })
  })

  it.each([null, '', ' ', '\t\r\n'])(
    'omits an empty native command description without warning: %j',
    (detail) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(normalize({ ...command, detail })).toEqual([])
      expect(warning).not.toHaveBeenCalled()
    } finally {
      warning.mockRestore()
    }
    },
  )

  it.each([
    { ...turn, status_category: undefined },
    { ...turn, status_category: 7 },
    { ...turn, status_category: '' },
    { ...turn, status_detail: undefined },
    { ...turn, status_detail: {} },
    { ...turn, status_detail: ' ' },
    { ...turn, needs_action: undefined },
    { ...turn, needs_action: false },
    { ...turn, needs_action: true },
    { ...command, detail: undefined },
    { ...command, detail: [] },
    { ...command, detail: {} },
    { ...command, detail: 0 },
    { ...command, detail: false },
  ])('keeps malformed summaries on the existing unknown and warning path: %j', (raw) => {
    expectUnknown(raw)
  })

  it('keeps a future unknown system event available to the existing Debug-only path', () => {
    expectUnknown({ type: 'system', subtype: 'fictional_future_event', detail: 'New words' })
  })
})
