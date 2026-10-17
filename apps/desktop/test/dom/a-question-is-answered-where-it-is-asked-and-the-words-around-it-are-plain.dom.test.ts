import { expandAgentCards } from './harness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import QuestionCard from '../../src/renderer/src/components/QuestionCard.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { homeAttention } from '../../src/renderer/src/lib/home-attention'
import { usePersonsQueue, type PersonsQueueRow } from '../../src/renderer/src/lib/persons-queue'
import {
  questionInTheConversation,
  type QuestionCardReading,
} from '../../src/renderer/src/lib/question-card'
import {
  applyEvent,
  askedQuestionItemIn,
  createTranscript,
  markAnswerRefused,
  markRequestFailed,
  type ToolItem,
  type TranscriptItem,
  type TranscriptState,
} from '../../src/renderer/src/lib/transcript'
import { foldWindow } from '../../src/renderer/src/lib/transcript-window'
import { usageSays } from '../../src/renderer/src/lib/usage-limit'
import type { AgentState } from '../../src/shared/agent-state'
import type { ProviderCondition } from '../../src/shared/provider-limit'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  escalationChain,
  type AskedQuestion,
  type LedgerWalk,
  type OfferedAnswer,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
} from '../../src/shared/questions'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import type {
  ResumableSessionInfo,
  RuntimeEventMessage,
  TranscriptEvent,
  UnresumableSessionInfo,
  UserInputResponse,
} from '../../src/shared/runtime-ipc'
import { drawnReady, inkRects, lineCount } from './drawn'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * **UI-008 to UI-011, the words around a question and the places it is answered — the half of the
 * stretch the frontend's re-aimed tests do not pin.** The frontend writes no new tests (its rule
 * since 2026-10-01), so what UI-009 built (one card, `QuestionCard`, drawn on the asker's page and on
 * *Waiting on you*), what UI-009 said plainly (a usage limit, the page's intro), what UI-010 stopped
 * saying (a count on *Jump to latest*) and what the rail says when it cannot read its list stand
 * here, each measured where a person meets it.
 *
 *  1. **the rail**: its error line leads with what could not be read, and an open section's chevron
 *     points down where a folded one's does not (the cascade, not a class name);
 *  2. **the card on the asker's page**: a press on a question asked of a person answers it through
 *     the pane, one asked of an agent presses nothing, and the typed words outlive a remount;
 *  3. **the card's own rules**: the box and Enter, one press or several parts, several choices, a
 *     secret part, a part with no id, the in-flight word, and the fold at four lines;
 *  4. **the card on *Waiting on you***: the host's words when an answer is not taken, one press at a
 *     time, a press forgotten with its row, the choices alone where the window holds no words;
 *  5. **the ledger under the card**: a decision settles it, a refusal leaves it open, a closing note
 *     takes its presses away, and the call is found by its request id;
 *  6. **plain words**: a usage limit, and the page's intro for one item and for several;
 *  7. **the pill**: *Jump to latest* is offered to a reader who scrolled up a window that still
 *     holds the tail, a short page does not page back on its own scroll, and lines arriving below a
 *     reader who is no longer following bring the pill.
 *
 * Every negative below is paired with a reading of the same mount one fact over: a card with no box
 * beside the one that has it, a press that goes nowhere beside the one that answers, a pill that is
 * absent at the end beside the same pill after a scroll. A real engine, because a chevron's angle
 * and a clamp's four lines are what the cascade paints, and a scroll position is what a box holds.
 */

/* ------------------------------------------------------------------ shared */

/** A text with its runs of whitespace folded. */
const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

/** One animation frame, which is when a scroll event the engine queued is delivered. */
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i += 1) await frame()
  await nextTick()
}

/** ⚑ The answer a press sent, as plain data — the map is null-prototype. */
const flat = (response: UserInputResponse | undefined): unknown =>
  response?.kind === 'answer' ? { ...response.answers } : response

