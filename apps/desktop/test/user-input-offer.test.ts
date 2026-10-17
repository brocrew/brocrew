import { describe, expect, it } from 'vitest'
import type { UserInputRequestEvent } from '../src/renderer/src/lib/transcript'
import { userInputOffer } from '../src/renderer/src/lib/user-input-offer'
import type { UserInputQuestion } from '../src/shared/runtime-ipc'

/**
 * # ⛔ One answer to "what can this card do", for every surface that draws one (214 §3)
 *
 * `213` found Home saying *"The agent has finished planning and asks you to approve its plan"*,
 * offering **Reject** and **Open**, and printing *"carries no question and nothing to approve"*
 * underneath — while the card inside the conversation offered **Approve**. Neither surface was
 * wrong on its own terms. They disagreed because the same rule was written down twice.
 *
 * ⚠️ **`attention-queue.test.ts` and `user-input-card.dom.test.ts` still own their own surfaces.**
 * This file owns the thing between them: the invariant that they cannot come apart again. The
 * dispatch asks for *"one source for what this card can do"* — a source is only that if something
 * fails when a second one appears.
 */

const question = (over: Partial<UserInputQuestion> = {}): UserInputQuestion =>
  ({
    id: 'q0',
    prompt: 'which one?',
    options: [{ label: 'this one' }, { label: 'the other' }],
    ...over,
  }) as UserInputQuestion

/** One `user_input_request`, built whole — 478 made the offer take the request, not a slice. */
const asking = (
  questions: UserInputQuestion[],
  over: Partial<UserInputRequestEvent> = {},
): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_1',
  prompt: 'the agent asks',
  questions,
  ...over,
})

/**
 * Every shape a `user_input_request` can carry, named. The plan cards and the grant are the real
 * ones that ask nothing — they differ in what they DISCLOSE, which is the projection's business,
 * and not in whether they can be answered, which is this file's.
 *
 * ⚠️ **478 · the two zero-question rows used to be the same object with different names on it.**
 * The row said *"a Claude plan approval"* and *"a Codex permission grant"* and both were
 * `questions: []`, so nothing here could have noticed the two being told apart — or not being.
 * They now carry the fields the adapters really set.
 */
const SHAPES: { what: string; request: UserInputRequestEvent }[] = [
  {
    what: '⛔ a Claude plan approval — ExitPlanMode, no questions, no grant',
    request: asking([], { consent: 'stop-planning' }),
  },
  {
    what: '⛔ a Claude planning consent written before 736 — EnterPlanMode (R98: no card since), no questions, no grant',
    request: asking([], { consent: 'start-planning' }),
  },
  {
    what: '⛔ a Codex permission grant — no questions, a permission scope',
    request: asking([], { permission: { paths: ['write /tmp/x'], network: false } }),
  },
  { what: 'one plain question', request: asking([question()]) },
  { what: 'one multi-select question', request: asking([question({ multiSelect: true })]) },
  { what: 'one secret question', request: asking([question({ secret: true })]) },
  { what: 'one free-form question', request: asking([question({ options: [] })]) },
  { what: 'two questions', request: asking([question(), question({ id: 'q1' })]) },
]

describe('what a user-input request can be answered with', () => {
  /**
   * 🔴 **THE regression, and it is the invariant rather than one case.**
   *
   * The card's button and the overview's decisions are two readings of one predicate. Asserting
   * them separately is what the app was already doing — in two files, with two answers. This asserts
   * that they agree, over every shape, which is the property `214` §3 asks to be made impossible to
   * break.
   */
  it.each(SHAPES)('🔴 the button and the one-click decisions agree · $what', ({ request }) => {
    const offer = userInputOffer(request)
    const approves = offer.decisions.some((decision) => decision.kind === 'approve')

    expect(offer.positive === 'Approve').toBe(approves)
    // ⚑ And the paired half in the other direction: a surface that says Answer never smuggles an
    // Approve into the row beside it.
    expect(offer.positive === 'Answer').toBe(!approves)
  })

  it('⛔ Reject is the last decision on every shape, and there is always one', () => {
    // The protocol-safe answer the contract names: a row that can offer nothing else can still stop
    // an agent waiting on an answer it is not going to get.
    for (const { request } of SHAPES) {
      const decisions = userInputOffer(request).decisions
      expect(decisions.at(-1)).toEqual({ kind: 'reject', label: 'Reject' })
      expect(decisions.filter((decision) => decision.kind === 'reject')).toHaveLength(1)
    }
  })

  it('🔴 a request that asks NOTHING is approved, and carries no limit at all', () => {
    // 213's card. The old projection answered `limit: 'no-question'` and `[Reject]` here.
    const offer = userInputOffer(asking([], { consent: 'stop-planning' }))

    expect(offer.positive).toBe('Approve')
    expect(offer.limit).toBeNull()
    expect(offer.decisions).toEqual([
      { kind: 'approve', label: 'Approve', consent: 'stop-planning' },
      { kind: 'reject', label: 'Reject' },
    ])
  })

  it('⚠️ …and a request that genuinely cannot be one-clicked still says why, and offers only Reject', () => {
    // The paired positive the dispatch asks for. Removing `no-question` must not remove the
    // surface's ability to refuse — these four are the cases where a one-click answer would be a
    // half-answer, and every one of them keeps its sentence.
    expect(userInputOffer(asking([question({ multiSelect: true })])).limit).toBe('multi-select')
    expect(userInputOffer(asking([question({ secret: true })])).limit).toBe('secret')
    expect(userInputOffer(asking([question({ options: [] })])).limit).toBe('free-form')
    expect(userInputOffer(asking([question(), question({ id: 'q1' })])).limit).toBe('multiple')

    for (const questions of [
      [question({ multiSelect: true })],
      [question({ secret: true })],
      [question({ options: [] })],
      [question(), question({ id: 'q1' })],
    ]) {
      expect(userInputOffer(asking(questions)).positive).toBe('Answer')
      expect(userInputOffer(asking(questions)).decisions).toEqual([
        { kind: 'reject', label: 'Reject' },
      ])
    }
  })

  it('one ordinary question offers its own options, keyed by the id the provider chose', () => {
    // The ordinary case, which the whole surface exists for — and the one the fix must not disturb.
    const offer = userInputOffer(asking([question()]))

    expect(offer.positive).toBe('Answer')
    expect(offer.limit).toBeNull()
    expect(offer.decisions).toEqual([
      { kind: 'answer', label: 'this one', questionId: 'q0', option: 'this one' },
      { kind: 'answer', label: 'the other', questionId: 'q0', option: 'the other' },
      { kind: 'reject', label: 'Reject' },
    ])
  })
})
