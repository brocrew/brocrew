import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record } from './harness'

export const QUESTION_MARKDOWN =
  '**Choose a draft**\n\n- Read `draft_id`\n- Open [the draft](notes.md).'

export function aTranscriptQuestionWithMarkdown(folds = false, width = 1180, height = 900) {
  const events = [
    {
      type: 'tool_inventory',
      naming: { prefix: 'mcp__', separator: '__' },
      declared: {
        server: 'brobot',
        tools: [{ name: 'ask_question', description: '', parameters: [] }],
      },
      published: null,
    },
    {
      type: 'tool_call',
      id: 'ask_draft',
      name: 'mcp__brobot__ask_question',
      summary: JSON.stringify({ question: QUESTION_MARKDOWN, who_answers: 'a-person' }),
    },
    {
      type: 'question_asked',
      requestId: 'req_draft',
      prompt: QUESTION_MARKDOWN,
      context: 'Read [the context](context.md).',
      questions: [{ id: 'draft', prompt: 'Which draft?', options: [{ label: 'Short' }] }],
    },
    { type: 'request_routed', requestId: 'req_draft', to: 'a-person' },
    { type: 'tool_result', id: 'ask_draft', summary: 'recorded', ok: true },
    ...(folds ? [{ type: 'user_decision', requestId: 'req_draft', outcome: 'answered' }] : []),
  ] as unknown as TranscriptEvent[]
  return mount(
    ConversationPane,
    paneProps({ record: record(events), canAnswer: true, ownAgent: 'Glint' }),
    { width, height },
  )
}
