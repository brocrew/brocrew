import { describe, expect, it } from 'vitest'
import type { PermissionOutcome } from '@brobot2/runtime'
import { permissionDecisionFor } from '../src/renderer/src/lib/permission-offer'
import {
  userInputOffer,
  whatThisAnswerDoes,
  type AttentionDecision,
  type ConsentAsked,
} from '../src/renderer/src/lib/user-input-offer'
import type { UserInputRequestEvent } from '../src/renderer/src/lib/transcript'

/**
 * Every answer the queue can offer says what it does in its own words. The painted half, both
 * surfaces drawing the same words, is `test/dom/homes-queue-says-what-each-answer-does.dom.test.ts`.
 */

/**
 * ⛔ **Every member of {@link AttentionDecision}, keyed so a new one does not compile** — the same
 * device the vocabulary itself uses. ⚠️ A plain array would let a sixth kind arrive with no
 * sentence under census, which is `a-loop-over-a-literal-variant-list-is-not-exhaustive`.
 */
const EVERY_OUTCOME = {
  allow: 0,
  allow_for_session: 0,
  allow_all_for_session: 0,
  // ⚑ 736 · R95
  allow_always: 0,
  deny: 0,
  cancel: 0,
} as const satisfies Readonly<Record<PermissionOutcome, 0>>

const EVERY_CONSENT = {
  'access-for-this-turn': 0,
  'start-planning': 0,
  'stop-planning': 0,
  'a-consent-this-window-cannot-name': 0,
} as const satisfies Readonly<Record<ConsentAsked, 0>>

const asking = (questions: UserInputRequestEvent['questions']): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_481',
  prompt: 'the agent asks',
  questions,
})

/** Every decision any surface can offer, built by the two production offer functions. */
function everyDecision(): AttentionDecision[] {
  const permissions = (Object.keys(EVERY_OUTCOME) as PermissionOutcome[]).map((outcome) => ({
    kind: 'permission' as const,
    label: outcome,
    decision: permissionDecisionFor(outcome),
  }))
  const consents = (Object.keys(EVERY_CONSENT) as ConsentAsked[]).map((consent) => ({
    kind: 'approve' as const,
    label: 'Approve',
    consent,
  }))
  const answered = userInputOffer(
    asking([{ id: 'release', prompt: 'Which release?', options: [{ label: 'Current' }] }]),
  ).decisions
  return [...permissions, ...consents, ...answered]
}

describe('481 · the sentence Home draws is the one the vocabulary owns', () => {
  it('🔴 every answer any surface can offer has its own non-empty sentence, and no two share one', () => {
    const sentences = everyDecision().map(whatThisAnswerDoes)
    // ⛔ **Non-empty, per `467`'s instinct**: a blank effect line reads as *no consequence*, which
    // is a claim, and the worst one to make by omission.
    for (const sentence of sentences) expect(sentence.trim().length).toBeGreaterThan(0)
    // ⚑ **And distinct** — `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`.
    // Two answers sharing a sentence is how one card came to carry three effects under one line,
    // which is the defect `478` was sent at.
    expect(new Set(sentences).size).toBe(sentences.length)
  })
})
