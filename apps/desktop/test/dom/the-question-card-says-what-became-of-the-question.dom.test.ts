import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 What became of the question — the asker's card, read as TEXT and as PAINT on a real screen
 *
 * `mcp__brobot__ask_question` and `mcp__brobot__pass_question_up` have dedicated cards.
 * `a-question-sent-is-a-card` and `the-question-card-on-the-askers-page` cover one question
 * routed once after its call. This suite adds simultaneous questions, rows before calls,
 * repeated routing, call errors, and a question cut inside its call, then measures glyphs,
 * chips, and failure color in the DOM.
 *
 * | | subject | ⚑ the control in the SAME page |
 * |---|---|---|
 * | T1 | the glyph, whom it went to, what it is | a `message_agent` card beside them wears none |
 * | T2 | each question closes on ITS card, in words, never *waiting* | the refused call draws its receipt and no state word |
 * | T3 | a call that errored after its row: *failed*, in the failure colour | the call before it says *asked* and prints no receipt |
 * | T4 | a question routed on to a person loses the press to the agent it left | the card still routed to an agent keeps a live press |
 * | T5 | rows that arrive BEFORE their calls still land (routing, withdrawal) | the unrouted card takes the call's own word |
 * | T6 | two passes at once take their OWN context, whichever row arrives first | — each card holds only its own words |
 * | T7 | the options are chips a person reads, not controls | the press beside them is pointer-cursored and emits |
 * | T8 | each part's prompt and options; free text draws no empty box | the one-part question keeps its chips |
 * | T9 | a question cut in its call says so | a call cut but recorded whole says nothing |
 *
 * ⛔ **The one card is the whole reader**: each assertion is made per card, inside its own
 * `[data-cy=outgoing]`, in DOM order, so a word on the wrong card cannot pass for the right one.
 *
 * ## 🔴 UI-009 (F052) · the card is `QuestionCard`, the one *Waiting on you* draws
 *
 * ⚑ Its head reads *"Ayo asked you · W1.64"* (*"passed up to"* for a pass) and its hooks are
 * `question-*`; an open question says no state word — the head's verb already says it was asked.
 * ⚑ T7's question went to another AGENT, so its options are still chips; a question asked of a
 * person in a conversation the person can answer from draws them as presses.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

const IDS = [ident('ayo', 'Ayo'), ident('brobot', 'BroBot'), ident('ada', 'Ada')]

/** ⚑ The two question tools and the message tool, declared under `brobot` — what the fold recognises by. */
const INVENTORY = ev({
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: ['ask_question', 'pass_question_up', 'message_agent'].map((name) => ({
      name,
      description: '',
      parameters: [],
    })),
  },
  published: null,
})

const ASK = 'mcp__brobot__ask_question'
const PASS = 'mcp__brobot__pass_question_up'
const MESSAGE = 'mcp__brobot__message_agent'

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

const call = (id: string, name: string, args: Record<string, unknown>): TranscriptEvent =>
  ev({ type: 'tool_call', id, name, summary: JSON.stringify(args) })

const done = (id: string, summary = 'recorded', ok = true): TranscriptEvent =>
  ev({ type: 'tool_result', id, summary, ok })

/** ⚑ `work_given` — BroBot gave Ayo the piece `piece`, labelled `label`. */
const given = (piece: string, label: string): TranscriptEvent =>
  ev({
    type: 'work_given',
    piece,
    label,
    parent: 'work_root',
    givenBy: 'sess_brobot',
    title: `piece ${label}`,
    brief: `piece ${label}`,
  })

/** ⚑ `question_asked` — no piece, no prompt and no parts unless the test says so. */
const asked = (requestId: string, over: Record<string, unknown> = {}): TranscriptEvent =>
  ev({ type: 'question_asked', requestId, prompt: '', questions: [], ...over })

const routed = (
  requestId: string,
  to: 'the-parent' | 'a-person' | 'an-agent',
  parent?: string,
): TranscriptEvent =>
  ev({ type: 'request_routed', requestId, to, ...(parent === undefined ? {} : { parent }) })

