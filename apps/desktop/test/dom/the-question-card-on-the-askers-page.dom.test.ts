import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible } from './harness'

/**
 * # 🔴 The question an agent sent, as a card on its own page
 *
 * `mcp__brobot__ask_question` draws a dedicated question card rather than a bare tool row.
 *
 * ⚑ Measured where a person sees it: the call draws as the card and not as a tool row, with the
 * question glyph, the heading naming whom it went to, the question once and its options.
 * ⛔ The control: a session never told its tools' names draws the tool row it always drew.
 *
 * ⚑ **UI-009 (F052)** — the card is `QuestionCard` (*"BroBot asked you · W1.2"*), and a question to
 * a person is answered on it: its options are presses.
 */

afterEach(() => unmountAll())

const inventory: TranscriptEvent = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [{ name: 'ask_question', description: '', parameters: [] }],
  },
  published: null,
} as unknown as TranscriptEvent

const ASKED: TranscriptEvent[] = [
  { type: 'user_turn', text: 'ask the person one question directly' },
  {
    type: 'work_given',
    piece: 'work_64',
    label: 'W1.2',
    parent: 'work_root',
    givenBy: 'sess_brobot',
    title: 'ask the person one question directly',
    brief: 'ask the person one question directly',
  },
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__ask_question',
    summary: JSON.stringify({ piece: 'work_64', who_answers: 'a-person' }),
  } as TranscriptEvent,
  {
    type: 'question_asked',
    requestId: 'req_a',
    piece: 'work_64',
    label: 'W1.2',
    prompt: 'Test from Ayo: tea or coffee?',
    questions: [
      {
        id: 'q1',
        prompt: 'Test from Ayo: tea or coffee?',
        options: [{ label: 'Tea' }, { label: 'Coffee' }],
      },
    ],
  } as TranscriptEvent,
  { type: 'request_routed', requestId: 'req_a', to: 'a-person' } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'c1',
    summary: 'Your question is recorded.',
    ok: true,
  } as TranscriptEvent,
]

const pane = (events: TranscriptEvent[]) =>
  mount(ConversationPane, paneProps({ record: record(events) }), { width: 1200, height: 808 })

describe('the question an agent sent, on its own page', () => {
  it('🔴 a card with the glyph, to you, about W1.2, the question once and its options to press', async () => {
    const m = await pane([inventory, ...ASKED])
    const card = m.q('outgoing')
    expect(visible(card)).toBe(true)
    expect(card.getAttribute('data-tool')).toBe('ask_question')
    expect(m.q('question-head').querySelector('use')?.getAttribute('href')).toBe('#i-question')
    expect(m.q('question-asked-of').textContent?.trim()).toBe('you')
    expect(m.q('question-piece').textContent?.trim()).toBe('W1.2')
    expect(m.q('question-words').textContent?.trim()).toBe('Test from Ayo: tea or coffee?')
    const options = [...card.querySelectorAll<HTMLElement>('[data-cy="question-option"]')]
    expect(options.map((one) => one.textContent?.trim())).toEqual(['Tea', 'Coffee'])
    for (const one of options) expect(visible(one)).toBe(true)
    // ⚑ **UI-009 (F052)** — asked of a person, answered here: each option is a press.
    for (const one of options) expect(one.tagName).toBe('BUTTON')
    // ⛔ **The card IS the call** — no tool row beside it for the same act.
    expect(m.all('tool-entry')).toHaveLength(0)
  })

  it('⛔ THE CONTROL — a session never told its tools’ names draws the tool row, and no card', async () => {
    const m = await pane(ASKED)
    expect(m.all('outgoing')).toHaveLength(0)
    expect(m.all('tool-entry').length + m.all('tool-run').length).toBeGreaterThan(0)
  })
})
