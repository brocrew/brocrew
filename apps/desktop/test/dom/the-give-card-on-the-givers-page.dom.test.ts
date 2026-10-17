import { agentCardRecipient } from './harness'
import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { mount, paneProps, record, unmountAll, visible } from './harness'

/**
 * # 🔴 The piece a conversation gave, as a card on its own page
 *
 * `mcp__brobot__give_work` draws a dedicated card with the same treatment as a question call.
 *
 * ⚑ Measured where a person sees it: the call draws as the card and not as a tool row, with the send
 * glyph, the heading naming whom it went to, the label, the title above the brief, how it went, and
 * the press to the conversation it reached — the one the cast read for the receipt's label, since the
 * receipt names no conversation. ⛔ The control: a session never told its tools' names draws the tool
 * row it always drew.
 */

afterEach(() => {
  unmountAll()
  // ⛔ **The cast is a window-level singleton**, so a reading left behind would be the next test's
  // premise.
  useWhoCalledWhom().reading.value = null
})

const inventory: TranscriptEvent = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [{ name: 'give_work', description: '', parameters: [] }],
  },
  published: null,
} as unknown as TranscriptEvent

const OWNER = 'sess_0d870a6d-1c2b-4e5f-8a9b-0c1d2e3f4a5b'

const GIVEN: TranscriptEvent[] = [
  { type: 'user_turn', text: 'have Ayo fix the rail' },
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__give_work',
    summary: JSON.stringify({
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'dev',
      title: 'Make the rail say what the card says',
      brief: 'The rail and the card disagree about an agent. Find why and make them agree.',
    }),
  } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'c1',
    summary: 'W1.2 given to Ayo (dev); it went to Ayo straight away.',
    ok: true,
  } as TranscriptEvent,
]

const IDS = [{ id: 'aid:dev', slug: 'dev', displayName: 'Ayo' }] as unknown as AgentIdentity[]

/** ⚑ The cast's reading of this conversation (`record`'s `sess_1`): it gave W1.2 to Ayo's. */
const GAVE: WorkEdge = {
  piece: 'work_1',
  label: 'W1.2',
  title: 'Make the rail say what the card says',
  from: 'sess_1',
  fromIdentity: null,
  to: OWNER,
  toIdentity: 'dev',
  state: 'working',
  givenAt: 0,
  endedAt: null,
}

const CAST: WhoCalledWhom = {
  conversation: 'sess_1',
  parent: null,
  children: { rows: [], walk: 'every-conversation-this-one-spawned', ledgers: 0, rowsUnread: 0 },
  workGivenOut: {
    rows: [GAVE],
    walk: 'every-conversation-this-one-gave-work-to',
    ledgers: 1,
    rowsUnread: 0,
  },
  workTakenIn: {
    rows: [],
    walk: 'every-piece-of-work-this-one-was-given',
    ledgers: 0,
    rowsUnread: 0,
  },
  readAt: 0,
}

const pane = (events: TranscriptEvent[]) => {
  useWhoCalledWhom().reading.value = {
    conversation: 'sess_1',
    read: CAST,
    answered: true,
    atWork: null,
  }
  return expandAgentCards(
    mount(ConversationPane, paneProps({ record: record(events), identities: IDS, held: [] }), {
      width: 1200,
      height: 808,
    }),
  )
}

describe('the piece a conversation gave, on its own page', () => {
  it('🔴 a card with the send glyph, to Ayo, W1.2, the title above the brief, sent, and the press', async () => {
    const m = await pane([inventory, ...GIVEN])
    const card = m.q('outgoing')
    expect(visible(card)).toBe(true)
    expect(card.getAttribute('data-tool')).toBe('give_work')
    expect(card.querySelector('.heading use')?.getAttribute('href')).toBe('#i-send')
    expect(agentCardRecipient(m)).toBe('Ayo')
    expect(m.q('outgoing-task').textContent?.trim()).toBe('W1.2')
    expect(m.q('outgoing-mark').textContent?.trim()).toBe('work')
    expect(m.q('outgoing-state').textContent?.trim()).toBe('sent')
    const title = m.q('outgoing-title')
    const brief = m.q('outgoing-message')
    expect(visible(title)).toBe(true)
    expect(title.textContent?.trim()).toBe('Make the rail say what the card says')
    expect(brief.textContent?.trim()).toBe(
      'The rail and the card disagree about an agent. Find why and make them agree.',
    )
    // ⚑ The title reads first, above the brief — measured in pixels.
    expect(title.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      brief.getBoundingClientRect().top + 1,
    )
    expect(visible(m.q('outgoing-where'))).toBe(true)
    // ⛔ **The card IS the call** — no tool row beside it for the same act, and no receipt printed.
    expect(m.all('tool-entry')).toHaveLength(0)
    expect(m.all('outgoing-receipt')).toHaveLength(0)
    expect(card.textContent).not.toContain('sess_')
  })

  it('⛔ THE CONTROL — a session never told its tools’ names draws the tool row, and no card', async () => {
    const m = await pane(GIVEN)
    expect(m.all('outgoing')).toHaveLength(0)
    expect(m.all('tool-entry').length + m.all('tool-run').length).toBeGreaterThan(0)
  })
})
