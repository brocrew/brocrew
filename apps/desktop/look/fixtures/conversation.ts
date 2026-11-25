import type { TranscriptEvent } from '../../src/shared/conversation-events'

/** 🎨 How the made-up landing-page conversation opens, before its first tool call. Fake data only. */
export const OPENING: TranscriptEvent[] = [
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
]

/** The same conversation through its first tool call: reading the header file. */
export const READING_THE_HEADER: TranscriptEvent[] = [
  ...OPENING,
  {
    type: 'tool_call',
    id: 'c1',
    name: 'Read',
    summary: JSON.stringify({ file_path: 'src/components/SiteHeader.vue' }),
  } as never,
  { type: 'tool_result', id: 'c1', summary: '64 lines', ok: true } as never,
]
