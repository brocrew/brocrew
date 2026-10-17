import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'

/**
 * 🎨 **The conversation view** — header, shelf, transcript and composer, with a short exchange.
 * ⚑ To make another: copy this file and change the EVENTS below (fake data only).
 */
const EVENTS: TranscriptEvent[] = [
  { type: 'status', state: 'idle' } as never,
  {
    type: 'user_turn',
    text: 'Can you tidy the landing page header and make the logo larger?',
  } as never,
  { type: 'status', state: 'working' } as never,
  {
    type: 'assistant_message',
    text: 'Sure. I will look at the header first, then adjust the logo size and the spacing around it.',
  } as never,
  {
    type: 'tool_call',
    id: 'c1',
    name: 'Read',
    summary: JSON.stringify({ file_path: 'src/components/SiteHeader.vue' }),
  } as never,
  { type: 'tool_result', id: 'c1', summary: '64 lines', ok: true } as never,
  {
    type: 'assistant_message',
    text: 'Done. The logo is now 40 px tall, the nav items are spaced evenly, and the header keeps its height on small screens.',
  } as never,
  { type: 'turn', state: 'completed' } as never,
  { type: 'status', state: 'idle' } as never,
]

scene('conversation', (stage) => {
  stage.mount(ConversationPane, paneProps({ record: record(EVENTS), drawerOpen: false }))
})
