import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import QuestionCard from '../../src/renderer/src/components/QuestionCard.vue'
import MessageLinks from '../../src/renderer/src/components/MessageLinks.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import UserMessage from '../../src/renderer/src/components/UserMessage.vue'
import QueuedMessage from '../../src/renderer/src/components/QueuedMessage.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import { usePersonsQueue, type PersonsQueueRow } from '../../src/renderer/src/lib/persons-queue'
import {
  aPersonsSince,
  escalationChain,
  chainReading,
  chainSentence,
  NOTHING_NAMED_THE_WORK,
  type PersonsQuestion,
  type RoutedRequest,
} from '../../src/shared/questions'
import { moveRequestFromWindow } from '../../src/renderer/src/lib/move-request'
import type { QuestionCardReading } from '../../src/renderer/src/lib/question-card'
import type { RequestDraft } from '../../src/renderer/src/lib/session-record'
import type { MoveRequestAck, MoveOffer } from '../../src/shared/move-request'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { MOVE_SEND_UNCONFIRMED } from '../../src/shared/move-request'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { conversationLink } from '../../src/shared/links'
import { moveReceiptLine } from '../../src/shared/move-request'
import type { LinkResolution } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible } from './harness'

const MOVE: MoveOffer = {
  destination: 'target',
  destinationName: 'W2 · Fictional release',
  sourceOrdinal: 1,
  sourceGeneration: 0,
  sourceDigest: 'a'.repeat(64),
}
const reading = (): QuestionCardReading => ({
  move: MOVE,
  requestId: 'request',
  asker: 'Editor',
  verb: 'asked',
  askedOf: 'you',
  piece: null,
  via: null,
  at: null,
  atTitle: null,
  words: 'The release conversation has the answer.',
  wordsAreCut: false,
  wordsMissing: false,
  context: null,
  parts: [
    {
      id: 'answer',
      header: null,
      prompt: null,
      options: [
        { label: 'Move it', description: null },
        { label: 'Do it here', description: null },
      ],
      multiSelect: false,
      typed: false,
      secret: false,
    },
  ],
  state: 'open',
  answeredBy: null,
  answerable: true,
  refused: null,
  note: null,
  receipt: null,
  where: null,
})
afterEach(unmountAll)

