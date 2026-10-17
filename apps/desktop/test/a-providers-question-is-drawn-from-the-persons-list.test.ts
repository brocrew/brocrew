import { describe, expect, it } from 'vitest'
import type { UserInputQuestion } from '@brobot2/runtime'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  escalationChain,
  type AskedQuestion,
  type HowItWasRaised,
  type LedgerWalk,
  type OfferedAnswer,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
} from '../src/shared/questions'
import { personsQueueView, type PersonsQueueWorld } from '../src/renderer/src/lib/persons-queue'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  ASKED_WORD,
  PASSED_UP_WORD,
  questionOnTheQueue,
  wordsAsked,
  type QuestionWords,
} from '../src/renderer/src/lib/question-card'

/**
 * # 🔴 D-046 · window half — *Waiting on you* draws every question from the person's list
 *
 * ⚑ `wordsAsked` turns the list's `asked` into what a card draws; `personsQueueView` puts it on the
 * card of a question THIS APP asked (`row.question.words`), and beside a question the PROVIDER
 * raised for reading only (`row.words`) — ⛔ never both, and nothing where the host found no words.
 *
 * ⚑ The `answer-it-where-you-were-told` fixtures, one population over: that file pins the words on
 * this app's card; this one pins the provider's row, the passed-up card and the part rules.
 */

const NAME = (id: string): string => (id === 'sess_worker' ? 'trip-planning' : id)
const KEY = 'sess_worker:req_1'

const WALK = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: Math.max(rows.length, 1),
  rowsUnread: 0,
})

