import { agentCardSides } from './harness'
import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WorkReport } from '../../src/shared/tasks'
import {
  channelGap,
  META,
  mount,
  over,
  paintedBackground,
  paneProps,
  parseColor,
  record,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'

/** Incoming and outgoing agent cards share one edge; the participants keep their own treatment. */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

/** ⚑ Ada is named; BroBot is not, so the pane's own name comes from the default label. */
const IDS = [ident('ada', 'Ada'), ident('brobot', null)]

const INVENTORY = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: ['message_agent', 'reply_to_parent', 'list_tasks'].map((name) => ({
      name,
      description: '',
      parameters: [],
    })),
  },
  published: null,
} as unknown as TranscriptEvent

const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.3',
  state: 'answered',
  outcome: 'done',
  ...over,
})

const FROM_ADA = { relayedFrom: 'sess_ada', relayedFromProfile: 'ada' }

/** ⚑ Unique words per row, so each is found by what it SAYS and never by its position. */
const W = {
  mine: 'give Ada the migration and ask about the index',
  agent: 'Handing the migration to Ada now.',
  sent: 'Please write the migration for the orders index.',
  relayed: 'Which of the two indexes do you mean?',
  reply: 'I wrote the migration; the index builds concurrently.',
  stall: 'W1.4 stopped when the app restarted.',
  heldRelay: 'One more question about the orders table.',
  heldReply: 'The second migration is written too.',
  heldStall: 'W1.5 stopped while a turn was running.',
  goAhead: 'Go ahead with the plan.',
} as const

const PARENT: TranscriptEvent[] = [
  INVENTORY,
  { type: 'user_turn', text: W.mine } as TranscriptEvent,
  { type: 'assistant_message', text: W.agent } as TranscriptEvent,
  // ⚑ the app's own voice — a go-ahead BroBot sent for the person — stays out of any card
  { type: 'user_turn', text: W.goAhead, attribution: 'app_authored' } as TranscriptEvent,
  // ⚑ outgoing — a call of ours, with the host's row landed on it (D-016: a follow-up on the piece
  // BroBot gave Ada; kind `work` is gone, and a give is a plain tool row)
  {
    type: 'tool_call',
    id: 'call_msg',
    name: 'mcp__brobot__message_agent',
    summary: JSON.stringify({ agent: 'sess_ada', text: W.sent, kind: 'follow-up', piece: 'W1.3' }),
  } as TranscriptEvent,
  {
    type: 'message_sent',
    to: 'sess_ada',
    toProfile: 'ada',
    kind: 'follow-up',
    delivery: 'sent',
    onBehalfOfAPerson: true,
    piece: 'work_1',
    label: 'W1.3',
  } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'call_msg',
    ok: true,
    summary: 'sess_ada was idle, so it has been sent straight away.',
  } as TranscriptEvent,
  // ⚑ the control for the outgoing card — another tool of ours, which stays a tool row
  {
    type: 'tool_call',
    id: 'call_list',
    name: 'mcp__brobot__list_tasks',
    summary: '{}',
  } as TranscriptEvent,
  { type: 'tool_result', id: 'call_list', ok: true, summary: 'no tasks' } as TranscriptEvent,
  // 🔴 incoming — a relayed turn, and a reply
  { type: 'user_turn', text: W.relayed, ...FROM_ADA } as TranscriptEvent,
  {
    type: 'user_turn',
    text: W.reply,
    attribution: 'app_authored',
    work: report(),
    ...FROM_ADA,
  } as TranscriptEvent,
  // ⚑ a piece's row nobody relayed — the app's own stall notice
  {
    type: 'user_turn',
    text: W.stall,
    attribution: 'app_authored',
    work: report({
      piece: 'work_4',
      label: 'W1.4',
      state: 'stalled',
      stalledBecause: 'app_restarted',
      outcome: undefined,
    }),
  } as TranscriptEvent,
  // ⚑ the three held twins — a relay, a REPLY (the commonest busy-parent case), and a stall
  { type: 'message_queued', text: W.heldRelay, messageId: 'm_1', ...FROM_ADA } as TranscriptEvent,
  {
    type: 'message_queued',
    text: W.heldReply,
    messageId: 'm_3',
    work: report({ piece: 'work_6', label: 'W1.6' }),
    ...FROM_ADA,
  } as TranscriptEvent,
  {
    type: 'message_queued',
    text: W.heldStall,
    messageId: 'm_2',
    work: report({
      piece: 'work_5',
      label: 'W1.5',
      state: 'stalled',
      stalledBecause: 'app_restarted',
      outcome: undefined,
    }),
  } as TranscriptEvent,
]

