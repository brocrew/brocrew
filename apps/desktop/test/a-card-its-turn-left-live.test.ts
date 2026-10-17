import { describe, expect, it } from 'vitest'
import type { SessionRef } from '@brobot2/runtime'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  HELD_REQUEST_LET_GO,
  isAwaitingAnswer,
  NOTHING_WAITS_FOR_THIS_ANSWER,
  type PermissionItem,
  type TranscriptState,
  type UserInputItem,
} from '../src/renderer/src/lib/transcript'
import { WINDOW_MAX_EVENTS } from '../src/renderer/src/lib/transcript-window'

/**
 * 🔴 **D-001 · `738` P-1 — a card its turn ended under, while the host still held it.**
 *
 * ⚑ Measured on `sess_0d870a6d` (`smoke:ui` 47, batch 2): BroBot on Codex in `ask` called
 * `spawn_agent` from a code-mode cell, the card went up (`number:2`), the model gave up waiting and
 * the turn COMPLETED with the cell still awaiting the call. No `request_resolved` came, and the
 * status stayed `waiting_permission` (the machine keeps a wait across a terminal, 122). ⛔ The fold
 * settled the card anyway — *"settled when the turn ended"*, no buttons — so the composer stayed
 * frozen over a card nobody could answer and the queued message never went. Only Stop got out.
 *
 * ⚑ The rows below are that ledger's own, in its order.
 */

const ref: SessionRef = {
  provider: 'codex',
  sessionId: '01a0e0ff-3581-70a2-bee8-45cfcfb089e8',
  cwd: '/tmp/queue',
  rotation: 0,
}

/** ⚑ The measured card, byte for byte but the folder. */
const spawnCard: TranscriptEvent = {
  type: 'permission_request',
  id: 'number:2',
  kind: 'command',
  action: 'spawn_agent',
  detail:
    'spawn_agent {"profile_slug":"formatting-pm","purpose":"Handle formatting and presentation requests"}',
  scope: {
    cwd: '/tmp/queue',
    paths: [],
    networkHosts: [],
    persistence: 'once',
    amendments: [],
    availableDecisions: ['allow', 'deny', 'cancel'],
    underDisclosed: false,
    approvalMode: 'ask',
  },
}

const question: TranscriptEvent = {
  type: 'user_input_request',
  id: 'number:3',
  prompt: 'Which project?',
  questions: [],
}

