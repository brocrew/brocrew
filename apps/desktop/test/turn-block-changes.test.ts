import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { derivePieces } from '../src/shared/tasks'

import { EMPTY_TURN_BLOCK, turnBlockChanges } from '../src/main/runtime/turn-block-changes'
import {
  TURN_BLOCK_WORDS,
  whatThisAppAddsToATurn,
  type AHelperInTheTurn,
} from '../src/main/runtime/what-this-app-adds-to-a-turn'

const input = {
  now: 60_000,
  person: false,
  helpers: [] as readonly AHelperInTheTurn[],
  personWait: '[]',
  nobodyWaiting: true,
  replyQuestionTurn: null,
  current: { kind: 'none' as const },
}
const helper = (id: number, urgent = false): AHelperInTheTurn => ({
  piece: `piece-${id}`,
  label: `W1.${id}`,
  owner: `worker-${id}`,
  conversation: `conversation W1.${id} · Fictional job`,
  name: `worker-${id}`,
  state: urgent ? 'not being worked on' : 'being worked on',
  givenAt: 0,
  changedAt: null,
  urgent,
})
const block = (extra: Parameters<typeof whatThisAppAddsToATurn>[0]['extra']): string =>
  whatThisAppAddsToATurn({
    now: input.now,
    aPersonStartedIt: true,
    thePersonLastWroteAt: null,
    questions: null,
    waiting: null,
    extra,
  })

