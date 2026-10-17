import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { META, paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'

/**
 * 🎨 **The conversation view while the agent runs a tool, with the right panel open** — a yolo
 * conversation that last reported at 01:55. Docked beside the conversation at 1180 wide, floating
 * over it at 760.
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
