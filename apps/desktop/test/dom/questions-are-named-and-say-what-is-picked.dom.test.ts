import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import type { UserInputResponse } from '../../src/shared/runtime-ipc'
import QuestionCard from '../../src/renderer/src/components/QuestionCard.vue'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import type { QuestionCardReading, QuestionPart } from '../../src/renderer/src/lib/question-card'
import type { UserInputItem } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * A free-answer field is named by the question it answers, and a staged single choice says it is
 * held. Names are read the way assistive technology reads them: `aria-labelledby` resolved to the
 * text of the elements it points at.
 */

afterEach(unmountAll)

/** The accessible name a field gets from `aria-labelledby`, whitespace folded. */
function nameOf(el: Element): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  return ids
    .map((id) => {
      const target = el.ownerDocument.getElementById(id)
      expect(target, `aria-labelledby points at #${id}, which is not in the page`).not.toBeNull()
      return target!.textContent ?? ''
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const part = (id: string, over: Partial<QuestionPart> = {}): QuestionPart => ({
  id,
  header: null,
  prompt: null,
  options: [],
  multiSelect: false,
  typed: true,
  secret: false,
  ...over,
})

const choices = (...labels: string[]): QuestionPart['options'] =>
  labels.map((label) => ({ label, description: null }))

const reading = (
  parts: readonly QuestionPart[],
  words: string | null = 'A question',
): QuestionCardReading => ({
  requestId: 'req-1',
  asker: 'Ada',
  verb: 'asks',
  askedOf: 'you',
  piece: null,
  via: null,
  at: null,
  atTitle: null,
  words,
  wordsAreCut: false,
  wordsMissing: false,
  context: null,
  parts,
  state: 'open',
  answeredBy: null,
  answerable: true,
  refused: null,
  note: null,
  receipt: null,
  where: null,
})

function card(read: QuestionCardReading): Mounted & { answers: UserInputResponse[] } {
  const answers: UserInputResponse[] = []
  const m = mount(
    QuestionCard,
    { reading: read, onAnswer: (response: UserInputResponse) => answers.push(response) },
    { width: 420, height: 600 },
  )
  return Object.assign(m, { answers })
}

const optionOf = (m: Mounted, label: string): HTMLElement => {
  const found = m.host.querySelector<HTMLElement>(
    `[data-cy="question-option"][data-option="${label}"]`,
  )
  expect(found, `no option ${label}`).not.toBeNull()
  return found!
}

describe('the question card names each free-answer field by its question', () => {
  it('each part of a several-part question is named by its own prompt', () => {
    const m = card(
      reading(
        [
          part('q1', { prompt: 'Which database?', options: choices('Postgres', 'SQLite') }),
          part('q2', { prompt: 'Which region?' }),
        ],
        'Two things before I start.',
      ),
    )
    const first = m.q('question-part-q1').querySelector('[data-cy="question-box"]')!
    const second = m.q('question-part-q2').querySelector('[data-cy="question-box"]')!
    expect(nameOf(first)).toBe('Which database?')
    expect(nameOf(second)).toBe('Which region?')
  })

  it('a question whose part has no words of its own is named by the question', () => {
    const m = card(reading([part('q1')], 'What should the migration be called?'))
    expect(nameOf(m.q('question-box'))).toBe('What should the migration be called?')
  })

  it('a masked field is named too', () => {
    const m = card(reading([part('q1', { prompt: 'Your token?', secret: true })]))
    const box = m.q('question-box')
    expect(box.tagName).toBe('INPUT')
    expect(nameOf(box)).toBe('Your token?')
  })

  it('two cards in one page never share a label id', () => {
    const both = defineComponent(() => () => [
      h(QuestionCard, { reading: reading([part('q1', { prompt: 'First?' })]) }),
      h(QuestionCard, { reading: reading([part('q1', { prompt: 'Second?' })]) }),
    ])
    const m = mount(both, {}, { width: 420, height: 600 })
    const [a, b] = m.all('question-box')
    expect(nameOf(a!)).toBe('First?')
    expect(nameOf(b!)).toBe('Second?')
  })
})

describe('a staged single choice says it is held', () => {
  const two = (): QuestionCardReading =>
    reading([
      part('q1', { prompt: 'Which database?', options: choices('Postgres', 'SQLite') }),
      part('q2', { prompt: 'Which region?', options: choices('eu', 'us') }),
    ])

  it('the picked option is pressed, carries a tick, and the other does not', async () => {
    const m = card(two())
    const postgres = optionOf(m, 'Postgres')
    const sqlite = optionOf(m, 'SQLite')
    expect(postgres.getAttribute('aria-pressed')).toBe('false')
    expect(postgres.querySelector('[data-cy="question-option-tick"]')).toBeNull()

    postgres.click()
    await nextTick()
    expect(postgres.getAttribute('aria-pressed')).toBe('true')
    expect(postgres.querySelector('[data-cy="question-option-tick"]')).not.toBeNull()
    expect(sqlite.getAttribute('aria-pressed')).toBe('false')
    expect(sqlite.querySelector('[data-cy="question-option-tick"]')).toBeNull()
    expect(m.answers).toHaveLength(0)

    sqlite.click()
    await nextTick()
    expect(postgres.getAttribute('aria-pressed')).toBe('false')
    expect(sqlite.getAttribute('aria-pressed')).toBe('true')
  })

  it('a multi-select pick carries the tick as well', async () => {
    const m = card(
      reading([part('q1', { multiSelect: true, options: choices('Red', 'Blue'), typed: false })]),
    )
    optionOf(m, 'Red').click()
    await nextTick()
    expect(optionOf(m, 'Red').getAttribute('aria-pressed')).toBe('true')
    expect(optionOf(m, 'Red').querySelector('[data-cy="question-option-tick"]')).not.toBeNull()
    expect(optionOf(m, 'Blue').querySelector('[data-cy="question-option-tick"]')).toBeNull()
  })

  it('control: a one-press question answers at once and claims no held state', async () => {
    const m = card(
      reading([part('q1', { options: choices('Red', 'Blue'), typed: false })], 'Which colour?'),
    )
    const red = optionOf(m, 'Red')
    expect(red.getAttribute('aria-pressed')).toBeNull()
    red.click()
    await nextTick()
    expect(m.answers).toHaveLength(1)
    expect(red.querySelector('[data-cy="question-option-tick"]')).toBeNull()
  })
})

const userInput = (
  questions: {
    id: string
    prompt: string
    options: string[]
    header?: string
    allowOther?: boolean
  }[],
  prompt = 'AskUserQuestion',
): UserInputItem & { at: number } => ({
  kind: 'userInput',
  id: 'ui_1',
  request: {
    type: 'user_input_request',
    id: 'toolu_1',
    prompt,
    questions: questions.map((question) => ({
      ...question,
      options: question.options.map((label) => ({ label })),
    })),
  },
  answered: null,
  note: null,
  refused: null,
  at: 1_000,
})

describe('the provider question card names each free-answer field by its question', () => {
  it('a question with no options is named by its prompt', () => {
    const m = mount(
      UserInputCard,
      { item: userInput([{ id: 'q1', prompt: 'What is the branch called?', options: [] }]) },
      { width: 900 },
    )
    const field = m.q('user-input-answer-q1')
    expect(field.getAttribute('placeholder')).toBeFalsy()
    expect(nameOf(field)).toBe('What is the branch called?')
  })

  it('the other field beside options is named by its own question, part by part', () => {
    const item = userInput([
      {
        id: 'q1',
        prompt: 'Which database?',
        options: ['Postgres'],
        header: 'DB',
        allowOther: true,
      },
      { id: 'q2', prompt: 'What else?', options: [] },
    ])
    const m = mount(UserInputCard, { item }, { width: 900 })
    expect(nameOf(m.q('user-input-other-q1'))).toContain('Which database?')
    expect(nameOf(m.q('user-input-answer-q2'))).toBe('What else?')
  })

  it('a question with no words falls back to the card prompt', () => {
    const m = mount(
      UserInputCard,
      { item: userInput([{ id: 'q1', prompt: '', options: [] }], 'Name the release') },
      { width: 900 },
    )
    expect(nameOf(m.q('user-input-answer-q1'))).toBe('Name the release')
  })

  it('two cards in one page never share a label id', () => {
    const both = defineComponent(() => () => [
      h(UserInputCard, { item: userInput([{ id: 'q1', prompt: 'First?', options: [] }]) }),
      h(UserInputCard, { item: userInput([{ id: 'q1', prompt: 'Second?', options: [] }]) }),
    ])
    const m = mount(both, {}, { width: 900 })
    const [a, b] = m.all('user-input-answer-q1')
    expect(nameOf(a!)).toBe('First?')
    expect(nameOf(b!)).toBe('Second?')
  })
})
