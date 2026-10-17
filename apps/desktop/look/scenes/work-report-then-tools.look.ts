import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'

/**
 * 🎨 **A report about work this conversation gave out, then the agent's next tool calls** — the
 * report's state is a stopped turn, with the long body this app writes for it (fake data only).
 */
const search = (id: string, query: string): TranscriptEvent[] => [
  { type: 'tool_call', id, name: 'web_search', summary: JSON.stringify({ query }) } as never,
  { type: 'tool_result', id, summary: '10 results', ok: true } as never,
]

const EVENTS: TranscriptEvent[] = [
  { type: 'status', state: 'idle' } as never,
  { type: 'user_turn', text: 'Ask Mai for the Sunday menu, then check the bakeries.' } as never,
  { type: 'status', state: 'working' } as never,
  {
    type: 'user_turn',
    attribution: 'app_authored',
    text:
      'W7.41 · Ask Mai for the Sunday menu is not being worked on: its turn ended because its ' +
      'provider’s usage limit was reached. Its usage resets at 18:00, and a message to Mai waits ' +
      'until then.\n\nMai’s latest words start: “I have the starters and two of the mains; the ' +
      'desserts depend on what the bakery can deliver on Sunday morning, so I was about to ask…”\n\n' +
      'To read more, open the conversation.',
    work: {
      piece: 'work_41',
      label: 'W7.41',
      owner: 'sess_mai',
      state: 'stalled',
      stalledBecause: 'provider_limited',
    },
  } as never,
  ...search('s1', 'bakery near central station sunday hours'),
  ...search('s2', 'Maison Lune bakery opening hours'),
  ...search('s3', 'Pain & Co station street sunday'),
  {
    type: 'assistant_message',
    text: 'Mai is paused until 18:00. Meanwhile, three of the four bakeries open on Sundays.',
  } as never,
  { type: 'turn', state: 'completed' } as never,
  { type: 'status', state: 'idle' } as never,
]

scene('work-report-then-tools', (stage) => {
  stage.mount(
    ConversationPane,
    paneProps({ record: record(EVENTS), drawerOpen: false, held: ['sess_mai'] }),
  )
})
