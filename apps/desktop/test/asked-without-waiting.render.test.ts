import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AssistantMessage from '../src/renderer/src/components/AssistantMessage.vue'
import {
  answerFor,
  goesAsAMessage,
  questionsWithChoices,
  repliedAfter,
  SENT_AS_A_MESSAGE,
} from '../src/renderer/src/lib/asked-without-waiting'

/**
 * 🔴 **Provider follow-ups 1 · questions an agent asked WITHOUT waiting, as choices** — W4's ruling:
 * picking one sends the answer as an ordinary message to the conversation (held if it is busy),
 * because the turn has moved on and nothing awaits it — and the card says so plainly.
 */
const ONE = [{ title: 'Which database?', options: ['Postgres', 'SQLite'] }]
const TWO = [...ONE, { title: 'Which port?', options: ['5432'] }]

const item = (overrides: Record<string, unknown> = {}) => ({
  kind: 'assistant' as const,
  id: 'assistant-1',
  text: 'Which database?\n- Postgres\n- SQLite',
  streaming: false,
  at: 1_790_000_000_000,
  questions: ONE,
  ...overrides,
})

async function render(props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(AssistantMessage, props))
}

describe('provider follow-ups 1 · asked without waiting', () => {
  it('a choice sends the option itself; with several questions, the question goes before it', () => {
    expect(answerFor(ONE, ONE[0]!, 'Postgres')).toBe('Postgres')
    expect(answerFor(TWO, TWO[1]!, '5432')).toBe('Which port? — 5432')
    // A question with no options is answered in the composer, not here.
    expect(questionsWithChoices([{ title: 'Anything else?' }, ...ONE])).toEqual(ONE)
    // ⛔ An act, never an outcome (077): the message may yet be held, or refused.
    expect(goesAsAMessage('Postgres')).toBe('Your answer goes as a message: Postgres')
    // ⛔ A leading `/` would run as a command; it goes as an answer.
    expect(
      answerFor([{ title: 'Next?', options: ['/compact'] }], { title: 'Next?' }, '/compact'),
    ).toBe('Answer: /compact')
  })

  it('⛔ the choices are spent once the person has replied after the message — read from the transcript', () => {
    const rows = [
      { kind: 'assistant', id: 'a1' },
      { kind: 'user', id: 'u1' },
      { kind: 'assistant', id: 'a2' },
      { kind: 'queued', id: 'q1' },
      { kind: 'assistant', id: 'a3' },
    ]
    // A message sent after a1, and one HELD after a2, both spend their choices; a3 is still open.
    expect([...repliedAfter(rows)].sort()).toEqual(['a1', 'a2'])
    expect(repliedAfter([{ kind: 'assistant', id: 'a1' }]).size).toBe(0)
  })

  it('the card draws the choices and says a press is a message that unblocks nothing', async () => {
    const html = await render({ item: item(), canAnswer: true })
    expect(html).toContain('data-cy="asked-without-waiting"')
    expect(html).toContain(SENT_AS_A_MESSAGE)
    expect(SENT_AS_A_MESSAGE).toContain('sends it as a message')
    expect(SENT_AS_A_MESSAGE).toContain('nothing is waiting on the answer')
    expect((html.match(/data-cy="asked-choice"/g) ?? []).length).toBe(2)
    expect(html).toContain('Postgres')
  })

  it('⛔ no choices where the conversation cannot take a message, while it streams, or with none asked', async () => {
    expect(await render({ item: item() })).not.toContain('asked-without-waiting')
    expect(await render({ item: item(), canAnswer: false })).not.toContain('asked-without-waiting')
    expect(await render({ item: item({ streaming: true }), canAnswer: true })).not.toContain(
      'asked-without-waiting',
    )
    expect(await render({ item: item({ questions: undefined }), canAnswer: true })).not.toContain(
      'asked-without-waiting',
    )
  })
})
