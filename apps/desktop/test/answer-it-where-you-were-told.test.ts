import { describe, expect, it } from 'vitest'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  escalationChain,
  whatTheAskerOffered,
  type AskedQuestion,
  type HowItWasRaised,
  type LedgerWalk,
  type OfferedAnswer,
  type PersonsDecision,
  type PersonsQuestion,
  type RaisedQuestion,
  type RoutedRequest,
} from '../src/shared/questions'
import type { UserInputQuestion } from '@brobot2/runtime'
import {
  personsQueueView,
  type NoAnswerHere,
  type PersonsQueueRow,
  type PersonsQueueWorld,
} from '../src/renderer/src/lib/persons-queue'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'
// ⚑ **UI-009 · a question this app asked is answered on its card** — `question-card.ts`.
import {
  oneAnswer,
  questionOnTheQueue,
  type QuestionCardReading,
} from '../src/renderer/src/lib/question-card'

/**
 * 🔴 **619 · answer it where you were told** — `HO-093` §3.1, `HO-082` repair 2.
 *
 * ## The answer must be available where the question was announced
 *
 * > ***"it says I need to approve something but there is nothing to approve"***
 *
 * ⚠️ **`589` measured him following the instruction and finding nothing.** A question
 * `ask_question` raised draws no card — `transcript.ts` folds `question_asked` into a notice —
 * `attentionQueue` therefore makes no item for it, and the one surface that listed it could offer
 * nothing but a sentence saying so.
 *
 * ## ⚑ The property this file pins
 *
 * > ⚑ **A question a person was told to answer can be answered where they were told.**
 *
 * ## 🔴 Why the answer path could be built NOW and not when `HO-082` §4.2 held it
 *
 * ⛔ **The reason that arm named no answer path was a PRICE, and three of its four quarters have
 * been paid** (`PM-092` §4): `591`/`608` took the bound off, `611` made the asker declare who
 * answers, and `603`/`609` built both projections. ⚑ The fourth — a refusal — was always there:
 * `answer_question` refuses with `because`.
 *
 * ## 🔴 UI-009 · the answer is the question's own CARD (F052)
 *
 * ⚑ The row of a question this app asked is `QuestionCard` — the one the conversation draws on the
 * call that asked — with its options as presses and a box for a person's own words. ⛔ So the
 * queue's own buttons and its *"nothing here to answer it with"* are gone from this population:
 * the card answers it, and a question asked with no options is answered in the box.
 */

const NAME = (id: string): string => (id === 'sess_worker' ? 'trip-planning' : id)

const WALK = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: Math.max(rows.length, 1),
  rowsUnread: 0,
})

/**
 * ⚑ **The part `RuntimeHost.raiseAQuestion` composes**, spelled the way that method spells it —
 * one part, id `answer`, the labels wrapped as options, and `allowOther` only where there is a
 * list to be other than.
 */
function partAsTheHostComposesIt(options: readonly string[]): UserInputQuestion {
  return {
    id: 'answer',
    prompt: 'which train?',
    options: options.map((label) => ({ label })),
    ...(options.length > 0 ? { allowOther: true } : {}),
  }
}

function raised(over: Partial<RaisedQuestion> = {}): RaisedQuestion {
  return {
    prompt: 'which train?',
    questions: [partAsTheHostComposesIt(['The 09:10', 'The 11:40'])],
    piece: 'work_1',
    passedUpFrom: null,
    context: null,
    raisedBy: 'this-app',
    ...over,
  }
}

