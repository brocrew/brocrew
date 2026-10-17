import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { applyEvent, createTranscript, type ToolItem } from '../src/renderer/src/lib/transcript'
import { answerIn, questionItemIn } from '../src/renderer/src/lib/answered-question'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
} from '../src/renderer/src/lib/session-record'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  EXCHANGE_INVENTORY,
  EXCHANGE_OTHER,
  MESSAGE_ACT,
  SECOND_ACT,
  messageCall,
  messageResult,
  messageReceipt,
  answerNotice,
  questionFixture,
  ANSWER_WORDS,
  ANSWER_NOTICE,
} from './dom/agent-card-facts.fixture'
function fold(events: TranscriptEvent[]) {
  const state = reactive(createTranscript())
  for (const one of events) applyEvent(state, one)
  return state
}
function sent(state: ReturnType<typeof fold>, id = 'note') {
  const item = state.items.find(
    (one) => one.kind === 'tool' && one.callId === id && one.outgoing?.tool === 'message_agent',
  ) as ToolItem
  return item?.outgoing?.tool === 'message_agent' ? item.outgoing.sent : undefined
}
describe('exact message receipts', () => {
  for (const order of [
    [messageCall(), messageReceipt(), messageResult()],
    [messageReceipt(), messageCall(), messageResult()],
    [messageCall(), messageResult(), messageReceipt()],
  ])
    it('joins only its registered call, exact result and receipt in either arrival order', () => {
      const state = fold([EXCHANGE_INVENTORY, ...order])
      expect(sent(state)).toMatchObject({
        toProfile: 'ayo',
        toConversation: EXCHANGE_OTHER,
        toLabel: 'W4',
        kind: 'note',
      })
    })
  it('a delayed different alias receipt never lands on the only currently visible call', () => {
    const state = fold([EXCHANGE_INVENTORY, messageCall('A'), messageReceipt(SECOND_ACT)])
    expect(sent(state, 'A')).toBeNull()
    applyEvent(state, messageCall('B'))
    applyEvent(state, messageResult('B', SECOND_ACT))
    expect(sent(state, 'A')).toBeNull()
    expect(sent(state, 'B')).not.toBeNull()
    applyEvent(state, messageReceipt())
    applyEvent(state, messageResult('A'))
    expect(sent(state, 'A')).not.toBeNull()
  })
  for (const bad of [
    { ...messageResult(), ok: false },
    { ...messageResult(), parentToolCallId: 'child' },
    { ...messageResult(), messageAct: 'not-an-act' },
  ] as TranscriptEvent[])
    it('does not join failed, nested or malformed results', () => {
      const state = fold([EXCHANGE_INVENTORY, messageCall(), messageReceipt(), bad])
      expect(sent(state)).toBeNull()
    })
  it('foreign and nested calls cannot claim the parent conversation receipt', () => {
    for (const extra of [
      { name: 'mcp__foreign__message_agent' },
      { parentToolCallId: 'missing-child' },
    ]) {
      const state = fold([
        EXCHANGE_INVENTORY,
        { ...messageCall(), ...extra } as TranscriptEvent,
        messageReceipt(),
        messageResult(),
      ])
      expect(sent(state) ?? null).toBeNull()
    }
  })
  for (const repeated of [
    messageReceipt(MESSAGE_ACT, { toProfile: 'brobot', toLabel: 'W1' }),
    messageResult(),
    messageCall(),
  ])
    it('a duplicate receipt, result or call retracts its former association', () => {
      const state = fold([EXCHANGE_INVENTORY, messageCall(), messageReceipt(), messageResult()])
      expect(sent(state)).not.toBeNull()
      applyEvent(state, repeated)
      expect(sent(state)).toBeNull()
    })
  it('two distinct calls claiming one act retract the former association', () => {
    const state = fold([
      EXCHANGE_INVENTORY,
      messageCall(),
      messageReceipt(),
      messageResult(),
      messageCall('other'),
      messageResult('other'),
    ])
    expect(sent(state)).toBeNull()
    expect(sent(state, 'other')).toBeNull()
  })
  it('a result without its call in the retained suffix cannot be adopted later', () => {
    const state = fold([
      EXCHANGE_INVENTORY,
      messageReceipt(),
      messageResult(),
      messageCall(),
      messageResult(),
    ])
    expect(sent(state)).toBeNull()
  })
  it('an unresolved receipt never crosses a new turn boundary', () => {
    const state = fold([
      EXCHANGE_INVENTORY,
      messageReceipt(),
      { type: 'user_turn', text: 'A new run.' },
      messageCall(),
      messageResult(),
    ])
    expect(sent(state)).toBeNull()
  })
  it('rebuilding the same full events keeps the exact destination; omitting the call keeps no identity', () => {
    const events = [EXCHANGE_INVENTORY, messageCall(), messageReceipt(), messageResult()]
    expect(sent(fold(events))).toEqual(sent(fold(events)))
    expect(
      fold(events.filter((event) => event.type !== 'tool_call')).items.every(
        (item) => item.kind !== 'tool' || item.outgoing === undefined,
      ),
    ).toBe(true)
  })
  it('old records without the new token retain their existing correlation', () => {
    const old = messageReceipt()
    delete (old as { messageAct?: string }).messageAct
    const call = {
      ...messageCall(),
      summary: JSON.stringify({ agent: EXCHANGE_OTHER }),
    } as TranscriptEvent
    expect(sent(fold([EXCHANGE_INVENTORY, call, old]))).not.toBeNull()
  })
})
const providerRef = {
  provider: 'claude',
  sessionId: 'provider_after_reset',
  cwd: '/fictional/bakery',
  rotation: 1,
} as const
const contextBoundaries: TranscriptEvent[] = [
  { type: 'conversation_reset', ref: providerRef, source: 'conversation_reset' },
  { type: 'session', state: 'started', ref: providerRef },
  { type: 'session', state: 'resumed', ref: providerRef },
  { type: 'reopened' },
  { type: 'launched' },
  { type: 'provider_turn' },
]
describe('receipt context boundaries', () => {
  for (const boundary of contextBoundaries) {
    it(`${boundary.type}${boundary.type === 'session' ? ':' + boundary.state : ''}: an old retained receipt cannot adopt a reused provider call ID`, () => {
      const events = [
        EXCHANGE_INVENTORY,
        messageReceipt(),
        boundary,
        messageCall('reused'),
        messageResult('reused'),
      ]
      const state = fold(events)
      expect(sent(state, 'reused')).toBeNull()
      const recorded = createSessionRecord('sess_recorded')
      recorded.phase = 'recorded'
      openWindow(recorded, {
        from: 700,
        hasOlder: true,
        turnAligned: false,
        entries: events.map((event, i) => ({
          sessionId: 'sess_recorded',
          ordinal: 700 + i,
          at: 1000 + i,
          event,
        })),
      })
      for (const [i, event] of events.entries())
        acceptEvent(recorded, { sessionId: 'sess_recorded', ordinal: 700 + i, at: 1000 + i, event })
      expect(sent(recorded.transcript as ReturnType<typeof fold>, 'reused')).toBeNull()
      expect(recorded.window.hasOlder).toBe(true)
    })
    it(`${boundary.type}${boundary.type === 'session' ? ':' + boundary.state : ''}: new exact facts join and already established historical receivers stay intact`, () => {
      const state = fold([
        EXCHANGE_INVENTORY,
        messageCall('reused'),
        messageReceipt(),
        messageResult('reused'),
        boundary,
        messageCall('reused'),
        messageReceipt(SECOND_ACT, { toProfile: 'brobot', toLabel: 'W1' }),
        messageResult('reused', SECOND_ACT),
      ])
      const calls = state.items.filter(
        (item): item is ToolItem => item.kind === 'tool' && item.outgoing?.tool === 'message_agent',
      )
      expect(calls).toHaveLength(2)
      expect(
        calls.map((item) =>
          item.outgoing?.tool === 'message_agent' ? item.outgoing.sent?.toProfile : null,
        ),
      ).toEqual(['ayo', 'brobot'])
    })
  }
  it('a same-context delayed receipt remains usable through the recorded-window path', () => {
    const recorded = createSessionRecord('sess_recorded')
    recorded.phase = 'recorded'
    const events = [
      EXCHANGE_INVENTORY,
      messageCall(),
      { type: 'status', state: 'working' } as const,
      messageResult(),
      messageReceipt(),
    ]
    openWindow(recorded, {
      from: 700,
      hasOlder: true,
      turnAligned: false,
      entries: events.map((event, i) => ({
        sessionId: 'sess_recorded',
        ordinal: 700 + i,
        at: 1000 + i,
        event,
      })),
    })
    for (const [i, event] of events.entries())
      acceptEvent(recorded, { sessionId: 'sess_recorded', ordinal: 700 + i, at: 1000 + i, event })
    expect(sent(recorded.transcript as ReturnType<typeof fold>)?.toProfile).toBe('ayo')
  })
})
describe('current token supersedes the older matcher', () => {
  it("another call's early receipt cannot fill the result whose own receipt is still missing", () => {
    const state = fold([
      EXCHANGE_INVENTORY,
      messageCall('first'),
      messageReceipt(SECOND_ACT, { toProfile: 'brobot', toLabel: 'W1', kind: 'follow-up' }),
      messageResult('first'),
    ])
    expect(sent(state, 'first')).toBeNull()
    applyEvent(state, messageReceipt())
    expect(sent(state, 'first')?.toProfile).toBe('ayo')
    applyEvent(state, messageCall('second'))
    applyEvent(state, messageResult('second', SECOND_ACT))
    expect(sent(state, 'second')).toMatchObject({ toProfile: 'brobot', kind: 'follow-up' })
    expect(sent(state, 'first')?.toProfile).toBe('ayo')
  })
  it('a typed result removes a legacy candidate until its exact receipt arrives', () => {
    const legacy = messageReceipt()
    delete (legacy as { messageAct?: string }).messageAct
    const call = {
      ...messageCall(),
      summary: JSON.stringify({ agent: EXCHANGE_OTHER }),
    } as TranscriptEvent
    const state = fold([EXCHANGE_INVENTORY, call, legacy])
    expect(sent(state)).not.toBeNull()
    applyEvent(state, messageResult())
    expect(sent(state)).toBeNull()
    applyEvent(state, messageReceipt())
    expect(sent(state)).not.toBeNull()
  })
  it('the recorded receiver name is preserved without parsing it as an address', () => {
    const state = fold([
      EXCHANGE_INVENTORY,
      messageCall(),
      messageReceipt(MESSAGE_ACT, { toLabel: 'W1 · Bakery planning (BroBot)' }),
      messageResult(),
    ])
    expect(sent(state)?.toLabel).toBe('W1 · Bakery planning (BroBot)')
  })
})
describe('typed answered-question carriers', () => {
  for (const by of [null, EXCHANGE_OTHER])
    it('direct and batched answers preserve typed answer-only words', () => {
      const direct = answerNotice(by)
      const state = fold([...questionFixture(), direct])
      expect(answerIn(state.items.at(-1)!)).toMatchObject({
        answer: ANSWER_WORDS,
        requestId: 'req_menu',
        answeredBy: by,
      })
      const { type, ...part } = direct as Extract<TranscriptEvent, { type: 'user_turn' }>
      void type
      const batched = fold([
        { type: 'user_turn', text: 'Both', parts: [{ text: 'Person words.' }, part] },
      ])
      expect(answerIn(batched.items.at(-1)!)).toEqual(answerIn(state.items.at(-1)!))
    })
  it('a queued delivery, its unsent rebuild and its accepted turn retain the same answer facts', () => {
    const raw = answerNotice() as Extract<TranscriptEvent, { type: 'user_turn' }>
    const { type, ...facts } = raw
    void type
    const queued = {
      ...facts,
      type: 'message_queued',
      messageId: 'message_answer',
    } as TranscriptEvent
    const ended = {
      ...facts,
      type: 'message_unqueued',
      messageId: 'message_answer',
      reason: 'abandoned',
    } as TranscriptEvent
    expect(answerIn(fold([queued]).items[0]!)).toEqual(answerIn(fold([ended]).items[0]!))
    const accepted = fold([
      queued,
      {
        type: 'message_unqueued',
        messageId: 'message_answer',
        reason: 'sent',
        text: ANSWER_NOTICE,
      },
      raw,
    ])
    expect(accepted.items).toHaveLength(1)
    expect(answerIn(accepted.items[0]!)?.answer).toBe(ANSWER_WORDS)
  })
  it('no metadata means the old full notice; a person message cannot manufacture an answer notice', () => {
    const raw = answerNotice()
    delete (raw as { answeredQuestion?: unknown }).answeredQuestion
    expect(answerIn(fold([raw]).items[0]!)).toBeUndefined()
    const person = {
      type: 'user_turn',
      text: 'Person words.',
      answeredQuestion: { requestId: 'req_menu', answeredBy: null, answer: 'Keep' },
    } as TranscriptEvent
    expect(fold([person]).items[0]?.kind).toBe('user')
  })
  it('malformed metadata and mismatched relayer identity keep the old reading', () => {
    expect(
      answerIn(fold([answerNotice(EXCHANGE_OTHER, { answeredBy: 'sess_other' })]).items[0]!),
    ).toBeUndefined()
    const bad = {
      ...answerNotice(),
      answeredQuestion: { requestId: [], answeredBy: null, answer: 'Keep' },
    } as unknown as TranscriptEvent
    expect(answerIn(fold([bad]).items[0]!)).toBeUndefined()
  })
  it('navigation requires one loaded typed question, never prose or duplicate cards', () => {
    const state = fold(questionFixture())
    expect(questionItemIn(state.items, 'req_menu')).toBeDefined()
    expect(questionItemIn(state.items, 'req_missing')).toBeUndefined()
    const target = state.items.find(
      (item) => item.kind === 'tool' && item.outgoing && 'asked' in item.outgoing,
    )!
    expect(
      questionItemIn([...state.items, { ...target, id: 'tool_duplicate' }], 'req_menu'),
    ).toBeUndefined()
  })
})
