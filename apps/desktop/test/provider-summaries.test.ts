import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { visibleItems } from '../src/renderer/src/lib/transcript-mode'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { composeReadable } from '../src/renderer/src/lib/readable-export'
import { fromOutside, inACard } from '../src/renderer/src/lib/from-outside'

const turn = {
  type: 'turn_summary',
  status: 'completed',
  detail: 'Checked the fictional change',
  needsAction: true,
} satisfies TranscriptEvent
const command = {
  type: 'command_summary',
  description: 'Checking the fictional change',
} satisfies TranscriptEvent

describe('common summary transcript facts', () => {
  it('folds each supplied summary once in event order, with ledger time and ordinal', () => {
    const state = createTranscript()
    applyEvent(state, command, 100, 1)
    applyEvent(state, turn, 200, 2)
    expect(state.items).toEqual([
      expect.objectContaining({ kind: 'commandSummary', description: 'Checking the fictional change', at: 100, ordinal: 1 }),
      expect.objectContaining({ kind: 'turnSummary', status: 'completed', detail: 'Checked the fictional change', needsAction: true, at: 200, ordinal: 2 }),
    ])
    expect(visibleItems(state.items)).toEqual(state.items)
    expect(visibleItems(state.items, true)).toEqual(state.items)
    for (const item of state.items) {
      expect(fromOutside(item)).toBeNull()
      expect(inACard(item)).toBe(false)
    }
  })

  it('describes the neutral facts without native or provider names', () => {
    expect(describeEvent(turn)).toBe('completed · Checked the fictional change · Needs action')
    expect(describeEvent(command)).toBe('Checking the fictional change')
  })

  it('retains the same summary facts in readable exports without tool activity', () => {
    const state = createTranscript()
    applyEvent(state, command)
    applyEvent(state, turn)
    const text = composeReadable('Fictional conversation', state.items, { toolActivity: false })
    expect(text).toContain('Checking the fictional change')
    expect(text).toContain('completed · Checked the fictional change · Needs action')
    expect(text.match(/Checked the fictional change/g)).toHaveLength(1)
    expect(text).not.toContain('post_turn_summary')
  })
})
