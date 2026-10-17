import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { applyEvent, createTranscript, type ToolItem } from '../../src/renderer/src/lib/transcript'
import { messageCall, messageReceipt, messageResult } from './agent-card-facts.fixture'
import { agentCardRecipient, mount, paneProps, record, unmountAll } from './harness'

afterEach(() => unmountAll())

const inventory = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: ['message_agent', 'ask_question'].map((name) => ({
      name,
      description: '',
      parameters: [],
    })),
  },
  published: null,
} as unknown as TranscriptEvent
const call = (name = 'mcp__brobot__message_agent') =>
  ({
    type: 'tool_call',
    id: 'message',
    name,
    summary: JSON.stringify({ agent: 'W1', kind: 'note', text: 'Read the helper’s result.' }),
  }) as TranscriptEvent
const refusal = (rail = 'that-agent-is-you') =>
  ({
    type: 'tool_refused',
    tool: 'message_agent',
    rail,
    permanence: 'permanent',
    retryable: false,
    remedy: null,
  }) as TranscriptEvent
const result = (rail = 'that-agent-is-you') =>
  ({
    type: 'tool_result',
    id: 'message',
    ok: true,
    summary: `refused (${rail}): that is this conversation.`,
  }) as TranscriptEvent

function folded(events: TranscriptEvent[]): ToolItem {
  const state = createTranscript()
  for (const event of [inventory, ...events]) applyEvent(state, event)
  return state.items.find((item) => item.kind === 'tool') as ToolItem
}

function pane(events: TranscriptEvent[]) {
  return mount(
    ConversationPane,
    paneProps({
      record: record([inventory, ...events]),
      held: [],
      identities: [],
    }),
    { width: 1180, height: 808 },
  )
}

describe('a self-address on its real action card', () => {
  it('carries the uniquely matched refusal and says itself', async () => {
    const events = [call(), refusal(), result()]
    expect(folded(events).refusalRail).toBe('that-agent-is-you')
    const mounted = await pane(events)
    expect(agentCardRecipient(mounted)).toBe('itself')
    expect(mounted.q('outgoing').querySelector('.exchange-heading')?.textContent).not.toContain(
      'another agent',
    )
  })

  it('does not guess another recipient from a pending call or an unrelated refusal', async () => {
    for (const events of [[call()], [call(), refusal('no-such-agent'), result('no-such-agent')]]) {
      const mounted = await pane(events)
      expect(agentCardRecipient(mounted)).toBe('the named agent')
      unmountAll()
    }
  })

  it('a recorded other recipient keeps its actual name', async () => {
    const mounted = await pane([messageCall(), messageReceipt(), messageResult()])
    expect(agentCardRecipient(mounted)).toBe('ayo')
  })

  it('an address missing from the call names no recipient', async () => {
    const mounted = await pane([
      {
        ...call(),
        summary: JSON.stringify({ kind: 'note', text: 'Read this.' }),
      } as TranscriptEvent,
    ])
    expect(mounted.all('outgoing-recipient')).toHaveLength(0)
    const heading = mounted.q('outgoing').querySelector('.exchange-heading')
    expect(heading).not.toBeNull()
    expect(heading?.textContent?.replace(/\s+/g, ' ').trim()).toBe('BroBot → · message')
  })

  it('a refused self-question names itself and records no invented recipient', async () => {
    const ask = {
      type: 'tool_call',
      id: 'ask',
      name: 'mcp__brobot__ask_question',
      summary: JSON.stringify({ agent: 'W1', who_answers: 'an-agent', question: 'Read this?' }),
    } as TranscriptEvent
    const denied = { ...refusal(), tool: 'ask_question' } as TranscriptEvent
    const answer = { ...result(), id: 'ask' } as TranscriptEvent
    const mounted = await pane([ask, denied, answer])
    // A refused question folds to one line, whose heading names whom it was addressed to.
    expect(agentCardRecipient(mounted)).toBe('itself')
  })

  it('a question needs a routed recipient before it says another agent', async () => {
    const ask = {
      type: 'tool_call',
      id: 'ask',
      name: 'mcp__brobot__ask_question',
      summary: JSON.stringify({ agent: 'W1.1', who_answers: 'an-agent', question: 'Read this?' }),
    } as TranscriptEvent
    const asked = {
      type: 'question_asked',
      requestId: 'req_test',
      prompt: 'Read this?',
      questions: [],
    } as unknown as TranscriptEvent
    const pending = await pane([ask, asked])
    expect(pending.q('question-asked-of').textContent?.trim()).toBe('the named agent')
    unmountAll()
    const routed = {
      type: 'request_routed',
      requestId: 'req_test',
      to: 'an-agent',
      parent: 'sess_helper',
    } as TranscriptEvent
    const reached = await pane([ask, asked, routed])
    expect(agentCardRecipient(reached)).toBe('another agent')
  })

  it('foreign tools and an ambiguous pair of refusal rows cannot claim the self fact', () => {
    expect(
      folded([call('mcp__foreign__message_agent'), refusal(), result()]).refusalRail,
    ).toBeUndefined()
    expect(folded([call(), refusal(), refusal(), result()]).refusalRail).toBeUndefined()
    expect(folded([call(), refusal(), result('no-such-agent')]).refusalRail).toBeUndefined()
  })

  it('a later unmatched result does not retain the former self fact', () => {
    expect(
      folded([
        call(),
        refusal(),
        result(),
        { type: 'tool_result', id: 'message', ok: true, summary: 'sent' } as TranscriptEvent,
      ]).refusalRail,
    ).toBeUndefined()
  })
})
