import { describe, expect, it } from 'vitest'
import { ALWAYS_HONOURED, PLAN_CONSENTS, permissionOutcomeSchema } from '@brobot2/runtime'
import { permissionDecisionFor, permissionOffer } from '../src/renderer/src/lib/permission-offer'
import type { UserInputRequestEvent } from '../src/renderer/src/lib/transcript'
import {
  ANSWER_SENDS_THE_FORM,
  userInputOffer,
  whatThisAnswerDoes,
  type AttentionDecision,
  type ConsentAsked,
} from '../src/renderer/src/lib/user-input-offer'

const asking = (over: Partial<UserInputRequestEvent> = {}): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_1',
  prompt: 'the agent asks',
  questions: [],
  ...over,
})

/** Keyed by the type, so a new consent does not compile until it is listed here. */
const EVERY_CONSENT: Record<ConsentAsked, true> = {
  'access-for-this-turn': true,
  'start-planning': true,
  'stop-planning': true,
  'a-consent-this-window-cannot-name': true,
}
const CONSENTS = Object.keys(EVERY_CONSENT) as ConsentAsked[]

const REQUEST_FOR: Readonly<Record<ConsentAsked, UserInputRequestEvent>> = {
  'access-for-this-turn': asking({ permission: { paths: [], network: false } }),
  'start-planning': asking({ consent: 'start-planning' }),
  'stop-planning': asking({ consent: 'stop-planning' }),
  'a-consent-this-window-cannot-name': asking(),
}

describe('the sentence a card draws is the sentence the queue draws', () => {
  it('`positiveDoes` is `whatThisAnswerDoes` of the decision the overview is handed', () => {
    expect(CONSENTS).toHaveLength(PLAN_CONSENTS.length + 2)
    for (const consent of CONSENTS) {
      const offer = userInputOffer(REQUEST_FOR[consent])
      const approve = offer.decisions[0]
      expect(approve).toMatchObject({ kind: 'approve', consent })
      expect(offer.positive).toBe('Approve')
      expect(offer.positiveDoes).toBe(whatThisAnswerDoes(approve as AttentionDecision))
    }
  })

  it('the four consents say four different things', () => {
    const said = CONSENTS.map((consent) => userInputOffer(REQUEST_FOR[consent]).positiveDoes)
    expect(new Set(said).size).toBe(CONSENTS.length)
  })

  it('`rejectDoes` is the reject arm, on every shape of request', () => {
    const rejectSays = whatThisAnswerDoes({ kind: 'reject', label: 'Reject' })
    for (const request of [
      asking(),
      asking({ questions: [{ id: 'q', prompt: 'pick', options: [{ label: 'Yes' }] }] }),
      asking({ questions: [{ id: 'q', prompt: 'type', options: [] }] }),
    ]) {
      expect(userInputOffer(request).rejectDoes).toBe(rejectSays)
    }
  })

  it('a request with questions says what the form sends, not what one option does', () => {
    const offer = userInputOffer(
      asking({ questions: [{ id: 'q', prompt: 'pick', options: [{ label: 'Yes' }] }] }),
    )
    expect(offer.positive).toBe('Answer')
    expect(offer.positiveDoes).toBe(ANSWER_SENDS_THE_FORM)
    expect(offer.decisions.map(whatThisAnswerDoes)).not.toContain(offer.positiveDoes)
  })
})

describe('every permission control a card can draw has its own sentence', () => {
  it('every permission outcome says something, and no two say the same thing', () => {
    const OUTCOMES = permissionOutcomeSchema.options
    expect(OUTCOMES.length).toBeGreaterThan(1)
    const said = OUTCOMES.map((outcome) =>
      whatThisAnswerDoes({
        kind: 'permission',
        label: outcome,
        decision: permissionDecisionFor(outcome),
      }),
    )
    said.forEach((says, index) =>
      expect(says.trim(), `nothing is said about ${OUTCOMES[index]}`).not.toBe(''),
    )
    expect(new Set(said).size).toBe(OUTCOMES.length)
  })
})

describe('the Codex agent-tool card offers Cancel', () => {
  const AGENT_TOOL_OFFER = ['allow', ...ALWAYS_HONOURED] as const

  it('Cancel is in the row a surface draws for that card, and no session-wide grant', () => {
    const { row, wide } = permissionOffer(AGENT_TOOL_OFFER, 'spawn_agent')
    expect(row).toContain('cancel')
    expect(row).toContain('deny')
    expect(row).toContain('allow')
    expect(row).not.toContain('allow_for_session')
    expect(wide).toBeNull()
  })

  it('a set without cancel draws no Cancel', () => {
    expect(permissionOffer(['allow', 'deny'], 'spawn_agent').row).not.toContain('cancel')
  })
})