/** The text a person types into a box, the way the engine delivers it. */
const typeInto = async (box: HTMLElement, text: string): Promise<void> => {
  ;(box as HTMLInputElement | HTMLTextAreaElement).value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

const press = async (el: HTMLElement): Promise<void> => {
  el.click()
  await nextTick()
}

/** A key pressed in a box; the event is returned so its `defaultPrevented` can be read. */
const keydown = (box: HTMLElement, init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  box.dispatchEvent(event)
  return event
}

/** ⚑ This file's own `localStorage`, for the rail's fold (the dom project shares one origin). */
const memoryStorage = (): Storage => {
  const kept = new Map<string, string>()
  return {
    get length() {
      return kept.size
    },
    clear: () => kept.clear(),
    getItem: (key: string) => kept.get(key) ?? null,
    key: (index: number) => [...kept.keys()][index] ?? null,
    removeItem: (key: string) => void kept.delete(key),
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  usePersonsQueue().forget()
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ 1 · the rail */

const NOW = Date.now()
const CWD = '/Users/alex/dev/brobot-2'
const MINUTE = 60_000

/** A conversation the host lists, run as `profileId`, last moved `minutesAgo`. */
const hostRow = (
  sessionId: string,
  profileId: string | null,
  minutesAgo: number,
  state: AgentState = { is: 'idle' },
): ResumableSessionInfo => ({
  sessionId,
  provider: 'claude',
  cwd: CWD,
  status: 'idle',
  state,
  named: null,
  approvalMode: 'ask',
  profileId,
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  lastEnding: 'completed',
  updatedAt: NOW - minutesAgo * MINUTE,
  running: 'not-running',
  ref: { provider: 'claude', sessionId: `thread-${sessionId}`, cwd: CWD, rotation: 0 },
  resumeRefusal: null,
})

const BRO_NEW = hostRow('sess_bro_new', DEFAULT_PROFILE_ID, 1)
const BRO_TYPED = hostRow('sess_bro_typed', 'BroBot', 3, { is: 'needs-you' })
const REVIEWER = hostRow('sess_rev', 'reviewer', 2, { is: 'needs-you' })

type RailApi = {
  runtime: {
    listResumable: () => Promise<ResumableSessionInfo[]>
    listUnresumable: () => Promise<UnresumableSessionInfo[]>
  }
}

/** The rail over what the host answers to *list resumable*, at the width it ships at. */
async function rail(read: () => Promise<ResumableSessionInfo[]>): Promise<Mounted> {
  ;(window as unknown as { api?: RailApi }).api = {
    runtime: { listResumable: read, listUnresumable: () => Promise.resolve([]) },
  }
  const m = mount(
    SideRail,
    { open: [], activeId: null, place: null },
    { width: 251.68, height: 900 },
  )
  await settle()
  return m
}

/** A section header's chevron, turned to degrees by the engine's own computed transform. */
const angleOf = (chevron: Element): number => {
  const value = getComputedStyle(chevron).transform
  const matrix = new DOMMatrix(value === 'none' ? undefined : value)
  return Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI)
}

const chevronOf = (m: Mounted, section: 'brobot' | 'agents'): Element =>
  m.q(`rail-toggle-${section}`).querySelector('.chev')!

describe('the rail says what it could not read, and which sections are open', () => {
  it('🔴 a list that could not be read says what it could not read', async () => {
    const failed = await rail(() => Promise.reject(new Error('the database is locked')))
    const line = failed.q('conversations-error')

    // ⛔ Exactly — three neighbours pin the cause alone, and this is the lead a person reads.
    expect(said(line)).toBe('Could not read the conversations: the database is locked')
    expect(visible(line)).toBe(true)
    expect(failed.q('rail-conversations').contains(line)).toBe(true)
    unmountAll()

    // One fact over: the host answers, rows are drawn and no error line is.
    const read = await rail(() => Promise.resolve([BRO_NEW, REVIEWER]))
    expect(read.all('open-session-sess_bro_new')).toHaveLength(1)
    expect(read.all('open-session-sess_rev')).toHaveLength(1)
    expect(read.all('conversations-error')).toHaveLength(0)
  })

  it('⚑ an open section’s chevron points down and a folded one’s does not', async () => {
    const rows = (): Promise<ResumableSessionInfo[]> =>
      Promise.resolve([BRO_NEW, BRO_TYPED, REVIEWER])

    // (a) A fresh viewer: both sections open. A fresh mount, so no transition is in flight.
    const open = await rail(rows)
    expect(open.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('true')
    expect(angleOf(chevronOf(open, 'brobot'))).toBe(90)
    expect(angleOf(chevronOf(open, 'agents'))).toBe(90)
    unmountAll()

    // (b) The same rows, BroBot's section remembered folded.
    storage.setItem('brobot2.railBroBotOpen', 'false')
    const folded = await rail(rows)
    expect(folded.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('false')
    expect(folded.all('rail-rows-brobot')).toHaveLength(0)
    expect(angleOf(chevronOf(folded, 'brobot'))).toBe(0)
    // ⚑ The other agents' chevron is open in both mounts and reads 90 in both, so the 0 above is
    // BroBot's fold and not a rail whose chevrons never turn.
    expect(folded.q('rail-toggle-agents').getAttribute('aria-expanded')).toBe('true')
    expect(angleOf(chevronOf(folded, 'agents'))).toBe(90)
  })
})

/* ------------------------------------------------------------------ 2 · the card on the page */

const CLAUDE = { prefix: 'mcp__', separator: '__' }
const ASK = 'mcp__brobot__ask_question'
const PASS = 'mcp__brobot__pass_question_up'
const PROMPT = 'Test from Ayo: tea or coffee?'

const inventory = (): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming: CLAUDE,
    declared: {
      server: 'brobot',
      tools: ['ask_question', 'pass_question_up'].map((name) => ({
        name,
        description: '',
        parameters: [],
      })),
    },
    published: null,
  }) as unknown as TranscriptEvent

const call = (id: string, name: string, args: Record<string, unknown> = {}): TranscriptEvent =>
  ({ type: 'tool_call', id, name, summary: JSON.stringify(args) }) as TranscriptEvent

const result = (id: string, summary = 'recorded', ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary, ok }) as TranscriptEvent

/** ⚑ A row that names no piece — a question about none, or one passed up. */
const NO_PIECE = { piece: undefined, label: undefined }

const askedRow = (requestId: string, over: Record<string, unknown> = {}): TranscriptEvent =>
  ({
    type: 'question_asked',
    requestId,
    piece: 'work_64',
    label: 'W1.64',
    prompt: PROMPT,
    questions: [{ id: 'q1', prompt: PROMPT, options: [{ label: 'Tea' }, { label: 'Coffee' }] }],
    ...over,
  }) as TranscriptEvent

const routed = (
  requestId: string,
  to: 'the-parent' | 'a-person' | 'an-agent',
  parent?: string,
): TranscriptEvent =>
  ({
    type: 'request_routed',
    requestId,
    to,
    ...(parent === undefined ? {} : { parent }),
  }) as TranscriptEvent

const choices = (...labels: string[]): { label: string }[] => labels.map((label) => ({ label }))

/** One part of a question as the host's row carries it — the question's own words unless told. */
const partOf = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  prompt: PROMPT,
  options: [],
  ...over,
})

/** ⚑ The question this conversation asked of a person, with these parts — and its call's receipt. */
const ofAPerson = (questions: unknown[], over: Record<string, unknown> = {}): TranscriptEvent[] => [
  inventory(),
  call('c1', ASK, { piece: 'W1.64', who_answers: 'a-person' }),
  askedRow('req_a', { questions, ...over }),
  routed('req_a', 'a-person'),
  result('c1'),
]

/** The question on the asker's own page — `the-question-card-on-the-askers-page`'s fixture. */
const pageEvents = (
  over: { routing?: TranscriptEvent | null; questions?: unknown[]; row?: boolean } = {},
): TranscriptEvent[] => [
  inventory(),
  { type: 'user_turn', text: 'ask the person one question directly' } as TranscriptEvent,
  {
    type: 'work_given',
    piece: 'work_64',
    label: 'W1.2',
    parent: 'work_root',
    givenBy: 'sess_brobot',
    title: 'ask the person one question directly',
    brief: 'ask the person one question directly',
  } as TranscriptEvent,
  call('c1', ASK, { piece: 'work_64', who_answers: 'a-person' }),
  ...(over.row === false
    ? []
    : [
        askedRow('req_a', {
          piece: 'work_64',
          label: 'W1.2',
          ...(over.questions === undefined ? {} : { questions: over.questions }),
        }),
        over.routing === undefined ? routed('req_a', 'a-person') : over.routing,
        result('c1'),
      ]
  ).filter((event): event is TranscriptEvent => event !== null),
]

type Responded = [string, UserInputResponse][]

/**
 * The conversation's page, as the window mounts it.
 *
 * ⚠️ **The record is wrapped in `reactive()` as `session-store` does** — `requestDraft`'s own
 * comment: a non-reactive record never redraws a typed draft.
 */
async function page(
  events: TranscriptEvent[],
  responded: Responded = [],
  over: { record?: ReturnType<typeof record> } = {},
): Promise<Mounted> {
  const held = over.record ?? reactive(record(events))
  const m = mount(
    ConversationPane,
    paneProps({
      record: held,
      onRespond: (id: string, response: UserInputResponse) => responded.push([id, response]),
    }),
    { width: 1200, height: 808 },
  )
  await settle()
  return expandAgentCards(m)
}

describe('a question is answered on the page of the conversation that asked it', () => {
  it('🔴 an option pressed on a question asked of a person answers it through the pane, and one on a question for an agent presses nothing', async () => {
    const responded: Responded = []
    const m = await page(pageEvents(), responded)

    const card = m.q('outgoing')
    const coffee = card.querySelector<HTMLElement>(
      '[data-cy="question-option"][data-option="Coffee"]',
    )
    expect(coffee, 'the card draws no Coffee').not.toBeNull()
    expect(coffee!.tagName).toBe('BUTTON')
    // ⚑ The card says the question, and says no id.
    expect(said(card)).toContain('tea or coffee?')
    coffee!.click()
    await nextTick()

    expect(responded).toHaveLength(1)
    expect(responded[0]![0]).toBe('req_a')
    expect(responded[0]![1].kind).toBe('answer')
    expect(flat(responded[0]![1])).toEqual({ q1: ['Coffee'] })
    expect(said(card)).not.toContain('req_a')
    unmountAll()

    // One fact over: the same question routed to an agent. Its options are chips, and a press on
    // one goes nowhere.
    const toAgent: Responded = []
    const agents = await page(
      pageEvents({ routing: routed('req_a', 'an-agent', 'sess_ana') }),
      toAgent,
    )
    const chips = [
      ...agents.q('outgoing').querySelectorAll<HTMLElement>('[data-cy="question-option"]'),
    ]
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Tea', 'Coffee'])
    for (const chip of chips) expect(chip.tagName).toBe('LI')
    chips[1]!.click()
    await nextTick()
    expect(toAgent).toHaveLength(0)
    unmountAll()

    // …and before its row lands (the call is still running) the card has nothing to press at all.
    const early = await page(pageEvents({ row: false }), [])
    expect(early.q('question-card').getAttribute('data-state')).toBe('asking')
    expect(early.all('question-option')).toHaveLength(0)
  })

  it('⚑ words typed into a question’s box outlive a remount of the pane', async () => {
    const free = pageEvents({ questions: [partOf('q1')] })
    const held = reactive(record(free))
    const first = await page(free, [], { record: held })
    const box = first.q('question-box') as HTMLTextAreaElement
    expect(box.value).toBe('')
    await typeInto(box, 'add_orders')
    expect(box.value).toBe('add_orders')
    first.unmount()

    // ⚑ A new pane over the SAME record: the words are the record's, not the card's.
    const again = await page(free, [], { record: held })
    expect((again.q('question-box') as HTMLTextAreaElement).value).toBe('add_orders')
    again.unmount()

    // One fact over: a pane over a fresh record shows an empty box.
    const fresh = await page(free, [])
    expect((fresh.q('question-box') as HTMLTextAreaElement).value).toBe('')
  })
})

