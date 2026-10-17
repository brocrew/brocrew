import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'

/**
 * 🎨 **A Codex turn of searches** — a short reasoning item before every call, and one message to
 * another conversation in the middle of them (fake data only).
 */
const thought = (): TranscriptEvent[] => [
  { type: 'thinking', phase: 'delta', redacted: true } as never,
  { type: 'thinking', phase: 'complete' } as never,
]

const search = (id: string, query: string): TranscriptEvent[] => [
  ...thought(),
  { type: 'tool_call', id, name: 'web_search', summary: JSON.stringify({ query }) } as never,
  { type: 'tool_result', id, summary: '10 results', ok: true } as never,
]

const EVENTS: TranscriptEvent[] = [
  { type: 'status', state: 'idle' } as never,
  {
    type: 'tool_inventory',
    naming: { prefix: '', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'message_agent', description: '', parameters: [] }],
    },
    published: null,
  } as never,
  {
    type: 'user_turn',
    text: 'Find out when the bakeries near the station open on Sundays.',
  } as never,
  { type: 'status', state: 'working' } as never,
  ...search('s1', 'bakery near central station sunday hours'),
  ...search('s2', 'Maison Lune bakery opening hours'),
  ...search('s3', 'Pain & Co station street sunday'),
  ...search('s4', 'Kornblume bakery hours'),
  ...thought(),
  {
    type: 'tool_call',
    id: 'm1',
    name: 'brobot__message_agent',
    summary: JSON.stringify({
      agent: 'sess_ada',
      text: 'Can you check which of these take orders?',
    }),
  } as never,
  {
    type: 'message_sent',
    to: 'sess_ada',
    toProfile: 'ada',
    kind: 'note',
    delivery: 'sent',
    onBehalfOfAPerson: false,
  } as never,
  { type: 'tool_result', id: 'm1', summary: 'sent', ok: true } as never,
  ...search('s5', 'Kornblume sunday closed'),
  ...search('s6', 'Maison Lune holiday hours'),
  {
    type: 'assistant_message',
    text: 'Three of the four open on Sundays: Maison Lune and Pain & Co at 7:00, Kornblume at 8:00. I asked Ada which of them take orders.',
  } as never,
  { type: 'turn', state: 'completed' } as never,
  { type: 'status', state: 'idle' } as never,
]

scene('codex-searches', (stage) => {
  stage.mount(ConversationPane, paneProps({ record: record(EVENTS), drawerOpen: false }))
})
