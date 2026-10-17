import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AssistantMessage from '../../src/renderer/src/components/AssistantMessage.vue'
import { mount, unmountAll } from './harness'

/**
 * # ⚑ A press on a choice sends the option as a message — once
 *
 * Landing coverage for the half the render test cannot reach: a real click. A question an agent asked
 * WITHOUT waiting is drawn as choices under its message; a press EMITS the words (the screen sends
 * them as an ordinary message, held if the conversation is busy), the card then says what it did — an
 * act, never an outcome — and a second press is ignored. ⛔ With several questions the question goes
 * before the option, and a leading `/` goes as an answer, never as a command.
 */

afterEach(unmountAll)

const ONE = [{ title: 'Which database?', options: ['Postgres', 'SQLite'] }]
const TWO = [...ONE, { title: 'Which port?', options: ['5432', '6543'] }]

const message = (questions: unknown) => ({
  kind: 'assistant' as const,
  id: 'assistant-1',
  text: 'Which database?\n- Postgres\n- SQLite',
  streaming: false,
  at: 1_790_000_000_000,
  questions,
})

describe('the choices of a question asked without waiting', () => {
  it('🔴 a press emits the option, says it goes as a message, and shuts the choices', async () => {
    const answered = vi.fn()
    const m = mount(AssistantMessage, {
      item: message(ONE),
      canAnswer: true,
      onAnswer: answered,
    })
    const choices = m.all('asked-choice')
    expect(choices.map((one) => one.textContent?.trim())).toEqual(['Postgres', 'SQLite'])
    expect(m.all('asked-pressed')).toHaveLength(0)

    choices[1]!.click()
    await nextTick()
    expect(answered).toHaveBeenCalledTimes(1)
    expect(answered).toHaveBeenCalledWith('SQLite')
    expect(m.q('asked-pressed').textContent).toContain('Your answer goes as a message: SQLite')
    for (const one of m.all('asked-choice')) {
      expect((one as HTMLButtonElement).disabled).toBe(true)
    }
    // A second press is ignored, whichever choice it lands on.
    ;(choices[0] as HTMLButtonElement).click()
    await nextTick()
    expect(answered).toHaveBeenCalledTimes(1)
    expect(m.q('asked-pressed').textContent).toContain('SQLite')
  })

  it('⚑ the note beside the choices says what a press is, for a reader who cannot see the buttons', () => {
    const m = mount(AssistantMessage, { item: message(ONE), canAnswer: true })
    const note = m.q('asked-note')
    expect(note.textContent).toContain('sends it as a message')
    expect(note.textContent).toContain('nothing is waiting on the answer')
    // Each choice group is named by it.
    expect(m.q('asked-without-waiting').innerHTML).toContain(note.id)
  })

  it('🔴 with several questions the question goes before the option', async () => {
    const answered = vi.fn()
    const m = mount(AssistantMessage, {
      item: message(TWO),
      canAnswer: true,
      onAnswer: answered,
    })
    const choices = m.all('asked-choice')
    expect(choices).toHaveLength(4)
    choices[2]!.click()
    await nextTick()
    expect(answered).toHaveBeenCalledWith('Which port? — 5432')
  })

  it('⛔ a leading slash goes as an answer, never as a command', async () => {
    const answered = vi.fn()
    const m = mount(AssistantMessage, {
      item: message([{ title: 'Next?', options: ['/compact'] }]),
      canAnswer: true,
      onAnswer: answered,
    })
    m.all('asked-choice')[0]!.click()
    await nextTick()
    expect(answered).toHaveBeenCalledWith('Answer: /compact')
  })

  it('⛔ nothing is drawn where the conversation cannot take a message, so there is nothing to press', () => {
    const m = mount(AssistantMessage, { item: message(ONE), canAnswer: false })
    expect(m.all('asked-choice')).toHaveLength(0)
    expect(m.all('asked-without-waiting')).toHaveLength(0)
  })
})