const started: TranscriptEvent = { type: 'session', state: 'started', ref }
const working: TranscriptEvent = { type: 'status', state: 'working' }
const held: TranscriptEvent = { type: 'status', state: 'waiting_permission' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const completed: TranscriptEvent = { type: 'turn', state: 'completed' }

function feed(...events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

function more(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

function theCard(state: TranscriptState): PermissionItem {
  const item = state.items.find((one): one is PermissionItem => one.kind === 'permission')
  if (item === undefined) throw new Error('no permission card was drawn')
  return item
}

function theQuestion(state: TranscriptState): UserInputItem {
  const item = state.items.find((one): one is UserInputItem => one.kind === 'userInput')
  if (item === undefined) throw new Error('no question card was drawn')
  return item
}

describe('D-001 · a Codex turn completes with an agent-tool card open', () => {
  it('🔴 the card the host still holds stays answerable, and the pending count says so', () => {
    const state = feed(started, working, spawnCard, held, completed)
    expect(theCard(state).note, 'the card was settled under a wait the host still holds').toBeNull()
    expect(isAwaitingAnswer(theCard(state))).toBe(true)
    // ⚑ What the composer, the header and the Open tab read — `frozen` is now true to the screen.
    expect(state.pending.permissions).toBe(1)
    expect(state.status).toBe('waiting_permission')
  })

  it('the paired positive: a card the host is NOT holding still settles at the turn end', () => {
    // ⚑ `working` at the terminal means the wait count was zero: nothing holds this card, and the
    // ending's own words stay (085).
    const state = feed(started, working, spawnCard, working, completed)
    expect(theCard(state).note).toBe('settled when the turn ended')
    expect(state.pending.permissions).toBe(0)
  })

  it('a question is held the same way, on the same count', () => {
    const state = feed(started, working, question, held, { type: 'turn', state: 'failed' })
    expect(theQuestion(state).note).toBeNull()
    expect(state.pending.questions).toBe(1)
  })

  it('⛔ an interrupted turn still settles it — a Stop safe-rejects every open card first', () => {
    const state = feed(started, working, spawnCard, held, { type: 'turn', state: 'interrupted' })
    expect(theCard(state).note).toBe('settled when the turn was interrupted')
    expect(state.pending.permissions).toBe(0)
  })

  it('answered after the turn: the decision is the card’s ending, and `idle` adds nothing', () => {
    const state = feed(started, working, spawnCard, held, completed)
    more(state, { type: 'user_decision', requestId: 'number:2', outcome: 'allow' }, idle)
    expect(theCard(state).outcome).toBe('allow')
    expect(theCard(state).note).toBeNull()
    expect(state.pending.permissions).toBe(0)
  })

  it('⚠️ the answer’s `idle` can land before its row, and the row still wins', () => {
    const state = feed(started, working, spawnCard, held, completed, idle)
    more(state, { type: 'user_decision', requestId: 'number:2', outcome: 'allow' })
    expect(theCard(state).outcome).toBe('allow')
    expect(theCard(state).note).toBeNull()
  })

  it('🔴 a Stop that declines it: once nothing holds the card, it says so and takes its buttons', () => {
    const state = feed(started, working, spawnCard, held, completed)
    more(state, { type: 'work_interrupted', by: 'a-person' }, idle)
    expect(theCard(state).note).toBe(HELD_REQUEST_LET_GO)
    expect(isAwaitingAnswer(theCard(state))).toBe(false)
    expect(state.pending.permissions).toBe(0)
  })

  // ⚑ **T-002 · `1001 M8`**: the let-go has its own QUESTION arm, and no test here reached it.
  it('…and a QUESTION its turn left live is let go the same way', () => {
    const state = feed(started, working, question, held, completed)
    more(state, { type: 'work_interrupted', by: 'a-person' }, idle)
    expect(theQuestion(state).note).toBe(HELD_REQUEST_LET_GO)
    expect(isAwaitingAnswer(theQuestion(state))).toBe(false)
    expect(state.pending.questions).toBe(0)
  })

  // ⚑ **T-002 · `1001 M9`**: the wait can end while a burst keeps the machine `working` (122), and
  // that `working` lets go as `idle` does.
  it('…and so does a `working` that ends the wait while something still runs', () => {
    const state = feed(started, working, spawnCard, held, completed)
    more(state, working)
    expect(theCard(state).note).toBe(HELD_REQUEST_LET_GO)
    expect(state.pending.permissions).toBe(0)
  })

  it('a later `idle` does not reach back to a card an earlier turn settled', () => {
    const state = feed(started, working, spawnCard, working, completed, idle)
    expect(theCard(state).note).toBe('settled when the turn ended')
  })

  // ⚑ **D-017b** — one sentence for every stop (`05` rule 5): which stop it was is a process fact.
  it('a session that closes while it is held says nothing waits for the answer any more', () => {
    const state = feed(started, working, spawnCard, held, completed)
    more(state, { type: 'session', state: 'ended', ref }, { type: 'status', state: 'ended' })
    expect(theCard(state).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    expect(isAwaitingAnswer(theCard(state))).toBe(false)
  })
})

describe('D-001 · the held card survives a window release whose prefix held its `turn`', () => {
  const SESSION = 'sess_d001'
  const message = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage => ({
    sessionId: SESSION,
    ordinal,
    at: 1_790_000_000_000 + ordinal * 1_000,
    event,
  })

  function live(...events: TranscriptEvent[]): SessionRecord {
    const record = createSessionRecord(SESSION)
    for (const event of events) acceptEvent(record, message(record.nextOrdinal, event))
    return record
  }

  function controlCard(record: SessionRecord): PermissionItem {
    return theCard(record.control)
  }

  it('🔴 the card comes back live, and the `idle` after a Stop still settles it', () => {
    const record = live(started, working, spawnCard, held, completed)
    // ⚑ A background agent keeps the ledger moving while the card waits.
    for (let i = 0; i < WINDOW_MAX_EVENTS + 10; i++) {
      acceptEvent(
        record,
        message(record.nextOrdinal, { type: 'assistant_message', text: `still working ${i}` }),
      )
    }
    expect(record.window.hasOlder, 'the window never released a slab').toBe(true)
    expect(record.window.entries.some((entry) => entry.event.type === 'turn')).toBe(false)
    expect(isAwaitingAnswer(controlCard(record))).toBe(true)

    acceptEvent(record, message(record.nextOrdinal, idle))
    expect(controlCard(record).note).toBe(HELD_REQUEST_LET_GO)
    expect(record.control.pending.permissions).toBe(0)
  })
})
