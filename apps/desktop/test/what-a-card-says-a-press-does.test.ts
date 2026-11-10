import { describe, expect, it } from 'vitest'
import { ALWAYS_HONOURED, PLAN_CONSENTS, permissionOutcomeSchema } from '@brobot2/runtime'
import { permissionDecisionFor, permissionOffer } from '../src/renderer/src/lib/permission-offer'
import type { UserInputRequestEvent } from '../src/renderer/src/lib/transcript'
import {
  ANSWER_SENDS_THE_FORM,
  WHAT_COMES_AFTER_IS_NOT_OURS,
  userInputOffer,
  whatThisAnswerDoes,
  type AttentionDecision,
  type ConsentAsked,
} from '../src/renderer/src/lib/user-input-offer'

/** One `user_input_request`, built whole — what `userInputOffer` reads. */
const asking = (over: Partial<UserInputRequestEvent> = {}): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_1',
  prompt: 'the agent asks',
  questions: [],
  ...over,
})

/**
 * ⛔ **Exhaustive by the TYPE rather than by a list somebody maintains**
 * (`a-loop-over-a-literal-variant-list-is-not-exhaustive`). A fourth consent does not compile until
 * it is a key here, and the `Object.keys` below then walks it without an edit.
 */
const EVERY_CONSENT: Record<ConsentAsked, true> = {
  'access-for-this-turn': true,
  'start-planning': true,
  'stop-planning': true,
  'a-consent-this-window-cannot-name': true,
}
const CONSENTS = Object.keys(EVERY_CONSENT) as ConsentAsked[]

/** The request each consent is read off — `consentAsked`'s own three discriminators. */
const REQUEST_FOR: Readonly<Record<ConsentAsked, UserInputRequestEvent>> = {
  'access-for-this-turn': asking({ permission: { paths: [], network: false } }),
  'start-planning': asking({ consent: 'start-planning' }),
  'stop-planning': asking({ consent: 'stop-planning' }),
  'a-consent-this-window-cannot-name': asking(),
}

/* ------------------------------------------- §1 · the offer carries the sentences, and they are
                                                     the queue's, because there is one call */

describe('§1 · the sentence a card draws is the sentence the queue draws', () => {
  it('🔴 `positiveDoes` IS `whatThisAnswerDoes` of the decision the overview is handed', () => {
    expect(CONSENTS).toHaveLength(PLAN_CONSENTS.length + 2)
    for (const consent of CONSENTS) {
      const offer = userInputOffer(REQUEST_FOR[consent])
      const approve = offer.decisions[0]
      // ⚑ The premise: this really is the zero-question branch, so `decisions[0]` really is the
      // press the card's button makes. A test that asserted the equality without this would still
      // pass if the branch changed under it.
      expect(approve).toMatchObject({ kind: 'approve', consent })
      expect(offer.positive).toBe('Approve')
      expect(offer.positiveDoes).toBe(whatThisAnswerDoes(approve as AttentionDecision))
    }
  })

  it('⛔ …and the four consents really do say four different things', () => {
    // Without this the equality above is satisfiable by one sentence for everything, which is the
    // exact defect `478` was sent at (`a-comparison-tested-where-both-sides-agree`).
    const said = CONSENTS.map((consent) => userInputOffer(REQUEST_FOR[consent]).positiveDoes)
    expect(new Set(said).size).toBe(CONSENTS.length)
  })

  it('⚑ `rejectDoes` is the reject arm, on every shape of request', () => {
    const rejectSays = whatThisAnswerDoes({ kind: 'reject', label: 'Reject' })
    for (const request of [
      asking(),
      asking({ questions: [{ id: 'q', prompt: 'pick', options: [{ label: 'Yes' }] }] }),
      asking({ questions: [{ id: 'q', prompt: 'type', options: [] }] }),
    ]) {
      expect(userInputOffer(request).rejectDoes).toBe(rejectSays)
    }
  })

  it('⛔ a request with questions says what the FORM sends, and it is nobody else’s sentence', () => {
    const offer = userInputOffer(
      asking({ questions: [{ id: 'q', prompt: 'pick', options: [{ label: 'Yes' }] }] }),
    )
    expect(offer.positive).toBe('Answer')
    expect(offer.positiveDoes).toBe(ANSWER_SENDS_THE_FORM)
    // ⚠️ **Not one of the one-click answers**, deliberately: the card's submit sends the whole form
    // and an overview's button sends one option, so borrowing that sentence would be false about
    // a multi-select. The negative is asserted so the choice cannot quietly collapse.
    expect(offer.decisions.map(whatThisAnswerDoes)).not.toContain(offer.positiveDoes)
  })
})

