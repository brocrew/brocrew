import { refusalReason } from '../../shared/refusals'
import type { SessionStatus } from '@brobot2/shared'
import type { RailPermanence } from '../../shared/refusals'
import type { RefusalRemedy } from '../../shared/refusals'

export const INTERRUPT_RAILS = [
  'a-person-is-being-asked',
  'it-is-waiting-on-an-answer',
  'not-below-you',
  'that-conversation-has-not-started',
  'that-service-is-on-another-callers-piece',
] as const

export type InterruptRail = (typeof INTERRUPT_RAILS)[number]

const PERMANENCE: Readonly<Record<InterruptRail, RailPermanence>> = {
  'a-person-is-being-asked': 'until-a-person-changes-it',
  'it-is-waiting-on-an-answer': 'until-a-person-changes-it',
  'not-below-you': 'permanent',
  'that-conversation-has-not-started': 'while-this-holds',
  'that-service-is-on-another-callers-piece': 'while-this-holds',
}

export function interruptPermanenceOf(rail: InterruptRail): RailPermanence {
  return PERMANENCE[rail]
}

export function interruptRetryableOf(rail: InterruptRail): boolean {
  return interruptPermanenceOf(rail) === 'while-this-holds'
}

const REMEDY: Readonly<Record<InterruptRail, RefusalRemedy | null>> = {
  'a-person-is-being-asked': null,
  'it-is-waiting-on-an-answer': null,
  'not-below-you': null,
  'that-conversation-has-not-started': 'make-the-same-call-when-this-settles',
  'that-service-is-on-another-callers-piece': 'make-the-same-call-when-this-settles',
}

export function interruptRemedyOf(rail: InterruptRail): RefusalRemedy | null {
  return REMEDY[rail]
}

export interface InterruptRefusalDetail {
  agent?: string
  askedOf?: string
}

export interface InterruptRefusal {
  readonly rail: InterruptRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  readonly remedy: RefusalRemedy | null
  readonly detail: InterruptRefusalDetail
}

const INTERRUPT_SENTENCES: Readonly<Record<InterruptRail, string>> = {
  'a-person-is-being-asked':
    'that conversation is waiting for a person to answer something. Nothing was interrupted: carry on with something else, or say that you are blocked on it — cutting into it now would throw that question away and answer it as a refusal. Only the person answering ends this, and asking again will not.',
  'it-is-waiting-on-an-answer':
    'that conversation is waiting on an answer from the conversation this refusal names, so nothing was interrupted. If that is you, answer it with answer_question; otherwise it goes on once that one answers. The question went to that conversation, not to a person: cutting into it now would throw that question away and answer it as a refusal, and asking again will not interrupt it.',
  'not-below-you':
    'that conversation is not one you started, or one started under them, so nothing was interrupted: only those can be. To ask it something use ask_question; to tell it something, message_agent.',
  'that-conversation-has-not-started':
    'that conversation has not started yet, so there is nothing running to interrupt. It comes up or fails to launch on its own: ask again in a moment.',
  'that-service-is-on-another-callers-piece':
    'Not stopped: that service is on another caller’s piece. Yours waits behind it.',
}

export function refuseInterrupt(
  rail: InterruptRail,
  detail: InterruptRefusalDetail = {},
): InterruptRefusal {
  return {
    rail,
    permanence: interruptPermanenceOf(rail),
    retryable: interruptRetryableOf(rail),
    reason: refusalReason(INTERRUPT_SENTENCES[rail]),
    remedy: interruptRemedyOf(rail),
    detail,
  }
}

export function admitInterrupt(
  agent: string,
  status: SessionStatus | null,
  askedOf: string | null = null,
): InterruptRefusal | null {
  if (status === null) return refuseInterrupt('that-conversation-has-not-started', { agent })
  if (status === 'waiting_permission') {
    return askedOf === null
      ? refuseInterrupt('a-person-is-being-asked', { agent })
      : refuseInterrupt('it-is-waiting-on-an-answer', { agent, askedOf })
  }
  return null
}
