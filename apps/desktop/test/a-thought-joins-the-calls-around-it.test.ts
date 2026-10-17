import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  joinsARun,
  runLine,
  transcriptRows,
  type RunMember,
} from '../src/renderer/src/lib/tool-runs'
import {
  applyEvent,
  createTranscript,
  type ThinkingItem,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'

/**
 * A finished thought joins the settled tool calls around it, so a Codex turn — a short reasoning
 * item before almost every call — draws one quiet line instead of a thought and a call per row.
 * A thought still streaming, the agent's own words and every message card stay rows of their own.
 */

const CODEX = { prefix: '', separator: '__' }

const inventory = (): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming: CODEX,
    declared: {
      server: 'brobot',
      tools: ['message_agent', 'list_tasks'].map((name) => ({
        name,
        description: '',
        parameters: [],
      })),
    },
    published: null,
  }) as unknown as TranscriptEvent

const call = (id: string, name = 'web_search'): TranscriptEvent =>
  ({ type: 'tool_call', id, name, summary: '{}' }) as TranscriptEvent

const back = (id: string, ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id, summary: ok ? 'ok' : 'denied', ok }) as TranscriptEvent

/** A Codex reasoning item: started with no words, then complete. */
const thought = (): TranscriptEvent[] => [
  { type: 'thinking', phase: 'delta', redacted: true } as TranscriptEvent,
  { type: 'thinking', phase: 'complete' } as TranscriptEvent,
]

/** The same reasoning item, still open. */
const thinking = (): TranscriptEvent =>
  ({ type: 'thinking', phase: 'delta', redacted: true }) as TranscriptEvent

const said = (text: string): TranscriptEvent =>
  ({ type: 'assistant_message', text }) as TranscriptEvent

const settled = (id: string, name?: string): TranscriptEvent[] => [call(id, name), back(id)]

/** The Codex turn: a thought, then a call, six times. */
const codexTurn = (n = 6): TranscriptEvent[] =>
  Array.from({ length: n }, (_, i) => [...thought(), ...settled(`s${i}`)]).flat()

function fold(events: readonly TranscriptEvent[]): TranscriptItem[] {
  const state = createTranscript()
  events.forEach((event, i) => applyEvent(state, event, 1_700_000_000_000 + i * 10, i + 1))
  return state.items
}

const kinds = (items: readonly TranscriptItem[]): string[] =>
  transcriptRows(items).map((row) => (row.kind === 'run' ? 'run' : row.item.kind))

const runOf = (items: readonly TranscriptItem[]) => {
  const rows = transcriptRows(items).filter((row) => row.kind === 'run')
  expect(rows).toHaveLength(1)
  return rows[0]!.kind === 'run' ? rows[0]! : (undefined as never)
}

const line = (members: readonly RunMember[]): string => {
  const l = runLine(members)
  return [l.head, l.detail, l.thoughts, ...l.amiss].filter(Boolean).join(' · ')
}

describe('a finished thought joins the run', () => {
  it('a Codex turn of six calls, each after a thought, is ONE row', () => {
    const items = fold([inventory(), ...codexTurn(), said('Found it.')])
    expect(kinds(items)).toEqual(['run', 'assistant'])
    const run = runOf(items)
    expect(run.calls).toHaveLength(6)
    expect(run.members).toHaveLength(12)
    // Ledger order: thought, call, thought, call…
    expect(run.members.map((m) => m.kind)).toEqual(
      Array.from({ length: 6 }, () => ['thinking', 'tool']).flat(),
    )
    expect(line(run.members)).toBe('6 tool calls · web_search ×6 · 6 thoughts')
  })

  it('without the thoughts, the same calls are the same run and read as before', () => {
    const items = fold([
      inventory(),
      ...Array.from({ length: 6 }, (_, i) => settled(`s${i}`)).flat(),
    ])
    expect(kinds(items)).toEqual(['run'])
    expect(line(runOf(items).members)).toBe('6 tool calls · web_search ×6')
  })

  it('a thought with words between two calls keeps its place and its words', () => {
    const worded: TranscriptEvent[] = [
      { type: 'thinking', phase: 'delta', text: 'Compare the two results.' } as TranscriptEvent,
      { type: 'thinking', phase: 'complete' } as TranscriptEvent,
    ]
    const items = fold([inventory(), ...settled('a'), ...worded, ...settled('b', 'Read')])
    const run = runOf(items)
    expect(run.members.map((m) => (m.kind === 'tool' ? m.name : m.text))).toEqual([
      'web_search',
      'Compare the two results.',
      'Read',
    ])
    expect(line(run.members)).toBe('2 tool calls · web_search, Read · 1 thought')
  })

  it('drops nothing and reorders nothing', () => {
    const items = fold([
      inventory(),
      ...codexTurn(3),
      said('Found it.'),
      ...thought(),
      ...codexTurn(2),
    ])
    const flat = transcriptRows(items).flatMap((row) =>
      row.kind === 'run' ? [...row.members] : [row.item],
    )
    expect(flat).toEqual(items)
  })

  it('a STREAMING thought breaks the run, and the same thought finished joins it', () => {
    const open = fold([inventory(), ...settled('a'), thinking()])
    const done = fold([inventory(), ...settled('a'), ...thought()])
    const last = (items: TranscriptItem[]) => items[items.length - 1] as ThinkingItem
    expect(last(open).streaming).toBe(true)
    expect(joinsARun(last(open))).toBe(false)
    expect(kinds(open)).toEqual(['run', 'thinking'])
    expect(last(done).streaming).toBe(false)
    expect(joinsARun(last(done))).toBe(true)
    expect(kinds(done)).toEqual(['run'])
  })

  it('the agent’s own words break the run', () => {
    const items = fold([inventory(), ...codexTurn(2), said('Halfway.'), ...codexTurn(2)])
    expect(kinds(items)).toEqual(['run', 'assistant', 'run'])
  })

  it('a message card breaks the run, and one of our other tools in its place does not', () => {
    const shape = (middle: string): TranscriptEvent[] => [
      inventory(),
      ...codexTurn(2),
      ...thought(),
      ...settled('m', middle),
      ...codexTurn(2),
    ]
    expect(kinds(fold(shape('brobot__message_agent')))).toEqual(['run', 'tool', 'run'])
    expect(kinds(fold(shape('brobot__list_tasks')))).toEqual(['run'])
  })

  it('a live call breaks the run', () => {
    expect(kinds(fold([inventory(), ...codexTurn(2), ...thought(), call('live')]))).toEqual([
      'run',
      'tool',
    ])
  })
})

