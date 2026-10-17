import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { agentCardEdgesFixture, EXCHANGE_INVENTORY } from './agent-exchanges.fixture'
import { drawnReady } from './drawn'
import { mount, paneProps, record, unmountAll, visible } from './harness'

/**
 * # 🔴 UI-003 · a request taken on for the person, as a card on its own page
 *
 * ⚑ **F038** — `take_on_work` drew only as a line in the tool run. ⚑ Measured where a person sees
 * it: the call draws as a card and not as a tool row, headed *<agent> took on*, with the piece's
 * label, *for you*, the title above the whole brief, and no receipt under it. It folds to one line
 * like the agent cards, and opens to the brief in markdown with its status line.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over**: a session never told its
 * tools' names draws the tool row it always drew, and no card.
 */

afterEach(() => unmountAll())

const inventory: TranscriptEvent = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [
      { name: 'take_on_work', description: '', parameters: [] },
      { name: 'reply_to_parent', description: '', parameters: [] },
    ],
  },
  published: null,
} as unknown as TranscriptEvent

const TITLE = 'Test shared memory'
const BRIEF =
  'Check that two agents of one profile see the same notes, and that a third does not. Then say what you found.'

const TAKEN: TranscriptEvent[] = [
  { type: 'user_turn', text: 'can you test shared memory?' },
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__take_on_work',
    summary: JSON.stringify({ title: TITLE, brief: BRIEF }),
  } as TranscriptEvent,
  {
    type: 'work_given',
    piece: 'work_7',
    label: 'W1.7',
    parent: 'work_1',
    givenBy: null,
    title: TITLE,
    brief: BRIEF,
  } as unknown as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'c1',
    summary: `Took on W1.7 · ${TITLE}, under W1, your conversation’s own work. Nobody was sent anything.`,
    ok: true,
  } as TranscriptEvent,
]

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** Opens a folded card: `within` names the card when the page holds more than one. */
const open = async (within: ParentNode): Promise<void> => {
  within.querySelector<HTMLElement>('[data-cy="exchange-toggle"]')!.click()
  await nextTick()
}

const pane = async (events: TranscriptEvent[]) => {
  const m = mount(ConversationPane, paneProps({ record: record(events), ownAgent: 'BroBot' }), {
    width: 1200,
    height: 808,
  })
  await drawnReady()
  return m
}