/* ------------------------------------------------------------------ 3 · the card's own rules */

const fold = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const tool = (state: TranscriptState, callId: string): ToolItem => {
  const found = state.items.find(
    (item): item is ToolItem & (typeof state.items)[number] =>
      item.kind === 'tool' && item.callId === callId,
  )
  expect(found, `no tool row for ${callId}`).toBeDefined()
  return found as ToolItem
}

const readingIn = (
  state: TranscriptState,
  callId = 'c1',
  canAnswer = true,
): QuestionCardReading => {
  const item = tool(state, callId)
  const words = item.outgoing
  expect(words, `${callId} is not a card`).toBeDefined()
  if (words?.tool !== 'ask_question' && words?.tool !== 'pass_question_up') {
    throw new Error(`${callId} is not a question`)
  }
  return questionInTheConversation(item, words.tool, words.asked, {
    ownAgent: null,
    identities: null,
    held: null,
    canAnswer,
  })
}

const readingOf = (
  events: readonly TranscriptEvent[],
  canAnswer = true,
  callId = 'c1',
): QuestionCardReading => readingIn(fold(events), callId, canAnswer)

/** The card, mounted on its own at the width a page gives it, with every answer it emits. */
function card(
  reading: QuestionCardReading,
  props: Record<string, unknown> = {},
  width = 420,
): Mounted & { answers: UserInputResponse[] } {
  const answers: UserInputResponse[] = []
  const m = mount(
    QuestionCard,
    { reading, onAnswer: (response: UserInputResponse) => answers.push(response), ...props },
    { width, height: 600 },
  )
  return Object.assign(m, { answers })
}

const optionIn = (scope: ParentNode, label: string): HTMLElement => {
  const found = scope.querySelector<HTMLElement>(
    `[data-cy="question-option"][data-option="${label}"]`,
  )
  expect(found, `no option ${label}`).not.toBeNull()
  return found!
}

const sendOf = (m: Mounted): HTMLButtonElement => m.q('question-send') as HTMLButtonElement

