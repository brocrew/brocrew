import { describe, expect, it } from 'vitest'
import { normalizeNotification } from '../src/codex/normalize'

describe('Codex 0.160.0 · a message that asks without waiting (request_user_input_async)', () => {
  const ASYNC = {
    type: 'agentMessage',
    id: 'call_async',
    text: 'Which database?\n- Postgres\n- SQLite',
    phase: 'final_answer',
    memoryCitation: null,
    delivery: 'async',
    questions: [{ title: 'Which database?', options: ['Postgres', 'SQLite'] }],
  }

  it('carries its questions on the message, and nothing waits on them', () => {
    expect(normalizeNotification('item/completed', { item: ASYNC })).toEqual([
      {
        type: 'assistant_message',
        text: 'Which database?\n- Postgres\n- SQLite',
        phase: 'final',
        questions: [{ title: 'Which database?', options: ['Postgres', 'SQLite'] }],
      },
    ])
  })

  it('only an ASYNC message carries them, and a malformed entry is dropped, never invented', () => {
    expect(normalizeNotification('item/completed', { item: { ...ASYNC, delivery: null } })).toEqual(
      [{ type: 'assistant_message', text: ASYNC.text, phase: 'final' }],
    )
    const [event] = normalizeNotification('item/completed', {
      item: {
        ...ASYNC,
        questions: [
          { title: '  ' },
          { title: 'Free text?' },
          { title: 'Pick', options: ['', 7, 'A'] },
          'x',
        ],
      },
    })
    expect(event).toEqual({
      type: 'assistant_message',
      text: ASYNC.text,
      phase: 'final',
      questions: [{ title: 'Free text?' }, { title: 'Pick', options: ['A'] }],
    })
  })

  it('is bounded: ten questions, ten options, and a long title cut with an ellipsis', () => {
    const many = Array.from({ length: 12 }, (_, at) => ({
      title: at === 0 ? 'x'.repeat(2500) : `q${at}`,
      options: Array.from({ length: 12 }, (_, n) => `o${n}`),
    }))
    const [event] = normalizeNotification('item/completed', { item: { ...ASYNC, questions: many } })
    const asked = event?.type === 'assistant_message' ? (event.questions ?? []) : []
    expect(asked).toHaveLength(10)
    expect(asked[0]?.title).toHaveLength(2000)
    expect(asked[0]?.title.endsWith('…')).toBe(true)
    expect(asked[1]?.options).toHaveLength(10)
  })
})