describe('a request taken on for the person, on its own page', () => {
  it('🔴 a card headed *BroBot took on · W1.7 · for you*, the title above the brief, no receipt, no tool row', async () => {
    const m = await pane([inventory, ...TAKEN])
    const card = m.q('outgoing')
    expect(visible(card)).toBe(true)
    await open(card)
    expect(card.getAttribute('data-tool')).toBe('take_on_work')
    expect(card.querySelector('.heading use')?.getAttribute('href')).toBe('#i-play')
    // The fold's own heading says *took on*, so the opened card's row names only the sender.
    expect(read(m.q('outside-card').querySelector('.exchange-heading')!)).toBe(
      'BroBot → you · took on · W1.7',
    )
    expect(read(m.q('outgoing-heading'))).toBe('BroBot')
    expect(m.all('outgoing-recipient')).toHaveLength(0)
    expect(read(m.q('outgoing-task'))).toBe('W1.7')
    expect(read(m.q('outgoing-state'))).toBe('for you')
    const title = m.q('outgoing-title')
    const brief = m.q('outgoing-message')
    expect(read(title)).toBe(TITLE)
    expect(read(brief)).toBe(BRIEF)
    expect(title.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      brief.getBoundingClientRect().top,
    )
    expect(m.all('outgoing-receipt')).toHaveLength(0)
    expect(m.all('tool-entry')).toHaveLength(0)
    expect(m.all('tool-run')).toHaveLength(0)
  })

  it('⛔ THE CONTROL — a session never told its tools’ names draws the tool row, and no card', async () => {
    const m = await pane(TAKEN)
    expect(m.all('outgoing')).toHaveLength(0)
    const row = [...m.all('tool-entry'), ...m.all('tool-run')]
    expect(row.length).toBeGreaterThan(0)
    expect(read(row[0]!)).toContain('take_on_work')
  })

  it('🔴 the finishing reply: *BroBot → you*, under W1.7 and its outcome, its summary — and nothing written to the model', async () => {
    const summary = 'Two agents of one profile see the same notes; a third does not.'
    const m = await pane([
      inventory,
      ...TAKEN,
      {
        type: 'tool_call',
        id: 'c2',
        name: 'mcp__brobot__reply_to_parent',
        summary: JSON.stringify({ piece: 'W1.7', outcome: 'done', summary }),
      } as TranscriptEvent,
      {
        type: 'work_replied',
        piece: 'work_7',
        outcome: 'done',
        summary,
        resources: [],
      } as unknown as TranscriptEvent,
      {
        type: 'tool_result',
        id: 'c2',
        summary:
          'W1.7 answered · it was a person’s own request, so the reply went to no other conversation — tell them here.',
        ok: true,
      } as TranscriptEvent,
    ])
    const reply = m.all('outgoing').find((card) => card.dataset.tool === 'reply_to_parent')!
    // The fold's heading says whom it went to, so the opened card's row names only the sender.
    expect(read(reply.querySelector('.exchange-heading')!)).toBe('BroBot → you · reply · W1.7')
    await open(reply)
    expect(read(reply.querySelector('[data-cy="outgoing-heading"]')!)).toBe('BroBot')
    expect(read(reply.querySelector('[data-cy="outgoing-task"]')!)).toBe('W1.7')
    expect(read(reply.querySelector('[data-cy="outgoing-message"]')!)).toBe(summary)
    expect(reply.querySelector('[data-cy="outgoing-receipt"]')).toBeNull()
    // ⚑ The pair on the same mount: the take-on card above it, still *for you*.
    const took = m.all('outgoing').find((card) => card.dataset.tool === 'take_on_work')!
    await open(took)
    expect(read(took.querySelector('[data-cy="outgoing-state"]')!)).toBe('for you')
  })

  it('🔴 the take-on card carries its newest status line — ⛔ the card without one carries none', async () => {
    const m = await pane([
      inventory,
      ...TAKEN,
      {
        type: 'work_status_set',
        piece: 'work_7',
        line: 'Running test 3 of 5',
        by: 'sess_1',
      } as unknown as TranscriptEvent,
    ])
    await open(m.host)
    const line = m.q('outgoing-status')
    expect(visible(line)).toBe(true)
    expect(read(line)).toBe('Status: Running test 3 of 5')
    expect(line.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      m.q('outgoing-message').getBoundingClientRect().bottom,
    )
    unmountAll()
    const bare = await pane([inventory, ...TAKEN])
    await open(bare.host)
    expect(read(bare.q('outgoing-state'))).toBe('for you')
    expect(bare.all('outgoing-status')).toHaveLength(0)
  })
})

