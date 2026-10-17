import { describe, expect, it } from 'vitest'
import {
  applyEvent,
  createTranscript,
  type TranscriptItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import {
  fromOutside,
  inACard,
  TO_WORD,
  WHOSE_WORDS,
  whoseWordsOf,
} from '../src/renderer/src/lib/from-outside'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import type { WorkReport } from '../src/shared/tasks'

/**
 * # 🔴 658 · Whose words a row carries — and so whether it may be drawn as a participant's
 *
 * An incoming agent message must not imply that the agent participates in the person’s
 * conversation or can read the person’s input.
 *
 * ⛔ **Every kind is classified, and `satisfies` makes a new one a compile error** — so this file pins
 * the VALUES that decide the drawing, per kind, with a planted control on each side: a fold that
 * carded everything fails the participants, and a fold that shifted every card fails the stall.
 * ⚠️ **Derived from the row's kind and its own fields, never its text** — the last test plants a
 * participant whose words NAME another agent.
 */

const fold = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const only = (events: readonly TranscriptEvent[]): TranscriptItem => {
  const items = fold(events).items
  expect(items, 'the fixture folded to more or fewer than one row').toHaveLength(1)
  return items[0] as TranscriptItem
}

const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.3',
  state: 'answered',
  outcome: 'done',
  ...over,
})

const STALL = report({ state: 'stalled', stalledBecause: 'app_restarted', outcome: undefined })

const relayed = (text: string, from: string | null): TranscriptEvent =>
  ({
    type: 'user_turn',
    text,
    ...(from === null ? {} : { relayedFrom: `sess_${from}`, relayedFromProfile: from }),
  }) as TranscriptEvent

const reported = (work: WorkReport, from: string | null): TranscriptEvent =>
  ({
    type: 'user_turn',
    text: 'W1.3 was answered.',
    attribution: 'app_authored',
    work,
    ...(from === null ? {} : { relayedFrom: `sess_${from}`, relayedFromProfile: from }),
  }) as TranscriptEvent

const queued = (over: object): TranscriptEvent =>
  ({ type: 'message_queued', text: 'held words', messageId: 'm_1', ...over }) as TranscriptEvent

/** ⚑ The two questions the drawing asks of a row, answered together. */
const drawn = (item: TranscriptItem): { card: boolean; outside: boolean; sender?: string } => {
  const outside = fromOutside(item)
  return {
    card: inACard(item),
    outside: outside !== null,
    ...(outside?.sender === undefined ? {} : { sender: outside.sender }),
  }
}

