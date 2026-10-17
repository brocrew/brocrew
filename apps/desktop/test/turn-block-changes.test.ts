import { describe, expect, it } from 'vitest'
import { derivePieces } from '../src/shared/tasks'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
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
  name: `worker-${id}`,
  state: urgent ? 'not being worked on' : 'being worked on',
  givenAt: 0,
  changedAt: null,
  open: true,
  urgent,
  revision: `working-${id}`,
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
  it('shows cold facts, retains explicit empty, and repeats current work on a person turn', () => {
    const first = turnBlockChanges(input, EMPTY_TURN_BLOCK)
    expect(block(first.extra)).toContain(TURN_BLOCK_WORDS.nobody)
    expect(block(first.extra)).toContain(TURN_BLOCK_WORDS.currentNone)
    const unchanged = turnBlockChanges({ ...input, now: 120_000 }, first.next)
    expect(block(unchanged.extra)).not.toContain(TURN_BLOCK_WORDS.nobody)
    expect(unchanged.extra.currentWork).toBeUndefined()
    expect(turnBlockChanges({ ...input, person: true }, first.next).extra.currentWork).toEqual({
      kind: 'none',
    })
    expect(turnBlockChanges({ ...input, person: true }, first.next).extra.nobodyWaiting).toBe(true)
  })

  it('does not mistake incomplete facts for empty, a count, or no change', () => {
    const partial = turnBlockChanges(
      { ...input, helpers: null, personWait: null, nobodyWaiting: false },
      EMPTY_TURN_BLOCK,
    )
    expect(block(partial.extra)).toContain(TURN_BLOCK_WORDS.helpersUnavailable)
    expect(block(partial.extra)).not.toContain(TURN_BLOCK_WORDS.nobody)
    expect(block(partial.extra)).not.toContain('no change')
    expect(partial.next.personWait).toBeNull()
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
    ])
    expect(
      block(turnBlockChanges({ ...input, helpers: ordinary }, ordinarySecond.next).extra),
    ).toContain('8 pieces out, no change.')
  })

  it('shows an ended reply once, including one that ended while overflowed', () => {
    const rows = Array.from({ length: 6 }, (_, i) => helper(i + 1))
    const first = turnBlockChanges({ ...input, helpers: rows }, EMPTY_TURN_BLOCK)
    const ended = rows.map((row) =>
      row.piece === 'piece-6'
        ? { ...row, open: false, state: 'ended: done', revision: 'done' }
        : row,
    )
    const second = turnBlockChanges({ ...input, helpers: ended }, first.next)
    expect(second.extra.helpers?.rows.map((row) => row.piece)).toEqual(['piece-6'])
    expect(second.extra.helpers?.unchanged).toBe(5)
    expect(turnBlockChanges({ ...input, helpers: ended }, second.next).extra.helpers?.rows).toEqual(
      [],
    )
  })

  it('does not acknowledge unsent snapshots or elapsed age as a helper change', () => {
    const rows = [helper(1)]
    const prepared = turnBlockChanges({ ...input, helpers: rows }, EMPTY_TURN_BLOCK)
    expect(
      turnBlockChanges({ ...input, helpers: rows }, EMPTY_TURN_BLOCK).extra.helpers?.rows,
    ).toHaveLength(1)
    expect(
      turnBlockChanges({ ...input, now: 3_600_000, helpers: rows }, prepared.next).extra.helpers
        ?.rows,
    ).toEqual([])
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
    expect(block(result.extra)).toContain(TURN_BLOCK_WORDS.helpersUnavailable)
    expect(result.next.helpers.size).toBe(0)
    expect(block(result.extra)).not.toContain(longLabel.slice(0, 20))
    expect(
      block({ currentWork: { kind: 'piece', label: longLabel, title: 'work', status: null } }),
    ).toContain(TURN_BLOCK_WORDS.currentUnavailable)
  })

  it.each([false, true])(
    'retains unshown endings through an acknowledged unavailable batch (cold: %s)',
    (cold) => {
      const before = cold
        ? EMPTY_TURN_BLOCK
        : turnBlockChanges({ ...input, now: 100 }, EMPTY_TURN_BLOCK).next
      const a = { ...helper(1), label: 'W1.' + '1.'.repeat(100), givenAt: 200 }
      const b = { ...helper(2), givenAt: 200 }
      const unavailable = turnBlockChanges({ ...input, now: 300, helpers: [a, b] }, before)
      expect(unavailable.extra.helpers).toBeNull()
      expect(unavailable.next.at).toBe(before.at)
      expect(unavailable.next.helpers).toEqual(before.helpers)
      expect(unavailable.next.awaitingEnd.has(b.piece)).toBe(true)
      const ended = { ...b, open: false, state: 'ended: done', revision: 'done' }
      // Apply the host's eligibility filter after acknowledging that unavailable block.
      const eligible = [{ ...a, label: 'W1.1' }, ended].filter(
        (row) =>
          row.open ||
          unavailable.next.awaitingEnd.has(row.piece) ||
          (unavailable.next.at !== null && row.givenAt > unavailable.next.at),
      )
      const corrected = turnBlockChanges(
        { ...input, now: 400, helpers: eligible },
        unavailable.next,
      )
      expect(corrected.extra.helpers?.rows.map((row) => row.piece)).toContain(b.piece)
      expect(corrected.next.at).toBe(400)
      expect(corrected.next.awaitingEnd.has(b.piece)).toBe(false)
      expect(
        turnBlockChanges({ ...input, now: 500, helpers: eligible }, corrected.next).extra.helpers
          ?.rows,
      ).toEqual([])
    },
  )

  it('heads helper rows, omits an unknown age, and uses only the recorded last change', () => {
    const rows = [
      { ...helper(1), changedAt: null },
      { ...helper(2), givenAt: 0, changedAt: 60_000 },
    ]
    const rendered = block(
      turnBlockChanges({ ...input, now: 180_000, helpers: rows }, EMPTY_TURN_BLOCK).extra,
    )
    expect(rendered).toContain('Work you gave:\nW1.1 · worker-1 · being worked on\n')
    // The formatter's clock is input.now (60,000); givenAt must never supply an age.
    expect(rendered).toContain('W1.2 · worker-2 · being worked on · just now')
    expect(rendered).not.toContain('given ')
    expect(block({ helpers: { rows: [], more: 0, unchanged: 1 } })).toContain(
      'Work you gave: 1 piece out, no change.',
    )
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
    const timed = { ...helper(1), open: false, state: 'ended: done', changedAt: 0 }
    expect(block({ helpers: { rows: [timed], more: 0, unchanged: 0 } })).toContain(
      'ended: done · 1 minute ago',
    )
  })

  it('keeps new words in one formatter, bounds fields and flattens injected line breaks', () => {
    const rendered = block({
      helpers: { rows: [{ ...helper(1), name: 'A\n' + 'x'.repeat(1000) }], more: 0, unchanged: 1 },
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
    ).toContain('You hold several pieces: W1.1, W1.2 and 3 more. list_tasks shows them.')
  })
})