describe('the take-on card folds like the agent cards', () => {
  it('🔴 one line by default: who took on which piece, its title and the time; the brief and status open under it', async () => {
    const m = await pane([
      inventory,
      ...TAKEN,
      {
        type: 'work_status_set',
        piece: 'work_7',
        line: 'Running test 3 of 5',
        by: 'sess_1',
      } as unknown as TranscriptEvent,
    ])
    const toggle = m.q('exchange-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(read(m.q('outside-card').querySelector('.exchange-heading')!)).toBe(
      'BroBot → you · took on · W1.7',
    )
    expect(read(m.q('exchange-preview'))).toBe(TITLE)
    // The heading already names the person, so the state does not say it again.
    expect(m.all('exchange-state')).toHaveLength(0)
    expect(visible(m.q('exchange-body'))).toBe(false)
    expect(m.all('outgoing-message')).toHaveLength(0)
    expect(m.all('outgoing-status')).toHaveLength(0)

    await open(m.host)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(read(m.q('outgoing-message'))).toBe(BRIEF)
    expect(read(m.q('outgoing-status'))).toBe('Status: Running test 3 of 5')
  })

  it('🔴 the brief opens in markdown, as the agent cards’ words do', async () => {
    const marked = 'Check **two agents** of one profile.\n\n- see the notes\n- say what you found'
    const m = await pane(
      [inventory, ...TAKEN].map((event) =>
        event.type === 'work_given' ? ({ ...event, brief: marked } as TranscriptEvent) : event,
      ),
    )
    await open(m.host)
    const brief = m.q('outgoing-message')
    expect(brief.querySelector('strong')?.textContent).toBe('two agents')
    expect(brief.querySelectorAll('li')).toHaveLength(2)
    expect(read(brief)).not.toContain('**')
  })

  it('🔴 it shares the agent cards’ left edge and width, folded and opened', async () => {
    const both = {
      ...EXCHANGE_INVENTORY,
      declared: {
        server: 'brobot',
        tools: [
          ...(EXCHANGE_INVENTORY as unknown as { declared: { tools: object[] } }).declared.tools,
          { name: 'take_on_work', description: '', parameters: [] },
        ],
      },
    } as unknown as TranscriptEvent
    const note = agentCardEdgesFixture().filter(
      (event) =>
        event.type === 'message_sent' ||
        ((event.type === 'tool_call' || event.type === 'tool_result') &&
          (event as { id?: string }).id === 'note'),
    )
    const m = await pane([both, ...TAKEN, ...note])
    const took = m.all('outgoing').find((card) => card.dataset.tool === 'take_on_work')!
    const sent = m.all('outgoing').find((card) => card.dataset.tool === 'message_agent')!
    for (const opened of [false, true]) {
      if (opened) {
        await open(took)
        await open(sent)
      }
      const a = took.querySelector('[data-cy="outside-card"]')!.getBoundingClientRect()
      const b = sent.querySelector('[data-cy="outside-card"]')!.getBoundingClientRect()
      expect(Math.abs(a.left - b.left)).toBeLessThan(1)
      expect(Math.abs(a.width - b.width)).toBeLessThan(1)
    }
  })
})

/* ------------------------------------------------- the hand-back and a settled question fold too */

const heading = (card: Element): string => read(card.querySelector('.exchange-heading')!)
const toggleOf = (card: Element): HTMLElement | null =>
  card.querySelector<HTMLElement>('[data-cy="exchange-toggle"]')
const inCard = (card: Element, cy: string): HTMLElement | null =>
  card.querySelector<HTMLElement>(`[data-cy="${cy}"]`)

describe('a piece handed back to the person folds to its outcome', () => {
  const SUMMARY = 'Two agents of one profile see the **same notes**; a third does not.'
  const handedBack = (outcome: string, resources: string[] = []): TranscriptEvent[] => [
    inventory,
    ...TAKEN,
    {
      type: 'tool_call',
      id: 'c2',
      name: 'mcp__brobot__reply_to_parent',
      summary: JSON.stringify({ piece: 'W1.7', outcome, summary: SUMMARY }),
    } as TranscriptEvent,
    {
      type: 'work_replied',
      piece: 'work_7',
      outcome,
      summary: SUMMARY,
      resources,
    } as unknown as TranscriptEvent,
    {
      type: 'tool_result',
      id: 'c2',
      summary:
        'W1.7 answered · it was a person’s own request, so the reply went to no other conversation — tell them here.',
      ok: true,
    } as TranscriptEvent,
  ]
  const replyIn = (m: { all: (cy: string) => HTMLElement[] }): HTMLElement =>
    m.all('outgoing').find((card) => card.dataset.tool === 'reply_to_parent')!

  for (const outcome of ['done', 'blocked', 'failed']) {
    it(`🔴 ${outcome}: one line that says so, and the summary opens on a press`, async () => {
      const m = await pane(handedBack(outcome))
      const reply = replyIn(m)
      expect(toggleOf(reply)!.getAttribute('aria-expanded')).toBe('false')
      expect(heading(reply)).toBe('BroBot → you · reply · W1.7')
      expect(read(inCard(reply, 'exchange-state')!).toLowerCase()).toContain(outcome)
      expect(read(inCard(reply, 'exchange-state')!)).not.toContain('file')
      expect(inCard(reply, 'outgoing-message')).toBeNull()

      await open(reply)
      expect(toggleOf(reply)!.getAttribute('aria-expanded')).toBe('true')
      const summary = inCard(reply, 'outgoing-message')!
      expect(visible(summary)).toBe(true)
      expect(summary.querySelector('strong')?.textContent).toBe('same notes')
    })
  }

  it('🔴 a hand-back with files says how many on its folded line', async () => {
    const two = replyIn(await pane(handedBack('done', ['res_a', 'res_b'])))
    expect(read(inCard(two, 'exchange-state')!)).toContain('2 files')
    unmountAll()
    const one = replyIn(await pane(handedBack('done', ['res_a'])))
    expect(read(inCard(one, 'exchange-state')!)).toContain('1 file')
    expect(read(inCard(one, 'exchange-state')!)).not.toContain('1 files')
  })
})

