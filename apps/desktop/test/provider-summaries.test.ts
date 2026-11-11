import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { visibleItems } from '../src/renderer/src/lib/transcript-mode'
import { describeEvent } from '../src/renderer/src/lib/describe-event'

const turn = {
  type: 'turn_summary',
  status: 'completed',
  detail: 'Checked the fictional change',
  needsAction: true,
} as unknown as TranscriptEvent
const command = {
  type: 'command_summary',
  description: 'Checking the fictional change',
} as unknown as TranscriptEvent

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
  })

  it('describes the neutral facts without native or provider names', () => {
    expect(describeEvent(turn)).toBe('completed · Checked the fictional change · Needs action')
    expect(describeEvent(command)).toBe('Checking the fictional change')
  })
})
