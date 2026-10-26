import { describe, expect, it } from 'vitest'
import { normalizeNotification, codexTurnOutcome } from '../src/codex/normalize'
import { runtimeEventSchema } from '../src/events'
import type { ThreadItem } from '../src/codex/protocol/v2/ThreadItem'
import { completedTurn } from './fixtures/codex-protocol'

const empty = {
  type: 'agentMessage', id: 'fictional-message', text: '', phase: 'final_answer',
  memoryCitation: null, delivery: null, questions: null,
} satisfies Extract<ThreadItem, { type: 'agentMessage' }>
const completed = (item: unknown) => normalizeNotification('item/completed', { item })

describe('completed Codex message text validation', () => {
  it('accepts a valid empty final message without inventing prose or an unknown diagnostic', () => {
    expect(completed(empty)).toEqual([{ type: 'assistant_message', text: '', phase: 'final' }])
  })

  it.each([
    ['final_answer', 'final'], ['commentary', 'commentary'], ['partial_answer', undefined],
    [null, undefined], [undefined, undefined],
  ] as const)('keeps the existing phase mapping for empty %s content', (phase, mapped) => {
    const events = completed({ ...empty, phase })
    expect(events).toEqual([{ type: 'assistant_message', text: '', ...(mapped ? { phase: mapped } : {}) }])
    expect(events.every((event) => runtimeEventSchema.safeParse(event).success)).toBe(true)
    expect(normalizeNotification('item/started', { item: { ...empty, phase } })).toEqual([])
  })

  it.each([{}, { text: undefined }, { text: null }, { text: 0 }, { text: false }, { text: [] }, { text: {} }])('keeps malformed text loud: %j', (field) => {
    const item = { type: 'agentMessage', id: 'fictional-malformed', ...field }
    expect(completed(item)).toEqual([{ type: 'unknown', provider: 'codex', category: 'unrecognized', label: 'agentMessage', raw: item }])
  })

  it.each(['\n\t ', 'Actual **answer**'])('preserves exact authoritative string content %j', (text) => {
    expect(completed({ ...empty, text })).toEqual([{ type: 'assistant_message', text, phase: 'final' }])
  })

  it('preserves structured questions and citation-only content with empty prose', () => {
    const questions = [{ title: 'Which fictional recipe?', options: ['Bread', 'Cake'] }]
    const memoryCitation = { entries: [{ path: 'fictional.md', lineStart: 1, lineEnd: 2 }], threadIds: [] }
    const events = completed({ ...empty, delivery: 'async', questions, memoryCitation })
    expect(events).toEqual([
      { type: 'assistant_message', text: '', phase: 'final', questions },
      { type: 'memory_recall', source: 'memoryCitation', entries: [{ path: 'fictional.md', lineStart: 1, lineEnd: 2 }] },
    ])
    expect(events.every((event) => runtimeEventSchema.safeParse(event).success)).toBe(true)
    expect(completed({ type: 'agentMessage', id: 'bad', memoryCitation })[0]?.type).toBe('unknown')
  })

  it('preserves genuine unknown diagnostics and the independent turn terminal', () => {
    const item = { type: 'fictionalFutureMessage', text: '' }
    expect(completed(item)[0]).toMatchObject({ type: 'unknown', category: 'unrecognized', raw: item })
    expect(codexTurnOutcome({ turn: completedTurn('fictional-turn', { items: [empty] }) })).toEqual({ outcome: 'completed' })
  })
})