describe('a question asked with no options, one press, several parts and several choices', () => {
  it('🔴 a question asked with no options is answered in its box, Enter sends, Shift+Enter does not, and a blank is never sent', async () => {
    const m = card(readingOf(ofAPerson([partOf('q1')])))
    const box = m.q('question-box') as HTMLTextAreaElement
    expect(box.tagName).toBe('TEXTAREA')
    expect(box.placeholder).toBe('Your answer')
    // ⚑ Send is drawn and dark from the very first read — an empty box is no answer.
    expect(sendOf(m).disabled).toBe(true)
    expect(m.all('question-hint')).toHaveLength(0)

    await typeInto(box, 'add_orders')
    expect(sendOf(m).disabled).toBe(false)

    const enter = keydown(box, { key: 'Enter' })
    expect(m.answers.map(flat)).toEqual([{ q1: ['add_orders'] }])
    expect(enter.defaultPrevented).toBe(true)

    await press(sendOf(m))
    expect(m.answers.map(flat)).toEqual([{ q1: ['add_orders'] }, { q1: ['add_orders'] }])

    // ⚑ Shift+Enter is a new line: nothing is sent and the key is left to the box.
    const newline = keydown(box, { key: 'Enter', shiftKey: true })
    expect(m.answers).toHaveLength(2)
    expect(newline.defaultPrevented).toBe(false)

    // ⛔ A blank is never sent: Send goes dark and Enter emits nothing.
    await typeInto(box, '   ')
    expect(sendOf(m).disabled).toBe(true)
    keydown(box, { key: 'Enter' })
    expect(m.answers).toHaveLength(2)
  })

  it('⚑ beside a one-press question the box is for a person’s own words, and Send comes only once they are typed', async () => {
    const m = card(
      readingOf(ofAPerson([partOf('q1', { options: choices('Yes', 'No'), allowOther: true })])),
    )
    const box = m.q('question-box') as HTMLTextAreaElement
    expect(box.placeholder).toBe('Or answer in your own words')
    expect(m.all('question-send')).toHaveLength(0)

    await press(optionIn(m.host, 'Yes'))
    expect(m.answers.map(flat)).toEqual([{ q1: ['Yes'] }])
    // A one-press question lights nothing: the press answered.
    expect(m.host.querySelectorAll('.option.selected')).toHaveLength(0)

    await typeInto(box, 'Maybe')
    expect(sendOf(m).disabled).toBe(false)
    keydown(box, { key: 'Enter' })
    expect(m.answers.map(flat)).toEqual([{ q1: ['Yes'] }, { q1: ['Maybe'] }])
    unmountAll()

    // One fact over: no `allowOther`, so the card has options and no box, and a press still answers.
    const plain = card(readingOf(ofAPerson([partOf('q1', { options: choices('Yes', 'No') })])))
    expect(plain.all('question-box')).toHaveLength(0)
    expect(plain.all('question-send')).toHaveLength(0)
    expect(optionIn(plain.host, 'No').tagName).toBe('BUTTON')
    await press(optionIn(plain.host, 'No'))
    expect(plain.answers.map(flat)).toEqual([{ q1: ['No'] }])
  })

  it('🔴 a question of several parts is sent once every part is answered, and a pick and a typed answer replace one another', async () => {
    const m = card(
      readingOf(
        ofAPerson(
          [
            partOf('q1', {
              prompt: 'Which database?',
              options: choices('Postgres', 'SQLite'),
              allowOther: true,
            }),
            partOf('q2', { prompt: 'Which region?', options: choices('eu', 'us') }),
          ],
          { prompt: 'Two things before I start.' },
        ),
      ),
    )
    const q1 = m.q('question-part-q1')
    const q2 = m.q('question-part-q2')
    const box = q1.querySelector<HTMLTextAreaElement>('[data-cy="question-box"]')
    expect(box, 'a part that takes an answer off the list draws no box').not.toBeNull()
    expect(box!.placeholder).toBe('Or answer in your own words')
    // ⚑ …and its neighbour, which does not, draws none.
    expect(q2.querySelector('[data-cy="question-box"]')).toBeNull()

    // Nothing is answered: Send is drawn and dark, and the hint says why.
    expect(sendOf(m).disabled).toBe(true)
    expect(said(m.q('question-hint'))).toBe('Answer each part to send.')

    const postgres = optionIn(q1, 'Postgres')
    const sqlite = optionIn(q1, 'SQLite')
    await press(postgres)
    expect(postgres.classList.contains('selected')).toBe(true)
    expect(sqlite.classList.contains('selected')).toBe(false)
    // ⚑ Lit in paint, beside the unlit one; and a staged single pick says it is held.
    expect(getComputedStyle(postgres).backgroundColor).not.toBe(
      getComputedStyle(sqlite).backgroundColor,
    )
    expect(postgres.getAttribute('aria-pressed')).toBe('true')
    expect(sqlite.getAttribute('aria-pressed')).toBe('false')
    expect(sendOf(m).disabled).toBe(true)
    expect(m.all('question-hint')).toHaveLength(1)
    // A press asks nothing yet: nothing was sent.
    expect(m.answers).toHaveLength(0)

    await press(sqlite)
    expect(postgres.classList.contains('selected')).toBe(false)
    expect(sqlite.classList.contains('selected')).toBe(true)

    await press(optionIn(q2, 'eu'))
    expect(sendOf(m).disabled).toBe(false)
    expect(m.all('question-hint')).toHaveLength(0)
    await press(sendOf(m))
    expect(m.answers.map(flat)).toEqual([{ q1: ['SQLite'], q2: ['eu'] }])

    // Typed words replace the pick…
    await typeInto(box!, 'MySQL')
    expect(sqlite.classList.contains('selected')).toBe(false)
    await press(sendOf(m))
    expect(flat(m.answers.at(-1))).toEqual({ q1: ['MySQL'], q2: ['eu'] })

    // …and a pick replaces the typed words, emptying the box.
    await press(postgres)
    expect(box!.value).toBe('')
    await press(sendOf(m))
    expect(flat(m.answers.at(-1))).toEqual({ q1: ['Postgres'], q2: ['eu'] })

    // ⚑ Words equal to an option's label stay the box's: no option is lit and the answer is sent once.
    await typeInto(box!, 'SQLite')
    expect(box!.value).toBe('SQLite')
    expect(sqlite.classList.contains('selected')).toBe(false)
    expect(postgres.classList.contains('selected')).toBe(false)
    await press(sendOf(m))
    expect(flat(m.answers.at(-1))).toEqual({ q1: ['SQLite'], q2: ['eu'] })
    expect(m.answers).toHaveLength(4)
  })

  it('⚑ a part that takes several choices keeps them in the part’s order and sends typed words beside them once', async () => {
    const m = card(
      readingOf(
        ofAPerson([
          partOf('q1', {
            multiSelect: true,
            allowOther: true,
            options: choices('Red', 'Green', 'Blue'),
          }),
        ]),
      ),
    )
    const part = m.q('question-part-q1')
    expect(said(part)).toContain('pick as many as you like')
    expect(sendOf(m).disabled).toBe(true)
    expect(said(m.q('question-hint'))).toBe('Pick at least one to send.')

    const red = optionIn(part, 'Red')
    const blue = optionIn(part, 'Blue')
    await press(blue)
    await press(red)
    expect(red.getAttribute('aria-pressed')).toBe('true')
    expect(blue.getAttribute('aria-pressed')).toBe('true')
    expect(sendOf(m).disabled).toBe(false)
    expect(m.all('question-hint')).toHaveLength(0)
    await press(sendOf(m))
    // ⚑ The part's order, not the order of the presses.
    expect(flat(m.answers.at(-1))).toEqual({ q1: ['Red', 'Blue'] })

    await press(blue)
    expect(blue.getAttribute('aria-pressed')).toBe('false')
    await press(sendOf(m))
    expect(flat(m.answers.at(-1))).toEqual({ q1: ['Red'] })

    // Typed words join the picks…
    const box = part.querySelector<HTMLTextAreaElement>('[data-cy="question-box"]')!
    await typeInto(box, 'Teal')
    await press(sendOf(m))
    expect(flat(m.answers.at(-1))).toEqual({ q1: ['Red', 'Teal'] })
    // …and words that are already a pick are sent once.
    await typeInto(box, 'Red')
    await press(sendOf(m))
    expect(flat(m.answers.at(-1))).toEqual({ q1: ['Red'] })
    expect(m.answers).toHaveLength(4)

    // Nothing picked and nothing typed: Send is dark again and the hint is back.
    await press(red)
    await typeInto(box, '')
    expect(sendOf(m).disabled).toBe(true)
    expect(said(m.q('question-hint'))).toBe('Pick at least one to send.')
    unmountAll()

    // One fact over: the same options on a part that takes one answer answer at once, with no
    // Send and no `aria-pressed` to say a choice was held.
    const single = card(
      readingOf(ofAPerson([partOf('q1', { options: choices('Red', 'Green', 'Blue') })])),
    )
    expect(single.all('question-send')).toHaveLength(0)
    expect(optionIn(single.host, 'Red').getAttribute('aria-pressed')).toBeNull()
    await press(optionIn(single.host, 'Red'))
    expect(single.answers.map(flat)).toEqual([{ q1: ['Red'] }])
  })

  it('⛔ a secret part’s box masks what is typed, and a part with no id offers nothing to press', async () => {
    const secret = card(readingOf(ofAPerson([partOf('q1', { secret: true })])))
    const masked = secret.q('question-box') as HTMLInputElement
    expect(masked.tagName).toBe('INPUT')
    expect(masked.type).toBe('password')
    await typeInto(masked, 'hunter2')
    keydown(masked, { key: 'Enter' })
    expect(secret.answers.map(flat)).toEqual([{ q1: ['hunter2'] }])
    unmountAll()

    // One fact over: the same part, not secret, is a TEXTAREA that shows its words.
    const plain = card(readingOf(ofAPerson([partOf('q1')])))
    expect(plain.q('question-box').tagName).toBe('TEXTAREA')
    unmountAll()

    // A part the host's row gave no id: nothing could file an answer under it, so it is read, not
    // pressed — chips, no box and no Send.
    const noId = readingOf(ofAPerson([{ prompt: PROMPT, options: choices('Yes', 'No') }]))
    expect(noId.answerable).toBe(false)
    const chips = card(noId)
    expect(optionIn(chips.host, 'Yes').tagName).toBe('LI')
    expect(optionIn(chips.host, 'No').tagName).toBe('LI')
    expect(chips.all('question-box')).toHaveLength(0)
    expect(chips.all('question-send')).toHaveLength(0)
    unmountAll()

    // …and the same row with an id draws presses.
    const withId = readingOf(ofAPerson([partOf('q1', { options: choices('Yes', 'No') })]))
    expect(withId.answerable).toBe(true)
    const presses = card(withId)
    expect(optionIn(presses.host, 'Yes').tagName).toBe('BUTTON')
  })

  it('⚑ a question this window has answered says answer sent and goes dark, and reads open again when nothing was sent', async () => {
    const events = ofAPerson(
      [
        partOf('q1', { prompt: 'Which database?', options: choices('Postgres', 'SQLite') }),
        partOf('q2', { prompt: 'Which region?', options: choices('eu', 'us') }),
      ],
      { prompt: 'Two things before I start.' },
    )
    const state = fold(events)
    // The host's words for an answer it did not take, so a card that ignored the in-flight mark
    // would draw them.
    markAnswerRefused(state, 'req_a', 'that answer was not usable')
    const reading = readingIn(state)
    expect(reading.refused).toBe('that answer was not usable')

    const sent = card(reading, {
      draft: reactive({ answers: new Map(), sent: true, answered: true, open: false }),
    })
    expect(sent.q('question-card').getAttribute('data-state')).toBe('sending')
    expect(said(sent.q('question-state'))).toBe('answer sent')
    const dark = sent.all('question-option') as HTMLButtonElement[]
    expect(dark).toHaveLength(4)
    for (const option of dark) expect(option.disabled).toBe(true)
    expect(sendOf(sent).disabled).toBe(true)
    expect(sent.all('question-hint')).toHaveLength(0)
    expect(sent.all('question-refused')).toHaveLength(0)
    unmountAll()

    // One fact over: nothing was sent — the card is open, its presses are live and it says why Send
    // is dark and what the host said.
    const open = card(reading, {
      draft: reactive({ answers: new Map(), sent: false, answered: false, open: false }),
    })
    expect(open.q('question-card').getAttribute('data-state')).toBe('open')
    expect(open.all('question-state')).toHaveLength(0)
    for (const option of open.all('question-option') as HTMLButtonElement[]) {
      expect(option.disabled).toBe(false)
    }
    expect(said(open.q('question-hint'))).toBe('Answer each part to send.')
    expect(said(open.q('question-refused'))).toBe('that answer was not usable')
  })
})