describe('the person decides on the move card', () => {
  it('Waiting on you sends the same typed press and retries a refused move', async () => {
    const queue = usePersonsQueue()
    const request: RoutedRequest = {
      requestId: 'request',
      askedBy: 'source',
      parent: null,
      went: { is: 'the-person-the-asker-named', to: 'a-person' },
      at: 1,
      state: 'open',
      endedAt: null,
      escalatedAt: 1,
    }
    const chain = escalationChain(request, () => null)
    const question: PersonsQuestion = {
      request,
      chain,
      reading: chainReading(chain, (id) => id),
      sentence: chainSentence(chain, (id) => id),
      aPersonsSince: aPersonsSince(request),
      work: [],
      about: NOTHING_NAMED_THE_WORK,
      raisedBy: 'this-app',
      offered: null,
      asked: {
        move: MOVE,
        prompt: 'The release conversation has the answer.',
        context: null,
        passedUp: false,
        parts: [
          {
            id: 'answer',
            prompt: 'The release conversation has the answer.',
            options: [{ label: 'Move it' }, { label: 'Do it here' }],
          },
        ],
      },
    }
    const moved = vi.fn<(row: PersonsQueueRow, decision: 'move' | 'here') => Promise<string>>(
      async () => 'That conversation is unavailable. Nothing was moved.',
    )
    queue.supply(
      { rows: [question], walk: 'every-conversation-that-routed', ledgers: 1, rowsUnread: 0 },
      { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
      {
        held: new Set(),
        answerable: new Map(),
        now: 100,
        lastLookAnswered: { questions: true, decisions: true },
        answeredFromHere: new Set(),
      },
      { move: moved, travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
    )
    try {
      const m = mount(PersonsQueue, {})
      m.q('move-it').click()
      await nextTick()
      await nextTick()
      expect(moved).toHaveBeenCalledTimes(1)
      expect(moved.mock.calls[0]?.[1]).toBe('move')
      expect(m.q('question-refused').textContent).toContain('Nothing was moved.')
      m.q('do-it-here').click()
      await nextTick()
      expect(moved).toHaveBeenCalledTimes(2)
      expect(moved.mock.calls[1]?.[1]).toBe('here')
    } finally {
      queue.supply(
        null,
        null,
        {
          held: new Set(),
          answerable: new Map(),
          now: 100,
          lastLookAnswered: { questions: false, decisions: false },
          answeredFromHere: new Set(),
        },
        { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
      )
    }
  })

  it('shows both presses and keeps the ordinary reply visible', async () => {
    const m = mount(QuestionCard, { reading: reading() }, { width: 380 })
    expect(m.q('question-words').textContent).toContain('release conversation')
    expect(m.q('move-offer').textContent).toContain('W2 · Fictional release')
    expect(visible(m.q('move-it'))).toBe(true)
    expect(visible(m.q('do-it-here'))).toBe(true)
    expect(m.host.querySelector('textarea')).toBeNull()
    expect(m.all('question-option')).toHaveLength(0)
  })

  it.each(['move', 'here'] as const)(
    'only a %s press emits the typed decision, once',
    async (decision) => {
      const acted = vi.fn()
      const answered = vi.fn()
      const m = mount(QuestionCard, { reading: reading(), onMove: acted, onAnswer: answered })
      expect(acted).not.toHaveBeenCalled()
      m.q(decision === 'move' ? 'move-it' : 'do-it-here').click()
      await nextTick()
      m.q('move-it').click()
      m.q('do-it-here').click()
      expect(acted).toHaveBeenCalledExactlyOnceWith(decision)
      expect(answered).not.toHaveBeenCalled()
    },
  )

  it('a refusal reopens the same buttons for a later press', async () => {
    const state = reactive({ ...reading() })
    const draft = reactive<RequestDraft>({
      answers: new Map(),
      sent: false,
      answered: false,
      open: false,
    })
    const acted = vi.fn(() => {
      draft.sent = true
    })
    const component = defineComponent({
      setup: () => () => h(QuestionCard, { reading: state, draft, onMove: acted }),
    })
    const m = mount(component, {})
    m.q('move-it').click()
    await nextTick()
    state.refused = 'That conversation is unavailable. Nothing was moved.'
    draft.sent = false
    await nextTick()
    expect(m.q('question-refused').textContent).toContain('Nothing was moved')
    expect((m.q('move-it') as HTMLButtonElement).disabled).toBe(false)
    m.q('move-it').click()
    expect(acted).toHaveBeenCalledTimes(2)
    await nextTick()
    expect((m.q('move-it') as HTMLButtonElement).disabled).toBe(true)
    state.refused = 'That conversation is unavailable. Nothing was moved.'
    draft.sent = false
    await nextTick()
    expect(m.q('question-refused').textContent).toContain('Nothing was moved')
    expect((m.q('move-it') as HTMLButtonElement).disabled).toBe(false)
    m.q('move-it').click()
    expect(acted).toHaveBeenCalledTimes(3)
    state.state = 'answered'
    state.movedTo = { sessionId: 'target', messageId: 'm' }
    await nextTick()
    expect(m.all('move-it')).toHaveLength(0)
    expect(m.q('moved-to').textContent).toContain('Moved to')
  })

  it('a closed move has a destination pointer and no live presses', async () => {
    const opened = vi.fn()
    const m = mount(QuestionCard, {
      reading: {
        ...reading(),
        state: 'answered',
        movedTo: { sessionId: 'target', messageId: 'm' },
      },
      onOpenConversation: opened,
    })
    expect(m.all('move-it')).toHaveLength(0)
    expect(m.all('do-it-here')).toHaveLength(0)
    m.q('moved-to').click()
    expect(opened).toHaveBeenCalledExactlyOnceWith('target')
  })

  it('a new move receipt opens its linked destination through the resolver', async () => {
    const destinationLink = conversationLink('target', 'Fictional release')
    const answer: LinkResolution = {
      state: 'available',
      kind: 'conversation',
      title: 'Fictional release',
      status: 'Idle',
      opens: { sessionId: 'target' },
    }
    const resolve = vi.fn<(target: string) => Promise<LinkResolution>>(async () => answer)
    const open = vi.fn<(reading: LinkResolution) => Promise<boolean>>(async () => true)
    const legacyOpen = vi.fn()
    const component = defineComponent({
      setup: () => () =>
        h(
          MessageLinks,
          { resolve, open },
          {
            default: () =>
              h(QuestionCard, {
                reading: {
                  ...reading(),
                  state: 'answered',
                  movedTo: {
                    sessionId: 'target',
                    messageId: 'm',
                    destinationLink,
                    receiptLine: moveReceiptLine(destinationLink),
                  },
                },
                onOpenConversation: legacyOpen,
              }),
          },
        ),
    })
    const m = mount(component, {})
    expect(m.q('moved-to').textContent).toBe('Your request is now in Fictional release.')
    await expect.poll(() => resolve.mock.calls.length).toBe(1)
    m.q('message-link').click()
    await expect.poll(() => open.mock.calls.length).toBe(1)
    expect(open).toHaveBeenCalledWith(answer)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolve).toHaveBeenLastCalledWith('brocrew://conversation/target')
    expect(legacyOpen).not.toHaveBeenCalled()
    expect(m.host.querySelector('a[href^="brocrew:"]')).toBeNull()
  })

  it('the complete conversation forwards the move press without replacing the answer text', async () => {
    const events: TranscriptEvent[] = [
      {
        type: 'tool_inventory',
        source: 'fictional declared tools',
        naming: { prefix: 'mcp__', separator: '__' },
        declared: {
          server: 'brobot',
          tools: [{ name: 'ask_question', description: '', parameters: [] }],
        },
        published: null,
      },
      { type: 'user_turn', text: 'Where does this fictional release belong?' },
      { type: 'assistant_message', text: 'The release is planned for tomorrow.' },
      {
        type: 'tool_call',
        id: 'call',
        name: 'mcp__brobot__ask_question',
        summary: JSON.stringify({ who_answers: 'a-person', move_to: 'target' }),
      },
      {
        type: 'question_asked',
        requestId: 'request',
        prompt: 'The release conversation has the answer.',
        questions: [
          {
            id: 'answer',
            prompt: 'The release conversation has the answer.',
            options: [{ label: 'Move it' }, { label: 'Do it here' }],
          },
        ],
        move: MOVE,
      },
      { type: 'request_routed', requestId: 'request', to: 'a-person' },
      { type: 'tool_result', id: 'call', summary: 'Recorded.', ok: true },
    ]
    const acted = vi.fn()
    const m = mount(ConversationPane, paneProps({ record: record(events), onMove: acted }))
    await nextTick()
    expect(m.host.textContent).toContain('The release is planned for tomorrow.')
    m.q('move-it').click()
    expect(acted).toHaveBeenCalledExactlyOnceWith('request', 'move')
  })

  it.each(['moved', 'here', 'refused'] as const)(
    'the %s receipt controls navigation',
    async (outcome) => {
      const ack: MoveRequestAck =
        outcome === 'moved'
          ? { outcome, sessionId: 'resolved-target', messageId: 'm' }
          : outcome === 'refused'
            ? { outcome, reason: 'Nothing was moved.' }
            : { outcome }
      let finish!: (value: MoveRequestAck) => void
      const decide = vi.fn(
        () =>
          new Promise<MoveRequestAck>((resolve) => {
            finish = resolve
          }),
      )
      const open = vi.fn(async () => true)
      const refresh = vi.fn(async () => undefined)
      const done = moveRequestFromWindow(
        {
          sessionId: 'source',
          requestId: 'request',
          decision: outcome === 'here' ? 'here' : 'move',
        },
        { decide, open, refresh },
      )
      expect(open).not.toHaveBeenCalled()
      expect(decide).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'source',
        requestId: 'request',
        decision: outcome === 'here' ? 'here' : 'move',
      })
      finish(ack)
      expect(await done).toBe(outcome === 'refused' ? 'Nothing was moved.' : null)
      if (outcome === 'moved') expect(open).toHaveBeenCalledExactlyOnceWith('resolved-target')
      else expect(open).not.toHaveBeenCalled()
      expect(refresh).toHaveBeenCalledTimes(outcome === 'refused' ? 0 : 1)
    },
  )

  it('a handover stays unconfirmed until the matching delivered turn arrives', () => {
    const movedFrom = {
      sessionId: 'source',
      name: 'W1 · Fictional planning',
      ordinal: 1,
      requestId: 'request',
    }
    const state = createTranscript()
    applyEvent(
      state,
      {
        type: 'message_queued',
        messageId: 'm',
        kind: 'work',
        text: 'Original fictional request.',
        movedFrom,
      },
      1,
      1,
    )
    applyEvent(
      state,
      {
        type: 'message_unqueued',
        messageId: 'm',
        reason: 'handover',
        text: 'Original fictional request.',
        movedFrom,
      },
      2,
      2,
    )
    const item = state.items.find((one) => one.kind === 'queued')
    expect(item?.kind).toBe('queued')
    if (item?.kind !== 'queued') throw new Error('The unconfirmed row is missing')
    const m = mount(QueuedMessage, { item, ownAgent: 'Editor' })
    expect(m.host.textContent).toContain(MOVE_SEND_UNCONFIRMED)
    expect(m.host.textContent).not.toContain('not sent')
    applyEvent(
      state,
      {
        type: 'user_turn',
        text: 'Another request.',
        movedFrom: { ...movedFrom, requestId: 'another' },
      },
      3,
      3,
    )
    expect(state.items.filter((one) => one.kind === 'queued')).toHaveLength(1)
    applyEvent(state, { type: 'user_turn', text: 'Original fictional request.', movedFrom }, 4, 4)
    expect(state.items.filter((one) => one.kind === 'queued')).toHaveLength(0)
  })

  it('both waiting and delivered words link back without altering the request body', () => {
    const movedFrom = {
      sessionId: 'source',
      name: 'W1 · Fictional planning',
      ordinal: 1,
      requestId: 'request',
    }
    const opened = vi.fn()
    const delivered = mount(UserMessage, {
      item: { kind: 'user', id: 'u', text: 'Original fictional request.', movedFrom, at: 1 },
      onOpenConversation: opened,
    })
    expect(delivered.q('user-message').textContent).toBe('Original fictional request.')
    delivered.q('moved-from').click()
    const queued = mount(QueuedMessage, {
      item: {
        kind: 'queued',
        id: 'q',
        text: 'Original fictional request.',
        movedFrom,
        messageId: 'm',
        outcome: null,
        at: 1,
      },
      ownAgent: 'Editor',
      onOpenConversation: opened,
    })
    queued.q('queued-moved-from').click()
    expect(opened).toHaveBeenCalledTimes(2)
    expect(opened).toHaveBeenLastCalledWith('source')
  })
})