/** ⚑ Ada's own conversation — her reply to the piece BroBot gave her. */
const CHILD: TranscriptEvent[] = [
  INVENTORY,
  {
    type: 'user_turn',
    text: W.sent,
    ...{ relayedFrom: 'sess_brobot', relayedFromProfile: 'brobot' },
    piece: 'work_1',
    label: 'W1.3',
  } as TranscriptEvent,
  {
    type: 'work_given',
    piece: 'work_1',
    label: 'W1.3',
    parent: 'work_brobot',
    givenBy: 'sess_brobot',
    title: 'the orders index migration',
    brief: W.sent,
  } as TranscriptEvent,
  { type: 'assistant_message', text: 'Writing it now.' } as TranscriptEvent,
  {
    type: 'tool_call',
    id: 'call_reply',
    name: 'mcp__brobot__reply_to_parent',
    summary: JSON.stringify({ piece: 'W1.3', outcome: 'done', summary: W.reply }),
  } as TranscriptEvent,
  {
    type: 'work_replied',
    piece: 'work_1',
    outcome: 'done',
    summary: W.reply,
    resources: [],
  } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'call_reply',
    ok: true,
    summary: 'W1.3 answered · sent',
  } as TranscriptEvent,
]

async function pane(events: TranscriptEvent[], child = false): Promise<Mounted> {
  await page.viewport(1400, 1400)
  const r = record(events, child ? 'sess_ada' : 'sess_1')
  if (child) r.meta = { ...META, sessionId: 'sess_ada', profileId: 'ada' }
  const m = mount(ConversationPane, paneProps({ record: r, identities: IDS, held: [] }), {
    width: 1200,
    height: 1400,
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  return expandAgentCards(m)
}

/** The transcript entry whose words include `text` — found by what it says. */
function entry(m: Mounted, text: string): HTMLElement {
  const found = [...m.host.querySelectorAll<HTMLElement>('.entry')].filter((el) =>
    el.textContent?.includes(text),
  )
  expect(found, `no single entry says “${text}”`).toHaveLength(1)
  return found[0] as HTMLElement
}

/** The card an entry sits in, or `null` — read from the DOM, never from a class the test chose. */
const cardIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector<HTMLElement>('[data-cy="outside-card"]')

/** ⚑ Where the conversation's own column begins — the person's row, measured. */
function column(m: Mounted): { rowLeft: number; wordsLeft: number } {
  const mine = entry(m, W.mine)
  const article = mine.querySelector('article') as HTMLElement
  return {
    rowLeft: article.getBoundingClientRect().left,
    wordsLeft: (
      mine.querySelector('[data-cy="user-message"]') as HTMLElement
    ).getBoundingClientRect().left,
  }
}

const heading = (el: Element | null): string =>
  el && el.closest('[data-cy="outside-card"]')
    ? agentCardSides(el)
    : (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the heading says whom it is to
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('658 · a message from outside, on a real screen', () => {
  describe('§1 · “Ada to BroBot”, read as text', () => {
    it('🔴 every incoming row is headed sender-to-recipient, both from the app’s one naming function', async () => {
      const m = await pane(PARENT)
      expect(heading(entry(m, W.relayed).querySelector('[data-cy="relayed-heading"]'))).toBe(
        'Ada to BroBot',
      )
      expect(heading(entry(m, W.reply).querySelector('[data-cy="work-report-from"]'))).toBe(
        'Ada to BroBot',
      )
      expect(heading(entry(m, W.heldRelay).querySelector('[data-cy="queued-heading"]'))).toBe(
        'Ada to BroBot',
      )
      expect(heading(entry(m, W.heldReply).querySelector('[data-cy="queued-from"]'))).toBe(
        'Ada to BroBot',
      )
      // ⛔ never a slug and never a handle, anywhere in the page's headings
      for (const cy of [
        'relayed-heading',
        'work-report-from',
        'queued-heading',
        'queued-from',
        'outgoing-heading',
      ]) {
        for (const el of m.all(cy)) expect(heading(el)).not.toMatch(/sess_|\bada\b/)
      }
    })

    it('🔴 an outgoing call is headed the other way — the conversation’s agent to its recipient', async () => {
      const m = await pane(PARENT)
      expect(heading(entry(m, W.sent).querySelector('[data-cy="outgoing-heading"]'))).toBe(
        'BroBot to Ada',
      )
      const child = await pane(CHILD, true)
      expect(heading(child.q('outgoing-heading'))).toBe('Ada to BroBot')
      // ⚑ and the reply's WHOLE words are on the card, not the call's arguments
      expect(child.q('outgoing-message').textContent?.trim()).toBe(W.reply)
      // ⚑ it names the work it answers, as the parent's report card does
      expect(child.q('outgoing-task').textContent?.trim()).toBe('W1.3')
      // ⚑ and each card says where its words went, from the host's own rows
      expect(child.q('outgoing-state').textContent?.trim()).toBe('delivered')
      expect(
        entry(m, W.sent).querySelector('[data-cy="outgoing-state"]')?.textContent?.trim(),
      ).toBe('sent')
    })

    it('⛔ the participants are headed as themselves — “You”, and the agent’s own name', async () => {
      const m = await pane(PARENT)
      expect(heading(entry(m, W.mine).querySelector('strong'))).toBe('You')
      expect(heading(entry(m, W.agent).querySelector('strong'))).toBe('BroBot')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · card or participant, and the indent in pixels
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the frame and the shift, in pixels', () => {
    it('incoming relays, reports and held words share the outgoing cards’ left edge and width', async () => {
      const m = await pane(PARENT)
      const { rowLeft } = column(m)
      const outgoing = cardIn(entry(m, W.sent))!.getBoundingClientRect()
      for (const text of [W.relayed, W.reply, W.heldRelay, W.heldReply]) {
        const card = cardIn(entry(m, text))
        expect(card, `${text} is not in a card`).not.toBeNull()
        const shift = (card as HTMLElement).getBoundingClientRect().left - rowLeft
        expect(Math.abs(shift), `${text} shifted ${shift}px`).toBeLessThan(1)
        expect(Math.abs(card!.getBoundingClientRect().width - outgoing.width)).toBeLessThan(1)
        // ⚑ the shift is the card's own margin — the layout, not an accident of wrapping
        expect(
          Math.abs(shift - parseFloat(getComputedStyle(card as HTMLElement).marginLeft)),
        ).toBeLessThan(1)
      }
    })

    it('⛔ piece rows nobody relayed, and our own outgoing calls, are cards NOT shifted', async () => {
      const m = await pane(PARENT)
      const { rowLeft } = column(m)
      for (const text of [W.stall, W.heldStall, W.sent]) {
        const card = cardIn(entry(m, text))
        expect(card, `${text} is not in a card`).not.toBeNull()
        const shift = (card as HTMLElement).getBoundingClientRect().left - rowLeft
        expect(Math.abs(shift), `${text} shifted ${shift}px`).toBeLessThan(1)
      }
    })

    it('⚑ the participants — and a tool call that is not one of ours — are in no card', async () => {
      const m = await pane(PARENT)
      for (const text of [W.mine, W.agent, W.goAhead, 'mcp__brobot__list_tasks']) {
        const found = [...m.host.querySelectorAll<HTMLElement>('.entry')].filter((el) =>
          el.textContent?.includes(text),
        )
        expect(found.length, `${text} not on screen`).toBeGreaterThan(0)
        for (const el of found) expect(cardIn(el), `${text} is in a card`).toBeNull()
      }
    })

    it('⚑ a HELD card is dashed and a delivered one solid — `077`’s grammar on the card’s edge', async () => {
      const m = await pane(PARENT)
      for (const text of [W.heldRelay, W.heldReply, W.heldStall]) {
        expect(getComputedStyle(cardIn(entry(m, text)) as HTMLElement).borderTopStyle, text).toBe(
          'dashed',
        )
      }
      for (const text of [W.relayed, W.reply, W.stall, W.sent]) {
        expect(getComputedStyle(cardIn(entry(m, text)) as HTMLElement).borderTopStyle, text).toBe(
          'solid',
        )
      }
    })

    it('⛔ no card carries an avatar; both participants still do', async () => {
      const m = await pane(PARENT)
      for (const card of m.all('outside-card')) expect(card.querySelector('.msg-avatar')).toBeNull()
      expect(m.all('outside-card').length).toBe(7)
      for (const text of [W.mine, W.agent]) {
        expect(entry(m, text).querySelector('.msg-avatar')).not.toBeNull()
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a surface a person can see, in both zones
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the card is visible as a card, in the light zone and the dark', () => {
    for (const theme of ['light', 'dark'] as const) {
      it(`🔴 ${theme} · a hairline and a wash the page does not have — and the participant has neither`, async () => {
        const m = await pane(PARENT)
        // ⚑ **Flip the CARRIER** — the pane declares the zone; a child set would measure nothing.
        m.q('conversation-pane').setAttribute('data-chat-theme', theme)
        const card = cardIn(entry(m, W.relayed)) as HTMLElement
        const mine = entry(m, W.mine).querySelector('article') as HTMLElement
        const style = getComputedStyle(card)
        expect(style.borderTopStyle).toBe('solid')
        expect(parseFloat(style.borderTopWidth)).toBeGreaterThanOrEqual(1)
        const page_ = paintedBackground(mine)
        const surface = paintedBackground(card)
        const line = parseColor(style.borderTopColor)
        expect(line, 'the hairline has no colour').not.toBeNull()
        // ⛔ discreet is not invisible: the hairline must read against the page behind it —
        // COMPOSITED over the card's own surface, so a transparent line cannot pass on its RGB
        expect(
          channelGap(over(line as Rgba, surface), page_),
          `line ${style.borderTopColor} on ${show(page_)}`,
        ).toBeGreaterThan(8)
        // ⚑ and the wash differs from the page — by little, on purpose
        expect(channelGap(surface, page_), `${show(surface)} on ${show(page_)}`).toBeGreaterThan(0)
        // ⚑ the control: the person's row paints no frame of its own
        expect(getComputedStyle(mine).borderTopStyle).toBe('none')
      })
    }
  })
})
