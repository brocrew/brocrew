import type {
  TranscriptEvent,
  MessageSentEvent,
  AnsweredQuestion,
} from '../../src/shared/runtime-ipc'
import { EXCHANGE_INVENTORY, EXCHANGE_AT, EXCHANGE_OTHER } from './agent-exchanges.fixture'
export { EXCHANGE_AT, EXCHANGE_OTHER, EXCHANGE_INVENTORY }
export const MESSAGE_ACT = 'message_act_12345678-1234-4123-8123-123456789abc'
export const SECOND_ACT = 'message_act_22345678-1234-4123-8123-123456789abc'
export const ANSWER_WORDS = '**Keep** the bakery menu.\nThe ovens stay off.'
export const ANSWER_NOTICE =
  'A person answered the question.\nYou asked: Which menu?\nanswer: ' +
  ANSWER_WORDS +
  '\nThe full notice ends here.'
export function messageCall(id = 'note'): TranscriptEvent {
  return {
    type: 'tool_call',
    id,
    name: 'mcp__brobot__message_agent',
    summary: JSON.stringify({ agent: 'W4', kind: 'note', text: 'Check the fictional menu.' }),
  }
}
export function messageResult(id = 'note', messageAct = MESSAGE_ACT): TranscriptEvent {
  return { type: 'tool_result', id, ok: true, summary: 'Recorded.', messageAct }
}
export function messageReceipt(
  messageAct = MESSAGE_ACT,
  overrides: Partial<MessageSentEvent> = {},
): TranscriptEvent {
  return {
    type: 'message_sent',
    onBehalfOfAPerson: false,
    to: EXCHANGE_OTHER,
    toProfile: 'ayo',
    kind: 'note',
    delivery: 'sent',
    text: '**Check** the fictional menu.\nThe note ends here.',
    messageAct,
    addressedAs: 'W4',
    toLabel: 'W4',
    ...overrides,
  }
}
export function questionFixture(): TranscriptEvent[] {
  return [
    EXCHANGE_INVENTORY,
    {
      type: 'tool_call',
      id: 'ask',
      name: 'mcp__brobot__ask_question',
      summary: JSON.stringify({ who_answers: 'the-parent', question: 'Which menu?' }),
    },
    {
      type: 'question_asked',
      requestId: 'req_menu',
      prompt: 'Which menu?',
      questions: [
        {
          id: 'part',
          prompt: 'Choose a menu.',
          options: [{ label: 'Bakery' }, { label: 'Pantry' }],
        },
      ],
    },
    { type: 'request_routed', requestId: 'req_menu', to: 'the-parent', parent: EXCHANGE_OTHER },
    { type: 'tool_result', id: 'ask', summary: 'Recorded.', ok: true },
  ]
}
export function answerNotice(
  answeredBy: string | null = null,
  extra: Partial<AnsweredQuestion> = {},
): TranscriptEvent {
  return {
    type: 'user_turn',
    text: ANSWER_NOTICE,
    attribution: 'app_authored',
    sent: ANSWER_NOTICE,
    ...(answeredBy === null
      ? { appNotice: 'an-answer-to-a-question' as const }
      : { relayedFrom: answeredBy, relayedFromProfile: 'ayo' }),
    answeredQuestion: { requestId: 'req_menu', answeredBy, answer: ANSWER_WORDS, ...extra },
  }
}
export function cardFactsFixture(): TranscriptEvent[] {
  return [
    ...questionFixture(),
    answerNotice(),
    messageCall(),
    messageReceipt(),
    messageResult(),
    messageCall('follow'),
    messageResult('follow', SECOND_ACT),
    messageReceipt(SECOND_ACT, { kind: 'follow-up', toProfile: 'brobot', toLabel: 'W1' }),
  ]
}
