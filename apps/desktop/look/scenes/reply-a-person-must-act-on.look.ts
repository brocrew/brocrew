import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'

/**
 * 🎨 **A reply from another conversation that says a person has to act** — Ada's answer to work
 * this conversation gave out, marked for the person (fake data only).
 */
const EVENTS: TranscriptEvent[] = [
  { type: 'status', state: 'idle' } as never,
  { type: 'user_turn', text: 'Ask Ada to draft the Sunday menu.' } as never,
  {
    type: 'user_turn',
    relayedFrom: 'sess_ada',
    relayedFromProfile: 'ada',
    text:
      'The menu draft is ready: three starters, four mains and two desserts. Before I send it to ' +
      'the bakery, someone has to choose between the two dessert suppliers; the prices differ by ' +
      'a third and I cannot decide that for you.',
    work: {
      piece: 'work_7',
      label: 'W1.7',
      owner: 'sess_ada',
      state: 'answered',
      outcome: 'done',
      needsUserAction: true,
    },
  } as never,
  {
    type: 'assistant_message',
    text: 'Ada has the menu ready and needs you to pick a dessert supplier.',
  } as never,
  { type: 'status', state: 'idle' } as never,
]

scene('reply-a-person-must-act-on', (stage) => {
  stage.mount(
    ConversationPane,
    paneProps({
      record: record(EVENTS),
      drawerOpen: false,
      held: ['sess_ada'],
      ownAgent: 'BroBot',
    }),
  )
})
