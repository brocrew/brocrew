import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WorkReport } from '../../src/shared/tasks'
import { mount, paneProps, record, unmountAll, visible } from './harness'

/**
 * A reply from another conversation is a card that starts closed, unless it says a person has to
 * act or the work waits on a person or an answer: then it starts open, so the thing to act on is
 * never behind a press.
 */

afterEach(unmountAll)

const reply = (work: Partial<WorkReport>): TranscriptEvent =>
  ({
    type: 'user_turn',
    relayedFrom: 'sess_ada',
    relayedFromProfile: 'ada',
    text: 'The menu is ready; a supplier has to be chosen.',
    work: { piece: 'work_7', label: 'W1.7', owner: 'sess_ada', ...work },
  }) as TranscriptEvent

const opened = (work: Partial<WorkReport>): string | null => {
  unmountAll()
  const m = mount(
    ConversationPane,
    paneProps({ record: record([reply(work)]), ownAgent: 'BroBot' }),
  )
  return m.q('exchange-toggle').getAttribute('aria-expanded')
}

describe('a reply a person has to act on starts open', () => {
  it('the mark is in view without a press, and the line still carries it', () => {
    const m = mount(
      ConversationPane,
      paneProps({
        record: record([reply({ state: 'answered', outcome: 'done', needsUserAction: true })]),
        ownAgent: 'BroBot',
      }),
    )
    expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(m.q('exchange-state').textContent).toContain('a person has to act')
    expect(visible(m.q('work-report-mark'))).toBe(true)
    expect(visible(m.q('work-report-message'))).toBe(true)
  })

  it('so does one waiting on a person or an answer; the same reply without either starts closed', () => {
    expect(opened({ state: 'waiting-on-a-person' })).toBe('true')
    expect(opened({ state: 'waiting-on-an-answer' })).toBe('true')
    expect(opened({ state: 'answered', outcome: 'done' })).toBe('false')
    // The flag alone does not make a person act: only an answered report can carry the mark.
    expect(opened({ state: 'working', needsUserAction: true })).toBe('false')
  })
})