/* ------------------------------------------------------------------ the fold at four lines */

const LONG = Array.from(
  { length: 12 },
  (_, index) =>
    `Sentence ${index + 1} asks which fiscal quarter the imported orders should be filed under.`,
).join(' ')

describe('on the page a long question folds at four lines', () => {
  it('🔴 on the page a long question folds at four lines with more, and a short one, or the conversation’s card, folds nothing', async () => {
    const long = readingOf(ofAPerson([partOf('q1', { prompt: LONG })], { prompt: LONG }))
    const m = card(long, { fold: true })
    await drawnReady()
    await settle()

    const words = m.q('question-words')
    expect(words.getAttribute('data-folded')).toBe('true')
    expect(words.scrollHeight).toBeGreaterThan(words.clientHeight)
    // ⚑ The clamp is four lines: the box is four line-steps tall, the step read off the ink itself.
    const tops = [...new Set(inkRects(words).map((rect) => Math.round(rect.top)))].sort(
      (a, b) => a - b,
    )
    expect(tops.length, 'the words are laid out in fewer than two lines').toBeGreaterThan(1)
    const step = tops[1]! - tops[0]!
    expect(Math.round(words.clientHeight / step)).toBe(4)

    const more = m.q('question-more')
    expect(visible(more)).toBe(true)
    expect(said(more)).toBe('more')
    expect(more.getAttribute('aria-expanded')).toBe('false')

    await press(more)
    await settle()
    expect(words.getAttribute('data-folded')).toBe('false')
    expect(said(more)).toBe('less')
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(words.scrollHeight).toBeLessThanOrEqual(words.clientHeight)
    expect(lineCount(words)).toBeGreaterThan(4)

    await press(more)
    await settle()
    expect(words.getAttribute('data-folded')).toBe('true')
    expect(said(more)).toBe('more')
    unmountAll()

    // One fact over: the same question in the conversation's frame, which does not fold, is never
    // clamped and draws no *more*.
    const framed = card(long)
    await drawnReady()
    await settle()
    const whole = framed.q('question-words')
    expect(whole.getAttribute('data-folded')).toBe('false')
    expect(lineCount(whole)).toBeGreaterThan(4)
    expect(whole.scrollHeight).toBeLessThanOrEqual(whole.clientHeight)
    expect(framed.all('question-more')).toHaveLength(0)
    unmountAll()

    // A short question folds nothing and offers no *more*…
    const short = card(readingOf(ofAPerson([partOf('q1')])), { fold: true })
    await drawnReady()
    await settle()
    expect(short.q('question-words').getAttribute('data-folded')).toBe('true')
    expect(short.all('question-more')).toHaveLength(0)
    unmountAll()

    // …unless a conversation that passed it up added something beside it: then *more* is drawn,
    // and what was added is shown only when it is pressed.
    const passed = readingOf(
      [
        inventory(),
        call('p1', PASS, { question: 'req_x', who_answers: 'a-person', context: 'Tried both.' }),
        askedRow('req_b', {
          ...NO_PIECE,
          passedUpFrom: 'req_x',
          context: 'Tried both.',
          questions: [partOf('q1', { options: choices('Tea', 'Coffee') })],
        }),
        routed('req_b', 'a-person'),
        result('p1'),
      ],
      true,
      'p1',
    )
    const added = card(passed, { fold: true })
    await drawnReady()
    await settle()
    const brief = added.q('question-words')
    expect(brief.scrollHeight).toBeLessThanOrEqual(brief.clientHeight + 1)
    expect(said(added.q('question-more'))).toBe('more')
    expect(added.all('question-context')).toHaveLength(0)
    await press(added.q('question-more'))
    expect(said(added.q('question-context'))).toBe('Added: Tried both.')
  })
})

/* ------------------------------------------------------------------ 4 · the card on the queue */

const QUEUE_NOW = 1_700_000_000_000
const SESSION = 'sess_worker'
const KEY = `${SESSION}:req_1`
const NAME = (id: string): string => (id === SESSION ? 'trip-planning' : id)
const OFFER: OfferedAnswer = { part: 'answer', options: ['The 09:10', 'The 11:40'] }

/** A question this app raised, on the person's list — with the host's offer, or none. */
function queued(
  offered: OfferedAnswer | null,
  words: AskedQuestion | null = null,
): PersonsQuestion {
  const request: RoutedRequest = {
    requestId: 'req_1',
    askedBy: SESSION,
    parent: 'sess_pm',
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at: QUEUE_NOW - 900_000,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const chain = escalationChain(request, () => null)
  return {
    request,
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy: 'this-app',
    offered,
    asked: words,
  }
}

const walked = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: 1,
  rowsUnread: 0,
})

type AnswerDoor = (row: PersonsQueueRow, response: UserInputResponse) => Promise<string | null>

/** The queue's one supply — `null` rows are a look that did not answer. */
function supply(rows: readonly PersonsQuestion[] | null, over: { answer?: AnswerDoor } = {}): void {
  usePersonsQueue().supply(
    rows === null ? null : walked(rows),
    walked<PersonsDecision>([]),
    {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      answeredFromHere: new Set<string>(),
      now: QUEUE_NOW,
      lastLookAnswered: { questions: rows !== null, decisions: true },
    },
    {
      travel: () => {},
      settle: () => {},
      answer: over.answer ?? (async () => null),
      takeOver: () => {},
      open: () => {},
    },
  )
}

const queue = async (
  rows: readonly PersonsQuestion[],
  over: Parameters<typeof supply>[1] = {},
): Promise<Mounted> => {
  supply(rows, over)
  const m = mount(PersonsQueue, {}, { width: 720, height: 420 })
  await settle()
  return m
}

/** The card's options on the row, as a person presses them. */
const optionsOn = (m: Mounted): HTMLButtonElement[] => [
  ...m
    .q(`persons-queue-row-${KEY}`)
    .querySelectorAll<HTMLButtonElement>('button[data-cy="question-option"]'),
]

const REFUSED = 'That answer was not usable.'

