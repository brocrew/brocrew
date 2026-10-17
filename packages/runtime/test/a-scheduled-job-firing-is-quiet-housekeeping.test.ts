import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/index'
import { normalizeMessage } from '../src/claude/normalize'
import { isProviderWork } from '../src/internal/provider-work'

/**
 * # A scheduled job firing is quiet housekeeping
 *
 * `command_lifecycle`, which the CLI sends for every message with a uuid (F080) and for a scheduled
 * job's prompt as it fires, is quiet `unknown{lifecycle}`, not an unmodeled event.
 */

describe('normalizeMessage on command_lifecycle', () => {
  it('every state of it is unknown{lifecycle}, labelled command_lifecycle, raw kept — and never provider work', () => {
    for (const state of ['queued', 'started', 'completed', 'cancelled']) {
      const raw = {
        type: 'command_lifecycle',
        command_uuid: 'u1',
        state,
        uuid: 'u2',
        session_id: 's',
      }
      const events = normalizeMessage(raw as unknown as SDKMessage)
      expect(events, state).toEqual([
        {
          type: 'unknown',
          provider: 'claude',
          category: 'lifecycle',
          label: 'command_lifecycle',
          raw,
        },
      ])
      // ⛔ So it can never open a burst (F080) of its own.
      expect(isProviderWork(events[0] as RuntimeEvent), state).toBe(false)
    }
  })

  it('⚑ the control: a type it does not name stays unrecognized — the match is by its exact name', () => {
    const raw = { type: 'command_lifecycle_v2', command_uuid: 'u1', state: 'started' }
    expect(normalizeMessage(raw as unknown as SDKMessage)).toEqual([
      {
        type: 'unknown',
        provider: 'claude',
        category: 'unrecognized',
        label: 'command_lifecycle_v2',
        raw,
      },
    ])
  })
})
