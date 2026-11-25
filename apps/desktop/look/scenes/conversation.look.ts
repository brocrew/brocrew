import type { TranscriptEvent } from '../../src/shared/conversation-events'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'

import { paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'
import { OPENING } from '../fixtures/conversation'

/**
 * 🎨 **The conversation view** — header, shelf, transcript and composer, with a short exchange.
 * ⚑ To make another: copy this file and change the EVENTS below (fake data only; the opening is
 * `fixtures/conversation.ts`).
 */
const EVENTS: TranscriptEvent[] = [
  ...OPENING,
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
