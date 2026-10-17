import { afterEach, describe, expect, it } from 'vitest'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import { usePersonsQueue, type PersonsQueueRow } from '../../src/renderer/src/lib/persons-queue'
import type { AttentionDecision, AttentionRequest } from '../../src/renderer/src/lib/attention'
import type { UserInputResponse } from '../../src/shared/runtime-ipc'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  escalationChain,
  type HowItWasRaised,
  type LedgerWalk,
  type OfferedAnswer,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
} from '../../src/shared/questions'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **619 · what a person actually reads on a question with no card** — `HO-093` §3.1.
 *
 * ## ⛔ Why these claims are here and not in the node suite
 *
 * ⚠️ **`NO_ANSWER_HERE_WORDS` is private to the component**, and the claim is about the SENTENCE a
 * person is given — not about the arm's name. ⚑ A node test asserting the arm proves the fold; it
 * cannot prove the words, and the words are the whole of `589`'s defect: *"it says I need to
 * approve something but there is nothing to approve"*.
 *
 * ## ⚑ It is not a snapshot test
 *
 * ⛔ **Every assertion below is a PROPERTY a person can perceive** — a control exists, a control
 * sends what it says, a sentence does not send them somewhere that is not there — and never a
 * class name or an image (rule 17.2).
 *
 * ## 🔴 UI-009 (F052) · the row is the question's CARD
 *
 * ⚑ A question this app raised is answered on `QuestionCard`, the card the conversation draws —
 * its options press, and its answer goes through the queue's `answer` door — and the sentences that
 * explained the machinery (*"the agent is given … as the answer"*, *"nothing here to answer it
 * with"*) are gone from it.
 */

const NOW = 1_700_000_000_000
const SESSION = 'sess_worker'
const KEY = `${SESSION}:req_1`
const NAME = (id: string): string => (id === SESSION ? 'trip-planning' : id)
const OFFER: OfferedAnswer = { part: 'answer', options: ['The 09:10', 'The 11:40'] }

const settled: { row: PersonsQueueRow; decision: AttentionDecision }[] = []
const takenOver: PersonsQueueRow[] = []
/** ⚑ **UI-009** — what the card's presses sent, through the queue's `answer` door. */
const answered: { row: PersonsQueueRow; response: UserInputResponse }[] = []

function asked(
  offered: OfferedAnswer | null,
  raisedBy: HowItWasRaised = 'this-app',
): PersonsQuestion {
  const request: RoutedRequest = {
    requestId: 'req_1',
    askedBy: SESSION,
    parent: 'sess_pm',
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at: NOW - 900_000,
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
    asked: null,
  }
}

const walk = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: 1,
  rowsUnread: 0,
})

function supply(
  question: PersonsQuestion,
  over: { held?: boolean; answeredFromHere?: boolean } = {},
): void {
  usePersonsQueue().supply(
    walk([question]),
    walk<PersonsDecision>([]),
    {
      held: over.held === true ? new Set([SESSION]) : new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      answeredFromHere: over.answeredFromHere === true ? new Set([KEY]) : new Set<string>(),
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
      takeOver: (row) => takenOver.push(row),
      open: () => {},
    },
  )
}

function draw(
  question: PersonsQueueRow extends never ? never : PersonsQuestion,
  over: { held?: boolean; answeredFromHere?: boolean } = {},
): ReturnType<typeof mount> {
  supply(question, over)
  return mount(PersonsQueue, {}, { width: 720, height: 420 })
}

/** ⛔ **The sentence the row gives, or `null` because it gave buttons instead.** */
function saidOn(m: ReturnType<typeof mount>): string | null {
  const said = m.all(`persons-queue-no-answer-${KEY}`)[0]
  return said === undefined ? null : said.innerText.trim()
}

/** ⚑ **UI-009** — the card's options on the row, as a person presses them. */
function optionsOn(m: ReturnType<typeof mount>): HTMLButtonElement[] {
  return [
    ...m
      .q(`persons-queue-row-${KEY}`)
      .querySelectorAll<HTMLButtonElement>('button[data-cy="question-option"]'),
  ]
}