describe('turn block changes', () => {
  it('shows current work on both person-started and app-started turns', () => {
    const first = turnBlockChanges(input, EMPTY_TURN_BLOCK)
    expect(block(first.extra)).toContain(TURN_BLOCK_WORDS.nobody)
    expect(block(first.extra)).toContain(TURN_BLOCK_WORDS.currentNone)
    const unchanged = turnBlockChanges({ ...input, now: 120_000 }, first.next)
    expect(block(unchanged.extra)).not.toContain(TURN_BLOCK_WORDS.nobody)
    expect(unchanged.extra.currentWork).toEqual({ kind: 'none' })
    expect(turnBlockChanges({ ...input, person: true }, first.next).extra.currentWork).toEqual({
      kind: 'none',
    })
    expect(turnBlockChanges({ ...input, person: true }, first.next).extra.nobodyWaiting).toBe(true)
  })

  it('does not mistake incomplete facts for empty, a count, or no change', () => {
    const partial = turnBlockChanges(
      { ...input, helpers: [], helpersIncomplete: true, personWait: null, nobodyWaiting: false },
      EMPTY_TURN_BLOCK,
    )
    expect(block(partial.extra)).toContain('list_tasks shows the work you gave.')
    expect(block(partial.extra)).not.toContain(TURN_BLOCK_WORDS.nobody)
    expect(block(partial.extra)).not.toContain('no change')
    expect(partial.next.personWait).toBeNull()
  })

  it('shows the newest recorded failure once per holder on successive ordinary turns', () => {
    const older = { turnOrdinal: 3, message: 'Earlier provider error.' }
    const newest = { turnOrdinal: 9, message: 'Current provider error.' }
    const conversation = 'conversation W1.1 · Fictional job'
    const sameHolder = { owner: 'worker-1', conversation }
    const helpers = [
      { ...helper(1), ...sameHolder, providerTurnFailure: older },
      { ...helper(2), ...sameHolder, providerTurnFailure: newest },
      { ...helper(3), ...sameHolder, providerTurnFailure: newest },
      { ...helper(4, true), state: null },
      helper(5),
    ]
    const first = turnBlockChanges({ ...input, helpers }, EMPTY_TURN_BLOCK)
    const second = turnBlockChanges({ ...input, helpers, now: 120_000 }, first.next)
    const diagnosis =
      "Conversation W1.1 · Fictional job couldn't run: Current provider error. Check its status and settings before choosing how to continue. · task W1.2"
    for (const answer of [first, second]) {
      expect(answer.extra.helpers?.rows.map((row) => row.label)).toEqual([
        'W1.4',
        'W1.1',
        'W1.2',
        'W1.3',
        'W1.5',
      ])
      const text = block(answer.extra)
      expect(text.split('\n').filter((line) => line.includes("couldn't run"))).toEqual([
        `- ${diagnosis}`,
      ])
      expect(text).toContain(TURN_BLOCK_WORDS.helperUnknown('W1.4'))
      expect(text).not.toContain(older.message)
    }
  })

  it('caps rows at five, rotates persistent urgent helpers, and leaves overflow changes eligible', () => {
    const rows = Array.from({ length: 8 }, (_, i) => helper(i + 1, true))
    const first = turnBlockChanges({ ...input, helpers: rows }, EMPTY_TURN_BLOCK)
    expect(first.extra.helpers?.rows.map((row) => row.label)).toEqual([
      'W1.1',
      'W1.2',
      'W1.3',
      'W1.4',
      'W1.5',
    ])
    expect(first.extra.helpers?.more).toBe(3)
    const second = turnBlockChanges({ ...input, helpers: rows }, first.next)
    expect(second.extra.helpers?.rows.slice(0, 3).map((row) => row.label)).toEqual([
      'W1.6',
      'W1.7',
      'W1.8',
    ])
    expect(block(first.extra)).toContain('and 3 more: list_tasks')
    const ordinary = rows.map((row) => ({ ...row, urgent: false }))
    const ordinaryFirst = turnBlockChanges({ ...input, helpers: ordinary }, EMPTY_TURN_BLOCK)
    const ordinarySecond = turnBlockChanges({ ...input, helpers: ordinary }, ordinaryFirst.next)
    expect(ordinarySecond.extra.helpers?.rows.map((row) => row.label)).toEqual([
      'W1.6',
      'W1.7',
      'W1.8',
      'W1.1',
      'W1.2',
    ])
    expect(block(ordinarySecond.extra)).toContain('and 3 more: list_tasks')
  })

  it('shows five open rows and the count even when one status could not be read', () => {
    const rows = Array.from({ length: 7 }, (_, i) => helper(i + 1))
    rows[1] = { ...rows[1]!, state: null }
    const shown = turnBlockChanges({ ...input, helpers: rows }, EMPTY_TURN_BLOCK)
    const rendered = block(shown.extra)
    expect(shown.extra.helpers?.rows).toHaveLength(5)
    expect(rendered).toContain('W1.2 · status unknown: list_tasks reads it')
    expect(rendered).toContain('and 2 more: list_tasks')
    expect(rendered).not.toContain("Helpers' status is not fully available")
  })

  it('hints once per eligible reply, and never hints while somebody is waiting', () => {
    const first = turnBlockChanges({ ...input, replyQuestionTurn: 'turn-1' }, EMPTY_TURN_BLOCK)
    expect(block(first.extra)).toContain(TURN_BLOCK_WORDS.replyQuestion)
    expect(
      turnBlockChanges({ ...input, replyQuestionTurn: 'turn-1' }, first.next).extra.replyQuestion,
    ).toBeUndefined()
    expect(
      turnBlockChanges(
        { ...input, personWait: '["approval"]', nobodyWaiting: false, replyQuestionTurn: 'turn-2' },
        first.next,
      ).extra.replyQuestion,
    ).toBeUndefined()
  })

  it('does not truncate an overlong address or present it as a complete helper list', () => {
    const longLabel = 'W1.' + '1.'.repeat(100)
    const result = turnBlockChanges(
      { ...input, helpers: [{ ...helper(1), label: longLabel }] },
      EMPTY_TURN_BLOCK,
    )
    expect(block(result.extra)).toContain('piece-1 · status unknown: list_tasks reads it')
    expect(block(result.extra)).not.toContain(longLabel.slice(0, 20))
    expect(
      block({ currentWork: { kind: 'piece', label: longLabel, title: 'work', status: null } }),
    ).toContain(TURN_BLOCK_WORDS.currentUnavailable)
  })

  it('heads helper rows, omits an unknown age, and uses only the recorded last change', () => {
    const rows = [
      { ...helper(1), changedAt: null },
      { ...helper(2), givenAt: 0, changedAt: 60_000 },
    ]
    const rendered = block(
      turnBlockChanges({ ...input, now: 180_000, helpers: rows }, EMPTY_TURN_BLOCK).extra,
    )
    expect(rendered).toContain(
      'Work you gave, still open:\n- conversation W1.1 · Fictional job · task W1.1 · worker-1 · being worked on\n',
    )
    // The formatter's clock is input.now (60,000); givenAt must never supply an age.
    expect(rendered).toContain('W1.2 · worker-2 · being worked on · just now')
    expect(rendered).not.toContain('given ')
    expect(block({ helpers: { rows: [], more: 0 } })).not.toContain('Work you gave')
  })

  it('tracks state changes and status revisions without inventing an age from a give or an unrelated event', () => {
    const entries: PersistedEventInfo[] = []
    const add = (at: number, event: TranscriptEvent) =>
      entries.push({ ordinal: entries.length + 1, at, event })
    const read = () => derivePieces('worker', entries, { trackChanges: true })[0]!
    add(10, {
      type: 'work_given',
      piece: 'piece',
      label: 'W1.1',
      parent: 'root',
      givenBy: 'giver',
      title: 'Work',
      brief: 'Work',
    })
    expect(read().lastRecordedChangeAt).toBeNull()
    expect(derivePieces('worker', entries)[0]).not.toHaveProperty('lastRecordedChangeAt')
    add(20, { type: 'work_status_set', piece: 'piece', line: 'Started', by: 'giver' })
    expect(read().lastRecordedChangeAt).toBe(20)
    add(30, {
      type: 'user_turn',
      text: 'Work',
      attribution: 'app_authored',
      relayedFrom: 'giver',
      says: 'note',
    })
    add(40, { type: 'turn', state: 'completed' })
    expect(read().state).toBe('stalled')
    expect(read().lastRecordedChangeAt).toBe(40)
    add(45, { type: 'status', state: 'working' })
    add(49, { type: 'assistant_message', text: 'unrelated' })
    expect(read().state).toBe('working')
    expect(read().lastRecordedChangeAt).toBe(45)
    add(49, { type: 'work_status_set', piece: 'piece', line: 'Later revision', by: 'giver' })
    expect(read().lastRecordedChangeAt).toBe(49)
    // Recording order still wins when the wall clock moves backward.
    add(48, { type: 'work_status_set', piece: 'piece', line: 'Newest revision', by: 'giver' })
    expect(read().lastRecordedChangeAt).toBe(48)
    add(50, {
      type: 'work_replied',
      piece: 'piece',
      outcome: 'done',
      summary: 'Finished',
      resources: [],
    })
    expect(read().state).toBe('answered')
    expect(read().lastRecordedChangeAt).toBe(50)
    add(55, { type: 'work_status_set', piece: 'piece', line: 'Final line', by: 'giver' })
    expect(read().lastRecordedChangeAt).toBe(55)
  })

  it('keeps new words in one formatter, bounds fields and flattens injected line breaks', () => {
    const rendered = block({
      helpers: { rows: [{ ...helper(1), name: 'A\n' + 'x'.repeat(1000) }], more: 0 },
      currentWork: {
        kind: 'piece',
        label: 'W1',
        title: 'title\n' + 'x'.repeat(1000),
        status: 'status\n' + 'y'.repeat(1000),
      },
    })
    expect(rendered.split('\n')).toHaveLength(6)
    expect(rendered).toContain('…')
    expect([...rendered].length).toBeLessThan(3000)
    expect(
      block({ currentWork: { kind: 'ambiguous', labels: ['W1.1', 'W1.2'], more: 3 } }),
    ).toContain('You hold 5 tasks: W1.1, W1.2 and 3 more. list_tasks shows them.')
  })
})
