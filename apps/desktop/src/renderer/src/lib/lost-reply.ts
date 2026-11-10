import type { LostReply, UndeliveredReason } from './transcript-message-contracts'
export type { LostReply, UndeliveredReason } from './transcript-message-contracts'
import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import { AN_UNNAMED_PARENT } from './outgoing-card'

/**
 * ⚑ **Why a reply reached nobody, in words** — one clause per reason, after a colon.
 *
 * ⛔ **Each clause is a fact about THIS reply**, from the reason's own docblock in `reply-rails.ts`,
 * and never a sentence about how replies are routed (HO-015 §2). ⚠️ **Past tense**: the notice is a
 * record of something that happened, and the parent may be running again by the time it is read.
 */
export const UNDELIVERED_REASON_WORDS = {
  'not-delivered': 'something went wrong on the way',
} as const satisfies Record<UndeliveredReason, string>

/**
 * ⚑ A word this build has words for — a row from a later build answers `false` and prints no reason,
 * and so, since `729`, does `held-then-lost` (R89), which this build's main writes and this table has
 * no words for yet — and, since D-010, a row an EARLIER build wrote `parent-is-holding-a-message`,
 * the answer a busy parent gave before it held replies; and since D-017, `no-conversation`.
 */
export function isUndeliveredReason(word: unknown): word is UndeliveredReason {
  return typeof word === 'string' && Object.hasOwn(UNDELIVERED_REASON_WORDS, word)
}

/**
 * 🔴 **The sentence**: *"the reply to W1.2 did not reach Ada: something went wrong on the way —
 * <what failed>"*.
 *
 * ⚠️ **No label → *the reply*; no name → *its parent*; no reason → the sentence stops at the name**,
 * or gives only what failed. ⛔ **Each fallback says less, never something else** — no id, no
 * handle and no raw word of this app's vocabulary.
 */
export function lostReplySentence(
  lost: LostReply,
  identities: readonly AgentIdentity[] | null,
): string {
  const reply = lost.label === undefined ? 'the reply' : `the reply to ${lost.label}`
  const whom =
    lost.toProfile === undefined ? AN_UNNAMED_PARENT : agentName(lost.toProfile, identities)
  const said = `${reply} did not reach ${whom}`
  const why = [
    lost.because === null ? null : UNDELIVERED_REASON_WORDS[lost.because],
    lost.detail ?? null,
  ].filter((part) => part !== null)
  return why.length === 0 ? said : `${said}: ${why.join(' — ')}`
}