/** ⚑ The answer a press sent, as plain data — the map is null-prototype. */
const sent = (response: UserInputResponse | undefined): unknown =>
  response?.kind === 'answer' ? { ...response.answers } : response

afterEach(() => {
  settled.length = 0
  answered.length = 0
  takenOver.length = 0
  usePersonsQueue().forget()
  unmountAll()
})

describe('§1 · the answers are on the row', () => {
  /**
   * 🔴 **`589`'s row, repaired** — the conversation he had open, the question this app raised, and
   * a control where there was a sentence telling him to open something that does not exist.
   */
  it('🔴 a question this app raised draws one button per choice, with what each one does', () => {
    const m = draw(asked(OFFER), { held: true })
    const buttons = optionsOn(m)
    expect(buttons.map((one) => one.innerText.trim())).toEqual(['The 09:10', 'The 11:40'])
    // ⚑ **UI-009 (F052) · each option once** — *"the agent is given “…” as the answer"* repeated
    // every option, and it went with the queue's own buttons.
    expect(m.q(`persons-queue-row-${KEY}`).innerText).not.toContain('as the answer')
    // ⚑ …and the reason is GONE, because there is one no longer.
    expect(saidOn(m)).toBeNull()
  })

  /**
   * ⛔ **The control, and it is the same mount one fact over** (standing rule 3): with nothing
   * offered the row draws no buttons at all, so the green above is the offer being spent rather
   * than this component drawing controls for every row it is handed.
   */
  it('⛔ …and with nothing offered it draws no buttons and says why', () => {
    const m = draw(asked(null), { held: true })
    expect(optionsOn(m)).toHaveLength(0)
    // ⚑ **UI-009** — the words are in the conversation this window found none of them in (D-046),
    // and *Open the conversation* is beside it.
    expect(m.q('question-not-here').innerText).toContain(
      'BroCrew couldn’t find the question’s words. Open the asking conversation to read them.',
    )
    expect(m.all(`persons-queue-go-${KEY}`)).toHaveLength(1)
  })

  /** ⚑ **The press sends what the button says**, through the door the row names. */
  it('⚑ pressing a choice settles this row with that choice, and with the asker’s part', () => {
    const m = draw(asked(OFFER), { held: true })
    optionsOn(m)[1]?.click()
    // ⚑ **UI-009** — through the card's own door, filed under the asker's part.
    expect(answered).toHaveLength(1)
    expect(sent(answered[0]?.response)).toEqual({ answer: ['The 11:40'] })
    expect(settled).toEqual([])
    // ⛔ **The row it settles is the one that was pressed**, which is the whole of *answering the
    // wrong conversation would look completely correct*.
    expect(answered[0]?.row.key).toBe(KEY)
  })
})

describe('§2 · whoever holds it, and the move a row names when it cannot be answered here', () => {
  /**
   * 🔴 **D-017 · R6 — a person answers this app's question from the row, whoever holds the asker.**
   * ⛔ `requireToAnswer` admitted the OWNER alone, so a window holding nothing was offered `434`'s
   * take-over first. ⚑ The host now finds the question in the asker's LEDGER and admits a person by
   * whom it was asked of, running or stopped — so the answers are on the row, and a take-over
   * would be a claim nothing needs.
   */
  it('🔴 nobody holding it draws the answers too, and offers no take-over first', () => {
    const m = draw(asked(OFFER))
    const buttons = optionsOn(m)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.innerText).toContain('The 09:10')
    expect(saidOn(m)).toBeNull()
    expect(m.all(`persons-queue-take-over-${KEY}`)).toHaveLength(0)
    // ⚑ **The press answers this row with that choice, with no claim in front of it.**
    buttons[0]?.click()
    expect(answered.map((one) => [one.row.key, sent(one.response)])).toEqual([
      [KEY, { answer: ['The 09:10'] }],
    ])
    expect(takenOver).toEqual([])
  })

  /**
   * ⛔ **A take-over would not help a question with nothing on it**, so the button is not offered
   * — `106`'s dead control with an encouraging word on it, refused.
   */
  it('⛔ …and a free-form question offers no take-over, because taking it over changes nothing', () => {
    const m = draw(asked(null))
    expect(m.all(`persons-queue-take-over-${KEY}`)).toHaveLength(0)
    // ⚑ **The control on the same mount**: the gesture that DOES still work is drawn.
    expect(m.all(`persons-queue-go-${KEY}`)).toHaveLength(1)
  })
})

