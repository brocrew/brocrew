import { agentCardSides } from './harness'
import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  AgentIdentity,
  RuntimeBridge,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, type Mounted } from './harness'
import { assertDrawn, drawnReady } from './drawn'

/**
 * # 🔴 678 · Draw what main now hands you — two of `671`'s facts, read as TEXT on a real screen
 *
 * | | ⚑ the fact on the wire (`671`) | ⛔ what a person read before `678` |
 * |---|---|---|
 * | §1 F-G1 | `message_sent.text`, cut at 1,280 and `clipped` when cut | the call's arguments, cut at 200, ending in a `…` the author could have typed |
 * | §2 F-G2 | `user_turn.piece` — the piece these words GAVE (a task until D-016) | an incoming card that could not say it arrived as work |
 * | §3 (`678` §3, rule 8.1) | the control a person is sent to, by the words ON it | *"Create it from the rail"*, *"The switch is in the rail"* — a word nothing is labelled |
 *
 * ⚑ **Every section plants its control in the SAME page** — a row whose words must NOT change — so a
 * repair that rewrote every card cannot pass; and every expected string is a literal, never one
 * derived through the code under test.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

const IDS = [ident('ada', 'Ada'), ident('brobot', null)]
const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const INVENTORY = ev({
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: ['message_agent', 'reply_to_parent'].map((name) => ({
      name,
      description: '',
      parameters: [],
    })),
  },
  published: null,
})

async function pane(events: TranscriptEvent[]): Promise<Mounted> {
  await page.viewport(1400, 1400)
  const m = mount(
    ConversationPane,
    paneProps({ record: record(events, 'sess_1'), identities: IDS, held: [] }),
    { width: 1200, height: 1400 },
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  return expandAgentCards(m)
}

const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** The one outgoing card whose words begin with `head` — found by what it says. */
function outgoing(m: Mounted, head: string): HTMLElement {
  const found = m
    .all('outgoing')
    .filter((card) => words(card.querySelector('[data-cy="outgoing-message"]')).startsWith(head))
  expect(found, `no single outgoing card begins “${head}”`).toHaveLength(1)
  return found[0] as HTMLElement
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · F-G1 — the words on the receipt, and a cut that SAYS it was cut
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ 1,280 units exactly, ending in a word — as main cuts it, never splitting a surrogate pair. */
const LONG =
  `Please rebuild the orders index concurrently. ${'Then check every foreign key. '.repeat(60)}`.slice(
    0,
    1_280,
  )
const SHORT = 'Is the index built yet? …or should I wait?'
const OLD = `Before 671 a message's words lived only in its call: ${'more words that were cut. '.repeat(20)}`

/** A `message_agent` call, its host row and its answer — `row` is the `message_sent` extras. */
const sent = (id: string, text: string, row: Record<string, unknown>): TranscriptEvent[] => [
  ev({
    type: 'tool_call',
    id,
    name: 'mcp__brobot__message_agent',
    // ⚠️ both adapters bound the arguments at 200 and end a cut one with `…`
    summary: `${JSON.stringify({ agent: 'sess_ada', text, kind: 'note' }).slice(0, 200)}…`,
  }),
  ev({
    type: 'message_sent',
    to: 'sess_ada',
    toProfile: 'ada',
    kind: 'note',
    delivery: 'sent',
    onBehalfOfAPerson: true,
    ...row,
  }),
  ev({ type: 'tool_result', id, ok: true, summary: 'sent straight away as a note.' }),
]

describe('§1 · F-G1 · the outgoing card draws the host’s words', () => {
  it('🔴 a cut message: the card shows the 1,280 the host kept, and SAYS it was cut — in words', async () => {
    const m = await pane([INVENTORY, ...sent('c_long', LONG, { text: LONG, clipped: true })])
    const card = outgoing(m, 'Please rebuild the orders index')
    const body = card.querySelector('[data-cy="outgoing-message"]') as HTMLElement
    // ⚑ the words are the host's, whole — past the arguments' 200
    expect(body.textContent?.trim()).toBe(LONG.trim())
    expect(LONG.length).toBeGreaterThan(200)
    // ⛔ and the box holds ONLY the words: no `…` the app appended, which the author could have typed
    expect(body.textContent?.trim().endsWith('…')).toBe(false)
    const cut = card.querySelector('[data-cy="outgoing-cut"]') as HTMLElement
    expect(words(cut)).toBe('Cut at the size limit — this much of it is shown here.')
    // ⛔ a sentence of its own, OUTSIDE the message's box, drawn below it
    expect(body.contains(cut)).toBe(false)
    expect(cut.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      body.getBoundingClientRect().bottom,
    )
  })

  /**
   * 🔴 **685 · `678` F4, decided — the card's body keeps NO height bound, and is drawn whole.**
   *
   * ⚑ **Its two twins draw the same words unbounded**: the recipient's `RelayedEntry` (the words
   * that went to the provider, verbatim) and the parent's `WorkReportEntry` — and every transcript
   * `.msg-body` is unbounded. ⛔ A clamp would make the card's own sentence — *"this much of it is
   * shown here"* — false. ⚠️ `textContent` cannot see a clip (`531` F1), so the sensor asks whether
   * the ink was DRAWN; if the PM rules for a bound after the photograph, it is scroll-in-place
   * (`MemoryNoteEntry`'s), which keeps every unit reachable and this assertion green.
   */
  it('🔴 685 · the 1,280 units are DRAWN whole, not just held — no bound cuts the card', async () => {
    const m = await pane([INVENTORY, ...sent('c_long', LONG, { text: LONG, clipped: true })])
    const body = outgoing(m, 'Please rebuild the orders index').querySelector(
      '[data-cy="outgoing-message"]',
    ) as HTMLElement
    await drawnReady()
    assertDrawn(body, 'the 1,280-unit message body')
  })

  it('⚑ the control — a whole message: its words, and no cut line, even when the author typed `…`', async () => {
    const m = await pane([INVENTORY, ...sent('c_short', SHORT, { text: SHORT })])
    const card = outgoing(m, 'Is the index built yet?')
    expect(words(card.querySelector('[data-cy="outgoing-message"]'))).toBe(SHORT)
    expect(card.querySelector('[data-cy="outgoing-cut"]')).toBeNull()
  })

  it('⚑ the control — a row written before 671 carries no words: the arguments, cut, and it says so', async () => {
    const m = await pane([INVENTORY, ...sent('c_old', OLD, {})])
    const card = outgoing(m, 'Before 671')
    const body = words(card.querySelector('[data-cy="outgoing-message"]'))
    // ⚑ the head of the words, as the arguments kept them — shorter than the message
    expect(OLD.startsWith(body)).toBe(true)
    expect(body.length).toBeLessThan(OLD.length)
    expect(words(card.querySelector('[data-cy="outgoing-cut"]'))).toBe(
      'Cut at the size limit — this much of it is shown here.',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · F-G2 — the incoming card says the piece its words gave, joined in BOTH ledger orders
// ─────────────────────────────────────────────────────────────────────────────────────────────

const FROM_ADA = { relayedFrom: 'sess_ada', relayedFromProfile: 'ada' }
/** ⚑ The owner's `work_given` row (D-016) — the give's label and its title. */
const given = (piece: string, label: string, title: string, over: Record<string, unknown> = {}) =>
  ev({
    type: 'work_given',
    piece,
    label,
    parent: 'work_root',
    givenBy: 'sess_ada',
    title,
    brief: title,
    ...over,
  })

const T = {
  idle: 'Write the migration for the orders index.',
  held: 'And the second migration, when you are free.',
  question: 'Which of the two indexes do you mean?',
  unnumbered: 'Rename the table once the index is in.',
} as const

const EXCHANGE: TranscriptEvent[] = [
  INVENTORY,
  // ⚑ IDLE — the turn FIRST, then the row that titles it
  ev({ type: 'user_turn', text: T.idle, piece: 'work_7', label: 'W1.7', ...FROM_ADA }),
  given('work_7', 'W1.7', 'the orders index'),
  // ⚑ HELD — the row first, while the words wait; then the flush and the turn
  ev({ type: 'message_queued', text: T.held, messageId: 'm_8', ...FROM_ADA }),
  given('work_8', 'W1.8', 'the second migration', { messageId: 'm_8' }),
  ev({ type: 'message_unqueued', messageId: 'm_8', reason: 'sent' }),
  ev({ type: 'user_turn', text: T.held, piece: 'work_8', label: 'W1.8', ...FROM_ADA }),
  // ⛔ the controls — a question gives no piece; a piece no row ever labelled
  ev({ type: 'user_turn', text: T.question, ...FROM_ADA }),
  ev({ type: 'user_turn', text: T.unnumbered, piece: 'work_9', ...FROM_ADA }),
]

/** The incoming card whose words are `text`, and what it says about a piece. */
function incoming(m: Mounted, text: string): { heading: string; task: string | null } {
  const found = m
    .all('relayed')
    .filter((card) => words(card.querySelector('[data-cy="relayed-message"]')) === text)
  expect(found, `no single incoming card says “${text}”`).toHaveLength(1)
  const card = found[0] as HTMLElement
  const task = card.querySelector('[data-cy="relayed-task"]')
  return {
    heading: agentCardSides(card),
    task: task === null ? null : words(task),
  }
}

describe('§2 · F-G2 · the incoming card says the piece its words gave', () => {
  it('🔴 idle order — the turn came first, and the card still reads W1.7 and its title', async () => {
    const m = await pane(EXCHANGE)
    expect(incoming(m, T.idle)).toEqual({
      heading: 'Ada to BroBot',
      task: 'W1.7 · the orders index',
    })
  })

  it('🔴 held order — the row came first, and the flushed card reads W1.8 and its title', async () => {
    const m = await pane(EXCHANGE)
    expect(incoming(m, T.held)).toEqual({
      heading: 'Ada to BroBot',
      task: 'W1.8 · the second migration',
    })
  })

  it('⛔ the controls — a question says no piece; a piece nothing labelled says *Piece*, never a guess', async () => {
    const m = await pane(EXCHANGE)
    expect(incoming(m, T.question)).toEqual({ heading: 'Ada to BroBot', task: null })
    expect(incoming(m, T.unnumbered).task).toBe('Piece')
    // ⛔ the heading and the mark are untouched — the piece is a sibling, never inside them
    for (const card of m.all('relayed')) {
      expect(words(card.querySelector('[data-cy="relayed-mark"]'))).toBe(
        'from another conversation',
      )
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the agent sheet sends a person to a control by the words ON it
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the sheet names the control, never *the rail*', () => {
  const identity = (slug: string): AgentIdentity =>
    ({
      id: `agp:default:${slug}`,
      slug,
      displayName: null,
      role: null,
      createdAt: 1_700_000_000_000,
      createdBy: null,
      provider: null,
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
      chosen: {},
    }) as unknown as AgentIdentity

  async function sheet(profileSlug: string, spawningEnabled: boolean): Promise<Mounted> {
    const roster = {
      identities: [identity('pm')],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled,
      defaultApprovalMode: 'ask',
      externalMcpServers: [],
    } as unknown as AgentIdentities
    const store = createAgentStore({
      agentIdentities: async () => roster,
    } as unknown as RuntimeBridge)
    await store.load()
    await page.viewport(960, 1300)
    const m = mount(
      CapabilitiesSheet,
      { profileSlug, runsOn: 'claude', store, onClose: () => {} },
      { width: 900, height: 1250 },
    )
    await nextTick()
    return expandAgentCards(m)
  }

  it('🔴 spawning off: the sentence names the switch by its heading — and the control, on, draws none', async () => {
    const off = await sheet('pm', false)
    const said = words(off.q('capabilities-spawning-off'))
    // ⚠️ **and the second press** — switching spawning back ON asks once (`355`)
    // The switch heading changed; the instruction must still name that exact control.
    expect(said).toContain(
      'Press “Agents cannot start new conversations”, then confirm, to switch it back on.',
    )
    expect(said).not.toMatch(/\brail\b/)
    unmountAll()
    const on = await sheet('pm', true)
    expect(on.host.querySelector('[data-cy="capabilities-spawning-off"]')).toBeNull()
  })

  it('🔴 an identity that is gone: where one is created, and that opening the sheet does not', async () => {
    const m = await sheet('ghost', true)
    const said = words(m.q('capabilities-no-row'))
    expect(said).toContain('There is no agent identity called ghost')
    expect(said).toContain('opening this sheet does not create one')
    expect(said).toContain('Create it with New agent on the Team page')
    // ⛔ the two false clauses it had: a project scope identities do not have, and *rails*
    expect(said).not.toContain('in this project')
    expect(said).not.toMatch(/\brails?\b/)
  })
})
