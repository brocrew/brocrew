import { expandAgentCards } from './harness'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ A message whose words carry JSON reads two ways — Readable and Raw
 *
 * A message containing prose followed by JSON offers raw and formatted views instead of one
 * undifferentiated wall of text.
 *
 * ⚑ Measured where a person sees it, on BOTH ends of the message: the sender's card and the card
 * the words become in the recipient's conversation. Readable draws the payload indented in its own
 * block; Raw is the words exactly as sent (`001`'s rule for a message's `textContent`), and the
 * toggle sits in the meta row, outside them. ⛔ The control: words with no JSON offer no toggle.
 */

afterEach(() => unmountAll())

const PAYLOAD = {
  outcome: 'ok',
  agent: { name: 'BroBot', state: 'idle', pieces: [{ label: 'W1', title: 'Test it' }] },
}
const PROSE = 'BroBot (brobot) · idle · holds W1 · Test it'
const NOTE = `${PROSE}${JSON.stringify(PAYLOAD)}`

const inventory: TranscriptEvent = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [{ name: 'message_agent', description: '', parameters: [] }],
  },
  published: null,
} as unknown as TranscriptEvent

/** ⚑ Ada's own page: the call, the host's row carrying the words, and its receipt. */
const sent = (text: string): TranscriptEvent[] => [
  inventory,
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__message_agent',
    summary: JSON.stringify({ agent: 'sess_brobot', kind: 'note' }),
  } as TranscriptEvent,
  {
    type: 'message_sent',
    to: 'sess_brobot',
    toProfile: 'brobot',
    kind: 'note',
    delivery: 'sent',
    onBehalfOfAPerson: false,
    text,
  } as TranscriptEvent,
  { type: 'tool_result', id: 'c1', summary: 'sent', ok: true } as TranscriptEvent,
]

/** ⚑ BroBot's page: the same words, arrived as a turn relayed from Ada. */
const arrived = (text: string): TranscriptEvent[] => [
  {
    type: 'user_turn',
    text,
    relayedFrom: 'sess_ada',
    relayedFromProfile: 'ada',
  } as TranscriptEvent,
]

const IDS = [
  { id: 'aid:ada', slug: 'ada', displayName: 'Ada' },
  { id: 'aid:brobot', slug: 'brobot', displayName: 'BroBot' },
] as unknown as AgentIdentity[]

const pane = (events: TranscriptEvent[]) =>
  expandAgentCards(
    mount(ConversationPane, paneProps({ record: record(events), identities: IDS, held: [] }), {
      width: 1200,
      height: 808,
    }),
  )

async function press(m: Mounted, cy: string): Promise<void> {
  ;(m.q(cy) as HTMLButtonElement).click()
  await nextTick()
}

/** ⚑ One end of the message, asked the same questions — `outgoing` or `relayed`. */
async function readsTwoWays(m: Mounted, end: 'outgoing' | 'relayed'): Promise<void> {
  const views = m.q('words-views')
  expect(visible(views)).toBe(true)
  // ⚑ Readable first: the prose as written, the payload indented in its own block.
  const readable = m.q(`${end}-readable`)
  expect(visible(readable)).toBe(true)
  const block = m.q('words-json')
  expect(visible(block)).toBe(true)
  expect(block.textContent).toBe(JSON.stringify(PAYLOAD, null, 2))
  expect(readable.textContent).toContain(PROSE)
  expect(m.all(`${end}-message`)).toHaveLength(0)
  // ⛔ The toggle is in the meta row, above the words — never inside them.
  expect(readable.contains(views)).toBe(false)
  expect(views.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    readable.getBoundingClientRect().top + 1,
  )
  // ⚑ Raw: the words exactly as sent, and no block.
  await press(m, 'words-view-raw')
  expect(m.q(`${end}-message`).textContent?.trim()).toBe(NOTE)
  expect(m.all('words-json')).toHaveLength(0)
  // ⚑ …and back.
  await press(m, 'words-view-readable')
  expect(visible(m.q('words-json'))).toBe(true)
}

describe('a message whose words carry JSON reads two ways', () => {
  it('🔴 on the sender’s card — Readable draws the payload as a block, Raw is the words as sent', async () => {
    await readsTwoWays(await pane(sent(NOTE)), 'outgoing')
  })

  it('🔴 on the recipient’s card — the same two views, one end over', async () => {
    await readsTwoWays(await pane(arrived(NOTE)), 'relayed')
  })

  it('⛔ THE CONTROL — words with no JSON offer no toggle and draw as they always did', async () => {
    const words = 'Done — sent it as a note, word for word.'
    const out = await pane(sent(words))
    expect(out.all('words-views')).toHaveLength(0)
    expect(out.q('outgoing-message').textContent?.trim()).toBe(words)
    unmountAll()
    const inn = await pane(arrived(words))
    expect(inn.all('words-views')).toHaveLength(0)
    expect(inn.q('relayed-message').textContent?.trim()).toBe(words)
  })
})