describe('§3 · no sentence a cardless row can reach sends a person to a card', () => {
  /**
   * 🔴 **`602`'s finding, re-measured over the states `619` added** — and DERIVED rather than
   * listed, because a hand-written list of states is a guard that expires silently (rule 27.1).
   *
   * ⛔ **`589` followed a sentence that named a card.** Every state below is reachable by a
   * question this app raised, so every one of their sentences is a sentence he could be given.
   */
  const STATES = [
    { held: true, answeredFromHere: false, offered: OFFER },
    { held: false, answeredFromHere: false, offered: OFFER },
    { held: true, answeredFromHere: true, offered: OFFER },
    { held: false, answeredFromHere: true, offered: OFFER },
    { held: true, answeredFromHere: false, offered: null },
    { held: false, answeredFromHere: false, offered: null },
    { held: true, answeredFromHere: true, offered: null },
    { held: false, answeredFromHere: true, offered: null },
  ] as const

  it('🔴 not one of them says *its card* or *open it to answer*', () => {
    // ⚑ **UI-009** — the whole ROW is read, because the row is now the question's card: none of
    // the sentences that explained the machinery reaches it either (F052).
    const seen: string[] = []
    for (const state of STATES) {
      const m = draw(asked(state.offered), state)
      seen.push(m.q(`persons-queue-row-${KEY}`).innerText)
      unmountAll()
      usePersonsQueue().forget()
    }
    expect(seen, 'the sweep read fewer rows than it drew').toHaveLength(STATES.length)
    for (const said of seen) {
      expect(said, `a cardless row still promises a card: ${said}`).not.toContain('its card')
      expect(said, `a cardless row still sends a person to one: ${said}`).not.toContain(
        'open it to answer',
      )
      for (const machinery of [
        'Escalated to you',
        'as the answer',
        'does not predict',
        'This is about',
        'is working on',
      ]) {
        expect(said, `the row still explains the machinery: ${said}`).not.toContain(machinery)
      }
    }
  })

  /**
   * ⚑ **The positive control, and it is the same sweep.** ⛔ Without it *"none of them says it"*
   * is satisfiable by a component that renders no sentence at all, or by a search shape that
   * cannot match — `a-negative-is-only-as-strong-as-the-search-shape` and rule 34.2.
   */
  it('⚑ …and the sweep CAN find both phrases, on the population that really has a card', () => {
    const held = draw(asked(null, 'the-provider'), { held: true })
    expect(saidOn(held)).toContain('open it to answer')
    unmountAll()
    usePersonsQueue().forget()
    const nobodys = draw(asked(null, 'the-provider'))
    expect(saidOn(nobodys)).toContain('its card')
  })

  /**
   * 🔴 **The sentence this dispatch had to repair, and the photograph is what found it**
   * (rule 17.2, standing rule 8.1).
   *
   * ⛔ **`no-longer-waiting` read *"That CARD is no longer waiting"***, which was exact while the
   * arm was reachable only from a row that has one. ⚠️ `619` made it the sentence a person sees
   * for the five seconds after answering a question that has no card at all.
   */
  it('🔴 the sentence after a press names the ACT, not an object this row does not have', () => {
    const m = draw(asked(OFFER), { held: true, answeredFromHere: true })
    // ⚑ **UI-009** — the card says *answer sent*, and its presses are dark until the list catches up.
    expect(m.q('question-state').innerText.trim()).toBe('answer sent')
    expect(optionsOn(m).every((one) => one.disabled)).toBe(true)
    expect(saidOn(m)).toBeNull()
    // ⛔ **And the row is still in the list**, because the ledger has not been asked again — `468`
    // moved the words and not the authority, and this dispatch does not move it either.
    expect(m.all(`persons-queue-row-${KEY}`)).toHaveLength(1)
  })
})