/** The pane of Ayo's conversation, as the app draws it — `over` is what a test hands the pane besides. */
async function pane(
  events: TranscriptEvent[],
  over: Record<string, unknown> = {},
): Promise<Mounted> {
  await page.viewport(1200, 1400)
  const r = record(events, 'sess_ayo')
  r.meta = { ...META, sessionId: 'sess_ayo', profileId: 'ayo' }
  const m = mount(ConversationPane, paneProps({ record: r, identities: IDS, held: [], ...over }), {
    width: 1200,
    height: 1400,
  })
  await settle()
  return expandAgentCards(m)
}

/** Every card, in the order the page draws them. */
const cards = (m: Mounted): HTMLElement[] => m.all('outgoing')

/** ⚑ Everything with this `data-cy` INSIDE one card — never the page's first match. */
const inside = (card: Element, cy: string): HTMLElement[] => [
  ...card.querySelectorAll<HTMLElement>(`[data-cy="${cy}"]`),
]

const said = (card: Element, cy: string): string[] => inside(card, cy).map((el) => text(el))

/** The one element with this `data-cy` inside the card, asserted to be exactly one. */
function one(card: Element, cy: string): HTMLElement {
  const found = inside(card, cy)
  expect(found, `${cy} on the card`).toHaveLength(1)
  return found[0] as HTMLElement
}

/** ⚑ **UI-009** — the head's *"Ayo asked you"*, without the piece, state and time beside it. */
const who = (card: Element): string => text(card.querySelector('[data-cy="question-head"] .who'))

/** How many times `needle` is read in `haystack`. */
const times = (haystack: string, needle: string): number => haystack.split(needle).length - 1