describe('§1 · every kind the drawing treats differently, each beside its control', () => {
  it('⚑ the conversation’s two voices are neither carded nor from outside — the participant control', () => {
    expect(drawn(only([{ type: 'user_turn', text: 'mine' } as TranscriptEvent]))).toEqual({
      card: false,
      outside: false,
    })
    expect(
      drawn(only([{ type: 'assistant_message', text: 'the agent’s own' } as TranscriptEvent])),
    ).toEqual({ card: false, outside: false })
  })

  it('🔴 a relayed turn is from outside — named when the relayer is, unnamed when it is not', () => {
    expect(drawn(only([relayed('do the migration', 'ada')]))).toEqual({
      card: true,
      outside: true,
      sender: 'ada',
    })
    // ⛔ a turn relayed by a conversation with no identity row is STILL from outside
    const unnamed = only([
      { type: 'user_turn', text: 'x', relayedFrom: 'sess_old' } as TranscriptEvent,
    ])
    expect(drawn(unnamed)).toEqual({ card: true, outside: true })
  })

  it('🔴 a work report is a card; only a REPLY is from outside — a stall is the app’s own words', () => {
    expect(drawn(only([reported(report(), 'ada')]))).toEqual({
      card: true,
      outside: true,
      sender: 'ada',
    })
    expect(drawn(only([reported(STALL, null)]))).toEqual({ card: true, outside: false })
  })

  it('🔴 the held twins: a held reply and a held relay are from outside; a held stall is a card only', () => {
    expect(
      drawn(only([queued({ relayedFrom: 'sess_ada', relayedFromProfile: 'ada', work: report() })])),
    ).toEqual({ card: true, outside: true, sender: 'ada' })
    expect(drawn(only([queued({ relayedFrom: 'sess_ada', relayedFromProfile: 'ada' })]))).toEqual({
      card: true,
      outside: true,
      sender: 'ada',
    })
    expect(drawn(only([queued({ work: STALL })]))).toEqual({ card: true, outside: false })
    // ⚑ the control: a message the PERSON typed while a turn ran is theirs, held
    expect(drawn(only([queued({})]))).toEqual({ card: false, outside: false })
  })

  it('⛔ the app’s own voices, and shared memory, are neither carded nor from outside', () => {
    // ⚠️ Built as the ROW rather than folded: each producer needs its own ledger context, and the
    // question here is about the KIND — `WHOSE_WORDS` says `the-app` / `shared-memory` for these.
    for (const kind of ['notice', 'continuation', 'appNotice', 'memoryNote'] as const) {
      const row = { kind, id: `${kind}-1`, text: 'Ada was stopped' }
      expect(drawn(row as unknown as TranscriptItem), kind).toEqual({ card: false, outside: false })
    }
    // ⚑ the fold's go-ahead really is `continuation` — the kind above is the one it draws as
    expect(
      only([{ type: 'user_turn', text: 'go', attribution: 'app_authored' } as TranscriptEvent])
        .kind,
    ).toBe('continuation')
  })

  it('⚑ our own messaging call is a card, NOT from outside; any other tool row is neither', () => {
    const call = (outgoing: object | undefined): TranscriptItem =>
      ({
        kind: 'tool',
        id: 't1',
        callId: 'c1',
        name: 'x',
        summary: '{}',
        result: null,
        ...(outgoing === undefined ? {} : { outgoing }),
      }) as unknown as TranscriptItem
    expect(drawn(call({ tool: 'message_agent', sent: null }))).toEqual({
      card: true,
      outside: false,
    })
    expect(drawn(call(undefined))).toEqual({ card: false, outside: false })
  })

  it('⛔ never from the TEXT — a participant whose words name another agent is still a participant', () => {
    expect(
      drawn(
        only([
          {
            type: 'user_turn',
            text: 'Ada to BroBot: from another conversation',
          } as TranscriptEvent,
        ]),
      ),
    ).toEqual({ card: false, outside: false })
  })
})

describe('§2 · the table and the fold that feeds it', () => {
  it('⚑ exactly one kind is `another-conversation` today, and two are decided per row', () => {
    const by = (value: string): string[] =>
      Object.entries(WHOSE_WORDS)
        .filter(([, whose]) => whose === value)
        .map(([kind]) => kind)
        .sort()
    expect(by('another-conversation')).toEqual(['relayed'])
    expect(by('depends-on-the-row')).toEqual(['queued', 'workReport'])
    expect(by('shared-memory')).toEqual(['memoryNote'])
    expect(whoseWordsOf('user')).toBe('this-conversation')
  })

  it('🔴 the fold carries the relayer onto a REPLY, and nothing onto a report nobody relayed', () => {
    // ⛔ `WorkReportItem.relayedFromProfile` is new at `658`: the event always carried it and the
    // fold dropped it, which is why a reply could not say who sent it
    const reply = only([reported(report(), 'ada')])
    expect(reply.kind === 'workReport' && reply.relayedFromProfile).toBe('ada')
    const stall = only([reported(STALL, null)])
    expect(stall.kind === 'workReport' && 'relayedFromProfile' in stall).toBe(false)
    expect(stall.kind === 'workReport' && 'relayed' in stall).toBe(false)
    // ⚠️ an empty relayer is the absence of one, not a name
    const empty = only([
      {
        ...(reported(report(), null) as object),
        relayedFrom: 'sess_ada',
        relayedFromProfile: '',
      } as TranscriptEvent,
    ])
    expect(empty.kind === 'workReport' && empty.relayedFromProfile).toBeUndefined()
    expect(drawn(empty)).toEqual({ card: true, outside: true })
  })

  it('⚑ the word between the two names is one constant — the DOM test reads the heading it makes', () => {
    expect(TO_WORD).toBe('to')
  })
})
