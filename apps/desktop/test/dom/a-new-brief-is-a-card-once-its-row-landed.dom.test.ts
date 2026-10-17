import { expandAgentCards } from './harness'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { BODY_WAS_CUT, NEW_BRIEF_MARK } from '../../src/renderer/src/lib/outgoing-card'
import type { TranscriptEvent, WorkSentEvent } from '../../src/shared/runtime-ipc'
import { drawnReady } from './drawn'
import { mount, paneProps, record, unmountAll, visible } from './harness'

/**
 * # 🔴 D-047 · a new brief given with `update_work`, drawn as a card — once its row landed
 *
 * ⚑ **`9aa04094`** — measured where a person sees it. An `update_work` that carried a new brief, with
 * the `work_sent` row (`as: 'rebriefed'`) its conversation keeps, draws as a card: *BroBot to
 * another agent*, the refresh glyph, *W1.2*, *New brief*, the title above the WHOLE new brief, and no
 * cut note. ⛔ **The same call with no row is the tool row it always was** — `TranscriptView` asks
 * `drawsAsACard` before it hands a call to `OutgoingEntry`, and a card with no row would have drawn a
 * heading over nothing.
 *
 * ⛔ Every negative is paired with the same mount one fact over.
 */

beforeEach(() => {
  useWhoCalledWhom().reading.value = null
})

afterEach(() => {
  unmountAll()
  useWhoCalledWhom().reading.value = null
})

const inventory: TranscriptEvent = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [
      { name: 'give_work', description: '', parameters: [] },
      { name: 'update_work', description: '', parameters: [] },
    ],
  },
  published: null,
} as unknown as TranscriptEvent

const OWNER = 'sess_0d870a6d-1c2b-4e5f-8a9b-0c1d2e3f4a5b'
const TITLE = 'Make the rail say what the card says'
/** ⚑ Well past the 200 characters a call's arguments are cut at. */
const NEW_BRIEF =
  'Use the second table, not the first one, and say which rows moved and why they moved. '
    .repeat(5)
    .trim()
const RECEIPT = 'W1.2 · its new brief went to another agent straight away.'

const theCall = (args: Record<string, unknown>): TranscriptEvent => {
  const whole = JSON.stringify(args)
  return {
    type: 'tool_call',
    id: 'u1',
    name: 'mcp__brobot__update_work',
    summary: whole.length > 200 ? `${whole.slice(0, 200)}…` : whole,
  } as TranscriptEvent
}

const ROW: WorkSentEvent = {
  type: 'work_sent',
  piece: 'work_12',
  label: 'W1.2',
  as: 'rebriefed',
  to: OWNER,
  title: TITLE,
  brief: NEW_BRIEF,
}

const ANSWER = { type: 'tool_result', id: 'u1', summary: RECEIPT, ok: true } as TranscriptEvent

const ASKED: TranscriptEvent = { type: 'user_turn', text: 'give W1.2 the second table instead' }

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const pane = async (events: TranscriptEvent[]) => {
  const m = mount(
    ConversationPane,
    paneProps({ record: record(events), ownAgent: 'BroBot', held: [] }),
    { width: 1200, height: 808 },
  )
  await drawnReady()
  return expandAgentCards(m)
}

describe('a new brief given with update_work, on its giver’s page', () => {
  it('🔴 its row landed: a card — *BroBot to another agent*, the refresh glyph, W1.2, New brief, the title above the whole brief, no cut note, no tool row', async () => {
    const m = await pane([
      inventory,
      ASKED,
      theCall({ piece: 'W1.2', brief: NEW_BRIEF }),
      ROW,
      ANSWER,
    ])
    const card = m.q('outgoing')
    expect(visible(card)).toBe(true)
    expect(card.getAttribute('data-tool')).toBe('update_work')
    expect(card.querySelector('.heading use')?.getAttribute('href')).toBe('#i-refresh')
    expect(read(m.q('outgoing-heading'))).toBe('BroBot')
    expect(read(m.q('exchange-head').querySelector('.exchange-heading')!)).toBe(
      `BroBot → another agent · ${NEW_BRIEF_MARK} · W1.2`,
    )
    expect(m.all('outgoing-recipient')).toHaveLength(0)
    expect(read(m.q('outgoing-task'))).toBe('W1.2')
    expect(read(m.q('outgoing-mark'))).toBe(NEW_BRIEF_MARK)
    const title = m.q('outgoing-title')
    const brief = m.q('outgoing-message')
    expect(read(title)).toBe(TITLE)
    expect(read(brief)).toBe(NEW_BRIEF)
    expect(NEW_BRIEF.length).toBeGreaterThan(200)
    expect(title.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      brief.getBoundingClientRect().top,
    )
    expect(m.all('outgoing-cut')).toHaveLength(0)
    expect(read(card)).not.toContain(BODY_WAS_CUT)
    // ⚑ The conversation the new brief went to opens from the card — the row's `to`.
    expect(visible(m.q('outgoing-where'))).toBe(true)
    expect(m.all('tool-entry')).toHaveLength(0)
    expect(m.all('tool-run')).toHaveLength(0)
  })

  it('⛔ THE SAME CALL WITH NO ROW (an older ledger) — the tool row it always was, and no card', async () => {
    const m = await pane([inventory, ASKED, theCall({ piece: 'W1.2', brief: NEW_BRIEF }), ANSWER])
    expect(m.all('outgoing')).toHaveLength(0)
    const row = [...m.all('tool-entry'), ...m.all('tool-run')]
    expect(row.length).toBeGreaterThan(0)
    expect(read(row[0]!)).toContain('update_work')
  })

  it('⛔ a status-only update_work, row or not, is the tool row — never a card', async () => {
    const m = await pane([
      inventory,
      ASKED,
      theCall({ piece: 'W1.2', status: 'half way' }),
      ROW,
      { type: 'tool_result', id: 'u1', summary: 'W1.2 · status set.', ok: true } as TranscriptEvent,
    ])
    expect(m.all('outgoing')).toHaveLength(0)
    const row = [...m.all('tool-entry'), ...m.all('tool-run')]
    expect(row.length).toBeGreaterThan(0)
    expect(read(row[0]!)).toContain('update_work')
  })
})
