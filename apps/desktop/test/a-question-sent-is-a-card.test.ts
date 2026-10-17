import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { joinsARun } from '../src/renderer/src/lib/tool-runs'
import {
  A_PERSON_ADDRESSED,
  AN_UNNAMED_PARENT,
  AN_UNNAMED_RECIPIENT,
} from '../src/renderer/src/lib/outgoing-card'
// ⚑ **UI-009 · the question's card is `QuestionCard`'s reading** — `question-card.ts`, the one the
// conversation and *Waiting on you* both draw.
import {
  ASKED_WORD,
  NOBODY_NAMED_YET,
  PASSED_UP_WORD,
  QUESTION_STATE_WORD,
  questionInTheConversation,
  type QuestionCardReading,
} from '../src/renderer/src/lib/question-card'
import type { AgentIdentity, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 A question this conversation sent, drawn as a card
 *
 * `mcp__brobot__ask_question` and `mcp__brobot__pass_question_up` draw dedicated question
 * cards instead of bare tool rows.
 *
 * ⚑ **`658`'s card, one act over**: the call is recognised by the names this session was handed, the
 * host's `question_asked` lands on it (paired by the call's own `piece`, or `question` for a pass),
 * `request_routed` says where it went, and a withdrawal or a recipient's ending closes it.
 *
 * | § | subject | ⚑ control |
 * |---|---|---|
 * | 1 | both tools are recognised and leave the tool run | a session never told its tools' names |
 * | 2 | the question lands on the call that asked it, and moves as its rows arrive | a provider's own card keeps its routing |
 * | 3 | the card's words: to whom, the piece, the question and its options | nothing is named that no row says |
 * | 4 | replay is a trust boundary | a malformed row draws less, never crashes |
 */

const CLAUDE = { prefix: 'mcp__', separator: '__' }
const CODEX = { prefix: '', separator: '__' }

const inventory = (
  naming = CLAUDE,
  tools = ['ask_question', 'pass_question_up'],
): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming,
    declared: {
      server: 'brobot',
      tools: tools.map((name) => ({ name, description: '', parameters: [] })),
    },
    published: null,
  }) as unknown as TranscriptEvent

const call = (id: string, name: string, args: Record<string, unknown> = {}): TranscriptEvent =>
  ({ type: 'tool_call', id, name, summary: JSON.stringify(args) }) as TranscriptEvent

const result = (id: string, summary = 'recorded', ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary, ok }) as TranscriptEvent

/**
 * ⚑ **D-016 · a piece given to this conversation by `sess_parent`** — the brief (a turn relayed from
 * the giver, naming its identity) and the owner's `work_given` row (naming its conversation).
 */
const given = (piece: string, label: string, profile: string | null): TranscriptEvent[] => [
  {
    type: 'user_turn',
    text: 'the brief',
    relayedFrom: 'sess_parent',
    relayedFromProfile: profile,
    piece,
    label,
  } as TranscriptEvent,
  {
    type: 'work_given',
    piece,
    label,
    parent: 'work_root',
    givenBy: 'sess_parent',
    title: 'the work',
    brief: 'the brief',
  } as TranscriptEvent,
]

/** ⚑ A row that names no piece — a question about none, or one passed up. */
const NO_PIECE = { piece: undefined, label: undefined }