describe('a question on Waiting on you is answered on its card', () => {
  it('🔴 the host’s words come back on the queue card when an answer is not taken, and one press is all it lets through', async () => {
    let release: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: { row: PersonsQueueRow; response: UserInputResponse }[] = []
    const m = await queue([queued(OFFER)], {
      answer: async (row, response) => {
        calls.push({ row, response })
        await hold
        return REFUSED
      },
    })
    expect(optionsOn(m).map((option) => option.textContent?.trim())).toEqual([
      'The 09:10',
      'The 11:40',
    ])

    optionsOn(m)[0]!.click()
    await settle()
    // The door was handed the asker's own part, once.
    expect(calls).toHaveLength(1)
    expect(flat(calls[0]!.response)).toEqual({ answer: ['The 09:10'] })
    expect(calls[0]!.row.key).toBe(KEY)
    // While it is in flight the card says so and goes dark.
    expect(said(m.q('question-state'))).toBe('answer sent')
    for (const option of optionsOn(m)) expect(option.disabled).toBe(true)

    // ⛔ One press is all it lets through: a second answer for the same row never reaches the door.
    await usePersonsQueue().answer(calls[0]!.row, calls[0]!.response)
    expect(calls).toHaveLength(1)

    release()
    await settle()
    // ⚑ The host's words, exactly, over a card that is open again.
    expect(said(m.q('question-refused'))).toBe(REFUSED)
    expect(m.q('question-card').getAttribute('data-state')).toBe('open')
    expect(m.all('question-state')).toHaveLength(0)
    for (const option of optionsOn(m)) expect(option.disabled).toBe(false)
    unmountAll()
    usePersonsQueue().forget()

    // One fact over: the host took the answer (`null`), so there are no words to show, and the
    // card stays *answer sent* with its presses dark until the next look.
    const taken = await queue([queued(OFFER)])
    optionsOn(taken)[0]!.click()
    await settle()
    expect(taken.all('question-refused')).toHaveLength(0)
    expect(said(taken.q('question-state'))).toBe('answer sent')
    for (const option of optionsOn(taken)) expect(option.disabled).toBe(true)
  })

  it('⚑ a queue card’s press is forgotten when its row leaves the list, and kept through a look that did not answer', async () => {
    const m = await queue([queued(OFFER)])
    optionsOn(m)[1]!.click()
    await settle()
    expect(said(m.q('question-state'))).toBe('answer sent')

    // A look that did not answer says nothing about the row: the press is kept.
    supply(null)
    await settle()
    supply([queued(OFFER)])
    await settle()
    expect(said(m.q('question-state'))).toBe('answer sent')
    for (const option of optionsOn(m)) expect(option.disabled).toBe(true)

    // A look that answered with no rows takes the row away, and its press with it.
    supply([])
    await settle()
    expect(m.all(`persons-queue-row-${KEY}`)).toHaveLength(0)
    supply([queued(OFFER)])
    await settle()
    expect(m.q('question-card').getAttribute('data-state')).toBe('open')
    expect(m.all('question-state')).toHaveLength(0)
    for (const option of optionsOn(m)) expect(option.disabled).toBe(false)
  })

  it('⛔ where the list carries no words the queue card shows the choices and no box, and where it carries them it says whether it was passed up', async () => {
    const withoutWords = await queue([queued(OFFER)])
    expect(optionsOn(withoutWords)).toHaveLength(2)
    expect(withoutWords.all('question-box')).toHaveLength(0)
    expect(withoutWords.all('question-send')).toHaveLength(0)
    expect(said(withoutWords.q('question-not-here'))).toBe(
      'BroCrew couldn’t find the question’s words. Open the asking conversation to read them.',
    )
    unmountAll()
    usePersonsQueue().forget()

    // D-046 · the words on the person's list: a free-form question, and a box to answer it in.
    const FREE_FORM: AskedQuestion = {
      prompt: 'which train?',
      context: null,
      passedUp: false,
      parts: [{ id: 'answer', prompt: 'which train?', options: [] }],
    }
    const asked = await queue([queued(null, FREE_FORM)])
    const box = asked.q('question-box') as HTMLTextAreaElement
    expect(box.placeholder).toBe('Your answer')
    expect(said(asked.q('question-words'))).toBe('which train?')
    expect(asked.all('question-not-here')).toHaveLength(0)
    expect(said(asked.q('question-head').querySelector('.who')!)).toBe('trip-planning asked you')
    unmountAll()
    usePersonsQueue().forget()

    // …and the same words, passed up from another question, say so.
    const passed = await queue([queued(null, { ...FREE_FORM, passedUp: true })])
    expect(passed.all('question-box')).toHaveLength(1)
    expect(said(passed.q('question-head').querySelector('.who')!)).toBe(
      'trip-planning passed up to you',
    )
  })
})

/* ------------------------------------------------------------------ 5 · the ledger under the card */

/** Two questions asked in one conversation, each on its own call. */
const twoQuestions = (): TranscriptEvent[] => [
  inventory(),
  call('c1', ASK, { piece: 'W1.64', who_answers: 'a-person' }),
  askedRow('req_a'),
  routed('req_a', 'a-person'),
  result('c1'),
  call('c2', ASK, { piece: 'W1.65', who_answers: 'a-person' }),
  askedRow('req_b', { piece: 'work_65', label: 'W1.65' }),
  routed('req_b', 'a-person'),
  result('c2'),
]

describe('what the asker’s ledger says settles the card', () => {
  it('🔴 a decision in the asker’s ledger settles the card, a refusal leaves it open under the host’s words, and a closing note takes its presses away', async () => {
    const state = fold(twoQuestions())

    // Open: live presses.
    const open = readingIn(state)
    expect(open.state).toBe('open')
    expect(open.answerable).toBe(true)
    const first = card(open)
    expect(first.q('question-card').getAttribute('data-state')).toBe('open')
    expect(optionIn(first.host, 'Tea').tagName).toBe('BUTTON')
    expect(first.all('question-refused')).toHaveLength(0)
    unmountAll()

    // The host did not take an answer: still open, under its words, presses live.
    markAnswerRefused(state, 'req_a', 'that answer was not usable')
    const refused = readingIn(state)
    expect(refused.refused).toBe('that answer was not usable')
    expect(refused.state).toBe('open')
    const second = card(refused)
    expect(said(second.q('question-refused'))).toBe('that answer was not usable')
    expect(second.q('question-card').getAttribute('data-state')).toBe('open')
    expect(optionIn(second.host, 'Tea').tagName).toBe('BUTTON')
    expect((optionIn(second.host, 'Tea') as HTMLButtonElement).disabled).toBe(false)
    unmountAll()

    // A person's decision lands in the asker's ledger: answered, said by whom, the refusal gone.
    applyEvent(state, {
      type: 'user_decision',
      requestId: 'req_a',
      outcome: 'answered',
      by: { who: 'a-person' },
    } as TranscriptEvent)
    const answered = readingIn(state)
    expect(answered.state).toBe('answered')
    expect(answered.answeredBy).toBe('by a person')
    expect(answered.refused).toBeNull()
    const third = card(answered)
    expect(third.q('question-card').getAttribute('data-state')).toBe('answered')
    expect(said(third.q('question-state'))).toBe('answered')
    expect(said(third.q('question-answered'))).toBe('by a person')
    expect(optionIn(third.host, 'Tea').tagName).toBe('LI')
    expect(third.all('question-refused')).toHaveLength(0)
    unmountAll()

    // ⚑ The other question, in the same fold, is untouched.
    expect(readingIn(state, 'c2').state).toBe('open')
    expect(readingIn(state, 'c2').answeredBy).toBeNull()

    // A decision that rejected it: declined.
    const rejected = fold(twoQuestions())
    applyEvent(rejected, {
      type: 'user_decision',
      requestId: 'req_a',
      outcome: 'rejected',
      by: { who: 'a-person' },
    } as TranscriptEvent)
    expect(readingIn(rejected).state).toBe('declined')

    // The host closed it on an answer from here: its words are the note, the refusal is cleared and
    // the presses are gone.
    const closed = fold(twoQuestions())
    markAnswerRefused(closed, 'req_a', 'that answer was not usable')
    markRequestFailed(closed, 'req_a', 'the agent is no longer waiting')
    const note = readingIn(closed)
    expect(note.state).toBe('closed')
    expect(note.note).toBe('the agent is no longer waiting')
    expect(note.refused).toBeNull()
    const fourth = card(note)
    expect(said(fourth.q('question-note'))).toBe('the agent is no longer waiting')
    expect(optionIn(fourth.host, 'Tea').tagName).toBe('LI')
    expect(fourth.all('question-state')).toHaveLength(0)
    expect(fourth.all('question-refused')).toHaveLength(0)
    expect(readingIn(closed, 'c2').state).toBe('open')
  })

  it('⚑ the call whose card carries a question is found by its request id, and not before its row lands', () => {
    const state = fold(twoQuestions())
    const one = tool(state, 'c1').id
    const two = tool(state, 'c2').id
    expect(one).not.toBe(two)
    // The same fold, two ids, two different calls: neither the first nor the newest wins by position.
    expect(askedQuestionItemIn(state, 'req_a')).toBe(one)
    expect(askedQuestionItemIn(state, 'req_b')).toBe(two)
    expect(askedQuestionItemIn(state, 'req_unknown')).toBeUndefined()

    // A row that lands ahead of its call is on no card yet.
    const ahead = fold([inventory(), askedRow('req_c', { piece: 'work_3', label: 'W1.3' })])
    expect(askedQuestionItemIn(ahead, 'req_c')).toBeUndefined()
    applyEvent(ahead, call('c3', ASK, { piece: 'W1.3', who_answers: 'a-person' }))
    expect(askedQuestionItemIn(ahead, 'req_c')).toBe(tool(ahead, 'c3').id)
  })
})

