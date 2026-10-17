import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * A question card folds to one line once nobody waits on it: answered, withdrawn, or a call the
 * app refused, whose refusal stays on the line. A question still waiting on the person stays open,
 * with its answer controls in view.
 */

afterEach(unmountAll)

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const INVENTORY = ev({
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [{ name: 'ask_question', description: '', parameters: [] }],
  },
  published: null,
})

const ASK = 'mcp__brobot__ask_question'
const REFUSAL =
  'refused (name-the-piece-you-ask-about): name the piece this question is about, by its label.'

const call = (id: string, args: Record<string, unknown>): TranscriptEvent =>
  ev({ type: 'tool_call', id, name: ASK, summary: JSON.stringify(args) })

const asking = (id: string, requestId: string): TranscriptEvent[] => [
  call(id, { question: 'Tea or coffee for the launch?', who_answers: 'a-person' }),
  ev({
    type: 'question_asked',
    requestId,
    prompt: 'Tea or coffee for the launch?',
    questions: [
      { id: 'q1', prompt: 'Tea or coffee?', options: [{ label: 'Tea' }, { label: 'Coffee' }] },
    ],
  }),
  ev({ type: 'request_routed', requestId, to: 'a-person' }),
  ev({ type: 'tool_result', id, summary: 'recorded', ok: true }),
]

const refused = (id: string): TranscriptEvent[] => [
  call(id, { question: 'Which bakery should we pick for Sunday?', who_answers: 'a-person' }),
  ev({ type: 'tool_result', id, summary: REFUSAL, ok: true }),
]

const words = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

function pane(events: TranscriptEvent[]): Mounted {
  return mount(
    ConversationPane,
    paneProps({ record: record([INVENTORY, ...events]), canAnswer: true }),
    { width: 1180, height: 900 },
  )
}

const card = (m: Mounted): HTMLElement => m.q('outgoing')
const toggleOf = (m: Mounted): HTMLElement | null =>
  card(m).querySelector<HTMLElement>('[data-cy="exchange-toggle"]')

describe('a question card that waits on nobody folds to one line', () => {
  it('a refused call: closed, and the refusal is on the line', () => {
    const m = pane(refused('c1'))
    const toggle = toggleOf(m)!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(words(toggle)).toContain('Which bakery should we pick')
    const state = card(m).querySelector<HTMLElement>('[data-cy="exchange-state"]')!
    expect(words(state).startsWith('refused (name-the-piece-you-ask-about)')).toBe(true)
    expect(state.title).toContain('refused (name-the-piece-you-ask-about)')
    expect(m.all('question-card')).toHaveLength(0)
  })

  it('an answered question: closed, and it says answered', () => {
    const m = pane([
      ...asking('c1', 'req_1'),
      ev({ type: 'user_decision', requestId: 'req_1', outcome: 'answered' }),
    ])
    expect(toggleOf(m)!.getAttribute('aria-expanded')).toBe('false')
    expect(words(card(m).querySelector('[data-cy="exchange-state"]')!)).toBe('answered')
  })

  it('a withdrawn question: closed, and it says withdrawn', () => {
    const m = pane([
      ...asking('c1', 'req_1'),
      ev({ type: 'question_withdrawn', requestId: 'req_1' }),
    ])
    expect(toggleOf(m)!.getAttribute('aria-expanded')).toBe('false')
    expect(words(card(m).querySelector('[data-cy="exchange-state"]')!)).toBe('withdrawn')
  })

  it('opened, the refused card shows its whole body, as before', async () => {
    const m = pane(refused('c1'))
    toggleOf(m)!.click()
    await nextTick()
    expect(toggleOf(m)!.getAttribute('aria-expanded')).toBe('true')
    expect(visible(m.q('question-card'))).toBe(true)
    expect(words(m.q('question-words'))).toContain('Which bakery should we pick for Sunday?')
    expect(words(m.q('question-card'))).toContain('refused (name-the-piece-you-ask-about)')
  })
})

describe('a question still waiting on the person stays open', () => {
  it('no triangle, the whole card and its answers in view', () => {
    const m = pane(asking('c1', 'req_1'))
    expect(toggleOf(m)).toBeNull()
    expect(visible(m.q('question-card'))).toBe(true)
    expect(words(m.q('question-words'))).toContain('Tea or coffee for the launch?')
    expect(card(m).textContent).toContain('Coffee')
  })
})
