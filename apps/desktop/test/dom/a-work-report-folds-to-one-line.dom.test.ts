import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WorkReport } from '../../src/shared/tasks'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * The app's report about work this conversation gave out is a card that starts closed, like the
 * message cards around it: one line with the piece, its state and the way to the conversation, and
 * the full report behind the line. A report that holds something a person has to act on starts
 * open, so that is never behind a press.
 */

afterEach(unmountAll)

const STALL = 'W7.41 · Ask Mai for the menu is not being worked on: its turn ended.'

const reported = (work: WorkReport, text = STALL): TranscriptEvent =>
  ({ type: 'user_turn', text, attribution: 'app_authored', work }) as TranscriptEvent

const stalled: WorkReport = {
  piece: 'work_41',
  label: 'W7.41',
  owner: 'sess_mai',
  state: 'stalled',
  stalledBecause: 'provider_limited',
}

const search = (id: string): TranscriptEvent[] => [
  { type: 'tool_call', id, name: 'web_search', summary: '{}' } as TranscriptEvent,
  { type: 'tool_result', id, summary: 'ok', ok: true } as TranscriptEvent,
]

const words = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

function pane(events: TranscriptEvent[]): Mounted {
  return mount(ConversationPane, paneProps({ record: record(events), held: ['sess_mai'] }), {
    width: 1180,
    height: 800,
  })
}

describe('the app’s work report folds to one line', () => {
  it('starts closed: the piece, its state, the time and the way to the conversation on one line', () => {
    const m = pane([reported(stalled)])
    const toggle = m.q('exchange-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(words(toggle)).toContain('W7.41 · This app · work you gave out')
    expect(words(m.q('exchange-state'))).toBe(
      'its turn ended because its provider’s usage limit was reached',
    )
    // The pill may be cut on the line; the whole of it is on hover.
    expect(m.q('exchange-state').title).toBe(
      'its turn ended because its provider’s usage limit was reached',
    )
    expect(words(m.q('exchange-where'))).toBe('Open the conversation')
    // The piece is named once on the line: the preview does not repeat the report's own label.
    expect(words(m.q('exchange-preview')).startsWith('W7.41')).toBe(false)
    expect(words(m.q('exchange-preview'))).toMatch(/^Ask Mai for the menu/)
    // One line: the head is no taller than one line of its own type.
    const head = m.q('exchange-head').getBoundingClientRect()
    expect(head.height).toBeLessThan(2 * parseFloat(getComputedStyle(toggle).lineHeight || '20'))
    // The report's own words are behind the line.
    expect(m.all('work-report-message')).toHaveLength(0)
    expect(m.all('model-got-switch')).toHaveLength(0)
  })

  it('opens to the whole report, and closes again', async () => {
    const m = pane([reported(stalled)])
    const toggle = m.q('exchange-toggle')
    toggle.click()
    await nextTick()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(visible(m.q('work-report-message'))).toBe(true)
    expect(words(m.q('work-report-message'))).toBe(STALL)
    expect(words(m.q('work-report-word'))).toBe(
      'its turn ended because its provider’s usage limit was reached',
    )
    expect(visible(m.q('model-got-switch'))).toBe(true)
    toggle.click()
    await nextTick()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(visible(m.q('work-report-message'))).toBe(false)
  })

  it('opens and closes from the keyboard, with Enter and with Space', async () => {
    const m = pane([reported(stalled)])
    const toggle = m.q('exchange-toggle')
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    await userEvent.keyboard('{Enter}')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await userEvent.keyboard(' ')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('stays open while the turn grows behind it', async () => {
    const live = reactive(record([reported(stalled)]))
    const m = mount(ConversationPane, paneProps({ record: live, held: ['sess_mai'] }), {
      width: 1180,
      height: 800,
    })
    const toggle = m.q('exchange-toggle')
    toggle.click()
    await nextTick()
    for (const [i, event] of [...search('s1'), ...search('s2')].entries())
      applyEvent(live.transcript, event, 1_700_000_000_000 + i, 10 + i)
    await nextTick()
    expect(m.q('exchange-toggle')).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(visible(m.q('work-report-message'))).toBe(true)
  })
})

describe('a report a person has to act on starts open', () => {
  it('the “a person has to act” mark is in view without a press', () => {
    const m = pane([
      reported(
        {
          piece: 'work_42',
          label: 'W7.42',
          owner: 'sess_mai',
          state: 'answered',
          outcome: 'done',
          needsUserAction: true,
        },
        'W7.42 · Pick a menu was answered: done.',
      ),
    ])
    expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(visible(m.q('work-report-mark'))).toBe(true)
    expect(words(m.q('work-report-mark'))).toBe('a person has to act')
  })

  it('so is work waiting on a person or on an answer, and a plain answered report is not', () => {
    for (const [state, open] of [
      ['waiting-on-a-person', 'true'],
      ['waiting-on-an-answer', 'true'],
      ['answered', 'false'],
    ] as const) {
      unmountAll()
      const m = pane([
        reported({
          piece: 'work_43',
          label: 'W7.43',
          owner: 'sess_mai',
          state,
          outcome: state === 'answered' ? 'done' : undefined,
        }),
      ])
      expect(m.q('exchange-toggle').getAttribute('aria-expanded'), state).toBe(open)
      expect(m.all('work-report-message'), state).toHaveLength(open === 'true' ? 1 : 0)
    }
  })
})
