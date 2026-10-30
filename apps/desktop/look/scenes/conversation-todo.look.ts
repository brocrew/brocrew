import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { paneProps, record } from '../../test/dom/harness'
import { scene } from '../capture'

scene('conversation-todo', (stage) => {
  const events: TranscriptEvent[] = [
    {
      type: 'tool_inventory',
      naming: { prefix: 'mcp__', separator: '__' },
      declared: {
        server: 'brobot',
        tools: [{ name: 'request_action', description: '', parameters: [] }],
      },
      published: null,
    } as unknown as TranscriptEvent,
    { type: 'user_turn', text: 'Please help prepare the sample report.' },
    {
      type: 'tool_call',
      id: 'call_action',
      name: 'mcp__brobot__request_action',
      summary: '{"action":"Check the sample report and confirm its title."}',
    } as TranscriptEvent,
    {
      type: 'question_asked',
      requestId: 'req_report',
      piece: 'work_report',
      label: 'W3.4',
      prompt: 'Check the sample report and confirm its title.',
      questions: [],
      action: { files: [] },
    } as TranscriptEvent,
    { type: 'request_routed', requestId: 'req_report', to: 'a-person' } as TranscriptEvent,
    {
      type: 'tool_result',
      id: 'call_action',
      summary: 'The to-do is under Waiting on you.',
      ok: true,
    } as TranscriptEvent,
  ]
  stage.mount(ConversationPane, paneProps({ record: record(events) }))
})
