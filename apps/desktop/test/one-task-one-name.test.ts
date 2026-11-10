import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { pieceCalled } from '../src/shared/piece-called'
import { stalledWorkLead } from '../src/renderer/src/lib/persons-queue'
import type { StalledWork } from '../src/shared/stalled-work'

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const asked = (over: Record<string, unknown>): TranscriptEvent =>
  ev({
    type: 'question_asked',
    requestId: 'req_1',
    prompt: 'Which time zones?',
    questions: [{ id: 'answer', prompt: 'Which time zones?', options: [] }],
    ...over,
  })

const notices = (events: readonly TranscriptEvent[]): string[] => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state.items
    .filter((item): item is NoticeItem => item.kind === 'notice')
    .map((item) => item.text)
}

describe('the one function', () => {
  it('one spelling, and no project said beside it', () => {
    expect(pieceCalled([1, 3])).toBe('W1.3')
    expect(pieceCalled([3])).toBe('W3')
  })
})

describe('the stalled row', () => {
  it('names the piece the way the card does and keeps its consequence', () => {
    const work = {
      label: 'W1.3',
      ownerName: 'Pam',
      giverName: 'Ada',
    } as unknown as StalledWork
    expect(stalledWorkLead(work)).toBe(
      'W1.3 with Pam is not being worked on, and Ada — which gave it out — has not been told.',
    )
    expect(stalledWorkLead(work)).not.toContain('Work #')
  })
})

describe('the notice a question about work leaves in the transcript', () => {
  it('a question about a piece names it by the label the row carries', () => {
    expect(notices([asked({ piece: 'work_1', label: 'W1.3' })])).toContain('asked about W1.3')
  })

  it('the arms with no label to print say what is true', () => {
    expect(notices([asked({ piece: 'work_9' })])).toEqual(['asked about a piece of work'])
    expect(notices([asked({ piece: 'work_9', label: '#3' })])).toEqual([
      'asked about a piece of work',
    ])
    expect(notices([asked({})])).toEqual(['asked a question about no piece of work'])
    expect(notices([asked({ passedUpFrom: 'req_0', piece: 'work_1', label: 'W1.3' })])).toEqual([
      'passed a question up',
    ])
  })
})