describe('a run of thoughts alone', () => {
  it('a lone finished thought stays the row it always was', () => {
    const items = fold([inventory(), said('Hi.'), ...thought(), said('Bye.')])
    expect(kinds(items)).toEqual(['assistant', 'thinking', 'assistant'])
  })

  it('two or more consecutive finished thoughts fold to one line that counts them', () => {
    // Two reasoning items with no call between them: a boundary closes the first, so they are two.
    const items = fold([inventory(), said('Hi.'), ...thought(), ...thought(), ...thought()])
    expect(kinds(items)).toEqual(['assistant', 'run'])
    const run = runOf(items)
    expect(run.calls).toHaveLength(0)
    expect(line(run.members)).toBe('3 thoughts')
  })
})

describe('the line', () => {
  it('one call and its thoughts: the name, the time, then the count', () => {
    const items = fold([inventory(), ...thought(), ...settled('a')])
    const run = runOf(items)
    const l = runLine(run.members)
    expect(l.head).toBe('web_search')
    expect(l.thoughts).toBe('1 thought')
    expect(line(run.members)).toMatch(/^web_search · .+ · 1 thought$/)

    const two = runOf(fold([inventory(), ...thought(), ...settled('a'), ...thought()]))
    expect(runLine(two.members).thoughts).toBe('2 thoughts')
  })

  it('what did not plainly succeed is still spelled, after the thoughts', () => {
    const items = fold([
      inventory(),
      ...thought(),
      call('a'),
      back('a', false),
      ...thought(),
      ...settled('b', 'Read'),
    ])
    expect(line(runOf(items).members)).toMatch(
      /^2 tool calls · web_search, Read · 2 thoughts · 1 .+$/,
    )
    expect(runLine(runOf(items).members).amiss).toHaveLength(1)
  })

  it('a run of calls with no thoughts has no thoughts on its line', () => {
    expect(runLine(runOf(fold([inventory(), ...settled('a')])).members).thoughts).toBe('')
  })
})

describe('the row keeps its identity while the turn grows', () => {
  it('is keyed on its first member, a thought, and keeps that key as calls and thoughts join', () => {
    const events = [inventory(), ...codexTurn(6)]
    const keys = new Set<string>()
    // Every prefix of the turn that ends on a settled call or a finished thought.
    for (let n = 4; n <= events.length; n += 1) {
      const rows = transcriptRows(fold(events.slice(0, n)))
      const run = rows.find((row) => row.kind === 'run')
      if (run !== undefined && run.kind === 'run') {
        expect(run.members[0]!.kind).toBe('thinking')
        keys.add(run.id)
      }
    }
    expect(keys.size).toBe(1)
    const first = fold(events).find((item) => item.kind === 'thinking')!
    expect([...keys][0]).toBe(`run:${first.id}`)
  })

  it('a re-fold of the same items gives the same rows and keys', () => {
    const items = fold([inventory(), ...codexTurn(4), said('Done.')])
    const once = transcriptRows(items).map((row) => (row.kind === 'run' ? row.id : row.item.id))
    const twice = transcriptRows([...items]).map((row) =>
      row.kind === 'run' ? row.id : row.item.id,
    )
    expect(twice).toEqual(once)
  })
})
