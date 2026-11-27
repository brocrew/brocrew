import { nextTick } from 'vue'
import type {
  AskedQuestion,
  HowItWasRaised,
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
} from '../../src/shared/question-contracts'
import { afterEach, describe, expect, it } from 'vitest'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import { usePersonsQueue, type PersonsQueueRow } from '../../src/renderer/src/lib/persons-queue'
import {
  attentionToACardNobodyHolds,
  type AttentionDecision,
  type AttentionRequest,
} from '../../src/renderer/src/lib/attention'
import type { UserInputResponse } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'
import { askedOfAPerson, routedProviderQuestion } from '../helpers/queue-fixtures'

/**
 * # 🔴 D-046 · a provider's question on *Waiting on you* — its words drawn, for reading only
 *
 * ⚑ A question the PROVIDER raised (`raisedBy: 'the-provider'`) now shows what the person's list
 * carries: its words, what was added when it was passed up, and each part — header, wording,
 * choices with their descriptions, and what it takes. ⛔ **None of it is a control**: its card in
 * its asker's conversation answers it, so the drawn choices are text, and there is no box.
 *
 * ⚑ Every assertion is something a person perceives — words on the row, a press or no press, a box
 * or none — with the same mount one fact over as its control.
 */

const NOW = 1_700_000_000_000
const SESSION = 'sess_worker'
const KEY = `${SESSION}:req_1`
const NAME = (id: string): string => (id === SESSION ? 'trip-planning' : id)

const settled: { row: PersonsQueueRow; decision: AttentionDecision }[] = []
const answered: { row: PersonsQueueRow; response: UserInputResponse }[] = []

const ASKED: AskedQuestion = {
  prompt: 'Which region should the bucket live in?',
  context: 'The customer is in Germany.',
  passedUp: true,
  parts: [
    {
      id: 'q1',
      header: 'Region',
      prompt: 'Pick the regions to replicate to',
      options: [{ label: 'eu-central', description: 'Frankfurt' }, { label: 'us-east' }],
      multiSelect: true,
      allowOther: true,
    },
    { id: 'q2', prompt: 'The access key for it', options: [], secret: true },
  ],
}

function asked(raisedBy: HowItWasRaised, words: AskedQuestion | null): PersonsQuestion {
  const request = askedOfAPerson({ requestId: 'req_1', askedBy: SESSION, at: NOW - 900_000 })
  return routedProviderQuestion(request, NAME, undefined, { raisedBy, asked: words })
}

/** ⚑ The live card a held conversation shows — `persons-queue.dom.test.ts`' `live`, cut down. */
function live(): AttentionRequest {
  const question = attentionToACardNobodyHolds(
    SESSION,
    {
      asked: {
        type: 'user_input_request',
        id: 'req_1',
        prompt: ASKED.prompt,
        questions: [
          {
            id: 'q1',
            prompt: ASKED.prompt,
            options: [{ label: 'eu-central' }, { label: 'us-east' }],
          },
        ],
      },
      provider: 'claude',
      profileId: 'default',
    },
    { sent: false, refused: null },
    NAME,
  )
  if (!question) throw new Error('fixture did not produce a question card')
  return question
}

const walk = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: 1,
  rowsUnread: 0,
})

function draw(question: PersonsQuestion, over: { answerable?: boolean } = {}) {
  usePersonsQueue().supply(
    walk([question]),
    walk<PersonsDecision>([]),
    {
      held: new Set([SESSION]),
      answerable:
        over.answerable === true
          ? new Map<string, AttentionRequest>([[KEY, live()]])
          : new Map<string, AttentionRequest>(),
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel: () => {},
      settle: (row, decision) => settled.push({ row, decision }),
      answer: async (row, response) => {
        answered.push({ row, response })
        return null
      },
      takeOver: () => {},
      open: () => {},
    },
  )
  return mount(PersonsQueue, {}, { width: 720, height: 520 })
}

/** ⚑ What a person could type into, on the row. */
const boxesOn = (row: HTMLElement): number =>
  row.querySelectorAll('textarea, input[type="text"], input:not([type])').length

afterEach(() => {
  settled.length = 0
  answered.length = 0
  usePersonsQueue().forget()
  unmountAll()
})

