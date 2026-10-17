import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'

export const EXCHANGE_AT = Date.UTC(2026, 9, 7, 16, 55)
export const EXCHANGE_OTHER = 'sess_0d870a6d-1c2b-4e5f-8a9b-0c1d2e3f4a5b'
export const EXCHANGE_WORDS =
  '# Bakery plan\n\n**Read** the `menu` and [guide](https://example.com/guide).\n\n- Keep the colours.\n- Test the buttons.\n\n```ts\nconst ready = true\n```\n\nThe whole brief ends here.'
export const EXCHANGE_IDS = [
  { id: 'aid:ayo', slug: 'ayo', displayName: 'Ayo' },
  { id: 'aid:brobot', slug: 'brobot', displayName: 'BroBot' },
] as AgentIdentity[]
export const EXCHANGE_INVENTORY = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [
      'give_work',
      'message_agent',
      'ask_question',
      'pass_question_up',
      'reply_to_parent',
    ].map((name) => ({ name, description: '', parameters: [] })),
  },
  published: null,
} as unknown as TranscriptEvent

export function agentExchangeFixture(): TranscriptEvent[] {
  return [
    EXCHANGE_INVENTORY,
    { type: 'user_turn', text: 'Please have Ayo check the bakery menu.', at: EXCHANGE_AT },
    {
      type: 'tool_call',
      id: 'give',
      name: 'mcp__brobot__give_work',
      summary: JSON.stringify({
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'ayo',
        title: 'Check the menu',
        brief: EXCHANGE_WORDS,
      }).slice(0, 200),
      at: EXCHANGE_AT,
    },
    {
      type: 'work_sent',
      piece: 'work_bakery',
      label: 'W1.2',
      as: 'given',
      to: EXCHANGE_OTHER,
      title: 'Check the menu',
      brief: EXCHANGE_WORDS,
      at: EXCHANGE_AT,
    },
    {
      type: 'tool_result',
      id: 'give',
      ok: true,
      summary: 'W1.2 given to Ayo (ayo); it went to Ayo straight away.',
      at: EXCHANGE_AT,
    },
    {
      type: 'user_turn',
      text: EXCHANGE_WORDS,
      relayedFrom: EXCHANGE_OTHER,
      relayedFromProfile: 'ayo',
      says: 'note',
      sent: EXCHANGE_WORDS,
      at: EXCHANGE_AT,
    },
  ] as TranscriptEvent[]
}

export function agentCardEdgesFixture(): TranscriptEvent[] {
  return [
    EXCHANGE_INVENTORY,
    { type: 'user_turn', text: 'Please check the bakery menu.', at: EXCHANGE_AT },
    {
      type: 'tool_call',
      id: 'note',
      name: 'mcp__brobot__message_agent',
      summary: JSON.stringify({ agent: EXCHANGE_OTHER, kind: 'note', text: EXCHANGE_WORDS }).slice(
        0,
        200,
      ),
      at: EXCHANGE_AT,
    },
    {
      type: 'message_sent',
      to: EXCHANGE_OTHER,
      toProfile: 'ayo',
      kind: 'note',
      delivery: 'sent',
      text: EXCHANGE_WORDS,
      at: EXCHANGE_AT,
    },
    { type: 'tool_result', id: 'note', ok: true, summary: 'Sent as a note.', at: EXCHANGE_AT },
    {
      type: 'user_turn',
      text: EXCHANGE_WORDS,
      relayedFrom: EXCHANGE_OTHER,
      relayedFromProfile: 'ayo',
      says: 'note',
      sent: EXCHANGE_WORDS,
      at: EXCHANGE_AT,
    },
    {
      type: 'user_turn',
      text: 'A person answered the question.\nYou asked: Which menu?\nanswer: The bakery menu.',
      attribution: 'app_authored',
      appNotice: 'an-answer-to-a-question',
      at: EXCHANGE_AT,
    },
  ] as TranscriptEvent[]
}
