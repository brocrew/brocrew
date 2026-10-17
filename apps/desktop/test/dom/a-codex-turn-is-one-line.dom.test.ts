import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * A Codex turn writes a short reasoning item before almost every call. Drawn in a transcript, the
 * finished thoughts join the calls around them, so six searches are one quiet line instead of
 * twelve rows; a message to another conversation in the middle stays its own card.
 */

afterEach(unmountAll)

const CODEX = { prefix: '', separator: '__' }

const EVENTS = {
  inventory: {
    type: 'tool_inventory',
    naming: CODEX,
    declared: {
      server: 'brobot',
      tools: [{ name: 'message_agent', description: '', parameters: [] }],
    },
    published: null,
  } as unknown as TranscriptEvent,
  asked: { type: 'user_turn', text: 'Find the bakery’s opening hours.' } as TranscriptEvent,
  answered: { type: 'assistant_message', text: 'They open at seven.' } as TranscriptEvent,
}

const thought = (text?: string): TranscriptEvent[] => [
  (text === undefined
    ? { type: 'thinking', phase: 'delta', redacted: true }
    : { type: 'thinking', phase: 'delta', text }) as TranscriptEvent,
  { type: 'thinking', phase: 'complete' } as TranscriptEvent,
]

const search = (id: string): TranscriptEvent[] => [
  {
    type: 'tool_call',
    id,
    name: 'web_search',
    summary: '{"query":"bakery hours"}',
  } as TranscriptEvent,
  { type: 'tool_result', id, summary: 'ok', ok: true } as TranscriptEvent,
]

const toAda = (id: string): TranscriptEvent[] => [
  {
    type: 'tool_call',
    id,
    name: 'brobot__message_agent',
    summary: '{"agent":"sess_ada","text":"Can you check the menu?"}',
  } as TranscriptEvent,
  {
    type: 'message_sent',
    to: 'sess_ada',
    toProfile: 'ada',
    kind: 'note',
    delivery: 'sent',
    onBehalfOfAPerson: false,
  } as TranscriptEvent,
  { type: 'tool_result', id, summary: 'sent', ok: true } as TranscriptEvent,
]

const turn = (from: number, n: number): TranscriptEvent[] =>
  Array.from({ length: n }, (_, i) => [...thought(), ...search(`s${from + i}`)]).flat()

function transcript(events: readonly TranscriptEvent[]): Mounted {
  const state = createTranscript()
  events.forEach((event, i) => applyEvent(state, event, 1_700_000_000_000 + i * 900, i + 1))
  return mount(
    TranscriptView,
    { items: state.items, mode: 'normal', ownAgent: 'BroBot' },
    { width: 1180, height: 800 },
  )
}

describe('a Codex turn of searches and thoughts', () => {
  it('six searches, each after a thought, draw ONE line', () => {
    const m = transcript([EVENTS.inventory, EVENTS.asked, ...turn(0, 6), EVENTS.answered])
    const runs = m.all('tool-run')
    expect(runs).toHaveLength(1)
    expect(runs[0]!.dataset.calls).toBe('6')
    expect(runs[0]!.dataset.thoughts).toBe('6')
    // None of the twelve is a row of its own.
    expect(m.all('thinking-entry')).toHaveLength(0)
    expect(m.all('tool-entry')).toHaveLength(0)
    const said = ['tool-run-head', 'tool-run-detail', 'tool-run-thoughts'].map((cy) =>
      m.q(cy).textContent?.trim(),
    )
    expect(said).toEqual(['6 tool calls', '· web_search ×6', '· 6 thoughts'])
  })

  it('a message to Ada in the middle stays its own card, between two lines', () => {
    const m = transcript([
      EVENTS.inventory,
      EVENTS.asked,
      ...turn(0, 3),
      ...thought(),
      ...toAda('m1'),
      ...turn(3, 3),
      EVENTS.answered,
    ])
    expect(m.all('tool-run')).toHaveLength(2)
    expect(m.all('outgoing')).toHaveLength(1)
    // In ledger order: a line, the card, a line, each its own row.
    const order = [...m.host.querySelectorAll('[data-cy="tool-run"], [data-cy="outgoing"]')].map(
      (el) => (el as HTMLElement).dataset.cy,
    )
    expect(order).toEqual(['tool-run', 'outgoing', 'tool-run'])
    expect(m.q('outgoing').closest('[data-cy="tool-run"]')).toBeNull()
  })

  it('opened, a thought with words has its tab in ledger order, and a thought with none has no tab', async () => {
    const m = transcript([
      EVENTS.inventory,
      EVENTS.asked,
      ...thought('Look up the hours first.'),
      ...search('s0'),
      ...thought(),
      ...search('s1'),
      ...thought('Then compare the two.'),
      ...search('s2'),
      ...thought(),
      EVENTS.answered,
    ])
    expect(m.q('tool-run').dataset.thoughts).toBe('4')
    m.q('tool-run-toggle').click()
    await nextTick()
    const tabs = [...m.host.querySelectorAll<HTMLElement>('[role="tab"]')]
    // The stream's order, with the two wordless thoughts left out of the strip.
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'thought',
      'web_search',
      'web_search',
      'thought',
      'web_search',
    ])
    // The first tab is a thought with words, already open to them.
    expect(m.q('thinking-text').textContent).toContain('Look up the hours first.')
    tabs[1]!.click()
    await nextTick()
    expect(m.q('tool-run-outcome')).toBeTruthy()
    expect(m.all('thinking-entry')).toHaveLength(0)
    // The thought between the second and third calls, read in its place.
    tabs[3]!.click()
    await nextTick()
    expect(m.q('thinking-text').textContent).toContain('Then compare the two.')
  })

  it('a run of wordless thoughts only is counted and offers nothing to open', () => {
    const m = transcript([
      EVENTS.inventory,
      EVENTS.asked,
      ...thought(),
      ...thought(),
      ...thought(),
      EVENTS.answered,
    ])
    const head = m.q('tool-run-toggle')
    expect(head.tagName).toBe('SPAN')
    expect(head.getAttribute('aria-expanded')).toBeNull()
    expect(m.q('tool-run-head').textContent?.trim()).toBe('3 thoughts')
    expect(m.all('tool-run-thoughts')).toHaveLength(0)
  })
})