/* ------------------------------------------------------------------ 6 · plain words */

/** A day a person reads — local-time constructors, so a same-day arm is timezone-proof. */
const at = (day: number, hour: number): number => new Date(2026, 9, day, hour, 0).getTime()

const CLAUDE_WEEK =
  'claude is approaching its rate limit (seven_day); resets 2026-10-07T11:00:00.000Z'
const CLAUDE_FIVE_HOURS = 'claude is rate-limited (five_hour); resets 2026-10-01T14:00:00.000Z'
const CLAUDE_OPUS =
  'claude is approaching its rate limit (seven_day_opus); resets 2026-10-07T11:00:00.000Z'

const limit = (
  said: string[],
  over: Partial<Pick<ProviderCondition, 'provider' | 'standing' | 'resetsAt'>> = {},
): ProviderCondition => ({
  key: over.provider ?? 'claude',
  provider: 'claude',
  standing: 'about-to-stop',
  says: '',
  said,
  resetsAt: at(7, 11),
  ...over,
})

const codex = (window: string): string =>
  `codex is approaching its rate limit — 99% of ${window} used; resets 2026-10-07T11:00:00.000Z`

describe('a usage limit is said in a person’s words', () => {
  const NOW_AT = at(1, 9)

  it('🔴 a usage limit is said in a person’s words — how near, which limits, when it resets', () => {
    // ⚑ The reset is said relative to now: six days and two hours ahead is six days.
    const reset = '6 days'
    // How near: the provider's own standing, said two ways for the same line.
    expect(usageSays(limit([CLAUDE_WEEK]), NOW_AT)).toBe(
      `Claude is near its weekly limit; it resets in ${reset}.`,
    )
    expect(usageSays(limit([CLAUDE_FIVE_HOURS], { standing: 'stopped' }), NOW_AT)).toBe(
      `Claude has reached its 5-hour limit; it resets in ${reset}.`,
    )
    expect(usageSays(limit([CLAUDE_WEEK], { standing: 'stopped' }), NOW_AT)).toBe(
      `Claude has reached its weekly limit; it resets in ${reset}.`,
    )

    // Which limits: each named once, in the order the provider said them.
    expect(usageSays(limit([CLAUDE_FIVE_HOURS, CLAUDE_WEEK]), NOW_AT)).toBe(
      `Claude is near its 5-hour and weekly limits; it resets in ${reset}.`,
    )
    expect(usageSays(limit([CLAUDE_FIVE_HOURS, CLAUDE_WEEK, CLAUDE_OPUS]), NOW_AT)).toBe(
      `Claude is near its 5-hour, weekly and weekly Opus limits; it resets in ${reset}.`,
    )
    expect(usageSays(limit([CLAUDE_WEEK, CLAUDE_WEEK]), NOW_AT)).toBe(
      `Claude is near its weekly limit; it resets in ${reset}.`,
    )

    // Codex says a duration, and the window is put in a person's words — with how much of it is
    // used, which its line says (F096).
    const named = (window: string): string =>
      usageSays(limit([codex(window)], { provider: 'codex' }), NOW_AT)
    expect(named('a 7-day window')).toBe(
      `Codex is near its weekly limit (99% used); it resets in ${reset}.`,
    )
    expect(named('a 1-day window')).toBe(
      `Codex is near its daily limit (99% used); it resets in ${reset}.`,
    )
    expect(named('a 3-day window')).toBe(
      `Codex is near its 3-day limit (99% used); it resets in ${reset}.`,
    )
    expect(named('a 5-hour window')).toBe(
      `Codex is near its 5-hour limit (99% used); it resets in ${reset}.`,
    )

    // How much is used (F096): the most any line says of a limit, beside that limit only.
    const claudeWeekAt = (used: number): string =>
      `claude is approaching its rate limit (seven_day) — ${String(used)}% used; resets 2026-10-07T11:00:00.000Z`
    expect(usageSays(limit([claudeWeekAt(92), claudeWeekAt(96)]), NOW_AT)).toBe(
      `Claude is near its weekly limit (96% used); it resets in ${reset}.`,
    )
    expect(usageSays(limit([CLAUDE_FIVE_HOURS, claudeWeekAt(96)]), NOW_AT)).toBe(
      `Claude is near its 5-hour and weekly (96% used) limits; it resets in ${reset}.`,
    )

    // A line that names no window names no limit.
    expect(usageSays(limit(['claude is approaching its rate limit']), NOW_AT)).toBe(
      `Claude is near a usage limit; it resets in ${reset}.`,
    )

    // When it resets: a provider that did not say…
    expect(usageSays(limit([CLAUDE_WEEK], { resetsAt: null }), NOW_AT)).toBe(
      'Claude is near its weekly limit; it hasn’t said when it resets.',
    )
    // …hours under a day, days from a day up; the exact moment is on the sentence's title.
    expect(usageSays(limit([CLAUDE_WEEK], { resetsAt: at(1, 16) }), NOW_AT)).toBe(
      'Claude is near its weekly limit; it resets in 7 h.',
    )
    expect(usageSays(limit([CLAUDE_WEEK], { resetsAt: at(8, 16) }), NOW_AT)).toBe(
      'Claude is near its weekly limit; it resets in 7 days.',
    )
  })

  it('⚑ the intro says is for one item and are for several', () => {
    const intro = (onlyYou: number): string => homeAttention({ requests: [], onlyYou }).intro
    expect(intro(1)).toBe('1 item below is waiting on you.')
    expect(intro(2)).toBe('2 items below are waiting on you.')
    expect(intro(3)).toBe('3 items below are waiting on you.')
    // One fact over: nothing waiting is the quiet intro, not a plural.
    expect(intro(0)).toBe('Nothing here is blocked on an answer from you.')
  })
})