describe('§1 · its words are on the row', () => {
  it('🔴 the words, what was added, each part’s header, wording, choices and what it takes', async () => {
    const m = draw(asked('the-provider', ASKED))
    const block = m.q(`persons-queue-asked-${KEY}`)
    block.querySelector<HTMLButtonElement>('[data-cy="question-more"]')!.click()
    await nextTick()
    const said = block.innerText.replace(/\s+/g, ' ')
    expect(said).toContain('Which region should the bucket live in?')
    expect(said).toContain('Added: The customer is in Germany.')
    expect(m.all('persons-queue-asked-part')).toHaveLength(2)
    expect(block.querySelector('.header')?.textContent).toBe('Region')
    expect(said).toContain('Pick the regions to replicate to')
    expect(said).toContain('eu-central')
    expect(said).toContain('Frankfurt')
    expect(said).toContain('takes several answers')
    expect(said).toContain('also takes an answer of your own')
    expect(said).toContain('takes a typed answer')
    expect(said).toContain('the answer is hidden')
  })

  it('⛔ …and with no words found, nothing is drawn in their place', () => {
    const m = draw(asked('the-provider', null))
    expect(m.all(`persons-queue-asked-${KEY}`)).toHaveLength(0)
    expect(m.q(`persons-queue-row-${KEY}`).innerText).not.toContain('takes several answers')
  })
})

describe('§2 · for reading only', () => {
  it('🔴 its choices are text — no press, no box — and nothing a person does here answers it', () => {
    const m = draw(asked('the-provider', ASKED))
    const row = m.q(`persons-queue-row-${KEY}`)
    expect(row.querySelectorAll('button[data-cy="question-option"]')).toHaveLength(0)
    expect(boxesOn(row)).toBe(0)
    for (const item of [...m.q(`persons-queue-asked-${KEY}`).querySelectorAll('li')]) {
      item.click()
    }
    expect(answered).toEqual([])
    expect(settled).toEqual([])
  })

  /**
   * ⚑ **The control, one fact over**: the same words on a question THIS APP asked are its card —
   * presses and a box — so the absence above is the provider's row being drawn for reading, not
   * this component drawing no controls for these words.
   */
  it('⚑ …the same words on a question this app asked are a card, with its presses and a box', () => {
    const single: AskedQuestion = {
      ...ASKED,
      passedUp: false,
      context: null,
      parts: [
        {
          id: 'answer',
          prompt: 'Which region should the bucket live in?',
          options: [{ label: 'eu-central' }, { label: 'us-east' }],
          allowOther: true,
        },
      ],
    }
    const m = draw(asked('this-app', single))
    const row = m.q(`persons-queue-row-${KEY}`)
    expect(m.all(`persons-queue-asked-${KEY}`)).toHaveLength(0)
    expect(row.querySelectorAll('button[data-cy="question-option"]').length).toBeGreaterThan(0)
    expect(boxesOn(row)).toBeGreaterThan(0)
  })
})

describe('§3 · the choices are not drawn twice', () => {
  it('🔴 where the row’s own answers are pressable, its choices are not listed again beside them', () => {
    const m = draw(asked('the-provider', ASKED), { answerable: true })
    const row = m.q(`persons-queue-row-${KEY}`)
    const choices = [...row.querySelectorAll<HTMLButtonElement>('button[data-option]')]
    expect(choices.map((button) => button.dataset.option)).toEqual(['eu-central', 'us-east'])
    expect(choices.every((button) => !button.disabled)).toBe(true)
    expect(row.innerText).toContain(ASKED.prompt)
    expect(row.querySelectorAll('li[data-option]')).toHaveLength(0)
    choices[0]!.click()
    expect(settled).toHaveLength(1)
    expect(settled[0]!.decision).toMatchObject({
      kind: 'answer',
      questionId: 'q1',
      option: 'eu-central',
    })
  })

  it('⚑ …and with none pressable here, the list is drawn — its labels, in order', () => {
    const m = draw(asked('the-provider', ASKED))
    const lists = [...m.q(`persons-queue-asked-${KEY}`).querySelectorAll('ul')]
    expect(lists).toHaveLength(1)
    const labels = [...lists[0]!.querySelectorAll('li')].map((one) => one.innerText.trim())
    expect(labels[0]).toContain('eu-central')
    expect(labels[1]).toContain('us-east')
  })
})