/* ------------------------------------------------- §2 · nothing a card can draw is left silent */

describe('§2 · every control a card can draw has a sentence', () => {
  const OUTCOMES = permissionOutcomeSchema.options

  it('🔴 every permission outcome — the row and the wholesale grant alike', () => {
    expect(OUTCOMES.length).toBeGreaterThan(1)
    for (const outcome of OUTCOMES) {
      const says = whatThisAnswerDoes({
        kind: 'permission',
        label: outcome,
        decision: permissionDecisionFor(outcome),
      })
      expect(says.trim(), `nothing is said about ${outcome}`).not.toBe('')
    }
  })

  it('⛔ …and no two of them say the same thing', () => {
    // `an-unenumerated-state-counts-as-success` with the stakes inverted: a new outcome that fell
    // through to a neighbour's sentence would pass the test above and tell a person the wrong
    // thing about the widest button on the card.
    const said = OUTCOMES.map((outcome) =>
      whatThisAnswerDoes({
        kind: 'permission',
        label: outcome,
        decision: permissionDecisionFor(outcome),
      }),
    )
    expect(new Set(said).size).toBe(OUTCOMES.length)
  })
})

describe('§3 · a card renders the sentence and never writes one', () => {
  /** Every sentence `whatThisAnswerDoes` can return, derived rather than listed. */
  const EVERY_SENTENCE = [
    ...permissionOutcomeSchema.options.map((outcome) =>
      whatThisAnswerDoes({
        kind: 'permission',
        label: outcome,
        decision: permissionDecisionFor(outcome),
      }),
    ),
    ...CONSENTS.map((consent) => userInputOffer(REQUEST_FOR[consent]).positiveDoes),
    whatThisAnswerDoes({ kind: 'reject', label: 'Reject' }),
    ANSWER_SENDS_THE_FORM,
    WHAT_COMES_AFTER_IS_NOT_OURS,
  ]

  it('⛔ the sentence source is reachable from the card at all — the non-vacuity of the above', () => {
    // The census strips comments, so a card that imported nothing and merely TALKED about the
    // function would fail here rather than passing both assertions above.
    expect(EVERY_SENTENCE.length).toBeGreaterThan(permissionOutcomeSchema.options.length)
    expect(new Set(EVERY_SENTENCE).size).toBe(EVERY_SENTENCE.length)
  })
})

/* ------------------------------------------------------- §4 · the move nobody could reach (§2.1) */

describe('§4 · the Codex agent-tool card’s third move reaches the row', () => {
  /**
   * ⛔ **The set the producer publishes is pinned in the runtime suite**, not re-derived here —
   * this asserts the RENDERER's half: that the row a surface draws from it contains the control.
   */
  const AGENT_TOOL_OFFER = ['allow', ...ALWAYS_HONOURED] as const

  it('🔴 Cancel is in the row a surface draws for that card', () => {
    const { row, wide } = permissionOffer(AGENT_TOOL_OFFER, 'spawn_agent')
    expect(row).toContain('cancel')
    expect(row).toContain('deny')
    expect(row).toContain('allow')
    // ⛔ `001` non-negotiable 1 is untouched: a session-wide grant for these tools stays off.
    expect(row).not.toContain('allow_for_session')
    expect(wide).toBeNull()
  })

  it('⚑ …and the control: the set it published before 482 drew no Cancel', () => {
    // Without this the assertion above is satisfied by a `permissionOffer` that invented the
    // button, which is the opposite defect (`297`: a surface deciding what a request offers).
    expect(permissionOffer(['allow', 'deny'], 'spawn_agent').row).not.toContain('cancel')
  })

  it('⛔ every member of that row has its own sentence, so no button is silent', () => {
    const { row } = permissionOffer(AGENT_TOOL_OFFER, 'spawn_agent')
    const said = row.map((outcome) =>
      whatThisAnswerDoes({
        kind: 'permission',
        label: outcome,
        decision: permissionDecisionFor(outcome),
      }),
    )
    expect(said.every((sentence) => sentence.trim() !== '')).toBe(true)
    expect(new Set(said).size).toBe(row.length)
  })
})