/* ------------------------------------------------------------------ 7 · Jump to latest */

const AT = 1_700_000_000_000

function message(ordinal: number): RuntimeEventMessage {
  return {
    sessionId: 'sess_1',
    ordinal,
    at: AT + ordinal,
    event: {
      type: 'assistant_message',
      text: `line ${String(ordinal).padStart(6, '0')} — ${'the quick brown fox jumps. '.repeat(3)}`,
    } as TranscriptEvent,
  } as RuntimeEventMessage
}

const run = (from: number, count: number): RuntimeEventMessage[] =>
  Array.from({ length: count }, (_, index) => message(from + index))

interface Reader {
  box: () => HTMLElement
  /** The bar's button if it is on screen, or null — `q()` throws, and absence is the subject here. */
  jump: () => HTMLElement | null
  older: () => HTMLElement | null
  jumps: () => number
  loads: () => number
  /** Lines arrive below the reader. */
  grow: (count: number) => Promise<void>
}

/** How far the box's end is from the reader, in px. */
const away = (box: HTMLElement): number => box.scrollHeight - box.scrollTop - box.clientHeight

/**
 * A transcript over a window that holds the tail, as `eleven-hours` builds one — with the loads it
 * was asked for counted, and the lines it draws growable by the test.
 */
function reader(options: { rows: number; hasOlder: boolean }): Reader {
  const events = ref<RuntimeEventMessage[]>(run(0, options.rows))
  const items = ref<TranscriptItem[]>(foldWindow(events.value).items)
  let jumps = 0
  let loads = 0
  const Host = defineComponent({
    name: 'ReaderHost',
    setup() {
      return () =>
        h(TranscriptView as Component, {
          items: items.value,
          mode: 'normal',
          hasOlder: options.hasOlder,
          turnAligned: true,
          loadOlder: options.hasOlder
            ? async () => {
                loads += 1
              }
            : undefined,
          atTail: true,
          jumpToLatest: async () => {
            jumps += 1
          },
        })
    },
  })
  const view = mount(Host, {}, { width: 900, height: 400 })
  const one = (cy: string): HTMLElement | null => view.all(cy)[0] ?? null
  return {
    box: () => view.q('transcript'),
    jump: () => one('jump-to-latest'),
    older: () => one('load-older'),
    jumps: () => jumps,
    loads: () => loads,
    grow: async (count) => {
      events.value = run(0, events.value.length + count)
      items.value = foldWindow(events.value).items
      await nextTick()
    },
  }
}

/** The reader scrolls up to the first line, and the engine says so. */
const scrollToTop = async (box: HTMLElement): Promise<void> => {
  box.scrollTop = 0
  box.dispatchEvent(new Event('scroll'))
  await nextTick()
}

/**
 * ⚑ **Eight rows in a 400px box**, measured on this engine: 223px of overflow with *Load earlier
 * messages* above them, so a reader pinned to the end sits 223px down — past the follow's 40px, and
 * inside the 400px band in which a scroll asks for older history.
 */
const SHORT_PAGE = 8

describe('Jump to latest is offered where the newest line is out of view', () => {
  it('🔴 a reader who scrolled up a window that still holds the tail is offered Jump to latest', async () => {
    const s = reader({ rows: 40, hasOlder: false })
    const box = s.box()
    // The premise, read on this mount: it overflows, and the newest line is on screen.
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight)
    expect(away(box)).toBeLessThanOrEqual(1)
    expect(s.jump(), 'the bar is offered over a newest line that is in view').toBeNull()

    // The reader scrolls up: the window still holds the tail, and the newest line is out of view.
    await scrollToTop(box)
    expect(s.jump(), 'a reader who scrolled up has no way back').not.toBeNull()
    expect(s.jump()!.textContent?.trim()).toBe('Jump to latest')

    s.jump()!.click()
    await nextTick()
    await frames(2)
    // The press ran, put the reader at the end again, and the bar went.
    expect(s.jumps()).toBe(1)
    expect(away(box)).toBeLessThanOrEqual(1)
    expect(s.jump(), 'the bar outlived a reader back at the end').toBeNull()
  })

  it('🔴 a short page does not page back on its own scroll while its newest line is in view', async () => {
    const s = reader({ rows: SHORT_PAGE, hasOlder: true })
    const box = s.box()
    await frames(2)
    // ⚑ The premise, read on this mount: the page overflows its box by more than the follow's
    // 40px, and by less than the 400px band in which a scroll asks for older history — so the
    // follow's own scroll is inside the band while the newest line is on screen.
    const overflow = box.scrollHeight - box.clientHeight
    expect(overflow, 'the page does not overflow the follow’s threshold').toBeGreaterThanOrEqual(60)
    expect(overflow, 'the page is taller than the fetch band').toBeLessThanOrEqual(300)
    expect(away(box)).toBeLessThanOrEqual(1)
    expect(s.older(), 'a window with older history offers no way to ask for it').not.toBeNull()

    box.dispatchEvent(new Event('scroll'))
    await frames(2)
    expect(s.loads(), 'a scroll at the end asked for older history').toBe(0)

    // ⚑ The button still asks: a reader at the end who wants the beginning presses for it.
    s.older()!.click()
    await frames(2)
    expect(s.loads()).toBe(1)
    unmountAll()

    // One fact over: the same page, scrolled up to the top, is a reader asking for the beginning.
    const up = reader({ rows: SHORT_PAGE, hasOlder: true })
    await frames(2)
    expect(up.loads()).toBe(0)
    up.box().scrollTop = 0
    await frames(2)
    expect(up.loads()).toBe(1)
  })

  it('⚑ the pill appears when lines arrive below a reader who is no longer following', async () => {
    const s = reader({ rows: SHORT_PAGE, hasOlder: true })
    const box = s.box()
    await frames(2)
    expect(away(box)).toBeLessThanOrEqual(1)
    expect(s.jump(), 'the bar is offered over a newest line that is in view').toBeNull()

    // Pressing *Load earlier messages* is the reader saying they are not following the end; nothing
    // is prepended here, so the newest line is still in view.
    s.older()!.click()
    await frames(2)
    expect(s.loads()).toBe(1)
    expect(away(box)).toBeLessThanOrEqual(1)
    expect(s.jump()).toBeNull()

    // Lines arrive below them. No scroll event fires, and the end has left the view.
    await s.grow(4)
    await frames(2)
    expect(away(box)).toBeGreaterThan(40)
    expect(
      s.jump(),
      'lines arrived below a reader who is not following and no bar came',
    ).not.toBeNull()
    expect(s.jump()!.textContent?.trim()).toBe('Jump to latest')
    unmountAll()

    // One fact over: a reader who is following has the same lines arrive and stays pinned at the end.
    const following = reader({ rows: SHORT_PAGE, hasOlder: true })
    await frames(2)
    await following.grow(4)
    await frames(2)
    expect(away(following.box())).toBeLessThanOrEqual(1)
    expect(following.jump()).toBeNull()
  })
})