// ─────────────────────────────────────────────────────────────────────────────────────────────
// T1 · the glyph, the heading, the mark
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the question card, on a page with several of them', () => {
  it('🔴 an ask and a pass wear the question glyph, say whom they went to and what they are — and a message beside them wears none', async () => {
    const m = await pane([
      INVENTORY,
      given('work_64', 'W1.64'),
      call('c1', ASK, { piece: 'work_64', who_answers: 'a-person' }),
      asked('req_a', {
        piece: 'work_64',
        label: 'W1.64',
        prompt: 'Tea or coffee?',
        questions: [
          { id: 'q1', prompt: 'Tea or coffee?', options: [{ label: 'Tea' }, { label: 'Coffee' }] },
        ],
      }),
      routed('req_a', 'a-person'),
      done('c1'),
      call('p1', PASS, { question: 'req_up', who_answers: 'the-parent', context: 'Tried both.' }),
      asked('req_b', {
        passedUpFrom: 'req_up',
        prompt: 'Which database?',
        context: 'Tried both.',
        questions: [{ id: 'q1', prompt: 'Which database?', options: [] }],
      }),
      routed('req_b', 'the-parent', 'sess_brobot'),
      done('p1'),
      call('m1', MESSAGE, { agent: 'sess_ada', text: 'Hi Ada', kind: 'note' }),
      ev({
        type: 'message_sent',
        to: 'sess_ada',
        toProfile: 'ada',
        kind: 'note',
        delivery: 'sent',
        onBehalfOfAPerson: false,
      }),
      done('m1'),
    ])
    const [ask, pass, message] = cards(m)
    expect(cards(m).map((card) => card.dataset['tool'])).toEqual([
      'ask_question',
      'pass_question_up',
      'message_agent',
    ])
    expect([who(ask!), who(pass!), text(one(message!, 'outgoing-heading'))]).toEqual([
      'Ayo asked you',
      'Ayo',
      'Ayo',
    ])
    // ⚑ the glyph — the answering side's own `#i-question`, drawn at the heading's size
    for (const card of [ask, pass]) {
      const use = card?.querySelector('[data-cy="question-head"] svg use')
      expect(use?.getAttribute('href')).toBe('#i-question')
      const box = (use?.closest('svg') as SVGElement).getBoundingClientRect()
      expect(box.width).toBeGreaterThanOrEqual(1)
      expect(box.width).toBeLessThanOrEqual(16)
      expect(box.height).toBeGreaterThanOrEqual(1)
      expect(box.height).toBeLessThanOrEqual(16)
    }
    // ⛔ and the message card in the same pane has none
    expect(message?.querySelector('.heading svg')).toBeNull()
    // ⚑ what each one is — the verb in the head (above): *asked*, *passed up to*
    // ⚑ the piece belongs to the ask; a pass names no work of this conversation's
    expect(said(ask!, 'question-piece')).toEqual(['W1.64'])
    expect(inside(pass!, 'question-piece')).toHaveLength(0)
    // ⚑ and the note a pass carried is the pass's alone
    expect(said(pass!, 'question-context')).toEqual(['Added: Tried both.'])
    expect(inside(ask!, 'question-context')).toHaveLength(0)
    // ⛔ the act is the card: no tool row and no run for it
    expect(m.all('tool-entry')).toHaveLength(0)
    expect(m.all('tool-run')).toHaveLength(0)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T2 · each question closes on its own card, in words
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 each question closes on its own card, in words, and none of them says waiting', async () => {
    const prompts = ['First question?', 'Second question?', 'Third question?']
    const events: TranscriptEvent[] = [
      INVENTORY,
      given('work_1', 'W1.1'),
      given('work_2', 'W1.2'),
      given('work_3', 'W1.3'),
    ]
    for (const i of [1, 2, 3]) {
      events.push(
        call(`c${i}`, ASK, { piece: `work_${i}`, who_answers: 'a-person' }),
        asked(`req_${i}`, { piece: `work_${i}`, label: `W1.${i}`, prompt: prompts[i - 1] }),
        done(`c${i}`),
      )
    }
    events.push(
      // ⚑ a call the tool refused: no row of its own, its receipt is the whole story
      call('c4', ASK, { question: 'no piece named', who_answers: 'a-person' }),
      done('c4', 'refused: name the piece you ask about'),
      // ⚠️ both closings come LAST, so neither question is the newest one
      ev({ type: 'question_withdrawn', requestId: 'req_2' }),
      ev({ type: 'question_recipient_ended', requestId: 'req_3', recipient: 'sess_ana' }),
    )
    const m = await pane(events)
    expect(cards(m)).toHaveLength(4)
    expect(cards(m).map((card) => card.dataset['state'])).toEqual([
      'open',
      'withdrawn',
      'not-answered',
      'receipt',
    ])
    // ⚑ **UI-009** — an open question says no state word: the head's *asked* says it.
    expect(cards(m).flatMap((card) => said(card, 'question-state'))).toEqual([
      'withdrawn',
      'not answered · its conversation ended',
    ])
    expect(cards(m).flatMap((card) => said(card, 'question-words'))).toEqual([
      ...prompts,
      'no piece named',
    ])
    // ⚑ the control: the refusal draws its receipt and NO state word
    const refused = cards(m)[3] as HTMLElement
    expect(said(refused, 'question-receipt')).toEqual(['refused: name the piece you ask about'])
    expect(inside(refused, 'question-state')).toHaveLength(0)
    // ⛔ and no card says the answer is awaited — the answer names no question this card can join
    for (const card of cards(m)) expect(text(card)).not.toMatch(/waiting/i)
    // four questions side by side are four cards, never a run of tool rows
    expect(m.all('tool-run')).toHaveLength(0)
    expect(m.all('tool-entry')).toHaveLength(0)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T3 · a call that errored after its question was recorded
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 a call that errored after its question was recorded says failed, in the failure colour, with its receipt', async () => {
    const m = await pane([
      INVENTORY,
      given('work_1', 'W1.1'),
      given('work_2', 'W1.2'),
      call('c1', ASK, { piece: 'work_1', who_answers: 'a-person' }),
      asked('req_1', { piece: 'work_1', label: 'W1.1', prompt: 'One?' }),
      done('c1'),
      call('c2', ASK, { piece: 'work_2', who_answers: 'a-person' }),
      asked('req_2', { piece: 'work_2', label: 'W1.2', prompt: 'Two?' }),
      done('c2', 'The handler threw: no route.', false),
    ])
    const [fine, errored] = cards(m) as [HTMLElement, HTMLElement]
    expect(cards(m)).toHaveLength(2)
    expect(cards(m).flatMap((card) => said(card, 'question-state'))).toEqual(['failed'])
    expect(cards(m).map((card) => card.dataset['state'])).toEqual(['open', 'failed'])
    // ⚑ the failed card still holds its words, and prints what the call answered
    expect(said(errored, 'question-words')).toEqual(['Two?'])
    const receipt = one(errored, 'question-receipt')
    expect(visible(receipt)).toBe(true)
    expect(text(receipt)).toBe('The handler threw: no route.')
    // ⚑ the word wears the receipt's colour, and the control's head does not
    const failedWord = getComputedStyle(one(errored, 'question-state')).color
    const askedHead = getComputedStyle(one(fine, 'question-head')).color
    expect(failedWord).toBe(getComputedStyle(receipt).color)
    expect(failedWord).not.toBe(askedHead)
    // ⚑ the control card: asked, nothing to print
    expect(inside(fine, 'question-receipt')).toHaveLength(0)
    expect(said(fine, 'question-words')).toEqual(['One?'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T4 · a question routed on to a person
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 a question routed on to a person is a person’s, and loses the press to the agent it left', async () => {
    const opened: string[] = []
    const m = await pane(
      [
        INVENTORY,
        given('work_9', 'W1.9'),
        call('c1', ASK, { piece: 'work_9', who_answers: 'an-agent', agent: 'sess_ana' }),
        asked('req_1', { piece: 'work_9', label: 'W1.9', prompt: 'Which table?' }),
        routed('req_1', 'an-agent', 'sess_ana'),
        done('c1'),
        call('c2', ASK, { agent: 'sess_bob', who_answers: 'an-agent' }),
        asked('req_2', { prompt: 'Which column?' }),
        routed('req_2', 'an-agent', 'sess_bob'),
        done('c2'),
        // ⚠️ the LAST row says where it went: req_1, routed again, is a person's now
        routed('req_1', 'a-person'),
      ],
      { onOpenConversation: (id: string) => opened.push(id) },
    )
    const [first, second] = cards(m) as [HTMLElement, HTMLElement]
    expect(cards(m)).toHaveLength(2)
    expect(said(first, 'question-asked-of')).toEqual(['you'])
    expect(inside(first, 'question-where')).toHaveLength(0)
    // ⚑ the control: still routed to an agent, it names it as one and keeps a live press
    expect(said(second, 'question-asked-of')).toEqual([])
    expect(second.querySelector('.exchange-heading')?.textContent).toContain(
      'Ayo → another agent · question',
    )
    expect(m.all('question-where')).toHaveLength(1)
    const press = one(second, 'question-where')
    expect(visible(press)).toBe(true)
    expect(text(press)).toBe('Open the conversation')
    expect(press.dataset['held']).toBe('false')
    press.click()
    await nextTick()
    expect(opened).toEqual(['sess_bob'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T5 · rows that arrive before their calls
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 rows that arrive before their calls still land: where the question went, and that it was withdrawn', async () => {
    const m = await pane([
      INVENTORY,
      given('work_1', 'W1.1'),
      given('work_2', 'W1.2'),
      // ⚑ the host's rows, with no call yet to land on
      asked('req_1', {
        piece: 'work_1',
        label: 'W1.1',
        prompt: 'First?',
        questions: [{ id: 'q1', prompt: 'First?', options: [{ label: 'Yes' }, { label: 'No' }] }],
      }),
      asked('req_2', { piece: 'work_2', label: 'W1.2', prompt: 'Second?' }),
      routed('req_1', 'a-person'),
      ev({ type: 'question_withdrawn', requestId: 'req_2' }),
      // …and then the calls, each claiming the row its own piece names
      call('c1', ASK, { piece: 'work_1', who_answers: 'the-parent' }),
      call('c2', ASK, { piece: 'work_2', who_answers: 'the-parent' }),
      done('c1'),
      done('c2'),
    ])
    const [first, second] = cards(m) as [HTMLElement, HTMLElement]
    expect(cards(m)).toHaveLength(2)
    // ⚑ card 1: the routing that arrived AHEAD says `you` — the call's own `the-parent` would say `its parent`
    expect(first.dataset['state']).toBe('open')
    expect(said(first, 'question-asked-of')).toEqual(['you'])
    expect(said(first, 'question-piece')).toEqual(['W1.1'])
    expect(said(first, 'question-words')).toEqual(['First?'])
    expect(said(first, 'question-option')).toEqual(['Yes', 'No'])
    // ⚑ card 2: withdrawn before its call, and never routed — so the call's own word speaks
    expect(second.dataset['state']).toBe('withdrawn')
    expect(said(second, 'question-state')).toEqual(['withdrawn'])
    expect(said(second, 'question-piece')).toEqual(['W1.2'])
    expect(said(second, 'question-words')).toEqual(['Second?'])
    expect(said(second, 'question-asked-of')).toEqual(['its parent'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T6 · two passes at once
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 two questions passed up at once each take the context they carried, whichever row arrives first', async () => {
    const m = await pane([
      INVENTORY,
      // ⚑ two parallel passes, neither answered yet
      call('pA', PASS, {
        question: 'req_up_A',
        who_answers: 'a-person',
        context: 'Context for A.',
      }),
      call('pB', PASS, {
        question: 'req_up_B',
        who_answers: 'a-person',
        context: 'Context for B.',
      }),
      // ⚠️ B's row arrives FIRST — position alone would give it to A's call
      asked('req_B', {
        passedUpFrom: 'req_up_B',
        prompt: 'Question B?',
        context: 'Context for B.',
      }),
      asked('req_A', {
        passedUpFrom: 'req_up_A',
        prompt: 'Question A?',
        context: 'Context for A.',
      }),
      routed('req_A', 'a-person'),
      routed('req_B', 'a-person'),
      done('pA'),
      done('pB'),
    ])
    expect(cards(m)).toHaveLength(2)
    expect(cards(m).map((card) => card.dataset['tool'])).toEqual([
      'pass_question_up',
      'pass_question_up',
    ])
    expect(cards(m).flatMap((card) => said(card, 'question-words'))).toEqual([
      'Question A?',
      'Question B?',
    ])
    expect(cards(m).flatMap((card) => said(card, 'question-context'))).toEqual([
      'Added: Context for A.',
      'Added: Context for B.',
    ])
    expect(cards(m).map((card) => card.dataset['state'])).toEqual(['open', 'open'])
    expect(cards(m).map(who)).toEqual(['Ayo passed up to you', 'Ayo passed up to you'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T7 · the options are chips a person reads
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('⛔ the options are chips a person reads, not controls — and the press beside them still is one', async () => {
    const opened: string[] = []
    const m = await pane(
      [
        INVENTORY,
        call('c1', ASK, { agent: 'sess_ana', who_answers: 'an-agent' }),
        asked('req_1', {
          prompt: 'Which one?',
          questions: [
            { id: 'q1', prompt: 'Which one?', options: [{ label: 'Tea' }, { label: 'Coffee' }] },
          ],
        }),
        routed('req_1', 'an-agent', 'sess_ana'),
        done('c1'),
      ],
      { onOpenConversation: (id: string) => opened.push(id) },
    )
    const card = cards(m)[0] as HTMLElement
    // ⚑ **UI-009** — asked of another AGENT, so not this person's to answer here: chips.
    const chips = inside(card, 'question-option')
    const options = chips[0]?.parentElement as HTMLElement
    expect(chips.map((chip) => chip.tagName)).toEqual(['LI', 'LI'])
    expect(chips.map(text)).toEqual(['Tea', 'Coffee'])
    for (const chip of chips) {
      expect(visible(chip)).toBe(true)
      expect(Number.parseFloat(getComputedStyle(chip).borderTopWidth)).toBeGreaterThan(0)
      expect(getComputedStyle(chip).cursor).not.toBe('pointer')
    }
    // ⛔ nothing in the list is a control
    expect(options.querySelectorAll('button, a, input, [role="button"], [tabindex]')).toHaveLength(
      0,
    )
    chips[0]?.click()
    await nextTick()
    expect(opened).toEqual([])
    // ⚑ the control: the press in the same card IS pointer-cursored, and emits
    const press = one(card, 'question-where')
    expect(visible(press)).toBe(true)
    expect(getComputedStyle(press).cursor).toBe('pointer')
    press.click()
    await nextTick()
    expect(opened).toEqual(['sess_ana'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T8 · parts
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 a many-part question draws each part’s prompt and options; a free-text one draws no parts box and says its words once', async () => {
    const m = await pane([
      INVENTORY,
      call('c1', ASK, { who_answers: 'a-person' }),
      asked('req_1', {
        prompt: 'Two things before I start.',
        questions: [
          {
            id: 'q1',
            prompt: 'Which database?',
            options: [{ label: 'Postgres' }, { label: 'SQLite' }],
          },
          { id: 'q2', prompt: 'Which region?', options: [{ label: 'eu' }, { label: 'us' }] },
        ],
      }),
      done('c1'),
      call('c2', ASK, { who_answers: 'a-person' }),
      asked('req_2', {
        prompt: 'What should the migration be called?',
        questions: [{ id: 'q1', prompt: 'What should the migration be called?', options: [] }],
      }),
      done('c2'),
      call('c3', ASK, { who_answers: 'a-person' }),
      asked('req_3', {
        prompt: 'Tea or coffee?',
        questions: [
          { id: 'q1', prompt: 'Tea or coffee?', options: [{ label: 'Tea' }, { label: 'Coffee' }] },
        ],
      }),
      done('c3'),
    ])
    expect(cards(m)).toHaveLength(3)
    const [many, free, single] = cards(m) as [HTMLElement, HTMLElement, HTMLElement]
    // ⚑ the many-part question: the words, then each part with its own prompt and chips
    expect(said(many, 'question-words')).toEqual(['Two things before I start.'])
    const parts = [...many.querySelectorAll<HTMLElement>('[data-cy^="question-part-"]')]
    expect(parts).toHaveLength(2)
    expect(parts.map((part) => text(part.querySelector('.ask')))).toEqual([
      'Which database?',
      'Which region?',
    ])
    expect(parts.map((part) => said(part, 'question-option'))).toEqual([
      ['Postgres', 'SQLite'],
      ['eu', 'us'],
    ])
    // ⛔ free text: the one part repeats the words and offers nothing — no box, no second copy
    expect(said(free, 'question-words')).toEqual(['What should the migration be called?'])
    expect(free.querySelectorAll('[data-cy^="question-part-"], .ask')).toHaveLength(0)
    expect(inside(free, 'question-option')).toHaveLength(0)
    expect(inside(free, 'question-box')).toHaveLength(0)
    expect(times(text(free), 'What should the migration be called?')).toBe(1)
    // ⚑ one part that offers chips keeps them, and says its words once
    const box = [...single.querySelectorAll<HTMLElement>('[data-cy^="question-part-"]')]
    expect(box).toHaveLength(1)
    expect(single.querySelectorAll('.ask')).toHaveLength(0)
    expect(said(single, 'question-option')).toEqual(['Tea', 'Coffee'])
    expect(times(text(single), 'Tea or coffee?')).toBe(1)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // T9 · a question cut in its call
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 a question cut in its call says it was cut; one whose row holds the whole of it does not', async () => {
    const LONG1 =
      'Should the orders index be rebuilt concurrently or offline while the nightly load is running? '.repeat(
        4,
      )
    const LONG2 =
      'Please confirm that the archive job may drop the partitions older than ninety days before the export finishes. '
        .repeat(3)
        .trim()
    // ⚠️ both adapters bound a call's arguments at 200 and end a cut one with `…`
    const cut = (args: Record<string, unknown>): string => `${JSON.stringify(args).slice(0, 200)}…`
    const m = await pane([
      INVENTORY,
      given('work_1', 'W1.1'),
      given('work_2', 'W1.2'),
      // ⚑ card 1: cut in its call, and no row to say the whole of it
      ev({
        type: 'tool_call',
        id: 'c1',
        name: ASK,
        summary: cut({ piece: 'work_1', who_answers: 'a-person', question: LONG1 }),
      }),
      // ⚑ card 2: the same cut call, but the host's row recorded the whole
      ev({
        type: 'tool_call',
        id: 'c2',
        name: ASK,
        summary: cut({ piece: 'work_2', who_answers: 'a-person', question: LONG2 }),
      }),
      asked('req_2', { piece: 'work_2', label: 'W1.2', prompt: LONG2 }),
      done('c2'),
    ])
    expect(LONG1.length).toBeGreaterThan(300)
    expect(LONG2.length).toBeGreaterThan(200)
    const [head, whole] = cards(m) as [HTMLElement, HTMLElement]
    expect(cards(m)).toHaveLength(2)
    expect(head.dataset['state']).toBe('asking')
    const said1 = text(one(head, 'question-words'))
    expect(said1.length).toBeGreaterThan(0)
    expect(said1.length).toBeLessThan(LONG1.trim().length)
    expect(LONG1.startsWith(said1)).toBe(true)
    const sentence = one(head, 'question-cut')
    expect(visible(sentence)).toBe(true)
    expect(text(sentence)).toBe('Cut at the size limit — this much of it is shown here.')
    // ⚑ the control: the row's whole words win over the call's cut ones, and nothing says cut
    expect(whole.dataset['state']).toBe('open')
    expect(said(whole, 'question-words')).toEqual([LONG2])
    expect(inside(whole, 'question-cut')).toHaveLength(0)
  })
})
