import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'

/**
 * 🎨 **Two questions the agent asked the person** — the first refused by the app because it named
 * no piece, the second asked again and answered (fake data only).
 */
const ASK = 'mcp__brobot__ask_question'
const LONG =
  'Before I hand the menu to Mai I need one decision from you. The bakery on Station Street can ' +
  'deliver croissants and two kinds of bread by 7:00 on Sunday, but only if we order by Friday ' +
  'noon; Maison Lune delivers later, at 8:30, with a wider choice of pastries and no deadline. ' +
  'Which one should I tell Mai to plan around, and should the order include the gluten-free loaf ' +
  'that two of the guests asked for last time?'

const EVENTS: TranscriptEvent[] = [
  { type: 'status', state: 'idle' } as never,
  {
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'ask_question', description: '', parameters: [] }],
    },
    published: null,
  } as never,
  { type: 'user_turn', text: 'Plan the Sunday breakfast with Mai.' } as never,
  { type: 'status', state: 'working' } as never,
  {
    type: 'tool_call',
    id: 'c1',
    name: ASK,
    summary: JSON.stringify({ question: LONG, who_answers: 'a-person' }),
  } as never,
  {
    type: 'tool_result',
    id: 'c1',
    summary:
      'refused (name-the-piece-you-ask-about): name the piece this question is about, by its label (W1.2), so the answer reaches the work it belongs to.',
    ok: true,
  } as never,
  {
    type: 'tool_call',
    id: 'c2',
    name: ASK,
    summary: JSON.stringify({ piece: 'W6', question: LONG, who_answers: 'a-person' }),
  } as never,
  {
    type: 'question_asked',
    requestId: 'req_2',
    piece: 'work_6',
    label: 'W6',
    prompt: LONG,
    questions: [
      {
        id: 'q1',
        prompt: 'Which bakery?',
        options: [{ label: 'Station Street' }, { label: 'Maison Lune' }],
      },
    ],
  } as never,
  { type: 'request_routed', requestId: 'req_2', to: 'a-person' } as never,
  { type: 'tool_result', id: 'c2', summary: 'recorded', ok: true } as never,
  { type: 'user_decision', requestId: 'req_2', outcome: 'answered' } as never,
  {
    type: 'assistant_message',
    text: 'Station Street it is. I asked Mai to plan the menu around a 7:00 delivery.',
  } as never,
  { type: 'status', state: 'idle' } as never,
]

scene('questions-refused-and-answered', (stage) => {
  stage.mount(
    ConversationPane,
    paneProps({ record: record(EVENTS), drawerOpen: false, ownAgent: 'BroBot' }),
  )
})