function asked(
  raisedBy: HowItWasRaised,
  words: AskedQuestion | null,
  offered: OfferedAnswer | null = null,
): PersonsQuestion {
  const request: RoutedRequest = {
    requestId: 'req_1',
    askedBy: 'sess_worker',
    parent: 'sess_pm',
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at: 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const chain = escalationChain(request, () => null)
  return {
    request,
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy,
    offered,
    asked: words,
  }
}

function world(over: Partial<PersonsQueueWorld> = {}): PersonsQueueWorld {
  return {
    held: new Set<string>(),
    answerable: new Map<string, AttentionRequest>(),
    now: 91_000,
    lastLookAnswered: { questions: true, decisions: true },
    answeredFromHere: new Set<string>(),
    ...over,
  }
}

function rowOf(question: PersonsQuestion) {
  const view = personsQueueView(WALK([question]), WALK<PersonsDecision>([]), world())
  const row = view?.rows[0]
  expect(row, 'the fixture produced no row at all').toBeDefined()
  expect(row?.key).toBe(KEY)
  return row!
}

/** ⚑ A provider's question, two parts, with every rule — the shape a Claude card raises. */
const PARTS: UserInputQuestion[] = [
  {
    id: 'q1',
    header: 'Region',
    prompt: 'which region?',
    options: [{ label: 'eu', description: 'Frankfurt' }, { label: 'us' }],
    multiSelect: true,
    allowOther: false,
  },
  { id: 'q2', prompt: 'and the key for it?', options: [], secret: true },
]

const FROM_THE_PROVIDER: AskedQuestion = {
  prompt: 'which region?',
  context: null,
  passedUp: false,
  parts: PARTS,
}

const PASSED_UP: AskedQuestion = {
  prompt: 'May I drop the old table?',
  context: 'It holds last year’s invoices.',
  passedUp: true,
  parts: [
    {
      id: 'answer',
      prompt: 'May I drop the old table?',
      options: [{ label: 'yes' }, { label: 'no' }],
      allowOther: true,
    },
  ],
}

describe('§1 · `wordsAsked` — the list’s question, as a card draws it', () => {
  it('🔴 every part’s rules come through: several answers, a hidden one, a typed one, a header', () => {
    const words = wordsAsked(FROM_THE_PROVIDER)
    expect(words).toEqual({
      prompt: 'which region?',
      context: null,
      passedUp: false,
      parts: [
        {
          id: 'q1',
          header: 'Region',
          // ⚑ The part's own words only where they say more than the question's.
          prompt: null,
          options: [
            { label: 'eu', description: 'Frankfurt' },
            { label: 'us', description: null },
          ],
          multiSelect: true,
          // ⛔ `allowOther: false` with choices takes no typed answer.
          typed: false,
          secret: false,
        },
        {
          id: 'q2',
          header: null,
          prompt: 'and the key for it?',
          options: [],
          multiSelect: false,
          // ⚑ No choices at all is a typed answer, whatever `allowOther` says.
          typed: true,
          secret: true,
        },
      ] satisfies QuestionWords['parts'],
    })
  })

  it('⛔ …and the same part with `allowOther: true` takes a typed answer beside its choices', () => {
    const open = wordsAsked({
      ...FROM_THE_PROVIDER,
      parts: [{ ...PARTS[0]!, allowOther: true }],
    })
    expect(open.parts[0]?.typed).toBe(true)
    expect(wordsAsked(FROM_THE_PROVIDER).parts[0]?.typed).toBe(false)
  })

  it('🔴 a passed-up question keeps what the passer added and says it was passed up', () => {
    const words = wordsAsked(PASSED_UP)
    expect(words.passedUp).toBe(true)
    expect(words.context).toBe('It holds last year’s invoices.')
    // ⚑ The control: one not passed up says neither.
    const direct = wordsAsked(FROM_THE_PROVIDER)
    expect(direct.passedUp).toBe(false)
    expect(direct.context).toBeNull()
  })
})

describe('§2 · which row draws the words, and where', () => {
  it('🔴 a PROVIDER’s question draws its words beside the row, for reading — and no card to answer on', () => {
    const row = rowOf(asked('the-provider', FROM_THE_PROVIDER))
    expect(row.words).toEqual(wordsAsked(FROM_THE_PROVIDER))
    // ⛔ Its card in its asker's conversation answers it — nothing here offers to.
    expect(row.question).toBeNull()
  })

  it('⛔ …a question THIS APP asked carries the same words on its card, and none beside it', () => {
    const row = rowOf(asked('this-app', FROM_THE_PROVIDER))
    expect(row.words).toBeNull()
    expect(row.question?.words).toEqual(wordsAsked(FROM_THE_PROVIDER))
  })

  it('⛔ …and where the host found no words, neither draws any', () => {
    const provider = rowOf(asked('the-provider', null))
    expect(provider.words).toBeNull()
    const nothing = rowOf(asked('nothing-says', null))
    expect(nothing.words).toBeNull()
    expect(nothing.question).toBeNull()
  })
})

describe('§3 · the card a passed-up question draws, whoever holds its asker', () => {
  it('🔴 it says *passed up to*, shows what was added, and is answerable from its own parts', () => {
    const row = rowOf(asked('this-app', PASSED_UP))
    const card = questionOnTheQueue(row, row.question!, undefined)
    expect(card.verb).toBe(PASSED_UP_WORD)
    expect(card.context).toBe('It holds last year’s invoices.')
    expect(card.words).toBe('May I drop the old table?')
    expect(card.wordsMissing).toBe(false)
    expect(card.parts.map((part) => part.options.map((one) => one.label))).toEqual([['yes', 'no']])
    expect(card.answerable).toBe(true)
  })

  it('⛔ …one asked direct says *asked*, adds nothing; one with no words found says so', () => {
    const direct = rowOf(asked('this-app', { ...PASSED_UP, passedUp: false, context: null }))
    const said = questionOnTheQueue(direct, direct.question!, undefined)
    expect(said.verb).toBe(ASKED_WORD)
    expect(said.context).toBeNull()

    const missing = rowOf(asked('this-app', null))
    const card = questionOnTheQueue(missing, missing.question!, undefined)
    expect(card.wordsMissing).toBe(true)
    expect(card.words).toBeNull()
  })
})