function asked(
  offered: OfferedAnswer | null,
  raisedBy: HowItWasRaised = 'this-app',
  words: AskedQuestion | null = null,
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

function rowOf(question: PersonsQuestion, over: Partial<PersonsQueueWorld> = {}) {
  const view = personsQueueView(WALK([question]), WALK<PersonsDecision>([]), world(over))
  const row = view?.rows[0]
  expect(row, 'the fixture produced no row at all').toBeDefined()
  return row!
}

const HOLDING_IT = { held: new Set(['sess_worker']) }
const OFFER: OfferedAnswer = { part: 'answer', options: ['The 09:10', 'The 11:40'] }

/** ⚑ The card the row draws — `PersonsQueue.vue`'s own call, with no press made yet. */
function cardOf(row: PersonsQueueRow): QuestionCardReading {
  expect(row.question, 'the row is not a question this app asked').not.toBeNull()
  return questionOnTheQueue(row, row.question!, undefined)
}

/** ⚑ D-046 · the question as the person's list carries it — free-form, the host's one part. */
const FREE_FORM: AskedQuestion = {
  prompt: 'which train?',
  context: null,
  passedUp: false,
  parts: [{ id: 'answer', prompt: 'which train?', options: [] }],
}

describe('§1 · what the asker offered, folded once', () => {
  /**
   * ⛔ **The positive, and it reads the part the HOST composes** rather than a shape typed here —
   * `a-fixture-built-with-the-helper-under-test` avoided by building the fixture the way
   * `raiseAQuestion` builds the real thing.
   */
  it('⚑ a question this app raised with options offers its part and its labels', () => {
    expect(whatTheAskerOffered(raised())).toEqual({
      part: 'answer',
      options: ['The 09:10', 'The 11:40'],
    })
  })

  /**
   * 🔴 **Three refusals, each measured as the SAME call one fact over** (standing rule 3) — so a
   * green here is the fold deciding rather than the fixture happening to be unanswerable.
   */
  it('⛔ a read that MISSED offers nothing, and a read that landed offers something', () => {
    expect(whatTheAskerOffered(undefined)).toBeNull()
    expect(whatTheAskerOffered(raised())).not.toBeNull()
  })

  it('⛔ a PROVIDER-raised question offers nothing here — its card is what offers', () => {
    expect(whatTheAskerOffered(raised({ raisedBy: 'the-provider' }))).toBeNull()
    expect(whatTheAskerOffered(raised({ raisedBy: 'this-app' }))).not.toBeNull()
  })

  it('⛔ a question with no options offers nothing — `AttentionLimit`’s `free-form`, one surface over', () => {
    expect(whatTheAskerOffered(raised({ questions: [partAsTheHostComposesIt([])] }))).toBeNull()
    expect(whatTheAskerOffered(raised({ questions: [partAsTheHostComposesIt(['one'])] }))).toEqual({
      part: 'answer',
      options: ['one'],
    })
  })

  it('⛔ MORE THAN ONE part offers nothing — `AttentionLimit`’s `multiple`, and a passed-up question is how it arrives', () => {
    const two = [partAsTheHostComposesIt(['a']), { ...partAsTheHostComposesIt(['b']), id: 'q2' }]
    expect(whatTheAskerOffered(raised({ questions: two }))).toBeNull()
    expect(whatTheAskerOffered(raised({ questions: [two[0]!] }))).not.toBeNull()
  })

  /**
   * ⚠️ **A label with no word on it is dropped, and it is REACHABLE rather than defensive**:
   * `ask_question` bounds the options' total length and refuses nothing for being empty.
   */
  it('⚑ an empty label is not a button, and a question of nothing but empty labels offers nothing', () => {
    expect(
      whatTheAskerOffered(raised({ questions: [partAsTheHostComposesIt(['', 'yes'])] })),
    ).toEqual({ part: 'answer', options: ['yes'] })
    expect(
      whatTheAskerOffered(raised({ questions: [partAsTheHostComposesIt(['', ''])] })),
    ).toBeNull()
  })

  /**
   * 🔴 **The PART is read off the question and never spelled `'answer'`** — a passed-up question
   * carries the ORIGINAL provider's ids, and an answer filed under the wrong key is refused by
   * `respondUserInput`'s completeness rail as *no answer was given for …*.
   */
  it('🔴 the part id comes off the question, so a passed-up provider id survives the hop', () => {
    const theirs = { ...partAsTheHostComposesIt(['a', 'b']), id: 'codex-q-7' }
    expect(whatTheAskerOffered(raised({ questions: [theirs] }))?.part).toBe('codex-q-7')
  })
})

describe('§2 · the row a person can press, and the row they cannot', () => {
  /**
   * 🔴 **`589`'s row, repaired — and since UI-009 it is the CARD** — the same conversation, the same
   * window, the same question: its offer is on the card, and the queue draws no buttons of its own.
   */
  it('🔴 a question this app asked draws its answers on its card HERE', () => {
    const row = rowOf(asked(OFFER), HOLDING_IT)
    expect(cardOf(row).parts.flatMap((part) => part.options.map((one) => one.label))).toEqual([
      'The 09:10',
      'The 11:40',
    ])
    expect(cardOf(row).answerable).toBe(true)
    expect(row.answers).toEqual([])
    expect(row.noAnswerHere).toBeNull()
  })

  /**
   * ⛔ **The control, and it is the same call one fact over** (standing rule 3). ⚑ Without it a
   * green above is satisfiable by a card that puts presses on every row it is handed.
   */
  it('⛔ …and the same row with nothing offered, and no words here, draws no presses at all', () => {
    const row = rowOf(asked(null), HOLDING_IT)
    expect(cardOf(row).parts).toEqual([])
    expect(cardOf(row).answerable).toBe(false)
    expect(cardOf(row).wordsMissing).toBe(true)
    expect(row.noAnswerHere).toBeNull()
  })

  /**
   * 🔴 **UI-009 · neither of the queue's own answers reaches this population** — its card is the
   * one way it is answered, in every state this population can be in.
   */
  it('🔴 every state a question this app asked can reach is its card’s, never the queue’s buttons', () => {
    for (const offered of [null, OFFER]) {
      for (const held of [true, false]) {
        for (const answeredHere of [true, false]) {
          const row = rowOf(asked(offered), {
            held: held ? new Set(['sess_worker']) : new Set(),
            answeredFromHere: answeredHere ? new Set(['sess_worker:req_1']) : new Set(),
          })
          const said = `offered=${String(offered !== null)} held=${String(held)} answered=${String(answeredHere)}`
          expect(row.answers, said).toEqual([])
          expect(row.noAnswerHere, said).toBeNull()
          expect(row.question, said).not.toBeNull()
        }
      }
    }
  })

  /**
   * ⛔ **The LABEL is both the word and the payload.** `answerToForward` matches a sent answer
   * against the option's own label, so a press that displayed one string and sent another would
   * be refused as *not one of the responses this request offers*.
   */
  it('⛔ each press files the label it shows under the asker’s part', () => {
    const part = cardOf(rowOf(asked(OFFER), HOLDING_IT)).parts[0]!
    expect(part.id).toBe('answer')
    const sent = oneAnswer(part, 'The 09:10')
    expect(sent.kind === 'answer' ? { ...sent.answers } : null).toEqual({ answer: ['The 09:10'] })
  })

  /**
   * 🔴 **The row CARRIES the offer**, because it is what the card draws where the words are not in
   * this window — ⚑ D-017 · R6: and a row nobody holds draws the same card, because the host admits
   * a person's answer by whom the question was asked of, whoever holds the asker.
   */
  it('🔴 the row carries the offer itself, held or not', () => {
    expect(rowOf(asked(OFFER), HOLDING_IT).question?.offered).toEqual(OFFER)
    const unheld = rowOf(asked(OFFER))
    expect(unheld.question?.offered).toEqual(OFFER)
    expect(cardOf(unheld).answerable).toBe(true)
    // ⚑ **The control**: a row with nothing offered carries nothing.
    expect(rowOf(asked(null), HOLDING_IT).question?.offered).toBeNull()
  })

  /**
   * ⚠️ **No {@link AttentionLimit} on this population, and the absence is argued.** That
   * vocabulary says why a one-click answer is NOT offered, and the card answers every shape.
   */
  it('⚑ a row answered from here discloses no limit and no missing positive', () => {
    const row = rowOf(asked(OFFER), HOLDING_IT)
    expect(row.limit).toBeNull()
    expect(row.noPositive).toBeNull()
    // ⛔ **And it says the card is not also on screen, because there is none** — the disclosure is
    // about a live projection this population never has.
    expect(row.alsoOnScreen).toBe(false)
  })
})

describe('§3 · the reasons, and the move each one names', () => {
  /**
   * 🔴 **D-017 · R6 — a person answers this app's question from the queue, with no claim first.**
   * ⚑ The host finds the question in the asker's LEDGER and admits a person by whom it was asked
   * of — running or stopped — so there is no gesture to name: the card is on the row.
   */
  it('🔴 nobody holding it draws the card here too — no take-over first', () => {
    const unheld = rowOf(asked(OFFER))
    expect(unheld.noAnswerHere).toBeNull()
    expect(cardOf(unheld).answerable).toBe(true)
    // ⚑ **The same row, one fact over**: holding it changes nothing about what is pressed.
    expect(cardOf(rowOf(asked(OFFER), HOLDING_IT)).parts).toEqual(cardOf(unheld).parts)
  })

  /**
   * 🔴 **UI-009 · F052 item 5 — a question asked with NO options is answered in the box**, from the
   * words the person's list carries (D-046), whether or not this window holds the asker. ⚠️ Where the
   * host found none, the card says so and draws no box: nothing says whether the part takes a typed
   * answer.
   */
  it('🔴 a free-form question is answered in the box from the list’s words, and says so where there are none', () => {
    const here = cardOf(rowOf(asked(null, 'this-app', FREE_FORM)))
    expect(here.words).toBe('which train?')
    expect(here.parts.map((part) => [part.id, part.typed])).toEqual([['answer', true]])
    expect(here.answerable).toBe(true)
    const missing = cardOf(rowOf(asked(null)))
    expect(missing.wordsMissing).toBe(true)
    expect(missing.answerable).toBe(false)
  })

  /**
   * 🔴 **The press goes ONCE**, and this is the whole of the guard.
   *
   * ⛔ **`store.respondUserInput` marks the record's draft `answered` before its first await**
   * (`064`, `207` M2) and `answeredFromHere` is a read of exactly that — so the card says *answer
   * sent* inside one tick, while the ledger walk behind this row is up to `LOOK_EVERY_MS` old.
   */
  it('🔴 a question answered from this window stops offering, before the list catches up', () => {
    const row = rowOf(asked(OFFER), {
      ...HOLDING_IT,
      answeredFromHere: new Set(['sess_worker:req_1']),
    })
    expect(cardOf(row).state).toBe('sending')
    // ⛔ **The control**: the same window, the same offer, nothing answered — the card is open,
    // so the green above is the press being read rather than the offer being lost.
    expect(cardOf(rowOf(asked(OFFER), HOLDING_IT)).state).toBe('open')
  })

  /**
   * ⛔ **UI-009 did not widen what a PROVIDER-raised row does.** Every arm below is `602`'s.
   */
  it('⛔ a provider-raised question keeps every arm it had', () => {
    expect(rowOf(asked(null, 'the-provider'), HOLDING_IT).noAnswerHere).toBe('not-in-this-window')
    expect(rowOf(asked(null, 'the-provider')).noAnswerHere).toBe('not-yours-yet')
    expect(rowOf(asked(null, 'nothing-says'), HOLDING_IT).noAnswerHere).toBe('not-in-this-window')
    expect(rowOf(asked(null, 'the-provider')).question).toBeNull()
  })
})

describe('§4 · what a cardless row is allowed to reach', () => {
  /**
   * 🔴 **The reachable set is DERIVED, never listed** (rule 27.1) — a hand-written list is a
   * guard scoped by where things live today, and it expires silently.
   *
   * ⛔ **Every combination of the three facts a cardless row carries**: what the asker offered,
   * whether this window holds the conversation, and whether this window has already answered.
   */
  const reachable = new Set<NoAnswerHere>()
  for (const offered of [null, OFFER]) {
    for (const held of [true, false]) {
      for (const answeredHere of [true, false]) {
        const row = rowOf(asked(offered), {
          held: held ? new Set(['sess_worker']) : new Set(),
          answeredFromHere: answeredHere ? new Set(['sess_worker:req_1']) : new Set(),
        })
        if (row.noAnswerHere !== null) reachable.add(row.noAnswerHere)
      }
    }
  }

  it('🔴 no reason is reachable by a question this app asked — its card answers it', () => {
    // ⚑ **UI-009** — `'no-card-was-drawn'` went with the queue's own buttons, and *answer sent* is
    // the card's word now.
    expect([...reachable]).toEqual([])
  })

  /**
   * ⛔ **Neither arm that promises a card is reachable**, which is `602`'s whole finding and the
   * one thing this dispatch must not undo by adding a route into them.
   */
  it('⛔ the two arms whose sentences say *its card* stay unreachable from here', () => {
    expect(reachable.has('not-in-this-window')).toBe(false)
    expect(reachable.has('not-yours-yet')).toBe(false)
    // ⚑ **The control, and it is the same derivation**: a PROVIDER-raised row reaches both, so
    // *unreachable* above is a property of this population rather than of this loop.
    const theirs = new Set<NoAnswerHere>()
    for (const held of [true, false]) {
      const row = rowOf(asked(null, 'the-provider'), {
        held: held ? new Set(['sess_worker']) : new Set(),
      })
      if (row.noAnswerHere !== null) theirs.add(row.noAnswerHere)
    }
    expect([...theirs].sort()).toEqual(['not-in-this-window', 'not-yours-yet'])
  })
})