const asked = (requestId: string, over: Record<string, unknown> = {}): TranscriptEvent =>
  ({
    type: 'question_asked',
    requestId,
    piece: 'work_64',
    label: 'W1.64',
    prompt: 'Test from Ayo: tea or coffee?',
    questions: [
      {
        id: 'q1',
        prompt: 'Test from Ayo: tea or coffee?',
        options: [{ label: 'Tea' }, { label: 'Coffee' }],
      },
    ],
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

const ident = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

const IDS = [ident('brobot', 'BroBot'), ident('ana', 'Ana')]

/** ⚑ `held` is what this window runs — a card handed none draws no press, as a work report does. */
const cardOf = (
  state: TranscriptState,
  callId: string,
  held: ReadonlySet<string> | null = null,
): QuestionCardReading => {
  const item = tool(state, callId)
  const words = item.outgoing
  expect(words, `${callId} is not a card`).toBeDefined()
  if (words?.tool !== 'ask_question' && words?.tool !== 'pass_question_up') {
    throw new Error(`${callId} is not a question`)
  }
  return questionInTheConversation(item, words.tool, words.asked, {
    ownAgent: null,
    identities: IDS,
    held,
    canAnswer: false,
  })
}

const ASK = 'mcp__brobot__ask_question'
const PASS = 'mcp__brobot__pass_question_up'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · recognition
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the two question tools are recognised', () => {
  it('🔴 Claude’s spelling and Codex’s, through the inventory — and neither joins a tool run', () => {
    const claude = fold([inventory(), call('c1', ASK), call('c2', PASS)])
    expect(tool(claude, 'c1').outgoing?.tool).toBe('ask_question')
    expect(tool(claude, 'c2').outgoing?.tool).toBe('pass_question_up')
    expect(joinsARun(tool(claude, 'c1'))).toBe(false)
    const codex = fold([
      inventory(CODEX),
      call('c1', 'brobot__ask_question'),
      call('c2', 'brobot__pass_question_up'),
    ])
    expect(tool(codex, 'c1').outgoing?.tool).toBe('ask_question')
    expect(tool(codex, 'c2').outgoing?.tool).toBe('pass_question_up')
  })

  it('⛔ THE CONTROL — a session never told its tools’ names draws the tool row it always drew', () => {
    const untold = fold([call('c1', ASK)])
    expect(tool(untold, 'c1').outgoing).toBeUndefined()
    // ⚑ And a tool this session was not declared is not ours, whatever its name says.
    const undeclared = fold([inventory(CLAUDE, ['pass_question_up']), call('c1', ASK)])
    expect(tool(undeclared, 'c1').outgoing).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · landing and moving
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the question lands on its call and moves with its rows', () => {
  it('🔴 the call its own piece names takes the row — and a pass is paired by the question it carries', () => {
    const state = fold([
      inventory(),
      call('c1', ASK, { piece: 'W1.1', question: 'one?' }),
      call('c2', ASK, { piece: 'W1.64', question: 'tea or coffee?' }),
      asked('req_a'),
      call('p1', PASS, { question: 'req_elsewhere' }),
      asked('req_b', {
        ...NO_PIECE,
        passedUpFrom: 'req_elsewhere',
        context: 'I tried both.',
      }),
    ])
    const two = tool(state, 'c2').outgoing
    expect(two?.tool === 'ask_question' ? two.asked?.requestId : null).toBe('req_a')
    const one = tool(state, 'c1').outgoing
    expect(one?.tool === 'ask_question' ? one.asked : 'not a question').toBeNull()
    const pass = tool(state, 'p1').outgoing
    expect(pass?.tool === 'pass_question_up' ? pass.asked?.context : null).toBe('I tried both.')
  })

  it('🔴 routing names where it went; a withdrawal and a recipient’s ending close it', () => {
    const state = fold([
      inventory(),
      ...given('work_64', 'W1.64', 'brobot'),
      call('c1', ASK, { piece: 'W1.64' }),
      asked('req_a'),
      routed('req_a', 'the-parent', 'sess_parent'),
      result('c1'),
    ])
    expect(cardOf(state, 'c1').state).toBe('open')
    expect(cardOf(state, 'c1').askedOf).toBe('BroBot')
    applyEvent(state, { type: 'question_withdrawn', requestId: 'req_a' } as TranscriptEvent)
    expect(cardOf(state, 'c1').state).toBe('withdrawn')
    const ended = fold([
      inventory(),
      call('c1', ASK, { piece: 'W1.64' }),
      asked('req_a'),
      routed('req_a', 'an-agent', 'sess_ana'),
      result('c1'),
      {
        type: 'question_recipient_ended',
        requestId: 'req_a',
        recipient: 'sess_ana',
      } as TranscriptEvent,
    ])
    expect(cardOf(ended, 'c1').state).toBe('not-answered')
    expect(QUESTION_STATE_WORD['not-answered']).toBe('not answered · its conversation ended')
  })

  it('⛔ THE CONTROL — a provider’s own card keeps its routing, and no question card claims it', () => {
    const state = fold([
      inventory(),
      call('c1', ASK, { piece: 'W1.64' }),
      asked('req_a'),
      {
        type: 'user_input_request',
        id: 'number:3',
        prompt: 'Which?',
        questions: [],
      } as TranscriptEvent,
      routed('number:3', 'the-parent', 'sess_parent'),
    ])
    const card = state.items.find((item) => item.kind === 'userInput')
    expect(card?.kind === 'userInput' ? card.routedTo : null).toBe('sess_parent')
    const words = tool(state, 'c1').outgoing
    expect(words?.tool === 'ask_question' ? words.asked?.to : 'not a question').toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the card's words
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · what the card says', () => {
  it('🔴 the person’s case — to you, about W1.64, the question once and its two options', () => {
    const state = fold([
      inventory(),
      ...given('work_64', 'W1.64', 'brobot'),
      call('c1', ASK, { piece: 'W1.64', who_answers: 'a-person' }),
      asked('req_a'),
      routed('req_a', 'a-person'),
      result('c1'),
    ])
    const card = cardOf(state, 'c1')
    expect(card.askedOf).toBe(A_PERSON_ADDRESSED)
    expect(card.verb).toBe(ASKED_WORD)
    expect(card.piece).toBe('W1.64')
    expect(card.words).toBe('Test from Ayo: tea or coffee?')
    // ⚑ The one part repeats the words, so it is not said twice — only its options are drawn.
    expect(
      card.parts.map((part) => [part.id, part.prompt, part.options.map((o) => o.label)]),
    ).toEqual([['q1', null, ['Tea', 'Coffee']]])
    expect(card.receipt).toBeNull()
    expect(card.where).toBeNull()
  })

  it('🔴 each recipient in its own words, and the press to the conversation that answers', () => {
    const toAgent = fold([
      inventory(),
      call('c1', ASK, { agent: 'sess_ana', who_answers: 'an-agent' }),
      asked('req_a', NO_PIECE),
      routed('req_a', 'an-agent', 'sess_ana'),
    ])
    expect(cardOf(toAgent, 'c1').askedOf).toBe(AN_UNNAMED_RECIPIENT)
    expect(cardOf(toAgent, 'c1', new Set()).where?.conversation).toBe('sess_ana')
    expect(cardOf(toAgent, 'c1').piece).toBeNull()
    // ⚑ The parent, where this ledger holds no give naming it: the tool's own noun — and a piece
    // whose row carries no label is *Piece*, never a label guessed.
    const unnamed = fold([
      inventory(),
      call('c1', ASK, { piece: 'work_9' }),
      asked('req_a', { piece: 'work_9', label: undefined }),
      routed('req_a', 'the-parent', 'sess_parent'),
    ])
    expect(cardOf(unnamed, 'c1').askedOf).toBe(AN_UNNAMED_PARENT)
    expect(cardOf(unnamed, 'c1').piece).toBe('Piece')
    const passed = fold([
      inventory(),
      call('p1', PASS, { question: 'req_x', who_answers: 'a-person', context: 'I tried both.' }),
      asked('req_b', { ...NO_PIECE, passedUpFrom: 'req_x', context: 'I tried both.' }),
      routed('req_b', 'a-person'),
    ])
    expect(cardOf(passed, 'p1').verb).toBe(PASSED_UP_WORD)
    expect(cardOf(passed, 'p1').askedOf).toBe(A_PERSON_ADDRESSED)
    expect(cardOf(passed, 'p1').context).toBe('I tried both.')
  })

  it('⛔ THE CONTROL — before its rows land the call’s own arguments say it, and a pass shows no id', () => {
    const early = fold([
      inventory(),
      call('c1', ASK, { question: 'tea or coffee?', who_answers: 'a-person' }),
      call('p1', PASS, { question: 'req_x' }),
    ])
    expect(cardOf(early, 'c1').state).toBe('asking')
    expect(cardOf(early, 'c1').askedOf).toBe(A_PERSON_ADDRESSED)
    expect(cardOf(early, 'c1').words).toBe('tea or coffee?')
    // ⛔ A passed-up question's argument is an id, never words — and nothing named, nobody is.
    expect(cardOf(early, 'p1').words).toBeNull()
    expect(cardOf(early, 'p1').askedOf).toBe(NOBODY_NAMED_YET)
    // ⚑ A refused call wrote no row: its receipt is the whole story.
    applyEvent(early, result('c1', 'refused: name the piece', true))
    expect(cardOf(early, 'c1').state).toBe('receipt')
    expect(cardOf(early, 'c1').receipt).toBe('refused: name the piece')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · replay is a trust boundary
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · a malformed row draws less, never crashes', () => {
  it('⛔ no request id, a prompt that is not words, parts that are not a list', () => {
    const state = fold([
      inventory(),
      call('c1', ASK, { question: 'kept?' }),
      asked('', { prompt: 7, questions: 'nope' }),
      // ⚑ Answered before the next call, so the next row has one call to land on.
      result('c1', 'refused: no id', true),
      call('c2', ASK),
      asked('req_b', {
        ...NO_PIECE,
        prompt: 7,
        questions: [null, { prompt: 3 }, { prompt: 'x', options: [5, 'Yes', { label: 'No' }] }],
      }),
    ])
    // ⚑ No id: nothing could ever close it, so it lands on nothing and the call keeps its arguments.
    expect(cardOf(state, 'c1').words).toBe('kept?')
    const card = cardOf(state, 'c2')
    expect(card.words).toBeNull()
    // ⚑ **UI-009** — a part whose row named no id is drawn, and nothing can file an answer under it.
    expect(
      card.parts.map((part) => [part.id, part.prompt, part.options.map((o) => o.label)]),
    ).toEqual([['', 'x', ['Yes', 'No']]])
  })
})