describe('a question to the person folds once it is settled, and never while it waits', () => {
  const asks: TranscriptEvent = {
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'ask_question', description: '', parameters: [] }],
    },
    published: null,
  } as unknown as TranscriptEvent
  const QUESTION = 'Tea or coffee for the bakery test?'
  const ASKED: TranscriptEvent[] = [
    { type: 'user_turn', text: 'ask me one question' },
    {
      type: 'tool_call',
      id: 'q1',
      name: 'mcp__brobot__ask_question',
      summary: JSON.stringify({ who_answers: 'a-person' }),
    } as TranscriptEvent,
    {
      type: 'question_asked',
      requestId: 'req_a',
      prompt: QUESTION,
      questions: [{ id: 'p1', prompt: QUESTION, options: [{ label: 'Tea' }, { label: 'Coffee' }] }],
    } as unknown as TranscriptEvent,
    { type: 'request_routed', requestId: 'req_a', to: 'a-person' } as unknown as TranscriptEvent,
    {
      type: 'tool_result',
      id: 'q1',
      summary: 'Your question is recorded.',
      ok: true,
    } as TranscriptEvent,
  ]
  const options = (card: Element): HTMLElement[] => [
    ...card.querySelectorAll<HTMLElement>('[data-cy="question-option"]'),
  ]

  it('🔴 still waiting: open, with its answers to press, and no fold', async () => {
    const m = await pane([asks, ...ASKED])
    const card = m.q('outgoing')
    expect(toggleOf(card)).toBeNull()
    expect(read(m.q('question-words'))).toBe(QUESTION)
    expect(options(card).map(read)).toEqual(['Tea', 'Coffee'])
    for (const option of options(card)) {
      expect(option.tagName).toBe('BUTTON')
      expect(visible(option)).toBe(true)
    }
  })

  for (const [settled, word] of [
    [
      { type: 'user_decision', requestId: 'req_a', outcome: 'answered', by: { who: 'a-person' } },
      'answered',
    ],
    [
      { type: 'user_decision', requestId: 'req_a', outcome: 'rejected', by: { who: 'a-person' } },
      'declined',
    ],
    [{ type: 'question_withdrawn', requestId: 'req_a' }, 'withdrawn'],
  ] as const) {
    it(`🔴 ${word}: one line with the question’s start and that word; the whole card opens on a press`, async () => {
      const m = await pane([asks, ...ASKED, settled as unknown as TranscriptEvent])
      const card = m.q('outgoing')
      expect(toggleOf(card)!.getAttribute('aria-expanded')).toBe('false')
      expect(heading(card)).toBe('BroBot → you · question')
      expect(read(inCard(card, 'exchange-preview')!)).toBe(QUESTION)
      expect(read(inCard(card, 'exchange-state')!)).toBe(word)
      expect(inCard(card, 'question-words')).toBeNull()

      await open(card)
      expect(read(inCard(card, 'question-words')!)).toBe(QUESTION)
      expect(read(inCard(card, 'question-state')!)).toBe(word)
      // Settled: its options are read, never pressed.
      for (const option of options(card)) expect(option.tagName).toBe('LI')
    })
  }
})
