import type { TranscriptEvent } from '../../src/shared/conversation-events'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'

import { META, paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'
import { OPENING } from '../fixtures/conversation'

/**
 * 🎨 **The conversation view while the agent runs a tool, with the right panel open** — a yolo
 * conversation that last reported at 01:55. Docked beside the conversation at 1180 wide, floating
 * over it at 760.
 */
const EVENTS: TranscriptEvent[] = [
  ...OPENING,
  {
    type: 'tool_call',
    id: 'c1',
    name: 'Bash',
    summary: JSON.stringify({ command: 'pnpm run build' }),
  } as never,
  { type: 'activity', phase: 'tool', detail: 'Bash' } as never,
]

const LAST_REPORT = new Date(2026, 9, 11, 1, 55).getTime()

scene('conversation-running', (stage) => {
  const held = record(EVENTS)
  held.meta = { ...META, approvalMode: 'auto' }
  held.window.entries = EVENTS.map((event, ordinal) => ({
    sessionId: 'sess_1',
    ordinal,
    at: LAST_REPORT - (EVENTS.length - 1 - ordinal) * 1000,
    event,
  }))
  stage.mount(ConversationPane, paneProps({ record: held, drawerOpen: true }))
})
